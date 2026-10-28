/** The stages World Builder offers, in their default run order. */
import type { WorldStage } from "../stage";
import { planBlockoutStage } from "./planBlockout";
import { roadsStage } from "./roads";

export function createDefaultWorldStages(): WorldStage[] {
  return [planBlockoutStage, roadsStage];
}
