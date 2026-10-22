import { expect, test } from "@playwright/test";

for (const debug of [false, true]) {
test(`packaged runtime${debug ? " with debug" : ""}: model, texture, terrain, save/load and level travel`, async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [], messages: string[] = [], loaded = new Set<string>();
  const outsideBase: string[] = [];
  const base = new URL(baseURL!);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error" && !message.text().includes("favicon.ico")) errors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) outsideBase.push(request.url());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith("favicon.ico")) return;
    if (response.status() >= 400) errors.push(`${response.status()} ${url.pathname}`);
    else loaded.add(url.pathname.slice(base.pathname.length));
  });
  page.on("requestfailed", (request) => errors.push(`${request.failure()?.errorText} ${request.url()}`));
  await page.goto(debug ? "./?debug" : "./");
  await expect(page.locator('[data-ui-id="instructions"]')).toContainText("Forge Starter");
  await expect(page.locator(".forge-loading")).toBeHidden();
  await expect.poll(() => messages.some((text) => text.includes("ReleaseStarter"))).toBe(true);
  if (debug) await expect(page.locator("#debug-stats")).toContainText(/\d+ fps/);
  for (const file of ["project.3dgame.json", "assets/manifest.json", "layouts/starter.level.json", "assets/release/cube.gltf", "assets/release/cube.bin", "assets/release/checker.png", "assets/release/checker.material.json", "landscapes/starter.landscape.json"]) {
    expect(loaded.has(file), `loaded ${file}`).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("starter.png") });
  // ActionMap samples held keys per frame. Hold a human-length key press so a
  // cold software-rendered frame cannot swallow an instantaneous down/up pair.
  await page.keyboard.press("Escape", { delay: 150 });
  await expect(page.locator('[data-ui-id="title"]')).toHaveText("Starter Menu");
  await page.screenshot({ path: testInfo.outputPath("menu.png") });
  await page.locator('[data-ui-id="resume"]').click();
  await expect(page.locator('[data-ui-id="title"]')).toBeHidden();
  await page.keyboard.press("Escape", { delay: 150 });
  await expect(page.locator('[data-ui-id="title"]')).toHaveText("Starter Menu");
  await page.locator('[data-ui-id="quick-save"]').click();
  await expect(page.locator('[data-ui-id="quick-status"]')).toContainText(/^Saved /);
  await expect(page.locator('[data-ui-id="quick-level"]')).toContainText("starter.level.json");
  const initialLoads = messages.filter((text) => text.includes("ReleaseStarter")).length;
  await page.locator('[data-ui-id="quick-load"]').click();
  await expect.poll(() => messages.filter((text) => text.includes("ReleaseStarter")).length).toBeGreaterThan(initialLoads);
  await expect(page.locator(".forge-loading")).toBeHidden();
  await page.keyboard.press("Escape", { delay: 150 });
  await expect(page.locator('[data-ui-id="title"]')).toHaveText("Starter Menu");
  await page.locator('[data-ui-id="travel"]').click();
  await expect.poll(() => messages.some((text) => text.includes("ReleaseDestination"))).toBe(true);
  await expect(page.locator(".forge-loading")).toBeHidden();
  await page.keyboard.press("Escape", { delay: 150 });
  await expect(page.locator('[data-ui-id="title"]')).toHaveText("Starter Menu");
  await page.locator('[data-ui-id="home"]').click();
  await expect.poll(() => messages.filter((text) => text.includes("ReleaseStarter")).length).toBeGreaterThan(initialLoads + 1);
  await expect(page.locator(".forge-loading")).toBeHidden();
  await expect(page.locator('[data-ui-id="instructions"]')).toBeVisible();
  // Negative check: this server never serves a missing JSON URL as index.html.
  expect((await page.request.get(new URL("missing.level.json", baseURL).href)).status()).toBe(404);
  expect(outsideBase).toEqual([]);
  expect(errors).toEqual([]);
});
}
