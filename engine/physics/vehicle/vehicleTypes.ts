/**
 * Wheeled vehicle description (vehicle plan Faz 1). Engine-generic data: a
 * chassis rigid body plus ray-cast wheels, the PhysX/Chaos Vehicles model that
 * Rapier's `DynamicRayCastVehicleController` implements. Units are SI —
 * metres, kilograms, newtons, seconds — and every vector is chassis-local with
 * Forge's model convention: +Y up, +Z forward, so the car's right is -X.
 *
 * Authored as `*.vehicle.json` assets or inline Vehicle component props.
 * Runtime loading and saving share {@link normalizeVehicleDefinition}.
 */
import type { EntityId } from "../../scene/entity";

export type VehicleVec3 = readonly [number, number, number];

export interface VehicleWheelDefinition {
  /** Optional model node to animate instead of generating a cylinder wheel. */
  readonly visualNode?: string;
  /** Suspension hard point (top of the spring), chassis-local. */
  readonly position: VehicleVec3;
  /** Torque-mode axle; inferred from local Z when omitted (+Z = front). */
  readonly axle: "front" | "rear";
  readonly radius: number;
  /** Tyre width (m): track footprint and generated wheel; absent is `radius × 0.7`. */
  readonly width?: number;
  /** Spring length at rest; the wheel centre hangs this far below `position`. */
  readonly suspensionRestLength: number;
  /** How far the spring may travel past its rest length either way. */
  readonly suspensionMaxTravel: number;
  /**
   * Spring rate per unit chassis mass (the ray-cast vehicle multiplies by mass):
   * static sag per wheel ≈ g / (wheelCount × stiffness).
   */
  readonly suspensionStiffness: number;
  /** Damping while the spring compresses. */
  readonly suspensionCompression: number;
  /** Damping while the spring extends; higher stops the chassis bouncing. */
  readonly suspensionRelaxation: number;
  /** Cap on the spring force (N). */
  readonly maxSuspensionForce: number;
  /** Tyre grip along the rolling direction; high values can flip the car on hard braking. */
  readonly frictionSlip: number;
  /** Tyre grip across the rolling direction (cornering). */
  readonly sideFrictionStiffness: number;
  /** Turned by the steering input. */
  readonly steer: boolean;
  /** Receives engine force in legacy flat-force mode; drivetrain uses axle. */
  readonly drive: boolean;
  /** Receives the foot brake. */
  readonly brake: boolean;
  /** Receives the handbrake. */
  readonly handbrake: boolean;
}

export interface VehicleDefinition {
  /** Chassis mass; replaces the collider-derived mass. */
  readonly massKg: number;
  /** Centre of mass relative to the chassis origin; lower is harder to roll. */
  readonly centerOfMassOffset: VehicleVec3;
  readonly wheels: readonly VehicleWheelDefinition[];
  /** Total forward force cap; flat-force output when drivetrain is null. */
  readonly maxEngineForce: number;
  /** Total reverse drive force, split across `drive` wheels. */
  readonly maxReverseForce: number;
  /** Total foot-brake force, split across `brake` wheels. */
  readonly maxBrakeForce: number;
  /** Total handbrake force, split across `handbrake` wheels. */
  readonly handbrakeForce: number;
  /** Total rolling resistance applied as a light brake while coasting. */
  readonly rollingResistanceForce: number;
  /** Full-lock wheel angle. */
  readonly maxSteerAngleDeg: number;
  /** Steering input travel per second (1 = centre to full lock in one second). */
  readonly steerSpeed: number;
  /**
   * Scales `steerSpeed` by forward speed, so a key press turns the wheels
   * quickly while manoeuvring and gently at cruising speed. Applies only while
   * the wheels move away from centre; `steerReturnSpeed` brings them back.
   */
  readonly steerRateCurve: readonly VehicleSteeringPoint[];
  /** Input travel per second back toward centre (release, counter-steer); 0 = `steerSpeed`. */
  readonly steerReturnSpeed: number;
  /**
   * Response curve from smoothed input to wheel angle: `|s|^gamma`. Above 1 a
   * short tap gives a small angle, so a digital key can hold a gentle bend.
   */
  readonly steerGamma: number;
  /** Below this forward speed (m/s) the brake input reverses instead of braking. */
  readonly reverseSpeedThreshold: number;
  /** Null preserves the Faz 1 flat-force behavior for existing assets. */
  readonly drivetrain: VehicleDrivetrainDefinition | null;
  readonly steeringSpeedCurve: readonly VehicleSteeringPoint[];
  /** Scales lateral stiffness on handbrake wheels while held (0..1). */
  readonly handbrakeSideFrictionMultiplier: number;
  /** F = coefficient * speed², coefficients in kg/m. */
  readonly aerodynamics: { readonly dragCoefficient: number; readonly downforceCoefficient: number };
  /** Looped engine sound driven by RPM and load; null = a silent car. */
  readonly engineSound: VehicleEngineSoundDefinition | null;
}

