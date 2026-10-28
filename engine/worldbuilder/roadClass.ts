/**
 * One road class as generators see it: the region profile's spec, or a
 * class default when the profile has none (World Builder plan v0.4 §5.2).
 * Dependency-free.
 */
import type { RegionProfile } from "./regionProfile";
import type { RoadClass } from "./vocabulary";

export interface ResolvedRoadClass {
  /** Full width: carriageway + both shoulders, metres. */
  width: number;
  maxSlopeDeg: number;
  minTurnRadius: number;
  surfaceLayer?: string;
  meshAsset?: string;
  /** false: the region profile has no spec for the class; the values are defaults. */
  specified: boolean;
}

const DEFAULTS: Record<RoadClass, { width: number; maxSlopeDeg: number; minTurnRadius: number }> = {
  highway: { width: 12, maxSlopeDeg: 6, minTurnRadius: 200 },
  arterial: { width: 9, maxSlopeDeg: 8, minTurnRadius: 100 },
  collector: { width: 7, maxSlopeDeg: 10, minTurnRadius: 30 },
  local: { width: 5, maxSlopeDeg: 14, minTurnRadius: 12 },
  track: { width: 3.5, maxSlopeDeg: 20, minTurnRadius: 8 },
  path: { width: 1.5, maxSlopeDeg: 30, minTurnRadius: 2 },
};

export function resolveRoadClass(profile: RegionProfile | null, roadClass: RoadClass): ResolvedRoadClass {
  const spec = profile?.roads[roadClass];
  if (!spec) return { ...DEFAULTS[roadClass], specified: false };
  return {
    width: spec.width + 2 * spec.shoulder,
    maxSlopeDeg: spec.maxSlopeDeg,
    minTurnRadius: spec.minTurnRadius,
    ...(spec.surfaceLayer ? { surfaceLayer: spec.surfaceLayer } : {}),
    ...(spec.meshAsset ? { meshAsset: spec.meshAsset } : {}),
    specified: true,
  };
}

/** Full road width of a class. */
export function roadClassWidth(profile: RegionProfile | null, roadClass: RoadClass): number {
  return resolveRoadClass(profile, roadClass).width;
}
