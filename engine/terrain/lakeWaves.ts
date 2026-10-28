import { LAKE_SURFACE_WAVE_DEFAULTS } from "../scene/waterBody";

export type LakeWaveSettings = typeof LAKE_SURFACE_WAVE_DEFAULTS;
// Direction offset, wavelength multiplier, temporal multiplier, phase, weight.
export const LAKE_WAVE_COMPONENTS = [[0, 1, 1, 0, .55], [1.08, .71, 1.3, 1.7, .3], [-.71, 1.37, .8, 3.1, .15]] as const;
export interface LakeWaveParameters {
  height: number; shoreDepth: number; period: number;
  components: readonly (readonly [number, number, number, number])[];
}
/** Reduce the world anchor to phase on the CPU, keeping GPU coordinates local
 * even at large world origins. The pattern remains fixed when bounds move. */
export function lakeWaveParameters(settings: LakeWaveSettings, x: number, z: number): LakeWaveParameters {
  const tau = Math.PI * 2, direction = settings.surfaceWaveDirection * Math.PI / 180;
  return { height: settings.surfaceWavesEnabled ? settings.surfaceWaveHeight : 0,
    shoreDepth: settings.surfaceWaveShoreDepth, period: settings.surfaceWavePeriod,
    components: LAKE_WAVE_COMPONENTS.map(([angle, scale, speed, phase]) => {
      const k = tau / (settings.surfaceWaveLength * scale);
      const dx = Math.cos(direction + angle) * k, dz = Math.sin(direction + angle) * k;
      return [dx, dz, tau / settings.surfaceWavePeriod * speed, ((x * dx + z * dz + phase) % tau + tau) % tau];
    }) };
}
export function lakeWaveTime(seconds: number, parameters: LakeWaveParameters): number {
  // Temporal ratios are tenths: ten periods is a seamless common cycle.
  return ((seconds % (parameters.period * 10)) + parameters.period * 10) % (parameters.period * 10);
}
export function lakeWaveOffset(x: number, z: number, depth: number, seconds: number, p: LakeWaveParameters): number {
  if (p.height <= 0 || depth <= 0) return 0;
  const t = Math.max(0, Math.min(1, depth / p.shoreDepth)), fade = t * t * (3 - 2 * t);
  const time = lakeWaveTime(seconds, p);
  let wave = 0;
  p.components.forEach(([kx, kz, omega, phase], i) => { wave += Math.sin(x * kx + z * kz - time * omega + phase) * LAKE_WAVE_COMPONENTS[i]![4]; });
  return wave * Math.min(p.height, depth * .25) * fade;
}
