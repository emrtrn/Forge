import type { StagePlan } from "@engine/worldbuilder/stage";
import type { WorldBuilderSession, WorldBuilderView } from "@/editor/worldBuilderSession";

/** At most this many ids are listed per report line; the rest are counted. */
const LISTED_IDS = 8;

export interface WorldBuilderPanelOptions {
  body: HTMLElement;
  session: WorldBuilderSession;
}

/**
 * World Builder panel (plan v0.4 §6.2, §7.1): the open level's recipe, its
 * region profile, the stages with Dry Run / Apply, and the last plan's report.
 * Apply is one undo step; the recipe is written by Save Layout.
 */
export class WorldBuilderPanel {
  constructor(private readonly options: WorldBuilderPanelOptions) {
    options.body.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-wb-action]");
      if (!button || button.disabled) return;
      void this.run(button.dataset.wbAction ?? "", button.dataset.wbStage ?? "");
    });
  }

  update(): void {
    this.options.body.innerHTML = renderView(this.options.session.getView());
  }

  private async run(action: string, stageId: string): Promise<void> {
    const { session } = this.options;
    if (action === "create") session.createRecipe();
    else if (action === "reload") await session.reload();
    else if (action === "dry-run") session.dryRun(stageId);
    else if (action === "apply") session.apply(stageId);
    this.update();
  }
}

function renderView(view: WorldBuilderView): string {
  return `<div class="world-builder-panel" data-testid="world-builder-panel">
    ${renderRecipe(view)}
    ${view.state === "loaded" ? renderStages(view) : ""}
    ${view.lastPlan ? renderPlan(view.lastPlan) : ""}
  </div>`;
}

function renderRecipe(view: WorldBuilderView): string {
  const status = view.state === "loaded"
    ? `<strong>${escapeHtml(view.recipeId ?? "")}</strong>${view.dirty ? ' <span class="world-builder-dirty">unsaved</span>' : ""}`
    : view.state === "invalid"
      ? '<span class="world-builder-error">The file is not a world recipe.</span>'
      : "No world recipe for this level yet.";
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
      ${view.state === "loaded" ? "" : '<button type="button" data-wb-action="create" data-testid="world-builder-create">Create Recipe</button>'}
      <button type="button" data-wb-action="reload" ${view.dirty ? "disabled title=\"Save or undo recipe changes first\"" : ""}>Reload From Disk</button>
    </div>
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
  return `<div class="detail-section"><div class="detail-section-title">Stages</div>${rows}</div>`;
}

function renderPlan(plan: StagePlan): string {
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
      ${renderList("Kept", plan.kept.map((entry) => `${entry.id} (${keptLabel(entry.reason)})`))}
      ${renderList("Blocked", plan.blocked.map((entry) => `${entry.id} (${blockedLabel(entry.reason)})`))}
      ${renderList("Warnings", plan.warnings)}
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
