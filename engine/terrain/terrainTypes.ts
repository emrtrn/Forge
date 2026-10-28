import type { ForgeLandscapeSpline } from "../scene/landscape";
import type { Vec3 } from "../scene/layout";

/**
 * Render-agnostic World Terrain model (docs/planned/OPEN_WORLD_PLAN.md, K1): a
 * square grid of square tiles, each tile a `(tileQuads + 1)²` heightfield with
 * its own paint weights. A tile is the streaming unit (Unreal's Landscape
 * Streaming Proxy). Edge vertices are duplicated in both neighbours rather than
 * shared, so one tile renders, collides and samples on its own; editor tools
 * keep the copies equal.
 *
 * The terrain is axis-aligned and unrotated — the World Partition grid is
 * world-aligned, and a rotated heightfield would break every cell lookup.
 *
 * Kept free of three.js and Rapier so the save validator, the editor core and
 * the engine tests can read it.
 */

export const TERRAIN_SCHEMA = 1;

/** Quads per tile edge must be a power of two in this range (CDLOD patch fit). */
export const TERRAIN_MIN_TILE_QUADS = 32;
export const TERRAIN_MAX_TILE_QUADS = 512;
export const TERRAIN_DEFAULT_TILE_QUADS = 256;

/** Hard grid bound: 32 × 256 m = 8 km, the largest world the schema admits. */
export const TERRAIN_MAX_TILES_PER_AXIS = 32;

/** Two RGBA8 weight blocks per vertex. */
export const TERRAIN_MAX_LAYERS = 8;
export const TERRAIN_LAYERS_PER_WEIGHT_BLOCK = 4;

/**
 * Default `Uint16` height range, Unreal's ±256 m (≈7.8 mm per step). A world
 * with taller relief widens the range at creation time and trades precision.
 */
export const TERRAIN_DEFAULT_HEIGHT_MIN = -256;
export const TERRAIN_DEFAULT_HEIGHT_MAX = 256;

export interface WorldTerrainLayerDef {
  id: string;
  name: string;
  /** Fallback tint when no material/texture is assigned. */
  color: string;
  /** Assigned material asset id; `null`/absent uses the preset look. */
  material?: string | null;
  /**
   * Built-in physical material id (`PHYSICAL_MATERIAL_IDS`) for vehicle surface
   * response; `null`/absent leaves the layer neutral (TERRAIN_DEFORMATION Faz 1b).
   */
  physicalMaterial?: string | null;
}

/** Per-tile index entry kept in `terrain.json`, readable without fetching the tile. */
export interface WorldTerrainTileSummary {
  /** `tileKey(x, z)`. */
  key: string;
  /** Height bounds (relative to `origin[1]`) for culling, LOD and raycast early-outs. */
  minHeight: number;
  maxHeight: number;
}

/** Missing frame is the schema-1 centre-local compatibility format. */
export type TerrainSpline = ForgeLandscapeSpline & { coordinateSpace?: "world" };

export interface WorldTerrainSpline extends ForgeLandscapeSpline {
  coordinateSpace: "world";
}

export interface WorldTerrainDef {
  schema: typeof TERRAIN_SCHEMA;
  type: "worldTerrain";
  name: string;
  /** Quads per tile edge; a tile has `tileQuads + 1` vertices per side. */
  tileQuads: number;
  /** World units between neighbouring vertices. */
  spacing: number;
  tilesX: number;
  tilesZ: number;
  /** World position of tile (0, 0)'s min-X/min-Z corner; Y is the height datum. */
  origin: Vec3;
  /** Encoding range of `Uint16` tile heights, relative to `origin[1]`. */
  heightMin: number;
  heightMax: number;
  layers: WorldTerrainLayerDef[];
  /** Tiles that exist on disk. A grid slot without an entry is a hole. */
  tiles: WorldTerrainTileSummary[];
  collision: boolean;
  /**
   * Road/spline data. New saves mark each spline coordinateSpace:"world".
   * Unmarked schema-1 data remains relative to the terrain centre when read;
   * terrainSplineData provides the explicit copy migration to world space.
   */
  splines?: TerrainSpline[];
}

