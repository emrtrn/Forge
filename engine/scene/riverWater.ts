import { resolveWaterCrestFoam, type WaterCrestFoamSettings } from "./waterCrestFoam";
import { validateWaterContactFoam, type WaterContactFoam } from "./waterContactFoam";
import { validateLakeGeometryFoam, type LakeGeometryFoam } from "./lakeFoamBake";
import { validateWaterCaustics, type WaterCaustics } from "./waterCaustics";
import { validateWaterShoreWetness, type WaterShoreWetness } from "./waterShoreWetness";
import type {
  LayoutRiverWater,
  LayoutRiverWaterFoamStamp,
  LayoutRiverWaterSegmentProfile,
} from "./layout";

/** Resolved presentation settings for a spline-driven River Water Body. */
export interface ResolvedRiverWater extends Required<WaterCrestFoamSettings> {
  shoreWetness?: WaterShoreWetness;
  geometryFoam?: LakeGeometryFoam;
  caustics?: WaterCaustics;
  id: string;
  name: string;
  hidden: boolean;
  landscapeRef: string;
  splineRef: string;
  coordinateSpace?: "world";
  surfaceLevel: number;
  widthScale: number;
  flowSpeed: number;
  surfaceStrength: number;
  surfaceRoughness: number;
  refractionStrength: number;
  normalScale: number;
  normalTexture: string;
  deepColor: string;
  shallowColor: string;
  opacity: number;
  bedVisibility: number;
  absorptionDistance: number;
  waveAmplitude: number;
  waveLength: number;
  foamColor: string;
  foamOpacity: number;
  shoreWaveSpacing: number;
  shoreWaveSpeed: number;
  shoreWaveReach: number;
  shoreWaveBreakupScale: number;
  contactFoam?: WaterContactFoam;
  foamStamps: readonly LayoutRiverWaterFoamStamp[];
  segmentProfiles: readonly LayoutRiverWaterSegmentProfile[];
  reflectionMode: "off" | "environment";
  reflectionGroup: string | null;
  reflectionQuality: "low" | "medium" | "high";
  reflectionStrength: number;
}

export const RIVER_WATER_DEFAULTS: ResolvedRiverWater = {
  ...resolveWaterCrestFoam({}),
  id: "river-water",
  name: "River Water",
  hidden: false,
  landscapeRef: "",
  splineRef: "",
  surfaceLevel: 0,
  widthScale: 1,
  flowSpeed: 0.35,
  surfaceStrength: 2,
  surfaceRoughness: 0.2,
  refractionStrength: 0.65,
  normalScale: 1,
  normalTexture: "t-water-n",
  deepColor: "#164c50",
  shallowColor: "#76b6a6",
  opacity: 0.65,
  bedVisibility: 0.88,
  absorptionDistance: 3,
  waveAmplitude: 0.04,
  waveLength: 3.5,
  foamColor: "#e8fff5",
  foamOpacity: 0.92,
  shoreWaveSpacing: 5,
  shoreWaveSpeed: 0.34,
  shoreWaveReach: 0.36,
  shoreWaveBreakupScale: 1.25,
  foamStamps: [],
  segmentProfiles: [],
  reflectionMode: "environment",
  reflectionGroup: null,
  reflectionQuality: "medium",
  // Scales the angle-dependent Fresnel reflection and fades it under visible
  // foam. The default remains subtle head-on and stronger at grazing angles.
  reflectionStrength: 0.34,
};

/** Shared read/save guard for the River micro surface. Never coerces bad data. */
export function resolveRiverSurface(actor: Pick<LayoutRiverWater, "surfaceStrength" | "surfaceRoughness" | "refractionStrength">) {
  for (const [key, min, max] of [["surfaceStrength", 0, 2], ["surfaceRoughness", 0.04, 1], ["refractionStrength", 0, 2]] as const) {
    const value = actor[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)) {
      throw new Error(`river water ${key} must be a finite number in ${min}..${max}`);
    }
  }
  return {
    surfaceStrength: actor.surfaceStrength ?? RIVER_WATER_DEFAULTS.surfaceStrength,
    surfaceRoughness: actor.surfaceRoughness ?? RIVER_WATER_DEFAULTS.surfaceRoughness,
    refractionStrength: actor.refractionStrength ?? RIVER_WATER_DEFAULTS.refractionStrength,
  };
}

