/**
 * Puts impact dents on real geometry (DEFORMABLE_FRACTURABLE Faz 7). The dent
 * math is in `impactDeform.ts`; this file owns the Three.js side for one object:
 *
 * - Model geometry is shared between every copy of an asset, so a mesh gets its
 *   own copy the moment a dent first touches it. Until then nothing is written.
 * - Vertex data arrives quantized or interleaved from optimized GLBs, so the
 *   copy's `position` and `normal` are unpacked into plain floats.
 * - Dent space is the object's root space with its scale applied (see
 *   `impactDeform.ts`), so a radius means world metres on a scaled placement and
 *   on a quantized mesh whose node matrix carries a large scale.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix3,
  Matrix4,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
  type Mesh,
  type Object3D,
} from "three";

import {
  applyDent,
  createDentSurface,
  locateDent,
  planDent,
  type Dent,
  type DentChange,
  type DentParams,
  type DentSurface,
  type DentVec3,
} from "../physics/deformable/impactDeform";

/** Geometry this file copied; the mesh's owner must not treat it as the shared model. */
const DEFORM_CLONE_FLAG = "forgeDeformClone";
/** A mesh-paint clone already belongs to its placement and is freed with it. */
const MESH_PAINT_CLONE_FLAG = "forgeMeshPaintClone";

/** What a hit did. */
export type DentOutcome = "dented" | "skipped" | "missed";

export interface DentTargetOptions {
  /** Meshes left rigid, such as a vehicle's wheels. */
  readonly exclude?: (mesh: Mesh) => boolean;
}

interface DentMesh {
  readonly mesh: Mesh;
  /** The geometry to give back on dispose. */
  readonly original: BufferGeometry;
  readonly surface: DentSurface;
  /** Mesh space → dent space, linear part: rest vertices are already transformed. */
  readonly restLocal: Float32Array;
  readonly restLocalNormals: Float32Array;
  readonly dentToLocal: Matrix3;
  readonly normalToLocal: Matrix3;
  /** Metres in dent space → mesh-space units, at most. */
  readonly localScale: number;
  /** The copy, once a dent has touched this mesh. */
  written: BufferGeometry | null;
}

