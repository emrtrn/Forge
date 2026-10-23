import type { TerrainEditWorld } from "./terrainEdit";
import { encodeTerrainGlobalMap } from "./terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource, type TerrainGlobalAttributes } from "./terrainRenderSource";
import { decodeTerrainTile, encodeTerrainTile, type TerrainHeightFormat } from "./terrainTileCodec";
import { tileKey, type WorldTerrainDef } from "./terrainTypes";

export interface WorldTerrainTileWrite {
  key: string;
  bytes: Uint8Array;
}

export interface WorldTerrainSaveSnapshot {
  /** Definition to commit after the tiles and global map are written. */
  def: WorldTerrainDef;
  tiles: WorldTerrainTileWrite[];
  global: Uint8Array;
  /**
   * The height range grew, so every tile header changed: resident tiles are
   * in `tiles`, the rest are listed in `reencode`.
   */
  widened: boolean;
  /**
   * Listed tiles that are not resident (editor streaming) but must be
   * rewritten because the range widened. They were never edited, so the copy
   * on disk is current: re-encode it with {@link reencodeTerrainTileRange}.
   */
  reencode: string[];
}

/**
 * Captures a multi-tile World Terrain save (OPEN_WORLD_PLAN Faz 2 sculpt/paint):
 * only `dirtyKeys` are encoded, each in the height format it was loaded with
 * (default `f32`). Summaries come from the edit world, which refreshes them per
 * dab. If an edit left the definition's `heightMin..heightMax` encoding range,
 * the range grows to whole metres with one metre of headroom and every tile is
 * re-encoded, since tile headers must match the definition's range.
 *
 * The global map is rebuilt from the edit world when every listed tile is
 * resident. A streaming editor holds only part of the world, so it passes the
 * live `globalAttributes` the renderer keeps updated per dab instead.
 */
export function captureWorldTerrainSave(
  world: TerrainEditWorld,
  dirtyKeys: Iterable<string>,
  formats: ReadonlyMap<string, TerrainHeightFormat>,
  globalAttributes?: TerrainGlobalAttributes,
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
  const dirty = new Set(dirtyKeys);
  const keys = widened ? [...listed] : [...dirty].filter((key) => listed.has(key));
  const reencode: string[] = [];
  const tiles: WorldTerrainTileWrite[] = [];
  for (const key of keys.sort()) {
    const tile = world.tiles.get(key);
    if (!tile) {
      // An edited tile is never evicted, so only an untouched one can be absent.
      if (widened && !dirty.has(key)) { reencode.push(key); continue; }
      throw new Error(`World Terrain tile ${key} is not loaded; cannot save it`);
    }
    tiles.push({
      key,
      bytes: encodeTerrainTile(tile, { heightMin: def.heightMin, heightMax: def.heightMax, heightFormat: formats.get(key) ?? "f32" }),
    });
  }
  const allResident = def.tiles.every(({ key }) => world.tiles.has(key));
  if (!allResident && !globalAttributes) throw new Error("World Terrain is partly loaded and has no global map to save");
  const global = encodeTerrainGlobalMap(def, allResident
    ? buildTerrainGlobalAttributes(worldTerrainRenderSource(def, world.tiles))
    : globalAttributes!);
  return { def, tiles, global, widened, reencode };
}

/**
 * Rewrites an on-disk tile for a wider definition range, keeping its height
 * format (a `u16` tile is re-quantized over the new range; `f32` keeps exact
 * heights). Rejects a binary that is not tile `key`.
 */
export function reencodeTerrainTileRange(key: string, bytes: Uint8Array, heightMin: number, heightMax: number): Uint8Array {
  const tile = decodeTerrainTile(bytes);
  if (tileKey(tile.x, tile.z) !== key) throw new Error(`terrain tile ${key} binary holds tile ${tileKey(tile.x, tile.z)}`);
  return encodeTerrainTile(tile, { heightMin, heightMax, heightFormat: tile.heightFormat });
}
