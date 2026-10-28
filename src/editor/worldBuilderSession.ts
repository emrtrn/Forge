/**
 * The editor's World Builder state for the open level (plan v0.4 §6.2, §12):
 * its `<Level>.worldrecipe.json`, the region profile the recipe names, and
 * stage dry runs / applies. A stage apply is one history step that swaps the
 * touched placement groups, the touched terrains' spline lists and the recipe
 * together, so undo keeps the level, its terrains and their ownership record
 * in step. The recipe saves with Save Layout, first — before the World Terrain
 * definitions and the level. A failed later step then leaves a recipe naming
 * an object that is not on disk, reported as deleted by hand; the reverse
 * order would leave generated objects looking manual, blocking the stage and
 * outliving their plan element.
 */
import type { EditorCommand } from "@editor/core/history";
import type { RoomLayout } from "@engine/scene/layout";
import { createWorldRecipe, normalizeWorldRecipe, worldRecipePath, type WorldRecipe } from "@engine/worldbuilder/recipe";
import { normalizeRegionProfile, type RegionProfile } from "@engine/worldbuilder/regionProfile";
import {
  planStage,
  type PlacementGroupChange,
  type StagePlan,
  type StageTerrain,
  type TerrainSplineChange,
  type WorldStage,
} from "@engine/worldbuilder/stage";
import { createDefaultWorldStages } from "@engine/worldbuilder/stages";
import { projectFileUrl } from "@/project/ProjectSystem";
import { SaveRevision, type EditorSaveStep } from "./editorSaveCoordinator";

export interface WorldBuilderHost {
  scenePath(): string;
  layout(): RoomLayout | null;
  /** World-space terrain height, or null off-terrain / over a tile not loaded. */
  sampleHeight(x: number, z: number): number | null;
  executeCommand(command: EditorCommand): void;
  /** Writes one side of the group changes into the layout and rebuilds those groups. */
  applyGroupChanges(changes: readonly PlacementGroupChange[], side: "before" | "after"): void;
  /** The level's loaded World Terrains (id, XZ box, paint layers, splines, locked). */
  terrains(): StageTerrain[];
  /** Writes one side of the spline changes into the terrain definitions and rebuilds their splines. */
  applySplineChanges(changes: readonly TerrainSplineChange[], side: "before" | "after"): void;
  onStatus(message: string, tone: "success" | "warning" | "error"): void;
}

export interface WorldBuilderStageView {
  id: string;
  label: string;
  version: number;
  /** The generator version the recipe last recorded for this stage. */
  recordedVersion: number | null;
}

