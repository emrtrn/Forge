import type { WorldTerrainDocument } from "./terrainLoader";
import {
  createFlatTerrainTile, terrainTileHeightRange, tileKey,
  TERRAIN_MAX_TILES_PER_AXIS,
  type TerrainTileData, type WorldTerrainDef,
} from "./terrainTypes";
import { WORLD_TERRAIN_CREATE_MAX_VERTICES } from "./worldTerrainCreate";

export interface WorldTerrainExpandOptions {
  tilesX: number;
  tilesZ: number;
  /** Zero-based tile occupied by the authored Landscape. */
  originalX: number;
  originalZ: number;
}

/** What the Expand dialog needs from the Landscape being expanded. */
export interface WorldTerrainExpansionSource {
  /** Quads per tile edge and the tile's world edge length, both kept by expansion. */
  tileQuads: number;
  tileEdge: number;
  problems(options: WorldTerrainExpandOptions): string[];
}

export const WORLD_TERRAIN_EXPAND_DEFAULTS: WorldTerrainExpandOptions = {
  tilesX: 2, tilesZ: 2, originalX: 0, originalZ: 0,
};

/** Tile grid checks shared by both expansion sources. */
function expandGridProblems(options: WorldTerrainExpandOptions, tileVertices: number): string[] {
  const problems: string[] = [];
  for (const [axis, tiles, original] of [["X", options.tilesX, options.originalX], ["Z", options.tilesZ, options.originalZ]] as const) {
    if (!Number.isInteger(tiles) || tiles < 1 || tiles > TERRAIN_MAX_TILES_PER_AXIS) problems.push(`Tiles ${axis} must be a whole number from 1 to ${TERRAIN_MAX_TILES_PER_AXIS}.`);
    if (!Number.isInteger(original) || original < 0 || original >= tiles) problems.push(`Original tile ${axis} must be a whole number from 0 to Tiles ${axis} minus 1.`);
  }
  const tileCount = options.tilesX * options.tilesZ;
  if (tileCount < 2) problems.push("Expanding needs at least two tiles.");
  if (tileCount * tileVertices > WORLD_TERRAIN_CREATE_MAX_VERTICES) problems.push("Too large for this build: exceeds the World Terrain creation vertex limit.");
  return problems;
}

/**
 * Fills `def.tiles` (and widens its height range) with the expanded grid: the
 * original tile verbatim at its new key, every other tile extending the
 * original's nearest edge or corner heights, with shared edge vertices keeping
 * the original's exact RGBA8 paint and the rest starting on layer 0.
 */
function expandTiles(def: WorldTerrainDef, originalTile: TerrainTileData, options: WorldTerrainExpandOptions): WorldTerrainDocument["tiles"] {
  const q = def.tileQuads;
  const size = q + 1;
  const tiles: WorldTerrainDocument["tiles"] = new Map();
  for (let tz = 0; tz < options.tilesZ; tz += 1) {
    for (let tx = 0; tx < options.tilesX; tx += 1) {
      const isOriginalTile = tx === options.originalX && tz === options.originalZ;
      const tile = isOriginalTile ? { ...originalTile, x: tx, z: tz } : createFlatTerrainTile(def, tx, tz);
      for (let z = 0; !isOriginalTile && z < size; z += 1) {
        for (let x = 0; x < size; x += 1) {
          const sx = (tx - options.originalX) * q + x;
          const sz = (tz - options.originalZ) * q + z;
          const original = sx >= 0 && sx <= q && sz >= 0 && sz <= q;
          const sourceIndex = Math.max(0, Math.min(q, sz)) * size + Math.max(0, Math.min(q, sx));
          const index = z * size + x;
          tile.heights[index] = originalTile.heights[sourceIndex]!;
          if (original) {
            // Copy complete RGBA8 blocks, including unused channels, from the
            // original tile; never quantize again.
            const blockBytes = size * size * 4;
            for (let block = 0; block < originalTile.weights.length; block += blockBytes) {
              tile.weights.set(originalTile.weights.subarray(block + sourceIndex * 4, block + sourceIndex * 4 + 4), block + index * 4);
            }
          }
        }
      }
      const range = terrainTileHeightRange(tile);
      const key = tileKey(tx, tz);
      def.heightMin = Math.min(def.heightMin, Math.floor(range.min) - 16);
      def.heightMax = Math.max(def.heightMax, Math.ceil(range.max) + 16);
      def.tiles.push({ key, minHeight: range.min, maxHeight: range.max });
      tiles.set(key, tile);
    }
  }
  return tiles;
}

/**
 * Problems blocking the expansion of a single-tile World Terrain (OPEN_WORLD_PLAN
 * Faz 8, bridge removal K3). Its splines, River Water and lakes are in world
 * space and the original tile keeps its world position, so none of them blocks.
 */
export function singleTileExpandProblems(def: Pick<WorldTerrainDef, "tilesX" | "tilesZ" | "tiles" | "tileQuads">, options: WorldTerrainExpandOptions): string[] {
  const problems: string[] = [];
  if (def.tilesX !== 1 || def.tilesZ !== 1 || def.tiles.length !== 1) problems.push("Only a single-tile Landscape can be expanded.");
  return [...problems, ...expandGridProblems(options, (def.tileQuads + 1) ** 2)];
}

/**
 * A single-tile World Terrain extended to `tilesX` × `tilesZ`: the original
 * tile keeps its world position and exact samples (height format included),
 * the definition keeps its layers, splines and range. Inputs are not mutated.
 */
export function expandSingleTileWorldTerrain(document: WorldTerrainDocument, options: WorldTerrainExpandOptions): WorldTerrainExpansion {
  const reasons = singleTileExpandProblems(document.def, options);
  const originalTile = document.tiles.get(tileKey(0, 0));
  if (!originalTile) reasons.push("The Landscape tile is not loaded.");
  if (reasons.length) return { ok: false, reasons };
  const source = document.def;
  const edge = source.tileQuads * source.spacing;
  const def: WorldTerrainDef = {
    ...structuredClone(source),
    tilesX: options.tilesX, tilesZ: options.tilesZ,
    origin: [source.origin[0] - options.originalX * edge, source.origin[1], source.origin[2] - options.originalZ * edge],
    tiles: [],
  };
  return { ok: true, document: { def, tiles: expandTiles(def, originalTile!, options) } };
}

export type WorldTerrainExpansion = { ok: true; document: WorldTerrainDocument } | { ok: false; reasons: string[] };
