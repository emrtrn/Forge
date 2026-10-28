import { Color, Group, InstancedMesh, type Material, Matrix4, Object3D } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeletonHierarchy } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { Entity } from "@engine/scene/entity";
import { readRenderableMeshComponent, readTransformComponent } from "@engine/scene/components";
import type { LayoutCharacter, LayoutPlacement, Vec3 } from "@engine/scene/layout";
import { readRotation, readScale } from "@engine/scene/transform";
import { isRenderableMesh } from "./materials";
import { applyEulerDegrees, composePlacementMatrix, composeTransformMatrix } from "./transforms";

const HIDDEN_INSTANCE_MATRIX = new Matrix4().makeScale(0, 0, 0);
const IDENTITY_MATRIX = new Matrix4();
const WHITE = new Color(1, 1, 1);

/**
 * glTF primitives may ship without a NORMAL attribute. Per the spec GLTFLoader
 * then only flips the material to `flatShading` (face normals via screen-space
 * derivatives), which keeps the *beauty* render correct but leaves the geometry
 * with no `normal` attribute. GTAOPass (Ambient Occlusion) renders its G-buffer
 * with a `MeshNormalMaterial` override that reads that attribute directly, so a
 * missing normal buffer yields zero-length normals → the mesh computes as fully
 * occluded and renders solid black under AO (the long-standing "Play character
 * is black with AO on" bug). Computing vertex normals where they are absent
 * gives the AO pass valid normals; the `flatShading` material still drives the
 * beauty look, so on-screen appearance is unchanged. Idempotent: cloned/shared
 * geometries are skipped once normals exist.
 */
export function ensureVertexNormals(root: Object3D): void {
  root.traverse((object) => {
    if (!isRenderableMesh(object)) return;
    const geometry = object.geometry;
    if (geometry.getAttribute("normal") || !geometry.getAttribute("position")) return;
    geometry.computeVertexNormals();
  });
}

export interface InstancedModelGroup {
  group: Group;
  meshes: InstancedMesh[];
}

/** Normalized per-placement render input, decoupled from the layout format. */
export interface InstanceRenderItem {
  matrix: Matrix4;
  hidden: boolean;
  /** `#rrggbb` base colour replacing the material colour (`LayoutPlacement.color`). */
  color?: string;
}

/** Legacy builder: derives render items straight from layout placements. */
export function placementInstanceItems(placements: LayoutPlacement[]): InstanceRenderItem[] {
  return placements.map((placement) => ({
    matrix: composePlacementMatrix(placement),
    hidden: placement.hidden ?? false,
  }));
}

/**
 * Entity-driven builder: derives render items from scene entities' transform
 * components and the `hidden` tag. Produces matrices identical to
 * `placementInstanceItems` because both compose through `composeTransformMatrix`.
 */
export function entityInstanceItems(entities: Entity[]): InstanceRenderItem[] {
  return entities.map((entity) => {
    const transform = readTransformComponent(entity);
    const matrix = transform
      ? composeTransformMatrix(transform.position, transform.rotation, transform.scale)
      : new Matrix4();
    return { matrix, hidden: entity.tags?.includes("hidden") ?? false };
  });
}

export interface CreateInstancedModelGroupOptions {
  assetId: string;
  gltf: GLTF;
  items: InstanceRenderItem[];
  castShadow: boolean;
  receiveShadow: boolean;
}

export function createInstancedModelGroup(
  options: CreateInstancedModelGroupOptions,
): InstancedModelGroup {
  const { assetId, gltf, items, castShadow, receiveShadow } = options;
  const group = new Group();
  const meshes: InstancedMesh[] = [];
  group.name = `instanced-${assetId}`;

  ensureVertexNormals(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  gltf.scene.traverse((object) => {
    if (!isRenderableMesh(object)) return;

    const instanced = new InstancedMesh(object.geometry, object.material, items.length);
    instanced.name = `${assetId}-${object.name || "mesh"}`;
    instanced.frustumCulled = false;
    instanced.castShadow = castShadow;
    instanced.receiveShadow = receiveShadow;
    instanced.userData.assetId = assetId;
    instanced.userData.sourceMatrix = object.matrixWorld.clone();

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      if (item.hidden) {
        instanced.setMatrixAt(index, HIDDEN_INSTANCE_MATRIX);
        continue;
      }
      const matrix = item.matrix.clone().multiply(object.matrixWorld);
      instanced.setMatrixAt(index, matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    applyInstanceColors(instanced, items);
    group.add(instanced);
    meshes.push(instanced);
  });

  return { group, meshes };
}

/**
 * Per-instance base colours. three multiplies the instance colour into the
 * material colour, so each one is divided by it: the instance shows `color`
 * itself. Instances without one keep white (the material colour). Nothing is
 * allocated when no item has a colour.
 */
function applyInstanceColors(instanced: InstancedMesh, items: readonly InstanceRenderItem[]): void {
  if (!items.some((item) => item.color !== undefined)) return;
  const materials = Array.isArray(instanced.material) ? instanced.material : [instanced.material];
  const base = (materials[0] as { color?: unknown } | undefined)?.color;
  const divisor = base instanceof Color ? base : WHITE;
  const color = new Color();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.color === undefined) {
      instanced.setColorAt(index, WHITE);
      continue;
    }
    color.set(item.color);
    color.setRGB(
      divisor.r > 0 ? color.r / divisor.r : color.r,
      divisor.g > 0 ? color.g / divisor.g : color.g,
      divisor.b > 0 ? color.b / divisor.b : color.b,
    );
    instanced.setColorAt(index, color);
  }
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
}

