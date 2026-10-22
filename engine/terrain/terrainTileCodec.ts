import {
  TERRAIN_MAX_LAYERS,
  TERRAIN_MAX_TILE_QUADS,
  TERRAIN_MIN_TILE_QUADS,
  terrainWeightBlockCount,
  type TerrainTileData,
} from "./terrainTypes";

/**
 * Binary `*.tile.bin` codec for one World Terrain tile (OPEN_WORLD_PLAN K1).
 * JSON number arrays cost ~13 bytes a sample (a 257² Landscape is 4.4 MB);
 * this layout is 2 bytes a height plus 4 bytes per vertex per weight block,
 * and is uploaded to textures without reshaping.
 *
 * Layout, little-endian, 32-byte header:
 *
 * | Offset | Type    | Field                                           |
 * |--------|---------|-------------------------------------------------|
 * | 0      | u8[4]   | magic `FTIL`                                    |
 * | 4      | u16     | version (1)                                     |
 * | 6      | u16     | flags (bit 0: heights are `f32`, else `u16`)    |
 * | 8      | u16     | vertices per side                               |
 * | 10     | u8      | layer count (0..8)                              |
 * | 11     | u8      | reserved (0)                                    |
 * | 12     | f32     | heightMin (u16 decode range)                    |
 * | 16     | f32     | heightMax                                       |
 * | 20     | i32     | tile x                                          |
 * | 24     | i32     | tile z                                          |
 * | 28     | u32     | reserved (0)                                    |
 * | 32     | …       | heights (`size²` × u16 or f32)                  |
 * | …      | u8[]    | weight blocks (`ceil(layers/4)` × `size²` × 4)  |
 *
 * A `u16` height `h` decodes to `heightMin + h / 65535 · (heightMax − heightMin)`.
 * Heights outside the range are clamped on encode — the caller widens the
 * terrain range first when an edit needs more relief.
 */

export const TERRAIN_TILE_MAGIC = "FTIL";
export const TERRAIN_TILE_VERSION = 1;
export const TERRAIN_TILE_HEADER_BYTES = 32;
const FLAG_FLOAT_HEIGHTS = 1;

export type TerrainHeightFormat = "u16" | "f32";

export interface TerrainTileEncodeOptions {
  heightMin: number;
  heightMax: number;
  heightFormat?: TerrainHeightFormat;
}

export interface DecodedTerrainTile extends TerrainTileData {
  heightFormat: TerrainHeightFormat;
  heightMin: number;
  heightMax: number;
}

export class TerrainTileCodecError extends Error {
  constructor(message: string) {
    super(`[terrain-tile] ${message}`);
    this.name = "TerrainTileCodecError";
  }
}

function heightBytes(size: number, format: TerrainHeightFormat): number {
  return size * size * (format === "f32" ? 4 : 2);
}

/** Total encoded byte length for a tile shape; also the decode length check. */
export function terrainTileByteLength(size: number, layerCount: number, format: TerrainHeightFormat): number {
  return TERRAIN_TILE_HEADER_BYTES + heightBytes(size, format) + terrainWeightBlockCount(layerCount) * size * size * 4;
}

function assertTileShape(size: number, layerCount: number): void {
  const quads = size - 1;
  if (!Number.isInteger(size) || quads < TERRAIN_MIN_TILE_QUADS || quads > TERRAIN_MAX_TILE_QUADS || (quads & (quads - 1)) !== 0) {
    throw new TerrainTileCodecError(`invalid vertices per side ${size}`);
  }
  if (!Number.isInteger(layerCount) || layerCount < 0 || layerCount > TERRAIN_MAX_LAYERS) {
    throw new TerrainTileCodecError(`invalid layer count ${layerCount}`);
  }
}

