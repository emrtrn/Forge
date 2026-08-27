/**
 * Pointer -> look-delta bridge (runtime DOM layer).
 *
 * Accumulates pointer movement for whichever mode the active PlayerController
 * requests. The default camera keeps the editor-like right-drag gesture; TPS
 * asks for browser pointer lock so look deltas flow without holding a mouse
 * button and Escape releases control / shows the cursor again.
 *
 * The math (look angles) lives in pure game code.
 */
import type { InputMode, PointerLookMode } from "@/scene/gameModeTypes";

export interface PointerLookSourceOptions {
  readonly onInputModeChange?: (mode: InputMode) => void;
}

export class PointerLookSource {
  private mode: PointerLookMode = "right-drag";
  private cursorVisible = true;
  private active = false;
  private pointerId: number | null = null;
  private dx = 0;
  private dy = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: PointerLookSourceOptions = {},
  ) {}

  attach(): void {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
  }

  detach(): void {
    this.setMode("right-drag");
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
  }

  setMode(mode: PointerLookMode): void {
    if (this.mode === mode) {
      if (mode === "pointer-lock" && document.pointerLockElement !== this.canvas) {
        this.requestPointerLock();
      }
      return;
    }

    this.mode = mode;
    this.active = false;
    this.pointerId = null;
    this.dx = 0;
    this.dy = 0;

    if (mode === "pointer-lock") {
      this.applyCursor();
      this.requestPointerLock();
      return;
    }

    this.setMouseCursorVisible(true);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  setMouseCursorVisible(visible: boolean): void {
    this.cursorVisible = visible;
    this.applyCursor();
  }

  /**
   * Releases pointer lock without changing the look mode (e.g. a UI screen
   * opened over a pointer-lock game). No-op when not locked; the cursor returns
   * via the resulting `pointerlockchange`.
   */
  release(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /**
   * Re-acquires pointer lock after a UI screen closes, but only when the look
   * mode is pointer-lock — a no-op for right-drag. Must be called from a user
   * gesture to succeed; otherwise the next canvas press re-locks.
   */
  reengage(): void {
    if (this.mode === "pointer-lock" && document.pointerLockElement !== this.canvas) {
      this.requestPointerLock();
    }
  }

  /** Returns the look delta (pixels) accumulated since the last call and resets it. */
  consume(): { dx: number; dy: number } {
    const delta = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return delta;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (this.mode === "pointer-lock") {
      event.preventDefault();
      if (document.pointerLockElement !== this.canvas) this.requestPointerLock();
      return;
    }

    if (event.button !== 2) return;
    event.preventDefault();
    this.active = true;
    this.pointerId = event.pointerId;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be unavailable; the move handler still works.
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.mode === "pointer-lock") {
      if (document.pointerLockElement !== this.canvas) return;
      this.dx += event.movementX;
      this.dy += event.movementY;
      return;
    }

    if (!this.active || event.pointerId !== this.pointerId) return;
    this.dx += event.movementX;
    this.dy += event.movementY;
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = null;
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Capture may already be gone.
    }
  };

  private handleContextMenu = (event: Event): void => {
    // Right-drag / pointer-lock look would otherwise pop the browser context menu.
    event.preventDefault();
  };

  private handlePointerLockChange = (): void => {
    if (this.mode !== "pointer-lock") return;
    const locked = document.pointerLockElement === this.canvas;
    if (!locked) {
      this.dx = 0;
      this.dy = 0;
      this.cursorVisible = true;
      this.options.onInputModeChange?.("ui");
    } else {
      this.options.onInputModeChange?.("game");
    }
    this.applyCursor();
  };

  private requestPointerLock(): void {
    try {
      const result = this.canvas.requestPointerLock();
      if (result instanceof Promise) {
        result.catch(() => {
          this.cursorVisible = true;
          this.applyCursor();
        });
      }
    } catch {
      this.cursorVisible = true;
      this.applyCursor();
    }
  }

  private applyCursor(): void {
    this.canvas.style.cursor =
      this.cursorVisible && document.pointerLockElement !== this.canvas ? "" : "none";
  }
}
