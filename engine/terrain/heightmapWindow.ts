import { isValidTileQuads, TERRAIN_MAX_TILES_PER_AXIS } from "./terrainTypes";

export interface HeightmapGrid {
  width: number;
  height: number;
  spacing: number;
  /** Source pixel (0,0), rows increasing toward world +Z. */
  origin: readonly [number, number];
}
export interface HeightmapWindow {
  x: number;
  z: number;
  width: number;
  height: number;
  tilesX: number;
  tilesZ: number;
}

/** A tile-aligned crop on the existing sample lattice. No resampling, padding or extrapolation. */
export function heightmapWindowForBounds(
  source: HeightmapGrid,
  bounds: { min: readonly [number, number]; max: readonly [number, number] },
  tileQuads: number,
  margin: number,
): HeightmapWindow {
  if (![source.width, source.height].every(n => Number.isInteger(n) && n >= 2)
    || !Number.isFinite(source.spacing) || source.spacing <= 0
    || !source.origin.every(Number.isFinite) || !Number.isFinite(margin) || margin < 0
    || !isValidTileQuads(tileQuads)) throw new Error("Invalid source grid, margin or tile resolution");
  if (![...bounds.min, ...bounds.max].every(Number.isFinite)
    || bounds.min.some((v, i) => v > bounds.max[i]!)) throw new Error("Invalid crop bounds");
  const tileMetres = tileQuads * source.spacing;
  const start = bounds.min.map((v, i) => Math.floor((v - source.origin[i]! - margin) / tileMetres) * tileQuads);
  const end = bounds.max.map((v, i) => Math.ceil((v - source.origin[i]! + margin) / tileMetres) * tileQuads);
  const x = start[0]!, z = start[1]!;
  const width = end[0]! - x + 1, height = end[1]! - z + 1;
  const tilesX = (width - 1) / tileQuads, tilesZ = (height - 1) / tileQuads;
  if (x < 0 || z < 0 || x + width > source.width || z + height > source.height) {
    throw new Error("Aligned crop leaves the source heightmap; choose a smaller margin/bounds, never invent border heights");
  }
  if (![tilesX, tilesZ].every(n => Number.isInteger(n) && n >= 1 && n <= TERRAIN_MAX_TILES_PER_AXIS)) throw new Error("Crop exceeds terrain tile limits");
  return { x, z, width, height, tilesX, tilesZ };
}

/** Copy u16 source codes exactly, including the shared outer row/column. */
export function cropHeightmapSamples(source: Pick<HeightmapGrid, "width" | "height">, samples: Uint16Array, window: HeightmapWindow): Uint16Array {
  if (![source.width, source.height, window.x, window.z, window.width, window.height].every(Number.isInteger)
    || source.width < 2 || source.height < 2 || samples.length !== source.width * source.height
    || window.x < 0 || window.z < 0 || window.width < 2 || window.height < 2
    || window.x + window.width > source.width || window.z + window.height > source.height) throw new Error("Invalid heightmap crop");
  const result = new Uint16Array(window.width * window.height);
  for (let z = 0; z < window.height; z++) {
    const start = (window.z + z) * source.width + window.x;
    result.set(samples.subarray(start, start + window.width), z * window.width);
  }
  return result;
}
