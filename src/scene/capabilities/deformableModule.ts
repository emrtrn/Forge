/**
 * Permanent impact dents at runtime (DEFORMABLE_FRACTURABLE_WORK_PLAN Faz 7).
 *
 * Every static-mesh placement whose model has an enabled `<Model>.deformable.json`,
 * and every Actor Script actor with a `Deformable` component on such a mesh, opts
 * into impact events at its `dentImpulse`. A hit strong enough leaves a dent on
 * that one object: its render object gets its own geometry on the first dent
 * (`DentTarget`), the collider never changes, and a script can dent through the
 * `Deformable.Dent` message (kinematic bodies produce no impacts). A vehicle's
 * wheels stay rigid. A model with sidecar `parts` dents piece by piece: a hit
 * inside a part's zone stays on that part's meshes.
 *
 * A dent list outlives the render object. Each frame the module compares a dented
 * object with what the shell renders now, so a World Partition cell that returns
 * or a placement clone rebuilt for reflection probes simply gets its dents again.
 * The same path serves a save-game: restoring only puts a dent list in place.
 *
 * Off (module not registered, or no shell host), every object stays rigid.
 */
import type { Mesh } from "three";

import { assetPath, assetRecordById, assetType, isModelAssetType, type AssetManifest } from "@engine/assets/manifest";
import type { AssetDeformableDef } from "@engine/physics/deformable/deformableTypes";
import { dentDepthForImpulse, type Dent, type DentVec3 } from "@engine/physics/deformable/impactDeform";
import { DentTarget, type DentOutcome } from "@engine/render-three/deformableMeshSync";
import type { SavedDeformableState } from "@engine/persistence/saveGameState";
import { readDeformableComponent, readRenderableMeshComponent } from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import { instanceEntityId } from "@engine/scene/legacyRoomLayoutAdapter";

import { loadAssetDeformable } from "../assetDeformableLoader";
import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import {
  assetManifestService,
  deformableCommandsService,
  deformableHostService,
  fractureCommandsService,
  scriptMessageBusService,
  type DeformableHost,
  type ScriptMessageBus,
} from "./runtimeServiceKeys";

export const DEFORMABLE_MODULE_ID = "deformable";
/** Script message a script sends to dent a target: `{ point, direction, impulse }`, world space. */
export const DEFORMABLE_DENT_MESSAGE = "Deformable.Dent";
/** Broadcast after a hit leaves or deepens a dent. */
export const DEFORMABLE_DENTED_MESSAGE = "Deformable.Dented";
const FRACTURE_BROKEN_MESSAGE = "Fracture.Broken";

/**
 * Seconds a hit counts as one collision. The same crash reports over several
 * frames as a body wedges in; inside this window only a harder hit adds depth,
 * by the difference, so grinding against a wall does not dig a hole.
 */
const HIT_EPISODE_SECONDS = 0.25;
/** Fracture chunks are debris, not hits. */
const FRACTURE_CHUNK_PREFIX = "fracture:";
/** Hits waiting for their frame; a pile-up past this is dropped. */
const MAX_QUEUED_HITS = 16;

/** Names the vehicle module gives the wheels it rigs (see `vehicleModule`). */
const VEHICLE_WHEEL_NODE_PREFIX = "VehicleWheel";

/** An object that can dent. */
interface DeformableSource {
  readonly def: AssetDeformableDef;
  /** Actors leave with their entity; placements stay known from the layout. */
  readonly actor: boolean;
}

/** An object's dents; `target` is null while nothing renders it. */
interface DentEntry {
  dents: readonly Dent[];
  target: DentTarget | null;
}

interface QueuedHit {
  readonly entityId: string;
  readonly point: DentVec3;
  /** World unit vector, into the object. */
  readonly direction: DentVec3;
  readonly impulse: number;
  readonly instigator: string | null;
}

/** Whether a mesh, or a node above it, is one of a vehicle's wheels. */
function isWheelMesh(mesh: Mesh, wheelNodes: ReadonlySet<string>): boolean {
  for (let node: Mesh["parent"] | Mesh = mesh; node; node = node.parent) {
    if (wheelNodes.has(node.name) || node.name.startsWith(VEHICLE_WHEEL_NODE_PREFIX)) return true;
  }
  return false;
}

