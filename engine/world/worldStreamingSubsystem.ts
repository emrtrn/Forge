import { ContentLoadError } from "../assets/contentValidation";
import { computeStreamingTargets, type GridStreamingSettings, type StreamingSource } from "./streamingPolicy";
import type { WorldCellBounds } from "./worldGrid";

export type WorldCellState = "Unloaded" | "Fetching" | "Loaded" | "Activated" | "Deactivating";

export interface WorldCellLoader<T> {
  fetch(key: string, signal: AbortSignal): Promise<T>;
  byteSize(data: T): number;
  activate(key: string, data: T): void;
  deactivate(key: string, data: T): void;
  dispose(key: string, data: T): void;
  fallback?(key: string, error: unknown): T | null;
}

export interface WorldStreamingOptions<T> {
  settings: GridStreamingSettings;
  bounds: WorldCellBounds;
  loader: WorldCellLoader<T>;
  clock: () => number;
  maxConcurrentFetches?: number;
  activationBudgetMs?: number;
  /** Budget for Loaded (inactive) payloads; active data is pinned. Default: 64 MiB. */
  memoryBudgetBytes?: number;
  warn?: (message: string) => void;
}

export interface WorldStreamingStats {
  counts: Record<WorldCellState, number>;
  /** Last update's fetches waiting for a slot plus cells waiting for activation. */
  queued: number;
  inFlight: number;
  bytesResident: number;
  lastFrameMs: number;
  evictions: number;
  failures: number;
}

type Cell<T> =
  | { state: "Fetching"; controller: AbortController; lastNeeded: number }
  | { state: "Unloaded"; lastNeeded: number }
  | { state: "Loaded" | "Activated" | "Deactivating"; data: T; bytes: number; lastNeeded: number; failed: boolean };

interface AreaWaiter {
  position: readonly [number, number];
  radius: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

function nonnegative(value: number, name: string): number {
  if (!(value >= 0)) throw new RangeError(`${name} must be nonnegative`);
  return value;
}

/**
 * One bounded grid, with IO and synchronous resource ownership injected.
 * Hooks must not throw. Activation is atomic: an item may overrun the time
 * slice, but no further activation starts after the clock reaches the budget.
 * Out-of-range inactive payloads remain cached until the byte budget needs them.
 */
export class WorldStreamingSubsystem<T> {
  private readonly cells = new Map<string, Cell<T>>();
  private readonly warned = new Set<string>();
  private readonly waiters = new Set<AreaWaiter>();
  private readonly maxConcurrentFetches: number;
  private readonly activationBudgetMs: number;
  private readonly memoryBudgetBytes: number;
  private readonly totalCells: number;
  private frame = 0;
  private queued = 0;
  private lastFrameMs = 0;
  private evictions = 0;
  private failures = 0;
  private disposed = false;

  constructor(private readonly options: WorldStreamingOptions<T>) {
    computeStreamingTargets({ loaded: new Set(), active: new Set() }, [], options.settings, options.bounds);
    this.maxConcurrentFetches = options.maxConcurrentFetches ?? 6;
    if (!Number.isInteger(this.maxConcurrentFetches) || this.maxConcurrentFetches < 1) {
      throw new RangeError("maxConcurrentFetches must be a positive integer");
    }
    this.activationBudgetMs = nonnegative(options.activationBudgetMs ?? 4, "activationBudgetMs");
    this.memoryBudgetBytes = nonnegative(options.memoryBudgetBytes ?? 64 * 1024 * 1024, "memoryBudgetBytes");
    const { cellSize, origin = [0, 0] } = options.settings;
    const { minX, minZ, maxX, maxZ } = options.bounds;
    this.totalCells = (Math.ceil((maxX - origin[0]) / cellSize) - Math.floor((minX - origin[0]) / cellSize))
      * (Math.ceil((maxZ - origin[1]) / cellSize) - Math.floor((minZ - origin[1]) / cellSize));
  }

  update(sources: readonly StreamingSource[], frameBudgetMs = this.activationBudgetMs): void {
    if (this.disposed) throw new Error("World streaming subsystem is disposed");
    nonnegative(frameBudgetMs, "frameBudgetMs");
    const { settings, bounds, loader, clock } = this.options;
    const started = clock();
    const loaded = new Set<string>();
    const active = new Set<string>();
    for (const [key, cell] of this.cells) {
      if (cell.state === "Loaded" || cell.state === "Activated") loaded.add(key);
      if (cell.state === "Activated") active.add(key);
    }
    const targets = computeStreamingTargets({ loaded, active }, sources, settings, bounds);
    // Pending and failed cells use the same retention envelope as completed data.
    const retained = computeStreamingTargets({ loaded: new Set(this.cells.keys()), active }, sources, settings, bounds);
    const needed = computeStreamingTargets({ loaded: new Set(), active: new Set() }, sources, settings, bounds).toLoad;
    this.frame += 1;
    for (const key of needed) {
      const cell = this.cells.get(key);
      if (cell) cell.lastNeeded = this.frame;
    }
    for (const key of retained.toUnload) {
      const cell = this.cells.get(key)!;
      if (cell.state === "Fetching" || cell.state === "Unloaded") {
        this.cells.delete(key);
        if (cell.state === "Fetching") cell.controller.abort();
      }
    }
    for (const key of targets.toDeactivate) {
      const cell = this.cells.get(key);
      if (cell?.state !== "Activated") continue;
      cell.state = "Deactivating";
      loader.deactivate(key, cell.data);
      cell.state = "Loaded";
    }
    let inFlight = this.stats().inFlight;
    for (const key of targets.toLoad) {
      if (inFlight >= this.maxConcurrentFetches) break;
      if (this.cells.has(key)) continue;
      this.startFetch(key);
      inFlight += 1;
    }
    const activationStarted = clock();
    for (const key of targets.toActivate) {
      if (clock() - activationStarted >= frameBudgetMs) break;
      const cell = this.cells.get(key);
      if (cell?.state !== "Loaded") continue;
      loader.activate(key, cell.data);
      cell.state = "Activated";
    }
    this.evictInactive();
    this.queued = needed.filter((key) => !this.cells.has(key)).length
      + targets.toActivate.filter((key) => this.cells.get(key)?.state === "Loaded").length;
    for (const waiter of this.waiters) {
      if (!this.isAreaReady(waiter.position, waiter.radius)) continue;
      this.waiters.delete(waiter);
      waiter.resolve();
    }
    this.lastFrameMs = Math.max(0, clock() - started);
  }

