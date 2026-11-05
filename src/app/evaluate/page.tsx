import { Suspense } from "react";
import type { Metadata } from "next";
import { SAMPLES } from "@/lib/samples";
import { EvaluateForm } from "./evaluate-form";

export const metadata: Metadata = { title: "Evaluate — RealityTest" };

export default function EvaluatePage({ searchParams }: PageProps<"/evaluate">) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">New evaluation</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Did the object end up in the target?</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Task: <span className="text-fg">move a visible object into a designated target region.</span> Pick a clip, name the object, draw the target, and RealityTest returns PASS, FAIL or INCONCLUSIVE with frame-level evidence.
        </p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-panel" />}>
        <FormWithParams searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FormWithParams({ searchParams }: Pick<PageProps<"/evaluate">, "searchParams">) {
  const sp = await searchParams;
  const sample = typeof sp.sample === "string" ? sp.sample : undefined;
  return <EvaluateForm samples={SAMPLES} initialSample={sample} />;
}
