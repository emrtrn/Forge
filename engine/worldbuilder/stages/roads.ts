/**
 * `roads` stage: turns each `recipe.plan.roadGraph` edge into one World Terrain
 * spline (World Builder plan v0.4 §13, F1 step 6).
 *
 * Spline data only (decision 19): the road mesh and its collision come from
 * the spline's segment `mesh` config (the region profile's `meshAsset`), and
 * the segments carry the deform/paint config the editor's explicit Deform /
 * Paint buttons use. The stage never edits terrain heights or paint itself.
 *
 * Route, first slice: the edge's guide points when it has them, a straight line
 * otherwise, resampled every `ROUTE_SPACING` metres and set on the terrain
 * height. A slope-aware route solver is a separate step (T14).
 *
 * The spline lives on the World Terrain under the edge's start node (else its
 * end node). Ids derive from edge ids, so a re-run updates the same spline.
 */
import type { ForgeLandscapeSplinePoint, ForgeLandscapeSplineSegment } from "../../scene/landscape";
import type { WorldTerrainSpline } from "../../terrain/terrainTypes";
import type { WorldPoint } from "../normalize";
import type { RoadEdge } from "../recipe";
import type { RoadSpec } from "../regionProfile";
import type { GeneratedSpline, StageInput, StageOutput, StageTerrain, WorldStage } from "../stage";
import type { RoadClass } from "../vocabulary";

export const ROADS_STAGE_ID = "roads";

/** Spline id of the road that realises a plan edge. */
export function roadSplineId(edgeId: string): string {
  return `wb-road-${edgeId}`;
}

/** Longest straight run between two spline points, metres; points carry the terrain height. */
export const ROUTE_SPACING = 10;
/** The terrain spline point limit (`validateLandscapeSplines`). */
const MAX_POINTS = 256;
/** Blend distance beyond the road edge for the explicit Deform / Paint buttons, metres. */
const ROAD_FALLOFF = 3;

/** Carriageway widths used when the region profile has no spec for a class. */
const DEFAULT_WIDTH: Record<RoadClass, number> = {
  highway: 12, arterial: 9, collector: 7, local: 5, track: 3.5, path: 1.5,
};

export const roadsStage: WorldStage = {
  id: ROADS_STAGE_ID,
  label: "Roads",
  version: 1,
  run(input: StageInput): StageOutput {
    const { nodes, edges } = input.recipe.plan.roadGraph;
    const positions = new Map(nodes.map((node) => [node.id, node.position]));
    const splines: GeneratedSpline[] = [];
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
      const control = [from, ...(edge.guide ?? []), to];
      if (control.length > MAX_POINTS) {
        warnings.push(`road ${edge.id} has more than ${MAX_POINTS - 2} guide points; skipped`);
        continue;
      }
      const route = resample(control);
      if (route.length < 2) {
        warnings.push(`road ${edge.id} has zero length; skipped`);
        continue;
      }
      const heights = routeHeights(route, input.sampleHeight);
      if (!heights) {
        warnings.push(`road ${edge.id} has no terrain height along its route; skipped`);
        continue;
      }
      if (heights.filled) warnings.push(`road ${edge.id} leaves the terrain; off-terrain points take the nearest height`);
      const spec = roadSpec(input, edge.roadClass, warnOnce);
      splines.push({
        landscapeId: terrain.id,
        edge: edge.id,
        spline: roadSpline(edge, route, heights.values, spec, terrain, warnOnce),
      });
    }
    return { placements: [], splines, warnings };
  },
};

interface ResolvedRoad {
  width: number;
  surfaceLayer?: string;
  meshAsset?: string;
}

function roadSpec(
  input: StageInput,
  roadClass: RoadClass,
  warnOnce: (key: string, message: string) => void,
): ResolvedRoad {
  const spec: RoadSpec | undefined = input.profile?.roads[roadClass];
  if (!spec) {
    warnOnce(`spec:${roadClass}`, `no region profile road spec for ${roadClass}; using ${DEFAULT_WIDTH[roadClass]} m and no mesh`);
    return { width: DEFAULT_WIDTH[roadClass] };
  }
  if (!spec.meshAsset) warnOnce(`mesh:${roadClass}`, `${roadClass} roads have no meshAsset in the region profile; their splines carry no mesh`);
  return {
    width: spec.width + 2 * spec.shoulder,
    ...(spec.surfaceLayer ? { surfaceLayer: spec.surfaceLayer } : {}),
    ...(spec.meshAsset ? { meshAsset: spec.meshAsset } : {}),
  };
}

