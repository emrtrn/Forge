/**
 * Macro terrain and water beds of a world brief (pilot step 3a,
 * docs/world-builder/WORLD_BRIEF.md): the ground every later step stands on.
 *
 * Valleys: each valley gives a ground from its sections (floor band and rock
 * line, east values), its floor profile, side slope and relief. The terrain is
 * the lowest of them, so two valleys meet at a ridge. Past its first and last
 * section a valley closes: the ground rises as it does up the side slopes.
 * Without a valley the ground is flat at the frame's datum.
 *
 * Water lines (`water[].line`, listed downstream) carve a bed along a smoothed
 * centreline. The water level follows the ground under the centreline but never
 * rises downstream; the bed sits `bedDepth` and the surface `surfaceDepth`
 * below it. Carving only lowers the ground. Lakes (`water[].polygon`) are not
 * carved yet; they are listed in `deferred`.
 *
 * Pure and deterministic in world coordinates (tile edges agree). Dependency-free.
 * Writing heights into tiles is the caller's job (`tools/world/worldBriefBuild.ts`);
 * the editor's stages do not write terrain (plan decision 19).
 */
import type { WorldPoint } from "./normalize";
import { fbm, ridged } from "./noise";
import {
  briefElevationToWorld,
  briefToWorld,
  DEFAULT_VALLEY_RELIEF,
  type BriefValley,
  type BriefValleyRelief,
  type BriefWater,
  type WorldBrief,
} from "./worldBrief";

/** The bed is this much wider than the water on each side, metres. */
export const WATER_BED_MARGIN = 1;
/** Distance over which the bed eases into its banks, metres. */
export const WATER_BANK = 7;
/** Centreline sample spacing, metres. */
const WATER_SAMPLE = 2;
/** Spatial grid cell and the furthest a water query looks, metres. */
const WATER_REACH = 64;

interface ValleyRow {
  z: number;
  floorW: number;
  floorE: number;
  rockW: number;
  rockE: number;
}

interface ValleyShape {
  id: string;
  rows: ValleyRow[];
  /** World `[z, y]` floor profile, by `z`. */
  floor: Array<[number, number]>;
  slope: number;
  relief: BriefValleyRelief;
}

/** Where a point lies against its valley. */
export interface ValleyPosition {
  valleyId: string;
  /** Horizontal distance from the valley floor (0 on it). */
  slopeDistance: number;
  /** Distance past the rock line on the point's side; negative below it. */
  rockEdge: number;
}

export interface WaterCourse {
  id: string;
  water: BriefWater;
  width: number;
  /** Smoothed centreline, world XZ, downstream. */
  points: WorldPoint[];
  /** Index in `points` of each `water.line` point. */
  anchors: number[];
  /** World heights along `points`. */
  surface: number[];
  bed: number[];
}

export interface WaterHit {
  course: WaterCourse;
  /** Horizontal distance from the centreline. */
  distance: number;
  /** Water surface height at the closest centreline point. */
  surface: number;
  bed: number;
}

export interface BriefTerrain {
  /** Valley ground, before the water beds. */
  ground(x: number, z: number): number;
  /** Final height: ground with every water bed carved in. */
  height(x: number, z: number): number;
  /** The valley whose ground is here, or null without valleys. */
  valleyAt(x: number, z: number): ValleyPosition | null;
  /** The closest water line within reach, or null. */
  water(x: number, z: number): WaterHit | null;
  courses: WaterCourse[];
  /** Brief content this step reads but does not build yet. */
  deferred: string[];
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
}

function valleyShape(brief: WorldBrief, valley: BriefValley): ValleyShape {
  const rows = valley.sections
    .map((section): ValleyRow => {
      const [floorW, z] = briefToWorld(brief, [section.floor[0], section.north]);
      return {
        z,
        floorW,
        floorE: briefToWorld(brief, [section.floor[1], section.north])[0],
        rockW: briefToWorld(brief, [section.rock[0], section.north])[0],
        rockE: briefToWorld(brief, [section.rock[1], section.north])[0],
      };
    })
    .sort((a, b) => a.z - b.z);
  const floor = valley.floorProfile
    .map(({ north, elevation }): [number, number] => [briefToWorld(brief, [0, north])[1], briefElevationToWorld(brief, elevation)])
    .sort((a, b) => a[0] - b[0]);
  return {
    id: valley.id,
    rows,
    floor,
    slope: Math.tan(valley.sideSlopeDeg * Math.PI / 180),
    relief: { ...DEFAULT_VALLEY_RELIEF, ...valley.relief },
  };
}

