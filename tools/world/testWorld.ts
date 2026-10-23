/**
 * The open-world test world (OPEN_WORLD_PLAN Faz 4): a deterministic 4×4 km
 * World Terrain — a gently undulating valley running along Z between ridged
 * fBm mountains, painted grass / dirt road / rock slopes / snow caps.
 *
 * Generated, never committed: `npm run world:test` writes ~100 MB of tiles at
 * the default 256 quads × 1 m, which is what the streaming budgets are for.
 * The streaming smoke builds a coarser copy (128 quads × 2 m, same extent).
 *
 * Tiles use the stock u16 FTIL encoding over `heightMin..heightMax` (512 m →
 * ~7.8 mm steps) — the generator never changes the tile format. Summaries,
 * the global map and the returned `tiles` all come from the *decoded* bytes,
 * so they match what the runtime loads exactly. Heights are a function of the
 * global sample index, so neighbouring tiles' shared edges are identical.
 */
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { decodeTerrainTile, encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import {
  terrainTileHeightRange, tileKey,
  type TerrainTileData, type WorldTerrainDef,
} from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";

// Under layouts/, not assets/: generated content stays out of the manifest and
// its health check, like the other unregistered fixture levels there.
export const OPEN_WORLD_TEST_LEVEL = "layouts/OpenWorldTest.level.json";
export const OPEN_WORLD_TEST_TERRAIN = "layouts/OpenWorldTest.landscapes/world.terrain.json";

export interface TestWorldOptions {
  /** Tiles per axis (default 16). */
  tiles?: number;
  /** Quads per tile edge (default 256). */
  tileQuads?: number;
  /** Metres between samples (default 1). */
  spacing?: number;
  seed?: number;
}

export interface TestWorld {
  def: WorldTerrainDef;
  /** Decoded tiles: exactly what the runtime reads back. */
  tiles: Map<string, TerrainTileData>;
  /** Encoded `<x>_<z>.tile.bin` bodies. */
  tileBytes: Map<string, Uint8Array>;
  globalBytes: Uint8Array;
  /** Player Start: on the valley floor, 2 m up, 500 m south of the centre. */
  spawn: [number, number, number];
  heightAt(x: number, z: number): number | null;
}

const HEIGHT_MIN = -256;
const HEIGHT_MAX = 256;

// Sixteen unit gradients: a table lookup instead of trig per lattice corner.
const GRADIENT_X = Float64Array.from({ length: 16 }, (_, index) => Math.cos(index * Math.PI / 8));
const GRADIENT_Z = Float64Array.from({ length: 16 }, (_, index) => Math.sin(index * Math.PI / 8));

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 2D gradient noise, roughly −0.7..0.7. */
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  // Hot path (tens of millions of calls per world): no closures, no tuples.
  const g00 = hash(ix, iz, seed) & 15;
  const g10 = hash(ix + 1, iz, seed) & 15;
  const g01 = hash(ix, iz + 1, seed) & 15;
  const g11 = hash(ix + 1, iz + 1, seed) & 15;
  const n00 = GRADIENT_X[g00]! * fx + GRADIENT_Z[g00]! * fz;
  const n10 = GRADIENT_X[g10]! * (fx - 1) + GRADIENT_Z[g10]! * fz;
  const n01 = GRADIENT_X[g01]! * fx + GRADIENT_Z[g01]! * (fz - 1);
  const n11 = GRADIENT_X[g11]! * (fx - 1) + GRADIENT_Z[g11]! * (fz - 1);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const top = n00 + (n10 - n00) * ux;
  const bottom = n01 + (n11 - n01) * ux;
  return top + (bottom - top) * uz;
}

