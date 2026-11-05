/** Visual review screenshots. Runs only with SHOTS=<dir>. */
import { test, type BrowserContext, type Page } from "@playwright/test";
import { seedJob } from "./seed";

const dir = process.env.SHOTS;
test.skip(!dir, "set SHOTS=<dir> to capture screenshots");

async function sid(context: BrowserContext, page: Page) {
  await page.request.get("/api/session");
  return decodeURIComponent((await context.cookies()).find((c) => c.name === "rt_session")!.value).split(".")[0];
}

test("capture", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/landing.png`, fullPage: true });
  await page.goto("/evaluate?sample=synthetic-pass");
  await page.getByText("source 960×540px").waitFor();
  await page.getByTestId("use-suggested-zone").click();
  await page.getByTestId("confirm-zone").check();
  await page.screenshot({ path: `${dir}/evaluate.png`, fullPage: true });
  await page.goto("/pricing");
  await page.screenshot({ path: `${dir}/pricing.png`, fullPage: true });
  const s = await sid(context, page);
  for (const k of ["pass", "fail", "occluded"] as const) {
    const j = await seedJob(s, k);
    await page.goto(`/evaluations/${j.id}`);
    await page.waitForFunction(() => (document.querySelector("video") as HTMLVideoElement)?.readyState >= 2);
    await page.getByTestId("timeline").click({ position: { x: k === "occluded" ? 600 : 700, y: 5 } });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/result-${k}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: `${dir}/landing-mobile.png` });
});
