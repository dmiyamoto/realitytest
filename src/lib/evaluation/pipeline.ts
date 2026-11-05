import { evaluate, inconclusiveFromError } from "./evaluator";
import type { EvaluationConfig, EvaluationResult, TargetZone, TrackingResult } from "./types";

/**
 * Turn a SAM tracking result into a verdict. An incomplete stream is never
 * evaluated into PASS/FAIL.
 */
export function verdictFromTracking(
  tracking: TrackingResult,
  target: TargetZone,
  totalFrameCount: number,
  config?: Partial<EvaluationConfig>,
): EvaluationResult {
  if (tracking.streamOutcome.status !== "completed") {
    const r = inconclusiveFromError(
      "INC_STREAM_INCOMPLETE",
      `The Meta SAM 3.1 stream ended early (${tracking.streamOutcome.reason}${
        tracking.streamOutcome.detail ? `: ${tracking.streamOutcome.detail}` : ""
      }). Partial tracking is not used for a verdict.`,
      totalFrameCount,
      config,
    );
    return r;
  }
  return evaluate({ observations: tracking.observations, target, totalFrameCount, config });
}

export function configFromEnv(): Partial<EvaluationConfig> {
  const raw = process.env.EVAL_COVERAGE_THRESHOLD;
  const v = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(v) && v > 0 && v <= 1 ? { coverageThreshold: v } : {};
}
