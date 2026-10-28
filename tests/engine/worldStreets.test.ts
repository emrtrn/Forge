/**
 * World Builder F1: inner streets (plan v0.4 §13.5 L3 "yerleşim içi"), organic
 * and contour-following. Streets start on an existing street's edge, stay in
 * the core, keep the local slope limit (contour streets stay nearly level),
 * keep off water, end on a street they meet, are deterministic, give the
 * parcel stage more street front, and a re-run — also after a save + reload —
 * is empty.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeTerrainSplines } from "../../engine/terrain/terrainSplineData";
import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import { sourceDistance } from "../../engine/worldbuilder/field";
import type { StreetLine } from "../../engine/worldbuilder/masks";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { createWorldRecipe, normalizeWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import { planStage, type StageInput, type StageTerrain } from "../../engine/worldbuilder/stage";
import { parcelsStage } from "../../engine/worldbuilder/stages/parcels";
import { streetsStage } from "../../engine/worldbuilder/stages/streets";
import { growInnerStreets, type InnerStreetRequest, type PlannedStreet } from "../../engine/worldbuilder/streets";

type Check = (label: string, fn: () => void) => void;

const TERRAIN = "terrain-1";
const COLLECTOR_HALF = 4.5;

function profile(edit?: (raw: Record<string, any>) => void): RegionProfile {
  const raw = JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8"));
  edit?.(raw);
  const { profile: value, issues } = normalizeRegionProfile(raw);
  assert.deepEqual(issues, []);
  return value!;
}

/** Ground rising `slopeDeg` towards +z; nothing beyond ±500 m. */
function ground(slopeDeg = 0): (x: number, z: number) => number | null {
  const grade = Math.tan((slopeDeg * Math.PI) / 180);
  return (x, z) => (Math.abs(x) <= 500 && Math.abs(z) <= 500 ? z * grade : null);
}

/** A N–S collector through the origin. */
const MAIN: StreetLine = { id: "main", edge: "main", roadClass: "collector", points: [[0, -300], [0, 300]], halfWidths: [COLLECTOR_HALF, COLLECTOR_HALF] };

function request(overrides: Partial<InnerStreetRequest> = {}): InnerStreetRequest {
  return {
    idPrefix: "wb-street-v1", center: [0, 0], coreRadius: 110, streets: [MAIN],
    width: 5, maxSlopeDeg: 14, spacing: 64, length: [40, 110],
    weights: { organic: 1, contourFollow: 1 }, targetFrontage: 1100, seed: 7,
    sampleHeight: ground(), blockedAt: () => false,
    ...overrides,
  };
}

function legs(street: PlannedStreet, sampleHeight: (x: number, z: number) => number | null): number[] {
  return street.points.slice(1).map((point, index) => {
    const from = street.points[index]!;
    return (Math.atan(Math.abs(sampleHeight(point[0], point[1])! - sampleHeight(from[0], from[1])!) / Math.hypot(point[0] - from[0], point[1] - from[1])) * 180) / Math.PI;
  });
}

const polyline = (points: WorldPoint[], half: number) => ({ kind: "polyline" as const, points, radii: points.map(() => half) });

function recipe(dwellings = 40): WorldRecipe {
  const value = createWorldRecipe("streets_test", 5);
  value.plan.settlements.push({ id: "v1", source: "manual", center: [0, 0], type: "village", population: dwellings * 3 });
  value.plan.roadGraph.nodes.push(
    { id: "s", source: "manual", position: [0, -300], kind: "end" },
    { id: "n", source: "manual", position: [0, 300], kind: "end" },
  );
  value.plan.roadGraph.edges.push({ id: "main", source: "manual", from: "s", to: "n", roadClass: "collector" });
  value.generated.sites.push({
    settlement: "v1", center: [0, 0], coreRadius: 110, score: 0.9, dwellings,
    program: [{ role: "open.square", count: 1, siting: "center", source: "profile" }],
  });
  return value;
}

interface World {
  recipe: WorldRecipe;
  terrains: StageTerrain[];
}

function world(value = recipe()): World {
  return { recipe: value, terrains: [{ id: TERRAIN, min: [-500, -500], max: [500, 500], locked: false, splines: [], layers: [] }] };
}

