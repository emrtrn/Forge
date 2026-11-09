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
import { RIVER_SIZES, SETTLEMENT_WATER_GAP } from "../../engine/worldbuilder/randomWater";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import type { LayoutLakeWaterBody } from "../../engine/scene/layout";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { CooperativeWork } from "../../engine/core/cooperativeWork";
import { prepareLakePresentation } from "../../engine/render-three/lakePreparation";
import { briefToWorld, normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";
import { runRandomWorld } from "../../tools/world/randomWorldRun";
import { buildWorldFromBrief } from "../../tools/world/worldBriefBuild";
import { prepareOceanTerrain } from "../../engine/terrain/oceanPreparation";
import { sampleOceanCoverage } from "../../engine/terrain/oceanCoverage";
import { normalizeGroundCover } from "../../engine/worldbuilder/groundCover";
import { readRoomLayout } from "../../engine/scene/layoutValidation";
import { validateSavePayload } from "../../tools/saveValidator";
import { terrainTileLayerWeight } from "../../engine/terrain/terrainTypes";
import { SEA_SIDES } from "../../engine/worldbuilder/island";
import { prepareTerrainRiverWaterSource } from "../../engine/terrain/terrainRiverWater";
import { resolveRiverWater } from "../../engine/scene/riverWater";
import { buildRiverWaterRibbon } from "../../engine/render-three/riverWater";
import { RiverSurfaceQuery } from "../../engine/terrain/riverSurface";
import { resolveOceanInlets } from "../../engine/terrain/oceanInlets";

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

/** Every water entry's points with the settlements' gap to it (negative inside the gap). */
function waterGaps(world: WorldBrief): Array<{ id: string; gap: number }> {
  return world.water.flatMap((water) => world.settlements.map((settlement) => {
    const points = water.line ?? water.polygon!;
    const nearest = Math.min(...points.map(([east, north]) => Math.hypot(east - settlement.center[0], north - settlement.center[1])));
    const asked = SETTLEMENT_WATER_GAP.share * settlement.radius! + (water.line ? SETTLEMENT_WATER_GAP.river : SETTLEMENT_WATER_GAP.lake);
    return { id: `${water.id}/${settlement.id}`, gap: nearest - asked };
  }));
}

export async function registerRandomWorldTests(check: Check, checkSlowAsync: CheckAsync): Promise<void> {
  check("random world coast: four sea directions keep settlements and exits dry; rivers drain to sea", () => {
    for (const seaSide of SEA_SIDES) {
      let mouths = 0;
      for (const seed of [4, 11, 29]) {
        const options = { ...OPTIONS, landform: "coast" as const, seaSide, seed, rivers: 1, settlements: [{ type: "hamlet" as const }] };
        const result = randomWorldBrief(options);
        const normalized = normalizeWorldBrief(result.brief);
        assert.deepEqual(normalized.issues, []);
        assert.deepEqual(result, randomWorldBrief(options));
        const world = normalized.brief!, ground = createBriefTerrain(world);
        assert.equal(world.settlements.length, 1);
        for (const node of world.roads.nodes) {
          const [x, z] = briefToWorld(world, node.at);
          assert.ok(ground.ocean!.distance(x, z) > 75, `${seaSide} ${seed} ${node.id} is on land`);
        }
        for (const course of ground.courses) if (course.water.outlet === "ocean") {
          mouths++;
          assert.equal(course.surface.at(-1), 0);
          assert.ok(Math.abs(ground.ocean!.distance(...course.points.at(-1)!) - 4) < .15, "the mouth joins inside its shore channel");
          assert.ok(ground.ocean!.distance(...course.points.at(-2)!) >= 79);
          course.surface.slice(1).forEach((height, i) => assert.ok(height <= course.surface[i]!));
        }
      }
      assert.ok(mouths > 0, `${seaSide}: at least one safe sea outlet across the fixtures`);
    }
  });

  await checkSlowAsync("random world coast: native river mouth and Ocean own complementary surfaces and survive save/read", async () => {
    const world = brief({ landform: "coast", seaSide: "west", seed: 11, rivers: 1, cover: "forest", settlements: [{ type: "hamlet" }] });
    const profile = normalizeRegionProfile(JSON.parse(readFileSync(`public/${world.regionProfile}`, "utf8"))).profile;
    const cover = normalizeGroundCover(JSON.parse(readFileSync(`public/${world.cover!.file}`, "utf8"))).cover!;
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
    const byPath = new Map(manifest.assets.map(asset => [asset.path, asset.id]));
    const built = buildWorldFromBrief({ brief: world, levelPath: "assets/trial/Coast.level.json", profile, cover, assetIdForFile: file => byPath.get(file) ?? null });
    const sea = built.layout.oceanWaters![0]!;
    assert.equal(sea.offshorePolicy, "connectedBoundary");
    assert.equal(sea.inlets?.length, 1, JSON.stringify(world.water));
    const coverage = await prepareOceanTerrain({ def: built.def, tiles: built.tiles }, sea);
    assert.equal(coverage.status, "ready");
    assert.equal(sampleOceanCoverage(coverage, -800, 0).status, "wet");
    assert.equal(sampleOceanCoverage(coverage, 800, 0).status, "dry", "the exterior mainland must not become sea");
    const inlet = coverage.inlets![0]!;
    const source = await prepareTerrainRiverWaterSource({ def: built.def, tiles: built.tiles }, resolveRiverWater(built.layout.riverWaters![0]));
    const ribbon = buildRiverWaterRibbon(source.spline, { surfaceLevel: source.surfaceLevel, widthScale: 1, heightAt: source.heightAt, sampleSpacing: source.sampleSpacing });
    const river = new RiverSurfaceQuery(ribbon, source.position);
    assert.ok(ribbon.indices.length > 0);
    const dx = inlet.end[0] - inlet.start[0], dz = inlet.end[1] - inlet.start[1], length = Math.hypot(dx, dz);
    for (const share of [.2, .5, .9, .999]) {
      const x = inlet.start[0] + dx * share, z = inlet.start[1] + dz * share;
      assert.equal(sampleOceanCoverage(coverage, x, z).status, "dry", "the river owns its terminal reach");
      assert.ok(river.sampleAt(x, z), "the excluded Ocean reach has a real wet River triangle");
    }
    let wetRiver = 0;
    for (let along = length - 30; along < length - .5; along += 2) for (let across = -inlet.width + .5; across < inlet.width; across += 1) {
      const x = inlet.start[0] + dx / length * along - dz / length * across;
      const z = inlet.start[1] + dz / length * along + dx / length * across;
      const sample = river.sampleAt(x, z);
      if (sample) { wetRiver++; assert.equal(sampleOceanCoverage(coverage, x, z).status, "dry", "no duplicate surfaces across the mouth width"); }
      else if ((built.sampleHeight(x, z) ?? Infinity) < sea.surfaceLevel) assert.equal(sampleOceanCoverage(coverage, x, z).status, "wet", "no water gap beside the ribbon");
    }
    assert.ok(wetRiver > 30);
    assert.equal(sampleOceanCoverage(coverage, inlet.end[0] + dx / length * 2, inlet.end[1] + dz / length * 2).status, "wet", "Ocean starts immediately beyond the river end");
    assert.equal(built.layout.riverWaters![0]!.waveAmplitude, 0, "terminal waterline remains coplanar with the Ocean");
    assert.deepEqual(readRoomLayout(JSON.parse(JSON.stringify(built.layout)), "coast").oceanWaters, [sea]);
    assert.deepEqual(validateSavePayload({ layout: built.layout }).layout.oceanWaters, [sea]);
    // Rescale the actual ribbon, not a test-only rectangle: Ocean must fill the
    // uncovered channel when narrow and keep out of the widened wet surface.
    for (const widthScale of [.25, .5, 2]) {
      const waters = structuredClone(built.layout.riverWaters!); waters[0]!.widthScale = widthScale;
      coverage.inlets = resolveOceanInlets(built.def, sea, waters);
      const changed = await prepareTerrainRiverWaterSource({ def: built.def, tiles: built.tiles }, resolveRiverWater(waters[0]));
      const data = buildRiverWaterRibbon(changed.spline, { surfaceLevel: changed.surfaceLevel, widthScale, heightAt: changed.heightAt, sampleSpacing: changed.sampleSpacing });
      const query = new RiverSurfaceQuery(data, changed.position);
      for (let along = length - 25; along < length - .5; along += 2) for (let across = -inlet.width * 2 + .25; across < inlet.width * 2; across += .5) {
        const x = inlet.start[0] + dx / length * along - dz / length * across;
        const z = inlet.start[1] + dz / length * along + dx / length * across;
        if (query.sampleAt(x, z)) assert.equal(sampleOceanCoverage(coverage, x, z).status, "dry", `${widthScale}: no double surface`);
        else if ((built.sampleHeight(x, z) ?? Infinity) < sea.surfaceLevel) assert.equal(sampleOceanCoverage(coverage, x, z).status, "wet", `${widthScale}: no empty water strip`);
      }
    }
  });
  check("random world island: deterministic coast, dry settlements and an internal road for a lone village", () => {
    for (const seed of [1, 11, 48213, 0xffffffff]) {
      const options = { landform: "island" as const, seed, rivers: 0, settlements: [{ type: "village" as const }] };
      const world = brief(options), ground = createBriefTerrain(world);
      assert.deepEqual(world, brief(options));
      assert.equal(world.settlements.length, 1);
      assert.equal(world.roads.edges.length, 1, "a lone village still has a road to grow streets from");
      for (const node of world.roads.nodes) {
        const [x, z] = briefToWorld(world, node.at);
        assert.ok(ground.ocean!.distance(x, z) > 70, `${seed}: internal road end`);
        assert.ok(ground.ground(x, z) > ground.ocean!.surfaceLevel + 3, `${seed}: dry road end`);
      }
      for (const [x, z] of [[-512, -512], [512, -512], [512, 512], [-512, 512]]) assert.ok(ground.ground(x!, z!) < -25);
      assert.ok(ground.ground(0, 0) > 0);
    }
    assert.throws(() => brief({ landform: "island", rivers: 1 }), /river-mouth/);
    const coast11 = createBriefTerrain(brief({ landform: "island", seed: 11 })).ocean!;
    const coast12 = createBriefTerrain(brief({ landform: "island", seed: 12 })).ocean!;
    assert.ok(Math.abs(coast11.distance(380, 0) - coast12.distance(380, 0)) > 5, "adjacent seeds visibly change the shore");
    const raw = randomWorldBrief({ ...OPTIONS, landform: "island" }).brief;
    for (const ocean of [{ ...(raw.ocean as object), extra: true }, { ...(raw.ocean as object), offshoreDepth: 0 }, undefined]) {
      assert.equal(normalizeWorldBrief({ ...raw, ocean }).brief, null);
    }
    assert.equal(normalizeWorldBrief({ ...raw, terrain: { ...(raw.terrain as object), island: { center: [0, 0], radius: 500, shoreWidth: 50, landHeight: 10 } } }).brief, null);
  });

  await checkSlowAsync("random world island: native Ocean, dry buildings and roads, plant-free sea and save/read roundtrip", async () => {
    const world = brief({ landform: "island", seed: 11, rivers: 0, cover: "forest", settlements: [{ type: "village" }] });
    const profile = normalizeRegionProfile(JSON.parse(readFileSync(`public/${world.regionProfile}`, "utf8"))).profile;
    const cover = normalizeGroundCover(JSON.parse(readFileSync(`public/${world.cover!.file}`, "utf8"))).cover!;
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
    const byPath = new Map(manifest.assets.map(asset => [asset.path, asset.id]));
    const built = buildWorldFromBrief({ brief: world, levelPath: "assets/trial/Island.level.json", profile, cover, assetIdForFile: file => byPath.get(file) ?? null });
    const sea = built.layout.oceanWaters![0]!;
    const coverage = await prepareOceanTerrain({ def: built.def, tiles: built.tiles }, sea);
    assert.equal(coverage.status, "ready");
    assert.ok(coverage.wetFaces > 100000);
    assert.equal(sampleOceanCoverage(coverage, -500, -500).status, "wet");
    assert.equal(sampleOceanCoverage(coverage, 0, 0).status, "dry");
    assert.deepEqual(readRoomLayout(JSON.parse(JSON.stringify(built.layout)), "island").oceanWaters, [sea]);
    assert.deepEqual(validateSavePayload({ layout: built.layout }).layout.oceanWaters, [sea]);
    const buildings = built.layout.instances.flatMap(group => group.placements).filter(p => p.role?.startsWith("building."));
    assert.ok(buildings.length >= 10, `${buildings.length} buildings on a lone-village island`);
    for (const building of buildings) {
      const [x, y, z] = building.position;
      assert.equal(sampleOceanCoverage(coverage, x, z).status, "dry", building.id);
      assert.ok(y > sea.surfaceLevel + 3, building.id);
    }
    const roads = built.def.splines ?? [];
    assert.ok(roads.some(road => road.id.startsWith("wb-road-")));
    for (const road of roads) for (const point of road.points) assert.equal(sampleOceanCoverage(coverage, point.position[0], point.position[2]).status, "dry", road.id);
    const planted = new Set(cover.plants.map(plant => cover.layers.findIndex(layer => layer.id === plant.layer)));
    let samples = 0;
    for (const tile of built.tiles.values()) for (let z = 0; z < tile.size; z += 8) for (let x = 0; x < tile.size; x += 8) {
      const wx = built.def.origin[0] + (tile.x * built.def.tileQuads + x) * built.def.spacing;
      const wz = built.def.origin[2] + (tile.z * built.def.tileQuads + z) * built.def.spacing;
      if (sampleOceanCoverage(coverage, wx, wz).status !== "wet") continue;
      samples++;
      for (const layer of planted) {
        assert.equal(terrainTileLayerWeight(tile, layer, z * tile.size + x), 0, `no plants at ${wx},${wz}`);
      }
    }
    assert.ok(samples > 1000);
    const shifted = structuredClone(world);
    shifted.frame.elevation = 75;
    shifted.ocean!.surfaceElevation = 90;
    const shiftedGround = createBriefTerrain(shifted);
    assert.equal(shiftedGround.ocean!.surfaceLevel, 15, "brief elevation is converted once");
    const tooBig = structuredClone(world); tooBig.terrain.tileQuads = 128; tooBig.terrain.spacing = 1;
    assert.throws(() => buildWorldFromBrief({ brief: tooBig, levelPath: "assets/trial/TooBig.level.json", profile, cover, assetIdForFile: () => null }), /preparation grid limit/);
  });

  check("random world island: random lakes stay inland or report that no lake fits", () => {
    let found = 0;
    for (const seed of [3, 11, 27, 91]) {
      const result = randomWorldBrief({ ...OPTIONS, landform: "island", seed, lakes: 1, rivers: 0, settlements: [] });
      const normalized = normalizeWorldBrief(result.brief);
      assert.deepEqual(normalized.issues, []);
      const terrain = createBriefTerrain(normalized.brief!);
      for (const lake of terrain.lakes) {
        found++;
        assert.ok(lake.surface > terrain.ocean!.surfaceLevel + 3, "an inland lake is above the sea");
        for (const [x, z] of lake.polygon) assert.ok(terrain.ocean!.distance(x, z) > 30, "no lake/sea surface overlap");
      }
      if (!terrain.lakes.length) assert.ok(result.notes.some(note => note.includes("lakes: room for 0")));
    }
    assert.ok(found > 0, "at least one generated island has room for an inland lake");
  });
  check("random world water: none by default; asking for it leaves the rest of the world as it was", () => {
    for (const landform of ["mountains", "hills", "plain"] as const) {
      const dry = randomWorldBrief({ ...OPTIONS, landform, size: "medium" }).brief;
      assert.deepEqual(dry, randomWorldBrief({ ...OPTIONS, landform, size: "medium", rivers: 0, lakes: 0 }).brief, "0 rivers and lakes: the same brief");
      assert.deepEqual(dry.water, []);
      const wet = randomWorldBrief({ ...OPTIONS, landform, size: "medium", rivers: 1, lakes: 1 }).brief;
      assert.ok((wet.water as unknown[]).length > 0, `${landform}: water`);
      assert.deepEqual({ ...wet, water: [] }, dry, `${landform}: the same world plus water`);
    }
    // A valley's settlements keep to one side of the floor; still the same roads and relief otherwise.
    const valleyDry = randomWorldBrief({ ...OPTIONS, landform: "valley", size: "medium" }).brief;
    const valleyWet = randomWorldBrief({ ...OPTIONS, landform: "valley", size: "medium", rivers: 1 }).brief;
    assert.deepEqual(valleyWet.terrain, valleyDry.terrain);
    assert.deepEqual(valleyWet.valleys, valleyDry.valleys);
  });

  check("random world water: rivers run downhill to the edge, a lake or another river; water keeps off the settlements", () => {
    let lakes = 0;
    for (const landform of LANDFORMS.filter(form => form !== "island" && form !== "coast")) {
      for (const seed of [3, 7, 11]) {
        const world = brief({ landform, seed, size: "medium", rivers: 2, lakes: 1 });
        const terrain = createBriefTerrain(world);
        // The rivers were drawn on the ground before the mountains kept off them.
        const dry = createBriefTerrain({ ...world, water: [] });
        const rivers = world.water.filter((water) => water.line);
        assert.ok(rivers.length >= 1, `${landform} ${seed}: a river`);
        for (const river of rivers) {
          assert.equal(river.width, RIVER_SIZES.medium.width);
          const line = river.line!;
          const [first, last] = [line[0]!, line[line.length - 1]!];
          const atEdge = Math.min(world.area.north - last[1], world.area.east - last[0], last[1] - world.area.south, last[0] - world.area.west) < 5;
          const inLake = world.water.some((lake) => lake.polygon && lake.polygon.some((point) => Math.hypot(point[0] - last[0], point[1] - last[1]) < 250));
          const intoRiver = rivers.some((other) => other !== river && other.line!.some((point) => Math.hypot(point[0] - last[0], point[1] - last[1]) < 50));
          assert.ok(atEdge || inLake || intoRiver, `${landform} ${seed} ${river.id} ends at the edge, in a lake or a river`);
          // Water level never rises downstream; on the ground it was drawn on, the source stands above the mouth.
          const course = terrain.courses.find((entry) => entry.id === river.id)!;
          course.surface.slice(1).forEach((level, index) => assert.ok(level <= course.surface[index]!));
          const [sx, sz] = briefToWorld(world, first);
          const [ex, ez] = briefToWorld(world, last);
          assert.ok(dry.ground(sx, sz) >= dry.ground(ex, ez) - 1, `${landform} ${seed} ${river.id}: source above mouth`);
        }
        lakes += world.water.filter((water) => water.polygon).length;
        for (const { id, gap } of waterGaps(world)) assert.ok(gap >= -1, `${landform} ${seed} ${id}: ${gap.toFixed(1)} m inside the settlement's gap`);
      }
    }
    assert.ok(lakes >= 10, `${lakes} of 12 lakes found room`);
  });


  check("random world: every landform and size gives a valid brief; the same seed the same brief", () => {
    for (const landform of LANDFORMS) {
      for (const size of ["small", "medium", "large"] as const) {
        if ((landform === "island" || landform === "coast") && size !== "small") {
          assert.throws(() => brief({ landform, size }), /Small worlds only/);
          continue;
        }
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
    for (const landform of LANDFORMS.filter(form => form !== "island" && form !== "coast")) {
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

  await checkSlowAsync("random world water: a small world with a river and a lake builds; the lake fills and every crossing is bridged", async () => {
    const world = brief({ landform: "hills", seed: 4, rivers: 1, lakes: 1 });
    const profile = normalizeRegionProfile(JSON.parse(readFileSync(`public/${world.regionProfile}`, "utf8"))).profile;
    const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
    const byPath = new Map(manifest.assets.map((asset) => [asset.path, asset.id]));
    const built = buildWorldFromBrief({ brief: world, levelPath: "assets/trial/RandomWater.level.json", profile, assetIdForFile: (file) => byPath.get(file) ?? null });
    for (const plan of built.stages) assert.deepEqual(plan.errors, [], plan.stageId);
    assert.equal(built.ground.courses.length, 1);
    assert.equal((built.layout.riverWaters ?? []).length, 1);
    assert.ok(!built.warnings.some((warning) => warning.includes("without a bridge") || warning.includes("without one") || warning.includes("flood-prone")), built.warnings.join("; "));
    const lakes = (built.layout.waterBodies ?? []) as LayoutLakeWaterBody[];
    assert.equal(lakes.length, 1);
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot({ def: built.def, tiles: new Map(built.tiles) }, lakes[0]!));
    assert.equal(geometry.status, "ready", geometry.message);
    const staged = await prepareLakePresentation(lakes[0]!, geometry, new CooperativeWork({}));
    staged.geometry.dispose();
    staged.foam?.dispose();
    staged.shore?.dispose();
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
