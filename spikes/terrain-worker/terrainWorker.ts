import { decodeTerrainTile } from "@engine/terrain/terrainTileCodec";
import { terrainTileHeightRange } from "@engine/terrain/terrainTypes";

import type { TileDecodeError, TileDecodeRequest, TileDecodeResponse } from "./protocol";

/**
 * S6 tile worker: decodes one encoded tile with the Faz 1 codec, computes its
 * height range and hands the decoded buffers back by transfer (no copy).
 * The project's lib setting is DOM, so the worker scope is typed by hand.
 */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TileDecodeRequest>) => void) | null;
  postMessage(message: TileDecodeResponse | TileDecodeError, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { id, bytes } = event.data;
  try {
    const t0 = performance.now();
    const tile = decodeTerrainTile(bytes);
    const range = terrainTileHeightRange(tile);
    const decodeMs = performance.now() - t0;
    const response: TileDecodeResponse = {
      id,
      x: tile.x,
      z: tile.z,
      size: tile.size,
      layerCount: tile.layerCount,
      heights: tile.heights,
      weights: tile.weights,
      minHeight: range.min,
      maxHeight: range.max,
      decodeMs,
    };
    scope.postMessage(response, [tile.heights.buffer, tile.weights.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
