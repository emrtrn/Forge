/**
 * Layer 2 capability: VFX — the runtime's particle effects.
 *
 * Owns the {@link VfxSubsystem}: the `.effect.json` definition cache, the
 * instance pool, the persistent container every live effect is parented to, the
 * per-frame advance and one-shot recycling, and the quality profile's particle
 * density. It also owns the manifest lookup that turns an `effect` or `texture`
 * asset id into a fetchable URL, which is how a definition and its sprite sheets
 * are resolved.
 *
 * It ticks in the `presentation` slot: particles are output, advanced from a
 * world that has already been simulated this frame.
 *
 * The scene it renders into arrives as a host service, because the container is
 * parented once and outlives every level (only its instances are cleared on a
 * rebuild). No scene, no module: there would be nowhere to put an effect.
 *
 * Everything else is asked of it at call time, so switching it off removes only
 * particles: an emitter actor still exists, is still selectable and still runs
 * its scripts, a `playParticleEffect` script command becomes a no-op, and the
 * `?debug` overlay reports an empty VFX runtime. A game with no particles pays
 * for no pool, no cache and no per-frame advance.
 */
import { VfxSubsystem, type VfxDebugSnapshot } from "@engine/render-three/vfxSubsystem";
import { assetPath, assetType, type AssetManifest } from "@engine/assets/manifest";
import {
  readParticleEmitterComponent,
  readTransformComponent,
} from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import type { SceneDocument } from "@engine/scene/sceneDocument";
import { projectFileUrl } from "@/project/ProjectSystem";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import { vfxCommandsService, vfxHostService } from "./runtimeServiceKeys";

export const VFX_MODULE_ID = "vfx";

/** What `?debug` reports for a runtime whose VFX capability never registered. */
const EMPTY_VFX_SNAPSHOT: VfxDebugSnapshot = {
  activeInstances: 0,
  aliveParticles: 0,
  pooledInstances: 0,
  cachedDefinitions: 0,
  instances: [],
};

export function createVfxModule(): CapabilityModule {
  /** Manifest effect (`.effect.json`) asset id -> fetchable file URL. */
  const effectUrlById = new Map<string, string>();
  /** Manifest texture asset id -> fetchable image URL (particle sprite textures). */
  const textureUrlById = new Map<string, string>();
  let vfx: VfxSubsystem | null = null;

  /**
   * Spawns an entity's effect at its authored position. The definition is warmed
   * first so the synchronous `play()` hits the cache; the component's
   * scale/tint/loop fields are the per-instance overrides.
   */
  async function playEntityEffect(entity: Entity, requireAutoPlay: boolean): Promise<void> {
    if (!vfx) return;
    const particle = readParticleEmitterComponent(entity);
    if (!particle || particle.enabled === false) return;
    if (requireAutoPlay && !particle.autoPlay) return;
    const transform = readTransformComponent(entity);
    if (!transform) return;
    await vfx.warm(particle.effectId);
    vfx.play(particle.effectId, { ...particle, position: transform.position });
  }

  return {
    id: VFX_MODULE_ID,

    onRuntimeStart(services: RuntimeServices) {
      const host = services.resolve(vfxHostService);
      // No scene means nowhere to render an effect: stay unregistered rather
      // than pooling instances nothing can ever see.
      if (!host) return;

      vfx = new VfxSubsystem({
        resolveEffectUrl: (effectId) => effectUrlById.get(effectId) ?? null,
        resolveTextureUrl: (textureId) => textureUrlById.get(textureId) ?? null,
      });
      // One persistent container; live effects come and go as its children, so
      // it is parented once and survives every scene rebuild.
      host.scene.add(vfx.root);
      services.addSubsystem("presentation", vfx);

      services.provide(vfxCommandsService, {
        prepareLevel(manifest: AssetManifest) {
          for (const asset of manifest.assets) {
            const path = assetPath(asset);
            if (assetType(asset) === "texture") textureUrlById.set(asset.id, projectFileUrl(path));
            // Prefer the `effect` asset type; fall back to the `.effect.json`
            // suffix so older manifests (effect assets typed as `prefab`) keep
            // resolving.
            if (assetType(asset) === "effect" || path.endsWith(".effect.json")) {
              effectUrlById.set(asset.id, projectFileUrl(path));
            }
          }
        },
        async playAutoPlay(document: SceneDocument) {
          for (const entity of document.entities) await playEntityEffect(entity, true);
        },
        playAutoPlayEntity: (entity) => playEntityEffect(entity, true),
        triggerEntityEffect: (entity) => playEntityEffect(entity, false),
        setGlobalDensity: (scale) => vfx?.setGlobalDensity(scale),
        debugSnapshot: (): VfxDebugSnapshot => vfx?.getDebugSnapshot() ?? EMPTY_VFX_SNAPSHOT,
      });
    },

    onLevelUnloaded() {
      // Stop live instances; the definition cache + pool stay warm for the
      // rebuild, which re-spawns the same project's effects. The URL maps are
      // re-filled by the next `prepareLevel`, so a re-authored asset is picked up.
      vfx?.clear();
      effectUrlById.clear();
      textureUrlById.clear();
    },

    dispose() {
      vfx?.root.removeFromParent();
      vfx?.dispose();
      vfx = null;
      effectUrlById.clear();
      textureUrlById.clear();
    },
  };
}
