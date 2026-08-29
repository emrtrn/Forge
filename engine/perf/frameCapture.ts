/**
 * One captured frame, decomposed into what each region cost — pure and
 * DOM-free, so the arithmetic that makes the table trustworthy is unit-tested
 * rather than eyeballed in a modal.
 *
 * Two rules give the table its credibility, and both live here:
 *
 *  1. **Every millisecond is accounted for.** Measured regions never sum to the
 *     whole frame; there is always glue between them. A table whose parts cover
 *     60% of the frame while saying nothing about the other 40% sends a reader
 *     off to optimise the wrong thing with complete confidence. So the leftovers
 *     are rows too — `<group> (other)` per group, `unmeasured` for the frame.
 *  2. **The captured frame is shown next to its window.** A single frame is
 *     noise: a GC pause, a shader compile, a cadence tick that only fires every
 *     few seconds. Every row carries the rolling average and the window peak
 *     beside the captured value, so "was this frame typical?" is answered in the
 *     table instead of guessed at.
 *
 * The row shape here is deliberately **not** the one {@link buildFrameRegionRows}
 * produces. That one is a tree read live, where a group keeps its own row and
 * its children are indented under it. This one is a flat ranking of one frame,
 * where a decomposed group is *replaced* by its children plus a leftover, so the
 * rows sort by cost and still sum to the frame. Sharing a row shape between them
 * would mean one table quietly inheriting the other's arithmetic.
 */
import { withClipboardText, type DebugTableView } from "./debugTableView";
import type { FrameProfileCapture, FrameRegionSample } from "../core/subsystemProfiler";
import { UNMEASURED_REGION_ID } from "./frameRegions";

/** What the frame was captured *in* — the context a number needs to be read. */
export interface FrameCaptureContext {
  /** Scene seconds at capture, so a capture can be placed in the session. */
  readonly sceneSeconds: number;
  /** Simulation time multiplier in force (F4); 1 while nothing scales time. */
  readonly timeScale?: number;
  /** Whether the scene was held still while the frame was measured (F4). */
  readonly paused?: boolean;
}

export type FrameCaptureRowKind =
  /** A measured region with nothing measured inside it. */
  | "region"
  /** The part of a group (or of the frame) that no region accounted for. */
  | "residual"
  /** Diagnostic-route-only work the shipped build never pays for. */
  | "debug";

export interface FrameCaptureRow {
  readonly label: string;
  /** The group this row belongs to, or null when it is the frame's own. */
  readonly group: string | null;
  /** Cost in the captured frame; null where the region did not run at all. */
  readonly frameMs: number | null;
  readonly averageMs: number;
  /** Window peak, or 0 for a residual — see the note in {@link buildFrameCapture}. */
  readonly maxMs: number;
  /** Fraction of the captured frame, 0–1. */
  readonly share: number;
  readonly kind: FrameCaptureRowKind;
}

export interface FrameCapture {
  /** The captured frame's total, or null when nothing measured the frame. */
  readonly totalMs: number | null;
  readonly averageTotalMs: number;
  readonly maxTotalMs: number;
  readonly windowFrames: number;
  readonly sceneSeconds: number;
  readonly timeScale: number;
  readonly paused: boolean;
  /** Every row, most expensive in the captured frame first. */
  readonly rows: readonly FrameCaptureRow[];
}

/** Sub-microsecond leftovers are timer noise, not a finding. */
const RESIDUAL_EPSILON_MS = 0.001;

/**
 * Decomposes one captured frame into rows that sum to it.
 *
 * A region that did not run keeps a `null` frame cost and contributes nothing to
 * the sums — which is correct, and different from a zero: the row still shows
 * what the region averages, so a reader can see that the thing they expected to
 * be expensive simply did not happen in this frame.
 */
export function buildFrameCapture(
  capture: FrameProfileCapture,
  context: FrameCaptureContext,
): FrameCapture {
  const measured = new Set(capture.regions.map((region) => region.id));
  const children = new Map<string, FrameRegionSample[]>();
  for (const region of capture.regions) {
    // A parent nothing measured cannot be a group, so its declared children are
    // top-level here: an unmeasured group is a gap in the account, not a place
    // to file rows under.
    if (!region.parent || !measured.has(region.parent)) continue;
    const siblings = children.get(region.parent);
    if (siblings) siblings.push(region);
    else children.set(region.parent, [region]);
  }

  const totalMs = capture.totalMs ?? 0;
  const share = (ms: number): number => (totalMs > 0 ? ms / totalMs : 0);
  const rows: FrameCaptureRow[] = [];
  let topLevelMs = 0;
  let topLevelAverageMs = 0;

  for (const region of capture.regions) {
    const isTopLevel = !region.parent || !measured.has(region.parent);
    if (isTopLevel) {
      topLevelMs += region.frameMs ?? 0;
      topLevelAverageMs += region.averageMs;
    }
    const nested = children.get(region.id);
    if (nested) {
      // A decomposed group is not a row of its own — its children are the rows,
      // and whatever they leave over becomes one below. Listing both would
      // double-count the group and quietly break every percentage in the table.
      const nestedFrameMs = sum(nested, (child) => child.frameMs ?? 0);
      const leftover = (region.frameMs ?? 0) - nestedFrameMs;
      if (leftover > RESIDUAL_EPSILON_MS) {
        rows.push({
          label: `${region.id} (other)`,
          group: region.id,
          frameMs: leftover,
          averageMs: Math.max(0, region.averageMs - sum(nested, (child) => child.averageMs)),
          // Deliberately not a peak: the group's worst frame and its children's
          // worst frames are different frames, so subtracting them means nothing.
          maxMs: 0,
          share: share(leftover),
          kind: "residual",
        });
      }
      continue;
    }
    rows.push({
      label: region.id,
      group: region.parent && measured.has(region.parent) ? region.parent : null,
      frameMs: region.frameMs,
      averageMs: region.averageMs,
      maxMs: region.maxMs,
      share: share(region.frameMs ?? 0),
      kind: region.debugOnly ? "debug" : "region",
    });
  }

  const unmeasured = totalMs - topLevelMs;
  if (unmeasured > RESIDUAL_EPSILON_MS) {
    rows.push({
      label: UNMEASURED_REGION_ID,
      group: null,
      frameMs: unmeasured,
      averageMs: Math.max(0, capture.averageTotalMs - topLevelAverageMs),
      maxMs: 0,
      share: share(unmeasured),
      kind: "residual",
    });
  }

  // Most expensive in *this* frame first — that is the question the capture was
  // taken to answer. Ties fall back to the label so the order is deterministic.
  rows.sort((a, b) => (b.frameMs ?? 0) - (a.frameMs ?? 0) || a.label.localeCompare(b.label));
  return {
    totalMs: capture.totalMs,
    averageTotalMs: capture.averageTotalMs,
    maxTotalMs: capture.maxTotalMs,
    windowFrames: capture.windowFrames,
    sceneSeconds: context.sceneSeconds,
    timeScale: context.timeScale ?? 1,
    paused: context.paused ?? false,
    rows,
  };
}

