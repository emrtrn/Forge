/**
 * The runtime's shared-service contract: every handle a capability module may
 * publish or look up, in one place.
 *
 * Keeping the keys here (rather than each module exporting its own) makes the
 * loose-coupling surface between Layer 2 modules readable as a list, and lets a
 * consumer depend on a *capability* without importing the module that currently
 * happens to implement it. Every service is optional by construction: `resolve`
 * returning `undefined` means the providing module is switched off, which
 * modules must handle as normal (I3 — opting a module out removes only its
 * behavior).
 *
 * Some services are still provided by `RuntimeSceneApp` while the matching
 * subsystem is baked into the shell; as later Phase E slices extract those,
 * the provider moves to the module without the consumers changing.
 */
import type {
  ScriptMessageEnvelope,
  ScriptMessagePayload,
} from "@engine/behavior/scriptMessages";
import type {
  DialogueAudioPlayback,
  DialogueAudioRequest,
} from "@engine/dialogue/dialogueSubsystem";
import type { MovingPlatformQuery } from "@engine/physics/movingPlatformSubsystem";
import type {
  GameSaveRestoreRequest,
  GameSaveState,
} from "@engine/persistence/saveGameState";
import type { PhysicsTransformSink } from "@engine/physics/physicsSubsystem";
import type { SplinePathFollowerDebugState } from "@engine/scene/splinePathFollower";
import type { SplineRegistry } from "@engine/scene/splineRegistry";
import type { UiViewModelStore } from "@engine/ui/uiViewModel";

import { runtimeServiceKey } from "./RuntimeServices";

/**
 * Live kinematic platforms for this frame. The character movement solver reads
 * it to collide with, stand on, and be carried by a platform.
 * Provided by: `movingPlatformModule`.
 */
export const movingPlatformQueryService =
  runtimeServiceKey<MovingPlatformQuery>("moving-platform-query");

/**
 * The current level's spline registry. It is re-created per level, so the
 * service is a getter rather than the registry itself.
 * Provided by: the runtime shell (owner of the built level's splines).
 */
export const splineRegistrySourceService =
  runtimeServiceKey<() => SplineRegistry>("spline-registry-source");

/**
 * Teleports an entity in the character movement solver's own state and syncs
 * the result to render/physics. A mover that writes a transform directly (a
 * spline route) must call this, or the solver overwrites it from its stale
 * local copy on the next frame.
 * Provided by: the runtime shell (character movement is still baked in).
 */
export const characterTransformResetService =
  runtimeServiceKey<PhysicsTransformSink>("character-transform-reset");

/**
 * The script-message bus: how gameplay triggers a capability ("play-dialogue")
 * and how a capability reports back onto the bus ("conversation" events).
 * Provided by: the runtime shell (the behavior subsystem owns the bus).
 */
export interface ScriptMessageBus {
  subscribe(type: string, handler: (envelope: ScriptMessageEnvelope) => void): () => void;
  emit(type: string, source: string, payload?: ScriptMessagePayload): void;
}

export const scriptMessageBusService = runtimeServiceKey<ScriptMessageBus>("script-message-bus");

/**
 * Plays a resolved dialogue line's audio and hands back a stop handle, or null
 * when nothing could be played (subtitle timing then falls back to its
 * text-length estimate).
 * Provided by: the runtime shell (audio + sound cues are still baked in).
 */
export type DialogueAudioPlayer = (
  request: DialogueAudioRequest,
) => DialogueAudioPlayback | null;

export const dialogueAudioService = runtimeServiceKey<DialogueAudioPlayer>("dialogue-audio");

/**
 * Subtitle localization against the active `.loc.json` table.
 * Provided by: the runtime shell (the locale registry is shared with the UI).
 */
export interface SubtitleLocalization {
  /** Loads the locale tables if the UI has not already — a scene may have no HUD. */
  ensureLoaded(): Promise<void>;
  /** Live lookup, so switching locale takes effect without re-registering lines. */
  resolveSubtitle(key: string): string | undefined;
}

export const subtitleLocalizationService =
  runtimeServiceKey<SubtitleLocalization>("subtitle-localization");

/**
 * Stable id of the active project, used to namespace anything persisted for it
 * (save slots today, more later). A getter, because the project manifest is
 * loaded asynchronously after the shell is constructed; `null` means "no project
 * loaded yet", so a consumer must resolve it at use time, not at start time.
 * Provided by: the runtime shell (owner of the active project).
 */
export const projectIdentityService = runtimeServiceKey<() => string | null>("project-identity");

/**
 * Capturing and restoring the *gameplay* half of a save: which entity the player
 * possesses, where it stands, and the persistent behavior state. It stays in the
 * shell because it reads live game-mode/character/behavior state; the save
 * capability owns only the slots, the storage and the load handshake.
 * Provided by: the runtime shell.
 */
export interface GameplaySaveState {
  /** Current savable state, or null when there is nothing savable yet (pre-boot). */
  capture(): GameSaveState | null;
  /** Applies a decoded restore to the live scene (persistent state + player pawn). */
  restore(request: GameSaveRestoreRequest): void;
}

export const gameplaySaveStateService =
  runtimeServiceKey<GameplaySaveState>("gameplay-save-state");

/**
 * Enqueues a level change, the same handoff a portal uses. Loading a save is a
 * travel to the saved level followed by a restore, so the capability needs this
 * rather than a level loader of its own.
 * Provided by: the runtime shell (the travel coordinator owns the queue).
 */
export const levelTravelService = runtimeServiceKey<(levelPath: string) => void>("level-travel");

/**
 * The UI ViewModel store a HUD binds to. A capability writes its fields
 * (`save.slots.*`) and flushes; without a store, the capability still works and
 * simply has nothing to display.
 * Provided by: the runtime shell (runtime UI is still baked in).
 */
export const uiViewModelService = runtimeServiceKey<UiViewModelStore>("ui-view-model");

/**
 * Closing whatever screen stack is open, returning to gameplay — what a
 * successful "Load" click must do to the pause menu it was clicked in.
 * Provided by: the runtime shell (runtime UI is still baked in).
 */
export interface UiScreenStack {
  clearScreens(): void;
}

export const uiScreenStackService = runtimeServiceKey<UiScreenStack>("ui-screen-stack");

/**
 * The save capability's command surface, for the shell hooks that can only live
 * where the event arrives: a widget message, a `checkpoint` behavior firing, a
 * travel superseding a load in flight, and the shell's public load entry point.
 * `undefined` means the module is off — save widget messages then fall through
 * to gameplay as ordinary `ui-action` messages and checkpoints do nothing.
 * Provided by: `saveGameModule`.
 */
export interface SaveGameCommands {
  /** Handles a reserved `save:*` widget message; false = not ours, keep routing. */
  handleUiMessage(message: string): boolean;
  /** Autosaves into `slot` from a `checkpoint` behavior; never interrupts play. */
  writeCheckpointSave(slot: string): void;
  /** Loads a decoded payload: travels to its level, then restores after the build. */
  requestSaveGameLoad(payload: unknown): boolean;
  /** Drops a latched restore because a different travel superseded it. */
  clearPendingRestore(): void;
}

export const saveGameCommandsService = runtimeServiceKey<SaveGameCommands>("save-game-commands");

/** Read side of the spline-follower debug overlay (`?debug`) and browser smokes. */
export interface SplineFollowerDebugSource {
  followers(): readonly SplinePathFollowerDebugState[];
}

/** Provided by: `splineFollowerModule`. */
export const splineFollowerDebugService =
  runtimeServiceKey<SplineFollowerDebugSource>("spline-follower-debug");
