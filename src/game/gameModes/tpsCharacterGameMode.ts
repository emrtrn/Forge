/**
 * `forge.tpsCharacter` — the explicit third-person Game Mode.
 *
 * Possesses one player character and drives a behind-and-above follow camera plus
 * the crossfade locomotion animator (the gameplay that previously lived hardcoded
 * in `RuntimeSceneApp`). The player is chosen explicitly: a character tagged with
 * metadata `player: true` wins, otherwise the first character carrying the
 * `input-move` behavior. Because this only runs when the user selects TPS in
 * World Settings, an `input-move` character is never auto-played by the default
 * camera mode — `input-move` stays a general behavior, not a "player" marker.
 */
import { CrossfadeAnimator } from "@engine/render-three/characterAnimator";
import { LayeredCharacterAnimator } from "@engine/render-three/layeredCharacterAnimator";
import {
  readCameraComponent,
  readSpringArmComponent,
  type CameraComponent,
  type SpringArmComponent,
} from "@engine/scene/components";
import {
  smoothingFactor,
  stepFollowCamera,
  type FollowCameraConfig,
  type FollowCameraPose,
  type Vec3,
} from "@/game/followCamera";
import {
  classifyLocomotion,
  locomotionConfigForSkeleton,
  resolveLocomotionAnimation,
  DEFAULT_LOCOMOTION_THRESHOLDS,
  EMPTY_LOCOMOTION_CONFIG,
  type LocomotionAssetConfig,
} from "@engine/movement/locomotionAnimation";
import {
  resolveMontageBindings,
  type MontageBinding,
} from "@/game/montageInputBindings";
import {
  AnimationNotifyTracker,
  groupNotifiesByClip,
  type NotifyMarker,
} from "@/game/animationNotifies";
import { createRagdollDriver, type RagdollDriver } from "@/game/ragdollDriver";
import { GetUpBlender, type RestPose } from "@/game/getUpBlender";
import type { Object3D } from "three";
import {
  cameraProjectionFromComponent,
  desiredSpringArmCameraPose,
  stepSpringArmCameraPose,
} from "@/game/springArmCamera";
import type { CameraProjection, CameraPose } from "@/game/playerCameraManager";
import { RuntimePlayerController } from "@/game/playerController";
import { DEFAULT_LOOK_AXIS_RATE, lookAnglesFromForward } from "./cameraControl";
import type {
  GameModeContext,
  GameModeDefinition,
  GameModeSession,
  GameState,
  PlayerControllerDefinition,
  PlayerState,
  RuntimeCharacterRef,
} from "./types";

/**
 * Third-person follow camera: sits behind (+z) and above the player, looking
 * down -z so the world movement frame reads as camera-relative. `RATE` is the
 * exponential easing speed (per second) the camera uses to track the player.
 */
const FOLLOW_CAMERA_CONFIG: FollowCameraConfig = {
  offset: [0, 1.2, 2.6],
  lookHeight: 0.5,
};
const FOLLOW_CAMERA_RATE = 8;
const INITIAL_CONTROL_ROTATION = lookAnglesFromForward(
  -FOLLOW_CAMERA_CONFIG.offset[0],
  FOLLOW_CAMERA_CONFIG.lookHeight - FOLLOW_CAMERA_CONFIG.offset[1],
  -FOLLOW_CAMERA_CONFIG.offset[2],
);
const RAD_TO_DEG = 180 / Math.PI;
const CAMERA_SOURCE_BLEND_SECONDS = 0.25;
const SPRINT_FOV_OFFSET = 6;
const SPRINT_SHAKE_AMPLITUDE = 0.025;
const SPRINT_SHAKE_FREQUENCY_HZ = 8;

/** Crossfade duration (seconds) between locomotion clips. */
const ANIMATION_CROSSFADE_SECONDS = 0.18;

/** Crossfade (seconds) used when the animator resumes after a get-up blend. */
const GET_UP_SETTLE_SECONDS = 0.2;

