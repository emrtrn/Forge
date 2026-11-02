import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { metricToWorld, worldToMetric, metricElevationToWorld, gradePercentToDegrees } from "../../engine/worldbuilder/metricFrame";
import { normalizeWorldRecipe } from "../../engine/worldbuilder/recipe";
import { applyPlacementGroupChanges, planStage } from "../../engine/worldbuilder/stage";
import { planBlockoutStage } from "../../engine/worldbuilder/stages/planBlockout";
import { buildRidgeboundPreview, RIDGEBOUND_SOURCE_SHA256 } from "../../tools/world/ridgeboundSpatial";

export function registerRidgeboundSpatialTests(check: (label: string, fn: () => void) => void): void {
  const bytes = readFileSync("tests/engine/fixtures/ridgebound-spatial-master-v0.2.json");
  const master = () => JSON.parse(bytes.toString("utf8"));
  check("metric frame: east/north orientation, vertical datum, inverse and percent grade", () => {
    const frame = { east: 3290, north: 1710, elevation: 100 };
    assert.deepEqual(metricToWorld([3925, 1200], frame), [635, 510]);
    assert.deepEqual(worldToMetric([635, 510], frame), [3925, 1200]);
    assert.deepEqual(metricToWorld([3290, 1710], frame), [0, 0]);
    assert.equal(metricElevationToWorld(250.6, frame), 150.6);
    assert.ok(Math.abs(gradePercentToDegrees(10) - 5.710593) < 0.000001);
    assert.ok(Math.abs(gradePercentToDegrees(-12) + 6.842773) < 0.000001);
    assert.throws(() => metricToWorld([NaN, 0], frame));
    assert.throws(() => metricToWorld([0, 0], { ...frame, north: Infinity }));
    assert.throws(() => gradePercentToDegrees(Infinity));
  });
  check("ridgebound spatial: exact source hash, known checkpoints, B1 anchor and no invented POI-07", () => {
    assert.equal(createHash("sha256").update(bytes).digest("hex"), RIDGEBOUND_SOURCE_SHA256);
    const source = master(), before = structuredClone(source);
    const result = buildRidgeboundPreview(source, RIDGEBOUND_SOURCE_SHA256);
    assert.deepEqual(source, before);
    assert.deepEqual(result.report.checkpoints.find(c => c.id === "V0")?.world, [3925, 4800]);
    assert.deepEqual(result.report.checkpoints.find(c => c.id === "V1")?.world, [1700, 4350]);
    assert.deepEqual(result.report.checkpoints.find(c => c.id === "B1")?.world, [3397, 4670]);
    assert.equal(result.recipe.plan.landmarks.some(p => p.id === "POI-07"), false);
    assert.ok(result.report.warnings.some(w => w.startsWith("MISSING POI-07")));
    assert.equal(result.report.route.widthMetres, 6);
    assert.ok(Math.abs(result.report.route.maxGradeDegrees - 5.710593) < 0.000001);
    assert.equal(result.recipe.plan.roadGraph.edges.length, 1);
    assert.deepEqual(result.recipe.plan.roadGraph.edges[0]!.guide, source.routes.R01.pts.map((p: [number, number]) => [p[0], 6000 - p[1]]));
    assert.deepEqual(normalizeWorldRecipe(JSON.parse(JSON.stringify(result.recipe))).issues, []);
    assert.deepEqual(result.level.instances, []);
    assert.equal(result.level.landscapes, undefined);
    assert.ok(result.report.deferredFields.some(s => s.startsWith("terrain:")));
    assert.deepEqual(buildRidgeboundPreview(master(), RIDGEBOUND_SOURCE_SHA256), result);
  });
  check("ridgebound spatial: rejects invalid axes, endpoints, bridge, coordinates, versions and unhandled root fields", () => {
    const bad = (edit: (m: ReturnType<typeof master>) => void) => {
      const m = master(); edit(m); assert.throws(() => buildRidgeboundPreview(m, RIDGEBOUND_SOURCE_SHA256));
    };
    bad(m => { m.axes.Y = "south_m"; });
    bad(m => { m.nodes.V0.xy = ["3925", 1200]; });
    bad(m => { m.nodes.V0.xy = [7000, 1200]; });
    bad(m => { m.routes.R01.pts[0] = [3924, 1200]; });
    bad(m => { m.routes.R01.pts.splice(3, 1); });
    bad(m => { m.bridges.B1.road_id = "R04"; });
    bad(m => { m.routes.R01.design_width_m = -2; });
    bad(m => { m.version = "0.3"; });
    bad(m => { m.newSpatialGeometry = {}; });
    bad(m => { m.poi["bad/id"] = m.poi["POI-01"]; });
    bad(m => { m.world_extent_m = [0, 0, 0, 6000]; });
  });
  check("ridgebound spatial: new candidate delivery point supported, unknown POIs reported and formula text never executed", () => {
    const m = master();
    m.poi["POI-07"] = { xy: [1720, 1660] };
    m.poi["POI-99"] = { xy: [100, 100] };
    m.hydrology["H-01"].riverx = "throw new Error('must not run')";
    const result = buildRidgeboundPreview(m, "a".repeat(64));
    assert.equal(result.recipe.plan.landmarks.find(p => p.id === "POI-07")?.settlement, "V1");
    assert.ok(result.report.excludedIds.includes("POI-99"));
    assert.ok(!result.report.warnings.some(w => w.startsWith("MISSING POI-07")));
    assert.ok(result.report.warnings.some(w => w.startsWith("Source differs")));
    assert.ok(!result.svg.includes("throw new Error"));
  });
  check("ridgebound spatial: ordinary Plan blockout owns markers, reruns empty and preserves manual edits/deletions", () => {
    const result = buildRidgeboundPreview(master(), RIDGEBOUND_SOURCE_SHA256);
    const input = { recipe: result.recipe, layout: result.level, profile: null, sampleHeight: () => null, terrains: [] };
    const first = planStage(planBlockoutStage, input);
    assert.deepEqual(first.errors, []);
    assert.equal(first.added.length, 11);
    const layout = structuredClone(result.level);
    applyPlacementGroupChanges(layout, first.groupChanges, "after");
    const next = { ...input, layout, recipe: first.recipeAfter };
    assert.equal(planStage(planBlockoutStage, next).empty, true);
    layout.instances[0]!.placements[0]!.position[0] += 10;
    const removed = layout.instances[0]!.placements.splice(1, 1)[0]!;
    const edited = planStage(planBlockoutStage, next);
    assert.ok(edited.kept.some(c => c.reason === "editedByHand"));
    assert.ok(edited.kept.some(c => c.id === removed.id && c.reason === "deletedByHand"));
    assert.equal(edited.added.length, 0);
  });
}
