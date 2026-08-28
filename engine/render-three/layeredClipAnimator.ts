/**
 * Two-channel clip animator: the legs keep their locomotion while a one-shot
 * owns the torso.
 *
 * The same body-mask idea as {@link LayeredCharacterAnimator} — Unreal's
 * "Layered Blend Per Bone" + Slot, as data — but with the opposite ownership
 * model. There, the animator holds the montage's own timer and an aim pose,
 * because a TPS character's shell asks it to *play a montage* and forgets about
 * it. Here the caller already runs a pure state machine that knows exactly which
 * one-shot is playing and how much of it is left, so this class holds no timing
 * at all: it is told what each channel should be showing, and when the torso is
 * handed back.
 *
 * That is also why it ticks its own mixers ({@link update}, matching
 * {@link CrossfadeAnimator.update}) rather than exposing them to an
 * `AnimationSubsystem`: the caller's own loop owns the tick, which is what lets
 * a crowd-scale driver throttle it by distance.
 *
 * Three-touching, so it lives in `engine/render-three`. It holds no game rules —
 * "a walking character flinches from the waist up" is a decision the caller
 * makes.
 */
import { type AnimationClip, type Object3D } from "three";
import { CrossfadeAnimator, type AnimatorClipRange } from "./characterAnimator";
import { collectSubtreeNodeNames, splitClipsByUpperBody } from "./bodyMask";
import { applyRootMotionToClips, type RootMotionClipSetting } from "./rootMotion";

/**
 * The playback surface a character presentation drives, satisfied by both the
 * plain {@link CrossfadeAnimator} and the layered one.
 *
 * It exists so the driver is written once. An asset that authors no upper-body
 * bone must keep exactly its previous single-mixer cost and behaviour, and the
 * way to guarantee that is for the layered class to be *absent* from its path
 * rather than present and disabled.
 */
export interface UnitClipAnimator {
  readonly clips: ReadonlySet<string>;
  play(name: string, fadeSeconds?: number): void;
  playOnce(name: string, fadeSeconds?: number): void;
  playRange(name: string, range: AnimatorClipRange, fadeSeconds?: number): void;
  setPlaybackRate(rate: number): void;
  clipDuration(name: string): number | null;
  /**
   * The clip driving the body right now, with its playhead — what an animation
   * notify detector measures against. Null when nothing is playing.
   */
  getActiveClip(): { clip: string; time: number; duration: number } | null;
  update(deltaSeconds: number): void;
  release(root: Object3D): void;
}

export class LayeredClipAnimator implements UnitClipAnimator {
  /** All clip names either channel can play, under their original names. */
  readonly clips: ReadonlySet<string>;
  private readonly lower: CrossfadeAnimator;
  private readonly upper: CrossfadeAnimator;
  private readonly durations = new Map<string, number>();
  private readonly matched: boolean;
  /** The locomotion clip the torso mirrors whenever no one-shot owns it. */
  private passthrough: string | null = null;
  /** True while a one-shot owns the torso and locomotion must not touch it. */
  private upperOwned = false;
  /**
   * A held upper-body pose — the second way the torso can leave the legs, and
   * the one with no timer at all.
   *
   * {@link playUpperOnce} covers an *event* (a flinch, a swing): it ends by
   * itself and hands the torso back. This covers a *condition* — a character
   * carrying a crate holds it for as long as it is loaded, and no length of clip
   * says when that stops. So it is a pose the caller sets and clears from the
   * same snapshot that draws the crate, rather than something the animator
   * counts down.
   *
   * A one-shot still outranks it: a struck carrier flinches, and the flinch ends
   * back into the carry rather than into the legs.
   */
  private upperPose: string | null = null;

  constructor(
    root: Object3D,
    clips: readonly AnimationClip[],
    upperBodyBone: string,
    options: { readonly rootMotion?: readonly RootMotionClipSetting[] } = {},
  ) {
    // Root motion is locked before the split, never after. A masked half no
    // longer carries the hip position track the lock is aimed at, and
    // `resolveRootMotionNode` falls back to the first position track it *does*
    // find — so locking the upper half would pin some arbitrary arm bone in
    // place instead of the root.
    const playable = applyRootMotionToClips(clips, options.rootMotion, root);
    const upperNames = collectSubtreeNodeNames(root, upperBodyBone);
    this.matched = upperNames.size > 0;
    const split = splitClipsByUpperBody(playable, upperNames);
    this.lower = new CrossfadeAnimator(root, split.lower);
    this.upper = new CrossfadeAnimator(root, split.upper);
    this.clips = new Set(clips.map((clip) => clip.name));
    for (const clip of clips) this.durations.set(clip.name, clip.duration);
  }

  /**
   * True when the authored bone matched real nodes. False means the mask is
   * empty — every track landed on the lower channel — so layering would be a
   * silent no-op and the caller should treat the asset as full-body.
   */
  get hasUpperBody(): boolean {
    return this.matched;
  }

  /** Current lower-channel (legs) clip, for tests and debug readouts. */
  get lowerClip(): string | null {
    return this.lower.currentClip;
  }

  /** Current upper-channel (torso/arms/head) clip, for tests and debug readouts. */
  get upperClip(): string | null {
    return this.upper.currentClip;
  }

  /** True while a one-shot owns the torso alone. */
  get isUpperBusy(): boolean {
    return this.upperOwned;
  }

