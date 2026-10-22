import { expect, test } from "@playwright/test";

test("packaged boot: missing WebGL2 shows an error and reload recovers", async ({ page }) => {
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
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("Forge needs WebGL2");
  await page.getByRole("button", { name: "Reload page" }).click();
  await expect(page.locator('[data-ui-id="instructions"]')).toContainText("Forge Starter");
  await expect(page.locator(".forge-loading")).toBeHidden();
  await expect(page.locator(".forge-boot-error")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("packaged boot: an unavailable runtime chunk shows the boot fallback", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(/\/assets\/ForgeRuntime-[^/]+\.js$/, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("packaged content: unsupported level version names the file and Retry recovers", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const pattern = "**/layouts/starter.level.json";
  await page.route(pattern, (route) => route.fulfill({ json: { schema: 99 } }));
  await page.goto("./");
  await expect(page.locator(".forge-loading-error")).toContainText("layouts/starter.level.json.schema: unsupported version 99");
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator('[data-ui-id="instructions"]')).toContainText("Forge Starter");
  await expect(page.locator(".forge-loading")).toBeHidden();
  expect(pageErrors).toEqual([]);
});
