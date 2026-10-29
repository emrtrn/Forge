/**
 * Lot boundary fences, L7 (World Builder plan v0.4 §13.5 "L7 Donatı": "uygun
 * rollerde parsel sınırı çiti"; F1 step 13b).
 *
 * A role with a `fence` spec gets one round its lot (the host parcel and the
 * parcels merged into it), centred on the boundary:
 *
 * - the street front too unless `front: false`, open `gap` metres wide where
 *   the building's entrance meets it;
 * - never on a road, a building, street furniture, water or protected
 *   ground: the boundary is sampled every `STEP` and blocked samples stay open;
 * - a boundary an earlier lot already fenced (neighbours share side edges)
 *   is not fenced twice;
 * - free runs become straight pieces of at most `MAX_PIECE`, shorter where
 *   the ground changes, each standing on the ground at its ends.
 *
 * Fences follow the ground, so they belong after Apply Pads (the pads change
 * the ground at the lot boundary). Pure and deterministic. Dependency-free.
 */
import { insidePolygon, sourceDistance, type DistanceSource } from "./field";
import type { WorldPoint } from "./normalize";
import { DEFAULT_FENCE_GAP, DEFAULT_FENCE_THICKNESS, type FenceSpec } from "./regionProfile";

/** Boundary sample spacing, metres. */
const STEP = 0.25;
/** Longest fence piece, metres. */
export const MAX_PIECE = 4;
/** Pieces split until the ground changes less than this along one, metres (down to `MIN_SPLIT`). */
const MAX_RISE = 0.25;
const MIN_SPLIT = 1;
/** Free runs shorter than this stay open, metres. */
const MIN_PIECE = 0.5;
/** Clear ground beside a road's edge, a building or furniture, metres. */
const CLEARANCE = 0.2;
/** A fence piece reaches this far below the lower ground at its ends, metres. */
export const FENCE_SINK = 0.2;

export interface FenceRequest {
  /** The lot outline: street front first, then the back edge in reverse (`mergedPolygon`). */
  outline: readonly WorldPoint[];
  spec: FenceSpec;
  /** Where the entrance meets the front; absent puts the gap at the front's middle. */
  entrance?: WorldPoint;
  roads: readonly DistanceSource[];
  /** Footprints of buildings and street furniture. */
  obstacles: ReadonlyArray<readonly WorldPoint[]>;
  /** Pieces laid on earlier lots; this lot's are appended when it is done. */
  laid: FencePiece[];
  blockedAt: (point: WorldPoint) => boolean;
  sampleHeight: (x: number, z: number) => number | null;
}

export interface FencePiece {
  a: WorldPoint;
  b: WorldPoint;
  /** Ground at each end. */
  heights: [number, number];
}

export interface FenceResult {
  pieces: FencePiece[];
  /** Boundary length fenced, metres. */
  length: number;
  /** Boundary length left open by an obstacle (not the entrance gap or a shared edge), metres. */
  open: number;
}

export function planFence(request: FenceRequest): FenceResult {
  const { outline, spec } = request;
  const half = outline.length / 2;
  const thickness = spec.thickness ?? DEFAULT_FENCE_THICKNESS;
  const gap = spec.gap ?? DEFAULT_FENCE_GAP;
  const front = outline.slice(0, half);
  const frontLength = polylineLength(front);
  const entranceAt = request.entrance ? project(front, request.entrance) : frontLength / 2;
  const earlier = [...request.laid];
  const shared = (point: WorldPoint) => earlier.some((piece) => segmentDistance(point, piece.a, piece.b) <= thickness);
  const blocked = (point: WorldPoint) =>
    request.roads.some((road) => sourceDistance(point, road) < CLEARANCE + thickness / 2) ||
    request.obstacles.some((outlineOf) => insidePolygon(point[0], point[1], outlineOf) || polygonDistance(point, outlineOf) < CLEARANCE + thickness / 2) ||
    request.blockedAt(point) ||
    request.sampleHeight(point[0], point[1]) === null;

  const pieces: FencePiece[] = [];
  let length = 0;
  let open = 0;
  let frontS = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index]!;
    const b = outline[(index + 1) % outline.length]!;
    const span = distance(a, b);
    const onFront = index < half - 1;
    if (onFront && spec.front === false) {
      frontS += span;
      continue;
    }
    const count = Math.max(1, Math.round(span / STEP));
    const free: boolean[] = [];
    for (let k = 0; k < count; k += 1) {
      const t = (k + 0.5) / count;
      const point = lerp(a, b, t);
      if (onFront && Math.abs(frontS + span * t - entranceAt) < gap / 2) free.push(false);
      else if (shared(point)) free.push(false);
      else if (blocked(point)) {
        free.push(false);
        open += span / count;
      } else free.push(true);
    }
    if (onFront) frontS += span;
    let start = -1;
    for (let k = 0; k <= count; k += 1) {
      if (k < count && free[k]) {
        if (start < 0) start = k;
        continue;
      }
      if (start < 0) continue;
      const from = lerp(a, b, start / count);
      const to = lerp(a, b, k / count);
      start = -1;
      if (distance(from, to) < MIN_PIECE) continue;
      for (const piece of split(from, to, request.sampleHeight)) {
        pieces.push(piece);
        length += distance(piece.a, piece.b);
      }
    }
  }
  request.laid.push(...pieces);
  return { pieces, length: round(length, 1), open: round(open, 1) };
}

/** Straight pieces of at most `MAX_PIECE`, halved while the ground rises more than `MAX_RISE` along one. */
function split(from: WorldPoint, to: WorldPoint, sampleHeight: FenceRequest["sampleHeight"]): FencePiece[] {
  const total = distance(from, to);
  const count = Math.max(1, Math.ceil(total / MAX_PIECE));
  const pieces: FencePiece[] = [];
  const lay = (a: WorldPoint, b: WorldPoint): void => {
    const ha = sampleHeight(a[0], a[1]) ?? 0;
    const hb = sampleHeight(b[0], b[1]) ?? 0;
    if (Math.abs(hb - ha) > MAX_RISE && distance(a, b) / 2 >= MIN_SPLIT) {
      const middle = lerp(a, b, 0.5);
      lay(a, middle);
      lay(middle, b);
      return;
    }
    pieces.push({ a, b, heights: [ha, hb] });
  };
  for (let index = 0; index < count; index += 1) lay(lerp(from, to, index / count), lerp(from, to, (index + 1) / count));
  return pieces;
}

/** Arc length of the polyline's point nearest `point`. */
function project(points: readonly WorldPoint[], point: WorldPoint): number {
  let best = { s: 0, gap: Infinity };
  let s = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const span = distance(a, b);
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / (span * span)));
    const gap = distance(point, lerp(a, b, t));
    if (gap < best.gap) best = { s: s + span * t, gap };
    s += span;
  }
  return best.s;
}

function polygonDistance(point: WorldPoint, polygon: readonly WorldPoint[]): number {
  let best = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    best = Math.min(best, segmentDistance(point, polygon[index]!, polygon[(index + 1) % polygon.length]!));
  }
  return best;
}

function segmentDistance(point: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq));
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t));
}

function polylineLength(points: readonly WorldPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1]!, points[index]!);
  return length;
}

function lerp(a: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
