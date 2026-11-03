/**
 * Impact events: how hard two bodies hit, where and in which direction.
 *
 * `PhysicsContact` only says that two bodies touch. Fracture thresholds, dents
 * and damage accumulation need the strength of the hit as well, so the Rapier
 * backend turns opt-in contact-force events into {@link ImpactSample}s after
 * every fixed slice, and an {@link ImpactAccumulator} folds the slices of one
 * render frame into one {@link PhysicsImpact} per body pair.
 *
 * This file is pure: no Rapier, no Three.js. The adapter that reads the event
 * queue and contact manifolds lives in `physicsSubsystem.ts`.
 *
 * Units: impulses are N·s. Rapier reports contact *forces* for one slice;
 * {@link forceToImpulse} multiplies by the slice length, and
 * {@link impulseToForceThreshold} turns an impulse threshold into the force
 * threshold Rapier filters on. See DEFORMABLE_FRACTURABLE_WORK_PLAN.md Faz 0.
 */
import type { EntityId } from "../scene/entity";

export type ImpactVec3 = readonly [number, number, number];

/** One body pair's impact over a render frame (all its fixed slices merged). */
export interface PhysicsImpact {
  /** Lower entity id of the pair (same ordering as `PhysicsContact`). */
  readonly a: EntityId;
  readonly b: EntityId;
  /**
   * World-space contact point, impulse-weighted over the frame's slices. Null
   * when no slice carried manifold points (the pair separated within the
   * slice); consumers fall back to the body's own position.
   */
  readonly point: ImpactVec3 | null;
  /** World-space unit normal pointing out of `a`, towards `b`. */
  readonly normal: ImpactVec3;
  /** Total normal impulse over the frame, N·s. */
  readonly impulse: number;
  /** Largest closing speed along the normal seen in any slice, m/s. */
  readonly relativeSpeed: number;
}

/** A manifold contact point with the impulse it carried in the slice. */
export interface ImpactContactPoint {
  readonly point: ImpactVec3;
  readonly weight: number;
}

/** One pair's impact during one fixed slice, as read from Rapier. */
export interface ImpactSample {
  readonly a: EntityId;
  readonly b: EntityId;
  /** Normal impulse of the slice, N·s (see {@link forceToImpulse}). */
  readonly impulse: number;
  /** World-space unit normal pointing out of `a`, towards `b`. */
  readonly normal: ImpactVec3;
  readonly points: readonly ImpactContactPoint[];
  readonly relativeSpeed: number;
}

export interface ImpactAccumulatorOptions {
  /** Pairs whose frame impulse stays below this are noise and dropped, N·s. */
  readonly minImpulse?: number;
  /** Most impacts reported per frame; the strongest win. */
  readonly maxImpactsPerFrame?: number;
}

export interface ImpactFrame {
  /** Reported impacts, ordered by pair (`a`, then `b`). */
  readonly impacts: readonly PhysicsImpact[];
  /** Pairs above the noise floor that the per-frame budget left out. */
  readonly overBudget: number;
}

export const DEFAULT_IMPACT_MIN_IMPULSE = 0;
export const DEFAULT_MAX_IMPACTS_PER_FRAME = 64;
export const STANDARD_GRAVITY = 9.81;

/** Impulse a contact force applies over one slice. */
export function forceToImpulse(force: number, step: number): number {
  return force * step;
}

/**
 * Rapier's `contactForceEventThreshold` for an impulse threshold: the event
 * fires when a slice's force exceeds it, i.e. when the slice impulse does.
 */
export function impulseToForceThreshold(impulse: number, step: number): number {
  return step > 0 ? impulse / step : Number.POSITIVE_INFINITY;
}

/**
 * A resting body presses about `m·g·dt` into its support every slice (Faz 0
 * measured 1.6–2.0 N·s for 10 kg at 60 Hz). A break threshold below four
 * times that lets an object break under its own weight; validators warn below it.
 */
export function restingImpulseFloor(mass: number, step: number, gravity = STANDARD_GRAVITY): number {
  return 4 * Math.max(0, mass) * Math.abs(gravity) * step;
}

/**
 * The manifold normal of a contact pair, oriented out of the collider the
 * caller asked about. Rapier's `normal()` points out of the manifold's first
 * collider; `flipped` means that is the caller's second one.
 */
export function manifoldNormal(normal: ImpactVec3, flipped: boolean): ImpactVec3 {
  return flipped ? negate(normal) : [normal[0], normal[1], normal[2]];
}

/**
 * Impulse-weighted mean of manifold points. Points without impulse (speculative
 * contacts) only count when no point carried any; no points gives null.
 */
export function weightedContactPoint(points: readonly ImpactContactPoint[]): ImpactVec3 | null {
  let weight = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const { point, weight: w } of points) {
    if (!(w > 0) || !finite3(point)) continue;
    weight += w;
    x += point[0] * w;
    y += point[1] * w;
    z += point[2] * w;
  }
  if (weight > 0) return [x / weight, y / weight, z / weight];
  let count = 0;
  for (const { point } of points) {
    if (!finite3(point)) continue;
    count += 1;
    x += point[0];
    y += point[1];
    z += point[2];
  }
  return count > 0 ? [x / count, y / count, z / count] : null;
}

