import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { PerspectiveCamera } from "three";
import { createLakeFixture } from "../engine/fixtures/lakeFixture";
import { terrainGlobalMapPath, terrainTilePath, createFlatTerrainTile, tileKey } from "../../engine/terrain/terrainTypes";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { expect, test, type Page, type APIRequestContext } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

const LEVEL = "layouts/__playwright-lake-world.level.json", TERRAIN = "landscapes/__playwright-lake-world.terrain.json";
const snapshot = (page: Page) => page.evaluate(() => (window as any).__lakeQA.snapshot());
async function clickWorld(page: Page, point: number[]) {
  const p = await page.evaluate((p) => (window as any).__lakeQA.project(...p), point); await page.mouse.click(p.x, p.y);
}
async function number(page: Page, key: string, value: number) { const field = page.locator(`[data-lake-number="${key}"]`); await field.fill(String(value)); await field.press("Tab"); }
async function setup(page: Page, request: APIRequestContext, seeded = false, streamed = false) {
  const doc = createLakeFixture();
  if (streamed) {
    const original = new Map(doc.tiles); doc.def.tilesX = 12; doc.def.tilesZ = 4; doc.def.tiles = []; doc.tiles.clear();
    for (let z = 0; z < 4; z++) for (let x = 0; x < 12; x++) {
      const source = original.get(tileKey(x - 6, z)), tile = source ? { ...source, x, z } : createFlatTerrainTile(doc.def, x, z);
      if (!source) tile.heights.fill(6);
      const key = tileKey(x, z); doc.tiles.set(key, tile); doc.def.tiles.push({ key, minHeight: 0, maxHeight: 6 });
    }
    doc.lake.seed[0] += 384; doc.lake.bounds.min[0] += 384; doc.lake.bounds.max[0] += 384;
  }
  const write = async (path: string, data: string | Uint8Array) => { const p = smokePublicPath(path); await mkdir(dirname(p), { recursive: true }); await writeFile(p, data); };
  for (const [key, tile] of doc.tiles) await write(terrainTilePath(TERRAIN, key), encodeTerrainTile(tile, { heightMin: -64, heightMax: 64, heightFormat: "f32" }));
  await write(TERRAIN, JSON.stringify(doc.def));
  await write(terrainGlobalMapPath(TERRAIN), encodeTerrainGlobalMap(doc.def, buildTerrainGlobalAttributes(worldTerrainRenderSource(doc.def, doc.tiles))));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.instances = level.instances.filter((g: { assetId: string }) => g.assetId === "marker:playerStart");
  level.instances[0].placements[0].position = [-20, 15, -12];
  level.landscapes = [{ id: "terrain", name: "Lake QA Terrain", position: worldTerrainActorPosition(doc.def), dataRef: TERRAIN }];
  level.riverWaters = []; level.waterBodies = seeded ? [doc.lake] : [];
  level.actors = []; level.characters = [];
  await write(LEVEL, JSON.stringify(level)); expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  const camera = new PerspectiveCamera(); camera.position.set(0, 90, 85); camera.lookAt(0, 10, 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(({ key, pose }) => { localStorage.clear(); localStorage.setItem(key, pose); }, {
    key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`, pose: JSON.stringify({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] }),
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/__project-dir/assets", (route) => route.fulfill({ json: { root: "assets", children: [] } }));
  await page.goto("/tests/smoke/pages/terrain-lake-editor.html?editor", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Lake QA Terrain" }).first().click();
  return { doc, errors };
}
async function terrainHash() {
  const hash = createHash("sha256"); hash.update(await readFile(smokePublicPath(TERRAIN)));
  for (const key of ["0_0", "1_0", "0_1", "1_1"]) hash.update(await readFile(smokePublicPath(terrainTilePath(TERRAIN, key))));
  return hash.digest("hex");
}
async function ready(page: Page) { await expect.poll(async () => (await snapshot(page)).results[0]?.status, { timeout: 60_000 }).toBe("ready"); }
async function save(page: Page) {
  const button = page.getByTestId("editor-save"); await expect(button).toBeEnabled({ timeout: 120_000 });
  const response = page.waitForResponse((r) => r.url().endsWith("/__save-layout") && r.request().method() === "POST", { timeout: 120_000 });
  await button.click(); expect((await response).ok()).toBeTruthy(); await expect(button).toBeEnabled({ timeout: 120_000 });
}

// QA inventory: click/create/cancel; world level, four bounds and drag handles;
// island/isolated basin + escape rejection; selection/flags/delete/undo;
// real Save/Reload/Play and unchanged terrain; sculpt and retry in separate cases.
test("Lake UI creates a connected two-seam lake, preserves terrain and survives undo, Save/Reload and Play", async ({ page, request }, info) => {
  test.setTimeout(480_000);
  const { errors } = await setup(page, request), hash = await terrainHash();
  await page.locator("[data-lake-begin]").click();
  await page.keyboard.press("Escape"); await expect(page.locator("[data-lake-begin]")).toBeEnabled();
  await page.locator("[data-lake-begin]").click(); await clickWorld(page, [-20, 10, -12]);
  await expect(page.locator("[data-lake-number=surfaceLevel]")).toBeVisible();
  for (const [key, v] of [["minX", -48], ["minZ", -48], ["maxX", 48], ["maxZ", 48], ["surfaceLevel", 12]] as const) await number(page, key, v);
  await ready(page); await expect(page.locator("[data-lake-create]")).toBeEnabled();
  await page.locator("[data-lake-create]").click();
  await page.getByTestId("outliner-row").filter({ hasText: "Lake 1" }).first().click();
  await ready(page); const initial = (await snapshot(page)).results[0]; expect(initial.escape).toBe(15);
  await number(page, "surfaceLevel", 15); await expect(page.locator("[data-lake-status]")).toContainText("Area opens");
  expect((await snapshot(page)).objects).toBe(0);
  await page.getByTestId("editor-undo").click(); await ready(page);
  expect((await snapshot(page)).results[0].hash).toBe(initial.hash);
  await page.locator("[data-lake-locked]").check(); await expect(page.locator("[data-lake-number=surfaceLevel]")).toBeDisabled();
  await page.locator("[data-lake-locked]").uncheck(); await ready(page);
  await page.locator("[data-lake-reflection]").selectOption("sharedPlanar"); await ready(page);
  await page.locator("[data-lake-reflection]").selectOption("off"); await ready(page);
  await page.screenshot({ path: info.outputPath("lake-editor.png") });
  const button = page.getByTestId("editor-save"); await expect(button).toBeEnabled({ timeout: 120_000 });
  const saved = page.waitForResponse((r) => r.url().endsWith("/__save-layout") && r.request().method() === "POST");
  await button.click(); expect((await saved).ok()).toBeTruthy(); await expect(button).toBeEnabled({ timeout: 120_000 });
  expect(await terrainHash()).toBe(hash);
  const source = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8")); expect(source.waterBodies[0].surfaceLevel).toBe(12);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 }); await ready(page);
  expect((await snapshot(page)).results[0].hash).toBe(initial.hash);
  await page.getByTestId("outliner-row").filter({ hasText: "Lake 1" }).first().click(); await page.locator("[data-lake-delete]").click();
  await expect.poll(async () => (await snapshot(page)).objects).toBe(0);
  await page.getByTestId("editor-undo").click(); await ready(page);
  await save(page);
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect.poll(async () => page.evaluate(() => Boolean((window as any).__lakeQA)), { timeout: 90_000 }).toBe(true);
  await ready(page); const runtime = (await snapshot(page)).results[0]; expect(runtime.hash).toBe(initial.hash);
  await page.evaluate(() => (window as any).__lakeQA.frame()); await page.screenshot({ path: info.outputPath("lake-runtime.png") });
  await page.setViewportSize({ width: 1100, height: 720 }); await page.evaluate(() => (window as any).__lakeQA.frame(true));
  await page.screenshot({ path: info.outputPath("lake-runtime-top.png") });
  await writeFile(info.outputPath("lake.json"), JSON.stringify({ initial, runtime, errors }, null, 2)); expect(errors).toEqual([]);
});

test("Lake bounds drag and seed editing use undo; seam sculpt refreshes exact depth and undo restores it", async ({ page, request }, info) => {
  test.setTimeout(300_000); const { errors } = await setup(page, request, true); await ready(page);
  await page.locator('[data-object-id="lake:0"]').click();
  const initial = (await snapshot(page)).results[0];
  const points = await page.evaluate(() => ([ [0,12.1,-48], [0,12.1,-44] ]).map((p) => (window as any).__lakeQA.project(...p)));
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  expect(points[0].y).toBeGreaterThan(viewport.y); expect(points[0].y).toBeLessThan(viewport.y + viewport.height);
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('[data-lake-number="minZ"]')).toHaveValue("-44"); await ready(page);
  await page.getByTestId("editor-undo").click(); await ready(page);
  await expect(page.locator('[data-lake-number="minZ"]')).toHaveValue("-48");
  await page.locator("[data-lake-reseed]").click(); await clickWorld(page, [-16,10,-12]); await ready(page);
  await page.getByTestId("editor-undo").click(); await ready(page);
  await page.locator("[data-lake-terrain]").click();
  await page.locator("[data-landscape-mode]").selectOption("sculpt");
  await page.locator('[data-landscape-tool="lower"]').click();
  const brush = page.locator('[data-landscape-number="brushSize"]'); await brush.fill("5"); await brush.press("Enter");
  const point = await page.evaluate(() => (window as any).__lakeQA.project(0,10,-12));
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  await ready(page); expect((await snapshot(page)).results[0].maxDepth).toBeGreaterThan(2);
  await page.getByTestId("editor-undo").click(); await ready(page);
  expect((await snapshot(page)).results[0].hash).toBe(initial.hash);
  await page.getByTestId("editor-redo").click(); await ready(page);
  expect((await snapshot(page)).results[0].maxDepth).toBeGreaterThan(2);
  await page.getByTestId("editor-undo").click(); await ready(page);
  const unchanged = (await snapshot(page)).results[0];
  await page.locator('[data-landscape-tool="flatten"]').click();
  await clickWorld(page, [0,10,-12]);
  expect((await snapshot(page)).results[0]?.hash).toBe(unchanged.hash);
  await page.locator('[data-landscape-tool="lower"]').click();
  await clickWorld(page, [0,16,-58]);
  const distant = (await snapshot(page)).results[0];
  expect(distant?.hash).toBe(unchanged.hash); expect(distant?.ms).toBe(unchanged.ms);
  await page.screenshot({ path: info.outputPath("lake-sculpt.png") }); expect(errors).toEqual([]);
});

test("Streamed Lake rejects a remote 503 and retries without activating or saving bed tiles", async ({ page, request }, info) => {
  test.setTimeout(300_000);
  await page.route("**/__playwright-lake-world.tiles/7_0.tile.bin", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  const writes: string[] = []; page.on("request", (r) => { if (r.url().includes("/__save-terrain")) writes.push(r.url()); });
  const { errors, doc } = await setup(page, request, true, true);
  await page.locator('[data-object-id="lake:0"]').click();
  await expect(page.locator("[data-lake-status]")).toContainText("503", { timeout: 60_000 });
  await expect.poll(async () => (await snapshot(page)).streamingPending, { timeout: 60_000 }).toBe(0);
  const before = await snapshot(page); expect(before.objects).toBe(0); expect(before.resident[0].count).toBeLessThan(doc.def.tiles.length);
  await page.unroute("**/__playwright-lake-world.tiles/7_0.tile.bin"); await page.locator("[data-lake-retry]").click();
  await ready(page); const after = await snapshot(page); expect(after.objects).toBe(1);
  expect(after.resident).toEqual(before.resident); expect(writes).toEqual([]);
  await writeFile(info.outputPath("lake-streaming.json"), JSON.stringify({ before, after, writes }, null, 2));
  await page.screenshot({ path: info.outputPath("lake-streaming-retry.png") });
  expect(errors.every((e) => e.includes("503"))).toBe(true);
});

test("Lake GPU pilot measures 300 paired baseline/surface frames", async ({ page, request }, info) => {
  test.setTimeout(360_000); await setup(page, request, true);
  await page.goto("/tests/smoke/pages/terrain-lake-runtime.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect.poll(async () => page.evaluate(() => Boolean((window as any).__lakeQA)), { timeout: 90_000 }).toBe(true);
  await ready(page); await page.evaluate(() => (window as any).__lakeQA.frame());
  const gpu = await page.evaluate(() => (window as any).__lakeQA.gpuPilot());
  await writeFile(info.outputPath("lake-gpu.json"), JSON.stringify(gpu, null, 2)); console.log("[lake-gpu]", JSON.stringify(gpu));
  test.skip(!gpu.available, gpu.reason ?? "GPU timer unavailable");
  expect(gpu.additionalCalls).toBe(1); expect(gpu.frames).toBe(300);
});
