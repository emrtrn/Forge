/**
 * Frame regions: the record of how a frame's measured costs nest, and the
 * arithmetic that turns a flat pile of timings into an account of the frame.
 *
 * Side-effect free — no DOM, no three.js, no clock. It reasons over an already
 * collected {@link SubsystemProfileSnapshot} and the parent links recorded with
 * it, so every rule below is unit-testable without a browser.
 *
 * Two principles decide everything here, and both were learned the hard way:
 *
 *  1. **Every millisecond is accounted for.** Measured regions never add up to
 *     the frame. What is left over gets a row of its own — `<group> (other)`
 *     inside a group, `unmeasured` for the frame — because a table that explains
 *     60% of a frame and says nothing about the other 40% sends a reader off to
 *     optimise the wrong thing with complete confidence.
 *  2. **The frame is the denominator, never a row.** It is not a cost beside the
 *     others; it is the thing they are shares of. Listing it would double every
 *     total and invite exactly the sum nobody should compute.
 *
 * The registry is *data*: the engine records that its subsystems sit under
 * `engine`, the shell records its own regions, and a fork adds its own. Nothing
 * here names a game concept, and there is no fixed table of region ids.
 */
import type { SubsystemProfileSnapshot, SubsystemTiming } from "../core/subsystemProfiler";
import { withClipboardText, type DebugTableView } from "./debugTableView";

/**
 * The whole frame. Reserved: it is the denominator, so it must never be
 * declared as a region, and {@link buildFrameRegionRows} never emits it as a row.
 */
export const FRAME_REGION_ID = "frame";

/** The residual row id for the part of the frame nothing measured. */
export const UNMEASURED_REGION_ID = "unmeasured";

/** One declared region of the frame. */
export interface FrameRegionDefinition {
  readonly id: string;
  /**
   * The region this one nests inside. `null` / omitted means a top-level region
   * of the frame — the level whose costs sum toward the frame itself.
   */
  readonly parent?: string | null;
  /**
   * Cost only the diagnostic route pays. Marked rather than hidden: the game
   * build does not pay for it, and a reader comparing a `?debug` frame against a
   * shipped one has to be able to see which rows are not in the shipped total.
   * Inherited by descendants.
   */
  readonly debugOnly?: boolean;
}

/**
 * Who nests inside whom. Held apart from the timings on purpose: a region is
 * declared once, timings arrive every frame, and mixing the two would mean
 * re-stating the shape of the frame sixty times a second.
 */
export class FrameRegionRegistry {
  private readonly definitions = new Map<string, FrameRegionDefinition>();

  /**
   * Declares (or re-declares) a region. Idempotent — the last declaration wins,
   * so a module that re-registers on level reload does not accumulate copies.
   *
   * Declaring {@link FRAME_REGION_ID} throws: it is the denominator, and a
   * "frame" row inside the frame is the one mistake this whole module exists to
   * prevent.
   */
  declare(definition: FrameRegionDefinition): void {
    if (definition.id === FRAME_REGION_ID) {
      throw new Error(`"${FRAME_REGION_ID}" is the denominator and cannot be declared as a region`);
    }
    this.definitions.set(definition.id, definition);
  }

  /** The declared parent of `id`, or null for a top-level (or unknown) region. */
  parentOf(id: string): string | null {
    return this.definitions.get(id)?.parent ?? null;
  }

  /** Whether `id` — or any ancestor of it — is diagnostic-only cost. */
  isDebugOnly(id: string): boolean {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const definition = this.definitions.get(current);
      if (!definition) return false;
      if (definition.debugOnly) return true;
      current = definition.parent ?? null;
    }
    return false;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  /** Every declaration, in declaration order. */
  all(): readonly FrameRegionDefinition[] {
    return [...this.definitions.values()];
  }

  clear(): void {
    this.definitions.clear();
  }
}

