/**
 * Road vertical profiles (World Builder plan v0.4 track step 2b): the height a
 * road runs at along its route, designed for a grade limit instead of copying
 * the ground. Where the ground is steeper the road cuts into it or sits on fill;
 * where it already fits the limit the road keeps to the ground.
 *
 * A profile honours fixed heights (a junction, a bridge deck, a parcel's yard
 * level). When two fixed heights are too far apart for the limit, the grade they
 * need is spread evenly between them rather than piled on one step, and the
 * result reports it (`overLimit`).
 *
 * A network is solved in order (the caller puts the most important roads first):
 * where a later road joins or crosses an earlier one it takes that road's height.
 *
 * First used for the Derekavak greybox (Ridgebound). Pure and deterministic;
 * dependency-free.
 */
import type { WorldPoint } from "./normalize";

export interface ProfileFix {
  index: number;
  height: number;
}

export interface RoadProfile {
  heights: number[];
  /** Steepest step of the result, rise over run. */
  maxGrade: number;
  /** Deepest cut below the ground and highest fill above it, metres. */
  maxCut: number;
  maxFill: number;
  /** The fixed heights force a grade above the limit somewhere. */
  overLimit: boolean;
}

/** Corner softening: the cut/fill offset is averaged over this many points each side. */
const SOFTEN_REACH = 2;
const SOFTEN_PASSES = 3;
const CLAMP_PASSES = 6;

/**
 * One road: `ground` is the terrain height at each route point, `maxGrade` the
 * limit as rise over run (tan of the slope angle).
 */
export function designRoadProfile(
  points: readonly WorldPoint[],
  ground: readonly number[],
  maxGrade: number,
  fixes: readonly ProfileFix[] = [],
): RoadProfile {
  const n = points.length;
  if (n === 0 || ground.length !== n) throw new Error("road profile needs one ground height per route point");
  if (!(maxGrade > 0) || !Number.isFinite(maxGrade)) throw new Error(`road profile grade limit must be positive, got ${maxGrade}`);
  if (!ground.every(Number.isFinite)) throw new Error("road profile ground heights must be finite");
  const station = [0];
  for (let i = 1; i < n; i += 1) station.push(station[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  const fixed = new Map<number, number>();
  for (const fix of fixes) {
    if (!Number.isInteger(fix.index) || fix.index < 0 || fix.index >= n || !Number.isFinite(fix.height)) {
      throw new Error(`road profile fix out of range: ${fix.index}`);
    }
    if (!fixed.has(fix.index)) fixed.set(fix.index, fix.height);
  }

  // limit[i] bounds the step from i-1 to i: the grade limit, or the grade two
  // neighbouring fixed heights need when the limit cannot join them.
  const limit = new Array<number>(n).fill(maxGrade);
  const pinned = [...fixed.keys()].sort((a, b) => a - b);
  let overLimit = false;
  for (let k = 1; k < pinned.length; k += 1) {
    const i0 = pinned[k - 1]!, i1 = pinned[k]!;
    const run = station[i1]! - station[i0]!;
    const need = run > 1e-9 ? Math.abs(fixed.get(i1)! - fixed.get(i0)!) / run : Infinity;
    if (need > maxGrade * 1.0001) {
      overLimit = true;
      for (let i = i0 + 1; i <= i1; i += 1) limit[i] = Math.max(limit[i]!, need * 1.0001);
    }
  }

  let heights = ground.map((value, index) => fixed.get(index) ?? value);
  const clamp = (): void => {
    for (let i = 1; i < n; i += 1) {
      if (fixed.has(i)) continue;
      const step = limit[i]! * (station[i]! - station[i - 1]!);
      heights[i] = Math.min(heights[i - 1]! + step, Math.max(heights[i - 1]! - step, heights[i]!));
    }
    for (let i = n - 2; i >= 0; i -= 1) {
      if (fixed.has(i)) continue;
      const step = limit[i + 1]! * (station[i + 1]! - station[i]!);
      heights[i] = Math.min(heights[i + 1]! + step, Math.max(heights[i + 1]! - step, heights[i]!));
    }
  };
  for (let pass = 0; pass < CLAMP_PASSES; pass += 1) clamp();
  // Soften the corners where clamping starts and stops. Only the cut/fill offset
  // is averaged, so ground that already fits the limit is left exactly as it is.
  for (let pass = 0; pass < SOFTEN_PASSES; pass += 1) {
    const offset = heights.map((value, index) => value - ground[index]!);
    heights = heights.map((value, index) => {
      if (fixed.has(index)) return value;
      let sum = 0, count = 0;
      for (let k = index - SOFTEN_REACH; k <= index + SOFTEN_REACH; k += 1) {
        sum += offset[Math.max(0, Math.min(n - 1, k))]!;
        count += 1;
      }
      return ground[index]! + sum / count;
    });
    clamp();
  }

  let steepest = 0, maxCut = 0, maxFill = 0;
  for (let i = 1; i < n; i += 1) {
    const run = station[i]! - station[i - 1]!;
    if (run > 1e-9) steepest = Math.max(steepest, Math.abs(heights[i]! - heights[i - 1]!) / run);
  }
  heights.forEach((value, index) => {
    maxCut = Math.max(maxCut, ground[index]! - value);
    maxFill = Math.max(maxFill, value - ground[index]!);
  });
  return { heights, maxGrade: steepest, maxCut, maxFill, overLimit };
}

export interface NetworkRoad {
  id: string;
  points: readonly WorldPoint[];
  ground: readonly number[];
  maxGrade: number;
  /** Full width, metres: another road's end within half of it (+ tolerance) joins this road. */
  width: number;
  fixes?: readonly ProfileFix[];
}

export interface NetworkProfile extends RoadProfile {
  id: string;
  /** Heights this road took from roads solved before it. */
  joins: number;
}

/** Extra reach beyond a road's half width within which another road's end joins it, metres. */
export const JOIN_TOLERANCE = 2;

interface Nearest { index: number; point: WorldPoint; distance: number; segment: number; t: number }

function nearestOnLine(p: WorldPoint, line: readonly WorldPoint[]): Nearest {
  let best: Nearest = { index: 0, point: line[0]!, distance: Math.hypot(p[0] - line[0]![0], p[1] - line[0]![1]), segment: 0, t: 0 };
  for (let s = 1; s < line.length; s += 1) {
    const a = line[s - 1]!, b = line[s]!;
    const vx = b[0] - a[0], vz = b[1] - a[1], len = vx * vx + vz * vz;
    const t = len > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / len)) : 0;
    const point: WorldPoint = [a[0] + vx * t, a[1] + vz * t];
    const distance = Math.hypot(p[0] - point[0], p[1] - point[1]);
    if (distance < best.distance) best = { index: t < 0.5 ? s - 1 : s, point, distance, segment: s - 1, t };
  }
  return best;
}

