import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PerspectiveCamera } from "three";
import { createFlatWorldTerrain } from "../../engine/terrain/worldTerrainCreate";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { levelTerrainPath, terrainGlobalMapPath, terrainTileHeightRange, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { SMOKE_SCENE, smokePublicPath } from "./smokeProject.mjs";
import { expect, test } from "./test";

test("Landscape Erosion: broad mountain before/after Thermal and Hydraulic", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const world = createFlatWorldTerrain({ name: "Erosion Hill", tilesX: 2, tilesZ: 2, tileQuads: 64, spacing: 1, baseHeight: 0 });
  for (const layer of world.def.layers) { delete layer.material; layer.color = "#a99576"; }
  const dataRef = levelTerrainPath(SMOKE_SCENE, "erosion-hill");
  const write = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(smokePublicPath(path)), { recursive: true });
    await writeFile(smokePublicPath(path), data);
  };
  for (const [key, tile] of world.tiles) {
    for (let z = 0; z < tile.size; z++) for (let x = 0; x < tile.size; x++) {
      const wx = world.def.origin[0] + tile.x * 64 + x, wz = world.def.origin[2] + tile.z * 64 + z;
      tile.heights[z * tile.size + x] = 20 * Math.exp(-(wx * wx / 289 + wz * wz / 441))
        + 2 * Math.exp(-((wx + 9) ** 2 + (wz + 3) ** 2) / 50) + 0.15 * Math.sin(wx * 0.3) * Math.cos(wz * 0.25);
    }
    const summary = world.def.tiles.find((entry) => entry.key === key)!;
    const range = terrainTileHeightRange(tile);
    summary.minHeight = range.min; summary.maxHeight = range.max;
    await write(terrainTilePath(dataRef, key), encodeTerrainTile(tile, { ...world.def, heightFormat: "f32" }));
  }
  await write(dataRef, JSON.stringify(world.def));
  await write(terrainGlobalMapPath(dataRef), encodeTerrainGlobalMap(world.def,
    buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles))));
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SCENE), "utf8"));
  for (const field of ["instances", "characters", "actors", "riverWaters"]) level[field] = [];
  level.landscapes = [{ id: "erosion-hill", name: "Erosion Hill", position: worldTerrainActorPosition(world.def), dataRef }];
  await write(SMOKE_SCENE, JSON.stringify(level));
  const camera = new PerspectiveCamera();
  camera.position.set(40, 50, 55);
  camera.lookAt(0, 9, 0);
  await page.addInitScript(({ key, pose }) => {
    localStorage.clear(); localStorage.setItem(key, pose);
  }, { key: `forge.editor.cameraPose.${encodeURIComponent(SMOKE_SCENE)}`,
    pose: JSON.stringify({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: [0, 1, 0] }) });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("outliner-row").filter({ hasText: "Erosion Hill" }).click();
  await page.locator('[data-landscape-tool="erosion"]').click();
  const number = async (key: string, value: string) => {
    const input = page.locator(`[data-landscape-number="${key}"]`);
    await input.fill(value); await input.press("Tab");
  };
  await number("brushSize", "32");
  await number("strength", "0.75");
  await number("falloff", "1");
  await number("erosionIterations", "48");
  await number("erosionTalus", "20");
  const box = await page.locator("#game-canvas").boundingBox();
  if (!box) throw new Error("Missing canvas");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.screenshot({ path: testInfo.outputPath("mountain-before.png") });
  await page.mouse.click(x, y);
  await expect(page.getByTestId("editor-undo")).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("mountain-thermal.png") });
  await page.getByTestId("editor-undo").click();
  await page.locator("[data-landscape-erosion-type]").selectOption("hydraulic");
  await number("erosionRainAmount", "1");
  await number("erosionSedimentCapacity", "4");
  await page.mouse.click(x, y);
  await expect(page.getByTestId("editor-redo")).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("mountain-hydraulic.png") });
  expect(errors).toEqual([]);
});
