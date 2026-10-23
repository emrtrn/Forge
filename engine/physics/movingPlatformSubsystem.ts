/**
 * Drives kinematic moving platforms and exposes their per-frame state to the
 * character movement solver.
 *
 * A platform ping-pongs along its authored segment (see {@link movingPlatform});
 * this subsystem accumulates elapsed time, moves each platform's transform, syncs
 * it to render + physics via the {@link PhysicsTransformSink}, and publishes each
 * platform's current world AABB and this-frame movement delta through
 * {@link MovingPlatformQuery}. The character movement system reads that to (a)
 * collide with the platform as a blocker, (b) stand on its top via the ground
 * probe, and (c) get carried horizontally when it moves.
 *
 * Registration order matters: this must tick *before* the character movement
 * subsystem so a rider is carried by the same frame's platform delta (no lag).
 * Only translation is driven — a platform keeps its authored rotation — so a
 * rider's carry is a pure position delta (angular carry is a separate backlog).
 */
import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import {
  readColliderComponent,
  readMovingPlatformComponent,
  readTransformComponent,
  type ColliderComponent,
  type TransformComponent,
} from "../scene/components";
import type { Entity, EntityId } from "../scene/entity";
import type { Vec3 } from "../scene/layout";
import type { PhysicsTransformSink } from "./physicsSubsystem";
import { rotatedBoxAabb } from "./rotatedBox";
import {
  initialElapsed,
  platformPositionAt,
  type MovingPlatformParams,
} from "./movingPlatform";

export const MOVING_PLATFORM_SUBSYSTEM_ID = "movingPlatform";

/** World-axis-aligned box (matches the collision solver's `Aabb3`/`PhysicsAabb`). */
export interface PlatformAabb {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** A platform's live state for one frame: where it is, and how far it just moved. */
export interface PlatformState {
  readonly id: EntityId;
  /** Current world AABB (blocker + ground surface). */
  readonly aabb: PlatformAabb;
  /** Movement applied this frame (carry delta for a rider standing on it). */
  readonly delta: readonly [number, number, number];
}

/** Read side consumed by the character movement solver. */
export interface MovingPlatformQuery {
  platforms(): readonly PlatformState[];
}

interface PlatformRuntime {
  readonly id: EntityId;
  readonly start: Vec3;
  readonly rotation: Vec3;
  readonly half: Vec3;
  readonly center: Vec3;
  readonly params: MovingPlatformParams;
  readonly transform: TransformComponent;
  elapsed: number;
  lastPosition: Vec3;
}

export class MovingPlatformSubsystem implements Subsystem, MovingPlatformQuery {
  readonly id = MOVING_PLATFORM_SUBSYSTEM_ID;
  private runtimes: PlatformRuntime[] = [];
  private states: PlatformState[] = [];

  constructor(private readonly sink?: PhysicsTransformSink) {}

  setEntities(entities: readonly Entity[]): void {
    this.runtimes = [];
    for (const entity of entities) this.trackEntity(entity);
    this.recomputeStates(true);
  }

  addEntity(entity: Entity): void {
    if (this.runtimes.some((runtime) => runtime.id === entity.id)) return;
    const runtime = this.trackEntity(entity);
    // Append only the new setup-frame state: existing carry deltas stay intact.
    if (runtime) this.states.push(this.stateFor(runtime, true));
  }

  removeEntity(entityId: EntityId): void {
    this.runtimes = this.runtimes.filter((runtime) => runtime.id !== entityId);
    this.states = this.states.filter((state) => state.id !== entityId);
  }

  private trackEntity(entity: Entity): PlatformRuntime | null {
    const platform = readMovingPlatformComponent(entity);
    const transform = readTransformComponent(entity);
    const collider = readColliderComponent(entity);
    if (!platform || !transform || !collider) return null;
    const start: Vec3 = [...transform.position];
    const params: MovingPlatformParams = {
      offset: platform.offset,
      speed: platform.speed,
      startPhase: platform.startPhase,
    };
    const elapsed = initialElapsed(params);
    const position = platformPositionAt(start, params, elapsed);
    const runtime: PlatformRuntime = {
      id: entity.id,
      start,
      rotation: [...transform.rotation],
      half: halfExtents(collider),
      center: [...(collider.center ?? [0, 0, 0])] as Vec3,
      params,
      transform: {
        position: [...position],
        rotation: [...transform.rotation],
        scale: [...transform.scale],
      },
      elapsed,
      lastPosition: [...position],
    };
    this.runtimes.push(runtime);
    return runtime;
  }

  clear(): void {
    this.runtimes = [];
    this.states = [];
  }

  platforms(): readonly PlatformState[] {
    return this.states;
  }

  update(engine: EngineUpdateContext): void {
    if (this.runtimes.length === 0) return;
    for (const runtime of this.runtimes) {
      runtime.elapsed += engine.deltaSeconds;
      const next = platformPositionAt(runtime.start, runtime.params, runtime.elapsed);
      runtime.lastPosition = [...runtime.transform.position];
      runtime.transform.position[0] = next[0];
      runtime.transform.position[1] = next[1];
      runtime.transform.position[2] = next[2];
      this.sink?.(runtime.id, runtime.transform);
    }
    this.recomputeStates(false);
  }

  dispose(): void {
    this.clear();
  }

  /** Rebuilds the published state list; `atRest` zeroes the delta (setup frame). */
  private recomputeStates(atRest: boolean): void {
    this.states = this.runtimes.map((runtime) => this.stateFor(runtime, atRest));
  }

  private stateFor(runtime: PlatformRuntime, atRest: boolean): PlatformState {
    const position = runtime.transform.position as Vec3;
    const aabb = rotatedBoxAabb(position, runtime.center, runtime.half, runtime.rotation);
    const delta: [number, number, number] = atRest
      ? [0, 0, 0]
      : [
          position[0] - runtime.lastPosition[0],
          position[1] - runtime.lastPosition[1],
          position[2] - runtime.lastPosition[2],
        ];
    return { id: runtime.id, aabb, delta };
  }
}

function halfExtents(collider: ColliderComponent): Vec3 {
  return [(collider.size[0] ?? 0) / 2, (collider.size[1] ?? 0) / 2, (collider.size[2] ?? 0) / 2];
}
