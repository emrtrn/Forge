import { quantizeTerrainWeights } from "./terrainEdit";
import {
  isValidTileQuads,
  terrainTileHeightRange,
  terrainTileLayerWeight,
  terrainWeightBlockCount,
  type TerrainTileData,
  type WorldTerrainDef,
} from "./terrainTypes";
import { worldTerrainActorPosition } from "./worldTerrainActor";

/**
 * Resolution and footprint changes of a single-tile World Terrain (OPEN_WORLD_PLAN
 * Faz 8, bridge removal K2) — the 1×1 Landscape's "Resolution" and "World Size".
 * Both keep the terrain centred where it is. A multi-tile terrain is refused:
 * resampling it would move every seam and break neighbouring tiles' copies.
 */

export const TERRAIN_MIN_SPACING = 0.01;
export const TERRAIN_MAX_SPACING = 100;

function singleTile(def: Pick<WorldTerrainDef, "tilesX" | "tilesZ" | "tiles">): void {
  if (def.tilesX !== 1 || def.tilesZ !== 1 || def.tiles.length !== 1) {
    throw new Error("Only a single-tile terrain can be resampled or resized; a multi-tile terrain keeps its grid.");
  }
}

/** The definition moved so its centre stays at `centre` with the given grid. */
function centred(def: WorldTerrainDef, centre: readonly number[], tileQuads: number, spacing: number): WorldTerrainDef {
  const half = (tileQuads * spacing) / 2;
  return { ...structuredClone(def), tileQuads, spacing, origin: [centre[0]! - half, def.origin[1], centre[2]! - half] };
}

/**
 * The same footprint on `tileQuads` quads per side: heights and paint weights
 * resampled bilinearly (weights re-normalized to exactly 255 per vertex), the
 * vertex spacing scaled so the width is unchanged. Inputs are never mutated.
 */
export function resampleSingleTileTerrain(
  def: WorldTerrainDef,
  tile: TerrainTileData,
  tileQuads: number,
): { def: WorldTerrainDef; tile: TerrainTileData } {
  singleTile(def);
  if (!isValidTileQuads(tileQuads)) throw new Error(`invalid tile resolution ${tileQuads}`);
  const width = def.tileQuads * def.spacing;
  const spacing = width / tileQuads;
  if (spacing < TERRAIN_MIN_SPACING || spacing > TERRAIN_MAX_SPACING) throw new Error("Resampled vertex spacing is outside the supported range.");
  const source = tile.size;
  const size = tileQuads + 1;
  const heights = new Float32Array(size * size);
  const blocks = terrainWeightBlockCount(tile.layerCount);
  const weights = new Uint8Array(blocks * size * size * 4);
  const scale = (source - 1) / (size - 1);
  const layerWeights = new Array<number>(tile.layerCount);
  for (let z = 0; z < size; z += 1) {
    const sz = Math.min(source - 1, z * scale);
    const z0 = Math.floor(sz);
    const z1 = Math.min(source - 1, z0 + 1);
    const tz = sz - z0;
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(source - 1, x * scale);
      const x0 = Math.floor(sx);
      const x1 = Math.min(source - 1, x0 + 1);
      const tx = sx - x0;
      const sample = (read: (index: number) => number): number => {
        const top = read(z0 * source + x0) * (1 - tx) + read(z0 * source + x1) * tx;
        const bottom = read(z1 * source + x0) * (1 - tx) + read(z1 * source + x1) * tx;
        return top * (1 - tz) + bottom * tz;
      };
      const index = z * size + x;
      heights[index] = sample((i) => tile.heights[i]!);
      if (tile.layerCount === 0) continue;
      for (let layer = 0; layer < tile.layerCount; layer += 1) layerWeights[layer] = sample((i) => terrainTileLayerWeight(tile, layer, i));
      const quantized = quantizeTerrainWeights(layerWeights);
      for (let layer = 0; layer < tile.layerCount; layer += 1) {
        weights[Math.floor(layer / 4) * size * size * 4 + index * 4 + layer % 4] = quantized[layer]!;
      }
    }
  }
  const next: TerrainTileData = { x: tile.x, z: tile.z, size, heights, layerCount: tile.layerCount, weights };
  const range = terrainTileHeightRange(next);
  const nextDef = centred(def, worldTerrainActorPosition(def), tileQuads, spacing);
  nextDef.tiles = [{ ...def.tiles[0]!, minHeight: range.min, maxHeight: range.max }];
  return { def: nextDef, tile: next };
}

/** The same grid and data stretched to `worldSize` metres per side, centred in place. */
export function resizeSingleTileTerrain(def: WorldTerrainDef, worldSize: number): WorldTerrainDef {
  singleTile(def);
  const spacing = worldSize / def.tileQuads;
  if (!Number.isFinite(spacing) || spacing < TERRAIN_MIN_SPACING || spacing > TERRAIN_MAX_SPACING) {
    throw new Error(`World size must be between ${def.tileQuads * TERRAIN_MIN_SPACING} and ${def.tileQuads * TERRAIN_MAX_SPACING} m for this resolution.`);
  }
  return centred(def, worldTerrainActorPosition(def), def.tileQuads, spacing);
}
