import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera } from "three";
import { createFlatTerrainTile, terrainGlobalMapPath, terrainTilePath, terrainTileHeightRange, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { encodeTerrainTile, decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { expect, test, type Page, type APIRequestContext } from "./test";
import { SMOKE_ROAD_TERRAIN, SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

// QA: real Draw/Edit/gizmo input; seam bake and exact undo/redo; metadata-only
// saves; reload; locked controls; a remote tile failure and successful retry.
// Screenshots cover editing, road meshes and 8A5 river authoring/runtime output.
test.setTimeout(240_000);
const LEVEL = "layouts/__playwright-spline-world.level.json";
const TERRAIN = "landscapes/__playwright-spline-world.terrain.json";

async function setup(page: Page, request: APIRequestContext, streamed = false, seeded = false, road = false, river = false, grid = false) {
  const n = streamed ? 12 : 2, q = streamed ? 32 : 64;
  // 12 x 4 exceeds the real 36-tile streaming threshold and keeps the remote
  // corridor, without 96 unrelated files in every definition-commit cross-check.
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "Spline World", tilesX: n, tilesZ: streamed ? 4 : n,
    tileQuads: q, spacing: 1, origin: [-n * q / 2, 5, -n * q / 2], heightMin: -64, heightMax: 64, collision: true,
    layers: [{ id: "grass", name: "Grass", color: "#51823a" }, { id: "rock", name: "Rock", color: "#888888" }], tiles: [] };
  const tiles = new Map<string, TerrainTileData>();
  const write = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true });
    await writeFile(smokePublicPath(path), data);
  };
  for (let z = 0; z < def.tilesZ; z++) for (let x = 0; x < n; x++) {
    const tile = createFlatTerrainTile(def, x, z);
    if (road) for (let iz = 0; iz < tile.size; iz++) for (let ix = 0; ix < tile.size; ix++) {
      tile.heights[iz * tile.size + ix] = (z * q + iz - n * q / 2 + 16) * 0.12;
    }
    const key = tileKey(x, z);
    const range = terrainTileHeightRange(tile);
    tiles.set(key, tile); def.tiles.push({ key, minHeight: range.min, maxHeight: range.max });
    await write(terrainTilePath(TERRAIN, key), encodeTerrainTile(tile, { heightMin: -64, heightMax: 64, heightFormat: "f32" }));
  }
  if (streamed || seeded) def.splines = [{ id: "spline-1", coordinateSpace: "world", points: [
    { id: "point-1", position: streamed ? [-140, 5, -160] : [-12, 5, -16], width: 6, falloff: 3 },
    { id: "point-2", position: streamed ? [140, 5, -160] : [12, 5, -16], width: 6, falloff: 3 },
  ], segments: [{ id: "segment-1", startPointId: "point-1", endPointId: "point-2",
    deform: { enabled: true, flatten: true, raiseTerrain: true, lowerTerrain: true, targetOffset: 2 } }] }];
  if (grid) def.splines = [{ id: "spline-1", coordinateSpace: "world", points: Array.from({ length: 24 }, (_, i) => ({
    id: `point-${i + 1}`, position: [-24 + i * 2, 5 + i % 2, -16], width: 6, falloff: 3,
  })), segments: Array.from({ length: 23 }, (_, i) => ({ id: `segment-${i + 1}`, startPointId: `point-${i + 1}`, endPointId: `point-${i + 2}`,
    deform: { enabled: i % 2 === 0, flatten: true, raiseTerrain: true, lowerTerrain: true, targetOffset: i % 2 } })) }];
  await write(TERRAIN, JSON.stringify(def));
  await write(terrainGlobalMapPath(TERRAIN), encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, tiles))));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = "__playwright-spline-world";
  level.instances = level.instances.filter((group: { assetId: string }) => group.assetId === "marker:playerStart");
  level.landscapes = [{ id: "world", name: "Spline World", position: worldTerrainActorPosition(def), dataRef: TERRAIN }];
  level.riverWaters = [];
  if (road) {
    level.instances[0].placements[0].position = [-8, 9, -16];
    // A second Landscape catches compressed-data-array indexing that used to
    // attach the second actor's meshes to the first terrain: the smoke road
    // terrain, moved (with its road) so its centre is at (120, 5, 0).
    const second = "landscapes/__playwright-second-road.terrain.json";
    const roadDef = JSON.parse(await readFile(smokePublicPath(SMOKE_ROAD_TERRAIN), "utf8")) as WorldTerrainDef;
    const shift = [120 - worldTerrainActorPosition(roadDef)[0], 5 - roadDef.origin[1], -worldTerrainActorPosition(roadDef)[2]];
    roadDef.origin = roadDef.origin.map((value, axis) => value + shift[axis]!) as [number, number, number];
    for (const spline of roadDef.splines ?? []) for (const point of spline.points) {
      point.position = point.position.map((value, axis) => value + shift[axis]!) as [number, number, number];
    }
    await write(second, JSON.stringify(roadDef));
    await write(terrainTilePath(second, "0_0"), await readFile(smokePublicPath(terrainTilePath(SMOKE_ROAD_TERRAIN, "0_0"))));
    level.landscapes.push({ id: "second-road", name: "Second Road", position: worldTerrainActorPosition(roadDef), dataRef: second });
  }
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
  await page.goto(river ? "/tests/smoke/pages/terrain-river-editor.html?editor" : "/?editor", { waitUntil: "domcontentloaded", timeout: 90_000 });
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
    const button = page.getByTestId("editor-save");
    await expect(button).toBeEnabled({ timeout: 120_000 });
    const done = page.waitForResponse((response) => response.url().endsWith("/__save-layout") && response.request().method() === "POST", { timeout: 120_000 });
    await button.click();
    expect((await done).ok()).toBeTruthy();
    // Autosave and manual Save share a serial queue. The first layout response
    // can belong to an earlier snapshot; the manual button stays busy until
    // its own entire save (including sidecars and prune) has completed.
    await expect(button).toBeEnabled({ timeout: 120_000 });
    const status = page.getByTestId("editor-status");
    await expect(status).toContainText("Saved", { timeout: 30_000 });
    if (!(await status.innerText()).includes("pending")) return;
  }
  throw new Error("Sidecar edits remained pending after three Save actions");
}
const readDef = async (): Promise<WorldTerrainDef> => JSON.parse(await readFile(smokePublicPath(TERRAIN), "utf8"));
const readTile = async (key: string) => decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(TERRAIN, key))));
const riverSnapshot = (page: Page) => page.evaluate(() => (window as any).__riverQA.snapshot());

