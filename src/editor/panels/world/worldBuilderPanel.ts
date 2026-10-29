import { ROAD_NODE_KINDS, type ProtectedRegion, type WorldPlan, type WorldReference } from "@engine/worldbuilder/recipe";
import { ROAD_CLASSES, type RoadClass } from "@engine/worldbuilder/vocabulary";
import type { StagePlan } from "@engine/worldbuilder/stage";
import { SETTLEMENT_SITES_STAGE_ID } from "@engine/worldbuilder/stages/settlementSites";
import { LOW_CONFIDENCE, type RecipeLayerOptions, type UnderlayState } from "@/editor/worldBuilderLayer";
import { PLAN_ELEMENT_KINDS, type PlanElementFields, type PlanElementKind, type PlanRef, type StrandedNode } from "@/editor/worldBuilderPlanEdit";
import { PREVIEW_CHANGES, previewItemDrawable, type PreviewChange, type PreviewItem } from "@/editor/worldBuilderPreview";
import type { WorldBuilderSession, WorldBuilderView } from "@/editor/worldBuilderSession";

/** At most this many ids are listed per report line; the rest are counted. */
const LISTED_IDS = 8;
/** At most this many rows per change in the preview list; the rest are counted. */
const LISTED_CHANGES = 40;
/** Per-viewer layer switches and underlay opacity (browser storage; never in the recipe). */
const LAYER_STORAGE_KEY = "forge.worldBuilder.layers";

export interface WorldBuilderPanelOptions {
  body: HTMLElement;
  session: WorldBuilderSession;
}

/**
 * World Builder panel (plan v0.4 §6.2, §7.1): the open level's recipe, its
 * region profile, the stages with Dry Run / Apply, and the last plan's report.
 * Apply is one undo step; the recipe is written by Save Layout. A dry run with
 * changes is drawn in the viewport (T10) and listed by change; a row frames
 * its object, Focus frames them all and Clear Preview drops the drawing.
 * Viewport Layers switch the recipe layer's parts (reference image, plan,
 * generated data) and set the reference image (an undoable recipe edit).
 * Plan Corrections list the plan's elements and protected regions: a row
 * selects one (highlighted in the viewport), its fields and Add / Delete are
 * hand corrections, each one undo step (§13.2 step 4). Edit in Viewport
 * turns on the viewport handles (drag a point over the ground; Delete removes
 * the selected element, Escape deselects). A road node the applied sites
 * left outside its settlement gets Move to Site, in the Settlement Sites
 * report and on the selected node.
 */
