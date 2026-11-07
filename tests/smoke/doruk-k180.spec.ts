import { expect, test, type Page } from "./test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * Vehicle contract VC-1: the Doruk K-180 greybox imports at the agreed size and
 * axes, its four wheel nodes bind, it drives toward +Z, and the Static Mesh
 * Editor lists every mesh node of the GLB as a part candidate.
 *
 * Nothing under `public/` is written: the level and the sidecar are served in
 * flight and the editor's saves are answered here.
 */

const LEVEL = "assets/starter-content/Levels/VehicleTest.level.json";
const TRUCK = "assets/vehicles/doruk-k180/Script_DorukK180.actor.json";
const GLB = "public/assets/vehicles/doruk-k180/doruk-k180_base.glb";
const SIDECAR = "assets/vehicles/doruk-k180/doruk-k180_base.deformable.json";
const SAVE_LEVEL = "layouts/PhysicsInteractionTest.level.json";
/** How deep the truck may ever dent: read from the sidecar, so the limit under test is the one that ships. */
const MAX_DENT = (JSON.parse(readFileSync(resolve(REPO_ROOT, "public", SIDECAR), "utf8")) as { maxDepth: number }).maxDepth;

test.setTimeout(180_000);

interface Snapshot {
  position: [number, number, number];
  size: [number, number, number];
  min: [number, number, number];
  bumperZ: number;
  tailgateZ: number;
  mirrorLeftX: number;
  wheels: { name: string; x: number; y: number; z: number; steer: number; spin: number }[];
}

async function observeScenes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __vehicleScenes: any[] };
    w.__vehicleScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__vehicleScenes.push(object);
    });
  });
}

/** Sizes are taken with the vertices of every mesh, in the actor's own space. */
function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const scenes = (window as unknown as { __vehicleScenes: any[] }).__vehicleScenes;
    let actor: any;
    for (const scene of scenes) scene.traverse((node: any) => {
      if (node.userData.actorEntityId === "actor:0") actor = node;
    });
    const rig = actor?.getObjectByName("VehicleWheels");
    if (!rig || rig.children.length !== 4) return null;
    actor.updateWorldMatrix(true, true);
    const toActor = actor.matrixWorld.clone().invert();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const point = actor.position.clone();
    actor.traverse((node: any) => {
      if (!node.isMesh) return;
      for (let parent = node.parent; parent; parent = parent.parent) if (parent === rig) return;
      const position = node.geometry.attributes.position;
      for (let i = 0; i < position.count; i += 1) {
        point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).applyMatrix4(toActor);
        point.toArray().forEach((value: number, axis: number) => {
          min[axis] = Math.min(min[axis]!, value);
          max[axis] = Math.max(max[axis]!, value);
        });
      }
    });
    const localCentre = (name: string): number[] => {
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      const node = actor.getObjectByName(name);
      const position = node.geometry.attributes.position;
      for (let i = 0; i < position.count; i += 1) {
        point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).applyMatrix4(toActor);
        point.toArray().forEach((value: number, axis: number) => {
          box.min[axis] = Math.min(box.min[axis]!, value);
          box.max[axis] = Math.max(box.max[axis]!, value);
        });
      }
      return box.min.map((value, axis) => (value + box.max[axis]!) / 2);
    };
    return {
      position: actor.position.toArray(),
      size: max.map((value, axis) => value - min[axis]!),
      min,
      bumperZ: localCentre("Front_Bumper")[2],
      tailgateZ: localCentre("Tailgate")[2],
      mirrorLeftX: localCentre("Mirror_L")[0],
      wheels: rig.children.map((pivot: any) => ({
        name: pivot.children[0]?.name, x: pivot.position.x, y: pivot.position.y, z: pivot.position.z,
        steer: pivot.rotation.y, spin: pivot.rotation.x,
      })),
    } as Snapshot;
  });
}

async function readKmh(page: Page): Promise<number> {
  const text = (await page.locator("#debug-stats").textContent()) ?? "";
  const match = text.match(/vehicle-chase pawn:\S+ speed:(-?\d+)km\/h/);
  if (!match) throw new Error(`no vehicle camera readout in the overlay:\n${text}`);
  return Number(match[1]);
}

