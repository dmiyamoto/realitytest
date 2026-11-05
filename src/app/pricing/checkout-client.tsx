"use client";

import { useEffect, useState } from "react";

export function CheckoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        data-testid="buy-credits"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await fetch("/api/checkout", { method: "POST" });
            const b = await r.json();
            if (!r.ok || !b.url) throw new Error(b.error?.message ?? "Checkout unavailable");
            window.location.href = b.url;
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50"
      >
        {busy ? "Opening Stripe Checkout…" : "Buy 20 credits — $9 (test mode)"}
      </button>
      {error && (
        <p className="mt-2 text-xs text-fail" data-testid="checkout-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Shown after returning from Stripe. It only DISPLAYS state: credits are
 * granted exclusively by the verified webhook, so we poll the server.
 */
export function CheckoutStatus({ status, checkoutId }: { status: "success" | "cancelled"; checkoutId: string | null }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "success") return;
    let n = 0;
    const tick = async () => {
      const r = await fetch(`/api/session${checkoutId ? `?checkout=${encodeURIComponent(checkoutId)}` : ""}`, { cache: "no-store" });
      const b = await r.json();
      setCredits(b.credits);
      setState(b.checkout?.status ?? null);
      return b.checkout?.status;
    };
    void tick();
    const t = setInterval(async () => {
      n++;
      const s = await tick().catch(() => null);
      if (s === "paid" || s === "failed" || n > 60) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [status, checkoutId]);

  if (status === "cancelled") {
    return (
      <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-line bg-panel p-4 text-sm" data-testid="checkout-cancelled">
        Checkout was cancelled. No payment was taken and no credits were added.
      </div>
    );
  }
  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-sam/40 bg-sam/5 p-4 text-sm" data-testid="checkout-success">
      {state === "paid" ? (
        <p>
          Payment confirmed by Stripe webhook. Balance: <strong className="font-mono">{credits}</strong> credits.
        </p>
      ) : state === "awaiting_payment" ? (
        <p>Payment is processing (asynchronous method). Credits will be added when Stripe confirms it.</p>
      ) : state === "failed" ? (
        <p className="text-fail">The payment failed. No credits were added.</p>
      ) : (
        <p>Waiting for Stripe’s signed webhook to confirm payment… Credits are never added just because you reached this page.</p>
      )}
    </div>
  );
}