  isAreaReady(position: readonly [number, number], radius: number): boolean {
    if (this.disposed) return false;
    const { settings, bounds } = this.options;
    const keys = computeStreamingTargets({ loaded: new Set(), active: new Set() }, [{ position }], {
      ...settings, loadRange: radius, activateRange: radius, viewDistanceMultiplier: 1,
    }, bounds).toLoad;
    return keys.every((key) => this.cells.get(key)?.state === "Activated");
  }

  /** Does not add a source. Even an already-ready area resolves on a later update. */
  waitForArea(position: readonly [number, number], radius: number): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("World streaming subsystem is disposed"));
    this.isAreaReady(position, radius); // Validate before registering a waiter.
    return new Promise((resolve, reject) => {
      this.waiters.add({ position: [position[0], position[1]], radius, resolve, reject });
    });
  }

  /**
   * Visits every tracked cell; an untracked cell is Unloaded. `failed` marks a
   * fallback payload, or a failed fetch that left no payload at all.
   */
  forEachCell(visit: (key: string, state: WorldCellState, failed: boolean) => void): void {
    for (const [key, cell] of this.cells) {
      visit(key, cell.state, cell.state === "Unloaded" || ("failed" in cell && cell.failed));
    }
  }

  stats(): WorldStreamingStats {
    const counts: Record<WorldCellState, number> = {
      Unloaded: this.totalCells, Fetching: 0, Loaded: 0, Activated: 0, Deactivating: 0,
    };
    let bytesResident = 0;
    for (const cell of this.cells.values()) {
      if (cell.state === "Unloaded") continue;
      counts.Unloaded -= 1;
      counts[cell.state] += 1;
      if ("data" in cell) bytesResident += cell.bytes;
    }
    return {
      counts, queued: this.queued, inFlight: counts.Fetching, bytesResident,
      lastFrameMs: this.lastFrameMs, evictions: this.evictions, failures: this.failures,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, cell] of this.cells) {
      this.cells.delete(key);
      if (cell.state === "Fetching") cell.controller.abort();
      if (!("data" in cell)) continue;
      if (cell.state === "Activated") {
        cell.state = "Deactivating";
        this.options.loader.deactivate(key, cell.data);
      }
      this.options.loader.dispose(key, cell.data);
    }
    this.queued = 0;
    this.warned.clear();
    for (const waiter of this.waiters) waiter.reject(new Error("World streaming subsystem is disposed"));
    this.waiters.clear();
  }

  private startFetch(key: string): void {
    const cell: Cell<T> = { state: "Fetching", controller: new AbortController(), lastNeeded: this.frame };
    this.cells.set(key, cell);
    const { loader } = this.options;
    const current = () => !this.disposed && this.cells.get(key) === cell;
    const store = (data: T, failed = false): void => {
      const bytes = loader.byteSize(data);
      if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError("Cell byte size must be finite and nonnegative");
      this.cells.set(key, { state: "Loaded", data, bytes, lastNeeded: cell.lastNeeded, failed });
    };
    const run = async (): Promise<void> => {
      try {
        const data = await loader.fetch(key, cell.controller.signal);
        if (!current()) {
          loader.dispose(key, data);
          return;
        }
        try { store(data); } catch (error) { loader.dispose(key, data); throw error; }
      } catch (error) {
        if (!current()) return;
        this.failures += 1;
        this.cells.set(key, { state: "Unloaded", lastNeeded: cell.lastNeeded });
        let usingFallback = false;
        try {
          const data = loader.fallback?.(key, error);
          if (data !== null && data !== undefined) {
            try { store(data, true); usingFallback = true; } catch (cause) { loader.dispose(key, data); throw cause; }
          }
        } catch {
          // A broken fallback is failed until the cell leaves the retention range too.
        }
        if (!this.warned.has(key)) {
          this.warned.add(key);
          const reason = error instanceof ContentLoadError ? error.reason : "invalid-data";
          const detail = error instanceof Error ? error.message : String(error);
          this.options.warn?.(`[world] ${key} (${reason}); ${usingFallback ? "using fallback" : "cell unavailable"}. ${detail}`);
        }
      }
    };
    void run();
  }

  private evictInactive(): void {
    const inactive = [...this.cells].filter((entry): entry is [string, Extract<Cell<T>, { data: T }>] =>
      entry[1].state === "Loaded");
    let bytes = inactive.reduce((sum, [, cell]) => sum + cell.bytes, 0);
    inactive.sort((a, b) => a[1].lastNeeded - b[1].lastNeeded || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [key, cell] of inactive) {
      if (bytes <= this.memoryBudgetBytes) break;
      this.cells.delete(key);
      if (cell.failed) this.cells.set(key, { state: "Unloaded", lastNeeded: cell.lastNeeded });
      bytes -= cell.bytes;
      this.evictions += 1;
      this.options.loader.dispose(key, cell.data);
    }
  }
}
