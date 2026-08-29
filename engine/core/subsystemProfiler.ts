/**
 * Pure per-subsystem tick-timing aggregator (Performance Infrastructure, P5.1).
 *
 * Side-effect free: no DOM, no three.js, no clock of its own. The engine update
 * loop times each subsystem's `update()` and feeds the elapsed milliseconds here
 * via {@link SubsystemProfiler.record}; this class keeps a rolling window per
 * subsystem and derives a sorted {@link SubsystemProfileSnapshot} the `?debug`
 * overlay reads. Because it only takes already-measured numbers, it is fully
 * deterministic and unit-tested without a real clock.
 *
 * The profiler is only instantiated under `?debug` (see {@link EngineApp}), so it
 * adds no cost to the production frame loop — the registry keeps its plain,
 * un-timed update path when no recorder is attached.
 */

import {
  FrameRegionRegistry,
  type FrameRegionDefinition,
} from "../perf/frameRegions";

/** Minimal surface the {@link SubsystemRegistry} needs — keeps it decoupled. */
export interface SubsystemTimingRecorder {
  record(id: string, ms: number): void;
  /**
   * Says where a region sits in the frame. Optional so a recorder that only
   * collects flat timings still satisfies the surface; a caller that declares
   * nothing gets the flat listing this profiler had before regions existed.
   */
  declareRegion?(definition: FrameRegionDefinition): void;
  /**
   * Closes the frame. Called at the **real** end of the frame by whoever owns
   * the loop — not by the subsystem block, which is only one region of it.
   */
  endFrame(): void;
}

export interface SubsystemTiming {
  readonly id: string;
  /** Milliseconds spent in this subsystem's most recent `update()`. */
  readonly lastMs: number;
  /** Mean `update()` cost across the rolling window. */
  readonly averageMs: number;
  /** Worst `update()` cost within the rolling window (spike visibility). */
  readonly maxMs: number;
  /** Samples currently in the window (ramps up to the window size). */
  readonly samples: number;
  /**
   * The region this one nests inside, or null for a top-level region of the
   * frame. Optional so a hand-built snapshot (tests, a fork's own recorder)
   * still type-checks and simply reads as flat.
   */
  readonly parent?: string | null;
  /** Diagnostic-only cost the shipped build does not pay. */
  readonly debugOnly?: boolean;
}

/**
 * One region as a single frame recorded it, beside the window it sits in.
 *
 * Both halves are needed and neither replaces the other: one frame on its own
 * is noise (a GC pause, a shader compile, a cadence tick that fires every few
 * seconds), and a window on its own cannot show the frame you just watched
 * stutter.
 */
export interface FrameRegionSample {
  readonly id: string;
  readonly parent: string | null;
  readonly debugOnly: boolean;
  /**
   * Cost in the captured frame, summed over every span recorded under this id
   * that frame. `null` means the region did not run at all — which is a
   * different fact from running for no measurable time, and is reported as
   * such rather than as a zero.
   */
  readonly frameMs: number | null;
  readonly averageMs: number;
  readonly maxMs: number;
}

/** One frame's regions, with the window they are read against. */
export interface FrameProfileCapture {
  /** The captured frame's own total, or null when nothing measured the frame. */
  readonly totalMs: number | null;
  readonly averageTotalMs: number;
  readonly maxTotalMs: number;
  /** Frames the average and peak columns cover. */
  readonly windowFrames: number;
  readonly regions: readonly FrameRegionSample[];
}

/** The whole frame — the denominator every region is a share of. */
export interface FrameTotals {
  readonly lastMs: number;
  readonly averageMs: number;
  readonly maxMs: number;
  readonly samples: number;
}

export interface SubsystemProfileSnapshot {
  /** Per-subsystem timings, sorted by `averageMs` descending (worst first). */
  readonly subsystems: readonly SubsystemTiming[];
  /**
   * Sum of the **top-level** regions' `averageMs` — the windowed CPU cost that
   * was measured, with nothing double-counted.
   *
   * Only roots, because a group's timing already contains its children's:
   * summing every row would count the same milliseconds twice and hand the
   * bottleneck classifier a CPU share above 1.0. With no parent links declared
   * every region is a root, which is the flat sum this field always was.
   */
  readonly totalAverageMs: number;
  /**
   * The part of that measured cost only the diagnostic route pays, held apart
   * from {@link totalAverageMs} rather than folded into it.
   *
   * Because the bottleneck classifier reads the total, and a `?debug` session
   * whose own overlay work pushed it over the CPU threshold would diagnose the
   * instrument instead of the game. The shipped build never runs these
   * regions, so they must not be part of the number a verdict is drawn from —
   * but they are still reported, because a reader comparing a diagnostic frame
   * against a shipped one needs to know what the difference cost.
   */
  readonly debugOnlyAverageMs?: number;
  /** Frames observed since the profiler was created / last cleared. */
  readonly frames: number;
  /**
   * The frame itself, when something measured it — the denominator the region
   * shares and the `unmeasured` residual are computed against. Null means
   * nobody timed the whole frame, which is a different answer from zero.
   */
  readonly frame?: FrameTotals | null;
}

/** Fixed-size rolling window of the last `size` numeric samples. */
class RollingWindow {
  private readonly buf: number[] = [];
  private sum = 0;
  private head = 0;
  private lastValue = 0;

  constructor(private readonly size: number) {}

  push(value: number): void {
    this.lastValue = value;
    if (this.buf.length < this.size) {
      this.buf.push(value);
      this.sum += value;
      return;
    }
    this.sum -= this.buf[this.head]!;
    this.buf[this.head] = value;
    this.sum += value;
    this.head = (this.head + 1) % this.size;
  }

