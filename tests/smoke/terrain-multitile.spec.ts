import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera, Vector3 } from "three";
import { foliageDataPath, normalizeFoliageType, type LandscapeFoliageRule, type LayoutFoliageData } from "../../engine/scene/foliage";
import { generateFoliageCell, worldTerrainFoliageSurface } from "../../engine/scene/proceduralFoliage";
import { planFoliageRing } from "../../engine/world/foliageRing";
import { terrainFaceNormalAt, terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { decodeTerrainTile, encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import {
  createFlatTerrainTile,
  terrainTileHeightRange,
  terrainGlobalMapPath,
  terrainTilePath,
  tileKey,
  type TerrainTileData,
  type WorldTerrainDef,
} from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { expect, test, type Page } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

/**
 * A Landscape actor that references a multi-tile World Terrain (OPEN_WORLD_PLAN
 * Faz 2) loads in the editor and in Play: it is drawn, picked and focused, its
 * transform stays locked, an unedited Save leaves its files alone, a sculpt
 * stroke across a tile seam writes only the touched tiles (seam rows equal),
 * undo restores their exact bytes, and it collides per tile so the pawn stands
 * on it.
 *
 * The fixture is 3×2 tiles with one hole, its origin off the world centre, and
 * no sky (the sky renders black in headless Chromium and would hide a blank
 * frame behind a constant).
 */

const LEVEL = "layouts/__playwright-terrain-multitile.level.json";
const TERRAIN = "landscapes/__playwright-world.terrain.json";
const Q = 64;
const HOLE = tileKey(2, 1);

function heightAt(gx: number, gz: number): number {
  return Math.fround(3 + 2.5 * Math.sin(gx * 0.07) * Math.cos(gz * 0.05) + 0.01 * gx);
}

function fixture(): { def: WorldTerrainDef; tiles: Map<string, TerrainTileData> } {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Smoke World", tileQuads: Q, spacing: 1, tilesX: 3, tilesZ: 2,
    origin: [-80, 1, -50], heightMin: -64, heightMax: 64,
    layers: [{ id: "grass", name: "Grass", color: "#4f7f3a" }, { id: "rock", name: "Rock", color: "#8a8178" }],
    tiles: [], collision: true,
  };
  const tiles = new Map<string, TerrainTileData>();
  for (let tz = 0; tz < def.tilesZ; tz += 1) {
    for (let tx = 0; tx < def.tilesX; tx += 1) {
      const key = tileKey(tx, tz);
      if (key === HOLE) continue;
      const tile = createFlatTerrainTile(def, tx, tz);
      for (let z = 0; z <= Q; z += 1) {
        for (let x = 0; x <= Q; x += 1) {
          const index = z * (Q + 1) + x;
          const gx = tx * Q + x;
          const gz = tz * Q + z;
          tile.heights[index] = heightAt(gx, gz);
          // Rock stripes make the paint (and a tile mix-up) visible.
          const rock = Math.sin(gx * 0.15 + gz * 0.04) > 0.4 ? 255 : 0;
          tile.weights[index * 4] = 255 - rock;
          tile.weights[index * 4 + 1] = rock;
        }
      }
      const range = terrainTileHeightRange(tile);
      def.tiles.push({ key, minHeight: range.min, maxHeight: range.max });
      tiles.set(key, tile);
    }
  }
  return { def, tiles };
}

const world = fixture();
const lookup = { tile: (x: number, z: number) => world.tiles.get(tileKey(x, z)) };
const CENTRE = worldTerrainActorPosition(world.def);
/** Player Start X/Z: inside tile (0, 0), well away from the origin. */
const SPAWN: [number, number] = [-52.3, -31.7];
const SPAWN_GROUND = terrainHeightAt(world.def, lookup, SPAWN[0], SPAWN[1])!;

async function writeFixture(): Promise<void> {
  const write = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true });
    await writeFile(smokePublicPath(path), data);
  };
  for (const [key, tile] of world.tiles) {
    await write(terrainTilePath(TERRAIN, key), encodeTerrainTile(tile, {
      heightMin: world.def.heightMin, heightMax: world.def.heightMax, heightFormat: "f32",
    }));
  }
  await write(terrainGlobalMapPath(TERRAIN), encodeTerrainGlobalMap(world.def,
    buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles))));
  await write(TERRAIN, JSON.stringify(world.def, null, 2));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = "__playwright-terrain-multitile";
  // Only the Player Start, dropped from above the terrain onto tile (0, 0).
  level.instances = level.instances.filter((group: { assetId: string }) => group.assetId === "marker:playerStart");
  const start = level.instances[0];
  if (!start) throw new Error("smoke spline level has no Player Start");
  start.placements = [{ ...start.placements[0], position: [SPAWN[0], SPAWN_GROUND + 2, SPAWN[1]] }];
  level.riverWaters = [];
  level.landscapes = [{ id: "world", name: "World Terrain", position: CENTRE, dataRef: TERRAIN }];
  await write(LEVEL, JSON.stringify(level, null, 2));
}

