/**
 * The off-road surface test level (TERRAIN_DEFORMATION Faz 1b): a 256 × 256 m
 * World Terrain of 2×2 tiles with gentle relief. A dirt road runs along +Z
 * through a mud, a snow and a sand patch, so one straight drive from the car's
 * start crosses every soft surface; the fields either side are grass.
 *
 * Paint layers name built-in physical materials (grass and dirt stay neutral),
 * which is what the level exists to exercise. Small enough to commit: `npm run
 * world:offroad` rewrites it deterministically (the manifest record is kept by hand).
 */
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { decodeTerrainTile, encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import {
  terrainTileHeightRange, terrainWeightBlockCount, tileKey, TERRAIN_LAYERS_PER_WEIGHT_BLOCK,
  type TerrainTileData, type WorldTerrainDef,
} from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";

// Beside the other starter test levels, so the Content Browser can open it; the
// level is registered in the manifest and owns its terrain folder.
export const OFFROAD_TEST_LEVEL = "assets/starter-content/Levels/OffroadTest.level.json";
export const OFFROAD_TEST_TERRAIN = "assets/starter-content/Levels/OffroadTest.landscapes/offroad.terrain.json";

const TILES = 2;
const TILE_QUADS = 128;
const SPACING = 1;
const HEIGHT_MIN = -32;
const HEIGHT_MAX = 32;
const ROAD_HALF_WIDTH = 4;
/** Soft patches along the road: [layer index, start Z, end Z]. */
const PATCHES: readonly (readonly [number, number, number])[] = [[2, -70, -30], [3, -10, 30], [4, 50, 90]];
/** Metres a patch edge fades over, so grip blends instead of switching. */
const EDGE = 3;
/** The car's start: on the road, south of the first patch, facing +Z. */
export const OFFROAD_TEST_START: readonly [number, number] = [0, -105];

export interface OffroadTestWorld {
  def: WorldTerrainDef;
  tiles: Map<string, TerrainTileData>;
  tileBytes: Map<string, Uint8Array>;
  globalBytes: Uint8Array;
  heightAt(x: number, z: number): number | null;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 0..1 inside a patch spanning [start, end] along Z and the road plus a shoulder across X. */
function patchWeight(x: number, z: number, start: number, end: number): number {
  const along = smoothstep(start - EDGE, start, z) * (1 - smoothstep(end, end + EDGE, z));
  return along * (1 - smoothstep(ROAD_HALF_WIDTH + 12, ROAD_HALF_WIDTH + 12 + EDGE, Math.abs(x)));
}

function heightAtWorld(x: number, z: number): number {
  const relief = 1.2 * Math.sin(x / 23) * Math.cos(z / 31) + 0.6 * Math.sin((x + z) / 47);
  // The road corridor flattens out so the drive itself stays level.
  const road = 1 - smoothstep(ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + 10, Math.abs(x));
  // Soft patches sit in shallow hollows, which reads as wet ground.
  const hollow = PATCHES.reduce((depth, [, start, end]) => Math.max(depth, patchWeight(x, z, start, end)), 0) * 0.3;
  return relief * (1 - road * 0.9) - hollow;
}

/** grass, dirt, mud, snow, sand weights at one vertex; they sum to 1. */
function layerWeights(x: number, z: number): number[] {
  const weights = [0, 0, 0, 0, 0];
  let rest = 1;
  for (const [layer, start, end] of PATCHES) {
    const weight = Math.min(rest, patchWeight(x, z, start, end));
    weights[layer] = weight;
    rest -= weight;
  }
  weights[1] = rest * (1 - smoothstep(ROAD_HALF_WIDTH - 1, ROAD_HALF_WIDTH + 1, Math.abs(x)));
  weights[0] = rest - weights[1];
  return weights;
}

export function generateOffroadTestWorld(): OffroadTestWorld {
  const extent = TILES * TILE_QUADS * SPACING;
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Offroad Test", tileQuads: TILE_QUADS, spacing: SPACING,
    tilesX: TILES, tilesZ: TILES, origin: [-extent / 2, 0, -extent / 2], heightMin: HEIGHT_MIN, heightMax: HEIGHT_MAX,
    layers: [
      { id: "grass", name: "Grass", color: "#5f9449" },
      { id: "dirt", name: "Dirt Road", color: "#8a6441" },
      { id: "mud", name: "Mud", color: "#4a3626", physicalMaterial: "mud" },
      { id: "snow", name: "Snow", color: "#dce7ec", physicalMaterial: "snow" },
      { id: "sand", name: "Sand", color: "#c9a96b", physicalMaterial: "sand" },
    ],
    tiles: [], collision: true,
  };
  const size = TILE_QUADS + 1;
  const count = size * size;
  const layerCount = def.layers.length;
  const tiles = new Map<string, TerrainTileData>();
  const tileBytes = new Map<string, Uint8Array>();
  for (let tz = 0; tz < TILES; tz += 1) {
    for (let tx = 0; tx < TILES; tx += 1) {
      const heights = new Float32Array(count);
      const weights = new Uint8Array(terrainWeightBlockCount(layerCount) * count * 4);
      for (let z = 0; z < size; z += 1) {
        for (let x = 0; x < size; x += 1) {
          const worldX = def.origin[0] + (tx * TILE_QUADS + x) * SPACING;
          const worldZ = def.origin[2] + (tz * TILE_QUADS + z) * SPACING;
          const vertex = z * size + x;
          heights[vertex] = heightAtWorld(worldX, worldZ);
          // Bytes are capped by what is left so rounding never overflows 255; grass takes the rest.
          let left = 255;
          const bytes = layerWeights(worldX, worldZ).map((weight, layer) => {
            if (layer === 0) return 0;
            const byte = Math.min(Math.round(weight * 255), left);
            left -= byte;
            return byte;
          });
          bytes[0] = left;
          bytes.forEach((byte, layer) => {
            const block = Math.floor(layer / TERRAIN_LAYERS_PER_WEIGHT_BLOCK);
            weights[block * count * 4 + vertex * 4 + (layer % TERRAIN_LAYERS_PER_WEIGHT_BLOCK)] = byte;
          });
        }
      }
      const key = tileKey(tx, tz);
      const bytes = encodeTerrainTile({ x: tx, z: tz, size, heights, layerCount, weights }, { heightMin: HEIGHT_MIN, heightMax: HEIGHT_MAX });
      const tile = decodeTerrainTile(bytes);
      const range = terrainTileHeightRange(tile);
      def.tiles.push({ key, minHeight: range.min, maxHeight: range.max });
      tiles.set(key, { x: tile.x, z: tile.z, size: tile.size, heights: tile.heights, layerCount: tile.layerCount, weights: tile.weights });
      tileBytes.set(key, bytes);
    }
  }
  const globalBytes = encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, tiles)));
  const lookup = { tile: (x: number, z: number) => tiles.get(tileKey(x, z)) };
  return { def, tiles, tileBytes, globalBytes, heightAt: (x, z) => terrainHeightAt(def, lookup, x, z) };
}

