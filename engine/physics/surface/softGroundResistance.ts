/** Simplified load-relative soil ploughing; no renderer, collider or vehicle preset dependencies. */
import type { SurfaceSample } from "./surfaceResponse";

/**
 * F = load × (speed-ramped rolling + ploughing + high-speed soil drag). Only wheel burial is
 * counted here; excess depth beyond chassis clearance remains belly drag.
 * Ploughing supplies finite breakaway even at zero speed. Buried rolling can
 * be rate-dependent so it need not consume all grip on a hill start. Presets
 * without the optional controls retain their historical response exactly.
 */
export function wheelGroundResistance(sample: SurfaceSample | null, load: number, depth: number, radius: number, speed: number): number {
  if (!sample || ![load, depth, radius, speed].every(Number.isFinite) || load <= 0 || radius <= 0) return 0;
  const buried = Math.max(0, Math.min(depth / radius, 1));
  const profile = sample.softGround;
  const exponent = Number.isFinite(profile?.ploughExponent) ? Math.max(1, Math.min(4, profile!.ploughExponent!)) : 1;
  const atRest = Number.isFinite(profile?.rollingResistanceAtRest) ? Math.max(0, Math.min(1, profile!.rollingResistanceAtRest!)) : 1;
  const plough = Math.max(0, profile?.ploughResistance ?? 0) * buried ** exponent;
  const ramp = Math.min(Math.abs(speed), 1);
  const rolling = Math.max(0, sample.rollingResistance) * (plough > 0 ? atRest + (1 - atRest) * ramp : ramp);
  // Work against fresh soft ground does not wait for a visual rut or depend
  // on throttle. Ramp smoothly over half..full reference speed, then cap the
  // coefficient so road-speed entries cannot create unbounded impact forces.
  const referenceSpeed = profile?.resistanceSpeedMps ?? 20 / 3.6;
  const highSpeed = Number.isFinite(referenceSpeed) && referenceSpeed > 0
    ? Math.max(0, Math.min(1, Math.abs(speed) / referenceSpeed * 2 - 1)) : 0;
  const speedDrag = Math.max(0, profile?.highSpeedResistance ?? 0)
    * Math.max(0, Math.min(1, sample.deformability)) * highSpeed ** 2;
  return load * (rolling + plough + speedDrag);
}

/**
 * Dissipative point-contact impulse magnitude. `inverseEffectiveMass` includes
 * both bodies' translation and rotation along the tangent. The stopping cap
 * forbids reversing contact motion; J·v − J²/(2m) is never negative.
 */
export function resistanceImpulse(speed: number, force: number, dt: number, inverseEffectiveMass: number): number {
  if (![speed, force, dt, inverseEffectiveMass].every(Number.isFinite)
    || speed <= 0 || force <= 0 || dt <= 0 || inverseEffectiveMass <= 0) return 0;
  return Math.min(force * dt, speed / inverseEffectiveMass);
}
