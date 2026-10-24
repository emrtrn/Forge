/**
 * Pure wheel-sinkage helpers (TERRAIN_DEFORMATION Faz 3). The physics step lowers each wheel's
 * suspension rest length by the track depth under it (virtual ground offset; the terrain collider never changes).
 */

/** Faz 0 gate: rest-length changes faster than this shake the chassis (m/s). */
export const MAX_SINK_RATE = 0.3;
/** Default gap kept between the chassis bottom and the terrain collider (m). */
export const SINK_CLEARANCE_MARGIN = 0.05;
/** Shortest suspension rest length a sinking wheel may reach (m). */
export const MIN_SINK_REST_LENGTH = 0.05;
/** Overlap at which belly drag reaches full strength (m). */
export const BELLY_FULL_OVERLAP = 0.1;

/** Moves toward a non-negative target by at most `maxRate × dtSeconds`; invalid time/rate holds the depth. */
export function slewSinkDepth(previous: number, target: number, dtSeconds: number, maxRate = MAX_SINK_RATE): number {
  previous = Number.isFinite(previous) ? Math.max(0, previous) : 0;
  target = Number.isFinite(target) ? Math.max(0, target) : 0;
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || !Number.isFinite(maxRate) || maxRate <= 0) return previous;
  const step = maxRate * dtSeconds;
  return target >= previous ? Math.min(target, previous + step) : Math.max(target, previous - step);
}

/** Deepest virtual sink allowed by chassis clearance minus margin and the minimum suspension rest length. */
export function wheelSinkLimit(
  wheel: { readonly position: readonly [number, number, number]; readonly suspensionRestLength: number; readonly radius: number },
  chassisBottomY: number,
  margin = SINK_CLEARANCE_MARGIN,
  minRestLength = MIN_SINK_REST_LENGTH,
): number {
  if (!wheel.position.every(Number.isFinite) || !Number.isFinite(wheel.suspensionRestLength)
    || !Number.isFinite(wheel.radius) || !Number.isFinite(chassisBottomY)
    || !Number.isFinite(margin) || !Number.isFinite(minRestLength)) return 0;
  const groundY = wheel.position[1] - wheel.suspensionRestLength - wheel.radius;
  const clearance = chassisBottomY - groundY;
  return Math.max(0, Math.min(clearance - margin, wheel.suspensionRestLength - minRestLength));
}

/** Horizontal belly drag impulse (N·s), ramped by overlap and speed and capped so it cannot reverse motion. */
export function bellyDragImpulse(
  velocity: readonly [number, number, number],
  overlap: number,
  sinkResistance: number,
  massKg: number,
  dtSeconds: number,
): [number, number, number] {
  if (!velocity.every(Number.isFinite) || !Number.isFinite(overlap) || overlap <= 0
    || !Number.isFinite(sinkResistance) || sinkResistance <= 0 || !Number.isFinite(massKg) || massKg <= 0
    || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return [0, 0, 0];
  const speed = Math.hypot(velocity[0], velocity[2]);
  if (speed === 0) return [0, 0, 0];
  const force = sinkResistance * massKg * 9.81 * Math.min(overlap / BELLY_FULL_OVERLAP, 1) * Math.min(speed, 1);
  const impulse = Math.min(force * dtSeconds, massKg * speed);
  const scale = -impulse / speed;
  return [velocity[0] * scale, 0, velocity[2] * scale];
}

/** Rapier's weight of the forward (engine) impulse inside its friction circle. */
const FORWARD_FRICTION_FACTOR = 0.5;

/**
 * Share of a driven wheel's engine impulse beyond its friction circle (0 full
 * grip, 1 pure spin), the way Rapier's ray-cast wheel judges sliding: forward
 * impulse `engineForce × dt × 0.5` and the last side impulse against
 * `load × dt × frictionSlip`. Computed here because Rapier only scales the
 * forward impulse back while a side impulse exists, so a straight-line
 * wheelspin never shows in `wheelForwardImpulse`.
 */
export function tractionSlip(
  engineForce: number,
  sideImpulse: number,
  load: number,
  frictionSlip: number,
  dtSeconds: number,
): number {
  if (![engineForce, sideImpulse, load, frictionSlip, dtSeconds].every(Number.isFinite) || dtSeconds <= 0) return 0;
  const forward = engineForce * dtSeconds * FORWARD_FRICTION_FACTOR;
  if (Math.abs(forward) < 1e-9) return 0;
  const impulse = Math.hypot(forward, sideImpulse);
  const limit = Math.max(0, load) * dtSeconds * Math.max(0, frictionSlip);
  return impulse <= limit ? 0 : 1 - limit / impulse;
}

/** Adds slip-driven digging (m/s) up to the cap, keeping any existing deeper track unchanged. */
export function digTargetDepth(current: number, slip: number, digRate: number, dtSeconds: number, cap: number): number {
  current = Number.isFinite(current) ? Math.max(0, current) : 0;
  if (!Number.isFinite(slip) || slip <= 0 || !Number.isFinite(digRate) || digRate <= 0
    || !Number.isFinite(dtSeconds) || dtSeconds <= 0 || !Number.isFinite(cap) || cap <= 0 || current >= cap) return current;
  return Math.min(cap, current + digRate * Math.min(slip, 1) * dtSeconds);
}

/** Mean depth at axle offsets −0.35·width, 0, +0.35·width; heading rolls from +Z toward +X. */
export function wheelFootprintDepth(
  depthAt: (worldX: number, worldZ: number) => number,
  contactX: number,
  contactZ: number,
  heading: number,
  width: number,
): number {
  if (!Number.isFinite(contactX) || !Number.isFinite(contactZ) || !Number.isFinite(heading)) return 0;
  const sample = (x: number, z: number): number => {
    const depth = depthAt(x, z);
    return Number.isFinite(depth) ? Math.max(0, depth) : 0;
  };
  if (!Number.isFinite(width) || width <= 0) return sample(contactX, contactZ);
  const dx = Math.cos(heading) * 0.35 * width;
  const dz = -Math.sin(heading) * 0.35 * width;
  return sample(contactX - dx, contactZ - dz) / 3 + sample(contactX, contactZ) / 3
    + sample(contactX + dx, contactZ + dz) / 3;
}
