import {
  editLandscapeBrushWeights,
  landscapeBrushAverage,
  landscapeBrushFalloff,
  nextLandscapeBrushHeight,
  type LandscapeHeightBrushMode,
  type LandscapeWeightBrushMode,
} from "../scene/landscapeBrush";
import { invalidateTerrainTileRange, type TerrainTileLookup } from "./terrainHeightQuery";
import {
  TERRAIN_MAX_LAYERS,
  terrainTileHeightRange,
  terrainTileLayerWeight,
  terrainWeightBlockCount,
  tileKey,
  type TerrainTileData,
  type WorldTerrainDef,
} from "./terrainTypes";

/** Inclusive tile-local vertex bounds, also used for rectangular texture uploads. */
export interface TerrainDirtyRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface TerrainEditWorld extends TerrainTileLookup {
  def: WorldTerrainDef;
  tiles: Map<string, TerrainTileData>;
}

interface TerrainBrushBase {
  /** World-space horizontal centre; radius is in metres. */
  x: number;
  z: number;
  radius: number;
  strength: number;
  falloff: number;
}

export type TerrainBrush = TerrainBrushBase & (
  | { mode: LandscapeHeightBrushMode; hitHeight?: number; flattenTargetHeight?: number }
  | { mode: LandscapeWeightBrushMode; layer: number }
);

export interface TerrainPatchValues {
  heights: Float32Array;
  /** Rectangle-sized RGBA8 blocks, in the same block order as TerrainTileData. */
  weights: Uint8Array;
}

export interface TerrainUndoPatch {
  key: string;
  rect: TerrainDirtyRect;
  before: TerrainPatchValues;
  after: TerrainPatchValues;
}

export interface TerrainBrushResult {
  dirty: Map<string, TerrainDirtyRect>;
  patches: TerrainUndoPatch[];
}

export function mergeTerrainDirtyRects(a: TerrainDirtyRect, b: TerrainDirtyRect): TerrainDirtyRect {
  return { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1) };
}

function refreshSummary(world: TerrainEditWorld, key: string, tile: TerrainTileData): void {
  const range = terrainTileHeightRange(tile);
  const summary = world.def.tiles.find((entry) => entry.key === key)!;
  summary.minHeight = range.min;
  summary.maxHeight = range.max;
  invalidateTerrainTileRange(tile);
}

/** Owns arrays and summaries; decoded inputs and their definition remain untouched. */
export function createTerrainEditWorld(def: WorldTerrainDef, decoded: Iterable<TerrainTileData>): TerrainEditWorld {
  if (def.layers.length > TERRAIN_MAX_LAYERS) throw new Error("Editable terrain supports at most eight layers");
  const tiles = new Map<string, TerrainTileData>();
  const world: TerrainEditWorld = { def: structuredClone(def), tiles, tile: (x, z) => tiles.get(tileKey(x, z)) };
  for (const source of decoded) {
    const key = tileKey(source.x, source.z);
    const count = source.size * source.size;
    if (!def.tiles.some((entry) => entry.key === key) || tiles.has(key)
      || source.x < 0 || source.z < 0 || source.x >= def.tilesX || source.z >= def.tilesZ
      || source.size !== def.tileQuads + 1 || source.layerCount !== def.layers.length
      || source.heights.length !== count || !source.heights.every(Number.isFinite)
      || source.weights.length !== terrainWeightBlockCount(source.layerCount) * count * 4) {
      throw new Error(`Invalid editable terrain tile ${key}`);
    }
    const tile: TerrainTileData = { ...source, heights: source.heights.slice(), weights: source.weights.slice() };
    tiles.set(key, tile);
    refreshSummary(world, key, tile);
  }
  return world;
}

interface VertexCopy { tile: TerrainTileData; index: number; x: number; z: number }

/** Positive-side owner first, matching terrainHeightAt, then all resident edge copies. */
function vertexCopies(world: TerrainEditWorld, gx: number, gz: number, required: ReadonlySet<string>): VertexCopy[] {
  const { tileQuads: q, tilesX, tilesZ } = world.def;
  if (gx < 0 || gz < 0 || gx > tilesX * q || gz > tilesZ * q) return [];
  const tx = Math.min(Math.floor(gx / q), tilesX - 1);
  const tz = Math.min(Math.floor(gz / q), tilesZ - 1);
  const xs = tx > 0 && gx === tx * q ? [tx, tx - 1] : [tx];
  const zs = tz > 0 && gz === tz * q ? [tz, tz - 1] : [tz];
  const copies: VertexCopy[] = [];
  for (const z of zs) {
    for (const x of xs) {
      const tile = world.tile(x, z);
      if (!tile && required.has(tileKey(x, z))) throw new Error(`Terrain brush tile is not resident: ${tileKey(x, z)}`);
      if (tile) copies.push({ tile, x: gx - x * q, z: gz - z * q, index: (gz - z * q) * tile.size + gx - x * q });
    }
  }
  return copies;
}

