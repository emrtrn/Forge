import assert from "node:assert/strict";
import { createLakeAppearance, resolveLakeAppearance, validateWaterBody } from "../../engine/scene/waterBody";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { createFlatTerrainTile, tileKey, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { validateLayout } from "../../tools/saveValidator";
import { partitionLayout, DEFAULT_WORLD_PARTITION } from "../../engine/world/worldPartition";
import type { RoomLayout } from "../../engine/scene/layout";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { WaterReflectionRegistry } from "../../engine/render-three/waterReflectionRegistry";
import { LakeWaterController } from "../../src/scene/lakeWaterController";
import { Scene } from "three";
import { applyTerrainUndoPatches, revertTerrainUndoPatches, createTerrainEditWorld, createTerrainRegionPatches } from "../../engine/terrain/terrainEdit";
import { readRoomLayout } from "../../engine/scene/layoutValidation";

export async function registerTerrainLakeWaterTests(check: (label: string, fn: () => Promise<void>) => Promise<void>) {
  await check("terrain lake: source schema, save and partition preserve full precision without derived buffers", async () => {
    const { lake } = createLakeFixture(); lake.seed[0] = -20.123456789;
    const initial = createLakeAppearance();
    assert.equal(initial.wheelRippleStrength, 3); assert.equal(initial.wheelRippleLifetime, 4);
    assert.equal(initial.reflectionMode, "sharedPlanar"); assert.equal(initial.foamEnabled, true);
    const newLake = validateWaterBody({ ...lake, appearance: initial });
    assert.deepEqual(newLake.appearance, initial);
    initial.wheelRippleStrength = 6;
    assert.equal(createLakeAppearance().wheelRippleStrength, 3, "each Lake gets independent initial settings");
    assert.equal(resolveLakeAppearance(lake).wheelRippleStrength, 2, "older records keep their runtime fallback");
    assert.equal(resolveLakeAppearance(lake).reflectionMode, "off");
    const saved = validateWaterBody({ ...lake, positions: [99], appearance: { opacity: 0.5, extra: 1 } });
    assert.equal(saved.seed[0], lake.seed[0]); assert.equal("positions" in saved, false);
    const layout = { schema: 1, name: "Lake", loadGroups: [], instances: [], characters: [], waterBodies: [saved] } as RoomLayout;
    assert.deepEqual((validateLayout(layout) as unknown as RoomLayout).waterBodies, [saved]);
    assert.deepEqual(partitionLayout(layout, DEFAULT_WORLD_PARTITION).persistent.waterBodies, [saved]);
    for (const patch of [{ surfaceLevel: NaN }, { coordinateSpace: "local" }, { seed: [48, 0] }, { kind: "ocean" }]) {
      assert.throws(() => validateWaterBody({ ...lake, ...patch }));
    }
  });
  await check("terrain lake: two seams, island and isolated depression; exact triangle depths and escape threshold", async () => {
    const doc = createLakeFixture(); const before = structuredClone([...doc.tiles]);
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    assert.equal(geometry.status, "ready"); assert.equal(geometry.escapeLevel, 15); assert.ok(geometry.indices.length);
    const covers = (x: number, z: number) => {
      const p = geometry.positions;
      for (let k = 0; k < geometry.indices.length; k += 3) {
        const a = geometry.indices[k]! * 3, b = geometry.indices[k + 1]! * 3, c = geometry.indices[k + 2]! * 3;
        const cross = (u: number, v: number) => (p[v]! - p[u]!) * (z - p[u + 2]!) - (p[v + 2]! - p[u + 2]!) * (x - p[u]!);
        if (cross(a, b) <= 1e-7 && cross(b, c) <= 1e-7 && cross(c, a) <= 1e-7) return true;
      } return false;
    };
    assert.equal(covers(0, 0), false); assert.equal(covers(30, 0), false);
    assert.equal(covers(-20.2, -12.2), true); assert.ok(geometry.positions.some((v, i) => i % 3 === 0 && v > 0));
    for (let i = 0; i < geometry.depths.length; i++) {
      const x = geometry.positions[i * 3]! + geometry.position[0], z = geometry.positions[i * 3 + 2]! + geometry.position[2];
      const h = terrainHeightAt(doc.def, { tile: (tx, tz) => doc.tiles.get(tileKey(tx, tz)) }, x, z)!;
      assert.ok(Math.abs(geometry.depths[i]! - Math.max(0, doc.lake.surfaceLevel - h)) < 1e-4);
    }
    doc.lake.surfaceLevel = 14.25;
    const joined = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    assert.equal(joined.status, "ready"); assert.ok(joined.indices.length > geometry.indices.length);
    doc.lake.surfaceLevel = 15;
    assert.equal((await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake))).status, "open-boundary");
    doc.lake.surfaceLevel = 10;
    assert.equal((await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake))).status, "dry-seed");
    assert.deepEqual([...doc.tiles], before);
  });
  await check("terrain lake: bounded temporary reads, failure/retry, real holes and cancellation never change residency", async () => {
    const doc = createLakeFixture(), disk = new Map(doc.tiles); doc.tiles.clear(); let peak = 0, active = 0;
    const keys: string[] = [];
    const load = async (key: string) => { keys.push(key); peak = Math.max(peak, ++active); await Promise.resolve(); active--; return disk.get(key)!; };
    const snapshot = await prepareLakeSnapshot(doc, doc.lake, load);
    assert.equal(keys.length, 4); assert.ok(peak <= 4); assert.equal(doc.tiles.size, 0);
    assert.equal((await buildLakeGeometry(snapshot)).status, "ready");
    await assert.rejects(prepareLakeSnapshot(doc, doc.lake, async () => { throw new Error("HTTP 503"); }), /503/);
    assert.equal((await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake, load))).status, "ready");
    doc.def.tiles = doc.def.tiles.filter((t) => t.key !== "1_0");
    assert.equal((await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake, load))).status, "open-boundary");
    const cancel = new AbortController(); cancel.abort();
    await assert.rejects(prepareLakeSnapshot(doc, doc.lake, load, cancel.signal), /cancelled/);
    assert.equal(doc.tiles.size, 0);
  });
  await check("terrain lake: local geometry at million-metre origin, immutable snapshot and grid budget", async () => {
    const doc = createLakeFixture(), snap = await prepareLakeSnapshot(doc, doc.lake);
    for (const tile of doc.tiles.values()) tile.heights.fill(100);
    assert.equal((await buildLakeGeometry(snap)).status, "ready");
    const large = createLakeFixture([1000000.25, 37.5, -1000000.75]);
    const result = await buildLakeGeometry(await prepareLakeSnapshot(large, large.lake));
    assert.equal(result.status, "ready"); assert.equal(result.escapeLevel, 42.5);
    assert.ok(result.positions.every((v) => Math.abs(v) <= 48));
    const def: WorldTerrainDef = { ...large.def, tilesX: 100, tilesZ: 100 };
    const lake = { ...large.lake, seed: [def.origin[0] + 10, def.origin[2] + 10] as [number, number],
      bounds: { min: [def.origin[0], def.origin[2]] as [number, number], max: [def.origin[0] + 512, def.origin[2] + 512] as [number, number] } };
    await assert.rejects(prepareLakeSnapshot({ def, tiles: new Map() }, lake), /over-budget/);
    const single = { ...doc.def, tilesX: 1, tilesZ: 1, origin: [0, 0, 0] as [number, number, number], tiles: [{ key: "0_0", minHeight: 0, maxHeight: 8 }] };
    const tile = createFlatTerrainTile(single, 0, 0); tile.heights.fill(8);
    for (let z = 5; z < 25; z++) for (let x = 5; x < 25; x++) tile.heights[z * tile.size + x] = 0;
    assert.equal((await buildLakeGeometry(await prepareLakeSnapshot({ def: single, tiles: new Map([["0_0", tile]]) },
      { ...doc.lake, seed: [10, 10], surfaceLevel: 2, bounds: { min: [0, 0], max: [32, 32] } }))).status, "ready");
  });
  await check("terrain lake: sculpt/undo changes connected depth without mutating authored water", async () => {
    const doc = createLakeFixture(), source = structuredClone(doc.lake), world = createTerrainEditWorld(doc.def, doc.tiles.values());
    const build = () => prepareLakeSnapshot(world, doc.lake).then((s) => buildLakeGeometry(s));
    const before = await build();
    const patches = createTerrainRegionPatches(world, { minX: -3, minZ: -15, maxX: 3, maxZ: -9 }, { affects: () => true, sample: (_x, _z, height) => ({ height: height - 2 }) });
    applyTerrainUndoPatches(world, patches); const after = await build();
    assert.ok(Math.max(...after.depths) > Math.max(...before.depths));
    revertTerrainUndoPatches(world, patches); const undo = await build();
    assert.deepEqual(undo.positions, before.positions); assert.deepEqual(undo.depths, before.depths);
    applyTerrainUndoPatches(world, patches); assert.deepEqual((await build()).depths, after.depths);
    assert.deepEqual(doc.lake, source);
  });
  await check("terrain lake: clipped shore lies exactly on terrain and dry holes do not invalidate a basin", async () => {
    const doc = createLakeFixture(), geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    assert.ok(geometry.shore.length > 0);
    for (let i = 0; i < geometry.shore.length; i += 2) {
      const x = geometry.shore[i]! + geometry.position[0], z = geometry.shore[i + 1]! + geometry.position[2];
      assert.ok(Math.abs(terrainHeightAt(doc.def, { tile: (tx, tz) => doc.tiles.get(tileKey(tx, tz)) }, x, z)! - doc.lake.surfaceLevel) < 1e-5);
    }
    // Extend the domain over a real hole beyond a closed high rim.
    doc.def.tilesX = 3; doc.lake.bounds.max[0] = 96;
    assert.equal((await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake))).status, "ready");
    const mismatch = createLakeFixture(); mismatch.tiles.get("1_0")!.heights[16 * 65] = 0.1;
    await assert.rejects(prepareLakeSnapshot(mismatch, mismatch.lake), /seam mismatch/);
  });
  await check("terrain lake: runtime read rejects duplicate and unknown bodies, preserves invalid basin parameters", async () => {
    const { lake } = createLakeFixture();
    const layout = { schema: 1, name: "Lake", loadGroups: [], instances: [], characters: [], waterBodies: [lake] };
    assert.equal(readRoomLayout(layout, "lake").waterBodies![0]!.id, lake.id);
    assert.throws(() => readRoomLayout({ ...layout, waterBodies: [lake, lake] }, "lake"), /Duplicate/);
    assert.throws(() => readRoomLayout({ ...layout, waterBodies: [{ ...lake, appearance: { normalScale: Infinity } }] }, "lake"));
    assert.equal(validateWaterBody({ ...lake, surfaceLevel: -100000 }).surfaceLevel, -100000);
  });
  await check("terrain lake: cancelled publications and repeated lifecycle release geometry and helpers", async () => {
    const doc = createLakeFixture(), disk = new Map(doc.tiles); doc.tiles.clear();
    const scene = new Scene(); let release = () => {}; let entered = false;
    const controller = new LakeWaterController({ scene, editor: true, document: () => doc,
      load: async (_id, key) => { if (!entered) { entered = true; await new Promise<void>((r) => { release = r; }); } return disk.get(key)!; }, normal: async () => null });
    const first = controller.rebuild([doc.lake]);
    while (!entered) await new Promise<void>((r) => setTimeout(r, 0));
    const second = controller.rebuild([{ ...doc.lake, surfaceLevel: 13 }]); release(); await first; await second;
    assert.equal(controller.results.get(doc.lake.id)!.position[1], 13); assert.equal(controller.objects.size, 1, controller.results.get(doc.lake.id)?.message);
    for (let i = 0; i < 20; i++) { await controller.rebuild([doc.lake]); await controller.rebuild([]); }
    assert.equal(controller.objects.size, 0); assert.equal(controller.helpers.children.length, 0); assert.equal(controller.results.size, 0);
    controller.dispose(); assert.equal(doc.tiles.size, 0);
  });
  await check("terrain lake: shared reflection leases survive independent River/Lake rebuilds and use exact planes", async () => {
    const registry = new WaterReflectionRegistry(), river = registry.acquire("water", 12, "medium"), lake = registry.acquire("water", 12, "medium");
    assert.equal(lake, river); assert.notEqual(registry.acquire("water", 12.0001, "medium"), lake); assert.equal(registry.size, 2);
    registry.release(river); assert.equal(registry.size, 2); registry.release(lake); assert.equal(registry.size, 1);
    const other = registry.acquire("water", 12.0001, "medium"); registry.release(other); registry.release(other); assert.equal(registry.size, 0);
  });
  await check("terrain lake: saddle diagonal and level-equal plateau never connect point-touching pools", async () => {
    const base = createLakeFixture(), def: WorldTerrainDef = { ...base.def, tilesX: 1, tilesZ: 1, tileQuads: 32, origin: [0, 7, 0], tiles: [{ key: "0_0", minHeight: 0, maxHeight: 6 }] };
    const tile = createFlatTerrainTile(def, 0, 0); tile.heights.fill(6);
    tile.heights[15 * 33 + 15] = 0; tile.heights[16 * 33 + 16] = 0;
    const doc = { def, tiles: new Map([["0_0", tile]]) };
    const lake = { ...base.lake, seed: [15.25, 15.25] as [number, number], surfaceLevel: 12, bounds: { min: [0, 0] as [number, number], max: [32, 32] as [number, number] } };
    const result = await buildLakeGeometry(await prepareLakeSnapshot(doc, lake));
    assert.equal(result.status, "ready"); assert.equal(result.escapeLevel, 13);
    assert.equal(terrainHeightAt(def, { tile: () => tile }, 15.5, 15.5), 13);
    for (let i = 0; i < result.depths.length; i++) assert.equal(result.positions[i * 3]! + 16 > 15.6 && result.positions[i * 3 + 2]! + 16 > 15.6, false);
    for (let i = 0; i < result.indices.length; i += 3) {
      const ids = [result.indices[i]!, result.indices[i + 1]!, result.indices[i + 2]!];
      const x = ids.reduce((s, v) => s + result.positions[v * 3]!, 0) / 3 + 16;
      const z = ids.reduce((s, v) => s + result.positions[v * 3 + 2]!, 0) / 3 + 16;
      const interpolated = ids.reduce((s, v) => s + result.depths[v]!, 0) / 3;
      assert.ok(Math.abs(interpolated - (12 - terrainHeightAt(def, { tile: () => tile }, x, z)!)) < 1e-5);
    }
    for (const level of [13 - 1e-5, 13, 13 + 1e-5]) assert.equal((await buildLakeGeometry(await prepareLakeSnapshot(doc, { ...lake, surfaceLevel: level }))).status, "open-boundary");
    // A one-cell-wide preview must not confuse its diagonal with a horizontal edge.
    const narrow = { ...lake, bounds: { min: [15, 0] as [number, number], max: [16, 32] as [number, number] } };
    const thin = await buildLakeGeometry(await prepareLakeSnapshot(doc, narrow));
    assert.equal(thin.status, "open-boundary");
    for (let i = 0; i < thin.depths.length; i++) {
      const x = thin.positions[i * 3]! + thin.position[0], z = thin.positions[i * 3 + 2]! + thin.position[2];
      assert.ok(Math.abs(thin.depths[i]! - Math.max(0, 12 - terrainHeightAt(def, { tile: () => tile }, x, z)!)) < 1e-4);
    }
  });
  await check("terrain lake: independent 2x1 basin welds its seam without inventing shoreline", async () => {
    const base = createLakeFixture(), def: WorldTerrainDef = { ...base.def, tilesZ: 1, origin: [-64, 10, -32], tiles: [] };
    const tiles = new Map<string, ReturnType<typeof createFlatTerrainTile>>();
    for (let tx = 0; tx < 2; tx++) {
      const tile = createFlatTerrainTile(def, tx, 0);
      for (let z = 0; z <= 64; z++) for (let x = 0; x <= 64; x++) tile.heights[z * 65 + x] = Math.min(6, Math.max(0, Math.max(Math.abs(tx * 64 + x - 64) / 1.5, Math.abs(z - 32)) - 12) * 0.5);
      const key = tileKey(tx, 0); tiles.set(key, tile); def.tiles.push({ key, minHeight: 0, maxHeight: 6 });
    }
    const lake = { ...base.lake, seed: [-12, -8] as [number, number], bounds: { min: [-48, -24] as [number, number], max: [48, 24] as [number, number] } };
    const result = await buildLakeGeometry(await prepareLakeSnapshot({ def, tiles }, lake));
    assert.equal(result.status, "ready"); assert.ok(result.positions.some((v, i) => i % 3 === 0 && v < 0));
    assert.ok(result.positions.some((v, i) => i % 3 === 0 && v > 0));
    for (let i = 0; i < result.shore.length; i += 4) assert.equal(Math.abs(result.shore[i]!) < 1e-6 && Math.abs(result.shore[i + 2]!) < 1e-6, false);
  });
}
