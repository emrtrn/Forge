/**
 * Street-front parcels, L4 (World Builder plan v0.4 §13.5).
 *
 * Every street that runs through a settlement's core gets a strip of parcels
 * on both sides: the strip starts a verge beyond the road edge and runs one
 * parcel depth deep, and is cut across the street into frontages drawn from
 * the profile's range. That is the linear (street-village) pattern directly;
 * where streets enclose a block, the strips of its sides form the block's
 * street ring and parcels that would overlap another road, water, a protected
 * area or an earlier parcel are dropped, so a parcel always fronts a street
 * and never lies on one. Before a slot is dropped for a road or an earlier
 * parcel behind it, it is tried once more at the profile's shallowest depth:
 * lots by a junction or squeezed between streets are shallower, as in a real
 * plan. Still blocked, the next slot starts `SLIDE_STEP` further on instead
 * of a whole frontage, so the frontage resumes right past a crossing street;
 * a run of blocked slots counts as one dropped parcel. Parcels steeper than the slope limit are kept as
 * open land (§13.5: "eğimi profil sınırını aşan parsel açık alan olur").
 *
 * Streets are processed by class (highest first) then id, sides and frontages
 * in a fixed order from a seeded random stream: deterministic. Pure;
 * dependency-free.
 */
import { inCore, type CoreShape } from "./core";
import { insidePolygon } from "./field";
import type { StreetLine } from "./masks";
import type { WorldPoint } from "./normalize";
import { ROAD_CLASSES } from "./vocabulary";

/** Gap between the road edge and a parcel's front, metres. */
export const PARCEL_VERGE = 0.5;
/** Longest straight run of a parcel's front and back edges along a curving street, metres. */
const EDGE_STEP = 4;
/** Arc-length step used to find where a street is inside the core, metres. */
const CORE_STEP = 2;
/** A slot blocked by a road or a parcel moves on this far before the next try, metres. */
const SLIDE_STEP = 4;
/** Neighbouring parcels share an edge; this much inset keeps that from counting as overlap. */
const OVERLAP_INSET = 0.25;

export type ParcelDropReason = "road" | "water" | "protected" | "offTerrain" | "overlap" | "shape";

export interface ParcelRequest {
  settlement: string;
  center: WorldPoint;
  coreRadius: number;
  /** The core's outline when it grew over the ground; absent: the disc of `coreRadius`. */
  coreOutline?: readonly WorldPoint[];
  streets: readonly StreetLine[];
  frontage: [number, number];
  depth: [number, number];
  maxSlopeDeg: number;
  seed: number;
  sampleHeight: (x: number, z: number) => number | null;
  /** Why a point may not be inside a parcel; null when it may. Roads are checked here too. */
  blockedAt: (point: WorldPoint) => Exclude<ParcelDropReason, "overlap" | "shape" | "offTerrain"> | null;
}

export interface PlannedParcel {
  id: string;
  polygon: WorldPoint[];
  /** The street line it fronts. */
  street: string;
  /** The plan edge that street realises, when it has one. */
  edge?: string;
  /** Mean ground slope, degrees. */
  slopeDeg: number;
  /** Steeper than the limit: open land. */
  steep: boolean;
}

export interface ParcelResult {
  parcels: PlannedParcel[];
  dropped: Record<ParcelDropReason, number>;
  /** Parcels kept at the shallowest depth after the side's own depth hit a road or a parcel. */
  shallow: number;
}

