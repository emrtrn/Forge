import { PlanarReflectionSource, type PlanarReflectionQuality } from "./planarReflectionSource";

/** Application-owned leases, shared across River and Lake rebuild lifetimes. */
export class WaterReflectionRegistry {
  private entries = new Map<string, { source: PlanarReflectionSource; leases: number }>();
  acquire(group: string, planeY: number, quality: PlanarReflectionQuality): PlanarReflectionSource {
    const key = `${group}:${planeY}:${quality}`;
    let entry = this.entries.get(key);
    if (!entry) { entry = { source: new PlanarReflectionSource(planeY, quality), leases: 0 }; this.entries.set(key, entry); }
    entry.leases++; return entry.source;
  }
  release(source: PlanarReflectionSource): void {
    for (const [key, entry] of this.entries) if (entry.source === source) {
      if (--entry.leases === 0) { source.dispose(); this.entries.delete(key); } return;
    }
  }
  get size() { return this.entries.size; }
}
