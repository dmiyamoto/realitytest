/**
 * E2E seeding: inserts COMPLETED jobs with synthetic geometry for UI tests.
 * Provenance is "test" and the UI labels it "Synthetic test data — not model
 * output". The verdict itself is computed by the real evaluator.
 */
import crypto from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { evaluate } from "../../src/lib/evaluation/evaluator";
import { rectToPolygon } from "../../src/lib/evaluation/geometry";
import type { Observation, TrackingResult } from "../../src/lib/evaluation/types";

export const E2E_DB = path.resolve("data/e2e.db");
const prisma = new PrismaClient({ datasourceUrl: `file:${E2E_DB}` });

const ZONE = { shape: "rect" as const, points: rectToPolygon({ x: 600, y: 330 }, { x: 860, y: 470 }) };
const INFO = { width: 960, height: 540, fps: 30, durationSec: 8, frameCount: 240, codec: "h264", container: "mov,mp4,m4a,3gp,3g2,mj2", sizeBytes: 64000 };

function trajectory(kind: "pass" | "fail" | "occluded"): Observation[] {
  const endX = kind === "fail" ? 470 : 730;
  const lastFrame = kind === "occluded" ? 175 : 239;
  const out: Observation[] = [];
  for (let i = 0; i <= lastFrame; i++) {
    const t = Math.min(1, i / 170);
    const x = 230 + (endX - 230) * t;
    const y = 395 - Math.sin(Math.PI * t) * 150;
    out.push({ frameIndex: i, objectId: "0", box: { left: x - 35, top: y - 35, right: x + 35, bottom: y + 35 }, centroid: { x, y }, centroidSource: "box" });
  }
  return out;
}

export async function seedJob(sessionId: string, kind: "pass" | "fail" | "occluded") {
  const observations = trajectory(kind);
  const result = evaluate({ observations, target: ZONE, totalFrameCount: INFO.frameCount });
  const tracking: Omit<TrackingResult, "rawOutput"> = {
    provenance: "test",
    model: "none (synthetic test data)",
    prompt: "red cube",
    streamOutcome: { status: "completed" },
    observations,
    diagnostics: [],
    requestedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  const id = crypto.randomBytes(12).toString("base64url");
  await prisma.guestSession.upsert({ where: { id: sessionId }, create: { id: sessionId }, update: {} });
  await prisma.evaluationJob.create({
    data: {
      id,
      sessionId,
      status: "completed",
      progress: 100,
      mode: "fixture",
      provenance: "test",
      objectPrompt: "red cube",
      targetLabel: "blue tray",
      targetZone: JSON.stringify(ZONE),
      source: `synthetic-${kind}`,
      videoPath: path.resolve(`public/samples/synthetic-${kind}.mp4`),
      videoName: `Synthetic ${kind}`,
      videoInfo: JSON.stringify(INFO),
      tracking: JSON.stringify(tracking),
      result: JSON.stringify(result),
      verdict: result.verdict,
      completedAt: new Date(),
    },
  });
  return { id, verdict: result.verdict };
}
