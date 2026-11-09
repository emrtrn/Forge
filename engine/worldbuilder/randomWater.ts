/**
 * Random rivers and lakes (RANDOM_WORLD_PLAN step 3), added to a random world
 * brief after its settlements, roads and relief are laid out, with a random
 * stream of their own: the same seed with water is the same world plus water.
 *
 * Order:
 * 1. The brief's ground without water (`createBriefTerrain`: valley, hills,
 *    mountains, kept low round the settlements and roads) is sampled on a grid.
 * 2. Water drains over it (priority flood from the map edge): every cell knows
 *    the cell it flows to, and the pits it would fill. Settlements, with a
 *    margin, are not ground water may cross, so rivers flow round them.
 * 3. Lakes take the deepest pits first; a pit too small leaves its lake to a
 *    river (on its lower course) or, without one, to the lowest gentle ground.
 * 4. Rivers start on high ground away from the edge and flow downhill to the
 *    map edge, into a lake, or into a river drawn before them.
 *
 * The builder then keeps the mountains off the water (`relief.clear.water`),
 * so a river runs in a valley of its own, carves its bed so the water never
 * rises downstream, and sets each lake's level from the ground round it.
 *
 * Pure and deterministic; dependency-free.
 */
import { createBriefTerrain, LAKE_TRANSITION } from "./briefTerrain";
import { insidePolygon } from "./field";
import type { WorldPoint } from "./normalize";
import { briefToWorld, briefWorldBounds, normalizeWorldBrief, type WorldBrief } from "./worldBrief";
import { worldToMetric } from "./metricFrame";

/** River width, bed and water depth by world size (1 / 2 / 4 km), metres. */
export const RIVER_SIZES = {
  small: { width: 6, bedDepth: 2, surfaceDepth: 0.9 },
  medium: { width: 8, bedDepth: 2.2, surfaceDepth: 1 },
  large: { width: 10, bedDepth: 2.5, surfaceDepth: 1.1 },
} as const;
/** Lake shore radius range by world size, metres. */
export const LAKE_RADII = { small: [40, 70], medium: [55, 110], large: [75, 160] } as const;
/** Lake bed depth below its surface, metres. */
export const RANDOM_LAKE_DEPTH = 4;
/**
 * Water keeps this far from a settlement's centre: `share` of its radius plus
 * `river` (or `lake`), metres. The site selector counts flat ground within
 * 200 m of a river (100 m of a lake) as flood-prone (`siteSelection.ts`), and
 * the ground beside the water is flat (the mountains keep off it), so a
 * settlement needs most of that between it and the water.
 */
export const SETTLEMENT_WATER_GAP = { share: 0.5, river: 170, lake: 100 };
/**
 * Most the ground may rise round a lake's shore, metres: the level is set by the
 * ring's lowest point, so a lake against a slope gets a cut bank on its high side.
 */
export const LAKE_RING_RISE = 6;
/** Rivers do not reach the map edge this close to a road leaving it, metres. */
const EXIT_GAP = 80;
/** Most rivers and lakes a random world asks for. */
export const MAX_RANDOM_WATER = 3;

export type RandomWaterSize = keyof typeof RIVER_SIZES;

export interface RandomWaterOptions {
  rivers: number;
  lakes: number;
  seed: number;
  size: RandomWaterSize;
}

/** Cells along each side of the drainage grid. */
const GRID = 128;
/** A river's cell path is averaged over this far each way, metres. */
const SMOOTH_REACH = 60;
/** River line points are about this far apart, metres. */
const LINE_STEP = 40;
/** A pit this deep counts as a basin, metres. */
const PIT_DEPTH = 0.3;

