/**
 * World Builder F1, step 2: the `<Level>.worldrecipe.json` schema (plan v0.4
 * §6.3, §13.4). The normalizer is the single source of field shape; the save
 * validator reuses it and rejects anything the normalizer had to correct.
 */
import assert from "node:assert/strict";

import {
  createWorldRecipe,
  normalizeWorldRecipe,
  worldRecipePath,
} from "../../engine/worldbuilder/recipe";
import { collectDroppedFields } from "../../tools/droppedFields";
import { validateSaveWorldRecipePayload } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

/** Exercises every recipe field. Extend it whenever the schema grows. */
function maximalRecipe(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    recipeId: "mountain_delivery_demo",
    seed: 42017,
    generators: { roads: 1, settlement: 2 },
    reference: { image: "references/valley.png", origin: [-256, -256], size: [512, 512], view: "topDown" },
    regionProfile: "regions/test.regionprofile.json",
    plan: {
      regions: [{ id: "ridge", source: "reference", observed: true, confidence: 0.8, kind: "mountain", polygon: [[0, 0], [100, 0], [50, 80]] }],
      water: [
        { id: "river_01", source: "reference", observed: false, confidence: 0.4, kind: "river", path: [[-200, 0], [200, 10]] },
        { id: "lake_01", source: "manual", kind: "lake", polygon: [[10, 10], [30, 10], [20, 30]] },
      ],
      landmarks: [{ id: "depot_01", source: "manual", kind: "logistics.depot", position: [-120, 40], settlement: "village_01" }],
      settlements: [{
        id: "village_01", source: "reference", observed: true, confidence: 0.7,
        center: [312.5, 148.25], radius: 180, boundary: [[250, 100], [380, 100], [380, 200], [250, 200]],
        type: "village", population: 220, economy: ["livestock", "timber"],
        regionProfile: "regions/alpine.regionprofile.json",
        program: { add: [{ role: "building.transport.depot", count: 1, siting: "entrance" }], remove: ["building.civic.school"] },
        seed: 7, protected: true,
      }],
      roadGraph: {
        nodes: [
          { id: "n1", source: "osm", position: [40, 10], kind: "end" },
          { id: "n2", source: "generated", position: [300, 150], kind: "gate", settlement: "village_01" },
        ],
        edges: [{ id: "e1", source: "reference", confidence: 0.6, from: "n1", to: "n2", roadClass: "collector", guide: [[40, 10], [180, 90], [300, 150]] }],
      },
    },
    generated: {
      sites: [{
        settlement: "village_01", center: [318, 152.5], coreRadius: 146, score: 0.812, dwellings: 74,
        program: [
          { role: "open.square", count: 1, siting: "center", source: "profile" },
          { role: "building.transport.depot", count: 1, siting: "entrance", source: "recipe" },
        ],
      }],
      parcels: [{
        id: "village_01.p1", settlement: "village_01", polygon: [[300, 120], [320, 120], [320, 140], [300, 140]],
        frontage: "e1", landUse: "residential", role: "building.residential.detached", placement: "plc-house-1",
      }],
    },
    generation: { preserveManualOverrides: false, stages: ["roads", "settlement"] },
    ownership: {
      placements: { "plc-house-1": { stage: "settlement", inputHash: "9f3a", outputHash: "0b7e" } },
      splines: { "road-e1": { stage: "roads", inputHash: "0c", edge: "e1" } },
      foliageRules: { "rule-meadow": { stage: "scatter" } },
      protectedRegions: [{ id: "manual_corner", kind: "manual", min: [0, 0], max: [64, 64] }],
    },
  };
}

function issuesOf(recipe: Record<string, unknown>): string[] {
  return normalizeWorldRecipe(recipe).issues;
}