export class WorldBuilderPanel {
  constructor(private readonly options: WorldBuilderPanelOptions) {
    options.body.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-wb-action]");
      if (!button || button.disabled) return;
      void this.run(button.dataset.wbAction ?? "", button.dataset.wbStage ?? "", button.dataset.wbId, button.dataset);
    });
    // A typed plan field is one correction when it is committed (Enter or leaving the field).
    options.body.addEventListener("change", (event) => {
      const field = (event.target as HTMLElement).closest<HTMLInputElement | HTMLSelectElement>("[data-wb-field]");
      if (!field) return;
      const selection = options.session.getView().planEdit?.selection;
      if (selection) options.session.updatePlanElement(selection, this.readPlanFields());
      this.update();
    });
    // Live while dragging, without redrawing the panel under the slider.
    options.body.addEventListener("input", (event) => {
      const slider = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-wb-opacity]");
      if (!slider) return;
      options.session.setLayerOptions({ opacity: Number(slider.value) });
      this.storeLayerOptions();
    });
    const stored = readLayerOptions();
    if (stored) options.session.setLayerOptions(stored);
    options.session.onChange = () => this.update();
  }

  update(): void {
    this.options.body.innerHTML = renderView(this.options.session.getView());
  }

  private async run(action: string, stageId: string, id?: string, data: DOMStringMap = {}): Promise<void> {
    const { session } = this.options;
    const kind = data.wbKind as PlanElementKind | undefined;
    if (action === "create") session.createRecipe();
    else if (action === "reload") await session.reload();
    else if (action === "dry-run") session.dryRun(stageId);
    else if (action === "apply") session.apply(stageId);
    else if (action === "apply-pads") await session.applyPads();
    else if (action === "preview-clear") session.clearPreview();
    else if (action === "layer-toggle") {
      const part = id as "underlay" | "plan" | "generated";
      session.setLayerOptions({ [part]: !session.getView().layer.options[part] });
      this.storeLayerOptions();
    } else if (action === "reference-set") {
      const reference = this.readReferenceForm();
      if (reference) session.setReference(reference);
    } else if (action === "reference-remove") session.setReference(null);
    else if (action === "plan-select" && kind && id) session.selectPlan({ kind, id });
    else if (action === "plan-edit-toggle") session.setPlanEditing(!session.getView().planEdit?.editing);
    else if (action === "plan-add" && kind) session.addPlanElement(kind);
    else if (action === "plan-delete") session.deletePlanElement();
    else if (action === "plan-connect" && id) {
      const to = this.planControl("connect-to");
      if (to) session.addPlanElement("edge", null, { from: id, to, roadClass: this.planControl("connect-class") as RoadClass });
    } else if (action === "node-to-site" && id) session.moveNodeToSite(id);
    else if (action === "guide-add" && id) session.addGuidePoint(id);
    else if (action === "guide-delete" && id) session.deleteGuidePoint(id, Number(data.wbIndex));
    else if (action === "preview-focus") {
      session.focusPreview(id);
      return;
    }
    this.update();
  }

  private planControl(name: string): string {
    return this.options.body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-wb-plan="${name}"]`)?.value.trim() ?? "";
  }

  /** The selected element's typed fields; an empty optional number clears it. */
  private readPlanFields(): PlanElementFields {
    const value = (name: string) => this.options.body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-wb-field="${name}"]`)?.value.trim();
    const number = (name: string) => {
      const text = value(name);
      return text === undefined || text === "" ? null : Number(text);
    };
    const point = (x: string, z: string): [number, number] | undefined => {
      const px = number(x);
      const pz = number(z);
      return px === null || pz === null ? undefined : [px, pz];
    };
    const fields: PlanElementFields = {};
    const position = point("x", "z");
    if (position) fields.position = position;
    const min = point("min-x", "min-z");
    if (min) fields.min = min;
    const max = point("max-x", "max-z");
    if (max) fields.max = max;
    const kind = value("kind");
    if (kind) fields.kind = kind;
    if (value("population") !== undefined) fields.population = number("population");
    if (value("radius") !== undefined) fields.radius = number("radius");
    const nodeKind = value("node-kind");
    if (nodeKind) fields.nodeKind = nodeKind as (typeof ROAD_NODE_KINDS)[number];
    const roadClass = value("road-class");
    if (roadClass) fields.roadClass = roadClass as RoadClass;
    return fields;
  }

  private readReferenceForm(): WorldReference | null {
    const field = (name: string) => this.options.body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-wb-ref="${name}"]`)?.value.trim() ?? "";
    const number = (name: string) => Number(field(name));
    const image = field("image");
    const reference: WorldReference = {
      origin: [number("origin-x"), number("origin-z")],
      size: [number("size-x"), number("size-z")],
      ...(image ? { image } : {}),
    };
    const view = field("view");
    if (view === "topDown" || view === "perspective") reference.view = view;
    return reference;
  }

  private storeLayerOptions(): void {
    try {
      localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(this.options.session.getView().layer.options));
    } catch {
      // Storage may be unavailable (private window); the switches then last this session.
    }
  }
}

function readLayerOptions(): Partial<RecipeLayerOptions> | null {
  try {
    const value = JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const stored = value as Record<string, unknown>;
    const options: Partial<RecipeLayerOptions> = {};
    for (const key of ["underlay", "plan", "generated"] as const) if (typeof stored[key] === "boolean") options[key] = stored[key] as boolean;
    if (typeof stored.opacity === "number" && Number.isFinite(stored.opacity)) options.opacity = stored.opacity;
    return options;
  } catch {
    return null;
  }
}

function renderView(view: WorldBuilderView): string {
  return `<div class="world-builder-panel" data-testid="world-builder-panel">
    ${renderRecipe(view)}
    ${view.state === "loaded" ? renderLayers(view) : ""}
    ${view.planEdit ? renderPlanEdit(view.planEdit) : ""}
    ${view.state === "loaded" ? renderStages(view) : ""}
    ${view.lastPlan ? renderPlan(view.lastPlan, view.preview !== null, view.planEdit?.stranded ?? []) : ""}
    ${view.preview ? renderPreview(view.preview.preview.items, view.preview.drawn) : ""}
  </div>`;
}

function renderRecipe(view: WorldBuilderView): string {
  const status = view.state === "loaded"
    ? `<strong>${escapeHtml(view.recipeId ?? "")}</strong>${view.dirty ? ' <span class="world-builder-dirty">unsaved</span>' : ""}`
    : view.state === "invalid"
      ? '<span class="world-builder-error">The file is not a world recipe.</span>'
      : view.state === "loading" ? "Loading the level…" : "No world recipe for this level yet.";
  const counts = view.planCounts
    ? `<div>Plan: ${view.planCounts.settlements} settlements, ${view.planCounts.landmarks} landmarks, ${view.planCounts.roadNodes} road nodes, ${view.planCounts.roadEdges} road edges · ${view.planCounts.owned} generated objects</div>`
    : "";
  const profile = view.profile
    ? `<div>Region profile: ${escapeHtml(view.profile.label ?? view.profile.path)} (${view.profile.state}${view.profile.issues.length ? `, ${view.profile.issues.length} issues` : ""})</div>`
    : view.state === "loaded" ? "<div>Region profile: none</div>" : "";
  return `<div class="detail-section">
    <div class="detail-section-title">World Recipe</div>
    <div class="world-builder-summary">
      <div data-testid="world-builder-recipe">${status}</div>
      <div class="world-builder-path">${escapeHtml(view.path)}</div>
      ${counts}
      ${profile}
      ${renderList("Load issues", view.issues, "world-builder-error")}
    </div>
    <div class="world-builder-actions">
      ${view.state === "missing" || view.state === "invalid" ? '<button type="button" data-wb-action="create" data-testid="world-builder-create">Create Recipe</button>' : ""}
      <button type="button" data-wb-action="reload" ${view.dirty || view.state === "loading" ? "disabled title=\"Save or undo recipe changes first\"" : ""}>Reload From Disk</button>
    </div>
  </div>`;
}

const UNDERLAY_TEXT: Record<UnderlayState, string> = {
  none: "none — set one below",
  hidden: "hidden",
  perspective: "a perspective view; only a top-down image lies on the ground",
  loading: "loading…",
  shown: "shown",
  error: "the image failed to load",
};

function renderLayers(view: WorldBuilderView): string {
  const { options, counts } = view.layer;
  const toggle = (part: "underlay" | "plan" | "generated") =>
    `<button type="button" class="world-builder-change" data-wb-action="layer-toggle" data-wb-id="${part}" data-testid="world-builder-layer-toggle-${part}">${options[part] ? "Hide" : "Show"}</button>`;
  const swatch = (name: string, label: string) => `<span class="world-builder-swatch world-builder-swatch-${name}"></span>${label}`;
  const low = counts.lowConfidence > 0 ? `, ${counts.lowConfidence} low confidence` : "";
  const plan = options.plan ? `${counts.plan} elements${low}` : "hidden";
  const generated = options.generated
    ? `${counts.cores} settlement cores, ${counts.parcels} parcels, ${counts.pads} pads`
    : "hidden";
  return `<div class="detail-section" data-testid="world-builder-layers">
    <div class="detail-section-title">Viewport Layers</div>
    <div class="world-builder-summary">
      <div data-testid="world-builder-layer-underlay" data-state="${counts.underlay}">Reference image: ${UNDERLAY_TEXT[counts.underlay]} ${toggle("underlay")}</div>
      <label class="world-builder-row">Opacity
        <input type="range" min="0" max="1" step="0.05" value="${options.opacity}" data-wb-opacity data-testid="world-builder-underlay-opacity">
      </label>
      <div data-testid="world-builder-layer-plan" data-drawn="${options.plan ? counts.plan : 0}" data-low="${options.plan ? counts.lowConfidence : 0}">Plan: ${plan} ${toggle("plan")}</div>
      <div class="world-builder-legend">${swatch("settlement", "settlement")} ${swatch("road", "road")} ${swatch("water", "water")} ${swatch("region", "region")} ${swatch("landmark", "landmark")} ${swatch("protected", "protected")} ${swatch("selected", "selected")} ${swatch("low", "confidence &lt; 0.5")} · dashed: inferred</div>
      <div data-testid="world-builder-layer-generated" data-cores="${options.generated ? counts.cores : 0}" data-parcels="${options.generated ? counts.parcels : 0}" data-pads="${options.generated ? counts.pads : 0}">Generated: ${generated} ${toggle("generated")}</div>
      <div class="world-builder-legend">${swatch("core", "core")} ${swatch("pad", "pad")} · parcels by land use</div>
    </div>
    ${renderReferenceForm(view.reference)}
  </div>`;
}

function renderReferenceForm(reference: WorldReference | null): string {
  const value = (number: number | undefined) => (number === undefined ? "" : String(number));
  const input = (name: string, current: string, type = "number", extra = "") =>
    `<input type="${type}" data-wb-ref="${name}" data-testid="world-builder-reference-${name}" value="${escapeHtml(current)}" ${extra}>`;
  const view = reference?.view ?? "topDown";
  return `<div class="world-builder-reference">
    <label class="world-builder-row">Image ${input("image", reference?.image ?? "", "text", 'placeholder="assets/…/reference.png"')}</label>
    <label class="world-builder-row">Top-left x ${input("origin-x", value(reference?.origin[0]))} z ${input("origin-z", value(reference?.origin[1]))}</label>
    <label class="world-builder-row">Size x ${input("size-x", value(reference?.size[0]), "number", 'min="0"')} z ${input("size-z", value(reference?.size[1]), "number", 'min="0"')}</label>
    <label class="world-builder-row">View
      <select data-wb-ref="view" data-testid="world-builder-reference-view">
        <option value="topDown" ${view === "topDown" ? "selected" : ""}>top-down</option>
        <option value="perspective" ${view === "perspective" ? "selected" : ""}>perspective</option>
      </select>
    </label>
    <div class="world-builder-actions">
      <button type="button" data-wb-action="reference-set" data-testid="world-builder-reference-set">Set Reference</button>
      ${reference ? '<button type="button" data-wb-action="reference-remove" data-testid="world-builder-reference-remove">Remove</button>' : ""}
    </div>
  </div>`;
}

const PLAN_KIND_LABELS: Record<PlanElementKind, string> = {
  settlement: "Settlement",
  node: "Road node",
  edge: "Road edge",
  landmark: "Landmark",
  protected: "Protected region",
};

interface PlanRow {
  ref: PlanRef;
  label: string;
  /** `manual`, `reference`, …; absent for protected regions (ownership, not plan). */
  source?: string;
  low: boolean;
}

function planRows(plan: WorldPlan, protectedRegions: readonly ProtectedRegion[]): PlanRow[] {
  const low = (confidence: number | undefined) => confidence !== undefined && confidence < LOW_CONFIDENCE;
  return [
    ...plan.settlements.map((entry): PlanRow => ({ ref: { kind: "settlement", id: entry.id }, label: entry.type, source: entry.source, low: low(entry.confidence) })),
    ...plan.roadGraph.nodes.map((entry): PlanRow => ({ ref: { kind: "node", id: entry.id }, label: entry.kind, source: entry.source, low: low(entry.confidence) })),
    ...plan.roadGraph.edges.map((entry): PlanRow => ({ ref: { kind: "edge", id: entry.id }, label: `${entry.from} → ${entry.to}, ${entry.roadClass}`, source: entry.source, low: low(entry.confidence) })),
    ...plan.landmarks.map((entry): PlanRow => ({ ref: { kind: "landmark", id: entry.id }, label: entry.kind, source: entry.source, low: low(entry.confidence) })),
    ...protectedRegions.map((entry): PlanRow => ({ ref: { kind: "protected", id: entry.id }, label: entry.kind, low: false })),
  ];
}

function renderPlanEdit(edit: NonNullable<WorldBuilderView["planEdit"]>): string {
  const { selection } = edit;
  const rows = planRows(edit.plan, edit.protectedRegions);
  const groups = PLAN_ELEMENT_KINDS.map((kind) => {
    const own = rows.filter((row) => row.ref.kind === kind);
    if (own.length === 0) return "";
    const items = own.map((row) => {
      const selected = selection?.kind === kind && selection.id === row.ref.id;
      const tags = [row.source, row.low ? "low confidence" : ""].filter(Boolean).join(", ");
      return `<li><button type="button" class="world-builder-change${selected ? " world-builder-selected" : ""}" data-wb-action="plan-select" data-wb-kind="${kind}" data-wb-id="${escapeHtml(row.ref.id)}" data-testid="world-builder-plan-${kind}-${escapeHtml(row.ref.id)}" data-source="${escapeHtml(row.source ?? "")}">${escapeHtml(row.ref.id)} <span class="world-builder-path">${escapeHtml(row.label)}${tags ? ` · ${escapeHtml(tags)}` : ""}</span></button></li>`;
    }).join("");
    return `<div>${PLAN_KIND_LABELS[kind]}s (${own.length})<ul class="world-builder-list">${items}</ul></div>`;
  }).join("");
  const add = (["settlement", "node", "landmark", "protected"] as const).map((kind) =>
    `<button type="button" data-wb-action="plan-add" data-wb-kind="${kind}" data-testid="world-builder-plan-add-${kind}">+ ${PLAN_KIND_LABELS[kind]}</button>`).join("");
  return `<div class="detail-section" data-testid="world-builder-plan-edit">
    <div class="detail-section-title">Plan Corrections</div>
    <div class="world-builder-summary">
      <div>Each correction is one undo step; a corrected element becomes manual. New elements go where the viewport looks.</div>
      <div data-testid="world-builder-plan-handles" data-editing="${edit.editing}" data-handles="${edit.handles}">${edit.editing
        ? `Editing in the viewport: ${edit.handles} handles — drag a point onto the ground; Delete removes the selected element, Escape deselects.`
        : "Viewport handles are off."}
        <button type="button" data-wb-action="plan-edit-toggle" data-testid="world-builder-plan-edit-toggle">${edit.editing ? "Stop Editing" : "Edit in Viewport"}</button></div>
      ${groups || "<div>The plan is empty.</div>"}
    </div>
    <div class="world-builder-actions">${add}</div>
    ${selection ? renderPlanSelection(edit, selection) : ""}
  </div>`;
}

function renderPlanSelection(edit: NonNullable<WorldBuilderView["planEdit"]>, selection: PlanRef): string {
  const { plan } = edit;
  const input = (name: string, current: number | string | undefined, type = "number") =>
    `<input type="${type}" data-wb-field="${name}" data-testid="world-builder-plan-field-${name}" value="${escapeHtml(current === undefined ? "" : String(current))}">`;
  const select = (name: string, options: readonly string[], current: string) =>
    `<select data-wb-field="${name}" data-testid="world-builder-plan-field-${name}">${options.map((option) =>
      `<option value="${escapeHtml(option)}" ${option === current ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  const position = (point: readonly [number, number]) =>
    `<label class="world-builder-row">Position x ${input("x", point[0])} z ${input("z", point[1])}</label>`;
  let fields = "";
  let extra = "";
  if (selection.kind === "settlement") {
    const settlement = plan.settlements.find((entry) => entry.id === selection.id);
    if (!settlement) return "";
    fields = `${position(settlement.center)}
      <label class="world-builder-row">Type ${input("kind", settlement.type, "text")}</label>
      <label class="world-builder-row">Population ${input("population", settlement.population)} Search radius ${input("radius", settlement.radius)}</label>`;
  } else if (selection.kind === "node") {
    const node = plan.roadGraph.nodes.find((entry) => entry.id === selection.id);
    if (!node) return "";
    const others = plan.roadGraph.nodes.filter((entry) => entry.id !== node.id);
    const stranded = edit.stranded.find((entry) => entry.node === node.id);
    fields = `${position(node.position)}
      <label class="world-builder-row">Kind ${select("node-kind", ROAD_NODE_KINDS, node.kind)}</label>
      ${stranded ? `<div>Outside the ${escapeHtml(stranded.settlement)} site ${moveToSiteButton(stranded)}</div>` : ""}`;
    extra = others.length === 0 ? "" : `<label class="world-builder-row">Connect to
        <select data-wb-plan="connect-to" data-testid="world-builder-plan-connect-to">${others.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.id)}</option>`).join("")}</select>
        <select data-wb-plan="connect-class" data-testid="world-builder-plan-connect-class">${ROAD_CLASSES.map((entry) => `<option value="${entry}" ${entry === "local" ? "selected" : ""}>${entry}</option>`).join("")}</select>
        <button type="button" data-wb-action="plan-connect" data-wb-id="${escapeHtml(node.id)}" data-testid="world-builder-plan-connect">Add Edge</button>
      </label>`;
  } else if (selection.kind === "edge") {
    const edge = plan.roadGraph.edges.find((entry) => entry.id === selection.id);
    if (!edge) return "";
    const guide = (edge.guide ?? []).map((point, index) =>
      `<li>${point[0]}, ${point[1]} <button type="button" class="world-builder-change" data-wb-action="guide-delete" data-wb-id="${escapeHtml(edge.id)}" data-wb-index="${index}" data-testid="world-builder-plan-guide-delete-${index}">remove</button></li>`).join("");
    fields = `<div>${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</div>
      <label class="world-builder-row">Road class ${select("road-class", ROAD_CLASSES, edge.roadClass)}</label>`;
    extra = `<div data-testid="world-builder-plan-guide" data-count="${edge.guide?.length ?? 0}">Guide points (${edge.guide?.length ?? 0}) — a corridor hint, not the final route<ul class="world-builder-list">${guide}</ul></div>
      <div class="world-builder-actions"><button type="button" data-wb-action="guide-add" data-wb-id="${escapeHtml(edge.id)}" data-testid="world-builder-plan-guide-add">Add Guide Point</button></div>`;
  } else if (selection.kind === "landmark") {
    const landmark = plan.landmarks.find((entry) => entry.id === selection.id);
    if (!landmark) return "";
    fields = `${position(landmark.position)}
      <label class="world-builder-row">Kind ${input("kind", landmark.kind, "text")}</label>`;
  } else {
    const region = edit.protectedRegions.find((entry) => entry.id === selection.id);
    if (!region) return "";
    fields = `<label class="world-builder-row">Kind ${input("kind", region.kind, "text")}</label>
      <label class="world-builder-row">Min x ${input("min-x", region.min[0])} z ${input("min-z", region.min[1])}</label>
      <label class="world-builder-row">Max x ${input("max-x", region.max[0])} z ${input("max-z", region.max[1])}</label>`;
  }
  return `<div class="world-builder-reference" data-testid="world-builder-plan-selection" data-kind="${selection.kind}" data-id="${escapeHtml(selection.id)}">
    <div><strong>${PLAN_KIND_LABELS[selection.kind]} ${escapeHtml(selection.id)}</strong></div>
    ${fields}
    ${extra}
    <div class="world-builder-actions"><button type="button" data-wb-action="plan-delete" data-testid="world-builder-plan-delete">Delete ${PLAN_KIND_LABELS[selection.kind]}</button></div>
  </div>`;
}

