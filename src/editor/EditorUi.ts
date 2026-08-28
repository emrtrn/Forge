// Editor-only styles. Importing here (rather than statically in index.html)
// keeps them in the dev-only editor chunk, out of the production game build.
import "./editorUi.css";
import {
  assetPath,
  assetRecordById,
  assetType,
  inferAssetTypeFromPath,
  isModelAssetType,
  type EditableAsset,
} from "@engine/assets/manifest";
import type {
  EditableSceneObject,
  EditableSelection,
  EditorProjectInfo,
  EditorHistoryState,
  EditorSnapSettings,
  EditorWorldSettings,
  EditableTransform,
  EditableTransformSnapshot,
  SceneApp,
} from "@/scene/SceneApp";
import type { MetadataSchema } from "@engine/scene/metadataSchema";
import type { AiPatrolRoute } from "@engine/scene/components";
import {
  AMBIENT_SOUND_ASSET_ID,
  PLAYER_START_ASSET_ID,
  shapeAssetId,
  type ShapePrimitiveType,
} from "@engine/scene/shapes";
import { writePlayCameraPose } from "@/play/cameraHandoff";
import { ThumbnailRenderer, type ThumbnailMaterialPreview } from "./ThumbnailRenderer";
import {
  createProjectContent,
  deleteProjectContent,
  fetchProjectDir,
  findProjectDir,
  flattenProjectFiles,
  importProjectAsset,
  normalizeProjectPath,
  openProjectLevel,
  reimportProjectAsset,
  renameProjectContent,
  transferProjectContent,
  type ContentNewKind,
  type ProjectDirNode,
} from "@/project/ProjectAssetTree";
import { projectFileUrl } from "@/project/ProjectSystem";
import { attachDebugStats } from "@/scene/debugStats";
import { loadAssetMaterialSlots } from "@/scene/assetMaterialSlotsLoader";
import {
  getGameEditorCatalog,
  type EditorGameModeOption,
} from "@/editor/gameEditorRegistry";
import { loadActorScript } from "@/editor/actorScriptStore";
import {
  PARENT_CLASSES,
  PARENT_CLASS_DESCRIPTIONS,
  PARENT_CLASS_LABELS,
  type ParentClass,
} from "@engine/scene/actorScript";
import {
  FORGE_MATERIAL_PRESETS,
  normalizeForgeMaterialDef,
  type ForgeMaterialPreset,
} from "@engine/assets/material";
import {
  PARTICLE_EFFECT_PRESETS,
  PARTICLE_PRESET_DESCRIPTIONS,
  PARTICLE_PRESET_LABELS,
  type ParticleEffectPreset,
} from "@engine/vfx/particleEffectPresets";
import {
  nextTransformTool,
  type CameraView,
  type EditorTool,
  type TransformSpace,
  type ViewMode,
  type ViewportViewState,
} from "@editor/core/tools";
import {
  bindInstanceDetails,
  renderInstanceDetails,
} from "./panels/details/instanceDetails";
import {
  bindCollisionOverrideInputs,
  renderCollisionSection,
} from "./panels/details/collisionDetails";
import {
  bindNavigationInputs,
  renderNavigationSection,
} from "./panels/details/navigationDetails";
import { renderMaterialSection } from "./panels/details/materialDetails";
import {
  bindPhysicsInputs,
  renderPhysicsSection,
} from "./panels/details/physicsDetails";
import {
  bindComponentsInputs,
  renderComponentsSection,
} from "./panels/details/componentDetails";
import {
  bindMetadataInputs,
  renderMetadataSections,
} from "./panels/details/metadataDetails";
import {
  renderAiNavigationVolumeDetails,
  renderBlockingVolumeDetails,
  renderLandscapeDetails,
  renderSplineDetails,
  renderTargetPointDetails,
  renderLightDetails,
  renderReflectionCaptureDetails,
  renderReflectionPlaneDetails,
  renderReflectiveSurfaceDetails,
  renderWorldWidgetDetails,
  type SpecialActorDetailsOptions,
} from "./panels/details/specialActorDetails";
import {
  renderCloudDetails,
  renderFogDetails,
  renderPostDetails,
  renderSkyDetails,
  type EnvironmentDetailsOptions,
} from "./panels/details/environmentDetails";
import { renderWorldSettingsPanel } from "./panels/world/worldSettingsPanel";
import { renderFoliagePanel } from "./panels/foliage/foliagePanel";
import { UI_ICONS, ACTOR_TYPE_ICONS, type ActorTypeIcon } from "./editorIcons";
import { createFoliageType } from "@engine/scene/foliage";
import {
  OUTLINER_FILTER_TYPES,
  renderOutlinerPanel,
  type OutlinerFilterType,
} from "./panels/outliner/outlinerPanel";
import {
  CONTENT_FILTER_ALL,
  contentItemMatchesQuery,
  isActorScriptItem,
  isContentTypeFilter,
  isLevelItem,
  isUiWidgetItem,
  renderContentAssetsPanel,
  renderContentFilterOptions,
  type BrowserAssetItem,
  type BrowserFolderItem,
  type ContentTypeFilter,
} from "./panels/content/contentPanel";

type InspectorTab = "details" | "meshPaint" | "foliage";

/** Typed assets the Content Browser context menu can create (besides folders). */
const CONTENT_NEW_ITEMS: ReadonlyArray<{ kind: ContentNewKind; label: string }> = [
  { kind: "level", label: "Level" },
  { kind: "material", label: "Material" },
  { kind: "particle", label: "Particle" },
  { kind: "script", label: "Script" },
  { kind: "soundCue", label: "Sound Cue" },
  { kind: "dialogueVoice", label: "Dialogue Voice" },
  { kind: "dialogueLine", label: "Dialogue Line" },
  { kind: "ui", label: "UI" },
];

/** AI-authoring assets, grouped under an "Artificial Intelligence" flyout in the Content Browser menu. */
const CONTENT_NEW_AI_ITEMS: ReadonlyArray<{ kind: ContentNewKind; label: string }> = [
  { kind: "blackboard", label: "AI Blackboard" },
  { kind: "behaviorTree", label: "AI Behavior Tree" },
  { kind: "aiQuery", label: "AI Query (EQS)" },
  { kind: "stateTree", label: "AI State Tree" },
];

/** Project-scoped browser storage key prefix for Content Drawer navigation state. */
const CONTENT_DRAWER_LAST_FOLDER_STORAGE_PREFIX = "forge.editor.content-drawer.last-folder.v1:";

const MATERIAL_PRESET_LABELS: Record<ForgeMaterialPreset, string> = {
  standard: "Standard Surface",
  textured: "Textured Surface",
  metal: "Metal",
  glass: "Glass",
  emissive: "Emissive",
  basic: "Unlit Basic",
};

const MATERIAL_PRESET_DESCRIPTIONS: Record<ForgeMaterialPreset, string> = {
  standard: "General lit PBR material with neutral roughness.",
  textured: "Standard material prepared for texture slots.",
  metal: "Reflective metal starter values.",
  glass: "Simple transparent glass-like starter values.",
  emissive: "Self-lit surface for signs, screens, and glow accents.",
  basic: "Unlit material for simple debug or UI-like surfaces.",
};

/** A context-menu entry: a clickable item or a visual separator. */
type ContextMenuSeparator = { separator: true };
type ContextMenuAction = {
  separator?: false;
  label: string;
  enabled?: boolean;
  danger?: boolean;
  run: () => void;
};
type ContextMenuSubmenu = { separator?: false; label: string; items: ContextMenuItem[] };
type ContextMenuItem = ContextMenuSeparator | ContextMenuAction | ContextMenuSubmenu;

function isContextMenuAction(item: ContextMenuItem): item is ContextMenuAction {
  return !item.separator && "run" in item;
}

const TOOL_LABELS: Record<EditorTool, string> = {
  select: "Select",
  move: "Move",
  rotate: "Rotate",
  scale: "Scale",
};

/**
 * Inline 16×16 stroke SVGs for the transform toolbar. Kept as strings (no asset
 * files) so the editor bundle stays self-contained. All use `currentColor` so
 * the active/hover button colors flow through from CSS.
 */
const TOOLBAR_ICONS = {
  select:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2l9 4.4-4 1.1-1.1 4z"/></svg>',
  move:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v12M2 8h12"/><path d="M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2"/></svg>',
  rotate:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.6"/><path d="M13.2 3v2.6h-2.6"/></svg>',
  scale:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h4.5M3 3v4.5M3 3l6.5 6.5"/><rect x="9" y="9" width="4" height="4"/></svg>',
  world:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.4 2 2.4 10 0 12M8 2c-2.4 2-2.4 10 0 12"/></svg>',
  local:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l5 3v6l-5 3-5-3V5z"/><path d="M8 8v6M3 5l5 3 5-3"/></svg>',
  snap:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/></svg>',
  camera:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5h6.5L10 3.5h3.5v9H2z"/><circle cx="6.5" cy="9" r="2.4"/></svg>',
  viewmode:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" stroke="none"/></svg>',
  undo:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4L3 7l3 3"/><path d="M3 7h5.5a3.5 3.5 0 0 1 0 7H7"/></svg>',
  redo:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4l3 3-3 3"/><path d="M13 7H7.5a3.5 3.5 0 0 0 0 7H9"/></svg>',
  trash:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5h9"/><path d="M6 4.5V3h4v1.5"/><path d="M5 4.5l.6 8.5a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9l.6-8.5"/><path d="M6.7 7v4.2M9.3 7v4.2"/></svg>',
  save:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5h7.4l1.6 1.6v6.9a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5z"/><path d="M5.5 3.5v3h4v-3"/><rect x="5.5" y="9" width="5" height="3.5"/></svg>',
  play:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M5 3.4l7.2 4.6L5 12.6z"/></svg>',
} as const;

/** Menu-button labels for each Camera view preset. */
const CAMERA_VIEW_LABELS: Record<CameraView, string> = {
  perspective: "Perspective",
  top: "Top",
  left: "Left",
  front: "Front",
};

/** Menu-button labels for each viewport View Mode. */
const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  lit: "Lit",
  wireframe: "Wireframe",
};

/** Chevron appended to menu buttons that open a hover popover. */
const MENU_CHEVRON =
  '<svg class="menu-chevron" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5L6 7.5 9 4.5"/></svg>';

/**
 * Add Actor flyout categories in display order, each with a type icon
 * (EDITOR_UI_REDESIGN_PLAN Faz 2). Entries carry a matching `category` label so
 * the markup can be generated from one source shared by the categories and the
 * flat search results.
 */
const ADD_ACTOR_CATEGORIES: readonly { label: string; icon: ActorTypeIcon }[] = [
  { label: "Lights", icon: "light" },
  { label: "Shapes", icon: "shape" },
  { label: "Volumes", icon: "volume" },
  { label: "Visual Effects", icon: "reflection" },
  { label: "Terrain", icon: "terrain" },
  { label: "Sounds", icon: "sound" },
  { label: "UI", icon: "widget" },
  { label: "Gameplay", icon: "gameplay" },
];

const SHAPE_ACTOR_ICONS = {
  cube: "shapeCube",
  sphere: "shapeSphere",
  cylinder: "shapeCylinder",
  cone: "shapeCone",
  plane: "shapePlane",
} as const satisfies Record<"cube" | "sphere" | "cylinder" | "cone" | "plane", ActorTypeIcon>;

/**
 * One placeable actor in the Add Actor flyout. A single descriptor drives the
 * category submenu button and the search result row, so drag payloads / click
 * actions stay identical across both surfaces.
 */
interface AddActorEntry {
  /** Stable id used by category and search rows. */
  key: string;
  label: string;
  /** Matches an `ADD_ACTOR_CATEGORIES` label. */
  category: string;
  icon: ActorTypeIcon;
  /** Extra button attribute markup (preserves the cube `data-testid`). */
  attr?: string;
  /** Drag-to-place payload; omitted for click-only singleton actors. */
  drag?: { mime: string; payload: () => string; beginPreview?: () => void };
  /** Runs on click. */
  onClick: () => void;
}

function formatActiveLevelName(path: string | undefined): string {
  const fileName = normalizeProjectPath(path ?? "").split("/").filter(Boolean).at(-1) ?? "";
  const levelName = fileName
    .replace(/\.level\.json$/i, "")
    .replace(/\.layout\.json$/i, "")
    .replace(/\.json$/i, "");
  return levelName || "Untitled Level";
}

export class EditorUi {
  /** Whether the `#debug-stats` perf overlay is currently shown (Show > Stats). */
  private statsVisible = false;
  /** The debug overlay attaches lazily on first show so it costs nothing until used. */
  private statsAttached = false;
  private root: HTMLDivElement;
  private contentList: HTMLDivElement;
  private contentDrawer: HTMLElement;
  private contentToggle: HTMLButtonElement;
  private contentRootLabel: HTMLElement;
  private contentPathLabel: HTMLElement;
  private contentItemCount: HTMLElement;
  private contentStatus: HTMLElement;
  private contentSearch: HTMLInputElement;
  private contentTypeFilter: HTMLSelectElement;
  private contentDevelopmentToggle: HTMLInputElement;
  private contentBackButton: HTMLButtonElement;
  private contentForwardButton: HTMLButtonElement;
  private contentFilterButton: HTMLButtonElement;
  private contentFilterPopover: HTMLElement;
  private contentSettingsButton: HTMLButtonElement;
  private contentViewButton: HTMLButtonElement;
  private folderTree: HTMLElement;
  private outlinerList: HTMLDivElement;
  private outlinerSummary: HTMLElement;
  private detailsBody: HTMLDivElement;
  private worldSettingsBody: HTMLDivElement;
  private meshPaintBody!: HTMLDivElement;
  private foliageBody!: HTMLDivElement;
  private inspectorTab: InspectorTab = "details";
  private statusText: HTMLElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  private toolButtons = new Map<EditorTool, HTMLButtonElement>();
  private readonly thumbnailRenderer = new ThumbnailRenderer();
  private readonly materialPreviewCache = new Map<string, Promise<ThumbnailMaterialPreview | undefined>>();
  private readonly modelMaterialPreviewCache = new Map<string, Promise<ThumbnailMaterialPreview | undefined>>();
  private activeTool: EditorTool = "move";
  private projectInfo: EditorProjectInfo | null = null;
  private metadataSchema: MetadataSchema | null = null;
  private editableAssets: EditableAsset[] = [];
  private assetTreeRoot: ProjectDirNode | null = null;
  /** All project Actor Script classes discovered for editor pickers (game mode / pawn). */
  private projectActorClasses: { path: string; name: string; parentClass: ParentClass }[] = [];
  /** Project `gameMode` Actor Scripts discovered for the World Settings dropdown. */
  private projectGameModes: EditorGameModeOption[] = [];
  private selectedFolder = "";
  private collapsedFolderPaths = new Set<string>();
  /** User-pinned folders, persisted per project for fast Content Drawer access. */
  private favoriteContentFolders = new Set<string>();
  /** Content Browser asset card highlighted as selected (orange). */
  private selectedAssetId: string | null = null;
  /** Content Browser folder card highlighted as selected. */
  private selectedContentFolderPath: string | null = null;
  /** One-file editor clipboard; Cut remains in memory until a successful paste. */
  private contentClipboard: { path: string; label: string; operation: "copy" | "move" } | null = null;
  /** Cached 1x1 transparent image used to suppress the native drag thumbnail. */
  private emptyDragImage: HTMLImageElement | null = null;
  private contentQuery = "";
  private contentType: ContentTypeFilter = CONTENT_FILTER_ALL;
  private contentNavigationHistory: string[] = [];
  private contentNavigationIndex = -1;
  private contentViewSize: "small" | "medium" | "large" = "medium";
  private contentDrawerOpen = false;
  private contentDrawerTall = false;
  /** When locked, the drawer never auto-closes on an outside click or asset drop. */
  private contentDrawerLocked = false;
  private showDevelopmentContent = false;
  private contentRefreshTimer = 0;
  private outlinerObjects: EditableSceneObject[] = [];
  private outlinerFilter = "";
  /** Selection to reveal after SceneApp publishes its fresh Outliner view model. */
  private outlinerScrollTargetId: string | null = null;
  private outlinerVisibleTypes = new Set<OutlinerFilterType>(
    OUTLINER_FILTER_TYPES.map(({ type }) => type),
  );
  private selected: EditableSelection | null = null;
  /** Cached skeletal clip names per asset id, for the character Animation dropdown. */
  private readonly characterClipCache = new Map<string, readonly string[]>();
  /** Asset ids whose skeletal clip load is in flight (avoids duplicate fetches). */
  private readonly characterClipLoading = new Set<string>();
  private worldSettings: EditorWorldSettings | null = null;
  private detailsBaseline: EditableTransformSnapshot[] | null = null;
  private detailsScale: [number, number, number] | null = null;
  private transformClipboard: EditableTransform | null = null;
  private contextMenu: HTMLElement | null = null;
  private contextMenuCleanup: (() => void) | null = null;
  /** Removes the World Settings popover's outside-click / Escape listeners. */
  private worldSettingsPopoverCleanup: (() => void) | null = null;
  /** Hidden file input reused by the Content Browser Import flow. */
  private importInput: HTMLInputElement | null = null;
  /** Folder the next Import upload targets (set when Import is clicked). */
  private importTargetDir = "";
  /** Existing model selected for the next Reimport upload, if any. */
  private reimportTarget: BrowserAssetItem | null = null;
  /** All placeable Add Actor entries, built once (drives menu + search). */
  private readonly addActorEntries: AddActorEntry[];

