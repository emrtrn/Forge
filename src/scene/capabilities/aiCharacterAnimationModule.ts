/**
 * Phase F: AI character animation is a Layer 2 capability.
 *
 * An AI-controlled character animates from what the world reports about it —
 * its locomotion snapshot each frame, and the attack intents its Behavior Tree
 * emits as script messages — rather than from a Game Mode possessing it. That
 * made it the last piece of character animation still baked into the runtime
 * shell; it lives here so a fork with no AI (or no characters at all) pays
 * nothing for it, and a shell with this module off falls back to the plain
 * authored clip.
 *
 * The module owns the crossfade animators, their blend-space configs and the
 * one-shot attack overrides. It does *not* decide which characters are AI
 * controlled: the shell registers a character when the Game Mode leaves it
 * unpossessed, since only the shell knows what the mode possessed.
 */
import type { AnimationMixer } from "three";

import { CrossfadeAnimator } from "@engine/render-three/characterAnimator";
import {
  DEFAULT_LOCOMOTION_THRESHOLDS,
  locomotionConfigForSkeleton,
  resolveLocomotionAnimation,
} from "@engine/movement/locomotionAnimation";
import type { ScriptMessagePayload } from "@engine/behavior/scriptMessages";

import type { RuntimeCharacterRef } from "../gameModeTypes";
import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import {
  characterAnimationCommandsService,
  characterAnimationHostService,
  scriptMessageBusService,
} from "./runtimeServiceKeys";

export const AI_CHARACTER_ANIMATION_MODULE_ID = "ai-character-animation";

/**
 * Attack-intent message types this module turns into a one-shot clip. Two names
 * because the built-in AI and a boss-style script both emit an attack intent.
 */
const ATTACK_MESSAGE_TYPES = ["ai.attack.intent", "boss.attack.intent"] as const;

/** Blend-out for a finished one-shot, and the crossfade for ordinary locomotion. */
const ONE_SHOT_BLEND_OUT_SECONDS = 0.14;
const LOCOMOTION_FADE_SECONDS = 0.18;
const ATTACK_FADE_IN_SECONDS = 0.08;
/** Used when the played clip reports no duration (a malformed/synthetic clip). */
const FALLBACK_ATTACK_SECONDS = 0.65;

interface AnimatedAiCharacter {
  readonly ref: RuntimeCharacterRef;
  readonly animator: CrossfadeAnimator;
  readonly config: ReturnType<typeof locomotionConfigForSkeleton>;
  oneShot: { clip: string; remaining: number; blendOutSeconds: number } | null;
}

/**
 * Picks the clip for an attack intent: the payload's explicit `animation`, then
 * its `attack` name (as written and capitalised), then a generic `Punch`. Clip
 * names are matched case-insensitively as a fallback, because authored GLB clip
 * names vary in casing between exporters.
 */
function resolveAttackClip(
  payload: ScriptMessagePayload,
  clips: ReadonlySet<string>,
): string | null {
  const candidates: string[] = [];
  const animation = payload.animation;
  if (typeof animation === "string") candidates.push(animation);
  const attack = payload.attack;
  if (typeof attack === "string") {
    candidates.push(attack);
    candidates.push(`${attack.charAt(0).toUpperCase()}${attack.slice(1)}`);
  }
  candidates.push("Punch");
  for (const candidate of candidates) {
    if (clips.has(candidate)) return candidate;
    const caseInsensitive = [...clips].find(
      (clip) => clip.toLowerCase() === candidate.toLowerCase(),
    );
    if (caseInsensitive) return caseInsensitive;
  }
  return null;
}

