import { ContentLoadError } from "@engine/assets/contentValidation";
import type { StreamingTerrainTile } from "@engine/terrain/terrainTileStreaming";
import type { WorldTerrainDef } from "@engine/terrain/terrainTypes";
import type { TerrainWorkerResponse } from "@engine/world/workers/terrainWorker";

interface Job {
  key: string;
  bytes: ArrayBuffer;
  signal: AbortSignal;
  resolve(tile: StreamingTerrainTile): void;
  reject(error: unknown): void;
  abort(): void;
}

/** Two decoding lanes share the streaming core's six bounded fetches. */
export class TerrainWorkerPool {
  private readonly lanes: { worker: Worker; job: Job | null }[] = [];
  private readonly queue: Job[] = [];
  private failure: Error | null = null;

  constructor(def: WorldTerrainDef) {
    try {
      for (let index = 0; index < 2; index += 1) {
        const worker = new Worker(new URL("../../../engine/world/workers/terrainWorker.ts", import.meta.url), { type: "module" });
        const lane = { worker, job: null as Job | null };
        this.lanes.push(lane);
        worker.onmessage = ({ data }: MessageEvent<TerrainWorkerResponse>) => {
          if (data.type === "ready") return;
          if (data.type === "error" && data.key === null) {
            this.fail(new Error(data.error.message));
            return;
          }
          const job = lane.job;
          if (!job) return;
          lane.job = null;
          job.signal.removeEventListener("abort", job.abort);
          if (!job.signal.aborted) {
            if (data.type === "decoded") job.resolve(data.payload);
            else job.reject(new ContentLoadError(job.key, data.error.reason, data.error.message));
          }
          this.pump();
        };
        worker.onerror = (event) => this.fail(new Error(event.message || "Terrain worker failed"));
        worker.onmessageerror = () => this.fail(new Error("Terrain worker message could not be decoded"));
        worker.postMessage({ type: "init", def });
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  decode(key: string, bytes: ArrayBuffer, signal: AbortSignal): Promise<StreamingTerrainTile> {
    if (this.failure) return Promise.reject(this.failure);
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
      const job: Job = { key, bytes, signal, resolve, reject, abort: () => {
        const index = this.queue.indexOf(job);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new DOMException("Aborted", "AbortError"));
      } };
      signal.addEventListener("abort", job.abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  dispose(): void { this.fail(new Error("Terrain worker pool disposed")); }

  private pump(): void {
    for (const lane of this.lanes) {
      if (lane.job) continue;
      const job = this.queue.shift();
      if (!job) return;
      lane.job = job;
      try { lane.worker.postMessage({ key: job.key, bytes: job.bytes }, [job.bytes]); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); return; }
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    const jobs = [...this.queue.splice(0)];
    for (const lane of this.lanes) {
      lane.worker.terminate();
      if (lane.job) jobs.push(lane.job);
      lane.job = null;
    }
    for (const job of jobs) {
      job.signal.removeEventListener("abort", job.abort);
      job.reject(error);
    }
  }
}
