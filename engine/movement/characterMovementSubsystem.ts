import { readCharacterMovementComponent, readTransformComponent } from "../scene/components";
import type { CharacterMovementComponent, TransformComponent } from "../scene/components";
import { resolveCharacterCapsule, type CharacterCapsuleResolution } from "../scene/capsule";
import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import type { Entity, EntityId } from "../scene/entity";
import type { ActionMap } from "../input/actionMap";
import type { LaunchOptions, PhysicsQuery, TransformSink } from "../behavior/behaviorSubsystem";
import type {
  MovingPlatformQuery,
  PlatformState,
} from "../physics/movingPlatformSubsystem";
import {
  facingYawFromMove,
  planarMoveStep,
  planarMoveStepRelativeToYaw,
  rotateYawToward,
} from "./planarMovement";
import { groundedAt, stepVerticalMotion, type VerticalMotionState } from "./verticalMotion";
import {
  filterWalkableBlockers,
  findGroundAt,
  findLandingGround,
  resolvePlanarMovementSubstepped,
  safeSubstepLength,
  type Aabb3,
  type GroundHit,
  type PlanarDelta,
} from "./characterCollision";
import { slopeCosFromDegrees } from "./slopeSurface";
import {
  UPHILL_SLOWDOWN_REST,
  updateUphillSlowdown,
  uphillSpeedScale,
  type UphillSlowdownState,
} from "./uphillSlowdown";
import type { LocomotionInput } from "./locomotionAnimation";

export const CHARACTER_MOVEMENT_SUBSYSTEM_ID = "characterMovement";

interface CharacterMovementRuntime {
  id: EntityId;
  transform: TransformComponent;
  movement: CharacterMovementComponent;
  capsule: CharacterCapsuleResolution;
}

interface CharacterVertical {
  state: VerticalMotionState;
  floorY: number;
  /** Smoothed climb slope driving the uphill walk slowdown. */
  climb: UphillSlowdownState;
  /** Previous frame's raw ground-probe target height (null when not grounded on a probe). */
  lastGroundTargetY: number | null;
}

/** Per-frame snapshot of the moving platforms relevant to one character. */
interface PlatformContext {
  /** Current world AABBs of every live platform (blockers + ground surfaces). */
  readonly aabbs: readonly Aabb3[];
  /** Movement of the platform the character rides this frame (zero if none). */
  readonly carry: readonly [number, number, number];
}

const EMPTY_PLATFORM_CONTEXT: PlatformContext = { aabbs: [], carry: [0, 0, 0] };

export interface CharacterMoveIntent {
  /** World-space X/Z direction. It is normalized by the subsystem before use. */
  readonly direction: readonly [number, number];
  /** Units per second. When absent, the character's authored walk speed is used. */
  readonly speed?: number;
  readonly jump?: boolean;
}

export interface CharacterMovementSubsystemOptions {
  getGravityY?: () => number;
  getControlYaw?: (entityId: EntityId) => number | null | undefined;
  isPlayerControlled?: (entityId: EntityId) => boolean;
  getMoveIntent?: (
    entityId: EntityId,
    transform: Readonly<TransformComponent>,
    deltaSeconds: number,
  ) => CharacterMoveIntent | null | undefined;
  reportLocomotion?: (entityId: EntityId, report: LocomotionInput) => void;
  /** Dynamic character/kinematic AABBs that should block planar movement. */
  dynamicBlockers?: (
    entityId: EntityId,
    transform: Readonly<TransformComponent>,
  ) => readonly Aabb3[];
  /** Live kinematic platforms the character can stand on, collide with, and ride. */
  platforms?: MovingPlatformQuery;
}

const DEFAULT_GRAVITY_Y = -9.81;
const DEFAULT_MAX_STEP_HEIGHT = 0.45;
const DEFAULT_MAX_STEP_DOWN = 0.5;
/**
 * Upper bound on the slope angle used to scale the ground-follow down-probe with
 * this frame's horizontal travel. Walkable landscape surfaces only exist up to the
 * physics wall gate (~50°), so clamping here keeps `tan()` bounded and stops a huge
 * configured slope limit from snapping the pawn down a genuine ledge far below.
 */