/** Resolves the explicit player character a TPS session should possess. */
export function resolvePlayerCharacter(
  characters: readonly RuntimeCharacterRef[],
): RuntimeCharacterRef | undefined {
  const tagged = characters.find((ref) => ref.placement.metadata?.player === true);
  if (tagged) return tagged;
  const actorCharacter = characters.find((ref) => ref.hasCharacterMovement && !ref.isAiControlled);
  if (actorCharacter) return actorCharacter;
  return characters.find((ref) => ref.placement.behavior?.script === "input-move");
}

/**
 * The third-person session: follow camera + locomotion crossfade over the
 * resolved player character. Exported so project Game Modes
 * (`projectGameMode.ts`) reuse the exact possession/camera behavior, differing
 * only in which default pawn the runtime spawns.
 */
export class TpsCharacterSession implements GameModeSession {
  readonly playerState: PlayerState;
  readonly gameState: GameState = { elapsedSeconds: 0 };
  private readonly controller: RuntimePlayerController;
  private player: RuntimeCharacterRef | null = null;
  /** Full-body crossfade animator (used when no upper-body layering is authored). */
  private animator: CrossfadeAnimator | null = null;
  /** Layered animator (legs locomotion + upper-body slot) when authored. */
  private layered: LayeredCharacterAnimator | null = null;
  /** Clip names available on the active animator, for the locomotion selector. */
  private clipNames: ReadonlySet<string> = new Set();
  /** Input-bound upper-body montages, split by trigger mode. */
  private holdMontages: MontageBinding[] = [];
  private pressMontages: MontageBinding[] = [];
  /** The player asset's authored locomotion config (blend space + anim-set). */
  private locomotionConfig: LocomotionAssetConfig = EMPTY_LOCOMOTION_CONFIG;
  /** Player's authored notify markers, grouped by clip, for per-tick emission. */
  private notifiesByClip = new Map<string, NotifyMarker[]>();
  /** Stateful detector that emits notify names as the playhead crosses them. */
  private readonly notifyTracker = new AnimationNotifyTracker();
  private followPose: FollowCameraPose | null = null;
  private activeCameraSource: "follow config" | "spring arm component" = "follow config";
  /** Active physics ragdoll once the character has been dropped. */
  private ragdoll: RagdollDriver | null = null;
  /** Active get-up blend (ragdoll pose → animation), once recovery has begun. */
  private getup: GetUpBlender | null = null;
  /**
   * Driven bones' local transforms snapshotted at ragdoll activation — the last
   * clean standing pose the get-up blend eases back to (so un-animated transform
   * components don't stay stuck in the collapsed ragdoll pose).
   */
  private restPose = new Map<Object3D, RestPose>();
  /** Pending ragdoll/recovery requests from a toggle press or runtime event. */
  private ragdollRequested = false;
  private getUpRequested = false;
  /** Unsubscribe handles for the death/ragdoll/getup event subscriptions. */
  private messageUnsubscribers: Array<() => void> = [];

  constructor(
    private readonly context: GameModeContext,
    controllerDefinition: PlayerControllerDefinition = TPS_PLAYER_CONTROLLER,
  ) {
    this.controller = new RuntimePlayerController(controllerDefinition, context, {
      initialControlRotation: INITIAL_CONTROL_ROTATION,
    });
    this.playerState = this.controller.playerState;
  }

  spawnDefaultPawn(): void {
    this.player = resolvePlayerCharacter(this.context.characters) ?? null;
    this.controller.setPawn(this.player?.entityId ?? null);
  }

