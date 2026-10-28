/**
 * AISubsystem: owns the lifecycle of every {@link AIController} in the live
 * scene. It derives a controller for each entity carrying an AIController
 * component (mirroring how {@link BehaviorSubsystem} derives behavior instances),
 * ticks them each frame, and exposes a debug snapshot.
 *
 * Faz 1 scope: derivation + lifecycle + debug + a Play-mode `setEnabled` gate.
 * The controllers hold memory only; the per-frame Behavior Tree decision tick is
 * added in Faz 2. This subsystem is registered *now* — on both the runtime host
 * and the editor host (disabled in edit mode, enabled in editor Play) — so the
 * tick order and wiring are fixed before decision logic exists.
 *
 * Pure engine module: no Three.js / DOM / editor imports. Value imports are
 * relative so the engine-test bundler (no path aliases) can run it.
 */
import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import type { Entity, EntityId } from "../scene/entity";
import {
  readAIControllerComponent,
  readCharacterMovementComponent,
  readTransformComponent,
  type TransformComponent,
} from "../scene/components";
import { resolveCharacterCapsule } from "../scene/capsule";
import { forwardVectorFromRotation } from "../scene/transform";
import {
  comparePerceivedStimuli,
  evaluatePerception,
  type GameplayPerceptionSense,
  type NoiseStimulus,
  type PerceptionAabb,
  type PerceivedStimulus,
  type StimulusSource,
} from "../perception/perception";
import { Blackboard } from "./blackboard";
import { AIController, type AIControllerDebugSnapshot, type AIControllerOptions } from "./aiController";
import type { AiBlackboardAsset, AiBehaviorTreeAsset } from "./behaviorAsset";
import type { AiStateTreeAsset } from "./stateTreeAsset";
import { AiStateTreeRunner } from "./stateTreeRunner";
import type { AiQueryAsset } from "./queryAsset";
import { runAiQuery } from "./queryRunner";
import { SmartObjectReservationStore } from "./smartObjects";
import { createTargetPointIndex, type TargetPointEntry, type TargetPointIndex } from "./targetPoints";
import type { SplineRegistry } from "../scene/splineRegistry";
import {
  consumeDistanceUpdateDelta,
  isFarFromFocus,
  type DistanceUpdateRateSettings,
} from "../perf/distanceUpdateRate";
import {
  AiBehaviorRunner,
  createDefaultAiServiceRegistry,
  createDefaultAiTaskRegistry,
  type AiBehaviorRunnerOptions,
  type AiTaskRegistry,
  type AiServiceRegistry,
  type AiMessageEmitInput,
  type AiMoveRequest,
} from "./behaviorRunner";

/** Stable registry id for the AI subsystem. */
export const AI_SUBSYSTEM_ID = "ai";

/** Debug view of the whole AI subsystem for the `?debug` overlay. */
export interface AiDebugSnapshot {
  /** False while the host has the subsystem gated off (editor edit mode). */
  readonly enabled: boolean;
  readonly controllerCount: number;
  readonly controllers: readonly AiControllerSubsystemDebugSnapshot[];
}

/** Runtime-only patrol diagnostics appended by the AI subsystem. */
export interface AiControllerSubsystemDebugSnapshot extends AIControllerDebugSnapshot {
  /** The selected spline is unavailable to the runtime spline registry. */
  readonly patrolSplineMissing?: boolean;
}

export interface AiAssetLibrary {
  readonly blackboards?: ReadonlyMap<string, AiBlackboardAsset>;
  readonly behaviors?: ReadonlyMap<string, AiBehaviorTreeAsset>;
  readonly stateTrees?: ReadonlyMap<string, AiStateTreeAsset>;
  readonly queries?: ReadonlyMap<string, AiQueryAsset>;
}

/**
 * One live decision runner per controller. A controller runs *either* a Behavior
 * Tree or a StateTree (StateTree wins when both are authored); both share the
 * same task/service registry and options, and both expose `tick(engine)`.
 */
type AiRunnerEntry =
  | { readonly kind: "behavior"; readonly runner: AiBehaviorRunner }
  | { readonly kind: "stateTree"; readonly runner: AiStateTreeRunner };