/** Catmull-Rom through the rows by `z`; sections need not be evenly spaced. Held flat past the ends. */
function rowValue(shape: ValleyShape, z: number, read: (row: ValleyRow) => number): number {
  const { rows } = shape;
  const last = rows.length - 1;
  if (z <= rows[0]!.z) return read(rows[0]!);
  if (z >= rows[last]!.z) return read(rows[last]!);
  let index = 0;
  while (index < last - 1 && z > rows[index + 1]!.z) index += 1;
  const t = (z - rows[index]!.z) / (rows[index + 1]!.z - rows[index]!.z);
  const value = (at: number): number => read(rows[Math.min(last, Math.max(0, at))]!);
  return catmullRom(value(index - 1), value(index), value(index + 1), value(index + 2), t);
}

/** Linear along the profile, extended past its ends. */
function floorLevel(shape: ValleyShape, z: number): number {
  const { floor } = shape;
  if (floor.length === 1) return floor[0]![1];
  let index = 0;
  while (index < floor.length - 2 && z > floor[index + 1]![0]) index += 1;
  const [z0, y0] = floor[index]!;
  const [z1, y1] = floor[index + 1]!;
  return y0 + (y1 - y0) * (z - z0) / (z1 - z0);
}

function valleyPosition(shape: ValleyShape, x: number, z: number): ValleyPosition & { plain: number; floor: number } {
  const west = rowValue(shape, z, (row) => row.floorW);
  const east = rowValue(shape, z, (row) => row.floorE);
  const side = x < west ? west - x : x > east ? x - east : 0;
  const first = shape.rows[0]!.z;
  const lastZ = shape.rows[shape.rows.length - 1]!.z;
  const along = z < first ? first - z : z > lastZ ? z - lastZ : 0;
  const slopeDistance = along > 0 ? Math.hypot(side, along) : side;
  const rockEdge = (x < (west + east) / 2 ? rowValue(shape, z, (row) => row.rockW) - x : x - rowValue(shape, z, (row) => row.rockE)) + along;
  const floor = floorLevel(shape, z);
  const { slopeFoot } = shape.relief;
  const plain = floor + shape.slope * (Math.hypot(slopeDistance, slopeFoot) - slopeFoot);
  return { valleyId: shape.id, slopeDistance, rockEdge, plain, floor };
}

function valleyGround(shape: ValleyShape, seed: number, x: number, z: number): number {
  const { slopeDistance: out, rockEdge, plain } = valleyPosition(shape, x, z);
  const { relief } = shape;
  const spurs = relief.spurs * smoothstep(out / 240) * fbm(x / 420, z / 150, 3, seed + 3);
  const rocky = relief.ridges * smoothstep((rockEdge + 60) / 120) * ridged(x / 150, z / 110, 4, seed + 5);
  const roughness = relief.noise * smoothstep(out / 160) * fbm(x / 130, z / 130, 4, seed) + spurs + rocky;
  const floorRoll = 0.6 * (1 - smoothstep(out / 30)) * fbm(x / 45, z / 45, 2, seed + 7);
  return plain + roughness + floorRoll;
}

/** Centreline through the line's points, sampled every `WATER_SAMPLE` metres. */
function centreline(line: WorldPoint[]): { points: WorldPoint[]; anchors: number[] } {
  const points: WorldPoint[] = [];
  const anchors: number[] = [];
  const last = line.length - 1;
  const at = (index: number): WorldPoint => line[Math.min(last, Math.max(0, index))]!;
  for (let segment = 0; segment < last; segment += 1) {
    anchors.push(points.length);
    const [a, b, c, d] = [at(segment - 1), at(segment), at(segment + 1), at(segment + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / WATER_SAMPLE));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      points.push([catmullRom(a[0], b[0], c[0], d[0], t), catmullRom(a[1], b[1], c[1], d[1], t)]);
    }
  }
  anchors.push(points.length);
  points.push(line[last]!);
  return { points, anchors };
}

