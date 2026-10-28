/**
 * World Builder F1, step 12b: building placeholders and pad data (plan v0.4
 * §13.4, §13.5 L6; T40, T21). One coloured `shape:cube` per role-holding lot,
 * fitted into the role's footprint behind the setback, entrance facing the
 * street; a pad per building levelled at its corners' mean height; the host
 * parcel names its placement; a re-run after save + reload is empty.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { RoomLayout } from "../../engine/scene/layout";
import { SHAPE_PRIMITIVE_SIZE } from "../../engine/scene/shapes";
import { LAND_USE_COLORS, PAD_MARGIN, planBuilding, SLAB_HEIGHT } from "../../engine/worldbuilder/buildings";
import { sourceDistance } from "../../engine/worldbuilder/field";
import { streetLines } from "../../engine/worldbuilder/masks";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { mulberry32 } from "../../engine/worldbuilder/parcels";
import { createWorldRecipe, normalizeWorldRecipe, type ProgramLine, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "../../engine/worldbuilder/regionProfile";
import { applyPlacementGroupChanges, planStage, type StageInput } from "../../engine/worldbuilder/stage";
import { buildingPlacementId, buildingsStage } from "../../engine/worldbuilder/stages/buildings";
import { landUseStage } from "../../engine/worldbuilder/stages/landUse";
import { parcelsStage } from "../../engine/worldbuilder/stages/parcels";
import { validateLayout } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

function profile(): RegionProfile {
  const { profile: value } = normalizeRegionProfile(
    JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8")),
  );
  return value!;
}

/** A strip parcel north of a W–E street: front edge at z = 5 from x0 to x1, `depth` deep. */
function strip(x0: number, x1: number, depth = 30): { polygon: WorldPoint[] } {
  return { polygon: [[x0, 5], [(x0 + x1) / 2, 5], [x1, 5], [x1, 5 + depth], [(x0 + x1) / 2, 5 + depth], [x0, 5 + depth]] };
}

const PROGRAM: ProgramLine[] = [
  { role: "open.square", count: 1, siting: "center", source: "profile" },
  { role: "building.civic.hall", count: 1, siting: "center", source: "profile" },
  { role: "building.commercial.shop", count: 2, siting: "mainRoad", source: "profile" },
];

/** A village with a W–E collector and N–S local street, parcelled and given land uses. */
function village(): { recipe: WorldRecipe; layout: RoomLayout } {
  let recipe = createWorldRecipe("buildings_test", 5);
  recipe.plan.settlements.push({ id: "v1", source: "manual", center: [0, 0], type: "village", population: 36 });
  recipe.plan.roadGraph.nodes.push(
    { id: "w", source: "manual", position: [-300, 0], kind: "end" },
    { id: "e", source: "manual", position: [300, 0], kind: "end" },
    { id: "s", source: "manual", position: [0, -200], kind: "end" },
    { id: "n", source: "manual", position: [0, 200], kind: "end" },
  );
  recipe.plan.roadGraph.edges.push(
    { id: "main", source: "manual", from: "w", to: "e", roadClass: "collector" },
    { id: "cross", source: "manual", from: "s", to: "n", roadClass: "local" },
  );
  recipe.generated.sites.push({ settlement: "v1", center: [0, 0], coreRadius: 90, score: 0.9, dwellings: 12, program: PROGRAM });
  const layout: RoomLayout = { schema: 1, name: "Buildings", loadGroups: [], characters: [], instances: [] };
  for (const stage of [parcelsStage, landUseStage]) {
    const plan = planStage(stage, input(recipe, layout));
    assert.deepEqual(plan.errors, []);
    applyPlacementGroupChanges(layout, plan.groupChanges, "after");
    recipe = plan.recipeAfter;
  }
  return { recipe, layout };
}

function input(recipe: WorldRecipe, layout: RoomLayout, sampleHeight: StageInput["sampleHeight"] = () => 0): StageInput {
  return { recipe, layout, profile: profile(), sampleHeight, terrains: [] };
}

