/**
 * A settlement's built-up core (World Builder plan v0.4 §13.5, L2).
 *
 * The core is where the settlement's streets, parcels and buildings go. It
 * used to be a disc of the radius the program needs; on uneven ground a disc
 * reaches up the slopes and into the water while the buildable ground runs
 * elsewhere — a valley village runs along its valley. `growCore` grows the
 * core over the ground instead: from the centre's cell it takes buildable
 * cells (gentle enough, dry, unprotected, on the terrain) in order of their
 * walking distance from the centre until the core holds the program's area.
 * Ground it cannot cross stops it there, so the core follows a winding valley.
 * The core is the outer edge of the cells it took.
 *
 * A site without an outline (a recipe written before cores grew) is the disc
 * of its `coreRadius`; every test here takes either, so older recipes give
 * the same streets and parcels as before.
 *
 * Pure and deterministic. Dependency-free.
 */
import { gridSpecForBounds, heightField, slopeField, type GridSpec } from "./field";
import { protectedMask } from "./masks";
import type { WorldPoint } from "./normalize";
import type { RouteContext } from "./route";
import { coreMeans, waterLevels } from "./siteSelection";

/** Ground sampling cell, metres. */
export const CORE_CELL = 4;
/** A core reaches at most this many times the disc radius its program needs (walking distance). */
export const CORE_MAX_REACH_FACTOR = 3;
/** Ground this close to water is not built on, metres. */
const CORE_WATER_CLEARANCE = 10;
/**
 * A road leaving a grown core for less than this and coming back has not left
 * the settlement: the core's edge is ragged where it follows a stream or a
 * slope beside the road, metres.
 */
export const CORE_ENTRY_GAP = 40;
/** Sampling step along a line for its spans in the core, metres. */
const SPAN_STEP = 2;
/** The outline keeps within this share of a cell of the cells' edge. */
const OUTLINE_TOLERANCE = 0.75;
const MAX_CORE_CELLS = 512;

/** A core: the disc of `radius`, or the `outline` when it has one (`radius` is then its reach). */
export interface CoreShape {
  center: WorldPoint;
  radius: number;
  outline?: readonly WorldPoint[];
}

export type CoreBlock = "steep" | "water" | "flood" | "protected" | "offTerrain";

export interface CoreGrowth {
  outline: WorldPoint[];
  /** Farthest outline point from the centre, metres. */
  reach: number;
  /** Area the core holds and the area it wanted, m². */
  area: number;
  targetArea: number;
  /** Ground the growth met and could not take, by cells. */
  stopped: Partial<Record<CoreBlock | "reach", number>>;
}

export interface CoreGrowthOptions {
  maxSlopeDeg: number;
  /** Height kept above nearby water, metres; default by the water's kind. */
  floodMargin?: number;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Grows the core of `targetArea` m² around `center` over buildable ground. */
export function growCore(
  context: RouteContext,
  center: WorldPoint,
  targetArea: number,
  options: CoreGrowthOptions,
): CoreGrowth {
  const maxReach = CORE_MAX_REACH_FACTOR * Math.sqrt(targetArea / Math.PI);
  const ground = coreGround(context, center, maxReach, options);
  const { spec, blocked } = ground;
  const cellArea = spec.cellSize * spec.cellSize;
  const wanted = Math.max(1, Math.ceil(targetArea / cellArea));
  const taken = new Uint8Array(spec.width * spec.depth);
  const cost = new Float64Array(spec.width * spec.depth).fill(Infinity);
  const stopped: CoreGrowth["stopped"] = {};
  const seen = new Uint8Array(spec.width * spec.depth);
  const start = cellOf(spec, center);
  const queue = new MinQueue();
  // The centre's own cell is the core's seed even on poor ground: the site stage chose it.
  cost[start] = 0;
  queue.push(start, 0);
  let count = 0;
  while (count < wanted && queue.size > 0) {
    const cell = queue.pop();
    if (taken[cell]) continue;
    taken[cell] = 1;
    count += 1;
    const i = cell % spec.width;
    const j = Math.floor(cell / spec.width);
    for (const [di, dj, step] of NEIGHBOURS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= spec.width || nj >= spec.depth) continue;
      const next = nj * spec.width + ni;
      if (taken[next]) continue;
      const nextCost = cost[cell]! + step * spec.cellSize;
      const block = nextCost > maxReach ? "reach" : blocked[next] ? BLOCKS[blocked[next]! - 1]! : null;
      if (block) {
        if (!seen[next]) {
          seen[next] = 1;
          stopped[block] = (stopped[block] ?? 0) + 1;
        }
        continue;
      }
      if (nextCost < cost[next]!) {
        cost[next] = nextCost;
        queue.push(next, nextCost);
      }
    }
  }
  const outline = traceOutline(spec, taken);
  const reach = Math.max(...outline.map((point) => Math.hypot(point[0] - center[0], point[1] - center[1])));
  return {
    outline,
    reach: Math.ceil(reach),
    area: Math.round(count * cellArea),
    targetArea: Math.round(targetArea),
    stopped,
  };
}

