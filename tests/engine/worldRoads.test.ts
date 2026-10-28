/**
 * World Builder F1, step 6: the Stage Runner's spline output and the `roads`
 * stage (plan v0.4 §13, decision 19: spline data only). Road edges become
 * World Terrain splines owned through `recipe.ownership.splines`, under the
 * same rules as placements: manual / other-stage / protected / locked ids are
 * blocked, hand edits and deletions are kept, and a re-run — also after a
 * save + reload — is empty.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { RoomLayout } from "../../engine/scene/layout";
import { normalizeTerrainSplines } from "../../engine/terrain/terrainSplineData";
import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import { createWorldRecipe, normalizeWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import {
  applyPlacementGroupChanges,
  planStage,
  splineHash,
  type StageInput,
  type StagePlan,
  type StageTerrain,
  type TerrainSplineChange,
} from "../../engine/worldbuilder/stage";
import { planBlockoutStage } from "../../engine/worldbuilder/stages/planBlockout";
import { roadSplineId, roadsStage, ROUTE_SPACING } from "../../engine/worldbuilder/stages/roads";

type Check = (label: string, fn: () => void) => void;

const WEST = "terrain-west";
const EAST = "terrain-east";

function profile(): RegionProfile {
  const { profile: value } = normalizeRegionProfile(
    JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8")),
  );
  return value!;
}

function recipe(): WorldRecipe {
  const value = createWorldRecipe("roads_test", 3);
  value.plan.roadGraph.nodes.push(
    { id: "a", source: "manual", position: [-80, 0], kind: "end" },
    { id: "b", source: "manual", position: [-60, 0], kind: "junction" },
    { id: "c", source: "manual", position: [-60, 30], kind: "end" },
  );
  value.plan.roadGraph.edges.push(
    { id: "main", source: "manual", from: "a", to: "b", roadClass: "collector" },
    { id: "spur", source: "manual", from: "b", to: "c", roadClass: "track", guide: [[-50, 10], [-50, 20]] },
  );
  return value;
}

interface World {
  layout: RoomLayout;
  terrains: StageTerrain[];
}

function world(): World {
  const terrain = (id: string, min: [number, number], max: [number, number], splines: TerrainSpline[] = []): StageTerrain => ({
    id, min, max, locked: false, splines,
    layers: [{ id: "grass", name: "Grass" }, { id: "asphalt", name: "Asphalt" }, { id: "dirt", name: "Dirt" }],
  });
  const manual: TerrainSpline = {
    id: "spline-1", coordinateSpace: "world",
    points: [{ id: "p0", position: [-10, 0, 0], width: 6, falloff: 3 }, { id: "p1", position: [-5, 0, 0], width: 6, falloff: 3 }],
    segments: [{ id: "s0", startPointId: "p0", endPointId: "p1" }],
  };
  return {
    layout: { schema: 1, name: "Roads test", loadGroups: [], characters: [], instances: [] },
    terrains: [terrain(WEST, [-100, -100], [0, 100], [manual]), terrain(EAST, [0, -100], [100, 100])],
  };
}

/** Height falls 0.1 m per metre east; nothing outside |x| ≤ 100. */
const sampleHeight = (x: number, _z: number): number | null => (Math.abs(x) <= 100 ? 10 - x * 0.1 : null);

function input(recipeValue: WorldRecipe, state: World, profileValue: RegionProfile | null = profile()): StageInput {
  return { recipe: recipeValue, layout: state.layout, profile: profileValue, sampleHeight, terrains: state.terrains };
}

function applySplines(terrains: StageTerrain[], changes: readonly TerrainSplineChange[], side: "before" | "after"): StageTerrain[] {
  return terrains.map((terrain) => {
    const change = changes.find((entry) => entry.landscapeId === terrain.id);
    return change ? { ...terrain, splines: structuredClone(change[side]) } : terrain;
  });
}

