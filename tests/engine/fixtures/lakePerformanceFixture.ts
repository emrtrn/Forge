import { createLakeFixture } from "./lakeFixture";
import { createFlatTerrainTile, tileKey, type WorldTerrainDef, type TerrainTileData } from "../../../engine/terrain/terrainTypes";
import type { LayoutLakeWaterBody } from "../../../engine/scene/layout";

/** Separate from authored levels. Eight bodies nearly fill the total cell budget. */
export function createLakePerformanceFixture(kind: "small" | "maximum" | "world") {
  if (kind === "small") {
    const fixture = createLakeFixture();
    return { ...fixture, lakes: [fixture.lake], extent: 128 };
  }
  const world = kind === "world", spacing = world ? 2 : 1, q = 128;
  const extent = world ? 4096 : 256, half = world ? 180 : 128;
  const centers: [number, number][] = world
    ? [-256, 256].flatMap(z => [-768, -256, 256, 768].map(x => [x, z] as [number, number])) : [[0, 0]];
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: `Lake performance ${kind}`,
    tileQuads: q, spacing, tilesX: extent / (q * spacing), tilesZ: extent / (q * spacing),
    origin: [-extent / 2, 10, -extent / 2], heightMin: -64, heightMax: 64, collision: true,
    layers: [{ id: "ground", name: "Ground", color: "#776644" }], tiles: [] };
  const tiles = new Map<string, TerrainTileData>();
  for (let tz = 0; tz < def.tilesZ; tz++) for (let tx = 0; tx < def.tilesX; tx++) {
    const tile = createFlatTerrainTile(def, tx, tz);
    for (let z = 0; z <= q; z++) for (let x = 0; x <= q; x++) {
      const wx = def.origin[0] + (tx * q + x) * spacing, wz = def.origin[2] + (tz * q + z) * spacing;
      let height = 6;
      for (const [cx, cz] of centers) {
        const d = Math.max(Math.abs(wx - cx), Math.abs(wz - cz));
        height = Math.min(height, Math.max(0, (d - half * .62) / (half * .25)) * 6);
      }
      tile.heights[z * tile.size + x] = Math.min(6, height);
    }
    const key = tileKey(tx, tz); tiles.set(key, tile); def.tiles.push({ key, minHeight: 0, maxHeight: 6 });
  }
  const lakes: LayoutLakeWaterBody[] = centers.map(([x, z], i) => ({ schema: 1, kind: "lake", mode: "fillExisting",
    coordinateSpace: "world", id: `lake-${i + 1}`, terrainRef: "terrain", surfaceLevel: 12,
    seed: [x, z], bounds: { min: [x - half, z - half], max: [x + half, z + half] } }));
  return { def, tiles, lakes, extent };
}
