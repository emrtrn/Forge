import type { WeatherPreset } from "./worldEnvironment";

/**
 * Weather presets as **relative** adjustments of the authored atmosphere (WES
 * v0.3 §7.1): `clear` is the identity, and `intensity` blends linearly from
 * clear (0) to the full preset (1), so one preset reads the same in levels with
 * different art direction. The numbers are starting values, tuned at the K1
 * visual acceptance.
 *
 * WES never creates a missing actor (§7.2): with no Cloud Layer, `cloudy`
 * shows no clouds; the editor warns instead.
 */
export interface WeatherFactors {
  /** Cloud coverage is raised toward at least this (null = authored), by {@link WeatherFactors.weight}. */
  cloudCoverageMin: number | null;
  /** The preset's blend weight (the clamped intensity); 0 is clear. */
  weight: number;
  fogDensityMultiplier: number;
  /** 0..1 mix of the fog color toward {@link WeatherFactors.fogTint}. */
  fogTintMix: number;
  fogTint: string;
  sunIntensityMultiplier: number;
  /** Added to the sky's turbidity (haze). */
  skyTurbidityAdd: number;
}

const GREY = "#9aa3ad";
const COLD_WHITE = "#dfe8f2";

export const WEATHER_PRESET_TABLE: Readonly<Record<WeatherPreset, WeatherFactors>> = {
  clear: { weight: 0, cloudCoverageMin: null, fogDensityMultiplier: 1, fogTintMix: 0, fogTint: GREY, sunIntensityMultiplier: 1, skyTurbidityAdd: 0 },
  cloudy: { weight: 1, cloudCoverageMin: 0.7, fogDensityMultiplier: 1.5, fogTintMix: 0.3, fogTint: GREY, sunIntensityMultiplier: 0.6, skyTurbidityAdd: 4 },
  rain: { weight: 1, cloudCoverageMin: 0.9, fogDensityMultiplier: 2.5, fogTintMix: 0.5, fogTint: GREY, sunIntensityMultiplier: 0.35, skyTurbidityAdd: 8 },
  snow: { weight: 1, cloudCoverageMin: 0.9, fogDensityMultiplier: 3, fogTintMix: 0.4, fogTint: COLD_WHITE, sunIntensityMultiplier: 0.45, skyTurbidityAdd: 6 },
  fog: { weight: 1, cloudCoverageMin: null, fogDensityMultiplier: 6, fogTintMix: 0, fogTint: GREY, sunIntensityMultiplier: 0.7, skyTurbidityAdd: 3 },
};

/** The preset blended with clear by `intensity` (0..1). */
export function weatherFactors(preset: WeatherPreset, intensity: number): WeatherFactors {
  const full = WEATHER_PRESET_TABLE[preset] ?? WEATHER_PRESET_TABLE.clear;
  const w = preset === "clear" ? 0 : Math.min(1, Math.max(0, intensity));
  const mix = (identity: number, value: number): number => identity + (value - identity) * w;
  return {
    weight: w,
    cloudCoverageMin: full.cloudCoverageMin === null || w === 0 ? null : full.cloudCoverageMin,
    fogDensityMultiplier: mix(1, full.fogDensityMultiplier),
    fogTintMix: full.fogTintMix * w,
    fogTint: full.fogTint,
    sunIntensityMultiplier: mix(1, full.sunIntensityMultiplier),
    skyTurbidityAdd: full.skyTurbidityAdd * w,
  };
}

/** Whether a preset needs a Cloud Layer / Height Fog / Sky Atmosphere actor to show (§7.2). */
export function weatherPresetRequirements(preset: WeatherPreset): Array<"cloudLayer" | "heightFog" | "skyAtmosphere"> {
  const factors = WEATHER_PRESET_TABLE[preset];
  const needs: Array<"cloudLayer" | "heightFog" | "skyAtmosphere"> = [];
  if (factors.cloudCoverageMin !== null) needs.push("cloudLayer");
  if (factors.fogDensityMultiplier !== 1 || factors.fogTintMix > 0) needs.push("heightFog");
  if (factors.skyTurbidityAdd !== 0) needs.push("skyAtmosphere");
  return needs;
}
