/**
 * Gameplay framework contracts (Unreal-inspired). A Game Mode owns the rules for
 * a Play session: which pawn spawns, which controller possesses it, and how the
 * camera/animation update each tick. The runtime shell
 * (`src/scene/RuntimeSceneApp.ts`) builds the scene, then hands the selected
 * mode a {@link GameModeContext} and drives the returned {@link GameModeSession}.
 *
 * This is the *contract* between the shell and Layer 3, so it lives beside the
 * other runtime API files ({@link ForgeGameModule}) rather than in `src/game`:
 * the shell may not import the game, but both sides need these types. The mode
 * *implementations* stay in `src/game/gameModes/` — a fork replaces them and
 * supplies its own through its game module.
 *
 * Editor code is never imported here, and a session never writes runtime state
 * back into the saved layout.
 */
import type { AnimationMixer, Object3D, PerspectiveCamera } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ActionMap } from "@engine/input/actionMap";
import type { LayoutCharacter } from "@engine/scene/layout";
import type { Entity } from "@engine/scene/entity";
import type { Aabb3 } from "@engine/movement/characterCollision";
import type { LocomotionInput } from "@engine/movement/locomotionAnimation";
import type { AssetSkeletonDef } from "@/scene/assetSkeletonLoader";
import type { RagdollGroupDesc, RagdollPose } from "@engine/physics/ragdoll";
import type { ScriptMessageEnvelope } from "@engine/behavior/scriptMessages";

export type Vec3 = [number, number, number];
export type InputMode = "game" | "ui" | "game-and-ui";
export type PointerLookMode = "right-drag" | "pointer-lock";
export type MouseCursorMode = "show" | "hide";

/**
 * The pawn a Game Mode spawns/possesses. `camera` is a runtime-only flythrough
 * pawn (no scene object — the camera itself is the pawn); `character` possesses
 * an existing layout character.
 */
export interface PawnDefinition {
  readonly id: string;
  readonly kind: "camera" | "character";
  /**
   * For `character` pawns, the asset spawned as the default player when the scene
   * has no authored player character. (Temporary: a future build lets the user
   * assign the pawn its own character asset here.) Absent for `camera` pawns.
   */
  readonly characterAssetId?: string;
  /**
   * For project Game Modes, the Actor Script class (`*.actor.json`, parent class
   * `character`) spawned as the default player when the scene has no authored
   * player. Takes precedence over {@link characterAssetId}: the spawned instance
   * brings its own mesh + capsule + CharacterMovement from the class template.
   */
  readonly pawnClassRef?: string;
  /** Authored scale for the spawned default character pawn. Absent means 1. */
  readonly characterScale?: number;
  /** Movement tuning (units/s, sprint multiplier). Optional per kind. */
  readonly movement?: {
    readonly speed?: number;
    readonly sprintMultiplier?: number;
  };
}

/** How a Game Mode's controller selects and binds to its pawn. */
export interface PlayerControllerDefinition {
  readonly id: string;
  /** Named input actions this controller reads (informational contract). */
  readonly inputActions: readonly string[];
  /** Runtime mouse-look capture policy, Unreal-style input mode surface. */
  readonly pointerLookMode?: PointerLookMode;
  /** Whether the controller wants the runtime mouse cursor shown or hidden. */
  readonly mouseCursor?: MouseCursorMode;
  /** Game/UI input routing requested by the controller at possession time. */
  readonly inputMode?: InputMode;
  /** Mouse look sensitivity in radians per pixel. */
  readonly lookSensitivity?: number;
  /** Inverts vertical mouse look when true. */
  readonly invertLookY?: boolean;
  /** Analog look-axis rate, in pointer-pixel-equivalent units per second. */
  readonly lookAxisRate?: number;
  /**
   * Possess target contract:
   * - `camera-pawn`: take over the runtime camera (no character possession).
   * - `first-input-move-character`: possess the explicitly resolved player
   *   character (metadata `player` tag, else first `input-move` behavior).
   */
  readonly possess: "camera-pawn" | "first-input-move-character";
}

