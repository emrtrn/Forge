/**
 * Recipe-aware masks (World Builder plan v0.4 T04 + T20, §5.4, §13.5): the
 * shared "keep clear" inputs every later generator reads — site selection,
 * route cost, parcels, scatter.
 *
 * - Roads: every world-space spline on the level's World Terrains (generated or
 *   hand-made, at its authored width), plus plan road edges no spline realises
 *   yet (guide polyline at the region profile's width).
 * - Water: plan water — rivers as their centre line at a half width, lakes as
 *   their outline.
 * - Protected: `ownership.protectedRegions` and protected settlements (their
 *   boundary, else a disc of their radius).
 *
 * Built on `field.ts`; pure, deterministic, dependency-free.
 */
import { splineToPolyline } from "../scene/landscape";
import { boxMask, bandMask, distanceField, maskOr, polygonMask, type DistanceSource, type Field, type GridSpec } from "./field";
import type { WorldPoint } from "./normalize";
import type { StageInput } from "./stage";
import { roadClassWidth } from "./roadClass";
import type { RoadClass } from "./vocabulary";

export type MaskInput = Pick<StageInput, "recipe" | "profile" | "terrains">;

export interface SourceSet {
  sources: DistanceSource[];
  warnings: string[];
}

export interface WaterOptions {
  /** Half width of a plan river's channel around its centre line, metres. Default 4. */
  riverHalfWidth?: number;
}

export interface ExclusionOptions extends WaterOptions {
  /** Clear distance beyond a road's edge, metres. Default 2. */
  roadClearance?: number;
  /** Clear distance beyond the water's edge, metres. Default 5. */
  waterClearance?: number;
  /** Fade from 1 to 0 beyond each clearance, metres. Default 0 (hard edge). */
  falloff?: number;
}

export interface ExclusionMasks {
  /** 1 = keep clear: any of the parts below. */
  mask: Field;
  roads: Field;
  water: Field;
  protected: Field;
  warnings: string[];
}

export const DEFAULT_RIVER_HALF_WIDTH = 4;
export const DEFAULT_ROAD_CLEARANCE = 2;
export const DEFAULT_WATER_CLEARANCE = 5;

/** A street centre line with its half width per point; `edge` names the plan edge it realises. */
export interface StreetLine {
  /** Spline id, or the plan edge id for a road no spline realises yet. */
  id: string;
  edge?: string;
  roadClass?: RoadClass;
  points: WorldPoint[];
  halfWidths: number[];
  /** Centre-line height per point, metres; only lines a spline realises have it. */
  heights?: number[];
}

/**
 * Every road as a continuous centre line: world-space splines on the level's
 * terrains (one line per chain of joined segments), then plan edges no spline
 * realises yet (guide polyline at the region profile's width).
 */
export function streetLines(input: MaskInput): { lines: StreetLine[]; warnings: string[] } {
  const lines: StreetLine[] = [];
  const warnings: string[] = [];
  const present = new Set<string>();
  const edgeClass = new Map(input.recipe.plan.roadGraph.edges.map((edge) => [edge.id, edge.roadClass]));
  for (const terrain of input.terrains) {
    let local = 0;
    for (const spline of terrain.splines) {
      if (spline.coordinateSpace !== "world") {
        local += 1;
        continue;
      }
      present.add(spline.id);
      const edge = input.recipe.ownership.splines[spline.id]?.edge;
      const roadClass = edge === undefined ? undefined : edgeClass.get(edge);
      let current: StreetLine | null = null;
      for (const piece of splineToPolyline(spline)) {
        const start = xz(piece.start.position);
        const last = current?.points[current.points.length - 1];
        if (!current || !last || last[0] !== start[0] || last[1] !== start[1]) {
          current = {
            id: spline.id,
            ...(edge === undefined ? {} : { edge }),
            ...(roadClass === undefined ? {} : { roadClass }),
            points: [start],
            halfWidths: [piece.start.width / 2],
            heights: [piece.start.position[1]],
          };
          lines.push(current);
        }
        current.points.push(xz(piece.end.position));
        current.halfWidths.push(piece.end.width / 2);
        current.heights!.push(piece.end.position[1]);
      }
    }
    if (local > 0) warnings.push(`terrain ${terrain.id} has ${local} spline(s) in terrain-local coordinates; they are not in road masks`);
  }

  const realised = new Set<string>();
  for (const [id, entry] of Object.entries(input.recipe.ownership.splines)) {
    if (entry.edge !== undefined && present.has(id)) realised.add(entry.edge);
  }
  const { nodes, edges } = input.recipe.plan.roadGraph;
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  for (const edge of edges) {
    if (realised.has(edge.id)) continue;
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const points = [from, ...(edge.guide ?? []), to];
    const halfWidth = roadClassWidth(input.profile, edge.roadClass) / 2;
    lines.push({ id: edge.id, edge: edge.id, roadClass: edge.roadClass, points, halfWidths: points.map(() => halfWidth) });
  }
  return { lines, warnings };
}