  possess(): void {
    const player = this.player;
    if (!player) return;
    this.controller.possess(player.entityId);
    // Snap to the authored idle clip so it never flashes a bind pose.
    const initialClip = player.placement.animation ?? "idle";
    // An authored upper-body bone enables the layered animator (legs locomotion +
    // upper-body montage slot); otherwise fall back to the full-body crossfade.
    const upperBodyBone = player.skeleton?.upperBodyBone;
    const rootMotion = player.skeleton?.rootMotion;
    const rootMotionOptions = rootMotion ? { rootMotion } : {};
    const layered = upperBodyBone
      ? new LayeredCharacterAnimator(player.object, player.gltf.animations, upperBodyBone, rootMotionOptions)
      : null;
    if (layered?.hasUpperBody) {
      this.layered = layered;
      for (const mixer of layered.mixers) this.context.addMixer(mixer);
      layered.playLocomotion(initialClip, 0);
      this.clipNames = layered.clips;
    } else {
      const animator = new CrossfadeAnimator(player.object, player.gltf.animations, rootMotionOptions);
      animator.play(initialClip, 0);
      this.context.addMixer(animator.mixer);
      this.animator = animator;
      this.clipNames = animator.clips;
    }
    // Resolve the authored locomotion config (blend space + anim-set) from the
    // character's skeleton sidecar; drives grounded blending and clip selection.
    this.locomotionConfig = locomotionConfigForSkeleton(player.skeleton);
    this.notifiesByClip = groupNotifiesByClip(player.skeleton?.notifies);
    this.notifyTracker.reset();
    const bindings = resolveMontageBindings(player.skeleton?.montages);
    this.holdMontages = bindings.filter((binding) => binding.mode === "hold");
    this.pressMontages = bindings.filter((binding) => binding.mode === "press");
    this.subscribeRagdollEvents(player.entityId);
    // Following the player owns the view; stop the resize handler resetting it.
    this.context.markCameraControlled();
  }

  /**
   * Wires the event-driven ragdoll path: game logic or an actor script targets
   * the player with a `death`/`ragdoll` message to drop it (no hardcoded key
   * needed), or a `getup` message to recover. The debug `ragdoll` action stays as
   * a manual toggle. Handlers only flag a request; {@link update} consumes it so
   * physics spawn/despawn happens at the session tick, not mid message-flush.
   */
  private subscribeRagdollEvents(entityId: string): void {
    const subscribe = this.context.onScriptMessage;
    if (!subscribe) return;
    const target = { target: entityId };
    this.messageUnsubscribers.push(
      subscribe("ragdoll", () => (this.ragdollRequested = true), target),
      subscribe("death", () => (this.ragdollRequested = true), target),
      subscribe("getup", () => (this.getUpRequested = true), target),
    );
  }

  update(deltaSeconds: number): void {
    this.gameState.elapsedSeconds += deltaSeconds;
    const player = this.player;
    if (!player) return;

    // Recovering: ease the bones from the ragdoll pose back to the (now un-frozen)
    // locomotion animation, then hand movement/animation control back.
    if (this.getup) {
      const done = this.getup.update(deltaSeconds);
      this.updateFollowCamera(player, deltaSeconds);
      if (done) this.finishGetUp(player);
      return;
    }

    // Debug `ragdoll` action toggles: drop when upright, recover when ragdolled.
    const toggle =
      this.context.getInputMode() !== "ui" && this.context.actions.pressed("ragdoll");

    // Ragdolled: physics poses the bones; the camera tracks the body. A toggle
    // press or a `getup` event begins recovery.
    if (this.ragdoll) {
      if (this.getUpRequested || toggle) {
        this.getUpRequested = false;
        this.ragdollRequested = false;
        this.beginGetUp();
        return;
      }
      this.ragdoll.update();
      this.updateFollowCamera(player, deltaSeconds, this.ragdoll.getFollowPosition());
      return;
    }

    // Upright: a `ragdoll`/`death` event or a toggle press drops into a ragdoll.
    if (this.ragdollRequested || toggle) {
      this.ragdollRequested = false;
      this.getUpRequested = false;
      if (this.activateRagdoll(player)) {
        // Just dropped this tick; physics steps next tick, so don't sample it yet
        // (the follow position is still null and falls back to the player root).
        this.updateFollowCamera(player, deltaSeconds);
        return;
      }
    }
    this.updateFollowCamera(player, deltaSeconds);
    this.updateAnimation(player, deltaSeconds);
  }