// QA: mode visibility, 10/4-column grids, Ctrl toggle, Shift range, mixed values,
// unrelated coordinates preserved, one-step bulk undo/redo, save and accordion state.
test("Landscape Details supports compact multi-selection and atomic bulk edits", async ({ page, request }, info) => {
  const { errors } = await setup(page, request, false, true, false, false, true);
  await page.locator('[data-landscape-spline="spline-1"]').click();
  const points = page.locator('[data-detail-section="landscape-control-points"]');
  const segments = page.locator('[data-detail-section="landscape-segments"]');
  await expect(points.locator('.detail-section-toggle')).toHaveText('Control Points');
  await expect(segments.locator('.detail-section-toggle')).toHaveText('Segments');
  await expect(page.locator('[data-landscape-number], [data-landscape-view], [data-heightmap-import], [data-world-terrain]')).toHaveCount(0);
  const point = (n: number) => page.locator(`[data-landscape-spline-point="point-${n}"]`);
  const segment = (n: number) => page.locator(`[data-landscape-spline-segment="segment-${n}"]`);
  await expect(point(1)).toHaveText('1'); await expect(segment(1)).toHaveText('1 > 2');
  const rows = async (selector: string) => page.locator(selector).evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
  const pointRows = await rows('[data-landscape-spline-point]');
  expect(new Set(pointRows.slice(0, 10)).size).toBe(1); expect(pointRows[10]).toBeGreaterThan(pointRows[0]!);
  const segmentRows = await rows('[data-landscape-spline-segment]');
  expect(new Set(segmentRows.slice(0, 4)).size).toBe(1); expect(segmentRows[4]).toBeGreaterThan(segmentRows[0]!);
  await point(1).click(); await point(3).click({ modifiers: ['Control'] });
  await expect(page.locator('[data-landscape-spline-point][aria-pressed="true"]')).toHaveCount(2);
  await point(3).click({ modifiers: ['Control'] });
  await expect(page.locator('[data-landscape-spline-point][aria-pressed="true"]')).toHaveCount(1);
  await point(1).click(); await point(10).click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-landscape-spline-point][aria-pressed="true"]')).toHaveCount(10);
  const y = page.locator('[data-landscape-spline-point-axis="y"]');
  await expect(y).toHaveValue(''); await expect(y).toHaveAttribute('placeholder', 'Mixed');
  await y.fill('12'); await y.press('Tab');
  await expect(y).toHaveValue('12');
  await page.getByTestId('editor-undo').click(); await expect(y).toHaveValue('');
  await page.getByTestId('editor-redo').click(); await expect(y).toHaveValue('12');
  await segments.locator('.detail-section-toggle').click();
  await point(2).click({ modifiers: ['Control'] });
  await expect(segments).toHaveClass(/collapsed/);
  await segments.locator('.detail-section-toggle').click();
  await segment(1).click(); await segment(3).click({ modifiers: ['Control'] });
  await expect(page.locator('[data-landscape-spline-segment][aria-pressed="true"]')).toHaveCount(2);
  await segment(1).click(); await segment(8).click({ modifiers: ['Shift'] });
  const offset = page.locator('[data-landscape-segment-number="deform.targetOffset"]');
  await expect(offset).toHaveValue('');
  const enabled = page.locator('[data-landscape-segment-flag="deform.enabled"]');
  expect(await enabled.evaluate((e: HTMLInputElement) => e.indeterminate)).toBe(true);
  await enabled.check();
  await offset.fill('3'); await offset.press('Tab');
  await page.getByTestId('editor-undo').click(); await expect(offset).toHaveValue('');
  await page.getByTestId('editor-redo').click(); await expect(offset).toHaveValue('3');
  await page.screenshot({ path: info.outputPath('landscape-details-spline-selection.png') });
  await save(page);
  const spline = (await readDef()).splines![0]!;
  expect(spline.points.slice(0, 10).every((p) => p.position[1] === 12)).toBe(true);
  expect(spline.points[10]!.position[1]).toBe(5);
  expect(spline.points.map((p) => p.position[0])).toEqual(Array.from({ length: 24 }, (_, i) => -24 + i * 2));
  expect(spline.points.every((p) => p.position[2] === -16)).toBe(true);
  expect(spline.segments.slice(0, 8).every((s) => s.deform?.targetOffset === 3 && s.deform.enabled)).toBe(true);
  expect(spline.segments[8]!.deform?.targetOffset ?? 0).toBe(0);
  await page.locator('[data-landscape-mode]').selectOption('paint');
  await expect(page.locator('[data-landscape-paint-tool="smoothWeights"]')).toHaveText('Weights');
  await expect(page.locator('[data-world-terrain], [data-landscape-collision], [data-landscape-spline-point]')).toHaveCount(0);
  await expect(page.locator('[data-landscape-add-layer]')).toHaveAttribute('title', /6th layer/);
  await page.screenshot({ path: info.outputPath('landscape-details-paint.png') });
  await page.locator('[data-landscape-mode]').selectOption('sculpt');
  await expect(page.locator('[data-world-terrain]')).toBeVisible();
  await expect(page.locator('[data-heightmap-export="png"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("multi-tile river follows edited spline Y through undo, reload and runtime", async ({ page, request }, info) => {
  const { errors } = await setup(page, request, false, true, false, true);
  await page.locator('[data-landscape-spline="spline-1"]').click();
  await page.locator('[data-landscape-spline-point="point-2"]').click();
  const pointY = page.locator('[data-landscape-spline-point-axis="y"]');
  await pointY.fill("9"); await pointY.press("Enter");
  await page.locator("[data-landscape-mode]").selectOption("water");
  await page.locator("[data-river-water-create]").click();
  const endHeight = async () => (await riverSnapshot(page)).waters[0]?.samples.at(-1)?.y ?? 0;
  await expect.poll(endHeight).toBeCloseTo(9.1, 5);
  const height = page.locator('[data-river-water-number="surfaceLevel"]');
  await height.fill("7"); await height.press("Enter");
  await expect.poll(endHeight).toBeCloseTo(11, 5);
  await page.locator("[data-landscape-mode]").selectOption("splines");
  await pointY.fill("7"); await pointY.press("Enter");
  await expect.poll(endHeight).toBeCloseTo(9, 5);
  await page.getByTestId("editor-undo").click();
  await expect.poll(endHeight).toBeCloseTo(11, 5);
  await page.getByTestId("editor-redo").click();
  await expect.poll(endHeight).toBeCloseTo(9, 5);
  await save(page);
  const editor = (await riverSnapshot(page)).waters[0];
  for (const sample of editor.samples) {
    expect(sample.y).toBeCloseTo(7 + (sample.x + 12) / 12, 5);
    expect(sample.depth).toBeCloseTo(sample.y - 5, 5);
  }
  await page.screenshot({ path: info.outputPath("river-spline-height-editor.png") });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.samples).toEqual(editor.samples);
  await page.goto("/tests/smoke/pages/terrain-spline-runtime.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__riverQA)), { timeout: 90_000 }).toBe(true);
  const runtime = (await riverSnapshot(page)).waters[0];
  expect(runtime.samples).toEqual(editor.samples);
  await page.evaluate(() => (window as any).__riverQA.frame());
  await page.screenshot({ path: info.outputPath("river-spline-height-runtime.png") });
  await writeFile(info.outputPath("river-spline-height.json"), JSON.stringify({ editor, runtime }, null, 2));
  expect(errors).toEqual([]);
});

test("multi-tile river UI, exact sculpt depth, foam and flow survive undo, Save/Reload and runtime", async ({ page, request }, info) => {
  test.setTimeout(480_000);
  page.setDefaultTimeout(20_000);
  const { errors } = await setup(page, request, false, true, false, true);
  await page.locator('[data-landscape-spline="spline-1"]').click();
  await page.locator("[data-landscape-mode]").selectOption("water");
  await page.locator("[data-river-water-create]").click();
  await expect.poll(async () => (await riverSnapshot(page)).waters.length).toBe(1);
  await page.getByTestId("editor-undo").click();
  await expect.poll(async () => (await riverSnapshot(page)).waters.length).toBe(0);
  await page.getByTestId("editor-redo").click();
  const height = page.locator('[data-river-water-number="surfaceLevel"]');
  await height.fill("7"); await height.press("Enter");
  const flow = page.locator('[data-river-water-number="flowSpeed"]');
  await flow.fill("1.2"); await flow.press("Enter");
  await page.locator('[data-river-water-reflection="reflectionMode"]').selectOption("environment");
  await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.samples[0]?.y).toBe(7);
  await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.reflection).toBeGreaterThan(0);
  const initial = (await riverSnapshot(page)).waters[0];
  expect(initial.position).toEqual([0, 5, 0]); expect(initial.flowSpeed).toBe(1.2);
  expect(initial.samples.every((sample: any) => sample.depth === 2 && sample.flow[0] === 1)).toBe(true);

  // The river bed uses the existing multi-tile patch/undo path.
  await page.locator("[data-landscape-mode]").selectOption("splines");
  const offset = page.locator('[data-landscape-segment-number="deform.targetOffset"]');
  await offset.fill("-1"); await offset.press("Enter");
  await page.locator("[data-landscape-spline-apply-deform]").click();
  await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBe(3);
  await page.getByTestId("editor-undo").click();
  await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBe(2);
  await page.getByTestId("editor-redo").click();
  await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBe(3);

  // A real sculpt stroke must invalidate the cached bed too, without changing the water plane.
  await page.locator("[data-landscape-mode]").selectOption("sculpt");
  await page.locator('[data-landscape-tool="lower"]').click();
  const view = (await page.locator("[data-viewport-host]").boundingBox())!;
  await page.mouse.move(view.x + view.width * 0.5, view.y + view.height * 0.5);
  await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBeGreaterThan(3);
  await page.getByTestId("editor-undo").click();
  await expect.poll(async () => Math.max(...(await riverSnapshot(page)).waters[0].samples.map((sample: any) => sample.depth))).toBe(3);
  await page.locator("[data-landscape-mode]").selectOption("splines");
  await page.locator("[data-landscape-mode]").selectOption("water");
  await expect(page.locator('[data-river-water-foam-add="ring"]')).toHaveCount(0);
  await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.foam.length).toBe(0);
  const lock = page.locator('[data-detail-toggle="locked"]');
  await lock.check(); await expect(height).toBeDisabled();
  await lock.uncheck(); await expect(height).toBeEnabled();
  await save(page);
  const saved = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(saved.riverWaters[0].coordinateSpace).toBe("world"); expect(saved.riverWaters[0].surfaceLevel).toBe(7);
  const editor = (await riverSnapshot(page)).waters[0];
  expect(editor.foam).toEqual([]);
  const time = editor.time;
  await expect.poll(async () => (await riverSnapshot(page)).waters[0].time).toBeGreaterThan(time + 0.2);
  await page.screenshot({ path: info.outputPath("world-river-editor.png") });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Spline World" }).first().click();
  await page.locator("[data-landscape-mode]").selectOption("splines");
  await page.locator("[data-landscape-mode]").selectOption("water");
  await expect(height).toHaveValue("7"); await expect(flow).toHaveValue("1.2");
  await expect.poll(async () => (await riverSnapshot(page)).waters[0]?.triangles).toBe(editor.triangles);
  await page.goto("/tests/smoke/pages/terrain-spline-runtime.html", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => page.evaluate(() => Boolean((window as any).__riverQA)), { timeout: 90_000 }).toBe(true);
  const runtime = (await riverSnapshot(page)).waters[0];
  expect(runtime.samples).toEqual(editor.samples); expect(runtime.foam).toEqual(editor.foam);
  expect(runtime.position).toEqual(editor.position); expect(runtime.reflection).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__riverQA.frame());
  await page.screenshot({ path: info.outputPath("world-river-runtime.png") });
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.evaluate(() => (window as any).__riverQA.frame());
  await page.screenshot({ path: info.outputPath("world-river-runtime-small.png") });
  await writeFile(info.outputPath("world-river.json"), JSON.stringify({ editor, runtime }, null, 2));
  expect(errors).toEqual([]);
});

