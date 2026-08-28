/**
 * `forge.rtsCamera` — the characterless, top-down strategy Game Mode.
 *
 * This mode is the layered runtime's proof case (plan Faz I). The whole reason
 * the plan exists is that building an RTS on the old runtime meant writing a
 * separate `RtsApp` shell — which silently threw away every piece of scene
 * wiring `buildScene` did (landscape, materials, lights, VFX, reflections,
 * collision) and made a character-shaped runtime fight a game that has no
 * characters. Here that is a Game Mode and a shorter capability list: the same
 * `LevelRuntime` builds the same level, and nothing is re-plumbed by hand.
 *
 * What the mode owns is exactly the strategy camera vocabulary:
 *  - a fixed heading and tilt looking down at a ground focus point,
 *  - WASD *and* screen-edge panning of that focus,
 *  - mouse-wheel zoom, with pan speed scaling to the zoom level,
 *  - click selection of a placed unit, highlighted in place.
 *
 * It possesses nothing: no pawn, no character, no movement solver. The camera
 * itself is the pawn, as in the default camera mode — but driven from the
 * cursor rather than from mouse-look.
 */
import { Vector3 } from "three";
import { RuntimePlayerController } from "@/game/playerController";
import { RTS_GAME_MODE_ID } from "./catalog";
import {
  combinePanIntent,
  DEFAULT_RTS_CAMERA_SETTINGS,
  edgePanIntent,
  groundFocusFromCamera,
  keyPanIntent,
  panSpeedForDistance,
  rtsCameraPosition,
  rtsPanStep,
  zoomDistance,
  type RtsCameraSettings,
} from "./rtsCameraControl";
import { RtsSelectionHighlight } from "./rtsSelection";
import type {
  GameModeContext,
  GameModeDefinition,
  GameModeSession,
  GameState,
  PlayerControllerDefinition,
  PlayerState,
} from "@/scene/gameModeTypes";

/** Where the camera starts when the level's boot pose gives no ground focus. */
const DEFAULT_START_DISTANCE = 32;

class RtsCameraSession implements GameModeSession {
  readonly playerState: PlayerState;
  readonly gameState: GameState = { elapsedSeconds: 0 };
  private readonly controller: RuntimePlayerController;
  private readonly selection = new RtsSelectionHighlight();
  private readonly focus = new Vector3();
  private readonly forward = new Vector3();
  private distance = DEFAULT_START_DISTANCE;

  constructor(
    private readonly context: GameModeContext,
    private readonly settings: RtsCameraSettings,
  ) {
    this.controller = new RuntimePlayerController(RTS_CAMERA_PLAYER_CONTROLLER, context);
    this.playerState = this.controller.playerState;
  }

  spawnDefaultPawn(): void {
    // Nothing to spawn: the camera is the pawn and the level already framed it.
  }

  possess(): void {
    this.controller.possess(null);
    // Own the camera so window resizes stop re-framing it from under the player.
    this.context.markCameraControlled();

    // Seed the focus from whatever pose the camera booted with, so the level's
    // authored framing (or the editor's Play handoff) decides where the map
    // opens instead of the mode snapping to the origin.
    const { camera } = this.context;
    camera.getWorldDirection(this.forward);
    const ground = groundFocusFromCamera(camera.position, this.forward);
    if (ground) {
      this.focus.set(ground.x, ground.y, ground.z);
      this.distance = camera.position.distanceTo(this.focus);
    } else {
      this.focus.set(camera.position.x, 0, camera.position.z);
      this.distance = DEFAULT_START_DISTANCE;
    }
    this.distance = zoomDistance(this.distance, 0, this.settings);
    this.applyCamera();
  }

  update(deltaSeconds: number): void {
    this.gameState.elapsedSeconds += deltaSeconds;
    if (this.context.getInputMode() === "ui") return;

    this.applyZoom();
    this.applyPan(deltaSeconds);
    this.applyCamera();
    this.applySelection();
  }

