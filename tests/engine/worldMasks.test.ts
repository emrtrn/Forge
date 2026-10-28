/**
 * World Builder F1, step 7: the spatial query and mask kit (plan v0.4 T04 + T20).
 * Fields sample at cell centres; slope, curvature and distances are checked
 * against closed forms and brute force, and the recipe exclusion mask keeps
 * roads (generated, hand-made and still-planned), water and protected areas
 * clear (WB-07's mask half).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import {
  bandMask,
  boxMask,
  cellCenter,
  createField,
  curvatureField,
  distanceField,
  fieldAt,
  gridSpecForBounds,
  heightField,
  invertMask,
  maskAnd,
  maskCoverage,
  maskMultiply,
  maskOr,
  MAX_FIELD_CELLS,
  polygonMask,
  slopeField,
  type DistanceSource,
  type Field,
  type GridSpec,
} from "../../engine/worldbuilder/field";
import { exclusionMasks, roadSources, type MaskInput } from "../../engine/worldbuilder/masks";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { createWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import type { StageTerrain } from "../../engine/worldbuilder/stage";
import { roadClassWidth } from "../../engine/worldbuilder/roadClass";
import { roadSplineId, roadsStage } from "../../engine/worldbuilder/stages/roads";

type Check = (label: string, fn: () => void) => void;

const near = (actual: number, expected: number, tolerance: number, message?: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? "value"}: ${actual} ≠ ${expected} ± ${tolerance}`);
};

function at(field: Field, x: number, z: number): number {
  const i = Math.floor((x - field.origin[0]) / field.cellSize);
  const j = Math.floor((z - field.origin[1]) / field.cellSize);
  return field.values[j * field.width + i]!;
}

function profile(): RegionProfile {
  const { profile: value } = normalizeRegionProfile(
    JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8")),
  );
  return value!;
}

function segmentDistance([x, z]: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

const SPEC: GridSpec = gridSpecForBounds({ min: [-50, -40], max: [50, 40] }, 2);

export function registerWorldMasksTests(check: Check): void {
  check("world masks: grid spec covers the bounds, cell centres and the cell cap", () => {
    assert.deepEqual(SPEC, { origin: [-50, -40], cellSize: 2, width: 50, depth: 40 });
    assert.deepEqual(cellCenter(SPEC, 0, 0), [-49, -39]);
    assert.deepEqual(cellCenter(SPEC, 49, 39), [49, 39]);
    // A partial last cell still gets a cell.
    const partial = gridSpecForBounds({ min: [0, 0], max: [5, 3] }, 2);
    assert.equal(partial.width, 3);
    assert.equal(partial.depth, 2);
    assert.throws(() => gridSpecForBounds({ min: [0, 0], max: [1, 1] }, 0), /positive/);
    assert.throws(() => gridSpecForBounds({ min: [0, 0], max: [0, 1] }, 1), /extent/);
    assert.throws(() => gridSpecForBounds({ min: [0, 0], max: [3000, 3000] }, 1), new RegExp(String(MAX_FIELD_CELLS)));
  });

  check("world masks: fieldAt interpolates between cell centres and is NaN outside the grid", () => {
    const field = heightField(SPEC, (x, z) => 2 * x + z);
    near(fieldAt(field, 3.3, -7.1), 2 * 3.3 - 7.1, 1e-4, "linear field reproduces exactly");
    // The outer half cell holds the edge value.
    near(fieldAt(field, -50, 0), 2 * -49, 1e-4);
    assert.ok(Number.isNaN(fieldAt(field, 50.5, 0)));
    assert.ok(Number.isNaN(fieldAt(field, 0, -41)));
  });

  check("world masks: height field marks off-terrain cells as no data, slope reads degrees", () => {
    const heights = heightField(SPEC, (x, z) => (x <= 20 ? 0.1 * x + 0 * z : null));
    assert.ok(Number.isNaN(at(heights, 25, 0)));
    const slope = slopeField(heights);
    const expected = Math.atan(0.1) * 180 / Math.PI;
    // Interior, grid edge and next to the no-data edge all see the same plane.
    for (const [x, z] of [[0, 0], [-49, -39], [19, 5], [-49, 39]] as const) near(at(slope, x, z), expected, 1e-4, `slope at ${x},${z}`);
    assert.ok(Number.isNaN(at(slope, 30, 0)));
    // 45° along a diagonal plane.
    near(at(slopeField(heightField(SPEC, (x, z) => (x + z) / Math.SQRT2)), 0, 0), 45, 1e-3);
  });

  check("world masks: curvature is positive in a bowl, negative on a crest, zero on a plane", () => {
    const bowl = curvatureField(heightField(SPEC, (x, z) => 0.01 * (x * x + z * z)));
    near(at(bowl, 0, 0), 0.04, 1e-5);
    near(at(bowl, 31, -17), 0.04, 1e-4);
    const crest = curvatureField(heightField(SPEC, (x) => -0.02 * x * x));
    near(at(crest, 9, 9), -0.04, 1e-5);
    const plane = curvatureField(heightField(SPEC, (x, z) => 3 * x - z));
    near(at(plane, 13, 7), 0, 1e-4);
  });

  check("world masks: distance field is exact per cell, capped, and 0 inside polygons", () => {
    const line: WorldPoint[] = [[-30, -20], [0, 10], [25, 10]];
    const sources: DistanceSource[] = [
      { kind: "polyline", points: line, radii: [1, 3, 3] },
      { kind: "point", position: [30, -25], radius: 2 },
      { kind: "polygon", polygon: [[-45, 20], [-25, 20], [-25, 35], [-45, 35]] },
    ];
    const cap = 12;
    const field = distanceField(SPEC, sources, cap);
    for (let j = 0; j < SPEC.depth; j += 1) {
      for (let i = 0; i < SPEC.width; i += 1) {
        const centre = cellCenter(SPEC, i, j);
        let best = cap;
        for (let k = 1; k < line.length; k += 1) {
          // Radii run linearly; at the closest point of each leg.
          const a = line[k - 1]!;
          const b = line[k]!;
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const t = Math.min(1, Math.max(0, ((centre[0] - a[0]) * dx + (centre[1] - a[1]) * dz) / (dx * dx + dz * dz)));
          const radius = k === 1 ? 1 + 2 * t : 3;
          best = Math.min(best, Math.max(0, segmentDistance(centre, a, b) - radius));
        }
        best = Math.min(best, Math.max(0, Math.hypot(centre[0] - 30, centre[1] + 25) - 2));
        const inside = centre[0] > -45 && centre[0] < -25 && centre[1] > 20 && centre[1] < 35;
        const outside = Math.hypot(Math.max(0, -45 - centre[0], centre[0] + 25), Math.max(0, 20 - centre[1], centre[1] - 35));
        best = Math.min(best, inside ? 0 : outside);
        near(field.values[j * SPEC.width + i]!, best, 1e-4, `cell ${i},${j}`);
      }
    }
    assert.throws(() => distanceField(SPEC, sources, 0), /maxDistance/);
  });

  check("world masks: polygon and box masks test cell centres", () => {
    const triangle = polygonMask(SPEC, [[[-20, -20], [20, -20], [0, 20]]]);
    assert.equal(at(triangle, 0, 0), 1);
    assert.equal(at(triangle, 15, 15), 0);
    assert.equal(at(triangle, -30, 0), 0);
    const box = boxMask(SPEC, [{ min: [-10, -10], max: [10, 10] }, { min: [100, 100], max: [200, 200] }]);
    assert.equal(maskCoverage(box), (10 * 10) / (50 * 40));
    assert.equal(at(box, 9, -9), 1);
    assert.equal(at(box, 11, 0), 0);
  });

  check("world masks: band mask fades over falloff and treats no data as 0; combinators need one grid", () => {
    const heights = heightField(SPEC, (x) => (x < 40 ? x : null));
    const band = bandMask(heights, { min: -10, max: 10, falloff: 4 });
    assert.equal(at(band, 1, 0), 1);
    near(at(band, 13, 0), 0.25, 1e-6);
    assert.equal(at(band, 21, 0), 0);
    assert.equal(at(band, 45, 0), 0, "no data is not allowed");
    const hard = bandMask(heights, { max: 0 });
    assert.equal(at(hard, -1, 0), 1);
    assert.equal(at(hard, 1, 0), 0);

    const a = createField(SPEC, 0.25);
    const b = createField(SPEC, 0.5);
    assert.equal(maskAnd(a, b).values[0], 0.25);
    assert.equal(maskOr(a, b).values[0], 0.5);
    assert.equal(maskMultiply(a, b).values[0], 0.125);
    assert.equal(invertMask(a).values[0], 0.75);
    assert.throws(() => maskOr(a, createField(gridSpecForBounds({ min: [0, 0], max: [10, 10] }, 2))), /one grid/);
  });

  check("world masks: road sources take world splines at their width and unrealised plan edges at the profile width", () => {
    const fixture = maskWorld();
    const { sources, warnings } = roadSources(fixture);
    assert.deepEqual(warnings, ["terrain west has 1 spline(s) in terrain-local coordinates; they are not in road masks"]);
    // The realised edge comes only from its spline; the planned one from its guide.
    const planned = sources.filter((source) => source.kind === "polyline" && source.points.length === 3);
    assert.equal(planned.length, 1);
    const width = roadClassWidth(fixture.profile, "track");
    assert.deepEqual(planned[0], { kind: "polyline", points: [[0, 0], [20, -20], [40, -20]], radii: [width / 2, width / 2, width / 2] });
  });

  check("world masks: exclusion mask keeps roads, water and protected areas clear (WB-07 mask)", () => {
    const fixture = maskWorld();
    const result = exclusionMasks(SPEC, fixture, { roadClearance: 2, waterClearance: 3 });
    const mainHalf = roadClassWidth(fixture.profile, "collector") / 2;
    const spurHalf = roadClassWidth(fixture.profile, "track") / 2;
    // Generated road (z = 0, x -40..0): inside its width + clearance, not beyond.
    assert.equal(at(result.roads, -21, mainHalf + 1), 1);
    assert.equal(at(result.roads, -21, mainHalf + 5), 0);
    // Hand-made world spline at x = -45, z 10..30, width 4.
    assert.equal(at(result.roads, -45, 21), 1);
    // Still-planned edge, along its guide.
    assert.equal(at(result.roads, 31, -20 + spurHalf + 1), 1);
    // River (path z = 30) and lake polygon.
    assert.equal(at(result.water, 11, 33), 1);
    assert.equal(at(result.water, 11, 39), 0);
    assert.equal(at(result.water, 39, 5), 1);
    // Protected box and the protected settlement disc.
    assert.equal(at(result.protected, -11, -31), 1);
    assert.equal(at(result.protected, 25, 15), 1);
    assert.equal(at(result.protected, 25, 23), 0);
    // A field far from everything stays open, and the union is any of the parts.
    assert.equal(at(result.mask, -21, 21), 0);
    for (let index = 0; index < result.mask.values.length; index += 1) {
      assert.equal(result.mask.values[index], Math.max(result.roads.values[index]!, result.water.values[index]!, result.protected.values[index]!));
    }
    assert.deepEqual(result.warnings.slice(1), ["protected settlement hamlet has neither a boundary nor a radius; it is not in the protected mask"]);
  });

  check("world masks: same input → byte-identical masks; falloff fades the road edge", () => {
    const first = exclusionMasks(SPEC, maskWorld(), { falloff: 4 });
    const second = exclusionMasks(SPEC, maskWorld(), { falloff: 4 });
    assert.deepEqual(Buffer.from(first.mask.values.buffer), Buffer.from(second.mask.values.buffer));
    const partial = Array.from(first.roads.values).filter((value) => value > 0 && value < 1);
    assert.ok(partial.length > 0, "a falloff band exists");
  });
}

/**
 * A 100 × 80 m world on one terrain: a generated `main` road (spline from the
 * roads stage), a hand-made world spline, a legacy local spline, a planned
 * `spur` edge with no spline, a river, a lake, a protected box and settlement.
 */
