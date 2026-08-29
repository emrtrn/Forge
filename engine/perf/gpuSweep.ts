/**
 * The GPU sweep: what each category of scene content costs the GPU, measured by
 * turning it off and re-measuring the whole frame.
 *
 * Timer queries cannot nest, so there is no way to ask the GPU what a subset of
 * a frame cost while that frame is being drawn. The only honest alternative is
 * an A/B: draw the frame as it is, then draw it again without shadows, again
 * without foliage, and so on, and report the differences.
 *
 * That makes this table the **opposite** of the CPU capture, and the difference
 * is load-bearing:
 *
 *  - **Its rows do not add up to the frame, and are not supposed to.** Removing
 *    shadows changes overdraw, state changes and early-z for everything left
 *    behind. Two categories can each "cost" 3 ms while removing both saves 4.
 *  - **A row is a saving, not a cost.** "shadow map: 4.20 ms" means turning it
 *    off gives that back — which is exactly the shape of a quality-setting
 *    decision, and exactly not the shape of a budget.
 *  - **Small rows are noise.** Browsers quantise timer results as a side-channel
 *    mitigation, so anything near the noise floor is reported as such rather
 *    than as a precise small number.
 *
 * ## Why every step is bracketed by its own baseline
 *
 * An A/B across time only holds while the machine stays the same, and over a
 * multi-second sweep it does not: a held, cheap scene lets the GPU drop into a
 * lower power state, and the same frame then measures several times slower at
 * the end of the run than at the start. Measured against a single baseline taken
 * first, that drift is indistinguishable from content cost — and it shows up
 * with the wrong sign, as categories whose removal "costs" 7 ms.
 *
 * The driver's own disjoint flag does not catch it. A disjoint event says the
 * result is garbage; a clock change says nothing at all, because each individual
 * duration is still a true duration — of a frame drawn by a slower GPU.
 *
 * So the baseline is not measured once. It is measured before and after every
 * step, and a row is compared against the **mean of its own two neighbours**.
 * Drift that is linear across a bracket cancels; what does not cancel is visible
 * as the gap between the two, reported per row, and a row whose bracket moved as
 * far as the saving it claims is published as `uncertain` rather than as a
 * number. This costs roughly twice the frames of an unbracketed sweep, which is
 * the right trade for a table whose whole purpose is to be believed.
 *
 * Pure and DOM-free: the arithmetic and the wording are unit-tested, and the
 * modal only renders what comes out of here.
 */
import { withClipboardText, type DebugTableView } from "./debugTableView";

/** One measured configuration: the frame drawn with `id` turned off. */
export interface GpuSweepStepResult {
  readonly id: string;
  /** Median GPU ms for the frame drawn without this category. */
  readonly gpuMs: number;
  /** Samples the median came from — a thin step is worth distrusting. */
  readonly samples: number;
  /** Untouched frame measured immediately *before* this step. */
  readonly baselineBeforeMs: number;
  /** Untouched frame measured immediately *after* it. */
  readonly baselineAfterMs: number;
}

export interface GpuSweepInput {
  /**
   * Every baseline median, in measurement order: one before the first step, one
   * between each pair, one after the last. Their spread is the sweep's own
   * error bar.
   */
  readonly baselines: readonly number[];
  /** Samples behind all of those baselines together. */
  readonly baselineSamples: number;
  readonly steps: readonly GpuSweepStepResult[];
  /** Times results were thrown away mid-sweep by a GPU disjoint event. */
  readonly disjointEvents: number;
  /** Draw calls and triangles of the untouched frame, for context. */
  readonly drawCalls: number;
  readonly triangles: number;
  /** Scene seconds when the sweep finished. */
  readonly sceneSeconds: number;
}

export interface GpuSweepRow {
  readonly label: string;
  /** Frame time with this category off. */
  readonly withoutMs: number;
  /** bracket mean − without: what turning it off gives back. Can be negative. */
  readonly savingMs: number;
  /** Saving as a fraction of the headline baseline. */
  readonly share: number;
  readonly samples: number;
  /** True when the saving is inside the measurement's noise floor. */
  readonly negligible: boolean;
  /** How far this row's own two baselines disagreed. */
  readonly bracketDriftMs: number;
  /** The bracket moved at least as much as the saving: not a finding. */
  readonly unstable: boolean;
}

