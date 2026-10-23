import { expect, test, type Page } from "./test";

const SOURCE_LOADED = '"layout":"__playwright-smoke"';

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

/** Parses the possessed pawn's Z world position off the `?debug` game-mode block. */
async function pawnZ(stats: ReturnType<Page["locator"]>): Promise<number> {
  const text = (await stats.textContent()) ?? "";
  const match = text.match(/pos: [\-\d.]+ [\-\d.]+ ([\-\d.]+)/);
  return match ? Number.parseFloat(match[1]!) : Number.NaN;
}

/**
 * P1.6 (Actor Runtime API / A5.5): prove the runtime script-message pipeline is
 * observable end-to-end in the browser. Walking the possessed pawn into an
 * interaction sensor makes its `interact` behavior emit an "Interaction.Activated"
 * script message through the A6 message bus; with `?debug` the bus records a trace
 * that the overlay's "script messages" block renders — the browser-visible proof
 * the Actor Runtime API messaging path runs in a real play session.
 */
test("runtime script-message smoke: an interaction emits an observable script message", async ({
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

  await page.goto(`/?debug&scriptMessageSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await waitForConsoleText(page, consoleMessages, SOURCE_LOADED);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('[data-ui-id="speed-label"]')).toContainText("Speed");

  const stats = page.locator("#debug-stats");
  // The script-messages block mounts, and nothing has flowed through it yet.
  await expect(stats).toContainText("script messages");
  await expect(stats).not.toContainText("Interaction.Activated");

  // Walk forward (-Z) into the interaction sensor (z=-6), then stop before the
  // portal (z=-10) — releasing the key keeps the pawn parked in the sensor so the
  // bus trace persists (a level travel would rebuild the scene and clear it).
  await page.keyboard.down("KeyW");
  let z = 0;
  for (let i = 0; i < 80 && z > -6; i += 1) {
    await page.waitForTimeout(200);
    z = await pawnZ(stats);
  }
  await page.keyboard.up("KeyW");
  expect(z).toBeLessThan(-6); // reached the interaction sensor
  expect(z).toBeGreaterThan(-8); // stopped short of the portal (no travel)

  // The `interact` behavior emitted its script messages through the A6 bus; the
  // ?debug trace surfaces both the broadcast + the action-specific message.
  await expect(stats).toContainText("Interaction.Activated", { timeout: 10_000 });
  await expect(stats).toContainText("Interaction.activate");
  // The walk stopped at the interaction sensor — no level travel happened.
  expect(consoleMessages.some((m) => m.includes("-target"))).toBe(false);

  expect(pageErrors).toEqual([]);
});
