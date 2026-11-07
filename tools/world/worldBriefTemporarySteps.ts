/**
 * Temporary steps of `world:brief` (docs/world-builder/WORLD_BRIEF.md): the
 * pilot's hand-written terrain, river bed, level ground, paint, plant rules and
 * scatter, moved out of the old one-off generator and fed from the brief. Step 3
 * of the pilot plan turns each of them into a World Builder stage; until then
 * they cover what the pilot needs and refuse other briefs with a clear message.
 *
 * What the brief does not say yet (relief amplitudes, paint layers, plant
 * rules, rock counts, the yard fence) is `PILOT_TUNING`. Pure and deterministic.
 */
import type { WorldTerrainLayerDef, WorldTerrainSpline } from "../../engine/terrain/terrainTypes";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { briefElevationToWorld, briefToWorld, type BriefWater, type WorldBrief } from "../../engine/worldbuilder/worldBrief";
import { fbm, ridged } from "./testWorld";

export const PILOT_TUNING = {
  /** Horizontal distance over which the valley floor eases into the slope, metres. */
  slopeFoot: 18,
  /** Spurs and gullies running down the slopes, and the broken ground of the high rock, metres. */
  spurRelief: 26,
  ridgeRelief: 16,
  relief: 10,
  riverBedHalfWidth: 5.5,
  riverBank: 7,
  riverFalloff: 2,
  meadowFade: [6, 30] as const,
  rockFade: 30,
  /** Open ground around a landmark with level ground. */
  clearingRadius: 38,
  rocksOnHighGround: 90,
  rocksOnSlopes: 24,
  rocksByRiver: 18,
  /** Smaller rocks are walked over: no collider. */
  rockCollisionScale: 1.4,
  rockScale: { high: [1.5, 4], slope: [1, 2.5], river: [1, 2] } as const,
  /** World XZ boxes kept free of slope rocks: the climb to the cabin. */
  rockFreeBoxes: [{ min: [-240, -240] as WorldPoint, max: [-30, -90] as WorldPoint }],
  /** A yard fence on the north and west of every `building.cabin` landmark. */
  fence: { role: "building.cabin", module: 3 },
  layers: [
    { id: "meadow", name: "Meadow", color: "#6f9a4a", material: "lt-meadow", physicalMaterial: "default" },
    { id: "forest", name: "Forest Floor", color: "#3f4f2c", material: "starter-mat-grass", physicalMaterial: "default" },
    { id: "rock", name: "Rock", color: "#8b8a84", material: "lt-rock", physicalMaterial: "default" },
    { id: "dirt", name: "Dirt", color: "#8a6441", material: "lt-earth", physicalMaterial: "default" },
    { id: "riverbed", name: "River Bed", color: "#6f6a5c", material: "m-gravel-material", physicalMaterial: "default" },
  ] satisfies WorldTerrainLayerDef[],
  /** Plants grow from the paint, so the road, the river and the clearing stay free of them. */
  plantRules: [
    { id: "forest-conifer-a", layerId: "forest", foliageTypeId: "wp-conifer-a-type", density: 0.0025, minWeight: 0.6, seed: 101 },
    { id: "forest-conifer-b", layerId: "forest", foliageTypeId: "wp-conifer-b-type", density: 0.002, minWeight: 0.45, seed: 102 },
    { id: "forest-conifer-c", layerId: "forest", foliageTypeId: "wp-conifer-c-type", density: 0.0015, minWeight: 0.35, seed: 106 },
    { id: "forest-bush", layerId: "forest", foliageTypeId: "wp-bush-a-type", density: 0.0015, minWeight: 0.5, seed: 103 },
    { id: "forest-bush-b", layerId: "forest", foliageTypeId: "wp-bush-b-type", density: 0.001, minWeight: 0.5, seed: 107 },
    { id: "meadow-bush", layerId: "meadow", foliageTypeId: "wp-bush-a-type", density: 0.0006, minWeight: 0.6, seed: 104 },
    { id: "meadow-grass", layerId: "meadow", foliageTypeId: "wp-grass-a-type", density: 0.02, minWeight: 0.5, seed: 105 },
  ],
};

