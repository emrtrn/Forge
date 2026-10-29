/**
 * Pure, headless-testable world-AABB math for a (possibly rotated) box collider.
 *
 * The kinematic character solver (`src/game/collision.ts`) collides against
 * axis-aligned blocker AABBs. Collider components store their `size`/`center` in
 * the *body-local* frame (unrotated) — placement rotation is meant to be applied
 * at physics-eval time via the body's `transform.rotation`, matching the rendered
 * mesh and the Rapier collider. This module supplies that missing step for the
 * blocker path: given an authored box in the body-local frame plus the body's
 * Euler rotation, it returns the world-axis-aligned box that encloses the rotated
 * collider (the rotated `center` offset is honoured, so a corner-pivoted wall no
 * longer lands metres away from where it is drawn).
 *
 * The enclosing AABB "bloats" for off-axis rotations (a 45°-rotated thin wall
 * gets a fatter footprint). That is the accepted trade-off of an AABB movement
 * model; exact OBB collision is a separate backlog item.
 */
import type { Vec3 } from "../scene/layout";

/** Row-major 3x3 rotation matrix. */
type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export interface BoxAabb {
  min: [number, number, number];
  max: [number, number, number];
}

const DEG_TO_RAD = Math.PI / 180;
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function isZeroRotation(rotation: Vec3): boolean {
  return rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0;
}

/**
 * Rotation matrix for a Three.js-order (XYZ) Euler rotation in degrees. Built via
 * the same quaternion the physics body uses (mirrors
 * `physicsSubsystem.quaternionFromEulerDegrees`) so a blocker AABB stays aligned
 * with the rendered mesh and the Rapier collider.
 */
export function rotationMatrixFromEulerDegrees(rotation: Vec3): Mat3 {
  const hx = (rotation[0] * DEG_TO_RAD) / 2;
  const hy = (rotation[1] * DEG_TO_RAD) / 2;
  const hz = (rotation[2] * DEG_TO_RAD) / 2;
  const cx = Math.cos(hx);
  const sx = Math.sin(hx);
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cz = Math.cos(hz);
  const sz = Math.sin(hz);
  const qx = sx * cy * cz + cx * sy * sz;
  const qy = cx * sy * cz - sx * cy * sz;
  const qz = cx * cy * sz + sx * sy * cz;
  const qw = cx * cy * cz - sx * sy * sz;
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  return [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ];
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Rotates a body-local point into world space (about the body origin), honouring
 * the body's Euler rotation. Used to place trimesh triangle vertices of a rotated
 * complex-as-simple collider.
 */
export function rotatePointAboutOrigin(origin: Vec3, localPoint: Vec3, bodyRotation: Vec3): Vec3 {
  if (isZeroRotation(bodyRotation)) {
    return [origin[0] + localPoint[0], origin[1] + localPoint[1], origin[2] + localPoint[2]];
  }
  const rotated = applyMat3(rotationMatrixFromEulerDegrees(bodyRotation), localPoint);
  return [origin[0] + rotated[0], origin[1] + rotated[1], origin[2] + rotated[2]];
}

/**
 * World-axis-aligned AABB enclosing a box collider. The box has half-extents
 * `half`, is centred at `localCenter` in the body-local frame, and the body sits
 * at `origin` with Euler-degree `bodyRotation` (a `primitiveRotation` composes the
 * primitive's own local orientation on top). When every rotation is zero the plain
 * axis-aligned box is returned with no matrix math, so the common case is exact.
 */
export function rotatedBoxAabb(
  origin: Vec3,
  localCenter: Vec3,
  half: Vec3,
  bodyRotation: Vec3,
  primitiveRotation?: Vec3,
): BoxAabb {
  const hasBodyRotation = !isZeroRotation(bodyRotation);
  const hasPrimitiveRotation = primitiveRotation !== undefined && !isZeroRotation(primitiveRotation);
  if (!hasBodyRotation && !hasPrimitiveRotation) {
    const cx = origin[0] + localCenter[0];
    const cy = origin[1] + localCenter[1];
    const cz = origin[2] + localCenter[2];
    return {
      min: [cx - half[0], cy - half[1], cz - half[2]],
      max: [cx + half[0], cy + half[1], cz + half[2]],
    };
  }
  const bodyMatrix = hasBodyRotation ? rotationMatrixFromEulerDegrees(bodyRotation) : IDENTITY;
  // Box axes in world = bodyRotation ∘ primitiveRotation. The enclosing extents
  // come from these axes; the centre offset only rotates by the body.
  const boxAxes = hasPrimitiveRotation
    ? multiplyMat3(bodyMatrix, rotationMatrixFromEulerDegrees(primitiveRotation!))
    : bodyMatrix;
  const worldCenter = applyMat3(bodyMatrix, localCenter);
  const hx =
    Math.abs(boxAxes[0]) * half[0] + Math.abs(boxAxes[1]) * half[1] + Math.abs(boxAxes[2]) * half[2];
  const hy =
    Math.abs(boxAxes[3]) * half[0] + Math.abs(boxAxes[4]) * half[1] + Math.abs(boxAxes[5]) * half[2];
  const hz =
    Math.abs(boxAxes[6]) * half[0] + Math.abs(boxAxes[7]) * half[1] + Math.abs(boxAxes[8]) * half[2];
  const cx = origin[0] + worldCenter[0];
  const cy = origin[1] + worldCenter[1];
  const cz = origin[2] + worldCenter[2];
  return {
    min: [cx - hx, cy - hy, cz - hz],
    max: [cx + hx, cy + hy, cz + hz],
  };
}

/**
 * Oriented convex XZ footprint (ground silhouette) of the same box
 * {@link rotatedBoxAabb} encloses: the box's 8 world corners projected onto the
 * ground plane, hulled. This is the *tight* obstacle shape a rotated wall
 * actually occupies, which the enclosing AABB bloats over. Returns `undefined`
 * for an axis-aligned box (no rotation) — there the `min.xz..max.xz` rectangle is
 * already exact, so callers keep the cheaper AABB-only path.
 */
export function rotatedBoxFootprintXZ(
  origin: Vec3,
  localCenter: Vec3,
  half: Vec3,
  bodyRotation: Vec3,
  primitiveRotation?: Vec3,
): [number, number][] | undefined {
  const hasBodyRotation = !isZeroRotation(bodyRotation);
  const hasPrimitiveRotation = primitiveRotation !== undefined && !isZeroRotation(primitiveRotation);
  if (!hasBodyRotation && !hasPrimitiveRotation) return undefined;
  const bodyMatrix = hasBodyRotation ? rotationMatrixFromEulerDegrees(bodyRotation) : IDENTITY;
  const boxAxes = hasPrimitiveRotation
    ? multiplyMat3(bodyMatrix, rotationMatrixFromEulerDegrees(primitiveRotation!))
    : bodyMatrix;
  const worldCenter = applyMat3(bodyMatrix, localCenter);
  const cx = origin[0] + worldCenter[0];
  const cz = origin[2] + worldCenter[2];
  const points: [number, number][] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = sx * half[0];
        const ly = sy * half[1];
        const lz = sz * half[2];
        const ox = boxAxes[0] * lx + boxAxes[1] * ly + boxAxes[2] * lz;
        const oz = boxAxes[6] * lx + boxAxes[7] * ly + boxAxes[8] * lz;
        points.push([cx + ox, cz + oz]);
      }
    }
  }
  return convexHullXZ(points);
}