/** Fills optional River Water Body presentation fields without inspecting the spline. */
export function resolveRiverWater(actor: LayoutRiverWater | null | undefined): ResolvedRiverWater {
  const defaults = RIVER_WATER_DEFAULTS;
  return {
    id: actor?.id ?? defaults.id,
    name: actor?.name?.trim() || defaults.name,
    hidden: actor?.hidden === true,
    landscapeRef: actor?.landscapeRef ?? defaults.landscapeRef,
    splineRef: actor?.splineRef ?? defaults.splineRef,
    ...(actor?.coordinateSpace === "world" ? { coordinateSpace: "world" as const } : {}),
    surfaceLevel: actor?.surfaceLevel ?? defaults.surfaceLevel,
    widthScale: actor?.widthScale ?? defaults.widthScale,
    flowSpeed: actor?.flowSpeed ?? defaults.flowSpeed,
    ...resolveRiverSurface(actor ?? {}),
    ...resolveWaterCrestFoam(actor ?? {}),
    normalScale: actor?.normalScale ?? defaults.normalScale,
    normalTexture: actor?.normalTexture?.trim() || defaults.normalTexture,
    deepColor: actor?.deepColor ?? defaults.deepColor,
    shallowColor: actor?.shallowColor ?? defaults.shallowColor,
    opacity: actor?.opacity ?? defaults.opacity,
    bedVisibility: actor?.bedVisibility ?? defaults.bedVisibility,
    absorptionDistance: actor?.absorptionDistance ?? defaults.absorptionDistance,
    waveAmplitude: actor?.waveAmplitude ?? defaults.waveAmplitude,
    waveLength: actor?.waveLength ?? defaults.waveLength,
    foamColor: actor?.foamColor ?? defaults.foamColor,
    foamOpacity: actor?.foamOpacity ?? defaults.foamOpacity,
    shoreWaveSpacing: actor?.shoreWaveSpacing ?? defaults.shoreWaveSpacing,
    shoreWaveSpeed: actor?.shoreWaveSpeed ?? defaults.shoreWaveSpeed,
    shoreWaveReach: actor?.shoreWaveReach ?? defaults.shoreWaveReach,
    shoreWaveBreakupScale: actor?.shoreWaveBreakupScale ?? defaults.shoreWaveBreakupScale,
    ...(actor?.contactFoam ? { contactFoam: validateWaterContactFoam(actor.contactFoam) } : {}),
    ...(actor?.geometryFoam ? { geometryFoam: validateLakeGeometryFoam(actor.geometryFoam) } : {}),
    ...(actor?.caustics ? { caustics: validateWaterCaustics(actor.caustics) } : {}),
    ...(actor?.shoreWetness ? { shoreWetness: validateWaterShoreWetness(actor.shoreWetness) } : {}),
    foamStamps: actor?.foamStamps?.map((stamp) => ({
      ...stamp,
      position: [...stamp.position],
      ...(stamp.endPosition ? { endPosition: [...stamp.endPosition] } : {}),
    })) ?? defaults.foamStamps,
    segmentProfiles: actor?.segmentProfiles?.map((profile) => ({ ...profile })) ?? defaults.segmentProfiles,
    reflectionMode: actor?.reflectionMode === "off" ? "off" : defaults.reflectionMode,
    reflectionGroup: actor?.reflectionGroup?.trim() || null,
    reflectionQuality: actor?.reflectionQuality === "low" || actor?.reflectionQuality === "high"
      ? actor.reflectionQuality
      : defaults.reflectionQuality,
    reflectionStrength: actor?.reflectionStrength ?? defaults.reflectionStrength,
  };
}

export function uniqueRiverWaterId(waters: readonly LayoutRiverWater[]): string {
  const ids = new Set(waters.map((water) => water.id));
  let index = 1;
  while (ids.has(`river-water-${index}`)) index += 1;
  return `river-water-${index}`;
}

/**
 * Legacy API: rivers never lease planar targets. Keep old callers source-compatible.
 */
export function riverWaterReflectionGroupKey(
  _water: Pick<ResolvedRiverWater, "reflectionMode" | "reflectionGroup" | "reflectionQuality">,
  _worldPlaneY: number,
): string | null {
  return null;
}
