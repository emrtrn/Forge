/**
 * `landUse` stage: a role for every parcel (World Builder plan v0.4 §13.5 L5;
 * F1 step 11, T39).
 *
 * Reads `recipe.generated.parcels` (run `parcels` first) and each site's
 * program and dwelling count, and rewrites the parcels with `landUse`, `role`
 * and, where a large role took several neighbouring parcels, `partOf`. It
 * starts every run from the parcels as the parcel stage left them
 * (`landUseBase`), so a re-run on its own output changes nothing.
 *
 * Data only: what stands on a parcel is the placeholder step (L6). The report
 * gives the land-use split, the merged lots, the vacant parcels, neighbouring
 * pairs with negative compatibility and every program line it could not place,
 * with the reason. A protected settlement keeps its parcels as they are.
 *
 * Low ground (industry downstream) is ranked by the level of the street in
 * front of a parcel — the nearest road spline's centre line — not by the
 * ground under it (v2): Apply Pads levels the parcels and would re-rank them,
 * leaving the stage stale after the bake. A street no spline realises yet has
 * no level; the ground is read there.
 */
import { assignLandUse, coreEntrances, landUseBase, type UnmetReason } from "../landUse";
import { streetLines, waterSources, type StreetLine } from "../masks";
import type { WorldPoint } from "../normalize";
import type { GeneratedParcel } from "../recipe";
import type { StageInput, StageOutput, WorldStage } from "../stage";
import { LAND_USES } from "../vocabulary";
import { hashSeed } from "./parcels";

export const LAND_USE_STAGE_ID = "landUse";

/** Mixed into the settlement seed so the land-use stream differs from the parcel one. */
const SEED_SALT = 0x4c5f5553;

const UNMET_TEXT: Record<UnmetReason, string> = {
  noParcel: "no parcel left",
  tooSmall: "no parcel fits it, even merged with its neighbours",
  forbidden: "every parcel that fits borders a forbidden land use",
};

export const landUseStage: WorldStage = {
  id: LAND_USE_STAGE_ID,
  label: "Land use",
  version: 2,
  run(input: StageInput): StageOutput {
    const { recipe, profile } = input;
    const warnings: string[] = [];
    if (recipe.plan.settlements.length > 0 && recipe.generated.parcels.length === 0) {
      warnings.push("no settlement has parcels yet; run Parcels first");
      return { placements: [], warnings };
    }
    if (!profile) warnings.push("no region profile; roles take their land use from their id or siting, and nothing is merged");

    const edges = new Map(recipe.plan.roadGraph.edges.map((edge) => [edge.id, edge.roadClass]));
    const streets = streetLines(input).lines;
    const water = waterSources(input).sources;
    const rewritten = new Map<string, GeneratedParcel>();

    for (const settlement of recipe.plan.settlements) {
      const name = `settlement ${settlement.id}`;
      const own = recipe.generated.parcels.filter((parcel) => parcel.settlement === settlement.id);
      if (settlement.protected || own.length === 0) continue;
      const site = recipe.generated.sites.find((entry) => entry.settlement === settlement.id);
      if (!site) {
        warnings.push(`${name} has parcels but no site; its parcels keep their land use`);
        continue;
      }
      const result = assignLandUse({
        center: site.center,
        coreRadius: site.coreRadius,
        parcels: own.map(landUseBase),
        dwellings: site.dwellings,
        program: site.program,
        profile,
        edgeClass: (edge) => edges.get(edge),
        entrances: coreEntrances(streets, site.center, site.coreRadius, site.core),
        water,
        sampleHeight: (x, z) => streetLevel(streets, [x, z]) ?? input.sampleHeight(x, z),
        seed: ((settlement.seed ?? hashSeed(recipe.seed, settlement.id)) ^ SEED_SALT) >>> 0,
      });
      for (const parcel of result.parcels) rewritten.set(parcel.id, parcel);

      const split = LAND_USES
        .map((landUse) => [landUse, result.parcels.filter((parcel) => parcel.landUse === landUse).length] as const)
        .filter(([, count]) => count > 0)
        .map(([landUse, count]) => `${count} ${landUse}`);
      const merged = result.assignments.filter((entry) => entry.parcels.length > 1);
      const lots = merged.length > 0
        ? `; ${merged.length} large roles took ${merged.reduce((sum, entry) => sum + entry.parcels.length, 0)} parcels`
        : "";
      warnings.push(`${name}: ${own.length} parcels → ${[...split, `${result.vacant} vacant`].join(", ")}${lots}`);
      if (profile && !Object.values(profile.roles).some((role) => role.landUse === "residential") && site.dwellings > 0) {
        warnings.push(`${name}: the region profile has no residential role; dwellings use ${result.dwellingRole}`);
      }
      for (const line of result.unmet) {
        warnings.push(`${name}: no suitable parcel for ${line.missing} of ${line.count} ${line.role} (${UNMET_TEXT[line.reason]})`);
      }
      if (result.conflicts > 0) warnings.push(`${name}: ${result.conflicts} neighbouring parcel pairs have negative land-use compatibility`);
    }

    const parcels = recipe.generated.parcels.map((parcel) => rewritten.get(parcel.id) ?? parcel);
    return { placements: [], generated: { parcels }, warnings };
  },
};

/** A street front is this close to its parcels' centres, metres; farther lines are another street's. */
const STREET_REACH = 60;

/** Centre-line level of the nearest street a spline realises, within `STREET_REACH`; null without one. */
function streetLevel(streets: readonly StreetLine[], point: WorldPoint): number | null {
  let best: { distance: number; height: number } | null = null;
  for (const line of streets) {
    const heights = line.heights;
    if (!heights) continue;
    for (let index = 1; index < line.points.length; index += 1) {
      const a = line.points[index - 1]!;
      const b = line.points[index]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq));
      const distance = Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t));
      if (distance > STREET_REACH || (best && distance >= best.distance)) continue;
      best = { distance, height: heights[index - 1]! + (heights[index]! - heights[index - 1]!) * t };
    }
  }
  return best?.height ?? null;
}
