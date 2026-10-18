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
export type VehicleVec3 = readonly [number, number, number];

export interface VehicleWheelDefinition {
  /** Suspension hard point (top of the spring), chassis-local. */
  readonly position: VehicleVec3;
  readonly radius: number;
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
  /** Receives engine force. */
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
  /** Total forward drive force, split across `drive` wheels (Faz 3: torque curve). */
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
  /** Below this forward speed (m/s) the brake input reverses instead of braking. */
  readonly reverseSpeedThreshold: number;
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
  /** Hard point, chassis-local (as authored). */
  readonly position: VehicleVec3;
  readonly radius: number;
  /** Current spring length; the wheel centre is this far below `position`. */
  readonly suspensionLength: number;
  /** Wheel yaw in radians (positive turns toward the car's left, +X). */
  readonly steering: number;
  /** Accumulated spin about the axle in radians. */
  readonly rotation: number;
  readonly inContact: boolean;
  /** World-space ground hit, when in contact. */
  readonly contactPoint: VehicleVec3 | null;
  /** World-space ray start (the hard point). */
  readonly hardPoint: VehicleVec3 | null;
}

export interface VehicleState {
  /** Signed speed along the chassis forward axis (m/s). */
  readonly forwardSpeed: number;
  readonly wheels: readonly VehicleWheelState[];
}

const DEFAULT_WHEEL: Omit<VehicleWheelDefinition, "position"> = {
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
  reverseSpeedThreshold: 0.5,
};

export type VehicleWheelDefinitionInput = Partial<VehicleWheelDefinition> &
  Pick<VehicleWheelDefinition, "position">;
export type VehicleDefinitionInput = Partial<Omit<VehicleDefinition, "wheels">> & {
  readonly wheels: readonly VehicleWheelDefinitionInput[];
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
    reverseSpeedThreshold: nonNegative(
      input.reverseSpeedThreshold,
      base.reverseSpeedThreshold,
    ),
    wheels: (wheels.length > 0 ? wheels : base.wheels).map(resolveWheel),
  };
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
    position: vec3(wheel.position, [0, 0, 0]),
    radius: positive(wheel.radius, DEFAULT_WHEEL.radius),
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