export function registerWorldRecipeTests(check: Check): void {
  check("world recipe: sidecar path follows the level naming rule", () => {
    assert.equal(worldRecipePath("assets/starter-content/Levels/Valley.level.json"), "assets/starter-content/Levels/Valley.worldrecipe.json");
    assert.equal(worldRecipePath("/layouts/playground.json"), "layouts/playground.worldrecipe.json");
    assert.equal(worldRecipePath("layouts\\Old.layout.json"), "layouts/Old.worldrecipe.json");
    assert.throws(() => worldRecipePath("layouts/notes.txt"), /\.json level path/);
  });

  check("world recipe: an empty recipe is canonical and issue-free", () => {
    const empty = createWorldRecipe("demo", 3);
    const { recipe, issues } = normalizeWorldRecipe(JSON.parse(JSON.stringify(empty)));
    assert.deepEqual(issues, []);
    assert.deepEqual(recipe, empty);
    assert.deepEqual(normalizeWorldRecipe({ schemaVersion: 1, recipeId: "demo" }).recipe, createWorldRecipe("demo"));
  });

  check("world recipe: maximal recipe has no serialization drift and normalizing is idempotent", () => {
    const input = maximalRecipe();
    const { recipe, issues } = normalizeWorldRecipe(input);
    assert.deepEqual(issues, []);
    assert.deepEqual(collectDroppedFields(input, recipe, "recipe").paths, []);
    assert.deepEqual(normalizeWorldRecipe(JSON.parse(JSON.stringify(recipe))).recipe, recipe);

    const saved = validateSaveWorldRecipePayload({ level: "assets/Levels/Valley.level.json", recipe: input });
    assert.equal(saved.path, "assets/Levels/Valley.worldrecipe.json");
    assert.deepEqual(saved.recipe, recipe);
  });

  check("world recipe: plan elements default to manual provenance; coordinates round like layouts", () => {
    const { recipe } = normalizeWorldRecipe({
      schemaVersion: 1, recipeId: "demo",
      plan: { settlements: [{ id: "s", center: [1.23456, -7.0004], type: "hamlet" }] },
    });
    assert.deepEqual(recipe!.plan.settlements[0], { id: "s", source: "manual", center: [1.235, -7], type: "hamlet" });
  });

  check("world recipe: not-a-recipe documents normalize to null", () => {
    assert.equal(normalizeWorldRecipe(null).recipe, null);
    assert.equal(normalizeWorldRecipe({ schemaVersion: 2, recipeId: "demo" }).recipe, null);
    assert.equal(normalizeWorldRecipe({ schemaVersion: 1, recipeId: "has space" }).recipe, null);
  });

  check("world recipe: bad entries and dangling references are dropped with a path", () => {
    const input = maximalRecipe();
    const plan = input.plan as Record<string, any>;
    plan.settlements.push({ id: "village_01", center: [0, 0], type: "village" });
    plan.roadGraph.edges.push({ id: "e2", from: "n1", to: "missing", roadClass: "local" });
    plan.roadGraph.edges.push({ id: "e3", from: "n1", to: "n1", roadClass: "local" });
    plan.roadGraph.edges.push({ id: "e4", from: "n1", to: "n2", roadClass: "motorway" });
    plan.landmarks.push({ id: "lm", kind: "viewpoint", position: [0, 0], settlement: "nowhere" });
    plan.water.push({ id: "both", kind: "lake", path: [[0, 0], [1, 1]], polygon: [[0, 0], [1, 0], [0, 1]] });
    plan.regions.push({ id: "far", kind: "plain", polygon: [[0, 0], [2_000_000, 0], [0, 1]] });
    plan.regions.push({ id: "low", kind: "plain", polygon: [[0, 0], [1, 0], [0, 1]], confidence: 2 });
    (input.generated as Record<string, any>).parcels.push({ id: "orphan", settlement: "gone", polygon: [[0, 0], [1, 0], [0, 1]] });
    const sites = (input.generated as Record<string, any>).sites;
    sites[0].program.push({ role: "building.x", count: 1, siting: "nowhere", source: "profile" });
    sites.push({ settlement: "village_01", center: [0, 0], coreRadius: 20, dwellings: 1.5 });
    sites.push({ settlement: "gone", center: [0, 0], coreRadius: 20, dwellings: 0 });
    sites.push({ settlement: "village_01", center: [0, 0], coreRadius: 20, dwellings: 0, program: [] });
    const ownership = input.ownership as Record<string, any>;
    ownership.placements["has space"] = { stage: "props" };
    ownership.placements["plc-x"] = { stage: "Props" };
    ownership.splines["road-e9"] = { stage: "roads", edge: "e9" };
    ownership.protectedRegions.push({ id: "flat", kind: "manual", min: [5, 5], max: [5, 9] });

    const { recipe, issues } = normalizeWorldRecipe(input);
    assert.deepEqual(issues, [
      'plan.settlements[1]: repeats id "village_01"',
      "plan.regions[1].polygon[1]: must be [x, z] within ±1000000",
      "plan.regions[2].confidence: must be a number 0..1",
      "plan.water[2]: needs exactly one of path or polygon",
      "plan.landmarks[1].settlement: must name an existing element",
      "plan.roadGraph.edges[1].to: must name a road node",
      "plan.roadGraph.edges[2]: from and to must differ",
      "plan.roadGraph.edges[3].roadClass: must be one of highway, arterial, collector, local, track, path",
      "generated.sites[0].program[2].siting: must be one of center, mainRoad, edge, downstream, entrance, any",
      "generated.sites[1].dwellings: must be a non-negative integer",
      "generated.sites[2].settlement: must name a plan settlement",
      'generated.sites[3].settlement: repeats settlement "village_01"',
      "generated.parcels[1].settlement: must name a plan settlement",
      "ownership.placements.has space: key must be an id",
      "ownership.placements.plc-x: needs a stage token",
      "ownership.splines.road-e9.edge: must name an existing element",
      "ownership.protectedRegions[1]: min must be below max on both axes",
    ]);
    assert.equal(recipe!.plan.settlements.length, 1);
    assert.deepEqual(recipe!.plan.roadGraph.edges.map((edge) => edge.id), ["e1"]);
    assert.equal(recipe!.plan.landmarks[1]!.settlement, undefined);
    assert.equal(recipe!.plan.regions[1]!.confidence, undefined);
    assert.deepEqual(recipe!.ownership.splines["road-e9"], { stage: "roads" });
    assert.deepEqual(Object.keys(recipe!.ownership.placements), ["plc-house-1"]);
    assert.equal(recipe!.generated.sites.length, 1);
    assert.equal(recipe!.generated.sites[0]!.program.length, 2);
  });

  check("world recipe: save rejects a recipe the normalizer had to correct, and bad level paths", () => {
    const input = maximalRecipe();
    (input.plan as Record<string, any>).roadGraph.edges[0].to = "missing";
    assert.throws(
      () => validateSaveWorldRecipePayload({ level: "Levels/V.level.json", recipe: input }),
      /invalid world recipe: plan\.roadGraph\.edges\[0\]\.to: must name a road node/,
    );
    assert.throws(() => validateSaveWorldRecipePayload({ level: "Levels/V.level.json", recipe: { schemaVersion: 9 } }), /schemaVersion must be 1/);
    assert.throws(() => validateSaveWorldRecipePayload({ level: "../V.level.json", recipe: maximalRecipe() }), /level must be/);
    assert.throws(() => validateSaveWorldRecipePayload({ level: "Levels/V.png", recipe: maximalRecipe() }), /level must be/);
  });

  check("world recipe: ownership keys are written in sorted order", () => {
    const { recipe } = normalizeWorldRecipe({
      schemaVersion: 1, recipeId: "demo",
      ownership: { placements: { "plc-b": { stage: "props" }, "plc-a": { stage: "props" } } },
    });
    assert.deepEqual(Object.keys(recipe!.ownership.placements), ["plc-a", "plc-b"]);
  });
}
