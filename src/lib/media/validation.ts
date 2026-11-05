/**
 * Server-side upload validation. Checks the ACTUAL bytes and media properties
 * with ffprobe; client-reported MIME types and names are not trusted.
 */
import fs from "node:fs";
import type { VideoInfo } from "../evaluation/types";
import { MediaProbeError, probeVideo } from "./probe";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_DURATION_SEC = 12;
export const MAX_DIMENSION = 3840;
/** Codecs accepted by Meta SAM 3.1 video input. */
export const ALLOWED_CODECS = new Set(["h264", "hevc", "mpeg4"]);

export type UploadValidationCode =
  | "too_large"
  | "empty"
  | "bad_extension"
  | "not_mp4_mov"
  | "unreadable"
  | "no_video"
  | "bad_codec"
  | "too_long"
  | "bad_dimensions";

export class UploadValidationError extends Error {
  constructor(
    readonly code: UploadValidationCode,
    message: string,
  ) {
    super(message);
  }
}

export function extensionFor(name: string): "mp4" | "mov" | null {
  const m = name.toLowerCase().match(/\.(mp4|mov|m4v)$/);
  if (!m) return null;
  return m[1] === "mov" ? "mov" : "mp4";
}

/** Quick pre-check before writing to disk. */
export function precheckUpload(name: string, size: number): "mp4" | "mov" {
  if (size <= 0) throw new UploadValidationError("empty", "The uploaded file is empty.");
  if (size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("too_large", `Video must be at most 25 MB (got ${(size / 1024 / 1024).toFixed(1)} MB).`);
  }
  const ext = extensionFor(name);
  if (!ext) throw new UploadValidationError("bad_extension", "Only MP4 or MOV files are supported.");
  return ext;
}

/** ISO-BMFF signature check: bytes 4..8 must be an 'ftyp' (or legacy QuickTime atom). */
export function hasIsoBmffSignature(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  const tag = String.fromCharCode(head[4], head[5], head[6], head[7]);
  return ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(tag);
}

export async function validateVideoFile(filePath: string): Promise<VideoInfo> {
  const fd = fs.openSync(filePath, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (!hasIsoBmffSignature(head)) {
    throw new UploadValidationError("not_mp4_mov", "The file is not a valid MP4/MOV container.");
  }
  let info: VideoInfo;
  try {
    info = await probeVideo(filePath);
  } catch (err) {
    if (err instanceof MediaProbeError) {
      throw new UploadValidationError(
        err.message.includes("No video stream") ? "no_video" : "unreadable",
        err.message.includes("No video stream") ? "The file contains no video stream." : "The video could not be decoded.",
      );
    }
    throw err;
  }
  if (!/mov|mp4/.test(info.container)) {
    throw new UploadValidationError("not_mp4_mov", `Unsupported container: ${info.container}.`);
  }
  if (!ALLOWED_CODECS.has(info.codec)) {
    throw new UploadValidationError("bad_codec", `Unsupported video codec "${info.codec}". Use H.264, H.265 or MPEG-4.`);
  }
  if (!(info.durationSec > 0) || info.durationSec > MAX_DURATION_SEC + 0.05) {
    throw new UploadValidationError("too_long", `Video must be at most ${MAX_DURATION_SEC} seconds (got ${info.durationSec.toFixed(1)} s).`);
  }
  if (!(info.width > 0 && info.height > 0) || info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    throw new UploadValidationError("bad_dimensions", `Unsupported resolution ${info.width}x${info.height}.`);
  }
  if (info.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("too_large", "Video must be at most 25 MB.");
  }
  return info;
}
