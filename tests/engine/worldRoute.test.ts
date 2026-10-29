/**
 * World Builder F1, step 8a: the road route solver (plan v0.4 T14, §13.5 L3).
 * The planned line is kept when it works; otherwise A* over the terrain goes
 * around hills, lakes and protected areas, keeps to the guide's side, crosses
 * an unavoidable river once, and reports what it could not fix.
 */
import assert from "node:assert/strict";

import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { createWorldRecipe } from "../../engine/worldbuilder/recipe";
import { roadsStage, roadSplineId } from "../../engine/worldbuilder/stages/roads";
import {
  MAX_ROUTE_POINTS,
  planRoute,
  resampleKeepingVertices,
  ROUTE_SPACING,
  type RouteContext,
  type RouteRequest,
  type RouteResult,
} from "../../engine/worldbuilder/route";

type Check = (label: string, fn: () => void) => void;

const FLAT = (): number => 0;

/** A 40 m Gaussian hill at (0, 100), ~25 m wide: far steeper than 10° on its flanks. */
const HILL = (x: number, z: number): number => 40 * Math.exp(-((x * x + (z - 100) * (z - 100)) / (2 * 25 * 25)));

function context(sampleHeight: RouteContext["sampleHeight"], edit?: (recipe: ReturnType<typeof createWorldRecipe>) => void): RouteContext {
  const recipe = createWorldRecipe("route_test", 1);
  edit?.(recipe);
  return { recipe, profile: null, terrains: [], sampleHeight };
}

const SOUTH_NORTH: RouteRequest = { from: [0, 0], to: [0, 200], maxSlopeDeg: 10, minTurnRadius: 30 };

function length(points: readonly WorldPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  }
  return total;
}

function closestTo(points: readonly WorldPoint[], [x, z]: WorldPoint): number {
  return Math.min(...points.map((point) => Math.hypot(point[0] - x, point[1] - z)));
}

function assertWellFormed(result: RouteResult, request: RouteRequest): void {
  assert.deepEqual(result.points[0], request.from);
  assert.deepEqual(result.points[result.points.length - 1], request.to);
  assert.ok(result.points.length <= MAX_ROUTE_POINTS);
  for (let index = 1; index < result.points.length; index += 1) {
    const leg = Math.hypot(result.points[index]![0] - result.points[index - 1]![0], result.points[index]![1] - result.points[index - 1]![1]);
    assert.ok(leg <= ROUTE_SPACING + 1e-6 && leg > 0, `leg ${index} is ${leg} m`);
  }
}

