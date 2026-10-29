/**
 * Runtime Behavior Tree runner for Forge AI.
 *
 * Pure engine code: no DOM, Three.js or editor imports. Runtime memory is kept
 * per controller and per node path so authored behavior assets remain immutable
 * and shared safely across agents.
 */
import type { EngineUpdateContext } from "../core/Subsystem";
import type { EntityId } from "../scene/entity";
import type { Vec3 } from "../scene/layout";
import type { AIController } from "./aiController";
import type { Blackboard, BlackboardValue } from "./blackboard";
import type { PerceivedStimulus, PerceptionSense } from "../perception/perception";
import type {
  AiBehaviorNode,
  AiBehaviorServiceDef,
  AiBehaviorStatus,
  AiBehaviorTreeAsset,
  AiJsonValue,
} from "./behaviorAsset";
import { aiDecoratorsPass, distanceBetween, vec3Param, type AiWorldQuery } from "./aiConditions";
import { aiQueryParams } from "./queryAsset";
import type { AiQueryResult } from "./queryRunner";
import type { SmartObjectRuntime } from "./smartObjects";
import type { TargetPointEntry, TargetPointIndex } from "./targetPoints";
import type { SplineQuery, SplineRegistry } from "../scene/splineRegistry";

export type AiTaskHandler = (context: AiTaskContext) => AiBehaviorStatus;
export type AiServiceHandler = (context: AiServiceContext) => void;

export interface AiTaskRegistry {
  get(taskId: string): AiTaskHandler | undefined;
}

export interface AiServiceRegistry {
  get(serviceId: string): AiServiceHandler | undefined;
}

export interface AiMessageEmitInput {
  readonly type: string;
  readonly source: EntityId;
  readonly target?: EntityId;
  readonly payload?: Record<string, unknown>;
}

export interface AiMoveRequest {
  readonly controller: AIController;
  readonly position: Vec3;
  /** Optional preferred movement direction, e.g. the tangent of a spline patrol. */
  readonly preferredDirection?: Vec3;
  /** Keeps a looping locomotion clip alive while a multi-segment route advances. */
  readonly preserveLocomotionOnSuccess?: boolean;
  readonly speed?: number;
  readonly acceptanceRadius?: number;
}

export interface AiQueryRequest {
  readonly controller: AIController;
  readonly query: string;
}

export type { AiWorldQuery } from "./aiConditions";

export interface AiBehaviorRunnerOptions {
  readonly taskRegistry?: AiTaskRegistry;
  readonly serviceRegistry?: AiServiceRegistry;
  readonly resolveSubtree?: (assetPath: string) => AiBehaviorTreeAsset | undefined;
  readonly emitMessage?: (input: AiMessageEmitInput) => void;
  readonly moveTo?: (request: AiMoveRequest) => AiBehaviorStatus;
  readonly runQuery?: (request: AiQueryRequest) => AiQueryResult;
  readonly smartObjects?: SmartObjectRuntime;
  readonly world?: AiWorldQuery;
  readonly targetPoints?: TargetPointIndex;
  readonly splineRegistry?: SplineRegistry;
}

export interface AiTaskContext {
  readonly controller: AIController;
  readonly blackboard: Blackboard;
  readonly engine: EngineUpdateContext;
  readonly params: Record<string, AiJsonValue>;
  readonly memory: Map<string, unknown>;
  readonly emitMessage?: (input: AiMessageEmitInput) => void;
  readonly moveTo?: (request: AiMoveRequest) => AiBehaviorStatus;
  readonly runQuery?: (request: AiQueryRequest) => AiQueryResult;
  readonly smartObjects?: SmartObjectRuntime;
  readonly world?: AiWorldQuery;
  readonly targetPoints?: TargetPointIndex;
  readonly splineRegistry?: SplineRegistry;
}

export interface AiServiceContext extends AiTaskContext {
  readonly service: AiBehaviorServiceDef;
}

export interface AiBehaviorRunnerDebugSnapshot {
  readonly activePath: readonly string[];
  readonly lastStatus: AiBehaviorStatus | null;
  readonly lastTask: string | null;
  readonly failedDecorator: string | null;
  readonly elapsedSeconds: number;
}

interface NodeMemory {
  childIndex: number;
  waitRemaining: number | null;
  readonly taskMemory: Map<string, unknown>;
  readonly serviceElapsed: Map<number, number>;
  /** Per-decorator-index next-ready runtime time for cooldown decorators. */
  readonly cooldownReadyAt: Map<number, number>;
}

interface TickState {
  readonly activePath: string[];
  lastTask: string | null;
  failedDecorator: string | null;
}

const EMPTY_PARAMS: Record<string, AiJsonValue> = {};
/**
 * Task-memory sentinel: when a task sets `memory[PRESERVE_TASK_MEMORY] = true`,
 * its per-node memory survives a non-running result instead of being cleared.
 * Exported so the StateTree runner (`stateTreeRunner.ts`) applies the identical
 * task-memory lifecycle when it invokes the shared task registry.
 */
export const PRESERVE_TASK_MEMORY = "__forgePreserveTaskMemory";

