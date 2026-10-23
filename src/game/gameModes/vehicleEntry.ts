/**
 * Pure enter/exit rules for a character climbing into a vehicle (vehicle plan
 * Faz 4) — which car is in reach, where the driver steps out, and how the car
 * is stopped first. No scene access, so the rules are unit-testable on their own;
 * `TpsCharacterSession` applies them.
 *
 * Axis convention matches the vehicle engine: +Y up, +Z forward, the car's
 * right is −X — so the driver's door (left-hand drive) is on local +X.
 */
import type { Aabb3 } from "@engine/movement/characterCollision";
import type { VehicleInput, VehicleState } from "@engine/physics/vehicle/vehicleTypes";
import type { Point3 } from "./vehicleCameraControl";

export interface VehicleEntrySettings {
  /** How close (m, horizontal) the character must stand to a car's origin. */
  readonly enterRadius: number;
  /** Side distance (m) from the car's origin to where the driver steps out. */
  readonly exitSideOffset: number;
  /** Distance (m) behind the car's origin for the last-resort exit spot. */
  readonly exitRearOffset: number;
  /** Height (m) above the ground the character is dropped at, to settle onto it. */
  readonly exitLift: number;
  /** The car must be slower than this (m/s) before the driver gets out. */
  readonly maxExitSpeed: number;
  /** Footprint (m) checked against static blockers at an exit spot. */
  readonly exitClearance: { readonly radius: number; readonly height: number };
}

export const DEFAULT_VEHICLE_ENTRY: VehicleEntrySettings = {
  enterRadius: 3.5,
  exitSideOffset: 1.7,
  exitRearOffset: 3.2,
  exitLift: 0.1,
  maxExitSpeed: 2,
  exitClearance: { radius: 0.35, height: 1.7 },
};

export interface VehicleCandidate {
  readonly id: string;
  readonly position: Point3;
}

/** The nearest vehicle within `enterRadius` (horizontal distance), or null. */
export function findEnterableVehicle(
  characterPosition: Point3,
  candidates: readonly VehicleCandidate[],
  settings: Pick<VehicleEntrySettings, "enterRadius">,
): string | null {
  let best: string | null = null;
  let bestDistance = settings.enterRadius;
  for (const candidate of candidates) {
    const distance = Math.hypot(
      candidate.position.x - characterPosition.x,
      candidate.position.z - characterPosition.z,
    );
    if (distance <= bestDistance) {
      best = candidate.id;
      bestDistance = distance;
    }
  }
  return best;
}

type Quat = { readonly x: number; readonly y: number; readonly z: number; readonly w: number };

/** Rotates a chassis-local offset into world space by `q`. */
function rotate(q: Quat, v: Point3): Point3 {
  // v' = v + 2w(q×v) + 2q×(q×v)
  const cx = q.y * v.z - q.z * v.y;
  const cy = q.z * v.x - q.x * v.z;
  const cz = q.x * v.y - q.y * v.x;
  const ddx = q.y * cz - q.z * cy;
  const ddy = q.z * cx - q.x * cz;
  const ddz = q.x * cy - q.y * cx;
  return {
    x: v.x + 2 * (q.w * cx + ddx),
    y: v.y + 2 * (q.w * cy + ddy),
    z: v.z + 2 * (q.w * cz + ddz),
  };
}

/**
 * Where the car is standing: the lowest wheel contact when any wheel touches
 * down, else the chassis origin — so a centre-pivot car still drops its driver
 * at road level rather than mid-air.
 */
export function vehicleGroundHeight(origin: Point3, state: VehicleState | null): number {
  let ground = Number.POSITIVE_INFINITY;
  for (const wheel of state?.wheels ?? []) {
    if (wheel.inContact && wheel.contactPoint) ground = Math.min(ground, wheel.contactPoint[1]);
  }
  return Number.isFinite(ground) ? ground : origin.y;
}

/**
 * Exit spots in preference order: driver's door (+X), passenger's door (−X),
 * behind the car. Offsets follow the car's yaw only, so a car on its side still
 * puts the driver on the ground beside it rather than above it.
 */
export function vehicleExitCandidates(
  origin: Point3,
  rotation: Quat,
  groundY: number,
  settings: Pick<VehicleEntrySettings, "exitSideOffset" | "exitRearOffset" | "exitLift">,
): Point3[] {
  // Flatten the chassis rotation to its yaw about +Y.
  const forward = rotate(rotation, { x: 0, y: 0, z: 1 });
  const yaw = Math.hypot(forward.x, forward.z) > 1e-3 ? Math.atan2(forward.x, forward.z) : 0;
  const half = yaw / 2;
  const yawOnly: Quat = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
  const y = groundY + settings.exitLift;
  return [
    { x: settings.exitSideOffset, y: 0, z: 0 },
    { x: -settings.exitSideOffset, y: 0, z: 0 },
    { x: 0, y: 0, z: -settings.exitRearOffset },
  ].map((offset) => {
    const world = rotate(yawOnly, offset);
    return { x: origin.x + world.x, y, z: origin.z + world.z };
  });
}

/** True when a character footprint standing at `spot` overlaps a blocker. */
export function exitSpotBlocked(
  spot: Point3,
  blockers: readonly Aabb3[],
  clearance: VehicleEntrySettings["exitClearance"],
): boolean {
  const { radius, height } = clearance;
  return blockers.some(
    (box) =>
      spot.x + radius > box.min[0] &&
      spot.x - radius < box.max[0] &&
      spot.z + radius > box.min[2] &&
      spot.z - radius < box.max[2] &&
      // A small step up off the ground is a floor, not a wall.
      spot.y + height > box.min[1] &&
      spot.y + 0.3 < box.max[1],
  );
}

/** The first unblocked exit spot, or the driver's door when every one is blocked. */
export function chooseExitSpot(
  candidates: readonly Point3[],
  blockers: readonly Aabb3[],
  clearance: VehicleEntrySettings["exitClearance"],
): Point3 | null {
  return candidates.find((spot) => !exitSpotBlocked(spot, blockers, clearance)) ?? candidates[0] ?? null;
}

/**
 * Pedals that bring a moving car to a halt before the driver steps out: the
 * foot brake against the direction of travel (throttle brakes a reversing
 * car), plus the handbrake. Valid while |speed| exceeds the car's reverse
 * threshold, which {@link VehicleEntrySettings.maxExitSpeed} keeps above.
 */
export function stoppingInput(forwardSpeed: number): VehicleInput {
  return {
    throttle: forwardSpeed < 0 ? 1 : 0,
    brake: forwardSpeed > 0 ? 1 : 0,
    steer: 0,
    handbrake: true,
  };
}

/** What a parked car is left holding once its driver is out. */
export const PARKED_VEHICLE_INPUT: VehicleInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: true,
};
