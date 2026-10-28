import type { LayoutSplineActor, Vec3 } from "@engine/scene/layout";
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

export interface TrimeshCellPart {
  vertices: Vec3[];
  indices: number[];
  size: Vec3;
  center: Vec3;
}

/**
 * Splits a trimesh (in a frame translated by `origin` from world space) into
 * one compact part per cell, filing each triangle under the cell of its
 * centroid. Used for World Terrain road meshes, whose collision is one body
 * per landscape until a partitioned level streams it by cell.
 */
export function trimeshCellParts(
  trimesh: { vertices: readonly Vec3[]; indices: readonly number[] },
  origin: Vec3,
  grid: WorldGridDef,
): Map<string, TrimeshCellPart> {
  const parts = new Map<string, { vertices: Vec3[]; indices: number[]; remap: Map<number, number> }>();
  const { vertices, indices } = trimesh;
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const a = vertices[indices[index]!]!, b = vertices[indices[index + 1]!]!, c = vertices[indices[index + 2]!]!;
    const cell = worldCellAt(grid, origin[0] + (a[0] + b[0] + c[0]) / 3, origin[2] + (a[2] + b[2] + c[2]) / 3);
    const key = worldCellKey(cell.x, cell.z);
    let part = parts.get(key);
    if (!part) parts.set(key, part = { vertices: [], indices: [], remap: new Map() });
    for (let corner = 0; corner < 3; corner += 1) {
      const source = indices[index + corner]!;
      let target = part.remap.get(source);
      if (target === undefined) {
        target = part.vertices.length;
        part.vertices.push(vertices[source]!);
        part.remap.set(source, target);
      }
      part.indices.push(target);
    }
  }
  const result = new Map<string, TrimeshCellPart>();
  for (const [key, part] of parts) {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const vertex of part.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, vertex[axis]!);
        max[axis] = Math.max(max[axis]!, vertex[axis]!);
      }
    }
    result.set(key, {
      vertices: part.vertices,
      indices: part.indices,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    });
  }
  return result;
}
