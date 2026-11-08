import type { Group, WebGLRenderer } from "three";

import type { FoliageRenderResolver } from "@engine/render-three/foliage";
import { bakeFoliageImpostorAtlas, type FoliageImpostorAtlas } from "@engine/render-three/foliageImpostor";
import type { FoliageImpostorSource } from "./proceduralFoliageRing";

/**
 * Far billboard atlases by mesh asset id, baked on first use from the loaded
 * model with its material slots applied, and kept for the level (a rebuilt
 * foliage ring reuses them). A model not loaded yet is not cached as missing.
 */
export class FoliageImpostorCache implements FoliageImpostorSource {
  private readonly atlases = new Map<string, FoliageImpostorAtlas | null>();

  constructor(private readonly renderer: WebGLRenderer, private readonly resolver: FoliageRenderResolver) {}

  atlas(meshAssetId: string): FoliageImpostorAtlas | null {
    if (this.atlases.has(meshAssetId)) return this.atlases.get(meshAssetId)!;
    const gltf = this.resolver.getModel(meshAssetId);
    if (!gltf) return null;
    const model = gltf.scene.clone(true) as Group;
    this.resolver.applyMaterialSlots?.(meshAssetId, model);
    let atlas: FoliageImpostorAtlas | null = null;
    try {
      atlas = bakeFoliageImpostorAtlas(this.renderer, model);
    } catch (error) {
      console.warn(`[foliage] impostor bake failed for ${meshAssetId}:`, error);
    }
    this.atlases.set(meshAssetId, atlas);
    return atlas;
  }

  dispose(): void {
    for (const atlas of this.atlases.values()) atlas?.dispose();
    this.atlases.clear();
  }
}
