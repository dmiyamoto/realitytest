/**
 * 8. Invalid video upload, 14. cross-session access denial, credit debit
 * idempotency, and the worker turning API failures into INCONCLUSIVE.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POST as createEval } from "@/app/api/evaluations/route";
import { GET as getEval } from "@/app/api/evaluations/[id]/route";
import { GET as getVideo } from "@/app/api/evaluations/[id]/video/route";
import { prisma } from "@/lib/server/db";
import { getBalance, grantPurchase } from "@/lib/billing/credits";
import { claimNextJob, runOnce } from "@/worker/process";
import { SamApiError } from "@/lib/meta/sam";
import { rectToPolygon } from "@/lib/evaluation/geometry";
import type { TrackingResult } from "@/lib/evaluation/types";

const ZONE = JSON.stringify({ shape: "rect", points: rectToPolygon({ x: 600, y: 330 }, { x: 860, y: 470 }) });
const PASS_MP4 = path.resolve("public/samples/synthetic-pass.mp4");

function form(fields: Record<string, string>, file?: File) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set("file", file);
  return fd;
}
const baseFields = { objectPrompt: "red cube", targetZone: ZONE, zoneConfirmed: "true", mode: "live" };

async function post(fd: FormData, cookie?: string, idem?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (idem) headers["idempotency-key"] = idem;
  const res = await createEval(new Request("http://localhost/api/evaluations", { method: "POST", body: fd, headers }));
  const setCookie = res.headers.get("set-cookie");
  return { res, body: await res.json(), cookie: setCookie ? setCookie.split(";")[0] : cookie };
}

function uploadFile(name = "clip.mp4", bytes?: Buffer) {
  return new File([new Uint8Array(bytes ?? fs.readFileSync(PASS_MP4))], name, { type: "video/mp4" });
}

describe("evaluation API", () => {
  it("8. rejects invalid uploads (wrong type, fake mp4, too long, too large)", async () => {
    process.env.MODEL_API_KEY = "test-key-not-used";
    try {
      const txt = await post(form({ ...baseFields, source: "upload" }, uploadFile("notes.txt", Buffer.from("hello"))));
      expect(txt.res.status).toBe(400);
      expect(txt.body.error.code).toBe("upload_bad_extension");

      const fake = await post(form({ ...baseFields, source: "upload" }, uploadFile("fake.mp4", Buffer.from("this is not a video at all, just text"))));
      expect(fake.res.status).toBe(400);
      expect(fake.body.error.code).toBe("upload_not_mp4_mov");

      const big = Buffer.alloc(26 * 1024 * 1024);
      const large = await post(form({ ...baseFields, source: "upload" }, uploadFile("big.mp4", big)));
      expect(large.body.error.code).toBe("upload_too_large");

      const longPath = path.resolve("data/test-long.mp4");
      if (!fs.existsSync(longPath)) {
        const { execFileSync } = await import("node:child_process");
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=160x120:d=13", "-c:v", "libx264", "-pix_fmt", "yuv420p", longPath]);
      }
      const long = await post(form({ ...baseFields, source: "upload" }, uploadFile("long.mp4", fs.readFileSync(longPath))));
      expect(long.body.error.code).toBe("upload_too_long");

      const unconfirmed = await post(form({ ...baseFields, zoneConfirmed: "false", source: "synthetic-pass" }));
      expect(unconfirmed.res.status).toBe(400);
      const outOfFrame = await post(form({ ...baseFields, source: "synthetic-pass", targetZone: JSON.stringify({ shape: "rect", points: rectToPolygon({ x: 0, y: 0 }, { x: 5000, y: 100 }) }) }));
      expect(outOfFrame.body.error.code).toBe("zone_out_of_frame");
      // Nothing left behind in storage from rejected uploads
      const dir = path.resolve("data/test-storage/uploads");
      expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
    } finally {
      delete process.env.MODEL_API_KEY;
    }
  });

  it("live mode without MODEL_API_KEY is refused (no fabricated inference)", async () => {
    const r = await post(form({ ...baseFields, source: "synthetic-pass" }));
    expect(r.res.status).toBe(503);
    expect(r.body.error.code).toBe("live_unavailable");
  });

  it("fixture mode requires a recorded real API output", async () => {
    const r = await post(form({ ...baseFields, mode: "fixture", source: "synthetic-pass", objectPrompt: "purple elephant" }));
    expect(r.res.status).toBe(400);
    expect(r.body.error.code).toBe("fixture_unavailable");
  });

  it("14. cross-session access is denied (job and private video)", async () => {
    process.env.MODEL_API_KEY = "test-key-not-used";
    try {
      const a = await post(form({ ...baseFields, source: "upload" }, uploadFile()));
      expect(a.res.status).toBe(201);
      const id = a.body.id as string;
      const ctx = { params: Promise.resolve({ id }) };

      const own = await getEval(new Request(`http://localhost/api/evaluations/${id}`, { headers: { cookie: a.cookie! } }), ctx);
      expect(own.status).toBe(200);
      expect((await own.json()).videoUrl).toBe(`/api/evaluations/${id}/video`);

      const other = await post(form({ ...baseFields, source: "nope" }));
      const intruder = await getEval(new Request(`http://localhost/api/evaluations/${id}`, { headers: { cookie: other.cookie! } }), ctx);
      expect(intruder.status).toBe(404);
      const anon = await getEval(new Request(`http://localhost/api/evaluations/${id}`), ctx);
      expect(anon.status).toBe(404);
      const forged = await getEval(new Request(`http://localhost/api/evaluations/${id}`, { headers: { cookie: a.cookie!.replace(/\.[^.]+$/, ".forged") } }), ctx);
      expect(forged.status).toBe(404);

      const vidOwn = await getVideo(new Request(`http://localhost/x`, { headers: { cookie: a.cookie!, range: "bytes=0-99" } }), ctx);
      expect(vidOwn.status).toBe(206);
      expect(vidOwn.headers.get("content-range")).toMatch(/^bytes 0-99\//);
      const vidOther = await getVideo(new Request(`http://localhost/x`, { headers: { cookie: other.cookie! } }), ctx);
      expect(vidOther.status).toBe(404);

      await prisma.evaluationJob.update({ where: { id }, data: { status: "completed" } });
    } finally {
      delete process.env.MODEL_API_KEY;
    }
  });

  it("retries with the same Idempotency-Key reuse the job and never double-debit", async () => {
    process.env.MODEL_API_KEY = "test-key-not-used";
    process.env.FREE_EVALUATIONS_PER_SESSION = "0";
    try {
      const first = await post(form({ ...baseFields, source: "synthetic-pass" }));
      expect(first.res.status).toBe(402); // no credits yet
      const sessionId = decodeURIComponent(first.cookie!.split("=")[1]).split(".")[0];
      await prisma.$transaction((tx) => grantPurchase(tx, sessionId, `cs_test_idem_${Date.now()}`, 20));
      expect(await getBalance(sessionId)).toBe(20);

      const r1 = await post(form({ ...baseFields, source: "synthetic-pass" }), first.cookie, "retry-key-1");
      const r2 = await post(form({ ...baseFields, source: "synthetic-pass" }), first.cookie, "retry-key-1");
      expect(r1.res.status).toBe(201);
      expect(r2.res.status).toBe(200);
      expect(r2.body.id).toBe(r1.body.id);
      expect(await getBalance(sessionId)).toBe(19);
      await prisma.evaluationJob.update({ where: { id: r1.body.id }, data: { status: "completed" } });
    } finally {
      delete process.env.MODEL_API_KEY;
      delete process.env.FREE_EVALUATIONS_PER_SESSION;
    }
  });

  it("9. worker: API failure → INCONCLUSIVE with refund; success → real verdict", async () => {
    process.env.MODEL_API_KEY = "test-key-not-used";
    process.env.FREE_EVALUATIONS_PER_SESSION = "0";
    try {
      await prisma.evaluationJob.updateMany({ where: { status: { in: ["pending", "running"] } }, data: { status: "completed" } });
      const s = await post(form({ ...baseFields, source: "nope" }));
      const sessionId = decodeURIComponent(s.cookie!.split("=")[1]).split(".")[0];
      await prisma.$transaction((tx) => grantPurchase(tx, sessionId, `cs_test_w_${Date.now()}`, 2));

      const j1 = await post(form({ ...baseFields, source: "synthetic-pass" }), s.cookie, "w1");
      expect(await getBalance(sessionId)).toBe(1);
      await runOnce({
        segment: async () => {
          throw new SamApiError("Meta SAM 3.1 request timed out.", "timeout");
        },
      });
      const failed = await prisma.evaluationJob.findUniqueOrThrow({ where: { id: j1.body.id } });
      expect(failed.status).toBe("completed");
      expect(failed.verdict).toBe("INCONCLUSIVE");
      expect(failed.errorCode).toBe("timeout");
      expect(JSON.parse(failed.result!).reasonCode).toBe("INC_API_FAILURE");
      expect(await getBalance(sessionId)).toBe(2); // refunded

      const j2 = await post(form({ ...baseFields, source: "synthetic-pass" }), s.cookie, "w2");
      const fake: TrackingResult = {
        provenance: "live",
        model: "sam-3.1",
        prompt: "red cube",
        streamOutcome: { status: "completed" },
        observations: Array.from({ length: 240 }, (_, i) => {
          const x = 230 + (730 - 230) * Math.min(1, i / 170);
          return { frameIndex: i, objectId: "0", box: { left: x - 35, top: 360, right: x + 35, bottom: 430 }, centroid: { x, y: 400 }, centroidSource: "mask" as const, maskArea: 4900 };
        }),
        diagnostics: [],
        requestedAt: "",
        completedAt: "",
      };
      await runOnce({ segment: async () => fake });
      const done = await prisma.evaluationJob.findUniqueOrThrow({ where: { id: j2.body.id } });
      expect(done.verdict).toBe("PASS");
      expect(done.provenance).toBe("live");
      expect(await getBalance(sessionId)).toBe(1);
      expect(await claimNextJob()).toBeNull();
    } finally {
      delete process.env.MODEL_API_KEY;
      delete process.env.FREE_EVALUATIONS_PER_SESSION;
    }
  });
});
