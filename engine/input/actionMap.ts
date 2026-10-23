/**
 * Pure, DOM-free input action map.
 *
 * Maps raw input codes (keyboard `event.code` strings, or synthetic
 * pointer/button codes) to named, game-meaningful actions, and derives per-tick
 * pressed/held/released edges from the set of codes currently down.
 *
 * No DOM, no `engine/core`, no render imports: a DOM source feeds raw codes in
 * (see the runtime `KeyboardInputSource`) and the `InputSubsystem` calls
 * `advance()` once per engine tick. Behaviors then read action state.
 */

/** A raw input code (keyboard `event.code`, or a synthetic pointer/button id). */
export type RawInputCode = string;

/** A named, game-meaningful action (e.g. "move-forward", "jump"). */
export type ActionName = string;
/** A named analog axis (e.g. "look-x", "move-x"). */
export type AxisName = string;

/** Per-tick state for one action. */
export interface ActionState {
  /** True only on the tick the action transitioned from up to down. */
  readonly pressed: boolean;
  /** True for every tick the action is down (including the press tick). */
  readonly held: boolean;
  /** True only on the tick the action transitioned from down to up. */
  readonly released: boolean;
}

/** Raw-code -> action-name bindings. Many codes may map to one action. */
export type ActionBindings = Readonly<Record<RawInputCode, ActionName>>;

export interface AxisModifiers {
  /** Values with an absolute magnitude at or below this threshold become zero. */
  readonly deadzone?: number;
  /**
   * Stretches the range past the deadzone back over 0..1, so the value starts
   * from 0 at the deadzone's edge instead of jumping to it (a stick that steers
   * or a trigger that is a pedal).
   */
  readonly rescaleDeadzone?: boolean;
  /** Multiplies the post-deadzone value. */
  readonly scale?: number;
  /** Flips the post-scale value. */
  readonly invert?: boolean;
}

export interface AxisBinding extends AxisModifiers {
  readonly axis: AxisName;
}

/** Raw analog code -> axis binding. Many codes may contribute to one axis. */
export type AxisBindings = Readonly<Record<RawInputCode, AxisName | AxisBinding>>;

const IDLE: ActionState = { pressed: false, held: false, released: false };

export class ActionMap {
  private readonly bindings: Map<RawInputCode, ActionName>;
  private readonly axisBindings = new Map<RawInputCode, AxisBinding>();
  private readonly downCodes = new Set<RawInputCode>();
  private readonly rawAxes = new Map<RawInputCode, number>();
  private readonly rawAxisDeltas = new Map<RawInputCode, number>();
  private heldActions = new Set<ActionName>();
  private states = new Map<ActionName, ActionState>();
  private axes = new Map<AxisName, number>();

  constructor(bindings: ActionBindings = {}, axisBindings: AxisBindings = {}) {
    this.bindings = new Map(Object.entries(bindings));
    for (const [code, binding] of Object.entries(axisBindings)) {
      if (typeof binding === "string") this.bindAxis(code, binding);
      else this.bindAxis(code, binding.axis, binding);
    }
  }

  /** Binds a raw code to a named action, replacing any existing binding. */
  bind(code: RawInputCode, action: ActionName): void {
    this.bindings.set(code, action);
  }

  /** Binds a raw analog code to a named axis, replacing any existing binding. */
  bindAxis(code: RawInputCode, axis: AxisName, modifiers: AxisModifiers = {}): void {
    this.axisBindings.set(code, { axis, ...modifiers });
  }

  /** Records a raw code as physically down. Safe to call repeatedly. */
  handleDown(code: RawInputCode): void {
    this.downCodes.add(code);
  }

  /** Records a raw code as physically up. */
  handleUp(code: RawInputCode): void {
    this.downCodes.delete(code);
  }

  /** Records an absolute analog value, such as a gamepad stick axis in [-1, 1]. */
  handleAxis(code: RawInputCode, value: number): void {
    this.rawAxes.set(code, Number.isFinite(value) ? value : 0);
  }

  /** Accumulates a relative analog delta, such as mouse movement this frame. */
  addAxisDelta(code: RawInputCode, delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.rawAxisDeltas.set(code, (this.rawAxisDeltas.get(code) ?? 0) + delta);
  }

  /** Clears all physical key state (e.g. on window blur / focus loss). */
  reset(): void {
    this.downCodes.clear();
    this.rawAxes.clear();
    this.rawAxisDeltas.clear();
    this.axes.clear();
  }

  /**
   * Recomputes per-tick action edges from the codes currently down versus the
   * actions held at the previous `advance()`. Call exactly once per engine tick
   * (the `InputSubsystem` does this) before behaviors read action state.
   */
  advance(): void {
    const currentHeld = new Set<ActionName>();
    for (const code of this.downCodes) {
      const action = this.bindings.get(code);
      if (action) currentHeld.add(action);
    }

    const states = new Map<ActionName, ActionState>();
    for (const action of new Set<ActionName>([...currentHeld, ...this.heldActions])) {
      const held = currentHeld.has(action);
      const wasHeld = this.heldActions.has(action);
      states.set(action, {
        pressed: held && !wasHeld,
        held,
        released: !held && wasHeld,
      });
    }

    this.states = states;
    this.heldActions = currentHeld;
    this.axes = this.computeAxes();
    this.rawAxisDeltas.clear();
  }

  /** Returns the current-tick state for an action (idle if untouched). */
  get(action: ActionName): ActionState {
    return this.states.get(action) ?? IDLE;
  }

  pressed(action: ActionName): boolean {
    return this.get(action).pressed;
  }

  held(action: ActionName): boolean {
    return this.get(action).held;
  }

  released(action: ActionName): boolean {
    return this.get(action).released;
  }

  /** Returns the current-tick analog value for an axis, or 0 when idle. */
  axis(axis: AxisName): number {
    return this.axes.get(axis) ?? 0;
  }

  private computeAxes(): Map<AxisName, number> {
    const axes = new Map<AxisName, number>();
    for (const [code, binding] of this.axisBindings) {
      const raw = (this.rawAxes.get(code) ?? 0) + (this.rawAxisDeltas.get(code) ?? 0);
      const value = applyAxisModifiers(raw, binding);
      if (value === 0) continue;
      axes.set(binding.axis, clampAxis((axes.get(binding.axis) ?? 0) + value));
    }
    return axes;
  }
}

function applyAxisModifiers(value: number, modifiers: AxisModifiers): number {
  if (!Number.isFinite(value)) return 0;
  const deadzone = Math.max(0, modifiers.deadzone ?? 0);
  if (Math.abs(value) <= deadzone) return 0;
  const live = modifiers.rescaleDeadzone && deadzone < 1
    ? Math.sign(value) * (Math.abs(value) - deadzone) / (1 - deadzone)
    : value;
  const scaled = live * (modifiers.scale ?? 1);
  return modifiers.invert ? -scaled : scaled;
}

function clampAxis(value: number): number {
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}
