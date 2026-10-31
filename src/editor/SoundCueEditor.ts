/**
 * Sound Cue editor — Forge's node-graph authoring shell for `*.soundcue.json`
 * assets, opened from the Content Browser (double-click).
 *
 * Layout mirrors Unreal's Sound Cue Editor:
 *   - **Palette** (left) — click to add nodes to the graph.
 *   - **Graph canvas** (center) — nodes as positioned divs, connections as SVG
 *     bezier curves. Click a node to select it.
 *   - **Details** (right) — editable properties for the selected node plus an
 *     "Output to" connection picker.
 *   - **Toolbar** — Play Cue, Stop preview, Save, Close.
 *   - **Status bar** — validation feedback and save status.
 *
 * V1 node set: Output, Source, Mixer, Random, Modulator, Loop, Delay.
 */

import type {
  SoundCueAsset,
  SoundCueNode,
  SoundCueNodeKind,
} from "@engine/audio/soundCueTypes";
import { evaluateSoundCue, validateSoundCueGraph } from "@engine/audio/soundCueEvaluator";
import { loadSoundCueAsset, saveSoundCueAsset } from "@/editor/soundCueStore";
import { projectFileUrl } from "@/project/ProjectSystem";

type StatusTone = "info" | "success" | "warning" | "error";

export interface SoundCueAssetOption {
  id: string;
  name: string;
  assetType: string;
  path: string;
}

export interface SoundCueEditorOptions {
  path: string;
  label: string;
  assets?: readonly SoundCueAssetOption[];
  onStatus?: (message: string, tone?: StatusTone) => void;
  onSaved?: () => void;
}

// ─── Layout constants ──────────────────────────────────────────────────────

const NODE_W = 200;
const NODE_H = 70;
const COL_GAP = 110;
const ROW_GAP = 22;
const PAD = 32;

// ─── Node meta ─────────────────────────────────────────────────────────────

const NODE_LABELS: Record<SoundCueNodeKind, string> = {
  output: "Output",
  source: "Source",
  mixer: "Mixer",
  random: "Random",
  modulator: "Modulator",
  loop: "Loop",
  delay: "Delay",
};

const NODE_COLORS: Record<SoundCueNodeKind, string> = {
  output: "#5a9fd4",
  source: "#6fd0a4",
  mixer: "#d4a45a",
  random: "#c47dd4",
  modulator: "#d47a5a",
  loop: "#5ad4c4",
  delay: "#8a9ad4",
};

const ADDABLE_KINDS: SoundCueNodeKind[] = [
  "source",
  "mixer",
  "random",
  "modulator",
  "loop",
  "delay",
];

const BUS_IDS = ["master", "music", "sfx", "ui", "ambience"] as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

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

interface Pos { x: number; y: number; }

/** Column-based right-to-left auto-layout starting from the output node. */
function autoLayout(cue: SoundCueAsset): Map<string, Pos> {
  const incoming = new Map<string, string[]>();
  for (const { from, to } of cue.connections) {
    if (!incoming.has(to)) incoming.set(to, []);
    incoming.get(to)!.push(from);
  }

  const colOf = new Map<string, number>();
  const outputNode = cue.nodes.find((n) => n.kind === "output");
  if (outputNode) {
    const queue: string[] = [outputNode.id];
    colOf.set(outputNode.id, 0);
    for (let qi = 0; qi < queue.length; qi++) {
      const nid = queue[qi];
      if (!nid) continue;
      const col = colOf.get(nid) ?? 0;
      for (const src of incoming.get(nid) ?? []) {
        if (!colOf.has(src)) { colOf.set(src, col + 1); queue.push(src); }
      }
    }
  }
  const maxCol = Math.max(0, ...colOf.values(), 0);
  for (const n of cue.nodes) if (!colOf.has(n.id)) colOf.set(n.id, maxCol + 1);

  const rows = new Map<number, string[]>();
  for (const [id, col] of colOf) {
    if (!rows.has(col)) rows.set(col, []);
    rows.get(col)!.push(id);
  }
  const topCol = Math.max(0, ...rows.keys());

  const positions = new Map<string, Pos>();
  for (const [col, ids] of rows) {
    const x = PAD + (topCol - col) * (NODE_W + COL_GAP);
    for (let row = 0; row < ids.length; row++) {
      const nodeId = ids[row];
      if (!nodeId) continue;
      positions.set(nodeId, { x, y: PAD + row * (NODE_H + ROW_GAP) });
    }
  }
  return positions;
}

