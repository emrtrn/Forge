/**
 * The `?debug` speed picker: pause, and a simulation speed multiplier.
 *
 * It sits in the panel's reserved control slot rather than among the action
 * buttons, because it is a *state* you leave set, not an action you fire — and
 * the slot keeps it leftmost so a later action button cannot displace it.
 *
 * The pause is taken under the diagnostic holder, so closing the panel (or the
 * game pausing itself for a menu) never leaves the world stopped by something
 * that is no longer asking for it. See {@link TimeControl}.
 */
import { DIAGNOSTIC_TIME_HOLDER, type TimeControl } from "@engine/core/timeControl";

/** Offered speeds. 1x first because it is where you return to, not where you go. */
export const DEBUG_SPEEDS = [1, 2, 4, 8] as const;

export class DebugSpeedControl {
  private readonly root = document.createElement("div");
  private readonly pauseButton = document.createElement("button");
  private readonly speedButtons = new Map<number, HTMLButtonElement>();

  constructor(private readonly time: TimeControl) {
    this.root.className = "forge-debug-speed";

    this.pauseButton.type = "button";
    this.pauseButton.className = "forge-debug-panel-button";
    this.pauseButton.dataset.forgeDebugAction = "toggle-pause";
    this.pauseButton.title =
      "Hold the world still (rendering continues). Releases only this hold — a pause the game itself is holding stays.";
    this.pauseButton.addEventListener("click", () => {
      if (this.time.heldBy(DIAGNOSTIC_TIME_HOLDER)) this.time.resume(DIAGNOSTIC_TIME_HOLDER);
      else this.time.pause(DIAGNOSTIC_TIME_HOLDER);
      this.refresh();
    });
    this.root.appendChild(this.pauseButton);

    for (const speed of DEBUG_SPEEDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "forge-debug-panel-button";
      button.dataset.forgeDebugAction = `speed-${speed}`;
      button.textContent = `${speed}x`;
      button.title = `Run the simulation at ${speed}x. Frame-time metrics keep reading real time.`;
      button.addEventListener("click", () => {
        this.time.setTimeScale(speed);
        this.refresh();
      });
      this.speedButtons.set(speed, button);
      this.root.appendChild(button);
    }
    this.refresh();
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  /**
   * Repaints from the live state rather than from what was last clicked, so a
   * pause taken elsewhere (a menu, a cutscene) shows here too — and so the
   * button says what the world is doing, not what this control asked for.
   */
  refresh(): void {
    const paused = this.time.paused;
    const mine = this.time.heldBy(DIAGNOSTIC_TIME_HOLDER);
    this.pauseButton.textContent = paused ? "Resume" : "Pause";
    // Held by someone else as well: this button cannot resume the world, and
    // saying so beats offering a Resume that does nothing.
    this.pauseButton.dataset.forgeDebugHeld = paused && !mine ? "other" : mine ? "self" : "none";
    this.pauseButton.classList.toggle("is-active", paused);
    for (const [speed, button] of this.speedButtons) {
      button.classList.toggle("is-active", this.time.timeScale === speed);
    }
  }

  dispose(): void {
    // Leaves the world as it was found: releases this control's own hold and
    // nothing else's.
    this.time.resume(DIAGNOSTIC_TIME_HOLDER);
    this.root.remove();
  }
}
