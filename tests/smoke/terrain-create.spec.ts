import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { levelTerrainPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { openWorldFogPatch } from "../../engine/world/openWorldSetup";
import { expect, test, type Page } from "./test";
import { SMOKE_SPLINE_SCENE, smokePublicPath } from "./smokeProject.mjs";

/**
 * Add Actor → Landscape (OPEN_WORLD_PLAN Faz 2): the dialog defaults to one
 * tile, flags the single-tile-only spline/river tools once more tiles are
 * picked, creates a flat 2×2 grid, and Save writes its u16 tiles and
 * definition into the level's terrain folder before the level. Undo + Save
 * prunes the files, Redo writes them again, a reload shows the terrain, and the
 * pawn stands on it in Play.
 */

const LEVEL = "layouts/__playwright-terrain-create.level.json";
const OPEN_WORLD_LEVEL = "layouts/__playwright-open-world-create.level.json";
const BASE_HEIGHT = 2;

async function exists(path: string): Promise<boolean> {
  return access(smokePublicPath(path)).then(() => true, () => false);
}

async function writeLevel(path = LEVEL): Promise<void> {
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = path === LEVEL ? "__playwright-terrain-create" : "__playwright-open-world-create";
  level.instances = level.instances.filter((group: { assetId: string }) => group.assetId === "marker:playerStart");
  const start = level.instances[0];
  if (!start) throw new Error("smoke spline level has no Player Start");
  start.placements = [{ ...start.placements[0], position: [6, BASE_HEIGHT + 3, -4] }];
  level.landscapes = [];
  level.riverWaters = [];
  // The open world flow starts from a level with no partition, view distance or fog.
  delete level.heightFog;
  if (level.worldSettings) {
    delete level.worldSettings.partition;
    delete level.worldSettings.viewDistance;
  }
  await mkdir(dirname(smokePublicPath(path)), { recursive: true });
  await writeFile(smokePublicPath(path), JSON.stringify(level, null, 2));
}

function saved(page: Page, path: "/__save-terrain" | "/__save-layout") {
  return page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === "POST", { timeout: 30_000 });
}

