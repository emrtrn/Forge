/**
 * World Builder F1, step 11: land use (plan v0.4 §13.5 L5, T39, WB-16).
 * Program roles land where their siting wants them (civic and the square
 * central, shops on the main street, the workshop by the water), large roles
 * merge neighbouring parcels along one street side, dwellings fill from the
 * centre out, no forbidden land uses touch, the same seed gives the same
 * split, unplaceable lines are reported, and a re-run is empty.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sourceDistance } from "../../engine/worldbuilder/field";
import { assignLandUse, landUseBase, landUseConflicts, mergedPolygon } from "../../engine/worldbuilder/landUse";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { polygonCentroid } from "../../engine/worldbuilder/parcels";
import { createWorldRecipe, normalizeWorldRecipe, type GeneratedParcel, type ProgramLine, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { landUseCompatibility, normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import { planStage, type StageInput } from "../../engine/worldbuilder/stage";
import { landUseStage } from "../../engine/worldbuilder/stages/landUse";
import { parcelsStage } from "../../engine/worldbuilder/stages/parcels";

type Check = (label: string, fn: () => void) => void;

function profile(edit?: (raw: Record<string, any>) => void): RegionProfile {
  const raw = JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8"));
  edit?.(raw);
  const { profile: value, issues } = normalizeRegionProfile(raw);
  assert.deepEqual(issues, []);
  return value!;
}

const PROGRAM: ProgramLine[] = [
  { role: "open.square", count: 1, siting: "center", source: "profile" },
  { role: "building.civic.hall", count: 1, siting: "center", source: "profile" },
  { role: "building.commercial.shop", count: 2, siting: "mainRoad", source: "profile" },
  { role: "building.industrial.workshop", count: 1, siting: "downstream", source: "profile" },
];

/** A village at the origin, 90 m core, W–E collector and N–S local street, a pond to the north-east. */
function recipe(dwellings = 16, program: ProgramLine[] = PROGRAM): WorldRecipe {
  const value = createWorldRecipe("land_use_test", 5);
  value.plan.settlements.push({ id: "v1", source: "manual", center: [0, 0], type: "village", population: dwellings * 3 });
  value.plan.roadGraph.nodes.push(
    { id: "w", source: "manual", position: [-300, 0], kind: "end" },
    { id: "e", source: "manual", position: [300, 0], kind: "end" },
    { id: "s", source: "manual", position: [0, -200], kind: "end" },
    { id: "n", source: "manual", position: [0, 200], kind: "end" },
  );
  value.plan.roadGraph.edges.push(
    { id: "main", source: "manual", from: "w", to: "e", roadClass: "collector" },
    { id: "cross", source: "manual", from: "s", to: "n", roadClass: "local" },
  );
  value.plan.water.push({ id: "pond", source: "manual", kind: "lake", polygon: [[60, 50], [110, 50], [110, 90], [60, 90]] });
  value.generated.sites.push({ settlement: "v1", center: [0, 0], coreRadius: 90, score: 0.9, dwellings, program });
  return value;
}

function input(value: WorldRecipe, regionProfile: RegionProfile | null = profile()): StageInput {
  return {
    recipe: value, profile: regionProfile, sampleHeight: () => 0, terrains: [],
    layout: { schema: 1, name: "LandUse", loadGroups: [], characters: [], instances: [] },
  };
}

/** The recipe after the parcel stage. */
function parcelled(value = recipe(), regionProfile = profile()): WorldRecipe {
  const plan = planStage(parcelsStage, input(value, regionProfile));
  assert.deepEqual(plan.errors, []);
  return plan.recipeAfter;
}

const distance = ([x, z]: WorldPoint): number => Math.hypot(x, z);
const centre = (parcel: GeneratedParcel): number => distance(polygonCentroid(parcel.polygon));
const hostsOf = (parcels: readonly GeneratedParcel[], role: string) => parcels.filter((parcel) => parcel.role === role);
const lotOf = (parcels: readonly GeneratedParcel[], host: GeneratedParcel) =>
  [host, ...parcels.filter((parcel) => parcel.partOf === host.id)];

