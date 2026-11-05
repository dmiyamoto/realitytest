import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/evaluation/evaluator";
import { verdictFromTracking } from "@/lib/evaluation/pipeline";
import type { TrackingResult } from "@/lib/evaluation/types";
import { TRAY, obs, path } from "./helpers";

const OUT = { x: 230, y: 400 };
const IN = { x: 730, y: 400 };
const SHORT = { x: 470, y: 400 };

describe("verdict engine", () => {
  it("1. PASS: object moves from outside into the target", () => {
    const r = evaluate({ observations: path(100, OUT, IN), target: TRAY, totalFrameCount: 100 });
    expect(r.verdict).toBe("PASS");
    expect(r.reasonCode).toBe("PASS_ENTERED_TARGET");
    expect(r.decisiveFrames).toEqual([95, 96, 97, 98, 99]);
    expect(r.insideCountInFinalWindow).toBe(5);
    expect(r.firstOutsideFrame).toBe(0);
    expect(r.coverage).toBe(1);
    expect(r.trackedObjectId).toBe("0");
  });

  it("PASS requires only 3 of the last 5 inside", () => {
    const o = path(100, OUT, IN);
    o[96] = obs(96, SHORT);
    o[98] = obs(98, SHORT);
    const r = evaluate({ observations: o, target: TRAY, totalFrameCount: 100 });
    expect(r.verdict).toBe("PASS");
    expect(r.insideCountInFinalWindow).toBe(3);
  });

  it("2. FAIL: object remains visible outside the target", () => {
    const r = evaluate({ observations: path(100, OUT, SHORT), target: TRAY, totalFrameCount: 100 });
    expect(r.verdict).toBe("FAIL");
    expect(r.reasonCode).toBe("FAIL_OUTSIDE_TARGET");
    expect(r.decisiveFrames).toHaveLength(5);
  });

  it("INCONCLUSIVE when object was never outside (no movement into zone shown)", () => {
    const r = evaluate({ observations: path(100, IN, IN), target: TRAY, totalFrameCount: 100 });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.reasonCode).toBe("INC_NEVER_OBSERVED_OUTSIDE");
  });

  it("3. INCONCLUSIVE: object disappears before the final frames (occlusion)", () => {
    // tracked for frames 0..74 of 100 (75% coverage), then vanishes
    const r = evaluate({ observations: path(75, OUT, IN), target: TRAY, totalFrameCount: 100 });
    expect(r.coverage).toBeGreaterThanOrEqual(0.6);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.reasonCode).toBe("INC_MISSING_FINAL_OBSERVATIONS");
  });

  it("4. INCONCLUSIVE: no SAM detections", () => {
    const r = evaluate({ observations: [], target: TRAY, totalFrameCount: 100 });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.reasonCode).toBe("INC_NO_DETECTIONS");
  });

  it("5. INCONCLUSIVE: multiple ambiguous detections", () => {
    const a = path(100, OUT, IN, "0");
    const b = path(100, { x: 100, y: 450 }, { x: 120, y: 450 }, "3");
    const r = evaluate({ observations: [...a, ...b], target: TRAY, totalFrameCount: 100 });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.reasonCode).toBe("INC_AMBIGUOUS_OBJECTS");
    expect(r.objectSummary.map((s) => s.objectId).sort()).toEqual(["0", "3"]);
  });

  it("a brief spurious detection early on does not cause ambiguity", () => {
    const a = path(100, OUT, IN, "0");
    const blip = [obs(3, { x: 50, y: 50 }, "7"), obs(4, { x: 50, y: 50 }, "7")];
    const r = evaluate({ observations: [...a, ...blip], target: TRAY, totalFrameCount: 100 });
    expect(r.verdict).toBe("PASS");
    expect(r.trackedObjectId).toBe("0");
  });

  it("6. sparse / non-contiguous / out-of-order frames keep original indices", () => {
    // Every third frame, shuffled order (SAM 'both' propagation returns forward then backward).
    const all = path(120, OUT, IN).filter((o) => o.frameIndex % 3 === 0 || o.frameIndex > 110);
    const shuffled = [...all.filter((o) => o.frameIndex >= 60), ...all.filter((o) => o.frameIndex < 60).reverse()];
    const r = evaluate({ observations: shuffled, target: TRAY, totalFrameCount: 120, config: { coverageThreshold: 0.3 } });
    expect(r.verdict).toBe("PASS");
    expect(r.decisiveFrames).toEqual([115, 116, 117, 118, 119]);
    const idx = r.frames.map((f) => f.frameIndex);
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
    expect(idx).toContain(0);
    expect(idx).not.toContain(1);
  });

  it("INCONCLUSIVE: tracking coverage below configurable threshold (default 60%)", () => {
    const sparse = path(100, OUT, IN).filter((o) => o.frameIndex % 2 === 0 || o.frameIndex >= 95);
    const r = evaluate({ observations: sparse, target: TRAY, totalFrameCount: 100 });
    expect(r.coverage).toBeLessThan(0.6);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.reasonCode).toBe("INC_LOW_COVERAGE");
    const relaxed = evaluate({ observations: sparse, target: TRAY, totalFrameCount: 100, config: { coverageThreshold: 0.5 } });
    expect(relaxed.verdict).toBe("PASS");
  });

  it("INCONCLUSIVE: split final vote (2 inside / 2 outside)", () => {
    // Only 4 frames in the clip, all observed: out, in, out, in.
    const o = [obs(0, OUT), obs(1, IN), obs(2, SHORT), obs(3, IN)];
    const r = evaluate({ observations: o, target: TRAY, totalFrameCount: 4, config: { finalFramesMustStartAfter: 0 } });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.reasonCode).toBe("INC_SPLIT_FINAL_VOTE");
  });

  it("low-confidence detections are not usable", () => {
    const o = path(100, OUT, IN).map((x) => ({ ...x, confidence: 0.05 }));
    const r = evaluate({ observations: o, target: TRAY, totalFrameCount: 100 });
    expect(r.reasonCode).toBe("INC_NO_DETECTIONS");
  });

  it("9. an incomplete SAM stream is never turned into PASS/FAIL", () => {
    const tracking: TrackingResult = {
      provenance: "live",
      model: "sam-3.1",
      prompt: "red cube",
      streamOutcome: { status: "incomplete", reason: "eof" },
      observations: path(100, OUT, IN),
      diagnostics: [],
      requestedAt: "",
      completedAt: "",
    };
    const r = verdictFromTracking(tracking, TRAY, 100);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.reasonCode).toBe("INC_STREAM_INCOMPLETE");
  });

  it("always includes explicit 2D limitations", () => {
    const r = evaluate({ observations: path(100, OUT, IN), target: TRAY, totalFrameCount: 100 });
    expect(r.limitations.join(" ")).toMatch(/do not prove physical 3D containment/);
  });
});
