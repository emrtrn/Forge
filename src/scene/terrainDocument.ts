import { createFlatLandscapeData, type ForgeLandscapeData } from "@engine/scene/landscape";
import { legacyLandscapeToWorldTerrain } from "@engine/terrain/terrainLegacy";
import { terrainDocumentToLandscape } from "@engine/terrain/terrainLandscapeBridge";
import { loadWorldTerrain, type WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { isWorldTerrainPath } from "@engine/terrain/terrainTypes";
import { isMultiTileTerrain } from "@engine/terrain/worldTerrainActor";
import { projectFileUrl } from "@/project/ProjectSystem";

/**
 * What a Landscape actor's `dataRef` resolves to: an editable 1×1 grid (legacy
 * sidecar or one-tile World Terrain), or a multi-tile World Terrain that is
 * drawn and collided from its tiles directly.
 */
export type TerrainActorDocument =
  | { kind: "landscape"; data: ForgeLandscapeData }
  | { kind: "world"; document: WorldTerrainDocument };

/** Shared editor/runtime read path. The legacy fallback only applies to absent legacy sidecars. */
export async function fetchTerrainActorDocument(path: string, streamTiles = false): Promise<TerrainActorDocument> {
  if (isWorldTerrainPath(path)) {
    const response = await fetch(projectFileUrl(path));
    if (!response.ok) throw new Error(`Terrain definition ${path}: HTTP ${response.status}`);
    const document = await loadWorldTerrain(path, await response.json(), async (binaryPath) => {
      const binary = await fetch(projectFileUrl(binaryPath));
      if (!binary.ok) throw new Error(`Terrain binary ${binaryPath}: HTTP ${binary.status}`);
      return new Uint8Array(await binary.arrayBuffer());
    }, streamTiles);
    if (isMultiTileTerrain(document.def)) return { kind: "world", document };
    return { kind: "landscape", data: terrainDocumentToLandscape(document) };
  }
  try {
    const response = await fetch(projectFileUrl(path));
    if (!response.ok) return { kind: "landscape", data: createFlatLandscapeData("medium") };
    const source = await response.json() as ForgeLandscapeData;
    const converted = legacyLandscapeToWorldTerrain({ id: "legacy", position: [0, 0, 0], dataRef: path }, source);
    // Preserve legacy rotations, non-square shapes and exact paint until an explicit migration.
    if (converted.warnings.length) console.warn(`[terrain] ${path}: ${converted.warnings.join(" ")}`);
    if (converted.warnings.length) return { kind: "landscape", data: source };
    return { kind: "landscape", data: terrainDocumentToLandscape({ def: converted.def, tiles: new Map([["0_0", converted.tile]]) }) };
  } catch (error) {
    console.warn(`[terrain] Cannot read legacy sidecar ${path}`, error);
    return { kind: "landscape", data: createFlatLandscapeData("medium") };
  }
}

/** The 1×1 grid behind `path`; a multi-tile World Terrain is rejected, never flattened. */
export async function fetchLandscapeDocument(path: string): Promise<ForgeLandscapeData> {
  const document = await fetchTerrainActorDocument(path);
  if (document.kind === "world") {
    throw new Error(`${path} is a multi-tile World Terrain; it has no 1x1 Landscape grid`);
  }
  return document.data;
}