const GROUND_SNAP_MAX_SLOPE_DEG = 55;
const ZERO_DELTA: readonly [number, number, number] = [0, 0, 0];
/** Horizontal knockback damping (per second) and the speed below which it stops. */
const LAUNCH_HORIZONTAL_DAMPING = 4;
const LAUNCH_MIN_SPEED = 0.05;
/**
 * Downhill slide (Öneri C) applied while grounded on a surface steeper than the
 * character's slope limit: gravity along the slope accelerates the pawn downhill,
 * damped toward a terminal speed. The damping also bleeds the slide away once the
 * pawn reaches walkable ground, and the pawn stops once it drops below the min.
 */
const SLIDE_DAMPING = 3;
const SLIDE_MIN_SPEED = 0.05;

export class CharacterMovementSubsystem implements Subsystem {
  readonly id = CHARACTER_MOVEMENT_SUBSYSTEM_ID;
  private runtimes: CharacterMovementRuntime[] = [];
  private vertical = new Map<EntityId, CharacterVertical>();
  /**
   * Last-frame world velocity (units/s) per character, from the applied position
   * delta. Feeds the runtime `world.velocityOf` provider (A6, Unreal GetVelocity).
   */
  private velocity = new Map<EntityId, [number, number, number]>();
  /**
   * Active horizontal knockback velocity (units/s) per character from
   * {@link launch} (A6 LaunchCharacter); decays each frame and is applied on top
   * of input movement. Vertical launch feeds the existing vertical-motion state.
   */
  private launchXZ = new Map<EntityId, [number, number]>();
  /**
   * Active downhill slide velocity (units/s) per character from standing on a
   * too-steep surface (Öneri C). Accumulates under gravity along the slope and
   * decays once the pawn reaches walkable ground.
   */
  private slideXZ = new Map<EntityId, [number, number]>();
  private readonly getGravityY: () => number;
  private readonly getControlYaw: (entityId: EntityId) => number | null | undefined;
  private readonly isPlayerControlled: (entityId: EntityId) => boolean;
  private readonly getMoveIntent:
    | ((
        entityId: EntityId,
        transform: Readonly<TransformComponent>,
        deltaSeconds: number,
      ) => CharacterMoveIntent | null | undefined)
    | undefined;
  private readonly reportLocomotion: ((entityId: EntityId, report: LocomotionInput) => void) | undefined;
  private readonly dynamicBlockers:
    | ((entityId: EntityId, transform: Readonly<TransformComponent>) => readonly Aabb3[])
    | undefined;
  private readonly platforms: MovingPlatformQuery | undefined;

  constructor(
    private readonly actions: ActionMap,
    private readonly sink: TransformSink,
    private readonly physics?: PhysicsQuery,
    options: CharacterMovementSubsystemOptions = {},
  ) {
    this.getGravityY = options.getGravityY ?? (() => DEFAULT_GRAVITY_Y);
    this.getControlYaw = options.getControlYaw ?? (() => null);
    this.isPlayerControlled = options.isPlayerControlled ?? (() => true);
    this.getMoveIntent = options.getMoveIntent;
    this.reportLocomotion = options.reportLocomotion;
    this.dynamicBlockers = options.dynamicBlockers;
    this.platforms = options.platforms;
  }

  setEntities(entities: readonly Entity[]): void {
    this.vertical.clear();
    this.velocity.clear();
    this.launchXZ.clear();
    this.slideXZ.clear();
    this.runtimes = [];
    for (const entity of entities) {
      const transform = readTransformComponent(entity);
      const movement = readCharacterMovementComponent(entity);
      if (!transform || !movement) continue;
      this.runtimes.push({
        id: entity.id,
        transform: cloneTransform(transform),
        movement,
        capsule: resolveCharacterCapsule(entity),
      });
    }
  }

  clear(): void {
    this.runtimes = [];
    this.vertical.clear();
    this.velocity.clear();
    this.launchXZ.clear();
    this.slideXZ.clear();
  }

