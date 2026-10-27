import { Box3, Vector3 } from "three";

import { forEachHeightfieldTriangle } from "@engine/physics/heightfieldStatic";
import type { ColliderHeightfield } from "@engine/scene/components";
import type { RoomLayout, Vec3 } from "@engine/scene/layout";
import type {
  AssetCollisionDef,
  CollisionPrimitive,
  NavigationRole,
} from "@engine/scene/collision";
import { readRotation, readScale } from "@engine/scene/transform";
import { colliderBoxFromBounds, composeTransformMatrix, type ColliderBox } from "./transforms";

/** A world-aligned collider box plus whether its owner is a (non-blocking) sensor. */
export interface CollisionWirebox {
  box: Box3;
  segments: Vec3[];
  size: Vec3;
  sensor: boolean;
  navigationRole: NavigationRole;
  /**
   * True when `box` is the enclosing hull of a `complexAsSimple` trimesh rather
   * than a real box collider — its flat top is a fictional plane at peak height
   * (the mesh's real walkable floors are its surface triangles), so nav ground
   * seeding must ignore it.
   */
  complexHull?: boolean;
}

/** Render-mesh triangle data for a `complexAsSimple` asset's collision overlay. */
export interface ComplexCollisionMesh {
  vertices: Vec3[];
  indices: number[];
}

/**
 * World-aligned collider boxes for every collidable placement and character in a
 * layout: the data behind the editor's "Show > Collision" overlay.
 *
 * Mirrors the collider the adapter derives (the model's local bounds under the
 * placement's position + scale, ignoring rotation; see `colliderBoxFromBounds`)
 * and the same `collision` / `sensor` flags, so the overlay shows exactly what
 * physics uses. Placements that opted out with `collision: false` are skipped
 * unless `simulatePhysics` forces a collider; an asset with no loaded bounds is
 * skipped (its box is unknown).
 *
 * Pure: takes the layout and a bounds lookup, returns boxes/line segments. No
 * DOM, no scene mutation: the host turns each segment list into a line helper.
 */
export function collisionWireboxes(
  layout: RoomLayout,
  localBounds: ReadonlyMap<string, Box3>,
  collisionDefs?: ReadonlyMap<string, AssetCollisionDef>,
  complexMeshes?: ReadonlyMap<string, ComplexCollisionMesh>,
): CollisionWirebox[] {
  const boxes: CollisionWirebox[] = [];
  forEachColliderSource(layout, (source, assetId, sensor) => {
    boxes.push(...sourceWireboxes(source, assetId, sensor, localBounds, collisionDefs, complexMeshes));
  });
  return boxes;
}

/** One collider owner's overlay lines, keyed so a refresh can reuse unchanged ones. */
export interface CollisionWireEntry {
  /** Stable per owner: instance group + placement index, or character index. */
  key: string;
  /** Neighbouring owners drawn from one line buffer. */
  chunk: string;
  /** Everything the lines derive from; equal signatures mean equal lines. */
  signature: string;
  sensor: boolean;
  /** World-space segment endpoints, `xyz` pairs. */
  positions: Float32Array;
}

/** Owners per overlay draw buffer: one edit re-uploads one chunk, not the whole level. */
export const COLLISION_WIRE_CHUNK_SIZE = 64;

/**
 * The "Show > Collision" overlay lines of {@link collisionWireboxes}, per owner,
 * reusing `previous` entries whose signature is unchanged. The overlay refreshes
 * on every selection change and drag step; rebuilding every owner each time
 * (thousands of `complexAsSimple` meshes on an open-world level) stalled the
 * editor, while a drag step changes one owner.
 */