test("Doruk K-180 imports to size, binds its wheels and drives forward along +Z", async ({ page }, testInfo) => {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    consoleMessages.push(message.text());
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await observeScenes(page);
  await page.route(`**/${LEVEL}`, async (route) => {
    const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/vehicle-test.level.json"), "utf8"));
    level.worldSettings.gameMode = "forge.vehicle";
    level.instances = [];
    level.blockingVolumes = [level.blockingVolumes.find((volume: { id: string }) => volume.id === "vehicle-test-ground")];
    level.blockingVolumes[0].size = [2000, 1, 2000];
    level.actors = [{ classRef: TRUCK, name: "Doruk K-180", position: [0, 0.1, 0], rotation: [0, 0, 0] }];
    await route.fulfill({ json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = (await response.json()) as { editor: { defaultScene: string } };
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });

  await page.goto(`/?debug&vehicleSmoke=${Date.now()}`);
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#debug-stats")).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 60_000 });
  await expect.poll(() => snapshot(page), { timeout: 30_000 }).not.toBeNull();

  const parked = (await snapshot(page))!;
  // Scale: body without wheels, mirrors included; the numbers of DIMENSIONS.md.
  expect(parked.size[0]).toBeCloseTo(2.8, 2);
  expect(parked.size[2]).toBeCloseTo(7.07, 2);
  expect(parked.min[1] + parked.size[1]).toBeCloseTo(2.65, 2);
  // Axes: the bumper faces +Z, the tailgate -Z, the vehicle's left is +X.
  expect(parked.bumperZ).toBeGreaterThan(3);
  expect(parked.tailgateZ).toBeLessThan(-3.8);
  expect(parked.mirrorLeftX).toBeGreaterThan(1);
  // The model's wheels, not generated ones, in the agreed slots.
  expect(parked.wheels.map((wheel) => wheel.name)).toEqual(["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]);
  expect(consoleMessages.filter((message) => message.includes("[vehicle] Wheel node"))).toEqual([]);
  // At rest the wheels hang where the model has them: r + rest - sag = 0.85 at the hard point.
  await expect.poll(async () => Math.abs((await snapshot(page))!.wheels[0]!.y - 0.56), { timeout: 15_000 }).toBeLessThan(0.02);
  expect(parked.wheels[0]).toMatchObject({ x: 1.025, z: 2.1 });
  expect(parked.wheels[3]).toMatchObject({ x: -0.9, z: -2.1 });
  await page.screenshot({ path: testInfo.outputPath("doruk-k180-parked.png") });

  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyD");
  await expect.poll(async () => Math.abs((await snapshot(page))!.wheels[0]!.steer)).toBeGreaterThan(0.1);
  expect(Math.abs((await snapshot(page))!.wheels[2]!.steer)).toBeLessThan(0.001);
  await page.keyboard.up("KeyD");
  await expect.poll(async () => Math.abs((await snapshot(page))!.wheels[0]!.steer), { timeout: 15_000 }).toBeLessThan(0.02);

  const start = (await snapshot(page))!.position;
  await page.keyboard.down("KeyW");
  await expect.poll(() => readKmh(page), { timeout: 40_000 }).toBeGreaterThan(15);
  const driven = (await snapshot(page))!;
  await page.screenshot({ path: testInfo.outputPath("doruk-k180-driving.png") });
  await page.keyboard.up("KeyW");
  expect(driven.position[2] - start[2]).toBeGreaterThan(2);
  expect(Math.abs(driven.position[0] - start[0])).toBeLessThan(driven.position[2] - start[2]);
  expect(Math.abs(driven.wheels[2]!.spin)).toBeGreaterThan(1);
  expect(pageErrors).toEqual([]);
});

test("the Static Mesh Editor offers every mesh node of the Doruk K-180 as a part", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const glb = await readFile(resolve(REPO_ROOT, GLB));
  const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as {
    nodes: { name: string; mesh?: number }[];
  };
  const expected = gltf.nodes.filter((node) => node.mesh !== undefined).map((node) => node.name).sort();
  expect(expected.length).toBeGreaterThan(50);

  await page.route(`**/${SIDECAR}*`, (route) => route.fulfill({
    json: { version: 1, enabled: true, mode: "impact", dentImpulse: 200, fullImpulse: 1500, radius: 0.5, maxDepth: 0.3, plasticity: 0.5, maxDents: 32, collisionPolicy: "visual_only" },
  }));
  for (const endpoint of ["__save-deformable", "__save-collision", "__save-material-slots", "__save-uvw", "__save-vertex-colors", "__save-layout"]) {
    await page.route(`**/${endpoint}**`, async (route) => {
      const payload = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ json: { ok: true, path: payload.path ?? "x", changed: false, dropped: [] } });
    });
  }
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.locator("[data-content-toggle]").click();
  const drawer = page.locator("[data-content-drawer]");
  await drawer.locator('button.folder-row[title="assets/vehicles/doruk-k180"]').click();
  await drawer.getByRole("button", { name: /doruk k-180/i }).first().dblclick();
  const editor = page.locator(".sm-editor-overlay");
  await expect(editor.locator("[data-sm-status]")).toHaveText("Ready.", { timeout: 30_000 });

  const select = editor.locator("[data-sm-deformable] [data-sm-deformable-part-node]");
  const listed = await select.locator("option").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value).filter(Boolean));
  await page.screenshot({ path: testInfo.outputPath("doruk-k180-static-mesh-editor.png") });
  expect(listed.sort()).toEqual(expected);
  expect(errors).toEqual([]);
});

