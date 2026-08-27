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
import type { Vector3 } from "three";

import type { AiDebugSnapshot, AiDistanceUpdateSettings } from "@engine/ai/aiSubsystem";
import type { AiTaskRegistry } from "@engine/ai/behaviorRunner";
import type { AssetManifest } from "@engine/assets/manifest";
import type { AudioBus } from "@engine/audio/audioSubsystem";
import type { AudioBusId } from "@engine/audio/audioBus";
import type {
  LaunchOptions,
  PhysicsAabb,
  PhysicsQuery,
  PhysicsSurfaceTriangle,
} from "@engine/behavior/behaviorSubsystem";
import type {
  ScriptMessageEnvelope,
  ScriptMessagePayload,
} from "@engine/behavior/scriptMessages";
import type { ActionMap } from "@engine/input/actionMap";
import type { CharacterMoveIntent } from "@engine/movement/characterMovementSubsystem";
import type { Aabb3 } from "@engine/movement/characterCollision";
import type { LocomotionInput } from "@engine/movement/locomotionAnimation";
import type { TransformComponent } from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import type { SceneDocument } from "@engine/scene/sceneDocument";
import type {
  DialogueAudioPlayback,
  DialogueAudioRequest,
} from "@engine/dialogue/dialogueSubsystem";
import type {
  NavAabb,
  NavBlocker,
  PathFollowingState,
} from "@engine/navigation/gridNavigation";
import type { MovingPlatformQuery } from "@engine/physics/movingPlatformSubsystem";
import type {
  GameSaveRestoreRequest,
  GameSaveState,
} from "@engine/persistence/saveGameState";
import type { PhysicsTransformSink } from "@engine/physics/physicsSubsystem";
import type { AiNavAgentClearanceView } from "@engine/render-three/aiNavigationView";
import type { RoomLayout, Vec3 } from "@engine/scene/layout";
import type { SplinePathFollowerDebugState } from "@engine/scene/splinePathFollower";
import type { SplineRegistry } from "@engine/scene/splineRegistry";
import type { LocaleRegistry } from "@engine/ui/uiLocale";
import type { UiViewModelStore } from "@engine/ui/uiViewModel";
import type { UiSubsystemDebugSnapshot } from "@/ui/RuntimeUiSubsystem";
import type { WorldUiDebugSnapshot } from "@/ui/WorldUiSubsystem";

import type { AssetSkeletonDef } from "../assetSkeletonLoader";

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
 * local copy on the next frame. `undefined` means no solver exists, so the
 * mover writes the transform directly.
 * Provided by: `characterMovementModule`.
 */
export const characterTransformResetService =
  runtimeServiceKey<PhysicsTransformSink>("character-transform-reset");

/**
 * Reading the character movement solver's live state. Everything the shell asks
 * of the solver from outside its own tick: where a character is, how fast it is
 * going, iterating them all (neighbor avoidance, blocker AABBs) and launching
 * one (knockback). `undefined` means no solver is registered, and every caller
 * degrades to "there are no solved characters" — the case a top-down game with
 * no pawns wants.
 * Provided by: `characterMovementModule`.
 */
export interface CharacterMovementQuery {
  transformOf(entityId: string): TransformComponent | null;
  velocityOf(entityId: string): readonly [number, number, number] | null;
  forEachCharacter(
    visit: (entityId: string, transform: Readonly<TransformComponent>) => void,
  ): void;
  launch(
    entityId: string,
    velocity: readonly [number, number, number],
    options?: LaunchOptions,
  ): void;
}

export const characterMovementQueryService =
  runtimeServiceKey<CharacterMovementQuery>("character-movement-query");

/**
 * What the movement solver needs from the world it moves characters through.
 * All of it is shell-owned live state — gravity from the level, control yaw and
 * possession from the Game Mode (Layer 3), AI move intents, the physics query
 * the solver traces against — so it is handed in rather than reached for.
 * Without it the module registers no solver at all: there is nothing to move
 * characters *with*.
 * Provided by: the runtime shell.
 */
export interface CharacterMovementHost {
  /** Input actions the possessed pawn is driven by. */
  readonly actions: ActionMap;
  /** Collider/ground queries the solver traces against (Layer 1 physics). */
  readonly physics: PhysicsQuery;
  getGravityY(): number;
  /** Camera-relative yaw the Game Mode wants this entity to move along. */
  getControlYaw(entityId: string): number | null | undefined;
  /** True only for the pawn the Game Mode possessed, while input is not in UI. */
  isPlayerControlled(entityId: string): boolean;
  /** This frame's AI move intent for a non-possessed character, if any. */
  getMoveIntent(
    entityId: string,
    transform: Readonly<TransformComponent>,
    deltaSeconds: number,
  ): CharacterMoveIntent | null | undefined;
  /** Publishes the per-frame locomotion snapshot HUD/animation read. */
  reportLocomotion(entityId: string, report: LocomotionInput): void;
  /** Other characters' AABBs, so pawns do not walk through each other. */
  dynamicBlockers(entityId: string, transform: Readonly<TransformComponent>): readonly Aabb3[];
}

