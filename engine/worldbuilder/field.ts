/**
 * Spatial query and mask kit (World Builder plan v0.4 T04, §5.4, §13.5).
 *
 * A field is a regular XZ grid of numbers sampled at cell centres: terrain
 * height, slope, curvature, distance to roads or water. A mask is a field whose
 * values lie in 0..1 (1 = "yes": allowed, excluded, preferred — the caller
 * names it). Generators build fields once and read them many times: site
 * scores, route cost maps, scatter exclusion.
 *
 * `NaN` means "no data" (off terrain). Field operations carry it through;
 * `bandMask` turns it into 0, so a mask never says yes where nothing is known.
 *
 * Everything here is pure and deterministic, works on plain `Float32Array`s and
 * holds no closures in its data, so the same calls can move into a worker later
 * and hand their buffers back as transferables. Dependency-free; no three.js.
 */
import type { WorldPoint } from "./normalize";

/** Largest grid a field may have (2048²); a bigger request is a caller bug. */
export const MAX_FIELD_CELLS = 2048 * 2048;

/**
 * Cell `(i, j)` covers `origin + [i, j] * cellSize` to one cell further and is
 * sampled at its centre; it is `values[j * width + i]`. `i` runs along +X,
 * `j` along +Z.
 */
export interface GridSpec {
  readonly origin: WorldPoint;
  readonly cellSize: number;
  readonly width: number;
  readonly depth: number;
}

export interface Field extends GridSpec {
  readonly values: Float32Array;
}

/** The smallest grid of `cellSize` cells that covers the XZ box. */
export function gridSpecForBounds(bounds: { min: WorldPoint; max: WorldPoint }, cellSize: number): GridSpec {
  if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new Error(`field cell size must be positive, got ${cellSize}`);
  const spanX = bounds.max[0] - bounds.min[0];
  const spanZ = bounds.max[1] - bounds.min[1];
  if (!(spanX > 0) || !(spanZ > 0)) throw new Error("field bounds must have a positive extent");
  const width = Math.max(1, Math.ceil(spanX / cellSize - 1e-9));
  const depth = Math.max(1, Math.ceil(spanZ / cellSize - 1e-9));
  if (width * depth > MAX_FIELD_CELLS) {
    throw new Error(`field of ${width}×${depth} cells exceeds ${MAX_FIELD_CELLS}; use a larger cell size`);
  }
  return { origin: [bounds.min[0], bounds.min[1]], cellSize, width, depth };
}

export function createField(spec: GridSpec, fill = 0): Field {
  return { ...gridOf(spec), values: new Float32Array(spec.width * spec.depth).fill(fill) };
}

export function cellCenter(spec: GridSpec, i: number, j: number): WorldPoint {
  return [spec.origin[0] + (i + 0.5) * spec.cellSize, spec.origin[1] + (j + 0.5) * spec.cellSize];
}

/**
 * Bilinear value between cell centres; the outer half cell holds the edge
 * value. `NaN` outside the grid, or when a contributing cell has no data.
 */
export function fieldAt(field: Field, x: number, z: number): number {
  const { origin, cellSize, width, depth, values } = field;
  const u = (x - origin[0]) / cellSize;
  const v = (z - origin[1]) / cellSize;
  if (!(u >= 0 && u <= width && v >= 0 && v <= depth)) return Number.NaN;
  const fx = Math.min(Math.max(u - 0.5, 0), width - 1);
  const fz = Math.min(Math.max(v - 0.5, 0), depth - 1);
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const i1 = Math.min(i0 + 1, width - 1);
  const j1 = Math.min(j0 + 1, depth - 1);
  const tx = fx - i0;
  const tz = fz - j0;
  const a = values[j0 * width + i0]!;
  const b = values[j0 * width + i1]!;
  const c = values[j1 * width + i0]!;
  const d = values[j1 * width + i1]!;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// ---------------------------------------------------------------- terrain

/** Terrain height at each cell centre; `NaN` where there is no terrain. */
export function heightField(spec: GridSpec, sampleHeight: (x: number, z: number) => number | null): Field {
  const field = createField(spec, Number.NaN);
  for (let j = 0; j < spec.depth; j += 1) {
    for (let i = 0; i < spec.width; i += 1) {
      const [x, z] = cellCenter(spec, i, j);
      const height = sampleHeight(x, z);
      if (height !== null && Number.isFinite(height)) field.values[j * spec.width + i] = height;
    }
  }
  return field;
}

/**
 * Slope in degrees from a height field: central differences, one-sided at the
 * grid edge or next to a no-data cell, flat along an axis with no neighbour.
 */
export function slopeField(heights: Field): Field {
  const { width, depth, cellSize, values } = heights;
  const out = createField(heights, Number.NaN);
  for (let j = 0; j < depth; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const centre = values[j * width + i]!;
      if (Number.isNaN(centre)) continue;
      const gx = gradient(heights, i, j, 1, 0, centre, cellSize);
      const gz = gradient(heights, i, j, 0, 1, centre, cellSize);
      out.values[j * width + i] = Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI);
    }
  }
  return out;
}

