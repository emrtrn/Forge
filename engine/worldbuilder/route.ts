/**
 * Road route solver (World Builder plan v0.4 T14, §13.5 L3).
 *
 * The plan's line wins when it works: the straight line, or the edge's guide
 * polyline, is used as drawn when every ~10 m leg stays within the class's
 * `maxSlopeDeg` and it neither enters water nor a protected area. Only when it
 * breaks one of those does the terrain take over: an A* over a cost grid
 * around the line (16-neighbour moves, so bends are not limited to 45°):
 *
 * - directional grade cost — gentle below `maxSlopeDeg`, sharply rising above
 *   it, so a climb becomes a traverse or a serpentine;
 * - water costs `WATER_COST`× per metre (a crossing stays possible: a bridge or
 *   ford candidate, T16), protected areas and off-terrain cells are walls;
 * - with a guide, cost grows with distance from it, so the corridor the plan
 *   drew is kept where the terrain allows.
 *
 * The cell path is simplified (Douglas-Peucker), corner-cut (Chaikin) unless
 * that would clip a protected area, and resampled evenly. Every route — direct
 * or solved — is then checked against the limits and reported: steepest leg,
 * bends tighter than `minTurnRadius`, water crossings. The solver never
 * silently hides a violation it could not avoid.
 *
 * Pure and deterministic; works on `field.ts` grids. Dependency-free.
 */
import { bandMask, distanceField, gridSpecForBounds, heightField, type Field, type GridSpec } from "./field";
import { protectedMask, waterSources, type MaskInput } from "./masks";
import type { WorldPoint } from "./normalize";

/** Longest leg between two route points, metres. */
export const ROUTE_SPACING = 10;
/** The terrain spline point limit (`validateLandscapeSplines`). */
export const MAX_ROUTE_POINTS = 256;

/** Default solver cell, metres. */
export const ROUTE_CELL_SIZE = 4;
/** Solver grids grow their cells rather than exceed this many. */
const MAX_SOLVER_CELLS = 250_000;
/** Room around the line for detours: at least this, metres … */
const MIN_CORRIDOR_MARGIN = 60;
/** … or this share of the line's length. */
const CORRIDOR_MARGIN_SHARE = 0.35;
/** Beyond this distance from the guide the guide penalty is at its full weight, metres. */
export const GUIDE_CORRIDOR = 40;
const GUIDE_WEIGHT = 0.5;
/** Cost per metre above the slope limit, per unit of overshoot ratio. */
const STEEP_COST = 20;
export const WATER_COST = 8;

export interface RouteContext extends MaskInput {
  readonly sampleHeight: (x: number, z: number) => number | null;
}

export interface RouteRequest {
  from: WorldPoint;
  to: WorldPoint;
  /** Corridor hint between `from` and `to`. */
  guide?: readonly WorldPoint[];
  maxSlopeDeg: number;
  minTurnRadius: number;
  /** Half the road's width: water closer than this to the centre line counts as crossed. Default 0. */
  halfWidth?: number;
}

export interface RouteOptions {
  /** Solver cell size, metres. Default `ROUTE_CELL_SIZE`. */
  cellSize?: number;
}

/** `direct`: the plan's line; `solved`: the terrain route; `fallback`: the plan's line because no route was found. */
export type RouteMethod = "direct" | "solved" | "fallback";

export interface RouteCheck {
  /** Steepest leg, degrees; null when no leg has terrain under both ends. */
  maxGradeDeg: number | null;
  /** Legs steeper than `maxSlopeDeg`. */
  steepLegs: number;
  /** Tightest bend radius through three consecutive points; null on a straight route. */
  tightestRadius: number | null;
  /** Bends tighter than `minTurnRadius`. */
  tightBends: number;
  /** Separate stretches of the route in water. */
  waterCrossings: number;
  /** Samples of the route inside a protected area. */
  protectedHits: number;
}

