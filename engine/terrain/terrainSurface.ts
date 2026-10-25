/**
 * Vehicle surface response from terrain paint layers (TERRAIN_DEFORMATION Faz
 * 1b). Each paint layer may name a built-in physical material; a point's
 * response is the weight-blended profile of its layers, so grip and drag fade
 * across a mud/grass border instead of switching.
 *
 * A terrain where no layer names a physical material builds no source at all:
 * the host's collider-material provider then answers exactly as before (I3).
 */
import { rotationMatrixFromEulerDegrees } from "../physics/rotatedBox";
import {
  NEUTRAL_SURFACE_SAMPLE, resolveSurfaceSample,
  type SurfaceSample, type VehicleSurfaceProvider,
} from "../physics/surface/surfaceResponse";
import type { VehicleVec3 } from "../physics/vehicle/vehicleTypes";
import { resolvePhysicalMaterial, type PhysicalMaterialDef } from "../scene/collision";
import type { EntityId } from "../scene/entity";
import type { ForgeLandscapeData } from "../scene/landscape";
import type { Vec3 } from "../scene/layout";
import { terrainLayerWeightsAt } from "./terrainHeightQuery";
import type { WorldTerrainDocument } from "./terrainLoader";
import { tileKey } from "./terrainTypes";

export interface TerrainSurfaceSource {
  /** Physical material id per paint layer (`null` = neutral), aligned with `weightsAt`. */
  readonly physicalMaterials: readonly (string | null)[];
  /** Writes the layer weights under a world point into `out`; false off the terrain. */
  weightsAt(point: VehicleVec3, out: number[]): boolean;
}

/**
 * The soft-surface profile under a point, blended over the deformable layers
 * (TERRAIN_DEFORMATION Faz 2): `deformability` is their share of the paint
 * weight, the other fields their weight-averaged profile values.
 */
export interface SurfaceDeformationSample {
  readonly deformability: number;
  readonly maxDepth: number;
  readonly compaction: number;
  /** Additional digging while slipping (m/s). */
  readonly digRate: number;
  readonly recoveryRate: number;
  /** Extra resistance multiplier as the wheel sinks. */
  readonly sinkResistance: number;
}

type DeformationProfile = NonNullable<PhysicalMaterialDef["deformation"]>;

/** Per-layer physical material ids, or `null` when no layer has one. */
export function terrainLayerPhysicalMaterials(
  layers: readonly { readonly physicalMaterial?: string | null }[],
): (string | null)[] | null {
  const ids = layers.map((layer) => layer.physicalMaterial || null);
  return ids.some((id) => id !== null) ? ids : null;
}

/** A multi-tile World Terrain in world space; reads the document's live (streamed) tile map. */
export function worldTerrainSurfaceSource({ def, tiles }: WorldTerrainDocument): TerrainSurfaceSource | null {
  const physicalMaterials = terrainLayerPhysicalMaterials(def.layers);
  if (!physicalMaterials) return null;
  const lookup = { tile: (x: number, z: number) => tiles.get(tileKey(x, z)) };
  return {
    physicalMaterials,
    weightsAt: (point, out) => terrainLayerWeightsAt(def, lookup, point[0], point[2], out) !== null,
  };
}

/**
 * A 1×1 Landscape placed at `position` / `rotation` (XYZ Euler degrees, the
 * collider's transform). The grid is actor-centred like its heightfield.
 */
export function landscapeSurfaceSource(
  data: ForgeLandscapeData, position: Vec3, rotation: Vec3,
): TerrainSurfaceSource | null {
  const physicalMaterials = terrainLayerPhysicalMaterials(data.layers);
  if (!physicalMaterials) return null;
  const { verticesX, verticesZ, spacing } = data.size;
  const halfX = ((verticesX - 1) * spacing) / 2;
  const halfZ = ((verticesZ - 1) * spacing) / 2;
  const m = rotationMatrixFromEulerDegrees(rotation);
  return {
    physicalMaterials,
    weightsAt: (point, out) => {
      // World → local is the transposed rotation (row-major matrix).
      const dx = point[0] - position[0];
      const dy = point[1] - position[1];
      const dz = point[2] - position[2];
      const gx = (m[0] * dx + m[3] * dy + m[6] * dz + halfX) / spacing;
      const gz = (m[2] * dx + m[5] * dy + m[8] * dz + halfZ) / spacing;
      if (!(gx >= 0 && gz >= 0 && gx <= verticesX - 1 && gz <= verticesZ - 1)) return false;
      const x0 = Math.min(Math.floor(gx), verticesX - 2);
      const z0 = Math.min(Math.floor(gz), verticesZ - 2);
      const fx = gx - x0;
      const fz = gz - z0;
      const a = z0 * verticesX + x0;
      const c = a + verticesX;
      out.length = data.layers.length;
      data.layers.forEach((layer, index) => {
        const w = layer.weights;
        const top = (w[a] ?? 0) * (1 - fx) + (w[a + 1] ?? 0) * fx;
        const bottom = (w[c] ?? 0) * (1 - fx) + (w[c + 1] ?? 0) * fx;
        out[index] = top * (1 - fz) + bottom * fz;
      });
      return true;
    },
  };
}

