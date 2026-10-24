import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  Euler,
  Group,
  InstancedMesh,
  type Material,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  type MeshDepthMaterial,
  type MeshDistanceMaterial,
  Quaternion,
  Vector2,
  Vector3,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { Vec3 } from "@engine/scene/layout";
import {
  FOLIAGE_CHUNK_SIZE,
  chunkFoliageInstances,
  type FoliageGroupRenderStat,
  type ForgeFoliageTypeDef,
  type LayoutFoliageData,
  type LayoutFoliageGroup,
  type LayoutFoliageInstance,
} from "@engine/scene/foliage";
import type { FoliageInstanceRoll } from "@engine/scene/foliagePaint";
import { makeFoliageRng } from "@engine/scene/foliagePaint";
import { composeTransformMatrix } from "./transforms";
import { createInstancedModelGroup, createPackedInstancedModelGroup, type InstanceRenderItem } from "./models";
import {
  createFoliageFadeMaterial,
  createFoliageFadeShadowMaterials,
  foliageFadeWindow,
  type FoliageFadeUniforms,
} from "./foliageFade";

const WORLD_UP = new Vector3(0, 1, 0);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Deterministic fallback seed for an instance painted before per-instance seeds were
 * stored — hashes its world position so a Reapply is still reproducible.
 */
function stableSeedFromPosition(position: Vec3): number {
  let hash = 2166136261;
  for (const component of position) {
    hash = Math.imul(hash ^ (Math.round(component * 1000) | 0), 16777619);
  }
  return hash >>> 0;
}

/** Triangle count of one geometry (indexed or not); 0 when it has no positions. */
export function geometryTriangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  const position = geometry.getAttribute("position");
  return position ? Math.floor(position.count / 3) : 0;
}

/**
 * Resolves a paint roll ({@link FoliageInstanceRoll}) into a saved
 * {@link LayoutFoliageInstance}: applies normal-alignment (quaternion tilt of the
 * mesh up axis to the hit normal) + yaw + z-offset, and bakes the result to an
 * Euler-degrees rotation the sidecar stores and the InstancedMesh builder composes.
 * Kept in the render layer because it depends on three's quaternion math.
 */
export function foliageInstanceFromRoll(
  type: ForgeFoliageTypeDef,
  roll: FoliageInstanceRoll,
): LayoutFoliageInstance {
  const up = type.alignToNormal
    ? new Vector3(roll.normal[0], roll.normal[1], roll.normal[2])
    : new Vector3(0, 1, 0);
  if (up.lengthSq() < 1e-8) up.copy(WORLD_UP);
  else up.normalize();
  const align = new Quaternion().setFromUnitVectors(WORLD_UP, up);
  const yaw = new Quaternion().setFromAxisAngle(WORLD_UP, MathUtils.degToRad(roll.yawDeg));
  // Yaw about the (possibly tilted) local up: align first, then spin around it.
  const orientation = align.multiply(yaw);
  const euler = new Euler().setFromQuaternion(orientation, "XYZ");
  const position = new Vector3(roll.position[0], roll.position[1], roll.position[2]).addScaledVector(
    up,
    roll.zOffset,
  );
  const instance: LayoutFoliageInstance = {
    position: [position.x, position.y, position.z] as Vec3,
    rotation: [MathUtils.radToDeg(euler.x), MathUtils.radToDeg(euler.y), MathUtils.radToDeg(euler.z)] as Vec3,
    scale: [...roll.scale] as Vec3,
    normal: [...roll.normal] as Vec3,
    seed: roll.seed,
  };
  return instance;
}

/** A resolved surface point for reattach/snap: world position + unit normal. */
export interface FoliageReattachSurface {
  position: Vec3;
  normal: Vec3;
}

function normalOrUp(normal: Vec3 | undefined): Vector3 {
  const v = normal ? new Vector3(normal[0], normal[1], normal[2]) : WORLD_UP.clone();
  if (v.lengthSq() < 1e-8) return WORLD_UP.clone();
  return v.normalize();
}

