import type { ForgeLandscapeData } from "../scene/landscape";
import { buildTerrainGlobalMap, updateTerrainGlobalMap, type TerrainGlobalMap } from "./terrainGlobalMap";
import type { TerrainQueryDef, TerrainTileLookup } from "./terrainHeightQuery";
import {
  TERRAIN_PATCH_QUADS,
  TERRAIN_RENDER_LAYERS,
  TERRAIN_WEIGHT_BLOCKS,
  TerrainNodeHeightBounds,
  clampTerrainRect,
  copyLandscapeHeights,
  fullTerrainRect,
  packTerrainWeights,
  terrainRenderGrid,
  type TerrainRenderGrid,
  type TerrainVertexRect,
} from "./terrainRenderData";
import { parseTileKey, tileKey, type TerrainTileData, type WorldTerrainDef } from "./terrainTypes";

/**
 * What the CDLOD renderer draws (OPEN_WORLD_PLAN Faz 2): a grid of square
 * tiles in a "terrain-local" frame whose (0, 0) is tile (0, 0)'s min corner and
 * whose heights are relative to the datum. A multi-tile World Terrain is one
 * directly; a legacy 1×1 Landscape is one padded tile ({@link landscapeRenderSource}).
 *
 * Also the CPU half of the far-terrain path: per-node height bounds across all
 * tiles and the global map's normals, hole flags and weights. Pure, so the
 * engine tests cover it without a GL context.
 */
export interface TerrainRenderSource extends TerrainTileLookup {
  readonly globalAttributes?: TerrainGlobalAttributes | undefined;
  /** Quads per tile edge, a power of two of at least one patch. */
  readonly tileQuads: number;
  readonly spacing: number;
  readonly tilesX: number;
  readonly tilesZ: number;
  /** Terrain-local X/Z edge lengths that are drawn and picked; at most the tile grid. */
  readonly extent: readonly [number, number];
  /** Keys of the tiles that exist; a grid cell without one is a hole. */
  keys(): readonly string[];
}

export type TerrainWorldShape = Pick<WorldTerrainDef, "tileQuads" | "spacing" | "tilesX" | "tilesZ">;

/** A World Terrain's tiles as a render source. */
export function worldTerrainRenderSource(def: TerrainWorldShape, tiles: ReadonlyMap<string, TerrainTileData>, globalAttributes?: TerrainGlobalAttributes): TerrainRenderSource {
  const size = def.tileQuads * def.spacing;
  return {
    globalAttributes,
    tileQuads: def.tileQuads,
    spacing: def.spacing,
    tilesX: def.tilesX,
    tilesZ: def.tilesZ,
    extent: [def.tilesX * size, def.tilesZ * size],
    keys: () => [...tiles.keys()],
    tile: (x, z) => tiles.get(tileKey(x, z)),
  };
}

/** A legacy Landscape drawn as one padded tile; `refresh` re-reads an edited rectangle. */
export interface LandscapeRenderSource extends TerrainRenderSource {
  readonly grid: TerrainRenderGrid;
  /** Re-reads authored heights/weights inside `rect`; returns the tile texels it changed (padding included). */
  refresh(rect: TerrainVertexRect): TerrainVertexRect;
}

export function landscapeRenderSource(data: ForgeLandscapeData): LandscapeRenderSource {
  const grid = terrainRenderGrid(data.size);
  const texels = grid.stride * grid.stride;
  const tile: TerrainTileData = {
    x: 0, z: 0, size: grid.stride,
    heights: new Float32Array(texels),
    layerCount: TERRAIN_RENDER_LAYERS,
    weights: new Uint8Array(texels * 4 * TERRAIN_WEIGHT_BLOCKS),
  };
  const refresh = (rect: TerrainVertexRect): TerrainVertexRect => {
    const area = clampTerrainRect(rect, grid);
    copyLandscapeHeights(data, grid, tile.heights, area);
    packTerrainWeights(data, grid, tile.weights, area);
    const last = grid.stride - 1;
    return {
      x0: area.x0, z0: area.z0,
      x1: area.x1 === grid.verticesX - 1 ? last : area.x1,
      z1: area.z1 === grid.verticesZ - 1 ? last : area.z1,
    };
  };
  refresh(fullTerrainRect(grid));
  return {
    grid, refresh,
    tileQuads: grid.stride - 1,
    spacing: data.size.spacing,
    tilesX: 1,
    tilesZ: 1,
    extent: [(grid.verticesX - 1) * data.size.spacing, (grid.verticesZ - 1) * data.size.spacing],
    keys: () => [tileKey(0, 0)],
    tile: (x, z) => (x === 0 && z === 0 ? tile : undefined),
  };
}

