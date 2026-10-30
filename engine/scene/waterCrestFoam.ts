/** Shared Lake/River whitecaps. Independent of shore and baked contact foam. */
export interface WaterCrestFoamSettings {
  crestFoamEnabled?: boolean;
  crestFoamStrength?: number;
  crestFoamThreshold?: number;
}

export const WATER_CREST_FOAM_DEFAULTS = {
  crestFoamEnabled: true, crestFoamStrength: 0.75, crestFoamThreshold: 0.35,
};

/** Used on both read and save. Missing fields stay missing in saved layouts. */
export function validateWaterCrestFoam(input: WaterCrestFoamSettings): WaterCrestFoamSettings {
  const out: WaterCrestFoamSettings = {};
  if (input.crestFoamEnabled !== undefined) {
    if (typeof input.crestFoamEnabled !== "boolean") throw new Error("Invalid crest foam enabled");
    out.crestFoamEnabled = input.crestFoamEnabled;
  }
  for (const key of ["crestFoamStrength", "crestFoamThreshold"] as const) {
    const v = input[key];
    if (v !== undefined) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`Invalid crest foam ${key}`);
      out[key] = v;
    }
  }
  return out;
}

/** Threshold 0–1 is a wave-steepness limit |∇h| (rise per metre), matching
 * WATER_CREST_FOAM_GLSL: calm swell (e.g. 4 cm over 6 m, ~0.045) stays clear
 * at the default, steep authored waves whitecap. */
export function crestFoamSteepness(threshold: number): number {
  return 0.02 + 0.1 * Math.max(0, Math.min(1, threshold));
}

export function resolveWaterCrestFoam(input: WaterCrestFoamSettings) {
  return { ...WATER_CREST_FOAM_DEFAULTS, ...validateWaterCrestFoam(input) };
}
