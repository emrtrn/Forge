import { Box3, Matrix4, Plane, Vector3 } from "three";

export interface RiverReflectionMesh {
  positions: readonly number[];
  indices: readonly number[];
  bedDepths: readonly number[];
}
export interface RiverReflectionPatch {
  plane: Plane;
  bounds: Box3;
  /** Incident-triangle weights give continuous interpolation across patch seams. */
  weights: Map<number, number>;
}
export const RIVER_REFLECTION_MAX_ANGLE = 3 * Math.PI / 180;
export const RIVER_REFLECTION_MAX_DISTANCE = 0.1;

/** Partition the undeformed, wet world-space mesh. Anchored planes prevent
 * gradual slope changes from accumulating into a single incorrect plane. */
export function riverReflectionPatches(mesh: RiverReflectionMesh, world = new Matrix4()): RiverReflectionPatch[] {
  const vertices: Vector3[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) vertices.push(new Vector3().fromArray(mesh.positions, i).applyMatrix4(world));
  const faces: { vertices: number[]; plane: Plane }[] = [];
  const incidents = new Map<number, number[]>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = mesh.indices.slice(i, i + 3);
    if (ids.every(v => mesh.bedDepths[v]! <= 0)) continue;
    const [a, b, c] = ids.map(v => vertices[v]!);
    const plane = new Plane().setFromCoplanarPoints(a!, b!, c!);
    if (plane.normal.lengthSq() < 0.5) continue;
    if (plane.normal.y < 0) plane.negate();
    const index = faces.length;
    faces.push({ vertices: ids, plane });
    for (const id of ids) {
      let list = incidents.get(id);
      if (!list) incidents.set(id, list = []);
      list.push(index);
    }
  }
  const visited = new Uint8Array(faces.length), patches: RiverReflectionPatch[] = [];
  const cosine = Math.cos(RIVER_REFLECTION_MAX_ANGLE);
  for (let seed = 0; seed < faces.length; seed++) {
    if (visited[seed]) continue;
    const plane = faces[seed]!.plane.clone(), patch = { plane, bounds: new Box3(), weights: new Map<number, number>() };
    const pending = [seed]; visited[seed] = 1;
    while (pending.length) {
      const face = faces[pending.pop()!]!;
      for (const v of face.vertices) {
        patch.bounds.expandByPoint(vertices[v]!);
        patch.weights.set(v, (patch.weights.get(v) ?? 0) + 1 / incidents.get(v)!.length);
        for (const neighbor of incidents.get(v)!) {
          if (visited[neighbor]) continue;
          const other = faces[neighbor]!;
          if (plane.normal.dot(other.plane.normal) < cosine || other.vertices.some(id => Math.abs(plane.distanceToPoint(vertices[id]!)) > RIVER_REFLECTION_MAX_DISTANCE)) continue;
          visited[neighbor] = 1; pending.push(neighbor);
        }
      }
    }
    patches.push(patch);
  }
  return patches;
}