/** The query shape of a source: terrain-local frame, heights relative to the datum. */
export function terrainSourceQueryDef(source: TerrainRenderSource): TerrainQueryDef {
  return { tileQuads: source.tileQuads, spacing: source.spacing, tilesX: source.tilesX, tilesZ: source.tilesZ, origin: [0, 0, 0] };
}

/** Owning tile + local index of a global vertex; seam vertices fall back to the neighbour's copy. */
function vertexIndex(source: TerrainRenderSource, gx: number, gz: number): { tile: TerrainTileData; index: number } | null {
  const q = source.tileQuads;
  if (gx < 0 || gz < 0 || gx > source.tilesX * q || gz > source.tilesZ * q) return null;
  const candidates = (g: number, count: number) => {
    const owner = Math.min(Math.floor(g / q), count - 1);
    return g % q === 0 && owner > 0 && owner * q === g ? [owner, owner - 1] : [owner];
  };
  for (const tz of candidates(gz, source.tilesZ)) {
    for (const tx of candidates(gx, source.tilesX)) {
      const tile = source.tile(tx, tz);
      if (tile) return { tile, index: (gz - tz * q) * tile.size + (gx - tx * q) };
    }
  }
  return null;
}

/** Height of a global vertex, or null past the grid or over a hole. */
export function terrainVertexHeight(source: TerrainRenderSource, gx: number, gz: number): number | null {
  const at = vertexIndex(source, gx, gz);
  return at ? at.tile.heights[at.index]! : null;
}

/**
 * Normal X/Z of one global vertex (Y implied up) from central differences
 * across tile seams; a missing neighbour (grid edge, hole) clamps to the vertex
 * itself, the same rule as the original Landscape mesh.
 */
function vertexNormal(source: TerrainRenderSource, gx: number, gz: number, center: number): [number, number] {
  const at = (x: number, z: number) => terrainVertexHeight(source, x, z) ?? center;
  const dx = at(gx - 1, gz) - at(gx + 1, gz);
  const dz = at(gx, gz - 1) - at(gx, gz + 1);
  const length = Math.sqrt(dx * dx + 4 * source.spacing * source.spacing + dz * dz) || 1;
  return [dx / length, dz / length];
}

/** Normals (X/Z pairs, tile-local layout) of tile `key` inside `rect`, continuous across seams. */
export function computeTileNormals(
  source: TerrainRenderSource,
  key: string,
  out: Float32Array,
  rect?: TerrainVertexRect,
): void {
  const coord = parseTileKey(key)!;
  const tile = source.tile(coord.x, coord.z);
  if (!tile) throw new Error(`terrain render source has no tile ${key}`);
  const { size, heights } = tile;
  const area = rect ?? { x0: 0, x1: size - 1, z0: 0, z1: size - 1 };
  const flat = 4 * source.spacing * source.spacing;
  const gx0 = coord.x * source.tileQuads;
  const gz0 = coord.z * source.tileQuads;
  for (let z = area.z0; z <= area.z1; z += 1) {
    for (let x = area.x0; x <= area.x1; x += 1) {
      const index = z * size + x;
      let nx: number;
      let nz: number;
      if (x > 0 && z > 0 && x < size - 1 && z < size - 1) {
        // Interior: every neighbour is in this tile.
        const dx = heights[index - 1]! - heights[index + 1]!;
        const dz = heights[index - size]! - heights[index + size]!;
        const length = Math.sqrt(dx * dx + flat + dz * dz) || 1;
        nx = dx / length;
        nz = dz / length;
      } else {
        [nx, nz] = vertexNormal(source, gx0 + x, gz0 + z, heights[index]!);
      }
      out[index * 2] = nx;
      out[index * 2 + 1] = nz;
    }
  }
}