/** One line of the frame account, already ordered and indented for display. */
export interface FrameRegionRow {
  readonly id: string;
  /** Nesting level: 0 for a top-level region, 1 for its children, and so on. */
  readonly depth: number;
  readonly averageMs: number;
  readonly lastMs: number;
  readonly maxMs: number;
  /** Share of the frame, 0–1; 0 when nothing measured the frame itself. */
  readonly shareOfFrame: number;
  /**
   * A leftover row rather than a measured one — `<group> (other)` or
   * `unmeasured`. Marked so a reader never mistakes it for something that was
   * timed, and so a table can style it apart.
   */
  readonly residual: boolean;
  /** Diagnostic-only cost the shipped build does not pay (see the definition). */
  readonly debugOnly: boolean;
}

/** Costs below this are noise in a millisecond readout; a residual row is dropped. */
const RESIDUAL_EPSILON_MS = 0.01;

/**
 * Turns a profile snapshot into the frame account: top-level regions worst
 * first, each group's children indented under it, a `(other)` row wherever a
 * group's own time exceeds the children it was measured around, and a final
 * `unmeasured` row for whatever the frame cost that nothing timed.
 *
 * A group's own timing is expected to *contain* its children's, because that is
 * how it is measured — a span wrapped around the block the children run in. So
 * the child rows are subtracted from it rather than added to it. Where the
 * subtraction goes negative (a child sampled in frames the parent was not, which
 * rolling windows allow) the residual is clamped to zero rather than printed as
 * a negative cost: the honest answer there is "nothing left over", not "-0.3 ms".
 *
 * Works on a snapshot with no parent links at all — every region is then
 * top-level, which is exactly the flat listing the overlay had before regions
 * existed.
 */
export function buildFrameRegionRows(snapshot: SubsystemProfileSnapshot): FrameRegionRow[] {
  const byId = new Map<string, SubsystemTiming>();
  const children = new Map<string, SubsystemTiming[]>();
  const roots: SubsystemTiming[] = [];
  for (const timing of snapshot.subsystems) {
    if (timing.id === FRAME_REGION_ID) continue;
    byId.set(timing.id, timing);
  }
  for (const timing of byId.values()) {
    const parent = timing.parent ?? null;
    // A parent that was never recorded cannot be a group, so its orphans are
    // top-level: an unmeasured group is a gap in the account, not a place to
    // hide rows.
    if (parent && byId.has(parent)) {
      const bucket = children.get(parent);
      if (bucket) bucket.push(timing);
      else children.set(parent, [timing]);
    } else {
      roots.push(timing);
    }
  }

  const frameAverageMs = snapshot.frame?.averageMs ?? 0;
  const share = (ms: number): number => (frameAverageMs > 0 ? ms / frameAverageMs : 0);
  const byCost = (a: SubsystemTiming, b: SubsystemTiming): number =>
    b.averageMs - a.averageMs || a.id.localeCompare(b.id);

  const rows: FrameRegionRow[] = [];
  const emit = (timing: SubsystemTiming, depth: number): void => {
    rows.push({
      id: timing.id,
      depth,
      averageMs: timing.averageMs,
      lastMs: timing.lastMs,
      maxMs: timing.maxMs,
      shareOfFrame: share(timing.averageMs),
      residual: false,
      debugOnly: timing.debugOnly ?? false,
    });
    const nested = children.get(timing.id);
    if (!nested || nested.length === 0) return;
    let childAverage = 0;
    let childLast = 0;
    for (const child of [...nested].sort(byCost)) {
      childAverage += child.averageMs;
      childLast += child.lastMs;
      emit(child, depth + 1);
    }
    const residualAverage = Math.max(0, timing.averageMs - childAverage);
    if (residualAverage < RESIDUAL_EPSILON_MS) return;
    rows.push({
      id: `${timing.id} (other)`,
      depth: depth + 1,
      averageMs: residualAverage,
      lastMs: Math.max(0, timing.lastMs - childLast),
      // A residual has no peak of its own — the group's peak and the children's
      // need not have happened in the same frame, so subtracting them would
      // invent a number. Reported as zero and never as the group's own peak.
      maxMs: 0,
      shareOfFrame: share(residualAverage),
      residual: true,
      debugOnly: timing.debugOnly ?? false,
    });
  };

  let rootAverage = 0;
  let rootLast = 0;
  for (const root of [...roots].sort(byCost)) {
    rootAverage += root.averageMs;
    rootLast += root.lastMs;
    emit(root, 0);
  }

  // The frame's own residual. Omitted entirely when nothing measured the frame:
  // without a denominator there is no "rest of the frame" to report, and a zero
  // row there would claim full coverage the snapshot cannot support.
  if (frameAverageMs > 0) {
    const unmeasured = Math.max(0, frameAverageMs - rootAverage);
    if (unmeasured >= RESIDUAL_EPSILON_MS) {
      rows.push({
        id: UNMEASURED_REGION_ID,
        depth: 0,
        averageMs: unmeasured,
        lastMs: Math.max(0, (snapshot.frame?.lastMs ?? 0) - rootLast),
        maxMs: 0,
        shareOfFrame: share(unmeasured),
        residual: true,
        debugOnly: false,
      });
    }
  }
  return rows;
}