function maskWorld(): MaskInput {
  const recipe: WorldRecipe = createWorldRecipe("mask_test", 1);
  recipe.plan.roadGraph.nodes.push(
    { id: "a", source: "manual", position: [-40, 0], kind: "end" },
    { id: "b", source: "manual", position: [0, 0], kind: "junction" },
    { id: "c", source: "manual", position: [40, -20], kind: "end" },
  );
  recipe.plan.roadGraph.edges.push(
    { id: "main", source: "manual", from: "a", to: "b", roadClass: "collector" },
    { id: "spur", source: "manual", from: "b", to: "c", roadClass: "track", guide: [[20, -20]] },
  );
  recipe.plan.water.push(
    { id: "river", source: "manual", kind: "river", path: [[-10, 30], [40, 30]] },
    { id: "lake", source: "manual", kind: "lake", polygon: [[35, 0], [45, 0], [45, 10], [35, 10]] },
  );
  recipe.plan.settlements.push(
    { id: "village", source: "manual", center: [25, 15], radius: 6, type: "village", protected: true },
    { id: "hamlet", source: "manual", center: [-30, -30], type: "hamlet", protected: true },
  );
  recipe.ownership.protectedRegions.push({ id: "shrine", kind: "landmark", min: [-14, -34], max: [-8, -28] });

  const terrain: StageTerrain = {
    id: "west", min: [-50, -40], max: [50, 40], locked: false, splines: [], layers: [],
  };
  const value: MaskInput = { recipe, profile: profile(), terrains: [terrain] };
  const generated = roadsStage.run({
    ...value,
    layout: { schema: 1, name: "Masks", loadGroups: [], characters: [], instances: [] },
    sampleHeight: () => 0,
  }).splines!.filter((entry) => entry.edge === "main");
  const manual: TerrainSpline = {
    id: "hand-road", coordinateSpace: "world",
    points: [{ id: "p0", position: [-45, 0, 10], width: 4, falloff: 2 }, { id: "p1", position: [-45, 0, 30], width: 4, falloff: 2 }],
    segments: [{ id: "s0", startPointId: "p0", endPointId: "p1" }],
  };
  const local: TerrainSpline = {
    id: "legacy", points: [{ id: "p0", position: [0, 0, 0], width: 4, falloff: 2 }], segments: [],
  };
  value.terrains[0] = { ...terrain, splines: [...generated.map((entry) => entry.spline), manual, local] };
  recipe.ownership.splines[roadSplineId("main")] = { stage: "roads", edge: "main" };
  return value;
}
