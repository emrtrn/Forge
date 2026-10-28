import assert from "node:assert/strict";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { decodeTerrainTile, encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import {
  createFlatTerrainTile, terrainTileLayerWeight, tileKey, type TerrainSpline, type TerrainTileData, type WorldTerrainDef,
} from "../../engine/terrain/terrainTypes";
import { expandSingleTileWorldTerrain, singleTileExpandProblems } from "../../engine/terrain/worldTerrainExpand";
import { validateSaveTerrainTile } from "../../tools/terrainSaveValidator";

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

  check("world terrain expand: every height extends the nearest original edge/corner and new paint is layer zero", () => {
    const document = single();
    const original = document.tiles.get("0_0")!;
    const result = expandSingleTileWorldTerrain(document, { tilesX: 3, tilesZ: 3, originalX: 1, originalZ: 1 });
    assert.ok(result.ok);
    const q = 64;
    for (const tile of result.document.tiles.values()) {
      for (let z = 0; z <= q; z += 1) for (let x = 0; x <= q; x += 1) {
        const sx = (tile.x - 1) * q + x;
        const sz = (tile.z - 1) * q + z;
        const source = Math.max(0, Math.min(q, sz)) * (q + 1) + Math.max(0, Math.min(q, sx));
        const index = z * tile.size + x;
        assert.equal(tile.heights[index], original.heights[source]);
        const inside = sx >= 0 && sx <= q && sz >= 0 && sz <= q;
        for (let layer = 0; layer < original.layerCount; layer += 1) {
          assert.equal(terrainTileLayerWeight(tile, layer, index), inside ? terrainTileLayerWeight(original, layer, source) : layer === 0 ? 1 : 0);
        }
      }
    }
  });

  check("world terrain expand: every duplicated seam has identical heights and paint, including four-tile corners", () => {
    const result = expandSingleTileWorldTerrain(single(), { tilesX: 3, tilesZ: 3, originalX: 1, originalZ: 1 });
    assert.ok(result.ok);
    const { tiles } = result.document;
    const compare = (a: TerrainTileData, ai: number, b: TerrainTileData, bi: number) => {
      assert.equal(a.heights[ai], b.heights[bi]);
      for (let layer = 0; layer < a.layerCount; layer += 1) assert.equal(terrainTileLayerWeight(a, layer, ai), terrainTileLayerWeight(b, layer, bi));
    };
    for (const tile of tiles.values()) {
      const right = tiles.get(tileKey(tile.x + 1, tile.z));
      const down = tiles.get(tileKey(tile.x, tile.z + 1));
      for (let i = 0; i < tile.size; i += 1) {
        if (right) compare(tile, i * tile.size + tile.size - 1, right, i * tile.size);
        if (down) compare(tile, (tile.size - 1) * tile.size + i, down, i);
      }
    }
  });

  check("world terrain expand codec: validator rejects nonfinite heights; codec rejects truncated data and unsupported flags", () => {
    const result = expandSingleTileWorldTerrain(single(), { tilesX: 3, tilesZ: 3, originalX: 1, originalZ: 1 });
    assert.ok(result.ok);
    const bytes = encodeTerrainTile(result.document.tiles.get("1_1")!, { ...result.document.def, heightFormat: "f32" });
    const corrupt = bytes.slice();
    for (const height of [NaN, Infinity]) {
      new DataView(corrupt.buffer).setFloat32(32, height, true);
      assert.throws(() => validateSaveTerrainTile("layouts/test.terrain.json", "1_1", corrupt), /heights invalid/);
    }
    assert.throws(() => decodeTerrainTile(bytes.subarray(0, bytes.length - 1)), /expected/);
    const flags = bytes.slice();
    new DataView(flags.buffer).setUint16(6, 3, true);
    assert.throws(() => decodeTerrainTile(flags), /flags/);
    new DataView(flags.buffer).setUint16(6, 8, true);
    assert.throws(() => decodeTerrainTile(flags), /flags/);
  });
}
