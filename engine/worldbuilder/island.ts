/** Shared, deterministic shoreline for terrain, preview and generator exclusions.
 * Positive distance is land; the terrain's relief fades out before this shore. */
import type { WorldBrief } from "./worldBrief";
import { metricToWorld } from "./metricFrame";

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

export function islandOcean(brief: IslandBrief): OceanContext | undefined {
  const island = brief.terrain.island, coast = brief.terrain.coast, ocean = brief.ocean;
  const shape = island ?? coast;
  if (!shape || !ocean) return undefined;
  const [cx, cz] = metricToWorld(shape.center, brief.frame);
  // Mix adjacent small seeds too: 11 and 12 should visibly change the coast.
  let mixed = Math.imul(brief.seed ^ (brief.seed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  const phase = ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296 * Math.PI * 2;
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
  if (d < 0) return ocean.surfaceLevel - brief.ocean!.offshoreDepth * (1 - Math.exp(d / island.shoreWidth));
  // Only the dry ramp stretches; the submerged profile and old explicit shoreWidth stay unchanged.
  const dryRamp = island.shoreWidth * ((brief.terrain.coast?.beachWidth ?? 25) / 25);
  return ocean.surfaceLevel + island.landHeight * smooth(d / dryRamp)
    + Math.max(-island.landHeight * .5, relief) * smooth((d - dryRamp) / dryRamp);
}
