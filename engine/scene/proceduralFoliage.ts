/** Deterministic, render-agnostic foliage generation over resident ground surfaces. */
import {
  terrainHeightAt, terrainSmoothNormalAt, terrainLayerWeightsAt, TerrainTileMap,
  type TerrainQueryDef, type TerrainTileLookup,
} from "../terrain/terrainHeightQuery";
import type { TerrainTileData } from "../terrain/terrainTypes";
import { terrainMaskAt } from "../terrain/terrainMask";
import {
  landscapeFoliageRuleBands, landscapeFoliageRuleIsUnbanded,
  type ForgeFoliageTypeDef, type LandscapeFoliageRule,
} from "./foliage";
import { makeFoliageRng, passesFoliageFilters, surfaceSlopeDegrees } from "./foliagePaint";
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

/** The global map shape a far surface reads (`TerrainGlobalAttributes` without the render import). */
export interface FoliageGlobalMap {
  map: { width: number; height: number; stride: number; heights: Float32Array };
  /** Per sample: normal X, normal Z, hole flag. */
  normals: Float32Array;
  /** RGBA8 blocks of `width × height` texels, block-major (layer `b*4+c`). */
  weights: Uint8Array;
}

/**
 * A surface over the terrain's global map (one sample per `stride` vertices,
 * always resident), preferring the exact resident tiles where they exist. Far
 * foliage grows on it: away from the camera the tiles are streamed out, near
 * it the plants match the exact ring. `exact` reports whether every query so
 * far was answered from tiles.
 */
export function globalFoliageSurface(
  def: TerrainQueryDef & { layers: readonly { id: string }[] },
  global: FoliageGlobalMap,
  tiles: TerrainTileLookup,
): FoliageSurface & { exact: boolean } {
  const exactSurface = worldTerrainFoliageSurface(def, tiles);
  const { width, height, stride, heights } = global.map;
  const step = stride * def.spacing;
  const texels = width * height;
  const sample = (x: number, z: number): { i: number; fx: number; fz: number } | null => {
    const gx = (x - def.origin[0]) / step, gz = (z - def.origin[2]) / step;
    if (!(gx >= 0 && gz >= 0 && gx <= width - 1 && gz <= height - 1)) return null;
    const ix = Math.min(Math.floor(gx), width - 2), iz = Math.min(Math.floor(gz), height - 2);
    return { i: iz * width + ix, fx: gx - ix, fz: gz - iz };
  };
  const bilinear = (read: (i: number) => number, at: { i: number; fx: number; fz: number }): number | null => {
    const a = read(at.i), b = read(at.i + 1), c = read(at.i + width), d = read(at.i + width + 1);
    if (![a, b, c, d].every(Number.isFinite)) return null;
    return (a + (b - a) * at.fx) * (1 - at.fz) + (c + (d - c) * at.fx) * at.fz;
  };
  const surface: FoliageSurface & { exact: boolean } = {
    exact: true,
    heightAt: (x, z) => {
      const exact = exactSurface.heightAt(x, z);
      if (exact !== null) return exact;
      surface.exact = false;
      const at = sample(x, z);
      const local = at ? bilinear((i) => heights[i]!, at) : null;
      return local === null ? null : def.origin[1] + local;
    },
    normalAt: (x, z) => {
      const exact = exactSurface.normalAt(x, z);
      if (exact !== null) return exact;
      surface.exact = false;
      const at = sample(x, z);
      if (!at) return null;
      const nx = bilinear((i) => global.normals[i * 3]!, at), nz = bilinear((i) => global.normals[i * 3 + 1]!, at);
      if (nx === null || nz === null) return null;
      return [nx, Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz)), nz];
    },
    layerWeightAt: (layerId, x, z) => {
      const exact = exactSurface.layerWeightAt(layerId, x, z);
      if (exact !== null) return exact;
      const layer = def.layers.findIndex((entry) => entry.id === layerId);
      if (layer < 0) return null;
      surface.exact = false;
      const at = sample(x, z);
      if (!at) return null;
      const base = Math.floor(layer / 4) * texels * 4, channel = layer % 4;
      const weight = bilinear((i) => global.weights[base + i * 4 + channel]! / 255, at);
      return weight;
    },
    bounds: exactSurface.bounds,
  };
  return surface;
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