/**
 * Reattach/snap: moves an instance onto a freshly-sampled surface point, preserving
 * its scale and yaw. When the type aligns to the surface normal, the tilt is
 * re-derived from the delta between the old and new normals (so painted yaw is kept
 * while the instance re-seats flush to the new ground); otherwise only the position
 * moves. Lives in the render layer because it depends on three's quaternion math.
 */
export function reattachFoliageInstance(
  instance: LayoutFoliageInstance,
  type: ForgeFoliageTypeDef,
  surface: FoliageReattachSurface,
): LayoutFoliageInstance {
  const next: LayoutFoliageInstance = {
    position: [...surface.position] as Vec3,
    rotation: [...instance.rotation] as Vec3,
    scale: [...instance.scale] as Vec3,
  };
  if (instance.seed !== undefined) next.seed = instance.seed;
  if (type.alignToNormal) {
    const oldAlign = new Quaternion().setFromUnitVectors(WORLD_UP, normalOrUp(instance.normal));
    const newAlign = new Quaternion().setFromUnitVectors(WORLD_UP, normalOrUp(surface.normal));
    const delta = newAlign.multiply(oldAlign.invert());
    const oldEuler = new Euler(
      MathUtils.degToRad(instance.rotation[0]),
      MathUtils.degToRad(instance.rotation[1]),
      MathUtils.degToRad(instance.rotation[2]),
      "XYZ",
    );
    const oldQuat = new Quaternion().setFromEuler(oldEuler);
    const nextEuler = new Euler().setFromQuaternion(delta.multiply(oldQuat), "XYZ");
    next.rotation = [
      MathUtils.radToDeg(nextEuler.x),
      MathUtils.radToDeg(nextEuler.y),
      MathUtils.radToDeg(nextEuler.z),
    ] as Vec3;
    next.normal = [...surface.normal] as Vec3;
  } else if (instance.normal) {
    next.normal = [...instance.normal] as Vec3;
  }
  return next;
}

/**
 * Reapply: re-rolls an instance's scale + yaw and re-derives its normal-alignment
 * tilt from the foliage type's CURRENT settings, deterministically from the stored
 * per-instance seed. Position is preserved (Z-offset is not re-applied — the stored
 * position already bakes the original offset and the surface base point isn't kept,
 * so a repaint is needed to change offset). Mirrors Unreal's Reapply on the
 * scale/rotation parameters. Lives in the render layer for three's quaternion math.
 */
export function reapplyFoliageInstance(
  type: ForgeFoliageTypeDef,
  instance: LayoutFoliageInstance,
): LayoutFoliageInstance {
  const seed = instance.seed ?? stableSeedFromPosition(instance.position);
  const rng = makeFoliageRng(seed >>> 0);
  const scale: Vec3 = [
    lerp(type.scaleMin[0], type.scaleMax[0], rng()),
    lerp(type.scaleMin[1], type.scaleMax[1], rng()),
    lerp(type.scaleMin[2], type.scaleMax[2], rng()),
  ];
  const yawDeg = type.randomYaw ? rng() * 360 : 0;
  const up = type.alignToNormal ? normalOrUp(instance.normal) : WORLD_UP.clone();
  const align = new Quaternion().setFromUnitVectors(WORLD_UP, up);
  const yaw = new Quaternion().setFromAxisAngle(WORLD_UP, MathUtils.degToRad(yawDeg));
  const orientation = align.multiply(yaw);
  const euler = new Euler().setFromQuaternion(orientation, "XYZ");
  const next: LayoutFoliageInstance = {
    position: [...instance.position] as Vec3,
    rotation: [
      MathUtils.radToDeg(euler.x),
      MathUtils.radToDeg(euler.y),
      MathUtils.radToDeg(euler.z),
    ] as Vec3,
    scale,
  };
  if (instance.normal) next.normal = [...instance.normal] as Vec3;
  if (instance.seed !== undefined) next.seed = instance.seed;
  return next;
}

