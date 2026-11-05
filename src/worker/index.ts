/**
 * Long-running evaluation worker.  `pnpm worker`
 * Runs in a persistent Node process (not an edge/serverless function) so long
 * Meta SAM 3.1 video jobs can finish.
 */
import fs from "node:fs";

async function main() {
  for (const f of [".env.local", ".env"]) if (fs.existsSync(f)) process.loadEnvFile(f);
  // Imported after env is loaded so Prisma sees DATABASE_URL.
  const { runOnce, recoverStaleJobs, WORKER_ID } = await import("./process");
  const { prisma } = await import("../lib/server/db");

  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      stopping = true;
    });
  }

  console.log(`[worker] ${WORKER_ID} started (live SAM ${process.env.MODEL_API_KEY ? "configured" : "NOT configured"})`);
  let lastRecover = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastRecover > 30_000) {
        lastRecover = Date.now();
        await recoverStaleJobs();
      }
      const did = await runOnce();
      if (!did) await new Promise((r) => setTimeout(r, 750));
    } catch (err) {
      console.error("[worker] loop error:", (err as Error).message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await prisma.$disconnect();
  console.log("[worker] stopped");
}

void main();
