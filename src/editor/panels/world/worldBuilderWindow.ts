/** Smallest window, in CSS pixels; the resize handle stops here. */
const MIN_WIDTH = 380;
const MIN_HEIGHT = 320;
/** First-open size; it sits at the top right of the owner's `area`. */
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 640;
const DEFAULT_MARGIN = 12;

export interface ForgeWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One entry of the window's tab strip; the owner draws the active tab's body. */
export interface ForgeWindowTab {
  id: string;
  label: string;
  disabled?: boolean;
  /** Tooltip, e.g. why the tab is disabled. */
  title?: string;
  /** A small count beside the label; null or undefined hides it. */
  badge?: number | null;
}

export interface ForgeWindowOptions {
  /** The element the window lives in and is clamped to (the editor root). */
  host: HTMLElement;
  /**
   * The region the window opens in (the viewport), in client coordinates.
   * Its top is also the highest the window may go, so the toolbar above it
   * (which shares the window's layer and changes height) stays usable.
   */
  area: () => DOMRect;
  title: string;
  /** Browser storage key for the viewer's position and size; never in project data. */
  storageKey: string;
  testId?: string;
  onClose?: () => void;
}

/**
 * A non-modal editor window: a title bar that drags it, a close button, a
 * resize handle at the bottom right, an optional tab strip and a body the
 * owner fills (the strip and title stay put while the body scrolls). The viewport
 * and the other panels stay usable behind it, and Escape is left to them.
 * Position and size are a per-viewer convenience kept in `localStorage`;
 * the window is always clamped inside its host so the title bar stays
 * reachable, again when the browser window shrinks.
 */
export class ForgeWindow {
  readonly element: HTMLElement;
  /** Owner content beside the title (e.g. an id and an "unsaved" mark). */
  readonly titleExtra: HTMLElement;
  readonly body: HTMLElement;
  /** A tab button was pressed (not called for a disabled one or the active one). */
  onTabSelect: ((id: string) => void) | null = null;
  private readonly tabStrip: HTMLElement;
  private geometry: ForgeWindowGeometry | null;
  private activeTab: string | null = null;

