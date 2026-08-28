/**
 * Lightweight Game Mode catalog: id + display metadata only, no Three.js or
 * session code. The editor's World Settings dropdown and the save/runtime
 * fallback import this so they never pull the heavy runtime session classes
 * (`registry.ts`) into the editor bundle.
 *
 * This is project/game content, not engine or editor core — it lives under
 * `src/game` so the editor stays generic and only references it as data.
 */

export interface GameModeOption {
  /** Stable id stored in `worldSettings.gameMode`. */
  readonly id: string;
  /** Human-facing label shown in the editor dropdown. */
  readonly displayName: string;
  /** One-line summary of what the mode does. */
  readonly description: string;
}

/** Built-in Game Mode used when a layout selects none / an unknown id. */
export const DEFAULT_GAME_MODE_ID = "forge.defaultCamera";

/** Third-person Game Mode that possesses a player character at the Player Start. */
export const TPS_GAME_MODE_ID = "forge.tpsCharacter";

/** Characterless top-down strategy Game Mode: edge-pan, wheel zoom, click select. */
export const RTS_GAME_MODE_ID = "forge.rtsCamera";

/**
 * The selectable Game Modes, in dropdown order. The first entry is the default
 * camera mode and must keep `DEFAULT_GAME_MODE_ID`.
 */
export const GAME_MODE_OPTIONS: readonly GameModeOption[] = [
  {
    id: DEFAULT_GAME_MODE_ID,
    displayName: "Default Camera",
    description: "Runtime-only WASD camera pawn. No character is possessed.",
  },
  {
    id: TPS_GAME_MODE_ID,
    displayName: "TPS Character",
    description: "Possesses an input-driven character with a third-person follow camera.",
  },
  {
    id: RTS_GAME_MODE_ID,
    displayName: "RTS Camera",
    description:
      "Characterless top-down camera: edge-pan + WASD, wheel zoom, click to select a unit.",
  },
];

/** True when `id` names one of the built-in Game Modes. */
export function isKnownGameModeId(id: string | undefined): boolean {
  return id !== undefined && GAME_MODE_OPTIONS.some((option) => option.id === id);
}

/**
 * True when `id` references a project Game Mode Actor Script (a `*.actor.json`
 * path stored in `worldSettings.gameMode`) rather than a built-in mode id.
 * Built-in ids use the `forge.` namespace; project modes are class refs.
 */
export function isGameModeClassRef(id: string | undefined): boolean {
  return typeof id === "string" && id.endsWith(".actor.json");
}

/**
 * Resolves an authored (possibly unknown / undefined) Game Mode id to a usable
 * one. Built-in ids and project Game Mode class refs pass through unchanged;
 * anything else (old/malformed ids, absent value) falls back to
 * {@link DEFAULT_GAME_MODE_ID}, so old layouts boot as the default camera mode.
 */
export function normalizeGameModeId(id: string | undefined): string {
  if (isKnownGameModeId(id) || isGameModeClassRef(id)) return id as string;
  return DEFAULT_GAME_MODE_ID;
}
