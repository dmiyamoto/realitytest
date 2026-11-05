import { Suspense } from "react";
import { connection } from "next/server";
import { billingEnabled } from "@/lib/billing/flag";

/**
 * Renders `on` when BILLING_ENABLED=true at request time, otherwise `off`.
 * Read per request (not at build time), so one image serves both settings.
 */
export function BillingGate({ on, off = null }: { on: React.ReactNode; off?: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Gate on={on} off={off} />
    </Suspense>
  );
}

async function Gate({ on, off }: { on: React.ReactNode; off: React.ReactNode }) {
  await connection();
  return <>{billingEnabled() ? on : off}</>;
}