function renderStages(view: WorldBuilderView): string {
  const rows = view.stages.map((stage) => {
    const stale = stage.recordedVersion !== null && stage.recordedVersion !== stage.version;
    const recorded = stage.recordedVersion === null ? "not run" : `v${stage.recordedVersion}${stale ? " (stale)" : ""}`;
    return `<div class="world-builder-stage">
      <div><strong>${escapeHtml(stage.label)}</strong> <span class="world-builder-path">${escapeHtml(stage.id)} · ${recorded}</span></div>
      <div class="world-builder-actions">
        <button type="button" data-wb-action="dry-run" data-wb-stage="${escapeHtml(stage.id)}" data-testid="world-builder-dry-run-${escapeHtml(stage.id)}">Dry Run</button>
        <button type="button" data-wb-action="apply" data-wb-stage="${escapeHtml(stage.id)}" data-testid="world-builder-apply-${escapeHtml(stage.id)}">Apply</button>
      </div>
    </div>`;
  }).join("");
  const pads = view.planCounts?.pads ?? 0;
  // Pads are a terrain bake on request (decision 19), not a stage: the Buildings stage writes them as data.
  const terrain = `<div class="world-builder-stage">
      <div><strong>Building pads</strong> <span class="world-builder-path">${pads} in the recipe · bakes into the terrain, one undo step</span></div>
      <div class="world-builder-actions">
        <button type="button" data-wb-action="apply-pads" data-testid="world-builder-apply-pads" ${pads === 0 ? "disabled title=\"Run Buildings first\"" : ""}>Apply Pads</button>
      </div>
    </div>`;
  return `<div class="detail-section"><div class="detail-section-title">Stages</div>${rows}</div>
    <div class="detail-section"><div class="detail-section-title">Terrain</div>${terrain}</div>`;
}