function nearestIndex(p: WorldPoint, line: readonly WorldPoint[]): number {
  let best = 0, distance = Infinity;
  line.forEach((q, index) => {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < distance) { distance = d; best = index; }
  });
  return best;
}

function segmentCrossing(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): { t: number; u: number } | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / denom;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/**
 * Roads in solve order. A later road takes an earlier road's height where its
 * end meets that road, where an earlier road's end meets it, and where the two
 * cross; its own fixes win over those.
 */
export function designRoadNetwork(roads: readonly NetworkRoad[]): NetworkProfile[] {
  const solved: Array<{ road: NetworkRoad; heights: number[] }> = [];
  const result: NetworkProfile[] = [];
  for (const road of roads) {
    const fixes: ProfileFix[] = [...(road.fixes ?? [])];
    const taken = new Set(fixes.map((fix) => fix.index));
    let joins = 0;
    const take = (index: number, height: number): void => {
      if (taken.has(index)) return;
      taken.add(index);
      fixes.push({ index, height });
      joins += 1;
    };
    const last = road.points.length - 1;
    for (const { road: other, heights } of solved) {
      const at = (hit: Nearest): number => {
        const h0 = heights[hit.segment]!, h1 = heights[Math.min(hit.segment + 1, heights.length - 1)]!;
        return h0 + (h1 - h0) * hit.t;
      };
      // This road's ends on the other road.
      for (const end of [0, last]) {
        const hit = nearestOnLine(road.points[end]!, other.points);
        if (hit.distance <= other.width / 2 + JOIN_TOLERANCE) take(end, at(hit));
      }
      // The other road's ends on this road.
      for (const end of [0, other.points.length - 1]) {
        const hit = nearestOnLine(other.points[end]!, road.points);
        if (hit.distance <= road.width / 2 + JOIN_TOLERANCE) take(nearestIndex(hit.point, road.points), heights[end]!);
      }
      // Crossings.
      for (let s = 1; s < road.points.length; s += 1) {
        for (let o = 1; o < other.points.length; o += 1) {
          const cross = segmentCrossing(road.points[s - 1]!, road.points[s]!, other.points[o - 1]!, other.points[o]!);
          if (!cross) continue;
          take(cross.t < 0.5 ? s - 1 : s, heights[o - 1]! + (heights[o]! - heights[o - 1]!) * cross.u);
        }
      }
    }
    const profile = designRoadProfile(road.points, road.ground, road.maxGrade, fixes);
    solved.push({ road, heights: profile.heights });
    result.push({ id: road.id, ...profile, joins });
  }
  return result;
}
