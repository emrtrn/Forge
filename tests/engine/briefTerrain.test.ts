/**
 * Macro terrain and water beds of a world brief (`engine/worldbuilder/briefTerrain.ts`,
 * pilot step 3a): any number of valleys, unevenly spaced sections, water lines
 * that need not follow the sections, and the relief block of the brief.
 */
import assert from "node:assert/strict";
import { createBriefTerrain } from "../../engine/worldbuilder/briefTerrain";
import { normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";

type Check = (label: string, run: () => void) => void;

const FLOOR = 50;
const SLOPE_DEG = 20;

function valley(id: string, floor: [number, number], rock: [number, number], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, axis: "northSouth", sideSlopeDeg: SLOPE_DEG,
    floorProfile: [{ north: 200, elevation: FLOOR }, { north: -200, elevation: FLOOR }],
    // Uneven spacing on purpose: 150 m, then 250 m.
    sections: [200, 50, -200].map((north) => ({ north, floor, rock })),
    ...extra,
  };
}

function brief(patch: Record<string, unknown>): WorldBrief {
  const result = normalizeWorldBrief({
    schema: 1, type: "worldBrief", id: "terrain-test", seed: 7,
    area: { west: -300, east: 300, south: -300, north: 300 },
    terrain: { id: "ground", name: "Ground", tileQuads: 64, spacing: 2, heightRange: [0, 400] },
    ...patch,
  });
  assert.deepEqual(result.issues, []);
  return result.brief!;
}

