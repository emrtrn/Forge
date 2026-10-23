/**
 * Generic behavior subsystem: ticks registered behavior scripts against a live
 * set of entities derived from the scene.
 *
 * This is where the `SceneDocument` begins to act as a runtime source of truth:
 * the host derives entities once, the subsystem holds a mutable transform per
 * behaviored entity, behaviors mutate those transforms each tick, and a host
 * sink syncs the result back to the rendered objects.
 *
 * Pure: no Three.js or DOM. Value imports use relative paths because the
 * engine-test bundler (tools/run-engine-tests.mjs) resolves no path aliases.
 */
import {
  readAudioComponent,
  readBehaviorComponent,
  readEventBindingsComponent,
  readInteractionComponent,
  readMessageBindingsComponent,
  readScriptActorComponent,
  readScriptDispatchersComponent,
  readScriptInterfacesComponent,
  readScriptReferencesComponent,
  readTransformComponent,
} from "../scene/components";
import type { AudioComponent, InteractionComponent, TransformComponent } from "../scene/components";
import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import type { Entity, EntityId, SceneJsonValue } from "../scene/entity";
import type { NavigationRole } from "../scene/collision";
import type { ActorEventKind } from "../scene/actorScript";
import type { ActionMap } from "../input/actionMap";
import type { AudioBus } from "../audio/audioSubsystem";
import {
  ScriptMessageBus,
  type ScriptMessageEnvelope,
  type ScriptMessageFlushResult,
  type ScriptMessagePayload,
  type ScriptMessageTraceEntry,
  type ScriptMessageWarning,
} from "./scriptMessages";
import {
  forwardVectorFromRotation,
  rightVectorFromRotation,
  rotateVectorByEulerDegrees,
  upVectorFromRotation,
} from "../scene/transform";
import type { Vec3 } from "../scene/layout";

/** Stable registry id for the behavior subsystem. */
export const BEHAVIOR_SUBSYSTEM_ID = "behavior";

export type EntityRef = EntityId;

export interface ScriptMessages {
  send(target: EntityRef, type: string, payload?: ScriptMessagePayload): void;
  emit(type: string, payload?: ScriptMessagePayload): void;
}

export type ReadonlyVec3 = readonly [number, number, number];

export interface ScriptTransformSnapshot {
  readonly position: ReadonlyVec3;
  readonly rotation: ReadonlyVec3;
  readonly scale: ReadonlyVec3;
}

/**
 * Host-provided read-only velocity source (A6, Unreal `GetVelocity`). Character
 * (kinematic) velocity lives in the game's CharacterMovement subsystem and
 * simulated bodies in the physics subsystem, so the runtime shell implements this
 * by combining those sources; the engine only consumes it through
 * {@link ScriptWorld.velocityOf}. Absent in pure tests, where a stub is passed.
 */
export interface EntityVelocityProvider {
  /** World-space linear velocity (units/s) of an entity, or null when unknown. */
  velocityOf(entityId: EntityId): ReadonlyVec3 | null;
}

export interface ScriptWorld {
  self(): EntityRef;
  ref(key: string): EntityRef | null;
  byName(name: string): EntityRef | null;
  byTag(tag: string): EntityRef[];
  byClassRef(classRef: string): EntityRef[];
  withInterface(name: string): EntityRef[];
  transformOf(ref: EntityRef): ScriptTransformSnapshot | null;
  distanceTo(ref: EntityRef): number | null;
  forwardOf(ref: EntityRef): ReadonlyVec3 | null;
  rightOf(ref: EntityRef): ReadonlyVec3 | null;
  upOf(ref: EntityRef): ReadonlyVec3 | null;
  /**
   * World-space linear velocity (units/s) of `ref`, or null when the host has no
   * velocity for it (no provider wired, or a static/behavior-parked actor).
   */
  velocityOf(ref: EntityRef): ReadonlyVec3 | null;
  /**
   * The actor that spawned `ref` (Unreal Owner/Instigator), or null when `ref`
   * was authored into the layout, has no owner, or its owner has left play.
   */
  ownerOf(ref: EntityRef): EntityRef | null;
  nearestWithInterface(
    name: string,
    from: EntityRef,
    maxDistance?: number,
  ): EntityRef | null;
}

export interface ScriptState {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  toggle(key: string, fallback?: boolean): boolean;
  persist(key: string, value: SceneJsonValue): void;
}

export type ActorEventPhase = "begin" | "end";

/**
 * Why an `endPlay` event fired: `destroyed` for an explicit `actor.destroy()` /
 * lifespan expiry, `teardown` for scene reload / disposal. Mirrors the useful
 * subset of Unreal's `EEndPlayReason`.
 */
export type ActorEndPlayReason = "destroyed" | "teardown";

export interface ActorEventEnvelope {
  readonly kind: ActorEventKind;
  readonly frame: number;
  readonly entityId: EntityId;
  readonly phase?: ActorEventPhase;
  readonly otherEntityId?: EntityId;
  readonly contact?: PhysicsContact;
  /** Present on `endPlay` events: why the actor left play. */
  readonly reason?: ActorEndPlayReason;
  readonly payload?: ScriptMessagePayload;
}

export type ScriptTimerHandle = string;

export interface ScriptTimers {
  after(seconds: number, message: string, payload?: ScriptMessagePayload): ScriptTimerHandle;
  clear(handle: ScriptTimerHandle): void;
}

export interface ActorSpawnRequest {
  readonly sourceEntityId: EntityId;
  readonly classRef: string;
  readonly transform: TransformComponent;
  readonly params?: Record<string, SceneJsonValue>;
}

/**
 * Options for {@link ActorCommands.launch} (Unreal `LaunchCharacter`): by default
 * the launch velocity is *added* to the character's current motion; the override
 * flags replace a component instead (horizontal for `xyOverride`, vertical for
 * `zOverride`).
 */
export interface LaunchOptions {
  readonly xyOverride?: boolean;
  readonly zOverride?: boolean;
}

/**
 * Options for {@link ActorCommands.attachTo} (Unreal `AttachToActor` location
 * rule): `keepWorld` (default) preserves the child's current world pose and
 * captures it as a relative offset; `snapToTarget` snaps the child onto the
 * parent's transform.
 */
export interface AttachOptions {
  readonly rule?: "keepWorld" | "snapToTarget";
}

/** Options shared by the actor commands: opt in to save-game persistence. */
export interface ActorCommandOptions {
  /**
   * When true, the effect is written to this entity's persistent script state
   * ({@link getPersistentStateSnapshot}) so a save-game restores it on a fresh
   * scene. Never touches the layout file — runtime state only.
   */
  readonly persist?: boolean;
}

/**
 * The generic per-actor command surface (Unreal `SetActorHiddenInGame` /
 * `DestroyActor`). A behavior calls these on {@link BehaviorContext.actor} to
 * act on *its own* entity; the subsystem queues them and applies them once the
 * current tick's behaviors + message flush have run (deterministic end-of-tick
 * mutation), delivering visibility/teardown to the host via an
 * {@link ActorCommandSink}. Targeting other actors is intentionally not exposed
 * here — cross-actor effects go through script messages.
 */
