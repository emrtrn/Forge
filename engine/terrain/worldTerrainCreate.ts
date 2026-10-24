import { LANDSCAPE_DEFAULT_LAYERS } from "../scene/landscape";
import type { WorldTerrainDocument } from "./terrainLoader";
import { terrainTileByteLength } from "./terrainTileCodec";
import {
  TERRAIN_DEFAULT_HEIGHT_MAX,
  TERRAIN_DEFAULT_HEIGHT_MIN,
  TERRAIN_MAX_TILES_PER_AXIS,
  createFlatTerrainTile,
  terrainWeightBlockCount,
  tileKey,
  type TerrainTileData,
  type WorldTerrainDef,
} from "./terrainTypes";

/** Tile resolutions the editor offers; 256 quads is the plan's default (K1). */
export const WORLD_TERRAIN_CREATE_TILE_QUADS = [64, 128, 256] as const;
export type WorldTerrainCreateTileQuads = (typeof WORLD_TERRAIN_CREATE_TILE_QUADS)[number];

/**
 * Upper bound on a new terrain's vertices: 64 tiles of 257². Until tile
 * streaming (Faz 4) the editor keeps every tile in memory and the runtime
 * builds one trimesh per tile at boot (~74 ms each at 257², Faz 3 interim), so
 * the schema's 32 × 32 grid is not offered yet.
 */
export const WORLD_TERRAIN_CREATE_MAX_VERTICES = 64 * 257 * 257;
export const WORLD_TERRAIN_CREATE_MIN_SPACING = 0.25;
export const WORLD_TERRAIN_CREATE_MAX_SPACING = 8;
export const WORLD_TERRAIN_CREATE_MAX_BASE_HEIGHT = 1000;

export interface WorldTerrainCreateOptions {
  name: string;
  tilesX: number;
  tilesZ: number;
  tileQuads: WorldTerrainCreateTileQuads;
  /** Metres between neighbouring vertices. */
  spacing: number;
  /** World Y of the height datum; the new terrain is flat at this height. */
  baseHeight: number;
}

/** One 128-quad tile at 1 m: the 129 × 129 grid Add Landscape has always made. */
export const WORLD_TERRAIN_CREATE_DEFAULTS: WorldTerrainCreateOptions = {
  name: "Landscape", tilesX: 1, tilesZ: 1, tileQuads: 128, spacing: 1, baseHeight: 0,
};

export interface WorldTerrainCreateEstimate {
  tileCount: number;
  /** World X/Z size in metres. */
  extent: [number, number];
  vertices: number;
  /** Tile binaries on disk (`u16` heights) plus nothing for the small definition. */
  diskBytes: number;
  /** Float32 heights + RGBA8 weights the editor holds for every tile. */
  memoryBytes: number;
}

export function estimateWorldTerrain(options: WorldTerrainCreateOptions): WorldTerrainCreateEstimate {
  const size = options.tileQuads + 1;
  const tileCount = options.tilesX * options.tilesZ;
  const layers = LANDSCAPE_DEFAULT_LAYERS.length;
  const tileSize = options.tileQuads * options.spacing;
  return {
    tileCount,
    extent: [options.tilesX * tileSize, options.tilesZ * tileSize],
    vertices: tileCount * size * size,
    diskBytes: tileCount * terrainTileByteLength(size, layers, "u16"),
    memoryBytes: tileCount * size * size * (4 + 4 * terrainWeightBlockCount(layers)),
  };
}

/** Problems that block creation, as short sentences for the dialog; empty when valid. */
export function worldTerrainCreateProblems(options: WorldTerrainCreateOptions): string[] {
  const problems: string[] = [];
  if (!options.name.trim()) problems.push("Enter a name.");
  for (const [axis, value] of [["X", options.tilesX], ["Z", options.tilesZ]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > TERRAIN_MAX_TILES_PER_AXIS) {
      problems.push(`Tiles ${axis} must be a whole number from 1 to ${TERRAIN_MAX_TILES_PER_AXIS}.`);
    }
  }
  if (!WORLD_TERRAIN_CREATE_TILE_QUADS.includes(options.tileQuads)) problems.push("Pick a tile resolution.");
  if (!(options.spacing >= WORLD_TERRAIN_CREATE_MIN_SPACING && options.spacing <= WORLD_TERRAIN_CREATE_MAX_SPACING)) {
    problems.push(`Vertex spacing must be between ${WORLD_TERRAIN_CREATE_MIN_SPACING} and ${WORLD_TERRAIN_CREATE_MAX_SPACING} m.`);
  }
  if (!(Math.abs(options.baseHeight) <= WORLD_TERRAIN_CREATE_MAX_BASE_HEIGHT)) {
    problems.push(`Base height must be within ±${WORLD_TERRAIN_CREATE_MAX_BASE_HEIGHT} m.`);
  }
  if (problems.length === 0 && estimateWorldTerrain(options).vertices > WORLD_TERRAIN_CREATE_MAX_VERTICES) {
    problems.push("Too large for this build: at most 64 tiles of 256 quads (or the same vertex count) until tile streaming lands.");
  }
  return problems;
}

/**
 * A flat World Terrain centred on world X/Z 0 at `baseHeight` (1x1 included,
 * which the editor edits through the Landscape adapter): every grid cell
 * has a tile (no holes), the default Landscape layers with layer 0 at full
 * weight, and the default ±256 m height range. Nothing is written; the editor
 * saves the tiles and definition like any edited World Terrain.
 */
export function createFlatWorldTerrain(options: WorldTerrainCreateOptions): WorldTerrainDocument {
  const problems = worldTerrainCreateProblems(options);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const { extent } = estimateWorldTerrain(options);
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: options.name.trim(),
    tileQuads: options.tileQuads, spacing: options.spacing, tilesX: options.tilesX, tilesZ: options.tilesZ,
    origin: [-extent[0] / 2, options.baseHeight, -extent[1] / 2],
    heightMin: TERRAIN_DEFAULT_HEIGHT_MIN, heightMax: TERRAIN_DEFAULT_HEIGHT_MAX,
    layers: LANDSCAPE_DEFAULT_LAYERS.map(({ id, name, color }) => ({ id, name, color })),
    tiles: [], collision: true,
  };
  const tiles = new Map<string, TerrainTileData>();
  for (let z = 0; z < def.tilesZ; z += 1) {
    for (let x = 0; x < def.tilesX; x += 1) {
      const key = tileKey(x, z);
      tiles.set(key, createFlatTerrainTile(def, x, z));
      def.tiles.push({ key, minHeight: 0, maxHeight: 0 });
    }
  }
  return { def, tiles };
}