interface CachedQueryTaskResult {
  readonly signature: string;
  elapsedSeconds: number;
  readonly status: AiBehaviorStatus;
  readonly value?: BlackboardValue;
  readonly slotValue?: BlackboardValue;
}

export function createDefaultAiTaskRegistry(): AiTaskRegistry {
  const tasks = new Map<string, AiTaskHandler>([
    ["forge.wait", waitTask],
    ["forge.setBlackboard", setBlackboardTask],
    ["forge.sendMessage", sendMessageTask],
    ["forge.stopMovement", stopMovementTask],
    ["forge.moveToPosition", moveToPositionTask],
    ["forge.moveToBlackboard", moveToBlackboardTask],
    ["forge.setPatrolTarget", setPatrolTargetTask],
    ["forge.moveToPatrolTarget", moveToPatrolTargetTask],
    ["forge.waitAtPatrolTarget", waitAtPatrolTargetTask],
    ["forge.advancePatrolTarget", advancePatrolTargetTask],
    ["forge.moveAlongPatrolRoute", moveAlongPatrolRouteTask],
    ["forge.startConversation", startConversationTask],
    ["forge.runQueryToBlackboard", runQueryToBlackboardTask],
    ["forge.claimSmartObject", claimSmartObjectTask],
    ["forge.useSmartObject", useSmartObjectTask],
  ]);
  return { get: (taskId) => tasks.get(taskId) };
}

export function createDefaultAiServiceRegistry(): AiServiceRegistry {
  const services = new Map<string, AiServiceHandler>([
    ["forge.updatePerceptionBlackboard", updatePerceptionBlackboardService],
    ["forge.updateTargetDistanceBlackboard", updateTargetDistanceBlackboardService],
    ["forge.refreshQueryBlackboard", refreshQueryBlackboardService],
  ]);
  return { get: (serviceId) => services.get(serviceId) };
}

export class AiBehaviorRunner {
  private readonly memory = new Map<string, NodeMemory>();
  private elapsedSeconds = 0;
  private activePath: string[] = [];
  private lastStatus: AiBehaviorStatus | null = null;
  private lastTask: string | null = null;
  private failedDecorator: string | null = null;

  constructor(
    private readonly controller: AIController,
    private readonly asset: AiBehaviorTreeAsset,
    private readonly options: AiBehaviorRunnerOptions = {},
  ) {}

  tick(engine: EngineUpdateContext): AiBehaviorStatus {
    this.elapsedSeconds += Math.max(0, engine.deltaSeconds);
    const state: TickState = {
      activePath: [],
      lastTask: null,
      failedDecorator: null,
    };
    const status = this.tickNode(this.asset.root, "root", engine, state, []);
    this.activePath = state.activePath;
    this.lastStatus = status;
    this.lastTask = state.lastTask;
    this.failedDecorator = state.failedDecorator;
    this.controller.setGoal(status === "running" && state.lastTask ? state.lastTask : null);
    return status;
  }

  reset(): void {
    this.memory.clear();
    this.activePath = [];
    this.lastStatus = null;
    this.lastTask = null;
    this.failedDecorator = null;
    this.elapsedSeconds = 0;
    this.controller.setGoal(null);
  }

  getDebugSnapshot(): AiBehaviorRunnerDebugSnapshot {
    return {
      activePath: this.activePath,
      lastStatus: this.lastStatus,
      lastTask: this.lastTask,
      failedDecorator: this.failedDecorator,
      elapsedSeconds: this.elapsedSeconds,
    };
  }

  private tickNode(
    node: AiBehaviorNode,
    path: string,
    engine: EngineUpdateContext,
    state: TickState,
    subtreeStack: readonly string[],
  ): AiBehaviorStatus {
    state.activePath.push(path);
    if (!this.decoratorsPass(node, path, engine, state)) return this.record(path, "failure");
    this.tickServices(node, path, engine);

    switch (node.kind) {
      case "selector":
        return this.tickComposite(node.children, path, engine, state, subtreeStack, "selector");
      case "sequence":
        return this.tickComposite(node.children, path, engine, state, subtreeStack, "sequence");
      case "task":
        return this.tickTask(node.task, node.params ?? EMPTY_PARAMS, path, engine, state);
      case "wait":
        return this.tickWait(node.seconds, path, engine);
      case "subtree":
        return this.tickSubtree(node.behavior, path, engine, state, subtreeStack);
    }
  }

  private tickComposite(
    children: readonly AiBehaviorNode[],
    path: string,
    engine: EngineUpdateContext,
    state: TickState,
    subtreeStack: readonly string[],
    mode: "selector" | "sequence",
  ): AiBehaviorStatus {
    if (children.length === 0) return this.record(path, mode === "sequence" ? "success" : "failure");
    const memory = this.memoryFor(path);
    let index = mode === "selector" ? 0 : clampIndex(memory.childIndex, children.length);
    while (index < children.length) {
      const child = children[index];
      if (!child) break;
      const childPath = `${path}/${child.id ?? `${child.kind}:${index}`}`;
      const status = this.tickNode(child, childPath, engine, state, subtreeStack);
      if (status === "running") {
        memory.childIndex = index;
        return this.record(path, "running");
      }
      if (mode === "selector" && status === "success") {
        memory.childIndex = 0;
        return this.record(path, "success");
      }
      if (mode === "sequence" && status === "failure") {
        memory.childIndex = 0;
        return this.record(path, "failure");
      }
      index += 1;
    }
    memory.childIndex = 0;
    return this.record(path, mode === "selector" ? "failure" : "success");
  }