test("streamed river rejects an unreadable remote bed without invented water and rebuilds on retry", async ({ page, request }, info) => {
  const { errors, def } = await setup(page, request, true, false, false, true);
  await expect.poll(async () => (await riverSnapshot(page)).streamingPending, { timeout: 60_000 }).toBe(0);
  const before = await riverSnapshot(page); expect(before.resident[0]).toBeLessThan(def.tiles.length);
  const writes: string[] = [];
  page.on("request", (req) => { if (req.url().includes("/__save-terrain-tile")) writes.push(req.url()); });
  await page.route("**/__playwright-spline-world.tiles/10_0.tile.bin", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  const failedTile = page.waitForResponse((response) => response.url().endsWith("/__playwright-spline-world.tiles/10_0.tile.bin") && response.status() === 503);
  await page.locator("[data-landscape-mode]").selectOption("water");
  await page.locator("[data-river-water-create]").click();
  // Autosave may replace the transient status text before a polling assertion.
  // The controlled 503 and absent body are durable witnesses of the failure.
  expect((await failedTile).status()).toBe(503);
  expect((await riverSnapshot(page)).waters).toEqual([]); expect(writes).toEqual([]);
  await page.unroute("**/__playwright-spline-world.tiles/10_0.tile.bin");
  const height = page.locator('[data-river-water-number="surfaceLevel"]');
  await height.fill("7"); await height.press("Enter");
  await expect.poll(async () => (await riverSnapshot(page)).waters.length, { timeout: 30_000 }).toBe(1);
  const snapshot = await riverSnapshot(page);
  expect(snapshot.resident).toEqual(before.resident);
  expect(snapshot.waters[0].samples.every((sample: any) => sample.y === 7 && sample.depth === 2)).toBe(true);
  expect(writes).toEqual([]);
  await page.screenshot({ path: info.outputPath("streamed-river-retry.png") });
  await writeFile(info.outputPath("streamed-river.json"), JSON.stringify(snapshot, null, 2));
  expect(errors).toEqual([expect.stringMatching(/503/)]);
});

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
  await page.locator("[data-landscape-mode]").selectOption("splines");
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
  const { errors, def } = await setup(page, request, true);
  expect(requested.size).toBeLessThan(def.tiles.length);
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

test("multi-tile road mesh controls persist and Play collides with the rendered banked road across the seam", async ({ page, request }, info) => {
  test.setTimeout(480_000);
  const { errors } = await setup(page, request, false, true, true);
  await page.locator('[data-landscape-spline="spline-1"]').click();
  for (const point of ["point-1", "point-2"]) {
    await page.locator(`[data-landscape-spline-point="${point}"]`).click();
    const y = page.locator('[data-landscape-spline-point-axis="y"]');
    await y.fill("8"); await y.press("Enter");
  }
  await page.locator('[data-landscape-spline-segment="segment-1"]').click();
  const flag = (key: string) => page.locator(`[data-landscape-segment-flag="mesh.${key}"]`);
  await expect(flag("enabled")).toBeDisabled();
  await page.locator("[data-landscape-segment-mesh]").selectOption("sm-road-asphalt");
  await flag("enabled").check();
  await flag("enabled").uncheck(); await flag("enabled").check();
  await flag("alignToTerrain").check(); await flag("alignToTerrain").uncheck(); await flag("alignToTerrain").check();
  await page.screenshot({ path: info.outputPath("world-road-rigid-editor.png") });
  await flag("deform").check();
  for (const [key, value] of [["spacing", "3"], ["yawOffset", "15"], ["bank", "10"]]) {
    const input = page.locator(`[data-landscape-segment-number="mesh.${key}"]`);
    await input.fill(value!); await input.press("Enter");
    await input.fill(key === "spacing" ? "2" : "0"); await input.press("Enter");
  }
  await flag("fitToLength").uncheck(); await flag("fitToLength").check();
  await flag("collision").uncheck(); await save(page);
  expect((await readDef()).splines![0]!.segments[0]!.mesh!.collision).toBe(false);
  await flag("collision").check();
  await save(page);
  const saved = await readDef();
  const mesh = saved.splines![0]!.segments[0]!.mesh!;
  expect(mesh.enabled && mesh.deform && mesh.alignToTerrain).toBe(true);
  expect(mesh.fitToLength).not.toBe(false); expect(mesh.collision).not.toBe(false);
  await page.locator("[data-landscape-segment-mesh]").selectOption("");
  await expect(flag("enabled")).toBeDisabled();
  await save(page); expect((await readDef()).splines![0]!.segments[0]!.mesh).toBeUndefined();
  await page.getByTestId("editor-undo").click();
  await save(page);
  const lock = page.locator('[data-detail-toggle="locked"]');
  await lock.check(); await expect(flag("enabled")).toBeDisabled();
  await lock.uncheck(); await expect(flag("enabled")).toBeEnabled();
  await page.locator('[data-landscape-spline-tool="edit"]').click();
  await page.locator("[data-viewport-host]").click({ position: { x: 15, y: 15 } });
  await page.screenshot({ path: info.outputPath("world-road-editor.png") });
  await page.reload();
  await page.getByTestId("outliner-row").filter({ hasText: "Spline World" }).first().click();
  await page.locator("[data-landscape-mode]").selectOption("splines");
  await page.locator('[data-landscape-spline="spline-1"]').click();
  await expect(flag("deform")).toBeChecked(); await expect(flag("collision")).toBeChecked();
  await page.goto("/tests/smoke/pages/terrain-spline-runtime.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__splineRoad?.ready)), { timeout: 90_000 }).toBe(true);
  await page.locator("#game-canvas").click();
  await page.keyboard.down("KeyD"); await page.waitForTimeout(500); await page.keyboard.up("KeyD");
  const snapshot = await page.evaluate(() => (window as any).__splineRoad.capture());
  await writeFile(info.outputPath("world-road-runtime.json"), JSON.stringify(snapshot, null, 2));
  expect(snapshot.meshCount).toBeGreaterThan(0);
  expect(snapshot.bounds.min[0]).toBeLessThan(-10); expect(snapshot.bounds.max[0]).toBeGreaterThan(10);
  expect(snapshot.colliders).toContain("landscape-splines:world");
  expect(snapshot.colliders).toContain("landscape-splines:second-road");
  expect(snapshot.parents).toEqual([{ position: [0, 5, 0], road: true }, { position: [120, 5, 0], road: true }]);
  for (const sample of snapshot.samples) {
    expect(sample.renderY).toBeGreaterThan(7.5);
    expect(Math.abs(sample.renderY - sample.physicsY)).toBeLessThan(0.01);
  }
  await page.screenshot({ path: info.outputPath("world-road-runtime.png") });
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.evaluate(() => (window as any).__splineRoad.capture());
  await page.screenshot({ path: info.outputPath("world-road-runtime-small.png") });
  expect(errors).toEqual([]);
});
