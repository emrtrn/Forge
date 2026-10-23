import { expect, test, type Page } from "./test";

// The target scene name contains the source name as a prefix, so match the
// scene-loaded log's exact `"layout":"…"` field to tell the two levels apart.
const SOURCE_LOADED = '"layout":"__playwright-smoke"';
const TARGET_LOADED = '"layout":"__playwright-smoke-target"';

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

/**
 * P1.3: prove a *real* `level-travel` sensor round-trips. The pawn walks into a
 * portal volume, the destination level loads, and a second portal in the arrival
 * scene fires a return travel in the same session — exercising both the
 * player↔sensor overlap path and the fresh-per-scene behavior registry (the same
 * trigger id must be able to fire again on a new scene visit).
 */
test("runtime portal smoke: walk into a level-travel sensor and round-trip back", async ({
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

  const stats = page.locator("#debug-stats");
  // Waits until a fresh scene has possessed its pawn, so a walk key isn't pressed
  // before the arrival pawn exists (input is held, but movement needs possession).
  const waitForPossessedPawn = async (): Promise<void> => {
    await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
    await expect(stats).toContainText(/possessed: actor:/, { timeout: 15_000 });
  };

  await page.goto(`/?debug&portalSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await waitForConsoleText(page, consoleMessages, SOURCE_LOADED);
  await waitForPossessedPawn();
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");

  // Walk forward (-Z) into the portal sensor: the target level loads.
  await page.keyboard.down("KeyW");
  await waitForConsoleText(page, consoleMessages, TARGET_LOADED);
  await page.keyboard.up("KeyW");
  await waitForPossessedPawn();
  expect(consoleMessages.filter((m) => m.includes(TARGET_LOADED)).length).toBe(1);

  // On the arrival scene, walk into the return portal: source loads a second time,
  // proving the return trigger (a same-id `level-travel` sensor) fires again.
  await page.keyboard.down("KeyW");
  await waitForConsoleText(page, consoleMessages, SOURCE_LOADED, 2);
  await page.keyboard.up("KeyW");
  await waitForPossessedPawn();

  expect(pageErrors).toEqual([]);
});