  resetEntityTransform(entityId: EntityId, transform: TransformComponent): void {
    const runtime = this.runtimes.find((entry) => entry.id === entityId);
    if (!runtime) return;
    runtime.transform = cloneTransform(transform);
    this.vertical.set(entityId, freshVertical(transform.position[1]));
    // A teleport/respawn is not motion; drop stale velocity so a probe after the
    // jump doesn't read the warp distance as a huge one-frame speed. Any active
    // knockback is cancelled too — a respawned pawn starts at rest.
    this.velocity.delete(entityId);
    this.launchXZ.delete(entityId);
    this.slideXZ.delete(entityId);
  }

  update(engine: EngineUpdateContext): void {
    for (const runtime of this.runtimes) {
      const input = this.movementInput(runtime, engine);
      if (!input) continue;
      const prevX = runtime.transform.position[0];
      const prevY = runtime.transform.position[1];
      const prevZ = runtime.transform.position[2];
      this.updateRuntime(runtime, engine, input);
      if (engine.deltaSeconds > 0) {
        this.velocity.set(runtime.id, [
          (runtime.transform.position[0] - prevX) / engine.deltaSeconds,
          (runtime.transform.position[1] - prevY) / engine.deltaSeconds,
          (runtime.transform.position[2] - prevZ) / engine.deltaSeconds,
        ]);
      }
      this.sink(runtime.id, runtime.transform);
    }
  }

  /**
   * Last-frame world velocity (units/s) of a character, or null if it has none yet
   * (not a character, unpossessed, or not yet ticked). Backs the runtime
   * `world.velocityOf` provider (A6).
   */
  velocityOf(entityId: EntityId): readonly [number, number, number] | null {
    return this.velocity.get(entityId) ?? null;
  }

  /** Current runtime transform of a character (including kinematic movement), or null. */
  transformOf(entityId: EntityId): TransformComponent | null {
    const runtime = this.runtimes.find((entry) => entry.id === entityId);
    return runtime ? cloneTransform(runtime.transform) : null;
  }

  /**
   * Iterates every live character's id + current transform without cloning
   * (read-only). Backs the AI separation steering's neighbor scan.
   */
  forEachCharacter(
    callback: (entityId: EntityId, transform: Readonly<TransformComponent>) => void,
  ): void {
    for (const runtime of this.runtimes) callback(runtime.id, runtime.transform);
  }

  /**
   * Launches a character (A6 LaunchCharacter / knockback): an upward launch drives
   * the vertical-motion state so it goes airborne and arcs under gravity, while the
   * horizontal launch becomes a decaying knockback applied on top of input each
   * frame. Additive by default; {@link LaunchOptions} overrides a component
   * (`xyOverride` horizontal, `zOverride` vertical). No-op for a non-character id.
   */
  launch(
    entityId: EntityId,
    velocity: readonly [number, number, number],
    options: LaunchOptions = {},
  ): void {
    const runtime = this.runtimes.find((entry) => entry.id === entityId);
    if (!runtime) return;
    let vertical = this.vertical.get(entityId);
    if (!vertical) {
      vertical = freshVertical(runtime.transform.position[1]);
      this.vertical.set(entityId, vertical);
    }
    const currentVy = vertical.state.grounded ? 0 : vertical.state.velocityY;
    const nextVy = options.zOverride ? velocity[1] : currentVy + velocity[1];
    if (nextVy > 0) {
      // Go airborne with the upward launch; the existing landing logic lands it.
      vertical.state = { y: runtime.transform.position[1], velocityY: nextVy, grounded: false };
    } else if (!vertical.state.grounded) {
      vertical.state = { ...vertical.state, velocityY: nextVy };
    }
    const prev = this.launchXZ.get(entityId) ?? [0, 0];
    this.launchXZ.set(
      entityId,
      options.xyOverride
        ? [velocity[0], velocity[2]]
        : [prev[0] + velocity[0], prev[1] + velocity[2]],
    );
  }

  dispose(): void {
    this.clear();
  }

