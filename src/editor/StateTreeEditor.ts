/**
 * StateTree editor (v1 + form CRUD) — Forge's authoring shell for
 * `*.stateTree.json` assets, opened from the Content Browser (double-click /
 * "Open").
 *
 * Mirrors the Behavior Tree editor: the raw JSON stays the single source of truth
 * (it is the save payload and what every view derives from), and each edit —
 * typed JSON *or* a structured form action — is parsed + run through the engine
 * normalizer (`normalizeAiStateTreeAsset`), the same validator the dev
 * `/__save-state-tree` endpoint uses, so the outline, transition table, node form
 * and validation panel always reflect what would be saved.
 *
 * Views + authoring:
 *   - a **nested state outline** (hierarchical, selectable states with each
 *     state's enter conditions, task/transition/child badges), and
 *   - a **transition table** flattening every state's outgoing transitions into
 *     `from → to` rows tagged with their event / guard-condition summary, and
 *   - a **State Details form** for the selected state: id, add-child/remove/
 *     reorder, **enter conditions**, **tasks** (task name + params-count hint)
 *     and **transitions** (target state dropdown + event + guard conditions).
 *
 * Structured edits mutate a clone of the parsed asset and re-serialize it back
 * into the raw pane, so there is no second save surface. Task `params` remain
 * raw-JSON edits (surfaced as count hints); enter/transition guards are authored
 * with the same condition shape used by Behavior Tree decorators.
 */

import type {
  AiDecoratorOp,
  AiNumericCompareOp,
  AiPerceptionSenseName,
} from "@engine/ai/behaviorAsset";
import type { AiStateDef, AiStateTransitionDef } from "@engine/ai/stateTreeAsset";
import { normalizeAiStateTreeAsset } from "@engine/ai/stateTreeAsset";
import {
  defaultStateTreeJson,
  loadStateTreeText,
  saveStateTreeAsset,
} from "@/editor/stateTreeStore";

type StatusTone = "info" | "success" | "warning" | "error";

export interface StateTreeEditorOptions {
  path: string;
  label: string;
  onStatus?: (message: string, tone?: StatusTone) => void;
  onSaved?: () => void;
}

type AiConditionKind = "blackboard" | "distance" | "cooldown" | "hasPerceptionStimulus";

const CONDITION_KINDS: readonly AiConditionKind[] = [
  "blackboard",
  "distance",
  "cooldown",
  "hasPerceptionStimulus",
];

const CONDITION_KIND_LABELS: Record<AiConditionKind, string> = {
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

/** A fresh guard condition of `kind`, seeded so the StateTree stays valid. */
function defaultCondition(kind: AiConditionKind, key: string): Record<string, unknown> {
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

/** Blackboard condition values are text fields but should round-trip JSON values. */
function conditionValueText(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

function parseConditionValueText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function applyConditionField(condition: Record<string, unknown>, field: string, rawValue: string): void {
  switch (field) {
    case "key":
      condition.key = rawValue.trim();
      break;
    case "op":
      condition.op = rawValue;
      break;
    case "value":
      if (condition.kind === "distance") {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed)) condition.value = parsed;
      } else if (rawValue.trim().length === 0) {
        delete condition.value;
      } else {
        condition.value = parseConditionValueText(rawValue.trim());
      }
      break;
    case "seconds": {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) condition.seconds = parsed;
      break;
    }
    case "sense":
      if (rawValue.length === 0) delete condition.sense;
      else condition.sense = rawValue;
      break;
    case "minStrength":
      if (rawValue.trim().length === 0) {
        delete condition.minStrength;
      } else {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed)) condition.minStrength = parsed;
      }
      break;
    case "requireLineOfSight":
      if (rawValue.length === 0) delete condition.requireLineOfSight;
      else condition.requireLineOfSight = rawValue === "true";
      break;
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

/** Compact one-line summary of a decorator/guard condition for chips + the table. */
function conditionLabel(raw: unknown): string {
  if (!isObj(raw)) return "condition";
  const kind = typeof raw.kind === "string" ? raw.kind : "?";
  switch (kind) {
    case "blackboard":
      return `${String(raw.key ?? "?")} ${String(raw.op ?? "")} ${
        raw.value === undefined ? "" : JSON.stringify(raw.value)
      }`.trim();
    case "distance":
      return `dist ${String(raw.key ?? "?")} ${String(raw.op ?? "")} ${String(raw.value ?? "?")}`;
    case "cooldown":
      return `cooldown ${String(raw.seconds ?? "?")}s`;
    case "hasPerceptionStimulus":
      return `sense ${String(raw.sense ?? "any")}`;
    default:
      return kind;
  }
}

function conditionsSummary(conditions: unknown): string {
  if (!Array.isArray(conditions) || conditions.length === 0) return "";
  return conditions.map(conditionLabel).join(" & ");
}

/** Serializes a state path (child indices from the top-level states array). */
function pathParam(path: readonly number[]): string {
  return path.join(".");
}

/** Parses a `data-ste-path` attribute back into a state path. */
function parsePathParam(value: string | null | undefined): number[] {
  if (!value) return [];
  return value.split(".").map((entry) => Number(entry));
}