export function subdivideStreets(request: ParcelRequest): ParcelResult {
  const random = mulberry32(request.seed);
  const parcels: PlannedParcel[] = [];
  const shrunk: Array<{ polygon: WorldPoint[]; box: Box }> = [];
  const dropped: Record<ParcelDropReason, number> = { road: 0, water: 0, protected: 0, offTerrain: 0, overlap: 0, shape: 0 };
  let shallow = 0;
  const rank = (line: StreetLine): number => (line.roadClass === undefined ? ROAD_CLASSES.length : ROAD_CLASSES.indexOf(line.roadClass));
  const streets = [...request.streets].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const core: CoreShape = { center: request.center, radius: request.coreRadius, ...(request.coreOutline ? { outline: request.coreOutline } : {}) };

  for (const street of streets) {
    const path = measure(street);
    const range = coreRange(path, core);
    if (!range) continue;
    for (const side of [1, -1] as const) {
      const depth = lerp(request.depth, random());
      let start = range[0];
      let sliding = false;
      while (start < range[1]) {
        const frontage = lerp(request.frontage, random());
        const end = Math.min(start + frontage, range[1]);
        if (end - start < request.frontage[0] * 0.75) break;
        const slot = start;
        start = end;
        // The side's depth first; on a road or an earlier parcel behind it, the shallowest depth once more.
        const depths = request.depth[0] < depth ? [depth, request.depth[0]] : [depth];
        let placed: Fit | null = null;
        let reason: ParcelDropReason | null = null;
        for (const tryDepth of depths) {
          const fit = fitParcel(path, slot, end, side, tryDepth, core, request, shrunk);
          if (fit === null) {
            reason = null;
            break;
          }
          if ("reason" in fit) {
            reason = fit.reason;
            if (fit.reason === "road" || fit.reason === "overlap") continue;
            break;
          }
          placed = fit;
          if (tryDepth !== depth) shallow += 1;
          break;
        }
        if (!placed) {
          if (reason === "road" || reason === "overlap") {
            if (!sliding) dropped[reason] += 1;
            sliding = true;
            start = Math.min(end, slot + SLIDE_STEP);
          } else if (reason) {
            dropped[reason] += 1;
          }
          continue;
        }
        sliding = false;
        const { candidate, samples, heights, inset, box } = placed;
        shrunk.push({ polygon: inset, box });
        const slopeDeg = planeSlope(samples, heights);
        parcels.push({
          id: `${request.settlement}.p${parcels.length + 1}`,
          polygon: candidate.polygon.map(roundPoint),
          street: street.id,
          ...(street.edge === undefined ? {} : { edge: street.edge }),
          slopeDeg: Number(slopeDeg.toFixed(1)),
          steep: slopeDeg > request.maxSlopeDeg,
        });
      }
    }
  }
  return { parcels, dropped, shallow };
}

interface Fit {
  candidate: Candidate;
  samples: WorldPoint[];
  heights: number[];
  inset: WorldPoint[];
  box: Box;
}

/**
 * The parcel in one slot at one depth: null when its centre is outside the
 * core (not a drop), why it would be dropped, or the parcel and its samples.
 */
function fitParcel(
  path: MeasuredLine,
  start: number,
  end: number,
  side: 1 | -1,
  depth: number,
  core: CoreShape,
  request: ParcelRequest,
  shrunk: ReadonlyArray<{ polygon: WorldPoint[]; box: Box }>,
): Fit | { reason: ParcelDropReason } | null {
  const candidate = parcelPolygon(path, start, end, side, depth);
  if (!candidate) return { reason: "shape" };
  const centroid = polygonCentroid(candidate.polygon);
  if (!inCore(core, centroid)) return null;
  const samples = [...candidate.polygon, ...candidate.inner, centroid];
  const blocked = samples.map(request.blockedAt).find((value) => value !== null);
  if (blocked) return { reason: blocked };
  const heights = samples.map(([x, z]) => request.sampleHeight(x, z));
  if (heights.some((height) => height === null)) return { reason: "offTerrain" };
  const inset = insetPolygon(candidate.polygon, centroid, OVERLAP_INSET);
  const box = boxOf(inset);
  if (shrunk.some((other) => boxesTouch(box, other.box) && polygonsOverlap(inset, other.polygon))) return { reason: "overlap" };
  return { candidate, samples, heights: heights as number[], inset, box };
}

