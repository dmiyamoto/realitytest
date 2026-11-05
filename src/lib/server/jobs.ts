/**
 * Evaluation job creation and access control.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "./db";
import { uploadPath } from "./storage";
import { fixtureExists } from "./fixtures";
import { isSamConfigured } from "../meta/sam";
import { getSample } from "../samples";
import { isSelfIntersecting, polygonArea } from "../evaluation/geometry";
import type { EvaluationResult, TargetZone, TrackingResult, VideoInfo } from "../evaluation/types";
import { precheckUpload, UploadValidationError, validateVideoFile } from "../media/validation";
import { probeVideo } from "../media/probe";
import { debitForJob, getBalance, InsufficientCreditsError } from "../billing/credits";
import { billingEnabled } from "../billing/flag";

export class JobInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const TargetZoneSchema = z.object({
  shape: z.enum(["rect", "polygon"]),
  points: z.array(PointSchema).min(3).max(32),
});

export const CreateFieldsSchema = z.object({
  source: z.string().min(1).max(64),
  objectPrompt: z
    .string()
    .trim()
    .min(2, "Describe the object (e.g. \"red cube\").")
    .max(60, "Keep the object prompt to a short noun phrase."),
  targetLabel: z.string().trim().max(60).optional(),
  targetZone: z.string().max(4000),
  mode: z.enum(["live", "fixture"]),
  zoneConfirmed: z.literal("true", { message: "Confirm the target zone before running." }),
});

/** Live evaluations per session that cost nothing (default 2 with billing, 20 without). */
export function freeLimit(): number {
  const fallback = billingEnabled() ? 2 : 20;
  const raw = process.env.FREE_EVALUATIONS_PER_SESSION;
  const v = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function dailyLiveCap(): number {
  const v = Number(process.env.MAX_LIVE_EVALUATIONS_PER_DAY ?? 100);
  return Number.isFinite(v) && v >= 0 ? v : 100;
}

export function validateZone(zone: TargetZone, info: VideoInfo): TargetZone {
  const pts = zone.points;
  for (const p of pts) {
    if (p.x < 0 || p.y < 0 || p.x > info.width || p.y > info.height) {
      throw new JobInputError("zone_out_of_frame", "Target zone points must lie inside the video frame.");
    }
  }
  if (polygonArea(pts) < info.width * info.height * 0.002) {
    throw new JobInputError("zone_too_small", "The target zone is too small.");
  }
  if (isSelfIntersecting(pts)) {
    throw new JobInputError("zone_self_intersecting", "The target zone polygon must not cross itself.");
  }
  return { shape: zone.shape, points: pts.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })) };
}

export interface CreateJobInput {
  sessionId: string;
  idempotencyKey?: string | null;
  fields: Record<string, unknown>;
  file?: File | null;
}

