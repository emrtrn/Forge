import assert from "node:assert/strict";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { createFlatTerrainTile, tileKey, type TerrainSpline, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { expandSingleTileWorldTerrain, singleTileExpandProblems } from "../../engine/terrain/worldTerrainExpand";

type Check = (label: string, fn: () => void) => void;

function single() {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "One", tileQuads: 64, spacing: 2, tilesX: 1, tilesZ: 1,
    origin: [10, 4, -20], heightMin: -50, heightMax: 60,
    layers: [{ id: "grass", name: "Grass" }, { id: "rock", name: "Rock" }],
    tiles: [{ key: "0_0", minHeight: 0, maxHeight: 0 }], collision: false,
    splines: [{ id: "road", closed: false, coordinateSpace: "world", points: [{ id: "p", position: [30, 5, 0], tangent: [1, 0, 0] }] } as unknown as TerrainSpline],
  };
  const tile = Object.assign(createFlatTerrainTile(def, 0, 0), { heightFormat: "u16" as const });
  for (let z = 0; z <= 64; z += 1) {
    for (let x = 0; x <= 64; x += 1) {
      const index = z * 65 + x;
      tile.heights[index] = Math.sin(x * 0.2) * 3 + z * 0.1;
      tile.weights[index * 4] = x % 2 ? 128 : 255;
      tile.weights[index * 4 + 1] = x % 2 ? 127 : 0;
    }
  }
  return { def, tiles: new Map([["0_0", tile]]) };
}

/** OPEN_WORLD_PLAN Faz 8 bridge removal K3: expanding a single-tile World Terrain. */
export function registerWorldTerrainExpandSingleTests(check: Check): void {
  check("world terrain expand: the original tile stays in place verbatim; splines, layers and collision carry over", () => {
    const document = single();
    const before = structuredClone({ def: document.def, heights: Array.from(document.tiles.get("0_0")!.heights) });
    const result = expandSingleTileWorldTerrain(document, { tilesX: 3, tilesZ: 2, originalX: 1, originalZ: 1 });
    assert.ok(result.ok);
    const { def, tiles } = result.document;
    assert.deepEqual(def.origin, [-118, 4, -148], "origin moves out by one tile edge (128 m) in X and Z");
    assert.equal(def.tilesX, 3);
    assert.equal(def.tilesZ, 2);
    assert.equal(def.collision, false);
    assert.deepEqual(def.layers, document.def.layers);
    assert.deepEqual(def.splines, document.def.splines, "world-space splines are not moved");
    assert.deepEqual(def.tiles.map(({ key }) => key), ["0_0", "1_0", "2_0", "0_1", "1_1", "2_1"]);
    const original = tiles.get(tileKey(1, 1))!;
    assert.deepEqual(Array.from(original.heights), before.heights, "original heights verbatim");
    assert.equal((original as { heightFormat?: string }).heightFormat, "u16", "original height format kept");
    // Same world point, same height, before and after.
    const lookup = (map: ReadonlyMap<string, unknown>) => ({ tile: (x: number, z: number) => map.get(tileKey(x, z)) as never });
    for (const [x, z] of [[11.5, -19], [70, 30], [137, 107]]) {
      assert.equal(terrainHeightAt(def, lookup(tiles), x!, z!), terrainHeightAt(document.def, lookup(document.tiles), x!, z!));
    }
    // A new tile extends the original's edge: its row on the shared seam is identical.
    const left = tiles.get(tileKey(0, 1))!;
    for (let z = 0; z <= 64; z += 1) assert.equal(left.heights[z * 65 + 64], original.heights[z * 65]);
    assert.deepEqual(document.def, before.def, "input untouched");
  });

  check("world terrain expand: problems for multi-tile input and bad grids; nothing else blocks", () => {
    const { def } = single();
    assert.deepEqual(singleTileExpandProblems(def, { tilesX: 2, tilesZ: 2, originalX: 0, originalZ: 0 }), []);
    assert.match(singleTileExpandProblems({ ...def, tilesX: 2 }, { tilesX: 2, tilesZ: 2, originalX: 0, originalZ: 0 })[0]!, /single-tile/);
    assert.ok(singleTileExpandProblems(def, { tilesX: 1, tilesZ: 1, originalX: 0, originalZ: 0 }).includes("Expanding needs at least two tiles."));
    assert.ok(singleTileExpandProblems(def, { tilesX: 2, tilesZ: 2, originalX: 2, originalZ: 0 }).some((problem) => problem.startsWith("Original tile X")));
    const missing = expandSingleTileWorldTerrain({ def, tiles: new Map() }, { tilesX: 2, tilesZ: 1, originalX: 0, originalZ: 0 });
    assert.deepEqual(missing, { ok: false, reasons: ["The Landscape tile is not loaded."] });
  });
}
