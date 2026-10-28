/**
 * World Builder F1, step 9a: settlement program (L1, WB-14) and site selection
 * (L2) — plan v0.4 §13.3, §13.5. The program is derived from population and the
 * region profile, then game and recipe rows merge by role; the site slides from
 * the planned centre only to get out of steep, flooded, protected or
 * off-terrain ground, or for a clearly better score, and says why.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deriveSettlementProgram, type ProgramExtension } from "../../engine/worldbuilder/program";
import { createWorldRecipe, type PlanSettlement, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import type { RouteContext } from "../../engine/worldbuilder/route";
import { estimateCoreRadius, selectSite } from "../../engine/worldbuilder/siteSelection";

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
}
