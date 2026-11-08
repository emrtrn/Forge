/**
 * Water in a built world brief (RANDOM_WORLD_PLAN step 3): a lake in the brief
 * becomes a carved bed, a painted shore and a Lake actor that fills it without
 * spilling out of its area. Generic test data: a gently falling plain.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { LayoutLakeWaterBody } from "../../engine/scene/layout";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { CooperativeWork } from "../../engine/core/cooperativeWork";
import { prepareLakePresentation } from "../../engine/render-three/lakePreparation";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";
import { buildWorldFromBrief, type WorldBriefBuild } from "../../tools/world/worldBriefBuild";
import { PILOT_BRIEF } from "./worldBrief.test";

type CheckAsync = (label: string, run: () => Promise<void>) => Promise<void>;

const LEVEL = "assets/trial/Water.level.json";
const PROFILE = "assets/world-builder/Levels/WbPilotValley.regionprofile.json";

/** A plain falling 20 m to the south with low hills, a lake on it. */
export const WATER_BRIEF = {
  schema: 1,
  type: "worldBrief",
  id: "water_test",
  seed: 5,
  frame: { east: 0, north: 0, elevation: 0 },
  area: { west: -256, east: 256, south: -256, north: 256 },
  terrain: { id: "ground", name: "Water Test", tileQuads: 64, spacing: 2, heightRange: [-40, 120], relief: { hills: { height: 3, wavelength: 200 } } },
  regionProfile: PROFILE,
  valleys: [{
    id: "plain",
    axis: "northSouth",
    sections: [{ north: 256, floor: [-250, 250], rock: [-255, 255] }, { north: -256, floor: [-250, 250], rock: [-255, 255] }],
    floorProfile: [{ north: 256, elevation: 20 }, { north: -256, elevation: 0 }],
    sideSlopeDeg: 10,
    relief: { slopeFoot: 10, spurs: 0, ridges: 0, noise: 0 },
  }],
  regions: [],
  water: [{
    id: "tarn",
    kind: "lake",
    polygon: Array.from({ length: 14 }, (_, i) => {
      const angle = i * Math.PI / 7;
      const radius = 70 + 12 * Math.sin(3 * angle);
      return [Math.round(radius * Math.cos(angle) * 10) / 10, Math.round((40 + radius * Math.sin(angle)) * 10) / 10];
    }),
  }],
  roads: { nodes: [], edges: [] },
  landmarks: [],
  settlements: [],
  props: [],
  models: [],
};

export function buildBrief(raw: Record<string, unknown>, levelPath = LEVEL): WorldBriefBuild {
  // The temporary rock scatter (`worldBriefTemporarySteps.ts`) needs the pilot's model rows.
  const models = JSON.parse(readFileSync(PILOT_BRIEF, "utf8")).models;
  const { brief, issues } = normalizeWorldBrief({ ...structuredClone(raw), models });
  assert.deepEqual(issues, []);
  const profile = normalizeRegionProfile(JSON.parse(readFileSync(`public/${PROFILE}`, "utf8"))).profile;
  const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
  const byPath = new Map(manifest.assets.map((asset) => [asset.path, asset.id]));
  return buildWorldFromBrief({ brief: brief as WorldBrief, levelPath, profile, assetIdForFile: (file) => byPath.get(file) ?? null });
}

/** The same plain, a river falling north to south and a road across it east to west. */
export const BRIDGE_BRIEF = {
  ...structuredClone(WATER_BRIEF),
  id: "bridge_test",
  water: [{ id: "river", kind: "river", line: [[-30, 250], [10, 60], [0, -100], [25, -250]], width: 8, bedDepth: 2.2, surfaceDepth: 1 }],
  roads: {
    nodes: [{ id: "west", at: [-246, -60], kind: "end" }, { id: "east", at: [246, -40], kind: "end" }],
    edges: [{ id: "across", from: "west", to: "east", roadClass: "local" }],
  },
};