  private tickTask(
    taskId: string,
    params: Record<string, AiJsonValue>,
    path: string,
    engine: EngineUpdateContext,
    state: TickState,
  ): AiBehaviorStatus {
    state.lastTask = taskId;
    const task = this.options.taskRegistry?.get(taskId);
    if (!task) return this.record(path, "failure");
    const memory = this.memoryFor(path).taskMemory;
    const status = task({
      controller: this.controller,
      blackboard: this.controller.blackboard,
      engine,
      params,
      memory,
      ...(this.options.emitMessage ? { emitMessage: this.options.emitMessage } : {}),
      ...(this.options.moveTo ? { moveTo: this.options.moveTo } : {}),
      ...(this.options.runQuery ? { runQuery: this.options.runQuery } : {}),
      ...(this.options.smartObjects ? { smartObjects: this.options.smartObjects } : {}),
      ...(this.options.world ? { world: this.options.world } : {}),
      ...(this.options.targetPoints ? { targetPoints: this.options.targetPoints } : {}),
      ...(this.options.splineRegistry ? { splineRegistry: this.options.splineRegistry } : {}),
    });
    if (status !== "running" && memory.get(PRESERVE_TASK_MEMORY) !== true) memory.clear();
    return this.record(path, status);
  }

  private tickWait(seconds: number, path: string, engine: EngineUpdateContext): AiBehaviorStatus {
    const memory = this.memoryFor(path);
    if (memory.waitRemaining === null) memory.waitRemaining = seconds;
    memory.waitRemaining -= Math.max(0, engine.deltaSeconds);
    if (memory.waitRemaining > 0) return this.record(path, "running");
    memory.waitRemaining = null;
    return this.record(path, "success");
  }

  private tickSubtree(
    behavior: string,
    path: string,
    engine: EngineUpdateContext,
    state: TickState,
    subtreeStack: readonly string[],
  ): AiBehaviorStatus {
    if (subtreeStack.includes(behavior)) return this.record(path, "failure");
    const asset = this.options.resolveSubtree?.(behavior);
    if (!asset) return this.record(path, "failure");
    return this.tickNode(asset.root, `${path}/subtree:${behavior}`, engine, state, [...subtreeStack, behavior]);
  }

  private decoratorsPass(
    node: AiBehaviorNode,
    path: string,
    engine: EngineUpdateContext,
    state: TickState,
  ): boolean {
    const decorators = node.decorators;
    if (!decorators || decorators.length === 0) return true;
    const result = aiDecoratorsPass(decorators, {
      controller: this.controller,
      ...(this.options.world ? { world: this.options.world } : {}),
      elapsedSeconds: engine.elapsedSeconds,
      cooldownReadyAt: this.memoryFor(path).cooldownReadyAt,
    });
    if (!result.pass) {
      state.failedDecorator = result.failed;
      return false;
    }
    return true;
  }

  private tickServices(node: AiBehaviorNode, path: string, engine: EngineUpdateContext): void {
    if (!node.services || node.services.length === 0) return;
    const memory = this.memoryFor(path);
    for (let index = 0; index < node.services.length; index += 1) {
      const service = node.services[index];
      if (!service) continue;
      const interval = service.interval ?? 0.25;
      const elapsed = (memory.serviceElapsed.get(index) ?? interval) + Math.max(0, engine.deltaSeconds);
      if (elapsed + 1e-9 < interval) {
        memory.serviceElapsed.set(index, elapsed);
        continue;
      }
      memory.serviceElapsed.set(index, 0);
      const handler = this.options.serviceRegistry?.get(service.service);
      handler?.({
        controller: this.controller,
        blackboard: this.controller.blackboard,
        engine,
        params: service.params ?? EMPTY_PARAMS,
        memory: memory.taskMemory,
        service,
        ...(this.options.emitMessage ? { emitMessage: this.options.emitMessage } : {}),
        ...(this.options.moveTo ? { moveTo: this.options.moveTo } : {}),
        ...(this.options.runQuery ? { runQuery: this.options.runQuery } : {}),
        ...(this.options.smartObjects ? { smartObjects: this.options.smartObjects } : {}),
        ...(this.options.world ? { world: this.options.world } : {}),
        ...(this.options.targetPoints ? { targetPoints: this.options.targetPoints } : {}),
        ...(this.options.splineRegistry ? { splineRegistry: this.options.splineRegistry } : {}),
      });
    }
  }

  private memoryFor(path: string): NodeMemory {
    let memory = this.memory.get(path);
    if (!memory) {
      memory = {
        childIndex: 0,
        waitRemaining: null,
        taskMemory: new Map(),
        serviceElapsed: new Map(),
        cooldownReadyAt: new Map(),
      };
      this.memory.set(path, memory);
    }
    return memory;
  }

  private record(_path: string, status: AiBehaviorStatus): AiBehaviorStatus {
    return status;
  }
}