function run(recipeValue: WorldRecipe, state: World, profileValue: RegionProfile | null = profile()) {
  const plan = planStage(roadsStage, input(recipeValue, state, profileValue));
  const layout = structuredClone(state.layout);
  applyPlacementGroupChanges(layout, plan.groupChanges, "after");
  return { plan, state: { layout, terrains: applySplines(state.terrains, plan.splineChanges, "after") }, recipe: plan.recipeAfter };
}

function spline(state: World, terrainId: string, id: string): TerrainSpline {
  const found = state.terrains.find((terrain) => terrain.id === terrainId)!.splines.find((entry) => entry.id === id);
  assert.ok(found, `${terrainId}/${id}`);
  return found!;
}

/** The terrain save + reload of the spline lists, and the recipe save + reload. */
function reload(state: World, recipeValue: WorldRecipe): { state: World; recipe: WorldRecipe } {
  const { recipe: reloaded, issues } = normalizeWorldRecipe(JSON.parse(JSON.stringify(recipeValue)));
  assert.deepEqual(issues, []);
  return {
    recipe: reloaded!,
    state: {
      layout: state.layout,
      terrains: state.terrains.map((terrain) => ({
        ...terrain, splines: normalizeTerrainSplines(JSON.parse(JSON.stringify(terrain.splines))),
      })),
    },
  };
}

function ids(plan: StagePlan) {
  return { added: plan.added, updated: plan.updated, removed: plan.removed, kept: plan.kept, blocked: plan.blocked };
}

