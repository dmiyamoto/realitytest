// Unit tests must never hit real external services.
delete process.env.MODEL_API_KEY;
// Most unit tests exercise billing; tests for the OFF default flip this locally.
process.env.BILLING_ENABLED = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_unit_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_test_secret";
process.env.STRIPE_PRICE_ID_PACK20 = "price_unit_pack20";
process.env.SESSION_SECRET = "unit-test-session-secret-unit-test-session-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
