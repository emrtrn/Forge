/**
 * Actor Script editor — Forge's answer to the Unreal Actor Blueprint editor,
 * opened from the Content Browser (double-click a `*.actor.json`). It is a
 * full-screen overlay document arranged like the Blueprint editor: a Components
 * tree + My Blueprint (Variables) on the left, a Viewport placeholder and the
 * Event Bindings ("Event Graph") in the center, and a Details panel on the right,
 * with a Compile/Save/Browse/Play toolbar.
 *
 * Deliberately *not* a visual node graph: an event binding references a behavior
 * `scriptId` + JSON params, and the real logic is TypeScript authored elsewhere
 * (e.g. by AI in `src/game/`). The editor only authors data, persisted to the
 * `*.actor.json` class-asset via the dev `/__save-actor` endpoint.
 *
 * Editor-only: lives behind the dynamic `?editor` import so it never ships in the
 * game build.
 */
import {
  ACTOR_COMPONENT_KINDS,
  ACTOR_EVENT_DESCRIPTIONS,
  ACTOR_EVENT_KINDS,
  ACTOR_EVENT_LABELS,
  GAME_MODE_DEFAULT_PAWN_VARIABLE,
  PARENT_CLASSES,
  PARENT_CLASS_LABELS,
  defaultActorScriptDef,
  isLegacyActorComponentKind,
  isMeshComponentKind,
  normalizeActorScriptDef,
  readGameModeDefaultPawnClassRef,
  type ActorComponentKind,
  type ActorEventKind,
  type ActorScriptDef,
  type ComponentTemplateNode,
  type EventBinding,
  type ParentClass,
} from "@engine/scene/actorScript";
import type { MetadataFieldDef, MetadataFieldType } from "@engine/scene/metadataSchema";
import type { ColliderShape, SceneLightType } from "@engine/scene/components";
import {
  DEFAULT_CAPSULE_HALF_HEIGHT,
  DEFAULT_CAPSULE_RADIUS,
  resolveCapsuleDimensions,
} from "@engine/scene/capsule";
import type { SceneJsonValue } from "@engine/scene/entity";
import type { Vec3 } from "@engine/scene/layout";
import { isModelAssetType, type AssetType } from "@engine/assets/manifest";
import { loadActorScript, saveActorScript } from "@/editor/actorScriptStore";
import { createBehaviorStub } from "@/editor/behaviorStubStore";
import { ActorScriptViewport } from "@/editor/ActorScriptViewport";
import {
  loadAssetSkeleton,
  skeletonClipNames,
  type AssetSkeletonMontageDef,
} from "@/scene/assetSkeletonLoader";
import { getGameEditorCatalog } from "@/editor/gameEditorRegistry";

type StatusTone = "info" | "success" | "warning" | "error";

export interface ActorScriptEditorOptions {
  /** Public-relative path of the `*.actor.json` file. */
  path: string;
  /** Display label (asset name). */
  label: string;
  /** Behavior script ids offered as Event Binding suggestions (free text still allowed). */
  behaviorScriptIds?: readonly string[];
  /** Manifest asset ids offered for MeshRenderer convenience. */
  assetIds?: readonly string[];
  /** Manifest assets (id/name/type/path): the MeshRenderer mesh picker + viewport previews. */
  assets?: ReadonlyArray<{ id: string; name: string; assetType: string; path: string }>;
  /**
   * Project `character`/`pawn` Actor Script classes offered as a Game Mode's
   * Default Pawn Class (the picker shown when editing a `gameMode` class).
   */
  pawnClassRefs?: ReadonlyArray<{ path: string; name: string }>;
  onStatus?: (message: string, tone?: StatusTone) => void;
  /** Reveal this asset in the Content Browser (Toolbar → Browse). */
  onBrowse?: () => void;
  /** Enter Play mode / launch the runtime (Toolbar → Play). Saves first. */
  onPlay?: () => void;
}

type Selection =
  | { kind: "class" }
  | { kind: "component"; id: string }
  | { kind: "variable"; index: number }
  | { kind: "interface"; index: number }
  | { kind: "reference"; index: number }
  | { kind: "dispatcher"; index: number }
  | { kind: "event"; index: number }
  | { kind: "message"; index: number };

const METADATA_FIELD_TYPES: readonly MetadataFieldType[] = [
  "text",
  "number",
  "boolean",
  "select",
  "tags",
];