export interface ActorCommands {
  /** Shows/hides this entity's rendered object (host-applied). */
  setVisibility(visible: boolean, options?: ActorCommandOptions): void;
  /**
   * Toggles this entity's collision (Unreal `SetActorEnableCollision`). Disabled,
   * it stops generating overlap/hit contacts and stops blocking character
   * movement (e.g. an opened door/platform becomes walk-through), while its
   * rendered object and transform are untouched. Applied at end of tick like the
   * other commands.
   */
  setCollisionEnabled(enabled: boolean, options?: ActorCommandOptions): void;
  /**
   * Destroys this entity: after this tick it leaves the behavior instance set,
   * the world indexes and its message subscriptions, and the host removes its
   * render object + physics body. Subsequent ticks/messages/contacts skip it.
   */
  destroy(options?: ActorCommandOptions): void;
  /**
   * Destroys this entity after `seconds` of behavior simulation time. Passing 0
   * or a negative/non-finite value clears the active lifespan, matching Unreal's
   * SetLifeSpan(0) cancel semantics.
   */
  setLifeSpan(seconds: number): void;
  /**
   * Enables/disables this entity's `tick` bindings (Unreal `SetActorTickEnabled`).
   * Disabled, its per-frame behaviors stop running while its other event bindings
   * (beginPlay/overlap/hit/interact) keep firing. Takes effect from the next tick.
   */
  setTickEnabled(enabled: boolean): void;
  /**
   * Throttles this entity's `tick` bindings to run at most every `seconds`
   * (Unreal `Actor Tick Interval`). The throttled tick receives the accumulated
   * elapsed time as `engine.deltaSeconds` so time-integrated logic stays correct.
   * Passing 0 or a negative/non-finite value restores every-frame ticking.
   */
  setTickInterval(seconds: number): void;
  /**
   * Applies an instantaneous linear impulse to this entity's *simulated* (dynamic)
   * physics body (Unreal `AddImpulse`). No-op on a body that isn't simulating
   * physics (static/kinematic); use {@link launch} for characters.
   */
  addImpulse(impulse: ReadonlyVec3): void;
  /**
   * Launches this entity if it is a character (Unreal `LaunchCharacter`): injects
   * a launch velocity into its CharacterMovement so it goes airborne and arcs /
   * is knocked back. Additive by default; {@link LaunchOptions} overrides a
   * component. No-op on a non-character entity.
   */
  launch(velocity: ReadonlyVec3, options?: LaunchOptions): void;
  /**
   * Attaches this entity to `parent` (Unreal `AttachToActor`): from the next frame
   * its world transform follows the parent's (translating + orbiting/co-rotating
   * as the parent moves), until {@link detach}. Kinematic follow — the parent must
   * be an actor whose transform the behavior subsystem drives (a behavior-moved /
   * spawned actor); a purely physics/character-driven parent is out of scope.
   */
  attachTo(parent: EntityRef, options?: AttachOptions): void;
  /** Detaches this entity from its parent (Unreal `DetachFromActor`); keeps its pose. */
  detach(): void;
  /**
   * Queues a runtime actor spawn from an Actor Script class. The host resolves
   * the class/ref and instantiates render + physics incrementally; exposed params
   * are merged into the spawned class's behavior binding params.
   */
  spawn(
    classRef: string,
    transform: TransformComponent,
    params?: Record<string, SceneJsonValue>,
  ): void;
}

/**
 * Host sink for {@link ActorCommands}, wired by the runtime shell (the
 * `AudioBus` precedent: engine defines the surface, the host implements it).
 * `setVisibility` toggles the entity's rendered object; `destroy` tears down its
 * render object and physics body. The subsystem does its own internal cleanup
 * (indexes/instances/subscriptions) before calling `destroy`, so the sink only
 * owns render + physics.
 */
export interface ActorCommandSink {
  setVisibility(entityId: EntityId, visible: boolean): void;
  destroy(entityId: EntityId): void;
  /** Enables/disables the entity's physics collision (A6 SetActorEnableCollision). */
  setCollisionEnabled?(entityId: EntityId, enabled: boolean): void;
  /** Applies an impulse to the entity's simulated body (A6 AddImpulse). */
  addImpulse?(entityId: EntityId, impulse: ReadonlyVec3): void;
  /** Launches the entity if it is a character (A6 LaunchCharacter). */
  launch?(entityId: EntityId, velocity: ReadonlyVec3, options: LaunchOptions): void;
  spawn?(request: ActorSpawnRequest): void;
}

/** A queued actor command, applied at the end of the tick it was issued in. */
type ActorCommand =
  | { readonly entityId: EntityId; readonly kind: "visibility"; readonly visible: boolean }
  | { readonly entityId: EntityId; readonly kind: "collision"; readonly enabled: boolean }
  | { readonly entityId: EntityId; readonly kind: "destroy" }
  | { readonly entityId: EntityId; readonly kind: "impulse"; readonly impulse: ReadonlyVec3 }
  | {
      readonly entityId: EntityId;
      readonly kind: "launch";
      readonly velocity: ReadonlyVec3;
      readonly options: LaunchOptions;
    }
  | {
      readonly entityId: EntityId;
      readonly kind: "attach";
      readonly parent: EntityId;
      readonly options: AttachOptions;
    }
  | { readonly entityId: EntityId; readonly kind: "detach" }
  | { readonly entityId: EntityId; readonly kind: "spawn"; readonly request: ActorSpawnRequest };

interface ScriptTimerRecord {
  readonly handle: ScriptTimerHandle;
  readonly entityId: EntityId;
  readonly message: string;
  readonly payload: ScriptMessagePayload | undefined;
  readonly createdFrame: number;
  remainingSeconds: number;
}

/**
 * Per-actor tick gating: `enabled` toggles the entity's `tick` bindings,
 * `interval` (>0) throttles them to run at most every N seconds, and
 * `accumulator` carries elapsed time between throttled ticks.
 */
interface TickControl {
  enabled: boolean;
  interval: number;
  accumulator: number;
}

/**
 * A runtime attachment (A6 AttachToActor): the child's world pose is recomputed
 * each frame from the parent's pose plus the relative offset + rotation captured
 * at attach time, so the child translates with and orbits/co-rotates the parent.
 */
interface AttachmentRecord {
  parent: EntityId;
  worldOffset: Vec3;
  parentRotAtAttach: Vec3;
  childRotAtAttach: Vec3;
}

/**
 * Reserved persistent-state keys the actor commands use when `persist` is set.
 * Namespaced so they never collide with an authored `state`/`persist` key.
 */
const RESERVED_HIDDEN_KEY = "__actorHidden";
const RESERVED_DESTROYED_KEY = "__actorDestroyed";
const RESERVED_COLLISION_DISABLED_KEY = "__actorCollisionDisabled";

export interface PersistentScriptStateEntry {
  readonly entityId: EntityId;
  readonly key: string;
  readonly value: SceneJsonValue;
}

/** Per-tick context handed to a behavior update function. */
export interface BehaviorContext {
  readonly entityId: EntityId;
  readonly engine: EngineUpdateContext;
  readonly actions: ActionMap;
  readonly messages: ScriptMessages;
  readonly world: ScriptWorld;
  readonly state: ScriptState;
  readonly timers: ScriptTimers;
  /** Generic per-actor commands (visibility/destroy) targeting this entity. */
  readonly actor: ActorCommands;
  /**
   * The actor that spawned this entity (Unreal Owner/Instigator), or null when it
   * was authored into the layout or its owner has left play. Convenience for
   * `world.ownerOf(world.self())`.
   */
  readonly owner: EntityRef | null;
  readonly physics?: PhysicsQuery;
  readonly audio?: AudioBus;
  readonly audioComponent?: AudioComponent;
  /** This entity's authored interaction marker, when it carries one. */
  readonly interactionComponent?: InteractionComponent;
  readonly params: Record<string, SceneJsonValue>;
  /** Present when this behavior was invoked by an actor event binding. */
  readonly event?: ActorEventEnvelope;
  /** Present when this behavior was invoked by a script message binding. */
  readonly message?: ScriptMessageEnvelope;
  /** This entity's transform; behaviors mutate it in place. */
  readonly transform: TransformComponent;
}

export type BehaviorUpdate = (context: BehaviorContext) => void;

export interface PhysicsContact {
  readonly a: EntityId;
  readonly b: EntityId;
  readonly isSensor: boolean;
}

/** A world-space axis-aligned bounding box. */
export interface PhysicsAabb {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** AI navigation interpretation; absent behaves like `auto`. */
  readonly navigationRole?: NavigationRole;
  /**
   * Oriented convex XZ ground silhouette of a rotated box collider (the exact
   * footprint the `min`/`max` AABB otherwise bloats to enclose). Present only
   * when the collider is rotated off-axis; consumers that only need the AABB
   * (perception, ground probe) ignore it, while grid navigation erodes/collides
   * against it so a diagonal wall no longer blocks a fat axis-aligned area.
   */
  readonly footprint?: readonly (readonly [number, number])[];
}