/**
 * The engine's voice (vehicle plan 4d): one looped sound whose pitch follows
 * the RPM and whose volume follows the engine load, as an Unreal vehicle
 * Blueprint drives its engine audio component's pitch and volume multipliers.
 * Presentation data — physics never reads it — kept on the vehicle so a car's
 * asset describes the whole car.
 */
export interface VehicleEngineSoundDefinition {
  /** Manifest `sound` or `soundCue` asset id, looped while the car is driven. */
  readonly sound: string;
  /** Pitch multiplier at idle RPM and at max RPM (linear in between). */
  readonly idlePitch: number;
  readonly maxPitch: number;
  /** Volume at idle off the throttle, and at full engine load (0..1). */
  readonly idleVolume: number;
  readonly loadVolume: number;
  /** A car without a drivetrain has no RPM: its pitch follows speed up to this (m/s). */
  readonly speedForMaxPitch: number;
  /** Spatial sphere attenuation around the car (m). */
  readonly refDistance: number;
  readonly maxDistance: number;
}

const DEFAULT_ENGINE_SOUND: Omit<VehicleEngineSoundDefinition, "sound"> = {
  idlePitch: 1,
  maxPitch: 2.2,
  idleVolume: 0.35,
  loadVolume: 0.9,
  speedForMaxPitch: 30,
  refDistance: 6,
  maxDistance: 80,
};

export interface VehicleTorquePoint { readonly rpm: number; readonly torqueNm: number }
export interface VehicleSteeringPoint { readonly speedMps: number; readonly scale: number }
export interface VehicleDrivetrainDefinition {
  readonly engine: {
    readonly idleRpm: number;
    readonly maxRpm: number;
    readonly torqueCurve: readonly VehicleTorquePoint[];
    readonly engineBrakeTorqueNm: number;
  };
  readonly transmission: {
    readonly forwardRatios: readonly number[];
    readonly reverseRatio: number;
    readonly finalDriveRatio: number;
    readonly efficiency: number;
    readonly upshiftRpm: number;
    readonly downshiftRpm: number;
    readonly shiftDurationSeconds: number;
  };
  readonly differential: {
    readonly driveType: "FWD" | "RWD" | "AWD";
    /** AWD only. Missing axles redistribute their share to existing wheels. */
    readonly frontTorqueShare: number;
  };
}

export interface VehicleDrivetrainState {
  readonly engineRpm: number;
  /** -1 = reverse; 1..N = forward (automatic, no manual neutral). */
  readonly gear: number;
  readonly shiftTimeRemaining: number;
}

/**
 * What a moving vehicle carries beyond its pose: velocities, the handbrake it
 * stands on and its gearbox position. Read and re-applied around a save-game
 * (vehicle plan 4b) so a car saved at speed comes back at speed.
 */
export interface VehicleMotionState {
  /** World m/s. */
  readonly linearVelocity: VehicleVec3;
  /** World rad/s. */
  readonly angularVelocity: VehicleVec3;
  readonly handbrake: boolean;
  /** Null for a car without a drivetrain (flat-force model). */
  readonly drivetrain: { readonly gear: number; readonly engineRpm: number } | null;
}

/** Versioned on-disk envelope; physics only needs the definition inside it. */
export interface VehicleAsset extends VehicleDefinition {
  readonly schema: 1;
  readonly type: "vehicle";
}

