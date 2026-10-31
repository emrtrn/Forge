/**
 * Behavior Tree editor (v1) — Forge's authoring shell for `*.behavior.json`
 * assets, opened from the Content Browser (double-click / "Open").
 *
 * The editor pairs a **selectable structured outline** (left) with a **node
 * details form + raw-JSON authoring pane** (right):
 *   - The raw JSON stays the single source of truth: it is the save payload and
 *     the thing every view derives from. On every edit (typed JSON *or* a
 *     structured node-form action) it is parsed and run through the engine
 *     normalizer (`normalizeAiBehaviorTreeAsset`) — the same validator the dev
 *     save endpoint uses — so the outline, node form and validation panel always
 *     reflect what would be saved.
 *   - The outline renders the composite/task/wait/subtree tree plus each node's
 *     decorators and services, and each node is selectable.
 *   - The node form edits the selected node's primary fields (kind / id /
 *     task / seconds / behavior), its **decorators** (blackboard / distance /
 *     cooldown / hasPerceptionStimulus) and its **services** (name / interval),
 *     and offers add-child / remove / reorder. Each action mutates a clone of the
 *     parsed tree and re-serializes it back into the raw pane, so there is no
 *     second save surface — the tested normalizer and the guarded
 *     `/__save-behavior` endpoint are reused verbatim.
 *   - Save posts the parsed object through `/__save-behavior`, which re-validates
 *     server-side; an invalid tree blocks the save with the normalizer error.
 *
 * Only task/service `params` (opaque JSON maps) and blackboard decorator vec3
 * values remain raw-JSON edits (params are surfaced as a count hint); everything
 * else is form-authored.
 */

import type {
  AiBehaviorNode,
  AiBehaviorNodeKind,
  AiDecoratorOp,
  AiNumericCompareOp,
  AiPerceptionSenseName,
} from "@engine/ai/behaviorAsset";
import { normalizeAiBehaviorTreeAsset } from "@engine/ai/behaviorAsset";
import {
  defaultBehaviorTreeJson,
  loadBehaviorTreeText,
  saveBehaviorTreeAsset,
} from "@/editor/behaviorTreeStore";

type StatusTone = "info" | "success" | "warning" | "error";

export interface BehaviorTreeEditorOptions {
  path: string;
  label: string;
  onStatus?: (message: string, tone?: StatusTone) => void;
  onSaved?: () => void;
}

const NODE_KINDS: readonly AiBehaviorNodeKind[] = [
  "selector",
  "sequence",
  "task",
  "wait",
  "subtree",
];

const NODE_COLORS: Record<string, string> = {
  selector: "#d4a45a",
  sequence: "#5a9fd4",
  task: "#6fd0a4",
  wait: "#8a9ad4",
  subtree: "#c47dd4",
};

type AiDecoratorKind = "blackboard" | "distance" | "cooldown" | "hasPerceptionStimulus";

const DECORATOR_KINDS: readonly AiDecoratorKind[] = [
  "blackboard",
  "distance",
  "cooldown",
  "hasPerceptionStimulus",
];

const DECORATOR_KIND_LABELS: Record<AiDecoratorKind, string> = {
  blackboard: "blackboard",
  distance: "distance",
  cooldown: "cooldown",
  hasPerceptionStimulus: "perception",
};

const BLACKBOARD_OPS: readonly AiDecoratorOp[] = ["equals", "notEquals", "isSet", "isNotSet"];
const DISTANCE_OPS: readonly AiNumericCompareOp[] = ["lt", "lte", "gt", "gte"];
const PERCEPTION_SENSES: readonly AiPerceptionSenseName[] = [
  "sight",
  "hearing",
  "damage",
  "alert",
  "gameplay",
];

/** A fresh decorator of `kind`, seeded so the tree stays valid on add/convert. */
function defaultDecorator(kind: AiDecoratorKind, key: string): Record<string, unknown> {
  switch (kind) {
    case "blackboard":
      return { kind, key, op: "isSet" };
    case "distance":
      return { kind, key, op: "lte", value: 2 };
    case "cooldown":
      return { kind, seconds: 1 };
    case "hasPerceptionStimulus":
      return { kind };
  }
}

