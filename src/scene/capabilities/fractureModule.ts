/**
 * Pre-baked fracture at runtime (DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 4/4b).
 *
 * Two kinds of source break with their mesh's enabled `<Model>.fracture.json`:
 * - every static-mesh placement, unless its `fracture` override opts out (which
 *   can also move the break impulse) — read from the layout, so placements in
 *   World Partition cells that stream in later are covered too;
 * - every Actor Script actor with a `Fracturable` component (the same override
 *   shape), tracked through the entity sink as it spawns or streams in.
 * Chunks are baked once per asset (the same pure bake the Static Mesh Editor
 * previews), the source's collider opts into impact events at its break
 * impulse, and the module listens for `Damage.Apply` / `Fracture.Break` script
 * messages. A break retires the source through the shell, spawns the chunks at
 * its live pose as dynamic convex bodies with an outward kick, and broadcasts
 * `Fracture.Broken`. Chunks live for the asset's lifetime inside a level-wide
 * budget (oldest first) and leave with the World Partition cell of their
 * source; that source then comes back whole when the cell returns (persisting
 * the broken state is Faz 5).
 *
 * Off (module not registered, or no shell host), every source keeps its
 * ordinary behaviour.
 */
import { Euler, Mesh, MeshStandardMaterial, Quaternion, type BufferGeometry, type Material } from "three";

import { assetPath, assetRecordById, assetType, isModelAssetType, type AssetManifest } from "@engine/assets/manifest";
import { bakeFracture, type FractureBakeResult } from "@engine/physics/fracture/fractureBake";
import {
  ChunkBudget,
  FractureRegistry,
  planChunkSpawns,
  type ChunkSpawnSpec,
  type FractureImpactInfo,
  type FractureVec3,
  type FractureOverride,
  type FracturePlacement,
} from "@engine/physics/fracture/fractureRuntime";
import { anchoredChunks, chunksInRadius, damageRadius, supportIslands } from "@engine/physics/fracture/fractureSupport";
import { fractureGrain, type AssetFractureDef } from "@engine/physics/fracture/fractureTypes";
import { polyhedronFromMesh, polyhedronVolume } from "@engine/physics/fracture/voronoiFracture";
import { fractureChunkGeometry, fractureSourceFromObject } from "@engine/render-three/fractureGeometry";
import { applyEulerDegrees } from "@engine/render-three/transforms";
import {
  readFracturableComponent,
  readRenderableMeshComponent,
  readTransformComponent,
} from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import { instanceEntityId } from "@engine/scene/legacyRoomLayoutAdapter";
import { readRotation, readScale } from "@engine/scene/transform";

import { loadAssetFracture } from "../assetFractureLoader";
import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeContext } from "./RuntimeContext";
import type { RuntimeServices } from "./RuntimeServices";
import {
  assetManifestService,
  audioCommandsService,
  fractureCommandsService,
  fractureHostService,
  scriptMessageBusService,
  vfxCommandsService,
  type FractureHost,
} from "./runtimeServiceKeys";

export const FRACTURE_MODULE_ID = "fracture";
/** Script message a script sends to break a target; broadcast when anything breaks. */
export const FRACTURE_BREAK_MESSAGE = "Fracture.Break";
export const FRACTURE_BROKEN_MESSAGE = "Fracture.Broken";
const DAMAGE_APPLY_MESSAGE = "Damage.Apply";
/**
 * Share of the breaking impulse handed back to the body that hit. The static
 * source stopped it during the physics step, before the break could happen;
 * without this a car would halt dead at a crate it then shatters.
 */
const BREAKTHROUGH_RESTITUTION = 0.6;

const FALLBACK_MATERIAL = new MeshStandardMaterial({ color: 0x9a8a78, roughness: 0.9 });

/** One fracturable asset's baked chunks, shared by every break of that asset. */
interface BakedAsset {
  readonly def: AssetFractureDef;
  readonly bake: FractureBakeResult;
  readonly geometries: readonly BufferGeometry[];
  readonly exterior: Material;
  readonly interior: Material | null;
}