const BLOCKS: readonly CoreBlock[] = ["steep", "water", "flood", "protected", "offTerrain"];

/** The ground around `center` on a `CORE_CELL` grid: 0 buildable, else 1 + the `BLOCKS` index of why not. */
function coreGround(
  context: RouteContext,
  center: WorldPoint,
  reach: number,
  options: CoreGrowthOptions,
): { spec: GridSpec; blocked: Uint8Array } {
  const half = reach + CORE_CELL;
  const spec: GridSpec = gridSpecForBounds(
    { min: [center[0] - half, center[1] - half], max: [center[0] + half, center[1] + half] },
    Math.max(CORE_CELL, (2 * half) / MAX_CORE_CELLS),
  );
  const heights = heightField(spec, context.sampleHeight);
  // Mean over 3 × 3 cells: a bump in the ground does not stop the core, a slope does.
  const slopes = coreMeans(slopeField(heights), 1).mean;
  const water = waterLevels(spec, context);
  const guarded = protectedMask(spec, context).field.values;
  const blocked = new Uint8Array(spec.width * spec.depth);
  const code = (block: CoreBlock) => BLOCKS.indexOf(block) + 1;
  for (let index = 0; index < blocked.length; index += 1) {
    const height = heights.values[index]!;
    if (Number.isNaN(height)) {
      blocked[index] = code("offTerrain");
      continue;
    }
    if (guarded[index]! >= 0.5) {
      blocked[index] = code("protected");
      continue;
    }
    for (const source of water) {
      const distance = source.distance.values[index]!;
      if (distance <= CORE_WATER_CLEARANCE) blocked[index] = code("water");
      else if (distance < source.reach && height < source.level[index]! + (options.floodMargin ?? source.margin)) blocked[index] = code("flood");
      if (blocked[index]) break;
    }
    if (blocked[index]) continue;
    const slope = slopes[index]!;
    if (Number.isNaN(slope) || slope > options.maxSlopeDeg) blocked[index] = code("steep");
  }
  return { spec, blocked };
}

function cellOf(spec: GridSpec, [x, z]: WorldPoint): number {
  const i = Math.min(spec.width - 1, Math.max(0, Math.floor((x - spec.origin[0]) / spec.cellSize)));
  const j = Math.min(spec.depth - 1, Math.max(0, Math.floor((z - spec.origin[1]) / spec.cellSize)));
  return j * spec.width + i;
}

/**
 * Outer edge of the taken cells: their boundary edges joined into loops (inside
 * on the left), the longest loop kept — a hole inside the core stays part of it
 * — then straightened to within `OUTLINE_TOLERANCE` of a cell.
 */
function traceOutline(spec: GridSpec, taken: Uint8Array): WorldPoint[] {
  const { width, depth } = spec;
  const isTaken = (i: number, j: number) => i >= 0 && j >= 0 && i < width && j < depth && taken[j * width + i] === 1;
  // Directed edges on the grid's corner lattice, keyed by their start corner.
  const next = new Map<number, number[]>();
  const corner = (i: number, j: number) => j * (width + 1) + i;
  const add = (a: number, b: number) => {
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  };
  for (let j = 0; j < depth; j += 1) {
    for (let i = 0; i < width; i += 1) {
      if (!isTaken(i, j)) continue;
      // Counter-clockwise in (i, j): bottom, right, top, left — each where the neighbour is outside.
      if (!isTaken(i, j - 1)) add(corner(i, j), corner(i + 1, j));
      if (!isTaken(i + 1, j)) add(corner(i + 1, j), corner(i + 1, j + 1));
      if (!isTaken(i, j + 1)) add(corner(i + 1, j + 1), corner(i, j + 1));
      if (!isTaken(i - 1, j)) add(corner(i, j + 1), corner(i, j));
    }
  }
  let best: number[] = [];
  for (const startCorner of [...next.keys()].sort((a, b) => a - b)) {
    while ((next.get(startCorner)?.length ?? 0) > 0) {
      const loop: number[] = [startCorner];
      let at = next.get(startCorner)!.shift()!;
      while (at !== startCorner) {
        loop.push(at);
        const options = next.get(at);
        if (!options || options.length === 0) break;
        at = options.shift()!;
      }
      if (loop.length > best.length) best = loop;
    }
  }
  const points: WorldPoint[] = best.map((key) => {
    const i = key % (width + 1);
    const j = Math.floor(key / (width + 1));
    return [spec.origin[0] + i * spec.cellSize, spec.origin[1] + j * spec.cellSize];
  });
  return simplifyLoop(points, OUTLINE_TOLERANCE * spec.cellSize).map(([x, z]) => [round1(x), round1(z)]);
}

