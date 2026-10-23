import { actorInstanceToEntity, spawnedActorEntityId } from "@engine/scene/actorInstance";
import type { ActorScriptDef } from "@engine/scene/actorScript";
import type { ActorSpawnRequest } from "@engine/behavior/behaviorSubsystem";
import type { Entity } from "@engine/scene/entity";

/**
 * Everything the actor-spawn coordinator needs from the runtime shell that it
 * does not own itself. Kept deliberately small (mirroring
 * {@link ./runtimeSaveCoordinator.RuntimeSaveCoordinatorDeps} and
 * {@link ./runtimeTravelCoordinator.RuntimeTravelCoordinatorDeps}): the
 * coordinator owns only the runtime-spawn id counter and the spawn orchestration;
 * the live-actor registry (`actorEntityById` / `actorEntities`) stays in
 * {@link RuntimeSceneApp} because it is scene-build-owned state with many readers,
 * and is reached here through {@link registerActorEntity} / {@link hasActorEntity}.
 * Scene teardown/build wiring (mesh load, render object, physics/behavior
 * registration, autoplay audio/particle) also stays in the shell and is delivered
 * via these callbacks, so this module never has to know about the subsystems.
 */
export interface RuntimeActorSpawnCoordinatorDeps {
  /** True once a layout is loaded — spawns before that are dropped (as before). */
  hasLayout(): boolean;
  /** True when an entity id is already registered (id-collision guard). */
  hasActorEntity(entityId: string): boolean;
  /** Loads/normalizes the actor class for a spawn request (never throws). */
  loadActorClass(classRef: string): Promise<ActorScriptDef>;
  /** Adds the spawned entity to the shell's live-actor registry + list. */
  registerActorEntity(entity: Entity): void;
  /** Loads the mesh assets the spawned entity's MeshRenderer references. */
  loadActorMeshModels(entities: readonly Entity[]): Promise<void>;
  /** Builds + adds the spawned entity's rendered object to the scene graph. */
  addActorObject(entity: Entity): void;
  /** Registers the spawned entity with the physics subsystem. */
  addEntityToPhysics(entity: Entity): void;
  /** Registers the spawned entity with the behavior subsystem, attributing its owner. */
  addEntityToBehavior(entity: Entity, owner: string): void;
  /** Registers the spawned entity with incremental capability sinks. */
  addEntityToModules(entity: Entity): void;
  /** Fires any autoplay AudioComponent on the spawned entity. */
  playAutoPlayAudio(entity: Entity): void;
  /** Fires any autoplay ParticleEmitter on the spawned entity (fire-and-forget). */
  playAutoPlayParticle(entity: Entity): void;
}

export interface RuntimeActorSpawnCoordinatorOptions {
  /** Maximum queued spawn requests whose construction may begin in one frame. */
  maxSpawnsPerFrame?: number;
}

/** Conservative template default; spawn-heavy forks may provide their own budget. */
export const DEFAULT_RUNTIME_SPAWN_BUDGET_PER_FRAME = 4;

/**
 * Owns runtime actor spawning (A6) extracted from {@link RuntimeSceneApp} (P2.4):
 * the monotonic runtime-spawn id counter, spawned-entity id generation and the
 * `spawnRuntimeActor` orchestration (load class → build entity → register →
 * mesh/render/physics/behavior → autoplay). Behaviour is unchanged from the
 * in-shell version — a boundary extraction, not a redesign.
 *
 * Scope note (P2.4 staging): only the genuinely spawn-specific id-generation +
 * spawn flow moved. `destroyActorEntity`, `registerActorEntity` and the
 * `actorEntityById` / `actorEntities` collections stay in the shell: they are
 * scene-build-owned state (populated on every level build, read from many places),
 * so owning them here would invert the shell → coordinator dependency direction.
 * Destroy is collection cleanup, not spawn logic, and touches no state this module
 * owns, so it is left in the shell.
 */
