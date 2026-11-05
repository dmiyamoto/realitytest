import Link from "next/link";
import { GITHUB_URL } from "@/lib/site";
import { SAMPLES } from "@/lib/samples";
import { VerdictBadge } from "@/components/verdict";
import { BillingGate } from "@/components/billing-gate";

export default function Home() {
  const pass = SAMPLES.find((s) => s.id === "synthetic-pass")!;
  const fail = SAMPLES.find((s) => s.id === "synthetic-fail")!;
  return (
    <div>
      {/* HERO */}
      <section className="grid-bg relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel px-3 py-1 font-mono text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-sam" /> Powered by Meta SAM 3.1 · open source (MIT)
            </p>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Unit tests for the
              <br />
              <span className="text-accent">physical world.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
              Upload a short video of a robot doing a task. RealityTest tracks the object with Meta SAM 3.1 and a deterministic geometry engine returns{" "}
              <span className="font-mono text-pass">PASS</span>, <span className="font-mono text-fail">FAIL</span> or{" "}
              <span className="font-mono text-inc">INCONCLUSIVE</span>, with the frames that prove it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/evaluate" className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-black hover:brightness-110" data-testid="hero-try-demo">
                Try the demo →
              </Link>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="rounded-lg border border-line-2 bg-panel px-5 py-3 text-sm font-semibold hover:bg-panel-2">
                ★ Star on GitHub
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="scanline relative overflow-hidden rounded-xl border border-line-2 bg-black shadow-2xl">
              <video src={pass.file} autoPlay muted loop playsInline className="aspect-video w-full object-contain" />
            </div>
            <div className="relative -mt-8 ml-auto w-[92%] rounded-xl border border-line-2 bg-panel/95 p-4 font-mono text-xs shadow-xl backdrop-blur">
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
                <span>example report format</span>
                <span>realitytest</span>
              </div>
              <p>
                <span className="text-muted">task </span>“red cube” ends inside “blue tray”
              </p>
              <p>
                <span className="text-muted">tracking </span>Meta SAM 3.1 · coverage ≥ 60%
              </p>
              <p>
                <span className="text-muted">rule </span>≥ 3 of last 5 centroids in zone, seen outside earlier
              </p>
              <div className="mt-3 flex items-center gap-3">
                <VerdictBadge verdict="PASS" size="sm" />
                <VerdictBadge verdict="FAIL" size="sm" />
                <VerdictBadge verdict="INCONCLUSIVE" size="sm" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">From video to verdict in three steps</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["01", "Track", "Meta SAM 3.1 follows the object you name (“red cube”) through every frame and returns a box and a pixel mask for each one, with stable object IDs."],
            ["02", "Measure", "A deterministic engine decodes each mask, computes its centroid, and tests it against the target polygon you drew. No LLM judgement is involved."],
            ["03", "Decide", "PASS, FAIL or INCONCLUSIVE, with the decisive frames, the movement trail, tracking coverage and the limits of the evidence."],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-xl border border-line bg-panel p-5">
              <p className="font-mono text-xs text-accent">{n}</p>
              <p className="mt-2 text-lg font-semibold">{t}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* DEMOS */}
      <section className="border-y border-line bg-panel/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">A pass and a fail</h2>
              <p className="mt-2 max-w-xl text-sm text-muted">
                Two clearly labelled synthetic clips. Run either one through live Meta SAM 3.1 and inspect the evidence yourself.
              </p>
            </div>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {[
              { s: pass, v: "PASS" as const, t: "Cube placed in the tray" },
              { s: fail, v: "FAIL" as const, t: "Cube dropped short of the tray" },
            ].map(({ s, v, t }) => (
              <div key={s.id} className="overflow-hidden rounded-xl border border-line bg-panel">
                <video src={s.file} autoPlay muted loop playsInline className="aspect-video w-full bg-black object-contain" />
                <div className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{t}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Expected verdict: <span style={{ color: v === "PASS" ? "var(--pass)" : "var(--fail)" }}>{v}</span> · synthetic clip
                    </p>
                  </div>
                  <Link href={`/evaluate?sample=${s.id}`} className="shrink-0 rounded-md border border-line-2 px-3 py-1.5 text-sm hover:bg-panel-2" data-testid={`demo-${s.id}`}>
                    Evaluate →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRINCIPLES */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Honest by design</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              A test is only useful if it can say “I don’t know.” RealityTest returns INCONCLUSIVE when SAM finds nothing, finds several candidates, loses the object, when
              the final frames are missing, or when the API fails. Errors are never turned into a PASS or FAIL.
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {[
                "Every overlay shows real Meta SAM 3.1 output, labelled Live or Recorded fixture",
                "You confirm the target zone. AI never guesses it",
                "Original frame indices and object IDs are kept for audit",
                "2D image evidence only. Not 3D proof or a safety certification",
              ].map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="text-accent">→</span>
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-panel p-5 font-mono text-xs leading-relaxed">
            <p className="text-muted"># verdict rules (deterministic)</p>
            <p>
              <span className="text-pass">PASS</span> ≥3/5 final centroids inside ∧ seen outside earlier ∧ coverage ≥ 60% ∧ single object
            </p>
            <p>
              <span className="text-fail">FAIL</span> ≥3/5 final centroids visibly outside ∧ object still observed
            </p>
            <p>
              <span className="text-inc">INCONCLUSIVE</span> no detection · ambiguous objects · low coverage · object lost at the end · API error
            </p>
            <p className="mt-4 text-muted"># open source</p>
            <p>git clone {GITHUB_URL.replace("https://", "")}</p>
            <p>docker compose up</p>
          </div>
        </div>
      </section>

      {/* PRICING TEASER (only when Stripe billing is enabled) */}
      <BillingGate
        on={
          <section className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-14 sm:flex-row sm:items-center sm:px-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Free to self-host. $9 for 20 hosted evaluations.</h2>
                <p className="mt-1 text-sm text-muted">MIT licensed. Hosted credits run on Stripe Checkout (test mode for this demo).</p>
              </div>
              <div className="flex gap-3">
                <Link href="/pricing" className="rounded-lg border border-line-2 px-5 py-3 text-sm font-semibold hover:bg-panel-2">
                  See pricing
                </Link>
                <Link href="/evaluate" className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-black hover:brightness-110">
                  Try demo
                </Link>
              </div>
            </div>
          </section>
        }
        off={
          <section className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-14 sm:flex-row sm:items-center sm:px-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Free and open source.</h2>
                <p className="mt-1 text-sm text-muted">MIT licensed. Self-host it with your own Meta Model API key.</p>
              </div>
              <div className="flex gap-3">
                <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="rounded-lg border border-line-2 px-5 py-3 text-sm font-semibold hover:bg-panel-2">
                  View on GitHub
                </a>
                <Link href="/evaluate" className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-black hover:brightness-110">
                  Try demo
                </Link>
              </div>
            </div>
          </section>
        }
      />
    </div>
  );
}
