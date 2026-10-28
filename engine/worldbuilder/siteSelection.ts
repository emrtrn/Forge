/**
 * Settlement site selection, L2 (World Builder plan v0.4 §13.5).
 *
 * The plan's centre is the starting point; the selector may slide it within
 * the search radius to the best local score and reports the slide. A candidate
 * centre is scored over the settlement's built-up core (`estimateCoreRadius`):
 *
 * - flatness: mean slope over the core against the slope limit (local roads'
 *   `maxSlopeDeg` by default) — steeper is excluded;
 * - water: near is good, but a centre lower than `floodMargin` above the
 *   nearby water's level is excluded as flood-prone, and one in water too;
 * - roads: near a road (realised spline or planned edge) is good;
 * - optional aspect: facing `preferredAspect` (e.g. a sunny side) is good;
 * - distance from the plan's centre costs a little, so intent wins ties.
 *
 * Protected areas and off-terrain cores are excluded. With no valid centre the
 * result says so and why — a generator stops there instead of placing a
 * village somewhere bad. Pure and deterministic. Dependency-free.
 */
import { cellCenter, distanceField, gridSpecForBounds, heightField, slopeField, type Field, type GridSpec } from "./field";
import { protectedMask, roadSources, waterSources } from "./masks";
import type { WorldPoint } from "./normalize";
import type { DerivedProgram } from "./program";
import type { PlanSettlement } from "./recipe";
import type { RegionProfile } from "./regionProfile";
import { resolveRoadClass } from "./roadClass";
import type { RouteContext } from "./route";

export const DEFAULT_SEARCH_RADIUS = 150;
export const DEFAULT_FLOOD_MARGIN = 3;
/** Water within this distance of a centre can flood it, metres. */
const FLOOD_REACH = 200;
/** A centre closer than this to water stands in it, metres. */
const WATER_CLEARANCE = 5;
/** Water proximity: full score within the first, none beyond the second, metres. */
const WATER_NEAR: [number, number] = [50, 400];
const ROAD_NEAR: [number, number] = [30, 300];
/** Share of a core that may be off terrain. */
const MAX_OFF_TERRAIN = 0.1;
/** The plan's centre is kept unless another scores this much more. */
const KEEP_PLAN_MARGIN = 0.02;
/** Built-up area per parcel when the profile has no parcel spec for its land use, m². */
const DEFAULT_PARCEL_AREA = 400;
/** Share of a settlement's area taken by streets and gaps. */
const CIRCULATION_SHARE = 0.3;
const MIN_CORE_RADIUS = 20;
const MAX_SITE_CELLS = 256;

const WEIGHTS = { slope: 0.45, water: 0.2, road: 0.25, aspect: 0.1, shift: 0.15 } as const;

export interface SiteOptions {
  /** Default: the settlement's `radius`, else `DEFAULT_SEARCH_RADIUS`. */
  searchRadius?: number;
  /** Default: the region profile's local-road `maxSlopeDeg`. */
  maxSlopeDeg?: number;
  /** Height a centre must keep above nearby water, metres. */
  floodMargin?: number;
  /** Unit XZ direction the ground should face (downhill), e.g. towards the sun. */
  preferredAspect?: WorldPoint;
  /** Scoring cell, metres. Default 4 (larger on wide searches). */
  cellSize?: number;
}

export interface SiteScore {
  /** 0..1 */
  score: number;
  /** Mean slope over the core, degrees. */
  coreSlopeDeg: number;
  /** Nearest water / road, metres; null when there is none. */
  waterDistance: number | null;
  roadDistance: number | null;
}

export interface SiteResult extends Partial<SiteScore> {
  /** null: no valid site within the search radius. */
  center: WorldPoint | null;
  /** Metres from the plan's centre. */
  shift: number;
  coreRadius: number;
  /** The plan centre's score; null when the plan centre itself is excluded. */
  planScore: number | null;
  /** Why the plan's centre was not kept, or why there is no site. */
  reason?: string;
}

/**
 * Radius of the built-up core: the program's parcels (dwellings as residential
 * parcels) plus circulation, as a disc.
 */
export function estimateCoreRadius(program: Pick<DerivedProgram, "dwellings" | "lines">, profile: RegionProfile | null): number {
  const parcelArea = (landUse: string | undefined): number => {
    const spec = landUse === undefined ? undefined : profile?.parcels[landUse as keyof RegionProfile["parcels"]];
    if (!spec) return DEFAULT_PARCEL_AREA;
    return ((spec.frontage[0] + spec.frontage[1]) / 2) * ((spec.depth[0] + spec.depth[1]) / 2);
  };
  let area = program.dwellings * parcelArea("residential");
  for (const line of program.lines) area += line.count * parcelArea(profile?.roles[line.role]?.landUse);
  const gross = area / (1 - CIRCULATION_SHARE);
  return Math.max(MIN_CORE_RADIUS, Math.round(Math.sqrt(gross / Math.PI)));
}

