/**
 * Bakes larger than one editor transaction (`TERRAIN_REGION_MAX_VERTICES`) are
 * prepared in pieces by offline builders (`splitTerrainRegion`, the `split`
 * option of the spline and pad bakes): every vertex once, the same terrain as
 * one region gives. The World Builder hit the limit with long roads and towns
 * spread over a 4 km world.
 */
import assert from "node:assert/strict";
import {
  applyTerrainUndoPatches, createTerrainEditWorld, revertTerrainUndoPatches, splitTerrainRegion, terrainRegionGridBounds,
  type TerrainEditWorld,
} from "../../engine/terrain/terrainEdit";
import { createTerrainPadPatches } from "../../engine/terrain/terrainPads";
import { createTerrainSplinePatches, type WorldTerrainSpline } from "../../engine/terrain/terrainSplines";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;

function fixture(): TerrainEditWorld {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "Split bake", tileQuads: 32, spacing: 1,
    tilesX: 3, tilesZ: 2, origin: [101.25, 19, -71.5], heightMin: -256, heightMax: 256,
    layers: Array.from({ length: 4 }, (_, i) => ({ id: `layer-${i}`, name: `Layer ${i}`, color: "#ffffff" })),
    tiles: [], collision: true,
  };
  const tiles: TerrainTileData[] = [];
  for (let z = 0; z < def.tilesZ; z++) for (let x = 0; x < def.tilesX; x++) {
    const tile = createFlatTerrainTile(def, x, z);
    // A sloped start, so a flattening bake changes every vertex it reaches by a different amount.
    for (let j = 0; j < tile.size; j++) for (let i = 0; i < tile.size; i++) tile.heights[j * tile.size + i] = 0.05 * (x * 32 + i) - 0.03 * (z * 32 + j);
    tiles.push(tile);
    def.tiles.push({ key: tileKey(x, z), minHeight: -2, maxHeight: 5 });
  }
  return createTerrainEditWorld(def, tiles);
}

function road(world: TerrainEditWorld): WorldTerrainSpline {
  const point = (id: string, x: number, z: number) => ({
    id, position: [world.def.origin[0] + x, world.def.origin[1] + 1, world.def.origin[2] + z] as [number, number, number], width: 6, falloff: 4,
  });
  return {
    coordinateSpace: "world", id: "road", name: "Road", points: [point("a", 4, 6), point("b", 60, 30), point("c", 92, 58)],
    segments: ["ab", "bc"].map((id) => ({
      id, startPointId: id[0]!, endPointId: id[1]!,
      deform: { enabled: true, flatten: true, raiseTerrain: false, lowerTerrain: false },
      paint: { enabled: true, layerId: "layer-2", strength: 0.7 },
    })),
  };
}

const state = (world: TerrainEditWorld) => structuredClone([...world.tiles.values()].map((tile) => [tile.heights, tile.weights]));

export function registerTerrainSplitBakeTests(check: Check): void {
  check("terrain split bake: pieces hold every vertex once and none is larger than asked", () => {
    const world = fixture();
    const { def } = world;
    const bounds = { minX: def.origin[0] + 3.2, minZ: def.origin[2] - 5, maxX: def.origin[0] + 90.7, maxZ: def.origin[2] + 61 };
    const whole = terrainRegionGridBounds(def, bounds)!;
    const pieces = splitTerrainRegion(def, bounds, 400);
    assert.ok(pieces.length > 4);
    const seen = new Set<string>();
    for (const piece of pieces) {
      const rect = terrainRegionGridBounds(def, piece)!;
      assert.ok((rect.x1 - rect.x0 + 1) * (rect.z1 - rect.z0 + 1) <= 400);
      for (let z = rect.z0; z <= rect.z1; z++) for (let x = rect.x0; x <= rect.x1; x++) {
        const key = `${x}_${z}`;
        assert.ok(!seen.has(key), `vertex ${key} in two pieces`);
        seen.add(key);
      }
    }
    assert.equal(seen.size, (whole.x1 - whole.x0 + 1) * (whole.z1 - whole.z0 + 1));
    assert.deepEqual(splitTerrainRegion(def, { minX: -1e6, minZ: -1e6, maxX: -1e6 + 1, maxZ: -1e6 + 1 }), []);
  });

  check("terrain split bake: a road and pads baked in pieces match one region, and undo restores it", () => {
    const one = fixture();
    const split = fixture();
    const before = state(split);
    applyTerrainUndoPatches(one, createTerrainSplinePatches(one, road(one)));
    const patches = createTerrainSplinePatches(split, road(split), "both", { split: true, pieceVertices: 300 });
    applyTerrainUndoPatches(split, patches);
    assert.deepEqual(state(split), state(one));
    assert.notDeepEqual(state(split), before);

    const pads = [
      { polygon: [[110, -60], [130, -60], [130, -45], [110, -45]] as Array<[number, number]>, height: 21, falloff: 6 },
      { polygon: [[160, -40], [175, -40], [175, -25], [160, -25]] as Array<[number, number]>, height: 18.5, falloff: 8 },
    ];
    applyTerrainUndoPatches(one, createTerrainPadPatches(one, pads));
    const padPatches = createTerrainPadPatches(split, pads, { split: true, pieceVertices: 250 });
    applyTerrainUndoPatches(split, padPatches);
    assert.deepEqual(state(split), state(one));

    revertTerrainUndoPatches(split, padPatches);
    revertTerrainUndoPatches(split, patches);
    assert.deepEqual(state(split), before);
  });

  check("terrain split bake: without split an oversized bake still throws (the editor's transaction limit)", () => {
    const world = fixture();
    const def = { ...world.def, tileQuads: 2048 };
    assert.throws(() => terrainRegionGridBounds(def, { minX: def.origin[0], minZ: def.origin[2], maxX: def.origin[0] + 1100, maxZ: def.origin[2] + 1100 }), /too large/);
  });
}
