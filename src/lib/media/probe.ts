/**
 * ffprobe wrapper. Reads the ACTUAL media properties of an uploaded file
 * (never trusts the client's MIME type or filename).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import type { VideoInfo } from "../evaluation/types";

const run = promisify(execFile);

export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

export class MediaProbeError extends Error {
  readonly code = "probe_failed";
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split("/").map(Number);
  if (!d) return n || 0;
  return n / d;
}

export async function probeVideo(filePath: string): Promise<VideoInfo> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      FFPROBE,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-count_packets", filePath],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch (err) {
    throw new MediaProbeError(`ffprobe could not read the file: ${(err as Error).message.split("\n")[0]}`);
  }
  const data = JSON.parse(stdout) as {
    streams?: Array<Record<string, string | number | undefined>>;
    format?: Record<string, string | number | undefined>;
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video) throw new MediaProbeError("No video stream found.");
  const width = Number(video.width);
  const height = Number(video.height);
  const fps = parseRate(String(video.avg_frame_rate ?? "")) || parseRate(String(video.r_frame_rate ?? ""));
  const durationSec = Number(data.format?.duration ?? video.duration ?? 0);
  const packets = Number(video.nb_read_packets ?? video.nb_frames ?? 0);
  const frameCount = packets > 0 ? packets : Math.round(durationSec * fps);
  return {
    width,
    height,
    fps,
    durationSec,
    frameCount,
    codec: String(video.codec_name ?? "unknown"),
    container: String(data.format?.format_name ?? "unknown"),
    sizeBytes: fs.statSync(filePath).size,
  };
}
