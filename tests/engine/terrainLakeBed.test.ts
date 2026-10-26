import assert from "node:assert/strict";
import { createLakeBedFixture } from "./fixtures/lakeBedFixture";
import { validateWaterBody } from "../../engine/scene/waterBody";
import { lakeBedDistance, lakeBedPolyline } from "../../engine/scene/lakeBed";
import { prepareLakeBed, lakeBedStillCurrent, lakeBedTarget, preflightLakeBed } from "../../engine/terrain/terrainLakeBed";
import { applyTerrainUndoPatches, createTerrainEditWorld, revertTerrainUndoPatches } from "../../engine/terrain/terrainEdit";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { encodeTerrainTile, decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { terrainTileLayerWeight, tileKey } from "../../engine/terrain/terrainTypes";
import { validateLayout } from "../../tools/saveValidator";
import { partitionLayout, DEFAULT_WORLD_PARTITION } from "../../engine/world/worldPartition";
import type { RoomLayout } from "../../engine/scene/layout";

type Check = (label: string, fn: () => Promise<void>) => Promise<void>;
export async function registerTerrainLakeBedTests(check: Check) {
  await check("lake bed: shared save allowlist preserves recipe precision and rejects malformed rings", async () => {
    const { lake } = createLakeBedFixture(); lake.bed!.points[0]![0] = -28.123456789;
    const source = validateWaterBody({ ...lake, bed: { ...lake.bed, derived: [1] } });
    assert.deepEqual(source.bed, lake.bed);
    const layout = { schema: 1, name: "W2", loadGroups: [], instances: [], characters: [], waterBodies: [source] } as RoomLayout;
    assert.deepEqual((validateLayout(layout) as unknown as RoomLayout).waterBodies, [source]);
    assert.deepEqual(partitionLayout(layout, DEFAULT_WORLD_PARTITION).persistent.waterBodies, [source]);
    for (const points of [[[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [0, 1], [1, 0]], [[0, 0], [0, 0], [1, 1]]]) {
      assert.throws(() => validateWaterBody({ ...lake, bed: { ...lake.bed, points } }));
    }
    for (const change of [{ maxDepth: NaN }, { shoreSlopeDegrees: 90 }, { transitionWidth: -1 }, { smooth: "yes" }, { shorePaint: { layerId: "x", strength: Infinity } }]) {
      assert.throws(() => validateWaterBody({ ...lake, bed: { ...lake.bed, ...change } }));
    }
  });
  await check("lake bed: preview is pure; two seam bake, exact W1 depths and one patch undo/redo", async () => {
    const doc = createLakeBedFixture(), before = structuredClone(doc), p = await prepareLakeBed(doc, doc.lake);
    assert.deepEqual(doc, before); assert.equal(p.patches.length, 4); assert.equal(p.actualMaxDepth, 3);
    const world = createTerrainEditWorld(doc.def, doc.tiles.values()), source = structuredClone({ def: world.def, tiles: world.tiles });
    applyTerrainUndoPatches(world, p.patches);
    assert.equal(terrainHeightAt(world.def, world, 0, 0), 11);
    for (const x of [-32, 0, 32]) for (const z of [-32, 0, 32]) {
      const expected = Math.min(16, lakeBedTarget(14, 3, 30, 4, lakeBedDistance(lakeBedPolyline(doc.lake.bed!), x, z)));
      assert.ok(Math.abs(terrainHeightAt(world.def, world, x, z)! - expected) < 1e-5);
    }
    for (const tx of [0, 1]) for (let i = 0; i <= 64; i++) {
      assert.equal(world.tiles.get(tileKey(tx, 0))!.heights[64 * 65 + i], world.tiles.get(tileKey(tx, 1))!.heights[i]);
      assert.equal(world.tiles.get(tileKey(0, tx))!.heights[i * 65 + 64], world.tiles.get(tileKey(1, tx))!.heights[i * 65]);
    }
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(world, p.lake));
    assert.deepEqual(geometry.depths, p.geometry.depths); assert.deepEqual(geometry.positions, p.geometry.positions);
    revertTerrainUndoPatches(world, p.patches); assert.deepEqual(world.tiles, source.tiles); assert.deepEqual(world.def, source.def);
    applyTerrainUndoPatches(world, p.patches); assert.equal((await prepareLakeBed(world, p.lake)).patches.length, 0);
  });
  await check("lake bed: optional true-shore paint is normalized, idempotent and restored with heights", async () => {
    const doc = createLakeBedFixture(); doc.lake.bed!.shorePaint = { layerId: "shore", strength: 0.7 };
    const world = createTerrainEditWorld(doc.def, doc.tiles.values()), before = structuredClone(world.tiles), p = await prepareLakeBed(world, doc.lake);
    applyTerrainUndoPatches(world, p.patches); let painted = 0;
    for (const tile of world.tiles.values()) for (let i = 0; i < tile.heights.length; i++) {
      const shore = terrainTileLayerWeight(tile, 1, i); if (shore) painted++;
      assert.ok(Math.abs(terrainTileLayerWeight(tile, 0, i) + shore - 1) < 1e-8);
    }
    assert.ok(painted > 0); assert.equal((await prepareLakeBed(world, doc.lake)).patches.length, 0);
    revertTerrainUndoPatches(world, p.patches); assert.deepEqual(world.tiles, before);
  });
  await check("lake bed: lower-only preserves deep terrain, shallower rebake never fills", async () => {
    const doc = createLakeBedFixture();
    for (const tile of doc.tiles.values()) tile.heights[(64 - tile.z * 64) * 65 + (64 - tile.x * 64)] = -3;
    const world = createTerrainEditWorld(doc.def, doc.tiles.values()), p = await prepareLakeBed(world, doc.lake);
    assert.equal(p.actualMaxDepth, 7); applyTerrainUndoPatches(world, p.patches);
    assert.equal(terrainHeightAt(world.def, world, 0, 0), 7);
    doc.lake.bed!.maxDepth = 1; const shallow = await prepareLakeBed(world, doc.lake);
    assert.equal(shallow.patches.length, 0);
  });
  await check("lake bed: missing data, holes, bounds, range and budget fail before any write", async () => {
    const doc = createLakeBedFixture(), original = structuredClone(doc), disk = new Map(doc.tiles); doc.tiles.clear();
    let count = 0, peak = 0;
    await assert.rejects(prepareLakeBed(doc, doc.lake), /missing-data/);
    const p = await prepareLakeBed(doc, doc.lake, async (key) => { peak = Math.max(peak, ++count); await Promise.resolve(); count--; return disk.get(key)!; });
    assert.equal(doc.tiles.size, 0); assert.equal(p.patches.length, 4); assert.ok(peak <= 4);
    await assert.rejects(prepareLakeBed(doc, doc.lake, async () => { throw new Error("HTTP 503"); }), /503/);
    doc.tiles = disk;
    doc.def.tiles = doc.def.tiles.filter((t) => t.key !== "1_1"); await assert.rejects(prepareLakeBed(doc, doc.lake), /hole/);
    doc.def = original.def;
    for (const patch of [{ bounds: { min: [-20, -20], max: [20, 20] } }, { bounds: { min: [-80, -48], max: [48, 48] } }]) {
      await assert.rejects(prepareLakeBed(doc, { ...doc.lake, ...patch } as typeof doc.lake), /work area|outside terrain/);
    }
    doc.lake.surfaceLevel = -70; await assert.rejects(prepareLakeBed(doc, doc.lake), /encoding range/);
    const large = { ...original.def, tilesX: 32, tilesZ: 32 };
    assert.throws(() => preflightLakeBed(large, { ...original.lake, bounds: { min: [-64, -64], max: [448, 448] } }), /over-budget/);
    assert.deepEqual(doc.tiles, original.tiles);
  });
  await check("lake bed: cancelled work and stale live paint or height cannot be published", async () => {
    const doc = createLakeBedFixture(), p = await prepareLakeBed(doc, doc.lake), abort = new AbortController();
    assert.equal(lakeBedStillCurrent(doc, p), true);
    doc.tiles.get("0_0")!.weights[0] = 0; assert.equal(lakeBedStillCurrent(doc, p), false);
    abort.abort(); await assert.rejects(prepareLakeBed(doc, doc.lake, undefined, abort.signal), /cancelled/);
    doc.tiles.get("0_0")!.weights[0] = 255; doc.tiles.get("1_1")!.heights[0] = 5;
    assert.equal(lakeBedStillCurrent(doc, p), false);
  });
  await check("lake bed: malformed later undo patch rejects the whole terrain transaction", async () => {
    const doc = createLakeBedFixture(), world = createTerrainEditWorld(doc.def, doc.tiles.values()), p = await prepareLakeBed(world, doc.lake);
    const before = structuredClone(world.tiles), broken = structuredClone(p.patches);
    broken[broken.length - 1]!.after.heights[0] = NaN;
    assert.throws(() => applyTerrainUndoPatches(world, broken), /Invalid terrain undo values/);
    assert.deepEqual(world.tiles, before);
  });
  await check("lake bed: large origin, reversed smooth boundary, f32/u16 save and runtime agree", async () => {
    const doc = createLakeBedFixture([1000000.25, 37.5, -1000000.75]); doc.lake.bed!.smooth = true;
    const p = await prepareLakeBed(doc, doc.lake), reversed = structuredClone(doc.lake); reversed.bed!.points.reverse();
    const r = await prepareLakeBed(doc, reversed); assert.deepEqual(r.snapshot.heights, p.snapshot.heights);
    const world = createTerrainEditWorld(doc.def, doc.tiles.values()); applyTerrainUndoPatches(world, p.patches);
    for (const heightFormat of ["f32", "u16"] as const) {
      const tiles = new Map([...world.tiles].map(([key, t]) => [key, decodeTerrainTile(encodeTerrainTile(t, { heightMin: -64, heightMax: 64, heightFormat }))]));
      const runtime = await buildLakeGeometry(await prepareLakeSnapshot({ def: doc.def, tiles }, p.lake));
      assert.equal(runtime.status, "ready");
      const delta = Math.abs(Math.max(...runtime.depths) - 3); assert.ok(delta < (heightFormat === "f32" ? 1e-5 : 128 / 65535));
    }
  });
}