  private updateRuntime(
    runtime: CharacterMovementRuntime,
    engine: EngineUpdateContext,
    input: RuntimeMovementInput,
  ): void {
    const movement = runtime.movement;
    const controlYaw = input.controlYaw;
    const planar = input.planar;
    // Snapshot the live platforms once so blocker/probe/carry all see the same
    // frame (the platform subsystem already ticked this frame's motion).
    const platformCtx = this.platformContext(runtime);
    // The player's own move resolves first (and drives facing); the platform then
    // carries the rider horizontally, resolved too so it can't shove through a wall.
    const { dx, dz } = this.resolvePlanarAgainstBlockers(runtime, planar, platformCtx.aabbs);
    runtime.transform.position[0] += dx;
    runtime.transform.position[2] += dz;
    if (platformCtx.carry[0] !== 0 || platformCtx.carry[2] !== 0) {
      const carried = this.resolvePlanarAgainstBlockers(
        runtime,
        { dx: platformCtx.carry[0], dz: platformCtx.carry[2] },
        platformCtx.aabbs,
      );
      runtime.transform.position[0] += carried.dx;
      runtime.transform.position[2] += carried.dz;
    }
    // Knockback (A6 LaunchCharacter): a decaying horizontal launch velocity is
    // applied on top of input/carry, resolved against blockers so it can't push
    // through a wall. Facing follows the player's own move (dx/dz), not knockback.
    this.applyLaunchHorizontal(runtime, engine, platformCtx.aabbs);
    const yaw = facingYawFromMove(dx, dz);
    let targetYaw: number | null = null;
    if (
      movement.orientRotationToControl &&
      typeof controlYaw === "number" &&
      Number.isFinite(controlYaw)
    ) {
      targetYaw = controlYawToCharacterYaw(controlYaw);
    } else if (movement.orientRotationToMovement && yaw !== null) {
      targetYaw = yaw;
    }
    if (targetYaw !== null) {
      const yawRate = Math.max(0, movement.rotationRate[2]);
      runtime.transform.rotation[1] = rotateYawToward(
        runtime.transform.rotation[1],
        targetYaw,
        yawRate * engine.deltaSeconds,
      );
    }

    const vertical = this.updateVertical(runtime, engine, Math.hypot(dx, dz), platformCtx, input.jump);
    this.reportLocomotion?.(runtime.id, {
      planarSpeed:
        engine.deltaSeconds > 0 ? Math.hypot(planar.dx, planar.dz) / engine.deltaSeconds : 0,
      grounded: vertical.grounded,
      velocityY: vertical.velocityY,
    });
  }