/** The dent sidecar, as the game and the Static Mesh Editor read it. */
test("the Static Mesh Editor shows the Doruk K-180 parts from its sidecar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.locator("[data-content-toggle]").click();
  const drawer = page.locator("[data-content-drawer]");
  await drawer.locator('button.folder-row[title="assets/vehicles/doruk-k180"]').click();
  await drawer.getByRole("button", { name: /doruk k-180/i }).first().dblclick();
  const editor = page.locator(".sm-editor-overlay");
  await expect(editor.locator("[data-sm-status]")).toHaveText("Ready.", { timeout: 30_000 });
  const section = editor.locator("[data-sm-deformable]");
  await expect(section.locator("[data-sm-deformable-parts]")).toHaveAttribute("data-zones", "21");
  for (const part of ["mirror_left", "door_right", "front_bumper", "hood", "fender_left", "headlight_left", "turn_signal_right", "front_grille", "fuel_tank", "tail_lamp_left", "rear_bumper", "tailgate", "bed_side_right", "rigid_core"]) {
    await expect(section.locator(`[data-sm-part="${part}"]`)).toBeVisible();
  }
  await expect(section.locator('[data-sm-deformable-part-node] option[value="Front_Bumper"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** Plays the save-menu test level after `edit`; `open` waits for `objects` deformables. */
async function sceneRig(page: Page, edit: (level: any) => void, objects = 2): Promise<{
  errors: string[];
  stats: ReturnType<Page["locator"]>;
  readDeform: () => Promise<string>;
  open: () => Promise<void>;
}> {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await page.context().addInitScript(() => {
    if (!sessionStorage.getItem("dorukSmoke")) localStorage.clear();
    sessionStorage.setItem("dorukSmoke", "1");
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __vehicleScenes: any[]; __vehicleRenderer?: any };
    w.__vehicleScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__vehicleScenes.push(object);
      if (object?.isWebGLRenderer) w.__vehicleRenderer = object;
    });
  });
  await page.route(`**/${SAVE_LEVEL}`, async (route) => {
    const response = await route.fetch();
    const level = await response.json();
    edit(level);
    level.worldSettings.pauseMenuWidget = "menu";
    await route.fulfill({ response, json: level });
  });
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = (await response.json()) as { editor: { defaultScene: string } };
    project.editor.defaultScene = SAVE_LEVEL;
    await route.fulfill({ response, json: project });
  });
  const stats = page.locator("#debug-stats");
  const readDeform = async (): Promise<string> => ((await stats.textContent()) ?? "").match(/deform: .*?ms(?: detached \d+)?/)?.[0] ?? "";
  const open = async (): Promise<void> => {
    messages.length = 0;
    await page.goto(`/?debug&dorukSmoke=${Date.now()}`);
    await expect.poll(() => messages.some((message) => message.includes('"layout":"PhysicsInteractionTest"')), { timeout: 60_000 }).toBeTruthy();
    await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
    await expect(stats).toContainText(/vehicle-chase pawn:actor:0/, { timeout: 30_000 });
    await expect.poll(readDeform, { timeout: 30_000 }).toMatch(new RegExp(`objects ${objects} `));
  };
  return { errors, stats, readDeform, open };
}

/** Two trucks facing a wall. */
const wallAhead = (wallZ: number) => (level: any): void => {
  // Only the floor and the wall: the fixture's ramps would end a long run-up early.
  level.instances = [];
  const floor = level.blockingVolumes[0];
  level.blockingVolumes = [floor, { ...floor, id: "smoke-wall", name: "Smoke Wall", position: [0, 2, wallZ], size: [8, 4, 1] }];
  level.actors = [
    { classRef: TRUCK, name: "Driven K-180", position: [0, 0, 0], rotation: [0, 0, 0] },
    { classRef: TRUCK, name: "Parked K-180", position: [7, 0, 0], rotation: [0, 0, 0] },
  ];
};

function crashRig(page: Page, wallZ: number): ReturnType<typeof sceneRig> {
  return sceneRig(page, wallAhead(wallZ));
}

/** One frame from a camera `offset` off a truck, for the visual acceptance; `at` is a world point, or `aim` off the truck, or its nose. */
async function shootTruck(page: Page, entityId: string, path: string, offset: [number, number, number], aim?: [number, number, number], at?: number[]): Promise<void> {
  const hideOverlays = await page.addStyleTag({ content: "#debug-stats, section { display: none !important; }" });
  await page.evaluate(({ id, from, near, look }) => {
    const w = window as unknown as { __vehicleScenes: any[]; __vehicleRenderer: any; __restoreRender?: () => void };
    let actor: any;
    for (const scene of w.__vehicleScenes) scene.traverse((node: any) => {
      if (node.userData.actorEntityId === id && node.getObjectByName("Chassis_Frame")) actor = node;
    });
    const renderer = w.__vehicleRenderer;
    const render = renderer.render;
    w.__restoreRender = () => { renderer.render = render; };
    renderer.render = (scene: any, camera: any) => {
      if (camera.isPerspectiveCamera && scene === actor.parent) {
        const target = actor.getWorldPosition(actor.position.clone());
        camera.position.copy(target).add(target.clone().set(from[0], from[1], from[2]));
        if (look) camera.lookAt(look[0], look[1], look[2]);
        else if (near) camera.lookAt(target.x + near[0], target.y + near[1], target.z + near[2]);
        else camera.lookAt(target.x, target.y + 0.9, target.z + 3.2);
      }
      render.call(renderer, scene, camera);
    };
  }, { id: entityId, from: offset, near: aim ?? null, look: at ?? null });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.screenshot({ path });
  await page.evaluate(() => (window as unknown as { __restoreRender: () => void }).__restoreRender());
  await hideOverlays.evaluate((style) => (style as unknown as Element).remove());
}

