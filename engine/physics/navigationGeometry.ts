/**
 * Static collider geometry as Recast input triangles (OPEN_WORLD_PLAN Faz 9).
 *
 * The grid planner reads physics through its movement abstraction (blocker
 * AABBs + walkable surface triangles). Recast voxelizes real geometry, so this
 * module emits each static collider's own shape instead: a box primitive as
 * its 12 oriented triangles, a trimesh as authored, a heightfield quad by
 * quad. Shapes the movement model also approximates (sphere, capsule,
 * cylinder, cone, convex) are emitted as their oriented box, the same
 * conservative volume.
 *
 * Winding follows Recast: `(b - a) × (c - a)` points out of the solid, so
 * floors face up. Boxes are oriented explicitly; trimeshes and heightfields
 * keep their authored winding (the same one physics classifies with). An
 * `obstacleOnly` body is emitted with every triangle facing down: it still
 * fills its voxels and blocks, but its top never becomes walkable floor.
 * Callers skip `ignored` bodies.
 */
import type { NavigationRole } from "../scene/collision";
import type { ColliderComponent, ColliderPrimitive, TransformComponent } from "../scene/components";
import type { Vec3 } from "../scene/layout";
import { forEachHeightfieldTriangle } from "./heightfieldStatic";
import { rotatePointAboutOrigin, rotatedBoxAabb, rotatedBoxCorners, rotatedBoxFootprintXZ } from "./rotatedBox";

export interface NavigationRect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export type NavigationTriangleVisitor = (a: Vec3, b: Vec3, c: Vec3) => void;

/** A volume whose floor is never walkable: convex XZ footprint plus its Y span. */
export type NavigationObstacleVisitor = (
  footprint: readonly (readonly [number, number])[],
  minY: number,
  maxY: number,
) => void;

/** Box faces as corner quads (see {@link rotatedBoxCorners} for the index bits). */
const BOX_FACES: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 3, 2], // -X
  [4, 6, 7, 5], // +X
  [0, 4, 5, 1], // -Y
  [2, 3, 7, 6], // +Y
  [0, 2, 6, 4], // -Z
  [1, 5, 7, 3], // +Z
];

/** X/Z bounds of everything a body contributes to navigation (the union of its primitives' boxes). */
export function bodyNavigationBounds(transform: TransformComponent, collider: ColliderComponent): NavigationRect {
  const origin = transform.position as Vec3;
  const rotation = transform.rotation as Vec3;
  const boxes = collider.primitives && collider.primitives.length > 0
    ? collider.primitives.map((primitive) => ({
      center: (primitive.center ?? [0, 0, 0]) as Vec3, size: primitive.size as Vec3, rotation: primitive.rotation as Vec3 | undefined,
    }))
    : [{ center: (collider.center ?? [0, 0, 0]) as Vec3, size: collider.size as Vec3, rotation: undefined }];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const box of boxes) {
    const half: Vec3 = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2];
    const aabb = rotatedBoxAabb(origin, box.center, half, rotation, box.rotation);
    minX = Math.min(minX, aabb.min[0]);
    minZ = Math.min(minZ, aabb.min[2]);
    maxX = Math.max(maxX, aabb.max[0]);
    maxZ = Math.max(maxZ, aabb.max[2]);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Visits the Recast triangles of one static body that may overlap `rect`. */
export function forEachBodyNavigationTriangle(
  transform: TransformComponent,
  collider: ColliderComponent,
  rect: NavigationRect,
  visit: NavigationTriangleVisitor,
): void {
  const origin = transform.position as Vec3;
  const rotation = transform.rotation as Vec3;
  const emit = orientedVisitor(collider.navigationRole, rect, visit);
  const primitives = collider.primitives;
  if (!primitives || primitives.length === 0) {
    const half: Vec3 = [collider.size[0] / 2, collider.size[1] / 2, collider.size[2] / 2];
    emitBox(origin, (collider.center ?? [0, 0, 0]) as Vec3, half, rotation, undefined, rect, emit);
    return;
  }
  for (const primitive of primitives) emitPrimitive(origin, rotation, primitive, rect, emit);
}

/**
 * Visits the obstacle volumes of an `obstacleOnly` body that may overlap
 * `rect`: a box primitive's oriented footprint, any other primitive's
 * enclosing box. Other roles have none.
 */
export function forEachBodyNavigationObstacle(
  transform: TransformComponent,
  collider: ColliderComponent,
  rect: NavigationRect,
  visit: NavigationObstacleVisitor,
): void {
  if (collider.navigationRole !== "obstacleOnly") return;
  const origin = transform.position as Vec3;
  const rotation = transform.rotation as Vec3;
  const boxes: { center: Vec3; size: Vec3; rotation?: Vec3 | undefined; oriented: boolean }[] =
    collider.primitives && collider.primitives.length > 0
      ? collider.primitives.map((primitive) => ({
        center: (primitive.center ?? [0, 0, 0]) as Vec3,
        size: primitive.size as Vec3,
        rotation: primitive.rotation as Vec3 | undefined,
        oriented: primitive.shape === "box",
      }))
      : [{ center: (collider.center ?? [0, 0, 0]) as Vec3, size: collider.size as Vec3, oriented: true }];
  for (const box of boxes) {
    const half: Vec3 = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2];
    const aabb = rotatedBoxAabb(origin, box.center, half, rotation, box.rotation);
    if (!overlapsRect(aabb, rect)) continue;
    const footprint = (box.oriented ? rotatedBoxFootprintXZ(origin, box.center, half, rotation, box.rotation) : undefined) ?? [
      [aabb.min[0], aabb.min[2]], [aabb.max[0], aabb.min[2]], [aabb.max[0], aabb.max[2]], [aabb.min[0], aabb.max[2]],
    ];
    visit(footprint, aabb.min[1], aabb.max[1]);
  }
}

