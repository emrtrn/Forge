/**
 * Terraced ground on a slope (World Builder plan v0.4 track step 2c): stone
 * retaining walls where a pad cuts into or stands above the ground around it,
 * openings in them where a way in reaches the pad, steps in an opening that
 * meets a height difference, and large open pads (a square) split into
 * terraces across the slope, joined by steps.
 *
 * Walls, steps and terraces are pad data: measured once from the ground beside
 * the pad and kept with it, so baking the pad (which changes that ground) does
 * not change them. A walled pad blends into the terrain over `WALL_FALLOFF`
 * instead of the long soft margin, so the wall is what holds the step.
 *
 * First used for the Derekavak greybox (Ridgebound). Pure and deterministic;
 * dependency-free.
 */
import type { WorldPoint } from "./normalize";

/** Cut or fill beside a pad above this needs a retaining wall, metres. */
export const WALL_THRESHOLD = 0.8;
/** A walled pad blends into the terrain over this distance, metres. */
export const WALL_FALLOFF = 1;
/** The ground beside a pad is read this far outside its edge (past the walled falloff), metres. */
export const WALL_PROBE = 2;
export const WALL_THICKNESS = 0.6;
/** A fill wall stands this far above its pad (a parapet); a cut wall reaches this far below it. */
export const WALL_PARAPET = 0.4;
export const WALL_FOOTING = 0.4;
/** A height difference in an opening above this gets steps, metres. */
export const STEP_FREE = 0.4;
/** Steps rise at this angle, degrees. */
export const STAIR_ANGLE_DEG = 33;
/** Height of one step, metres. */
export const STEP_RISE = 0.2;
/** An open pad whose ground varies more than this is split into terraces, metres. */
export const TERRACE_STEP = 2.5;
/** Width of the steps between terraces, metres. */
export const TERRACE_STAIR_WIDTH = 2.5;

export interface PadWall {
  from: WorldPoint;
  to: WorldPoint;
  /** Bottom and top of the wall, world metres. */
  bottom: number;
  top: number;
}

/** A flight of steps: rises from `foot` (at `low`) to `head` (at `high`). */
export interface PadStair {
  foot: WorldPoint;
  head: WorldPoint;
  width: number;
  low: number;
  high: number;
}

export interface PadOpening {
  /** A point on (or next to) the pad's edge. */
  at: WorldPoint;
  width: number;
}

export interface RetainedPad {
  walls: PadWall[];
  stairs: PadStair[];
  /** Largest cut and fill beside the pad, metres. */
  maxCut: number;
  maxFill: number;
}

type Sample = (x: number, z: number) => number | null;

const sub = (a: WorldPoint, b: WorldPoint): WorldPoint => [a[0] - b[0], a[1] - b[1]];
const add = (a: WorldPoint, b: WorldPoint, scale = 1): WorldPoint => [a[0] + b[0] * scale, a[1] + b[1] * scale];
const dot = (a: WorldPoint, b: WorldPoint): number => a[0] * b[0] + a[1] * b[1];
const length = (a: WorldPoint): number => Math.hypot(a[0], a[1]);
const round = (value: number, digits = 3): number => Number(value.toFixed(digits));
const roundPoint = (p: WorldPoint): WorldPoint => [round(p[0]), round(p[1])];

function centroid(polygon: readonly WorldPoint[]): WorldPoint {
  const sum = polygon.reduce<WorldPoint>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return [sum[0] / polygon.length, sum[1] / polygon.length];
}

/**
 * Walls around one pad. `skipEdges` are edge indices (edge i runs from corner i to
 * corner i + 1) that another pad shares, whose wall the caller builds. The polygon
 * is convex (a building pad or a terrace strip).
 */
