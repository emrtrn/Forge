import { expect, test, type Page } from "./test";

const SOURCE_SCENE_NAME = "__playwright-smoke";

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

/** Reads the current planar-speed value (m/s) off the `?debug` game-mode block. */
async function planarSpeed(stats: ReturnType<Page["locator"]>): Promise<number> {
  const text = (await stats.textContent()) ?? "";
  const match = text.match(/planar:([\-\d.]+)/);
  return match ? Number.parseFloat(match[1]!) : Number.NaN;
}

/**
 * P1.2 + P1.5: prove the runtime gameplay loop responds to *real* keyboard input
 * and that the `?debug` overlay mounts its readouts. Keyboard events go on
 * `window` (see KeyboardInputSource), so this needs no pointer-lock / canvas
 * focus dance — it stays deterministic in headless Chromium.
 */
test("runtime locomotion smoke: keyboard drives the possessed pawn + debug overlay", async ({
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

  await page.goto(`/?debug&locomotionSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#ui-overlay")).toBeVisible();
  await waitForConsoleText(page, consoleMessages, SOURCE_SCENE_NAME);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");

  const stats = page.locator("#debug-stats");

  // P1.5 — the ?debug overlay mounts every runtime readout block without error.
  await expect(stats).toContainText("game mode");
  await expect(stats).toContainText("memory");
  await expect(stats).toContainText("budget");
  await expect(stats).toContainText("ui");
  await expect(stats).toContainText("script messages");
  // The Game Mode possessed a pawn and the input router is in gameplay mode
  // (not stuck on a menu/UI capture) at boot.
  await expect(stats).toContainText(/possessed: actor:/);
  await expect(stats).toContainText("input: game");

  // Baseline: standing still, the possessed pawn has no planar speed.
  await expect
    .poll(async () => planarSpeed(stats), { timeout: 10_000 })
    .toBeLessThan(0.1);

  // P1.2 — holding a movement key drives real planar locomotion.
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => planarSpeed(stats), { timeout: 10_000 })
    .toBeGreaterThan(1);
  await page.keyboard.up("KeyW");

  // Releasing the key brings the pawn back to rest (grounded, no planar speed).
  await expect
    .poll(async () => planarSpeed(stats), { timeout: 10_000 })
    .toBeLessThan(0.1);
  await expect(stats).toContainText("(grounded)");

  // P1.2 — jumping flips the movement state to airborne with a live vertical
  // velocity, proving the jump/grounded transition is observable.
  await page.keyboard.press("Space");
  await expect(stats).toContainText("(airborne)", { timeout: 5_000 });

  // Back on the ground once the jump arc completes.
  await expect(stats).toContainText("(grounded)", { timeout: 10_000 });

  expect(pageErrors).toEqual([]);
});
