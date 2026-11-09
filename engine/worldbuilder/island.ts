/** Shared, deterministic shoreline for terrain, preview and generator exclusions.
 * Positive distance is land; the terrain's relief fades out before this shore. */
import type { WorldBrief } from "./worldBrief";
import { metricToWorld } from "./metricFrame";

export interface OceanContext {
  surfaceLevel: number;
  distance(x: number, z: number): number;
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
  return ocean.surfaceLevel + island.landHeight * smooth(d / island.shoreWidth)
    + Math.max(-island.landHeight * .5, relief) * smooth((d - island.shoreWidth) / island.shoreWidth);
}
