import type { ForgeLandscapeData } from "../../engine/scene/landscape";
import { expect, type Page } from "./test";
import { SMOKE_SCENE } from "./smokeProject.mjs";

/** Read the saved definition + binary through the real browser loader, including deployment base. */
export async function readSavedTerrain(page: Page, path?: string): Promise<ForgeLandscapeData> {
  path ??= await page.evaluate(async (scenePath) => {
    const level = await (await fetch(`/${scenePath}`)).json();
    return level.landscapes[0].dataRef as string;
  }, SMOKE_SCENE);
  return page.evaluate(async (dataRef) => {
    const modulePath = "/src/scene/terrainDocument.ts";
    const { fetchLandscapeDocument } = await import(modulePath);
    return fetchLandscapeDocument(dataRef);
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
