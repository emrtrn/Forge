/**
 * Procedural foliage ring planning (OPEN_WORLD_PLAN Faz 6 F3): which cells
 * (32 m for grass, larger for far-seen types: {@link foliageRingCellSize}) of a
 * Landscape foliage rule should exist around the camera, and at what density. Pure; the host generates, builds and removes the cells.
 *
 * Density thins with distance in bands. Generation keeps a candidate only when
 * its fixed random value is below the keep fraction, so a cell rebuilt at a
 * lower band shows a subset of the same instances — nothing moves.
 */
import { worldCellKey } from "./worldGrid";

/** Smallest (and grass) ring cell size, metres. */
export const FOLIAGE_RING_CELL_SIZE = 32;
/** Largest ring cell size, metres. */
export const FOLIAGE_RING_MAX_CELL_SIZE = 256;
/** A cell is grown to about a sixth of the type's cull distance... */
const CELL_SIZE_PER_REACH = 1 / 6;
/** ...but never past this many generation candidates (a quarter of the 4096 per-cell instance cap). */
const MAX_CELL_CANDIDATES = 1024;
/** Ring radius cap for a rule whose type never culls (`cullEnd = 0`) on a surface wider than this. */
export const FOLIAGE_RING_MAX_RADIUS = 512;
/** Cells are kept until 1.25× the radius, so a camera on the edge does not churn them. */
export const FOLIAGE_RING_UNLOAD_FACTOR = 1.25;
/** Keep fraction by distance as a fraction of the radius (last band to the edge). */
export const FOLIAGE_RING_BANDS: readonly { readonly upTo: number; readonly keep: number }[] = [
  { upTo: 1 / 3, keep: 1 },
  { upTo: 2 / 3, keep: 0.5 },
  { upTo: Infinity, keep: 0.25 },
];

export interface FoliageRingBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface FoliageRingCell {
  key: string;
  cellX: number;
  cellZ: number;
  keepFraction: number;
}

export interface FoliageRingPlan {
  /** Cells to (re)build, nearest first: new ones and ones whose keep fraction changed. */
  build: FoliageRingCell[];
  /** Built cells to remove: past the unload ring, off the surface, or density zero. */
  unload: string[];
}

/**
 * Ring cell size for a rule, metres: 32 m for grass, doubled while the cell stays
 * under a sixth of the type's cull distance and under {@link MAX_CELL_CANDIDATES}
 * candidates at the rule's density, up to {@link FOLIAGE_RING_MAX_CELL_SIZE}. A tree
 * type seen from 900 m grows in 128 m cells: a 32 m ring of that reach is ~2200
 * batches, more than the per-frame build budget keeps up with on the road.
 *
 * It reads the authored cull distance and density, never the quality scales, so
 * the layout (cell seeds) is the same on every machine. Changing a type's cull
 * distance across a doubling step reshuffles that rule's layout once.
 */
export function foliageRingCellSize(cullEnd: number, density: number): number {
  const byReach = cullEnd > 0 ? cullEnd * CELL_SIZE_PER_REACH : 0;
  const byCount = density > 0 ? Math.sqrt(MAX_CELL_CANDIDATES / density) : Infinity;
  const limit = Math.min(byReach, byCount, FOLIAGE_RING_MAX_CELL_SIZE);
  let size = FOLIAGE_RING_CELL_SIZE;
  while (size * 2 <= limit) size *= 2;
  return size;
}

/**
 * The ring radius for a rule: its type's cull distance × the quality scale, or
 * the whole surface for a type that never culls — capped at
 * {@link FOLIAGE_RING_MAX_RADIUS} when the surface is wider than that (`capped`).
 */
export function foliageRingRadius(cullEnd: number, cullScale: number, bounds: FoliageRingBounds): { radius: number; capped: boolean } {
  if (cullEnd > 0) return { radius: cullEnd * (cullScale > 0 ? cullScale : 1), capped: false };
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  return extent > 2 * FOLIAGE_RING_MAX_RADIUS ? { radius: FOLIAGE_RING_MAX_RADIUS, capped: true } : { radius: Infinity, capped: false };
}

function bandIndex(distance: number, radius: number): number {
  const ratio = radius === Infinity ? 0 : distance / radius;
  return FOLIAGE_RING_BANDS.findIndex((band) => ratio < band.upTo);
}

/**
 * Plans one rule's ring. `built` maps each built cell to the keep fraction it
 * was built with. A built cell changes band only once the camera is a quarter
 * cell past the band edge, so standing on an edge does not rebuild it each frame.
 */
