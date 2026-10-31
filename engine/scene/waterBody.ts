import { resolveWaterCrestFoam, validateWaterCrestFoam } from "./waterCrestFoam";
import { validateLakeGeometryFoam } from "./lakeFoamBake";
import { validateWaterContactFoam } from "./waterContactFoam";
import type { LayoutLakeWaterBody } from "./layout";
import { validateLakeBed } from "./lakeBed";
import { RIVER_WATER_DEFAULTS } from "./riverWater";

export const LAKE_LIMITS = { bodies: 8, cells: 65536, totalCells: 262144, tiles: 16,
  decodeBytes: 32 * 1024 ** 2, geometryBytes: 16 * 1024 ** 2 } as const;

export const LAKE_WHEEL_RIPPLE_DEFAULTS = {
  wheelRipplesEnabled: true, wheelRippleStrength: 2, wheelRippleSpeed: 1.8,
  wheelRippleWidth: .45, wheelRippleWavelength: .35, wheelRippleLifetime: 1.6, wheelRippleInterval: .12,
};
/**
 * Wet tyre prints a vehicle leaves after driving out of the Lake (or off its
 * wet shore): the trail's length, its first print's wetness and the seconds a
 * print takes to dry. Rut puddles use the same values.
 */
export const LAKE_WHEEL_WET_TRAIL_DEFAULTS = {
  wheelWetTrailEnabled: true, wheelWetTrailLength: 5, wheelWetTrailStrength: 1, wheelWetTrailDrySeconds: 40,
};
export const LAKE_SURFACE_WAVE_DEFAULTS = { surfaceWavesEnabled: true, surfaceWaveHeight: .02,
  surfaceWaveLength: 12, surfaceWavePeriod: 5, surfaceWaveDirection: 30, surfaceWaveShoreDepth: .5 };

/** Hard limits of numeric Lake appearance fields: the save allowlist rejects
 * values outside them and the editor shows them as each field's range. */
export const LAKE_APPEARANCE_RANGES = { opacity: [0, 1], bedVisibility: [0, 1], absorptionDistance: [0.01, 100],
  surfaceStrength: [0, 2], surfaceRoughness: [0.04, 1], normalScale: [0.05, 20], rippleSpeed: [0, 10], reflectionStrength: [0, 1],
  refractionStrength: [0, 2],
  surfaceWaveHeight: [0, .1], surfaceWaveLength: [6, 40], surfaceWavePeriod: [2, 12],
  surfaceWaveDirection: [0, 360], surfaceWaveShoreDepth: [.1, 2],
  wheelRippleStrength: [0, 6], wheelRippleSpeed: [0.2, 5], wheelRippleWidth: [0.1, 2],
  wheelRippleWavelength: [0.1, 2], wheelRippleLifetime: [0.2, 4], wheelRippleInterval: [0.04, 1],
  wheelWetTrailLength: [0.5, 10], wheelWetTrailStrength: [0, 1], wheelWetTrailDrySeconds: [5, 180],
  shoreWetnessWidth: [0.2, 4], shoreWetnessStrength: [0, 1], shoreBlendDepth: [0, 2], foamOpacity: [0, 1], foamWidth: [0.2, 4], foamScale: [0.1, 10], foamSpeed: [0, 3],
  causticsStrength: [0, 3], causticsScale: [0.1, 10], causticsSpeed: [0, 3], causticsDepthFade: [0.1, 30] } as const;

/** Initial editor appearance, based on the accepted Terrain / Lake 1 settings.
 * Kept separate from runtime fallbacks so older saved Lakes retain their look. */
