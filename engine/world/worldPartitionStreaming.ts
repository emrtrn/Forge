/** Synchronous Actor Script cell residency; lifecycle work belongs to the host. */
import { computeStreamingTargets, type StreamingSource } from "./streamingPolicy";
import { parseWorldCellKey, worldCellBounds, type WorldCellBounds } from "./worldGrid";
import type { WorldPartitionGridSettings } from "./worldPartition";

export interface WorldPartitionSnapshot {
  activeCells: number;
  totalCells: number;
  liveActors: number;
  prefetchedCells: number;
  waitingCells: number;
}

export interface WorldPartitionHooks {
  activate(index: number): void;
  deactivate(index: number): void;
  /** Includes retained pawns/vehicles and excludes actors destroyed by scripts. */
  isLive(index: number): boolean;
  cellChanged?(key: string, active: boolean): void;
  prefetch?(key: string, wanted: boolean): void;
  isReady?(key: string): boolean;
}

export class WorldPartitionStreaming {
  private readonly cells = new Map<string, readonly number[]>();
  private readonly active = new Set<string>();
  private readonly prefetched = new Set<string>();
  private readonly settings: WorldPartitionGridSettings;
  private readonly prefetchRangeFactor: number;
  private waitingCells = 0;
  private bounds: WorldCellBounds | null = null;

  constructor(settings: WorldPartitionGridSettings, cells: ReadonlyMap<string, readonly number[]>, private readonly hooks: WorldPartitionHooks,
    /** `occupiedCells`: cells with host-owned content (statics) and possibly no actor indices. */
    options: { prefetchRangeFactor?: number; occupiedCells?: Iterable<string> } = {}) {
    this.prefetchRangeFactor = options.prefetchRangeFactor ?? 1.5;
    if (!Number.isFinite(this.prefetchRangeFactor) || this.prefetchRangeFactor < 1) {
      throw new RangeError("prefetchRangeFactor must be finite and at least 1");
    }
    // Gameplay residency never inherits a graphics view-distance multiplier.
    this.settings = { cellSize: settings.cellSize, loadRange: settings.loadRange };
    const occupied = new Set(options.occupiedCells ?? []);
    const entries = new Map<string, readonly number[]>(cells);
    for (const key of occupied) if (!entries.has(key)) entries.set(key, []);
    for (const [key, indices] of entries) {
      if (!indices.length && !occupied.has(key)) continue;
      this.cells.set(key, [...indices]);
      const { x, z } = parseWorldCellKey(key)!;
      const box = worldCellBounds(this.settings, x, z);
      this.bounds = this.bounds ? {
        minX: Math.min(this.bounds.minX, box.minX), minZ: Math.min(this.bounds.minZ, box.minZ),
        maxX: Math.max(this.bounds.maxX, box.maxX), maxZ: Math.max(this.bounds.maxZ, box.maxZ),
      } : box;
    }
  }

  /**
   * Host content that registers after configuration (World Terrain road
   * collision builds with the landscapes): its cells join the residency
   * set, and the next prepare/update activates the ones in range.
   */
  addOccupiedCells(keys: Iterable<string>): void {
    for (const key of keys) {
      if (this.cells.has(key)) continue;
      const coord = parseWorldCellKey(key);
      if (!coord) continue;
      this.cells.set(key, []);
      const box = worldCellBounds(this.settings, coord.x, coord.z);
      this.bounds = this.bounds ? {
        minX: Math.min(this.bounds.minX, box.minX), minZ: Math.min(this.bounds.minZ, box.minZ),
        maxX: Math.max(this.bounds.maxX, box.maxX), maxZ: Math.max(this.bounds.maxZ, box.maxZ),
      } : box;
    }
  }

  /** Boot/travel/restore preparation ignores the per-frame activation budget. */
  prepare(position: readonly [number, number]): void {
    this.advance([{ position }], Infinity);
  }

  prefetchAround(position: readonly [number, number]): string[] {
    if (!this.bounds) return [];
    const sources = [{ position }];
    this.prefetch(sources);
    return computeStreamingTargets({ loaded: this.active, active: this.active }, sources,
      { ...this.settings, unloadHysteresisFactor: 1.25 }, this.bounds).toLoad.filter((key) => this.cells.has(key));
  }

  update(sources: readonly StreamingSource[]): void {
    this.advance(sources, 2);
  }

  snapshot(): WorldPartitionSnapshot {
    let liveActors = 0;
    for (const indices of this.cells.values()) {
      for (const index of indices) if (this.hooks.isLive(index)) liveActors += 1;
    }
    return { activeCells: this.active.size, totalCells: this.cells.size, liveActors,
      prefetchedCells: this.prefetched.size, waitingCells: this.waitingCells };
  }

  /** Level teardown owns entity cleanup; discard only residency bookkeeping. */
  clear(): void {
    this.active.clear();
    this.prefetched.clear();
    this.waitingCells = 0;
    this.cells.clear();
    this.bounds = null;
  }

  private advance(sources: readonly StreamingSource[], budget: number): void {
    this.waitingCells = 0;
    if (!this.bounds) return;
    const targets = computeStreamingTargets({ loaded: this.active, active: this.active }, sources,
      { ...this.settings, unloadHysteresisFactor: 1.25 }, this.bounds);
    for (const key of targets.toUnload) {
      for (const index of this.cells.get(key)!) this.hooks.deactivate(index);
      this.active.delete(key);
      this.hooks.cellChanged?.(key, false);
    }
    this.prefetch(sources);
    const toLoad = targets.toLoad.filter((key) => {
      if (!this.cells.has(key)) return false;
      if (this.hooks.isReady?.(key) ?? true) return true;
      this.waitingCells += 1;
      return false;
    }).slice(0, budget);
    for (const key of toLoad) {
      if (this.hooks.prefetch && !this.prefetched.has(key)) {
        this.hooks.prefetch(key, true);
        this.prefetched.add(key);
      }
      for (const index of this.cells.get(key)!) this.hooks.activate(index);
      this.active.add(key);
      this.hooks.cellChanged?.(key, true);
    }
  }

  private prefetch(sources: readonly StreamingSource[]): void {
    if (!this.hooks.prefetch || !this.bounds) return;
    const targets = computeStreamingTargets({ loaded: this.prefetched, active: this.prefetched }, sources,
      { cellSize: this.settings.cellSize, loadRange: this.settings.loadRange * this.prefetchRangeFactor,
        unloadHysteresisFactor: 1.25 }, this.bounds);
    for (const key of targets.toUnload) {
      if (this.active.has(key)) continue;
      this.hooks.prefetch(key, false);
      this.prefetched.delete(key);
    }
    for (const key of targets.toLoad) {
      if (!this.cells.has(key)) continue;
      this.hooks.prefetch(key, true);
      this.prefetched.add(key);
    }
  }
}