function readVector(value: unknown): DentVec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.every((item) => typeof item === "number" && Number.isFinite(item)) ? value as unknown as DentVec3 : null;
}

export function createDeformableModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  let host: DeformableHost | null = null;
  const sources = new Map<string, DeformableSource>();
  const entries = new Map<string, DentEntry>();
  /** Object → part → its running collision; "" = the body. */
  const episodes = new Map<string, Map<string, { startedAt: number; depth: number }>>();
  /** Sidecars already reported for parts that match no mesh. */
  const reportedParts = new WeakSet<AssetDeformableDef>();
  const queue: QueuedHit[] = [];
  const unsubscribes: Array<() => void> = [];
  /**
   * Save-game entries waiting for their object. Not part of the level teardown:
   * a load's restore may arrive before this module's own `onLevelLoaded`.
   */
  const pendingRestore = new Map<string, SavedDeformableState>();
  /** The level's placements and level-start actors are known; unmatched entries can be reported. */
  let levelRegistered = false;
  /** Sidecars of actor meshes, once per asset; a placement's comes from the shell. */
  const actorDefs = new Map<string, Promise<AssetDeformableDef | null>>();
  let manifest: AssetManifest | null = null;
  /** Bumped by every teardown so a sidecar arriving for an old level is dropped. */
  let generation = 0;
  let clock = 0;
  let missed = 0;
  let skipped = 0;
  let lastDentMs = 0;

  /** Follows what the shell renders now: a replaced object gets the dents again. */
  const syncTarget = (entityId: string, entry: DentEntry): void => {
    const source = sources.get(entityId);
    const object = host?.renderObject(entityId) ?? null;
    if (entry.target && entry.target.object !== object) {
      entry.dents = [...entry.target.dentList];
      entry.target.dispose();
      entry.target = null;
    }
    if (entry.target || !object || !source) return;
    const wheelNodes = new Set(host?.wheelNodes(entityId) ?? []);
    entry.target = new DentTarget(object, { exclude: (mesh) => isWheelMesh(mesh, wheelNodes), parts: source.def.parts });
    entry.target.restore(entry.dents, source.def);
  };

  const countOutcome = (outcome: DentOutcome): void => {
    if (outcome === "missed") missed += 1;
    else if (outcome === "skipped") skipped += 1;
  };

  /**
   * How much a hit adds, after the rest of its collision; 0 = nothing new. Each
   * part has its own collision: a scrape along a door and a mirror dents both.
   */
  const newDepth = (entityId: string, part: string | null, def: AssetDeformableDef, impulse: number): number => {
    const depth = dentDepthForImpulse(def, impulse);
    const parts = episodes.get(entityId) ?? new Map<string, { startedAt: number; depth: number }>();
    episodes.set(entityId, parts);
    const episode = parts.get(part ?? "");
    if (episode && clock - episode.startedAt < HIT_EPISODE_SECONDS) {
      const extra = depth - episode.depth;
      if (extra <= 0) return 0;
      episode.depth = depth;
      return extra;
    }
    parts.set(part ?? "", { startedAt: clock, depth });
    return depth;
  };

  const applyHit = (hit: QueuedHit): void => {
    const source = sources.get(hit.entityId);
    if (!source || !host) return;
    if (services?.resolve(fractureCommandsService)?.isFractured(hit.entityId)) return;
    const entry = entries.get(hit.entityId) ?? { dents: [], target: null };
    syncTarget(hit.entityId, entry);
    if (!entry.target) {
      // Nothing renders it right now, so there is no surface to land on.
      skipped += 1;
      return;
    }
    const part = entry.target.partAt(hit.point, hit.direction, source.def.radius);
    const depth = newDepth(hit.entityId, part, source.def, hit.impulse);
    if (depth <= 0) return;
    entries.set(hit.entityId, entry);
    const started = performance.now();
    const outcome = entry.target.hit(hit.point, hit.direction, depth, source.def);
    lastDentMs = performance.now() - started;
    countOutcome(outcome);
    const unmatched = entry.target.unmatchedParts();
    if (unmatched.length > 0 && !reportedParts.has(source.def)) {
      reportedParts.add(source.def);
      console.warn(`[deformable] parts with no matching mesh, hits fall back to the body: ${unmatched.join(", ")}`);
    }
    if (outcome !== "dented") return;
    const landed = entry.target.lastPart;
    services?.resolve(scriptMessageBusService)?.emit(DEFORMABLE_DENTED_MESSAGE, hit.entityId, {
      entityId: hit.entityId,
      ...(hit.instigator ? { instigator: hit.instigator } : {}),
      ...(landed ? { part: landed } : {}),
      impulse: hit.impulse,
      depth,
    });
  };

  const enqueue = (hit: QueuedHit): void => {
    if (queue.length < MAX_QUEUED_HITS) queue.push(hit);
    else skipped += 1;
  };

  const forget = (entityId: string): void => {
    entries.get(entityId)?.target?.dispose();
    entries.delete(entityId);
    episodes.delete(entityId);
    sources.delete(entityId);
    host?.physics.setImpactEventThreshold(entityId, null);
  };

  /** Moves a known object's waiting save entry into place; the next frame applies it. */
  const applyRestore = (entityId: string): void => {
    const saved = pendingRestore.get(entityId);
    if (!saved || !sources.has(entityId)) return;
    pendingRestore.delete(entityId);
    entries.set(entityId, { dents: saved.dents, target: null });
  };

  const reportUnmatched = (): void => {
    if (!levelRegistered || pendingRestore.size === 0) return;
    // Kept for an actor that spawns later, and in the next save.
    console.warn(`[deformable] save entries with no deformable object: ${[...pendingRestore.keys()].join(", ")}`);
  };

  const captureState = (): SavedDeformableState[] => {
    const saved = new Map(pendingRestore);
    for (const [entityId, entry] of entries) {
      const dents = entry.target?.dentList ?? entry.dents;
      if (dents.length > 0) saved.set(entityId, { entityId, dents: dents.map((dent) => ({ ...dent })) });
    }
    return [...saved.values()];
  };

  const restoreState = (restored: readonly SavedDeformableState[]): void => {
    // The save's dents replace the ones made since, even on an object it does not list.
    for (const entry of entries.values()) entry.target?.dispose();
    entries.clear();
    episodes.clear();
    queue.length = 0;
    pendingRestore.clear();
    for (const entry of restored) pendingRestore.set(entry.entityId, entry);
    for (const entityId of [...pendingRestore.keys()]) applyRestore(entityId);
    reportUnmatched();
  };

  const actorDef = (assetId: string): Promise<AssetDeformableDef | null> => {
    const known = actorDefs.get(assetId);
    if (known) return known;
    const record = manifest ? assetRecordById(manifest, assetId) : undefined;
    if (!record || !isModelAssetType(assetType(record))) return Promise.resolve(null);
    const pending = loadAssetDeformable(assetPath(record)).then((def) => (def?.enabled ? def : null));
    actorDefs.set(assetId, pending);
    return pending;
  };

  const trackActor = async (entity: Entity): Promise<void> => {
    const mesh = readRenderableMeshComponent(entity);
    if (!mesh || !readDeformableComponent(entity)?.enabled) return;
    const level = generation;
    const def = await actorDef(mesh.assetId);
    if (!def || !host || level !== generation) return;
    sources.set(entity.id, { def, actor: true });
    host.physics.setImpactEventThreshold(entity.id, def.dentImpulse);
    applyRestore(entity.id);
  };

  const subscribe = (bus: ScriptMessageBus): void => {
    unsubscribes.push(bus.subscribe(FRACTURE_BROKEN_MESSAGE, (envelope) => {
      const entityId = (envelope.payload as { entityId?: unknown } | undefined)?.entityId;
      if (typeof entityId === "string") forget(entityId);
    }));
    unsubscribes.push(bus.subscribe(DEFORMABLE_DENT_MESSAGE, (envelope) => {
      const payload = envelope.payload as { point?: unknown; direction?: unknown; impulse?: unknown } | undefined;
      const point = readVector(payload?.point);
      const direction = readVector(payload?.direction);
      const length = direction ? Math.hypot(direction[0], direction[1], direction[2]) : 0;
      const impulse = Number(payload?.impulse);
      if (!envelope.target || !point || !direction || length === 0 || !Number.isFinite(impulse)) return;
      enqueue({
        entityId: envelope.target,
        point,
        direction: [direction[0] / length, direction[1] / length, direction[2] / length],
        impulse,
        instigator: envelope.source ?? null,
      });
    }));
  };

  const teardown = (): void => {
    generation += 1;
    // An actor that streamed out has dents and no source.
    for (const id of new Set([...sources.keys(), ...entries.keys()])) forget(id);
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    entries.clear();
    episodes.clear();
    actorDefs.clear();
    queue.length = 0;
    manifest = null;
    clock = 0;
    levelRegistered = false;
  };

  return {
    id: DEFORMABLE_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      services = runtimeServices;
      runtimeServices.provide(deformableCommandsService, {
        snapshot: () => {
          let dented = 0;
          let dents = 0;
          for (const entry of entries.values()) {
            const count = (entry.target?.dentList ?? entry.dents).length;
            if (count > 0) dented += 1;
            dents += count;
          }
          return { deformable: sources.size, dented, dents, missed, skipped, lastDentMs };
        },
        captureState,
        restoreState,
      });
      // Level-start actors are read from the scene document in onLevelLoaded;
      // the sink follows actors that spawn or stream in and out afterwards.
      runtimeServices.addEntitySink({
        setEntities: () => {},
        addEntity: (entity) => {
          if (host) void trackActor(entity);
        },
        removeEntity: (entityId) => {
          if (!sources.get(entityId)?.actor) return;
          // Its dents stay: an actor of a streamed cell comes back with this id.
          sources.delete(entityId);
          host?.physics.setImpactEventThreshold(entityId, null);
        },
      });
    },

    async onLevelLoaded(levelContext) {
      teardown();
      if (levelContext.mode === "editor") return;
      const hostRef = levelContext.resolve(deformableHostService);
      if (!hostRef) return;
      host = hostRef;
      for (const group of levelContext.layout.instances) {
        const def = hostRef.deformableDef(group.assetId);
        if (!def) continue;
        group.placements.forEach((placement, index) => {
          if (placement.hidden) return;
          const entityId = instanceEntityId(group.assetId, index);
          sources.set(entityId, { def, actor: false });
          hostRef.physics.setImpactEventThreshold(entityId, def.dentImpulse);
          applyRestore(entityId);
        });
      }
      const bus = levelContext.resolve(scriptMessageBusService);
      if (bus) subscribe(bus);
      const level = generation;
      manifest = (await levelContext.resolve(assetManifestService)?.()) ?? null;
      if (!manifest || level !== generation) return;
      await Promise.all(levelContext.sceneDocument.entities.map((entity) => trackActor(entity)));
      if (level !== generation) return;
      levelRegistered = true;
      reportUnmatched();
    },

    onLevelUnloaded() {
      teardown();
      pendingRestore.clear();
      host = null;
    },

    update(deltaSeconds) {
      clock += deltaSeconds;
      if (!host) return;
      for (const impact of host.physics.impacts()) {
        // Out of `a`, towards `b`: the surface of `a` is pushed against the normal.
        for (const [entityId, other, sign] of [[impact.a, impact.b, -1], [impact.b, impact.a, 1]] as const) {
          const source = sources.get(entityId);
          if (!source || impact.impulse < source.def.dentImpulse || !impact.point) continue;
          if (other.startsWith(FRACTURE_CHUNK_PREFIX)) continue;
          enqueue({
            entityId,
            point: impact.point,
            direction: [impact.normal[0] * sign, impact.normal[1] * sign, impact.normal[2] * sign],
            impulse: impact.impulse,
            instigator: other,
          });
        }
      }
      for (const hit of queue.splice(0, host.dentsPerFrame())) applyHit(hit);
      for (const [entityId, entry] of entries) syncTarget(entityId, entry);
    },

    dispose() {
      teardown();
      host = null;
      services = null;
    },
  };
}
