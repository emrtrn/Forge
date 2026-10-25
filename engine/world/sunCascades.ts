import { computeFollowShadowFrame, type FollowShadowFrame, type FollowShadowVec3 } from "./followShadow";

/**
 * Cascaded sun shadow math (OPEN_WORLD_PLAN Faz 7c2). Pure: no three.js, no
 * renderer. Each cascade k covers the camera frustum from the eye to its split
 * distance, fitted with the slice's bounding sphere (constant size under camera
 * rotation, so the map does not swim) and texel-snapped through
 * {@link computeFollowShadowFrame}. Cascades are nested — each one contains every
 * nearer one — so the shader's edge blend always has a next cascade to fall to.
 */

/** Most cascades the shader patch unrolls (three's sampler array is indexed by constant). */
export const SUN_CASCADE_MAX = 4;
/** Shadow distance at `shadowDistanceScale` 1 (Ultra). */
export const SUN_CASCADE_BASE_DISTANCE = 200;
/** Near distance the split scheme starts from (metres). */
export const SUN_CASCADE_NEAR = 1;
/** Log/uniform split blend; 0.75 keeps the first cascade small and sharp (S7). */
export const SUN_CASCADE_SPLIT_LAMBDA = 0.75;
/** The distance fade runs from this fraction of the shadow distance to the distance itself. */
export const SUN_CASCADE_FADE_START = 0.85;
/** Extra reach toward the light so casters above the slice sphere still cast (metres). */
export const SUN_CASCADE_DEPTH_MARGIN = 100;

export interface SunCascadeSphere {
  /** Distance of the sphere centre along the camera's view direction. */
  readonly center: number;
  readonly radius: number;
}

export interface SunCascade {
  /** Far end of this cascade's frustum slice (metres from the eye). */
  readonly split: number;
  readonly sphere: SunCascadeSphere;
  readonly frame: FollowShadowFrame;
}

export interface SunCascadeInput {
  /** Direction the light travels (light → scene). */
  readonly lightDirection: FollowShadowVec3;
  readonly cameraPosition: FollowShadowVec3;
  /** Camera view direction; need not be unit length. */
  readonly cameraForward: FollowShadowVec3;
  /** Vertical field of view, degrees. */
  readonly fovDeg: number;
  readonly aspect: number;
  readonly count: number;
  /** Shadow distance: the last cascade's split. */
  readonly distance: number;
  readonly mapSize: number;
}

/** Shadow distance for a quality `shadowDistanceScale` (200 m on Ultra, 150 m on High…). */
export function sunCascadeDistance(shadowDistanceScale: number): number {
  return SUN_CASCADE_BASE_DISTANCE * Math.max(0, shadowDistanceScale);
}

/** Camera distances over which shadows fade out: `[0.85 D, D]`. */
export function sunShadowFadeRange(distance: number): [number, number] {
  return [distance * SUN_CASCADE_FADE_START, distance];
}

/**
 * Split distances, nearest first; the last is `distance`. A practical split:
 * `lambda` blends the logarithmic and the uniform scheme. Empty for a count
 * below 1, a non-positive near or a distance not past near.
 */
export function computeCascadeSplits(count: number, near: number, distance: number, lambda: number): number[] {
  if (![count, near, distance, lambda].every(Number.isFinite)) return [];
  const cascades = Math.floor(count);
  if (cascades < 1 || near <= 0 || distance <= near) return [];
  const blend = Math.min(1, Math.max(0, lambda));
  const splits: number[] = [];
  for (let index = 1; index <= cascades; index += 1) {
    const log = near * (distance / near) ** (index / cascades);
    const uniform = near + ((distance - near) * index) / cascades;
    splits.push(blend * log + (1 - blend) * uniform);
  }
  splits[cascades - 1] = distance;
  return splits;
}

/**
 * Smallest sphere around the frustum slice from the eye to `distance`: its
 * centre lies on the view axis, equidistant from the eye and the far corners
 * (clamped to the far plane for very wide frusta).
 */
export function cascadeSliceSphere(fovDeg: number, aspect: number, distance: number): SunCascadeSphere {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const k2 = tanV * tanV + tanH * tanH;
  const center = Math.min(distance, (distance * (1 + k2)) / 2);
  const radius = Math.hypot(distance - center, distance * Math.sqrt(k2));
  return { center, radius: Math.max(radius, center) };
}

/**
 * The cascades' shadow frames for one camera pose; empty for unusable input
 * (no direction, zero forward, non-finite values, count outside 1..4).
 */
export function computeSunCascades(input: SunCascadeInput): SunCascade[] {
  const { lightDirection, cameraPosition, cameraForward, fovDeg, aspect, count, distance, mapSize } = input;
  if (![...cameraPosition, ...cameraForward, fovDeg, aspect].every(Number.isFinite)) return [];
  if (count < 1 || count > SUN_CASCADE_MAX || fovDeg <= 0 || aspect <= 0) return [];
  const forwardLength = Math.hypot(...cameraForward);
  if (forwardLength === 0) return [];
  const forward = cameraForward.map((value) => value / forwardLength);
  const splits = computeCascadeSplits(count, SUN_CASCADE_NEAR, distance, SUN_CASCADE_SPLIT_LAMBDA);
  const cascades: SunCascade[] = [];
  for (const split of splits) {
    const sphere = cascadeSliceSphere(fovDeg, aspect, split);
    const frame = computeFollowShadowFrame({
      lightDirection,
      focus: [
        cameraPosition[0] + forward[0]! * sphere.center,
        cameraPosition[1] + forward[1]! * sphere.center,
        cameraPosition[2] + forward[2]! * sphere.center,
      ],
      halfExtent: sphere.radius,
      mapSize,
      depthAbove: sphere.radius + SUN_CASCADE_DEPTH_MARGIN,
      depthBelow: sphere.radius,
    });
    if (!frame) return [];
    cascades.push({ split, sphere, frame });
  }
  return cascades;
}

/**
 * Staggered refresh (Ultra): cascades 2 and up are redrawn every other frame,
 * alternating between them; nearer ones every frame. A skipped cascade keeps
 * both its map and its matrix from the frame it was drawn, so the two stay
 * consistent. `frame` counts from 0, and frame 0 draws every cascade (a map
 * must exist before it is sampled).
 */
export function sunCascadeNeedsUpdate(index: number, frame: number, stagger: boolean): boolean {
  if (!stagger || index < 2 || frame <= 0) return true;
  return (frame + index) % 2 === 0;
}
