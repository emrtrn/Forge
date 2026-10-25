import { SplineCorridorIndex, splineToPolyline } from "../scene/landscape";
import { validateLandscapeSplines } from "../scene/landscapeSplineValidation";
import { normalizeLandscapeBrushWeights } from "../scene/landscapeBrush";
import { createTerrainRegionPatches, terrainRegionGridBounds, type TerrainEditWorld, type TerrainUndoPatch } from "./terrainEdit";
import { terrainTileWorldBounds, type WorldTerrainDef, type WorldTerrainSpline } from "./terrainTypes";
export type { WorldTerrainSpline } from "./terrainTypes";
export { terrainSplineToWorld, terrainSplineToLocal } from "./terrainSplineData";
export type TerrainSplineEffect = "deform" | "paint" | "both";

/** Declared corridor tiles plus seam neighbours, without requiring residency. */
export function terrainSplineTileKeys(def: WorldTerrainDef, spline: WorldTerrainSpline, effect: TerrainSplineEffect = "both"): string[] {
  const boxes = splineToPolyline(spline).filter(({ segment }) =>
    (effect !== "paint" && segment.deform?.enabled && (segment.deform.flatten || segment.deform.raiseTerrain || segment.deform.lowerTerrain))
    || (effect !== "deform" && segment.paint?.enabled && segment.paint.strength > 0 && def.layers.some((layer) => layer.id === segment.paint!.layerId)))
    .map(({ start, end }) => {
    const reach = Math.max(start.width, end.width) / 2 + Math.max(start.falloff, end.falloff) + def.spacing;
    return { minX: Math.min(start.position[0], end.position[0]) - reach, maxX: Math.max(start.position[0], end.position[0]) + reach,
      minZ: Math.min(start.position[2], end.position[2]) - reach, maxZ: Math.max(start.position[2], end.position[2]) + reach };
  });
  if (boxes.length === 0) return [];
  // Reject oversized synchronous transactions before they fetch a whole world.
  terrainRegionGridBounds(def, { minX: Math.min(...boxes.map((box) => box.minX)), maxX: Math.max(...boxes.map((box) => box.maxX)),
    minZ: Math.min(...boxes.map((box) => box.minZ)), maxZ: Math.max(...boxes.map((box) => box.maxZ)) });
  return def.tiles.filter(({ key }) => {
    const [x, z] = key.split("_").map(Number) as [number, number];
    const tile = terrainTileWorldBounds(def, x, z);
    return boxes.some((box) => box.maxX >= tile.minX && box.minX <= tile.maxX && box.maxZ >= tile.minZ && box.minZ <= tile.maxZ);
  }).map(({ key }) => key);
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
