/** Torque, automatic gearing and axle distribution. Pure SI-unit calculations. */
import type {
  VehicleDefinition, VehicleDrivetrainDefinition, VehicleDrivetrainState,
  VehicleSteeringPoint, VehicleTorquePoint, VehicleVec3,
} from "./vehicleTypes";

export function sampleTorqueCurve(points: readonly VehicleTorquePoint[], rpm: number): number {
  return sampleCurve(points, rpm, (point) => point.rpm, (point) => point.torqueNm, 0);
}

export function sampleSteeringCurve(points: readonly VehicleSteeringPoint[], speedMps: number): number {
  return sampleCurve(points, Math.abs(speedMps), (point) => point.speedMps, (point) => point.scale, 1);
}

function sampleCurve<T>(points: readonly T[], x: number, at: (point: T) => number, value: (point: T) => number, fallback: number): number {
  const first = points[0];
  if (!first) return fallback;
  if (x <= at(first)) return value(first);
  for (let i = 1; i < points.length; i += 1) {
    const right = points[i]!;
    const left = points[i - 1]!;
    if (x <= at(right)) {
      const alpha = (x - at(left)) / (at(right) - at(left));
      return value(left) + (value(right) - value(left)) * alpha;
    }
  }
  return value(points[points.length - 1]!);
}

/** One shift at a time; reject a shift that would immediately request its inverse. */
export function selectAutomaticGear(
  transmission: VehicleDrivetrainDefinition["transmission"],
  gear: number,
  rpm: number,
): number {
  if (gear < 1) return gear;
  const ratios = transmission.forwardRatios;
  const ratio = ratios[gear - 1]!;
  const next = ratios[gear];
  const lower = ratios[gear - 2];
  if (rpm >= transmission.upshiftRpm && next !== undefined
    && rpm * next / ratio > transmission.downshiftRpm) return gear + 1;
  if (rpm <= transmission.downshiftRpm && lower !== undefined
    && rpm * lower / ratio < transmission.upshiftRpm) return gear - 1;
  return gear;
}

export function initialVehicleDrivetrainState(definition: VehicleDefinition): VehicleDrivetrainState | null {
  return definition.drivetrain
    ? { engineRpm: definition.drivetrain.engine.idleRpm, gear: 1, shiftTimeRemaining: 0 }
    : null;
}

/** Torque weights sum to one on the axles selected by the differential. */
function torqueShares(definition: VehicleDefinition): number[] {
  const differential = definition.drivetrain!.differential;
  const frontCount = definition.wheels.filter((wheel) => wheel.axle === "front").length;
  const rearCount = definition.wheels.length - frontCount;
  const front = differential.driveType === "FWD" ? 1 : differential.driveType === "RWD" ? 0
    : frontCount === 0 ? 0 : rearCount === 0 ? 1 : differential.frontTorqueShare;
  return definition.wheels.map((wheel) => wheel.axle === "front"
    ? (frontCount > 0 ? front / frontCount : 0)
    : (rearCount > 0 ? (1 - front) / rearCount : 0));
}