export interface GpuSweep {
  /** Median across every baseline measured, not just the first. */
  readonly baselineMs: number;
  readonly baselineSamples: number;
  /** How many times the untouched frame was measured. */
  readonly baselineRuns: number;
  /** Spread across those measurements — the GPU's drift over the run. */
  readonly baselineDriftMs: number;
  /** Drift large enough that the run's absolute numbers are not comparable. */
  readonly baselineDrifted: boolean;
  readonly rows: readonly GpuSweepRow[];
  readonly disjointEvents: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly sceneSeconds: number;
}

/**
 * Below this, a difference is the timer's quantisation rather than the scene's
 * content. Reporting `0.03 ms` as if it were a finding is how a table teaches
 * people to stop trusting it.
 */
export const GPU_SWEEP_NOISE_FLOOR_MS = 0.1;

/**
 * Baseline spread, as a fraction of the baseline, past which the machine changed
 * under the measurement. Bracketing still rescues the individual rows, so this
 * is a warning on the run rather than a rejection of it — but the absolute
 * `without ms` column stops being comparable between top and bottom.
 */
export const GPU_SWEEP_DRIFT_TOLERANCE = 0.25;

/**
 * Median, not mean: the first frame of a configuration pays for pipeline warm-up
 * and shader state that the steady state does not, and one such frame drags a
 * five-sample average far enough to invent a difference.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function buildGpuSweep(input: GpuSweepInput): GpuSweep {
  const baselineMs = median(input.baselines);
  const baselineDriftMs =
    input.baselines.length > 1 ? Math.max(...input.baselines) - Math.min(...input.baselines) : 0;
  const rows = input.steps.map((step) => {
    // The mean of the two neighbours, so a baseline that slid linearly across
    // the bracket contributes nothing to the difference.
    const paired = (step.baselineBeforeMs + step.baselineAfterMs) / 2;
    const savingMs = paired - step.gpuMs;
    const bracketDriftMs = Math.abs(step.baselineBeforeMs - step.baselineAfterMs);
    const negligible = Math.abs(savingMs) < GPU_SWEEP_NOISE_FLOOR_MS;
    return {
      label: step.id,
      withoutMs: step.gpuMs,
      savingMs,
      share: baselineMs > 0 ? savingMs / baselineMs : 0,
      samples: step.samples,
      negligible,
      bracketDriftMs,
      // A row whose own bracket wandered as far as its saving has not measured
      // the content; it has measured the wander.
      unstable: !negligible && bracketDriftMs >= Math.abs(savingMs),
    };
  });
  // Trustworthy rows first, each group biggest win first. Sorting an unstable
  // row into the middle by a number just declared meaningless would put it above
  // findings that are real.
  rows.sort((a, b) => {
    if (a.unstable !== b.unstable) return a.unstable ? 1 : -1;
    return b.savingMs - a.savingMs;
  });
  return {
    baselineMs,
    baselineSamples: input.baselineSamples,
    baselineRuns: input.baselines.length,
    baselineDriftMs,
    baselineDrifted: baselineMs > 0 && baselineDriftMs / baselineMs > GPU_SWEEP_DRIFT_TOLERANCE,
    rows,
    disjointEvents: input.disjointEvents,
    drawCalls: input.drawCalls,
    triangles: input.triangles,
    sceneSeconds: input.sceneSeconds,
  };
}

/** The `saving` cell: a number only when the row earned the right to show one. */
function savingCell(row: GpuSweepRow): string {
  if (row.unstable) return "uncertain";
  if (row.negligible) return "~0";
  return row.savingMs.toFixed(2);
}

function shareCell(row: GpuSweepRow): string {
  return row.unstable || row.negligible ? "—" : `${(row.share * 100).toFixed(1)}%`;
}

function rowKind(row: GpuSweepRow): string {
  if (row.unstable) return "note";
  if (row.negligible) return "residual";
  return "region";
}

function sweepMeta(sweep: GpuSweep): string {
  return (
    `baseline ${sweep.baselineMs.toFixed(2)} ms GPU ` +
    `(${sweep.baselineRuns} measurements · ${sweep.baselineSamples} samples · ` +
    `drift ${sweep.baselineDriftMs.toFixed(2)} ms) · ` +
    `${sweep.drawCalls} draw calls · ${sweep.triangles} tris · ` +
    `scene ${sweep.sceneSeconds.toFixed(1)} s`
  );
}