/** A static Game Mode definition registered in the runtime registry. */
export interface GameModeDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly defaultPawn: PawnDefinition;
  readonly playerController: PlayerControllerDefinition;
  /** Builds a fresh session bound to one Play boot's scene/camera. */
  createSession(context: GameModeContext): GameModeSession;
}

/**
 * Runtime-only player state surface (Unreal's PlayerState analogue). Never
 * serialized to the layout.
 */
export interface PlayerState {
  /** Entity id of the possessed pawn, or null when nothing is possessed. */
  pawnEntityId: string | null;
  /** True once the controller has possessed its pawn. */
  possessed: boolean;
  /**
   * True while the pawn's transform is owned by something other than the player
   * controller (a physics ragdoll, then the get-up blend). The runtime shell's
   * movement gates stop driving the pawn's capsule while this is set so input
   * can't shove a ragdolled/recovering character around.
   */
  pawnControlSuspended: boolean;
}

/**
 * Runtime-only game/session state surface (Unreal's GameState analogue). Never
 * serialized to the layout.
 */
export interface GameState {
  elapsedSeconds: number;
}

/** A character the runtime built from the layout, offered to the Game Mode. */
export interface RuntimeCharacterRef {
  readonly index: number;
  readonly entityId: string;
  readonly object: Object3D;
  readonly gltf: GLTF;
  readonly placement: LayoutCharacter;
  readonly classRef?: string;
  readonly parentClass?: "character";
  readonly hasCharacterMovement?: boolean;
  readonly isAiControlled?: boolean;
  readonly entity?: Entity;
  /**
   * Authored skeletal metadata (`*.skeleton.json`) for this character's asset:
   * blend spaces, sockets, the anim-set role map. Attached by the runtime shell
   * after the sidecar loads; absent until then (and when no sidecar exists).
   */
  skeleton?: AssetSkeletonDef;
}

/** A scene entity the runtime resolved under a viewport point. */
export interface RuntimeEntityPick {
  /** Entity id of the picked actor / character (never a decorative static). */
  readonly entityId: string;
  /** The picked entity's root render object. */
  readonly object: Object3D;
  /** World-space hit point on that object. */
  readonly point: Vec3;
}

/**
 * What the runtime shell exposes to a Game Mode session: the live camera, input,
 * the built characters, and small bridges back into the runtime (animation
 * mixer registration, locomotion snapshots, camera ownership).
 */
