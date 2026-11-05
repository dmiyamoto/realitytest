/**
 * Billing feature flag. Stripe billing is OFF unless BILLING_ENABLED=true.
 * When off: no pricing page or checkout, the Stripe routes answer 404, and
 * live evaluations are free, limited only by the per-session and daily caps.
 */
export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}
