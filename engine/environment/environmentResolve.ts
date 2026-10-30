import type { ResolvedCloudLayer } from "../scene/cloudLayer";
import type { ResolvedHeightFog } from "../scene/heightFog";
import type { Vec3 } from "../scene/layout";
import { evaluateSunLight, hexToLinear, lerp } from "./sunPath";
import { weatherFactors } from "./weatherPresets";
import type { ResolvedWorldEnvironment, Season, WeatherPreset } from "./worldEnvironment";

/**
 * (authored actors + runtime state) → what the frame should render (WES v0.3
 * §4.2). Pure and deterministic, so the editor viewport and Play resolve the
 * same picture from the same inputs, and node tests can pin it.
 *
 * WES never writes the authored actors (§4.4): the output is an *override* the
 * render binding applies to the three objects, and `null` from the caller (no
 * actor, or a hidden one) means "render exactly what is authored".
 */

/** The live, non-persisted environment: editor preview or the Play capability (§5.6). */
export interface WorldEnvironmentState {
  hour: number;
  season: Season;
  weather: { preset: WeatherPreset; intensity: number };
  surface: { snowCoverage: number; wetness: number };
}

/** The authored values WES adjusts, already resolved from their layout actors. */
export interface AuthoredEnvironmentInputs {
  /** The Sun (directional) light's authored color and intensity; null when the level has none. */
  sun: { color: string; intensity: number } | null;
  sky: { turbidity: number; hidden: boolean } | null;
  fog: ResolvedHeightFog | null;
  cloud: ResolvedCloudLayer | null;
}

export interface ResolvedEnvironment {
  /** True ground → sun direction for the sky dome and the IBL capture (negative y at night). */
  sunDirection: Vec3;
  sunElevationDeg: number;
  /** Override of the Sun light's three object; null when the level has no Sun. */
  light: { direction: Vec3; color: Vec3; intensity: number; isMoon: boolean } | null;
  /** Multiplier of the authored ambient (world settings) intensity. */
  ambientMultiplier: number;
  /** Sky turbidity to render; null when there is no (visible) sky. */
  skyTurbidity: number | null;
  /** The fog to render in place of the authored one; null when there is none. */
  fog: ResolvedHeightFog | null;
  /** The cloud layer to render in place of the authored one; null when there is none. */
  cloud: ResolvedCloudLayer | null;
  /** Multiplier of the tone-mapping exposure (night eye adaptation). */
  exposureMultiplier: number;
  season: Season;
  surface: WorldEnvironmentState["surface"];
  /** Changes when the IBL must be recaptured regardless of the sun angle (§6.4). */
  captureKey: string;
}

const NIGHT_FOG_SCALE = 0.1;
const NIGHT_CLOUD_SCALE = 0.12;
const NIGHT_EXPOSURE = 1.35;
const TWILIGHT_FOG_TINT = "#ffb27a";
const TWILIGHT_CLOUD_TINT = "#ffc59a";

/** The level defaults as the initial runtime state (editor reset, Play start). */
export function stateFromDefaults(env: ResolvedWorldEnvironment): WorldEnvironmentState {
  return {
    hour: env.time.hour,
    season: env.season,
    weather: { ...env.weather },
    surface: { snowCoverage: env.surface.snowCoverage, wetness: env.surface.wetness },
  };
}

export function resolveEnvironment(
  authored: AuthoredEnvironmentInputs,
  env: ResolvedWorldEnvironment,
  state: WorldEnvironmentState,
): ResolvedEnvironment {
  const sun = evaluateSunLight(state.hour, env);
  const weather = weatherFactors(state.weather.preset, state.weather.intensity);

  let light: ResolvedEnvironment["light"] = null;
  if (authored.sun) {
    const authoredColor = hexToLinear(authored.sun.color);
    light = {
      direction: sun.lightDirection,
      color: sun.isMoon
        ? sun.color
        : [authoredColor[0] * sun.color[0], authoredColor[1] * sun.color[1], authoredColor[2] * sun.color[2]],
      intensity: authored.sun.intensity * sun.intensityFactor * weather.sunIntensityMultiplier,
      isMoon: sun.isMoon,
    };
  }

  let fog: ResolvedHeightFog | null = null;
  if (authored.fog) {
    const f = authored.fog;
    const weathered = mixHex(f.color, weather.fogTint, weather.fogTintMix);
    const lit = scaleHex(weathered, lerp(NIGHT_FOG_SCALE, 1, sun.daylight));
    const density = weather.fogDensityMultiplier;
    fog = {
      ...f,
      color: mixHex(lit, TWILIGHT_FOG_TINT, 0.35 * sun.twilightWarmth),
      density: f.density * density,
      start: f.start / density,
      end: f.end / density,
    };
  }

  let cloud: ResolvedCloudLayer | null = null;
  if (authored.cloud) {
    const c = authored.cloud;
    const coverage = weather.cloudCoverageMin === null
      ? c.coverage
      : lerp(c.coverage, Math.max(c.coverage, weather.cloudCoverageMin), weather.weight);
    const lit = scaleHex(c.color, lerp(NIGHT_CLOUD_SCALE, 1, sun.daylight));
    cloud = { ...c, coverage, color: mixHex(lit, TWILIGHT_CLOUD_TINT, 0.4 * sun.twilightWarmth) };
  }

  return {
    sunDirection: sun.sunDirection,
    sunElevationDeg: sun.sunElevationDeg,
    light,
    ambientMultiplier: Math.max(env.night.ambientFloor, sun.daylight),
    skyTurbidity: authored.sky && !authored.sky.hidden ? authored.sky.turbidity + weather.skyTurbidityAdd : null,
    fog,
    cloud,
    exposureMultiplier: lerp(NIGHT_EXPOSURE, 1, sun.daylight),
    season: state.season,
    surface: { ...state.surface },
    captureKey: `${state.weather.preset}:${round3(weather.weight)}:${state.season}`,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mixes two `#rrggbb` colors (sRGB, `t` 0 = a). Exact for t = 0. */
export function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
}

/** Scales a `#rrggbb` color's brightness. Exact for s = 1. */
export function scaleHex(hex: string, s: number): string {
  if (s === 1) return hex;
  const c = parseHex(hex);
  return toHex([c[0] * s, c[1] * s, c[2] * s]);
}