/**
 * Foliage render binding: turns the level foliage sidecar ({@link LayoutFoliageData})
 * into `InstancedMesh` batches, one per foliage group (Faz 1: no grid chunking —
 * each group is a single batch keyed by `foliageTypeId + meshAssetId`).
 *
 * Instances are stored in WORLD space in the sidecar, so the binding's root Group
 * lives directly under the scene (not parented to a target). Landscapes are static
 * origin singletons in Faz 1, so this keeps foliage decoupled from target
 * transforms; reattach/snap after a target moves is a Faz 2 concern.
 *
 * The host (SceneApp / RuntimeSceneApp) owns the type/model lookup and calls
 * {@link FoliageRenderBinding.rebuild} on load and {@link FoliageRenderBinding.rebuildGroup}
 * after a paint/erase dab so only the dirty batch is rebuilt.
 */
export interface FoliageRenderResolver {
  /** The resolved Foliage Type for a group, or null when its type asset is missing. */
  getType(foliageTypeId: string): ForgeFoliageTypeDef | null;
  /** The loaded model for a mesh asset id, or null when it is not loaded yet. */
  getModel(meshAssetId: string): GLTF | null;
  /**
   * Applies the asset's default material-slot overrides to its instanced sub-group
   * (foliage meshes share the raw GLTF material otherwise — see the landscape
   * spline mesh binding for the same hook).
   */
  applyMaterialSlots?(assetId: string, group: Group): void;
}

/** Composes the world-space instance matrices for one foliage group. */
export function foliageInstanceItems(group: LayoutFoliageGroup): InstanceRenderItem[] {
  return group.instances.map((instance) => ({
    matrix: composeTransformMatrix(instance.position, instance.rotation, instance.scale),
    hidden: false,
  }));
}

/** One render chunk of a group: its InstancedMesh batch + cull bounds. */
interface FoliageChunkObject {
  /** Sub-group holding this chunk's InstancedMeshes (tagged for picking). */
  group: Group;
  meshes: InstancedMesh[];
  /** World center of the chunk's instances (distance-cull anchor). */
  center: Vector3;
  /** Bounding radius (instances + mesh extent) so cull uses the nearest point. */
  radius: number;
}

/** A group's fading materials (owned by the group, disposed with it). */
interface FoliageGroupFade {
  uniforms: FoliageFadeUniforms;
  materials: Material[];
  depth: MeshDepthMaterial;
  distance: MeshDistanceMaterial;
}

/** A group's render state: its chunk batches + the type's distance-cull window. */
interface FoliageGroupObject {
  /** Per-group container under the binding root; holds every chunk sub-group. */
  root: Group;
  chunks: FoliageChunkObject[];
  /** Type cull window (`cullEnd <= 0` disables distance culling for this group). */
  cullStart: number;
  cullEnd: number;
  /** Per-instance dither fade, null when the type never culls. */
  fade: FoliageGroupFade | null;
}

/** One group's selected instance indices (Foliage Mode selection overlay input). */
export interface FoliageSelectionEntry {
  groupId: string;
  indices: readonly number[];
}

// Shared wireframe cage geometry/material for the selection overlay — a unit box
// re-sized per instance to the foliage mesh's bounding box. Depth-tested off so the
// cage reads through the foliage it wraps.
const SELECTION_BOX_GEOMETRY = new BoxGeometry(1, 1, 1);
const SELECTION_BOX_MATERIAL = new MeshBasicMaterial({
  color: 0xffcf40,
  wireframe: true,
  transparent: true,
  opacity: 0.9,
  depthTest: false,
});

function disposeGroupObject(object: FoliageGroupObject): void {
  object.root.removeFromParent();
  for (const chunk of object.chunks) {
    for (const mesh of chunk.meshes) mesh.dispose();
  }
  if (object.fade) {
    for (const material of object.fade.materials) material.dispose();
    object.fade.depth.dispose();
    object.fade.distance.dispose();
  }
}

/**
 * Swaps every chunk mesh onto fading clones of its (slot-resolved) materials and
 * the matching shadow materials. One clone per source material per group, so a
 * group's chunks share programs and uniforms.
 */
