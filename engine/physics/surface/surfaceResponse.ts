/** Physical-material blending and wheel response, independent of Rapier/rendering. */
import { resolvePhysicalMaterial } from "../../scene/collision";
import type { EntityId } from "../../scene/entity";
import type { VehicleVec3 } from "../vehicle/vehicleTypes";

export interface SurfaceSample {
  readonly frictionSlipScale: number;
  readonly sideFrictionScale: number;
  readonly rollingResistance: number;
  /** Soft-surface participation (0..1), independent of the profile's depth. */
  readonly deformability: number;
}

export interface WeightedSurfaceMaterial {
  readonly physicalMaterialId: string | null | undefined;
  readonly weight: number;
}

export type VehicleSurfaceProvider = (
  vehicleEntityId: EntityId,
  wheelIndex: number,
  groundEntityId: EntityId | null,
  contactPoint: VehicleVec3,
) => SurfaceSample | null;

export const NEUTRAL_SURFACE_SAMPLE: SurfaceSample = Object.freeze({
  frictionSlipScale: 1,
  sideFrictionScale: 1,
  rollingResistance: 0,
  deformability: 0,
});

/** Positive finite weights are normalised; missing/unknown material blocks are neutral. */
export function resolveSurfaceSample(
  material: string | null | undefined | readonly WeightedSurfaceMaterial[],
): SurfaceSample {
  if (typeof material === "string" || material == null) {
    const profile = resolvePhysicalMaterial(material ?? undefined);
    return {
      frictionSlipScale: profile.vehicle?.frictionSlipScale ?? 1,
      sideFrictionScale: profile.vehicle?.sideFrictionScale ?? 1,
      rollingResistance: profile.vehicle?.rollingResistance ?? 0,
      deformability: (profile.deformation?.maxDepth ?? 0) > 0 ? 1 : 0,
    };
  }
  const entries = material.filter(({ weight }) => Number.isFinite(weight) && weight > 0);
  const maxWeight = entries.reduce((max, entry) => Math.max(max, entry.weight), 0);
  if (maxWeight === 0) return NEUTRAL_SURFACE_SAMPLE;
  // Rescale first so even very large finite weights cannot overflow their sum.
  const total = entries.reduce((sum, entry) => sum + entry.weight / maxWeight, 0);
  let frictionSlipScale = 0;
  let sideFrictionScale = 0;
  let rollingResistance = 0;
  let deformability = 0;
  for (const entry of entries) {
    const sample = resolveSurfaceSample(entry.physicalMaterialId);
    const weight = (entry.weight / maxWeight) / total;
    frictionSlipScale += sample.frictionSlipScale * weight;
    sideFrictionScale += sample.sideFrictionScale * weight;
    rollingResistance += sample.rollingResistance * weight;
    deformability += sample.deformability * weight;
  }
  return { frictionSlipScale, sideFrictionScale, rollingResistance, deformability };
}

/** Default mesh-ground provider; the host supplies the live collider material lookup. */
export function createPhysicalMaterialSurfaceProvider(
  materialIdForGround: (groundEntityId: EntityId) => string | undefined,
): VehicleSurfaceProvider {
  return (_vehicleEntityId, _wheelIndex, groundEntityId) =>
    groundEntityId === null ? null : resolveSurfaceSample(materialIdForGround(groundEntityId));
}

/**
 * Additional brake force = coefficient × suspension load × min(|speed| / 1 m/s, 1).
 * The low-speed ramp gives zero drag at rest and caps drag at coefficient × load.
 * Rapier receives force × dt as its brake impulse cap, so this cannot reverse a
 * wheel. Faz 0 must still compare brakes with chassis impulses in a real scene.
 * Pass the drive command's side stiffness to preserve its handbrake multiplier.
 */
export function computeWheelSurfaceResponse(
  wheel: { readonly frictionSlip: number; readonly sideFrictionStiffness: number },
  sample: SurfaceSample | null,
  speed: number,
  wheelLoad: number,
): { frictionSlip: number; sideFrictionStiffness: number; rollingResistanceForce: number } {
  if (!sample) return { ...wheel, rollingResistanceForce: 0 };
  return {
    frictionSlip: wheel.frictionSlip * sample.frictionSlipScale,
    sideFrictionStiffness: wheel.sideFrictionStiffness * sample.sideFrictionScale,
    rollingResistanceForce: sample.rollingResistance * Math.max(0, wheelLoad) * Math.min(Math.abs(speed), 1),
  };
}