/** Driver intent, refreshed by the controller each frame. */
export interface VehicleInput {
  /** 0..1 */
  readonly throttle: number;
  /** 0..1 — brakes while rolling forward, reverses once (nearly) stopped. */
  readonly brake: number;
  /** -1 (left) .. 1 (right). */
  readonly steer: number;
  /**
   * `steer` is a stick position the player already eases by hand, not a key's
   * full-lock request: the wheels follow it directly, skipping the steer rate
   * filter (the gamma response still applies). Absent = a key / AI request.
   */
  readonly steerAnalog?: boolean;
  readonly handbrake: boolean;
}

export const NEUTRAL_VEHICLE_INPUT: VehicleInput = Object.freeze({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
});

/** Live per-wheel readback, for wheel visuals and debug drawing. */
export interface VehicleWheelState {
  readonly visualNode?: string;
  /** Hard point, chassis-local (as authored). */
  readonly position: VehicleVec3;
  readonly radius: number;
  /** Current spring length; the wheel centre is this far below `position`. */
  readonly suspensionLength: number;
  /** Spring force on the wheel from the last step (N): its load on the ground; 0 airborne. */
  readonly suspensionForce: number;
  /** Wheel yaw in radians (positive turns toward the car's left, +X). */
  readonly steering: number;
  /** Accumulated spin about the axle in radians. */
  readonly rotation: number;
  readonly inContact: boolean;
  /** Entity owning the contacted collider, or null when airborne/unmapped. */
  readonly groundEntityId: EntityId | null;
  /** World-space ground hit, when in contact. */
  readonly contactPoint: VehicleVec3 | null;
  /** World-space ray start (the hard point). */
  readonly hardPoint: VehicleVec3 | null;
}

export interface VehicleState {
  /** Signed speed along the chassis forward axis (m/s). */
  readonly forwardSpeed: number;
  /**
   * How hard the engine is asked to pull (0..1): the pedal driving the car,
   * forward or in reverse. Zero coasting, braking and through a gear change's
   * power cut — what an engine sound's volume follows.
   */
  readonly engineLoad: number;
  readonly wheels: readonly VehicleWheelState[];
  readonly drivetrain: VehicleDrivetrainState | null;
}

const DEFAULT_WHEEL: Omit<VehicleWheelDefinition, "position" | "axle"> = {
  radius: 0.35,
  suspensionRestLength: 0.35,
  suspensionMaxTravel: 0.25,
  suspensionStiffness: 30,
  suspensionCompression: 4.4,
  suspensionRelaxation: 5.5,
  maxSuspensionForce: 12000,
  frictionSlip: 2.5,
  sideFrictionStiffness: 1,
  steer: false,
  drive: false,
  brake: true,
  handbrake: false,
};

const DEFAULT_VEHICLE: Omit<VehicleDefinition, "wheels"> = {
  massKg: 1200,
  centerOfMassOffset: [0, -0.35, 0],
  maxEngineForce: 6000,
  maxReverseForce: 3000,
  maxBrakeForce: 11000,
  handbrakeForce: 5000,
  rollingResistanceForce: 300,
  maxSteerAngleDeg: 35,
  steerSpeed: 3,
  steerRateCurve: [{ speedMps: 0, scale: 1 }],
  steerReturnSpeed: 0,
  steerGamma: 1,
  reverseSpeedThreshold: 0.5,
  drivetrain: null,
  steeringSpeedCurve: [{ speedMps: 0, scale: 1 }],
  handbrakeSideFrictionMultiplier: 1,
  aerodynamics: { dragCoefficient: 0, downforceCoefficient: 0 },
  engineSound: null,
};

const DEFAULT_DRIVETRAIN: VehicleDrivetrainDefinition = {
  engine: {
    idleRpm: 900, maxRpm: 6500, engineBrakeTorqueNm: 40,
    torqueCurve: [
      { rpm: 900, torqueNm: 160 }, { rpm: 2500, torqueNm: 260 },
      { rpm: 4500, torqueNm: 300 }, { rpm: 6500, torqueNm: 200 },
    ],
  },
  transmission: {
    forwardRatios: [3.4, 2.1, 1.4, 1, 0.8], reverseRatio: 3.2,
    finalDriveRatio: 3.42, efficiency: 0.9,
    upshiftRpm: 5500, downshiftRpm: 1800, shiftDurationSeconds: 0.2,
  },
  differential: { driveType: "RWD", frontTorqueShare: 0.5 },
};