function applyGroupFade(chunks: readonly FoliageChunkObject[], origin: { value: Vector3 }): FoliageGroupFade {
  const uniforms: FoliageFadeUniforms = {
    uFoliageFadeOrigin: origin,
    uFoliageFadeRange: { value: new Vector2() },
  };
  const clones = new Map<Material, Material>();
  const fadeOf = (source: Material): Material => {
    let clone = clones.get(source);
    if (!clone) {
      clone = createFoliageFadeMaterial(source, uniforms);
      clones.set(source, clone);
    }
    return clone;
  };
  const { depth, distance } = createFoliageFadeShadowMaterials(uniforms);
  for (const chunk of chunks) {
    for (const mesh of chunk.meshes) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fadeOf) : fadeOf(mesh.material);
      mesh.customDepthMaterial = depth;
      mesh.customDistanceMaterial = distance;
    }
  }
  return { uniforms, materials: [...clones.values()], depth, distance };
}

/** Builds a chunk render object, deriving its instance center + distance-cull radius. */
function chunkObject(
  group: Group,
  meshes: InstancedMesh[],
  indices: readonly number[],
  instances: readonly LayoutFoliageInstance[],
  meshRadius: number,
): FoliageChunkObject {
  const center = new Vector3();
  for (const index of indices) {
    const position = instances[index]!.position;
    center.x += position[0];
    center.y += position[1];
    center.z += position[2];
  }
  center.multiplyScalar(1 / Math.max(indices.length, 1));
  let maxDistSq = 0;
  for (const index of indices) {
    const position = instances[index]!.position;
    const dx = position[0] - center.x;
    const dy = position[1] - center.y;
    const dz = position[2] - center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > maxDistSq) maxDistSq = distSq;
  }
  return { group, meshes, center, radius: Math.sqrt(maxDistSq) + meshRadius };
}

/** {@link chunkObject} for packed matrices: centre and radius from the translation columns. */
function packedChunkObject(
  group: Group,
  meshes: InstancedMesh[],
  matrices: Float32Array,
  count: number,
  meshRadius: number,
): FoliageChunkObject {
  const center = new Vector3();
  for (let index = 0; index < count; index += 1) {
    center.x += matrices[index * 16 + 12]!;
    center.y += matrices[index * 16 + 13]!;
    center.z += matrices[index * 16 + 14]!;
  }
  center.multiplyScalar(1 / Math.max(count, 1));
  let maxDistSq = 0;
  for (let index = 0; index < count; index += 1) {
    const dx = matrices[index * 16 + 12]! - center.x;
    const dy = matrices[index * 16 + 13]! - center.y;
    const dz = matrices[index * 16 + 14]! - center.z;
    maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy + dz * dz);
  }
  return { group, meshes, center, radius: Math.sqrt(maxDistSq) + meshRadius };
}

export class FoliageRenderBinding {
  /** Scene-space container; add this once to the scene root. */
  readonly root = new Group();
  private readonly objects = new Map<string, FoliageGroupObject>();
  /** Editor-only selection cage overlay (null when nothing is selected). */
  private selectionMesh: InstancedMesh | null = null;
  /** Foliage mesh bounding boxes, keyed by mesh asset id (selection cage sizing). */
  private readonly boxCache = new Map<string, Box3>();
  /** Camera position every group's fade measures from (shared uniform). */
  private readonly fadeOrigin = { value: new Vector3() };
  /** Last quality cull scale, so a group built between frames starts with the right window. */
  private cullDistanceScale = 1;
  /** Streamed cell → the object keys of its batches ({@link addCell}). */
  private readonly cellObjects = new Map<string, string[]>();
  /** Keys of procedural batches ({@link setPackedGroup}). */
  private readonly packedKeys = new Set<string>();

  constructor() {
    this.root.name = "Foliage";
  }

  /** All InstancedMeshes currently drawn across every chunk (picking/statistics). */
  allMeshes(): InstancedMesh[] {
    const meshes: InstancedMesh[] = [];
    for (const object of this.objects.values()) {
      for (const chunk of object.chunks) meshes.push(...chunk.meshes);
    }
    return meshes;
  }

