import { expect, test, type Page } from "./test";
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
  expect(parked.size[2]).toBeCloseTo(7.2, 2);
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
