import {
  TERRAIN_SCHEMA,
  terrainWeightBlockCount,
  tileKey,
  type TerrainTileData,
  type WorldTerrainDef,
  type WorldTerrainTileSummary,
} from "@engine/terrain/terrainTypes";
import {
  TERRAIN_TILE_HEADER_BYTES,
  decodeTerrainTile,
  encodeTerrainTile,
} from "@engine/terrain/terrainTileCodec";
import type { TerrainTileLookup } from "@engine/terrain/terrainHeightQuery";

/**
 * S1 spike world: a procedural mountain/valley terrain built tile by tile with
 * the real Faz 1 pipeline — every tile goes through `encodeTerrainTile` (Uint16
 * heights + one RGBA8 weight block) and only the encoded bytes are kept, the way
 * a fetched `x_z.tile.bin` would sit in memory. The GPU uploads straight from
 * views into those bytes; CPU height queries decode on demand.
 */

export interface SpikeWorldOptions {
  tiles: number;
  tileQuads: number;
  spacing: number;
  /** Quads of the CDLOD patch = vertex span of a level-0 quadtree node. */
  leafQuads: number;
  /** Global low-res map stride in vertices (16 → 16 m/texel at 1 m spacing). */
  globalStride: number;
  seed: number;
  /** 4 or 8 paint layers (1 or 2 RGBA8 weight blocks); layers 5–8 stay empty. */
  layerCount: number;
}

export interface MinMaxLevel {
  n: number;
  min: Float32Array;
  max: Float32Array;
}

/** Per-quadtree-node height bounds, level 0 = leaves. */
export interface MinMaxPyramid {
  leafSize: number;
  levels: MinMaxLevel[];
}

export interface SpikeWorld {
  def: WorldTerrainDef;
  /** Vertices per tile side. */
  size: number;
  encoded: Uint8Array[];
  global: { size: number; stride: number; heights: Uint16Array; weights: Uint8Array };
  pyramid: MinMaxPyramid;
  lookup: LazyDecodedTiles;
  stats: { generateMs: number; encodeMs: number; encodedBytes: number };
}

const LAYER_DEFS = [
  { id: "grass", name: "Grass", color: "#5d7f3a" },
  { id: "dirt", name: "Dirt", color: "#7a6146" },
  { id: "rock", name: "Rock", color: "#6f6d6a" },
  { id: "snow", name: "Snow", color: "#e8edf2" },
];

export const SPIKE_HEIGHT_MIN = -64;
export const SPIKE_HEIGHT_MAX = 960;

// --- noise --------------------------------------------------------------------

type Noise2 = (x: number, y: number) => number;