export async function registerWorldBriefWaterTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("world brief water: a lake is carved, its shore painted, and its Lake fills the bed without spilling", async () => {
    const world = buildBrief(WATER_BRIEF);
    assert.deepEqual(world.deferred, []);
    const lakes = world.layout.waterBodies ?? [];
    assert.equal(lakes.length, 1);
    const lake = lakes[0] as LayoutLakeWaterBody;
    assert.equal(lake.id, "tarn-water");
    assert.equal(lake.terrainRef, "ground");
    assert.ok(lake.bed && lake.bed.points.length === 14, "the bed recipe the editor can re-carve");
    assert.equal(lake.bed.shorePaint?.layerId, "riverbed");
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot({ def: world.def, tiles: new Map(world.tiles) }, lake));
    assert.equal(geometry.status, "ready", geometry.message);
    const depth = geometry.depths.reduce((most, value) => Math.max(most, value), 0);
    assert.ok(depth > 3, `deepest ${depth.toFixed(2)} m`);
    // Shore paint: the river bed layer under the water's edge, none far away.
    const layer = world.def.layers.findIndex((entry) => entry.id === "riverbed");
    const weight = (x: number, z: number): number => {
      const { def } = world;
      const [gi, gj] = [Math.round((x - def.origin[0]) / def.spacing), Math.round((z - def.origin[2]) / def.spacing)];
      const [tx, tz] = [Math.floor(gi / def.tileQuads), Math.floor(gj / def.tileQuads)];
      const tile = world.tiles.get(`${tx}_${tz}`)!;
      const index = (gj - tz * def.tileQuads) * tile.size + (gi - tx * def.tileQuads);
      return tile.weights[Math.floor(layer / 4) * tile.size * tile.size * 4 + index * 4 + layer % 4]! / 255;
    };
    const [sx, sz] = lake.bed.points[0]!;
    assert.ok(weight(sx, sz) > 0.9, "shore painted");
    assert.ok(weight(-200, 200) < 0.05, "dry ground not painted");
  });

  await checkAsync("world brief water: a lake wider than 250 m still gets its water surface (its shore bands widen)", async () => {
    const world = buildBrief({
      ...structuredClone(WATER_BRIEF),
      id: "mere_test",
      area: { west: -384, east: 384, south: -384, north: 384 },
      valleys: [{ ...structuredClone(WATER_BRIEF.valleys[0]!), sections: [{ north: 384, floor: [-380, 380], rock: [-383, 383] }, { north: -384, floor: [-380, 380], rock: [-383, 383] }],
        floorProfile: [{ north: 384, elevation: 20 }, { north: -384, elevation: 0 }] }],
      water: [{ id: "mere", kind: "lake", polygon: Array.from({ length: 16 }, (_, i) => [Math.round(150 * Math.cos(i * Math.PI / 8)), Math.round(150 * Math.sin(i * Math.PI / 8))]) }],
    });
    const lake = world.layout.waterBodies![0] as LayoutLakeWaterBody;
    assert.ok(lake.bounds.max[0] - lake.bounds.min[0] > 300);
    assert.ok(lake.appearance!.foamWidth! > 1 && lake.appearance!.shoreWetnessWidth === lake.appearance!.foamWidth, `bands ${lake.appearance!.foamWidth}`);
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot({ def: world.def, tiles: new Map(world.tiles) }, lake));
    assert.equal(geometry.status, "ready", geometry.message);
    // What the editor and the game do before the surface is shown.
    const staged = await prepareLakePresentation(lake, geometry, new CooperativeWork({}));
    staged.geometry.dispose();
    staged.foam?.dispose();
    staged.shore?.dispose();
  });

  await checkAsync("world brief water: a river that runs into a lake does not drain it", async () => {
    const world = buildBrief({
      ...structuredClone(WATER_BRIEF),
      id: "inflow_test",
      water: [
        ...structuredClone(WATER_BRIEF.water),
        { id: "inflow", kind: "river", line: [[10, 250], [-5, 170], [0, 100]], width: 8, bedDepth: 2.2, surfaceDepth: 1 },
      ],
    });
    const lake = world.layout.waterBodies![0] as LayoutLakeWaterBody;
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot({ def: world.def, tiles: new Map(world.tiles) }, lake));
    assert.equal(geometry.status, "ready", geometry.message);
    const course = world.ground.courses[0]!;
    assert.ok(lake.surfaceLevel <= Math.min(...course.bed) + 1e-6, "the lake stands no higher than the bed of the river that feeds it");
  });

  await checkAsync("world brief water: a road over a river crosses on a level deck and leaves the river bed open", async () => {
    const world = buildBrief(BRIDGE_BRIEF);
    assert.ok(!world.warnings.some((warning) => warning.includes("without a bridge")), world.warnings.join("; "));
    const road = world.def.splines!.find((spline) => spline.id === "wb-road-across")!;
    const spans = road.segments.filter((segment) => segment.deform?.enabled === false);
    assert.equal(spans.length, 1, "one bridge span");
    assert.equal(spans[0]!.paint, undefined, "no road paint under the deck");
    const [start, end] = [spans[0]!.startPointId, spans[0]!.endPointId].map((id) => road.points.find((point) => point.id === id)!);
    assert.equal(start.position[1], end.position[1], "a level deck");
    const decks = world.layout.instances.flatMap((group) => group.placements).filter((placement) => placement.role === "structure.bridge");
    assert.equal(decks.length, 1);
    const deck = decks[0]!;
    const course = world.ground.courses[0]!;
    // The river's centreline under the deck: the bed is still carved there and the deck clears the water.
    const [mx, mz] = [(start.position[0] + end.position[0]) / 2, (start.position[2] + end.position[2]) / 2];
    const nearest = course.points.reduce((best, point, index) =>
      Math.hypot(point[0] - mx, point[1] - mz) < Math.hypot(course.points[best]![0] - mx, course.points[best]![1] - mz) ? index : best, 0);
    const [rx, rz] = course.points[nearest]!;
    assert.ok(Math.hypot(rx - mx, rz - mz) < 6, "the deck's middle is over the river");
    const bed = world.sampleHeight(rx, rz)!;
    assert.ok(bed < course.surface[nearest]! - 0.5, `the bed (${bed.toFixed(2)}) stays under the water (${course.surface[nearest]!.toFixed(2)})`);
    assert.ok(start.position[1] > course.surface[nearest]! + 2.5, "the deck clears the water");
    assert.ok(Math.abs(deck.position[1] - (start.position[1] - 0.4)) < 0.01, "the deck's top is the road");
    const span = Math.hypot(end.position[0] - start.position[0], end.position[2] - start.position[2]);
    assert.ok(span > 8 + 2 * 10 && span < 60, `span ${span.toFixed(1)} m`);
  });
}
