import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Matrix4,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import type { FractureChunk } from "../physics/fracture/fractureBake";
import type { FractureSourceMesh } from "../physics/fracture/voronoiFracture";

/**
 * The three.js side of pre-baked fracture (DEFORMABLE_FRACTURABLE_WORK_PLAN
 * Faz 3): turns a loaded model into the plain `FractureSourceMesh` the pure
 * bake reads, and a baked chunk back into a `BufferGeometry`. The editor
 * preview and the runtime both go through here, so the mesh they hash and
 * bake is byte-for-byte the same.
 */

export interface FractureModelSource {
  /** Every mesh of the model merged in the model root's space. */
  readonly mesh: FractureSourceMesh;
  /** Distinct materials in traversal order; chunk exteriors use the first. */
  readonly materials: readonly Material[];
  readonly meshCount: number;
}

const point = new Vector3();
const toRoot = new Matrix4();
const rootInverse = new Matrix4();
const normalMatrix = new Matrix3();

/**
 * Merges the model's meshes (skinned and instanced ones excluded) into one
 * triangle list in `root`'s local space: node transforms are applied to
 * positions, their normal matrix to normals. A mesh without normals gets
 * computed ones; one without UVs contributes zeros. Traversal order is the
 * scene graph order, so the result (and its hash) is deterministic.
 */
export function fractureSourceFromObject(root: Object3D): FractureModelSource {
  root.updateMatrixWorld(true);
  rootInverse.copy(root.matrixWorld).invert();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const materials: Material[] = [];
  let meshCount = 0;
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || (node as { isSkinnedMesh?: boolean }).isSkinnedMesh || (node as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    meshCount += 1;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!materials.includes(material)) materials.push(material);
    }
    let normal = geometry.getAttribute("normal");
    if (!normal) {
      const withNormals = geometry.clone();
      withNormals.computeVertexNormals();
      normal = withNormals.getAttribute("normal");
      withNormals.dispose();
    }
    const uv = geometry.getAttribute("uv");
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    normalMatrix.getNormalMatrix(toRoot);
    const base = positions.length / 3;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(toRoot);
      positions.push(point.x, point.y, point.z);
      point.fromBufferAttribute(normal, index).applyMatrix3(normalMatrix).normalize();
      normals.push(point.x, point.y, point.z);
      uvs.push(uv ? uv.getX(index) : 0, uv ? uv.getY(index) : 0);
    }
    // A mirrored node (negative determinant) flips winding; restore it so the
    // merged mesh keeps outward faces.
    const flip = toRoot.determinant() < 0;
    const source = geometry.getIndex();
    const triangleCount = Math.floor((source ? source.count : position.count) / 3);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const a = source ? source.getX(triangle * 3) : triangle * 3;
      const b = source ? source.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const c = source ? source.getX(triangle * 3 + 2) : triangle * 3 + 2;
      if (flip) indices.push(base + a, base + c, base + b);
      else indices.push(base + a, base + b, base + c);
    }
  });
  return {
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
    },
    materials,
    meshCount,
  };
}

/**
 * A chunk's render geometry, positions relative to its pivot (place the mesh
 * at `chunk.pivot` in the model's space). Group 0 draws with the exterior
 * material, group 1 with the interior one.
 */
export function fractureChunkGeometry(chunk: FractureChunk): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(chunk.geometry.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(chunk.geometry.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(chunk.geometry.uvs, 2));
  geometry.setIndex(new BufferAttribute(chunk.geometry.indices, 1));
  for (const group of chunk.geometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
