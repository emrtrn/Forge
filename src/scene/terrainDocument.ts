import type { ForgeLandscapeData } from "@engine/scene/landscape";
import type { LayoutLandscape } from "@engine/scene/layout";
import { legacyLandscapeToWorldTerrain } from "@engine/terrain/terrainLegacy";
import { loadWorldTerrain, type WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { migrateTerrainSplineCoordinates } from "@engine/terrain/terrainSplineData";
import { isWorldTerrainPath, tileKey, type WorldTerrainDef } from "@engine/terrain/terrainTypes";
import { createFlatWorldTerrain } from "@engine/terrain/worldTerrainCreate";
import { projectFileUrl } from "@/project/ProjectSystem";

/**
 * What a Landscape actor's `dataRef` resolves to: always a World Terrain
 * (OPEN_WORLD_PLAN Faz 8, bridge removal K4), one tile or many. A legacy
 * `.landscape.json` read in memory names `legacySource`: the editor saves it
 * as a level-owned World Terrain and keeps the old file. The `landscape`
 * variant is no longer produced and goes with the bridge (K5).
 */
export type TerrainActorDocument =
  | { kind: "landscape"; data: ForgeLandscapeData }
  | { kind: "world"; document: WorldTerrainDocument; legacySource?: { path: string } };

/** The actor fields a legacy sidecar needs: it has no placement of its own. */
export type TerrainDocumentOwner = Pick<LayoutLandscape, "id" | "position" | "dataRef"> &
  Partial<Pick<LayoutLandscape, "name" | "rotation" | "collision">>;

/**
 * A legacy sidecar whose grid a World Terrain tile can hold exactly (square,
 * unrotated, a valid tile size, at most eight layers). Anything else is an
 * explicit error: the editor and the runtime never resample or drop a rotation
 * silently; `npm run terrain:migrate` performs and reports that conversion.
 */
function legacyWorldTerrain(owner: TerrainDocumentOwner, path: string, source: ForgeLandscapeData): WorldTerrainDocument {
  const converted = legacyLandscapeToWorldTerrain({ ...owner, dataRef: path }, source);
  if (converted.warnings.length > 0) {
    throw new Error(`${path} needs an explicit migration (${converted.warnings.join(" ")}); run npm run terrain:migrate -- ${path}`);
  }
  return { def: migrateTerrainSplineCoordinates(converted.def), tiles: new Map([[tileKey(0, 0), converted.tile]]) };
}

/** Stand-in for a legacy sidecar that is missing or unreadable: one flat 128-quad tile centred on the actor. */
function flatLegacyTerrain(owner: TerrainDocumentOwner): WorldTerrainDocument {
  const document = createFlatWorldTerrain({
    name: owner.name ?? owner.id, tilesX: 1, tilesZ: 1, tileQuads: 128, spacing: 1, baseHeight: owner.position[1],
  });
  const def: WorldTerrainDef = { ...document.def, origin: [owner.position[0] - 64, owner.position[1], owner.position[2] - 64] };
  return { def, tiles: document.tiles };
}

/**
 * Shared editor/runtime read path. `owner` places a legacy sidecar (its grid
 * is centred on the actor); a `.terrain.json` carries its own placement.
 */
export async function fetchTerrainActorDocument(
  path: string,
  streamTiles: boolean | ((def: WorldTerrainDef) => boolean) = false,
  owner: TerrainDocumentOwner = { id: "legacy", position: [0, 0, 0], dataRef: path },
): Promise<TerrainActorDocument> {
  if (isWorldTerrainPath(path)) {
    const response = await fetch(projectFileUrl(path));
    if (!response.ok) throw new Error(`Terrain definition ${path}: HTTP ${response.status}`);
    const document = await loadWorldTerrain(path, await response.json(), async (binaryPath) => {
      const binary = await fetch(projectFileUrl(binaryPath));
      if (!binary.ok) throw new Error(`Terrain binary ${binaryPath}: HTTP ${binary.status}`);
      return new Uint8Array(await binary.arrayBuffer());
    }, streamTiles);
    // The 1x1 Landscape honoured its actor's rotation; a World Terrain is
    // world-aligned, so dropping it would silently move the authored surface.
    const rotation = owner.rotation ?? [0, 0, 0];
    if (document.def.tilesX === 1 && document.def.tilesZ === 1 && rotation.some((axis) => Math.abs(axis) > 1e-6)) {
      throw new Error(`${path}: the Landscape actor is rotated [${rotation.join(", ")}] and a World Terrain cannot be; `
        + `run npm run terrain:migrate -- ${path} to drop the rotation explicitly`);
    }
    return { kind: "world", document };
  }
  const legacySource = { path };
  let source: ForgeLandscapeData | null = null;
  try {
    const response = await fetch(projectFileUrl(path));
    if (response.ok) source = await response.json() as ForgeLandscapeData;
    else console.warn(`[terrain] Legacy sidecar ${path}: HTTP ${response.status}; using a flat Landscape.`);
  } catch (error) {
    console.warn(`[terrain] Cannot read legacy sidecar ${path}; using a flat Landscape.`, error);
  }
  return { kind: "world", document: source ? legacyWorldTerrain(owner, path, source) : flatLegacyTerrain(owner), legacySource };
}
