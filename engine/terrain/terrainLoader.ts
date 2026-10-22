import { normalizeWorldTerrain } from "./terrainDefinition";
import { decodeTerrainTile, type DecodedTerrainTile } from "./terrainTileCodec";
import { terrainTileHeightRange, terrainTilePath, tileKey, type WorldTerrainDef, type TerrainTileData } from "./terrainTypes";

export interface WorldTerrainDocument {
  def: WorldTerrainDef;
  tiles: Map<string, TerrainTileData>;
}

/** Cross-check binary header and samples against the JSON definition, on load and save. */
export function validateTerrainTile(def: WorldTerrainDef, key: string, bytes: Uint8Array): DecodedTerrainTile {
  const summary = def.tiles.find((entry) => entry.key === key);
  if (!summary) throw new Error(`terrain has no tile ${key}`);
  const tile = decodeTerrainTile(bytes);
  if (tileKey(tile.x, tile.z) !== key || tile.size !== def.tileQuads + 1 || tile.layerCount !== def.layers.length ||
      tile.heightMin !== Math.fround(def.heightMin) || tile.heightMax !== Math.fround(def.heightMax)) {
    throw new Error(`terrain tile ${key} header does not match definition`);
  }
  if (!tile.heights.every(Number.isFinite)) throw new Error(`terrain tile ${key} has non-finite heights`);
  const range = terrainTileHeightRange(tile);
  // Uint16 quantization can expand the authored bounds by half a step.
  const tolerance = tile.heightFormat === "u16" ? (tile.heightMax - tile.heightMin) / 65535 + 1e-4 : 1e-4;
  if (range.min < summary.minHeight - tolerance || range.max > summary.maxHeight + tolerance ||
      range.min < def.heightMin - tolerance || range.max > def.heightMax + tolerance) {
    throw new Error(`terrain tile ${key} samples exceed declared bounds`);
  }
  return tile;
}

/** Phase 1 eager loading, sequential to bound requests and transient allocation. */
export async function loadWorldTerrain(
  path: string, value: unknown, readBinary: (path: string) => Promise<Uint8Array>,
): Promise<WorldTerrainDocument> {
  const def = normalizeWorldTerrain(value);
  const tiles = new Map<string, DecodedTerrainTile>();
  for (const { key } of def.tiles) tiles.set(key, validateTerrainTile(def, key, await readBinary(terrainTilePath(path, key))));
  return { def, tiles };
}
