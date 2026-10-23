/**
 * World Partition grid math (OPEN_WORLD_PLAN K4): world X/Z ↔ cell coordinates,
 * cell bounds and the cells a loading range touches. Pure and unbounded — a
 * grid has no extent of its own; the streaming policy intersects it with the
 * world's bounds. Every runtime grid (`terrain`, `main`, `foliage`, `grass`,
 * `hlod`) is one of these with its own cell size.
 *
 * Cell keys share the terrain tile key format (`"x_z"`, negatives allowed),
 * so a terrain tile and a 256 m cell of a zero-origin grid have the same key.
 */

export interface WorldGridDef {
  /** Cell edge length in world units. */
  cellSize: number;
  /** World X/Z of cell (0, 0)'s min corner. Defaults to the world origin. */
  origin?: readonly [number, number];
}

export interface WorldCellCoord {
  x: number;
  z: number;
}

export interface WorldCellBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function gridOrigin(grid: WorldGridDef): readonly [number, number] {
  return grid.origin ?? [0, 0];
}

export function worldCellKey(x: number, z: number): string {
  return `${x}_${z}`;
}

export function parseWorldCellKey(key: string): WorldCellCoord | null {
  const match = /^(-?\d+)_(-?\d+)$/.exec(key);
  if (!match) return null;
  return { x: Number(match[1]), z: Number(match[2]) };
}

/**
 * The cell containing a world point. A point exactly on a boundary belongs to
 * the cell whose min edge it is, so assignment is deterministic.
 */
export function worldCellAt(grid: WorldGridDef, worldX: number, worldZ: number): WorldCellCoord {
  const [originX, originZ] = gridOrigin(grid);
  return {
    x: Math.floor((worldX - originX) / grid.cellSize),
    z: Math.floor((worldZ - originZ) / grid.cellSize),
  };
}

export function worldCellBounds(grid: WorldGridDef, x: number, z: number): WorldCellBounds {
  const [originX, originZ] = gridOrigin(grid);
  const minX = originX + x * grid.cellSize;
  const minZ = originZ + z * grid.cellSize;
  return { minX, minZ, maxX: minX + grid.cellSize, maxZ: minZ + grid.cellSize };
}

/** Horizontal distance from a point to the nearest point of a cell (0 inside it). */
export function distanceToWorldCell(grid: WorldGridDef, x: number, z: number, worldX: number, worldZ: number): number {
  const bounds = worldCellBounds(grid, x, z);
  const dx = Math.max(bounds.minX - worldX, 0, worldX - bounds.maxX);
  const dz = Math.max(bounds.minZ - worldZ, 0, worldZ - bounds.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * Every cell whose area comes within `radius` of a point — the cells a
 * streaming source with that loading range wants. Ordered nearest first
 * (ties by key) so a caller can feed them straight into a load queue.
 */
export function worldCellsInRadius(grid: WorldGridDef, worldX: number, worldZ: number, radius: number): WorldCellCoord[] {
  if (!(radius >= 0) || !(grid.cellSize > 0)) return [];
  const [originX, originZ] = gridOrigin(grid);
  // Closed intervals: a cell whose edge the range just touches is included,
  // which `worldCellAt`'s min-edge ownership alone would miss.
  // `+ 0` folds the `-0` that `ceil(-0.5)` yields into a plain 0.
  const first = (value: number, origin: number) => Math.ceil((value - origin) / grid.cellSize - 1) + 0;
  const last = (value: number, origin: number) => Math.floor((value - origin) / grid.cellSize);
  const cells: { coord: WorldCellCoord; distance: number }[] = [];
  for (let z = first(worldZ - radius, originZ); z <= last(worldZ + radius, originZ); z += 1) {
    for (let x = first(worldX - radius, originX); x <= last(worldX + radius, originX); x += 1) {
      const distance = distanceToWorldCell(grid, x, z, worldX, worldZ);
      if (distance <= radius) cells.push({ coord: { x, z }, distance });
    }
  }
  cells.sort((a, b) => a.distance - b.distance || a.coord.z - b.coord.z || a.coord.x - b.coord.x);
  return cells.map((entry) => entry.coord);
}

/**
 * Cell for an actor of the given XZ footprint (OPEN_WORLD_PLAN Faz 5): its
 * pivot's cell, or `null` when the footprint is wider than a cell — v1 keeps
 * such actors in the persistent level rather than inventing a coarser grid.
 */
export function worldCellForActor(
  grid: WorldGridDef,
  pivot: readonly [number, number],
  footprint?: { width: number; depth: number },
): WorldCellCoord | null {
  if (footprint && (footprint.width > grid.cellSize || footprint.depth > grid.cellSize)) return null;
  return worldCellAt(grid, pivot[0], pivot[1]);
}
