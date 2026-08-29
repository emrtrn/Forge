/**
 * The shape a diagnostic table hands to the `?debug` table modal.
 *
 * Two very different measurements share that modal — the CPU frame breakdown
 * and the GPU sweep — and they deliberately do **not** share a row shape. The
 * CPU table's rows add up to the frame; the GPU table's rows are differences
 * between whole frames and add up to nothing at all. Keeping the modal a dumb
 * renderer of already-formatted cells is what stops one table quietly
 * inheriting the other's arithmetic, and what keeps both sets of numbers
 * testable without a DOM.
 *
 * Everything here is a string by the time it arrives. Rounding, units, column
 * alignment and the wording of the caveats are decisions the table that made
 * the measurement is qualified to make; the renderer is not.
 */

export interface DebugTableColumn {
  readonly label: string;
  /** Numbers read right-aligned; names read left. */
  readonly align: "left" | "right";
}

export interface DebugTableRow {
  /** One already-formatted string per column. */
  readonly cells: readonly string[];
  /**
   * 0–1, drawn as a bar behind the row so the expensive one is found before any
   * number has been read. Clamped by the renderer.
   */
  readonly share: number;
  /**
   * Styling hook, not semantics the renderer acts on: `region`, `residual`,
   * `debug`, `baseline`, `note`. A table names its own kinds.
   */
  readonly kind: string;
}

export interface DebugTableView {
  readonly title: string;
  /** One line under the title: what was measured, and under what conditions. */
  readonly meta: string;
  readonly columns: readonly DebugTableColumn[];
  readonly rows: readonly DebugTableRow[];
  /**
   * How to read the table without drawing the wrong conclusion from it — the
   * limits of the measurement, in the table rather than in someone's memory.
   */
  readonly notes: readonly string[];
  /** The same content as text, for the clipboard. */
  readonly clipboardText: string;
}

/**
 * Renders a view as plain text: the title, the meta line, an aligned grid and
 * the notes. Used for the clipboard, and it is the reason a table can be
 * checked in a headless test — the text is the table.
 */
export function debugTableToText(
  view: Omit<DebugTableView, "clipboardText">,
): string {
  const widths = view.columns.map((column, index) =>
    Math.max(column.label.length, ...view.rows.map((row) => (row.cells[index] ?? "").length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => {
        const width = widths[index] ?? cell.length;
        return view.columns[index]?.align === "right" ? cell.padStart(width) : cell.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  return [
    view.title,
    view.meta,
    "",
    line(view.columns.map((column) => column.label)),
    ...view.rows.map((row) => line(row.cells)),
    ...(view.notes.length > 0 ? ["", ...view.notes.map((note) => `- ${note}`)] : []),
  ].join("\n");
}

/** Attaches the text rendering, so a table is built in one expression. */
export function withClipboardText(view: Omit<DebugTableView, "clipboardText">): DebugTableView {
  return { ...view, clipboardText: debugTableToText(view) };
}
