import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { levelTerrainPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
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
const BASE_HEIGHT = 2;

async function exists(path: string): Promise<boolean> {
  return access(smokePublicPath(path)).then(() => true, () => false);
}

async function writeLevel(): Promise<void> {
  const level = JSON.parse(await readFile(smokePublicPath(SMOKE_SPLINE_SCENE), "utf8"));
  level.name = "__playwright-terrain-create";
  level.instances = level.instances.filter((group: { assetId: string }) => group.assetId === "marker:playerStart");
  const start = level.instances[0];
  if (!start) throw new Error("smoke spline level has no Player Start");
  start.placements = [{ ...start.placements[0], position: [6, BASE_HEIGHT + 3, -4] }];
  level.landscapes = [];
  level.riverWaters = [];
  await mkdir(dirname(smokePublicPath(LEVEL)), { recursive: true });
  await writeFile(smokePublicPath(LEVEL), JSON.stringify(level, null, 2));
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
