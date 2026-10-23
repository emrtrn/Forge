import type { Vec3 } from "../scene/layout";
import { normalizeWorldTerrain } from "./terrainDefinition";
import { decodeTerrainTile, encodeTerrainTile, TERRAIN_TILE_HEADER_BYTES } from "./terrainTileCodec";
import {
  createFlatTerrainTile, isValidTileQuads, TERRAIN_MAX_TILES_PER_AXIS, TERRAIN_SCHEMA, tileKey,
  type WorldTerrainDef, type WorldTerrainTileSummary,
} from "./terrainTypes";

export interface RawHeightmapImportOptions {
  bytes: ArrayBuffer | Uint8Array;
  width: number;
  height: number;
  endianness?: "little" | "big";
  heightMin: number;
  heightMax: number;
  tileQuads: number;
  spacing: number;
  origin: Vec3;
}

export interface RawHeightmapProgress {
  key: string;
  completed: number;
  total: number;
}

export interface RawHeightmapTile extends RawHeightmapProgress {
  bytes: Uint8Array;
  summary: WorldTerrainTileSummary;
}

export interface RawHeightmapImportResult {
  def: WorldTerrainDef;
  tiles: Map<string, Uint8Array>;
}

function rawAxisTiles(size: number, tileQuads: number, axis: string): number {
  const tiles = (size - 1) / tileQuads;
  if (!Number.isInteger(size) || !Number.isInteger(tiles) || tiles < 1 || tiles > TERRAIN_MAX_TILES_PER_AXIS) {
    const lower = Math.max(1, Math.min(TERRAIN_MAX_TILES_PER_AXIS, Math.floor(Number.isFinite(tiles) ? tiles : 1)));
    const upper = Math.max(1, Math.min(TERRAIN_MAX_TILES_PER_AXIS, Math.ceil(Number.isFinite(tiles) ? tiles : 1)));
    const sizes = Array.from(new Set([lower * tileQuads + 1, upper * tileQuads + 1]));
    throw new Error(`RAW ${axis} ${size}: (size - 1) must be a multiple of tileQuads ${tileQuads}, with 1..${TERRAIN_MAX_TILES_PER_AXIS} tiles; nearest valid sizes: ${sizes.join(" or ")}. Choose an explicit resolution; no resampling.`);
  }
  return tiles;
}

/**
 * Row-major u16 RAW: columns map to +X, rows to +Z, 0/65535 map to the
 * f32-rounded heightMin/heightMax relative to origin Y. Codes are copied without
 * a Float32 round-trip; even ranges narrower than Float32 precision stay lossless.
 * No paint layers are authored. The source must remain unchanged during iteration.
 * Each next() processes one tile; the final return value is the complete definition.
 * A worker can transfer each yielded buffer and report completed/total (Faz 8).
 */
export function* iterateRawHeightmapTiles(
  options: RawHeightmapImportOptions,
): Generator<RawHeightmapTile, WorldTerrainDef, void> {
  const { tileQuads, width, height } = options;
  if (!isValidTileQuads(tileQuads)) throw new Error("RAW invalid tileQuads (expected a power of two in 32..512)");
  const tilesX = rawAxisTiles(width, tileQuads, "width");
  const tilesZ = rawAxisTiles(height, tileQuads, "height");
  if (options.endianness !== undefined && options.endianness !== "little" && options.endianness !== "big") {
    throw new Error("RAW endianness must be little or big");
  }
  const source = options.bytes instanceof Uint8Array ? options.bytes : new Uint8Array(options.bytes);
  if (source.byteLength !== width * height * 2) {
    throw new Error(`RAW expected ${width * height * 2} bytes for ${width}x${height}, got ${source.byteLength}`);
  }
  const def = normalizeWorldTerrain({
    schema: TERRAIN_SCHEMA, type: "worldTerrain", name: "Imported heightmap",
    tileQuads, spacing: options.spacing, tilesX, tilesZ, origin: options.origin,
    heightMin: Math.fround(options.heightMin), heightMax: Math.fround(options.heightMax),
    layers: [], tiles: [], collision: true,
  });
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const littleEndian = options.endianness !== "big";
  const range = def.heightMax - def.heightMin;
  for (let z = 0; z < tilesZ; z += 1) {
    for (let x = 0; x < tilesX; x += 1) {
      const tile = createFlatTerrainTile(def, x, z);
      const bytes = encodeTerrainTile(tile, def);
      const target = new DataView(bytes.buffer);
      let minHeight = Infinity;
      let maxHeight = -Infinity;
      for (let vz = 0; vz < tile.size; vz += 1) {
        const row = ((z * tileQuads + vz) * width + x * tileQuads) * 2;
        for (let vx = 0; vx < tile.size; vx += 1) {
          const sample = view.getUint16(row + vx * 2, littleEndian);
          target.setUint16(TERRAIN_TILE_HEADER_BYTES + (vz * tile.size + vx) * 2, sample, true);
          const value = Math.fround(def.heightMin + sample / 65535 * range);
          minHeight = Math.min(minHeight, value);
          maxHeight = Math.max(maxHeight, value);
        }
      }
      const key = tileKey(x, z);
      const summary = { key, minHeight, maxHeight };
      def.tiles.push(summary);
      yield { key, bytes, summary, completed: def.tiles.length, total: tilesX * tilesZ };
    }
  }
  return def;
}