/** The valley at one `z`, world metres, every row the same distance apart. */
interface ValleyRow {
  z: number;
  river: number;
  floorW: number;
  floorE: number;
  rockW: number;
  rockE: number;
}

export interface BriefLandscape {
  rows: readonly ValleyRow[];
  river: BriefWater;
  /** World `[z, y]` points of the floor profile, by `z`. */
  floor: ReadonlyArray<[number, number]>;
  slope: number;
  /** Landmarks with level ground, world XZ. */
  clearings: readonly WorldPoint[];
  baseHeight(x: number, z: number): number;
  weights(x: number, z: number): number[];
  riverX(z: number): number;
  riverSurface(z: number): number;
  slopeDistance(x: number, z: number): number;
  rockEdge(x: number, z: number): number;
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Refuses a brief these steps cannot build yet; step 3 replaces them with stages. */
export function briefLandscape(brief: WorldBrief): BriefLandscape {
  if (brief.valleys.length !== 1) throw new Error(`temporary terrain step: needs exactly one valley, the brief has ${brief.valleys.length}`);
  const valley = brief.valleys[0]!;
  const rivers = brief.water.filter((water) => water.line);
  if (rivers.length !== 1) throw new Error(`temporary terrain step: needs exactly one water line, the brief has ${rivers.length}`);
  const river = rivers[0]!;
  if (river.bedDepth === undefined || river.surfaceDepth === undefined || river.width === undefined) {
    throw new Error(`temporary terrain step: water ${river.id} needs width, bedDepth and surfaceDepth`);
  }
  const line = river.line!;
  if (line.length !== valley.sections.length) {
    throw new Error(`temporary terrain step: water ${river.id} must have one point on each valley section`);
  }
  const rows: ValleyRow[] = valley.sections.map((section, index) => {
    if (line[index]![1] !== section.north) {
      throw new Error(`temporary terrain step: water ${river.id} point ${index} is not on the section at north ${section.north}`);
    }
    const [floorW, z] = briefToWorld(brief, [section.floor[0], section.north]);
    return {
      z,
      river: briefToWorld(brief, line[index]!)[0],
      floorW,
      floorE: briefToWorld(brief, [section.floor[1], section.north])[0],
      rockW: briefToWorld(brief, [section.rock[0], section.north])[0],
      rockE: briefToWorld(brief, [section.rock[1], section.north])[0],
    };
  });
  const step = rows[1]!.z - rows[0]!.z;
  rows.forEach((row, index) => {
    if (index > 0 && Math.abs(row.z - rows[index - 1]!.z - step) > 1e-6) {
      throw new Error("temporary terrain step: valley sections must be the same distance apart");
    }
  });
  const floor = valley.floorProfile
    .map(({ north, elevation }): [number, number] => [briefToWorld(brief, [0, north])[1], briefElevationToWorld(brief, elevation)])
    .sort((a, b) => a[0] - b[0]);
  const slope = Math.tan(valley.sideSlopeDeg * Math.PI / 180);
  const clearings = brief.landmarks.filter((landmark) => landmark.pad).map((landmark) => briefToWorld(brief, landmark.at));
  const seed = brief.seed;
  const tuning = PILOT_TUNING;
  const bedDepth = river.bedDepth;
  const surfaceDepth = river.surfaceDepth;

  /** Catmull-Rom through the rows, so the section spacing leaves no kinks. */
  const rowValue = (z: number, read: (row: ValleyRow) => number): number => {
    const last = rows.length - 1;
    const position = Math.min(last, Math.max(0, (z - rows[0]!.z) / step));
    const index = Math.min(last - 1, Math.floor(position));
    const t = position - index;
    const value = (at: number): number => read(rows[Math.min(last, Math.max(0, at))]!);
    const [a, b, c, d] = [value(index - 1), value(index), value(index + 1), value(index + 2)];
    return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  };
  /** Linear along the profile, extended past its ends. */
  const floorLevel = (z: number): number => {
    if (floor.length === 1) return floor[0]![1];
    let index = 0;
    while (index < floor.length - 2 && z > floor[index + 1]![0]) index += 1;
    const [z0, y0] = floor[index]!;
    const [z1, y1] = floor[index + 1]!;
    return y0 + (y1 - y0) * (z - z0) / (z1 - z0);
  };
  const riverX = (z: number): number => rowValue(z, (row) => row.river);
  const riverSurface = (z: number): number => floorLevel(z) - surfaceDepth;
  const slopeDistance = (x: number, z: number): number => {
    const west = rowValue(z, (row) => row.floorW);
    const east = rowValue(z, (row) => row.floorE);
    return x < west ? west - x : x > east ? x - east : 0;
  };
  /** Distance past the rock line on this point's side of the valley; negative below it. */
  const rockEdge = (x: number, z: number): number =>
    x < riverX(z) ? rowValue(z, (row) => row.rockW) - x : x - rowValue(z, (row) => row.rockE);

  const baseHeight = (x: number, z: number): number => {
    const out = slopeDistance(x, z);
    const rise = slope * (Math.hypot(out, tuning.slopeFoot) - tuning.slopeFoot);
    const spurs = tuning.spurRelief * smoothstep(out / 240) * fbm(x / 420, z / 150, 3, seed + 3);
    const rocky = tuning.ridgeRelief * smoothstep((rockEdge(x, z) + 60) / 120) * ridged(x / 150, z / 110, 4, seed + 5);
    const relief = tuning.relief * smoothstep(out / 160) * fbm(x / 130, z / 130, 4, seed) + spurs + rocky;
    const floorRoll = 0.6 * (1 - smoothstep(out / 30)) * fbm(x / 45, z / 45, 2, seed + 7);
    const ground = floorLevel(z) + rise + relief + floorRoll;
    const toRiver = Math.abs(x - riverX(z));
    const bed = 1 - smoothstep((toRiver - tuning.riverBedHalfWidth) / tuning.riverBank);
    return ground + (floorLevel(z) - bedDepth - ground) * bed;
  };

  /** Paint weights in `PILOT_TUNING.layers` order. */
  const weights = (x: number, z: number): number[] => {
    const wobble = 10 * fbm(x / 35, z / 35, 3, seed + 13);
    const out = slopeDistance(x, z) + wobble;
    const rock = smoothstep((rockEdge(x, z) + wobble) / tuning.rockFade);
    const clearing = clearings.reduce((most, [cx, cz]) =>
      Math.max(most, 1 - smoothstep((Math.hypot(x - cx, z - cz) + wobble - tuning.clearingRadius) / 12)), 0);
    const forest = smoothstep((out - tuning.meadowFade[0]) / (tuning.meadowFade[1] - tuning.meadowFade[0])) * (1 - clearing);
    const riverbed = 1 - smoothstep((Math.abs(x - riverX(z)) - tuning.riverBedHalfWidth) / 3);
    const open = (1 - rock) * (1 - riverbed);
    return [open * (1 - forest), open * forest, rock * (1 - riverbed), 0, riverbed];
  };

  return { rows, river, floor, slope, clearings, baseHeight, weights, riverX, riverSurface, slopeDistance, rockEdge };
}

/** The water line as a terrain spline at the water surface; the river actor reads it. */
export function riverSpline(land: BriefLandscape): WorldTerrainSpline {
  const points = land.rows.map((row, index) => ({
    id: `p${index}`,
    position: [row.river, Number(land.riverSurface(row.z).toFixed(3)), row.z] as [number, number, number],
    width: land.river.width!,
    falloff: PILOT_TUNING.riverFalloff,
  }));
  return {
    id: land.river.id,
    name: land.river.id.charAt(0).toUpperCase() + land.river.id.slice(1),
    smooth: true,
    coordinateSpace: "world",
    points,
    segments: points.slice(1).map((point, index) => ({ id: `s${index}`, startPointId: points[index]!.id, endPointId: point.id })),
  };
}

/** A small deterministic generator, so a run rebuilds the same scatter. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScatterPlacement {
  /** Model row variant to pick from, or null for the role's only model. */
  role: string;
  variant: string | null;
  id: string;
  name: string;
  at: WorldPoint;
  rotationYDeg: number;
  scale: number;
  collision: boolean;
  /** Which of the variant's models, 0..1. */
  pick: number;
}

