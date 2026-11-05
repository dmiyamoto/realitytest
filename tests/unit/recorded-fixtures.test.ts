/**
 * Recorded outputs of REAL Meta SAM 3.1 calls (fixtures/recorded/*.json),
 * replayed through @meta-sam/parser and the evaluator.
 */
import { describe, expect, it } from "vitest";
import { fixtureExists, loadFixture } from "@/lib/server/fixtures";
import { replayRawOutput } from "@/lib/meta/normalizer";
import { verdictFromTracking } from "@/lib/evaluation/pipeline";
import { SAMPLES } from "@/lib/samples";

const cases = [
  { sample: "synthetic-pass", verdict: "PASS", reason: "PASS_ENTERED_TARGET" },
  { sample: "synthetic-fail", verdict: "FAIL", reason: "FAIL_OUTSIDE_TARGET" },
  { sample: "synthetic-occluded", verdict: "INCONCLUSIVE", reason: "INC_MISSING_FINAL_OBSERVATIONS" },
] as const;

describe("recorded Meta SAM 3.1 fixtures", () => {
  for (const c of cases) {
    it.runIf(fixtureExists(c.sample, "red cube"))(`${c.sample} → ${c.verdict}`, async () => {
      const fx = loadFixture(c.sample, "red cube");
      const tracking = await replayRawOutput(fx.rawOutput, { model: fx.model, prompt: fx.prompt, requestedAt: fx.recordedAt });
      expect(tracking.provenance).toBe("fixture");
      const zone = { shape: "rect" as const, points: SAMPLES.find((s) => s.id === c.sample)!.suggestedZone };
      const result = verdictFromTracking(tracking, zone, fx.videoInfo!.frameCount);
      expect(result.verdict).toBe(c.verdict);
      expect(result.reasonCode).toBe(c.reason);
    });
  }
});