function pathEq(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/** Walks the nested `states` arrays to the state at `path`, or null when stale. */
function resolveState(root: unknown, path: readonly number[]): Record<string, unknown> | null {
  if (path.length === 0) return null;
  let list: unknown = isObj(root) ? root.states : null;
  let node: Record<string, unknown> | null = null;
  for (const index of path) {
    if (!Array.isArray(list) || index < 0 || index >= list.length) return null;
    const candidate = list[index];
    if (!isObj(candidate)) return null;
    node = candidate;
    list = candidate.states;
  }
  return node;
}

interface StateParent {
  /** The states array containing the target (root uses `asset.states`). */
  readonly list: unknown[];
  readonly index: number;
}

/** Resolves the array + sibling index holding `path`, or null when stale. */
function resolveStateParent(root: unknown, path: readonly number[]): StateParent | null {
  if (!isObj(root) || path.length === 0) return null;
  let list: unknown = root.states;
  for (let i = 0; i < path.length - 1; i += 1) {
    const index = path[i] ?? -1;
    if (!Array.isArray(list) || index < 0 || index >= list.length) return null;
    const candidate = list[index];
    if (!isObj(candidate)) return null;
    list = candidate.states;
  }
  const index = path[path.length - 1] ?? -1;
  if (!Array.isArray(list) || index < 0 || index >= list.length) return null;
  return { list, index };
}

/** Collects every state id in the tree (for transition target dropdowns + unique ids). */
function collectStateIds(states: unknown): string[] {
  const ids: string[] = [];
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!isObj(raw)) continue;
      if (typeof raw.id === "string" && raw.id.length > 0) ids.push(raw.id);
      walk(raw.states);
    }
  };
  walk(states);
  return ids;
}

/** A fresh unique state id ("State", "State2", …) not colliding with existing ones. */
function uniqueStateId(existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has("State")) return "State";
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `State${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `State${Date.now()}`;
}

/** Result of parsing + validating the raw JSON pane. */
interface ParseState {
  value: unknown;
  states: unknown[] | null;
  error: string;
  valid: boolean;
}

interface FlatTransition {
  readonly from: string;
  readonly transition: AiStateTransitionDef & Record<string, unknown>;
}

export class StateTreeEditor {
  private static activeInstance: StateTreeEditor | null = null;

  static async open(options: StateTreeEditorOptions): Promise<StateTreeEditor> {
    StateTreeEditor.activeInstance?.close();
    const editor = new StateTreeEditor(options);
    StateTreeEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly outlineHost: HTMLElement;
  private readonly tableHost: HTMLElement;
  private readonly validationHost: HTMLElement;
  private readonly formHost: HTMLElement;
  private readonly rawEl: HTMLTextAreaElement;
  private readonly statusEl: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;

  private raw = defaultStateTreeJson();
  /** Selected state path (child indices from the top-level states array). */
  private selectedPath: number[] | null = null;
  private disposed = false;

  private constructor(private readonly options: StateTreeEditorOptions) {
    this.overlay = document.createElement("div");
    this.overlay.className = "ste-overlay";
    this.overlay.innerHTML = `
<div class="ste-window">
  <header class="ste-header">
    <span class="ste-tab">
      <span class="ste-tab-icon">AI</span>
      <strong data-ste-title></strong>
      <span class="ste-badge">State Tree</span>
    </span>
    <div class="ste-header-actions">
      <button type="button" class="ste-save" data-ste-save title="Save (Ctrl+S)">Save</button>
      <button type="button" class="ste-close" data-ste-close title="Close (Esc)">×</button>
    </div>
  </header>
  <div class="ste-body">
    <aside class="ste-left">
      <div class="ste-section-title ste-outline-head">
        <span>State Outline</span>
        <button type="button" class="ste-btn ste-btn-sm" data-ste-add-root title="Üst düzey state ekle">+ State</button>
      </div>
      <div class="ste-outline" data-ste-outline></div>
      <div class="ste-section-title">Transitions</div>
      <div class="ste-table" data-ste-table></div>
      <div class="ste-section-title">Validation</div>
      <div class="ste-validation" data-ste-validation></div>
    </aside>
    <div class="ste-right">
      <div class="ste-section-title">State Details</div>
      <div class="ste-form" data-ste-form></div>
      <div class="ste-section-title">Asset JSON</div>
      <textarea class="ste-raw" data-ste-raw spellcheck="false"></textarea>
    </div>
  </div>
  <footer class="ste-status" data-ste-status>Loading…</footer>