export function collisionWireEntries(
  layout: RoomLayout,
  localBounds: ReadonlyMap<string, Box3>,
  collisionDefs?: ReadonlyMap<string, AssetCollisionDef>,
  complexMeshes?: ReadonlyMap<string, ComplexCollisionMesh>,
  previous?: ReadonlyMap<string, CollisionWireEntry>,
): CollisionWireEntry[] {
  const entries: CollisionWireEntry[] = [];
  forEachColliderSource(layout, (source, assetId, sensor, owner, index) => {
    if (source.collision === false && source.simulatePhysics !== true) return;
    const key = `${owner}:${index}`;
    const bounds = localBounds.get(assetId);
    const signature = [
      assetId,
      source.position.join(","),
      readRotation(source).join(","),
      readScale(source).join(","),
      sensor ? 1 : 0,
      identityOf(collisionDefs?.get(assetId)),
      identityOf(complexMeshes?.get(assetId)),
      bounds ? `${bounds.min.toArray().join(",")}/${bounds.max.toArray().join(",")}` : "",
    ].join("|");
    const reused = previous?.get(key);
    if (reused?.signature === signature) {
      entries.push(reused);
      return;
    }
    const lines = sourceWireboxes(source, assetId, sensor, localBounds, collisionDefs, complexMeshes)
      .filter(({ box, segments }) => !box.isEmpty() && segments.length > 0)
      .flatMap(({ segments }) => segments);
    if (lines.length === 0) return;
    const positions = new Float32Array(lines.length * 3);
    lines.forEach((point, offset) => positions.set(point, offset * 3));
    entries.push({ key, chunk: `${owner}:${Math.floor(index / COLLISION_WIRE_CHUNK_SIZE)}`, signature, sensor, positions });
  });
  return entries;
}

/** Collider owners in overlay order: instance placements per group, then characters. */
function forEachColliderSource(
  layout: RoomLayout,
  visit: (source: ColliderSource, assetId: string, sensor: boolean, owner: string, index: number) => void,
): void {
  layout.instances.forEach((instance, group) => {
    instance.placements.forEach((placement, index) => {
      visit(placement, instance.assetId, placement.sensor === true, `i${group}`, index);
    });
  });
  layout.characters.forEach((character, index) => {
    visit(character, character.assetId, character.sensor === true, "c", index);
  });
}

function sourceWireboxes(
  source: ColliderSource,
  assetId: string,
  sensor: boolean,
  localBounds: ReadonlyMap<string, Box3>,
  collisionDefs?: ReadonlyMap<string, AssetCollisionDef>,
  complexMeshes?: ReadonlyMap<string, ComplexCollisionMesh>,
): CollisionWirebox[] {
  if (source.collision === false && source.simulatePhysics !== true) return [];
  const def = collisionDefs?.get(assetId);
  const navigationRole = source.navigationRole ?? def?.navigationRole ?? "auto";
  // `complexAsSimple` uses the render mesh: draw its triangle edges so the
  // overlay shows the actual collision shape (e.g. an L-corner), not a box.
  const complexMesh = complexMeshes?.get(assetId);
  if (def?.complexity === "complexAsSimple" && complexMesh) {
    return [complexWirebox(source, complexMesh, sensor, navigationRole)];
  }
  // Authored simple-collision primitives (from the Static Mesh editor's
  // sidecar) replace the auto bounding box when present.
  if (def && def.primitives.length > 0) {
    return def.primitives.map((primitive) => authoredWirebox(source, primitive, sensor, navigationRole));
  }
  const bounds = localBounds.get(assetId);
  if (!bounds || bounds.isEmpty()) return [];
  const collider = colliderBoxFromBounds(bounds, source);
  return [{
    box: boxFromColliderBox(source.position, collider),
    segments: wireboxSegments(source.position, readRotation(source), collider),
    size: [...collider.size],
    sensor,
    navigationRole,
  }];
}

const objectIdentities = new WeakMap<object, number>();
let nextObjectIdentity = 1;

/** A stable number per object, so a signature notices a replaced definition or mesh. */
function identityOf(value: object | undefined): string {
  if (!value) return "";
  let identity = objectIdentities.get(value);
  if (identity === undefined) {
    identity = nextObjectIdentity++;
    objectIdentities.set(value, identity);
  }
  return String(identity);
}

