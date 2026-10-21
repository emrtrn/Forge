import { expect, test, type Page } from "./test";

const SOURCE_SCENE_NAME = "__playwright-smoke";
const TARGET_SCENE_NAME = "__playwright-smoke-target";

async function waitForConsoleText(
  page: Page,
  messages: readonly string[],
  text: string,
  count = 1,
): Promise<void> {
  const seen = () => messages.filter((message) => message.includes(text)).length;
  if (seen() >= count) return;
  await page.waitForEvent("console", {
    predicate: () => seen() >= count,
    timeout: 60_000,
  });
}

test("runtime playflow smoke: boot, save/load UI, travel", async ({
  page,
  context,
}) => {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];

  await context.addInitScript(() => {
    localStorage.clear();
  });

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    consoleMessages.push(text);
    if (message.type() === "error") pageErrors.push(text);
  });

  await page.goto(`/?debug&runtimeSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#ui-overlay")).toBeVisible();
  await waitForConsoleText(page, consoleMessages, SOURCE_SCENE_NAME);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-ui-id="title"]')).toContainText("Save / Load");
  await page.locator('[data-ui-id="quick-save"]').click();
  await expect(page.locator('[data-ui-id="quick-status"]')).toContainText(/^Saved /);
  await expect(page.locator('[data-ui-id="quick-level"]')).toContainText(
    "__playwright-smoke.level.json",
  );

  await page.locator('[data-ui-id="quick-load"]').click();
  await waitForConsoleText(page, consoleMessages, SOURCE_SCENE_NAME, 2);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-ui-id="title"]')).toContainText("Save / Load");
  await page.locator('[data-ui-id="smoke-travel"]').click();
  await waitForConsoleText(page, consoleMessages, TARGET_SCENE_NAME);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");

  expect(pageErrors).toEqual([]);
});