export interface AISubsystemOptions {
  readonly taskRegistry?: AiTaskRegistry;
  readonly serviceRegistry?: AiServiceRegistry;
  readonly emitMessage?: (input: AiMessageEmitInput) => void;
  readonly moveTo?: (request: AiMoveRequest) => "success" | "failure" | "running";
  readonly blockers?: () => readonly PerceptionAabb[];
  /**
   * Blockers intersecting the inclusive X/Z square around a point. When given,
   * perception and queries ask for the square their traces fit in and never
   * call {@link blockers}, so their cost does not grow with the world.
   */
  readonly blockersNear?: (x: number, z: number, radius: number) => readonly PerceptionAabb[];
  readonly perceptionSourceFilter?: (entity: Entity) => boolean;
  /** Runtime Generic Spline facade consumed by spline patrol tasks. */
  readonly splineRegistry?: SplineRegistry;
  /** Runtime-owned focus point (normally the possessed pawn); absent = no throttling. */
  readonly qualityFocusPosition?: () => readonly [number, number, number] | null;
}

/** Optional Phase 7 quality extension. Empty settings retain every-frame AI. */
export interface AiDistanceUpdateSettings extends DistanceUpdateRateSettings {}

export interface AiScriptStimulusInput {
  readonly type: string;
  readonly source: EntityId;
  readonly target?: EntityId;
  readonly payload?: Record<string, unknown>;
}

export class AISubsystem implements Subsystem {
  readonly id = AI_SUBSYSTEM_ID;

  /** One controller per possessed NPC pawn, keyed by the pawn's entity id. */
  private controllers = new Map<EntityId, AIController>();
  private runners = new Map<EntityId, AiRunnerEntry>();
  private blackboardAssets: ReadonlyMap<string, AiBlackboardAsset> = new Map();
  private behaviorAssets: ReadonlyMap<string, AiBehaviorTreeAsset> = new Map();
  private stateTreeAssets: ReadonlyMap<string, AiStateTreeAsset> = new Map();
  private queryAssets: ReadonlyMap<string, AiQueryAsset> = new Map();
  private enabled = true;
  private taskRegistry: AiTaskRegistry;
  private serviceRegistry: AiServiceRegistry | undefined;
  private emitMessage: ((input: AiMessageEmitInput) => void) | undefined;
  private moveTo: ((request: AiMoveRequest) => "success" | "failure" | "running") | undefined;
  private blockers: (() => readonly PerceptionAabb[]) | undefined;
  private blockersNear: ((x: number, z: number, radius: number) => readonly PerceptionAabb[]) | undefined;
  private perceptionSourceFilter: ((entity: Entity) => boolean) | undefined;
  private splineRegistry: SplineRegistry | undefined;
  private qualityFocusPosition: (() => readonly [number, number, number] | null) | undefined;
  private distanceUpdateSettings: AiDistanceUpdateSettings = {};
  private runnerAccumulatedSeconds = new Map<EntityId, number>();
  private entities: readonly Entity[] = [];
  private pendingNoises: NoiseStimulus[] = [];
  private pendingScriptStimuli: ScriptStimulus[] = [];
  private sightGrace = new Map<EntityId, SightGraceState>();
  private smartObjects = new SmartObjectReservationStore();
  private targetPoints: TargetPointIndex = createTargetPointIndex([]);
  /**
   * Stable proxy handed to every runner so {@link setTargetPoints} can swap the
   * authored route index without rebuilding runners (which would drop patrol
   * progress). Delegates every call to the current {@link targetPoints}.
   */
  private readonly targetPointsProxy: TargetPointIndex = {
    get: (id) => this.targetPoints.get(id),
    all: () => this.targetPoints.all(),
    byTag: (tag) => this.targetPoints.byTag(tag),
    next: (id) => this.targetPoints.next(id),
    first: (tag) => this.targetPoints.first(tag),
    start: (tag) => this.targetPoints.start(tag),
    nearest: (position, tag, excludeId) => this.targetPoints.nearest(position, tag, excludeId),
  };

  constructor(options: AISubsystemOptions = {}) {
    this.taskRegistry = options.taskRegistry ?? createDefaultAiTaskRegistry();
    this.serviceRegistry = options.serviceRegistry ?? createDefaultAiServiceRegistry();
    this.emitMessage = options.emitMessage;
    this.moveTo = options.moveTo;
    this.blockers = options.blockers;
    this.blockersNear = options.blockersNear;
    this.perceptionSourceFilter = options.perceptionSourceFilter;
    this.splineRegistry = options.splineRegistry;
    this.qualityFocusPosition = options.qualityFocusPosition;
  }

