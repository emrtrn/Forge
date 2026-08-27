/**
 * Layer 2 capability: AI — the decision layer and the navigation that carries
 * its decisions out.
 *
 * Owns the {@link AISubsystem} (one controller per possessed NPC pawn, its
 * blackboard, its Behavior Tree or StateTree runner, perception and Target Point
 * routes), the authored AI asset library those runners are built from, and the
 * whole path-following stack behind `moveTo`: the baked nav grid and its
 * revision cache, per-agent clearance profiles, the walkable-floor sampler,
 * waypoint advance, stuck recovery and local separation steering.
 *
 * It ticks in the `decision` slot — before the `movement` slot, so the intent an
 * agent produces this frame is consumed by the same frame's movement solve. The
 * solver asks for that intent through {@link AiCommands.moveIntentFor}; nothing
 * is pushed at it.
 *
 * Everything about the world comes in as one host service, because all of it is
 * live shell state or a Layer 3 injection: the physics-derived nav world, the
 * focus point for the far-NPC cadence, the idle locomotion report, the `?debug`
 * flag, and the game module's task registry. Without that host the module
 * registers nothing at all. Its siblings are resolved lazily and each is
 * optional: `script-message-bus` (no bus, no stimuli), `character-movement-query`
 * (no solver, so no agent has a position to plan from) and
 * `spline-registry-source` (no splines, so patrol routes fall back to Target
 * Points).
 *
 * Switched off, no controller ever runs: NPC entities still render, still have
 * physics bodies and still run their scripts, they simply make no decisions and
 * the movement solver is never handed an intent for them. That is the pawn-less
 * / directly-commanded case the layered runtime plan exists for.
 */
import type { Group, Scene } from "three";

import { AISubsystem, type AiDebugSnapshot, type AiDistanceUpdateSettings } from "@engine/ai/aiSubsystem";
import {
  normalizeAiBehaviorTreeAsset,
  normalizeAiBlackboardAsset,
  type AiBehaviorStatus,
  type AiBehaviorTreeAsset,
  type AiBlackboardAsset,
} from "@engine/ai/behaviorAsset";
import type { AiMoveRequest } from "@engine/ai/behaviorRunner";
import { normalizeAiStateTreeAsset, type AiStateTreeAsset } from "@engine/ai/stateTreeAsset";
import { createTargetPointIndex, targetPointEntriesFromLayout } from "@engine/ai/targetPoints";
import { assetPath, assetType } from "@engine/assets/manifest";
import type { PhysicsSurfaceTriangle } from "@engine/behavior/behaviorSubsystem";
import { collapseCoincidentFloors, findGroundLayersAt } from "@engine/movement/characterCollision";
import type { CharacterMoveIntent } from "@engine/movement/characterMovementSubsystem";
import { slopeCosFromDegrees } from "@engine/movement/slopeSurface";
import {
  advanceWaypoint,
  findGridPath,
  searchNavGrid,
  NavGridCache,
  type NavAabb,
  type NavAgent,
  type PathFollowingState,
} from "@engine/navigation/gridNavigation";
import {
  freshStuckState,
  isStuck,
  separationSteering,
  updateStuckState,
  type AvoidanceNeighbor,
  type StuckState,
} from "@engine/navigation/localAvoidance";
import { resolveNavAgentProfile } from "@engine/navigation/navAgentProfile";
import {
  createAiNavigationView,
  disposeAiNavigationView,
  inflateNavBlocker2d,
  type AiNavAgentClearanceView,
  type AiPerceptionView,
  type AiQueryCandidateView,
  type AiTargetPointRouteView,
} from "@engine/render-three/aiNavigationView";
import { aiNavigationVolumeAabb } from "@engine/render-three/aiNavigationVolume";
import { resolveCharacterCapsule } from "@engine/scene/capsule";
import {
  readAIControllerComponent,
  readBehaviorComponent,
  readCharacterMovementComponent,
  type TransformComponent,
} from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import type { RoomLayout, Vec3 } from "@engine/scene/layout";
import type { SplineRegistry } from "@engine/scene/splineRegistry";
import { projectFileUrl } from "@/project/ProjectSystem";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeContext } from "./RuntimeContext";
import type { RuntimeServices } from "./RuntimeServices";
import {
  aiCommandsService,
  aiDebugService,
  aiHostService,
  assetManifestService,
  characterMovementQueryService,
  scriptMessageBusService,
  splineRegistrySourceService,
  type AiNavigationDebugSnapshot,
  type AiNavFollowerDebug,
} from "./runtimeServiceKeys";