</div>`;
    document.body.append(this.overlay);

    this.titleEl = this.req("[data-ste-title]");
    this.outlineHost = this.req("[data-ste-outline]");
    this.tableHost = this.req("[data-ste-table]");
    this.validationHost = this.req("[data-ste-validation]");
    this.formHost = this.req("[data-ste-form]");
    this.rawEl = this.req<HTMLTextAreaElement>("[data-ste-raw]");
    this.statusEl = this.req("[data-ste-status]");
    this.saveBtn = this.req<HTMLButtonElement>("[data-ste-save]");

    this.titleEl.textContent = options.label;
    this.req<HTMLButtonElement>("[data-ste-close]").addEventListener("click", () => this.close());
    this.saveBtn.addEventListener("click", () => void this.save());
    this.req<HTMLButtonElement>("[data-ste-add-root]").addEventListener("click", () => this.addRootState());
    this.rawEl.addEventListener("input", () => {
      this.raw = this.rawEl.value;
      this.markDirty();
      this.renderDerived();
    });

    // Delegated outline selection: clicking a state row selects that state.
    this.outlineHost.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const li = target?.closest<HTMLElement>(".ste-node[data-ste-path]");
      if (!li) return;
      this.selectedPath = parsePathParam(li.dataset.stePath);
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
    if (!el) throw new Error(`StateTreeEditor: missing ${selector}`);
    return el;
  }

  private async load(): Promise<void> {
    try {
      this.raw = await loadStateTreeText(this.options.path);
      this.rawEl.value = this.raw;
      this.saveBtn.classList.remove("is-dirty");
      // Select the first state by default so the form is populated on open.
      this.selectedPath = [0];
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
      return { value: null, states: null, error: `Invalid JSON: ${describeError(error)}`, valid: false };
    }
    const rawStates = (value as { states?: unknown } | null)?.states;
    const states = Array.isArray(rawStates) ? rawStates : null;
    try {
      normalizeAiStateTreeAsset(value);
      return { value, states, error: "", valid: true };
    } catch (error) {
      return { value, states, error: describeError(error), valid: false };
    }
  }

  private renderDerived(): void {
    if (this.disposed) return;
    const state = this.parse();
    // Drop a stale selection (e.g. the raw JSON shrank the tree), but keep it
    // through transient unparseable edits so it returns once the JSON is fixed.
    if (this.selectedPath && state.value !== null && !resolveState(state.value, this.selectedPath)) {
      this.selectedPath = null;
    }
    this.renderOutline(state);
    this.renderTable(state);
    this.renderNodeForm(state);
    this.renderValidation(state);
  }

  // --- State outline -------------------------------------------------------

  private renderOutline(state: ParseState): void {
    if (state.value === null) {
      this.outlineHost.innerHTML = `<div class="ste-empty">State'leri görmek için JSON'u düzeltin.</div>`;
      return;
    }
    if (!state.states || state.states.length === 0) {
      this.outlineHost.innerHTML = `<div class="ste-empty">No <code>states</code> — use <strong>+ State</strong>.</div>`;
      return;
    }
    this.outlineHost.innerHTML = `<ul class="ste-tree">${state.states
      .map((s, index) => this.stateHtml(s, [index]))
      .join("")}</ul>`;
  }

  /** Lenient recursive outline: renders whatever state shape is present. */
  private stateHtml(raw: unknown, path: number[]): string {
    const selected = this.selectedPath !== null && pathEq(path, this.selectedPath);
    if (!isObj(raw)) {
      return `<li class="ste-node" data-ste-path="${pathParam(path)}"><div class="ste-node-row${
        selected ? " is-selected" : ""
      }"><span class="ste-node-bad">malformed state</span></div></li>`;
    }
    const state = raw as Partial<AiStateDef> & Record<string, unknown>;
    const id = typeof state.id === "string" ? state.id : "?";
    const meta = this.stateMeta(state);
    const children = Array.isArray(state.states) ? state.states : [];
    const childHtml = children.length
      ? `<ul class="ste-tree">${children
          .map((child, index) => this.stateHtml(child, [...path, index]))
          .join("")}</ul>`
      : "";
    return `
      <li class="ste-node" data-ste-path="${pathParam(path)}">
        <div class="ste-node-row${selected ? " is-selected" : ""}">
          <span class="ste-node-id">${esc(id)}</span>
          ${meta}
        </div>
        ${this.enterChips(state.enter)}
        ${childHtml}
      </li>`;
  }

  /** Count badges (tasks / transitions / children) shown next to a state id. */
  private stateMeta(state: Record<string, unknown>): string {
    const badges: string[] = [];
    const tasks = Array.isArray(state.tasks) ? state.tasks.length : 0;
    const transitions = Array.isArray(state.transitions) ? state.transitions.length : 0;
    const children = Array.isArray(state.states) ? state.states.length : 0;
    if (tasks > 0) badges.push(`<span class="ste-badge-sm ste-badge-task">${tasks} task${tasks === 1 ? "" : "s"}</span>`);
    if (transitions > 0) {
      badges.push(`<span class="ste-badge-sm ste-badge-trans">${transitions} →</span>`);
    }
    if (children > 0) badges.push(`<span class="ste-badge-sm ste-badge-child">${children} child</span>`);
    return badges.join("");
  }

  /** Enter-condition chips under a state row (when present). */
  private enterChips(enter: unknown): string {
    if (!Array.isArray(enter) || enter.length === 0) return "";
    const chips = enter
      .map((c) => `<span class="ste-chip ste-chip-enter">if ${esc(conditionLabel(c))}</span>`)
      .join("");
    return `<div class="ste-node-meta">${chips}</div>`;
  }

  // --- Transition table ----------------------------------------------------

  private renderTable(state: ParseState): void {
    if (state.value === null) {
      this.tableHost.innerHTML = "";
      return;
    }
    const rows = this.flattenTransitions(state.states);
    if (rows.length === 0) {
      this.tableHost.innerHTML = `<div class="ste-empty">Transition yok.</div>`;
      return;
    }
    const body = rows
      .map((row) => {
        const t = row.transition;
        const to = typeof t.to === "string" ? t.to : "?";
        const event = typeof t.event === "string" ? t.event : "";
        const cond = conditionsSummary(t.conditions);
        const trigger = event
          ? `<span class="ste-chip ste-chip-event">event ${esc(event)}</span>`
          : cond
            ? `<span class="ste-cond">${esc(cond)}</span>`
            : `<span class="ste-cond ste-cond-always">always</span>`;
        return `<tr>
          <td class="ste-td-from">${esc(row.from)}</td>
          <td class="ste-td-arrow">→</td>
          <td class="ste-td-to">${esc(to)}</td>
          <td class="ste-td-trigger">${trigger}</td>
        </tr>`;
      })
      .join("");
    this.tableHost.innerHTML = `<table class="ste-trans-table"><tbody>${body}</tbody></table>`;
  }

  /** Depth-first walk collecting every state's outgoing transitions. */
  private flattenTransitions(states: unknown[] | null): FlatTransition[] {
    const out: FlatTransition[] = [];
    const walk = (list: unknown[]): void => {
      for (const raw of list) {
        if (!isObj(raw)) continue;
        const from = typeof raw.id === "string" ? raw.id : "?";
        if (Array.isArray(raw.transitions)) {
          for (const t of raw.transitions) {
            if (isObj(t)) out.push({ from, transition: t as FlatTransition["transition"] });
          }
        }
        if (Array.isArray(raw.states)) walk(raw.states);
      }
    };
    if (states) walk(states);
    return out;
  }

  // --- State details form --------------------------------------------------

  private renderNodeForm(state: ParseState): void {
    if (!isObj(state.value) || !Array.isArray(state.states)) {
      this.formHost.innerHTML = `<div class="ste-form-empty">State'leri düzenlemek için geçerli bir <code>states</code> dizisi ekleyin.</div>`;
      return;
    }
    if (this.selectedPath === null) {
      this.formHost.innerHTML = `<div class="ste-form-empty">Düzenlemek için ana hattan bir state seçin.</div>`;
      return;
    }
    const node = resolveState(state.value, this.selectedPath);
    if (!node) {
      this.formHost.innerHTML = `<div class="ste-form-empty">Düzenlemek için ana hattan bir state seçin.</div>`;
      return;
    }

    const parent = resolveStateParent(state.value, this.selectedPath);
    const canUp = !!parent && parent.index > 0;
    const canDown = !!parent && parent.index < parent.list.length - 1;
    const stateIds = collectStateIds(state.states);

    this.formHost.innerHTML = `
      <div class="ste-form-toolbar">
        <button type="button" data-ste-add-child class="ste-btn" title="Alt state ekle">+ Child State</button>
        <button type="button" data-ste-remove class="ste-btn" title="Bu state'i kaldır">Remove</button>
        <button type="button" data-ste-up class="ste-btn"${canUp ? "" : " disabled"} title="Kardeşler arasında yukarı taşı">↑</button>
        <button type="button" data-ste-down class="ste-btn"${canDown ? "" : " disabled"} title="Kardeşler arasında aşağı taşı">↓</button>
      </div>
      <div class="ste-form-fields">
        <label class="ste-form-row">
          <span class="ste-form-label">Id</span>
          <input type="text" data-ste-field="id" class="ste-input" value="${esc(
            typeof node.id === "string" ? node.id : "",
          )}">
        </label>
      </div>
      ${this.enterSectionHtml(node)}
      ${this.tasksSectionHtml(node)}
      ${this.transitionsSectionHtml(node, stateIds)}`;

    this.bindNodeForm();
  }

  private enterSectionHtml(node: Record<string, unknown>): string {
    const enter = Array.isArray(node.enter) ? node.enter : [];
    const cards = enter.map((condition, index) => this.conditionCardHtml("enter", condition, index)).join("");
    const addOptions = CONDITION_KINDS.map(
      (k) => `<option value="${k}">${CONDITION_KIND_LABELS[k]}</option>`,
    ).join("");
    return `
      <div class="ste-section-sub">Enter Conditions</div>
      <div class="ste-cards" data-ste-enter-cond-list>${
        cards || `<div class="ste-form-empty">Enter condition yok.</div>`
      }</div>
      <div class="ste-form-add">
        <select data-ste-add-enter-cond-kind class="ste-input ste-input-sm">${addOptions}</select>
        <button type="button" data-ste-add-enter-cond class="ste-btn" title="Giriş koşulu (enter condition) ekle">+ Condition</button>
      </div>`;
  }

  private transitionConditionsHtml(trans: Record<string, unknown>): string {
    const conditions = Array.isArray(trans.conditions) ? trans.conditions : [];
    const cards = conditions
      .map((condition, index) => this.conditionCardHtml("transition", condition, index))
      .join("");
    const addOptions = CONDITION_KINDS.map(
      (k) => `<option value="${k}">${CONDITION_KIND_LABELS[k]}</option>`,
    ).join("");
    return `
      <div class="ste-card-subtitle">Guard Conditions</div>
      <div class="ste-cards" data-ste-trans-cond-list>${
        cards || `<div class="ste-form-empty">Guard condition yok.</div>`
      }</div>
      <div class="ste-form-add">
        <select data-ste-add-trans-cond-kind class="ste-input ste-input-sm">${addOptions}</select>
        <button type="button" data-ste-add-trans-cond class="ste-btn" title="Koruma koşulu (guard condition) ekle">+ Condition</button>
      </div>`;
  }

  private conditionCardHtml(scope: "enter" | "transition", raw: unknown, index: number): string {
    const condition = isObj(raw) ? raw : {};
    const kind = (typeof condition.kind === "string" ? condition.kind : "blackboard") as AiConditionKind;
    const kindOptions = CONDITION_KINDS.map(
      (k) => `<option value="${k}"${k === kind ? " selected" : ""}>${CONDITION_KIND_LABELS[k]}</option>`,
    ).join("");
    const indexAttr = scope === "enter" ? "data-ste-enter-cond-index" : "data-ste-trans-cond-index";
    const kindAttr = scope === "enter" ? "data-ste-enter-cond-kind" : "data-ste-trans-cond-kind";
    const removeAttr = scope === "enter" ? "data-ste-enter-cond-remove" : "data-ste-trans-cond-remove";
    const fieldAttr = scope === "enter" ? "data-ste-enter-cond-f" : "data-ste-trans-cond-f";
    return `
      <div class="ste-cond-card" ${indexAttr}="${index}">
        <div class="ste-card-head">
          <select ${kindAttr} class="ste-input ste-input-sm">${kindOptions}</select>
          <button type="button" ${removeAttr} class="ste-btn ste-btn-sm" title="Remove condition">x</button>
        </div>
        <div class="ste-card-fields">${this.conditionFieldsHtml(kind, condition, fieldAttr)}</div>
      </div>`;
  }

  private conditionFieldsHtml(
    kind: AiConditionKind,
    condition: Record<string, unknown>,
    fieldAttr: string,
  ): string {
    const rows: string[] = [];
    if (kind === "blackboard" || kind === "distance") {
      rows.push(
        this.formRow(
          "Key",
          `<input type="text" ${fieldAttr}="key" class="ste-input" placeholder="target" value="${esc(
            typeof condition.key === "string" ? condition.key : "",
          )}">`,
        ),
      );
      const ops = kind === "blackboard" ? BLACKBOARD_OPS : DISTANCE_OPS;
      const current = typeof condition.op === "string" ? condition.op : ops[0];
      const opOptions = ops
        .map((op) => `<option value="${op}"${op === current ? " selected" : ""}>${op}</option>`)
        .join("");
      rows.push(this.formRow("Op", `<select ${fieldAttr}="op" class="ste-input">${opOptions}</select>`));
    }
    if (kind === "distance") {
      rows.push(
        this.formRow(
          "Value",
          `<input type="number" step="0.1" ${fieldAttr}="value" class="ste-input" value="${esc(
            typeof condition.value === "number" ? String(condition.value) : "0",
          )}">`,
        ),
      );
    } else if (kind === "blackboard" && (condition.op === "equals" || condition.op === "notEquals")) {
      rows.push(
        this.formRow(
          "Value",
          `<input type="text" ${fieldAttr}="value" class="ste-input" placeholder="true / 42 / &quot;text&quot;" value="${esc(
            conditionValueText(condition.value),
          )}">`,
        ),
      );
    }
    if (kind === "cooldown") {
      rows.push(
        this.formRow(
          "Seconds",
          `<input type="number" step="0.1" min="0" ${fieldAttr}="seconds" class="ste-input" value="${esc(
            typeof condition.seconds === "number" ? String(condition.seconds) : "1",
          )}">`,
        ),
      );
    }
    if (kind === "hasPerceptionStimulus") {
      const sense = typeof condition.sense === "string" ? condition.sense : "";
      const senseOptions = [`<option value=""${sense === "" ? " selected" : ""}>any</option>`]
        .concat(PERCEPTION_SENSES.map((s) => `<option value="${s}"${s === sense ? " selected" : ""}>${s}</option>`))
        .join("");
      rows.push(this.formRow("Sense", `<select ${fieldAttr}="sense" class="ste-input">${senseOptions}</select>`));
      rows.push(
        this.formRow(
          "Min strength",
          `<input type="number" step="0.1" ${fieldAttr}="minStrength" class="ste-input" placeholder="any" value="${esc(
            typeof condition.minStrength === "number" ? String(condition.minStrength) : "",
          )}">`,
        ),
      );
      const los = condition.requireLineOfSight;
      const losValue = typeof los === "boolean" ? String(los) : "";
      const losOptions = [
        `<option value=""${losValue === "" ? " selected" : ""}>ignore</option>`,
        `<option value="true"${losValue === "true" ? " selected" : ""}>require</option>`,
        `<option value="false"${losValue === "false" ? " selected" : ""}>forbid</option>`,
      ].join("");
      rows.push(
        this.formRow(
          "Line of sight",
          `<select ${fieldAttr}="requireLineOfSight" class="ste-input">${losOptions}</select>`,
        ),
      );
    }
    return rows.join("");
  }

  private formRow(label: string, control: string): string {
    return `<label class="ste-form-row"><span class="ste-form-label">${esc(label)}</span>${control}</label>`;
  }

  private tasksSectionHtml(node: Record<string, unknown>): string {
    const tasks = Array.isArray(node.tasks) ? node.tasks : [];
    const cards = tasks.map((task, index) => this.taskCardHtml(task, index)).join("");
    return `
      <div class="ste-section-sub">Tasks</div>
      <div class="ste-cards" data-ste-task-list>${cards || `<div class="ste-form-empty">Task yok.</div>`}</div>
      <div class="ste-form-add">
        <button type="button" data-ste-add-task class="ste-btn" title="Task ekle">+ Task</button>
      </div>`;
  }

  private taskCardHtml(raw: unknown, index: number): string {
    const task = isObj(raw) ? raw : {};
    const paramCount = isObj(task.params) ? Object.keys(task.params).length : 0;
    const hint = paramCount > 0
      ? `<div class="ste-form-hint">${paramCount} parametre; Asset JSON bölmesinde düzenleyin.</div>`
      : "";
    return `
      <div class="ste-card" data-ste-task-index="${index}">
        <div class="ste-card-head">
          <span class="ste-card-title">task</span>
          <button type="button" data-ste-task-remove class="ste-btn ste-btn-sm" title="Remove task">✕</button>
        </div>
        <div class="ste-card-fields">
          <label class="ste-form-row">
            <span class="ste-form-label">Task</span>
            <input type="text" data-ste-task-name class="ste-input" placeholder="forge.wait" value="${esc(
              typeof task.task === "string" ? task.task : "",
            )}">
          </label>
          ${hint}
        </div>
      </div>`;
  }

  private transitionsSectionHtml(node: Record<string, unknown>, stateIds: readonly string[]): string {
    const transitions = Array.isArray(node.transitions) ? node.transitions : [];
    const cards = transitions
      .map((transition, index) => this.transitionCardHtml(transition, index, stateIds))
      .join("");
    return `
      <div class="ste-section-sub">Transitions</div>
      <div class="ste-cards" data-ste-trans-list>${
        cards || `<div class="ste-form-empty">Transition yok.</div>`
      }</div>
      <div class="ste-form-add">
        <button type="button" data-ste-add-trans class="ste-btn"${
          stateIds.length > 0 ? "" : " disabled"
        } title="Transition ekle">+ Transition</button>
      </div>`;
  }

  private transitionCardHtml(raw: unknown, index: number, stateIds: readonly string[]): string {
    const trans = isObj(raw) ? raw : {};
    const to = typeof trans.to === "string" ? trans.to : "";
    // Preserve an unknown/hand-typed target as an option so it never silently drops.
    const options = [...new Set([...(to ? [to] : []), ...stateIds])]
      .map((id) => `<option value="${esc(id)}"${id === to ? " selected" : ""}>${esc(id)}</option>`)
      .join("");
    return `
      <div class="ste-card" data-ste-trans-index="${index}">
        <div class="ste-card-head">
          <span class="ste-card-title">→ transition</span>
          <button type="button" data-ste-trans-remove class="ste-btn ste-btn-sm" title="Remove transition">✕</button>
        </div>
        <div class="ste-card-fields">
          <label class="ste-form-row">
            <span class="ste-form-label">To</span>
            <select data-ste-trans-f="to" class="ste-input">${options}</select>
          </label>
          <label class="ste-form-row">
            <span class="ste-form-label">Event</span>
            <input type="text" data-ste-trans-f="event" class="ste-input" placeholder="(optional)" value="${esc(
              typeof trans.event === "string" ? trans.event : "",
            )}">
          </label>
          ${this.transitionConditionsHtml(trans)}
        </div>
      </div>`;
  }

  private bindNodeForm(): void {
    const idInput = this.formHost.querySelector<HTMLInputElement>('[data-ste-field="id"]');
    idInput?.addEventListener("change", () => this.applyId(idInput.value.trim()));

    this.formHost
      .querySelector<HTMLButtonElement>("[data-ste-add-child]")
      ?.addEventListener("click", () => this.addChildState());
    this.formHost
      .querySelector<HTMLButtonElement>("[data-ste-remove]")
      ?.addEventListener("click", () => this.removeSelected());
    this.formHost
      .querySelector<HTMLButtonElement>("[data-ste-up]")
      ?.addEventListener("click", () => this.moveSelected(-1));
    this.formHost
      .querySelector<HTMLButtonElement>("[data-ste-down]")
      ?.addEventListener("click", () => this.moveSelected(1));

    const addEnterKind = this.formHost.querySelector<HTMLSelectElement>("[data-ste-add-enter-cond-kind]");
    this.formHost
      .querySelector<HTMLButtonElement>("[data-ste-add-enter-cond]")
      ?.addEventListener("click", () =>
        this.addEnterCondition((addEnterKind?.value as AiConditionKind) ?? "blackboard"),
      );
    this.formHost.querySelectorAll<HTMLElement>("[data-ste-enter-cond-index]").forEach((card) => {
      const index = Number(card.dataset.steEnterCondIndex);
      card
        .querySelector<HTMLSelectElement>("[data-ste-enter-cond-kind]")
        ?.addEventListener("change", (event) =>
          this.setEnterConditionKind(index, (event.target as HTMLSelectElement).value as AiConditionKind),
        );
      card
        .querySelector<HTMLButtonElement>("[data-ste-enter-cond-remove]")
        ?.addEventListener("click", () => this.removeEnterCondition(index));
      card.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-ste-enter-cond-f]").forEach((ctrl) => {
        ctrl.addEventListener("change", () =>
          this.setEnterConditionField(index, ctrl.dataset.steEnterCondF ?? "", ctrl.value),
        );
      });
    });

    this.formHost
      .querySelector<HTMLButtonElement>("[data-ste-add-task]")
      ?.addEventListener("click", () => this.addTask());
    this.formHost.querySelectorAll<HTMLElement>("[data-ste-task-index]").forEach((card) => {
      const index = Number(card.dataset.steTaskIndex);
      card
        .querySelector<HTMLButtonElement>("[data-ste-task-remove]")
        ?.addEventListener("click", () => this.removeTask(index));
      card
        .querySelector<HTMLInputElement>("[data-ste-task-name]")
        ?.addEventListener("change", (event) =>
          this.setTaskName(index, (event.target as HTMLInputElement).value.trim()),
        );
    });

    this.formHost
      .querySelector<HTMLButtonElement>("[data-ste-add-trans]")
      ?.addEventListener("click", () => this.addTransition());
    this.formHost.querySelectorAll<HTMLElement>("[data-ste-trans-index]").forEach((card) => {
      const index = Number(card.dataset.steTransIndex);
      card
        .querySelector<HTMLButtonElement>("[data-ste-trans-remove]")
        ?.addEventListener("click", () => this.removeTransition(index));
      card.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-ste-trans-f]").forEach((ctrl) => {
        ctrl.addEventListener("change", () =>
          this.setTransitionField(index, ctrl.dataset.steTransF ?? "", ctrl.value),
        );
      });
      const addCondKind = card.querySelector<HTMLSelectElement>("[data-ste-add-trans-cond-kind]");
      card
        .querySelector<HTMLButtonElement>("[data-ste-add-trans-cond]")
        ?.addEventListener("click", () =>
          this.addTransitionCondition(index, (addCondKind?.value as AiConditionKind) ?? "blackboard"),
        );
      card.querySelectorAll<HTMLElement>("[data-ste-trans-cond-index]").forEach((condCard) => {
        const condIndex = Number(condCard.dataset.steTransCondIndex);
        condCard
          .querySelector<HTMLSelectElement>("[data-ste-trans-cond-kind]")
          ?.addEventListener("change", (event) =>
            this.setTransitionConditionKind(
              index,
              condIndex,
              (event.target as HTMLSelectElement).value as AiConditionKind,
            ),
          );
        condCard
          .querySelector<HTMLButtonElement>("[data-ste-trans-cond-remove]")
          ?.addEventListener("click", () => this.removeTransitionCondition(index, condIndex));
        condCard.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-ste-trans-cond-f]").forEach((ctrl) => {
          ctrl.addEventListener("change", () =>
            this.setTransitionConditionField(index, condIndex, ctrl.dataset.steTransCondF ?? "", ctrl.value),
          );
        });
      });
    });
  }

  // --- Structured mutations ------------------------------------------------

  /**
   * Parses the raw pane, deep-clones it, hands the whole asset to `fn`, then
   * re-serializes the clone back into the raw pane. `fn` returns the new
   * selection path (or null); returning `undefined` aborts with no change.
   */
  private mutateTree(
    fn: (asset: Record<string, unknown>) => number[] | null | undefined,
  ): void {
    let value: unknown;
    try {
      value = JSON.parse(this.raw);
    } catch {
      this.setStatus("Fix the JSON before editing states.", "error");
      return;
    }
    if (!isObj(value) || !Array.isArray(value.states)) {
      this.setStatus("Add a valid states array first.", "warning");
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

  private applyId(value: string): void {
    if (this.selectedPath === null || value.length === 0) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveState(asset, path);
      if (!node) return undefined;
      node.id = value;
      return path;
    });
  }

  private addRootState(): void {
    this.mutateTree((asset) => {
      const list = asset.states as unknown[];
      list.push({ id: uniqueStateId(collectStateIds(asset.states)) });
      return [list.length - 1];
    });
  }

  private addChildState(): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveState(asset, path);
      if (!node) return undefined;
      if (!Array.isArray(node.states)) node.states = [];
      const children = node.states as unknown[];
      children.push({ id: uniqueStateId(collectStateIds(asset.states)) });
      return [...path, children.length - 1];
    });
  }

  private removeSelected(): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const parent = resolveStateParent(asset, path);
      if (!parent) return undefined;
      if (path.length === 1 && (asset.states as unknown[]).length <= 1) {
        this.setStatus("A state tree needs at least one top-level state.", "warning");
        return undefined;
      }
      parent.list.splice(parent.index, 1);
      // Select the previous sibling (or the parent) so focus stays nearby.
      if (parent.index > 0) return [...path.slice(0, -1), parent.index - 1];
      return path.length > 1 ? path.slice(0, -1) : parent.list.length > 0 ? [0] : null;
    });
  }

  private moveSelected(direction: -1 | 1): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const parent = resolveStateParent(asset, path);
      if (!parent) return undefined;
      const target = parent.index + direction;
      if (target < 0 || target >= parent.list.length) return undefined;
      const [moved] = parent.list.splice(parent.index, 1);
      parent.list.splice(target, 0, moved);
      return [...path.slice(0, -1), target];
    });
  }

  /** Runs `fn` on the selected state's enter conditions, dropping it when empty. */
  private mutateEnterConditions(fn: (list: unknown[]) => void): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveState(asset, path);
      if (!node) return undefined;
      const list = Array.isArray(node.enter) ? (node.enter as unknown[]) : [];
      fn(list);
      if (list.length > 0) node.enter = list;
      else delete node.enter;
      return path;
    });
  }

  private addEnterCondition(kind: AiConditionKind): void {
    if (!CONDITION_KINDS.includes(kind)) return;
    this.mutateEnterConditions((list) => list.push(defaultCondition(kind, "target")));
  }

  private removeEnterCondition(index: number): void {
    this.mutateEnterConditions((list) => {
      if (index >= 0 && index < list.length) list.splice(index, 1);
    });
  }

  private setEnterConditionKind(index: number, kind: AiConditionKind): void {
    if (!CONDITION_KINDS.includes(kind)) return;
    this.mutateEnterConditions((list) => {
      const prev = isObj(list[index]) ? (list[index] as Record<string, unknown>) : {};
      const key = typeof prev.key === "string" && prev.key.length > 0 ? prev.key : "target";
      list[index] = defaultCondition(kind, key);
    });
  }

  private setEnterConditionField(index: number, field: string, rawValue: string): void {
    this.mutateEnterConditions((list) => {
      const condition = list[index];
      if (isObj(condition)) applyConditionField(condition, field, rawValue);
    });
  }

  /** Runs `fn` on the selected state's array named `key`, dropping it when empty. */
  private mutateStateList(key: "tasks" | "transitions", fn: (list: unknown[]) => void): void {
    if (this.selectedPath === null) return;
    const path = this.selectedPath;
    this.mutateTree((asset) => {
      const node = resolveState(asset, path);
      if (!node) return undefined;
      const list = Array.isArray(node[key]) ? (node[key] as unknown[]) : [];
      fn(list);
      if (list.length > 0) node[key] = list;
      else delete node[key];
      return path;
    });
  }

  /** Runs `fn` on a transition's guard conditions, dropping it when empty. */
  private mutateTransitionConditions(transitionIndex: number, fn: (list: unknown[]) => void): void {
    this.mutateStateList("transitions", (transitions) => {
      const trans = transitions[transitionIndex];
      if (!isObj(trans)) return;
      const list = Array.isArray(trans.conditions) ? (trans.conditions as unknown[]) : [];
      fn(list);
      if (list.length > 0) trans.conditions = list;
      else delete trans.conditions;
    });
  }

  private addTransitionCondition(transitionIndex: number, kind: AiConditionKind): void {
    if (!CONDITION_KINDS.includes(kind)) return;
    this.mutateTransitionConditions(transitionIndex, (list) => list.push(defaultCondition(kind, "target")));
  }

  private removeTransitionCondition(transitionIndex: number, conditionIndex: number): void {
    this.mutateTransitionConditions(transitionIndex, (list) => {
      if (conditionIndex >= 0 && conditionIndex < list.length) list.splice(conditionIndex, 1);
    });
  }

  private setTransitionConditionKind(
    transitionIndex: number,
    conditionIndex: number,
    kind: AiConditionKind,
  ): void {
    if (!CONDITION_KINDS.includes(kind)) return;
    this.mutateTransitionConditions(transitionIndex, (list) => {
      const prev = isObj(list[conditionIndex]) ? (list[conditionIndex] as Record<string, unknown>) : {};
      const key = typeof prev.key === "string" && prev.key.length > 0 ? prev.key : "target";
      list[conditionIndex] = defaultCondition(kind, key);
    });
  }

  private setTransitionConditionField(
    transitionIndex: number,
    conditionIndex: number,
    field: string,
    rawValue: string,
  ): void {
    this.mutateTransitionConditions(transitionIndex, (list) => {
      const condition = list[conditionIndex];
      if (isObj(condition)) applyConditionField(condition, field, rawValue);
    });
  }

  private addTask(): void {
    this.mutateStateList("tasks", (list) => list.push({ task: "forge.wait" }));
  }

  private removeTask(index: number): void {
    this.mutateStateList("tasks", (list) => {
      if (index >= 0 && index < list.length) list.splice(index, 1);
    });
  }

  private setTaskName(index: number, name: string): void {
    this.mutateStateList("tasks", (list) => {
      const task = list[index];
      if (isObj(task)) task.task = name;
    });
  }

  private addTransition(): void {
    this.mutateTree((asset) => {
      if (this.selectedPath === null) return undefined;
      const node = resolveState(asset, this.selectedPath);
      if (!node) return undefined;
      const ids = collectStateIds(asset.states);
      const to = ids[0];
      if (!to) {
        this.setStatus("Add another state before adding a transition.", "warning");
        return undefined;
      }
      const list = Array.isArray(node.transitions) ? (node.transitions as unknown[]) : [];
      list.push({ to });
      node.transitions = list;
      return this.selectedPath;
    });
  }

  private removeTransition(index: number): void {
    this.mutateStateList("transitions", (list) => {
      if (index >= 0 && index < list.length) list.splice(index, 1);
    });
  }

  private setTransitionField(index: number, field: string, rawValue: string): void {
    this.mutateStateList("transitions", (list) => {
      const trans = list[index];
      if (!isObj(trans)) return;
      if (field === "to") {
        if (rawValue.length > 0) trans.to = rawValue;
      } else if (field === "event") {
        if (rawValue.trim().length === 0) delete trans.event;
        else trans.event = rawValue.trim();
      }
    });
  }

  // --- Validation + save ---------------------------------------------------

  private renderValidation(state: ParseState): void {
    if (state.valid) {
      this.validationHost.innerHTML = `<span class="ste-ok">✓ Valid state tree</span>`;
    } else {
      this.validationHost.innerHTML = `<div class="ste-issue">⚠ ${esc(state.error)}</div>`;
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
      await saveStateTreeAsset(this.options.path, state.value);
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
    if (StateTreeEditor.activeInstance === this) StateTreeEditor.activeInstance = null;
  }
}