/** VC-2: the same bumper takes two crashes into a wall; nothing else changes. */
test("Doruk K-180 bumper dents twice, alone, and a load gives the same shape", async ({ page }, testInfo) => {
  const { errors, stats, readDeform, open } = await crashRig(page, 14);

  /** Each truck's bumper vertices and which of its meshes own a dented copy. */
  const trucks = (): Promise<{ bumper: number[]; dented: string[]; shared: boolean }[] | null> => page.evaluate(() => {
    const scenes = (window as unknown as { __vehicleScenes: any[] }).__vehicleScenes;
    const found: any[] = [];
    for (const id of ["actor:0", "actor:1"]) {
      let actor: any;
      for (const scene of scenes) scene.traverse((node: any) => {
        if (node.userData.actorEntityId === id && node.getObjectByName("Front_Bumper")) actor = node;
      });
      if (!actor) return null;
      found.push(actor);
    }
    return found.map((actor) => {
      const bumper = actor.getObjectByName("Front_Bumper");
      const dented: string[] = [];
      actor.traverse((node: any) => { if (node.isMesh && node.geometry.userData.forgeDeformClone === true) dented.push(node.name); });
      return {
        bumper: Array.from(bumper.geometry.attributes.position.array as ArrayLike<number>),
        dented,
        shared: bumper.geometry === found[1].getObjectByName("Front_Bumper").geometry,
      };
    });
  });
  const push = (from: number[], to: number[]): number[] => Array.from({ length: from.length / 3 }, (_, vertex) =>
    Math.hypot(to[vertex * 3]! - from[vertex * 3]!, to[vertex * 3 + 1]! - from[vertex * 3 + 1]!, to[vertex * 3 + 2]! - from[vertex * 3 + 2]!));
  const deepest = (values: number[]): number => values.reduce((most, value) => Math.max(most, value), 0);

  await open();
  await expect.poll(trucks, { timeout: 30_000 }).not.toBeNull();
  const rest = (await trucks())![0]!.bumper;
  expect((await trucks())![0]!.shared, "both trucks start on the shared model").toBe(true);

  // First crash, then the engine keeps pushing: a stalled truck digs nothing.
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => deepest(push(rest, (await trucks())![0]!.bumper)), { timeout: 40_000 }).toBeGreaterThan(0.01);
  // The truck bounces off the wall once; that second touch is a real hit.
  await page.waitForTimeout(3000);
  const first = push(rest, (await trucks())![0]!.bumper);
  await page.waitForTimeout(2500);
  // A last small bounce can still land here and is a real hit: 2 mm, not digging.
  expect(deepest(push(rest, (await trucks())![0]!.bumper)) - deepest(first)).toBeLessThan(0.002);
  await page.keyboard.up("KeyW");

  // Back away and hit it again.
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(3000);
  await page.keyboard.up("KeyS");
  await page.waitForTimeout(500);
  await page.keyboard.down("KeyW");
  await expect.poll(async () => deepest(push(rest, (await trucks())![0]!.bumper)), { timeout: 40_000 }).toBeGreaterThan(deepest(first) + 0.005);
  await page.waitForTimeout(1000);
  await page.keyboard.up("KeyW");

  const after = (await trucks())!;
  const second = push(rest, after[0]!.bumper);
  console.log(`[doruk smoke] deform ${await readDeform()} first ${deepest(first).toFixed(3)} m, second ${deepest(second).toFixed(3)} m, vertices ${second.filter((value) => value > 1e-4).length}/${second.length}`);
  // VCD-02/03: only the bumper, the first dent is kept, the limit holds.
  expect(after[0]!.dented).toEqual(["Front_Bumper"]);
  second.forEach((value, vertex) => expect(value).toBeGreaterThanOrEqual(first[vertex]! - 1e-4));
  expect(deepest(second)).toBeLessThanOrEqual(MAX_DENT + 1e-4);
  expect(await readDeform()).toMatch(/missed 0/);
  // VCD-08: the parked truck and the shared model are as they were.
  expect(after[1]!.dented).toEqual([]);
  expect(after[1]!.bumper).toEqual(rest);
  expect(after[0]!.shared).toBe(false);

  // A look at the dent from the front, for the visual acceptance.
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(5000);
  await page.keyboard.up("KeyS");
  await page.waitForTimeout(1500);
  await shootTruck(page, "actor:0", testInfo.outputPath("doruk-k180-dented-bumper.png"), [-1.6, 1.35, 5.2]);

  // VCD-07: saved, opened fresh, loaded: the same shape on the same bumper.
  const menu = page.locator('[data-ui-id="title"]');
  await page.keyboard.press("Escape", { delay: 150 });
  await expect(menu).toContainText("Save / Load");
  await page.locator('[data-ui-id="quick-save"]').click();
  await expect(stats).toContainText(/save\.slots\.quick\.status = "Saved /, { timeout: 10_000 });
  const saved = (await trucks())![0]!.bumper;
  await open();
  await expect.poll(trucks, { timeout: 30_000 }).not.toBeNull();
  expect((await trucks())![0]!.bumper).toEqual(rest);
  await page.keyboard.press("Escape", { delay: 150 });
  await expect(menu).toContainText("Save / Load");
  await page.locator('[data-ui-id="quick-load"]').click();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 60_000 });
  await expect.poll(async () => deepest(push(rest, (await trucks())?.[0]?.bumper ?? rest)), { timeout: 30_000 }).toBeGreaterThan(0.01);
  const loaded = (await trucks())!;
  expect(deepest(push(saved, loaded[0]!.bumper))).toBeLessThan(1e-4);
  expect(loaded[0]!.dented).toEqual(["Front_Bumper"]);
  expect(loaded[1]!.dented).toEqual([]);
  expect(errors).toEqual([]);
});