/** Blackboard decorator value shows as JSON so scalars/vec3 round-trip in one field. */
function decoratorValueText(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

/** Parses a blackboard decorator value field: JSON when possible, else the raw string. */
function parseBlackboardValueText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComposite(node: Record<string, unknown> | null): boolean {
  return !!node && (node.kind === "selector" || node.kind === "sequence");
}

/** Serializes a node path (child indices from root) for a `data-bte-path` attr. */
function pathParam(path: readonly number[]): string {
  return path.join(".");
}

/** Parses a `data-bte-path` attribute back into a node path ("" → root []). */
function parsePathParam(value: string | null | undefined): number[] {
  if (!value) return [];
  return value.split(".").map((entry) => Number(entry));
}

function pathEq(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/** Walks the tree to the node at `path`, or null when the path is stale. */
function resolveNode(root: unknown, path: readonly number[]): Record<string, unknown> | null {
  let node: unknown = root;
  for (const index of path) {
    if (!isObj(node)) return null;
    const children = node.children;
    if (!Array.isArray(children) || index < 0 || index >= children.length) return null;
    node = children[index];
  }
  return isObj(node) ? node : null;
}

interface NodeParent {
  readonly parent: Record<string, unknown>;
  readonly children: unknown[];
  readonly index: number;
}

/** Resolves the parent + sibling index of `path`, or null for the root/stale. */
function resolveParent(root: unknown, path: readonly number[]): NodeParent | null {
  if (path.length === 0) return null;
  const parent = resolveNode(root, path.slice(0, -1));
  if (!parent || !Array.isArray(parent.children)) return null;
  const index = path[path.length - 1] ?? -1;
  if (index < 0 || index >= parent.children.length) return null;
  return { parent, children: parent.children, index };
}

/** A fresh node of `kind`, seeded with defaults that keep the tree valid where possible. */
function defaultNode(kind: AiBehaviorNodeKind): Record<string, unknown> {
  switch (kind) {
    case "selector":
    case "sequence":
      return { kind, children: [] };
    case "task":
      return { kind, task: "forge.setBlackboard" };
    case "wait":
      return { kind, seconds: 1 };
    case "subtree":
      return { kind, behavior: "" };
  }
}

/**
 * Converts a node to `kind` in place-ish (returns a new object), preserving the
 * shared base fields (id / decorators / services) and, for composite→composite,
 * the children. Kind-specific fields fall back to their defaults.
 */
function convertNode(node: Record<string, unknown>, kind: AiBehaviorNodeKind): Record<string, unknown> {
  const out: Record<string, unknown> = { kind };
  if (typeof node.id === "string" && node.id.length > 0) out.id = node.id;
  if (Array.isArray(node.decorators) && node.decorators.length > 0) out.decorators = node.decorators;
  if (Array.isArray(node.services) && node.services.length > 0) out.services = node.services;
  switch (kind) {
    case "selector":
    case "sequence":
      out.children = Array.isArray(node.children) ? node.children : [];
      break;
    case "task":
      out.task = typeof node.task === "string" && node.task.length > 0 ? node.task : "forge.setBlackboard";
      break;
    case "wait":
      out.seconds = typeof node.seconds === "number" ? node.seconds : 1;
      break;
    case "subtree":
      out.behavior = typeof node.behavior === "string" ? node.behavior : "";
      break;
  }
  return out;
}

/** Result of parsing + validating the raw JSON pane. */
interface ParseState {
  /** Parsed JSON (any shape) when the text is valid JSON, else null. */
  value: unknown;
  /** The parsed object cast for lenient outline walking, else null. */
  root: unknown;
  /** Normalizer error (parse or schema) shown in the validation panel, else "". */
  error: string;
  /** True when the parsed value passed the engine normalizer. */
  valid: boolean;
}

export class BehaviorTreeEditor {
  private static activeInstance: BehaviorTreeEditor | null = null;

  static async open(options: BehaviorTreeEditorOptions): Promise<BehaviorTreeEditor> {
    BehaviorTreeEditor.activeInstance?.close();
    const editor = new BehaviorTreeEditor(options);
    BehaviorTreeEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly outlineHost: HTMLElement;
  private readonly formHost: HTMLElement;
  private readonly validationHost: HTMLElement;
  private readonly rawEl: HTMLTextAreaElement;
  private readonly statusEl: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;

  private raw = defaultBehaviorTreeJson();
  /** Selected node path (child indices from root); null = nothing selected. */
  private selectedPath: number[] | null = null;
  private disposed = false;

  private constructor(private readonly options: BehaviorTreeEditorOptions) {
    this.overlay = document.createElement("div");
    this.overlay.className = "bte-overlay";
    this.overlay.innerHTML = `
<div class="bte-window">
  <header class="bte-header">
    <span class="bte-tab">
      <span class="bte-tab-icon">AI</span>
      <strong data-bte-title></strong>
      <span class="bte-badge">Behavior Tree</span>
    </span>
    <div class="bte-header-actions">
      <button type="button" class="bte-save" data-bte-save title="Save (Ctrl+S)">Save</button>
      <button type="button" class="bte-close" data-bte-close title="Close (Esc)">×</button>
    </div>
  </header>
  <div class="bte-body">
    <aside class="bte-left">
      <div class="bte-section-title">Tree Outline</div>
      <div class="bte-outline" data-bte-outline></div>
      <div class="bte-section-title">Validation</div>
      <div class="bte-validation" data-bte-validation></div>
    </aside>
    <div class="bte-right">
      <div class="bte-section-title">Node Details</div>
      <div class="bte-form" data-bte-form></div>
      <div class="bte-section-title">Asset JSON</div>
      <textarea class="bte-raw" data-bte-raw spellcheck="false"></textarea>
    </div>
  </div>
  <footer class="bte-status" data-bte-status>Loading…</footer>
</div>`;
    document.body.append(this.overlay);

    this.titleEl = this.req("[data-bte-title]");
    this.outlineHost = this.req("[data-bte-outline]");
    this.formHost = this.req("[data-bte-form]");
    this.validationHost = this.req("[data-bte-validation]");
    this.rawEl = this.req<HTMLTextAreaElement>("[data-bte-raw]");
    this.statusEl = this.req("[data-bte-status]");
    this.saveBtn = this.req<HTMLButtonElement>("[data-bte-save]");

    this.titleEl.textContent = options.label;
    this.req<HTMLButtonElement>("[data-bte-close]").addEventListener("click", () => this.close());
    this.saveBtn.addEventListener("click", () => void this.save());
    this.rawEl.addEventListener("input", () => {
      this.raw = this.rawEl.value;
      this.markDirty();
      this.renderDerived();
    });

    // Delegated outline selection: clicking anywhere inside a node's row (or its
    // decorator/service chips) selects that node. `closest` resolves the
    // innermost `.bte-node` so nested children win over their ancestors.
    this.outlineHost.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const li = target?.closest<HTMLElement>(".bte-node[data-bte-path]");
      if (!li) return;
      this.selectedPath = parsePathParam(li.dataset.btePath);
      this.renderDerived();
    });

    this.overlay.tabIndex = -1;
    this.overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void this.save();
      }
    });
    this.overlay.focus();
  }

  private req<T extends Element = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`BehaviorTreeEditor: missing ${selector}`);
    return el;
  }

  private async load(): Promise<void> {
    try {
      this.raw = await loadBehaviorTreeText(this.options.path);
      this.rawEl.value = this.raw;
      this.saveBtn.classList.remove("is-dirty");
      // Select the root by default so the node form is populated on open.
      this.selectedPath = [];
      this.renderDerived();
      this.setStatus("Ready.");
    } catch (error) {
      this.setStatus(`Failed to load: ${describeError(error)}`, "error");
    }
  }

  /** Parses the raw pane and returns its JSON + validation state. */
  private parse(): ParseState {
    let value: unknown;
    try {
      value = JSON.parse(this.raw);
    } catch (error) {
      return { value: null, root: null, error: `Invalid JSON: ${describeError(error)}`, valid: false };
    }
    const root = (value as { root?: unknown } | null)?.root ?? null;
    try {
      normalizeAiBehaviorTreeAsset(value);
      return { value, root, error: "", valid: true };
    } catch (error) {
      return { value, root, error: describeError(error), valid: false };
    }
  }

  private renderDerived(): void {
    if (this.disposed) return;
    const state = this.parse();
    // Drop a stale selection (e.g. the raw JSON was edited to a smaller tree).
    if (this.selectedPath && !resolveNode(state.root, this.selectedPath)) {
      this.selectedPath = null;
    }
    this.renderOutline(state);
    this.renderNodeForm(state);
    this.renderValidation(state);
  }

  private renderOutline(state: ParseState): void {
    if (state.value === null) {
      this.outlineHost.innerHTML = `<div class="bte-outline-empty">Ağacı görmek için JSON'u düzeltin.</div>`;
      return;
    }
    if (!state.root) {
      this.outlineHost.innerHTML = `<div class="bte-outline-empty">No <code>root</code> node.</div>`;
      return;
    }
    this.outlineHost.innerHTML = `<ul class="bte-tree">${this.nodeHtml(state.root, [])}</ul>`;
  }

  /** Lenient recursive outline: renders whatever node shape is present. */
  private nodeHtml(raw: unknown, path: number[]): string {
    const selected = this.selectedPath !== null && pathEq(path, this.selectedPath);
    if (!raw || typeof raw !== "object") {
      return `<li class="bte-node" data-bte-path="${pathParam(path)}"><div class="bte-node-row${
        selected ? " is-selected" : ""
      }"><span class="bte-node-bad">malformed node</span></div></li>`;
    }
    const node = raw as Partial<AiBehaviorNode> & Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : "?";
    const color = NODE_COLORS[kind] ?? "#8a929c";
    const summary = esc(this.nodeSummary(kind, node));
    const meta = this.nodeMeta(node);
    const childHtml =
      (kind === "selector" || kind === "sequence") && Array.isArray(node.children)
        ? `<ul class="bte-tree">${node.children
            .map((child, index) => this.nodeHtml(child, [...path, index]))
            .join("")}</ul>`
        : "";
    return `
      <li class="bte-node" data-bte-path="${pathParam(path)}">
        <div class="bte-node-row${selected ? " is-selected" : ""}">
          <span class="bte-node-kind" style="--bte-color:${color}">${esc(kind)}</span>
          ${summary ? `<span class="bte-node-sub">${summary}</span>` : ""}
        </div>
        ${meta}
        ${childHtml}
      </li>`;
  }

  private nodeSummary(kind: string, node: Record<string, unknown>): string {
    switch (kind) {
      case "task":
        return typeof node.task === "string" ? node.task : "(no task)";
      case "wait":
        return typeof node.seconds === "number" ? `${node.seconds}s` : "";
      case "subtree":
        return typeof node.behavior === "string" ? `→ ${node.behavior}` : "(no behavior)";
      case "selector":
      case "sequence": {
        const count = Array.isArray(node.children) ? node.children.length : 0;
        return `${count} child${count === 1 ? "" : "ren"}`;
      }
      default:
        return "";
    }
  }

  /** Renders decorator + service chips under a node row (when present). */
  private nodeMeta(node: Record<string, unknown>): string {
    const rows: string[] = [];
    if (Array.isArray(node.decorators) && node.decorators.length > 0) {
      const chips = node.decorators
        .map((d) => `<span class="bte-chip bte-chip-dec">${esc(this.decoratorLabel(d))}</span>`)
        .join("");
      rows.push(`<div class="bte-node-meta">${chips}</div>`);
    }
    if (Array.isArray(node.services) && node.services.length > 0) {
      const chips = node.services
        .map((s) => `<span class="bte-chip bte-chip-svc">${esc(this.serviceLabel(s))}</span>`)
        .join("");
      rows.push(`<div class="bte-node-meta">${chips}</div>`);
    }
    return rows.join("");
  }

  private decoratorLabel(raw: unknown): string {
    if (!raw || typeof raw !== "object") return "decorator";
    const d = raw as Record<string, unknown>;
    const kind = typeof d.kind === "string" ? d.kind : "?";
    switch (kind) {
      case "blackboard":
        return `if ${String(d.key ?? "?")} ${String(d.op ?? "")} ${d.value === undefined ? "" : JSON.stringify(d.value)}`.trim();
      case "distance":
        return `dist ${String(d.key ?? "?")} ${String(d.op ?? "")} ${String(d.value ?? "?")}`;
      case "cooldown":
        return `cooldown ${String(d.seconds ?? "?")}s`;
      case "hasPerceptionStimulus":
        return `sense ${String(d.sense ?? "any")}`;
      default:
        return kind;
    }
  }

  private serviceLabel(raw: unknown): string {
    if (!raw || typeof raw !== "object") return "service";
    const s = raw as Record<string, unknown>;
    const name = typeof s.service === "string" ? s.service : "?";
    return typeof s.interval === "number" ? `${name} @${s.interval}s` : name;
  }

  // --- Node details form ---------------------------------------------------

  private renderNodeForm(state: ParseState): void {
    if (!isObj(state.value) || !isObj(state.root)) {
      this.formHost.innerHTML = `<div class="bte-form-empty">Düğümleri düzenlemek için geçerli bir <code>root</code> düğümü ekleyin.</div>`;
      return;
    }
    if (this.selectedPath === null) {
      this.formHost.innerHTML = `<div class="bte-form-empty">Düzenlemek için ana hattan bir düğüm seçin.</div>`;
      return;
    }
    const node = resolveNode(state.root, this.selectedPath);
    if (!node) {
      this.formHost.innerHTML = `<div class="bte-form-empty">Düzenlemek için ana hattan bir düğüm seçin.</div>`;
      return;
    }

    const kind = typeof node.kind === "string" ? node.kind : "?";
    const parent = resolveParent(state.root, this.selectedPath);
    const canRemove = this.selectedPath.length > 0;
    const canUp = !!parent && parent.index > 0;
    const canDown = !!parent && parent.index < parent.children.length - 1;

    const kindOptions = NODE_KINDS.map(
      (k) => `<option value="${k}"${k === kind ? " selected" : ""}>${k}</option>`,
    ).join("");

    const rows: string[] = [];
    rows.push(this.fieldRow("Kind", `<select data-bte-field="kind" class="bte-input">${kindOptions}</select>`));
    rows.push(
      this.fieldRow(
        "Id",
        `<input type="text" data-bte-field="id" class="bte-input" placeholder="(optional)" value="${esc(
          typeof node.id === "string" ? node.id : "",
        )}">`,
      ),
    );
    if (kind === "task") {
      rows.push(
        this.fieldRow(
          "Task",
          `<input type="text" data-bte-field="task" class="bte-input" value="${esc(
            typeof node.task === "string" ? node.task : "",
          )}">`,
        ),
      );
    } else if (kind === "wait") {
      rows.push(
        this.fieldRow(
          "Seconds",
          `<input type="number" step="0.1" min="0" data-bte-field="seconds" class="bte-input" value="${esc(
            typeof node.seconds === "number" ? String(node.seconds) : "1",
          )}">`,
        ),
      );
    } else if (kind === "subtree") {
      rows.push(
        this.fieldRow(
          "Behavior",
          `<input type="text" data-bte-field="behavior" class="bte-input" placeholder="assets/…/x.behavior.json" value="${esc(
            typeof node.behavior === "string" ? node.behavior : "",
          )}">`,
        ),
      );
    } else if (isComposite(node)) {
      const count = Array.isArray(node.children) ? node.children.length : 0;
      rows.push(
        `<div class="bte-form-hint">${count} alt düğüm; düzenlemek için <strong>Add Child</strong> ve ana hattı kullanın.</div>`,
      );
    }

    const addKindOptions = NODE_KINDS.map((k) => `<option value="${k}">${k}</option>`).join("");
    this.formHost.innerHTML = `
      <div class="bte-form-toolbar">
        <span class="bte-form-add">
          <select data-bte-add-kind class="bte-input bte-input-sm"${isComposite(node) ? "" : " disabled"}>${addKindOptions}</select>
          <button type="button" data-bte-add class="bte-btn"${isComposite(node) ? "" : " disabled"} title="Alt düğüm ekle">+ Add Child</button>
        </span>
        <button type="button" data-bte-remove class="bte-btn"${canRemove ? "" : " disabled"} title="Bu düğümü kaldır">Remove</button>
        <button type="button" data-bte-up class="bte-btn"${canUp ? "" : " disabled"} title="Kardeşler arasında yukarı taşı">↑</button>
        <button type="button" data-bte-down class="bte-btn"${canDown ? "" : " disabled"} title="Kardeşler arasında aşağı taşı">↓</button>
      </div>
      <div class="bte-form-fields">${rows.join("")}</div>
      ${this.decoratorsSectionHtml(node)}
      ${this.servicesSectionHtml(node)}`;

    this.bindNodeForm();
  }

  private fieldRow(label: string, control: string): string {
    return `<label class="bte-form-row"><span class="bte-form-label">${esc(label)}</span>${control}</label>`;
  }

  private bindNodeForm(): void {
    const kindSel = this.formHost.querySelector<HTMLSelectElement>('[data-bte-field="kind"]');
    kindSel?.addEventListener("change", () => this.applyKind(kindSel.value as AiBehaviorNodeKind));

    const idInput = this.formHost.querySelector<HTMLInputElement>('[data-bte-field="id"]');
    idInput?.addEventListener("change", () => this.applyStringField("id", idInput.value.trim(), true));

    const taskInput = this.formHost.querySelector<HTMLInputElement>('[data-bte-field="task"]');
    taskInput?.addEventListener("change", () => this.applyStringField("task", taskInput.value.trim(), false));

    const behaviorInput = this.formHost.querySelector<HTMLInputElement>('[data-bte-field="behavior"]');
    behaviorInput?.addEventListener("change", () =>
      this.applyStringField("behavior", behaviorInput.value.trim(), false),
    );

    const secondsInput = this.formHost.querySelector<HTMLInputElement>('[data-bte-field="seconds"]');
    secondsInput?.addEventListener("change", () => this.applySecondsField(secondsInput.value));

    const addKind = this.formHost.querySelector<HTMLSelectElement>("[data-bte-add-kind]");
    this.formHost
      .querySelector<HTMLButtonElement>("[data-bte-add]")
      ?.addEventListener("click", () => this.addChild((addKind?.value as AiBehaviorNodeKind) ?? "task"));
    this.formHost
      .querySelector<HTMLButtonElement>("[data-bte-remove]")
      ?.addEventListener("click", () => this.removeSelected());
    this.formHost
      .querySelector<HTMLButtonElement>("[data-bte-up]")
      ?.addEventListener("click", () => this.moveSelected(-1));
    this.formHost
      .querySelector<HTMLButtonElement>("[data-bte-down]")
      ?.addEventListener("click", () => this.moveSelected(1));

    this.bindDecoratorSection();
    this.bindServiceSection();
  }

  // --- Decorator authoring -------------------------------------------------

  private decoratorsSectionHtml(node: Record<string, unknown>): string {
    const decorators = Array.isArray(node.decorators) ? node.decorators : [];
    const cards = decorators.map((decorator, index) => this.decoratorCardHtml(decorator, index)).join("");
    const addOptions = DECORATOR_KINDS.map(
      (k) => `<option value="${k}">${DECORATOR_KIND_LABELS[k]}</option>`,
    ).join("");
    return `
      <div class="bte-section-sub">Decorators</div>
      <div class="bte-cards" data-bte-dec-list>${
        cards || `<div class="bte-form-empty">Decorator yok.</div>`
      }</div>
      <div class="bte-form-add">
        <select data-bte-add-dec-kind class="bte-input bte-input-sm">${addOptions}</select>
        <button type="button" data-bte-add-dec class="bte-btn" title="Decorator ekle">+ Decorator</button>
      </div>`;
  }

  private decoratorCardHtml(raw: unknown, index: number): string {
    const dec = isObj(raw) ? raw : {};
    const kind = (typeof dec.kind === "string" ? dec.kind : "blackboard") as AiDecoratorKind;
    const kindOptions = DECORATOR_KINDS.map(
      (k) => `<option value="${k}"${k === kind ? " selected" : ""}>${DECORATOR_KIND_LABELS[k]}</option>`,
    ).join("");
    return `
      <div class="bte-card" data-bte-dec-index="${index}">
        <div class="bte-card-head">
          <select data-bte-dec-kind class="bte-input bte-input-sm">${kindOptions}</select>
          <button type="button" data-bte-dec-remove class="bte-btn bte-btn-sm" title="Remove decorator">✕</button>
        </div>
        <div class="bte-card-fields">${this.decoratorFieldsHtml(kind, dec)}</div>
      </div>`;
  }

  private decoratorFieldsHtml(kind: AiDecoratorKind, dec: Record<string, unknown>): string {
    const rows: string[] = [];
    if (kind === "blackboard" || kind === "distance") {
      rows.push(
        this.fieldRow(
          "Key",
          `<input type="text" data-bte-dec-f="key" class="bte-input" placeholder="target" value="${esc(
            typeof dec.key === "string" ? dec.key : "",
          )}">`,
        ),
      );
      const ops = kind === "blackboard" ? BLACKBOARD_OPS : DISTANCE_OPS;
      const current = typeof dec.op === "string" ? dec.op : ops[0];
      const opOptions = ops
        .map((op) => `<option value="${op}"${op === current ? " selected" : ""}>${op}</option>`)
        .join("");
      rows.push(this.fieldRow("Op", `<select data-bte-dec-f="op" class="bte-input">${opOptions}</select>`));
    }
    if (kind === "distance") {
      rows.push(
        this.fieldRow(
          "Value",
          `<input type="number" step="0.1" data-bte-dec-f="value" class="bte-input" value="${esc(
            typeof dec.value === "number" ? String(dec.value) : "0",
          )}">`,
        ),
      );
    } else if (kind === "blackboard" && (dec.op === "equals" || dec.op === "notEquals")) {
      rows.push(
        this.fieldRow(
          "Value",
          `<input type="text" data-bte-dec-f="value" class="bte-input" placeholder="true / 42 / &quot;text&quot;" value="${esc(
            decoratorValueText(dec.value),
          )}">`,
        ),
      );
    }
    if (kind === "cooldown") {
      rows.push(
        this.fieldRow(
          "Seconds",
          `<input type="number" step="0.1" min="0" data-bte-dec-f="seconds" class="bte-input" value="${esc(
            typeof dec.seconds === "number" ? String(dec.seconds) : "1",
          )}">`,
        ),
      );
    }
    if (kind === "hasPerceptionStimulus") {
      const sense = typeof dec.sense === "string" ? dec.sense : "";
      const senseOptions = [`<option value=""${sense === "" ? " selected" : ""}>any</option>`]
        .concat(
          PERCEPTION_SENSES.map(
            (s) => `<option value="${s}"${s === sense ? " selected" : ""}>${s}</option>`,
          ),
        )
        .join("");
      rows.push(this.fieldRow("Sense", `<select data-bte-dec-f="sense" class="bte-input">${senseOptions}</select>`));
      rows.push(
        this.fieldRow(
          "Min strength",
          `<input type="number" step="0.1" data-bte-dec-f="minStrength" class="bte-input" placeholder="any" value="${esc(
            typeof dec.minStrength === "number" ? String(dec.minStrength) : "",
          )}">`,
        ),
      );
      const los = dec.requireLineOfSight;
      const losValue = typeof los === "boolean" ? String(los) : "";
      const losOptions = [
        `<option value=""${losValue === "" ? " selected" : ""}>ignore</option>`,
        `<option value="true"${losValue === "true" ? " selected" : ""}>require</option>`,
        `<option value="false"${losValue === "false" ? " selected" : ""}>forbid</option>`,
      ].join("");
      rows.push(
        this.fieldRow("Line of sight", `<select data-bte-dec-f="requireLineOfSight" class="bte-input">${losOptions}</select>`),
      );
    }
    return rows.join("");
  }

  private bindDecoratorSection(): void {
    const addKind = this.formHost.querySelector<HTMLSelectElement>("[data-bte-add-dec-kind]");
    this.formHost
      .querySelector<HTMLButtonElement>("[data-bte-add-dec]")
      ?.addEventListener("click", () =>
        this.addDecorator((addKind?.value as AiDecoratorKind) ?? "blackboard"),
      );

    this.formHost.querySelectorAll<HTMLElement>("[data-bte-dec-index]").forEach((card) => {
      const index = Number(card.dataset.bteDecIndex);
      card
        .querySelector<HTMLSelectElement>("[data-bte-dec-kind]")
        ?.addEventListener("change", (event) =>
          this.setDecoratorKind(index, (event.target as HTMLSelectElement).value as AiDecoratorKind),
        );
      card
        .querySelector<HTMLButtonElement>("[data-bte-dec-remove]")
        ?.addEventListener("click", () => this.removeDecorator(index));
      card.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-bte-dec-f]").forEach((ctrl) => {
        ctrl.addEventListener("change", () =>
          this.setDecoratorField(index, ctrl.dataset.bteDecF ?? "", ctrl.value),
        );
      });
    });
  }

  /** Runs `fn` on the selected node's decorator array, dropping it when it empties. */
  private mutateDecorators(fn: (list: unknown[]) => void): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveNode(asset.root, path);
      if (!node) return undefined;
      const list = Array.isArray(node.decorators) ? (node.decorators as unknown[]) : [];
      fn(list);
      if (list.length > 0) node.decorators = list;
      else delete node.decorators;
      return path;
    });
  }

  private addDecorator(kind: AiDecoratorKind): void {
    if (!DECORATOR_KINDS.includes(kind)) return;
    this.mutateDecorators((list) => list.push(defaultDecorator(kind, "target")));
  }

  private removeDecorator(index: number): void {
    this.mutateDecorators((list) => {
      if (index >= 0 && index < list.length) list.splice(index, 1);
    });
  }

  private setDecoratorKind(index: number, kind: AiDecoratorKind): void {
    if (!DECORATOR_KINDS.includes(kind)) return;
    this.mutateDecorators((list) => {
      const prev = isObj(list[index]) ? (list[index] as Record<string, unknown>) : {};
      const key = typeof prev.key === "string" && prev.key.length > 0 ? prev.key : "target";
      list[index] = defaultDecorator(kind, key);
    });
  }

  private setDecoratorField(index: number, field: string, rawValue: string): void {
    this.mutateDecorators((list) => {
      const dec = list[index];
      if (!isObj(dec)) return;
      switch (field) {
        case "key":
          dec.key = rawValue.trim();
          break;
        case "op":
          dec.op = rawValue;
          break;
        case "value":
          if (dec.kind === "distance") {
            const parsed = Number(rawValue);
            if (Number.isFinite(parsed)) dec.value = parsed;
          } else if (rawValue.trim().length === 0) {
            delete dec.value;
          } else {
            dec.value = parseBlackboardValueText(rawValue.trim());
          }
          break;
        case "seconds": {
          const parsed = Number(rawValue);
          if (Number.isFinite(parsed)) dec.seconds = parsed;
          break;
        }
        case "sense":
          if (rawValue.length === 0) delete dec.sense;
          else dec.sense = rawValue;
          break;
        case "minStrength":
          if (rawValue.trim().length === 0) {
            delete dec.minStrength;
          } else {
            const parsed = Number(rawValue);
            if (Number.isFinite(parsed)) dec.minStrength = parsed;
          }
          break;
        case "requireLineOfSight":
          if (rawValue.length === 0) delete dec.requireLineOfSight;
          else dec.requireLineOfSight = rawValue === "true";
          break;
      }
    });
  }

  // --- Service authoring ---------------------------------------------------

  private servicesSectionHtml(node: Record<string, unknown>): string {
    const services = Array.isArray(node.services) ? node.services : [];
    const cards = services.map((service, index) => this.serviceCardHtml(service, index)).join("");
    return `
      <div class="bte-section-sub">Services</div>
      <div class="bte-cards" data-bte-svc-list>${
        cards || `<div class="bte-form-empty">Service yok.</div>`
      }</div>
      <div class="bte-form-add">
        <button type="button" data-bte-add-svc class="bte-btn" title="Service ekle">+ Service</button>
      </div>`;
  }

  private serviceCardHtml(raw: unknown, index: number): string {
    const svc = isObj(raw) ? raw : {};
    const paramCount =
      isObj(svc.params) && svc.params !== null ? Object.keys(svc.params).length : 0;
    const rows: string[] = [
      this.fieldRow(
        "Service",
        `<input type="text" data-bte-svc-f="service" class="bte-input" placeholder="forge.updatePerceptionBlackboard" value="${esc(
          typeof svc.service === "string" ? svc.service : "",
        )}">`,
      ),
      this.fieldRow(
        "Interval",
        `<input type="number" step="0.1" min="0" data-bte-svc-f="interval" class="bte-input" placeholder="default" value="${esc(
          typeof svc.interval === "number" ? String(svc.interval) : "",
        )}">`,
      ),
    ];
    if (paramCount > 0) {
      rows.push(
        `<div class="bte-form-hint">${paramCount} parametre; Asset JSON bölmesinde düzenleyin.</div>`,
      );
    }
    return `
      <div class="bte-card" data-bte-svc-index="${index}">
        <div class="bte-card-head">
          <span class="bte-card-title">service</span>
          <button type="button" data-bte-svc-remove class="bte-btn bte-btn-sm" title="Remove service">✕</button>
        </div>
        <div class="bte-card-fields">${rows.join("")}</div>
      </div>`;
  }

  private bindServiceSection(): void {
    this.formHost
      .querySelector<HTMLButtonElement>("[data-bte-add-svc]")
      ?.addEventListener("click", () => this.addService());

    this.formHost.querySelectorAll<HTMLElement>("[data-bte-svc-index]").forEach((card) => {
      const index = Number(card.dataset.bteSvcIndex);
      card
        .querySelector<HTMLButtonElement>("[data-bte-svc-remove]")
        ?.addEventListener("click", () => this.removeService(index));
      card.querySelectorAll<HTMLInputElement>("[data-bte-svc-f]").forEach((ctrl) => {
        ctrl.addEventListener("change", () =>
          this.setServiceField(index, ctrl.dataset.bteSvcF ?? "", ctrl.value),
        );
      });
    });
  }

  /** Runs `fn` on the selected node's service array, dropping it when it empties. */
  private mutateServices(fn: (list: unknown[]) => void): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveNode(asset.root, path);
      if (!node) return undefined;
      const list = Array.isArray(node.services) ? (node.services as unknown[]) : [];
      fn(list);
      if (list.length > 0) node.services = list;
      else delete node.services;
      return path;
    });
  }

  private addService(): void {
    this.mutateServices((list) => list.push({ service: "forge.updatePerceptionBlackboard" }));
  }

  private removeService(index: number): void {
    this.mutateServices((list) => {
      if (index >= 0 && index < list.length) list.splice(index, 1);
    });
  }

  private setServiceField(index: number, field: string, rawValue: string): void {
    this.mutateServices((list) => {
      const svc = list[index];
      if (!isObj(svc)) return;
      if (field === "service") {
        svc.service = rawValue.trim();
      } else if (field === "interval") {
        if (rawValue.trim().length === 0) {
          delete svc.interval;
        } else {
          const parsed = Number(rawValue);
          if (Number.isFinite(parsed)) svc.interval = parsed;
        }
      }
    });
  }

  /**
   * Parses the raw pane, deep-clones it, hands the selected node (and the whole
   * asset) to `fn`, then re-serializes the clone back into the raw pane. `fn`
   * returns the new selection path (or null). Returning `undefined` aborts with
   * no change. Structured edits reuse the raw JSON as the single source of truth.
   */
  private mutateTree(
    fn: (asset: Record<string, unknown>) => number[] | null | undefined,
  ): void {
    let value: unknown;
    try {
      value = JSON.parse(this.raw);
    } catch {
      this.setStatus("Fix the JSON before editing nodes.", "error");
      return;
    }
    if (!isObj(value) || !isObj(value.root)) {
      this.setStatus("Add a valid root node first.", "warning");
      return;
    }
    const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    const nextSelection = fn(clone);
    if (nextSelection === undefined) return;
    this.selectedPath = nextSelection;
    this.raw = `${JSON.stringify(clone, null, 2)}\n`;
    this.rawEl.value = this.raw;
    this.markDirty();
    this.renderDerived();
  }

  private applyStringField(key: "id" | "task" | "behavior", value: string, removeWhenEmpty: boolean): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveNode(asset.root, path);
      if (!node) return undefined;
      if (removeWhenEmpty && value.length === 0) {
        delete node[key];
      } else {
        node[key] = value;
      }
      return path;
    });
  }

  private applySecondsField(rawValue: string): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      this.setStatus("Seconds must be a number.", "warning");
      return;
    }
    this.mutateTree((asset) => {
      const node = resolveNode(asset.root, path);
      if (!node) return undefined;
      node.seconds = parsed;
      return path;
    });
  }

  private applyKind(kind: AiBehaviorNodeKind): void {
    if (this.selectedPath === null || !NODE_KINDS.includes(kind)) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveNode(asset.root, path);
      if (!node) return undefined;
      const converted = convertNode(node, kind);
      if (path.length === 0) {
        asset.root = converted;
      } else {
        const parent = resolveParent(asset.root, path);
        if (!parent) return undefined;
        parent.children[parent.index] = converted;
      }
      return path;
    });
  }

  private addChild(kind: AiBehaviorNodeKind): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveNode(asset.root, path);
      if (!isComposite(node)) {
        this.setStatus("Only selector/sequence nodes take children.", "warning");
        return undefined;
      }
      if (!Array.isArray(node!.children)) node!.children = [];
      const children = node!.children as unknown[];
      children.push(defaultNode(NODE_KINDS.includes(kind) ? kind : "task"));
      return [...path, children.length - 1];
    });
  }

  private removeSelected(): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    if (path.length === 0) {
      this.setStatus("Cannot remove the root node.", "warning");
      return;
    }
    this.mutateTree((asset) => {
      const parent = resolveParent(asset.root, path);
      if (!parent) return undefined;
      parent.children.splice(parent.index, 1);
      // Select the parent so focus stays near the removed node.
      return path.slice(0, -1);
    });
  }

  private moveSelected(direction: -1 | 1): void {
    if (this.selectedPath === null || this.selectedPath.length === 0) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const parent = resolveParent(asset.root, path);
      if (!parent) return undefined;
      const target = parent.index + direction;
      if (target < 0 || target >= parent.children.length) return undefined;
      const [moved] = parent.children.splice(parent.index, 1);
      parent.children.splice(target, 0, moved);
      return [...path.slice(0, -1), target];
    });
  }

  // --- Validation + save ---------------------------------------------------

  private renderValidation(state: ParseState): void {
    if (state.valid) {
      this.validationHost.innerHTML = `<span class="bte-ok">✓ Valid behavior tree</span>`;
    } else {
      this.validationHost.innerHTML = `<div class="bte-issue">⚠ ${esc(state.error)}</div>`;
    }
  }

  private async save(): Promise<void> {
    const state = this.parse();
    if (!state.valid) {
      this.setStatus(`Cannot save: ${state.error}`, "error");
      return;
    }
    try {
      this.setStatus("Saving…");
      await saveBehaviorTreeAsset(this.options.path, state.value);
      this.saveBtn.classList.remove("is-dirty");
      this.setStatus("Saved.", "success");
      this.options.onSaved?.();
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private setStatus(message: string, tone?: StatusTone): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone ?? "";
    this.options.onStatus?.(message, tone);
  }

  private markDirty(): void {
    this.saveBtn.classList.add("is-dirty");
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.overlay.remove();
    if (BehaviorTreeEditor.activeInstance === this) BehaviorTreeEditor.activeInstance = null;
  }
}