interface PendingImpact {
  readonly a: EntityId;
  readonly b: EntityId;
  impulse: number;
  pointWeight: number;
  point: [number, number, number];
  normal: [number, number, number];
  strongestImpulse: number;
  strongestNormal: ImpactVec3;
  relativeSpeed: number;
}

/**
 * Collects slice samples during a frame and reports one impact per pair.
 * Several slices of one frame (up to `maxSubsteps`) merge: impulses add up,
 * the point and normal are impulse-weighted, the speed keeps its maximum.
 */
export class ImpactAccumulator {
  private readonly minImpulse: number;
  private readonly maxImpacts: number;
  private readonly pending = new Map<string, PendingImpact>();

  constructor(options: ImpactAccumulatorOptions = {}) {
    this.minImpulse = Math.max(0, finiteOr(options.minImpulse, DEFAULT_IMPACT_MIN_IMPULSE));
    this.maxImpacts = Math.max(0, Math.floor(finiteOr(options.maxImpactsPerFrame, DEFAULT_MAX_IMPACTS_PER_FRAME)));
  }

  /** Adds one slice's sample. Self pairs and non-positive impulses are ignored. */
  add(sample: ImpactSample): void {
    if (sample.a === sample.b || !(sample.impulse > 0) || !Number.isFinite(sample.impulse)) return;
    const swap = sample.b < sample.a;
    const a = swap ? sample.b : sample.a;
    const b = swap ? sample.a : sample.b;
    const normal = finite3(sample.normal) ? (swap ? negate(sample.normal) : sample.normal) : null;
    const key = `${a}\u0000${b}`;
    let entry = this.pending.get(key);
    if (!entry) {
      entry = {
        a, b, impulse: 0, pointWeight: 0, point: [0, 0, 0], normal: [0, 0, 0],
        strongestImpulse: 0, strongestNormal: [0, 1, 0], relativeSpeed: 0,
      };
      this.pending.set(key, entry);
    }
    const impulse = sample.impulse;
    entry.impulse += impulse;
    const point = weightedContactPoint(sample.points);
    if (point) {
      entry.pointWeight += impulse;
      for (let axis = 0; axis < 3; axis += 1) entry.point[axis]! += point[axis]! * impulse;
    }
    if (normal) {
      for (let axis = 0; axis < 3; axis += 1) entry.normal[axis]! += normal[axis]! * impulse;
      if (impulse > entry.strongestImpulse) {
        entry.strongestImpulse = impulse;
        entry.strongestNormal = normal;
      }
    }
    if (Number.isFinite(sample.relativeSpeed)) entry.relativeSpeed = Math.max(entry.relativeSpeed, sample.relativeSpeed);
  }

  /** Reports the frame's impacts and starts the next frame. */
  takeFrame(): ImpactFrame {
    const candidates: PhysicsImpact[] = [];
    for (const entry of this.pending.values()) {
      if (entry.impulse < this.minImpulse) continue;
      candidates.push({
        a: entry.a,
        b: entry.b,
        point: entry.pointWeight > 0
          ? [entry.point[0] / entry.pointWeight, entry.point[1] / entry.pointWeight, entry.point[2] / entry.pointWeight]
          : null,
        normal: normalizeOr(entry.normal, entry.strongestNormal),
        impulse: entry.impulse,
        relativeSpeed: entry.relativeSpeed,
      });
    }
    this.pending.clear();
    let kept = candidates;
    if (candidates.length > this.maxImpacts) {
      kept = [...candidates].sort((left, right) => right.impulse - left.impulse || comparePairs(left, right)).slice(0, this.maxImpacts);
    }
    kept.sort(comparePairs);
    return { impacts: kept, overBudget: candidates.length - kept.length };
  }

  /** Drops the frame's samples (physics disabled, world rebuilt). */
  clear(): void {
    this.pending.clear();
  }
}

function comparePairs(left: PhysicsImpact, right: PhysicsImpact): number {
  if (left.a !== right.a) return left.a < right.a ? -1 : 1;
  if (left.b !== right.b) return left.b < right.b ? -1 : 1;
  return 0;
}

function normalizeOr(vector: ImpactVec3, fallback: ImpactVec3): ImpactVec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  // Opposing slice normals can cancel out; the strongest slice then decides.
  if (length > 1e-9) return [vector[0] / length, vector[1] / length, vector[2] / length];
  const fallbackLength = Math.hypot(fallback[0], fallback[1], fallback[2]);
  return fallbackLength > 1e-9
    ? [fallback[0] / fallbackLength, fallback[1] / fallbackLength, fallback[2] / fallbackLength]
    : [0, 1, 0];
}

function negate(vector: ImpactVec3): ImpactVec3 {
  // `0 - v`, not `-v`: an axis-aligned normal must not pick up a -0 component.
  return [0 - vector[0], 0 - vector[1], 0 - vector[2]];
}

function finite3(vector: ImpactVec3): boolean {
  return Number.isFinite(vector[0]) && Number.isFinite(vector[1]) && Number.isFinite(vector[2]);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