/** The context line: what was measured, and under what conditions. */
function captureMeta(capture: FrameCapture): string {
  const total =
    capture.totalMs === null
      ? "frame not measured"
      : `${capture.totalMs.toFixed(2)} ms total · avg ${capture.averageTotalMs.toFixed(2)} · ` +
        `peak ${capture.maxTotalMs.toFixed(2)} (last ${capture.windowFrames} frames)`;
  const time =
    capture.timeScale === 1 && !capture.paused
      ? ""
      : ` · ${capture.paused ? "paused" : `${capture.timeScale}x`}`;
  return `${total}${time} · scene ${capture.sceneSeconds.toFixed(1)} s`;
}

/** The capture as the modal renders it: formatted cells, nothing computed. */
export function frameCaptureTableView(capture: FrameCapture): DebugTableView {
  const notes = [
    "Rows divide this one frame; their total is the frame.",
    "`avg` and `peak` are the rolling window, not this frame — read them beside the ms column to tell a typical frame from a one-off.",
    "`render` is the CPU cost of submitting the frame, not the GPU's cost of drawing it — that needs the GPU sweep.",
  ];
  if (capture.rows.some((row) => row.kind === "debug")) {
    notes.push("Rows marked * exist only on the diagnostic route; the shipped build does not pay for them.");
  }
  if (capture.rows.some((row) => row.frameMs === null)) {
    notes.push("A `—` in the ms column means the region did not run in this frame, which is not the same as costing nothing.");
  }
  if (capture.totalMs === null) {
    notes.unshift("Nothing measured the whole frame, so the shares have no denominator.");
  }
  return withClipboardText({
    title: "Frame cost (CPU)",
    meta: captureMeta(capture),
    columns: [
      { label: "region", align: "left" },
      { label: "group", align: "left" },
      { label: "ms", align: "right" },
      { label: "%", align: "right" },
      { label: "avg", align: "right" },
      { label: "peak", align: "right" },
    ],
    rows: capture.rows.map((row) => ({
      cells: [
        row.kind === "debug" ? `${row.label} *` : row.label,
        row.group ?? "—",
        row.frameMs === null ? "—" : row.frameMs.toFixed(2),
        capture.totalMs === null ? "—" : `${(row.share * 100).toFixed(1)}%`,
        row.averageMs.toFixed(2),
        // A leftover has no meaningful peak, and neither has a region that did
        // not run: a "0.00" there would read as "it never spiked".
        row.maxMs > 0 ? row.maxMs.toFixed(2) : "—",
      ],
      share: row.share,
      kind: row.kind,
    })),
    notes,
  });
}

/**
 * The capture as pasteable text.
 *
 * A capture that cannot leave the browser is a capture that gets described from
 * memory in the bug report instead.
 */
export function formatFrameCaptureText(capture: FrameCapture): string {
  const lines = [
    `frame cost · ${captureMeta(capture)}`,
    "",
    `${"region".padEnd(22)}${"ms".padStart(8)}${"%".padStart(7)}${"avg".padStart(9)}${"peak".padStart(9)}`,
  ];
  for (const row of capture.rows) {
    const label = row.kind === "debug" ? `${row.label} *` : row.label;
    lines.push(
      label.padEnd(22) +
        (row.frameMs === null ? "—" : row.frameMs.toFixed(2)).padStart(8) +
        (capture.totalMs === null ? "—" : `${(row.share * 100).toFixed(1)}%`).padStart(7) +
        row.averageMs.toFixed(2).padStart(9) +
        (row.maxMs > 0 ? row.maxMs.toFixed(2) : "—").padStart(9),
    );
  }
  if (capture.rows.some((row) => row.kind === "debug")) {
    lines.push("", "* diagnostic route only; the shipped build does not pay for it.");
  }
  return lines.join("\n");
}

function sum<T>(items: readonly T[], read: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += read(item);
  return total;
}
