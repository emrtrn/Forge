/**
 * The sinks a behavior registry calls back into: the runtime world around the
 * scripts.
 *
 * The *behaviors* are game content (`src/game/behaviors.ts` in the template),
 * but this host contract is not: the runtime shell fills it in, and a fork's own
 * registry is handed exactly the same set. Keeping it in the engine lets the
 * shell describe what it offers without importing the game (Layer 3), which is
 * how a fork replaces the behavior catalog through its game module.
 */
import type { LocomotionInput } from "../movement/locomotionAnimation";

export interface BehaviorRegistryHost {
  /** World gravity on Y (units/s^2; negative = down). Defaults to -9.81. */
  getGravityY?: () => number;
  /**
   * Sink for the player's per-tick movement snapshot, which the runtime shell
   * maps to an animation clip (G5). Optional: headless tests omit it.
   */
  reportLocomotion?: (entityId: string, report: LocomotionInput) => void;
  /**
   * Fired once when a `goal-reached` trigger first registers a contact (G6).
   * The runtime shell uses it for feedback (e.g. a log); headless tests spy on it.
   */
  onGoalReached?: (entityId: string) => void;
  /**
   * Fired when an `interact` trigger fires (§3 Interaction runtime): the player
   * entered an interaction-marked sensor and it was enabled + off cooldown. The
   * project game rules interpret `action`; the shell logs it, tests spy on it.
   */
  onInteraction?: (entityId: string, action: string) => void;
  /**
   * Fired when an interaction sensor begins/ends overlap. Runtime shells can use
   * this for prompts without coupling UI code into the behavior layer.
   */
  onInteractionOverlap?: (
    entityId: string,
    action: string,
    prompt: string | undefined,
    overlapping: boolean,
  ) => void;
  /** Runtime shell sink for the built-in lamp-toggle behavior. */
  onActorLightToggle?: (entityId: string, enabled: boolean) => void;
  /** Runtime shell sink for one-shot actor VFX triggered by message behaviors. */
  onActorParticleEffect?: (entityId: string) => void;
  // Note: collectible hiding now flows through the generic actor command surface
  // (`context.actor.setVisibility(false)` → host `actorCommandSink`, A1), not a
  // bespoke sink option.
  /**
   * Whether the named entity is the player-controlled (possessed) pawn this Play
   * boot. `input-move` only reads input + moves when this is true, so a character
   * carrying the behavior stays put unless the active Game Mode possesses it
   * (e.g. the default camera mode possesses no character). Absent means "always
   * controlled" so headless tests drive the behavior directly.
   */
  isPlayerControlled?: (entityId: string) => boolean;
  /**
   * Fired once when a `level-travel` sensor first registers a contact (P2 Level
   * Travel): the player entered a travel trigger. The runtime shell drives the
   * scene teardown/rebuild + respawn; headless tests spy on it. `targetLevel` is
   * the destination layout path, `targetSpawn` the optional Player Start tag.
   */
  onLevelTravel?: (entityId: string, targetLevel: string, targetSpawn?: string) => void;
  /**
   * Fired once when a `checkpoint` sensor first registers a contact (P3.6
   * Save-Game): the player crossed a checkpoint. The runtime shell serializes the
   * current game state and writes it to the named save slot; headless tests spy
   * on it. `slot` is the destination save slot key (default `"quick"`).
   */
  onCheckpoint?: (entityId: string, slot: string) => void;
}
