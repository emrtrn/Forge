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
  await page.route(`**/${VEHICLE_LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    level.instances = [];
    level.blockingVolumes = [level.blockingVolumes.find((volume: { id: string }) => volume.id === "vehicle-test-ground")];
    level.blockingVolumes[0].size = [2000, 1, 2000];
    await route.fulfill({ response, json: level });
  });
  const pageErrors = await openVehicleTest(page);
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
