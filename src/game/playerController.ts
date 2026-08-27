import {
  applyConfiguredMouseLook,
  DEFAULT_LOOK_AXIS_RATE,
  type LookAngles,
} from "@/game/gameModes/cameraControl";
import { PlayerCameraManager } from "@/game/playerCameraManager";
import type {
  GameModeContext,
  MouseCursorMode,
  PlayerControllerDefinition,
  PlayerState,
  PointerLookMode,
} from "@/scene/gameModeTypes";

const DEFAULT_CONTROL_ROTATION: LookAngles = { yaw: 0, pitch: 0 };

export interface RuntimePlayerControllerOptions {
  readonly initialControlRotation?: LookAngles;
}

export class RuntimePlayerController {
  readonly playerState: PlayerState = {
    pawnEntityId: null,
    possessed: false,
    pawnControlSuspended: false,
  };
  readonly cameraManager: PlayerCameraManager;
  private controlRotation: LookAngles;

  constructor(
    readonly definition: PlayerControllerDefinition,
    private readonly context: GameModeContext,
    options: RuntimePlayerControllerOptions = {},
  ) {
    this.controlRotation = options.initialControlRotation ?? DEFAULT_CONTROL_ROTATION;
    this.cameraManager = new PlayerCameraManager(context.camera);
  }

  setPawn(entityId: string | null): void {
    this.playerState.pawnEntityId = entityId;
    this.playerState.possessed = false;
  }

  possess(entityId: string | null = this.playerState.pawnEntityId): void {
    this.playerState.pawnEntityId = entityId;
    this.playerState.possessed = true;
    this.applyInputPolicy();
  }

  unpossess(): void {
    this.playerState.pawnEntityId = null;
    this.playerState.possessed = false;
    this.context.setInputMode("ui");
    this.context.setMouseCursorVisible(true);
    this.context.setPointerLookMode("right-drag");
  }

  setControlRotation(rotation: LookAngles): void {
    this.controlRotation = rotation;
  }

  getControlRotation(): LookAngles {
    return this.controlRotation;
  }

  updateControlRotation(deltaSeconds: number): LookAngles {
    if (this.context.getInputMode() === "ui") return this.controlRotation;
    const pointer = this.context.consumeLookDelta();
    const axisRate = this.definition.lookAxisRate ?? DEFAULT_LOOK_AXIS_RATE;
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    const dx = pointer.dx + this.axisDelta("look-x", axisRate, dt);
    const dy = pointer.dy + this.axisDelta("look-y", axisRate, dt);
    if (dx === 0 && dy === 0) return this.controlRotation;
    this.controlRotation = applyConfiguredMouseLook(this.controlRotation, dx, dy, {
      sensitivity: this.definition.lookSensitivity,
      invertY: this.definition.invertLookY,
    });
    return this.controlRotation;
  }

  controlYawForEntity(entityId: string): number | null {
    return this.playerState.possessed && this.playerState.pawnEntityId === entityId
      ? this.controlRotation.yaw
      : null;
  }

  private applyInputPolicy(): void {
    this.context.setInputMode(this.definition.inputMode ?? "game");
    this.context.setMouseCursorVisible(resolveCursorVisible(this.definition.mouseCursor));
    this.context.setPointerLookMode(resolvePointerLookMode(this.definition));
  }

  private axisDelta(axis: string, axisRate: number, dt: number): number {
    return this.definition.inputActions.includes(axis)
      ? this.context.actions.axis(axis) * axisRate * dt
      : 0;
  }
}

function resolveCursorVisible(mode: MouseCursorMode | undefined): boolean {
  return mode !== "hide";
}

function resolvePointerLookMode(definition: PlayerControllerDefinition): PointerLookMode {
  if (definition.pointerLookMode) return definition.pointerLookMode;
  return definition.possess === "camera-pawn" ? "right-drag" : "pointer-lock";
}