  /**
   * Switches the character from kinematic animation to a dynamic physics ragdoll
   * (debug `ragdoll` action toggle, or a `death`/`ragdoll` runtime event). No-op
   * unless the character authored physics bodies and the physics bridge/backend
   * is live. Freezes the locomotion mixers so un-bodied bones hold their pose
   * while bodied bones fall, and suspends the pawn's movement so input can't shove
   * the detached capsule around while it's ragdolled.
   */
  private activateRagdoll(player: RuntimeCharacterRef): boolean {
    const bodies = player.skeleton?.physicsBodies;
    if (!bodies || bodies.length === 0) return false;
    const { spawnRagdoll, sampleRagdoll, despawnRagdoll } = this.context;
    if (!spawnRagdoll || !sampleRagdoll || !despawnRagdoll) return false;
    const driver = createRagdollDriver(
      player.object,
      bodies,
      player.skeleton?.physicsConstraints ?? [],
      { spawnRagdoll, sampleRagdoll, despawnRagdoll },
      player.entityId,
    );
    if (!driver) return false;
    this.ragdoll = driver;
    // Snapshot the current (still kinematic) local pose of each driven bone before
    // the first physics step displaces it; the get-up blend eases back to this.
    this.restPose = new Map();
    for (const node of driver.getDrivenNodes()) {
      this.restPose.set(node, {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
      });
    }
    this.freezeAnimationMixers();
    this.playerState.pawnControlSuspended = true;
    return true;
  }

  /**
   * Begins recovery from a ragdoll: releases the physics bodies and starts a
   * {@link GetUpBlender} that eases the driven bones from their collapsed ragdoll
   * pose back to the rest pose captured at activation. The locomotion mixer stays
   * frozen for the duration so the blender owns the pose; {@link finishGetUp} hands
   * control back. The pawn stays movement-suspended throughout and stands back up
   * where it fell (its root never moved while ragdolled).
   */
  private beginGetUp(): void {
    const ragdoll = this.ragdoll;
    if (!ragdoll) return;
    ragdoll.dispose();
    this.ragdoll = null;
    this.getup = new GetUpBlender(this.restPose);
  }

  /**
   * Completes recovery: un-freeze the animator onto the idle/stand clip (the bones
   * are now exactly on the clean rest pose, so un-animated components stay correct),
   * drop the blender, and hand movement/animation control back.
   */
  private finishGetUp(player: RuntimeCharacterRef): void {
    const initialClip = player.placement.animation ?? "idle";
    if (this.layered) {
      this.layered.setAim(null, 0);
      this.layered.playLocomotion(initialClip, GET_UP_SETTLE_SECONDS);
    } else if (this.animator) {
      this.animator.play(initialClip, GET_UP_SETTLE_SECONDS);
    }
    this.unfreezeAnimationMixers();
    this.getup = null;
    this.playerState.pawnControlSuspended = false;
  }

  /** Stops the locomotion mixers advancing so the ragdoll driver fully owns the pose. */
  private freezeAnimationMixers(): void {
    if (this.animator) this.animator.mixer.timeScale = 0;
    if (this.layered) for (const mixer of this.layered.mixers) mixer.timeScale = 0;
  }

  /** Resumes the locomotion mixers when recovery hands the pose back to animation. */
  private unfreezeAnimationMixers(): void {
    if (this.animator) this.animator.mixer.timeScale = 1;
    if (this.layered) for (const mixer of this.layered.mixers) mixer.timeScale = 1;
  }

  beforeEngineUpdate(deltaSeconds: number): void {
    this.controller.updateControlRotation(deltaSeconds);
  }

  controlYawForEntity(entityId: string): number | null {
    return this.controller.controlYawForEntity(entityId);
  }

