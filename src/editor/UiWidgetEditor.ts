/**
 * UI Widget editor (UMG Lite, dev-only).
 *
 * A modal authoring shell for `*.ui.json` assets, opened from the Content
 * Browser. Four regions mirror UMG's Widget Blueprint Designer:
 *   - **Palette** — add a child widget to the selected container.
 *   - **Hierarchy** — the widget tree; click to select, reorder/delete.
 *   - **Designer** — a live WYSIWYG preview rendered by the *runtime* renderer
 *     (`engine/ui/uiRenderer.ts`), so the editor shows exactly what plays.
 *   - **Details** — typed property fields for the selected node.
 *
 * No node graph (plan U4): behaviour is the typed `back`/`message` action edited
 * in Details. Save round-trips through `/__save-ui`, which re-normalizes server
 * side, so the editor can never write a malformed asset.
 */
import {
  createUiNode,
  findUiNode,
  findUiNodeParent,
  isUiBinding,
  isUiContainerKind,
  isUiTextKey,
  normalizeUiWidgetDef,
  readUiAction,
  UI_WIDGET_KINDS,
  type UiNode,
  type UiWidgetDef,
  type UiWidgetKind,
} from "@engine/ui/uiWidget";
import { renderUiWidget, type RenderedUiWidget } from "@engine/ui/uiRenderer";
import { BINDABLE_UI_PROPS } from "@engine/ui/uiBinding";
import { collectFocusables, type UiA11y } from "@engine/ui/uiA11y";
import { applyUiTheme, type UiThemeDef } from "@engine/ui/uiTheme";
import {
  normalizeUiTransition,
  transitionClasses,
  UI_TRANSITION_PRESETS,
  DEFAULT_TRANSITION_DURATION_MS,
} from "@engine/ui/uiTransition";
import { loadUiThemeAsset, loadUiWidgetAsset, saveUiWidgetAsset } from "@/editor/uiWidgetStore";

type StatusTone = "info" | "success" | "error";

export interface UiWidgetEditorOptions {
  path: string;
  label: string;
  onStatus?: (message: string, tone?: StatusTone) => void;
  onSaved?: () => void;
}

interface FieldDesc {
  key: string;
  label: string;
  kind: "text" | "number" | "select";
  options?: readonly string[];
}

const ALIGN_OPTIONS = ["", "start", "center", "end", "stretch", "between"] as const;

