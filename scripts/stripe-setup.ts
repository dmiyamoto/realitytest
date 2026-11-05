/**
 * Create the "20 evaluation credits — $9" product + price in Stripe TEST mode.
 *   pnpm stripe:setup
 * Prints the price ID to put in STRIPE_PRICE_ID_PACK20. Refuses live keys.
 */
import fs from "node:fs";
import Stripe from "stripe";

for (const f of [".env.local", ".env"]) if (fs.existsSync(f)) process.loadEnvFile(f);

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set (.env.local).");
  process.exit(2);
}
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("Refusing: this script only runs with Stripe TEST keys.");
  process.exit(2);
}
async function main(key: string) {
const stripe = new Stripe(key);
const existing = await stripe.prices.search({ query: "lookup_key:'realitytest_pack20'" }).catch(() => null);
if (existing?.data[0]) {
  console.log(`STRIPE_PRICE_ID_PACK20=${existing.data[0].id}  (already exists)`);
  return;
}
const product = await stripe.products.create({ name: "RealityTest — 20 evaluation credits", metadata: { app: "realitytest" } });
const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 900, lookup_key: "realitytest_pack20" });
console.log(`STRIPE_PRICE_ID_PACK20=${price.id}`);
}

void main(key);
