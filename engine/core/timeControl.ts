/**
 * Pause and time scale for the simulation — pure, with no clock of its own.
 *
 * Forge had neither before this. `deltaMs` came off `requestAnimationFrame`,
 * got clamped to 100 ms and went straight into every subsystem; there was no way
 * to hold the world still or to run it faster, in the runtime or in the editor's
 * Play flow.
 *
 * Two rules shape the whole design:
 *
 *  1. **A pause is held, not set.** Several things want the world still for
 *     unrelated reasons — a menu, a cutscene, a diagnostic taking a measurement
 *     — and they will overlap. So a pause is a *set of holders*: releasing yours
 *     resumes nothing that someone else is still holding, and a diagnostic that
 *     paused a scene the player had already paused leaves it exactly as it found
 *     it. A boolean here would mean the last release wins, which is how a
 *     diagnostic ends up silently un-pausing a player's menu.
 *  2. **Time scale is not a pause.** It survives one: pausing and resuming gives
 *     back the speed you had, rather than snapping to 1x. They answer different
 *     questions ("is the world moving?" and "how fast?") and collapsing them
 *     into one number loses the second.
 *
 * What it deliberately does *not* do: sub-stepping. The reference implementation
 * this was taken from ran N fixed simulation ticks per frame at Nx, which is
 * only meaningful with a fixed-step loop. Forge has a variable-step one, so a
 * scale multiplier is the honest translation; fixed-step is a separate decision
 * for the day something needs it.
 */

/** The holder a diagnostic pause takes, so it can release exactly its own. */
export const DIAGNOSTIC_TIME_HOLDER = "diagnostic";

/**
 * Bounds on the scale. The floor is above zero on purpose: "stopped" is what a
 * pause is for, and a zero scale would be a second, untracked way to stop the
 * world that nothing could tell apart from a very slow one.
 */
export const MIN_TIME_SCALE = 0.05;
export const MAX_TIME_SCALE = 16;

export class TimeControl {
  private scale = 1;
  /** Everyone currently holding the world still; empty means running. */
  private readonly holders = new Set<string>();

  /** Simulation speed multiplier. Unaffected by, and preserved across, pauses. */
  get timeScale(): number {
    return this.scale;
  }

  /** True while anything at all is holding a pause. */
  get paused(): boolean {
    return this.holders.size > 0;
  }

  /** Whether this particular holder is the reason (or one of the reasons). */
  heldBy(holder: string): boolean {
    return this.holders.has(holder);
  }

  /** Who is holding, in the order they took hold — for a readout, not a decision. */
  pausedBy(): readonly string[] {
    return [...this.holders];
  }

  /**
   * Sets the speed multiplier, clamped to {@link MIN_TIME_SCALE}…{@link
   * MAX_TIME_SCALE}. A non-finite value is refused rather than propagated: one
   * `NaN` here would turn every delta downstream into `NaN` for the rest of the
   * session, with nothing to point at afterwards.
   */
  setTimeScale(value: number): number {
    if (!Number.isFinite(value)) return this.scale;
    this.scale = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, value));
    return this.scale;
  }

  /** Takes a hold. Idempotent — the same holder pausing twice still holds once. */
  pause(holder: string): void {
    this.holders.add(holder);
  }

  /** Releases one holder's hold; a holder that has none is a no-op, not an error. */
  resume(holder: string): void {
    this.holders.delete(holder);
  }

  /** Releases every hold. For teardown — never for "close the diagnostic". */
  resumeAll(): void {
    this.holders.clear();
  }

  /**
   * The delta the simulation should advance by: the raw one scaled, or exactly
   * zero while anything holds a pause.
   *
   * Only the simulation. Frame-time metrics must keep reading the *raw* delta or
   * a stall measurement would report 4x fewer milliseconds at 4x speed and a
   * paused game would look like it never dropped a frame in its life.
   */
  simulationDelta(rawDelta: number): number {
    if (this.paused) return 0;
    return rawDelta * this.scale;
  }
}