  constructor(private readonly app: SceneApp) {
    document.body.classList.add("editor-mode");
    // Preload the transparent drag image so setDragImage works on the first drag.
    this.getEmptyDragImage();
    this.addActorEntries = this.buildAddActorEntries();

    this.root = document.createElement("div");
    this.root.id = "editor-ui";
    this.root.className = "editor-shell";
    this.root.dataset.testid = "forge-editor";
    this.root.addEventListener("contextmenu", (event) => event.preventDefault());
    this.root.innerHTML = `
      <div class="editor-viewport-host" data-viewport-host></div>
      <header class="editor-topbar">
        <div class="editor-lead">
          <div class="editor-brand">
            <span class="editor-logo" aria-hidden="true">F</span>
            <span class="editor-brand-text">
              <strong>Forge</strong>
              <span class="editor-level-name" data-project-name>loading level</span>
            </span>
          </div>
          <button type="button" class="tool-button editor-main-menu-button" data-main-menu-button aria-label="Menu">${UI_ICONS.hamburger}</button>
        </div>
        <div class="editor-workbar">
          <div class="editor-history-actions">
            <button type="button" class="tool-button" data-action="save" data-testid="editor-save" aria-label="Save Layout">${TOOLBAR_ICONS.save}</button>
            <button type="button" class="tool-button" data-action="undo" data-testid="editor-undo" aria-label="Undo">${TOOLBAR_ICONS.undo}</button>
            <button type="button" class="tool-button" data-action="redo" data-testid="editor-redo" aria-label="Redo">${TOOLBAR_ICONS.redo}</button>
            <button type="button" class="tool-button" data-action="delete" aria-label="Delete">${TOOLBAR_ICONS.trash}</button>
          </div>
          <span class="topbar-divider"></span>
          <div class="add-actor-menu">
            <button type="button" class="topbar-menu-button primary" data-add-actor-button data-testid="add-actor-button" aria-label="Add actor">+ Add Actor${MENU_CHEVRON}</button>
            <div class="add-actor-popover" data-add-actor-popover>${this.buildAddActorMenuMarkup()}</div>
          </div>
          <div class="editor-tools" data-tools></div>
          <div class="editor-snaps">
          <label class="snap-widget">
            <input type="checkbox" data-snap-toggle="move" checked />
            <span class="snap-icon">${TOOLBAR_ICONS.snap}</span>
            <select data-snap="move" aria-label="Move snap">
              <option value="0.25">0.25</option>
              <option value="0.5">0.5</option>
              <option value="1" selected>1</option>
            </select>
          </label>
          <label class="snap-widget">
            <input type="checkbox" data-snap-toggle="rotate" checked />
            <span class="snap-icon">${TOOLBAR_ICONS.rotate}</span>
            <select data-snap="rotate" aria-label="Rotate snap">
              <option value="5">5°</option>
              <option value="10">10°</option>
              <option value="15" selected>15°</option>
              <option value="30">30°</option>
              <option value="45">45°</option>
              <option value="90">90°</option>
            </select>
          </label>
          <label class="snap-widget">
            <input type="checkbox" data-snap-toggle="scale" checked />
            <span class="snap-icon">${TOOLBAR_ICONS.scale}</span>
            <select data-snap="scale" aria-label="Scale snap">
              <option value="0.05">0.05</option>
              <option value="0.1" selected>0.1</option>
              <option value="0.25">0.25</option>
              <option value="0.5">0.5</option>
              <option value="1">1</option>
            </select>
          </label>
          </div>
          <div class="editor-view-controls">
          <div class="camera-menu topbar-menu">
            <button type="button" class="topbar-menu-button" data-camera-button aria-label="Camera view">
              ${TOOLBAR_ICONS.camera}<span data-camera-label>Perspective</span>${MENU_CHEVRON}
            </button>
            <div class="topbar-popover" data-camera-popover>
              <button type="button" data-camera-view="perspective">Perspective</button>
              <button type="button" data-camera-view="top">Top</button>
              <button type="button" data-camera-view="left">Left</button>
              <button type="button" data-camera-view="front">Front</button>
            </div>
          </div>
          <div class="viewmode-menu topbar-menu">
            <button type="button" class="topbar-menu-button" data-viewmode-button aria-label="View mode">
              ${TOOLBAR_ICONS.viewmode}<span data-viewmode-label>Lit</span>${MENU_CHEVRON}
            </button>
            <div class="topbar-popover" data-viewmode-popover>
              <button type="button" data-view-mode="lit">Lit</button>
              <button type="button" data-view-mode="wireframe">Wireframe</button>
            </div>
          </div>
          <div class="show-menu topbar-menu">
            <button type="button" class="topbar-menu-button" data-show-button aria-label="Show flags">Show${MENU_CHEVRON}</button>
            <div class="topbar-popover" data-show-popover>
              <button type="button" data-show-flag="collision">Collision</button>
              <button type="button" data-show-flag="ai-navigation">AI Navigation</button>
              <button type="button" data-show-flag="stats">Stats (FPS)</button>
            </div>
          </div>
          <div class="editor-play-split">
            <button type="button" class="editor-play-button primary" data-action="play" data-testid="editor-play" aria-label="Play">${TOOLBAR_ICONS.play}<span>Play</span></button>
          </div>
          </div>
        </div>
      </header>
      <aside class="editor-panel editor-outliner">
        <div class="inspector-tabs outliner-tabs" role="tablist" aria-label="Outliner panels">
          <button
            type="button"
            class="inspector-tab outliner-tab active"
            data-outliner-tab="scene"
            role="tab"
            aria-selected="true"
            aria-controls="scene-outliner-pane"
          >Scene Outliner</button>
        </div>
        <div class="outliner-pane" id="scene-outliner-pane" data-outliner-pane="scene" role="tabpanel">
          <div class="outliner-search-row">
            <label class="outliner-search-wrap">
              ${UI_ICONS.search}
              <input
                class="outliner-search"
                type="search"
                data-outliner-search
                placeholder="Search actors..."
                aria-label="Search actors"
              />
            </label>
            <div class="outliner-search-actions">
              <button type="button" class="forge-btn-ghost outliner-filter-button" data-outliner-filter-button
                data-testid="outliner-filter" aria-label="Filter scene objects" aria-expanded="false" title="Filter scene objects">${UI_ICONS.filter}</button>
              <div class="outliner-filter-popover" data-outliner-filter-popover hidden>
                <strong>Show types</strong>
                ${OUTLINER_FILTER_TYPES.map(({ type, label }) => `<label><input type="checkbox" data-outliner-type-filter="${type}" checked />${label}</label>`).join("")}
              </div>
            </div>
          </div>
          <div class="outliner-list" data-outliner-list></div>
          <div class="outliner-summary" data-outliner-summary data-testid="outliner-summary"></div>
        </div>
      </aside>
      <aside class="editor-panel editor-details">
        <div class="inspector-tabs" role="tablist" aria-label="Inspector">
          <button
            type="button"
            class="inspector-tab active"
            data-inspector-tab="details"
            role="tab"
            aria-selected="true"
          >Details</button>
          <button
            type="button"
            class="inspector-tab"
            data-inspector-tab="meshPaint"
            role="tab"
            aria-selected="false"
          >Mesh Paint</button>
          <button
            type="button"
            class="inspector-tab"
            data-inspector-tab="foliage"
            role="tab"
            aria-selected="false"
          >Foliage</button>
        </div>
        <div class="inspector-pane" data-inspector-pane="details">
          <div class="details-body" data-details-body></div>
        </div>
        <div class="inspector-pane" data-inspector-pane="meshPaint" hidden>
          <div class="details-body mesh-paint-body" data-mesh-paint-body></div>
        </div>
        <div class="inspector-pane" data-inspector-pane="foliage" hidden>
          <div class="details-body foliage-body" data-foliage-body></div>
        </div>
      </aside>
      <section class="editor-content-drawer" data-content-drawer aria-hidden="true">
        <div class="content-drawer-top">
          <div class="content-drawer-title">
            <button type="button" class="content-drawer-collapse" data-content-toggle aria-expanded="false" aria-label="Toggle Content Drawer" title="Toggle Content Drawer">
              <span class="content-drawer-chevron" aria-hidden="true">${UI_ICONS.chevronUp}</span>
              <strong>CONTENT DRAWER</strong>
            </button>
            <span data-content-root hidden></span>
          </div>
          <div class="content-primary-actions">
            <button type="button" class="forge-btn-primary" data-content-add>${UI_ICONS.add}<span>Add</span></button>
            <button type="button" class="forge-btn-ghost" data-content-import>${UI_ICONS.import}<span>Import</span></button>
            <button type="button" class="forge-btn-ghost" data-content-save-all>Save All</button>
          </div>
          <div class="content-navigation" aria-label="Folder navigation">
            <button type="button" class="forge-btn-ghost" data-content-back aria-label="Back" title="Back">${UI_ICONS.arrowLeft}</button>
            <button type="button" class="forge-btn-ghost" data-content-forward aria-label="Forward" title="Forward">${UI_ICONS.arrowRight}</button>
          </div>
          <nav class="content-breadcrumbs" aria-label="Current folder">
            <span class="content-breadcrumbs-icon" aria-hidden="true">${UI_ICONS.folder}</span>
            <div class="content-path" data-content-path></div>
          </nav>
          <div class="content-search-wrap">
            <input class="content-search" type="search" data-content-search placeholder="Search assets" />
            <button type="button" class="forge-btn-ghost content-filter-button" data-content-filter-button aria-label="Filter assets" aria-expanded="false" title="Filter assets">${UI_ICONS.filter}</button>
            <div class="content-filter-popover" data-content-filter-popover hidden>
              <label>Asset type<select class="content-filter" data-content-type-filter aria-label="Asset type"><option value="${CONTENT_FILTER_ALL}">All types</option></select></label>
            </div>
            <input type="checkbox" data-content-development-toggle hidden />
          </div>
          <div class="content-drawer-actions">
            <button type="button" class="forge-btn-ghost" data-content-view aria-label="Change thumbnail size" title="Thumbnail size: Medium">${UI_ICONS.grid}</button>
            <button type="button" class="forge-btn-ghost" data-content-settings aria-label="Content Drawer settings" title="Content Drawer settings">${UI_ICONS.gear}</button>
          </div>
        </div>
        <div class="content-drawer-body">
          <nav class="folder-tree" data-folder-tree aria-label="Asset folders"></nav>
          <section class="content-assets">
            <div class="content-assets-head"><span class="content-item-count" data-content-item-count>0 items</span></div>
            <div class="content-list" data-content-list></div>
          </section>
        </div>
      </section>
      <div class="world-settings-popover" data-world-settings-popover role="dialog" aria-label="World Settings" hidden>
        <div class="world-settings-popover-head">
          <button type="button" class="world-settings-popover-close" data-world-settings-close aria-label="Close">✕</button>
        </div>
        <div class="details-body world-settings-body" data-world-settings-body></div>
      </div>
      <footer class="editor-status" hidden>
        <span data-status data-testid="editor-status">Ready</span>
      </footer>
    `;

    const overlay = document.getElementById("ui-overlay");
    if (!overlay) throw new Error("Missing #ui-overlay");
    overlay.append(this.root);

    // Reparent the WebGL canvas (and the perf overlay) into the viewport host so
    // the 3D surface is a real panel that sizes itself to the space between the
    // outliner/details/content-drawer, instead of being a fullscreen backdrop
    // pinned by hand-tuned CSS offsets. Renderer/camera track the host via a
    // ResizeObserver on the canvas (SceneApp), and viewport overlays (Stats) now
    // live inside the host so they clip to the drawing area.
    const viewportHost = requireElement<HTMLElement>(this.root, "[data-viewport-host]");
    const canvas = document.getElementById("game-canvas");
    if (canvas) viewportHost.append(canvas);
    const stats = document.getElementById("debug-stats");
    if (stats) viewportHost.append(stats);

    this.contentList = requireElement(this.root, "[data-content-list]");
    this.contentDrawer = requireElement(this.root, "[data-content-drawer]");
    this.contentToggle = requireElement(this.root, "[data-content-toggle]");
    this.contentRootLabel = requireElement(this.root, "[data-content-root]");
    this.contentPathLabel = requireElement(this.root, "[data-content-path]");
    this.contentItemCount = requireElement(this.root, "[data-content-item-count]");
    this.contentSearch = requireElement(this.root, "[data-content-search]");
    this.contentTypeFilter = requireElement(this.root, "[data-content-type-filter]");
    this.contentDevelopmentToggle = requireElement(this.root, "[data-content-development-toggle]");
    this.contentBackButton = requireElement(this.root, "[data-content-back]");
    this.contentForwardButton = requireElement(this.root, "[data-content-forward]");
    this.contentFilterButton = requireElement(this.root, "[data-content-filter-button]");
    this.contentFilterPopover = requireElement(this.root, "[data-content-filter-popover]");
    this.contentSettingsButton = requireElement(this.root, "[data-content-settings]");
    this.contentViewButton = requireElement(this.root, "[data-content-view]");
    this.folderTree = requireElement(this.root, "[data-folder-tree]");
    this.outlinerList = requireElement(this.root, "[data-outliner-list]");
    this.outlinerSummary = requireElement(this.root, "[data-outliner-summary]");
    this.detailsBody = requireElement(this.root, "[data-details-body]");
    this.worldSettingsBody = requireElement(this.root, "[data-world-settings-body]");
    this.meshPaintBody = requireElement(this.root, "[data-mesh-paint-body]");
    this.foliageBody = requireElement(this.root, "[data-foliage-body]");
    this.statusText = requireElement(this.root, "[data-status]");
    this.contentStatus = this.statusText;
    this.undoButton = requireElement(this.root, '[data-action="undo"]');
    this.redoButton = requireElement(this.root, '[data-action="redo"]');
    const projectName = requireElement(this.root, "[data-project-name]");

    this.buildToolbar();
    this.bindActions();
    this.bindMainMenu();
    this.bindNumericInputSelection();
    this.renderDetails(null);
    this.renderWorldSettings(this.app.getWorldSettings());

    this.app.onSelectionChanged = (selection) => {
      this.selected = selection;
      this.detailsBaseline = null;
      this.renderDetails(selection);
      this.outlinerScrollTargetId = selection?.id ?? null;
    };
    this.app.onSceneObjectsChanged = (objects) => this.renderOutliner(objects);
    this.app.onHistoryChanged = (state) => this.renderHistory(state);
    this.app.onWorldSettingsChanged = (settings) => this.renderWorldSettings(settings);
    this.app.onFoliageChanged = () => {
      if (this.inspectorTab === "foliage") this.renderFoliage();
    };
    this.app.onMeshPaintChanged = () => {
      if (this.inspectorTab === "meshPaint") this.renderMeshPaint();
    };
    this.app.onPivotEditModeChanged = () => this.renderDetails(this.selected);
    this.app.onStatus = (message, tone) => this.setStatus(message, tone);

    this.renderOutliner(this.app.getSceneObjects());
    this.renderHistory(this.app.getHistoryState());
    void this.loadContent(projectName);
  }

  private buildToolbar(): void {
    const tools = requireElement(this.root, "[data-tools]");
    (["select", "move", "rotate", "scale"] as EditorTool[]).forEach((tool) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-button";
      button.innerHTML = TOOLBAR_ICONS[tool];
      button.dataset.tool = tool;
      button.setAttribute("aria-label", TOOL_LABELS[tool]);
      button.setAttribute("aria-pressed", String(tool === this.activeTool));
      if (tool === this.activeTool) button.classList.add("active");
      button.addEventListener("click", () => {
        this.setActiveTool(tool);
      });
      tools.append(button);
      this.toolButtons.set(tool, button);
    });