  configure(options: AISubsystemOptions): void {
    if (options.taskRegistry) this.taskRegistry = options.taskRegistry;
    if (options.serviceRegistry) this.serviceRegistry = options.serviceRegistry;
    if (options.emitMessage) this.emitMessage = options.emitMessage;
    if (options.moveTo) this.moveTo = options.moveTo;
    if (options.blockers) this.blockers = options.blockers;
    if (options.blockersNear) this.blockersNear = options.blockersNear;
    if (options.perceptionSourceFilter) this.perceptionSourceFilter = options.perceptionSourceFilter;
    if (options.splineRegistry) this.splineRegistry = options.splineRegistry;
    if (options.qualityFocusPosition) this.qualityFocusPosition = options.qualityFocusPosition;
  }

  /**
   * Enables the optional far-NPC cadence.  It only affects controllers for
   * which the host can resolve a focus point; no focus, invalid Hz or an empty
   * configuration all preserve the pre-Phase-7 every-frame update.
   */
  setDistanceUpdateSettings(settings: AiDistanceUpdateSettings): void {
    this.distanceUpdateSettings = { ...settings };
    this.runnerAccumulatedSeconds.clear();
  }

  setAssetLibrary(library: AiAssetLibrary): void {
    this.blackboardAssets = library.blackboards ?? new Map();
    this.behaviorAssets = library.behaviors ?? new Map();
    this.stateTreeAssets = library.stateTrees ?? new Map();
    this.queryAssets = library.queries ?? new Map();
    this.rebuildRunners();
  }

  /**
   * Registers the authored Target Point route index for patrol tasks. Swaps the
   * underlying index in place (runners see it through {@link targetPointsProxy}),
   * so it can be called before or after {@link setEntities} without dropping
   * runner memory. Pass `[]` on scene teardown.
   */
  setTargetPoints(entries: readonly TargetPointEntry[]): void {
    this.targetPoints = createTargetPointIndex(entries);
  }

  /**
   * Derives the live controller set from the scene's entities: every entity with
   * an AIController component gets a controller possessing it, with a blackboard
   * built from the component's inline key schema (asset-referenced blackboards
   * are resolved in Faz 2). Replaces any previous set — call with `[]` to clear
   * on scene teardown/reload.
   */
  setEntities(entities: readonly Entity[]): void {
    this.controllers.clear();
    this.runners.clear();
    this.entities = entities;
    this.pendingNoises = [];
    this.pendingScriptStimuli = [];
    this.runnerAccumulatedSeconds.clear();
    this.sightGrace.clear();
    this.smartObjects.setEntities(entities);
    for (const entity of entities) this.trackController(entity);
    this.rebuildRunners();
  }

  /** Entity queries use the live list; perception refreshes on its next scheduled tick. */
  addEntity(entity: Entity): void {
    if (this.entities.some((candidate) => candidate.id === entity.id)) return;
    this.entities = [...this.entities, entity];
    this.smartObjects.addEntity(entity);
    this.trackController(entity);
    const controller = this.controllers.get(entity.id);
    if (controller) this.createRunner(entity.id, controller);
  }

  removeEntity(entityId: EntityId): void {
    this.controllers.delete(entityId);
    this.runners.delete(entityId);
    this.entities = this.entities.filter((entity) => entity.id !== entityId);
    this.runnerAccumulatedSeconds.delete(entityId);
    this.sightGrace.delete(entityId);
    for (const [listenerId, memory] of this.sightGrace) {
      if (memory.stimulus.sourceEntityId === entityId) this.sightGrace.delete(listenerId);
    }
    this.pendingNoises = this.pendingNoises.filter((noise) => noise.sourceEntityId !== entityId);
    this.pendingScriptStimuli = this.pendingScriptStimuli.filter(
      (stimulus) => stimulus.sourceEntityId !== entityId && stimulus.target !== entityId,
    );
    this.smartObjects.removeEntity(entityId);
    // Other controllers keep blackboard/query memories until normal task/service
    // refresh. Perception refreshes on their next scheduled tick; no runner restarts.
  }

