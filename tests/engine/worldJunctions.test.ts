/**
 * World Builder F1, step 8b: village-scale T/Y junctions (plan v0.4 T15), as
 * spline data only. The two highest-class roads run through the node, the
 * others end at the through road's edge; sharp Ys and too-short branches are
 * reported, and a re-run of the roads stage stays empty.
 */
import assert from "node:assert/strict";

import { resolveJunctions, trimEnd, type JunctionRoad } from "../../engine/worldbuilder/junctions";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { createWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { applyPlacementGroupChanges, planStage, type StageInput, type StageTerrain } from "../../engine/worldbuilder/stage";
import { roadSplineId, roadsStage } from "../../engine/worldbuilder/stages/roads";
import type { RoadClass } from "../../engine/worldbuilder/vocabulary";

type Check = (label: string, fn: () => void) => void;

function road(edge: string, from: string, to: string, roadClass: RoadClass, width: number, points: WorldPoint[]): JunctionRoad {
  return { edge, from, to, roadClass, width, points };
}

const near = (actual: number, expected: number, message: string): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`);
};

export function registerWorldJunctionTests(check: Check): void {
  check("world junctions: trimEnd cuts either end by length and never leaves a sliver", () => {
    const line: WorldPoint[] = [[0, 0], [10, 0], [20, 0]];
    assert.deepEqual(trimEnd(line, "from", 4), [[4, 0], [10, 0], [20, 0]]);
    assert.deepEqual(trimEnd(line, "to", 14), [[0, 0], [6, 0]]);
    assert.deepEqual(trimEnd(line, "from", 9.8), [[10, 0], [20, 0]], "within half a metre of a vertex starts there");
    assert.equal(trimEnd(line, "from", 19), null, "less than 2 m would remain");
  });

  check("world junctions: a T keeps the through road whole and ends the branch at its edge", () => {
    const roads = [
      road("west", "w", "j", "collector", 9, [[-50, 0], [0, 0]]),
      road("east", "j", "e", "collector", 9, [[0, 0], [50, 0]]),
      road("north", "j", "n", "track", 3.5, [[0, 0], [0, 40]]),
    ];
    const { junctions, warnings } = resolveJunctions(roads);
    assert.deepEqual(junctions, [{ node: "j", through: ["east", "west"], branches: ["north"] }]);
    assert.deepEqual(warnings, []);
    assert.deepEqual(roads[0]!.points, [[-50, 0], [0, 0]]);
    assert.deepEqual(roads[1]!.points, [[0, 0], [50, 0]]);
    assert.deepEqual(roads[2]!.points, [[0, 4.5], [0, 40]], "half the collector's 9 m");
  });

  check("world junctions: class picks the through road, ids break ties, nodes of two roads are left alone", () => {
    const roads = [
      road("a", "j", "p", "local", 5, [[0, 0], [-40, 0]]),
      road("b", "j", "q", "arterial", 12, [[0, 0], [0, -40]]),
      road("c", "j", "r", "local", 5, [[0, 0], [40, 0]]),
      road("d", "r", "s", "track", 3, [[40, 0], [80, 0]]),
    ];
    const { junctions } = resolveJunctions(roads);
    assert.deepEqual(junctions, [{ node: "j", through: ["b", "a"], branches: ["c"] }]);
    // c leaves the node along the through road a's opposite direction: 90° off b, 180° off a.
    assert.deepEqual(roads[2]!.points, [[6, 0], [40, 0]], "half of the wider through road (arterial 12 m)");
    assert.deepEqual(roads[3]!.points, [[40, 0], [80, 0]], "r joins two roads: no junction");
  });

  check("world junctions: a sharp Y is reported and its branch pulled back further; a short branch reaches the node", () => {
    const angle = (20 * Math.PI) / 180;
    const roads = [
      road("main", "w", "j", "collector", 8, [[-50, 0], [0, 0]]),
      road("main2", "j", "e", "collector", 8, [[0, 0], [50, 0]]),
      road("fork", "j", "f", "track", 3, [[0, 0], [40 * Math.cos(angle), 40 * Math.sin(angle)]]),
      road("stub", "j", "g", "path", 1.5, [[0, 0], [0, -5]]),
    ];
    const { warnings } = resolveJunctions(roads);
    assert.deepEqual(warnings, [
      "junction j: road fork meets the through road at 20° (sharper than 30°)",
      "junction j: road stub is too short to end at the through road's edge; it reaches the node",
    ]);
    // Trim = halfWidth / max(sin 20°, 0.5) = 4 / 0.5.
    const start = roads[2]!.points[0]!;
    near(Math.hypot(start[0], start[1]), 8, "fork trim");
    assert.deepEqual(roads[3]!.points, [[0, 0], [0, -5]]);
  });

  check("world junctions: the roads stage writes trimmed branches and a re-run is empty", () => {
    const recipe: WorldRecipe = createWorldRecipe("junction_test", 5);
    recipe.plan.roadGraph.nodes.push(
      { id: "w", source: "manual", position: [-60, 0], kind: "end" },
      { id: "j", source: "manual", position: [0, 0], kind: "junction" },
      { id: "e", source: "manual", position: [60, 0], kind: "end" },
      { id: "n", source: "manual", position: [0, 50], kind: "end" },
    );
    recipe.plan.roadGraph.edges.push(
      { id: "west", source: "manual", from: "w", to: "j", roadClass: "collector" },
      { id: "east", source: "manual", from: "j", to: "e", roadClass: "collector" },
      { id: "north", source: "manual", from: "n", to: "j", roadClass: "track" },
    );
    const terrain: StageTerrain = { id: "flat", min: [-100, -100], max: [100, 100], layers: [], splines: [], locked: false };
    const input = (value: WorldRecipe, terrains: StageTerrain[]): StageInput => ({
      recipe: value, profile: null, terrains, sampleHeight: () => 2,
      layout: { schema: 1, name: "Junction", loadGroups: [], characters: [], instances: [] },
    });

    const plan = planStage(roadsStage, input(recipe, [terrain]));
    assert.deepEqual(plan.errors, []);
    const splines = plan.splineChanges[0]!.after;
    const byId = new Map(splines.map((spline) => [spline.id, spline]));
    const north = byId.get(roadSplineId("north"))!;
    // `north` runs n → j, so its last point is pulled back by the collector's half width (no profile: 7 m → 3.5 m).
    assert.deepEqual(north.points[north.points.length - 1]!.position, [0, 2, 3.5]);
    assert.deepEqual(byId.get(roadSplineId("west"))!.points.at(-1)!.position, [0, 2, 0]);
    assert.deepEqual(byId.get(roadSplineId("east"))!.points[0]!.position, [0, 2, 0]);

    const layout = structuredClone(input(recipe, [terrain]).layout);
    applyPlacementGroupChanges(layout, plan.groupChanges, "after");
    const again = planStage(roadsStage, { ...input(plan.recipeAfter, [{ ...terrain, splines }]), layout });
    assert.equal(again.empty, true);
  });
}