/** Editable property fields per widget kind (Details panel). */
function fieldsForWidget(kind: UiWidgetKind): FieldDesc[] {
  const layout: FieldDesc[] = [
    { key: "align", label: "Align", kind: "select", options: ALIGN_OPTIONS },
    { key: "justify", label: "Justify", kind: "select", options: ALIGN_OPTIONS },
    { key: "padding", label: "Padding", kind: "number" },
    { key: "background", label: "Background", kind: "text" },
    { key: "radius", label: "Corner Radius", kind: "number" },
  ];
  switch (kind) {
    case "Text":
      return [
        { key: "text", label: "Text", kind: "text" },
        { key: "fontSize", label: "Font Size", kind: "number" },
        { key: "fontWeight", label: "Font Weight", kind: "number" },
        { key: "color", label: "Color", kind: "text" },
      ];
    case "Image":
      return [
        { key: "src", label: "Image Path", kind: "text" },
        { key: "width", label: "Width", kind: "number" },
        { key: "height", label: "Height", kind: "number" },
      ];
    case "ProgressBar":
      return [
        { key: "value", label: "Value", kind: "number" },
        { key: "max", label: "Max", kind: "number" },
      ];
    case "Stack":
      return [
        { key: "direction", label: "Direction", kind: "select", options: ["column", "row"] },
        { key: "gap", label: "Gap", kind: "number" },
        ...layout,
      ];
    case "Button":
      // Button text + action are rendered specially (see renderDetails).
      return [{ key: "text", label: "Label", kind: "text" }];
    case "Include":
      return [{ key: "src", label: "Widget Asset ID", kind: "text" }];
    default:
      return layout; // Canvas / Panel
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class UiWidgetEditor {
  private static activeInstance: UiWidgetEditor | null = null;

  static async open(options: UiWidgetEditorOptions): Promise<UiWidgetEditor> {
    UiWidgetEditor.activeInstance?.close();
    const editor = new UiWidgetEditor(options);
    UiWidgetEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly paletteHost: HTMLElement;
  private readonly hierarchyHost: HTMLElement;
  private readonly stageHost: HTMLElement;
  private readonly stageInner: HTMLElement;
  private readonly detailsHost: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly resizeObserver: ResizeObserver;

  private def: UiWidgetDef;
  private selectedId: string;
  /** Resolved theme for the live preview (matches runtime $token rendering). */
  private theme: UiThemeDef | null = null;
  private rendered: RenderedUiWidget | null = null;
  private idCounter = 0;
  private dirty = false;
  private disposed = false;

  private constructor(private readonly options: UiWidgetEditorOptions) {
    this.def = normalizeUiWidgetDef({ name: options.label }, options.label);
    this.selectedId = this.def.root.id;
    this.overlay = document.createElement("div");
    this.overlay.className = "uie-overlay";
    this.overlay.innerHTML = `
      <div class="uie-window">
        <header class="uie-header">
          <span class="uie-tab">
            <span class="uie-tab-icon">UI</span>
            <strong data-uie-title></strong>
            <span class="uie-badge">UI Widget</span>
          </span>
          <div class="uie-header-actions">
            <button type="button" class="uie-save" data-uie-save title="Save (Ctrl+S)">Save</button>
            <button type="button" class="uie-close" data-uie-close title="Close (Esc)">x</button>
          </div>
        </header>
        <div class="uie-body">
          <aside class="uie-left">
            <div class="uie-section-title">Palette</div>
            <div class="uie-palette" data-uie-palette></div>
            <div class="uie-section-title">Hierarchy</div>
            <div class="uie-hierarchy" data-uie-hierarchy></div>
          </aside>
          <main class="uie-stage" data-uie-stage>
            <div class="uie-stage-inner" data-uie-stage-inner></div>
          </main>
          <aside class="uie-details" data-uie-details></aside>
        </div>
        <footer class="uie-status" data-uie-status>Loading...</footer>
      </div>
    `;
    document.body.append(this.overlay);

    this.titleEl = this.requireEl("[data-uie-title]");
    this.paletteHost = this.requireEl("[data-uie-palette]");
    this.hierarchyHost = this.requireEl("[data-uie-hierarchy]");
    this.stageHost = this.requireEl("[data-uie-stage]");
    this.stageInner = this.requireEl("[data-uie-stage-inner]");
    this.detailsHost = this.requireEl("[data-uie-details]");
    this.statusEl = this.requireEl("[data-uie-status]");

    this.requireEl<HTMLButtonElement>("[data-uie-close]").addEventListener("click", () =>
      this.close(),
    );
    this.requireEl<HTMLButtonElement>("[data-uie-save]").addEventListener("click", () =>
      void this.save(),
    );
    this.stageHost.addEventListener("click", (event) => this.onStageClick(event));

    this.overlay.tabIndex = -1;
    this.overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void this.save();
      }
    });
    this.overlay.focus();

    this.resizeObserver = new ResizeObserver(() => this.fitStage());
    this.resizeObserver.observe(this.stageHost);

    this.renderPalette();
  }

  private requireEl<T extends HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`UiWidgetEditor missing element: ${selector}`);
    return el;
  }

  private async load(): Promise<void> {
    try {
      this.def = await loadUiWidgetAsset(this.options.path, this.options.label);
      this.theme = this.def.theme ? await loadUiThemeAsset(this.def.theme) : null;
      this.selectedId = this.def.root.id;
      this.dirty = false;
      this.renderAll();
      this.setStatus("Ready.");
    } catch (error) {
      this.renderAll();
      this.setStatus(`Failed to load: ${describeError(error)}`, "error");
    }
  }

  private renderAll(): void {
    if (this.disposed) return;
    this.titleEl.textContent = this.def.name;
    this.renderHierarchy();
    this.renderPreview();
    this.renderDetails();
  }

  // --- Palette -------------------------------------------------------------

  private renderPalette(): void {
    this.paletteHost.replaceChildren();
    for (const kind of UI_WIDGET_KINDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "uie-palette-item";
      button.textContent = kind;
      button.title = isUiContainerKind(kind) ? `Add ${kind} (container)` : `Add ${kind}`;
      button.addEventListener("click", () => this.addWidget(kind));
      this.paletteHost.append(button);
    }
  }

  /** Adds a new widget under the selected container (or the selected node's parent). */
  private addWidget(kind: UiWidgetKind): void {
    const selected = findUiNode(this.def.root, this.selectedId) ?? this.def.root;
    const target = isUiContainerKind(selected.widget)
      ? selected
      : (findUiNodeParent(this.def.root, selected.id) ?? this.def.root);
    const node = createUiNode(kind, `${kind.toLowerCase()}-${++this.idCounter}`);
    target.children.push(node);
    this.selectedId = node.id;
    this.markDirty();
    this.renderAll();
  }

  // --- Hierarchy -----------------------------------------------------------

  private renderHierarchy(): void {
    this.hierarchyHost.replaceChildren();
    const walk = (node: UiNode, depth: number): void => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "uie-tree-row";
      row.classList.toggle("is-selected", node.id === this.selectedId);
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.innerHTML = `<span class="uie-tree-kind">${escapeHtml(node.widget)}</span><span class="uie-tree-id">${escapeHtml(node.id)}</span>`;
      row.addEventListener("click", () => {
        this.selectedId = node.id;
        this.renderHierarchy();
        this.renderDetails();
        this.highlightSelected();
      });
      this.hierarchyHost.append(row);
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(this.def.root, 0);
  }

  // --- Designer preview ----------------------------------------------------

  private renderPreview(): void {
    this.rendered?.dispose();
    // No onAction: in the editor a click selects the node, it does not navigate.
    this.rendered = renderUiWidget(this.def, {});
    // Apply the widget's referenced theme so $token props preview as they play.
    if (this.theme) applyUiTheme(this.rendered.element, this.theme);
    this.stageInner.replaceChildren(this.rendered.element);
    this.fitStage();
    this.highlightSelected();
  }

  /** Scales + centers the design-resolution preview inside the stage viewport. */
  private fitStage(): void {
    const { width, height } = this.def.preview;
    const stageW = this.stageHost.clientWidth;
    const stageH = this.stageHost.clientHeight;
    const scale = Math.min(stageW / width, stageH / height, 1) || 1;
    this.stageInner.style.width = `${width}px`;
    this.stageInner.style.height = `${height}px`;
    this.stageInner.style.transform = `scale(${scale})`;
    this.stageInner.style.left = `${Math.max(0, (stageW - width * scale) / 2)}px`;
    this.stageInner.style.top = `${Math.max(0, (stageH - height * scale) / 2)}px`;
  }

  private onStageClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-ui-id]");
    const id = target?.dataset.uiId;
    if (!id) return;
    this.selectedId = id;
    this.renderHierarchy();
    this.renderDetails();
    this.highlightSelected();
  }

  private highlightSelected(): void {
    for (const el of this.stageInner.querySelectorAll(".is-uie-selected")) {
      el.classList.remove("is-uie-selected");
    }
    this.rendered?.byId.get(this.selectedId)?.classList.add("is-uie-selected");
  }

  // --- Details -------------------------------------------------------------

  private renderDetails(): void {
    this.detailsHost.replaceChildren();
    const node = findUiNode(this.def.root, this.selectedId);
    if (!node) {
      this.detailsHost.append(this.makeHint("Select a widget to edit its properties."));
      return;
    }

    const header = document.createElement("div");
    header.className = "uie-details-header";
    header.innerHTML = `<strong>${escapeHtml(node.widget)}</strong><span class="uie-tree-id">${escapeHtml(node.id)}</span>`;
    this.detailsHost.append(header);

    const bindable = new Set<string>(BINDABLE_UI_PROPS);
    for (const field of fieldsForWidget(node.widget)) {
      this.detailsHost.append(
        bindable.has(field.key) ? this.makeBindableField(node, field) : this.makeField(node, field),
      );
    }
    if (node.widget === "Button") this.detailsHost.append(this.makeActionField(node));

    this.detailsHost.append(this.makeA11ySection(node));

    // Screen transition + initial focus live on the asset (def), shown for the root.
    if (node.id === this.def.root.id) {
      this.detailsHost.append(this.makeTransitionSection());
      this.detailsHost.append(this.makeInitialFocusSection());
    }

    // Node actions (reorder / delete) — never delete the root.
    const actions = document.createElement("div");
    actions.className = "uie-node-actions";
    actions.append(
      this.makeButton("↑", "Move up", () => this.moveSelected(-1)),
      this.makeButton("↓", "Move down", () => this.moveSelected(1)),
    );
    if (node.id !== this.def.root.id) {
      actions.append(this.makeButton("Delete", "Delete widget", () => this.deleteSelected(), true));
    }
    this.detailsHost.append(actions);
  }

  private makeField(node: UiNode, field: FieldDesc): HTMLElement {
    const row = document.createElement("label");
    row.className = "uie-field";
    const labelEl = document.createElement("span");
    labelEl.textContent = field.label;
    row.append(labelEl);

    const current = node.props[field.key];
    if (field.kind === "select") {
      const select = document.createElement("select");
      for (const option of field.options ?? []) {
        const opt = document.createElement("option");
        opt.value = option;
        opt.textContent = option === "" ? "(default)" : option;
        select.append(opt);
      }
      select.value = typeof current === "string" ? current : "";
      select.addEventListener("change", () => this.setProp(node, field.key, select.value || null));
      row.append(select);
    } else {
      const input = document.createElement("input");
      input.type = field.kind === "number" ? "number" : "text";
      input.value = current === undefined || current === null ? "" : String(current);
      input.addEventListener("change", () => {
        if (field.kind === "number") {
          const num = input.value.trim() === "" ? null : Number(input.value);
          this.setProp(node, field.key, num !== null && Number.isFinite(num) ? num : null);
        } else {
          this.setProp(node, field.key, input.value.trim() === "" ? null : input.value);
        }
      });
      row.append(input);
    }
    return row;
  }

  /**
   * A bindable property field (text/value/max/src): a literal input plus a "bind"
   * toggle that switches the prop to a `{ "bind": "path" }` ViewModel binding.
   */
  private makeBindableField(node: UiNode, field: FieldDesc): HTMLElement {
    const current = node.props[field.key];
    const bindPath = isUiBinding(current) ? current.bind : null;
    const bound = bindPath !== null;
    // A localized `{ key }` text prop is read-only here (edit the .ui.json/loc
    // table directly): v1 has no loc authoring UI, but the field must not clobber
    // the key with a literal or show "[object Object]".
    const locKey = !bound && field.key === "text" && isUiTextKey(current) ? current.key : null;

    const row = document.createElement("label");
    row.className = "uie-field";
    const labelEl = document.createElement("span");
    labelEl.textContent = field.label;
    row.append(labelEl);

    const controls = document.createElement("div");
    controls.className = "uie-bindable-controls";

    const input = document.createElement("input");
    if (locKey !== null) {
      input.type = "text";
      input.value = locKey;
      input.disabled = true;
      input.title = "Yerelleştirilmiş metin anahtarı; değiştirmek için dil tablosunu düzenleyin";
    } else if (bindPath !== null) {
      input.type = "text";
      input.placeholder = "field path, e.g. player.health";
      input.value = bindPath;
      input.addEventListener("change", () =>
        this.setProp(node, field.key, { bind: input.value.trim() || "value" }),
      );
    } else {
      input.type = field.kind === "number" ? "number" : "text";
      input.value = current === undefined || current === null ? "" : String(current);
      input.addEventListener("change", () => {
        if (field.kind === "number") {
          const num = input.value.trim() === "" ? null : Number(input.value);
          this.setProp(node, field.key, num !== null && Number.isFinite(num) ? num : null);
        } else {
          this.setProp(node, field.key, input.value.trim() === "" ? null : input.value);
        }
      });
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = bound ? "uie-bind-toggle is-active" : "uie-bind-toggle";
    toggle.textContent = locKey !== null ? "loc" : "bind";
    toggle.disabled = locKey !== null;
    toggle.title =
      locKey !== null
        ? "Localized text (key binding)"
        : bound
          ? "Unbind (use a literal value)"
          : "Bind to a ViewModel field";
    toggle.addEventListener("click", () => {
      if (bound) {
        this.setProp(node, field.key, null);
      } else {
        node.props[field.key] = { bind: typeof current === "string" ? current : "" };
        this.markDirty();
        this.renderPreview();
      }
      this.renderDetails();
    });

    controls.append(input, toggle);
    row.append(controls);
    return row;
  }

  /** Button `onClick` editor: none / back / message(+text). */
  private makeActionField(node: UiNode): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "uie-field uie-action-field";
    const labelEl = document.createElement("span");
    labelEl.textContent = "On Click";
    wrap.append(labelEl);

    const action = readUiAction(node);
    const select = document.createElement("select");
    for (const value of ["none", "back", "message"]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      select.append(opt);
    }
    select.value = action?.type ?? "none";

    const message = document.createElement("input");
    message.type = "text";
    message.placeholder = "Message name";
    message.value = action?.type === "message" ? action.message : "";
    message.hidden = select.value !== "message";

    const apply = (): void => {
      if (select.value === "back") this.setProp(node, "onClick", { type: "back" });
      else if (select.value === "message") {
        this.setProp(node, "onClick", { type: "message", message: message.value || "Message" });
      } else this.setProp(node, "onClick", null);
      message.hidden = select.value !== "message";
    };
    select.addEventListener("change", apply);
    message.addEventListener("change", apply);
    wrap.append(select, message);
    return wrap;
  }

  /**
   * Screen transition editor (asset-level): enter/exit preset + duration, plus a
   * "Play" button that replays the enter animation on the live preview. Writes
   * `this.def.transition` through `normalizeUiTransition` (cleared when both ends
   * are "none").
   */
  private makeTransitionSection(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "uie-field uie-transition-field";
    const title = document.createElement("span");
    title.textContent = "Screen Transition";
    wrap.append(title);

    const current = this.def.transition;
    const apply = (enter: string, exit: string, durationMs: number): void => {
      const next = normalizeUiTransition({ enter, exit, durationMs });
      if (next) this.def.transition = next;
      else delete this.def.transition;
      this.markDirty();
    };

    const enterSelect = this.makePresetSelect(current?.enter ?? "none");
    const exitSelect = this.makePresetSelect(current?.exit ?? "none");
    const duration = document.createElement("input");
    duration.type = "number";
    duration.min = "0";
    duration.value = String(current?.durationMs ?? DEFAULT_TRANSITION_DURATION_MS);

    const onChange = (): void =>
      apply(enterSelect.value, exitSelect.value, Number(duration.value) || 0);
    enterSelect.addEventListener("change", onChange);
    exitSelect.addEventListener("change", onChange);
    duration.addEventListener("change", onChange);

    wrap.append(
      this.makeLabeledRow("Enter", enterSelect),
      this.makeLabeledRow("Exit", exitSelect),
      this.makeLabeledRow("Duration (ms)", duration),
    );

    const play = document.createElement("button");
    play.type = "button";
    play.className = "uie-btn";
    play.textContent = "Play transition";
    play.title = "Giriş animasyonunu önizlemede yeniden oynat";
    play.addEventListener("click", () => this.playPreviewTransition());
    wrap.append(play);
    return wrap;
  }

  private makePresetSelect(value: string): HTMLSelectElement {
    const select = document.createElement("select");
    for (const preset of UI_TRANSITION_PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset;
      opt.textContent = preset;
      select.append(opt);
    }
    select.value = value;
    return select;
  }

  private makeLabeledRow(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement("label");
    row.className = "uie-field uie-subfield";
    const span = document.createElement("span");
    span.textContent = label;
    row.append(span, control);
    return row;
  }

  /**
   * Accessibility editor (per node): `aria-label`, an optional ARIA `role`
   * override, and focusability (default / force-focusable / non-focusable).
   * Writes `node.a11y` through {@link setA11y}; cleared fields drop the key.
   */
  private makeA11ySection(node: UiNode): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "uie-field uie-a11y-field";
    const title = document.createElement("span");
    title.textContent = "Accessibility";
    wrap.append(title);

    const a11y = node.a11y ?? {};

    const label = document.createElement("input");
    label.type = "text";
    label.placeholder = node.widget === "Image" ? "alt text" : "aria-label";
    label.value = a11y.label ?? "";
    label.addEventListener("change", () =>
      this.setA11y(node, "label", label.value.trim() || undefined),
    );

    const role = document.createElement("input");
    role.type = "text";
    role.placeholder = "role (optional)";
    role.value = a11y.role ?? "";
    role.addEventListener("change", () =>
      this.setA11y(node, "role", role.value.trim() || undefined),
    );

    const focusable = document.createElement("select");
    for (const [value, text] of [
      ["", "(default)"],
      ["yes", "Focusable"],
      ["no", "Not focusable"],
    ] as const) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      focusable.append(opt);
    }
    focusable.value = a11y.focusable === true ? "yes" : a11y.focusable === false ? "no" : "";
    focusable.addEventListener("change", () =>
      this.setA11y(
        node,
        "focusable",
        focusable.value === "yes" ? true : focusable.value === "no" ? false : undefined,
      ),
    );

    wrap.append(
      this.makeLabeledRow("Label", label),
      this.makeLabeledRow("Role", role),
      this.makeLabeledRow("Focusable", focusable),
    );
    return wrap;
  }

  /** Sets one {@link UiA11y} field on a node (undefined/empty clears it). */
  private setA11y<K extends keyof UiA11y>(node: UiNode, key: K, value: UiA11y[K] | undefined): void {
    const a11y: UiA11y = { ...(node.a11y ?? {}) };
    if (value === undefined || value === "") delete a11y[key];
    else a11y[key] = value;
    if (Object.keys(a11y).length === 0) delete node.a11y;
    else node.a11y = a11y;
    this.markDirty();
    this.renderPreview();
  }

  /**
   * Screen-level initial focus selector (asset): which focusable node receives
   * focus when the widget opens as a screen. Defaults to the first focusable.
   */
  private makeInitialFocusSection(): HTMLElement {
    const select = document.createElement("select");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(first focusable)";
    select.append(none);
    for (const id of collectFocusables(this.def.root)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      select.append(opt);
    }
    select.value = this.def.initialFocus ?? "";
    select.addEventListener("change", () => {
      if (select.value) this.def.initialFocus = select.value;
      else delete this.def.initialFocus;
      this.markDirty();
    });
    return this.makeLabeledRow("Initial Focus", select);
  }

  /** Replays the authored enter transition on the current preview element. */
  private playPreviewTransition(): void {
    const el = this.rendered?.element;
    const transition = this.def.transition;
    if (!el || !transition) return;
    // The editor previews the animation regardless of reduced-motion so authors
    // can always see it.
    const classes = transitionClasses(transition.enter);
    if (!classes) return;
    el.style.transitionDuration = `${transition.durationMs}ms`;
    el.classList.add(classes.base, classes.offset);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.remove(classes.offset));
    });
    let done = false;
    const cleanup = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      el.removeEventListener("transitionend", onEnd);
      el.classList.remove(classes.base);
      el.style.transitionDuration = "";
    };
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === el) cleanup();
    };
    el.addEventListener("transitionend", onEnd);
    const timer = window.setTimeout(cleanup, transition.durationMs + 80);
  }

  private makeButton(
    text: string,
    title: string,
    onClick: () => void,
    danger = false,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = danger ? "uie-btn uie-btn-danger" : "uie-btn";
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  private makeHint(text: string): HTMLElement {
    const hint = document.createElement("p");
    hint.className = "uie-hint";
    hint.textContent = text;
    return hint;
  }

  private setProp(node: UiNode, key: string, value: unknown): void {
    if (value === null || value === undefined) delete node.props[key];
    else node.props[key] = value as UiNode["props"][string];
    this.markDirty();
    this.renderPreview();
  }

  private moveSelected(direction: -1 | 1): void {
    const parent = findUiNodeParent(this.def.root, this.selectedId);
    if (!parent) return;
    const index = parent.children.findIndex((child) => child.id === this.selectedId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= parent.children.length) return;
    const [moved] = parent.children.splice(index, 1);
    parent.children.splice(next, 0, moved!);
    this.markDirty();
    this.renderAll();
  }

  private deleteSelected(): void {
    const parent = findUiNodeParent(this.def.root, this.selectedId);
    if (!parent) return; // root is not deletable
    parent.children = parent.children.filter((child) => child.id !== this.selectedId);
    this.selectedId = parent.id;
    this.markDirty();
    this.renderAll();
  }

  // --- Save / lifecycle ----------------------------------------------------

  private async save(): Promise<void> {
    try {
      const result = await saveUiWidgetAsset(this.options.path, normalizeUiWidgetDef(this.def));
      this.dirty = false;
      this.requireEl<HTMLButtonElement>("[data-uie-save]").classList.remove("is-dirty");
      this.setStatus(result.changed ? `Saved ${result.path}` : "No changes to save.", "success");
      this.options.onSaved?.();
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private markDirty(): void {
    this.dirty = true;
    this.overlay.querySelector<HTMLButtonElement>("[data-uie-save]")?.classList.add("is-dirty");
  }

  private setStatus(message: string, tone: StatusTone = "info"): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone;
    this.options.onStatus?.(message, tone);
  }

  close(): void {
    if (this.disposed) return;
    if (this.dirty && !window.confirm("Close UI Widget editor without saving?")) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.rendered?.dispose();
    this.overlay.remove();
    if (UiWidgetEditor.activeInstance === this) UiWidgetEditor.activeInstance = null;
  }
}