function waitTask(context: AiTaskContext): AiBehaviorStatus {
  const seconds = numberParam(context.params.seconds, 1);
  const remaining = (context.memory.get("remaining") as number | undefined) ?? seconds;
  const next = remaining - Math.max(0, context.engine.deltaSeconds);
  if (next > 0) {
    context.memory.set("remaining", next);
    return "running";
  }
  context.memory.delete("remaining");
  return "success";
}

function setBlackboardTask(context: AiTaskContext): AiBehaviorStatus {
  const key = stringParam(context.params.key);
  if (!key) return "failure";
  const value = context.params.value;
  return context.blackboard.set(key, toBlackboardValue(value)) ? "success" : "failure";
}

function sendMessageTask(context: AiTaskContext): AiBehaviorStatus {
  const type = stringParam(context.params.type);
  if (!type || !context.emitMessage) return "failure";
  const cooldownSeconds = optionalNonNegativeNumberParam(
    context.params.cooldownSeconds ?? context.params.cooldown,
  );
  if (cooldownSeconds !== null) {
    context.memory.set(PRESERVE_TASK_MEMORY, true);
    const readyAt = context.memory.get("readyAt") as number | undefined;
    if (readyAt !== undefined && context.engine.elapsedSeconds + 1e-9 < readyAt) return "success";
  } else {
    context.memory.delete(PRESERVE_TASK_MEMORY);
    context.memory.delete("readyAt");
  }
  const target = stringParam(context.params.target);
  const payload = plainPayload(context.params.payload);
  context.emitMessage({
    type,
    source: context.controller.pawnEntityId,
    ...(target ? { target } : {}),
    ...(payload ? { payload } : {}),
  });
  if (cooldownSeconds !== null) {
    context.memory.set("readyAt", context.engine.elapsedSeconds + cooldownSeconds);
  }
  return "success";
}

function stopMovementTask(context: AiTaskContext): AiBehaviorStatus {
  if (!context.moveTo || !context.world) return "failure";
  const position = context.world.entityPosition(context.controller.pawnEntityId);
  if (!position) return "failure";
  return context.moveTo({
    controller: context.controller,
    position,
    acceptanceRadius: 0,
  });
}

function moveToPositionTask(context: AiTaskContext): AiBehaviorStatus {
  if (!context.moveTo) return "failure";
  const position = vec3Param(context.params.position);
  if (!position) return "failure";
  const speed = optionalNonNegativeNumberParam(context.params.speed);
  const acceptanceRadius = optionalNonNegativeNumberParam(
    context.params.acceptanceRadius ?? context.params.acceptance,
  );
  return context.moveTo({
    controller: context.controller,
    position,
    ...(speed !== null ? { speed } : {}),
    ...(acceptanceRadius !== null ? { acceptanceRadius } : {}),
  });
}

/**
 * Moves to the position in a Blackboard key — a vec3, or an entity id whose
 * current position is read each tick (Unreal's MoveTo takes either; an AI
 * query that picks an actor writes its id).
 */
function moveToBlackboardTask(context: AiTaskContext): AiBehaviorStatus {
  if (!context.moveTo) return "failure";
  const key = stringParam(context.params.key);
  if (!key) return "failure";
  const value = context.blackboard.get(key);
  const position = Array.isArray(value)
    ? vec3Param(value)
    : typeof value === "string" && value.length > 0
      ? context.world?.entityPosition(value) ?? null
      : null;
  if (!position) return "failure";
  const speed = optionalNonNegativeNumberParam(context.params.speed);
  const acceptanceRadius = optionalNonNegativeNumberParam(
    context.params.acceptanceRadius ?? context.params.acceptance,
  );
  return context.moveTo({
    controller: context.controller,
    position,
    ...(speed !== null ? { speed } : {}),
    ...(acceptanceRadius !== null ? { acceptanceRadius } : {}),
  });
}

const DEFAULT_PATROL_KEY = "currentPatrolTarget";

/**
 * Picks the current patrol Target Point and writes its id (and optionally its
 * position) to the Blackboard. Idempotent by default: a valid current target is
 * preserved unless `force` is set, so this can sit at the top of a patrol branch
 * and run every tick. Start selection: explicit `targetId`, else `mode: "nearest"`
 * to the pawn, else the route's authored start-flagged point, else the first
 * point in authored order (all optionally scoped by `tag`/`routeId`).
 */
function setPatrolTargetTask(context: AiTaskContext): AiBehaviorStatus {
  const index = context.targetPoints;
  if (!index) return "failure";
  const key = stringParam(context.params.key) ?? DEFAULT_PATROL_KEY;
  const positionKey = stringParam(context.params.positionKey);
  const force = context.params.force === true;
  if (!force) {
    const existing = index.get(context.blackboard.getString(key));
    if (existing) {
      if (positionKey) context.blackboard.set(positionKey, existing.position);
      return "success";
    }
  }
  const entry = resolvePatrolStart(context, index);
  if (!entry) return "failure";
  const written = context.blackboard.set(key, entry.id);
  if (positionKey) context.blackboard.set(positionKey, entry.position);
  return written ? "success" : "failure";
}