export function encodeTerrainTile(tile: TerrainTileData, options: TerrainTileEncodeOptions): Uint8Array {
  const { size, layerCount } = tile;
  assertTileShape(size, layerCount);
  const format = options.heightFormat ?? "u16";
  const { heightMin, heightMax } = options;
  if (!Number.isFinite(heightMin) || !Number.isFinite(heightMax) || !(heightMax > heightMin)) {
    throw new TerrainTileCodecError(`invalid height range ${heightMin}..${heightMax}`);
  }
  const count = size * size;
  if (tile.heights.length !== count) {
    throw new TerrainTileCodecError(`expected ${count} heights, got ${tile.heights.length}`);
  }
  const weightLength = terrainWeightBlockCount(layerCount) * count * 4;
  if (tile.weights.length !== weightLength) {
    throw new TerrainTileCodecError(`expected ${weightLength} weight bytes, got ${tile.weights.length}`);
  }

  const bytes = new Uint8Array(terrainTileByteLength(size, layerCount, format));
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 4; index += 1) bytes[index] = TERRAIN_TILE_MAGIC.charCodeAt(index);
  view.setUint16(4, TERRAIN_TILE_VERSION, true);
  view.setUint16(6, format === "f32" ? FLAG_FLOAT_HEIGHTS : 0, true);
  view.setUint16(8, size, true);
  view.setUint8(10, layerCount);
  view.setFloat32(12, heightMin, true);
  view.setFloat32(16, heightMax, true);
  view.setInt32(20, tile.x, true);
  view.setInt32(24, tile.z, true);

  let offset = TERRAIN_TILE_HEADER_BYTES;
  if (format === "f32") {
    for (let index = 0; index < count; index += 1, offset += 4) {
      const height = tile.heights[index]!;
      view.setFloat32(offset, Number.isFinite(height) ? height : 0, true);
    }
  } else {
    // Quantize against the f32-rounded range the decoder will read back.
    const min = Math.fround(heightMin);
    const range = Math.fround(heightMax) - min;
    for (let index = 0; index < count; index += 1, offset += 2) {
      const height = tile.heights[index]!;
      const t = ((Number.isFinite(height) ? height : 0) - min) / range;
      view.setUint16(offset, Math.round(Math.min(1, Math.max(0, t)) * 65535), true);
    }
  }
  bytes.set(tile.weights, offset);
  return bytes;
}

export function decodeTerrainTile(source: ArrayBuffer | Uint8Array): DecodedTerrainTile {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < TERRAIN_TILE_HEADER_BYTES) {
    throw new TerrainTileCodecError(`truncated header (${bytes.length} bytes)`);
  }
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== TERRAIN_TILE_MAGIC) throw new TerrainTileCodecError(`bad magic "${magic}"`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== TERRAIN_TILE_VERSION) throw new TerrainTileCodecError(`unsupported version ${version}`);
  const format: TerrainHeightFormat = (view.getUint16(6, true) & FLAG_FLOAT_HEIGHTS) !== 0 ? "f32" : "u16";
  const size = view.getUint16(8, true);
  const layerCount = view.getUint8(10);
  assertTileShape(size, layerCount);
  const heightMin = view.getFloat32(12, true);
  const heightMax = view.getFloat32(16, true);
  if (!Number.isFinite(heightMin) || !Number.isFinite(heightMax) || !(heightMax > heightMin)) {
    throw new TerrainTileCodecError(`invalid height range ${heightMin}..${heightMax}`);
  }
  const expected = terrainTileByteLength(size, layerCount, format);
  if (bytes.length !== expected) {
    throw new TerrainTileCodecError(`expected ${expected} bytes for a ${size}² tile, got ${bytes.length}`);
  }

  const count = size * size;
  const heights = new Float32Array(count);
  let offset = TERRAIN_TILE_HEADER_BYTES;
  if (format === "f32") {
    for (let index = 0; index < count; index += 1, offset += 4) heights[index] = view.getFloat32(offset, true);
  } else {
    const range = heightMax - heightMin;
    for (let index = 0; index < count; index += 1, offset += 2) {
      heights[index] = heightMin + (view.getUint16(offset, true) / 65535) * range;
    }
  }
  const weights = bytes.slice(offset, offset + terrainWeightBlockCount(layerCount) * count * 4);
  return {
    x: view.getInt32(20, true),
    z: view.getInt32(24, true),
    size,
    heights,
    layerCount,
    weights,
    heightFormat: format,
    heightMin,
    heightMax,
  };
}
