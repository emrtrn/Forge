import type { LakeBedRecipe } from "./layout";
import { splineToPolyline, type ForgeLandscapeSpline } from "./landscape";

export type BedPoint = [number, number];
export function lakeBedPolyline(bed: LakeBedRecipe): BedPoint[] {
  const spline: ForgeLandscapeSpline = { id: "lake-bed", smooth: bed.smooth, smoothness: bed.smoothness,
    points: bed.points.map(([x, z], i) => ({ id: String(i), position: [x, 0, z], width: 1, falloff: 0 })),
    segments: bed.points.map((_, i) => ({ id: String(i), startPointId: String(i), endPointId: String((i + 1) % bed.points.length) })) };
  return splineToPolyline(spline).map((p) => [p.start.position[0], p.start.position[2]]);
}

const cross = (a: BedPoint, b: BedPoint, c: BedPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function on(a: BedPoint, b: BedPoint, c: BedPoint) {
  return Math.abs(cross(a, b, c)) <= 1e-9 && c[0] >= Math.min(a[0], b[0]) - 1e-9 && c[0] <= Math.max(a[0], b[0]) + 1e-9
    && c[1] >= Math.min(a[1], b[1]) - 1e-9 && c[1] <= Math.max(a[1], b[1]) + 1e-9;
}
function intersects(a: BedPoint, b: BedPoint, c: BedPoint, d: BedPoint) {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
export function validateLakeBed(value: unknown): LakeBedRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Lake bed recipe");
  const b = value as Record<string, unknown>;
  if (!Array.isArray(b.points) || b.points.length < 3 || b.points.length > 256) throw new Error("Lake bed needs 3–256 boundary points");
  const points: BedPoint[] = b.points.map((p: unknown) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error("Lake bed points require finite world XZ");
    return [p[0] as number, p[1] as number];
  });
  const number = (key: string, min: number, max: number) => {
    const v = b[key]; if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid Lake bed ${key}`); return v;
  };
  if (typeof b.smooth !== "boolean") throw new Error("Invalid Lake bed smooth flag");
  const out: LakeBedRecipe = { points, smooth: b.smooth, smoothness: number("smoothness", 0, 1),
    maxDepth: number("maxDepth", 1e-4, 1e6), shoreSlopeDegrees: number("shoreSlopeDegrees", 1, 80), transitionWidth: number("transitionWidth", 1e-4, 1e6) };
  if (b.shorePaint !== undefined) {
    const paint = b.shorePaint as Record<string, unknown>;
    if (!paint || typeof paint !== "object" || typeof paint.layerId !== "string" || !paint.layerId || paint.layerId.length > 256
      || typeof paint.strength !== "number" || !Number.isFinite(paint.strength) || paint.strength < 0 || paint.strength > 1) throw new Error("Invalid Lake shore paint");
    out.shorePaint = { layerId: paint.layerId, strength: paint.strength };
  }
  const poly = lakeBedPolyline(out), base = poly[0]!;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, next = poly[(i + 1) % poly.length]!;
    if (Math.hypot(a[0] - next[0], a[1] - next[1]) < 1e-7) throw new Error("Lake bed has duplicate boundary points");
    area += (a[0] - base[0]) * (next[1] - base[1]) - (next[0] - base[0]) * (a[1] - base[1]);
    for (let j = i + 1; j < poly.length; j++) {
      if (j === i + 1 || (i === 0 && j === poly.length - 1)) continue;
      if (intersects(a, next, poly[j]!, poly[(j + 1) % poly.length]!)) throw new Error("Lake bed boundary intersects itself");
    }
    // Adjacent collinear reversals overlap even though their shared endpoint is legal.
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    if (Math.abs(cross(prev, a, next)) <= 1e-9 && (prev[0] - a[0]) * (next[0] - a[0]) + (prev[1] - a[1]) * (next[1] - a[1]) > 0) throw new Error("Lake bed boundary overlaps itself");
  }
  if (Math.abs(area) < 1e-6) throw new Error("Lake bed boundary has zero area");
  return out;
}

/** Negative outside, positive inside; boundary = 0. Local differences preserve large origins. */
export function lakeBedDistance(poly: readonly BedPoint[], x: number, z: number): number {
  let inside = false, distance = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz));
    if ((a[1] > z) !== (b[1] > z) && x - a[0] < (z - a[1]) * dx / dz) inside = !inside;
  }
  return inside ? distance : -distance;
}
