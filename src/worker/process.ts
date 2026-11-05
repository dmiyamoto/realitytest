/**
 * Job worker core: atomically claim pending jobs and process them.
 */
import crypto from "node:crypto";
import { prisma } from "../lib/server/db";
import { segmentVideo, SamApiError, toSamApiError, SAM_MODEL } from "../lib/meta/sam";
import { replayRawOutput } from "../lib/meta/normalizer";
import { loadFixture } from "../lib/server/fixtures";
import { configFromEnv, verdictFromTracking } from "../lib/evaluation/pipeline";
import { inconclusiveFromError } from "../lib/evaluation/evaluator";
import type { TargetZone, TrackingResult, VideoInfo } from "../lib/evaluation/types";
import { refundJob } from "../lib/billing/credits";

export const WORKER_ID = `worker-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
export const MAX_ATTEMPTS = 2;
export const STALE_AFTER_MS = 10 * 60_000;

/**
 * Claim the oldest pending job. The conditional updateMany (status=pending)
 * is atomic in SQLite, so two workers can never claim the same job.
 */
export async function claimNextJob(workerId = WORKER_ID) {
  for (let i = 0; i < 5; i++) {
    const candidate = await prisma.evaluationJob.findFirst({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) return null;
    const now = new Date();
    const { count } = await prisma.evaluationJob.updateMany({
      where: { id: candidate.id, status: "pending" },
      data: { status: "running", workerId, claimedAt: now, startedAt: now, attempts: { increment: 1 }, progress: 1, progressMessage: "Claimed by worker" },
    });
    if (count === 1) return prisma.evaluationJob.findUniqueOrThrow({ where: { id: candidate.id } });
  }
  return null;
}

/** Re-queue jobs whose worker died; give up after MAX_ATTEMPTS. */
export async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await prisma.evaluationJob.findMany({ where: { status: "running", claimedAt: { lt: cutoff } } });
  for (const job of stale) {
    if (job.attempts >= MAX_ATTEMPTS) {
      await finishWithApiFailure(job.id, job.sessionId, "worker_lost", "The evaluation worker stopped before finishing.", JSON.parse(job.videoInfo));
    } else {
      await prisma.evaluationJob.updateMany({
        where: { id: job.id, status: "running", claimedAt: job.claimedAt },
        data: { status: "pending", workerId: null, progressMessage: "Re-queued after worker timeout" },
      });
    }
  }
}

async function progress(id: string, progress: number, message: string) {
  await prisma.evaluationJob.update({ where: { id }, data: { progress, progressMessage: message } });
}

async function finishWithApiFailure(id: string, sessionId: string, code: string, message: string, info: VideoInfo, provenance?: string) {
  const result = inconclusiveFromError("INC_API_FAILURE", message, info.frameCount, configFromEnv());
  await prisma.evaluationJob.update({
    where: { id },
    data: {
      status: "completed",
      verdict: result.verdict,
      result: JSON.stringify(result),
      errorCode: code,
      error: message,
      provenance: provenance ?? null,
      progress: 100,
      progressMessage: "Finished (no verdict possible)",
      completedAt: new Date(),
    },
  });
  // The user is not charged for an evaluation the API could not perform.
  await refundJob(sessionId, id);
}

export async function processJob(job: Awaited<ReturnType<typeof claimNextJob>> & object, deps: { segment?: typeof segmentVideo } = {}) {
  const info: VideoInfo = JSON.parse(job.videoInfo);
  const zone: TargetZone = JSON.parse(job.targetZone);
  const segment = deps.segment ?? segmentVideo;
  let tracking: TrackingResult;

  try {
    if (job.mode === "fixture") {
      await progress(job.id, 10, "Loading recorded Meta SAM 3.1 API output");
      const fx = loadFixture(job.source, job.objectPrompt);
      tracking = await replayRawOutput(fx.rawOutput, { model: fx.model, prompt: fx.prompt, requestedAt: fx.recordedAt });
    } else {
      await progress(job.id, 5, "Uploading video to Meta Model API");
      let lastWrite = 0;
      tracking = await segment({
        videoPath: job.videoPath,
        prompt: job.objectPrompt,
        onProgress: ({ framesReceived }) => {
          const now = Date.now();
          if (now - lastWrite < 700) return;
          lastWrite = now;
          const pct = Math.min(90, 10 + Math.round((framesReceived / Math.max(1, info.frameCount)) * 80));
          void progress(job.id, pct, `Meta SAM 3.1 tracking… ${framesReceived} frames received`).catch(() => {});
        },
      });
    }
  } catch (err) {
    const e = err instanceof SamApiError ? err : toSamApiError(err);
    await finishWithApiFailure(job.id, job.sessionId, e.code, e.message, info, job.mode === "fixture" ? "fixture" : "live");
    return;
  }

  await progress(job.id, 95, "Evaluating geometry");
  const result = verdictFromTracking(tracking, zone, info.frameCount, configFromEnv());
  const { rawOutput: _raw, ...trackingStored } = tracking;
  void _raw;
  await prisma.evaluationJob.update({
    where: { id: job.id },
    data: {
      status: "completed",
      provenance: tracking.provenance,
      tracking: JSON.stringify({ ...trackingStored, model: tracking.model || SAM_MODEL }),
      result: JSON.stringify(result),
      verdict: result.verdict,
      progress: 100,
      progressMessage: "Done",
      completedAt: new Date(),
    },
  });
  if (result.reasonCode === "INC_STREAM_INCOMPLETE") await refundJob(job.sessionId, job.id);
}

export async function runOnce(deps?: { segment?: typeof segmentVideo }): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  try {
    await processJob(job, deps);
  } catch (err) {
    // Unexpected internal error: record it; never invent a verdict.
    await prisma.evaluationJob.update({
      where: { id: job.id },
      data: { status: "failed", errorCode: "internal", error: (err as Error).message.slice(0, 500), completedAt: new Date() },
    });
    await refundJob(job.sessionId, job.id);
  }
  return true;
}