/** Road surfaces as tapered capsules of half their width (`streetLines`). */
export function roadSources(input: MaskInput): SourceSet {
  const { lines, warnings } = streetLines(input);
  return {
    sources: lines.map((line): DistanceSource => ({ kind: "polyline", points: line.points, radii: line.halfWidths })),
    warnings,
  };
}

/** Plan water: river centre lines widened by `riverHalfWidth`, lake outlines filled. */
export function waterSources(input: MaskInput, options: WaterOptions = {}): SourceSet {
  const halfWidth = options.riverHalfWidth ?? DEFAULT_RIVER_HALF_WIDTH;
  const sources: DistanceSource[] = [];
  for (const water of input.recipe.plan.water) {
    if (water.polygon) sources.push({ kind: "polygon", polygon: water.polygon });
    else if (water.path) sources.push({ kind: "polyline", points: water.path, radii: water.path.map(() => halfWidth) });
  }
  return { sources, warnings: [] };
}

/** 1 inside a protected region or a protected settlement. */
export function protectedMask(spec: GridSpec, input: MaskInput): { field: Field; warnings: string[] } {
  const warnings: string[] = [];
  const boxes = input.recipe.ownership.protectedRegions.map(({ min, max }) => ({ min, max }));
  const polygons: WorldPoint[][] = [];
  const discs: DistanceSource[] = [];
  for (const settlement of input.recipe.plan.settlements) {
    if (!settlement.protected) continue;
    if (settlement.boundary) polygons.push(settlement.boundary);
    else if (settlement.radius !== undefined) discs.push({ kind: "point", position: settlement.center, radius: settlement.radius });
    else warnings.push(`protected settlement ${settlement.id} has neither a boundary nor a radius; it is not in the protected mask`);
  }
  const parts = [boxMask(spec, boxes), polygonMask(spec, polygons)];
  if (discs.length > 0) parts.push(bandMask(distanceField(spec, discs, spec.cellSize), { max: 0 }));
  return { field: maskOr(...parts), warnings };
}

/**
 * The T20 "keep clear" mask: 1 within `roadClearance` of a road, within
 * `waterClearance` of water, or in a protected area; fading over `falloff`.
 */
export function exclusionMasks(spec: GridSpec, input: MaskInput, options: ExclusionOptions = {}): ExclusionMasks {
  const falloff = options.falloff ?? 0;
  const roadClearance = options.roadClearance ?? DEFAULT_ROAD_CLEARANCE;
  const waterClearance = options.waterClearance ?? DEFAULT_WATER_CLEARANCE;
  const roadSet = roadSources(input);
  const waterSet = waterSources(input, options);
  const roads = clearance(spec, roadSet.sources, roadClearance, falloff);
  const water = clearance(spec, waterSet.sources, waterClearance, falloff);
  const guarded = protectedMask(spec, input);
  return {
    mask: maskOr(roads, water, guarded.field),
    roads,
    water,
    protected: guarded.field,
    warnings: [...roadSet.warnings, ...waterSet.warnings, ...guarded.warnings],
  };
}

function clearance(spec: GridSpec, sources: readonly DistanceSource[], distance: number, falloff: number): Field {
  // Measure a cell past the fade so the cap never cuts into it.
  const distances = distanceField(spec, sources, distance + falloff + spec.cellSize);
  return bandMask(distances, { max: distance, falloff });
}

function xz(position: readonly [number, number, number]): WorldPoint {
  return [position[0], position[2]];
}
