/**
 * Play-side streaming of painted foliage cells (OPEN_WORLD_PLAN Faz 6 F2).
 *
 * A partitioned level's foliage sidecar is an index; each listed
 * `<Level>.cells/foliage/<x_z>.foliage.json` is fetched when the camera's
 * prefetch ring (1.5× the foliage load range) reaches it, built into one batch
 * per group when the load range does, and unloaded past the 1.25× hysteresis
 * ring. Foliage has no runtime identity (no script state, no messages), so —
 * unlike `main` cells — its files are read on demand. A cell that fails to load
 * counts as ready and empty, with a warning, so it never blocks the ring.
 */
import type { FoliageRenderBinding, FoliageRenderResolver } from "@engine/render-three/foliage";
import type { LayoutFoliageData, LayoutFoliageGroup } from "@engine/scene/foliage";
import type { FoliageCellDocument } from "@engine/world/foliageCells";
import type { WorldPartitionGridSettings } from "@engine/world/worldPartition";
import { WorldPartitionStreaming } from "@engine/world/worldPartitionStreaming";

export interface FoliageCellStreamingOptions {
  /** Index sidecar: groups (type, target) and the listed `foliageCells`. */
  index: LayoutFoliageData;
  /** The level's foliage grid, its load range already scaled for view distance. */
  grid: WorldPartitionGridSettings;
  binding: FoliageRenderBinding;
  resolver: FoliageRenderResolver;
  fetchCell(key: string): Promise<FoliageCellDocument>;
  debug?: boolean;
}

export interface FoliageCellStreamingSnapshot {
  activeCells: number;
  totalCells: number;
  fetchedCells: number;
  instances: number;
}

type CellState = { status: "fetching"; settled: Promise<void> } | { status: "ready"; cell: FoliageCellDocument | null };

export class FoliageCellStreaming {
  private readonly stream: WorldPartitionStreaming;
  private readonly cells = new Map<string, CellState>();
  private readonly groups: Map<string, LayoutFoliageGroup>;
  private readonly liveInstances = new Map<string, number>();
  private disposed = false;

  constructor(private readonly options: FoliageCellStreamingOptions) {
    this.groups = new Map(options.index.groups.map((group) => [group.id, group]));
    this.stream = new WorldPartitionStreaming(options.grid, new Map(), {
      activate: () => {},
      deactivate: () => {},
      isLive: () => false,
      prefetch: (key, wanted) => (wanted ? this.fetch(key) : this.drop(key)),
      isReady: (key) => this.cells.get(key)?.status === "ready",
      cellChanged: (key, active) => (active ? this.build(key) : this.unload(key)),
    }, { occupiedCells: options.index.foliageCells ?? [] });
  }

  /**
   * Behind the loading overlay: fetches the cells in range of `position` (world
   * X/Z) and builds them all at once, without the per-frame budget.
   */
  async prepare(position: readonly [number, number]): Promise<void> {
    const keys = this.stream.prefetchAround(position);
    await Promise.all(keys.map((key) => this.whenFetched(key)));
    if (!this.disposed) this.stream.prepare(position);
  }

  /** Per frame: at most two cells activate (the streaming core's budget). */
  update(position: readonly [number, number]): void {
    this.stream.update([{ position }]);
  }

  snapshot(): FoliageCellStreamingSnapshot {
    let instances = 0;
    for (const count of this.liveInstances.values()) instances += count;
    let fetched = 0;
    for (const state of this.cells.values()) if (state.status === "ready") fetched += 1;
    return {
      activeCells: this.liveInstances.size,
      totalCells: this.options.index.foliageCells?.length ?? 0,
      fetchedCells: fetched,
      instances,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const key of [...this.liveInstances.keys()]) this.options.binding.removeCell(key);
    this.liveInstances.clear();
    this.cells.clear();
    this.stream.clear();
  }

  private fetch(key: string): void {
    if (this.cells.has(key)) return;
    const state: CellState = {
      status: "fetching",
      settled: this.options.fetchCell(key).then(
        (cell) => this.settle(key, state, cell),
        (error: unknown) => {
          console.warn(error instanceof Error ? error.message : String(error));
          this.settle(key, state, null);
        },
      ),
    };
    this.cells.set(key, state);
  }

  private settle(key: string, state: CellState, cell: FoliageCellDocument | null): void {
    // Dropped (left the prefetch ring) or torn down while in flight: discard.
    if (this.disposed || this.cells.get(key) !== state) return;
    this.cells.set(key, { status: "ready", cell });
  }

  private async whenFetched(key: string): Promise<void> {
    const state = this.cells.get(key);
    if (state?.status === "fetching") await state.settled;
  }

  private drop(key: string): void {
    if (!this.liveInstances.has(key)) this.cells.delete(key);
  }

  private build(key: string): void {
    const state = this.cells.get(key);
    const cell = state?.status === "ready" ? state.cell : null;
    const groups: LayoutFoliageGroup[] = [];
    for (const entry of cell?.groups ?? []) {
      const group = this.groups.get(entry.id);
      if (group) groups.push({ ...group, instances: entry.instances });
    }
    const built = this.options.binding.addCell(key, groups, this.options.resolver, this.options.grid.cellSize);
    this.liveInstances.set(key, built);
    if (this.options.debug) console.info(`[foliage-cells] activated ${key} (${built} instances)`);
  }

  private unload(key: string): void {
    this.options.binding.removeCell(key);
    this.liveInstances.delete(key);
    if (this.options.debug) console.info(`[foliage-cells] unloaded ${key}`);
  }
}
