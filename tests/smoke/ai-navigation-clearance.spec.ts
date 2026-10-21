import { expect, test, type Page } from "./test";

const SMOKE_PATROL_SCENE_NAME = "__playwright-smoke-patrol";

test.setTimeout(210_000);

async function waitForConsoleText(
  page: Page,
  messages: readonly string[],
  text: string,
): Promise<void> {
  const seen = () => messages.some((message) => message.includes(text));
  if (seen()) return;
  await page.waitForEvent("console", {
    predicate: () => seen(),
    timeout: 60_000,
  });
}

test("editor AI Navigation clearance overlay smoke: show toggle renders without browser errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(`/?editor&aiNavClearanceOverlaySmoke=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Show" }).hover();
  const aiNavToggle = page.locator('[data-show-flag="ai-navigation"]');
  await aiNavToggle.click();
  await expect(aiNavToggle).toHaveClass(/active/);
  await expect(page.locator("#game-canvas")).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("runtime AI Navigation clearance smoke: patrol path follows waypoints in debug overlay", async ({
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

  await page.goto(`/?debug&aiNavClearanceRuntimeSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#ui-overlay")).toBeVisible();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-ui-id="title"]')).toContainText("Save / Load");
  await page.locator('[data-ui-id="smoke-patrol"]').click();

  await waitForConsoleText(page, consoleMessages, SMOKE_PATROL_SCENE_NAME);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#debug-stats")).toContainText(/controllers: [1-9]/, {
    timeout: 30_000,
  });
  await expect(page.locator("#debug-stats")).toContainText(/ai nav \([1-9]\)/, {
    timeout: 30_000,
  });
  await expect(page.locator("#debug-stats")).toContainText(/following wp:\d+\/[2-9]\d*/, {
    timeout: 30_000,
  });
  await expect(page.locator("#debug-stats")).not.toContainText("failure");

  expect(pageErrors).toEqual([]);
});