  private updateVertical(
    runtime: CharacterMovementRuntime,
    engine: EngineUpdateContext,
    planarDistance: number,
    platformCtx: PlatformContext,
    jump: boolean,
  ): VerticalMotionState {
    const movement = runtime.movement;
    if (movement.movementMode !== "walking" && movement.movementMode !== "falling") {
      return { y: runtime.transform.position[1], velocityY: 0, grounded: true };
    }
    let vertical = this.vertical.get(runtime.id);
    if (!vertical) {
      vertical = freshVertical(runtime.transform.position[1]);
      this.vertical.set(runtime.id, vertical);
    }
    const previousY = vertical.state.y;
    const ground = this.groundAt(runtime, platformCtx.aabbs, planarDistance);
    // Measure the climb from the raw probe targets (not the smoothed floor), so
    // the uphill slowdown sees the true geometry. Airborne or probe-less frames
    // feed a flat sample, decaying the slowdown back toward full speed. A rising
    // platform's carry is subtracted so riding an elevator isn't read as climbing.
    const climbGround =
      vertical.state.grounded && !jump ? ground : null;
    const floorRise =
      climbGround && vertical.lastGroundTargetY !== null
        ? climbGround.floorY - vertical.lastGroundTargetY - platformCtx.carry[1]
        : 0;
    vertical.climb = updateUphillSlowdown(
      vertical.climb,
      floorRise,
      planarDistance,
      engine.deltaSeconds,
    );
    vertical.lastGroundTargetY = climbGround ? climbGround.floorY : null;
    if (vertical.state.grounded) {
      if (jump) {
        vertical.floorY = ground?.floorY ?? vertical.floorY;
      } else if (ground) {
        // Keep authored step smoothing for flat blocker tops, but never let it
        // accumulate a gap above a walkable trimesh surface. On a fast descent,
        // a landscape can fall faster than `stepSmoothSpeed`; easing then leaves
        // the pawn suspended above the slope until the next probe misses it and
        // incorrectly starts falling. A walkable surface is continuous support,
        // so its downward height is safe to follow exactly. Steep surfaces remain
        // non-walkable and keep their slide behaviour below.
        const followsWalkableSlope =
          ground.walkable && ground.blocker === null && ground.floorY < vertical.floorY;
        vertical.floorY = followsWalkableSlope
          ? ground.floorY
          : approachHeight(
              vertical.floorY,
              ground.floorY,
              movement.stepSmoothSpeed * engine.deltaSeconds,
            );
        vertical.state = groundedAt(vertical.floorY);
      } else if (!this.hasGroundProbe()) {
        vertical.state = groundedAt(vertical.floorY);
      } else {
        vertical.floorY = previousY;
        vertical.state = { y: previousY, velocityY: 0, grounded: false };
      }
    }
    vertical.state = stepVerticalMotion(vertical.state, {
      gravityY: this.getGravityY() * movement.gravityScale,
      jumpSpeed: movement.jumpSpeed,
      floorY: vertical.state.grounded ? vertical.floorY : null,
      dt: engine.deltaSeconds,
      jump,
    });
    if (!vertical.state.grounded) {
      const landing = this.landingGround(
        runtime,
        previousY,
        vertical.state.y,
        platformCtx.aabbs,
        planarDistance,
      );
      if (landing) {
        vertical.floorY = landing.floorY;
        vertical.state = groundedAt(landing.floorY);
      } else if (
        !this.hasGroundProbe() &&
        previousY >= vertical.floorY &&
        vertical.state.y <= vertical.floorY
      ) {
        vertical.state = groundedAt(vertical.floorY);
      }
    }
    runtime.transform.position[1] = vertical.state.y;
    this.applySteepSlide(runtime, engine, ground, vertical.state.grounded, platformCtx.aabbs);
    return vertical.state;
  }

  /**
   * Downhill slide off a too-steep surface (Öneri C). While grounded on a
   * non-walkable slope, gravity along the incline accelerates the pawn downhill
   * (direction from the surface normal's horizontal component), damped toward a
   * terminal speed and resolved against walls. On walkable ground / airborne the
   * accumulated slide simply decays, so the pawn coasts to a stop once it reaches a
   * surface it can stand on.
   */
  private applySteepSlide(
    runtime: CharacterMovementRuntime,
    engine: EngineUpdateContext,
    ground: GroundHit | null,
    grounded: boolean,
    platformAabbs: readonly Aabb3[],
  ): void {
    const dt = Math.max(0, engine.deltaSeconds);
    const prev = this.slideXZ.get(runtime.id) ?? [0, 0];
    let sx = prev[0];
    let sz = prev[1];
    const normal = ground?.slopeNormal;
    if (grounded && ground && ground.walkable === false && normal) {
      const horiz = Math.hypot(normal[0], normal[2]);
      if (horiz > 1e-4) {
        // Horizontal projection of an up-facing normal points downhill; gravity's
        // component along the slope is `g·sinθ`, and its horizontal part `g·sinθ·cosθ`.
        const sinT = Math.min(1, horiz);
        const cosT = Math.max(0, normal[1]);
        const accel = Math.abs(this.getGravityY() * runtime.movement.gravityScale) * sinT * cosT;
        sx += (normal[0] / horiz) * accel * dt;
        sz += (normal[2] / horiz) * accel * dt;
      }
    }
    const damp = Math.exp(-SLIDE_DAMPING * dt);
    sx *= damp;
    sz *= damp;
    if (Math.hypot(sx, sz) < SLIDE_MIN_SPEED) {
      this.slideXZ.delete(runtime.id);
      return;
    }
    this.slideXZ.set(runtime.id, [sx, sz]);
    if (dt > 0) {
      const moved = this.resolvePlanarAgainstBlockers(runtime, { dx: sx * dt, dz: sz * dt }, platformAabbs);
      runtime.transform.position[0] += moved.dx;
      runtime.transform.position[2] += moved.dz;
    }
  }