function sweepNotes(sweep: GpuSweep): string[] {
  const notes = [
    "Each row is a whole frame drawn with that content off; the value is the saving (baseline − without).",
    "The baseline is re-measured before and after every step, and a row is compared against the mean of its own two — so a GPU clock that slides across the run drops out of the row.",
    "Rows do not sum: turning one thing off also changes the overdraw and state changes of everything left.",
    `Browsers quantise GPU timings; differences under ±${GPU_SWEEP_NOISE_FLOOR_MS.toFixed(1)} ms are treated as noise.`,
    "GPU time excludes the wait for vsync/present, so it need not equal the CPU frame time.",
  ];
  if (sweep.rows.some((row) => row.unstable)) {
    notes.push(
      "An `uncertain` row's own baseline pair moved as far as the saving it claims — that row is the measurement's noise, not a finding.",
    );
  }
  if (sweep.baselineDrifted) {
    notes.push(
      `The baselines moved ${sweep.baselineDriftMs.toFixed(2)} ms across the run ` +
        `(${((sweep.baselineDriftMs / sweep.baselineMs) * 100).toFixed(0)}% of the baseline): ` +
        "the GPU most likely changed power state. Bracketing rescues the rows, but the " +
        "`without ms` column is not comparable between the top and the bottom of the table.",
    );
  }
  if (sweep.disjointEvents > 0) {
    notes.push(
      `The GPU timer was invalidated ${sweep.disjointEvents} time(s) (a power-state change); those measurements were discarded and repeated.`,
    );
  }
  return notes;
}

export function gpuSweepTableView(sweep: GpuSweep): DebugTableView {
  return withClipboardText({
    title: "GPU cost (sweep)",
    meta: sweepMeta(sweep),
    columns: [
      { label: "content", align: "left" },
      { label: "without ms", align: "right" },
      { label: "saving ms", align: "right" },
      { label: "%", align: "right" },
      { label: "samples", align: "right" },
    ],
    rows: sweep.rows.map((row) => ({
      cells: [
        row.label,
        row.withoutMs.toFixed(2),
        savingCell(row),
        shareCell(row),
        String(row.samples),
      ],
      share: row.unstable ? 0 : Math.max(0, row.share),
      kind: rowKind(row),
    })),
    notes: sweepNotes(sweep),
  });
}

export function formatGpuSweepText(sweep: GpuSweep): string {
  const lines = [
    `GPU sweep · ${sweepMeta(sweep)}`,
    "",
    `${"content".padEnd(22)}${"without".padStart(10)}${"saving".padStart(11)}${"%".padStart(8)}${"samples".padStart(9)}`,
  ];
  for (const row of sweep.rows) {
    lines.push(
      row.label.padEnd(22) +
        row.withoutMs.toFixed(2).padStart(10) +
        savingCell(row).padStart(11) +
        shareCell(row).padStart(8) +
        String(row.samples).padStart(9),
    );
  }
  lines.push(
    "",
    "Rows are savings and do not sum — turning one thing off changes what the rest cost.",
  );
  if (sweep.rows.some((row) => row.unstable)) {
    lines.push("An `uncertain` row's baseline pair moved as far as its saving; it is not a finding.");
  }
  if (sweep.baselineDrifted) {
    lines.push(
      `The baseline moved ${sweep.baselineDriftMs.toFixed(2)} ms across the run; the GPU may have changed power state.`,
    );
  }
  if (sweep.disjointEvents > 0) {
    lines.push(`The timer was invalidated ${sweep.disjointEvents} time(s); those measurements were repeated.`);
  }
  return lines.join("\n");
}

/**
 * The modal shown when the sweep cannot run at all — a browser without timer
 * queries, or a GPU that kept invalidating them.
 *
 * An empty table of zeros would read as "nothing costs anything", which is worse
 * than saying nothing: it is a wrong answer wearing the clothes of a right one.
 */
export function gpuSweepUnavailableView(reason: string): DebugTableView {
  return withClipboardText({
    title: "GPU cost (sweep)",
    meta: reason,
    columns: [{ label: "status", align: "left" }],
    rows: [{ cells: [reason], share: 0, kind: "note" }],
    notes: [
      "GPU timing needs EXT_disjoint_timer_query_webgl2: present on desktop Chrome/Edge, variable in Firefox, absent in Safari.",
      "The CPU side does not depend on it — the frame-cost capture works in every browser.",
    ],
  });
}
