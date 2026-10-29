/**
 * World Builder F1, step 13a: street furniture (plan v0.4 §13.3 L7, §13.5
 * "L7 Donatı"). Entrance signs on the traffic side facing the incoming
 * driver, a prop in the widest gap of a junction, lights at intervals along
 * the roads in the core; every prop beside the road, never on a road, pad or
 * in front of an entrance; its level from the road spline; a re-run after
 * save + reload — and after Apply Pads — is empty.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { RoomLayout } from "../../engine/scene/layout";
import { SHAPE_PRIMITIVE_SIZE } from "../../engine/scene/shapes";
import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import { insidePolygon, sourceDistance } from "../../engine/worldbuilder/field";
import { FURNITURE_MARGIN, planFurniture, rectangle, type FurnitureLine, type FurnitureRequest } from "../../engine/worldbuilder/furniture";
import { streetLines } from "../../engine/worldbuilder/masks";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { polygonsOverlap } from "../../engine/worldbuilder/parcels";
import { createWorldRecipe, normalizeWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile, type StreetFurnitureRule } from "../../engine/worldbuilder/regionProfile";
import { applyPlacementGroupChanges, planStage, type StageInput, type StageTerrain, type WorldStage } from "../../engine/worldbuilder/stage";
import { buildingsStage } from "../../engine/worldbuilder/stages/buildings";
import { FURNITURE_COLORS, FURNITURE_SINK, furnitureStage } from "../../engine/worldbuilder/stages/furniture";
import { landUseStage } from "../../engine/worldbuilder/stages/landUse";
import { parcelsStage } from "../../engine/worldbuilder/stages/parcels";
import { roadsStage } from "../../engine/worldbuilder/stages/roads";
import { validateLayout } from "../../tools/saveValidator";

type Check = (label: string, fn: () => void) => void;

const SIGN: StreetFurnitureRule = { role: "prop.sign.settlementName", roadClasses: ["collector", "local"], placement: "gate", size: [1.2, 2.4, 0.1] };
const LIGHT: StreetFurnitureRule = { role: "prop.light.street", roadClasses: ["collector"], placement: "interval", spacing: 30, size: [0.3, 6, 0.3] };
const POST: StreetFurnitureRule = { role: "prop.sign.direction", roadClasses: ["local"], placement: "junction", size: [0.8, 2.2, 0.1] };

function profile(edit?: (raw: Record<string, any>) => void): RegionProfile {
  const raw = JSON.parse(readFileSync("tests/engine/fixtures/neutral.regionprofile.json", "utf8"));
  raw.streetFurniture.push(POST);
  edit?.(raw);
  const { profile: value, issues } = normalizeRegionProfile(raw);
  assert.deepEqual(issues, []);
  return value!;
}

function line(id: string, points: WorldPoint[], half: number, roadClass: FurnitureLine["roadClass"], height = 7): FurnitureLine {
  return { id, edge: id, roadClass, points, halfWidths: points.map(() => half), heights: points.map(() => height) };
}

function request(overrides: Partial<FurnitureRequest> = {}): FurnitureRequest {
  return {
    rules: [SIGN, LIGHT], lines: [line("main", [[-200, 0], [200, 0]], 4.5, "collector")],
    center: [0, 0], coreRadius: 90, gateNodes: [], trafficSide: "right",
    obstacles: { buildings: [], pads: [], entrances: [] },
    blockedAt: () => null, sampleHeight: () => 0,
    ...overrides,
  };
}

const box = (x0: number, z0: number, x1: number, z1: number): WorldPoint[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} ≠ ${b}`);

// ---------------------------------------------------------------- stage world

const TERRAIN = "terrain-1";

/** Ground rising 5 cm per metre north; nothing beyond ±500 m. */
const slope = (x: number, z: number): number | null => (Math.abs(x) <= 500 && Math.abs(z) <= 500 ? z * 0.05 : null);

interface World {
  recipe: WorldRecipe;
  layout: RoomLayout;
  terrains: StageTerrain[];
}

