/**
 * The driving half of a vehicle pawn, shared by every Game Mode that puts the
 * player behind a wheel: `forge.vehicle` (the car *is* the pawn) and the TPS
 * mode once its character climbs in (vehicle plan Faz 4).
 *
 * It maps the action vocabulary onto pedals and steering, frames the car with
 * the chase camera, and drops a flipped car back on its wheels. The camera goes
 * through the controller's {@link PlayerCameraManager}, so a mode switching from
 * an on-foot view to this one gets the manager's view-target blend for free.
 */
import { Quaternion, Vector3 } from "three";
import type { PlayerCameraManager } from "@/game/playerCameraManager";
import { NEUTRAL_VEHICLE_INPUT, type VehicleInput } from "@engine/physics/vehicle/vehicleTypes";
import {
  blendHeading,
  chaseCameraPosition,
  followAlpha,
  planarHeadingFromQuaternion,
  speedFieldOfView,
  vehicleInputFromActions,
  yawDegreesFromHeading,
  type PlanarHeading,
  type VehicleChaseCameraSettings,
} from "./vehicleCameraControl";
import type { GameModeContext } from "@/scene/gameModeTypes";

/** How high above its current spot a reset drops the car back onto its wheels. */
const RESET_LIFT = 1;

/** Camera-manager source name; the debug overlay and smoke tests key on it. */
export const VEHICLE_CHASE_CAMERA_SOURCE = "vehicle-chase";

export class VehicleDriver {
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private heading: PlanarHeading | null = null;
  private cameraPosition: Vector3 | null = null;
  private baseFov: number;

  constructor(
    private readonly context: GameModeContext,
    private readonly cameraManager: PlayerCameraManager,
    private readonly settings: VehicleChaseCameraSettings,
    /** Blend from the previous camera source when this view takes over. */
    private readonly viewBlendSeconds = 0,
  ) {
    this.baseFov = context.camera.fov;
  }

  /**
   * Forgets the follow state so the next frame frames the car from scratch, and
   * takes the camera's current field of view as the one speed widens from.
   */
  restart(): void {
    this.heading = null;
    this.cameraPosition = null;
    this.baseFov = this.context.camera.fov;
  }

  /** Forwards the held driving keys (or a neutral input in UI mode) to `id`. */
  drive(id: string): void {
    const vehicles = this.context.vehicles;
    if (!vehicles) return;
    vehicles.setInput(
      id,
      this.context.getInputMode() === "ui"
        ? NEUTRAL_VEHICLE_INPUT
        : vehicleInputFromActions(this.context.actions),
    );
  }

  setInput(id: string, input: VehicleInput): void {
    this.context.vehicles?.setInput(id, input);
  }

  /** Signed forward speed of `id` in m/s (0 when it is not a live vehicle). */
  speed(id: string): number {
    return this.context.vehicles?.state(id)?.forwardSpeed ?? 0;
  }

  /** Eases the chase camera behind `id` and widens the view with speed. */
  updateCamera(id: string, deltaSeconds: number): void {
    const object = this.context.vehicles?.object(id);
    if (!object) return;
    object.getWorldPosition(this.position);
    object.getWorldQuaternion(this.quaternion);
    const facing = planarHeadingFromQuaternion(this.quaternion);
    if (facing) {
      this.heading = this.heading
        ? blendHeading(this.heading, facing, followAlpha(this.settings.headingFollowRate, deltaSeconds))
        : facing;
    }
    if (!this.heading) return;

    const desired = chaseCameraPosition(this.position, this.heading, this.settings);
    if (this.cameraPosition) {
      const alpha = followAlpha(this.settings.positionFollowRate, deltaSeconds);
      this.cameraPosition.x += (desired.x - this.cameraPosition.x) * alpha;
      this.cameraPosition.y += (desired.y - this.cameraPosition.y) * alpha;
      this.cameraPosition.z += (desired.z - this.cameraPosition.z) * alpha;
    } else {
      this.cameraPosition = new Vector3(desired.x, desired.y, desired.z);
    }

    const { camera } = this.context;
    camera.up.set(0, 1, 0);
    this.cameraManager.setViewTarget(
      {
        source: VEHICLE_CHASE_CAMERA_SOURCE,
        pose: {
          position: [this.cameraPosition.x, this.cameraPosition.y, this.cameraPosition.z],
          target: [this.position.x, this.position.y + this.settings.lookHeight, this.position.z],
        },
        projection: {
          fov: speedFieldOfView(this.baseFov, this.speed(id), this.settings),
          near: camera.near,
          far: camera.far,
        },
      },
      { blendTimeSeconds: this.viewBlendSeconds },
    );
    this.cameraManager.update(deltaSeconds);
  }

  /** The chase camera's current planar heading, once it has framed the car. */
  currentHeading(): PlanarHeading | null {
    return this.heading;
  }

  /** Drops the car upright, a little above where it is, still facing the same way. */
  resetUpright(id: string): void {
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

  /** Puts the camera's field of view back to what it was before driving. */
  restoreFov(): void {
    const { camera } = this.context;
    if (camera.fov === this.baseFov) return;
    camera.fov = this.baseFov;
    camera.updateProjectionMatrix();
  }

  /** The overlay's `camera:` line; smoke tests parse `pawn:` and `speed:`. */
  debugSource(id: string | null): string {
    const state = id ? this.context.vehicles?.state(id) : null;
    const speed = state?.forwardSpeed ?? 0;
    const drivetrain = state?.drivetrain;
    const engine = drivetrain
      ? ` gear:${drivetrain.gear < 0 ? "R" : drivetrain.gear} rpm:${Math.round(drivetrain.engineRpm)} shift:${drivetrain.shiftTimeRemaining.toFixed(2)}s`
      : "";
    return `${VEHICLE_CHASE_CAMERA_SOURCE} pawn:${id ?? "none"} speed:${(speed * 3.6).toFixed(0)}km/h${engine}`;
  }

  debugYawDeg(): number | null {
    return this.heading ? yawDegreesFromHeading(this.heading) : null;
  }
}
