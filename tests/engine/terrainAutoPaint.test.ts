/**
 * Auto Paint: height and slope rules repaint a whole World Terrain as one
 * undoable set of tile patches; later rules win, seam copies agree.
 */
import assert from "node:assert/strict";

import {
  createTerrainAutoPaintPatches, defaultTerrainAutoPaintRule, terrainAutoPaintBand, terrainAutoPaintMask,
  type TerrainAutoPaintSettings,
} from "../../engine/terrain/terrainAutoPaint";
import { applyTerrainUndoPatches, createTerrainEditWorld, revertTerrainUndoPatches, type TerrainEditWorld } from "../../engine/terrain/terrainEdit";
import { createFlatTerrainTile, terrainTileLayerWeight, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;

const BASE_Y = 10;

/** 2 × 1 tiles of 32 m at 1 m spacing; flat until x = 20 m, then a 45° ramp across the seam. */
function fixture(): TerrainEditWorld {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Auto paint test", tileQuads: 32, spacing: 1,
    tilesX: 2, tilesZ: 1, origin: [100, BASE_Y, -50], heightMin: -256, heightMax: 256,
    layers: [
      { id: "grass", name: "Grass", color: "#00ff00" },
      { id: "rock", name: "Rock", color: "#808080" },
      { id: "snow", name: "Snow", color: "#ffffff" },
    ],
    tiles: [], collision: true,
  };
  const tiles: TerrainTileData[] = [];
  for (let x = 0; x < 2; x++) {
    const tile = createFlatTerrainTile(def, x, 0);
    for (let lz = 0; lz < tile.size; lz++) for (let lx = 0; lx < tile.size; lx++) {
      tile.heights[lz * tile.size + lx] = Math.max(0, x * 32 + lx - 20);
    }
    tiles.push(tile);
    def.tiles.push({ key: tileKey(x, 0), minHeight: 0, maxHeight: 0 });
  }
  return createTerrainEditWorld(def, tiles);
}

/** Layer weights (0..1) of grid vertex (gx, gz), read from the tile that holds it at local x. */
function weightsAt(world: TerrainEditWorld, tx: number, lx: number, lz: number): number[] {
  const tile = world.tiles.get(tileKey(tx, 0))!;
  return world.def.layers.map((_, layer) => terrainTileLayerWeight(tile, layer, lz * tile.size + lx));
}

function settings(): TerrainAutoPaintSettings {
  const rock = { ...defaultTerrainAutoPaintRule("rock", -1000, 1000), slopeMin: 30, slopeMax: 90 };
  const snow = { ...defaultTerrainAutoPaintRule("snow", BASE_Y + 30, 1000) };
  return { baseLayerId: "grass", rules: [rock, snow], seed: 1 };
}

export function registerTerrainAutoPaintTests(check: Check): void {
  check("terrain auto paint: band is full inside, smoothstep falloff outside, hard edge at 0", () => {
    assert.equal(terrainAutoPaintBand(5, 0, 10, 0), 1);
    assert.equal(terrainAutoPaintBand(10, 0, 10, 0), 1);
    assert.equal(terrainAutoPaintBand(10.01, 0, 10, 0), 0);
    assert.equal(terrainAutoPaintBand(12, 0, 10, 4), 0.5);
    assert.equal(terrainAutoPaintBand(-2, 0, 10, 4), 0.5);
    assert.equal(terrainAutoPaintBand(14, 0, 10, 4), 0);
    assert.equal(terrainAutoPaintBand(5, 10, 0, 0), 1, "swapped bounds still read as a band");
  });

  check("terrain auto paint: noise only breaks up covered ground, never adds outside it", () => {
    const rule = { ...defaultTerrainAutoPaintRule("rock", 0, 10), noiseAmount: 1, noiseScale: 5 };
    for (let x = 0; x < 50; x += 3.7) {
      assert.equal(terrainAutoPaintMask(rule, 20, 0, x, 0, 3), 0, "outside the band");
      const inside = terrainAutoPaintMask(rule, 5, 0, x, 0, 3);
      assert.ok(inside >= 0 && inside <= 1);
    }
  });

  check("terrain auto paint: base, slope and height rules, later rule wins, seam copies agree, undoable", () => {
    const world = fixture();
    const patches = createTerrainAutoPaintPatches(world, settings());
    applyTerrainUndoPatches(world, patches);
    // Flat ground at x = 5 m: base grass.
    assert.deepEqual(weightsAt(world, 0, 5, 16), [1, 0, 0]);
    // 45° ramp at x = 28 m (height 8 m): rock.
    assert.deepEqual(weightsAt(world, 0, 28, 16), [0, 1, 0]);
    // The seam vertex x = 32 m, both copies: rock.
    assert.deepEqual(weightsAt(world, 0, 32, 16), [0, 1, 0]);
    assert.deepEqual(weightsAt(world, 1, 0, 16), [0, 1, 0]);
    // x = 60 m is 40 m up the ramp, above the snow line: snow over rock.
    assert.deepEqual(weightsAt(world, 1, 28, 16), [0, 0, 1]);
    revertTerrainUndoPatches(world, patches);
    assert.deepEqual(weightsAt(world, 0, 28, 16), [1, 0, 0], "undo restores the first layer");
  });

  check("terrain auto paint: strength blends, disabled rules are skipped, unknown layers reject", () => {
    const world = fixture();
    const half = { baseLayerId: "grass", seed: 1, rules: [{ ...defaultTerrainAutoPaintRule("rock", -1000, 1000), strength: 0.5 }] };
    applyTerrainUndoPatches(world, createTerrainAutoPaintPatches(world, half));
    const [grass, rock] = weightsAt(world, 0, 5, 16);
    assert.ok(Math.abs(grass! - 0.5) < 0.01 && Math.abs(rock! - 0.5) < 0.01);
    const disabled = { ...half, rules: [{ ...half.rules[0]!, enabled: false }] };
    applyTerrainUndoPatches(world, createTerrainAutoPaintPatches(world, disabled));
    assert.deepEqual(weightsAt(world, 0, 5, 16), [1, 0, 0]);
    assert.deepEqual(createTerrainAutoPaintPatches(world, disabled), [], "nothing left to change");
    assert.throws(() => createTerrainAutoPaintPatches(world, { ...half, baseLayerId: "lava" }), /base layer/);
    assert.throws(() => createTerrainAutoPaintPatches(world, { ...half, rules: [defaultTerrainAutoPaintRule("lava", 0, 1)] }), /lava/);
  });

  check("terrain auto paint: every listed tile must be resident", () => {
    const world = fixture();
    world.tiles.delete(tileKey(1, 0));
    assert.throws(() => createTerrainAutoPaintPatches(world, settings()), /not resident/);
  });
}
