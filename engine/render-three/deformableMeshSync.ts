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
 * - A model with parts dents piece by piece: a hit in a part's zone only touches
 *   that part's meshes. If it finds no surface there it lands on the body.
 * - A part that tears off moves as it is: its live nodes change parent, so the
 *   dents, materials and world pose carry over. Nothing is swapped for a clean copy.
 * - A part whose node sits under another part's node rides on it, as a mirror on a
 *   door: it can leave alone, and leaves with the part that carries it.
 */
import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Matrix4,
  Quaternion,
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
  resolveDentPart,
  type Dent,
  type DentChange,
  type DentParams,
  type DentPart,
  type DentSurface,
  type DentVec3,
} from "../physics/deformable/impactDeform";
import { DENT_WEAR_ATTRIBUTE } from "./dentWear";

/** Geometry this file copied; the mesh's owner must not treat it as the shared model. */
const DEFORM_CLONE_FLAG = "forgeDeformClone";
/** A mesh-paint clone already belongs to its placement and is freed with it. */
const MESH_PAINT_CLONE_FLAG = "forgeMeshPaintClone";

/** A part that left its object, ready for the caller to give it a body. */
export interface DetachedPiece {
  /** Holds the part's live nodes; not in any scene yet. */
  readonly object: Group;
  /** World centre of the part, which is the body's origin. */
  readonly position: DentVec3;
  /** Euler degrees, XYZ order. */
  readonly rotation: DentVec3;
  /** Corners of the part's box around `position`, in body axes, metres. */
  readonly hull: readonly DentVec3[];
  /** World unit vector away from the object, level with its base; zero at its centre. */
  readonly outward: DentVec3;
  /** Frees the dented geometry; call after the object leaves the scene. */
  dispose(): void;
  /** Puts the part back where it came from, undented; the piece is finished. */
  reattach(): void;
}

/** What a hit did. */
export type DentOutcome = "dented" | "skipped" | "missed";

export interface DentTargetOptions {
  /** Meshes left rigid, such as a vehicle's wheels. */
  readonly exclude?: (mesh: Mesh) => boolean;
  /** The object's parts; without them it dents as one surface. */
  readonly parts?: readonly DentPart[] | undefined;
}

interface DentMesh {
  readonly mesh: Mesh;
  /** The part it belongs to; null = the body. */
  readonly part: string | null;
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
  private moved = 0;
  private landedOn: string | null = null;
  private readonly detached = new Set<string>();
  /** Nodes {@link removePart} took away, for {@link dispose} to put back. */
  private removed: { node: Object3D; parent: Object3D | null }[] = [];

  constructor(
    private readonly root: Object3D,
    private readonly options: DentTargetOptions = {},
  ) {}

  /** The object's dents, in dent space. */
  get dentList(): readonly Dent[] {
    return this.dents;
  }

  /** Vertices the latest hit moved, across the object's meshes. */
  get lastMoved(): number {
    return this.moved;
  }

  /** The part the latest hit landed on; null = the body. */
  get lastPart(): string | null {
    return this.landedOn;
  }

  /** The object this target writes to; a rebuilt clone needs a new target. */
  get object(): Object3D {
    return this.root;
  }

  /** The part a world-space hit lands on; null = the body. */
  partAt(point: DentVec3, direction: DentVec3, radius: number): string | null {
    if (!this.options.parts?.length) return null;
    const hit = this.toDentSpace(point, direction);
    return this.zonePart(hit.point, hit.direction, radius);
  }

  /** Parts that matched no mesh of the model: their node names are wrong. */
  unmatchedParts(): string[] {
    const meshes = this.ensureMeshes();
    return (this.options.parts ?? []).flatMap(({ id }) => this.detached.has(id) || meshes.some((item) => item.part === id) ? [] : [id]);
  }

  /** Takes a part off the object with its dents; null when it has nothing left to take. */
  detachPart(id: string): DetachedPiece | null {
    const meshes = this.ensureMeshes();
    const own = meshes.filter((item) => item.part === id);
    if (own.length === 0) return null;
    const nodes = this.partNodes(own);
    const riders = this.ridersOf(id, nodes);
    const items = meshes.filter((item) => item.part === id || riders.has(item.part));
    const homes = nodes.map((node) => ({
      node, parent: node.parent, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
    }));

    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const { surface: { positions } } of items) {
      for (let offset = 0; offset < positions.length; offset += 3) {
        SCRATCH.fromArray(positions, offset);
        min.min(SCRATCH);
        max.max(SCRATCH);
      }
    }
    const centre = min.clone().add(max).multiplyScalar(0.5);
    const half = max.clone().sub(centre);
    const hull: DentVec3[] = [];
    for (const x of [-half.x, half.x]) {
      for (const y of [-half.y, half.y]) {
        for (const z of [-half.z, half.z]) hull.push([x, y, z]);
      }
    }

