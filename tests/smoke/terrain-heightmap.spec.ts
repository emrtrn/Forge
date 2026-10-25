import { readFile } from "node:fs/promises";
import { decodeHeightmapPng, encodeHeightmapPng16 } from "../../engine/terrain/heightmapPng";
import { rawHeightmapToSamples } from "../../engine/terrain/terrainImport";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainTilePath, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { addLandscapeFromMenu, readSavedTerrain } from "./terrain";
import { expect, test, type Page } from "./test";
import { SMOKE_SCENE } from "./smokeProject.mjs";

/**
 * 16-bit heightmaps (OPEN_WORLD_FAZ2_EDITOR_PLAN steps 5–6): a PNG of exactly
 * the grid's size imports into a 1×1 and a multi-tile Landscape (0/65535 → the
 * Min/Max fields), a wrong size is rejected without touching the terrain, and
 * PNG/RAW export carry the same codes back with the range the status line
 * reports. The browser's CompressionStream does the zlib work here.
 */

test.setTimeout(300_000);

const MIN = -2;
const MAX = 10;

function codes(width: number, height: number): Uint16Array {
  return Uint16Array.from({ length: width * height }, (_, i) => {
    const x = i % width, z = Math.floor(i / width);
    return Math.round((0.5 + 0.3 * Math.sin(x * 0.11) * Math.cos(z * 0.07) + 0.15 * (x / width)) * 65535);
  });
}

const metres = (code: number) => MIN + (code / 65535) * (MAX - MIN);

async function status(page: Page): Promise<string> {
  return (await page.getByTestId("editor-status").textContent()) ?? "";
}

async function importFile(page: Page, format: "png" | "raw", name: string, buffer: Buffer): Promise<void> {
  await page.locator("[data-heightmap-min]").fill(String(MIN));
  await page.locator("[data-heightmap-max]").fill(String(MAX));
  await page.locator(`[data-heightmap-import="${format}"]`).setInputFiles({ name, mimeType: format === "png" ? "image/png" : "application/octet-stream", buffer });
}

/** Downloads one export and returns its codes and the re-import range from the status line. */
async function exportCodes(page: Page, format: "png" | "raw"): Promise<{ samples: Uint16Array; min: number; max: number; width?: number }> {
  // Let a pending autosave (500 ms after the last command) report first, so it cannot overwrite the range.
  await page.waitForTimeout(800);
  const download = page.waitForEvent("download");
  await page.locator(`[data-heightmap-export="${format}"]`).click();
  const bytes = new Uint8Array(await readFile((await (await download).path())!));
  await expect(page.getByTestId("editor-status")).toContainText("Re-import range");
  const match = (await status(page)).match(/Re-import range: (-?[\d.]+) to (-?[\d.]+) m/);
  if (!match) throw new Error(`no range in status: ${await status(page)}`);
  if (format === "raw") return { samples: rawHeightmapToSamples(bytes), min: Number(match[1]), max: Number(match[2]) };
  const png = await decodeHeightmapPng(bytes);
  expect(png.bitDepth).toBe(16);
  return { samples: png.samples, min: Number(match[1]), max: Number(match[2]), width: png.width };
}

/** Exported heights agree with the imported ones within half an export step (plus float rounding). */
function expectSameHeights(exported: { samples: Uint16Array; min: number; max: number }, expected: Uint16Array): void {
  const step = (exported.max - exported.min) / 65535;
  let worst = 0;
  exported.samples.forEach((code, i) => {
    worst = Math.max(worst, Math.abs(exported.min + code * step - metres(expected[i]!)));
  });
  console.log(`[terrain-heightmap] export worst error ${worst} m (step ${step})`);
  expect(worst).toBeLessThan(step / 2 + 1e-3);
}

