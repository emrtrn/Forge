/** Physical-material blending and wheel response, independent of Rapier/rendering. */
import { resolvePhysicalMaterial, type PhysicalMaterialDef } from "../../scene/collision";
import type { EntityId } from "../../scene/entity";
import type { VehicleVec3 } from "../vehicle/vehicleTypes";

export interface SurfaceSample {
  readonly frictionSlipScale: number;
  readonly sideFrictionScale: number;
  readonly rollingResistance: number;
  /** Soft-surface participation (0..1), independent of the profile's depth. */
  readonly deformability: number;
  /** Optional physical longitudinal grip (force / load), separate from Rapier tuning. */
  readonly tractionCoefficient?: number;
  /** Physical soil data, available even without a visual deformation field. */
  readonly softGround?: SoftGroundSample;
}

export interface SoftGroundSample {
  readonly maxDepth: number;
  readonly compaction: number;
  readonly digRate: number;
  readonly sinkResistance: number;
  readonly ploughResistance: number;
  readonly ploughExponent?: number;
  readonly rollingResistanceAtRest?: number;
  readonly highSpeedResistance?: number;
  readonly resistanceSpeedMps?: number;
}

const SOFT_GROUND_CONTROL_DEFAULTS: Partial<Record<keyof SoftGroundSample, number>> = Object.freeze({
  ploughExponent: 1, rollingResistanceAtRest: 1, highSpeedResistance: 0, resistanceSpeedMps: 20 / 3.6,
});