function fbm(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise(x, z, seed + octave * 101) * amplitude;
    x *= 2.03;
    z *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

/** Ridged multifractal, 0..~1: sharp crests where the noise crosses zero. */
function ridged(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let weight = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    const ridge = (1 - Math.abs(noise(x, z, seed + octave * 131)) * 1.4) ** 2 * weight;
    sum += ridge * amplitude;
    weight = Math.min(1, ridge * 2);
    x *= 2.11;
    z *= 2.11;
    amplitude *= 0.5;
  }
  return sum;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The valley's centre line: a slow meander along Z. */
export function testWorldValleyX(z: number): number {
  return 40 * Math.sin(z / 380) + 15 * Math.sin(z / 150 + 1.3);
}

function heightAtWorld(x: number, z: number, seed: number): number {
  const mountains = smoothstep(90, 520, Math.abs(x - testWorldValleyX(z)));
  const floor = 6 * fbm(x / 300, z / 300, 3, seed);
  const hills = 45 * fbm(x / 650, z / 650, 4, seed + 7);
  const peaks = 240 * ridged(x / 900, z / 900, 6, seed + 13);
  return Math.min(HEIGHT_MAX - 6, Math.max(HEIGHT_MIN + 6, floor + mountains * (hills + mountains * peaks)));
}

/**
 * Writes grass, dirt road, rock, snow weights (bytes summing to 255) from
 * height, slope and the distance to the road into `out[offset..offset + 3]`.
 */
function writeLayerWeights(out: Uint8Array, offset: number, height: number, slope: number, roadDistance: number): void {
  const snow = smoothstep(150, 185, height) * (1 - smoothstep(1.1, 1.6, slope) * 0.6);
  const rock = smoothstep(0.45, 0.85, slope) * (1 - snow);
  const dirt = (1 - smoothstep(6, 14, roadDistance)) * (1 - rock) * (1 - snow);
  // Each byte is capped by what is left, so rounding up can never overflow
  // the 255 sum; grass takes the rest.
  const snowByte = Math.round(snow * 255);
  const rockByte = Math.min(Math.round(rock * 255), 255 - snowByte);
  const dirtByte = Math.min(Math.round(dirt * 255), 255 - snowByte - rockByte);
  out[offset] = 255 - snowByte - rockByte - dirtByte;
  out[offset + 1] = dirtByte;
  out[offset + 2] = rockByte;
  out[offset + 3] = snowByte;
}

export function generateTestWorld(options: TestWorldOptions = {}): TestWorld {
  const tiles = options.tiles ?? 16;
  const tileQuads = options.tileQuads ?? 256;
  const spacing = options.spacing ?? 1;
  const seed = options.seed ?? 1337;
  const extent = tiles * tileQuads * spacing;
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Open World Test", tileQuads, spacing, tilesX: tiles, tilesZ: tiles,
    origin: [-extent / 2, 0, -extent / 2], heightMin: HEIGHT_MIN, heightMax: HEIGHT_MAX,
    layers: [
      { id: "grass", name: "Grass", color: "#5f9449" },
      { id: "dirt", name: "Dirt", color: "#8a6441" },
      { id: "rock", name: "Rock", color: "#7f8485" },
      { id: "snow", name: "Snow", color: "#dce7ec" },
    ],
    tiles: [], collision: true,
  };
  const size = tileQuads + 1;
  const decoded = new Map<string, TerrainTileData>();
  const tileBytes = new Map<string, Uint8Array>();
  // One-sample border so the slope at a tile edge sees its neighbour's terrain.
  const padded = new Float32Array((size + 2) * (size + 2));
  for (let tz = 0; tz < tiles; tz += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      for (let z = -1; z <= size; z += 1) {
        for (let x = -1; x <= size; x += 1) {
          const worldX = def.origin[0] + (tx * tileQuads + x) * spacing;
          const worldZ = def.origin[2] + (tz * tileQuads + z) * spacing;
          padded[(z + 1) * (size + 2) + (x + 1)] = heightAtWorld(worldX, worldZ, seed);
        }
      }
      const heights = new Float32Array(size * size);
      const weights = new Uint8Array(size * size * 4);
      const row = size + 2;
      for (let z = 0; z < size; z += 1) {
        const worldZ = def.origin[2] + (tz * tileQuads + z) * spacing;
        const roadX = testWorldValleyX(worldZ);
        for (let x = 0; x < size; x += 1) {
          const centre = (z + 1) * row + x + 1;
          const height = padded[centre]!;
          heights[z * size + x] = height;
          const slope = Math.hypot(padded[centre + 1]! - padded[centre - 1]!, padded[centre + row]! - padded[centre - row]!) / (2 * spacing);
          const worldX = def.origin[0] + (tx * tileQuads + x) * spacing;
          writeLayerWeights(weights, (z * size + x) * 4, height, slope, Math.abs(worldX - roadX));
        }
      }
      const key = tileKey(tx, tz);
      const bytes = encodeTerrainTile({ x: tx, z: tz, size, heights, layerCount: 4, weights }, { heightMin: HEIGHT_MIN, heightMax: HEIGHT_MAX });
      const tile = decodeTerrainTile(bytes);
      const range = terrainTileHeightRange(tile);
      def.tiles.push({ key, minHeight: range.min, maxHeight: range.max });
      decoded.set(key, { x: tile.x, z: tile.z, size: tile.size, heights: tile.heights, layerCount: tile.layerCount, weights: tile.weights });
      tileBytes.set(key, bytes);
    }
  }
  const globalBytes = encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, decoded)));
  const lookup = { tile: (x: number, z: number) => decoded.get(tileKey(x, z)) };
  const heightAt = (x: number, z: number) => terrainHeightAt(def, lookup, x, z);
  const spawnZ = 500;
  const spawnX = testWorldValleyX(spawnZ);
  return { def, tiles: decoded, tileBytes, globalBytes, spawn: [spawnX, heightAt(spawnX, spawnZ)! + 2, spawnZ], heightAt };
}

/** A playable level around the terrain: sun, sky, fog, the starter Game Mode and a Player Start. */
export function testWorldLevel(world: TestWorld, terrainPath: string, name = "OpenWorldTest"): Record<string, unknown> {
  return {
    schema: 1,
    name,
    loadGroups: [],
    instances: [{
      assetId: "marker:playerStart",
      placements: [{ position: world.spawn, name: "Player Start", collision: false, rotationYDeg: 0, scale: 1 }],
    }],
    characters: [],
    worldSettings: {
      backgroundColor: "#a9c9df", ambientColor: "#cfdeed", ambientIntensity: 0.55,
      gameMode: "assets/starter-content/Gameplay/Script_GameMode.actor.json",
    },
    skyAtmosphere: { rayleigh: 1.4, turbidity: 3, mie: 0.003, mieDirectionalG: 0.8 },
    lights: [{ id: "sun", type: "directional", position: [3, 9, 4], name: "Sun", rotation: [-55, 35, 0], color: "#ffffff", intensity: 2, castShadow: true }],
    landscapes: [{ id: "world", name: "World Terrain", position: worldTerrainActorPosition(world.def), dataRef: terrainPath }],
  };
}
