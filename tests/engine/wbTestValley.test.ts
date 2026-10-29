/**
 * World Builder F1 step 19: the settlement chain on the reproducible mountain
 * test valley (`tools/world/wbTestValley.ts`). The stages run on the analytic
 * height, no terrain files. Pinned here: the track up the slope stays within
 * its limit (a serpentine), and the two known gaps of the mountain test — the
 * valley village short of parcels and the hillside hamlet that slides down to
 * the floor — so a fix shows up as a deliberate change to this test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { RoomLayout } from "../../engine/scene/layout";
import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { applyPlacementGroupChanges, planStage, type StagePlan, type StageTerrain } from "../../engine/worldbuilder/stage";
import { createDefaultWorldStages } from "../../engine/worldbuilder/stages";
import {
  generateWbTestValley,
  WB_TEST_VALLEY_HALF,
  WB_TEST_VALLEY_TERRAIN_ID,
  wbTestValleyAxisZ,
  wbTestValleyHeight,
  wbTestValleyRecipe,
} from "../../tools/world/wbTestValley";

type Check = (label: string, fn: () => void) => void;

/** Runs every default stage but the blockout markers, applying each; returns the final state and the plans. */
function runChain() {
  const { profile } = normalizeRegionProfile(JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8")));
  let recipe = wbTestValleyRecipe();
  let layout: RoomLayout = { schema: 1, name: "WbTestValley", loadGroups: [], characters: [], instances: [] };
  let terrains: StageTerrain[] = [{
    id: WB_TEST_VALLEY_TERRAIN_ID, min: [-WB_TEST_VALLEY_HALF, -WB_TEST_VALLEY_HALF], max: [WB_TEST_VALLEY_HALF, WB_TEST_VALLEY_HALF],
    locked: false, splines: [], layers: [],
  }];
  const plans = new Map<string, StagePlan>();
  for (const stage of createDefaultWorldStages().filter((entry) => entry.id !== "planBlockout")) {
    const plan = planStage(stage, { recipe, layout, profile, sampleHeight: wbTestValleyHeight, terrains });
    assert.deepEqual(plan.errors, [], stage.id);
    plans.set(stage.id, plan);
    layout = structuredClone(layout);
    applyPlacementGroupChanges(layout, plan.groupChanges, "after");
    terrains = terrains.map((terrain) => {
      const change = plan.splineChanges.find((entry) => entry.landscapeId === terrain.id);
      return change ? { ...terrain, splines: structuredClone(change.after) as TerrainSpline[] } : terrain;
    });
    recipe = plan.recipeAfter;
  }
  return { recipe, layout, splines: terrains[0]!.splines, plans };
}

let chained: ReturnType<typeof runChain> | null = null;
/** The chain is deterministic and takes ~1 s: run once for both checks. */
const chain = () => (chained ??= runChain());

function steepestGrade(spline: TerrainSpline): number {
  let steepest = 0;
  for (let index = 1; index < spline.points.length; index += 1) {
    const a = spline.points[index - 1]!.position;
    const b = spline.points[index]!.position;
    const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (run > 0) steepest = Math.max(steepest, (Math.atan(Math.abs(b[1] - a[1]) / run) * 180) / Math.PI);
  }
  return steepest;
}

export function registerWbTestValleyTests(check: Check): void {
  check("wb test valley: the terrain matches the analytic height and the level points at it", () => {
    const valley = generateWbTestValley();
    assert.equal(valley.def.tiles.length, 16);
    assert.equal(valley.tileBytes.size, 16);
    const tile = valley.tiles.get("1_2")!;
    const size = valley.def.tileQuads + 1;
    const [x, z] = [valley.def.origin[0] + (64 + 10) * 2, valley.def.origin[2] + (128 + 20) * 2];
    assert.equal(tile.heights[20 * size + 10], Math.fround(wbTestValleyHeight(x, z)!));
    const floor = wbTestValleyHeight(0, wbTestValleyAxisZ(0))!;
    const ridge = wbTestValleyHeight(0, 250)!;
    assert.ok(floor < 12 && ridge > 80, `floor ${floor} m, ridge ${ridge} m`);
    assert.equal(wbTestValleyHeight(300, 0), null, "nothing outside the square");
    assert.deepEqual((valley.level.landscapes as Array<{ dataRef: string }>)[0]!.dataRef, "layouts/WbTestValley.landscapes/valley.terrain.json");
  });

  check("wb test valley: the chain runs; the track climbs the slope in a serpentine within its limit", () => {
    const { recipe, splines, plans } = chain();
    const roads = plans.get("roads")!;
    assert.ok(roads.warnings.some((warning) => /^road hamlet-track: the planned line climbs \d+(\.\d)?° \(limit 20°\); routed over the terrain instead$/.test(warning)));
    const track = splines.find((spline) => spline.id === "wb-road-hamlet-track")!;
    assert.ok(steepestGrade(track) <= 20.5, `track climbs ${steepestGrade(track)}°`);
    for (const spline of splines.filter((entry) => entry.id.startsWith("wb-road-valley"))) {
      assert.ok(steepestGrade(spline) < 6, `${spline.id} on the valley floor`);
    }
    assert.deepEqual(recipe.generated.sites.map((site) => site.settlement), ["village", "hamlet"]);
  });

  check("wb test valley: known gaps — the village is short of parcels, the hillside hamlet slides to the floor", () => {
    const { recipe } = chain();
    const site = (id: string) => recipe.generated.sites.find((entry) => entry.settlement === id)!;
    const needs = (id: string) => site(id).dwellings + site(id).program.reduce((sum, line) => sum + line.count, 0);
    const parcels = (id: string) => recipe.generated.parcels.filter((parcel) => parcel.settlement === id).length;

    // Village: the core grown along the floor holds more than the disc did (25 of 44), not yet all.
    assert.equal(needs("village"), 44);
    assert.ok(parcels("village") >= 30, `${parcels("village")} parcels`);
    assert.ok(parcels("village") < needs("village"), "known gap: fixed? then pin the new count");

    // Hamlet: planned on the slope at (90, 150); its site lands on the valley floor, and the track ends where it was planned.
    const hamlet = site("hamlet");
    const fromAxis = Math.abs(hamlet.center[1] - wbTestValleyAxisZ(hamlet.center[0]));
    assert.ok(fromAxis < 60, `known gap: the hamlet sits ${fromAxis.toFixed(0)} m from the valley axis; fixed? then pin it on the slope`);
    const end = recipe.plan.roadGraph.nodes.find((node) => node.id === "hamlet-end")!;
    assert.ok(Math.hypot(end.position[0] - hamlet.center[0], end.position[1] - hamlet.center[1]) > 80, "the track still leads to the planned spot");
  });
}
