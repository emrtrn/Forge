/**
 * `roads` stage: turns each `recipe.plan.roadGraph` edge into one World Terrain
 * spline (World Builder plan v0.4 §13, F1 steps 6 and 8).
 *
 * Spline data only (decision 19): the road mesh and its collision come from
 * the spline's segment `mesh` config (the region profile's `meshAsset`), and
 * the segments carry the deform/paint config the editor's explicit Deform /
 * Paint buttons use. The stage never edits terrain heights or paint itself.
 *
 * Route (`route.ts`): the edge's guide polyline, else the straight line, when
 * it keeps to the class's slope limit and stays out of water and protected
 * areas; otherwise the slope-aware solver's route around the problem. Points
 * are at most `ROUTE_SPACING` apart and set on the terrain height. What the
 * route still breaks — steep legs, tight bends, water crossings — is reported.
 *
 * Bridges (`bridges.ts`): each river crossing gets a level deck at a fixed
 * height; the span's segment neither deforms nor paints the terrain, so the
 * river runs on under it, and a greybox deck (`structure.bridge`) stands there.
 * Lakes are walls for the route.
 *
 * Junctions (`junctions.ts`): where three or more roads meet, the two of the
 * highest class run through the node and the others end at their edge.
 *
 * Heights (`roadProfile.ts`): each road's vertical profile is designed for its
 * class's slope limit, cutting into or filling over ground that is steeper.
 * Roads are solved by class (highest first, ties by edge id); a road takes the
 * height of an earlier road where it joins or crosses it. Where joined heights
 * force a steeper grade it is spread evenly and reported.
 *
 * The spline lives on the World Terrain under the edge's start node (else its
 * end node). Ids derive from edge ids, so a re-run updates the same spline.
 */
import { SHAPE_PRIMITIVE_SIZE, shapeAssetId } from "../../scene/shapes";
import type { LayoutPlacement } from "../../scene/layout";
import { bridgeRoute, type BridgeRiver, type BridgeSpan } from "../bridges";
import { resolveJunctions, type JunctionRoad } from "../junctions";
import { DEFAULT_RIVER_HALF_WIDTH } from "../masks";
import type { WorldPoint } from "../normalize";
import type { RoadEdge } from "../recipe";
import type { ResolvedRoadClass } from "../roadClass";
import { roadSpec, roadSpline, routeHeights, terrainAt } from "../roadSpline";
import { designRoadNetwork } from "../roadProfile";
import { MAX_ROUTE_POINTS, planRoute, type RouteResult } from "../route";
import type { GeneratedPlacement, GeneratedSpline, StageOutput, StageTerrain, WorldStage } from "../stage";
import { ROAD_CLASSES } from "../vocabulary";

export { ROUTE_SPACING } from "../route";

export const ROADS_STAGE_ID = "roads";
/** Greybox bridge deck: thickness, extra width beyond the road, colour. */
const DECK_THICKNESS = 0.8;
const DECK_EXTRA_WIDTH = 1;
const DECK_COLOR = "#9c968c";

/** Spline id of the road that realises a plan edge. */
export function roadSplineId(edgeId: string): string {
  return `wb-road-${edgeId}`;
}

