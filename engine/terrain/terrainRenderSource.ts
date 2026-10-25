import type { ForgeLandscapeData } from "../scene/landscape";
import type { TerrainDirtyRect } from "./terrainEdit";
import type { Vec3 } from "../scene/layout";
import {
  TerrainTileMap,
  invalidateTerrainTileRange,
  raycastTerrain,
  type TerrainQueryDef,
  type TerrainRayHit,
} from "./terrainHeightQuery";
import type { TerrainNodeHeights } from "./terrainLod";
import type { WorldTerrainDocument } from "./terrainLoader";
import {
  TERRAIN_LAYERS_PER_WEIGHT_BLOCK,
  TERRAIN_MAX_LAYERS,
  TERRAIN_MAX_TILE_QUADS,
  TERRAIN_MIN_TILE_QUADS,
  terrainTileHeightRange,
  terrainTileWorldSize,
  terrainWeightBlockCount,
  type TerrainTileData,
} from "./terrainTypes";

/**
 * What the GPU terrain renderer draws (OPEN_WORLD_PLAN Faz 2): a tile grid in
 * the renderer's local frame plus the drawn footprint. A World Terrain document
 * maps 1:1. A legacy Landscape becomes one padded tile: its grid is copied into
 * the next power-of-two tile, the padding repeats the edge samples, and
 * `extentX/extentZ` clip drawing (and raycasts) to the authored footprint — so
 * non-square, non-power-of-two and rotated legacy landscapes render exactly as
 * authored, without resampling.
 *
 * Pure data (no three.js), shared by the renderer, its raycast and the tests.
 */
export interface TerrainRenderSource {
  def: TerrainQueryDef;
  tiles: TerrainTileMap;
  /** Drawn footprint, metres from `def.origin` along X/Z. */
  extentX: number;
  extentZ: number;
  /** Paint layers carried by every tile (`0..TERRAIN_MAX_LAYERS`). */
  layerCount: number;
  /** Authored vertex grid of a legacy source; absent for World Terrain. */
  legacyGrid?: { verticesX: number; verticesZ: number };
}

function legacyTileQuads(quads: number): number {
  let value = TERRAIN_MIN_TILE_QUADS;
  while (value < quads && value < TERRAIN_MAX_TILE_QUADS) value *= 2;
  if (value < quads) throw new Error(`Landscape grid of ${quads} quads exceeds the largest terrain tile (${TERRAIN_MAX_TILE_QUADS})`);
  return value;
}

function weight255(value: number | undefined): number {
  const weight = value ?? 0;
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0)) * 255);
}

/**
 * Legacy Landscape → padded 1×1 source in the landscape actor's local frame
 * (the grid is centred on the actor, so `origin` is `[-halfX, 0, -halfZ]`).
 * `heightScale` is folded into the heights; layers beyond eight are not drawn.
 */
export function landscapeRenderSource(data: ForgeLandscapeData): TerrainRenderSource {
  const { verticesX, verticesZ, spacing } = data.size;
  const tileQuads = legacyTileQuads(Math.max(verticesX, verticesZ) - 1);
  const size = tileQuads + 1;
  const layerCount = Math.min(data.layers.length, TERRAIN_MAX_LAYERS);
  const tile: TerrainTileData = {
    x: 0,
    z: 0,
    size,
    heights: new Float32Array(size * size),
    layerCount,
    weights: new Uint8Array(terrainWeightBlockCount(layerCount) * size * size * 4),
  };
  const source: TerrainRenderSource = {
    def: {
      tileQuads,
      spacing,
      tilesX: 1,
      tilesZ: 1,
      origin: [-((verticesX - 1) * spacing) / 2, 0, -((verticesZ - 1) * spacing) / 2],
    },
    tiles: new TerrainTileMap(),
    extentX: (verticesX - 1) * spacing,
    extentZ: (verticesZ - 1) * spacing,
    layerCount,
    legacyGrid: { verticesX, verticesZ },
  };
  source.tiles.set(tile);
  writeLandscapeRegion(source, data, { x0: 0, x1: verticesX - 1, z0: 0, z1: verticesZ - 1 });
  return source;
}

/**
 * Copies an edited legacy vertex rectangle into the padded tile, refreshing the
 * padding the rectangle drives. Returns the tile texel rectangle to re-upload.
 */
