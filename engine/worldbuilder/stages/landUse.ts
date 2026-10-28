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
 */
import { assignLandUse, coreEntrances, landUseBase, type UnmetReason } from "../landUse";
import { streetLines, waterSources } from "../masks";
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
  version: 1,
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
        entrances: coreEntrances(streets, site.center, site.coreRadius),
        water,
        sampleHeight: input.sampleHeight,
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
