import { Material, MeshNormalMaterial, type Mesh, type Scene, type Texture } from 'three';
import { applyFoliageFadeToOverride } from './foliageFade';

type Surface = Material & { map?: Texture | null; alphaMap?: Texture | null };
/** Per-source cache: live texture/threshold changes do not allocate per frame. */
export class AoSurfaceMaterials {
  private readonly entries = new Map<Material, { normal: MeshNormalMaterial; release: () => void }>();
  get(source: Material, compositedWater = false): MeshNormalMaterial {
    let entry = this.entries.get(source);
    if (!entry) {
      const normal = new MeshNormalMaterial();
      normal.allowOverride = false;
      normal.onBeforeCompile = (shader) => {
        const surface = source as Surface;
        shader.uniforms.map = { value: surface.map ?? null };
        shader.uniforms.alphaMap = { value: surface.alphaMap ?? null };
        shader.uniforms.alphaTest = { value: source.alphaTest };
        for (const key of ['map', 'alphaMap'] as const) {
          const texture = surface[key];
          if (texture) {
            if (texture.matrixAutoUpdate) texture.updateMatrix();
            shader.uniforms[`${key}Transform`] = { value: texture.matrix };
          }
        }
        shader.fragmentShader = shader.fragmentShader
          .replace('#define NORMAL', '#define NORMAL\n#include <common>')
          .replace('#include <uv_pars_fragment>', '#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <alphamap_fragment>\n#include <alphatest_fragment>');
        applyFoliageFadeToOverride(source, shader);
      };
      const release = () => { normal.dispose(); this.entries.delete(source); source.removeEventListener('dispose', release); };
      source.addEventListener('dispose', release);
      entry = { normal, release };
      this.entries.set(source, entry);
    }
    const normal = entry.normal;
    for (const texture of [(source as Surface).map, (source as Surface).alphaMap]) {
      if (texture?.matrixAutoUpdate) texture.updateMatrix();
    }
    // MeshNormalMaterial supplies skinning, morph, instancing and displacement chunks.
    const keys = ['side', 'alphaTest', 'opacity', 'visible', 'flatShading', 'map', 'alphaMap',
      'displacementMap', 'displacementScale', 'displacementBias', 'normalMap', 'normalMapType', 'normalScale',
      'bumpMap', 'bumpScale', 'clippingPlanes', 'clipIntersection', 'clipShadows'] as const;
    const target = normal as unknown as Record<string, unknown>;
    const input = source as unknown as Record<string, unknown>;
    for (const key of keys) {
      if (input[key] !== undefined && target[key] !== input[key]) {
        target[key] = input[key];
        normal.needsUpdate = true;
      }
    }
    normal.visible = source.visible && (source.depthWrite || compositedWater) && source.opacity > 0;
    normal.customProgramCacheKey = () => `forge-ao-surface-v1:${source.customProgramCacheKey()}`;
    return normal;
  }
  render<T>(scene: Scene, render: () => T): T {
    const saved: Array<[Mesh, Material | Material[]]> = [];
    scene.traverseVisible(object => {
      const mesh = object as Mesh;
      // Water/terrain have dedicated displacement overrides; leave those paths intact.
      if (!mesh.isMesh || object.userData.forgeTerrain) return;
      saved.push([mesh, mesh.material]);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => this.get(m, object.userData.compositedWaterSurface === true)) : this.get(mesh.material, object.userData.compositedWaterSurface === true);
    });
    try { return render(); }
    finally { for (const [mesh, material] of saved) mesh.material = material; }
  }
  dispose(): void { for (const entry of [...this.entries.values()]) entry.release(); }
}
