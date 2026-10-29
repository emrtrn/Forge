import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEUTRAL_SURFACE_SAMPLE, resolveSurfaceSample } from "../../engine/physics/surface/surfaceResponse";
import { normalizeWorldTerrain } from "../../engine/terrain/terrainDefinition";
import { TerrainSurfaceSampler, worldTerrainSurfaceSource } from "../../engine/terrain/terrainSurface";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import {
  generateOffroadTestWorld, offroadTestFixtureFile, offroadTestLevel, OFFROAD_TEST_LEVEL, OFFROAD_TEST_START, OFFROAD_TEST_TERRAIN,
} from "../../tools/world/offroadTestWorld";

type Check = (label: string, fn: () => void) => void;

export function registerOffroadTestWorldTests(check: Check): void {
  check("offroad test level: committed files match the generator (rerun npm run world:offroad)", () => {
    const world = generateOffroadTestWorld();
    const read = (path: string) => readFileSync(offroadTestFixtureFile(path));
    assert.deepEqual(normalizeWorldTerrain(JSON.parse(read(OFFROAD_TEST_TERRAIN).toString("utf8"))), world.def);
    for (const [key, bytes] of world.tileBytes) {
      assert.ok(read(terrainTilePath(OFFROAD_TEST_TERRAIN, key)).equals(bytes), `tile ${key}`);
    }
    assert.ok(read(terrainGlobalMapPath(OFFROAD_TEST_TERRAIN)).equals(world.globalBytes), "global map");
    assert.deepEqual(JSON.parse(read(OFFROAD_TEST_LEVEL).toString("utf8")), offroadTestLevel(world, OFFROAD_TEST_TERRAIN));
  });

  check("offroad test level: the road from the start crosses mud, snow and sand; fields and road are neutral", () => {
    const world = generateOffroadTestWorld();
    const sampler = new TerrainSurfaceSampler(worldTerrainSurfaceSource(world)!);
    const at = (x: number, z: number) => sampler.sampleAt([x, 0, z]);
    assert.deepEqual(at(...OFFROAD_TEST_START), NEUTRAL_SURFACE_SAMPLE, "the car starts on plain road");
    assert.deepEqual(at(0, -50), resolveSurfaceSample("mud"));
    assert.deepEqual(at(0, 10), resolveSurfaceSample("snow"));
    assert.deepEqual(at(0, 70), resolveSurfaceSample("sand"));
    assert.deepEqual(at(0, -20), NEUTRAL_SURFACE_SAMPLE, "road between patches");
    assert.deepEqual(at(60, -50), NEUTRAL_SURFACE_SAMPLE, "grass field beside a patch");
    const edge = at(0, -71.5)!;
    assert.ok(edge.frictionSlipScale < 1 && edge.frictionSlipScale > resolveSurfaceSample("mud").frictionSlipScale, "patch edges blend");
  });
}
