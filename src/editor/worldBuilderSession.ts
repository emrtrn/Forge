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
 *
 * The recipe's generated data — for now each settlement's core — is drawn
 * in the viewport as a layer the host keeps in step with the recipe (load,
 * apply, undo/redo and any history step, since a terrain edit moves the ground
 * it follows); the panel can hide it.
 *
 * A dry run that touches an object is also shown in the viewport (T10):
 * the session builds the preview and the host draws it. Apply accepts it,
 * Clear Preview drops it, and any history step drops it too, since the level
 * it was planned against has changed.
 */
import type { EditorCommand } from "@editor/core/history";
import type { RoomLayout } from "@engine/scene/layout";
import type { TerrainPad } from "@engine/terrain/terrainPads";
import { PAD_FALLOFF } from "@engine/worldbuilder/buildings";
import { createWorldRecipe, normalizeWorldRecipe, worldRecipePath, type GeneratedPad, type WorldRecipe } from "@engine/worldbuilder/recipe";
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
import { gameProgramExtensions } from "./gameEditorRegistry";
import { buildStagePreview, type PreviewItem, type StagePreview } from "./worldBuilderPreview";

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
  /** Bakes pads into the terrains under them as undoable terrain commands, and reports. */
  applyPads(pads: readonly TerrainPad[]): Promise<void>;
  /** Draws the recipe's generated layer (null clears it); returns how many settlement cores it drew. */
  showRecipeLayer(recipe: WorldRecipe | null): number;
  /** Draws a dry run's preview in the viewport (null clears it); returns how many items it drew. */
  showPreview(preview: StagePreview | null): number;
  /** Frames one preview item, or the whole preview when `item` is null. */
  focusPreview(preview: StagePreview, item: PreviewItem | null): void;
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
  /**
   * `loading`: the level (and its terrain) or the recipe is still loading, so
   * nothing may run or be created yet; `missing`: no recipe file yet;
   * `invalid`: the file is not a recipe.
   */
  state: "loading" | "missing" | "invalid" | "loaded";
  recipeId: string | null;
  /** Problems the normalizer corrected while loading the recipe. */
  issues: readonly string[];
  profile: { path: string; state: "loaded" | "missing" | "invalid"; label: string | null; issues: readonly string[] } | null;
  dirty: boolean;
  /** `owned`: generated placements and splines; `pads`: building pads Apply Pads would bake. */
  planCounts: { settlements: number; landmarks: number; roadNodes: number; roadEdges: number; owned: number; pads: number } | null;
  stages: readonly WorldBuilderStageView[];
  /** The last dry run or apply, for the report. */
  lastPlan: StagePlan | null;
  /** The dry run shown in the viewport, and how many of its items were drawn. */
  preview: { preview: StagePreview; drawn: number } | null;
  /** The recipe layer in the viewport: shown or hidden, and how many cores it drew. */
  layer: { visible: boolean; drawn: number };
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Poster = (url: string, body: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class WorldBuilderSession {
  readonly saveRevision = new SaveRevision();
  readonly stages: readonly WorldStage[];
  private recipe: WorldRecipe | null = null;
  private state: WorldBuilderView["state"] = "loading";
  private issues: string[] = [];
  private profile: RegionProfile | null = null;
  private profileView: WorldBuilderView["profile"] = null;
  private lastPlan: StagePlan | null = null;
  private preview: { preview: StagePreview; drawn: number } | null = null;
  private layer = { visible: true, drawn: 0 };
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
    this.state = "loading";
    this.issues = [];
    this.profile = null;
    this.profileView = null;
    this.lastPlan = null;
    this.clearPreview();
    this.refreshLayer();
    this.saveRevision.reset();
    const response = await this.fetchJson(projectFileUrl(worldRecipePath(scenePath))).catch(() => null);
    if (this.loadedFor !== scenePath) return;
    let state: WorldBuilderView["state"] = "missing";
    if (response?.ok) {
      const { recipe, issues } = normalizeWorldRecipe(await response.json().catch(() => null));
      if (this.loadedFor !== scenePath) return;
      this.recipe = recipe;
      this.issues = issues;
      state = recipe ? "loaded" : "invalid";
    }
    // Stages read the profile, so the recipe counts as loaded only with it.
    await this.loadProfile();
    if (this.loadedFor !== scenePath) return;
    this.state = state;
    this.refreshLayer();
  }

  /** Redraws the recipe layer, e.g. after the ground under it changed. */
  refreshLayer(): void {
    this.layer.drawn = this.host.showRecipeLayer(this.layer.visible ? this.recipe : null);
  }

  /** Shows or hides the recipe layer. */
  toggleLayer(): void {
    this.layer.visible = !this.layer.visible;
    this.refreshLayer();
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
    // While loading, "no recipe" only means "not read yet": creating one would overwrite it on save.
    if (this.recipe || this.state === "loading") return;
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

  /**
   * Plans a stage without changing anything. A plan that adds, updates,
   * removes, keeps or blocks an object is previewed in the viewport — kept and
   * blocked ones too, though they alone leave the plan empty.
   */
  dryRun(stageId: string): StagePlan | null {
    const plan = this.plan(stageId);
    if (!plan) return null;
    this.lastPlan = plan;
    const layout = this.host.layout();
    const preview = layout ? buildStagePreview(plan, layout, this.host.terrains()) : null;
    if (preview && preview.items.length > 0) this.preview = { preview, drawn: this.host.showPreview(preview) };
    else this.clearPreview();
    return plan;
  }

  /** Drops the viewport preview of the last dry run. */
  clearPreview(): void {
    if (!this.preview) return;
    this.preview = null;
    this.host.showPreview(null);
  }

  /** Frames a preview item by id, or the whole preview. */
  focusPreview(id?: string): void {
    if (!this.preview) return;
    const item = id ? this.preview.preview.items.find((entry) => entry.id === id) ?? null : null;
    if (id && !item) return;
    this.host.focusPreview(this.preview.preview, item);
  }

  /** Plans and applies a stage as one undoable step. False when nothing was applied. */
  apply(stageId: string): boolean {
    const plan = this.plan(stageId);
    if (!plan) return false;
    this.lastPlan = plan;
    this.clearPreview();
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

  /**
   * Bakes the recipe's building pads into the terrain (decision 19: on request,
   * like a road's Deform). Only pads whose building still stands in the level:
   * a building removed by hand or never placed leaves its ground alone.
   */
  async applyPads(): Promise<void> {
    if (!this.recipe) {
      this.host.onStatus("Create or load a world recipe first.", "warning");
      return;
    }
    const pads = this.standingPads();
    if (pads.length === 0) {
      this.host.onStatus("No building pads to apply; run Buildings first.", "warning");
      return;
    }
    await this.host.applyPads(pads.map((pad) => ({ polygon: pad.polygon, height: pad.height, falloff: PAD_FALLOFF })));
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
            pads: this.standingPads().length,
          }
        : null,
      stages: this.stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        version: stage.version,
        recordedVersion: recipe?.generators[stage.id] ?? null,
      })),
      lastPlan: this.lastPlan,
      preview: this.preview,
      layer: { ...this.layer },
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
    if (this.state === "loading") {
      this.host.onStatus("The level is still loading.", "warning");
      return null;
    }
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
      programExtensions: gameProgramExtensions(),
    });
  }

  /** Recipe pads whose building placement is in the level. */
  private standingPads(): GeneratedPad[] {
    const layout = this.host.layout();
    if (!this.recipe || !layout) return [];
    const ids = new Set(layout.instances.flatMap((group) => group.placements.flatMap((placement) => (placement.id ? [placement.id] : []))));
    return this.recipe.generated.pads.filter((pad) => ids.has(pad.id));
  }

  private setRecipe(recipe: WorldRecipe | null): void {
    this.recipe = recipe;
    this.saveRevision.markDirty();
    this.refreshLayer();
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