export function registerWorldBuildingTests(check: Check): void {
  check("world buildings: a footprint fits the role behind the setback, entrance facing the street", () => {
    const spec = profile().roles["building.residential.detached"]!;
    const building = planBuilding({
      lot: [strip(0, 20)], landUse: "residential", spec, parcel: profile().parcels.residential,
      random: mulberry32(3), sampleHeight: () => 2,
    })!;
    assert.ok(building.width >= 8 && building.width <= 12, `width ${building.width}`);
    assert.ok(building.depth >= 8 && building.depth <= 11, `depth ${building.depth}`);
    assert.ok(Math.abs(building.center[0] - 10) < 1e-6);
    assert.ok(Math.abs(building.center[1] - (5 + 3 + building.depth / 2)) < 1e-6, "3 m setback behind the front edge");
    assert.equal(Math.abs(building.yawDeg), 180, "+Z faces the street to the south");
    assert.ok([1, 2].includes(building.storeys));
    assert.equal(building.height, building.storeys * 3);
    assert.equal(building.color, "#f2a65a", "the role's placeholder colour");
    assert.deepEqual({ height: building.pad.height, grading: building.grading, base: building.base }, { height: 2, grading: 0, base: 2 });
    const xs = building.pad.polygon.map(([x]) => x);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - (building.width + 2 * PAD_MARGIN)) < 1e-3);
    assert.equal(building.squeezed, false);
  });

  check("world buildings: merged lots, small lots, open roles and slopes", () => {
    const base = profile();
    const school = planBuilding({
      lot: [strip(0, 14), strip(14, 28)], landUse: "civic", spec: { ...base.roles["building.civic.hall"]!, footprint: { width: [22, 24], depth: [10, 12] } },
      parcel: base.parcels.civic, random: mulberry32(1), sampleHeight: () => 0,
    })!;
    assert.ok(school.width >= 22, `a merged lot holds ${school.width} m`);
    assert.ok(Math.abs(school.center[0] - 14) < 1e-6, "centred on the merged frontage");
    assert.equal(school.color, LAND_USE_COLORS.civic);

    const tight = planBuilding({
      lot: [strip(0, 10)], landUse: "residential", spec: base.roles["building.residential.detached"],
      parcel: base.parcels.residential, random: mulberry32(1), sampleHeight: () => 0,
    })!;
    assert.equal(tight.squeezed, true);
    assert.equal(tight.width, 6, "10 m frontage less 2 × 2 m");

    const square = planBuilding({
      lot: [strip(0, 30)], landUse: "open", spec: base.roles["open.square"], parcel: base.parcels.open,
      random: mulberry32(1), sampleHeight: () => 0,
    })!;
    assert.deepEqual({ storeys: square.storeys, height: square.height }, { storeys: 0, height: SLAB_HEIGHT });

    // Ground rising 0.2 m per metre north: the pad is the corners' mean, the box reaches the lowest corner.
    const slope = (_x: number, z: number) => z * 0.2;
    const sloped = planBuilding({
      lot: [strip(0, 20)], landUse: "residential", spec: base.roles["building.residential.detached"],
      parcel: base.parcels.residential, random: mulberry32(3), sampleHeight: slope,
    })!;
    assert.ok(Math.abs(sloped.pad.height - slope(0, sloped.center[1])) < 0.01, `pad at ${sloped.pad.height}`);
    assert.ok(Math.abs(sloped.base - slope(0, sloped.center[1] - sloped.depth / 2)) < 1e-6);
    assert.ok(Math.abs(sloped.grading - 0.2 * sloped.depth / 2) < 0.01);
    assert.equal(planBuilding({ lot: [strip(0, 20)], landUse: "residential", spec: undefined, parcel: undefined, random: mulberry32(1), sampleHeight: () => null }), null);
  });

  check("world buildings: the stage puts a coloured cube and a pad on every lot, facing its street", () => {
    const { recipe, layout } = village();
    const plan = planStage(buildingsStage, input(recipe, layout));
    assert.deepEqual(plan.errors, []);
    const hosts = recipe.generated.parcels.filter((parcel) => parcel.role !== undefined);
    const cubes = plan.groupChanges.find((group) => group.assetId === "shape:cube")!.after!
      .filter((placement) => placement.id?.startsWith("wb-building-"));
    assert.equal(cubes.length, hosts.length);
    assert.equal(plan.recipeAfter.generated.pads.length, hosts.length);
    const streets = streetLines(input(recipe, layout)).lines.map((line) => ({ kind: "polyline" as const, points: line.points, radii: line.halfWidths }));
    const toStreet = (point: WorldPoint) => Math.min(...streets.map((street) => sourceDistance(point, street)));
    for (const host of hosts) {
      const cube = cubes.find((placement) => placement.id === buildingPlacementId(host.id))!;
      assert.ok(cube, host.id);
      assert.equal(cube.role, host.role);
      assert.equal(cube.color, profile().roles[host.role!]?.placeholderColor ?? LAND_USE_COLORS[host.landUse!]);
      const after = plan.recipeAfter.generated.parcels.find((parcel) => parcel.id === host.id)!;
      assert.equal(after.placement, cube.id);
      // A step out of the entrance (+Z) is nearer a street than the centre.
      const yaw = (cube.rotation![1] * Math.PI) / 180;
      const center: WorldPoint = [cube.position[0], cube.position[2]];
      const depth = (cube.scale as number[])[2]! * SHAPE_PRIMITIVE_SIZE;
      const door: WorldPoint = [center[0] + Math.sin(yaw) * depth, center[1] + Math.cos(yaw) * depth];
      assert.ok(toStreet(door) < toStreet(center), `${cube.id} faces away from its street`);
    }
    assert.match(plan.warnings[0]!, /^settlement v1: \d+ buildings \(\d+ residential, 2 commercial, \d+ civic, \d+ open\)$/);
  });

  check("world buildings: a re-run after save + reload is empty; protected settlements keep theirs (WB-02)", () => {
    const { recipe, layout } = village();
    const first = planStage(buildingsStage, input(recipe, layout));
    applyPlacementGroupChanges(layout, first.groupChanges, "after");
    const savedLayout = validateLayout(JSON.parse(JSON.stringify(layout))) as unknown as RoomLayout;
    const { recipe: savedRecipe, issues } = normalizeWorldRecipe(JSON.parse(JSON.stringify(first.recipeAfter)));
    assert.deepEqual(issues, []);
    const again = planStage(buildingsStage, input(savedRecipe!, savedLayout));
    assert.deepEqual({ added: again.added, updated: again.updated, removed: again.removed, kept: again.kept }, { added: [], updated: [], removed: [], kept: [] });
    assert.equal(again.empty, true);

    const guarded = structuredClone(savedRecipe!);
    guarded.plan.settlements[0]!.protected = true;
    guarded.plan.settlements[0]!.seed = 77;
    assert.equal(planStage(buildingsStage, input(guarded, savedLayout, () => 5)).empty, true);
  });

  check("world buildings: without roles the stage asks for land use; pads must name a settlement", () => {
    const bare = createWorldRecipe("bare", 1);
    bare.plan.settlements.push({ id: "v1", source: "manual", center: [0, 0], type: "village" });
    assert.deepEqual(planStage(buildingsStage, input(bare, { schema: 1, name: "x", loadGroups: [], characters: [], instances: [] })).warnings,
      ["no parcel has a role yet; run Land use first"]);
    const value = JSON.parse(JSON.stringify(bare));
    value.generated.pads = [
      { id: "wb-building-v1.p1", settlement: "v1", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], height: 2.5 },
      { id: "wb-building-v1.p2", settlement: "gone", polygon: [[0, 0], [4, 0], [4, 4]], height: 1 },
    ];
    const { recipe, issues } = normalizeWorldRecipe(value);
    assert.deepEqual(issues, ["generated.pads[1].settlement: must name a plan settlement"]);
    assert.deepEqual(recipe!.generated.pads, [value.generated.pads[0]]);
  });
}
