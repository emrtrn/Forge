import { TERRAIN_PATCH_QUADS, TERRAIN_WEIGHT_BLOCKS } from "./terrainRenderData";
import type { TerrainGlobalAttributes } from "./terrainRenderSource";
import { isValidTileQuads, TERRAIN_MAX_LAYERS, TERRAIN_MAX_TILES_PER_AXIS, type WorldTerrainDef } from "./terrainTypes";

/**
 * FGLB v1, little-endian, 32-byte header: magic[4], version u16, flags u16
 * (zero), width/height/stride u32, tilesX/tilesZ/tileQuads/layers u16,
 * reserved u32 (zero). Payload: row-major f32 heights (NaN = hole), f32
 * normal X/Z/hole triples, then two block-major RGBA8 weight planes.
 * Heights are terrain-local, relative to the definition's datum.
 */
export const TERRAIN_GLOBAL_HEADER_BYTES = 32;
export const TERRAIN_GLOBAL_VERSION = 1;
export const TERRAIN_GLOBAL_BODY_MAX_BYTES = terrainGlobalMapByteLength(
  TERRAIN_MAX_TILES_PER_AXIS * TERRAIN_PATCH_QUADS / 2 + 1,
  TERRAIN_MAX_TILES_PER_AXIS * TERRAIN_PATCH_QUADS / 2 + 1,
);

type GlobalShape = Pick<WorldTerrainDef, "tilesX" | "tilesZ" | "tileQuads" | "layers">;

export interface DecodedTerrainGlobalMap extends TerrainGlobalAttributes {
  tilesX: number;
  tilesZ: number;
  tileQuads: number;
  layerCount: number;
}

export function terrainGlobalMapByteLength(width: number, height: number): number {
  return TERRAIN_GLOBAL_HEADER_BYTES + width * height * (16 + 4 * TERRAIN_WEIGHT_BLOCKS);
}

function assertShape(tilesX: number, tilesZ: number, tileQuads: number, layerCount: number): void {
  if (![tilesX, tilesZ].every((n) => Number.isInteger(n) && n > 0 && n <= TERRAIN_MAX_TILES_PER_AXIS)
    || !isValidTileQuads(tileQuads) || !Number.isInteger(layerCount) || layerCount < 0 || layerCount > TERRAIN_MAX_LAYERS) {
    throw new Error("[terrain-global] invalid world shape");
  }
}

function assertAttributes(attributes: TerrainGlobalAttributes, tilesX: number, tilesZ: number, tileQuads: number): void {
  const { map, normals, weights } = attributes;
  const stride = 2 * tileQuads / TERRAIN_PATCH_QUADS;
  if (map.stride !== stride || map.width !== tilesX * tileQuads / stride + 1 || map.height !== tilesZ * tileQuads / stride + 1
    || map.heights.length !== map.width * map.height || normals.length !== map.heights.length * 3
    || weights.length !== map.heights.length * 4 * TERRAIN_WEIGHT_BLOCKS) {
    throw new Error("[terrain-global] attributes do not match world shape");
  }
  for (let i = 0; i < map.heights.length; i += 1) {
    const h = map.heights[i]!;
    const nx = normals[i * 3]!;
    const nz = normals[i * 3 + 1]!;
    const hole = normals[i * 3 + 2]!;
    if ((!Number.isFinite(h) && !Number.isNaN(h)) || !Number.isFinite(nx) || !Number.isFinite(nz)
      || Math.abs(nx) > 1 || Math.abs(nz) > 1 || (hole !== 0 && hole !== 1) || (hole === 1) !== Number.isNaN(h)) {
      throw new Error("[terrain-global] invalid height, normal or hole flag");
    }
  }
}

/** Copy float bits, including signed zero and NaN payloads, without numeric conversion. */
function writeFloats(view: DataView, offset: number, floats: Float32Array): number {
  const bits = new Uint32Array(floats.buffer, floats.byteOffset, floats.length);
  for (const value of bits) { view.setUint32(offset, value, true); offset += 4; }
  return offset;
}

