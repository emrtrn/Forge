import { expect, test, type Page } from "@playwright/test";

/**
 * Vehicle plan Faz 1b: the starter Reference Car drives in a real browser.
 *
 * The headless checks prove the physics (suspension, drive, brake) and the
 * Game Mode against fakes; this one proves the wiring in between — that the
 * committed `VehicleTest` level boots, the `Vehicle` component on the placed
 * actor becomes a Rapier vehicle, `forge.vehicle` possesses it, the default
 * key bindings reach it through the fixed-step world, and the wheel capability
 * hangs its wheels without a page error.
 *
 * The level is opened by rewriting the project manifest's `defaultScene` in
 * flight, so neither the committed project file nor the shared smoke setup is
 * touched.
 */
const VEHICLE_LEVEL = "assets/starter-content/Levels/VehicleTest.level.json";
const VEHICLE_LOADED = '"layout":"VehicleTest"';

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

/** The vehicle mode publishes its pawn and speed on the overlay's `camera:` line. */
async function readVehicleCamera(page: Page): Promise<{ pawn: string; kmh: number }> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/vehicle-chase pawn:(\S+) speed:(-?\d+)km\/h/);
  if (!match) throw new Error(`no vehicle camera readout in the overlay:\n${text}`);
  return { pawn: match[1]!, kmh: Number(match[2]) };
}

test("vehicle smoke: the Reference Car is possessed and drives on W", async ({ page, context }) => {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];

  await context.addInitScript(() => {
    localStorage.clear();
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = (await response.json()) as { editor: { defaultScene: string } };
    project.editor.defaultScene = VEHICLE_LEVEL;
    await route.fulfill({ response, json: project });
  });

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    consoleMessages.push(message.text());
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(`/?debug&vehicleSmoke=${Date.now()}`);
  await expect(page.locator("#game-canvas")).toBeVisible();
  await waitForConsoleText(page, consoleMessages, VEHICLE_LOADED);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText("mode: Vehicle", { timeout: 30_000 });
  await expect(stats).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });
  // Parked: the car settled on its suspension and is not creeping.
  await expect.poll(async () => Math.abs((await readVehicleCamera(page)).kmh)).toBeLessThan(2);

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => (await readVehicleCamera(page)).kmh, { timeout: 15_000 })
    .toBeGreaterThan(20);
  await page.keyboard.up("KeyW");

  // Brake to a stop, then keep holding: it reverses.
  await page.keyboard.down("KeyS");
  await expect
    .poll(async () => (await readVehicleCamera(page)).kmh, { timeout: 20_000 })
    .toBeLessThan(-2);
  await page.keyboard.up("KeyS");

  expect(pageErrors).toEqual([]);
});
