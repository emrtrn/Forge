import { PlanarReflectionSource, type PlanarReflectionQuality } from "./planarReflectionSource";
import { Plane } from "three";

/** Application-owned leases, shared across River and Lake rebuild lifetimes. */
export class WaterReflectionRegistry {
  private entries = new Map<string, { source: PlanarReflectionSource; leases: number; budget?: string }>();
  /** Existing coplanar sources are free to borrow; only newly allocated sources count against this budget. */
  acquireLimited(group: string, planeY: number, quality: PlanarReflectionQuality, budget: string, limit: number): PlanarReflectionSource | null {
    const key = JSON.stringify([group, 0, 1, 0, -planeY, quality]);
    const existing = this.entries.get(key);
    if (existing) { existing.leases++; return existing.source; }
    if ([...this.entries.values()].filter(entry => entry.budget === budget).length >= limit) return null;
    const source = new PlanarReflectionSource(planeY, quality);
    this.entries.set(key, { source, leases: 1, budget });
    return source;
  }
  acquire(group: string, planeY: number | Plane, quality: PlanarReflectionQuality): PlanarReflectionSource {
    const plane = planeY instanceof Plane ? planeY.clone().normalize() : new Plane().setComponents(0, 1, 0, -planeY);
    const key = JSON.stringify([group, ...plane.normal.toArray(), plane.constant, quality]);
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
