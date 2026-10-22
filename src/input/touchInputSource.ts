import type { ActionMap } from "@engine/input/actionMap";
import { GAMEPAD_AXIS_BINDINGS, PAD_LOOK_X, PAD_LOOK_Y, PAD_MOVE_X, PAD_MOVE_Y } from "./gamepadInput";
import { joystickMoveCodes, joystickVector } from "./virtualJoystick";

/** Left-stick move codes the touch move pad emits (shared with the gamepad). */
const MOVE_CODE_ACTIONS: Readonly<Record<string, string>> = {
  Pad_LStickUp: "move-forward",
  Pad_LStickDown: "move-back",
  Pad_LStickLeft: "move-left",
  Pad_LStickRight: "move-right",
};

interface TouchButtonDef {
  readonly code: string;
  readonly action: string;
  readonly label: string;
}

const TOUCH_BUTTONS: readonly TouchButtonDef[] = [
  { code: "Touch_Jump", action: "jump", label: "Jump" },
  { code: "Touch_Interact", action: "interact", label: "Use" },
];

const MOVE_RADIUS = 56;
const LOOK_RADIUS = 90;

/**
 * On-screen touch controls → {@link ActionMap} bridge (runtime DOM layer).
 *
 * Splits the viewport into a left move pad (a dynamic virtual stick thresholded
 * into the shared `Pad_LStick*` move codes) and a right look pad (drag deflection
 * fed as the analog `Pad_RStick*` look axes the gamepad also uses), plus tap
 * buttons (jump / interact) and a pause button. Event-driven like the keyboard
 * source — no per-frame poll. Mount only on touch-capable hosts; the runtime
 * hides it while a UI screen (pause/outcome) is open via {@link setVisible}.
 */
export class TouchInputSource {
  private readonly root: HTMLDivElement;
  private readonly moveKnob: HTMLDivElement;
  private moveTouchId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private moveCodes = new Set<string>();
  private lookTouchId: number | null = null;
  private lookOrigin = { x: 0, y: 0 };
  private readonly buttonTouches = new Map<number, TouchButtonDef>();

