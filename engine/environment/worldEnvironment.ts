import type { LayoutWorldEnvironment } from "../scene/layout";

/**
 * World Environment (WES) data contract: the season / weather / time-of-day
 * singleton actor's types, defaults and the one normalizer both the loader and
 * the save validator use (WES v0.3 §5.1–5.2).
 *
 * Kept free of three.js so editor core, the save validator and node tests can
 * read it. The actor stores **level defaults** only; the live clock, weather
 * and season are runtime state (editor preview or the Play capability) and are
 * never written back here.
 *
 * Identity rule: `season: "summer"`, `weather.preset: "clear"` and a zero
 * `surface` leave the authored look untouched, so an actor at its defaults only
 * places the sun by the clock.
 */

export type Season = "spring" | "summer" | "autumn" | "winter";
export type WeatherPreset = "clear" | "cloudy" | "rain" | "snow" | "fog";

export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];
export const WEATHER_PRESETS: readonly WeatherPreset[] = ["clear", "cloudy", "rain", "snow", "fog"];

export interface ResolvedWorldEnvironment {
  name: string;
  hidden: boolean;
  time: { hour: number; dayLengthMinutes: number };
  sunPath: { azimuthDeg: number; noonElevationDeg: number; sunriseHour: number; sunsetHour: number };
  night: { moonIntensity: number; moonColor: string; ambientFloor: number };
  season: Season;
  weather: { preset: WeatherPreset; intensity: number };
  surface: {
    snowCoverage: number;
    wetness: number;
    winterSnowCoverage: number;
    snowColor: string;
    snowSlopeStartDeg: number;
    snowSlopeEndDeg: number;
    snowMinAltitude: number | null;
    snowAltitudeBlend: number;
  };
}

export const WORLD_ENVIRONMENT_DEFAULTS: ResolvedWorldEnvironment = {
  name: "World Environment",
  hidden: false,
  time: { hour: 12, dayLengthMinutes: 0 },
  sunPath: { azimuthDeg: 180, noonElevationDeg: 60, sunriseHour: 6, sunsetHour: 18 },
  night: { moonIntensity: 0.08, moonColor: "#9fb4ff", ambientFloor: 0.15 },
  season: "summer",
  weather: { preset: "clear", intensity: 1 },
  surface: {
    snowCoverage: 0,
    wetness: 0,
    winterSnowCoverage: 0.6,
    snowColor: "#f2f5fa",
    snowSlopeStartDeg: 30,
    snowSlopeEndDeg: 55,
    snowMinAltitude: null,
    snowAltitudeBlend: 20,
  },
};

/** Fills every field with its default; `null`/`undefined` reads all defaults. */
export function resolveWorldEnvironment(
  actor: LayoutWorldEnvironment | null | undefined,
): ResolvedWorldEnvironment {
  const d = WORLD_ENVIRONMENT_DEFAULTS;
  const a = actor ?? {};
  return {
    name: a.name ?? d.name,
    hidden: a.hidden ?? d.hidden,
    time: { ...d.time, ...a.time },
    sunPath: { ...d.sunPath, ...a.sunPath },
    night: { ...d.night, ...a.night },
    season: a.season ?? d.season,
    weather: { ...d.weather, ...a.weather },
    surface: { ...d.surface, ...a.surface },
  };
}