/** On the X seam between tiles (0, 0) and (1, 0), inside row 0 (z −50..14). */
const SEAM: [number, number] = [world.def.origin[0] + Q, -10];
/** World Y; tile heights are this minus origin Y. */
const SEAM_GROUND = terrainHeightAt(world.def, lookup, SEAM[0], SEAM[1])!;
/** Seam vertex (tile-local row) in both tiles' arrays. */
const SEAM_ROW = SEAM[1] - world.def.origin[2];

function cameraPose(target: [number, number, number], offset: [number, number, number]) {
  const camera = new PerspectiveCamera();
  camera.position.set(target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]);
  camera.lookAt(target[0], target[1], target[2]);
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] };
}

/** Overview from the south-west; the seam view looks at the seam point, so the viewport centre ray hits it. */
const OVERVIEW_POSE = cameraPose(CENTRE, [-150, 110, 150]);
const SEAM_POSE = cameraPose([SEAM[0], SEAM_GROUND, SEAM[1]], [-18, 14, 18]);

async function viewportShot(page: Page): Promise<Buffer> {
  // An element screenshot of a WebGL canvas reads an empty drawing buffer.
  const clip = await page.locator("[data-viewport-host]").boundingBox();
  if (!clip) throw new Error("Missing viewport bounds");
  return page.screenshot({ clip });
}

/**
 * Share of pixels that differ from the viewport background, read from a corner
 * pixel of `background` (default: the image itself). A focused close-up is all
 * terrain, so it is measured against the overview's empty corner.
 */
async function coverage(page: Page, image: Buffer, background = image): Promise<number> {
  return page.evaluate(async ([base64, backgroundBase64]) => {
    const read = async (data: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    };
    const { pixels } = await read(base64!);
    const reference = await read(backgroundBase64!);
    // A few pixels in: the viewport frame's border line is not background.
    const corner = (4 * reference.width + 4) * 4;
    const [r, g, b] = [reference.pixels[corner]!, reference.pixels[corner + 1]!, reference.pixels[corner + 2]!];
    let covered = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const delta = Math.max(Math.abs(pixels[index]! - r), Math.abs(pixels[index + 1]! - g), Math.abs(pixels[index + 2]! - b));
      if (delta > 24) covered += 1;
    }
    return covered / (pixels.length / 4);
  }, [image.toString("base64"), background.toString("base64")] as const);
}

/** Straight from disk: right after a write the dev server may not list a new public file yet. */
async function fileBytes(path: string): Promise<Buffer> {
  return readFile(smokePublicPath(path));
}

