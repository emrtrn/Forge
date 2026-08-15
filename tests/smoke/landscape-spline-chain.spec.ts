import { expect, test } from "@playwright/test";

test("editor and Play render the authored asphalt spline chain without browser errors", async ({ page }, testInfo) => {
  let pageErrors: string[] = [];
  const consoleMessages: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    consoleMessages.push(message.text());
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto("/?editor&debug");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator("#debug-stats")).toContainText(/\d+ draw calls\n\d+ tris/, { timeout: 20_000 });

  const landscape = page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first();
  await landscape.click();
  // Type-specific controls identify the selection; the shared Details chrome
  // (`finalizeDetailsRender`) strips the `.detail-heading` the renderer emits.
  await expect(
    page.locator('[data-inspector-pane="details"] [data-landscape-mode="splines"]'),
  ).toBeVisible();
  await page.locator('[data-landscape-mode="splines"]').click();
  await page.keyboard.press("f");
  // The editor's post-process OutputPass reports its fullscreen triangle in
  // WebGL's final-frame counters, so draw-call counts here cannot represent the
  // scene mesh count. The engine check covers the one-mesh chain invariant.
  await page.waitForTimeout(1_000);

  const spline = await page.evaluate(async () => {
    const response = await fetch(`/landscapes/landscape-1.landscape.json?splineChain=${Date.now()}`);
    if (!response.ok) throw new Error(`Landscape sidecar fetch failed: ${response.status}`);
    return (await response.json()) as {
      splines?: Array<{ segments: Array<{ mesh?: { enabled?: boolean; assetId?: string; deform?: boolean } }> }>;
    };
  });
  const segments = spline.splines?.[0]?.segments ?? [];
  expect(segments).toHaveLength(2);
  expect(segments.every((segment) => segment.mesh?.enabled && segment.mesh.assetId === "sm-asphalt" && segment.mesh.deform)).toBeTruthy();

  await canvas.screenshot({ path: testInfo.outputPath("asphalt-spline-chain.png") });
  expect(pageErrors).toEqual([]);

  pageErrors = [];
  consoleMessages.length = 0;
  await page.goto("/?debug");
  await expect(page.locator("#game-canvas")).toBeVisible({ timeout: 30_000 });
  await expect.poll(
    () => consoleMessages.some((message) => message.includes("[runtime] scene loaded")),
    { timeout: 60_000 },
  ).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#debug-stats")).toContainText("draw calls");
  await page.locator("#game-canvas").screenshot({ path: testInfo.outputPath("asphalt-spline-chain-play.png") });
  expect(pageErrors).toEqual([]);
});
