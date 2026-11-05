import { BillingConfigError, handleStripeEvent, verifyWebhook, WebhookSignatureError } from "@/lib/billing/stripe";
import { errorJson, json } from "@/lib/server/http";
import { billingEnabled } from "@/lib/billing/flag";

/**
 * Stripe webhook. The RAW body is verified against Stripe-Signature before
 * anything else happens. Credits are granted only here.
 */
export async function POST(req: Request): Promise<Response> {
  if (!billingEnabled()) return errorJson(404, "billing_disabled", "Billing is turned off on this server.");
  const raw = await req.text();
  let event;
  try {
    event = verifyWebhook(raw, req.headers.get("stripe-signature"));
  } catch (err) {
    if (err instanceof WebhookSignatureError) return errorJson(400, err.code, "Invalid signature.");
    if (err instanceof BillingConfigError) return errorJson(503, err.code, err.message);
    throw err;
  }
  try {
    const outcome = await handleStripeEvent(event);
    return json({ received: true, outcome: outcome.status });
  } catch (err) {
    console.error("[stripe/webhook] processing failed:", (err as Error).message);
    // 500 → Stripe retries; nothing was committed thanks to the transaction.
    return errorJson(500, "processing_failed", "Webhook processing failed.");
  }
}