  getCameraDebug(): {
    readonly controlYawDeg: number | null;
    readonly controlPitchDeg: number | null;
    readonly cameraSource: string | null;
  } {
    const controlRotation = this.controller.getControlRotation();
    return {
      controlYawDeg: controlRotation.yaw * RAD_TO_DEG,
      controlPitchDeg: controlRotation.pitch * RAD_TO_DEG,
      cameraSource: this.controller.cameraManager.cameraSource ?? this.activeCameraSource,
    };
  }

  dispose(): void {
    for (const unsubscribe of this.messageUnsubscribers) unsubscribe();
    this.messageUnsubscribers = [];
    this.controller.unpossess();
    // Release the ragdoll's physics bodies/joints; the animator's mixer is owned
    // by the AnimationSubsystem (disposed by the EngineApp).
    this.ragdoll?.dispose();
    this.ragdoll = null;
    this.getup = null;
  }

  private updateFollowCamera(
    player: RuntimeCharacterRef,
    deltaSeconds: number,
    targetOverride?: Vec3 | null,
  ): void {
    const pos: Vec3 = targetOverride ?? [
      player.object.position.x,
      player.object.position.y,
      player.object.position.z,
    ];
    const authored = this.authoredCamera(player);
    this.updateGameplayCameraEffects(player, authored.camera);
    if (authored.springArm) {
      this.activeCameraSource = "spring arm component";
      const desired = desiredSpringArmCameraPose({
        playerPosition: pos,
        springArm: authored.springArm,
        controlRotation: this.controller.getControlRotation(),
        blockers: this.context.staticBlockerAabbs(),
      });
      const t = authored.springArm.enableCameraLag
        ? smoothingFactor(authored.springArm.cameraLagSpeed, deltaSeconds)
        : 1;
      this.followPose = stepSpringArmCameraPose(this.followPose, desired, t);
      this.applyCameraView(
        this.activeCameraSource,
        this.followPose,
        this.cameraProjection(authored.camera),
        deltaSeconds,
      );
    } else {
      this.activeCameraSource = "follow config";
      const t = smoothingFactor(FOLLOW_CAMERA_RATE, deltaSeconds);
      this.followPose = stepFollowCamera(this.followPose, pos, FOLLOW_CAMERA_CONFIG, t);
      this.applyCameraView(
        this.activeCameraSource,
        this.followPose,
        this.cameraProjection(undefined),
        deltaSeconds,
      );
    }
  }

  private updateAnimation(player: RuntimeCharacterRef, deltaSeconds: number): void {
    const report = this.context.getLocomotion(player.entityId);
    if (report) {
      const result = resolveLocomotionAnimation(
        report,
        this.clipNames,
        this.locomotionConfig,
        DEFAULT_LOCOMOTION_THRESHOLDS,
      );
      if (this.layered) {
        if (result.kind === "blend") this.layered.playLocomotionBlend(result.weights);
        else if (result.clip) this.layered.playLocomotion(result.clip, ANIMATION_CROSSFADE_SECONDS);
      } else if (this.animator) {
        if (result.kind === "blend") this.animator.playBlend(result.weights);
        else if (result.clip) this.animator.play(result.clip, ANIMATION_CROSSFADE_SECONDS);
      }
    }
    this.updateUpperBody(deltaSeconds);
    this.emitAnimationNotifies(player);
  }

  /**
   * Samples the active clip's playhead and emits any notify markers crossed this
   * tick into the runtime event stream. No-op when the character authored none.
   */
  private emitAnimationNotifies(player: RuntimeCharacterRef): void {
    if (this.notifiesByClip.size === 0) return;
    const active = this.layered
      ? this.layered.getActiveClip()
      : (this.animator?.getActiveClip() ?? null);
    const fired = this.notifyTracker.sample(active, this.notifiesByClip);
    for (const notify of fired) this.context.emitAnimNotify?.(player.entityId, notify.name);
  }

