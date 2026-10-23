/**
 * Runtime path-following for Generic Spline Actors.
 *
 * The motion math intentionally has no Three.js dependency. A small subsystem
 * reads authored entity components, advances travelled world distance, and
 * pushes the sampled transform through the same sink used by other runtime
 * movers. This keeps it usable by game code as well as Play mode.
 */
import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import type { Entity, EntityId } from "./entity";
import {
  readAIControllerComponent,
  readSplinePathFollowerComponent,
  readTransformComponent,
  type SplinePathFollowerComponent,
  type TransformComponent,
} from "./components";
import type { Vec3 } from "./layout";
import type { SplineQuery, SplineRegistry } from "./splineRegistry";

export const SPLINE_PATH_FOLLOWER_SUBSYSTEM_ID = "splinePathFollower";

export type SplinePathWrapMode = "clamp" | "loop" | "pingPong";

export interface SplinePathFollowerState {
  /** Unwrapped signed travel distance. It preserves seamless loop/ping-pong motion. */
  distance: number;
}

export interface SplinePathFollowerSample {
  readonly distance: number;
  readonly position: Vec3;
  readonly rotation: Vec3;
}

export interface SplinePathFollowerDebugState {
  readonly entityId: EntityId;
  readonly splineId: string;
  readonly distance: number;
  readonly missingSpline: boolean;
}

/** Advances unwrapped world distance; `speed` is always world units per second. */
export function advanceSplinePathFollower(
  state: SplinePathFollowerState,
  component: SplinePathFollowerComponent,
  deltaSeconds: number,
): SplinePathFollowerState {
  if (!component.enabled || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || component.speed <= 0) {
    return { distance: state.distance };
  }
  const sign = component.reverse ? -1 : 1;
  return { distance: state.distance + component.speed * deltaSeconds * sign };
}

/** Maps a follower's unwrapped travel to its spline according to its wrap mode. */
export function splinePathFollowerDistance(
  distance: number,
  length: number,
  wrapMode: SplinePathWrapMode,
): number {
  if (!(length > 1e-8) || !Number.isFinite(distance)) return 0;
  if (wrapMode === "clamp") return clamp(distance, 0, length);
  if (wrapMode === "loop") return mod(distance, length);
  const cycle = mod(distance, length * 2);
  return cycle <= length ? cycle : length * 2 - cycle;
}

/** Samples position and Forge XYZ Euler rotation for a runtime follower. */
export function sampleSplinePathFollower(
  query: SplineQuery,
  state: SplinePathFollowerState,
  component: SplinePathFollowerComponent,
  fallbackRotation: readonly [number, number, number] = [0, 0, 0],
): SplinePathFollowerSample {
  const distance = splinePathFollowerDistance(state.distance, query.getLength(), component.wrapMode);
  const transform = query.getTransformAtDistance(distance, "world");
  const direction = component.reverse
    ? negate(transform.frame.tangent)
    : transform.frame.tangent;
  const horizontalLength = Math.hypot(direction[0], direction[2]);
  const splineRotation: Vec3 = [
    (component.applyPitch ? radiansToDegrees(Math.atan2(-direction[1], horizontalLength)) : 0) + component.orientationOffset[0],
    radiansToDegrees(Math.atan2(direction[0], direction[2])) + component.orientationOffset[1],
    (component.applyRoll ? transform.frame.roll : 0) + component.orientationOffset[2],
  ];
  return {
    distance,
    position: add(transform.position, component.positionOffset),
    rotation: component.orientToSpline ? splineRotation : [...fallbackRotation],
  };
}

interface SplinePathFollowerRuntime {
  readonly entityId: EntityId;
  readonly component: SplinePathFollowerComponent;
  readonly transform: TransformComponent;
  state: SplinePathFollowerState;
  missingSpline: boolean;
}

/** Drives entity transforms from a runtime spline registry. Missing references safely leave transforms untouched. */
export class SplinePathFollowerSubsystem implements Subsystem {
  readonly id = SPLINE_PATH_FOLLOWER_SUBSYSTEM_ID;
  private runtimes: SplinePathFollowerRuntime[] = [];

  constructor(
    private readonly registry: () => SplineRegistry,
    private readonly sink?: (entityId: EntityId, transform: TransformComponent) => void,
  ) {}

  setEntities(entities: readonly Entity[]): void {
    this.runtimes = [];
    for (const entity of entities) this.trackEntity(entity);
  }

  addEntity(entity: Entity): void {
    if (this.runtimes.some((runtime) => runtime.entityId === entity.id)) return;
    this.trackEntity(entity);
  }

  removeEntity(entityId: EntityId): void {
    this.runtimes = this.runtimes.filter((runtime) => runtime.entityId !== entityId);
  }

  private trackEntity(entity: Entity): void {
    const component = readSplinePathFollowerComponent(entity);
    const transform = readTransformComponent(entity);
    if (!component || !transform) return;
    // AI spline patrol owns movement through navigation + CharacterMovement;
    // a direct follower here would overwrite that result after every frame.
    if (readAIControllerComponent(entity)?.patrolRoute?.source === "spline") return;
    this.runtimes.push({
      entityId: entity.id,
      component,
      transform: cloneTransform(transform),
      state: { distance: component.startDistance },
      missingSpline: false,
    });
  }

  clear(): void {
    this.runtimes = [];
  }

  dispose(): void {
    this.clear();
  }

  followers(): readonly SplinePathFollowerDebugState[] {
    return this.runtimes.map((runtime) => ({
      entityId: runtime.entityId,
      splineId: runtime.component.splineId,
      distance: runtime.state.distance,
      missingSpline: runtime.missingSpline,
    }));
  }

  update(engine: EngineUpdateContext): void {
    const registry = this.registry();
    for (const runtime of this.runtimes) {
      const query = registry.getSplineById(runtime.component.splineId);
      runtime.missingSpline = !query;
      if (!query || !runtime.component.enabled) continue;
      runtime.state = advanceSplinePathFollower(runtime.state, runtime.component, engine.deltaSeconds);
      const sample = sampleSplinePathFollower(query, runtime.state, runtime.component, runtime.transform.rotation);
      runtime.transform.position = [...sample.position];
      runtime.transform.rotation = [...sample.rotation];
      this.sink?.(runtime.entityId, runtime.transform);
    }
  }
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return { position: [...transform.position], rotation: [...transform.rotation], scale: [...transform.scale] };
}

function negate(value: Vec3): Vec3 { return [-value[0], -value[1], -value[2]]; }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function mod(value: number, divisor: number): number { return ((value % divisor) + divisor) % divisor; }
function radiansToDegrees(value: number): number { return value * 180 / Math.PI; }
