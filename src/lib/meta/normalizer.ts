/**
 * Converts `@meta-sam/parser` results into RealityTest observations.
 *
 * - Frame indices come from the parser's frame markers (never line position).
 * - Object IDs are kept exactly as SAM reported them.
 * - Masks are decoded with `decodeMaskToRaster`; the centroid is computed from
 *   actual mask pixels. If a mask cannot be decoded, the box centre is used and
 *   the observation is marked `centroidSource: "box"`.
 */
import {
  decodeMaskToRaster,
  decodeMaskToSVGPath,
  parseVideoStream,
  recordsOfKind,
  type SegmentationMaskRecord,
  type VideoSegmentationResult,
} from "@meta-sam/parser";
import type { Observation, Provenance, TrackingDiagnostic, TrackingResult } from "../evaluation/types";
import { maskCentroid } from "../evaluation/geometry";

export interface NormalizeContext {
  provenance: Provenance;
  model: string;
  prompt: string;
  requestedAt: string;
  keepRawOutput?: boolean;
}

export function observationFromMask(rec: SegmentationMaskRecord, confidence?: number): Observation | null {
  const frameIndex = rec.frame?.frameIndex;
  if (frameIndex === undefined) return null;
  const box = { ...rec.bounds };
  const base = {
    frameIndex,
    objectId: rec.objectId,
    box,
    confidence: rec.confidence ?? confidence,
  };
  try {
    const raster = decodeMaskToRaster(rec.mask);
    const c = maskCentroid(raster, rec.mask.width, rec.mask.height, box);
    if (!c) {
      // Empty mask: SAM produced a record without any foreground pixels.
      return null;
    }
    let svg: string | undefined;
    try {
      svg = decodeMaskToSVGPath(rec.mask) || undefined;
    } catch {
      svg = undefined;
    }
    return {
      ...base,
      centroid: c.centroid,
      centroidSource: "mask",
      maskArea: c.area,
      maskSvgPath: svg,
      maskRaster: { width: rec.mask.width, height: rec.mask.height },
    };
  } catch {
    return {
      ...base,
      centroid: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
      centroidSource: "box",
    };
  }
}

export function normalizeSegmentation(result: VideoSegmentationResult, ctx: NormalizeContext): TrackingResult {
  const boxes = recordsOfKind(result.records, "box");
  const boxConfidence = new Map<string, number | undefined>();
  for (const b of boxes) {
    if (b.frame) boxConfidence.set(`${b.frame.frameIndex}:${b.objectId}`, b.confidence);
  }

  const byKey = new Map<string, Observation>();
  const diagnostics: TrackingDiagnostic[] = result.diagnostics.map((d) => ({
    severity: d.severity,
    code: d.code,
    message: `${d.message} (line ${d.line})`,
  }));
  let undecodable = 0;
  let empty = 0;

  for (const rec of recordsOfKind(result.records, "mask")) {
    const key = `${rec.frame?.frameIndex}:${rec.objectId}`;
    const obs = observationFromMask(rec, boxConfidence.get(key));
    if (!obs) {
      empty++;
      continue;
    }
    if (obs.centroidSource === "box") undecodable++;
    // Later revisions of the same (frame, object) supersede earlier ones.
    byKey.set(key, obs);
  }
  if (undecodable > 0) {
    diagnostics.push({
      severity: "warning",
      code: "mask_decode_failed",
      message: `${undecodable} mask(s) could not be decoded; box centre used instead.`,
    });
  }
  if (empty > 0) {
    diagnostics.push({
      severity: "warning",
      code: "empty_mask",
      message: `${empty} mask record(s) had no foreground pixels and were ignored.`,
    });
  }

  const observations = [...byKey.values()].sort(
    (a, b) => a.frameIndex - b.frameIndex || a.objectId.localeCompare(b.objectId),
  );

  return {
    provenance: ctx.provenance,
    model: ctx.model,
    prompt: ctx.prompt,
    streamOutcome:
      result.outcome.status === "completed"
        ? { status: "completed" }
        : { status: "incomplete", reason: result.outcome.reason, detail: result.outcome.detail },
    observations,
    diagnostics,
    rawOutput: ctx.keepRawOutput === false ? undefined : result.rawOutput,
    requestedAt: ctx.requestedAt,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Replay a recorded SAM 3.1 raw output (special-token text) through the
 * official parser. Used for "Recorded API fixture" provenance.
 */
export async function replayRawOutput(
  rawOutput: string,
  ctx: Omit<NormalizeContext, "provenance">,
): Promise<TrackingResult> {
  async function* events() {
    const lines = rawOutput.split(/(?<=\n)/);
    for (const delta of lines) {
      yield { type: "response.output_text.delta", item_id: "fixture", output_index: 0, content_index: 0, delta };
    }
    yield { type: "response.output_text.done", item_id: "fixture", output_index: 0, content_index: 0, text: rawOutput };
    yield { type: "response.completed" };
  }
  const parsed = parseVideoStream(events());
  const result = await parsed.finalResult;
  return normalizeSegmentation(result, { ...ctx, provenance: "fixture" });
}