export interface RouteResult extends RouteCheck {
  method: RouteMethod;
  /** From `from` to `to`, legs of at most `ROUTE_SPACING` (longer only past the point limit). */
  points: WorldPoint[];
  /** Why the direct line was not used (or, for `fallback`, also why solving failed). */
  reason?: string;
}

/** Null when the route has zero length. */
export function planRoute(context: RouteContext, request: RouteRequest, options: RouteOptions = {}): RouteResult | null {
  const control = [request.from, ...(request.guide ?? []), request.to];
  const direct = resampleKeepingVertices(control);
  if (direct.length < 2) return null;

  const grid = obstacleGrid(context, control, options.cellSize ?? ROUTE_CELL_SIZE, request.halfWidth ?? 0);
  const directCheck = checkRoute(direct, request, context.sampleHeight, grid);
  const problems = describe(directCheck, request);
  if (problems.length === 0) return { method: "direct", points: direct, ...directCheck };
  const reason = problems.join(", ");

  const heights = heightField(grid.spec, context.sampleHeight);
  const guide = request.guide && request.guide.length > 0
    ? distanceField(grid.spec, [{ kind: "polyline", points: control }], GUIDE_CORRIDOR)
    : null;
  const cells = solve(grid, heights, guide, request);
  if (!cells) {
    return { method: "fallback", points: direct, reason: `${reason}; no route within the corridor`, ...directCheck };
  }
  const points = smoothPath(cells, grid);
  return { method: "solved", points, reason, ...checkRoute(points, request, context.sampleHeight, grid) };
}

function describe(check: RouteCheck, request: RouteRequest): string[] {
  const problems: string[] = [];
  if (check.steepLegs > 0) problems.push(`climbs ${round1(check.maxGradeDeg!)}° (limit ${request.maxSlopeDeg}°)`);
  if (check.waterCrossings > 0) problems.push("crosses water");
  if (check.protectedHits > 0) problems.push("enters a protected area");
  return problems;
}

// ---------------------------------------------------------------- obstacles

interface ObstacleGrid {
  spec: GridSpec;
  /** 1 in water. */
  water: Field;
  /** 1 in a protected area. */
  blocked: Field;
}

function obstacleGrid(context: RouteContext, control: readonly WorldPoint[], cellSize: number, halfWidth: number): ObstacleGrid {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of control) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const margin = Math.max(MIN_CORRIDOR_MARGIN, CORRIDOR_MARGIN_SHARE * Math.hypot(maxX - minX, maxZ - minZ));
  const bounds = { min: [minX - margin, minZ - margin] as WorldPoint, max: [maxX + margin, maxZ + margin] as WorldPoint };
  const area = (bounds.max[0] - bounds.min[0]) * (bounds.max[1] - bounds.min[1]);
  const spec = gridSpecForBounds(bounds, Math.max(cellSize, Math.sqrt(area / MAX_SOLVER_CELLS)));
  return {
    spec,
    water: bandMask(distanceField(spec, waterSources(context).sources, halfWidth + spec.cellSize), { max: halfWidth }),
    blocked: protectedMask(spec, context).field,
  };
}

function cellIndex(spec: GridSpec, x: number, z: number): number {
  const i = Math.floor((x - spec.origin[0]) / spec.cellSize);
  const j = Math.floor((z - spec.origin[1]) / spec.cellSize);
  return i < 0 || j < 0 || i >= spec.width || j >= spec.depth ? -1 : j * spec.width + i;
}

// ---------------------------------------------------------------- check

