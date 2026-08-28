import type {
  LayoutRiverWater,
  LayoutRiverWaterFoamStamp,
  LayoutRiverWaterSegmentProfile,
} from "./layout";

/** Resolved presentation settings for a spline-driven River Water Body. */
export interface ResolvedRiverWater {
  id: string;
  name: string;
  hidden: boolean;
  landscapeRef: string;
  splineRef: string;
  surfaceLevel: number;
  widthScale: number;
  flowSpeed: number;
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
  foamStamps: readonly LayoutRiverWaterFoamStamp[];
  segmentProfiles: readonly LayoutRiverWaterSegmentProfile[];
  reflectionMode: "off" | "sharedPlanar";
  reflectionGroup: string | null;
  reflectionQuality: "low" | "medium" | "high";
  reflectionStrength: number;
}

export const RIVER_WATER_DEFAULTS: ResolvedRiverWater = {
  id: "river-water",
  name: "River Water",
  hidden: false,
  landscapeRef: "",
  splineRef: "",
  surfaceLevel: 0,
  widthScale: 1,
  flowSpeed: 0.35,
  normalScale: 1,
  normalTexture: "t-water-n",
  deepColor: "#063447",
  shallowColor: "#2f8b91",
  opacity: 0.82,
  // A nearly opaque default keeps the terrain bed from showing through the
  // authoring preview while retaining an explicit clear-water control.
  bedVisibility: 0.05,
  absorptionDistance: 0.5,
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
  reflectionMode: "off",
  reflectionGroup: null,
  reflectionQuality: "medium",
  // Subtle by default: the shader multiplies this by a depth term (<= 0.35) and
  // fades it under foam, so a full-strength mirror is never what an author gets
  // by only switching Mode on. Raise it per body when the reflection should read.
  reflectionStrength: 0.34,
};

/** Fills optional River Water Body presentation fields without inspecting the spline. */
export function resolveRiverWater(actor: LayoutRiverWater | null | undefined): ResolvedRiverWater {
  const defaults = RIVER_WATER_DEFAULTS;
  return {
    id: actor?.id ?? defaults.id,
    name: actor?.name?.trim() || defaults.name,
    hidden: actor?.hidden === true,
    landscapeRef: actor?.landscapeRef ?? defaults.landscapeRef,
    splineRef: actor?.splineRef ?? defaults.splineRef,
    surfaceLevel: actor?.surfaceLevel ?? defaults.surfaceLevel,
    widthScale: actor?.widthScale ?? defaults.widthScale,
    flowSpeed: actor?.flowSpeed ?? defaults.flowSpeed,
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
    foamStamps: actor?.foamStamps?.map((stamp) => ({
      ...stamp,
      position: [...stamp.position],
      ...(stamp.endPosition ? { endPosition: [...stamp.endPosition] } : {}),
    })) ?? defaults.foamStamps,
    segmentProfiles: actor?.segmentProfiles?.map((profile) => ({ ...profile })) ?? defaults.segmentProfiles,
    reflectionMode: actor?.reflectionMode === "sharedPlanar" ? "sharedPlanar" : "off",
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
 * Returns the sharing key only for enabled, non-Low planar reflection. The world
 * plane is deliberately part of the key so a mistaken author group cannot make
 * two different heights sample the same reflection camera.
 */
export function riverWaterReflectionGroupKey(
  water: Pick<ResolvedRiverWater, "reflectionMode" | "reflectionGroup" | "reflectionQuality">,
  worldPlaneY: number,
): string | null {
  if (water.reflectionMode !== "sharedPlanar" || water.reflectionQuality === "low") return null;
  return `${water.reflectionGroup ?? "river"}:${worldPlaneY.toFixed(3)}:${water.reflectionQuality}`;
}
