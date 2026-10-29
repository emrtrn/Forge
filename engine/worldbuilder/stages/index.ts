/** The stages World Builder offers, in their default run order. */
import type { WorldStage } from "../stage";
import { planBlockoutStage } from "./planBlockout";
import { roadsStage } from "./roads";
import { buildingsStage } from "./buildings";
import { furnitureStage } from "./furniture";
import { landUseStage } from "./landUse";
import { parcelsStage } from "./parcels";
import { settlementSitesStage } from "./settlementSites";
import { streetsStage } from "./streets";

export function createDefaultWorldStages(): WorldStage[] {
  return [planBlockoutStage, roadsStage, settlementSitesStage, streetsStage, parcelsStage, landUseStage, buildingsStage, furnitureStage];
}