function emitPrimitive(
  origin: Vec3,
  rotation: Vec3,
  primitive: ColliderPrimitive,
  rect: NavigationRect,
  emit: NavigationTriangleVisitor,
): void {
  const center = (primitive.center ?? [0, 0, 0]) as Vec3;
  const half: Vec3 = [primitive.size[0] / 2, primitive.size[1] / 2, primitive.size[2] / 2];
  // `size`/`center` bound every primitive (a trimesh/heightfield's too), so one
  // cheap AABB test rejects most primitives before any triangle is built.
  if (!overlapsRect(rotatedBoxAabb(origin, center, half, rotation, primitive.rotation), rect)) return;
  if (primitive.shape === "trimesh" && primitive.vertices && primitive.indices) {
    const { vertices, indices } = primitive;
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = vertices[indices[t]!];
      const b = vertices[indices[t + 1]!];
      const c = vertices[indices[t + 2]!];
      if (!a || !b || !c) continue;
      emit(
        rotatePointAboutOrigin(origin, a, rotation),
        rotatePointAboutOrigin(origin, b, rotation),
        rotatePointAboutOrigin(origin, c, rotation),
      );
    }
    return;
  }
  if (primitive.shape === "heightfield" && primitive.heightfield) {
    const field = primitive.heightfield;
    const unrotated = rotation.every((value) => value === 0);
    // Unrotated fields (every World Terrain tile) visit only the quads under
    // the rectangle; a rotated one is rare and walks its whole grid.
    const minX = origin[0] - (field.quadsX * field.spacing) / 2;
    const minZ = origin[2] - (field.quadsZ * field.spacing) / 2;
    const qx0 = unrotated ? Math.floor((rect.minX - minX) / field.spacing) : 0;
    const qx1 = unrotated ? Math.floor((rect.maxX - minX) / field.spacing) : field.quadsX - 1;
    const qz0 = unrotated ? Math.floor((rect.minZ - minZ) / field.spacing) : 0;
    const qz1 = unrotated ? Math.floor((rect.maxZ - minZ) / field.spacing) : field.quadsZ - 1;
    forEachHeightfieldTriangle(field, qx0, qx1, qz0, qz1, (a, b, c) => {
      emit(
        rotatePointAboutOrigin(origin, a, rotation),
        rotatePointAboutOrigin(origin, b, rotation),
        rotatePointAboutOrigin(origin, c, rotation),
      );
    });
    return;
  }
  emitBox(origin, center, half, rotation, primitive.rotation, rect, emit);
}

function emitBox(
  origin: Vec3,
  center: Vec3,
  half: Vec3,
  rotation: Vec3,
  primitiveRotation: Vec3 | undefined,
  rect: NavigationRect,
  emit: NavigationTriangleVisitor,
): void {
  if (!overlapsRect(rotatedBoxAabb(origin, center, half, rotation, primitiveRotation), rect)) return;
  const corners = rotatedBoxCorners(origin, center, half, rotation, primitiveRotation);
  const middle: Vec3 = [0, 0, 0];
  for (const corner of corners) for (let axis = 0; axis < 3; axis += 1) middle[axis]! += corner[axis]! / 8;
  for (const [p0, p1, p2, p3] of BOX_FACES) {
    emitOutward(corners[p0]!, corners[p1]!, corners[p2]!, middle, emit);
    emitOutward(corners[p0]!, corners[p2]!, corners[p3]!, middle, emit);
  }
}

/** Emits the triangle wound so its normal points away from the solid's centre. */
function emitOutward(a: Vec3, b: Vec3, c: Vec3, middle: Vec3, emit: NavigationTriangleVisitor): void {
  const n = normal(a, b, c);
  const out = (a[0] + b[0] + c[0]) / 3 - middle[0];
  const up = (a[1] + b[1] + c[1]) / 3 - middle[1];
  const side = (a[2] + b[2] + c[2]) / 3 - middle[2];
  if (n[0] * out + n[1] * up + n[2] * side < 0) emit(a, c, b);
  else emit(a, b, c);
}

/**
 * Wraps `visit` with the rectangle cull and the body's role: `obstacleOnly`
 * triangles are turned to face down so Recast never marks them walkable.
 */
function orientedVisitor(
  role: NavigationRole | undefined,
  rect: NavigationRect,
  visit: NavigationTriangleVisitor,
): NavigationTriangleVisitor {
  const downOnly = role === "obstacleOnly";
  return (a, b, c) => {
    if (Math.max(a[0], b[0], c[0]) < rect.minX || Math.min(a[0], b[0], c[0]) > rect.maxX) return;
    if (Math.max(a[2], b[2], c[2]) < rect.minZ || Math.min(a[2], b[2], c[2]) > rect.maxZ) return;
    if (downOnly && normal(a, b, c)[1] > 0) visit(a, c, b);
    else visit(a, b, c);
  };
}

function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const e0x = b[0] - a[0], e0y = b[1] - a[1], e0z = b[2] - a[2];
  const e1x = c[0] - a[0], e1y = c[1] - a[1], e1z = c[2] - a[2];
  return [e0y * e1z - e0z * e1y, e0z * e1x - e0x * e1z, e0x * e1y - e0y * e1x];
}

function overlapsRect(aabb: { min: readonly number[]; max: readonly number[] }, rect: NavigationRect): boolean {
  return aabb.max[0]! >= rect.minX && aabb.min[0]! <= rect.maxX && aabb.max[2]! >= rect.minZ && aabb.min[2]! <= rect.maxZ;
}
