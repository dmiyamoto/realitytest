/**
 * Deterministic verdict engine for "move a visible object into a target zone".
 *
 * Input: normalized SAM 3.1 observations + user-confirmed target polygon.
 * Output: PASS / FAIL / INCONCLUSIVE with the geometry that justifies it.
 *
 * This engine evaluates 2D image-plane overlap of the object's mask centroid
 * with a user-drawn polygon. It does NOT prove 3D containment or contact.
 */
import { pointInPolygon } from "./geometry";
import {
  DEFAULT_EVALUATION_CONFIG,
  type EvaluationConfig,
  type EvaluationResult,
  type FrameEvaluation,
  type Observation,
  type ReasonCode,
  type TargetZone,
  type Verdict,
} from "./types";

export const STANDING_LIMITATIONS = [
  "Verdicts are based on 2D image-plane geometry (mask centroid inside a user-drawn polygon). They do not prove physical 3D containment, contact, or stability.",
  "Results depend on Meta SAM 3.1 tracking quality for the given prompt; masks can be imperfect at edges, under motion blur, or during occlusion.",
  "The target zone is defined by the user and is assumed to be correct and static for the whole clip.",
  "RealityTest is an evaluation aid, not a safety certification.",
];

export interface EvaluateInput {
  observations: Observation[];
  target: TargetZone;
  totalFrameCount: number;
  config?: Partial<EvaluationConfig>;
}