  /**
   * The body's clip and playhead — always the lower channel's.
   *
   * The lower channel is the one that is never a duplicate: a full-body play
   * puts the same clip on both channels, so reading both would fire every one of
   * that clip's notifies twice. What the torso can hold *alone* is exposed
   * separately by {@link getUpperActiveClip}, and only while it holds it.
   */
  getActiveClip(): { clip: string; time: number; duration: number } | null {
    return this.lower.getActiveClip();
  }

  /**
   * The clip on the torso while a {@link playUpperOnce} owns it, else null.
   *
   * Null the rest of the time by construction, not by preference: whenever no
   * one-shot owns the torso it is mirroring the legs, and the pair would be the
   * same clip counted twice.
   */
  getUpperActiveClip(): { clip: string; time: number; duration: number } | null {
    return this.upperOwned ? this.upper.getActiveClip() : null;
  }

  /**
   * Continuous locomotion. Drives the legs always, and the torso only while no
   * one-shot owns it — which is what lets a struck character keep walking underneath
   * its flinch, and what makes the flinch end into the *current* gait rather
   * than into whichever one was playing when the blow landed.
   */
  play(name: string, fadeSeconds = 0.2): void {
    this.lower.play(name, fadeSeconds);
    this.passthrough = name;
    if (!this.upperOwned && !this.upperPose) this.upper.play(name, fadeSeconds);
  }

  /** A one-shot across the whole body — a swing, a fall. Reclaims the torso. */
  playOnce(name: string, fadeSeconds = 0.08): void {
    this.upperOwned = false;
    this.upperPose = null;
    this.lower.playOnce(name, fadeSeconds);
    this.upper.playOnce(name, fadeSeconds);
  }

  /** A montage section across the whole body — the work animation. Reclaims the torso. */
  playRange(name: string, range: AnimatorClipRange, fadeSeconds = 0.15): void {
    this.upperOwned = false;
    this.upperPose = null;
    this.lower.playRange(name, range, fadeSeconds);
    this.upper.playRange(name, range, fadeSeconds);
  }

  /**
   * Hold `name` on the torso for as long as the caller keeps asking for it, or
   * hand the torso back to the legs with `null`.
   *
   * Idempotent by clip name, because the caller re-states it from a per-frame
   * snapshot: re-issuing the same pose must not restart it, or a carried crate
   * would twitch back to the first frame of its hold sixty times a second.
   *
   * Setting a pose while a one-shot owns the torso only records it. That is
   * deliberate — the flinch keeps the torso it claimed, and
   * {@link releaseUpperBody} then lands on the pose instead of the gait.
   *
   * A clip this asset does not ship is refused rather than treated as `null`, so
   * a partial sidecar leaves the torso mirroring the legs — the same
   * "hold what you had" degradation an unresolved animation role gives the full
   * body.
   */
  setUpperBodyPose(name: string | null, fadeSeconds = 0.18): void {
    if (name !== null && !this.clips.has(name)) return;
    if (this.upperPose === name) return;
    this.upperPose = name;
    if (this.upperOwned) return;
    if (name !== null) this.upper.play(name, fadeSeconds);
    else if (this.passthrough) this.upper.play(this.passthrough, fadeSeconds);
  }

  /** The held pose, or null. For tests and debug readouts. */
  get upperBodyPose(): string | null {
    return this.upperPose;
  }

  /**
   * A one-shot on the torso alone, leaving the legs on whatever they are doing.
   * Always restarts, like {@link CrossfadeAnimator.playOnce}: re-triggering is
   * the normal case, and the caller decides when a blow is a *new* one.
   * `startSeconds` preserves progress when a running full-body action is
   * promoted to this channel after locomotion begins.
   */
  playUpperOnce(name: string, fadeSeconds = 0.08, startSeconds = 0): void {
    if (!this.clips.has(name)) return;
    this.upperOwned = true;
    this.upper.playOnce(name, fadeSeconds, startSeconds);
  }

  /**
   * Hands the torso back to locomotion. A no-op unless a
   * {@link playUpperOnce} owns it, so the full-body paths are never disturbed.
   */
  releaseUpperBody(fadeSeconds = 0.18): void {
    if (!this.upperOwned) return;
    this.upperOwned = false;
    // The held pose first: a carrier who was struck mid-walk goes back to
    // holding his load, not to swinging his arms with an invisible crate.
    const resume = this.upperPose ?? this.passthrough;
    if (resume) this.upper.play(resume, fadeSeconds);
  }

  /**
   * Scales locomotion playback. The torso follows only while it is mirroring the
   * legs: a flinch is timed against the blow that caused it, not against how
   * fast the character happens to be walking, and speeding it up with the gait would
   * make a shoved character's reaction stutter.
   */
  setPlaybackRate(rate: number): void {
    this.lower.setPlaybackRate(rate);
    // A held pose is excluded for the same reason a flinch is: it is timed
    // against the condition that raised it, not against how fast the legs
    // happen to be moving, so a running carrier must not hold its load at
    // double speed.
    if (!this.upperOwned && !this.upperPose) this.upper.setPlaybackRate(rate);
  }

  /** Authored length of a clip, taken from the unsplit original. */
  clipDuration(name: string): number | null {
    return this.durations.get(name) ?? null;
  }

  /** Advances both channels, each keeping its own range window. */
  update(deltaSeconds: number): void {
    this.lower.update(deltaSeconds);
    this.upper.update(deltaSeconds);
  }

  /** Stops both channels and releases their binding caches for `root`. */
  release(root: Object3D): void {
    this.lower.release(root);
    this.upper.release(root);
  }
}