function input(state: World, regionProfile: RegionProfile | null = profile(), slopeDeg = 0): StageInput {
  return {
    recipe: state.recipe, profile: regionProfile, sampleHeight: ground(slopeDeg), terrains: state.terrains,
    layout: { schema: 1, name: "Streets", loadGroups: [], characters: [], instances: [] },
  };
}

/** Runs the stage and applies its spline changes and recipe. */
function apply(state: World, regionProfile = profile(), slopeDeg = 0) {
  const plan = planStage(streetsStage, input(state, regionProfile, slopeDeg));
  assert.deepEqual(plan.errors, []);
  const terrains = state.terrains.map((terrain) => {
    const change = plan.splineChanges.find((entry) => entry.landscapeId === terrain.id);
    return change ? { ...terrain, splines: structuredClone(change.after) } : terrain;
  });
  return { plan, state: { recipe: plan.recipeAfter, terrains } };
}

export function registerWorldStreetTests(check: Check): void {
  check("world streets: organic streets start on a street's edge, stay in the core and keep the slope limit", () => {
    const sampleHeight = ground(8);
    const result = growInnerStreets(request({ weights: { organic: 1, contourFollow: 0 }, sampleHeight }));
    assert.ok(result.streets.length >= 2, `${result.streets.length} streets`);
    assert.deepEqual(result.streets.map((street) => street.id).slice(0, 2), ["wb-street-v1-1", "wb-street-v1-2"]);
    const lines: Array<{ points: WorldPoint[]; half: number }> = [{ points: MAIN.points, half: COLLECTOR_HALF }];
    for (const street of result.streets) {
      assert.equal(street.pattern, "organic");
      // The start lies on the edge of an earlier street.
      const start = street.points[0]!;
      assert.ok(lines.some((line) => Math.abs(sourceDistance(start, polyline(line.points, line.half))) < 0.05), `${street.id} starts at ${start}`);
      for (const point of street.points) assert.ok(Math.hypot(point[0], point[1]) <= 110 + 1e-6, `${street.id} leaves the core at ${point}`);
      for (const grade of legs(street, sampleHeight)) assert.ok(grade <= 14 + 1e-6, `${street.id} leg at ${grade}°`);
      lines.push({ points: street.points, half: 2.5 });
    }
    assert.ok(result.frontage.after > result.frontage.before);
  });

  check("world streets: on a slope contour streets stay level; a flat core grows them as organic", () => {
    const sampleHeight = ground(10);
    const result = growInnerStreets(request({ weights: { organic: 0, contourFollow: 1 }, sampleHeight }));
    assert.ok(result.streets.length >= 1);
    assert.equal(result.flat, false);
    for (const street of result.streets) {
      assert.equal(street.pattern, "contourFollow");
      for (const grade of legs(street, sampleHeight)) assert.ok(grade < 1, `${street.id} leg at ${grade}°`);
    }
    const flat = growInnerStreets(request({ weights: { organic: 0, contourFollow: 1 } }));
    assert.equal(flat.flat, true);
    assert.ok(flat.streets.length > 0 && flat.streets.every((street) => street.pattern === "organic"));
  });

  check("world streets: streets keep off blocked ground, keep their distance and are deterministic", () => {
    const pond = { kind: "polygon" as const, polygon: [[20, 20], [90, 20], [90, 80], [20, 80]] as WorldPoint[] };
    const result = growInnerStreets(request({ blockedAt: (point) => sourceDistance(point, pond) <= 8 }));
    assert.ok(result.streets.length > 0);
    for (const street of result.streets) {
      for (const point of street.points) assert.ok(sourceDistance(point, pond) > 8, `${street.id} at ${point} is by the pond`);
    }
    // Apart from the legs where one starts or ends on another, streets do not touch.
    const inner = (street: PlannedStreet) => street.points.slice(1, street.joined ? -1 : undefined);
    for (const a of result.streets) {
      for (const b of result.streets) {
        if (a === b || inner(b).length < 2) continue;
        for (const point of inner(a)) {
          assert.ok(sourceDistance(point, polyline(inner(b), 2.5)) > 2.5 - 1e-6, `${a.id} at ${point} touches ${b.id}`);
        }
      }
    }
    assert.deepEqual(growInnerStreets(request()), growInnerStreets(request()));
    assert.notDeepEqual(growInnerStreets(request()).streets, growInnerStreets(request({ seed: 8 })).streets);
    assert.deepEqual(growInnerStreets(request({ targetFrontage: 100 })).streets, [], "the main street already offers enough");
  });

  check("world streets: the stage writes local-road splines the parcel stage builds on", () => {
    const state = world();
    const parcelsBefore = planStage(parcelsStage, input(state)).recipeAfter.generated.parcels.length;
    const { plan, state: after } = apply(state);
    assert.ok(plan.added.length >= 2);
    assert.deepEqual(plan.added.slice(0, 2), ["wb-street-v1-1", "wb-street-v1-2"]);
    const spline = after.terrains[0]!.splines.find((entry) => entry.id === "wb-street-v1-1")!;
    assert.equal(spline.coordinateSpace, "world");
    assert.ok(spline.points.every((point) => point.width === 6), "local: 5 m + 2 × 0.5 m shoulder");
    assert.deepEqual(after.recipe.ownership.splines["wb-street-v1-1"]!.stage, "streets");
    assert.match(plan.warnings.find((warning) => warning.startsWith("settlement v1:"))!,
      /^settlement v1: \d+ inner streets \(\d+ organic\), \d+ m; street frontage \d+ m of \d+ m for 41 program needs$/);

    const parcelsAfter = planStage(parcelsStage, input(after)).recipeAfter.generated.parcels;
    assert.ok(parcelsAfter.length > parcelsBefore, `${parcelsAfter.length} parcels, ${parcelsBefore} before`);
    assert.ok(parcelsAfter.some((parcel) => parcel.frontage === undefined), "inner streets front parcels");
  });

  check("world streets: a re-run is empty, also after the terrain and recipe save + reload (WB-02)", () => {
    const { state } = apply(world(), profile(), 10);
    assert.equal(planStage(streetsStage, input(state, profile(), 10)).empty, true);
    const { recipe: reloaded, issues } = normalizeWorldRecipe(JSON.parse(JSON.stringify(state.recipe)));
    assert.deepEqual(issues, []);
    const saved: World = {
      recipe: reloaded!,
      terrains: state.terrains.map((terrain) => ({ ...terrain, splines: normalizeTerrainSplines(JSON.parse(JSON.stringify(terrain.splines))) as TerrainSpline[] })),
    };
    assert.equal(planStage(streetsStage, input(saved, profile(), 10)).empty, true);

    // A protected settlement keeps its streets even when its seed changes.
    saved.recipe.plan.settlements[0]!.protected = true;
    saved.recipe.plan.settlements[0]!.seed = 99;
    assert.equal(planStage(streetsStage, input(saved, profile(), 10)).empty, true);
    saved.recipe.plan.settlements[0]!.protected = false;
    assert.equal(planStage(streetsStage, input(saved, profile(), 10)).empty, false);
  });

  check("world streets: linear-only patterns, missing sites and a full core are reported", () => {
    const linear = profile((raw) => { raw.streetPattern = { ...raw.streetPattern, organic: 0, contourFollow: 0 }; });
    const flat = planStage(streetsStage, input(world(), linear));
    assert.deepEqual(flat.added, []);
    assert.ok(flat.warnings.includes("settlement v1: the street pattern is linear only; no inner streets"), flat.warnings.join(" | "));

    const grid = profile((raw) => { raw.streetPattern = { ...raw.streetPattern, grid: 1 }; });
    assert.ok(planStage(streetsStage, input(world(), grid)).warnings.includes("grid and radial street patterns are not generated yet; their weight is ignored"));

    const unsited = world();
    unsited.recipe.generated.sites = [];
    assert.deepEqual(planStage(streetsStage, input(unsited)).warnings, ["no settlement has a site yet; run Settlement sites first"]);

    const crowded = planStage(streetsStage, input(world(recipe(400))));
    assert.ok(crowded.warnings.some((warning) => /^settlement v1: no room for more streets in its 110 m core .*; short of \d+ m frontage$/.test(warning)), crowded.warnings.join(" | "));
  });
}