/**
 * `previewed`: the preview list below names the kept and blocked objects.
 * `stranded`: road nodes outside the applied sites, offered a fix under the
 * Settlement Sites report (after a dry run they are still the applied ones).
 */
function renderPlan(plan: StagePlan, previewed: boolean, stranded: readonly StrandedNode[]): string {
  const verdict = plan.errors.length > 0
    ? '<span class="world-builder-error">Errors — cannot apply</span>'
    : plan.empty ? "Up to date" : "Changes pending";
  const bounds = plan.bounds
    ? `<div>Area: x ${plan.bounds.min[0]}…${plan.bounds.max[0]}, z ${plan.bounds.min[1]}…${plan.bounds.max[1]}</div>`
    : "";
  return `<div class="detail-section" data-testid="world-builder-report">
    <div class="detail-section-title">${escapeHtml(plan.stageLabel)} — ${verdict}</div>
    <div class="world-builder-summary">
      <div data-testid="world-builder-counts">+${plan.added.length} added · ~${plan.updated.length} updated · −${plan.removed.length} removed · ${plan.unchanged} unchanged</div>
      ${bounds}
      ${renderList("Errors", plan.errors, "world-builder-error")}
      ${previewed ? "" : renderList("Kept", plan.kept.map((entry) => `${entry.id} (${keptLabel(entry.reason)})`))}
      ${previewed ? "" : renderList("Blocked", plan.blocked.map((entry) => `${entry.id} (${blockedLabel(entry.reason)})`))}
      ${renderList("Warnings", plan.warnings)}
      ${plan.stageId === SETTLEMENT_SITES_STAGE_ID ? renderStranded(stranded) : ""}
    </div>
  </div>`;
}

