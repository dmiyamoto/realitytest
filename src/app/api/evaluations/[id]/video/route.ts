import fs from "node:fs";
import { Readable } from "node:stream";
import { sessionIdFromRequest } from "@/lib/server/session";
import { getJobForSession } from "@/lib/server/jobs";
import { errorJson } from "@/lib/server/http";

/** Stream a private uploaded video to its owner only (supports Range for seeking). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const job = await getJobForSession(id, sessionIdFromRequest(req));
  if (!job || job.source !== "upload" || !fs.existsSync(job.videoPath)) {
    return errorJson(404, "not_found", "Video not found.");
  }
  const size = fs.statSync(job.videoPath).size;
  const type = job.videoPath.endsWith(".mov") ? "video/quicktime" : "video/mp4";
  const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, no-store" };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (Number.isNaN(start)) {
      start = Math.max(0, size - end);
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(fs.createReadStream(job.videoPath, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...base, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` },
    });
  }
  const body = Readable.toWeb(fs.createReadStream(job.videoPath)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...base, "content-length": String(size) } });
}