/**
 * Moves the pawn toward the Blackboard's current patrol Target Point. Falls back
 * to the point's authored `speedOverride`/`acceptanceRadius` unless overridden by
 * params. Broken/missing target id is a safe failure (no move request).
 */
function moveToPatrolTargetTask(context: AiTaskContext): AiBehaviorStatus {
  const index = context.targetPoints;
  if (!index || !context.moveTo) return "failure";
  const key = stringParam(context.params.key) ?? DEFAULT_PATROL_KEY;
  const entry = index.get(context.blackboard.getString(key));
  if (!entry) return "failure";
  const speedOverride = optionalNonNegativeNumberParam(context.params.speed);
  const speed = speedOverride !== null ? speedOverride : entry.speedOverride;
  const acceptanceOverride = optionalNonNegativeNumberParam(
    context.params.acceptanceRadius ?? context.params.acceptance,
  );
  const acceptanceRadius = acceptanceOverride !== null ? acceptanceOverride : entry.acceptanceRadius;
  const status = context.moveTo({
    controller: context.controller,
    position: entry.position,
    ...(speed !== null ? { speed } : {}),
    ...(acceptanceRadius !== null ? { acceptanceRadius } : {}),
  });
  if (status === "success" && context.params.advanceOnSuccess === true) {
    return advancePatrolTarget(context);
  }
  return status;
}

/**
 * Waits for the authored `waitTime` of the Blackboard's current patrol Target
 * Point (the `key` param, default `currentPatrolTarget`). Mirrors `forge.wait`
 * but sources its duration from the point instead of a static param, so authored
 * per-point dwell times drive the pause. A missing/zero `waitTime` succeeds
 * immediately; a broken/unset target id is a safe failure. An optional
 * `seconds` param sets a fallback used only when the point has no positive
 * `waitTime`.
 */
function waitAtPatrolTargetTask(context: AiTaskContext): AiBehaviorStatus {
  const index = context.targetPoints;
  if (!index) return "failure";
  const key = stringParam(context.params.key) ?? DEFAULT_PATROL_KEY;
  const entry = index.get(context.blackboard.getString(key));
  if (!entry) return "failure";
  const fallback = optionalNonNegativeNumberParam(context.params.seconds) ?? 0;
  const seconds = entry.waitTime > 0 ? entry.waitTime : fallback;
  if (!(seconds > 0)) {
    context.memory.delete("remaining");
    return "success";
  }
  const remaining = (context.memory.get("remaining") as number | undefined) ?? seconds;
  const next = remaining - Math.max(0, context.engine.deltaSeconds);
  if (next > 0) {
    context.memory.set("remaining", next);
    return "running";
  }
  context.memory.delete("remaining");
  return "success";
}

/**
 * Advances the current patrol target to the point's `nextTargetPoint`. When the
 * route ends (no next link), the `mode` param decides the fallback:
 * `"loop"` (default) jumps to the first point of the route/tag, `"nearest"`
 * picks the closest other point, `"stop"` keeps the current point, and
 * `"failure"` reports failure. A broken current id is a safe failure. Optional
 * `lastKey` records the point we advanced away from.
 */
function advancePatrolTargetTask(context: AiTaskContext): AiBehaviorStatus {
  return advancePatrolTarget(context);
}

function advancePatrolTarget(context: AiTaskContext): AiBehaviorStatus {
  const index = context.targetPoints;
  if (!index) return "failure";
  const key = stringParam(context.params.key) ?? DEFAULT_PATROL_KEY;
  const current = index.get(context.blackboard.getString(key));
  if (!current) return "failure";
  const lastKey = stringParam(context.params.lastKey);
  const positionKey = stringParam(context.params.positionKey);
  const commit = (entry: TargetPointEntry): AiBehaviorStatus => {
    if (lastKey && entry.id !== current.id) context.blackboard.set(lastKey, current.id);
    const wroteId = context.blackboard.set(key, entry.id);
    if (positionKey) context.blackboard.set(positionKey, entry.position);
    return wroteId ? "success" : "failure";
  };

  const next = index.next(current.id);
  if (next) return commit(next);

  const mode = stringParam(context.params.mode) ?? "loop";
  const tag = stringParam(context.params.tag) ?? current.patrolTag;
  switch (mode) {
    case "stop":
      return "success";
    case "failure":
      return "failure";
    case "nearest": {
      const position = context.world?.entityPosition(context.controller.pawnEntityId) ?? current.position;
      const nearest = index.nearest(position, tag || undefined, current.id);
      return nearest ? commit(nearest) : "success";
    }
    case "loop":
    default: {
      const first = index.first(tag || undefined);
      return first ? commit(first) : "failure";
    }
  }
}

interface SplinePatrolTaskMemory {
  readonly splineId: string;
  phase: "approach" | "follow";
  distance: number;
  direction: 1 | -1;
}

/**
 * Unified patrol consumer for AIController.patrolRoute. Target Point patrol
 * keeps the existing index semantics; spline patrol first walks to a stable
 * entry sample, then requests short look-ahead targets through normal AI nav /
 * CharacterMovement. It never writes the pawn transform directly.
 */