function weightOffset(tile: TerrainTileData, index: number, layer: number): number {
  return Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4;
}

/** Legacy four-decimal normalization, quantized with largest remainders to exactly 255. */
function quantizeWeights(weights: number[]): Uint8Array {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    const bytes = new Uint8Array(weights.length);
    if (weights.length > 0) bytes[0] = 255;
    return bytes;
  }
  const scaled = weights.map((weight) => weight / total * 255);
  const bytes = Uint8Array.from(scaled, Math.floor);
  const order = scaled.map((weight, index) => ({ index, remainder: weight - bytes[index]! }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let remaining = 255 - bytes.reduce((sum, weight) => sum + weight, 0);
  for (const { index } of order) {
    if (remaining-- <= 0) break;
    bytes[index] = bytes[index]! + 1;
  }
  return bytes;
}

function readRect(tile: TerrainTileData, rect: TerrainDirtyRect): TerrainPatchValues {
  const width = rect.x1 - rect.x0 + 1;
  const count = width * (rect.z1 - rect.z0 + 1);
  const heights = new Float32Array(count);
  const weights = new Uint8Array(count * 4 * terrainWeightBlockCount(tile.layerCount));
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    const src = z * tile.size + rect.x0;
    const dst = (z - rect.z0) * width;
    heights.set(tile.heights.subarray(src, src + width), dst);
    for (let block = 0; block < terrainWeightBlockCount(tile.layerCount); block += 1) {
      const offset = block * tile.size * tile.size * 4 + src * 4;
      weights.set(tile.weights.subarray(offset, offset + width * 4), block * count * 4 + dst * 4);
    }
  }
  return { heights, weights };
}

function writeRect(tile: TerrainTileData, rect: TerrainDirtyRect, values: TerrainPatchValues): void {
  const width = rect.x1 - rect.x0 + 1;
  const count = width * (rect.z1 - rect.z0 + 1);
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    const src = (z - rect.z0) * width;
    const dst = z * tile.size + rect.x0;
    tile.heights.set(values.heights.subarray(src, src + width), dst);
    for (let block = 0; block < terrainWeightBlockCount(tile.layerCount); block += 1) {
      const offset = block * count * 4 + src * 4;
      tile.weights.set(values.weights.subarray(offset, offset + width * 4), block * tile.size * tile.size * 4 + dst * 4);
    }
  }
}

/**
 * One dab over resident tiles. Missing declared tiles in the footprint or
 * smoothing halo reject the dab before any writes; holes are skipped.
 * Heights/flatten targets are metres relative to def.origin[1].
 * Stage changes before writing so smooth always reads the pre-dab surface,
 * independent of tile iteration order, without cloning entire tiles.
 */