type Exclusion = "steep" | "flood" | "water" | "protected" | "offTerrain";
const EXCLUSION_TEXT: Record<Exclusion, string> = {
  steep: "steeper than the limit",
  flood: "flood-prone",
  water: "in water",
  protected: "protected",
  offTerrain: "off the terrain",
};

export function selectSite(
  context: RouteContext,
  settlement: Readonly<PlanSettlement>,
  coreRadius: number,
  profile: RegionProfile | null,
  options: SiteOptions = {},
): SiteResult {
  const searchRadius = options.searchRadius ?? settlement.radius ?? DEFAULT_SEARCH_RADIUS;
  const maxSlope = options.maxSlopeDeg ?? resolveRoadClass(profile, "local").maxSlopeDeg;
  const floodMargin = options.floodMargin ?? DEFAULT_FLOOD_MARGIN;
  const [cx, cz] = settlement.center;
  const half = searchRadius + coreRadius;
  const spec = gridSpecForBounds(
    { min: [cx - half, cz - half], max: [cx + half, cz + half] },
    Math.max(options.cellSize ?? 4, (2 * half) / MAX_SITE_CELLS),
  );

  const heights = heightField(spec, context.sampleHeight);
  const slopes = slopeField(heights);
  const core = coreMeans(slopes, Math.max(1, Math.round((coreRadius * 0.886) / spec.cellSize)));
  const water = waterLevels(spec, context);
  const roads = roadSources(context).sources;
  const roadDistance = roads.length > 0 ? distanceField(spec, roads, ROAD_NEAR[1]) : null;
  const guarded = protectedMask(spec, context).field;

  const evaluate = (index: number): { score: number; detail: SiteScore } | Exclusion => {
    const height = heights.values[index]!;
    if (Number.isNaN(height) || core.offShare[index]! > MAX_OFF_TERRAIN) return "offTerrain";
    if (guarded.values[index]! >= 0.5) return "protected";
    let waterDistance: number | null = null;
    for (const source of water) {
      const distance = source.distance.values[index]!;
      if (distance <= WATER_CLEARANCE) return "water";
      if (distance < FLOOD_REACH && height < source.level + floodMargin) return "flood";
      waterDistance = Math.min(waterDistance ?? Infinity, distance);
    }
    const coreSlope = core.mean[index]!;
    if (coreSlope > maxSlope) return "steep";
    const roadAt = roadDistance ? roadDistance.values[index]! : null;
    const [x, z] = cellCenter(spec, index % spec.width, Math.floor(index / spec.width));
    const shift = Math.hypot(x - cx, z - cz) / searchRadius;
    let total = WEIGHTS.slope * (1 - coreSlope / maxSlope)
      + WEIGHTS.water * (water.length > 0 ? ramp(waterDistance ?? Infinity, WATER_NEAR) : 0.5)
      + WEIGHTS.road * (roadAt !== null ? ramp(roadAt, ROAD_NEAR) : 0.5);
    let weight = WEIGHTS.slope + WEIGHTS.water + WEIGHTS.road;
    if (options.preferredAspect) {
      total += WEIGHTS.aspect * aspectScore(heights, index, options.preferredAspect);
      weight += WEIGHTS.aspect;
    }
    const score = Math.min(1, Math.max(0, total / weight - WEIGHTS.shift * shift));
    return {
      score,
      detail: {
        score: round(score),
        coreSlopeDeg: round(coreSlope),
        waterDistance: waterDistance === null || waterDistance >= FLOOD_REACH ? null : round(waterDistance),
        roadDistance: roadAt === null || roadAt >= ROAD_NEAR[1] ? null : round(roadAt),
      },
    };
  };

  const planIndex = cellIndex(spec, cx, cz);
  const planEval = evaluate(planIndex);
  const counts: Record<Exclusion, number> = { steep: 0, flood: 0, water: 0, protected: 0, offTerrain: 0 };
  let candidates = 0;
  let best: { index: number; score: number; detail: SiteScore } | null = null;
  for (let j = 0; j < spec.depth; j += 1) {
    for (let i = 0; i < spec.width; i += 1) {
      const [x, z] = cellCenter(spec, i, j);
      if (Math.hypot(x - cx, z - cz) > searchRadius) continue;
      candidates += 1;
      const index = j * spec.width + i;
      const result = evaluate(index);
      if (typeof result === "string") {
        counts[result] += 1;
        continue;
      }
      if (!best || result.score > best.score) best = { index, ...result };
    }
  }

  const planScore = typeof planEval === "string" ? null : round(planEval.score);
  if (!best) {
    const shares = (Object.keys(counts) as Exclusion[])
      .filter((key) => counts[key] > 0)
      .map((key) => `${Math.round((100 * counts[key]) / Math.max(1, candidates))}% ${EXCLUSION_TEXT[key]}`);
    return {
      center: null, shift: 0, coreRadius, planScore,
      reason: `no buildable site within ${searchRadius} m (${shares.join(", ")})`,
    };
  }
  if (typeof planEval !== "string" && planEval.score + KEEP_PLAN_MARGIN >= best.score) {
    return { center: [cx, cz], shift: 0, coreRadius, planScore, ...planEval.detail };
  }
  const center = cellCenter(spec, best.index % spec.width, Math.floor(best.index / spec.width));
  return {
    center: [round(center[0]), round(center[1])],
    shift: round(Math.hypot(center[0] - cx, center[1] - cz)),
    coreRadius,
    planScore,
    ...best.detail,
    reason: typeof planEval === "string"
      ? `the planned centre is ${EXCLUSION_TEXT[planEval]}`
      : `a nearby site scores ${round(best.score)} against the planned centre's ${planScore}`,
  };
}