/** Copied terrain state shared by worker and same-thread foliage generators. */
export class FoliageTerrainStore {
  private readonly terrains = new Map<string, {
    def: TerrainQueryDef & { layers: readonly { id: string }[] };
    tiles: TerrainTileMap;
  }>();

  setTerrain(terrainId: string, def: TerrainQueryDef & { layers: readonly { id: string }[] }): void {
    this.terrains.set(terrainId, { def: {
      ...def, origin: [...def.origin], layers: def.layers.map((layer) => ({ id: layer.id })),
    }, tiles: new TerrainTileMap() });
  }

  setTile(terrainId: string, tile: TerrainTileData): void {
    const terrain = this.terrains.get(terrainId);
    if (!terrain) throw new Error(`Unknown foliage terrain: ${terrainId}`);
    terrain.tiles.set({ ...tile, heights: tile.heights.slice(), weights: tile.weights.slice() });
  }

  removeTile(terrainId: string, x: number, z: number): void {
    this.terrains.get(terrainId)?.tiles.delete(x, z);
  }

  removeTerrain(terrainId: string): void { this.terrains.delete(terrainId); }

  generate(terrainId: string, rule: LandscapeFoliageRule, type: ForgeFoliageTypeDef,
    request: FoliageCellRequest): GeneratedFoliageCell {
    const terrain = this.terrains.get(terrainId);
    if (!terrain) throw new Error(`Unknown foliage terrain: ${terrainId}`);
    return generateFoliageCell(rule, type, worldTerrainFoliageSurface(terrain.def, terrain.tiles), request);
  }

  clear(): void { this.terrains.clear(); }
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

/**
 * Generates stable jittered candidates, consuming six random draws before any rejection.
 * The rule's height/slope/noise bands give each candidate a 0..1 mask; it stays only
 * while its fixed `r < keepFraction × mask`, so a narrower band or a lower mask only
 * removes plants and never moves the others. `edgeScale` shrinks a plant toward the
 * band edge (`scale × lerp(edgeScale, 1, mask)`).
 */
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
  const bands = landscapeFoliageRuleIsUnbanded(rule) ? null : landscapeFoliageRuleBands(rule);
  const noiseSeed = rule.seed | 0;
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
      let edge = 1;
      if (bands) {
        const mask = terrainMaskAt(bands, y, surfaceSlopeDegrees(n), x, z, noiseSeed);
        if (r >= keepFraction * mask) continue;
        edge = bands.edgeScale + (1 - bands.edgeScale) * mask;
      }
      const scale = (type.scaleMin[0] + (type.scaleMax[0] - type.scaleMin[0]) * scaleT) * edge;
      const yaw = type.randomYaw ? yawT * 2 * Math.PI : 0;
      const offset = type.zOffsetMin + (type.zOffsetMax - type.zOffsetMin) * offsetT;
      writeMatrix(matrices, count * 16, x, y, z, n, type.alignToNormal, yaw, scale, offset);
      count += 1;
    }
  }
  return { count, matrices: matrices.slice(0, count * 16) };
}

export interface FoliageBlockRequest {
  /** Block grid coordinates; a block covers `cellsPerSide²` ring cells. */
  blockX: number;
  blockZ: number;
  /** The rule's ring cell size: the block is generated cell by cell, so a plant sits where the ring puts it. */
  cellSize: number;
  cellsPerSide: number;
  keepFraction: number;
}

/**
 * The ring cells of one block generated and packed together (far billboards draw
 * a block as one batch). Same seeds and cells as the ring, so at the hand-off a
 * billboard stands exactly where its model stood.
 */
