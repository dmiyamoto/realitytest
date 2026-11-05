import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const E2E_DB = path.resolve("data/e2e.db");

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: `file:${E2E_DB}`,
      STORAGE_DIR: path.resolve("data/e2e-storage"),
      SESSION_SECRET: "e2e-session-secret-e2e-session-secret-0123",
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      // Deliberately unset: E2E must never call real external services.
      MODEL_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_PRICE_ID_PACK20: "",
      // Billing stays OFF (the default); Stripe behaviour is covered by unit tests.
      BILLING_ENABLED: "",
    },
  },
});
