/**
 * `settlementSites` stage: L1 program + L2 site for every plan settlement
 * (World Builder plan v0.4 §13.3, §13.5; F1 step 9).
 *
 * Writes `recipe.generated.sites` — the chosen centre, the built-up core
 * radius and the resolved program the parcel and land-use stages read — and a
 * flat disc marker of the core on the terrain, so the user sees where each
 * settlement landed. A slide from the planned centre is reported with its
 * reason. With no valid site the settlement gets no site and no marker, and
 * the report says why: the stage does not put a village somewhere bad.
 *
 * A protected settlement keeps the site it has (or its planned centre); its
 * program is still refreshed.
 */
import type { LayoutPlacement } from "../../scene/layout";
import { SHAPE_PRIMITIVE_SIZE, shapeAssetId } from "../../scene/shapes";
import { deriveSettlementProgram } from "../program";
import type { GeneratedSite, PlanSettlement } from "../recipe";
import { estimateCoreRadius, selectSite } from "../siteSelection";
import type { GeneratedPlacement, StageInput, StageOutput, WorldStage } from "../stage";

export const SETTLEMENT_SITES_STAGE_ID = "settlementSites";

/** Placement id of a settlement's core marker. */
export function siteMarkerId(settlementId: string): string {
  return `wb-site-${settlementId}`;
}

/** Marker disc thickness, metres. */
const MARKER_HEIGHT = 0.5;

export const settlementSitesStage: WorldStage = {
  id: SETTLEMENT_SITES_STAGE_ID,
  label: "Settlement sites",
  version: 1,
  run(input: StageInput): StageOutput {
    const { recipe, profile } = input;
    const sites: GeneratedSite[] = [];
    const placements: GeneratedPlacement[] = [];
    const warnings: string[] = [];

    for (const settlement of recipe.plan.settlements) {
      const name = `settlement ${settlement.id}`;
      if (settlement.regionProfile !== undefined && settlement.regionProfile !== recipe.regionProfile) {
        warnings.push(`${name} names its own region profile (${settlement.regionProfile}); per-settlement profiles are not loaded yet, so the recipe's applies`);
      }
      const program = deriveSettlementProgram(settlement, profile, input.programExtensions ?? []);
      warnings.push(...program.warnings);
      const coreRadius = estimateCoreRadius(program, profile);
      if (settlement.radius !== undefined && coreRadius > settlement.radius) {
        warnings.push(`${name}: its program needs a ${coreRadius} m core, wider than its ${settlement.radius} m search radius`);
      }

      let site: GeneratedSite;
      if (settlement.protected) {
        const kept = recipe.generated.sites.find((entry) => entry.settlement === settlement.id);
        site = {
          settlement: settlement.id,
          center: kept?.center ?? settlement.center,
          coreRadius,
          ...(kept?.score === undefined ? {} : { score: kept.score }),
          dwellings: program.dwellings,
          program: program.lines,
        };
      } else {
        const chosen = selectSite(input, settlement, coreRadius, profile);
        if (!chosen.center) {
          warnings.push(`${name}: ${chosen.reason}; it gets no site — move its centre or widen its radius`);
          continue;
        }
        if (chosen.shift > 0) warnings.push(`${name}: moved ${Math.round(chosen.shift)} m from the planned centre (${chosen.reason})`);
        site = {
          settlement: settlement.id,
          center: chosen.center,
          coreRadius,
          score: chosen.score!,
          dwellings: program.dwellings,
          program: program.lines,
        };
      }
      sites.push(site);
      placements.push(marker(settlement, site, input, warnings));
    }
    return { placements, generated: { sites }, warnings };
  },
};

function marker(settlement: PlanSettlement, site: GeneratedSite, input: StageInput, warnings: string[]): GeneratedPlacement {
  const [x, z] = site.center;
  const ground = input.sampleHeight(x, z);
  if (ground === null) warnings.push(`settlement ${settlement.id}: its site is off the terrain; the marker stands at y = 0`);
  const diameter = (2 * site.coreRadius) / SHAPE_PRIMITIVE_SIZE;
  const placement: LayoutPlacement & { id: string } = {
    id: siteMarkerId(settlement.id),
    role: "marker.settlement.site",
    name: `${settlement.id} site`,
    position: [x, (ground ?? 0) + MARKER_HEIGHT / 2, z],
    scale: [diameter, MARKER_HEIGHT / SHAPE_PRIMITIVE_SIZE, diameter],
  };
  return { assetId: shapeAssetId("cylinder"), placement };
}