export function planFoliageRing(options: {
  center: readonly [number, number];
  radius: number;
  density: number;
  bounds: FoliageRingBounds;
  built: ReadonlyMap<string, number>;
  cellSize?: number;
}): FoliageRingPlan {
  const { center, radius, bounds, built } = options;
  const size = options.cellSize ?? FOLIAGE_RING_CELL_SIZE;
  const density = Math.min(1, Math.max(0, options.density));
  if (density <= 0 || !(radius > 0)) return { build: [], unload: [...built.keys()] };
  const retainRange = radius * FOLIAGE_RING_UNLOAD_FACTOR;
  const minX = Math.max(bounds.minX, center[0] - retainRange);
  const maxX = Math.min(bounds.maxX, center[0] + retainRange);
  const minZ = Math.max(bounds.minZ, center[1] - retainRange);
  const maxZ = Math.min(bounds.maxZ, center[1] + retainRange);
  const retained = new Set<string>();
  const build: (FoliageRingCell & { distance: number })[] = [];
  if (minX < maxX && minZ < maxZ) {
    const margin = size / 4;
    for (let cellZ = Math.floor(minZ / size); cellZ * size < maxZ; cellZ += 1) {
      for (let cellX = Math.floor(minX / size); cellX * size < maxX; cellX += 1) {
        const dx = Math.max(cellX * size - center[0], 0, center[0] - (cellX + 1) * size);
        const dz = Math.max(cellZ * size - center[1], 0, center[1] - (cellZ + 1) * size);
        const distance = Math.hypot(dx, dz);
        const key = worldCellKey(cellX, cellZ);
        const current = built.get(key);
        if (distance > retainRange || (current === undefined && distance > radius)) continue;
        retained.add(key);
        let band = bandIndex(distance, radius);
        if (current !== undefined) {
          const currentBand = FOLIAGE_RING_BANDS.findIndex((entry) => entry.keep * density === current);
          const near = bandIndex(Math.max(0, distance - margin), radius);
          const far = bandIndex(distance + margin, radius);
          if (currentBand >= near && currentBand <= far) continue;
          band = Math.min(Math.max(band, near), far);
        }
        const keepFraction = FOLIAGE_RING_BANDS[band]!.keep * density;
        if (current === keepFraction) continue;
        build.push({ key, cellX, cellZ, keepFraction, distance });
      }
    }
  }
  build.sort((a, b) => a.distance - b.distance);
  return {
    build: build.map(({ distance: _distance, ...cell }) => cell),
    unload: [...built.keys()].filter((key) => !retained.has(key)),
  };
}

/** Far billboard block size, metres (a whole number of ring cells: every ring cell size divides it). */
export const FOLIAGE_FAR_BLOCK_SIZE = 512;
/** Far blocks are kept until this multiple past the far distance. */
export const FOLIAGE_FAR_UNLOAD_FACTOR = 1.1;

export interface FoliageFarBlock {
  key: string;
  blockX: number;
  blockZ: number;
  /** Nearest distance from the camera to the block, metres. */
  distance: number;
}

/**
 * Plans the far billboard blocks of one rule: every block with ground between
 * `nearRadius` (where the models end) and `farRadius`, nearest first. Blocks
 * that only hold ground inside the near radius are not needed; built blocks
 * stay until past {@link FOLIAGE_FAR_UNLOAD_FACTOR} × `farRadius`, or until the
 * whole block lies inside the near radius.
 */
export function planFarFoliage(options: {
  center: readonly [number, number];
  nearRadius: number;
  farRadius: number;
  bounds: FoliageRingBounds;
  built: ReadonlySet<string>;
  blockSize?: number;
}): { build: FoliageFarBlock[]; unload: string[] } {
  const { center, nearRadius, farRadius, bounds, built } = options;
  const size = options.blockSize ?? FOLIAGE_FAR_BLOCK_SIZE;
  if (!(farRadius > nearRadius) || !(nearRadius >= 0)) return { build: [], unload: [...built] };
  const retain = farRadius * FOLIAGE_FAR_UNLOAD_FACTOR;
  const minX = Math.max(bounds.minX, center[0] - retain), maxX = Math.min(bounds.maxX, center[0] + retain);
  const minZ = Math.max(bounds.minZ, center[1] - retain), maxZ = Math.min(bounds.maxZ, center[1] + retain);
  const kept = new Set<string>();
  const build: FoliageFarBlock[] = [];
  if (minX < maxX && minZ < maxZ) {
    for (let blockZ = Math.floor(minZ / size); blockZ * size < maxZ; blockZ += 1) {
      for (let blockX = Math.floor(minX / size); blockX * size < maxX; blockX += 1) {
        const x0 = blockX * size, z0 = blockZ * size;
        const dx = Math.max(x0 - center[0], 0, center[0] - (x0 + size));
        const dz = Math.max(z0 - center[1], 0, center[1] - (z0 + size));
        const distance = Math.hypot(dx, dz);
        const farX = Math.max(Math.abs(center[0] - x0), Math.abs(center[0] - (x0 + size)));
        const farZ = Math.max(Math.abs(center[1] - z0), Math.abs(center[1] - (z0 + size)));
        const farthest = Math.hypot(farX, farZ);
        const key = worldCellKey(blockX, blockZ);
        if (farthest <= nearRadius) continue;
        if (built.has(key)) {
          if (distance <= retain) kept.add(key);
          continue;
        }
        if (distance > farRadius) continue;
        kept.add(key);
        build.push({ key, blockX, blockZ, distance });
      }
    }
  }
  build.sort((a, b) => a.distance - b.distance);
  return { build, unload: [...built].filter((key) => !kept.has(key)) };
}
