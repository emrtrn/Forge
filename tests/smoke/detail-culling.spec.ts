import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./test";
import { REPO_ROOT } from "./smokeProject.mjs";

/**
 * OPEN_WORLD_PLAN Faz 7e: in a World Partition level, small static placements
 * render through the size-scaled dither-fade materials, and a cell batch whose
 * nearest point is past its cull distance is not drawn. floor-400x400 (a 4 m
 * tile; the smoke project's material slots make it render as per-placement
 * clones, which cull like an instanced cell batch) has a ~2.83 m bounding radius → 566 m at scale 1, × 0.85 on the "high" profile ≈
 * 481 m: the tile 600 m away is skipped, the near one and a 3× tile there are not.
 * The level is served in flight, so no project file is written.
 */

const LEVEL = "layouts/__playwright-detail-culling.level.json";

test("detail culling: far small statics are skipped, near and large-scaled ones still draw", async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });

  const level = JSON.parse(await readFile(resolve(REPO_ROOT, "tests/smoke/fixtures/base.level.json"), "utf8"));
  level.name = "__playwright-detail-culling";
  level.worldSettings = {
    ...level.worldSettings,
    staticObjectsCastShadow: true,
    partition: { enabled: true, grids: { main: { cellSize: 128, loadRange: 1000 }, foliage: { cellSize: 64, loadRange: 256 } } },
  };
  level.instances = [
    { assetId: "floor-400x400", placements: [
      { name: "near", position: [0, 0, 0], rotationYDeg: 0, scale: 1, scaleLocked: true },
      { name: "far", position: [600, 0, 0], rotationYDeg: 0, scale: 1, scaleLocked: true },
      { name: "far-large", position: [600, 0, 300], rotationYDeg: 0, scale: 3, scaleLocked: true },
    ] },
  ];
  level.lights = level.lights.map((light: { type: string }) => light.type === "directional" ? { ...light, castShadow: true } : light);
  await page.route(`**/${LEVEL}`, (route) => route.fulfill({ json: level }));
  await page.route("**/project.3dgame.json", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    project.editor.defaultScene = LEVEL;
    await route.fulfill({ response, json: project });
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("forge.userSettings", JSON.stringify({
      schema: 1,
      updatedAt: new Date().toISOString(),
      payload: { graphics: { selectedQualityLevel: "high", manuallySelected: true, adaptiveOptimizationEnabled: false } },
    }));
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __cullScenes: any[]; __cullRenderer?: any };
    w.__cullScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail;
      if (object?.isScene) w.__cullScenes.push(object);
      if (object?.isWebGLRenderer) w.__cullRenderer = object;
    });
  });

  await page.goto(`/?detailCulling=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });

  const probe = () => page.evaluate(() => {
    const w = window as unknown as { __cullScenes: any[]; __cullRenderer: any };
    const batches: { x: number; z: number; visible: boolean; compiled: boolean }[] = [];
    for (const scene of w.__cullScenes) scene.traverse((node: any) => {
      if (!node.isMesh || !String(node.material?.customProgramCacheKey?.()).includes("forge-foliage-fade-scaled")) return;
      let sphere;
      if (node.isInstancedMesh) {
        node.computeBoundingSphere();
        // Placements drawn as clones leave hidden (zero) instances behind; skip those.
        if (node.count === 0 || !(node.boundingSphere.radius > 0)) return;
        sphere = node.boundingSphere.clone();
      } else {
        sphere = node.geometry.boundingSphere.clone();
      }
      const center = sphere.applyMatrix4(node.matrixWorld).center;
      batches.push({
        x: Math.round(center.x),
        z: Math.round(center.z),
        visible: node.visible,
        compiled: Boolean(w.__cullRenderer.properties.get(node.material).currentProgram),
      });
    });
    return batches.sort((a, b) => a.x - b.x || a.z - b.z);
  });
  await expect.poll(async () => (await probe()).length, { timeout: 30_000 }).toBe(3);
  // Let a few frames run so the per-frame cull has settled.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  const batches = await probe();
  console.log(`[detail-culling] ${JSON.stringify(batches)}`);
  // Tile origins are corners, so centres sit a half tile (× scale) in.
  expect(batches.map(({ x, z, visible }) => ({ x: Math.round(x / 100) * 100, z: Math.round(z / 100) * 100, visible }))).toEqual([
    { x: 0, z: 0, visible: true },
    { x: 600, z: 0, visible: false },
    { x: 600, z: 300, visible: true },
  ]);
  expect(batches[0]!.compiled).toBe(true);
  expect(errors).toEqual([]);
});