/**
 * A copy of `material` whose base colour is `color` (textures still apply), for
 * a placement rendered as its own clone; pushed onto `owned` for disposal.
 */
export function tintedMaterial<T extends Material>(material: T, color: string, owned: Material[]): T {
  const tinted = material.clone() as T;
  const target = (tinted as { color?: unknown }).color;
  if (target instanceof Color) target.set(color);
  owned.push(tinted);
  return tinted;
}

export interface CreatePackedInstancedModelGroupOptions {
  assetId: string;
  gltf: GLTF;
  /** `count * 16` column-major instance matrices (three's `Matrix4.elements` order). */
  matrices: Float32Array;
  count: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

/**
 * {@link createInstancedModelGroup} for packed instance matrices (procedural
 * foliage): copied straight into each mesh's `instanceMatrix` when the GLTF node
 * sits at the identity, otherwise multiplied by the node's world matrix.
 */
export function createPackedInstancedModelGroup(options: CreatePackedInstancedModelGroupOptions): InstancedModelGroup {
  const { assetId, gltf, matrices, count, castShadow, receiveShadow } = options;
  const group = new Group();
  const meshes: InstancedMesh[] = [];
  group.name = `instanced-${assetId}`;
  ensureVertexNormals(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  const instance = new Matrix4();
  gltf.scene.traverse((object) => {
    if (!isRenderableMesh(object)) return;
    const instanced = new InstancedMesh(object.geometry, object.material, count);
    instanced.name = `${assetId}-${object.name || "mesh"}`;
    instanced.frustumCulled = false;
    instanced.castShadow = castShadow;
    instanced.receiveShadow = receiveShadow;
    instanced.userData.assetId = assetId;
    instanced.userData.sourceMatrix = object.matrixWorld.clone();
    const target = instanced.instanceMatrix.array as Float32Array;
    if (object.matrixWorld.equals(IDENTITY_MATRIX)) {
      target.set(matrices.subarray(0, count * 16));
    } else {
      for (let index = 0; index < count; index += 1) {
        instance.fromArray(matrices, index * 16).multiply(object.matrixWorld).toArray(target, index * 16);
      }
    }
    instanced.instanceMatrix.needsUpdate = true;
    group.add(instanced);
    meshes.push(instanced);
  });
  return { group, meshes };
}

/** Normalized character render input, decoupled from the layout format. */
export interface CharacterRenderItem {
  name: string;
  position: Vec3;
  /** XYZ-order Euler rotation in degrees. */
  rotation: Vec3;
  scale: Vec3;
  hidden: boolean;
  castShadow: boolean;
}

/** Legacy builder: derives a character render item straight from a placement. */
export function placementCharacterItem(placement: LayoutCharacter): CharacterRenderItem {
  return {
    name: placement.name ?? placement.assetId,
    position: [placement.position[0], placement.position[1], placement.position[2]],
    rotation: readRotation(placement),
    scale: readScale(placement),
    hidden: placement.hidden ?? false,
    castShadow: placement.castShadow ?? true,
  };
}

/**
 * Entity-driven builder: derives a character render item from a scene entity's
 * transform/mesh-renderer components and the `hidden` tag. Produces the same
 * inputs as `placementCharacterItem` because the adapter fills those components
 * via the same readRotation/readScale transform read.
 */
export function entityCharacterItem(entity: Entity): CharacterRenderItem {
  const transform = readTransformComponent(entity);
  const renderer = readRenderableMeshComponent(entity);
  // The placement Transform positions the actor in the world; the MeshRenderer's
  // local scale (authored on the class node) shrinks/grows the visual on top of
  // it, so a "small character" class renders small wherever it is placed/spawned.
  const placementScale: Vec3 = transform ? transform.scale : [1, 1, 1];
  const meshScale: Vec3 = renderer?.scale ?? [1, 1, 1];
  return {
    name: entity.name ?? renderer?.assetId ?? "character",
    position: transform ? [...transform.position] : [0, 0, 0],
    rotation: transform ? [...transform.rotation] : [0, 0, 0],
    scale: [
      placementScale[0] * meshScale[0],
      placementScale[1] * meshScale[1],
      placementScale[2] * meshScale[2],
    ],
    hidden: entity.tags?.includes("hidden") ?? false,
    castShadow: renderer?.castShadow ?? true,
  };
}

export function createCharacterSceneObject(
  gltf: GLTF,
  item: CharacterRenderItem,
): Object3D {
  ensureVertexNormals(gltf.scene);
  const character = cloneSkeletonHierarchy(gltf.scene);
  character.name = item.name;
  character.position.set(...item.position);
  applyEulerDegrees(character, item.rotation);
  character.scale.set(...item.scale);
  character.visible = !item.hidden;

  character.traverse((object) => {
    if (!isRenderableMesh(object)) return;
    object.castShadow = item.castShadow;
    object.receiveShadow = true;
  });

  return character;
}