/** Mean of a field over a (2k+1)² window and the window's no-data share, by summed-area tables. */
function coreMeans(field: Field, k: number): { mean: Float32Array; offShare: Float32Array } {
  const { width, depth, values } = field;
  const sums = new Float64Array((width + 1) * (depth + 1));
  const gaps = new Float64Array((width + 1) * (depth + 1));
  for (let j = 0; j < depth; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const value = values[j * width + i]!;
      const at = (j + 1) * (width + 1) + (i + 1);
      const up = j * (width + 1) + (i + 1);
      const left = (j + 1) * (width + 1) + i;
      const diagonal = j * (width + 1) + i;
      sums[at] = (Number.isNaN(value) ? 0 : value) + sums[up]! + sums[left]! - sums[diagonal]!;
      gaps[at] = (Number.isNaN(value) ? 1 : 0) + gaps[up]! + gaps[left]! - gaps[diagonal]!;
    }
  }
  const box = (table: Float64Array, i0: number, j0: number, i1: number, j1: number): number =>
    table[(j1 + 1) * (width + 1) + (i1 + 1)]! - table[j0 * (width + 1) + (i1 + 1)]!
    - table[(j1 + 1) * (width + 1) + i0]! + table[j0 * (width + 1) + i0]!;
  const mean = new Float32Array(width * depth);
  const offShare = new Float32Array(width * depth);
  for (let j = 0; j < depth; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const i0 = i - k;
      const j0 = j - k;
      const i1 = i + k;
      const j1 = j + k;
      const window = (2 * k + 1) * (2 * k + 1);
      // Cells past the grid edge count as no data.
      const ci0 = Math.max(0, i0);
      const cj0 = Math.max(0, j0);
      const ci1 = Math.min(width - 1, i1);
      const cj1 = Math.min(depth - 1, j1);
      const inside = (ci1 - ci0 + 1) * (cj1 - cj0 + 1);
      const missing = box(gaps, ci0, cj0, ci1, cj1) + (window - inside);
      const known = window - missing;
      mean[j * width + i] = known > 0 ? box(sums, ci0, cj0, ci1, cj1) / known : Number.NaN;
      offShare[j * width + i] = missing / window;
    }
  }
  return { mean, offShare };
}

/** Each plan water's distance field and level: the lowest terrain under its outline or centre line. */
function waterLevels(spec: GridSpec, context: RouteContext): Array<{ distance: Field; level: number }> {
  const result: Array<{ distance: Field; level: number }> = [];
  for (const source of waterSources(context).sources) {
    const points = source.kind === "polygon" ? source.polygon : source.kind === "polyline" ? source.points : [source.position];
    const levels = points.map(([x, z]) => context.sampleHeight(x, z)).filter((height): height is number => height !== null);
    if (levels.length === 0) continue;
    result.push({ distance: distanceField(spec, [source], FLOOD_REACH), level: Math.min(...levels) });
  }
  return result;
}

function aspectScore(heights: Field, index: number, preferred: WorldPoint): number {
  const { width, depth, cellSize, values } = heights;
  const i = index % width;
  const j = Math.floor(index / width);
  const at = (a: number, b: number): number =>
    a < 0 || b < 0 || a >= width || b >= depth || Number.isNaN(values[b * width + a]!) ? values[index]! : values[b * width + a]!;
  const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * cellSize);
  const gz = (at(i, j + 1) - at(i, j - 1)) / (2 * cellSize);
  const steepness = Math.hypot(gx, gz);
  if (steepness < 1e-6) return 0.5;
  // Downhill is minus the gradient; flat-ish ground counts less than a clear slope.
  const facing = (-gx * preferred[0] - gz * preferred[1]) / steepness;
  const weight = Math.min(1, (Math.atan(steepness) * (180 / Math.PI)) / 3);
  return 0.5 + 0.5 * facing * weight;
}

function cellIndex(spec: GridSpec, x: number, z: number): number {
  const i = Math.min(spec.width - 1, Math.max(0, Math.floor((x - spec.origin[0]) / spec.cellSize)));
  const j = Math.min(spec.depth - 1, Math.max(0, Math.floor((z - spec.origin[1]) / spec.cellSize)));
  return j * spec.width + i;
}

/** 1 up to `near[0]`, falling linearly to 0 at `near[1]`. */
function ramp(distance: number, [full, none]: [number, number]): number {
  if (distance <= full) return 1;
  if (distance >= none) return 0;
  return 1 - (distance - full) / (none - full);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