    const spaceButton = document.createElement("button");
    spaceButton.type = "button";
    spaceButton.className = "tool-button space-toggle";
    spaceButton.dataset.spaceToggle = "";
    tools.append(spaceButton);
    // Render the initial World/Local glyph and accessible label via the updater.
    this.updateSpaceButton(this.app.getTransformSpace());
    spaceButton.addEventListener("click", () => {
      this.updateSpaceButton(this.app.toggleTransformSpace());
    });
  }

  private bindNumericInputSelection(): void {
    const selectValue = (target: EventTarget | null): void => {
      if (!(target instanceof HTMLInputElement)) return;
      if (target.type !== "number" || target.disabled || target.readOnly) return;
      window.setTimeout(() => target.select(), 0);
    };

    document.addEventListener("focusin", (event) => selectValue(event.target));
    document.addEventListener("pointerup", (event) => {
      if (event.button !== 0) return;
      selectValue(event.target);
    });
  }

  private setActiveTool(tool: EditorTool): void {
    this.activeTool = tool;
    for (const [itemTool, item] of this.toolButtons) {
      const active = itemTool === tool;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    }
    this.app.setEditorTool(tool);
  }

  private updateSpaceButton(space: TransformSpace): void {
    const button = this.root.querySelector<HTMLButtonElement>("[data-space-toggle]");
    if (!button) return;
    const isLocal = space === "local";
    button.innerHTML = isLocal ? TOOLBAR_ICONS.local : TOOLBAR_ICONS.world;
    const label = isLocal ? "Local" : "World";
    button.setAttribute("aria-label", `${label} space`);
    button.classList.toggle("active", isLocal);
  }

  /**
   * Wires the Camera and View Mode hover menus. The runtime owns the actual
   * camera/shading state and reports it back through `onViewStateChanged`, so
   * both menu labels stay correct even when one preset drives the other (a Top
   * ortho view also flips shading to Wireframe).
   */
  private bindViewMenus(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-camera-view]").forEach((button) => {
      const view = button.dataset.cameraView as CameraView;
      button.addEventListener("click", () => this.app.setCameraView(view));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-view-mode]").forEach((button) => {
      const mode = button.dataset.viewMode as ViewMode;
      button.addEventListener("click", () => this.app.setViewMode(mode));
    });
    this.app.onViewStateChanged = (state) => this.updateViewState(state);
    this.updateViewState(this.app.getViewState());
  }

  private updateViewState(state: ViewportViewState): void {
    const cameraLabel = this.root.querySelector("[data-camera-label]");
    if (cameraLabel) cameraLabel.textContent = CAMERA_VIEW_LABELS[state.view];
    const viewModeLabel = this.root.querySelector("[data-viewmode-label]");
    if (viewModeLabel) viewModeLabel.textContent = VIEW_MODE_LABELS[state.mode];
    this.root.querySelectorAll<HTMLButtonElement>("[data-camera-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.cameraView === state.view);
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-view-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.viewMode === state.mode);
    });
  }

  private renderActorPatrolRouteSection(selection: EditableSelection): string {
    if (selection.kind !== "actor") return "";
    const route = this.app.getSelectedActorPatrolRoute();
    const source = route?.source ?? "targetPoints";
    const splines = this.app.getSplineReferences();
    const selectedSpline = route?.splineId ?? "";
    const splineOptions = [
      `<option value="" ${selectedSpline ? "" : "selected"}>— select spline —</option>`,
      ...splines.map(
        (spline) =>
          `<option value="${escapeHtml(spline.id)}" ${spline.id === selectedSpline ? "selected" : ""}>${escapeHtml(spline.name)} (${escapeHtml(spline.id)})</option>`,
      ),
      ...(selectedSpline && !splines.some((spline) => spline.id === selectedSpline)
        ? [`<option value="${escapeHtml(selectedSpline)}" selected>${escapeHtml(selectedSpline)} (missing)</option>`]
        : []),
    ].join("");
    const disabled = selection.locked ? "disabled" : "";
    return `
      <div class="detail-section">
        <div class="detail-section-title">AI Patrol Route <small>instance override</small></div>
        <label class="detail-row"><span>Source</span><select data-actor-patrol-source ${disabled}>
          <option value="targetPoints" ${source === "targetPoints" ? "selected" : ""}>Target Points</option>
          <option value="spline" ${source === "spline" ? "selected" : ""}>Generic Spline</option>
        </select></label>
        <label class="detail-row"><span>Spline</span><select data-actor-patrol-spline ${source === "spline" ? "" : "disabled"} ${disabled}>${splineOptions}</select></label>
        <label class="detail-row"><span>Entry</span><select data-actor-patrol-entry ${source === "spline" ? "" : "disabled"} ${disabled}>
          <option value="nearest" ${route?.entry !== "start" ? "selected" : ""}>Nearest Point</option>
          <option value="start" ${route?.entry === "start" ? "selected" : ""}>Spline Start</option>
        </select></label>
        <label class="detail-row"><span>Target Point Tag</span><input data-actor-patrol-target-tag type="text" value="${escapeHtml(route?.targetPointTag ?? "")}" placeholder="Any route" ${source === "targetPoints" ? "" : "disabled"} ${disabled} /></label>
        <label class="detail-row"><span>Speed</span><input data-actor-patrol-speed type="number" step="0.1" min="0" value="${route?.speed ?? 2.4}" ${disabled} /></label>
        <label class="detail-row"><span>Acceptance</span><input data-actor-patrol-acceptance type="number" step="0.05" min="0" value="${route?.acceptanceRadius ?? 0.55}" ${disabled} /></label>
        <label class="detail-row"><span>Look Ahead</span><input data-actor-patrol-lookahead type="number" step="0.1" min="0.1" value="${route?.lookAheadDistance ?? 1.2}" ${source === "spline" ? "" : "disabled"} ${disabled} /></label>
        <label class="detail-row"><span>Wrap</span><select data-actor-patrol-wrap ${source === "spline" ? "" : "disabled"} ${disabled}>
          <option value="loop" ${route?.wrapMode !== "pingPong" && route?.wrapMode !== "clamp" ? "selected" : ""}>Loop</option>
          <option value="pingPong" ${route?.wrapMode === "pingPong" ? "selected" : ""}>Ping-Pong</option>
          <option value="clamp" ${route?.wrapMode === "clamp" ? "selected" : ""}>Clamp</option>
        </select></label>
      </div>`;
  }

  private bindActorPatrolRouteInputs(selection: EditableSelection): void {
    if (selection.kind !== "actor" || selection.locked) return;
    const source = this.detailsBody.querySelector<HTMLSelectElement>("[data-actor-patrol-source]");
    const spline = this.detailsBody.querySelector<HTMLSelectElement>("[data-actor-patrol-spline]");
    const entry = this.detailsBody.querySelector<HTMLSelectElement>("[data-actor-patrol-entry]");
    const speed = this.detailsBody.querySelector<HTMLInputElement>("[data-actor-patrol-speed]");
    const acceptance = this.detailsBody.querySelector<HTMLInputElement>("[data-actor-patrol-acceptance]");
    const lookAhead = this.detailsBody.querySelector<HTMLInputElement>("[data-actor-patrol-lookahead]");
    const targetTag = this.detailsBody.querySelector<HTMLInputElement>("[data-actor-patrol-target-tag]");
    const wrap = this.detailsBody.querySelector<HTMLSelectElement>("[data-actor-patrol-wrap]");
    const commit = (): void => {
      const sourceValue = source?.value === "spline" ? "spline" : "targetPoints";
      const next: AiPatrolRoute = {
        source: sourceValue,
        entry: entry?.value === "start" ? "start" : "nearest",
        speed: Math.max(0, Number(speed?.value) || 0),
        acceptanceRadius: Math.max(0, Number(acceptance?.value) || 0),
        lookAheadDistance: Math.max(0.1, Number(lookAhead?.value) || 1.2),
        wrapMode: wrap?.value === "pingPong" || wrap?.value === "clamp" ? wrap.value : "loop",
      };
      if (sourceValue === "spline" && spline?.value) next.splineId = spline.value;
      if (sourceValue === "targetPoints" && targetTag?.value.trim()) next.targetPointTag = targetTag.value.trim();
      this.app.setSelectedActorPatrolRoute(next);
      this.renderDetails(this.selected);
    };
    source?.addEventListener("change", commit);
    spline?.addEventListener("change", commit);
    entry?.addEventListener("change", commit);
    speed?.addEventListener("change", commit);
    acceptance?.addEventListener("change", commit);
    lookAhead?.addEventListener("change", commit);
    targetTag?.addEventListener("change", commit);
    wrap?.addEventListener("change", commit);
  }

  /**
   * Shows or hides the `#debug-stats` perf overlay (FPS / draw calls / …).
   * The overlay is a plain HTML element the runtime writes to via `onFrame`;
   * we attach that writer lazily on first show so an editor session that never
   * opens the overlay pays nothing for it. Hiding leaves the writer attached but
   * `attachDebugStats` short-circuits while the element is not displayed.
   */
  private setStatsVisible(on: boolean): void {
    const element = document.getElementById("debug-stats");
    if (!element) return;
    if (on && !this.statsAttached) {
      attachDebugStats(this.app, element);
      this.statsAttached = true;
    }
    element.hidden = !on;
    this.statsVisible = on;
  }

  /**
   * Wires one Show-flag toggle button: reflects the current runtime state as the
   * green `active` style and flips it on click (mirrors the Camera / View Mode
   * option buttons, so all three topbar menus behave identically).
   */
  private bindShowFlag(
    flag: string,
    get: () => boolean,
    set: (on: boolean) => void,
  ): void {
    const button = this.root.querySelector<HTMLButtonElement>(
      `[data-show-flag="${flag}"]`,
    );
    if (!button) return;
    button.classList.toggle("active", get());
    button.addEventListener("click", () => {
      const next = !get();
      set(next);
      button.classList.toggle("active", next);
    });
  }

  /**
   * Closes every other topbar hover menu the instant the pointer enters one of
   * them. The popovers keep a short CSS grace delay before closing on leave, so
   * sliding between adjacent triggers could briefly show two overlapping menus;
   * force-closing the siblings on enter removes that flicker without touching the
   * gentle close-on-leave behaviour.
   */
  private bindMenuHoverIntent(): void {
    const menus = Array.from(
      this.root.querySelectorAll<HTMLElement>(".add-actor-menu, .topbar-menu"),
    );
    menus.forEach((menu) => {
      menu.addEventListener("pointerenter", () => {
        menus.forEach((other) => other.classList.toggle("force-closed", other !== menu));
      });
    });
  }

  private bindActions(): void {
    // The Add Actor button, its category labels, and the Show button are
    // hover-only triggers: they reveal their flyout on hover and must not react
    // to clicks. Suppressing the mousedown default keeps them from taking focus
    // (no focus ring, and — paired with the CSS dropping :focus-within — no click
    // ever pins the menu open).
    this.root
      .querySelectorAll<HTMLButtonElement>(
        "[data-add-actor-button], .add-actor-category-label, [data-show-button], [data-camera-button], [data-viewmode-button]",
      )
      .forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
      });

    this.root.querySelector('[data-action="undo"]')?.addEventListener("click", () => {
      this.app.undo();
    });
    this.root.querySelector('[data-action="redo"]')?.addEventListener("click", () => {
      this.app.redo();
    });
    this.root.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
      this.app.deleteSelected();
    });
    this.root.querySelector('[data-action="play"]')?.addEventListener("click", () => {
      void this.playTest();
    });
    // Show flags are toggle buttons (active = green) matching the Camera / View
    // Mode option menus, rather than checkboxes.
    this.bindShowFlag("collision", () => this.app.getShowCollision(), (on) =>
      this.app.setShowCollision(on),
    );
    this.bindShowFlag("ai-navigation", () => this.app.getShowAiNavigation(), (on) =>
      this.app.setShowAiNavigation(on),
    );
    // The perf overlay (FPS / draw calls / …) is a DOM element, not a runtime
    // flag, so its get/set drive visibility of #debug-stats. Default on when the
    // URL carried ?debug, preserving that launch flag's meaning.
    this.setStatsVisible(new URLSearchParams(location.search).has("debug"));
    this.bindShowFlag("stats", () => this.statsVisible, (on) => this.setStatsVisible(on));
    this.root.querySelector('[data-action="save"]')?.addEventListener("click", () => {
      void this.save();
    });

    this.bindViewMenus();
    this.bindMenuHoverIntent();

    this.bindAddActorMenu();

    this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.inspectorTab;
        if (tab === "details" || tab === "meshPaint" || tab === "foliage") {
          this.setInspectorTab(tab);
        }
      });
    });

    this.updateSpaceButton(this.app.getTransformSpace());

    this.contentToggle.addEventListener("click", () => {
      this.setContentDrawerOpen(!this.contentDrawerOpen);
    });

    this.root.querySelector<HTMLButtonElement>("[data-content-add]")?.addEventListener("click", (event) => {
      this.openContentAddMenu(event, this.selectedFolder);
    });
    this.root.querySelector<HTMLButtonElement>("[data-content-import]")?.addEventListener("click", () => {
      this.startImport(this.selectedFolder);
    });
    this.root.querySelector<HTMLButtonElement>("[data-content-save-all]")?.addEventListener("click", () => {
      void this.save();
    });
    this.contentBackButton.addEventListener("click", () => this.navigateContentHistory(-1));
    this.contentForwardButton.addEventListener("click", () => this.navigateContentHistory(1));
    this.contentFilterButton.addEventListener("click", () => {
      this.setContentFilterPopoverOpen(this.contentFilterPopover.hidden);
    });
    this.contentSettingsButton.addEventListener("click", (event) => this.openContentSettingsMenu(event));
    this.contentViewButton.addEventListener("click", () => this.cycleContentViewSize());

    // Auto-close on an outside click when the drawer is unlocked. Uses capture +
    // pointerdown so it beats the viewport's own pointer handling; clicks inside
    // the drawer or on the footer toggle (which owns open/close) are ignored.
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.contentDrawerOpen) return;
        const target = event.target as Node | null;
        if (!target) return;
        // Editor context menus are appended to <body>, so a click on the gear
        // settings menu (or any menu spawned from a drawer control) is outside
        // the drawer DOM. It is still part of the drawer's own UI, so it must
        // not count as an outside click — otherwise "Lock Drawer Open" would
        // auto-close the drawer before its handler even runs.
        if (this.contextMenu?.contains(target)) return;
        if (
          !this.contentFilterPopover.hidden &&
          !this.contentFilterPopover.contains(target) &&
          !this.contentFilterButton.contains(target)
        ) {
          this.setContentFilterPopoverOpen(false);
        }
        if (this.contentDrawerLocked) return;
        if (this.contentDrawer.contains(target)) return;
        if (this.contentToggle.contains(target)) return;
        this.setContentDrawerOpen(false);
      },
      true,
    );

    // Right-click empty asset-grid space -> create content in the current folder.
    // (Right-clicking a card stops propagation and shows the asset menu instead.)
    this.contentList.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openContentContextMenu(event, this.selectedFolder);
    });

    // Click empty asset-grid space -> clear the current asset selection.
    this.contentList.addEventListener("click", (event) => {
      if (event.target === this.contentList) this.clearContentSelection();
    });

    this.contentSearch.addEventListener("input", () => {
      this.contentQuery = this.contentSearch.value.trim().toLocaleLowerCase();
      this.renderContentAssets();
    });

    this.contentTypeFilter.addEventListener("change", () => {
      const value = this.contentTypeFilter.value;
      this.contentType = isContentTypeFilter(value) ? value : CONTENT_FILTER_ALL;
      this.syncContentFilterButton();
      this.setContentFilterPopoverOpen(false);
      this.renderContentAssets();
    });

    this.contentDevelopmentToggle.addEventListener("change", () => {
      this.setDevelopmentContentVisible(this.contentDevelopmentToggle.checked);
    });

    this.root.querySelectorAll<HTMLSelectElement>("[data-snap]").forEach((select) => {
      select.addEventListener("change", () => {
        const value = Number(select.value);
        if (!Number.isFinite(value)) return;
        if (select.dataset.snap === "move") this.app.setSnapSettings({ move: value });
        if (select.dataset.snap === "rotate") this.app.setSnapSettings({ rotate: value });
        if (select.dataset.snap === "scale") this.app.setSnapSettings({ scale: value });
      });
    });

    this.root.querySelectorAll<HTMLInputElement>("[data-snap-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.dataset.snapToggle === "move") {
          this.app.setSnapSettings({ moveEnabled: input.checked });
        }
        if (input.dataset.snapToggle === "rotate") {
          this.app.setSnapSettings({ rotateEnabled: input.checked });
        }
        if (input.dataset.snapToggle === "scale") {
          this.app.setSnapSettings({ scaleEnabled: input.checked });
        }
      });
    });

    this.root.querySelector<HTMLInputElement>("[data-outliner-search]")?.addEventListener(
      "input",
      (event) => {
        const input = event.currentTarget as HTMLInputElement;
        this.outlinerFilter = input.value.trim().toLocaleLowerCase();
        this.renderOutliner(this.outlinerObjects);
      },
    );

    const outlinerFilterButton = this.root.querySelector<HTMLButtonElement>("[data-outliner-filter-button]");
    const outlinerFilterPopover = this.root.querySelector<HTMLElement>("[data-outliner-filter-popover]");
    const setOutlinerFilterPopoverOpen = (open: boolean): void => {
      if (!outlinerFilterButton || !outlinerFilterPopover) return;
      outlinerFilterPopover.hidden = !open;
      outlinerFilterButton.setAttribute("aria-expanded", String(open));
    };
    outlinerFilterButton?.addEventListener("click", () => {
      setOutlinerFilterPopoverOpen(outlinerFilterPopover?.hidden ?? false);
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-outliner-type-filter]").forEach((input) => {
      input.addEventListener("change", () => {
        const type = input.dataset.outlinerTypeFilter as OutlinerFilterType | undefined;
        if (!type || !OUTLINER_FILTER_TYPES.some((entry) => entry.type === type)) return;
        if (input.checked) this.outlinerVisibleTypes.add(type);
        else this.outlinerVisibleTypes.delete(type);
        outlinerFilterButton?.classList.toggle(
          "is-filtered",
          this.outlinerVisibleTypes.size !== OUTLINER_FILTER_TYPES.length,
        );
        this.renderOutliner(this.outlinerObjects);
      });
    });
    window.addEventListener("pointerdown", (event) => {
      if (!outlinerFilterPopover || outlinerFilterPopover.hidden) return;
      if (!this.root.contains(event.target as Node)) return;
      if (!(event.target as HTMLElement).closest("[data-outliner-filter-button], [data-outliner-filter-popover]")) {
        setOutlinerFilterPopoverOpen(false);
      }
    });

    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.app.isCameraNavigating()) return;
    if (event.metaKey || event.altKey || isEditableTarget(event.target)) return;

    if (event.ctrlKey) {
      if (event.code === "KeyZ" && !event.shiftKey) {
        event.preventDefault();
        this.app.undo();
      } else if (event.code === "KeyY" || (event.code === "KeyZ" && event.shiftKey)) {
        event.preventDefault();
        this.app.redo();
      } else if (event.code === "KeyS") {
        event.preventDefault();
        void this.save();
      } else if (event.code === "KeyD") {
        event.preventDefault();
        this.app.duplicateSelected();
      } else if (event.code === "KeyG") {
        event.preventDefault();
        this.app.groupSelected();
      } else if (event.code === "KeyA") {
        event.preventDefault();
        this.app.selectAllObjects();
      } else if (event.code === "KeyB") {
        event.preventDefault();
        void this.browseToSelectedAsset();
      } else if (event.code === "KeyE") {
        event.preventDefault();
        this.openSelectedAssetEditor();
      }
      return;
    }

    // Foliage Mode owns Escape/Delete for its instance selection (which is separate
    // from the scene selection); let every other shortcut fall through.
    if (this.app.isFoliageModeActive()) {
      if (event.code === "Escape") {
        event.preventDefault();
        this.app.deselectAllFoliage();
        return;
      }
      if (event.code === "Delete" || event.code === "Backspace") {
        event.preventDefault();
        this.app.removeSelectedFoliage();
        return;
      }
    }

    if (event.code === "Escape") {
      event.preventDefault();
      this.app.clearSelection();
    } else if (event.code === "KeyQ") {
      event.preventDefault();
      this.setActiveTool("select");
    } else if (event.code === "KeyW") {
      event.preventDefault();
      this.setActiveTool("move");
    } else if (event.code === "KeyE") {
      event.preventDefault();
      this.setActiveTool("rotate");
    } else if (event.code === "KeyR") {
      event.preventDefault();
      this.setActiveTool("scale");
    } else if (event.code === "Space") {
      event.preventDefault();
      this.setActiveTool(nextTransformTool(this.activeTool));
    } else if (event.code === "Delete") {
      event.preventDefault();
      this.app.deleteSelected();
    } else if (event.code === "KeyF") {
      event.preventDefault();
      this.app.focusSelected();
    } else if (event.code === "Digit1") {
      event.preventDefault();
      this.app.setCameraView("top");
    } else if (event.code === "Digit2") {
      event.preventDefault();
      this.app.setCameraView("front");
    } else if (event.code === "Digit3") {
      event.preventDefault();
      this.app.setCameraView("left");
    } else if (event.code === "Digit4") {
      event.preventDefault();
      this.app.setCameraView("perspective");
    } else if (event.code === "KeyH" && event.shiftKey) {
      event.preventDefault();
      this.app.showHiddenObjects();
    } else if (event.code === "KeyH") {
      event.preventDefault();
      this.app.hideSelected();
    } else if (event.code === "KeyX") {
      event.preventDefault();
      this.updateSpaceButton(this.app.toggleTransformSpace());
    } else if (event.code === "KeyP") {
      event.preventDefault();
      void this.playTest();
    } else if (event.code === "End") {
      event.preventDefault();
      this.app.snapSelected();
    }
  }

  /**
   * Play/Test: saves the layout, then opens the game in a new tab. Single
   * codebase â€” the game is this same app's default route (`/`), so Play just
   * opens it; a project may still override with an external `editor.previewUrl`.
   */
  private async playTest(): Promise<void> {
    try {
      await this.app.saveLayout();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    // Hand the current viewport camera pose to the runtime (default camera mode
    // starts there). Temporary session override — not written to the layout.
    writePlayCameraPose(this.app.getPlayCameraPose());
    const previewUrl = this.projectInfo?.manifest.editor.previewUrl ?? "/";
    const opened = window.open(previewUrl, "_blank", "noopener");
    if (opened) {
      this.setStatus(`Saved. Opening game: ${previewUrl}`, "success");
    } else {
      this.setStatus(`Saved. Popup blocked — open ${previewUrl} manually.`, "warning");
    }
  }

  private async loadContent(projectName: HTMLElement): Promise<void> {
    try {
      const [projectInfo, assets] = await Promise.all([
        this.app.getEditorProjectInfo(),
        this.app.getEditableAssets(),
      ]);
      this.syncSnapControls(this.app.getSnapSettings());
      this.projectInfo = projectInfo;
      this.favoriteContentFolders = this.readFavoriteContentFolders();
      this.metadataSchema = this.app.getMetadataSchema();
      this.editableAssets = assets;
      this.selectedFolder = this.readLastContentFolder() ?? normalizeProjectPath(projectInfo.assetRoot);
      projectName.textContent = formatActiveLevelName(projectInfo.manifest.editor.defaultScene);
      projectName.title = `Active level: ${projectInfo.manifest.editor.defaultScene}`;
      this.contentRootLabel.textContent = this.selectedFolder;
      await this.refreshAssetTree({ quiet: true });
      this.resetContentNavigationHistory(this.selectedFolder);
    } catch (error) {
      this.contentStatus.textContent = error instanceof Error ? error.message : String(error);
      this.setStatus(this.contentStatus.textContent, "error");
    }
  }

  /** Toggles the drawer's open DOM state + the periodic refresh interval (no immediate fetch). */
  private applyContentDrawerState(open: boolean): void {
    this.contentDrawerOpen = open;
    this.contentDrawer.classList.toggle("open", open);
    this.root.classList.toggle("content-drawer-open", open);
    this.contentDrawer.setAttribute("aria-hidden", String(!open));
    this.contentToggle.classList.toggle("active", open);
    this.contentToggle.setAttribute("aria-expanded", String(open));

    if (!open) this.setContentFilterPopoverOpen(false);
    window.clearInterval(this.contentRefreshTimer);
    this.contentRefreshTimer = 0;
    if (open) {
      this.contentRefreshTimer = window.setInterval(() => {
        void this.refreshAssetTree({ quiet: true });
      }, 7000);
    }
  }

  private setContentDrawerOpen(open: boolean): void {
    this.applyContentDrawerState(open);
    if (open) void this.refreshAssetTree({ quiet: true });
  }

  private setContentDrawerTall(tall: boolean): void {
    this.contentDrawerTall = tall;
    this.contentDrawer.classList.toggle("is-tall", tall);
    this.root.classList.toggle("content-drawer-tall", tall);
  }

  private setContentFilterPopoverOpen(open: boolean): void {
    this.contentFilterPopover.hidden = !open;
    this.contentFilterButton.setAttribute("aria-expanded", String(open));
  }

  private syncContentFilterButton(): void {
    this.contentFilterButton.classList.toggle("is-filtered", this.contentType !== CONTENT_FILTER_ALL);
  }

  /**
   * Ends the viewport ghost preview when an asset drag finishes. A drag starts
   * inside the drawer (so the outside-click handler never fires for it), so the
   * drop is where we honor the auto-close: close the drawer unless it is locked.
   */
  private handleAssetDragEnd(): void {
    this.app.endAssetDragPreview();
    if (this.contentDrawerOpen && !this.contentDrawerLocked) {
      this.setContentDrawerOpen(false);
    }
  }

  private setContentDrawerLocked(locked: boolean): void {
    this.contentDrawerLocked = locked;
  }

  private openContentSettingsMenu(event: MouseEvent): void {
    this.openContextMenu(event, [
      {
        label: this.showDevelopmentContent ? "Hide Development Content" : "Show Development Content",
        run: () => this.setDevelopmentContentVisible(!this.showDevelopmentContent),
      },
      {
        label: this.contentDrawerLocked ? "Unlock Drawer" : "Lock Drawer Open",
        run: () => this.setContentDrawerLocked(!this.contentDrawerLocked),
      },
      {
        label: this.contentDrawerTall ? "Use Short Height" : "Use Tall Height",
        run: () => this.setContentDrawerTall(!this.contentDrawerTall),
      },
      { separator: true },
      { label: "Refresh", run: () => void this.refreshAssetTree() },
    ]);
  }

  private cycleContentViewSize(): void {
    const sizes: Array<typeof this.contentViewSize> = ["small", "medium", "large"];
    const next = sizes[(sizes.indexOf(this.contentViewSize) + 1) % sizes.length] ?? "medium";
    this.contentViewSize = next;
    this.contentDrawer.dataset.contentView = next;
    this.contentViewButton.title = `Thumbnail size: ${next.slice(0, 1).toUpperCase()}${next.slice(1)}`;
    this.setStatus(`Content thumbnail size: ${next}.`, "info");
  }

  private setDevelopmentContentVisible(visible: boolean): void {
    this.showDevelopmentContent = visible;
    this.contentDevelopmentToggle.checked = visible;
    this.ensureVisibleSelectedFolder();
    this.renderFolderTree();
    this.renderContentFilters();
    this.renderContentAssets();
  }

  /**
   * The Content Browser file path backing the current selection, or null when
   * the selection has no source file (special actors, built-in primitives).
   * Actor Script / Character instances carry their class file path (`classRef`)
   * as `assetId`, so they resolve directly; other instances map their manifest
   * `assetId` to the registered asset path.
   */
  private selectedAssetContentPath(): string | null {
    const selection = this.selected;
    if (!selection) return null;
    if (selection.kind === "actor") return normalizeProjectPath(selection.assetId);
    const asset = this.editableAssets.find((entry) => entry.id === selection.assetId);
    return asset ? normalizeProjectPath(assetPath(asset)) : null;
  }

  /**
   * Ctrl+B "Browse To" (Unreal parity): reveals the selected object's source
   * asset in the Content Browser — opens the drawer, navigates to its folder,
   * and highlights the card. Special actors (lights, fog, sky…) and built-in
   * primitives have no content-file asset, so this reports a hint instead.
   */
  private async browseToSelectedAsset(): Promise<void> {
    const path = this.selectedAssetContentPath();
    if (!path) {
      this.setStatus(
        "Browse To: select a placed asset that maps to a Content Browser file.",
        "warning",
      );
      return;
    }
    await this.revealContentAsset(path);
  }

  /**
   * Ctrl+E "Edit" (Unreal parity): opens the asset editor for the selected
   * object's source asset — e.g. a placed static mesh opens the Static Mesh
   * editor, an Actor Script / Character instance opens the Actor Script editor.
   * Assets with no dedicated editor (or non-asset selections) report a hint.
   */
  private openSelectedAssetEditor(): void {
    const path = this.selectedAssetContentPath();
    if (!path) {
      this.setStatus("Edit: select a placed asset to open its editor.", "warning");
      return;
    }
    const item = this.browserAssetItemForPath(path);
    const open = this.assetEditorOpener(item);
    if (!open) {
      this.setStatus(`No dedicated editor for ${item.label}.`, "warning");
      return;
    }
    open();
  }

  /** Builds a Content Browser item from a public-root-relative asset path (for editor lookup). */
  private browserAssetItemForPath(path: string): BrowserAssetItem {
    const normalized = normalizeProjectPath(path);
    const editable = this.editableAssetByProjectPath().get(normalized);
    const fileName = normalized.split("/").pop() ?? normalized;
    const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : "file";
    const base = {
      key: normalized,
      label: editable?.displayName ?? fileName,
      category: editable?.catalogCategory ?? ext,
      path: normalized,
      ext,
      type: editable ? assetType(editable) : (inferAssetTypeFromPath(normalized) ?? "file"),
    } satisfies Omit<BrowserAssetItem, "editable">;
    return editable ? { ...base, editable } : base;
  }

  /**
   * Reveals an asset in the Content Browser (Toolbar â†’ Browse from an open
   * editor): opens the drawer, navigates to the asset's folder (expanding
   * ancestors and clearing any type/search filter that would hide it), then
   * selects + briefly flashes the card. Best-effort â€” a missing folder falls
   * back to the asset root. Uses a single authoritative refresh so the flash is
   * never clobbered by a concurrent reload.
   */
  async revealContentAsset(path: string): Promise<void> {
    this.applyContentDrawerState(true);
    await this.refreshAssetTree({ quiet: true });
    if (!this.assetTreeRoot) {
      this.setStatus(`In Content Browser: ${path}`);
      return;
    }
    const normalized = normalizeProjectPath(path);
    if (isDevelopmentContentPath(normalized)) {
      this.showDevelopmentContent = true;
      this.contentDevelopmentToggle.checked = true;
    }
    const root = this.assetTreeRoot.path;
    const parentDir = normalized.includes("/")
      ? normalized.slice(0, normalized.lastIndexOf("/"))
      : root;
    // Pick the folder that holds the asset; fall back to the asset root.
    const folder =
      parentDir === root || findProjectDir(this.assetTreeRoot.children ?? [], parentDir)
        ? parentDir
        : root;
    this.setSelectedContentFolderPath(folder);
    // Expand every ancestor so the folder is visible in the tree.
    const segments = folder.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      this.collapsedFolderPaths.delete(segments.slice(0, i).join("/"));
    }
    // Clear any filter/search that would hide the target card.
    this.contentType = CONTENT_FILTER_ALL;
    this.contentTypeFilter.value = CONTENT_FILTER_ALL;
    this.contentQuery = "";
    this.contentSearch.value = "";
    this.renderFolderTree();
    this.renderContentFilters();
    this.renderContentAssets();
    this.flashContentCard(path);
  }

  /** Selects + briefly highlights the Content Browser card for `path`, scrolling it into view. */
  private flashContentCard(path: string): void {
    const card = this.contentList.querySelector<HTMLElement>(
      `.asset-card[data-asset-path="${CSS.escape(path)}"]`,
    );
    if (!card) {
      this.setStatus(`In Content Browser: ${path}`);
      return;
    }
    if (card.dataset.assetId) this.setSelectedAsset(card.dataset.assetId);
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card.classList.add("is-revealed");
    window.setTimeout(() => card.classList.remove("is-revealed"), 1600);
    this.setStatus(`Revealed in Content Browser: ${path}`, "info");
  }

  private async refreshAssetTree(options: { quiet?: boolean } = {}): Promise<void> {
    if (!this.projectInfo) return;
    try {
      const assetRoot = normalizeProjectPath(this.projectInfo.assetRoot);
      if (!options.quiet) this.contentStatus.textContent = "Refreshing assets";
      const tree = await fetchProjectDir(assetRoot);
      const rootName = tree.root.split("/").at(-1) ?? "assets";
      this.assetTreeRoot = {
        name: rootName,
        path: tree.root,
        type: "dir",
        children: tree.children,
      };
      if (!this.selectedFolder) this.selectedFolder = tree.root;
      if (this.selectedFolder !== tree.root && !findProjectDir(tree.children, this.selectedFolder)) {
        this.selectedFolder = tree.root;
      }
      this.ensureVisibleSelectedFolder();
      this.saveLastContentFolder();
      this.contentRootLabel.textContent = `${this.projectInfo.rootName} / ${tree.root}`;
      this.contentStatus.textContent = `${this.visibleProjectFiles().length} files`;
      this.renderFolderTree();
      this.renderContentFilters();
      this.renderContentAssets();
      void this.refreshProjectActorClasses();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.contentStatus.textContent = message;
      if (!options.quiet) this.setStatus(message, "error");
    }
  }

  /**
   * Scans the project's `*.actor.json` files and caches each class's name +
   * parent class, then derives the editor pickers that depend on it: the World
   * Settings Game Mode dropdown ({@link projectGameModes}) and (on demand) the
   * Game Mode "Default Pawn Class" picker. Re-renders the World Settings panel
   * when the discovered Game Mode set changed.
   */
  private async refreshProjectActorClasses(): Promise<void> {
    if (!this.assetTreeRoot) return;
    const actorPaths = flattenProjectFiles([this.assetTreeRoot])
      .filter((file) => file.path.endsWith(".actor.json"))
      .map((file) => normalizeProjectPath(file.path));
    this.projectActorClasses = await Promise.all(
      actorPaths.map(async (path) => {
        const def = await loadActorScript(path, path);
        return { path, name: def.name || path, parentClass: def.parentClass };
      }),
    );

    const next: EditorGameModeOption[] = this.projectActorClasses
      .filter((cls) => cls.parentClass === "gameMode")
      .map((cls) => ({
        id: cls.path,
        displayName: cls.name,
        description: "Project Game Mode (Actor Script).",
      }));
    const changed =
      next.length !== this.projectGameModes.length ||
      next.some((option, index) => {
        const prev = this.projectGameModes[index];
        return !prev || prev.id !== option.id || prev.displayName !== option.displayName;
      });
    if (!changed) return;
    this.projectGameModes = next;
    this.renderWorldSettings(this.worldSettings ?? this.app.getWorldSettings());
  }

  private renderFolderTree(): void {
    if (!this.assetTreeRoot) {
      this.folderTree.innerHTML = `<div class="empty-details">No asset folders</div>`;
      return;
    }
    this.ensureVisibleSelectedFolder();
    const nodes: Node[] = [];
    const favorites = [...this.favoriteContentFolders]
      .filter((path) => path !== this.assetTreeRoot?.path)
      .map((path) => findProjectDir(this.assetTreeRoot?.children ?? [], path))
      .filter((node): node is ProjectDirNode => Boolean(node && this.shouldShowContentPath(node.path)));
    if (favorites.length > 0) {
      const heading = document.createElement("div");
      heading.className = "folder-section-heading";
      heading.innerHTML = `${UI_ICONS.star}<span>Favorites</span>`;
      nodes.push(heading);
      for (const folder of favorites) nodes.push(this.createFavoriteFolderRow(folder));
    }
    nodes.push(this.createFolderRow(this.assetTreeRoot, 0));
    this.folderTree.replaceChildren(...nodes);
  }

  private createFavoriteFolderRow(folder: ProjectDirNode): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-row folder-row-favorite";
    button.classList.toggle("active", folder.path === this.selectedFolder);
    button.title = folder.path;
    button.innerHTML = `<span class="folder-caret"></span><span class="folder-row-icon" aria-hidden="true"></span><span class="folder-name">${escapeHtml(folder.name)}</span>`;
    button.addEventListener("click", () => this.navigateToContentFolder(folder.path));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openContentFolderContextMenu(event, this.toBrowserFolderItem(folder));
    });
    return button;
  }

  private createFolderRow(node: ProjectDirNode, depth: number): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "folder-node";
    const childDirs =
      node.children?.filter((child) => child.type === "dir" && this.shouldShowContentPath(child.path)) ??
      [];
    const hasChildDirs = childDirs.length > 0;
    const isCollapsed = hasChildDirs && this.collapsedFolderPaths.has(node.path);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-row";
    button.classList.toggle("has-children", hasChildDirs);
    button.style.setProperty("--depth", String(depth));
    button.classList.toggle("active", node.path === this.selectedFolder);
    button.title = node.path;
    if (hasChildDirs) button.setAttribute("aria-expanded", String(!isCollapsed));
    button.innerHTML = `
      <span class="folder-caret">${hasChildDirs ? (isCollapsed ? ">" : "v") : ""}</span>
      <span class="folder-row-icon" aria-hidden="true"></span>
      <span class="folder-name">${escapeHtml(node.name)}</span>
    `;
    button.addEventListener("click", () => {
      this.setSelectedContentFolderPath(node.path);
      if (hasChildDirs) {
        if (isCollapsed) {
          this.collapsedFolderPaths.delete(node.path);
        } else {
          this.collapsedFolderPaths.add(node.path);
        }
      }
      this.renderFolderTree();
      this.renderContentAssets();
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (node === this.assetTreeRoot) {
        this.openContentContextMenu(event, node.path);
      } else {
        this.openContentFolderContextMenu(event, this.toBrowserFolderItem(node));
      }
    });
    wrapper.append(button);

    if (!isCollapsed) {
      for (const child of childDirs) {
        wrapper.append(this.createFolderRow(child, depth + 1));
      }
    }
    return wrapper;
  }

  private renderContentAssets(): void {
    if (!this.assetTreeRoot || !this.projectInfo) {
      renderContentAssetsPanel({
        contentList: this.contentList,
        contentPathLabel: this.contentPathLabel,
        contentItemCount: this.contentItemCount,
        projectLoaded: false,
        rootPath: null,
        selectedFolder: this.selectedFolder,
        folders: [],
        assets: [],
        fileCount: 0,
        missingManifestAssetCount: 0,
        selectedAssetId: this.selectedAssetId,
        selectedContentFolderPath: this.selectedContentFolderPath,
        cutContentPath: this.contentClipboard?.operation === "move" ? this.contentClipboard.path : null,
        isActiveLevel: (item) => this.isActiveLevel(item),
        getEmptyDragImage: () => this.getEmptyDragImage(),
        setSelectedAsset: (assetId) => this.setSelectedAsset(assetId),
        setSelectedContentFolder: (path) => this.setSelectedContentFolder(path),
        navigateToContentFolder: (path) => this.navigateToContentFolder(path),
        openAssetContextMenu: (event, item) => this.openAssetContextMenu(event, item),
        openContentFolderContextMenu: (event, item) =>
          this.openContentFolderContextMenu(event, item),
        openMeshEditor: (item) => this.openMeshEditor(item),
        openActorScriptEditor: (item) => this.openActorScriptEditor(item),
        openMaterialEditor: (item) => this.openMaterialEditor(item),
        openSoundCueEditor: (item) => this.openSoundCueEditor(item),
        openParticleEffectEditor: (item) => this.openParticleEffectEditor(item),
        openDialogueEditor: (item) => this.openDialogueEditor(item),
        openBehaviorTreeEditor: (item) => this.openBehaviorTreeEditor(item),
        openStateTreeEditor: (item) => this.openStateTreeEditor(item),
        openLevel: (item) => this.openLevel(item),
        openUiWidgetEditor: (item) => this.openUiWidgetEditor(item),
        renderAssetThumbnail: (item, thumb) => this.renderAssetThumbnail(item, thumb),
        renderMaterialThumbnail: (item, thumb) => this.renderMaterialThumbnail(item, thumb),
        renderTextureThumbnail: (item, thumb) => this.renderTextureThumbnail(item, thumb),
        beginAssetDragPreview: (assetId) => this.app.beginAssetDragPreview(assetId),
        endAssetDragPreview: () => this.handleAssetDragEnd(),
        setStatus: (message, tone) => this.setStatus(message, tone),
      });
      return;
    }

    const selected =
      this.selectedFolder === this.assetTreeRoot.path
        ? this.assetTreeRoot
        : findProjectDir(this.assetTreeRoot.children ?? [], this.selectedFolder);
    const children = selected?.children ?? [];
    const folders = children
      .filter((child) => child.type === "dir" && this.shouldShowContentPath(child.path))
      .map((folder) => this.toBrowserFolderItem(folder))
      .filter((item) => contentItemMatchesQuery(item, this.contentQuery));
    const files = children.filter((child) => child.type === "file");
    const assets = files
      .filter((file) => this.shouldDisplayAssetFile(file))
      .map((file) => this.toBrowserAssetItem(file))
      .filter((item) => this.contentType === CONTENT_FILTER_ALL || item.type === this.contentType)
      .filter((item) => contentItemMatchesQuery(item, this.contentQuery));
    renderContentAssetsPanel({
      contentList: this.contentList,
      contentPathLabel: this.contentPathLabel,
      contentItemCount: this.contentItemCount,
      projectLoaded: true,
      rootPath: this.assetTreeRoot.path,
      selectedFolder: this.selectedFolder,
      folders,
      assets,
      fileCount: files.length,
      missingManifestAssetCount: this.countMissingManifestAssetFiles(),
      selectedAssetId: this.selectedAssetId,
      selectedContentFolderPath: this.selectedContentFolderPath,
      cutContentPath: this.contentClipboard?.operation === "move" ? this.contentClipboard.path : null,
      isActiveLevel: (item) => this.isActiveLevel(item),
      getEmptyDragImage: () => this.getEmptyDragImage(),
      setSelectedAsset: (assetId) => this.setSelectedAsset(assetId),
      setSelectedContentFolder: (path) => this.setSelectedContentFolder(path),
      navigateToContentFolder: (path) => this.navigateToContentFolder(path),
      openAssetContextMenu: (event, item) => this.openAssetContextMenu(event, item),
      openContentFolderContextMenu: (event, item) => this.openContentFolderContextMenu(event, item),
      openMeshEditor: (item) => this.openMeshEditor(item),
      openActorScriptEditor: (item) => this.openActorScriptEditor(item),
      openMaterialEditor: (item) => this.openMaterialEditor(item),
      openSoundCueEditor: (item) => this.openSoundCueEditor(item),
      openParticleEffectEditor: (item) => this.openParticleEffectEditor(item),
      openDialogueEditor: (item) => this.openDialogueEditor(item),
      openBehaviorTreeEditor: (item) => this.openBehaviorTreeEditor(item),
      openStateTreeEditor: (item) => this.openStateTreeEditor(item),
      openLevel: (item) => this.openLevel(item),
      openUiWidgetEditor: (item) => this.openUiWidgetEditor(item),
      renderAssetThumbnail: (item, thumb) => this.renderAssetThumbnail(item, thumb),
      renderMaterialThumbnail: (item, thumb) => this.renderMaterialThumbnail(item, thumb),
      renderTextureThumbnail: (item, thumb) => this.renderTextureThumbnail(item, thumb),
      beginAssetDragPreview: (assetId) => this.app.beginAssetDragPreview(assetId),
      endAssetDragPreview: () => this.handleAssetDragEnd(),
      setStatus: (message, tone) => this.setStatus(message, tone),
    });
  }

  private renderContentFilters(): void {
    const allItems = this.assetTreeRoot
      ? flattenProjectFiles([this.assetTreeRoot])
          .filter((file) => this.shouldDisplayAssetFile(file))
          .map((file) => this.toBrowserAssetItem(file))
      : [];
    this.contentType = renderContentFilterOptions(this.contentTypeFilter, allItems, this.contentType);
    this.syncContentFilterButton();
  }

  private shouldDisplayAssetFile(file: ProjectDirNode): boolean {
    if (file.type !== "file") return false;
    if (!this.shouldShowContentPath(file.path)) return false;
    const name = file.name.toLocaleLowerCase();
    return !(
      name === "manifest.json" ||
      name === "catalog.json" ||
      name === "metadata-schema.json" ||
      name.endsWith(".collision.json") ||
      name.endsWith(".materials.json") ||
      name.endsWith(".uvw.json") ||
      name.endsWith(".vertexcolors.json") ||
      name.endsWith(".skeleton.json") ||
      // Layout companions saved beside a level (`<layout>.foliage.json`, ...).
      // The `.foliagetype.json` asset stays listed — it is a real manifest asset.
      name.endsWith(".landscape.json") ||
      name.endsWith(".foliage.json") ||
      name.endsWith(".meshpaint.json")
    );
  }

  private toBrowserFolderItem(folder: ProjectDirNode): BrowserFolderItem {
    return {
      key: folder.path,
      label: folder.name,
      path: folder.path,
      type: "folder",
      fileCount: folder.children?.filter((child) => child.type === "file").length ?? 0,
      descendantFileCount: flattenProjectFiles([folder]).length,
    };
  }

  private toBrowserAssetItem(file: ProjectDirNode): BrowserAssetItem {
    const editable = this.editableAssetByProjectPath().get(file.path);
    const base = {
      key: file.path,
      label: editable?.displayName ?? file.name,
      category: editable?.catalogCategory ?? file.ext ?? "file",
      path: file.path,
      ext: file.ext ?? "file",
      type: editable ? assetType(editable) : (inferAssetTypeFromPath(file.path) ?? "file"),
    } satisfies Omit<BrowserAssetItem, "editable">;
    return editable ? { ...base, editable } : base;
  }

  private editableAssetByProjectPath(): Map<string, EditableAsset> {
    // The Content Browser directory tree (`/__project-dir`) is public-scoped, so
    // its file paths are "assets/...". Manifest `asset.path` is also public-root
    // relative. Index both the bare "assets/..." key and the legacy
    // "public/assets/..." form so a manifest-registered file is matched instead
    // of being treated as "not registered" (which blocks drag-to-place).
    const publicDir = this.projectInfo?.manifest.publicDir ?? "public";
    const byPath = new Map<string, EditableAsset>();
    for (const asset of this.editableAssets) {
      const path = normalizeProjectPath(assetPath(asset));
      byPath.set(path, asset);
      const publicPrefixedPath = normalizeProjectPath(`${publicDir}/${path}`);
      if (publicPrefixedPath !== path) byPath.set(publicPrefixedPath, asset);
    }
    return byPath;
  }

  private shouldShowContentPath(path: string): boolean {
    return this.showDevelopmentContent || !isDevelopmentContentPath(path);
  }

  private ensureVisibleSelectedFolder(): void {
    if (!this.assetTreeRoot) return;
    if (!this.shouldShowContentPath(this.selectedFolder)) {
      this.selectedFolder = this.assetTreeRoot.path;
    }
  }

  private visibleProjectFiles(): ProjectDirNode[] {
    return this.assetTreeRoot
      ? flattenProjectFiles([this.assetTreeRoot]).filter((file) => this.shouldDisplayAssetFile(file))
      : [];
  }

  private countMissingManifestAssetFiles(): number {
    if (!this.assetTreeRoot || !this.projectInfo) return 0;
    const publicDir = this.projectInfo.manifest.publicDir ?? "public";
    const filePaths = new Set(this.visibleProjectFiles().map((file) => normalizeProjectPath(file.path)));
    return this.editableAssets.filter((asset) => {
      const path = normalizeProjectPath(assetPath(asset));
      if (!this.shouldShowContentPath(path)) return false;
      if (filePaths.has(path)) return false;
      return !filePaths.has(normalizeProjectPath(`${publicDir}/${path}`));
    }).length;
  }

  /** A preloaded 1x1 transparent image used as the drag image so the browser
   *  doesn't render its default card snapshot during a drag. */
  private getEmptyDragImage(): HTMLImageElement {
    if (!this.emptyDragImage) {
      const image = new Image();
      image.src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      this.emptyDragImage = image;
    }
    return this.emptyDragImage;
  }

  /**
   * The full Add Actor catalog (EDITOR_UI_REDESIGN_PLAN Faz 2). One descriptor
   * per placeable actor drives the category submenu and flat search results, so
   * their drag payloads and click actions can never drift apart. Drag channels mirror the runtime drop
   * handlers: lights (`x-forge-light-actor`), assets (`x-3dgamedev-asset`),
   * special actors (`x-forge-special-actor`); click-only singletons omit `drag`.
   */
  private buildAddActorEntries(): AddActorEntry[] {
    // Draggable assets/lights hint on click (they only place on drop); specials
    // and singletons create on click as well.
    const dragHintClick = (): void =>
      this.setStatus("Drag the actor into the viewport to place it.", "info");
    const entries: AddActorEntry[] = [];

    (["directional", "point", "spot"] as const).forEach((type) => {
      entries.push({
        key: `light:${type}`,
        label: formatLightTypeLabel(type),
        category: "Lights",
        icon: "light",
        attr: `data-add-actor="${type}"`,
        drag: {
          mime: "application/x-forge-light-actor",
          payload: () => type,
          beginPreview: () => this.app.beginLightDragPreview(type),
        },
        onClick: dragHintClick,
      });
    });

    (["cube", "sphere", "cylinder", "cone", "plane"] as const).forEach((type) => {
      const assetId = shapeAssetId(type);
      entries.push({
        key: `shape:${type}`,
        label: formatShapeTypeLabel(type),
        category: "Shapes",
        icon: SHAPE_ACTOR_ICONS[type],
        attr:
          `data-add-shape="${type}"` +
          (type === "cube" ? ' data-testid="add-shape-cube"' : ""),
        drag: {
          mime: "application/x-3dgamedev-asset",
          payload: () => assetId,
          beginPreview: () => this.app.beginAssetDragPreview(assetId),
        },
        onClick: dragHintClick,
      });
    });

    const special = (
      key: string,
      label: string,
      category: string,
      icon: ActorTypeIcon,
      onClick: () => void,
      payload: () => string = () => key,
    ): void => {
      entries.push({
        key,
        label,
        category,
        icon,
        drag: { mime: "application/x-forge-special-actor", payload },
        onClick,
      });
    };
    const singleton = (
      key: string,
      label: string,
      category: string,
      icon: ActorTypeIcon,
      onClick: () => void,
    ): void => {
      entries.push({ key, label, category, icon, onClick });
    };

    special("blockingVolume", "Blocking Volume", "Volumes", "volume", () =>
      this.app.addBlockingVolume(),
    );
    special("aiNavigationVolume", "AI Navigation Volume", "Volumes", "volume", () =>
      this.app.addAiNavigationVolume(),
    );

    singleton("skyAtmosphere", "Sky Atmosphere", "Visual Effects", "atmosphere", () =>
      this.app.addSkyAtmosphere(),
    );
    singleton("heightFog", "Exponential Height Fog", "Visual Effects", "cloud", () =>
      this.app.addHeightFog(),
    );
    singleton("cloudLayer", "Cloud Layer", "Visual Effects", "cloud", () =>
      this.app.addCloudLayer(),
    );
    singleton("reflectionPlane", "Mirror Plane", "Visual Effects", "reflection", () =>
      this.app.addReflectionPlane(),
    );
    singleton("reflectiveSurface", "Reflective Surface", "Visual Effects", "reflection", () =>
      this.app.addReflectiveSurface(),
    );
    singleton(
      "reflectionCapture",
      "Sphere Reflection Capture",
      "Visual Effects",
      "reflection",
      () => this.app.addReflectionCapture(),
    );
    singleton("postProcess", "Post Process", "Visual Effects", "postprocess", () =>
      this.app.addPostProcess(),
    );

    singleton("landscape", "Landscape", "Terrain", "terrain", () => this.app.addLandscape());

    entries.push({
      key: "ambientSound",
      label: "Ambient Sound",
      category: "Sounds",
      icon: "sound",
      drag: {
        mime: "application/x-3dgamedev-asset",
        payload: () => AMBIENT_SOUND_ASSET_ID,
        beginPreview: () => this.app.beginAssetDragPreview(AMBIENT_SOUND_ASSET_ID),
      },
      onClick: dragHintClick,
    });

    special(
      "worldWidget",
      "World Widget",
      "UI",
      "widget",
      () => this.app.addWorldWidget(this.firstUiWidgetAssetId()),
      () => `worldWidget:${this.firstUiWidgetAssetId()}`,
    );

    entries.push({
      key: "playerStart",
      label: "Player Start",
      category: "Gameplay",
      icon: "character",
      drag: {
        mime: "application/x-3dgamedev-asset",
        payload: () => PLAYER_START_ASSET_ID,
        beginPreview: () => this.app.beginAssetDragPreview(PLAYER_START_ASSET_ID),
      },
      onClick: dragHintClick,
    });
    special("targetPoint", "Target Point", "Gameplay", "gameplay", () =>
      this.app.addTargetPoint(),
    );
    special("spline", "Spline", "Gameplay", "spline", () => this.app.addSpline());

    return entries;
  }

  /** Markup for the Add Actor popover body: search row, category submenus, and
   *  the flat search-results slot. */
  private buildAddActorMenuMarkup(): string {
    const categories = ADD_ACTOR_CATEGORIES.map((cat) => {
      const rows = this.addActorEntries
        .filter((entry) => entry.category === cat.label)
        .map((entry) => this.addActorItemMarkup(entry, { includeAttr: true }))
        .join("");
      return (
        `<div class="add-actor-category">` +
        `<button type="button" class="add-actor-category-label">${ACTOR_TYPE_ICONS[cat.icon]}<span>${cat.label}</span></button>` +
        `<div class="add-actor-submenu">${rows}</div></div>`
      );
    }).join("");
    return (
      `<div class="add-actor-search-row">${UI_ICONS.search}` +
      `<input type="text" class="add-actor-search" data-add-search placeholder="Search actors" aria-label="Search actors" />` +
      `</div>` +
      `<div class="add-actor-categories" data-add-categories>${categories}</div>` +
      `<div class="add-actor-results" data-add-results hidden></div>`
    );
  }

  /**
   * One flyout / list button for an Add Actor entry. `showCategory` appends the
   * category as a dim hint (search results). `includeAttr` emits `entry.attr`
   * (the cube `data-testid` + legacy hooks) — only the canonical category row
   * sets it, so search copies never duplicate a testid.
   */
  private addActorItemMarkup(
    entry: AddActorEntry,
    options: { showCategory?: boolean; includeAttr?: boolean } = {},
  ): string {
    const cat = options.showCategory
      ? `<span class="add-actor-item-cat">${escapeHtml(entry.category)}</span>`
      : "";
    const attr = options.includeAttr && entry.attr ? ` ${entry.attr}` : "";
    return (
      `<button type="button" class="add-actor-item" data-add-key="${escapeHtml(entry.key)}"${attr}>` +
      `${ACTOR_TYPE_ICONS[entry.icon]}<span class="add-actor-item-label">${escapeHtml(entry.label)}</span>${cat}</button>`
    );
  }

  /** Wires the static category buttons and the search field. Dynamic search
   *  rows are bound on render. */
  private bindAddActorMenu(): void {
    const byKey = new Map(this.addActorEntries.map((entry) => [entry.key, entry]));
    this.root
      .querySelectorAll<HTMLElement>("[data-add-categories]")
      .forEach((container) => {
        container.querySelectorAll<HTMLButtonElement>(".add-actor-item").forEach((button) => {
          const entry = byKey.get(button.dataset.addKey ?? "");
          if (entry) this.bindAddActorEntry(button, entry);
        });
      });

    const search = this.root.querySelector<HTMLInputElement>("[data-add-search]");
    if (search) {
      search.addEventListener("input", () => this.renderAddActorSearchResults(search.value));
      // Enter on a single match places it (mouse-free convenience).
      search.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const first = this.root.querySelector<HTMLButtonElement>(
          "[data-add-results] .add-actor-item",
        );
        first?.click();
      });
    }
  }

  /** Attaches the drag payload + click behavior for one Add Actor entry to a
   *  freshly rendered button (category or search result). */
  private bindAddActorEntry(button: HTMLButtonElement, entry: AddActorEntry): void {
    if (entry.drag) {
      const drag = entry.drag;
      button.draggable = true;
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData(drag.mime, drag.payload());
        event.dataTransfer!.effectAllowed = "copy";
        event.dataTransfer?.setDragImage(this.getEmptyDragImage(), 0, 0);
        drag.beginPreview?.();
        this.setStatus(`Dragging ${entry.label} - drop in the viewport to place.`);
      });
      button.addEventListener("dragend", () => {
        this.app.endAssetDragPreview();
      });
    }
    button.addEventListener("click", () => {
      entry.onClick();
    });
  }

  /** Renders the flat, filtered search results; empty query restores categories. */
  private renderAddActorSearchResults(query: string): void {
    const results = this.root.querySelector<HTMLElement>("[data-add-results]");
    const categories = this.root.querySelector<HTMLElement>("[data-add-categories]");
    if (!results || !categories) return;
    const q = query.trim().toLowerCase();
    if (q === "") {
      results.hidden = true;
      results.innerHTML = "";
      categories.hidden = false;
      return;
    }
    categories.hidden = true;
    const byKey = new Map(this.addActorEntries.map((entry) => [entry.key, entry]));
    const matches = this.addActorEntries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) || entry.category.toLowerCase().includes(q),
    );
    results.hidden = false;
    results.innerHTML =
      matches.length === 0
        ? `<div class="add-actor-empty">No actors match “${escapeHtml(query.trim())}”</div>`
        : matches.map((entry) => this.addActorItemMarkup(entry, { showCategory: true })).join("");
    results.querySelectorAll<HTMLButtonElement>(".add-actor-item").forEach((button) => {
      const entry = byKey.get(button.dataset.addKey ?? "");
      if (entry) this.bindAddActorEntry(button, entry);
    });
  }

  /** Highlight a single Content Browser asset card without re-rendering the
   *  whole grid (re-renders re-apply the class from `selectedAssetId`). */
  private setSelectedAsset(assetId: string | null): void {
    this.selectedAssetId = assetId;
    if (assetId !== null) this.selectedContentFolderPath = null;
    for (const card of this.contentList.querySelectorAll<HTMLElement>(".asset-card")) {
      card.classList.toggle("is-selected", card.dataset.assetId === assetId);
    }
  }

  private setSelectedContentFolder(path: string | null): void {
    this.selectedContentFolderPath = path;
    if (path !== null) this.selectedAssetId = null;
    for (const card of this.contentList.querySelectorAll<HTMLElement>(".asset-card")) {
      card.classList.toggle("is-selected", card.dataset.folderPath === path);
    }
  }

  private navigateToContentFolder(path: string): void {
    this.setSelectedContentFolderPath(path);
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      this.collapsedFolderPaths.delete(segments.slice(0, i).join("/"));
    }
    this.clearContentSelection();
    this.renderFolderTree();
    this.renderContentAssets();
  }

  /** Stores the selected folder after project-tree validation, without persisting other Drawer UI state. */
  private setSelectedContentFolderPath(path: string, recordHistory = true): void {
    this.selectedFolder = normalizeProjectPath(path);
    this.saveLastContentFolder();
    if (recordHistory) this.recordContentNavigation(this.selectedFolder);
  }

  private resetContentNavigationHistory(path: string): void {
    this.contentNavigationHistory = [normalizeProjectPath(path)];
    this.contentNavigationIndex = 0;
    this.syncContentNavigationControls();
  }

  private recordContentNavigation(path: string): void {
    const normalized = normalizeProjectPath(path);
    if (this.contentNavigationHistory[this.contentNavigationIndex] === normalized) {
      this.syncContentNavigationControls();
      return;
    }
    this.contentNavigationHistory.splice(this.contentNavigationIndex + 1);
    this.contentNavigationHistory.push(normalized);
    this.contentNavigationIndex = this.contentNavigationHistory.length - 1;
    this.syncContentNavigationControls();
  }

  private navigateContentHistory(offset: -1 | 1): void {
    const nextIndex = this.contentNavigationIndex + offset;
    const nextPath = this.contentNavigationHistory[nextIndex];
    if (!nextPath) return;
    this.contentNavigationIndex = nextIndex;
    this.setSelectedContentFolderPath(nextPath, false);
    this.clearContentSelection();
    this.renderFolderTree();
    this.renderContentAssets();
    this.syncContentNavigationControls();
  }

  private syncContentNavigationControls(): void {
    this.contentBackButton.disabled = this.contentNavigationIndex <= 0;
    this.contentForwardButton.disabled =
      this.contentNavigationIndex < 0 || this.contentNavigationIndex >= this.contentNavigationHistory.length - 1;
  }

  private contentDrawerLastFolderStorageKey(): string | null {
    if (!this.projectInfo) return null;
    const projectIdentity = `${this.projectInfo.rootName}:${normalizeProjectPath(this.projectInfo.assetRoot)}`;
    return `${CONTENT_DRAWER_LAST_FOLDER_STORAGE_PREFIX}${encodeURIComponent(projectIdentity)}`;
  }

  private contentDrawerFavoritesStorageKey(): string | null {
    if (!this.projectInfo) return null;
    const projectIdentity = `${this.projectInfo.rootName}:${normalizeProjectPath(this.projectInfo.assetRoot)}`;
    return `forge.contentDrawer.favorites.${encodeURIComponent(projectIdentity)}`;
  }

  private readFavoriteContentFolders(): Set<string> {
    const key = this.contentDrawerFavoritesStorageKey();
    if (!key) return new Set();
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((path): path is string => typeof path === "string").map(normalizeProjectPath)
          : [],
      );
    } catch {
      return new Set();
    }
  }

  private toggleFavoriteContentFolder(path: string): void {
    const normalized = normalizeProjectPath(path);
    if (this.favoriteContentFolders.has(normalized)) {
      this.favoriteContentFolders.delete(normalized);
    } else {
      this.favoriteContentFolders.add(normalized);
    }
    this.saveFavoriteContentFolders();
    this.renderFolderTree();
  }

  private saveFavoriteContentFolders(): void {
    const key = this.contentDrawerFavoritesStorageKey();
    try {
      if (key) window.localStorage.setItem(key, JSON.stringify([...this.favoriteContentFolders]));
    } catch {
      // Favorites remain useful for the current session if persistent storage is unavailable.
    }
  }

  private readLastContentFolder(): string | null {
    const key = this.contentDrawerLastFolderStorageKey();
    if (!key) return null;
    try {
      const saved = window.localStorage.getItem(key);
      return saved ? normalizeProjectPath(saved) : null;
    } catch {
      // Private browsing or blocked storage should leave the Drawer fully usable.
      return null;
    }
  }

  private saveLastContentFolder(): void {
    const key = this.contentDrawerLastFolderStorageKey();
    if (!key || !this.selectedFolder) return;
    try {
      window.localStorage.setItem(key, this.selectedFolder);
    } catch {
      // Persistence is an enhancement; do not surface storage availability as an editor error.
    }
  }

  /** Drops the Content Browser asset selection and restores the grid summary. */
  private clearContentSelection(): void {
    if (this.selectedAssetId === null && this.selectedContentFolderPath === null) return;
    this.setSelectedAsset(null);
    this.setSelectedContentFolder(null);
  }

  /** Right-click menu for a single Content Browser asset card. */
  private openAssetContextMenu(event: MouseEvent, item: BrowserAssetItem): void {
    const items: ContextMenuItem[] = [];
    const activeLevel = this.isActiveLevel(item);
    if (isLevelItem(item)) {
      // A level's primary action is choosing it as the project's default scene.
      // The active level shows a disabled marker instead (it is already default).
      if (activeLevel) {
        items.push({ label: "✓ Default Level", enabled: false, run: () => {} });
      } else {
        items.push({ label: "Set Default Level", run: () => void this.openLevel(item) });
      }
      items.push({ separator: true });
    } else {
      const opener = this.assetEditorOpener(item);
      if (opener) {
        items.push({ label: "Open", run: opener });
      }
      if (item.type !== "file" && isModelAssetType(item.type)) {
        items.push({ label: "Reimport...", run: () => this.startReimport(item) });
      }
      if (opener || (item.type !== "file" && isModelAssetType(item.type))) {
        items.push({ separator: true });
      }
    }
    // The active level is locked: renaming or deleting it would leave
    // `defaultScene` pointing at a missing file, so both are disabled.
    items.push({
      label: "Rename...",
      enabled: !activeLevel,
      run: () => void this.renameContentAsset(item),
    });
    items.push({
      label: "Cut",
      enabled: !activeLevel,
      run: () => this.setContentClipboard(item, "move"),
    });
    items.push({ label: "Copy", run: () => this.setContentClipboard(item, "copy") });
    items.push({ label: "Copy Path", run: () => void this.copyContentAssetPath(item) });
    items.push({ separator: true });
    items.push({
      label: "Delete",
      danger: true,
      enabled: !activeLevel,
      run: () => void this.deleteContentAsset(item),
    });
    this.openContextMenu(event, items);
  }

  /** Right-click menu for a Content Browser folder card/tree row. */
  private openContentFolderContextMenu(event: MouseEvent, item: BrowserFolderItem): void {
    const items: ContextMenuItem[] = [
      { label: "Open", run: () => this.navigateToContentFolder(item.path) },
      {
        label: this.favoriteContentFolders.has(item.path) ? "Remove from Favorites" : "Add to Favorites",
        run: () => this.toggleFavoriteContentFolder(item.path),
      },
      { separator: true },
      {
        label: "Paste",
        enabled: this.contentClipboard !== null,
        run: () => void this.pasteContent(item.path),
      },
      { separator: true },
      { label: "New Folder", run: () => void this.createContent("folder", item.path) },
      { label: "Import...", run: () => this.startImport(item.path) },
      { separator: true },
      { label: "Rename...", run: () => void this.renameContentFolder(item) },
      { label: "Copy Path", run: () => void this.copyContentFolderPath(item) },
      { separator: true },
      {
        label: "Delete",
        danger: true,
        run: () => void this.deleteContentFolder(item),
      },
    ];
    this.openContextMenu(event, items);
  }

  /** Returns an action opening the editor that matches `item`, or null. */
  private assetEditorOpener(item: BrowserAssetItem): (() => void) | null {
    if (isLevelItem(item)) return () => void this.openLevel(item);
    if (item.type === "material") return () => void this.openMaterialEditor(item);
    if (isUiWidgetItem(item)) return () => void this.openUiWidgetEditor(item);
    if (isActorScriptItem(item)) return () => void this.openActorScriptEditor(item);
    if (item.type === "soundCue") return () => void this.openSoundCueEditor(item);
    if (item.type === "effect") return () => void this.openParticleEffectEditor(item);
    if (item.type === "dialogueVoice" || item.type === "dialogueLine") {
      return () => void this.openDialogueEditor(item);
    }
    if (item.type === "behaviorTree") return () => void this.openBehaviorTreeEditor(item);
    if (item.type === "stateTree") return () => void this.openStateTreeEditor(item);
    if (item.type !== "file" && isModelAssetType(item.type)) {
      return () => void this.openMeshEditor(item);
    }
    return null;
  }

  /**
   * Opens a level for editing: makes it the project's active scene
   * (`editor.defaultScene`) via the dev endpoint, then reloads so boot rebuilds
   * the whole scene from the new default. A full reload is intentional — the
   * scene build path (physics, behaviors, reflections, widgets, runtime) is the
   * boot path, so reusing it avoids a fragile in-place teardown. Switching the
   * active scene also changes where Save writes, so this is gated on a confirm
   * when the current level has undoable (possibly unsaved) edits.
   */
  private async openLevel(item: BrowserAssetItem): Promise<void> {
    if (this.isActiveLevel(item)) {
      this.setStatus(`${item.label} is already the active level.`, "info");
      return;
    }
    if (
      this.app.getHistoryState().canUndo &&
      !window.confirm(
        `Open "${item.label}"?\nUnsaved changes to the current level will be lost.`,
      )
    ) {
      return;
    }
    try {
      await openProjectLevel(item.path);
      this.setStatus(`Opening ${item.label}…`, "success");
      window.location.reload();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /**
   * True when `item` is the level the project currently loads + saves
   * (`editor.defaultScene`). The active level is locked in the Content Browser:
   * it can't be deleted or renamed (either would break the next scene load), and
   * it is the one "Set Default Level" hides since it is already the default.
   */
  private isActiveLevel(item: BrowserAssetItem): boolean {
    if (!isLevelItem(item)) return false;
    const current = this.projectInfo?.manifest.editor.defaultScene;
    return Boolean(current && normalizeProjectPath(current) === normalizeProjectPath(item.path));
  }

  /** Prompts for a new base name and renames the asset file via the dev endpoint. */
  private async renameContentAsset(item: BrowserAssetItem): Promise<void> {
    if (this.isActiveLevel(item)) {
      this.setStatus(
        `"${item.label}" is the active level and is locked. Set another level as default before renaming it.`,
        "warning",
      );
      return;
    }
    const fileName = item.path.split("/").at(-1) ?? item.path;
    const dot = fileName.indexOf(".");
    const currentBase = dot > 0 ? fileName.slice(0, dot) : fileName;
    const next = window.prompt("Rename asset", currentBase);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentBase) return;
    try {
      const result = await renameProjectContent(item.path, trimmed);
      if (this.contentClipboard?.path === item.path) {
        this.contentClipboard = { ...this.contentClipboard, path: result.path, label: trimmed };
      }
      this.setStatus(`Renamed to ${result.path}`, "success");
      if (result.registered) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below still shows the new name.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Confirms, then deletes the asset file (and sidecars/manifest entry). */
  private async deleteContentAsset(item: BrowserAssetItem): Promise<void> {
    if (this.isActiveLevel(item)) {
      this.setStatus(
        `"${item.label}" is the active level and is locked. Set another level as default before deleting it.`,
        "warning",
      );
      return;
    }
    if (!window.confirm(`Delete "${item.label}"? This cannot be undone.`)) return;
    try {
      const result = await deleteProjectContent(item.path);
      if (this.contentClipboard?.path === item.path) this.clearContentClipboard();
      if (item.editable && this.selectedAssetId === item.editable.id) {
        this.setSelectedAsset(null);
      }
      this.setStatus(`Deleted ${result.path}`, "success");
      if (result.registered) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below drops the deleted card.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Prompts for a new folder name and updates descendant path references server-side. */
  private async renameContentFolder(item: BrowserFolderItem): Promise<void> {
    const currentBase = item.path.split("/").at(-1) ?? item.label;
    const next = window.prompt("Rename folder", currentBase);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentBase) return;
    try {
      const result = await renameProjectContent(item.path, trimmed);
      this.setSelectedContentFolderPath(
        replaceContentPathPrefix(this.selectedFolder, item.path, result.path),
      );
      if (this.selectedContentFolderPath) {
        this.selectedContentFolderPath = replaceContentPathPrefix(
          this.selectedContentFolderPath,
          item.path,
          result.path,
        );
      }
      this.collapsedFolderPaths = new Set(
        [...this.collapsedFolderPaths].map((path) =>
          replaceContentPathPrefix(path, item.path, result.path),
        ),
      );
      this.favoriteContentFolders = new Set(
        [...this.favoriteContentFolders].map((path) =>
          replaceContentPathPrefix(path, item.path, result.path),
        ),
      );
      this.saveFavoriteContentFolders();
      this.setStatus(`Renamed folder to ${result.path}`, "success");
      if (result.registered) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below still shows the new paths.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Confirms, then deletes a folder and asks the server to scrub stale references. */
  private async deleteContentFolder(item: BrowserFolderItem): Promise<void> {
    const hasFiles = item.descendantFileCount > 0;
    const message = hasFiles
      ? `Delete folder "${item.label}" and ${item.descendantFileCount} file(s)?\n\nForge will remove descendant manifest entries and clean level references to deleted assets/classes so the project can keep loading. This cannot be undone.`
      : `Delete empty folder "${item.label}"? This cannot be undone.`;
    if (!window.confirm(message)) return;
    try {
      const parent = parentContentPath(item.path) ?? this.assetTreeRoot?.path ?? "";
      const result = await deleteProjectContent(item.path);
      if (isSameOrDescendantContentPath(this.selectedFolder, item.path)) {
        this.setSelectedContentFolderPath(parent);
      }
      if (
        this.selectedContentFolderPath &&
        isSameOrDescendantContentPath(this.selectedContentFolderPath, item.path)
      ) {
        this.selectedContentFolderPath = null;
      }
      this.collapsedFolderPaths = new Set(
        [...this.collapsedFolderPaths].filter((path) => !isSameOrDescendantContentPath(path, item.path)),
      );
      this.favoriteContentFolders = new Set(
        [...this.favoriteContentFolders].filter((path) => !isSameOrDescendantContentPath(path, item.path)),
      );
      this.saveFavoriteContentFolders();
      this.setStatus(
        `Deleted ${result.path} (${result.deletedFiles} file(s), ${result.removedAssets} asset(s), ${result.cleanedLayouts} level file(s) cleaned)`,
        "success",
      );
      if (result.registered || result.removedAssets > 0) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below drops deleted files.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Copies the folder's public-relative path to the clipboard. */
  private async copyContentFolderPath(item: BrowserFolderItem): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.path);
      this.setStatus(`Copied ${item.path}`, "success");
    } catch {
      this.setStatus(`Path: ${item.path}`, "info");
    }
  }

  /** Copies the asset's public-relative path to the clipboard. */
  private async copyContentAssetPath(item: BrowserAssetItem): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.path);
      this.setStatus(`Copied ${item.path}`, "success");
    } catch {
      this.setStatus(`Path: ${item.path}`, "info");
    }
  }

  /** Copies a file operation into the editor-only Content Browser clipboard. */
  private setContentClipboard(item: BrowserAssetItem, operation: "copy" | "move"): void {
    this.contentClipboard = { path: item.path, label: item.label, operation };
    this.renderContentAssets();
    this.setStatus(
      `${operation === "move" ? "Cut" : "Copied"} ${item.label}. Select a folder and choose Paste.`,
      "info",
    );
  }

  private clearContentClipboard(): void {
    if (!this.contentClipboard) return;
    this.contentClipboard = null;
    this.renderContentAssets();
  }

  /** Pastes the in-editor file clipboard into an existing Content Browser folder. */
  private async pasteContent(destinationDir: string): Promise<void> {
    const clipboard = this.contentClipboard;
    if (!clipboard) {
      this.setStatus("Content clipboard is empty.", "warning");
      return;
    }
    try {
      const result = await transferProjectContent(clipboard.path, destinationDir, clipboard.operation);
      if (result.registered) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // The tree refresh still reflects the completed file operation.
        }
      }
      this.setSelectedContentFolderPath(destinationDir);
      await this.refreshAssetTree({ quiet: false });
      if (result.registeredId) this.setSelectedAsset(result.registeredId);
      if (clipboard.operation === "move") this.clearContentClipboard();
      this.setStatus(
        `${clipboard.operation === "move" ? "Moved" : "Copied"} ${clipboard.label} to ${result.path}`,
        "success",
      );
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  private renderTextureThumbnail(item: BrowserAssetItem, thumb: HTMLElement): void {
    thumb.replaceChildren();
    const image = document.createElement("img");
    image.alt = "";
    image.src = projectFileUrl(item.path);
    thumb.append(image);
  }

  private async renderMaterialThumbnail(item: BrowserAssetItem, thumb: HTMLElement): Promise<void> {
    try {
      const material = await this.resolveMaterialPreview(item);
      if (!material) throw new Error("Material preview unavailable");
      const imageUrl = await this.thumbnailRenderer.renderMaterial(item.editable?.id ?? item.path, material);
      if (!thumb.isConnected) return;
      thumb.replaceChildren();
      const image = document.createElement("img");
      image.alt = "";
      image.src = imageUrl;
      thumb.append(image);
    } catch {
      if (thumb.isConnected) thumb.textContent = item.ext.toUpperCase();
    }
  }

  private resolveMaterialPreview(item: BrowserAssetItem): Promise<ThumbnailMaterialPreview | undefined> {
    const key = item.editable?.id ?? item.path;
    let cached = this.materialPreviewCache.get(key);
    if (!cached) {
      cached = this.resolveMaterialPreviewUncached(item);
      this.materialPreviewCache.set(key, cached);
    }
    return cached;
  }

  private async resolveMaterialPreviewUncached(
    item: BrowserAssetItem,
  ): Promise<ThumbnailMaterialPreview | undefined> {
    return this.resolveMaterialPreviewById(item.editable?.id, item.path);
  }

  private resolveModelDefaultMaterialPreview(item: BrowserAssetItem): Promise<ThumbnailMaterialPreview | undefined> {
    const key = item.editable?.id ?? item.path;
    let cached = this.modelMaterialPreviewCache.get(key);
    if (!cached) {
      cached = this.resolveModelDefaultMaterialPreviewUncached(item);
      this.modelMaterialPreviewCache.set(key, cached);
    }
    return cached;
  }

  private async resolveModelDefaultMaterialPreviewUncached(
    item: BrowserAssetItem,
  ): Promise<ThumbnailMaterialPreview | undefined> {
    const slots = await loadAssetMaterialSlots(item.path);
    const materialId = slots.slots[0];
    return materialId ? this.resolveMaterialPreviewById(materialId) : undefined;
  }

  private async resolveMaterialPreviewById(
    materialId: string | undefined,
    fallbackPath?: string,
  ): Promise<ThumbnailMaterialPreview | undefined> {
    const materialRecord = materialId
      ? assetRecordById({ version: 1, generated: "", ktx2: false, assets: this.editableAssets }, materialId)
      : undefined;
    const materialPath = materialRecord ? assetPath(materialRecord) : fallbackPath;
    if (!materialPath) return undefined;
    const response = await fetch(projectFileUrl(materialPath));
    if (!response.ok) return undefined;
    const def = normalizeForgeMaterialDef(await response.json(), materialRecord?.name ?? "Material");
    const baseColorTexturePath = this.texturePathById(def.baseColorTexture);
    const normalTexturePath = this.texturePathById(def.normalTexture);
    const roughnessTexturePath = this.texturePathById(def.roughnessTexture);
    const metalnessTexturePath = this.texturePathById(def.metalnessTexture);
    const aoTexturePath = this.texturePathById(def.aoTexture);
    const opacityTexturePath = this.texturePathById(def.opacityTexture);
    const emissiveTexturePath = this.texturePathById(def.emissiveTexture);
    const ormTexturePath = this.texturePathById(def.ormTexture);
    const layer1BaseColorTexturePath = this.texturePathById(def.layerBlend?.layer1.baseColorTexture ?? null);
    const layer1NormalTexturePath = this.texturePathById(def.layerBlend?.layer1.normalTexture ?? null);
    const layer1RoughnessTexturePath = this.texturePathById(def.layerBlend?.layer1.roughnessTexture ?? null);
    const layer1MetalnessTexturePath = this.texturePathById(def.layerBlend?.layer1.metalnessTexture ?? null);
    const layer1OpacityTexturePath = this.texturePathById(def.layerBlend?.layer1.opacityTexture ?? null);
    const layer1EmissiveTexturePath = this.texturePathById(def.layerBlend?.layer1.emissiveTexture ?? null);
    const layer1AoTexturePath = this.texturePathById(def.layerBlend?.layer1.aoTexture ?? null);
    const layerBlendMaskTexturePath = this.texturePathById(def.layerBlend?.maskTexture ?? null);
    return {
      materialType: def.materialType,
      baseColor: def.baseColor,
      ...(baseColorTexturePath ? { baseColorTextureUrl: projectFileUrl(baseColorTexturePath) } : {}),
      ...(normalTexturePath ? { normalTextureUrl: projectFileUrl(normalTexturePath) } : {}),
      ...(roughnessTexturePath ? { roughnessTextureUrl: projectFileUrl(roughnessTexturePath) } : {}),
      ...(metalnessTexturePath ? { metalnessTextureUrl: projectFileUrl(metalnessTexturePath) } : {}),
      ...(aoTexturePath ? { aoTextureUrl: projectFileUrl(aoTexturePath) } : {}),
      ...(opacityTexturePath ? { opacityTextureUrl: projectFileUrl(opacityTexturePath) } : {}),
      ...(emissiveTexturePath ? { emissiveTextureUrl: projectFileUrl(emissiveTexturePath) } : {}),
      ...(ormTexturePath ? { ormTextureUrl: projectFileUrl(ormTexturePath) } : {}),
      ...(def.layerBlend ? { layerBlend: def.layerBlend } : {}),
      ...(layer1BaseColorTexturePath ? { layer1BaseColorTextureUrl: projectFileUrl(layer1BaseColorTexturePath) } : {}),
      ...(layer1NormalTexturePath ? { layer1NormalTextureUrl: projectFileUrl(layer1NormalTexturePath) } : {}),
      ...(layer1RoughnessTexturePath ? { layer1RoughnessTextureUrl: projectFileUrl(layer1RoughnessTexturePath) } : {}),
      ...(layer1MetalnessTexturePath ? { layer1MetalnessTextureUrl: projectFileUrl(layer1MetalnessTexturePath) } : {}),
      ...(layer1OpacityTexturePath ? { layer1OpacityTextureUrl: projectFileUrl(layer1OpacityTexturePath) } : {}),
      ...(layer1EmissiveTexturePath ? { layer1EmissiveTextureUrl: projectFileUrl(layer1EmissiveTexturePath) } : {}),
      ...(layer1AoTexturePath ? { layer1AoTextureUrl: projectFileUrl(layer1AoTexturePath) } : {}),
      ...(layerBlendMaskTexturePath ? { layerBlendMaskTextureUrl: projectFileUrl(layerBlendMaskTexturePath) } : {}),
      uvTiling: def.uvTiling,
      flipY: def.flipY,
      roughness: def.roughness,
      metalness: def.metalness,
      aoIntensity: def.aoIntensity,
      opacity: def.opacity,
      useBaseColorAlphaForOpacity: def.useBaseColorAlphaForOpacity,
      alphaMode: def.alphaMode,
      alphaTest: def.alphaTest,
      side: def.side,
      emissive: def.emissive,
      emissiveIntensity: def.emissiveIntensity,
    };
  }

  private texturePathById(textureId: string | null): string | undefined {
    if (!textureId) return undefined;
    const texture = assetRecordById(
      { version: 1, generated: "", ktx2: false, assets: this.editableAssets },
      textureId,
    );
    return texture ? assetPath(texture) : undefined;
  }

  private async renderAssetThumbnail(
    item: BrowserAssetItem,
    thumb: HTMLElement,
  ): Promise<void> {
    try {
      const material = await this.resolveModelDefaultMaterialPreview(item);
      const imageUrl = await this.thumbnailRenderer.renderModel(
        projectFileUrl(item.path),
        material,
      );
      if (!thumb.isConnected) return;
      thumb.replaceChildren();
      const image = document.createElement("img");
      image.alt = "";
      image.src = imageUrl;
      thumb.append(image);
    } catch {
      if (thumb.isConnected) thumb.textContent = item.ext.toUpperCase();
    }
  }

  /**
   * Opens the asset editor that matches the model asset type.
   */
  private async openMeshEditor(item: BrowserAssetItem): Promise<void> {
    if (item.type === "skeletalMesh") {
      await this.openSkeletalMeshEditor(item);
      return;
    }
    await this.openStaticMeshEditor(item);
  }

  /**
   * Opens the Static Mesh editor for a model asset (Content Browser
   * double-click). Dynamically imported so its Three.js geometry helpers stay
   * out of the editor entry until a model is actually opened.
   */
  private async openStaticMeshEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { StaticMeshEditor } = await import("@/editor/StaticMeshEditor");
      StaticMeshEditor.open({
        modelPath: item.path,
        ...(item.editable ? { assetId: item.editable.id } : {}),
        label: item.label,
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onMaterialSlotsSaved: (assetId) => {
          this.modelMaterialPreviewCache.delete(assetId);
          this.renderContentAssets();
          void this.app.refreshAssetMaterialSlots(assetId);
        },
        onAssetUvwSaved: (assetId) => {
          void this.app.refreshAssetUvwMapping(assetId);
        },
        onCollisionSaved: () => {
          // Pick up the just-saved sidecar (preset/complexity/primitives) so the
          // scene's Show Collision overlay, Play-mode physics, and the Details
          // Simulate Physics guard (complexAsSimple → static-only) reflect it.
          void this.app.refreshAssetCollision().then(() => this.renderDetails(this.selected));
        },
      });
    } catch (error) {
      this.setStatus(
        `Could not open Static Mesh editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * Opens the Persona-style Skeletal Mesh editor for skinned character assets.
   */
  private async openSkeletalMeshEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { SkeletalMeshEditor } = await import("@/editor/SkeletalMeshEditor");
      SkeletalMeshEditor.open({
        modelPath: item.path,
        ...(item.editable ? { assetId: item.editable.id } : {}),
        label: item.label,
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        onStatus: (message, tone) => this.setStatus(message, tone),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Skeletal Mesh editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * Opens the form-based Material Editor for a `*.material.json` asset.
   * Kept behind a dynamic import like the other asset editors.
   */
  private async openMaterialEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { MaterialEditor } = await import("@/editor/MaterialEditor");
      await MaterialEditor.open({
        path: item.path,
        label: item.label.replace(/\.(material|mat)\.json$/i, ""),
        ...(item.editable ? { materialId: item.editable.id } : {}),
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        hideDevelopmentContent: !this.showDevelopmentContent,
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => {
          const key = item.editable?.id ?? item.path;
          this.materialPreviewCache.delete(key);
          this.modelMaterialPreviewCache.clear();
          this.thumbnailRenderer.clearCache();
          // A newly-authored material is now registered in the manifest server-side;
          // reload the editable-asset list so pickers (material slots, landscape
          // paint layers) pick it up without a full editor reload.
          void (async () => {
            this.editableAssets = await this.app.reloadEditableAssets();
            this.renderContentAssets();
            this.renderDetails(this.selected);
          })();
          if (item.editable) void this.app.refreshMaterialAsset(item.editable.id);
        },
        onApplyToSelected: (materialId) => this.app.setSelectionMaterialSlot(materialId),
        onBrowse: () => this.setStatus(`In Content Browser: ${item.path}`),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Material Editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * Opens the UMG Lite UI Widget editor for a `*.ui.json` asset. Kept behind a
   * dynamic import like the other asset editors.
   */
  private async openUiWidgetEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { UiWidgetEditor } = await import("@/editor/UiWidgetEditor");
      await UiWidgetEditor.open({
        path: item.path,
        label: item.label.replace(/\.ui\.json$/i, ""),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => this.renderContentAssets(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open UI Widget editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * Opens the node-graph Sound Cue editor for a `*.soundcue.json` asset.
   * Kept behind a dynamic import like the other asset editors.
   */
  private async openSoundCueEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { SoundCueEditor } = await import("@/editor/SoundCueEditor");
      await SoundCueEditor.open({
        path: item.path,
        label: item.label.replace(/\.soundcue\.json$/i, ""),
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => this.renderContentAssets(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Sound Cue editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /**
   * Opens the VFX Lite Particle Effect editor for a `*.effect.json` asset.
   * Kept behind a dynamic import like the other asset editors.
   */
  private async openParticleEffectEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { ParticleEffectEditor } = await import("@/editor/ParticleEffectEditor");
      await ParticleEffectEditor.open({
        path: item.path,
        label: item.label.replace(/\.effect\.json$/i, ""),
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        hideDevelopmentContent: !this.showDevelopmentContent,
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => this.renderContentAssets(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Particle Effect editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  private async openDialogueEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { DialogueEditor } = await import("@/editor/DialogueEditor");
      const mode = item.type === "dialogueVoice" ? "voice" : "line";
      const suffix = mode === "voice" ? /\.dialoguevoice\.json$/i : /\.dialogue\.json$/i;
      await DialogueEditor.open({
        mode,
        path: item.path,
        label: item.label.replace(suffix, ""),
        // Line mode: speaker/target suggestions come from the project's voices,
        // and the audio-source picker + preview from its sound / soundCue assets.
        voicePaths: this.editableAssets
          .filter((asset) => assetType(asset) === "dialogueVoice")
          .map((asset) => assetPath(asset)),
        audioAssets: this.editableAssets
          .filter((asset) => assetType(asset) === "sound" || assetType(asset) === "soundCue")
          .map((asset) => ({
            id: asset.id,
            name: asset.displayName ?? asset.name,
            assetType: assetType(asset) as "sound" | "soundCue",
            path: assetPath(asset),
          })),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => this.renderContentAssets(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Dialogue editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /** Opens the Behavior Tree editor for a `*.behavior.json` AI asset. */
  private async openBehaviorTreeEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { BehaviorTreeEditor } = await import("@/editor/BehaviorTreeEditor");
      await BehaviorTreeEditor.open({
        path: item.path,
        label: item.label.replace(/\.behavior\.json$/i, ""),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => this.renderContentAssets(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Behavior Tree editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /** Opens the StateTree editor for a `*.stateTree.json` AI asset. */
  private async openStateTreeEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { StateTreeEditor } = await import("@/editor/StateTreeEditor");
      await StateTreeEditor.open({
        path: item.path,
        label: item.label.replace(/\.stateTree\.json$/i, ""),
        onStatus: (message, tone) => this.setStatus(message, tone),
        onSaved: () => this.renderContentAssets(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open StateTree editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  private renderOutliner(objects: EditableSceneObject[]): void {
    this.outlinerObjects = objects;
    renderOutlinerPanel({
      body: this.outlinerList,
      summary: this.outlinerSummary,
      objects,
      filter: this.outlinerFilter,
      visibleTypes: this.outlinerVisibleTypes,
      selectSceneObject: (id, options) => this.app.selectSceneObject(id, options),
      renameSceneObject: (id, name) => this.app.renameSceneObject(id, name),
      setSceneObjectHidden: (id, hidden) => this.app.setSceneObjectHidden(id, hidden),
      setSceneObjectLocked: (id, locked) => this.app.setSceneObjectLocked(id, locked),
      parentObjectsTo: (childIds, parentId) => this.app.parentObjectsTo(childIds, parentId),
      openOutlinerContextMenu: (event, object) => this.openOutlinerContextMenu(event, object),
    });
    this.revealSelectedOutlinerRow();
  }

  /** Reveals a scene-picked actor after its fresh Outliner row has rendered. */
  private revealSelectedOutlinerRow(): void {
    const targetId = this.outlinerScrollTargetId;
    this.outlinerScrollTargetId = null;
    if (!targetId) return;

    const row = Array.from(this.outlinerList.querySelectorAll<HTMLElement>("[data-object-id]")).find(
      (element) => element.dataset.objectId === targetId,
    );
    row?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Right-click menu for outliner rows: rename / duplicate / group / delete. */
  private openOutlinerContextMenu(event: MouseEvent, object: EditableSceneObject): void {
    const selectedCount = this.outlinerObjects.filter((entry) => entry.selected).length;
    const inGroup =
      object.groupId !== undefined ||
      this.outlinerObjects.some((entry) => entry.selected && entry.groupId);

    const ensureSelected = (): void => {
      if (!object.selected) this.app.selectSceneObject(object.id);
    };

    const items: ContextMenuItem[] = [
      {
        label: "Rename",
        enabled: true,
        run: () => {
          const next = window.prompt("Rename object", object.label);
          if (next !== null) this.app.renameSceneObject(object.id, next);
        },
      },
      {
        label: "Duplicate",
        enabled: true,
        run: () => {
          ensureSelected();
          this.app.duplicateSelected();
        },
      },
      {
        label: "Group Selected",
        enabled: selectedCount >= 2,
        run: () => this.app.groupSelected(),
      },
      {
        label: "Ungroup",
        enabled: inGroup,
        run: () => {
          ensureSelected();
          this.app.ungroupSelected();
        },
      },
      {
        label: "Parent to active",
        enabled: selectedCount >= 2,
        run: () => this.app.parentSelectionToActive(),
      },
      {
        label: "Unparent",
        enabled:
          object.parentId !== undefined ||
          this.outlinerObjects.some((entry) => entry.selected && entry.parentId),
        run: () => {
          ensureSelected();
          this.app.unparentSelected();
        },
      },
      {
        label: "Delete",
        enabled: true,
        danger: true,
        run: () => {
          ensureSelected();
          this.app.deleteSelected();
        },
      },
    ];

    this.openContextMenu(event, items);
  }

  /**
   * Builds and positions a context menu at the pointer, wiring outside-click /
   * Escape / blur dismissal. Shared by the outliner and the Content Browser.
   */
  private openContextMenu(event: MouseEvent, items: ContextMenuItem[], variantClass?: string): void {
    this.closeContextMenu();

    const menu = document.createElement("div");
    menu.className = `context-menu${variantClass ? ` ${variantClass}` : ""}`;
    for (const item of items) {
      if (item.separator) {
        const divider = document.createElement("div");
        divider.className = "context-menu-separator";
        menu.appendChild(divider);
        continue;
      }
      if ("items" in item) {
        const wrap = document.createElement("div");
        wrap.className = "context-menu-submenu-wrap";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "context-menu-item context-menu-item-submenu";
        button.textContent = item.label;
        const submenu = document.createElement("div");
        submenu.className = "context-menu-submenu";
        for (const sub of item.items) {
          if (sub.separator) {
            const divider = document.createElement("div");
            divider.className = "context-menu-separator";
            submenu.appendChild(divider);
            continue;
          }
          if (!isContextMenuAction(sub)) continue;
          const subButton = document.createElement("button");
          subButton.type = "button";
          subButton.className = `context-menu-item${sub.danger ? " danger" : ""}`;
          subButton.textContent = sub.label;
          subButton.disabled = sub.enabled === false;
          subButton.addEventListener("click", () => {
            this.closeContextMenu();
            sub.run();
          });
          submenu.appendChild(subButton);
        }
        wrap.appendChild(button);
        wrap.appendChild(submenu);
        menu.appendChild(wrap);
        // Flip the flyout upward when it would otherwise overflow the bottom
        // of the viewport (submenu height is only known once it's visible).
        wrap.addEventListener("mouseenter", () => {
          const wrapRect = wrap.getBoundingClientRect();
          const submenuRect = submenu.getBoundingClientRect();
          const overflowsBottom = wrapRect.top + submenuRect.height > window.innerHeight - 8;
          if (overflowsBottom) {
            submenu.style.top = "auto";
            submenu.style.bottom = "-4px";
          } else {
            submenu.style.top = "-4px";
            submenu.style.bottom = "auto";
          }
        });
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = `context-menu-item${item.danger ? " danger" : ""}`;
      button.textContent = item.label;
      button.disabled = item.enabled === false;
      button.addEventListener("click", () => {
        this.closeContextMenu();
        item.run();
      });
      menu.appendChild(button);
    }
    document.body.appendChild(menu);

    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - margin);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - margin);
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;
    this.contextMenu = menu;

    const onPointerDown = (pointerEvent: Event): void => {
      if (!menu.contains(pointerEvent.target as Node)) this.closeContextMenu();
    };
    const onKeyDown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.code === "Escape") this.closeContextMenu();
    };
    // Defer so the opening event doesn't immediately dismiss the menu.
    window.setTimeout(() => document.addEventListener("pointerdown", onPointerDown), 0);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", this.closeContextMenu);
    this.contextMenuCleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", this.closeContextMenu);
    };
  }

  /** Toolbar +Add menu: folder and typed-asset creation in the active folder. */
  private openContentAddMenu(event: MouseEvent, dir: string): void {
    this.openContextMenu(event, [
      { label: "New Folder", run: () => void this.createContent("folder", dir) },
      { separator: true },
      ...CONTENT_NEW_ITEMS.map((item) => ({
        label: item.label,
        run: () => void this.createContent(item.kind, dir),
      })),
      { separator: true },
      {
        label: "Artificial Intelligence",
        items: CONTENT_NEW_AI_ITEMS.map((item) => ({
          label: item.label,
          run: () => void this.createContent(item.kind, dir),
        })),
      },
    ]);
  }

  /** Right-click menu for the Content Browser: New Folder / Import / typed assets. */
  private openContentContextMenu(event: MouseEvent, dir: string): void {
    const items: ContextMenuItem[] = [
      {
        label: "Paste",
        enabled: this.contentClipboard !== null,
        run: () => void this.pasteContent(dir),
      },
      { separator: true },
      { label: "New Folder", run: () => void this.createContent("folder", dir) },
      { separator: true },
      { label: "Import...", run: () => this.startImport(dir) },
      { separator: true },
      ...CONTENT_NEW_ITEMS.map((item) => ({
        label: item.label,
        run: () => void this.createContent(item.kind, dir),
      })),
      { separator: true },
      {
        label: "Artificial Intelligence",
        items: CONTENT_NEW_AI_ITEMS.map((item) => ({
          label: item.label,
          run: () => void this.createContent(item.kind, dir),
        })),
      },
    ];
    this.openContextMenu(event, items);
  }

  /** Prompts for a name, then creates the folder/typed stub and refreshes the tree. */
  private async createContent(kind: ContentNewKind, dir: string): Promise<void> {
    // A "Script" is an Actor Script class-asset: pick its parent class first
    // (Unreal's Pick Parent Class dialog), like creating a Blueprint Class.
    let parentClass: ParentClass | undefined;
    let materialPreset: ForgeMaterialPreset | undefined;
    let particlePreset: ParticleEffectPreset | undefined;
    if (kind === "script") {
      const picked = await this.pickParentClass();
      if (!picked) return;
      parentClass = picked;
    } else if (kind === "material") {
      const picked = await this.pickMaterialPreset();
      if (!picked) return;
      materialPreset = picked;
    } else if (kind === "particle") {
      const picked = await this.pickParticlePreset();
      if (!picked) return;
      particlePreset = picked;
    }
    const label =
      kind === "folder"
        ? "folder"
        : kind === "script"
          ? "Actor Script"
          : (CONTENT_NEW_ITEMS.find((item) => item.kind === kind)?.label ?? `${kind} asset`);
    const name = window.prompt(`New ${label} name`, "");
    if (name === null || !name.trim()) return;
    try {
      const result = await createProjectContent({
        kind,
        dir,
        name: name.trim(),
        ...(parentClass ? { parentClass } : {}),
        ...(materialPreset ? { materialPreset } : {}),
        ...(particlePreset ? { particlePreset } : {}),
      });
      this.setStatus(`Created ${result.path}`, "success");
      if (result.registeredId) {
        try {
          this.editableAssets = await this.app.reloadEditableAssets();
        } catch {
          // Keep the stale list; the tree refresh below still shows the new file.
        }
      }
      await this.refreshAssetTree({ quiet: false });
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /**
   * Modal mirroring Unreal's "Pick Parent Class": resolves to the chosen
   * {@link ParentClass}, or null when cancelled. Used when creating an Actor
   * Script from the Content Browser.
   */
  private pickParentClass(): Promise<ParentClass | null> {
    return new Promise((resolvePick) => {
      const overlay = document.createElement("div");
      overlay.className = "parent-class-overlay";
      const options = PARENT_CLASSES.map(
        (cls) => `
        <button type="button" class="parent-class-option" data-parent-class="${cls}">
          <span class="parent-class-name">${escapeHtml(PARENT_CLASS_LABELS[cls])}</span>
          <span class="parent-class-desc">${escapeHtml(PARENT_CLASS_DESCRIPTIONS[cls])}</span>
        </button>`,
      ).join("");
      overlay.innerHTML = `
        <div class="parent-class-dialog" role="dialog" aria-label="Pick Parent Class">
          <header class="parent-class-head">Pick Parent Class</header>
          <div class="parent-class-list">${options}</div>
          <footer class="parent-class-foot">
            <button type="button" class="parent-class-cancel" data-parent-cancel>Cancel</button>
          </footer>
        </div>
      `;
      document.body.append(overlay);
      const finish = (value: ParentClass | null): void => {
        cleanup();
        resolvePick(value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") finish(null);
      };
      const cleanup = (): void => {
        window.removeEventListener("keydown", onKey, true);
        overlay.remove();
      };
      window.addEventListener("keydown", onKey, true);
      overlay.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target === overlay || target.closest("[data-parent-cancel]")) {
          finish(null);
          return;
        }
        const option = target.closest<HTMLElement>("[data-parent-class]");
        if (option) finish(option.dataset.parentClass as ParentClass);
      });
    });
  }

  /**
   * Material creation starts with a small preset picker. The preset only seeds
   * the JSON defaults; the upcoming Material Editor remains free to change them.
   */
  private pickMaterialPreset(): Promise<ForgeMaterialPreset | null> {
    return new Promise((resolvePick) => {
      const overlay = document.createElement("div");
      overlay.className = "parent-class-overlay";
      const options = FORGE_MATERIAL_PRESETS.map(
        (preset) => `
        <button type="button" class="parent-class-option" data-material-preset="${preset}">
          <span class="parent-class-name">${escapeHtml(MATERIAL_PRESET_LABELS[preset])}</span>
          <span class="parent-class-desc">${escapeHtml(MATERIAL_PRESET_DESCRIPTIONS[preset])}</span>
        </button>`,
      ).join("");
      overlay.innerHTML = `
        <div class="parent-class-dialog" role="dialog" aria-label="Pick Material Preset">
          <header class="parent-class-head">Pick Material Preset</header>
          <div class="parent-class-list">${options}</div>
          <footer class="parent-class-foot">
            <button type="button" class="parent-class-cancel" data-material-preset-cancel>Cancel</button>
          </footer>
        </div>
      `;
      document.body.append(overlay);
      const finish = (value: ForgeMaterialPreset | null): void => {
        cleanup();
        resolvePick(value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") finish(null);
      };
      const cleanup = (): void => {
        window.removeEventListener("keydown", onKey, true);
        overlay.remove();
      };
      window.addEventListener("keydown", onKey, true);
      overlay.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target === overlay || target.closest("[data-material-preset-cancel]")) {
          finish(null);
          return;
        }
        const option = target.closest<HTMLElement>("[data-material-preset]");
        if (option) finish(option.dataset.materialPreset as ForgeMaterialPreset);
      });
    });
  }

  /**
   * Particle effect creation starts with a starter preset picker (§5.1). The
   * preset seeds the `*.effect.json` body; the Particle Effect Editor is free to
   * change everything afterwards.
   */
  private pickParticlePreset(): Promise<ParticleEffectPreset | null> {
    return new Promise((resolvePick) => {
      const overlay = document.createElement("div");
      overlay.className = "parent-class-overlay";
      const options = PARTICLE_EFFECT_PRESETS.map(
        (preset) => `
        <button type="button" class="parent-class-option" data-particle-preset="${preset}">
          <span class="parent-class-name">${escapeHtml(PARTICLE_PRESET_LABELS[preset])}</span>
          <span class="parent-class-desc">${escapeHtml(PARTICLE_PRESET_DESCRIPTIONS[preset])}</span>
        </button>`,
      ).join("");
      overlay.innerHTML = `
        <div class="parent-class-dialog" role="dialog" aria-label="Pick Particle Preset">
          <header class="parent-class-head">Pick Particle Preset</header>
          <div class="parent-class-list">${options}</div>
          <footer class="parent-class-foot">
            <button type="button" class="parent-class-cancel" data-particle-preset-cancel>Cancel</button>
          </footer>
        </div>
      `;
      document.body.append(overlay);
      const finish = (value: ParticleEffectPreset | null): void => {
        cleanup();
        resolvePick(value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") finish(null);
      };
      const cleanup = (): void => {
        window.removeEventListener("keydown", onKey, true);
        overlay.remove();
      };
      window.addEventListener("keydown", onKey, true);
      overlay.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        if (target === overlay || target.closest("[data-particle-preset-cancel]")) {
          finish(null);
          return;
        }
        const option = target.closest<HTMLElement>("[data-particle-preset]");
        if (option) finish(option.dataset.particlePreset as ParticleEffectPreset);
      });
    });
  }

  /**
   * Opens the Actor Script editor for a `*.actor.json` class-asset (Content
   * Browser double-click). Dynamically imported so its panels stay out of the
   * editor entry until a class is actually opened.
   */
  private async openActorScriptEditor(item: BrowserAssetItem): Promise<void> {
    try {
      const { ActorScriptEditor } = await import("@/editor/ActorScriptEditor");
      // Actor Script Details pickers (AIController StateTree/BehaviorTree/Blackboard,
      // MeshRenderer assets, etc.) should see manifest edits made outside the
      // current editor session without requiring a full browser refresh.
      this.editableAssets = await this.app.reloadEditableAssets();
      // Freshly scan project classes so a Game Mode's Default Pawn Class picker
      // lists the latest character/pawn Actor Scripts (incl. just-created ones).
      await this.refreshProjectActorClasses();
      const pawnClassRefs = this.projectActorClasses
        .filter((cls) => cls.parentClass === "character" || cls.parentClass === "pawn")
        .map((cls) => ({ path: cls.path, name: cls.name }));
      await ActorScriptEditor.open({
        path: item.path,
        label: item.label.replace(/\.actor\.json$/i, ""),
        behaviorScriptIds: getGameEditorCatalog().behaviorScriptIds,
        assetIds: this.editableAssets.map((asset) => asset.id),
        assets: this.editableAssets.map((asset) => ({
          id: asset.id,
          name: asset.displayName ?? asset.name,
          assetType: assetType(asset),
          path: assetPath(asset),
        })),
        pawnClassRefs,
        onStatus: (message, tone) => this.setStatus(message, tone),
        onBrowse: () => void this.revealContentAsset(item.path),
        onPlay: () => void this.playTest(),
      });
    } catch (error) {
      this.setStatus(
        `Could not open Actor Script editor: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /** Lazily builds the hidden file input the Import flow reuses. */
  private ensureImportInput(): HTMLInputElement {
    if (this.importInput) return this.importInput;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.basis,.hdr,.exr,.mp3,.wav,.ogg,.json";
    input.style.display = "none";
    input.addEventListener("change", () => void this.handleImportFiles());
    document.body.appendChild(input);
    this.importInput = input;
    return input;
  }

  /** Opens the OS file picker; selected files upload into `dir`. */
  private startImport(dir: string): void {
    this.reimportTarget = null;
    this.importTargetDir = dir;
    const input = this.ensureImportInput();
    input.multiple = true;
    input.accept = ".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.basis,.hdr,.exr,.mp3,.wav,.ogg,.json";
    input.value = ""; // allow re-selecting the same file twice in a row
    input.click();
  }

  /** Opens a model-only picker, then fully reloads to discard GLTF/material caches. */
  private startReimport(item: BrowserAssetItem): void {
    if (item.type === "file" || !isModelAssetType(item.type)) return;
    if (
      this.app.getHistoryState().canUndo &&
      !window.confirm(
        `Reimport "${item.label}"?\nThe editor will reload after replacing the model, so unsaved level changes will be lost.`,
      )
    ) {
      return;
    }
    this.reimportTarget = item;
    const input = this.ensureImportInput();
    input.multiple = false;
    input.accept = item.ext.toLowerCase() === "gltf" ? ".gltf" : ".glb";
    input.value = ""; // allow selecting the same Blender export again
    input.click();
  }

  /** Uploads the picked files into the target folder, then refreshes the tree. */
  private async handleImportFiles(): Promise<void> {
    const files = Array.from(this.importInput?.files ?? []);
    if (files.length === 0) return;
    const reimportTarget = this.reimportTarget;
    this.reimportTarget = null;
    if (reimportTarget) {
      const file = files[0];
      if (!file) return;
      await this.handleReimportFile(reimportTarget, file);
      return;
    }
    const dir = this.importTargetDir;
    let imported = 0;
    const errors: string[] = [];
    for (const file of files) {
      try {
        await importProjectAsset(dir, file);
        imported += 1;
      } catch (error) {
        errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (errors.length === 0) {
      this.setStatus(`Imported ${imported} file${imported === 1 ? "" : "s"}`, "success");
    } else {
      const tone = imported === 0 ? "error" : "warning";
      this.setStatus(`Imported ${imported}/${files.length}. ${errors[0]}`, tone);
    }
    // The import endpoint registers each asset in the manifest; re-read it so the
    // new entries resolve as editable (clears the "loose file" badge).
    if (imported > 0) {
      try {
        this.editableAssets = await this.app.reloadEditableAssets();
      } catch {
        // Keep the stale list; the tree refresh below still shows the new file.
      }
    }
    await this.refreshAssetTree({ quiet: false });
  }

  private async handleReimportFile(item: BrowserAssetItem, file: File): Promise<void> {
    try {
      await reimportProjectAsset(item.path, file);
      this.setStatus(`Reimported ${item.label}. Reloading editor...`, "success");
      window.location.reload();
    } catch (error) {
      this.setStatus(
        `Could not reimport ${item.label}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  private closeContextMenu = (): void => {
    this.contextMenuCleanup?.();
    this.contextMenuCleanup = null;
    this.contextMenu?.remove();
    this.contextMenu = null;
  };

  /**
   * Wires the top-left hamburger (main) menu. It reuses the shared context-menu
   * infrastructure for its dropdown of level-scoped actions, and the "World
   * Settings" entry opens a dedicated popover panel (moved out of the inspector
   * tab strip — see EDITOR_UI_REDESIGN_PLAN Faz 1 decision).
   */
  private bindMainMenu(): void {
    const menuButton = this.root.querySelector<HTMLButtonElement>("[data-main-menu-button]");
    menuButton?.addEventListener("click", (event) => {
      this.openContextMenu(event, [
        { label: "Save Layout", run: () => void this.save() },
        { label: "Open Level…", run: () => this.setContentDrawerOpen(true) },
        { separator: true },
        { label: "World Settings…", run: () => this.openWorldSettingsPopover() },
      ]);
    });
    this.root
      .querySelector<HTMLButtonElement>("[data-world-settings-close]")
      ?.addEventListener("click", () => this.closeWorldSettingsPopover());
  }

  /** Toggles the World Settings popover; renders fresh settings when opening. */
  private openWorldSettingsPopover(): void {
    const popover = this.root.querySelector<HTMLElement>("[data-world-settings-popover]");
    if (!popover) return;
    if (!popover.hidden) {
      this.closeWorldSettingsPopover();
      return;
    }
    this.renderWorldSettings(this.worldSettings ?? this.app.getWorldSettings());
    popover.hidden = false;
    const menuButton = this.root.querySelector<HTMLElement>("[data-main-menu-button]");
    const onPointerDown = (pointerEvent: Event): void => {
      const target = pointerEvent.target as Node;
      if (!popover.contains(target) && !menuButton?.contains(target)) {
        this.closeWorldSettingsPopover();
      }
    };
    const onKeyDown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.code === "Escape") this.closeWorldSettingsPopover();
    };
    // Defer so the opening click doesn't immediately dismiss the popover.
    window.setTimeout(() => document.addEventListener("pointerdown", onPointerDown), 0);
    document.addEventListener("keydown", onKeyDown);
    this.worldSettingsPopoverCleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }

  private closeWorldSettingsPopover = (): void => {
    const popover = this.root.querySelector<HTMLElement>("[data-world-settings-popover]");
    if (popover) popover.hidden = true;
    this.worldSettingsPopoverCleanup?.();
    this.worldSettingsPopoverCleanup = null;
  };

  private renderHistory(state: EditorHistoryState): void {
    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    const undoTip = state.undoLabel ? `Undo ${state.undoLabel}` : "Undo";
    const redoTip = state.redoLabel ? `Redo ${state.redoLabel}` : "Redo";
    this.undoButton.setAttribute("aria-label", undoTip);
    this.redoButton.setAttribute("aria-label", redoTip);
  }

  private setInspectorTab(tab: InspectorTab): void {
    this.inspectorTab = tab;
    this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((button) => {
      const active = button.dataset.inspectorTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    this.root.querySelectorAll<HTMLElement>("[data-inspector-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.inspectorPane !== tab;
    });
    // The Foliage tab IS the mode switch: its brush owns pointer input only while
    // the tab is active, so leaving the tab restores normal selection/gizmo input.
    this.app.setFoliageModeActive(tab === "foliage");
    this.app.setMeshPaintModeActive(tab === "meshPaint");
    if (tab === "foliage") this.renderFoliage();
    if (tab === "meshPaint") this.renderMeshPaint();
  }

  /** Scene-level Vertex Color authoring. Material Editor consumes these colors but never edits them. */
  private renderMeshPaint(): void {
    const settings = this.app.getMeshPaintToolSettings();
    this.meshPaintBody.innerHTML = `
      <div class="detail-section" data-inspector-section="vertex-color">
        <div class="detail-section-title">Vertex Paint</div>
        <label class="detail-row"><span>Tool</span>
          <select data-mesh-paint-tool><option value="paint" ${settings.tool === "paint" ? "selected" : ""}>Paint</option><option value="erase" ${settings.tool === "erase" ? "selected" : ""}>Erase</option></select>
        </label>
        <label class="detail-row detail-toggle"><span>Color View</span><input type="checkbox" ${settings.colorView !== "off" ? "checked" : ""} data-mesh-paint-color-view /></label>
        <label class="detail-row"><span>Brush Size</span><input type="number" min="0.01" step="0.1" value="${settings.brushSize}" data-mesh-paint-size /></label>
        <label class="detail-row"><span>Strength</span><input type="number" min="0" max="1" step="0.05" value="${settings.strength}" data-mesh-paint-strength /></label>
        <label class="detail-row"><span>Falloff</span><input type="number" min="0.01" max="32" step="0.1" value="${settings.falloff}" data-mesh-paint-falloff /></label>
        <label class="detail-row"><span>Flow</span><input type="number" min="0" max="1" step="0.05" value="${settings.flow}" data-mesh-paint-flow /></label>
        <label class="detail-row detail-toggle"><span>Ignore Backfaces</span><input type="checkbox" ${settings.ignoreBackfaces ? "checked" : ""} data-mesh-paint-ignore-backfaces /></label>
        <button type="button" data-mesh-paint-fill>Fill</button>
        <button type="button" data-mesh-paint-clear>Clear Selected Mesh</button>
      </div>`;

    const numberPatch = (selector: string, key: "brushSize" | "strength" | "falloff" | "flow"): void => {
      this.meshPaintBody.querySelector<HTMLInputElement>(selector)?.addEventListener("change", (event) => {
        this.app.setMeshPaintToolSettings({ [key]: Number((event.currentTarget as HTMLInputElement).value) });
      });
    };
    this.meshPaintBody.querySelector<HTMLSelectElement>("[data-mesh-paint-tool]")?.addEventListener("change", (event) => {
      this.app.setMeshPaintToolSettings({ tool: (event.currentTarget as HTMLSelectElement).value === "erase" ? "erase" : "paint" });
    });
    this.meshPaintBody.querySelector<HTMLInputElement>("[data-mesh-paint-color-view]")?.addEventListener("change", (event) => {
      this.app.setMeshPaintToolSettings({ colorView: (event.currentTarget as HTMLInputElement).checked ? "r" : "off" });
    });
    numberPatch("[data-mesh-paint-size]", "brushSize");
    numberPatch("[data-mesh-paint-strength]", "strength");
    numberPatch("[data-mesh-paint-falloff]", "falloff");
    numberPatch("[data-mesh-paint-flow]", "flow");
    this.meshPaintBody.querySelector<HTMLInputElement>("[data-mesh-paint-ignore-backfaces]")?.addEventListener("change", (event) => {
      this.app.setMeshPaintToolSettings({ ignoreBackfaces: (event.currentTarget as HTMLInputElement).checked });
    });
    this.meshPaintBody.querySelector<HTMLButtonElement>("[data-mesh-paint-fill]")?.addEventListener("click", () => {
      this.app.fillSelectedMeshPaint();
    });
    this.meshPaintBody.querySelector<HTMLButtonElement>("[data-mesh-paint-clear]")?.addEventListener("click", () => {
      this.app.clearSelectedMeshPaint();
    });
    this.decorateInspectorSections(this.meshPaintBody, "meshPaint");
  }

  private renderFoliage(): void {
    const foliageTypeIds = new Set(this.app.getFoliageTypeViews().map((type) => type.id));
    const availableTypeAssets = this.editableAssets
      .filter((asset) => asset.assetType === "foliageType" && !foliageTypeIds.has(asset.id))
      .map((asset) => ({ id: asset.id, name: asset.displayName ?? asset.id }));
    const staticMeshAssets = this.editableAssets
      .filter((asset) => asset.assetType === "staticMesh")
      .map((asset) => ({ id: asset.id, name: asset.displayName ?? asset.id }));
    renderFoliagePanel({
      body: this.foliageBody,
      settings: this.app.getFoliageToolSettings(),
      types: this.app.getFoliageTypeViews(),
      landscapeOptions: this.app.getLandscapeFoliageLandscapeViews(),
      landscapeRules: this.app.getLandscapeFoliageRuleViews(),
      selectionCount: this.app.getFoliageSelectionCount(),
      resourceUsage: this.app.getFoliageResourceUsage(),
      availableTypeAssets,
      staticMeshAssets,
      activeType: this.app.getActiveFoliageTypeDef(),
      apply: (patch) => {
        this.app.setFoliageToolSettings(patch);
      },
      setActiveType: (id) => {
        this.app.setFoliageToolSettings({ activeTypeId: id });
      },
      addType: (assetId) => {
        void this.app.addFoliageType(assetId);
      },
      removeType: (assetId) => this.app.removeFoliageType(assetId),
      createType: (name, meshAssetId) => {
        void this.createFoliageTypeAsset(name, meshAssetId);
      },
      deselectAll: () => this.app.deselectAllFoliage(),
      selectInvalid: () => this.app.selectInvalidFoliage(),
      reattachSelected: () => this.app.reattachSelectedFoliage(),
      removeSelected: () => this.app.removeSelectedFoliage(),
      updateType: (patch) => {
        const activeId = this.app.getFoliageToolSettings().activeTypeId;
        if (activeId) void this.app.updateFoliageType(activeId, patch);
      },
      reapply: () => this.app.reapplyFoliage(),
      addLandscapeRule: (rule) => this.app.addLandscapeFoliageRule(rule),
      updateLandscapeRule: (id, patch) => this.app.updateLandscapeFoliageRule(id, patch),
      removeLandscapeRule: (id) => this.app.removeLandscapeFoliageRule(id),
    });
    this.decorateInspectorSections(this.foliageBody, "foliage");
  }

  /** Writes a new `*.foliagetype.json` asset then adds it to the active foliage list. */
  private async createFoliageTypeAsset(name: string, meshAssetId: string): Promise<void> {
    const safeName = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Foliage";
    const path = `assets/foliage/${safeName}.foliagetype.json`;
    const body = createFoliageType(name, meshAssetId);
    try {
      const response = await fetch("/__save-foliage-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, foliageType: body }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        registeredId?: string | null;
      };
      if (!response.ok || !result.ok) {
        this.setStatus(result.error ?? `Foliage type save failed: HTTP ${response.status}`, "error");
        return;
      }
      await this.refreshAssetTree();
      if (!result.registeredId) {
        this.setStatus(
          "Foliage type saved but could not be registered in the manifest.",
          "warning",
        );
        return;
      }
      // Register the def we just built directly (id = its manifest id), so painting
      // works immediately without depending on the SceneApp manifest cache refresh.
      // The sidecar stores this manifest id, so it re-resolves on reload.
      await this.app.registerLoadedFoliageType(result.registeredId, body);
      this.setStatus(`Created foliage type ${name}.`, "success");
    } catch (error) {
      this.setStatus(
        `Foliage type save endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  private renderWorldSettings(settings: EditorWorldSettings): void {
    this.worldSettings = settings;
    renderWorldSettingsPanel({
      body: this.worldSettingsBody,
      settings,
      projectGameModes: this.projectGameModes,
      setWorldSettings: (values) => this.app.setWorldSettings(values),
    });
  }

  private specialActorDetailsOptions(selection: EditableSelection): SpecialActorDetailsOptions {
    return {
      body: this.detailsBody,
      selection,
      editableAssets: this.editableAssets,
      targetPoints: this.app.getTargetPointReferences(),
      setDetailsScale: (scale) => {
        this.detailsScale = scale;
      },
      beginDetailsEdit: () => this.beginDetailsEdit(),
      applyDetails: () => this.applyDetails(),
      applyScaleInput: (input) => this.applyScaleInput(input),
      commitDetailsEdit: () => this.commitDetailsEdit(),
      setSelectionScaleLocked: (locked) => this.app.setSelectionScaleLocked(locked),
      renameSceneObject: (id, name) => this.app.renameSceneObject(id, name),
      handleDetailToggle: (toggle, checked) => this.handleDetailToggle(toggle, checked),
      setSelectedLightSettings: (values) => this.app.setSelectedLightSettings(values),
      setSelectedReflectionPlane: (patch) => this.app.setSelectedReflectionPlane(patch),
      setSelectedReflectiveSurface: (patch) => this.app.setSelectedReflectiveSurface(patch),
      setSelectedBlockingVolume: (patch) => this.app.setSelectedBlockingVolume(patch),
      setSelectedAiNavigationVolume: (patch) => this.app.setSelectedAiNavigationVolume(patch),
      setSelectedTargetPoint: (patch) => this.app.setSelectedTargetPoint(patch),
      setSelectedSpline: (patch) => this.app.setSelectedSpline(patch),
      getSelectedSplineGenerators: () => this.app.getSelectedSplineGenerators(),
      getSelectedSplineGeneratorDiagnostics: () => this.app.getSelectedSplineGeneratorDiagnostics(),
      addSelectedSplineInstanceGenerator: () => this.app.addSelectedSplineInstanceGenerator(),
      addSelectedSplineRigidSegmentGenerator: () => this.app.addSelectedSplineRigidSegmentGenerator(),
      addSelectedSplineDeformMeshGenerator: () => this.app.addSelectedSplineDeformMeshGenerator(),
      removeSelectedSplineGenerator: (generatorId) => this.app.removeSelectedSplineGenerator(generatorId),
      setSelectedSplineInstanceGenerator: (generatorId, patch) =>
        this.app.setSelectedSplineInstanceGenerator(generatorId, patch),
      setSelectedSplineRigidSegmentGenerator: (generatorId, patch) =>
        this.app.setSelectedSplineRigidSegmentGenerator(generatorId, patch),
      setSelectedSplineDeformMeshGenerator: (generatorId, patch) =>
        this.app.setSelectedSplineDeformMeshGenerator(generatorId, patch),
      getSelectedSplinePoints: () => this.app.getSelectedSplinePoints(),
      getActiveSplinePointId: () => this.app.getActiveSplinePointId(),
      selectSplinePoint: (pointId) => this.app.selectSplinePoint(pointId),
      addSelectedSplinePoint: () => this.app.addSelectedSplinePoint(),
      deleteSelectedSplinePoint: (pointId) => this.app.deleteSelectedSplinePoint(pointId),
      splitSelectedSplineSegment: (segmentIndex) => this.app.splitSelectedSplineSegment(segmentIndex),
      setSelectedSplinePoint: (pointId, patch) => this.app.setSelectedSplinePoint(pointId, patch),
      setSelectedSplinePointTangentsLinked: (pointId, linked) =>
        this.app.setSelectedSplinePointTangentsLinked(pointId, linked),
      setSelectedReflectionCapture: (patch) => this.app.setSelectedReflectionCapture(patch),
      setSelectedLandscape: (patch) => this.app.setSelectedLandscape(patch),
      getLandscapeSculptSettings: () => this.app.getLandscapeSculptSettings(),
      setLandscapeSculptSettings: (patch) => this.app.setLandscapeSculptSettings(patch),
      fillSelectedLandscapeLayer: (layerId) => this.app.fillSelectedLandscapeLayer(layerId),
      getSelectedLandscapeLayers: () => this.app.getSelectedLandscapeLayers(),
      getSelectedLandscapeSplines: () => this.app.getSelectedLandscapeSplines(),
      createSelectedLandscapeSpline: () => this.app.createSelectedLandscapeSpline(),
      deleteSelectedLandscapeSpline: (splineId) => this.app.deleteSelectedLandscapeSpline(splineId),
      closeSelectedLandscapeSpline: () => this.app.closeSelectedLandscapeSpline(),
      setSelectedLandscapeSplineSmooth: (smooth) => this.app.setSelectedLandscapeSplineSmooth(smooth),
      getSelectedLandscapeSplinePoints: () => this.app.getSelectedLandscapeSplinePoints(),
      setSelectedLandscapeSplinePointPosition: (pointId, position) =>
        this.app.setSelectedLandscapeSplinePointPosition(pointId, position),
      deleteSelectedLandscapeSplinePoint: (pointId) => this.app.deleteSelectedLandscapeSplinePoint(pointId),
      setSelectedLandscapeSplinePointShape: (pointId, patch) =>
        this.app.setSelectedLandscapeSplinePointShape(pointId, patch),
      getSelectedLandscapeSplineSegments: () => this.app.getSelectedLandscapeSplineSegments(),
      splitSelectedLandscapeSplineSegment: (segmentId) =>
        this.app.splitSelectedLandscapeSplineSegment(segmentId),
      setSelectedLandscapeSplineSegment: (segmentId, patch) =>
        this.app.setSelectedLandscapeSplineSegment(segmentId, patch),
      applySelectedLandscapeSplineDeform: () => this.app.applySelectedLandscapeSplineDeform(),
      applySelectedLandscapeSplinePaint: () => this.app.applySelectedLandscapeSplinePaint(),
      setSelectedLandscapeLayerMaterial: (layerId, materialId) =>
        this.app.setSelectedLandscapeLayerMaterial(layerId, materialId),
      importSelectedLandscapeHeightmap: (rgba, width, height, heightRange) =>
        this.app.importSelectedLandscapeHeightmap(rgba, width, height, heightRange),
      exportSelectedLandscapeHeightmap: () => this.app.exportSelectedLandscapeHeightmap(),
      getSelectedLandscapeResolution: () => this.app.getSelectedLandscapeResolution(),
      resampleSelectedLandscape: (preset) => this.app.resampleSelectedLandscape(preset),
      setSelectedLandscapeWorldSize: (worldSize) => this.app.setSelectedLandscapeWorldSize(worldSize),
      getSelectedLandscapeImportHeight: () => this.app.getSelectedLandscapeImportHeight(),
      setSelectedWorldWidget: (patch) => this.app.setSelectedWorldWidget(patch),
      isSelectedReflectionCaptureBakeStale: () =>
        this.app.isSelectedReflectionCaptureBakeStale(),
      recaptureSelectedReflectionCapture: () => this.app.recaptureSelectedReflectionCapture(),
      recaptureAllReflectionCaptures: () => this.app.recaptureAllReflectionCaptures(),
      rebakeAiNavigation: () => {
        // Make sure the overlay is visible so the rebake is seen, keeping the
        // toolbar Show flag in sync (bindShowFlag only tracks its own clicks).
        if (!this.app.getShowAiNavigation()) {
          this.app.setShowAiNavigation(true);
          this.root
            .querySelector<HTMLButtonElement>('[data-show-flag="ai-navigation"]')
            ?.classList.add("active");
        }
        this.app.rebakeAiNavigation();
      },
    };
  }

  private environmentDetailsOptions(selection: EditableSelection): EnvironmentDetailsOptions {
    return {
      body: this.detailsBody,
      selection,
      setDetailsScale: (scale) => {
        this.detailsScale = scale;
      },
      setSkyAtmosphere: (patch, label) => this.app.setSkyAtmosphere(patch, label),
      setHeightFog: (patch, label) => this.app.setHeightFog(patch, label),
      setCloudLayer: (patch, label) => this.app.setCloudLayer(patch, label),
      setPostProcess: (patch, label) => this.app.setPostProcess(patch, label),
      recaptureSkyLightCapture: () => this.app.recaptureSkyLightCapture(),
    };
  }

  private renderDetails(selection: EditableSelection | null): void {
    if (!selection) {
      this.detailsScale = null;
      this.detailsBody.innerHTML = `
        <div class="empty-details">
          <strong>No selection</strong>
          <span>Viewport</span>
        </div>
      `;
      return;
    }
    if (selection.kind === "light") {
      renderLightDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "sky" && selection.sky) {
      renderSkyDetails(this.environmentDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "fog" && selection.fog) {
      renderFogDetails(this.environmentDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "cloud" && selection.cloud) {
      renderCloudDetails(this.environmentDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "post" && selection.post) {
      renderPostDetails(this.environmentDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "reflectionPlane") {
      renderReflectionPlaneDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "reflectiveSurface" && selection.reflectiveSurface) {
      renderReflectiveSurfaceDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "blockingVolume" && selection.blockingVolume) {
      renderBlockingVolumeDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "aiNavigationVolume" && selection.aiNavigationVolume) {
      renderAiNavigationVolumeDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "targetPoint" && selection.targetPoint) {
      renderTargetPointDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "spline" && selection.spline) {
      renderSplineDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "reflectionCapture" && selection.reflectionCapture) {
      renderReflectionCaptureDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "worldWidget" && selection.worldWidget) {
      renderWorldWidgetDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }
    if (selection.kind === "landscape") {
      renderLandscapeDetails(this.specialActorDetailsOptions(selection));
      this.finalizeDetailsRender(selection);
      return;
    }

    this.detailsScale = [...selection.scale];
    this.detailsBody.innerHTML = renderInstanceDetails({
      selection,
      pivotEditActive: this.app.isPivotEditMode(),
      sections: {
        material: renderMaterialSection(selection, this.editableAssets),
        animation: this.renderCharacterAnimationSection(selection),
        navigation: renderNavigationSection(selection),
        collision: renderCollisionSection(selection),
        physics: renderPhysicsSection({
          selection,
          locked: selection.locked,
          complexAsSimple: this.app.assetCollisionComplexity(selection.assetId) === "complexAsSimple",
        }),
        components:
          renderComponentsSection(selection, this.editableAssets) + this.renderActorPatrolRouteSection(selection),
        metadata: renderMetadataSections(selection, this.metadataSchema),
      },
    });

    bindInstanceDetails({
      body: this.detailsBody,
      selection,
      beginDetailsEdit: () => this.beginDetailsEdit(),
      applyDetails: () => this.applyDetails(),
      applyScaleInput: (input) => this.applyScaleInput(input),
      commitDetailsEdit: () => this.commitDetailsEdit(),
      setSelectionScaleLocked: (locked) => this.app.setSelectionScaleLocked(locked),
      commitPivotInput: () => this.commitPivotInput(),
      applySelectionPivotPreset: (preset) => this.app.applySelectionPivotPreset(preset),
      togglePivotEditMode: () => this.app.togglePivotEditMode(),
      renameSceneObject: (id, name) => this.app.renameSceneObject(id, name),
      handleDetailAction: (action) => this.handleDetailAction(action),
      handleDetailToggle: (toggle, checked) => this.handleDetailToggle(toggle, checked),
      setSelectionCollisionPreset: (preset) => this.app.setSelectionCollisionPreset(preset),
      bindNavigationInputs: () =>
        bindNavigationInputs(
          this.detailsBody,
          (role) => this.app.setSelectionNavigationRole(role),
        ),
      bindCollisionOverrideInputs: (currentSelection) =>
        bindCollisionOverrideInputs({
          body: this.detailsBody,
          selection: currentSelection,
          currentSelection: () => this.selected,
          setSelectionCollisionOverrides: (patch) =>
            this.app.setSelectionCollisionOverrides(patch),
        }),
      setSelectionMaterialSlot: (assetId) => this.app.setSelectionMaterialSlot(assetId),
      setSelectionAnimation: (clip) => this.app.setSelectionAnimation(clip),
      bindPhysicsInputs: () =>
        bindPhysicsInputs({
          body: this.detailsBody,
          setSelectionPhysics: (patch) => this.app.setSelectionPhysics(patch),
        }),
      bindComponentsInputs: () =>
        bindComponentsInputs({
          body: this.detailsBody,
          editableAssets: this.editableAssets,
          currentSelection: () => this.selected,
          setSelectionAudio: (audio) => this.app.setSelectionAudio(audio),
          setSelectionBehavior: (behavior) => this.app.setSelectionBehavior(behavior),
          setSelectionParticle: (particle) => this.app.setSelectionParticle(particle),
          setSelectionInteraction: (interaction) => this.app.setSelectionInteraction(interaction),
          setSelectionMovingPlatform: (platform) => this.app.setSelectionMovingPlatform(platform),
        }),
      bindActorPatrolRouteInputs: () => this.bindActorPatrolRouteInputs(selection),
      bindMetadataInputs: () =>
        bindMetadataInputs({
          body: this.detailsBody,
          schema: this.metadataSchema,
          currentSelection: () => this.selected,
          setSelectionMetadata: (key, value, label) =>
            this.app.setSelectionMetadata(key, value, label),
        }),
    });
    this.finalizeDetailsRender(selection);
  }

  /** Applies the shared Phase 4 Details chrome after a concrete panel has rendered. */
  private finalizeDetailsRender(selection: EditableSelection): void {
    this.detailsBody.querySelector(".detail-heading")?.remove();
    this.decorateDetailSections(selection);
    this.decorateDetailsSectionsToggle(selection);
    if (selection.kind === "instance") void this.renderDetailsMaterialThumbnail(selection);
  }

  private decorateDetailSections(selection: EditableSelection): void {
    this.decorateCollapsibleSections(this.detailsBody, (section, label) =>
      this.detailSectionStorageKey(selection, section.dataset.detailSection ?? label),
      () => this.updateDetailsSectionsToggle(),
    );
  }

  /** Applies the Details accordion chrome to the mode-specific inspector panes. */
  private decorateInspectorSections(body: HTMLElement, mode: "meshPaint" | "foliage"): void {
    this.decorateCollapsibleSections(body, (section, label) => {
      const id = section.dataset.inspectorSection ?? section.dataset.landscapeRule ?? label;
      return `forge.editor.${mode}.section.${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    });
  }

  /** Wraps each direct section body in an accessible, persisted disclosure header. */
  private decorateCollapsibleSections(
    container: HTMLElement,
    storageKeyFor: (section: HTMLElement, label: string) => string,
    onCollapsedChange?: () => void,
  ): void {
    container.querySelectorAll<HTMLElement>(".detail-section").forEach((section, index) => {
      const title = section.querySelector<HTMLElement>(":scope > .detail-section-title");
      if (!title || section.dataset.inspectorSectionDecorated === "true") return;
      const label = title.textContent?.trim() || `Section ${index + 1}`;
      const key = storageKeyFor(section, label);
      const collapsed = this.readDetailSectionCollapsed(key, label);
      const sectionBody = document.createElement("div");
      sectionBody.className = "detail-section-body";
      for (const child of [...section.childNodes]) if (child !== title) sectionBody.append(child);
      const heading = document.createElement("div");
      heading.className = "detail-section-heading";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "detail-section-toggle";
      toggle.innerHTML = `<span class="detail-section-chevron" aria-hidden="true">${UI_ICONS.chevronDown}</span><span>${escapeHtml(label)}</span>`;
      heading.append(toggle);
      title.replaceWith(heading);
      section.append(sectionBody);
      section.dataset.inspectorSectionDecorated = "true";
      const setCollapsed = (next: boolean): void => {
        this.setCollapsibleSectionCollapsed(section, toggle, key, next);
        onCollapsedChange?.();
      };
      setCollapsed(collapsed);
      toggle.addEventListener("click", () => setCollapsed(!section.classList.contains("collapsed")));
    });
  }

  private decorateDetailsSectionsToggle(selection: EditableSelection): void {
    const nameInput = this.detailsBody.querySelector<HTMLInputElement>("[data-detail-name]");
    const row = nameInput?.closest<HTMLElement>(".detail-row");
    if (!row || row.querySelector("[data-details-sections-toggle]")) return;
    row.classList.add("detail-row--name");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "detail-sections-toggle";
    toggle.dataset.detailsSectionsToggle = "true";
    toggle.addEventListener("click", () => {
      const sections = [...this.detailsBody.querySelectorAll<HTMLElement>(".detail-section[data-inspector-section-decorated]")];
      this.setAllDetailSectionsCollapsed(selection, sections.some((section) => !section.classList.contains("collapsed")));
    });
    row.append(toggle);
    this.updateDetailsSectionsToggle();
  }

  private updateDetailsSectionsToggle(): void {
    const toggle = this.detailsBody.querySelector<HTMLButtonElement>("[data-details-sections-toggle]");
    if (!toggle) return;
    const sections = [...this.detailsBody.querySelectorAll<HTMLElement>(".detail-section[data-inspector-section-decorated]")];
    const allCollapsed = sections.length > 0 && sections.every((section) => section.classList.contains("collapsed"));
    toggle.hidden = sections.length === 0;
    toggle.title = allCollapsed ? "Expand all sections" : "Collapse all sections";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-pressed", String(allCollapsed));
    toggle.innerHTML = allCollapsed ? UI_ICONS.chevronDown : UI_ICONS.chevronUp;
  }

  private detailSectionStorageKey(selection: EditableSelection, section: string): string {
    return `forge.editor.details.section.${selection.kind}.${selection.assetId}.${section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  private readDetailSectionCollapsed(key: string, label: string): boolean {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? /^advanced\b/i.test(label) : saved === "collapsed";
    } catch {
      return /^advanced\b/i.test(label);
    }
  }

  private setDetailSectionCollapsed(section: HTMLElement, toggle: HTMLButtonElement, key: string, collapsed: boolean): void {
    this.setCollapsibleSectionCollapsed(section, toggle, key, collapsed);
    this.updateDetailsSectionsToggle();
  }

  private setCollapsibleSectionCollapsed(
    section: HTMLElement,
    toggle: HTMLButtonElement,
    key: string,
    collapsed: boolean,
  ): void {
    section.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    try {
      window.localStorage.setItem(key, collapsed ? "collapsed" : "expanded");
    } catch {
      // Storage can be disabled without affecting Details interactions.
    }
  }

  private setAllDetailSectionsCollapsed(selection: EditableSelection, collapsed: boolean): void {
    this.detailsBody.querySelectorAll<HTMLElement>(".detail-section[data-inspector-section-decorated]").forEach((section) => {
      const label = section.querySelector(".detail-section-toggle span:last-child")?.textContent?.trim() || "section";
      const toggle = section.querySelector<HTMLButtonElement>(".detail-section-toggle");
      if (toggle) this.setDetailSectionCollapsed(section, toggle, this.detailSectionStorageKey(selection, section.dataset.detailSection ?? label), collapsed);
    });
    this.updateDetailsSectionsToggle();
  }

  private async renderDetailsMaterialThumbnail(selection: EditableSelection): Promise<void> {
    const thumb = this.detailsBody.querySelector<HTMLElement>("[data-material-thumbnail]");
    if (!thumb) return;
    if (!selection.materialSlot) {
      thumb.textContent = "M";
      thumb.title = "No material assigned";
      return;
    }
    try {
      const preview = await this.resolveMaterialPreviewById(selection.materialSlot);
      if (!preview || !thumb.isConnected) return;
      const imageUrl = await this.thumbnailRenderer.renderMaterial(selection.materialSlot, preview);
      if (!thumb.isConnected) return;
      const image = document.createElement("img");
      image.alt = "";
      image.src = imageUrl;
      thumb.replaceChildren(image);
    } catch {
      if (thumb.isConnected) thumb.title = "Material preview unavailable";
    }
  }

  /**
   * The character (directly-placed skeletal mesh) "Animation" section: a dropdown
   * of Play-mode clips read from the asset's `*.skeleton.json` sidecar. Clips load
   * lazily into {@link characterClipCache}; while loading, a placeholder shows and
   * the panel re-renders once the fetch resolves. An unknown/authored value is
   * preserved so it round-trips. Empty for any non-character selection.
   */
  private renderCharacterAnimationSection(selection: EditableSelection): string {
    if (selection.kind !== "character") return "";
    const assetId = selection.assetId;
    const current = selection.animation ?? "";
    const clips = this.characterClipCache.get(assetId);
    if (!clips) {
      void this.loadCharacterClips(assetId);
      return `
        <div class="detail-section">
          <div class="detail-section-title">Animation</div>
          <div class="detail-row"><span class="detail-value">Loading clips…</span></div>
        </div>`;
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
        ? `<div class="detail-row"><span class="detail-value">This mesh defines no clips yet.</span></div>`
        : "";
    return `
      <div class="detail-section">
        <div class="detail-section-title">Animation</div>
        <label class="detail-row">
          <span>Clip (Play)</span>
          <select data-animation-clip>${options}</select>
        </label>
        ${emptyNote}
      </div>`;
  }

  /** Loads (once) a skeletal asset's clip names, caches them, and re-renders the panel. */
  private async loadCharacterClips(assetId: string): Promise<void> {
    if (this.characterClipCache.has(assetId) || this.characterClipLoading.has(assetId)) return;
    this.characterClipLoading.add(assetId);
    let clips: readonly string[] = [];
    try {
      clips = await this.app.getSkeletonClipNames(assetId);
    } catch {
      clips = [];
    }
    this.characterClipLoading.delete(assetId);
    this.characterClipCache.set(assetId, clips);
    // Re-render only if this asset is still the active character selection.
    if (this.selected?.kind === "character" && this.selected.assetId === assetId) {
      this.renderDetails(this.selected);
    }
  }

  /** First `*.ui.json` widget asset id (for a new World Widget), or "" when none. */
  private firstUiWidgetAssetId(): string {
    const widget = this.editableAssets.find(
      (asset) => assetType(asset) === "ui" && assetPath(asset).toLowerCase().endsWith(".ui.json"),
    );
    return widget?.id ?? "";
  }

  private handleDetailAction(action: string): void {
    switch (action) {
      case "reset":
        this.resetSelectedTransform();
        break;
      case "copy":
        this.copySelectedTransform();
        break;
      case "paste":
        this.pasteSelectedTransform();
        break;
      case "snap-floor":
        this.app.snapSelectedToFloor();
        break;
      case "snap-wall":
        this.app.snapSelectedToWall();
        break;
    }
  }

  private handleDetailToggle(toggle: string, checked: boolean): void {
    if (!this.selected) return;
    switch (toggle) {
      case "locked":
        this.app.setSceneObjectLocked(this.selected.id, checked);
        break;
      case "castShadow":
        this.app.setSelectionCastShadow(checked);
        break;
      case "collision":
        this.app.setSelectionCollision(checked);
        break;
      case "simulatePhysics":
        this.app.setSelectionSimulatePhysics(checked);
        break;
    }
  }

  /** Resets rotation to 0 and scale to 1, leaving position untouched. */
  private resetSelectedTransform(): void {
    const before = this.app.captureSelectedTransforms();
    if (before.length === 0) return;
    this.app.updateSelectedTransforms({ rotation: [0, 0, 0], scale: [1, 1, 1] });
    this.app.commitSelectedTransforms(before, "Reset transform");
  }

  private copySelectedTransform(): void {
    const transform = this.app.captureSelectedTransform();
    if (!transform) return;
    this.transformClipboard = transform;
    this.setStatus("Transform copied.", "info");
  }

  private pasteSelectedTransform(): void {
    const clip = this.transformClipboard;
    if (!clip) {
      this.setStatus("Transform clipboard is empty.", "warning");
      return;
    }
    const before = this.app.captureSelectedTransforms();
    if (before.length === 0) return;
    this.app.updateSelectedTransforms({
      position: [...clip.position],
      rotation: [...clip.rotation],
      scale: [...clip.scale],
    });
    this.app.commitSelectedTransforms(before, "Paste transform");
  }

  /**
   * Keeps the scale inputs consistent before applying: with the lock on, editing
   * one axis scales the others by the same ratio (Unreal-style proportional lock).
   */
  private applyScaleInput(input: HTMLInputElement): void {
    if (!this.detailsScale) return;
    const index = Number(input.dataset.axis);
    if (!Number.isInteger(index) || index < 0 || index > 2) return;

    const next = Math.max(0.01, Number(input.value) || 0);
    const previous = this.detailsScale;

    if (this.selected?.scaleLocked) {
      const prevAxis = previous[index] ?? 0;
      const ratio = prevAxis !== 0 ? next / prevAxis : 0;
      this.detailsScale =
        ratio > 0
          ? [previous[0] * ratio, previous[1] * ratio, previous[2] * ratio]
          : [next, next, next];
    } else {
      const updated: [number, number, number] = [...previous];
      updated[index] = next;
      this.detailsScale = updated;
    }

    this.detailsScale = this.detailsScale.map((value) =>
      Number(value.toFixed(3)),
    ) as [number, number, number];

    // Reflect the recomputed siblings back into the fields the user is not typing in.
    this.detailsBody
      .querySelectorAll<HTMLInputElement>('input[data-detail="scale"]')
      .forEach((field) => {
        const fieldIndex = Number(field.dataset.axis);
        if (fieldIndex !== index && this.detailsScale) {
          field.value = String(this.detailsScale[fieldIndex]);
        }
      });
  }

  private beginDetailsEdit(): void {
    this.detailsBaseline ??= this.app.captureSelectedTransforms();
  }

  private commitDetailsEdit(): void {
    this.beginDetailsEdit();
    this.applyDetails();
    this.app.commitSelectedTransforms(this.detailsBaseline ?? []);
    this.detailsBaseline = null;
  }

  private applyDetails(): void {
    if (!this.selected || !this.detailsScale) return;
    const value = (name: string): number => {
      const input = this.detailsBody.querySelector<HTMLInputElement>(
        `input[name="${name}"]`,
      );
      return Number(input?.value ?? 0);
    };
    this.app.updateSelectedTransforms(
      {
        position: [value("px"), value("py"), value("pz")],
        rotation: [value("rx"), value("ry"), value("rz")],
        scale: [
          Math.max(0.01, this.detailsScale[0]),
          Math.max(0.01, this.detailsScale[1]),
          Math.max(0.01, this.detailsScale[2]),
        ],
      },
      {
        notifySelection: false,
      },
    );
  }

  /** Reads the three pivot fields and applies them (own undo step, not the transform baseline). */
  private commitPivotInput(): void {
    const value = (axis: number): number => {
      const input = this.detailsBody.querySelector<HTMLInputElement>(
        `input[data-pivot][data-axis="${axis}"]`,
      );
      return Number(input?.value ?? 0);
    };
    this.app.setSelectionPivot([value(0), value(1), value(2)]);
  }

  private async save(): Promise<void> {
    try {
      await this.app.saveLayout();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  private syncSnapControls(settings: EditorSnapSettings): void {
    this.setSnapSelect("move", settings.move);
    this.setSnapSelect("rotate", settings.rotate);
    this.setSnapSelect("scale", settings.scale);
    this.setSnapToggle("move", settings.moveEnabled);
    this.setSnapToggle("rotate", settings.rotateEnabled);
    this.setSnapToggle("scale", settings.scaleEnabled);
  }

  private setSnapSelect(key: "move" | "rotate" | "scale", value: number): void {
    const select = this.root.querySelector<HTMLSelectElement>(`select[data-snap="${key}"]`);
    if (!select) return;
    const textValue = String(value);
    if (![...select.options].some((option) => option.value === textValue)) {
      const option = document.createElement("option");
      option.value = textValue;
      option.textContent = textValue;
      select.append(option);
    }
    select.value = textValue;
  }

  private setSnapToggle(key: "move" | "rotate" | "scale", checked: boolean): void {
    const input = this.root.querySelector<HTMLInputElement>(`input[data-snap-toggle="${key}"]`);
    if (input) input.checked = checked;
  }

  private setStatus(
    message: string,
    tone: "info" | "success" | "warning" | "error" = "info",
  ): void {
    this.statusText.textContent = message;
    this.statusText.dataset.tone = tone;
  }
}

function requireElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing editor element: ${selector}`);
  return element as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isDevelopmentContentPath(path: string): boolean {
  const normalizedPath = normalizeProjectPath(path).toLocaleLowerCase();
  const normalized = normalizedPath.startsWith("public/assets/")
    ? normalizedPath.slice("public/".length)
    : normalizedPath;
  return normalized === "assets/developmentcontent" || normalized.startsWith("assets/developmentcontent/");
}

function isSameOrDescendantContentPath(path: string, folder: string): boolean {
  const normalizedPath = normalizeProjectPath(path);
  const normalizedFolder = normalizeProjectPath(folder);
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function replaceContentPathPrefix(path: string, fromFolder: string, toFolder: string): string {
  const normalizedPath = normalizeProjectPath(path);
  const normalizedFrom = normalizeProjectPath(fromFolder);
  const normalizedTo = normalizeProjectPath(toFolder);
  if (normalizedPath === normalizedFrom) return normalizedTo;
  if (!normalizedPath.startsWith(`${normalizedFrom}/`)) return normalizedPath;
  return `${normalizedTo}/${normalizedPath.slice(normalizedFrom.length + 1)}`;
}

function parentContentPath(path: string): string | null {
  const normalized = normalizeProjectPath(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return null;
  return normalized.slice(0, slash);
}

function formatShapeTypeLabel(type: ShapePrimitiveType): string {
  switch (type) {
    case "cube":
      return "Cube";
    case "sphere":
      return "Sphere";
    case "cylinder":
      return "Cylinder";
    case "cone":
      return "Cone";
    case "plane":
      return "Plane";
  }
}

function formatLightTypeLabel(type: "directional" | "point" | "spot"): string {
  if (type === "directional") return "Directional Light";
  if (type === "point") return "Point Light";
  return "Spot Light";
}


function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
