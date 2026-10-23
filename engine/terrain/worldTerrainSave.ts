import type { TerrainEditWorld } from "./terrainEdit";
import { encodeTerrainTile, type TerrainHeightFormat } from "./terrainTileCodec";
import type { WorldTerrainDef } from "./terrainTypes";

export interface WorldTerrainTileWrite {
  key: string;
  bytes: Uint8Array;
}

export interface WorldTerrainSaveSnapshot {
  /** Definition to commit after every tile in `tiles` is written. */
  def: WorldTerrainDef;
  tiles: WorldTerrainTileWrite[];
  /** The height range grew, so every tile header changed and every tile is in `tiles`. */
  widened: boolean;
}

/**
 * Captures a multi-tile World Terrain save (OPEN_WORLD_PLAN Faz 2 sculpt/paint):
 * only `dirtyKeys` are encoded, each in the height format it was loaded with
 * (default `f32`). Summaries come from the edit world, which refreshes them per
 * dab. If an edit left the definition's `heightMin..heightMax` encoding range,
 * the range grows to whole metres with one metre of headroom and every tile is
 * re-encoded, since tile headers must match the definition's range.
 */
export function captureWorldTerrainSave(
  world: TerrainEditWorld,
  dirtyKeys: Iterable<string>,
  formats: ReadonlyMap<string, TerrainHeightFormat>,
): WorldTerrainSaveSnapshot {
  const def = structuredClone(world.def);
  let low = Infinity;
  let high = -Infinity;
  for (const summary of def.tiles) {
    low = Math.min(low, summary.minHeight);
    high = Math.max(high, summary.maxHeight);
  }
  const widened = low < def.heightMin || high > def.heightMax;
  if (widened) {
    def.heightMin = Math.min(def.heightMin, Math.floor(low) - 1);
    def.heightMax = Math.max(def.heightMax, Math.ceil(high) + 1);
  }
  const listed = new Set(def.tiles.map((entry) => entry.key));
  const keys = widened ? [...listed] : [...new Set(dirtyKeys)].filter((key) => listed.has(key));
  const tiles = keys.sort().map((key) => {
    const tile = world.tiles.get(key);
    if (!tile) throw new Error(`World Terrain tile ${key} is not loaded; cannot save it`);
    return {
      key,
      bytes: encodeTerrainTile(tile, { heightMin: def.heightMin, heightMax: def.heightMax, heightFormat: formats.get(key) ?? "f32" }),
    };
  });
  return { def, tiles, widened };
}