  constructor(
    private readonly actions: ActionMap,
    private readonly host: HTMLElement,
  ) {
    this.root = document.createElement("div");
    this.root.className = "forge-touch-controls";
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      touchAction: "none",
      userSelect: "none",
      overflow: "hidden",
      zIndex: "5",
    } satisfies Partial<CSSStyleDeclaration>);

    const moveZone = this.zone("0", "0");
    const lookZone = this.zone("auto", "0");
    this.moveKnob = document.createElement("div");
    Object.assign(this.moveKnob.style, {
      position: "absolute",
      width: `${MOVE_RADIUS}px`,
      height: `${MOVE_RADIUS}px`,
      marginLeft: `${-MOVE_RADIUS / 2}px`,
      marginTop: `${-MOVE_RADIUS / 2}px`,
      borderRadius: "50%",
      background: "rgba(255,255,255,0.18)",
      border: "2px solid rgba(255,255,255,0.55)",
      display: "none",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);

    moveZone.addEventListener("touchstart", this.onMoveStart, { passive: false });
    lookZone.addEventListener("touchstart", this.onLookStart, { passive: false });
    this.root.append(moveZone, lookZone, this.moveKnob, this.buttonBar());
    // Move/look tracking lives on the root so a finger that slides off its zone
    // keeps driving until release.
    this.root.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.root.addEventListener("touchend", this.onTouchEnd, { passive: false });
    this.root.addEventListener("touchcancel", this.onTouchEnd, { passive: false });
  }

  /** Installs the touch bindings + mounts the controls. */
  attach(): void {
    for (const [code, action] of Object.entries(MOVE_CODE_ACTIONS)) this.actions.bind(code, action);
    for (const [code, binding] of Object.entries(GAMEPAD_AXIS_BINDINGS)) {
      if (typeof binding === "string") this.actions.bindAxis(code, binding);
      else this.actions.bindAxis(code, binding.axis, binding);
    }
    for (const def of TOUCH_BUTTONS) this.actions.bind(def.code, def.action);
    this.actions.bind("Touch_Menu", "menu");
    this.host.appendChild(this.root);
  }

  detach(): void {
    this.releaseAll();
    this.root.remove();
  }

  /** Shows/hides the controls; hiding releases any held input so it can't stick. */
  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "block" : "none";
    if (!visible) this.releaseAll();
  }

  // --- move pad ------------------------------------------------------------

  private readonly onMoveStart = (event: TouchEvent): void => {
    if (this.moveTouchId !== null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    event.preventDefault();
    this.moveTouchId = touch.identifier;
    this.moveOrigin = { x: touch.clientX, y: touch.clientY };
    this.moveKnob.style.display = "block";
    this.placeKnob(touch.clientX, touch.clientY);
  };

  private updateMove(touch: Touch): void {
    this.placeKnob(touch.clientX, touch.clientY);
    const vec = joystickVector(
      touch.clientX - this.moveOrigin.x,
      touch.clientY - this.moveOrigin.y,
      MOVE_RADIUS,
    );
    this.applyMoveCodes(new Set(joystickMoveCodes(vec)));
    this.actions.handleAxis(PAD_MOVE_X, vec.x);
    this.actions.handleAxis(PAD_MOVE_Y, vec.y);
  }

  private applyMoveCodes(next: Set<string>): void {
    for (const code of next) if (!this.moveCodes.has(code)) this.actions.handleDown(code);
    for (const code of this.moveCodes) if (!next.has(code)) this.actions.handleUp(code);
    this.moveCodes = next;
  }

  private placeKnob(x: number, y: number): void {
    this.moveKnob.style.left = `${x}px`;
    this.moveKnob.style.top = `${y}px`;
  }

  private endMove(): void {
    this.moveTouchId = null;
    this.moveKnob.style.display = "none";
    this.applyMoveCodes(new Set());
    this.actions.handleAxis(PAD_MOVE_X, 0);
    this.actions.handleAxis(PAD_MOVE_Y, 0);
  }

  // --- look pad ------------------------------------------------------------

  private readonly onLookStart = (event: TouchEvent): void => {
    if (this.lookTouchId !== null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    event.preventDefault();
    this.lookTouchId = touch.identifier;
    this.lookOrigin = { x: touch.clientX, y: touch.clientY };
  };

  private updateLook(touch: Touch): void {
    const vec = joystickVector(
      touch.clientX - this.lookOrigin.x,
      touch.clientY - this.lookOrigin.y,
      LOOK_RADIUS,
    );
    this.actions.handleAxis(PAD_LOOK_X, vec.x);
    this.actions.handleAxis(PAD_LOOK_Y, vec.y);
  }

  private endLook(): void {
    this.lookTouchId = null;
    this.actions.handleAxis(PAD_LOOK_X, 0);
    this.actions.handleAxis(PAD_LOOK_Y, 0);
  }

  // --- shared touch routing ------------------------------------------------

  private readonly onTouchMove = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.moveTouchId) {
        event.preventDefault();
        this.updateMove(touch);
      } else if (touch.identifier === this.lookTouchId) {
        event.preventDefault();
        this.updateLook(touch);
      }
    }
  };

  private readonly onTouchEnd = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.moveTouchId) this.endMove();
      else if (touch.identifier === this.lookTouchId) this.endLook();
    }
  };

  // --- buttons -------------------------------------------------------------

  private buttonBar(): HTMLDivElement {
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "absolute",
      right: "24px",
      bottom: "32px",
      display: "flex",
      gap: "16px",
      alignItems: "flex-end",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    for (const def of TOUCH_BUTTONS) bar.appendChild(this.button(def, 72));

    const menu = this.button({ code: "Touch_Menu", action: "menu", label: "II" }, 44);
    Object.assign(menu.style, { position: "absolute", top: "20px", right: "24px", bottom: "auto" });
    this.root.appendChild(menu);
    return bar;
  }

  private button(def: TouchButtonDef, size: number): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = def.label;
    el.setAttribute("aria-label", def.action);
    Object.assign(el.style, {
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.55)",
      background: "rgba(255,255,255,0.18)",
      color: "#fff",
      font: "600 14px system-ui, sans-serif",
      pointerEvents: "auto",
      touchAction: "none",
      cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    const press = (event: TouchEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.buttonTouches.set(event.changedTouches[0]?.identifier ?? -1, def);
      this.actions.handleDown(def.code);
      el.style.background = "rgba(255,255,255,0.4)";
    };
    const release = (event: TouchEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.handleUp(def.code);
      el.style.background = "rgba(255,255,255,0.18)";
    };
    el.addEventListener("touchstart", press, { passive: false });
    el.addEventListener("touchend", release, { passive: false });
    el.addEventListener("touchcancel", release, { passive: false });
    return el;
  }

  private zone(left: string, right: string): HTMLDivElement {
    const zone = document.createElement("div");
    Object.assign(zone.style, {
      position: "absolute",
      top: "0",
      bottom: "0",
      left,
      right,
      width: "50%",
      pointerEvents: "auto",
      touchAction: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    return zone;
  }

  /** Releases every held code/axis (hide / detach / focus loss). */
  private releaseAll(): void {
    this.endMove();
    this.endLook();
    for (const def of this.buttonTouches.values()) this.actions.handleUp(def.code);
    this.buttonTouches.clear();
  }
}

/** True when the host environment is likely touch-driven (mount the controls then). */
export function isTouchLikely(): boolean {
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return true;
  return typeof window !== "undefined" && "ontouchstart" in window;
}