/** A world-space walkable surface triangle (`normalY` = signed unit normal.y, up-facing > 0). */
export interface CollisionSurfaceTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  normalY: number;
}

/** Steepest walkable surface: matches the physics `SURFACE_MAX_WALL_DEGREES` (50°) gate. */
const SURFACE_MIN_NORMAL_Y = Math.cos((50 * Math.PI) / 180);

/**
 * World-space walkable surface triangles for every `complexAsSimple` placement in
 * a layout — the live, layout-derived twin of the physics subsystem's
 * `staticNavigationSurfaceTriangles()`. The editor AI-nav preview samples this so
 * a ramp/complex mesh's walkable cells track add/delete/move/rotate/scale edits
 * immediately, instead of freezing on the physics bodies (populated only once at
 * scene load). Sensors, `collision:false` placements, and obstacle/ignored nav
 * roles never seed nav floor, so they are skipped — mirroring the physics path.
 */
export function collisionSurfaceTriangles(
  layout: RoomLayout,
  complexMeshes: ReadonlyMap<string, ComplexCollisionMesh>,
  collisionDefs?: ReadonlyMap<string, AssetCollisionDef>,
): CollisionSurfaceTriangle[] {
  const out: CollisionSurfaceTriangle[] = [];
  const emit = (source: ColliderSource, assetId: string, sensor: boolean): void => {
    if (sensor) return;
    if (source.collision === false && source.simulatePhysics !== true) return;
    const def = collisionDefs?.get(assetId);
    if (def?.complexity !== "complexAsSimple") return;
    const mesh = complexMeshes.get(assetId);
    if (!mesh || mesh.indices.length < 3) return;
    const navigationRole = source.navigationRole ?? def?.navigationRole ?? "auto";
    if (navigationRole === "obstacleOnly" || navigationRole === "ignored") return;
    const place = composeTransformMatrix(source.position, readRotation(source), readScale(source));
    const world = mesh.vertices.map((point) =>
      new Vector3(point[0], point[1], point[2]).applyMatrix4(place),
    );
    for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
      const a = world[mesh.indices[t]!];
      const b = world[mesh.indices[t + 1]!];
      const c = world[mesh.indices[t + 2]!];
      if (!a || !b || !c) continue;
      const normalY = triangleUpNormalY(a, b, c);
      if (normalY < SURFACE_MIN_NORMAL_Y) continue; // steep → wall blocker, not a walk surface
      out.push({ a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], c: [c.x, c.y, c.z], normalY });
    }
  };
  for (const instance of layout.instances) {
    for (const placement of instance.placements) {
      emit(placement, instance.assetId, placement.sensor === true);
    }
  }
  return out;
}

/**
 * Signed upward component of a triangle's unit normal (+1 = up-facing floor,
 * 0 = vertical, -1 = down-facing underside; 0 if degenerate). Signed (not
 * `Math.abs`) so a solid `complexAsSimple` body's *downward* faces — a staircase's
 * flat bottom, a wedge underside — are not classified as walkable ground. This
 * mirrors the physics `triangleUpNormalY`, keeping the editor nav preview in sync
 * with the runtime bake. Assumes outward (CCW) triangle winding.
 */
function triangleUpNormalY(a: Vector3, b: Vector3, c: Vector3): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const ny = uz * vx - ux * vz;
  const nx = uy * vz - uz * vy;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return len <= 1e-12 ? 0 : ny / len;
}

/**
 * Local-space line-segment pairs tracing every triangle edge of a heightfield
 * collider, in the body frame and triangle order physics uses. The editor's
 * "Show > Collision" landscape overlay draws these, so it shows exactly the
 * surface characters walk on in Play.
 */
