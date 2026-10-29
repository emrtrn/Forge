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
 * Junctions (`junctions.ts`): where three or more roads meet, the two of the
 * highest class run through the node and the others end at their edge.
 *
 * The spline lives on the World Terrain under the edge's start node (else its
 * end node). Ids derive from edge ids, so a re-run updates the same spline.
 */
import { resolveJunctions, type JunctionRoad } from "../junctions";
import type { RoadEdge } from "../recipe";
import type { ResolvedRoadClass } from "../roadClass";
import { roadSpec, roadSpline, routeHeights, terrainAt } from "../roadSpline";
import { MAX_ROUTE_POINTS, planRoute, type RouteResult } from "../route";
import type { GeneratedSpline, StageOutput, StageTerrain, WorldStage } from "../stage";

export { ROUTE_SPACING } from "../route";

export const ROADS_STAGE_ID = "roads";

/** Spline id of the road that realises a plan edge. */
export function roadSplineId(edgeId: string): string {
  return `wb-road-${edgeId}`;
}

export const roadsStage: WorldStage = {
  id: ROADS_STAGE_ID,
  label: "Roads",
  version: 4,
  run(input): StageOutput {
    const { nodes, edges } = input.recipe.plan.roadGraph;
    const positions = new Map(nodes.map((node) => [node.id, node.position]));
    const routed: Array<{ edge: RoadEdge; terrain: StageTerrain; spec: ResolvedRoadClass; road: JunctionRoad }> = [];
    const warnings: string[] = [];
    const warned = new Set<string>();
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
      if (heights.filled) warnings.push(`road ${edge.id} leaves the terrain; off-terrain points take the nearest height`);
      routed.push({
        edge, terrain, spec,
        road: { edge: edge.id, from: edge.from, to: edge.to, roadClass: edge.roadClass, width: spec.width, points: route.points },
      });
    }

    warnings.push(...resolveJunctions(routed.map((entry) => entry.road)).warnings);
    const splines: GeneratedSpline[] = [];
    for (const { edge, terrain, spec, road } of routed) {
      const heights = routeHeights(road.points, input.sampleHeight);
      if (!heights) {
        warnings.push(`road ${edge.id} has no terrain height left after its junction trim; skipped`);
        continue;
      }
      splines.push({ landscapeId: terrain.id, edge: edge.id, spline: roadSpline(roadSplineId(edge.id), edge.id, road.points, heights.values, spec, terrain, warnOnce) });
    }
    return { placements: [], splines, warnings };
  },
};

function routeWarnings(edge: RoadEdge, route: RouteResult, spec: ResolvedRoadClass): string[] {
  const warnings: string[] = [];
  if (route.method === "solved") warnings.push(`road ${edge.id}: the planned line ${route.reason}; routed over the terrain instead`);
  if (route.method === "fallback") warnings.push(`road ${edge.id}: the planned line ${route.reason}; kept the planned line`);
  if (route.steepLegs > 0) {
    warnings.push(`road ${edge.id}: ${route.steepLegs} leg(s) steeper than ${spec.maxSlopeDeg}° (steepest ${round1(route.maxGradeDeg!)}°)`);
  }
  if (route.tightBends > 0) {
    warnings.push(`road ${edge.id}: ${route.tightBends} bend(s) tighter than the ${spec.minTurnRadius} m turn radius (tightest ${round1(route.tightestRadius!)} m)`);
  }
  if (route.waterCrossings > 0) warnings.push(`road ${edge.id} crosses water ${route.waterCrossings} time(s); it needs a bridge or ford`);
  if (route.protectedHits > 0) warnings.push(`road ${edge.id} still enters a protected area`);
  return warnings;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
