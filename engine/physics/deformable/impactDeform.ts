/**
 * Permanent impact dents on vertex data (DEFORMABLE_FRACTURABLE Faz 7). Pure: no
 * Rapier, no Three.js; `deformableMeshSync.ts` copies the results into geometry.
 *
 * Everything here is in "dent space": the object's root space with its scale
 * applied, so distances are world metres while the object may still move and
 * turn. A dent is a sphere of `radius` around a surface point, pushing vertices
 * along `direction` with a smooth falloff.
 *
 * Each vertex keeps the plain sum of every dent's push and shows it clamped to
 * `maxDepth`. The sum does not depend on order and the clamp is a function of
 * the sum, so a save-game replay of the dent list gives the live shape exactly.
 *
 * Normals only change by what the dent changed: a vertex's new normal is its
 * authored normal plus the change in its surrounding face normal. Vertices at
 * one position with close normals (a UV seam) are treated as one, so a seam
 * stays smooth, while a hard edge keeps its crease.
 */

export type DentVec3 = readonly [number, number, number];

/** One dent, in dent space. This is what a save-game keeps. */
export interface Dent {
  /** Centre of the dent, on the surface. */
  readonly point: DentVec3;
  /** Unit direction the surface was pushed in. */
  readonly direction: DentVec3;
  /** How far the centre was pushed, metres. */
  readonly depth: number;
}

export interface DentParams {
  readonly dentImpulse: number;
  readonly fullImpulse: number;
  readonly radius: number;
  readonly maxDepth: number;
  readonly plasticity: number;
  readonly maxDents: number;
}

/** One mesh's vertices in dent space, with the working buffers of its dents. */
export interface DentSurface {
  readonly vertexCount: number;
  readonly rest: Float32Array;
  readonly restNormals: Float32Array;
  /** Rest position plus the clamped sum of the dents; read by the mesh sync. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Unclamped sum of every dent's push, per vertex. */
  readonly pushes: Float32Array;
  readonly triangles: Uint32Array;
  /** Vertex → its triangles: `vertexTriangles[vertexTriangleStart[v]..vertexTriangleStart[v + 1]]`. */
  readonly vertexTriangleStart: Uint32Array;
  readonly vertexTriangles: Uint32Array;
  /** Vertex → its weld group. */
  readonly groupOf: Uint32Array;
  /** Group → its vertices, same layout as the triangle lists. */
  readonly groupStart: Uint32Array;
  readonly groupMembers: Uint32Array;
}

export interface DentSurfaceInput {
  readonly positions: ArrayLike<number>;
  readonly normals: ArrayLike<number>;
  /** Triangle indices; null = every three vertices are a triangle. */
  readonly indices: ArrayLike<number> | null;
}

/** Vertices closer than this share a weld position, metres. */
const WELD_TOLERANCE = 1e-4;
/** Normals at one position with a dot above this are one smooth surface (≈ 30°). */
const WELD_MIN_DOT = 0.866;
/** How far along the hit line the surface is looked for, as radii. */
const SEARCH_REACH_RADII = 4;
/** A collider can sit well off the mesh, whatever the dent's radius. */
const SEARCH_REACH_MIN = 0.75;
/** A merged dent stays near its first centre: this share of the radius. */
const MERGE_RADII = 0.5;

/** Builds the surface once for a mesh; costs one pass over vertices and triangles. */
export function createDentSurface(input: DentSurfaceInput): DentSurface {
  const vertexCount = Math.floor(input.positions.length / 3);
  const rest = Float32Array.from(input.positions as ArrayLike<number>);
  const restNormals = Float32Array.from(input.normals as ArrayLike<number>);
  const triangles = input.indices
    ? Uint32Array.from(input.indices as ArrayLike<number>)
    : Uint32Array.from({ length: vertexCount - (vertexCount % 3) }, (_, index) => index);

  const vertexTriangleStart = new Uint32Array(vertexCount + 1);
  for (const vertex of triangles) vertexTriangleStart[vertex + 1]! += 1;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) vertexTriangleStart[vertex + 1]! += vertexTriangleStart[vertex]!;
  const vertexTriangles = new Uint32Array(triangles.length);
  const cursor = vertexTriangleStart.slice(0, vertexCount);
  for (let corner = 0; corner < triangles.length; corner += 1) {
    const vertex = triangles[corner]!;
    vertexTriangles[cursor[vertex]!] = Math.floor(corner / 3);
    cursor[vertex]! += 1;
  }

  const { groupOf, groupStart, groupMembers } = weldVertices(rest, restNormals, vertexCount);
  return {
    vertexCount,
    rest,
    restNormals,
    positions: rest.slice(),
    normals: restNormals.slice(),
    pushes: new Float32Array(rest.length),
    triangles,
    vertexTriangleStart,
    vertexTriangles,
    groupOf,
    groupStart,
    groupMembers,
  };
}