/** A registered fracturable source. */
interface FractureSource {
  readonly assetId: string;
  readonly override: FractureOverride | undefined;
  /** The pose it was authored or spawned at; the shell's live pose wins when it has one. */
  readonly authored: FracturePlacement;
  /** Actors leave with their entity; placements stay registered from the layout. */
  readonly actor: boolean;
}

interface LiveChunkObject {
  readonly mesh: Mesh;
  /** Where its source broke; it is removed past `maxSeparation` metres from here (0 = never). */
  readonly origin: FractureVec3;
  readonly maxSeparation: number;
}

/**
 * A source hit while its asset's `support.mode` is `anchored` (Faz 4c): it
 * stands on as static chunk bodies until a chunk loses every path to an anchor.
 */
interface DamagedSource {
  readonly asset: BakedAsset;
  /** Pose it broke at; standing chunks never move. */
  readonly pose: FracturePlacement;
  /** Impulse that breaks a standing chunk further, N·s (the source's own threshold). */
  readonly threshold: number;
  readonly anchored: readonly boolean[];
  /** Chunk index → still standing. */
  readonly present: boolean[];
  /** Chunk index → its static body id while standing. */
  readonly staticIds: (string | null)[];
  /** Module clock of the last release; standing chunks ignore hits until the episode is over. */
  lastHitAt: number;
}

interface StaticChunk {
  readonly sourceId: string;
  readonly chunkIndex: number;
  readonly mesh: Mesh;
}

/** Every chunk body id (falling or standing) starts with this. */
const FRACTURE_CHUNK_PREFIX = "fracture:";
/** Seconds after a release during which a partly broken source takes no further hit. */
const HIT_EPISODE_SECONDS = 0.25;

/** Crumble effects one break may spawn; the rest of the small chunks just vanish. */
const MAX_CRUMBLE_EFFECTS = 6;

const EULER = new Euler();
const QUATERNION = new Quaternion();

/** Euler degrees (three XYZ, as chunk specs carry them) → quaternion [x, y, z, w]. */
function quaternionOf(rotation: FractureVec3): [number, number, number, number] {
  const radians = Math.PI / 180;
  QUATERNION.setFromEuler(EULER.set(rotation[0] * radians, rotation[1] * radians, rotation[2] * radians, "XYZ"));
  return [QUATERNION.x, QUATERNION.y, QUATERNION.z, QUATERNION.w];
}

function meanPosition(specs: readonly ChunkSpawnSpec[]): FractureVec3 | null {
  if (specs.length === 0) return null;
  const sum = specs.reduce<[number, number, number]>(
    (total, spec) => [total[0] + spec.position[0], total[1] + spec.position[1], total[2] + spec.position[2]],
    [0, 0, 0],
  );
  return [sum[0] / specs.length, sum[1] / specs.length, sum[2] / specs.length];
}