  private trackController(entity: Entity): void {
    const component = readAIControllerComponent(entity);
    if (!component) return;
    const behaviorAsset = component.behaviorTree
      ? this.behaviorAssets.get(component.behaviorTree)
      : undefined;
    const stateTreeAsset = component.stateTree
      ? this.stateTreeAssets.get(component.stateTree)
      : undefined;
    const blackboardRef =
      component.blackboard ?? stateTreeAsset?.blackboard ?? behaviorAsset?.blackboard;
    const blackboardKeys = blackboardRef
      ? this.blackboardAssets.get(blackboardRef)?.keys
      : undefined;
    const blackboard = new Blackboard(blackboardKeys ?? component.blackboardKeys ?? []);
    const options: AIControllerOptions = {
      ...(component.behaviorTree ? { behaviorTreeAsset: component.behaviorTree } : {}),
      ...(component.stateTree ? { stateTreeAsset: component.stateTree } : {}),
      ...(blackboardRef ? { blackboardAsset: blackboardRef } : {}),
      ...(component.perception ? { perception: component.perception } : {}),
      ...(component.patrolRoute ? { patrolRoute: component.patrolRoute } : {}),
    };
    const controller = new AIController(`ai:${entity.id}`, entity.id, blackboard, options);
    this.controllers.set(entity.id, controller);
  }

  updateEntityTransform(entityId: EntityId, transform: TransformComponent): void {
    const index = this.entities.findIndex((candidate) => candidate.id === entityId);
    const entity = this.entities[index];
    if (!entity) return;
    this.entities = [
      ...this.entities.slice(0, index),
      {
        ...entity,
        components: {
          ...entity.components,
          Transform: {
            position: [transform.position[0], transform.position[1], transform.position[2]],
            rotation: [transform.rotation[0], transform.rotation[1], transform.rotation[2]],
            scale: [transform.scale[0], transform.scale[1], transform.scale[2]],
          },
        },
      },
      ...this.entities.slice(index + 1),
    ];
  }

  update(engine: EngineUpdateContext): void {
    if (!this.enabled) {
      this.pendingNoises = [];
      this.pendingScriptStimuli = [];
      return;
    }
    this.smartObjects.expire(engine.elapsedSeconds);
    const dueDeltas = this.dueRunnerDeltas(engine.deltaSeconds);
    this.updatePerception(dueDeltas);
    for (const [pawnEntityId, entry] of this.runners) {
      const deltaSeconds = dueDeltas.get(pawnEntityId) ?? 0;
      if (deltaSeconds > 0) entry.runner.tick({ ...engine, deltaSeconds });
    }
    this.pendingNoises = [];
    this.pendingScriptStimuli = [];
  }

  emitNoise(position: readonly [number, number, number], sourceEntityId: EntityId, loudness = 1): void {
    this.pendingNoises.push({
      sourceEntityId,
      position: [position[0], position[1], position[2]],
      loudness,
    });
  }

  emitScriptStimulus(input: AiScriptStimulusInput): boolean {
    const stimulus = this.scriptStimulusFromMessage(input);
    if (!stimulus) return false;
    this.pendingScriptStimuli.push(stimulus);
    return true;
  }

  /**
   * Enables/disables AI simulation. Disabled, {@link update} is a no-op so an
   * editor edit-mode host keeps authored NPCs static until Play runs (same gate
   * as BehaviorSubsystem / PhysicsSubsystem).
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** The controller possessing `pawnEntityId`, or undefined (Faz 3 move-intent hook). */
  getControllerForPawn(pawnEntityId: EntityId): AIController | undefined {
    return this.controllers.get(pawnEntityId);
  }

  controllerCount(): number {
    return this.controllers.size;
  }

  /** Drops all controllers (scene teardown / reload). */
  clear(): void {
    this.controllers.clear();
    this.runners.clear();
    this.entities = [];
    this.pendingNoises = [];
    this.pendingScriptStimuli = [];
    this.sightGrace.clear();
    this.runnerAccumulatedSeconds.clear();
    this.smartObjects.clear();
    this.targetPoints = createTargetPointIndex([]);
  }

  dispose(): void {
    this.clear();
  }

