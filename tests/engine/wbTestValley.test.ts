/**
 * World Builder F1 step 19: the settlement chain on the reproducible mountain
 * test valley (`tools/world/wbTestValley.ts`). The stages run on the analytic
 * height, no terrain files. Pinned here: the track up the slope stays within
 * its limit (a serpentine); the hamlet drawn on the steep slope above the
 * bench settles on the bench (not down on the floor) and its stranded road
 * node is reported, and Move to Site plus a Roads re-run brings the track to
 * it; the valley village gets a parcel per program need
 * (shallower lots and frontages resuming past crossing streets); and the
 * known gap left — one dwelling without a lot once the large roles and open
 * land are placed — so a fix shows up as a deliberate change to this test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { RoomLayout } from "../../engine/scene/layout";
import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import { inCore } from "../../engine/worldbuilder/core";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { applyPlacementGroupChanges, planStage, type StagePlan, type StageTerrain } from "../../engine/worldbuilder/stage";
import { createDefaultWorldStages } from "../../engine/worldbuilder/stages";
import { landUseStage } from "../../engine/worldbuilder/stages/landUse";
import {
  generateWbTestValley,
  WB_TEST_VALLEY_HALF,
  WB_TEST_VALLEY_TERRAIN_ID,
  wbTestValleyAxisZ,
  wbTestValleyBenchZ,
  wbTestValleyHeight,
  wbTestValleyRecipe,
} from "../../tools/world/wbTestValley";
import { moveNodeToSite, strandedRoadNodes } from "../../src/editor/worldBuilderPlanEdit";

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
  return { recipe, layout, terrains, profile, splines: terrains[0]!.splines, plans };
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

  check("wb test valley: the hillside hamlet settles on the bench and its stranded road node is reported", () => {
    const { recipe, plans } = chain();
    const hamlet = recipe.generated.sites.find((entry) => entry.settlement === "hamlet")!;
    const [x, z] = hamlet.center;
    assert.ok(Math.abs(z - wbTestValleyBenchZ(x)) < 25, `on the bench, not the floor (${hamlet.center})`);
    assert.ok(z - wbTestValleyAxisZ(x) > 80, "well up from the valley axis");
    assert.ok(recipe.generated.parcels.filter((parcel) => parcel.settlement === "hamlet").length >= 11, "a parcel for each of its 11 program needs");
    const warnings = plans.get("settlementSites")!.warnings;
    assert.ok(warnings.some((warning) => /^settlement hamlet: moved \d+ m from the planned centre \(the planned centre is steeper than the limit\)$/.test(warning)));
    assert.ok(warnings.some((warning) => warning.startsWith("settlement hamlet: its road node hamlet-end is outside the chosen core")),
      "the track was built to the planned spot: the user moves the node");
  });

  check("wb test valley: Move to Site puts the stranded node on the bench and the re-run track reaches the hamlet", () => {
    const { recipe, layout, terrains, profile } = chain();
    assert.deepEqual(strandedRoadNodes(recipe).map((entry) => entry.node), ["hamlet-end"]);
    const fixed = moveNodeToSite(recipe, "hamlet-end")!;
    assert.deepEqual(strandedRoadNodes(fixed), []);
    const node = fixed.plan.roadGraph.nodes.find((entry) => entry.id === "hamlet-end")!;
    assert.equal(node.source, "manual");

    const stages = createDefaultWorldStages();
    const roads = planStage(stages.find((stage) => stage.id === "roads")!, { recipe: fixed, layout, profile, sampleHeight: wbTestValleyHeight, terrains });
    assert.deepEqual(roads.errors, []);
    assert.deepEqual(roads.updated, ["wb-road-hamlet-track"], "only the track moves");
    const after = roads.splineChanges.find((entry) => entry.landscapeId === WB_TEST_VALLEY_TERRAIN_ID)!.after as TerrainSpline[];
    const track = after.find((spline) => spline.id === "wb-road-hamlet-track")!;
    const hamlet = fixed.generated.sites.find((entry) => entry.settlement === "hamlet")!;
    const end = track.points.at(-1)!.position;
    assert.ok(inCore({ center: hamlet.center, radius: hamlet.coreRadius, outline: hamlet.core! }, [end[0], end[2]]), `track ends at ${end}`);
    assert.ok(steepestGrade(track) <= 20.5, `track climbs ${steepestGrade(track)}°`);

    const sites = planStage(stages.find((stage) => stage.id === "settlementSites")!, {
      recipe: roads.recipeAfter, layout, profile, sampleHeight: wbTestValleyHeight,
      terrains: terrains.map((terrain) => ({ ...terrain, splines: after })),
    });
    assert.ok(!sites.warnings.some((warning) => warning.includes("outside the chosen core")), sites.warnings.join("\n"));
  });

  check("wb test valley: the valley village gets a parcel per need; known gap — one dwelling left without a lot", () => {
    const { recipe, plans } = chain();
    const site = recipe.generated.sites.find((entry) => entry.settlement === "village")!;
    const needs = site.dwellings + site.program.reduce((sum, line) => sum + line.count, 0);
    const parcels = recipe.generated.parcels.filter((parcel) => parcel.settlement === "village").length;
    // The disc gave 25 parcels, the grown core 33, shallow retries and sliding past crossing streets 45.
    assert.equal(needs, 44);
    assert.ok(parcels >= needs, `${parcels} parcels`);
    const unplaced = plans.get("landUse")!.warnings
      .map((warning) => /^settlement village: no suitable parcel for (\d+) of 40 building\.residential\.detached/.exec(warning))
      .find((match) => match !== null);
    assert.ok(unplaced, "known gap: every dwelling placed? then pin it");
    assert.ok(Number(unplaced[1]) <= 1, `${unplaced[1]} dwellings without a lot`);
  });

  check("wb test valley: land use ranks low ground by its street's level, so re-levelled parcels (Apply Pads) leave it up to date", () => {
    const { recipe, layout, terrains, profile } = chain();
    // Bumps of up to ±4 m under the parcels, as levelling pads would make; the road splines keep their level.
    const relevelled = (x: number, z: number) => {
      const height = wbTestValleyHeight(x, z);
      return height === null ? null : height + 4 * Math.sin(x / 7) * Math.cos(z / 5);
    };
    const plan = planStage(landUseStage, { recipe, layout, profile, sampleHeight: relevelled, terrains });
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.empty, true, "land use did not move with the ground");
  });
}
