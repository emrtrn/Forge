/**
 * Pre-baked fracture at runtime (DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 4).
 *
 * Every static-mesh placement whose model has an enabled `<Model>.fracture.json`
 * becomes fracturable: its chunks are baked once per asset at level load (the
 * same pure bake the Static Mesh Editor previews), its collider opts into
 * impact events at the asset's break impulse, and the module listens for
 * `Damage.Apply` / `Fracture.Break` script messages. A break retires the intact
 * object through the shell, spawns the chunks as dynamic convex bodies with an
 * outward kick, and broadcasts `Fracture.Broken`. Chunks live for the asset's
 * lifetime inside a level-wide budget (oldest first).
 *
 * Off (module not registered, or no shell host), every placement keeps its
 * ordinary static behaviour.
 */
import { Mesh, MeshStandardMaterial, type BufferGeometry, type Material } from "three";

import { assetPath, assetRecordById, assetType, isModelAssetType } from "@engine/assets/manifest";
import { bakeFracture, type FractureBakeResult } from "@engine/physics/fracture/fractureBake";
import {
  ChunkBudget,
  FractureRegistry,
  planChunkSpawns,
  type FractureImpactInfo,
  type FracturePlacement,
} from "@engine/physics/fracture/fractureRuntime";
import type { AssetFractureDef } from "@engine/physics/fracture/fractureTypes";
import { polyhedronFromMesh, polyhedronVolume } from "@engine/physics/fracture/voronoiFracture";
import { fractureChunkGeometry, fractureSourceFromObject } from "@engine/render-three/fractureGeometry";
import { applyEulerDegrees } from "@engine/render-three/transforms";
import type { TransformComponent } from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";

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

interface LiveChunkObject {
  readonly mesh: Mesh;
}

/** `instance:<assetId>:<placementIndex>` → asset id (the static placement entity form). */
function instanceAssetId(entityId: string): string | null {
  if (!entityId.startsWith("instance:")) return null;
  const separator = entityId.lastIndexOf(":");
  if (separator <= "instance:".length) return null;
  return decodeURIComponent(entityId.slice("instance:".length, separator));
}

function readTransform(entity: Entity | undefined): TransformComponent | null {
  const transform = entity?.components.Transform as TransformComponent | undefined;
  return transform ?? null;
}

export function createFractureModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  let context: RuntimeContext | null = null;
  let host: FractureHost | null = null;
  const registry = new FractureRegistry();
  const budget = new ChunkBudget();
  const baked = new Map<string, BakedAsset>();
  /** Fracturable entity → its asset id. */
  const sourceAsset = new Map<string, string>();
  const chunks = new Map<string, LiveChunkObject>();
  const unsubscribes: Array<() => void> = [];
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
    const assetId = sourceAsset.get(entityId);
    const asset = assetId ? baked.get(assetId) : undefined;
    const transform = readTransform(context?.entity(entityId));
    if (!host || !context || !asset || !transform) return;
    const started = performance.now();
    const placement: FracturePlacement = {
      position: transform.position,
      rotation: transform.rotation,
      scale: transform.scale,
    };
    const velocity = host.physics.velocityOf(entityId) ?? [0, 0, 0];
    const specs = planChunkSpawns(asset.bake, asset.def, placement, velocity, impact);
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

  const teardown = (): void => {
    removeChunks(budget.clear());
    for (const id of sourceAsset.keys()) host?.physics.setImpactEventThreshold(id, null);
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    for (const asset of baked.values()) for (const geometry of asset.geometries) geometry.dispose();
    baked.clear();
    sourceAsset.clear();
    registry.clear();
    chunks.clear();
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
    },

    async onLevelLoaded(levelContext) {
      teardown();
      if (levelContext.mode === "editor") return;
      const hostRef = levelContext.resolve(fractureHostService);
      if (!hostRef) return;
      context = levelContext;
      host = hostRef;
      const manifest = await levelContext.resolve(assetManifestService)?.();
      if (!manifest) return;
      const byAsset = new Map<string, string[]>();
      for (const entity of levelContext.entities) {
        const assetId = instanceAssetId(entity.id);
        if (!assetId) continue;
        const list = byAsset.get(assetId);
        if (list) list.push(entity.id);
        else byAsset.set(assetId, [entity.id]);
      }
      for (const [assetId, entityIds] of byAsset) {
        const record = assetRecordById(manifest, assetId);
        if (!record || !isModelAssetType(assetType(record))) continue;
        const asset = await bakeAsset(assetId, assetPath(record), hostRef);
        if (!asset || context !== levelContext) continue;
        baked.set(assetId, asset);
        for (const entityId of entityIds) {
          if (!registry.register(entityId, asset.def)) continue;
          sourceAsset.set(entityId, assetId);
          hostRef.physics.setImpactEventThreshold(entityId, registry.breakImpulse(entityId));
        }
      }
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
