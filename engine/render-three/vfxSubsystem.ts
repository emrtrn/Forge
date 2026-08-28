/**
 * VFX Lite runtime subsystem (VFX Lite Faz 5). Owns every live particle effect:
 * resolves an `effectId` to a cached definition, spawns a pooled
 * {@link ParticleEffect} instance under its own scene {@link root} group, advances
 * them each frame, and recycles finished one-shots so a long play session never
 * grows unbounded. Mirrors {@link AudioSubsystem}: URL resolution and (optionally)
 * definition loading are injected callbacks, so the engine layer stays
 * manifest-agnostic and the subsystem is headless-testable.
 *
 * It touches Three.js (it manages `Points` objects), so it lives under
 * `render-three/` next to {@link ParticleEffect} rather than in the DOM/Three-free
 * `engine/vfx/`.
 */
import { Group, type Object3D } from "three";

import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import { parseRuntimeParticleEffect } from "../vfx/particleEffectParser";
import type { RuntimeParticleEffect, Vec3 } from "../vfx/particleEffectTypes";
import { ParticleEffect, type ParticleEffectOverrides } from "./particleEffect";
import { MeshParticleEffect } from "./meshParticleEffect";

export const VFX_SUBSYSTEM_ID = "vfx";

/** Per-effect pool cap: beyond this, retired one-shots are disposed, not kept. */
const MAX_POOL_PER_EFFECT = 32;

export type VfxInstanceId = number;

/** Spawn options for {@link VfxSubsystem.play}: world origin + §8 overrides. */
export interface VfxPlayOptions extends ParticleEffectOverrides {
  /** World-space origin the emitter spawns from (default `[0, 0, 0]`). */
  position?: Vec3;
}

export interface VfxInstanceDebug {
  readonly id: VfxInstanceId;
  readonly effectId: string;
  readonly aliveParticles: number;
  readonly enabled: boolean;
}

/** A read-only snapshot of the VFX runtime for the `?debug` overlay / tests. */
export interface VfxDebugSnapshot {
  readonly activeInstances: number;
  readonly aliveParticles: number;
  readonly pooledInstances: number;
  readonly cachedDefinitions: number;
  readonly instances: readonly VfxInstanceDebug[];
}

export interface VfxSubsystemOptions {
  /**
   * Resolves an `effectId` to a fetchable `.effect.json` URL (a manifest effect
   * asset). Returning null caches a miss so the effect simply plays nothing.
   * Injected by the host so the engine layer stays manifest-agnostic.
   */
  resolveEffectUrl?: (effectId: string) => string | null;
  /**
   * Resolves a sprite-texture asset id (from `renderer.texture`) to a fetchable
   * image URL (VFX Lite Faz 6a). Injected by the host so the engine layer stays
   * manifest-agnostic; absent/returning null keeps the procedural sprite.
   */
  resolveTextureUrl?: (textureId: string) => string | null;
  /** Resolves manifest-validated static mesh ids to loaded GLTF scene roots. */
  loadMeshModels?: (modelIds: readonly string[]) => Promise<readonly Object3D[]>;
  /**
   * Loads + parses a definition from a resolved URL. Defaults to `fetch` + JSON +
   * {@link parseRuntimeParticleEffect}; tests inject a synchronous fixture loader.
   */
  loadDefinition?: (url: string) => Promise<RuntimeParticleEffect | null>;
  /**
   * Optional live-instance budget. Once full, new plays are silently skipped;
   * existing effects finish normally. Omit for the legacy unbounded behaviour.
   */
  maxActiveInstances?: number;
}

type LiveParticleEffect = ParticleEffect | MeshParticleEffect;

interface VfxInstance {
  readonly id: VfxInstanceId;
  readonly effectId: string;
  readonly effect: LiveParticleEffect;
  enabled: boolean;
}

async function fetchDefinition(url: string): Promise<RuntimeParticleEffect | null> {
  try {
    const response = await fetch(url);
    return parseRuntimeParticleEffect((await response.json()) as unknown);
  } catch {
    return null;
  }
}