export function registerWorldRouteTests(check: Check): void {
  check("world route: a planned line within limits is kept as drawn", () => {
    const guide: WorldPoint[] = [[30, 60], [30, 140]];
    const request = { ...SOUTH_NORTH, guide };
    const result = planRoute(context((x, z) => 0.05 * z + 0.01 * x), request)!;
    assert.equal(result.method, "direct");
    assert.equal(result.reason, undefined);
    assert.deepEqual(result.points, resampleKeepingVertices([request.from, ...guide, request.to]));
    assert.equal(result.steepLegs, 0);
    assert.equal(result.waterCrossings, 0);
    assertWellFormed(result, request);
    assert.equal(planRoute(context(FLAT), { ...SOUTH_NORTH, to: [0, 0] }), null, "zero length");
  });

  check("world route: a hill on the line is routed around within the slope limit", () => {
    const direct = planRoute(context(FLAT), SOUTH_NORTH)!;
    const result = planRoute(context(HILL), SOUTH_NORTH)!;
    assert.equal(result.method, "solved");
    assert.match(result.reason!, /^climbs \d+(\.\d)?° \(limit 10°\)$/);
    assert.equal(result.steepLegs, 0, `steepest ${result.maxGradeDeg}°`);
    assert.ok(result.maxGradeDeg! <= 10);
    assert.ok(closestTo(result.points, [0, 100]) > 40, "keeps off the summit");
    assert.ok(length(result.points) > length(direct.points), "a detour is longer than the line");
    assertWellFormed(result, SOUTH_NORTH);
  });

  check("world route: the guide picks the side of an obstacle", () => {
    // Both guides run over a steep flank, so neither is usable as drawn; each still names a side.
    const east = planRoute(context(HILL), { ...SOUTH_NORTH, guide: [[25, 100]] })!;
    const west = planRoute(context(HILL), { ...SOUTH_NORTH, guide: [[-25, 100]] })!;
    assert.equal(east.method, "solved");
    assert.equal(west.method, "solved");
    const sideAt100 = (result: RouteResult): number => result.points.reduce((best, point) =>
      Math.abs(point[1] - 100) < Math.abs(best[1] - 100) ? point : best)[0];
    assert.ok(sideAt100(east) > 20, `east guide passes east (${sideAt100(east)})`);
    assert.ok(sideAt100(west) < -20, `west guide passes west (${sideAt100(west)})`);
  });

  check("world route: a lake is avoided, an unavoidable river is crossed once", () => {
    const lake = planRoute(context(FLAT, (recipe) => {
      recipe.plan.water.push({ id: "lake", source: "manual", kind: "lake", polygon: [[-30, 80], [30, 80], [30, 120], [-30, 120]] });
    }), SOUTH_NORTH)!;
    assert.equal(lake.method, "solved");
    assert.equal(lake.reason, "crosses water");
    assert.equal(lake.waterCrossings, 0);

    // The road surface counts, not just its centre line: 3 m from the shore is dry for a path, wet for a 9 m road.
    const shore = context(FLAT, (recipe) => {
      recipe.plan.water.push({ id: "pond", source: "manual", kind: "lake", polygon: [[3, 80], [40, 80], [40, 120], [3, 120]] });
    });
    assert.equal(planRoute(shore, SOUTH_NORTH)!.method, "direct");
    const wide = planRoute(shore, { ...SOUTH_NORTH, halfWidth: 4.5 })!;
    assert.equal(wide.method, "solved");
    assert.equal(wide.waterCrossings, 0);

    const river = planRoute(context(FLAT, (recipe) => {
      recipe.plan.water.push({ id: "river", source: "manual", kind: "river", path: [[-400, 100], [400, 100]] });
    }), SOUTH_NORTH)!;
    assert.equal(river.waterCrossings, 1);
    assertWellFormed(river, SOUTH_NORTH);
  });

  check("world route: a protected area is routed around; a sealed goal falls back to the planned line", () => {
    const around = planRoute(context(FLAT, (recipe) => {
      recipe.ownership.protectedRegions.push({ id: "shrine", kind: "manual", min: [-20, 90], max: [20, 110] });
    }), SOUTH_NORTH)!;
    assert.equal(around.method, "solved");
    assert.equal(around.reason, "enters a protected area");
    assert.equal(around.protectedHits, 0);
    assert.ok(around.points.every(([x, z]) => !(x >= -20 && x <= 20 && z >= 90 && z <= 110)));

    const sealed = planRoute(context(FLAT, (recipe) => {
      recipe.ownership.protectedRegions.push(
        { id: "n", kind: "manual", min: [-20, 210], max: [20, 220] },
        { id: "s", kind: "manual", min: [-20, 180], max: [20, 190] },
        { id: "w", kind: "manual", min: [-20, 180], max: [-10, 220] },
        { id: "e", kind: "manual", min: [10, 180], max: [20, 220] },
      );
    }), SOUTH_NORTH)!;
    assert.equal(sealed.method, "fallback");
    assert.equal(sealed.reason, "enters a protected area; no route within the corridor");
    assert.deepEqual(sealed.points, resampleKeepingVertices([SOUTH_NORTH.from, SOUTH_NORTH.to]));
    assert.ok(sealed.protectedHits > 0, "the fallback still reports what it breaks");
  });

  check("world route: tight bends are reported, not hidden; runs are deterministic (WB-01)", () => {
    const zigzag: WorldPoint[] = [[10, 20], [-10, 40], [10, 60]];
    const result = planRoute(context(FLAT), { ...SOUTH_NORTH, to: [0, 80], guide: zigzag })!;
    assert.equal(result.method, "direct", "bends alone never trigger the solver");
    assert.ok(result.tightBends > 0);
    assert.ok(result.tightestRadius! < 30);
    assert.equal(planRoute(context(FLAT), SOUTH_NORTH)!.tightestRadius, null, "a straight route has no bend");

    const a = planRoute(context(HILL), { ...SOUTH_NORTH, guide: [[20, 100]] });
    const b = planRoute(context(HILL), { ...SOUTH_NORTH, guide: [[20, 100]] });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  check("world route: a slope steeper than the limit is climbed by a serpentine, its hairpins reported", () => {
    // 24.7° everywhere (the mountain test's hillside path): no straight climb or plain detour stays under 20°.
    const slope = Math.tan((24.7 * Math.PI) / 180);
    const request: RouteRequest = { from: [0, 0], to: [0, 150], maxSlopeDeg: 20, minTurnRadius: 8 };
    const result = planRoute(context((_x, z) => slope * z), request)!;
    assert.equal(result.method, "solved");
    assert.match(result.reason!, /^climbs 24\.7° \(limit 20°\)$/);
    assert.equal(result.steepLegs, 0, `steepest ${result.maxGradeDeg}°`);
    assertWellFormed(result, request);
    const rise = slope * 150;
    assert.ok(length(result.points) >= rise / Math.tan((20 * Math.PI) / 180), "long enough to climb within the limit");
    // Traverses joined by hairpins: the route turns back across the slope.
    let reversals = 0;
    let side = 0;
    for (let index = 1; index < result.points.length; index += 1) {
      const dx = result.points[index]![0] - result.points[index - 1]![0];
      if (Math.abs(dx) < 2) continue;
      if (side !== 0 && Math.sign(dx) !== side) reversals += 1;
      side = Math.sign(dx);
    }
    assert.ok(reversals >= 2, `${reversals} hairpins`);
    assert.ok(result.tightBends > 0 && result.tightestRadius! < request.minTurnRadius, "hairpins tighter than the turn radius are reported");
    assert.equal(JSON.stringify(planRoute(context((_x, z) => slope * z), request)), JSON.stringify(result), "deterministic");
  });

  check("world route: the roads stage writes the solved route and says why", () => {
    const value = context(HILL, (recipe) => {
      recipe.plan.roadGraph.nodes.push(
        { id: "s", source: "manual", position: [0, 0], kind: "end" },
        { id: "n", source: "manual", position: [0, 200], kind: "end" },
      );
      recipe.plan.roadGraph.edges.push({ id: "pass", source: "manual", from: "s", to: "n", roadClass: "collector" });
    });
    const output = roadsStage.run({
      ...value,
      layout: { schema: 1, name: "Route", loadGroups: [], characters: [], instances: [] },
      terrains: [{ id: "valley", min: [-200, -50], max: [200, 250], layers: [], splines: [], locked: false }],
    });
    assert.equal(output.splines!.length, 1);
    const spline = output.splines![0]!.spline;
    assert.equal(spline.id, roadSplineId("pass"));
    assert.ok(closestTo(spline.points.map((point) => [point.position[0], point.position[2]]), [0, 100]) > 40);
    assert.ok(spline.points.every((point) => Math.abs(point.position[1] - HILL(point.position[0], point.position[2])) < 1e-3));
    assert.ok(output.warnings.some((warning) => /^road pass: the planned line climbs .*; routed over the terrain instead$/.test(warning)),
      output.warnings.join("; "));
  });
}