  getDebugSnapshot(): AiDebugSnapshot {
    return {
      enabled: this.enabled,
      controllerCount: this.controllers.size,
      controllers: [...this.controllers.entries()].map(([pawnEntityId, controller]) => {
        const entry = this.runners.get(pawnEntityId);
        const runnerDebug =
          entry?.kind === "behavior"
            ? { behavior: entry.runner.getDebugSnapshot() }
            : entry?.kind === "stateTree"
              ? { stateTree: entry.runner.getDebugSnapshot() }
              : null;
        const controllerSnapshot = controller.getDebugSnapshot(runnerDebug);
        const patrolSplineMissing =
          controllerSnapshot.patrolRoute?.source === "spline" &&
          (!controllerSnapshot.patrolRoute.splineId ||
            !this.splineRegistry?.getSplineById(controllerSnapshot.patrolRoute.splineId));
        const snapshot: AiControllerSubsystemDebugSnapshot = patrolSplineMissing
          ? { ...controllerSnapshot, patrolSplineMissing: true }
          : controllerSnapshot;
        const entity = this.entities.find((candidate) => candidate.id === pawnEntityId);
        const transform = entity ? readTransformComponent(entity) : undefined;
        if (!transform) return snapshot;
        return {
          ...snapshot,
          position: [
            transform.position[0],
            transform.position[1],
            transform.position[2],
          ],
          forward: forwardVectorFromRotation(transform.rotation),
        };
      }),
    };
  }

  private rebuildRunners(): void {
    this.runners.clear();
    for (const [pawnEntityId, controller] of this.controllers) this.createRunner(pawnEntityId, controller);
  }

  private createRunner(pawnEntityId: EntityId, controller: AIController): void {
    // StateTree wins when a controller authors both — it is the richer
    // long-lived state model, and the runners share the same task registry.
    const stateTreeRef = controller.stateTreeAsset;
    const stateTreeAsset = stateTreeRef ? this.stateTreeAssets.get(stateTreeRef) : undefined;
    if (stateTreeAsset) {
      this.runners.set(pawnEntityId, {
        kind: "stateTree",
        runner: new AiStateTreeRunner(controller, stateTreeAsset, this.runnerOptions()),
      });
      return;
    }
    const behaviorTreeAsset = controller.behaviorTreeAsset;
    const behaviorAsset = behaviorTreeAsset ? this.behaviorAssets.get(behaviorTreeAsset) : undefined;
    if (!behaviorAsset) return;
    this.runners.set(pawnEntityId, {
      kind: "behavior",
      runner: new AiBehaviorRunner(controller, behaviorAsset, this.runnerOptions()),
    });
  }

  private dueRunnerDeltas(deltaSeconds: number): Map<EntityId, number> {
    const due = new Map<EntityId, number>();
    const focus = this.qualityFocusPosition?.() ?? null;
    for (const pawnEntityId of this.controllers.keys()) {
      const entity = this.entities.find((candidate) => candidate.id === pawnEntityId);
      const transform = entity ? readTransformComponent(entity) : undefined;
      const distanceSquared = focus && transform
        ? squaredDistance(transform.position, focus)
        : null;
      const accumulatedSeconds = this.runnerAccumulatedSeconds.get(pawnEntityId) ?? 0;
      const scheduledDelta = consumeDistanceUpdateDelta({
        deltaSeconds,
        accumulatedSeconds,
        isFar: isFarFromFocus(distanceSquared, this.distanceUpdateSettings),
        settings: this.distanceUpdateSettings,
      });
      if (scheduledDelta > 0) {
        due.set(pawnEntityId, scheduledDelta);
        this.runnerAccumulatedSeconds.delete(pawnEntityId);
      } else {
        this.runnerAccumulatedSeconds.set(pawnEntityId, accumulatedSeconds + Math.max(0, deltaSeconds));
      }
    }
    return due;
  }

