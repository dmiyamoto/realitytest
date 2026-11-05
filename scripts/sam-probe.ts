/**
 * Phase-1 probe: send ONE real video segmentation request to Meta SAM 3.1,
 * decode it with @meta-sam/parser, print a summary, and (optionally) record
 * the raw API output as a fixture.
 *
 *   pnpm sam:probe public/samples/synthetic-pass.mp4 "red cube" [--record fixtures/recorded/pass.json]
 *
 * Reads MODEL_API_KEY from the environment or .env.local / .env.
 * Never prints the key.
 */
import fs from "node:fs";
import path from "node:path";
import { segmentVideo, SAM_MODEL, META_BASE_URL } from "../src/lib/meta/sam";
import { probeVideo } from "../src/lib/media/probe";

for (const f of [".env.local", ".env"]) {
  if (fs.existsSync(f)) process.loadEnvFile(f);
}

async function main() {
  const args = process.argv.slice(2);
  const recordIdx = args.indexOf("--record");
  const recordPath = recordIdx >= 0 ? args[recordIdx + 1] : undefined;
  const positional = recordIdx >= 0 ? args.filter((_, i) => i !== recordIdx && i !== recordIdx + 1) : args;
  const [videoPath, prompt] = positional;
  if (!videoPath || !prompt) {
    console.error('Usage: pnpm sam:probe <video> "<object prompt>" [--record out.json]');
    process.exit(2);
  }
  if (!process.env.MODEL_API_KEY) {
    console.error("BLOCKED: MODEL_API_KEY is not set (env or .env.local). No request was sent.");
    process.exit(3);
  }

  const info = await probeVideo(videoPath);
  console.log(`video: ${videoPath} ${info.width}x${info.height} ${info.fps.toFixed(2)}fps ${info.frameCount} frames ${info.durationSec.toFixed(2)}s ${info.codec}`);
  console.log(`request: POST ${META_BASE_URL}/responses model=${SAM_MODEL} prompt=${JSON.stringify(prompt)}`);

  const t0 = Date.now();
  let lastLog = 0;
  const result = await segmentVideo({
    videoPath,
    prompt,
    onProgress: ({ framesReceived, lastFrameIndex }) => {
      if (Date.now() - lastLog > 1000) {
        lastLog = Date.now();
        console.log(`  streaming… frames=${framesReceived} last=${lastFrameIndex}`);
      }
    },
  });
  const ms = Date.now() - t0;

  const frames = new Set(result.observations.map((o) => o.frameIndex));
  const ids = new Map<string, number>();
  for (const o of result.observations) ids.set(o.objectId, (ids.get(o.objectId) ?? 0) + 1);
  const sorted = [...frames].sort((a, b) => a - b);
  console.log(`\nstream outcome: ${JSON.stringify(result.streamOutcome)} in ${ms} ms`);
  console.log(`observations: ${result.observations.length}, frames with detections: ${frames.size}/${info.frameCount}`);
  console.log(`frame range: ${sorted[0]} … ${sorted.at(-1)}`);
  console.log(`object ids: ${JSON.stringify(Object.fromEntries(ids))}`);
  console.log(`centroid sources: ${JSON.stringify(countBy(result.observations.map((o) => o.centroidSource)))}`);
  console.log(`diagnostics: ${JSON.stringify(result.diagnostics)}`);
  for (const o of result.observations.filter((_, i, a) => i < 3 || i >= a.length - 3)) {
    console.log(
      `  f${o.frameIndex} id=${o.objectId} box=[${o.box.left},${o.box.top},${o.box.right},${o.box.bottom}] ` +
        `centroid=(${o.centroid.x.toFixed(1)},${o.centroid.y.toFixed(1)}) area=${o.maskArea?.toFixed(0)} c=${o.confidence}`,
    );
  }
  console.log(`raw output: ${result.rawOutput?.length ?? 0} chars; first line: ${result.rawOutput?.split("\n")[0]?.slice(0, 160)}`);

  if (recordPath) {
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(
      recordPath,
      JSON.stringify(
        {
          kind: "realitytest.sam-fixture/v1",
          note: "Recorded output of a real Meta SAM 3.1 API call. Replayed via @meta-sam/parser. Not live inference.",
          model: result.model,
          prompt,
          video: path.basename(videoPath),
          videoInfo: info,
          recordedAt: result.completedAt,
          streamOutcome: result.streamOutcome,
          rawOutput: result.rawOutput,
        },
        null,
        2,
      ),
    );
    console.log(`recorded fixture → ${recordPath}`);
  }
}

function countBy(xs: string[]) {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}

main().catch((err) => {
  console.error(`FAILED: [${err.code ?? "error"}] ${err.message}`);
  process.exit(1);
});