// ─── Editor class ──────────────────────────────────────────────────────────

export class SoundCueEditor {
  private static activeInstance: SoundCueEditor | null = null;

  static async open(options: SoundCueEditorOptions): Promise<SoundCueEditor> {
    SoundCueEditor.activeInstance?.close();
    const editor = new SoundCueEditor(options);
    SoundCueEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly graphHost: HTMLElement;
  private readonly svgEl: SVGSVGElement;
  private readonly paletteHost: HTMLElement;
  private readonly detailsHost: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;

  private cue: SoundCueAsset;
  private selectedId: string | null = null;
  private positions = new Map<string, Pos>();
  private idCounter = 0;
  private dirty = false;
  private disposed = false;

  /** Preview Web Audio context — lazily created, closed on dispose. */
  private previewCtx: AudioContext | null = null;
  private previewSources: AudioBufferSourceNode[] = [];
  private previewTimers: ReturnType<typeof setTimeout>[] = [];
  private previewBuffers = new Map<string, Promise<AudioBuffer | null>>();

  private constructor(private readonly options: SoundCueEditorOptions) {
    this.cue = {
      schema: 1,
      type: "soundCue",
      name: options.label,
      output: { volume: 1, pitch: 1, bus: "sfx" },
      nodes: [{ id: "output", kind: "output", volume: 1, pitch: 1 }],
      connections: [],
    };

    this.overlay = document.createElement("div");
    this.overlay.className = "sce-overlay";
    this.overlay.innerHTML = `
<div class="sce-window">
  <header class="sce-header">
    <span class="sce-tab">
      <span class="sce-tab-icon">SFX</span>
      <strong data-sce-title></strong>
      <span class="sce-badge">Sound Cue</span>
    </span>
    <div class="sce-toolbar">
      <button type="button" class="sce-tool-btn" data-sce-play title="Değerlendir ve önizle (dev sunucusu gerekir)">▶ Play Cue</button>
      <button type="button" class="sce-tool-btn" data-sce-stop title="Stop preview">■ Stop</button>
    </div>
    <div class="sce-header-actions">
      <button type="button" class="sce-save" data-sce-save title="Save (Ctrl+S)">Save</button>
      <button type="button" class="sce-close" data-sce-close title="Close (Esc)">×</button>
    </div>
  </header>
  <div class="sce-body">
    <aside class="sce-left">
      <div class="sce-section-title">Palette</div>
      <div class="sce-palette" data-sce-palette></div>
      <div class="sce-section-title">Validation</div>
      <div class="sce-validation" data-sce-validation></div>
    </aside>
    <div class="sce-graph-wrap">
      <div class="sce-graph-host" data-sce-graph>
        <svg class="sce-svg" data-sce-svg xmlns="http://www.w3.org/2000/svg"></svg>
      </div>
    </div>
    <aside class="sce-details" data-sce-details></aside>
  </div>
  <footer class="sce-status" data-sce-status>Loading…</footer>
</div>`;
    document.body.append(this.overlay);

    this.titleEl = this.req("[data-sce-title]");
    this.graphHost = this.req("[data-sce-graph]");
    this.svgEl = this.req<SVGSVGElement>("[data-sce-svg]");
    this.paletteHost = this.req("[data-sce-palette]");
    this.detailsHost = this.req("[data-sce-details]");
    this.statusEl = this.req("[data-sce-status]");
    this.saveBtn = this.req<HTMLButtonElement>("[data-sce-save]");

    this.req<HTMLButtonElement>("[data-sce-close]").addEventListener("click", () => this.close());
    this.saveBtn.addEventListener("click", () => void this.save());
    this.req<HTMLButtonElement>("[data-sce-play]").addEventListener("click", () => void this.preview());
    this.req<HTMLButtonElement>("[data-sce-stop]").addEventListener("click", () => this.stopPreview());

    this.overlay.tabIndex = -1;
    this.overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void this.save(); }
    });
    this.overlay.focus();
    this.renderPalette();
  }

  private req<T extends Element = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`SoundCueEditor: missing ${selector}`);
    return el;
  }

  // ─── Load ────────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    try {
      this.cue = await loadSoundCueAsset(this.options.path, this.options.label);
      this.dirty = false;
      this.renderAll();
      this.setStatus("Ready.");
    } catch (error) {
      this.setStatus(`Failed to load: ${describeError(error)}`, "error");
    }
  }

  private renderAll(): void {
    if (this.disposed) return;
    this.titleEl.textContent = this.cue.name;
    this.saveBtn.classList.toggle("is-dirty", this.dirty);
    this.positions = autoLayout(this.cue);
    this.renderGraph();
    this.renderValidation();
    this.renderDetails();
  }

  // ─── Palette ─────────────────────────────────────────────────────────────

  private renderPalette(): void {
    this.paletteHost.replaceChildren();
    for (const kind of ADDABLE_KINDS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sce-palette-item";
      btn.style.setProperty("--sce-color", NODE_COLORS[kind]);
      btn.innerHTML = `<span class="sce-palette-dot"></span>${esc(NODE_LABELS[kind])}`;
      btn.title = `Add ${NODE_LABELS[kind]} node`;
      btn.addEventListener("click", () => this.addNode(kind));
      this.paletteHost.append(btn);
    }
  }

  // ─── Graph canvas ────────────────────────────────────────────────────────

  private renderGraph(): void {
    for (const child of [...this.graphHost.children]) {
      if (child !== this.svgEl) child.remove();
    }

    let maxX = 400, maxY = 260;
    for (const pos of this.positions.values()) {
      maxX = Math.max(maxX, pos.x + NODE_W + PAD);
      maxY = Math.max(maxY, pos.y + NODE_H + PAD);
    }

    this.graphHost.style.width = `${maxX}px`;
    this.graphHost.style.height = `${maxY}px`;
    this.svgEl.setAttribute("width", String(maxX));
    this.svgEl.setAttribute("height", String(maxY));
    this.svgEl.setAttribute("viewBox", `0 0 ${maxX} ${maxY}`);
    this.svgEl.style.cssText = `position:absolute;inset:0;width:${maxX}px;height:${maxY}px;pointer-events:none;`;
    this.svgEl.innerHTML = this.buildSvg();

    for (const node of this.cue.nodes) {
      const pos = this.positions.get(node.id) ?? { x: PAD, y: PAD };
      this.graphHost.append(this.buildNodeDiv(node, pos));
    }
  }

  private buildSvg(): string {
    const paths: string[] = [];
    for (const { from, to } of this.cue.connections) {
      const s = this.positions.get(from);
      const t = this.positions.get(to);
      if (!s || !t) continue;
      const x1 = s.x + NODE_W, y1 = s.y + NODE_H / 2;
      const x2 = t.x, y2 = t.y + NODE_H / 2;
      const cx = (x1 + x2) / 2;
      paths.push(`<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}" class="sce-conn"/>`);
    }
    return `<defs>
      <marker id="sce-arr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
        <path d="M0,0 L7,3.5 L0,7 Z" fill="#4a5a68"/>
      </marker>
    </defs>${paths.join("")}`;
  }

  private buildNodeDiv(node: SoundCueNode, pos: Pos): HTMLDivElement {
    const isOut = node.id === this.selectedId;
    const subtitle = this.subtitle(node);
    const div = document.createElement("div");
    div.className = `sce-node${isOut ? " is-selected" : ""}`;
    div.dataset.nodeId = node.id;
    div.style.cssText = `left:${pos.x}px;top:${pos.y}px;width:${NODE_W}px;height:${NODE_H}px;`;
    div.style.setProperty("--sce-color", NODE_COLORS[node.kind]);
    div.innerHTML = `
      <div class="sce-node-head">
        <span class="sce-node-kind">${esc(NODE_LABELS[node.kind])}</span>
        ${node.kind !== "output" ? `<button type="button" class="sce-node-del" data-del="${esc(node.id)}" title="Delete">×</button>` : ""}
      </div>
      <div class="sce-node-body">${subtitle ? `<span class="sce-node-sub">${esc(subtitle)}</span>` : ""}</div>
      ${node.kind !== "output" ? `<span class="sce-port sce-port-out"></span>` : ""}
      ${node.kind !== "source" ? `<span class="sce-port sce-port-in"></span>` : ""}
    `;
    div.addEventListener("click", (e) => {
      const del = (e.target as HTMLElement).closest<HTMLElement>("[data-del]");
      if (del) { e.stopPropagation(); this.deleteNode(del.dataset.del!); return; }
      this.selectNode(node.id);
    });
    return div;
  }

  private subtitle(node: SoundCueNode): string {
    switch (node.kind) {
      case "source": return node.clipId || "(no clip)";
      case "modulator": {
        const v = node.volumeMin !== undefined ? `vol ${node.volumeMin}–${node.volumeMax ?? node.volumeMin}` : "";
        const p = node.pitchMin !== undefined ? `pitch ${node.pitchMin}–${node.pitchMax ?? node.pitchMin}` : "";
        return [v, p].filter(Boolean).join(" | ");
      }
      case "delay": return node.secondsMin !== undefined ? `${node.secondsMin}–${node.secondsMax ?? node.secondsMin}s` : "";
      case "random": return node.withoutReplacement ? "no-repeat" : "";
      default: return "";
    }
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  private renderValidation(): void {
    const el = this.overlay.querySelector("[data-sce-validation]");
    if (!el) return;
    const issues = validateSoundCueGraph(this.cue);
    if (issues.length === 0) {
      el.innerHTML = `<span class="sce-ok">✓ Graph valid</span>`;
    } else {
      el.innerHTML = issues.map((i) => `<div class="sce-issue">⚠ ${esc(i)}</div>`).join("");
    }
  }

  // ─── Details panel ───────────────────────────────────────────────────────

  private renderDetails(): void {
    const node = this.cue.nodes.find((n) => n.id === this.selectedId);
    if (!node) {
      this.detailsHost.innerHTML = `<div class="sce-det-empty">Select a node to edit its properties.</div>`;
      return;
    }
    const html: string[] = [`<div class="sce-det-inner">`];
    html.push(`<div class="sce-det-row sce-det-id"><label>Node ID</label><span>${esc(node.id)}</span></div>`);
    html.push(`<div class="sce-det-row"><label>Kind</label><span class="sce-kind-badge" style="--sce-color:${NODE_COLORS[node.kind]}">${esc(NODE_LABELS[node.kind])}</span></div>`);

    switch (node.kind) {
      case "source": {
        const sounds = (this.options.assets ?? []).filter((a) => a.assetType === "sound");
        const hasClip = sounds.some((a) => a.id === node.clipId);
        const opts = sounds.map((a) => `<option value="${esc(a.id)}"${a.id === node.clipId ? " selected" : ""}>${esc(a.name)}</option>`).join("");
        const extra = !hasClip && node.clipId ? `<option value="${esc(node.clipId)}" selected>${esc(node.clipId)}</option>` : "";
        html.push(`<div class="sce-det-row"><label>Clip</label><select data-field="clipId">${opts}${extra}</select></div>`);
        html.push(this.numRow("Volume", "volume", node.volume ?? 1, 0, 10, 0.05));
        html.push(this.numRow("Pitch", "pitch", node.pitch ?? 1, 0.01, 10, 0.05));
        html.push(this.boolRow("Loop", "loop", node.loop ?? false));
        break;
      }
      case "output": {
        html.push(this.numRow("Volume", "volume", node.volume ?? 1, 0, 10, 0.05));
        html.push(this.numRow("Pitch", "pitch", node.pitch ?? 1, 0.01, 10, 0.05));
        const curBus = this.cue.output.bus ?? "sfx";
        html.push(`<div class="sce-det-row"><label>Bus</label><select data-field="bus">${BUS_IDS.map((b) => `<option value="${b}"${b === curBus ? " selected" : ""}>${b}</option>`).join("")}</select></div>`);
        break;
      }
      case "modulator":
        html.push(this.numRow("Vol Min", "volumeMin", node.volumeMin ?? 1, 0, 10, 0.05));
        html.push(this.numRow("Vol Max", "volumeMax", node.volumeMax ?? 1, 0, 10, 0.05));
        html.push(this.numRow("Pitch Min", "pitchMin", node.pitchMin ?? 1, 0.01, 10, 0.05));
        html.push(this.numRow("Pitch Max", "pitchMax", node.pitchMax ?? 1, 0.01, 10, 0.05));
        break;
      case "delay":
        html.push(this.numRow("Min (s)", "secondsMin", node.secondsMin ?? 0, 0, 60, 0.1));
        html.push(this.numRow("Max (s)", "secondsMax", node.secondsMax ?? 0, 0, 60, 0.1));
        break;
      case "random":
        html.push(this.boolRow("No Repeat", "withoutReplacement", node.withoutReplacement ?? false));
        break;
    }

    // Connection picker (not shown for output, since output receives connections)
    if (node.kind !== "output") {
      const existing = this.cue.connections.find((c) => c.from === node.id)?.to ?? "";
      const targets = this.cue.nodes.filter((n) => n.id !== node.id);
      html.push(`<div class="sce-det-section">Connection</div>`);
      html.push(`<div class="sce-det-row"><label>Output to</label><select data-field="connectTo"><option value="">— none —</option>${targets.map((t) => `<option value="${esc(t.id)}"${t.id === existing ? " selected" : ""}>${esc(t.id)} (${esc(NODE_LABELS[t.kind])})</option>`).join("")}</select></div>`);
    }

    html.push(`</div>`);
    this.detailsHost.innerHTML = html.join("");

    for (const el of this.detailsHost.querySelectorAll<HTMLElement>("[data-field]")) {
      const field = el.dataset.field!;
      const handle = () => this.applyDetailChange(node.id, field, el);
      el.addEventListener("change", handle);
      if (el instanceof HTMLInputElement && el.type === "number") el.addEventListener("input", handle);
    }
  }

  private numRow(label: string, field: string, value: number, min: number, max: number, step: number): string {
    return `<div class="sce-det-row"><label>${esc(label)}</label><input type="number" data-field="${esc(field)}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
  }

  private boolRow(label: string, field: string, value: boolean): string {
    return `<div class="sce-det-row"><label>${esc(label)}</label><input type="checkbox" data-field="${esc(field)}"${value ? " checked" : ""}></div>`;
  }

  private applyDetailChange(nodeId: string, field: string, el: HTMLElement): void {
    const nodeIdx = this.cue.nodes.findIndex((n) => n.id === nodeId);
    if (nodeIdx < 0) return;

    if (field === "connectTo") {
      const targetId = (el as HTMLSelectElement).value;
      const connections = this.cue.connections.filter((c) => c.from !== nodeId);
      if (targetId) connections.push({ from: nodeId, to: targetId });
      this.cue = { ...this.cue, connections };
      this.markDirty();
      this.renderAll();
      return;
    }

    if (field === "bus") {
      const bus = (el as HTMLSelectElement).value as typeof BUS_IDS[number];
      this.cue = { ...this.cue, output: { ...this.cue.output, bus } };
      this.markDirty();
      return;
    }

    const node = { ...this.cue.nodes[nodeIdx] } as Record<string, unknown>;
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      node[field] = el.checked;
    } else if (el instanceof HTMLInputElement && el.type === "number") {
      const v = parseFloat(el.value);
      if (Number.isFinite(v)) node[field] = v;
    } else if (el instanceof HTMLSelectElement) {
      node[field] = el.value;
    }

    const nodes = [...this.cue.nodes];
    nodes[nodeIdx] = node as unknown as SoundCueNode;
    this.cue = { ...this.cue, nodes };
    this.markDirty();
    this.renderGraph();
    this.renderValidation();
  }

  // ─── Node operations ─────────────────────────────────────────────────────

  private selectNode(id: string): void {
    this.selectedId = id;
    for (const div of this.graphHost.querySelectorAll<HTMLElement>(".sce-node")) {
      div.classList.toggle("is-selected", div.dataset.nodeId === id);
    }
    this.renderDetails();
  }

  private addNode(kind: SoundCueNodeKind): void {
    const id = `${kind}-${++this.idCounter}`;
    let node: SoundCueNode;
    switch (kind) {
      case "source": node = { id, kind, clipId: "", volume: 1, pitch: 1 }; break;
      case "mixer": node = { id, kind }; break;
      case "random": node = { id, kind }; break;
      case "modulator": node = { id, kind, volumeMin: 0.9, volumeMax: 1, pitchMin: 0.95, pitchMax: 1.05 }; break;
      case "loop": node = { id, kind }; break;
      case "delay": node = { id, kind, secondsMin: 0, secondsMax: 0.5 }; break;
      default: return;
    }
    this.cue = { ...this.cue, nodes: [...this.cue.nodes, node] };
    this.selectedId = id;
    this.markDirty();
    this.renderAll();
  }

  private deleteNode(id: string): void {
    if (id === "output") { this.setStatus("Cannot delete the Output node.", "warning"); return; }
    this.cue = {
      ...this.cue,
      nodes: this.cue.nodes.filter((n) => n.id !== id),
      connections: this.cue.connections.filter((c) => c.from !== id && c.to !== id),
    };
    if (this.selectedId === id) this.selectedId = null;
    this.markDirty();
    this.renderAll();
  }

  // ─── Save ─────────────────────────────────────────────────────────────────

  private async save(): Promise<void> {
    try {
      this.setStatus("Saving…");
      await saveSoundCueAsset(this.options.path, this.cue);
      this.dirty = false;
      this.saveBtn.classList.remove("is-dirty");
      this.setStatus("Saved.", "success");
      this.options.onSaved?.();
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  // ─── Audio preview ────────────────────────────────────────────────────────

  private async preview(): Promise<void> {
    this.stopPreview();
    const issues = validateSoundCueGraph(this.cue);
    if (issues.length > 0) { this.setStatus(`Cannot preview: ${issues[0]}`, "warning"); return; }
    const events = evaluateSoundCue(this.cue);
    if (events.length === 0) { this.setStatus("Nothing to preview: no connected source nodes.", "warning"); return; }

    const ctx = this.audioCtx();
    if (!ctx) { this.setStatus("Web Audio not available.", "error"); return; }
    void ctx.resume().catch(() => undefined);

    const soundAssets = (this.options.assets ?? []).filter((a) => a.assetType === "sound");
    let missing = 0;
    for (const ev of events) {
      const asset = soundAssets.find((a) => a.id === ev.clipId);
      if (!asset) { missing++; continue; }
      const url = projectFileUrl(asset.path);
      const play = () => void this.playBuf(ctx, url, ev.volume, ev.pitch, ev.loop);
      if (ev.delaySeconds > 0) {
        this.previewTimers.push(setTimeout(play, ev.delaySeconds * 1000));
      } else {
        play();
      }
    }
    const msg = missing > 0
      ? `Playing ${events.length - missing}/${events.length} events (${missing} clip(s) missing from project).`
      : `Previewing ${events.length} event(s)…`;
    this.setStatus(msg, missing > 0 ? "warning" : "info");
  }

  private async playBuf(ctx: AudioContext, url: string, vol: number, pitch: number, loop: boolean): Promise<void> {
    const buf = await this.fetchBuf(ctx, url);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.playbackRate.value = Math.max(0.01, pitch);
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, vol);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    this.previewSources.push(src);
    src.onended = () => {
      const i = this.previewSources.indexOf(src);
      if (i >= 0) this.previewSources.splice(i, 1);
    };
  }

  private fetchBuf(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    let p = this.previewBuffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
      this.previewBuffers.set(url, p);
    }
    return p;
  }

  private stopPreview(): void {
    for (const t of this.previewTimers) clearTimeout(t);
    this.previewTimers = [];
    for (const src of this.previewSources) { try { src.stop(); } catch { /* already ended */ } }
    this.previewSources = [];
  }

  private audioCtx(): AudioContext | null {
    if (this.previewCtx) return this.previewCtx;
    const Ctor = globalThis.AudioContext ?? (globalThis as Record<string, unknown>)["webkitAudioContext"] as typeof AudioContext | undefined;
    if (!Ctor) return null;
    this.previewCtx = new Ctor();
    return this.previewCtx;
  }

  // ─── Status / lifecycle ───────────────────────────────────────────────────

  private setStatus(message: string, tone?: StatusTone): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone ?? "";
    this.options.onStatus?.(message, tone);
  }

  private markDirty(): void {
    this.dirty = true;
    this.saveBtn.classList.add("is-dirty");
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPreview();
    void this.previewCtx?.close().catch(() => undefined);
    this.previewCtx = null;
    this.previewBuffers.clear();
    this.overlay.remove();
    if (SoundCueEditor.activeInstance === this) SoundCueEditor.activeInstance = null;
  }
}
