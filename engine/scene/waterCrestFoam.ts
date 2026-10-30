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

export function resolveWaterCrestFoam(input: WaterCrestFoamSettings) {
  return { ...WATER_CREST_FOAM_DEFAULTS, ...validateWaterCrestFoam(input) };
}
