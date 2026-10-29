/**
 * `parcels` stage: street-front parcels for every sited settlement (World
 * Builder plan v0.4 §13.5 L4; F1 step 10).
 *
 * Reads `recipe.generated.sites` (run `settlementSites` first) and the level's
 * streets — realised road splines and still-planned edges — and writes
 * `recipe.generated.parcels`, each fronting a street (`frontage` = its plan
 * edge when it has one); steep parcels are open land. A thin plate per parcel
 * shows the result on the terrain until buildings stand there.
 *
 * Parcels are drawn with the profile's residential frontage/depth; the land-use
 * stage (L5) decides what each one holds. The report compares the parcel count
 * with the program's needs: a core whose streets cannot hold the program says
 * so (internal streets are a later generator). A protected settlement keeps its
 * parcels.
 */
import type { LayoutPlacement } from "../../scene/layout";
import { SHAPE_PRIMITIVE_SIZE, shapeAssetId } from "../../scene/shapes";
import { sourceDistance, type DistanceSource } from "../field";
import { streetLines, waterSources, type StreetLine } from "../masks";
import type { WorldPoint } from "../normalize";
import { parcelBox, subdivideStreets, type ParcelDropReason } from "../parcels";
import type { GeneratedParcel, PlanSettlement, WorldRecipe } from "../recipe";
import { resolveRoadClass } from "../roadClass";
import type { GeneratedPlacement, StageInput, StageOutput, WorldStage } from "../stage";

export const PARCELS_STAGE_ID = "parcels";

/** Placement id of a parcel's plate. */
export function parcelMarkerId(parcelId: string): string {
  return `wb-parcel-${parcelId}`;
}

/** Parcel ranges when the region profile has no residential parcel spec, metres. */
const DEFAULT_PARCEL = { frontage: [14, 24] as [number, number], depth: [22, 36] as [number, number] };
/** Parcels keep this far from water, metres. */
const WATER_CLEARANCE = 5;
const PLATE_HEIGHT = 0.1;

const DROP_TEXT: Record<ParcelDropReason, string> = {
  road: "on a road", water: "near water", protected: "protected", offTerrain: "off the terrain",
  overlap: "overlapping", shape: "bent by the street",
};

export const parcelsStage: WorldStage = {
  id: PARCELS_STAGE_ID,
  label: "Parcels",
  version: 2,
  run(input: StageInput): StageOutput {
    const { recipe, profile } = input;
    const warnings: string[] = [];
    const parcels: GeneratedParcel[] = [];
    const placements: GeneratedPlacement[] = [];
    if (recipe.plan.settlements.length > 0 && recipe.generated.sites.length === 0) {
      warnings.push("no settlement has a site yet; run Settlement sites first");
      return { placements, generated: { parcels: [] }, warnings };
    }

    const streets = streetLines(input);
    warnings.push(...streets.warnings);
    const water = waterSources(input).sources;
    const spec = profile?.parcels.residential ?? DEFAULT_PARCEL;
    if (!profile?.parcels.residential) warnings.push(`no residential parcel spec in the region profile; using ${DEFAULT_PARCEL.frontage.join("–")} m frontage, ${DEFAULT_PARCEL.depth.join("–")} m depth`);
    const maxSlopeDeg = resolveRoadClass(profile, "local").maxSlopeDeg;

    for (const settlement of recipe.plan.settlements) {
      const name = `settlement ${settlement.id}`;
      const site = recipe.generated.sites.find((entry) => entry.settlement === settlement.id);
      if (!site) {
        warnings.push(`${name} has no site; no parcels`);
        continue;
      }
      let own: GeneratedParcel[];
      if (settlement.protected) {
        own = recipe.generated.parcels.filter((parcel) => parcel.settlement === settlement.id);
      } else {
        const reach = site.coreRadius + spec.depth[1] + 20;
        const result = subdivideStreets({
          settlement: settlement.id,
          center: site.center,
          coreRadius: site.coreRadius,
          ...(site.core ? { coreOutline: site.core } : {}),
          streets: streets.lines,
          frontage: spec.frontage,
          depth: spec.depth,
          maxSlopeDeg,
          seed: settlement.seed ?? hashSeed(recipe.seed, settlement.id),
          sampleHeight: input.sampleHeight,
          blockedAt: blocker(nearby(streets.lines, site.center, reach), water, protectedAreas(recipe, settlement)),
        });
        own = result.parcels.map((parcel): GeneratedParcel => ({
          id: parcel.id,
          settlement: settlement.id,
          polygon: parcel.polygon,
          ...(parcel.edge === undefined ? {} : { frontage: parcel.edge }),
          ...(parcel.steep ? { landUse: "open" as const } : {}),
        }));
        const steep = result.parcels.filter((parcel) => parcel.steep).length;
        const needs = site.dwellings + site.program.reduce((sum, line) => sum + line.count, 0);
        const dropped = (Object.keys(result.dropped) as ParcelDropReason[])
          .filter((reason) => result.dropped[reason] > 0)
          .map((reason) => `${result.dropped[reason]} ${DROP_TEXT[reason]}`);
        warnings.push(`${name}: ${own.length} parcels (${steep} too steep, kept as open land) for ${needs} program needs${dropped.length > 0 ? `; dropped ${dropped.join(", ")}` : ""}`);
        if (own.length === 0) {
          warnings.push(`${name}: no street runs through its ${site.coreRadius} m core; connect it with a road edge`);
        } else if (own.length - steep < needs) {
          warnings.push(`${name}: its core's streets hold ${own.length - steep} buildable parcels, short of ${needs}; add streets through the core or widen it`);
        }
      }
      parcels.push(...own);
      for (const parcel of own) placements.push(plate(parcel, input));
    }
    return { placements, generated: { parcels }, warnings };
  },
};