  /** Applies + decays this frame's horizontal knockback (A6 LaunchCharacter). */
  private applyLaunchHorizontal(
    runtime: CharacterMovementRuntime,
    engine: EngineUpdateContext,
    platformAabbs: readonly Aabb3[],
  ): void {
    const launch = this.launchXZ.get(runtime.id);
    if (!launch) return;
    const dt = Math.max(0, engine.deltaSeconds);
    if (dt > 0) {
      const moved = this.resolvePlanarAgainstBlockers(
        runtime,
        { dx: launch[0] * dt, dz: launch[1] * dt },
        platformAabbs,
      );
      runtime.transform.position[0] += moved.dx;
      runtime.transform.position[2] += moved.dz;
    }
    const decay = Math.exp(-LAUNCH_HORIZONTAL_DAMPING * dt);
    const nx = launch[0] * decay;
    const nz = launch[1] * decay;
    if (Math.hypot(nx, nz) < LAUNCH_MIN_SPEED) this.launchXZ.delete(runtime.id);
    else this.launchXZ.set(runtime.id, [nx, nz]);
  }

  private resolvePlanarAgainstBlockers(
    runtime: CharacterMovementRuntime,
    planar: PlanarDelta,
    platformAabbs: readonly Aabb3[],
  ): PlanarDelta {
    if (!this.physics) return planar;
    const footY = runtime.transform.position[1];
    const stepUp = this.maxStepHeight(runtime);
    // Filter both channels: a blocker whose top is within step height (the ground
    // you stand on, including the platform under your feet) is not a wall, so
    // carry along it isn't self-blocked; a taller side is.
    const staticBlockers = filterWalkableBlockers(footY, this.physics.staticBlockerAabbs(), stepUp);
    const dynamicBlockers = this.dynamicBlockers?.(runtime.id, runtime.transform) ?? [];
    const blockers =
      platformAabbs.length > 0 || dynamicBlockers.length > 0
        ? [
            ...staticBlockers,
            ...filterWalkableBlockers(footY, platformAabbs, stepUp),
            ...filterWalkableBlockers(footY, dynamicBlockers, stepUp),
          ]
        : staticBlockers;
    if (blockers.length === 0) return planar;
    const half = this.physics.colliderHalfExtents(runtime.id);
    if (!half) return planar;
    const centerPosition: [number, number, number] = [
      runtime.transform.position[0],
      runtime.transform.position[1] + half[1],
      runtime.transform.position[2],
    ];
    // Substep the resolve so a fast move / dt spike can't tunnel a thin wall.
    return resolvePlanarMovementSubstepped(
      centerPosition,
      planar,
      half,
      blockers,
      safeSubstepLength(blockers),
    );
  }

  private groundAt(
    runtime: CharacterMovementRuntime,
    platformAabbs: readonly Aabb3[],
    planarDistance: number,
  ) {
    const blockers = this.groundBlockers(platformAabbs);
    const surfaces = this.groundSurfacesAt(runtime.transform.position);
    if (blockers.length === 0 && surfaces.length === 0) return null;
    return findGroundAt(
      runtime.transform.position,
      blockers,
      this.groundOptions(runtime, surfaces, planarDistance),
    );
  }

  private landingGround(
    runtime: CharacterMovementRuntime,
    previousY: number,
    nextY: number,
    platformAabbs: readonly Aabb3[],
    planarDistance: number,
  ) {
    const blockers = this.groundBlockers(platformAabbs);
    const surfaces = this.groundSurfacesAt(runtime.transform.position);
    if (blockers.length === 0 && surfaces.length === 0) return null;
    return findLandingGround(
      previousY,
      nextY,
      runtime.transform.position,
      blockers,
      this.groundOptions(runtime, surfaces, planarDistance),
    );
  }