function roadSpline(
  edge: RoadEdge,
  route: readonly WorldPoint[],
  heights: readonly number[],
  road: ResolvedRoad,
  terrain: StageTerrain,
  warnOnce: (key: string, message: string) => void,
): WorldTerrainSpline {
  const points: ForgeLandscapeSplinePoint[] = route.map(([x, z], index) => ({
    id: `p${index}`,
    position: [round(x), round(heights[index]!), round(z)],
    width: round(road.width),
    falloff: ROAD_FALLOFF,
  }));
  const layerId = road.surfaceLayer === undefined ? undefined : paintLayer(terrain, road.surfaceLayer);
  if (road.surfaceLayer !== undefined && layerId === undefined) {
    warnOnce(`layer:${terrain.id}:${road.surfaceLayer}`, `terrain ${terrain.id} has no paint layer "${road.surfaceLayer}"; its roads carry no paint`);
  }
  const segments: ForgeLandscapeSplineSegment[] = points.slice(1).map((point, index) => ({
    id: `s${index}`,
    startPointId: points[index]!.id,
    endPointId: point.id,
    deform: { enabled: true, raiseTerrain: true, lowerTerrain: true, flatten: true },
    ...(layerId === undefined ? {} : { paint: { enabled: true, layerId, strength: 1 } }),
    ...(road.meshAsset === undefined ? {} : {
      mesh: { enabled: true, assetId: road.meshAsset, alignToTerrain: true, deform: true, collision: true },
    }),
  }));
  return { id: roadSplineId(edge.id), name: edge.id, smooth: true, points, segments, coordinateSpace: "world" };
}

/** A paint layer by id, else by name, case-insensitively. */
function paintLayer(terrain: StageTerrain, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return (terrain.layers.find((layer) => layer.id.toLowerCase() === wanted)
    ?? terrain.layers.find((layer) => layer.name.toLowerCase() === wanted))?.id;
}

function terrainAt(terrains: readonly StageTerrain[], [x, z]: WorldPoint): StageTerrain | undefined {
  return terrains.find((terrain) => x >= terrain.min[0] && x <= terrain.max[0] && z >= terrain.min[1] && z <= terrain.max[1]);
}

/**
 * Keeps every control point and splits each leg into equal runs of at most
 * `ROUTE_SPACING` (longer when the route would exceed the point limit).
 */
function resample(control: readonly WorldPoint[]): WorldPoint[] {
  const legs = control.slice(1).map((point, index) => Math.hypot(point[0] - control[index]![0], point[1] - control[index]![1]));
  const total = legs.reduce((sum, length) => sum + length, 0);
  const spacing = Math.max(ROUTE_SPACING, total / Math.max(1, MAX_POINTS - control.length));
  const route: WorldPoint[] = [control[0]!];
  legs.forEach((length, index) => {
    const start = control[index]!;
    const end = control[index + 1]!;
    if (length === 0) return;
    const pieces = Math.max(1, Math.ceil(length / spacing - 1e-9));
    for (let step = 1; step <= pieces; step += 1) {
      const t = step / pieces;
      route.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
    }
  });
  return route;
}

/** Terrain height per route point; off-terrain points copy the nearest sampled one. */
function routeHeights(
  route: readonly WorldPoint[],
  sampleHeight: StageInput["sampleHeight"],
): { values: number[]; filled: boolean } | null {
  const sampled = route.map(([x, z]) => sampleHeight(x, z));
  if (sampled.every((height) => height === null)) return null;
  const values = sampled.map((height, index) => {
    if (height !== null) return height;
    for (let offset = 1; ; offset += 1) {
      const before = sampled[index - offset];
      if (before !== undefined && before !== null) return before;
      const after = sampled[index + offset];
      if (after !== undefined && after !== null) return after;
    }
  });
  return { values, filled: sampled.includes(null) };
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
