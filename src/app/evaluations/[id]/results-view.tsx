"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EvidencePlayer } from "@/components/evidence-player";
import { ProvenanceBadge, VerdictBadge } from "@/components/verdict";
import type { PublicJob } from "@/lib/server/jobs";
import type { FrameEvaluation, Verdict } from "@/lib/evaluation/types";

export function ResultsView({ initial }: { initial: PublicJob }) {
  const [job, setJob] = useState<PublicJob>(initial);
  const active = job.status === "pending" || job.status === "running";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/evaluations/${job.id}`, { cache: "no-store" });
        if (r.ok) setJob(await r.json());
      } catch {
        /* keep polling */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [active, job.id]);

  const result = job.result;
  const tracking = job.tracking;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">
            evaluation <span className="text-fg">{job.id}</span>
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            “{job.objectPrompt}” ends inside {job.targetLabel ? `“${job.targetLabel}”` : "the target zone"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {job.videoName} · {job.videoInfo.width}×{job.videoInfo.height} · {job.videoInfo.fps.toFixed(0)} fps · {job.videoInfo.frameCount} frames ·{" "}
            {job.videoInfo.durationSec.toFixed(1)} s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProvenanceBadge provenance={job.provenance ?? (job.mode === "fixture" ? "fixture" : null)} />
          <Link href="/evaluate" className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-fg">
            New evaluation
          </Link>
        </div>
      </div>

      {active && <Progress job={job} />}
      {job.status === "failed" && (
        <div className="rounded-xl border border-fail/40 bg-fail/10 p-4 text-sm" data-testid="job-failed">
          <p className="font-semibold text-fail">The evaluation could not be completed.</p>
          <p className="mt-1 text-muted">{job.error ?? "Unknown error."} No verdict was produced.</p>
        </div>
      )}

      {result && (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <EvidencePlayer videoUrl={job.videoUrl} videoInfo={job.videoInfo} zone={job.targetZone} observations={tracking?.observations ?? []} result={result} />
            <DecisiveFrames frames={result.frames.filter((f) => result.decisiveFrames.includes(f.frameIndex))} />
          </div>
          <aside className="space-y-4">
            <div className="rounded-xl border border-line bg-panel p-5" data-testid="verdict-card">
              <VerdictBadge verdict={result.verdict as Verdict} size="lg" />
              <p className="mt-4 text-sm leading-relaxed" data-testid="verdict-reason">
                {result.reason}
              </p>
              <p className="mt-2 font-mono text-[11px] text-muted">{result.reasonCode}</p>
              {job.errorCode && <p className="mt-2 font-mono text-[11px] text-inc">api error: {job.errorCode}</p>}
            </div>
            <Diagnostics job={job} />
            <div className="rounded-xl border border-inc/30 bg-inc/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-inc">Confidence limitations</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted" data-testid="limitations">
                {result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Progress({ job }: { job: PublicJob }) {
  return (
    <div className="rounded-xl border border-sam/30 bg-panel p-5" data-testid="progress">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sam" />
          {job.status === "pending" ? "Queued — waiting for a worker" : job.progressMessage ?? "Processing"}
        </span>
        <span className="font-mono text-xs text-muted">{job.progress}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-sam transition-all duration-700" style={{ width: `${Math.max(3, job.progress)}%` }} />
      </div>
      <p className="mt-3 text-xs text-muted">
        {job.mode === "live" ? "Live Meta SAM 3.1 tracks the object across every frame; this usually takes under a minute for a short clip." : "Replaying a recorded Meta SAM 3.1 API response."}
      </p>
    </div>
  );
}

function Diagnostics({ job }: { job: PublicJob }) {
  const r = job.result!;
  const t = job.tracking;
  const rows: [string, string][] = [
    ["model", t?.model ?? "sam-3.1"],
    ["provenance", job.provenance === "live" ? "Live Meta SAM 3.1" : job.provenance === "fixture" ? "Recorded API fixture" : job.provenance === "test" ? "Synthetic test data (not model output)" : "—"],
    ["tracked object id", r.trackedObjectId ?? "—"],
    ["tracking coverage", `${(r.coverage * 100).toFixed(1)}% (${r.observedFrameCount}/${r.totalFrameCount} frames, min ${(r.config.coverageThreshold * 100).toFixed(0)}%)`],
    ["final window", r.decisiveFrames.length ? `frames ${r.decisiveFrames.join(", ")}` : "—"],
    ["inside in final window", `${r.insideCountInFinalWindow}/${r.decisiveFrames.length}`],
    ["first observed outside", r.firstOutsideFrame === null ? "—" : `frame ${r.firstOutsideFrame}`],
    ["objects reported", r.objectSummary.map((o) => `id ${o.objectId}: ${o.frames}f`).join(", ") || "none"],
    ["stream outcome", t?.streamOutcome.status ?? "—"],
    ["parser diagnostics", String(t?.diagnostics.length ?? 0)],
    ["target zone", `${job.targetZone.shape}, ${job.targetZone.points.length} pts (source px)`],
  ];
  return (
    <div className="rounded-xl border border-line bg-panel p-4" data-testid="diagnostics">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Diagnostics</p>
      <dl className="mt-2 space-y-1.5 font-mono text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="shrink-0 text-muted">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {t && t.diagnostics.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-inc">
          {t.diagnostics.slice(0, 5).map((d, i) => (
            <li key={i}>
              {d.code}: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DecisiveFrames({ frames }: { frames: FrameEvaluation[] }) {
  if (!frames.length) return null;
  return (
    <div className="rounded-xl border border-line bg-panel p-4" data-testid="decisive-frames">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Decisive frames (last {frames.length} usable observations)</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="text-muted">
            <tr className="text-left">
              <th className="py-1 pr-3 font-normal">frame</th>
              <th className="py-1 pr-3 font-normal">object</th>
              <th className="py-1 pr-3 font-normal">centroid (src px)</th>
              <th className="py-1 pr-3 font-normal">source</th>
              <th className="py-1 font-normal">in zone</th>
            </tr>
          </thead>
          <tbody>
            {frames.map((f) => (
              <tr key={f.frameIndex} className="border-t border-line">
                <td className="py-1 pr-3">{f.frameIndex}</td>
                <td className="py-1 pr-3">{f.objectId}</td>
                <td className="py-1 pr-3">
                  ({f.centroid.x.toFixed(1)}, {f.centroid.y.toFixed(1)})
                </td>
                <td className="py-1 pr-3">{f.centroidSource}</td>
                <td className="py-1" style={{ color: f.inside ? "var(--pass)" : "var(--fail)" }}>
                  {f.inside ? "inside" : "outside"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
