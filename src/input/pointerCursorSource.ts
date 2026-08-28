/**
 * Pointer position + wheel bridge (runtime DOM layer).
 *
 * The look bridge next door ({@link PointerLookSource}) answers "how far did the
 * pointer *move*"; this one answers "where is the pointer *now*, and how much
 * was scrolled". Screen-edge camera controls and click selection — the
 * vocabulary of a top-down strategy game — need the absolute position, which a
 * relative look delta can never reconstruct.
 *
 * Observer only, with one exception: `wheel` is preventDefault-ed so a zoom
 * gesture over the canvas does not also scroll or zoom the page. Position is
 * normalized to the canvas ([0,1] from its top-left) so game code never touches
 * pixels or DOM rects, and reads `null` while the pointer is outside.
 *
 * The math (edge-pan intent, zoom clamping) lives in pure game code.
 */

/** Pointer position over the canvas, normalized to [0,1] from the top-left. */
export interface PointerViewportPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Converts a raw `WheelEvent` delta into scroll notches (positive = scrolled
 * down / away, the conventional "zoom out" direction). Pure, so the deltaMode
 * arithmetic is unit-tested without a browser.
 *
 * Browsers report the same gesture in pixels, lines or pages depending on the
 * device and platform; normalizing here keeps a mode's zoom step meaning the
 * same everywhere. A single event is clamped so a coarse trackpad flick cannot
 * jump the whole zoom range in one frame.
 */
export function wheelNotches(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  // 0 = pixel, 1 = line, 2 = page (WheelEvent.DOM_DELTA_*).
  const perNotch = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100;
  const notches = deltaY / perNotch;
  return notches < -3 ? -3 : notches > 3 ? 3 : notches;
}

export class PointerCursorSource {
  private position: PointerViewportPosition | null = null;
  private wheel = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerdown", this.handlePointerMove);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.addEventListener("pointercancel", this.handlePointerLeave);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    window.addEventListener("blur", this.handleBlur);
  }

  detach(): void {
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerdown", this.handlePointerMove);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("pointercancel", this.handlePointerLeave);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("blur", this.handleBlur);
    this.position = null;
    this.wheel = 0;
  }

  /** Normalized pointer position, or null while the pointer is off the canvas. */
  viewportPosition(): PointerViewportPosition | null {
    return this.position;
  }

  /** Scroll notches accumulated since the last call. Resets on read. */
  consumeWheel(): number {
    const notches = this.wheel;
    this.wheel = 0;
    return notches;
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.position = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  private handlePointerLeave = (): void => {
    // Edge-pan must stop at the window border, not run on forever because the
    // last sample happened to sit in the margin.
    this.position = null;
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.wheel += wheelNotches(event.deltaY, event.deltaMode);
  };

  private handleBlur = (): void => {
    this.position = null;
    this.wheel = 0;
  };
}
