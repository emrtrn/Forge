/**
 * World Builder test valley (F1 step 19, WbTestValley): the mountain test the
 * settlement chain is measured against, reproducible. A 512 m square, 4×4
 * tiles of 64 quads at 2 m: an 80 m wide valley floor meandering along X
 * (falling 1 cm per metre eastwards), slopes rising ~85 m over 180 m on both
 * sides, light fBm on top. The northern slope breaks at a bench ~25 m up and
 * ~70 m wide (steep below and above it, 35–45°), as mountain valleys do. Its
 * recipe plans a 120-person village on the floor, a 25-person hamlet drawn
 * just above the bench — on ground too steep to build, as an image-read plan
 * lands a few per cent off — the valley road and a track up to the hamlet (20°
 * limit in the neutral profile: steeper than the slopes it climbs, so it needs
 * a serpentine).
 *
 * The height is a pure function, so engine tests run the chain without terrain
 * files (`tests/engine/wbTestValley.test.ts`); `npm run world:valley` writes
 * the level, terrain, recipe and profile under `public/layouts/` for the
 * editor. Generated, never committed.
 */
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainTileHeightRange, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { createFlatWorldTerrain } from "../../engine/terrain/worldTerrainCreate";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { createWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { fbm } from "./testWorld";

// Under layouts/, not assets/: generated content stays out of the manifest (like OpenWorldTest).
export const WB_TEST_VALLEY_LEVEL = "layouts/WbTestValley.level.json";
export const WB_TEST_VALLEY_TERRAIN = "layouts/WbTestValley.landscapes/valley.terrain.json";
export const WB_TEST_VALLEY_PROFILE = "layouts/WbTestValley.regionprofile.json";
export const WB_TEST_VALLEY_TERRAIN_ID = "valley";

/** Half the valley square, metres. */
export const WB_TEST_VALLEY_HALF = 256;
const TILES = 4;
const TILE_QUADS = 64;
const SPACING = 2;
const FLOOR_HALF_WIDTH = 40;
const SLOPE_RUN = 180;
const SLOPE_RISE = 85;
const NOISE = 3;
/** Northern bench: share of the rise below it, and where it starts and ends across the slope (0..1). */
const BENCH_SHARE = 0.3;
const BENCH: [number, number] = [0.25, 0.65];
const SEED = 19;

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** The valley floor's centre line. */
export function wbTestValleyAxisZ(x: number): number {
  return 30 * Math.sin(x / 110);
}

/** Ground height, metres; null outside the square. */
export function wbTestValleyHeight(x: number, z: number): number | null {
  if (Math.abs(x) > WB_TEST_VALLEY_HALF || Math.abs(z) > WB_TEST_VALLEY_HALF) return null;
  const side = z - wbTestValleyAxisZ(x);
  const across = (Math.abs(side) - FLOOR_HALF_WIDTH) / SLOPE_RUN;
  const up = side > 0
    ? BENCH_SHARE * smoothstep(across / BENCH[0]) + (1 - BENCH_SHARE) * smoothstep((across - BENCH[1]) / (1 - BENCH[1]))
    : smoothstep(across) ** 1.3;
  return 6 - 0.01 * x + SLOPE_RISE * up + NOISE * fbm(x / 60, z / 60, 3, SEED);
}

/** Middle of the northern bench at `x`. */
export function wbTestValleyBenchZ(x: number): number {
  return wbTestValleyAxisZ(x) + FLOOR_HALF_WIDTH + SLOPE_RUN * (BENCH[0] + BENCH[1]) / 2;
}

const floor = (x: number): WorldPoint => [x, Math.round(wbTestValleyAxisZ(x) * 100) / 100];

/** Where the hamlet is drawn: 12 m above the bench's upper edge, on the steep slope. */
const HAMLET_PLANNED: WorldPoint = [90, 195];

/** The plan: village on the floor, hamlet up the northern slope, valley road and a track to the hamlet. */
export function wbTestValleyRecipe(): WorldRecipe {
  const recipe = createWorldRecipe("wb_test_valley", 19);
  recipe.regionProfile = WB_TEST_VALLEY_PROFILE;
  recipe.plan.settlements.push(
    { id: "village", source: "manual", center: floor(-40), type: "village", population: 120 },
    { id: "hamlet", source: "manual", center: HAMLET_PLANNED, type: "hamlet", population: 25 },
  );
  recipe.plan.roadGraph.nodes.push(
    { id: "west", source: "manual", position: floor(-250), kind: "end" },
    { id: "fork", source: "manual", position: floor(90), kind: "junction" },
    { id: "east", source: "manual", position: floor(250), kind: "end" },
    { id: "hamlet-end", source: "manual", position: HAMLET_PLANNED, kind: "end", settlement: "hamlet" },
  );
  recipe.plan.roadGraph.edges.push(
    { id: "valley-west", source: "manual", from: "west", to: "fork", roadClass: "local" },
    { id: "valley-east", source: "manual", from: "fork", to: "east", roadClass: "local" },
    { id: "hamlet-track", source: "manual", from: "fork", to: "hamlet-end", roadClass: "track" },
  );
  return recipe;
}

export interface WbTestValley {
  def: WorldTerrainDef;
  tiles: Map<string, TerrainTileData>;
  /** Encoded `<x>_<z>.tile.bin` bodies (f32 heights: no quantisation against the analytic height). */
  tileBytes: Map<string, Uint8Array>;
  globalBytes: Uint8Array;
  level: Record<string, unknown>;
  recipe: WorldRecipe;
}

export function generateWbTestValley(): WbTestValley {
  const world = createFlatWorldTerrain({
    name: "WB Test Valley", tilesX: TILES, tilesZ: TILES, tileQuads: TILE_QUADS, spacing: SPACING, baseHeight: 0,
    heightMin: -32, heightMax: 160,
  });
  const { def, tiles } = world;
  const size = TILE_QUADS + 1;
  const tileBytes = new Map<string, Uint8Array>();
  for (const summary of def.tiles) {
    const tile = tiles.get(summary.key)!;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const x = def.origin[0] + (tile.x * TILE_QUADS + i) * SPACING;
        const z = def.origin[2] + (tile.z * TILE_QUADS + j) * SPACING;
        tile.heights[j * size + i] = wbTestValleyHeight(x, z) ?? 0;
      }
    }
    const range = terrainTileHeightRange(tile);
    summary.minHeight = range.min;
    summary.maxHeight = range.max;
    tileBytes.set(summary.key, encodeTerrainTile(tile, { ...def, heightFormat: "f32" }));
  }
  const globalBytes = encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, tiles)));
  const village = floor(-40);
  const level = {
    schema: 1,
    name: "WbTestValley",
    loadGroups: [],
    instances: [{
      assetId: "marker:playerStart",
      placements: [{ position: [village[0], (wbTestValleyHeight(...village) ?? 0) + 2, village[1]], name: "Player Start", collision: false, rotationYDeg: 0, scale: 1 }],
    }],
    characters: [],
    worldSettings: { backgroundColor: "#a9c9df", ambientColor: "#cfdeed", ambientIntensity: 0.55 },
    skyAtmosphere: { rayleigh: 1.4, turbidity: 3, mie: 0.003, mieDirectionalG: 0.8 },
    lights: [{ id: "sun", type: "directional", position: [3, 9, 4], name: "Sun", rotation: [-55, 35, 0], color: "#ffffff", intensity: 2, castShadow: true }],
    landscapes: [{ id: WB_TEST_VALLEY_TERRAIN_ID, name: "WB Test Valley", position: worldTerrainActorPosition(def), dataRef: WB_TEST_VALLEY_TERRAIN }],
  };
  return { def, tiles, tileBytes, globalBytes, level, recipe: wbTestValleyRecipe() };
}
