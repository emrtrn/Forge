/**
 * World Environment game clock (WES v0.3 §6.1). The hour is a **closed form**
 * of the accumulated simulation time, never a per-frame sum of hours: 30, 60
 * and 144 Hz updates land on the same hour and the clock does not drift
 * (ENV-14). The caller feeds simulation seconds (already scaled and paused by
 * `TimeControl`), so pause and time scale reach the clock for free.
 */

export const HOURS_PER_DAY = 24;

/** Wraps any hour into [0, 24). */
export function wrapHour(hour: number): number {
  const wrapped = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  return wrapped >= HOURS_PER_DAY ? 0 : wrapped;
}

/**
 * The hour `elapsedSeconds` of simulation after `startHour`, for a day that
 * lasts `dayLengthMinutes` real minutes. A day length of 0 (or less) stops the
 * clock at `startHour`.
 */
export function clockHour(startHour: number, elapsedSeconds: number, dayLengthMinutes: number): number {
  if (!(dayLengthMinutes > 0)) return wrapHour(startHour);
  return wrapHour(startHour + (HOURS_PER_DAY * elapsedSeconds) / (60 * dayLengthMinutes));
}

/**
 * A running clock: the start hour plus the simulation time accumulated since.
 * `setHour` re-bases it, so a jump (a gameplay `setHour`, a level default) does
 * not carry the old elapsed time into the new hour.
 */
export class WorldClock {
  private startHour: number;
  private elapsedSeconds = 0;

  constructor(hour: number, private dayLengthMinutes: number) {
    this.startHour = wrapHour(hour);
  }

  get hour(): number {
    return clockHour(this.startHour, this.elapsedSeconds, this.dayLengthMinutes);
  }

  get dayLength(): number {
    return this.dayLengthMinutes;
  }

  /** Advances by simulation seconds; negative or non-finite deltas are ignored. */
  advance(simulationSeconds: number): void {
    if (!(simulationSeconds > 0) || !Number.isFinite(simulationSeconds)) return;
    this.elapsedSeconds += simulationSeconds;
  }

  setHour(hour: number): void {
    this.startHour = wrapHour(hour);
    this.elapsedSeconds = 0;
  }

  setDayLength(minutes: number): void {
    // Keep the current hour continuous across the change.
    this.startHour = this.hour;
    this.elapsedSeconds = 0;
    this.dayLengthMinutes = minutes;
  }
}