export interface GameModeContext {
  readonly camera: PerspectiveCamera;
  readonly actions: ActionMap;
  readonly characters: readonly RuntimeCharacterRef[];
  /** Latest locomotion snapshot a behavior reported for `entityId` this tick. */
  getLocomotion(entityId: string): LocomotionInput | undefined;
  /** Static blocker AABBs derived by the physics subsystem for camera probes. */
  staticBlockerAabbs(): readonly Aabb3[];
  /** Registers a crossfade animator's mixer with the animation subsystem. */
  addMixer(mixer: AnimationMixer): void;
  /**
   * Emits a fired animation notify (by name) into the runtime event stream as an
   * `anim-notify` script message targeted at `entityId`, so actor scripts can
   * react (footstep audio, hit window, effect). Fire-and-forget: no subscriber is
   * fine. Optional so headless/test contexts may omit it.
   */
  emitAnimNotify?(entityId: string, name: string): void;
  /**
   * Spawns a physics ragdoll group into the live world and returns its id, or null
   * when the Rapier backend isn't active. `detachEntityId` excludes the possessed
   * pawn's capsule from colliding with its own ragdoll. Optional so headless/test
   * contexts may omit the whole ragdoll bridge.
   */
  spawnRagdoll?(desc: RagdollGroupDesc, options?: { detachEntityId?: string }): number | null;
  /** World transforms of a spawned ragdoll's bodies, sampled after the step. */
  sampleRagdoll?(id: number): RagdollPose[];
  /** Removes a spawned ragdoll (bodies, colliders, joints). */
  despawnRagdoll?(id: number): void;
  /**
   * Subscribes the session to a runtime script message (e.g. `death`/`ragdoll`),
   * optionally scoped to one target entity, returning an unsubscribe handle. This
   * is the inbound counterpart to {@link emitAnimNotify}: it lets game logic or
   * an actor script drive a session reaction (ragdoll on death) by event rather
   * than a hardcoded debug key. Optional so headless/test contexts may omit it.
   */
  onScriptMessage?(
    type: string,
    handler: (envelope: ScriptMessageEnvelope) => void,
    options?: { readonly target?: string },
  ): () => void;
  /**
   * Marks the runtime camera as controlled by this session so the responsive
   * resize handler stops re-framing it.
   */
  markCameraControlled(): void;
  /**
   * Pointer look delta (pixels) accumulated since the last call, from a held
   * right-mouse drag on the canvas. Resets on read. The default camera mode turns
   * this into yaw/pitch; modes that ignore it (TPS) simply never call it.
   */
  consumeLookDelta(): { dx: number; dy: number };
  /**
   * Where the pointer currently is over the canvas, normalized to [0,1] from the
   * top-left, or null while it is outside. Absolute position, unlike
   * {@link consumeLookDelta}: screen-edge camera panning and click selection —
   * the top-down strategy vocabulary — cannot be derived from a look delta.
   * Optional so headless/test contexts may omit the whole pointer bridge.
   */
  getPointerViewport?(): { readonly x: number; readonly y: number } | null;
  /**
   * Wheel notches accumulated since the last call (positive = scrolled down /
   * away, the conventional zoom-out direction). Resets on read. Optional for the
   * same reason as {@link getPointerViewport}.
   */
  consumeWheelDelta?(): number;
  /**
   * Resolves the entity under a normalized viewport point — the runtime half of
   * click selection. Only entities are returned (placed actors and characters);
   * decorative statics and terrain pick as null, so a mode never "selects" a
   * wall. Optional so headless/test contexts may omit it.
   */
  pickEntityAt?(x: number, y: number): RuntimeEntityPick | null;
  /** Current runtime input mode. UI mode suppresses gameplay movement/look. */
  getInputMode(): InputMode;
  /** Applies Game/UI input routing for the active PlayerController. */
  setInputMode(mode: InputMode): void;
  /** Unreal-style cursor visibility toggle for the active PlayerController. */
  setMouseCursorVisible(visible: boolean): void;
  /** Applies the controller's runtime mouse capture/cursor policy. */
  setPointerLookMode(mode: PointerLookMode): void;
}

/**
 * A live Game Mode session. Lifecycle: {@link spawnDefaultPawn} →
 * {@link possess} once at boot, {@link update} each tick, {@link dispose} on
 * teardown. State surfaces are read-only views the shell may inspect.
 */
export interface GameModeSession {
  readonly playerState: PlayerState;
  readonly gameState: GameState;
  /** Resolve/spawn the default pawn (sets `playerState.pawnEntityId`). */
  spawnDefaultPawn(): void;
  /** Bind the controller to the spawned pawn (camera/animation wiring). */
  possess(): void;
  /** Advance the session one tick (after the engine has updated). */
  update(deltaSeconds: number): void;
  /** Optional input/control pass before engine subsystems consume movement. */
  beforeEngineUpdate?(deltaSeconds: number): void;
  /** Optional control yaw for camera-relative pawn movement. */
  controlYawForEntity?(entityId: string): number | null;
  /** Optional runtime camera/control state for debug overlays. */
  getCameraDebug?(): {
    readonly controlYawDeg: number | null;
    readonly controlPitchDeg: number | null;
    readonly cameraSource: string | null;
  };
  /** Release any session-owned resources. */
  dispose(): void;
}