/**
 * Min/max height of every CDLOD node of a multi-tile grid. Levels up to the
 * tile level read per-tile pyramids; levels above aggregate whole tiles. A hole
 * reports the whole grid's range so a node box over it stays conservative.
 */
export class TerrainWorldHeightBounds {
  readonly tileLevel: number;
  private readonly tiles = new Map<string, TerrainNodeHeightBounds>();
  private upper: { nx: number; nz: number; min: Float32Array; max: Float32Array }[] = [];

  constructor(private readonly source: TerrainRenderSource, patchQuads = TERRAIN_PATCH_QUADS) {
    this.tileLevel = Math.log2(source.tileQuads / patchQuads);
    for (const key of source.keys()) {
      const { x, z } = parseTileKey(key)!;
      const tile = source.tile(x, z)!;
      this.tiles.set(key, new TerrainNodeHeightBounds(tile.heights, tile.size, patchQuads));
    }
    this.rebuildUpper();
  }

  /** Re-reads `rect` (tile-local vertices) of tile `key` after an edit. */
  updateTile(key: string, rect: TerrainVertexRect): void {
    this.tiles.get(key)?.update(rect);
    this.rebuildUpper();
  }

  node(level: number, ix: number, iz: number): { min: number; max: number } {
    if (level <= this.tileLevel) {
      const span = 2 ** (this.tileLevel - level);
      const tx = Math.floor(ix / span);
      const tz = Math.floor(iz / span);
      const bounds = this.tiles.get(tileKey(tx, tz));
      return bounds ? bounds.node(level, ix - tx * span, iz - tz * span) : this.range();
    }
    const entry = this.upper[Math.min(level - this.tileLevel, this.upper.length - 1)]!;
    const index = Math.min(iz, entry.nz - 1) * entry.nx + Math.min(ix, entry.nx - 1);
    return { min: entry.min[index]!, max: entry.max[index]! };
  }

  range(): { min: number; max: number } {
    const top = this.upper[this.upper.length - 1]!;
    return { min: top.min[0]!, max: top.max[0]! };
  }

  /** Level `tileLevel + k` holds one entry per 2^k × 2^k tiles; index 0 is the tile level itself. */
  private rebuildUpper(): void {
    const { tilesX, tilesZ } = this.source;
    const base = { nx: tilesX, nz: tilesZ, min: new Float32Array(tilesX * tilesZ).fill(Infinity), max: new Float32Array(tilesX * tilesZ).fill(-Infinity) };
    for (const [key, bounds] of this.tiles) {
      const { x, z } = parseTileKey(key)!;
      const range = bounds.range();
      base.min[z * tilesX + x] = range.min;
      base.max[z * tilesX + x] = range.max;
    }
    this.upper = [base];
    while (this.upper[this.upper.length - 1]!.nx > 1 || this.upper[this.upper.length - 1]!.nz > 1) {
      const below = this.upper[this.upper.length - 1]!;
      const nx = Math.ceil(below.nx / 2);
      const nz = Math.ceil(below.nz / 2);
      const min = new Float32Array(nx * nz).fill(Infinity);
      const max = new Float32Array(nx * nz).fill(-Infinity);
      for (let z = 0; z < below.nz; z += 1) {
        for (let x = 0; x < below.nx; x += 1) {
          const target = (z >> 1) * nx + (x >> 1);
          min[target] = Math.min(min[target]!, below.min[z * below.nx + x]!);
          max[target] = Math.max(max[target]!, below.max[z * below.nx + x]!);
        }
      }
      this.upper.push({ nx, nz, min, max });
    }
    // Holes keep ±Infinity until here; give them the grid's finite range.
    const top = this.upper[this.upper.length - 1]!;
    const all = { min: Number.isFinite(top.min[0]!) ? top.min[0]! : 0, max: Number.isFinite(top.max[0]!) ? top.max[0]! : 0 };
    for (const level of this.upper) {
      for (let index = 0; index < level.min.length; index += 1) {
        if (!Number.isFinite(level.min[index]!)) level.min[index] = all.min;
        if (!Number.isFinite(level.max[index]!)) level.max[index] = all.max;
      }
    }
  }
}

