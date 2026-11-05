import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { fixtureRelPath } from "../samples";

export const FixtureFileSchema = z.object({
  kind: z.literal("realitytest.sam-fixture/v1"),
  model: z.string(),
  prompt: z.string(),
  video: z.string(),
  recordedAt: z.string(),
  videoInfo: z.object({ frameCount: z.number().int().positive() }).passthrough().optional(),
  streamOutcome: z.object({ status: z.string() }).passthrough(),
  rawOutput: z.string(),
});
export type FixtureFile = z.infer<typeof FixtureFileSchema>;

function root() {
  return process.env.FIXTURES_ROOT ? path.resolve(process.env.FIXTURES_ROOT) : process.cwd();
}

export function fixtureExists(sampleId: string, prompt: string): boolean {
  return fs.existsSync(path.join(root(), fixtureRelPath(sampleId, prompt)));
}

export function loadFixture(sampleId: string, prompt: string): FixtureFile {
  const p = path.join(root(), fixtureRelPath(sampleId, prompt));
  return FixtureFileSchema.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}

/** Prompts for which a recorded real-API fixture exists, per sample id. */
export function listFixturePrompts(): Record<string, string[]> {
  const dir = path.join(root(), "fixtures/recorded");
  const out: Record<string, string[]> = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const fx = FixtureFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      const sampleId = f.split(".")[0];
      (out[sampleId] ??= []).push(fx.prompt);
    } catch {
      // ignore unrelated/invalid files
    }
  }
  return out;
}
