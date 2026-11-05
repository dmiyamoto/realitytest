/**
 * 9. API timeout / failure handling of the SAM client. Uses an injected fake
 * client — no network.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import { segmentVideo, SamApiError } from "@/lib/meta/sam";
import { verdictFromTracking } from "@/lib/evaluation/pipeline";
import { inconclusiveFromError } from "@/lib/evaluation/evaluator";

const VIDEO = path.resolve("public/samples/synthetic-pass.mp4");

function fakeClient(responses: (body: unknown, opts: { signal?: AbortSignal }) => Promise<unknown>) {
  const calls: unknown[] = [];
  const client = {
    files: { create: async () => ({ id: "file-test" }) },
    responses: {
      create: async (body: unknown, opts: { signal?: AbortSignal }) => {
        calls.push(body);
        return responses(body, opts);
      },
    },
  } as unknown as Pick<OpenAI, "files" | "responses">;
  return { client, calls };
}

describe("SAM client failures", () => {
  it("sends model sam-3.1 with input_text + input_video(file_id) and streams", async () => {
    const { client, calls } = fakeClient(async () =>
      (async function* () {
        yield { type: "response.output_text.done", item_id: "m", output_index: 0, content_index: 0, text: "" };
        yield { type: "response.completed" };
      })(),
    );
    const t = await segmentVideo({ videoPath: VIDEO, prompt: "red cube", client });
    const body = calls[0] as { model: string; stream: boolean; input: { content: { type: string; file_id?: string; text?: string }[] }[] };
    expect(body.model).toBe("sam-3.1");
    expect(body.stream).toBe(true);
    expect(body.input[0].content[0]).toEqual({ type: "input_text", text: "red cube" });
    expect(body.input[0].content[1]).toEqual({ type: "input_video", file_id: "file-test" });
    expect(t.provenance).toBe("live");
    expect(t.observations).toHaveLength(0);
  });

  it("times out and throws SamApiError (never a fabricated result)", async () => {
    const { client } = fakeClient(
      (_b, opts) =>
        new Promise((_, reject) => {
          opts.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    const err = await segmentVideo({ videoPath: VIDEO, prompt: "red cube", client, timeoutMs: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(SamApiError);
    expect(err.code).toBe("aborted");
  });

  it("maps HTTP errors to stable codes", async () => {
    const { client } = fakeClient(async () => {
      throw new OpenAI.APIError(401, { message: "bad key" }, "bad key", new Headers());
    });
    const err = await segmentVideo({ videoPath: VIDEO, prompt: "red cube", client }).catch((e) => e);
    expect(err).toBeInstanceOf(SamApiError);
    expect(err.code).toBe("unauthorized");
  });

  it("an upstream response.failed event yields INCONCLUSIVE, not PASS/FAIL", async () => {
    const { client } = fakeClient(async () =>
      (async function* () {
        yield { type: "response.failed", response: { error: { message: "internal" } } };
      })(),
    );
    let verdict: string;
    try {
      const t = await segmentVideo({ videoPath: VIDEO, prompt: "red cube", client });
      verdict = verdictFromTracking(t, { shape: "rect", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, 100).verdict;
    } catch (e) {
      expect(e).toBeInstanceOf(SamApiError);
      verdict = inconclusiveFromError("INC_API_FAILURE", (e as Error).message, 100).verdict;
    }
    expect(verdict).toBe("INCONCLUSIVE");
  });

  it("missing MODEL_API_KEY is a configuration error", async () => {
    const err = await segmentVideo({ videoPath: VIDEO, prompt: "red cube" }).catch((e) => e);
    expect(err).toBeInstanceOf(SamApiError);
    expect(err.code).toBe("sam_not_configured");
  });
});
