/**
 * Meta SAM 3.1 video segmentation client.
 *
 * - Endpoint: Responses API at https://api.meta.ai/v1 (OpenAI-compatible)
 * - Model: sam-3.1
 * - Auth: Bearer MODEL_API_KEY
 * - Video is uploaded via POST /v1/files (purpose "user_data") and referenced
 *   through an `input_video` part with `file_id`.
 * - The stream is consumed until `response.completed`, and decoded only with
 *   the official `@meta-sam/parser` (`parseVideoStream`).
 */
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { parseVideoStream, ResponsesStreamError, type VideoSegmentationResult } from "@meta-sam/parser";
import { normalizeSegmentation } from "./normalizer";
import type { TrackingResult } from "../evaluation/types";

export const META_BASE_URL = process.env.META_API_BASE_URL || "https://api.meta.ai/v1";
export const SAM_MODEL = "sam-3.1";

export class SamConfigError extends Error {
  readonly code = "sam_not_configured";
}

export class SamApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface SegmentVideoOptions {
  videoPath: string;
  prompt: string;
  apiKey?: string;
  /** Overall timeout for upload + inference (ms). */
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (info: { framesReceived: number; lastFrameIndex: number | null }) => void;
  /** Injected for tests. */
  client?: Pick<OpenAI, "files" | "responses">;
}

export function getSamApiKey(explicit?: string): string {
  const key = explicit ?? process.env.MODEL_API_KEY;
  if (!key) {
    throw new SamConfigError(
      "MODEL_API_KEY is not set. Live Meta SAM 3.1 inference is unavailable.",
    );
  }
  return key;
}

export function isSamConfigured(): boolean {
  return Boolean(process.env.MODEL_API_KEY);
}

export function createSamClient(apiKey?: string) {
  return new OpenAI({ baseURL: META_BASE_URL, apiKey: getSamApiKey(apiKey), maxRetries: 1 });
}

/** Map any thrown error to a stable SamApiError (never leaks the API key). */
export function toSamApiError(err: unknown): SamApiError {
  if (err instanceof SamApiError) return err;
  if (err instanceof SamConfigError) return new SamApiError(err.message, err.code);
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new SamApiError("Meta SAM 3.1 request timed out.", "timeout");
  }
  if (err instanceof OpenAI.APIUserAbortError) {
    return new SamApiError("Meta SAM 3.1 request was aborted (timeout or cancel).", "aborted");
  }
  if (err instanceof OpenAI.APIError) {
    const code =
      err.status === 401 || err.status === 403
        ? "unauthorized"
        : err.status === 404
          ? "model_not_found"
          : err.status === 429
            ? "rate_limited"
            : err.status && err.status >= 500
              ? "upstream_error"
              : "bad_request";
    return new SamApiError(`Meta SAM 3.1 API error (${err.status ?? "?"}): ${err.message}`, code, err.status);
  }
  if (err instanceof ResponsesStreamError) {
    const code = (err as { code?: string }).code ?? "stream_error";
    return new SamApiError(`Meta SAM 3.1 stream could not be used: ${err.message}`, `stream_${code}`);
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new SamApiError("Meta SAM 3.1 request was aborted (timeout or cancel).", "aborted");
  }
  const message = err instanceof Error ? err.message : String(err);
  return new SamApiError(`Meta SAM 3.1 request failed: ${message}`, "unknown");
}

/**
 * Run SAM 3.1 concept-prompt tracking over a local video file.
 * Throws SamApiError on any failure — callers must turn that into
 * INCONCLUSIVE, never into a PASS/FAIL.
 */
export async function segmentVideo(opts: SegmentVideoOptions): Promise<TrackingResult> {
  const requestedAt = new Date().toISOString();
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);

  try {
    const client = opts.client ?? createSamClient(opts.apiKey);
    const reqOpts = { signal: controller.signal, timeout: timeoutMs };

    const file = await client.files.create(
      {
        purpose: "user_data",
        file: await OpenAI.toFile(fs.createReadStream(opts.videoPath), path.basename(opts.videoPath)),
      },
      reqOpts,
    );

    const stream = await client.responses.create(
      {
        model: SAM_MODEL,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: opts.prompt },
              // `input_video` is part of the Meta SAM 3.1 Responses API but not
              // in the OpenAI SDK's types.
              { type: "input_video", file_id: file.id } as unknown as OpenAI.Responses.ResponseInputText,
            ],
          },
        ],
        stream: true,
        metadata: { include_confidence: "true" },
      },
      reqOpts,
    );

    const parsed = parseVideoStream(stream as AsyncIterable<{ type: string }>);
    let result: VideoSegmentationResult | undefined;
    if (opts.onProgress) {
      for await (const snapshot of parsed) {
        const frames = new Set<number>();
        let last: number | null = null;
        for (const r of snapshot.records) {
          if (r.kind !== "text" && r.frame) {
            frames.add(r.frame.frameIndex);
            last = r.frame.frameIndex;
          }
        }
        opts.onProgress({ framesReceived: frames.size, lastFrameIndex: last });
      }
      result = await parsed.finalResult;
    } else {
      result = await parsed.finalResult;
    }

    return normalizeSegmentation(result, {
      provenance: "live",
      model: SAM_MODEL,
      prompt: opts.prompt,
      requestedAt,
    });
  } catch (err) {
    throw toSamApiError(err);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}