export async function createEvaluationJob(input: CreateJobInput): Promise<{ id: string; created: boolean }> {
  const { sessionId } = input;
  const key = input.idempotencyKey?.slice(0, 100) || null;
  if (key) {
    const existing = await prisma.evaluationJob.findUnique({
      where: { sessionId_idempotencyKey: { sessionId, idempotencyKey: key } },
    });
    if (existing) return { id: existing.id, created: false };
  }

  const parsed = CreateFieldsSchema.safeParse(input.fields);
  if (!parsed.success) {
    throw new JobInputError("invalid_fields", parsed.error.issues.map((i) => i.message).join(" "));
  }
  const f = parsed.data;
  let zone: TargetZone;
  try {
    zone = TargetZoneSchema.parse(JSON.parse(f.targetZone));
  } catch {
    throw new JobInputError("invalid_zone", "Target zone is missing or malformed.");
  }

  const id = crypto.randomBytes(12).toString("base64url");
  let videoPath: string;
  let videoName: string;
  let info: VideoInfo;
  let written: string | null = null;

  if (f.source === "upload") {
    const file = input.file;
    if (!file) throw new JobInputError("missing_file", "Choose a video to upload.");
    try {
      const ext = precheckUpload(file.name, file.size);
      written = uploadPath(id, ext);
      fs.writeFileSync(written, Buffer.from(await file.arrayBuffer()));
      info = await validateVideoFile(written);
    } catch (err) {
      if (written) fs.rmSync(written, { force: true });
      if (err instanceof UploadValidationError) throw new JobInputError(`upload_${err.code}`, err.message);
      throw err;
    }
    videoPath = written;
    videoName = file.name.slice(0, 120);
    if (f.mode === "fixture") {
      fs.rmSync(written, { force: true });
      throw new JobInputError("fixture_unavailable", "Recorded fixtures exist only for built-in sample clips.");
    }
  } else {
    const sample = getSample(f.source);
    if (!sample) throw new JobInputError("unknown_sample", "Unknown sample clip.");
    videoPath = path.join(process.cwd(), "public", sample.publicPath);
    videoName = sample.title;
    info = await probeVideo(videoPath);
    if (f.mode === "fixture" && !fixtureExists(sample.id, f.objectPrompt)) {
      throw new JobInputError(
        "fixture_unavailable",
        `No recorded Meta SAM 3.1 output exists for this clip with prompt "${f.objectPrompt}". Use live inference.`,
      );
    }
  }

  try {
    zone = validateZone(zone, info);
    if (f.mode === "live" && !isSamConfigured()) {
      throw new JobInputError("live_unavailable", "Live Meta SAM 3.1 inference is not configured on this server (MODEL_API_KEY missing).", 503);
    }

    const created = await prisma.$transaction(async (tx) => {
      let billing = "free";
      if (f.mode === "live") {
        const since = new Date(Date.now() - 24 * 3600 * 1000);
        const today = await tx.evaluationJob.count({ where: { mode: "live", createdAt: { gte: since } } });
        if (today >= dailyLiveCap()) {
          throw new JobInputError("daily_cap", "The server's daily live-inference limit has been reached. Try a recorded fixture.", 429);
        }
        const active = await tx.evaluationJob.count({ where: { sessionId, status: { in: ["pending", "running"] } } });
        if (active >= 2) throw new JobInputError("too_many_active", "Wait for your running evaluations to finish.", 429);
        const freeUsed = await tx.evaluationJob.count({ where: { sessionId, mode: "live", billing: "free" } });
        if (freeUsed >= freeLimit()) {
          if (!billingEnabled()) {
            throw new JobInputError(
              "free_limit_reached",
              `This session has used all ${freeLimit()} live evaluations allowed per session. Choose "Recorded API fixture" instead, or raise FREE_EVALUATIONS_PER_SESSION on the server.`,
              429,
            );
          }
          billing = "credit";
        }
      }
      const job = await tx.evaluationJob.create({
        data: {
          id,
          sessionId,
          idempotencyKey: key,
          mode: f.mode,
          objectPrompt: f.objectPrompt,
          targetLabel: f.targetLabel || null,
          targetZone: JSON.stringify(zone),
          source: f.source,
          videoPath,
          videoName,
          videoInfo: JSON.stringify(info),
          billing,
        },
      });
      if (billing === "credit") {
        try {
          await debitForJob(tx, sessionId, job.id);
        } catch (err) {
          if (err instanceof InsufficientCreditsError) {
            throw new JobInputError(
              "insufficient_credits",
              `You've used your ${freeLimit()} free live evaluations. Buy a credit pack (Stripe TEST mode) to continue.`,
              402,
            );
          }
          throw err;
        }
      }
      return job;
    });
    return { id: created.id, created: true };
  } catch (err) {
    if (written) fs.rmSync(written, { force: true });
    // A concurrent retry with the same idempotency key won the race.
    if (key && (err as { code?: string }).code === "P2002") {
      const existing = await prisma.evaluationJob.findUnique({
        where: { sessionId_idempotencyKey: { sessionId, idempotencyKey: key } },
      });
      if (existing) return { id: existing.id, created: false };
    }
    throw err;
  }
}

/** Fetch a job only if it belongs to the session. Cross-session → null (404). */
export async function getJobForSession(id: string, sessionId: string | null) {
  if (!sessionId || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) return null;
  const job = await prisma.evaluationJob.findUnique({ where: { id } });
  if (!job || job.sessionId !== sessionId) return null;
  return job;
}

export type JobRow = NonNullable<Awaited<ReturnType<typeof getJobForSession>>>;

export interface PublicJob {
  id: string;
  status: string;
  progress: number;
  progressMessage: string | null;
  mode: string;
  provenance: string | null;
  objectPrompt: string;
  targetLabel: string | null;
  targetZone: TargetZone;
  source: string;
  videoName: string;
  videoUrl: string;
  videoInfo: VideoInfo;
  tracking: Omit<TrackingResult, "rawOutput"> | null;
  result: EvaluationResult | null;
  verdict: string | null;
  errorCode: string | null;
  error: string | null;
  billing: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export function toPublicJob(job: JobRow): PublicJob {
  const sample = job.source === "upload" ? undefined : getSample(job.source);
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    mode: job.mode,
    provenance: job.provenance,
    objectPrompt: job.objectPrompt,
    targetLabel: job.targetLabel,
    targetZone: JSON.parse(job.targetZone),
    source: job.source,
    videoName: job.videoName,
    videoUrl: sample ? sample.file : `/api/evaluations/${job.id}/video`,
    videoInfo: JSON.parse(job.videoInfo),
    tracking: job.tracking ? JSON.parse(job.tracking) : null,
    result: job.result ? JSON.parse(job.result) : null,
    verdict: job.verdict,
    errorCode: job.errorCode,
    error: job.error,
    billing: job.billing,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export async function sessionSummary(sessionId: string | null) {
  const billing = billingEnabled();
  if (!sessionId) return { credits: 0, freeRemaining: freeLimit(), liveConfigured: isSamConfigured(), billingEnabled: billing };
  const [credits, freeUsed] = await Promise.all([
    getBalance(sessionId),
    prisma.evaluationJob.count({ where: { sessionId, mode: "live", billing: "free" } }),
  ]);
  return { credits, freeRemaining: Math.max(0, freeLimit() - freeUsed), liveConfigured: isSamConfigured(), billingEnabled: billing };
}