export type VehicleWheelDefinitionInput = Partial<VehicleWheelDefinition> &
  Pick<VehicleWheelDefinition, "position">;
export type VehicleDefinitionInput = Partial<Omit<VehicleDefinition, "wheels" | "drivetrain" | "aerodynamics" | "engineSound">> & {
  readonly wheels: readonly VehicleWheelDefinitionInput[];
  readonly drivetrain?: {
    readonly engine?: Partial<VehicleDrivetrainDefinition["engine"]>;
    readonly transmission?: Partial<VehicleDrivetrainDefinition["transmission"]>;
    readonly differential?: Partial<VehicleDrivetrainDefinition["differential"]>;
  } | null;
  readonly aerodynamics?: Partial<VehicleDefinition["aerodynamics"]>;
  readonly engineSound?: Partial<VehicleEngineSoundDefinition> | null;
};

/**
 * Fills defaults and clamps every number into a range the solver survives
 * (positive radius/mass, non-negative forces). Non-finite values fall back to
 * the default, so a half-authored definition still drives.
 */
export function resolveVehicleDefinition(input: VehicleDefinitionInput): VehicleDefinition {
  return normalizeVehicleDefinition(input)!;
}

/**
 * Single field allowlist for assets, inline props and saves. Invalid fields keep
 * the base value; a valid inline wheels array replaces the entire base array.
 * Missing/empty/malformed wheels retain the base wheels, as in Faz 1 components.
 */
export function normalizeVehicleDefinition(
  value: unknown,
  base: VehicleDefinition = referenceCarDefaults(),
): VehicleDefinition | null {
  if (!isRecord(value)) return null;
  const input = value;
  const wheels = Array.isArray(input.wheels)
    ? input.wheels.filter(
        (wheel): wheel is VehicleWheelDefinitionInput => isRecord(wheel) && isVec3(wheel.position),
      )
    : [];
  return {
    massKg: positive(input.massKg, base.massKg),
    centerOfMassOffset: vec3(input.centerOfMassOffset, base.centerOfMassOffset),
    maxEngineForce: nonNegative(input.maxEngineForce, base.maxEngineForce),
    maxReverseForce: nonNegative(input.maxReverseForce, base.maxReverseForce),
    maxBrakeForce: nonNegative(input.maxBrakeForce, base.maxBrakeForce),
    handbrakeForce: nonNegative(input.handbrakeForce, base.handbrakeForce),
    rollingResistanceForce: nonNegative(
      input.rollingResistanceForce,
      base.rollingResistanceForce,
    ),
    maxSteerAngleDeg: Math.min(80, nonNegative(input.maxSteerAngleDeg, base.maxSteerAngleDeg)),
    steerSpeed: positive(input.steerSpeed, base.steerSpeed),
    steerRateCurve: normalizeSteeringCurve(input.steerRateCurve, base.steerRateCurve, STEER_RATE_SCALE_RANGE),
    steerReturnSpeed: bounded(input.steerReturnSpeed, base.steerReturnSpeed, 0, 50),
    steerGamma: bounded(input.steerGamma, base.steerGamma, STEER_GAMMA_RANGE[0], STEER_GAMMA_RANGE[1]),
    reverseSpeedThreshold: nonNegative(
      input.reverseSpeedThreshold,
      base.reverseSpeedThreshold,
    ),
    wheels: (wheels.length > 0 ? wheels : base.wheels).map(resolveWheel),
    drivetrain: input.drivetrain === null ? null
      : normalizeDrivetrain(input.drivetrain, base.drivetrain),
    steeringSpeedCurve: normalizeSteeringCurve(input.steeringSpeedCurve, base.steeringSpeedCurve),
    handbrakeSideFrictionMultiplier: unit(input.handbrakeSideFrictionMultiplier, base.handbrakeSideFrictionMultiplier),
    aerodynamics: {
      dragCoefficient: nonNegative(record(input.aerodynamics).dragCoefficient, base.aerodynamics.dragCoefficient),
      downforceCoefficient: nonNegative(record(input.aerodynamics).downforceCoefficient, base.aerodynamics.downforceCoefficient),
    },
    engineSound: input.engineSound === null ? null
      : normalizeEngineSound(input.engineSound, base.engineSound),
  };
}