    const dentToWorld = this.worldToDent().invert();
    const quaternion = this.root.getWorldQuaternion(new Quaternion());
    const object = new Group();
    object.name = `detached-${id}`;
    object.position.copy(centre).applyMatrix4(dentToWorld);
    object.quaternion.copy(quaternion);
    object.updateMatrixWorld(true);
    for (const node of nodes) object.attach(node);

    this.forgetPart(id);
    for (const rider of riders) this.forgetPart(rider!);
    const outward = new Vector3(centre.x, 0, centre.z);
    if (outward.lengthSq() > 0) outward.normalize().applyQuaternion(quaternion);
    const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
    const degrees = 180 / Math.PI;
    return {
      object,
      position: [object.position.x, object.position.y, object.position.z],
      rotation: [euler.x * degrees, euler.y * degrees, euler.z * degrees],
      hull,
      outward: [outward.x, outward.y, outward.z],
      dispose: () => {
        for (const { written } of items) {
          if (written?.userData[DEFORM_CLONE_FLAG] === true) written.dispose();
        }
      },
      reattach: () => {
        for (const home of homes) {
          home.parent?.add(home.node);
          home.node.position.copy(home.position);
          home.node.quaternion.copy(home.quaternion);
          home.node.scale.copy(home.scale);
        }
        for (const { mesh, original, written } of items) {
          if (!written) continue;
          mesh.geometry = original;
          if (written.userData[DEFORM_CLONE_FLAG] === true) written.dispose();
        }
      },
    };
  }

  /**
   * Takes a part off without a piece: it left earlier and this object was built
   * since, or a save says it is gone. {@link dispose} puts it back.
   */
  removePart(id: string): void {
    const meshes = this.ensureMeshes();
    const nodes = this.partNodes(meshes.filter((item) => item.part === id));
    const riders = this.ridersOf(id, nodes);
    for (const node of nodes) {
      this.removed.push({ node, parent: node.parent });
      node.removeFromParent();
    }
    for (const item of meshes) {
      if ((item.part !== id && !riders.has(item.part)) || !item.written) continue;
      item.mesh.geometry = item.original;
      if (item.written.userData[DEFORM_CLONE_FLAG] === true) item.written.dispose();
    }
    this.forgetPart(id);
    for (const rider of riders) this.forgetPart(rider!);
  }

  /** The other parts whose meshes hang under a part's nodes. */
  private ridersOf(id: string, nodes: readonly Object3D[]): Set<string | null> {
    const riders = new Set<string | null>();
    for (const { mesh, part } of this.meshes ?? []) {
      if (part === null || part === id) continue;
      for (let node: Object3D | null = mesh; node; node = node === this.root ? null : node.parent) {
        if (nodes.includes(node)) riders.add(part);
      }
    }
    return riders;
  }

  /** Dents the object where an impact landed. `direction` is a world unit vector, into the object. */
  hit(point: DentVec3, direction: DentVec3, depth: number, params: DentParams): DentOutcome {
    if (!(depth > 0)) return "skipped";
    const meshes = this.ensureMeshes();
    if (meshes.length === 0) return "missed";
    const { point: hitPoint, direction: dentDirection } = this.toDentSpace(point, direction);
    const locate = (part: string | null): DentVec3 | null => locateDent(
      meshes.filter((item) => item.part === part).map((item) => item.surface),
      hitPoint,
      dentDirection,
      params.radius,
    );
    let part = this.zonePart(hitPoint, dentDirection, params.radius);
    let centre = locate(part);
    if (!centre && part !== null) {
      part = null;
      centre = locate(null);
    }
    if (!centre) return "missed";
    this.landedOn = part;
    if (!this.place(part, centre, dentDirection, depth, params)) return "skipped";
    let moved = this.moved;
    for (const other of this.options.parts?.find(({ id }) => id === part)?.alsoDents ?? []) {
      if (meshes.some((item) => item.part === other) && this.place(other, centre, dentDirection, depth, params)) moved += this.moved;
    }
    this.moved = moved;
    return "dented";
  }

  /** Adds or deepens one part's dent; false when the list leaves no room for it. */
  private place(part: string | null, centre: DentVec3, direction: DentVec3, depth: number, params: DentParams): boolean {
    const plan = planDent(this.dents, centre, direction, depth, params, part);
    if (plan.kind === "skip") return false;
    if (plan.kind === "add") {
      this.dents.push(plan.dent);
      this.push(plan.dent, params);
      return true;
    }
    const existing = this.dents[plan.index]!;
    this.dents[plan.index] = { ...existing, depth: existing.depth + plan.extra };
    this.push({ ...existing, depth: plan.extra }, params);
    return true;
  }

  /** Reapplies a saved dent list on a fresh object; the result equals the live shape. */
  restore(dents: readonly Dent[], params: DentParams): void {
    const present = dents.filter((dent) => !dent.part || !this.detached.has(dent.part));
    for (const dent of present.slice(0, params.maxDents)) {
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
    for (const { node, parent } of this.removed) parent?.add(node);
    this.removed = [];
    this.meshes = null;
    this.dents.length = 0;
  }

  /** The part's dents leave with it: they no longer describe this object. */
  private forgetPart(id: string): void {
    this.meshes = (this.meshes ?? []).filter((item) => item.part !== id);
    this.detached.add(id);
    for (let index = this.dents.length - 1; index >= 0; index -= 1) {
      if (this.dents[index]!.part === id) this.dents.splice(index, 1);
    }
  }

  /** The nodes that carry these meshes, each once. */
  private partNodes(items: readonly DentMesh[]): Object3D[] {
    return [...new Set(items.map((item) => this.partNode(item.mesh)?.node ?? item.mesh))];
  }

  private toDentSpace(point: DentVec3, direction: DentVec3): { point: DentVec3; direction: DentVec3 } {
    // worldToDent() uses SCRATCH, so it has to run first.
    const worldToDent = this.worldToDent();
    const localPoint = SCRATCH.fromArray(point).applyMatrix4(worldToDent);
    const hitPoint: DentVec3 = [localPoint.x, localPoint.y, localPoint.z];
    const localDirection = SCRATCH.fromArray(direction).transformDirection(worldToDent);
    return { point: hitPoint, direction: [localDirection.x, localDirection.y, localDirection.z] };
  }

  /**
   * Zones hold surface points, not contact points. A contact lies on the collider
   * and the body has moved since (measured 0.24 m off a truck's side), so the hit
   * is first placed on the model along its line.
   */
  private zonePart(hitPoint: DentVec3, direction: DentVec3, radius: number): string | null {
    if (!this.options.parts?.length) return null;
    const surfacePoint = locateDent(this.ensureMeshes().map((item) => item.surface), hitPoint, direction, radius);
    return surfacePoint ? resolveDentPart(this.options.parts, surfacePoint) : null;
  }

  private push(dent: Dent, params: DentParams): void {
    this.moved = 0;
    const meshes = this.ensureMeshes();
    // A saved dent can name a part the sidecar no longer has; it stays on the body.
    const part = meshes.some((item) => item.part === dent.part) ? dent.part : null;
    for (const item of meshes) {
      if (item.part !== part) continue;
      const change = applyDent(item.surface, dent, params);
      if (change.moved === 0) continue;
      this.moved += change.moved;
      this.write(item, change, params);
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
    if (params.wear) this.writeWear(item, geometry, change, params.wear.depth);
  }

  /** How far each vertex went, for a material that shows scraped paint. */
  private writeWear(item: DentMesh, geometry: BufferGeometry, change: DentChange, depth: number): void {
    const { surface } = item;
    let wear = geometry.getAttribute(DENT_WEAR_ATTRIBUTE) as BufferAttribute | undefined;
    if (!wear) {
      wear = new Float32BufferAttribute(new Float32Array(surface.vertexCount), 1);
      geometry.setAttribute(DENT_WEAR_ATTRIBUTE, wear);
    }
    for (const vertex of change.changed) {
      const offset = vertex * 3;
      const pushed = Math.hypot(surface.pushes[offset]!, surface.pushes[offset + 1]!, surface.pushes[offset + 2]!);
      wear.setX(vertex, Math.min(1, pushed / depth));
    }
    wear.needsUpdate = true;
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

  /** The nearest part node at or above a mesh, and its part. */
  private partNode(mesh: Mesh): { node: Object3D; id: string } | null {
    const parts = this.options.parts;
    if (!parts?.length) return null;
    for (let node: Object3D | null = mesh; node; node = node === this.root ? null : node.parent) {
      const name = node.name;
      const part = parts.find(({ nodes }) => nodes.includes(name));
      if (part) return { node, id: part.id };
    }
    return null;
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
      part: this.partNode(mesh)?.id ?? null,
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
