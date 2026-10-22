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

test("runtime AI spline smoke: travel to the test route, agent follows the closed spline", async ({
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
    consoleMessages.push(message.text());
  });

  // Travel from the corridor to the test-owned AI character and closed spline.
  await page.goto(`/?debug&aiPatrolSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#ui-overlay")).toBeVisible();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  // The runtime chunk loads after boot, so the overlay can be absent before the
  // level exists; the HUD proves input is wired before Escape is pressed.
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-ui-id="title"]')).toContainText("Save / Load");
  await page.locator('[data-ui-id="smoke-patrol"]').click();

  await waitForConsoleText(page, consoleMessages, SMOKE_PATROL_SCENE_NAME);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  // The AI remains a live controller and follows spline look-ahead targets through
  // navigation/CharacterMovement. It must not fall back to the kinematic follower.
  await expect(page.locator("#debug-stats")).toContainText(/controllers: [1-9]/, {
    timeout: 30_000,
  });
  await expect(page.locator("#debug-stats")).toContainText("ai nav (1)", {
    timeout: 30_000,
  });
  await expect(page.locator("#debug-stats")).not.toContainText("spline followers (1)");

  expect(pageErrors).toEqual([]);
});
