/**
 * A centred, closable table over the running scene — the surface both the CPU
 * frame account and (later) the GPU sweep are shown in.
 *
 * It renders a **frozen** view and never updates while open, and that is not a
 * shortcut. A live table is measured while it is being read, so every row moves
 * under the reader; and once a diagnostic pause exists (F4) a live table would
 * read every simulation row as zero the instant it appeared. The measurement
 * happens once; the modal shows what was measured.
 *
 * It is a dumb renderer of already-formatted cells. Every number, unit and
 * caveat arrives in the {@link DebugTableView} from whichever table made the
 * measurement — which is what keeps two tables with incompatible arithmetic
 * (rows that sum to a frame, rows that are differences between frames) from
 * inheriting each other's meaning by sharing a renderer.
 */
import type { DebugTableView } from "@engine/perf/debugTableView";

export interface DebugTableModalOptions {
  /** Called when the reader closes it — the host decides what to resume. */
  readonly onClose?: () => void;
  /** Where to mount; defaults to `#ui-overlay`, else `<body>`. */
  readonly host?: HTMLElement;
}

export class DebugTableModal {
  private readonly root = document.createElement("section");
  private readonly heading = document.createElement("h2");
  private readonly meta = document.createElement("p");
  private readonly head = document.createElement("thead");
  private readonly body = document.createElement("tbody");
  private readonly notes = document.createElement("div");
  private readonly copyButton = document.createElement("button");
  private view: DebugTableView | null = null;
  private copyResetHandle = 0;

  constructor(private readonly options: DebugTableModalOptions = {}) {
    this.root.className = "forge-debug-table ui-interactive";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.hidden = true;

    const header = document.createElement("header");
    header.className = "forge-debug-table-header";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "forge-debug-table-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.dataset.forgeDebugAction = "close-table";
    close.addEventListener("click", () => this.close());
    header.append(this.heading, close);

    this.meta.className = "forge-debug-table-meta";
    this.notes.className = "forge-debug-table-notes";

    const table = document.createElement("table");
    table.className = "forge-debug-table-grid";
    table.append(this.head, this.body);
    const scroll = document.createElement("div");
    scroll.className = "forge-debug-table-scroll";
    scroll.appendChild(table);

    const footer = document.createElement("footer");
    footer.className = "forge-debug-table-footer";
    this.copyButton.type = "button";
    this.copyButton.className = "forge-debug-table-copy";
    this.copyButton.dataset.forgeDebugAction = "copy-table";
    this.copyButton.addEventListener("click", () => void this.copyToClipboard());
    footer.append(this.notes, this.copyButton);

    this.root.append(header, this.meta, scroll, footer);
    const host = options.host ?? document.getElementById("ui-overlay") ?? document.body;
    host.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** The mounted element — for the host to reparent (the editor moves overlays). */
  get element(): HTMLElement {
    return this.root;
  }

  show(view: DebugTableView): void {
    this.view = view;
    this.root.setAttribute("aria-label", view.title);
    this.root.dataset.forgeDebugTable = view.title;
    this.heading.textContent = view.title;
    this.meta.textContent = view.meta;

    const headRow = document.createElement("tr");
    for (const column of view.columns) {
      const cell = document.createElement("th");
      cell.setAttribute("scope", "col");
      cell.dataset.align = column.align;
      cell.textContent = column.label;
      headRow.appendChild(cell);
    }
    this.head.replaceChildren(headRow);

    this.body.replaceChildren(
      ...view.rows.map((row) => {
        const tr = document.createElement("tr");
        tr.dataset.forgeTableKind = row.kind;
        for (const [index, text] of row.cells.entries()) {
          const cell = document.createElement(index === 0 ? "th" : "td");
          if (index === 0) cell.setAttribute("scope", "row");
          cell.dataset.align = view.columns[index]?.align ?? "right";
          cell.textContent = text;
          tr.appendChild(cell);
        }
        // A bar behind the row: the expensive one is found before any number has
        // been read. Painted as a background gradient, so it costs no element.
        const share = Math.max(0, Math.min(1, Number.isFinite(row.share) ? row.share : 0));
        tr.style.setProperty("--forge-table-share", `${(share * 100).toFixed(2)}%`);
        return tr;
      }),
    );

    this.notes.replaceChildren(
      ...view.notes.map((note) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = note;
        return paragraph;
      }),
    );

    this.resetCopyLabel();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.view = null;
  }

  dispose(): void {
    if (this.copyResetHandle) clearTimeout(this.copyResetHandle);
    this.root.remove();
  }

  private close(): void {
    this.hide();
    this.options.onClose?.();
  }

  private async copyToClipboard(): Promise<void> {
    const view = this.view;
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.clipboardText);
      this.flashCopyLabel("Copied");
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // The measurement is still worth having, so it goes to the console rather
      // than being lost with a shrug.
      this.flashCopyLabel("Copy blocked — written to console");
      console.info(view.clipboardText);
    }
  }

  private flashCopyLabel(text: string): void {
    this.copyButton.textContent = text;
    if (this.copyResetHandle) clearTimeout(this.copyResetHandle);
    this.copyResetHandle = window.setTimeout(() => this.resetCopyLabel(), 2000);
  }

  private resetCopyLabel(): void {
    if (this.copyResetHandle) clearTimeout(this.copyResetHandle);
    this.copyResetHandle = 0;
    this.copyButton.textContent = "Copy to clipboard";
  }
}
