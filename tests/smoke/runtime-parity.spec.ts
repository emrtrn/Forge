import { expect, test, type Page } from "@playwright/test";

/**
 * Phase H (D): the RuntimeParity level renders in a real browser.
 *
 * The headless checks prove the fixture serializes and instantiates; this one
 * proves the last mile — that a level of pure *scene content* (terrain, static
 * meshes with a material override, lights + shadows, sky/fog/clouds/post, an
 * auto-playing effect, a placed Actor Script) boots through the shared pipeline
 * with **no gameplay authored into it and no scene setup code**, which is the
 * plan's Definition of Done for a zero-gameplay game module.
 *
 * The level ships committed and is used as-is: the smoke reaches it through the
 * pause menu's travel button rather than rewriting it, so what renders here is
 * exactly what a fork would open.
 */
const PARITY_LOADED = '"layout":"RuntimeParity"';

test.setTimeout(210_000);

async function waitForConsoleText(
  page: Page,
  messages: readonly string[],
  text: string,
): Promise<void> {
  const seen = () => messages.some((message) => message.includes(text));
  if (seen()) return;
  await page.waitForEvent("console", { predicate: () => seen(), timeout: 60_000 });
}

test("runtime parity smoke: the RuntimeParity level builds and renders with no gameplay", async ({
  page,
  context,
}) => {
  const consoleMessages: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];

  await context.addInitScript(() => {
    localStorage.clear();
  });

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    consoleMessages.push(text);
    if (message.type() === "warning") consoleWarnings.push(text);
    if (message.type() === "error") pageErrors.push(text);
  });

  await page.goto(`/?debug&parritySmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-ui-id="title"]')).toContainText("Save / Load");
  await page.locator('[data-ui-id="smoke-parity"]').click();

  await waitForConsoleText(page, consoleMessages, PARITY_LOADED);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  const stats = page.locator("#debug-stats");
  // The scene actually rasterises: static meshes, terrain chunks and the sky
  // dome all issue draw calls, so a level that "loaded" but built nothing would
  // sit at a near-empty frame.
  await expect(stats).toContainText(/[1-9]\d* draw calls/, { timeout: 30_000 });
  await expect(stats).toContainText(/[1-9]\d* tris/);

  // The authored emitter auto-plays: one live VFX instance with particles alive.
  await expect(stats).toContainText(/active:[1-9]/, { timeout: 30_000 });
  await expect(stats).toContainText(/alive:[1-9]/, { timeout: 30_000 });

  // No gameplay: the level authors no Game Mode, so the built-in camera mode
  // runs and possesses nothing. This is the DoD state — scene content only.
  await expect(stats).toContainText("mode: Default Camera");
  await expect(stats).toContainText("possessed: none");

  // Every capability the level's authored data needs is registered, so the
  // Phase G coverage report stays silent (a level whose emitter or actor had no
  // capability would name it here).
  expect(
    consoleWarnings.filter((warning) => warning.includes("Unsupported runtime capability")),
  ).toEqual([]);
  expect(pageErrors).toEqual([]);
});