/**
 * A world-space walkable surface triangle (from a static trimesh collider), with
 * its upward normal component precomputed. Fed to the ground probe so a ramp is
 * walked at its true incline height instead of a flat AABB top.
 */
export interface PhysicsSurfaceTriangle {
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly c: readonly [number, number, number];
  /** Signed normal.y after normalization: +1 = up-facing floor, 0 = vertical, -1 = down-facing. */
  readonly normalY: number;
}

export interface PhysicsQuery {
  contactsForEntity(entityId: EntityId): readonly PhysicsContact[];
  /** World-space AABBs of every static, non-sensor collider (movement blockers). */
  staticBlockerAabbs(): readonly PhysicsAabb[];
  /** Inclusive X/Z square candidates; hosts without the index use the full list. */
  staticBlockerAabbsNear?(x: number, z: number, radius: number): readonly PhysicsAabb[];
  /** Whether any static ground/blocker exists globally, without building flat arrays. */
  hasStaticGround?(): boolean;
  /** World-space walkable surface triangles (static trimesh) for the ground probe. */
  staticSurfaceTriangles(): readonly PhysicsSurfaceTriangle[];
  /**
   * Candidate static surface triangles near a world X/Z point. Implementations may
   * use a spatial index; callers must fall back to `staticSurfaceTriangles()` when
   * this optional fast path is unavailable.
   */
  staticSurfaceTrianglesNear?(x: number, z: number): readonly PhysicsSurfaceTriangle[];
  /** AI-nav blockers, after navigation-role filtering. */
  staticNavigationBlockerAabbs?(): readonly PhysicsAabb[];
  /** AI-nav surfaces, after navigation-role filtering. */
  staticNavigationSurfaceTriangles?(): readonly PhysicsSurfaceTriangle[];
  /** Half-extents (size*scale/2) of an entity's collider, or null if it has none. */
  colliderHalfExtents(entityId: EntityId): readonly [number, number, number] | null;
}

/** Resolves a script id to its update function. Runtime/game-owned. */
export interface BehaviorRegistry {
  get(scriptId: string): BehaviorUpdate | undefined;
}

/** Invoked after each behaviored entity ticks, to sync its transform to render. */
export type TransformSink = (entityId: EntityId, transform: TransformComponent) => void;

export interface BehaviorSubsystemOptions {
  readonly messageBus?: ScriptMessageBus;
  readonly messageTraceLimit?: number;
  readonly onMessageWarnings?: (warnings: readonly ScriptMessageWarning[]) => void;
  /** Host sink for actor visibility/destroy commands (A1); omitted in pure tests. */
  readonly actorCommandSink?: ActorCommandSink;
  /** Host velocity source for `world.velocityOf` (A6); omitted in pure tests. */
  readonly velocityProvider?: EntityVelocityProvider;
}

export interface ScriptMessageSubscriberDebugInfo {
  readonly entityId: EntityId;
  readonly message: string;
  readonly scriptId: string;
  readonly target: "self" | "any";
}

export interface ScriptActorDebugInfo {
  readonly entityId: EntityId;
  readonly name?: string;
  readonly classRef?: string;
  readonly nodeId?: string;
  readonly interfaces: readonly string[];
  readonly dispatchers: readonly { readonly name: string; readonly payload: Record<string, string> }[];
  readonly subscribers: readonly ScriptMessageSubscriberDebugInfo[];
}

export interface ScriptMessageDebugSnapshot {
  readonly lastFlush: ScriptMessageFlushResult;
  readonly recentMessages: readonly ScriptMessageTraceEntry[];
  readonly subscribers: readonly ScriptMessageSubscriberDebugInfo[];
}

interface RuntimeEntityState {
  id: EntityId;
  entity: Entity;
  transform: TransformComponent;
  audioComponent: AudioComponent | undefined;
  interactionComponent: InteractionComponent | undefined;
}

interface BehaviorInstance {
  runtime: RuntimeEntityState;
  update: BehaviorUpdate;
  params: Record<string, SceneJsonValue>;
  event: ActorEventKind;
  firedBeginPlay: boolean;
  firedEndPlay: boolean;
}

export class BehaviorSubsystem implements Subsystem {
  readonly id = BEHAVIOR_SUBSYSTEM_ID;
  private instances: BehaviorInstance[] = [];
  private runtimeEntities = new Map<EntityId, RuntimeEntityState>();
  private nameIndex = new Map<string, EntityId>();
  private tagIndex = new Map<string, Set<EntityId>>();
  private classRefIndex = new Map<string, Set<EntityId>>();
  private nodeIdIndex = new Map<string, EntityId>();
  private interfaceIndex = new Map<string, Set<EntityId>>();
  private messageSubscriptions: Array<{ entityId: EntityId; unsubscribe: () => void }> = [];
  private messageSubscriberInfo: ScriptMessageSubscriberDebugInfo[] = [];
  private runtimeState = new Map<EntityId, Map<string, unknown>>();
  private persistentStateKeys = new Map<EntityId, Set<string>>();
  /** Actor commands queued this tick, applied after the message flush. */
  private commandQueue: ActorCommand[] = [];
  private timers = new Map<ScriptTimerHandle, ScriptTimerRecord>();
  private lifeSpans = new Map<EntityId, { remainingSeconds: number; createdFrame: number }>();
  /** Per-actor tick gating (A6 SetActorTickEnabled / tick interval); default is every-frame. */
  private tickControl = new Map<EntityId, TickControl>();
  /** Spawned entity -> the actor that spawned it (A6 Owner/Instigator). */
  private owners = new Map<EntityId, EntityId>();
  /** Child entity -> its runtime attachment to a parent (A6 AttachToActor). */
  private attachments = new Map<EntityId, AttachmentRecord>();
  private nextTimerId = 1;
  private previousContactKeys = new Set<string>();
  private readonly messageBus: ScriptMessageBus;
  private lastMessageFlushResult: ScriptMessageFlushResult = {
    processed: 0,
    delivered: 0,
    warnings: [],
  };
  private enabled = true;

  constructor(
    private registry: BehaviorRegistry,
    private readonly actions: ActionMap,
    private readonly sink: TransformSink,
    private readonly physics?: PhysicsQuery,
    private readonly audio?: AudioBus,
    options: BehaviorSubsystemOptions = {},
  ) {
    this.messageBus =
      options.messageBus ??
      new ScriptMessageBus({
        targetExists: (target) => this.runtimeEntities.has(target),
        ...(options.messageTraceLimit !== undefined
          ? { recentTraceLimit: options.messageTraceLimit }
          : {}),
      });
    this.onMessageWarnings = options.onMessageWarnings;
    this.actorCommandSink = options.actorCommandSink;
    this.velocityProvider = options.velocityProvider;
  }

  /**
   * Replaces the game-owned script registry for a fresh scene visit. Existing
   * behavior instances keep resolved function refs, so the live world is cleared
   * before the new registry can resolve the next scene's entities.
   */
  setRegistry(registry: BehaviorRegistry): void {
    this.clear();
    this.registry = registry;
  }

  private readonly onMessageWarnings:
    | ((warnings: readonly ScriptMessageWarning[]) => void)
    | undefined;

  private readonly actorCommandSink: ActorCommandSink | undefined;

  private readonly velocityProvider: EntityVelocityProvider | undefined;