  dispose(): void {
    this.selection.clear();
    this.controller.unpossess();
  }

  getCameraDebug(): {
    readonly controlYawDeg: number | null;
    readonly controlPitchDeg: number | null;
    readonly cameraSource: string | null;
  } {
    return {
      controlYawDeg: this.settings.yawDeg,
      // The camera tilts *down*, which is a negative pitch in engine terms.
      controlPitchDeg: -this.settings.pitchDeg,
      // The focus point and the zoom are this camera's whole state, so the
      // `?debug` overlay carries both: an RTS camera that will not pan is
      // otherwise indistinguishable from one whose input never arrived.
      cameraSource: `rts-top-down focus:${this.focus.x.toFixed(1)},${this.focus.z.toFixed(
        1,
      )} zoom:${this.distance.toFixed(1)} selected:${this.selection.selectedEntityId ?? "none"}`,
    };
  }

  private applyZoom(): void {
    const notches = this.context.consumeWheelDelta?.() ?? 0;
    if (notches === 0) return;
    this.distance = zoomDistance(this.distance, notches, this.settings);
  }

  private applyPan(deltaSeconds: number): void {
    const { actions } = this.context;
    const intent = combinePanIntent(
      keyPanIntent({
        forward: actions.held("move-forward"),
        back: actions.held("move-back"),
        left: actions.held("move-left"),
        right: actions.held("move-right"),
      }),
      edgePanIntent(this.context.getPointerViewport?.() ?? null, this.settings.edgeMargin),
    );
    const speed = panSpeedForDistance(this.settings, this.distance);
    const { dx, dz } = rtsPanStep(intent, this.settings.yawDeg, speed, deltaSeconds);
    this.focus.x += dx;
    this.focus.z += dz;
  }

  private applyCamera(): void {
    const { camera } = this.context;
    const position = rtsCameraPosition(this.focus, this.distance, this.settings);
    camera.position.set(position.x, position.y, position.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.focus.x, this.focus.y, this.focus.z);
  }

  /**
   * Click selection: a left click picks the entity under the cursor, and a click
   * on empty ground clears. The runtime's pick bridge only answers with actors
   * and characters, so terrain and scenery are not selectable units.
   */
  private applySelection(): void {
    if (!this.context.actions.pressed("fire")) return;
    const pointer = this.context.getPointerViewport?.() ?? null;
    if (!pointer) return;
    const pick = this.context.pickEntityAt?.(pointer.x, pointer.y) ?? null;
    if (!pick) {
      this.selection.clear();
      return;
    }
    this.selection.select(pick.entityId, pick.object);
  }
}

export const RTS_CAMERA_PLAYER_CONTROLLER: PlayerControllerDefinition = {
  id: "forge.rtsCameraController",
  // No look actions: this camera is steered by the cursor's position and the
  // wheel, never by a look delta.
  inputActions: ["move-forward", "move-back", "move-left", "move-right", "fire"],
  inputMode: "game",
  pointerLookMode: "right-drag",
  // A strategy game lives on its cursor; hiding it would remove the interface.
  mouseCursor: "show",
  possess: "camera-pawn",
};

export function createRtsCameraGameMode(
  settings: RtsCameraSettings = DEFAULT_RTS_CAMERA_SETTINGS,
): GameModeDefinition {
  return {
    id: RTS_GAME_MODE_ID,
    displayName: "RTS Camera",
    description:
      "Characterless top-down camera: edge-pan + WASD, wheel zoom, click to select a unit.",
    defaultPawn: { id: "forge.rtsCameraPawn", kind: "camera" },
    playerController: RTS_CAMERA_PLAYER_CONTROLLER,
    createSession: (context) => new RtsCameraSession(context, settings),
  };
}

export const rtsCameraGameMode: GameModeDefinition = createRtsCameraGameMode();