export const characterMovementHostService =
  runtimeServiceKey<CharacterMovementHost>("character-movement-host");

/**
 * The script-message bus: how gameplay triggers a capability ("play-dialogue")
 * and how a capability reports back onto the bus ("conversation" events).
 * Provided by: the runtime shell (the behavior subsystem owns the bus).
 */
export interface ScriptMessageBus {
  subscribe(type: string, handler: (envelope: ScriptMessageEnvelope) => void): () => void;
  /** `target` addresses one entity; omitted broadcasts to every subscriber. */
  emit(type: string, source: string, payload?: ScriptMessagePayload, target?: string): void;
}

export const scriptMessageBusService = runtimeServiceKey<ScriptMessageBus>("script-message-bus");

/**
 * Plays a resolved dialogue line's audio and hands back a stop handle, or null
 * when nothing could be played (subtitle timing then falls back to its
 * text-length estimate).
 * Provided by: `audioModule`.
 */
export type DialogueAudioPlayer = (
  request: DialogueAudioRequest,
) => DialogueAudioPlayback | null;

export const dialogueAudioService = runtimeServiceKey<DialogueAudioPlayer>("dialogue-audio");

/**
 * Everything the runtime asks of whichever capability owns sound. The shell
 * drives the parts only it knows the timing of — resolving this level's audio
 * assets before anything can play, starting the built level's ambient emitters,
 * and pushing the listener pose after the camera has moved this frame — while
 * `bus` is the plain play surface behaviors and spawned actors reach through.
 *
 * `undefined` means the module is off: scripts' `playSound` becomes a no-op,
 * ambient emitters never start, and the settings screen's volume sliders persist
 * a preference with nothing listening. Nothing else changes.
 * Provided by: `audioModule`.
 */
export interface AudioCommands {
  /** One-shot / looping playback, as handed to the behavior layer. */
  readonly bus: AudioBus;
  /** Maps this level's manifest `sound` + `soundCue` assets to fetchable URLs. */
  prepareLevel(manifest: AssetManifest): void;
  /** Starts every `autoPlay` Audio component of the freshly built level. */
  playAutoPlay(document: SceneDocument): void;
  /** Starts one runtime-spawned entity's `autoPlay` Audio component. */
  playEntityAudio(entity: Entity): void;
  /** Spatial listener pose; pushed from the frame loop, after the camera moves. */
  setListenerPose(
    position: readonly [number, number, number],
    forward: readonly [number, number, number],
  ): void;
  setBusVolume(bus: AudioBusId, volume: number): void;
  getBusVolume(bus: AudioBusId): number;
}

export const audioCommandsService = runtimeServiceKey<AudioCommands>("audio-commands");

/**
 * The active `.loc.json` tables. Shared, not owned by one capability: dialogue
 * localizes subtitles with it and the UI capability localizes widget text with
 * the very same registry, so it stays with the shell (which also persists the
 * player's locale choice) rather than being pulled into whichever module happens
 * to need it first.
 * Provided by: the runtime shell.
 */
export interface RuntimeLocalization {
  /** Loads this level's tables if nothing has yet — a scene may have no HUD. */
  ensureLoaded(): Promise<void>;
  /** The loaded registry, or null when the project authors no locale tables. */
  registry(): LocaleRegistry | null;
  /** Live lookup, so switching locale takes effect without re-registering lines. */
  resolveSubtitle(key: string): string | undefined;
}

export const localizationService = runtimeServiceKey<RuntimeLocalization>("localization");

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
 * The mounted runtime UI host: what is open on top of gameplay and how to change
 * it. Consumers ask for effects, never for widgets — the rules layer freezes its
 * round while anything is open and pushes an outcome screen when it settles, a
 * successful save-load closes the menu it was clicked in — so none of them needs
 * to know how a widget is loaded or rendered. `undefined` means this level
 * mounted no UI at all (or the capability is off), which every caller treats as
 * "nothing to close, nothing to show".
 * Provided by: `runtimeUiModule`.
 */