function renderStranded(stranded: readonly StrandedNode[]): string {
  if (stranded.length === 0) return "";
  const rows = stranded.map((entry) => `<li>${escapeHtml(entry.node)} is outside the ${escapeHtml(entry.settlement)} site ${moveToSiteButton(entry)}</li>`).join("");
  return `<div data-testid="world-builder-stranded" data-count="${stranded.length}">Road nodes outside their site (${stranded.length}) — move one, then run Roads<ul class="world-builder-list">${rows}</ul></div>`;
}

function moveToSiteButton(entry: StrandedNode): string {
  return `<button type="button" class="world-builder-change" data-wb-action="node-to-site" data-wb-id="${escapeHtml(entry.node)}" data-testid="world-builder-node-to-site-${escapeHtml(entry.node)}" title="Move to ${entry.to[0]}, ${entry.to[1]} on the site's edge; one undo step">Move to Site</button>`;
}

const CHANGE_LABELS: Record<PreviewChange, string> = {
  added: "Added",
  updated: "Updated",
  removed: "Removed",
  kept: "Kept",
  blocked: "Blocked",
};

function renderPreview(items: readonly PreviewItem[], drawn: number): string {
  const groups = PREVIEW_CHANGES.map((change) => {
    const own = items.filter((item) => item.change === change);
    if (own.length === 0) return "";
    const rows = own.slice(0, LISTED_CHANGES).map((item) => {
      const reason = item.reason ? ` (${REASON_LABELS[item.reason]})` : "";
      const detail = item.assetId ?? (item.kind === "spline" ? "spline" : "");
      const label = `${escapeHtml(item.id)}${escapeHtml(reason)}${detail ? ` <span class="world-builder-path">${escapeHtml(detail)}</span>` : ""}`;
      return previewItemDrawable(item)
        ? `<li><button type="button" class="world-builder-change" data-wb-action="preview-focus" data-wb-id="${escapeHtml(item.id)}" data-testid="world-builder-change-${escapeHtml(item.id)}">${label}</button></li>`
        : `<li data-testid="world-builder-change-${escapeHtml(item.id)}">${label}</li>`;
    }).join("");
    const more = own.length > LISTED_CHANGES ? `<li>… ${own.length - LISTED_CHANGES} more</li>` : "";
    return `<div data-testid="world-builder-preview-${change}" data-count="${own.length}">
      <span class="world-builder-swatch world-builder-swatch-${change}"></span>${CHANGE_LABELS[change]} (${own.length})
      <ul class="world-builder-list">${rows}${more}</ul>
    </div>`;
  }).join("");
  return `<div class="detail-section" data-testid="world-builder-preview" data-drawn="${drawn}">
    <div class="detail-section-title">Preview</div>
    <div class="world-builder-summary">
      <div>${drawn} of ${items.length} objects drawn in the viewport · Apply accepts, Undo rolls back</div>
      ${groups}
    </div>
    <div class="world-builder-actions">
      <button type="button" data-wb-action="preview-focus" data-testid="world-builder-preview-focus" ${drawn === 0 ? "disabled" : ""}>Focus</button>
      <button type="button" data-wb-action="preview-clear" data-testid="world-builder-preview-clear">Clear Preview</button>
    </div>
  </div>`;
}