export class VfxSubsystem implements Subsystem {
  readonly id = VFX_SUBSYSTEM_ID;
  /** Scene container the host adds once; effects live/come/go as its children. */
  readonly root = new Group();
  private readonly resolveEffectUrl: (effectId: string) => string | null;
  private readonly resolveTextureUrl: (textureId: string) => string | null;
  private readonly loadMeshModels: (modelIds: readonly string[]) => Promise<readonly Object3D[]>;
  private readonly loadDefinition: (url: string) => Promise<RuntimeParticleEffect | null>;
  /** Parsed definitions keyed by effectId; a cached `null` marks a known miss. */
  private readonly definitions = new Map<string, RuntimeParticleEffect | null>();
  /** In-flight definition loads, so concurrent warms fetch the file once. */
  private readonly loading = new Map<string, Promise<RuntimeParticleEffect | null>>();
  /** Mesh source roots warmed with their definition and shared across instances. */
  private readonly meshModels = new Map<string, readonly Object3D[]>();
  /** Retired one-shot effects keyed by effectId, reused on the next matching play. */
  private readonly pool = new Map<string, LiveParticleEffect[]>();
  private readonly instances = new Map<VfxInstanceId, VfxInstance>();
  private nextId = 1;
  /** Global density multiplier applied to every effect's spawn rate (quality). */
  private globalDensity = 1;
  /** Optional host-owned guard against a burst of simultaneous one-shots. */
  private maxActiveInstances = Number.POSITIVE_INFINITY;

  constructor(options: VfxSubsystemOptions = {}) {
    this.root.name = "vfx-root";
    this.resolveEffectUrl = options.resolveEffectUrl ?? (() => null);
    this.resolveTextureUrl = options.resolveTextureUrl ?? (() => null);
    this.loadMeshModels = options.loadMeshModels ?? (async () => []);
    this.loadDefinition = options.loadDefinition ?? fetchDefinition;
    this.setMaxActiveInstances(options.maxActiveInstances);
  }

  /**
   * Warms the definition cache for an effect id (resolve URL + load + parse) so a
   * later {@link play} is synchronous. Idempotent and de-duplicated: repeated or
   * concurrent warms of the same id load the file once. Resolves to the (cached)
   * definition, or null when the id is unknown / fails to load.
   */
  warm(effectId: string): Promise<RuntimeParticleEffect | null> {
    const cached = this.definitions.get(effectId);
    if (cached !== undefined) return Promise.resolve(cached);
    const inFlight = this.loading.get(effectId);
    if (inFlight) return inFlight;
    const url = this.resolveEffectUrl(effectId);
    if (!url) {
      this.definitions.set(effectId, null);
      return Promise.resolve(null);
    }
    const pending = this.loadDefinition(url)
      .catch(() => null)
      .then(async (definition) => {
        if (definition?.rendererType === "mesh") {
          const models = await this.loadMeshModels(definition.modelIds ?? []).catch(() => []);
          if (models.length === 0) definition = null;
          else this.meshModels.set(effectId, models);
        }
        this.definitions.set(effectId, definition);
        this.loading.delete(effectId);
        return definition;
      });
    this.loading.set(effectId, pending);
    return pending;
  }

  /**
   * Spawns a live instance of a *warmed* effect at `options.position`, returning
   * its instance id. Returns null when the definition isn't cached yet (and kicks
   * off a {@link warm} so a subsequent play succeeds) or when the id is a known
   * miss — an un-warmed play never blocks the frame.
   */
  play(effectId: string, options: VfxPlayOptions = {}): VfxInstanceId | null {
    const definition = this.definitions.get(effectId);
    if (!definition) {
      // undefined = never warmed → start a load; null = known miss → stay silent.
      if (definition === undefined) void this.warm(effectId);
      return null;
    }
    if (this.instances.size >= this.maxActiveInstances) return null;
    const effect = this.acquire(effectId, definition, options);
    if (!effect) return null;
    const p = options.position;
    effect.setOrigin(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0);
    this.root.add(effect.object3D);
    const id = this.nextId++;
    this.instances.set(id, { id, effectId, effect, enabled: true });
    return id;
  }

