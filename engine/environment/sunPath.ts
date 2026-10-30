import type { LayoutWorldEnvironment, Vec3 } from "../scene/layout";
import { HOURS_PER_DAY, wrapHour } from "./worldClock";
import {
  normalizeWorldEnvironment,
  WORLD_ENVIRONMENT_DEFAULTS,
  wrapDegrees,
  type ResolvedWorldEnvironment,
} from "./worldEnvironment";

/**
 * Art-directed sun path (WES v0.3 §6.2): no latitude or date, only a sunrise,
 * a sunset, a noon elevation and the compass direction of the noon sun.
 *
 * Directions are **ground → body** unit vectors in world space (y up), the
 * convention of `sunDirectionFromLightRotation`. Azimuth 0 points at +Z and
 * grows toward +X.
 *
 * At night the same directional light becomes the moon: it sits opposite the
 * sun's path at a fixed low elevation. Sun and moon each fade to zero at the
 * horizon, so the light switches body at the one moment it is dark and the
 * shadows never jump (§6.2 twilight, §6.5).
 */

/** Below this elevation the directional light is held, so a low sun never shadows from under the ground (§6.5). */
export const MIN_LIGHT_ELEVATION_DEG = 4;
/** The moon's fixed elevation. */
export const MOON_ELEVATION_DEG = 30;
/** Twilight band: the sun fades in over 0..6°, the moon over 0..-6° (§6.2). */
export const TWILIGHT_DEG = 6;

type SunPath = ResolvedWorldEnvironment["sunPath"];

/** Hour → sun position along the path: elevation is signed (negative below the horizon). */
export function sunAngles(hour: number, path: SunPath): { elevationDeg: number; azimuthDeg: number } {
  const day = path.sunsetHour - path.sunriseHour;
  const night = HOURS_PER_DAY - day;
  // Unwrap the hour into one continuous cycle centred on the day, so the
  // elevation goes negative smoothly after sunset and before sunrise.
  let h = wrapHour(hour);
  const start = path.sunriseHour - night / 2;
  while (h < start) h += HOURS_PER_DAY;
  while (h >= start + HOURS_PER_DAY) h -= HOURS_PER_DAY;
  const t = (h - path.sunriseHour) / day;
  if (t >= 0 && t <= 1) {
    return {
      elevationDeg: path.noonElevationDeg * Math.sin(Math.PI * t),
      azimuthDeg: wrapDegrees(path.azimuthDeg - 90 + 180 * t),
    };
  }
  // Night: the same arc mirrored below the horizon and timed by the night's own
  // length, so the deepest point is local midnight and nothing jumps there.
  const nightT = t > 1 ? ((t - 1) * day) / night : 1 + (t * day) / night;
  return {
    elevationDeg: -path.noonElevationDeg * Math.sin(Math.PI * nightT),
    azimuthDeg: wrapDegrees(path.azimuthDeg + 90 + 180 * nightT),
  };
}

/** Ground → body unit vector for a compass azimuth (0 = +Z, toward +X) and elevation. */
export function directionFromAngles(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const c = Math.cos(el);
  return [c * Math.sin(az), Math.sin(el), c * Math.cos(az)];
}

/** Inverse of {@link directionFromAngles}; the vector need not be normalized. */
export function anglesFromDirection(direction: Vec3): { azimuthDeg: number; elevationDeg: number } {
  const [x, y, z] = direction;
  const length = Math.hypot(x, y, z) || 1;
  const elevationDeg = (Math.asin(Math.max(-1, Math.min(1, y / length))) * 180) / Math.PI;
  const azimuthDeg = wrapDegrees((Math.atan2(x, z) * 180) / Math.PI);
  return { azimuthDeg, elevationDeg };
}

/**
 * Ground → sun direction of a directional light's Euler XYZ rotation (degrees):
 * the light shines along its local -Z, so the sun is the negated forward. A
 * three-free twin of `sunDirectionFromLightRotation`.
 */
export function sunDirectionFromRotation(rotationDeg: Vec3): Vec3 {
  const a = (rotationDeg[0] * Math.PI) / 180;
  const b = (rotationDeg[1] * Math.PI) / 180;
  // Rz leaves (0,0,-1) alone; Ry then Rx rotate it (three's XYZ order).
  const forward: Vec3 = [-Math.sin(b), Math.cos(b) * Math.sin(a), -Math.cos(b) * Math.cos(a)];
  return [-forward[0], -forward[1], -forward[2]];
}

export interface SunLightState {
  /** True sun direction (ground → sun), signed; the sky dome uses it, so it darkens at night. */
  sunDirection: Vec3;
  sunElevationDeg: number;
  /** Ground → light direction of the one directional light (sun by day, moon by night). */
  lightDirection: Vec3;
  /** Whether the directional light is currently the moon. */
  isMoon: boolean;
  /** Multiplier of the authored sun intensity (the moon's own intensity at night). */
  intensityFactor: number;
  /** Linear RGB multiplier of the authored sun color by day; the moon color at night. */
  color: Vec3;
  /** 0 at night, 1 in full day; drives ambient, fog and exposure. */
  daylight: number;
  /** 0..1 strength of the warm horizon tint (sunrise/sunset). */
  twilightWarmth: number;
}

