import { expect, test, type Page } from "./test";

const SOURCE_SCENE_NAME = "__playwright-smoke";

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

/** Parses the possessed pawn's Z world position off the `?debug` game-mode block. */
async function pawnZ(stats: ReturnType<Page["locator"]>): Promise<number> {
  const text = (await stats.textContent()) ?? "";
  const match = text.match(/pos: [\-\d.]+ [\-\d.]+ ([\-\d.]+)/);
  return match ? Number.parseFloat(match[1]!) : Number.NaN;
}

/** Current quick-slot status label off the `?debug` UI-fields block. */
async function quickStatus(stats: ReturnType<Page["locator"]>): Promise<string> {
  const text = (await stats.textContent()) ?? "";
  return text.match(/save\.slots\.quick\.status = "([^"]*)"/)?.[1] ?? "";
}

/**
 * P1.4: prove a *real* checkpoint sensor overlap autosaves the game, and that
 * loading that slot respawns the possessed pawn back at the checkpoint transform.
 * Uses the pawn's own physics body walking (keyboard-driven) into the trigger —
 * the exact player↔sensor overlap path that used to never fire.
 */
test("runtime checkpoint smoke: walking into the sensor autosaves + load respawns", async ({
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

  await page.goto(`/?debug&checkpointSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await waitForConsoleText(page, consoleMessages, SOURCE_SCENE_NAME);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");

  const stats = page.locator("#debug-stats");
  // Nothing saved at boot: the checkpoint sensor sits ahead on the walk line.
  await expect.poll(() => quickStatus(stats)).toBe("Empty");

  // Walk forward (-Z) until the checkpoint sensor overlap fires the autosave.
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => quickStatus(stats), { timeout: 15_000 })
    .toMatch(/^Saved /);
  const savedZ = await pawnZ(stats);
  expect(savedZ).toBeLessThan(-2); // crossed into the checkpoint volume
  // The autosave captured this level as its restore target.
  await expect(stats).toContainText("save.slots.quick.level = \"__playwright-smoke");

  // Keep walking a little past the checkpoint (but well short of the portal at
  // z=-8.5), then stop — the pawn is now clearly beyond the saved transform.
  await expect.poll(async () => pawnZ(stats), { timeout: 15_000 }).toBeLessThan(-6);
  await page.keyboard.up("KeyW");
  const beforeLoadZ = await pawnZ(stats);
  expect(beforeLoadZ).toBeLessThan(-6);
  // The walk stopped short of the portal: no level travel happened.
  expect(consoleMessages.some((m) => m.includes("-target"))).toBe(false);

  // Quick-load the checkpoint slot from the pause menu: the save round-trips
  // through a level load and restores the pawn to the checkpoint transform.
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-ui-id="title"]')).toContainText("Save / Load");
  await page.locator('[data-ui-id="quick-load"]').click();
  await waitForConsoleText(page, consoleMessages, SOURCE_SCENE_NAME, 2);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  // The pawn respawned back near the checkpoint (clearly forward of where it
  // stopped walking — the saved transform, not the last position).
  await expect
    .poll(async () => pawnZ(stats), { timeout: 15_000 })
    .toBeGreaterThan(beforeLoadZ + 1.5);

  expect(pageErrors).toEqual([]);
});