/** One truck's meshes as they stand, and any piece that came off it. */
function truckParts(page: Page, entityId: string): Promise<{
  nodes: string[]; dented: string[];
  pieces: { name: string; meshes: string[]; dented: boolean }[];
}> {
  return page.evaluate((id) => {
    const scenes = (window as unknown as { __vehicleScenes: any[] }).__vehicleScenes;
    let actor: any;
    for (const scene of scenes) scene.traverse((node: any) => {
      if (node.userData.actorEntityId === id && node.getObjectByName("Chassis_Frame")) actor = node;
    });
    const nodes: string[] = [];
    const dented: string[] = [];
    actor?.traverse((node: any) => {
      if (!node.isMesh) return;
      nodes.push(node.name);
      if (node.geometry.userData.forgeDeformClone === true) dented.push(node.name);
    });
    const pieces: { name: string; meshes: string[]; dented: boolean }[] = [];
    const seen = new Set<any>();
    for (const scene of scenes) scene.traverse((node: any) => {
      if (!node.name?.startsWith("detached-") || seen.has(node)) return;
      seen.add(node);
      const meshes: string[] = [];
      let hurt = false;
      node.traverse((child: any) => {
        if (!child.isMesh) return;
        meshes.push(child.name);
        hurt ||= child.geometry.userData.forgeDeformClone === true;
      });
      pieces.push({ name: node.name, meshes, dented: hurt });
    });
    return { nodes, dented, pieces };
  }, entityId);
}

/** The car stays pawn; the truck stands a quarter turned, its left door facing the car driving +Z. */
const broadside = (truckZ: number) => (level: any): void => {
  level.instances = [];
  level.blockingVolumes = [level.blockingVolumes[0]];
  level.actors = [level.actors[0], { classRef: TRUCK, name: "Parked K-180", position: [-0.69, 0, truckZ], rotation: [0, 90, 0] }];
};

/** What sits behind a door inside a dent's radius, and must not follow it. */
const BEHIND_THE_DOOR = ["Cabin_Interior", "Engine_Block", "Door_R", "SideGlass_R", "Mirror_R"];

test("Doruk K-180 door dents alone under a car at town speed", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, broadside(14));
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:1")).nodes).toContain("Door_L");
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await truckParts(page, "actor:1")).dented, { timeout: 40_000 }).toContain("Door_L");
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(1500);
  const { dented, nodes, pieces } = await truckParts(page, "actor:1");
  console.log(`[doruk smoke] door hit ${JSON.stringify(dented)} ${await readDeform()}`);
  // The car may slide on along the truck and dent the body further on, so that is not asserted.
  for (const untouched of BEHIND_THE_DOOR) expect(dented).not.toContain(untouched);
  expect(nodes).toContain("Door_L");
  expect(pieces).toEqual([]);
  expect(errors).toEqual([]);
});

/** A beam across the lane, its underside at `bottomY`: the truck meets it above the bumper. */
const beamAhead = (z: number, bottomY: number, height: number) => (level: any): void => {
  level.instances = [];
  const floor = level.blockingVolumes[0];
  level.blockingVolumes = [floor, { ...floor, id: "smoke-beam", name: "Smoke Beam", position: [0, bottomY + height / 2, z], size: [8, height, 1] }];
  level.actors = [{ classRef: TRUCK, name: "Driven K-180", position: [0, 0, 0], rotation: [0, 0, 0] }];
};

/** What sits under the front panels, inside a dent's radius. */
const UNDER_THE_PANELS = ["Engine_Block", "Chassis_Frame", "Cabin_Interior"];

async function driveUntil(page: Page, settle: () => Promise<boolean>): Promise<void> {
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyW");
  await expect.poll(settle, { timeout: 70_000 }).toBe(true);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(1500);
}

test("Doruk K-180 hood dents under a beam at town speed, and the engine stays", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, beamAhead(14, 1.70, 2), 1);
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:0")).nodes).toContain("Hood");
  await driveUntil(page, async () => (await truckParts(page, "actor:0")).dented.includes("Hood"));
  const { dented, pieces, nodes } = await truckParts(page, "actor:0");
  console.log(`[doruk smoke] hood dent ${JSON.stringify(dented)} ${await readDeform()}`);
  for (const untouched of [...UNDER_THE_PANELS, "Front_Bumper", "Grille_Panel"]) expect(dented).not.toContain(untouched);
  expect(nodes).toContain("Hood");
  expect(pieces).toEqual([]);
  expect(errors).toEqual([]);
});

