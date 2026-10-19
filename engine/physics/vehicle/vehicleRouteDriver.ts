/**
 * A simple AI driver for ray-cast vehicles (vehicle plan Faz 4, AI slice).
 *
 * It follows a route — anything sampled by distance, in practice a Generic
 * Spline — by turning the car's pose and speed into the same
 * {@link VehicleInput} a player produces. Physics then moves the car exactly as
 * it would under a player: nothing is teleported, so the car can be pushed,
 * can skid wide in a bend and recovers by steering back.
 *
 * - **Steering** is pure pursuit: aim at a point a look-ahead distance further
 *   along the route (longer at speed, so the line stays smooth) and turn the
 *   wheels by the bicycle-model angle that arcs onto it.
 * - **Speed** cruises at the target, slows for the bend ahead in proportion to
 *   how sharply the route turns, and on a route that ends brakes to a stop at
 *   its end, then parks on the handbrake.
 * - **Progress** is tracked locally — a short window around the last known
 *   distance — so a figure-eight or a route doubling back near itself cannot
 *   make the car skip to the wrong stretch.
 *
 * Pure (no Rapier, no Three.js): unit-testable against an analytic route.
 */
import { sampleSteeringCurve } from "./vehicleDrivetrain";
import type { VehicleDefinition, VehicleInput, VehicleVec3 } from "./vehicleTypes";

export interface VehicleRoute {
  readonly length: number;
  /** Laps back to the start, or ends — and the car stops there. */
  readonly loop: boolean;
  locationAt(distance: number): VehicleVec3;
  directionAt(distance: number): VehicleVec3;
  /** Used once, to join the route; the window search takes over after that. */
  closestDistanceTo(point: VehicleVec3): number;
}

export interface VehicleRouteDriverSettings {
  /** Cruising speed on straights (m/s). */
  readonly targetSpeed: number;
  /** Pure-pursuit look-ahead at rest (m). */
  readonly lookAheadDistance: number;
  /** Extra look-ahead per m/s of speed (s). */
  readonly lookAheadPerSpeed: number;
  /** Share of the target speed kept through a 90° bend (0..1). */
  readonly cornerSpeedFraction: number;
  /** Deceleration planned for when stopping at the end of a route (m/s²). */
  readonly braking: number;
}

export const DEFAULT_VEHICLE_ROUTE_DRIVER: VehicleRouteDriverSettings = {
  targetSpeed: 12,
  lookAheadDistance: 5,
  lookAheadPerSpeed: 0.5,
  cornerSpeedFraction: 0.35,
  braking: 4,
};

export interface VehicleRouteDriverState {
  /** Progress along the route (m), within [0, length]. */
  readonly distance: number;
}

export interface VehicleRoutePose {
  readonly position: VehicleVec3;
  /** The car's forward direction flattened onto the ground (normalised). */
  readonly heading: { readonly x: number; readonly z: number };
}

export interface VehicleRouteDriveResult {
  readonly input: VehicleInput;
  readonly state: VehicleRouteDriverState;
  /** Where the car is steering toward this tick. */
  readonly targetPoint: VehicleVec3;
  /** The speed it is aiming for this tick (m/s). */
  readonly speedLimit: number;
  /** Reached the end of a route that does not loop, and stopped. */
  readonly finished: boolean;
}

/** How far behind / ahead of the last known progress the window search looks (m). */
const WINDOW_BEHIND = 3;
const WINDOW_AHEAD_MIN = 8;
const WINDOW_STEP = 0.5;
/** The end-of-route stop is aimed this far short of the last point (m). */
const STOP_MARGIN = 1.5;
/** Below this the car counts as stopped (m/s). */
const STOPPED_SPEED = 0.5;
/** Seconds of travel the bend check looks past the steering point. */
const CORNER_LOOK_SECONDS = 1;

/** Where the car joins the route: nearest point, or the start. */
export function startVehicleRoute(
  route: VehicleRoute,
  position: VehicleVec3,
  entry: "nearest" | "start",
): VehicleRouteDriverState {
  if (entry === "start" || !(route.length > 0)) return { distance: 0 };
  return { distance: wrapDistance(route, route.closestDistanceTo(position)) };
}

export function stepVehicleRouteDriver(
  route: VehicleRoute,
  state: VehicleRouteDriverState,
  pose: VehicleRoutePose,
  speed: number,
  definition: VehicleDefinition,
  settings: VehicleRouteDriverSettings,
): VehicleRouteDriveResult {
  const forwardSpeed = Number.isFinite(speed) ? speed : 0;
  const distance = trackProgress(route, state.distance, pose.position, Math.abs(forwardSpeed));
  const lookAhead = settings.lookAheadDistance + Math.abs(forwardSpeed) * settings.lookAheadPerSpeed;
  const targetPoint = route.locationAt(wrapDistance(route, distance + lookAhead));

  // Speed: cruise, ease off for the bend ahead, stop at the end of an open route.
  const bend = bendAngle(route, distance, [lookAhead * 0.5, lookAhead, lookAhead + Math.abs(forwardSpeed) * CORNER_LOOK_SECONDS]);
  const bendShare = Math.min(1, bend / (Math.PI / 2));
  let speedLimit = settings.targetSpeed * (1 - bendShare * (1 - settings.cornerSpeedFraction));
  const remaining = route.loop ? Number.POSITIVE_INFINITY : route.length - distance;
  if (!route.loop) {
    speedLimit = Math.min(speedLimit, Math.sqrt(2 * settings.braking * Math.max(0, remaining - STOP_MARGIN)));
  }
  const finished = !route.loop && remaining <= STOP_MARGIN + 0.5 && Math.abs(forwardSpeed) < STOPPED_SPEED;

  const steer = pursuitSteer(pose, targetPoint, forwardSpeed, definition);
  if (finished) {
    return {
      input: { throttle: 0, brake: 0, steer, handbrake: true },
      state: { distance },
      targetPoint,
      speedLimit: 0,
      finished,
    };
  }
  return {
    input: { ...pedalsFor(speedLimit, forwardSpeed, definition), steer, handbrake: false },
    state: { distance },
    targetPoint,
    speedLimit,
    finished,
  };
}