type Raw = Record<string, unknown>;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Binary min-heap of grid cells by value; ties by index, so the flood is deterministic. */
class CellHeap {
  private cells: number[] = [];
  constructor(private readonly value: Float64Array) {}
  get size(): number {
    return this.cells.length;
  }
  private less(a: number, b: number): boolean {
    const [va, vb] = [this.value[a]!, this.value[b]!];
    return va < vb || (va === vb && a < b);
  }
  push(cell: number): void {
    const cells = this.cells;
    cells.push(cell);
    for (let index = cells.length - 1; index > 0;) {
      const parent = (index - 1) >> 1;
      if (!this.less(cells[index]!, cells[parent]!)) break;
      [cells[index], cells[parent]] = [cells[parent]!, cells[index]!];
      index = parent;
    }
  }
  pop(): number {
    const cells = this.cells;
    const top = cells[0]!;
    const last = cells.pop()!;
    if (cells.length > 0) {
      cells[0] = last;
      for (let index = 0; ;) {
        const [left, right] = [2 * index + 1, 2 * index + 2];
        let smallest = index;
        if (left < cells.length && this.less(cells[left]!, cells[smallest]!)) smallest = left;
        if (right < cells.length && this.less(cells[right]!, cells[smallest]!)) smallest = right;
        if (smallest === index) break;
        [cells[index], cells[smallest]] = [cells[smallest]!, cells[index]!];
        index = smallest;
      }
    }
    return top;
  }
}

interface Lake {
  id: string;
  centre: WorldPoint;
  radius: number;
  polygon: WorldPoint[];
}