/**
 * Inline fields override the asset's one by one; null switches the sound off.
 * A block with no usable `sound` id (and none to inherit) is no sound at all.
 */
function normalizeEngineSound(
  value: unknown,
  base: VehicleEngineSoundDefinition | null,
): VehicleEngineSoundDefinition | null {
  if (!isRecord(value)) return base ? { ...base } : null;
  const fallback = base ?? { ...DEFAULT_ENGINE_SOUND, sound: "" };
  const sound = typeof value.sound === "string" && value.sound.trim() ? value.sound.trim() : fallback.sound;
  if (!sound) return null;
  const refDistance = bounded(value.refDistance, fallback.refDistance, 0.1, 1000);
  return {
    sound,
    idlePitch: bounded(value.idlePitch, fallback.idlePitch, 0.1, 4),
    maxPitch: bounded(value.maxPitch, fallback.maxPitch, 0.1, 4),
    idleVolume: unit(value.idleVolume, fallback.idleVolume),
    loadVolume: unit(value.loadVolume, fallback.loadVolume),
    speedForMaxPitch: bounded(value.speedForMaxPitch, fallback.speedForMaxPitch, 0.1, 200),
    refDistance,
    maxDistance: bounded(value.maxDistance, fallback.maxDistance, refDistance + 1, 5000),
  };
}

/** Partial nested inline blocks override the asset; null explicitly selects legacy mode. */
function normalizeDrivetrain(value: unknown, base: VehicleDrivetrainDefinition | null): VehicleDrivetrainDefinition | null {
  if (!isRecord(value) && !base) return null;
  const fallback = base ?? DEFAULT_DRIVETRAIN;
  const input = record(value);
  const engine = record(input.engine);
  const gearbox = record(input.transmission);
  const differential = record(input.differential);
  const idleRpm = bounded(engine.idleRpm, fallback.engine.idleRpm, 100, 20000);
  const maxRpm = bounded(engine.maxRpm, fallback.engine.maxRpm, idleRpm + 100, 30000);
  const upshiftRpm = bounded(gearbox.upshiftRpm, fallback.transmission.upshiftRpm, idleRpm + 50, maxRpm);
  const ratios = Array.isArray(gearbox.forwardRatios)
    ? gearbox.forwardRatios.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 20).slice(0, 12)
    : [];
  const curve = Array.isArray(engine.torqueCurve) ? engine.torqueCurve
    .filter((point): point is Record<string, unknown> => isRecord(point))
    .filter((point) => typeof point.rpm === "number" && Number.isFinite(point.rpm) && point.rpm >= 0
      && typeof point.torqueNm === "number" && Number.isFinite(point.torqueNm) && point.torqueNm >= 0)
    .map((point) => ({ rpm: point.rpm as number, torqueNm: point.torqueNm as number })) : [];
  return {
    engine: {
      idleRpm, maxRpm,
      torqueCurve: uniqueSortedPoints(curve.length ? curve : fallback.engine.torqueCurve, (point) => point.rpm),
      engineBrakeTorqueNm: nonNegative(engine.engineBrakeTorqueNm, fallback.engine.engineBrakeTorqueNm),
    },
    transmission: {
      forwardRatios: ratios.length ? [...new Set(ratios)].sort((a, b) => b - a) : [...fallback.transmission.forwardRatios],
      reverseRatio: bounded(gearbox.reverseRatio, fallback.transmission.reverseRatio, 0.01, 20),
      finalDriveRatio: bounded(gearbox.finalDriveRatio, fallback.transmission.finalDriveRatio, 0.01, 20),
      efficiency: unit(gearbox.efficiency, fallback.transmission.efficiency),
      upshiftRpm,
      downshiftRpm: bounded(gearbox.downshiftRpm, fallback.transmission.downshiftRpm, idleRpm, upshiftRpm - 1),
      shiftDurationSeconds: bounded(gearbox.shiftDurationSeconds, fallback.transmission.shiftDurationSeconds, 0, 5),
    },
    differential: {
      driveType: differential.driveType === "FWD" || differential.driveType === "RWD" || differential.driveType === "AWD"
        ? differential.driveType : fallback.differential.driveType,
      frontTorqueShare: unit(differential.frontTorqueShare, fallback.differential.frontTorqueShare),
    },
  };
}

