/** The stages World Builder offers, in their default run order. */
import type { WorldStage } from "../stage";
import { planBlockoutStage } from "./planBlockout";

export function createDefaultWorldStages(): WorldStage[] {
  return [planBlockoutStage];
}