/** Limits of a route as built: ~10 m legs on the terrain, sampled every half cell for water and protection. */
function checkRoute(
  points: readonly WorldPoint[],
  limits: Pick<RouteRequest, "maxSlopeDeg" | "minTurnRadius">,
  sampleHeight: RouteContext["sampleHeight"],
  grid: ObstacleGrid,
): RouteCheck {
  let maxGradeDeg: number | null = null;
  let steepLegs = 0;
  const heights = points.map(([x, z]) => sampleHeight(x, z));
  for (let index = 1; index < points.length; index += 1) {
    const h0 = heights[index - 1];
    const h1 = heights[index];
    const length = distance(points[index - 1]!, points[index]!);
    if (h0 === null || h0 === undefined || h1 === null || h1 === undefined || length === 0) continue;
    const grade = Math.atan(Math.abs(h1 - h0) / length) * (180 / Math.PI);
    maxGradeDeg = Math.max(maxGradeDeg ?? 0, grade);
    if (grade > limits.maxSlopeDeg + 1e-6) steepLegs += 1;
  }

  let tightestRadius: number | null = null;
  let tightBends = 0;
  for (let index = 1; index + 1 < points.length; index += 1) {
    const radius = circumradius(points[index - 1]!, points[index]!, points[index + 1]!);
    if (!Number.isFinite(radius)) continue;
    tightestRadius = Math.min(tightestRadius ?? Infinity, radius);
    if (radius < limits.minTurnRadius - 1e-6) tightBends += 1;
  }

  return { maxGradeDeg, steepLegs, tightestRadius, tightBends, ...obstacles(points, grid) };
}

/** Water stretches entered and protected samples, every half cell along the route. */
function obstacles(points: readonly WorldPoint[], grid: ObstacleGrid): Pick<RouteCheck, "waterCrossings" | "protectedHits"> {
  let waterCrossings = 0;
  let protectedHits = 0;
  let wet = false;
  forEachSample(points, grid.spec.cellSize / 2, ([x, z]) => {
    const index = cellIndex(grid.spec, x, z);
    const inWater = index >= 0 && grid.water.values[index]! >= 0.5;
    if (inWater && !wet) waterCrossings += 1;
    wet = inWater;
    if (index >= 0 && grid.blocked.values[index]! >= 0.5) protectedHits += 1;
  });
  return { waterCrossings, protectedHits };
}

function circumradius(a: WorldPoint, b: WorldPoint, c: WorldPoint): number {
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (cross < 1e-9) return Infinity;
  return (distance(a, b) * distance(b, c) * distance(a, c)) / (2 * cross);
}

function forEachSample(points: readonly WorldPoint[], step: number, visit: (point: WorldPoint) => void): void {
  visit(points[0]!);
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const pieces = Math.max(1, Math.ceil(distance(a, b) / step));
    for (let k = 1; k <= pieces; k += 1) visit(lerp(a, b, k / pieces));
  }
}

// ---------------------------------------------------------------- A*

/** 16-neighbour moves: [di, dj, cells crossed on the way]. */
const MOVES: ReadonlyArray<readonly [number, number, ReadonlyArray<readonly [number, number]>]> = (() => {
  const moves: Array<readonly [number, number, ReadonlyArray<readonly [number, number]>]> = [];
  for (let dj = -2; dj <= 2; dj += 1) {
    for (let di = -2; di <= 2; di += 1) {
      const a = Math.abs(di);
      const b = Math.abs(dj);
      if (a + b === 0 || a + b > 3 || (a === 2 && b !== 1) || (b === 2 && a !== 1)) continue;
      const si = Math.sign(di);
      const sj = Math.sign(dj);
      const through: Array<readonly [number, number]> = a === 2 ? [[si, 0], [si, sj]] : b === 2 ? [[0, sj], [si, sj]] : [];
      moves.push([di, dj, through]);
    }
  }
  return moves;
})();

interface Solved {
  cells: number[];
  from: WorldPoint;
  to: WorldPoint;
}

