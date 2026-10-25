/** Longitudinal grip and a bounded wheelspin presentation for ray-cast wheels. */
import { tractionSlip } from "./wheelSink";

/**
 * Rapier omits its forward friction clamp when the side impulse is zero.
 * Cap that force before updateVehicle; Rapier still owns the combined sideways
 * friction circle. Call only for a surface that reduces the authored grip.
 */
export function limitWheelEngineForce(force: number, load: number, frictionSlip: number, dt: number, coefficient?: number): number {
  // Rapier's frictionSlip is a handling parameter (2.5 on the stock GAZ-52),
  // not a physical longitudinal coefficient. Soft profiles can supply mu.
  if (coefficient !== undefined) return Math.sign(force) * Math.min(Math.abs(force), Math.max(0, load) * Math.max(0, coefficient));
  return force * (1 - tractionSlip(force, 0, load, frictionSlip, dt));
}

/** Drive demand lost at the longitudinal cap; 0 for an unpowered wheel. */
export function longitudinalSlip(force: number, load: number, coefficient: number | undefined): number {
  if (coefficient === undefined || Math.abs(force) < 1e-9) return 0;
  return Math.max(0, 1 - Math.max(0, load) * Math.max(0, coefficient) / Math.abs(force));
}

/**
 * Extra tyre surface speed (m/s), beyond rolling, from lost drive. This is a
 * presentation model, not an independently simulated wheel rigid body. Slew
 * avoids an RPM jump and spin decays when grip returns or the brake is held.
 */
export function advanceWheelSpin(current: number, driveForce: number, slip: number, braking: boolean, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return current;
  const target = braking ? 0 : Math.sign(driveForce) * Math.max(0, Math.min(1, slip)) * 12;
  const next = target + (current - target) * Math.exp(-dt / (braking ? 0.04 : 0.12));
  return Math.abs(next) < 1e-5 ? 0 : next;
}
