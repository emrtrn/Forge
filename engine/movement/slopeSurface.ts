/**
 * Pure, headless-testable slope-surface sampling for the kinematic ground probe.
 *
 * The AABB movement model treats every collider top as a flat shelf, so a ramp
 * modelled as a box (or a rotated box, which bloats to an axis-aligned box) is
 * walked on as a flat plateau — the player never follows the incline. To walk up
 * a real ramp the ground probe needs the *actual* surface height under the
 * player's feet, which only triangle geometry carries. A ramp authored with
 * `complexAsSimple` collision becomes a static trimesh; the physics subsystem
 * exposes its world-space triangles (with a precomputed upward normal) and this
 * module interpolates the surface height and gates it on the character's slope
 * limit.
 */

export interface GroundTriangle {
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly c: readonly [number, number, number];
  /** Signed normal.y after normalization: +1 = up-facing floor, 0 = vertical, -1 = down-facing. Precomputed. */
  readonly normalY: number;
}

/** Barycentric containment / degeneracy tolerance (u,v are dimensionless 0..1). */
const EPSILON = 1e-6;

/**
 * Signed upward component of a triangle's unit normal: +1 for an up-facing floor,
 * 0 for a vertical wall, -1 for a down-facing underside. Returns 0 for a
 * degenerate (zero-area) triangle. Signed (not `Math.abs`) so a solid body's
 * downward faces are not mistaken for walkable ground; assumes outward (CCW)
 * winding, which the prototype collision meshes follow.
 */
export function triangleUpNormal(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const ny = uz * vx - ux * vz;
  const nx = uy * vz - uz * vy;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len <= EPSILON) return 0;
  return ny / len;
}

/**
 * Full unit normal of a triangle (outward, CCW winding), or `null` for a
 * degenerate (zero-area) triangle. The `y` component matches {@link triangleUpNormal};
 * the horizontal `(x, z)` components give the downhill direction on an up-facing
 * surface, which the slide response uses to push a pawn off a too-steep slope.
 */
export function triangleNormal(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): readonly [number, number, number] | null {
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
  if (len <= EPSILON) return null;
  return [nx / len, ny / len, nz / len];
}

/**
 * Interpolated surface Y at world `(x, z)` if that point lies within the
 * triangle's XZ projection, else `null` (outside the triangle, or the triangle is
 * vertical/degenerate in XZ so it carries no walkable surface). Uses barycentric
 * coordinates in the XZ plane, then interpolates the vertices' Y.
 */
export function sampleTriangleHeight(
  tri: GroundTriangle,
  x: number,
  z: number,
): number | null {
  const { a, b, c } = tri;
  const v0x = c[0] - a[0];
  const v0z = c[2] - a[2];
  const v1x = b[0] - a[0];
  const v1z = b[2] - a[2];
  const v2x = x - a[0];
  const v2z = z - a[2];
  const d00 = v0x * v0x + v0z * v0z;
  const d01 = v0x * v1x + v0z * v1z;
  const d02 = v0x * v2x + v0z * v2z;
  const d11 = v1x * v1x + v1z * v1z;
  const d12 = v1x * v2x + v1z * v2z;
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) <= EPSILON) return null; // vertical or degenerate in XZ
  const u = (d11 * d02 - d01 * d12) / denom;
  const v = (d00 * d12 - d01 * d02) / denom;
  if (u < -EPSILON || v < -EPSILON || u + v > 1 + EPSILON) return null; // outside
  return a[1] + u * (c[1] - a[1]) + v * (b[1] - a[1]);
}

/** cos of a slope limit in degrees, clamped to [0°, 89.9°]. A triangle is walkable when its `normalY >= slopeCosFromDegrees(limit)`. */
export function slopeCosFromDegrees(deg: number): number {
  const clamped = Math.max(0, Math.min(deg, 89.9));
  return Math.cos((clamped * Math.PI) / 180);
}