export function heightfieldWireSegments(field: ColliderHeightfield): Vec3[] {
  const segments: Vec3[] = [];
  forEachHeightfieldTriangle(field, 0, field.quadsX - 1, 0, field.quadsZ - 1, (a, b, c) => {
    segments.push(a, b, b, c, c, a);
  });
  return segments;
}

/**
 * {@link heightfieldWireSegments} as indexed line geometry for the overlay: every
 * sample once and every triangle edge once (an interior edge borders two
 * triangles). A 257² terrain tile is ~197 k edges here; as segment pairs it was
 * ~787 k `Vec3` arrays rebuilt on every overlay refresh.
 */
export function heightfieldWireGeometry(field: ColliderHeightfield): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const { quadsX, quadsZ, spacing, heights } = field;
  const columns = quadsX + 1;
  const halfX = (quadsX * spacing) / 2;
  const halfZ = (quadsZ * spacing) / 2;
  const positions = new Float32Array(columns * (quadsZ + 1) * 3);
  for (let z = 0; z <= quadsZ; z += 1) {
    for (let x = 0; x <= quadsX; x += 1) {
      const sample = z * columns + x;
      positions[sample * 3] = x * spacing - halfX;
      positions[sample * 3 + 1] = heights[sample]!;
      positions[sample * 3 + 2] = z * spacing - halfZ;
    }
  }
  // Per quad (a, b, c, d) = (x,z)(x+1,z)(x,z+1)(x+1,z+1): its top, left and
  // diagonal edges; the right/bottom ones belong to the next quad except on the
  // grid's last column/row.
  const indices = new Uint32Array((quadsX * quadsZ * 3 + quadsX + quadsZ) * 2);
  let next = 0;
  for (let z = 0; z < quadsZ; z += 1) {
    for (let x = 0; x < quadsX; x += 1) {
      const a = z * columns + x;
      const b = a + 1;
      const c = a + columns;
      indices[next++] = a; indices[next++] = b;
      indices[next++] = a; indices[next++] = c;
      indices[next++] = b; indices[next++] = c;
      if (x === quadsX - 1) { indices[next++] = b; indices[next++] = c + 1; }
      if (z === quadsZ - 1) { indices[next++] = c; indices[next++] = c + 1; }
    }
  }
  return { positions, indices };
}

/** Placement/character fields the wirebox builder reads. */
type ColliderSource = {
  position: Vec3;
  rotation?: Vec3;
  rotationYDeg?: number;
  scale?: number | Vec3;
  collision?: boolean;
  sensor?: boolean;
  simulatePhysics?: boolean;
  navigationRole?: NavigationRole;
};

const UNIT_CORNERS: readonly Vec3[] = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5],
];

const BOX_EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;

/**
 * A wire overlay for one authored collision primitive. Composes the placement
 * transform (position/rotation/scale) with the primitive's local
 * center/rotation/size, so the shape follows both the model placement and the
 * shape authored in the Static Mesh editor.
 */
function authoredWirebox(
  source: ColliderSource,
  primitive: CollisionPrimitive,
  sensor: boolean,
  navigationRole: NavigationRole,
): CollisionWirebox {
  const place = composeTransformMatrix(source.position, readRotation(source), readScale(source));
  if (primitive.shape === "convex" && primitive.points && primitive.points.length >= 4) {
    const localSegments = convexHullWireSegments(primitive.points);
    const segments = localSegments.map((point) => {
      const world = new Vector3(point[0], point[1], point[2]).applyMatrix4(place);
      return [world.x, world.y, world.z] as Vec3;
    });
    const worldPoints = primitive.points.map((point) => {
      const world = new Vector3(point[0], point[1], point[2]).applyMatrix4(place);
      return world;
    });
    return {
      box: new Box3().setFromPoints(worldPoints),
      segments,
      size: [...primitive.size],
      sensor,
      navigationRole,
    };
  }
  const local = composeTransformMatrix(
    primitive.center ?? [0, 0, 0],
    primitive.rotation ?? [0, 0, 0],
    primitive.size,
  );
  const matrix = place.multiply(local);
  const unitSegments = unitSegmentsForShape(primitive.shape);
  const segments = unitSegments.map((corner) => {
    const point = new Vector3(corner[0], corner[1], corner[2]).applyMatrix4(matrix);
    return [point.x, point.y, point.z] as Vec3;
  });
  const world = segments.length > 0 ? segments : UNIT_CORNERS.map((corner) => {
    const point = new Vector3(corner[0], corner[1], corner[2]).applyMatrix4(matrix);
    return [point.x, point.y, point.z] as Vec3;
  });
  const box = new Box3().setFromPoints(world.map((p) => new Vector3(p[0], p[1], p[2])));
  return {
    box,
    segments,
    size: [...primitive.size],
    sensor,
    navigationRole,
  };
}

