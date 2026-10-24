import { Mesh, SkinnedMesh, Texture, type WebGLRenderer } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createForgeGltfLoader } from "./gltfLoader";
import { applyDefaultModelTextureAnisotropy } from "./textureConfig";

export class GltfModelLoader {
  private readonly modelPromises = new Map<string, Promise<GLTF>>();
  private readonly gltfLoader;
  private readonly maxAnisotropy: number | undefined;

  constructor(renderer?: WebGLRenderer) {
    this.gltfLoader = createForgeGltfLoader(renderer);
    this.maxAnisotropy = renderer?.capabilities.getMaxAnisotropy();
  }

  load(id: string, url: string): Promise<GLTF> {
    let promise = this.modelPromises.get(id);
    if (!promise) {
      // Don't keep a rejected load cached: a transient failure (dev server
      // reload, the file being rewritten, a network blip) would otherwise
      // poison this id forever, so every later attempt replays the same
      // "failed to fetch". Drop it on error so the next call can retry.
      promise = this.gltfLoader
        .loadAsync(url)
        .then((gltf) => {
          applyDefaultModelTextureAnisotropy(gltf.scene, this.maxAnisotropy);
          return gltf;
        })
        .catch((error) => {
          this.modelPromises.delete(id);
          throw error;
        });
      this.modelPromises.set(id, promise);
    }
    return promise;
  }

  /** Drops a cached model so the next load fetches it again; the caller disposes its resources. */
  forget(id: string): void {
    this.modelPromises.delete(id);
  }
}

/**
 * Frees a loaded model's GPU resources: geometries, materials, their textures and
 * skeleton bone textures. Only for a model no scene object still renders, since
 * clones share all of these with the source.
 */
export function disposeGltfResources(gltf: GLTF): void {
  const textures = new Set<Texture>();
  gltf.scene.traverse((object) => {
    if (object instanceof SkinnedMesh) object.skeleton.dispose();
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}
