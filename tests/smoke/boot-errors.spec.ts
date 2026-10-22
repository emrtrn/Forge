import { expect, test } from "./test";

for (const mode of ["runtime", "editor"] as const) {
  test(`${mode}: missing WebGL2 shows boot error and reload recovers`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      if (sessionStorage.getItem("boot-context-failed")) return;
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args) {
        if (args[0] === "webgl2") {
          sessionStorage.setItem("boot-context-failed", "true");
          return null;
        }
        return Reflect.apply(original, this, args);
      } as typeof original;
    });
    await page.goto(mode === "editor" ? "/?editor" : "/");
    const error = page.getByRole("alert");
    await expect(error).toContainText("Forge needs WebGL2");
    await expect(error).toBeFocused();
    await error.getByText("Error details", { exact: true }).click();
    await expect(error.locator("pre")).toContainText("WebGL2 is not supported");
    await page.screenshot({ path: testInfo.outputPath(`${mode}-boot-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(error.getByRole("button", { name: "Reload page" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`${mode}-boot-narrow.png`) });
    await page.setViewportSize({ width: 1280, height: 720 });
    // Exercise the recovery with keyboard input, including focus from the panel.
    await error.focus();
    await page.keyboard.press("Tab");
    await expect(error.locator("summary")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(error.getByRole("button", { name: "Reload page" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(error).toHaveCount(0);
    if (mode === "editor") {
      await expect(page.locator(".editor-shell")).toBeVisible();
    } else {
      await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");
      await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
    }
    expect(pageErrors).toEqual([]);
  });

  test(`${mode}: critical module failure shows a readable boot error`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const modulePath = mode === "editor" ? "src/editor/EditorUi.ts" : "src/scene/ForgeRuntime.ts";
    const diagnostic = 'Module unavailable <img src=x onerror="window.bootInjected=true">';
    await page.route(`**/${modulePath}`, (route) => route.fulfill({
      contentType: "application/javascript",
      body: `throw new Error(${JSON.stringify(diagnostic)});`,
    }));
    await page.goto(mode === "editor" ? "/?editor" : "/");
    const error = page.getByRole("alert");
    await expect(error).toContainText("Check your connection");
    await error.getByText("Error details", { exact: true }).click();
    await expect(error.locator("pre")).toHaveText(diagnostic);
    await expect(error.locator("img")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
}

test("unexpected renderer initialization error has a boot fallback", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args) {
      if (args[0] === "webgl2") throw new Error("Injected graphics initialization failure");
      return Reflect.apply(original, this, args);
    } as typeof original;
  });
  await page.goto("/");
  const error = page.getByRole("alert");
  await expect(error).toContainText("Forge could not finish starting");
  await error.getByText("Error details", { exact: true }).click();
  await expect(error.locator("pre")).toHaveText("Injected graphics initialization failure");
  expect(pageErrors).toEqual([]);
});

test("project loading failure keeps the runtime Retry flow", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const manifestRoute = "**/project.3dgame.json";
  await page.route(manifestRoute, (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/");
  await expect(page.locator(".forge-loading-error")).toContainText("Failed to load the game");
  await expect(page.locator(".forge-boot-error")).toHaveCount(0);
  await page.unroute(manifestRoute);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator(".forge-boot-error")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
