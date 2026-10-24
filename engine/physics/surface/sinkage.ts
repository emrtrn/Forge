/**
 * How deep one wheel pass presses a soft surface (TERRAIN_DEFORMATION K-B).
 * The single swap point for the depth model: a pressure model (Bekker–Wong)
 * can replace the preset curve behind the same input.
 */
import type { PhysicalMaterialDef } from "../../scene/collision";
import type { VehicleDefinition, VehicleWheelDefinition } from "../vehicle/vehicleTypes";

const GRAVITY = 9.81;

export interface WheelSinkageInput {
  /** Live suspension force on the wheel (N). */
  readonly load: number;
  /** The empty vehicle's static load per wheel (N), see {@link nominalWheelLoad}. */
  readonly nominalLoad: number;
  /** Tyre width (m). The preset curve ignores it; it only sets the track footprint. */
  readonly width: number;
}

/**
 * `maxDepth × deformability × (1 − 2^(−load / nominalLoad))`: an empty vehicle
 * presses half of `maxDepth`, each further nominal load halves the remaining
 * gap. A heavier load always sinks deeper but never past `maxDepth`, the soft
 * layer's thickness over its hard base. Participation is clamped to 0..1;
 * invalid inputs press nothing.
 */
export function sinkage(
  profile: Pick<NonNullable<PhysicalMaterialDef["deformation"]>, "maxDepth"> | null | undefined,
  deformability: number,
  input: WheelSinkageInput,
): number {
  const { load, nominalLoad } = input;
  if (!profile || !Number.isFinite(profile.maxDepth) || profile.maxDepth <= 0) return 0;
  if (!Number.isFinite(deformability) || deformability <= 0) return 0;
  if (!Number.isFinite(nominalLoad) || nominalLoad <= 0 || !Number.isFinite(load) || load <= 0) return 0;
  // Very large ratios underflow 2^-ratio to 0, i.e. the full layer thickness.
  return profile.maxDepth * Math.min(deformability, 1) * (1 - 2 ** -(load / nominalLoad));
}

/** The empty vehicle's static load per wheel: chassis weight shared evenly (N). */
export function nominalWheelLoad(definition: Pick<VehicleDefinition, "massKg" | "wheels">): number {
  return definition.wheels.length > 0 ? (definition.massKg * GRAVITY) / definition.wheels.length : 0;
}

/** Authored tyre width, else `radius × 0.7` (m). */
export function vehicleWheelWidth(wheel: Pick<VehicleWheelDefinition, "radius" | "width">): number {
  return wheel.width ?? wheel.radius * 0.7;
}
