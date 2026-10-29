/**
 * A reference image laid over the world (World Builder plan v0.4 §13.2, T35/T36).
 *
 * `reference.origin` is the world point under the image's top-left corner and
 * `reference.size` the world extent the image covers, metres. Image right is
 * world +X and image down is world +Z, which is how the editor's top view
 * shows the world (screen up is −Z). An AI reading the image writes plan
 * points in normalised image coordinates `[0..1]²` (u right, v down); these
 * map them to world metres and back.
 *
 * Pure. Dependency-free.
 */
import type { WorldPoint } from "./normalize";
import type { WorldReference } from "./recipe";

/** World XZ of normalised image coordinates `[u, v]` (u right, v down, 0..1). */
export function referenceToWorld(reference: Pick<WorldReference, "origin" | "size">, [u, v]: WorldPoint): WorldPoint {
  return [reference.origin[0] + u * reference.size[0], reference.origin[1] + v * reference.size[1]];
}

/** Normalised image coordinates of a world XZ point; outside 0..1 when it is off the image. */
export function worldToReference(reference: Pick<WorldReference, "origin" | "size">, [x, z]: WorldPoint): WorldPoint {
  return [(x - reference.origin[0]) / reference.size[0], (z - reference.origin[1]) / reference.size[1]];
}

/** The XZ box the reference covers. */
export function referenceBounds(reference: Pick<WorldReference, "origin" | "size">): { min: WorldPoint; max: WorldPoint } {
  return { min: [...reference.origin], max: [reference.origin[0] + reference.size[0], reference.origin[1] + reference.size[1]] };
}