/**
 * The 8 world corners of the same box {@link rotatedBoxAabb} encloses, indexed
 * by sign bits `(x > 0) << 2 | (y > 0) << 1 | (z > 0)` in the box's local frame.
 */
export function rotatedBoxCorners(
  origin: Vec3,
  localCenter: Vec3,
  half: Vec3,
  bodyRotation: Vec3,
  primitiveRotation?: Vec3,
): Vec3[] {
  const bodyMatrix = isZeroRotation(bodyRotation) ? IDENTITY : rotationMatrixFromEulerDegrees(bodyRotation);
  const boxAxes = primitiveRotation !== undefined && !isZeroRotation(primitiveRotation)
    ? multiplyMat3(bodyMatrix, rotationMatrixFromEulerDegrees(primitiveRotation))
    : bodyMatrix;
  const worldCenter = applyMat3(bodyMatrix, localCenter);
  const corners: Vec3[] = [];
  for (let index = 0; index < 8; index += 1) {
    const local: Vec3 = [
      index & 4 ? half[0] : -half[0],
      index & 2 ? half[1] : -half[1],
      index & 1 ? half[2] : -half[2],
    ];
    const offset = applyMat3(boxAxes, local);
    corners.push([
      origin[0] + worldCenter[0] + offset[0],
      origin[1] + worldCenter[1] + offset[1],
      origin[2] + worldCenter[2] + offset[2],
    ]);
  }
  return corners;
}

/**
 * 2D convex hull (Andrew's monotone chain, CCW) of XZ points, or `undefined` when
 * the points are degenerate (fewer than 3 non-collinear). Small fixed input (box
 * corners), so the O(n log n) sort cost is negligible. Exported so the editor's
 * nav-debug blocker path can hull a rotated wirebox's world corners into the same
 * oriented footprint the physics blocker path bakes.
 */
export function convexHullXZ(points: readonly [number, number][]): [number, number][] | undefined {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique: [number, number][] = [];
  for (const p of sorted) {
    const last = unique[unique.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) unique.push(p);
  }
  if (unique.length < 3) return undefined;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const p = unique[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = [...lower, ...upper];
  return hull.length >= 3 ? hull : undefined;
}