/**
 * Laplacian of the height field, 1/m: positive in hollows and valleys,
 * negative on ridges and crests, 0 on a plane. A missing neighbour mirrors the
 * cell itself (zero flux), so grid edges read as continuing flat.
 */
export function curvatureField(heights: Field): Field {
  const { width, depth, cellSize, values } = heights;
  const out = createField(heights, Number.NaN);
  const at = (i: number, j: number, fallback: number): number => {
    if (i < 0 || j < 0 || i >= width || j >= depth) return fallback;
    const value = values[j * width + i]!;
    return Number.isNaN(value) ? fallback : value;
  };
  for (let j = 0; j < depth; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const h = values[j * width + i]!;
      if (Number.isNaN(h)) continue;
      const sum = at(i - 1, j, h) + at(i + 1, j, h) + at(i, j - 1, h) + at(i, j + 1, h);
      out.values[j * width + i] = (sum - 4 * h) / (cellSize * cellSize);
    }
  }
  return out;
}

function gradient(field: Field, i: number, j: number, di: number, dj: number, centre: number, cellSize: number): number {
  const before = valueAt(field, i - di, j - dj);
  const after = valueAt(field, i + di, j + dj);
  if (!Number.isNaN(before) && !Number.isNaN(after)) return (after - before) / (2 * cellSize);
  if (!Number.isNaN(after)) return (after - centre) / cellSize;
  if (!Number.isNaN(before)) return (centre - before) / cellSize;
  return 0;
}

function valueAt(field: Field, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= field.width || j >= field.depth) return Number.NaN;
  return field.values[j * field.width + i]!;
}

// ---------------------------------------------------------------- shapes

/**
 * A shape distances are measured to. A polyline is a chain of capsules whose
 * radius runs linearly between the per-point `radii` (default 0); a point is a
 * disc; a polygon is its filled outline.
 */
export type DistanceSource =
  | { kind: "polyline"; points: readonly WorldPoint[]; radii?: readonly number[] }
  | { kind: "point"; position: WorldPoint; radius?: number }
  | { kind: "polygon"; polygon: readonly WorldPoint[] };

/**
 * Distance from each cell centre to the nearest source surface, metres; 0 on
 * or inside a source, capped at `maxDistance` (also where there is no source).
 * Exact per cell: each source piece stamps only the cells within
 * `maxDistance` of it, so cost grows with source length × `maxDistance`², not
 * with the grid size.
 */
export function distanceField(spec: GridSpec, sources: readonly DistanceSource[], maxDistance: number): Field {
  if (!(maxDistance > 0) || !Number.isFinite(maxDistance)) throw new Error(`maxDistance must be positive, got ${maxDistance}`);
  const field = createField(spec, maxDistance);
  for (const source of sources) {
    if (source.kind === "point") {
      stampSegment(field, source.position, source.position, source.radius ?? 0, source.radius ?? 0, maxDistance);
    } else if (source.kind === "polyline") {
      const { points, radii } = source;
      if (points.length === 1) stampSegment(field, points[0]!, points[0]!, radii?.[0] ?? 0, radii?.[0] ?? 0, maxDistance);
      for (let index = 1; index < points.length; index += 1) {
        stampSegment(field, points[index - 1]!, points[index]!, radii?.[index - 1] ?? 0, radii?.[index] ?? 0, maxDistance);
      }
    } else {
      const { polygon } = source;
      for (let index = 0; index < polygon.length; index += 1) {
        stampSegment(field, polygon[index]!, polygon[(index + 1) % polygon.length]!, 0, 0, maxDistance);
      }
      fillPolygon(field, polygon, 0);
    }
  }
  return field;
}

