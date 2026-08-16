/**
 * Pure, headless-testable planar movement math. No Three.js or DOM: the caller
 * feeds it the current input snapshot and it returns the planar position delta
 * and facing yaw, which the caller writes into the mutable transform.
 *
 * Axis convention (matches the engine's WASD bindings):
 *   forward -> -z, back -> +z, left -> -x, right -> +x.
 * Yaw is in XYZ-order Euler degrees for `transform.rotation[1]`, the same
 * convention `applyEulerDegrees` consumes when rendering.
 */

/** Which of the four planar movement actions are held this tick. */
export interface PlanarMoveInput {
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/** Planar position delta on the XZ plane for one tick. */
export interface PlanarMoveStep {
  readonly dx: number;
  readonly dz: number;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Resolves the held movement actions into an XZ delta for one tick. The raw
 * direction is normalized before scaling by `speed * dt`, so a diagonal moves at
 * the same speed as a straight line (no ~1.41x diagonal boost). Opposing keys
 * cancel; no input (or a non-positive speed/dt) yields a zero delta.
 */
export function planarMoveStep(
  input: PlanarMoveInput,
  speed: number,
  dt: number,
): PlanarMoveStep {
  const rx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const rz = (input.back ? 1 : 0) - (input.forward ? 1 : 0);
  const magnitude = Math.hypot(rx, rz);
  if (magnitude === 0) return { dx: 0, dz: 0 };
  const distance = speed * dt;
  if (!(distance > 0)) return { dx: 0, dz: 0 };
  const scale = distance / magnitude;
  return { dx: rx * scale, dz: rz * scale };
}

/**
 * Resolves planar movement relative to a controller/camera yaw in radians. Yaw
 * convention matches LookAngles: 0 faces world -z; positive yaw turns toward -x.
 */
export function planarMoveStepRelativeToYaw(
  input: PlanarMoveInput,
  speed: number,
  dt: number,
  yaw: number,
): PlanarMoveStep {
  const forwardAmount = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const rightAmount = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const magnitude = Math.hypot(forwardAmount, rightAmount);
  if (magnitude === 0) return { dx: 0, dz: 0 };
  const distance = speed * dt;
  if (!(distance > 0)) return { dx: 0, dz: 0 };

  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  const scale = distance / magnitude;
  return {
    dx: (fx * forwardAmount + rx * rightAmount) * scale,
    dz: (fz * forwardAmount + rz * rightAmount) * scale,
  };
}

/**
 * Yaw (in degrees) that faces the movement direction `(dx, dz)`, or `null` when
 * there is no movement so the caller holds the current facing.
 *
 * The demo character mesh is authored facing local `+z` (not Three.js' default
 * `-z`). A Y rotation of theta sends local `+z` to world `(sin theta, 0, cos
 * theta)`, so aligning that with `(dx, dz)` gives `theta = atan2(dx, dz)`. atan2
 * is invariant to positive scaling, so the scaled delta works directly. Cardinal
 * checks: forward -> 180deg, back -> 0deg, right -> 90deg, left -> -90deg.
 */
export function facingYawFromMove(dx: number, dz: number): number | null {
  if (dx === 0 && dz === 0) return null;
  return Math.atan2(dx, dz) * RAD_TO_DEG;
}

/** Normalizes yaw to Forge's authored -180..180 degree range. */
export function normalizeYawDeg(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const normalized = ((((yaw + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}

/** Shortest signed delta from the current yaw to a target yaw, in degrees. */
export function shortestYawDeltaDeg(current: number, target: number): number {
  return normalizeYawDeg(target - current);
}

/** Steps current yaw toward target yaw by at most `maxDeltaDeg`. */
export function rotateYawToward(current: number, target: number, maxDeltaDeg: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return current;
  if (!Number.isFinite(maxDeltaDeg)) return normalizeYawDeg(target);
  const maxDelta = Math.max(0, maxDeltaDeg);
  const delta = shortestYawDeltaDeg(current, target);
  if (Math.abs(delta) <= maxDelta) return normalizeYawDeg(target);
  if (maxDelta === 0) return normalizeYawDeg(current);
  return normalizeYawDeg(current + Math.sign(delta) * maxDelta);
}