/** Rivers and lakes for a random world brief (raw, before normalization); appends to `notes`. */
export function randomWater(raw: Raw, options: RandomWaterOptions, notes: string[]): Raw[] {
  const rivers = Math.min(MAX_RANDOM_WATER, Math.max(0, Math.floor(options.rivers)));
  const lakeCount = Math.min(MAX_RANDOM_WATER, Math.max(0, Math.floor(options.lakes)));
  if (rivers === 0 && lakeCount === 0) return [];
  const { brief: normalized, issues } = normalizeWorldBrief(structuredClone(raw));
  if (!normalized) throw new Error(`random water: the brief is invalid: ${issues.join("; ")}`);
  const brief = normalized as WorldBrief;
  const next = random((options.seed ^ 0x5bd1e995) >>> 0);
  const terrain = createBriefTerrain(brief);
  const bounds = briefWorldBounds(brief);
  const extent = Math.min(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
  const cell = extent / GRID;
  const side = GRID + 1;
  const count = side * side;
  const at = (index: number): WorldPoint => [bounds.min[0] + (index % side) * cell, bounds.min[1] + Math.floor(index / side) * cell];
  const toBrief = (point: WorldPoint): [number, number] => {
    const [east, north] = worldToMetric(point, brief.frame);
    return [Math.round(east * 10) / 10, Math.round(north * 10) / 10];
  };
  const edgeGap = (index: number): number => {
    const [i, j] = [index % side, Math.floor(index / side)];
    return Math.min(i, j, GRID - i, GRID - j) * cell;
  };

  // 1. The ground, and where water may not go.
  const height = new Float64Array(count);
  for (let index = 0; index < count; index += 1) height[index] = terrain.ground(...at(index));
  const keepOff = brief.settlements.map((settlement) => ({
    at: briefToWorld(brief, settlement.center),
    base: SETTLEMENT_WATER_GAP.share * (settlement.radius ?? 150),
  }));
  /** Distance past the gap a settlement asks of `kind` water; negative inside it. */
  const settlementGap = ([x, z]: WorldPoint, kind: "river" | "lake"): number =>
    keepOff.reduce((least, { at: [cx, cz], base }) => Math.min(least, Math.hypot(x - cx, z - cz) - base - SETTLEMENT_WATER_GAP[kind]), Infinity);
  const exits = brief.roads.nodes.filter((node) => node.kind === "end").map((node) => briefToWorld(brief, node.at));
  const blocked = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const point = at(index);
    if (settlementGap(point, "river") < 0 || exits.some(([x, z]) => Math.hypot(point[0] - x, point[1] - z) < EXIT_GAP)) blocked[index] = 1;
  }

  // 2. Drainage: a priority flood from the edge; `down` is the cell each one drains to.
  const filled = new Float64Array(count).fill(Infinity);
  const down = new Int32Array(count).fill(-1);
  const length = new Float64Array(count);
  const order: number[] = [];
  const heap = new CellHeap(filled);
  for (let index = 0; index < count; index += 1) {
    if (edgeGap(index) === 0 && !blocked[index]) {
      filled[index] = height[index]!;
      heap.push(index);
    }
  }
  const done = new Uint8Array(count);
  while (heap.size > 0) {
    const current = heap.pop();
    if (done[current]) continue;
    done[current] = 1;
    order.push(current);
    const [ci, cj] = [current % side, Math.floor(current / side)];
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        const [ni, nj] = [ci + di, cj + dj];
        if ((di === 0 && dj === 0) || ni < 0 || nj < 0 || ni > GRID || nj > GRID) continue;
        const neighbour = nj * side + ni;
        if (done[neighbour] || blocked[neighbour]) continue;
        const value = Math.max(height[neighbour]!, filled[current]! + 1e-4);
        if (value < filled[neighbour]!) {
          filled[neighbour] = value;
          down[neighbour] = current;
          length[neighbour] = length[current]! + Math.hypot(di, dj) * cell;
          heap.push(neighbour);
        }
      }
    }
  }

  const [minRadius, maxRadius] = LAKE_RADII[options.size];
  const lakes: Lake[] = [];
  /** How much the ground rises round a shore of `radius` (its irregular outline reaches 1.2 × radius). */
  const ringRise = ([cx, cz]: WorldPoint, radius: number): number => {
    let [low, high] = [Infinity, -Infinity];
    for (let k = 0; k < 24; k += 1) {
      const angle = (k / 24) * Math.PI * 2;
      for (const reach of [0.85 * radius, 1.2 * radius + LAKE_TRANSITION]) {
        const value = terrain.ground(cx + reach * Math.cos(angle), cz + reach * Math.sin(angle));
        [low, high] = [Math.min(low, value), Math.max(high, value)];
      }
    }
    return high - low;
  };
  /** The largest radius from `radius` down that fits here, or null. */
  const fitRadius = (centre: WorldPoint, radius: number): number | null => {
    for (const scale of [1, 0.8, 0.65]) {
      const r = Math.max(0.7 * minRadius, radius * scale);
      if (lakeFits(centre, r) && ringRise(centre, r) <= LAKE_RING_RISE) return r;
    }
    return null;
  };
  const lakeFits = (centre: WorldPoint, radius: number): boolean =>
    settlementGap(centre, "lake") >= radius
    && (!terrain.ocean || terrain.ocean.distance(...centre) > radius * 1.3 + LAKE_TRANSITION + 40)
    && Math.min(centre[0] - bounds.min[0], bounds.max[0] - centre[0], centre[1] - bounds.min[1], bounds.max[1] - centre[1]) >= radius + 0.08 * extent
    && lakes.every((lake) => Math.hypot(lake.centre[0] - centre[0], lake.centre[1] - centre[1]) >= lake.radius + radius + 80)
    && brief.roads.nodes.every((node) => {
      const [x, z] = briefToWorld(brief, node.at);
      return Math.hypot(x - centre[0], z - centre[1]) >= radius + 60;
    });
  const addLake = (centre: WorldPoint, radius: number): void => {
    const phase = next() * Math.PI * 2;
    const lobes = 2 + Math.floor(next() * 3);
    const polygon = Array.from({ length: 16 }, (_, k): WorldPoint => {
      const angle = (k / 16) * Math.PI * 2;
      const r = radius * (1 + 0.16 * Math.sin(lobes * angle + phase) + 0.12 * (next() - 0.5));
      return [centre[0] + r * Math.cos(angle), centre[1] + r * Math.sin(angle)];
    });
    lakes.push({ id: `lake-${lakes.length + 1}`, centre, radius, polygon });
  };

  // 3a. Lakes in the deepest pits.
  if (lakeCount > 0) {
    const seen = new Uint8Array(count);
    const pits: Array<{ centre: WorldPoint; area: number; depth: number }> = [];
    for (let start = 0; start < count; start += 1) {
      if (seen[start] || blocked[start] || filled[start]! - height[start]! < PIT_DEPTH) continue;
      const stack = [start];
      seen[start] = 1;
      let [cells, depth, sx, sz, deepest] = [0, 0, 0, 0, start];
      while (stack.length) {
        const current = stack.pop()!;
        cells += 1;
        const [x, z] = at(current);
        sx += x;
        sz += z;
        const d = filled[current]! - height[current]!;
        if (d > depth) [depth, deepest] = [d, current];
        const [ci, cj] = [current % side, Math.floor(current / side)];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const [ni, nj] = [ci + di, cj + dj];
          if (ni < 0 || nj < 0 || ni > GRID || nj > GRID) continue;
          const neighbour = nj * side + ni;
          if (seen[neighbour] || blocked[neighbour] || filled[neighbour]! - height[neighbour]! < PIT_DEPTH) continue;
          seen[neighbour] = 1;
          stack.push(neighbour);
        }
      }
      // The centre leans to the deepest point, so a long pit's lake sits in its bottom.
      const centroid: WorldPoint = [sx / cells, sz / cells];
      const low = at(deepest);
      pits.push({ centre: [(centroid[0] + low[0]) / 2, (centroid[1] + low[1]) / 2], area: cells * cell * cell, depth });
    }
    pits.sort((a, b) => b.depth * Math.sqrt(b.area) - a.depth * Math.sqrt(a.area));
    for (const pit of pits) {
      if (lakes.length >= lakeCount) break;
      if (pit.area < 0.4 * Math.PI * minRadius * minRadius) continue;
      const radius = fitRadius(pit.centre, Math.min(maxRadius, Math.max(minRadius, Math.sqrt(pit.area / Math.PI))));
      if (radius !== null) addLake(pit.centre, radius);
    }
  }

  // 4. Rivers, from high ground to the edge, a lake or an earlier river.
  /** A river ends on the shore of the lake it reaches: its bed holds the lake's water in (`briefTerrain.ts`). */
  const insideLake = (point: WorldPoint): Lake | null =>
    lakes.find((lake) => insidePolygon(point[0], point[1], lake.polygon)) ?? null;
  /** River cells and the course each belongs to. */
  const riverCells = new Map<number, number>();
  const courses: Array<{ cells: number[]; endsIn: "edge" | "lake" | "river"; joins?: number }> = [];
  if (rivers > 0) {
    const open = order.filter((index) => !blocked[index] && edgeGap(index) >= 0.15 * extent);
    const heights = open.map((index) => height[index]!).sort((a, b) => a - b);
    const high = heights[Math.floor(0.65 * heights.length)] ?? Infinity;
    const sources = open.filter((index) => height[index]! >= high && length[index]! >= 0.4 * extent).sort((a, b) => a - b);
    const picked: WorldPoint[] = [];
    for (let attempt = 0; attempt < 200 && courses.length < rivers && sources.length; attempt += 1) {
      const source = sources[Math.floor(next() * sources.length)]!;
      const start = at(source);
      if (picked.some((point) => Math.hypot(point[0] - start[0], point[1] - start[1]) < 0.25 * extent)) continue;
      if (insideLake(start)) continue;
      const cells: number[] = [];
      let endsIn: "edge" | "lake" | "river" = "edge";
      let joins: number | undefined;
      for (let current = source; current >= 0; current = down[current]!) {
        const [ci, cj] = [current % side, Math.floor(current / side)];
        if (cells.length > 2) {
          for (let dj = -1; dj <= 1 && joins === undefined; dj += 1) {
            for (let di = -1; di <= 1 && joins === undefined; di += 1) joins = riverCells.get((cj + dj) * side + ci + di);
          }
        }
        cells.push(current);
        if (joins !== undefined) {
          endsIn = "river";
          break;
        }
        if (insideLake(at(current))) {
          // The water ends on the shore; its bed carries on into the lake (bank and bed margin).
          if (cells.length > 2) cells.pop();
          endsIn = "lake";
          break;
        }
      }
      if (cells.length * cell < 0.25 * extent && endsIn !== "lake") continue;
      picked.push(start);
      for (const index of cells) riverCells.set(index, courses.length);
      courses.push({ cells, endsIn, ...(joins === undefined ? {} : { joins }) });
    }
    if (courses.length < rivers) notes.push(`rivers: ${courses.length} of ${rivers} found a course from high ground`);
  }

  // 3b. Lakes still missing: on a river's lower course (the river ends in it), else on the lowest gentle ground.
  courses.forEach((course, courseIndex) => {
    if (lakes.length >= lakeCount || course.endsIn !== "edge") return;
    // A river another one flows into keeps its whole course.
    if (courses.some((other) => other.joins === courseIndex)) return;
    for (const share of [0.6, 0.5, 0.7, 0.4]) {
      const index = Math.floor(share * course.cells.length);
      const centre = at(course.cells[index]!);
      const radius = fitRadius(centre, minRadius + next() * (maxRadius - minRadius) * 0.6);
      if (radius === null) continue;
      addLake(centre, radius);
      const lake = lakes[lakes.length - 1]!;
      const shore = course.cells.findIndex((cellIndex) => insideLake(at(cellIndex)) === lake);
      course.cells.length = Math.max(2, shore < 0 ? index + 1 : shore);
      course.endsIn = "lake";
      break;
    }
  });
  if (lakes.length < lakeCount) {
    const gentle = order
      .filter((index) => !blocked[index] && !riverCells.has(index))
      .sort((a, b) => height[a]! - height[b]! || a - b);
    for (let attempt = 0; attempt < gentle.length && lakes.length < lakeCount; attempt += 1) {
      const centre = at(gentle[attempt]!);
      const radius = fitRadius(centre, minRadius + next() * (maxRadius - minRadius) * 0.5);
      if (radius !== null && courses.every((course) => course.cells.every((index) => {
        const [x, z] = at(index);
        return Math.hypot(x - centre[0], z - centre[1]) >= radius + 30;
      }))) addLake(centre, radius);
    }
  }
  if (lakes.length < lakeCount) notes.push(`lakes: room for ${lakes.length} of ${lakeCount}`);

  // Brief entries: a river's cells thinned to a line, in flow order.
  const { width, bedDepth, surfaceDepth } = RIVER_SIZES[options.size];
  const stride = Math.max(1, Math.round(LINE_STEP / cell));
  const water: Raw[] = [];
  const reach = Math.max(2, Math.round(SMOOTH_REACH / cell));
  const lines: Array<Array<[number, number]>> = [];
  courses.forEach((course, index) => {
    // The cell path turns in 45° steps: a running mean rounds it, ends kept; a point the mean pulls into a settlement's gap stays put.
    const raw = course.cells.map(at);
    const smooth = raw.map((point, k): WorldPoint => {
      const window = Math.min(reach, k, raw.length - 1 - k);
      if (window === 0) return point;
      let [sx, sz] = [0, 0];
      for (let j = k - window; j <= k + window; j += 1) [sx, sz] = [sx + raw[j]![0], sz + raw[j]![1]];
      const mean: WorldPoint = [sx / (2 * window + 1), sz / (2 * window + 1)];
      return settlementGap(mean, "river") < 0 ? point : mean;
    });
    const line = smooth.filter((_, k) => k % stride === 0 || k === smooth.length - 1).map(([x, z]) => {
      // The edge cell sits on the area's border; keep the line just inside it.
      return toBrief([Math.min(bounds.max[0] - 2, Math.max(bounds.min[0] + 2, x)), Math.min(bounds.max[1] - 2, Math.max(bounds.min[1] + 2, z))]);
    });
    // A tributary ends on the line of the river it joins.
    const joined = course.joins === undefined ? undefined : lines[course.joins];
    if (joined) {
      const end = line[line.length - 1]!;
      line.push(joined.reduce((best, point) =>
        (Math.hypot(point[0] - end[0], point[1] - end[1]) < Math.hypot(best[0] - end[0], best[1] - end[1]) ? point : best)));
    }
    lines[index] = line;
    if (line.length >= 2) water.push({ id: `river-${index + 1}`, kind: "river", line, width, bedDepth, surfaceDepth });
  });
  for (const lake of lakes) {
    water.push({ id: lake.id, kind: "lake", polygon: lake.polygon.map(toBrief), bedDepth: RANDOM_LAKE_DEPTH });
  }
  return water;
}