export const AI_MODULE_ID = "ai";

const AI_MOVE_ACCEPTANCE_RADIUS = 0.2;
const AI_NAV_CELL_SIZE = 0.5;
const AI_NAV_GRID_SAFETY_MARGIN = AI_NAV_CELL_SIZE * 0.5;
const AI_NAV_MIN_TOP_SUPPORT_RADIUS = 0.15;
/**
 * Acceptance radius for intermediate path waypoints. Kept tight (independent of
 * the authored final-goal acceptance) so a generous goal tolerance can't make
 * the agent skip a corner waypoint early and cut through an inflated blocker.
 */
const AI_INTERMEDIATE_WAYPOINT_ACCEPTANCE = Math.min(AI_NAV_CELL_SIZE * 0.35, 0.2);
/** How strongly agent-separation steering blends into the desired path direction. */
const AI_SEPARATION_WEIGHT = 0.75;
/** Spline patrols stay on their authored rail; nearby actors may nudge, not redirect, them. */
const AI_SPLINE_SEPARATION_WEIGHT = 0.25;
/** Spline tangent influence when a nav path points broadly in the same direction. */
const AI_SPLINE_TANGENT_STEERING_WEIGHT = 0.35;
/** Stuck recoveries (replans) per goal before the move fails outright. */
const AI_MAX_STUCK_REPLANS = 2;
/**
 * Granularity the agent foot height is snapped to when keying a baked nav grid.
 * Baking is per foot-plane (it decides which blockers are vertical obstacles), so
 * without bucketing an agent's per-frame Y jitter would rebuild the grid every
 * tick. Half a cell is coarse enough to keep the cache stable on flat ground yet
 * fine enough to separate distinct floors.
 */
const AI_NAV_FOOT_Y_BUCKET = AI_NAV_CELL_SIZE;

/**
 * Script messages promoted to AI stimuli. Damage/alert make an agent aware of an
 * attacker it never saw; `ui-action` and `game-event` let authored content poke
 * a behavior tree without a bespoke channel.
 */
const AI_SCRIPT_STIMULUS_MESSAGE_TYPES = [
  "Damage.Apply",
  "Damage.Died",
  "damage",
  "alert",
  "ui-action",
  "game-event",
] as const;

interface AiPathFollowing {
  goal: Vec3;
  /** Spline tangent supplied by patrol authoring; nav heading remains authoritative near blockers. */
  preferredDirection?: Vec3;
  speed?: number;
  acceptanceRadius?: number;
  state: PathFollowingState;
  /** Progress window feeding stuck detection (replan / give up). */
  stuck: StuckState;
  /** Stuck-recovery replans burned on the current goal. */
  replans: number;
}

function bucketNavFootY(footY: number): number {
  if (!Number.isFinite(footY)) return 0;
  return Math.round(footY / AI_NAV_FOOT_Y_BUCKET) * AI_NAV_FOOT_Y_BUCKET;
}

/** Cheap order-sensitive signature of authored nav bounds for cache invalidation. */
function navBoundsSignature(bounds: readonly NavAabb[]): string {
  let signature = "";
  for (const bound of bounds) {
    signature += `${bound.min[0]},${bound.min[1]},${bound.min[2]},${bound.max[0]},${bound.max[1]},${bound.max[2]};`;
  }
  return signature;
}