test("Add Actor → Landscape creates a flat multi-tile terrain that saves, undoes, reloads and collides", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const messages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    messages.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  await writeLevel();
  expect((await request.post("/__open-level", { data: { path: LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`/?editor&create=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
  const dialog = page.locator("[data-world-terrain-dialog]");
  await expect(dialog).toBeVisible();
  const create = dialog.locator("[data-world-terrain-create]");
  await expect(dialog.locator('[data-field="tilesX"]')).toHaveValue("1");
  await expect(dialog.locator('[data-field="tilesZ"]')).toHaveValue("1");
  await expect(dialog.locator("[data-world-terrain-multitile]")).toBeHidden();
  await expect(create).toBeEnabled();
  await dialog.locator('[data-field="tilesX"]').fill("0");
  await expect(create).toBeDisabled();
  await dialog.locator('[data-field="tilesX"]').fill("2");
  await dialog.locator('[data-field="tilesZ"]').fill("2");
  await dialog.locator('[data-field="tileQuads"]').selectOption("64");
  await dialog.locator('[data-field="spacing"]').fill("1");
  await dialog.locator('[data-field="baseHeight"]').fill(String(BASE_HEIGHT));
  await expect(dialog.locator("[data-world-terrain-summary]")).toContainText("128 m × 128 m · 4 tiles of 64 m");
  await expect(dialog.locator("[data-world-terrain-multitile]")).toBeVisible();
  await expect(create).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("dialog.png") });

  // Save order: tiles, definition, then the level that names them.
  let terrainSave = saved(page, "/__save-terrain");
  let layoutSave = saved(page, "/__save-layout");
  await create.click();
  await expect(dialog).toHaveCount(0);
  expect((await terrainSave).ok()).toBeTruthy();
  expect((await layoutSave).ok()).toBeTruthy();
  const row = page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first();
  await expect(row).toBeVisible();
  await expect(page.locator("[data-world-terrain]")).toContainText("2 × 2");
  await expect(page.locator("[data-world-terrain]")).toContainText("128 m × 128 m");

  const level = JSON.parse(await readFile(smokePublicPath(LEVEL), "utf8"));
  expect(level.landscapes).toHaveLength(1);
  const [actor] = level.landscapes;
  const definitionPath = levelTerrainPath(LEVEL, actor.id);
  expect(actor.dataRef).toBe(definitionPath);
  expect(actor.position).toEqual([0, BASE_HEIGHT, 0]);
  const definition = normalizeWorldTerrain(JSON.parse(await readFile(smokePublicPath(definitionPath), "utf8")));
  expect([definition.tilesX, definition.tilesZ, definition.tileQuads, definition.origin]).toEqual([2, 2, 64, [-64, BASE_HEIGHT, -64]]);
  for (const { key } of definition.tiles) {
    const tile = decodeTerrainTile(await readFile(smokePublicPath(terrainTilePath(definitionPath, key))));
    expect(tile.heightFormat, key).toBe("u16");
    expect(tile.heights.every((height) => Math.abs(height) < 0.01), key).toBe(true);
  }

  // Undo + autosave prunes the now unreferenced level terrain; Redo writes it again.
  layoutSave = saved(page, "/__save-layout");
  await page.getByTestId("editor-undo").click();
  expect((await layoutSave).ok()).toBeTruthy();
  await expect(row).toHaveCount(0);
  await expect.poll(() => exists(definitionPath)).toBe(false);
  terrainSave = saved(page, "/__save-terrain");
  layoutSave = saved(page, "/__save-layout");
  await page.getByTestId("editor-redo").click();
  expect((await terrainSave).ok()).toBeTruthy();
  expect((await layoutSave).ok()).toBeTruthy();
  expect(await exists(definitionPath)).toBe(true);
  expect(await exists(terrainTilePath(definitionPath, "1_1"))).toBe(true);

  // A reload reads it back as a multi-tile World Terrain.
  await page.goto(`/?editor&create=${Date.now()}`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await expect(page.locator("[data-world-terrain]")).toContainText("2 × 2");

  // Play: the pawn lands on the flat terrain at the base height.
  await page.goto(`/?debug&create=${Date.now()}`);
  await expect.poll(() => messages.some((message) => message.includes("[runtime] scene loaded")), { timeout: 60_000 }).toBeTruthy();
  const stats = page.locator("#debug-stats");
  await expect(stats).toContainText(/movement: walking \(grounded\)/, { timeout: 30_000 });
  const text = (await stats.textContent()) ?? "";
  const y = Number(text.match(/pos: (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/)?.[2]);
  console.log(`[terrain-create] pawn y ${y}`);
  expect(Math.abs(y - BASE_HEIGHT)).toBeLessThan(0.2);
  expect(errors).toEqual([]);
});

/**
 * New Open World (OPEN_WORLD_PLAN Faz 8): the dialog's Open World section sets
 * World Partition, view distance and a fitted Height Fog for any grid, and the
 * u16 height range for a multi-tile one, all created with the terrain as one
 * undo step.
 */
test("New Landscape's Open World section sets partition, view distance, fog and height range in one undo step", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await writeLevel(OPEN_WORLD_LEVEL);
  expect((await request.post("/__open-level", { data: { path: OPEN_WORLD_LEVEL } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?editor&openWorld=${Date.now()}`);
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
  const dialog = page.locator("[data-world-terrain-dialog]");
  const section = dialog.locator("[data-open-world]");
  const notes = dialog.locator("[data-open-world-notes]");
  const create = dialog.locator("[data-world-terrain-create]");
  // A 1x1 Landscape is an open world too; only the u16 height range is multi-tile.
  await expect(section).toBeVisible();
  await expect(section.locator('[data-world="partition"]')).toBeVisible();
  await expect(section.locator('[data-field="heightMin"]')).toBeHidden();
  await expect(notes).not.toContainText("cm steps");
  await dialog.locator('[data-field="tilesX"]').fill("4");
  await dialog.locator('[data-field="tilesZ"]').fill("2");
  await dialog.locator('[data-field="tileQuads"]').selectOption("64");
  await dialog.locator('[data-field="spacing"]').fill("2");
  await expect(section.locator('[data-field="heightMin"]')).toBeVisible();
  // Seeded from the level: nothing switched on.
  await expect(section.locator('[data-world="partition"]')).not.toBeChecked();
  await expect(section.locator('[data-world="cellSize"]')).toBeDisabled();
  await expect(section.locator('[data-world="viewDistance"]')).toHaveValue("");
  await section.locator('[data-field="heightMin"]').fill("-20");
  await section.locator('[data-field="heightMax"]').fill("300");
  await expect(notes).toContainText("0.5 cm steps");

  // 512 m × 256 m world: the suggestion sees across it and stays under far view mode.
  await section.locator("[data-open-world-suggest]").click();
  await expect(section.locator('[data-world="viewDistance"]')).toHaveValue("600");
  await expect(section.locator('[data-world="partition"]')).toBeChecked();
  await expect(section.locator('[data-world="fitFog"]')).not.toBeChecked();
  await section.locator('[data-world="cellSize"]').fill("64");
  await expect(notes).toContainText("About 32 actor cells");
  await section.locator('[data-world="viewDistance"]').fill("10");
  await expect(create).toBeDisabled();
  await section.locator('[data-world="viewDistance"]').fill("1500");
  await expect(notes).toContainText("hard edge");
  await section.locator('[data-world="fitFog"]').check();
  await expect(notes).not.toContainText("hard edge");
  await expect(create).toBeEnabled();
  await dialog.screenshot({ path: testInfo.outputPath("open-world-dialog.png") });

  const layoutSave = saved(page, "/__save-layout");
  await create.click();
  await expect(dialog).toHaveCount(0);
  expect((await layoutSave).ok()).toBeTruthy();
  const row = page.getByTestId("outliner-row").filter({ hasText: "Landscape" }).first();
  await expect(row).toBeVisible();

  const level = async () => JSON.parse(await readFile(smokePublicPath(OPEN_WORLD_LEVEL), "utf8"));
  // Autosave may be mid-write while polling: a partial file reads as "not yet".
  const settled = async <T>(read: (current: any) => T): Promise<T | "writing"> => {
    try {
      return read(await level());
    } catch {
      return "writing";
    }
  };
  const created = await level();
  expect(created.worldSettings.partition.enabled).toBe(true);
  expect(created.worldSettings.partition.grids.main).toEqual({ cellSize: 64, loadRange: 384 });
  expect(created.worldSettings.viewDistance).toBe(1500);
  expect(created.heightFog).toMatchObject(openWorldFogPatch(1500));
  const definition = normalizeWorldTerrain(JSON.parse(await readFile(smokePublicPath(levelTerrainPath(OPEN_WORLD_LEVEL, created.landscapes[0].id)), "utf8")));
  expect([definition.tilesX, definition.tilesZ, definition.heightMin, definition.heightMax]).toEqual([4, 2, -20, 300]);

  // One undo takes the terrain, the world settings and the fog back together.
  await page.getByTestId("editor-undo").click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => settled((current) => [
    current.landscapes?.length ?? 0, current.worldSettings?.partition ?? null, current.worldSettings?.viewDistance ?? null, current.heightFog ?? null,
  ]), { timeout: 30_000 }).toEqual([0, null, null, null]);
  await page.getByTestId("editor-redo").click();
  await expect(row).toBeVisible();
  await expect.poll(() => settled((current) => [
    current.landscapes?.length ?? 0, current.worldSettings?.viewDistance ?? null, current.heightFog?.mode ?? null,
  ]), { timeout: 30_000 }).toEqual([1, 1500, "exp"]);
  expect(errors).toEqual([]);
});