export function evaluate(input: EvaluateInput): EvaluationResult {
  const config: EvaluationConfig = { ...DEFAULT_EVALUATION_CONFIG, ...input.config };
  const { target, totalFrameCount } = input;
  const limitations = [...STANDING_LIMITATIONS];

  const base = (
    verdict: Verdict,
    reasonCode: ReasonCode,
    reason: string,
    extra: Partial<EvaluationResult> = {},
  ): EvaluationResult => ({
    verdict,
    reasonCode,
    reason,
    trackedObjectId: null,
    coverage: 0,
    observedFrameCount: 0,
    totalFrameCount,
    frames: [],
    decisiveFrames: [],
    insideCountInFinalWindow: 0,
    firstOutsideFrame: null,
    objectSummary: [],
    limitations,
    config,
    ...extra,
  });

  if (target.points.length < 3 || totalFrameCount <= 0) {
    return base("INCONCLUSIVE", "INC_INVALID_INPUT", "The target zone or video metadata is invalid.");
  }

  // Usable = valid frame index, finite centroid, confidence (if present) high enough.
  const usable = input.observations.filter(
    (o) =>
      Number.isInteger(o.frameIndex) &&
      o.frameIndex >= 0 &&
      Number.isFinite(o.centroid.x) &&
      Number.isFinite(o.centroid.y) &&
      (o.confidence === undefined || o.confidence >= config.minConfidence),
  );

  // Per-object frame counts (distinct frames).
  const framesByObject = new Map<string, Map<number, Observation>>();
  for (const o of usable) {
    let m = framesByObject.get(o.objectId);
    if (!m) framesByObject.set(o.objectId, (m = new Map()));
    // If SAM somehow emitted the same object twice in a frame, keep the larger mask.
    const prev = m.get(o.frameIndex);
    if (!prev || (o.maskArea ?? 0) > (prev.maskArea ?? 0)) m.set(o.frameIndex, o);
  }
  const objectSummary = [...framesByObject.entries()]
    .map(([objectId, m]) => ({ objectId, frames: m.size }))
    .sort((a, b) => b.frames - a.frames || a.objectId.localeCompare(b.objectId));

  if (objectSummary.length === 0) {
    return base(
      "INCONCLUSIVE",
      "INC_NO_DETECTIONS",
      "Meta SAM 3.1 did not detect any object matching the prompt, so there is nothing to evaluate.",
      { objectSummary },
    );
  }

  // Ambiguity: more than one object tracked for a substantial part of the clip.
  // A secondary track counts as a competitor if it is present in ≥ 50% of the
  // primary's frames, or co-occurs with the primary in any of the final frames.
  const primary = objectSummary[0];
  const primaryFrames = framesByObject.get(primary.objectId)!;
  const primarySorted = [...primaryFrames.keys()].sort((a, b) => a - b);
  const primaryFinal = new Set(primarySorted.slice(-config.finalWindow));
  const competitors = objectSummary.slice(1).filter((s) => {
    const m = framesByObject.get(s.objectId)!;
    const coOccursAtEnd = [...m.keys()].some((f) => primaryFinal.has(f));
    return s.frames >= primary.frames * 0.5 || coOccursAtEnd;
  });
  if (competitors.length > 0) {
    return base(
      "INCONCLUSIVE",
      "INC_AMBIGUOUS_OBJECTS",
      `Meta SAM 3.1 tracked ${competitors.length + 1} distinct objects matching the prompt (IDs ${[primary, ...competitors]
        .map((c) => c.objectId)
        .join(", ")}). RealityTest cannot tell which one is the task object. Use a more specific prompt.`,
      { objectSummary },
    );
  }

  // Build per-frame geometry for the tracked object.
  const frames: FrameEvaluation[] = primarySorted.map((frameIndex) => {
    const o = primaryFrames.get(frameIndex)!;
    return {
      frameIndex,
      objectId: o.objectId,
      centroid: o.centroid,
      centroidSource: o.centroidSource,
      inside: pointInPolygon(o.centroid, target.points),
      box: o.box,
    };
  });
  if (frames.some((f) => f.centroidSource === "box")) {
    limitations.push("Some masks could not be decoded; the bounding-box centre was used for those frames.");
  }

  const coverage = Math.min(1, frames.length / totalFrameCount);
  const common = {
    trackedObjectId: primary.objectId,
    coverage,
    observedFrameCount: frames.length,
    frames,
    objectSummary,
  };

  if (coverage < config.coverageThreshold) {
    return base(
      "INCONCLUSIVE",
      "INC_LOW_COVERAGE",
      `The object was tracked in only ${pct(coverage)} of frames (minimum ${pct(config.coverageThreshold)}). The evidence is too sparse for a reliable conclusion.`,
      common,
    );
  }

  const finalWindow = frames.slice(-config.finalWindow);
  const decisiveFrames = finalWindow.map((f) => f.frameIndex);
  const lastFrameIndex = totalFrameCount - 1;
  const lateStart = Math.floor(lastFrameIndex * config.finalFramesMustStartAfter);
  const lateFinal = finalWindow.filter((f) => f.frameIndex >= lateStart);

  const insideCount = finalWindow.filter((f) => f.inside).length;
  const outsideCount = finalWindow.length - insideCount;
  const firstOutside = frames.find((f) => !f.inside)?.frameIndex ?? null;
  const withWindow = { ...common, decisiveFrames, insideCountInFinalWindow: insideCount, firstOutsideFrame: firstOutside };

  if (finalWindow.length < config.minFinalObservations || lateFinal.length < config.minFinalObservations) {
    const lastSeen = frames.at(-1)?.frameIndex ?? null;
    return base(
      "INCONCLUSIVE",
      "INC_MISSING_FINAL_OBSERVATIONS",
      `The object stopped being observed before the end of the clip (last seen at frame ${lastSeen} of ${lastFrameIndex}). It may be occluded or out of view, so its final position cannot be verified.`,
      withWindow,
    );
  }

  if (insideCount >= config.minFinalObservations) {
    const finalStart = finalWindow[0].frameIndex;
    const wasOutsideEarlier = frames.some((f) => !f.inside && f.frameIndex < finalStart);
    if (!wasOutsideEarlier) {
      return base(
        "INCONCLUSIVE",
        "INC_NEVER_OBSERVED_OUTSIDE",
        "The object was inside the target zone for the whole observed clip, so no movement into the zone was demonstrated.",
        withWindow,
      );
    }
    return base(
      "PASS",
      "PASS_ENTERED_TARGET",
      `The object was observed outside the target zone (first at frame ${firstOutside}) and its centroid is inside the zone in ${insideCount} of the last ${finalWindow.length} observed frames.`,
      withWindow,
    );
  }

  if (outsideCount >= config.minFinalObservations) {
    return base(
      "FAIL",
      "FAIL_OUTSIDE_TARGET",
      `The object remains visible and its centroid is outside the target zone in ${outsideCount} of the last ${finalWindow.length} observed frames.`,
      withWindow,
    );
  }

  return base(
    "INCONCLUSIVE",
    "INC_SPLIT_FINAL_VOTE",
    `The final observations are split (${insideCount} inside, ${outsideCount} outside), so no reliable conclusion can be drawn.`,
    withWindow,
  );
}

/** Convert a tracking/API failure into an INCONCLUSIVE result. Never PASS/FAIL. */
export function inconclusiveFromError(
  code: "INC_API_FAILURE" | "INC_STREAM_INCOMPLETE" | "INC_INVALID_INPUT",
  message: string,
  totalFrameCount: number,
  config?: Partial<EvaluationConfig>,
): EvaluationResult {
  return {
    verdict: "INCONCLUSIVE",
    reasonCode: code,
    reason: message,
    trackedObjectId: null,
    coverage: 0,
    observedFrameCount: 0,
    totalFrameCount,
    frames: [],
    decisiveFrames: [],
    insideCountInFinalWindow: 0,
    firstOutsideFrame: null,
    objectSummary: [],
    limitations: [...STANDING_LIMITATIONS],
    config: { ...DEFAULT_EVALUATION_CONFIG, ...config },
  };
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}
