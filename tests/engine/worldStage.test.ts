/**
 * World Builder F1, step 5a: the Stage Runner core (plan v0.4 §3.2, §6.2) and
 * its first stage, `planBlockout`. Covers WB-01 determinism, WB-02 idempotency
 * and WB-08 manual preservation, plus the save round-trip the ownership hashes
 * depend on.
 */
import assert from "node:assert/strict";

import type { LayoutPlacement, RoomLayout } from "../../engine/scene/layout";
import { createWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import {
  applyPlacementGroupChanges,
  planStage,
  type StageInput,
  type WorldStage,
} from "../../engine/worldbuilder/stage";
import { createDefaultWorldStages } from "../../engine/worldbuilder/stages";
import { planBlockoutStage } from "../../engine/worldbuilder/stages/planBlockout";
import { validateLayout, validatePlacement } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

const CUBE = "shape:cube";

function recipe(): WorldRecipe {
  const value = createWorldRecipe("stage_test", 9);
  value.plan.settlements.push(
    { id: "village", source: "manual", center: [10.12345, 20], type: "village" },
    { id: "hamlet", source: "manual", center: [-40, 5], type: "hamlet" },
  );
  value.plan.landmarks.push({ id: "depot", source: "manual", kind: "logistics.depot", position: [0, -30] });
  value.plan.roadGraph.nodes.push({ id: "n1", source: "manual", position: [5, 5], kind: "end" });
  return value;
}

function layout(): RoomLayout {
  return {
    schema: 1, name: "Stage test", loadGroups: [], characters: [],
    instances: [
      { assetId: "mesh:rock", placements: [{ position: [1, 0, 1] }] },
      { assetId: CUBE, placements: [{ position: [9, 0, 9], name: "hand-made cube" }] },
    ],
  };
}

function input(recipeValue: WorldRecipe, layoutValue: RoomLayout): StageInput {
  return { recipe: recipeValue, layout: layoutValue, profile: null, sampleHeight: () => 2, terrains: [] };
}

/** Plan, apply "after" to a copy, and return the new level + recipe. */
function runStage(stage: WorldStage, recipeValue: WorldRecipe, layoutValue: RoomLayout) {
  const plan = planStage(stage, input(recipeValue, layoutValue));
  const next = structuredClone(layoutValue);
  applyPlacementGroupChanges(next, plan.groupChanges, "after");
  return { plan, layout: next, recipe: plan.recipeAfter };
}

function cubes(layoutValue: RoomLayout): LayoutPlacement[] {
  return layoutValue.instances.find((group) => group.assetId === CUBE)?.placements ?? [];
}

function generated(layoutValue: RoomLayout, id: string): LayoutPlacement {
  const found = cubes(layoutValue).find((placement) => placement.id === id);
  assert.ok(found, id);
  return found!;
}

export function registerWorldStageTests(check: Check): void {
  check("world stage: planBlockout adds one marker per plan element and records ownership", () => {
    const { plan, layout: after, recipe: next } = runStage(planBlockoutStage, recipe(), layout());
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.warnings, []);
    assert.deepEqual(plan.added, [
      "wb-blockout-settlement-village", "wb-blockout-settlement-hamlet",
      "wb-blockout-landmark-depot", "wb-blockout-roadNode-n1",
    ]);
    assert.equal(plan.empty, false);
    assert.deepEqual(plan.groupChanges.map((change) => change.assetId), [CUBE]);
    assert.equal(cubes(after)[0]!.name, "hand-made cube");
    assert.deepEqual(generated(after, "wb-blockout-settlement-village"), {
      id: "wb-blockout-settlement-village", role: "marker.settlement", name: "village",
      position: [10.123, 8, 20], scale: [12, 24, 12],
    });
    assert.deepEqual(Object.keys(next.ownership.placements), [...plan.added].sort());
    assert.ok(Object.values(next.ownership.placements).every((entry) => entry.stage === "planBlockout" && /^[0-9a-f]{16}$/.test(entry.outputHash!)));
    assert.deepEqual(next.generators, { planBlockout: 1 });
    assert.deepEqual(next.generation.stages, ["planBlockout"]);
    assert.deepEqual(plan.bounds, { min: [-40, -30], max: [10.123, 20] });
  });

  check("world stage: a re-run is empty and survives a save + reload (WB-01, WB-02)", () => {
    const first = runStage(planBlockoutStage, recipe(), layout());
    const again = planStage(planBlockoutStage, input(first.recipe, first.layout));
    assert.equal(again.empty, true);
    assert.equal(again.unchanged, 4);

    const reloaded = JSON.parse(JSON.stringify(validateLayout(first.layout))) as RoomLayout;
    const afterSave = planStage(planBlockoutStage, input(first.recipe, reloaded));
    assert.equal(afterSave.empty, true);
    assert.deepEqual(afterSave.kept, []);
    for (const placement of cubes(first.layout).filter((entry) => entry.id)) {
      assert.deepEqual(validatePlacement(placement), placement, "stage output must be save-canonical");
    }
    const twice = runStage(planBlockoutStage, recipe(), layout());
    assert.equal(JSON.stringify(twice.plan), JSON.stringify(first.plan));
  });

  check("world stage: plan edits update and remove only the stage's own objects", () => {
    const first = runStage(planBlockoutStage, recipe(), layout());
    const changed = structuredClone(first.recipe);
    changed.plan.settlements[0]!.center = [12, 20];
    changed.plan.landmarks = [];
    const { plan, layout: after, recipe: next } = runStage(planBlockoutStage, changed, first.layout);
    assert.deepEqual(plan.updated, ["wb-blockout-settlement-village"]);
    assert.deepEqual(plan.removed, ["wb-blockout-landmark-depot"]);
    assert.equal(plan.unchanged, 2);
    assert.deepEqual(generated(after, "wb-blockout-settlement-village").position, [12, 8, 20]);
    assert.equal(next.ownership.placements["wb-blockout-landmark-depot"], undefined);
    assert.equal(cubes(after)[0]!.name, "hand-made cube");
    assert.deepEqual(after.instances[0], layout().instances[0]);
  });

  check("world stage: hand edits and deletions are kept unless preserveManualOverrides is off (WB-08)", () => {
    const first = runStage(planBlockoutStage, recipe(), layout());
    const edited = structuredClone(first.layout);
    generated(edited, "wb-blockout-settlement-hamlet").position = [-41, 8, 5];
    const cubeGroup = edited.instances.find((group) => group.assetId === CUBE)!;
    cubeGroup.placements = cubeGroup.placements.filter((placement) => placement.id !== "wb-blockout-roadNode-n1");

    const kept = planStage(planBlockoutStage, input(first.recipe, edited));
    assert.deepEqual(kept.kept, [
      { id: "wb-blockout-roadNode-n1", reason: "deletedByHand" },
      { id: "wb-blockout-settlement-hamlet", reason: "editedByHand" },
    ]);
    assert.equal(kept.empty, true);

    const overwrite = structuredClone(first.recipe);
    overwrite.generation.preserveManualOverrides = false;
    const forced = runStage(planBlockoutStage, overwrite, edited);
    assert.deepEqual(forced.plan.added, ["wb-blockout-roadNode-n1"]);
    assert.deepEqual(forced.plan.updated, ["wb-blockout-settlement-hamlet"]);
    assert.deepEqual(generated(forced.layout, "wb-blockout-settlement-hamlet").position, [-40, 8, 5]);
  });

  check("world stage: wanted ids held by manual objects, other stages or protected regions are blocked", () => {
    const start = layout();
    start.instances[1]!.placements.push({ id: "wb-blockout-settlement-village", position: [0, 0, 0] });
    const value = recipe();
    value.ownership.placements["wb-blockout-landmark-depot"] = { stage: "otherStage" };
    value.ownership.protectedRegions.push({ id: "keep_out", kind: "manual", min: [-50, 0], max: [-30, 10] });
    const plan = planStage(planBlockoutStage, input(value, start));
    assert.deepEqual(plan.blocked, [
      { id: "wb-blockout-settlement-village", reason: "manual" },
      { id: "wb-blockout-settlement-hamlet", reason: "protected" },
      { id: "wb-blockout-landmark-depot", reason: "otherStage" },
    ]);
    assert.deepEqual(plan.added, ["wb-blockout-roadNode-n1"]);
    assert.deepEqual(plan.errors, []);

    const first = runStage(planBlockoutStage, recipe(), layout());
    const guarded = structuredClone(first.recipe);
    guarded.ownership.protectedRegions.push({ id: "keep", kind: "manual", min: [0, 10], max: [20, 30] });
    guarded.plan.settlements[0]!.center = [15, 25];
    const protectedPlan = planStage(planBlockoutStage, input(guarded, first.layout));
    assert.deepEqual(protectedPlan.kept, [{ id: "wb-blockout-settlement-village", reason: "protected" }]);
    assert.deepEqual(protectedPlan.updated, []);
  });

  check("world stage: applying before after after restores the level exactly, group order included", () => {
    const start: RoomLayout = { ...layout(), instances: [{ assetId: "mesh:rock", placements: [{ position: [1, 0, 1] }] }] };
    const first = runStage(planBlockoutStage, recipe(), start);
    assert.deepEqual(first.plan.groupChanges[0]!.before, null);
    const empty = structuredClone(first.recipe);
    empty.plan = createWorldRecipe("x").plan;
    const cleared = runStage(planBlockoutStage, empty, first.layout);
    assert.deepEqual(cleared.layout, start, "removing every marker drops the now-empty group");

    const roundTrip = structuredClone(cleared.layout);
    applyPlacementGroupChanges(roundTrip, cleared.plan.groupChanges, "before");
    assert.deepEqual(roundTrip, first.layout);

    const middle: RoomLayout = { ...layout(), instances: [
      { assetId: "mesh:a", placements: [{ position: [0, 0, 0] }] },
      { assetId: CUBE, placements: [{ id: "only", position: [0, 0, 0] }] },
      { assetId: "mesh:b", placements: [{ position: [0, 0, 0] }] },
    ] };
    const restored = structuredClone(middle);
    const change = [{ assetId: CUBE, beforeIndex: 1, before: middle.instances[1]!.placements, after: null }];
    applyPlacementGroupChanges(restored, change, "after");
    assert.deepEqual(restored.instances.map((group) => group.assetId), ["mesh:a", "mesh:b"]);
    applyPlacementGroupChanges(restored, change, "before");
    assert.deepEqual(restored, middle);
  });

  check("world stage: malformed stage output is an error, not a partial apply", () => {
    const broken: WorldStage = {
      id: "broken", label: "Broken", version: 1,
      run: () => ({
        warnings: [],
        placements: [
          { assetId: CUBE, placement: { id: "a", position: [0, 0, 0] } },
          { assetId: CUBE, placement: { id: "a", position: [1, 0, 0] } },
          { assetId: CUBE, placement: { id: "b", position: [0, 0, 0], scale: 0 } },
          { assetId: "", placement: { id: "c", position: [0, 0, 0] } },
        ],
      }),
    };
    const plan = planStage(broken, input(recipe(), layout()));
    assert.deepEqual(plan.errors, [
      'stage output repeats id "a"',
      "stage output b: scale must be within (0, 1000]",
      "stage output c: assetId must be a non-empty string",
    ]);
    const badVersion = planStage({ ...broken, version: 0 }, input(recipe(), layout()));
    assert.deepEqual(badVersion.errors, ["stage broken version must be a positive integer"]);
  });

  check("world stage: default stages are unique tokens with positive versions", () => {
    const stages = createDefaultWorldStages();
    assert.deepEqual(stages.map((stage) => stage.id), ["planBlockout", "roads", "settlementSites", "streets", "parcels", "landUse", "buildings"]);
    assert.ok(stages.every((stage) => Number.isInteger(stage.version) && stage.version > 0));
  });
}
