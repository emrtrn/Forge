import { AnimationMixer, LoopOnce, LoopRepeat } from "three";
import type { AnimationAction, AnimationClip, Object3D } from "three";
import { applyRootMotionToClips, type RootMotionClipSetting } from "./rootMotion";

/** A clip plus its (un-normalized) blend weight, as produced by a blend space. */
export interface AnimatorBlendWeight {
  readonly clip: string;
  readonly weight: number;
}

/**
 * Wraps a Three.js `AnimationMixer` over a character's clips. Supports two
 * mutually-exclusive playback modes — single-clip {@link play} (crossfade by
 * name) and weighted {@link playBlend} (a blend space's per-clip weights) — and
 * switches cleanly between them. Generic render glue: it holds no game rules,
 * the runtime shell (via the pure locomotion selector in `src/game`) decides
 * *what* to play. The owned mixer is advanced once per tick by the
 * `AnimationSubsystem`.
 *
 * Three-touching, so it lives in `engine/render-three`, not `engine/core`.
 */
/**
 * A named time window inside a clip — one montage section (see
 * {@link CrossfadeAnimator.playRange}), in seconds from the clip start.
 */
export interface AnimatorClipRange {
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** Wrap back to `startSeconds` at the end, instead of holding the last pose. */
  readonly loop: boolean;
}

export class CrossfadeAnimator {
  readonly mixer: AnimationMixer;
  /** Names of the clips this animator can play. */
  readonly clips: ReadonlySet<string>;
  private readonly actions = new Map<string, AnimationAction>();
  private current: string | null = null;
  /** Clips actively contributing to the current weighted blend (empty in clip mode). */
  private readonly blendActions = new Map<string, AnimationAction>();
  /** The sub-clip window {@link playRange} is confining the playhead to, if any. */
  private range: AnimatorClipRange | null = null;
  /** True once a non-looping range has reached its end and is holding that pose. */
  private rangeDone = false;
  /** Last playhead seen inside a range, so a whole-clip wrap can be recognised. */
  private rangeLastTime = 0;