export function encodeTerrainGlobalMap(def: GlobalShape, attributes: TerrainGlobalAttributes): Uint8Array {
  assertShape(def.tilesX, def.tilesZ, def.tileQuads, def.layers.length);
  assertAttributes(attributes, def.tilesX, def.tilesZ, def.tileQuads);
  const { map } = attributes;
  const bytes = new Uint8Array(terrainGlobalMapByteLength(map.width, map.height));
  bytes.set([70, 71, 76, 66]); // FGLB
  const view = new DataView(bytes.buffer);
  view.setUint16(4, TERRAIN_GLOBAL_VERSION, true);
  view.setUint32(8, map.width, true);
  view.setUint32(12, map.height, true);
  view.setUint32(16, map.stride, true);
  view.setUint16(20, def.tilesX, true);
  view.setUint16(22, def.tilesZ, true);
  view.setUint16(24, def.tileQuads, true);
  view.setUint16(26, def.layers.length, true);
  let offset = writeFloats(view, TERRAIN_GLOBAL_HEADER_BYTES, map.heights);
  offset = writeFloats(view, offset, attributes.normals);
  bytes.set(attributes.weights, offset);
  return bytes;
}

export function decodeTerrainGlobalMap(source: ArrayBuffer | Uint8Array): DecodedTerrainGlobalMap {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < TERRAIN_GLOBAL_HEADER_BYTES || bytes.length > TERRAIN_GLOBAL_BODY_MAX_BYTES) {
    throw new Error("[terrain-global] invalid byte length");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x424c4746 || view.getUint16(4, true) !== TERRAIN_GLOBAL_VERSION
    || view.getUint16(6, true) !== 0 || view.getUint32(28, true) !== 0) {
    throw new Error("[terrain-global] invalid magic, version, flags or reserved bytes");
  }
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const stride = view.getUint32(16, true);
  const tilesX = view.getUint16(20, true);
  const tilesZ = view.getUint16(22, true);
  const tileQuads = view.getUint16(24, true);
  const layerCount = view.getUint16(26, true);
  assertShape(tilesX, tilesZ, tileQuads, layerCount);
  if (stride !== 2 * tileQuads / TERRAIN_PATCH_QUADS || width !== tilesX * TERRAIN_PATCH_QUADS / 2 + 1
    || height !== tilesZ * TERRAIN_PATCH_QUADS / 2 + 1 || bytes.length !== terrainGlobalMapByteLength(width, height)) {
    throw new Error("[terrain-global] invalid dimensions or payload length");
  }
  let offset = TERRAIN_GLOBAL_HEADER_BYTES;
  const readFloats = (count: number) => {
    const floats = new Float32Array(count);
    const bits = new Uint32Array(floats.buffer);
    for (let i = 0; i < count; i += 1, offset += 4) bits[i] = view.getUint32(offset, true);
    return floats;
  };
  const heights = readFloats(width * height);
  const normals = readFloats(width * height * 3);
  const result = { map: { width, height, stride, heights }, normals, weights: bytes.slice(offset), tilesX, tilesZ, tileQuads, layerCount };
  assertAttributes(result, tilesX, tilesZ, tileQuads);
  return result;
}

/** Shared runtime/save cross-check, without fetching any tile. */
export function validateTerrainGlobalMap(def: WorldTerrainDef, bytes: Uint8Array): TerrainGlobalAttributes {
  const decoded = decodeTerrainGlobalMap(bytes);
  if (decoded.tilesX !== def.tilesX || decoded.tilesZ !== def.tilesZ || decoded.tileQuads !== def.tileQuads
    || decoded.layerCount !== def.layers.length) throw new Error("[terrain-global] header does not match definition");
  const { map, normals, weights } = decoded;
  return { map, normals, weights };
}
