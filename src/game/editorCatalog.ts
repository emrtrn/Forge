/**
 * Assembles the game-owned catalogs/helpers the editor renders into a single
 * plain object. The composition root (`src/main.ts`) injects it into the editor
 * via `setGameEditorCatalog` (`@/editor/gameEditorRegistry`).
 *
 * This module imports NO editor code, so the `game → editor` direction stays
 * clean and the editor never imports `@/game`. Its inferred shape structurally
 * satisfies the editor's `GameEditorCatalog` contract; the assignability check
 * happens at the injection site in `src/main.ts` (the only module that sees both
 * layers), keeping this a data/behavior provider with no editor dependency.
 */
import { GAME_MODE_OPTIONS } from "@/game/gameModes/catalog";
import { BEHAVIOR_SCRIPT_IDS } from "@/game/behaviors";
import { resolveMontageBindings } from "@/game/montageInputBindings";
import { formatInputCode, keysForAction } from "@engine/input/defaultInputBindings";
import { createRagdollDriver } from "@/game/ragdollDriver";

export const GAME_EDITOR_CATALOG = {
  gameModeOptions: GAME_MODE_OPTIONS,
  behaviorScriptIds: BEHAVIOR_SCRIPT_IDS,
  resolveMontageBindings,
  formatInputCode,
  keysForAction,
  createRagdollDriver,
};
