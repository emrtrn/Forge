import type { RecastTileWorker } from "@engine/navigation/recastPlanner";
import type { RecastTileConfig, RecastTileInput } from "@engine/navigation/recastTileBuild";
import type { RecastTileWorkerResponse } from "@engine/navigation/workers/recastTileWorker";

interface Job {
  readonly id: number;
  readonly config: RecastTileConfig;
  readonly input: RecastTileInput;
  resolve(bytes: Uint8Array | null): void;
  reject(error: unknown): void;
}

/**
 * Recast tile builds on worker lanes (OPEN_WORLD_PLAN Faz 9, R3b). Each lane
 * loads its own wasm; a lane takes one job at a time. Any lane failure fails
 * the whole pool — every queued and running job rejects — and the planner
 * falls back to building on the main thread.
 */
export class RecastTileWorkerPool implements RecastTileWorker {
  readonly lanes: number;
  private readonly workers: { worker: Worker; job: Job | null }[] = [];
  private readonly queue: Job[] = [];
  private nextId = 1;
  private failure: Error | null = null;

  constructor(lanes = defaultLanes()) {
    this.lanes = lanes;
    try {
      for (let index = 0; index < lanes; index += 1) {
        const worker = new Worker(new URL("../../../engine/navigation/workers/recastTileWorker.ts", import.meta.url), { type: "module" });
        const lane = { worker, job: null as Job | null };
        this.workers.push(lane);
        worker.onmessage = ({ data }: MessageEvent<RecastTileWorkerResponse>) => {
          if (data.type === "ready") return;
          if (data.type === "error" && data.id === null) {
            this.fail(new Error(`Recast worker: ${data.message}`));
            return;
          }
          const job = lane.job;
          if (!job || job.id !== data.id) return;
          lane.job = null;
          if (data.type === "built") job.resolve(data.bytes);
          else job.reject(new Error(`Recast worker: ${data.message}`));
          this.pump();
        };
        worker.onerror = (event) => this.fail(new Error(event.message || "Recast worker failed"));
        worker.onmessageerror = () => this.fail(new Error("Recast worker message could not be decoded"));
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  build(config: RecastTileConfig, input: RecastTileInput): Promise<Uint8Array | null> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, config, input, resolve, reject });
      this.pump();
    });
  }

  dispose(): void {
    this.fail(new Error("Recast worker pool disposed"));
  }

  private pump(): void {
    for (const lane of this.workers) {
      if (lane.job) continue;
      const job = this.queue.shift();
      if (!job) return;
      lane.job = job;
      try {
        // The gathered triangle buffer is used once: hand it over without a copy.
        lane.worker.postMessage({ id: job.id, config: job.config, input: job.input }, [job.input.positions.buffer as ArrayBuffer]);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const lane of this.workers) {
      lane.worker.terminate();
      lane.job?.reject(error);
      lane.job = null;
    }
    for (const job of this.queue.splice(0)) job.reject(error);
  }
}

/** Two lanes when the machine has the cores for them, never more than half of them. */
function defaultLanes(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(2, Math.floor(cores / 2)));
}
