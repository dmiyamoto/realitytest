/**
 * Core domain types for RealityTest.
 *
 * Coordinates are always expressed in SOURCE-VIDEO PIXELS unless a name says
 * otherwise (e.g. `display*`). Frame indices are the zero-based indices that
 * Meta SAM 3.1 reports in its `<Nf>` markers — never array positions.
 */

export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";

/**
 * Where the tracking data came from. The UI must label these honestly:
 * - `live`: produced by a real Meta SAM 3.1 API call for this evaluation.
 * - `fixture`: a recording of a previous real Meta SAM 3.1 API response,
 *   replayed through the same parser. Never presented as live inference.
 * - `test`: synthetic geometry written directly by automated tests (E2E seed).
 *   Never produced by the application runtime; labelled "not model output".
 */
export type Provenance = "live" | "fixture" | "test";

export interface Point {
  x: number;
  y: number;
}

/** Half-open box in source pixels: [left, right) × [top, bottom). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A target zone polygon in source pixels (≥ 3 vertices). */
export interface TargetZone {
  /** "rect" zones are stored as 4-vertex polygons too. */
  shape: "rect" | "polygon";
  points: Point[];
}

export interface VideoInfo {
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  /** Total frame count as reported/estimated from container metadata. */
  frameCount: number;
  codec: string;
  container: string;
  sizeBytes: number;
}

/** One SAM 3.1 detection of one object in one frame, normalized. */
export interface Observation {
  frameIndex: number;
  objectId: string;
  box: Box;
  confidence?: number;
  /** Centroid of the decoded mask (preferred) or the box (fallback). */
  centroid: Point;
  centroidSource: "mask" | "box";
  /** Number of foreground mask pixels in source-pixel units (approx.). */
  maskArea?: number;
  /** SVG path of the mask in mask-raster coordinates (for overlays). */
  maskSvgPath?: string;
  /** Raster size of the mask, to map `maskSvgPath` onto `box`. */
  maskRaster?: { width: number; height: number };
}

export interface TrackingDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
}

/** Normalized output of one SAM 3.1 video segmentation run. */
export interface TrackingResult {
  provenance: Provenance;
  model: string;
  prompt: string;
  /** "completed" or an early end reported by the parser. */
  streamOutcome: { status: "completed" } | { status: "incomplete"; reason: string; detail?: string };
  observations: Observation[];
  diagnostics: TrackingDiagnostic[];
  /** Raw special-token output, kept so runs can be recorded as fixtures. */
  rawOutput?: string;
  requestedAt: string;
  completedAt: string;
}

export interface EvaluationConfig {
  /** Fraction of video frames (0–1) that must contain the tracked object. */
  coverageThreshold: number;
  /** Number of final usable observations considered. */
  finalWindow: number;
  /** Minimum number of final observations needed (also the vote threshold). */
  minFinalObservations: number;
  /**
   * Final observations whose frame index is earlier than this fraction of the
   * video are considered "missing final observations".
   */
  finalFramesMustStartAfter: number;
  /**
   * Minimum allowed confidence for an observation to count as usable (only
   * applied when SAM returns confidence values).
   */
  minConfidence: number;
}

export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  coverageThreshold: 0.6,
  finalWindow: 5,
  minFinalObservations: 3,
  finalFramesMustStartAfter: 0.8,
  minConfidence: 0.3,
};

export type ReasonCode =
  | "PASS_ENTERED_TARGET"
  | "FAIL_OUTSIDE_TARGET"
  | "FAIL_NEVER_LEFT_TARGET"
  | "INC_NO_DETECTIONS"
  | "INC_AMBIGUOUS_OBJECTS"
  | "INC_LOW_COVERAGE"
  | "INC_MISSING_FINAL_OBSERVATIONS"
  | "INC_SPLIT_FINAL_VOTE"
  | "INC_NEVER_OBSERVED_OUTSIDE"
  | "INC_STREAM_INCOMPLETE"
  | "INC_API_FAILURE"
  | "INC_INVALID_INPUT";

export interface FrameEvaluation {
  frameIndex: number;
  objectId: string;
  centroid: Point;
  centroidSource: "mask" | "box";
  inside: boolean;
  box: Box;
}

export interface EvaluationResult {
  verdict: Verdict;
  reasonCode: ReasonCode;
  reason: string;
  trackedObjectId: string | null;
  /** Fraction of video frames in which the tracked object was observed. */
  coverage: number;
  observedFrameCount: number;
  totalFrameCount: number;
  /** Per-frame geometry for the tracked object, in frame order. */
  frames: FrameEvaluation[];
  /** Frame indices that decided the verdict (the final window). */
  decisiveFrames: number[];
  insideCountInFinalWindow: number;
  firstOutsideFrame: number | null;
  /** Distinct object IDs SAM reported, with how many frames each appeared. */
  objectSummary: { objectId: string; frames: number }[];
  limitations: string[];
  config: EvaluationConfig;
}
