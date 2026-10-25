import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera } from "three";
import { createFlatTerrainTile, terrainGlobalMapPath, terrainTilePath, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { encodeTerrainTile, decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { expect, test, type Page, type APIRequestContext } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

// QA: real Draw/Edit/gizmo input; seam bake and exact undo/redo; metadata-only
// saves; reload; locked controls; a remote tile failure and successful retry.
// Screenshots cover the edited overlay. Mesh/water output is a later phase.
test.setTimeout(240_000);
const LEVEL = "layouts/__playwright-spline-world.level.json";
const TERRAIN = "landscapes/__playwright-spline-world.terrain.json";

async function setup(page: Page, request: APIRequestContext, streamed = false, seeded = false) {
  const n = streamed ? 12 : 2, q = streamed ? 32 : 64;
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "Spline World", tilesX: n, tilesZ: n,
    tileQuads: q, spacing: 1, origin: [-n * q / 2, 5, -n * q / 2], heightMin: -64, heightMax: 64, collision: true,
    layers: [{ id: "grass", name: "Grass", color: "#51823a" }, { id: "rock", name: "Rock", color: "#888888" }], tiles: [] };
  const tiles = new Map<string, TerrainTileData>();
  const write = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true });
    await writeFile(smokePublicPath(path), data);
  };
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const tile = createFlatTerrainTile(def, x, z);
    const key = tileKey(x, z);
    tiles.set(key, tile); def.tiles.push({ key, minHeight: 0, maxHeight: 0 });
    await write(terrainTilePath(TERRAIN, key), encodeTerrainTile(tile, { heightMin: -64, heightMax: 64, heightFormat: "f32" }));
  }
  if (streamed || seeded) def.splines = [{ id: "spline-1", coordinateSpace: "world", points: [
    { id: "point-1", position: streamed ? [-140, 5, -160] : [-12, 5, -16], width: 6, falloff: 3 },
    { id: "point-2", position: streamed ? [140, 5, -160] : [12, 5, -16], width: 6, falloff: 3 },
  ], segments: [{ id: "segment-1", startPointId: "point-1", endPointId: "point-2",
    deform: { enabled: true, flatten: true, raiseTerrain: true, lowerTerrain: true, targetOffset: 2 } }] }];
  await write(TERRAIN, JSON.stringify(def));
  await write(terrainGlobalMapPath(TERRAIN), encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, tiles))));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = "__playwright-spline-world";
  level.instances = level.instances.filter((group: { assetId: string }) => group.assetId === "marker:playerStart");
  level.landscapes = [{ id: "world", name: "Spline World", position: worldTerrainActorPosition(def), dataRef: TERRAIN }];
  level.riverWaters = [];
  await write(LEVEL, JSON.stringify(level));
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  const camera = new PerspectiveCamera();
  const target = streamed ? [-140, 5, -160] : [0, 5, -16];
  camera.position.set(target[0]!, target[1]! + 35, target[2]! + 40);
  camera.lookAt(target[0]!, target[1]!, target[2]!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(({ key, pose }) => { localStorage.clear(); localStorage.setItem(key, pose); }, {
    key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`,
    pose: JSON.stringify({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] }),
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  // These cases author terrain splines without using the asset browser. The
  // disposable project links the full asset library, whose recursive tree read
  // can monopolize disk IO during concurrent authoring/tests. Keep that unrelated
  // read deterministic; terrain definitions, tiles and every save stay real.
  await page.route("**/__project-dir/assets", (route) => route.fulfill({ json: { root: "assets", children: [] } }));
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Spline World" }).first().click();
  await page.locator("[data-landscape-mode]").selectOption("splines");
  await expect(page.locator("[data-world-terrain-splines]")).toBeVisible();
  await expect(page.locator('[data-landscape-spline-tool="draw"]')).toBeVisible();
  console.log(`[spline-editor] ${streamed ? "streamed" : seeded ? "seeded" : "empty"} fixture ready; artifacts: ${test.info().outputDir}`);
  return { def, errors };
}

async function save(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const done = page.waitForResponse((response) => response.url().endsWith("/__save-layout") && response.request().method() === "POST");
    await page.getByTestId("editor-save").click();
    expect((await done).ok()).toBeTruthy();
    const status = page.getByTestId("editor-status");
    await expect(status).toContainText("Saved");
    if (!(await status.innerText()).includes("pending")) return;
  }
  throw new Error("Sidecar edits remained pending after three Save actions");
}
const readDef = async (): Promise<WorldTerrainDef> => JSON.parse(await readFile(smokePublicPath(TERRAIN), "utf8"));
const readTile = async (key: string) => decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(TERRAIN, key))));

test("multi-tile spline Draw, point gizmo and snap survive Save and reload", async ({ page, request }, info) => {
  const writes: string[] = [];
  page.on("request", (req) => { const key = req.url().match(/__save-terrain-tile\?.*key=(\d+_\d+)/); if (key) writes.push(key[1]!); });
  const { errors } = await setup(page, request);
  await page.locator("[data-landscape-spline-create]").click();
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  const first = { x: viewport.x + viewport.width * 0.37, y: viewport.y + viewport.height * 0.5 };
  await page.mouse.click(first.x, first.y);
  await expect(page.locator("[data-landscape-spline-point]")).toHaveCount(1);
  await page.mouse.click(viewport.x + viewport.width * 0.63, first.y);
  await expect(page.locator("[data-landscape-spline-point]")).toHaveCount(2);
  await expect(page.locator("[data-landscape-spline-segment]")).toHaveCount(1);
  await save(page);
  const initial = await readDef();
  expect(initial.splines![0]!.coordinateSpace).toBe("world");
  expect(initial.splines![0]!.points[0]!.position[0]).toBeLessThan(0);
  expect(initial.splines![0]!.points[1]!.position[0]).toBeGreaterThan(0);
  expect(initial.splines![0]!.points.map((point) => point.position[1])).toEqual([5, 5]);
  expect(writes, "point edits save only the definition/global map").toEqual([]);
  console.log("[spline-editor] authored points saved across the seam");

  await page.locator('[data-landscape-spline-tool="edit"]').click();
  await page.locator('[data-landscape-spline-point="point-1"]').click();
  const x = page.locator('[data-landscape-spline-point-axis="x"]');
  const beforeX = Number(await x.inputValue());
  await page.mouse.move(first.x, first.y);
  await expect.poll(() => page.locator("#game-canvas").evaluate((canvas) => canvas.style.cursor)).toBe("pointer");
  await page.mouse.down();
  await page.mouse.move(first.x + 34, first.y - 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Move Landscape Spline Point");
  expect(Number(await x.inputValue())).not.toBe(beforeX);
  const y = page.locator('[data-landscape-spline-point-axis="y"]');
  await y.fill("8"); await y.press("Enter");
  await page.locator("[data-landscape-spline-point-snap]").click();
  await expect(y).toHaveValue("5");
  const lock = page.locator('[data-detail-toggle="locked"]');
  await lock.check(); await expect(x).toBeDisabled();
  await lock.uncheck(); await expect(x).toBeEnabled();

  await save(page);
  const saved = await readDef();
  await page.screenshot({ path: info.outputPath("world-spline-edited.png") });
  await page.reload();
  await page.getByTestId("outliner-row").filter({ hasText: "Spline World" }).first().click();
  await page.locator("[data-landscape-mode]").selectOption("splines");
  await page.locator('[data-landscape-spline="spline-1"]').click();
  await expect(page.locator("[data-landscape-spline-point]")).toHaveCount(2);
  await save(page);
  expect((await readDef()).splines).toEqual(saved.splines);
  expect(writes, "gizmo and snap still save no terrain tiles").toEqual([]);
  expect(errors).toEqual([]);
});

test("multi-tile spline seam bake supports exact undo/redo and persists after reload", async ({ page, request }, info) => {
  const writes: string[] = [];
  page.on("request", (req) => { const key = req.url().match(/__save-terrain-tile\?.*key=(\d+_\d+)/); if (key) writes.push(key[1]!); });
  const { errors } = await setup(page, request, false, true);
  await page.locator('[data-landscape-spline="spline-1"]').click();

  const flag = (key: string) => page.locator(`[data-landscape-segment-flag="${key}"]`);
  await flag("deform.enabled").check();
  const offset = page.locator('[data-landscape-segment-number="deform.targetOffset"]');
  await offset.fill("2"); await offset.press("Enter");
  await flag("paint.enabled").check();
  await page.locator("[data-landscape-segment-layer]").selectOption("rock");
  await page.locator("[data-landscape-spline-apply-deform]").click();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Apply Spline Terrain Deform");
  await page.locator("[data-landscape-spline-apply-paint]").click();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Apply Spline Layer Paint");
  await save(page);
  expect([...new Set(writes)].sort()).toEqual(["0_0", "1_0"]);
  console.log("[spline-editor] deform and paint saved to the two corridor tiles");
  const baked = await Promise.all([readTile("0_0"), readTile("1_0")]);
  expect(baked.every((tile) => tile.heights.some((height) => height > 1.9))).toBe(true);
  expect(baked.every((tile) => tile.weights.some((weight, index) => index % 4 === 1 && weight > 200))).toBe(true);
  for (let z = 0; z < 65; z++) {
    expect(baked[0]!.heights[z * 65 + 64]).toBe(baked[1]!.heights[z * 65]);
    for (let channel = 0; channel < 4; channel++) expect(baked[0]!.weights[(z * 65 + 64) * 4 + channel]).toBe(baked[1]!.weights[z * 65 * 4 + channel]);
  }
  await page.getByTestId("editor-undo").click();
  await page.getByTestId("editor-undo").click();
  await save(page);
  for (const key of ["0_0", "1_0"]) {
    const tile = await readTile(key);
    expect(tile.heights.every((height) => height === 0)).toBe(true);
    expect(tile.weights.every((weight, index) => weight === (index % 4 === 0 ? 255 : 0))).toBe(true);
  }
  await page.getByTestId("editor-redo").click(); await page.getByTestId("editor-redo").click();
  await save(page);
  for (let i = 0; i < 2; i++) {
    const tile = await readTile(["0_0", "1_0"][i]!);
    expect(tile.heights).toEqual(baked[i]!.heights); expect(tile.weights).toEqual(baked[i]!.weights);
  }
  const saved = await readDef();
  await page.screenshot({ path: info.outputPath("world-spline-edited.png") });
  await page.reload();
  await page.getByTestId("outliner-row").filter({ hasText: "Spline World" }).first().click();
  await page.locator("[data-landscape-mode]").selectOption("splines");
  await page.locator('[data-landscape-spline="spline-1"]').click();
  await expect(page.locator("[data-landscape-spline-point]")).toHaveCount(2);
  await save(page); expect((await readDef()).splines).toEqual(saved.splines);
  expect(errors).toEqual([]);
});

test("streamed spline bake rejects a missing remote tile without partial writes and succeeds on retry", async ({ page, request }, info) => {
  const requested = new Set<string>(), written: string[] = [];
  page.on("request", (req) => {
    const tile = req.url().match(/__playwright-spline-world\.tiles\/(\d+_\d+)\.tile.bin/);
    if (tile) requested.add(tile[1]!);
    const save = req.url().match(/__save-terrain-tile\?.*key=(\d+_\d+)/);
    if (save) written.push(save[1]!);
  });
  const { errors } = await setup(page, request, true);
  expect(requested.size).toBeLessThan(144);
  expect(requested.has("10_0")).toBe(false);
  await page.locator('[data-landscape-spline="spline-1"]').click();
  await page.route("**/__playwright-spline-world.tiles/10_0.tile.bin", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.locator("[data-landscape-spline-apply-deform]").click();
  await expect(page.getByTestId("editor-status")).toContainText("Spline deform failed", { timeout: 30_000 });
  expect(written).toEqual([]);
  expect((await readTile("1_0")).heights.every((height) => height === 0)).toBe(true);
  await page.unroute("**/__playwright-spline-world.tiles/10_0.tile.bin");
  await page.locator("[data-landscape-spline-apply-deform]").click();
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Apply Spline Terrain Deform", { timeout: 30_000 });
  await save(page);
  expect(requested.has("10_0")).toBe(true);
  expect(written).toContain("10_0");
  expect((await readTile("10_0")).heights.some((height) => height === 2)).toBe(true);
  expect((await readTile("10_1")).heights.some((height) => height === 2)).toBe(true);
  await page.screenshot({ path: info.outputPath("streamed-spline-baked.png") });
  expect(errors).toEqual([expect.stringMatching(/503/)]);
});
