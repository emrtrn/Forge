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
import { Mesh, MeshStandardMaterial, type BufferGeometry, type Material } from "three";

import { assetPath, assetRecordById, assetType, isModelAssetType, type AssetManifest } from "@engine/assets/manifest";
import { bakeFracture, type FractureBakeResult } from "@engine/physics/fracture/fractureBake";
import {
  ChunkBudget,
  FractureRegistry,
  planChunkSpawns,
  type FractureImpactInfo,
  type FractureOverride,
  type FracturePlacement,
} from "@engine/physics/fracture/fractureRuntime";
import type { AssetFractureDef } from "@engine/physics/fracture/fractureTypes";
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
  fractureCommandsService,
  fractureHostService,
  scriptMessageBusService,
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

  const breakEntity = (entityId: string, impact: FractureImpactInfo | null, instigator: string | null): void => {
    const source = sources.get(entityId);
    const asset = source ? ready.get(source.assetId) : undefined;
    if (!host || !context || !source || !asset) return;
    const started = performance.now();
    // Actors and simulated placements move: break where the object is now.
    const pose = host.sourcePose(entityId) ?? source.authored;
    const velocity = host.physics.velocityOf(entityId) ?? [0, 0, 0];
    const specs = planChunkSpawns(asset.bake, asset.def, pose, velocity, impact);
    const cell = host.cellOf(entityId);
    if (cell) brokenCells.set(entityId, cell);
    host.physics.setImpactEventThreshold(entityId, null);
    host.destroySource(entityId);

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
      chunks.set(id, { mesh });
      budget.add({ id, ownerId: entityId, bornAt: clock, expiresAt: clock + spec.lifetime });
    });
    removeChunks(budget.enforce(host.chunkBudget()));
    lastSpawnMs = performance.now() - started;
    breaks += 1;
    services?.resolve(scriptMessageBusService)?.emit(FRACTURE_BROKEN_MESSAGE, entityId, {
      entityId,
      ...(instigator ? { instigator } : {}),
      impulse: impact?.impulse ?? 0,
    });
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
          if (!registry.requestBreak(entityId)) return false;
          breakEntity(entityId, null, instigator ?? null);
          return true;
        },
        isFractured: (entityId) => registry.state(entityId) === "fractured",
        snapshot: () => ({
          fracturable: registry.ids().length,
          fractured: registry.ids().filter((id) => registry.state(id) === "fractured").length,
          activeChunks: chunks.size,
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
        if (!target || !registry.requestBreak(target)) return;
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
          if (!registry.has(entityId) || !registry.applyImpact(entityId, impact.impulse)) continue;
          breakEntity(entityId, { point: impact.point, impulse: impact.impulse }, other);
          // The normal points out of `a`: the source pushed the hitter along it
          // (or against it when the source is `b`); give part of that back.
          const sign = entityId === impact.a ? -1 : 1;
          const back = impact.impulse * BREAKTHROUGH_RESTITUTION * sign;
          host.physics.applyImpulse(other, [impact.normal[0] * back, impact.normal[1] * back, impact.normal[2] * back]);
        }
      }
      removeChunks(budget.expire(clock));
    },

    dispose() {
      teardown();
      context = null;
      host = null;
      services = null;
    },
  };
}