export function createBriefTerrain(brief: WorldBrief): BriefTerrain {
  const seed = brief.seed;
  const shapes = brief.valleys.map((valley) => valleyShape(brief, valley));
  const datum = briefElevationToWorld(brief, 0);
  const deferred: string[] = [];

  const ground = (x: number, z: number): number => {
    if (shapes.length === 0) return datum;
    let lowest = Infinity;
    for (const shape of shapes) lowest = Math.min(lowest, valleyGround(shape, seed, x, z));
    return lowest;
  };
  const valleyAt = (x: number, z: number): ValleyPosition | null => {
    let best: (ValleyPosition & { plain: number }) | null = null;
    for (const shape of shapes) {
      const position = valleyPosition(shape, x, z);
      if (!best || position.plain < best.plain) best = position;
    }
    return best ? { valleyId: best.valleyId, slopeDistance: best.slopeDistance, rockEdge: best.rockEdge } : null;
  };

  const courses: WaterCourse[] = [];
  for (const water of brief.water) {
    if (!water.line) {
      deferred.push(`water ${water.id}: lakes are not carved yet`);
      continue;
    }
    if (water.width === undefined || water.bedDepth === undefined || water.surfaceDepth === undefined) {
      throw new Error(`terrain: water ${water.id} needs width, bedDepth and surfaceDepth to carve its bed`);
    }
    const { points, anchors } = centreline(water.line.map((point) => briefToWorld(brief, point)));
    const level: number[] = [];
    for (const [x, z] of points) level.push(Math.min(ground(x, z), level.length ? level[level.length - 1]! : Infinity));
    courses.push({
      id: water.id,
      water,
      width: water.width,
      points,
      anchors,
      surface: level.map((y) => y - water.surfaceDepth!),
      bed: level.map((y) => y - water.bedDepth!),
    });
  }

  // Every centreline segment, in each grid cell its box touches.
  const grid = new Map<string, Array<[number, number]>>();
  const cell = (value: number): number => Math.floor(value / WATER_REACH);
  courses.forEach((course, courseIndex) => {
    for (let index = 0; index < course.points.length - 1; index += 1) {
      const [a, b] = [course.points[index]!, course.points[index + 1]!];
      for (let cx = cell(Math.min(a[0], b[0])); cx <= cell(Math.max(a[0], b[0])); cx += 1) {
        for (let cz = cell(Math.min(a[1], b[1])); cz <= cell(Math.max(a[1], b[1])); cz += 1) {
          const key = `${cx}_${cz}`;
          const list = grid.get(key);
          if (list) list.push([courseIndex, index]);
          else grid.set(key, [[courseIndex, index]]);
        }
      }
    }
  });

  /** The closest point of each course within reach. */
  const nearby = (x: number, z: number): WaterHit[] => {
    const best = new Map<number, { distance: number; index: number; t: number }>();
    const [cx, cz] = [cell(x), cell(z)];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const [courseIndex, index] of grid.get(`${cx + dx}_${cz + dz}`) ?? []) {
          const points = courses[courseIndex]!.points;
          const [a, b] = [points[index]!, points[index + 1]!];
          const [ex, ez] = [b[0] - a[0], b[1] - a[1]];
          const length = ex * ex + ez * ez;
          const t = length > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / length)) : 0;
          const distance = Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t);
          const previous = best.get(courseIndex);
          if (distance <= WATER_REACH && (!previous || distance < previous.distance)) best.set(courseIndex, { distance, index, t });
        }
      }
    }
    return [...best].map(([courseIndex, { distance, index, t }]) => {
      const course = courses[courseIndex]!;
      const lerp = (values: number[]): number => values[index]! + (values[index + 1]! - values[index]!) * t;
      return { course, distance, surface: lerp(course.surface), bed: lerp(course.bed) };
    });
  };

  const height = (x: number, z: number): number => {
    let result = ground(x, z);
    for (const hit of nearby(x, z)) {
      const halfBed = hit.course.width / 2 + WATER_BED_MARGIN;
      const weight = 1 - smoothstep((hit.distance - halfBed) / WATER_BANK);
      if (weight > 0) result = Math.min(result, result + (hit.bed - result) * weight);
    }
    return result;
  };
  const water = (x: number, z: number): WaterHit | null =>
    nearby(x, z).reduce<WaterHit | null>((closest, hit) => (!closest || hit.distance < closest.distance ? hit : closest), null);

  return { ground, height, valleyAt, water, courses, deferred };
}