test("16-bit PNG/RAW heightmaps import and export on 1x1 and multi-tile Landscapes", async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto("/?editor");
  await expect(page.getByTestId("forge-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outliner-row").first()).toBeVisible({ timeout: 30_000 });
  const landscapeRows = page.getByTestId("outliner-row").filter({ hasText: "Landscape" });
  if ((await landscapeRows.count()) > 0) {
    await landscapeRows.first().click();
    await page.keyboard.press("Delete");
    await expect(landscapeRows).toHaveCount(0);
  }

  // 1×1: 129 × 129 vertices.
  await addLandscapeFromMenu(page);
  await landscapeRows.first().click();
  await expect(page.locator("[data-landscape-heightmap]")).toContainText("exactly 129 × 129 samples");
  const single = codes(129, 129);
  await importFile(page, "png", "wrong.png", Buffer.from(await encodeHeightmapPng16(65, 65, codes(65, 65))));
  await expect(page.getByTestId("editor-status")).toContainText("needs exactly 129 x 129 pixels");
  await importFile(page, "png", "single.png", Buffer.from(await encodeHeightmapPng16(129, 129, single)));
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Import Landscape Heightmap");
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });
  const saved = await readSavedTerrain(page);
  const worstImport = saved.heights.reduce((worst, height, i) => Math.max(worst, Math.abs(height - metres(single[i]!))), 0);
  console.log(`[terrain-heightmap] 1x1 import worst error ${worstImport} m`);
  expect(worstImport).toBeLessThan(1e-5);
  const png = await exportCodes(page, "png");
  expect(png.width).toBe(129);
  expectSameHeights(png, single);
  const raw = await exportCodes(page, "raw");
  expect(raw.samples).toEqual(png.samples);
  // Undo restores the flat grid.
  await page.getByTestId("editor-undo").click();
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });
  expect((await readSavedTerrain(page)).heights.every((height) => height === 0)).toBe(true);
  // Any other size still resamples onto the grid (browser decode, Import Height scale).
  await page.locator("[data-landscape-import-range]").fill("5");
  await page.locator("[data-landscape-heightmap-import]").setInputFiles({ name: "small.png", mimeType: "image/png", buffer: Buffer.from(await encodeHeightmapPng16(65, 65, codes(65, 65))) });
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Import Landscape Heightmap", { timeout: 20_000 });
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toContainText("Saved", { timeout: 10_000 });
  const resampled = (await readSavedTerrain(page)).heights;
  console.log(`[terrain-heightmap] resample import heights ${Math.min(...resampled)}..${Math.max(...resampled)}`);
  expect(Math.max(...resampled)).toBeGreaterThan(3);
  expect(Math.max(...resampled)).toBeLessThanOrEqual(5);
  expect(Math.min(...resampled)).toBeGreaterThan(0);

  // Multi-tile: one Landscape per level, so replace it with 2 × 1 tiles of 64 quads (129 × 65).
  await landscapeRows.first().click();
  await page.keyboard.press("Delete");
  await expect(landscapeRows).toHaveCount(0);
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
  const dialog = page.locator("[data-world-terrain-dialog]");
  await dialog.locator('[data-field="tilesX"]').fill("2");
  await dialog.locator('[data-field="tilesZ"]').fill("1");
  await dialog.locator('[data-field="tileQuads"]').selectOption("64");
  await dialog.locator("[data-world-terrain-create]").click();
  await expect(dialog).toHaveCount(0);
  await landscapeRows.first().click();
  await expect(page.locator("[data-landscape-heightmap]")).toContainText("exactly 129 × 65 samples");
  const wide = codes(129, 65);
  const terrainSaved = page.waitForResponse((response) => response.url().endsWith("/__save-terrain") && response.request().method() === "POST", { timeout: 30_000 });
  await importFile(page, "png", "wide.png", Buffer.from(await encodeHeightmapPng16(129, 65, wide)));
  await expect(page.getByTestId("editor-undo")).toHaveAttribute("aria-label", "Undo Import Landscape Heightmap");
  expect((await terrainSaved).ok()).toBeTruthy();
  const dataRef = await page.evaluate(async (scene) => (await (await fetch(`/${scene}?t=${Date.now()}`)).json()).landscapes[0].dataRef as string, SMOKE_SCENE);
  const def = await (await request.get(`/${dataRef}?t=${Date.now()}`)).json() as WorldTerrainDef;
  let worstTile = 0;
  for (const tx of [0, 1]) {
    const tile = decodeTerrainTile(new Uint8Array(await (await request.get(`/${terrainTilePath(dataRef, `${tx}_0`)}?t=${Date.now()}`)).body()));
    for (let z = 0; z < tile.size; z += 1) {
      for (let x = 0; x < tile.size; x += 1) {
        const expected = metres(wide[z * 129 + tx * 64 + x]!);
        worstTile = Math.max(worstTile, Math.abs(tile.heights[z * tile.size + x]! - expected));
      }
    }
  }
  // New multi-tile terrains store u16 tiles over the definition range.
  const tileStep = (def.heightMax - def.heightMin) / 65535;
  console.log(`[terrain-heightmap] multi-tile import worst error ${worstTile} m (tile step ${tileStep})`);
  expect(worstTile).toBeLessThan(tileStep / 2 + 1e-3);
  const widePng = await exportCodes(page, "png");
  expect(widePng.width).toBe(129);
  expectSameHeights(widePng, wide);
  expect((await exportCodes(page, "raw")).samples).toEqual(widePng.samples);

  expect(pageErrors).toEqual([]);
});
