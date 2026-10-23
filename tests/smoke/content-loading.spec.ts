import { expect, test } from "./test";

for (const scenario of ["project-json", "project-version", "manifest-shape", "level-shape", "level-version"] as const) {
  test(`content failure: ${scenario} explains the file and Retry recovers`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const path = scenario.startsWith("project") ? "project.3dgame.json"
      : scenario.startsWith("manifest") ? "assets/manifest.json" : "layouts/__playwright-smoke.level.json";
    const routePattern = `**/${path}`;
    await page.route(routePattern, async (route) => {
      if (scenario === "project-json") {
        await route.fulfill({ contentType: "application/json", body: "{" });
        return;
      }
      const response = await route.fetch();
      const raw = await response.json();
      if (scenario.endsWith("version")) raw.schema = 99;
      else if (scenario === "manifest-shape") raw.assets = null;
      else raw.characters = "broken";
      await route.fulfill({ response, json: raw });
    });
    await page.goto("/");
    const error = page.locator(".forge-loading-error");
    await expect(error).toContainText("Failed to load the game");
    await expect(error).toContainText(path);
    await expect(error).toContainText(scenario.endsWith("version") ? "unsupported version"
      : scenario === "project-json" ? "invalid JSON" : scenario === "manifest-shape" ? "assets" : "characters");
    await expect(page.locator(".forge-boot-error")).toHaveCount(0);
    if (scenario === "level-shape") {
      await page.screenshot({ path: testInfo.outputPath("content-error-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath("content-error-narrow.png") });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await page.unroute(routePattern);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");
    await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });
}

test("content failure: malformed travel target names the level and Retry reloads", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await page.route("**/layouts/__playwright-smoke-target.level.json", (route) =>
    route.fulfill({ json: { schema: 1, name: "broken" } }));
  await page.keyboard.press("Escape", { delay: 150 });
  await page.locator('[data-ui-id="smoke-travel"]').click();
  await expect(page.locator(".forge-loading-error")).toContainText("Failed to load the level");
  await expect(page.locator(".forge-loading-error")).toContainText("__playwright-smoke-target.level.json");
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("content failure: damaged collision sidecars warn with paths while the game boots", async ({ page }) => {
  const warnings: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().startsWith("[content:")) warnings.push(message.text());
  });
  await page.route("**/*.collision.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "{" }));
  await page.goto("/");
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  expect(warnings.length).toBeGreaterThan(0);
  expect(warnings.every((message) => message.includes("[content:invalid-json]") && message.includes(".collision.json; using defaults"))).toBe(true);
  expect(new Set(warnings).size).toBe(warnings.length);
  expect(errors).toEqual([]);
});
