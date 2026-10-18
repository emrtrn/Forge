/**
 * Fixed-timestep accumulator for the rigid-body world ("Fix Your Timestep").
 *
 * The simulation always advances in `step`-sized slices regardless of the
 * render frame rate, so a 30 Hz and a 144 Hz machine run the same physics
 * (raycast vehicle suspension is especially sensitive to a varying dt). The
 * leftover fraction drives render interpolation through {@link alpha}.
 */
export interface FixedStepClockOptions {
  /** Simulation slice in seconds (default 1/60). */
  step?: number | undefined;
  /** Cap on slices per frame — the "spiral of death" guard; excess time is dropped. */
  maxSubsteps?: number | undefined;
  /**
   * Fraction of `step` a frame may fall short and still take its slice, so a
   * jittery 60 Hz vsync (0.016 s frames) steps once per frame instead of
   * alternating 0/2. The shortfall is carried as a small negative remainder.
   */
  snapTolerance?: number;
}

export const DEFAULT_PHYSICS_FIXED_STEP = 1 / 60;
export const DEFAULT_PHYSICS_MAX_SUBSTEPS = 4;
const DEFAULT_SNAP_TOLERANCE = 0.05;

export class FixedStepClock {
  readonly step: number;
  readonly maxSubsteps: number;
  private readonly snapThreshold: number;
  private accumulator = 0;

  constructor(options: FixedStepClockOptions = {}) {
    this.step = positiveOr(options.step, DEFAULT_PHYSICS_FIXED_STEP);
    this.maxSubsteps = Math.max(1, Math.floor(positiveOr(options.maxSubsteps, DEFAULT_PHYSICS_MAX_SUBSTEPS)));
    const tolerance = Math.min(0.5, Math.max(0, options.snapTolerance ?? DEFAULT_SNAP_TOLERANCE));
    this.snapThreshold = this.step * (1 - tolerance);
  }

  /** Adds a frame's elapsed time and returns how many fixed slices to simulate. */
  advance(deltaSeconds: number): number {
    if (!(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) return 0;
    this.accumulator += deltaSeconds;
    let steps = 0;
    while (this.accumulator >= this.snapThreshold && steps < this.maxSubsteps) {
      this.accumulator -= this.step;
      steps += 1;
    }
    // Over budget: drop the backlog so the world slows down instead of freezing.
    if (this.accumulator >= this.snapThreshold) this.accumulator = 0;
    return steps;
  }

  /** Render blend between the previous and the latest simulated pose, 0..1. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / this.step));
  }

  reset(): void {
    this.accumulator = 0;
  }
}

export type PoseVec3 = readonly [number, number, number];
export interface PoseQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Linear blend of two positions. */
export function lerpPosition(from: PoseVec3, to: PoseVec3, alpha: number): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * alpha,
    from[1] + (to[1] - from[1]) * alpha,
    from[2] + (to[2] - from[2]) * alpha,
  ];
}

/**
 * Shortest-path normalized lerp of two rotations. One fixed step apart the
 * angle is small, where nlerp is indistinguishable from slerp and cheaper.
 */
export function nlerpQuaternion(from: PoseQuat, to: PoseQuat, alpha: number): PoseQuat {
  const sign = from.x * to.x + from.y * to.y + from.z * to.z + from.w * to.w < 0 ? -1 : 1;
  const x = from.x + (to.x * sign - from.x) * alpha;
  const y = from.y + (to.y * sign - from.y) * alpha;
  const z = from.z + (to.z * sign - from.z) * alpha;
  const w = from.w + (to.w * sign - from.w) * alpha;
  const length = Math.hypot(x, y, z, w);
  if (length === 0) return { x: to.x, y: to.y, z: to.z, w: to.w };
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
