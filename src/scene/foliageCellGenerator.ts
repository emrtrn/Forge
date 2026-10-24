import type { TerrainQueryDef } from "@engine/terrain/terrainHeightQuery";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";
import type { ForgeFoliageTypeDef, LandscapeFoliageRule } from "@engine/scene/foliage";
import {
  FoliageTerrainStore, type FoliageCellRequest, type GeneratedFoliageCell,
} from "@engine/scene/proceduralFoliage";
import type { FoliageWorkerRequest, FoliageWorkerResponse } from "@engine/world/workers/foliageWorker";

/** A terrain the generator knows by id: its query definition (incl. layer ids). */
export type FoliageGeneratorTerrainDef = TerrainQueryDef & { layers: readonly { id: string }[] };

/** One cell generated from the terrain's resident tiles. */
export interface FoliageCellJob {
  terrainId: string;
  rule: LandscapeFoliageRule;
  type: ForgeFoliageTypeDef;
  request: FoliageCellRequest;
}

/** Runs generateFoliageCell over tiles copied in once and kept until replaced or removed. */
export interface FoliageCellGenerator {
  /** Registers (or replaces) a terrain's definition; clears that terrain's tiles. */
  setTerrain(terrainId: string, def: FoliageGeneratorTerrainDef): void;
  /** Copies a tile in; the caller's arrays are not transferred or kept. */
  setTile(terrainId: string, tile: TerrainTileData): void;
  removeTile(terrainId: string, x: number, z: number): void;
  removeTerrain(terrainId: string): void;
  /** Rejects when the terrain is unknown or the generator was disposed. */
  generate(job: FoliageCellJob): Promise<GeneratedFoliageCell>;
  dispose(): void;
}

const DISPOSED_MESSAGE = "Foliage cell generator disposed";

/** Same thread: for tests, and when Worker is unavailable or failed. */
export class LocalFoliageCellGenerator implements FoliageCellGenerator {
  private readonly store = new FoliageTerrainStore();
  private disposed = false;

  setTerrain(terrainId: string, def: FoliageGeneratorTerrainDef): void {
    if (!this.disposed) this.store.setTerrain(terrainId, def);
  }

  setTile(terrainId: string, tile: TerrainTileData): void {
    if (!this.disposed) this.store.setTile(terrainId, tile);
  }

  removeTile(terrainId: string, x: number, z: number): void {
    if (!this.disposed) this.store.removeTile(terrainId, x, z);
  }

  removeTerrain(terrainId: string): void {
    if (!this.disposed) this.store.removeTerrain(terrainId);
  }

  async generate(job: FoliageCellJob): Promise<GeneratedFoliageCell> {
    if (this.disposed) throw new Error(DISPOSED_MESSAGE);
    return this.store.generate(job.terrainId, job.rule, job.type, job.request);
  }

  dispose(): void {
    this.disposed = true;
    this.store.clear();
  }
}

interface PendingJob {
  job: FoliageCellJob;
  resolve(result: GeneratedFoliageCell): void;
  reject(error: unknown): void;
}

/** One ordered worker, with mirrored local state and transparent fallback after a failure. */
export class WorkerFoliageCellGenerator implements FoliageCellGenerator {
  private readonly local = new LocalFoliageCellGenerator();
  private readonly pending = new Map<number, PendingJob>();
  private worker: Worker | null = null;
  private nextId = 0;
  private disposed = false;
  private warned = false;

  constructor() {
    try {
      const worker = new Worker(new URL("../../engine/world/workers/foliageWorker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = ({ data }: MessageEvent<FoliageWorkerResponse>) => {
        if (this.worker !== worker || this.disposed) return;
        if (data.type === "error" && data.id === null) {
          this.fallback(new Error(data.message));
          return;
        }
        if (data.id === null) return;
        const pending = this.pending.get(data.id);
        if (!pending) return;
        this.pending.delete(data.id);
        if (data.type === "generated") pending.resolve({ count: data.count, matrices: data.matrices });
        else pending.reject(new Error(data.message));
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        this.fallback(new Error(event.message || "Foliage worker failed"));
      };
      worker.onmessageerror = () => this.fallback(new Error("Foliage worker message could not be decoded"));
    } catch (error) { this.fallback(error); }
  }

  setTerrain(terrainId: string, def: FoliageGeneratorTerrainDef): void {
    if (this.disposed) return;
    this.local.setTerrain(terrainId, def);
    this.post({ type: "terrain", terrainId, def });
  }

  setTile(terrainId: string, tile: TerrainTileData): void {
    if (this.disposed) return;
    this.local.setTile(terrainId, tile);
    if (!this.worker) return;
    const copy = { ...tile, heights: tile.heights.slice(), weights: tile.weights.slice() };
    this.post({ type: "tile", terrainId, tile: copy }, [copy.heights.buffer, copy.weights.buffer]);
  }

  removeTile(terrainId: string, x: number, z: number): void {
    if (this.disposed) return;
    this.local.removeTile(terrainId, x, z);
    this.post({ type: "removeTile", terrainId, x, z });
  }

  removeTerrain(terrainId: string): void {
    if (this.disposed) return;
    this.local.removeTerrain(terrainId);
    this.post({ type: "removeTerrain", terrainId });
  }

  generate(job: FoliageCellJob): Promise<GeneratedFoliageCell> {
    if (this.disposed) return Promise.reject(new Error(DISPOSED_MESSAGE));
    if (!this.worker) return this.local.generate(job);
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { job, resolve, reject });
      this.post({ type: "generate", id, job });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWorker();
    this.local.dispose();
    for (const pending of this.pending.values()) pending.reject(new Error(DISPOSED_MESSAGE));
    this.pending.clear();
  }

  private post(message: FoliageWorkerRequest, transfer: ArrayBuffer[] = []): void {
    try { this.worker?.postMessage(message, transfer); }
    catch (error) { this.fallback(error); }
  }

  private stopWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }

  private fallback(error: unknown): void {
    if (this.disposed) return;
    this.stopWorker();
    if (!this.warned) {
      this.warned = true;
      console.warn("Foliage worker failed; using local foliage generation", error);
    }
    for (const [id, pending] of this.pending) {
      this.local.generate(pending.job).then((result) => {
        if (this.pending.delete(id)) pending.resolve(result);
      }, (failure: unknown) => {
        if (this.pending.delete(id)) pending.reject(failure);
      });
    }
  }
}

/** Uses one worker when available, otherwise the same-thread generator. */
export function createFoliageCellGenerator(): FoliageCellGenerator {
  return typeof Worker !== "undefined" ? new WorkerFoliageCellGenerator() : new LocalFoliageCellGenerator();
}