/** Exact distance from one point to a source's surface, as `distanceField` measures it (uncapped). */
export function sourceDistance([x, z]: WorldPoint, source: DistanceSource): number {
  if (source.kind === "point") return Math.max(0, Math.hypot(x - source.position[0], z - source.position[1]) - (source.radius ?? 0));
  if (source.kind === "polygon") {
    if (insidePolygon(x, z, source.polygon)) return 0;
    let best = Infinity;
    const { polygon } = source;
    for (let index = 0; index < polygon.length; index += 1) {
      best = Math.min(best, capsuleDistance(x, z, polygon[index]!, polygon[(index + 1) % polygon.length]!, 0, 0));
    }
    return best;
  }
  const { points, radii } = source;
  if (points.length === 1) return capsuleDistance(x, z, points[0]!, points[0]!, radii?.[0] ?? 0, radii?.[0] ?? 0);
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(best, capsuleDistance(x, z, points[index - 1]!, points[index]!, radii?.[index - 1] ?? 0, radii?.[index] ?? 0));
  }
  return best;
}

/** Even-odd point-in-polygon. */
export function insidePolygon(x: number, z: number, polygon: readonly WorldPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x0, z0] = polygon[index]!;
    const [x1, z1] = polygon[previous]!;
    if ((z0 <= z) !== (z1 <= z) && x < x0 + ((z - z0) / (z1 - z0)) * (x1 - x0)) inside = !inside;
  }
  return inside;
}

function capsuleDistance(x: number, z: number, a: WorldPoint, b: WorldPoint, ra: number, rb: number): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq));
  return Math.max(0, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) - (ra + (rb - ra) * t));
}

/** 1 for cells whose centre lies inside any polygon (even-odd), else 0. */
export function polygonMask(spec: GridSpec, polygons: ReadonlyArray<readonly WorldPoint[]>): Field {
  const field = createField(spec, 0);
  for (const polygon of polygons) fillPolygon(field, polygon, 1);
  return field;
}

/** 1 for cells whose centre lies inside any XZ box (edges included), else 0. */
export function boxMask(spec: GridSpec, boxes: ReadonlyArray<{ min: WorldPoint; max: WorldPoint }>): Field {
  const field = createField(spec, 0);
  for (const { min, max } of boxes) {
    const [i0, i1] = cellRange(spec.origin[0], spec.cellSize, spec.width, min[0], max[0]);
    const [j0, j1] = cellRange(spec.origin[1], spec.cellSize, spec.depth, min[1], max[1]);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const [x, z] = cellCenter(spec, i, j);
        if (x >= min[0] && x <= max[0] && z >= min[1] && z <= max[1]) field.values[j * spec.width + i] = 1;
      }
    }
  }
  return field;
}

/** Lowers each cell within `maxDistance` of the tapered capsule a→b to its distance. */
function stampSegment(field: Field, a: WorldPoint, b: WorldPoint, ra: number, rb: number, maxDistance: number): void {
  const reach = Math.max(ra, rb) + maxDistance;
  const [i0, i1] = cellRange(field.origin[0], field.cellSize, field.width, Math.min(a[0], b[0]) - reach, Math.max(a[0], b[0]) + reach);
  const [j0, j1] = cellRange(field.origin[1], field.cellSize, field.depth, Math.min(a[1], b[1]) - reach, Math.max(a[1], b[1]) + reach);
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const [x, z] = cellCenter(field, i, j);
      const distance = capsuleDistance(x, z, a, b, ra, rb);
      const index = j * field.width + i;
      if (distance < field.values[index]!) field.values[index] = distance;
    }
  }
}