  private updatePerception(dueDeltas: ReadonlyMap<EntityId, number>): void {
    const sources = perceptionSources(this.entities, this.perceptionSourceFilter);
    // Without a local query the whole list is read once and shared.
    const allBlockers = this.blockersNear ? null : this.blockers?.() ?? [];
    for (const [pawnEntityId, controller] of this.controllers) {
      const deltaSeconds = dueDeltas.get(pawnEntityId);
      if (!deltaSeconds) continue;
      const entity = this.entities.find((candidate) => candidate.id === pawnEntityId);
      const transform = entity ? readTransformComponent(entity) : undefined;
      const config = controller.perceptionConfig;
      if (!entity || !transform || !config) {
        controller.setPerception([]);
        this.sightGrace.delete(pawnEntityId);
        continue;
      }
      const sightOrigin = sightTracePoint(entity);
      // Sight only traces to sources within `sightRadius` (planar) of the
      // listener, and both trace ends share their source's X/Z, so every
      // blocker a trace can hit touches that square.
      const sightRadius = config.sightRadius ?? 0;
      const blockers = allBlockers ?? (sightRadius > 0
        ? this.blockersNear!(transform.position[0], transform.position[2], sightRadius)
        : []);
      const perceived = evaluatePerception({
        listener: {
          entityId: pawnEntityId,
          position: transform.position,
          forward: forwardVectorFromRotation(transform.rotation),
          ...(sightOrigin ? { sightOrigin } : {}),
          ...config,
        },
        sources,
        noises: this.pendingNoises,
        blockers,
      });
      perceived.push(...this.scriptStimuliFor(pawnEntityId, transform.position, config.hearingRadius));
      perceived.sort(comparePerceivedStimuli);
      controller.setPerception(
        this.applySightGrace(pawnEntityId, perceived, config.targetLostGraceSeconds, deltaSeconds),
      );
    }
  }

  private scriptStimuliFor(
    pawnEntityId: EntityId,
    listenerPosition: readonly [number, number, number],
    hearingRadius: number | undefined,
  ): PerceivedStimulus[] {
    const result: PerceivedStimulus[] = [];
    const radius = positiveFinite(hearingRadius);
    for (const stimulus of this.pendingScriptStimuli) {
      const isDirect = stimulus.target === pawnEntityId || stimulus.sourceEntityId === pawnEntityId;
      const distance = planarDistance(listenerPosition, stimulus.position);
      if (!isDirect) {
        if (radius <= 0 || distance > radius) continue;
      }
      const strength = isDirect || radius <= 0
        ? stimulus.strength
        : stimulus.strength * Math.max(0, 1 - distance / radius);
      if (strength <= 0) continue;
      result.push({
        sense: stimulus.sense,
        sourceEntityId: stimulus.sourceEntityId,
        position: [stimulus.position[0], stimulus.position[1], stimulus.position[2]],
        distance,
        strength,
        eventType: stimulus.eventType,
      });
    }
    return result;
  }

  private scriptStimulusFromMessage(input: AiScriptStimulusInput): ScriptStimulus | null {
    const sense = senseForScriptMessage(input.type);
    if (!sense) return null;
    const position =
      vec3FromUnknown(input.payload?.position) ??
      this.positionForEntity(input.source) ??
      (input.target ? this.positionForEntity(input.target) : null);
    if (!position) return null;
    return {
      sense,
      sourceEntityId: input.source,
      ...(input.target !== undefined ? { target: input.target } : {}),
      position,
      strength: strengthForScriptStimulus(sense),
      eventType: input.type,
    };
  }

  private positionForEntity(entityId: EntityId): [number, number, number] | null {
    const entity = this.entities.find((candidate) => candidate.id === entityId);
    const transform = entity ? readTransformComponent(entity) : undefined;
    return transform ? [transform.position[0], transform.position[1], transform.position[2]] : null;
  }

  private applySightGrace(
    pawnEntityId: EntityId,
    perceived: readonly PerceivedStimulus[],
    graceSeconds: number | undefined,
    deltaSeconds: number,
  ): PerceivedStimulus[] {
    const sight = perceived.find((stimulus) => stimulus.sense === "sight" && stimulus.lineOfSight !== false);
    const grace = typeof graceSeconds === "number" && Number.isFinite(graceSeconds) && graceSeconds > 0
      ? graceSeconds
      : 0;
    if (sight) {
      if (grace > 0) {
        this.sightGrace.set(pawnEntityId, { stimulus: sight, remainingSeconds: grace, totalSeconds: grace });
      } else {
        this.sightGrace.delete(pawnEntityId);
      }
      return [...perceived];
    }
    const memory = this.sightGrace.get(pawnEntityId);
    if (!memory || grace <= 0) {
      this.sightGrace.delete(pawnEntityId);
      return [...perceived];
    }
    const remaining = memory.remainingSeconds - Math.max(0, deltaSeconds);
    if (remaining <= 0) {
      this.sightGrace.delete(pawnEntityId);
      return [...perceived];
    }
    this.sightGrace.set(pawnEntityId, { ...memory, remainingSeconds: remaining });
    const remembered = {
      ...memory.stimulus,
      lineOfSight: false,
      strength: memory.stimulus.strength * (remaining / Math.max(memory.totalSeconds, 1e-6)),
    };
    return [remembered, ...perceived].sort(comparePerceivedStimuli);
  }

