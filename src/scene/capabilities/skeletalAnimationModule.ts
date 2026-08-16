/**
 * Layer 2 capability: Skeletal Animation — the authored `*.skeleton.json`
 * sidecar library.
 *
 * Owns loading and caching every character asset's skeletal metadata: blend
 * spaces, the anim-set role map, sockets, notifies, montages and root motion.
 * One fetch per asset per level, shared by every placement of it.
 *
 * What this module deliberately does *not* own is attaching a def to a
 * character. A character ref (`RuntimeCharacterRef`) is a Game Mode type — Layer
 * 3 — and the shell must have the metadata attached before the Game Mode
 * possesses a pawn, which happens before any capability's level hook runs. So
 * the shell calls {@link SkeletonLibrary.load} at that point and does the
 * one-line attach itself; Phase F, which turns the Game Mode into a module of
 * its own, is where that ordering stops being a constraint.
 *
 * Switched off, no sidecar is ever fetched and every character keeps an absent
 * skeleton: it still renders and plays its authored clip, just without blend
 * spaces, root motion or notifies. A top-down game with no skeletal characters
 * stops paying for the metadata entirely.
 */
import { assetPath } from "@engine/assets/manifest";

import { defaultAssetSkeleton, loadAssetSkeleton, type AssetSkeletonDef } from "../assetSkeletonLoader";
import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import { assetManifestService, skeletonLibraryService } from "./runtimeServiceKeys";

export const SKELETAL_ANIMATION_MODULE_ID = "skeletal-animation";

export function createSkeletalAnimationModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  /** In-flight or settled sidecar per asset id; dropped when the level unloads. */
  let pending = new Map<string, Promise<AssetSkeletonDef>>();

  return {
    id: SKELETAL_ANIMATION_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      services = runtimeServices;
      runtimeServices.provide(skeletonLibraryService, {
        async load(assetIds) {
          const loaded = new Map<string, AssetSkeletonDef>();
          if (assetIds.length === 0) return loaded;
          const manifest = (await services?.resolve(assetManifestService)?.()) ?? null;
          // No manifest means no way to find a sidecar path; every character
          // falls back to the empty default rather than the load failing.
          await Promise.all(
            [...new Set(assetIds)].map(async (assetId) => {
              let sidecar = pending.get(assetId);
              if (!sidecar) {
                const asset = manifest?.assets.find((entry) => entry.id === assetId);
                sidecar = asset
                  ? loadAssetSkeleton(assetPath(asset))
                  : Promise.resolve(defaultAssetSkeleton());
                pending.set(assetId, sidecar);
              }
              loaded.set(assetId, await sidecar);
            }),
          );
          return loaded;
        },
      });
    },

    onLevelUnloaded() {
      // The next level re-reads its own sidecars: an asset may have been
      // re-authored between levels, and a stale promise would hide that.
      pending = new Map();
    },

    dispose() {
      pending = new Map();
      services = null;
    },
  };
}
