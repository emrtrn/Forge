import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMacroRelief, type MacroReliefOptions } from "../../engine/worldbuilder/macroRelief";
import { normalizeWorldRecipe } from "../../engine/worldbuilder/recipe";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { decodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { worldTerrainColliderEntities } from "../../engine/terrain/worldTerrainActor";
import { RIDGEBOUND_SOURCE_SHA256 } from "../../tools/world/ridgeboundSpatial";
import { RIDGEBOUND_HEIGHTMAP_SHA256 } from "../../tools/world/ridgeboundTerrain";
import { buildRidgeboundReliefCandidate, RIDGEBOUND_RELIEF_REF } from "../../tools/world/ridgeboundRelief";

export async function registerMacroReliefTests(check: (label: string, fn: () => Promise<void>) => Promise<void>) {
  await check("macro relief: global determinism, masks, bounds and invalid parameter rejection", async () => {
    const config: MacroReliefOptions = { seed: 42, amplitude: 140, wavelength: 300, directionDegrees: 15,
      bounds: { min: [-1000, -1000], max: [1000, 1000] }, edgeFade: 50,
      protections: [{ id: "river", source: { kind: "polyline", points: [[0, -900], [0, 900]], radii: [25, 25] }, falloff: 100 },
        { id: "site", source: { kind: "point", position: [400, 400], radius: 60 }, falloff: 80 }] };
    const first = createMacroRelief(config), second = createMacroRelief(config);
    for (let z = -900; z <= 900; z += 18) {
      assert.equal(first.displacementAt(0, z), 0);
      // Neighbour tiles evaluate a shared world-space edge without a local seed/phase.
      assert.equal(first.displacementAt(384, z), second.displacementAt(384, z));
      assert.ok(first.displacementAt(384, z) >= 0 && first.displacementAt(384, z) <= config.amplitude);
    }
    assert.equal(first.displacementAt(400, 400), 0);
    assert.equal(first.displacementAt(1001, 0), 0);
    assert.equal(first.displacementAt(-1000, 0), 0);
    const at = first.displacementAt(600, 300);
    assert.ok(at > 0);
    assert.notEqual(at, createMacroRelief({ ...config, seed: 43 }).displacementAt(600, 300));
    config.protections[0]!.falloff = 1000;
    assert.equal(first.displacementAt(600, 300), at, "factory snapshots caller-owned data");
    assert.ok(first.weightAt(25.01, 100) < 1e-6, "smooth transition beside the protected footprint");
    assert.throws(() => createMacroRelief({ ...config, wavelength: 0 }));
    assert.throws(() => createMacroRelief({ ...config, amplitude: Infinity }));
    assert.throws(() => createMacroRelief({ ...config, seed: 0.5 }));
    assert.throws(() => createMacroRelief({ ...config, edgeFade: 0 }));
    assert.throws(() => createMacroRelief({ ...config, protections: [{ id: "bad", source: { kind: "point", position: [NaN, 0] }, falloff: 1 }] }));
    assert.throws(() => first.displacementAt(NaN, 0));
  });
  await check("ridgebound relief: reproducible bytes, protected source codes, seamless tiles, collider and no authored generation", async () => {
    const png = readFileSync("tests/engine/fixtures/ridgebound-valley-heightfield-v0.2.png");
    const master = JSON.parse(readFileSync("tests/engine/fixtures/ridgebound-spatial-master-v0.2.json", "utf8"));
    const before = JSON.stringify(master), pngBefore = png.slice();
    const build = () => buildRidgeboundReliefCandidate(master, RIDGEBOUND_SOURCE_SHA256, png, RIDGEBOUND_HEIGHTMAP_SHA256);
    const a = await build(), b = await build();
    assert.equal(JSON.stringify(master), before);
    assert.deepEqual(png, pngBefore);
    for (const [path, bytes] of a.files) assert.deepEqual(bytes, b.files.get(path), path);
    assert.ok(a.report.operation.changedVertices > 20000);
    assert.ok(a.report.operation.maxAddedMetres > 60);
    assert.ok(a.report.operation.maxAddedMetres <= a.config.amplitude + 750 / 65535);
    const relief = createMacroRelief(a.config), width = 513;
    let largest = 0, largestIndex = 0;
    for (let i = 0; i < a.samples.length; i++) {
      const x = 1536 + (i % width) * 6, z = 4224 + Math.floor(i / width) * 6;
      const delta = a.samples[i]! - a.baseSamples[i]!;
      if (relief.weightAt(x, z) === 0) assert.equal(delta, 0, `protected source code at ${x}/${z}`);
      if (delta > largest) { largest = delta; largestIndex = i; }
    }
    for (const c of a.report.groundCheckpoints) assert.equal(c.delta, 0, c.id);
    const { def, tiles } = a.world;
    const decoded = new Map([...tiles.keys()].map(key => [key, decodeTerrainTile(a.files.get(terrainTilePath(RIDGEBOUND_RELIEF_REF, key))!)]));
    for (const tile of decoded.values()) {
      const east = decoded.get(`${tile.x + 1}_${tile.z}`), south = decoded.get(`${tile.x}_${tile.z + 1}`);
      for (let i = 0; i <= 64; i++) {
        if (east) assert.equal(tile.heights[i * 65 + 64], east.heights[i * 65]);
        if (south) assert.equal(tile.heights[64 * 65 + i], south.heights[i]);
      }
      assert.deepEqual(tile.heights, tiles.get(`${tile.x}_${tile.z}`)!.heights);
    }
    assert.equal(decodeTerrainGlobalMap(a.files.get(terrainGlobalMapPath(RIDGEBOUND_RELIEF_REF))!).tilesX, 8);
    assert.equal(normalizeWorldRecipe(a.recipe).issues.length, 0);
    assert.equal(a.level.instances?.length, 0);
    assert.equal(a.recipe.plan.landmarks.some(p => p.id === "POI-07"), false);
    const physics = new PhysicsSubsystem();
    physics.setEntities(worldTerrainColliderEntities({ id: "candidate", name: "Candidate", collision: true }, a.world));
    // Probe within a changed cell, not merely an unchanged checkpoint or grid vertex.
    const x = 1536 + (largestIndex % width) * 6 + 1, z = 4224 + Math.floor(largestIndex / width) * 6 + 1;
    const expected = terrainHeightAt(def, { tile: (x, z) => decoded.get(`${x}_${z}`) }, x, z)!;
    let actual: number | null = null;
    for (const { a: p, b: q, c: r } of physics.staticSurfaceTrianglesNear(x, z)) {
      const det = (q[2] - r[2]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[2] - r[2]);
      const wa = ((q[2] - r[2]) * (x - r[0]) + (r[0] - q[0]) * (z - r[2])) / det;
      const wb = ((r[2] - p[2]) * (x - r[0]) + (p[0] - r[0]) * (z - r[2])) / det;
      if (wa >= -1e-8 && wb >= -1e-8 && wa + wb <= 1 + 1e-8) { actual = wa * p[1] + wb * q[1] + (1 - wa - wb) * r[1]; break; }
    }
    assert.ok(actual !== null && Math.abs(actual - expected) < 1e-4, `physics ${actual}, terrain ${expected}`);
    master.hydrology["H-01"].riverx = "throw new Error('never execute')";
    await assert.rejects(() => build(), /Unsupported H-01/);
  });
}