/**
 * Throttle in proportion to how far below the limit the car is (with a little
 * feed-forward to hold a cruise against rolling resistance); brake when well
 * above it. The brake pedal reverses a car that is (nearly) stopped, so it is
 * only pressed while the car is clearly rolling forward.
 */
function pedalsFor(limit: number, speed: number, definition: VehicleDefinition): Pick<VehicleInput, "throttle" | "brake"> {
  const error = limit - speed;
  if (error >= -0.5) {
    const cruise = limit > STOPPED_SPEED ? 0.1 : 0;
    return { throttle: clamp(error * 0.4 + cruise, 0, 1), brake: 0 };
  }
  const rolling = speed > definition.reverseSpeedThreshold + STOPPED_SPEED;
  return { throttle: 0, brake: rolling ? clamp(-error * 0.3, 0, 1) : 0 };
}

/** Pure pursuit on the bicycle model; +steer is the car's right, as for a player. */
function pursuitSteer(
  pose: VehicleRoutePose,
  target: VehicleVec3,
  speed: number,
  definition: VehicleDefinition,
): number {
  const dx = target[0] - pose.position[0];
  const dz = target[2] - pose.position[2];
  const { x: fx, z: fz } = pose.heading;
  // The car's right is −X when it faces +Z: (−fz, fx).
  const lateral = dx * -fz + dz * fx;
  const longitudinal = dx * fx + dz * fz;
  const alpha = Math.atan2(lateral, longitudinal);
  const reach = Math.max(1, Math.hypot(dx, dz));
  const wheelAngle = Math.atan2(2 * wheelbase(definition) * Math.sin(alpha), reach);
  const lock = (definition.maxSteerAngleDeg * Math.PI) / 180
    * sampleSteeringCurve(definition.steeringSpeedCurve, speed);
  if (!(lock > 1e-6)) return 0;
  return clamp(wheelAngle / lock, -1, 1);
}

/** Front-to-rear axle distance from the wheel layout (2.5 m when it is degenerate). */
function wheelbase(definition: VehicleDefinition): number {
  let front = Number.NEGATIVE_INFINITY;
  let rear = Number.POSITIVE_INFINITY;
  for (const wheel of definition.wheels) {
    front = Math.max(front, wheel.position[2]);
    rear = Math.min(rear, wheel.position[2]);
  }
  const span = front - rear;
  return Number.isFinite(span) && span > 0.5 ? span : 2.5;
}

/** The sharpest planar heading change between here and each of the offsets ahead (radians). */
function bendAngle(route: VehicleRoute, distance: number, offsets: readonly number[]): number {
  const here = planar(route.directionAt(distance));
  if (!here) return 0;
  let sharpest = 0;
  for (const offset of offsets) {
    const ahead = planar(route.directionAt(wrapDistance(route, distance + offset)));
    if (!ahead) continue;
    const dot = clamp(here.x * ahead.x + here.z * ahead.z, -1, 1);
    sharpest = Math.max(sharpest, Math.acos(dot));
  }
  return sharpest;
}

/** The closest route point to the car within a window around the last progress. */
function trackProgress(route: VehicleRoute, previous: number, position: VehicleVec3, speed: number): number {
  if (!(route.length > 0)) return 0;
  const ahead = Math.max(WINDOW_AHEAD_MIN, speed * 1.5);
  let best = previous;
  let bestError = Number.POSITIVE_INFINITY;
  for (let offset = -WINDOW_BEHIND; offset <= ahead; offset += WINDOW_STEP) {
    const candidate = route.loop ? previous + offset : clamp(previous + offset, 0, route.length);
    const point = route.locationAt(wrapDistance(route, candidate));
    const error = (point[0] - position[0]) ** 2 + (point[2] - position[2]) ** 2;
    if (error < bestError) {
      bestError = error;
      best = candidate;
    }
  }
  return wrapDistance(route, best);
}

function wrapDistance(route: VehicleRoute, distance: number): number {
  if (!(route.length > 0) || !Number.isFinite(distance)) return 0;
  if (route.loop) return ((distance % route.length) + route.length) % route.length;
  return clamp(distance, 0, route.length);
}

function planar(direction: VehicleVec3): { x: number; z: number } | null {
  const length = Math.hypot(direction[0], direction[2]);
  return length > 1e-6 ? { x: direction[0] / length, z: direction[2] / length } : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