  /**
   * Drives the upper-body slot from authored montage input bindings: `hold`
   * montages layer a pose over locomotion while their action is held (the first
   * one wins); `press` montages fire a one-shot on the press tick. Bindings come
   * from the skeleton sidecar — explicit triggers or the aim/fire convention.
   * Only runs when a layered animator (an authored upper-body bone) exists.
   */
  private updateUpperBody(deltaSeconds: number): void {
    const layered = this.layered;
    if (!layered) return;
    const gameInput = this.context.getInputMode() !== "ui";
    if (this.holdMontages.length > 0) {
      const active = gameInput
        ? this.holdMontages.find((binding) => this.context.actions.held(binding.action)) ?? null
        : null;
      layered.setAim(active ? active.clip : null, active?.blendInSeconds ?? 0.18);
    }
    if (gameInput) {
      for (const binding of this.pressMontages) {
        if (this.context.actions.pressed(binding.action)) {
          layered.playMontage(binding.clip, {
            blendInSeconds: binding.blendInSeconds,
            blendOutSeconds: binding.blendOutSeconds,
          });
        }
      }
    }
    layered.update(deltaSeconds);
  }

  private updateGameplayCameraEffects(
    player: RuntimeCharacterRef,
    camera: CameraComponent | undefined,
  ): void {
    const report = this.context.getLocomotion(player.entityId);
    const sprinting =
      report !== undefined &&
      classifyLocomotion(report, DEFAULT_LOCOMOTION_THRESHOLDS) === "run";
    const shakeEnabled = camera?.enableSprintCameraShake ?? true;
    this.controller.cameraManager.setGameplayEffects(
      sprinting
        ? {
            fovOffset: SPRINT_FOV_OFFSET,
            shakeAmplitude: shakeEnabled ? SPRINT_SHAKE_AMPLITUDE : 0,
            shakeFrequencyHz: shakeEnabled ? SPRINT_SHAKE_FREQUENCY_HZ : 0,
          }
        : {},
    );
  }

  private authoredCamera(player: RuntimeCharacterRef): {
    readonly springArm: SpringArmComponent | undefined;
    readonly camera: CameraComponent | undefined;
  } {
    const entity = player.entity;
    if (!entity) return { springArm: undefined, camera: undefined };
    return {
      springArm: readSpringArmComponent(entity),
      camera: readCameraComponent(entity),
    };
  }

  private applyCameraView(
    source: string,
    pose: CameraPose,
    projection: CameraProjection,
    deltaSeconds: number,
  ): void {
    this.controller.cameraManager.setViewTarget(
      {
        source,
        pose,
        projection,
      },
      { blendTimeSeconds: CAMERA_SOURCE_BLEND_SECONDS },
    );
    this.controller.cameraManager.update(deltaSeconds);
  }

  private cameraProjection(camera: CameraComponent | undefined): CameraProjection {
    return cameraProjectionFromComponent(camera);
  }
}

export const TPS_PLAYER_CONTROLLER: PlayerControllerDefinition = {
  id: "forge.tpsController",
  inputActions: [
    "move-forward",
    "move-back",
    "move-left",
    "move-right",
    "jump",
    "sprint",
    "look-x",
    "look-y",
  ],
  inputMode: "game",
  pointerLookMode: "pointer-lock",
  mouseCursor: "hide",
  lookSensitivity: 0.003,
  lookAxisRate: DEFAULT_LOOK_AXIS_RATE,
  invertLookY: false,
  possess: "first-input-move-character",
};

export const tpsCharacterGameMode: GameModeDefinition = {
  id: "forge.tpsCharacter",
  displayName: "TPS Character",
  description: "Possesses an input-driven character with a third-person follow camera.",
  defaultPawn: {
    id: "forge.tpsPawn",
    kind: "character",
    // Temporary default: when the scene has no authored player, TPS spawns this
    // character at the Player Start. Tuned to match the follow camera (the demo
    // Blocky Character reads correctly at 0.3).
    characterAssetId: "character-a",
    characterScale: 0.3,
    movement: { speed: 3, sprintMultiplier: 2 },
  },
  playerController: TPS_PLAYER_CONTROLLER,
  createSession: (context) => new TpsCharacterSession(context, TPS_PLAYER_CONTROLLER),
};