function solve(grid: ObstacleGrid, heights: Field, guide: Field | null, request: RouteRequest): Solved | null {
  const { spec, water, blocked } = grid;
  const start = cellIndex(spec, ...request.from);
  const goal = cellIndex(spec, ...request.to);
  if (start < 0 || goal < 0) return null;
  const count = spec.width * spec.depth;
  const passable = (index: number): boolean =>
    index === start || index === goal || (!Number.isNaN(heights.values[index]!) && blocked.values[index]! < 0.5);

  const g = new Float64Array(count).fill(Infinity);
  const came = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const heap = new MinHeap();
  const gi = goal % spec.width;
  const gj = Math.floor(goal / spec.width);
  const heuristic = (index: number): number =>
    Math.hypot((index % spec.width) - gi, Math.floor(index / spec.width) - gj) * spec.cellSize;
  g[start] = 0;
  heap.push(heuristic(start), start);

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current]) continue;
    if (current === goal) break;
    closed[current] = 1;
    const ci = current % spec.width;
    const cj = Math.floor(current / spec.width);
    const hc = heights.values[current]!;
    for (const [di, dj, through] of MOVES) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= spec.width || nj >= spec.depth) continue;
      const next = nj * spec.width + ni;
      if (closed[next] || !passable(next)) continue;
      let wet = water.values[next]! >= 0.5;
      let open = true;
      for (const [ti, tj] of through) {
        const index = (cj + tj) * spec.width + (ci + ti);
        if (!passable(index)) open = false;
        if (water.values[index]! >= 0.5) wet = true;
      }
      if (!open) continue;
      const length = Math.hypot(di, dj) * spec.cellSize;
      const hn = heights.values[next]!;
      const rise = Number.isNaN(hc) || Number.isNaN(hn) ? 0 : Math.abs(hn - hc);
      const ratio = (Math.atan(rise / length) * (180 / Math.PI)) / request.maxSlopeDeg;
      const slope = ratio <= 1 ? 1 + 0.5 * ratio * ratio : 1.5 + STEEP_COST * (ratio - 1);
      const corridor = guide ? 1 + GUIDE_WEIGHT * Math.min(1, guide.values[next]! / GUIDE_CORRIDOR) : 1;
      const cost = g[current]! + length * slope * corridor * (wet ? WATER_COST : 1);
      if (cost < g[next]!) {
        g[next] = cost;
        came[next] = current;
        heap.push(cost + heuristic(next), next);
      }
    }
  }
  if (!Number.isFinite(g[goal]!)) return null;
  const cells: number[] = [];
  for (let index = goal; index !== -1; index = came[index]!) cells.push(index);
  cells.reverse();
  return { cells, from: request.from, to: request.to };
}

/** Binary min-heap of (priority, index); ties pop the lower index, so runs are deterministic. */
class MinHeap {
  private readonly priorities: number[] = [];
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(priority: number, item: number): void {
    this.priorities.push(priority);
    this.items.push(item);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!this.less(child, parent)) break;
      this.swap(child, parent);
      child = parent;
    }
  }

  pop(): number {
    const top = this.items[0]!;
    const lastPriority = this.priorities.pop()!;
    const lastItem = this.items.pop()!;
    if (this.items.length > 0) {
      this.priorities[0] = lastPriority;
      this.items[0] = lastItem;
      let parent = 0;
      for (;;) {
        const left = 2 * parent + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < this.items.length && this.less(left, smallest)) smallest = left;
        if (right < this.items.length && this.less(right, smallest)) smallest = right;
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const pa = this.priorities[a]!;
    const pb = this.priorities[b]!;
    return pa < pb || (pa === pb && this.items[a]! < this.items[b]!);
  }

  private swap(a: number, b: number): void {
    [this.priorities[a], this.priorities[b]] = [this.priorities[b]!, this.priorities[a]!];
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
  }
}

// ---------------------------------------------------------------- smoothing