/** A zero rate would freeze the wheels, so the rate curve keeps a small floor. */
const STEER_RATE_SCALE_RANGE: readonly [number, number] = [0.01, 4];
export const STEER_GAMMA_RANGE: readonly [number, number] = [0.25, 4];

function normalizeSteeringCurve(
  value: unknown,
  fallback: readonly VehicleSteeringPoint[],
  [min, max]: readonly [number, number] = [0, 1],
): VehicleSteeringPoint[] {
  const points = Array.isArray(value) ? value
    .filter((point): point is Record<string, unknown> => isRecord(point))
    .filter((point) => typeof point.speedMps === "number" && Number.isFinite(point.speedMps) && point.speedMps >= 0
      && typeof point.scale === "number" && Number.isFinite(point.scale))
    .map((point) => ({ speedMps: point.speedMps as number, scale: bounded(point.scale, 1, min, max) })) : [];
  return uniqueSortedPoints(points.length ? points : fallback, (point) => point.speedMps);
}

function uniqueSortedPoints<T>(points: readonly T[], key: (point: T) => number): T[] {
  return [...new Map(points.map((point) => [key(point), { ...point }])).values()]
    .sort((a, b) => key(a) - key(b));
}

function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function unit(value: unknown, fallback: number): number { return bounded(value, fallback, 0, 1); }
function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, typeof value === "number" && Number.isFinite(value) ? value : fallback));
}

/** Runtime and save validation use exactly the same versioned asset shape. */
export function normalizeVehicleAsset(value: unknown): VehicleAsset | null {
  if (!isRecord(value) || value.schema !== 1 || value.type !== "vehicle") return null;
  const definition = normalizeVehicleDefinition(value);
  return definition ? { schema: 1, type: "vehicle", ...definition } : null;
}