/** Street lines with at least one point within `reach` of the centre. */
function nearby(lines: readonly StreetLine[], center: WorldPoint, reach: number): DistanceSource[] {
  return lines
    .filter((line) => line.points.some(([x, z]) => Math.hypot(x - center[0], z - center[1]) <= reach + 100))
    .map((line) => ({ kind: "polyline", points: line.points, radii: line.halfWidths }));
}

/** Protected regions and other protected settlements, as shapes. */
export function protectedAreas(recipe: WorldRecipe, self: PlanSettlement): Array<(point: WorldPoint) => boolean> {
  const tests: Array<(point: WorldPoint) => boolean> = recipe.ownership.protectedRegions.map(({ min, max }) =>
    ([x, z]: WorldPoint) => x >= min[0] && x <= max[0] && z >= min[1] && z <= max[1]);
  for (const settlement of recipe.plan.settlements) {
    if (!settlement.protected || settlement.id === self.id) continue;
    const shape: DistanceSource | null = settlement.boundary
      ? { kind: "polygon", polygon: settlement.boundary }
      : settlement.radius !== undefined ? { kind: "point", position: settlement.center, radius: settlement.radius } : null;
    if (shape) tests.push((point) => sourceDistance(point, shape) === 0);
  }
  return tests;
}

function blocker(
  roads: readonly DistanceSource[],
  water: readonly DistanceSource[],
  guarded: ReadonlyArray<(point: WorldPoint) => boolean>,
): (point: WorldPoint) => "road" | "water" | "protected" | null {
  return (point) => {
    if (roads.some((road) => sourceDistance(point, road) === 0)) return "road";
    if (water.some((source) => sourceDistance(point, source) <= WATER_CLEARANCE)) return "water";
    if (guarded.some((test) => test(point))) return "protected";
    return null;
  };
}

function plate(parcel: GeneratedParcel, input: StageInput): GeneratedPlacement {
  const box = parcelBox(parcel.polygon);
  const ground = input.sampleHeight(box.center[0], box.center[1]) ?? 0;
  const placement: LayoutPlacement & { id: string } = {
    id: parcelMarkerId(parcel.id),
    role: "marker.parcel",
    name: parcel.id,
    position: [box.center[0], ground + PLATE_HEIGHT / 2, box.center[1]],
    rotation: [0, (Math.atan2(-box.along[1], box.along[0]) * 180) / Math.PI, 0],
    scale: [box.length / SHAPE_PRIMITIVE_SIZE, PLATE_HEIGHT / SHAPE_PRIMITIVE_SIZE, box.width / SHAPE_PRIMITIVE_SIZE],
    collision: false,
  };
  return { assetId: shapeAssetId("cube"), placement };
}

/** A settlement's default seed: FNV-1a of its id mixed with the recipe seed. */
export function hashSeed(seed: number, id: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}
