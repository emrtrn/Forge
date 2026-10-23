import { terrainTileBoundsTolerance, terrainTileSummaryDrifted } from "./terrainLoader";
import type { DecodedTerrainTile } from "./terrainTileCodec";
import { terrainTileHeightRange, type WorldTerrainDef } from "./terrainTypes";

export interface TerrainSummaryChange {
  key: string;
  before: { min: number; max: number };
  after: { min: number; max: number };
}

export interface TerrainRepairResult {
  /** The definition with stale summaries recomputed; a clone, the input is untouched. */
  def: WorldTerrainDef;
  /** Tiles whose `minHeight..maxHeight` summary no longer covered their samples. */
  changes: TerrainSummaryChange[];
}

/**
 * Recomputes the `minHeight..maxHeight` summary of every tile whose samples
 * left it. That is the one inconsistency overlapping saves can produce: a tile
 * rewritten after the definition was committed. The tile bytes (the sculpt) are
 * the source of truth and stay as they are; only the definition is corrected.
 *
 * Header/range problems (a tile whose header disagrees with the definition,
 * samples outside `heightMin..heightMax`, non-finite heights) cannot be fixed
 * by editing summaries and are left for `validateTerrainTile` to report.
 */
export function repairTerrainSummaries(def: WorldTerrainDef, tiles: ReadonlyMap<string, DecodedTerrainTile>): TerrainRepairResult {
  const repaired = structuredClone(def);
  const changes: TerrainSummaryChange[] = [];
  for (const summary of repaired.tiles) {
    const tile = tiles.get(summary.key);
    if (!tile) continue;
    const range = terrainTileHeightRange(tile);
    if (!terrainTileSummaryDrifted(summary, range, terrainTileBoundsTolerance(tile))) continue;
    changes.push({
      key: summary.key,
      before: { min: summary.minHeight, max: summary.maxHeight },
      after: { min: range.min, max: range.max },
    });
    summary.minHeight = range.min;
    summary.maxHeight = range.max;
  }
  return { def: repaired, changes };
}