  /**
   * Derives the live behavior set from a scene's entities. An entity becomes a
   * runtime instance when it has a Behavior whose scriptId resolves in the
   * registry and a Transform to mutate. Each instance gets its own mutable
   * transform copy (the runtime source of truth behaviors edit).
   */
  setEntities(entities: readonly Entity[]): void {
    // Outgoing actors leave play (scene reload / level travel): fire endPlay
    // before the world is wiped, while their state is still intact. The initial
    // load has no prior instances, so this is a no-op there.
    this.dispatchEndPlayForAll("teardown");
    this.resetMessageSubscriptions();
    this.messageBus.clear();
    const instances: BehaviorInstance[] = [];
    this.runtimeEntities.clear();
    this.nameIndex.clear();
    this.tagIndex.clear();
    this.classRefIndex.clear();
    this.nodeIdIndex.clear();
    this.interfaceIndex.clear();
    this.runtimeState.clear();
    this.persistentStateKeys.clear();
    this.commandQueue = [];
    this.timers.clear();
    this.lifeSpans.clear();
    this.tickControl.clear();
    this.owners.clear();
    this.attachments.clear();
    this.previousContactKeys.clear();

    for (const entity of entities) this.registerRuntimeEntity(entity);

    for (const entity of entities) {
      const runtime = this.runtimeEntities.get(entity.id);
      if (!runtime) continue;
      this.appendBehaviorInstances(entity, runtime, instances);
    }
    this.instances = instances;

    for (const entity of entities) this.subscribeEntityMessages(entity);
  }

  /**
   * Incrementally adds one entity to the live behavior world (runtime SpawnActor).
   * Unlike `setEntities`, this preserves timers, runtime state and message bus
   * subscriptions for existing actors. Returns false when the entity has no
   * transform or its id already exists.
   */
  addEntity(entity: Entity, options: { owner?: EntityId } = {}): boolean {
    if (this.runtimeEntities.has(entity.id)) return false;
    const runtime = this.registerRuntimeEntity(entity);
    if (!runtime) return false;
    if (options.owner !== undefined) this.owners.set(entity.id, options.owner);
    this.appendBehaviorInstances(entity, runtime, this.instances);
    this.subscribeEntityMessages(entity);
    return true;
  }

  /** Drops all behavior instances (e.g. on scene teardown/reload). */
  clear(): void {
    // Live actors leave play on disposal — fire endPlay before the wipe.
    this.dispatchEndPlayForAll("teardown");
    this.instances = [];
    this.messageBus.clear();
    this.runtimeEntities.clear();
    this.nameIndex.clear();
    this.tagIndex.clear();
    this.classRefIndex.clear();
    this.nodeIdIndex.clear();
    this.interfaceIndex.clear();
    this.runtimeState.clear();
    this.persistentStateKeys.clear();
    this.commandQueue = [];
    this.timers.clear();
    this.lifeSpans.clear();
    this.tickControl.clear();
    this.owners.clear();
    this.attachments.clear();
    this.previousContactKeys.clear();
    this.resetMessageSubscriptions();
  }

  resetEntityTransform(entityId: EntityId, transform: TransformComponent): void {
    const runtime = this.runtimeEntities.get(entityId);
    if (!runtime) return;
    runtime.transform = cloneTransform(transform);
  }

