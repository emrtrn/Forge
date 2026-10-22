/**
 * Message shapes between the S6 spike page and its tile worker — the spike of
 * `engine/world/workers/terrainWorker.ts` (OPEN_WORLD_PLAN K4: decode, Float32
 * expansion and min/max off the main thread, buffers moved with `transfer`).
 */

export interface TileDecodeRequest {
  id: number;
  /** One encoded `x_z.tile.bin`; transferred, so detached on the sender. */
  bytes: ArrayBuffer;
}

export interface TileDecodeResponse {
  id: number;
  x: number;
  z: number;
  size: number;
  layerCount: number;
  /** Transferred back; owned by the receiver. */
  heights: Float32Array;
  weights: Uint8Array;
  minHeight: number;
  maxHeight: number;
  /** Decode time measured inside the worker. */
  decodeMs: number;
}

export interface TileDecodeError {
  id: number;
  error: string;
}
