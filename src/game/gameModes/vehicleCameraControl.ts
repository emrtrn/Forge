/**
 * Pure helpers for the `forge.vehicle` Game Mode: action → pedal mapping and
 * the chase camera's framing math. No Three.js scene access, so they are
 * unit-testable on their own.
 */
import type { VehicleInput } from "@engine/physics/vehicle/vehicleTypes";

export type PlanarHeading = { readonly x: number; readonly z: number };
export type Point3 = { readonly x: number; readonly y: number; readonly z: number };

export interface VehicleChaseCameraSettings {
  /** Horizontal distance behind the vehicle. */
  readonly distance: number;
  /** Camera height above the vehicle origin. */
  readonly height: number;
  /** Look-at height above the vehicle origin. */
  readonly lookHeight: number;
  /** How fast the camera swings round behind a turning car (1/s). */
  readonly headingFollowRate: number;
  /** How fast the camera position catches up (1/s). */
  readonly positionFollowRate: number;
  /** Extra field of view at `fovSpeedForMax` m/s and above (degrees). */
  readonly fovBoostDeg: number;
  readonly fovSpeedForMax: number;
}

export const DEFAULT_VEHICLE_CHASE_CAMERA: VehicleChaseCameraSettings = {
  distance: 7,
  height: 2.6,
  lookHeight: 1,
  headingFollowRate: 4,
  positionFollowRate: 10,
  fovBoostDeg: 10,
  fovSpeedForMax: 35,
};

export interface HeldActions {
  held(action: string): boolean;
}

/**
 * Keyboard driving on the engine's default action vocabulary: forward/back are
 * the pedals, left/right steer, `jump` (Space) is the handbrake.
 */
export function vehicleInputFromActions(actions: HeldActions): VehicleInput {
  const right = (actions.held("move-right") ? 1 : 0) - (actions.held("move-left") ? 1 : 0);
  return {
    throttle: actions.held("move-forward") ? 1 : 0,
    brake: actions.held("move-back") ? 1 : 0,
    steer: right,
    handbrake: actions.held("jump"),
  };
}

/**
 * The vehicle's forward (+Z local) flattened onto the ground plane, or null
 * when the car points (nearly) straight up/down and has no usable heading.
 */
export function planarHeadingFromQuaternion(q: {
  x: number;
  y: number;
  z: number;
  w: number;
}): PlanarHeading | null {
  const x = 2 * (q.x * q.z + q.w * q.y);
  const z = 1 - 2 * (q.x * q.x + q.y * q.y);
  const length = Math.hypot(x, z);
  if (length < 1e-3) return null;
  return { x: x / length, z: z / length };
}

/** Frame-rate independent blend factor for an exponential follow at `rate` 1/s. */
export function followAlpha(rate: number, deltaSeconds: number): number {
  if (!(deltaSeconds > 0) || !(rate > 0)) return 0;
  return 1 - Math.exp(-rate * deltaSeconds);
}

/** Eases one heading toward another and renormalises (never collapses to zero). */
export function blendHeading(from: PlanarHeading, to: PlanarHeading, alpha: number): PlanarHeading {
  const x = from.x + (to.x - from.x) * alpha;
  const z = from.z + (to.z - from.z) * alpha;
  const length = Math.hypot(x, z);
  // A full 180° swing passes through zero; snap to the target instead.
  if (length < 1e-4) return to;
  return { x: x / length, z: z / length };
}

/** Where the chase camera wants to sit for a vehicle at `target` facing `heading`. */
export function chaseCameraPosition(
  target: Point3,
  heading: PlanarHeading,
  settings: VehicleChaseCameraSettings,
): Point3 {
  return {
    x: target.x - heading.x * settings.distance,
    y: target.y + settings.height,
    z: target.z - heading.z * settings.distance,
  };
}

/** Yaw (degrees about +Y) that turns +Z onto `heading` — for upright resets. */
export function yawDegreesFromHeading(heading: PlanarHeading): number {
  return (Math.atan2(heading.x, heading.z) * 180) / Math.PI;
}

/** Field of view widened with speed, for a sense of pace. */
export function speedFieldOfView(
  baseFovDeg: number,
  speed: number,
  settings: VehicleChaseCameraSettings,
): number {
  const t = Math.min(1, Math.max(0, Math.abs(speed) / settings.fovSpeedForMax));
  return baseFovDeg + settings.fovBoostDeg * t;
}