export function applyTerrainBrush(world: TerrainEditWorld, brush: TerrainBrush): TerrainBrushResult {
  if (![brush.x, brush.z, brush.radius, brush.strength, brush.falloff].every(Number.isFinite)
    || brush.radius <= 0 || brush.strength < 0 || brush.falloff < 0) throw new Error("Invalid terrain brush");
  const paint = brush.mode === "paint" || brush.mode === "erase" || brush.mode === "smoothWeights";
  if (paint && (!Number.isInteger(brush.layer) || brush.layer < 0 || brush.layer >= world.def.layers.length)) {
    throw new Error("Invalid terrain brush layer");
  }
  const { tileQuads: q, spacing, origin, tilesX, tilesZ } = world.def;
  const cx = (brush.x - origin[0]) / spacing;
  const cz = (brush.z - origin[2]) / spacing;
  const reach = brush.radius / spacing;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(tilesX * q, Math.ceil(cx + reach));
  const z0 = Math.max(0, Math.floor(cz - reach));
  const z1 = Math.min(tilesZ * q, Math.ceil(cz + reach));
  const dirty = new Map<string, TerrainDirtyRect>();
  const required = new Set(world.def.tiles.map((entry) => entry.key));
  const changes: { copy: VertexCopy; height: number; weights: Uint8Array | undefined }[] = [];
  for (let gz = z0; gz <= z1; gz += 1) {
    for (let gx = x0; gx <= x1; gx += 1) {
      const influence = landscapeBrushFalloff(Math.hypot(origin[0] + gx * spacing - brush.x, origin[2] + gz * spacing - brush.z), brush.radius, brush.falloff);
      if (influence <= 0) continue;
      const copies = vertexCopies(world, gx, gz, required);
      const owner = copies[0];
      if (!owner) continue;
      const current = owner.tile.heights[owner.index]!;
      let height = current;
      let weights: Uint8Array | undefined;
      if ("layer" in brush) {
        const values = Array.from({ length: owner.tile.layerCount }, (_, layer) => terrainTileLayerWeight(owner.tile, layer, owner.index));
        editLandscapeBrushWeights(values, brush.mode, brush.layer, brush.strength * influence,
          (layer) => landscapeBrushAverage((dx, dz) => {
            const neighbour = vertexCopies(world, gx + dx, gz + dz, required)[0];
            return neighbour ? terrainTileLayerWeight(neighbour.tile, layer, neighbour.index) : undefined;
          }, values[layer] ?? 0));
        weights = quantizeWeights(values);
      } else {
        const target = Number.isFinite(brush.flattenTargetHeight) ? brush.flattenTargetHeight! : brush.hitHeight ?? 0;
        if (!Number.isFinite(target)) throw new Error("Invalid terrain flatten height");
        const after = nextLandscapeBrushHeight(brush.mode, current, target, brush.strength * influence,
          () => landscapeBrushAverage((dx, dz) => {
            const neighbour = vertexCopies(world, gx + dx, gz + dz, required)[0];
            return neighbour?.tile.heights[neighbour.index];
          }, current));
        if (Math.abs(after - current) > 0.000001) height = Math.fround(Math.round(after * 10_000) / 10_000);
        if (!Number.isFinite(height)) throw new Error("Terrain brush height overflow");
      }
      for (const copy of copies) {
        const changed = paint
          ? weights!.some((weight, layer) => weight !== copy.tile.weights[weightOffset(copy.tile, copy.index, layer)])
          : !Object.is(height, copy.tile.heights[copy.index]);
        if (!changed) continue;
        changes.push({ copy, height: paint ? copy.tile.heights[copy.index]! : height, weights });
        const key = tileKey(copy.tile.x, copy.tile.z);
        const rect = { x0: copy.x, x1: copy.x, z0: copy.z, z1: copy.z };
        dirty.set(key, dirty.has(key) ? mergeTerrainDirtyRects(dirty.get(key)!, rect) : rect);
      }
    }
  }
  const patches = [...dirty].map(([key, rect]) => ({ key, rect, before: readRect(world.tiles.get(key)!, rect) }));
  for (const { copy, height, weights } of changes) {
    copy.tile.heights[copy.index] = height;
    weights?.forEach((weight, layer) => { copy.tile.weights[weightOffset(copy.tile, copy.index, layer)] = weight; });
  }
  return { dirty, patches: patches.map((patch) => {
    const tile = world.tiles.get(patch.key)!;
    refreshSummary(world, patch.key, tile);
    return { ...patch, after: readRect(tile, patch.rect) };
  }) };
}

function restorePatches(world: TerrainEditWorld, patches: readonly TerrainUndoPatch[], side: "before" | "after"): Map<string, TerrainDirtyRect> {
  for (const patch of patches) {
    if (!world.tiles.has(patch.key)) throw new Error(`Terrain undo tile is not resident: ${patch.key}`);
  }
  const dirty = new Map<string, TerrainDirtyRect>();
  const ordered = side === "before" ? [...patches].reverse() : patches;
  for (const patch of ordered) {
    const tile = world.tiles.get(patch.key)!;
    writeRect(tile, patch.rect, patch[side]);
    refreshSummary(world, patch.key, tile);
    dirty.set(patch.key, dirty.has(patch.key) ? mergeTerrainDirtyRects(dirty.get(patch.key)!, patch.rect) : patch.rect);
  }
  return dirty;
}

export function applyTerrainUndoPatches(world: TerrainEditWorld, patches: readonly TerrainUndoPatch[]): Map<string, TerrainDirtyRect> {
  return restorePatches(world, patches, "after");
}

export function revertTerrainUndoPatches(world: TerrainEditWorld, patches: readonly TerrainUndoPatch[]): Map<string, TerrainDirtyRect> {
  return restorePatches(world, patches, "before");
}
