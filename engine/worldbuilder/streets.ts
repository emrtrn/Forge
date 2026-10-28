/**
 * Inner streets, L3 "inside the settlement" (World Builder plan v0.4 §13.5).
 *
 * The roads through a core give it its main street; this grows the local
 * streets that let the parcel stage reach the rest of the core. Two patterns
 * for village scale, mixed by the region profile's `streetPattern` weights:
 *
 * - **organic**: a branch leaves a street at right angles (± a seeded skew) and
 *   wanders a little at every step, turning away from slopes it may not climb;
 * - **contourFollow**: on sloped ground the branch follows the contour, so the
 *   street stays nearly level and the street it leaves is the link up and down
 *   the slope. On flat ground there is no contour and it grows as organic.
 *
 * Branches start on the edge of an existing street (roads, then streets grown
 * here, so streets branch from streets) at points `spacing` apart, nearest the
 * centre first, and grow in `STEP` legs to a length drawn from the profile's
 * block size. A branch stops at the core's edge, at water or a protected area,
 * at a slope it cannot take, or where it would run alongside another street
 * closer than `spacing` (room for a parcel depth on both). Meeting another
 * street it ends on that street's edge (a T junction, as roads do). Growth
 * stops once the core's streets offer the frontage the program needs.
 *
 * Seeded and deterministic. Pure; dependency-free.
 */
import type { StreetLine } from "./masks";
import type { WorldPoint } from "./normalize";
import { mulberry32 } from "./parcels";

export const INNER_STREET_PATTERNS = ["organic", "contourFollow"] as const;
export type InnerStreetPattern = (typeof INNER_STREET_PATTERNS)[number];

/** Leg length of a growing street, metres. */
export const STREET_STEP = 8;
/** Mean slope below which a core counts as flat and contour streets grow as organic, degrees. */
export const CONTOUR_MIN_SLOPE_DEG = 3;
/** Largest skew of a branch from the right angle, degrees. */
const BRANCH_SKEW = 20;
/** Largest turn per leg of an organic street, degrees. */
const WANDER = 8;
/** Turns an organic street tries, in order, when a leg is too steep, degrees. */
const SLOPE_TURNS = [15, -15, 30, -30];
/** Another street within `spacing` at less than this angle runs alongside: stop, degrees. */
const PARALLEL_ANGLE = 35;
/** A street is too close alongside another within this share of `spacing`. */
const ALONGSIDE_SHARE = 0.8;
/** Finite-difference step for the ground gradient, metres. */
const GRADIENT_STEP = 2;

export interface InnerStreetRequest {
  /** Prefix of the street ids: `<prefix>-1`, `<prefix>-2`, … */
  idPrefix: string;
  center: WorldPoint;
  coreRadius: number;
  /** Streets already there; branches start on them and must keep clear of them. */
  streets: readonly StreetLine[];
  width: number;
  maxSlopeDeg: number;
  /** Distance kept between streets running alongside each other, metres. */
  spacing: number;
  /** Length range of one street (the profile's block size), metres. */
  length: [number, number];
  weights: Record<InnerStreetPattern, number>;
  /** Street frontage (both sides) the core should offer, metres. */
  targetFrontage: number;
  seed: number;
  sampleHeight: (x: number, z: number) => number | null;
  /** True where a street may not go (water, protected areas). */
  blockedAt: (point: WorldPoint) => boolean;
}

export interface PlannedStreet {
  id: string;
  pattern: InnerStreetPattern;
  points: WorldPoint[];
  /** Ends on another street's edge. */
  joined: boolean;
}

export interface InnerStreetResult {
  streets: PlannedStreet[];
  /** Street frontage inside the core before and after, metres (both sides). */
  frontage: { before: number; after: number };
  /** Mean slope of the core, degrees. */
  coreSlopeDeg: number;
  /** The core was too flat for contour streets; they grew as organic. */
  flat: boolean;
}

interface Line {
  points: WorldPoint[];
  halfWidths: number[];
}

interface Branch {
  line: number;
  start: WorldPoint;
  /** Unit heading away from the street. */
  heading: WorldPoint;
  rank: number;
}