export class RuntimeActorSpawnCoordinator {
  private nextRuntimeActorId = 0;
  private readonly queuedRequests: ActorSpawnRequest[] = [];
  private readonly maxSpawnsPerFrame: number;
  /** Invalidates any in-flight async spawn when level teardown begins. */
  private generation = 0;

  constructor(
    private readonly deps: RuntimeActorSpawnCoordinatorDeps,
    options: RuntimeActorSpawnCoordinatorOptions = {},
  ) {
    this.maxSpawnsPerFrame = positiveIntegerOrDefault(
      options.maxSpawnsPerFrame,
      DEFAULT_RUNTIME_SPAWN_BUDGET_PER_FRAME,
    );
  }

  /** Resets the spawn id counter on scene teardown (ids restart per level build). */
  reset(): void {
    this.nextRuntimeActorId = 0;
    this.queuedRequests.length = 0;
    this.generation += 1;
  }

  /** Queues a request for the next frame-budgeted spawn pass. */
  enqueueRuntimeActor(request: ActorSpawnRequest): void {
    if (!this.deps.hasLayout()) return;
    this.queuedRequests.push(cloneSpawnRequest(request));
  }

  /** Starts at most the configured number of queued spawn constructions this frame. */
  advance(): void {
    const generation = this.generation;
    for (let index = 0; index < this.maxSpawnsPerFrame; index += 1) {
      const request = this.queuedRequests.shift();
      if (!request) return;
      void this.spawnRuntimeActorForGeneration(request, generation);
    }
  }

  pendingCount(): number {
    return this.queuedRequests.length;
  }

  /**
   * Spawns a runtime actor (A6 `spawn` command): loads the class, builds the
   * entity at the requested transform with a fresh spawned id, registers it and
   * wires its mesh/render/physics/behavior + autoplay. The spawner owns the new
   * actor so it can attribute itself back to whoever spawned it (projectile →
   * shooter). Dropped silently before a layout is loaded.
   */
  async spawnRuntimeActor(request: ActorSpawnRequest): Promise<void> {
    await this.spawnRuntimeActorForGeneration(request, this.generation);
  }

  private async spawnRuntimeActorForGeneration(
    request: ActorSpawnRequest,
    generation: number,
  ): Promise<void> {
    if (!this.deps.hasLayout()) return;
    const def = await this.deps.loadActorClass(request.classRef);
    if (generation !== this.generation || !this.deps.hasLayout()) return;
    const entity = actorInstanceToEntity(
      def,
      {
        classRef: request.classRef,
        position: [...request.transform.position],
        rotation: [...request.transform.rotation],
        scale: [...request.transform.scale],
      },
      this.nextRuntimeActorId,
      {
        entityId: this.nextSpawnedActorEntityId(),
        ...(request.params !== undefined ? { params: request.params } : {}),
      },
    );
    this.deps.registerActorEntity(entity);
    await this.deps.loadActorMeshModels([entity]);
    if (generation !== this.generation || !this.deps.hasLayout()) return;
    this.deps.addActorObject(entity);
    this.deps.addEntityToPhysics(entity);
    this.deps.addEntityToBehavior(entity, request.sourceEntityId);
    this.deps.addEntityToModules(entity);
    this.deps.playAutoPlayAudio(entity);
    this.deps.playAutoPlayParticle(entity);
  }

  /** Next unused spawned-actor entity id, skipping any already-registered id. */
  private nextSpawnedActorEntityId(): string {
    let id = spawnedActorEntityId(this.nextRuntimeActorId);
    this.nextRuntimeActorId += 1;
    while (this.deps.hasActorEntity(id)) {
      id = spawnedActorEntityId(this.nextRuntimeActorId);
      this.nextRuntimeActorId += 1;
    }
    return id;
  }
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function cloneSpawnRequest(request: ActorSpawnRequest): ActorSpawnRequest {
  return {
    ...request,
    transform: {
      position: [...request.transform.position],
      rotation: [...request.transform.rotation],
      scale: [...request.transform.scale],
    },
    ...(request.params !== undefined ? { params: { ...request.params } } : {}),
  };
}