function moveAlongPatrolRouteTask(context: AiTaskContext): AiBehaviorStatus {
  const route = context.controller.patrolRoute;
  if (route.source !== "spline") return moveAlongTargetPointRoute(context);
  if (!context.moveTo || !context.world || !context.splineRegistry || !route.splineId) return "failure";
  const query = context.splineRegistry.getSplineById(route.splineId);
  const pawnPosition = context.world.entityPosition(context.controller.pawnEntityId);
  if (!query || !pawnPosition || !(query.getLength() > 1e-6)) return "failure";

  let state = context.memory.get("splinePatrol") as SplinePatrolTaskMemory | undefined;
  if (!state || state.splineId !== query.id) {
    state = {
      splineId: query.id,
      phase: "approach",
      distance: route.entry === "start" ? 0 : query.getClosestDistanceToPoint(pawnPosition, "world"),
      direction: 1,
    };
    context.memory.set("splinePatrol", state);
  }

  const speed = route.speed;
  const acceptanceRadius = route.acceptanceRadius ?? 0.55;
  if (state.phase === "approach") {
    const status = requestSplineMove(context, query, state.distance, speed, acceptanceRadius);
    if (status !== "success") return status;
    state.phase = "follow";
    context.memory.set("splinePatrol", state);
    return "running";
  }

  const next = advanceSplinePatrolDistance(
    state.distance,
    state.direction,
    Math.max(0.1, route.lookAheadDistance),
    query.getLength(),
    route.wrapMode,
  );
  const status = requestSplineMove(context, query, next.distance, speed, acceptanceRadius);
  if (status !== "success") return status;
  state.distance = next.distance;
  state.direction = next.direction;
  context.memory.set("splinePatrol", state);
  // A clamped route is complete only once the pawn actually reaches its endpoint.
  return route.wrapMode === "clamp" && next.atBoundary ? "success" : "running";
}

function moveAlongTargetPointRoute(context: AiTaskContext): AiBehaviorStatus {
  const index = context.targetPoints;
  if (!index || !context.moveTo) return "failure";
  const route = context.controller.patrolRoute;
  const key = DEFAULT_PATROL_KEY;
  let entry = index.get(context.blackboard.getString(key));
  if (!entry) {
    entry = index.start(route.targetPointTag) ?? index.first(route.targetPointTag);
    if (!entry || !context.blackboard.set(key, entry.id)) return "failure";
  }
  const status = context.moveTo({
    controller: context.controller,
    position: entry.position,
    ...(route.speed !== undefined ? { speed: route.speed } : {}),
    ...(route.acceptanceRadius !== undefined ? { acceptanceRadius: route.acceptanceRadius } : {}),
  });
  return status === "success" ? advancePatrolTarget(context) : status;
}

function requestSplineMove(
  context: AiTaskContext,
  query: SplineQuery,
  distance: number,
  speed: number | undefined,
  acceptanceRadius: number,
): AiBehaviorStatus {
  if (!context.moveTo) return "failure";
  return context.moveTo({
    controller: context.controller,
    position: query.getLocationAtDistance(distance, "world"),
    preferredDirection: query.getDirectionAtDistance(distance, "world"),
    preserveLocomotionOnSuccess: true,
    ...(speed !== undefined ? { speed } : {}),
    acceptanceRadius,
  });
}

export function advanceSplinePatrolDistance(
  distance: number,
  direction: 1 | -1,
  amount: number,
  length: number,
  wrapMode: "loop" | "pingPong" | "clamp",
): { distance: number; direction: 1 | -1; atBoundary: boolean } {
  if (wrapMode === "loop") {
    const next = distance + amount * direction;
    return { distance: ((next % length) + length) % length, direction, atBoundary: false };
  }
  const next = distance + amount * direction;
  if (wrapMode === "clamp") {
    const clamped = Math.max(0, Math.min(length, next));
    return { distance: clamped, direction, atBoundary: clamped === 0 || clamped === length };
  }
  const phase = direction === 1 ? distance : length * 2 - distance;
  const cycle = ((phase + amount) % (length * 2) + length * 2) % (length * 2);
  return cycle <= length
    ? { distance: cycle, direction: 1, atBoundary: false }
    : { distance: length * 2 - cycle, direction: -1, atBoundary: false };
}

function resolvePatrolStart(context: AiTaskContext, index: TargetPointIndex): TargetPointEntry | null {
  const explicit = stringParam(context.params.targetId);
  if (explicit) return index.get(explicit);
  const tag = stringParam(context.params.tag ?? context.params.routeId) ?? "";
  if (stringParam(context.params.mode) === "nearest") {
    const position = context.world?.entityPosition(context.controller.pawnEntityId);
    if (position) return index.nearest(position, tag || undefined);
  }
  // Prefer an authored start-flagged point; fall back to the first authored one.
  return index.start(tag || undefined) ?? index.first(tag || undefined);
}

function startConversationTask(context: AiTaskContext): AiBehaviorStatus {
  const conversationId = stringParam(context.params.conversationId);
  if (!conversationId || !context.emitMessage) return "failure";
  context.emitMessage({
    type: "start-conversation",
    source: context.controller.pawnEntityId,
    payload: { conversationId },
  });
  return "success";
}

