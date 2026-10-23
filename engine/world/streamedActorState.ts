/**
 * In-memory pose memory for World Partition streamed actors.
 *
 * A streamed Actor Script actor is destroyed when its cell unloads and rebuilt
 * from the authored layout when the cell returns, so a crate that was pushed or
 * a car that was parked elsewhere would snap back home. This cache remembers
 * where such a body was left (at rest — an unloaded world does not simulate) and
 * the host re-applies it on activation. Vehicles also keep handbrake and
 * gearbox, which is also how a save restore reaches a car whose cell is not
 * loaded yet.
 *
 * Only a body that actually moved is kept: an actor back at its authored pose
 * needs no entry, and the layout already describes it.
 */
import type { SavedVehicleDrivetrain, SavedVehicleState } from "../persistence/saveGameState";

type Vec3 = readonly [number, number, number];

/** Metres / degrees below which a pose counts as "still at the authored spot". */
const POSITION_EPSILON = 0.05;
const ROTATION_EPSILON_DEG = 0.5;

export interface StreamedActorPose {
  readonly position: Vec3;
  /** Euler degrees, the Transform component convention. */
  readonly rotation: Vec3;
}

export interface StreamedActorState extends StreamedActorPose {
  /** Vehicle-only: a parked car keeps its brake and gear, never its velocity. */
  readonly vehicle?: {
    readonly handbrake: boolean;
    readonly drivetrain: SavedVehicleDrivetrain | null;
  };
}

function angleDelta(a: number, b: number): number {
  const wrapped = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(wrapped);
}

export function poseMatches(a: StreamedActorPose, b: StreamedActorPose): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(a.position[axis]! - b.position[axis]!) > POSITION_EPSILON) return false;
    if (angleDelta(a.rotation[axis]!, b.rotation[axis]!) > ROTATION_EPSILON_DEG) return false;
  }
  return true;
}

export class StreamedActorStateCache {
  private readonly states = new Map<string, StreamedActorState>();

  /**
   * Remembers `state` for an unloading actor, or drops any older entry when the
   * body is back at its `authored` pose. Returns whether an entry is now held.
   */
  remember(entityId: string, state: StreamedActorState, authored: StreamedActorPose): boolean {
    if (poseMatches(state, authored) && !state.vehicle?.handbrake) {
      this.states.delete(entityId);
      return false;
    }
    this.states.set(entityId, {
      position: [...state.position],
      rotation: [...state.rotation],
      ...(state.vehicle ? { vehicle: { handbrake: state.vehicle.handbrake, drivetrain: state.vehicle.drivetrain } } : {}),
    });
    return true;
  }

  /** A save-restored car whose cell was not loaded: parked at its saved pose. */
  rememberSavedVehicle(saved: SavedVehicleState): void {
    this.states.set(saved.entityId, {
      position: [...saved.position],
      rotation: [...saved.rotation],
      vehicle: { handbrake: saved.handbrake, drivetrain: saved.drivetrain },
    });
  }

  /** Removes and returns the entry: an activated actor is live state again. */
  take(entityId: string): StreamedActorState | undefined {
    const state = this.states.get(entityId);
    this.states.delete(entityId);
    return state;
  }

  has(entityId: string): boolean {
    return this.states.has(entityId);
  }

  /** Unloaded cars as save entries (at rest), in insertion order. */
  savedVehicles(): SavedVehicleState[] {
    const vehicles: SavedVehicleState[] = [];
    for (const [entityId, state] of this.states) {
      if (!state.vehicle) continue;
      vehicles.push({
        entityId,
        position: [...state.position],
        rotation: [...state.rotation],
        linearVelocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        handbrake: state.vehicle.handbrake,
        drivetrain: state.vehicle.drivetrain,
      });
    }
    return vehicles;
  }

  clear(): void {
    this.states.clear();
  }
}