export function retainPad(
  polygon: readonly WorldPoint[],
  level: number,
  sampleHeight: Sample,
  openings: readonly PadOpening[] = [],
  skipEdges: readonly number[] = [],
): RetainedPad {
  const centre = centroid(polygon);
  const walls: PadWall[] = [];
  const stairs: PadStair[] = [];
  let maxCut = 0, maxFill = 0;
  polygon.forEach((a, edge) => {
    if (skipEdges.includes(edge)) return;
    const b = polygon[(edge + 1) % polygon.length]!;
    const span = length(sub(b, a));
    if (span < 1e-6) return;
    const along: WorldPoint = [(b[0] - a[0]) / span, (b[1] - a[1]) / span];
    let normal: WorldPoint = [along[1], -along[0]];
    if (dot(normal, sub(add(a, along, span / 2), centre)) < 0) normal = [-normal[0], -normal[1]];

    // Ground beside the edge, every metre.
    const count = Math.max(2, Math.ceil(span) + 1);
    const samples: Array<{ s: number; diff: number | null }> = [];
    for (let k = 0; k < count; k += 1) {
      const s = (span * k) / (count - 1);
      const [x, z] = add(add(a, along, s), normal, WALL_PROBE);
      const ground = sampleHeight(x, z);
      const diff = ground === null ? null : ground - level;
      samples.push({ s, diff });
      if (diff !== null) { maxCut = Math.max(maxCut, diff); maxFill = Math.max(maxFill, -diff); }
    }
    const kindOf = (diff: number | null): "cut" | "fill" | null => (diff === null ? null : diff > WALL_THRESHOLD ? "cut" : diff < -WALL_THRESHOLD ? "fill" : null);

    // Openings on this edge, as intervals along it.
    const gaps = openings.flatMap((opening) => {
      const rel = sub(opening.at, a);
      const s = dot(rel, along), off = Math.abs(dot(rel, normal));
      return s >= -opening.width / 2 && s <= span + opening.width / 2 && off <= WALL_PROBE + 1 ? [{ s, width: opening.width }] : [];
    });

    // Runs of one kind, cut back by the openings.
    const step = span / (count - 1);
    let k = 0;
    while (k < count) {
      const kind = kindOf(samples[k]!.diff);
      let end = k;
      while (end + 1 < count && kindOf(samples[end + 1]!.diff) === kind) end += 1;
      if (kind) {
        const run = samples.slice(k, end + 1).map((sample) => sample.diff!);
        let pieces: Array<[number, number]> = [[Math.max(0, samples[k]!.s - step / 2), Math.min(span, samples[end]!.s + step / 2)]];
        for (const gap of gaps) {
          pieces = pieces.flatMap(([s0, s1]): Array<[number, number]> => [[s0, Math.min(s1, gap.s - gap.width / 2)], [Math.max(s0, gap.s + gap.width / 2), s1]])
            .filter(([s0, s1]) => s1 - s0 > 0.5);
        }
        const bottom = kind === "cut" ? level - WALL_FOOTING : level + Math.min(...run) - WALL_FOOTING;
        const top = kind === "cut" ? level + Math.max(...run) : level + WALL_PARAPET;
        for (const [s0, s1] of pieces) {
          // Centred on the edge's outside face.
          walls.push({
            from: roundPoint(add(add(a, along, s0), normal, WALL_THICKNESS / 2)),
            to: roundPoint(add(add(a, along, s1), normal, WALL_THICKNESS / 2)),
            bottom: round(bottom, 2), top: round(top, 2),
          });
        }
      }
      k = end + 1;
    }

    // Steps in an opening that meets a height difference, on its low side.
    for (const gap of gaps) {
      const s = Math.max(0, Math.min(span, gap.s));
      const nearest = samples.reduce((best, sample) => (Math.abs(sample.s - s) < Math.abs(best.s - s) ? sample : best));
      if (nearest.diff === null || Math.abs(nearest.diff) <= STEP_FREE) continue;
      const rise = Math.abs(nearest.diff);
      const run = rise / Math.tan((STAIR_ANGLE_DEG * Math.PI) / 180);
      const onEdge = add(a, along, s);
      // Ground higher outside: the steps go down into the pad; lower outside: down away from it.
      const down: WorldPoint = nearest.diff > 0 ? [-normal[0], -normal[1]] : normal;
      stairs.push({
        foot: roundPoint(add(onEdge, down, run)),
        head: roundPoint(onEdge),
        width: gap.width,
        low: round(level + Math.min(0, nearest.diff), 2),
        high: round(level + Math.max(0, nearest.diff), 2),
      });
    }
  });
  return { walls, stairs, maxCut: round(maxCut, 2), maxFill: round(maxFill, 2) };
}

/** A rectangle given by its centre, unit axes and extents (`front` towards `-inward`). */
export interface PadFrame {
  center: WorldPoint;
  along: WorldPoint;
  inward: WorldPoint;
  halfAlong: number;
  front: number;
  back: number;
}

export function frameCorners(frame: PadFrame, front = frame.front, back = frame.back): WorldPoint[] {
  const at = (a: number, b: number): WorldPoint => [
    frame.center[0] + frame.along[0] * a + frame.inward[0] * b,
    frame.center[1] + frame.along[1] * a + frame.inward[1] * b,
  ];
  return [at(-frame.halfAlong, -front), at(frame.halfAlong, -front), at(frame.halfAlong, back), at(-frame.halfAlong, back)].map(roundPoint);
}