function runQueryToBlackboardTask(context: AiTaskContext): AiBehaviorStatus {
  if (!context.runQuery) return "failure";
  const params = aiQueryParams(context.params);
  if (!params.query || !params.resultKey) return "failure";
  const signature = `${params.query}\n${params.resultKey}\n${params.slotResultKey ?? ""}`;
  if (params.intervalSeconds) {
    context.memory.set(PRESERVE_TASK_MEMORY, true);
    const cached = context.memory.get("cachedQuery") as CachedQueryTaskResult | undefined;
    if (cached?.signature === signature) {
      cached.elapsedSeconds += Math.max(0, context.engine.deltaSeconds);
      if (cached.elapsedSeconds + 1e-9 < params.intervalSeconds) {
        if (cached.value !== undefined) {
          const valueWritten = context.blackboard.set(params.resultKey, cached.value);
          const slotWritten = !params.slotResultKey || cached.slotValue === undefined
            ? true
            : context.blackboard.set(params.slotResultKey, cached.slotValue);
          return valueWritten && slotWritten ? cached.status : "failure";
        }
        return cached.status;
      }
    }
  } else {
    context.memory.delete(PRESERVE_TASK_MEMORY);
    context.memory.delete("cachedQuery");
  }
  const result = context.runQuery({ controller: context.controller, query: params.query });
  const winner = result.winner;
  if (!winner) {
    if (params.intervalSeconds) {
      context.memory.set("cachedQuery", {
        signature,
        elapsedSeconds: 0,
        status: "failure",
      } satisfies CachedQueryTaskResult);
    }
    return "failure";
  }
  const value = winner.entityId ?? winner.position;
  const valueWritten = context.blackboard.set(params.resultKey, value);
  const slotValue = winner.smartObjectSlotId ?? null;
  const slotWritten = params.slotResultKey ? context.blackboard.set(params.slotResultKey, slotValue) : true;
  const status = valueWritten && slotWritten ? "success" : "failure";
  if (params.intervalSeconds) {
    context.memory.set("cachedQuery", {
      signature,
      elapsedSeconds: 0,
      status,
      ...(status === "success" ? { value } : {}),
      ...(status === "success" && params.slotResultKey ? { slotValue } : {}),
    } satisfies CachedQueryTaskResult);
  }
  return status;
}

function claimSmartObjectTask(context: AiTaskContext): AiBehaviorStatus {
  if (!context.smartObjects) return "failure";
  const target = smartObjectTargetFromParams(context);
  if (!target) return "failure";
  return context.smartObjects.claim({
    entityId: target.entityId,
    reservedBy: context.controller.pawnEntityId,
    ...(target.slotId !== null ? { slotId: target.slotId } : {}),
    ttlSeconds: smartObjectTtlSeconds(context.params),
    nowSeconds: context.engine.elapsedSeconds,
  }) ? "success" : "failure";
}

function useSmartObjectTask(context: AiTaskContext): AiBehaviorStatus {
  if (!context.smartObjects) return "failure";
  const target = smartObjectTargetFromParams(context);
  if (!target) return "failure";
  const used = context.smartObjects.use({
    entityId: target.entityId,
    reservedBy: context.controller.pawnEntityId,
    ...(target.slotId !== null ? { slotId: target.slotId } : {}),
    ttlSeconds: smartObjectTtlSeconds(context.params),
    nowSeconds: context.engine.elapsedSeconds,
  });
  if (!used) return "failure";
  const type = stringParam(context.params.messageType) ?? "smart-object.use";
  const payload = {
    ...(plainPayload(context.params.payload) ?? {}),
    smartObject: target.entityId,
    reservedBy: context.controller.pawnEntityId,
    ...(target.slotId !== null ? { slotId: target.slotId } : {}),
  };
  context.emitMessage?.({
    type,
    source: context.controller.pawnEntityId,
    target: target.entityId,
    payload,
  });
  return "success";
}

function updatePerceptionBlackboardService(context: AiServiceContext): void {
  const stimuli = context.controller.getPerception();
  const sight = strongestStimulus(stimuli, "sight");
  const hearing = strongestStimulus(stimuli, "hearing");
  const gameplay = strongestGameplayStimulus(stimuli);

  const targetKey = stringParam(context.params.targetKey);
  const hasLineOfSightKey = stringParam(context.params.hasLineOfSightKey);
  const lastKnownPositionKey = stringParam(context.params.lastKnownPositionKey);
  const lastHeardPositionKey = stringParam(context.params.lastHeardPositionKey);
  const lastHeardSourceKey = stringParam(context.params.lastHeardSourceKey);
  const lastStimulusPositionKey = stringParam(context.params.lastStimulusPositionKey);
  const lastStimulusSourceKey = stringParam(context.params.lastStimulusSourceKey);
  const lastStimulusSenseKey = stringParam(context.params.lastStimulusSenseKey);
  const lastStimulusEventKey = stringParam(context.params.lastStimulusEventKey);

  if (hasLineOfSightKey) context.blackboard.set(hasLineOfSightKey, sight?.lineOfSight === true);
  if (sight) {
    if (targetKey) context.blackboard.set(targetKey, sight.sourceEntityId);
    if (lastKnownPositionKey) context.blackboard.set(lastKnownPositionKey, sight.position);
  }
  if (hearing) {
    if (lastHeardPositionKey) context.blackboard.set(lastHeardPositionKey, hearing.position);
    if (lastHeardSourceKey) context.blackboard.set(lastHeardSourceKey, hearing.sourceEntityId);
  }
  if (gameplay) {
    if (lastStimulusPositionKey) context.blackboard.set(lastStimulusPositionKey, gameplay.position);
    if (lastStimulusSourceKey) context.blackboard.set(lastStimulusSourceKey, gameplay.sourceEntityId);
    if (lastStimulusSenseKey) context.blackboard.set(lastStimulusSenseKey, gameplay.sense);
    if (lastStimulusEventKey) context.blackboard.set(lastStimulusEventKey, gameplay.eventType ?? gameplay.sense);
  }
}