  get last(): number {
    return this.lastValue;
  }

  get count(): number {
    return this.buf.length;
  }

  get average(): number {
    return this.buf.length === 0 ? 0 : this.sum / this.buf.length;
  }

  get max(): number {
    let peak = 0;
    for (const value of this.buf) if (value > peak) peak = value;
    return peak;
  }
}

const DEFAULT_WINDOW_FRAMES = 60;

export class SubsystemProfiler implements SubsystemTimingRecorder {
  /** Insertion-ordered so subsystems with identical averages keep a stable order. */
  private readonly windows = new Map<string, RollingWindow>();
  /** Where the recorded regions sit in the frame; empty until something declares. */
  readonly regions = new FrameRegionRegistry();
  /** The whole-frame window, filled only once something calls {@link recordFrame}. */
  private frameWindow: RollingWindow | null = null;
  /**
   * What each region has cost *this* frame so far, cleared by {@link endFrame}.
   *
   * Accumulated rather than overwritten, so a region entered more than once in
   * a frame reports the frame's total for it and not just its last span.
   */
  private readonly currentFrame = new Map<string, number>();
  private frameCount = 0;

  constructor(private readonly windowFrames: number = DEFAULT_WINDOW_FRAMES) {}

  /** Records one subsystem's `update()` cost in milliseconds for this frame. */
  record(id: string, ms: number): void {
    // Clamp negatives (clock skew) to zero so a bad sample can't corrupt the mean.
    const sample = ms > 0 ? ms : 0;
    let window = this.windows.get(id);
    if (!window) {
      window = new RollingWindow(this.windowFrames);
      this.windows.set(id, window);
    }
    window.push(sample);
    this.currentFrame.set(id, (this.currentFrame.get(id) ?? 0) + sample);
  }

  /** Declares where a region sits in the frame. See {@link FrameRegionRegistry}. */
  declareRegion(definition: FrameRegionDefinition): void {
    this.regions.declare(definition);
  }

  /**
   * Records the whole frame — the denominator, kept in its own window rather
   * than among the regions so it can never be sorted in beside them as a row.
   */
  recordFrame(ms: number): void {
    if (!this.frameWindow) this.frameWindow = new RollingWindow(this.windowFrames);
    this.frameWindow.push(ms > 0 ? ms : 0);
  }

  /**
   * Marks the end of a frame (advances the frame counter).
   *
   * Called by whoever owns the frame loop, at the point the frame actually
   * ends. It used to be called by the subsystem block, which made the
   * profiler's idea of a frame stop where the engine subsystems stopped —
   * with everything the shell does afterwards (game modes, UI, environment,
   * the render submit) falling outside it and going unmeasured.
   */
  endFrame(): void {
    this.frameCount += 1;
    this.currentFrame.clear();
  }

  /**
   * The frame in progress, with each region's cost in it beside its window.
   *
   * Must be called **before** {@link endFrame} clears the frame, and as the
   * last thing the frame does — whatever the caller then draws with the result
   * must not be part of the frame the result describes.
   */
  captureFrame(): FrameProfileCapture {
    const frameWindow = this.frameWindow;
    const regions: FrameRegionSample[] = [];
    for (const [id, window] of this.windows) {
      regions.push({
        id,
        parent: this.regions.parentOf(id),
        debugOnly: this.regions.isDebugOnly(id),
        // Absent, not zero: a region that did not run this frame and one that
        // ran immeasurably fast are different findings.
        frameMs: this.currentFrame.get(id) ?? null,
        averageMs: window.average,
        maxMs: window.max,
      });
    }
    return {
      totalMs: frameWindow ? frameWindow.last : null,
      averageTotalMs: frameWindow?.average ?? 0,
      maxTotalMs: frameWindow?.max ?? 0,
      windowFrames: frameWindow?.count ?? 0,
      regions,
    };
  }

  snapshot(): SubsystemProfileSnapshot {
    const subsystems: SubsystemTiming[] = [];
    let totalAverageMs = 0;
    let debugOnlyAverageMs = 0;
    for (const [id, window] of this.windows) {
      const averageMs = window.average;
      const parent = this.regions.parentOf(id);
      const debugOnly = this.regions.isDebugOnly(id);
      // Roots only: a group's window already contains its children's time.
      if (!parent || !this.windows.has(parent)) {
        if (debugOnly) debugOnlyAverageMs += averageMs;
        else totalAverageMs += averageMs;
      }
      subsystems.push({
        id,
        lastMs: window.last,
        averageMs,
        maxMs: window.max,
        samples: window.count,
        parent,
        debugOnly,
      });
    }
    // Stable descending sort by average cost (ties keep insertion order).
    subsystems.sort((a, b) => b.averageMs - a.averageMs);
    const frameWindow = this.frameWindow;
    return {
      subsystems,
      totalAverageMs,
      debugOnlyAverageMs,
      frames: this.frameCount,
      frame: frameWindow
        ? {
            lastMs: frameWindow.last,
            averageMs: frameWindow.average,
            maxMs: frameWindow.max,
            samples: frameWindow.count,
          }
        : null,
    };
  }

  /** The `n` most expensive subsystems by rolling average (worst first). */
  top(n: number): SubsystemTiming[] {
    return this.snapshot().subsystems.slice(0, Math.max(0, n));
  }

  /**
   * Resets all windows and the frame counter (e.g. after a level teardown).
   * Region declarations survive: they describe the shape of the frame, which a
   * level change does not alter.
   */
  clear(): void {
    this.windows.clear();
    this.frameWindow = null;
    this.currentFrame.clear();
    this.frameCount = 0;
  }
}
