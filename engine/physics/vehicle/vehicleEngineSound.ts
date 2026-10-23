/**
 * Engine sound levels from the live vehicle state (vehicle plan 4d): the pure
 * mapping an audio layer applies to its looped engine voice every frame.
 *
 * Pitch follows the engine's revs across its range; a car without a drivetrain
 * has no RPM, so its speed stands in. Volume follows the load: a car pulling
 * hard is loud, one coasting or braking idles — but high revs alone (engine
 * braking down a hill) still carry, at half weight, so a revving car never
 * drops to the idle level.
 */
import type { VehicleDefinition, VehicleEngineSoundDefinition, VehicleState } from "./vehicleTypes";

export interface VehicleEngineSoundLevels {
  readonly pitch: number;
  readonly volume: number;
}

/** 0 at idle, 1 at max RPM (or `speedForMaxPitch` without a drivetrain). */
export function engineRevFraction(
  sound: VehicleEngineSoundDefinition,
  definition: VehicleDefinition,
  state: VehicleState,
): number {
  const engine = definition.drivetrain?.engine;
  const rpm = state.drivetrain?.engineRpm;
  const fraction =
    engine && rpm !== undefined
      ? (rpm - engine.idleRpm) / Math.max(1, engine.maxRpm - engine.idleRpm)
      : Math.abs(state.forwardSpeed) / sound.speedForMaxPitch;
  return Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
}

export function vehicleEngineSoundLevels(
  sound: VehicleEngineSoundDefinition,
  definition: VehicleDefinition,
  state: VehicleState,
): VehicleEngineSoundLevels {
  const revs = engineRevFraction(sound, definition, state);
  const load = Number.isFinite(state.engineLoad) ? Math.min(1, Math.max(0, state.engineLoad)) : 0;
  const weight = Math.max(load, revs * 0.5);
  return {
    pitch: sound.idlePitch + (sound.maxPitch - sound.idlePitch) * revs,
    volume: sound.idleVolume + (sound.loadVolume - sound.idleVolume) * weight,
  };
}