export function writeLandscapeRegion(
  source: TerrainRenderSource,
  data: ForgeLandscapeData,
  dirty: TerrainDirtyRect,
): TerrainDirtyRect {
  const grid = source.legacyGrid;
  const tile = source.tiles.tile(0, 0);
  if (!grid || !tile) throw new Error("writeLandscapeRegion needs a legacy landscape render source");
  if (data.size.verticesX !== grid.verticesX || data.size.verticesZ !== grid.verticesZ) {
    throw new Error("Landscape grid changed shape; rebuild the render source");
  }
  const { verticesX, verticesZ } = grid;
  const x0 = Math.max(0, Math.floor(dirty.x0));
  const z0 = Math.max(0, Math.floor(dirty.z0));
  const x1 = Math.min(verticesX - 1, Math.ceil(dirty.x1));
  const z1 = Math.min(verticesZ - 1, Math.ceil(dirty.z1));
  // Padding repeats the last row/column, so an edit on that edge drives it too.
  const px1 = x1 === verticesX - 1 ? tile.size - 1 : x1;
  const pz1 = z1 === verticesZ - 1 ? tile.size - 1 : z1;
  if (x0 > x1 || z0 > z1) return { x0: 0, x1: -1, z0: 0, z1: -1 };
  const heightScale = data.size.heightScale;
  const count = tile.size * tile.size;
  const layers = data.layers.slice(0, source.layerCount);
  for (let z = z0; z <= pz1; z += 1) {
    const sz = Math.min(z, verticesZ - 1);
    for (let x = x0; x <= px1; x += 1) {
      const sx = Math.min(x, verticesX - 1);
      const from = sz * verticesX + sx;
      const to = z * tile.size + x;
      const height = (data.heights[from] ?? 0) * heightScale;
      tile.heights[to] = Number.isFinite(height) ? height : 0;
      layers.forEach((layer, index) => {
        const block = Math.floor(index / TERRAIN_LAYERS_PER_WEIGHT_BLOCK);
        tile.weights[block * count * 4 + to * 4 + (index % TERRAIN_LAYERS_PER_WEIGHT_BLOCK)] = weight255(layer.weights[from]);
      });
    }
  }
  invalidateTerrainTileRange(tile);
  return { x0, x1: px1, z0, z1: pz1 };
}

/** A World Terrain document in world space; the whole grid is drawn. */
export function worldTerrainRenderSource({ def, tiles }: WorldTerrainDocument): TerrainRenderSource {
  const map = new TerrainTileMap();
  for (const tile of tiles.values()) map.set(tile);
  const tileSize = terrainTileWorldSize(def);
  return {
    def: { tileQuads: def.tileQuads, spacing: def.spacing, tilesX: def.tilesX, tilesZ: def.tilesZ, origin: [...def.origin] },
    tiles: map,
    extentX: def.tilesX * tileSize,
    extentZ: def.tilesZ * tileSize,
    layerCount: Math.min(def.layers.length, TERRAIN_MAX_LAYERS),
  };
}

/**
 * Conservative CDLOD node height bounds (relative to `origin[1]`) from the
 * height ranges of the tiles a node covers. Call `invalidate(tile)` after an
 * in-place edit; missing tiles contribute nothing.
 */
export function terrainRenderNodeHeights(source: TerrainRenderSource, leafSize: number): TerrainNodeHeights & {
  invalidate(tile?: TerrainTileData): void;
} {
  const ranges = new Map<TerrainTileData, { min: number; max: number }>();
  const tileSize = terrainTileWorldSize(source.def);
  const rangeOf = (tile: TerrainTileData): { min: number; max: number } => {
    let range = ranges.get(tile);
    if (!range) {
      range = terrainTileHeightRange(tile);
      ranges.set(tile, range);
    }
    return range;
  };
  const heights = ((level: number, ix: number, iz: number) => {
    const size = leafSize * 2 ** level;
    const tx0 = Math.floor((ix * size) / tileSize);
    const tz0 = Math.floor((iz * size) / tileSize);
    const tx1 = Math.min(source.def.tilesX - 1, Math.max(tx0, Math.ceil(((ix + 1) * size) / tileSize) - 1));
    const tz1 = Math.min(source.def.tilesZ - 1, Math.max(tz0, Math.ceil(((iz + 1) * size) / tileSize) - 1));
    let min = Infinity;
    let max = -Infinity;
    for (let tz = tz0; tz <= tz1; tz += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tile = source.tiles.tile(tx, tz);
        if (!tile) continue;
        const range = rangeOf(tile);
        min = Math.min(min, range.min);
        max = Math.max(max, range.max);
      }
    }
    return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
  }) as TerrainNodeHeights & { invalidate(tile?: TerrainTileData): void };
  heights.invalidate = (tile) => {
    if (tile) ranges.delete(tile);
    else ranges.clear();
  };
  return heights;
}

/** Height bounds of the whole source (relative to `origin[1]`), `{0, 0}` when empty. */
export function terrainRenderSourceHeightRange(source: TerrainRenderSource): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const tile of source.tiles.values()) {
    const range = terrainTileHeightRange(tile);
    min = Math.min(min, range.min);
    max = Math.max(max, range.max);
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/**
 * {@link raycastTerrain} limited to the drawn footprint, so a ray never hits a
 * padded legacy tile's invisible margin. Same frame and units as the source.
 */
export function raycastTerrainRenderSource(
  source: TerrainRenderSource,
  origin: Vec3,
  direction: Vec3,
  maxDistance = Infinity,
): TerrainRayHit | null {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const dir: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];
  let enter = 0;
  let exit = maxDistance;
  for (const [axis, extent] of [[0, source.extentX], [2, source.extentZ]] as const) {
    const lo = source.def.origin[axis];
    const hi = lo + extent;
    if (Math.abs(dir[axis]) < 1e-12) {
      if (origin[axis] < lo || origin[axis] > hi) return null;
      continue;
    }
    const t0 = (lo - origin[axis]) / dir[axis];
    const t1 = (hi - origin[axis]) / dir[axis];
    enter = Math.max(enter, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
  }
  if (!(enter <= exit)) return null;
  const start: Vec3 = [origin[0] + dir[0] * enter, origin[1] + dir[1] * enter, origin[2] + dir[2] * enter];
  const hit = raycastTerrain(source.def, source.tiles, start, dir, exit - enter);
  return hit ? { ...hit, distance: hit.distance + enter } : null;
}
