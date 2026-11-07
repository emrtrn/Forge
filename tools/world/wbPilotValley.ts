/**
 * World Builder pilot (docs/world-builder/PILOT_MOUNTAIN_VALLEY.md): a 1 km
 * mountain valley built end to end without the editor, to find where the
 * design-document chain breaks before any of it is automated.
 *
 * `PILOT_ROWS` are measured from the approved map
 * (`art/world-pilot/references/pilot-plan-map.png`), so the ground follows it.
 * The map's climb to the cabin is not used: its switchbacks run straight up
 * the slope. The plan keeps the two ends and the `roads` stage solves the route.
 *
 * Heights and paint are written here because no stage owns them yet; the river
 * bed and the cabin's level ground are part of that. The road goes through the
 * real `roads` stage, spline bake and pad bake, the same code the editor runs.
 *
 * Pure and deterministic. `npm run world:pilot` writes the result under
 * `public/layouts/`. Generated, never committed.
 */
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { applyTerrainUndoPatches, createTerrainEditWorld, quantizeTerrainWeights } from "../../engine/terrain/terrainEdit";
import { createTerrainPadPatches, type TerrainPad } from "../../engine/terrain/terrainPads";
import { createTerrainSplinePatches } from "../../engine/terrain/terrainSplines";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import {
  createFlatTerrainTile,
  terrainTileHeightRange,
  type TerrainTileData,
  type WorldTerrainDef,
  type WorldTerrainLayerDef,
  type WorldTerrainSpline,
} from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { createFlatWorldTerrain } from "../../engine/terrain/worldTerrainCreate";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { createWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import { planStage, type StagePlan, type StageTerrain } from "../../engine/worldbuilder/stage";
import { roadsStage } from "../../engine/worldbuilder/stages/roads";
import { fbm, ridged } from "./testWorld";

export const WB_PILOT_LEVEL = "layouts/WbPilotValley.level.json";
export const WB_PILOT_TERRAIN = "layouts/WbPilotValley.landscapes/valley.terrain.json";
export const WB_PILOT_PROFILE = "layouts/WbPilotValley.regionprofile.json";
export const WB_PILOT_REFERENCE = "layouts/WbPilotValley.reference.png";
export const WB_PILOT_FOLIAGE = "layouts/WbPilotValley.foliage.json";
export const WB_PILOT_TERRAIN_ID = "valley";

const TILES = 8;
const TILE_QUADS = 128;
const SPACING = 1;
const SEED = 20261107;

/** Slope of the valley sides, tan 20°. */
const SLOPE = 0.364;
/** Horizontal distance over which the valley floor eases into the slope, metres. */
const SLOPE_FOOT = 18;
/** Spurs and gullies running down the slopes, and the broken ground of the high rock, metres. */
const SPUR_RELIEF = 26;
const RIDGE_RELIEF = 16;
const RELIEF = 10;
const RIVER_BED_HALF_WIDTH = 5.5;
const RIVER_BANK = 7;
const RIVER_DEPTH = 1.8;
const RIVER_SURFACE_DROP = 0.9;
const MEADOW_FADE: [number, number] = [6, 30];
const ROCK_FADE = 30;

/** Ground the map shows at this `z`, world metres. */
interface PilotRow {
  z: number;
  river: number;
  floorW: number;
  floorE: number;
  rockW: number;
  rockE: number;
}

/** Every 50 m from north to south. */
export const PILOT_ROWS: readonly PilotRow[] = [
  { z: -500, river: -1, floorW: -75, floorE: 63.8, rockW: -417.9, rockE: 411.5 },
  { z: -450, river: 8, floorW: -56.6, floorE: 66.2, rockW: -394.7, rockE: 399.5 },
  { z: -400, river: 4.8, floorW: -51.8, floorE: 61.4, rockW: -376.4, rockE: 375.6 },
  { z: -350, river: -12.8, floorW: -67, floorE: 43.9, rockW: -413.9, rockE: 357.3 },
  { z: -300, river: -19.1, floorW: -81.3, floorE: 31.9, rockW: -430.6, rockE: 382 },
  { z: -250, river: -8.8, floorW: -72, floorE: 38.3, rockW: -459.3, rockE: 421.1 },
  { z: -200, river: 1.6, floorW: -66, floorE: 59, rockW: -463.3, rockE: 421.9 },
  { z: -150, river: -5.6, floorW: -65, floorE: 51, rockW: -432.2, rockE: 437.8 },
  { z: -100, river: -18.3, floorW: -67, floorE: 41.5, rockW: -386.8, rockE: 427.4 },
  { z: -50, river: -14.4, floorW: -63, floorE: 52.6, rockW: -378, rockE: 393.1 },
  { z: 0, river: -1.6, floorW: -59.8, floorE: 57.4, rockW: -382.8, rockE: 365.2 },
  { z: 50, river: -1.6, floorW: -54.2, floorE: 59, rockW: -416.3, rockE: 353.3 },
  { z: 100, river: -14.4, floorW: -59, floorE: 44.7, rockW: -449, rockE: 334.1 },
  { z: 150, river: -19.9, floorW: -66.2, floorE: 51, rockW: -459.3, rockE: 377.2 },
  { z: 200, river: -8.8, floorW: -63.8, floorE: 38.3, rockW: -417.1, rockE: 421.9 },
  { z: 250, river: 1.6, floorW: -62.2, floorE: 48.6, rockW: -391.5, rockE: 437 },
  { z: 300, river: -4, floorW: -56.6, floorE: 54.2, rockW: -425.8, rockE: 401.1 },
  { z: 350, river: -15.2, floorW: -75.8, floorE: 47.8, rockW: -432.2, rockE: 384.4 },
  { z: 400, river: -5.6, floorW: -73.4, floorE: 57.4, rockW: -388.4, rockE: 376.4 },
  { z: 450, river: 2.4, floorW: -60.6, floorE: 59.8, rockW: -375.6, rockE: 405.9 },
  { z: 500, river: -3.2, floorW: -70.2, floorE: 51.8, rockW: -361.2, rockE: 423.4 },
];

/** The road's line along the valley floor, as drawn on the map, south to north. */
const VALLEY_ROAD_GUIDE: readonly WorldPoint[] = [
  [-39, 401], [-41, 353], [-35, 305], [-32, 258], [-39, 210], [-45, 162], [-40, 114], [-33, 66], [-31, 18], [-33, -30], [-40, -77],
];
const ROAD_SOUTH: WorldPoint = [-36, 497];
export const ROAD_TURNOFF: WorldPoint = [-66, -109];
export const CABIN: WorldPoint = [-215, -227];
const CABIN_PAD_HALF = 15;
const CABIN_PAD_FALLOFF = 20;
/** Where the road meets the level ground, just inside its south edge. */
export const ROAD_END: WorldPoint = [CABIN[0], CABIN[1] + CABIN_PAD_HALF - 2];
const CLEARING_RADIUS = 38;
const ROCKS_ON_HIGH_GROUND = 90;
const ROCKS_ON_SLOPES = 24;
const ROCKS_BY_RIVER = 18;
const FENCE_MODULE = 3;

export const PILOT_LAYERS: WorldTerrainLayerDef[] = [
  { id: "meadow", name: "Meadow", color: "#6f9a4a", material: "lt-meadow", physicalMaterial: "default" },
  { id: "forest", name: "Forest Floor", color: "#3f4f2c", material: "starter-mat-grass", physicalMaterial: "default" },
  { id: "rock", name: "Rock", color: "#8b8a84", material: "lt-rock", physicalMaterial: "default" },
  { id: "dirt", name: "Dirt", color: "#8a6441", material: "lt-earth", physicalMaterial: "default" },
  { id: "riverbed", name: "River Bed", color: "#6f6a5c", material: "m-gravel-material", physicalMaterial: "default" },
];

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Catmull-Rom through the rows, so the 50 m measurements leave no kinks. */
function rowValue(z: number, read: (row: PilotRow) => number): number {
  const last = PILOT_ROWS.length - 1;
  const position = Math.min(last, Math.max(0, (z - PILOT_ROWS[0]!.z) / 50));
  const index = Math.min(last - 1, Math.floor(position));
  const t = position - index;
  const value = (at: number): number => read(PILOT_ROWS[Math.min(last, Math.max(0, at))]!);
  const [a, b, c, d] = [value(index - 1), value(index), value(index + 1), value(index + 2)];
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
}

/** Valley floor level on the river's line: 100 m in the north, 90 m in the south. */
function floorLevel(z: number): number {
  return 95 - 0.01 * z;
}

/** The water's level at `z`, always below both banks. */
export function pilotRiverSurface(z: number): number {
  return floorLevel(z) - RIVER_SURFACE_DROP;
}

export function pilotRiverX(z: number): number {
  return rowValue(z, (row) => row.river);
}

/** Distance out of the valley floor at this point; 0 on the floor. */
function slopeDistance(x: number, z: number): number {
  const west = rowValue(z, (row) => row.floorW);
  const east = rowValue(z, (row) => row.floorE);
  return x < west ? west - x : x > east ? x - east : 0;
}

/** Distance past the map's rock edge on this point's side; negative below it. */
function rockEdge(x: number, z: number): number {
  return x < 0 ? rowValue(z, (row) => row.rockW) - x : x - rowValue(z, (row) => row.rockE);
}

/** Ground before the road and the cabin level anything, metres. */
export function pilotBaseHeight(x: number, z: number): number {
  const out = slopeDistance(x, z);
  const rise = SLOPE * (Math.hypot(out, SLOPE_FOOT) - SLOPE_FOOT);
  const spurs = SPUR_RELIEF * smoothstep(out / 240) * fbm(x / 420, z / 150, 3, SEED + 3);
  const rocky = RIDGE_RELIEF * smoothstep((rockEdge(x, z) + 60) / 120) * ridged(x / 150, z / 110, 4, SEED + 5);
  const relief = RELIEF * smoothstep(out / 160) * fbm(x / 130, z / 130, 4, SEED) + spurs + rocky;
  const floorRoll = 0.6 * (1 - smoothstep(out / 30)) * fbm(x / 45, z / 45, 2, SEED + 7);
  const ground = floorLevel(z) + rise + relief + floorRoll;
  const toRiver = Math.abs(x - pilotRiverX(z));
  const bed = 1 - smoothstep((toRiver - RIVER_BED_HALF_WIDTH) / RIVER_BANK);
  return ground + (floorLevel(z) - RIVER_DEPTH - ground) * bed;
}

/** Paint weights in `PILOT_LAYERS` order. */
function pilotWeights(x: number, z: number): number[] {
  const wobble = 10 * fbm(x / 35, z / 35, 3, SEED + 13);
  const out = slopeDistance(x, z) + wobble;
  const rock = smoothstep((rockEdge(x, z) + wobble) / ROCK_FADE);
  const clearing = 1 - smoothstep((Math.hypot(x - CABIN[0], z - CABIN[1]) + wobble - CLEARING_RADIUS) / 12);
  const forest = smoothstep((out - MEADOW_FADE[0]) / (MEADOW_FADE[1] - MEADOW_FADE[0])) * (1 - clearing);
  const riverbed = 1 - smoothstep((Math.abs(x - pilotRiverX(z)) - RIVER_BED_HALF_WIDTH) / 3);
  const open = (1 - rock) * (1 - riverbed);
  return [open * (1 - forest), open * forest, rock * (1 - riverbed), 0, riverbed];
}

function writeWeights(tile: TerrainTileData, index: number, weights: number[]): void {
  const bytes = quantizeTerrainWeights(weights);
  bytes.forEach((weight, layer) => {
    tile.weights[Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4] = weight;
  });
}

/** Neutral road sizes for a remote valley: one dirt surface, no road mesh. */
export function pilotRegionProfile(neutral: unknown): RegionProfile {
  const source = structuredClone(neutral) as { id: string; label: string; roads: Record<string, unknown> };
  source.id = "wb_pilot_valley";
  source.label = "World Builder pilot valley";
  source.roads.local = { width: 4, shoulder: 0, maxSlopeDeg: 10, minTurnRadius: 10, surfaceLayer: "Dirt" };
  source.roads.track = { width: 4, shoulder: 0, maxSlopeDeg: 12, minTurnRadius: 8, surfaceLayer: "Dirt" };
  const { profile, issues } = normalizeRegionProfile(source);
  if (!profile || issues.length > 0) throw new Error(`Pilot region profile: ${issues.map((issue) => issue.message).join("; ")}`);
  return profile;
}

const seen = { source: "reference" as const, observed: true, confidence: 0.9 };

function regionPolygon(west: (row: PilotRow) => number, east: (row: PilotRow) => number): WorldPoint[] {
  return [
    ...PILOT_ROWS.map((row): WorldPoint => [west(row), row.z]),
    ...[...PILOT_ROWS].reverse().map((row): WorldPoint => [east(row), row.z]),
  ];
}

/** What the design document and the map say; the stages turn it into geometry. */
export function wbPilotRecipe(): WorldRecipe {
  const recipe = createWorldRecipe("wb_pilot_valley", SEED);
  recipe.regionProfile = WB_PILOT_PROFILE;
  recipe.reference = { image: WB_PILOT_REFERENCE, origin: [-500, -500], size: [1000, 1000], view: "topDown" };
  recipe.plan.water.push({ id: "river", kind: "river", path: PILOT_ROWS.map((row): WorldPoint => [row.river, row.z]), ...seen });
  recipe.plan.regions.push(
    { id: "valley-floor", kind: "valley", polygon: regionPolygon((row) => row.floorW, (row) => row.floorE), ...seen },
    { id: "forest-west", kind: "forest.conifer", polygon: regionPolygon((row) => row.rockW, (row) => row.floorW), ...seen },
    { id: "forest-east", kind: "forest.conifer", polygon: regionPolygon((row) => row.floorE, (row) => row.rockE), ...seen },
  );
  recipe.plan.landmarks.push({ id: "cabin", kind: "building.cabin", position: CABIN, ...seen });
  recipe.plan.roadGraph.nodes.push(
    { id: "south", position: ROAD_SOUTH, kind: "end", ...seen },
    { id: "turnoff", position: ROAD_TURNOFF, kind: "junction", ...seen },
    { id: "cabin-end", position: ROAD_END, kind: "end", ...seen },
  );
  recipe.plan.roadGraph.edges.push(
    { id: "valley", from: "south", to: "turnoff", roadClass: "local", guide: [...VALLEY_ROAD_GUIDE], ...seen },
    { id: "climb", source: "manual", from: "turnoff", to: "cabin-end", roadClass: "track" },
  );
  return recipe;
}

function riverSpline(): WorldTerrainSpline {
  const points = PILOT_ROWS.map((row, index) => ({
    id: `p${index}`,
    position: [row.river, Number(pilotRiverSurface(row.z).toFixed(3)), row.z] as [number, number, number],
    width: 9,
    falloff: 2,
  }));
  return {
    id: "river",
    name: "River",
    smooth: true,
    coordinateSpace: "world",
    points,
    segments: points.slice(1).map((point, index) => ({ id: `s${index}`, startPointId: points[index]!.id, endPointId: point.id })),
  };
}

interface PilotPlacement {
  id: string;
  role: string;
  name: string;
  position: [number, number, number];
  rotationYDeg: number;
  scale: number;
  collision: boolean;
}

/** A small deterministic generator, so a run rebuilds the same scatter. */
function pilotRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything standing on the ground except plants. Roles keep them swappable for final models. */
function pilotPlacements(sampleHeight: (x: number, z: number) => number | null): Map<string, PilotPlacement[]> {
  const groups = new Map<string, PilotPlacement[]>();
  const place = (assetId: string, placement: Omit<PilotPlacement, "position"> & { at: WorldPoint }): void => {
    const { at, ...rest } = placement;
    const height = sampleHeight(at[0], at[1]);
    if (height === null) throw new Error(`Pilot placement ${placement.id} is off the terrain`);
    const position: [number, number, number] = [at[0], Number(height.toFixed(3)), at[1]];
    groups.set(assetId, [...(groups.get(assetId) ?? []), { ...rest, position }]);
  };
  place("wp-cabin", { id: "cabin", role: "building.cabin", name: "Cabin", at: CABIN, rotationYDeg: 0, scale: 1, collision: true });
  place("wp-woodpile", {
    id: "woodpile", role: "prop.woodpile", name: "Woodpile", at: [CABIN[0] + 5.5, CABIN[1] + 1], rotationYDeg: 0, scale: 1, collision: true,
  });
  place("wp-signpost", {
    id: "signpost", role: "prop.signpost", name: "Signpost", at: [ROAD_TURNOFF[0] + 7, ROAD_TURNOFF[1] + 8], rotationYDeg: 0, scale: 1, collision: false,
  });
  for (let index = 0; index < 8; index += 1) {
    place("wp-fence-module", {
      id: `fence-north-${index}`, role: "prop.fence", name: `Fence North ${index}`, collision: false, scale: 1, rotationYDeg: 0,
      at: [CABIN[0] - 10.5 + index * FENCE_MODULE, CABIN[1] - 13],
    });
  }
  for (let index = 0; index < 7; index += 1) {
    place("wp-fence-module", {
      id: `fence-west-${index}`, role: "prop.fence", name: `Fence West ${index}`, collision: false, scale: 1, rotationYDeg: 90,
      at: [CABIN[0] - 12, CABIN[1] - 11.5 + index * FENCE_MODULE],
    });
  }

  const random = pilotRandom(SEED);
  const rock = (id: string, at: WorldPoint, scale: number): void => {
    const variant = "abc"[Math.floor(random() * 3)]!;
    place(`wp-rock-${variant}`, {
      id, role: "prop.rock", name: id, at, scale: Number(scale.toFixed(2)), collision: scale > 1.2,
      rotationYDeg: Math.round(random() * 360),
    });
  };
  const span = (range: number): number => (random() * 2 - 1) * range;
  const near = (at: WorldPoint, distance: number): boolean =>
    Math.hypot(at[0] - CABIN[0], at[1] - CABIN[1]) < distance;
  const offRoad = (at: WorldPoint): boolean => !near(at, CLEARING_RADIUS + 6)
    && !(at[0] > -240 && at[0] < -30 && at[1] > -240 && at[1] < -90);
  for (let index = 0, tries = 0; index < ROCKS_ON_HIGH_GROUND && tries < 5000; tries += 1) {
    const at: WorldPoint = [span(495), span(495)];
    if (rockEdge(at[0], at[1]) > 6) rock(`rock-high-${index++}`, at, 1 + random() * 3.2);
  }
  for (let index = 0, tries = 0; index < ROCKS_ON_SLOPES && tries < 5000; tries += 1) {
    const at: WorldPoint = [span(495), span(495)];
    if (slopeDistance(at[0], at[1]) > 40 && rockEdge(at[0], at[1]) < 0 && offRoad(at)) rock(`rock-slope-${index++}`, at, 0.8 + random() * 1.6);
  }
  for (let index = 0, tries = 0; index < ROCKS_BY_RIVER && tries < 5000; tries += 1) {
    const z = span(490);
    const side = random() < 0.5 ? -1 : 1;
    const at: WorldPoint = [pilotRiverX(z) + side * (5 + random() * 4), z];
    if (side > 0 || pilotRiverX(z) - at[0] < 8) rock(`rock-river-${index++}`, at, 0.5 + random() * 0.8);
  }
  return groups;
}

/** Plants grow from the paint, so the road, the river and the clearing stay free of them. */
function pilotFoliage(): Record<string, unknown> {
  const rule = (id: string, layerId: string, foliageTypeId: string, density: number, minWeight: number, seed: number) =>
    ({ id, landscapeId: WB_PILOT_TERRAIN_ID, layerId, foliageTypeId, density, minWeight, seed });
  return {
    schema: 1,
    type: "foliage",
    groups: [],
    landscapeRules: [
      rule("forest-conifer-a", "forest", "wp-conifer-a-type", 0.0035, 0.6, 101),
      rule("forest-conifer-b", "forest", "wp-conifer-b-type", 0.0025, 0.45, 102),
      rule("forest-bush", "forest", "wp-bush-a-type", 0.0015, 0.5, 103),
      rule("meadow-bush", "meadow", "wp-bush-a-type", 0.0006, 0.6, 104),
      rule("meadow-grass", "meadow", "wp-grass-a-type", 0.05, 0.5, 105),
    ],
  };
}

export interface WbPilotValley {
  foliage: Record<string, unknown>;
  def: WorldTerrainDef;
  tiles: ReadonlyMap<string, TerrainTileData>;
  tileBytes: Map<string, Uint8Array>;
  globalBytes: Uint8Array;
  level: Record<string, unknown>;
  recipe: WorldRecipe;
  /** The `roads` stage's plan, warnings included. */
  roads: StagePlan;
  cabinHeight: number;
  sampleHeight: (x: number, z: number) => number | null;
}

export function generateWbPilotValley(profile: RegionProfile): WbPilotValley {
  const created = createFlatWorldTerrain({
    name: "WB Pilot Valley", tilesX: TILES, tilesZ: TILES, tileQuads: TILE_QUADS, spacing: SPACING, baseHeight: 0,
    heightMin: 0, heightMax: 320,
  });
  const def = created.def;
  def.layers = structuredClone(PILOT_LAYERS);
  const size = TILE_QUADS + 1;
  const tiles = def.tiles.map(({ key }) => {
    const { x, z } = created.tiles.get(key)!;
    const tile = createFlatTerrainTile(def, x, z);
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const worldX = def.origin[0] + (tile.x * TILE_QUADS + i) * SPACING;
        const worldZ = def.origin[2] + (tile.z * TILE_QUADS + j) * SPACING;
        tile.heights[j * size + i] = pilotBaseHeight(worldX, worldZ);
        writeWeights(tile, j * size + i, pilotWeights(worldX, worldZ));
      }
    }
    return tile;
  });
  const world = createTerrainEditWorld(def, tiles);
  const sampleHeight = (x: number, z: number): number | null => terrainHeightAt(def, world, x, z);

  // Level ground first, so the route ends on what it will meet.
  const cabinHeight = Number(pilotBaseHeight(...CABIN).toFixed(2));
  const pad: TerrainPad = {
    polygon: [
      [CABIN[0] - CABIN_PAD_HALF, CABIN[1] - CABIN_PAD_HALF], [CABIN[0] + CABIN_PAD_HALF, CABIN[1] - CABIN_PAD_HALF],
      [CABIN[0] + CABIN_PAD_HALF, CABIN[1] + CABIN_PAD_HALF], [CABIN[0] - CABIN_PAD_HALF, CABIN[1] + CABIN_PAD_HALF],
    ],
    height: cabinHeight,
    falloff: CABIN_PAD_FALLOFF,
  };
  applyTerrainUndoPatches(world, createTerrainPadPatches(world, [pad]));

  def.splines = [riverSpline()];
  const stageTerrain: StageTerrain = {
    id: WB_PILOT_TERRAIN_ID,
    min: [def.origin[0], def.origin[2]],
    max: [def.origin[0] + TILES * TILE_QUADS * SPACING, def.origin[2] + TILES * TILE_QUADS * SPACING],
    layers: def.layers.map(({ id, name }) => ({ id, name })),
    splines: def.splines,
    locked: false,
  };
  const layout = { schema: 1, name: "WbPilotValley", instances: [], characters: [] } as unknown as Parameters<typeof planStage>[1]["layout"];
  const roads = planStage(roadsStage, {
    recipe: wbPilotRecipe(), layout, profile, sampleHeight, terrains: [stageTerrain],
  });
  if (roads.errors.length > 0) throw new Error(`Pilot roads: ${roads.errors.join("; ")}`);
  def.splines = structuredClone(roads.splineChanges[0]?.after ?? def.splines);
  for (const spline of def.splines) {
    if (spline.id === "river" || spline.coordinateSpace !== "world") continue;
    applyTerrainUndoPatches(world, createTerrainSplinePatches(world, spline as WorldTerrainSpline));
  }

  const tileBytes = new Map<string, Uint8Array>();
  for (const summary of def.tiles) {
    const tile = world.tiles.get(summary.key)!;
    const range = terrainTileHeightRange(tile);
    summary.minHeight = range.min;
    summary.maxHeight = range.max;
    tileBytes.set(summary.key, encodeTerrainTile(tile, { ...def, heightFormat: "f32" }));
  }
  const globalBytes = encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, world.tiles)));
  const start: WorldPoint = [-36, 300];
  const level = {
    schema: 1,
    name: "WbPilotValley",
    loadGroups: [],
    instances: [
      {
        assetId: "marker:playerStart",
        placements: [{ position: [start[0], (sampleHeight(...start) ?? 0) + 2, start[1]], name: "Player Start", collision: false, rotationYDeg: 0, scale: 1 }],
      },
      ...[...pilotPlacements(sampleHeight)].map(([assetId, placements]) => ({ assetId, placements })),
    ],
    characters: [],
    worldSettings: { backgroundColor: "#a9c9df", ambientColor: "#ece6da", ambientIntensity: 1.1 },
    skyAtmosphere: { rayleigh: 1.4, turbidity: 3, mie: 0.003, mieDirectionalG: 0.8, skyLightCapture: { intensity: 0.5 } },
    lights: [{ id: "sun", type: "directional", position: [3, 9, 4], name: "Sun", rotation: [-48, 35, 0], color: "#fff4e6", intensity: 4.2, castShadow: true }],
    landscapes: [{ id: WB_PILOT_TERRAIN_ID, name: "WB Pilot Valley", position: worldTerrainActorPosition(def), dataRef: WB_PILOT_TERRAIN }],
    riverWaters: [{
      id: "river-water-1", name: "River", landscapeRef: WB_PILOT_TERRAIN_ID, splineRef: "river", coordinateSpace: "world",
      surfaceLevel: Number(pilotRiverSurface(PILOT_ROWS[0]!.z).toFixed(3)), reflectionQuality: "medium",
    }],
  };
  return { foliage: pilotFoliage(), def, tiles: world.tiles, tileBytes, globalBytes, level, recipe: roads.recipeAfter, roads, cabinHeight, sampleHeight };
}
