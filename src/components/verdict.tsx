import type { Verdict } from "@/lib/evaluation/types";

const STYLES: Record<Verdict, { color: string; label: string; icon: string }> = {
  PASS: { color: "var(--pass)", label: "PASS", icon: "✓" },
  FAIL: { color: "var(--fail)", label: "FAIL", icon: "✕" },
  INCONCLUSIVE: { color: "var(--inc)", label: "INCONCLUSIVE", icon: "?" },
};

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" | "lg" }) {
  const s = STYLES[verdict];
  const cls =
    size === "lg" ? `${verdict === "INCONCLUSIVE" ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl"} px-4 py-2 gap-3 max-w-full` : size === "sm" ? "text-xs px-2 py-0.5 gap-1.5" : "text-sm px-3 py-1 gap-2";
  return (
    <span
      data-testid="verdict"
      data-verdict={verdict}
      className={`inline-flex items-center rounded-md border font-mono font-bold tracking-wider ${cls}`}
      style={{ color: s.color, borderColor: s.color, background: `color-mix(in srgb, ${s.color} 12%, transparent)` }}
    >
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

export function ProvenanceBadge({ provenance }: { provenance: string | null }) {
  if (provenance === "live") {
    return (
      <span data-testid="provenance" className="inline-flex items-center gap-1.5 rounded-md border border-sam/50 bg-sam/10 px-2 py-0.5 font-mono text-xs text-sam">
        <span className="h-1.5 w-1.5 rounded-full bg-sam" /> Live Meta SAM 3.1
      </span>
    );
  }
  if (provenance === "fixture") {
    return (
      <span data-testid="provenance" className="inline-flex items-center gap-1.5 rounded-md border border-line-2 bg-panel-2 px-2 py-0.5 font-mono text-xs text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted" /> Recorded API fixture
      </span>
    );
  }
  if (provenance === "test") {
    return (
      <span data-testid="provenance" className="inline-flex items-center gap-1.5 rounded-md border border-inc/50 bg-inc/10 px-2 py-0.5 font-mono text-xs text-inc">
        Synthetic test data — not model output
      </span>
    );
  }
  return null;
}
