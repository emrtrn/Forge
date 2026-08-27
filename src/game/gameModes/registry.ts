/**
 * Runtime Game Mode registry: resolves an authored `worldSettings.gameMode` id to
 * a concrete {@link GameModeDefinition}. Imports the session implementations (and
 * therefore Three.js), so only the runtime shell uses it — the editor reads the
 * lightweight {@link GAME_MODE_OPTIONS} catalog instead.
 */
import { DEFAULT_GAME_MODE_ID } from "./catalog";
import { defaultCameraGameMode } from "./defaultCameraGameMode";
import { tpsCharacterGameMode } from "./tpsCharacterGameMode";
import type { GameModeDefinition } from "@/scene/gameModeTypes";

const MODES = new Map<string, GameModeDefinition>(
  [defaultCameraGameMode, tpsCharacterGameMode].map((mode) => [mode.id, mode]),
);

export { DEFAULT_GAME_MODE_ID } from "./catalog";

/**
 * Resolves a (possibly unknown / undefined) Game Mode id to a registered mode,
 * falling back to the default camera mode so old or malformed layouts boot
 * safely.
 */
export function resolveGameMode(id: string | undefined): GameModeDefinition {
  const mode = id !== undefined ? MODES.get(id) : undefined;
  return mode ?? (MODES.get(DEFAULT_GAME_MODE_ID) as GameModeDefinition);
}

/** All registered Game Modes, in insertion order. */
export function listGameModes(): GameModeDefinition[] {
  return [...MODES.values()];
}
