/**
 * Random world (docs/world-builder/RANDOM_WORLD_PLAN.md, step 2): choices
 * become a valid world brief, the same seed gives the same brief, settlements
 * stay apart and on the map (on the floor of a valley), the roads join every
 * settlement and the exits reach the map edge; the brief's relief keeps the
 * mountains off the settlements; a small world builds into villages; and
 * `world:random` writes the brief beside a new level.
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBriefTerrain } from "../../engine/worldbuilder/briefTerrain";
import {
  DEFAULT_REGION_PROFILE,
  LANDFORMS,
  randomWorldBrief,
  worldExtent,
  type RandomWorldOptions,
} from "../../engine/worldbuilder/randomWorld";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { briefToWorld, normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";
import { runRandomWorld } from "../../tools/world/randomWorldRun";
import { buildWorldFromBrief } from "../../tools/world/worldBriefBuild";

type Check = (label: string, run: () => void) => void;
type CheckAsync = (label: string, run: () => Promise<void>) => Promise<void>;

const OPTIONS: RandomWorldOptions = {
  id: "random_test",
  name: "Random Test",
  seed: 11,
  size: "small",
  landform: "mountains",
  mountainHeight: "medium",
  settlements: [{ type: "village" }, { type: "hamlet" }, { type: "hamlet" }],
  roads: "exits",
};

function brief(options: Partial<RandomWorldOptions> = {}): WorldBrief {
  const { brief: raw } = randomWorldBrief({ ...OPTIONS, ...options });
  const { brief: normalized, issues } = normalizeWorldBrief(structuredClone(raw));
  assert.deepEqual(issues, []);
  return normalized!;
}

export async function registerRandomWorldTests(check: Check, checkSlowAsync: CheckAsync): Promise<void> {
  check("random world: every landform and size gives a valid brief; the same seed the same brief", () => {
    for (const landform of LANDFORMS) {
      for (const size of ["small", "medium", "large"] as const) {
        const world = brief({ landform, size });
        assert.equal(world.area.east - world.area.west, worldExtent(size));
        assert.equal(world.terrain.spacing, 2);
        assert.equal(world.playerStart, undefined, "no player start: the level opens with a free camera");
      }
    }
    assert.deepEqual(randomWorldBrief(OPTIONS), randomWorldBrief(OPTIONS));
    assert.notDeepEqual(randomWorldBrief(OPTIONS).brief, randomWorldBrief({ ...OPTIONS, seed: 12 }).brief);
    assert.equal(brief().regionProfile, DEFAULT_REGION_PROFILE);
  });

  check("random world: settlements stay apart and on the map; a valley's sit on its floor", () => {
    for (const landform of LANDFORMS) {
      for (const seed of [1, 2, 3]) {
        const world = brief({ landform, seed, size: "medium" });
        assert.equal(world.settlements.length, 3, `${landform} ${seed}`);
        world.settlements.forEach((a, i) => {
          assert.ok(Math.abs(a.center[0]) < world.area.east && Math.abs(a.center[1]) < world.area.north);
          if (landform === "valley") {
            const sections = world.valleys[0]!.sections;
            const k = sections.findIndex((section, index) => index > 0 && section.north <= a.center[1]);
            const [s0, s1] = [sections[k - 1]!, sections[k]!];
            const t = (s0.north - a.center[1]) / (s0.north - s1.north);
            const [floorW, floorE] = [0, 1].map((side) => s0.floor[side]! + (s1.floor[side]! - s0.floor[side]!) * t);
            assert.ok(a.center[0] > floorW! && a.center[0] < floorE!, `${a.id} on the valley floor`);
          }
          world.settlements.slice(i + 1).forEach((b) => {
            assert.ok(Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) >= (a.radius! + b.radius!) * 0.9 + 60, `${a.id} apart from ${b.id}`);
          });
        });
      }
    }
    const crowded = randomWorldBrief({ ...OPTIONS, settlements: Array.from({ length: 12 }, () => ({ type: "town" as const })) });
    assert.ok(crowded.notes.some((note) => note.includes("no room")), "a settlement with no room is reported, not forced in");
  });

  check("random world: the roads join every settlement and the exits reach the map edge", () => {
    for (const roads of ["between", "exits"] as const) {
      const world = brief({ roads });
      const settlements = world.settlements.map((settlement) => settlement.id);
      const exits = world.roads.nodes.filter((node) => node.kind === "end");
      assert.equal(exits.length, roads === "exits" ? 2 : 0);
      assert.equal(world.roads.edges.length, settlements.length - 1 + exits.length);
      // Every settlement reaches every other one.
      const reached = new Set([settlements[0]!]);
      for (let pass = 0; pass < settlements.length; pass += 1) {
        for (const edge of world.roads.edges) if (reached.has(edge.from) || reached.has(edge.to)) [edge.from, edge.to].forEach((id) => reached.add(id));
      }
      for (const id of settlements) assert.ok(reached.has(id), `${id} is on the network`);
      for (const exit of exits) {
        const gap = Math.min(world.area.north - exit.at[1], world.area.east - exit.at[0], exit.at[1] - world.area.south, exit.at[0] - world.area.west);
        assert.ok(gap < 10, `${exit.id} at the edge`);
      }
    }
    const lone = randomWorldBrief({ ...OPTIONS, settlements: [{ type: "village" }], roads: "between" });
    assert.equal((lone.brief.roads as { edges: unknown[] }).edges.length, 1, "a lone settlement still gets a road in");
  });

  check("random world: the mountains stay off the settlements and the roads; hills roll everywhere", () => {
    const world = brief({ size: "medium" });
    const terrain = createBriefTerrain(world);
    const clear = world.terrain.relief!.clear;
    for (const settlement of world.settlements) {
      const [x, z] = briefToWorld(world, settlement.center);
      const reach = settlement.radius! + clear.settlements.inner - 8;
      // Inside the clear band only the softened hills remain.
      for (const [dx, dz] of [[0, 0], [reach, 0], [0, -reach], [-reach * 0.7, reach * 0.7]]) {
        assert.ok(Math.abs(terrain.ground(x + dx!, z + dz!)) < world.terrain.relief!.hills!.height, `${settlement.id} ground stays low`);
      }
    }
    let peak = -Infinity;
    for (let x = -1000; x <= 1000; x += 50) for (let z = -1000; z <= 1000; z += 50) peak = Math.max(peak, terrain.ground(x, z));
    assert.ok(peak > world.terrain.relief!.mountains!.height * 0.5, `mountains rise (${peak.toFixed(0)} m)`);
    assert.ok(peak < world.terrain.heightRange[1], "within the terrain's height range");
    const relief = normalizeWorldBrief({ ...randomWorldBrief(OPTIONS).brief, terrain: { ...world.terrain, relief: { hills: { height: 5, wavelength: 100, steep: true } } } });
    assert.ok(relief.issues.some((issue) => issue.includes("terrain.relief.hills.steep")), "an unknown relief field is reported");
  });

  check("random world: a small mountain world builds into villages joined by roads", () => {
    const world = brief();
    const profile = normalizeRegionProfile(JSON.parse(readFileSync(`public/${world.regionProfile}`, "utf8"))).profile;
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
    const byPath = new Map(manifest.assets.map((asset) => [asset.path, asset.id]));
    const built = buildWorldFromBrief({ brief: world, levelPath: "assets/trial/Random.level.json", profile, assetIdForFile: (file) => byPath.get(file) ?? null });
    for (const plan of built.stages) assert.deepEqual(plan.errors, [], plan.stageId);
    const roads = (built.def.splines ?? []).filter((spline) => spline.id.startsWith("wb-road-"));
    assert.equal(roads.length, world.roads.edges.length, "every planned road was built");
    const buildings = built.layout.instances.flatMap((group) => group.placements).filter((placement) => placement.role?.startsWith("building."));
    assert.ok(buildings.length >= 20, `${buildings.length} buildings`);
    for (const settlement of world.settlements) {
      assert.ok(built.recipe.generated.parcels.some((parcel) => parcel.settlement === settlement.id), `${settlement.id} has parcels`);
    }
    assert.equal(built.layout.instances.some((group) => group.assetId === "marker:playerStart"), false);
  });

  await checkSlowAsync("random world: world:random writes the brief beside a new level and refuses to overwrite it", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-random-world-"));
    try {
      for (const path of ["project.3dgame.json", "assets/manifest.json", DEFAULT_REGION_PROFILE]) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        cpSync(join("public", path), join(root, path));
      }
      const options = { root, out: "assets/worlds/Hills.level.json", world: { ...OPTIONS, landform: "hills" as const, settlements: [{ type: "hamlet" as const }] } };
      const result = await runRandomWorld(options);
      assert.equal(result.brief, "assets/worlds/Hills.worldbrief.json");
      assert.ok(existsSync(join(root, result.brief)) && existsSync(join(root, result.level)));
      assert.equal(result.registered, "hills-level");
      assert.equal(normalizeWorldBrief(JSON.parse(readFileSync(join(root, result.brief), "utf8"))).brief?.id, "Hills");
      await assert.rejects(runRandomWorld(options), /exists; rerun with --force/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