/** Sun color by elevation (degrees → linear RGB multiplier); identity from 30° up. */
const SUN_COLOR_CURVE: Array<[number, Vec3]> = [
  [0, [1, 0.45, 0.2]],
  [4, [1, 0.62, 0.36]],
  [12, [1, 0.84, 0.66]],
  [30, [1, 1, 1]],
];

/**
 * Hour + path → the directional light, sky sun and daylight factors. Pure and
 * deterministic; the identity case is the authored sun: from 35° elevation up
 * the intensity and color multipliers are exactly 1.
 */
export function evaluateSunLight(hour: number, env: ResolvedWorldEnvironment): SunLightState {
  const { elevationDeg, azimuthDeg } = sunAngles(hour, env.sunPath);
  const sunDirection = directionFromAngles(azimuthDeg, elevationDeg);
  const isMoon = elevationDeg < 0;
  const daylight = smoothstep(-TWILIGHT_DEG, 10, elevationDeg);
  const twilightWarmth = smoothstep(-4, 2, elevationDeg) * (1 - smoothstep(6, 18, elevationDeg));
  if (!isMoon) {
    return {
      sunDirection,
      sunElevationDeg: elevationDeg,
      lightDirection: directionFromAngles(azimuthDeg, Math.max(MIN_LIGHT_ELEVATION_DEG, elevationDeg)),
      isMoon,
      intensityFactor: smoothstep(0, TWILIGHT_DEG, elevationDeg) * lerp(0.45, 1, smoothstep(TWILIGHT_DEG, 35, elevationDeg)),
      color: sampleCurve(SUN_COLOR_CURVE, elevationDeg),
      daylight,
      twilightWarmth,
    };
  }
  return {
    sunDirection,
    sunElevationDeg: elevationDeg,
    lightDirection: directionFromAngles(azimuthDeg + 180, MOON_ELEVATION_DEG),
    isMoon,
    intensityFactor: env.night.moonIntensity * smoothstep(0, TWILIGHT_DEG, -elevationDeg),
    color: hexToLinear(env.night.moonColor),
    daylight,
    twilightWarmth,
  };
}

/**
 * Inverse derivation (WES v0.3 §5.1, ENV-00b): the hour and sun path that put
 * the sun where the authored Sun light already points, so adding a World
 * Environment does not make the view jump. Sunrise/sunset come from `base`;
 * the noon elevation is the default unless the authored sun is higher. A sun
 * at or below the horizon is lifted to 1° (the path has no night to match it).
 */
export function deriveSunPathFromDirection(
  direction: Vec3,
  base: SunPath,
): { hour: number; sunPath: SunPath } {
  const { azimuthDeg, elevationDeg: raw } = anglesFromDirection(direction);
  const elevation = Math.max(1, raw);
  const noon = Math.min(90, Math.max(base.noonElevationDeg, elevation, 5));
  const t = Math.asin(Math.min(1, elevation / noon)) / Math.PI;
  const hour = base.sunriseHour + t * (base.sunsetHour - base.sunriseHour);
  return {
    hour,
    sunPath: { ...base, noonElevationDeg: noon, azimuthDeg: wrapDegrees(azimuthDeg + 90 - 180 * t) },
  };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sampleCurve(curve: Array<[number, Vec3]>, x: number): Vec3 {
  const first = curve[0]!;
  if (x <= first[0]) return [...first[1]];
  for (let i = 1; i < curve.length; i += 1) {
    const [x1, c1] = curve[i]!;
    if (x <= x1) {
      const [x0, c0] = curve[i - 1]!;
      const t = (x - x0) / (x1 - x0);
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
    }
  }
  return [...curve[curve.length - 1]![1]];
}

/** `#rrggbb` → linear RGB (0..1), matching three's sRGB color management. */
export function hexToLinear(hex: string): Vec3 {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (byte: number): number => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel((value >> 16) & 255), channel((value >> 8) & 255), channel(value & 255)];
}

/**
 * The World Environment a newly added actor starts with: the hour and sun path
 * that reproduce the authored Sun light's direction (ENV-00b), rounded like the
 * save. With no Sun (or no rotation) it is the empty default actor.
 */
export function initialWorldEnvironmentForSun(sunRotationDeg: Vec3 | null): LayoutWorldEnvironment {
  if (!sunRotationDeg) return {};
  const derived = deriveSunPathFromDirection(sunDirectionFromRotation(sunRotationDeg), WORLD_ENVIRONMENT_DEFAULTS.sunPath);
  return normalizeWorldEnvironment({
    time: { hour: derived.hour },
    sunPath: { azimuthDeg: derived.sunPath.azimuthDeg, noonElevationDeg: derived.sunPath.noonElevationDeg },
  }).environment ?? {};
}
