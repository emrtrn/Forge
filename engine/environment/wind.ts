import { weatherFactors } from "./weatherPresets";
import type { Season, WeatherPreset } from "./worldEnvironment";

/**
 * Global wind (DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 6, K-06): one direction,
 * strength and gust for the level, read by the foliage/mesh sway shader.
 * Visual only; nothing here pushes physics bodies.
 *
 * Source order: the World Environment actor's `wind` group, else
 * `worldSettings.wind` (levels without WES), else {@link WIND_DEFAULTS}. While a
 * World Environment is active its live weather and season scale the result.
 * Kept three-free so the save validator and node tests share it.
 */

/** Authored wind, the same sparse shape on the WES actor and in World Settings. */
export interface LayoutWind {
  /** Compass heading the wind blows toward, degrees (0 = +Z, 90 = +X), like `sunPath.azimuthDeg`. */
  directionDeg?: number;
  /** 0..1 base sway strength; 0 is calm. */
  strength?: number;
  /** 0..1 share of the strength that comes in travelling gusts. */
  gust?: number;
}

export interface ResolvedWind {
  directionDeg: number;
  /** Unit XZ vector of {@link directionDeg}. */
  direction: readonly [number, number];
  /** Effective strength after weather and season, 0..{@link WIND_MAX_STRENGTH}. */
  strength: number;
  gust: number;
}

export const WIND_DEFAULTS: Required<LayoutWind> = { directionDeg: 45, strength: 0.3, gust: 0.3 };
/** Upper bound after weather/season multipliers (a storm may exceed authored 1). */
export const WIND_MAX_STRENGTH = 2;

/** Relative season scale of the strength; summer is the identity. */
export const SEASON_WIND_MULTIPLIER: Readonly<Record<Season, number>> = {
  spring: 1.1,
  summer: 1,
  autumn: 1.25,
  winter: 1.15,
};

/** The live World Environment inputs wind reacts to. */
export interface WindEnvironmentState {
  season: Season;
  weather: { preset: WeatherPreset; intensity: number };
}

/**
 * Normalizes an authored wind group: clamps and rounds numbers, drops what is
 * not a number with a warning, keeps only authored fields (`{}` stays `{}`).
 * Shared by `normalizeWorldEnvironment` and the World Settings save validator.
 */
export function normalizeLayoutWind(value: unknown, label: string, warnings: string[]): LayoutWind | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    warnings.push(`${label} must be an object; using the defaults`);
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const out: LayoutWind = {};
  const num = (input: unknown, key: keyof LayoutWind, min: number, max: number): number | undefined => {
    if (input === undefined) return undefined;
    const n = Number(input);
    if (typeof input === "boolean" || input === null || !Number.isFinite(n)) {
      warnings.push(`${label}.${key}: ${String(input)} is not a number; using the default`);
      return undefined;
    }
    const clamped = Math.min(max, Math.max(min, n));
    if (clamped !== n) warnings.push(`${label}.${key}: ${n} clamped to ${clamped}`);
    return Number(clamped.toFixed(3));
  };
  const direction = num(source.directionDeg, "directionDeg", -360, 360);
  if (direction !== undefined) out.directionDeg = Number((((direction % 360) + 360) % 360).toFixed(3)) % 360;
  const strength = num(source.strength, "strength", 0, 1);
  if (strength !== undefined) out.strength = strength;
  const gust = num(source.gust, "gust", 0, 1);
  if (gust !== undefined) out.gust = gust;
  return out;
}

/**
 * The wind to render. `environment` is the active World Environment's live
 * state (null without one): its weather and season scale the strength, and
 * stormy weather adds gust. Field by field, the WES group wins over World Settings.
 */
export function resolveWind(
  worldEnvironmentWind: LayoutWind | null | undefined,
  worldSettingsWind: LayoutWind | null | undefined,
  environment: WindEnvironmentState | null,
): ResolvedWind {
  const directionDeg = worldEnvironmentWind?.directionDeg ?? worldSettingsWind?.directionDeg ?? WIND_DEFAULTS.directionDeg;
  let strength = worldEnvironmentWind?.strength ?? worldSettingsWind?.strength ?? WIND_DEFAULTS.strength;
  let gust = worldEnvironmentWind?.gust ?? worldSettingsWind?.gust ?? WIND_DEFAULTS.gust;
  if (environment) {
    const weather = weatherFactors(environment.weather.preset, environment.weather.intensity);
    strength *= weather.windStrengthMultiplier * (SEASON_WIND_MULTIPLIER[environment.season] ?? 1);
    gust += weather.windGustAdd;
  }
  const radians = (directionDeg * Math.PI) / 180;
  return {
    directionDeg,
    direction: [Math.sin(radians), Math.cos(radians)],
    strength: Math.min(WIND_MAX_STRENGTH, Math.max(0, strength)),
    gust: Math.min(1, Math.max(0, gust)),
  };
}

/**
 * How one foliage type or material answers the wind (Faz 6). Absent on the
 * asset means it never sways; present fields are filled with
 * {@link WIND_SWAY_DEFAULTS}.
 */
export interface WindSwaySettings {
  /** Tip displacement in metres at wind strength 1, before flutter and gusts. */
  amplitude: number;
  /** Metres above the pivot (instance scale 1) where the sway mask reaches 1; at or below the pivot nothing moves. */
  height: number;
  /** Flutter frequency in Hz. */
  frequency: number;
}

export const WIND_SWAY_DEFAULTS: WindSwaySettings = { amplitude: 0.15, height: 1, frequency: 0.6 };
export const WIND_SWAY_LIMITS = {
  amplitude: [0, 5],
  height: [0.01, 100],
  frequency: [0, 10],
} as const satisfies Record<keyof WindSwaySettings, readonly [number, number]>;

/**
 * Lenient like the foliage type normalizer it serves: a non-object is "no
 * sway" (undefined), numbers clamp to {@link WIND_SWAY_LIMITS}, missing or
 * broken ones take the defaults.
 */
export function normalizeWindSwaySettings(value: unknown): WindSwaySettings | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const read = (key: keyof WindSwaySettings): number => {
    const raw = source[key];
    const [min, max] = WIND_SWAY_LIMITS[key];
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : WIND_SWAY_DEFAULTS[key];
    return Number(Math.min(max, Math.max(min, n)).toFixed(3));
  };
  return { amplitude: read("amplitude"), height: read("height"), frequency: read("frequency") };
}

/**
 * The wind of a level this frame. `environment` is the active World
 * Environment's live state, or null when there is none or it is hidden; the
 * actor's `wind` group only counts while it is active ("as if absent" rule).
 */
export function resolveLevelWind(
  layout: { worldEnvironment?: { wind?: LayoutWind } | undefined; worldSettings?: { wind?: LayoutWind } | undefined } | null | undefined,
  environment: WindEnvironmentState | null,
): ResolvedWind {
  return resolveWind(
    environment ? layout?.worldEnvironment?.wind : undefined,
    layout?.worldSettings?.wind,
    environment,
  );
}
