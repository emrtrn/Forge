/** Pure, allocation-free when supplied an output object; speeds are in m/s. */
export interface WheelSurfaceFxInput {
  inContact: boolean;
  /** Signed axle angular speed times wheel radius. */
  wheelSpeed: number;
  /** Signed ground speed along the wheel's rolling direction. */
  groundSpeed: number;
  chassisSpeed: number;
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
 * Motion = clamp(max(|chassis|, |wheel|) / 15, 0, 1), so a stationary
 * burnout still sprays, but stopped wheels on a stopped chassis stay silent.
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
      !Number.isFinite(input.groundSpeed) || !Number.isFinite(input.chassisSpeed)) return out;
  const wheelSpeed = Math.abs(input.wheelSpeed);
  const groundSpeed = Math.abs(input.groundSpeed);
  const motion = Math.min(1, Math.max(Math.abs(input.chassisSpeed), wheelSpeed) / 15);
  if (motion === 0) return out;
  const slip = Math.min(1, Math.abs(input.wheelSpeed - input.groundSpeed) / Math.max(wheelSpeed, groundSpeed, 1));
  out.emissionRate = motion * (0.2 + 0.8 * slip);
  out.soundVolume = motion * (0.3 + 0.7 * slip);
  out.soundPitch = 0.75 + 0.75 * motion + 0.5 * slip;
  return out;
}
