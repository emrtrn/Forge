import type { LayoutLakeWaterBody, LayoutRiverWater, Vec3 } from "../scene/layout";
import type { TerrainSpline, WorldTerrainDef } from "./terrainTypes";
import { worldTerrainActorPosition } from "./worldTerrainActor";

/**
 * Moving a World Terrain (OPEN_WORLD_PLAN Faz 8, bridge removal K1). Heights
 * are stored relative to the definition's datum, so a move only shifts
 * `origin`; tiles are untouched. Everything authored in world space on the
 * terrain moves with it: world-frame splines (roads, river paths), the
 * world-frame surface and foam of its River Waters, and the lakes that
 * reference it. Rotation and scale stay unsupported.
 */

/** Float noise from adding centimetre deltas never reaches a saved file. */
function moved(value: number, delta: number): number {
  const next = Number((value + delta).toFixed(6));
  if (!Number.isFinite(next)) throw new Error("World Terrain move overflow");
  return next;
}

/** How far the actor sits from the centre its definition implies (zero when in sync). */
export function worldTerrainMoveDelta(def: Pick<WorldTerrainDef, "origin" | "tileQuads" | "spacing" | "tilesX" | "tilesZ">, position: Vec3): Vec3 {
  const centre = worldTerrainActorPosition(def);
  return [position[0] - centre[0], position[1] - centre[1], position[2] - centre[2]];
}

export function isZeroMove(delta: Vec3): boolean {
  return delta.every((value) => Math.abs(value) <= 1e-9);
}

export interface WorldTerrainMove {
  origin: Vec3;
  /** The definition's splines with world-frame points shifted; centre-local ones already follow the terrain. */
  splines: TerrainSpline[] | undefined;
  /** Only the lakes on this terrain, shifted; others are returned unchanged. */
  lakes: LayoutLakeWaterBody[];
  /** Only this terrain's world-frame River Waters, shifted; others (and local ones) unchanged. */
  rivers: LayoutRiverWater[];
}

/** The moved state, never mutating its inputs. */
export function moveWorldTerrain(
  def: Pick<WorldTerrainDef, "origin" | "splines">,
  terrainRef: string,
  lakes: readonly LayoutLakeWaterBody[],
  delta: Vec3,
  rivers: readonly LayoutRiverWater[] = [],
): WorldTerrainMove {
  const shift = (point: Vec3): Vec3 => [moved(point[0], delta[0]), moved(point[1], delta[1]), moved(point[2], delta[2])];
  const shiftXZ = ([x, z]: [number, number]): [number, number] => [moved(x, delta[0]), moved(z, delta[2])];
  const splines = def.splines?.map((spline) => {
    if (spline.coordinateSpace !== "world") return structuredClone(spline);
    const copy = structuredClone(spline);
    for (const point of copy.points) point.position = shift(point.position);
    return copy;
  });
  return {
    origin: shift(def.origin),
    splines,
    lakes: lakes.map((lake) => {
      if (lake.terrainRef !== terrainRef) return lake;
      const copy = structuredClone(lake);
      copy.seed = shiftXZ(copy.seed);
      copy.bounds = { min: shiftXZ(copy.bounds.min), max: shiftXZ(copy.bounds.max) };
      copy.surfaceLevel = moved(copy.surfaceLevel, delta[1]);
      if (copy.bed) copy.bed.points = copy.bed.points.map(shiftXZ);
      return copy;
    }),
    rivers: rivers.map((river) => {
      if (river.landscapeRef !== terrainRef || river.coordinateSpace !== "world") return river;
      const copy = structuredClone(river);
      if (copy.surfaceLevel !== undefined) copy.surfaceLevel = moved(copy.surfaceLevel, delta[1]);
      if (copy.foamStamps) copy.foamStamps = copy.foamStamps.map((stamp) => ({
        ...stamp, position: shift(stamp.position), ...(stamp.endPosition ? { endPosition: shift(stamp.endPosition) } : {}),
      }));
      return copy;
    }),
  };
}
