/** Synchronous Actor Script cell residency; lifecycle work belongs to the host. */
import { computeStreamingTargets, type StreamingSource } from "./streamingPolicy";
import { parseWorldCellKey, worldCellBounds, type WorldCellBounds } from "./worldGrid";
import type { WorldPartitionGridSettings } from "./worldPartition";

export interface WorldPartitionSnapshot {
  activeCells: number;
  totalCells: number;
  liveActors: number;
}

export interface WorldPartitionHooks {
  activate(index: number): void;
  deactivate(index: number): void;
  /** Includes retained pawns/vehicles and excludes actors destroyed by scripts. */
  isLive(index: number): boolean;
  cellChanged?(key: string, active: boolean): void;
}

export class WorldPartitionStreaming {
  private readonly cells = new Map<string, readonly number[]>();
  private readonly active = new Set<string>();
  private readonly settings: WorldPartitionGridSettings;
  private bounds: WorldCellBounds | null = null;

  constructor(settings: WorldPartitionGridSettings, cells: ReadonlyMap<string, readonly number[]>, private readonly hooks: WorldPartitionHooks) {
    // Gameplay residency never inherits a graphics view-distance multiplier.
    this.settings = { cellSize: settings.cellSize, loadRange: settings.loadRange };
    for (const [key, indices] of cells) {
      if (!indices.length) continue;
      this.cells.set(key, [...indices]);
      const { x, z } = parseWorldCellKey(key)!;
      const box = worldCellBounds(this.settings, x, z);
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

  update(sources: readonly StreamingSource[]): void {
    this.advance(sources, 2);
  }

  snapshot(): WorldPartitionSnapshot {
    let liveActors = 0;
    for (const indices of this.cells.values()) {
      for (const index of indices) if (this.hooks.isLive(index)) liveActors += 1;
    }
    return { activeCells: this.active.size, totalCells: this.cells.size, liveActors };
  }

  /** Level teardown owns entity cleanup; discard only residency bookkeeping. */
  clear(): void {
    this.active.clear();
    this.cells.clear();
    this.bounds = null;
  }

  private advance(sources: readonly StreamingSource[], budget: number): void {
    if (!this.bounds) return;
    const targets = computeStreamingTargets({ loaded: this.active, active: this.active }, sources,
      { ...this.settings, unloadHysteresisFactor: 1.25 }, this.bounds);
    for (const key of targets.toUnload) {
      for (const index of this.cells.get(key)!) this.hooks.deactivate(index);
      this.active.delete(key);
      this.hooks.cellChanged?.(key, false);
    }
    const toLoad = targets.toLoad.filter((key) => this.cells.has(key)).slice(0, budget);
    for (const key of toLoad) {
      for (const index of this.cells.get(key)!) this.hooks.activate(index);
      this.active.add(key);
      this.hooks.cellChanged?.(key, true);
    }
  }
}
