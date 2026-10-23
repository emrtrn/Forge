import type { ForgeLandscapeData, LandscapeSize } from "../scene/landscape";

/**
 * CPU side of the CDLOD terrain renderer (OPEN_WORLD_PLAN Faz 2): the per-vertex
 * arrays the GPU textures are filled from and the per-node height bounds the LOD
 * selector needs. Pure and renderer-free so it is tested without a GL context.
 *
 * The renderer's quadtree needs a square power-of-two grid, but a legacy
 * Landscape may be any `verticesX × verticesZ`. Arrays are therefore laid out
 * over a padded square grid of `stride × stride` vertices (row-major, stride
 * `stride`) whose top-left block is the authored grid at its own indices; the
 * padding repeats the last authored row/column so samples and height bounds past
 * the edge add nothing new. Authored data is never resampled.
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

/** Authored grid size and the padded square it is drawn in. */
export interface TerrainRenderGrid {
  verticesX: number;
  verticesZ: number;
  /** Vertices per side of the padded square: a power of two plus one. */
  stride: number;
}

export function terrainRenderGrid(size: Pick<LandscapeSize, "verticesX" | "verticesZ">): TerrainRenderGrid {
  if (![size.verticesX, size.verticesZ].every((count) => Number.isInteger(count) && count >= 2)) {
    throw new Error(`Terrain grid needs at least 2×2 vertices, got ${size.verticesX}×${size.verticesZ}`);
  }
  const quads = Math.max(size.verticesX, size.verticesZ) - 1;
  const padded = Math.max(TERRAIN_PATCH_QUADS, 2 ** Math.ceil(Math.log2(quads)));
  return { verticesX: size.verticesX, verticesZ: size.verticesZ, stride: padded + 1 };
}

export function fullTerrainRect(grid: Pick<TerrainRenderGrid, "verticesX" | "verticesZ">): TerrainVertexRect {
  return { x0: 0, x1: grid.verticesX - 1, z0: 0, z1: grid.verticesZ - 1 };
}

/** Clamps to the authored grid and grows by `pad` vertices (normals read one neighbour). */
export function clampTerrainRect(
  rect: TerrainVertexRect,
  grid: Pick<TerrainRenderGrid, "verticesX" | "verticesZ">,
  pad = 0,
): TerrainVertexRect {
  const clamp = (value: number, size: number) => Math.min(size - 1, Math.max(0, Math.floor(value)));
  return {
    x0: clamp(rect.x0 - pad, grid.verticesX),
    x1: clamp(rect.x1 + pad, grid.verticesX),
    z0: clamp(rect.z0 - pad, grid.verticesZ),
    z1: clamp(rect.z1 + pad, grid.verticesZ),
  };
}

/** Repeats the last authored column/row into the padding a rect on that edge touches. */
function padEdges(out: Float32Array, grid: TerrainRenderGrid, rect: TerrainVertexRect): void {
  const { verticesX, verticesZ, stride } = grid;
  if (rect.x1 === verticesX - 1) {
    for (let z = rect.z0; z <= rect.z1; z += 1) {
      out.fill(out[z * stride + verticesX - 1]!, z * stride + verticesX, (z + 1) * stride);
    }
  }
  if (rect.z1 === verticesZ - 1) {
    const x1 = rect.x1 === verticesX - 1 ? stride - 1 : rect.x1;
    const last = (verticesZ - 1) * stride;
    for (let z = verticesZ; z < stride; z += 1) out.copyWithin(z * stride + rect.x0, last + rect.x0, last + x1 + 1);
  }
}

/** World-scaled heights, the values the Landscape collider places its vertices at. */
export function copyLandscapeHeights(
  data: ForgeLandscapeData,
  grid: TerrainRenderGrid,
  out: Float32Array,
  rect: TerrainVertexRect,
): void {
  const scale = data.size.heightScale;
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      out[z * grid.stride + x] = (data.heights[z * grid.verticesX + x] ?? 0) * scale;
    }
  }
  padEdges(out, grid, rect);
}

/**
 * Normal X/Z per vertex (Y is implied, always up) from clamped central
 * differences — at the authored edge the padding repeats the edge, which is the
 * same clamp the original chunk mesh used.
 */
export function computeTerrainNormals(
  heights: Float32Array,
  stride: number,
  spacing: number,
  out: Float32Array,
  rect: TerrainVertexRect,
): void {
  const at = (x: number, z: number) =>
    heights[Math.min(Math.max(z, 0), stride - 1) * stride + Math.min(Math.max(x, 0), stride - 1)]!;
  const flat = 4 * spacing * spacing;
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      const dx = at(x - 1, z) - at(x + 1, z);
      const dz = at(x, z - 1) - at(x, z + 1);
      const length = Math.sqrt(dx * dx + flat + dz * dz) || 1;
      const index = (z * stride + x) * 2;
      out[index] = dx / length;
      out[index + 1] = dz / length;
    }
  }
}

/**
 * Paint weights as RGBA8, block-major: block `b` holds layers `4b..4b+3`, texel
 * `i` of block `b` starts at `(b · stride² + i) · 4`. Layers beyond
 * {@link TERRAIN_RENDER_LAYERS} are not drawn (the editor caps layers lower).
 */
export function packTerrainWeights(
  data: ForgeLandscapeData,
  grid: TerrainRenderGrid,
  out: Uint8Array,
  rect: TerrainVertexRect,
): void {
  const texels = grid.stride * grid.stride;
  for (let layer = 0; layer < TERRAIN_RENDER_LAYERS; layer += 1) {
    const weights = data.layers[layer]?.weights;
    const base = Math.floor(layer / 4) * texels * 4 + (layer % 4);
    for (let z = rect.z0; z <= rect.z1; z += 1) {
      for (let x = rect.x0; x <= rect.x1; x += 1) {
        const weight = weights?.[z * grid.verticesX + x] ?? 0;
        out[base + (z * grid.stride + x) * 4] = Math.round(Math.min(1, Math.max(0, weight)) * 255);
      }
    }
  }
}

/**
 * Min/max height of every CDLOD node over a square grid, level 0 being one
 * patch. Levels above the whole grid (the global roots) report its range.
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
    this.update({ x0: 0, x1: size - 1, z0: 0, z1: size - 1 });
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
