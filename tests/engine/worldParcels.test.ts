/**
 * World Builder F1, step 10: street-front parcels (plan v0.4 §13.5 L4, WB-15).
 * Every parcel fronts a street at the verge, sits within the profile's
 * frontage/depth ranges, overlaps no other parcel, road, water or protected
 * area, and turns into open land where the ground is too steep. The stage is
 * deterministic and a re-run after save + reload is empty.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sourceDistance } from "../../engine/worldbuilder/field";
import { streetLines } from "../../engine/worldbuilder/masks";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { PARCEL_VERGE, polygonsOverlap, subdivideStreets, type ParcelRequest, type PlannedParcel } from "../../engine/worldbuilder/parcels";
import { createWorldRecipe, normalizeWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import { applyPlacementGroupChanges, planStage, type StageInput } from "../../engine/worldbuilder/stage";
import { parcelMarkerId, parcelsStage } from "../../engine/worldbuilder/stages/parcels";

type Check = (label: string, fn: () => void) => void;

function profile(): RegionProfile {
  const { profile: value } = normalizeRegionProfile(
    JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8")),
  );
  return value!;
}

/** A village sited at the origin with an 80 m core, a W–E collector through it and, optionally, a N–S local street. */
function recipe(crossStreet = false): WorldRecipe {
  const value = createWorldRecipe("parcels_test", 9);
  value.plan.settlements.push({ id: "v1", source: "manual", center: [0, 0], type: "village", population: 60 });
  value.plan.roadGraph.nodes.push(
    { id: "w", source: "manual", position: [-300, 0], kind: "end" },
    { id: "e", source: "manual", position: [300, 0], kind: "end" },
  );
  value.plan.roadGraph.edges.push({ id: "main", source: "manual", from: "w", to: "e", roadClass: "collector" });
  if (crossStreet) {
    value.plan.roadGraph.nodes.push(
      { id: "s", source: "manual", position: [0, -200], kind: "end" },
      { id: "n", source: "manual", position: [0, 200], kind: "end" },
    );
    value.plan.roadGraph.edges.push({ id: "cross", source: "manual", from: "s", to: "n", roadClass: "local" });
  }
  value.generated.sites.push({
    settlement: "v1", center: [0, 0], coreRadius: 80, score: 0.9, dwellings: 20,
    program: [{ role: "open.square", count: 1, siting: "center", source: "profile" }],
  });
  return value;
}

function input(value: WorldRecipe, sampleHeight: StageInput["sampleHeight"] = () => 0): StageInput {
  return {
    recipe: value, profile: profile(), sampleHeight, terrains: [],
    layout: { schema: 1, name: "Parcels", loadGroups: [], characters: [], instances: [] },
  };
}

/** The pure subdivision with the stage's street lines and no other obstacles than roads. */
function subdivide(value: WorldRecipe, overrides: Partial<ParcelRequest> = {}): PlannedParcel[] {
  const lines = streetLines(input(value)).lines;
  const roads = lines.map((line) => ({ kind: "polyline" as const, points: line.points, radii: line.halfWidths }));
  return subdivideStreets({
    settlement: "v1", center: [0, 0], coreRadius: 80, streets: lines,
    frontage: [14, 24], depth: [22, 36], maxSlopeDeg: 14, seed: 9, sampleHeight: () => 0,
    blockedAt: (point) => (roads.some((road) => sourceDistance(point, road) === 0) ? "road" : null),
    ...overrides,
  }).parcels;
}

function assertNoOverlap(parcels: readonly { id: string; polygon: WorldPoint[] }[]): void {
  const inset = (polygon: WorldPoint[]): WorldPoint[] => {
    const cx = polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length;
    const cz = polygon.reduce((sum, [, z]) => sum + z, 0) / polygon.length;
    return polygon.map(([x, z]) => [x + Math.sign(cx - x) * 0.3, z + Math.sign(cz - z) * 0.3]);
  };
  for (let i = 0; i < parcels.length; i += 1) {
    for (let j = i + 1; j < parcels.length; j += 1) {
      assert.ok(!polygonsOverlap(inset(parcels[i]!.polygon), inset(parcels[j]!.polygon)), `${parcels[i]!.id} overlaps ${parcels[j]!.id}`);
    }
  }
}