function createPerlin(seed: number): Noise2 {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) perm[i] = i;
  let state = seed >>> 0 || 1;
  const rand = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = tmp;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) p[i] = perm[i & 255]!;
  const grad = (hash: number, x: number, y: number): number => {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = p[X]! + Y;
    const b = p[X + 1]! + Y;
    const x1 = grad(p[a]!, xf, yf) + u * (grad(p[b]!, xf - 1, yf) - grad(p[a]!, xf, yf));
    const x2 = grad(p[a + 1]!, xf, yf - 1) + u * (grad(p[b + 1]!, xf - 1, yf - 1) - grad(p[a + 1]!, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function createHeightField(seed: number): { height: Noise2; patch: Noise2 } {
  const nBase = createPerlin(seed);
  const nMask = createPerlin(seed + 11);
  const nRidge = createPerlin(seed + 23);
  const nDetail = createPerlin(seed + 37);
  const nPatch = createPerlin(seed + 51);
  const height: Noise2 = (x, z) => {
    let base = 0;
    let amp = 1;
    let f = 1 / 1600;
    for (let o = 0; o < 4; o += 1) {
      base += amp * nBase(x * f, z * f);
      amp *= 0.5;
      f *= 2.03;
    }
    const mask = smoothstep(-0.05, 0.4, base + 0.35 * nMask(x / 2600, z / 2600));
    let ridge = 0;
    if (mask > 0) {
      amp = 1;
      f = 1 / 900;
      let weight = 1;
      for (let o = 0; o < 5; o += 1) {
        let r = 1 - Math.abs(nRidge(x * f, z * f));
        r *= r * weight;
        weight = Math.min(1, Math.max(0, r * 1.6));
        ridge += r * amp;
        amp *= 0.5;
        f *= 2.1;
      }
    }
    const detail = nDetail(x / 45, z / 45) * 3 + nDetail(x / 9.7 + 100, z / 9.7) * 0.5;
    return 60 + base * 90 + mask * ridge * 380 + detail;
  };
  return { height, patch: (x, z) => nPatch(x / 70, z / 70) };
}

// --- decoded-tile lookup ------------------------------------------------------

/** Decodes tiles on demand for CPU height queries, keeping a small LRU. */
export class LazyDecodedTiles implements TerrainTileLookup {
  private readonly cache = new Map<number, TerrainTileData>();
  lastDecodeMs = 0;
  decodeCount = 0;
  decodeTotalMs = 0;

  constructor(
    private readonly encoded: Uint8Array[],
    private readonly tiles: number,
    private readonly capacity = 12,
  ) {}

  tile(x: number, z: number): TerrainTileData | undefined {
    if (x < 0 || z < 0 || x >= this.tiles || z >= this.tiles) return undefined;
    const index = z * this.tiles + x;
    const cached = this.cache.get(index);
    if (cached) {
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }
    const bytes = this.encoded[index];
    if (!bytes) return undefined;
    const t0 = performance.now();
    const tile = decodeTerrainTile(bytes);
    this.lastDecodeMs = performance.now() - t0;
    this.decodeCount += 1;
    this.decodeTotalMs += this.lastDecodeMs;
    this.cache.set(index, tile);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return tile;
  }
}

/** Zero-copy views into an encoded tile (little-endian host, as every browser is). */
export function encodedTileHeights(bytes: Uint8Array, size: number): Uint16Array {
  return new Uint16Array(bytes.buffer, bytes.byteOffset + TERRAIN_TILE_HEADER_BYTES, size * size);
}

/** All weight blocks back to back (`blocks × size² × 4` bytes). */
export function encodedTileWeights(bytes: Uint8Array, size: number, blocks = 1): Uint8Array {
  const offset = TERRAIN_TILE_HEADER_BYTES + size * size * 2;
  return bytes.subarray(offset, offset + size * size * 4 * blocks);
}

// --- generation -----------------------------------------------------------------

export async function generateSpikeWorld(
  options: SpikeWorldOptions,
  onProgress: (done: number, total: number) => void,
): Promise<SpikeWorld> {
  const { tiles, tileQuads: q, spacing, leafQuads, globalStride, seed, layerCount } = options;
  const weightBlocks = terrainWeightBlockCount(layerCount);
  const size = q + 1;
  const worldSize = tiles * q * spacing;
  const { height, patch } = createHeightField(seed);
  const range = Math.fround(SPIKE_HEIGHT_MAX) - Math.fround(SPIKE_HEIGHT_MIN);
  const toMetres = (v: number): number => SPIKE_HEIGHT_MIN + (v / 65535) * range;

  const leavesPerTile = q / leafQuads;
  const leafN = tiles * leavesPerTile;
  const leafMin = new Float32Array(leafN * leafN);
  const leafMax = new Float32Array(leafN * leafN);

  const encoded: Uint8Array[] = new Array(tiles * tiles);
  const summaries: WorldTerrainTileSummary[] = [];
  const apron = size + 2;
  const apronHeights = new Float32Array(apron * apron);
  let generateMs = 0;
  let encodeMs = 0;
  let encodedBytes = 0;

  for (let tz = 0; tz < tiles; tz += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      const t0 = performance.now();
      // One-vertex apron so slopes (and so paint weights) of duplicated edge
      // vertices match the neighbour's copy exactly.
      for (let j = 0; j < apron; j += 1) {
        const wz = (tz * q + j - 1) * spacing;
        for (let i = 0; i < apron; i += 1) {
          apronHeights[j * apron + i] = height((tx * q + i - 1) * spacing, wz);
        }
      }
      const count = size * size;
      const heights = new Float32Array(count);
      const weights = new Uint8Array(count * 4 * weightBlocks);
      for (let z = 0; z < size; z += 1) {
        for (let x = 0; x < size; x += 1) {
          const ai = (z + 1) * apron + x + 1;
          const h = apronHeights[ai]!;
          heights[z * size + x] = h;
          const dx = (apronHeights[ai + 1]! - apronHeights[ai - 1]!) / (2 * spacing);
          const dz = (apronHeights[ai + apron]! - apronHeights[ai - apron]!) / (2 * spacing);
          const slope = 1 - 1 / Math.sqrt(dx * dx + dz * dz + 1);
          const rock = smoothstep(0.12, 0.3, slope);
          const snow = smoothstep(430, 540, h) * (1 - smoothstep(0.25, 0.45, slope));
          const dirt =
            smoothstep(0.1, 0.5, patch((tx * q + x) * spacing, (tz * q + z) * spacing)) *
            (1 - rock) *
            (1 - snow);
          const grass = Math.max(0, 1 - rock - snow - dirt);
          const sum = grass + dirt + rock + snow || 1;
          const o = (z * size + x) * 4;
          weights[o] = Math.round((grass / sum) * 255);
          weights[o + 1] = Math.round((dirt / sum) * 255);
          weights[o + 2] = Math.round((rock / sum) * 255);
          weights[o + 3] = Math.round((snow / sum) * 255);
        }
      }
      const t1 = performance.now();
      const bytes = encodeTerrainTile(
        { x: tx, z: tz, size, heights, layerCount, weights },
        { heightMin: SPIKE_HEIGHT_MIN, heightMax: SPIKE_HEIGHT_MAX },
      );
      const t2 = performance.now();
      generateMs += t1 - t0;
      encodeMs += t2 - t1;
      encodedBytes += bytes.byteLength;
      encoded[tz * tiles + tx] = bytes;

      // Bounds from the quantized samples, so they hold for what the GPU reads.
      const u16 = encodedTileHeights(bytes, size);
      let tileMin = 65535;
      let tileMax = 0;
      for (let lz = 0; lz < leavesPerTile; lz += 1) {
        for (let lx = 0; lx < leavesPerTile; lx += 1) {
          let mn = 65535;
          let mx = 0;
          for (let z = lz * leafQuads; z <= (lz + 1) * leafQuads; z += 1) {
            const row = z * size;
            for (let x = lx * leafQuads; x <= (lx + 1) * leafQuads; x += 1) {
              const v = u16[row + x]!;
              if (v < mn) mn = v;
              if (v > mx) mx = v;
            }
          }
          const li = (tz * leavesPerTile + lz) * leafN + tx * leavesPerTile + lx;
          leafMin[li] = toMetres(mn);
          leafMax[li] = toMetres(mx);
          if (mn < tileMin) tileMin = mn;
          if (mx > tileMax) tileMax = mx;
        }
      }
      summaries.push({ key: tileKey(tx, tz), minHeight: toMetres(tileMin), maxHeight: toMetres(tileMax) });
      onProgress(tz * tiles + tx + 1, tiles * tiles);
      // Yield so the progress text paints.
      if ((tx & 3) === 3) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const levels: MinMaxLevel[] = [{ n: leafN, min: leafMin, max: leafMax }];
  while (levels[levels.length - 1]!.n > 1) {
    const prev = levels[levels.length - 1]!;
    const n = prev.n >> 1;
    const min = new Float32Array(n * n);
    const max = new Float32Array(n * n);
    for (let z = 0; z < n; z += 1) {
      for (let x = 0; x < n; x += 1) {
        const a = 2 * z * prev.n + 2 * x;
        const b = a + prev.n;
        min[z * n + x] = Math.min(prev.min[a]!, prev.min[a + 1]!, prev.min[b]!, prev.min[b + 1]!);
        max[z * n + x] = Math.max(prev.max[a]!, prev.max[a + 1]!, prev.max[b]!, prev.max[b + 1]!);
      }
    }
    levels.push({ n, min, max });
  }

  // Global map: point samples of the tile data, so a node fully morphed onto
  // the global grid reads exactly the heights a tile-sampled neighbour does.
  const globalSize = (tiles * q) / globalStride + 1;
  const globalHeights = new Uint16Array(globalSize * globalSize);
  const globalWeights = new Uint8Array(globalSize * globalSize * 4);
  for (let j = 0; j < globalSize; j += 1) {
    const gz = j * globalStride;
    const tz = Math.min(Math.floor(gz / q), tiles - 1);
    const lz = gz - tz * q;
    for (let i = 0; i < globalSize; i += 1) {
      const gx = i * globalStride;
      const tx = Math.min(Math.floor(gx / q), tiles - 1);
      const lx = gx - tx * q;
      const bytes = encoded[tz * tiles + tx]!;
      const vi = lz * size + lx;
      globalHeights[j * globalSize + i] = encodedTileHeights(bytes, size)[vi]!;
      globalWeights.set(encodedTileWeights(bytes, size).subarray(vi * 4, vi * 4 + 4), (j * globalSize + i) * 4);
    }
  }

  const def: WorldTerrainDef = {
    schema: TERRAIN_SCHEMA,
    type: "worldTerrain",
    name: "S1 Spike",
    tileQuads: q,
    spacing,
    tilesX: tiles,
    tilesZ: tiles,
    origin: [-worldSize / 2, 0, -worldSize / 2],
    heightMin: SPIKE_HEIGHT_MIN,
    heightMax: SPIKE_HEIGHT_MAX,
    layers: Array.from({ length: layerCount }, (_, i) => {
      const preset = LAYER_DEFS[i];
      return preset ? { ...preset } : { id: `layer${i}`, name: `Layer ${i}`, color: "#808080" };
    }),
    tiles: summaries,
    collision: false,
  };

  return {
    def,
    size,
    encoded,
    global: { size: globalSize, stride: globalStride, heights: globalHeights, weights: globalWeights },
    pyramid: { leafSize: leafQuads * spacing, levels },
    lookup: new LazyDecodedTiles(encoded, tiles),
    stats: { generateMs, encodeMs, encodedBytes },
  };
}