export function createAiCharacterAnimationModule(): CapabilityModule {
  const animated = new Map<string, AnimatedAiCharacter>();
  let services: RuntimeServices | null = null;
  let unsubscribes: Array<() => void> = [];

  const playAttack = (entityId: string, payload: ScriptMessagePayload): void => {
    const runtime = animated.get(entityId);
    // A one-shot already running wins: an attack chain must not restart itself
    // every frame the Behavior Tree re-emits the intent.
    if (!runtime || runtime.oneShot) return;
    const clip = resolveAttackClip(payload, runtime.animator.clips);
    if (!clip) return;
    runtime.animator.play(clip, ATTACK_FADE_IN_SECONDS);
    const duration = runtime.animator.getActiveClip()?.duration ?? FALLBACK_ATTACK_SECONDS;
    runtime.oneShot = {
      clip,
      remaining: Math.max(0.1, duration),
      blendOutSeconds: ONE_SHOT_BLEND_OUT_SECONDS,
    };
  };

  return {
    id: AI_CHARACTER_ANIMATION_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      // No host means no animation subsystem to drive and no locomotion to read:
      // stay unregistered rather than building animators nothing would tick.
      if (!runtimeServices.resolve(characterAnimationHostService)) return;
      services = runtimeServices;
      runtimeServices.provide(characterAnimationCommandsService, {
        registerAiCharacter: (ref: RuntimeCharacterRef): boolean => {
          const host = runtimeServices.resolve(characterAnimationHostService);
          if (!host) return false;
          const config = locomotionConfigForSkeleton(ref.skeleton);
          const animator = new CrossfadeAnimator(ref.object, ref.gltf.animations, {
            ...(ref.skeleton?.rootMotion ? { rootMotion: ref.skeleton.rootMotion } : {}),
          });
          const initial = resolveLocomotionAnimation(
            { planarSpeed: 0, grounded: true, velocityY: 0 },
            animator.clips,
            config,
            DEFAULT_LOCOMOTION_THRESHOLDS,
          );
          if (initial.kind === "blend") animator.playBlend(initial.weights);
          else if (initial.clip) animator.play(initial.clip, 0);
          const mixer: AnimationMixer = animator.mixer;
          host.addMixer(mixer, () => host.distanceSquaredToCamera(ref.object));
          animated.set(ref.entityId, { ref, animator, config, oneShot: null });
          return true;
        },
      });
    },

    onLevelLoaded() {
      // Re-subscribed per level, mirroring how the level's entities are re-fed:
      // a handler must never outlive the animators it looks up.
      for (const unsubscribe of unsubscribes) unsubscribe();
      const bus = services?.resolve(scriptMessageBusService);
      unsubscribes = bus
        ? ATTACK_MESSAGE_TYPES.map((type) =>
            bus.subscribe(type, (envelope) => playAttack(envelope.source, envelope.payload)),
          )
        : [];
    },

    update(deltaSeconds) {
      const host = services?.resolve(characterAnimationHostService);
      if (!host) return;
      const possessed = host.possessedEntityId();
      for (const [entityId, runtime] of animated) {
        // The possessed pawn is the Game Mode's to animate, even if it was
        // registered as an AI character before possession moved to it.
        if (entityId === possessed) continue;
        let fadeSeconds = deltaSeconds > 0 ? LOCOMOTION_FADE_SECONDS : 0;
        if (runtime.oneShot) {
          runtime.oneShot.remaining -= Math.max(0, deltaSeconds);
          if (runtime.oneShot.remaining > 0) continue;
          fadeSeconds = runtime.oneShot.blendOutSeconds;
          runtime.oneShot = null;
        }
        const report = host.locomotion(entityId);
        const result = resolveLocomotionAnimation(
          report ?? { planarSpeed: 0, grounded: true, velocityY: 0 },
          runtime.animator.clips,
          runtime.config,
          DEFAULT_LOCOMOTION_THRESHOLDS,
        );
        if (result.kind === "blend") runtime.animator.playBlend(result.weights);
        else if (result.clip) runtime.animator.play(result.clip, fadeSeconds);
      }
    },

    onLevelUnloaded() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      // The mixers themselves belong to the shell's animation subsystem, which
      // clears on teardown; dropping the refs here is what keeps a torn-down
      // level's characters from being animated into the next one.
      animated.clear();
    },

    dispose() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      animated.clear();
    },
  };
}
