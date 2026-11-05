import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { seedJob } from "./seed";

async function sessionId(context: BrowserContext, page: Page): Promise<string> {
  await page.request.get("/api/session");
  const c = (await context.cookies()).find((x) => x.name === "rt_session");
  expect(c, "guest session cookie").toBeTruthy();
  expect(c!.httpOnly).toBe(true);
  return decodeURIComponent(c!.value).split(".")[0];
}

test("landing page explains the product and links to the demo @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Unit tests for the/ })).toBeVisible();
  await expect(page.getByText("A pass and a fail")).toBeVisible();
  await expect(page.getByText("Free and open source.")).toBeVisible();
  // no horizontal overflow at any viewport
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByTestId("hero-try-demo").click();
  await expect(page).toHaveURL(/\/evaluate/);
});

test("draw a target zone: display coordinates map to source pixels", async ({ page }) => {
  await page.goto("/evaluate?sample=synthetic-fail");
  await expect(page.getByText("source 960×540px")).toBeVisible({ timeout: 15_000 });
  const canvas = page.getByTestId("zone-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  // Element is aspect-video, so content fills it: scale = width / 960.
  const s = box.width / 960;
  const toPage = (x: number, y: number) => ({ x: box.x + x * s, y: box.y + (box.height - 540 * s) / 2 + y * s });
  const a = toPage(600, 330);
  const b = toPage(860, 470);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const coords = await page.getByTestId("zone-coords").textContent();
  const nums = coords!.match(/\((\d+),(\d+)\)/g)!.map((p) => p.slice(1, -1).split(",").map(Number));
  expect(nums).toHaveLength(4);
  const xs = nums.map((p) => p[0]);
  const ys = nums.map((p) => p[1]);
  expect(Math.abs(Math.min(...xs) - 600)).toBeLessThanOrEqual(2);
  expect(Math.abs(Math.max(...xs) - 860)).toBeLessThanOrEqual(2);
  expect(Math.abs(Math.min(...ys) - 330)).toBeLessThanOrEqual(2);
  expect(Math.abs(Math.max(...ys) - 470)).toBeLessThanOrEqual(2);

  // Run stays disabled until the zone is confirmed — and here, because neither
  // live inference (no MODEL_API_KEY) nor a recorded fixture is available.
  await expect(page.getByTestId("run-evaluation")).toBeDisabled();
  await page.getByTestId("confirm-zone").check();
  await expect(page.getByTestId("mode-live")).toBeDisabled();
  await expect(page.getByTestId("mode-live")).toContainText("MODEL_API_KEY is not configured");
});

test("invalid upload is rejected by the server", async ({ page }) => {
  const res = await page.request.post("/api/evaluations", {
    multipart: {
      source: "upload",
      objectPrompt: "red cube",
      targetZone: JSON.stringify({ shape: "rect", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }),
      mode: "live",
      zoneConfirmed: "true",
      file: { name: "fake.mp4", mimeType: "video/mp4", buffer: Buffer.from("definitely not a video") },
    },
  });
  // Live is unavailable in E2E; either way nothing is accepted.
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

for (const [kind, verdict] of [
  ["pass", "PASS"],
  ["fail", "FAIL"],
  ["occluded", "INCONCLUSIVE"],
] as const) {
  test(`results page shows ${verdict} evidence`, async ({ page, context }) => {
    const sid = await sessionId(context, page);
    const job = await seedJob(sid, kind);
    expect(job.verdict).toBe(verdict);
    await page.goto(`/evaluations/${job.id}`);
    await expect(page.getByTestId("verdict").first()).toHaveAttribute("data-verdict", verdict);
    await expect(page.getByTestId("provenance")).toContainText("not model output");
    await expect(page.getByTestId("verdict-reason")).not.toBeEmpty();
    await expect(page.getByTestId("limitations")).toContainText("3D");
    await expect(page.getByTestId("diagnostics")).toContainText("tracking coverage");
    await expect(page.getByTestId("overlay-canvas")).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeVisible();
    if (verdict !== "INCONCLUSIVE") {
      await expect(page.getByTestId("decisive-frames")).toContainText("235");
    }
    // The video actually loads and the overlay paints pixels.
    await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement)?.readyState >= 2);
    await page.getByTestId("timeline").click({ position: { x: 5, y: 5 } });
    const painted = await page.evaluate(() => {
      const c = document.querySelector("[data-testid=overlay-canvas]") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    expect(painted).toBeGreaterThan(1000);
  });
}

test("14. another session cannot see a private evaluation", async ({ page, context, browser }) => {
  const sid = await sessionId(context, page);
  const job = await seedJob(sid, "pass");
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(`/evaluations/${job.id}`);
  await expect(p2.getByText(/could not be found|404/i).first()).toBeVisible();
  await expect(p2.getByTestId("verdict")).toHaveCount(0);
  const api = await p2.request.get(`/api/evaluations/${job.id}`);
  expect(api.status()).toBe(404);
  await other.close();
});

test("billing off (default): no pricing link, pricing page says so, Stripe routes 404", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Free and open source." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" })).toHaveCount(0);

  await page.goto("/pricing");
  await expect(page.getByTestId("billing-disabled")).toContainText("Billing is turned off");
  await expect(page.getByTestId("buy-credits")).toHaveCount(0);

  const checkout = await page.request.post("/api/checkout");
  expect(checkout.status()).toBe(404);
  const hook = await page.request.post("/api/stripe/webhook", { data: "{}" });
  expect(hook.status()).toBe(404);
  const s = await (await page.request.get("/api/session")).json();
  expect(s.billingEnabled).toBe(false);
  expect(s.credits).toBe(0);
});

test("after a run, going back to /evaluate leaves the form usable (not stuck on Submitting…)", async ({ page }) => {
  await page.goto("/evaluate");
  await page.getByText("source 960×540px").waitFor();
  await page.getByTestId("use-suggested-zone").click();
  await page.getByTestId("confirm-zone").check();
  await page.getByTestId("mode-fixture").click();
  await page.getByTestId("run-evaluation").click();
  await page.waitForURL(/\/evaluations\//);
  const first = page.url();
  await page.getByRole("link", { name: "Evaluate", exact: true }).click();
  await page.waitForURL(/\/evaluate$/);
  await expect(page.getByTestId("run-evaluation")).toHaveText("Run evaluation");

  await page.getByTestId("sample-synthetic-fail").click();
  await page.getByTestId("use-suggested-zone").click();
  await page.getByTestId("confirm-zone").check();
  await page.getByTestId("mode-fixture").click();
  await page.getByTestId("run-evaluation").click();
  await page.waitForURL((u) => /\/evaluations\//.test(u.pathname) && u.href !== first);
});