// ---------------------------------------------------------------- street geometry

interface MeasuredLine {
  points: WorldPoint[];
  halfWidths: number[];
  /** Arc length at each point. */
  at: number[];
}

function measure(line: StreetLine): MeasuredLine {
  const at = [0];
  for (let index = 1; index < line.points.length; index += 1) at.push(at[index - 1]! + distance(line.points[index - 1]!, line.points[index]!));
  return { points: line.points, halfWidths: line.halfWidths, at };
}

/** Point, unit tangent and half width at arc length `s`. */
function sample(path: MeasuredLine, s: number): { point: WorldPoint; tangent: WorldPoint; halfWidth: number } {
  let leg = 1;
  while (leg < path.points.length - 1 && path.at[leg]! < s) leg += 1;
  const a = path.points[leg - 1]!;
  const b = path.points[leg]!;
  const span = path.at[leg]! - path.at[leg - 1]!;
  const t = span === 0 ? 0 : Math.min(1, Math.max(0, (s - path.at[leg - 1]!) / span));
  const length = distance(a, b) || 1;
  return {
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    tangent: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
    halfWidth: path.halfWidths[leg - 1]! + (path.halfWidths[leg]! - path.halfWidths[leg - 1]!) * t,
  };
}

/** First and last arc length where the street is within the core; null when it never is. */
function coreRange(path: MeasuredLine, core: CoreShape): [number, number] | null {
  const total = path.at[path.at.length - 1]!;
  let first: number | null = null;
  let last: number | null = null;
  for (let s = 0; s <= total; s += CORE_STEP) {
    const { point } = sample(path, s);
    if (inCore(core, point)) {
      first ??= s;
      last = s;
    }
  }
  return first === null || last === null || last <= first ? null : [first, last];
}

interface Candidate {
  polygon: WorldPoint[];
  /** Points between the front and back edges, for sampling. */
  inner: WorldPoint[];
}

/** The parcel between arc lengths `start` and `end` on one side: front edge, then back edge reversed. */
function parcelPolygon(path: MeasuredLine, start: number, end: number, side: 1 | -1, depth: number): Candidate | null {
  const steps = Math.max(1, Math.ceil((end - start) / EDGE_STEP));
  const front: WorldPoint[] = [];
  const back: WorldPoint[] = [];
  const inner: WorldPoint[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const { point, tangent, halfWidth } = sample(path, start + ((end - start) * step) / steps);
    const normal: WorldPoint = [-tangent[1] * side, tangent[0] * side];
    const offset = (amount: number): WorldPoint => [point[0] + normal[0] * amount, point[1] + normal[1] * amount];
    front.push(offset(halfWidth + PARCEL_VERGE));
    back.push(offset(halfWidth + PARCEL_VERGE + depth));
    inner.push(offset(halfWidth + PARCEL_VERGE + depth / 2));
  }
  const polygon = [...front, ...back.reverse()];
  const area = Math.abs(signedArea(polygon));
  if (area < 0.5 * (end - start) * depth || !isSimple(polygon)) return null;
  return { polygon, inner };
}

// ---------------------------------------------------------------- polygons

type Box = [number, number, number, number];

function boxOf(polygon: readonly WorldPoint[]): Box {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return [minX, minZ, maxX, maxZ];
}