/**
 * Wire overlay for a `complexAsSimple` collision: the render mesh's triangle
 * edges under the placement transform. Mirrors the runtime trimesh collider, so
 * "Show Collision" shows the real shape instead of an enclosing box.
 */
function complexWirebox(
  source: ColliderSource,
  mesh: ComplexCollisionMesh,
  sensor: boolean,
  navigationRole: NavigationRole,
): CollisionWirebox {
  const place = composeTransformMatrix(source.position, readRotation(source), readScale(source));
  const world = mesh.vertices.map((point) =>
    new Vector3(point[0], point[1], point[2]).applyMatrix4(place),
  );
  const segments: Vec3[] = [];
  const edge = (a: Vector3 | undefined, b: Vector3 | undefined): void => {
    if (!a || !b) return;
    segments.push([a.x, a.y, a.z], [b.x, b.y, b.z]);
  };
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = world[mesh.indices[t]!];
    const b = world[mesh.indices[t + 1]!];
    const c = world[mesh.indices[t + 2]!];
    edge(a, b);
    edge(b, c);
    edge(c, a);
  }
  const box = new Box3().setFromPoints(world);
  const size = box.getSize(new Vector3());
  return {
    box,
    segments,
    size: [size.x, size.y, size.z],
    sensor,
    navigationRole,
    complexHull: true,
  };
}

function unitSegmentsForShape(shape: CollisionPrimitive["shape"]): Vec3[] {
  if (shape === "sphere") return sphereSegments();
  if (shape === "capsule") return capsuleSegments();
  if (shape === "cylinder") return cylinderSegments();
  if (shape === "cone") return coneSegments();
  return BOX_EDGES.flatMap(([a, b]) => [UNIT_CORNERS[a]!, UNIT_CORNERS[b]!]);
}

function convexHullWireSegments(points: readonly Vec3[]): Vec3[] {
  const edges: Vec3[] = [];
  for (let a = 0; a < points.length - 1; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      if (isConvexHullEdge(points, a, b)) {
        edges.push(points[a]!, points[b]!);
      }
    }
  }
  return edges.length > 0 ? edges : BOX_EDGES.flatMap(([a, b]) => [UNIT_CORNERS[a]!, UNIT_CORNERS[b]!]);
}

function isConvexHullEdge(points: readonly Vec3[], a: number, b: number): boolean {
  const pa = new Vector3(...points[a]!);
  const pb = new Vector3(...points[b]!);
  const edge = pb.clone().sub(pa);
  const supportingPlanes = new Set<string>();
  for (let c = 0; c < points.length; c += 1) {
    if (c === a || c === b) continue;
    const pc = new Vector3(...points[c]!);
    const normal = edge.clone().cross(pc.sub(pa));
    if (normal.lengthSq() < 1e-10) continue;
    normal.normalize();
    let positive = false;
    let negative = false;
    for (const point of points) {
      const distance = normal.dot(new Vector3(point[0], point[1], point[2]).sub(pa));
      if (distance > 1e-5) positive = true;
      if (distance < -1e-5) negative = true;
      if (positive && negative) break;
    }
    if (positive && negative) continue;
    if (negative) normal.multiplyScalar(-1);
    supportingPlanes.add(`${normal.x.toFixed(4)},${normal.y.toFixed(4)},${normal.z.toFixed(4)}`);
    if (supportingPlanes.size >= 2) return true;
  }
  return false;
}

