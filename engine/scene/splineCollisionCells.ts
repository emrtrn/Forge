import type { LayoutSplineActor } from "@engine/scene/layout";
import { buildSplineCurveCache } from "@engine/scene/splineCurve";
import { getSplineTransformAtDistance } from "@engine/scene/splineFrame";
import { normalizeSplineGenerators, resolveSplineDeformMeshGenerator } from "@engine/scene/splineGenerator";
import { worldCellAt, worldCellKey, type WorldGridDef } from "@engine/world/worldGrid";

/**
 * World Partition cells of a spline's collision (OPEN_WORLD_PLAN Faz 8 roads).
 * A segmented deform generator with runtime collision files each segment chunk
 * under the cell holding the segment's midpoint, so the runtime can add one
 * trimesh per cell while the cell is loaded instead of the whole road at boot.
 * Whole-geometry generators keep their single eager collider.
 */

/** Generator ids whose collision streams by segment: enabled, runtime, collidable, segmented. */
export function streamedSplineCollisionGeneratorIds(actor: LayoutSplineActor): string[] {
  return normalizeSplineGenerators(actor.generators)
    .filter((definition) => definition.type === "deformMesh")
    .map(resolveSplineDeformMeshGenerator)
    .filter((generator) => generator.enabled && generator.runtimeEnabled && generator.collisionEnabled
      && generator.geometryMode === "segments" && Boolean(generator.meshAsset))
    .map((generator) => generator.id);
}

/** Segment index → cell key of its midpoint (world space), for an actor with streamed collision. */
export function splineSegmentCells(actor: LayoutSplineActor, grid: WorldGridDef): Map<number, string> {
  const cells = new Map<number, string>();
  const cache = buildSplineCurveCache(actor.spline);
  for (const segment of cache.segments) {
    const { position } = getSplineTransformAtDistance(cache, segment.startDistance + segment.length / 2, "world", actor);
    const cell = worldCellAt(grid, position[0], position[2]);
    cells.set(segment.index, worldCellKey(cell.x, cell.z));
  }
  return cells;
}

/** Every cell any spline's streamed collision occupies, keyed by actor id. */
export function splineCollisionCells(
  actors: readonly LayoutSplineActor[],
  grid: WorldGridDef,
): Map<string, Map<number, string>> {
  const result = new Map<string, Map<number, string>>();
  for (const actor of actors) {
    if (streamedSplineCollisionGeneratorIds(actor).length === 0) continue;
    result.set(actor.id, splineSegmentCells(actor, grid));
  }
  return result;
}
