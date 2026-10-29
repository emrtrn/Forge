/**
 * World Builder F1, step 13a: street furniture (plan v0.4 §13.3 L7, §13.5
 * "L7 Donatı"). Entrance signs on the traffic side facing the incoming
 * driver, a prop in the widest gap of a junction, lights at intervals along
 * the roads in the core; every prop beside the road, never on a road, pad or
 * in front of an entrance; its level from the road spline; a re-run after
 * save + reload — and after Apply Pads — is empty. Step 13b: lot fences round
 * the roles with a fence, open at the entrance and at roads, buildings and
 * furniture, one fence on a shared boundary, following the ground.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { RoomLayout } from "../../engine/scene/layout";
import { SHAPE_PRIMITIVE_SIZE } from "../../engine/scene/shapes";
import type { TerrainSpline } from "../../engine/terrain/terrainTypes";
import { insidePolygon, sourceDistance } from "../../engine/worldbuilder/field";
import { FENCE_SINK, MAX_PIECE, planFence, type FencePiece, type FenceRequest } from "../../engine/worldbuilder/fences";
import { FURNITURE_MARGIN, placementFootprint, planFurniture, rectangle, type FurnitureLine, type FurnitureRequest } from "../../engine/worldbuilder/furniture";
import { streetLines } from "../../engine/worldbuilder/masks";
import type { WorldPoint } from "../../engine/worldbuilder/normalize";
import { polygonsOverlap } from "../../engine/worldbuilder/parcels";
import { createWorldRecipe, normalizeWorldRecipe, type WorldRecipe } from "../../engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile, type StreetFurnitureRule } from "../../engine/worldbuilder/regionProfile";
import { applyPlacementGroupChanges, planStage, type StageInput, type StageTerrain, type WorldStage } from "../../engine/worldbuilder/stage";
import { BUILDINGS_STAGE_ID, buildingsStage } from "../../engine/worldbuilder/stages/buildings";
import { fencesStage } from "../../engine/worldbuilder/stages/fences";
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

/** A strip lot north of a W–E road: front edge at z = 5 from x0 to x1, `depth` deep. */
function strip(x0: number, x1: number, depth = 30): WorldPoint[] {
  return [[x0, 5], [(x0 + x1) / 2, 5], [x1, 5], [x1, 5 + depth], [(x0 + x1) / 2, 5 + depth], [x0, 5 + depth]];
}

function fence(overrides: Partial<FenceRequest> = {}) {
  return planFence({
    outline: strip(0, 20), spec: { role: "prop.fence.picket", height: 1.1 }, entrance: [10, 8],
    roads: [{ kind: "polyline", points: [[-100, 0], [100, 0]], radii: [4.5, 4.5] }],
    obstacles: [], laid: [], blockedAt: () => false, sampleHeight: () => 2,
    ...overrides,
  });
}

