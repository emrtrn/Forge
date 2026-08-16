/**
 * Pure, headless-testable vertical motion: gravity, a grounded jump, and a floor
 * clamp. No Three.js or DOM — its caller (the character movement solver, or a game behavior) keeps
 * one state per entity and feeds it the per-tick inputs, writing the returned
 * `y` into the transform.
 *
 * The floor is supplied by the caller. A missing floor leaves the character in
 * free fall until a ground probe reports a landing surface.
 */

export interface VerticalMotionState {
  /** Height this tick. */
  readonly y: number;
  /** Vertical velocity (units/s); positive is up. */
  readonly velocityY: number;
  /** Whether the entity is resting on the floor this tick. */
  readonly grounded: boolean;
}

export interface VerticalMotionStep {
  /** Gravity on Y (units/s^2); negative pulls down. */
  readonly gravityY: number;
  /** Upward velocity applied when a grounded jump fires. */
  readonly jumpSpeed: number;
  /** Floor height the entity rests on / clamps to. `null` means no floor below. */
  readonly floorY: number | null;
  /** Tick duration in seconds. */
  readonly dt: number;
  /** True only on the tick the jump action is pressed (edge, not held). */
  readonly jump: boolean;
}

/** A grounded state resting at `y` with no vertical velocity. */
export function groundedAt(y: number): VerticalMotionState {
  return { y, velocityY: 0, grounded: true };
}

/**
 * Advances vertical motion one tick: a jump impulse only fires from the ground
 * on the press edge (so there is no mid-air double jump), gravity then
 * integrates the velocity, and crossing a supplied floor clamps back to `floorY`
 * and re-grounds (zeroing velocity). A non-positive `dt` leaves height
 * unchanged.
 */
export function stepVerticalMotion(
  prev: VerticalMotionState,
  step: VerticalMotionStep,
): VerticalMotionState {
  let velocityY = prev.velocityY;
  if (step.jump && prev.grounded) velocityY = step.jumpSpeed;
  const dt = step.dt > 0 ? step.dt : 0;
  velocityY += step.gravityY * dt;
  let y = prev.y + velocityY * dt;
  if (step.floorY !== null && y <= step.floorY) {
    return { y: step.floorY, velocityY: 0, grounded: true };
  }
  return { y, velocityY, grounded: false };
}