/**
 * On disk a terrain is `<name>.terrain.json` (this definition) plus one binary
 * per tile in the sibling `<name>.tiles/` folder, `<x>_<z>.tile.bin` — typed
 * suffixes like every other Forge sidecar, and a folder per terrain so two
 * terrains in one directory never share tile names.
 */
export const TERRAIN_DEF_SUFFIX = ".terrain.json";
export const TERRAIN_TILE_SUFFIX = ".tile.bin";
export const TERRAIN_GLOBAL_SUFFIX = ".global.bin";

export function isWorldTerrainPath(path: string): boolean {
  return path.endsWith(TERRAIN_DEF_SUFFIX);
}

/** Folder holding every terrain definition (and its `.tiles/`) owned by one level. */
export function levelTerrainDir(scenePath: string): string {
  const normalized = scenePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const base = normalized.replace(/(\.level|\.layout)?\.json$/i, "");
  if (!base) throw new Error("Terrain requires a level path");
  return `${base}.landscapes`;
}

/** Level-owned terrain: keep the full scene path so equal names in different folders cannot collide. */
export function levelTerrainPath(scenePath: string, landscapeId: string): string {
  if (!landscapeId) throw new Error("Terrain requires a level path and actor id");
  const dir = levelTerrainDir(scenePath);
  // Escape rather than sanitize: distinct actor IDs must not collapse to one filename.
  const id = Array.from(landscapeId, (char) => /^[a-z0-9_-]$/i.test(char)
    ? char : `~${char.codePointAt(0)!.toString(16)}~`).join("");
  return `${dir}/${id}${TERRAIN_DEF_SUFFIX}`;
}

/** Public-root-relative path of one tile binary, next to its definition. */
export function terrainTilePath(defPath: string, key: string): string {
  if (!isWorldTerrainPath(defPath)) throw new Error(`terrain path must end with ${TERRAIN_DEF_SUFFIX}: ${defPath}`);
  const coord = parseTileKey(key);
  if (!coord || coord.x < 0 || coord.z < 0 || key !== tileKey(coord.x, coord.z)) throw new Error(`invalid terrain tile key: ${key}`);
  return `${defPath.slice(0, -TERRAIN_DEF_SUFFIX.length)}.tiles/${key}${TERRAIN_TILE_SUFFIX}`;
}

/** Always-resident far-terrain samples, beside the definition. */
export function terrainGlobalMapPath(defPath: string): string {
  if (!isWorldTerrainPath(defPath)) throw new Error(`terrain path must end with ${TERRAIN_DEF_SUFFIX}: ${defPath}`);
  return `${defPath.slice(0, -TERRAIN_DEF_SUFFIX.length)}${TERRAIN_GLOBAL_SUFFIX}`;
}

/**
 * One decoded tile. Heights are metres relative to `origin[1]`; weights are
 * `ceil(layerCount / 4)` RGBA8 blocks laid out back to back, each `size² × 4`
 * bytes, vertex-major — the exact upload shape of a `DataArrayTexture` layer.
 * Layer `i` lives in block `floor(i / 4)`, channel `i % 4`.
 */
export interface TerrainTileData {
  x: number;
  z: number;
  /** Vertices per side (`tileQuads + 1`). */
  size: number;
  heights: Float32Array;
  layerCount: number;
  weights: Uint8Array;
}

export function tileKey(x: number, z: number): string {
  return `${x}_${z}`;
}

export function parseTileKey(key: string): { x: number; z: number } | null {
  const match = /^(-?\d+)_(-?\d+)$/.exec(key);
  if (!match) return null;
  return { x: Number(match[1]), z: Number(match[2]) };
}

