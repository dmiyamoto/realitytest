/**
 * Stripe Checkout (TEST MODE) and verified webhook handling.
 *
 * Credits are granted ONLY from a signature-verified webhook for a paid
 * Checkout Session. Visiting success_url never grants credits.
 */
import Stripe from "stripe";
import { prisma } from "../server/db";
import { grantPurchase, isUniqueViolation, PACK20_CREDITS } from "./credits";

export class BillingConfigError extends Error {
  readonly code = "billing_not_configured";
}

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new BillingConfigError("STRIPE_SECRET_KEY is not set.");
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    // Live billing requires owner approval and real authentication.
    if (process.env.STRIPE_LIVE_MODE_APPROVED !== "owner-approved") {
      throw new BillingConfigError("Refusing to use a non-test Stripe key. RealityTest runs Stripe in TEST MODE only.");
    }
  }
  return new Stripe(key);
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function createPack20Checkout(guestSessionId: string, client: Stripe = stripeClient()) {
  const price = process.env.STRIPE_PRICE_ID_PACK20;
  if (!price) throw new BillingConfigError("STRIPE_PRICE_ID_PACK20 is not set.");
  const session = await client.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: guestSessionId,
    metadata: { guestSessionId, pack: "pack20", credits: String(PACK20_CREDITS) },
    payment_intent_data: { metadata: { guestSessionId, pack: "pack20" } },
    success_url: `${appUrl()}/pricing?checkout=success&cs={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/pricing?checkout=cancelled`,
  });
  await prisma.checkoutRecord.create({ data: { id: session.id, sessionId: guestSessionId, status: "open" } });
  return session;
}

export class WebhookSignatureError extends Error {
  readonly code = "invalid_signature";
}

export function verifyWebhook(rawBody: string, signature: string | null, client?: Stripe): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new BillingConfigError("STRIPE_WEBHOOK_SECRET is not set.");
  if (!signature) throw new WebhookSignatureError("Missing Stripe-Signature header.");
  try {
    // constructEvent is a static-style helper; a dummy key is fine for verification.
    const s = client ?? new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_verify_only");
    return s.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    throw new WebhookSignatureError(`Invalid Stripe signature: ${(err as Error).message}`);
  }
}

export type WebhookOutcome =
  | { status: "duplicate" }
  | { status: "ignored"; type: string }
  | { status: "granted"; guestSessionId: string; credits: number }
  | { status: "already_granted" }
  | { status: "awaiting_payment" }
  | { status: "failed" }
  | { status: "expired" }
  | { status: "rejected"; reason: string };

/**
 * Process a verified event exactly once. The StripeEvent insert and the credit
 * grant commit in the same transaction, so a crash cannot record the event
 * without granting (Stripe will retry) and replays cannot grant twice.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });

      const relevant = [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
      ];
      if (!relevant.includes(event.type)) return { status: "ignored", type: event.type } as const;

      const cs = event.data.object as Stripe.Checkout.Session;
      const guestSessionId = cs.metadata?.guestSessionId || cs.client_reference_id;
      if (!guestSessionId || cs.metadata?.pack !== "pack20" || cs.mode !== "payment") {
        return { status: "rejected", reason: "not a RealityTest pack20 checkout" } as const;
      }
      if (process.env.STRIPE_LIVE_MODE_APPROVED !== "owner-approved" && cs.livemode) {
        return { status: "rejected", reason: "live-mode event refused (test mode only)" } as const;
      }
      const guest = await tx.guestSession.findUnique({ where: { id: guestSessionId } });
      if (!guest) return { status: "rejected", reason: "unknown guest session" } as const;

      const setStatus = (status: string) =>
        tx.checkoutRecord.upsert({
          where: { id: cs.id },
          create: { id: cs.id, sessionId: guestSessionId, status },
          update: { status },
        });

      if (event.type === "checkout.session.expired") {
        await setStatus("expired");
        return { status: "expired" } as const;
      }
      if (event.type === "checkout.session.async_payment_failed") {
        await setStatus("failed");
        return { status: "failed" } as const;
      }
      // completed or async_payment_succeeded: grant only when actually paid.
      if (cs.payment_status !== "paid") {
        await setStatus("awaiting_payment");
        return { status: "awaiting_payment" } as const;
      }
      await setStatus("paid");
      const granted = await grantPurchase(tx, guestSessionId, cs.id, PACK20_CREDITS);
      return granted
        ? ({ status: "granted", guestSessionId, credits: PACK20_CREDITS } as const)
        : ({ status: "already_granted" } as const);
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate" };
    throw err;
  }
}