function weldVertices(rest: Float32Array, normals: Float32Array, vertexCount: number): {
  groupOf: Uint32Array; groupStart: Uint32Array; groupMembers: Uint32Array;
} {
  const groupOf = new Uint32Array(vertexCount);
  const byPosition = new Map<string, number[]>();
  /** The first vertex of each group, whose normal the others are compared with. */
  const firstOfGroup: number[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const key = `${Math.round(rest[offset]! / WELD_TOLERANCE)},${Math.round(rest[offset + 1]! / WELD_TOLERANCE)},${Math.round(rest[offset + 2]! / WELD_TOLERANCE)}`;
    const groups = byPosition.get(key);
    const match = groups?.find((group) => {
      const other = firstOfGroup[group]! * 3;
      return normals[offset]! * normals[other]! + normals[offset + 1]! * normals[other + 1]! + normals[offset + 2]! * normals[other + 2]! >= WELD_MIN_DOT;
    });
    if (match !== undefined) {
      groupOf[vertex] = match;
      continue;
    }
    const group = firstOfGroup.length;
    firstOfGroup.push(vertex);
    groupOf[vertex] = group;
    if (groups) groups.push(group);
    else byPosition.set(key, [group]);
  }
  const groupStart = new Uint32Array(firstOfGroup.length + 1);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) groupStart[groupOf[vertex]! + 1]! += 1;
  for (let group = 0; group < firstOfGroup.length; group += 1) groupStart[group + 1]! += groupStart[group]!;
  const groupMembers = new Uint32Array(vertexCount);
  const cursor = groupStart.slice(0, firstOfGroup.length);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const group = groupOf[vertex]!;
    groupMembers[cursor[group]!] = vertex;
    cursor[group]! += 1;
  }
  return { groupOf, groupStart, groupMembers };
}

/** How deep one hit dents: nothing below `dentImpulse`, full at `fullImpulse`. */
export function dentDepthForImpulse(params: DentParams, impulse: number): number {
  if (!Number.isFinite(impulse) || impulse < params.dentImpulse) return 0;
  const strength = Math.min(1, (impulse - params.dentImpulse) / (params.fullImpulse - params.dentImpulse));
  return params.maxDepth * params.plasticity * strength;
}

/**
 * Finds where a hit lands on the mesh. A contact point lies on the collider,
 * which may sit away from the model, so the surface is searched along the hit
 * line: of the vertices within `radius` of the line that face the striker, the
 * first one from its side. Null when no vertex is near (a sparse mesh, a
 * collider far off the model).
 */
export function locateDent(
  surfaces: readonly DentSurface[],
  hitPoint: DentVec3,
  direction: DentVec3,
  radius: number,
): DentVec3 | null {
  const reach = Math.max(SEARCH_REACH_MIN, radius * SEARCH_REACH_RADII);
  const radiusSquared = radius * radius;
  const [px, py, pz] = hitPoint;
  const [dx, dy, dz] = direction;
  let nearest = Number.POSITIVE_INFINITY;
  for (const surface of surfaces) {
    const { positions, normals, vertexCount } = surface;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = vertex * 3;
      if (normals[offset]! * dx + normals[offset + 1]! * dy + normals[offset + 2]! * dz >= 0) continue;
      const qx = positions[offset]! - px;
      const qy = positions[offset + 1]! - py;
      const qz = positions[offset + 2]! - pz;
      const along = qx * dx + qy * dy + qz * dz;
      if (along < -reach || along > reach || along >= nearest) continue;
      if (qx * qx + qy * qy + qz * qz - along * along <= radiusSquared) nearest = along;
    }
  }
  return nearest === Number.POSITIVE_INFINITY ? null : [px + dx * nearest, py + dy * nearest, pz + dz * nearest];
}

/** What a new hit does to an object's dent list. */
export type DentPlan =
  | { readonly kind: "add"; readonly dent: Dent }
  /** Deepen `dents[index]` by `extra`, at that dent's own centre and direction. */
  | { readonly kind: "deepen"; readonly index: number; readonly extra: number }
  | { readonly kind: "skip" };

/**
 * Keeps the list bounded: a hit on an existing dent deepens it, one elsewhere
 * adds a dent while there is room. A full list still takes hits near a dent,
 * further out it stops changing.
 */
export function planDent(dents: readonly Dent[], point: DentVec3, direction: DentVec3, depth: number, params: DentParams): DentPlan {
  if (!(depth > 0)) return { kind: "skip" };
  let nearest = -1;
  let nearestSquared = Number.POSITIVE_INFINITY;
  dents.forEach((dent, index) => {
    if (dent.direction[0] * direction[0] + dent.direction[1] * direction[1] + dent.direction[2] * direction[2] <= 0) return;
    const x = dent.point[0] - point[0];
    const y = dent.point[1] - point[1];
    const z = dent.point[2] - point[2];
    const squared = x * x + y * y + z * z;
    if (squared < nearestSquared) {
      nearest = index;
      nearestSquared = squared;
    }
  });
  const room = dents.length < params.maxDents;
  const reach = params.radius * (room ? MERGE_RADII : 1);
  if (nearest >= 0 && nearestSquared <= reach * reach) {
    const extra = Math.min(depth, params.maxDepth - dents[nearest]!.depth);
    return extra > 0 ? { kind: "deepen", index: nearest, extra } : { kind: "skip" };
  }
  return room ? { kind: "add", dent: { point, direction, depth } } : { kind: "skip" };
}