const onOutline = (piece: FencePiece, outline: WorldPoint[]) =>
  [piece.a, piece.b].every((point) => outline.some((corner, index) => {
    const next = outline[(index + 1) % outline.length]!;
    return sourceDistance(point, { kind: "polyline", points: [corner, next] }) < 1e-6;
  }));

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

  check("world fences: a lot fence runs round the boundary, open at the entrance, one fence on a shared edge", () => {
    const lot = strip(0, 20);
    const first = fence();
    assert.equal(first.length, 97, "100 m round less a 3 m gate");
    assert.equal(first.open, 0);
    for (const piece of first.pieces) {
      assert.ok(Math.hypot(piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]) <= MAX_PIECE + 1e-9);
      assert.ok(onOutline(piece, lot), "on the boundary");
      assert.deepEqual(piece.heights, [2, 2]);
      const gate = piece.a[1] === 5 && piece.b[1] === 5 && Math.max(piece.a[0], piece.b[0]) > 8.5 + 1e-9 && Math.min(piece.a[0], piece.b[0]) < 11.5 - 1e-9;
      assert.equal(gate, false, "nothing in the entrance gap");
    }
    assert.equal(fence({ spec: { role: "prop.fence.picket", height: 1.1, front: false } }).length, 80);

    // The neighbour shares the x = 20 side and does not fence it again.
    const laid: FencePiece[] = [];
    fence({ laid });
    assert.equal(fence({ outline: strip(20, 40), entrance: [30, 8], laid }).length, 67);

    // A light post on the front keeps its fence open; so does a road.
    const post = box(3, 5.05, 3.3, 5.35);
    const posted = fence({ obstacles: [post] });
    assert.ok(posted.open > 0 && posted.open < 2, `${posted.open} m open`);
    for (const piece of posted.pieces) {
      const across = sourceDistance(piece.a, { kind: "polygon", polygon: post }) > 0.2 || sourceDistance(piece.b, { kind: "polygon", polygon: post }) > 0.2;
      assert.ok(across);
      assert.ok(!(Math.min(piece.a[0], piece.b[0]) < 3.3 && Math.max(piece.a[0], piece.b[0]) > 3 && piece.a[1] === 5 && piece.b[1] === 5), "no piece past the post");
    }
    assert.ok(fence({ roads: [{ kind: "polyline", points: [[-100, 0], [100, 0]], radii: [5, 5] }] }).open >= 17, "a front on the road's edge stays open");

    // On a slope the pieces shorten until each rises at most 0.25 m (4 m pieces halve on a 10 % slope).
    const sloped = fence({ sampleHeight: (_x, z) => z * 0.1 });
    for (const piece of sloped.pieces) assert.ok(Math.abs(piece.heights[1] - piece.heights[0]) <= 0.25 + 1e-9);
    assert.equal(sloped.length, 97);
  });

  check("world fences: the stage fences the fenced roles' lots off buildings, furniture and roads; it follows the ground", () => {
    const { state: furnished } = apply(furnitureStage, village());
    const { plan, state } = apply(fencesStage, furnished);
    const pieces = state.layout.instances.flatMap((group) => group.placements.filter((placement) => placement.id?.startsWith("wb-fence-")));
    assert.ok(pieces.length > 20, `${pieces.length} pieces`);
    const fencedHosts = new Set(state.recipe.generated.parcels.filter((parcel) => parcel.role === "building.residential.detached").map((parcel) => parcel.id));
    const roads = streetLines(input(state)).lines.map((road) => ({ kind: "polyline" as const, points: road.points, radii: road.halfWidths }));
    const blockers = state.layout.instances.flatMap((group) => group.placements)
      .filter((placement) => placement.id && ["buildings", "furniture"].includes(state.recipe.ownership.placements[placement.id]?.stage ?? ""))
      .map((placement) => placementFootprint(placement).footprint);
    for (const piece of pieces) {
      assert.equal(piece.role, "prop.fence.picket");
      assert.equal(piece.color, FURNITURE_COLORS.prop);
      const host = piece.id!.replace(/^wb-fence-/, "").replace(/-\d+$/, "");
      assert.ok(fencedHosts.has(host), `${piece.id} on a lot without a fence`);
      const { footprint } = placementFootprint(piece);
      assert.ok(!blockers.some((outline) => polygonsOverlap(footprint, outline)), `${piece.id} through a building or furniture`);
      for (const road of roads) for (const point of footprint) assert.ok(sourceDistance(point, road) > 0, `${piece.id} on a road`);
    }
    // The way from each fenced building's door to its street stays open.
    for (const placement of state.layout.instances.flatMap((group) => group.placements)) {
      if (!placement.id || state.recipe.ownership.placements[placement.id]?.stage !== BUILDINGS_STAGE_ID || placement.role !== "building.residential.detached") continue;
      const { center, face, halfDepth } = placementFootprint(placement);
      const path = rectangle([center[0] + face[0] * (halfDepth + 2.5), center[1] + face[1] * (halfDepth + 2.5)], face, 0.5, 2.5);
      assert.ok(!pieces.some((piece) => polygonsOverlap(placementFootprint(piece).footprint, path)), `${placement.id} fenced in`);
    }
    assert.ok(plan.warnings.includes("fences follow the ground: run this stage after Apply Pads"));
    assert.ok(plan.warnings.some((line) => /^settlement v1: prop\.fence\.picket round \d+ lots, \d+ m in \d+ pieces/.test(line)), plan.warnings.join("\n"));
    const sample = pieces[0]!;
    assert.ok((sample.scale as number[])[1]! * SHAPE_PRIMITIVE_SIZE >= 1.1 + FENCE_SINK - 1e-3);

    // Save + reload: nothing to do. Apply Pads changes the ground at the lot boundary, so the fences
    // follow it once; after that the stage is up to date on the baked ground.
    const savedLayout = validateLayout(JSON.parse(JSON.stringify(state.layout))) as unknown as RoomLayout;
    const { recipe: savedRecipe } = normalizeWorldRecipe(JSON.parse(JSON.stringify(state.recipe)));
    const saved: World = { recipe: savedRecipe!, layout: savedLayout, terrains: state.terrains };
    assert.equal(planStage(fencesStage, input(saved)).empty, true);
    const pads = savedRecipe!.generated.pads;
    const baked = (x: number, z: number) => {
      const pad = pads.find((entry) => insidePolygon(x, z, entry.polygon));
      if (pad) return pad.height;
      const near = pads.find((entry) => sourceDistance([x, z], { kind: "polygon", polygon: entry.polygon }) < 4);
      return near ? (near.height + slope(x, z)!) / 2 : slope(x, z);
    };
    const { plan: follow, state: rebaked } = apply(fencesStage, saved, profile(), baked);
    assert.ok(follow.updated.length > 0, "the fences follow the baked ground");
    assert.equal(planStage(fencesStage, input(rebaked, profile(), baked)).empty, true);

    const guarded = structuredClone(rebaked);
    guarded.recipe.plan.settlements[0]!.protected = true;
    assert.equal(planStage(fencesStage, input(guarded, profile(), slope)).empty, true);
    assert.deepEqual(planStage(fencesStage, input(rebaked, profile((raw) => { delete raw.roles["building.residential.detached"].fence; }))).warnings, ["no region profile role has a fence"]);
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