  /**
   * Live render stat for one group (triangles-per-instance + total draw calls across
   * its chunks), or null when the group has no built batch (mesh not loaded / empty).
   * Feeds {@link computeFoliageResourceUsage} for the panel's resource readout.
   */
  groupRenderStat(groupId: string): FoliageGroupRenderStat | null {
    const object = this.objects.get(groupId);
    if (!object || object.chunks.length === 0) return null;
    let drawCalls = 0;
    for (const chunk of object.chunks) drawCalls += chunk.meshes.length;
    // Every chunk instances the same GLTF, so per-instance triangles are read once.
    let trianglesPerInstance = 0;
    for (const mesh of object.chunks[0]!.meshes) {
      trianglesPerInstance += geometryTriangleCount(mesh.geometry);
    }
    return { trianglesPerInstance, drawCalls };
  }

  /**
   * Distance culling: hides whole chunks farther than their type's `cullEnd` from the
   * camera (nearest-point test via the chunk bounding radius), and moves every group's
   * per-instance fade ({@link foliageFadeWindow}: dither from `cullStart` to `cullEnd`,
   * or a per-instance cut at `cullEnd`) to this camera. Cheap enough to run every
   * frame; a no-op for types with `cullEnd <= 0`. Per-chunk frustum culling is handled
   * by three itself (each chunk mesh gets a tight bounding sphere at build).
   *
   * `cullDistanceScale` is the runtime quality knob: it multiplies each type's
   * authored `cullStart`/`cullEnd` (smaller = foliage culls nearer), without touching
   * the authored type. `1` keeps the authored distance; a non-positive scale falls
   * back to `1`. A type with `cullEnd <= 0` (never cull) is unaffected.
   */
  updateCulling(cameraPosition: Vector3, cullDistanceScale = 1): void {
    const scale = cullDistanceScale > 0 ? cullDistanceScale : 1;
    this.cullDistanceScale = scale;
    this.fadeOrigin.value.copy(cameraPosition);
    for (const object of this.objects.values()) {
      if (object.fade) this.setFadeWindow(object);
      const cullEnd = object.cullEnd * scale;
      if (cullEnd <= 0) {
        for (const chunk of object.chunks) {
          if (!chunk.group.visible) chunk.group.visible = true;
        }
        continue;
      }
      for (const chunk of object.chunks) {
        const distance = cameraPosition.distanceTo(chunk.center) - chunk.radius;
        chunk.group.visible = distance <= cullEnd;
      }
    }
  }

  /** Rebuilds every group from scratch (load, or a bulk change). */
  rebuild(data: LayoutFoliageData | null, resolver: FoliageRenderResolver): void {
    const wanted = new Set((data?.groups ?? []).map((group) => group.id));
    const streamed = new Set([...this.cellObjects.values()].flat());
    for (const id of [...this.objects.keys()]) {
      if (!wanted.has(id) && !streamed.has(id) && !this.packedKeys.has(id)) this.removeGroup(id);
    }
    for (const group of data?.groups ?? []) this.rebuildGroup(group, resolver);
  }

  /** Rebuilds a single group's chunk batches in place (paint/erase/type-change path). */
  rebuildGroup(group: LayoutFoliageGroup, resolver: FoliageRenderResolver): void {
    this.removeGroup(group.id);
    const object = this.buildGroupObject(group, resolver, FOLIAGE_CHUNK_SIZE);
    if (object) this.objects.set(group.id, object);
  }

  /**
   * Partitioned foliage (OPEN_WORLD_PLAN Faz 6 F2): builds one batch per group for
   * a streamed cell's instances (chunked by the cell size, so a cell is one chunk),
   * replacing that cell's previous batches. Returns the instances built.
   */
  addCell(cellKey: string, groups: readonly LayoutFoliageGroup[], resolver: FoliageRenderResolver, cellSize: number): number {
    this.removeCell(cellKey);
    const keys: string[] = [];
    let built = 0;
    for (const group of groups) {
      const object = this.buildGroupObject(group, resolver, cellSize);
      if (!object) continue;
      const key = `cell:${cellKey}:${group.id}`;
      this.objects.set(key, object);
      keys.push(key);
      built += group.instances.length;
    }
    this.cellObjects.set(cellKey, keys);
    return built;
  }

