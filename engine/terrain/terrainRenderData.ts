import type { ForgeLandscapeData, LandscapeSize } from "../scene/landscape";

/**
 * CPU side of the CDLOD terrain renderer (OPEN_WORLD_PLAN Faz 2): the per-vertex
 * arrays the GPU textures are filled from and the per-node height bounds the LOD
 * selector needs. Pure and renderer-free so it is tested without a GL context.
 *
 * All arrays are row-major over a square `size × size` vertex grid, the layout of
 * a tile and of the 1×1 Landscape bridge.
 */

/** Quads per side of one instanced patch; one patch spans a level-0 node. */
export const TERRAIN_PATCH_QUADS = 32;
/** Paint layers the renderer blends (two RGBA8 weight blocks). */
export const TERRAIN_RENDER_LAYERS = 8;
export const TERRAIN_WEIGHT_BLOCKS = TERRAIN_RENDER_LAYERS / 4;

/** Inclusive vertex rectangle (the Landscape editor's dirty bounds). */
export interface TerrainVertexRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * Square power-of-two grids at least one patch wide are drawn by the CDLOD
 * renderer; any other Landscape keeps the legacy chunk mesh.
 */
export function isCdlodRenderableSize(size: LandscapeSize): boolean {
  const quads = size.verticesX - 1;
  return size.verticesX === size.verticesZ && quads >= TERRAIN_PATCH_QUADS
    && Number.isInteger(Math.log2(quads)) && Number.isFinite(size.spacing) && size.spacing > 0
    && Number.isFinite(size.heightScale);
}

export function fullTerrainRect(size: number): TerrainVertexRect {
  return { x0: 0, x1: size - 1, z0: 0, z1: size - 1 };
}

/** Clamps to the grid and grows by `pad` vertices (normals read one neighbour). */
export function clampTerrainRect(rect: TerrainVertexRect, size: number, pad = 0): TerrainVertexRect {
  const clamp = (value: number) => Math.min(size - 1, Math.max(0, Math.floor(value)));
  return { x0: clamp(rect.x0 - pad), x1: clamp(rect.x1 + pad), z0: clamp(rect.z0 - pad), z1: clamp(rect.z1 + pad) };
}

/** World-scaled heights, the values the legacy chunk mesh places its vertices at. */
export function copyLandscapeHeights(data: ForgeLandscapeData, out: Float32Array, rect: TerrainVertexRect): void {
  const size = data.size.verticesX;
  const scale = data.size.heightScale;
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      const index = z * size + x;
      out[index] = (data.heights[index] ?? 0) * scale;
    }
  }
}

/**
 * Normal X/Z per vertex (Y is implied, always up), from the same clamped central
 * differences as the legacy chunk mesh so both renderers light a vertex alike.
 */
export function computeTerrainNormals(
  heights: Float32Array,
  size: number,
  spacing: number,
  out: Float32Array,
  rect: TerrainVertexRect,
): void {
  const at = (x: number, z: number) =>
    heights[Math.min(Math.max(z, 0), size - 1) * size + Math.min(Math.max(x, 0), size - 1)]!;
  const flat = 4 * spacing * spacing;
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      const dx = at(x - 1, z) - at(x + 1, z);
      const dz = at(x, z - 1) - at(x, z + 1);
      const length = Math.sqrt(dx * dx + flat + dz * dz) || 1;
      const index = (z * size + x) * 2;
      out[index] = dx / length;
      out[index + 1] = dz / length;
    }
  }
}

/**
 * Paint weights as RGBA8, block-major: block `b` holds layers `4b..4b+3`, texel
 * `i` of block `b` starts at `(b · size² + i) · 4`. Layers beyond
 * {@link TERRAIN_RENDER_LAYERS} are not drawn (the editor caps layers lower).
 */