export interface RuntimeUiPresenter {
  /** Open screen count; 0 means gameplay is in front. */
  screenDepth(): number;
  /** Closes every open screen, returning to gameplay. */
  clearScreens(): void;
  /** Pushes the level's pause menu, if it authored one and nothing is open. */
  openPauseMenu(): void;
  /** Pushes a loaded widget by asset id; false when this level has no such widget. */
  pushWidget(widgetId: string): boolean;
  /** Pushes the level's authored win/lose screen, replacing anything open. */
  showOutcomeScreen(outcome: "won" | "lost"): boolean;
  /**
   * Re-projects world-space widgets onto the screen. Driven by the shell rather
   * than the module's own tick, because it must run after the Game Mode has
   * moved the camera for this frame or billboards trail it by one frame.
   */
  projectWorldWidgets(): void;
}

export const uiPresenterService = runtimeServiceKey<RuntimeUiPresenter>("runtime-ui-presenter");

/**
 * What the UI capability needs back from the shell, and nothing more: the input
 * edge that opens a menu, the input-mode switch a screen forces, the canvas size
 * world-space widgets project against, and the shell's reserved-message chain
 * (`game:*`, `travel:`, `save:*`, `settings:*`), which is tried before a widget
 * message is forwarded to gameplay as a `ui-action`.
 * Provided by: the runtime shell.
 */
export interface RuntimeUiHost {
  /** True on the frame the `menu` action edge fires (Escape / gamepad Start). */
  menuPressed(): boolean;
  /** The screen stack opened or closed: the shell re-routes input and the cursor. */
  onScreenStackChange(depth: number): void;
  /** Canvas pixel size, for projecting world-space widgets this frame. */
  viewportSize(): { readonly width: number; readonly height: number };
  /** World position of the entity a world-space widget is attached to. */
  resolveEntityPosition(entityId: string, target: Vector3): boolean;
  /** Handles a reserved widget message; false = forward it to gameplay. */
  handleReservedMessage(message: string): boolean;
}

export const uiHostService = runtimeServiceKey<RuntimeUiHost>("ui-host");

/** Read side of the `?debug` UI overlay: the mounted hosts' own snapshots. */
export interface UiDebugSource {
  host(): UiSubsystemDebugSnapshot | null;
  world(): WorldUiDebugSnapshot;
}

/** Provided by: `runtimeUiModule`. */
export const uiDebugService = runtimeServiceKey<UiDebugSource>("ui-debug");

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

/**
 * The active project's asset manifest. Modules that need it at level time read
 * `context.assetLoader` instead; this exists for the ones the shell calls
 * *during* a build, before their level hook has run.
 * Provided by: the runtime shell (owner of the asset loader).
 */
export const assetManifestService =
  runtimeServiceKey<() => Promise<AssetManifest | null>>("asset-manifest");

/**
 * Authored skeletal metadata (`*.skeleton.json`): blend spaces, the anim-set
 * role map, sockets, notifies, montages and root motion. One capability owns
 * loading and caching them; attaching a def to a character stays with the shell,
 * because a character ref is a Game Mode (Layer 3) type — Phase F moves that
 * boundary, not this one.
 *
 * Switched off, every character resolves to no metadata: it still renders and
 * plays its authored clip, but with no blend spaces, root motion or notifies —
 * exactly what a game with no skeletal characters wants to stop paying for.
 * Provided by: `skeletalAnimationModule`.
 */
export interface SkeletonLibrary {
  /**
   * Loads the sidecars for these model assets, deduped per asset and cached
   * until the level unloads. An asset with no sidecar resolves to the safe empty
   * default, so a caller can attach the result unconditionally.
   */
  load(assetIds: readonly string[]): Promise<ReadonlyMap<string, AssetSkeletonDef>>;
}

export const skeletonLibraryService = runtimeServiceKey<SkeletonLibrary>("skeleton-library");

/** Read side of the spline-follower debug overlay (`?debug`) and browser smokes. */
export interface SplineFollowerDebugSource {
  followers(): readonly SplinePathFollowerDebugState[];
}

/** Provided by: `splineFollowerModule`. */
export const splineFollowerDebugService =
  runtimeServiceKey<SplineFollowerDebugSource>("spline-follower-debug");

/**
 * The physics-derived world the AI capability plans through. It is deliberately
 * narrower than `PhysicsQuery`: perception needs sight occluders, the nav bake
 * needs the navigation-role-filtered blockers and walkable triangles, and an
 * agent profile falls back to a pawn's collider size. Nothing here mutates.
 * Provided by: the runtime shell (owner of the physics subsystem).
 */
