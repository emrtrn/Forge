/** Generic animation-role data and deterministic blend-space weight resolution. */

export const ANIMATION_SET_ROLES = ["idle", "walk", "run", "jump", "fall"] as const;
export type AnimationSetRole = (typeof ANIMATION_SET_ROLES)[number];

export const BLEND_SPACE_TYPES = ["1d", "2d"] as const;
export type BlendSpaceType = (typeof BLEND_SPACE_TYPES)[number];

/** A parameter axis of a blend space (e.g. planar Speed, aim Yaw). */
export interface BlendSpaceAxisDef {
  /** Display name shown in the editor (e.g. "Speed"). */
  name: string;
  /** Inclusive domain minimum. */
  min: number;
  /** Inclusive domain maximum; normalization keeps it strictly above `min`. */
  max: number;
}

/** A single clip placed at a coordinate inside the blend space. */
export interface BlendSpaceSampleDef {
  /** Clip name carried by the asset. */
  clip: string;
  /** Position on axis X within `[axisX.min, axisX.max]`. */
  x: number;
  /** Position on axis Y (2D blend spaces only). */
  y?: number;
}

/**
 * A continuous, weighted blend of clips parameterized by one or two axes — the
 * data form of an Unreal Blend Space (no node graph). Runtime resolves a param
 * value to per-clip weights (`resolveBlendSpaceWeights`) and drives the mixer.
 */
export interface AssetSkeletonBlendSpaceDef {
  /** Unique name within the asset (referenced by game/runtime data). */
  name: string;
  type: BlendSpaceType;
  axisX: BlendSpaceAxisDef;
  /** Present only for `2d` blend spaces. */
  axisY?: BlendSpaceAxisDef;
  samples: BlendSpaceSampleDef[];
}

/** A clip plus its resolved blend weight for a given parameter value. */
export interface BlendSampleWeight {
  clip: string;
  weight: number;
}

export function defaultBlendSpaceAxis(name: string): BlendSpaceAxisDef {
  return { name, min: 0, max: 1 };
}

export function clampBlendSpaceAxis(value: unknown, axis: BlendSpaceAxisDef): number {
  const raw = Number.isFinite(value) ? Number(value) : axis.min;
  return roundAxis(Math.min(Math.max(raw, axis.min), axis.max));
}

function roundAxis(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Resolves a blend-space parameter to per-clip weights summing to 1.
 *
 * 1D: piecewise-linear interpolation between the two bracketing samples
 * (clamped at the ends) — the classic locomotion idle↔walk↔run blend.
 * 2D: normalized inverse-distance-squared (Shepard) weighting over all samples,
 * with an exact-sample short-circuit. Pure and deterministic; clips appearing on
 * multiple samples have their weights merged (insertion order preserved).
 */
export function resolveBlendSpaceWeights(
  blendSpace: AssetSkeletonBlendSpaceDef,
  params: { x: number; y?: number },
): BlendSampleWeight[] {
  const samples = blendSpace.samples;
  if (samples.length === 0) return [];
  if (samples.length === 1) return [{ clip: samples[0]!.clip, weight: 1 }];
  const raw =
    blendSpace.type === "2d"
      ? resolveWeights2d(samples, clampBlendSpaceAxis(params.x, blendSpace.axisX), clampBlendSpaceAxis(params.y, blendSpace.axisY ?? blendSpace.axisX))
      : resolveWeights1d(samples, clampBlendSpaceAxis(params.x, blendSpace.axisX));
  return mergeWeights(raw);
}

function resolveWeights1d(samples: BlendSpaceSampleDef[], x: number): BlendSampleWeight[] {
  const sorted = [...samples].sort((a, b) => a.x - b.x);
  const clamped = Math.min(Math.max(x, sorted[0]!.x), sorted[sorted.length - 1]!.x);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (clamped < a.x || clamped > b.x) continue;
    const span = b.x - a.x;
    if (span <= 1e-9) return [{ clip: a.clip, weight: 1 }];
    const t = (clamped - a.x) / span;
    return [
      { clip: a.clip, weight: 1 - t },
      { clip: b.clip, weight: t },
    ];
  }
  return [{ clip: sorted[sorted.length - 1]!.clip, weight: 1 }];
}

function resolveWeights2d(samples: BlendSpaceSampleDef[], x: number, y: number): BlendSampleWeight[] {
  const distances = samples.map((sample) => {
    const dx = sample.x - x;
    const dy = (sample.y ?? 0) - y;
    return dx * dx + dy * dy;
  });
  const exact = distances.findIndex((d) => d <= 1e-9);
  if (exact >= 0) return [{ clip: samples[exact]!.clip, weight: 1 }];
  return samples.map((sample, index) => ({ clip: sample.clip, weight: 1 / distances[index]! }));
}

function mergeWeights(weights: BlendSampleWeight[]): BlendSampleWeight[] {
  const order: string[] = [];
  const byClip = new Map<string, number>();
  let total = 0;
  for (const { clip, weight } of weights) {
    if (weight <= 0) continue;
    if (!byClip.has(clip)) order.push(clip);
    byClip.set(clip, (byClip.get(clip) ?? 0) + weight);
    total += weight;
  }
  if (total <= 0) return [];
  return order.map((clip) => ({ clip, weight: (byClip.get(clip) ?? 0) / total }));
}
