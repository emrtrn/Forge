import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera } from "three";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import {
  createFlatTerrainTile,
  terrainTileHeightRange,
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
 * Faz 2) loads in the editor and in Play: it is drawn, picked, focused, kept
 * view-only with an explicit message, saved without touching its files, and
 * collides per tile so the pawn stands on it.
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

function cameraPose() {
  const camera = new PerspectiveCamera();
  camera.position.set(CENTRE[0] - 150, 110, CENTRE[2] + 150);
  camera.lookAt(CENTRE[0], CENTRE[1], CENTRE[2]);
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] };
}

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

test("multi-tile World Terrain loads view-only in the editor, saves untouched and collides per tile in Play", async ({ page, request }, testInfo) => {
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
  await page.addInitScript(({ key, pose }) => {
    localStorage.clear();
    localStorage.setItem(key, pose);
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`, pose: JSON.stringify(cameraPose()) });

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
  await expect(page.locator("[data-world-terrain-view-only]")).toContainText("Sculpt, Paint, Splines, Layers and Foliage");
  for (const input of await page.locator('input[data-detail="pr"]').all()) await expect(input).toBeDisabled();
  await page.keyboard.press("f");
  await expect(page.getByTestId("editor-status")).toContainText("Focused World Terrain");
  await page.waitForTimeout(1_000);
  const focusedShot = await viewportShot(page);

  // Clicking the selected terrain explains why nothing is sculpted.
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  await page.mouse.click(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await expect(page.getByTestId("editor-status")).toContainText("view-only");
  await expect(details).toBeVisible();
  // The move tool shows no gizmo and the transform stays where the definition puts it.
  await page.keyboard.press("w");
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width / 2 + 120, viewport.y + viewport.height / 2 + 40, { steps: 5 });
  await page.mouse.up();

  // Save keeps the reference and never rewrites the terrain files.
  const savedResponse = page.waitForResponse((response) => response.url().endsWith("/__save-layout") && response.request().method() === "POST");
  await page.getByTestId("editor-save").click();
  expect((await savedResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 20_000 });
  const level = await (await request.get(`/${LEVEL}?t=${Date.now()}`)).json();
  expect(level.landscapes).toEqual([{ id: "world", name: "World Terrain", position: CENTRE, dataRef: TERRAIN }]);
  for (const [path, bytes] of before) expect((await fileBytes(path)).equals(bytes), path).toBe(true);

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
  for (const [name, image] of [["editor", editorShot], ["editor-focused", focusedShot], ["runtime", runtimeShot]] as const) {
    await writeFile(testInfo.outputPath(`${name}.png`), image);
    await testInfo.attach(`${name}.png`, { body: image, contentType: "image/png" });
    report[name] = await coverage(page, image, name === "editor-focused" ? editorShot : image);
  }
  console.log(`[terrain-multitile] coverage ${JSON.stringify(report)}`);
  expect(report.editor).toBeGreaterThan(0.25);
  expect(report["editor-focused"]).toBeGreaterThan(0.25);
});