  /** Static blockers plus the current moving-platform AABBs (both are standable tops). */
  private groundBlockers(platformAabbs: readonly Aabb3[]): readonly Aabb3[] {
    const staticBlockers = this.physics?.staticBlockerAabbs() ?? [];
    if (platformAabbs.length === 0) return staticBlockers;
    return [...staticBlockers, ...platformAabbs];
  }

  /** Uses the physics spatial broad phase when available; older query hosts keep the full-list fallback. */
  private groundSurfacesAt(position: readonly [number, number, number]) {
    return this.physics?.staticSurfaceTrianglesNear?.(position[0], position[2]) ?? this.physics?.staticSurfaceTriangles() ?? [];
  }

  /**
   * Snapshots the live platforms for this frame: their AABBs (blockers + ground)
   * and the carry delta of whichever platform the character is standing on.
   */
  private platformContext(runtime: CharacterMovementRuntime): PlatformContext {
    const states = this.platforms?.platforms() ?? [];
    if (states.length === 0) return EMPTY_PLATFORM_CONTEXT;
    const aabbs = states.map((state) => state.aabb as Aabb3);
    return { aabbs, carry: this.carryDelta(runtime, states, aabbs) };
  }

  /**
   * The this-frame movement of the platform the character rides, or zero. A rider
   * must be grounded and the platform must win the ground probe (be the highest
   * surface under the feet) — so standing on a static floor above a passing
   * platform doesn't carry.
   */
  private carryDelta(
    runtime: CharacterMovementRuntime,
    states: readonly PlatformState[],
    platformAabbs: readonly Aabb3[],
  ): readonly [number, number, number] {
    const vertical = this.vertical.get(runtime.id);
    if (vertical && !vertical.state.grounded) return ZERO_DELTA;
    // A support check at the current position (no fast descent), so the base
    // step-down suffices — pass zero planar travel.
    const ground = this.groundAt(runtime, platformAabbs, 0);
    if (!ground || !ground.blocker) return ZERO_DELTA;
    const state = states.find((candidate) => candidate.aabb === ground.blocker);
    return state ? state.delta : ZERO_DELTA;
  }

  private groundOptions(
    runtime: CharacterMovementRuntime,
    surfaces: ReturnType<NonNullable<PhysicsQuery["staticSurfaceTriangles"]>>,
    planarDistance: number,
  ) {
    return {
      footprintHalf: this.footprintHalf(runtime),
      maxStepUp: this.maxStepHeight(runtime),
      maxStepDown: this.groundSnapDown(runtime, planarDistance),
      surfaces,
      maxSlopeCos: slopeCosFromDegrees(runtime.movement.maxSlopeAngleDeg),
    };
  }

  /**
   * Downward ground-follow distance for this frame. The base `maxStepDown` covers
   * standing and small steps; on a descending slope the surface drops by up to
   * `planarDistance * tan(slopeLimit)` in one frame, so a fast (running) move can
   * fall more than the fixed base below the feet and lose the floor — launching the
   * pawn off the incline. Scaling the probe by the horizontal travel keeps it glued
   * to any walkable slope at any speed; the slope angle is clamped
   * ({@link GROUND_SNAP_MAX_SLOPE_DEG}) so `tan()` stays bounded and the pawn can't
   * be snapped down a real ledge/cliff far below.
   */
  private groundSnapDown(runtime: CharacterMovementRuntime, planarDistance: number): number {
    const base = this.maxStepDown(runtime);
    if (!(planarDistance > 0)) return base;
    const slopeDeg = Math.min(Math.max(runtime.movement.maxSlopeAngleDeg, 0), GROUND_SNAP_MAX_SLOPE_DEG);
    return base + planarDistance * Math.tan((slopeDeg * Math.PI) / 180);
  }

  private hasGroundProbe(): boolean {
    const blockers = this.physics?.staticBlockerAabbs();
    if (blockers && blockers.length > 0) return true;
    const surfaces = this.physics?.staticSurfaceTriangles();
    if (surfaces && surfaces.length > 0) return true;
    return (this.platforms?.platforms().length ?? 0) > 0;
  }