export function registerWorldParcelTests(check: Check): void {
  check("world parcels: a street through the core gets parcels on both sides at the verge, within the profile ranges (WB-15)", () => {
    const parcels = subdivide(recipe());
    assert.ok(parcels.length >= 10, `${parcels.length} parcels`);
    assert.deepEqual(parcels.slice(0, 3).map((parcel) => parcel.id), ["v1.p1", "v1.p2", "v1.p3"]);
    const half = 4.5; // collector: 7 m + 2 × 1 m shoulder
    const sides = new Set<number>();
    for (const parcel of parcels) {
      assert.equal(parcel.edge, "main");
      const zs = parcel.polygon.map(([, z]) => Math.abs(z));
      const front = Math.min(...zs);
      const back = Math.max(...zs);
      assert.ok(Math.abs(front - (half + PARCEL_VERGE)) < 1e-6, `${parcel.id} front at ${front}`);
      assert.ok(back - front >= 22 - 1e-6 && back - front <= 36 + 1e-6, `${parcel.id} depth ${back - front}`);
      const xs = parcel.polygon.map(([x]) => x);
      const frontage = Math.max(...xs) - Math.min(...xs);
      assert.ok(frontage >= 14 * 0.75 - 1e-6 && frontage <= 24 + 1e-6, `${parcel.id} frontage ${frontage}`);
      sides.add(Math.sign(parcel.polygon[0]![1]));
      assert.equal(parcel.steep, false);
    }
    assert.deepEqual([...sides].sort(), [-1, 1]);
    assertNoOverlap(parcels);
  });

  check("world parcels: a crossing street cuts the strips, no parcel lies on any road (WB-15)", () => {
    const parcels = subdivide(recipe(true));
    const lines = streetLines(input(recipe(true))).lines;
    for (const parcel of parcels) {
      for (const point of parcel.polygon) {
        for (const line of lines) {
          assert.ok(sourceDistance(point, { kind: "polyline", points: line.points, radii: line.halfWidths }) > 0, `${parcel.id} touches ${line.id}`);
        }
      }
    }
    assert.ok(parcels.some((parcel) => parcel.edge === "cross"), "the cross street fronts parcels too");
    assertNoOverlap(parcels);
    // Past the cross street (half width 3 m) the main street's strips resume within a slide step, not a whole frontage.
    for (const side of [1, -1]) {
      const starts = parcels
        .filter((parcel) => parcel.edge === "main" && Math.sign(parcel.polygon[0]![1]) === side)
        .map((parcel) => Math.min(...parcel.polygon.map(([x]) => x)))
        .filter((x) => x > 0);
      assert.ok(Math.min(...starts) <= 3 + 4 + PARCEL_VERGE, `the strip resumes ${Math.min(...starts)} m east of the cross street`);
    }
  });

  check("world parcels: steep ground becomes open land; runs are deterministic, seeds vary the frontages", () => {
    // South of the street the ground climbs 20°, north it is flat.
    const slope = (_x: number, z: number): number => (z < 0 ? -z * Math.tan((20 * Math.PI) / 180) : 0);
    const parcels = subdivide(recipe(), { sampleHeight: slope });
    for (const parcel of parcels) {
      assert.equal(parcel.steep, parcel.polygon[0]![1] < 0, `${parcel.id} at ${parcel.slopeDeg}°`);
    }
    assert.deepEqual(subdivide(recipe()), subdivide(recipe()));
    assert.notDeepEqual(subdivide(recipe()).map((parcel) => parcel.polygon), subdivide(recipe(), { seed: 10 }).map((parcel) => parcel.polygon));
  });

  check("world parcels: the stage keeps parcels off water and protected areas and reports needs (WB-15)", () => {
    const value = recipe();
    value.plan.water.push({ id: "pond", source: "manual", kind: "lake", polygon: [[20, 15], [60, 15], [60, 40], [20, 40]] });
    value.ownership.protectedRegions.push({ id: "chapel", kind: "manual", min: [-60, -40], max: [-30, -6] });
    const plan = planStage(parcelsStage, input(value));
    assert.deepEqual(plan.errors, []);
    const parcels = plan.recipeAfter.generated.parcels;
    assert.ok(parcels.length > 0);
    const pond = { kind: "polygon" as const, polygon: value.plan.water[0]!.polygon! };
    for (const parcel of parcels) {
      assert.equal(parcel.settlement, "v1");
      assert.equal(parcel.frontage, "main");
      for (const point of parcel.polygon) {
        assert.ok(sourceDistance(point, pond) > 5, `${parcel.id} is by the pond`);
        assert.ok(!(point[0] > -60 && point[0] < -30 && point[1] > -40 && point[1] < -6), `${parcel.id} is in the chapel area`);
      }
    }
    assert.match(plan.warnings[0]!, /^settlement v1: \d+ parcels \(0 too steep, kept as open land\) for 21 program needs; dropped \d+ near water, \d+ protected$/);
    assert.equal(plan.added.length, parcels.length);
    assert.equal(plan.added[0], parcelMarkerId("v1.p1"));
    assertNoOverlap(parcels);
  });

  check("world parcels: plates sit on the parcels; a re-run after save + reload is empty (WB-02)", () => {
    const first = planStage(parcelsStage, input(recipe(), () => 3));
    const group = first.groupChanges[0]!;
    assert.equal(group.assetId, "shape:cube");
    const plate = group.after![0]!;
    assert.equal(plate.role, "marker.parcel");
    assert.equal(plate.collision, false);
    assert.equal(plate.position[1], 3.05);
    assert.ok(Math.abs(Math.abs(plate.rotation![1]) % 180) < 0.1, "aligned with the W–E street");

    const layout = input(recipe()).layout;
    applyPlacementGroupChanges(layout, first.groupChanges, "after");
    const saved = normalizeWorldRecipe(JSON.parse(JSON.stringify(first.recipeAfter)));
    assert.deepEqual(saved.issues, []);
    const again = planStage(parcelsStage, { ...input(saved.recipe!, () => 3), layout: JSON.parse(JSON.stringify(layout)) });
    assert.deepEqual({ added: again.added.length, updated: again.updated, removed: again.removed }, { added: 0, updated: [], removed: [] });
    assert.equal(again.empty, true);
  });

  check("world parcels: no sites, no street, or too few parcels are reported", () => {
    const unsited = recipe();
    unsited.generated.sites = [];
    assert.deepEqual(planStage(parcelsStage, input(unsited)).warnings, ["no settlement has a site yet; run Settlement sites first"]);

    const isolated = recipe();
    isolated.plan.roadGraph.edges = [];
    const lonely = planStage(parcelsStage, input(isolated));
    assert.ok(lonely.warnings.includes("settlement v1: no street runs through its 80 m core; connect it with a road edge"), lonely.warnings.join(" | "));

    const crowded = recipe();
    crowded.generated.sites[0]!.dwellings = 500;
    assert.ok(planStage(parcelsStage, input(crowded)).warnings.some((warning) =>
      /^settlement v1: its core's streets hold \d+ buildable parcels, short of 501; add streets through the core or widen it$/.test(warning)));
  });
}
