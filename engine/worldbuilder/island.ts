/** Shared, deterministic shoreline for terrain, preview and generator exclusions.
 * Positive distance is land; the terrain's relief fades out before this shore. */
import type { BriefOcean, WorldBrief } from "./worldBrief";
import { metricToWorld } from "./metricFrame";
import { radialIslandDistance, radialIslandRadius } from "./islandShape";

export interface OceanContext {
  surfaceLevel: number;
  /** Coast-only opt-in: distance to 50% dry beach paint. Absent keeps legacy paint/terrain. */
  beachWidth?: number;
  /** Keep generated roads, buildings and scatter past the entire beach transition. */
  landClearance?: number;
  distance(x: number, z: number): number;
}

/** Shared coast paint, including the legacy 18..32 m transition (midpoint 25). */
export function oceanBeachWeight(ocean: OceanContext, x: number, z: number): number {
  const scale = (ocean.beachWidth ?? 25) / 25;
  const t = Math.max(0, Math.min(1, (ocean.distance(x, z) - 18 * scale) / (14 * scale)));
  return 1 - t * t * (3 - 2 * t);
}

/** Safety distance is deliberately separate from the waterline used by river mouths. */
export function oceanLandDistance(ocean: OceanContext, x: number, z: number): number {
  return ocean.distance(x, z) - (ocean.landClearance ?? 0);
}

type IslandBrief = Pick<WorldBrief, "seed" | "frame" | "ocean"> & { terrain: Pick<WorldBrief["terrain"], "island" | "coast"> };
export const SEA_SIDES = ["west", "east", "north", "south"] as const;
export type SeaSide = typeof SEA_SIDES[number];

function shorePhase(seed: number): number {
  let mixed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296 * Math.PI * 2;
}

/** The exact saved polygon's ray intersection, or the legacy seeded shoreline. */
export function islandShorePoint(brief: IslandBrief, worldAngle: number): [number, number] {
  const island = brief.terrain.island!, [cx, cz] = metricToWorld(island.center, brief.frame), phase = shorePhase(brief.seed);
  const r = island.radii ? radialIslandRadius(island.radii, -worldAngle)
    : island.radius * (1 + .07 * Math.sin(3 * worldAngle + phase) + .04 * Math.sin(5 * worldAngle - phase * 2));
  return [cx + Math.cos(worldAngle) * r, cz + Math.sin(worldAngle) * r];
}

/** A2 defaults are explicit in new briefs; existing terrain/briefs do not migrate. */
export const DEFAULT_OCEAN_SHORE_PROFILE = { shallowDistance: 35, shallowDepth: 2, deepDistance: 150 } as const;

/** C1 joins at the waterline, shelf and deep floor; independent of the dry ramp. */
export function oceanBedDepth(ocean: BriefOcean, shoreWidth: number, offshoreDistance: number): number {
  const s = Math.max(0, offshoreDistance), profile = ocean.shoreProfile;
  if (!profile) return ocean.offshoreDepth * (1 - Math.exp(-s / shoreWidth));
  const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
  if (s <= profile.shallowDistance) return profile.shallowDepth * smooth(s / profile.shallowDistance);
  return profile.shallowDepth + (ocean.offshoreDepth - profile.shallowDepth)
    * smooth((s - profile.shallowDistance) / (profile.deepDistance - profile.shallowDistance));
}

export function islandOcean(brief: IslandBrief): OceanContext | undefined {
  const island = brief.terrain.island, coast = brief.terrain.coast, ocean = brief.ocean;
  const shape = island ?? coast;
  if (!shape || !ocean) return undefined;
  const [cx, cz] = metricToWorld(shape.center, brief.frame);
  // Mix adjacent small seeds too: 11 and 12 should visibly change the coast.
  const phase = shorePhase(brief.seed);
  const polygonDistance = island?.radii ? radialIslandDistance(cx, cz, island.radii) : undefined;
  return {
    surfaceLevel: ocean.surfaceElevation - brief.frame.elevation,
    ...(coast?.beachWidth !== undefined ? { beachWidth: coast.beachWidth, landClearance: coast.beachWidth * 32 / 25 } : {}),
    distance(x, z) {
      if (coast) {
        const axis = coast.seaSide === "west" ? [1, 0] : coast.seaSide === "east" ? [-1, 0] : coast.seaSide === "north" ? [0, 1] : [0, -1];
        const inland = (x - cx) * axis[0]! + (z - cz) * axis[1]!;
        const along = -(x - cx) * axis[1]! + (z - cz) * axis[0]!;
        return inland - 35 * Math.sin(along / 140 + phase) - 20 * Math.sin(along / 310 - phase);
      }
      if (polygonDistance) return polygonDistance(x, z);
      const angle = Math.atan2(z - cz, x - cx);
      const radius = island!.radius * (1 + .07 * Math.sin(3 * angle + phase) + .04 * Math.sin(5 * angle - phase * 2));
      return radius - Math.hypot(x - cx, z - cz);
    },
  };
}

export function islandHeight(brief: WorldBrief, ocean: OceanContext, x: number, z: number, relief: number): number {
  const island = (brief.terrain.island ?? brief.terrain.coast)!;
  const d = ocean.distance(x, z);
  const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
  if (d < 0) return ocean.surfaceLevel - oceanBedDepth(brief.ocean!, island.shoreWidth, -d);
  // Only the dry ramp stretches; the submerged profile and old explicit shoreWidth stay unchanged.
  const dryRamp = island.shoreWidth * ((brief.terrain.coast?.beachWidth ?? 25) / 25);
  return ocean.surfaceLevel + island.landHeight * smooth(d / dryRamp)
    + Math.max(-island.landHeight * .5, relief) * smooth((d - dryRamp) / dryRamp);
}
