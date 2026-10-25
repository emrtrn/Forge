import {
  SplineCorridorIndex, splineToPolyline,
  type ForgeLandscapeSpline,
} from "../scene/landscape";
import { validateLandscapeSplines } from "../scene/landscapeSplineValidation";
import { normalizeLandscapeBrushWeights } from "../scene/landscapeBrush";
import type { Vec3 } from "../scene/layout";
import { createTerrainRegionPatches, type TerrainEditWorld, type TerrainUndoPatch } from "./terrainEdit";
import type { WorldTerrainDef } from "./terrainTypes";
import { worldTerrainActorPosition } from "./worldTerrainActor";

/** Explicit API frame; the persisted def.splines field remains legacy-local. */
export interface WorldTerrainSpline extends ForgeLandscapeSpline {
  coordinateSpace: "world";
}

type TerrainSplineFrame = Pick<WorldTerrainDef, "tileQuads" | "spacing" | "tilesX" | "tilesZ" | "origin">;
export type TerrainSplineEffect = "deform" | "paint" | "both";

function translatedSpline(spline: ForgeLandscapeSpline, offset: Vec3): ForgeLandscapeSpline {
  const copy = structuredClone(spline);
  for (const point of copy.points) {
    point.position = point.position.map((value, axis) => value + offset[axis]!) as Vec3;
  }
  return copy;
}

/** Copy legacy centre-local positions into world space; tangents stay vectors. */
export function terrainSplineToWorld(def: TerrainSplineFrame, spline: ForgeLandscapeSpline): WorldTerrainSpline {
  if ("coordinateSpace" in spline) throw new Error("Terrain spline is already in an explicit coordinate frame");
  return { ...translatedSpline(spline, worldTerrainActorPosition(def)), coordinateSpace: "world" };
}

/** Copy back for compatibility consumers. Never persists or mutates the source. */
export function terrainSplineToLocal(def: TerrainSplineFrame, spline: WorldTerrainSpline): ForgeLandscapeSpline {
  const { coordinateSpace: _space, ...local } = spline;
  return translatedSpline(local, worldTerrainActorPosition(def).map((value) => -value) as Vec3);
}

/**
 * Prepare one road/river-bed bake, sharing legacy corridor evaluation and paint
 * rules. Apply the returned patches as one terrain undo command. No render,
 * collider, streaming or persistence work happens here.
 */
export function createTerrainSplinePatches(
  world: TerrainEditWorld,
  spline: WorldTerrainSpline,
  effect: TerrainSplineEffect = "both",
): TerrainUndoPatch[] {
  if (spline.coordinateSpace !== "world") throw new Error("Terrain spline must use world coordinates");
  if (!["deform", "paint", "both"].includes(effect)) throw new Error("Invalid terrain spline effect");
  // Check without using the validator's rounded output: curve coordinates retain
  // their authored precision. Persistence migration will choose its own encoding.
  validateLandscapeSplines([spline]);
  const pieces = splineToPolyline(spline);
  const deform = new SplineCorridorIndex(effect === "paint" ? [] : pieces.filter(({ segment }) =>
    segment.deform?.enabled && (segment.deform.flatten || segment.deform.raiseTerrain || segment.deform.lowerTerrain)), world.def.spacing * 4);
  const layers = new Map(world.def.layers.map((layer, index) => [layer.id, index]));
  const paint = new SplineCorridorIndex(effect === "deform" ? [] : pieces.filter(({ segment }) =>
    segment.paint?.enabled && segment.paint.strength > 0 && layers.has(segment.paint.layerId)), world.def.spacing * 4);
  const reaches = [deform.reach, paint.reach].filter((reach) => reach !== null);
  if (reaches.length === 0) return [];
  const bounds = {
    minX: Math.min(...reaches.map((reach) => reach.minX)), minZ: Math.min(...reaches.map((reach) => reach.minZ)),
    maxX: Math.max(...reaches.map((reach) => reach.maxX)), maxZ: Math.max(...reaches.map((reach) => reach.maxZ)),
  };
  return createTerrainRegionPatches(world, bounds, {
    affects: (x, z) => deform.sample(x, z) !== null || paint.sample(x, z) !== null,
    sample: (x, z, height, weights) => {
      let nextHeight: number | undefined;
      let nextWeights: number[] | undefined;
      const terrain = deform.sample(x, z);
      if (terrain) {
        const config = terrain.segment.deform!;
        const target = terrain.start.position[1] + (terrain.end.position[1] - terrain.start.position[1]) * terrain.t
          + (config.targetOffset ?? 0) - world.def.origin[1];
        const delta = target - height;
        if ((delta > 0 && (config.flatten || config.raiseTerrain)) || (delta < 0 && (config.flatten || config.lowerTerrain))) {
          nextHeight = Number((height + delta * terrain.influence).toFixed(4));
        }
      }
      const colour = paint.sample(x, z);
      if (colour) {
        const config = colour.segment.paint!;
        const layer = layers.get(config.layerId)!;
        const current = weights[layer]!;
        const target = Math.min(1, current + Math.min(1, colour.influence * config.strength));
        if (target > current + 1e-6) {
          const otherTotal = weights.reduce((sum, value, index) => sum + (index === layer ? 0 : value), 0);
          nextWeights = weights.map((value, index) => index === layer ? target : otherTotal > 0 ? value / otherTotal * (1 - target) : 0);
          normalizeLandscapeBrushWeights(nextWeights);
        }
      }
      return { ...(nextHeight === undefined ? {} : { height: nextHeight }), ...(nextWeights === undefined ? {} : { weights: nextWeights }) };
    },
  });
}