function distance3d(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function samePoint3d(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return distance3d(a, b) <= 1e-6;
}

/**
 * Keeps navigation authoritative while smoothing clear spline patrol stretches.
 * A tangent pointing backward or sideways is ignored so this cannot pull an
 * agent through a nav corner or obstacle.
 */
function blendAiPathDirection(
  pathDirection: readonly [number, number],
  preferredDirection: Vec3 | undefined,
): [number, number] {
  const pathLength = Math.hypot(pathDirection[0], pathDirection[1]);
  if (!(pathLength > 1e-6) || !preferredDirection) return [pathDirection[0], pathDirection[1]];
  const tangentLength = Math.hypot(preferredDirection[0], preferredDirection[2]);
  if (!(tangentLength > 1e-6)) return [pathDirection[0], pathDirection[1]];
  const pathX = pathDirection[0] / pathLength;
  const pathZ = pathDirection[1] / pathLength;
  const tangentX = preferredDirection[0] / tangentLength;
  const tangentZ = preferredDirection[2] / tangentLength;
  const alignment = pathX * tangentX + pathZ * tangentZ;
  if (!(alignment > 0)) return [pathX, pathZ];
  const weight = AI_SPLINE_TANGENT_STEERING_WEIGHT * alignment;
  const blendedX = pathX * (1 - weight) + tangentX * weight;
  const blendedZ = pathZ * (1 - weight) + tangentZ * weight;
  const blendedLength = Math.hypot(blendedX, blendedZ);
  return blendedLength > 1e-6 ? [blendedX / blendedLength, blendedZ / blendedLength] : [pathX, pathZ];
}

/** Compact one-line reason for a failed asset load (matches the shell's wording). */
function describeLoadError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "load failed";
}