export function computeDrivetrainDrive(
  definition: VehicleDefinition,
  signedPedal: number,
  forwardSpeed: number,
  previous: VehicleDrivetrainState | null,
  dt: number,
  surfaceResistanceForce = 0,
): { state: VehicleDrivetrainState; forces: number[]; engineBrakeForces: number[] } {
  const { engine, transmission } = definition.drivetrain!;
  const shares = torqueShares(definition);
  // A locked-clutch approximation: longitudinal chassis speed / rolling radius.
  // Clamp at idle to model clutch slip at launch. Wheel slip/free-rev is future work.
  const wheelRpm = Math.abs(forwardSpeed) * 60 / (2 * Math.PI)
    * shares.reduce((sum, share, i) => sum + share / definition.wheels[i]!.radius, 0);
  const old = previous ?? initialVehicleDrivetrainState(definition)!;
  let gear = old.gear === -1 ? -1 : Math.min(transmission.forwardRatios.length, Math.max(1, old.gear));
  let shiftTime = old.shiftTimeRemaining;
  const ratioFor = (selected: number): number => (selected === -1
    ? transmission.reverseRatio : transmission.forwardRatios[selected - 1]!) * transmission.finalDriveRatio;
  if (shiftTime <= 0) {
    const requestedDirection = Math.sign(signedPedal);
    let next = gear;
    if (requestedDirection !== 0 && requestedDirection !== Math.sign(gear)
      && Math.abs(forwardSpeed) <= definition.reverseSpeedThreshold) {
      next = requestedDirection < 0 ? -1 : 1;
    } else if (gear > 0) {
      next = selectAutomaticGear(transmission, gear, wheelRpm * ratioFor(gear));
      // Soft ground keeps braking throughout the torque cut. A shift that is
      // viable at today's speed can therefore finish below the downshift RPM,
      // causing two consecutive power cuts and an almost complete stop.
      if (next > gear && signedPedal > 0 && Number.isFinite(surfaceResistanceForce) && surfaceResistanceForce > 0) {
        const speed = Math.abs(forwardSpeed);
        // The lighter soft-ground rolling profiles permit higher speed: drag
        // during the torque cut must be included in shift viability as well.
        const resistance = surfaceResistanceForce + definition.aerodynamics.dragCoefficient * speed * speed;
        const exitSpeed = Math.max(0, speed - resistance / definition.massKg * transmission.shiftDurationSeconds);
        const exitRpm = speed > 0 ? wheelRpm * ratioFor(next) * exitSpeed / speed : 0;
        const torque = exitRpm >= engine.maxRpm ? 0
          : sampleTorqueCurve(engine.torqueCurve, Math.max(engine.idleRpm, exitRpm)) * signedPedal;
        const force = Math.min(definition.maxEngineForce, torque * ratioFor(next) * transmission.efficiency
          * shares.reduce((sum, share, i) => sum + share / definition.wheels[i]!.radius, 0));
        if (exitRpm <= transmission.downshiftRpm || force <= resistance) next = gear;
      }
    }
    if (next !== gear) {
      gear = next;
      shiftTime = transmission.shiftDurationSeconds;
    }
  }
  // Average connected fraction for a fixed slice straddling the end of a shift.
  const connected = shiftTime <= 0 ? 1 : dt > 0 ? Math.max(0, 1 - shiftTime / dt) : 0;
  const ratio = ratioFor(gear);
  const shaftRpm = wheelRpm * ratio;
  const engineRpm = Math.min(engine.maxRpm, Math.max(engine.idleRpm, shaftRpm));
  const demand = Math.sign(signedPedal) === Math.sign(gear) ? Math.abs(signedPedal) : 0;
  const torque = shaftRpm >= engine.maxRpm ? 0 : sampleTorqueCurve(engine.torqueCurve, engineRpm) * demand;
  const wheelTorque = torque * ratio * transmission.efficiency * connected;
  let forces = shares.map((share, i) => Math.sign(gear) * wheelTorque * share / definition.wheels[i]!.radius);
  const totalForce = forces.reduce((sum, force) => sum + Math.abs(force), 0);
  const cap = gear < 0 ? definition.maxReverseForce : definition.maxEngineForce;
  if (totalForce > cap) forces = forces.map((force) => force * cap / totalForce);
  const brakingTorque = demand === 0 && Math.abs(forwardSpeed) > definition.reverseSpeedThreshold
    ? engine.engineBrakeTorqueNm * ratio * transmission.efficiency * connected : 0;
  return {
    state: { engineRpm, gear, shiftTimeRemaining: Math.max(0, shiftTime - dt) },
    forces,
    engineBrakeForces: shares.map((share, i) => brakingTorque * share / definition.wheels[i]!.radius),
  };
}

/** World-space drag opposes velocity; downforce points down with horizontal speed². */
export function computeVehicleAerodynamics(definition: VehicleDefinition, velocity: VehicleVec3): VehicleVec3 {
  const [x, y, z] = velocity;
  const drag = definition.aerodynamics.dragCoefficient * Math.hypot(x, y, z);
  const down = definition.aerodynamics.downforceCoefficient * (x * x + z * z);
  return [-x * drag, -y * drag - down, -z * drag];
}