function sphereSegments(): Vec3[] {
  return [
    ...circleSegments("xy", 0, 0.5),
    ...circleSegments("xz", 0, 0.5),
    ...circleSegments("yz", 0, 0.5),
  ];
}

function capsuleSegments(): Vec3[] {
  return [
    ...circleSegments("xz", -0.25, 0.5),
    ...circleSegments("xz", 0.25, 0.5),
    ...circleSegments("xy", 0, 0.5),
    ...circleSegments("yz", 0, 0.5),
  ];
}

function cylinderSegments(): Vec3[] {
  const top = circleSegments("xz", 0.5, 0.5);
  const bottom = circleSegments("xz", -0.5, 0.5);
  const verticals: Vec3[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const x = Math.cos(angle) * 0.5;
    const z = Math.sin(angle) * 0.5;
    verticals.push([x, -0.5, z], [x, 0.5, z]);
  }
  return [...top, ...bottom, ...verticals];
}

function coneSegments(): Vec3[] {
  const base = circleSegments("xz", -0.5, 0.5);
  const sides: Vec3[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    sides.push([Math.cos(angle) * 0.5, -0.5, Math.sin(angle) * 0.5], [0, 0.5, 0]);
  }
  return [...base, ...sides];
}

function circleSegments(plane: "xy" | "xz" | "yz", offset: number, radius: number): Vec3[] {
  const segments: Vec3[] = [];
  const steps = 32;
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const b = ((i + 1) / steps) * Math.PI * 2;
    segments.push(circlePoint(plane, offset, radius, a), circlePoint(plane, offset, radius, b));
  }
  return segments;
}

function circlePoint(
  plane: "xy" | "xz" | "yz",
  offset: number,
  radius: number,
  angle: number,
): Vec3 {
  const a = Math.cos(angle) * radius;
  const b = Math.sin(angle) * radius;
  if (plane === "xy") return [a, b, offset];
  if (plane === "xz") return [a, offset, b];
  return [offset, a, b];
}

function wireboxSegments(position: Vec3, rotation: Vec3, collider: ColliderBox): Vec3[] {
  const half: Vec3 = [collider.size[0] / 2, collider.size[1] / 2, collider.size[2] / 2];
  const localCorners: Vec3[] = [
    [-half[0], -half[1], -half[2]],
    [half[0], -half[1], -half[2]],
    [half[0], half[1], -half[2]],
    [-half[0], half[1], -half[2]],
    [-half[0], -half[1], half[2]],
    [half[0], -half[1], half[2]],
    [half[0], half[1], half[2]],
    [-half[0], half[1], half[2]],
  ];
  const corners: Vec3[] = localCorners.map((corner) => [
    corner[0] + collider.center[0],
    corner[1] + collider.center[1],
    corner[2] + collider.center[2],
  ]);
  const matrix = composeTransformMatrix(position, rotation, [1, 1, 1]);
  const world = corners.map((corner) => {
    const point = new Vector3(...corner).applyMatrix4(matrix);
    return [point.x, point.y, point.z] as Vec3;
  });
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const;
  return edges.flatMap(([a, b]) => [world[a]!, world[b]!]);
}

function boxFromColliderBox(position: Vec3, collider: ColliderBox): Box3 {
  const center = new Vector3(
    position[0] + collider.center[0],
    position[1] + collider.center[1],
    position[2] + collider.center[2],
  );
  const half = new Vector3(collider.size[0] / 2, collider.size[1] / 2, collider.size[2] / 2);
  return new Box3(center.clone().sub(half), center.clone().add(half));
}
