import { validateWaterCaustics, type WaterCaustics } from "./waterCaustics";
import { OCEAN_LIMITS } from "./oceanBudget";
export { OCEAN_LIMITS } from "./oceanBudget";
/** Ocean authoring contract. Runtime simulation/coverage never lives in a layout. */
export type OceanEdge = "west" | "east" | "north" | "south";
export type OceanReflectionMode = "off" | "environment" | "sharedPlanar";
export type OceanReflectionQuality = "medium" | "high";
export type OceanReflectionCeiling = "off" | OceanReflectionQuality;
export interface OceanWaterBody {
  schema: 1;
  kind: "ocean";
  coordinateSpace: "world";
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  terrainRef: string;
  /** Exact terrain domain. Outside it is explicitly authored offshore water. */
  bounds: { min: [number, number]; max: [number, number] };
  openEdges: OceanEdge[];
  surfaceLevel: number;
  offshoreDepth: number;
  /** Old Oceans author all exterior as sea; coasts extend only wet boundary portions. */
  offshorePolicy?: "all" | "connectedBoundary";
  /** Terminal straight river reaches whose ribbons own the water surface. */
  inlets?: string[];
  caustics?: WaterCaustics;
  waves?: { windSpeed?: number; windDirection?: number; fetchKm?: number;
    swellStrength?: number; swellDirection?: number; choppiness?: number; seed?: number };
  appearance?: { shallowColor?: string; deepColor?: string; absorptionDistance?: number;
    roughness?: number; foamStrength?: number; reflectionMode?: OceanReflectionMode;
    reflectionGroup?: string; reflectionQuality?: OceanReflectionQuality; reflectionStrength?: number };
}
export const OCEAN_WAVES = { windSpeed: 9, windDirection: 20, fetchKm: 120,
  swellStrength: .7, swellDirection: 345, choppiness: .85, seed: 1337 };
export const OCEAN_APPEARANCE = { shallowColor: "#28b5ac", deepColor: "#073448",
  absorptionDistance: 9, roughness: .16, foamStrength: .75,
  reflectionMode: "environment" as OceanReflectionMode, reflectionGroup: "water",
  reflectionQuality: "medium" as OceanReflectionQuality, reflectionStrength: 1 };

export function resolveOceanAppearance(body: OceanWaterBody) { return { ...OCEAN_APPEARANCE, ...body.appearance }; }