  /**
   * Enables or disables behavior simulation. When disabled, update() is a no-op
   * so edit-mode hosts can keep authored scenes static until Play mode runs.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getLastMessageFlushResult(): ScriptMessageFlushResult {
    return this.lastMessageFlushResult;
  }

  getScriptMessageDebugSnapshot(): ScriptMessageDebugSnapshot {
    return {
      lastFlush: this.lastMessageFlushResult,
      recentMessages: this.messageBus.getRecentTrace(),
      subscribers: this.messageSubscriberInfo,
    };
  }

  getScriptActorDebugInfo(entityId: EntityId): ScriptActorDebugInfo | null {
    const runtime = this.runtimeEntities.get(entityId);
    if (!runtime) return null;
    const actor = readScriptActorComponent(runtime.entity);
    const info: ScriptActorDebugInfo = {
      entityId,
      ...(runtime.entity.name ? { name: runtime.entity.name } : {}),
      ...(actor?.classRef ? { classRef: actor.classRef } : {}),
      ...(actor?.nodeId ? { nodeId: actor.nodeId } : {}),
      interfaces: readScriptInterfacesComponent(runtime.entity)?.interfaces ?? [],
      dispatchers: readScriptDispatchersComponent(runtime.entity)?.dispatchers ?? [],
      subscribers: this.messageSubscriberInfo.filter((subscriber) => subscriber.entityId === entityId),
    };
    return info;
  }

  getPersistentStateSnapshot(): PersistentScriptStateEntry[] {
    const entries: PersistentScriptStateEntry[] = [];
    for (const [entityId, keys] of this.persistentStateKeys) {
      const store = this.runtimeState.get(entityId);
      if (!store) continue;
      for (const key of keys) {
        if (!store.has(key)) continue;
        entries.push({
          entityId,
          key,
          value: cloneSceneJsonValue(store.get(key) as SceneJsonValue),
        });
      }
    }
    return entries.sort(
      (a, b) => a.entityId.localeCompare(b.entityId) || a.key.localeCompare(b.key),
    );
  }

  applyPersistentStateSnapshot(entries: readonly PersistentScriptStateEntry[]): void {
    for (const entry of entries) {
      if (!this.runtimeEntities.has(entry.entityId)) continue;
      let store = this.runtimeState.get(entry.entityId);
      if (!store) {
        store = new Map();
        this.runtimeState.set(entry.entityId, store);
      }
      store.set(entry.key, cloneSceneJsonValue(entry.value));
      this.markPersistentState(entry.entityId, entry.key);
    }
    this.applyPersistedActorEffects();
  }

  private currentEngine: EngineUpdateContext | null = null;
  private lastEngineFrame = 0;

  /**
   * Enqueues a script message from a non-behavior runtime source (e.g. a Game
   * Mode emitting an animation notify). Delivered on the next message flush.
   */
  emitScriptMessage(
    type: string,
    source: EntityId,
    payload?: ScriptMessagePayload,
    target?: EntityId,
  ): void {
    this.messageBus.send({
      frame: this.lastEngineFrame,
      type,
      source,
      ...(target !== undefined ? { target } : {}),
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  /**
   * Subscribes a non-behavior runtime source (e.g. a Game Mode reacting to a
   * `death`/`ragdoll` event) to a script message type, optionally scoped to one
   * target entity. Returns an unsubscribe handle the caller must release on
   * teardown. Unlike actor-script message bindings this is not tracked in the
   * debug subscriber index; the caller owns the lifetime. Note that `clear()`
   * (scene teardown/reload) drops all subscriptions, so re-subscribe after a
   * rebuild if needed.
   */
  subscribeScriptMessage(
    type: string,
    handler: (envelope: ScriptMessageEnvelope) => void,
    options: { readonly target?: EntityId } = {},
  ): () => void {
    return this.messageBus.subscribe(
      type,
      handler,
      options.target !== undefined ? { target: options.target } : {},
    );
  }

  /** Emits an actor event from a host/runtime source (e.g. interaction input). */
  emitActorEvent(
    entityId: EntityId,
    kind: ActorEventKind,
    payload?: ScriptMessagePayload,
  ): void {
    const engine = this.currentEngine ?? {
      deltaSeconds: 0,
      elapsedSeconds: 0,
      frame: this.lastEngineFrame,
    };
    this.dispatchEntityEvent(entityId, engine, {
      kind,
      frame: engine.frame,
      entityId,
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  update(engine: EngineUpdateContext): void {
    if (!this.enabled) return;
    this.currentEngine = engine;
    this.lastEngineFrame = engine.frame;
    this.dispatchBeginPlayEvents(engine);
    const tickDecisions = this.computeTickDecisions(engine);
    for (const instance of this.instances) {
      if (instance.event !== "tick") continue;
      const decision = tickDecisions.get(instance.runtime.id);
      if (decision && !decision.fire) continue;
      const tickEngine =
        decision && decision.deltaSeconds !== engine.deltaSeconds
          ? { ...engine, deltaSeconds: decision.deltaSeconds }
          : engine;
      this.invokeBehavior(instance, tickEngine, {
        kind: "tick",
        frame: engine.frame,
        entityId: instance.runtime.id,
      });
    }
    this.dispatchContactEvents(engine);
    this.advanceTimers(engine);
    this.advanceLifeSpans(engine);
    this.lastMessageFlushResult = this.messageBus.flush();
    if (this.lastMessageFlushResult.warnings.length > 0) {
      this.onMessageWarnings?.(this.lastMessageFlushResult.warnings);
    }
    // Actor commands (visibility/destroy) apply once the tick's behaviors and
    // message handlers have all run, so a mutation is deterministic end-of-tick.
    this.flushActorCommands();
    // Attached children follow their parent's final pose for this frame (after any
    // command, including a freshly issued attach, has been applied).
    this.applyAttachments();
    this.currentEngine = null;
  }

  dispose(): void {
    this.clear();
  }

  private dispatchBeginPlayEvents(engine: EngineUpdateContext): void {
    for (const instance of this.instances) {
      if (instance.event !== "beginPlay" || instance.firedBeginPlay) continue;
      instance.firedBeginPlay = true;
      this.invokeBehavior(instance, engine, {
        kind: "beginPlay",
        frame: engine.frame,
        entityId: instance.runtime.id,
      });
    }
  }

  /**
   * Fires the `endPlay` one-shot for a single entity's endPlay bindings (Unreal
   * `Event EndPlay`), each at most once. Called just before a destroyed entity is
   * detached, so its state/transform/world are still intact. `teardown` fans this
   * out over the whole live set. Uses the live engine context when firing mid-tick
   * (destroy), else a synthesized one (scene teardown runs outside `update()`).
   */
  private dispatchEndPlayEvents(entityId: EntityId, reason: ActorEndPlayReason): void {
    if (!this.runtimeEntities.has(entityId)) return;
    const engine = this.currentEngine ?? {
      deltaSeconds: 0,
      elapsedSeconds: 0,
      frame: this.lastEngineFrame,
    };
    for (const instance of this.instances) {
      if (instance.runtime.id !== entityId || instance.event !== "endPlay" || instance.firedEndPlay) {
        continue;
      }
      instance.firedEndPlay = true;
      this.invokeBehavior(instance, engine, {
        kind: "endPlay",
        frame: engine.frame,
        entityId,
        reason,
        payload: { reason },
      });
    }
  }

  /**
   * Fires `endPlay` for every live entity that still carries an unfired endPlay
   * binding — the scene-teardown / disposal path (`setEntities` rebuild, `clear`).
   * Snapshots the target ids first so a behavior cannot perturb the iteration.
   */
  private dispatchEndPlayForAll(reason: ActorEndPlayReason): void {
    const targets = new Set<EntityId>();
    for (const instance of this.instances) {
      if (instance.event === "endPlay" && !instance.firedEndPlay) targets.add(instance.runtime.id);
    }
    for (const entityId of targets) this.dispatchEndPlayEvents(entityId, reason);
  }

  private dispatchContactEvents(engine: EngineUpdateContext): void {
    if (!this.physics) return;
    const current = new Map<string, PhysicsContact>();
    for (const runtime of this.runtimeEntities.values()) {
      for (const contact of this.physics.contactsForEntity(runtime.id)) {
        current.set(contactKey(contact), contact);
      }
    }

    for (const [key, contact] of current) {
      if (this.previousContactKeys.has(key)) continue;
      this.dispatchContactEvent(engine, contact, "begin");
    }
    for (const key of this.previousContactKeys) {
      if (current.has(key)) continue;
      const contact = contactFromKey(key);
      if (!contact) continue;
      this.dispatchContactEvent(engine, contact, "end");
    }
    this.previousContactKeys = new Set(current.keys());
  }

  private dispatchContactEvent(
    engine: EngineUpdateContext,
    contact: PhysicsContact,
    phase: ActorEventPhase,
  ): void {
    const kind: ActorEventKind = contact.isSensor ? "overlap" : "hit";
    this.dispatchEntityEvent(contact.a, engine, {
      kind,
      frame: engine.frame,
      entityId: contact.a,
      phase,
      otherEntityId: contact.b,
      contact,
    });
    this.dispatchEntityEvent(contact.b, engine, {
      kind,
      frame: engine.frame,
      entityId: contact.b,
      phase,
      otherEntityId: contact.a,
      contact,
    });
  }

  private dispatchEntityEvent(
    entityId: EntityId,
    engine: EngineUpdateContext,
    event: ActorEventEnvelope,
  ): void {
    for (const instance of this.instances) {
      if (instance.runtime.id !== entityId || instance.event !== event.kind) continue;
      this.invokeBehavior(instance, engine, event);
    }
  }

  private invokeBehavior(
    instance: BehaviorInstance,
    engine: EngineUpdateContext,
    event?: ActorEventEnvelope,
  ): void {
    if (!this.runtimeEntities.has(instance.runtime.id)) return;
    const context = this.createContext(
      instance.runtime,
      engine,
      instance.params,
      undefined,
      event,
    );
    instance.update(context);
    this.sink(instance.runtime.id, instance.runtime.transform);
  }

  private createContext(
    runtime: RuntimeEntityState,
    engine: EngineUpdateContext,
    params: Record<string, SceneJsonValue>,
    message?: ScriptMessageEnvelope,
    event?: ActorEventEnvelope,
  ): BehaviorContext {
    const context: BehaviorContext = {
      entityId: runtime.id,
      engine,
      actions: this.actions,
      messages: this.scriptMessages(runtime.id, engine),
      world: this.scriptWorld(runtime.id),
      state: this.scriptState(runtime.id),
      timers: this.scriptTimers(runtime.id, engine),
      actor: this.actorCommands(runtime.id),
      owner: this.ownerOf(runtime.id),
      params,
      transform: runtime.transform,
    };
    if (this.physics) {
      (context as BehaviorContext & { physics: PhysicsQuery }).physics = this.physics;
    }
    if (this.audio) {
      (context as BehaviorContext & { audio: AudioBus }).audio = this.audio;
    }
    if (runtime.audioComponent) {
      (context as BehaviorContext & { audioComponent: AudioComponent }).audioComponent =
        runtime.audioComponent;
    }
    if (runtime.interactionComponent) {
      (context as BehaviorContext & { interactionComponent: InteractionComponent }).interactionComponent =
        runtime.interactionComponent;
    }
    if (message) {
      (context as BehaviorContext & { message: ScriptMessageEnvelope }).message = message;
    }
    if (event) {
      (context as BehaviorContext & { event: ActorEventEnvelope }).event = event;
    }
    return context;
  }

  private scriptTimers(entityId: EntityId, engine: EngineUpdateContext): ScriptTimers {
    return {
      after: (seconds, message, payload) => {
        const handle = `script-timer:${this.nextTimerId}`;
        this.nextTimerId += 1;
        this.timers.set(handle, {
          handle,
          entityId,
          message,
          payload: payload ? { ...payload } : undefined,
          createdFrame: engine.frame,
          remainingSeconds: Math.max(0, Number.isFinite(seconds) ? seconds : 0),
        });
        return handle;
      },
      clear: (handle) => {
        this.timers.delete(handle);
      },
    };
  }

  private scriptMessages(source: EntityId, engine: EngineUpdateContext): ScriptMessages {
    return {
      send: (target, type, payload) => {
        const input = { frame: engine.frame, type, source, target };
        this.messageBus.send(payload === undefined ? input : { ...input, payload });
      },
      emit: (type, payload) => {
        const input = { frame: engine.frame, type, source };
        this.messageBus.emit(payload === undefined ? input : { ...input, payload });
      },
    };
  }

  private scriptWorld(self: EntityId): ScriptWorld {
    return {
      self: () => self,
      ref: (key) => this.resolveReference(self, key),
      byName: (name) => this.nameIndex.get(name) ?? null,
      byTag: (tag) => [...(this.tagIndex.get(tag) ?? [])],
      byClassRef: (classRef) => [...(this.classRefIndex.get(classRef) ?? [])],
      withInterface: (name) => [...(this.interfaceIndex.get(name) ?? [])],
      transformOf: (ref) => this.transformOf(ref),
      distanceTo: (ref) => this.distanceBetween(self, ref),
      forwardOf: (ref) => this.directionOf(ref, forwardVectorFromRotation),
      rightOf: (ref) => this.directionOf(ref, rightVectorFromRotation),
      upOf: (ref) => this.directionOf(ref, upVectorFromRotation),
      velocityOf: (ref) =>
        this.runtimeEntities.has(ref) ? (this.velocityProvider?.velocityOf(ref) ?? null) : null,
      ownerOf: (ref) => this.ownerOf(ref),
      nearestWithInterface: (name, from, maxDistance) =>
        this.nearestWithInterface(name, from, maxDistance),
    };
  }

  private scriptState(entityId: EntityId): ScriptState {
    const getStore = (): Map<string, unknown> => {
      let store = this.runtimeState.get(entityId);
      if (!store) {
        store = new Map();
        this.runtimeState.set(entityId, store);
      }
      return store;
    };
    return {
      get: (key, fallback) => (getStore().has(key) ? (getStore().get(key) as typeof fallback) : fallback),
      set: (key, value) => {
        getStore().set(key, value);
      },
      toggle: (key, fallback = false) => {
        const store = getStore();
        const next = !(store.has(key) ? Boolean(store.get(key)) : fallback);
        store.set(key, next);
        return next;
      },
      persist: (key, value) => {
        getStore().set(key, cloneSceneJsonValue(value));
        this.markPersistentState(entityId, key);
      },
    };
  }

  private actorCommands(entityId: EntityId): ActorCommands {
    return {
      setVisibility: (visible, options) => {
        this.commandQueue.push({ entityId, kind: "visibility", visible });
        if (options?.persist) this.scriptState(entityId).persist(RESERVED_HIDDEN_KEY, !visible);
      },
      setCollisionEnabled: (enabled, options) => {
        this.commandQueue.push({ entityId, kind: "collision", enabled });
        if (options?.persist) {
          this.scriptState(entityId).persist(RESERVED_COLLISION_DISABLED_KEY, !enabled);
        }
      },
      destroy: (options) => {
        this.commandQueue.push({ entityId, kind: "destroy" });
        if (options?.persist) this.scriptState(entityId).persist(RESERVED_DESTROYED_KEY, true);
      },
      setLifeSpan: (seconds) => {
        if (!Number.isFinite(seconds) || seconds <= 0) {
          this.lifeSpans.delete(entityId);
          return;
        }
        this.lifeSpans.set(entityId, {
          remainingSeconds: seconds,
          createdFrame: this.currentEngine?.frame ?? this.lastEngineFrame,
        });
      },
      setTickEnabled: (enabled) => {
        this.ensureTickControl(entityId).enabled = enabled;
      },
      setTickInterval: (seconds) => {
        const control = this.ensureTickControl(entityId);
        control.interval = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
        control.accumulator = 0;
      },
      addImpulse: (impulse) => {
        this.commandQueue.push({
          entityId,
          kind: "impulse",
          impulse: [impulse[0], impulse[1], impulse[2]],
        });
      },
      launch: (velocity, options) => {
        this.commandQueue.push({
          entityId,
          kind: "launch",
          velocity: [velocity[0], velocity[1], velocity[2]],
          options: options ?? {},
        });
      },
      attachTo: (parent, options) => {
        if (parent === entityId) return;
        this.commandQueue.push({ entityId, kind: "attach", parent, options: options ?? {} });
      },
      detach: () => {
        this.commandQueue.push({ entityId, kind: "detach" });
      },
      spawn: (classRef, transform, params) => {
        if (!classRef.trim()) return;
        const request: ActorSpawnRequest = {
          sourceEntityId: entityId,
          classRef,
          transform: cloneTransform(transform),
          ...(params !== undefined ? { params: cloneSceneJsonObject(params) } : {}),
        };
        this.commandQueue.push({ entityId, kind: "spawn", request });
      },
    };
  }

  private ensureTickControl(entityId: EntityId): TickControl {
    let control = this.tickControl.get(entityId);
    if (!control) {
      control = { enabled: true, interval: 0, accumulator: 0 };
      this.tickControl.set(entityId, control);
    }
    return control;
  }

  /**
   * Resolves this frame's tick gating for every entity with custom tick control
   * (A6): whether its `tick` bindings fire and, for a throttled interval, the
   * accumulated `deltaSeconds` the fired tick should see. Entities without an entry
   * are absent from the map and default to firing every frame with the raw dt.
   */
  private computeTickDecisions(
    engine: EngineUpdateContext,
  ): Map<EntityId, { fire: boolean; deltaSeconds: number }> {
    const decisions = new Map<EntityId, { fire: boolean; deltaSeconds: number }>();
    if (this.tickControl.size === 0) return decisions;
    const dt = Math.max(0, engine.deltaSeconds);
    for (const [entityId, control] of [...this.tickControl.entries()]) {
      if (!this.runtimeEntities.has(entityId)) {
        this.tickControl.delete(entityId);
        continue;
      }
      if (!control.enabled) {
        decisions.set(entityId, { fire: false, deltaSeconds: dt });
        continue;
      }
      if (control.interval <= 0) {
        decisions.set(entityId, { fire: true, deltaSeconds: dt });
        continue;
      }
      control.accumulator += dt;
      if (control.accumulator + 1e-9 < control.interval) {
        decisions.set(entityId, { fire: false, deltaSeconds: dt });
        continue;
      }
      const elapsed = control.accumulator;
      control.accumulator = 0;
      decisions.set(entityId, { fire: true, deltaSeconds: elapsed });
    }
    return decisions;
  }

  private advanceTimers(engine: EngineUpdateContext): void {
    if (this.timers.size === 0) return;
    const deltaSeconds = Math.max(0, engine.deltaSeconds);
    const due: ScriptTimerRecord[] = [];
    for (const timer of this.timers.values()) {
      if (!this.runtimeEntities.has(timer.entityId)) {
        this.timers.delete(timer.handle);
        continue;
      }
      if (timer.createdFrame === engine.frame) continue;
      timer.remainingSeconds -= deltaSeconds;
      if (timer.remainingSeconds > 0) continue;
      due.push(timer);
      this.timers.delete(timer.handle);
    }
    for (const timer of due) {
      if (!this.runtimeEntities.has(timer.entityId)) continue;
      const input = {
        frame: engine.frame,
        type: timer.message,
        source: timer.entityId,
        target: timer.entityId,
      };
      this.messageBus.send(
        timer.payload === undefined ? input : { ...input, payload: timer.payload },
      );
    }
  }

  private advanceLifeSpans(engine: EngineUpdateContext): void {
    if (this.lifeSpans.size === 0) return;
    const deltaSeconds = Math.max(0, engine.deltaSeconds);
    for (const [entityId, lifeSpan] of [...this.lifeSpans.entries()]) {
      if (!this.runtimeEntities.has(entityId)) {
        this.lifeSpans.delete(entityId);
        continue;
      }
      if (lifeSpan.createdFrame === engine.frame) continue;
      lifeSpan.remainingSeconds -= deltaSeconds;
      if (lifeSpan.remainingSeconds > 0) continue;
      this.lifeSpans.delete(entityId);
      this.commandQueue.push({ entityId, kind: "destroy" });
    }
  }

  /** Applies every queued actor command in issue order, then empties the queue. */
  private flushActorCommands(): void {
    if (this.commandQueue.length === 0) return;
    const commands = this.commandQueue;
    this.commandQueue = [];
    for (const command of commands) this.processActorCommand(command);
  }

  private processActorCommand(command: ActorCommand): void {
    if (command.kind === "visibility") {
      this.actorCommandSink?.setVisibility(command.entityId, command.visible);
      return;
    }
    if (command.kind === "collision") {
      this.actorCommandSink?.setCollisionEnabled?.(command.entityId, command.enabled);
      return;
    }
    if (command.kind === "impulse") {
      if (this.runtimeEntities.has(command.entityId)) {
        this.actorCommandSink?.addImpulse?.(command.entityId, command.impulse);
      }
      return;
    }
    if (command.kind === "launch") {
      if (this.runtimeEntities.has(command.entityId)) {
        this.actorCommandSink?.launch?.(command.entityId, command.velocity, command.options);
      }
      return;
    }
    if (command.kind === "attach") {
      this.processAttach(command.entityId, command.parent, command.options);
      return;
    }
    if (command.kind === "detach") {
      this.attachments.delete(command.entityId);
      return;
    }
    if (command.kind === "spawn") {
      if (this.runtimeEntities.has(command.entityId)) this.actorCommandSink?.spawn?.(command.request);
      return;
    }
    // Destroy: fire endPlay (reason `destroyed`) while the entity is still live,
    // then drop it from the subsystem's own bookkeeping (so it stops ticking /
    // being indexed / receiving messages this frame), then let the host tear down
    // its render object + physics body. Idempotent: a second destroy for the same
    // entity still notifies the host but skips re-firing endPlay + re-detaching.
    if (this.runtimeEntities.has(command.entityId)) {
      this.dispatchEndPlayEvents(command.entityId, "destroyed");
      this.detachEntity(command.entityId);
    }
    this.actorCommandSink?.destroy(command.entityId);
  }

  /**
   * Records a runtime attachment (A6 AttachToActor). `keepWorld` (default) captures
   * the child's current world offset + rotation from the parent so its pose is
   * preserved; `snapToTarget` zeroes the offset so the child snaps onto the parent.
   * A missing child/parent (or self-parenting) is a no-op.
   */
  private processAttach(child: EntityId, parent: EntityId, options: AttachOptions): void {
    if (child === parent) return;
    const childRuntime = this.runtimeEntities.get(child);
    const parentRuntime = this.runtimeEntities.get(parent);
    if (!childRuntime || !parentRuntime) return;
    const c = childRuntime.transform;
    const p = parentRuntime.transform;
    const snap = options.rule === "snapToTarget";
    this.attachments.set(child, {
      parent,
      worldOffset: snap
        ? [0, 0, 0]
        : [c.position[0] - p.position[0], c.position[1] - p.position[1], c.position[2] - p.position[2]],
      parentRotAtAttach: [p.rotation[0], p.rotation[1], p.rotation[2]],
      childRotAtAttach: snap
        ? [p.rotation[0], p.rotation[1], p.rotation[2]]
        : [c.rotation[0], c.rotation[1], c.rotation[2]],
    });
    this.applyAttachment(child);
  }

  /**
   * Positions every attached child from its parent's current pose. Runs at the end
   * of each tick (after behaviors + commands), so the child follows this frame's
   * parent motion. A child whose parent has left play is silently detached.
   */
  private applyAttachments(): void {
    if (this.attachments.size === 0) return;
    for (const child of [...this.attachments.keys()]) this.applyAttachment(child);
  }

  private applyAttachment(child: EntityId): void {
    const record = this.attachments.get(child);
    if (!record) return;
    const childRuntime = this.runtimeEntities.get(child);
    const parentRuntime = this.runtimeEntities.get(record.parent);
    if (!childRuntime || !parentRuntime) {
      this.attachments.delete(child);
      return;
    }
    const p = parentRuntime.transform;
    const deltaRot: Vec3 = [
      p.rotation[0] - record.parentRotAtAttach[0],
      p.rotation[1] - record.parentRotAtAttach[1],
      p.rotation[2] - record.parentRotAtAttach[2],
    ];
    const rotatedOffset = rotateVectorByEulerDegrees(record.worldOffset, deltaRot);
    const t = childRuntime.transform;
    t.position[0] = p.position[0] + rotatedOffset[0];
    t.position[1] = p.position[1] + rotatedOffset[1];
    t.position[2] = p.position[2] + rotatedOffset[2];
    t.rotation[0] = record.childRotAtAttach[0] + deltaRot[0];
    t.rotation[1] = record.childRotAtAttach[1] + deltaRot[1];
    t.rotation[2] = record.childRotAtAttach[2] + deltaRot[2];
    this.sink(child, t);
  }

  /**
   * Removes a destroyed entity from the live behavior set: its instance, world
   * indexes and message subscriptions. Its `runtimeState` is deliberately kept so
   * a persisted destroy/hide marker survives for a re-save ({@link getPersistentStateSnapshot});
   * `setEntities`/`clear` wipe it on the next rebuild.
   */
  private detachEntity(entityId: EntityId): void {
    const runtime = this.runtimeEntities.get(entityId);
    if (!runtime) return;
    this.instances = this.instances.filter((instance) => instance.runtime.id !== entityId);
    this.runtimeEntities.delete(entityId);
    if (runtime.entity.name && this.nameIndex.get(runtime.entity.name) === entityId) {
      this.nameIndex.delete(runtime.entity.name);
    }
    for (const [nodeId, id] of this.nodeIdIndex) {
      if (id === entityId) this.nodeIdIndex.delete(nodeId);
    }
    for (const set of this.tagIndex.values()) set.delete(entityId);
    for (const set of this.classRefIndex.values()) set.delete(entityId);
    for (const set of this.interfaceIndex.values()) set.delete(entityId);
    for (const [handle, timer] of [...this.timers.entries()]) {
      if (timer.entityId === entityId) this.timers.delete(handle);
    }
    this.lifeSpans.delete(entityId);
    this.tickControl.delete(entityId);
    // Drop this entity both as an owned child and as an owner of others (a
    // destroyed spawner leaves its children unowned; ownerOf then returns null).
    this.owners.delete(entityId);
    for (const [child, owner] of [...this.owners.entries()]) {
      if (owner === entityId) this.owners.delete(child);
    }
    // Drop attachments where this entity is the child, and detach any children
    // parented to it (a destroyed parent leaves its children where they are).
    this.attachments.delete(entityId);
    for (const [child, record] of [...this.attachments.entries()]) {
      if (record.parent === entityId) this.attachments.delete(child);
    }
    this.previousContactKeys = new Set(
      [...this.previousContactKeys].filter((key) => !contactKeyIncludesEntity(key, entityId)),
    );
    const kept: Array<{ entityId: EntityId; unsubscribe: () => void }> = [];
    for (const subscription of this.messageSubscriptions) {
      if (subscription.entityId === entityId) subscription.unsubscribe();
      else kept.push(subscription);
    }
    this.messageSubscriptions = kept;
    this.messageSubscriberInfo = this.messageSubscriberInfo.filter(
      (subscriber) => subscriber.entityId !== entityId,
    );
  }

  /**
   * Re-applies persisted hide/destroy markers after a save-game restore (A1.3):
   * a fresh scene rebuilt the entities, the snapshot repopulated their reserved
   * keys, so an entity flagged destroyed/hidden in the save is brought back to
   * that state via the host sink. Applied immediately (restore runs after the
   * scene is fully built), not queued, so the effect lands before the first tick.
   */
  private applyPersistedActorEffects(): void {
    const effects: ActorCommand[] = [];
    for (const [entityId, store] of this.runtimeState) {
      // A destroyed entity is gone; its render/physics teardown supersedes the
      // hide/collision markers, so skip them. Hide and collision-disable are
      // independent and can both apply to the same (surviving) entity.
      if (store.get(RESERVED_DESTROYED_KEY) === true) {
        effects.push({ entityId, kind: "destroy" });
        continue;
      }
      if (store.get(RESERVED_HIDDEN_KEY) === true) {
        effects.push({ entityId, kind: "visibility", visible: false });
      }
      if (store.get(RESERVED_COLLISION_DISABLED_KEY) === true) {
        effects.push({ entityId, kind: "collision", enabled: false });
      }
    }
    for (const effect of effects) this.processActorCommand(effect);
  }

  private markPersistentState(entityId: EntityId, key: string): void {
    let keys = this.persistentStateKeys.get(entityId);
    if (!keys) {
      keys = new Set();
      this.persistentStateKeys.set(entityId, keys);
    }
    keys.add(key);
  }

  private nearestWithInterface(
    name: string,
    from: EntityId,
    maxDistance: number | undefined,
  ): EntityId | null {
    const source = this.runtimeEntities.get(from);
    if (!source) return null;
    let best: EntityId | null = null;
    let bestDistanceSq = Infinity;
    const maxDistanceSq = maxDistance === undefined ? Infinity : maxDistance * maxDistance;
    for (const targetId of this.interfaceIndex.get(name) ?? []) {
      if (targetId === from) continue;
      const target = this.runtimeEntities.get(targetId);
      if (!target) continue;
      const dx = target.transform.position[0] - source.transform.position[0];
      const dy = target.transform.position[1] - source.transform.position[1];
      const dz = target.transform.position[2] - source.transform.position[2];
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > maxDistanceSq || distanceSq >= bestDistanceSq) continue;
      best = targetId;
      bestDistanceSq = distanceSq;
    }
    return best;
  }

  private transformOf(entityId: EntityId): ScriptTransformSnapshot | null {
    const runtime = this.runtimeEntities.get(entityId);
    if (!runtime) return null;
    return cloneTransform(runtime.transform);
  }

  /** The live spawner of `entityId`, or null when unowned / the owner left play. */
  private ownerOf(entityId: EntityId): EntityId | null {
    const owner = this.owners.get(entityId);
    if (owner === undefined || !this.runtimeEntities.has(owner)) return null;
    return owner;
  }

  private distanceBetween(from: EntityId, to: EntityId): number | null {
    const source = this.runtimeEntities.get(from);
    const target = this.runtimeEntities.get(to);
    if (!source || !target) return null;
    return distanceBetweenTransforms(source.transform, target.transform);
  }

  private directionOf(
    entityId: EntityId,
    resolve: (rotation: [number, number, number]) => [number, number, number],
  ): ReadonlyVec3 | null {
    const runtime = this.runtimeEntities.get(entityId);
    if (!runtime) return null;
    return resolve(runtime.transform.rotation);
  }

  private resolveReference(sourceEntityId: EntityId, key: string): EntityId | null {
    const source = this.runtimeEntities.get(sourceEntityId);
    if (!source) return null;
    const references = readScriptReferencesComponent(source.entity);
    const reference = references?.references.find((entry) => entry.key === key);
    if (!reference) return null;
    const selector = reference.selector;
    if (selector.byNodeId) return this.nodeIdIndex.get(selector.byNodeId) ?? null;
    if (selector.byName) return this.nameIndex.get(selector.byName) ?? null;
    if (selector.byTag) return this.firstSorted(this.tagIndex.get(selector.byTag));
    if (selector.byClassRef) return this.firstSorted(this.classRefIndex.get(selector.byClassRef));
    if (selector.byInterface) return this.firstSorted(this.interfaceIndex.get(selector.byInterface));
    return null;
  }

  private firstSorted(values: Set<EntityId> | undefined): EntityId | null {
    if (!values || values.size === 0) return null;
    return [...values].sort((a, b) => a.localeCompare(b))[0] ?? null;
  }

  private addToIndex(index: Map<string, Set<EntityId>>, key: string, entityId: EntityId): void {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(entityId);
  }

  private registerRuntimeEntity(entity: Entity): RuntimeEntityState | null {
    const transform = readTransformComponent(entity);
    if (!transform) return null;
    const runtime: RuntimeEntityState = {
      id: entity.id,
      entity,
      transform: cloneTransform(transform),
      audioComponent: readAudioComponent(entity),
      interactionComponent: readInteractionComponent(entity),
    };
    this.runtimeEntities.set(entity.id, runtime);
    if (entity.name) this.nameIndex.set(entity.name, entity.id);
    for (const tag of entity.tags ?? []) this.addToIndex(this.tagIndex, tag, entity.id);
    const scriptActor = readScriptActorComponent(entity);
    if (scriptActor) {
      this.addToIndex(this.classRefIndex, scriptActor.classRef, entity.id);
      if (scriptActor.nodeId) this.nodeIdIndex.set(scriptActor.nodeId, entity.id);
    }
    const interfaces = readScriptInterfacesComponent(entity);
    for (const name of interfaces?.interfaces ?? []) {
      this.addToIndex(this.interfaceIndex, name, entity.id);
    }
    return runtime;
  }

  private appendBehaviorInstances(
    entity: Entity,
    runtime: RuntimeEntityState,
    out: BehaviorInstance[],
  ): void {
    const eventBindings = readEventBindingsComponent(entity);
    for (const binding of eventBindings?.bindings ?? []) {
      const update = this.registry.get(binding.scriptId);
      if (!update) continue;
      out.push({
        runtime,
        update,
        params: binding.params ?? {},
        event: binding.event,
        firedBeginPlay: false,
        firedEndPlay: false,
      });
    }
    const behavior = readBehaviorComponent(entity);
    if (!behavior) return;
    const update = this.registry.get(behavior.scriptId);
    if (!update) return;
    out.push({
      runtime,
      update,
      params: behavior.params ?? {},
      event: "tick",
      firedBeginPlay: true,
      firedEndPlay: false,
    });
  }

  private subscribeEntityMessages(entity: Entity): void {
    const runtime = this.runtimeEntities.get(entity.id);
    if (!runtime) return;
    const messageBindings = readMessageBindingsComponent(entity);
    for (const binding of messageBindings?.bindings ?? []) {
      const update = this.registry.get(binding.scriptId);
      if (!update) continue;
      const unsubscribe = this.messageBus.subscribe(
        binding.message,
        (envelope) => {
          const engine = this.currentEngine;
          if (!engine) return;
          const context = this.createContext(
            runtime,
            engine,
            binding.params ?? {},
            envelope,
          );
          update(context);
          this.sink(runtime.id, runtime.transform);
        },
        binding.target === "self" ? { target: runtime.id } : {},
      );
      this.messageSubscriptions.push({ entityId: runtime.id, unsubscribe });
      this.messageSubscriberInfo.push({
        entityId: runtime.id,
        message: binding.message,
        scriptId: binding.scriptId,
        target: binding.target,
      });
    }
  }

  private resetMessageSubscriptions(): void {
    for (const subscription of this.messageSubscriptions) subscription.unsubscribe();
    this.messageSubscriptions = [];
    this.messageSubscriberInfo = [];
  }
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function distanceBetweenTransforms(a: TransformComponent, b: TransformComponent): number {
  const dx = b.position[0] - a.position[0];
  const dy = b.position[1] - a.position[1];
  const dz = b.position[2] - a.position[2];
  return Math.hypot(dx, dy, dz);
}

function contactKey(contact: PhysicsContact): string {
  const [left, right] = contact.a < contact.b ? [contact.a, contact.b] : [contact.b, contact.a];
  return `${contact.isSensor ? "overlap" : "hit"}\n${left}\n${right}`;
}

function contactFromKey(key: string): PhysicsContact | null {
  const [kind, a, b] = key.split("\n");
  if (!a || !b) return null;
  return { a, b, isSensor: kind === "overlap" };
}

function contactKeyIncludesEntity(key: string, entityId: EntityId): boolean {
  const [, a, b] = key.split("\n");
  return a === entityId || b === entityId;
}

function cloneSceneJsonValue(value: SceneJsonValue): SceneJsonValue {
  if (Array.isArray(value)) return value.map(cloneSceneJsonValue);
  if (typeof value === "object" && value !== null) {
    const clone: Record<string, SceneJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneSceneJsonValue(entry);
    return clone;
  }
  return value;
}

function cloneSceneJsonObject(
  value: Record<string, SceneJsonValue>,
): Record<string, SceneJsonValue> {
  const clone: Record<string, SceneJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) clone[key] = cloneSceneJsonValue(entry);
  return clone;
}
