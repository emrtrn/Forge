import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { cropHeightmapSamples, heightmapWindowForBounds } from "../../engine/terrain/heightmapWindow";
import { exportRawHeightmap, rawHeightmapToSamples } from "../../engine/terrain/terrainImport";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { decodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { worldTerrainColliderEntities } from "../../engine/terrain/worldTerrainActor";
import { terrainTilePath, terrainGlobalMapPath } from "../../engine/terrain/terrainTypes";
import { RIDGEBOUND_SOURCE_SHA256 } from "../../tools/world/ridgeboundSpatial";
import { buildRidgeboundTerrainPreview, RIDGEBOUND_HEIGHTMAP_SHA256, RIDGEBOUND_TERRAIN_REF } from "../../tools/world/ridgeboundTerrain";

export async function registerRidgeboundTerrainTests(check: (label: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check("heightmap window: preserves a non-square source lattice and refuses border invention", async () => {
    const source = { width: 193, height: 129, spacing: 6, origin: [100, -200] as const };
    const window = heightmapWindowForBounds(source, { min: [500, -100], max: [700, 100] }, 64, 0);
    assert.deepEqual(window, { x: 64, z: 0, width: 65, height: 65, tilesX: 1, tilesZ: 1 });
    const samples = Uint16Array.from({ length: source.width * source.height }, (_, i) => i);
    const before = samples.slice();
    const crop = cropHeightmapSamples(source, samples, window);
    assert.equal(crop[0], samples[64]);
    assert.equal(crop[64], samples[128]);
    assert.equal(crop[65], samples[193 + 64]);
    assert.equal(crop.at(-1), samples[64 * 193 + 128]);
    assert.deepEqual(samples, before);
    assert.throws(() => heightmapWindowForBounds(source, { min: [100, -200], max: [200, -100] }, 64, 100), /leaves the source/);
    assert.throws(() => heightmapWindowForBounds(source, { min: [NaN, 0], max: [1, 1] }, 64, 0));
    assert.throws(() => cropHeightmapSamples(source, new Uint16Array(1), window));
    assert.throws(() => heightmapWindowForBounds(source, { min: [0, 0], max: [1, 1] }, 63, 0));
  });
  await check("ridgebound terrain: real source crop has exact codes, 24 seamless tiles, north/datum and collision", async () => {
    const png = readFileSync("tests/engine/fixtures/ridgebound-valley-heightfield-v0.2.png");
    const master = JSON.parse(readFileSync("tests/engine/fixtures/ridgebound-spatial-master-v0.2.json", "utf8"));
    assert.equal(createHash("sha256").update(png).digest("hex"), RIDGEBOUND_HEIGHTMAP_SHA256);
    const result = await buildRidgeboundTerrainPreview(master, RIDGEBOUND_SOURCE_SHA256, png, RIDGEBOUND_HEIGHTMAP_SHA256);
    const { def, tiles } = result.world;
    assert.deepEqual([def.tilesX, def.tilesZ, def.tileQuads, def.spacing], [8, 3, 64, 6]);
    assert.deepEqual(def.origin, [1536, 0, 4224]);
    assert.deepEqual(result.report.grid.extent, [3072, 1152]);
    assert.equal(tiles.size, 24);
    assert.equal(def.collision, true);
    const encoded = new Map([...tiles.keys()].map(key => [key, result.files.get(terrainTilePath(RIDGEBOUND_TERRAIN_REF, key))!]));
    assert.deepEqual(rawHeightmapToSamples(exportRawHeightmap(def, encoded)), result.croppedSamples);
    for (const tile of tiles.values()) {
      const east = tiles.get(`${tile.x + 1}_${tile.z}`), south = tiles.get(`${tile.x}_${tile.z + 1}`);
      for (let i = 0; i <= 64; i++) {
        if (east) assert.equal(tile.heights[i * 65 + 64], east.heights[i * 65]);
        if (south) assert.equal(tile.heights[64 * 65 + i], south.heights[i]);
      }
    }
    for (const [id, expected] of [["V0", 250.6], ["V1", 386.1], ["B1", 209.8]] as const) {
      const c = result.report.groundCheckpoints.find(c => c.id === id)!;
      assert.ok(Math.abs(c.worldHeight - expected) < 0.3, `${id}: ${c.worldHeight}`);
    }
    const reloaded = new Map([...encoded].map(([key, bytes]) => [key, decodeTerrainTile(bytes)]));
    const lookup = { tile: (x: number, z: number) => reloaded.get(`${x}_${z}`) };
    for (const c of result.report.groundCheckpoints) assert.equal(terrainHeightAt(def, lookup, c.x, c.z), c.worldHeight);
    const global = decodeTerrainGlobalMap(result.files.get(terrainGlobalMapPath(RIDGEBOUND_TERRAIN_REF))!, def);
    assert.equal(global.tilesX, 8);
    const entities = worldTerrainColliderEntities({ id: "pilot", name: "Pilot", collision: true }, result.world);
    assert.equal(entities.length, 24);
    const physics = new PhysicsSubsystem();
    physics.setEntities(entities);
    for (const c of result.report.groundCheckpoints) {
      let surface: number | null = null;
      for (const { a, b, c: p } of physics.staticSurfaceTrianglesNear(c.x, c.z)) {
        const det = (b[2] - p[2]) * (a[0] - p[0]) + (p[0] - b[0]) * (a[2] - p[2]);
        const wa = ((b[2] - p[2]) * (c.x - p[0]) + (p[0] - b[0]) * (c.z - p[2])) / det;
        const wb = ((p[2] - a[2]) * (c.x - p[0]) + (a[0] - p[0]) * (c.z - p[2])) / det;
        if (wa < -1e-8 || wb < -1e-8 || wa + wb > 1 + 1e-8) continue;
        surface = wa * a[1] + wb * b[1] + (1 - wa - wb) * p[1]; break;
      }
      assert.ok(surface !== null && Math.abs(surface - c.worldHeight) < 1e-4, `${c.id}: physics ${surface} vs terrain ${c.worldHeight}`);
    }
    assert.equal(result.recipe.plan.landmarks.some(p => p.id === "POI-07"), false);
    assert.equal(result.report.grid.sampling, "EXACT_U16_CROP_NO_RESAMPLING");
    assert.ok(!result.svg.includes("Arazi / yol yüzeyi / köprü / sürüş kabulü üretilmedi."));
  });
  await check("ridgebound terrain: corrupt raster, changed encoding and mismatched dimensions reject before output", async () => {
    const png = readFileSync("tests/engine/fixtures/ridgebound-valley-heightfield-v0.2.png");
    const master = JSON.parse(readFileSync("tests/engine/fixtures/ridgebound-spatial-master-v0.2.json", "utf8"));
    const changed = structuredClone(master); changed.terrain.u16_min_m = 0;
    await assert.rejects(() => buildRidgeboundTerrainPreview(changed, RIDGEBOUND_SOURCE_SHA256, png, RIDGEBOUND_HEIGHTMAP_SHA256), /encoding/);
    const damaged = png.slice(); damaged[50] = damaged[50]! ^ 1;
    await assert.rejects(() => buildRidgeboundTerrainPreview(master, RIDGEBOUND_SOURCE_SHA256, damaged, RIDGEBOUND_HEIGHTMAP_SHA256));
  });
}
