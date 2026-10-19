import { expect, test, type Page } from "@playwright/test";
import assert from "node:assert/strict";
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
 * touched. Each test also picks the level's Game Mode in flight, so the mode
 * the level happens to be authored with does not decide what is tested.
 */
const VEHICLE_LEVEL = "assets/starter-content/Levels/VehicleTest.level.json";
const VEHICLE_LOADED = '"layout":"VehicleTest"';
const VEHICLE_ASSET = "assets/starter-content/Gameplay/ReferenceCar.vehicle.json";
const VEHICLE_ACTOR = "assets/starter-content/Gameplay/Script_ReferenceCar.actor.json";
/** Debug-overlay mode name → the `worldSettings.gameMode` that selects it. */
const GAME_MODES = {
  Vehicle: "forge.vehicle",
  Script_GameMode: "assets/starter-content/Gameplay/Script_GameMode.actor.json",
} as const;
type VehicleTestMode = keyof typeof GAME_MODES;
type LevelJson = any; // raw level JSON, edited in flight

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

/** Strips the ramp and props and stretches the ground into a long flat lane. */
function flatLane(level: LevelJson): void {
  level.instances = [];
  level.blockingVolumes = [level.blockingVolumes.find((volume: { id: string }) => volume.id === "vehicle-test-ground")];
  level.blockingVolumes[0].size = [2000, 1, 2000];
}

/** The vehicle mode publishes its pawn and speed on the overlay's `camera:` line. */
async function readVehicleCamera(page: Page): Promise<{ pawn: string; kmh: number }> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/vehicle-chase pawn:(\S+) speed:(-?\d+)km\/h/);
  if (!match) throw new Error(`no vehicle camera readout in the overlay:\n${text}`);
  return { pawn: match[1]!, kmh: Number(match[2]) };
}

async function openVehicleTest(
  page: Page,
  mode: VehicleTestMode = "Vehicle",
  editLevel?: (level: LevelJson) => void,
): Promise<string[]> {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  await page.route(`**/${VEHICLE_LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    level.worldSettings.gameMode = GAME_MODES[mode];
    editLevel?.(level);
    await route.fulfill({ response, json: level });
  });

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
  await expect(stats).toContainText(`mode: ${mode}`, { timeout: 30_000 });
  if (mode === "Vehicle") {
    await expect(stats).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });
  }
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

test("vehicle smoke: a TPS character gets in with E, drives, and steps out beside the car", async ({ page }) => {
  // Same level, played on foot: the starter project Game Mode (a TPS session)
  // spawns its Player Character at the Player Start beside the driver's door.
  const pageErrors = await openVehicleTest(page, "Script_GameMode");
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText(/possessed: (?!actor:0|none)\S+/, { timeout: 30_000 });
  await expect(stats).not.toContainText("vehicle-chase");

  await page.locator("#game-canvas").click();
  await page.keyboard.press("KeyE");
  await expect(stats).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 10_000 });
  await expect(stats).toContainText("possessed: actor:0");

  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => (await readVehicleCamera(page)).kmh, { timeout: 15_000 })
    .toBeGreaterThan(15);
  await page.keyboard.up("KeyW");

  // E at speed brakes the car to a crawl first, then the character steps out.
  await page.keyboard.press("KeyE");
  await expect(stats).not.toContainText("vehicle-chase", { timeout: 15_000 });
  await expect(stats).toContainText(/possessed: (?!actor:0|none)\S+/);
  // The character walks again: it is the possessed pawn, so W moves it.
  const readPos = async () => {
    const match = ((await stats.textContent()) ?? "").match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
    if (!match) throw new Error("no pawn position in the overlay");
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const before = await readPos();
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => {
      const now = await readPos();
      return Math.hypot(now[0]! - before[0]!, now[2]! - before[2]!);
    }, { timeout: 10_000 })
    .toBeGreaterThan(0.5);
  await page.keyboard.up("KeyW");
  expect(pageErrors).toEqual([]);
});

/** The possessed character's world position off the `?debug` game-mode block (none in a car). */
async function readPawnPosition(page: Page): Promise<[number, number, number]> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  if (!match) throw new Error(`no pawn position in the overlay:
${text}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

test("vehicle save-game: a quick-save while driving loads back behind the wheel, moving", async ({ page }) => {
  // On foot (TPS), with the starter Save / Load menu as the pause menu.
  const pageErrors = await openVehicleTest(page, "Script_GameMode", (level) => {
    level.worldSettings.pauseMenuWidget = "menu";
  });
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText(/possessed: (?!actor:0|none)\S+/, { timeout: 30_000 });
  await expect(stats).toContainText('save.slots.quick.status = "Empty"');

  await expect.poll(async () => readPawnPosition(page).then(() => true, () => false)).toBe(true);
  const boardedAt = await readPawnPosition(page);
  await page.locator("#game-canvas").click();
  await page.keyboard.press("KeyE");
  await expect(stats).toContainText("possessed: actor:0", { timeout: 10_000 });
  await page.keyboard.down("KeyW");
  await expect
    .poll(async () => (await readVehicleCamera(page)).kmh, { timeout: 20_000 })
    .toBeGreaterThan(25);
  await page.keyboard.up("KeyW");

  // The overlay keeps reporting, but must not sit over the menu's buttons.
  await page.addStyleTag({ content: "#debug-stats, #debug-stats * { pointer-events: none !important; }" });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-ui-id="title"]')).toContainText("Save / Load");
  await page.locator('[data-ui-id="quick-save"]').click();
  await expect(stats).toContainText(/save\.slots\.quick\.status = "Saved /, { timeout: 10_000 });
  await page.locator('[data-ui-id="quick-load"]').click();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });

  // Back in the car — not on foot at the Player Start, not in a car parked at
  // its spawn at rest: still rolling from the saved speed.
  await expect(stats).toContainText("possessed: actor:0", { timeout: 30_000 });
  await expect(stats).toContainText(/vehicle-chase pawn:actor:0/);
  expect((await readVehicleCamera(page)).kmh).toBeGreaterThan(5);

  // E still gets the character out — beside the car where it was saved, well
  // away from where it was boarded.
  await page.locator("#game-canvas").click();
  await page.keyboard.press("KeyE");
  await expect(stats).not.toContainText("vehicle-chase", { timeout: 20_000 });
  await expect(stats).toContainText(/possessed: (?!actor:0|none)\S+/);
  await expect.poll(async () => readPawnPosition(page).then(() => true, () => false)).toBe(true);
  const exitedAt = await readPawnPosition(page);
  expect(Math.hypot(exitedAt[0] - boardedAt[0], exitedAt[2] - boardedAt[2])).toBeGreaterThan(8);
  expect(pageErrors).toEqual([]);
});

