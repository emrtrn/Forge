import {
  Matrix4,
  Sphere,
  Vector2,
  Vector3,
  type InstancedMesh,
  type Material,
  type Mesh,
  type MeshDepthMaterial,
  type MeshDistanceMaterial,
  type Object3D,
} from "three";

import { detailBatchCulled, detailCullDistance, detailCullWindow } from "@engine/world/detailCulling";
import {
  createFoliageFadeMaterial,
  createFoliageFadeShadowMaterials,
  type FoliageFadeUniforms,
} from "./foliageFade";

/**
 * Small-object distance culling for static mesh batches (OPEN_WORLD_PLAN Faz 7e).
 * Every mesh of a small asset's batch — the InstancedMesh and the per-placement
 * clones (material slots, overrides, probes, mesh paint) — renders through
 * size-scaled dither-fade clones of its materials (one clone per asset and source
 * material, shared by every batch), so an instance dissolves between 80% and 100%
 * of `radius × 200 × its scale`, shadow included. A compact mesh (a World
 * Partition cell's InstancedMesh, or any single clone) whose nearest point is past
 * its largest instance's cull distance is not drawn at all.
 *
 * Distances follow the PLACEMENT scale. An instance matrix (or a clone mesh's
 * world matrix) also carries the mesh's own node transform inside the asset —
 * e.g. a model authored in centimetres under a 0.01 node — so each mesh's
 * "base scale" is divided back out: the shader divides distance by the full
 * scale (base × placement), so the fade window is divided by the base scale,
 * and the skip test uses full scale ÷ base scale.
 */

interface AssetFade {
  cullDistance: number;
  /** The node scale of the meshes sharing this fade (see the class comment). */
  baseScale: number;
  uniforms: FoliageFadeUniforms;
  clones: Map<Material, Material>;
  fades: Set<Material>;
  depth: MeshDepthMaterial;
  distance: MeshDistanceMaterial;
}

interface CulledMesh {
  mesh: Mesh;
  fade: AssetFade;
  /** World bounding sphere (instances included). */
  sphere: Sphere;
  /** Largest placement scale among its instances (full scale ÷ base scale). */
  maxScale: number;
  /** True while this binding has hidden the mesh (it never un-hides a mesh it did not hide). */
  hiddenByCull: boolean;
}

const instanceMatrix = new Matrix4();
const column = new Vector3();

export class StaticDetailCulling {
  private readonly origin = { value: new Vector3() };
  private readonly assets = new Map<string, AssetFade>();
  private readonly meshes = new Map<Mesh, CulledMesh>();

