/**
 * Pure gamepad → action-map mapping (DOM-free, testable).
 *
 * The W3C "standard" gamepad layout maps cleanly onto Forge's existing actions:
 * the left stick + D-pad threshold into the digital `move-*` actions, the right
 * stick drives the analog `look-x`/`look-y` axes, and face/shoulder/start
 * buttons map to jump/interact/sprint/fire/aim/menu. {@link readGamepadCodes}
 * turns one poll of a {@link GamepadSnapshotLike} into the synthetic raw codes
 * that should be down plus the analog look values; the DOM
 * `GamepadInputSource` diffs those against the previous poll and feeds the
 * {@link ActionMap}. The touch source reuses the same look axes + move codes.
 */
import type { ActionBindings, AxisBindings } from "@engine/input/actionMap";

/** Synthetic raw codes the right stick / touch look-pad feed as analog axes. */
export const PAD_LOOK_X = "Pad_RStickX";
export const PAD_LOOK_Y = "Pad_RStickY";

/**
 * The left stick (and touch move-pad) as analog values, alongside its
 * thresholded `Pad_LStick*` codes: what a vehicle steers with, where a digital
 * move key would only say "full lock".
 */
export const PAD_MOVE_X = "Pad_LStickX";
export const PAD_MOVE_Y = "Pad_LStickY";
/** Trigger travel 0..1 (the `Pad_LT`/`Pad_RT` codes are its pressed state). */
export const PAD_LT_VALUE = "Pad_LTValue";
export const PAD_RT_VALUE = "Pad_RTValue";

/** Analog sticks + triggers → axes. Shared by gamepad + touch. */
export const GAMEPAD_AXIS_BINDINGS: AxisBindings = {
  [PAD_LOOK_X]: { axis: "look-x", deadzone: 0.16, scale: 1.25 },
  [PAD_LOOK_Y]: { axis: "look-y", deadzone: 0.16, scale: 1.25 },
  [PAD_MOVE_X]: { axis: "move-x", deadzone: 0.12, rescaleDeadzone: true },
  [PAD_MOVE_Y]: { axis: "move-y", deadzone: 0.12, rescaleDeadzone: true },
  [PAD_LT_VALUE]: { axis: "trigger-left", deadzone: 0.04, rescaleDeadzone: true },
  [PAD_RT_VALUE]: { axis: "trigger-right", deadzone: 0.04, rescaleDeadzone: true },
};

/**
 * Digital gamepad codes → actions. The stick-direction + D-pad codes are shared
 * with the touch move-stick, so a project rebinding `move-*` reaches both.
 */
export const GAMEPAD_BUTTON_BINDINGS: ActionBindings = {
  Pad_A: "jump",
  Pad_X: "interact",
  Pad_B: "emote",
  Pad_Y: "ragdoll",
  Pad_RB: "sprint",
  Pad_RT: "fire",
  Pad_LT: "aim",
  Pad_Start: "menu",
  Pad_DpadUp: "move-forward",
  Pad_DpadDown: "move-back",
  Pad_DpadLeft: "move-left",
  Pad_DpadRight: "move-right",
  Pad_LStickUp: "move-forward",
  Pad_LStickDown: "move-back",
  Pad_LStickLeft: "move-left",
  Pad_LStickRight: "move-right",
};

/** Standard-layout button index → synthetic raw code. */
const STANDARD_BUTTON_CODES: Readonly<Record<number, string>> = {
  0: "Pad_A",
  1: "Pad_B",
  2: "Pad_X",
  3: "Pad_Y",
  4: "Pad_LB",
  5: "Pad_RB",
  6: "Pad_LT",
  7: "Pad_RT",
  8: "Pad_Back",
  9: "Pad_Start",
  10: "Pad_L3",
  11: "Pad_R3",
  12: "Pad_DpadUp",
  13: "Pad_DpadDown",
  14: "Pad_DpadLeft",
  15: "Pad_DpadRight",
};

/** Minimal structural view of a `Gamepad` so the mapper stays DOM/test-friendly. */
export interface GamepadSnapshotLike {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value?: number }[];
}

export interface GamepadReadOptions {
  /** Left-stick magnitude past which a direction counts as held (default 0.5). */
  readonly stickThreshold?: number;
}

export interface GamepadReadResult {
  /** Synthetic codes currently active (pressed buttons + thresholded stick/D-pad). */
  readonly down: string[];
  /** `[code, rawValue]` pairs for the analog stick + trigger axes, fed via `handleAxis`. */
  readonly axes: Array<[string, number]>;
}

function axisAt(snapshot: GamepadSnapshotLike, index: number): number {
  const value = snapshot.axes[index];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Reads one gamepad poll into the codes that should be down and the analog look
 * values. Pure: the source owns the down/up edge diffing and the live ActionMap.
 */
export function readGamepadCodes(
  snapshot: GamepadSnapshotLike,
  options: GamepadReadOptions = {},
): GamepadReadResult {
  const threshold = options.stickThreshold ?? 0.5;
  const down: string[] = [];

  for (let i = 0; i < snapshot.buttons.length; i += 1) {
    const code = STANDARD_BUTTON_CODES[i];
    if (code && snapshot.buttons[i]?.pressed) down.push(code);
  }

  const lx = axisAt(snapshot, 0);
  const ly = axisAt(snapshot, 1);
  if (ly <= -threshold) down.push("Pad_LStickUp");
  if (ly >= threshold) down.push("Pad_LStickDown");
  if (lx <= -threshold) down.push("Pad_LStickLeft");
  if (lx >= threshold) down.push("Pad_LStickRight");

  return {
    down,
    axes: [
      [PAD_LOOK_X, axisAt(snapshot, 2)],
      [PAD_LOOK_Y, axisAt(snapshot, 3)],
      [PAD_MOVE_X, lx],
      [PAD_MOVE_Y, ly],
      [PAD_LT_VALUE, triggerAt(snapshot, 6)],
      [PAD_RT_VALUE, triggerAt(snapshot, 7)],
    ],
  };
}

/** A trigger's travel; a pad that reports no value is all-or-nothing. */
function triggerAt(snapshot: GamepadSnapshotLike, index: number): number {
  const button = snapshot.buttons[index];
  if (!button) return 0;
  const value = button.value;
  return typeof value === "number" && Number.isFinite(value) ? value : button.pressed ? 1 : 0;
}

/** First connected gamepad from a `navigator.getGamepads()`-shaped list, or null. */
export function firstConnectedGamepad(
  pads: ReadonlyArray<GamepadSnapshotLike | null>,
): GamepadSnapshotLike | null {
  for (const pad of pads) if (pad) return pad;
  return null;
}
