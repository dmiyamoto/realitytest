/**
 * Tests the normalizer against the real SAM 3.1 wire format, decoded by the
 * official @meta-sam/parser. The sample record is read at test time from the
 * installed package's own README (not copied into this repository).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSegmentation, replayRawOutput } from "@/lib/meta/normalizer";
import { parseVideoStream } from "@meta-sam/parser";

function docSampleLine(): string {
  const readme = fs.readFileSync(path.resolve("node_modules/@meta-sam/parser/README.md"), "utf8");
  const m = readme.match(/const outputText =\s*\n([\s\S]*?);\n/);
  if (!m) throw new Error("parser README sample not found");
  // The sample is a JS string concatenation of single/double-quoted literals.
  const parts = [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1] ?? x[2]);
  return parts.join("").replace(/\\n/g, "\n");
}

const LINE = docSampleLine(); // "<0f>0<|box…|><|mask…|>,1<|box…|><|mask…|>\n"
const withFrame = (f: number) => LINE.replace(/^<0f>/, `<${f}f>`);

async function* events(text: string, chunk = 37) {
  for (let i = 0; i < text.length; i += chunk) {
    yield { type: "response.output_text.delta", item_id: "m", output_index: 0, content_index: 0, delta: text.slice(i, i + chunk) };
  }
  yield { type: "response.output_text.done", item_id: "m", output_index: 0, content_index: 0, text };
  yield { type: "response.completed" };
}

const ctx = { provenance: "live" as const, model: "sam-3.1", prompt: "button", requestedAt: "2026-01-01T00:00:00Z" };

describe("normalizer (@meta-sam/parser output)", () => {
  it("decodes real masks into mask-based centroids with stable object IDs", async () => {
    const result = await parseVideoStream(events(LINE)).finalResult;
    const t = normalizeSegmentation(result, ctx);
    expect(t.streamOutcome).toEqual({ status: "completed" });
    expect(t.observations.map((o) => o.objectId)).toEqual(["0", "1"]);
    const o0 = t.observations[0];
    expect(o0.frameIndex).toBe(0);
    expect(o0.box).toEqual({ left: 211, top: 228, right: 271, bottom: 255 });
    expect(o0.centroidSource).toBe("mask");
    expect(o0.centroid.x).toBeGreaterThan(211);
    expect(o0.centroid.x).toBeLessThan(271);
    expect(o0.centroid.y).toBeGreaterThan(228);
    expect(o0.centroid.y).toBeLessThan(255);
    expect(o0.maskArea).toBeGreaterThan(0);
    expect(o0.maskSvgPath).toMatch(/^M/);
  });

  it("6. preserves sparse, out-of-order frame indices from frame markers", async () => {
    const text = [withFrame(40), withFrame(41), withFrame(7), withFrame(3)].join("");
    const result = await parseVideoStream(events(text, 11)).finalResult;
    const t = normalizeSegmentation(result, ctx);
    const frames = [...new Set(t.observations.map((o) => o.frameIndex))];
    expect(frames).toEqual([3, 7, 40, 41]);
  });

  it("empty output (no matches) is a completed result with no observations", async () => {
    const result = await parseVideoStream(events("")).finalResult;
    const t = normalizeSegmentation(result, ctx);
    expect(t.streamOutcome.status).toBe("completed");
    expect(t.observations).toHaveLength(0);
  });

  it("reports malformed lines as diagnostics instead of inventing data", async () => {
    const result = await parseVideoStream(events("<5f>0<|box;garbage|>\n" + withFrame(6))).finalResult;
    const t = normalizeSegmentation(result, ctx);
    expect(t.observations.every((o) => o.frameIndex === 6)).toBe(true);
    expect(t.diagnostics.length).toBeGreaterThan(0);
  });

  it("stream without response.completed is reported as incomplete", async () => {
    async function* truncated() {
      yield { type: "response.output_text.delta", item_id: "m", output_index: 0, content_index: 0, delta: LINE };
    }
    const result = await parseVideoStream(truncated()).finalResult;
    const t = normalizeSegmentation(result, ctx);
    expect(t.streamOutcome.status).toBe("incomplete");
  });

  it("replayRawOutput labels results as recorded fixtures", async () => {
    const t = await replayRawOutput(withFrame(0) + withFrame(2), { model: "sam-3.1", prompt: "button", requestedAt: "x" });
    expect(t.provenance).toBe("fixture");
    expect(t.observations).toHaveLength(4);
  });
});
