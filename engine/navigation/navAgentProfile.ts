/**
 * Resolves the {@link NavAgent} pathfinding profile for an AI pawn from its
 * authored components. Pure engine module (no DOM/Three/editor imports) so the
 * host can call it and the engine test bundle can exercise it directly.
 *
 * Priority follows Unreal's Nav Agent contract: the authored AIController
 * `navAgent` radius/height is the explicit pathfinding footprint and wins when
 * present — it is deliberately independent of the collision capsule. Collider
 * half-extents are only a last-resort fallback, because they are a poor default
 * for scaled actors: an actor placed at scale 0.3 with a unit capsule reports its
 * *unscaled* full size (placement scale is not baked into an actor-script
 * collider), which would inflate the agent radius ~3x and erode narrow
 * ramps/corridors out of the baked grid — making an elevated Target Point look
 * unreachable even though movement can climb it.
 */
import type { NavAgent } from "./navigationTypes";

export interface NavAgentSizeConfig {
  readonly radius?: number;
  readonly height?: number;
  readonly clearancePadding?: number;
}

export interface NavAgentMovementConfig {
  readonly capsuleRadius?: number;
  readonly capsuleHalfHeight?: number;
  readonly maxStepHeight?: number;
  readonly maxStepDown?: number;
  readonly maxSlopeAngleDeg?: number;
}

export interface NavAgentProfileInputs {
  /** Authored AIController `navAgent` size (Unreal Nav Agent), highest priority. */
  readonly navAgent?: NavAgentSizeConfig | undefined;
  /** CharacterMovement capsule + step/slope limits. */
  readonly movement?: NavAgentMovementConfig | undefined;
  /** Physics collider half-extents (last-resort size fallback; may be unscaled). */
  readonly colliderHalfExtents?: readonly [number, number, number] | null;
}

const DEFAULT_RADIUS = 0.35;
const DEFAULT_HEIGHT = 1.8;
const DEFAULT_STEP_HEIGHT = 0.45;
const DEFAULT_STEP_DOWN = 0.5;
const DEFAULT_SLOPE_DEG = 50;

export function resolveNavAgentProfile(inputs: NavAgentProfileInputs): NavAgent {
  const { navAgent, movement, colliderHalfExtents: half } = inputs;
  const radius =
    finitePositive(navAgent?.radius) ??
    (half ? Math.max(half[0], half[2]) : undefined) ??
    finitePositive(movement?.capsuleRadius) ??
    DEFAULT_RADIUS;
  const height =
    finitePositive(navAgent?.height) ??
    (half ? half[1] * 2 : undefined) ??
    finitePositive(movement ? movement.capsuleHalfHeight ?? NaN : undefined, (v) => v * 2) ??
    DEFAULT_HEIGHT;
  return {
    radius: Math.max(radius, 0.01),
    height: Math.max(height, 0.01),
    stepHeight: movement?.maxStepHeight ?? DEFAULT_STEP_HEIGHT,
    maxStepDown: movement?.maxStepDown ?? DEFAULT_STEP_DOWN,
    maxSlopeAngleDeg: movement?.maxSlopeAngleDeg ?? DEFAULT_SLOPE_DEG,
    ...(typeof navAgent?.clearancePadding === "number" ? { clearancePadding: navAgent.clearancePadding } : {}),
  };
}

function finitePositive(value: number | undefined, map?: (v: number) => number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return map ? map(value) : value;
}
