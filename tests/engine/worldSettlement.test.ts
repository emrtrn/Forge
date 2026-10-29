/**
 * World Builder F1, step 9a: settlement program (L1, WB-14) and site selection
 * (L2) — plan v0.4 §13.3, §13.5. The program is derived from population and the
 * region profile, then game and recipe rows merge by role; the site slides from
 * the planned centre only to get out of steep, flooded, protected or
 * off-terrain ground, or for a clearly better score, and says why.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { growCore, inCore } from "../../engine/worldbuilder/core";
import { deriveSettlementProgram, type ProgramExtension } from "../../engine/worldbuilder/program";
import { createWorldRecipe, normalizeWorldRecipe, type PlanSettlement, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import type { RouteContext } from "../../engine/worldbuilder/route";
import { estimateCoreRadius, selectSite } from "../../engine/worldbuilder/siteSelection";
import { applyPlacementGroupChanges, planStage, type StageInput } from "../../engine/worldbuilder/stage";
import { settlementSitesStage, siteMarkerId } from "../../engine/worldbuilder/stages/settlementSites";

type Check = (label: string, fn: () => void) => void;

function profile(): RegionProfile {
  const { profile: value } = normalizeRegionProfile(
    JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8")),
  );
  return value!;
}

function village(extra: Partial<PlanSettlement> = {}): PlanSettlement {
  return { id: "v1", source: "manual", center: [0, 0], type: "village", population: 220, ...extra };
}

function context(sampleHeight: RouteContext["sampleHeight"], edit?: (recipe: WorldRecipe) => void): RouteContext {
  const recipe = createWorldRecipe("settlement_test", 1);
  edit?.(recipe);
  return { recipe, profile: profile(), terrains: [], sampleHeight };
}

const lines = (program: ReturnType<typeof deriveSettlementProgram>) =>
  program.lines.map((line) => `${line.role}×${line.count}@${line.siting}:${line.source}`);

export function registerWorldSettlementTests(check: Check): void {
  check("world settlement: population and the region profile give dwellings and facilities (WB-14)", () => {
    const program = deriveSettlementProgram(village(), profile());
    assert.equal(program.dwellings, 74, "220 / 3 persons per dwelling, rounded up");
    assert.deepEqual(lines(program), [
      "open.square×1@center:profile",
      "building.civic.hall×1@center:profile",
      "building.commercial.shop×2@mainRoad:profile",
      "building.industrial.workshop×1@downstream:profile",
    ], "the school needs 300 residents");
    assert.deepEqual(program.warnings, []);
    const town = deriveSettlementProgram(village({ population: 900 }), profile());
    assert.ok(lines(town).includes("building.civic.school×2@center:profile"), "one per 600, rounded up");
  });

  check("world settlement: game rows and recipe add/remove merge by role, bad rows are reported (WB-14)", () => {
    const game: ProgramExtension = (settlement) => settlement.type === "village"
      ? [
        { role: "building.transport.depot", count: 1, siting: "entrance" },
        { role: "building.commercial.shop", count: 3 },
        { role: "Not A Role", count: 1 },
      ]
      : [];
    const broken: ProgramExtension = () => {
      throw new Error("boom");
    };
    const program = deriveSettlementProgram(village({
      program: {
        remove: ["building.industrial.workshop", "building.civic.school"],
        add: [{ role: "building.transport.depot", count: 2, siting: "entrance" }],
      },
    }), profile(), [game, broken]);
    assert.deepEqual(lines(program), [
      "open.square×1@center:profile",
      "building.civic.hall×1@center:profile",
      "building.commercial.shop×3@any:game",
      "building.transport.depot×2@entrance:recipe",
    ]);
    assert.deepEqual(program.warnings, [
      "settlement v1: ignored a game program row with role \"Not A Role\" and count 1",
      "settlement v1: game program extension 1 failed (boom)",
      "settlement v1: program.remove names building.civic.school, which the program does not hold",
      "settlement v1: role building.transport.depot has no spec in the region profile; it gets a default placeholder",
    ]);
  });

  check("world settlement: no population or no profile still yields a program, with warnings", () => {
    const empty = deriveSettlementProgram(village({ population: undefined }), profile());
    assert.equal(empty.dwellings, 0);
    assert.deepEqual(empty.lines, [], "every neutral row needs residents");
    assert.deepEqual(empty.warnings, ["settlement v1 has no population; only fixed-count program rows apply"]);
    const bare = deriveSettlementProgram(village({ program: { add: [{ role: "building.transport.depot", count: 1 }] } }), null);
    assert.equal(bare.dwellings, 0);
    assert.deepEqual(lines(bare), ["building.transport.depot×1@any:recipe"]);
    assert.deepEqual(bare.warnings, ["settlement v1 has no region profile; its program holds only game and recipe rows"]);
  });

  check("world settlement: core radius covers the program's parcels plus circulation", () => {
    const program = deriveSettlementProgram(village(), profile());
    // 74 × 19·29 + 35·35 + 37·45 + 2 × 15·24 + 42·55 = 46 694 m²; / 0.7; as a disc.
    assert.equal(estimateCoreRadius(program, profile()), 146);
    assert.equal(estimateCoreRadius({ dwellings: 0, lines: [] }, null), 20, "never below the minimum");
  });

  check("world settlement: flat open ground keeps the planned centre", () => {
    const site = selectSite(context(() => 5), village(), 40, profile());
    assert.deepEqual(site.center, [0, 0]);
    assert.equal(site.shift, 0);
    assert.equal(site.reason, undefined);
    assert.equal(site.coreSlopeDeg, 0);
    assert.equal(site.waterDistance, null);
    assert.equal(site.roadDistance, null);
    assert.equal(site.planScore, site.score);
  });

  check("world settlement: a steep, protected or off-terrain centre slides out and says why", () => {
    // West of x = 20 a 30° slope; east of it flat.
    const cliff = (x: number): number => (x < 20 ? (20 - x) * Math.tan(Math.PI / 6) : 0);
    const steep = selectSite(context(cliff), village(), 30, profile());
    assert.equal(steep.reason, "the planned centre is steeper than the limit");
    assert.ok(steep.center![0] > 20, `moved onto the flat (${steep.center})`);
    assert.ok(steep.coreSlopeDeg! <= 14);
    assert.equal(steep.planScore, null);

    const shrine = selectSite(context(() => 0, (recipe) => {
      recipe.ownership.protectedRegions.push({ id: "shrine", kind: "manual", min: [-30, -30], max: [30, 30] });
    }), village(), 25, profile());
    assert.equal(shrine.reason, "the planned centre is protected");
    const [x, z] = shrine.center!;
    assert.ok(Math.abs(x) > 30 || Math.abs(z) > 30);

    const shore = selectSite(context((x) => (x < 40 ? 0 : null)), village({ center: [35, 0] }), 30, profile());
    assert.equal(shore.reason, "the planned centre is off the terrain");
    assert.ok(shore.center![0] < 40 - 30 * 0.886 * 0.9, `the whole core is on terrain (${shore.center})`);
  });

  check("world settlement: low ground beside water is flood-prone, the bank above it is chosen", () => {
    // A V valley rising 0.05 m per metre from a river along z = 0.
    const valley = (_x: number, z: number): number => 0.05 * Math.abs(z);
    const site = selectSite(context(valley, (recipe) => {
      recipe.plan.water.push({ id: "river", source: "manual", kind: "river", path: [[-500, 0], [500, 0]] });
    }), village({ center: [0, 20] }), 25, profile());
    assert.equal(site.reason, "the planned centre is flood-prone");
    assert.ok(Math.abs(site.center![1]) >= 60, `3 m above the river is 60 m out (${site.center})`);
    assert.ok(site.waterDistance! < 100, "but still near the water");
  });

  check("world settlement: preferred aspect picks the side of a ridge; no site stops with the reasons", () => {
    const ridge = (x: number): number => -0.05 * Math.abs(x);
    const east = selectSite(context(ridge), village(), 20, profile(), { preferredAspect: [1, 0] });
    const west = selectSite(context(ridge), village(), 20, profile(), { preferredAspect: [-1, 0] });
    assert.ok(east.center![0] > 0, `east-facing (${east.center})`);
    assert.ok(west.center![0] < 0, `west-facing (${west.center})`);

    const wall = selectSite(context((x, z) => x + z), village(), 30, profile());
    assert.equal(wall.center, null);
    assert.equal(wall.reason, "no buildable site within 150 m (100% steeper than the limit)");

    const again = selectSite(context(ridge), village(), 20, profile(), { preferredAspect: [1, 0] });
    assert.deepEqual(again, east, "deterministic");
  });

  check("world settlement: the stage writes sites, programs and grown cores, no placements; a re-run is empty after save + reload (WB-02)", () => {
    const recipe = createWorldRecipe("sites_test", 2);
    recipe.plan.settlements.push(village());
    const first = planStage(settlementSitesStage, stageInput(recipe, () => 5));
    assert.deepEqual(first.errors, []);
    assert.deepEqual([first.added, first.groupChanges], [[], []], "v2 places no core disc");
    const site = first.recipeAfter.generated.sites[0]!;
    assert.deepEqual({ ...site, core: site.core!.length > 3, program: site.program.length }, {
      settlement: "v1", center: [0, 0], coreRadius: site.coreRadius, core: true, score: site.score, dwellings: 74, program: 4,
    });
    // Flat open ground: the core is about the 146 m disc the program needs.
    assert.ok(site.coreRadius >= 146 && site.coreRadius <= 160, `reach ${site.coreRadius}`);
    assert.ok(inCore({ center: site.center, radius: site.coreRadius, outline: site.core }, [140, 0]));
    assert.ok(!inCore({ center: site.center, radius: site.coreRadius, outline: site.core }, [0, 170]));

    const layout = emptyLayout();
    applyPlacementGroupChanges(layout, first.groupChanges, "after");
    const saved = normalizeWorldRecipe(JSON.parse(JSON.stringify(first.recipeAfter)));
    assert.deepEqual(saved.issues, []);
    const again = planStage(settlementSitesStage, { ...stageInput(saved.recipe!, () => 5), layout: JSON.parse(JSON.stringify(layout)) });
    assert.deepEqual({ added: again.added, updated: again.updated, removed: again.removed, kept: again.kept, groups: again.groupChanges.length }, { added: [], updated: [], removed: [], kept: [], groups: 0 });
    assert.deepEqual(again.recipeAfter, again.recipeBefore);
    assert.equal(again.empty, true);
  });

  check("world settlement: no valid site removes the site; a protected settlement keeps its site and core", () => {
    const recipe = createWorldRecipe("sites_test", 2);
    recipe.plan.settlements.push(village(), village({ id: "v2", center: [400, 0], protected: true }));
    const first = planStage(settlementSitesStage, stageInput(recipe, () => 5));
    const layout = emptyLayout();
    applyPlacementGroupChanges(layout, first.groupChanges, "after");

    // The ground turns into a wall: v1 has nowhere to go, protected v2 stays.
    const wall = planStage(settlementSitesStage, { ...stageInput(first.recipeAfter, (x, z) => x + z), layout });
    assert.deepEqual(wall.recipeAfter.generated.sites.map((entry) => [entry.settlement, entry.center]), [["v2", [400, 0]]]);
    assert.ok(wall.warnings.includes(
      "settlement v1: no buildable site within 150 m (100% steeper than the limit); it gets no site — move its centre or widen its radius",
    ), wall.warnings.join(" | "));
  });

  check("world settlement: a core grows along a valley, not up its sides, and reports what stopped it", () => {
    // A valley along X: flat within 30 m of z = 0, walls rising 1:1 beyond.
    const valley = (_x: number, z: number) => Math.max(0, Math.abs(z) - 30);
    const core = growCore(context(valley), [0, 0], Math.PI * 130 * 130, { maxSlopeDeg: 14 });
    const xs = core.outline.map(([x]) => Math.abs(x));
    const zs = core.outline.map(([, z]) => Math.abs(z));
    assert.ok(Math.max(...zs) <= 36, `stays on the floor (|z| ≤ ${Math.max(...zs)})`);
    assert.ok(Math.max(...xs) > 200, `runs along the valley (|x| up to ${Math.max(...xs)})`);
    assert.ok(core.area < core.targetArea && core.area > 0.5 * core.targetArea, `${core.area} of ${core.targetArea} m²`);
    assert.ok((core.stopped.steep ?? 0) > 0 && (core.stopped.reach ?? 0) > 0, JSON.stringify(core.stopped));
    assert.deepEqual(growCore(context(valley), [0, 0], Math.PI * 130 * 130, { maxSlopeDeg: 14 }), core, "deterministic");

    // The stage reports the shortfall.
    const recipe = createWorldRecipe("sites_test", 2);
    recipe.plan.settlements.push(village());
    const plan = planStage(settlementSitesStage, stageInput(recipe, valley));
    assert.ok(plan.warnings.some((warning) => /^settlement v1: the buildable ground around its centre holds \d+% of the core its program needs \(stopped by steep ground/.test(warning)),
      plan.warnings.join(" | "));
  });

  check("world settlement: a v2 run removes the core disc a v1 run placed", () => {
    const recipe = createWorldRecipe("sites_test", 2);
    recipe.plan.settlements.push(village());
    const first = planStage(settlementSitesStage, stageInput(recipe, () => 5));
    const disc = { id: siteMarkerId("v1"), role: "marker.settlement.site", name: "v1 site", position: [0, 5.25, 0] as [number, number, number], scale: [584, 1, 584] as [number, number, number] };
    const layout = { ...emptyLayout(), instances: [{ assetId: "shape:cylinder", placements: [disc] }] };
    const v1 = structuredClone(first.recipeAfter);
    v1.generators.settlementSites = 1;
    v1.ownership.placements[disc.id] = { stage: "settlementSites" };
    const again = planStage(settlementSitesStage, { ...stageInput(v1, () => 5), layout });
    assert.deepEqual(again.removed, [siteMarkerId("v1")]);
  });

  check("world settlement: game program rows reach the stage and a slide is reported", () => {
    const recipe = createWorldRecipe("sites_test", 2);
    recipe.plan.settlements.push(village());
    recipe.ownership.protectedRegions.push({ id: "shrine", kind: "manual", min: [-30, -30], max: [30, 30] });
    const plan = planStage(settlementSitesStage, {
      ...stageInput(recipe, () => 0),
      programExtensions: [() => [{ role: "building.transport.depot", count: 1, siting: "entrance" }]],
    });
    const site = plan.recipeAfter.generated.sites[0]!;
    assert.deepEqual(site.program.at(-1), { role: "building.transport.depot", count: 1, siting: "entrance", source: "game" });
    assert.ok(plan.warnings.some((warning) => /^settlement v1: moved \d+ m from the planned centre \(the planned centre is protected\)$/.test(warning)),
      plan.warnings.join(" | "));
  });
}

function emptyLayout(): StageInput["layout"] {
  return { schema: 1, name: "Sites", loadGroups: [], characters: [], instances: [] };
}

function stageInput(recipe: WorldRecipe, sampleHeight: StageInput["sampleHeight"]): StageInput {
  return { recipe, layout: emptyLayout(), profile: profile(), sampleHeight, terrains: [] };
}
