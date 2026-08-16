/**
 * Pure, headless-testable uphill walk slowdown: measures the slope the character
 * is actually climbing (grounded floor rise / planar distance per frame) and maps
 * it to a planar speed multiplier, so walking up stairs or a ramp reads as effort.
 *
 * Stairs make the raw per-frame slope spiky (one frame carries the whole step
 * rise, the frames between steps are flat), so the samples are smoothed with an
 * exponential filter. The filter is linear, so its steady state on a staircase
 * converges to the true rise/run of the flight — the same value a ramp of equal
 * incline produces — and it decays back to full speed shortly after the climb
 * ends. No Three.js, DOM, or physics dependency: the character movement system
 * feeds it the ground-probe target heights it already computes.
 */

export interface UphillSlowdownState {
  /** Exponentially smoothed climb slope (rise/run; 0 = flat, 1 = 45°). */
  readonly smoothedSlope: number;
}

/** Initial/reset state: not climbing. */
export const UPHILL_SLOWDOWN_REST: UphillSlowdownState = { smoothedSlope: 0 };

/** Smoothing time constant (s): how fast the slowdown builds up and releases. */
export const UPHILL_SMOOTHING_SECONDS = 0.25;

/**
 * Cap on a single frame's slope sample. A stair edge legitimately spikes the
 * per-frame slope (whole step rise over a small planar move), and the average of
 * uncapped samples is what converges to the true staircase incline — but a
 * teleport/reset-sized rise would poison the filter for seconds, so absurd
 * samples are clipped.
 */
const MAX_SLOPE_SAMPLE = 8;

const MIN_PLANAR_DISTANCE = 1e-6;

/** Raw climb-slope sample for one frame; descending or standing still reads 0. */
export function climbSlopeSample(floorRise: number, planarDistance: number): number {
  if (!(planarDistance > MIN_PLANAR_DISTANCE)) return 0;
  return Math.min(Math.max(0, floorRise) / planarDistance, MAX_SLOPE_SAMPLE);
}

/**
 * Advances the smoothed climb slope by one frame. `floorRise` is how much the
 * grounded floor target rose since the previous frame (0 while airborne or when
 * there is no previous grounded frame); `planarDistance` is the planar move
 * actually applied this frame.
 */
export function updateUphillSlowdown(
  state: UphillSlowdownState,
  floorRise: number,
  planarDistance: number,
  dt: number,
): UphillSlowdownState {
  if (!(dt > 0)) return state;
  const sample = climbSlopeSample(floorRise, planarDistance);
  const blend = 1 - Math.exp(-dt / UPHILL_SMOOTHING_SECONDS);
  return { smoothedSlope: state.smoothedSlope + (sample - state.smoothedSlope) * blend };
}

/**
 * Maps the smoothed climb slope to a planar speed multiplier: 1 on the flat,
 * `minSpeedScale` at/above a 45° climb (slope 1), linear in between.
 * `minSpeedScale` ≥ 1 disables the slowdown.
 */
export function uphillSpeedScale(state: UphillSlowdownState, minSpeedScale: number): number {
  const floor = Math.min(Math.max(minSpeedScale, 0), 1);
  if (floor >= 1) return 1;
  const climb = Math.min(Math.max(state.smoothedSlope, 0), 1);
  return 1 - (1 - floor) * climb;
}
