/**
 * `forge.vehicle` — drive the level's first `Vehicle` actor (vehicle plan Faz 1).
 *
 * Unreal's vehicle template, scaled down: the pawn is a placed actor whose
 * `Vehicle` component made it a ray-cast car in the physics world; this mode
 * possesses it, maps the default action vocabulary onto pedals and steering,
 * and frames it with a chase camera that swings round behind it.
 *
 * Controls: W/S (or arrows) throttle / brake-then-reverse, A/D steer, Space
 * handbrake, E puts the car back on its wheels.
 *
 * Physics is fixed-step (`PhysicsSubsystem`), so the input set before the
 * engine update is what the next slices drive with, and the camera reads the
 * interpolated render pose afterwards — no jitter between the two.
 */
import { RuntimePlayerController } from "@/game/playerController";
import { NEUTRAL_VEHICLE_INPUT } from "@engine/physics/vehicle/vehicleTypes";
import { VEHICLE_GAME_MODE_ID } from "./catalog";
import { DEFAULT_VEHICLE_CHASE_CAMERA, type VehicleChaseCameraSettings } from "./vehicleCameraControl";
import { VehicleDriver } from "./vehicleDriver";
import type {
  GameModeContext,
  GameModeDefinition,
  GameModeSession,
  GameState,
  PlayerControllerDefinition,
  PlayerState,
} from "@/scene/gameModeTypes";

class VehicleSession implements GameModeSession {
  readonly playerState: PlayerState;
  readonly gameState: GameState = { elapsedSeconds: 0 };
  private readonly controller: RuntimePlayerController;
  private readonly driver: VehicleDriver;

  constructor(
    private readonly context: GameModeContext,
    settings: VehicleChaseCameraSettings,
  ) {
    this.controller = new RuntimePlayerController(VEHICLE_PLAYER_CONTROLLER, context);
    this.playerState = this.controller.playerState;
    this.driver = new VehicleDriver(context, this.controller, settings);
  }

  private get vehicleId(): string | null {
    return this.playerState.pawnEntityId;
  }

  spawnDefaultPawn(): void {
    // The vehicle is authored in the level; nothing to spawn.
    this.controller.setPawn(this.context.vehicles?.ids()[0] ?? null);
  }

  possess(): void {
    this.controller.possess(this.vehicleId);
    this.context.markCameraControlled();
  }

  beforeEngineUpdate(): void {
    // Physics may come up after the session boots; possess the car once it does.
    if (!this.vehicleId) {
      const first = this.context.vehicles?.ids()[0];
      if (first) this.controller.possess(first);
    }
    const id = this.vehicleId;
    if (!this.context.vehicles || !id) return;
    this.driver.drive(id);
    if (this.context.getInputMode() !== "ui" && this.context.actions.pressed("interact")) {
      this.driver.resetUpright(id);
    }
  }

  update(deltaSeconds: number): void {
    this.gameState.elapsedSeconds += deltaSeconds;
    const id = this.vehicleId;
    if (id) this.driver.updateCamera(id, deltaSeconds);
  }

  dispose(): void {
    const id = this.vehicleId;
    if (id) this.context.vehicles?.setInput(id, NEUTRAL_VEHICLE_INPUT);
    this.driver.restoreFov();
    this.controller.unpossess();
  }

  getCameraDebug(): {
    readonly controlYawDeg: number | null;
    readonly controlPitchDeg: number | null;
    readonly cameraSource: string | null;
  } {
    return {
      controlYawDeg: this.driver.debugYawDeg(),
      controlPitchDeg: null,
      cameraSource: this.driver.debugSource(this.vehicleId),
    };
  }
}

export const VEHICLE_PLAYER_CONTROLLER: PlayerControllerDefinition = {
  id: "forge.vehicleController",
  inputActions: [
    "move-forward",
    "move-back",
    "move-left",
    "move-right",
    "jump",
    "interact",
    "look-x",
    "look-y",
  ],
  inputMode: "game",
  pointerLookMode: "pointer-lock",
  mouseCursor: "hide",
  possess: "first-vehicle",
};

export function createVehicleGameMode(
  settings: VehicleChaseCameraSettings = DEFAULT_VEHICLE_CHASE_CAMERA,
): GameModeDefinition {
  return {
    id: VEHICLE_GAME_MODE_ID,
    displayName: "Vehicle",
    description: "Drives the level's first Vehicle actor with a chase camera.",
    defaultPawn: { id: "forge.vehiclePawn", kind: "vehicle" },
    playerController: VEHICLE_PLAYER_CONTROLLER,
    createSession: (context) => new VehicleSession(context, settings),
  };
}

export const vehicleGameMode: GameModeDefinition = createVehicleGameMode();
