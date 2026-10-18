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
import { Quaternion, Vector3 } from "three";
import { RuntimePlayerController } from "@/game/playerController";
import { NEUTRAL_VEHICLE_INPUT } from "@engine/physics/vehicle/vehicleTypes";
import { VEHICLE_GAME_MODE_ID } from "./catalog";
import {
  blendHeading,
  chaseCameraPosition,
  DEFAULT_VEHICLE_CHASE_CAMERA,
  followAlpha,
  planarHeadingFromQuaternion,
  speedFieldOfView,
  vehicleInputFromActions,
  yawDegreesFromHeading,
  type PlanarHeading,
  type VehicleChaseCameraSettings,
} from "./vehicleCameraControl";
import type {
  GameModeContext,
  GameModeDefinition,
  GameModeSession,
  GameState,
  PlayerControllerDefinition,
  PlayerState,
} from "@/scene/gameModeTypes";

/** How high above its current spot a reset drops the car back onto its wheels. */
const RESET_LIFT = 1;

class VehicleSession implements GameModeSession {
  readonly playerState: PlayerState;
  readonly gameState: GameState = { elapsedSeconds: 0 };
  private readonly controller: RuntimePlayerController;
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private heading: PlanarHeading | null = null;
  private cameraPlaced = false;
  private baseFov: number;

  constructor(
    private readonly context: GameModeContext,
    private readonly settings: VehicleChaseCameraSettings,
  ) {
    this.controller = new RuntimePlayerController(VEHICLE_PLAYER_CONTROLLER, context);
    this.playerState = this.controller.playerState;
    this.baseFov = context.camera.fov;
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
    const vehicles = this.context.vehicles;
    const id = this.vehicleId;
    if (!vehicles || !id) return;
    if (this.context.getInputMode() === "ui") {
      vehicles.setInput(id, NEUTRAL_VEHICLE_INPUT);
      return;
    }
    vehicles.setInput(id, vehicleInputFromActions(this.context.actions));
    if (this.context.actions.pressed("interact")) this.resetUpright(id);
  }

  update(deltaSeconds: number): void {
    this.gameState.elapsedSeconds += deltaSeconds;
    const vehicles = this.context.vehicles;
    const id = this.vehicleId;
    const object = id ? vehicles?.object(id) : null;
    if (!vehicles || !id || !object) return;

    object.getWorldPosition(this.position);
    object.getWorldQuaternion(this.quaternion);
    const facing = planarHeadingFromQuaternion(this.quaternion);
    if (facing) {
      this.heading = this.heading
        ? blendHeading(this.heading, facing, followAlpha(this.settings.headingFollowRate, deltaSeconds))
        : facing;
    }
    if (!this.heading) return;

    const { camera } = this.context;
    const desired = chaseCameraPosition(this.position, this.heading, this.settings);
    if (this.cameraPlaced) {
      const alpha = followAlpha(this.settings.positionFollowRate, deltaSeconds);
      camera.position.set(
        camera.position.x + (desired.x - camera.position.x) * alpha,
        camera.position.y + (desired.y - camera.position.y) * alpha,
        camera.position.z + (desired.z - camera.position.z) * alpha,
      );
    } else {
      camera.position.set(desired.x, desired.y, desired.z);
      this.cameraPlaced = true;
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(this.position.x, this.position.y + this.settings.lookHeight, this.position.z);

    const speed = vehicles.state(id)?.forwardSpeed ?? 0;
    const fov = speedFieldOfView(this.baseFov, speed, this.settings);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    const id = this.vehicleId;
    if (id) this.context.vehicles?.setInput(id, NEUTRAL_VEHICLE_INPUT);
    if (this.context.camera.fov !== this.baseFov) {
      this.context.camera.fov = this.baseFov;
      this.context.camera.updateProjectionMatrix();
    }
    this.controller.unpossess();
  }

  getCameraDebug(): {
    readonly controlYawDeg: number | null;
    readonly controlPitchDeg: number | null;
    readonly cameraSource: string | null;
  } {
    const id = this.vehicleId;
    const state = id ? this.context.vehicles?.state(id) : null;
    const speed = state?.forwardSpeed ?? 0;
    const drivetrain = state?.drivetrain;
    const engine = drivetrain
      ? ` gear:${drivetrain.gear < 0 ? "R" : drivetrain.gear} rpm:${Math.round(drivetrain.engineRpm)} shift:${drivetrain.shiftTimeRemaining.toFixed(2)}s`
      : "";
    return {
      controlYawDeg: this.heading ? yawDegreesFromHeading(this.heading) : null,
      controlPitchDeg: null,
      cameraSource: `vehicle-chase pawn:${id ?? "none"} speed:${(speed * 3.6).toFixed(0)}km/h${engine}`,
    };
  }

  /** Drops the car upright, a little above where it is, still facing the same way. */
  private resetUpright(id: string): void {
    const object = this.context.vehicles?.object(id);
    if (!object) return;
    object.getWorldPosition(this.position);
    object.getWorldQuaternion(this.quaternion);
    const heading = planarHeadingFromQuaternion(this.quaternion) ?? this.heading ?? { x: 0, z: 1 };
    this.context.vehicles?.reset(id, {
      position: [this.position.x, this.position.y + RESET_LIFT, this.position.z],
      rotation: [0, yawDegreesFromHeading(heading), 0],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    });
  }
}

export const VEHICLE_PLAYER_CONTROLLER: PlayerControllerDefinition = {
  id: "forge.vehicleController",
  inputActions: ["move-forward", "move-back", "move-left", "move-right", "jump", "interact"],
  inputMode: "game",
  pointerLookMode: "right-drag",
  mouseCursor: "show",
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
