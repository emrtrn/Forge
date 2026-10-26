import assert from "node:assert/strict";
import { buildRiverWaterRibbon, createRiverWaterObject } from "../../engine/render-three/riverWater";
import { resolveRiverWater } from "../../engine/scene/riverWater";
import { applyTerrainUndoPatches, createTerrainEditWorld, revertTerrainUndoPatches } from "../../engine/terrain/terrainEdit";
import { terrainHeightAt, terrainHeightAtSmooth } from "../../engine/terrain/terrainHeightQuery";
import { prepareTerrainRiverWaterSource } from "../../engine/terrain/terrainRiverWater";
import { createTerrainSplinePatches } from "../../engine/terrain/terrainSplines";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { validateRiverWater } from "../../tools/saveValidator";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
function fixture() {
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "River", tileQuads: 32, spacing: 1,
    tilesX: 4, tilesZ: 2, origin: [1000000.25, 7.5, -1000000.75], heightMin: -64, heightMax: 64,
    collision: true, layers: [{ id: "mud", name: "Mud", color: "#554433" }], tiles: [] };
  const tiles = new Map<string, TerrainTileData>();
  for (let z = 0; z < 2; z++) for (let x = 0; x < 4; x++) {
    const tile = createFlatTerrainTile(def, x, z);
    tiles.set(tileKey(x, z), tile); def.tiles.push({ key: tileKey(x, z), minHeight: 0, maxHeight: 0 });
  }
  def.splines = [{ id: "river", coordinateSpace: "world", points: [8, 32, 56].map((x, i) => ({
    id: String(i), position: [def.origin[0] + x, 7.5, def.origin[2] + 16], width: 6, falloff: 3,
  })), segments: [0, 1].map((i) => ({ id: `s${i}`, startPointId: String(i), endPointId: String(i + 1),
    deform: { enabled: true, flatten: true, raiseTerrain: true, lowerTerrain: true, targetOffset: -2 } })) }];
  const water = resolveRiverWater({ id: "water", landscapeRef: "terrain", splineRef: "river", coordinateSpace: "world", surfaceLevel: 9,
    segmentProfiles: [{ splineSegmentRef: "s1", flowSpeedMultiplier: 2, rapidness: 0.8 }],
    foamStamps: [{ id: "ring", kind: "point", position: [def.origin[0] + 32, 9, def.origin[2] + 16], radius: 2, intensity: 0.5 }] });
  return { def, tiles, water };
}

export async function registerTerrainRiverWaterTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain river: world height, exact triangle depth, flow and foam share a stable local frame", async () => {
    const doc = fixture(), before = structuredClone(doc.def);
    // Saddle cell separates the exact triangle height from bilinear interpolation.
    doc.tiles.get("0_0")!.heights[17 * 33 + 17] = 4;
    const source = await prepareTerrainRiverWaterSource(doc, doc.water);
    assert.equal(source.surfaceLevel, 1.5);
    assert.equal(source.heightAt(-47.75, -15.75), 0);
    const lookup = { tile: (x: number, z: number) => doc.tiles.get(tileKey(x, z)) };
    assert.notEqual(terrainHeightAt(doc.def, lookup, doc.def.origin[0] + 16.25, doc.def.origin[2] + 16.25),
      terrainHeightAtSmooth(doc.def, lookup, doc.def.origin[0] + 16.25, doc.def.origin[2] + 16.25));
    const ribbon = buildRiverWaterRibbon(source.spline, { ...source, widthScale: doc.water.widthScale, segmentProfiles: doc.water.segmentProfiles });
    assert.ok(ribbon.positions.every((p) => Math.abs(p) < 100), "million-metre origin stays out of Float32 geometry");
    assert.ok(ribbon.flowSpeedMultipliers.includes(2)); assert.ok(ribbon.rapidness.includes(0.8));
    for (let i = 0; i < ribbon.waterDepths.length; i++) {
      const height = source.heightAt(ribbon.positions[i * 3]!, ribbon.positions[i * 3 + 2]!);
      assert.equal(ribbon.waterDepths[i], Math.max(0, source.surfaceLevel - height!));
      assert.equal(ribbon.flowDirections[i * 2], 1); assert.equal(ribbon.flowDirections[i * 2 + 1], 0);
    }
    assert.deepEqual(source.foamStamps[0]!.position, [-32, 1.5, -16]);
    const object = createRiverWaterObject({ ...doc.water, ...source, foamNoiseMap: null }, null);
    assert.equal(object.position.y + object.geometry.getAttribute("position").getY(0), 9);
    assert.equal(object.children[0]!.position.x, -32); object.dispose();
    assert.deepEqual(doc.def, before);
  });

  await checkAsync("terrain river: corridor reads are bounded, failures are atomic and retry leaves residency unchanged", async () => {
    const doc = fixture(), disk = new Map(doc.tiles); doc.tiles.clear();
    const requested: string[] = []; let active = 0, peak = 0;
    const source = await prepareTerrainRiverWaterSource(doc, doc.water, async (key) => {
      requested.push(key); active++; peak = Math.max(peak, active);
      await Promise.resolve(); active--; return disk.get(key)!;
    });
    assert.deepEqual(requested.sort(), ["0_0", "1_0"]); assert.ok(peak <= 4);
    assert.equal(doc.tiles.size, 0); assert.equal(source.heightAt(-32, -16), 0);
    await assert.rejects(prepareTerrainRiverWaterSource(doc, doc.water), /requires terrain tile/);
    await assert.rejects(prepareTerrainRiverWaterSource(doc, doc.water, async () => { throw new Error("HTTP 503"); }), /HTTP 503/);
    const retry = await prepareTerrainRiverWaterSource(doc, doc.water, async (key) => disk.get(key)!);
    assert.equal(retry.heightAt(-32, -16), 0); assert.equal(doc.tiles.size, 0);
  });

  await checkAsync("terrain river: real holes clip the ribbon without inventing a bed or bridging gaps", async () => {
    const doc = fixture(); doc.def.tiles = doc.def.tiles.filter(({ key }) => key !== "1_0"); doc.tiles.delete("1_0");
    const source = await prepareTerrainRiverWaterSource(doc, doc.water);
    assert.equal(source.heightAt(-16, -16), null);
    const ribbon = buildRiverWaterRibbon(source.spline, { ...source, widthScale: 1 });
    assert.ok(ribbon.indices.length > 0);
    for (const index of ribbon.indices) assert.notEqual(source.heightAt(ribbon.positions[index * 3]!, ribbon.positions[index * 3 + 2]!), null);
    assert.ok(ribbon.indices.every((i) => ribbon.positions[i * 3]! <= -32), "no triangles cross into the missing half");
  });

  await checkAsync("terrain river: bed bake and exact undo/redo refresh depth on both sides of a seam", async () => {
    const doc = fixture(); const world = createTerrainEditWorld(doc.def, doc.tiles.values());
    const document = { def: world.def, tiles: world.tiles };
    const depths = async () => { const source = await prepareTerrainRiverWaterSource(document, doc.water);
      return [-32.25, -31.75].map((x) => source.surfaceLevel - source.heightAt(x, -16)!); };
    const before = await depths(); assert.deepEqual(before, [1.5, 1.5]);
    const spline = world.def.splines![0]!;
    const patches = createTerrainSplinePatches(world, { ...spline, coordinateSpace: "world" }, "deform");
    applyTerrainUndoPatches(world, patches); const baked = await depths(); assert.deepEqual(baked, [3.5, 3.5]);
    revertTerrainUndoPatches(world, patches); assert.deepEqual(await depths(), before);
    applyTerrainUndoPatches(world, patches); assert.deepEqual(await depths(), baked);
  });

  await checkAsync("terrain river: coordinate marker survives save validation and legacy local height stays unchanged", async () => {
    const doc = fixture();
    const saved = validateRiverWater(doc.water);
    assert.equal(saved.coordinateSpace, "world"); assert.equal(saved.surfaceLevel, 9);
    assert.throws(() => validateRiverWater({ ...doc.water, coordinateSpace: "guess" }), /coordinateSpace/);
    const { coordinateSpace: _space, ...legacy } = doc.water;
    const source = await prepareTerrainRiverWaterSource(doc, legacy);
    assert.equal(source.surfaceLevel, 9); assert.deepEqual(source.foamStamps, legacy.foamStamps);
    assert.equal(validateRiverWater(legacy).coordinateSpace, undefined);
  });
}
