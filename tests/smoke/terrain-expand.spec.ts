import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createFlatLandscapeData } from "../../engine/scene/landscape";
import { legacyLandscapeToWorldTerrain } from "../../engine/terrain/terrainLegacy";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { encodeTerrainTile, decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { levelTerrainPath, terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { expect, test, type Page } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

const LEVEL = "layouts/__playwright-terrain-expand.level.json";
const NAME = "Authored Expansion";

async function fixture(rotation = 0) {
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  const actor = { id: "expand-source", name: NAME, position: [12, 3, -9] as [number, number, number],
    rotation: [0, rotation, 0], dataRef: levelTerrainPath(LEVEL, "expand-source") };
  const data = createFlatLandscapeData("small");
  data.heights = data.heights.map((_, i) => Math.sin(i * 0.05) / 3);
  data.layers[0]!.weights.fill(0.1234);
  data.layers[1]!.weights.fill(0.8766);
  const { def, tile } = legacyLandscapeToWorldTerrain({ ...actor, rotation: [0, 0, 0] }, data);
  level.name = NAME;
  level.landscapes = [actor];
  level.riverWaters = [];
  const definitionPath = smokePublicPath(actor.dataRef);
  const tilePath = smokePublicPath(terrainTilePath(actor.dataRef, "0_0"));
  await mkdir(dirname(definitionPath), { recursive: true });
  await mkdir(dirname(tilePath), { recursive: true });
  await writeFile(definitionPath, JSON.stringify(def));
  await writeFile(tilePath, encodeTerrainTile(tile, { ...def, heightFormat: "f32" }));
  await writeFile(smokePublicPath(terrainGlobalMapPath(actor.dataRef)), encodeTerrainGlobalMap(def,
    buildTerrainGlobalAttributes(worldTerrainRenderSource(def, new Map([["0_0", tile]])))));
  await writeFile(smokePublicPath(LEVEL), JSON.stringify(level));
  return { actor, tile, data };
}

async function openDialog(page: Page) {
  await page.goto("/?editor&terrainExpand");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  const row = page.getByTestId("outliner-row").filter({ hasText: NAME }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await page.locator("[data-landscape-expand-world]").click();
  return page.locator("[data-world-terrain-expand-dialog]");
}

test("Landscape expansion validates the dialog, keeps the 1x1 Float32/RGBA8 samples, saves, undoes, redoes and reloads", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { actor, tile } = await fixture();
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 860 });
  const dialog = await openDialog(page);
  const expand = dialog.locator("[data-world-terrain-expand]");
  await dialog.locator('[data-field="tilesX"]').fill("1");
  await dialog.locator('[data-field="tilesZ"]').fill("1");
  await expect(expand).toBeDisabled();
  await expect(dialog.locator("[data-world-terrain-problems]")).toContainText("at least two tiles");
  await dialog.locator('[data-field="tilesX"]').fill("2");
  await dialog.locator('[data-field="originalX"]').fill("1");
  await expect(expand).toBeEnabled();
  await expect(dialog.locator("[data-world-terrain-summary]")).toContainText("128 m × 64 m");
  await page.screenshot({ path: testInfo.outputPath("expand-dialog.png") });
  await expand.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-world-terrain]")).toContainText("2 × 1");
  await page.getByTestId("editor-save").click();
  await expect.poll(async () => JSON.parse(await readFile(smokePublicPath(actor.dataRef), "utf8")).tilesX).toBe(2);
  const saved = decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(actor.dataRef, "1_0"))));
  expect(saved.heightFormat).toBe("f32");
  expect(Array.from(new Uint32Array(saved.heights.buffer))).toEqual(Array.from(new Uint32Array(tile.heights.buffer)));
  expect(Array.from(saved.weights)).toEqual(Array.from(tile.weights));
  const neighbor = decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(actor.dataRef, "0_0"))));
  expect(neighbor.heightFormat).toBe("f32");
  for (let z = 0; z < tile.size; z += 1) {
    const left = z * tile.size + tile.size - 1;
    const right = z * tile.size;
    expect(neighbor.heights[left]).toBe(saved.heights[right]);
    const blockBytes = tile.size * tile.size * 4;
    for (let block = 0; block < tile.weights.length; block += blockBytes) {
      expect(Array.from(neighbor.weights.subarray(block + left * 4, block + left * 4 + 4)))
        .toEqual(Array.from(saved.weights.subarray(block + right * 4, block + right * 4 + 4)));
    }
  }
  const definition = JSON.parse(await readFile(smokePublicPath(actor.dataRef), "utf8"));
  expect(definition.origin).toEqual([actor.position[0] - 96, actor.position[1], actor.position[2] - 32]);
  const level = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(level.landscapes[0].id).toBe(actor.id);
  expect(level.landscapes[0].dataRef).toBe(levelTerrainPath(LEVEL, actor.id));
  await page.getByTestId("editor-undo").click();
  await expect(page.locator("[data-landscape-expand-world]")).toBeVisible();
  await page.getByTestId("editor-redo").click();
  await expect(page.locator("[data-world-terrain]")).toContainText("2 × 1");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByTestId("outliner-row").filter({ hasText: NAME }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("outliner-row").filter({ hasText: NAME }).first().click();
  await expect(page.locator("[data-world-terrain]")).toContainText("2 × 1");
  expect(errors).toEqual([]);
});

test("rotated single-tile Landscape is an explicit migration error, never silently unrotated", async ({ page, request }) => {
  await fixture(15);
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.goto("/?editor&terrainExpandRotated");
  await expect(page.locator("[data-project-name]")).toHaveText("level failed to load", { timeout: 60_000 });
  await expect(page.locator("[data-status-toast]")).toContainText("terrain:migrate");
  await expect(page.locator("[data-status-toast]")).toContainText("rotated");
});