const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;
const isSkinned = (mesh: Mesh): boolean => (mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh === true;

/** Plain floats of a possibly quantized or interleaved attribute. */
function unpackAttribute(attribute: BufferAttribute | InterleavedBufferAttribute, itemSize: 3): Float32Array {
  const values = new Float32Array(attribute.count * itemSize);
  for (let index = 0; index < attribute.count; index += 1) {
    values[index * 3] = attribute.getX(index);
    values[index * 3 + 1] = attribute.getY(index);
    values[index * 3 + 2] = attribute.getZ(index);
  }
  return values;
}

const SCRATCH = new Vector3();
const SCRATCH_MATRIX = new Matrix4();

/** The dent state of one object: its dent list and the meshes they land on. */
export class DentTarget {
  private meshes: DentMesh[] | null = null;
  private readonly dents: Dent[] = [];

  constructor(
    private readonly root: Object3D,
    private readonly options: DentTargetOptions = {},
  ) {}

  /** The object's dents, in dent space. */
  get dentList(): readonly Dent[] {
    return this.dents;
  }

  /** The object this target writes to; a rebuilt clone needs a new target. */
  get object(): Object3D {
    return this.root;
  }

  /** Dents the object where an impact landed. `direction` is a world unit vector, into the object. */
  hit(point: DentVec3, direction: DentVec3, depth: number, params: DentParams): DentOutcome {
    if (!(depth > 0)) return "skipped";
    const meshes = this.ensureMeshes();
    if (meshes.length === 0) return "missed";
    const worldToDent = this.worldToDent();
    const localPoint = SCRATCH.fromArray(point).applyMatrix4(worldToDent);
    const hitPoint: DentVec3 = [localPoint.x, localPoint.y, localPoint.z];
    const localDirection = SCRATCH.fromArray(direction).transformDirection(worldToDent);
    const dentDirection: DentVec3 = [localDirection.x, localDirection.y, localDirection.z];
    const centre = locateDent(meshes.map((item) => item.surface), hitPoint, dentDirection, params.radius);
    if (!centre) return "missed";
    const plan = planDent(this.dents, centre, dentDirection, depth, params);
    if (plan.kind === "skip") return "skipped";
    if (plan.kind === "add") {
      this.dents.push(plan.dent);
      this.push(plan.dent, params);
      return "dented";
    }
    const existing = this.dents[plan.index]!;
    this.dents[plan.index] = { ...existing, depth: existing.depth + plan.extra };
    this.push({ ...existing, depth: plan.extra }, params);
    return "dented";
  }

  /** Reapplies a saved dent list on a fresh object; the result equals the live shape. */
  restore(dents: readonly Dent[], params: DentParams): void {
    for (const dent of dents.slice(0, params.maxDents)) {
      this.dents.push(dent);
      this.push(dent, params);
    }
  }

  /** Gives the object its shared geometry back and frees the copies. */
  dispose(): void {
    for (const item of this.meshes ?? []) {
      if (!item.written) continue;
      item.mesh.geometry = item.original;
      if (item.written.userData[DEFORM_CLONE_FLAG] === true) item.written.dispose();
    }
    this.meshes = null;
    this.dents.length = 0;
  }

  private push(dent: Dent, params: DentParams): void {
    for (const item of this.ensureMeshes()) {
      const change = applyDent(item.surface, dent, params);
      if (change.moved > 0) this.write(item, change, params);
    }
  }

  private write(item: DentMesh, change: DentChange, params: DentParams): void {
    const geometry = item.written ?? this.takeOwnership(item, params);
    const positions = geometry.getAttribute("position") as BufferAttribute;
    const normals = geometry.getAttribute("normal") as BufferAttribute;
    const { surface, restLocal, dentToLocal, normalToLocal } = item;
    for (const vertex of change.changed) {
      const offset = vertex * 3;
      SCRATCH.set(
        surface.positions[offset]! - surface.rest[offset]!,
        surface.positions[offset + 1]! - surface.rest[offset + 1]!,
        surface.positions[offset + 2]! - surface.rest[offset + 2]!,
      ).applyMatrix3(dentToLocal);
      positions.setXYZ(vertex, restLocal[offset]! + SCRATCH.x, restLocal[offset + 1]! + SCRATCH.y, restLocal[offset + 2]! + SCRATCH.z);
      SCRATCH.set(surface.normals[offset]!, surface.normals[offset + 1]!, surface.normals[offset + 2]!)
        .applyMatrix3(normalToLocal)
        .normalize();
      normals.setXYZ(vertex, SCRATCH.x, SCRATCH.y, SCRATCH.z);
    }
    positions.needsUpdate = true;
    normals.needsUpdate = true;
  }

  private takeOwnership(item: DentMesh, params: DentParams): BufferGeometry {
    const shared = item.mesh.geometry;
    const owned = shared.userData[MESH_PAINT_CLONE_FLAG] === true;
    const geometry = owned ? shared : shared.clone();
    // `clone()` shares userData with the source: a flag written into it would mark the shared model.
    if (!owned) geometry.userData = { ...shared.userData, [DEFORM_CLONE_FLAG]: true };
    geometry.setAttribute("position", new Float32BufferAttribute(item.restLocal.slice(), 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(item.restLocalNormals.slice(), 3));
    // Dents stay within maxDepth of rest, so bounds grow once instead of every dent.
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const margin = params.maxDepth * item.localScale;
    geometry.boundingBox!.expandByScalar(margin);
    geometry.boundingSphere!.radius += margin;
    item.mesh.geometry = geometry;
    item.written = geometry;
    return geometry;
  }

  /** World → dent space: the root's inverse with its scale put back. */
  private worldToDent(): Matrix4 {
    this.root.updateWorldMatrix(true, false);
    const scale = SCRATCH.setFromMatrixScale(this.root.matrixWorld);
    return new Matrix4().makeScale(scale.x, scale.y, scale.z).multiply(SCRATCH_MATRIX.copy(this.root.matrixWorld).invert());
  }

  /** Reads every eligible mesh once, on the first hit or restore. */
  private ensureMeshes(): DentMesh[] {
    if (this.meshes) return this.meshes;
    this.root.updateWorldMatrix(true, true);
    const worldToDent = this.worldToDent();
    const meshes: DentMesh[] = [];
    this.root.traverse((object) => {
      if (!isMesh(object) || isSkinned(object) || this.options.exclude?.(object)) return;
      const item = this.readMesh(object, worldToDent);
      if (item) meshes.push(item);
    });
    this.meshes = meshes;
    return meshes;
  }

  private readMesh(mesh: Mesh, worldToDent: Matrix4): DentMesh | null {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position || position.itemSize !== 3 || position.count === 0) return null;
    const restLocal = unpackAttribute(position, 3);
    let normal = geometry.getAttribute("normal");
    if (!normal) {
      const lit = geometry.clone();
      lit.computeVertexNormals();
      normal = lit.getAttribute("normal");
      lit.dispose();
    }
    const restLocalNormals = unpackAttribute(normal, 3);
    const toDent = new Matrix4().multiplyMatrices(worldToDent, mesh.matrixWorld);
    const linear = new Matrix3().setFromMatrix4(toDent);
    const dentToLocal = linear.clone().invert();
    /** Normals go to dent space by the inverse transpose, and back by the transpose. */
    const normalToDent = dentToLocal.clone().transpose();
    const normalToLocal = linear.clone().transpose();
    const rest = new Float32Array(restLocal.length);
    const restNormals = new Float32Array(restLocalNormals.length);
    for (let offset = 0; offset < rest.length; offset += 3) {
      SCRATCH.set(restLocal[offset]!, restLocal[offset + 1]!, restLocal[offset + 2]!).applyMatrix4(toDent).toArray(rest, offset);
      SCRATCH.set(restLocalNormals[offset]!, restLocalNormals[offset + 1]!, restLocalNormals[offset + 2]!)
        .applyMatrix3(normalToDent)
        .normalize()
        .toArray(restNormals, offset);
    }
    const index = geometry.getIndex();
    const elements = dentToLocal.elements;
    return {
      mesh,
      original: geometry,
      surface: createDentSurface({ positions: rest, normals: restNormals, indices: index ? index.array : null }),
      restLocal,
      restLocalNormals,
      dentToLocal,
      normalToLocal,
      localScale: Math.max(
        Math.hypot(elements[0]!, elements[1]!, elements[2]!),
        Math.hypot(elements[3]!, elements[4]!, elements[5]!),
        Math.hypot(elements[6]!, elements[7]!, elements[8]!),
      ),
      written: null,
    };
  }
}