export function registerWorldLandUseTests(check: Check): void {
  check("world land use: civic and the square take the centre, shops the main street, the workshop the water (L5)", () => {
    const plan = planStage(landUseStage, input(parcelled()));
    assert.deepEqual(plan.errors, []);
    const parcels = plan.recipeAfter.generated.parcels;
    assert.ok(parcels.length >= 20, `${parcels.length} parcels`);
    const homes = hostsOf(parcels, "building.residential.detached");
    assert.equal(homes.length, 16);
    const meanHome = homes.reduce((sum, parcel) => sum + centre(parcel), 0) / homes.length;

    for (const role of ["open.square", "building.civic.hall"]) {
      const [host] = hostsOf(parcels, role);
      assert.ok(host, `${role} placed`);
      assert.ok(centre(host!) < meanHome, `${role} at ${centre(host!)} m, homes average ${meanHome} m`);
    }
    const shops = hostsOf(parcels, "building.commercial.shop");
    assert.equal(shops.length, 2);
    for (const shop of shops) assert.equal(shop.frontage, "main", `${shop.id} fronts the collector`);

    const pond = { kind: "polygon" as const, polygon: plan.recipeAfter.plan.water[0]!.polygon! };
    const [workshop] = hostsOf(parcels, "building.industrial.workshop");
    const wet = (parcel: GeneratedParcel) => sourceDistance(polygonCentroid(parcel.polygon), pond);
    const nearer = parcels.filter((parcel) => wet(parcel) < wet(workshop!)).length;
    assert.ok(nearer <= parcels.length / 4, `${nearer} parcels lie nearer the pond than the workshop`);

    // Dwellings fill from the centre out: every vacant parcel is further out than every home.
    const vacant = parcels.filter((parcel) => parcel.landUse === undefined);
    assert.ok(vacant.length > 0);
    const outermostHome = Math.max(...homes.map(centre));
    for (const parcel of vacant) assert.ok(centre(parcel) >= outermostHome - 12, `${parcel.id} vacant at ${centre(parcel)} m`);
    assert.match(plan.warnings[0]!, /^settlement v1: \d+ parcels → 16 residential, 2 commercial, \d+ civic, 1 industrial, \d+ open, \d+ vacant; \d+ large roles took \d+ parcels$/);
    assert.deepEqual(plan.added, []);
  });

  check("world land use: large roles merge a run of neighbouring parcels on one street side", () => {
    const parcels = planStage(landUseStage, input(parcelled())).recipeAfter.generated.parcels;
    const square = hostsOf(parcels, "open.square")[0]!;
    const lot = lotOf(parcels, square);
    const outline = mergedPolygon(lot);
    assert.ok(outline, "the square's parcels form one strip run");
    const along = (polygon: WorldPoint[]) => {
      const half = polygon.length / 2;
      let length = 0;
      for (let index = 1; index < half; index += 1) length += Math.hypot(polygon[index]![0] - polygon[index - 1]![0], polygon[index]![1] - polygon[index - 1]![1]);
      return length;
    };
    assert.ok(along(outline!) >= 24 - 1e-6, `square frontage ${along(outline!)} m (20 m footprint + 2 × 2 m)`);
    for (const member of lot.slice(1)) {
      assert.equal(member.role, undefined);
      assert.equal(member.landUse, "open");
    }
    // Every merged parcel names a host with a role; no parcel is part of a parcel that is itself merged.
    for (const parcel of parcels.filter((entry) => entry.partOf)) {
      const host = parcels.find((entry) => entry.id === parcel.partOf)!;
      assert.ok(host.role && host.partOf === undefined);
      assert.equal(host.landUse, parcel.landUse);
    }
  });

  check("world land use: no forbidden neighbours, same seed same split (WB-16)", () => {
    const strict = profile((raw) => { raw.zoning.compatibility.industrial.residential = -1; });
    const base = parcelled(recipe(16, [...PROGRAM, { role: "building.industrial.workshop", count: 3, siting: "any", source: "recipe" }]), strict);
    const first = planStage(landUseStage, input(base, strict));
    const parcels = first.recipeAfter.generated.parcels;
    assert.ok(hostsOf(parcels, "building.industrial.workshop").length >= 2);
    const conflicts = landUseConflicts(parcels, strict);
    assert.ok(conflicts.every((pair) => pair.compatibility > -1), JSON.stringify(conflicts));
    for (const pair of conflicts) {
      const a = parcels.find((parcel) => parcel.id === pair.a)!;
      const b = parcels.find((parcel) => parcel.id === pair.b)!;
      assert.equal(landUseCompatibility(strict, a.landUse!, b.landUse!), pair.compatibility);
    }
    const second = planStage(landUseStage, input(structuredClone(base), strict));
    assert.deepEqual(second.recipeAfter.generated.parcels, parcels);
    assert.deepEqual(second.warnings, first.warnings);

    // With the neutral table (-0.8, allowed) the reported count matches the pairs.
    const neutral = planStage(landUseStage, input(parcelled()));
    const pairs = landUseConflicts(neutral.recipeAfter.generated.parcels, profile()).length;
    assert.equal(neutral.warnings.some((warning) => warning.includes(`${pairs} neighbouring parcel pairs`)), pairs > 0);
  });

  check("world land use: a seed changes only tie-breaks; the result is a function of the parcels alone", () => {
    const value = parcelled();
    const parcels = value.generated.parcels.map(landUseBase);
    const request = {
      center: [0, 0] as WorldPoint, coreRadius: 90, parcels, dwellings: 16, program: PROGRAM, profile: profile(),
      edgeClass: (edge: string) => (edge === "main" ? "collector" as const : "local" as const),
      entrances: [], water: [], sampleHeight: () => 0, seed: 1,
    };
    const one = assignLandUse(request);
    assert.deepEqual(assignLandUse(request), one);
    const other = assignLandUse({ ...request, seed: 2 });
    assert.equal(other.assignments.length, one.assignments.length);
    // Stripping the stage's own fields gives back the parcel stage's output.
    assert.deepEqual(one.parcels.map(landUseBase), parcels);
  });

  check("world land use: unplaceable lines are reported with the reason", () => {
    const huge = profile((raw) => { raw.roles["building.civic.hall"].footprint.width = [200, 220]; });
    const crowded = planStage(landUseStage, input(parcelled(recipe(400), huge), huge));
    const warnings = crowded.warnings.join(" | ");
    assert.ok(crowded.warnings.includes("settlement v1: no suitable parcel for 1 of 1 building.civic.hall (no parcel fits it, even merged with its neighbours)"), warnings);
    assert.ok(crowded.warnings.some((warning) => /^settlement v1: no suitable parcel for \d+ of 400 building\.residential\.detached \(no parcel left\)$/.test(warning)), warnings);

    const bare = recipe();
    assert.deepEqual(planStage(landUseStage, input(bare)).warnings, ["no settlement has parcels yet; run Parcels first"]);
  });

  check("world land use: protected settlements keep their parcels; a re-run after save + reload is empty (WB-02)", () => {
    const first = planStage(landUseStage, input(parcelled()));
    assert.equal(first.empty, false);
    const saved = normalizeWorldRecipe(JSON.parse(JSON.stringify(first.recipeAfter)));
    assert.deepEqual(saved.issues, []);
    const again = planStage(landUseStage, input(saved.recipe!));
    assert.equal(again.empty, true);

    const guarded = structuredClone(saved.recipe!);
    guarded.plan.settlements[0]!.protected = true;
    guarded.generated.parcels[0]!.role = "building.civic.chapel";
    const kept = planStage(landUseStage, input(guarded));
    assert.equal(kept.recipeAfter.generated.parcels[0]!.role, "building.civic.chapel");
  });

  check("world land use: partOf must name an unmerged parcel of the same settlement", () => {
    const value = JSON.parse(JSON.stringify(planStage(landUseStage, input(parcelled())).recipeAfter));
    const parcels = value.generated.parcels as GeneratedParcel[];
    const member = parcels.findIndex((parcel) => parcel.partOf);
    assert.ok(member >= 0);
    parcels[0]!.partOf = parcels[0]!.id;
    parcels[1]!.partOf = "nowhere";
    parcels[2]!.partOf = parcels[member]!.id;
    const { recipe: normalized, issues } = normalizeWorldRecipe(value);
    assert.deepEqual(issues, [0, 1, 2].map((index) =>
      `generated.parcels[${index}].partOf: must name another, unmerged parcel of the same settlement`));
    assert.equal(normalized!.generated.parcels[1]!.partOf, undefined);
  });
}
