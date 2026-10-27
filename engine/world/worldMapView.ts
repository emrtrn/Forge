/**
 * World Partition panel math (OPEN_WORLD_PLAN Faz 8): the square world area
 * the editor's minimap shows, world X/Z ↔ map pixels (X right, +Z down, the
 * global map's row order), a hill-shaded image of a terrain global map, and
 * the camera pose that brings a clicked point into view. Pure, no DOM.
 */

export interface WorldMapRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * The square area covering every rect (terrain extent, occupied cells, the
 * camera), centred, with `padding` of its side added around. A world with
 * nothing to show gets a 256 m square around the origin.
 */
export function worldMapFrame(rects: readonly WorldMapRect[], padding = 0.04): WorldMapRect {
  const finite = rects.filter((rect) => [rect.minX, rect.minZ, rect.maxX, rect.maxZ].every(Number.isFinite));
  if (finite.length === 0) return { minX: -128, minZ: -128, maxX: 128, maxZ: 128 };
  const minX = Math.min(...finite.map((rect) => rect.minX));
  const minZ = Math.min(...finite.map((rect) => rect.minZ));
  const maxX = Math.max(...finite.map((rect) => rect.maxX));
  const maxZ = Math.max(...finite.map((rect) => rect.maxZ));
  const side = Math.max(maxX - minX, maxZ - minZ, 1) * (1 + 2 * padding);
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  return { minX: centreX - side / 2, minZ: centreZ - side / 2, maxX: centreX + side / 2, maxZ: centreZ + side / 2 };
}

/** World X/Z → pixel in a `size`² map of `frame`. */
export function worldToMapPixel(frame: WorldMapRect, size: number, x: number, z: number): [number, number] {
  return [((x - frame.minX) / (frame.maxX - frame.minX)) * size, ((z - frame.minZ) / (frame.maxZ - frame.minZ)) * size];
}

/** Pixel in a `size`² map of `frame` → world X/Z. */
export function mapPixelToWorld(frame: WorldMapRect, size: number, px: number, py: number): [number, number] {
  return [frame.minX + (px / size) * (frame.maxX - frame.minX), frame.minZ + (py / size) * (frame.maxZ - frame.minZ)];
}

export interface WorldMapHeights {
  width: number;
  height: number;
  /** Row-major world Y; NaN where no tile covers the sample (holes, never loaded). */
  heights: Float32Array;
}

const LOW = [52, 84, 58] as const;
const HIGH = [214, 210, 196] as const;

/**
 * RGBA pixels (one per sample) of a terrain height map: low-to-high colour
 * ramp over the map's own range, hill-shaded from the north-west with
 * `metresPerSample` as the horizontal scale. NaN samples are transparent.
 */
export function shadeWorldMapHeights(map: WorldMapHeights, metresPerSample: number): Uint8ClampedArray {
  const { width, height, heights } = map;
  const out = new Uint8ClampedArray(width * height * 4);
  let min = Infinity;
  let max = -Infinity;
  for (const value of heights) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min > max) return out;
  const range = Math.max(max - min, 1e-6);
  const at = (x: number, z: number, fallback: number): number => {
    const value = heights[Math.max(0, Math.min(height - 1, z)) * width + Math.max(0, Math.min(width - 1, x))]!;
    return Number.isFinite(value) ? value : fallback;
  };
  // Light from the north-west (−X, −Z) and above.
  const light = [-0.5, 0.7071, -0.5] as const;
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = z * width + x;
      const value = heights[index]!;
      if (!Number.isFinite(value)) continue;
      const dx = (at(x + 1, z, value) - at(x - 1, z, value)) / (2 * metresPerSample);
      const dz = (at(x, z + 1, value) - at(x, z - 1, value)) / (2 * metresPerSample);
      const length = Math.hypot(dx, 1, dz);
      const lit = (-dx * light[0] + light[1] - dz * light[2]) / length;
      const shade = 0.55 + 0.45 * Math.max(-1, Math.min(1, lit));
      const t = (value - min) / range;
      const o = index * 4;
      for (let channel = 0; channel < 3; channel += 1) out[o + channel] = (LOW[channel]! + (HIGH[channel]! - LOW[channel]!) * t) * shade;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Nearest sample's world Y of a height map covering `rect`, or null outside it or on a hole. */
export function worldMapHeightAt(map: WorldMapHeights, rect: WorldMapRect, x: number, z: number): number | null {
  if (x < rect.minX || x > rect.maxX || z < rect.minZ || z > rect.maxZ) return null;
  const sx = Math.round(((x - rect.minX) / (rect.maxX - rect.minX)) * (map.width - 1));
  const sz = Math.round(((z - rect.minZ) / (rect.maxZ - rect.minZ)) * (map.height - 1));
  const value = map.heights[sz * map.width + sx]!;
  return Number.isFinite(value) ? value : null;
}

/** Steepest look-down the camera keeps when it is aimed near the horizon. */
const FOCUS_MIN_PITCH = Math.PI / 6;
const FOCUS_HORIZON_DISTANCE = 80;

/**
 * Where the editor camera goes to look at `target` (world X/Y/Z) along its
 * current view direction from the same height above the ground. A camera
 * looking near the horizon (or up) is pulled back 80 m at 30° instead. The
 * caller aims the camera at `target`.
 */
export function worldMapFocusPosition(
  camera: readonly [number, number, number],
  forward: readonly [number, number, number],
  target: readonly [number, number, number],
): [number, number, number] {
  const horizontal = Math.hypot(forward[0], forward[2]);
  const dirX = horizontal > 1e-6 ? forward[0] / horizontal : 0;
  const dirZ = horizontal > 1e-6 ? forward[2] / horizontal : -1;
  const pitch = Math.atan2(-forward[1], horizontal);
  if (pitch < FOCUS_MIN_PITCH) {
    const back = FOCUS_HORIZON_DISTANCE * Math.cos(FOCUS_MIN_PITCH);
    return [target[0] - dirX * back, target[1] + FOCUS_HORIZON_DISTANCE * Math.sin(FOCUS_MIN_PITCH), target[2] - dirZ * back];
  }
  const above = Math.max(2, camera[1] - target[1]);
  const back = above / Math.tan(pitch);
  return [target[0] - dirX * back, target[1] + above, target[2] - dirZ * back];
}