/**
 * Blends layer samples by weight; the same result as `resolveSurfaceSample`
 * over the weighted ids, with each layer's profile resolved once per source.
 */
export class TerrainSurfaceSampler {
  private readonly layerSamples: readonly SurfaceSample[];
  private readonly layerProfiles: readonly (DeformationProfile | null)[];
  private readonly weights: number[] = [];

  constructor(readonly source: TerrainSurfaceSource) {
    this.layerSamples = source.physicalMaterials.map((id) => resolveSurfaceSample(id));
    this.layerProfiles = source.physicalMaterials.map((id) => {
      const profile = id ? resolvePhysicalMaterial(id).deformation : undefined;
      return profile && profile.maxDepth > 0 ? profile : null;
    });
  }

  /** Whether any layer can be deformed at all; a terrain of only grippy layers never stamps tracks. */
  get deformable(): boolean {
    return this.layerProfiles.some((profile) => profile !== null);
  }

  /** `null` off the terrain or where no deformable layer carries weight. */
  deformationAt(point: VehicleVec3): SurfaceDeformationSample | null {
    if (!this.deformable || !this.source.weightsAt(point, this.weights)) return null;
    let total = 0;
    let soft = 0;
    let maxDepth = 0;
    let compaction = 0;
    let digRate = 0;
    let recoveryRate = 0;
    let sinkResistance = 0;
    this.weights.forEach((weight, index) => {
      if (!Number.isFinite(weight) || weight <= 0) return;
      total += weight;
      const profile = this.layerProfiles[index];
      if (!profile) return;
      soft += weight;
      maxDepth += profile.maxDepth * weight;
      compaction += profile.compaction * weight;
      digRate += profile.digRate * weight;
      recoveryRate += profile.recoveryRate * weight;
      sinkResistance += profile.sinkResistance * weight;
    });
    if (soft === 0) return null;
    return {
      deformability: soft / total,
      maxDepth: maxDepth / soft,
      compaction: compaction / soft,
      digRate: digRate / soft,
      recoveryRate: recoveryRate / soft,
      sinkResistance: sinkResistance / soft,
    };
  }

  /** `null` off the terrain; neutral where no layer carries weight. */
  sampleAt(point: VehicleVec3): SurfaceSample | null {
    if (!this.source.weightsAt(point, this.weights)) return null;
    let total = 0;
    for (const weight of this.weights) if (Number.isFinite(weight) && weight > 0) total += weight;
    if (total === 0) return NEUTRAL_SURFACE_SAMPLE;
    let frictionSlipScale = 0;
    let sideFrictionScale = 0;
    let rollingResistance = 0;
    let deformability = 0;
    let tractionCoefficient = 0;
    let hasTractionCoefficient = false;
    this.weights.forEach((weight, index) => {
      if (!Number.isFinite(weight) || weight <= 0) return;
      // A tile layer beyond the definition's layer list is neutral.
      const sample = this.layerSamples[index] ?? NEUTRAL_SURFACE_SAMPLE;
      const share = weight / total;
      frictionSlipScale += sample.frictionSlipScale * share;
      sideFrictionScale += sample.sideFrictionScale * share;
      rollingResistance += sample.rollingResistance * share;
      deformability += sample.deformability * share;
      tractionCoefficient += (sample.tractionCoefficient ?? 1) * share;
      hasTractionCoefficient ||= sample.tractionCoefficient !== undefined;
    });
    return { frictionSlipScale, sideFrictionScale, rollingResistance, deformability,
      ...(hasTractionCoefficient ? { tractionCoefficient } : {}) };
  }

  /** Heaviest layer's physical material (for wheel effects/sounds); `null` off-terrain or neutral. */
  dominantMaterialAt(point: VehicleVec3): string | null {
    if (!this.source.weightsAt(point, this.weights)) return null;
    let best = -1;
    let bestWeight = 0;
    this.weights.forEach((weight, index) => {
      if (weight > bestWeight) {
        best = index;
        bestWeight = weight;
      }
    });
    return best < 0 ? null : this.source.physicalMaterials[best] ?? null;
  }
}

/**
 * Wheel provider that answers from a terrain's paint layers when the wheel
 * stands on a terrain collider with a surface source, and from `fallback`
 * (the collider's own physical material) everywhere else.
 */
export function createTerrainSurfaceProvider(
  samplerFor: (groundEntityId: EntityId) => TerrainSurfaceSampler | null | undefined,
  fallback: VehicleSurfaceProvider,
): VehicleSurfaceProvider {
  return (vehicleEntityId, wheelIndex, groundEntityId, contactPoint) => {
    const sampler = groundEntityId === null ? null : samplerFor(groundEntityId);
    return sampler
      ? sampler.sampleAt(contactPoint) ?? NEUTRAL_SURFACE_SAMPLE
      : fallback(vehicleEntityId, wheelIndex, groundEntityId, contactPoint);
  };
}
