import { validateDecodedTerrainTile } from "./terrainLoader";
import { decodeTerrainTile } from "./terrainTileCodec";
import { terrainTileHeightRange, tileKey, type WorldTerrainDef } from "./terrainTypes";

export interface StreamingTerrainTile {
  /** Metres relative to the definition's origin Y, as in the eager loader. */
  heights: Float32Array;
  /** One vertex-major RGBA8 array per group of four layers. */
  weights: Uint8Array[];
  minHeight: number;
  maxHeight: number;
  transfer: ArrayBuffer[];
}

/** Pure worker-ready decode; transfer buffers are unique and owned by the result. */
export function decodeTerrainTileForStreaming(bytes: ArrayBuffer | Uint8Array, def: WorldTerrainDef): StreamingTerrainTile {
  const tile = decodeTerrainTile(bytes);
  validateDecodedTerrainTile(def, tileKey(tile.x, tile.z), tile);
  const { min: minHeight, max: maxHeight } = terrainTileHeightRange(tile);
  const blockBytes = tile.size * tile.size * 4;
  const weights: Uint8Array[] = [];
  for (let offset = 0; offset < tile.weights.length; offset += blockBytes) {
    weights.push(tile.weights.subarray(offset, offset + blockBytes));
  }
  // The codec allocates both arrays; weight blocks share one buffer.
  const transfer = [tile.heights.buffer as ArrayBuffer];
  if (weights.length > 0) transfer.push(tile.weights.buffer as ArrayBuffer);
  return { heights: tile.heights, weights, minHeight, maxHeight, transfer };
}