export function registerBriefTerrainTests(check: Check): void {
  check("brief terrain: two valleys meet at a ridge and each point belongs to the lower one", () => {
    const terrain = createBriefTerrain(brief({
      valleys: [valley("west", [-110, -70], [-250, 40]), valley("east", [70, 110], [-40, 250])],
    }));
    const westFloor = terrain.ground(-90, 0);
    const eastFloor = terrain.ground(90, 0);
    const ridge = terrain.ground(0, 0);
    assert.ok(Math.abs(westFloor - FLOOR) < 0.5 && Math.abs(eastFloor - FLOOR) < 0.5, `floors ${westFloor} ${eastFloor}`);
    assert.ok(ridge > FLOOR + 15, `ridge ${ridge}`);
    assert.equal(terrain.valleyAt(-90, 0)!.valleyId, "west");
    assert.equal(terrain.valleyAt(90, 0)!.valleyId, "east");
    assert.equal(terrain.valleyAt(-90, 0)!.slopeDistance, 0);
  });

  check("brief terrain: unevenly spaced sections and a closed valley end", () => {
    const terrain = createBriefTerrain(brief({ valleys: [valley("v", [-40, 40], [-200, 200])] }));
    for (const z of [-180, -60, 0, 120, 190]) {
      assert.ok(Math.abs(terrain.ground(0, z) - FLOOR) < 0.5, `floor at z ${z}: ${terrain.ground(0, z)}`);
    }
    // North 200 is world z -200: past it the valley closes and the ground rises.
    assert.ok(terrain.ground(0, -280) > FLOOR + 10, `head wall ${terrain.ground(0, -280)}`);
  });

  check("brief terrain: with no relief the slope is the plain valley shape", () => {
    const terrain = createBriefTerrain(brief({
      valleys: [valley("v", [-40, 40], [-280, 280], { relief: { slopeFoot: 10, spurs: 0, ridges: 0, noise: 0 } })],
    }));
    const out = 100;
    const expected = FLOOR + Math.tan(SLOPE_DEG * Math.PI / 180) * (Math.hypot(out, 10) - 10);
    assert.ok(Math.abs(terrain.ground(40 + out, 0) - expected) < 1e-9, `${terrain.ground(40 + out, 0)} vs ${expected}`);
    const roughened = createBriefTerrain(brief({ valleys: [valley("v", [-40, 40], [-280, 280])] }));
    assert.notEqual(roughened.ground(40 + out, 0), expected, "the default relief roughens the slope");
  });

  check("brief terrain: a water line off the sections carves its bed and never flows uphill", () => {
    const terrain = createBriefTerrain(brief({
      valleys: [valley("v", [-60, 60], [-250, 250])],
      // Listed from south to north, so it runs against the floor profile's fall: the level stays flat.
      water: [{ id: "creek", kind: "river", line: [[-20, -150], [25, 10], [-10, 170]], width: 6, bedDepth: 1.5, surfaceDepth: 0.6 }],
    }));
    const [course] = terrain.courses;
    assert.ok(course && course.points.length > 100, "a dense centreline");
    assert.equal(course.anchors.length, 3);
    course.surface.slice(1).forEach((level, index) => assert.ok(level <= course.surface[index]!, "never uphill"));
    for (const anchor of course.anchors) {
      const [x, z] = course.points[anchor]!;
      assert.ok(terrain.height(x, z) < course.surface[anchor]!, `bed below the water at ${x}, ${z}`);
      assert.ok(terrain.height(x + 20, z) > course.surface[anchor]!, `bank above the water at ${x + 20}, ${z}`);
      assert.ok(terrain.height(x, z) <= terrain.ground(x, z), "carving only lowers the ground");
    }
    const hit = terrain.water(25, -10)!;
    assert.equal(hit.course.id, "creek");
    assert.ok(hit.distance < 1);
    assert.equal(terrain.water(250, 250), null, "out of reach");
    assert.equal(terrain.height(200, 0), terrain.ground(200, 0), "far from water the ground is untouched");
  });

  check("brief terrain: a lake carves its bed below a level the ground around it holds in", () => {
    // A tilted plain: the ring's lowest ground is on the low (south, +z) side.
    const shore: Array<[number, number]> = Array.from({ length: 12 }, (_, i) => [60 * Math.cos(i * Math.PI / 6), 60 * Math.sin(i * Math.PI / 6)]);
    const terrain = createBriefTerrain(brief({
      valleys: [valley("v", [-280, 280], [-290, 290], { floorProfile: [{ north: 300, elevation: 60 }, { north: -300, elevation: 30 }] })],
      water: [{ id: "tarn", kind: "lake", polygon: shore, bedDepth: 3 }],
    }));
    assert.deepEqual(terrain.deferred, []);
    const [lake] = terrain.lakes;
    assert.ok(lake && lake.depth === 3);
    // Every ring point out to the transition stands at or above the water.
    for (let i = 0; i < 72; i += 1) {
      const angle = i * Math.PI / 36;
      for (const reach of [61, 68, 75]) {
        const [x, z] = [reach * Math.cos(angle), reach * Math.sin(angle)];
        assert.ok(terrain.height(x, z) >= lake.surface - 1e-9, `ring at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
    }
    assert.ok(Math.abs(terrain.height(0, 0) - (lake.surface - 3)) < 1e-9, "full depth in the middle");
    assert.ok(terrain.height(0, 0) <= terrain.ground(0, 0), "carving only lowers the ground");
    assert.ok(terrain.lake(0, 0)!.inside > 50 && terrain.lake(0, 200) === null);
    assert.equal(terrain.height(0, 200), terrain.ground(0, 200), "far from the lake the ground is untouched");
    assert.throws(() => createBriefTerrain(brief({ water: [{ id: "dry", kind: "river", line: [[0, 0], [0, 50]], width: 4 }] })),
      /dry needs width, bedDepth and surfaceDepth/);
  });

  check("brief terrain: the same brief builds the same ground", () => {
    const input = brief({
      valleys: [valley("v", [-40, 40], [-200, 200])],
      water: [{ id: "r", kind: "river", line: [[0, 200], [0, -200]], width: 8, bedDepth: 2, surfaceDepth: 1 }],
    });
    const [a, b] = [createBriefTerrain(input), createBriefTerrain(input)];
    for (const [x, z] of [[0, 0], [3, 7], [90, -120], [-160, 150]] as const) assert.equal(a.height(x, z), b.height(x, z));
  });

  check("brief terrain: the brief rejects unknown valley and relief fields", () => {
    const issues = (patch: Record<string, unknown>): string => normalizeWorldBrief({
      schema: 1, type: "worldBrief", id: "t", seed: 1,
      area: { west: -300, east: 300, south: -300, north: 300 },
      terrain: { id: "g", name: "G", tileQuads: 64, spacing: 1, heightRange: [0, 10] },
      valleys: [valley("v", [-40, 40], [-200, 200], patch)],
    }).issues.join();
    assert.match(issues({ width: 3 }), /valleys\[0\]\.width: is not a valley field/);
    assert.match(issues({ relief: { bumps: 3 } }), /relief\.bumps: is not a relief field/);
    assert.match(issues({ relief: { spurs: -1 } }), /relief\.spurs/);
    const kept = brief({ valleys: [valley("v", [-40, 40], [-200, 200], { relief: { spurs: 4 } })] });
    assert.deepEqual(kept.valleys[0]!.relief, { spurs: 4 });
  });
}
