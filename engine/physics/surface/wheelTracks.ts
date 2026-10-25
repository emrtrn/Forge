/**
 * Turns vehicle wheel contacts into deformation-field stamps (TERRAIN_DEFORMATION
 * Faz 2). Pure: the caller supplies vehicle states and the soft-surface profile
 * under each contact, so this runs headless and deterministically in tests.
 *
 * Each call sweeps every soft-ground wheel from where it touched last time to
 * where it touches now, so a fast car leaves a continuous track at any frame
 * rate. The per-call compaction is rescaled to the frame's length: a cell under
 * a wheel for a given time ends equally deep at 30 and at 144 fps.
 *
 * Faz 3: a driven wheel that spins (`tractionSlip`) digs its footprint deeper
 * at `digRate`, up to the soft layer's `maxDepth`, on top of the static rut.
 */
import { DEFORMATION_DEPTH_SCALE, type DeformationField } from "../../scene/deformationField";
import type { EntityId } from "../../scene/entity";
import type { SurfaceDeformationSample } from "../../terrain/terrainSurface";
import type { VehicleDefinition, VehicleState, VehicleVec3 } from "../vehicle/vehicleTypes";
import { nominalWheelLoad, sinkage, vehicleWheelWidth } from "./sinkage";
import { digTargetDepth, wheelFootprint } from "./wheelSink";

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

/** Gap (m) past the wheel's own fresh footprint where rut steering reads the ground. */
export const RUT_LOOKAHEAD_MARGIN = 0.25;

/**
 * Rut steering's cross slope (research C6): the footprint slope
 * ({@link wheelFootprint}) half a contact length plus
 * {@link RUT_LOOKAHEAD_MARGIN} ahead of a rolling wheel, along `travel`. The
 * ground right under a tyre is the rut it is stamping now, quantised to the
 * field's cells and so never symmetric about a tyre narrower than two cells;
 * ahead lies only track that was there before (its own earlier pass, another
 * vehicle's). A standing wheel (`travel` 0) has no slope.
 */
export function rutSlopeAhead(
  depthAt: (worldX: number, worldZ: number) => number,
  contactX: number,
  contactZ: number,
  heading: number,
  width: number,
  radius: number,
  depth: number,
  travel: number,
): number {
  if (!Number.isFinite(travel) || travel === 0 || !Number.isFinite(heading)) return 0;
  const reach = Math.sign(travel) * ((Number.isFinite(radius) && radius > 0 ? wheelContactLength(radius, depth) / 2 : 0) + RUT_LOOKAHEAD_MARGIN);
  return wheelFootprint(depthAt, contactX + Math.sin(heading) * reach, contactZ + Math.cos(heading) * reach, heading, width).slope;
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
  /**
   * Dig depth (m, under one 0.1 mm quantum) each wheel asked for but the
   * field's floor quantisation dropped; added back next call so slow digging
   * (low slip, high frame rate) still deepens instead of flooring to nothing.
   */
  private readonly digCarry = new Map<EntityId, number[]>();

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
    const carry = this.digCarry.get(vehicleId) ?? [];
    this.digCarry.set(vehicleId, carry);
    const nominalLoad = definition ? nominalWheelLoad(definition) : 0;
    const heading = vehicleHeading(state);
    let stamped = 0;
    state.wheels.forEach((wheel, index) => {
      const contact = wheel.contactPoint;
      const surface = wheel.inContact && contact && wheel.groundEntityId !== null && nominalLoad > 0
        ? deformationAt(wheel.groundEntityId, contact) : null;
      if (!surface || !contact) {
        last[index] = null;
        carry[index] = 0;
        return;
      }
      const to: [number, number] = [contact[0], contact[2]];
      const previous = last[index];
      const from = previous && Math.hypot(to[0] - previous[0], to[1] - previous[1]) <= MAX_SWEEP_METRES ? previous : to;
      last[index] = to;
      const authored = definition?.wheels[index];
      const width = vehicleWheelWidth(authored ?? wheel);
      const depth = wheel.soilDepth ?? Math.max(wheel.sinkDepth ?? 0,
        sinkage(surface, surface.deformability, { load: wheel.suspensionForce, nominalLoad, width }));
      // Physics already combined compaction, old ruts and digging. Mirror its
      // target once, rather than applying those processes a second time.
      const compaction = wheel.soilDepth === undefined ? frameCompaction(surface.compaction, dtSeconds) : 1;
      const wheelHeading = heading === null ? {} : { heading: heading + wheel.steering };
      if (compaction > 0) {
        this.field.stampWheel({
          from, to, width,
          contactLength: wheelContactLength(wheel.radius, depth),
          ...wheelHeading,
          targetDepth: depth,
          compaction,
          disturbance: 255 * Math.min(1, surface.deformability),
          recoveryRate: surface.recoveryRate,
        });
      }
      const dug = wheel.soilDepth === undefined && this.dig(wheel, surface, to, width, wheelHeading, carry, index, dtSeconds);
      if (compaction > 0 || dug) stamped += 1;
    });
    return stamped;
  }

  /** Drops a vehicle's track memory (unloaded, despawned). */
  forget(vehicleId: EntityId): void {
    this.lastContacts.delete(vehicleId);
    this.digCarry.delete(vehicleId);
  }

  clear(): void {
    this.lastContacts.clear();
    this.digCarry.clear();
  }

  /** Slip digging at the current contact (full compaction, full tint); true when it deepened the target. */
  private dig(
    wheel: VehicleState["wheels"][number],
    surface: SurfaceDeformationSample,
    at: [number, number],
    width: number,
    heading: { heading?: number },
    carry: number[],
    index: number,
    dtSeconds: number,
  ): boolean {
    const slip = wheel.tractionSlip ?? 0;
    if (!(slip > 0) || !(surface.digRate > 0)) {
      carry[index] = 0;
      return false;
    }
    const current = this.field.sample(at[0], at[1]).depth;
    const cap = surface.maxDepth * Math.min(surface.deformability, 1);
    const dug = digTargetDepth(current, slip, surface.digRate, dtSeconds, cap);
    if (!(dug > current)) {
      carry[index] = 0;
      return false;
    }
    const target = Math.min(cap, dug + (carry[index] ?? 0));
    this.field.stampWheel({
      from: at, to: at, width,
      contactLength: wheelContactLength(wheel.radius, target),
      ...heading,
      targetDepth: target,
      compaction: 1,
      disturbance: 255,
      recoveryRate: surface.recoveryRate,
    });
    const reached = this.field.sample(at[0], at[1]).depth;
    carry[index] = Math.min(Math.max(target - reached, 0), 1 / DEFORMATION_DEPTH_SCALE);
    return true;
  }
}