export function isValidTileQuads(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= TERRAIN_MIN_TILE_QUADS &&
    value <= TERRAIN_MAX_TILE_QUADS &&
    (value & (value - 1)) === 0
  );
}

export function terrainTileVertexCount(def: Pick<WorldTerrainDef, "tileQuads">): number {
  return def.tileQuads + 1;
}

export function terrainWeightBlockCount(layerCount: number): number {
  return Math.ceil(Math.max(0, layerCount) / TERRAIN_LAYERS_PER_WEIGHT_BLOCK);
}

/** World edge length of one tile. */
export function terrainTileWorldSize(def: Pick<WorldTerrainDef, "tileQuads" | "spacing">): number {
  return def.tileQuads * def.spacing;
}

export interface TerrainWorldBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function terrainWorldBounds(
  def: Pick<WorldTerrainDef, "tileQuads" | "spacing" | "tilesX" | "tilesZ" | "origin">,
): TerrainWorldBounds {
  const tileSize = terrainTileWorldSize(def);
  return {
    minX: def.origin[0],
    minZ: def.origin[2],
    maxX: def.origin[0] + def.tilesX * tileSize,
    maxZ: def.origin[2] + def.tilesZ * tileSize,
  };
}

export function terrainTileWorldBounds(
  def: Pick<WorldTerrainDef, "tileQuads" | "spacing" | "origin">,
  x: number,
  z: number,
): TerrainWorldBounds {
  const tileSize = terrainTileWorldSize(def);
  const minX = def.origin[0] + x * tileSize;
  const minZ = def.origin[2] + z * tileSize;
  return { minX, minZ, maxX: minX + tileSize, maxZ: minZ + tileSize };
}

/**
 * World X/Z → global vertex-grid coordinates (fractional). Global grid index
 * `g` belongs to tile `floor(g / tileQuads)`; the shared edge `g = k·tileQuads`
 * is owned by tile `k` (its min edge), except the far edge of the world, which
 * the last tile owns.
 */
export function terrainGridCoord(
  def: Pick<WorldTerrainDef, "spacing" | "origin">,
  worldX: number,
  worldZ: number,
): { gx: number; gz: number } {
  return {
    gx: (worldX - def.origin[0]) / def.spacing,
    gz: (worldZ - def.origin[2]) / def.spacing,
  };
}

/** A blank tile: flat at height 0, layer 0 fully weighted (the base layer). */
export function createFlatTerrainTile(
  def: Pick<WorldTerrainDef, "tileQuads" | "layers">,
  x: number,
  z: number,
  height = 0,
): TerrainTileData {
  const size = def.tileQuads + 1;
  const count = size * size;
  const layerCount = Math.min(def.layers.length, TERRAIN_MAX_LAYERS);
  const weights = new Uint8Array(terrainWeightBlockCount(layerCount) * count * 4);
  if (layerCount > 0) {
    for (let index = 0; index < count; index += 1) weights[index * 4] = 255;
  }
  return { x, z, size, heights: new Float32Array(count).fill(height), layerCount, weights };
}

/** Reads layer `layer`'s weight (`0..1`) at vertex `index` of a tile. */
export function terrainTileLayerWeight(tile: TerrainTileData, layer: number, index: number): number {
  if (layer < 0 || layer >= tile.layerCount) return 0;
  const block = Math.floor(layer / TERRAIN_LAYERS_PER_WEIGHT_BLOCK);
  const channel = layer % TERRAIN_LAYERS_PER_WEIGHT_BLOCK;
  const offset = block * tile.size * tile.size * 4 + index * 4 + channel;
  return (tile.weights[offset] ?? 0) / 255;
}

/** Height bounds of a tile's samples; `{0, 0}` for an empty array. */
export function terrainTileHeightRange(tile: Pick<TerrainTileData, "heights">): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const height of tile.heights) {
    if (height < min) min = height;
    if (height > max) max = height;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}
