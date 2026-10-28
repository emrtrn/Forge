import type { LayoutLandscape } from "@engine/scene/layout";
import { loadWorldTerrain, type WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { isWorldTerrainPath, type WorldTerrainDef } from "@engine/terrain/terrainTypes";
import { projectFileUrl } from "@/project/ProjectSystem";

/**
 * What a Landscape actor's `dataRef` resolves to: always a World Terrain
 * (OPEN_WORLD_PLAN Faz 8 bridge removal), one tile or many. The legacy 1×1
 * `.landscape.json` sidecar is no longer read.
 */
export type TerrainActorDocument = { kind: "world"; document: WorldTerrainDocument };

/** The actor fields the read path checks: a World Terrain cannot be rotated. */
export type TerrainDocumentOwner = Pick<LayoutLandscape, "id" | "position" | "dataRef"> &
  Partial<Pick<LayoutLandscape, "name" | "rotation" | "collision">>;

/** Shared editor/runtime read path for a Landscape actor's `.terrain.json`. */
export async function fetchTerrainActorDocument(
  path: string,
  streamTiles: boolean | ((def: WorldTerrainDef) => boolean) = false,
  owner: TerrainDocumentOwner = { id: "terrain", position: [0, 0, 0], dataRef: path },
): Promise<TerrainActorDocument> {
  if (!isWorldTerrainPath(path)) {
    throw new Error(`${path}: legacy .landscape.json Landscape files are not supported; the Landscape needs a World Terrain (.terrain.json)`);
  }
  const response = await fetch(projectFileUrl(path));
  if (!response.ok) throw new Error(`Terrain definition ${path}: HTTP ${response.status}`);
  const document = await loadWorldTerrain(path, await response.json(), async (binaryPath) => {
    const binary = await fetch(projectFileUrl(binaryPath));
    if (!binary.ok) throw new Error(`Terrain binary ${binaryPath}: HTTP ${binary.status}`);
    return new Uint8Array(await binary.arrayBuffer());
  }, streamTiles);
  // A World Terrain is world-aligned: dropping an actor rotation would silently
  // move the authored surface.
  const rotation = owner.rotation ?? [0, 0, 0];
  if (rotation.some((axis) => Math.abs(axis) > 1e-6)) {
    throw new Error(`${path}: the Landscape actor is rotated [${rotation.join(", ")}] and a World Terrain cannot be`);
  }
  return { kind: "world", document };
}
