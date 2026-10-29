/**
 * `settlementSites` stage: L1 program + L2 site for every plan settlement
 * (World Builder plan v0.4 §13.3, §13.5; F1 step 9).
 *
 * Writes `recipe.generated.sites` — the chosen centre, the built-up core
 * and the resolved program the parcel and land-use stages read. It places
 * nothing in the level: v1 stood a flat disc on the core, which on sloping
 * ground floated above it on one side and sank on the other, and v2 removes
 * it (the editor draws the core instead). A slide from the planned centre is
 * reported with its reason. With no valid site the settlement gets no site,
 * and the report says why: the stage does not put a village somewhere bad.
 *
 * The core grows from the centre over buildable ground until it holds the
 * area the program needs (`growCore`, v2): along a valley a village runs along
 * the valley instead of a disc reaching up its sides. Ground that holds less
 * is reported.
 *
 * A road node linked to the settlement (`settlement`) that ends up outside
 * the chosen core is reported (v3): the site slid away from the plan, and the
 * road built to the node would stop short of the settlement. The stage never
 * moves plan elements; the user does (Plan Corrections).
 *
 * A protected settlement keeps the site it has (or its planned centre); its
 * program is still refreshed.
 */
import { growCore, inCore, type CoreGrowth } from "../core";
import { deriveSettlementProgram } from "../program";
import type { GeneratedSite } from "../recipe";
import { resolveRoadClass } from "../roadClass";
import { estimateCoreRadius, selectSite } from "../siteSelection";
import type { StageInput, StageOutput, WorldStage } from "../stage";

export const SETTLEMENT_SITES_STAGE_ID = "settlementSites";

/** Placement id of the core disc v1 placed; a v2 run removes it. */
export function siteMarkerId(settlementId: string): string {
  return `wb-site-${settlementId}`;
}

export const settlementSitesStage: WorldStage = {
  id: SETTLEMENT_SITES_STAGE_ID,
  label: "Settlement sites",
  version: 3,
  run(input: StageInput): StageOutput {
    const { recipe, profile } = input;
    const sites: GeneratedSite[] = [];
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
          coreRadius: kept?.core ? kept.coreRadius : coreRadius,
          ...(kept?.core ? { core: kept.core } : {}),
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
        const core = growCore(input, chosen.center, Math.PI * coreRadius * coreRadius, {
          maxSlopeDeg: resolveRoadClass(profile, "local").maxSlopeDeg,
        });
        const short = coreShortfall(core);
        if (short) warnings.push(`${name}: ${short}`);
        const shape = { center: chosen.center, radius: core.reach, outline: core.outline };
        for (const node of recipe.plan.roadGraph.nodes) {
          if (node.settlement !== settlement.id || inCore(shape, node.position)) continue;
          const away = Math.round(Math.hypot(node.position[0] - chosen.center[0], node.position[1] - chosen.center[1]));
          warnings.push(`${name}: its road node ${node.id} is outside the chosen core, ${away} m from its centre; move the node (Plan Corrections) so its road reaches the settlement`);
        }
        site = {
          settlement: settlement.id,
          center: chosen.center,
          coreRadius: core.reach,
          core: core.outline,
          score: chosen.score!,
          dwellings: program.dwellings,
          program: program.lines,
        };
      }
      sites.push(site);
    }
    return { placements: [], generated: { sites }, warnings };
  },
};

const STOP_TEXT: Record<keyof CoreGrowth["stopped"], string> = {
  steep: "steep ground",
  water: "water",
  flood: "flood-prone ground",
  protected: "protected areas",
  offTerrain: "the terrain's edge",
  reach: "its farthest reach",
};

/** Text for a core that holds less than 90 % of its area, naming what stopped it; null when it holds enough. */
function coreShortfall(core: CoreGrowth): string | null {
  if (core.area >= 0.9 * core.targetArea) return null;
  const stops = (Object.entries(core.stopped) as Array<[keyof CoreGrowth["stopped"], number]>)
    .sort((a, b) => b[1] - a[1])
    .map(([reason]) => STOP_TEXT[reason]);
  const share = Math.round((100 * core.area) / Math.max(1, core.targetArea));
  return `the buildable ground around its centre holds ${share}% of the core its program needs (stopped by ${stops.join(", ")})`;
}