export function growInnerStreets(request: InnerStreetRequest): InnerStreetResult {
  const random = mulberry32(request.seed);
  const halfWidth = request.width / 2;
  const lines: Line[] = request.streets.map((street) => ({ points: street.points, halfWidths: street.halfWidths }));
  const before = lines.reduce((sum, line) => sum + 2 * insideLength(line.points, request.center, request.coreRadius), 0);
  let frontage = before;
  const coreSlopeDeg = meanSlope(request);
  const flat = coreSlopeDeg < CONTOUR_MIN_SLOPE_DEG;
  const totalWeight = request.weights.organic + request.weights.contourFollow;

  const pool: Branch[] = [];
  const addBranches = (index: number): void => {
    pool.push(...branchesOf(index, lines[index]!, request, random));
  };
  lines.forEach((_, index) => addBranches(index));

  const streets: PlannedStreet[] = [];
  while (frontage < request.targetFrontage && pool.length > 0 && totalWeight > 0) {
    pool.sort((a, b) => a.rank - b.rank);
    const branch = pool.shift()!;
    const wanted = random() * totalWeight < request.weights.organic ? "organic" : "contourFollow";
    const pattern: InnerStreetPattern = flat ? "organic" : wanted;
    // Shorter than a spacing, a street hardly reaches past the parcels of the street it leaves.
    const shortest = Math.max(request.length[0], request.spacing);
    const length = shortest + (Math.max(request.length[1], shortest) - shortest) * random();
    const grown = grow(branch, pattern, length, lines, halfWidth, request, random);
    if (!grown || polylineLength(grown.points) < shortest * 0.75) continue;
    const street: PlannedStreet = {
      id: `${request.idPrefix}-${streets.length + 1}`,
      pattern,
      points: grown.points.map(roundPoint),
      joined: grown.joined,
    };
    streets.push(street);
    lines.push({ points: street.points, halfWidths: street.points.map(() => halfWidth) });
    // Its first half spacing lies in the parcels of the street it leaves, and so does its last when it joins one.
    const overlap = (street.joined ? 1 : 0.5) * request.spacing;
    frontage += 2 * Math.max(0, insideLength(street.points, request.center, request.coreRadius) - overlap);
    addBranches(lines.length - 1);
  }
  return { streets, frontage: { before: round1(before), after: round1(frontage) }, coreSlopeDeg: round1(coreSlopeDeg), flat };
}

// ---------------------------------------------------------------- growing

/**
 * Branch points `spacing` apart along the part of a street inside the core,
 * both sides, the first a spacing from its start: a street grown here starts on
 * another, and a branch nearer that one would run alongside it.
 */
function branchesOf(index: number, line: Line, request: InnerStreetRequest, random: () => number): Branch[] {
  const branches: Branch[] = [];
  const total = polylineLength(line.points);
  for (let s = request.spacing; s < total; s += request.spacing) {
    const { point, tangent, halfWidth } = sampleLine(line, s);
    if (distance(point, request.center) > request.coreRadius) continue;
    for (const side of [1, -1] as const) {
      const normal: WorldPoint = [-tangent[1] * side, tangent[0] * side];
      branches.push({
        line: index,
        start: [point[0] + normal[0] * halfWidth, point[1] + normal[1] * halfWidth],
        heading: normal,
        // Nearest the centre first; the jitter only reorders near-equal ones.
        rank: distance(point, request.center) / request.coreRadius + random() * 0.25,
      });
    }
  }
  return branches;
}

function grow(
  branch: Branch,
  pattern: InnerStreetPattern,
  length: number,
  lines: readonly Line[],
  halfWidth: number,
  request: InnerStreetRequest,
  random: () => number,
): { points: WorldPoint[]; joined: boolean } | null {
  const maxGrade = Math.tan((request.maxSlopeDeg * Math.PI) / 180);
  let heading = rotate(branch.heading, ((random() * 2 - 1) * BRANCH_SKEW * Math.PI) / 180);
  if (pattern === "contourFollow") {
    const contour = contourAt(branch.start, branch.heading, request.sampleHeight);
    // A contour along the parent street would run beside it: no branch here.
    if (!contour || dot(contour, branch.heading) < Math.cos((60 * Math.PI) / 180)) return null;
    heading = contour;
  }
  const points: WorldPoint[] = [branch.start];
  let travelled = 0;
  while (travelled < length) {
    const from = points[points.length - 1]!;
    if (pattern === "organic") heading = rotate(heading, ((random() * 2 - 1) * WANDER * Math.PI) / 180);
    else heading = contourAt(from, heading, request.sampleHeight) ?? heading;

    const turns = pattern === "organic" ? [0, ...SLOPE_TURNS] : [0];
    let next: WorldPoint | null = null;
    for (const turn of turns) {
      const direction = rotate(heading, (turn * Math.PI) / 180);
      const candidate: WorldPoint = [from[0] + direction[0] * STREET_STEP, from[1] + direction[1] * STREET_STEP];
      const a = request.sampleHeight(from[0], from[1]);
      const b = request.sampleHeight(candidate[0], candidate[1]);
      if (a === null || b === null) break;
      if (Math.abs(b - a) / STREET_STEP <= maxGrade) {
        next = candidate;
        heading = direction;
        break;
      }
    }
    if (!next) break;
    if (distance(next, request.center) > request.coreRadius || request.blockedAt(next)) break;

    let stop = false;
    for (let index = 0; index < lines.length; index += 1) {
      // The street it leaves is behind it until it is a spacing away.
      if (index === branch.line && travelled < request.spacing) continue;
      const near = nearestOnLine(lines[index]!, next);
      const gap = near.distance - near.halfWidth - halfWidth;
      if (gap <= 0) {
        // Meets it: end on its edge, a T junction.
        const away: WorldPoint = unit([from[0] - near.point[0], from[1] - near.point[1]]);
        points.push([near.point[0] + away[0] * near.halfWidth, near.point[1] + away[1] * near.halfWidth]);
        return { points, joined: true };
      }
      const alongside = Math.abs(dot(heading, near.tangent)) > Math.cos((PARALLEL_ANGLE * Math.PI) / 180);
      if (alongside && near.distance < request.spacing * ALONGSIDE_SHARE) stop = true;
    }
    if (stop) break;
    points.push(next);
    travelled += STREET_STEP;
  }
  return points.length >= 2 ? { points, joined: false } : null;
}