  /** Stops and recycles an instance (a no-op for an unknown/already-stopped id). */
  stop(instanceId: VfxInstanceId): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    this.instances.delete(instanceId);
    this.recycle(instance);
  }

  /** Freezes/thaws an instance's simulation and visibility (Unreal SetActive). */
  setEnabled(instanceId: VfxInstanceId, enabled: boolean): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.enabled = enabled;
    instance.effect.object3D.visible = enabled;
  }

  /**
   * Sets the global particle-density multiplier (quality knob): scales the spawn
   * rate of every effect — live, pooled and future — so fewer particles are
   * emitted (less fill/overdraw). `1` = authored density, `0` = suppressed.
   * Applied on top of per-instance overrides; never mutates effect definitions.
   */
  setGlobalDensity(scale: number): void {
    this.globalDensity = Number.isFinite(scale) && scale >= 0 ? scale : 1;
    for (const instance of this.instances.values()) {
      instance.effect.setDensityScale(this.globalDensity);
    }
    for (const bucket of this.pool.values()) {
      for (const effect of bucket) effect.setDensityScale(this.globalDensity);
    }
  }

  /**
   * Updates the host's active-instance budget without interrupting existing
   * effects. Non-finite or negative input restores the unlimited default.
   */
  setMaxActiveInstances(limit: number | undefined): void {
    this.maxActiveInstances = typeof limit === "number" && Number.isFinite(limit) && limit >= 0
      ? Math.floor(limit)
      : Number.POSITIVE_INFINITY;
  }

  update(context: EngineUpdateContext): void {
    this.advance(context.deltaSeconds);
  }

  /**
   * Advances every enabled instance and recycles finished one-shots. Split from
   * {@link update} so a host that drives VFX outside the engine subsystem loop
   * (or a test) can tick it directly.
   */
  advance(deltaSeconds: number): void {
    for (const instance of this.instances.values()) {
      if (!instance.enabled) continue;
      instance.effect.update(deltaSeconds);
      if (instance.effect.isFinished()) {
        this.instances.delete(instance.id);
        this.recycle(instance);
      }
    }
  }

  getDebugSnapshot(): VfxDebugSnapshot {
    let aliveParticles = 0;
    const instances: VfxInstanceDebug[] = [];
    for (const instance of this.instances.values()) {
      const alive = instance.effect.aliveCount();
      aliveParticles += alive;
      instances.push({
        id: instance.id,
        effectId: instance.effectId,
        aliveParticles: alive,
        enabled: instance.enabled,
      });
    }
    let pooledInstances = 0;
    for (const bucket of this.pool.values()) pooledInstances += bucket.length;
    return {
      activeInstances: this.instances.size,
      aliveParticles,
      pooledInstances,
      cachedDefinitions: this.definitions.size,
      instances,
    };
  }

  /**
   * Stops every active instance (recycling to the pool) but keeps the definition
   * cache and pool warm — used on a scene rebuild, where the same project's
   * effects are about to be re-spawned.
   */
  clear(): void {
    for (const instance of this.instances.values()) this.recycle(instance);
    this.instances.clear();
  }

  /** Tears down every effect (active + pooled) and clears all caches. */
  dispose(): void {
    for (const instance of this.instances.values()) {
      this.root.remove(instance.effect.object3D);
      instance.effect.dispose();
    }
    this.instances.clear();
    for (const bucket of this.pool.values()) {
      for (const effect of bucket) effect.dispose();
    }
    this.pool.clear();
    this.definitions.clear();
    this.loading.clear();
    this.meshModels.clear();
  }

  /** Reuses a pooled effect (reset with the new overrides) or allocates a fresh one. */
  private acquire(
    effectId: string,
    definition: RuntimeParticleEffect,
    overrides: ParticleEffectOverrides,
  ): LiveParticleEffect | null {
    const pooled = this.pool.get(effectId)?.pop();
    if (pooled) {
      pooled.reset(overrides);
      pooled.setDensityScale(this.globalDensity);
      return pooled;
    }
    const effect =
      definition.rendererType === "mesh"
        ? (() => {
            const models = this.meshModels.get(effectId);
            return models && models.length > 0
              ? new MeshParticleEffect(definition, models, overrides)
              : null;
          })()
        : new ParticleEffect(
            definition,
            overrides,
            definition.texture ? this.resolveTextureUrl(definition.texture) : null,
          );
    if (!effect) return null;
    effect.setDensityScale(this.globalDensity);
    return effect;
  }

  /** Detaches an instance's object and returns its effect to the (bounded) pool. */
  private recycle(instance: VfxInstance): void {
    this.root.remove(instance.effect.object3D);
    instance.effect.object3D.visible = true;
    let bucket = this.pool.get(instance.effectId);
    if (!bucket) {
      bucket = [];
      this.pool.set(instance.effectId, bucket);
    }
    if (bucket.length < MAX_POOL_PER_EFFECT) bucket.push(instance.effect);
    else instance.effect.dispose();
  }
}
