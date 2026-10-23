/** Pure allocation policy; the renderer owns texture data and uploads. */
export interface TerrainSlotAcquisition {
  slot: number;
  /** True when the key's data is still in this slot; no upload is needed. */
  cached: boolean;
  evictedKey: string | null;
}

export class TerrainSlotPool {
  private readonly slots = new Map<string, number>();
  /** Insertion order is release order; active slots are never evicted. */
  private readonly released = new Map<string, number>();
  private readonly free: number[];

  constructor(readonly capacity = 80) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error("Terrain slot capacity must be a positive integer");
    this.free = Array.from({ length: capacity }, (_, index) => capacity - index - 1);
  }

  /** Number of slots with resident data, including released cached tiles. */
  get size(): number {
    return this.slots.size;
  }

  has(key: string): boolean {
    return this.slots.has(key);
  }

  slotOf(key: string): number | undefined {
    return this.slots.get(key);
  }

  /** Null when capacity is exhausted and every slot is active. */
  acquire(key: string): TerrainSlotAcquisition | null {
    const cached = this.slots.get(key);
    if (cached !== undefined) {
      this.released.delete(key);
      return { slot: cached, cached: true, evictedKey: null };
    }
    let slot = this.free.pop();
    let evictedKey: string | null = null;
    if (slot === undefined) {
      const oldest = this.released.entries().next();
      if (oldest.done) return null;
      [evictedKey, slot] = oldest.value;
      this.released.delete(evictedKey);
      this.slots.delete(evictedKey);
    }
    this.slots.set(key, slot);
    return { slot, cached: false, evictedKey };
  }

  /** Keeps data cached until pressure evicts the least-recently-released key. */
  release(key: string): void {
    const slot = this.slots.get(key);
    if (slot !== undefined && !this.released.has(key)) this.released.set(key, slot);
  }
}