export const roadsStage: WorldStage = {
  id: ROADS_STAGE_ID,
  label: "Roads",
  version: 6,
  run(input): StageOutput {
    const { nodes, edges } = input.recipe.plan.roadGraph;
    const positions = new Map(nodes.map((node) => [node.id, node.position]));
    const routed: Array<{ edge: RoadEdge; terrain: StageTerrain; spec: ResolvedRoadClass; road: JunctionRoad }> = [];
    const warnings: string[] = [];
    const warned = new Set<string>();
    const routes = new Map<string, RouteResult>();
    const warnOnce = (key: string, message: string): void => {
      if (warned.has(key)) return;
      warned.add(key);
      warnings.push(message);
    };

    for (const edge of edges) {
      const from = positions.get(edge.from)!;
      const to = positions.get(edge.to)!;
      const terrain = terrainAt(input.terrains, from) ?? terrainAt(input.terrains, to);
      if (!terrain) {
        warnings.push(`road ${edge.id} has neither end on a World Terrain; skipped`);
        continue;
      }
      if ((edge.guide?.length ?? 0) + 2 > MAX_ROUTE_POINTS) {
        warnings.push(`road ${edge.id} has more than ${MAX_ROUTE_POINTS - 2} guide points; skipped`);
        continue;
      }
      const spec = roadSpec(input, edge.roadClass, warnOnce);
      const route = planRoute(input, {
        from, to, ...(edge.guide ? { guide: edge.guide } : {}),
        maxSlopeDeg: spec.maxSlopeDeg, minTurnRadius: spec.minTurnRadius, halfWidth: spec.width / 2,
      });
      if (!route) {
        warnings.push(`road ${edge.id} has zero length; skipped`);
        continue;
      }
      const heights = routeHeights(route.points, input.sampleHeight);
      if (!heights) {
        warnings.push(`road ${edge.id} has no terrain height along its route; skipped`);
        continue;
      }
      warnings.push(...routeWarnings(edge, route, spec));
      routes.set(edge.id, route);
      if (heights.filled) warnings.push(`road ${edge.id} leaves the terrain; off-terrain points take the nearest height`);
      routed.push({
        edge, terrain, spec,
        road: { edge: edge.id, from: edge.from, to: edge.to, roadClass: edge.roadClass, width: spec.width, points: route.points },
      });
    }

    warnings.push(...resolveJunctions(routed.map((entry) => entry.road)).warnings);
    // River crossings: a point at each end of the span, the deck height held between them.
    const rivers: BridgeRiver[] = input.recipe.plan.water.flatMap((water) => (water.path
      ? [{ points: water.path, halfWidth: water.width === undefined ? DEFAULT_RIVER_HALF_WIDTH : water.width / 2 }]
      : []));
    const spans = new Map<string, BridgeSpan[]>();
    for (const entry of routed) {
      const bridged = bridgeRoute(entry.road.points, rivers, input.sampleHeight, `road ${entry.edge.id}`);
      warnings.push(...bridged.warnings);
      if (bridged.points.length > MAX_ROUTE_POINTS) {
        warnings.push(`road ${entry.edge.id}: bridging would pass ${MAX_ROUTE_POINTS} points; no bridges`);
        continue;
      }
      entry.road.points = bridged.points;
      // A wet crossing it could not bridge is in `bridged.warnings`; the route's own count also takes in the bank.
      spans.set(entry.edge.id, bridged.spans);
    }
    const grounded: Array<(typeof routed)[number] & { ground: number[] }> = [];
    for (const entry of routed) {
      const heights = routeHeights(entry.road.points, input.sampleHeight);
      if (!heights) {
        warnings.push(`road ${entry.edge.id} has no terrain height left after its junction trim; skipped`);
        continue;
      }
      grounded.push({ ...entry, ground: heights.values });
    }
    // Highest class first, then edge id: the road a junction belongs to sets its height.
    const rank = (entry: (typeof grounded)[number]): number => ROAD_CLASSES.indexOf(entry.edge.roadClass);
    grounded.sort((a, b) => rank(a) - rank(b) || (a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0));
    const profiles = designRoadNetwork(grounded.map(({ edge, spec, road, ground }) => ({
      id: edge.id, points: road.points, ground, width: spec.width, maxGrade: Math.tan(spec.maxSlopeDeg * Math.PI / 180),
      fixes: (spans.get(edge.id) ?? []).flatMap((span) => [{ index: span.start, height: span.height }, { index: span.start + 1, height: span.height }]),
    })));
    const splines: GeneratedSpline[] = [];
    const placements: GeneratedPlacement[] = [];
    grounded.forEach(({ edge, terrain, spec, road }, index) => {
      const profile = profiles[index]!;
      const route = routes.get(edge.id)!;
      if (route.steepLegs > 0) {
        warnings.push(`road ${edge.id}: the ground under ${route.steepLegs} leg(s) is steeper than ${spec.maxSlopeDeg}° (steepest ${round1(route.maxGradeDeg!)}°); `
          + `the road cuts up to ${round1(profile.maxCut)} m and fills up to ${round1(profile.maxFill)} m to keep the limit`);
      }
      if (profile.overLimit) {
        warnings.push(`road ${edge.id}: the roads it joins force ${round1(Math.atan(profile.maxGrade) * 180 / Math.PI)}° (limit ${spec.maxSlopeDeg}°)`);
      }
      const edgeSpans = spans.get(edge.id) ?? [];
      const bridges = new Set(edgeSpans.map((span) => span.start));
      splines.push({ landscapeId: terrain.id, edge: edge.id, spline: roadSpline(roadSplineId(edge.id), edge.id, road.points, profile.heights, spec, terrain, warnOnce, bridges) });
      edgeSpans.forEach((span, index) => {
        placements.push(deckPlacement(`wb-bridge-${edge.id}-${index + 1}`, road.points[span.start]!, road.points[span.start + 1]!, profile.heights[span.start]!, spec.width));
      });
    });
    // Splines keep the plan's edge order.
    const order = new Map(edges.map((edge, index) => [edge.id, index]));
    splines.sort((a, b) => order.get(a.edge!)! - order.get(b.edge!)!);
    return { placements, splines, warnings };
  },
};

function routeWarnings(edge: RoadEdge, route: RouteResult, spec: ResolvedRoadClass): string[] {
  const warnings: string[] = [];
  if (route.method === "solved") warnings.push(`road ${edge.id}: the planned line ${route.reason}; routed over the terrain instead`);
  if (route.method === "fallback") warnings.push(`road ${edge.id}: the planned line ${route.reason}; kept the planned line`);
  if (route.tightBends > 0) {
    warnings.push(`road ${edge.id}: ${route.tightBends} bend(s) tighter than the ${spec.minTurnRadius} m turn radius (tightest ${round1(route.tightestRadius!)} m)`);
  }
  if (route.protectedHits > 0) warnings.push(`road ${edge.id} still enters a protected area`);
  return warnings;
}

/** A greybox deck from `from` to `to`, its top at `height`. */
function deckPlacement(id: string, from: WorldPoint, to: WorldPoint, height: number, roadWidth: number): GeneratedPlacement {
  const [dx, dz] = [to[0] - from[0], to[1] - from[1]];
  const round3 = (value: number): number => Number(value.toFixed(3));
  const placement: LayoutPlacement & { id: string } = {
    id,
    role: "structure.bridge",
    name: "Bridge",
    position: [round3((from[0] + to[0]) / 2), round3(height - DECK_THICKNESS / 2), round3((from[1] + to[1]) / 2)],
    // Local X runs along the road.
    rotation: [0, round3((Math.atan2(-dz, dx) * 180) / Math.PI), 0],
    scale: [round3(Math.hypot(dx, dz) / SHAPE_PRIMITIVE_SIZE), round3(DECK_THICKNESS / SHAPE_PRIMITIVE_SIZE), round3((roadWidth + DECK_EXTRA_WIDTH) / SHAPE_PRIMITIVE_SIZE)],
    color: DECK_COLOR,
  };
  return { assetId: shapeAssetId("cube"), placement };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
