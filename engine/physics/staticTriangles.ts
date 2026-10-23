import type { PhysicsAabb, PhysicsSurfaceTriangle } from "../behavior/behaviorSubsystem";
import type { NavigationRole } from "../scene/collision";
import type { Vec3 } from "../scene/layout";

/**
 * How a static triangle feeds character movement and navigation: an up-facing
 * one is a support surface, anything else a wall blocker AABB. Shared by
 * trimesh and heightfield colliders so both classify a triangle identically.
 */

/**
 * Every appreciably up-facing trimesh triangle is a support surface. The
 * character's authored slope limit decides whether it can walk or must slide;
 * turning a steep terrain triangle into an AABB wall makes it appear as a series
 * of false flat steps and lets a sprinting pawn fall between them. Only vertical
 * and downward-facing triangles remain movement blockers.
 */
export const SURFACE_MIN_SUPPORT_NORMAL_Y = 1e-4;

/**
 * Signed upward component of a triangle's unit normal (+1 = up-facing floor,
 * 0 = vertical, -1 = down-facing underside); 0 if degenerate. Signed (not
 * `Math.abs`) so a solid `complexAsSimple` body's *downward* faces — a staircase's
 * flat bottom, a wedge underside — are never mistaken for walkable ground, which
 * would otherwise seed a phantom nav floor inside/under the solid body and route
 * paths straight through the steps. Assumes outward (CCW) triangle winding, the
 * glTF/Three.js convention the prototype collision meshes follow.
 */
export function triangleUpNormalY(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return len <= 1e-9 ? 0 : ny / len;
}

export function triangleFootprintXZ(a: Vec3, b: Vec3, c: Vec3): readonly (readonly [number, number])[] | undefined {
  const unique: [number, number][] = [];
  for (const point of [[a[0], a[2]], [b[0], b[2]], [c[0], c[2]]] as [number, number][]) {
    if (unique.some((candidate) => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) <= 1e-9)) {
      continue;
    }
    unique.push(point);
  }
  return unique.length >= 2 ? unique : undefined;
}

type MutableAabb = { -readonly [K in keyof PhysicsAabb]: PhysicsAabb[K] };

/** A world-space triangle as exactly one of: support surface, or wall blocker. */
export function classifyStaticTriangle(
  wa: Vec3,
  wb: Vec3,
  wc: Vec3,
  navigationRole: NavigationRole | undefined,
): { surface: PhysicsSurfaceTriangle } | { blocker: PhysicsAabb } {
  const normalY = triangleUpNormalY(wa, wb, wc);
  if (normalY >= SURFACE_MIN_SUPPORT_NORMAL_Y) return { surface: { a: wa, b: wb, c: wc, normalY } };
  const blocker: MutableAabb = {
    min: [Math.min(wa[0], wb[0], wc[0]), Math.min(wa[1], wb[1], wc[1]), Math.min(wa[2], wb[2], wc[2])],
    max: [Math.max(wa[0], wb[0], wc[0]), Math.max(wa[1], wb[1], wc[1]), Math.max(wa[2], wb[2], wc[2])],
  };
  const footprint = triangleFootprintXZ(wa, wb, wc);
  if (footprint) blocker.footprint = footprint;
  if (navigationRole) blocker.navigationRole = navigationRole;
  return { blocker };
}