export function generateFoliageBlock(
  rule: LandscapeFoliageRule,
  type: ForgeFoliageTypeDef,
  surface: FoliageSurface,
  request: FoliageBlockRequest,
): GeneratedFoliageCell {
  const { blockX, blockZ, cellSize, cellsPerSide, keepFraction } = request;
  const parts: GeneratedFoliageCell[] = [];
  let count = 0;
  for (let z = 0; z < cellsPerSide; z += 1) {
    for (let x = 0; x < cellsPerSide; x += 1) {
      const cell = generateFoliageCell(rule, type, surface, {
        cellX: blockX * cellsPerSide + x, cellZ: blockZ * cellsPerSide + z, cellSize, keepFraction,
      });
      if (cell.count === 0) continue;
      parts.push(cell);
      count += cell.count;
    }
  }
  const matrices = new Float32Array(count * 16);
  let at = 0;
  for (const part of parts) { matrices.set(part.matrices, at); at += part.matrices.length; }
  return { count, matrices };
}

export interface FoliageFarTintSource {
  rule: LandscapeFoliageRule;
  type: ForgeFoliageTypeDef;
  /** The plants' mean colour, linear RGB 0..1. */
  color: readonly [number, number, number];
  /** Ground one plant's crown covers at scale 1, m². */
  footprint: number;
}

/** Seen low and from far, crowns hide far more ground than they cover from above. */
const FAR_TINT_OVERLAP = 4;

export interface FoliageFarTintMap {
  /** Per global map sample, 0..1: how much ground the plants hide. */
  coverage: Float32Array;
  /** The plants' colour, coverage-weighted over the map (linear RGB). */
  color: [number, number, number];
}

/**
 * Far foliage tint over a terrain's global map: per sample, how much ground
 * the rules' plants hide — `farTint × (1 − e^(−4 · density · footprint · scale²))`
 * where the rule's layer, bands and the type's own limits hold, rules combined
 * as layers over each other — and their mean colour. Null when no rule's type
 * has a far tint.
 */
export function foliageFarTintMap(
  def: TerrainQueryDef & { layers: readonly { id: string }[] },
  global: FoliageGlobalMap,
  sources: readonly FoliageFarTintSource[],
): FoliageFarTintMap | null {
  const active = sources
    .map((source) => ({
      ...source,
      layer: def.layers.findIndex((layer) => layer.id === source.rule.layerId),
      strength: Math.min(1, Math.max(0, source.type.farTint ?? 0)),
      bands: landscapeFoliageRuleIsUnbanded(source.rule) ? null : landscapeFoliageRuleBands(source.rule),
      scale: (source.type.scaleMin[0] + source.type.scaleMax[0]) / 2,
    }))
    .filter((source) => source.strength > 0 && source.layer >= 0);
  if (active.length === 0) return null;
  const { width, height, stride, heights } = global.map;
  const step = stride * def.spacing;
  const texels = width * height;
  const coverage = new Float32Array(texels);
  let r = 0, g = 0, b = 0, sum = 0;
  for (let iz = 0; iz < height; iz += 1) {
    for (let ix = 0; ix < width; ix += 1) {
      const i = iz * width + ix;
      const local = heights[i]!;
      if (!Number.isFinite(local)) continue;
      const x = def.origin[0] + ix * step, z = def.origin[2] + iz * step, y = def.origin[1] + local;
      const nx = global.normals[i * 3]!, nz = global.normals[i * 3 + 1]!;
      const normal: Vec3 = [nx, Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz)), nz];
      const slope = surfaceSlopeDegrees(normal);
      let clear = 1;
      for (const source of active) {
        const weight = global.weights[(Math.floor(source.layer / 4) * texels + i) * 4 + source.layer % 4]! / 255;
        if (weight + 1e-6 < source.rule.minWeight) continue;
        if (!passesFoliageFilters(source.type, { position: [x, y, z], normal })) continue;
        const mask = source.bands ? terrainMaskAt(source.bands, y, slope, x, z, source.rule.seed | 0) : 1;
        const cover = 1 - Math.exp(-FAR_TINT_OVERLAP * source.rule.density * source.footprint * source.scale * source.scale);
        const alpha = source.strength * cover * mask;
        if (!(alpha > 0)) continue;
        clear *= 1 - alpha;
        r += source.color[0] * alpha; g += source.color[1] * alpha; b += source.color[2] * alpha; sum += alpha;
      }
      coverage[i] = 1 - clear;
    }
  }
  const first = active[0]!.color;
  return { coverage, color: sum > 0 ? [r / sum, g / sum, b / sum] : [first[0], first[1], first[2]] };
}
