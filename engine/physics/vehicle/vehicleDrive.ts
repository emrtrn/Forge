/**
 * Pure driver-intent → wheel-command mapping. No Rapier:
 * the physics subsystem feeds the result into the ray-cast controller every
 * fixed slice. Assets may opt into the torque curve/gearbox drivetrain; legacy
 * flat-force definitions keep their original pedal and wheel-drive behavior.
 */
import type { VehicleDefinition, VehicleDrivetrainState, VehicleInput } from "./vehicleTypes";
import { computeDrivetrainDrive, sampleSteeringCurve } from "./vehicleDrivetrain";

export interface VehicleWheelCommand {
  /** Drive force along the wheel's rolling direction (N, negative = reverse). */
  readonly engineForce: number;
  /** Brake force (N); the subsystem turns it into a per-slice impulse. */
  readonly brakeForce: number;
  /** Wheel yaw in radians (positive = toward the car's left). */
  readonly steering: number;
  readonly sideFrictionStiffness: number;
}

export interface VehicleDriveResult {
  readonly wheels: readonly VehicleWheelCommand[];
  /** Smoothed steering input (-1..1) to feed back in next slice. */
  readonly steer: number;
  readonly drivetrain: VehicleDrivetrainState | null;
  /**
   * The pedal that is driving the car this slice (0..1) — throttle forward or
   * brake-as-reverse, not a pedal that is braking — and 0 through a gear
   * change's power cut. What an engine sound's volume follows.
   */
  readonly engineLoad: number;
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
  previousDrivetrain: VehicleDrivetrainState | null = null,
  surfaceResistanceForce = 0,
): VehicleDriveResult {
  const throttle = clamp(finiteOr(input.throttle, 0), 0, 1);
  const brake = clamp(finiteOr(input.brake, 0), 0, 1);
  const targetSteer = clamp(finiteOr(input.steer, 0), -1, 1);
  const threshold = definition.reverseSpeedThreshold;

  let drive = 0;
  let forwardPedal = 0;
  let reversePedal = 0;
  let footBrake = 0;
  if (throttle > 0) {
    if (forwardSpeed < -threshold) footBrake += throttle;
    else { drive += throttle * definition.maxEngineForce; forwardPedal = throttle; }
  }
  if (brake > 0) {
    if (forwardSpeed > threshold) footBrake += brake;
    else { drive -= brake * definition.maxReverseForce; reversePedal = brake; }
  }
  footBrake = Math.min(1, footBrake);
  const coasting = throttle === 0 && brake === 0;

  const dt = Math.max(0, finiteOr(deltaSeconds, 0));
  const riseSpeed = definition.steerSpeed * sampleSteeringCurve(definition.steerRateCurve, forwardSpeed);
  const returnSpeed = definition.steerReturnSpeed > 0 ? definition.steerReturnSpeed : definition.steerSpeed;
  const steer = input.steerAnalog
    ? targetSteer
    : stepSteer(previousSteer, targetSteer, riseSpeed * dt, returnSpeed * dt);
  // +steer is the car's right (-X), which is a negative yaw about +Y.
  const steering = -steerResponse(steer, definition.steerGamma) * (definition.maxSteerAngleDeg * Math.PI) / 180
    * sampleSteeringCurve(definition.steeringSpeedCurve, forwardSpeed);
  const drivetrain = definition.drivetrain ? computeDrivetrainDrive(
    definition, forwardPedal - reversePedal, forwardSpeed, previousDrivetrain, dt, surfaceResistanceForce,
  ) : null;

  const wheels = definition.wheels;
  const driveCount = wheels.filter((wheel) => wheel.drive).length;
  const brakeCount = wheels.filter((wheel) => wheel.brake).length;
  const handbrakeCount = wheels.filter((wheel) => wheel.handbrake).length;
  const rollingPerWheel = coasting && wheels.length > 0
    ? definition.rollingResistanceForce / wheels.length
    : 0;

  const shifting = (drivetrain?.state.shiftTimeRemaining ?? 0) > 0;
  return {
    steer,
    drivetrain: drivetrain?.state ?? null,
    engineLoad: shifting ? 0 : Math.max(forwardPedal, reversePedal),
    wheels: wheels.map((wheel, index) => {
      let brakeForce = rollingPerWheel + (drivetrain?.engineBrakeForces[index] ?? 0);
      if (wheel.brake && brakeCount > 0) brakeForce += (footBrake * definition.maxBrakeForce) / brakeCount;
      if (input.handbrake && wheel.handbrake && handbrakeCount > 0) {
        brakeForce += definition.handbrakeForce / handbrakeCount;
      }
      return {
        engineForce: drivetrain ? drivetrain.forces[index]! : wheel.drive && driveCount > 0 ? drive / driveCount : 0,
        brakeForce,
        steering: wheel.steer ? steering : 0,
        sideFrictionStiffness: wheel.sideFrictionStiffness
          * (input.handbrake && wheel.handbrake ? definition.handbrakeSideFrictionMultiplier : 1),
      };
    }),
  };
}

/**
 * Moves the smoothed steer toward the key's target: away from centre at the
 * (speed-scaled) rise rate, back toward it at the return rate. A counter-steer
 * returns through centre first and spends what is left of the slice rising.
 */
function stepSteer(current: number, target: number, riseDelta: number, returnDelta: number): number {
  if (current !== 0 && Math.sign(target) !== Math.sign(current)) {
    const toCentre = Math.abs(current);
    if (toCentre >= returnDelta) return current - Math.sign(current) * returnDelta;
    return approach(0, target, riseDelta * (1 - toCentre / returnDelta));
  }
  return approach(current, target, Math.abs(target) < Math.abs(current) ? returnDelta : riseDelta);
}

/** Smoothed steer (-1..1) → fraction of the speed-limited lock. */
export function steerResponse(steer: number, gamma: number): number {
  return Math.sign(steer) * Math.abs(steer) ** gamma;
}

/** Inverse of {@link steerResponse}: the steer input that yields a lock fraction. */
export function steerForLockFraction(fraction: number, gamma: number): number {
  return Math.sign(fraction) * Math.abs(fraction) ** (1 / gamma);
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