function updateTargetDistanceBlackboardService(context: AiServiceContext): void {
  const targetKey = stringParam(context.params.targetKey) ?? "target";
  const distanceKey = stringParam(context.params.distanceKey);
  const inRangeKey = stringParam(context.params.inRangeKey);
  const targetPositionKey = stringParam(context.params.targetPositionKey);
  const range = numberParam(context.params.range ?? context.params.attackRange, 1.5);
  const target = context.blackboard.getEntity(targetKey);
  const pawnPosition = context.world?.entityPosition(context.controller.pawnEntityId) ?? null;
  const targetPosition = target ? context.world?.entityPosition(target) ?? null : null;

  if (!pawnPosition || !targetPosition) {
    if (distanceKey) context.blackboard.set(distanceKey, null);
    if (inRangeKey) context.blackboard.set(inRangeKey, false);
    return;
  }

  const distance = distanceBetween(pawnPosition, targetPosition);
  if (distanceKey) context.blackboard.set(distanceKey, distance);
  if (inRangeKey) context.blackboard.set(inRangeKey, distance <= range);
  if (targetPositionKey) context.blackboard.set(targetPositionKey, targetPosition);
}

/**
 * Keeps a query result fresh in the Blackboard while its branch is active. Unlike
 * `forge.runQueryToBlackboard` (a task that gates tree flow via success/failure),
 * this runs on its service interval and only writes the winner (or clears the keys
 * to null when there is no winner), leaving control flow to the surrounding tree.
 */
function refreshQueryBlackboardService(context: AiServiceContext): void {
  if (!context.runQuery) return;
  const params = aiQueryParams(context.params);
  if (!params.query || !params.resultKey) return;
  const result = context.runQuery({ controller: context.controller, query: params.query });
  const winner = result.winner;
  if (!winner) {
    context.blackboard.set(params.resultKey, null);
    if (params.slotResultKey) context.blackboard.set(params.slotResultKey, null);
    return;
  }
  context.blackboard.set(params.resultKey, winner.entityId ?? winner.position);
  if (params.slotResultKey) {
    context.blackboard.set(params.slotResultKey, winner.smartObjectSlotId ?? null);
  }
}

function numberParam(value: AiJsonValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function optionalNonNegativeNumberParam(value: AiJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function strongestStimulus(
  stimuli: readonly PerceivedStimulus[],
  sense: PerceptionSense,
): PerceivedStimulus | null {
  let best: PerceivedStimulus | null = null;
  for (const stimulus of stimuli) {
    if (stimulus.sense !== sense) continue;
    if (
      !best ||
      stimulus.strength > best.strength ||
      (stimulus.strength === best.strength && stimulus.distance < best.distance)
    ) {
      best = stimulus;
    }
  }
  return best;
}

function strongestGameplayStimulus(stimuli: readonly PerceivedStimulus[]): PerceivedStimulus | null {
  let best: PerceivedStimulus | null = null;
  for (const stimulus of stimuli) {
    if (stimulus.sense === "sight" || stimulus.sense === "hearing") continue;
    if (
      !best ||
      stimulus.strength > best.strength ||
      (stimulus.strength === best.strength && stimulus.distance < best.distance)
    ) {
      best = stimulus;
    }
  }
  return best;
}

function smartObjectTargetFromParams(context: AiTaskContext): { entityId: EntityId; slotId: string | null } | null {
  const directEntityId = stringParam(context.params.entityId);
  const entityKey = stringParam(context.params.entityKey) ?? stringParam(context.params.key) ?? "smartObject";
  const entityId = directEntityId ?? context.blackboard.getEntity(entityKey);
  if (!entityId) return null;
  const directSlotId = stringParam(context.params.slotId) ?? stringParam(context.params.slot);
  const slotKey = stringParam(context.params.slotKey);
  const slotId = directSlotId ?? (slotKey ? context.blackboard.getString(slotKey) : null);
  return { entityId, slotId };
}

function smartObjectTtlSeconds(params: Record<string, AiJsonValue>): number | null {
  const ttl = params.ttlSeconds ?? params.ttl;
  return typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? ttl : null;
}

function stringParam(value: AiJsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function plainPayload(value: AiJsonValue | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...value };
}

function toBlackboardValue(value: AiJsonValue | undefined): BlackboardValue {
  if (value === undefined) return null;
  if (Array.isArray(value)) return vec3Param(value) ?? null;
  if (typeof value === "object" && value !== null) return null;
  return value;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, Math.max(0, length - 1));
}
