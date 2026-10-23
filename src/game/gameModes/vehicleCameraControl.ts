/**
 * Pure helpers for the `forge.vehicle` Game Mode: action → pedal mapping and
 * the chase camera's framing math — the orbit a player looks around with, the
 * swing back behind the car, and the spring-arm pull-in at walls. No Three.js
 * scene access, so they are unit-testable on their own.
 */
import type { VehicleInput } from "@engine/physics/vehicle/vehicleTypes";
import type { LookAngles } from "./cameraControl";

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
  /** Lowest / highest the look-around orbit may put the camera, in degrees of elevation. */
  readonly minElevationDeg: number;
  readonly maxElevationDeg: number;
  /** Seconds without look input before the camera swings back behind the car. */
  readonly lookRecenterDelay: number;
  /** How fast it swings back (1/s). */
  readonly lookRecenterRate: number;
  /** Below this speed (m/s) a parked car keeps the view the player chose. */
  readonly lookRecenterMinSpeed: number;
  /** Gap kept between the camera and the wall that pulled it in (m). */
  readonly collisionPadding: number;
  /** How fast the arm grows back once the obstruction clears (1/s). */
  readonly collisionRecoverRate: number;
}

export const DEFAULT_VEHICLE_CHASE_CAMERA: VehicleChaseCameraSettings = {
  distance: 7,
  height: 2.6,
  lookHeight: 1,
  headingFollowRate: 4,
  positionFollowRate: 10,
  fovBoostDeg: 10,
  fovSpeedForMax: 35,
  minElevationDeg: -5,
  maxElevationDeg: 60,
  lookRecenterDelay: 1.5,
  lookRecenterRate: 2.5,
  lookRecenterMinSpeed: 1,
  collisionPadding: 0.3,
  collisionRecoverRate: 4,
};

/** The look-around orbit at rest: straight behind the car, at the authored height. */
export const CENTERED_CHASE_ORBIT: LookAngles = Object.freeze({ yaw: 0, pitch: 0 });

export interface HeldActions {
  held(action: string): boolean;
  /** Analog axis value, 0 when idle; absent = a keyboard-only source. */
  axis?(axis: string): number;
}

/**
 * Driving on the engine's default action vocabulary: forward/back are the
 * pedals, left/right steer, `jump` (Space) is the handbrake. A deflected stick
 * (`move-x`/`move-y`) replaces the keys' all-or-nothing values and steers the
 * wheels directly; the triggers (`trigger-right`/`trigger-left`) are analog
 * throttle and brake pedals on top of them.
 */
export function vehicleInputFromActions(actions: HeldActions): VehicleInput {
  const stickX = actions.axis?.("move-x") ?? 0;
  const stickY = actions.axis?.("move-y") ?? 0;
  // The stick's own thresholded move codes also hold move-*: its position wins.
  const keySteer = (actions.held("move-right") ? 1 : 0) - (actions.held("move-left") ? 1 : 0);
  const forward = stickY !== 0 ? Math.max(0, -stickY) : actions.held("move-forward") ? 1 : 0;
  const back = stickY !== 0 ? Math.max(0, stickY) : actions.held("move-back") ? 1 : 0;
  return {
    throttle: Math.max(forward, actions.axis?.("trigger-right") ?? 0),
    brake: Math.max(back, actions.axis?.("trigger-left") ?? 0),
    steer: stickX !== 0 ? stickX : keySteer,
    handbrake: actions.held("jump"),
    ...(stickX !== 0 ? { steerAnalog: true } : {}),
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

/** The authored camera's elevation above the look target (radians). */
function baseElevation(settings: VehicleChaseCameraSettings): number {
  return Math.atan2(settings.height - settings.lookHeight, settings.distance);
}

/**
 * Keeps an orbit inside the allowed elevation band and its yaw in (-π, π], so a
 * player who spun the view round several times swings back the short way.
 * Orbit pitch follows the look convention: negative looks down (camera rises).
 */
export function clampChaseOrbit(orbit: LookAngles, settings: VehicleChaseCameraSettings): LookAngles {
  const base = baseElevation(settings);
  const toRad = Math.PI / 180;
  const minPitch = base - settings.maxElevationDeg * toRad;
  const maxPitch = base - settings.minElevationDeg * toRad;
  const pitch = Math.min(maxPitch, Math.max(minPitch, orbit.pitch));
  const yaw = Math.atan2(Math.sin(orbit.yaw), Math.cos(orbit.yaw));
  return { yaw, pitch };
}

/**
 * Where the chase camera wants to sit when the player has looked around by
 * `orbit` (relative to straight behind). The boom pivots on the look target, so
 * a centred orbit is exactly {@link chaseCameraPosition}. Positive yaw looks
 * left, as everywhere else in the engine.
 */
export function chaseCameraOrbitPosition(
  target: Point3,
  heading: PlanarHeading,
  settings: VehicleChaseCameraSettings,
  orbit: LookAngles,
): Point3 {
  const rise = settings.height - settings.lookHeight;
  const boom = Math.hypot(settings.distance, rise);
  const elevation = baseElevation(settings) - orbit.pitch;
  const cos = Math.cos(orbit.yaw);
  const sin = Math.sin(orbit.yaw);
  // The view direction: the car's heading turned by the orbit yaw about +Y.
  const viewX = heading.x * cos + heading.z * sin;
  const viewZ = -heading.x * sin + heading.z * cos;
  const horizontal = boom * Math.cos(elevation);
  return {
    x: target.x - viewX * horizontal,
    y: target.y + settings.lookHeight + boom * Math.sin(elevation),
    z: target.z - viewZ * horizontal,
  };
}

/**
 * Eases a look-around orbit back to straight behind the car, once the player
 * has left the mouse alone for `lookRecenterDelay` and the car is moving.
 */
export function recenterChaseOrbit(
  orbit: LookAngles,
  idleSeconds: number,
  speed: number,
  deltaSeconds: number,
  settings: VehicleChaseCameraSettings,
): LookAngles {
  if (idleSeconds < settings.lookRecenterDelay) return orbit;
  if (Math.abs(speed) < settings.lookRecenterMinSpeed) return orbit;
  const keep = 1 - followAlpha(settings.lookRecenterRate, deltaSeconds);
  return { yaw: orbit.yaw * keep, pitch: orbit.pitch * keep };
}

/**
 * The spring arm's length this frame, as a fraction of the full boom (0..1).
 * An obstruction pulls it in at once — the camera must never sit behind a wall
 * for a frame — and a cleared view lets it grow back smoothly. `hitFraction` is
 * where along the boom the first blocker sits (null = clear); the padding keeps
 * the camera off the wall itself.
 */
export function stepChaseArmFraction(
  current: number,
  hitFraction: number | null,
  boomLength: number,
  deltaSeconds: number,
  settings: VehicleChaseCameraSettings,
): number {
  const padding = boomLength > 1e-6 ? settings.collisionPadding / boomLength : 0;
  const wanted = hitFraction === null ? 1 : Math.min(1, Math.max(0, hitFraction - padding));
  if (wanted <= current) return wanted;
  return current + (wanted - current) * followAlpha(settings.collisionRecoverRate, deltaSeconds);
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
