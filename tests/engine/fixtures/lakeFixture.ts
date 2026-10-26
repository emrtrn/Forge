import type { LayoutLakeWaterBody, Vec3 } from "../../../engine/scene/layout";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../../engine/terrain/terrainTypes";

/** Independent terrain; never touches authored scenes. Same samples on all seam copies. */
export function createLakeFixture(origin: Vec3 = [-64, 10, -64]) {
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "Lake QA", tileQuads: 64, spacing: 1,
    tilesX: 2, tilesZ: 2, origin, heightMin: -64, heightMax: 64, collision: true,
    layers: [{ id: "ground", name: "Ground", color: "#776644" }], tiles: [] };
  const tiles = new Map<string, TerrainTileData>();
  for (let tz = 0; tz < 2; tz++) for (let tx = 0; tx < 2; tx++) {
    const tile = createFlatTerrainTile(def, tx, tz);
    for (let z = 0; z <= 64; z++) for (let x = 0; x <= 64; x++) {
      const wx = tx * 64 + x - 64, wz = tz * 64 + z - 64;
      let h = Math.min(6, Math.max(0, Math.max(Math.abs(wx + 8), Math.abs(wz)) - 20) * 0.5);
      const basin = Math.max(Math.abs(wx - 30), Math.abs(wz));
      if (basin <= 6) h = Math.min(h, basin * 4 / 6);
      if (wx >= 12 && wx <= 30 && Math.abs(wz) <= 2) h = Math.min(h, 4);
      if (wx >= -32 && wx <= -28 && wz >= 20) h = Math.min(h, 5);
      const island = Math.max(Math.abs(wx), Math.abs(wz));
      if (island <= 6) h = Math.max(h, 5 - island / 2);
      tile.heights[z * tile.size + x] = h;
    }
    const key = tileKey(tx, tz); tiles.set(key, tile);
    def.tiles.push({ key, minHeight: 0, maxHeight: 6 });
  }
  const dx = origin[0] + 64, dz = origin[2] + 64;
  const lake: LayoutLakeWaterBody = { schema: 1, kind: "lake", mode: "fillExisting", id: "lake-1", name: "Lake QA",
    terrainRef: "terrain", coordinateSpace: "world", seed: [-20 + dx, -12 + dz],
    bounds: { min: [-48 + dx, -48 + dz], max: [48 + dx, 48 + dz] }, surfaceLevel: origin[1] + 2 };
  return { def, tiles, lake };
}