/** Eager convenience wrapper over the per-tile iterator. */
export function importRawHeightmap(options: RawHeightmapImportOptions): RawHeightmapImportResult {
  const iterator = iterateRawHeightmapTiles(options);
  const tiles = new Map<string, Uint8Array>();
  let next = iterator.next();
  while (!next.done) {
    tiles.set(next.value.key, next.value.bytes);
    next = iterator.next();
  }
  return { def: next.value, tiles };
}

/**
 * Export a complete rectangular grid to little-endian row-major u16 RAW.
 * Matching u16 tile codes are preserved verbatim. f32 tiles clamp to the f32
 * definition range and round to the nearest of 65536 levels (half a step error
 * inside the range). Holes export as zero; resident edges keep their samples.
 * Non-finite samples, missing declared tiles and unequal edge copies fail;
 * edges must agree before clamping/quantization, even if both would encode alike.
 * A worker can post progress after each stitched tile through onProgress.
 */
export function exportRawHeightmap(
  definition: WorldTerrainDef,
  tiles: ReadonlyMap<string, Uint8Array>,
  onProgress?: (progress: RawHeightmapProgress) => void,
): Uint8Array {
  const def = normalizeWorldTerrain(definition);
  const listed = new Set(def.tiles.map((entry) => entry.key));
  const width = def.tilesX * def.tileQuads + 1;
  const height = def.tilesZ * def.tileQuads + 1;
  const bytes = new Uint8Array(width * height * 2);
  const output = new DataView(bytes.buffer);
  const boundaries = new Map<number, number>();
  const min = Math.fround(def.heightMin);
  const max = Math.fround(def.heightMax);
  let completed = 0;
  for (let z = 0; z < def.tilesZ; z += 1) {
    for (let x = 0; x < def.tilesX; x += 1) {
      const key = tileKey(x, z);
      if (!listed.has(key)) continue;
      const source = tiles.get(key);
      if (!source) throw new Error(`RAW export missing tile ${key}`);
      const tile = decodeTerrainTile(source);
      if (tile.x !== x || tile.z !== z || tile.size !== def.tileQuads + 1 || tile.layerCount !== def.layers.length ||
          tile.heightMin !== min || tile.heightMax !== max) {
        throw new Error(`RAW tile ${key} header does not match definition`);
      }
      const input = new DataView(source.buffer, source.byteOffset, source.byteLength);
      for (let vz = 0; vz < tile.size; vz += 1) {
        for (let vx = 0; vx < tile.size; vx += 1) {
          const index = vz * tile.size + vx;
          const value = tile.heights[index]!;
          if (!Number.isFinite(value)) throw new Error(`RAW tile ${key} has non-finite heights`);
          const sample = tile.heightFormat === "u16" ? input.getUint16(TERRAIN_TILE_HEADER_BYTES + index * 2, true)
            : Math.round(Math.min(1, Math.max(0, (value - min) / (max - min))) * 65535);
          const gx = x * def.tileQuads + vx;
          const gz = z * def.tileQuads + vz;
          const globalIndex = gz * width + gx;
          const duplicate = boundaries.has(globalIndex);
          if (duplicate) {
            if (boundaries.get(globalIndex) !== value || output.getUint16(globalIndex * 2, true) !== sample) {
              throw new Error(`RAW duplicated edge mismatch at (${gx}, ${gz}) in tile ${key}`);
            }
          } else {
            output.setUint16(globalIndex * 2, sample, true);
          }
          if (vx === 0 || vz === 0 || vx === def.tileQuads || vz === def.tileQuads) boundaries.set(globalIndex, value);
        }
      }
      onProgress?.({ key, completed: ++completed, total: listed.size });
    }
  }
  return bytes;
}
