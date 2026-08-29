import type { Vec3 } from "./layout";
import type { ForgeFoliageTypeDef, LayoutFoliageInstance } from "./foliage";

/**
 * Pure, three-agnostic Foliage paint core: sample budget, slope/height filters,
 * per-instance random rolls, radius-overlap rejection, and erase masking. The
 * three.js parts (surface raycasts, quaternion normal-alignment) live in the
 * render layer / SceneApp; everything here is deterministic and unit-tested so the
 * brush behaviour is verifiable without a renderer.
 */

/** One accepted surface point under the brush (world space). */
export interface FoliageSurfaceHit {
  position: Vec3;
  /** Unit surface normal (world space). */
  normal: Vec3;
}

export interface FoliageBrush {
  /** Brush centre in world space. */
  center: Vec3;
  /** Brush radius in world units. */
  radius: number;
  /** Paint density multiplier `0..1+` from the Brush Options panel. */
  density: number;
  /** Deterministic seed (Random Seed brush option). */
  seed: number;
}

/** Instances this many per square world unit at `density = 1` before type density. */
export const FOLIAGE_BASE_DENSITY = 1.5;

const DEG = 180 / Math.PI;
const EPSILON = 1e-4;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Deterministic 32-bit PRNG (mulberry32) seeded per brush dab. */
export function makeFoliageRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Surface slope in degrees (0 = flat/up-facing, 90 = vertical). */
export function surfaceSlopeDegrees(normal: Vec3): number {
  return Math.acos(clamp(normal[1], -1, 1)) * DEG;
}

/**
 * Number of candidate samples to try for one brush dab: brush disk area × base
 * density × type density × brush density. Rejection (slope/height/overlap) thins
 * this down to the placed count, so it is a budget, not a guarantee.
 */
export function foliageSampleTargetCount(type: ForgeFoliageTypeDef, brush: FoliageBrush): number {
  const area = Math.PI * brush.radius * brush.radius;
  const raw = area * FOLIAGE_BASE_DENSITY * type.density * brush.density;
  return Math.max(1, Math.round(raw));
}

/** Slope + world-height acceptance for a candidate hit. */
export function passesFoliageFilters(type: ForgeFoliageTypeDef, hit: FoliageSurfaceHit): boolean {
  const slope = surfaceSlopeDegrees(hit.normal);
  if (slope < type.slopeMin - EPSILON || slope > type.slopeMax + EPSILON) return false;
  const y = hit.position[1];
  if (type.heightMin !== undefined && y < type.heightMin - EPSILON) return false;
  if (type.heightMax !== undefined && y > type.heightMax + EPSILON) return false;
  return true;
}

/** True when `position` is within `radius` (horizontal) of any existing point. */
export function foliageOverlaps(
  position: Vec3,
  existing: readonly Vec3[],
  radius: number,
): boolean {
  const r2 = radius * radius;
  for (const point of existing) {
    const dx = point[0] - position[0];
    const dz = point[2] - position[2];
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

/** Randomized per-instance parameters; alignment/z-offset are applied by the render layer. */
export interface FoliageInstanceRoll {
  position: Vec3;
  normal: Vec3;
  /** Yaw about the instance up axis, degrees. */
  yawDeg: number;
  scale: Vec3;
  /** Offset along the instance up axis, world units. */
  zOffset: number;
  seed: number;
}

/** Rolls random scale / yaw / z-offset / seed for one accepted hit. */
export function rollFoliageInstance(
  type: ForgeFoliageTypeDef,
  hit: FoliageSurfaceHit,
  rng: () => number,
): FoliageInstanceRoll {
  const scaleRatio = lerp(type.scaleMin[0], type.scaleMax[0], rng());
  // Keep yaw/offset/seed rolls stable for existing deterministic brushes: scale
  // used to consume one PRNG draw per axis, but now its one ratio drives XYZ.
  rng();
  rng();
  const scale: Vec3 = [scaleRatio, scaleRatio, scaleRatio];
  const yawDeg = type.randomYaw ? rng() * 360 : 0;
  const zOffset = lerp(type.zOffsetMin, type.zOffsetMax, rng());
  const seed = Math.floor(rng() * 0xffffffff) >>> 0;
  return {
    position: [...hit.position],
    normal: [...hit.normal],
    yawDeg,
    scale,
    zOffset,
    seed,
  };
}

/** Axis-aligned world-XZ footprint of a Fill target (a landscape or a static mesh). */
export interface FoliageFillArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Grid-scatters candidate XZ points across a Fill target's footprint: one jittered
 * point per `spacing`-sized cell, thinned by `density` (`0..1` keep probability).
 * Deterministic for a given `rng` (one keep-roll per cell, then two jitter draws
 * when kept), so Fill is reproducible and unit-testable without a renderer. The
 * caller down-casts each point onto the real surface and applies slope/height/
 * overlap rejection — this only decides WHERE to try, matching the paint core's
 * split between sampling and acceptance.
 */
export function foliageFillSamplePoints(
  area: FoliageFillArea,
  spacing: number,
  density: number,
  rng: () => number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const width = area.maxX - area.minX;
  const depth = area.maxZ - area.minZ;
  if (spacing <= 0 || width <= 0 || depth <= 0) return points;
  const keep = clamp(density, 0, 1);
  const cols = Math.max(1, Math.ceil(width / spacing));
  const rows = Math.max(1, Math.ceil(depth / spacing));
  const cellW = width / cols;
  const cellD = depth / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (rng() > keep) continue;
      const x = area.minX + (c + rng()) * cellW;
      const z = area.minZ + (r + rng()) * cellD;
      points.push([x, z]);
    }
  }
  return points;
}

/**
 * Splits a group's instances by an erase brush: instances whose horizontal
 * distance to `center` is within `radius` are removed. Returns the survivors and
 * how many were removed (so the caller can skip a no-op save/rebuild).
 */
export function eraseFoliageInRadius(
  instances: readonly LayoutFoliageInstance[],
  center: Vec3,
  radius: number,
): { kept: LayoutFoliageInstance[]; removed: number } {
  const r2 = radius * radius;
  const kept: LayoutFoliageInstance[] = [];
  let removed = 0;
  for (const instance of instances) {
    const dx = instance.position[0] - center[0];
    const dz = instance.position[2] - center[2];
    if (dx * dx + dz * dz <= r2) {
      removed += 1;
    } else {
      kept.push(instance);
    }
  }
  return { kept, removed };
}