/** Defaults for optional preset controls, also used by both material blend paths. */
export function softGroundParameter(sample: SoftGroundSample, key: keyof SoftGroundSample): number {
  return sample[key] ?? SOFT_GROUND_CONTROL_DEFAULTS[key] ?? 0;
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

/** One wheel contact asking how far the visible soft ground lies below the collider (Faz 3). */
export interface VehicleWheelGroundQuery {
  readonly vehicleEntityId: EntityId;
  readonly wheelIndex: number;
  readonly groundEntityId: EntityId | null;
  readonly contactPoint: VehicleVec3;
  /** Rolling direction in world X/Z: radians from +Z toward +X, steering included. */
  readonly heading: number;
  /** Tyre width (m). */
  readonly width: number;
  /** Tyre radius (m); sizes the footprint a rolling wheel is about to leave behind. */
  readonly radius?: number;
  /**
   * Rolling direction along `heading`: +1 forward, −1 reverse, 0 (or absent)
   * standing. Rut steering reads the ground ahead, so only a rolling wheel has one.
   */
  readonly travel?: number;
}

/** The track under a wheel: how deep it lies, how hard its mud drags a grounded belly, how its walls lean. */
export interface VehicleWheelSink {
  /** Visible ground below the collider surface (m, >= 0). */
  readonly depth: number;
  /** The soft layer's `sinkResistance`, the belly-drag coefficient. */
  readonly resistance: number;
  /**
   * Rut cross slope just ahead of the tyre (research C6, `rutSlopeAhead` in
   * wheelTracks.ts): extra depth toward the axle's + side per metre. Physics
   * pushes the wheel toward the deeper side (rut steering). Absent = 0.
   */
  readonly slope?: number;
}

/**
 * Virtual ground offset: the physics step lowers each wheel's suspension rest
 * length by the returned depth instead of rebuilding the terrain collider.
 */
export type VehicleGroundSinkProvider = (query: VehicleWheelGroundQuery) => VehicleWheelSink | null;

export const NEUTRAL_SURFACE_SAMPLE: SurfaceSample = Object.freeze({
  frictionSlipScale: 1,
  sideFrictionScale: 1,
  rollingResistance: 0,
  deformability: 0,
});

/** Shared numeric response for presets and layer-local profiles. */
export function surfaceSampleFromProfile(profile: PhysicalMaterialDef): SurfaceSample {
  return {
    frictionSlipScale: profile.vehicle?.frictionSlipScale ?? 1,
    sideFrictionScale: profile.vehicle?.sideFrictionScale ?? 1,
    rollingResistance: profile.vehicle?.rollingResistance ?? 0,
    deformability: (profile.deformation?.maxDepth ?? 0) > 0 ? 1 : 0,
    ...(profile.vehicle?.tractionCoefficient === undefined ? {} : { tractionCoefficient: profile.vehicle.tractionCoefficient }),
    ...(profile.deformation ? { softGround: {
      maxDepth: profile.deformation.maxDepth, compaction: profile.deformation.compaction,
      digRate: profile.deformation.digRate, sinkResistance: profile.deformation.sinkResistance,
      ploughResistance: profile.deformation.ploughResistance ?? 0,
      ploughExponent: profile.deformation.ploughExponent ?? 1,
      rollingResistanceAtRest: profile.deformation.rollingResistanceAtRest ?? 1,
      highSpeedResistance: profile.deformation.highSpeedResistance ?? 0,
      resistanceSpeedMps: profile.deformation.resistanceSpeedMps ?? 20 / 3.6,
    } } : {}),
  };
}

/** Positive finite weights are normalised; missing/unknown material blocks are neutral. */
export function resolveSurfaceSample(
  material: string | null | undefined | readonly WeightedSurfaceMaterial[],
): SurfaceSample {
  if (typeof material === "string" || material == null) {
    const profile = resolvePhysicalMaterial(material ?? undefined);
    return surfaceSampleFromProfile(profile);
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
  let tractionCoefficient = 0;
  let hasTractionCoefficient = false;
  let softWeight = 0;
  const softGround = { maxDepth: 0, compaction: 0, digRate: 0, sinkResistance: 0, ploughResistance: 0, ploughExponent: 0, rollingResistanceAtRest: 0, highSpeedResistance: 0, resistanceSpeedMps: 0 };
  for (const entry of entries) {
    const sample = resolveSurfaceSample(entry.physicalMaterialId);
    const weight = (entry.weight / maxWeight) / total;
    frictionSlipScale += sample.frictionSlipScale * weight;
    sideFrictionScale += sample.sideFrictionScale * weight;
    rollingResistance += sample.rollingResistance * weight;
    deformability += sample.deformability * weight;
    tractionCoefficient += (sample.tractionCoefficient ?? 1) * weight;
    hasTractionCoefficient ||= sample.tractionCoefficient !== undefined;
    if (sample.softGround) {
      softWeight += weight;
      for (const key of Object.keys(softGround) as (keyof typeof softGround)[]) softGround[key] += softGroundParameter(sample.softGround, key) * weight;
    }
  }
  if (softWeight > 0) for (const key of Object.keys(softGround) as (keyof typeof softGround)[]) softGround[key] /= softWeight;
  return { frictionSlipScale, sideFrictionScale, rollingResistance, deformability,
    ...(softWeight > 0 ? { softGround } : {}),
    ...(hasTractionCoefficient ? { tractionCoefficient } : {}) };
}

/** Default mesh-ground provider; the host supplies the live collider material lookup. */
export function createPhysicalMaterialSurfaceProvider(
  materialIdForGround: (groundEntityId: EntityId) => string | undefined,
): VehicleSurfaceProvider {
  return (_vehicleEntityId, _wheelIndex, groundEntityId) =>
    groundEntityId === null ? null : resolveSurfaceSample(materialIdForGround(groundEntityId));
}

/**
 * Rolling-only diagnostic = coefficient × suspension load × min(|speed| / 1 m/s, 1).
 * The low-speed ramp gives zero drag at rest and caps drag at coefficient × load.
 * Runtime uses wheelGroundResistance and a separate contact impulse, since
 * Rapier skips its wheel brake whenever that wheel has engine force.
 * Pass the drive command's side stiffness to preserve its handbrake multiplier.
 */
export function computeWheelSurfaceResponse(
  wheel: { readonly frictionSlip: number; readonly sideFrictionStiffness: number },
  sample: SurfaceSample | null,
  speed: number,
  wheelLoad: number,
): { frictionSlip: number; sideFrictionStiffness: number; rollingResistanceForce: number; tractionCoefficient?: number } {
  if (!sample) return { ...wheel, rollingResistanceForce: 0 };
  return {
    frictionSlip: wheel.frictionSlip * sample.frictionSlipScale,
    sideFrictionStiffness: wheel.sideFrictionStiffness * sample.sideFrictionScale,
    rollingResistanceForce: sample.rollingResistance * Math.max(0, wheelLoad) * Math.min(Math.abs(speed), 1),
    ...(sample.tractionCoefficient === undefined ? {} : { tractionCoefficient: sample.tractionCoefficient }),
  };
}
