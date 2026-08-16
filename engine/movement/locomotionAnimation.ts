/**
 * Pure, headless-testable mapping from a player's movement state to an animation
 * clip. No Three.js or DOM: the runtime shell feeds it the per-frame locomotion
 * snapshot the character movement solver reports plus the clip
 * names the character asset actually carries, and it returns the clip to play.
 *
 * Two layers keep both ends testable and asset-agnostic:
 *   1. `classifyLocomotion` -> a semantic state (idle/walk/run/jump/fall) from
 *      the kinematics, with tunable speed thresholds.
 *   2. `resolveLocomotionClip` -> a concrete clip name via per-state fallback
 *      chains, so an asset missing (say) a jump clip degrades to idle instead of
 *      snapping to a T-pose.
 */

import {
  resolveBlendSpaceWeights,
  type AnimationSetRole,
  type AssetSkeletonBlendSpaceDef,
  type BlendSampleWeight,
} from "@/scene/assetSkeletonLoader";

/** Per-frame movement snapshot the player behavior reports to the shell. */
export interface LocomotionInput {
  /** Intended planar speed this tick (units/s), before collision clamping. */
  readonly planarSpeed: number;
  /** Whether the entity is resting on the floor (from the G2 vertical state). */
  readonly grounded: boolean;
  /** Vertical velocity (units/s); positive is up. */
  readonly velocityY: number;
}

/** Semantic locomotion state, independent of which clips an asset ships. */
export type LocomotionState = "idle" | "walk" | "run" | "jump" | "fall";

/** Planar-speed boundaries between the grounded states. */
export interface LocomotionThresholds {
  /** Above this planar speed the entity is at least walking. */
  readonly walkSpeed: number;
  /** At or above this planar speed the entity is running. */
  readonly runSpeed: number;
}

/**
 * Defaults tuned for the demo character: base walk speed ~2 and a sprint of ~4
 * (see `input-move`'s `sprintMultiplier`), so the run boundary sits between them.
 */
export const DEFAULT_LOCOMOTION_THRESHOLDS: LocomotionThresholds = {
  walkSpeed: 0.1,
  runSpeed: 3,
};

/**
 * Classifies the movement snapshot into a semantic state. Airborne (not
 * grounded) takes priority: rising reads as `jump`, descending as `fall`.
 * Grounded states fall out of the planar speed against the thresholds.
 */
export function classifyLocomotion(
  input: LocomotionInput,
  thresholds: LocomotionThresholds = DEFAULT_LOCOMOTION_THRESHOLDS,
): LocomotionState {
  if (!input.grounded) return input.velocityY > 0 ? "jump" : "fall";
  if (input.planarSpeed >= thresholds.runSpeed) return "run";
  if (input.planarSpeed > thresholds.walkSpeed) return "walk";
  return "idle";
}

/**
 * Per-state preference order of clip names. The first name present in the
 * asset's clip set wins, so a richer asset uses its dedicated clip and a sparser
 * one degrades gracefully (a missing run -> walk, a missing jump/fall -> idle).
 * Names follow the demo character's Kenney clip vocabulary.
 */
const CLIP_FALLBACKS: Record<LocomotionState, readonly string[]> = {
  idle: ["idle", "static"],
  walk: ["walk", "idle", "static"],
  run: ["sprint", "run", "walk", "idle", "static"],
  jump: ["jump", "jump-up", "idle", "static"],
  fall: ["fall", "jump-down", "jump", "idle", "static"],
};

/**
 * Per-state preference order of *semantic roles* (not clip names). Used to walk
 * the authored anim-set: a missing run falls back to the authored walk, then
 * idle; a missing fall to jump, then idle. Asset-agnostic, since the anim-set
 * maps each role to whatever clip the asset names it.
 */
const ROLE_FALLBACKS: Record<LocomotionState, readonly AnimationSetRole[]> = {
  idle: ["idle"],
  walk: ["walk", "idle"],
  run: ["run", "walk", "idle"],
  jump: ["jump", "idle"],
  fall: ["fall", "jump", "idle"],
};

/**
 * Resolves a semantic state to a concrete clip name present in `available`.
 * Authored intent wins: when an `animationSet` (role→clip map, from the asset's
 * `*.skeleton.json`) is supplied, the state's role-fallback chain is consulted
 * first. Failing that — or with no anim-set — it walks the clip-name vocabulary
 * heuristic, then returns any available clip; null only when there are none.
 */
