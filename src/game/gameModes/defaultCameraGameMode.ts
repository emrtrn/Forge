/**
 * `forge.defaultCamera` — the built-in default Game Mode.
 *
 * Spawns a runtime-only camera pawn (the live camera itself; no scene object,
 * nothing written to the layout) and drives it with WASD. It never possesses a
 * character, even when the scene contains an `input-move` one — that auto-possess
 * rule belongs only to the explicitly selected TPS mode. Physics, audio and
 * behavior subsystems keep running; this session only owns the camera.
 *
 * Controls match the editor viewport's feel: WASD pans along the camera's facing,
 * E/Q fly the camera straight up/down along world +y/-y, and a held right-mouse
 * drag turns the view (yaw/pitch). The camera keeps whatever pose it boots with —
 * the scene's default framing, or the editor camera pose handed off through the
 * Play button — instead of being reframed.
 */
import { Vector3 } from "three";
import { RuntimePlayerController } from "@/game/playerController";
import { DEFAULT_GAME_MODE_ID } from "./catalog";
import {
  cameraPlanarPan,
  DEFAULT_LOOK_AXIS_RATE,
  forwardFromLookAngles,
  lookAnglesFromForward,
  type LookAngles,
} from "./cameraControl";
import type {
  GameModeContext,
  GameModeDefinition,
  GameModeSession,
  GameState,
  PawnDefinition,
  PlayerControllerDefinition,
  PlayerState,
} from "@/scene/gameModeTypes";

/** Default flythrough speed (units/s) when the pawn declares none. */
const DEFAULT_CAMERA_SPEED = 6;

class CameraPawnSession implements GameModeSession {
  readonly playerState: PlayerState;
  readonly gameState: GameState = { elapsedSeconds: 0 };
  private readonly controller: RuntimePlayerController;
  private readonly speed: number;
  private readonly forward = new Vector3();
  private look: LookAngles = { yaw: 0, pitch: 0 };

  constructor(
    private readonly context: GameModeContext,
    pawn: PawnDefinition,
    controllerDefinition: PlayerControllerDefinition = DEFAULT_CAMERA_PLAYER_CONTROLLER,
  ) {
    this.speed = pawn.movement?.speed ?? DEFAULT_CAMERA_SPEED;
    this.controller = new RuntimePlayerController(controllerDefinition, context);
    this.playerState = this.controller.playerState;
  }

  spawnDefaultPawn(): void {
    // The camera pawn has no scene object: the live camera, already framed by
    // the responsive viewport, is the pawn. Nothing to spawn or write back.
  }

  possess(): void {
    this.controller.possess(null);
    // Own the camera so window resizes stop re-framing it from under the player.
    this.context.markCameraControlled();
    // Mirror the editor viewport's E/Q vertical fly keys. This mode never
    // possesses a character, so re-binding interact/emote to camera up/down is
    // inert for gameplay and self-contained to this session's ActionMap.
    this.context.actions.bind("KeyE", "camera-up");
    this.context.actions.bind("KeyQ", "camera-down");
    // Seed look angles from whatever pose the camera booted with so the first
    // right-drag continues smoothly instead of snapping.
    this.context.camera.getWorldDirection(this.forward);
    this.look = lookAnglesFromForward(this.forward.x, this.forward.y, this.forward.z);
    this.controller.setControlRotation(this.look);
  }

  update(deltaSeconds: number): void {
    this.gameState.elapsedSeconds += deltaSeconds;
    if (this.context.getInputMode() === "ui") return;
    const { camera, actions } = this.context;

    // Right-drag look: turn the accumulated pointer delta into yaw/pitch and aim
    // the camera before moving, so WASD follows the new facing.
    const nextLook = this.controller.updateControlRotation(deltaSeconds);
    if (nextLook !== this.look) {
      this.look = nextLook;
      const dir = forwardFromLookAngles(this.look);
      camera.up.set(0, 1, 0);
      camera.lookAt(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z);
    }

    camera.getWorldDirection(this.forward);
    const { dx, dy, dz } = cameraPlanarPan(
      this.forward.x,
      this.forward.z,
      {
        forward: actions.held("move-forward"),
        back: actions.held("move-back"),
        left: actions.held("move-left"),
        right: actions.held("move-right"),
        up: actions.held("camera-up"),
        down: actions.held("camera-down"),
      },
      this.speed,
      deltaSeconds,
    );
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
  }

  dispose(): void {
    this.controller.unpossess();
  }
}

export const DEFAULT_CAMERA_PLAYER_CONTROLLER: PlayerControllerDefinition = {
  id: "forge.cameraController",
  inputActions: ["move-forward", "move-back", "move-left", "move-right", "look-x", "look-y"],
  inputMode: "game",
  pointerLookMode: "right-drag",
  mouseCursor: "show",
  lookSensitivity: 0.003,
  lookAxisRate: DEFAULT_LOOK_AXIS_RATE,
  invertLookY: false,
  possess: "camera-pawn",
};

export const defaultCameraGameMode: GameModeDefinition = {
  id: DEFAULT_GAME_MODE_ID,
  displayName: "Default Camera",
  description: "Runtime-only WASD camera pawn. No character is possessed.",
  defaultPawn: {
    id: "forge.cameraPawn",
    kind: "camera",
    movement: { speed: DEFAULT_CAMERA_SPEED },
  },
  playerController: DEFAULT_CAMERA_PLAYER_CONTROLLER,
  createSession: (context) =>
    new CameraPawnSession(context, defaultCameraGameMode.defaultPawn, DEFAULT_CAMERA_PLAYER_CONTROLLER),
};
