import assert from "node:assert/strict";
import { applyTerrainUndoPatches, createTerrainEditWorld, revertTerrainUndoPatches } from "../../engine/terrain/terrainEdit";
import { TerrainEditorStreaming } from "../../engine/terrain/terrainEditorStreaming";
import { createTerrainSplinePatches, terrainSplineTileKeys, type WorldTerrainSpline } from "../../engine/terrain/terrainSplines";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

function fixture() {
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "Spline streaming", tileQuads: 32, spacing: 1,
    tilesX: 8, tilesZ: 8, origin: [17, 5, -19], heightMin: -64, heightMax: 64, collision: true,
    layers: [{ id: "grass", name: "Grass", color: "#558833" }, { id: "rock", name: "Rock", color: "#888888" }], tiles: [] };
  const disk = new Map<string, TerrainTileData>();
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
    if (x === 3 && z === 1) continue;
    disk.set(tileKey(x, z), createFlatTerrainTile(def, x, z));
    def.tiles.push({ key: tileKey(x, z), minHeight: 0, maxHeight: 0 });
  }
  const spline: WorldTerrainSpline = { id: "road", coordinateSpace: "world", smooth: true,
    points: [
      { id: "a", position: [30, 7, 13], width: 4, falloff: 2 },
      { id: "b", position: [120, 8, 13], width: 6, falloff: 3 },
      { id: "c", position: [220, 7, 27], width: 4, falloff: 2 },
    ], segments: ["a", "b"].map((id, i) => ({ id, startPointId: id, endPointId: ["b", "c"][i]!,
      deform: { enabled: true, flatten: true, raiseTerrain: true, lowerTerrain: true }, paint: { enabled: true, layerId: "rock", strength: 1 } })) };
  return { def, disk, spline };
}

export async function registerTerrainSplineEditingTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("terrain spline editor: demand keys cover curved bake seams, skip holes and exclude remote tiles", () => {
    const { def, disk, spline } = fixture();
    const keys = terrainSplineTileKeys(def, spline);
    const world = createTerrainEditWorld(def, disk.values());
    for (const { key } of createTerrainSplinePatches(world, spline)) assert.ok(keys.includes(key), key);
    assert.ok(!keys.includes("3_1"));
    assert.ok(!keys.includes("7_7"));
    assert.ok(keys.includes("0_0") && keys.includes("0_1"), "both copies of the first seam");
    assert.ok(keys.length < def.tiles.length / 2);
  });

  check("terrain spline editor: oversized and disabled effects are handled before requesting terrain tiles", () => {
    const { def, spline } = fixture();
    def.tileQuads = 512;
    spline.points[2]!.position = [4000, 7, 4000];
    assert.throws(() => terrainSplineTileKeys(def, spline), /too large/);
    for (const segment of spline.segments) { segment.deform!.enabled = false; segment.paint!.enabled = false; }
    assert.deepEqual(terrainSplineTileKeys(def, spline), []);
  });

  await checkAsync("terrain spline editor: streamed bake holds footprint tiles then pins edited copies for exact undo and redo", async () => {
    const { def, disk, spline } = fixture();
    const world = createTerrainEditWorld(def, []);
    const touched = new Set<string>();
    const keys = terrainSplineTileKeys(def, spline);
    const streaming = new TerrainEditorStreaming(world, {
      fetch: async (key) => structuredClone(disk.get(key)!), changed: () => {}, pinned: (key) => touched.has(key), warn: () => {},
    }, { rangeTiles: 0.1 });
    try {
      await streaming.demand(keys);
      streaming.update([{ position: [265, 230] }]);
      for (const key of keys) assert.ok(world.tiles.has(key), "held until the operation finishes");
      const before = new Map([...world.tiles].map(([key, tile]) => [key, { heights: tile.heights.slice(), weights: tile.weights.slice() }]));
      const patches = createTerrainSplinePatches(world, spline);
      for (const key of applyTerrainUndoPatches(world, patches).keys()) touched.add(key);
      const after = new Map([...touched].map((key) => [key, structuredClone(world.tiles.get(key)!)]));
      streaming.release(keys);
      streaming.update([{ position: [265, 230] }]);
      for (const key of touched) assert.ok(world.tiles.has(key), "undo history pins every changed tile");
      revertTerrainUndoPatches(world, patches);
      for (const key of touched) {
        assert.deepEqual(world.tiles.get(key)!.heights, before.get(key)!.heights);
        assert.deepEqual(world.tiles.get(key)!.weights, before.get(key)!.weights);
      }
      applyTerrainUndoPatches(world, patches);
      for (const key of touched) assert.deepEqual(world.tiles.get(key), after.get(key));
    } finally { streaming.dispose(); }
  });

  await checkAsync("terrain spline editor: failed demand prevents a partial bake and the same footprint can retry", async () => {
    const { def, disk, spline } = fixture();
    const world = createTerrainEditWorld(def, []);
    const keys = terrainSplineTileKeys(def, spline);
    let fail = true;
    const streaming = new TerrainEditorStreaming(world, {
      fetch: async (key) => { if (fail && key === keys.at(-1)) throw new Error("offline"); return structuredClone(disk.get(key)!); },
      changed: () => {}, pinned: () => false, warn: () => {},
    });
    try {
      await assert.rejects(streaming.demand(keys), /offline/);
      assert.ok([...world.tiles.values()].every((tile) => tile.heights.every((height) => height === 0)));
      assert.throws(() => createTerrainSplinePatches(world, spline), /not resident/);
      streaming.release(keys);
      fail = false;
      await streaming.demand(keys);
      assert.ok(createTerrainSplinePatches(world, spline).length > 0);
    } finally { streaming.dispose(); }
  });
}
