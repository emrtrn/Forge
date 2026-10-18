import type { Vec3 } from "./layout";

/**
 * Generic Spline component data contract (Faz 1 of
 * archived `FORGE_GENERIC_SPLINE_SYSTEM_RESEARCH_AND_PLAN.md` — see `docs/COMPLETED_WORK_INDEX.md`).
 *
 * Pure data + normalization only: no curve math (Faz 2), no scene/editor
 * integration (Faz 4+), and no Three.js imports. Point positions are stored in
 * actor-local space; the owning actor's transform is applied by later layers.
 */

export const SPLINE_COMPONENT_SCHEMA = 1;

/**
 * MVP point interpolation set. `curveAuto` derives tangents from neighbours
 * (Catmull-Rom style); `curveCustom` uses the serialized arrive/leave tangents.
 */
export type SplinePointType = "linear" | "curveAuto" | "curveCustom";

export const SPLINE_POINT_TYPES: readonly SplinePointType[] = [
  "linear",
  "curveAuto",
  "curveCustom",
];

export const SPLINE_DEFAULT_POINT_TYPE: SplinePointType = "curveAuto";
export const SPLINE_DEFAULT_UP: Vec3 = [0, 1, 0];
export const SPLINE_DEFAULT_REPARAM_STEPS = 8;
export const SPLINE_MIN_REPARAM_STEPS = 1;
export const SPLINE_MAX_REPARAM_STEPS = 64;
/** A closed loop needs at least this many points; fewer normalizes to open. */
export const SPLINE_CLOSED_MIN_POINTS = 3;

export interface ForgeSplinePoint {
  id: string;
  /** Actor-local position. */
  position: Vec3;
  pointType: SplinePointType;
  /** Serialized only for `curveCustom` authoring; kept as-is otherwise. */
  arriveTangent?: Vec3;
  leaveTangent?: Vec3;
  tangentsLinked?: boolean;
  /** Roll in degrees around the spline tangent at this point. */
  roll?: number;
  /** Lateral/vertical cross-section scale, interpolated along the segment. */
  scale?: [number, number];
  metadata?: Record<string, string | number | boolean>;
}

export interface ForgeSplineComponentData {
  schema: typeof SPLINE_COMPONENT_SCHEMA;
  closed: boolean;
  /** Unit-length up hint used to build orientation frames (Faz 3). */
  defaultUp: Vec3;
  /** Arc-length samples per segment; clamped to [1, 64]. */
  reparamStepsPerSegment: number;
  points: ForgeSplinePoint[];
}

/**
 * Normalizes untrusted spline component data (loaded layouts, older schemas,
 * hand-edited JSON) into the current contract. Never throws: invalid points are
 * dropped, invalid fields fall back to defaults, and duplicate or missing point
 * ids are reassigned. The input value is not mutated.
 */
export function normalizeSplineComponentData(value: unknown): ForgeSplineComponentData {
  const input = isRecord(value) ? value : {};
  const rawPoints = Array.isArray(input.points) ? input.points : [];

  const points: ForgeSplinePoint[] = [];
  const usedIds = new Set<string>();
  for (const rawPoint of rawPoints) {
    const point = normalizeSplinePoint(rawPoint, usedIds);
    if (!point) continue;
    usedIds.add(point.id);
    points.push(point);
  }

  return {
    schema: SPLINE_COMPONENT_SCHEMA,
    closed: input.closed === true && points.length >= SPLINE_CLOSED_MIN_POINTS,
    defaultUp: normalizeUp(input.defaultUp),
    reparamStepsPerSegment: clampReparamSteps(input.reparamStepsPerSegment),
    points,
  };
}

/** A minimal open two-point spline along local +X, used by Add Actor (Faz 4). */
export function createDefaultSplineComponentData(): ForgeSplineComponentData {
  return {
    schema: SPLINE_COMPONENT_SCHEMA,
    closed: false,
    defaultUp: [...SPLINE_DEFAULT_UP],
    reparamStepsPerSegment: SPLINE_DEFAULT_REPARAM_STEPS,
    points: [
      { id: "spline-point-1", position: [0, 0, 0], pointType: SPLINE_DEFAULT_POINT_TYPE },
      { id: "spline-point-2", position: [4, 0, 0], pointType: SPLINE_DEFAULT_POINT_TYPE },
    ],
  };
}

export function uniqueSplinePointId(points: readonly ForgeSplinePoint[]): string {
  return nextSplinePointId(new Set(points.map((point) => point.id)));
}

/** Segment count for a normalized point list (a closed loop adds the seam segment). */
export function splineSegmentCount(pointCount: number, closed: boolean): number {
  if (pointCount < 2) return 0;
  return closed && pointCount >= SPLINE_CLOSED_MIN_POINTS ? pointCount : pointCount - 1;
}

function normalizeSplinePoint(value: unknown, usedIds: ReadonlySet<string>): ForgeSplinePoint | null {
  if (!isRecord(value)) return null;
  const position = finiteVec3(value.position);
  if (!position) return null;

  const rawId = typeof value.id === "string" ? value.id.trim() : "";
  const id = rawId.length > 0 && !usedIds.has(rawId) ? rawId : nextSplinePointId(usedIds);

  const point: ForgeSplinePoint = {
    id,
    position,
    pointType: normalizePointType(value.pointType),
  };
  const arriveTangent = finiteVec3(value.arriveTangent);
  if (arriveTangent) point.arriveTangent = arriveTangent;
  const leaveTangent = finiteVec3(value.leaveTangent);
  if (leaveTangent) point.leaveTangent = leaveTangent;
  if (typeof value.tangentsLinked === "boolean") point.tangentsLinked = value.tangentsLinked;
  if (typeof value.roll === "number" && Number.isFinite(value.roll)) point.roll = value.roll;
  const scale = finiteVec2(value.scale);
  if (scale) point.scale = scale;
  const metadata = normalizeMetadata(value.metadata);
  if (metadata) point.metadata = metadata;
  return point;
}

function normalizePointType(value: unknown): SplinePointType {
  return SPLINE_POINT_TYPES.includes(value as SplinePointType)
    ? (value as SplinePointType)
    : SPLINE_DEFAULT_POINT_TYPE;
}

function normalizeUp(value: unknown): Vec3 {
  const up = finiteVec3(value);
  if (!up) return [...SPLINE_DEFAULT_UP];
  const length = Math.hypot(up[0], up[1], up[2]);
  if (length < 1e-6) return [...SPLINE_DEFAULT_UP];
  return [up[0] / length, up[1] / length, up[2] / length];
}

function clampReparamSteps(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SPLINE_DEFAULT_REPARAM_STEPS;
  const steps = Math.floor(value);
  if (steps < SPLINE_MIN_REPARAM_STEPS) return SPLINE_MIN_REPARAM_STEPS;
  if (steps > SPLINE_MAX_REPARAM_STEPS) return SPLINE_MAX_REPARAM_STEPS;
  return steps;
}

function normalizeMetadata(value: unknown): Record<string, string | number | boolean> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value).filter(
    ([, entry]) =>
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry)),
  );
  if (entries.length === 0) return null;
  return Object.fromEntries(entries) as Record<string, string | number | boolean>;
}

function nextSplinePointId(usedIds: ReadonlySet<string>): string {
  let index = 1;
  while (usedIds.has(`spline-point-${index}`)) index += 1;
  return `spline-point-${index}`;
}

function finiteVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  return [x, y, z];
}

function finiteVec2(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return [x, y];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
