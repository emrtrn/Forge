import { normalizeWorldTerrain } from "./terrainDefinition";
import { isMultiTileTerrain } from "./worldTerrainActor";
import { validateTerrainGlobalMap } from "./terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource, type TerrainGlobalAttributes } from "./terrainRenderSource";
import { decodeTerrainTile, type DecodedTerrainTile } from "./terrainTileCodec";
import { terrainGlobalMapPath, terrainTileHeightRange, terrainTilePath, tileKey, type WorldTerrainDef, type TerrainTileData } from "./terrainTypes";

export interface WorldTerrainDocument {
  globalAttributes?: TerrainGlobalAttributes | undefined;
  def: WorldTerrainDef;
  tiles: Map<string, TerrainTileData>;
}

/** Cross-check binary header and samples against the JSON definition, on load and save. */
export function validateTerrainTile(def: WorldTerrainDef, key: string, bytes: Uint8Array): DecodedTerrainTile {
  return validateDecodedTerrainTile(def, key, decodeTerrainTile(bytes));
}

/** Shared by eager IO and worker decoding without decoding the binary twice. */
export function validateDecodedTerrainTile(def: WorldTerrainDef, key: string, tile: DecodedTerrainTile): DecodedTerrainTile {
  const summary = def.tiles.find((entry) => entry.key === key);
  if (!summary) throw new Error(`terrain has no tile ${key}`);
  if (tileKey(tile.x, tile.z) !== key || tile.size !== def.tileQuads + 1 || tile.layerCount !== def.layers.length ||
      tile.heightMin !== Math.fround(def.heightMin) || tile.heightMax !== Math.fround(def.heightMax)) {
    throw new Error(`terrain tile ${key} header does not match definition`);
  }
  if (!tile.heights.every(Number.isFinite)) throw new Error(`terrain tile ${key} has non-finite heights`);
  const range = terrainTileHeightRange(tile);
  const tolerance = terrainTileBoundsTolerance(tile);
  if (range.min < def.heightMin - tolerance || range.max > def.heightMax + tolerance) {
    throw new Error(`terrain tile ${key} samples ${formatRange(range)} exceed the definition's encoding range ${def.heightMin}..${def.heightMax}`);
  }
  if (terrainTileSummaryDrifted(summary, range, tolerance)) {
    // A tile rewritten after the definition was committed (overlapping saves) leaves the summary stale.
    throw new Error(
      `terrain tile ${key} samples ${formatRange(range)} exceed declared bounds ${formatRange({ min: summary.minHeight, max: summary.maxHeight })}; `
      + `the summary is stale. Fix it with: npm run terrain:repair -- <terrain.json> --write`,
    );
  }
  return tile;
}

/** Uint16 quantization can expand the authored bounds by half a step. */
export function terrainTileBoundsTolerance(tile: Pick<DecodedTerrainTile, "heightFormat" | "heightMin" | "heightMax">): number {
  return tile.heightFormat === "u16" ? (tile.heightMax - tile.heightMin) / 65535 + 1e-4 : 1e-4;
}

/** True when the tile's real samples reach outside the definition's `minHeight..maxHeight` summary. */
export function terrainTileSummaryDrifted(
  summary: { minHeight: number; maxHeight: number }, range: { min: number; max: number }, tolerance: number,
): boolean {
  return range.min < summary.minHeight - tolerance || range.max > summary.maxHeight + tolerance;
}

function formatRange(range: { min: number; max: number }): string {
  return `${Number(range.min.toFixed(4))}..${Number(range.max.toFixed(4))}`;
}

/** Eager by default; runtime streaming reads only the multi-tile definition/global map. */
export async function loadWorldTerrain(
  path: string, value: unknown, readBinary: (path: string) => Promise<Uint8Array>,
  streamTiles = false,
): Promise<WorldTerrainDocument> {
  const def = normalizeWorldTerrain(value);
  const tiles = new Map<string, DecodedTerrainTile>();
  // A single (0, 0) tile is drawn through the 1x1 Landscape adapter, which
  // builds its own far map; only multi-tile terrains read the sidecar.
  if (!isMultiTileTerrain(def)) {
    for (const { key } of def.tiles) tiles.set(key, validateTerrainTile(def, key, await readBinary(terrainTilePath(path, key))));
    return { def, tiles };
  }
  let globalAttributes: TerrainGlobalAttributes | undefined;
  try {
    globalAttributes = validateTerrainGlobalMap(def, await readBinary(terrainGlobalMapPath(path)));
  } catch (error) {
    if (streamTiles) throw new Error(`[terrain] ${path}: streaming requires a valid global map; save the terrain in the editor`, { cause: error });
    console.warn(`[terrain] ${path}: global map missing or invalid; computing from tiles`, error);
  }
  if (streamTiles) return { def, tiles, globalAttributes };
  for (const { key } of def.tiles) tiles.set(key, validateTerrainTile(def, key, await readBinary(terrainTilePath(path, key))));
  globalAttributes ??= buildTerrainGlobalAttributes(worldTerrainRenderSource(def, tiles));
  return { def, tiles, globalAttributes };
}
