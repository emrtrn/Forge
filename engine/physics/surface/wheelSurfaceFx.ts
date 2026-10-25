/** Pure, allocation-free when supplied an output object; speeds are in m/s. */
export interface WheelSurfaceFxInput {
  inContact: boolean;
  /** Signed axle angular speed times wheel radius. */
  wheelSpeed: number;
  /** Signed ground speed along the wheel's rolling direction. */
  groundSpeed: number;
  chassisSpeed: number;
  /** Physics traction demand (0..1). When present, replaces the rotation estimate. */
  tractionSlip?: number | undefined;
}

export interface WheelSurfaceFxLevels {
  /** Multiplier on the effect's authored emission rate (0..1). */
  emissionRate: number;
  soundVolume: number;
  /** 0 while silent, otherwise 0.75..2. */
  soundPitch: number;
}

/**
 * Slip = clamp(|wheel - ground| / max(|wheel|, |ground|, 1), 0, 1).
 * Physics slip overrides the rotation estimate: Rapier ties rotation to ground
 * speed, even while a driven tyre is digging. Slip provides up to 0.6 motion
 * at standstill; an unpowered parked tyre remains silent.
 * Emission = motion * (0.2 + 0.8 * slip); volume = motion * (0.3 + 0.7 * slip).
 * Pitch = 0.75 + 0.75 * motion + 0.5 * slip. Airborne/invalid input is silent.
 */
export function wheelSurfaceFxLevels(
  input: WheelSurfaceFxInput,
  out: WheelSurfaceFxLevels = { emissionRate: 0, soundVolume: 0, soundPitch: 0 },
): WheelSurfaceFxLevels {
  out.emissionRate = 0;
  out.soundVolume = 0;
  out.soundPitch = 0;
  if (!input.inContact || !Number.isFinite(input.wheelSpeed) ||
      !Number.isFinite(input.groundSpeed) || !Number.isFinite(input.chassisSpeed) ||
      (input.tractionSlip !== undefined && !Number.isFinite(input.tractionSlip))) return out;
  const wheelSpeed = Math.abs(input.wheelSpeed);
  const groundSpeed = Math.abs(input.groundSpeed);
  const slip = input.tractionSlip === undefined
    ? Math.min(1, Math.abs(input.wheelSpeed - input.groundSpeed) / Math.max(wheelSpeed, groundSpeed, 1))
    : Math.max(0, Math.min(1, input.tractionSlip));
  // With authoritative physics slip, a reset's rotation discontinuity must
  // not look like one frame of extreme wheelspin.
  const speed = input.tractionSlip === undefined ? Math.max(Math.abs(input.chassisSpeed), wheelSpeed) : Math.abs(input.chassisSpeed);
  const motion = Math.max(Math.min(1, speed / 15), slip * 0.6);
  if (motion === 0) return out;
  out.emissionRate = motion * (0.2 + 0.8 * slip);
  out.soundVolume = motion * (0.3 + 0.7 * slip);
  out.soundPitch = 0.75 + 0.75 * motion + 0.5 * slip;
  return out;
}