  private footprintHalf(runtime: CharacterMovementRuntime): [number, number] {
    const radius = Math.max(runtime.capsule.radius, 0.001);
    return [radius, radius];
  }

  private maxStepHeight(runtime: CharacterMovementRuntime): number {
    return Math.max(runtime.movement.maxStepHeight ?? DEFAULT_MAX_STEP_HEIGHT, 0);
  }

  private maxStepDown(runtime: CharacterMovementRuntime): number {
    return Math.max(runtime.movement.maxStepDown ?? DEFAULT_MAX_STEP_DOWN, 0);
  }

  private uphillScale(runtime: CharacterMovementRuntime): number {
    const vertical = this.vertical.get(runtime.id);
    if (!vertical) return 1;
    return uphillSpeedScale(vertical.climb, runtime.movement.uphillSpeedScale ?? 1);
  }

  private movementInput(
    runtime: CharacterMovementRuntime,
    engine: EngineUpdateContext,
  ): RuntimeMovementInput | null {
    const playerControlled = this.isPlayerControlled(runtime.id);
    if (playerControlled) return this.playerMovementInput(runtime, engine);
    const intent = this.getMoveIntent?.(
      runtime.id,
      cloneTransform(runtime.transform),
      engine.deltaSeconds,
    );
    if (!intent) return null;
    return this.intentMovementInput(runtime, engine, intent);
  }

  private playerMovementInput(
    runtime: CharacterMovementRuntime,
    engine: EngineUpdateContext,
  ): RuntimeMovementInput {
    const movement = runtime.movement;
    const climbScale = this.uphillScale(runtime);
    const speed =
      (this.actions.held("sprint")
        ? movement.maxWalkSpeed * movement.sprintMultiplier
        : movement.maxWalkSpeed) * climbScale;
    const held = {
      forward: this.actions.held("move-forward"),
      back: this.actions.held("move-back"),
      left: this.actions.held("move-left"),
      right: this.actions.held("move-right"),
    };
    const controlYaw = this.getControlYaw(runtime.id);
    const planar =
      typeof controlYaw === "number" && Number.isFinite(controlYaw)
        ? planarMoveStepRelativeToYaw(held, speed, engine.deltaSeconds, controlYaw)
        : planarMoveStep(held, speed, engine.deltaSeconds);
    return { planar, jump: this.actions.pressed("jump"), controlYaw };
  }

  private intentMovementInput(
    runtime: CharacterMovementRuntime,
    engine: EngineUpdateContext,
    intent: CharacterMoveIntent,
  ): RuntimeMovementInput {
    const [rawX, rawZ] = intent.direction;
    const magnitude = Math.hypot(rawX, rawZ);
    const speed =
      (typeof intent.speed === "number" && Number.isFinite(intent.speed)
        ? Math.max(0, intent.speed)
        : runtime.movement.maxWalkSpeed) * this.uphillScale(runtime);
    const distance = speed * engine.deltaSeconds;
    const planar =
      magnitude > 0 && distance > 0
        ? { dx: (rawX / magnitude) * distance, dz: (rawZ / magnitude) * distance }
        : { dx: 0, dz: 0 };
    return { planar, jump: intent.jump === true, controlYaw: this.getControlYaw(runtime.id) };
  }
}

interface RuntimeMovementInput {
  readonly planar: PlanarDelta;
  readonly jump: boolean;
  readonly controlYaw: number | null | undefined;
}

function controlYawToCharacterYaw(yaw: number): number {
  return facingYawFromMove(-Math.sin(yaw), -Math.cos(yaw)) ?? 0;
}

function freshVertical(floorY: number): CharacterVertical {
  return {
    state: groundedAt(floorY),
    floorY,
    climb: UPHILL_SLOWDOWN_REST,
    lastGroundTargetY: null,
  };
}

/** Moves `current` toward `target` by at most `maxDelta`; a non-positive `maxDelta` snaps. */
function approachHeight(current: number, target: number, maxDelta: number): number {
  if (!(maxDelta > 0)) return target;
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}