/** Unit contour direction (across the gradient) at a point, on the side of `heading`; null on flat ground. */
function contourAt(point: WorldPoint, heading: WorldPoint, sampleHeight: InnerStreetRequest["sampleHeight"]): WorldPoint | null {
  const gradient = gradientAt(point, sampleHeight);
  if (!gradient || Math.hypot(gradient[0], gradient[1]) < 1e-4) return null;
  const contour = unit([-gradient[1], gradient[0]]);
  return dot(contour, heading) >= 0 ? contour : [-contour[0], -contour[1]];
}

function gradientAt([x, z]: WorldPoint, sampleHeight: InnerStreetRequest["sampleHeight"]): WorldPoint | null {
  const east = sampleHeight(x + GRADIENT_STEP, z);
  const west = sampleHeight(x - GRADIENT_STEP, z);
  const north = sampleHeight(x, z + GRADIENT_STEP);
  const south = sampleHeight(x, z - GRADIENT_STEP);
  if (east === null || west === null || north === null || south === null) return null;
  return [(east - west) / (2 * GRADIENT_STEP), (north - south) / (2 * GRADIENT_STEP)];
}

/** Mean ground slope over a grid of the core, degrees. */
function meanSlope(request: InnerStreetRequest): number {
  let sum = 0;
  let count = 0;
  for (let i = -2; i <= 2; i += 1) {
    for (let j = -2; j <= 2; j += 1) {
      const point: WorldPoint = [request.center[0] + (i * request.coreRadius) / 3, request.center[1] + (j * request.coreRadius) / 3];
      if (distance(point, request.center) > request.coreRadius) continue;
      const gradient = gradientAt(point, request.sampleHeight);
      if (!gradient) continue;
      sum += (Math.atan(Math.hypot(gradient[0], gradient[1])) * 180) / Math.PI;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

// ---------------------------------------------------------------- lines

function sampleLine(line: Line, s: number): { point: WorldPoint; tangent: WorldPoint; halfWidth: number } {
  let remaining = s;
  for (let index = 1; index < line.points.length; index += 1) {
    const a = line.points[index - 1]!;
    const b = line.points[index]!;
    const span = distance(a, b);
    if (remaining <= span || index === line.points.length - 1) {
      const t = span === 0 ? 0 : Math.min(1, remaining / span);
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        tangent: unit([b[0] - a[0], b[1] - a[1]]),
        halfWidth: line.halfWidths[index - 1]! + (line.halfWidths[index]! - line.halfWidths[index - 1]!) * t,
      };
    }
    remaining -= span;
  }
  return { point: line.points[0]!, tangent: [1, 0], halfWidth: line.halfWidths[0] ?? 0 };
}

function nearestOnLine(line: Line, point: WorldPoint): { point: WorldPoint; tangent: WorldPoint; halfWidth: number; distance: number } {
  let best = { point: line.points[0]!, tangent: [1, 0] as WorldPoint, halfWidth: line.halfWidths[0] ?? 0, distance: Infinity };
  for (let index = 1; index < line.points.length; index += 1) {
    const a = line.points[index - 1]!;
    const b = line.points[index]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const span = dx * dx + dz * dz;
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / span));
    const at: WorldPoint = [a[0] + dx * t, a[1] + dz * t];
    const gap = distance(at, point);
    if (gap < best.distance) {
      best = {
        point: at,
        tangent: unit([dx, dz]),
        halfWidth: line.halfWidths[index - 1]! + (line.halfWidths[index]! - line.halfWidths[index - 1]!) * t,
        distance: gap,
      };
    }
  }
  return best;
}

/** Length of a polyline inside the circle, sampled every metre. */
function insideLength(points: readonly WorldPoint[], center: WorldPoint, radius: number): number {
  let inside = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const span = distance(a, b);
    const steps = Math.max(1, Math.ceil(span));
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps;
      if (distance([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], center) <= radius) inside += span / steps;
    }
  }
  return inside;
}

function polylineLength(points: readonly WorldPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1]!, points[index]!);
  return length;
}

function rotate([x, z]: WorldPoint, angle: number): WorldPoint {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - z * sin, x * sin + z * cos];
}

function unit([x, z]: WorldPoint): WorldPoint {
  const length = Math.hypot(x, z) || 1;
  return [x / length, z / length];
}

function dot(a: WorldPoint, b: WorldPoint): number {
  return a[0] * b[0] + a[1] * b[1];
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function roundPoint([x, z]: WorldPoint): WorldPoint {
  return [Number(x.toFixed(3)), Number(z.toFixed(3))];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