/** Public-root-relative paths only; shared by static reads and dev saves. */
export function normalizeVehicleAssetPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().replace(/\\/g, "/");
  if (!path.endsWith(".vehicle.json") || /[?#:%\u0000-\u001f]/.test(path)) return null;
  if (path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return path;
}

function resolveWheel(wheel: VehicleWheelDefinitionInput): VehicleWheelDefinition {
  return {
    ...(typeof wheel.visualNode === "string" && wheel.visualNode.trim()
      ? { visualNode: wheel.visualNode.trim() } : {}),
    position: vec3(wheel.position, [0, 0, 0]),
    axle: wheel.axle === "front" || wheel.axle === "rear" ? wheel.axle : wheel.position[2] >= 0 ? "front" : "rear",
    radius: positive(wheel.radius, DEFAULT_WHEEL.radius),
    ...(typeof wheel.width === "number" && Number.isFinite(wheel.width) && wheel.width > 0 ? { width: wheel.width } : {}),
    suspensionRestLength: nonNegative(wheel.suspensionRestLength, DEFAULT_WHEEL.suspensionRestLength),
    suspensionMaxTravel: nonNegative(wheel.suspensionMaxTravel, DEFAULT_WHEEL.suspensionMaxTravel),
    suspensionStiffness: positive(wheel.suspensionStiffness, DEFAULT_WHEEL.suspensionStiffness),
    suspensionCompression: nonNegative(wheel.suspensionCompression, DEFAULT_WHEEL.suspensionCompression),
    suspensionRelaxation: nonNegative(wheel.suspensionRelaxation, DEFAULT_WHEEL.suspensionRelaxation),
    maxSuspensionForce: positive(wheel.maxSuspensionForce, DEFAULT_WHEEL.maxSuspensionForce),
    frictionSlip: nonNegative(wheel.frictionSlip, DEFAULT_WHEEL.frictionSlip),
    sideFrictionStiffness: nonNegative(wheel.sideFrictionStiffness, DEFAULT_WHEEL.sideFrictionStiffness),
    steer: flag(wheel.steer, DEFAULT_WHEEL.steer),
    drive: flag(wheel.drive, DEFAULT_WHEEL.drive),
    brake: flag(wheel.brake, DEFAULT_WHEEL.brake),
    handbrake: flag(wheel.handbrake, DEFAULT_WHEEL.handbrake),
  };
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * A mid-size rear-drive car sized for a chassis box collider of
 * `[1.8, 0.6, 4.2]` centred on the body origin — the reference vehicle the
 * Faz 1 proof slice and tests drive. Front wheels steer, rear wheels drive and
 * take the handbrake.
 */
export function createReferenceCarDefinition(): VehicleDefinition {
  return referenceCarDefaults();
}

function referenceCarDefaults(): VehicleDefinition {
  const halfTrack = 0.8;
  const frontZ = 1.35;
  const rearZ = -1.3;
  const hardPointY = -0.1;
  return {
    ...DEFAULT_VEHICLE,
    centerOfMassOffset: [...DEFAULT_VEHICLE.centerOfMassOffset],
    aerodynamics: { ...DEFAULT_VEHICLE.aerodynamics },
    steeringSpeedCurve: DEFAULT_VEHICLE.steeringSpeedCurve.map((point) => ({ ...point })),
    steerRateCurve: DEFAULT_VEHICLE.steerRateCurve.map((point) => ({ ...point })),
    wheels: ([
      { position: [halfTrack, hardPointY, frontZ], steer: true },
      { position: [-halfTrack, hardPointY, frontZ], steer: true },
      { position: [halfTrack, hardPointY, rearZ], drive: true, handbrake: true },
      { position: [-halfTrack, hardPointY, rearZ], drive: true, handbrake: true },
    ] satisfies VehicleWheelDefinitionInput[]).map(resolveWheel),
  };
}

/**
 * Reads a `Vehicle` component's props into a definition. Every field is
 * optional: scalar props override the loaded asset (or reference car), and an authored `wheels`
 * array replaces its wheels (entries without a `position` are dropped). Props
 * that are not an object yield null — the chassis stays a plain dynamic body.
 */
export function vehicleDefinitionFromComponent(
  props: unknown,
  asset?: VehicleDefinition,
): VehicleDefinition | null {
  return normalizeVehicleDefinition(props, asset);
}

/**
 * The scalar `Vehicle` fields a level designer may override per class or per
 * placement — the quick knobs; wheels, suspension and the drivetrain stay with
 * the vehicle asset.
 */
export const VEHICLE_OVERRIDE_SCALAR_KEYS = [
  "massKg",
  "maxEngineForce",
  "maxReverseForce",
  "maxBrakeForce",
  "handbrakeForce",
  "maxSteerAngleDeg",
  "steerSpeed",
] as const satisfies readonly (keyof VehicleDefinition)[];

export type VehicleOverrideScalarKey = (typeof VEHICLE_OVERRIDE_SCALAR_KEYS)[number];

/**
 * A placed actor's level-owned overrides on its class's `Vehicle` component
 * (vehicle plan Faz 5): another asset, the quick scalars, or the engine sound
 * (`null` silences this car). Absent fields keep the class's value.
 */
export type VehicleOverrides = {
  asset?: string;
  engineSound?: { sound: string } | null;
} & { [K in VehicleOverrideScalarKey]?: number };

/**
 * Layers placement overrides onto a class's `Vehicle` props, before the asset
 * is resolved — so an overridden `asset` is the one loaded. The engine sound
 * swaps only the loop and keeps the class's inline tuning.
 */
export function applyVehicleOverrides(
  props: Readonly<Record<string, unknown>>,
  overrides: VehicleOverrides,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...props };
  if (overrides.asset !== undefined) merged.asset = overrides.asset;
  for (const key of VEHICLE_OVERRIDE_SCALAR_KEYS) {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
  }
  if (overrides.engineSound === null) merged.engineSound = null;
  else if (overrides.engineSound) merged.engineSound = { ...record(props.engineSound), sound: overrides.engineSound.sound };
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVec3(value: unknown): value is VehicleVec3 {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function vec3(value: unknown, fallback: VehicleVec3): VehicleVec3 {
  if (!isVec3(value)) return [...fallback];
  return [value[0], value[1], value[2]];
}