  /**
   * Procedural foliage (OPEN_WORLD_PLAN Faz 6 F3): one batch built from packed
   * column-major instance matrices (as `generateFoliageCell` writes them) under
   * `key`, replacing any batch with that key. Not pickable (no index map) and
   * never touched by {@link rebuild}. Returns the instances built.
   */
  setPackedGroup(
    key: string,
    foliageTypeId: string,
    matrices: Float32Array,
    count: number,
    resolver: FoliageRenderResolver,
  ): number {
    this.removeGroup(key);
    this.packedKeys.delete(key);
    const type = resolver.getType(foliageTypeId);
    const gltf = type?.meshAssetId ? resolver.getModel(type.meshAssetId) : null;
    if (!type || !gltf || count <= 0) return 0;
    const built = createPackedInstancedModelGroup({
      assetId: type.meshAssetId,
      gltf,
      matrices,
      count,
      castShadow: type.castShadow,
      receiveShadow: type.receiveShadow,
    });
    built.group.name = `foliage-${key}`;
    for (const mesh of built.meshes) {
      mesh.frustumCulled = true;
      mesh.computeBoundingSphere();
    }
    resolver.applyMaterialSlots?.(type.meshAssetId, built.group);
    const root = new Group();
    root.name = `foliage-${key}`;
    root.add(built.group);
    const chunk = packedChunkObject(built.group, built.meshes, matrices, count, this.meshBoundingRadius(type.meshAssetId, resolver));
    this.root.add(root);
    const object: FoliageGroupObject = {
      root,
      chunks: [chunk],
      cullStart: type.cullStart,
      cullEnd: type.cullEnd,
      fade: type.cullEnd > 0 ? applyGroupFade([chunk], this.fadeOrigin) : null,
    };
    if (object.fade) this.setFadeWindow(object);
    this.objects.set(key, object);
    this.packedKeys.add(key);
    return count;
  }

  /** Removes a {@link setPackedGroup} batch, if present. */
  removePackedGroup(key: string): void {
    this.removeGroup(key);
    this.packedKeys.delete(key);
  }

  /** Removes and disposes a streamed cell's batches, if present. */
  removeCell(cellKey: string): void {
    for (const key of this.cellObjects.get(cellKey) ?? []) this.removeGroup(key);
    this.cellObjects.delete(cellKey);
  }

  private buildGroupObject(group: LayoutFoliageGroup, resolver: FoliageRenderResolver, chunkSize: number): FoliageGroupObject | null {
    const type = resolver.getType(group.foliageTypeId);
    if (!type || !type.meshAssetId) return null;
    const gltf = resolver.getModel(type.meshAssetId);
    if (!gltf) return null;
    if (group.instances.length === 0) return null;
    const meshRadius = this.meshBoundingRadius(type.meshAssetId, resolver);
    const root = new Group();
    root.name = `foliage-${group.id}`;
    const chunks: FoliageChunkObject[] = [];
    for (const bucket of chunkFoliageInstances(group.instances, chunkSize)) {
      const items: InstanceRenderItem[] = bucket.indices.map((index) => {
        const instance = group.instances[index]!;
        return {
          matrix: composeTransformMatrix(instance.position, instance.rotation, instance.scale),
          hidden: false,
        };
      });
      const built = createInstancedModelGroup({
        assetId: type.meshAssetId,
        gltf,
        items,
        castShadow: type.castShadow,
        receiveShadow: type.receiveShadow,
      });
      built.group.name = `foliage-${group.id}-${bucket.chunkX}_${bucket.chunkZ}`;
      // Tag the chunk so the picker maps a chunk-local hit back to the group index.
      built.group.userData.foliageGroupId = group.id;
      built.group.userData.foliageIndexMap = bucket.indices;
      // Re-enable per-chunk frustum culling (the shared instanced builder disables it
      // for scattered placements) and give each batch a tight bounding sphere.
      for (const mesh of built.meshes) {
        mesh.frustumCulled = true;
        mesh.computeBoundingSphere();
      }
      resolver.applyMaterialSlots?.(type.meshAssetId, built.group);
      root.add(built.group);
      chunks.push(chunkObject(built.group, built.meshes, bucket.indices, group.instances, meshRadius));
    }
    if (chunks.length === 0) return null;
    this.root.add(root);
    const object: FoliageGroupObject = {
      root,
      chunks,
      cullStart: type.cullStart,
      cullEnd: type.cullEnd,
      fade: type.cullEnd > 0 ? applyGroupFade(chunks, this.fadeOrigin) : null,
    };
    if (object.fade) this.setFadeWindow(object);
    return object;
  }

