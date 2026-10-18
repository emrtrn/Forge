import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

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
const VEHICLE_ASSET = "assets/starter-content/Gameplay/ReferenceCar.vehicle.json";
const VEHICLE_ACTOR = "assets/starter-content/Gameplay/Script_ReferenceCar.actor.json";

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

async function openVehicleTest(page: Page): Promise<string[]> {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];

  await page.context().addInitScript(() => {
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
  return pageErrors;
}

test("vehicle smoke: the Reference Car is possessed and drives on W", async ({ page }) => {
  const assetResponse = page.waitForResponse((response) => response.url().endsWith(VEHICLE_ASSET));
  const pageErrors = await openVehicleTest(page);
  expect((await assetResponse).ok()).toBe(true);
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

test("vehicle asset save endpoint persists normalized data and reports dropped fields", async ({ request }) => {
  const path = `assets/__vehicle-smoke-${randomUUID()}.vehicle.json`;
  try {
    expect((await request.get("/__save-vehicle")).status()).toBe(405);
    const response = await request.post("/__save-vehicle", { data: {
      path, vehicle: { schema: 1, type: "vehicle", massKg: 950, extra: true },
    } });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ ok: true, changed: true, dropped: ["vehicle.extra"] });
    const saved = JSON.parse(await readFile(resolve("public", path), "utf8"));
    expect(saved.massKg).toBe(950);
    expect(saved.wheels).toHaveLength(4);
    expect(saved.extra).toBeUndefined();
    const staticRead = await request.get(`/${path}`);
    expect(await staticRead.json()).toEqual(saved);
    const repeat = await request.post("/__save-vehicle", { data: { path, vehicle: saved } });
    expect(await repeat.json()).toMatchObject({ ok: true, changed: false, dropped: [] });
    for (const bad of ["../escape.vehicle.json", "assets/other.json"]) {
      expect((await request.post("/__save-vehicle", { data: { path: bad, vehicle: saved } })).status()).toBe(400);
    }
    expect((await request.post("/__save-vehicle", { data: {
      path, vehicle: { schema: 99, type: "vehicle" },
    } })).status()).toBe(400);
    expect(JSON.parse(await readFile(resolve("public", path), "utf8"))).toEqual(saved);
  } finally {
    await rm(resolve("public", path), { force: true });
  }
});

test("vehicle asset controls the engine force and inline actor props override it", async ({ page }) => {
  let inlineOverride = false;
  await page.route(`**/${VEHICLE_ASSET}`, async (route) => {
    const response = await route.fetch();
    const asset = await response.json();
    await route.fulfill({ response, json: { ...asset, maxEngineForce: 0 } });
  });
  await page.route(`**/${VEHICLE_ACTOR}`, async (route) => {
    const response = await route.fetch();
    const actor = await response.json();
    if (inlineOverride) {
      actor.components.find((node: { component: string }) => node.component === "Vehicle").props.maxEngineForce = 6000;
    }
    await route.fulfill({ response, json: actor });
  });
  const pageErrors = await openVehicleTest(page);
  await expect.poll(async () => Math.abs((await readVehicleCamera(page)).kmh)).toBeLessThan(2);
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(3000);
  expect(Math.abs((await readVehicleCamera(page)).kmh)).toBeLessThan(2);
  await page.keyboard.up("KeyW");

  inlineOverride = true;
  await page.reload();
  await expect(page.locator("#debug-stats")).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 60_000 });
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await readVehicleCamera(page)).kmh, { timeout: 15_000 }).toBeGreaterThan(20);
  await page.keyboard.up("KeyW");
  expect(pageErrors).toEqual([]);
});
