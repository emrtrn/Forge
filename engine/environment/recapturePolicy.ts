import type { Vec3 } from "../scene/layout";
import { lerp, smoothstep } from "./sunPath";

/**
 * When the World Environment re-captures the Sky Light (IBL) (WES v0.3 §6.4).
 * A capture renders the sky into a PMREM, so it never runs per frame. It is
 * driven by **how far the sun moved**, never by how much time passed: a fast
 * clock then simply captures more often instead of leaving the scene lit by a
 * stale sky for a fixed interval and popping. The step is finest near the
 * horizon, where the sky's color changes most per degree, and coarsest high in
 * the sky. A weather/season change captures at once; scrubbing the editor clock
 * never does (one capture on release). Between captures the brightness gap is
 * bridged per frame by {@link skyLightCompensation}.
 */
export const RECAPTURE_HORIZON_ANGLE_DEG = 0.5;
export const RECAPTURE_HIGH_SUN_ANGLE_DEG = 3;
/** Sun elevations (degrees, absolute) over which the step widens from horizon to high sun. */
const RECAPTURE_STEP_BLEND: readonly [number, number] = [2, 20];

export interface CaptureRecord {
  sunDirection: Vec3;
  sunElevationDeg: number;
  captureKey: string;
}

export interface CaptureRequest {
  sunDirection: Vec3;
  sunElevationDeg: number;
  captureKey: string;
  /** The editor clock slider is being dragged. */
  scrubbing?: boolean;
}

/** How far the sun may move before the sky is captured again, at this elevation. */
export function recaptureAngleDeg(sunElevationDeg: number): number {
  const t = smoothstep(RECAPTURE_STEP_BLEND[0], RECAPTURE_STEP_BLEND[1], Math.abs(sunElevationDeg));
  return lerp(RECAPTURE_HORIZON_ANGLE_DEG, RECAPTURE_HIGH_SUN_ANGLE_DEG, t);
}

export function shouldRecapture(last: CaptureRecord | null, request: CaptureRequest): boolean {
  if (request.scrubbing) return false;
  if (!last) return true;
  if (request.captureKey !== last.captureKey) return true;
  // The finer of the two ends' steps, so leaving the horizon is not undersampled.
  const lowest = Math.min(Math.abs(last.sunElevationDeg), Math.abs(request.sunElevationDeg));
  return angleBetweenDeg(last.sunDirection, request.sunDirection) >= recaptureAngleDeg(lowest);
}

/**
 * Relative brightness of the captured sky light for a sun elevation: a dim
 * night floor rising through twilight to full daylight. Only its ratio
 * matters — see {@link skyLightCompensation}.
 */
export function skyLightLevel(sunElevationDeg: number): number {
  return lerp(0.04, 1, smoothstep(-8, 25, sunElevationDeg));
}

/**
 * Multiplier of the Sky Light intensity that carries a capture taken at
 * `capturedElevationDeg` to the brightness of the sun's current elevation, so
 * the scene brightens and darkens smoothly between captures and the next
 * capture only corrects the sky's color.
 */
export function skyLightCompensation(capturedElevationDeg: number, currentElevationDeg: number): number {
  const ratio = skyLightLevel(currentElevationDeg) / skyLightLevel(capturedElevationDeg);
  return Math.min(5, Math.max(0.2, ratio));
}

export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const la = Math.hypot(a[0], a[1], a[2]) || 1;
  const lb = Math.hypot(b[0], b[1], b[2]) || 1;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}
