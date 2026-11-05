import { Suspense } from "react";
import type { Metadata } from "next";
import { GITHUB_URL } from "@/lib/site";
import { CheckoutButton, CheckoutStatus } from "./checkout-client";
import { BillingGate } from "@/components/billing-gate";

export const metadata: Metadata = { title: "Pricing — RealityTest" };

export default function PricingPage(props: PageProps<"/pricing">) {
  return <BillingGate on={<Pricing {...props} />} off={<BillingOff />} />;
}

function BillingOff() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6" data-testid="billing-disabled">
      <p className="font-mono text-xs uppercase tracking-widest text-accent">Pricing</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Billing is turned off</h1>
      <p className="mt-3 text-sm text-muted">
        This server runs RealityTest free of charge. It is MIT licensed: self-host it with your own Meta Model API key.
      </p>
      <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="mt-6 inline-block rounded-lg border border-line-2 px-5 py-2.5 text-sm font-semibold hover:bg-panel-2">
        View on GitHub
      </a>
    </div>
  );
}

function Pricing({ searchParams }: PageProps<"/pricing">) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Pricing</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Open source first. Pay only for hosted runs.</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted">Self-host RealityTest for free with your own Meta Model API key, or buy credits for hosted evaluations.</p>
      </div>

      <Suspense fallback={null}>
        <StatusFromParams searchParams={searchParams} />
      </Suspense>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Plan
          name="Self-hosted"
          price="Free"
          per="MIT license"
          features={["Full source code on GitHub", "Docker + docker-compose", "Bring your own MODEL_API_KEY", "Unlimited local evaluations", "Deterministic, auditable verdict engine"]}
          cta={
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="block w-full rounded-lg border border-line-2 px-4 py-2.5 text-center text-sm font-semibold hover:bg-panel-2">
              View on GitHub
            </a>
          }
        />
        <Plan
          highlight
          name="Hosted credits"
          price="$9"
          per="20 evaluation credits"
          features={["2 free live runs per session to try it", "1 credit = 1 live Meta SAM 3.1 evaluation", "API failures are refunded automatically", "Frame-level evidence + diagnostics", "Stripe Checkout (TEST MODE)"]}
          cta={<CheckoutButton />}
        />
      </div>

      <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-inc/30 bg-inc/5 p-4 text-xs leading-relaxed text-muted">
        <strong className="text-inc">Test mode only.</strong> Checkout runs against Stripe TEST keys. Use card <span className="font-mono text-fg">4242 4242 4242 4242</span>, any future
        date and any CVC. No real money is charged. Credits are granted only after Stripe’s signed webhook confirms payment. Guest sessions are cookie-based and not suitable for real paid accounts.
      </div>
    </div>
  );
}

async function StatusFromParams({ searchParams }: Pick<PageProps<"/pricing">, "searchParams">) {
  const sp = await searchParams;
  const status = typeof sp.checkout === "string" ? sp.checkout : null;
  const cs = typeof sp.cs === "string" ? sp.cs : null;
  if (status !== "success" && status !== "cancelled") return null;
  return <CheckoutStatus status={status} checkoutId={cs} />;
}

function Plan(p: { name: string; price: string; per: string; features: string[]; cta: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`flex flex-col rounded-2xl border p-6 ${p.highlight ? "border-accent/60 bg-panel glow-accent" : "border-line bg-panel"}`}>
      <p className="text-sm font-medium text-muted">{p.name}</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight">
        {p.price} <span className="text-sm font-normal text-muted">{p.per}</span>
      </p>
      <ul className="mt-6 flex-1 space-y-2 text-sm">
        {p.features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="text-accent">✓</span>
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-6">{p.cta}</div>
    </div>
  );
}
