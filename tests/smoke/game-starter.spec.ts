import { expect, test, type Page } from "@playwright/test";

/**
 * Phase H, Definition of Done: the zero-gameplay `templates/game-starter` app
 * opens the RuntimeParity level and shows its content — terrain, meshes,
 * materials, lights, environment, VFX, a placed actor — **without a single line
 * of scene-setup code and without a game module**.
 *
 * This is the plan's central claim (I1/I4) put in front of a real browser: the
 * page under test is the starter's own `index.html` → `main.ts`, three calls
 * long, not the template's composition root. If a scene feature ever needs a
 * game to wire it up again, this smoke is what fails.
 */
const STARTER_URL = "/templates/game-starter/index.html";
const STARTER_LEVEL_LOADED = '"layout":"main"';

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

test("game-starter smoke: a zero-gameplay app renders the parity level end to end", async ({
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

  await page.goto(`${STARTER_URL}?debug&starterSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await waitForConsoleText(page, consoleMessages, STARTER_LEVEL_LOADED);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  const stats = page.locator("#debug-stats");
  // The level's scene content rasterises: static meshes, terrain chunks, sky.
  await expect(stats).toContainText(/[1-9]\d* draw calls/, { timeout: 30_000 });
  await expect(stats).toContainText(/[1-9]\d* tris/);
  // Its authored effect auto-plays — a Layer 2 capability doing its job for a
  // game that never mentioned VFX.
  await expect(stats).toContainText(/active:[1-9]/, { timeout: 30_000 });
  await expect(stats).toContainText(/alive:[1-9]/, { timeout: 30_000 });

  // No game module at all: nothing publishes a Game Mode catalog, so the runtime
  // starts no session and possesses nothing — and the level still renders. That
  // is exactly the "scene content is never gameplay's responsibility" claim.
  await expect(stats).toContainText("mode: —");
  await expect(stats).toContainText("possessed: none");

  expect(pageErrors).toEqual([]);
});
