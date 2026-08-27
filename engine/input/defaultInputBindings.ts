/**
 * Canonical runtime input bindings: raw input codes → named actions.
 *
 * This is the code-owned key map the runtime `ActionMap` is seeded with (the
 * "action mapping" half of Forge's input, alongside the look/move axis mapping).
 * It lives here, separate from `RuntimeSceneApp`, so editor-side read-only views
 * (e.g. the Actor Script Details montage→input panel) can resolve an action to
 * its physical key without importing the whole runtime app.
 *
 * `SceneApp` keeps its own reduced editor-preview subset; this is the full game
 * set, including the montage-relevant `fire`/`aim`/`emote` actions.
 */
import type { ActionBindings } from "@engine/input/actionMap";

export const DEFAULT_INPUT_BINDINGS: ActionBindings = {
  KeyW: "move-forward",
  ArrowUp: "move-forward",
  KeyS: "move-back",
  ArrowDown: "move-back",
  KeyA: "move-left",
  ArrowLeft: "move-left",
  KeyD: "move-right",
  ArrowRight: "move-right",
  KeyE: "interact",
  KeyQ: "emote",
  Space: "jump",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  // Toggles the pause menu (worldSettings.pauseMenuWidget). Escape also releases
  // browser pointer lock; the runtime UI host reconciles the two.
  Escape: "menu",
  Mouse0: "fire",
  Mouse2: "aim",
  // Debug/demo toggle: drop the possessed character into a physics ragdoll, then
  // press again to get back up (only fires when the character authored physics
  // bodies). Game logic drives the same activation/recovery by targeting the pawn
  // with `death`/`ragdoll`/`getup` script messages — the key is just a manual aid.
  KeyR: "ragdoll",
};

/** Raw input codes bound to an action, in declaration order (may be empty). */
export function keysForAction(
  action: string,
  bindings: ActionBindings = DEFAULT_INPUT_BINDINGS,
): string[] {
  return Object.entries(bindings)
    .filter(([, boundAction]) => boundAction === action)
    .map(([code]) => code);
}

const POINTER_LABELS: Record<string, string> = {
  Mouse0: "Left Mouse",
  Mouse1: "Middle Mouse",
  Mouse2: "Right Mouse",
};

/** A human-readable label for a raw input code (e.g. `KeyQ` → "Q"). */
export function formatInputCode(code: string): string {
  if (code in POINTER_LABELS) return POINTER_LABELS[code]!;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return `${code.slice(5)} Arrow`;
  if (code === "ShiftLeft") return "Left Shift";
  if (code === "ShiftRight") return "Right Shift";
  return code;
}