export function resolveLocomotionClip(
  state: LocomotionState,
  available: ReadonlySet<string>,
  animationSet?: Partial<Record<AnimationSetRole, string>>,
): string | null {
  if (animationSet) {
    for (const role of ROLE_FALLBACKS[state]) {
      const clip = animationSet[role];
      if (clip && available.has(clip)) return clip;
    }
  }
  for (const name of CLIP_FALLBACKS[state]) {
    if (available.has(name)) return name;
  }
  for (const name of available) return name;
  return null;
}

/** Convenience: classify the snapshot then resolve it to an available clip. */
export function selectLocomotionClip(
  input: LocomotionInput,
  available: ReadonlySet<string>,
  thresholds?: LocomotionThresholds,
): string | null {
  return resolveLocomotionClip(classifyLocomotion(input, thresholds), available);
}

/**
 * The runtime locomotion output: either a single clip (the crossfade fallback,
 * used airborne and when no blend space is authored) or a weighted blend (a
 * blend space's per-clip weights for the smooth idle↔walk↔run transition).
 */
export type LocomotionAnimation =
  | { readonly kind: "clip"; readonly clip: string | null }
  | { readonly kind: "blend"; readonly weights: readonly BlendSampleWeight[] };

/**
 * Picks the blend space that drives ground locomotion from an asset's authored
 * set: a non-empty 1D space named `Locomotion` (case-insensitive) wins, else the
 * first non-empty 1D space. Returns null when none qualifies (the caller then
 * stays on the single-clip selector). 2D spaces are reserved for aim/other axes.
 */
export function pickLocomotionBlendSpace(
  blendSpaces: readonly AssetSkeletonBlendSpaceDef[],
): AssetSkeletonBlendSpaceDef | null {
  const oneDimensional = blendSpaces.filter(
    (blend) => blend.type === "1d" && blend.samples.length > 0,
  );
  return (
    oneDimensional.find((blend) => blend.name.trim().toLowerCase() === "locomotion") ??
    oneDimensional[0] ??
    null
  );
}

/**
 * The asset-authored inputs to locomotion resolution, both read from the
 * character's `*.skeleton.json`: the ground blend space (or null) and the
 * role→clip anim-set. Built once per possessed character via
 * {@link locomotionConfigForSkeleton}.
 */
export interface LocomotionAssetConfig {
  readonly blendSpace: AssetSkeletonBlendSpaceDef | null;
  readonly animationSet: Partial<Record<AnimationSetRole, string>>;
}

/** Empty config: no blend space, no authored anim-set (clip-name heuristics only). */
export const EMPTY_LOCOMOTION_CONFIG: LocomotionAssetConfig = { blendSpace: null, animationSet: {} };

/**
 * Derives the runtime locomotion config from a loaded skeleton sidecar: picks
 * the ground-locomotion blend space and carries the anim-set. Tolerates a
 * missing skeleton (asset without a sidecar) by returning the empty config.
 */
export function locomotionConfigForSkeleton(
  skeleton:
    | {
        readonly blendSpaces: readonly AssetSkeletonBlendSpaceDef[];
        readonly animationSet: Partial<Record<AnimationSetRole, string>>;
      }
    | null
    | undefined,
): LocomotionAssetConfig {
  if (!skeleton) return EMPTY_LOCOMOTION_CONFIG;
  return {
    blendSpace: pickLocomotionBlendSpace(skeleton.blendSpaces),
    animationSet: skeleton.animationSet,
  };
}

/**
 * Resolves the per-tick locomotion animation. When the entity is grounded and a
 * locomotion blend space is configured, the planar speed drives its X axis into
 * per-clip weights (filtered to clips the asset actually carries); if at least
 * one survives, a weighted blend is returned. Otherwise — airborne, no blend
 * space, or no resolvable blend clip — it falls back to the single-clip selector,
 * which honours the authored anim-set before the clip-name heuristic.
 */
export function resolveLocomotionAnimation(
  input: LocomotionInput,
  available: ReadonlySet<string>,
  config: LocomotionAssetConfig,
  thresholds: LocomotionThresholds = DEFAULT_LOCOMOTION_THRESHOLDS,
): LocomotionAnimation {
  const state = classifyLocomotion(input, thresholds);
  const grounded = state === "idle" || state === "walk" || state === "run";
  if (grounded && config.blendSpace) {
    const weights = resolveBlendSpaceWeights(config.blendSpace, { x: input.planarSpeed }).filter(
      (entry) => available.has(entry.clip),
    );
    if (weights.length > 0) return { kind: "blend", weights };
  }
  return { kind: "clip", clip: resolveLocomotionClip(state, available, config.animationSet) };
}