/**
 * The far-terrain map: one sample per vertex of the grid one LOD level above a
 * tile (`stride = 2 · tileQuads / patchQuads`), so a fully morphed tile-level
 * node lands exactly on it. Heights are point samples (`terrainGlobalMap.ts`);
 * normals and weights are the full-resolution vertex values at those points, so
 * the switch between a tile slot and the map does not shift lighting or paint.
 */
export interface TerrainGlobalAttributes {
  map: TerrainGlobalMap;
  /** Per sample: normal X, normal Z, hole flag (1 where no tile covers the sample). */
  normals: Float32Array;
  /** {@link TERRAIN_WEIGHT_BLOCKS} RGBA8 blocks of `width × height` texels, block-major. */
  weights: Uint8Array;
}

export function buildTerrainGlobalAttributes(source: TerrainRenderSource, patchQuads = TERRAIN_PATCH_QUADS): TerrainGlobalAttributes {
  const map = buildTerrainGlobalMap(terrainSourceQueryDef(source), source, patchQuads);
  const attributes: TerrainGlobalAttributes = {
    map,
    normals: new Float32Array(map.width * map.height * 3),
    weights: new Uint8Array(map.width * map.height * 4 * TERRAIN_WEIGHT_BLOCKS),
  };
  sampleAttributes(attributes, source, { x0: 0, x1: map.width - 1, z0: 0, z1: map.height - 1 });
  return attributes;
}

/**
 * Re-samples the map points inside tile `key`'s dirty vertex rectangle (whole
 * tile when omitted). Returns the global sample rectangle, or null if no
 * sample point lies inside.
 */
export function updateTerrainGlobalAttributes(
  attributes: TerrainGlobalAttributes,
  source: TerrainRenderSource,
  key: string,
  dirty?: TerrainVertexRect,
): TerrainVertexRect | null {
  // A height change also moves the normals one vertex around it.
  const grown = dirty ? clampTerrainRect(dirty, { verticesX: source.tileQuads + 1, verticesZ: source.tileQuads + 1 }, 1) : undefined;
  const rect = updateTerrainGlobalMap(attributes.map, terrainSourceQueryDef(source), source, key, grown);
  if (rect) sampleAttributes(attributes, source, rect);
  return rect;
}

function sampleAttributes(attributes: TerrainGlobalAttributes, source: TerrainRenderSource, rect: TerrainVertexRect): void {
  const { map } = attributes;
  const blockTexels = map.width * map.height;
  for (let sz = rect.z0; sz <= rect.z1; sz += 1) {
    for (let sx = rect.x0; sx <= rect.x1; sx += 1) {
      const sample = sz * map.width + sx;
      const gx = sx * map.stride;
      const gz = sz * map.stride;
      const at = vertexIndex(source, gx, gz);
      if (!at) {
        attributes.normals.set([0, 0, 1], sample * 3);
        for (let block = 0; block < TERRAIN_WEIGHT_BLOCKS; block += 1) attributes.weights.fill(0, (block * blockTexels + sample) * 4, (block * blockTexels + sample) * 4 + 4);
        continue;
      }
      const [nx, nz] = vertexNormal(source, gx, gz, at.tile.heights[at.index]!);
      attributes.normals.set([nx, nz, 0], sample * 3);
      const tileTexels = at.tile.size * at.tile.size;
      const blocks = Math.ceil(at.tile.layerCount / 4);
      for (let block = 0; block < TERRAIN_WEIGHT_BLOCKS; block += 1) {
        const target = (block * blockTexels + sample) * 4;
        if (block < blocks) {
          const from = (block * tileTexels + at.index) * 4;
          attributes.weights.set(at.tile.weights.subarray(from, from + 4), target);
        } else {
          attributes.weights.fill(0, target, target + 4);
        }
      }
    }
  }
}
