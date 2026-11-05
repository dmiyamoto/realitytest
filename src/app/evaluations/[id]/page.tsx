import { Suspense } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/server/session";
import { getJobForSession, toPublicJob } from "@/lib/server/jobs";
import { ResultsView } from "./results-view";

export const metadata: Metadata = { title: "Evaluation result — RealityTest" };

export default function EvaluationPage({ params }: PageProps<"/evaluations/[id]">) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Suspense fallback={<div className="h-[480px] animate-pulse rounded-xl bg-panel" />}>
        <Loader params={params} />
      </Suspense>
    </div>
  );
}

async function Loader({ params }: Pick<PageProps<"/evaluations/[id]">, "params">) {
  const { id } = await params;
  const store = await cookies();
  const sessionId = verifySessionCookie(store.get(SESSION_COOKIE)?.value);
  const job = await getJobForSession(id, sessionId);
  // Private: other sessions get a 404, indistinguishable from a missing job.
  if (!job) notFound();
  return <ResultsView initial={toPublicJob(job)} />;
}
