import type { ForgeLandscapeData } from "../../engine/scene/landscape";
import type { Page } from "./test";

/** Read the saved definition + binary through the real browser loader, including deployment base. */
export async function readSavedTerrain(page: Page, path = "landscapes/landscape-1.terrain.json"): Promise<ForgeLandscapeData> {
  return page.evaluate(async (dataRef) => {
    const modulePath = "/src/scene/terrainDocument.ts";
    const { fetchLandscapeDocument } = await import(modulePath);
    return fetchLandscapeDocument(dataRef);
  }, path);
}