export function createLakeAppearance(): NonNullable<LayoutLakeWaterBody["appearance"]> {
  return {
    ...LAKE_SURFACE_WAVE_DEFAULTS,
    shoreWetnessEnabled: true, foamEnabled: true, causticsEnabled: true,
    absorptionDistance: 2, surfaceStrength: 2, surfaceRoughness: .2, refractionStrength: .65, normalScale: 1, rippleSpeed: 2,
    wheelRipplesEnabled: true, wheelRippleStrength: 3, wheelRippleSpeed: 1.8,
    wheelRippleWidth: 1, wheelRippleWavelength: .6, wheelRippleLifetime: 4, wheelRippleInterval: .12,
    ...LAKE_WHEEL_WET_TRAIL_DEFAULTS,
    foamScale: 2, foamSpeed: 2, causticsStrength: 1, causticsScale: 1,
    causticsSpeed: 2, causticsDepthFade: 1, reflectionMode: "sharedPlanar", reflectionQuality: "medium",
  };
}

/** Shared runtime/save allowlist. Keep source coordinates at full JSON precision. */
export function validateWaterBody(value: unknown): LayoutLakeWaterBody {
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Lake must be an object");
    return v as Record<string, unknown>;
  };
  const number = (v: unknown): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Lake requires finite numbers");
    return v;
  };
  const tuple = (v: unknown): [number, number] => {
    if (!Array.isArray(v) || v.length !== 2) throw new Error("Lake requires XZ pairs");
    return [number(v[0]), number(v[1])];
  };
  const input = record(value);
  if (input.schema !== 1 || input.kind !== "lake" || input.mode !== "fillExisting" || input.coordinateSpace !== "world") {
    throw new Error("Unsupported Lake schema/kind/mode/coordinateSpace");
  }
  for (const key of ["id", "terrainRef"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 256) throw new Error(`Invalid Lake ${key}`);
  }
  const bounds = record(input.bounds), min = tuple(bounds.min), max = tuple(bounds.max), seed = tuple(input.seed);
  if (!(min[0] < seed[0] && seed[0] < max[0] && min[1] < seed[1] && seed[1] < max[1])) throw new Error("Lake seed must be inside bounds");
  const out: LayoutLakeWaterBody = { schema: 1, kind: "lake", mode: "fillExisting", coordinateSpace: "world",
    id: input.id as string, terrainRef: input.terrainRef as string, bounds: { min, max }, seed, surfaceLevel: number(input.surfaceLevel) };
  if (input.geometryFoam !== undefined) out.geometryFoam = validateLakeGeometryFoam(input.geometryFoam);
  if (input.contactFoam !== undefined) out.contactFoam = validateWaterContactFoam(input.contactFoam);
  if (input.bed !== undefined) out.bed = validateLakeBed(input.bed);
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.length > 256) throw new Error("Invalid Lake name");
    out.name = input.name;
  }
  for (const key of ["hidden", "locked"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") throw new Error(`Invalid Lake ${key}`);
      out[key] = input[key];
    }
  }
  if (input.appearance !== undefined) {
    const source = record(input.appearance), appearance: NonNullable<LayoutLakeWaterBody["appearance"]> = {};
    for (const key of ["deepColor", "shallowColor"] as const) {
      if (source[key] !== undefined) {
        if (typeof source[key] !== "string" || !/^#[\da-f]{6}$/i.test(source[key])) throw new Error(`Invalid Lake ${key}`);
        appearance[key] = source[key];
      }
    }
    if (source.surfaceWavesEnabled !== undefined) {
      if (typeof source.surfaceWavesEnabled !== "boolean") throw new Error("Invalid Lake surfaceWavesEnabled");
      appearance.surfaceWavesEnabled = source.surfaceWavesEnabled;
    }
    if (source.wheelRipplesEnabled !== undefined) {
      if (typeof source.wheelRipplesEnabled !== "boolean") throw new Error("Invalid Lake wheelRipplesEnabled");
      appearance.wheelRipplesEnabled = source.wheelRipplesEnabled;
    }
    if (source.wheelWetTrailEnabled !== undefined) {
      if (typeof source.wheelWetTrailEnabled !== "boolean") throw new Error("Invalid Lake wheelWetTrailEnabled");
      appearance.wheelWetTrailEnabled = source.wheelWetTrailEnabled;
    }
    if (source.shoreWetnessEnabled !== undefined) {
      if (typeof source.shoreWetnessEnabled !== "boolean") throw new Error("Invalid Lake shoreWetnessEnabled");
      appearance.shoreWetnessEnabled = source.shoreWetnessEnabled;
    }
    if (source.foamEnabled !== undefined) {
      if (typeof source.foamEnabled !== "boolean") throw new Error("Invalid Lake foamEnabled");
      appearance.foamEnabled = source.foamEnabled;
    }
    if (source.causticsEnabled !== undefined) {
      if (typeof source.causticsEnabled !== "boolean") throw new Error("Invalid Lake causticsEnabled");
      appearance.causticsEnabled = source.causticsEnabled;
    }
    const ranges = LAKE_APPEARANCE_RANGES;
    for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) if (source[key] !== undefined) {
      const v = number(source[key]);
      if (v < ranges[key][0] || v > ranges[key][1]) throw new Error(`Invalid Lake ${key}`);
      appearance[key] = v;
    }
    for (const key of ["normalTexture", "reflectionGroup"] as const) if (source[key] !== undefined) {
      if (typeof source[key] !== "string" || source[key].length > 256) throw new Error(`Invalid Lake ${key}`);
      appearance[key] = source[key];
    }
    if (source.reflectionMode !== undefined) {
      if (source.reflectionMode !== "off" && source.reflectionMode !== "sharedPlanar") throw new Error("Invalid Lake reflectionMode");
      appearance.reflectionMode = source.reflectionMode;
    }
    if (source.reflectionQuality !== undefined) {
      if (!["low", "medium", "high"].includes(String(source.reflectionQuality))) throw new Error("Invalid Lake reflectionQuality");
      appearance.reflectionQuality = source.reflectionQuality as "low" | "medium" | "high";
    }
    Object.assign(appearance, validateWaterCrestFoam(source));
    out.appearance = appearance;
  }
  return out;
}

