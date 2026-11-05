/** BILLING_ENABLED unset (the default): no Stripe routes, free capped live runs. */
import path from "node:path";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createEval } from "@/app/api/evaluations/route";
import { POST as checkout } from "@/app/api/checkout/route";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { GET as session } from "@/app/api/session/route";
import { prisma } from "@/lib/server/db";
import { freeLimit } from "@/lib/server/jobs";
import { billingEnabled } from "@/lib/billing/flag";
import { rectToPolygon } from "@/lib/evaluation/geometry";

const ZONE = JSON.stringify({ shape: "rect", points: rectToPolygon({ x: 600, y: 330 }, { x: 860, y: 470 }) });

function form() {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ objectPrompt: "red cube", targetZone: ZONE, zoneConfirmed: "true", mode: "live", source: "synthetic-pass" })) fd.set(k, v);
  return fd;
}

describe("billing disabled (default)", () => {
  beforeEach(() => {
    delete process.env.BILLING_ENABLED;
  });
  afterEach(() => {
    process.env.BILLING_ENABLED = "true";
    delete process.env.FREE_EVALUATIONS_PER_SESSION;
    delete process.env.MODEL_API_KEY;
  });

  it("is off unless BILLING_ENABLED=true", () => {
    expect(billingEnabled()).toBe(false);
    process.env.BILLING_ENABLED = "1";
    expect(billingEnabled()).toBe(false);
    process.env.BILLING_ENABLED = "true";
    expect(billingEnabled()).toBe(true);
  });

  it("checkout and webhook answer 404 billing_disabled", async () => {
    const c = await checkout(new Request("http://localhost/api/checkout", { method: "POST" }));
    expect(c.status).toBe(404);
    expect((await c.json()).error.code).toBe("billing_disabled");
    const w = await webhook(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}" }));
    expect(w.status).toBe(404);
  });

  it("session reports billing off with a 20-run default allowance", async () => {
    expect(freeLimit()).toBe(20);
    const res = await session(new Request("http://localhost/api/session"));
    const body = await res.json();
    expect(body.billingEnabled).toBe(false);
    expect(body.freeRemaining).toBe(20);
  });

  it("past the per-session cap, live runs get 429 (never 402, never a debit)", async () => {
    process.env.MODEL_API_KEY = "test-key-not-used";
    process.env.FREE_EVALUATIONS_PER_SESSION = "1";
    const first = await createEval(new Request("http://localhost/api/evaluations", { method: "POST", body: form() }));
    expect(first.status).toBe(201);
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    const { id } = await first.json();
    await prisma.evaluationJob.update({ where: { id }, data: { status: "completed" } });

    const second = await createEval(new Request("http://localhost/api/evaluations", { method: "POST", body: form(), headers: { cookie } }));
    expect(second.status).toBe(429);
    expect((await second.json()).error.code).toBe("free_limit_reached");
    const sessionId = decodeURIComponent(cookie.split("=")[1]).split(".")[0];
    expect(await prisma.creditLedger.count({ where: { sessionId } })).toBe(0);
    expect(fs.existsSync(path.resolve("public/samples/synthetic-pass.mp4"))).toBe(true);
  });
});
