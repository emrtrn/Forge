/**
 * Turns vehicle wheel contacts into deformation-field stamps (TERRAIN_DEFORMATION
 * Faz 2). Pure: the caller supplies vehicle states and the soft-surface profile
 * under each contact, so this runs headless and deterministically in tests.
 *
 * Each call sweeps every soft-ground wheel from where it touched last time to
 * where it touches now, so a fast car leaves a continuous track at any frame
 * rate. The per-call compaction is rescaled to the frame's length: a cell under
 * a wheel for a given time ends equally deep at 30 and at 144 fps.
 */
import type { DeformationField } from "../../scene/deformationField";
import type { EntityId } from "../../scene/entity";
import type { SurfaceDeformationSample } from "../../terrain/terrainSurface";
import type { VehicleDefinition, VehicleState, VehicleVec3 } from "../vehicle/vehicleTypes";
import { nominalWheelLoad, sinkage, vehicleWheelWidth } from "./sinkage";

/** The soft-surface profile under a wheel contact, or null for hard / non-terrain ground. */
export type WheelDeformationLookup = (groundEntityId: EntityId, contactPoint: VehicleVec3) => SurfaceDeformationSample | null;

/** A longer jump between two calls (respawn, teleport) starts a new track instead of drawing one across. */
const MAX_SWEEP_METRES = 2;
/** The reference rate `compaction` is authored for: one pass per 60 Hz step. */
const COMPACTION_REFERENCE_HZ = 60;

/** Per-call max-lerp amount equivalent to `compaction` per 60 Hz step over `dtSeconds`. */
export function frameCompaction(compaction: number, dtSeconds: number): number {
  if (!Number.isFinite(compaction) || !Number.isFinite(dtSeconds) || compaction <= 0 || dtSeconds <= 0) return 0;
  if (compaction >= 1) return 1;
  return 1 - (1 - compaction) ** (dtSeconds * COMPACTION_REFERENCE_HZ);
}

/** Tyre footprint length for a sinkage: the chord `2√(2 r z)`, never below a quarter radius. */
export function wheelContactLength(radius: number, depth: number): number {
  return Math.max(2 * Math.sqrt(2 * radius * Math.max(0, depth)), radius * 0.25);
}

/**
 * Chassis heading (radians from +Z towards +X) from the world hard points of
 * the front and rear wheels; null without both axles.
 */
export function vehicleHeading(state: VehicleState): number | null {
  let fx = 0, fz = 0, front = 0, rx = 0, rz = 0, rear = 0;
  for (const wheel of state.wheels) {
    if (!wheel.hardPoint) continue;
    if (wheel.position[2] >= 0) {
      fx += wheel.hardPoint[0]; fz += wheel.hardPoint[2]; front += 1;
    } else {
      rx += wheel.hardPoint[0]; rz += wheel.hardPoint[2]; rear += 1;
    }
  }
  if (front === 0 || rear === 0) return null;
  const dx = fx / front - rx / rear;
  const dz = fz / front - rz / rear;
  return dx === 0 && dz === 0 ? null : Math.atan2(dx, dz);
}

export class WheelTrackStamper {
  /** Last soft contact per vehicle and wheel (world X/Z). */
  private readonly lastContacts = new Map<EntityId, ([number, number] | null)[]>();

  constructor(private readonly field: DeformationField) {}

  /** Stamps every wheel of one vehicle on soft ground; returns the wheels that stamped. */
  stampVehicle(
    vehicleId: EntityId,
    state: VehicleState,
    definition: Pick<VehicleDefinition, "massKg" | "wheels"> | null,
    deformationAt: WheelDeformationLookup,
    dtSeconds: number,
  ): number {
    const last = this.lastContacts.get(vehicleId) ?? [];
    this.lastContacts.set(vehicleId, last);
    const nominalLoad = definition ? nominalWheelLoad(definition) : 0;
    const heading = vehicleHeading(state);
    let stamped = 0;
    state.wheels.forEach((wheel, index) => {
      const contact = wheel.contactPoint;
      const surface = wheel.inContact && contact && wheel.groundEntityId !== null && nominalLoad > 0
        ? deformationAt(wheel.groundEntityId, contact) : null;
      if (!surface || !contact) {
        last[index] = null;
        return;
      }
      const to: [number, number] = [contact[0], contact[2]];
      const previous = last[index];
      const from = previous && Math.hypot(to[0] - previous[0], to[1] - previous[1]) <= MAX_SWEEP_METRES ? previous : to;
      last[index] = to;
      const authored = definition?.wheels[index];
      const width = vehicleWheelWidth(authored ?? wheel);
      const depth = sinkage(surface, surface.deformability, { load: wheel.suspensionForce, nominalLoad, width });
      const compaction = frameCompaction(surface.compaction, dtSeconds);
      if (compaction === 0) return;
      this.field.stampWheel({
        from, to, width,
        contactLength: wheelContactLength(wheel.radius, depth),
        ...(heading === null ? {} : { heading: heading + wheel.steering }),
        targetDepth: depth,
        compaction,
        disturbance: 255 * Math.min(1, surface.deformability),
        recoveryRate: surface.recoveryRate,
      });
      stamped += 1;
    });
    return stamped;
  }

  /** Drops a vehicle's track memory (unloaded, despawned). */
  forget(vehicleId: EntityId): void {
    this.lastContacts.delete(vehicleId);
  }

  clear(): void {
    this.lastContacts.clear();
  }
}
