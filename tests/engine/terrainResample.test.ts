import assert from "node:assert/strict";
import { resampleSingleTileTerrain, resizeSingleTileTerrain } from "../../engine/terrain/terrainResample";
import { createFlatTerrainTile, terrainTileLayerWeight, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";

type Check = (label: string, fn: () => void) => void;

function single(layers = 5): { def: WorldTerrainDef; tile: ReturnType<typeof createFlatTerrainTile> } {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "One", tileQuads: 64, spacing: 2, tilesX: 1, tilesZ: 1,
    origin: [-40, 3, 10], heightMin: -100, heightMax: 100,
    layers: Array.from({ length: layers }, (_, index) => ({ id: `l${index}`, name: `L${index}` })),
    tiles: [{ key: "0_0", minHeight: 0, maxHeight: 0 }], collision: true,
  };
  const tile = createFlatTerrainTile(def, 0, 0);
  for (let z = 0; z <= 64; z += 1) {
    for (let x = 0; x <= 64; x += 1) {
      const index = z * 65 + x;
      // A plane, so bilinear resampling reproduces it exactly.
      tile.heights[index] = 0.5 * x - 0.25 * z;
      // Layer 4 (second weight block) on the right half.
      tile.weights.fill(0, index * 4, index * 4 + 4);
      if (x >= 32) tile.weights[65 * 65 * 4 + index * 4] = 255;
      else tile.weights[index * 4] = 255;
    }
  }
  def.tiles[0] = { key: "0_0", minHeight: -16, maxHeight: 32 };
  return { def, tile };
}

/** OPEN_WORLD_PLAN Faz 8 bridge removal K2: single-tile resolution and world size. */
export function registerTerrainResampleTests(check: Check): void {
  check("terrain resample: a single tile keeps its centre, footprint, surface and normalized paint", () => {
    const { def, tile } = single();
    const before = structuredClone({ def, heights: Array.from(tile.heights), weights: Array.from(tile.weights) });
    const result = resampleSingleTileTerrain(def, tile, 128);
    assert.equal(result.def.tileQuads, 128);
    assert.equal(result.def.spacing, 1);
    assert.deepEqual(worldTerrainActorPosition(result.def), worldTerrainActorPosition(def));
    assert.equal(result.tile.size, 129);
    assert.equal(result.tile.layerCount, 5);
    for (const [x, z] of [[0, 0], [128, 0], [0, 128], [128, 128], [37, 91]] as const) {
      const expected = 0.5 * (x / 2) - 0.25 * (z / 2);
      assert.ok(Math.abs(result.tile.heights[z * 129 + x]! - expected) < 1e-5, `height at ${x},${z}`);
    }
    for (let index = 0; index < 129 * 129; index += 1) {
      const sum = Array.from({ length: 5 }, (_, layer) => Math.round(terrainTileLayerWeight(result.tile, layer, index) * 255))
        .reduce((total, weight) => total + weight, 0);
      assert.equal(sum, 255, `vertex ${index} weights sum to 255`);
    }
    assert.equal(terrainTileLayerWeight(result.tile, 4, 129 * 5 + 120), 1, "second-block layer survives");
    assert.deepEqual(result.def.tiles, [{ key: "0_0", minHeight: -16, maxHeight: 32 }]);
    assert.deepEqual({ def, heights: Array.from(tile.heights), weights: Array.from(tile.weights) }, before, "inputs untouched");
  });

  check("terrain resample: up then down is exact on shared vertices; multi-tile and bad resolutions are refused", () => {
    const { def, tile } = single(2);
    const up = resampleSingleTileTerrain(def, tile, 256);
    const back = resampleSingleTileTerrain(up.def, up.tile, 64);
    assert.deepEqual(back.def.origin, def.origin);
    assert.equal(back.def.spacing, def.spacing);
    assert.deepEqual(Array.from(back.tile.heights), Array.from(tile.heights));
    assert.throws(() => resampleSingleTileTerrain({ ...def, tilesX: 2, tiles: [...def.tiles, { key: "1_0", minHeight: 0, maxHeight: 0 }] }, tile, 128), /single-tile/);
    assert.throws(() => resampleSingleTileTerrain(def, tile, 100), /invalid tile resolution/);
    assert.throws(() => resampleSingleTileTerrain({ ...def, spacing: 0.01 }, tile, 128), /spacing/);
  });

  check("terrain resize: spacing follows the world size around a fixed centre; tiles are untouched", () => {
    const { def } = single();
    const resized = resizeSingleTileTerrain(def, 256);
    assert.equal(resized.spacing, 4);
    assert.deepEqual(resized.origin, [-104, 3, -54]);
    assert.deepEqual(worldTerrainActorPosition(resized), worldTerrainActorPosition(def));
    assert.deepEqual(resized.tiles, def.tiles);
    assert.equal(def.spacing, 2, "input untouched");
    assert.throws(() => resizeSingleTileTerrain(def, 0.1), /World size must be between 0.64 and 6400/);
    assert.throws(() => resizeSingleTileTerrain(def, Number.NaN), /World size/);
  });
}