  constructor(
    root: Object3D,
    clips: readonly AnimationClip[],
    options: { readonly rootMotion?: readonly RootMotionClipSetting[] } = {},
  ) {
    this.mixer = new AnimationMixer(root);
    // `root` also resolves which track axis is vertical, which is rig-dependent.
    for (const clip of applyRootMotionToClips(clips, options.rootMotion, root)) {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    this.clips = new Set(this.actions.keys());
  }

  /** The clip currently playing (or fading in), or null before the first play. */
  get currentClip(): string | null {
    return this.current;
  }

  /**
   * The single clip currently driving the pose with its playhead, for animation
   * notify detection. Null in weighted-blend mode (the playhead is ambiguous) or
   * before the first {@link play}.
   */
  getActiveClip(): { clip: string; time: number; duration: number } | null {
    if (this.blendActions.size > 0 || !this.current) return null;
    const action = this.actions.get(this.current);
    if (!action) return null;
    return { clip: this.current, time: action.time, duration: action.getClip().duration };
  }

  /** Whether a weighted blend (not a single clip) is currently driving the pose. */
  get isBlending(): boolean {
    return this.blendActions.size > 0;
  }

  /**
   * Crossfades to `name` over `duration` seconds. A no-op when it is already the
   * current clip or the name is unknown. The first play snaps in (there is
   * nothing to fade from); a non-positive `duration` also snaps. Leaving blend
   * mode (a prior {@link playBlend}) stops the weighted actions first.
   */
  play(name: string, duration = 0.2): void {
    if (this.blendActions.size > 0) this.stopBlend();
    // A ranged playback of this same clip is *not* the same thing as looping it
    // whole, so leaving a range always re-issues the action even when the clip
    // name is unchanged — otherwise a builder that stood up would stay penned
    // inside the section it just left.
    const leavingRange = this.range !== null;
    this.range = null;
    this.rangeDone = false;
    if (name === this.current && !leavingRange) return;
    const next = this.actions.get(name);
    if (!next) return;
    next.reset();
    next.enabled = true;
    next.setLoop(LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    const prev = this.current && this.current !== name ? this.actions.get(this.current) : undefined;
    if (prev && duration > 0) prev.crossFadeTo(next, duration, false);
    else if (prev) prev.stop();
    this.current = name;
  }

  /**
   * Plays only `range` of `name` — one montage section — either held on a loop
   * or once, clamped on its last pose.
   *
   * Three has no notion of a sub-clip, so the window is enforced by
   * {@link update}: the action itself loops the whole clip and the playhead is
   * wrapped (or clamped) at the section boundary each tick. That is why callers
   * driving ranges must tick through `update` rather than `mixer.update`.
   *
   * Re-issuing the same clip with the same window is a no-op, so a caller can
   * call it every frame while the section is held; a different window restarts
   * from its start.
   */
  playRange(name: string, range: AnimatorClipRange, fadeSeconds = 0.15): void {
    if (this.blendActions.size > 0) this.stopBlend();
    const next = this.actions.get(name);
    if (!next) return;
    if (
      name === this.current &&
      this.range &&
      this.range.startSeconds === range.startSeconds &&
      this.range.endSeconds === range.endSeconds &&
      this.range.loop === range.loop
    ) {
      return;
    }
    const prev = this.current && this.current !== name ? this.actions.get(this.current) : undefined;
    next.reset();
    next.enabled = true;
    next.setLoop(LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.time = range.startSeconds;
    next.play();
    if (prev && fadeSeconds > 0) prev.crossFadeTo(next, fadeSeconds, false);
    else if (prev) prev.stop();
    this.current = name;
    this.range = range;
    this.rangeDone = false;
    this.rangeLastTime = range.startSeconds;
  }

  /** True once a non-looping {@link playRange} section has played through. */
  get rangeFinished(): boolean {
    return this.rangeDone;
  }

  /**
   * Advances the mixer by `deltaSeconds` and keeps a {@link playRange} playhead
   * inside its section. Equivalent to `mixer.update` when no range is active.
   */
  update(deltaSeconds: number): void {
    this.mixer.update(deltaSeconds);
    const range = this.range;
    const action = this.current ? this.actions.get(this.current) : undefined;
    if (!range || !action) return;
    const span = range.endSeconds - range.startSeconds;
    if (span <= 0) return;
    // A section that reaches the clip's own end is wrapped by the mixer before
    // this runs, so the raw playhead alone cannot say whether the section ended.
    // Linearising against the previous frame's time catches both cases with the
    // same comparison.
    const duration = action.getClip().duration;
    const raw = action.time;
    const linear = raw < this.rangeLastTime - 1e-6 ? raw + duration : raw;
    if (linear < range.endSeconds) {
      this.rangeLastTime = raw < range.startSeconds ? range.startSeconds : raw;
      if (raw < range.startSeconds) action.time = range.startSeconds;
      return;
    }
    if (range.loop) {
      action.time = range.startSeconds + ((linear - range.startSeconds) % span);
    } else {
      action.time = range.endSeconds;
      this.rangeDone = true;
    }
    this.rangeLastTime = action.time;
  }

  /** Authored length of a clip in seconds, or null when this animator lacks it. */
  clipDuration(name: string): number | null {
    return this.actions.get(name)?.getClip().duration ?? null;
  }

  /**
   * Stops every action and drops the mixer's binding cache for `root`.
   *
   * Both halves matter and the second is the one that is easy to forget: the
   * cache is keyed by root, so an owner that only stops its actions keeps every
   * node it ever animated reachable for the mixer's lifetime — in an RTS, that is
   * every unit that has ever died.
   */
  release(root: Object3D): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(root);
  }

  /**
   * Plays `name` through exactly once and holds its final pose
   * (`clampWhenFinished`), for event clips like a swing or a death.
   *
   * Unlike {@link play} this always restarts, even when the clip is already
   * current: re-triggering the same clip is the normal case (a second sword
   * blow), and a no-op there would silently drop every swing after the first.
   * The looping state a later {@link play} crossfades to is unaffected, but the
   * one-shot's own action keeps its `LoopOnce` mode — so a clip must not be
   * driven through both entry points. `startSeconds` is used when an already
   * running full-body action is transferred to a masked channel without
   * restarting its visual or notify timeline.
   */
  playOnce(name: string, fadeSeconds = 0.08, startSeconds = 0): void {
    if (this.blendActions.size > 0) this.stopBlend();
    const next = this.actions.get(name);
    if (!next) return;
    this.range = null;
    this.rangeDone = false;
    next.reset();
    next.enabled = true;
    next.setLoop(LoopOnce, 1);
    next.clampWhenFinished = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.time = Math.max(0, Math.min(startSeconds, next.getClip().duration));
    next.play();
    const prev = this.current && this.current !== name ? this.actions.get(this.current) : undefined;
    if (prev && fadeSeconds > 0) prev.crossFadeTo(next, fadeSeconds, false);
    else if (prev) prev.stop();
    this.current = name;
  }

  /**
   * Scales playback of the current single-clip action; 1 is the authored speed.
   * A no-op in weighted-blend mode, where {@link playBlend} owns every action's
   * time scale to keep the contributing clips phase-synced.
   *
   * Callers re-apply this after each {@link play}, which resets the rate to 1 —
   * the rate is a property of how fast the entity is moving *now*, not of the
   * clip, so it belongs to the frame rather than to the transition.
   */
  setPlaybackRate(rate: number): void {
    if (this.blendActions.size > 0 || !this.current) return;
    this.actions.get(this.current)?.setEffectiveTimeScale(rate);
  }

  /**
   * Drives a weighted blend of clips (a blend space's resolved weights). Weights
   * are re-normalized; unknown/zero-weight clips are ignored. Contributing clips
   * are kept phase-synced — each runs at a time scale that makes every clip
   * complete one loop over the same blend-weighted reference duration, so a
   * walk↔run blend keeps its footfalls aligned. Newly contributing clips join at
   * the current normalized phase. A no-op when nothing valid contributes (the
   * existing pose is held). Call once per tick with fresh weights.
   */
  playBlend(weights: readonly AnimatorBlendWeight[]): void {
    const valid = weights.filter((entry) => entry.weight > 0 && this.actions.has(entry.clip));
    const total = valid.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return;
    // Leaving single-clip mode: stop the lone action so it stops contributing.
    if (this.current) {
      this.actions.get(this.current)?.stop();
      this.current = null;
    }
    this.range = null;
    this.rangeDone = false;
    const phase = this.blendPhase();
    let refDuration = 0;
    for (const entry of valid) {
      refDuration += this.actions.get(entry.clip)!.getClip().duration * (entry.weight / total);
    }
    if (refDuration <= 1e-4) refDuration = 1;
    const desired = new Set(valid.map((entry) => entry.clip));
    for (const [name, action] of this.blendActions) {
      if (desired.has(name)) continue;
      action.stop();
      this.blendActions.delete(name);
    }
    for (const entry of valid) {
      let action = this.blendActions.get(entry.clip);
      if (!action) {
        action = this.actions.get(entry.clip)!;
        action.reset();
        action.enabled = true;
        action.setLoop(LoopRepeat, Infinity);
        const duration = action.getClip().duration;
        action.time = phase * duration;
        action.play();
        this.blendActions.set(entry.clip, action);
      }
      action.setEffectiveWeight(entry.weight / total);
      action.setEffectiveTimeScale(action.getClip().duration / refDuration);
    }
  }

  /** Normalized [0,1) phase of the dominant blend action, for aligning joiners. */
  private blendPhase(): number {
    let dominant: AnimationAction | null = null;
    let bestWeight = -1;
    for (const action of this.blendActions.values()) {
      const weight = action.getEffectiveWeight();
      if (weight > bestWeight) {
        bestWeight = weight;
        dominant = action;
      }
    }
    if (!dominant) return 0;
    const duration = dominant.getClip().duration;
    return duration > 0 ? (dominant.time % duration) / duration : 0;
  }

  private stopBlend(): void {
    for (const action of this.blendActions.values()) action.stop();
    this.blendActions.clear();
  }
}