function renderList(title: string, items: readonly string[], className = ""): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, LISTED_IDS).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const more = items.length > LISTED_IDS ? `<li>… ${items.length - LISTED_IDS} more</li>` : "";
  return `<div class="${className}">${escapeHtml(title)} (${items.length})<ul class="world-builder-list">${shown}${more}</ul></div>`;
}

const KEPT_LABELS: Record<StagePlan["kept"][number]["reason"], string> = {
  editedByHand: "edited by hand",
  deletedByHand: "deleted by hand",
  protected: "protected region",
  locked: "locked terrain",
};

const BLOCKED_LABELS: Record<StagePlan["blocked"][number]["reason"], string> = {
  manual: "id used by a manual object",
  otherStage: "owned by another stage",
  protected: "protected region",
  locked: "locked terrain",
};

/** Kept and blocked reasons share `protected` / `locked`, with the same label. */
const REASON_LABELS: Record<NonNullable<PreviewItem["reason"]>, string> = { ...KEPT_LABELS, ...BLOCKED_LABELS };

function keptLabel(reason: StagePlan["kept"][number]["reason"]): string {
  return KEPT_LABELS[reason];
}

function blockedLabel(reason: StagePlan["blocked"][number]["reason"]): string {
  return BLOCKED_LABELS[reason];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
