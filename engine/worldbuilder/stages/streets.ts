/**
 * `streets` stage: inner streets for every sited settlement (World Builder plan
 * v0.4 §13.5 L3 "yerleşim içi"; F1, after step 11 by the user's decision of
 * 2026-10-28).
 *
 * Runs after `settlementSites` and before `parcels`. The roads through a core
 * are its main street; when their frontage cannot hold the program, this grows
 * local streets in the core (`streets.ts`: organic and contour-following, mixed
 * by the profile's `streetPattern`) and writes them as World Terrain splines
 * `wb-street-<settlement>-<n>` with the profile's local road cross-section, so
 * the parcel stage finds them like any other street. Spline data only
 * (decision 19), like `roads`.
 *
 * The stage ignores its own earlier streets when it grows, so a re-run grows
 * the same ones. A protected settlement keeps the streets it has. Grid and
 * radial weights are not generated yet and are reported.
 */
import type { WorldTerrainSpline } from "../../terrain/terrainTypes";
import { streetLines, waterSources, type StreetLine } from "../masks";
import type { WorldPoint } from "../normalize";
import type { PlanSettlement, WorldRecipe } from "../recipe";
import { roadSpec, roadSpline, routeHeights, terrainAt } from "../roadSpline";
import { sourceDistance } from "../field";
import type { GeneratedSpline, StageInput, StageOutput, WorldStage } from "../stage";
import { growInnerStreets, type InnerStreetPattern } from "../streets";
import { PARCEL_VERGE } from "../parcels";
import { hashSeed, protectedAreas } from "./parcels";

export const STREETS_STAGE_ID = "streets";

/** Spline id prefix of a settlement's inner streets. */
export function streetSplinePrefix(settlementId: string): string {
  return `wb-street-${settlementId}`;
}

/** Frontage wanted per program need: parcels lost at junctions, to water and to large roles. */
const FRONTAGE_SLACK = 1.4;
/** Streets keep this far from water, metres. */
const WATER_CLEARANCE = 5;
/** Defaults when the region profile has no residential parcel spec / street pattern, metres. */
const DEFAULT_PARCEL = { frontage: [14, 24] as [number, number], depth: [22, 36] as [number, number] };
const DEFAULT_BLOCK: [number, number] = [40, 110];
/** Mixed into the settlement seed so the street stream differs from the parcel one. */
const SEED_SALT = 0x53545245;

const PATTERN_TEXT: Record<InnerStreetPattern, string> = { organic: "organic", contourFollow: "contour" };

