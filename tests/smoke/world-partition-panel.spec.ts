import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera } from "three";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { worldCellBounds } from "../../engine/world/worldGrid";
import { worldMapFrame, worldToMapPixel } from "../../engine/world/worldMapView";
import { generateTestWorld, testWorldLevel } from "../../tools/world/testWorld";
import { expect, test, type Page } from "./test";
import { smokePublicPath } from "./smokeProject.mjs";

/**
 * World Partition panel (OPEN_WORLD_PLAN Faz 8): the left panel's second tab
 * maps a streaming World Terrain's tiles by editor residency, the occupied
 * partition cells and the camera; hovering names the tile and cell, and a
 * click moves the camera there, which streams that area in.
 */
const LEVEL = "layouts/__playwright-world-partition.level.json";
const TERRAIN = "landscapes/__playwright-world-partition.terrain.json";
// 12x12 tiles of 32 quads at 2 m: 64 m tiles, 768 m across, centred on the origin.
const world = generateTestWorld({ tiles: 12, tileQuads: 32, spacing: 2 });
const CELL = 128;
const NEAR: [number, number] = [16, 116];
const FAR: [number, number] = [-352, -352];
const POINTS: [number, number][] = [[100, 100], [110, 120], [-300, -300]];

function cameraPose(x: number, z: number) {
  const y = world.heightAt(x, z)!;
  const camera = new PerspectiveCamera();
  camera.position.set(x - 18, y + 14, z + 18);
  camera.lookAt(x, y, z);
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] };
}

async function writeWorld(): Promise<void> {
  const write = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true });
    await writeFile(smokePublicPath(path), data);
  };
  for (const [key, bytes] of world.tileBytes) await write(terrainTilePath(TERRAIN, key), bytes);
  await write(terrainGlobalMapPath(TERRAIN), world.globalBytes);
  await write(TERRAIN, JSON.stringify(world.def, null, 2));
  const level = testWorldLevel(world, TERRAIN, "__playwright-world-partition") as Record<string, any>;
  level.worldSettings.partition = { enabled: true, grids: { main: { cellSize: CELL, loadRange: 384 } } };
  level.targetPoints = POINTS.map(([x, z], index) => ({ id: `tp-${index}`, name: `Point ${index}`, position: [x, world.heightAt(x, z)! + 1, z] }));
  await write(LEVEL, JSON.stringify(level, null, 2));
}

/** CSS position on the map canvas of world (x, z), with the frame the panel computes. */
async function mapPoint(page: Page, x: number, z: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator("[data-wp-map]").boundingBox())!;
  const half = (world.def.tilesX * world.def.tileQuads * world.def.spacing) / 2;
  const frame = worldMapFrame([
    { minX: -half, minZ: -half, maxX: half, maxZ: half },
    ...[[0, 0], [-3, -3]].map(([cx, cz]) => worldCellBounds({ cellSize: CELL }, cx!, cz!)),
  ]);
  const [px, py] = worldToMapPixel(frame, box.width, x, z);
  return { x: box.x + px, y: box.y + py };
}

async function hoverText(page: Page, x: number, z: number): Promise<string> {
  const point = await mapPoint(page, x, z);
  await page.mouse.move(point.x, point.y);
  return (await page.locator("[data-wp-hover]").textContent()) ?? "";
}

test("World Partition tab maps tile residency, partition cells and the camera, and a click streams that area in", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await writeWorld();
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(({ key, pose }) => {
    localStorage.clear();
    localStorage.setItem(key, pose);
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(LEVEL)}`, pose: JSON.stringify(cameraPose(0, 100)) });
  await page.goto(`/?editor&worldPartition=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("outliner-row").filter({ hasText: "World Terrain" }).first()).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("world-partition-tab").click();
  await expect(page.locator("#world-partition-pane")).toBeVisible();
  await expect(page.locator("#scene-outliner-pane")).toBeHidden();
  const tiles = page.locator("[data-wp-tiles]");
  await expect(tiles).toContainText("/144 loaded");
  await expect(page.locator("[data-world-partition]")).toContainText("streams around the camera");
  await expect(page.locator("[data-wp-cells]")).toContainText(`World Partition on · ${CELL} m cells, 384 m range · 2 occupied cells, 3 streamed elements`);

  // Near the camera the tile is loaded; the far corner is not.
  await expect.poll(() => hoverText(page, ...NEAR), { timeout: 30_000 }).toContain("Tile 6_7 · loaded");
  expect(await hoverText(page, ...NEAR)).toContain("Cell 0_0 · 2 elements");
  const far = await hoverText(page, ...FAR);
  expect(far).toContain("Tile 0_0 · not loaded");
  expect(far).toContain("Cell -3_-3 · 1 element");
  // The drawn map agrees: the unloaded corner is dimmed against the loaded area.
  const luma = async (x: number, z: number) => page.evaluate(([px, py]) => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-wp-map]")!;
    const box = canvas.getBoundingClientRect();
    const [r, g, b] = canvas.getContext("2d")!.getImageData(
      Math.round(((px! - box.left) / box.width) * canvas.width), Math.round(((py! - box.top) / box.height) * canvas.height), 1, 1).data;
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }, Object.values(await mapPoint(page, x, z)));
  const [nearLuma, farLuma] = [await luma(40, 80), await luma(-330, -370)];
  console.log(`[world-partition] map luma near ${nearLuma.toFixed(1)} far ${farLuma.toFixed(1)}`);
  expect(nearLuma).toBeGreaterThan(farLuma + 20);
  await page.locator("[data-world-partition]").screenshot({ path: testInfo.outputPath("world-partition-panel.png") });

  // A click moves the camera there and the editor streams that corner in.
  const target = await mapPoint(page, ...FAR);
  await page.mouse.click(target.x, target.y);
  await expect.poll(() => hoverText(page, ...FAR), { timeout: 30_000 }).toContain("Tile 0_0 · loaded");
  await expect.poll(() => hoverText(page, ...NEAR), { timeout: 30_000 }).toContain("Tile 6_7 · not loaded");
  await page.locator("[data-world-partition]").screenshot({ path: testInfo.outputPath("world-partition-panel-far.png") });

  await page.locator('[data-outliner-tab="scene"]').click();
  await expect(page.locator("#scene-outliner-pane")).toBeVisible();
  await expect(page.locator("#world-partition-pane")).toBeHidden();
  expect(errors).toEqual([]);
});
