import type { ForgeLandscapeSpline, ForgeLandscapeSplinePoint, ForgeLandscapeSplineSegment } from "./landscape";
import type { Vec3 } from "./layout";
import type { ForgeSplineComponentData } from "./spline";
import { evaluateSplineSegment } from "./splineCurve";

/**
 * Adapts one Landscape-owned directed segment to the renderer-independent
 * Generic Spline curve contract. It is intentionally a copy, never a linked
 * reference: terrain width/falloff, paint and deformation remain Landscape data.
 */
export function landscapeSplineSegmentComponent(
  spline: ForgeLandscapeSpline,
  segment: ForgeLandscapeSplineSegment,
  adjacency: LandscapeSplineAdjacency = buildLandscapeSplineAdjacency(spline),
): ForgeSplineComponentData | null {
  const points = adjacency.points;
  const start = points.get(segment.startPointId);
  const end = points.get(segment.endPointId);
  if (!start || !end) return null;
  const smooth = spline.smooth === true;
  const smoothness = Math.max(0, Math.min(1, spline.smoothness ?? 0.5));
  const beforeStart = neighbourPosition(adjacency, start.id, end.id) ?? reflect(start.position, end.position);
  const afterEnd = neighbourPosition(adjacency, end.id, start.id) ?? reflect(end.position, start.position);
  const startPoint = smooth
    ? { id: `${segment.id}:start`, position: clone(start.position), pointType: "curveCustom" as const, leaveTangent: scale(subtract(end.position, beforeStart), smoothness) }
    : { id: `${segment.id}:start`, position: clone(start.position), pointType: "linear" as const };
  const endPoint = smooth
    ? { id: `${segment.id}:end`, position: clone(end.position), pointType: "curveCustom" as const, arriveTangent: scale(subtract(afterEnd, start.position), smoothness) }
    : { id: `${segment.id}:end`, position: clone(end.position), pointType: "linear" as const };
  return { schema: 1, closed: false, defaultUp: [0, 1, 0], reparamStepsPerSegment: 8, points: [startPoint, endPoint] };
}

/** Samples a Landscape segment through Generic Spline Hermite evaluation. */
export function evaluateLandscapeSplineSegment(
  spline: ForgeLandscapeSpline,
  segment: ForgeLandscapeSplineSegment,
  t: number,
  adjacency?: LandscapeSplineAdjacency,
): Vec3 | null {
  const component = landscapeSplineSegmentComponent(spline, segment, adjacency);
  return component ? evaluateSplineSegment(component, 0, t).position : null;
}

/**
 * A sampler for one segment, with its curve context resolved once.
 *
 * Curve context is per-spline, not per-sample: resolving it inside the sampler
 * meant every point of every subdivision rebuilt the whole point map and rescanned
 * every segment for neighbours, so sampling a spline cost O(segments²). Real road
 * networks reach thousands of segments, where that alone was seconds per repaint.
 */
export function landscapeSplineSegmentSampler(
  spline: ForgeLandscapeSpline,
  segment: ForgeLandscapeSplineSegment,
  adjacency?: LandscapeSplineAdjacency,
): ((t: number) => Vec3) | null {
  const component = landscapeSplineSegmentComponent(spline, segment, adjacency);
  if (!component) return null;
  return (t: number) => evaluateSplineSegment(component, 0, t).position;
}

/**
 * The per-spline lookups a segment's curve context needs: its points by id, and
 * for each point the other endpoint of every segment touching it, in authored
 * segment order (which is what decides the neighbour a tangent picks).
 */
export interface LandscapeSplineAdjacency {
  readonly points: ReadonlyMap<string, ForgeLandscapeSplinePoint>;
  readonly neighbours: ReadonlyMap<string, readonly string[]>;
}

export function buildLandscapeSplineAdjacency(spline: ForgeLandscapeSpline): LandscapeSplineAdjacency {
  const points = new Map(spline.points.map((point) => [point.id, point] as const));
  const neighbours = new Map<string, string[]>();
  const push = (pointId: string, otherId: string): void => {
    const list = neighbours.get(pointId);
    if (list) list.push(otherId);
    else neighbours.set(pointId, [otherId]);
  };
  for (const segment of spline.segments) {
    // Mirrors the original single-pass rule: a segment contributes at most one
    // neighbour per point, and `start` wins when a segment loops onto itself.
    push(segment.startPointId, segment.endPointId);
    if (segment.endPointId !== segment.startPointId) push(segment.endPointId, segment.startPointId);
  }
  return { points, neighbours };
}

function neighbourPosition(
  adjacency: LandscapeSplineAdjacency,
  pointId: string,
  excludeId: string,
): Vec3 | null {
  const neighbour = adjacency.neighbours.get(pointId)
    ?.find((id) => id !== excludeId && adjacency.points.has(id));
  return neighbour ? adjacency.points.get(neighbour)?.position ?? null : null;
}

function clone(value: Vec3): Vec3 { return [...value]; }
function subtract(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(value: Vec3, amount: number): Vec3 { return [value[0] * amount, value[1] * amount, value[2] * amount]; }
function reflect(pivot: Vec3, other: Vec3): Vec3 { return [pivot[0] * 2 - other[0], pivot[1] * 2 - other[1], pivot[2] * 2 - other[2]]; }
