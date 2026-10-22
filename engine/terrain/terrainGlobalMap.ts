import type { TerrainDirtyRect } from "./terrainEdit";
import { terrainHeightAt, type TerrainQueryDef, type TerrainTileLookup } from "./terrainHeightQuery";
import { parseTileKey } from "./terrainTypes";

export interface TerrainGlobalMap {
  width: number;
  height: number;
  /** Vertex stride: the grid one CDLOD level above a tile. */
  stride: number;
  /** World-space metres, row-major. NaN denotes a hole/not-yet-loaded sample. */
  heights: Float32Array;
}

function globalMapShape(def: TerrainQueryDef, patchQuads: number): { width: number; height: number; stride: number } {
  if (!Number.isInteger(patchQuads) || patchQuads < 2 || patchQuads > def.tileQuads
    || !Number.isInteger(Math.log2(patchQuads)) || !Number.isInteger(Math.log2(def.tileQuads))) {
    throw new Error("Terrain global map patchQuads must be a power of two in 2..tileQuads");
  }
  if (![def.tilesX, def.tilesZ].every((value) => Number.isSafeInteger(value) && value > 0)
    || !Number.isFinite(def.spacing) || def.spacing <= 0 || !def.origin.every(Number.isFinite)) {
    throw new Error("Invalid terrain global map world");
  }
  const stride = 2 * def.tileQuads / patchQuads;
  return { width: def.tilesX * def.tileQuads / stride + 1, height: def.tilesZ * def.tileQuads / stride + 1, stride };
}

/** Point samples, never averages: fully morphed tile nodes must hit this exact grid. */
export function buildTerrainGlobalMap(def: TerrainQueryDef, tiles: TerrainTileLookup, patchQuads = 32): TerrainGlobalMap {
  const shape = globalMapShape(def, patchQuads);
  const map: TerrainGlobalMap = { ...shape, heights: new Float32Array(shape.width * shape.height).fill(NaN) };
  sampleRect(map, def, tiles, { x0: 0, x1: map.width - 1, z0: 0, z1: map.height - 1 });
  return map;
}

function sampleRect(map: TerrainGlobalMap, def: TerrainQueryDef, tiles: TerrainTileLookup, rect: TerrainDirtyRect): void {
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      const height = terrainHeightAt(def, tiles, def.origin[0] + x * map.stride * def.spacing, def.origin[2] + z * map.stride * def.spacing);
      // Keep the always-resident samples when the source tile streams out.
      if (height !== null) map.heights[z * map.width + x] = height;
    }
  }
}

/**
 * Rewrites only sample points inside one tile's dirty vertex rectangle. Omit
 * dirty when a tile streams in. Returns global texel bounds for a GPU upload,
 * or null if the rectangle covers no stride-grid points.
 */
export function updateTerrainGlobalMap(
  map: TerrainGlobalMap,
  def: TerrainQueryDef,
  tiles: TerrainTileLookup,
  key: string,
  dirty: TerrainDirtyRect = { x0: 0, x1: def.tileQuads, z0: 0, z1: def.tileQuads },
): TerrainDirtyRect | null {
  const coord = parseTileKey(key);
  if (!coord || coord.x < 0 || coord.z < 0 || coord.x >= def.tilesX || coord.z >= def.tilesZ) {
    throw new Error(`Invalid terrain global map tile ${key}`);
  }
  if (![dirty.x0, dirty.x1, dirty.z0, dirty.z1].every(Number.isInteger)
    || dirty.x0 < 0 || dirty.z0 < 0 || dirty.x1 > def.tileQuads || dirty.z1 > def.tileQuads
    || dirty.x0 > dirty.x1 || dirty.z0 > dirty.z1) throw new Error("Invalid terrain global map dirty rectangle");
  const x0 = Math.ceil((coord.x * def.tileQuads + dirty.x0) / map.stride);
  const x1 = Math.floor((coord.x * def.tileQuads + dirty.x1) / map.stride);
  const z0 = Math.ceil((coord.z * def.tileQuads + dirty.z0) / map.stride);
  const z1 = Math.floor((coord.z * def.tileQuads + dirty.z1) / map.stride);
  if (x0 > x1 || z0 > z1) return null;
  const rect = { x0, x1, z0, z1 };
  sampleRect(map, def, tiles, rect);
  return rect;
}
