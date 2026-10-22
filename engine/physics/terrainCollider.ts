import type { Vec3 } from "../scene/layout";
import { terrainTileWorldBounds, type TerrainTileData, type WorldTerrainDef } from "../terrain/terrainTypes";

/**
 * World Terrain tile → Rapier heightfield shape data (OPEN_WORLD_PLAN K3). Pure
 * data so it is testable without the Rapier module and reusable by the
 * physics subsystem when it creates the collider:
 *
 * `ColliderDesc.heightfield(nrows, ncols, heights, scale)` with the body at
 * `translation`.
 *
 * Rapier's heightfield is centred on its body and its height matrix is
 * column-major: consecutive samples advance along Z, columns advance along X
 * (`index = vx · (nrows + 1) + vz`), and each cell is split along the
 * (−X,+Z)–(+X,−Z) diagonal — the same b–c diagonal as the render mesh and
 * `terrainHeightAt`, so the collider surface equals the queried one
 * (OPEN_WORLD_PLAN K3a; verified by the engine terrain Rapier test).
 */
export interface TerrainHeightfieldShape {
  /** Quads along Z. */
  nrows: number;
  /** Quads along X. */
  ncols: number;
  /** `(nrows + 1) · (ncols + 1)` heights, column-major (Z fastest). */
  heights: Float32Array;
  /** Full X/Z extent of the field; Y is 1 (heights are already metres). */
  scale: Vec3;
  /** World position of the field's centre at the terrain datum height. */
  translation: Vec3;
}

export function terrainTileHeightfieldShape(
  def: Pick<WorldTerrainDef, "tileQuads" | "spacing" | "origin">,
  tile: TerrainTileData,
): TerrainHeightfieldShape {
  const size = tile.size;
  const quads = size - 1;
  const heights = new Float32Array(size * size);
  for (let vx = 0; vx < size; vx += 1) {
    for (let vz = 0; vz < size; vz += 1) {
      heights[vx * size + vz] = tile.heights[vz * size + vx]!;
    }
  }
  const bounds = terrainTileWorldBounds(def, tile.x, tile.z);
  const extent = quads * def.spacing;
  return {
    nrows: quads,
    ncols: quads,
    heights,
    scale: [extent, 1, extent],
    translation: [(bounds.minX + bounds.maxX) / 2, def.origin[1], (bounds.minZ + bounds.maxZ) / 2],
  };
}