export function validateWaterBodies(value: unknown): LayoutLakeWaterBody[] {
  if (!Array.isArray(value) || value.length > LAKE_LIMITS.bodies) throw new Error("waterBodies must contain at most 8 Lakes");
  const ids = new Set<string>();
  return value.map((entry) => {
    const lake = validateWaterBody(entry);
    if (ids.has(lake.id)) throw new Error(`Duplicate Lake id ${lake.id}`);
    ids.add(lake.id); return lake;
  });
}

export function resolveLakeAppearance(lake: LayoutLakeWaterBody) {
  const d = RIVER_WATER_DEFAULTS;
  return { deepColor: "#234f4b", shallowColor: "#779a82", opacity: 0.35,
    bedVisibility: 0.9, absorptionDistance: 4, normalTexture: d.normalTexture,
    surfaceStrength: 1, surfaceRoughness: 0.22, refractionStrength: .65, normalScale: d.normalScale, rippleSpeed: 0.15, reflectionMode: "off" as "off" | "sharedPlanar",
    reflectionGroup: "water", reflectionQuality: "medium" as "low" | "medium" | "high", ...LAKE_WHEEL_RIPPLE_DEFAULTS, ...LAKE_SURFACE_WAVE_DEFAULTS,
    ...LAKE_WHEEL_WET_TRAIL_DEFAULTS, shoreWetnessEnabled: false, shoreWetnessWidth: 1, shoreWetnessStrength: 0.65,
    shoreBlendDepth: 0.25, foamEnabled: false, foamOpacity: 0.7, foamWidth: 1, foamScale: 0.8, foamSpeed: 0.3,
    reflectionStrength: d.reflectionStrength, causticsEnabled: false, causticsStrength: 1,
    causticsScale: 1.5, causticsSpeed: 0.25, causticsDepthFade: 4, ...lake.appearance, ...resolveWaterCrestFoam(lake.appearance ?? {}) };
}
