/**
 * A road as World Terrain spline data, shared by the stages that write roads
 * (`roads` for plan edges, `streets` for a settlement's inner streets).
 *
 * Spline data only (decision 19): the mesh and collision come from the
 * segment `mesh` config (the region profile's `meshAsset`), and the segments
 * carry the deform/paint config the editor's explicit Deform / Paint buttons
 * use. Nothing here edits terrain heights or paint. Dependency-free.
 */
import type { ForgeLandscapeSplinePoint, ForgeLandscapeSplineSegment } from "../scene/landscape";
import type { WorldTerrainSpline } from "../terrain/terrainTypes";
import type { WorldPoint } from "./normalize";
import { resolveRoadClass, type ResolvedRoadClass } from "./roadClass";
import type { StageInput, StageTerrain } from "./stage";
import type { RoadClass } from "./vocabulary";

/** Blend distance beyond the road edge for the explicit Deform / Paint buttons, metres. */
const ROAD_FALLOFF = 3;

export function roadSpec(
  input: StageInput,
  roadClass: RoadClass,
  warnOnce: (key: string, message: string) => void,
): ResolvedRoadClass {
  const spec = resolveRoadClass(input.profile, roadClass);
  if (!spec.specified) {
    warnOnce(`spec:${roadClass}`, `no region profile road spec for ${roadClass}; using ${spec.width} m and no mesh`);
  } else if (!spec.meshAsset) {
    warnOnce(`mesh:${roadClass}`, `${roadClass} roads have no meshAsset in the region profile; their splines carry no mesh`);
  }
  return spec;
}

export function roadSpline(
  id: string,
  name: string,
  route: readonly WorldPoint[],
  heights: readonly number[],
  road: ResolvedRoadClass,
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
  return { id, name, smooth: true, points, segments, coordinateSpace: "world" };
}

/** A paint layer by id, else by name, case-insensitively. */
function paintLayer(terrain: StageTerrain, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return (terrain.layers.find((layer) => layer.id.toLowerCase() === wanted)
    ?? terrain.layers.find((layer) => layer.name.toLowerCase() === wanted))?.id;
}

export function terrainAt(terrains: readonly StageTerrain[], [x, z]: WorldPoint): StageTerrain | undefined {
  return terrains.find((terrain) => x >= terrain.min[0] && x <= terrain.max[0] && z >= terrain.min[1] && z <= terrain.max[1]);
}

/** Terrain height per route point; off-terrain points copy the nearest sampled one. */
export function routeHeights(
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