export interface WorldEnvironmentNormalization {
  /** The sparse, canonical actor; null when the input was not an object. */
  environment: LayoutWorldEnvironment | null;
  /** Fields that were repaired (unknown enum, clamped number, bad color). The level still loads. */
  warnings: string[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * The single source of field shape for `layout.worldEnvironment` (loader and
 * `/__save-layout` both run it). Only authored fields survive, so an actor at
 * its defaults stays `{}`; numbers are clamped and rounded, an unknown enum
 * falls back to its default (dropped) and every repair is reported as a
 * warning instead of failing the load. Unknown keys are simply not copied — the
 * save path reports them through `dropped[]`.
 */
export function normalizeWorldEnvironment(value: unknown): WorldEnvironmentNormalization {
  const warnings: string[] = [];
  if (!isRecord(value)) {
    return { environment: null, warnings: ["worldEnvironment must be an object"] };
  }
  const out: LayoutWorldEnvironment = {};
  if (typeof value.name === "string" && value.name.length > 0) out.name = value.name;
  if (value.hidden === true) out.hidden = true;

  const num = (input: unknown, label: string, min: number, max: number, decimals = 3): number | undefined => {
    if (input === undefined) return undefined;
    const n = Number(input);
    if (typeof input === "boolean" || input === null || !Number.isFinite(n)) {
      warnings.push(`worldEnvironment.${label}: ${String(input)} is not a number; using the default`);
      return undefined;
    }
    const clamped = Math.min(max, Math.max(min, n));
    if (clamped !== n) warnings.push(`worldEnvironment.${label}: ${n} clamped to ${clamped}`);
    return Number(clamped.toFixed(decimals));
  };
  const color = (input: unknown, label: string): string | undefined => {
    if (input === undefined) return undefined;
    if (typeof input === "string" && HEX_COLOR.test(input)) return input.toLowerCase();
    warnings.push(`worldEnvironment.${label}: ${String(input)} is not a #rrggbb color; using the default`);
    return undefined;
  };
  const group = (key: string): Record<string, unknown> | null => {
    const raw = value[key];
    if (raw === undefined) return null;
    if (!isRecord(raw)) {
      warnings.push(`worldEnvironment.${key} must be an object; using the defaults`);
      return null;
    }
    return raw;
  };
  const assign = <T extends object>(target: T, key: keyof T, v: unknown): void => {
    if (v !== undefined) (target as Record<string, unknown>)[key as string] = v;
  };

  const time = group("time");
  if (time) {
    const next: NonNullable<LayoutWorldEnvironment["time"]> = {};
    const hour = num(time.hour, "time.hour", 0, 24);
    assign(next, "hour", hour === undefined ? undefined : hour >= 24 ? 0 : hour);
    assign(next, "dayLengthMinutes", num(time.dayLengthMinutes, "time.dayLengthMinutes", 0, 1440));
    if (Object.keys(next).length > 0) out.time = next;
  }

  const sunPath = group("sunPath");
  if (sunPath) {
    const next: NonNullable<LayoutWorldEnvironment["sunPath"]> = {};
    const azimuth = num(sunPath.azimuthDeg, "sunPath.azimuthDeg", -360, 360);
    assign(next, "azimuthDeg", azimuth === undefined ? undefined : Number(wrapDegrees(azimuth).toFixed(3)) % 360);
    assign(next, "noonElevationDeg", num(sunPath.noonElevationDeg, "sunPath.noonElevationDeg", 5, 90));
    assign(next, "sunriseHour", num(sunPath.sunriseHour, "sunPath.sunriseHour", 0, 23.5));
    assign(next, "sunsetHour", num(sunPath.sunsetHour, "sunPath.sunsetHour", 0.5, 24));
    const sunrise = next.sunriseHour ?? WORLD_ENVIRONMENT_DEFAULTS.sunPath.sunriseHour;
    const sunset = next.sunsetHour ?? WORLD_ENVIRONMENT_DEFAULTS.sunPath.sunsetHour;
    if (sunset - sunrise < 0.5) {
      warnings.push(`worldEnvironment.sunPath: sunset ${sunset} must be at least 0.5 h after sunrise ${sunrise}; using the default day`);
      delete next.sunriseHour;
      delete next.sunsetHour;
    }
    if (Object.keys(next).length > 0) out.sunPath = next;
  }

  const night = group("night");
  if (night) {
    const next: NonNullable<LayoutWorldEnvironment["night"]> = {};
    assign(next, "moonIntensity", num(night.moonIntensity, "night.moonIntensity", 0, 2));
    assign(next, "moonColor", color(night.moonColor, "night.moonColor"));
    assign(next, "ambientFloor", num(night.ambientFloor, "night.ambientFloor", 0, 1));
    if (Object.keys(next).length > 0) out.night = next;
  }

  if (value.season !== undefined) {
    if (SEASONS.includes(value.season as Season)) out.season = value.season as Season;
    else warnings.push(`worldEnvironment.season: unknown season ${String(value.season)}; using "${WORLD_ENVIRONMENT_DEFAULTS.season}"`);
  }

  const weather = group("weather");
  if (weather) {
    const next: NonNullable<LayoutWorldEnvironment["weather"]> = {};
    if (weather.preset !== undefined) {
      if (WEATHER_PRESETS.includes(weather.preset as WeatherPreset)) next.preset = weather.preset as WeatherPreset;
      else warnings.push(`worldEnvironment.weather.preset: unknown preset ${String(weather.preset)}; using "${WORLD_ENVIRONMENT_DEFAULTS.weather.preset}"`);
    }
    assign(next, "intensity", num(weather.intensity, "weather.intensity", 0, 1));
    if (Object.keys(next).length > 0) out.weather = next;
  }

  const surface = group("surface");
  if (surface) {
    const next: NonNullable<LayoutWorldEnvironment["surface"]> = {};
    assign(next, "snowCoverage", num(surface.snowCoverage, "surface.snowCoverage", 0, 1));
    assign(next, "wetness", num(surface.wetness, "surface.wetness", 0, 1));
    assign(next, "winterSnowCoverage", num(surface.winterSnowCoverage, "surface.winterSnowCoverage", 0, 1));
    assign(next, "snowColor", color(surface.snowColor, "surface.snowColor"));
    assign(next, "snowSlopeStartDeg", num(surface.snowSlopeStartDeg, "surface.snowSlopeStartDeg", 0, 90));
    assign(next, "snowSlopeEndDeg", num(surface.snowSlopeEndDeg, "surface.snowSlopeEndDeg", 0, 90));
    if (surface.snowMinAltitude === null) next.snowMinAltitude = null;
    else assign(next, "snowMinAltitude", num(surface.snowMinAltitude, "surface.snowMinAltitude", -100000, 100000));
    assign(next, "snowAltitudeBlend", num(surface.snowAltitudeBlend, "surface.snowAltitudeBlend", 0, 10000));
    if (Object.keys(next).length > 0) out.surface = next;
  }

  return { environment: out, warnings };
}

/** Wraps degrees into [0, 360). */
export function wrapDegrees(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped >= 360 ? 0 : wrapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
