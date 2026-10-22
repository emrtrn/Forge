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
const CELL_SIZE = 4;
const MAX_CELLS_PER_ENTRY = 256;

export class StaticSpatialIndex<T> {
  private readonly cells = new Map<string, Set<StaticSpatialEntry<T>>>();
  private readonly overflow = new Set<StaticSpatialEntry<T>>();
  private readonly keys = new Map<StaticSpatialEntry<T>, string[]>();
  lastCandidateCount = 0;

  get size(): number {
    return this.keys.size;
  }

  add(entry: StaticSpatialEntry<T>): void {
    const minX = Math.floor(entry.minX / CELL_SIZE);
    const maxX = Math.floor(entry.maxX / CELL_SIZE);
    const minZ = Math.floor(entry.minZ / CELL_SIZE);
    const maxZ = Math.floor(entry.maxZ / CELL_SIZE);
    const keys: string[] = [];
    this.keys.set(entry, keys);
    if (!Number.isFinite(minX + maxX + minZ + maxZ) ||
      (maxX - minX + 1) * (maxZ - minZ + 1) > MAX_CELLS_PER_ENTRY) {
      this.overflow.add(entry);
      return;
    }
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
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
      .sort(compareEntries)
      .map((entry) => entry.value);
  }

  /** Preserve the legacy surface query: the whole cell, then oversized triangles. */
  atCell(x: number, z: number): T[] {
    const bucket = this.cells.get(`${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`);
    return [...(bucket ?? [])].sort(compareEntries).concat([...this.overflow].sort(compareEntries))
      .map((entry) => entry.value);
  }
}

function compareEntries<T>(a: StaticSpatialEntry<T>, b: StaticSpatialEntry<T>): number {
  return a.bodyOrder - b.bodyOrder || a.itemOrder - b.itemOrder;
}