/** Runtime ceiling changes neither authored values nor the FFT. */
export function oceanPlanarSettings(body: OceanWaterBody, ceiling: OceanReflectionCeiling) {
  const a = resolveOceanAppearance(body);
  if (body.hidden || a.reflectionMode !== "sharedPlanar" || a.reflectionStrength <= 0 || ceiling === "off") return null;
  return { group: a.reflectionGroup, planeY: body.surfaceLevel,
    quality: (a.reflectionQuality === "high" && ceiling === "high" ? "high" : "medium") as OceanReflectionQuality };
}
const EDGES: readonly OceanEdge[] = ["west", "east", "north", "south"];
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Ocean requires an object");
  return v as Record<string, unknown>;
};
function number(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error(`Ocean requires a finite number in ${min}..${max}`);
  return v;
}
function pair(v: unknown): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new Error("Ocean requires XZ pairs");
  return [number(v[0], -1e8, 1e8), number(v[1], -1e8, 1e8)];
}
/** Shared loader/save allowlist; unknown fields are omitted for droppedFields reporting. */
export function validateOceanWater(value: unknown): OceanWaterBody {
  const v = record(value);
  if (v.schema !== 1 || v.kind !== "ocean" || v.coordinateSpace !== "world") throw new Error("Unsupported Ocean schema/kind/space");
  for (const key of ["id", "terrainRef"] as const)
    if (typeof v[key] !== "string" || !v[key].trim() || v[key].length > 256) throw new Error(`Invalid Ocean ${key}`);
  const bounds = record(v.bounds), min = pair(bounds.min), max = pair(bounds.max);
  if (min.some((x, i) => x >= max[i]!)) throw new Error("Ocean bounds must have positive area");
  if (!Array.isArray(v.openEdges) || !v.openEdges.length || v.openEdges.length > 4
    || v.openEdges.some(e => !EDGES.includes(e)) || new Set(v.openEdges).size !== v.openEdges.length)
    throw new Error("Ocean requires unique open edges");
  const out: OceanWaterBody = { schema: 1, kind: "ocean", coordinateSpace: "world", id: v.id as string,
    terrainRef: v.terrainRef as string, bounds: { min, max }, openEdges: [...v.openEdges],
    surfaceLevel: number(v.surfaceLevel, -100000, 100000), offshoreDepth: number(v.offshoreDepth, 1, 10000) };
  if (v.offshorePolicy !== undefined) {
    if (v.offshorePolicy !== "all" && v.offshorePolicy !== "connectedBoundary") throw new Error("Invalid Ocean offshorePolicy");
    out.offshorePolicy = v.offshorePolicy;
  }
  if (v.inlets !== undefined) {
    if (!Array.isArray(v.inlets) || v.inlets.length > 3 || v.inlets.some(id => typeof id !== "string" || !id.trim() || id.length > 256)
      || new Set(v.inlets).size !== v.inlets.length) throw new Error("Ocean supports at most three unique inlet spline references");
    out.inlets = [...v.inlets];
  }
  if (v.name !== undefined) {
    if (typeof v.name !== "string" || v.name.length > 256) throw new Error("Invalid Ocean name"); out.name = v.name;
  }
  for (const key of ["hidden", "locked"] as const) if (v[key] !== undefined) {
    if (typeof v[key] !== "boolean") throw new Error(`Invalid Ocean ${key}`); out[key] = v[key];
  }
  if (v.caustics !== undefined) out.caustics = validateWaterCaustics(v.caustics);
  if (v.waves !== undefined) {
    const source = record(v.waves), waves: NonNullable<OceanWaterBody["waves"]> = {};
    const ranges = { windSpeed: [1, 30], windDirection: [0, 360], fetchKm: [1, 2000],
      swellStrength: [0, 2], swellDirection: [0, 360], choppiness: [0, 1.5], seed: [0, 4294967295] } as const;
    for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) if (source[key] !== undefined)
      waves[key] = number(source[key], ranges[key][0], ranges[key][1]);
    if (waves.seed !== undefined && !Number.isInteger(waves.seed)) throw new Error("Ocean seed must be an unsigned integer");
    out.waves = waves;
  }
  if (v.appearance !== undefined) {
    const source = record(v.appearance), appearance: NonNullable<OceanWaterBody["appearance"]> = {};
    for (const key of ["shallowColor", "deepColor"] as const) if (source[key] !== undefined) {
      if (typeof source[key] !== "string" || !/^#[\da-f]{6}$/i.test(source[key])) throw new Error(`Invalid Ocean ${key}`);
      appearance[key] = source[key];
    }
    for (const [key, choices] of [["reflectionMode", ["off", "environment", "sharedPlanar"]],
      ["reflectionQuality", ["medium", "high"]]] as const) if (source[key] !== undefined) {
      if (!(choices as readonly unknown[]).includes(source[key])) throw new Error(`Invalid Ocean ${key}`);
      Object.assign(appearance, { [key]: source[key] });
    }
    if (source.reflectionGroup !== undefined) {
      if (typeof source.reflectionGroup !== "string" || !source.reflectionGroup.trim() || source.reflectionGroup.length > 256)
        throw new Error("Invalid Ocean reflectionGroup");
      appearance.reflectionGroup = source.reflectionGroup.trim();
    }
    const ranges = { absorptionDistance: [.1, 100], roughness: [.04, 1], foamStrength: [0, 2], reflectionStrength: [0, 1] } as const;
    for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) if (source[key] !== undefined)
      appearance[key] = number(source[key], ranges[key][0], ranges[key][1]);
    out.appearance = appearance;
  }
  return out;
}
export function validateOceanWaters(value: unknown): OceanWaterBody[] {
  if (!Array.isArray(value) || value.length > OCEAN_LIMITS.bodies) throw new Error("A level supports at most one Ocean");
  return value.map(validateOceanWater);
}