/** Result of a dent on one surface. */
export interface DentChange {
  /** Vertices that moved. */
  readonly moved: number;
  /** Vertices whose position or normal changed; empty when the dent missed this surface. */
  readonly changed: Uint32Array;
}

const NO_CHANGE: DentChange = { moved: 0, changed: new Uint32Array(0) };

/** Applies one dent's push to a surface, moving vertices and repairing normals around them. */
export function applyDent(surface: DentSurface, dent: Dent, params: Pick<DentParams, "radius" | "maxDepth">): DentChange {
  const { rest, positions, pushes, vertexCount } = surface;
  const { radius, maxDepth } = params;
  const radiusSquared = radius * radius;
  const [cx, cy, cz] = dent.point;
  const [dx, dy, dz] = dent.direction;
  const moved: number[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const rx = rest[offset]! - cx;
    const ry = rest[offset + 1]! - cy;
    const rz = rest[offset + 2]! - cz;
    const squared = rx * rx + ry * ry + rz * rz;
    if (squared >= radiusSquared) continue;
    const falloff = 1 - squared / radiusSquared;
    const push = dent.depth * falloff * falloff;
    const x = pushes[offset]! + dx * push;
    const y = pushes[offset + 1]! + dy * push;
    const z = pushes[offset + 2]! + dz * push;
    pushes[offset] = x;
    pushes[offset + 1] = y;
    pushes[offset + 2] = z;
    const length = Math.hypot(x, y, z);
    const scale = length > maxDepth ? maxDepth / length : 1;
    positions[offset] = rest[offset]! + x * scale;
    positions[offset + 1] = rest[offset + 1]! + y * scale;
    positions[offset + 2] = rest[offset + 2]! + z * scale;
    moved.push(vertex);
  }
  if (moved.length === 0) return NO_CHANGE;
  return { moved: moved.length, changed: repairNormals(surface, moved) };
}

/** Faces around the moved vertices changed, so every vertex of those faces gets a new normal. */
function repairNormals(surface: DentSurface, moved: readonly number[]): Uint32Array {
  const { triangles, vertexTriangleStart, vertexTriangles, groupOf, groupStart, groupMembers, restNormals, normals } = surface;
  const faces = new Set<number>();
  for (const vertex of moved) {
    for (let cursor = vertexTriangleStart[vertex]!; cursor < vertexTriangleStart[vertex + 1]!; cursor += 1) faces.add(vertexTriangles[cursor]!);
  }
  const groups = new Set<number>();
  for (const face of faces) {
    for (let corner = 0; corner < 3; corner += 1) groups.add(groupOf[triangles[face * 3 + corner]!]!);
  }
  const changed: number[] = [];
  const now: [number, number, number] = [0, 0, 0];
  const before: [number, number, number] = [0, 0, 0];
  for (const group of groups) {
    now.fill(0);
    before.fill(0);
    for (let member = groupStart[group]!; member < groupStart[group + 1]!; member += 1) {
      const vertex = groupMembers[member]!;
      for (let cursor = vertexTriangleStart[vertex]!; cursor < vertexTriangleStart[vertex + 1]!; cursor += 1) {
        const face = vertexTriangles[cursor]!;
        addFaceNormal(now, surface.positions, triangles, face);
        addFaceNormal(before, surface.rest, triangles, face);
      }
    }
    const nowLength = Math.hypot(now[0], now[1], now[2]);
    const beforeLength = Math.hypot(before[0], before[1], before[2]);
    for (let member = groupStart[group]!; member < groupStart[group + 1]!; member += 1) {
      const vertex = groupMembers[member]!;
      const offset = vertex * 3;
      changed.push(vertex);
      if (nowLength === 0 || beforeLength === 0) continue;
      const x = restNormals[offset]! + now[0] / nowLength - before[0] / beforeLength;
      const y = restNormals[offset + 1]! + now[1] / nowLength - before[1] / beforeLength;
      const z = restNormals[offset + 2]! + now[2] / nowLength - before[2] / beforeLength;
      const length = Math.hypot(x, y, z);
      if (length === 0) continue;
      normals[offset] = x / length;
      normals[offset + 1] = y / length;
      normals[offset + 2] = z / length;
    }
  }
  return Uint32Array.from(changed);
}

/** Adds a face's area-weighted normal. */
function addFaceNormal(target: [number, number, number], positions: Float32Array, triangles: Uint32Array, face: number): void {
  const a = triangles[face * 3]! * 3;
  const b = triangles[face * 3 + 1]! * 3;
  const c = triangles[face * 3 + 2]! * 3;
  const ux = positions[b]! - positions[a]!;
  const uy = positions[b + 1]! - positions[a + 1]!;
  const uz = positions[b + 2]! - positions[a + 2]!;
  const vx = positions[c]! - positions[a]!;
  const vy = positions[c + 1]! - positions[a + 1]!;
  const vz = positions[c + 2]! - positions[a + 2]!;
  target[0] += uy * vz - uz * vy;
  target[1] += uz * vx - ux * vz;
  target[2] += ux * vy - uy * vx;
}