/** Sets every cell whose centre is inside the polygon (even-odd scanline). */
function fillPolygon(field: Field, polygon: readonly WorldPoint[], value: number): void {
  if (polygon.length < 3) return;
  const crossings: number[] = [];
  for (let j = 0; j < field.depth; j += 1) {
    const z = field.origin[1] + (j + 0.5) * field.cellSize;
    crossings.length = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const [x0, z0] = polygon[index]!;
      const [x1, z1] = polygon[(index + 1) % polygon.length]!;
      if ((z0 <= z) !== (z1 <= z)) crossings.push(x0 + ((z - z0) / (z1 - z0)) * (x1 - x0));
    }
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      // Centres strictly between the crossings: cell i's centre is origin + (i + 0.5) * cellSize.
      const first = Math.max(0, Math.ceil((crossings[k]! - field.origin[0]) / field.cellSize - 0.5));
      const last = Math.min(field.width - 1, Math.floor((crossings[k + 1]! - field.origin[0]) / field.cellSize - 0.5));
      for (let i = first; i <= last; i += 1) field.values[j * field.width + i] = value;
    }
  }
}

/** Cell indices whose cells overlap [lo, hi] along one axis, clamped to the grid. */
function cellRange(origin: number, cellSize: number, count: number, lo: number, hi: number): [number, number] {
  return [
    Math.max(0, Math.floor((lo - origin) / cellSize)),
    Math.min(count - 1, Math.floor((hi - origin) / cellSize)),
  ];
}

// ---------------------------------------------------------------- masks

export interface Band {
  /** Inclusive lower bound; absent = unbounded. */
  min?: number;
  /** Inclusive upper bound; absent = unbounded. */
  max?: number;
  /** Linear fade to 0 over this distance outside the band; 0 = hard edge. */
  falloff?: number;
}

/** 1 inside the band, fading to 0 over `falloff` outside it; no data → 0. */
export function bandMask(field: Field, band: Band): Field {
  const falloff = band.falloff ?? 0;
  if (!(falloff >= 0)) throw new Error(`band falloff must be ≥ 0, got ${falloff}`);
  const lo = band.min ?? Number.NEGATIVE_INFINITY;
  const hi = band.max ?? Number.POSITIVE_INFINITY;
  return mapField(field, (value) => {
    if (Number.isNaN(value)) return 0;
    const outside = value < lo ? lo - value : value > hi ? value - hi : 0;
    if (outside === 0) return 1;
    return falloff === 0 ? 0 : Math.max(0, 1 - outside / falloff);
  });
}

export function mapField(field: Field, map: (value: number, index: number) => number): Field {
  const out = createField(field);
  for (let index = 0; index < field.values.length; index += 1) out.values[index] = map(field.values[index]!, index);
  return out;
}

export function invertMask(mask: Field): Field {
  return mapField(mask, (value) => 1 - value);
}

/** Cell-wise minimum: "all of". */
export function maskAnd(...masks: Field[]): Field {
  return combine(masks, Math.min);
}

/** Cell-wise maximum: "any of". */
export function maskOr(...masks: Field[]): Field {
  return combine(masks, Math.max);
}

/** Cell-wise product: soft "all of" that keeps partial weights. */
export function maskMultiply(...masks: Field[]): Field {
  return combine(masks, (a, b) => a * b);
}

/** Share of cells at or above `threshold`, 0..1. */
export function maskCoverage(mask: Field, threshold = 0.5): number {
  let count = 0;
  for (const value of mask.values) if (value >= threshold) count += 1;
  return count / mask.values.length;
}

export function sameGrid(a: GridSpec, b: GridSpec): boolean {
  return a.origin[0] === b.origin[0] && a.origin[1] === b.origin[1]
    && a.cellSize === b.cellSize && a.width === b.width && a.depth === b.depth;
}

function combine(masks: Field[], op: (a: number, b: number) => number): Field {
  const [first, ...rest] = masks;
  if (!first) throw new Error("mask combination needs at least one mask");
  for (const mask of rest) if (!sameGrid(first, mask)) throw new Error("masks must share one grid");
  return mapField(first, (value, index) => rest.reduce((acc, mask) => op(acc, mask.values[index]!), value));
}

function gridOf(spec: GridSpec): GridSpec {
  return { origin: [spec.origin[0], spec.origin[1]], cellSize: spec.cellSize, width: spec.width, depth: spec.depth };
}
