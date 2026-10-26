import type { LayoutLakeWaterBody } from "./layout";
import { validateLakeBed } from "./lakeBed";
import { RIVER_WATER_DEFAULTS } from "./riverWater";

export const LAKE_LIMITS = { bodies: 8, cells: 65536, totalCells: 262144, tiles: 16,
  decodeBytes: 32 * 1024 ** 2, geometryBytes: 16 * 1024 ** 2 } as const;

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
    const ranges = { opacity: [0, 1], bedVisibility: [0, 1], absorptionDistance: [0.01, 100],
      normalScale: [0.05, 20], rippleSpeed: [0, 10], reflectionStrength: [0, 1] } as const;
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
  return { deepColor: d.deepColor, shallowColor: d.shallowColor, opacity: d.opacity,
    bedVisibility: d.bedVisibility, absorptionDistance: d.absorptionDistance, normalTexture: d.normalTexture,
    normalScale: d.normalScale, rippleSpeed: 0.15, reflectionMode: "off" as "off" | "sharedPlanar",
    reflectionGroup: "water", reflectionQuality: "medium" as "low" | "medium" | "high",
    reflectionStrength: d.reflectionStrength, ...lake.appearance };
}