test("multi-tile World Terrain loads, sculpts across a tile seam, saves only edited tiles and collides per tile in Play", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await writeFixture();
  const before = new Map<string, Buffer>();
  for (const path of [TERRAIN, ...world.def.tiles.map(({ key }) => terrainTilePath(TERRAIN, key))]) {
    before.set(path, await fileBytes(path));
  }
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 860 });
  // Every editor load starts from a known camera: `seam` in the URL picks the seam view.
  await page.addInitScript(({ key, overview, seam }) => {
    localStorage.clear();
    localStorage.setItem(key, location.search.includes("seam=") ? seam : overview);
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`, overview: JSON.stringify(OVERVIEW_POSE), seam: JSON.stringify(SEAM_POSE) });

  // Editor: drawn, selectable, focusable.
  await page.goto(`/?editor&multiTile=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  const row = page.getByTestId("outliner-row").filter({ hasText: "World Terrain" }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2_000);
  const editorShot = await viewportShot(page);
  await row.click();
  const details = page.locator("[data-world-terrain]");
  await expect(details).toContainText("3 × 2 (1 empty)");
  await expect(details).toContainText("192 m × 128 m");
  await expect(page.locator("[data-world-terrain-limits]")).toContainText("Splines, resizing and PNG heightmaps");
  await expect(page.locator("[data-world-terrain-limits]")).not.toContainText("Foliage painting");
  await expect(page.locator("[data-world-terrain-tools] [data-landscape-mode] option")).toHaveCount(2);
  for (const input of await page.locator('input[data-detail="pr"]').all()) await expect(input).toBeDisabled();
  await page.keyboard.press("f");
  await expect(page.getByTestId("editor-status")).toContainText("Focused World Terrain");
  await page.waitForTimeout(1_000);
  const focusedShot = await viewportShot(page);

  // An unedited Save keeps the reference and never rewrites the terrain files.
  const savedResponse = page.waitForResponse((response) => response.url().endsWith("/__save-layout") && response.request().method() === "POST");
  await page.getByTestId("editor-save").click();
  expect((await savedResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 20_000 });
  const level = await (await request.get(`/${LEVEL}?t=${Date.now()}`)).json();
  expect(level.landscapes).toEqual([{ id: "world", name: "World Terrain", position: CENTRE, dataRef: TERRAIN }]);
  for (const [path, bytes] of before) expect((await fileBytes(path)).equals(bytes), path).toBe(true);

  // Sculpt: a Raise stroke on the (0, 0) | (1, 0) seam, from a camera looking at it.
  await page.goto(`/?editor&seam=${Date.now()}`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await row.click();
  await page.locator('[data-world-terrain-tools] [data-landscape-mode]').selectOption('sculpt');
  await page.locator('[data-world-terrain-tools] [data-landscape-tool="raise"]').click();
  await page.locator('[data-landscape-number="brushSize"]').fill("6");
  await page.locator('[data-landscape-number="brushSize"]').press("Enter");
  await page.locator('[data-landscape-number="strength"]').fill("0.5");
  await page.locator('[data-landscape-number="strength"]').press("Enter");
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  const centre = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  const terrainSaved = () => page.waitForResponse((response) => response.url().endsWith("/__save-terrain") && response.request().method() === "POST", { timeout: 20_000 });
  let saved = terrainSaved();
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 3, centre.y + 1, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId("editor-undo")).toBeEnabled();
  expect((await saved).ok()).toBeTruthy();
  const edited = ["0_0", "1_0"].map((key) => terrainTilePath(TERRAIN, key));
  for (const [path, bytes] of before) {
    if (path === TERRAIN) continue;
    expect((await fileBytes(path)).equals(bytes), `${path} ${edited.includes(path) ? "was edited" : "was untouched"}`).toBe(!edited.includes(path));
  }
  const [left, right] = await Promise.all(edited.map(async (path) => decodeTerrainTile(await fileBytes(path))));
  for (let z = 0; z <= Q; z += 1) expect(left!.heights[z * (Q + 1) + Q], `seam row ${z}`).toBe(right!.heights[z * (Q + 1)]);
  const seamHeight = left!.heights[SEAM_ROW * (Q + 1) + Q]! + world.def.origin[1];
  console.log(`[terrain-multitile] seam ${SEAM_GROUND} -> ${seamHeight}`);
  expect(seamHeight).toBeGreaterThan(SEAM_GROUND + 0.1);
  const definition = JSON.parse((await fileBytes(TERRAIN)).toString("utf8")) as WorldTerrainDef;
  expect(definition.tiles.find((tile) => tile.key === "0_0")!.maxHeight + world.def.origin[1]).toBeGreaterThanOrEqual(seamHeight);

  // Undo restores both tiles to their exact original bytes.
  saved = terrainSaved();
  await page.getByTestId("editor-undo").click();
  expect((await saved).ok()).toBeTruthy();
  for (const path of edited) expect((await fileBytes(path)).equals(before.get(path)!), `${path} after undo`).toBe(true);
  // Redo, so Play loads the edited terrain.
  saved = terrainSaved();
  await page.getByTestId("editor-redo").click();
  expect((await saved).ok()).toBeTruthy();
  expect(decodeTerrainTile(await fileBytes(edited[0]!)).heights[SEAM_ROW * (Q + 1) + Q]! + world.def.origin[1]).toBe(seamHeight);
  await page.mouse.move(viewport.x + 8, viewport.y + 8);
  await page.waitForTimeout(500);
  const sculptShot = await viewportShot(page);

  // Play: drawn, and the pawn stands on the per-tile collision.
  await page.goto(`/?debug&multiTile=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText(/movement: walking \(grounded\)/, { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  const text = (await stats.textContent()) ?? "";
  const match = text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  if (!match) throw new Error(`no pawn position in the overlay:\n${text}`);
  const [x, y, z] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ground = terrainHeightAt(world.def, lookup, x, z);
  console.log(`[terrain-multitile] pawn ${x} ${y} ${z}, terrain ${ground}`);
  expect(ground).not.toBeNull();
  expect(Math.abs(y - ground!)).toBeLessThan(0.2);
  const runtimeShot = await page.screenshot();

  expect(errors).toEqual([]);
  await page.goto("about:blank");
  const report: Record<string, number> = {};
  for (const [name, image] of [["editor", editorShot], ["editor-focused", focusedShot], ["editor-sculpt", sculptShot], ["runtime", runtimeShot]] as const) {
    await writeFile(testInfo.outputPath(`${name}.png`), image);
    await testInfo.attach(`${name}.png`, { body: image, contentType: "image/png" });
    report[name] = await coverage(page, image, name === "editor-focused" ? editorShot : image);
  }
  console.log(`[terrain-multitile] coverage ${JSON.stringify(report)}`);
  expect(report.editor).toBeGreaterThan(0.25);
  expect(report["editor-focused"]).toBeGreaterThan(0.25);
});

test("World Terrain foliage tools paint across a seam, save exact surface heights, reload and load in Play", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await writeFixture();
  const typeId = "__playwright-world-foliage";
  const typePath = `assets/${typeId}.foliagetype.json`;
  const manifestPath = smokePublicPath("assets/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const mesh = manifest.assets.find((asset: { id: string }) => asset.id === "shape-cube");
  if (!mesh) throw new Error("smoke manifest has no shape-cube");
  manifest.assets.push({ ...mesh, id: typeId, name: "World Foliage", assetType: "foliageType", path: typePath, placeable: false });
  await writeFile(manifestPath, JSON.stringify(manifest));
  const foliageType = normalizeFoliageType({
    name: "World Foliage", meshAssetId: mesh.id, radius: 0.25,
    scaleMin: [0.5, 0.5, 0.5], scaleMax: [0.5, 0.5, 0.5],
    zOffsetMin: 0, zOffsetMax: 0, alignToNormal: true, randomYaw: false,
  });
  await writeFile(smokePublicPath(typePath), JSON.stringify(foliageType));
  // Play grows this rule over the whole multi-tile surface (the type never culls, the
  // world is small) in the foliage worker (OPEN_WORLD_PLAN Faz 6 F3).
  const rule: LandscapeFoliageRule = { id: "world-rule", landscapeId: "world", layerId: "grass", foliageTypeId: typeId, density: 1, minWeight: 0, seed: 1 };
  // An empty referenced group makes the type available on the first editor load.
  await writeFile(smokePublicPath(foliageDataPath(LEVEL)), JSON.stringify({
    schema: 1, type: "foliage",
    groups: [{ id: "painted-world", foliageTypeId: typeId, target: { kind: "landscape", id: "world" }, instances: [] }],
    landscapeRules: [rule],
  }));
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.addInitScript(({ key, pose }) => {
    localStorage.clear();
    localStorage.setItem(key, pose);
    // A fixed profile (grassDensity 0.8): headless hardware hints would pick one at random.
    localStorage.setItem("forge.userSettings", JSON.stringify({
      schema: 1,
      updatedAt: new Date().toISOString(),
      payload: { graphics: { selectedQualityLevel: "high", manuallySelected: true, adaptiveOptimizationEnabled: false } },
    }));
    // three's devtools hook hands the live scenes over without test globals in the app.
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __ringScenes: unknown[] };
    w.__ringScenes = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const object = (event as CustomEvent).detail as { isScene?: boolean } | null;
      if (object?.isScene) w.__ringScenes.push(object);
    });
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`, pose: JSON.stringify(SEAM_POSE) });

  const bootEditor = async () => {
    await page.goto(`/?editor&foliage=${Date.now()}`);
    await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("outliner-row").filter({ hasText: "World Terrain" }).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await page.locator('[data-inspector-tab="foliage"]').click();
    await expect(page.locator(".foliage-type-name")).toHaveText("World Foliage");
  };
  await bootEditor();
  // The ring (worker) equals the pure generator run here over every planned cell.
  const surface = worldTerrainFoliageSurface(world.def, lookup);
  const bounds = { minX: -80, maxX: -80 + 3 * Q, minZ: -50, maxZ: -50 + 2 * Q };
  const expectedRing = (density: number) => {
    const cells = planFoliageRing({ center: SPAWN, radius: Infinity, density, bounds, built: new Map() }).build;
    expect(cells.length).toBe(35);
    return cells.reduce((sum, cell) => sum + generateFoliageCell(rule, foliageType, surface, {
      cellX: cell.cellX, cellZ: cell.cellZ, cellSize: 32, keepFraction: cell.keepFraction,
    }).count, 0);
  };
  const ringCount = () => page.evaluate(() => {
    let total = 0;
    for (const scene of (window as unknown as { __ringScenes: any[] }).__ringScenes) {
      scene.traverse((node: any) => {
        if (node.isInstancedMesh && node.parent?.name?.startsWith("foliage-grass:world-rule:")) total += node.count;
      });
    }
    return total;
  });
  // The editor grows the same rule around its camera at full density.
  expect(expectedRing(1)).toBeGreaterThan(expectedRing(0.8));
  await expect.poll(ringCount, { timeout: 30_000 }).toBe(expectedRing(1));
  await expect(page.locator('[data-landscape-rule="world-rule"] [data-rule-notes]')).toContainText("never culls");
  const count = page.locator(".foliage-type-count");
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  const centre = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  const setNumber = async (selector: string, value: number) => {
    await page.locator(selector).fill(String(value));
    await page.locator(selector).press("Enter");
  };
  const tool = (name: string) => page.locator(`[data-foliage-tool="${name}"]`).click();
  const save = async (): Promise<LayoutFoliageData> => {
    const response = page.waitForResponse((res) => res.url().endsWith("/__save-layout") && res.request().method() === "POST");
    const sidecar = page.waitForResponse((res) => res.url().endsWith("/__save-foliage") && res.request().method() === "POST");
    await page.getByTestId("editor-save").click();
    expect((await response).ok()).toBeTruthy();
    expect((await sidecar).ok()).toBeTruthy();
    await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 20_000 });
    return JSON.parse(await readFile(smokePublicPath(foliageDataPath(LEVEL)), "utf8"));
  };

  // Single, Select and Erase use the same World Terrain surface as Paint.
  await tool("single");
  await page.mouse.click(centre.x, centre.y);
  await expect(count).toHaveText("1");
  const single = (await save()).groups[0]!.instances[0]!;
  const camera = new PerspectiveCamera(44, viewport.width / viewport.height);
  camera.position.fromArray(SEAM_POSE.position);
  camera.quaternion.fromArray(SEAM_POSE.quaternion);
  camera.updateMatrixWorld(true);
  const projected = new Vector3(single.position[0], single.position[1] + 0.25, single.position[2]).project(camera);
  await tool("select");
  await page.mouse.click(viewport.x + (projected.x + 1) * viewport.width / 2, viewport.y + (1 - projected.y) * viewport.height / 2);
  await expect(page.locator("[data-foliage-deselect]")).toBeEnabled();
  await page.locator("[data-foliage-deselect]").click();
  await setNumber("[data-foliage-brush-size]", 4);
  await tool("erase");
  await page.mouse.click(centre.x, centre.y);
  await expect(count).toHaveText("0");

  // A Paint dab straddles the seam; disabled Landscape filtering must reject it.
  await tool("paint");
  await page.locator('[data-foliage-filter="landscape"]').uncheck();
  await page.mouse.click(centre.x, centre.y);
  await expect(count).toHaveText("0");
  await page.locator('[data-foliage-filter="landscape"]').check();
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(async () => Number(await count.textContent())).toBeGreaterThan(3);
  const painted = await save();
  const instances = painted.groups.flatMap((group) => group.instances);
  expect(instances.some(({ position }) => position[0] < SEAM[0])).toBeTruthy();
  expect(instances.some(({ position }) => position[0] > SEAM[0])).toBeTruthy();
  const checkSurface = (data: LayoutFoliageData) => {
    expect(data.groups.length).toBeGreaterThan(0);
    for (const group of data.groups) {
      expect(group.target).toEqual({ kind: "landscape", id: "world" });
      for (const instance of group.instances) {
        const [x, y, z] = instance.position;
        const ground = terrainHeightAt(world.def, lookup, x, z);
        expect(ground, `no ground at ${x},${z}`).not.toBeNull();
        expect(Math.abs(y - ground!)).toBeLessThan(0.01);
        expect(new Vector3(...instance.normal!).distanceTo(new Vector3(...terrainFaceNormalAt(world.def, lookup, x, z)!))).toBeLessThan(1e-5);
      }
    }
  };
  checkSurface(painted);

  // Fill covers multiple tiles and the hole; only real terrain may receive instances.
  await setNumber("[data-foliage-paint-density]", 0.003);
  await tool("fill");
  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByTestId("editor-status")).toContainText("Filled");
  const filled = await save();
  checkSurface(filled);
  const filledCount = filled.groups.reduce((total, group) => total + group.instances.length, 0);
  expect(filledCount).toBeGreaterThan(instances.length);
  await bootEditor();
  await expect(count).toHaveText(String(filledCount));
  await page.mouse.move(viewport.x + 8, viewport.y + 8);
  await testInfo.attach("world-foliage.png", { body: await viewportShot(page), contentType: "image/png" });

  const loadedSidecar = page.waitForResponse((res) => res.url().includes(foliageDataPath(LEVEL)) && res.ok());
  await page.goto(`/?debug&foliagePlay=${Date.now()}`);
  expect((await loadedSidecar).ok()).toBeTruthy();
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  await expect(page.locator(".forge-loading")).toBeHidden({ timeout: 30_000 });
  // Boot builds the cells over resident tiles; the rest grow as the terrain streams in.
  expect(messages.some((message) => message.startsWith("[foliage-ring] ready: "))).toBe(true);
  // Play thins the ring by the profile's grassDensity (high: 0.8).
  await expect.poll(ringCount, { timeout: 30_000 }).toBe(expectedRing(0.8));
  expect(messages.some((message) => message.includes("Foliage worker failed"))).toBe(false);
  expect(errors).toEqual([]);
});