function boxesTouch(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Interiors intersect: an edge crossing, or one inside the other. */
export function polygonsOverlap(a: readonly WorldPoint[], b: readonly WorldPoint[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsCross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return insidePolygon(a[0]![0], a[0]![1], b) || insidePolygon(b[0]![0], b[0]![1], a);
}

function segmentsCross(p: WorldPoint, q: WorldPoint, r: WorldPoint, s: WorldPoint): boolean {
  const d1 = cross(r, s, p);
  const d2 = cross(r, s, q);
  const d3 = cross(p, q, r);
  const d4 = cross(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(a: WorldPoint, b: WorldPoint, c: WorldPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** No two non-adjacent edges cross. */
function isSimple(polygon: readonly WorldPoint[]): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(polygon[i]!, polygon[(i + 1) % n]!, polygon[j]!, polygon[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

function signedArea(polygon: readonly WorldPoint[]): number {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const [x0, z0] = polygon[index]!;
    const [x1, z1] = polygon[(index + 1) % polygon.length]!;
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

export function polygonCentroid(polygon: readonly WorldPoint[]): WorldPoint {
  const area = signedArea(polygon);
  if (Math.abs(area) < 1e-9) {
    const sum = polygon.reduce<WorldPoint>((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
    return [sum[0] / polygon.length, sum[1] / polygon.length];
  }
  let cx = 0;
  let cz = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const [x0, z0] = polygon[index]!;
    const [x1, z1] = polygon[(index + 1) % polygon.length]!;
    const f = x0 * z1 - x1 * z0;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  return [cx / (6 * area), cz / (6 * area)];
}

/**
 * A box for showing a parcel: aligned with its first front edge and covering
 * the polygon's extent along and across it.
 */
export function parcelBox(polygon: readonly WorldPoint[]): { center: WorldPoint; along: WorldPoint; length: number; width: number } {
  const center = polygonCentroid(polygon);
  const a = polygon[0]!;
  const b = polygon[1]!;
  const span = distance(a, b) || 1;
  const along: WorldPoint = [(b[0] - a[0]) / span, (b[1] - a[1]) / span];
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, z] of polygon) {
    const u = (x - center[0]) * along[0] + (z - center[1]) * along[1];
    const v = -(x - center[0]) * along[1] + (z - center[1]) * along[0];
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const u = (minU + maxU) / 2;
  const v = (minV + maxV) / 2;
  return {
    center: [center[0] + along[0] * u - along[1] * v, center[1] + along[1] * u + along[0] * v],
    along,
    length: maxU - minU,
    width: maxV - minV,
  };
}

/** Each vertex moved `amount` towards the centroid. */
function insetPolygon(polygon: readonly WorldPoint[], centroid: WorldPoint, amount: number): WorldPoint[] {
  return polygon.map(([x, z]) => {
    const length = Math.hypot(centroid[0] - x, centroid[1] - z) || 1;
    return [x + ((centroid[0] - x) / length) * amount, z + ((centroid[1] - z) / length) * amount];
  });
}

/** Least-squares plane slope through the samples, degrees. */
function planeSlope(points: readonly WorldPoint[], heights: readonly number[]): number {
  const n = points.length;
  let mx = 0;
  let mz = 0;
  let mh = 0;
  for (let index = 0; index < n; index += 1) {
    mx += points[index]![0];
    mz += points[index]![1];
    mh += heights[index]!;
  }
  mx /= n;
  mz /= n;
  mh /= n;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  let sxh = 0;
  let szh = 0;
  for (let index = 0; index < n; index += 1) {
    const x = points[index]![0] - mx;
    const z = points[index]![1] - mz;
    const h = heights[index]! - mh;
    sxx += x * x;
    szz += z * z;
    sxz += x * z;
    sxh += x * h;
    szh += z * h;
  }
  const det = sxx * szz - sxz * sxz;
  if (Math.abs(det) < 1e-9) return 0;
  const a = (sxh * szz - szh * sxz) / det;
  const b = (szh * sxx - sxh * sxz) / det;
  return Math.atan(Math.hypot(a, b)) * (180 / Math.PI);
}

// ---------------------------------------------------------------- helpers

/** Deterministic uniform [0, 1) stream (mulberry32). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp([low, high]: [number, number], t: number): number {
  return Number((low + (high - low) * t).toFixed(2));
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function roundPoint([x, z]: WorldPoint): WorldPoint {
  return [Number(x.toFixed(3)), Number(z.toFixed(3))];
}
