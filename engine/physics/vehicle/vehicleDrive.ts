/**
 * Pure driver-intent → wheel-command mapping (vehicle plan Faz 1). No Rapier:
 * the physics subsystem feeds the result into the ray-cast controller every
 * fixed slice. Faz 3 replaces the flat engine force with a torque curve and
 * gearbox behind the same output shape.
 */
import type { VehicleDefinition, VehicleInput } from "./vehicleTypes";

export interface VehicleWheelCommand {
  /** Drive force along the wheel's rolling direction (N, negative = reverse). */
  readonly engineForce: number;
  /** Brake force (N); the subsystem turns it into a per-slice impulse. */
  readonly brakeForce: number;
  /** Wheel yaw in radians (positive = toward the car's left). */
  readonly steering: number;
}

export interface VehicleDriveResult {
  readonly wheels: readonly VehicleWheelCommand[];
  /** Smoothed steering input (-1..1) to feed back in next slice. */
  readonly steer: number;
}

/**
 * Arcade-style pedal logic, as in Unreal's vehicle template: throttle drives
 * forward (braking first if rolling backwards); brake slows a forward-rolling
 * car and reverses once it is below `reverseSpeedThreshold`. With no pedal the
 * wheels take a light rolling-resistance brake so the car coasts to a stop.
 */
export function computeVehicleDrive(
  definition: VehicleDefinition,
  input: VehicleInput,
  forwardSpeed: number,
  previousSteer: number,
  deltaSeconds: number,
): VehicleDriveResult {
  const throttle = clamp(finiteOr(input.throttle, 0), 0, 1);
  const brake = clamp(finiteOr(input.brake, 0), 0, 1);
  const targetSteer = clamp(finiteOr(input.steer, 0), -1, 1);
  const threshold = definition.reverseSpeedThreshold;

  let drive = 0;
  let footBrake = 0;
  if (throttle > 0) {
    if (forwardSpeed < -threshold) footBrake += throttle;
    else drive += throttle * definition.maxEngineForce;
  }
  if (brake > 0) {
    if (forwardSpeed > threshold) footBrake += brake;
    else drive -= brake * definition.maxReverseForce;
  }
  footBrake = Math.min(1, footBrake);
  const coasting = throttle === 0 && brake === 0;

  const steer = approach(previousSteer, targetSteer, definition.steerSpeed * Math.max(0, deltaSeconds));
  // +steer is the car's right (-X), which is a negative yaw about +Y.
  const steering = -steer * (definition.maxSteerAngleDeg * Math.PI) / 180;

  const wheels = definition.wheels;
  const driveCount = wheels.filter((wheel) => wheel.drive).length;
  const brakeCount = wheels.filter((wheel) => wheel.brake).length;
  const handbrakeCount = wheels.filter((wheel) => wheel.handbrake).length;
  const rollingPerWheel = coasting && wheels.length > 0
    ? definition.rollingResistanceForce / wheels.length
    : 0;

  return {
    steer,
    wheels: wheels.map((wheel) => {
      let brakeForce = rollingPerWheel;
      if (wheel.brake && brakeCount > 0) brakeForce += (footBrake * definition.maxBrakeForce) / brakeCount;
      if (input.handbrake && wheel.handbrake && handbrakeCount > 0) {
        brakeForce += definition.handbrakeForce / handbrakeCount;
      }
      return {
        engineForce: wheel.drive && driveCount > 0 ? drive / driveCount : 0,
        brakeForce,
        steering: wheel.steer ? steering : 0,
      };
    }),
  };
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
