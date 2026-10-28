/**
 * Terrain pads (World Builder F1 step 12c, T21): a polygon levelled to a height
 * with a smoothstep falloff, baked as undo patches across tile seams, the
 * stronger pull winning where pads overlap.
 */
import assert from "node:assert/strict";

import {
  applyTerrainUndoPatches, createTerrainEditWorld, revertTerrainUndoPatches, type TerrainEditWorld,
} from "../../engine/terrain/terrainEdit";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { createTerrainPadPatches, padWeight, terrainPadTileKeys, type TerrainPad } from "../../engine/terrain/terrainPads";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;

/** 2 × 2 flat tiles of 32 m at 1 m spacing; world origin offset like a real level. */
function fixture(): TerrainEditWorld {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Pad test", tileQuads: 32, spacing: 1,
    tilesX: 2, tilesZ: 2, origin: [100, 10, -50], heightMin: -256, heightMax: 256,
    layers: [{ id: "grass", name: "Grass", color: "#ffffff" }], tiles: [], collision: true,
  };
  const tiles: TerrainTileData[] = [];
  for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) {
    tiles.push(createFlatTerrainTile(def, x, z));
    def.tiles.push({ key: tileKey(x, z), minHeight: 0, maxHeight: 0 });
  }
  return createTerrainEditWorld(def, tiles);
}

/** A square pad in terrain-local metres (x0..x1, z0..z1) at a world height. */
function pad(world: TerrainEditWorld, [x0, z0, x1, z1]: [number, number, number, number], height: number, falloff = 4): TerrainPad {
  const [ox, , oz] = world.def.origin;
  return { polygon: [[ox + x0, oz + z0], [ox + x1, oz + z0], [ox + x1, oz + z1], [ox + x0, oz + z1]], height, falloff };
}

function heightAt(world: TerrainEditWorld, x: number, z: number): number {
  return terrainHeightAt(world.def, world, world.def.origin[0] + x, world.def.origin[2] + z)!;
}

export function registerTerrainPadTests(check: Check): void {
  check("terrain pads: level inside, smoothstep falloff outside, across a tile seam, undoable", () => {
    const world = fixture();
    const base = world.def.origin[1];
    const patches = createTerrainPadPatches(world, [pad(world, [26, 10, 38, 20], base + 2.5)]);
    assert.ok(patches.length >= 2, "the pad spans the x = 32 m seam");
    applyTerrainUndoPatches(world, patches);
    for (const x of [26, 30, 32, 34, 38]) assert.equal(heightAt(world, x, 15), base + 2.5, `inside at x ${x}`);
    assert.ok(Math.abs(heightAt(world, 40, 15) - (base + 1.25)) < 1e-3, "half way through the falloff");
    assert.equal(heightAt(world, 42, 15), base, "beyond the falloff");
    assert.equal(heightAt(world, 32, 30), base);
    revertTerrainUndoPatches(world, patches);
    assert.equal(heightAt(world, 30, 15), base);
  });

  check("terrain pads: the stronger pull wins where falloffs overlap; tile keys cover the reach", () => {
    const world = fixture();
    const base = world.def.origin[1];
    const low = pad(world, [4, 4, 12, 12], base - 1);
    const high = pad(world, [14, 4, 22, 12], base + 3);
    applyTerrainUndoPatches(world, createTerrainPadPatches(world, [low, high]));
    assert.equal(heightAt(world, 12, 8), base - 1, "inside the low pad, in the high one's falloff");
    assert.equal(heightAt(world, 14, 8), base + 3);
    assert.equal(padWeight(low, world.def.origin[0] + 13, world.def.origin[2] + 8), padWeight(high, world.def.origin[0] + 13, world.def.origin[2] + 8));

    assert.deepEqual(terrainPadTileKeys(world.def, [low]), ["0_0"]);
    assert.deepEqual(terrainPadTileKeys(world.def, [pad(world, [26, 10, 30, 20], base)]).sort(), ["0_0", "1_0"]);
    assert.deepEqual(createTerrainPadPatches(world, []), []);
  });
}
