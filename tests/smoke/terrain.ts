import type { ForgeLandscapeData } from "../../engine/scene/landscape";
import type { Page } from "./test";
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