export interface Terrace {
  polygon: WorldPoint[];
  level: number;
}

export interface TerracedPad {
  terraces: Terrace[];
  /** Walls and steps between neighbouring terraces; `boundary` k lies between terrace k - 1 and k. */
  walls: Array<PadWall & { boundary: number }>;
  stairs: Array<PadStair & { boundary: number }>;
}

/** Mean ground at a strip's quarter points (they sit at its level once it is baked). */
function stripLevel(frame: PadFrame, s0: number, s1: number, sampleHeight: Sample): number | null {
  const values: number[] = [];
  for (const fa of [-0.5, 0, 0.5]) {
    for (const fb of [0.25, 0.75]) {
      const b = s0 + (s1 - s0) * fb;
      const p: WorldPoint = [
        frame.center[0] + frame.along[0] * fa * frame.halfAlong + frame.inward[0] * b,
        frame.center[1] + frame.along[1] * fa * frame.halfAlong + frame.inward[1] * b,
      ];
      const ground = sampleHeight(p[0], p[1]);
      if (ground === null) return null;
      values.push(ground);
    }
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Splits an open pad into terraces across its depth when its ground varies more
 * than `TERRACE_STEP`; a pad that needs no split comes back as one terrace.
 */
export function terracePad(frame: PadFrame, sampleHeight: Sample): TerracedPad | null {
  const depth = frame.front + frame.back;
  const whole = stripLevel(frame, -frame.front, frame.back, sampleHeight);
  if (whole === null) return null;
  // Ground spread over the pad, from a coarse grid.
  let low = Infinity, high = -Infinity;
  for (let fa = -1; fa <= 1; fa += 0.5) {
    for (let fb = 0; fb <= 1; fb += 0.125) {
      const b = -frame.front + depth * fb;
      const ground = sampleHeight(
        frame.center[0] + frame.along[0] * fa * frame.halfAlong + frame.inward[0] * b,
        frame.center[1] + frame.along[1] * fa * frame.halfAlong + frame.inward[1] * b,
      );
      if (ground === null) return null;
      low = Math.min(low, ground); high = Math.max(high, ground);
    }
  }
  const count = Math.max(1, Math.ceil((high - low) / TERRACE_STEP - 1e-9));
  if (count === 1) return { terraces: [{ polygon: frameCorners(frame), level: round(whole, 2) }], walls: [], stairs: [] };
  const terraces: Terrace[] = [];
  for (let k = 0; k < count; k += 1) {
    const s0 = -frame.front + (depth * k) / count, s1 = -frame.front + (depth * (k + 1)) / count;
    const level = stripLevel(frame, s0, s1, sampleHeight);
    if (level === null) return null;
    terraces.push({ polygon: frameCorners(frame, -s0, s1), level: round(level, 2) });
  }
  const walls: TerracedPad["walls"] = [];
  const stairs: TerracedPad["stairs"] = [];
  const run = (rise: number) => rise / Math.tan((STAIR_ANGLE_DEG * Math.PI) / 180);
  for (let k = 1; k < count; k += 1) {
    const lower = Math.min(terraces[k - 1]!.level, terraces[k]!.level), upper = Math.max(terraces[k - 1]!.level, terraces[k]!.level);
    // The shared edge: back edge of terrace k - 1 (corners 3 → 2).
    const [left, right] = [terraces[k - 1]!.polygon[3]!, terraces[k - 1]!.polygon[2]!];
    const mid: WorldPoint = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
    const half = TERRACE_STAIR_WIDTH / 2 + 0.5;
    const span = length(sub(right, left));
    const along: WorldPoint = [(right[0] - left[0]) / span, (right[1] - left[1]) / span];
    for (const [s0, s1] of [[0, span / 2 - half], [span / 2 + half, span]] as const) {
      if (s1 - s0 > 0.5) walls.push({ from: roundPoint(add(left, along, s0)), to: roundPoint(add(left, along, s1)), bottom: round(lower - WALL_FOOTING, 2), top: round(upper + WALL_PARAPET, 2), boundary: k });
    }
    if (upper - lower > STEP_FREE) {
      // Down from the shared edge onto the lower terrace.
      const lowerIsFront = terraces[k - 1]!.level < terraces[k]!.level;
      const down: WorldPoint = lowerIsFront ? [-frame.inward[0], -frame.inward[1]] : frame.inward;
      stairs.push({ foot: roundPoint(add(mid, down, run(upper - lower))), head: roundPoint(mid), width: TERRACE_STAIR_WIDTH, low: round(lower, 2), high: round(upper, 2), boundary: k });
    }
  }
  return { terraces, walls, stairs };
}