export interface AiNavigationQuery {
  /** Sight occluders for perception line-of-sight checks. */
  staticBlockerAabbs(): readonly PhysicsAabb[];
  /** Static obstacles the nav grid is eroded from (`ignored` bodies omitted). */
  staticNavigationBlockerAabbs(): readonly PhysicsAabb[];
  /** Walkable triangles the nav grid seeds floor layers from. */
  staticNavigationSurfaceTriangles(): readonly PhysicsSurfaceTriangle[];
  /** Collider size an agent profile falls back to when nothing is authored. */
  colliderHalfExtents(entityId: string): readonly [number, number, number] | null;
}

/**
 * What the AI capability needs from the shell it plans inside. All of it is live
 * shell state (the physics world, the focus point for the far-NPC cadence, the
 * locomotion snapshot HUD/animation read) or a Layer 3 injection (the task
 * registry a fork's game module contributes), so it is handed in rather than
 * reached for. Without a host the module registers nothing: there is no world to
 * perceive, plan or move through.
 * Provided by: the runtime shell.
 */
export interface AiHost {
  /** `?debug`: build the nav/perception overlay into the level's scene. */
  readonly debug: boolean;
  /**
   * The game module's behavior-tree task registry (Layer 3). Omitted means the
   * engine built-ins — the generic wait / setBlackboard / sendMessage / moveTo
   * set every project starts from.
   */
  readonly taskRegistry?: AiTaskRegistry;
  readonly navigation: AiNavigationQuery;
  /** Normally the possessed pawn; `null` disables the far-NPC update cadence. */
  qualityFocusPosition(): readonly [number, number, number] | null;
  /**
   * Publishes a zeroed locomotion snapshot for an agent whose move just ended at
   * its goal, so the animation layer settles into idle on the same frame instead
   * of holding the last walking report.
   */
  reportIdleLocomotion(entityId: string): void;
}

export const aiHostService = runtimeServiceKey<AiHost>("ai-host");

/**
 * What the shell asks of the AI capability, at the points where only the shell
 * knows the event happened: a level's AI assets have to be resolved before its
 * controllers are derived, a transform written outside the solver has to reach
 * perception, the movement solver needs this frame's intent, and the optional
 * quality profile retunes the far-NPC cadence.
 *
 * `undefined` means the module is off: no controller ever runs, `moveIntentFor`
 * is never consulted (so every character is either player-driven or still), and
 * the level builds and plays exactly as it does now minus its NPC decisions.
 * Provided by: `aiModule`.
 */
export interface AiCommands {
  /**
   * Resolves this level's AI assets (blackboards, behavior trees, state trees)
   * and its Target Point routes. Must be awaited before the level's entity set
   * is fed, because a controller's blackboard schema is read from those assets
   * as it is built.
   */
  prepareLevel(layout: RoomLayout): Promise<void>;
  /** Feeds a transform written outside the solver back into perception. */
  updateEntityTransform(entityId: string, transform: TransformComponent): void;
  /** This frame's move intent for a path-following agent, or null. */
  moveIntentFor(
    entityId: string,
    transform: Readonly<TransformComponent>,
    deltaSeconds: number,
  ): CharacterMoveIntent | null;
  /** Optional Phase 7 far-NPC update cadence; empty settings keep every frame. */
  setDistanceUpdateSettings(settings: AiDistanceUpdateSettings): void;
}

export const aiCommandsService = runtimeServiceKey<AiCommands>("ai-commands");

/** One AI path follower's live state for the `?debug` overlay. */
export interface AiNavFollowerDebug {
  readonly entityId: string;
  readonly status: PathFollowingState["status"];
  readonly waypointIndex: number;
  readonly pathLength: number;
  readonly path: readonly Vec3[];
  readonly goal: Vec3;
  readonly speed?: number;
  readonly acceptanceRadius?: number;
  readonly replans: number;
  readonly secondsWithoutProgress: number;
}

export interface AiNavigationDebugSnapshot {
  readonly blockers: readonly NavAabb[];
  readonly inflatedBlockers: readonly NavBlocker[];
  readonly agentClearances: readonly AiNavAgentClearanceView[];
  readonly bounds: readonly NavAabb[];
  readonly cellSize: number;
  readonly followers: readonly AiNavFollowerDebug[];
}

/** Read side of the `?debug` AI overlays: controllers and path following. */
export interface AiDebugSource {
  controllers(): AiDebugSnapshot;
  navigation(): AiNavigationDebugSnapshot;
}

/** Provided by: `aiModule`. */
export const aiDebugService = runtimeServiceKey<AiDebugSource>("ai-debug");