export function createFractureModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  let context: RuntimeContext | null = null;
  let host: FractureHost | null = null;
  let manifest: AssetManifest | null = null;
  const registry = new FractureRegistry();
  const budget = new ChunkBudget();
  /** Bakes per asset id; null = the asset does not break (no/disabled sidecar, no mesh). */
  const baked = new Map<string, Promise<BakedAsset | null>>();
  const ready = new Map<string, BakedAsset>();
  const sources = new Map<string, FractureSource>();
  /** Broken source → the World Partition cell its chunks leave with. */
  const brokenCells = new Map<string, string>();
  const chunks = new Map<string, LiveChunkObject>();
  /** Partly broken anchored sources, by source entity id. */
  const damaged = new Map<string, DamagedSource>();
  /** Standing chunk body id → where it belongs. */
  const staticChunks = new Map<string, StaticChunk>();
  const unsubscribes: Array<() => void> = [];
  /** Bumped by every teardown so a bake finishing for an old level is dropped. */
  let generation = 0;
  let clock = 0;
  let breaks = 0;
  let lastSpawnMs = 0;
  let chunkSerial = 0;

  const removeChunks = (ids: readonly string[]): void => {
    if (ids.length === 0) return;
    host?.physics.removeEntities(ids);
    for (const id of ids) {
      const chunk = chunks.get(id);
      if (!chunk) continue;
      chunk.mesh.removeFromParent();
      host?.attachDynamicObject(id, null);
      chunks.delete(id);
    }
  };

  /** The asset's break effect and sound at the break point, and its crumble effects. */
  const presentBreak = (def: AssetFractureDef, origin: FractureVec3, crumbled: readonly ChunkSpawnSpec[]): void => {
    const vfx = services?.resolve(vfxCommandsService);
    const position = (point: FractureVec3): [number, number, number] => [point[0], point[1], point[2]];
    if (vfx && def.breakEffect) void vfx.spawnEffectAt(def.breakEffect, { position: position(origin) }).catch(() => null);
    if (vfx && def.crumbleEffect) {
      for (const spec of crumbled.slice(0, MAX_CRUMBLE_EFFECTS)) {
        void vfx.spawnEffectAt(def.crumbleEffect, { position: position(spec.position) }).catch(() => null);
      }
    }
    if (def.breakSound) {
      services?.resolve(audioCommandsService)?.playOneShot(def.breakSound, { spatial: true, position: position(origin) });
    }
  };

  /** Chunks too small to be worth a body crumble into an effect instead. */
  const crumbles = (def: AssetFractureDef, spec: ChunkSpawnSpec): boolean =>
    def.crumbleBelow > 0 && spec.volumeFraction < def.crumbleBelow;

  const announce = (entityId: string, instigator: string | null, impulse: number): void => {
    breaks += 1;
    services?.resolve(scriptMessageBusService)?.emit(FRACTURE_BROKEN_MESSAGE, entityId, {
      entityId,
      ...(instigator ? { instigator } : {}),
      impulse,
    });
  };

  const breakEntity = (entityId: string, impact: FractureImpactInfo | null, instigator: string | null): void => {
    const source = sources.get(entityId);
    const asset = source ? ready.get(source.assetId) : undefined;
    if (!host || !context || !source || !asset) return;
    const started = performance.now();
    // Anchored assets break only around a hit; a scripted break still brings it all down.
    if (impact && asset.def.support.mode === "anchored" && breakAnchored(entityId, source, asset, impact)) {
      lastSpawnMs = performance.now() - started;
      announce(entityId, instigator, impact.impulse);
      return;
    }
    // Actors and simulated placements move: break where the object is now.
    const pose = host.sourcePose(entityId) ?? source.authored;
    const velocity = host.physics.velocityOf(entityId) ?? [0, 0, 0];
    const planned = planChunkSpawns(asset.bake, asset.def, pose, velocity, impact);
    const def = asset.def;
    const origin = impact?.point ?? meanPosition(planned) ?? pose.position;
    const cell = host.cellOf(entityId);
    if (cell) brokenCells.set(entityId, cell);
    host.physics.setImpactEventThreshold(entityId, null);
    host.destroySource(entityId);
    presentBreak(def, origin, planned.filter((spec) => crumbles(def, spec)));
    spawnDynamic(entityId, asset, planned.filter((spec) => !crumbles(def, spec)), origin);
    lastSpawnMs = performance.now() - started;
    announce(entityId, instigator, impact?.impulse ?? 0);
  };

  /** Spawns chunks as dynamic bodies with their render meshes, inside the level budget. */
  const spawnDynamic = (
    ownerId: string, asset: BakedAsset, specs: readonly ChunkSpawnSpec[], origin: FractureVec3,
  ): void => {
    if (!host || !context || specs.length === 0) return;
    const def = asset.def;
    const entityId = ownerId;
    const entities: Entity[] = [];
    const ids: string[] = [];
    for (const spec of specs) {
      const id = `fracture:${entityId}:${spec.chunkId}:${chunkSerial++}`;
      ids.push(id);
      entities.push({
        id,
        components: {
          // Colliders are pre-scaled (physics never applies Transform.scale).
          Transform: { position: [...spec.position], rotation: [...spec.rotation], scale: [1, 1, 1] },
          Collider: {
            shape: "box",
            size: [1, 1, 1],
            isStatic: false,
            isSensor: false,
            simulatePhysics: true,
            massKg: spec.massKg,
            primitives: [{ shape: "convex", size: [1, 1, 1], points: spec.hull.map((point) => [...point]) }],
          },
        },
      } as unknown as Entity);
    }
    host.physics.addEntities(entities);
    specs.forEach((spec, index) => {
      const id = ids[index]!;
      // The source's velocity and the outward kick, as one impulse on a body at rest.
      host!.physics.applyImpulse(id, [
        spec.impulse[0] + spec.linearVelocity[0] * spec.massKg,
        spec.impulse[1] + spec.linearVelocity[1] * spec.massKg,
        spec.impulse[2] + spec.linearVelocity[2] * spec.massKg,
      ]);
      const mesh = new Mesh(asset.geometries[spec.chunkIndex], [asset.exterior, asset.interior ?? asset.exterior]);
      mesh.name = id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
      mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
      applyEulerDegrees(mesh, [spec.rotation[0], spec.rotation[1], spec.rotation[2]]);
      context!.scene.add(mesh);
      host!.attachDynamicObject(id, mesh);
      chunks.set(id, { mesh, origin, maxSeparation: def.maxSeparation });
      budget.add({ id, ownerId: entityId, bornAt: clock, expiresAt: clock + spec.lifetime });
    });
    removeChunks(budget.enforce(host.chunkBudget()));
  };

  /** Every chunk of the asset at a pose, index-aligned, kicked away from `impact`. */
  const planAll = (asset: BakedAsset, pose: FracturePlacement, impact: FractureImpactInfo | null): ChunkSpawnSpec[] =>
    planChunkSpawns(asset.bake, { ...asset.def, maxActiveChunks: asset.bake.chunks.length }, pose, [0, 0, 0], impact);

  /**
   * Releases the chunks within the hit's damage radius, then every island the
   * release cut off from the anchors (APEX support). Returns the released indices.
   */
  const releaseAround = (
    state: DamagedSource, specs: readonly ChunkSpawnSpec[], hit: FractureVec3, impulse: number,
  ): number[] => {
    const support = state.asset.def.support;
    const radius = damageRadius(support.damageRadius, support.damageRadiusPerImpulse, impulse, support.damageRadiusMax);
    const released = chunksInRadius(specs.map((spec) => spec.position), state.present, hit, radius);
    for (const index of released) state.present[index] = false;
    const { islands } = supportIslands(state.present.length, state.asset.bake.links, state.anchored, state.present);
    for (const island of islands) {
      for (const index of island) {
        state.present[index] = false;
        released.push(index);
      }
    }
    return released;
  };

  /** Released chunks fall: the largest become bodies (per-asset cap), the rest crumble. */
  const dropReleased = (
    ownerId: string, asset: BakedAsset, specs: readonly ChunkSpawnSpec[], released: readonly number[], origin: FractureVec3,
  ): void => {
    const def = asset.def;
    const chosen = released.map((index) => specs[index]!)
      .sort((a, b) => b.volumeFraction - a.volumeFraction || a.chunkIndex - b.chunkIndex);
    const bodies = chosen.filter((spec) => !crumbles(def, spec)).slice(0, def.maxActiveChunks);
    presentBreak(def, origin, chosen.filter((spec) => !bodies.includes(spec)));
    spawnDynamic(ownerId, asset, bodies, origin);
  };

  /** What still stands of a partly broken source, as static chunk bodies that take the next hits. */
  const addStaticChunks = (sourceId: string, state: DamagedSource, specs: readonly ChunkSpawnSpec[]): void => {
    if (!host || !context) return;
    const standing = specs.filter((spec) => state.present[spec.chunkIndex]);
    const entities: Entity[] = standing.map((spec) => {
      const id = `fracture:${sourceId}:static:${spec.chunkId}:${chunkSerial++}`;
      state.staticIds[spec.chunkIndex] = id;
      return {
        id,
        components: {
          Transform: { position: [...spec.position], rotation: [...spec.rotation], scale: [1, 1, 1] },
          Collider: {
            shape: "box",
            size: [1, 1, 1],
            isStatic: true,
            isSensor: false,
            primitives: [{ shape: "convex", size: [1, 1, 1], points: spec.hull.map((point) => [...point]) }],
          },
        },
      } as unknown as Entity;
    });
    host.physics.addEntities(entities);
    for (const spec of standing) {
      const id = state.staticIds[spec.chunkIndex]!;
      const mesh = new Mesh(state.asset.geometries[spec.chunkIndex], [state.asset.exterior, state.asset.interior ?? state.asset.exterior]);
      mesh.name = id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
      mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
      applyEulerDegrees(mesh, [spec.rotation[0], spec.rotation[1], spec.rotation[2]]);
      context.scene.add(mesh);
      staticChunks.set(id, { sourceId, chunkIndex: spec.chunkIndex, mesh });
      host.physics.setImpactEventThreshold(id, state.threshold);
    }
  };

  const removeStaticChunks = (state: DamagedSource, indices: readonly number[]): void => {
    const ids = indices.map((index) => state.staticIds[index]).filter((id): id is string => !!id);
    if (ids.length === 0) return;
    host?.physics.removeEntities(ids);
    for (const id of ids) {
      host?.physics.setImpactEventThreshold(id, null);
      const chunk = staticChunks.get(id);
      chunk?.mesh.removeFromParent();
      staticChunks.delete(id);
      if (chunk) state.staticIds[chunk.chunkIndex] = null;
    }
  };

  /** Forgets a partly broken source and takes down what still stood of it. */
  const clearDamaged = (sourceId: string): void => {
    const state = damaged.get(sourceId);
    if (!state) return;
    removeStaticChunks(state, state.staticIds.map((_, index) => index));
    damaged.delete(sourceId);
  };

  /**
   * First hit of an anchored source: anchors come from the sidecar's regions and,
   * with World Support, from what the chunks touch right now (the source is
   * still standing, so the query sees the world it rests on). False when nothing
   * anchors it — then it breaks whole.
   */
  const breakAnchored = (
    entityId: string, source: FractureSource, asset: BakedAsset, impact: FractureImpactInfo,
  ): boolean => {
    if (!host) return false;
    const def = asset.def;
    const pose = host.sourcePose(entityId) ?? source.authored;
    const specs = planAll(asset, pose, impact);
    const anchored = anchoredChunks(asset.bake.chunks, def.support.anchors);
    if (def.support.worldSupport) {
      const exclude = new Set([entityId]);
      specs.forEach((spec, index) => {
        if (!anchored[index]) {
          anchored[index] = host!.physics.touchesStaticWorld(spec.position, quaternionOf(spec.rotation), spec.hull, exclude);
        }
      });
    }
    if (!anchored.some(Boolean)) return false;
    const state: DamagedSource = {
      asset,
      pose,
      threshold: registry.breakImpulse(entityId) ?? def.breakImpulse,
      anchored,
      present: specs.map(() => true),
      staticIds: specs.map(() => null),
      lastHitAt: clock,
    };
    const hit = impact.point ?? meanPosition(specs) ?? pose.position;
    const released = releaseAround(state, specs, hit, impact.impulse);
    const cell = host.cellOf(entityId);
    if (cell) brokenCells.set(entityId, cell);
    host.physics.setImpactEventThreshold(entityId, null);
    host.destroySource(entityId);
    damaged.set(entityId, state);
    addStaticChunks(entityId, state, specs);
    dropReleased(entityId, asset, specs, released, hit);
    if (!state.present.some(Boolean)) damaged.delete(entityId);
    return true;
  };

  /** A later hit on a standing chunk (or `all` = a scripted collapse) of a partly broken source. */
  const hitDamaged = (sourceId: string, hit: FractureVec3 | null, impulse: number, all = false): boolean => {
    const state = damaged.get(sourceId);
    if (!state || !host) return false;
    const point = hit ?? meanPosition(planAll(state.asset, state.pose, null).filter((spec) => state.present[spec.chunkIndex]));
    if (!point) return false;
    const specs = planAll(state.asset, state.pose, { point, impulse });
    const released = all
      ? state.present.flatMap((standing, index) => (standing ? [index] : []))
      : releaseAround(state, specs, point, impulse);
    if (all) state.present.fill(false);
    removeStaticChunks(state, released);
    dropReleased(sourceId, state.asset, specs, released, point);
    if (!state.present.some(Boolean)) damaged.delete(sourceId);
    return released.length > 0;
  };

  const bakeAsset = async (assetId: string, path: string, hostRef: FractureHost): Promise<BakedAsset | null> => {
    const def = await loadAssetFracture(path);
    if (!def?.enabled) return null;
    const root = hostRef.model(assetId);
    if (!root) return null;
    const source = fractureSourceFromObject(root);
    if (!source.mesh.indices || source.mesh.indices.length === 0) return null;
    const volume = polyhedronVolume(polyhedronFromMesh(source.mesh));
    // Baked up front so a break only creates bodies and meshes (plan risk 1).
    const bake = bakeFracture(source.mesh, {
      seed: def.seed,
      cellCount: def.cellCount,
      totalMass: volume * def.density,
      interiorUvScale: def.interiorUvScale,
      ...(fractureGrain(def) ? { grain: fractureGrain(def)! } : {}),
    });
    const interior = def.interiorMaterialId ? await hostRef.loadMaterial(def.interiorMaterialId) : null;
    return {
      def,
      bake,
      geometries: bake.chunks.map((chunk) => fractureChunkGeometry(chunk)),
      // As the intact placements render: the asset's slot material, else the model's own.
      exterior: hostRef.exteriorMaterial(assetId) ?? source.materials[0] ?? FALLBACK_MATERIAL,
      interior,
    };
  };

  /** The asset's bake, started once per level; null when the asset cannot break. */
  const ensureAsset = (assetId: string): Promise<BakedAsset | null> => {
    const existing = baked.get(assetId);
    if (existing) return existing;
    const record = manifest ? assetRecordById(manifest, assetId) : undefined;
    // A model that is not loaded yet (a streamed actor's cell model) is not
    // cached as unbreakable: the next spawn of it tries again.
    if (!host || !record || !isModelAssetType(assetType(record)) || !host.model(assetId)) return Promise.resolve(null);
    const level = generation;
    const pending = bakeAsset(assetId, assetPath(record), host).then((asset) => {
      if (asset && level === generation) ready.set(assetId, asset);
      return level === generation ? asset : null;
    });
    baked.set(assetId, pending);
    return pending;
  };

  const register = (entityId: string, source: FractureSource): void => {
    const asset = ready.get(source.assetId);
    if (!host || !asset || !registry.register(entityId, asset.def, source.override)) return;
    sources.set(entityId, source);
    host.physics.setImpactEventThreshold(entityId, registry.breakImpulse(entityId));
  };

  /** Starts tracking an actor with a `Fracturable` component (spawned, streamed or at level start). */
  const trackActor = async (entity: Entity): Promise<void> => {
    const component = readFracturableComponent(entity);
    const mesh = readRenderableMeshComponent(entity);
    const transform = readTransformComponent(entity);
    if (!component || !mesh || !transform) return;
    const level = generation;
    const asset = await ensureAsset(mesh.assetId);
    if (!asset || level !== generation) return;
    const meshScale = mesh.scale ?? [1, 1, 1];
    register(entity.id, {
      assetId: mesh.assetId,
      override: { enabled: component.enabled, ...(component.breakImpulse !== undefined ? { breakImpulse: component.breakImpulse } : {}) },
      authored: {
        position: [...transform.position],
        rotation: [...transform.rotation],
        scale: [transform.scale[0] * meshScale[0], transform.scale[1] * meshScale[1], transform.scale[2] * meshScale[2]],
      },
      actor: true,
    });
  };

  /**
   * A World Partition cell unloaded: the chunks of sources it owned go with it,
   * and those sources are whole again when it returns — placements re-register
   * now (the shell rebuilds them from the layout), actors when they respawn.
   */
  const cellUnloaded = (key: string): void => {
    for (const [entityId, cell] of [...brokenCells]) {
      if (cell !== key) continue;
      brokenCells.delete(entityId);
      removeChunks(budget.removeOwner(entityId));
      clearDamaged(entityId);
      const source = sources.get(entityId);
      if (!source) continue;
      sources.delete(entityId);
      registry.unregister(entityId);
      if (!source.actor) register(entityId, source);
    }
  };

  const teardown = (): void => {
    generation += 1;
    removeChunks(budget.clear());
    for (const id of [...damaged.keys()]) clearDamaged(id);
    for (const id of sources.keys()) host?.physics.setImpactEventThreshold(id, null);
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    for (const asset of ready.values()) for (const geometry of asset.geometries) geometry.dispose();
    baked.clear();
    ready.clear();
    sources.clear();
    brokenCells.clear();
    registry.clear();
    chunks.clear();
    manifest = null;
    clock = 0;
  };

  return {
    id: FRACTURE_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      services = runtimeServices;
      runtimeServices.provide(fractureCommandsService, {
        breakEntity: (entityId, instigator) => {
          if (damaged.has(entityId)) return hitDamaged(entityId, null, 0, true);
          if (!registry.requestBreak(entityId)) return false;
          breakEntity(entityId, null, instigator ?? null);
          return true;
        },
        isFractured: (entityId) => registry.state(entityId) === "fractured",
        snapshot: () => ({
          fracturable: registry.ids().length,
          fractured: registry.ids().filter((id) => registry.state(id) === "fractured").length,
          activeChunks: chunks.size,
          staticChunks: staticChunks.size,
          lastSpawnMs,
          breaks,
        }),
      });
      // Level-start actors are read from the scene document in onLevelLoaded;
      // the sink follows actors that spawn or stream in and out afterwards.
      runtimeServices.addEntitySink({
        setEntities: () => {},
        addEntity: (entity) => {
          if (host) void trackActor(entity);
        },
        removeEntity: (entityId) => {
          const source = sources.get(entityId);
          // A broken source is removed by its own break; its chunks stay.
          if (!source?.actor || registry.state(entityId) === "fractured") return;
          sources.delete(entityId);
          registry.unregister(entityId);
          host?.physics.setImpactEventThreshold(entityId, null);
        },
      });
    },

    async onLevelLoaded(levelContext) {
      teardown();
      if (levelContext.mode === "editor") return;
      const hostRef = levelContext.resolve(fractureHostService);
      if (!hostRef) return;
      context = levelContext;
      host = hostRef;
      const level = generation;
      manifest = (await levelContext.resolve(assetManifestService)?.()) ?? null;
      if (!manifest || level !== generation) return;
      unsubscribes.push(hostRef.onCellUnloaded(cellUnloaded));
      // Every placement of the layout, built or not: a partitioned level merges
      // its cells into `layout.instances` but builds a cell's bodies only when it
      // streams in. The impact opt-in is kept by entity id, so it applies then.
      for (const group of levelContext.layout.instances) {
        if (group.placements.length === 0) continue;
        const asset = await ensureAsset(group.assetId);
        if (!asset || level !== generation) continue;
        group.placements.forEach((placement, index) => {
          if (placement.hidden) return;
          // The placement may opt out or move the threshold (plan §4, K-04).
          register(instanceEntityId(group.assetId, index), {
            assetId: group.assetId,
            override: placement.fracture,
            authored: {
              position: [placement.position[0], placement.position[1], placement.position[2]],
              rotation: readRotation(placement),
              scale: readScale(placement),
            },
            actor: false,
          });
        });
      }
      await Promise.all(levelContext.sceneDocument.entities.map((entity) => trackActor(entity)));
      if (level !== generation) return;
      const bus = levelContext.resolve(scriptMessageBusService);
      if (!bus) return;
      unsubscribes.push(bus.subscribe(DAMAGE_APPLY_MESSAGE, (envelope) => {
        const target = envelope.target;
        const payload = envelope.payload as { amount?: unknown; instigator?: unknown } | undefined;
        if (!target || !registry.applyDamage(target, Number(payload?.amount))) return;
        const instigator = typeof payload?.instigator === "string" ? payload.instigator : envelope.source;
        breakEntity(target, null, instigator);
      }));
      unsubscribes.push(bus.subscribe(FRACTURE_BREAK_MESSAGE, (envelope) => {
        const target = envelope.target;
        if (!target) return;
        // A partly broken source: a scripted break brings down what still stands.
        if (damaged.has(target)) {
          hitDamaged(target, null, 0, true);
          return;
        }
        if (!registry.requestBreak(target)) return;
        breakEntity(target, null, envelope.source);
      }));
    },

    onLevelUnloaded() {
      teardown();
      context = null;
      host = null;
    },

    update(deltaSeconds) {
      clock += deltaSeconds;
      if (!host) return;
      for (const impact of host.physics.impacts()) {
        for (const [entityId, other] of [[impact.a, impact.b], [impact.b, impact.a]] as const) {
          const standing = staticChunks.get(entityId);
          if (standing) {
            // A standing chunk of a partly broken source: the same rule, from this hit.
            // Debris does not bring the structure down (it lands on it at full
            // weight, often wedged against it), and the frames that follow a
            // hit are the same collision going on, not a new one.
            const state = damaged.get(standing.sourceId);
            if (!state || impact.impulse < state.threshold || other.startsWith(FRACTURE_CHUNK_PREFIX)) continue;
            if (clock - state.lastHitAt < HIT_EPISODE_SECONDS) continue;
            state.lastHitAt = clock;
            hitDamaged(standing.sourceId, impact.point ?? null, impact.impulse);
          } else {
            if (!registry.has(entityId) || !registry.applyImpact(entityId, impact.impulse)) continue;
            breakEntity(entityId, { point: impact.point, impulse: impact.impulse }, other);
          }
          // The normal points out of `a`: the source pushed the hitter along it
          // (or against it when the source is `b`); give part of that back.
          const sign = entityId === impact.a ? -1 : 1;
          const back = impact.impulse * BREAKTHROUGH_RESTITUTION * sign;
          host.physics.applyImpulse(other, [impact.normal[0] * back, impact.normal[1] * back, impact.normal[2] * back]);
        }
      }
      removeChunks(budget.expire(clock));
      const strayed: string[] = [];
      for (const [id, chunk] of chunks) {
        if (chunk.maxSeparation <= 0) continue;
        const { x, y, z } = chunk.mesh.position;
        if (Math.hypot(x - chunk.origin[0], y - chunk.origin[1], z - chunk.origin[2]) > chunk.maxSeparation) strayed.push(id);
      }
      for (const id of strayed) budget.remove(id);
      removeChunks(strayed);
    },

    dispose() {
      teardown();
      context = null;
      host = null;
      services = null;
    },
  };
}