export function registerWorldRoadsTests(check: Check): void {
  check("world roads: each road edge becomes a world-space terrain spline with profile width, mesh and paint", () => {
    const { plan, state, recipe: next } = run(recipe(), world());
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.warnings, ["track roads have no meshAsset in the region profile; their splines carry no mesh"]);
    assert.deepEqual(plan.added, [roadSplineId("main"), roadSplineId("spur")]);
    assert.deepEqual(plan.groupChanges, []);
    assert.deepEqual(plan.splineChanges.map((change) => change.landscapeId), [WEST]);
    assert.equal(plan.empty, false);

    const main = spline(state, WEST, "wb-road-main");
    assert.equal(main.coordinateSpace, "world");
    assert.equal(main.name, "main");
    assert.equal(main.smooth, true);
    assert.deepEqual(main.points.map((point) => point.position), [[-80, 18, 0], [-70, 17, 0], [-60, 16, 0]]);
    assert.ok(main.points.every((point) => point.width === 9 && point.falloff === 3), "collector: 7 m + 2 × 1 m shoulder");
    assert.deepEqual(main.segments[0], {
      id: "s0", startPointId: "p0", endPointId: "p1",
      deform: { enabled: true, raiseTerrain: true, lowerTerrain: true, flatten: true },
      paint: { enabled: true, layerId: "asphalt", strength: 1 },
      mesh: { enabled: true, assetId: "mesh:road-asphalt", alignToTerrain: true, deform: true, collision: true },
    });

    const spur = spline(state, WEST, "wb-road-spur");
    assert.deepEqual(spur.points.map((point) => [point.position[0], point.position[2]]).slice(0, 3), [[-60, 0], [-55, 5], [-50, 10]],
      "guide points are kept as vertices; each leg is split into runs of at most ROUTE_SPACING");
    assert.ok(spur.points.every((point, index) => index === 0
      || Math.hypot(point.position[0] - spur.points[index - 1]!.position[0], point.position[2] - spur.points[index - 1]!.position[2]) <= ROUTE_SPACING));
    assert.deepEqual(spur.segments[0]!.paint, { enabled: true, layerId: "dirt", strength: 1 });
    assert.equal(spur.segments[0]!.mesh, undefined);
    assert.equal(spline(state, WEST, "spline-1").points.length, 2, "the manual spline is untouched");

    assert.deepEqual(Object.keys(next.ownership.splines), ["wb-road-main", "wb-road-spur"]);
    assert.deepEqual(next.ownership.splines["wb-road-main"], {
      stage: "roads", edge: "main", outputHash: splineHash({ landscapeId: WEST, spline: main }),
    });
    assert.deepEqual(next.ownership.placements, {});
    assert.deepEqual(next.generators, { roads: 2 });
    assert.deepEqual(plan.bounds, { min: [-80, 0], max: [-50, 30] });
    assert.deepEqual(normalizeTerrainSplines([main]), [main], "stage output is save-canonical");
  });

  check("world roads: a re-run is empty, also after the terrain and recipe save + reload (WB-02)", () => {
    const first = run(recipe(), world());
    const again = planStage(roadsStage, input(first.recipe, first.state));
    assert.equal(again.empty, true);
    assert.equal(again.unchanged, 2);

    const reloaded = reload(first.state, first.recipe);
    const afterSave = planStage(roadsStage, input(reloaded.recipe, reloaded.state));
    assert.equal(afterSave.empty, true);
    assert.deepEqual(afterSave.kept, []);
    assert.equal(JSON.stringify(run(recipe(), world()).plan), JSON.stringify(first.plan), "deterministic (WB-01)");
  });

  check("world roads: plan edits update, move between terrains and remove only the stage's splines", () => {
    const first = run(recipe(), world());
    const changed = structuredClone(first.recipe);
    changed.plan.roadGraph.nodes[0]!.position = [20, 0];
    changed.plan.roadGraph.edges = changed.plan.roadGraph.edges.filter((edge) => edge.id === "main");
    const { plan, state, recipe: next } = run(changed, first.state);
    assert.deepEqual(ids(plan), { added: [], updated: ["wb-road-main"], removed: ["wb-road-spur"], kept: [], blocked: [] });
    assert.deepEqual(state.terrains[0]!.splines.map((entry) => entry.id), ["spline-1"]);
    assert.deepEqual(state.terrains[1]!.splines.map((entry) => entry.id), ["wb-road-main"], "the start node moved east");
    assert.deepEqual(plan.splineChanges.map((change) => change.landscapeId), [WEST, EAST]);
    assert.deepEqual(Object.keys(next.ownership.splines), ["wb-road-main"]);

    const undone = applySplines(state.terrains, plan.splineChanges, "before");
    assert.deepEqual(undone, first.state.terrains, "applying before restores every touched list exactly");
  });

  check("world roads: hand edits and deletions are kept unless preserveManualOverrides is off (WB-08)", () => {
    const first = run(recipe(), world());
    const edited = structuredClone(first.state);
    spline(edited, WEST, "wb-road-main").points[1]!.position = [-70, 20, 4];
    edited.terrains[0]!.splines = edited.terrains[0]!.splines.filter((entry) => entry.id !== "wb-road-spur");
    const changed = structuredClone(first.recipe);
    changed.plan.roadGraph.nodes[0]!.position = [-90, 0];

    const kept = planStage(roadsStage, input(changed, edited));
    assert.deepEqual(kept.kept, [
      { id: "wb-road-main", reason: "editedByHand" },
      { id: "wb-road-spur", reason: "deletedByHand" },
    ]);
    assert.deepEqual(kept.splineChanges, []);

    changed.generation.preserveManualOverrides = false;
    const forced = run(changed, edited);
    assert.deepEqual(ids(forced.plan), { added: ["wb-road-spur"], updated: ["wb-road-main"], removed: [], kept: [], blocked: [] });
    assert.deepEqual(spline(forced.state, WEST, "wb-road-main").points[0]!.position, [-90, 19, 0]);
  });

  check("world roads: manual ids, other stages, protected regions and locked terrains block or keep", () => {
    const start = world();
    start.terrains[0]!.splines[0]!.id = "wb-road-main";
    const value = recipe();
    value.plan.roadGraph.nodes.push({ id: "d", source: "manual", position: [50, 50], kind: "end" });
    value.plan.roadGraph.edges.push({ id: "east", source: "manual", from: "d", to: "c", roadClass: "local" });
    // Over the spur's end node, so no route can avoid it (a box mid-route is routed around).
    value.ownership.protectedRegions.push({ id: "keep_out", kind: "manual", min: [-62, 28], max: [-58, 32] });
    const blocked = planStage(roadsStage, input(value, {
      ...start, terrains: [start.terrains[0]!, { ...start.terrains[1]!, locked: true }],
    }));
    assert.deepEqual(blocked.blocked, [
      { id: "wb-road-main", reason: "manual" },
      { id: "wb-road-spur", reason: "protected" },
      { id: "wb-road-east", reason: "locked" },
    ]);
    assert.deepEqual(blocked.added, []);

    const other = recipe();
    other.ownership.splines["wb-road-main"] = { stage: "otherStage" };
    assert.deepEqual(planStage(roadsStage, input(other, world())).blocked, [{ id: "wb-road-main", reason: "otherStage" }]);

    const first = run(recipe(), world());
    const guarded = structuredClone(first.recipe);
    guarded.ownership.protectedRegions.push({ id: "keep", kind: "manual", min: [-85, -5], max: [-75, 5] });
    guarded.plan.roadGraph.nodes[1]!.position = [-60, 2];
    const kept = planStage(roadsStage, input(guarded, first.state));
    assert.deepEqual(kept.kept, [{ id: "wb-road-main", reason: "protected" }]);
    assert.deepEqual(kept.updated, ["wb-road-spur"]);
  });

  check("world roads: missing profile specs, off-terrain ends and bad stage output are reported", () => {
    const value = recipe();
    value.plan.roadGraph.nodes.push(
      { id: "far", source: "manual", position: [300, 0], kind: "end" },
      { id: "farther", source: "manual", position: [400, 0], kind: "end" },
      { id: "edge", source: "manual", position: [95, 0], kind: "end" },
    );
    value.plan.roadGraph.edges.push(
      { id: "lost", source: "manual", from: "far", to: "farther", roadClass: "local" },
      { id: "out", source: "manual", from: "edge", to: "far", roadClass: "local" },
    );
    const { plan, state } = run(value, world(), null);
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.warnings, [
      "no region profile road spec for collector; using 7 m and no mesh",
      "no region profile road spec for track; using 3.5 m and no mesh",
      "road lost has neither end on a World Terrain; skipped",
      "no region profile road spec for local; using 5 m and no mesh",
      "road out leaves the terrain; off-terrain points take the nearest height",
    ]);
    const out = spline(state, EAST, "wb-road-out");
    assert.ok(out.points.slice(1).every((point) => point.position[1] === out.points[1]!.position[1]));
    assert.equal(spline(state, WEST, "wb-road-main").segments[0]!.paint, undefined);

    const broken = planStage({
      id: "broken", label: "Broken", version: 1,
      run: () => ({
        placements: [], warnings: [],
        splines: [
          { landscapeId: "nowhere", spline: { id: "a", coordinateSpace: "world", points: [], segments: [] } },
          { landscapeId: WEST, spline: { id: "b", coordinateSpace: "world", points: [{ id: "p", position: [0, 0, 0], width: 0, falloff: 0 }], segments: [] } },
          { landscapeId: WEST, spline: { id: "has space", coordinateSpace: "world", points: [], segments: [] } },
        ],
      }),
    }, input(recipe(), world()));
    assert.deepEqual(broken.errors, [
      'stage output spline a: terrain "nowhere" is not loaded',
      "stage output spline b: invalid landscape.splines[0].points[0].width: 0",
      "stage output splines[2]: id must be an id",
    ]);
  });

  check("world roads: a stage touches only its own ownership section", () => {
    const value = recipe();
    value.plan.settlements.push({ id: "village", source: "manual", center: [-60, 0], type: "village" });
    const roads = run(value, world());
    const blockout = planStage(planBlockoutStage, input(roads.recipe, roads.state));
    assert.deepEqual(blockout.splineChanges, []);
    assert.deepEqual(blockout.recipeAfter.ownership.splines, roads.recipe.ownership.splines);
  });
}