  /**
   * Puts the meshes under `root` on the fade materials when the asset is small
   * enough to cull (`radius` = its scale-1 bounding radius). Clones are always
   * skipped whole once out of range; an InstancedMesh only with
   * `skipWholeInstanced` — a level-wide batch's bounding sphere is too loose.
   * Returns false for assets that never cull.
   */
  register(assetId: string, radius: number, root: Object3D, options: { skipWholeInstanced: boolean }): boolean {
    const cullDistance = detailCullDistance(radius);
    if (cullDistance === null) return false;
    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const instanced = (mesh as InstancedMesh).isInstancedMesh === true;
      const baseScale = meshBaseScale(mesh, instanced);
      const fade = this.assetFade(assetId, cullDistance, baseScale);
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => this.fadeOf(fade, material))
        : this.fadeOf(fade, mesh.material);
      mesh.customDepthMaterial = fade.depth;
      mesh.customDistanceMaterial = fade.distance;
      if (instanced && !options.skipWholeInstanced) return;
      let sphere: Sphere;
      if (instanced) {
        (mesh as InstancedMesh).computeBoundingSphere();
        sphere = (mesh as InstancedMesh).boundingSphere!.clone();
      } else {
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        sphere = mesh.geometry.boundingSphere!.clone();
      }
      this.meshes.set(mesh, {
        mesh,
        fade,
        sphere: sphere.applyMatrix4(mesh.matrixWorld),
        maxScale: (instanced ? maxInstanceScale(mesh as InstancedMesh) : mesh.matrixWorld.getMaxScaleOnAxis()) / baseScale,
        hiddenByCull: false,
      });
    });
    return true;
  }

  /** Forgets the meshes under `root` (a cell unloading, a batch rebuilt), un-hiding any it hid. */
  release(root: Object3D): void {
    root.traverse((node) => {
      const entry = this.meshes.get(node as Mesh);
      if (!entry) return;
      if (entry.hiddenByCull) entry.mesh.visible = true;
      this.meshes.delete(entry.mesh);
    });
  }

  /** Per frame: the fade origin and windows follow the camera and the quality scale. */
  update(cameraPosition: Vector3, qualityScale: number): void {
    this.origin.value.copy(cameraPosition);
    for (const fade of this.assets.values()) {
      const [start, end] = detailCullWindow(fade.cullDistance, qualityScale);
      fade.uniforms.uFoliageFadeRange.value.set(start / fade.baseScale, end / fade.baseScale);
    }
    for (const entry of this.meshes.values()) {
      const culled = detailBatchCulled(
        entry.sphere.center.distanceTo(cameraPosition),
        entry.sphere.radius,
        entry.fade.cullDistance,
        entry.maxScale,
        qualityScale,
      );
      if (culled && entry.mesh.visible) {
        entry.mesh.visible = false;
        entry.hiddenByCull = true;
      } else if (!culled && entry.hiddenByCull) {
        entry.mesh.visible = true;
        entry.hiddenByCull = false;
      }
    }
  }

  /** How many tracked meshes are skipped this frame (for `?debug` and smokes). */
  culledMeshCount(): number {
    let count = 0;
    for (const entry of this.meshes.values()) if (entry.hiddenByCull) count += 1;
    return count;
  }

  /** Frees the fade materials; the level's batches are disposed by their owner. */
  dispose(): void {
    for (const fade of this.assets.values()) {
      for (const clone of fade.fades) clone.dispose();
      fade.depth.dispose();
      fade.distance.dispose();
    }
    this.assets.clear();
    this.meshes.clear();
  }

  /** One fade (uniforms + material clones) per asset and mesh base scale. */
  private assetFade(assetId: string, cullDistance: number, baseScale: number): AssetFade {
    const key = `${assetId}|${baseScale.toPrecision(6)}`;
    let fade = this.assets.get(key);
    if (!fade) {
      const uniforms: FoliageFadeUniforms = { uFoliageFadeOrigin: this.origin, uFoliageFadeRange: { value: new Vector2() } };
      const shadow = createFoliageFadeShadowMaterials(uniforms, "instanceScaled");
      fade = { cullDistance, baseScale, uniforms, clones: new Map(), fades: new Set(), depth: shadow.depth, distance: shadow.distance };
      this.assets.set(key, fade);
    }
    return fade;
  }

  private fadeOf(fade: AssetFade, source: Material): Material {
    // A batch rebuilt from already-faded meshes keeps its clone.
    for (const other of this.assets.values()) if (other.fades.has(source)) return source;
    let clone = fade.clones.get(source);
    if (!clone) {
      clone = createFoliageFadeMaterial(source, fade.uniforms, "instanceScaled");
      fade.clones.set(source, clone);
      fade.fades.add(clone);
    }
    return clone;
  }
}

/**
 * A mesh's own scale inside its asset: an InstancedMesh keeps its source node
 * matrix (`createInstancedModelGroup`'s `userData.sourceMatrix`); a placement
 * clone's mesh is its world scale over the clone root's (the placement).
 */
function meshBaseScale(mesh: Mesh, instanced: boolean): number {
  let scale = 1;
  if (instanced) {
    const source = mesh.userData.sourceMatrix as Matrix4 | undefined;
    scale = source?.isMatrix4 ? source.getMaxScaleOnAxis() : 1;
  } else {
    let root: Object3D | null = mesh.parent;
    while (root && root.userData.placementIndex === undefined) root = root.parent;
    if (root) scale = mesh.matrixWorld.getMaxScaleOnAxis() / Math.max(root.matrixWorld.getMaxScaleOnAxis(), 1e-6);
  }
  return Number.isFinite(scale) && scale > 1e-6 ? scale : 1;
}

/** The largest axis scale over a batch's instances (its farthest-fading instance). */
function maxInstanceScale(mesh: InstancedMesh): number {
  let max = 0;
  for (let index = 0; index < mesh.count; index += 1) {
    mesh.getMatrixAt(index, instanceMatrix);
    const elements = instanceMatrix.elements;
    for (let axis = 0; axis < 3; axis += 1) {
      column.set(elements[axis * 4]!, elements[axis * 4 + 1]!, elements[axis * 4 + 2]!);
      max = Math.max(max, column.length());
    }
  }
  return max;
}