  constructor(private readonly options: ForgeWindowOptions) {
    this.geometry = readGeometry(options.storageKey);
    const element = document.createElement("section");
    element.className = "forge-window";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "false");
    element.setAttribute("aria-label", options.title);
    if (options.testId) element.dataset.testid = options.testId;
    element.hidden = true;
    element.innerHTML = `
      <header class="forge-window-titlebar" data-forge-window-titlebar>
        <span class="forge-window-title">${escapeHtml(options.title)}</span>
        <span class="forge-window-title-extra" data-forge-window-title-extra></span>
        <button type="button" class="forge-window-close" data-forge-window-close aria-label="Close ${escapeHtml(options.title)}" title="Kapat">×</button>
      </header>
      <div class="forge-window-tabs" data-forge-window-tabs role="tablist" hidden></div>
      <div class="forge-window-body" data-forge-window-body></div>
      <div class="forge-window-resize" data-forge-window-resize aria-hidden="true"></div>`;
    this.element = element;
    this.titleExtra = element.querySelector<HTMLElement>("[data-forge-window-title-extra]")!;
    this.body = element.querySelector<HTMLElement>("[data-forge-window-body]")!;
    this.tabStrip = element.querySelector<HTMLElement>("[data-forge-window-tabs]")!;
    this.tabStrip.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-forge-window-tab]");
      const id = button?.dataset.forgeWindowTab;
      if (!button || button.disabled || !id || id === this.activeTab) return;
      writeStored(this.options.storageKey, { tab: id });
      this.onTabSelect?.(id);
    });
    element.querySelector("[data-forge-window-close]")!.addEventListener("click", () => this.close());
    this.bindDrag(element.querySelector<HTMLElement>("[data-forge-window-titlebar]")!, "move");
    this.bindDrag(element.querySelector<HTMLElement>("[data-forge-window-resize]")!, "resize");
    window.addEventListener("resize", this.onHostResize);
    options.host.append(element);
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Shows the window, or keeps it open where it is. */
  open(): void {
    this.element.hidden = false;
    this.apply(this.geometry ?? this.defaultGeometry());
  }

  close(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.options.onClose?.();
  }

  /** The last tab this viewer picked (browser storage), or null. */
  storedTab(): string | null {
    const tab = readStored(this.options.storageKey)?.tab;
    return typeof tab === "string" ? tab : null;
  }

  /** Redraws the tab strip with `active` marked; the owner fills the body. A new active tab scrolls the body to the top. */
  setTabs(tabs: readonly ForgeWindowTab[], active: string): void {
    const prefix = this.options.testId ? `${this.options.testId}-tab-` : null;
    this.tabStrip.hidden = tabs.length === 0;
    this.tabStrip.innerHTML = tabs.map((tab) => {
      const selected = tab.id === active;
      const testId = prefix ? ` data-testid="${escapeHtml(prefix + tab.id)}"` : "";
      const badge = tab.badge === null || tab.badge === undefined
        ? ""
        : `<span class="forge-window-tab-badge"${prefix ? ` data-testid="${escapeHtml(`${prefix}${tab.id}-badge`)}"` : ""}>${tab.badge}</span>`;
      return `<button type="button" class="inspector-tab forge-window-tab${selected ? " active" : ""}" role="tab" aria-selected="${selected}" data-forge-window-tab="${escapeHtml(tab.id)}"${testId}${tab.disabled ? " disabled" : ""}${tab.title ? ` title="${escapeHtml(tab.title)}"` : ""}>${escapeHtml(tab.label)}${badge}</button>`;
    }).join("");
    if (this.activeTab !== null && this.activeTab !== active) this.body.scrollTop = 0;
    this.activeTab = active;
  }

  dispose(): void {
    window.removeEventListener("resize", this.onHostResize);
    this.element.remove();
  }

  /** Host-relative limits: the full host width, from the area's top to the host's bottom. */
  private bounds(): { width: number; top: number; bottom: number } {
    const host = this.options.host.getBoundingClientRect();
    const top = Math.max(0, this.options.area().top - host.top);
    return { width: host.width, top, bottom: host.height };
  }

  private defaultGeometry(): ForgeWindowGeometry {
    const host = this.options.host.getBoundingClientRect();
    const area = this.options.area();
    return {
      x: area.right - host.left - DEFAULT_WIDTH - DEFAULT_MARGIN,
      y: area.top - host.top + DEFAULT_MARGIN,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    };
  }

  /** Never smaller than the minimum (unless the host is), never larger than the bounds, wholly inside them. */
  private clamp(geometry: ForgeWindowGeometry): ForgeWindowGeometry {
    const { width: hostWidth, top, bottom } = this.bounds();
    const room = Math.max(0, bottom - top);
    const width = Math.max(Math.min(MIN_WIDTH, hostWidth), Math.min(geometry.width, hostWidth));
    const height = Math.max(Math.min(MIN_HEIGHT, room), Math.min(geometry.height, room));
    return {
      x: Math.round(Math.min(Math.max(geometry.x, 0), Math.max(0, hostWidth - width))),
      y: Math.round(Math.min(Math.max(geometry.y, top), Math.max(top, bottom - height))),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  private apply(geometry: ForgeWindowGeometry): void {
    const clamped = this.clamp(geometry);
    const style = this.element.style;
    style.left = `${clamped.x}px`;
    style.top = `${clamped.y}px`;
    style.width = `${clamped.width}px`;
    style.height = `${clamped.height}px`;
    this.geometry = clamped;
  }

  private onHostResize = (): void => {
    if (this.isOpen && this.geometry) this.apply(this.geometry);
  };

  /** Resizing grows toward the bottom right and stops at the bounds, so the top-left corner stays put. */
  private resized(start: ForgeWindowGeometry, dx: number, dy: number): ForgeWindowGeometry {
    const { width, bottom } = this.bounds();
    return {
      ...start,
      width: Math.min(Math.max(MIN_WIDTH, start.width + dx), Math.max(MIN_WIDTH, width - start.x)),
      height: Math.min(Math.max(MIN_HEIGHT, start.height + dy), Math.max(MIN_HEIGHT, bottom - start.y)),
    };
  }

  private bindDrag(handle: HTMLElement, mode: "move" | "resize"): void {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      const start = this.geometry ?? this.defaultGeometry();
      const startX = event.clientX;
      const startY = event.clientY;
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        this.apply(mode === "move"
          ? { ...start, x: start.x + dx, y: start.y + dy }
          : this.resized(start, dx, dy));
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        if (this.geometry) writeStored(this.options.storageKey, { ...this.geometry });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }
}

/** The viewer's stored geometry and last tab; null when absent, unreadable or storage is blocked. */
function readStored(key: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function readGeometry(key: string): ForgeWindowGeometry | null {
  const stored = readStored(key);
  if (!stored) return null;
  const { x, y, width, height } = stored;
  const finite = (entry: unknown): entry is number => typeof entry === "number" && Number.isFinite(entry);
  return finite(x) && finite(y) && finite(width) && finite(height) ? { x, y, width, height } : null;
}

/** Merges `fields` into the stored record, so the geometry and the last tab keep each other. */
function writeStored(key: string, fields: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...readStored(key), ...fields }));
  } catch {
    // Storage may be unavailable (private window); the window then remembers nothing past this session.
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
