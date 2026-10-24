/**
 * Procedural foliage ring planning (OPEN_WORLD_PLAN Faz 6 F3): which 32 m cells
 * of a Landscape foliage rule should exist around the camera, and at what
 * density. Pure; the host generates, builds and removes the cells.
 *
 * Density thins with distance in bands. Generation keeps a candidate only when
 * its fixed random value is below the keep fraction, so a cell rebuilt at a
 * lower band shows a subset of the same instances — nothing moves.
 */
import { worldCellKey } from "./worldGrid";

export const FOLIAGE_RING_CELL_SIZE = 32;
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