export interface WorldBuilderView {
  path: string;
  /** `missing`: no recipe file yet; `invalid`: the file is not a recipe. */
  state: "missing" | "invalid" | "loaded";
  recipeId: string | null;
  /** Problems the normalizer corrected while loading the recipe. */
  issues: readonly string[];
  profile: { path: string; state: "loaded" | "missing" | "invalid"; label: string | null; issues: readonly string[] } | null;
  dirty: boolean;
  /** `owned`: generated placements and splines. */
  planCounts: { settlements: number; landmarks: number; roadNodes: number; roadEdges: number; owned: number } | null;
  stages: readonly WorldBuilderStageView[];
  /** The last dry run or apply, for the report. */
  lastPlan: StagePlan | null;
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Poster = (url: string, body: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class WorldBuilderSession {
  readonly saveRevision = new SaveRevision();
  readonly stages: readonly WorldStage[];
  private recipe: WorldRecipe | null = null;
  private state: WorldBuilderView["state"] = "missing";
  private issues: string[] = [];
  private profile: RegionProfile | null = null;
  private profileView: WorldBuilderView["profile"] = null;
  private lastPlan: StagePlan | null = null;
  private loadedFor = "";

  constructor(
    private readonly host: WorldBuilderHost,
    private readonly fetchJson: Fetcher = (url) => fetch(url, { cache: "no-cache" }),
    private readonly postJson: Poster = (url, body) =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
    stages: readonly WorldStage[] = createDefaultWorldStages(),
  ) {
    this.stages = stages;
  }

  /** Reads the open level's recipe (and its profile). Discards unsaved recipe edits. */
  async load(scenePath = this.host.scenePath()): Promise<void> {
    this.loadedFor = scenePath;
    this.recipe = null;
    this.state = "missing";
    this.issues = [];
    this.profile = null;
    this.profileView = null;
    this.lastPlan = null;
    this.saveRevision.reset();
    const response = await this.fetchJson(projectFileUrl(worldRecipePath(scenePath))).catch(() => null);
    if (this.loadedFor !== scenePath) return;
    if (response?.ok) {
      const { recipe, issues } = normalizeWorldRecipe(await response.json().catch(() => null));
      if (this.loadedFor !== scenePath) return;
      this.recipe = recipe;
      this.issues = issues;
      this.state = recipe ? "loaded" : "invalid";
    }
    await this.loadProfile();
  }

  /** Re-reads the recipe from disk, e.g. after an AI rewrote it. Refuses over unsaved edits. */
  async reload(): Promise<boolean> {
    if (this.saveRevision.dirty) {
      this.host.onStatus("World recipe has unsaved changes; save or undo them before reloading.", "warning");
      return false;
    }
    await this.load();
    this.host.onStatus(`World recipe reloaded (${this.state}).`, this.state === "loaded" ? "success" : "warning");
    return true;
  }

  /** Starts an empty recipe for the open level; saved with the next Save Layout. */
  createRecipe(): void {
    if (this.recipe) return;
    const name = this.host.scenePath().split("/").pop()?.replace(/(\.level|\.layout)?\.json$/i, "") ?? "level";
    const recipeId = name.replace(/[^A-Za-z0-9_.:-]/g, "_").replace(/^[^A-Za-z0-9]+/, "") || "level";
    const created = createWorldRecipe(recipeId);
    const previousState = this.state;
    this.host.executeCommand({
      label: "Create world recipe",
      redo: () => {
        this.setRecipe(structuredClone(created));
        this.state = "loaded";
      },
      undo: () => {
        this.setRecipe(null);
        this.state = previousState;
      },
    });
  }

  /** Plans a stage without changing anything. */
  dryRun(stageId: string): StagePlan | null {
    const plan = this.plan(stageId);
    if (plan) this.lastPlan = plan;
    return plan;
  }

  /** Plans and applies a stage as one undoable step. False when nothing was applied. */
  apply(stageId: string): boolean {
    const plan = this.plan(stageId);
    if (!plan) return false;
    this.lastPlan = plan;
    if (plan.errors.length > 0) {
      this.host.onStatus(`${plan.stageLabel} has errors; nothing was applied. ${plan.errors[0]}`, "error");
      return false;
    }
    if (plan.empty) {
      this.host.onStatus(`${plan.stageLabel}: already up to date.`, "success");
      return false;
    }
    const before = structuredClone(plan.recipeBefore);
    const after = structuredClone(plan.recipeAfter);
    this.host.executeCommand({
      label: `World Builder: ${plan.stageLabel}`,
      redo: () => {
        this.host.applyGroupChanges(plan.groupChanges, "after");
        this.host.applySplineChanges(plan.splineChanges, "after");
        this.setRecipe(structuredClone(after));
      },
      undo: () => {
        this.host.applySplineChanges(plan.splineChanges, "before");
        this.host.applyGroupChanges(plan.groupChanges, "before");
        this.setRecipe(structuredClone(before));
      },
    });
    return true;
  }

  getView(): WorldBuilderView {
    const recipe = this.recipe;
    return {
      path: worldRecipePath(this.loadedFor || this.host.scenePath()),
      state: this.state,
      recipeId: recipe?.recipeId ?? null,
      issues: this.issues,
      profile: this.profileView,
      dirty: this.saveRevision.dirty,
      planCounts: recipe
        ? {
            settlements: recipe.plan.settlements.length,
            landmarks: recipe.plan.landmarks.length,
            roadNodes: recipe.plan.roadGraph.nodes.length,
            roadEdges: recipe.plan.roadGraph.edges.length,
            owned: Object.keys(recipe.ownership.placements).length + Object.keys(recipe.ownership.splines).length,
          }
        : null,
      stages: this.stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        version: stage.version,
        recordedVersion: recipe?.generators[stage.id] ?? null,
      })),
      lastPlan: this.lastPlan,
    };
  }

  /** The recipe's save step for this Save Layout turn, or null when it is clean. */
  captureSave(): EditorSaveStep | null {
    if (!this.saveRevision.dirty || !this.recipe) return null;
    const level = this.loadedFor || this.host.scenePath();
    const path = worldRecipePath(level);
    const body = JSON.stringify({ level, recipe: this.recipe });
    return this.saveRevision.capture(path, async () => {
      const response = await this.postJson("/__save-worldrecipe", body);
      if (!response.ok) {
        const detail = await response.json().then((json) => (json as { error?: string }).error ?? "", () => "");
        throw new Error(`World recipe save failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
      }
    });
  }

  private plan(stageId: string): StagePlan | null {
    const stage = this.stages.find((entry) => entry.id === stageId);
    const layout = this.host.layout();
    if (!stage || !layout) return null;
    if (!this.recipe) {
      this.host.onStatus("Create or load a world recipe first.", "warning");
      return null;
    }
    return planStage(stage, {
      recipe: this.recipe,
      layout,
      profile: this.profile,
      sampleHeight: (x, z) => this.host.sampleHeight(x, z),
      terrains: this.host.terrains(),
    });
  }

  private setRecipe(recipe: WorldRecipe | null): void {
    this.recipe = recipe;
    this.saveRevision.markDirty();
  }

  private async loadProfile(): Promise<void> {
    const path = this.recipe?.regionProfile;
    if (!path) return;
    const scene = this.loadedFor;
    const response = await this.fetchJson(projectFileUrl(path)).catch(() => null);
    if (this.loadedFor !== scene) return;
    if (!response?.ok) {
      this.profileView = { path, state: "missing", label: null, issues: [] };
      return;
    }
    const { profile, issues } = normalizeRegionProfile(await response.json().catch(() => null));
    this.profile = profile;
    this.profileView = { path, state: profile ? "loaded" : "invalid", label: profile?.label ?? null, issues };
  }
}
