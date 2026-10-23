import { createFlatLandscapeData, type ForgeLandscapeData } from "@engine/scene/landscape";
import { legacyLandscapeToWorldTerrain } from "@engine/terrain/terrainLegacy";
import { terrainDocumentToLandscape } from "@engine/terrain/terrainLandscapeBridge";
import { loadWorldTerrain } from "@engine/terrain/terrainLoader";
import { isWorldTerrainPath } from "@engine/terrain/terrainTypes";
import { projectFileUrl } from "@/project/ProjectSystem";

/** Shared editor/runtime read path. The legacy fallback only applies to absent legacy sidecars. */
export async function fetchLandscapeDocument(path: string): Promise<ForgeLandscapeData> {
  if (isWorldTerrainPath(path)) {
    const response = await fetch(projectFileUrl(path));
    if (!response.ok) throw new Error(`Terrain definition ${path}: HTTP ${response.status}`);
    const document = await loadWorldTerrain(path, await response.json(), async (tilePath) => {
      const tile = await fetch(projectFileUrl(tilePath));
      if (!tile.ok) throw new Error(`Terrain tile ${tilePath}: HTTP ${tile.status}`);
      return new Uint8Array(await tile.arrayBuffer());
    });
    return terrainDocumentToLandscape(document);
  }
  try {
    const response = await fetch(projectFileUrl(path));
    if (!response.ok) return createFlatLandscapeData("medium");
    const source = await response.json() as ForgeLandscapeData;
    const converted = legacyLandscapeToWorldTerrain({ id: "legacy", position: [0, 0, 0], dataRef: path }, source);
    // Preserve legacy rotations, non-square shapes and exact paint until an explicit migration.
    if (converted.warnings.length) console.warn(`[terrain] ${path}: ${converted.warnings.join(" ")}`);
    if (converted.warnings.length) return source;
    return terrainDocumentToLandscape({ def: converted.def, tiles: new Map([["0_0", converted.tile]]) });
  } catch (error) {
    console.warn(`[terrain] Cannot read legacy sidecar ${path}`, error);
    return createFlatLandscapeData("medium");
  }
}