  private setFadeWindow(object: FoliageGroupObject): void {
    const fadeWindow = foliageFadeWindow(object.cullStart, object.cullEnd, this.cullDistanceScale);
    if (fadeWindow) object.fade!.uniforms.uFoliageFadeRange.value.set(fadeWindow[0], fadeWindow[1]);
  }

  /** Removes and disposes a single group's chunk batches, if present. */
  removeGroup(groupId: string): void {
    const existing = this.objects.get(groupId);
    if (!existing) return;
    disposeGroupObject(existing);
    this.objects.delete(groupId);
  }

  /** Bounding-sphere radius of a mesh asset (cull margin), 0 when not loaded. */
  private meshBoundingRadius(meshAssetId: string, resolver: FoliageRenderResolver): number {
    const box = this.meshBox(meshAssetId, resolver);
    if (!box) return 0;
    const size = new Vector3();
    box.getSize(size);
    return size.length() / 2;
  }

  /**
   * Rebuilds the selection cage overlay: a wireframe box per selected instance,
   * sized to its foliage mesh's bounding box and placed at the instance transform.
   * Editor-only; the runtime never calls this.
   */
  setSelection(
    data: LayoutFoliageData | null,
    entries: readonly FoliageSelectionEntry[],
    resolver: FoliageRenderResolver,
  ): void {
    if (this.selectionMesh) {
      this.selectionMesh.removeFromParent();
      this.selectionMesh.dispose();
      this.selectionMesh = null;
    }
    if (!data || entries.length === 0) return;
    const groupsById = new Map(data.groups.map((group) => [group.id, group]));
    const matrices: Matrix4[] = [];
    const size = new Vector3();
    const center = new Vector3();
    const identity = new Quaternion();
    for (const entry of entries) {
      const group = groupsById.get(entry.groupId);
      if (!group) continue;
      const type = resolver.getType(group.foliageTypeId);
      if (!type) continue;
      const box = this.meshBox(type.meshAssetId, resolver);
      if (!box) continue;
      box.getSize(size);
      box.getCenter(center);
      // Pad flat axes so a plane/decal mesh still shows a visible cage.
      const local = new Matrix4().compose(
        center,
        identity,
        new Vector3(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05)),
      );
      for (const index of entry.indices) {
        const instance = group.instances[index];
        if (!instance) continue;
        const world = composeTransformMatrix(instance.position, instance.rotation, instance.scale);
        matrices.push(world.clone().multiply(local));
      }
    }
    if (matrices.length === 0) return;
    const mesh = new InstancedMesh(SELECTION_BOX_GEOMETRY, SELECTION_BOX_MATERIAL, matrices.length);
    mesh.name = "foliage-selection";
    mesh.renderOrder = 30;
    mesh.raycast = () => {};
    for (let i = 0; i < matrices.length; i += 1) mesh.setMatrixAt(i, matrices[i]!);
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    this.selectionMesh = mesh;
  }

  private meshBox(meshAssetId: string, resolver: FoliageRenderResolver): Box3 | null {
    const cached = this.boxCache.get(meshAssetId);
    if (cached) return cached;
    const gltf = resolver.getModel(meshAssetId);
    if (!gltf) return null;
    const box = new Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) return null;
    this.boxCache.set(meshAssetId, box);
    return box;
  }

  /** Removes and disposes every batch (scene teardown / layout swap). */
  clear(): void {
    for (const object of this.objects.values()) disposeGroupObject(object);
    this.objects.clear();
    this.cellObjects.clear();
    this.packedKeys.clear();
    if (this.selectionMesh) {
      this.selectionMesh.removeFromParent();
      this.selectionMesh.dispose();
      this.selectionMesh = null;
    }
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }
}