/** Douglas–Peucker on a closed loop, split at its two farthest-apart points. */
function simplifyLoop(points: readonly WorldPoint[], tolerance: number): WorldPoint[] {
  if (points.length <= 4) return [...points];
  let far = 0;
  let farDistance = -1;
  for (let index = 1; index < points.length; index += 1) {
    const d = Math.hypot(points[index]![0] - points[0]![0], points[index]![1] - points[0]![1]);
    if (d > farDistance) {
      farDistance = d;
      far = index;
    }
  }
  const first = simplify([...points.slice(0, far + 1)], tolerance);
  const second = simplify([...points.slice(far), points[0]!], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function simplify(points: WorldPoint[], tolerance: number): WorldPoint[] {
  if (points.length <= 2) return points;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  let worst = 0;
  let worstIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const d = pointLineDistance(points[index]!, a, b);
    if (d > worst) {
      worst = d;
      worstIndex = index;
    }
  }
  if (worst <= tolerance) return [a, b];
  const left = simplify(points.slice(0, worstIndex + 1), tolerance);
  const right = simplify(points.slice(worstIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function pointLineDistance(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - dz * (a[0] - p[0])) / length;
}

/** Binary min-heap of cell indices by cost. */
class MinQueue {
  private readonly cells: number[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, cost: number): void {
    this.cells.push(cell);
    this.costs.push(cost);
    let at = this.cells.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.costs[parent]! < cost || (this.costs[parent] === cost && this.cells[parent]! <= cell)) break;
      this.swap(at, parent);
      at = parent;
    }
  }

  pop(): number {
    const top = this.cells[0]!;
    const lastCell = this.cells.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.cells.length > 0) {
      this.cells[0] = lastCell;
      this.costs[0] = lastCost;
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let least = at;
        if (left < this.cells.length && this.before(left, least)) least = left;
        if (right < this.cells.length && this.before(right, least)) least = right;
        if (least === at) break;
        this.swap(at, least);
        at = least;
      }
    }
    return top;
  }

  private before(a: number, b: number): boolean {
    return this.costs[a]! < this.costs[b]! || (this.costs[a] === this.costs[b] && this.cells[a]! < this.cells[b]!);
  }

  private swap(a: number, b: number): void {
    [this.cells[a], this.cells[b]] = [this.cells[b]!, this.cells[a]!];
    [this.costs[a], this.costs[b]] = [this.costs[b]!, this.costs[a]!];
  }
}

// ---------------------------------------------------------------- tests on a core

export function inCore(core: CoreShape, point: WorldPoint): boolean {
  if (!core.outline) return Math.hypot(point[0] - core.center[0], point[1] - core.center[1]) <= core.radius;
  return pointInPolygon(point, core.outline);
}

/**
 * Arc-length spans of a polyline inside the core, `[start, end]` in metres from
 * its first point, with gaps shorter than `CORE_ENTRY_GAP` closed: where a road
 * really enters (a span's start past 0) and leaves (an end before its length).
 */
export function coreSpans(core: CoreShape, points: readonly WorldPoint[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let s = 0;
  let open: number | null = null;
  for (let leg = 1; leg < points.length; leg += 1) {
    const a = points[leg - 1]!;
    const b = points[leg]!;
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(span / SPAN_STEP));
    for (let step = leg === 1 ? 0 : 1; step <= steps; step += 1) {
      const t = step / steps;
      const at = s + span * t;
      const inside = inCore(core, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (inside && open === null) open = at;
      if (!inside && open !== null) {
        spans.push([open, at]);
        open = null;
      }
    }
    s += span;
  }
  if (open !== null) spans.push([open, s]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] - last[1] < CORE_ENTRY_GAP) last[1] = span[1];
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/** Point at arc length `s` along a polyline. */
export function pointAlong(points: readonly WorldPoint[], s: number): WorldPoint {
  let left = s;
  for (let leg = 1; leg < points.length; leg += 1) {
    const a = points[leg - 1]!;
    const b = points[leg]!;
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= span || leg === points.length - 1) {
      const t = span > 0 ? Math.min(1, left / span) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= span;
  }
  return points[0]!;
}

/** Length of a polyline inside the core, sampled every metre. */
export function lengthInCore(core: CoreShape, points: readonly WorldPoint[]): number {
  let inside = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(span));
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps;
      if (inCore(core, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) inside += span / steps;
    }
  }
  return inside;
}

/** Parameters in [0, 1) where segment a→b crosses the circle. */
export function circleCrossings(a: WorldPoint, b: WorldPoint, center: WorldPoint, radius: number): number[] {
  const d: WorldPoint = [b[0] - a[0], b[1] - a[1]];
  const f: WorldPoint = [a[0] - center[0], a[1] - center[1]];
  const qa = d[0] * d[0] + d[1] * d[1];
  if (qa === 0) return [];
  const qb = 2 * (f[0] * d[0] + f[1] * d[1]);
  const qc = f[0] * f[0] + f[1] * f[1] - radius * radius;
  const disc = qb * qb - 4 * qa * qc;
  if (disc <= 0) return [];
  const root = Math.sqrt(disc);
  return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].filter((t) => t >= 0 && t < 1);
}

function pointInPolygon([x, z]: WorldPoint, polygon: readonly WorldPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