export function packTerrainWeights(data: ForgeLandscapeData, out: Uint8Array, rect: TerrainVertexRect): void {
  const size = data.size.verticesX;
  const texels = size * size;
  for (let layer = 0; layer < TERRAIN_RENDER_LAYERS; layer += 1) {
    const weights = data.layers[layer]?.weights;
    const base = Math.floor(layer / 4) * texels * 4 + (layer % 4);
    for (let z = rect.z0; z <= rect.z1; z += 1) {
      for (let x = rect.x0; x <= rect.x1; x += 1) {
        const index = z * size + x;
        const weight = weights?.[index] ?? 0;
        out[base + index * 4] = Math.round(Math.min(1, Math.max(0, weight)) * 255);
      }
    }
  }
}

/**
 * Min/max height of every CDLOD node, level 0 being one patch. Levels above the
 * whole grid (the global roots) report the grid's range.
 */
export class TerrainNodeHeightBounds {
  private readonly levels: { n: number; min: Float32Array; max: Float32Array }[] = [];

  constructor(
    private readonly heights: Float32Array,
    private readonly size: number,
    private readonly patchQuads = TERRAIN_PATCH_QUADS,
  ) {
    let n = Math.max(1, Math.ceil((size - 1) / patchQuads));
    for (;;) {
      this.levels.push({ n, min: new Float32Array(n * n), max: new Float32Array(n * n) });
      if (n === 1) break;
      n = Math.ceil(n / 2);
    }
    this.update(fullTerrainRect(size));
  }

  /** Re-reads the leaves touching `rect`, then re-aggregates every level above. */
  update(rect: TerrainVertexRect): void {
    const leaves = this.levels[0]!;
    const p = this.patchQuads;
    const lx0 = Math.max(0, Math.ceil(rect.x0 / p) - 1);
    const lz0 = Math.max(0, Math.ceil(rect.z0 / p) - 1);
    const lx1 = Math.min(leaves.n - 1, Math.floor(rect.x1 / p));
    const lz1 = Math.min(leaves.n - 1, Math.floor(rect.z1 / p));
    for (let iz = lz0; iz <= lz1; iz += 1) {
      for (let ix = lx0; ix <= lx1; ix += 1) {
        let min = Infinity;
        let max = -Infinity;
        for (let z = iz * p; z <= Math.min((iz + 1) * p, this.size - 1); z += 1) {
          for (let x = ix * p; x <= Math.min((ix + 1) * p, this.size - 1); x += 1) {
            const height = this.heights[z * this.size + x]!;
            if (height < min) min = height;
            if (height > max) max = height;
          }
        }
        leaves.min[iz * leaves.n + ix] = Number.isFinite(min) ? min : 0;
        leaves.max[iz * leaves.n + ix] = Number.isFinite(max) ? max : 0;
      }
    }
    for (let level = 1; level < this.levels.length; level += 1) {
      const below = this.levels[level - 1]!;
      const current = this.levels[level]!;
      for (let iz = 0; iz < current.n; iz += 1) {
        for (let ix = 0; ix < current.n; ix += 1) {
          let min = Infinity;
          let max = -Infinity;
          for (let child = 0; child < 4; child += 1) {
            const cx = ix * 2 + (child & 1);
            const cz = iz * 2 + (child >> 1);
            if (cx >= below.n || cz >= below.n) continue;
            min = Math.min(min, below.min[cz * below.n + cx]!);
            max = Math.max(max, below.max[cz * below.n + cx]!);
          }
          current.min[iz * current.n + ix] = min;
          current.max[iz * current.n + ix] = max;
        }
      }
    }
  }

  node(level: number, ix: number, iz: number): { min: number; max: number } {
    const entry = this.levels[Math.min(level, this.levels.length - 1)]!;
    const index = Math.min(iz, entry.n - 1) * entry.n + Math.min(ix, entry.n - 1);
    return { min: entry.min[index]!, max: entry.max[index]! };
  }

  /** Whole-grid range (the top level's single node). */
  range(): { min: number; max: number } {
    return this.node(this.levels.length - 1, 0, 0);
  }
}
