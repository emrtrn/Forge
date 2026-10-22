import { decodeTerrainTile } from "@engine/terrain/terrainTileCodec";

import { generateSpikeWorld } from "../terrain-cdlod/worldGen";
import type { TileDecodeError, TileDecodeRequest, TileDecodeResponse } from "./protocol";

/**
 * OPEN_WORLD_PLAN Faz 0 / S6 spike page — throwaway, never merged.
 * Dev:  npm run dev:smoke → http://127.0.0.1:5273/spikes/terrain-worker/index.html
 * Prod: see spikes/README.md (separate build inheriting vite.config.ts).
 *
 * Measures, for real 8-layer tiles from the Faz 1 codec:
 *  1. decode on the main thread (what a worker takes off it);
 *  2. postMessage cost with structured clone vs `transfer` (and that the
 *     transferred buffer is detached, i.e. no copy);
 *  3. worker round trips with 1/2/4 workers: wall time, latency, and the main
 *     thread's own time receiving results.
 */

const out = document.getElementById("out") as HTMLPreElement;
const lines: string[] = [];
function log(line: string): void {
  lines.push(line);
  out.textContent = lines.join("\n");
}

function stats(values: number[]): { avg: number; p95: number; max: number } {
  if (values.length === 0) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: values.reduce((s, v) => s + v, 0) / values.length,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]!,
    max: sorted[sorted.length - 1]!,
  };
}
const f = (value: number, digits = 2): string => value.toFixed(digits);
const fmt = (s: { avg: number; p95: number; max: number }): string =>
  `avg ${f(s.avg)} p95 ${f(s.p95)} max ${f(s.max)} ms`;

function createWorker(): Worker {
  return new Worker(new URL("./terrainWorker.ts", import.meta.url), { type: "module" });
}

/** Sends every tile (transferred copies) across `count` workers; resolves when all return. */
async function roundTrip(
  encoded: Uint8Array[],
  count: number,
): Promise<{ wallMs: number; latency: number[]; receiveMs: number[]; workerDecode: number[]; first: TileDecodeResponse | null }> {
  const workers = Array.from({ length: count }, createWorker);
  // Warm-up: one message per worker so module load is not timed.
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise<void>((resolve) => {
          worker.onmessage = () => resolve();
          const copy = encoded[0]!.slice().buffer;
          worker.postMessage({ id: -1, bytes: copy } satisfies TileDecodeRequest, [copy]);
        }),
    ),
  );
  const copies = encoded.map((bytes) => bytes.slice().buffer);
  const sentAt = new Array<number>(encoded.length).fill(0);
  const latency: number[] = [];
  const receiveMs: number[] = [];
  const workerDecode: number[] = [];
  let first: TileDecodeResponse | null = null;
  const t0 = performance.now();
  await new Promise<void>((resolve, reject) => {
    let remaining = encoded.length;
    for (const worker of workers) {
      worker.onmessage = (event: MessageEvent<TileDecodeResponse | TileDecodeError>) => {
        const r0 = performance.now();
        const data = event.data;
        if ("error" in data) {
          reject(new Error(data.error));
          return;
        }
        latency.push(r0 - sentAt[data.id]!);
        workerDecode.push(data.decodeMs);
        if (data.id === 0) first = data;
        receiveMs.push(performance.now() - r0);
        remaining -= 1;
        if (remaining === 0) resolve();
      };
    }
    copies.forEach((bytes, id) => {
      sentAt[id] = performance.now();
      workers[id % count]!.postMessage({ id, bytes } satisfies TileDecodeRequest, [bytes]);
    });
  });
  const wallMs = performance.now() - t0;
  for (const worker of workers) worker.terminate();
  return { wallMs, latency, receiveMs, workerDecode, first };
}

async function run(): Promise<void> {
  log(`Forge S6 worker spike — ${new Date().toISOString()} (${import.meta.env.PROD ? "production build" : "dev server"})`);
  log(`UA: ${navigator.userAgent}`);
  log(`hardwareConcurrency ${navigator.hardwareConcurrency}`);
  log("Generating 8×8 tiles (8 layers)…");
  const world = await generateSpikeWorld(
    { tiles: 8, tileQuads: 256, spacing: 1, leafQuads: 32, globalStride: 16, seed: 7, layerCount: 8 },
    () => undefined,
  );
  const encoded = world.encoded;
  lines.pop();
  log(`Tiles: ${encoded.length} × ${(encoded[0]!.byteLength / 1048576).toFixed(2)} MB encoded (257², Uint16 height, 2× RGBA8)`);

  // 1. Main-thread decode.
  const mainDecode: number[] = [];
  let reference = decodeTerrainTile(encoded[0]!);
  for (const bytes of encoded) {
    const t0 = performance.now();
    const tile = decodeTerrainTile(bytes);
    mainDecode.push(performance.now() - t0);
    if (tile.x === 0 && tile.z === 0) reference = tile;
  }
  log(`1. main-thread decode per tile: ${fmt(stats(mainDecode))} (${f(mainDecode.reduce((s, v) => s + v, 0), 0)} ms for all)`);

  // 2. postMessage cost: structured clone vs transfer.
  const probe = createWorker();
  const clone: number[] = [];
  const transfer: number[] = [];
  let detached = true;
  for (const bytes of encoded) {
    const a = bytes.slice().buffer;
    const t0 = performance.now();
    probe.postMessage({ id: -2, bytes: a } satisfies TileDecodeRequest);
    clone.push(performance.now() - t0);
    const b = bytes.slice().buffer;
    const t1 = performance.now();
    probe.postMessage({ id: -2, bytes: b } satisfies TileDecodeRequest, [b]);
    transfer.push(performance.now() - t1);
    detached &&= b.byteLength === 0;
  }
  probe.terminate();
  log(`2. postMessage per tile: structured clone ${fmt(stats(clone))}; transfer ${fmt(stats(transfer))}; ` +
    `sender buffer detached after transfer: ${detached ? "yes (no copy)" : "NO"}`);

  // 3. Round trips.
  for (const count of [1, 2, 4]) {
    const result = await roundTrip(encoded, count);
    const firstTile = result.first as TileDecodeResponse | null;
    let identical = Boolean(firstTile) && firstTile!.heights.length === reference.heights.length;
    if (identical && firstTile) {
      for (let i = 0; i < reference.heights.length; i += 1) {
        if (firstTile.heights[i] !== reference.heights[i]) {
          identical = false;
          break;
        }
      }
    }
    log(
      `3. ${count} worker${count > 1 ? "s" : ""}: ${encoded.length} tiles in ${f(result.wallMs, 1)} ms ` +
        `(${f(result.wallMs / encoded.length)} ms/tile); latency ${fmt(stats(result.latency))}; ` +
        `worker decode ${fmt(stats(result.workerDecode))}; main-thread receive ${fmt(stats(result.receiveMs))}; ` +
        `result equals main-thread decode: ${identical ? "yes" : "NO"}`,
    );
  }
  log("done");
  (window as Window & { __s6Done?: boolean }).__s6Done = true;
}

run().catch((error: unknown) => {
  log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  (window as Window & { __s6Done?: boolean }).__s6Done = true;
});
