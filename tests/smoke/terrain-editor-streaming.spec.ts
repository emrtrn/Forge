import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera } from "three";
import { decodeTerrainGlobalMap, encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainGlobalMapPath, terrainTilePath, tileKey, type TerrainTileData } from "../../engine/terrain/terrainTypes";
import { generateTestWorld, testWorldLevel } from "../../tools/world/testWorld";
import { expect, test } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

/**
 * Editor streaming (OPEN_WORLD_PLAN Faz 8): a World Terrain over 6x6 tiles
 * loads only the tiles around the editor camera, a stroke on a seam saves
 * just the two touched tiles plus a global map identical to one rebuilt from
 * every tile on disk, and a camera elsewhere loads that area instead.
 */
const LEVEL = "layouts/__playwright-editor-streaming.level.json";
const TERRAIN = "landscapes/__playwright-editor-streaming.terrain.json";
// 12x12 tiles of 32 quads at 2 m: 64 m tiles, 768 m across, centred on the origin.
const world = generateTestWorld({ tiles: 12, tileQuads: 32, spacing: 2 });
const TOTAL = world.def.tiles.length;
/** On the X seam between tiles 5 and 6 (world x = 0), inside row 7. */
const SEAM: [number, number] = [0, 100];
const SEAM_TILES = [tileKey(5, 7), tileKey(6, 7)];

function cameraPose(x: number, z: number) {
  const y = world.heightAt(x, z)!;
  const camera = new PerspectiveCamera();
  camera.position.set(x - 18, y + 14, z + 18);
  camera.lookAt(x, y, z);
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] };
}

async function writeWorld() {
  const write = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true });
    await writeFile(smokePublicPath(path), data);
  };
  for (const [key, bytes] of world.tileBytes) await write(terrainTilePath(TERRAIN, key), bytes);
  await write(terrainGlobalMapPath(TERRAIN), world.globalBytes);
  await write(TERRAIN, JSON.stringify(world.def, null, 2));
  await write(LEVEL, JSON.stringify(testWorldLevel(world, TERRAIN, "__playwright-editor-streaming"), null, 2));
}

const diskBytes = (path: string) => readFile(smokePublicPath(path));

test("editor streams a large World Terrain around the camera and a seam stroke saves only its tiles and an exact global map", async ({ page, request }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const requested = new Set<string>();
  const written: string[] = [];
  page.on("request", (req) => {
    const tile = req.url().match(/__playwright-editor-streaming\.tiles\/(\d+_\d+)\.tile\.bin/);
    if (tile && req.method() === "GET") requested.add(tile[1]!);
    const save = req.url().match(/__save-terrain-tile\?.*key=(\d+_\d+)/);
    if (save) written.push(save[1]!);
  });
  await writeWorld();
  const before = new Map<string, Buffer>();
  for (const { key } of world.def.tiles) before.set(key, await diskBytes(terrainTilePath(TERRAIN, key)));
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.addInitScript(({ key, seam, far }) => {
    localStorage.clear();
    localStorage.setItem(key, location.search.includes("far=") ? far : seam);
  }, {
    key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`,
    seam: JSON.stringify(cameraPose(...SEAM)), far: JSON.stringify(cameraPose(-330, -330)),
  });

  const row = page.getByTestId("outliner-row").filter({ hasText: "World Terrain" }).first();
  await page.goto(`/?editor&seam=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => SEAM_TILES.every((key) => requested.has(key)), { timeout: 30_000 }).toBe(true);
  await page.waitForLoadState("networkidle");
  const nearSet = new Set(requested);
  console.log(`[editor-streaming] seam camera read ${nearSet.size} of ${TOTAL} tiles`);
  expect(nearSet.size).toBeLessThanOrEqual(64);
  expect(nearSet.has(tileKey(0, 0))).toBe(false);

  // Raise on the seam at the viewport centre; autosave writes the terrain.
  await row.click();
  await page.locator('[data-world-terrain-tools] [data-landscape-mode="sculpt"]').click();
  await page.locator('[data-world-terrain-tools] [data-landscape-tool="raise"]').click();
  await page.locator('[data-landscape-number="brushSize"]').fill("6");
  await page.locator('[data-landscape-number="brushSize"]').press("Enter");
  await page.locator('[data-landscape-number="strength"]').fill("0.5");
  await page.locator('[data-landscape-number="strength"]').press("Enter");
  const viewport = (await page.locator("[data-viewport-host]").boundingBox())!;
  const centre = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  const saved = page.waitForResponse((response) => response.url().endsWith("/__save-terrain") && response.request().method() === "POST", { timeout: 30_000 });
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 3, centre.y + 1, { steps: 3 });
  await page.mouse.up();
  expect((await saved).ok()).toBeTruthy();
  expect([...new Set(written)].sort()).toEqual(SEAM_TILES);
  const disk = new Map<string, TerrainTileData>();
  for (const { key } of world.def.tiles) {
    const bytes = await diskBytes(terrainTilePath(TERRAIN, key));
    expect(bytes.equals(before.get(key)!), `${key} ${SEAM_TILES.includes(key) ? "edited" : "untouched"}`).toBe(!SEAM_TILES.includes(key));
    disk.set(key, decodeTerrainTile(bytes));
  }
  const [left, right] = SEAM_TILES.map((key) => disk.get(key)!);
  const size = world.def.tileQuads + 1;
  for (let z = 0; z < size; z += 1) expect(left!.heights[z * size + size - 1], `seam row ${z}`).toBe(right!.heights[z * size]);
  const row7 = (SEAM[1] - world.def.origin[2]) / world.def.spacing - 7 * world.def.tileQuads;
  expect(left!.heights[row7 * size + size - 1]!).toBeGreaterThan(world.heightAt(...SEAM)! + 0.05);
  // The live global map the editor saved matches one rebuilt from every tile
  // on disk. Only the stroke's samples may differ, and only by the u16 tile
  // quantization: the editor samples the unquantized heights it holds.
  const savedMap = decodeTerrainGlobalMap(await diskBytes(terrainGlobalMapPath(TERRAIN))).map;
  const rebuilt = decodeTerrainGlobalMap(encodeTerrainGlobalMap(world.def,
    buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, disk)))).map;
  const halfStep = (world.def.heightMax - world.def.heightMin) / 65535 / 2 + 1e-6;
  let differing = 0;
  let worst = 0;
  for (let index = 0; index < savedMap.heights.length; index += 1) {
    const delta = Math.abs(savedMap.heights[index]! - rebuilt.heights[index]!);
    if (delta > 0) differing += 1;
    worst = Math.max(worst, delta);
  }
  expect(worst).toBeLessThanOrEqual(halfStep);
  console.log(`[editor-streaming] ${differing} of ${savedMap.heights.length} global samples differ by u16 quantization only`);
  expect(differing).toBeLessThan(50);

  // Reopened at the far corner: that area streams in, the seam area does not.
  requested.clear();
  await page.goto(`/?editor&far=${Date.now()}`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => requested.has(tileKey(0, 0)), { timeout: 30_000 }).toBe(true);
  await page.waitForLoadState("networkidle");
  console.log(`[editor-streaming] far camera read ${requested.size} tiles`);
  expect(requested.size).toBeLessThanOrEqual(64);
  for (const key of SEAM_TILES) expect(requested.has(key)).toBe(false);
  expect(errors).toEqual([]);
});
