/** Incremental X/Z broad phase shared by static blockers and mesh surfaces. */
export interface StaticSpatialEntry<T> {
  readonly value: T;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly bodyOrder: number;
  readonly itemOrder: number;
}

/** Same four-metre cells and 256-cell overflow cap as the original surface index. */
export const STATIC_INDEX_CELL_SIZE = 4;
const CELL_SIZE = STATIC_INDEX_CELL_SIZE;
const MAX_CELLS_PER_ENTRY = 256;

/**
 * The cells an entry with these X/Z bounds is filed under, or null when it goes
 * to the overflow list (non-finite or wider than {@link MAX_CELLS_PER_ENTRY}).
 * Heightfield sources generate entries on demand with the same rule.
 */
export function staticCellRange(
  bounds: Pick<StaticSpatialEntry<unknown>, "minX" | "maxX" | "minZ" | "maxZ">,
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  const minX = Math.floor(bounds.minX / CELL_SIZE);
  const maxX = Math.floor(bounds.maxX / CELL_SIZE);
  const minZ = Math.floor(bounds.minZ / CELL_SIZE);
  const maxZ = Math.floor(bounds.maxZ / CELL_SIZE);
  if (!Number.isFinite(minX + maxX + minZ + maxZ) || (maxX - minX + 1) * (maxZ - minZ + 1) > MAX_CELLS_PER_ENTRY) return null;
  return { minX, maxX, minZ, maxZ };
}

/** The cell holding world X/Z. */
export function staticCellOf(x: number, z: number): { x: number; z: number } {
  return { x: Math.floor(x / CELL_SIZE), z: Math.floor(z / CELL_SIZE) };
}

/** Square-query overlap, inclusive, as `near` filters candidates. */
export function staticEntryOverlapsSquare(
  entry: Pick<StaticSpatialEntry<unknown>, "minX" | "maxX" | "minZ" | "maxZ">,
  x: number,
  z: number,
  radius: number,
): boolean {
  const r = Math.max(0, radius);
  return entry.minX <= x + r && entry.maxX >= x - r && entry.minZ <= z + r && entry.maxZ >= z - r;
}

export class StaticSpatialIndex<T> {
  private readonly cells = new Map<string, Set<StaticSpatialEntry<T>>>();
  private readonly overflow = new Set<StaticSpatialEntry<T>>();
  private readonly keys = new Map<StaticSpatialEntry<T>, string[]>();
  lastCandidateCount = 0;

  get size(): number {
    return this.keys.size;
  }

  add(entry: StaticSpatialEntry<T>): void {
    const keys: string[] = [];
    this.keys.set(entry, keys);
    const range = staticCellRange(entry);
    if (!range) {
      this.overflow.add(entry);
      return;
    }
    for (let z = range.minZ; z <= range.maxZ; z += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        const key = `${x},${z}`;
        let bucket = this.cells.get(key);
        if (!bucket) this.cells.set(key, bucket = new Set());
        bucket.add(entry);
        keys.push(key);
      }
    }
  }

  remove(entry: StaticSpatialEntry<T>): void {
    for (const key of this.keys.get(entry) ?? []) {
      const bucket = this.cells.get(key);
      bucket?.delete(entry);
      if (bucket?.size === 0) this.cells.delete(key);
    }
    this.keys.delete(entry);
    this.overflow.delete(entry);
  }

  clear(): void {
    this.cells.clear();
    this.overflow.clear();
    this.keys.clear();
    this.lastCandidateCount = 0;
  }

  /** Inclusive square overlap, in original body/primitive order, without duplicates. */
  near(x: number, z: number, radius: number): T[] {
    return this.nearEntries(x, z, radius).map((entry) => entry.value);
  }

  /** {@link near} as sorted entries, for merging with on-demand heightfield entries. */
  nearEntries(x: number, z: number, radius: number): StaticSpatialEntry<T>[] {
    const r = Math.max(0, radius);
    const minX = x - r;
    const maxX = x + r;
    const minZ = z - r;
    const maxZ = z + r;
    const candidates = new Set(this.overflow);
    const cellMinX = Math.floor(minX / CELL_SIZE);
    const cellMaxX = Math.floor(maxX / CELL_SIZE);
    const cellMinZ = Math.floor(minZ / CELL_SIZE);
    const cellMaxZ = Math.floor(maxZ / CELL_SIZE);
    // Huge/non-finite queries must not iterate an unbounded grid of empty cells.
    if (!Number.isFinite(cellMinX + cellMaxX + cellMinZ + cellMaxZ) ||
      (cellMaxX - cellMinX + 1) * (cellMaxZ - cellMinZ + 1) > this.cells.size) {
      for (const entry of this.keys.keys()) candidates.add(entry);
    } else {
      for (let cz = cellMinZ; cz <= cellMaxZ; cz += 1) {
        for (let cx = cellMinX; cx <= cellMaxX; cx += 1) {
          for (const entry of this.cells.get(`${cx},${cz}`) ?? []) candidates.add(entry);
        }
      }
    }
    this.lastCandidateCount = candidates.size;
    return [...candidates]
      .filter((entry) => entry.minX <= maxX && entry.maxX >= minX && entry.minZ <= maxZ && entry.maxZ >= minZ)
      .sort(compareStaticEntries);
  }

  /** Preserve the legacy surface query: the whole cell, then oversized triangles. */
  atCell(x: number, z: number): T[] {
    const { cell, overflow } = this.atCellEntries(x, z);
    return cell.concat(overflow).map((entry) => entry.value);
  }

  /** {@link atCell}'s two sorted parts: the cell's entries, then the overflow list. */
  atCellEntries(x: number, z: number): { cell: StaticSpatialEntry<T>[]; overflow: StaticSpatialEntry<T>[] } {
    const bucket = this.cells.get(`${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`);
    return { cell: [...(bucket ?? [])].sort(compareStaticEntries), overflow: [...this.overflow].sort(compareStaticEntries) };
  }
}

/** Original body order, then primitive/triangle order within the body. */
export function compareStaticEntries<T>(a: StaticSpatialEntry<T>, b: StaticSpatialEntry<T>): number {
  return a.bodyOrder - b.bodyOrder || a.itemOrder - b.itemOrder;
}