test("Doruk K-180 hood dents from above, and only the hood", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, (level) => {
    level.instances = [];
    level.blockingVolumes = [level.blockingVolumes[0]];
    const car = level.actors[0];
    level.actors = [
      { classRef: TRUCK, name: "Parked K-180", position: [0, 0, 0], rotation: [0, 0, 0] },
      // A 1.2 t weight from 8 m: stands in for a rock or a falling tree.
      { ...car, name: "Falling weight", position: [0, 8, 2.3], rotation: [0, 90, 0] },
    ];
  });
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:0")).dented, { timeout: 30_000 }).toContain("Hood");
  await page.waitForTimeout(1500);
  const { dented, nodes } = await truckParts(page, "actor:0");
  console.log(`[doruk smoke] hood from above ${JSON.stringify(dented)} ${await readDeform()}`);
  for (const untouched of [...UNDER_THE_PANELS, "Front_Bumper", "Grille_Panel", "Windshield"]) expect(dented).not.toContain(untouched);
  expect(nodes).toContain("Hood");
  expect(errors).toEqual([]);
});

/** The car stays pawn and meets the truck's left front wheel arch. */
const fenderSide = (truckZ: number) => (level: any): void => {
  level.instances = [];
  level.blockingVolumes = [level.blockingVolumes[0]];
  level.actors = [level.actors[0], { classRef: TRUCK, name: "Parked K-180", position: [-2.1, 0, truckZ], rotation: [0, 90, 0] }];
};

test("Doruk K-180 fender dents under a car at town speed, and the engine stays", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, fenderSide(14));
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:1")).nodes).toContain("Fender_FL");
  await driveUntil(page, async () => (await truckParts(page, "actor:1")).dented.includes("Fender_FL"));
  const { dented, pieces } = await truckParts(page, "actor:1");
  console.log(`[doruk smoke] fender dent ${JSON.stringify(dented)} ${await readDeform()}`);
  for (const untouched of [...UNDER_THE_PANELS, "Fender_FR", "Door_R"]) expect(dented).not.toContain(untouched);
  expect(pieces).toEqual([]);
  expect(errors).toEqual([]);
});

test("Doruk K-180 grille dents under a low beam, with its lamps, and the radiator stays", async ({ page }) => {
  // Between the bumper's top and the hood's edge: a log at grille height.
  const { errors, readDeform, open } = await sceneRig(page, beamAhead(14, 1.05, 0.45), 1);
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:0")).nodes).toContain("Grille_Panel");
  await driveUntil(page, async () => (await truckParts(page, "actor:0")).dented.includes("Grille_Panel"));
  const { dented, pieces, nodes } = await truckParts(page, "actor:0");
  console.log(`[doruk smoke] grille ${JSON.stringify(dented)} ${await readDeform()}`);
  for (const untouched of [...UNDER_THE_PANELS, "Front_Bumper", "Hood"]) expect(dented).not.toContain(untouched);
  expect(nodes).toContain("Grille_Panel");
  expect(pieces).toEqual([]);
  expect(errors).toEqual([]);
});

/** A narrow post just above the bumper, in front of the left lamps; the truck starts `gap` metres off it. */
const postAhead = (y: number, height: number, gap: number) => (level: any): void => {
  level.instances = [];
  const floor = level.blockingVolumes[0];
  level.blockingVolumes = [floor, { ...floor, id: "smoke-post", name: "Smoke Post", position: [0.90, y, 3.20 + gap], size: [0.22, height, 0.5] }];
  level.worldSettings.pauseMenuWidget = "menu";
  level.actors = [{ classRef: TRUCK, name: "Driven K-180", position: [0, 0, 0], rotation: [0, 0, 0] }];
};

test("Doruk K-180 headlight dents with its socket on a soft knock and stays on", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, postAhead(1.25, 0.36, 0.25), 1);
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:0")).nodes).toContain("Headlight_L");
  await driveUntil(page, async () => (await truckParts(page, "actor:0")).dented.includes("Headlight_L"));
  const { dented, nodes, pieces } = await truckParts(page, "actor:0");
  console.log(`[doruk smoke] headlight knock ${JSON.stringify(dented)} ${await readDeform()}`);
  expect(dented).toContain("Grille_Panel");
  expect(nodes).toContain("Headlight_L");
  expect(pieces).toEqual([]);
  for (const untouched of [...UNDER_THE_PANELS, "Front_Bumper", "Headlight_R"]) expect(dented).not.toContain(untouched);
  expect(errors).toEqual([]);
});

/** The car stays pawn and meets the truck's left bed side, over the rear axle. */
const bedSide = (truckZ: number) => (level: any): void => {
  level.instances = [];
  level.blockingVolumes = [level.blockingVolumes[0]];
  level.actors = [level.actors[0], { classRef: TRUCK, name: "Parked K-180", position: [2.6, 0, truckZ], rotation: [0, 90, 0] }];
};

/** The car stays pawn and runs into the back of the truck, parked facing away. */
const rearEnd = (tailZ: number) => (level: any): void => {
  level.instances = [];
  level.blockingVolumes = [level.blockingVolumes[0]];
  level.actors = [level.actors[0], { classRef: TRUCK, name: "Parked K-180", position: [0, 0, tailZ + 3.9], rotation: [0, 0, 0] }];
};