function smoothPath(solved: Solved, grid: ObstacleGrid): WorldPoint[] {
  const { spec } = grid;
  const raw = solved.cells.map((index): WorldPoint => [
    spec.origin[0] + ((index % spec.width) + 0.5) * spec.cellSize,
    spec.origin[1] + (Math.floor(index / spec.width) + 0.5) * spec.cellSize,
  ]);
  raw[0] = solved.from;
  raw[raw.length - 1] = solved.to;
  if (raw.length === 1) raw.push(solved.to);
  const simplified = simplify(raw, spec.cellSize);
  // Smoothing may cut a corner into a protected area or the water the path went around: then less of it.
  const rawObstacles = obstacles(raw, grid);
  const candidates = [chaikin(simplified, 2), simplified].map((points) => resampleEvenly(points));
  const clear = candidates.find((points) => {
    const found = obstacles(points, grid);
    return found.protectedHits <= rawObstacles.protectedHits && found.waterCrossings <= rawObstacles.waterCrossings;
  });
  return clear ?? resampleEvenly(raw);
}

/** Douglas-Peucker; keeps both ends. */
function simplify(points: readonly WorldPoint[], tolerance: number): WorldPoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const d = segmentDistance(points[index]!, points[first]!, points[last]!);
      if (d > worstDistance) {
        worst = index;
        worstDistance = d;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([first, worst], [worst, last]);
  }
  return points.filter((_, index) => keep[index] === 1);
}

/** Chaikin corner cutting; keeps both ends. */
function chaikin(points: readonly WorldPoint[], iterations: number): WorldPoint[] {
  let current = [...points];
  for (let step = 0; step < iterations && current.length > 2; step += 1) {
    const next: WorldPoint[] = [current[0]!];
    for (let index = 0; index + 1 < current.length; index += 1) {
      const a = current[index]!;
      const b = current[index + 1]!;
      if (index > 0) next.push(lerp(a, b, 0.25));
      if (index + 2 < current.length) next.push(lerp(a, b, 0.75));
    }
    next.push(current[current.length - 1]!);
    current = next;
  }
  return current;
}

// ---------------------------------------------------------------- resampling

/**
 * Keeps every control point and splits each leg into equal runs of at most
 * `ROUTE_SPACING` (longer when the route would exceed the point limit).
 */
export function resampleKeepingVertices(control: readonly WorldPoint[]): WorldPoint[] {
  const legs = control.slice(1).map((point, index) => distance(control[index]!, point));
  const total = legs.reduce((sum, length) => sum + length, 0);
  const spacing = Math.max(ROUTE_SPACING, total / Math.max(1, MAX_ROUTE_POINTS - control.length));
  const route: WorldPoint[] = [control[0]!];
  legs.forEach((length, index) => {
    if (length === 0) return;
    const pieces = Math.max(1, Math.ceil(length / spacing - 1e-9));
    for (let step = 1; step <= pieces; step += 1) route.push(lerp(control[index]!, control[index + 1]!, step / pieces));
  });
  return route;
}

/** Evenly spaced along the polyline, legs of at most `ROUTE_SPACING`, ends exact. */
function resampleEvenly(points: readonly WorldPoint[]): WorldPoint[] {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative[index - 1]! + distance(points[index - 1]!, points[index]!));
  const total = cumulative[cumulative.length - 1]!;
  const pieces = Math.min(MAX_ROUTE_POINTS - 1, Math.max(1, Math.ceil(total / ROUTE_SPACING - 1e-9)));
  const route: WorldPoint[] = [points[0]!];
  let leg = 1;
  for (let step = 1; step < pieces; step += 1) {
    const at = (total * step) / pieces;
    while (cumulative[leg]! < at) leg += 1;
    const span = cumulative[leg]! - cumulative[leg - 1]!;
    route.push(lerp(points[leg - 1]!, points[leg]!, span === 0 ? 0 : (at - cumulative[leg - 1]!) / span));
  }
  route.push(points[points.length - 1]!);
  return route;
}

// ---------------------------------------------------------------- geometry

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function lerp(a: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function segmentDistance(point: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq));
  return distance(point, [a[0] + dx * t, a[1] + dz * t]);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
