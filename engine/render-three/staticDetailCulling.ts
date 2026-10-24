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
 */

interface AssetFade {
  cullDistance: number;
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
  /** Largest scale the shader divides distance by (instance, or world for a clone). */
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
    const fade = this.assetFade(assetId, cullDistance);
    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => this.fadeOf(fade, material))
        : this.fadeOf(fade, mesh.material);
      mesh.customDepthMaterial = fade.depth;
      mesh.customDistanceMaterial = fade.distance;
      const instanced = (mesh as InstancedMesh).isInstancedMesh === true;
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
        maxScale: instanced ? maxInstanceScale(mesh as InstancedMesh) : mesh.matrixWorld.getMaxScaleOnAxis(),
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
      fade.uniforms.uFoliageFadeRange.value.set(start, end);
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

  private assetFade(assetId: string, cullDistance: number): AssetFade {
    let fade = this.assets.get(assetId);
    if (!fade) {
      const uniforms: FoliageFadeUniforms = { uFoliageFadeOrigin: this.origin, uFoliageFadeRange: { value: new Vector2() } };
      const shadow = createFoliageFadeShadowMaterials(uniforms, "instanceScaled");
      fade = { cullDistance, uniforms, clones: new Map(), fades: new Set(), depth: shadow.depth, distance: shadow.distance };
      this.assets.set(assetId, fade);
    }
    return fade;
  }

  private fadeOf(fade: AssetFade, source: Material): Material {
    // A batch rebuilt from already-faded meshes keeps its clone.
    if (fade.fades.has(source)) return source;
    let clone = fade.clones.get(source);
    if (!clone) {
      clone = createFoliageFadeMaterial(source, fade.uniforms, "instanceScaled");
      fade.clones.set(source, clone);
      fade.fades.add(clone);
    }
    return clone;
  }
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