/** An obstacle behind the truck: it backs into it from `gap` metres. */
const behind = (x: number, y: number, size: [number, number, number], gap: number) => (level: any): void => {
  level.instances = [];
  const floor = level.blockingVolumes[0];
  level.blockingVolumes = [floor, { ...floor, id: "smoke-rear", name: "Smoke Rear", position: [x, y, -3.9 - gap - size[2] / 2], size }];
  level.actors = [{ classRef: TRUCK, name: "Driven K-180", position: [0, 0, 0], rotation: [0, 0, 0] }];
};

async function reverseUntil(page: Page, settle: () => Promise<boolean>): Promise<void> {
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyS");
  await expect.poll(settle, { timeout: 70_000 }).toBe(true);
  await page.keyboard.up("KeyS");
  await page.waitForTimeout(1500);
}

/** What rides under and inside the bed, and must not follow a side or tail hit. */
const UNDER_THE_BED = ["Bed_Base", "Fuel_Tank", ...UNDER_THE_PANELS];

test("Doruk K-180 bed side dents under a car at town speed, and the bed floor stays", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, bedSide(14));
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:1")).nodes).toContain("Wood_Side_Panel_L");
  await driveUntil(page, async () => (await truckParts(page, "actor:1")).dented.includes("Wood_Side_Panel_L"));
  const { dented, pieces } = await truckParts(page, "actor:1");
  console.log(`[doruk smoke] bed side dent ${JSON.stringify(dented)} ${await readDeform()}`);
  for (const untouched of [...UNDER_THE_BED, "Wood_Side_Panel_R"]) expect(dented).not.toContain(untouched);
  expect(pieces).toEqual([]);
  expect(errors).toEqual([]);
});

test("Doruk K-180 fuel tank dents under a car, and it stays on", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, (level) => {
    bedSide(14)(level);
    level.actors[1].position[0] = 0.72;
  });
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:1")).nodes).toContain("Fuel_Tank");
  await driveUntil(page, async () => (await truckParts(page, "actor:1")).dented.includes("Fuel_Tank"));
  const { dented, nodes, pieces } = await truckParts(page, "actor:1");
  console.log(`[doruk smoke] fuel tank ${JSON.stringify(dented)} ${await readDeform()}`);
  for (const untouched of UNDER_THE_PANELS) expect(dented).not.toContain(untouched);
  expect(nodes).toContain("Fuel_Tank");
  expect(pieces).toEqual([]);
  expect(errors).toEqual([]);
});

test("Doruk K-180 rear bumper dents under a car at town speed", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, rearEnd(14));
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:1")).nodes).toContain("Rear_Bumper");
  await driveUntil(page, async () => (await truckParts(page, "actor:1")).dented.includes("Rear_Bumper"));
  const { dented, pieces } = await truckParts(page, "actor:1");
  console.log(`[doruk smoke] rear bumper dent ${JSON.stringify(dented)} ${await readDeform()}`);
  for (const untouched of UNDER_THE_BED) expect(dented).not.toContain(untouched);
  expect(pieces).toEqual([]);
  expect(errors).toEqual([]);
});

test("Doruk K-180 tailgate dents on a slow back-up into a beam", async ({ page }) => {
  const { errors, readDeform, open } = await sceneRig(page, behind(0, 1.9, [8, 1.3, 1], 0.5), 1);
  await open();
  await expect.poll(async () => (await truckParts(page, "actor:0")).nodes).toContain("Tailgate");
  await reverseUntil(page, async () => (await truckParts(page, "actor:0")).dented.includes("Tailgate"));
  const { dented, nodes, pieces } = await truckParts(page, "actor:0");
  console.log(`[doruk smoke] tailgate dent ${JSON.stringify(dented)} ${await readDeform()}`);
  for (const untouched of UNDER_THE_BED) expect(dented).not.toContain(untouched);
  expect(nodes).toContain("Tailgate");
  expect(pieces).toEqual([]);
  expect(errors).toEqual([]);
});

/** A low branch at roof height, beside the cab: any lower and the hit meets the grille's top corner first. */
const branchAhead = (level: any): void => {
  level.instances = [];
  const floor = level.blockingVolumes[0];
  level.blockingVolumes = [floor, { ...floor, id: "smoke-branch", name: "Smoke Branch", position: [1.25, 2.4, 14], size: [0.3, 0.4, 0.5] }];
  level.actors = [{ classRef: TRUCK, name: "Driven K-180", position: [0, 0, 0], rotation: [0, 0, 0] }];
};

interface HardHit {
  readonly name: string;
  readonly rig: (level: any) => void;
  /** Deformable objects in the rig: a truck alone, or a truck and what meets it. */
  readonly objects: number;
  readonly truck: string;
  /** The mesh the hit lands on. */
  readonly node: string;
  readonly untouched: readonly string[];
  readonly backwards?: boolean;
}

