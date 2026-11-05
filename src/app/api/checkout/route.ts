import { ensureSession, withCookie } from "@/lib/server/session";
import { BillingConfigError, createPack20Checkout } from "@/lib/billing/stripe";
import { errorJson, json } from "@/lib/server/http";
import { billingEnabled } from "@/lib/billing/flag";

/** Create a Stripe Checkout Session (TEST MODE) for the 20-credit pack. */
export async function POST(req: Request): Promise<Response> {
  if (!billingEnabled()) return errorJson(404, "billing_disabled", "Billing is turned off on this server.");
  const { id, setCookie } = await ensureSession(req);
  try {
    const session = await createPack20Checkout(id);
    return withCookie(json({ url: session.url, id: session.id }), setCookie);
  } catch (err) {
    if (err instanceof BillingConfigError) return withCookie(errorJson(503, err.code, err.message), setCookie);
    console.error("[api/checkout] failed:", (err as Error).message);
    return withCookie(errorJson(502, "stripe_error", "Could not start Stripe Checkout."), setCookie);
  }
}