  private runnerOptions(): AiBehaviorRunnerOptions {
    return {
      taskRegistry: this.taskRegistry,
      ...(this.serviceRegistry ? { serviceRegistry: this.serviceRegistry } : {}),
      resolveSubtree: (assetPath) => this.behaviorAssets.get(assetPath),
      ...(this.emitMessage ? { emitMessage: this.emitMessage } : {}),
      ...(this.moveTo ? { moveTo: this.moveTo } : {}),
      smartObjects: this.smartObjects,
      targetPoints: this.targetPointsProxy,
      ...(this.splineRegistry ? { splineRegistry: this.splineRegistry } : {}),
      world: {
        entityPosition: (entityId) => this.positionForEntity(entityId),
      },
      runQuery: ({ controller, query }) => {
        const asset = this.queryAssets.get(query);
        if (!asset) {
          const result = { status: "failure" as const, candidates: [], winner: null };
          controller.setLastQueryResult(query, result);
          return result;
        }
        const result = runAiQuery(asset, {
          controller,
          entities: this.entities,
          ...(this.blockersNear
            ? { blockersNear: this.blockersNear }
            : { blockers: this.blockers?.() ?? [] }),
          smartObjects: this.smartObjects,
        });
        controller.setLastQueryResult(query, result);
        return result;
      },
    };
  }
}

interface SightGraceState {
  readonly stimulus: PerceivedStimulus;
  readonly remainingSeconds: number;
  readonly totalSeconds: number;
}

interface ScriptStimulus {
  readonly sense: GameplayPerceptionSense;
  readonly sourceEntityId: EntityId;
  readonly target?: EntityId;
  readonly position: [number, number, number];
  readonly strength: number;
  readonly eventType: string;
}

function perceptionSources(
  entities: readonly Entity[],
  filter?: (entity: Entity) => boolean,
): StimulusSource[] {
  const sources: StimulusSource[] = [];
  for (const entity of entities) {
    if (filter && !filter(entity)) continue;
    const transform = readTransformComponent(entity);
    if (!transform) continue;
    const sightTarget = sightTracePoint(entity);
    sources.push({
      entityId: entity.id,
      position: transform.position,
      ...(sightTarget ? { sightTarget } : {}),
    });
  }
  return sources;
}

function sightTracePoint(entity: Entity): [number, number, number] | undefined {
  const transform = readTransformComponent(entity);
  if (!transform) return undefined;
  const movement = readCharacterMovementComponent(entity);
  const height = movement
    ? Math.max(0.1, resolveCharacterCapsule(entity).halfHeight * 1.25)
    : 0.1;
  return [
    transform.position[0],
    transform.position[1] + height,
    transform.position[2],
  ];
}

function senseForScriptMessage(type: string): GameplayPerceptionSense | null {
  const normalized = type.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "damage" || normalized.startsWith("damage.")) return "damage";
  if (normalized === "alert" || normalized.endsWith(".alert")) return "alert";
  if (normalized === "ui-action" || normalized === "game-event") return "gameplay";
  return null;
}

function strengthForScriptStimulus(sense: GameplayPerceptionSense): number {
  switch (sense) {
    case "damage":
      return 1;
    case "alert":
      return 0.9;
    case "gameplay":
      return 0.7;
  }
}

function vec3FromUnknown(value: unknown): [number, number, number] | null {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return [value[0] as number, value[1] as number, value[2] as number];
  }
  return null;
}

function planarDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

function squaredDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return dx * dx + dy * dy + dz * dz;
}

function positiveFinite(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
