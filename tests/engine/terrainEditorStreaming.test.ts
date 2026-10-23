import assert from "node:assert/strict";
import { applyTerrainBrush, createTerrainEditWorld } from "../../engine/terrain/terrainEdit";
import { editorStreamsTerrain, TerrainEditorStreaming, terrainBrushTileKeys } from "../../engine/terrain/terrainEditorStreaming";
import { decodeTerrainGlobalMap, encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { decodeTerrainTile, encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { captureWorldTerrainSave, reencodeTerrainTileRange } from "../../engine/terrain/worldTerrainSave";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

/** 8x8 tiles of 32 quads at 1 m (32 m tiles), heights 2 + x/100; tile 3_3 is a hole. */
function fixture() {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "editor", tileQuads: 32, spacing: 1, tilesX: 8, tilesZ: 8,
    origin: [0, 0, 0], heightMin: -10, heightMax: 10, layers: [{ id: "grass", name: "Grass", color: "#448833" }], tiles: [], collision: true,
  };
  const disk = new Map<string, TerrainTileData>();
  for (let z = 0; z < 8; z += 1) for (let x = 0; x < 8; x += 1) {
    if (x === 3 && z === 3) continue;
    const tile = createFlatTerrainTile(def, x, z, 2 + x / 100);
    disk.set(tileKey(x, z), tile);
    def.tiles.push({ key: tileKey(x, z), minHeight: tile.heights[0]!, maxHeight: tile.heights[0]! });
  }
  const copy = (tile: TerrainTileData): TerrainTileData => ({ ...tile, heights: tile.heights.slice(), weights: tile.weights.slice() });
  return { def, disk, copy };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

export async function registerTerrainEditorStreamingTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("editor terrain streaming starts above 6x6 tiles", () => {
    assert.equal(editorStreamsTerrain({ tiles: Array.from({ length: 36 }, () => ({ key: "", minHeight: 0, maxHeight: 0 })) }), false);
    assert.equal(editorStreamsTerrain({ tiles: Array.from({ length: 37 }, () => ({ key: "", minHeight: 0, maxHeight: 0 })) }), true);
  });

  check("editor terrain streaming brush keys cover the footprint, the smoothing halo and both seam sides, never holes", () => {
    const { def, disk, copy } = fixture();
    assert.deepEqual(terrainBrushTileKeys(def, 16, 16, 4), ["0_0"]);
    // On the x = 32 seam: both tiles, and every dab tile must be resident for applyTerrainBrush.
    const seam = terrainBrushTileKeys(def, 32, 16, 1);
    assert.deepEqual(seam, ["0_0", "1_0"]);
    const world = createTerrainEditWorld(def, seam.map((key) => copy(disk.get(key)!)));
    assert.ok(applyTerrainBrush(world, { mode: "smooth", x: 32, z: 16, radius: 1, strength: 1, falloff: 0, hitHeight: 2 }));
    // 1.5 m from the seam the halo still reaches across it.
    assert.deepEqual(terrainBrushTileKeys(def, 30.5, 16, 0), ["0_0", "1_0"]);
    assert.ok(!terrainBrushTileKeys(def, 112, 112, 20).includes("3_3"), "the hole is never demanded");
    assert.deepEqual(terrainBrushTileKeys(def, -50, -50, 4), [], "outside the grid");
  });

  await checkAsync("editor terrain streaming loads around the camera, drops past hysteresis, keeps pinned tiles and never re-reads over an edit", async () => {
    const { def, disk, copy } = fixture();
    const world = createTerrainEditWorld(def, []);
    const fetched: string[] = [];
    const changed: string[] = [];
    const pinned = new Set<string>();
    const streaming = new TerrainEditorStreaming(world, {
      fetch: async (key) => { fetched.push(key); return copy(disk.get(key)!); },
      changed: (key) => changed.push(key), pinned: (key) => pinned.has(key), warn: (message) => assert.fail(message),
    }, { rangeTiles: 1, maxConcurrentFetches: 4 });
    streaming.update([{ position: [16, 16] }]);
    assert.equal(streaming.loading, 4, "concurrency limit");
    for (let i = 0; i < 4; i += 1) { await settle(); streaming.update([{ position: [16, 16] }]); }
    assert.deepEqual([...world.tiles.keys()].sort(), ["0_0", "0_1", "1_0", "1_1"]);
    assert.ok(!fetched.includes("3_3"), "a hole is never read");
    // Edit 1_1, then move away: the edited tile stays, the rest leave.
    const brush = applyTerrainBrush(world, { mode: "raise", x: 40, z: 40, radius: 2, strength: 1, falloff: 0, hitHeight: 2 });
    for (const key of brush.dirty.keys()) pinned.add(key);
    const edited = world.tiles.get("1_1")!.heights.slice();
    streaming.update([{ position: [240, 240] }]);
    assert.deepEqual([...world.tiles.keys()].sort(), ["1_1"]);
    assert.ok(changed.includes("0_0"));
    for (let i = 0; i < 6; i += 1) { await settle(); streaming.update([{ position: [240, 240] }]); }
    assert.ok(world.tiles.has("7_7"));
    // Back home: the edited tile is not replaced by its disk copy.
    for (let i = 0; i < 6; i += 1) { streaming.update([{ position: [16, 16] }]); await settle(); }
    assert.deepEqual(world.tiles.get("1_1")!.heights, edited);
    assert.equal(fetched.filter((key) => key === "1_1").length, 1);
    streaming.dispose();
  });

  await checkAsync("editor terrain streaming holds demanded tiles beyond the ring, cancels unwanted reads, and loads all on demand", async () => {
    const { def, disk, copy } = fixture();
    const world = createTerrainEditWorld(def, []);
    const aborted: string[] = [];
    const streaming = new TerrainEditorStreaming(world, {
      fetch: (key, signal) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => { aborted.push(key); reject(new Error("aborted")); });
        queueMicrotask(() => { if (key !== "0_0" || !signal.aborted) resolve(copy(disk.get(key)!)); });
      }),
      changed: () => {}, pinned: () => false, warn: () => {},
    }, { rangeTiles: 0 });
    streaming.update([{ position: [16, 16] }]);
    streaming.update([{ position: [240, 240] }]);
    assert.deepEqual(aborted, ["0_0"], "a read that left the ring is cancelled");
    await streaming.demand(["0_0", "3_3"]);
    assert.ok(world.tiles.has("0_0"));
    streaming.update([{ position: [240, 240] }]);
    assert.ok(world.tiles.has("0_0"), "held while the stroke needs it");
    streaming.release();
    streaming.update([{ position: [240, 240] }]);
    assert.ok(!world.tiles.has("0_0"));
    await streaming.demandAll();
    assert.equal(world.tiles.size, 63);
    assert.ok(streaming.allResident);
    streaming.dispose();
  });

  check("streaming save: a partly loaded world saves its live global map and lists unloaded tiles to re-encode when the range widens", () => {
    const { def, disk, copy } = fixture();
    const full = new Map([...disk].map(([key, tile]) => [key, copy(tile)]));
    const live = buildTerrainGlobalAttributes(worldTerrainRenderSource(def, full));
    const world = createTerrainEditWorld(def, [copy(disk.get("0_0")!), copy(disk.get("1_0")!)]);
    assert.throws(() => captureWorldTerrainSave(world, ["0_0"], new Map()), /partly loaded/);
    const plain = captureWorldTerrainSave(world, ["0_0"], new Map(), live);
    assert.deepEqual(plain.tiles.map(({ key }) => key), ["0_0"]);
    assert.deepEqual(plain.reencode, []);
    assert.deepEqual(plain.global, encodeTerrainGlobalMap(def, live));
    world.tiles.get("0_0")!.heights[0] = 25;
    world.def.tiles.find(({ key }) => key === "0_0")!.maxHeight = 25;
    const widened = captureWorldTerrainSave(world, ["0_0"], new Map(), live);
    assert.equal(widened.def.heightMax, 26);
    assert.deepEqual(widened.tiles.map(({ key }) => key), ["0_0", "1_0"]);
    assert.equal(widened.reencode.length, 61);
    assert.ok(!widened.reencode.includes("0_0") && !widened.reencode.includes("3_3"));
    assert.ok(decodeTerrainGlobalMap(widened.global).map.width > 0);
    world.tiles.delete("1_0");
    assert.throws(() => captureWorldTerrainSave(world, ["1_0"], new Map(), live), /1_0 is not loaded/);
  });

  check("streaming save: re-encoding an on-disk tile keeps its format and heights over the wider range", () => {
    const { def, disk } = fixture();
    const tile = disk.get("2_0")!;
    for (const heightFormat of ["u16", "f32"] as const) {
      const bytes = encodeTerrainTile(tile, { heightMin: def.heightMin, heightMax: def.heightMax, heightFormat });
      const wider = decodeTerrainTile(reencodeTerrainTileRange("2_0", bytes, -20, 30));
      assert.equal(wider.heightFormat, heightFormat);
      assert.deepEqual([wider.heightMin, wider.heightMax], [-20, 30]);
      const step = heightFormat === "u16" ? 50 / 65535 : 0;
      assert.ok(Math.abs(wider.heights[0]! - tile.heights[0]!) <= step + 20 / 65535);
      assert.throws(() => reencodeTerrainTileRange("0_0", bytes, -20, 30), /holds tile 2_0/);
    }
  });
}