/** The yard fence: modules along the north and west of each cabin. */
export function yardFences(brief: WorldBrief): ScatterPlacement[] {
  const fences: ScatterPlacement[] = [];
  const { role, module } = PILOT_TUNING.fence;
  for (const landmark of brief.landmarks.filter((entry) => entry.role === role)) {
    const [cx, cz] = briefToWorld(brief, landmark.at);
    const prefix = brief.landmarks.filter((entry) => entry.role === role).length > 1 ? `${landmark.id}-` : "";
    for (let index = 0; index < 8; index += 1) {
      fences.push({
        role: "prop.fence", variant: null, id: `${prefix}fence-north-${index}`, name: `Fence North ${index}`,
        at: [cx - 10.5 + index * module, cz - 13], rotationYDeg: 0, scale: 1, collision: false, pick: 0,
      });
    }
    for (let index = 0; index < 7; index += 1) {
      fences.push({
        role: "prop.fence", variant: null, id: `${prefix}fence-west-${index}`, name: `Fence West ${index}`,
        at: [cx - 12, cz - 11.5 + index * module], rotationYDeg: 90, scale: 1, collision: false, pick: 0,
      });
    }
  }
  return fences;
}

/** Rocks on the high ground, the slopes and the river banks. `pick` chooses among the variant's models. */
export function scatterRocks(
  brief: WorldBrief,
  land: BriefLandscape,
  bounds: { min: WorldPoint; max: WorldPoint },
): ScatterPlacement[] {
  const tuning = PILOT_TUNING;
  const random = seededRandom(brief.seed);
  const rocks: ScatterPlacement[] = [];
  const rock = (id: string, at: WorldPoint, variant: keyof typeof tuning.rockScale): void => {
    const pick = random();
    const [low, high] = tuning.rockScale[variant];
    const scale = Number((low + random() * (high - low)).toFixed(2));
    rocks.push({
      role: "prop.rock", variant, id, name: id, at, scale, collision: scale >= tuning.rockCollisionScale,
      rotationYDeg: Math.round(random() * 360), pick,
    });
  };
  const center: WorldPoint = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
  const half: WorldPoint = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[1] - bounds.min[1]) / 2];
  /** Within `margin` metres of the area's edge at most. */
  const span = (axis: 0 | 1, margin: number): number => center[axis] + (random() * 2 - 1) * (half[axis] - margin);
  const offRoad = (at: WorldPoint): boolean =>
    land.clearings.every(([cx, cz]) => Math.hypot(at[0] - cx, at[1] - cz) >= tuning.clearingRadius + 6)
    && !tuning.rockFreeBoxes.some(({ min, max }) => at[0] > min[0] && at[0] < max[0] && at[1] > min[1] && at[1] < max[1]);
  for (let index = 0, tries = 0; index < tuning.rocksOnHighGround && tries < 5000; tries += 1) {
    const at: WorldPoint = [span(0, 5), span(1, 5)];
    if (land.rockEdge(at[0], at[1]) > 6) rock(`rock-high-${index++}`, at, "high");
  }
  for (let index = 0, tries = 0; index < tuning.rocksOnSlopes && tries < 5000; tries += 1) {
    const at: WorldPoint = [span(0, 5), span(1, 5)];
    if (land.slopeDistance(at[0], at[1]) > 40 && land.rockEdge(at[0], at[1]) < 0 && offRoad(at)) rock(`rock-slope-${index++}`, at, "slope");
  }
  for (let index = 0, tries = 0; index < tuning.rocksByRiver && tries < 5000; tries += 1) {
    const z = span(1, 10);
    const side = random() < 0.5 ? -1 : 1;
    const at: WorldPoint = [land.riverX(z) + side * (5 + random() * 4), z];
    if (side > 0 || land.riverX(z) - at[0] < 8) rock(`rock-river-${index++}`, at, "river");
  }
  return rocks;
}

/** Plant rules on the terrain's paint layers. */
export function plantRules(terrainId: string): Array<Record<string, unknown>> {
  return PILOT_TUNING.plantRules.map((rule) => ({
    id: rule.id, landscapeId: terrainId, layerId: rule.layerId, foliageTypeId: rule.foliageTypeId,
    density: rule.density, minWeight: rule.minWeight, seed: rule.seed,
  }));
}