export function createAiModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  let ai: AISubsystem | null = null;
  let layout: RoomLayout | null = null;
  let scene: Scene | null = null;
  let debug = false;

  const pathFollowing = new Map<string, AiPathFollowing>();
  /**
   * Bakes one nav grid per agent profile and reuses it across path queries while
   * static blockers + nav bounds are unchanged (the Unreal navmesh-bake analogue).
   * Keyed by {@link navRevisionToken}; rebuilds automatically when that token
   * changes. Only used when an AI Navigation Volume supplies query-independent
   * bounds — otherwise the grid extent depends on start/goal and can't be baked.
   */
  const navGridCache = new NavGridCache();
  /** Last static-blocker array identity seen; a new reference bumps the revision. */
  let navBlockerRevisionRef: readonly NavAabb[] | null = null;
  let navSurfaceRevisionRef: readonly PhysicsSurfaceTriangle[] | null = null;
  let navBlockerRevision = 0;
  /** Entities of the built level, for reading authored agent/movement components. */
  let entityById = new Map<string, Entity>();
  let navigationView: Group | null = null;
  let stimulusUnsubs: Array<() => void> = [];

  const host = () => services?.resolve(aiHostService) ?? null;
  const characterMovement = () => services?.resolve(characterMovementQueryService);
  const splineSource = () => services?.resolve(splineRegistrySourceService)?.() ?? null;
  /**
   * Spline patrol tasks read the level's splines through this. It delegates per
   * call instead of holding a registry, because the shell rebuilds one per level
   * and a cached reference would go stale on the first Level Travel — and a
   * runtime with no spline source at all then simply finds no route.
   */
  const splineRegistry: SplineRegistry = {
    get: (id) => splineSource()?.get(id) ?? null,
    all: () => splineSource()?.all() ?? [],
    getSplineById: (id) => splineSource()?.getSplineById(id) ?? null,
    getSplinesByTag: (tag) => splineSource()?.getSplinesByTag(tag) ?? [],
  };

  function navigationBounds(): NavAabb[] {
    const bounds: NavAabb[] = [];
    for (const volume of layout?.aiNavigationVolumes ?? []) {
      const bound = aiNavigationVolumeAabb(volume);
      if (!bound) continue;
      bounds.push({
        min: [bound.min[0], bound.min[1], bound.min[2]],
        max: [bound.max[0], bound.max[1], bound.max[2]],
      });
    }
    return bounds;
  }

  function navAgentForEntity(entityId: string): NavAgent {
    const entity = entityById.get(entityId);
    const movement = entity ? readCharacterMovementComponent(entity) : undefined;
    const navAgent = entity ? readAIControllerComponent(entity)?.navAgent : undefined;
    const characterCapsule = entity && movement ? resolveCharacterCapsule(entity) : undefined;
    return resolveNavAgentProfile({
      ...(navAgent ? { navAgent } : {}),
      ...(movement ? { movement } : {}),
      colliderHalfExtents:
        characterCapsule?.halfExtents ?? host()?.navigation.colliderHalfExtents(entityId) ?? null,
    });
  }

  function effectiveClearanceRadius(agent: NavAgent): number {
    return Math.max(0, agent.radius) + Math.max(0, agent.clearancePadding ?? 0) + AI_NAV_GRID_SAFETY_MARGIN;
  }

  /**
   * Revision token for the baked nav grid cache: bumps a counter whenever the
   * physics static-blocker array is rebuilt (identity changes on spawn/destroy/
   * move/collision-toggle) and folds in an authored-bounds signature, so any
   * change to obstacles or nav volumes invalidates every cached grid.
   */
  function navRevisionToken(
    blockers: readonly NavAabb[],
    surfaces: readonly PhysicsSurfaceTriangle[],
    bounds: readonly NavAabb[],
  ): string {
    if (blockers !== navBlockerRevisionRef) {
      navBlockerRevisionRef = blockers;
      navBlockerRevision += 1;
    }
    if (surfaces !== navSurfaceRevisionRef) {
      navSurfaceRevisionRef = surfaces;
      navBlockerRevision += 1;
    }
    return `${navBlockerRevision}|${navBoundsSignature(bounds)}`;
  }

  function navFloorSampler(
    blockers: readonly NavAabb[],
    surfaces: readonly PhysicsSurfaceTriangle[],
    bounds: readonly NavAabb[],
    agent: NavAgent,
    preferredFloorY: number,
  ): (x: number, z: number) => readonly number[] | null {
    const footprintHalf: [number, number] = [Math.max(0, agent.radius), Math.max(0, agent.radius)];
    const maxSlopeCos = slopeCosFromDegrees(agent.maxSlopeAngleDeg ?? 50);
    return (x, z) => {
      let minY = Infinity;
      let maxY = -Infinity;
      for (const bound of bounds) {
        if (x < bound.min[0] || x > bound.max[0] || z < bound.min[2] || z > bound.max[2]) continue;
        minY = Math.min(minY, bound.min[1]);
        maxY = Math.max(maxY, bound.max[1]);
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY < minY) return null;
      const hits = findGroundLayersAt([x, maxY, z], blockers, {
        footprintHalf,
        maxStepUp: 0,
        maxStepDown: maxY - minY,
        surfaces,
        maxSlopeCos,
        preferredFloorY,
        requiredSupportRadius: Math.min(Math.max(0, agent.radius), AI_NAV_MIN_TOP_SUPPORT_RADIUS),
        // Recast walkableHeight: reject floor cells with less than the agent's
        // height of clearance above them, so no nav floor is baked under a
        // ramp/stair (nor on a wedge's downward-facing underside).
        requiredHeadroom: Math.max(0, agent.height),
        respectNavigationRole: true,
      });
      // Collapse near-coincident walkable surfaces into a single navigable floor,
      // keeping the highest of each cluster. A solid floor mesh (`complexAsSimple`)
      // reports both its top face and its slab underside/thickness as walkable
      // layers a few centimetres apart; CharacterMovement grounds the pawn on the
      // highest one, but the multi-layer nav grid would otherwise keep the lower
      // phantom layer and route the path through it — leaving interior waypoints
      // below the walking pawn. The follower's tight vertical acceptance can't
      // clear that gap, so the agent stalls a few steps in. Surfaces within the
      // agent's step height are one floor it can freely traverse, so this matches
      // movement while leaving genuinely distinct floors (upper platforms) intact.
      const layers = collapseCoincidentFloors(
        hits.map((hit) => hit.floorY),
        Math.max(agent.stepHeight ?? 0, 1e-3),
      );
      return layers.length > 0 ? layers : null;
    };
  }

  function buildPath(entityId: string, start: Vec3, goal: Vec3) {
    const navigation = host()?.navigation;
    if (!navigation) return { status: "failure" as const, points: [], visited: 0 };
    const bounds = navigationBounds();
    const agent = navAgentForEntity(entityId);
    const blockers = navigation.staticNavigationBlockerAabbs();
    if (bounds.length === 0) {
      // No authored AI Navigation Volume: the grid extent is derived from
      // start/goal, so it is single-query only and can't be baked/reused.
      return findGridPath({ start, goal: [...goal], agent, blockers, cellSize: AI_NAV_CELL_SIZE });
    }
    const surfaces = navigation.staticNavigationSurfaceTriangles();
    // Bounded case: bake once per agent profile and reuse across queries. The
    // grid rebuilds automatically when a static blocker moves or a nav volume is
    // edited (both fold into the revision token), so there is no manual build.
    const navFootY = bucketNavFootY(start[1]);
    const grid = navGridCache.getOrBuild(navRevisionToken(blockers, surfaces, bounds), {
      agent,
      blockers,
      bounds,
      footY: navFootY,
      cellSize: AI_NAV_CELL_SIZE,
      sampleFloorYs: navFloorSampler(blockers, surfaces, bounds, agent, navFootY),
    });
    if (!grid) return { status: "failure" as const, points: [], visited: 0 };
    return searchNavGrid(grid, start, goal);
  }

  function requestMove(request: AiMoveRequest): AiBehaviorStatus {
    const entityId = request.controller.pawnEntityId;
    const transform = characterMovement()?.transformOf(entityId) ?? null;
    if (!transform) return "failure";
    const acceptanceRadius = request.acceptanceRadius ?? AI_MOVE_ACCEPTANCE_RADIUS;
    if (distance3d(transform.position, request.position) <= acceptanceRadius) {
      pathFollowing.delete(entityId);
      if (request.preserveLocomotionOnSuccess !== true) host()?.reportIdleLocomotion(entityId);
      return "success";
    }
    const existing = pathFollowing.get(entityId);
    if (!existing || !samePoint3d(existing.goal, request.position)) {
      const path = buildPath(entityId, transform.position, request.position);
      if (path.status === "failure" || path.points.length < 2) {
        pathFollowing.set(entityId, {
          goal: [...request.position],
          ...(request.preferredDirection ? { preferredDirection: [...request.preferredDirection] } : {}),
          ...(request.speed !== undefined ? { speed: request.speed } : {}),
          ...(request.acceptanceRadius !== undefined ? { acceptanceRadius: request.acceptanceRadius } : {}),
          state: { path: [], waypointIndex: 0, status: "failure" },
          stuck: freshStuckState(transform.position),
          replans: 0,
        });
        return "failure";
      }
      pathFollowing.set(entityId, {
        goal: [...request.position],
        ...(request.preferredDirection ? { preferredDirection: [...request.preferredDirection] } : {}),
        ...(request.speed !== undefined ? { speed: request.speed } : {}),
        ...(request.acceptanceRadius !== undefined ? { acceptanceRadius: request.acceptanceRadius } : {}),
        state: { path: path.points, waypointIndex: 1, status: "following" },
        stuck: freshStuckState(transform.position),
        replans: 0,
      });
      return "running";
    }
    if (existing.speed !== request.speed) {
      if (request.speed === undefined) {
        delete existing.speed;
      } else {
        existing.speed = request.speed;
      }
    }
    if (existing.acceptanceRadius !== request.acceptanceRadius) {
      if (request.acceptanceRadius === undefined) {
        delete existing.acceptanceRadius;
      } else {
        existing.acceptanceRadius = request.acceptanceRadius;
      }
    }
    if (request.preferredDirection) {
      existing.preferredDirection = [...request.preferredDirection];
    } else {
      delete existing.preferredDirection;
    }
    // A memoized failure (unreachable goal or exhausted stuck recovery) keeps
    // failing this goal until the task asks for a different one — replanning
    // the same unreachable goal every behavior tick would re-run A* for nothing.
    return existing.state.status === "failure" ? "failure" : "running";
  }

  /** Every other live character (player + NPCs) as a separation neighbor. */
  function separationNeighbors(entityId: string): AvoidanceNeighbor[] {
    const neighbors: AvoidanceNeighbor[] = [];
    characterMovement()?.forEachCharacter((otherId, other) => {
      if (otherId === entityId) return;
      neighbors.push({
        position: other.position,
        radius: navAgentForEntity(otherId).radius,
      });
    });
    return neighbors;
  }

  function moveIntentFor(
    entityId: string,
    transform: Readonly<TransformComponent>,
    deltaSeconds: number,
  ): CharacterMoveIntent | null {
    const follow = pathFollowing.get(entityId);
    if (!follow || follow.state.status !== "following") return null;
    let state = follow.state;
    const advance = advanceWaypoint(state.path, state.waypointIndex, transform.position, {
      final: follow.acceptanceRadius ?? AI_MOVE_ACCEPTANCE_RADIUS,
      intermediate: AI_INTERMEDIATE_WAYPOINT_ACCEPTANCE,
    });
    if (advance.arrived) {
      pathFollowing.delete(entityId);
      return { direction: [0, 0], speed: 0 };
    }
    if (advance.waypointIndex !== state.waypointIndex) {
      state = { ...state, waypointIndex: advance.waypointIndex };
      follow.state = state;
    }
    let target = state.path[state.waypointIndex];
    if (!target) {
      pathFollowing.delete(entityId);
      return null;
    }
    // Stuck recovery: no planar progress for a while means something the grid
    // doesn't know about (usually another agent) is blocking the lane. Replan
    // from the current position, and fail the move once replanning stops helping.
    follow.stuck = updateStuckState(follow.stuck, transform.position, deltaSeconds);
    if (isStuck(follow.stuck)) {
      follow.stuck = freshStuckState(transform.position);
      follow.replans += 1;
      const path =
        follow.replans > AI_MAX_STUCK_REPLANS
          ? null
          : buildPath(entityId, transform.position, follow.goal);
      if (!path || path.status === "failure" || path.points.length < 2) {
        follow.state = { path: [], waypointIndex: 0, status: "failure" };
        return null;
      }
      follow.state = { path: path.points, waypointIndex: 1, status: "following" };
      target = follow.state.path[1]!;
    }
    const dx = target[0] - transform.position[0];
    const dz = target[2] - transform.position[2];
    const length = Math.hypot(dx, dz);
    // Local avoidance: blend a separation push away from nearby characters into
    // the path direction so agents shoulder past each other instead of stacking.
    const separation = separationSteering(
      transform.position,
      navAgentForEntity(entityId).radius,
      separationNeighbors(entityId),
    );
    const pathDirection: [number, number] = length > 0 ? [dx / length, dz / length] : [0, 0];
    const steered = blendAiPathDirection(pathDirection, follow.preferredDirection);
    const separationWeight = follow.preferredDirection
      ? AI_SPLINE_SEPARATION_WEIGHT
      : AI_SEPARATION_WEIGHT;
    const direction: [number, number] = [
      steered[0] + separation[0] * separationWeight,
      steered[1] + separation[1] * separationWeight,
    ];
    return {
      direction,
      ...(follow.speed !== undefined ? { speed: follow.speed } : {}),
    };
  }

  /** Characters, AI pawns and the scripted player stand-in are what agents notice. */
  function isPerceptionSource(entity: Entity): boolean {
    if (readCharacterMovementComponent(entity)) return true;
    if (readAIControllerComponent(entity)) return true;
    return readBehaviorComponent(entity)?.scriptId === "input-move";
  }

  async function loadAiAssets(): Promise<void> {
    const manifest = (await services?.resolve(assetManifestService)?.()) ?? null;
    const blackboards = new Map<string, AiBlackboardAsset>();
    const behaviors = new Map<string, AiBehaviorTreeAsset>();
    const stateTrees = new Map<string, AiStateTreeAsset>();
    await Promise.all(
      (manifest?.assets ?? []).map(async (asset) => {
        const type = assetType(asset);
        if (type !== "blackboard" && type !== "behaviorTree" && type !== "stateTree") return;
        const path = assetPath(asset);
        try {
          const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          const json = await response.json();
          if (type === "blackboard") {
            const blackboard = normalizeAiBlackboardAsset(json);
            blackboards.set(asset.id, blackboard);
            blackboards.set(path, blackboard);
          } else if (type === "stateTree") {
            const stateTree = normalizeAiStateTreeAsset(json);
            stateTrees.set(asset.id, stateTree);
            stateTrees.set(path, stateTree);
          } else {
            const behavior = normalizeAiBehaviorTreeAsset(json);
            behaviors.set(asset.id, behavior);
            behaviors.set(path, behavior);
          }
        } catch (error) {
          console.warn("[ai] failed to load AI asset", path, describeLoadError(error));
        }
      }),
    );
    ai?.setAssetLibrary({ blackboards, behaviors, stateTrees });
  }

  /** Target Point patrol route overlay: markers, `next` links, active AI highlight. */
  function targetPointRouteView(): AiTargetPointRouteView[] {
    const points = layout?.targetPoints ?? [];
    if (points.length === 0 || !ai) return [];
    const index = createTargetPointIndex(targetPointEntriesFromLayout(points));
    const activeIds = new Set<string>();
    for (const controller of ai.getDebugSnapshot().controllers) {
      for (const entry of controller.blackboard.entries) {
        if (typeof entry.value === "string" && entry.value.length > 0) activeIds.add(entry.value);
      }
    }
    return index.all().map((entry) => {
      const next = index.next(entry.id);
      return {
        id: entry.id,
        position: entry.position,
        next: next ? next.position : null,
        ...(activeIds.has(entry.id) ? { active: true } : {}),
      };
    });
  }

  function perceptionView(): AiPerceptionView[] {
    return (ai?.getDebugSnapshot().controllers ?? [])
      .filter((controller) => controller.position && controller.forward && controller.perceptionConfig)
      .map((controller) => ({
        entityId: controller.pawnEntityId,
        position: controller.position!,
        forward: controller.forward!,
        ...(controller.perceptionConfig!.sightRadius !== undefined
          ? { sightRadius: controller.perceptionConfig!.sightRadius }
          : {}),
        ...(controller.perceptionConfig!.fieldOfViewDeg !== undefined
          ? { fieldOfViewDeg: controller.perceptionConfig!.fieldOfViewDeg }
          : {}),
        ...(controller.perceptionConfig!.hearingRadius !== undefined
          ? { hearingRadius: controller.perceptionConfig!.hearingRadius }
          : {}),
      }));
  }

  function queryView(): AiQueryCandidateView[] {
    const out: AiQueryCandidateView[] = [];
    for (const controller of ai?.getDebugSnapshot().controllers ?? []) {
      const query = controller.query;
      if (!query) continue;
      const winnerId = query.winner?.id ?? null;
      const candidates = query.candidates.length > 0
        ? query.candidates
        : query.winner
          ? [query.winner]
          : [];
      for (const candidate of candidates) {
        out.push({
          ...(candidate.entityId ? { entityId: candidate.entityId } : {}),
          position: candidate.position,
          score: candidate.score,
          failedTests: candidate.failedTests,
          winner: candidate.id === winnerId,
        });
      }
    }
    return out;
  }

  function agentClearanceView(): AiNavAgentClearanceView[] {
    const out: AiNavAgentClearanceView[] = [];
    for (const entityId of pathFollowing.keys()) {
      const transform = characterMovement()?.transformOf(entityId) ?? null;
      if (!transform) continue;
      const agent = navAgentForEntity(entityId);
      out.push({
        entityId,
        position: transform.position,
        agentRadius: Math.max(0, agent.radius),
        radius: effectiveClearanceRadius(agent),
      });
    }
    return out;
  }

  function navigationDebugSnapshot(): AiNavigationDebugSnapshot {
    const blockers = host()?.navigation.staticNavigationBlockerAabbs() ?? [];
    const agentClearances = agentClearanceView();
    const maxClearance = Math.max(0, ...agentClearances.map((clearance) => clearance.radius));
    const followers: AiNavFollowerDebug[] = [...pathFollowing.entries()].map(([entityId, follow]) => ({
      entityId,
      status: follow.state.status,
      waypointIndex: follow.state.waypointIndex,
      pathLength: follow.state.path.length,
      path: follow.state.path,
      goal: follow.goal,
      ...(follow.speed !== undefined ? { speed: follow.speed } : {}),
      ...(follow.acceptanceRadius !== undefined ? { acceptanceRadius: follow.acceptanceRadius } : {}),
      replans: follow.replans,
      secondsWithoutProgress: follow.stuck.secondsWithoutProgress,
    }));
    return {
      blockers,
      inflatedBlockers:
        maxClearance > 0 ? blockers.map((blocker) => inflateNavBlocker2d(blocker, maxClearance)) : [],
      agentClearances,
      bounds: navigationBounds(),
      cellSize: AI_NAV_CELL_SIZE,
      followers,
    };
  }

  function removeNavigationView(): void {
    if (!navigationView) return;
    scene?.remove(navigationView);
    disposeAiNavigationView(navigationView);
    navigationView = null;
  }

  function updateNavigationView(): void {
    removeNavigationView();
    if (!scene) return;
    const snapshot = navigationDebugSnapshot();
    const perception = perceptionView();
    const queries = queryView();
    const routes = targetPointRouteView();
    if (
      snapshot.followers.length === 0 &&
      snapshot.blockers.length === 0 &&
      snapshot.inflatedBlockers.length === 0 &&
      snapshot.agentClearances.length === 0 &&
      snapshot.bounds.length === 0 &&
      perception.length === 0 &&
      queries.length === 0 &&
      routes.length === 0
    ) return;
    navigationView = createAiNavigationView({
      blockers: snapshot.blockers,
      inflatedBlockers: snapshot.inflatedBlockers,
      agentClearances: snapshot.agentClearances,
      bounds: snapshot.bounds,
      cellSize: snapshot.cellSize,
      followers: snapshot.followers,
      perception,
      queries,
      routes,
    });
    scene.add(navigationView);
  }

  function clearStimulusBridge(): void {
    for (const unsubscribe of stimulusUnsubs) unsubscribe();
    stimulusUnsubs = [];
  }

  return {
    id: AI_MODULE_ID,

    onRuntimeStart(runtimeServices: RuntimeServices) {
      services = runtimeServices;
      const aiHost = runtimeServices.resolve(aiHostService);
      // No host means no world to perceive or plan through: stay unregistered
      // rather than ticking controllers that could never act.
      if (!aiHost) return;
      debug = aiHost.debug;

      ai = new AISubsystem({
        ...(() => {
          const taskRegistry = aiHost.taskRegistry?.();
          return taskRegistry ? { taskRegistry } : {};
        })(),
        blockers: () => aiHost.navigation.staticBlockerAabbs(),
        perceptionSourceFilter: isPerceptionSource,
        qualityFocusPosition: () => aiHost.qualityFocusPosition(),
        moveTo: (request) => requestMove(request),
        splineRegistry,
        // Resolved per call: a bus-less host (a headless test, a shell that
        // registers no behavior subsystem) simply drops what the AI says.
        emitMessage: (message) =>
          services
            ?.resolve(scriptMessageBusService)
            ?.emit(message.type, message.source, message.payload, message.target),
      });

      // Decisions tick before the `movement` slot, so an intent produced here is
      // consumed by the same frame's movement solve.
      runtimeServices.addSubsystem("decision", ai);
      runtimeServices.addEntitySink({
        setEntities: (entities) => {
          entityById = new Map(entities.map((entity) => [entity.id, entity]));
          ai?.setEntities(entities);
        },
      });

      runtimeServices.provide(aiCommandsService, {
        prepareLevel: async (levelLayout) => {
          layout = levelLayout;
          await loadAiAssets();
          ai?.setTargetPoints(targetPointEntriesFromLayout(levelLayout.targetPoints));
        },
        updateEntityTransform: (entityId, transform) => {
          ai?.updateEntityTransform(entityId, transform);
        },
        moveIntentFor: (entityId, transform, deltaSeconds) =>
          moveIntentFor(entityId, transform, deltaSeconds),
        setDistanceUpdateSettings: (settings: AiDistanceUpdateSettings) => {
          ai?.setDistanceUpdateSettings(settings);
        },
      });

      runtimeServices.provide(aiDebugService, {
        controllers: (): AiDebugSnapshot =>
          ai?.getDebugSnapshot() ?? { enabled: false, controllerCount: 0, controllers: [] },
        navigation: () => navigationDebugSnapshot(),
      });
    },

    onLevelLoaded(context: RuntimeContext) {
      if (!ai) return;
      scene = context.scene;
      layout = context.layout;

      // Stimuli are how authored content reaches a behavior tree. Without a bus
      // nothing can be promoted, which is simply an AI that only sees and hears.
      const bus = context.resolve(scriptMessageBusService);
      clearStimulusBridge();
      if (!bus) return;
      stimulusUnsubs = AI_SCRIPT_STIMULUS_MESSAGE_TYPES.map((type) =>
        bus.subscribe(type, (envelope) => {
          ai?.emitScriptStimulus({
            type: envelope.type,
            source: envelope.source,
            ...(envelope.target !== undefined ? { target: envelope.target } : {}),
            payload: envelope.payload,
          });
        }),
      );
    },

    update() {
      // World-space overlay only, rebuilt from this frame's resolved state. It is
      // added to the scene rather than projected, so it does not need to wait for
      // the Game Mode's camera the way screen-space UI does.
      if (debug) updateNavigationView();
    },

    onLevelUnloaded() {
      clearStimulusBridge();
      removeNavigationView();
      pathFollowing.clear();
      navGridCache.clear();
      navBlockerRevisionRef = null;
      navSurfaceRevisionRef = null;
      entityById = new Map();
      ai?.setTargetPoints([]);
      ai?.setEntities([]);
      layout = null;
      scene = null;
    },

    dispose() {
      clearStimulusBridge();
      removeNavigationView();
      pathFollowing.clear();
      navGridCache.clear();
      ai?.dispose();
      ai = null;
      services = null;
      layout = null;
      scene = null;
    },
  };
}