/** A W–E collector through a junction at the origin and a local road north; parcels, land use and buildings on it. */
function village(): World {
  const recipe = createWorldRecipe("furniture_test", 5);
  recipe.plan.settlements.push({ id: "v1", source: "manual", center: [0, 0], type: "village", population: 36 });
  recipe.plan.roadGraph.nodes.push(
    { id: "w", source: "manual", position: [-300, 0], kind: "end" },
    { id: "c", source: "manual", position: [0, 0], kind: "junction" },
    { id: "e", source: "manual", position: [300, 0], kind: "end" },
    { id: "n", source: "manual", position: [0, 200], kind: "end" },
  );
  recipe.plan.roadGraph.edges.push(
    { id: "west", source: "manual", from: "w", to: "c", roadClass: "collector" },
    { id: "east", source: "manual", from: "c", to: "e", roadClass: "collector" },
    { id: "north", source: "manual", from: "c", to: "n", roadClass: "local" },
  );
  recipe.generated.sites.push({
    settlement: "v1", center: [0, 0], coreRadius: 90, score: 0.9, dwellings: 12,
    program: [{ role: "building.commercial.shop", count: 2, siting: "mainRoad", source: "profile" }],
  });
  let state: World = {
    recipe,
    layout: { schema: 1, name: "Furniture", loadGroups: [], characters: [], instances: [] },
    terrains: [{ id: TERRAIN, min: [-500, -500], max: [500, 500], locked: false, splines: [], layers: [] }],
  };
  for (const stage of [roadsStage, parcelsStage, landUseStage, buildingsStage]) state = apply(stage, state).state;
  return state;
}

function input(state: World, regionProfile: RegionProfile | null = profile(), sampleHeight: StageInput["sampleHeight"] = slope): StageInput {
  return { recipe: state.recipe, layout: state.layout, profile: regionProfile, sampleHeight, terrains: state.terrains };
}

/** Runs a stage and applies its placement and spline changes and recipe. */
function apply(stage: WorldStage, state: World, regionProfile: RegionProfile | null = profile(), sampleHeight = slope) {
  const plan = planStage(stage, input(state, regionProfile, sampleHeight));
  assert.deepEqual(plan.errors, [], stage.id);
  const layout = structuredClone(state.layout);
  applyPlacementGroupChanges(layout, plan.groupChanges, "after");
  const terrains = state.terrains.map((terrain) => {
    const change = plan.splineChanges.find((entry) => entry.landscapeId === terrain.id);
    return change ? { ...terrain, splines: structuredClone(change.after) as TerrainSpline[] } : terrain;
  });
  return { plan, state: { recipe: plan.recipeAfter, layout, terrains } };
}

function furnitureOf(layout: RoomLayout) {
  return layout.instances.flatMap((group) =>
    group.placements.filter((placement) => placement.id?.startsWith("wb-furniture-")).map((placement) => ({ assetId: group.assetId, placement })));
}