/**
 * Nothing comes off the K-180. The engine can still tear parts off (the Gaz-52's
 * sidecar does), but this truck's sidecar has no `detach`: a hit at speed leaves a
 * bounded dent and every mesh stays.
 */
const HARD_HITS: readonly HardHit[] = [
  { name: "bumper against a wall", rig: wallAhead(75), objects: 2, truck: "actor:0", node: "Front_Bumper", untouched: UNDER_THE_PANELS },
  { name: "door", rig: broadside(70), objects: 2, truck: "actor:1", node: "Door_L", untouched: BEHIND_THE_DOOR },
  { name: "mirror on a branch", rig: branchAhead, objects: 1, truck: "actor:0", node: "Mirror_L", untouched: ["SideGlass_L", "Windshield", "Cabin_Interior", "Mirror_R"] },
  { name: "hood under a beam", rig: beamAhead(75, 1.70, 2), objects: 1, truck: "actor:0", node: "Hood", untouched: UNDER_THE_PANELS },
  { name: "fender", rig: fenderSide(70), objects: 2, truck: "actor:1", node: "Fender_FL", untouched: UNDER_THE_PANELS },
  { name: "headlight on a post", rig: postAhead(1.25, 0.36, 10), objects: 1, truck: "actor:0", node: "Headlight_L", untouched: UNDER_THE_PANELS },
  { name: "turn signal on a post", rig: postAhead(1.505, 0.14, 10), objects: 1, truck: "actor:0", node: "Turn_Signal_L", untouched: UNDER_THE_PANELS },
  { name: "bed side", rig: bedSide(70), objects: 2, truck: "actor:1", node: "Wood_Side_Panel_L", untouched: UNDER_THE_BED },
  { name: "rear bumper", rig: rearEnd(70), objects: 2, truck: "actor:1", node: "Rear_Bumper", untouched: UNDER_THE_BED },
  { name: "tailgate on a full-speed back-up", rig: behind(0, 1.9, [8, 1.3, 1], 25), objects: 1, truck: "actor:0", node: "Tailgate", untouched: UNDER_THE_BED, backwards: true },
  { name: "tail lamp on a post", rig: behind(0.92, 0.93, [0.24, 0.12, 0.5], 5), objects: 1, truck: "actor:0", node: "Tail_Lamp_L", untouched: UNDER_THE_BED, backwards: true },
];

/** A mesh's vertices as they stand, in its own space. */
function meshVertices(page: Page, entityId: string, node: string): Promise<number[]> {
  return page.evaluate(({ id, name }) => {
    let found: any;
    for (const scene of (window as unknown as { __vehicleScenes: any[] }).__vehicleScenes) scene.traverse((item: any) => {
      if (item.userData.actorEntityId === id && item.getObjectByName("Chassis_Frame")) found = item.getObjectByName(name);
    });
    return Array.from(found.geometry.attributes.position.array as ArrayLike<number>);
  }, { id: entityId, name: node });
}

for (const hit of HARD_HITS) {
  test(`Doruk K-180 ${hit.name}: a hit at speed only dents, within the limit`, async ({ page }) => {
    test.setTimeout(240_000);
    const { errors, readDeform, open } = await sceneRig(page, hit.rig, hit.objects);
    await open();
    await expect.poll(async () => (await truckParts(page, hit.truck)).nodes).toContain(hit.node);
    const before = await truckParts(page, hit.truck);
    const rest = await meshVertices(page, hit.truck, hit.node);

    const dentedYet = async (): Promise<boolean> => (await truckParts(page, hit.truck)).dented.includes(hit.node);
    await (hit.backwards ? reverseUntil(page, dentedYet) : driveUntil(page, dentedYet));

    const { dented, nodes, pieces } = await truckParts(page, hit.truck);
    const now = await meshVertices(page, hit.truck, hit.node);
    let deepest = 0;
    for (let i = 0; i < rest.length; i += 3) {
      deepest = Math.max(deepest, Math.hypot(now[i]! - rest[i]!, now[i + 1]! - rest[i + 1]!, now[i + 2]! - rest[i + 2]!));
    }
    console.log(`[doruk smoke] ${hit.name}: deepest ${deepest.toFixed(3)} m, ${JSON.stringify(dented)} ${await readDeform()}`);
    expect(deepest).toBeGreaterThan(0.002);
    expect(deepest).toBeLessThanOrEqual(MAX_DENT + 1e-4);
    // The dent also tells the paint how far it went.
    expect(await page.evaluate(({ id, name }) => {
      let found: any;
      for (const scene of (window as unknown as { __vehicleScenes: any[] }).__vehicleScenes) scene.traverse((item: any) => {
        if (item.userData.actorEntityId === id && item.getObjectByName("Chassis_Frame")) found = item.getObjectByName(name);
      });
      return Math.max(...(found.geometry.getAttribute("forgeDentWear")?.array ?? [0]));
    }, { id: hit.truck, name: hit.node })).toBeGreaterThan(0);
    expect(pieces).toEqual([]);
    expect(nodes.sort()).toEqual(before.nodes.sort());
    expect(await readDeform()).not.toMatch(/detached/);
    for (const untouched of hit.untouched) expect(dented).not.toContain(untouched);
    expect(errors).toEqual([]);
  });
}