/** The chase camera's spring-arm fraction and look-around yaw off the overlay. */
async function readChaseArm(page: Page): Promise<{ arm: number; lookDeg: number }> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/vehicle-chase .* arm:([\d.]+) look:(-?\d+)/);
  if (!match) throw new Error(`no chase arm readout in the overlay:\n${text}`);
  return { arm: Number(match[1]), lookDeg: Number(match[2]) };
}

test("vehicle chase camera stops in front of a wall and orbits with a right-drag", async ({ page }) => {
  // A wall right behind the parked car, across the chase camera's boom.
  const pageErrors = await openVehicleTest(page, "Vehicle", (level) => {
    level.blockingVolumes.push({
      id: "smoke-camera-wall",
      name: "Camera Wall",
      position: [0, 2, -4],
      size: [8, 4, 0.4],
      renderInGame: true,
      color: "#888888",
    });
  });
  await expect.poll(async () => (await readChaseArm(page)).arm, { timeout: 15_000 }).toBeLessThan(0.7);
  expect((await readChaseArm(page)).arm).toBeGreaterThan(0.2);
  expect((await readChaseArm(page)).lookDeg).toBe(0);

  // Right-drag left: the view turns left, off the wall, and the arm grows back.
  await page.addStyleTag({ content: "#debug-stats, #debug-stats * { pointer-events: none !important; }" });
  const canvas = page.locator("#game-canvas");
  const box = (await canvas.boundingBox()) ?? assert.fail("no canvas box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x - 300, y, { steps: 10 });
  await page.mouse.up({ button: "right" });
  await expect.poll(async () => (await readChaseArm(page)).lookDeg, { timeout: 10_000 }).toBeGreaterThan(30);
  await expect.poll(async () => (await readChaseArm(page)).arm, { timeout: 10_000 }).toBeGreaterThan(0.95);
  expect(pageErrors).toEqual([]);
});

test("vehicle asset save endpoint persists normalized data and reports dropped fields", async ({ request }) => {
  const path = `assets/__vehicle-smoke-${randomUUID()}.vehicle.json`;
  try {
    const reference = JSON.parse(await readFile(resolve("public", VEHICLE_ASSET), "utf8"));
    expect((await request.get("/__save-vehicle")).status()).toBe(405);
    const response = await request.post("/__save-vehicle", { data: {
      path, vehicle: { ...reference, massKg: 950, extra: true },
    } });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ ok: true, changed: true, dropped: ["vehicle.extra"] });
    const saved = JSON.parse(await readFile(resolve("public", path), "utf8"));
    expect(saved.massKg).toBe(950);
    expect(saved.wheels).toHaveLength(4);
    expect(saved.wheels.map((wheel: { visualNode: string }) => wheel.visualNode))
      .toEqual(reference.wheels.map((wheel: { visualNode: string }) => wheel.visualNode));
    expect(saved.drivetrain).toEqual(reference.drivetrain);
    expect(saved.steeringSpeedCurve).toEqual(reference.steeringSpeedCurve);
    expect(saved.aerodynamics).toEqual(reference.aerodynamics);
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

test("vehicle drivetrain shows RPM shifts to second reverses and resets in the browser", async ({ page }) => {
  // A long flat lane keeps the gear check independent of the authored ramp.
  const pageErrors = await openVehicleTest(page, "Vehicle", flatLane);
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText(/gear:1 rpm:900/);
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect(stats).toContainText(/gear:2 rpm:[1-6]\d{3}/, { timeout: 20_000 });
  expect((await readVehicleCamera(page)).kmh).toBeGreaterThan(50);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyS");
  await expect(stats).toContainText(/gear:R rpm:/, { timeout: 20_000 });
  await expect.poll(async () => (await readVehicleCamera(page)).kmh, { timeout: 10_000 }).toBeLessThan(-2);
  await page.keyboard.up("KeyS");
  await page.keyboard.press("KeyE");
  await expect(stats).toContainText(/speed:0km\/h gear:1 rpm:900 shift:0.00s/);
  expect(pageErrors).toEqual([]);
});

test("Kenney sedan uses its textured body and four animated model wheels", async ({ page }, testInfo) => {
  // Three's existing devtools observation hook lets this test inspect the live
  // render scene without exposing test globals in the production application.
  await page.addInitScript(() => {
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __vehicleScenes: any[]; __vehicleRenderer?: any };
    w.__vehicleScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__vehicleScenes.push(object);
      if (object?.isWebGLRenderer) w.__vehicleRenderer = object;
    });
  });
  const modelResponse = page.waitForResponse((response) => response.url().includes("kenney-car-kit/sedan-sports.glb"));
  const textureResponse = page.waitForResponse((response) => response.url().includes("kenney-car-kit/Textures/colormap.png"));
  const pageErrors = await openVehicleTest(page);
  expect((await modelResponse).ok()).toBe(true);
  expect((await textureResponse).ok()).toBe(true);
  const snapshot = () => page.evaluate(() => {
    const scenes = (window as unknown as { __vehicleScenes: any[] }).__vehicleScenes;
    let actor: any;
    for (const scene of scenes) scene.traverse((node: any) => {
      if (node.userData.actorEntityId === "actor:0") actor = node;
    });
    if (!actor) return null;
    const rig = actor.getObjectByName("VehicleWheels");
    if (!rig) return null;
    let meshes = 0;
    actor.traverse((node: any) => { if (node.isMesh) meshes += 1; });
    const body = actor.getObjectByName("body");
    return {
      meshes, textured: (body?.material.map?.image?.width ?? 0) > 0,
      wheels: rig.children.map((pivot: any) => ({
        name: pivot.children[0]?.name, childCount: pivot.children.length,
        y: pivot.position.y, steer: pivot.rotation.y, spin: pivot.rotation.x,
      })),
    };
  });
  await expect.poll(async () => (await snapshot())?.wheels.length).toBe(4);
  const parked = (await snapshot())!;
  expect(parked.meshes).toBe(6); // body, spoiler, four original wheels
  expect(parked.textured).toBe(true);
  expect(parked.wheels.every((wheel: any) => wheel.childCount === 1 && wheel.name.startsWith("wheel-"))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("kenney-sedan-parked.png") });
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyD");
  await expect.poll(async () => Math.abs((await snapshot())!.wheels[0].steer)).toBeGreaterThan(0.1);
  expect(Math.abs((await snapshot())!.wheels[2].steer)).toBeLessThan(0.001);
  await page.keyboard.up("KeyD");
  await page.keyboard.down("KeyW");
  await expect.poll(async () => Math.abs((await snapshot())!.wheels[2].spin)).toBeGreaterThan(1);
  await expect.poll(async () => (await readVehicleCamera(page)).kmh).toBeGreaterThan(5);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: testInfo.outputPath("kenney-sedan-driving.png") });
  // A separate plain-lit inspection view distinguishes the imported material
  // from the authored VehicleTest atmosphere/lighting. No layout is saved.
  await page.route(`**/${VEHICLE_LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    delete level.skyAtmosphere;
    delete level.heightFog;
    delete level.cloudLayer;
    level.worldSettings.gameMode = GAME_MODES.Vehicle;
    level.worldSettings.ambientIntensity = 2;
    level.worldSettings.backgroundColor = "#c8d8e8";
    await route.fulfill({ response, json: level });
  });
  await page.reload();
  await expect(page.locator("#debug-stats")).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 60_000 });
  await expect(page.locator(".forge-loading")).toBeHidden();
  await expect.poll(async () => (await snapshot())?.textured).toBe(true);
  await page.addStyleTag({ content: "#debug-stats { display: none !important; }" });
  // Inspect both axles from a three-quarter angle in this QA view only.
  await page.evaluate(() => {
    const w = window as unknown as { __vehicleScenes: any[]; __vehicleRenderer: any };
    let actor: any;
    for (const scene of w.__vehicleScenes) scene.traverse((node: any) => {
      if (node.userData.actorEntityId === "actor:0") actor = node;
    });
    const renderer = w.__vehicleRenderer;
    const render = renderer.render.bind(renderer);
    renderer.render = (scene: any, camera: any) => {
      if (scene === actor.parent && camera.isPerspectiveCamera) {
        const target = actor.getWorldPosition(actor.position.clone());
        camera.position.copy(target).add(target.clone().set(4, 3, -6));
        camera.lookAt(target.x, target.y + 0.7, target.z);
      }
      render(scene, camera);
    };
  });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.screenshot({ path: testInfo.outputPath("kenney-sedan-lit-preview.png") });
  expect(pageErrors).toEqual([]);
});