export function registerWorldFurnitureTests(check: Check): void {
  check("world furniture: entrance signs stand on the traffic side, facing the incoming driver", () => {
    const { props, outcomes } = planFurniture(request({ rules: [SIGN] }));
    assert.deepEqual(outcomes, [{ placed: 2, spots: 2, blocked: {} }]);
    const offset = 4.5 + FURNITURE_MARGIN + 0.6;
    const [west, east] = props;
    // Driving east into the core at x = -90, right is +z; the sign faces west.
    near(west!.center[0], -90, "west x");
    near(west!.center[1], offset, "west z");
    near(west!.yawDeg, -90, "west yaw");
    near(east!.center[0], 90, "east x");
    near(east!.center[1], -offset, "east z");
    near(east!.yawDeg, 90, "east yaw");
    assert.deepEqual(props.map((prop) => prop.base), [7, 7], "the level is the road's centre-line height");

    const left = planFurniture(request({ rules: [SIGN], trafficSide: "left" })).props;
    near(left[0]!.center[1], -offset, "left traffic: the other side");

    // A gate node picks the entrance instead of the core edge.
    const gated = planFurniture(request({ rules: [SIGN], gateNodes: [[-60, 3]] })).props;
    assert.equal(gated.length, 1);
    near(gated[0]!.center[0], -60, "gate node x");
  });

  check("world furniture: lights repeat along the road in the core and move past pads and entrances", () => {
    const clear = planFurniture(request({ rules: [LIGHT] }));
    // s = 15 + 30k from x = -200: the core holds x = -65 … 85.
    assert.deepEqual(clear.props.map((prop) => Math.round(prop.center[0])), [-65, -35, -5, 25, 55, 85]);
    for (const prop of clear.props) {
      near(prop.center[1], 4.5 + FURNITURE_MARGIN + 0.15, "right of the road");
      near(Math.abs(prop.yawDeg), 180, "facing the road");
    }

    const pad = box(-12, 4.7, 8, 20);
    const entrance = box(20, -20, 30, 20);
    const blocked = planFurniture(request({ rules: [LIGHT], obstacles: { buildings: [], pads: [pad], entrances: [entrance] } }));
    assert.deepEqual(blocked.outcomes, [{ placed: 5, spots: 6, blocked: { entrance: 1 } }]);
    const moved = blocked.props.find((prop) => Math.abs(prop.center[0] + 5) < 1e-6)!;
    assert.ok(moved.center[1] < 0, "the light at the pad moved across the road");
    for (const prop of blocked.props) {
      assert.equal(polygonsOverlap(prop.footprint, pad) || polygonsOverlap(prop.footprint, entrance), false);
    }

    // Water and protected ground block; off the terrain blocks.
    const wet = planFurniture(request({ rules: [LIGHT], blockedAt: ([x]) => (x > 0 ? "water" : null), sampleHeight: (x) => (x < -50 ? null : 0) }));
    assert.deepEqual(wet.outcomes[0], { placed: 2, spots: 6, blocked: { offTerrain: 1, water: 3 } });
  });

  check("world furniture: a junction prop stands in the widest gap, for a T and for road ends at a node", () => {
    const through = line("main", [[-200, 0], [200, 0]], 4.5, "collector");
    const branch = line("north", [[0, 4.5], [0, 150]], 3, "local");
    const expected = -(4.5 + FURNITURE_MARGIN + 0.4);
    const tee = planFurniture(request({ rules: [POST], lines: [through, branch] }));
    assert.deepEqual(tee.outcomes, [{ placed: 1, spots: 1, blocked: {} }]);
    near(tee.props[0]!.center[0], 0, "T x");
    near(tee.props[0]!.center[1], expected, "opposite the branch");
    near(tee.props[0]!.yawDeg, 0, "facing the junction");

    // The roads stage splits the through road at the node.
    const west = line("west", [[-200, 0], [0, 0]], 4.5, "collector");
    const east = line("east", [[0, 0], [200, 0]], 4.5, "collector");
    const node = planFurniture(request({ rules: [POST], lines: [west, east, branch] }));
    assert.equal(node.props.length, 1);
    near(node.props[0]!.center[1], expected, "node junction");

    // Two road ends meeting are one road; a junction of collector roads only is not a local rule's.
    assert.equal(planFurniture(request({ rules: [POST], lines: [west, east] })).outcomes[0]!.spots, 0);
    assert.equal(planFurniture(request({ rules: [POST], lines: [west, east, { ...branch, roadClass: "collector" }] })).outcomes[0]!.spots, 0);
    // Roads without a spline (no heights) are no anchors.
    const { heights: _h, ...unrealised } = through;
    assert.equal(planFurniture(request({ rules: [SIGN], lines: [unrealised] })).outcomes[0]!.spots, 0);
  });

  check("world furniture: the stage puts coloured props beside the roads, off pads and entrances, at road level", () => {
    const state = village();
    const { plan, state: after } = apply(furnitureStage, state);
    const props = furnitureOf(after.layout);
    assert.ok(props.length >= 6, `${props.length} props`);
    assert.equal(plan.added.length, props.length);
    const lines = streetLines(input(state)).lines;
    const roads = lines.map((road) => ({ kind: "polyline" as const, points: road.points, radii: road.halfWidths }));
    const pads = state.recipe.generated.pads.map((pad) => pad.polygon);
    const sizes = new Map([SIGN, LIGHT, POST].map((rule) => [rule.role, rule.size]));
    for (const { assetId, placement } of props) {
      assert.equal(assetId, "shape:cube");
      assert.match(placement.id!, /^wb-furniture-v1-prop\.(sign\.settlementName|light\.street|sign\.direction)-\d+$/);
      assert.equal(placement.color, FURNITURE_COLORS.prop);
      const [width, height, depth] = sizes.get(placement.role!)!;
      const scale = placement.scale as number[];
      near(scale[0]! * SHAPE_PRIMITIVE_SIZE, width, "width");
      near(scale[2]! * SHAPE_PRIMITIVE_SIZE, depth, "depth");
      const center: WorldPoint = [placement.position[0], placement.position[2]];
      const yaw = (placement.rotation![1] * Math.PI) / 180;
      const footprint = rectangle(center, [Math.sin(yaw), Math.cos(yaw)], width / 2 - 0.01, depth / 2 - 0.01);
      for (const road of roads) for (const point of footprint) assert.ok(sourceDistance(point, road) > 0, `${placement.id} on a road`);
      assert.ok(!pads.some((pad) => polygonsOverlap(footprint, pad)), `${placement.id} on a pad`);
      // Its foot is the nearest road's centre-line height (the spline's), less the sink — not the ground beside it.
      const nearest = lines.map((road) => ({ road, gap: sourceDistance(center, { kind: "polyline", points: road.points }) })).sort((a, b) => a.gap - b.gap)[0]!.road;
      const foot = placement.position[1] - (scale[1]! * SHAPE_PRIMITIVE_SIZE) / 2;
      near(scale[1]! * SHAPE_PRIMITIVE_SIZE, height + FURNITURE_SINK, "height + sink");
      assert.ok(Math.abs(foot + FURNITURE_SINK - nearestHeight(nearest, center)) < 0.01, `${placement.id} foot ${foot}`);
    }
    const report = plan.warnings.filter((line) => line.startsWith("settlement v1: prop."));
    assert.equal(report.length, 3, plan.warnings.join("\n"));
    assert.match(report[0]!, /^settlement v1: prop\.sign\.settlementName \(gate\): 3 of 3 spots$/);
    assert.match(report[1]!, /^settlement v1: prop\.light\.street \(interval\): \d of 6 spots/);
    assert.match(report[2]!, /^settlement v1: prop\.sign\.direction \(junction\): 1 of 1 spots$/);
  });

  check("world furniture: a re-run after save + reload and after Apply Pads is empty; protected settlements keep theirs", () => {
    const { state } = apply(furnitureStage, village());
    const savedLayout = validateLayout(JSON.parse(JSON.stringify(state.layout))) as unknown as RoomLayout;
    const { recipe: savedRecipe, issues } = normalizeWorldRecipe(JSON.parse(JSON.stringify(state.recipe)));
    assert.deepEqual(issues, []);
    const saved: World = { recipe: savedRecipe!, layout: savedLayout, terrains: state.terrains };
    const again = planStage(furnitureStage, input(saved));
    assert.deepEqual({ added: again.added, updated: again.updated, removed: again.removed, kept: again.kept }, { added: [], updated: [], removed: [], kept: [] });
    assert.equal(again.empty, true);

    // Apply Pads levels the ground under the pads; the props stand at road level, so nothing moves.
    const baked = (x: number, z: number) => savedRecipe!.generated.pads.find((pad) => insidePolygon(x, z, pad.polygon))?.height ?? slope(x, z);
    assert.equal(planStage(furnitureStage, input(saved, profile(), baked)).empty, true);

    const guarded = structuredClone(saved);
    guarded.recipe.plan.settlements[0]!.protected = true;
    guarded.recipe.plan.settlements[0]!.seed = 99;
    assert.equal(planStage(furnitureStage, input(guarded, profile((raw) => { raw.streetFurniture = []; }))).empty, true);
  });

  check("world furniture: assets replace the placeholder; missing inputs are reported", () => {
    const models = profile((raw) => { raw.streetFurniture[1].assetIds = ["props/lamp-a.glb", "props/lamp-b.glb"]; });
    const { state } = apply(furnitureStage, village(), models);
    const lamps = furnitureOf(state.layout).filter(({ placement }) => placement.role === "prop.light.street");
    assert.ok(lamps.length > 0);
    for (const { assetId, placement } of lamps) {
      assert.ok(["props/lamp-a.glb", "props/lamp-b.glb"].includes(assetId), assetId);
      assert.equal(placement.color, undefined);
      assert.equal(placement.scale, undefined);
    }
    assert.ok(furnitureOf(state.layout).some(({ assetId }) => assetId === "shape:cube"), "rules without assets keep placeholders");

    const bare = createWorldRecipe("bare", 1);
    bare.plan.settlements.push({ id: "v1", source: "manual", center: [0, 0], type: "village" });
    const empty: World = { recipe: bare, layout: { schema: 1, name: "x", loadGroups: [], characters: [], instances: [] }, terrains: [] };
    assert.deepEqual(planStage(furnitureStage, input(empty)).warnings, ["no settlement has a site yet; run Settlement sites first"]);

    // Roads not realised yet are named; their classes get no furniture.
    const unrealised = structuredClone(village());
    unrealised.terrains = unrealised.terrains.map((terrain) => ({ ...terrain, splines: [] }));
    const plan = planStage(furnitureStage, input(unrealised));
    assert.ok(plan.warnings.includes("settlement v1: road west has no spline yet and gets no furniture; run Roads first"), plan.warnings.join("\n"));
    assert.ok(plan.warnings.includes("settlement v1: prop.light.street (interval): none; no collector road in its core"));
  });
}

/** Height of a street line's centre at the point nearest `point`. */
function nearestHeight(road: { points: WorldPoint[]; heights?: number[] }, point: WorldPoint): number {
  let best = { gap: Infinity, height: 0 };
  for (let index = 1; index < road.points.length; index += 1) {
    const a = road.points[index - 1]!;
    const b = road.points[index]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq));
    const gap = Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t));
    const heights = road.heights!;
    if (gap < best.gap) best = { gap, height: heights[index - 1]! + (heights[index]! - heights[index - 1]!) * t };
  }
  return best.height;
}