/**
 * Renders the frame account as a table for the `?debug` modal.
 *
 * The same rows the overlay prints, with the two things a text overlay has no
 * room for: a share bar behind each row, and the notes that say what the table
 * does *not* prove. Kept beside the arithmetic rather than in the modal, because
 * the caveats belong to the measurement — the renderer only draws cells.
 */
export function frameRegionTableView(
  snapshot: SubsystemProfileSnapshot,
  meta = "",
): DebugTableView {
  const rows = buildFrameRegionRows(snapshot);
  const frame = snapshot.frame;
  const measured = snapshot.totalAverageMs;
  const diagnostic = snapshot.debugOnlyAverageMs ?? 0;
  const notes = [
    "Rows are windowed averages, not one frame: a single frame is noise (a GC, a shader compile, a rare cadence tick).",
    "A group's row already contains its children; only the top-level rows sum to the frame.",
    "`(other)` and `unmeasured` are leftovers, never something that was timed on its own.",
  ];
  if (frame) {
    notes.unshift(
      `Frame ${frame.averageMs.toFixed(2)} ms average over ${frame.samples} frames, peak ${frame.maxMs.toFixed(2)} ms.`,
    );
  } else {
    // Said rather than omitted: a table with no denominator cannot claim any
    // coverage at all, and silence there reads as full coverage.
    notes.unshift("Nothing measured the whole frame, so the rows have no denominator and no shares.");
  }
  if (diagnostic > 0) {
    notes.push(
      `${diagnostic.toFixed(2)} ms of this frame is diagnostic-only work (marked *) that the shipped build never runs.`,
    );
  }
  return withClipboardText({
    title: "Frame cost (CPU)",
    meta: frame
      ? `frame ${frame.averageMs.toFixed(2)} ms · measured ${(
          (measured / frame.averageMs) * 100
        ).toFixed(0)}%${meta ? ` · ${meta}` : ""}`
      : `regions ${measured.toFixed(2)} ms${meta ? ` · ${meta}` : ""}`,
    columns: [
      { label: "region", align: "left" },
      { label: "avg ms", align: "right" },
      { label: "last ms", align: "right" },
      { label: "peak ms", align: "right" },
      { label: "share", align: "right" },
    ],
    rows: rows.map((row) => ({
      kind: row.residual ? "residual" : row.debugOnly ? "debug" : "region",
      share: row.shareOfFrame,
      cells: [
        `${"  ".repeat(row.depth)}${row.id}${row.debugOnly ? " *" : ""}`,
        row.averageMs.toFixed(2),
        row.lastMs.toFixed(2),
        // A residual has no peak of its own; a dash says so rather than "0.00",
        // which would read as "it never spiked" instead of "not measurable here".
        row.residual ? "—" : row.maxMs.toFixed(2),
        frame ? `${Math.round(row.shareOfFrame * 100)}%` : "—",
      ],
    })),
    notes,
  });
}