/** Sun, sky, the Vehicle game mode and the reference car on the road. */
export function offroadTestLevel(world: OffroadTestWorld, terrainPath: string): Record<string, unknown> {
  const [startX, startZ] = OFFROAD_TEST_START;
  return {
    schema: 1,
    name: "OffroadTest",
    loadGroups: [],
    instances: [],
    characters: [],
    worldSettings: {
      backgroundColor: "#a9c9df", ambientColor: "#cfdeed", ambientIntensity: 0.55,
      killZ: -40, gameMode: "forge.vehicle",
    },
    skyAtmosphere: { rayleigh: 1.4, turbidity: 3, mie: 0.003, mieDirectionalG: 0.8 },
    lights: [{ id: "sun", type: "directional", position: [3, 9, 4], name: "Sun", rotation: [-55, 35, 0], color: "#ffffff", intensity: 2, castShadow: true }],
    landscapes: [{ id: "offroad", name: "Offroad Terrain", position: worldTerrainActorPosition(world.def), dataRef: terrainPath }],
    actors: [{
      classRef: "assets/starter-content/Gameplay/Script_ReferenceCar.actor.json",
      position: [startX, world.heightAt(startX, startZ)! + 1, startZ],
      rotationYDeg: 0,
      scale: 1,
    }],
  };
}
