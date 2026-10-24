/** Deterministic, render-agnostic foliage generation over resident ground surfaces. */
import {
  terrainHeightAt, terrainSmoothNormalAt, terrainLayerWeightsAt, TerrainTileMap,
  type TerrainQueryDef, type TerrainTileLookup,
} from "../terrain/terrainHeightQuery";
import { TERRAIN_MAX_LAYERS, terrainWeightBlockCount, type TerrainTileData } from "../terrain/terrainTypes";
import type { ForgeFoliageTypeDef, LandscapeFoliageRule } from "./foliage";
import { makeFoliageRng, passesFoliageFilters } from "./foliagePaint";
import type { LandscapeFoliageGenerationInput } from "./landscapeFoliage";
import type { Vec3 } from "./layout";

export interface FoliageSurface {
  /** Exact collider height at world X/Z, or null off-surface / not resident. */
  heightAt(x: number, z: number): number | null;
  /** Unit normal for alignment at world X/Z, or null. */
  normalAt(x: number, z: number): Vec3 | null;
  /** Layer paint weight 0..1, or null for an unknown layer / off-surface. */
  layerWeightAt(layerId: string, x: number, z: number): number | null;
  /** World X/Z bounds of the surface. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** World Terrain surface over the resident tiles. */
export function worldTerrainFoliageSurface(
  def: TerrainQueryDef & { layers: readonly { id: string }[] },
  tiles: TerrainTileLookup,
): FoliageSurface {
  return {
    heightAt: (x, z) => terrainHeightAt(def, tiles, x, z),
    normalAt: (x, z) => terrainSmoothNormalAt(def, tiles, x, z),
    layerWeightAt: (layerId, x, z) => {
      const index = def.layers.findIndex((layer) => layer.id === layerId);
      if (index < 0) return null;
      const weights = terrainLayerWeightsAt(def, tiles, x, z);
      return weights === null ? null : weights[index] ?? 0;
    },
    bounds: {
      minX: def.origin[0], maxX: def.origin[0] + def.tilesX * def.tileQuads * def.spacing,
      minZ: def.origin[2], maxZ: def.origin[2] + def.tilesZ * def.tileQuads * def.spacing,
    },
  };
}

/** Exact triangle surface for an unrotated, square legacy Landscape. */
export function landscapeFoliageSurface(input: LandscapeFoliageGenerationInput): FoliageSurface | null {
  const { data, position } = input;
  const { verticesX, verticesZ, spacing, heightScale } = data.size;
  if (input.rotation?.some((value) => Math.abs(value) > 1e-9)
    || verticesX !== verticesZ || verticesX < 2 || spacing <= 0) return null;
  const count = verticesX * verticesX;
  const layerCount = Math.min(data.layers.length, TERRAIN_MAX_LAYERS);
  const weights = new Uint8Array(terrainWeightBlockCount(layerCount) * count * 4);
  for (let layer = 0; layer < layerCount; layer += 1) {
    const block = Math.floor(layer / 4);
    const channel = layer % 4;
    for (let index = 0; index < count; index += 1) {
      weights[block * count * 4 + index * 4 + channel] = Math.max(0, Math.min(255,
        Math.round((data.layers[layer]!.weights[index] ?? 0) * 255)));
    }
  }
  const tile: TerrainTileData = {
    x: 0, z: 0, size: verticesX,
    heights: Float32Array.from(data.heights, (height) => height * heightScale),
    layerCount, weights,
  };
  const tiles = new TerrainTileMap();
  tiles.set(tile);
  const width = (verticesX - 1) * spacing;
  return worldTerrainFoliageSurface({
    tileQuads: verticesX - 1, spacing, tilesX: 1, tilesZ: 1,
    origin: [position[0] - width / 2, position[1], position[2] - width / 2],
    layers: data.layers,
  }, tiles);
}

export const MAX_FOLIAGE_CELL_INSTANCES = 4096;

function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

/** Frozen unsigned 32-bit cell hash; changing it reshuffles existing grass layouts. */
export function foliageCellSeed(seed: number, cellX: number, cellZ: number): number {
  return mix(mix((seed >>> 0) ^ Math.imul(cellX | 0, 0x9e3779b1)) ^ Math.imul(cellZ | 0, 0x27d4eb2d));
}

export interface FoliageCellRequest {
  cellX: number;
  cellZ: number;
  /** Covers [cellX*cellSize, (cellX+1)*cellSize) on X, likewise Z; origin 0,0. */
  cellSize: number;
  /** Keep a candidate only when its fixed random value r < keepFraction (0..1). */
  keepFraction: number;
  /** Defaults to MAX_FOLIAGE_CELL_INSTANCES. */
  maxInstances?: number;
}

export interface GeneratedFoliageCell {
  count: number;
  /** Exactly count * 16 floats, column-major per instance. */
  matrices: Float32Array;
}

function writeMatrix(matrices: Float32Array, at: number, x: number, y: number, z: number,
  normal: Vec3, align: boolean, yaw: number, scale: number, offset: number): void {
  let [ux, uy, uz]: Vec3 = align ? normal : [0, 1, 0];
  const length = Math.hypot(ux, uy, uz);
  if (length * length < 1e-8) { ux = 0; uy = 1; uz = 0; }
  else { ux = ux / length; uy = uy / length; uz = uz / length; }
  // setFromUnitVectors((0,1,0), up), including three.js's antiparallel branch.
  let ax = uz;
  let ay = 0;
  let az = -ux;
  let aw = uy + 1;
  if (aw < Number.EPSILON) { ax = 0; ay = -uz; az = uy; aw = 0; }
  const inverse = 1 / Math.hypot(ax, ay, az, aw);
  ax *= inverse; ay *= inverse; az *= inverse; aw *= inverse;
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const qx = ax * cy - az * sy;
  const qy = ay * cy + aw * sy;
  const qz = az * cy + ax * sy;
  const qw = aw * cy - ay * sy;
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  matrices[at] = (1 - (yy + zz)) * scale;
  matrices[at + 1] = (xy + wz) * scale;
  matrices[at + 2] = (xz - wy) * scale;
  matrices[at + 3] = 0;
  matrices[at + 4] = (xy - wz) * scale;
  matrices[at + 5] = (1 - (xx + zz)) * scale;
  matrices[at + 6] = (yz + wx) * scale;
  matrices[at + 7] = 0;
  matrices[at + 8] = (xz + wy) * scale;
  matrices[at + 9] = (yz - wx) * scale;
  matrices[at + 10] = (1 - (xx + yy)) * scale;
  matrices[at + 11] = 0;
  matrices[at + 12] = x + ux * offset;
  matrices[at + 13] = y + uy * offset;
  matrices[at + 14] = z + uz * offset;
  matrices[at + 15] = 1;
}

/** Generates stable jittered candidates, consuming six random draws before any rejection. */
export function generateFoliageCell(
  rule: LandscapeFoliageRule,
  type: ForgeFoliageTypeDef,
  surface: FoliageSurface,
  request: FoliageCellRequest,
): GeneratedFoliageCell {
  const { cellX, cellZ, cellSize, keepFraction } = request;
  if (rule.density <= 0 || keepFraction <= 0 || cellSize <= 0) return { count: 0, matrices: new Float32Array(0) };
  const rng = makeFoliageRng(foliageCellSeed(rule.seed, cellX, cellZ));
  const perSide = Math.max(1, Math.round(cellSize * Math.sqrt(rule.density)));
  const step = cellSize / perSide;
  const maxInstances = Math.max(0, Math.floor(request.maxInstances ?? MAX_FOLIAGE_CELL_INSTANCES));
  const matrices = new Float32Array(Math.min(perSide * perSide, maxInstances) * 16);
  let count = 0;
  for (let row = 0; row < perSide && count < maxInstances; row += 1) {
    for (let col = 0; col < perSide && count < maxInstances; col += 1) {
      const jx = rng(), jz = rng(), r = rng(), scaleT = rng(), yawT = rng(), offsetT = rng();
      const x = cellX * cellSize + (col + jx) * step;
      const z = cellZ * cellSize + (row + jz) * step;
      if (r >= keepFraction) continue;
      const weight = surface.layerWeightAt(rule.layerId, x, z);
      if (weight === null || weight + 1e-6 < rule.minWeight) continue;
      const y = surface.heightAt(x, z);
      const n = surface.normalAt(x, z);
      if (y === null || n === null || !passesFoliageFilters(type, { position: [x, y, z], normal: n })) continue;
      const scale = type.scaleMin[0] + (type.scaleMax[0] - type.scaleMin[0]) * scaleT;
      const yaw = type.randomYaw ? yawT * 2 * Math.PI : 0;
      const offset = type.zOffsetMin + (type.zOffsetMax - type.zOffsetMin) * offsetT;
      writeMatrix(matrices, count * 16, x, y, z, n, type.alignToNormal, yaw, scale, offset);
      count += 1;
    }
  }
  return { count, matrices: matrices.slice(0, count * 16) };
}
