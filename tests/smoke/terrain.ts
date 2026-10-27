import { expect, type Page } from "./test";
import { SMOKE_SCENE } from "./smokeProject.mjs";

/**
 * A saved single-tile Landscape as plain arrays: heights relative to the
 * terrain origin Y and each paint layer's 0..1 weight per vertex, row-major
 * along +Z (the shape the 1×1 smoke specs compare).
 */
export interface SavedTerrain {
  size: { verticesX: number; verticesZ: number; spacing: number };
  origin: [number, number, number];
  heights: number[];
  layers: { id: string; name: string; material?: string; physicalMaterial?: string | null; weights: number[] }[];
  splines: unknown[];
}

/** Read the saved definition + binary through the real browser loader, including deployment base. */
export async function readSavedTerrain(page: Page, path?: string): Promise<SavedTerrain> {
  path ??= await page.evaluate(async (scenePath) => {
    const level = await (await fetch(`/${scenePath}`)).json();
    return level.landscapes[0].dataRef as string;
  }, SMOKE_SCENE);
  return page.evaluate(async (dataRef) => {
    const documentModule = "/src/scene/terrainDocument.ts";
    const typesModule = "/engine/terrain/terrainTypes.ts";
    const { fetchTerrainActorDocument } = await import(documentModule);
    const { terrainTileLayerWeight } = await import(typesModule);
    const loaded = await fetchTerrainActorDocument(dataRef);
    if (loaded.kind !== "world") throw new Error(`${dataRef} did not load as a World Terrain`);
    const { def, tiles } = loaded.document;
    if (def.tilesX !== 1 || def.tilesZ !== 1) throw new Error(`${dataRef} is not a single-tile Landscape`);
    const tile = tiles.get("0_0");
    if (!tile) throw new Error(`${dataRef} has no tile 0_0`);
    return {
      size: { verticesX: tile.size, verticesZ: tile.size, spacing: def.spacing },
      origin: def.origin,
      heights: Array.from(tile.heights as Float32Array),
      layers: def.layers.map((layer: { id: string; name: string; material?: string; physicalMaterial?: string | null }, index: number) => ({
        ...layer,
        weights: Array.from({ length: tile.size * tile.size }, (_unused, vertex) => terrainTileLayerWeight(tile, index, vertex)),
      })),
      splines: def.splines ?? [],
    };
  }, path);
}

/** Add Actor → Landscape, accepting the New Landscape dialog's default: one flat 129 × 129 tile. */
export async function addLandscapeFromMenu(page: Page): Promise<void> {
  await page.getByTestId("add-actor-button").hover();
  await page.getByRole("button", { name: /^Terrain/ }).hover();
  // Scope to the category submenu: the Undo button's aria-label is dynamic
  // ("Undo Delete Landscape"), so an unscoped "Landscape" role query is ambiguous.
  await page.locator("[data-add-categories]").getByRole("button", { name: "Landscape", exact: true }).click();
  const dialog = page.locator("[data-world-terrain-dialog]");
  await expect(dialog.locator("[data-world-terrain-summary]")).toContainText("128 m × 128 m · 1 tile of 128 m");
  await dialog.locator("[data-world-terrain-create]").click();
  await expect(dialog).toHaveCount(0);
}
