"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ZoneEditor } from "@/components/zone-editor";
import type { TargetZone } from "@/lib/evaluation/types";
import type { SampleClip } from "@/lib/samples";

interface SessionInfo {
  credits: number;
  freeRemaining: number;
  billingEnabled?: boolean;
  liveConfigured: boolean;
  fixtures: Record<string, string[]>;
}

const MAX_BYTES = 25 * 1024 * 1024;

export function EvaluateForm({ samples, initialSample }: { samples: SampleClip[]; initialSample?: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const first = samples.find((s) => s.id === initialSample) ?? samples[0];
  const [source, setSource] = useState<string>(first.id);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(first.suggestedPrompt);
  const [targetLabel, setTargetLabel] = useState(first.targetLabel);
  const [zone, setZone] = useState<TargetZone | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<"live" | "fixture">("live");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState<{ width: number; height: number; duration: number } | null>(null);
  const idemKey = useRef<string>("");

  const sample = samples.find((s) => s.id === source);
  const videoUrl = source === "upload" ? fileUrl : sample?.file ?? null;
  const fixturePrompts = useMemo(() => (sample ? session?.fixtures[sample.id] ?? [] : []), [sample, session]);
  const fixtureAvailable = fixturePrompts.some((p) => p.trim().toLowerCase() === prompt.trim().toLowerCase());

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((s: SessionInfo) => {
        setSession(s);
        if (!s.liveConfigured) setMode("fixture");
      })
      .catch(() => {});
  }, []);

  useEffect(
    () => () => {
      // Next keeps this page's state while it is hidden (cacheComponents).
      // When the user leaves for the results page, clear the in-flight state
      // so coming back shows a usable form and a fresh submission key.
      setBusy(false);
      setError(null);
      idemKey.current = crypto.randomUUID();
    },
    [],
  );

  useEffect(() => {
    // New submission whenever inputs change → new idempotency key.
    idemKey.current = crypto.randomUUID();
  }, [source, file, prompt, zone, mode, confirmed]);

  function selectSource(id: string) {
    setSource(id);
    setZone(null);
    setConfirmed(false);
    setError(null);
    const s = samples.find((x) => x.id === id);
    if (s) {
      setPrompt(s.suggestedPrompt);
      setTargetLabel(s.targetLabel);
    }
  }

  function onFile(f: File | null) {
    setError(null);
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (!f) {
      setFile(null);
      setFileUrl(null);
      return;
    }
    if (!/\.(mp4|mov|m4v)$/i.test(f.name)) {
      setError("Only MP4 or MOV files are supported.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("Video must be at most 25 MB.");
      return;
    }
    setFile(f);
    setFileUrl(URL.createObjectURL(f));
    setSource("upload");
    setZone(null);
    setConfirmed(false);
    setPrompt("");
    setTargetLabel("");
  }

  async function submit() {
    setError(null);
    if (!zone || !confirmed) return setError("Draw and confirm the target zone first.");
    if (source === "upload" && !file) return setError("Choose a video to upload.");
    if (clientInfo && clientInfo.duration > 12.05) return setError("Video must be at most 12 seconds.");
    setBusy(true);
    const fd = new FormData();
    fd.set("source", source);
    fd.set("objectPrompt", prompt);
    fd.set("targetLabel", targetLabel);
    fd.set("targetZone", JSON.stringify(zone));
    fd.set("mode", mode);
    fd.set("zoneConfirmed", String(confirmed));
    if (source === "upload" && file) fd.set("file", file);
    try {
      const res = await fetch("/api/evaluations", { method: "POST", body: fd, headers: { "Idempotency-Key": idemKey.current } });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message ?? "Could not start the evaluation.");
        setBusy(false);
        return;
      }
      router.push(`/evaluations/${body.id}`);
    } catch {
      setError("Network error. Your retry will reuse the same submission.");
      setBusy(false);
    }
  }

  const modeReady = mode === "live" ? !!session?.liveConfigured : fixtureAvailable;
  const checklist = [
    { done: source === "upload" ? !!file : !!sample, label: "1. Choose a video" },
    { done: prompt.trim().length >= 2, label: "2. Name the object (e.g. red cube)" },
    { done: !!zone, label: "3. Draw the target zone on the video" },
    { done: !!zone && confirmed, label: "3. Tick “I confirm this is the target zone”" },
    { done: modeReady, label: mode === "live" ? "Live SAM 3.1 is available" : "A recording exists for this clip + prompt" },
  ];
  const canRun = checklist.every((c) => c.done) && !busy;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="space-y-6">
        <Step n={1} title="Choose a video">
          <label
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-sm ${source === "upload" ? "border-accent bg-accent/5" : "border-line-2"}`}
          >
            <span>
              <span className="font-medium">Upload your own video</span>
              <span className="ml-2 text-xs text-muted">MP4/MOV · H.264/H.265 · ≤ 12 s · ≤ 25 MB</span>
              {file && <span className="ml-2 font-mono text-xs text-accent">{file.name}</span>}
            </span>
            <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" data-testid="upload-input" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            <span className="rounded-md border border-line px-2 py-1 text-xs text-muted">Browse…</span>
          </label>
          <p className="pt-1 text-xs text-muted">Or try an example (computer-generated clips, MIT):</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSource(s.id)}
                data-testid={`sample-${s.id}`}
                className={`rounded-lg border p-3 text-left transition ${source === s.id ? "border-accent bg-accent/5" : "border-line bg-panel hover:border-line-2"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{s.title}</span>
                  <span
                    className={`font-mono text-[10px] font-semibold ${s.expected === "PASS" ? "text-pass" : s.expected === "FAIL" ? "text-fail" : "text-inc"}`}
                  >
                    expect {s.expected}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">{s.description}</div>
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="Describe the moving object">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Object prompt (sent to SAM 3.1)" hint="Short noun phrase, e.g. “red cube”">
              <input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={60} data-testid="prompt-input" className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" placeholder="red cube" />
            </Field>
            <Field label="Target name (for the report)" hint="Not sent to the model">
              <input value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)} maxLength={60} className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" placeholder="blue tray" />
            </Field>
          </div>
        </Step>

        <Step n={3} title="Draw and confirm the target zone">
          {videoUrl ? (
            <ZoneEditor
              key={videoUrl}
              videoUrl={videoUrl}
              zone={zone}
              onChange={(z) => {
                setZone(z);
                setConfirmed(false);
              }}
              onVideoInfo={setClientInfo}
            />
          ) : (
            <div className="rounded-lg border border-line bg-panel p-8 text-center text-sm text-muted">Choose a video first.</div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {sample && (
              <button
                type="button"
                className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-fg"
                onClick={() => {
                  setZone({ shape: "rect", points: sample.suggestedZone });
                  setConfirmed(false);
                }}
                data-testid="use-suggested-zone"
              >
                Load the clip author’s tray outline (review before confirming)
              </button>
            )}
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirmed} disabled={!zone} onChange={(e) => setConfirmed(e.target.checked)} data-testid="confirm-zone" className="h-4 w-4 accent-[var(--accent)]" />
              I confirm this is the target zone
            </label>
          </div>
          <p className="text-xs text-muted">RealityTest never lets AI guess the target. The zone you confirm is used exactly as drawn, in source-video pixels.</p>
        </Step>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-xl border border-line bg-panel p-4">
          <h3 className="text-sm font-semibold">Run evaluation</h3>
          <div className="mt-3 space-y-2">
            <ModeOption
              active={mode === "live"}
              disabled={!session?.liveConfigured}
              onClick={() => setMode("live")}
              title="Live Meta SAM 3.1"
              desc={session?.liveConfigured ? "Real inference via the Meta Model API." : "Unavailable: MODEL_API_KEY is not configured on this server."}
              testId="mode-live"
            />
            <ModeOption
              active={mode === "fixture"}
              disabled={!fixtureAvailable}
              onClick={() => setMode("fixture")}
              title="Recorded API fixture"
              desc={
                fixtureAvailable
                  ? "Replays a recorded real SAM 3.1 response for this clip and prompt. Not live."
                  : "No recording exists for this clip + prompt."
              }
              testId="mode-fixture"
            />
          </div>
          <ol className="mt-4 space-y-1 text-xs" data-testid="run-checklist">
            {checklist.map((c, i) => (
              <li key={i} className={`flex gap-2 ${c.done ? "text-muted" : "text-fg"}`}>
                <span className={c.done ? "text-pass" : "text-inc"} aria-hidden>
                  {c.done ? "✓" : "○"}
                </span>
                <span className={c.done ? "line-through decoration-muted/50" : ""}>{c.label}</span>
              </li>
            ))}
          </ol>
          <dl className="mt-4 space-y-1 font-mono text-xs text-muted">
            <Row k="clip" v={source === "upload" ? file?.name ?? "—" : sample?.id ?? "—"} />
            <Row k="prompt" v={prompt || "—"} />
            <Row k="zone" v={zone ? `${zone.shape} · ${zone.points.length} pts${confirmed ? " · confirmed" : ""}` : "—"} />
            {session && <Row k={session.billingEnabled ? "free live runs left" : "live runs left"} v={String(session.freeRemaining)} />}
            {session?.billingEnabled && <Row k="credits" v={String(session.credits)} />}
          </dl>
          {error && (
            <p className="mt-3 rounded-md border border-fail/40 bg-fail/10 p-2 text-xs text-fail" data-testid="form-error">
              {error}
              {session?.billingEnabled && /credit/i.test(error) && (
                <>
                  {" "}
                  <Link href="/pricing" className="underline">
                    Get credits
                  </Link>
                </>
              )}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canRun}
            data-testid="run-evaluation"
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Submitting…" : "Run evaluation"}
          </button>
          <p className="mt-2 text-center text-xs text-muted">
            {canRun ? "Ready. Results open on the next page with video playback and overlays." : `Next: ${checklist.find((c) => !c.done)?.label.replace(/^\d\. /, "") ?? "…"}`}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-panel p-4 text-xs leading-relaxed text-muted">
          <p className="font-semibold text-fg">How the verdict is computed</p>
          <p className="mt-1">SAM 3.1 tracks the object and returns a mask per frame. A deterministic engine computes each mask centroid and checks it against your polygon. PASS needs ≥3 of the last 5 observations inside, after being seen outside, with ≥60% tracking coverage. Anything unclear is INCONCLUSIVE.</p>
        </div>
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-3 text-base font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line-2 font-mono text-xs text-muted">{n}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted/70">{hint}</span>}
    </label>
  );
}

function ModeOption(p: { active: boolean; disabled: boolean; onClick: () => void; title: string; desc: string; testId: string }) {
  return (
    <button
      type="button"
      disabled={p.disabled}
      onClick={p.onClick}
      data-testid={p.testId}
      className={`w-full rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${p.active && !p.disabled ? "border-sam bg-sam/5" : "border-line"}`}
    >
      <div className="text-sm font-medium">{p.title}</div>
      <div className="mt-0.5 text-xs text-muted">{p.desc}</div>
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="truncate text-fg">{v}</dd>
    </div>
  );
}