export const streetsStage: WorldStage = {
  id: STREETS_STAGE_ID,
  label: "Streets",
  version: 1,
  run(input: StageInput): StageOutput {
    const { recipe, profile } = input;
    const warnings: string[] = [];
    const splines: GeneratedSpline[] = [];
    if (recipe.plan.settlements.length > 0 && recipe.generated.sites.length === 0) {
      warnings.push("no settlement has a site yet; run Settlement sites first");
      return { placements: [], splines, warnings };
    }
    const warnOnce = onceWarner(warnings);
    const spec = roadSpec(input, "local", warnOnce);
    const parcel = profile?.parcels.residential ?? DEFAULT_PARCEL;
    const pattern = profile?.streetPattern;
    const weights: Record<InnerStreetPattern, number> = pattern
      ? { organic: pattern.organic, contourFollow: pattern.contourFollow }
      : { organic: 1, contourFollow: 0 };
    if (!pattern) warnings.push("no region profile; inner streets grow organic with default block sizes");
    else if (pattern.grid > 0 || pattern.radial > 0) {
      warnings.push(`grid and radial street patterns are not generated yet; ${weights.organic + weights.contourFollow > 0 ? "their weight is ignored" : "growing organic streets instead"}`);
      if (weights.organic + weights.contourFollow === 0) weights.organic = 1;
    }
    const linearOnly = weights.organic + weights.contourFollow === 0;

    // Its own earlier streets are not obstacles: a re-run grows the same ones.
    const owned = (id: string) => recipe.ownership.splines[id]?.stage === STREETS_STAGE_ID;
    const lines: StreetLine[] = streetLines(input).lines.filter((line) => !owned(line.id));
    const water = waterSources(input).sources;
    const meanDepth = (parcel.depth[0] + parcel.depth[1]) / 2;
    const meanFrontage = (parcel.frontage[0] + parcel.frontage[1]) / 2;

    for (const settlement of recipe.plan.settlements) {
      const name = `settlement ${settlement.id}`;
      const site = recipe.generated.sites.find((entry) => entry.settlement === settlement.id);
      if (!site) {
        warnings.push(`${name} has no site; no streets`);
        continue;
      }
      if (settlement.protected) {
        splines.push(...keptStreets(input, settlement.id));
        continue;
      }
      if (linearOnly) {
        warnings.push(`${name}: the street pattern is linear only; no inner streets`);
        continue;
      }
      const needs = site.dwellings + site.program.reduce((sum, line) => sum + line.count, 0);
      const guarded = protectedAreas(recipe, settlement);
      const result = growInnerStreets({
        idPrefix: streetSplinePrefix(settlement.id),
        center: site.center,
        coreRadius: site.coreRadius,
        ...(site.core ? { coreOutline: site.core } : {}),
        streets: lines,
        width: spec.width,
        maxSlopeDeg: spec.maxSlopeDeg,
        spacing: 2 * (meanDepth + PARCEL_VERGE) + spec.width,
        length: pattern?.blockSize ?? DEFAULT_BLOCK,
        weights,
        targetFrontage: needs * meanFrontage * FRONTAGE_SLACK,
        seed: (seedOf(recipe, settlement) ^ SEED_SALT) >>> 0,
        sampleHeight: input.sampleHeight,
        blockedAt: (point) => water.some((source) => sourceDistance(point, source) <= WATER_CLEARANCE + spec.width / 2)
          || guarded.some((test) => test(point)),
      });

      const target = Math.round(needs * meanFrontage * FRONTAGE_SLACK);
      let length = 0;
      for (const street of result.streets) {
        const terrain = terrainAt(input.terrains, street.points[0]!);
        const heights = routeHeights(street.points, input.sampleHeight);
        if (!terrain || !heights) {
          warnings.push(`${name}: street ${street.id} is off the World Terrains; skipped`);
          continue;
        }
        splines.push({ landscapeId: terrain.id, spline: roadSpline(street.id, street.id, street.points, heights.values, spec, terrain, warnOnce) });
        lines.push({ id: street.id, roadClass: "local", points: street.points, halfWidths: street.points.map(() => spec.width / 2) });
        length += polylineLength(street.points);
      }
      const byPattern = (["organic", "contourFollow"] as const)
        .map((kind) => [kind, result.streets.filter((street) => street.pattern === kind).length] as const)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${PATTERN_TEXT[kind]}`);
      warnings.push(`${name}: ${result.streets.length} inner streets${byPattern.length > 0 ? ` (${byPattern.join(", ")})` : ""}, ${Math.round(length)} m; street frontage ${Math.round(result.frontage.after)} m of ${target} m for ${needs} program needs`);
      if (result.flat && weights.contourFollow > 0 && result.streets.length > 0) {
        warnings.push(`${name}: its core is flat (${result.coreSlopeDeg}°); contour streets grew as organic`);
      }
      if (result.frontage.after < target && result.frontage.before < target) {
        warnings.push(`${name}: no room for more streets in its ${site.coreRadius} m core (steep ground, water or the core edge); short of ${Math.round(target - result.frontage.after)} m frontage`);
      }
    }
    return { placements: [], splines, warnings };
  },
};

/** A protected settlement's streets as they are on the terrains. */
function keptStreets(input: StageInput, settlementId: string): GeneratedSpline[] {
  const prefix = `${streetSplinePrefix(settlementId)}-`;
  const kept: GeneratedSpline[] = [];
  for (const terrain of input.terrains) {
    for (const spline of terrain.splines) {
      if (spline.id.startsWith(prefix) && spline.coordinateSpace === "world" && input.recipe.ownership.splines[spline.id]?.stage === STREETS_STAGE_ID) {
        kept.push({ landscapeId: terrain.id, spline: structuredClone(spline) as WorldTerrainSpline });
      }
    }
  }
  return kept;
}

function seedOf(recipe: WorldRecipe, settlement: PlanSettlement): number {
  return settlement.seed ?? hashSeed(recipe.seed, settlement.id);
}

function onceWarner(warnings: string[]): (key: string, message: string) => void {
  const seen = new Set<string>();
  return (key, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(message);
  };
}

function polylineLength(points: readonly WorldPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  return length;
}