const COMPONENT_ICONS: Record<ActorComponentKind, string> = {
  Transform: "✥",
  StaticMeshComponent: "◰",
  SkeletalMeshComponent: "⛷",
  MeshRenderer: "◰",
  Collider: "▢",
  Audio: "♪",
  ParticleEmitter: "✺",
  Light: "☀",
  Interaction: "☞",
  Behavior: "⚙",
  CharacterMovement: "CM",
  SplinePathFollower: "SP",
  SmartObject: "SO",
  SpringArm: "⌐",
  Camera: "🎥",
  AIController: "🧠",
  Vehicle: "🚗",
  VehicleAiDriver: "AI🚗",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class ActorScriptEditor {
  private static activeInstance: ActorScriptEditor | null = null;

  static async open(options: ActorScriptEditorOptions): Promise<ActorScriptEditor> {
    ActorScriptEditor.activeInstance?.close();
    const editor = new ActorScriptEditor(options);
    ActorScriptEditor.activeInstance = editor;
    await editor.load();
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly parentBadge: HTMLElement;
  private readonly componentsHost: HTMLElement;
  private readonly blueprintHost: HTMLElement;
  private readonly eventsHost: HTMLElement;
  private readonly detailsHost: HTMLElement;
  private readonly viewportHost: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly compileStatusEl: HTMLElement;

  private def: ActorScriptDef;
  private selection: Selection = { kind: "class" };
  private dirty = false;
  private disposed = false;
  private nodeSeq = 0;

  /** 3D preview of the component tree (lazily created on first render). */
  private viewport: ActorScriptViewport | null = null;
  /** Last component-tree signature built into the viewport (skips redundant rebuilds). */
  private lastBuildSignature = "";
  private viewportSyncTimer: number | undefined;
  private modelPathById: Map<string, string> | null = null;
  /** Cached montages per skeletalMesh asset id, for the read-only montage-input panel. */
  private readonly montagesByAssetId = new Map<string, readonly AssetSkeletonMontageDef[]>();
  /** Cached clip names per skeletalMesh asset id, for the Animation clip dropdown. */
  private readonly clipsByAssetId = new Map<string, readonly string[]>();
  /** Asset ids whose skeleton sidecar load was already kicked off (avoid refetch). */
  private readonly skeletonLoadStarted = new Set<string>();

  private constructor(private readonly options: ActorScriptEditorOptions) {
    this.def = defaultActorScriptDef(options.label);

    this.overlay = document.createElement("div");
    this.overlay.className = "as-editor-overlay";
    this.overlay.innerHTML = `
      <div class="as-editor-window">
        <header class="as-editor-header">
          <span class="as-editor-tab">
            <span class="as-editor-tab-icon">◈</span>
            <strong data-as-title></strong>
            <span class="as-editor-badge" data-as-parent></span>
          </span>
          <div class="as-editor-header-actions">
            <button type="button" class="as-editor-save" data-as-save title="Save (Ctrl+S)">Save</button>
            <button type="button" class="as-editor-close" data-as-close title="Close (Esc)">✕</button>
          </div>
        </header>
        <div class="as-editor-toolbar">
          <button type="button" data-as-compile title="Validate this class">▣ Compile</button>
          <button type="button" data-as-tb-save title="Save (Ctrl+S)">💾 Save</button>
          <button type="button" data-as-browse title="Reveal in Content Browser">🔎 Browse</button>
          <button type="button" data-as-play title="Save & launch the runtime">▶ Play</button>
          <span class="as-editor-toolbar-spacer"></span>
          <span class="as-editor-compile-status" data-as-compile-status></span>
        </div>
        <div class="as-editor-body">
          <aside class="as-editor-left">
            <section class="as-editor-panel" data-as-components></section>
            <section class="as-editor-panel" data-as-myblueprint></section>
          </aside>
          <main class="as-editor-center">
            <div class="as-editor-viewport" data-as-viewport></div>
            <section class="as-editor-panel as-editor-graph" data-as-events></section>
          </main>
          <aside class="as-editor-details" data-as-details></aside>
        </div>
        <footer class="as-editor-status" data-as-status>Loading…</footer>
      </div>
    `;
    document.body.append(this.overlay);

    this.titleEl = this.requireEl("[data-as-title]");
    this.parentBadge = this.requireEl("[data-as-parent]");
    this.componentsHost = this.requireEl("[data-as-components]");
    this.blueprintHost = this.requireEl("[data-as-myblueprint]");
    this.eventsHost = this.requireEl("[data-as-events]");
    this.detailsHost = this.requireEl("[data-as-details]");
    this.viewportHost = this.requireEl("[data-as-viewport]");
    this.statusEl = this.requireEl("[data-as-status]");
    this.compileStatusEl = this.requireEl("[data-as-compile-status]");

    this.requireEl<HTMLButtonElement>("[data-as-close]").addEventListener("click", () =>
      this.close(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-save]").addEventListener("click", () =>
      void this.save(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-tb-save]").addEventListener("click", () =>
      void this.save(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-compile]").addEventListener("click", () =>
      this.compile(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-browse]").addEventListener("click", () =>
      this.options.onBrowse?.(),
    );
    this.requireEl<HTMLButtonElement>("[data-as-play]").addEventListener("click", () =>
      void this.play(),
    );

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
  }

  private requireEl<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`ActorScriptEditor: missing element ${selector}`);
    return el;
  }

  private async load(): Promise<void> {
    try {
      this.def = await loadActorScript(this.options.path, this.options.label);
      this.dirty = false;
      this.selection = { kind: "class" };
      this.render();
      this.setStatus("Ready.");
    } catch (error) {
      this.render();
      this.setStatus(`Failed to load: ${describeError(error)}`, "error");
    }
  }

  // --- rendering ----------------------------------------------------------

  private render(): void {
    if (this.disposed) return;
    this.titleEl.textContent = this.def.name;
    this.parentBadge.textContent = PARENT_CLASS_LABELS[this.def.parentClass];
    this.renderComponents();
    this.renderBlueprint();
    this.renderEvents();
    this.renderViewport();
    this.renderDetails();
  }

  /** Rebuilds only the list panels (keeps Details inputs focused during typing). */
  private refreshLists(): void {
    if (this.disposed) return;
    this.titleEl.textContent = this.def.name;
    this.parentBadge.textContent = PARENT_CLASS_LABELS[this.def.parentClass];
    this.renderComponents();
    this.renderBlueprint();
    this.renderEvents();
    this.renderViewport();
  }

  private renderComponents(): void {
    const childrenOf = (parent: string | undefined): ComponentTemplateNode[] =>
      this.def.components.filter((node) => node.parent === parent);
    const renderNode = (node: ComponentTemplateNode, depth: number): string => {
      const selected =
        this.selection.kind === "component" && this.selection.id === node.id ? " is-selected" : "";
      const icon = COMPONENT_ICONS[node.component] ?? "▪";
      const isRoot = node.parent === undefined;
      const rows = [
        `<div class="as-tree-row${selected}" data-as-node="${escapeHtml(node.id)}" style="padding-left:${8 + depth * 14}px">
          <span class="as-tree-icon">${icon}</span>
          <span class="as-tree-label">${escapeHtml(node.id)}</span>
          <span class="as-tree-kind">${escapeHtml(node.component)}</span>
          ${isRoot ? "" : `<button type="button" class="as-tree-del" data-as-del-node="${escapeHtml(node.id)}" title="Delete">✕</button>`}
        </div>`,
      ];
      for (const child of childrenOf(node.id)) rows.push(renderNode(child, depth + 1));
      return rows.join("");
    };
    const tree = childrenOf(undefined).map((root) => renderNode(root, 0)).join("");
    const options = ACTOR_COMPONENT_KINDS.filter(
      (kind) => kind !== "Transform" && !isLegacyActorComponentKind(kind),
    )
      .map((kind) => `<option value="${kind}">${kind}</option>`)
      .join("");
    this.componentsHost.innerHTML = `
      <div class="as-panel-head">
        <span>Components</span>
        <select class="as-add-select" data-as-add-component title="Add Component">
          <option value="">+ Add</option>
          ${options}
        </select>
      </div>
      <div class="as-tree">${tree}</div>
    `;
    this.componentsHost.querySelectorAll<HTMLElement>("[data-as-node]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-as-del-node]")) return;
        this.select({ kind: "component", id: row.dataset.asNode ?? "" });
      });
    });
    this.componentsHost.querySelectorAll<HTMLElement>("[data-as-del-node]").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteComponent(btn.dataset.asDelNode ?? ""));
    });
    const addSelect = this.componentsHost.querySelector<HTMLSelectElement>("[data-as-add-component]");
    addSelect?.addEventListener("change", () => {
      const kind = addSelect.value as ActorComponentKind | "";
      addSelect.value = "";
      if (kind) this.addComponent(kind);
    });
  }

  private renderBlueprint(): void {
    const rows = this.def.variables
      .map((variable, index) => {
        const selected =
          this.selection.kind === "variable" && this.selection.index === index
            ? " is-selected"
            : "";
        return `<div class="as-list-row${selected}" data-as-var="${index}">
          <span class="as-list-icon">◆</span>
          <span class="as-list-label">${escapeHtml(variable.label || variable.key)}</span>
          <span class="as-list-kind">${escapeHtml(variable.type)}</span>
          <button type="button" class="as-list-del" data-as-del-var="${index}" title="Delete">✕</button>
        </div>`;
      })
      .join("");
    this.blueprintHost.innerHTML = `
      <div class="as-panel-head">
        <span>My Blueprint · Variables</span>
        <button type="button" class="as-add-btn" data-as-add-var title="Add Variable">+ Variable</button>
      </div>
      <div class="as-list">${rows || '<div class="as-empty">No variables.</div>'}</div>
    `;
    this.blueprintHost.querySelectorAll<HTMLElement>("[data-as-var]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-as-del-var]")) return;
        this.select({ kind: "variable", index: Number(row.dataset.asVar) });
      });
    });
    this.blueprintHost.querySelectorAll<HTMLElement>("[data-as-del-var]").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteVariable(Number(btn.dataset.asDelVar)));
    });
    this.blueprintHost
      .querySelector<HTMLButtonElement>("[data-as-add-var]")
      ?.addEventListener("click", () => this.addVariable());
  }

  private renderEvents(): void {
    const rows = this.def.eventBindings
      .map((binding, index) => {
        const selected =
          this.selection.kind === "event" && this.selection.index === index ? " is-selected" : "";
        return `<div class="as-list-row${selected}" data-as-event="${index}">
          <span class="as-list-icon">⏵</span>
          <span class="as-list-label">${escapeHtml(ACTOR_EVENT_LABELS[binding.event])}</span>
          <span class="as-list-kind">${escapeHtml(binding.scriptId || "(no script)")}</span>
          <button type="button" class="as-list-del" data-as-del-event="${index}" title="Delete">✕</button>
        </div>`;
      })
      .join("");
    this.eventsHost.innerHTML = `
      <div class="as-panel-head">
        <span>Event Graph · Bindings</span>
        <button type="button" class="as-add-btn" data-as-add-event title="Add Binding">+ Binding</button>
      </div>
      <div class="as-graph-hint">Each binding maps an event to a behavior script (TypeScript) + params.</div>
      <div class="as-list">${rows || '<div class="as-empty">No event bindings.</div>'}</div>
    `;
    this.eventsHost.querySelectorAll<HTMLElement>("[data-as-event]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-as-del-event]")) return;
        this.select({ kind: "event", index: Number(row.dataset.asEvent) });
      });
    });
    this.eventsHost.querySelectorAll<HTMLElement>("[data-as-del-event]").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteEvent(Number(btn.dataset.asDelEvent)));
    });
    this.eventsHost
      .querySelector<HTMLButtonElement>("[data-as-add-event]")
      ?.addEventListener("click", () => this.addEvent());
  }

  /** Ensures the 3D viewport exists, then syncs the tree + selection into it. */
  private renderViewport(): void {
    if (this.disposed) return;
    if (!this.viewport) {
      this.viewport = new ActorScriptViewport({
        host: this.viewportHost,
        resolveModelPath: (assetId) => this.resolveModelPath(assetId),
        onPickNode: (nodeId) => {
          if (nodeId) this.select({ kind: "component", id: nodeId });
        },
        onTransformNode: (nodeId, transform) => this.applyNodeTransform(nodeId, transform),
      });
      this.lastBuildSignature = "";
    }
    this.syncViewport();
  }

  /** Rebuilds the preview only when the component tree changed; always re-highlights. */
  private syncViewport(): void {
    if (!this.viewport) return;
    const signature = JSON.stringify(this.def.components);
    if (signature !== this.lastBuildSignature) {
      this.lastBuildSignature = signature;
      this.viewport.setDef(this.def);
    }
    this.viewport.setSelection(this.selection.kind === "component" ? this.selection.id : null);
  }

  /** Debounced viewport sync for live prop edits (avoids rebuilding per keystroke). */
  private scheduleViewportSync(): void {
    if (this.viewportSyncTimer !== undefined) return;
    this.viewportSyncTimer = window.setTimeout(() => {
      this.viewportSyncTimer = undefined;
      this.syncViewport();
    }, 150);
  }

  /**
   * Writes a viewport gizmo edit back into the node's props. The viewport group
   * already shows the new transform, so the build signature is advanced to skip a
   * redundant rebuild; the Details transform inputs are refreshed in place.
   */
  private applyNodeTransform(
    nodeId: string,
    transform: { position: Vec3; rotation: Vec3; scale: Vec3 },
  ): void {
    const node = this.def.components.find((n) => n.id === nodeId);
    if (!node) return;
    setVec3Prop(node.props, "position", transform.position, [0, 0, 0]);
    setVec3Prop(node.props, "rotation", transform.rotation, [0, 0, 0]);
    setVec3Prop(node.props, "scale", transform.scale, [1, 1, 1]);
    this.markDirty();
    // The viewport already reflects this edit; keep the signature in sync so a
    // later selection-driven render does not pointlessly rebuild the scene.
    this.lastBuildSignature = JSON.stringify(this.def.components);
    if (this.selection.kind === "component" && this.selection.id === nodeId) {
      this.updateTransformInputs(node);
    }
  }

  /** Updates the Details Transform inputs (+ raw-props view) to match the node's props. */
  private updateTransformInputs(node: ComponentTemplateNode): void {
    for (const key of ["position", "rotation", "scale"] as const) {
      const row = this.detailsHost.querySelector<HTMLElement>(`[data-as-vec="${key}"]`);
      if (!row) continue;
      const vec = readVec3Prop(node.props[key], key === "scale" ? [1, 1, 1] : [0, 0, 0]);
      row.querySelectorAll<HTMLInputElement>("input").forEach((input, i) => {
        input.value = String(vec[i]);
      });
    }
    // Keep the collapsed raw-props JSON in sync (not focused during a gizmo drag).
    const props = this.detailsHost.querySelector<HTMLTextAreaElement>("[data-as-node-props]");
    if (props && document.activeElement !== props) {
      props.value = JSON.stringify(node.props, null, 2);
    }
  }

  /** Maps a manifest asset id to its public-relative model path (mesh nodes only). */
  private resolveModelPath(assetId: string): string | undefined {
    if (!this.modelPathById) {
      this.modelPathById = new Map();
      for (const asset of this.options.assets ?? []) {
        if (isModelAssetType(asset.assetType as AssetType)) {
          this.modelPathById.set(asset.id, asset.path);
        }
      }
    }
    return this.modelPathById.get(assetId);
  }

  /** Model assets ({id,name}) offered by the legacy MeshRenderer mesh picker, name-sorted. */
  private modelAssets(): Array<{ id: string; name: string }> {
    return (this.options.assets ?? [])
      .filter((asset) => isModelAssetType(asset.assetType as AssetType))
      .map((asset) => ({ id: asset.id, name: asset.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Manifest assets of a single model type ({id,name}), name-sorted. */
  private meshAssetsOfType(type: "staticMesh" | "skeletalMesh"): Array<{ id: string; name: string }> {
    return (this.options.assets ?? [])
      .filter((asset) => asset.assetType === type)
      .map((asset) => ({ id: asset.id, name: asset.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Mesh assets offered by a mesh component's picker: StaticMeshComponent lists
   * only `staticMesh`, SkeletalMeshComponent only `skeletalMesh`, and the legacy
   * MeshRenderer lists all models (so old files keep every option).
   */
  private meshAssetsForKind(kind: ActorComponentKind): Array<{ id: string; name: string }> {
    if (kind === "StaticMeshComponent") return this.meshAssetsOfType("staticMesh");
    if (kind === "SkeletalMeshComponent") return this.meshAssetsOfType("skeletalMesh");
    return this.modelAssets();
  }

  /** Effect assets ({id,name}) offered by the ParticleEmitter effect picker, name-sorted. */
  private effectAssets(): Array<{ id: string; name: string }> {
    return (this.options.assets ?? [])
      .filter((asset) => asset.path.toLowerCase().endsWith(".effect.json"))
      .map((asset) => ({ id: asset.id, name: asset.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- details forms ------------------------------------------------------

  private renderDetails(): void {
    const host = this.detailsHost;
    switch (this.selection.kind) {
      case "class":
        host.innerHTML = this.detailsClass();
        this.bindClassDetails();
        break;
      case "component":
        host.innerHTML = this.detailsComponent();
        this.bindComponentDetails();
        break;
      case "variable":
        host.innerHTML = this.detailsVariable();
        this.bindVariableDetails();
        break;
      case "event":
        host.innerHTML = this.detailsEvent();
        this.bindEventDetails();
        break;
    }
  }

  private detailsClass(): string {
    const parentOptions = PARENT_CLASSES.map(
      (cls) =>
        `<option value="${cls}" ${cls === this.def.parentClass ? "selected" : ""}>${PARENT_CLASS_LABELS[cls]}</option>`,
    ).join("");
    return `
      <div class="as-details-head">Class Defaults</div>
      <label class="as-field">
        <span>Name</span>
        <input type="text" data-as-class-name value="${escapeHtml(this.def.name)}" />
      </label>
      <label class="as-field">
        <span>Parent Class</span>
        <select data-as-class-parent>${parentOptions}</select>
      </label>
      ${this.gameModeDefaultsSection()}
      <label class="as-field">
        <span>Interfaces</span>
        <input type="text" data-as-class-interfaces value="${escapeHtml(this.def.interfaces.join(", "))}" placeholder="Usable, Toggleable" />
      </label>
      <label class="as-field">
        <span>References (JSON)</span>
        <textarea data-as-class-references rows="4">${escapeHtml(JSON.stringify(this.def.references, null, 2))}</textarea>
      </label>
      <div class="as-json-error" data-as-class-references-error></div>
      <label class="as-field">
        <span>Dispatchers (JSON)</span>
        <textarea data-as-class-dispatchers rows="4">${escapeHtml(JSON.stringify(this.def.dispatchers, null, 2))}</textarea>
      </label>
      <div class="as-json-error" data-as-class-dispatchers-error></div>
      <label class="as-field">
        <span>Message Bindings (JSON)</span>
        <textarea data-as-class-message-bindings rows="5">${escapeHtml(JSON.stringify(this.def.messageBindings, null, 2))}</textarea>
      </label>
      <div class="as-json-error" data-as-class-message-bindings-error></div>
      ${this.actorInspectSummary()}
      <p class="as-details-note">This class is saved to <code>${escapeHtml(this.options.path)}</code>.</p>
    `;
  }

  /**
   * Game Mode "Class Defaults" picker (Unreal's `DefaultPawnClass`): only for a
   * `gameMode` class. Lists the project's `character`/`pawn` Actor Scripts so the
   * user assigns the default player without typing a path. Stored in the
   * {@link GAME_MODE_DEFAULT_PAWN_VARIABLE} variable's default, matching the
   * runtime reader. Empty for any other parent class.
   */
  private gameModeDefaultsSection(): string {
    if (this.def.parentClass !== "gameMode") return "";
    const current = readGameModeDefaultPawnClassRef(this.def) ?? "";
    const pawns = this.options.pawnClassRefs ?? [];
    const options = [
      `<option value="" ${current === "" ? "selected" : ""}>— None —</option>`,
      ...pawns.map(
        (pawn) =>
          `<option value="${escapeHtml(pawn.path)}" ${
            pawn.path === current ? "selected" : ""
          }>${escapeHtml(pawn.name)}</option>`,
      ),
    ];
    // Keep a not-yet-discovered selection visible so it round-trips on save.
    if (current && !pawns.some((pawn) => pawn.path === current)) {
      options.push(`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`);
    }
    const hint = pawns.length
      ? "Spawned at the Player Start when the scene has no authored player."
      : "No Character/Pawn Actor Scripts found in this project yet.";
    return `
      <div class="as-section-label">Game Mode <small>class defaults</small></div>
      <label class="as-field">
        <span>Default Pawn Class</span>
        <select data-as-default-pawn>${options.join("")}</select>
      </label>
      <p class="as-details-note">${hint}</p>
    `;
  }

  /**
   * Writes the Game Mode default pawn class ref into the
   * {@link GAME_MODE_DEFAULT_PAWN_VARIABLE} variable (created on demand). Empty
   * clears it by dropping the variable, keeping the class file tidy.
   */
  private setDefaultPawnClassRef(classRef: string): void {
    const others = this.def.variables.filter(
      (field) => field.key !== GAME_MODE_DEFAULT_PAWN_VARIABLE,
    );
    if (classRef) {
      others.push({
        key: GAME_MODE_DEFAULT_PAWN_VARIABLE,
        label: "Default Pawn Class",
        type: "text",
        default: classRef,
      });
    }
    this.def.variables = others;
    this.markDirty();
    this.refreshLists();
  }

  private actorInspectSummary(): string {
    const interfaces = this.def.interfaces.length
      ? this.def.interfaces.map((name) => `<code>${escapeHtml(name)}</code>`).join("")
      : `<span class="as-inspect-empty">none</span>`;
    const dispatchers = this.def.dispatchers.length
      ? this.def.dispatchers
          .map((dispatcher) => {
            const payload = dispatcher.payload ?? {};
            const payloadText = Object.keys(payload).length
              ? ` ${escapeHtml(JSON.stringify(payload))}`
              : "";
            return `<li><code>${escapeHtml(dispatcher.name)}</code><span>${payloadText}</span></li>`;
          })
          .join("")
      : `<li class="as-inspect-empty">none</li>`;
    const subscribers = this.def.messageBindings.length
      ? this.def.messageBindings
          .map(
            (binding) =>
              `<li><code>${escapeHtml(binding.message)}</code><span>${escapeHtml(binding.target ?? "self")} -> ${escapeHtml(binding.scriptId)}</span></li>`,
          )
          .join("")
      : `<li class="as-inspect-empty">none</li>`;
    return `
      <div class="as-section-label">Actor Inspect <small>runtime metadata</small></div>
      <div class="as-inspect">
        <div class="as-inspect-row"><span>Interfaces</span><div class="as-inspect-chips">${interfaces}</div></div>
        <div class="as-inspect-row"><span>Dispatchers</span><ul>${dispatchers}</ul></div>
        <div class="as-inspect-row"><span>Subscribers</span><ul>${subscribers}</ul></div>
      </div>
    `;
  }

  private bindClassDetails(): void {
    const name = this.detailsHost.querySelector<HTMLInputElement>("[data-as-class-name]");
    name?.addEventListener("input", () => {
      this.def.name = name.value;
      this.markDirty();
      this.titleEl.textContent = this.def.name;
    });
    name?.addEventListener("change", () => this.refreshLists());
    const parent = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-class-parent]");
    parent?.addEventListener("change", () => {
      this.def.parentClass = parent.value as ParentClass;
      this.normalizeDefForEditor();
      this.markDirty();
      this.refreshLists();
      // Show/hide the Game Mode "Default Pawn Class" picker for the new parent.
      this.renderDetails();
    });
    const defaultPawn = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-default-pawn]");
    defaultPawn?.addEventListener("change", () => this.setDefaultPawnClassRef(defaultPawn.value));
    const interfaces = this.detailsHost.querySelector<HTMLInputElement>("[data-as-class-interfaces]");
    interfaces?.addEventListener("input", () => {
      this.def.interfaces = uniqueNonEmptyCsv(interfaces.value);
      this.markDirty();
    });
    this.bindJsonArrayField("[data-as-class-references]", "[data-as-class-references-error]", (value) => {
      this.def.references = value as ActorScriptDef["references"];
    });
    this.bindJsonArrayField("[data-as-class-dispatchers]", "[data-as-class-dispatchers-error]", (value) => {
      this.def.dispatchers = value as ActorScriptDef["dispatchers"];
    });
    this.bindJsonArrayField(
      "[data-as-class-message-bindings]",
      "[data-as-class-message-bindings-error]",
      (value) => {
        this.def.messageBindings = value as ActorScriptDef["messageBindings"];
      },
    );
  }

  private bindJsonArrayField(
    inputSelector: string,
    errorSelector: string,
    apply: (value: unknown[]) => void,
  ): void {
    const input = this.detailsHost.querySelector<HTMLTextAreaElement>(inputSelector);
    const error = this.detailsHost.querySelector<HTMLElement>(errorSelector);
    input?.addEventListener("input", () => {
      try {
        const parsed = JSON.parse(input.value.trim() || "[]") as unknown;
        if (!Array.isArray(parsed)) throw new Error("Must be a JSON array.");
        apply(parsed);
        this.def = normalizeActorScriptDef(this.def, this.def.name);
        this.markDirty();
        if (error) error.textContent = "";
        input.classList.remove("is-invalid");
      } catch (err) {
        if (error) error.textContent = describeError(err);
        input.classList.add("is-invalid");
      }
    });
  }

  private selectedComponent(): ComponentTemplateNode | undefined {
    if (this.selection.kind !== "component") return undefined;
    const id = this.selection.id;
    return this.def.components.find((node) => node.id === id);
  }

  private detailsComponent(): string {
    const node = this.selectedComponent();
    if (!node) return `<div class="as-details-head">Component</div><p class="as-empty">Not found.</p>`;
    const isRoot = node.parent === undefined;
    const kindOptions = ACTOR_COMPONENT_KINDS.filter(
      // Hide legacy kinds unless this node already is one (so it round-trips).
      (kind) => !isLegacyActorComponentKind(kind) || kind === node.component,
    )
      .map(
        (kind) => `<option value="${kind}" ${kind === node.component ? "selected" : ""}>${kind}</option>`,
      )
      .join("");
    const parentOptions = [
      `<option value="" ${isRoot ? "selected" : ""}>— none (root)</option>`,
      ...this.def.components
        .filter((other) => other.id !== node.id)
        .map(
          (other) =>
            `<option value="${escapeHtml(other.id)}" ${other.id === node.parent ? "selected" : ""}>${escapeHtml(other.id)}</option>`,
        ),
    ].join("");
    const colliderField = node.component === "Collider" ? colliderFields(node) : "";
    const meshField = isMeshComponentKind(node.component) ? this.meshPickerField(node) : "";
    const animationField =
      node.component === "SkeletalMeshComponent" ? this.skeletalAnimationField(node) : "";
    // Montage inputs are skeletal-only (legacy MeshRenderer gates internally on a
    // skeletalMesh assetId); a StaticMeshComponent never shows them.
    const montageInputField =
      node.component === "SkeletalMeshComponent" || node.component === "MeshRenderer"
        ? this.montageInputField(node)
        : "";
    const lightField = node.component === "Light" ? lightFields(node) : "";
    const particleField = node.component === "ParticleEmitter" ? this.particleFields(node) : "";
    const audioField = node.component === "Audio" ? this.audioFields(node) : "";
    const characterMovementField =
      node.component === "CharacterMovement" ? characterMovementFields(node) : "";
    const cameraField = node.component === "Camera" ? cameraFields(node) : "";
    const springArmField = node.component === "SpringArm" ? springArmFields(node) : "";
    const aiControllerField = node.component === "AIController" ? this.aiControllerFields(node) : "";
    const pos = readVec3Prop(node.props.position, [0, 0, 0]);
    const rot = readVec3Prop(node.props.rotation, [0, 0, 0]);
    const scl = readVec3Prop(node.props.scale, [1, 1, 1]);
    const transformRows =
      node.component === "Collider"
        ? `${vec3Row("position", "Position", pos)}`
        : `${vec3Row("position", "Position", pos)}
      ${vec3Row("rotation", "Rotation°", rot)}
      ${vec3Row("scale", "Scale", scl)}`;
    return `
      <div class="as-details-head">Component · ${escapeHtml(node.component)}</div>
      <label class="as-field">
        <span>Id</span>
        <input type="text" data-as-node-id value="${escapeHtml(node.id)}" />
      </label>
      <label class="as-field">
        <span>Component</span>
        <select data-as-node-kind ${isRoot ? "disabled" : ""}>${kindOptions}</select>
      </label>
      <label class="as-field">
        <span>Parent</span>
        <select data-as-node-parent ${isRoot ? "disabled" : ""}>${parentOptions}</select>
      </label>
      ${colliderField}
      ${meshField}
      ${animationField}
      ${montageInputField}
      ${lightField}
      ${particleField}
      ${audioField}
      ${characterMovementField}
      ${springArmField}
      ${cameraField}
      ${aiControllerField}
      <div class="as-section-label">Transform <small>(preview)</small></div>
      ${transformRows}
      <details class="as-advanced">
        <summary>Advanced · raw props (JSON)</summary>
        <textarea data-as-node-props rows="7">${escapeHtml(JSON.stringify(node.props, null, 2))}</textarea>
        <div class="as-json-error" data-as-node-props-error></div>
      </details>
    `;
  }

  /**
   * The mesh component "Mesh" dropdown: assets filtered by the node's kind
   * (static/skeletal/legacy) by name → sets props.assetId. An unknown/hand-typed
   * id is preserved so the picker never silently drops it.
   */
  private meshPickerField(node: ComponentTemplateNode): string {
    const current = typeof node.props.assetId === "string" ? node.props.assetId : "";
    const assets = this.meshAssetsForKind(node.component);
    const known = assets.some((asset) => asset.id === current);
    const options = [
      `<option value="" ${current ? "" : "selected"}>— none —</option>`,
      ...assets.map(
        (asset) =>
          `<option value="${escapeHtml(asset.id)}" ${asset.id === current ? "selected" : ""}>${escapeHtml(asset.name)}</option>`,
      ),
      // Preserve an unknown/hand-typed id so the picker never silently drops it.
      ...(current && !known
        ? [`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (unknown)</option>`]
        : []),
    ].join("");
    return `
      <label class="as-field">
        <span>Mesh</span>
        <select data-as-node-mesh>${options}</select>
      </label>
    `;
  }

  /**
   * The SkeletalMeshComponent "Animation" dropdown: the clip that plays in Play
   * mode (props.animation). Clips come from the selected mesh's `*.skeleton.json`
   * sidecar (loaded lazily like the montage panel). An unknown/hand-typed value is
   * preserved so it round-trips; with no mesh or no clips a clear empty state shows.
   */
  private skeletalAnimationField(node: ComponentTemplateNode): string {
    const assetId = typeof node.props.assetId === "string" ? node.props.assetId : "";
    const current = typeof node.props.animation === "string" ? node.props.animation : "";
    if (!assetId) {
      return `
        <div class="as-section-label">Animation</div>
        <p class="as-details-note">Pick a skeletal mesh to choose a Play-mode clip.</p>
      `;
    }
    const clips = this.clipsByAssetId.get(assetId);
    if (!clips) {
      void this.ensureSkeletonLoaded(assetId, node.id);
      return `
        <div class="as-section-label">Animation</div>
        <div class="as-inspect"><div class="as-empty">Loading clips…</div></div>
      `;
    }
    const known = clips.includes(current);
    const options = [
      `<option value="" ${current ? "" : "selected"}>— none —</option>`,
      ...clips.map(
        (clip) =>
          `<option value="${escapeHtml(clip)}" ${clip === current ? "selected" : ""}>${escapeHtml(clip)}</option>`,
      ),
      ...(current && !known
        ? [`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (unknown)</option>`]
        : []),
    ].join("");
    const emptyNote =
      clips.length === 0
        ? `<p class="as-details-note">This mesh's skeleton defines no clips yet.</p>`
        : "";
    return `
      <label class="as-field">
        <span>Animation</span>
        <select data-as-node-animation>${options}</select>
      </label>
      ${emptyNote}
    `;
  }

  private assetTypeById(assetId: string): string | undefined {
    return (this.options.assets ?? []).find((asset) => asset.id === assetId)?.assetType;
  }

  /** AI assets ({path,name}) of a given manifest type, name-sorted, for the AI pickers. */
  private aiAssetsByType(
    assetType: "behaviorTree" | "blackboard" | "stateTree",
  ): Array<{ path: string; name: string }> {
    return (this.options.assets ?? [])
      .filter((asset) => asset.assetType === assetType)
      .map((asset) => ({ path: asset.path, name: asset.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Behavior Tree + State Tree + Blackboard asset pickers plus the perception /
   * nav-agent tuning for an AIController component. The runtime reader keys off
   * asset *paths* (`props.behaviorTree` / `props.stateTree` / `props.blackboard`),
   * so those dropdowns store the path (a StateTree wins over a Behavior Tree at
   * runtime when both are set); an unknown/hand-typed path is preserved as an option so the picker
   * never silently drops it. Perception (`props.perception`) and nav-agent
   * (`props.navAgent`) are nested objects consumed by `readAIControllerComponent`
   * (`readPerceptionConfig` / `readNavAgentConfig`); each numeric field writes
   * into its nested object so the shape round-trips through save.
   */
  private aiControllerFields(node: ComponentTemplateNode): string {
    const behaviorTree = this.assetPathPickerField(
      "data-as-ai-behavior",
      "Behavior Tree",
      typeof node.props.behaviorTree === "string" ? node.props.behaviorTree : "",
      this.aiAssetsByType("behaviorTree"),
    );
    const stateTree = this.assetPathPickerField(
      "data-as-ai-statetree",
      "State Tree",
      typeof node.props.stateTree === "string" ? node.props.stateTree : "",
      this.aiAssetsByType("stateTree"),
    );
    const blackboard = this.assetPathPickerField(
      "data-as-ai-blackboard",
      "Blackboard",
      typeof node.props.blackboard === "string" ? node.props.blackboard : "",
      this.aiAssetsByType("blackboard"),
    );
    const perception = readObjectProp(node.props.perception);
    const navAgent = readObjectProp(node.props.navAgent);
    const patrolRoute = readObjectProp(node.props.patrolRoute);
    const patrolSource = patrolRoute.source === "spline" ? "spline" : "targetPoints";
    const perceptionField = (key: string, label: string, fallback: number, attrs: string): string => `
      <label class="as-field">
        <span>${label}</span>
        <input type="number" data-as-ai-perception-num="${key}" value="${readNumberProp(
          perception[key],
          fallback,
        )}" ${attrs} />
      </label>`;
    const navField = (key: string, label: string, fallback: number, attrs: string): string => `
      <label class="as-field">
        <span>${label}</span>
        <input type="number" data-as-ai-nav-num="${key}" value="${readNumberProp(
          navAgent[key],
          fallback,
        )}" ${attrs} />
      </label>`;
    const patrolNumberField = (key: string, label: string, fallback: number, attrs: string): string => `
      <label class="as-field">
        <span>${label}</span>
        <input type="number" data-as-ai-patrol-num="${key}" value="${readNumberProp(
          patrolRoute[key],
          fallback,
        )}" ${attrs} />
      </label>`;
    const splineFields = patrolSource === "spline"
      ? `<label class="as-field"><span>Spline ID</span><input type="text" data-as-ai-patrol-spline value="${escapeHtml(
          typeof patrolRoute.splineId === "string" ? patrolRoute.splineId : "",
        )}" placeholder="Level spline ID" /></label>
        <label class="as-field"><span>Entry</span><select data-as-ai-patrol-entry>
          <option value="nearest" ${patrolRoute.entry !== "start" ? "selected" : ""}>Nearest Point</option>
          <option value="start" ${patrolRoute.entry === "start" ? "selected" : ""}>Spline Start</option>
        </select></label>
        ${patrolNumberField("lookAheadDistance", "Look Ahead", 1.2, 'step="0.1" min="0.1"')}
        <label class="as-field"><span>Wrap</span><select data-as-ai-patrol-wrap>
          <option value="loop" ${patrolRoute.wrapMode !== "pingPong" && patrolRoute.wrapMode !== "clamp" ? "selected" : ""}>Loop</option>
          <option value="pingPong" ${patrolRoute.wrapMode === "pingPong" ? "selected" : ""}>Ping-Pong</option>
          <option value="clamp" ${patrolRoute.wrapMode === "clamp" ? "selected" : ""}>Clamp</option>
        </select></label>`
      : `<label class="as-field"><span>Target Point Tag</span><input type="text" data-as-ai-patrol-tag value="${escapeHtml(
          typeof patrolRoute.targetPointTag === "string" ? patrolRoute.targetPointTag : "",
        )}" placeholder="Any route" /></label>`;
    return `${behaviorTree}${stateTree}${blackboard}
      <div class="as-section-label">Perception</div>
      ${perceptionField("sightRadius", "Sight Radius", 18, 'step="0.5" min="0"')}
      ${perceptionField("nearSightRadius", "Near Sight Radius", 2, 'step="0.5" min="0"')}
      ${perceptionField("fieldOfViewDeg", "Field of View°", 110, 'step="1" min="0" max="360"')}
      ${perceptionField("hearingRadius", "Hearing Radius", 12, 'step="0.5" min="0"')}
      ${perceptionField("targetLostGraceSeconds", "Target Lost Grace (s)", 0, 'step="0.1" min="0"')}
      <div class="as-section-label">Nav Agent</div>
      ${navField("radius", "Agent Radius", 0.35, 'step="0.05" min="0"')}
      ${navField("height", "Agent Height", 1.8, 'step="0.1" min="0"')}
      ${navField("maxSpeed", "Max Speed", 3.2, 'step="0.1" min="0"')}
      ${navField("clearancePadding", "Clearance Padding", 0.1, 'step="0.05" min="0"')}
      <div class="as-section-label">Patrol Route</div>
      <label class="as-field"><span>Source</span><select data-as-ai-patrol-source>
        <option value="targetPoints" ${patrolSource === "targetPoints" ? "selected" : ""}>Target Points</option>
        <option value="spline" ${patrolSource === "spline" ? "selected" : ""}>Generic Spline</option>
      </select></label>
      ${splineFields}
      ${patrolNumberField("speed", "Patrol Speed", 2.4, 'step="0.1" min="0"')}
      ${patrolNumberField("acceptanceRadius", "Acceptance Radius", 0.55, 'step="0.05" min="0"')}`;
  }

  /** A `<select>` of asset paths (value = path, label = name) with a none/unknown fallback. */
  private assetPathPickerField(
    attr: string,
    label: string,
    current: string,
    assets: ReadonlyArray<{ path: string; name: string }>,
  ): string {
    const known = assets.some((asset) => asset.path === current);
    const options = [
      `<option value="" ${current ? "" : "selected"}>— none —</option>`,
      ...assets.map(
        (asset) =>
          `<option value="${escapeHtml(asset.path)}" ${asset.path === current ? "selected" : ""}>${escapeHtml(asset.name)}</option>`,
      ),
      ...(current && !known
        ? [`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (unknown)</option>`]
        : []),
    ].join("");
    return `
      <label class="as-field">
        <span>${escapeHtml(label)}</span>
        <select ${attr}>${options}</select>
      </label>
    `;
  }

  /**
   * Read-only montage → action → key panel under a `skeletalMesh` MeshRenderer.
   * Input is code-owned (`montageInputBindings.ts` + `DEFAULT_INPUT_BINDINGS`),
   * not asset data, so this only *shows* what a possessed character would fire —
   * it never edits the binding. Montages load lazily from the `*.skeleton.json`
   * sidecar (fills a cache, then re-renders once).
   */
  private montageInputField(node: ComponentTemplateNode): string {
    const assetId = typeof node.props.assetId === "string" ? node.props.assetId : "";
    if (!assetId || this.assetTypeById(assetId) !== "skeletalMesh") return "";
    const montages = this.montagesByAssetId.get(assetId);
    if (!montages) {
      void this.ensureSkeletonLoaded(assetId, node.id);
      return `
        <div class="as-section-label">Montage Inputs <small>read-only</small></div>
        <div class="as-inspect"><div class="as-empty">Loading montage inputs…</div></div>
      `;
    }
    return `
      <div class="as-section-label">Montage Inputs <small>read-only · code-bound</small></div>
      <div class="as-inspect">
        <ul>${this.montageInputRows(montages)}</ul>
        <div class="as-empty">Bound in code (montageInputBindings.ts); the mesh only defines clips.</div>
      </div>
    `;
  }

  private montageInputRows(montages: readonly AssetSkeletonMontageDef[]): string {
    if (montages.length === 0) return `<li class="as-inspect-empty">no montages</li>`;
    const catalog = getGameEditorCatalog();
    const bindingByMontage = new Map(
      catalog.resolveMontageBindings(montages).map((binding) => [binding.montage, binding] as const),
    );
    return montages
      .map((montage) => {
        const binding = bindingByMontage.get(montage.name);
        let detail: string;
        if (binding) {
          const keys = catalog.keysForAction(binding.action).map((code) => catalog.formatInputCode(code));
          const keyText = keys.length ? keys.join(" / ") : "unbound key";
          detail = `${escapeHtml(binding.action)} → ${escapeHtml(keyText)} <small>(${binding.mode})</small>`;
        } else if (montage.slot === "fullBody") {
          detail = "full body · not input-bound";
        } else {
          detail = "no input binding";
        }
        return `<li><code>${escapeHtml(montage.name)}</code><span>${detail}</span></li>`;
      })
      .join("");
  }

  /**
   * Loads a skeletalMesh asset's montages once and re-renders the Details panel
   * if it is still showing this component+asset. The panel renders synchronously,
   * so the async sidecar fetch fills a cache and triggers a single re-render.
   */
  private async ensureSkeletonLoaded(assetId: string, componentId: string): Promise<void> {
    if (this.skeletonLoadStarted.has(assetId)) return;
    this.skeletonLoadStarted.add(assetId);
    const modelPath = this.resolveModelPath(assetId);
    let montages: readonly AssetSkeletonMontageDef[] = [];
    let clips: readonly string[] = [];
    if (modelPath) {
      try {
        const skeleton = await loadAssetSkeleton(modelPath);
        montages = skeleton.montages;
        clips = skeletonClipNames(skeleton);
      } catch {
        montages = [];
        clips = [];
      }
    }
    if (this.disposed) return;
    this.montagesByAssetId.set(assetId, montages);
    this.clipsByAssetId.set(assetId, clips);
    const node = this.def.components.find((component) => component.id === componentId);
    if (
      this.selection.kind === "component" &&
      this.selection.id === componentId &&
      node?.props.assetId === assetId
    ) {
      this.renderDetails();
    }
  }

  /**
   * The ParticleEmitter form: an "Effect" dropdown of `.effect.json` assets
   * (→ props.effectId) plus an Auto Play toggle (→ props.autoPlay). Like the mesh
   * picker, an unknown/hand-typed effect id is preserved. Emitter settings
   * (rate/size/velocity/material) live in the referenced effect asset, not inline.
   */
  private particleFields(node: ComponentTemplateNode): string {
    const current = typeof node.props.effectId === "string" ? node.props.effectId : "";
    const autoPlay = node.props.autoPlay === true;
    const assets = this.effectAssets();
    const known = assets.some((asset) => asset.id === current);
    const options = [
      `<option value="" ${current ? "" : "selected"}>— none —</option>`,
      ...assets.map(
        (asset) =>
          `<option value="${escapeHtml(asset.id)}" ${asset.id === current ? "selected" : ""}>${escapeHtml(asset.name)}</option>`,
      ),
      ...(current && !known
        ? [`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (unknown)</option>`]
        : []),
    ].join("");
    return `
      <div class="as-section-label">Particle</div>
      <label class="as-field">
        <span>Effect</span>
        <select data-as-particle-effect>${options}</select>
      </label>
      <label class="as-field as-check">
        <input type="checkbox" data-as-particle-autoplay ${autoPlay ? "checked" : ""} />
        <span>Auto Play</span>
      </label>
      <p class="as-details-note">Emitter settings live in the effect asset (<code>.effect.json</code>).</p>
    `;
  }

  /** Raw `sound` clip assets ({id,name}) for the Audio "Sound" picker, name-sorted. */
  private soundAssets(): Array<{ id: string; name: string }> {
    return (this.options.assets ?? [])
      .filter((asset) => asset.assetType === "sound")
      .map((asset) => ({ id: asset.id, name: asset.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Sound Cue graph assets ({id,name}) for the Audio "Cue" picker, name-sorted. */
  private cueAssets(): Array<{ id: string; name: string }> {
    return (this.options.assets ?? [])
      .filter(
        (asset) =>
          asset.assetType === "soundCue" || asset.path.toLowerCase().endsWith(".soundcue.json"),
      )
      .map((asset) => ({ id: asset.id, name: asset.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The Audio component form (Unreal AudioComponent parity, lite): a Sound / Sound
   * Cue source picker plus Volume, Pitch, the Auto Play / Loop / Spatial flags, and
   * a sphere-attenuation block (Min/Max Distance, Rolloff). Writes straight onto
   * `node.props` so the instantiated entity's "Audio" component data matches what
   * `readAudioComponent` expects (clipId/sourceId/sourceType/volume/pitch/…).
   */
  private audioFields(node: ComponentTemplateNode): string {
    const props = node.props;
    const sourceType = props.sourceType === "soundCue" ? "soundCue" : "sound";
    const isCue = sourceType === "soundCue";
    const clipId = typeof props.clipId === "string" ? props.clipId : "";
    const sourceId = typeof props.sourceId === "string" ? props.sourceId : "";
    const autoPlay = props.autoPlay === true;
    const loop = props.loop === true;
    const spatial = props.spatial === true;

    const picker = (
      current: string,
      assets: Array<{ id: string; name: string }>,
    ): string => {
      const known = assets.some((asset) => asset.id === current);
      return [
        `<option value="" ${current ? "" : "selected"}>— none —</option>`,
        ...assets.map(
          (asset) =>
            `<option value="${escapeHtml(asset.id)}" ${asset.id === current ? "selected" : ""}>${escapeHtml(asset.name)}</option>`,
        ),
        ...(current && !known
          ? [`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (unknown)</option>`]
          : []),
      ].join("");
    };

    const sourceRow = isCue
      ? `<label class="as-field"><span>Cue</span><select data-as-audio-source>${picker(sourceId, this.cueAssets())}</select></label>`
      : `<label class="as-field"><span>Sound</span><select data-as-audio-clip>${picker(clipId, this.soundAssets())}</select></label>`;

    return `
      <div class="as-section-label">Sound</div>
      <label class="as-field">
        <span>Source Type</span>
        <select data-as-audio-sourcetype>
          <option value="sound" ${isCue ? "" : "selected"}>Sound (Raw Clip)</option>
          <option value="soundCue" ${isCue ? "selected" : ""}>Sound Cue (Graph)</option>
        </select>
      </label>
      ${sourceRow}
      ${numberPropField(props, "volume", "Volume", 1, 'min="0" max="1" step="0.05"')}
      ${numberPropField(props, "pitch", "Pitch", 1, 'min="0.01" max="8" step="0.05"')}
      <label class="as-field as-check">
        <input type="checkbox" data-as-audio-flag="autoPlay" ${autoPlay ? "checked" : ""} />
        <span>Auto Play</span>
      </label>
      <label class="as-field as-check">
        <input type="checkbox" data-as-audio-flag="loop" ${loop ? "checked" : ""} />
        <span>Loop</span>
      </label>
      <label class="as-field as-check">
        <input type="checkbox" data-as-audio-flag="spatial" ${spatial ? "checked" : ""} />
        <span>Spatial</span>
      </label>
      <div class="as-section-label">Attenuation <small>(spatial)</small></div>
      ${numberPropField(props, "refDistance", "Min Distance", 4, 'min="0" step="0.5"')}
      ${numberPropField(props, "maxDistance", "Max Distance", 60, 'min="0" step="1"')}
      ${numberPropField(props, "rolloff", "Rolloff", 1, 'min="0" step="0.1"')}
    `;
  }

  private bindComponentDetails(): void {
    const node = this.selectedComponent();
    if (!node) return;
    const idInput = this.detailsHost.querySelector<HTMLInputElement>("[data-as-node-id]");
    idInput?.addEventListener("change", () => {
      const next = idInput.value.trim();
      if (!next || next === node.id) {
        idInput.value = node.id;
        return;
      }
      if (this.def.components.some((other) => other.id === next)) {
        this.setStatus(`Component id "${next}" already exists.`, "warning");
        idInput.value = node.id;
        return;
      }
      const old = node.id;
      // Re-parent children that referenced the old id.
      for (const child of this.def.components) {
        if (child.parent === old) child.parent = next;
      }
      node.id = next;
      this.selection = { kind: "component", id: next };
      this.markDirty();
      this.refreshLists();
    });
    const kind = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-node-kind]");
    kind?.addEventListener("change", () => {
      node.component = kind.value as ActorComponentKind;
      // Static meshes have no animation clip; drop it when leaving skeletal so the
      // prop does not linger as a hidden field on a static component.
      if (node.component === "StaticMeshComponent") delete node.props.animation;
      this.normalizeDefForEditor();
      this.markDirty();
      this.refreshLists();
      this.renderDetails();
    });
    const parent = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-node-parent]");
    parent?.addEventListener("change", () => {
      const value = parent.value;
      if (value && this.wouldCycle(node.id, value)) {
        this.setStatus("That parent would create a cycle.", "warning");
        parent.value = node.parent ?? "";
        return;
      }
      if (value) node.parent = value;
      else delete node.parent;
      this.markDirty();
      this.refreshLists();
    });
    const mesh = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-node-mesh]");
    mesh?.addEventListener("change", () => {
      if (mesh.value) node.props.assetId = mesh.value;
      else delete node.props.assetId;
      // A different mesh may carry different clips; drop a now-stale animation so
      // it never persists a clip the new skeleton doesn't define.
      if (node.component === "SkeletalMeshComponent") delete node.props.animation;
      this.markDirty();
      this.render(); // rebuilds tree + viewport + the raw-props view
    });
    const animation = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-node-animation]");
    animation?.addEventListener("change", () => {
      if (animation.value) node.props.animation = animation.value;
      else delete node.props.animation;
      this.markDirty();
      this.render();
    });
    this.bindColliderDetails(node);
    this.bindLightDetails(node);
    this.bindParticleDetails(node);
    this.bindAudioDetails(node);
    this.bindCharacterMovementDetails(node);
    this.bindSpringArmDetails(node);
    this.bindCameraDetails(node);
    this.bindAIControllerDetails(node);
    this.bindNumberProps(node);
    this.detailsHost.querySelectorAll<HTMLElement>("[data-as-vec]").forEach((rowEl) => {
      const key = rowEl.dataset.asVec as "position" | "rotation" | "scale";
      const inputs = Array.from(rowEl.querySelectorAll<HTMLInputElement>("input"));
      const identity: Vec3 = key === "scale" ? [1, 1, 1] : [0, 0, 0];
      const collect = (): void => {
        const value = inputs.map((input) => {
          const n = Number(input.value);
          return Number.isFinite(n) ? n : 0;
        }) as Vec3;
        setVec3Prop(node.props, key, value, identity);
        this.markDirty();
      };
      // Live preview while typing; sync the raw-props view on commit (blur).
      inputs.forEach((input) => {
        input.addEventListener("input", () => {
          collect();
          this.scheduleViewportSync();
        });
        input.addEventListener("change", () => {
          collect();
          this.renderDetails();
          this.syncViewport();
        });
      });
    });
    const props = this.detailsHost.querySelector<HTMLTextAreaElement>("[data-as-node-props]");
    const error = this.detailsHost.querySelector<HTMLElement>("[data-as-node-props-error]");
    props?.addEventListener("input", () => {
      const parsed = parseJsonObject(props.value);
      if (parsed.ok) {
        node.props = parsed.value;
        this.markDirty();
        this.scheduleViewportSync();
        if (error) error.textContent = "";
        props.classList.remove("is-invalid");
      } else {
        if (error) error.textContent = parsed.error;
        props.classList.add("is-invalid");
      }
    });
    props?.addEventListener("change", () => {
      this.normalizeDefForEditor();
      this.renderDetails();
      this.syncViewport();
    });
  }

  /**
   * Wires the AIController Behavior Tree + Blackboard pickers and the perception /
   * nav-agent numeric fields (no-op for other components). Each select writes its
   * chosen asset path into the node props (or deletes the key when cleared) and
   * re-renders so the raw-props view stays in sync. The numeric fields write into
   * their nested `perception` / `navAgent` object (creating it if absent) and sync
   * the raw-props view on commit.
   */
  private bindAIControllerDetails(node: ComponentTemplateNode): void {
    const behavior = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-ai-behavior]");
    behavior?.addEventListener("change", () => {
      if (behavior.value) node.props.behaviorTree = behavior.value;
      else delete node.props.behaviorTree;
      this.markDirty();
      this.render();
    });
    const stateTree = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-ai-statetree]");
    stateTree?.addEventListener("change", () => {
      if (stateTree.value) node.props.stateTree = stateTree.value;
      else delete node.props.stateTree;
      this.markDirty();
      this.render();
    });
    const blackboard = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-ai-blackboard]");
    blackboard?.addEventListener("change", () => {
      if (blackboard.value) node.props.blackboard = blackboard.value;
      else delete node.props.blackboard;
      this.markDirty();
      this.render();
    });
    const bindNested = (attr: string, objectKey: "perception" | "navAgent"): void => {
      this.detailsHost.querySelectorAll<HTMLInputElement>(`[${attr}]`).forEach((input) => {
        const key = input.getAttribute(attr);
        if (!key) return;
        const apply = (): void => {
          const n = Number(input.value);
          if (!Number.isFinite(n)) return;
          const obj = readObjectProp(node.props[objectKey]);
          obj[key] = n;
          node.props[objectKey] = obj;
          this.markDirty();
        };
        input.addEventListener("input", apply);
        input.addEventListener("change", () => {
          apply();
          this.renderDetails();
        });
      });
    };
    bindNested("data-as-ai-perception-num", "perception");
    bindNested("data-as-ai-nav-num", "navAgent");
    const patrolRoute = (): Record<string, SceneJsonValue> => readObjectProp(node.props.patrolRoute);
    const commitPatrolRoute = (route: Record<string, SceneJsonValue>): void => {
      node.props.patrolRoute = route;
      this.markDirty();
    };
    const patrolSource = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-ai-patrol-source]");
    patrolSource?.addEventListener("change", () => {
      const route = patrolRoute();
      route.source = patrolSource.value === "spline" ? "spline" : "targetPoints";
      commitPatrolRoute(route);
      this.renderDetails();
    });
    const patrolText = (selector: string, key: string): void => {
      const input = this.detailsHost.querySelector<HTMLInputElement>(selector);
      input?.addEventListener("change", () => {
        const route = patrolRoute();
        if (input.value.trim()) route[key] = input.value.trim();
        else delete route[key];
        commitPatrolRoute(route);
        this.renderDetails();
      });
    };
    patrolText("[data-as-ai-patrol-spline]", "splineId");
    patrolText("[data-as-ai-patrol-tag]", "targetPointTag");
    const patrolEntry = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-ai-patrol-entry]");
    patrolEntry?.addEventListener("change", () => {
      const route = patrolRoute();
      route.entry = patrolEntry.value === "start" ? "start" : "nearest";
      commitPatrolRoute(route);
      this.renderDetails();
    });
    const patrolWrap = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-ai-patrol-wrap]");
    patrolWrap?.addEventListener("change", () => {
      const route = patrolRoute();
      route.wrapMode = patrolWrap.value === "pingPong" || patrolWrap.value === "clamp" ? patrolWrap.value : "loop";
      commitPatrolRoute(route);
      this.renderDetails();
    });
    this.detailsHost.querySelectorAll<HTMLInputElement>("[data-as-ai-patrol-num]").forEach((input) => {
      const key = input.dataset.asAiPatrolNum;
      if (!key) return;
      const apply = (): void => {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0) return;
        const route = patrolRoute();
        route[key] = value;
        commitPatrolRoute(route);
      };
      input.addEventListener("input", apply);
      input.addEventListener("change", () => {
        apply();
        this.renderDetails();
      });
    });
  }

  /**
   * Wires the Collider Details controls (no-op when the node carries no collider
   * form). The Shape picker swaps the authoring surface: a `capsule` is sized by
   * Capsule Radius + Capsule Half Height (Unreal-style, deriving the runtime AABB
   * + feet-at-origin center), while other shapes keep the raw Size/Center/Rotation
   * vectors. Switching shape converts between the two representations so no
   * dimensions are lost. The Size/Center/Rotation vectors are bound generically
   * (data-as-vec); only the shape/capsule/flag controls need wiring here.
   */
  private bindColliderDetails(node: ComponentTemplateNode): void {
    const shape = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-collider-shape]");
    shape?.addEventListener("change", () => {
      const next = shape.value as ColliderShape;
      const prev = readColliderShape(node.props.shape);
      node.props.shape = next;
      if (next === "capsule" && prev !== "capsule") {
        // Adopt capsule authoring: derive radius/half-height from any prior size.
        const dims = capsuleDimensionsFromProps(node.props);
        setCapsuleProps(node.props, dims.radius, dims.halfHeight);
      } else if (next !== "capsule" && prev === "capsule") {
        // Leaving capsule: bake the derived AABB back into Size/Center.
        const dims = capsuleDimensionsFromProps(node.props);
        node.props.size = [...dims.size];
        node.props.center = [...dims.center];
        delete node.props.capsuleRadius;
        delete node.props.capsuleHalfHeight;
      }
      this.markDirty();
      this.normalizeDefForEditor();
      this.renderDetails();
      this.syncViewport();
    });

    const radius = this.detailsHost.querySelector<HTMLInputElement>("[data-as-capsule-radius]");
    const halfHeight = this.detailsHost.querySelector<HTMLInputElement>(
      "[data-as-capsule-half-height]",
    );
    const applyCapsule = (): void => {
      const r = Number(radius?.value);
      const h = Number(halfHeight?.value);
      setCapsuleProps(
        node.props,
        Number.isFinite(r) ? r : DEFAULT_CAPSULE_RADIUS,
        Number.isFinite(h) ? h : DEFAULT_CAPSULE_HALF_HEIGHT,
      );
      this.markDirty();
    };
    for (const input of [radius, halfHeight]) {
      input?.addEventListener("input", () => {
        applyCapsule();
        this.scheduleViewportSync();
      });
      input?.addEventListener("change", () => {
        applyCapsule();
        this.renderDetails();
        this.syncViewport();
      });
    }

    const bindFlag = (selector: string, key: string): void => {
      const input = this.detailsHost.querySelector<HTMLInputElement>(selector);
      input?.addEventListener("change", () => {
        node.props[key] = input.checked;
        this.normalizeDefForEditor();
        this.markDirty();
        this.renderDetails();
        this.syncViewport();
      });
    };
    bindFlag("[data-as-collider-static]", "isStatic");
    bindFlag("[data-as-collider-sensor]", "isSensor");
    bindFlag("[data-as-collider-simulate]", "simulatePhysics");
    bindFlag("[data-as-collider-hide-in-game]", "hideInGame");
  }

  /**
   * Wires the Light Details controls (no-op when the node carries no light form):
   * the type picker (directional/point/spot, pruning type-irrelevant props), the
   * color swatch, and the numeric reach fields. Numeric/color edits live-update
   * the preview; commits re-render Details so the raw-props view + visible field
   * set track the chosen type.
   */
  private bindLightDetails(node: ComponentTemplateNode): void {
    const type = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-light-type]");
    type?.addEventListener("change", () => {
      const next = type.value as SceneLightType;
      node.props.type = next;
      pruneLightProps(node.props, next);
      this.markDirty();
      this.render(); // type change shows/hides fields + rebuilds the preview
    });
    const color = this.detailsHost.querySelector<HTMLInputElement>("[data-as-light-color]");
    color?.addEventListener("input", () => {
      node.props.color = color.value;
      this.markDirty();
      this.scheduleViewportSync();
    });
    color?.addEventListener("change", () => {
      this.renderDetails();
      this.syncViewport();
    });
    this.detailsHost.querySelectorAll<HTMLInputElement>("[data-as-light-num]").forEach((input) => {
      const key = input.dataset.asLightNum;
      if (!key) return;
      const apply = (): void => {
        const n = Number(input.value);
        if (Number.isFinite(n)) node.props[key] = n;
        this.markDirty();
      };
      input.addEventListener("input", () => {
        apply();
        this.scheduleViewportSync();
      });
      input.addEventListener("change", () => {
        apply();
        this.renderDetails();
        this.syncViewport();
      });
    });
  }

  /**
   * Wires the ParticleEmitter Details controls (no-op when the node carries no
   * particle form): the effect picker (→ props.effectId, dropping the key when
   * cleared) and the Auto Play toggle (→ props.autoPlay). Re-renders so the
   * raw-props view tracks the change.
   */
  private bindParticleDetails(node: ComponentTemplateNode): void {
    const effect = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-particle-effect]");
    effect?.addEventListener("change", () => {
      if (effect.value) node.props.effectId = effect.value;
      else delete node.props.effectId;
      this.markDirty();
      this.render(); // rebuilds tree + the raw-props view
    });
    const autoPlay = this.detailsHost.querySelector<HTMLInputElement>("[data-as-particle-autoplay]");
    autoPlay?.addEventListener("change", () => {
      if (autoPlay.checked) node.props.autoPlay = true;
      else delete node.props.autoPlay;
      this.markDirty();
      this.renderDetails();
    });
  }

  /**
   * Wires the Audio Details controls. Numeric fields (volume/pitch/attenuation)
   * are bound generically via `data-as-num`; here we handle the Source Type swap,
   * the Sound/Cue pickers, and the Auto Play / Loop / Spatial flags. Switching
   * Source Type re-renders so the matching picker is shown.
   */
  private bindAudioDetails(node: ComponentTemplateNode): void {
    const sourceType = this.detailsHost.querySelector<HTMLSelectElement>(
      "[data-as-audio-sourcetype]",
    );
    sourceType?.addEventListener("change", () => {
      if (sourceType.value === "soundCue") {
        node.props.sourceType = "soundCue";
        // Default to the first cue so a freshly-switched cue source is non-empty
        // (an empty sourceId leaves the actor silent in Play).
        if (typeof node.props.sourceId !== "string" || node.props.sourceId.length === 0) {
          const firstCue = this.cueAssets()[0];
          if (firstCue) node.props.sourceId = firstCue.id;
        }
      } else {
        delete node.props.sourceType;
      }
      this.markDirty();
      this.renderDetails();
    });
    const clip = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-audio-clip]");
    clip?.addEventListener("change", () => {
      if (clip.value) node.props.clipId = clip.value;
      else node.props.clipId = "";
      this.markDirty();
      this.render(); // sync the raw-props view
    });
    const source = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-audio-source]");
    source?.addEventListener("change", () => {
      if (source.value) node.props.sourceId = source.value;
      else delete node.props.sourceId;
      this.markDirty();
      this.render();
    });
    this.detailsHost
      .querySelectorAll<HTMLInputElement>("[data-as-audio-flag]")
      .forEach((input) => {
        const key = input.dataset.asAudioFlag;
        if (!key) return;
        input.addEventListener("change", () => {
          node.props[key] = input.checked;
          this.markDirty();
          this.renderDetails();
        });
      });
  }

  private bindCharacterMovementDetails(node: ComponentTemplateNode): void {
    const mode = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-character-movement-mode]");
    mode?.addEventListener("change", () => {
      node.props.movementMode = mode.value;
      this.markDirty();
      this.renderDetails();
    });
    const orient = this.detailsHost.querySelector<HTMLInputElement>(
      "[data-as-character-movement-orient]",
    );
    orient?.addEventListener("change", () => {
      node.props.orientRotationToMovement = orient.checked;
      this.markDirty();
      this.renderDetails();
    });
    const orientControl = this.detailsHost.querySelector<HTMLInputElement>(
      "[data-as-character-movement-orient-control]",
    );
    orientControl?.addEventListener("change", () => {
      node.props.orientRotationToControl = orientControl.checked;
      this.markDirty();
      this.renderDetails();
    });
    this.detailsHost
      .querySelectorAll<HTMLInputElement>("[data-as-character-movement-num]")
      .forEach((input) => {
        const key = input.dataset.asCharacterMovementNum;
        if (!key) return;
        const apply = (): void => {
          const n = Number(input.value);
          if (Number.isFinite(n)) node.props[key] = n;
          this.markDirty();
        };
        input.addEventListener("input", apply);
        input.addEventListener("change", () => {
          apply();
          this.renderDetails();
        });
      });
  }

  /**
   * Wires the Spring Arm Details toggles (no-op when the node carries no spring
   * form): Camera Lag and Collision Test. `enableCameraLag` is stored only when
   * on, and `doCollisionTest` only when off (its default is true), keeping the
   * saved JSON lean. The arm-length/lag-speed numbers + offset vectors are bound
   * generically (data-as-num / data-as-vec). Re-renders to toggle the lag-speed
   * field.
   */
  private bindSpringArmDetails(node: ComponentTemplateNode): void {
    const lag = this.detailsHost.querySelector<HTMLInputElement>("[data-as-spring-lag]");
    lag?.addEventListener("change", () => {
      if (lag.checked) node.props.enableCameraLag = true;
      else delete node.props.enableCameraLag;
      this.markDirty();
      this.renderDetails();
    });
    const collision = this.detailsHost.querySelector<HTMLInputElement>("[data-as-spring-collision]");
    collision?.addEventListener("change", () => {
      if (collision.checked) delete node.props.doCollisionTest;
      else node.props.doCollisionTest = false;
      this.markDirty();
      this.renderDetails();
    });
  }

  /**
   * Wires the Camera Details toggle (no-op when the node carries no camera form):
   * the Orthographic switch, stored only when on. FOV/clip/ortho-width numbers are
   * bound generically (data-as-num). Re-renders to toggle the Ortho Width field.
   */
  private bindCameraDetails(node: ComponentTemplateNode): void {
    const ortho = this.detailsHost.querySelector<HTMLInputElement>("[data-as-camera-ortho]");
    ortho?.addEventListener("change", () => {
      if (ortho.checked) node.props.isOrthographic = true;
      else delete node.props.isOrthographic;
      this.markDirty();
      this.renderDetails();
    });
    const sprintShake = this.detailsHost.querySelector<HTMLInputElement>(
      "[data-as-camera-sprint-shake]",
    );
    sprintShake?.addEventListener("change", () => {
      if (sprintShake.checked) delete node.props.enableSprintCameraShake;
      else node.props.enableSprintCameraShake = false;
      this.markDirty();
      this.renderDetails();
    });
  }

  /**
   * Binds every generic numeric prop input (`data-as-num="<key>"`) in the current
   * Details form to `node.props[key]`, committing on change. Shared by the Spring
   * Arm and Camera forms; only one node's form is mounted at a time.
   */
  private bindNumberProps(node: ComponentTemplateNode): void {
    this.detailsHost.querySelectorAll<HTMLInputElement>("[data-as-num]").forEach((input) => {
      const key = input.dataset.asNum;
      if (!key) return;
      const apply = (): void => {
        const n = Number(input.value);
        if (Number.isFinite(n)) node.props[key] = n;
        this.markDirty();
      };
      input.addEventListener("input", apply);
      input.addEventListener("change", () => {
        apply();
        this.renderDetails();
      });
    });
  }

  private detailsVariable(): string {
    if (this.selection.kind !== "variable") return "";
    const variable = this.def.variables[this.selection.index];
    if (!variable) return `<div class="as-details-head">Variable</div><p class="as-empty">Not found.</p>`;
    const typeOptions = METADATA_FIELD_TYPES.map(
      (type) => `<option value="${type}" ${type === variable.type ? "selected" : ""}>${type}</option>`,
    ).join("");
    const showOptions = variable.type === "select" || variable.type === "tags";
    return `
      <div class="as-details-head">Variable</div>
      <label class="as-field">
        <span>Key</span>
        <input type="text" data-as-var-key value="${escapeHtml(variable.key)}" />
      </label>
      <label class="as-field">
        <span>Label</span>
        <input type="text" data-as-var-label value="${escapeHtml(variable.label)}" />
      </label>
      <label class="as-field">
        <span>Type</span>
        <select data-as-var-type>${typeOptions}</select>
      </label>
      <label class="as-field">
        <span>Default</span>
        <input type="text" data-as-var-default value="${escapeHtml(stringifyMetadataDefault(variable.default))}" />
      </label>
      ${
        showOptions
          ? `<label class="as-field"><span>Options (comma-separated)</span>
        <input type="text" data-as-var-options value="${escapeHtml((variable.options ?? []).join(", "))}" /></label>`
          : ""
      }
    `;
  }

  private bindVariableDetails(): void {
    if (this.selection.kind !== "variable") return;
    const index = this.selection.index;
    const variable = this.def.variables[index];
    if (!variable) return;
    const key = this.detailsHost.querySelector<HTMLInputElement>("[data-as-var-key]");
    key?.addEventListener("change", () => {
      const next = key.value.trim();
      if (!next) {
        key.value = variable.key;
        return;
      }
      if (this.def.variables.some((other, i) => i !== index && other.key === next)) {
        this.setStatus(`Variable key "${next}" already exists.`, "warning");
        key.value = variable.key;
        return;
      }
      variable.key = next;
      this.markDirty();
      this.refreshLists();
    });
    const label = this.detailsHost.querySelector<HTMLInputElement>("[data-as-var-label]");
    label?.addEventListener("input", () => {
      variable.label = label.value;
      this.markDirty();
    });
    label?.addEventListener("change", () => this.refreshLists());
    const type = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-var-type]");
    type?.addEventListener("change", () => {
      variable.type = type.value as MetadataFieldType;
      this.markDirty();
      this.refreshLists();
      this.renderDetails();
    });
    const def = this.detailsHost.querySelector<HTMLInputElement>("[data-as-var-default]");
    def?.addEventListener("input", () => {
      const value = coerceMetadataDefault(def.value, variable.type);
      if (value === undefined) delete variable.default;
      else variable.default = value;
      this.markDirty();
    });
    const options = this.detailsHost.querySelector<HTMLInputElement>("[data-as-var-options]");
    options?.addEventListener("input", () => {
      variable.options = options.value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      this.markDirty();
    });
  }

  private detailsEvent(): string {
    if (this.selection.kind !== "event") return "";
    const binding = this.def.eventBindings[this.selection.index];
    if (!binding) return `<div class="as-details-head">Event Binding</div><p class="as-empty">Not found.</p>`;
    const eventOptions = ACTOR_EVENT_KINDS.map(
      (kind) =>
        `<option value="${kind}" ${kind === binding.event ? "selected" : ""}>${ACTOR_EVENT_LABELS[kind]}</option>`,
    ).join("");
    const ids = this.options.behaviorScriptIds ?? [];
    const idList = ids.length
      ? `<datalist id="as-script-ids">${ids.map((id) => `<option value="${escapeHtml(id)}"></option>`).join("")}</datalist>`
      : "";
    return `
      <div class="as-details-head">Event Binding</div>
      <label class="as-field">
        <span>Event</span>
        <select data-as-event-kind>${eventOptions}</select>
      </label>
      <p class="as-details-note" data-as-event-description>${escapeHtml(ACTOR_EVENT_DESCRIPTIONS[binding.event])}</p>
      <label class="as-field">
        <span>Behavior Script Id</span>
        <input type="text" data-as-event-script list="as-script-ids" value="${escapeHtml(binding.scriptId)}" placeholder="e.g. spin" />
      </label>
      ${idList}
      <div class="as-field-actions">
        <button type="button" class="as-add-btn" data-as-new-behavior title="Scaffold src/game/scripts/<id>.ts for this script id">
          ✎ New Behavior stub
        </button>
      </div>
      <label class="as-field">
        <span>Params (JSON)</span>
        <textarea data-as-event-params rows="8">${escapeHtml(JSON.stringify(binding.params ?? {}, null, 2))}</textarea>
      </label>
      <div class="as-json-error" data-as-event-params-error></div>
      <p class="as-details-note">The script id resolves to a TypeScript behavior in <code>src/game/</code>. Use <strong>New Behavior stub</strong> to scaffold <code>src/game/scripts/&lt;id&gt;.ts</code>, then implement it (or ask AI) and register it in the behavior registry (<code>src/game/behaviors.ts</code>).</p>
    `;
  }

  private bindEventDetails(): void {
    if (this.selection.kind !== "event") return;
    const binding = this.def.eventBindings[this.selection.index];
    if (!binding) return;
    const kind = this.detailsHost.querySelector<HTMLSelectElement>("[data-as-event-kind]");
    kind?.addEventListener("change", () => {
      binding.event = kind.value as ActorEventKind;
      const description = this.detailsHost.querySelector<HTMLElement>("[data-as-event-description]");
      if (description) description.textContent = ACTOR_EVENT_DESCRIPTIONS[binding.event];
      this.markDirty();
      this.refreshLists();
    });
    const script = this.detailsHost.querySelector<HTMLInputElement>("[data-as-event-script]");
    script?.addEventListener("input", () => {
      binding.scriptId = script.value.trim();
      this.markDirty();
    });
    script?.addEventListener("change", () => this.refreshLists());
    this.detailsHost
      .querySelector<HTMLButtonElement>("[data-as-new-behavior]")
      ?.addEventListener("click", () => void this.scaffoldBehavior(binding.scriptId));
    const params = this.detailsHost.querySelector<HTMLTextAreaElement>("[data-as-event-params]");
    const error = this.detailsHost.querySelector<HTMLElement>("[data-as-event-params-error]");
    params?.addEventListener("input", () => {
      const parsed = parseJsonObject(params.value);
      if (parsed.ok) {
        if (Object.keys(parsed.value).length > 0) binding.params = parsed.value;
        else delete binding.params;
        this.markDirty();
        if (error) error.textContent = "";
        params.classList.remove("is-invalid");
      } else {
        if (error) error.textContent = parsed.error;
        params.classList.add("is-invalid");
      }
    });
  }

  // --- mutations ----------------------------------------------------------

  private select(selection: Selection): void {
    this.selection = selection;
    this.render();
  }

  private addComponent(kind: ActorComponentKind): void {
    const root = this.def.components.find((node) => node.parent === undefined);
    const id = this.uniqueNodeId(kind);
    const node: ComponentTemplateNode = { id, component: kind, props: defaultComponentProps(kind) };
    if (root) node.parent = root.id;
    this.def.components.push(node);
    this.selection = { kind: "component", id };
    this.markDirty();
    this.render();
  }

  private deleteComponent(id: string): void {
    const node = this.def.components.find((n) => n.id === id);
    if (!node || node.parent === undefined) return; // never delete the root
    // Re-parent direct children to the deleted node's parent.
    for (const child of this.def.components) {
      if (child.parent === id) child.parent = node.parent;
    }
    this.def.components = this.def.components.filter((n) => n.id !== id);
    if (this.selection.kind === "component" && this.selection.id === id) {
      this.selection = { kind: "class" };
    }
    this.normalizeDefForEditor();
    this.markDirty();
    this.render();
  }

  private addVariable(): void {
    const key = this.uniqueVariableKey();
    const variable: MetadataFieldDef = { key, label: key, type: "number" };
    this.def.variables.push(variable);
    this.selection = { kind: "variable", index: this.def.variables.length - 1 };
    this.markDirty();
    this.render();
  }

  private deleteVariable(index: number): void {
    if (index < 0 || index >= this.def.variables.length) return;
    this.def.variables.splice(index, 1);
    if (this.selection.kind === "variable") this.selection = { kind: "class" };
    this.markDirty();
    this.render();
  }

  private addEvent(): void {
    const scriptId = this.options.behaviorScriptIds?.[0] ?? "";
    const binding: EventBinding = { event: "tick", scriptId };
    this.def.eventBindings.push(binding);
    this.selection = { kind: "event", index: this.def.eventBindings.length - 1 };
    this.markDirty();
    this.render();
  }

  private deleteEvent(index: number): void {
    if (index < 0 || index >= this.def.eventBindings.length) return;
    this.def.eventBindings.splice(index, 1);
    if (this.selection.kind === "event") this.selection = { kind: "class" };
    this.markDirty();
    this.render();
  }

  private uniqueNodeId(kind: string): string {
    const base = kind.charAt(0).toLowerCase() + kind.slice(1);
    let candidate = base;
    while (this.def.components.some((node) => node.id === candidate)) {
      this.nodeSeq += 1;
      candidate = `${base}${this.nodeSeq}`;
    }
    return candidate;
  }

  private uniqueVariableKey(): string {
    let n = this.def.variables.length + 1;
    let candidate = `var${n}`;
    while (this.def.variables.some((variable) => variable.key === candidate)) {
      n += 1;
      candidate = `var${n}`;
    }
    return candidate;
  }

  /** True if making `parentId` the parent of `nodeId` would form a cycle. */
  private wouldCycle(nodeId: string, parentId: string): boolean {
    let current: string | undefined = parentId;
    const seen = new Set<string>();
    while (current) {
      if (current === nodeId) return true;
      if (seen.has(current)) return true;
      seen.add(current);
      current = this.def.components.find((node) => node.id === current)?.parent;
    }
    return false;
  }

  // --- compile / save -----------------------------------------------------

  /** Validates the class (Unreal's Compile): structural + reference checks. */
  private compile(): void {
    const errors: string[] = [];
    const warnings: string[] = [];

    const ids = new Set<string>();
    for (const node of this.def.components) {
      if (ids.has(node.id)) errors.push(`Duplicate component id "${node.id}".`);
      ids.add(node.id);
    }
    for (const node of this.def.components) {
      if (node.parent !== undefined && !ids.has(node.parent)) {
        errors.push(`Component "${node.id}" references a missing parent "${node.parent}".`);
      }
    }
    const roots = this.def.components.filter((node) => node.parent === undefined);
    if (roots.length === 0) errors.push("No root component.");

    const keys = new Set<string>();
    for (const variable of this.def.variables) {
      if (!variable.key) errors.push("A variable has an empty key.");
      if (keys.has(variable.key)) errors.push(`Duplicate variable key "${variable.key}".`);
      keys.add(variable.key);
    }

    const known = new Set(this.options.behaviorScriptIds ?? []);
    this.def.eventBindings.forEach((binding, index) => {
      if (!binding.scriptId) {
        errors.push(`Event binding #${index + 1} (${binding.event}) has no script id.`);
      } else if (known.size > 0 && !known.has(binding.scriptId)) {
        warnings.push(`Script "${binding.scriptId}" is not registered yet (author it in src/game/).`);
      }
    });
    const interfaces = new Set<string>();
    for (const name of this.def.interfaces) {
      if (interfaces.has(name)) errors.push(`Duplicate interface "${name}".`);
      interfaces.add(name);
    }
    const references = new Set<string>();
    for (const reference of this.def.references) {
      if (references.has(reference.key)) errors.push(`Duplicate reference key "${reference.key}".`);
      references.add(reference.key);
      if (reference.selector.byInterface && !interfaces.has(reference.selector.byInterface)) {
        warnings.push(
          `Reference "${reference.key}" targets interface "${reference.selector.byInterface}" not declared by this class.`,
        );
      }
    }
    const dispatchers = new Set<string>();
    for (const dispatcher of this.def.dispatchers) {
      if (dispatchers.has(dispatcher.name)) errors.push(`Duplicate dispatcher "${dispatcher.name}".`);
      dispatchers.add(dispatcher.name);
    }
    this.def.messageBindings.forEach((binding, index) => {
      if (!binding.message) errors.push(`Message binding #${index + 1} has no message.`);
      if (binding.message.startsWith(`${this.def.name}.`) && !dispatchers.has(binding.message)) {
        warnings.push(`Message "${binding.message}" has no matching dispatcher in this class.`);
      }
      if (!binding.scriptId) {
        errors.push(`Message binding #${index + 1} has no script id.`);
      } else if (known.size > 0 && !known.has(binding.scriptId)) {
        warnings.push(`Script "${binding.scriptId}" is not registered yet (author it in src/game/).`);
      }
      if (binding.target && binding.target !== "self" && binding.target !== "any") {
        errors.push(`Message binding #${index + 1} has invalid target "${binding.target}".`);
      }
    });

    const hasComponent = (kind: ActorComponentKind): boolean =>
      this.def.components.some((node) => node.component === kind);
    if (this.def.parentClass === "character") {
      if (!hasComponent("CharacterMovement")) {
        warnings.push("Character class has no CharacterMovement component.");
      }
      const capsule = this.def.components.find(
        (node) =>
          node.component === "Collider" &&
          node.props.shape === "capsule" &&
          node.props.isSensor !== true,
      );
      if (!capsule) warnings.push("Character class should have a non-sensor capsule Collider.");
      const mesh = this.def.components.find((node) => isMeshComponentKind(node.component));
      if (!mesh) warnings.push("Character class has no Skeletal Mesh component.");
      else if (typeof mesh.props.assetId !== "string" || mesh.props.assetId.length === 0) {
        warnings.push("Character mesh component has no mesh asset.");
      }
    }
    if (
      this.def.parentClass !== "character" &&
      this.def.parentClass !== "pawn" &&
      hasComponent("CharacterMovement")
    ) {
      warnings.push("CharacterMovement should live on a Character or Pawn class.");
    }

    if (errors.length === 0) {
      const suffix = warnings.length ? ` · ${warnings.length} warning(s)` : "";
      this.compileStatusEl.textContent = `✓ Compiled${suffix}`;
      this.compileStatusEl.className = "as-editor-compile-status is-ok";
      this.setStatus(
        warnings.length ? `Compiled with warnings: ${warnings[0]}` : "Compiled cleanly.",
        warnings.length ? "warning" : "success",
      );
    } else {
      this.compileStatusEl.textContent = `✕ ${errors.length} error(s)`;
      this.compileStatusEl.className = "as-editor-compile-status is-error";
      this.setStatus(`Compile failed: ${errors[0]}`, "error");
    }
  }

  private async save(): Promise<void> {
    try {
      const result = await saveActorScript(this.options.path, this.def);
      this.dirty = false;
      this.setStatus(result.changed ? "Saved." : "Saved (no changes).", "success");
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  /**
   * Play: persists the class, then hands off to the host to launch the runtime
   * (the placed instances of this class spawn there). Save failures abort the
   * launch so the runtime never reads a stale class.
   */
  private async play(): Promise<void> {
    if (!this.options.onPlay) {
      this.setStatus("Play is unavailable in this context.", "warning");
      return;
    }
    await this.save();
    if (this.dirty) return; // save reported an error; do not launch
    this.options.onPlay();
  }

  /**
   * Scaffolds a TypeScript behavior stub for an event binding's `scriptId`
   * (`src/game/scripts/<id>.ts`). The class data is unchanged; this just generates
   * the source signature for AI/devs to implement + register.
   */
  private async scaffoldBehavior(scriptId: string): Promise<void> {
    const id = scriptId.trim();
    if (!id) {
      this.setStatus("Enter a script id before scaffolding a behavior.", "warning");
      return;
    }
    try {
      const result = await createBehaviorStub(id);
      if (result.alreadyExists) {
        this.setStatus(`Behavior already exists: ${result.path} — implement + register it.`, "info");
      } else {
        this.setStatus(
          `Created ${result.path} (export ${result.exportName}). Implement it, then register it in src/game/behaviors.ts.`,
          "success",
        );
      }
    } catch (error) {
      this.setStatus(`New behavior failed: ${describeError(error)}`, "error");
    }
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private normalizeDefForEditor(): void {
    const selection = this.selection;
    this.def = normalizeActorScriptDef(this.def, this.def.name);
    if (
      selection.kind === "component" &&
      !this.def.components.some((node) => node.id === selection.id)
    ) {
      this.selection = { kind: "class" };
    }
  }

  private setStatus(message: string, tone: StatusTone = "info"): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.tone = tone;
    this.options.onStatus?.(message, tone);
  }

  close(): void {
    if (this.dirty && !window.confirm("Discard unsaved changes to this Actor Script?")) return;
    this.dispose();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.viewportSyncTimer !== undefined) window.clearTimeout(this.viewportSyncTimer);
    this.viewport?.dispose();
    this.viewport = null;
    this.overlay.remove();
    if (ActorScriptEditor.activeInstance === this) ActorScriptEditor.activeInstance = null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses a JSON object literal; returns a tagged result rather than throwing. */
function parseJsonObject(
  text: string,
): { ok: true; value: Record<string, SceneJsonValue> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Must be a JSON object." };
    }
    return { ok: true, value: parsed as Record<string, SceneJsonValue> };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/** Reads a Vec3 from a props value, falling back to `fallback` when absent/malformed. */
function readVec3Prop(value: SceneJsonValue | undefined, fallback: Vec3): Vec3 {
  if (Array.isArray(value) && value.length === 3) {
    const [x, y, z] = value;
    if (typeof x === "number" && typeof y === "number" && typeof z === "number") return [x, y, z];
  }
  return [...fallback] as Vec3;
}

/** Stores a Vec3 prop, or deletes the key when it equals the identity (keeps files lean). */
function setVec3Prop(
  props: Record<string, SceneJsonValue>,
  key: string,
  value: Vec3,
  identity: Vec3,
): void {
  if (value.every((axis, i) => axis === identity[i])) delete props[key];
  else props[key] = [...value];
}

/** A 3-input (X/Y/Z) numeric row bound by `data-as-vec="<key>"`. */
function vec3Row(key: string, label: string, value: Vec3): string {
  const input = (axis: number): string =>
    `<input type="number" step="0.1" value="${value[axis]}" aria-label="${escapeHtml(label)} ${"XYZ"[axis]}" />`;
  return `
    <label class="as-field as-vec-field">
      <span>${label}</span>
      <div class="as-vec3" data-as-vec="${escapeHtml(key)}">
        ${input(0)}${input(1)}${input(2)}
      </div>
    </label>
  `;
}

const LIGHT_TYPES: readonly SceneLightType[] = ["directional", "point", "spot"];
const LIGHT_TYPE_LABELS: Record<SceneLightType, string> = {
  directional: "Directional",
  point: "Point",
  spot: "Spot",
};

const COLLIDER_SHAPES = ["box", "sphere", "capsule", "cylinder", "cone"] as const;
const COLLIDER_SHAPE_LABELS: Record<(typeof COLLIDER_SHAPES)[number], string> = {
  box: "Box",
  sphere: "Sphere",
  capsule: "Capsule",
  cylinder: "Cylinder",
  cone: "Cone",
};

const CHARACTER_MOVEMENT_MODES = ["walking", "falling", "flying", "swimming", "custom"] as const;

/** Reads a light `type` prop, defaulting to directional (matches the preview/engine). */
function readLightType(value: SceneJsonValue | undefined): SceneLightType {
  return typeof value === "string" && LIGHT_TYPES.includes(value as SceneLightType)
    ? (value as SceneLightType)
    : "directional";
}

/** Reads a numeric prop, falling back to `fallback` when absent/malformed. */
function readNumberProp(value: SceneJsonValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Reads a nested object prop (e.g. an AIController's `perception` / `navAgent`)
 * as a mutable record, returning a fresh empty object when the prop is missing or
 * not a plain object so callers can seed it in place.
 */
function readObjectProp(value: SceneJsonValue | undefined): Record<string, SceneJsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, SceneJsonValue>)
    : {};
}

/** Drops light props that do not apply to `type`, keeping the saved JSON tidy. */
function pruneLightProps(props: Record<string, SceneJsonValue>, type: SceneLightType): void {
  if (type === "directional") {
    delete props.distance;
    delete props.decay;
    delete props.angle;
    delete props.penumbra;
  } else if (type === "point") {
    delete props.angle;
    delete props.penumbra;
  }
}

function readColliderShape(value: SceneJsonValue | undefined): ColliderShape {
  return typeof value === "string" && (COLLIDER_SHAPES as readonly string[]).includes(value)
    ? (value as ColliderShape)
    : "box";
}

function capsuleDimensionsFromProps(props: Record<string, SceneJsonValue>) {
  const size = readVec3Prop(props.size, [
    DEFAULT_CAPSULE_RADIUS * 2,
    DEFAULT_CAPSULE_HALF_HEIGHT * 2,
    DEFAULT_CAPSULE_RADIUS * 2,
  ]);
  const radius = readNumberProp(props.capsuleRadius, Math.max(size[0], size[2]) / 2);
  const halfHeight = readNumberProp(props.capsuleHalfHeight, size[1] / 2);
  return resolveCapsuleDimensions(radius, halfHeight);
}

function setCapsuleProps(
  props: Record<string, SceneJsonValue>,
  radius: number,
  halfHeight: number,
): void {
  const capsule = resolveCapsuleDimensions(radius, halfHeight);
  props.capsuleRadius = capsule.radius;
  props.capsuleHalfHeight = capsule.halfHeight;
  delete props.size;
  delete props.center;
}

function colliderFields(node: ComponentTemplateNode): string {
  const props = node.props;
  const shape = readColliderShape(props.shape);
  const shapeOptions = COLLIDER_SHAPES.map(
    (value) =>
      `<option value="${value}" ${value === shape ? "selected" : ""}>${COLLIDER_SHAPE_LABELS[value]}</option>`,
  ).join("");
  const capsule = capsuleDimensionsFromProps(props);
  return `
    <div class="as-section-label">Collider</div>
    <label class="as-field">
      <span>Shape</span>
      <select data-as-collider-shape>${shapeOptions}</select>
    </label>
    ${
      shape === "capsule"
        ? `
          <label class="as-field">
            <span>Capsule Radius</span>
            <input type="number" data-as-capsule-radius value="${capsule.radius}" step="0.05" min="0.001" />
          </label>
          <label class="as-field">
            <span>Capsule Half Height</span>
            <input type="number" data-as-capsule-half-height value="${capsule.halfHeight}" step="0.05" min="0.001" />
          </label>`
        : `
          ${vec3Row("size", "Size", readVec3Prop(props.size, [1, 1, 1]))}
          ${vec3Row("center", "Center", readVec3Prop(props.center, [0, 0, 0]))}
          ${vec3Row("rotation", "Collider Rotation°", readVec3Prop(props.rotation, [0, 0, 0]))}`
    }
    <label class="as-field as-check">
      <input type="checkbox" data-as-collider-static ${props.isStatic === true ? "checked" : ""} />
      <span>Static</span>
    </label>
    <label class="as-field as-check">
      <input type="checkbox" data-as-collider-sensor ${props.isSensor === true ? "checked" : ""} />
      <span>Sensor</span>
    </label>
    <label class="as-field as-check">
      <input type="checkbox" data-as-collider-simulate ${props.simulatePhysics === true ? "checked" : ""} />
      <span>Simulate Physics</span>
    </label>
    <label class="as-field as-check">
      <input type="checkbox" data-as-collider-hide-in-game ${props.hideInGame === true ? "checked" : ""} />
      <span>Hide In Game</span>
    </label>
  `;
}

/**
 * The Light Details form: a type picker (directional/point/spot) plus the fields
 * that apply to the chosen type. Distance/Decay show for point + spot; Angle°
 * (engine reads degrees) + Penumbra show for spot. Writes to `node.props` so the
 * preview light + reach gizmo update live.
 */
function lightFields(node: ComponentTemplateNode): string {
  const props = node.props;
  const type = readLightType(props.type);
  const isPoint = type === "point";
  const isSpot = type === "spot";
  const color = typeof props.color === "string" ? props.color : "#ffffff";
  const intensity = readNumberProp(props.intensity, 1);
  const distance = readNumberProp(props.distance, isPoint ? 8 : 10);
  const decay = readNumberProp(props.decay, 2);
  const angle = readNumberProp(props.angle, 30);
  const penumbra = readNumberProp(props.penumbra, 0.35);
  const typeOptions = LIGHT_TYPES.map(
    (value) =>
      `<option value="${value}" ${value === type ? "selected" : ""}>${LIGHT_TYPE_LABELS[value]}</option>`,
  ).join("");
  const numberField = (key: string, label: string, value: number, attrs: string): string => `
    <label class="as-field">
      <span>${label}</span>
      <input type="number" data-as-light-num="${key}" value="${value}" ${attrs} />
    </label>`;
  return `
    <div class="as-section-label">Light</div>
    <label class="as-field">
      <span>Type</span>
      <select data-as-light-type>${typeOptions}</select>
    </label>
    <label class="as-field">
      <span>Color</span>
      <input type="color" data-as-light-color value="${escapeHtml(color)}" />
    </label>
    ${numberField("intensity", "Intensity", intensity, 'step="0.1" min="0" max="20"')}
    ${
      isPoint || isSpot
        ? numberField("distance", "Distance", distance, 'step="0.1" min="0" max="100"') +
          numberField("decay", "Decay", decay, 'step="0.1" min="0" max="8"')
        : ""
    }
    ${
      isSpot
        ? numberField("angle", "Angle°", angle, 'step="1" min="1" max="90"') +
          numberField("penumbra", "Penumbra", penumbra, 'step="0.05" min="0" max="1"')
        : ""
    }
  `;
}

function characterMovementFields(node: ComponentTemplateNode): string {
  const props = node.props;
  const mode =
    typeof props.movementMode === "string" &&
    (CHARACTER_MOVEMENT_MODES as readonly string[]).includes(props.movementMode)
      ? props.movementMode
      : "walking";
  const numberField = (key: string, label: string, fallback: number, attrs: string): string => `
    <label class="as-field">
      <span>${label}</span>
      <input type="number" data-as-character-movement-num="${key}" value="${readNumberProp(
        props[key],
        fallback,
      )}" ${attrs} />
    </label>`;
  const modeOptions = CHARACTER_MOVEMENT_MODES.map(
    (value) => `<option value="${value}" ${value === mode ? "selected" : ""}>${value}</option>`,
  ).join("");
  return `
    <div class="as-section-label">Character Movement</div>
    <label class="as-field">
      <span>Movement Mode</span>
      <select data-as-character-movement-mode>${modeOptions}</select>
    </label>
    ${numberField("maxWalkSpeed", "Max Walk Speed", 3, 'step="0.1" min="0"')}
    ${numberField("sprintMultiplier", "Sprint Multiplier", 2, 'step="0.1" min="0"')}
    ${numberField("jumpSpeed", "Jump Speed", 4, 'step="0.1" min="0"')}
    ${numberField("gravityScale", "Gravity Scale", 1, 'step="0.1"')}
    ${numberField("airControl", "Air Control", 0.25, 'step="0.05" min="0" max="1"')}
    ${numberField("acceleration", "Acceleration", 30, 'step="1" min="0"')}
    ${numberField("brakingDeceleration", "Braking Deceleration", 24, 'step="1" min="0"')}
    ${numberField("groundFriction", "Ground Friction", 8, 'step="0.1" min="0"')}
    ${vec3Row("rotationRate", "Rotation Rate°/s", readVec3Prop(props.rotationRate, [0, 0, 500]))}
    ${numberField("maxStepHeight", "Max Step Height", 0.45, 'step="0.05" min="0"')}
    ${numberField("maxStepDown", "Max Step Down", 0.5, 'step="0.05" min="0"')}
    ${numberField("maxSlopeAngleDeg", "Max Slope Angle°", 45, 'step="1" min="0" max="89"')}
    ${numberField("uphillSpeedScale", "Uphill Speed Scale", 0.65, 'step="0.05" min="0" max="1"')}
    ${numberField("stepSmoothSpeed", "Step Smooth Speed", 6, 'step="0.5" min="0"')}
    <label class="as-field as-check">
      <input type="checkbox" data-as-character-movement-orient ${
        props.orientRotationToMovement === false ? "" : "checked"
      } />
      <span>Orient Rotation To Movement</span>
    </label>
    <label class="as-field as-check">
      <input type="checkbox" data-as-character-movement-orient-control ${
        props.orientRotationToControl === true ? "checked" : ""
      } />
      <span>Orient Rotation To Control</span>
    </label>
  `;
}

/** A generic numeric prop field bound by `data-as-num="<key>"`. */
function numberPropField(
  props: Record<string, SceneJsonValue>,
  key: string,
  label: string,
  fallback: number,
  attrs: string,
): string {
  return `
    <label class="as-field">
      <span>${label}</span>
      <input type="number" data-as-num="${key}" value="${readNumberProp(props[key], fallback)}" ${attrs} />
    </label>`;
}

/**
 * The Spring Arm (camera boom) Details form. Draft for the next gameplay phase:
 * the values are authored + persisted, mapped onto the follow camera later. Arm
 * length + offsets place the camera socket; the lag/collision toggles shape the
 * follow feel. Writes to `node.props`.
 */
function springArmFields(node: ComponentTemplateNode): string {
  const props = node.props;
  const lag = props.enableCameraLag === true;
  return `
    <div class="as-section-label">Spring Arm</div>
    ${numberPropField(props, "targetArmLength", "Target Arm Length", 3, 'step="0.1" min="0"')}
    ${vec3Row("socketOffset", "Socket Offset", readVec3Prop(props.socketOffset, [0, 0, 0]))}
    ${vec3Row("targetOffset", "Target Offset", readVec3Prop(props.targetOffset, [0, 0, 0]))}
    <label class="as-field as-check">
      <input type="checkbox" data-as-spring-lag ${lag ? "checked" : ""} />
      <span>Enable Camera Lag</span>
    </label>
    ${lag ? numberPropField(props, "cameraLagSpeed", "Camera Lag Speed", 10, 'step="0.5" min="0"') : ""}
    <label class="as-field as-check">
      <input type="checkbox" data-as-spring-collision ${
        props.doCollisionTest === false ? "" : "checked"
      } />
      <span>Do Collision Test</span>
    </label>
  `;
}

/**
 * The Camera Details form. Draft for the next gameplay phase: the projection is
 * authored + persisted, applied to the play camera later. Defaults mirror the
 * runtime camera (FOV 44, near 0.1, far 100). Writes to `node.props`.
 */
function cameraFields(node: ComponentTemplateNode): string {
  const props = node.props;
  const ortho = props.isOrthographic === true;
  return `
    <div class="as-section-label">Camera</div>
    ${numberPropField(props, "fieldOfView", "Field of View°", 44, 'step="1" min="1" max="170"')}
    ${numberPropField(props, "nearClip", "Near Clip", 0.1, 'step="0.01" min="0.001"')}
    ${numberPropField(props, "farClip", "Far Clip", 100, 'step="1" min="1"')}
    <label class="as-field as-check">
      <input type="checkbox" data-as-camera-ortho ${ortho ? "checked" : ""} />
      <span>Orthographic</span>
    </label>
    ${ortho ? numberPropField(props, "orthoWidth", "Ortho Width", 10, 'step="0.5" min="0.1"') : ""}
    <label class="as-field as-check">
      <input type="checkbox" data-as-camera-sprint-shake ${
        props.enableSprintCameraShake === false ? "" : "checked"
      } />
      <span>Enable Sprint Camera Shake</span>
    </label>
  `;
}

function defaultComponentProps(kind: ActorComponentKind): Record<string, SceneJsonValue> {
  if (kind === "Collider") {
    return { shape: "box", size: [1, 1, 1], isStatic: false, isSensor: false };
  }
  if (kind === "CharacterMovement") {
    return {
      maxWalkSpeed: 3,
      sprintMultiplier: 2,
      jumpSpeed: 4,
      gravityScale: 1,
      airControl: 0.25,
      acceleration: 30,
      brakingDeceleration: 24,
      groundFriction: 8,
      rotationRate: [0, 0, 500],
      orientRotationToMovement: true,
      orientRotationToControl: false,
      movementMode: "walking",
      maxStepHeight: 0.45,
      maxStepDown: 0.5,
      maxSlopeAngleDeg: 45,
      uphillSpeedScale: 0.65,
      stepSmoothSpeed: 6,
    };
  }
  if (kind === "SpringArm") {
    return { targetArmLength: 3, enableCameraLag: true, cameraLagSpeed: 10 };
  }
  if (kind === "Camera") {
    return { fieldOfView: 44, nearClip: 0.1, farClip: 100, enableSprintCameraShake: true };
  }
  if (kind === "Audio") {
    // Minimum shape `readAudioComponent` accepts; the user picks a Sound/Cue next.
    // `autoPlay` defaults true (Unreal AudioComponent Auto Activate parity) so a
    // picked sound is audible in Play without an extra toggle.
    return { clipId: "", volume: 1, loop: false, spatial: false, autoPlay: true };
  }
  if (kind === "AIController") {
    // Marks the actor as an AI-controlled pawn. `behaviorTree` / `blackboard`
    // asset paths are wired by the Faz 2 loader; perception (Faz 4) and nav-agent
    // (Faz 3) tuning are edited through dedicated Details number fields.
    return {
      behaviorTree: "",
      blackboard: "",
      perception: { sightRadius: 18, nearSightRadius: 2, fieldOfViewDeg: 110, hearingRadius: 12 },
      navAgent: { radius: 0.35, height: 1.8, maxSpeed: 3.2, clearancePadding: 0.1 },
    };
  }
  if (kind === "SmartObject") {
    return {
      tags: ["usable"],
      slots: [{ id: "slot-1", tags: ["usable"], position: [0, 0, 0] }],
      interactionPosition: [0, 0, 0],
      cooldown: 0,
      enabled: true,
    };
  }
  return {};
}

function stringifyMetadataDefault(value: MetadataFieldDef["default"]): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Coerces a Details text input into a metadata default of the field's type. */
function coerceMetadataDefault(
  text: string,
  type: MetadataFieldType,
): MetadataFieldDef["default"] {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "boolean") return trimmed === "true";
  if (type === "tags") {
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return trimmed;
}

function uniqueNonEmptyCsv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ];
}
