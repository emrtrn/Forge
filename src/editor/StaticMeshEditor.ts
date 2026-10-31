/**
 * Static Mesh editor — an Unreal-style asset editor opened from the Content
 * Browser (double-click a model). It renders the model on a grid with an orbit
 * camera, exposes a top "Collision" toolbar, and a Details panel with the
 * asset-level Collision section (presets, complexity, simple collision
 * primitives). Collision setup is persisted to a `*.collision.json` sidecar.
 *
 * Editor-only: this module lives behind the dynamic `?editor` import so it never
 * ships in the game build.
 */
import {
  Box3,
  BoxGeometry,
  Float32BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Spherical,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import {
  COLLISION_COMPLEXITY_VALUES,
  COLLISION_PRESET_IDS,
  DEFAULT_NAVIGATION_ROLE,
  NAVIGATION_ROLE_VALUES,
  PHYSICAL_MATERIAL_IDS,
  defaultAssetCollisionDef,
  type AssetCollisionDef,
  type CollisionComplexity,
  type CollisionPresetId,
  type CollisionPrimitive,
  type CollisionPrimitiveShape,
  type NavigationRole,
} from "@engine/scene/collision";
import type { Vec3 } from "@engine/scene/layout";
import { projectFileUrl } from "@/project/ProjectSystem";
import { OrbitViewportCamera, createAssetViewportRig } from "@/editor/assetViewportCamera";
import { loadAssetCollision, saveAssetCollision } from "@/editor/assetCollisionStore";
import {
  applyAssetUvwMapping,
  defaultAssetUvw,
  loadAssetUvw,
  restoreAssetUvs,
  saveAssetUvw,
  type AssetUvwDef,
  type UvwMapType,
} from "@/editor/assetUvwStore";
import {
  applyMaterialSlotOverrides,
  assignedMaterialSlotIds,
  collectAssetMaterialElements,
  defaultAssetMaterialSlots,
  loadAssetMaterialSlots,
  saveAssetMaterialSlots,
  type AssetMaterialElement,
  type AssetMaterialSlotsDef,
} from "@/editor/assetMaterialSlotsStore";
import {
  createEmptyAssetVertexColors,
  loadAssetVertexColors,
  saveAssetVertexColors,
  upsertAssetVertexColorMesh,
  type AssetVertexColorsDef,
} from "@/editor/assetVertexColorsStore";
import type { AssetManifest, AssetRecord } from "@engine/assets/manifest";
import { loadForgeMaterial } from "@/scene/materialAssets";
import { createForgeGltfLoader } from "@engine/render-three/gltfLoader";
import { repairMeshPaintTopology } from "@engine/scene/meshPaint";

export interface StaticMeshEditorOptions {
  /** Public-relative path to the model file (e.g. `assets/props/chair.glb`). */
  modelPath: string;
  /** Manifest asset id for the opened mesh. */
  assetId?: string;
  /** Display name shown in the editor header / tab. */
  label: string;
  /** Manifest assets used by the material slot dropdown. */
  assets?: Array<{
    id: string;
    name: string;
    assetType: string;
    path: string;
  }>;
  /** Optional status sink (surfaces to the host editor's status bar). */
  onStatus?: (message: string, tone?: "info" | "warning" | "error") => void;
  onMaterialSlotsSaved?: (assetId: string) => void;
  onAssetUvwSaved?: (assetId: string) => void;
  onCollisionSaved?: (assetId: string) => void;
}

const PRESET_LABELS: Record<CollisionPresetId, string> = {
  noCollision: "No Collision",
  blockAll: "Block All",
  overlapAll: "Overlap All",
  blockAllDynamic: "Block All Dynamic",
  overlapAllDynamic: "Overlap All Dynamic",
  pawn: "Pawn",
  physicsActor: "Physics Actor",
  trigger: "Trigger",
  custom: "Custom…",
};

const COMPLEXITY_LABELS: Record<CollisionComplexity, string> = {
  projectDefault: "Project Default",
  simpleAndComplex: "Simple And Complex",
  simpleAsComplex: "Use Simple Collision As Complex",
  complexAsSimple: "Use Complex Collision As Simple",
};

const NAVIGATION_ROLE_LABELS: Record<NavigationRole, string> = {
  auto: "Auto",
  walkable: "Walkable Surface",
  obstacleOnly: "Obstacle Only",
  ignored: "Ignored",
};

const WIRE_COLOR = 0x49e6a2;
const WIRE_SELECTED_COLOR = 0xffb648;
const COMPLEX_WIRE_COLOR = 0x7ac7ff;
const UVW_WIRE_COLOR = 0x7fb8ff;
const UVW_WIRE_SELECTED_COLOR = 0xffd166;

type GizmoMode = "select" | "translate" | "rotate" | "scale";
type ActiveTarget = "collision" | "uvw" | null;
type KdopKind = "10DOP-X" | "10DOP-Y" | "10DOP-Z" | "18DOP" | "26DOP";

const UVW_LABELS: Record<UvwMapType, string> = {
  planar: "Planar",
  box: "Box",
  sphere: "Sphere",
  cylinder: "Cylinder",
};

/**
 * A collision-primitive overlay. The geometry is built at unit size so the
 * `root` group's transform maps 1:1 to the primitive (position=center,
 * rotation=rotation, scale=size) — which lets the transform gizmo drive it
 * directly. `pickMesh` is an invisible solid used for viewport raycast picking.
 */
interface PrimitiveOverlay {
  root: Group;
  wire: LineSegments;
  pickMesh: Mesh;
  solidGeometry: BufferGeometry;
  wireGeometry: BufferGeometry;
  wireMaterial: LineBasicMaterial;
  pickMaterial: MeshBasicMaterial;
}

export class StaticMeshEditor {
  private static active: StaticMeshEditor | null = null;

  static open(options: StaticMeshEditorOptions): StaticMeshEditor {
    StaticMeshEditor.active?.close();
    const editor = new StaticMeshEditor(options);
    StaticMeshEditor.active = editor;
    return editor;
  }

  private readonly overlay: HTMLDivElement;
  private readonly viewportHost: HTMLDivElement;
  private readonly detailsHost: HTMLDivElement;
  private readonly toolbarHost: HTMLDivElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  private readonly loader: GLTFLoader;
  private readonly textureLoader = new TextureLoader();
  private readonly modelGroup = new Group();
  private readonly overlayGroup = new Group();
  private readonly complexCollisionGroup = new Group();
  private readonly resizeObserver: ResizeObserver;

  private readonly target = new Vector3();
  private readonly spherical = new Spherical(4, Math.PI / 3, Math.PI / 4);
  private modelRadius = 1;
  private readonly cameraController = new OrbitViewportCamera(
    this.camera,
    this.spherical,
    this.target,
    () => this.modelRadius,
  );

  private rafId = 0;
  private disposed = false;
  private menuOpen: "collision" | "uvw" | null = null;

  private collision: AssetCollisionDef = defaultAssetCollisionDef();
  private uvw: AssetUvwDef = defaultAssetUvw();
  private materialSlots: AssetMaterialSlotsDef = defaultAssetMaterialSlots();
  private vertexColors: AssetVertexColorsDef = createEmptyAssetVertexColors();
  private vertexColorFill: [number, number, number, number] = [1, 1, 1, 1];
  private materialElements: AssetMaterialElement[] = [{ slotIndex: 0, label: "Element 0", sourceMaterialName: "Element 0" }];
  private previewMaterials = new Map<string, MeshBasicMaterial | MeshStandardMaterial>();
  private readonly originalMeshMaterials = new Map<Mesh, Mesh["material"]>();
  private readonly originalMeshColors = new Map<Mesh, ReturnType<BufferGeometry["getAttribute"]> | null>();
  private modelBounds = new Box3();
  private selectedPrimitive = -1;
  private activeTarget: ActiveTarget = null;
  private readonly overlays: PrimitiveOverlay[] = [];
  private uvwOverlay: PrimitiveOverlay | null = null;
  private showSimpleCollision = true;
  private showComplexCollision = false;
  private readonly complexCollisionLines: LineSegments[] = [];
  private readonly complexCollisionMaterial = new LineBasicMaterial({
    color: COMPLEX_WIRE_COLOR,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
  });

  private transformControls: TransformControls | null = null;
  private gizmoMode: GizmoMode = "translate";
  private gizmoDragging = false;
  private altDown = false;
  private readonly raycaster = new Raycaster();

  private constructor(private readonly options: StaticMeshEditorOptions) {
    this.overlay = document.createElement("div");
    this.overlay.className = "sm-editor-overlay";
    this.overlay.innerHTML = `
      <div class="sm-editor-window">
        <header class="sm-editor-header">
          <span class="sm-editor-tab">
            <span class="sm-editor-tab-icon">◰</span>
            <strong data-sm-title></strong>
          </span>
          <div class="sm-editor-header-actions">
            <button type="button" class="sm-editor-save" data-sm-save title="Çarpışmayı, materyal yuvalarını, UVW haritasını ve vertex renklerini kaydet (Ctrl+S)">Save</button>
            <button type="button" class="sm-editor-close" data-sm-close title="Close (Esc)">✕</button>
          </div>
        </header>
        <div class="sm-editor-toolbar" data-sm-toolbar></div>
        <div class="sm-editor-body">
          <div class="sm-editor-viewport" data-sm-viewport></div>
          <aside class="sm-editor-details" data-sm-details></aside>
        </div>
        <footer class="sm-editor-status" data-sm-status>Loading…</footer>
      </div>
    `;
    document.body.append(this.overlay);

    this.toolbarHost = this.requireEl("[data-sm-toolbar]");
    this.viewportHost = this.requireEl("[data-sm-viewport]");
    this.detailsHost = this.requireEl("[data-sm-details]");
    this.requireEl("[data-sm-title]").textContent = options.label;

    this.requireEl<HTMLButtonElement>("[data-sm-close]").addEventListener("click", () =>
      this.close(),
    );
    this.requireEl<HTMLButtonElement>("[data-sm-save]").addEventListener("click", () =>
      void this.save(),
    );

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.viewportHost.append(this.renderer.domElement);
    this.loader = createForgeGltfLoader(this.renderer);

    this.buildScene();
    this.bindCameraControls();
    this.bindKeyboard();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.viewportHost);
    this.resize();

    this.renderToolbar();
    this.renderDetails();
    this.startRenderLoop();

    void this.loadModel();
    void this.loadCollision();
    void this.loadUvw();
    void this.loadMaterialSlots();
    void this.loadVertexColors();
  }

  // --- scene setup -------------------------------------------------------

  private buildScene(): void {
    createAssetViewportRig(this.scene);
    this.scene.add(this.modelGroup);
    this.scene.add(this.overlayGroup);
    this.scene.add(this.complexCollisionGroup);
    this.complexCollisionGroup.visible = this.showComplexCollision;

    const controls = new TransformControls(this.camera, this.renderer.domElement);
    controls.setSize(0.85);
    controls.addEventListener("dragging-changed", (event) => {
      this.gizmoDragging = event.value === true;
      if (this.gizmoDragging) {
        // Alt + Move drag duplicates: leave a static copy at the drag-start
        // transform and keep dragging the original (Unreal-style Alt-drag copy).
        if (this.altDown && this.gizmoMode === "translate") this.duplicateForDrag();
        return;
      }
      // Commit the edit once the drag ends (live changes already wrote through).
      this.altDown = false;
      this.markDirty();
      this.renderDetails();
      if (this.activeTarget === "collision") this.rebuildOverlays();
    });
    controls.addEventListener("objectChange", () => this.onGizmoChange());
    this.scene.add(controls.getHelper());
    this.transformControls = controls;

    this.updateCamera();
  }

  private updateCamera(): void {
    this.cameraController.update();
  }

  private startRenderLoop(): void {
    const tick = (): void => {
      if (this.disposed) return;
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private resize(): void {
    const width = this.viewportHost.clientWidth || 1;
    const height = this.viewportHost.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // --- camera controls (minimal orbit/pan/dolly) -------------------------

  private bindCameraControls(): void {
    const el = this.renderer.domElement;
    // Capture phase so the Alt state is recorded before TransformControls reads
    // the pointerdown and dispatches its drag-start (which consumes altDown).
    el.addEventListener(
      "pointerdown",
      (event) => {
        this.altDown = event.altKey;
      },
      { capture: true },
    );
    this.cameraController.bind(el, {
      onPointerDown: () => this.closeMenu(),
      // Let the transform gizmo own the drag when the pointer is over a handle.
      shouldSkipPointerDown: () => Boolean(this.transformControls?.axis),
      isDragSuppressed: () => this.gizmoDragging,
      // A click (no meaningful drag, left button) selects a primitive under the
      // cursor — or clears the selection when clicking empty space.
      onClick: (event, dragDistance) => {
        if (!this.gizmoDragging && dragDistance < 4) this.pickPrimitiveAt(event);
      },
    });
  }

  private bindKeyboard(): void {
    this.overlay.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      // Don't hijack typing in the details inputs.
      if (target.matches("input, select, textarea")) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        void this.save();
        return;
      }
      const modeKey: Record<string, GizmoMode> = { q: "select", w: "translate", e: "rotate", r: "scale" };
      const mode = modeKey[event.key.toLowerCase()];
      if (mode) {
        event.stopPropagation();
        this.setGizmoMode(mode);
      }
    });
    this.overlay.tabIndex = -1;
    this.overlay.focus();
  }

  // --- model + collision loading ----------------------------------------

  private async loadModel(): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(projectFileUrl(this.options.modelPath));
      if (this.disposed) return;
      const model = gltf.scene;
      this.modelGroup.add(model);
      model.traverse((object) => {
        if (object instanceof Mesh && !this.originalMeshMaterials.has(object)) {
          this.originalMeshMaterials.set(object, object.material);
          const colors = object.geometry.getAttribute("color");
          this.originalMeshColors.set(object, colors ? colors.clone() : null);
        }
      });
      this.materialElements = collectAssetMaterialElements(model);
      this.renderDetails();
      this.rebuildComplexCollisionOverlay();
      this.modelBounds = new Box3().setFromObject(model);
      const center = this.modelBounds.getCenter(new Vector3());
      const size = this.modelBounds.getSize(new Vector3());
      this.modelRadius = Math.max(size.length() / 2, 0.5);
      this.target.copy(center);
      this.spherical.radius = this.modelRadius * 2.6;
      this.updateCamera();
      this.applyCurrentUvw();
      this.applyAssetVertexColorPreview();
      this.rebuildUvwOverlay();
      if (assignedMaterialSlotIds(this.materialSlots).length > 0) {
        void this.applyPreviewMaterials({ dirty: false, status: false });
      }
      this.setStatus("Ready.");
    } catch (error) {
      this.setStatus(`Failed to load model: ${describeError(error)}`, "error");
    }
  }

  private async loadCollision(): Promise<void> {
    this.collision = await loadAssetCollision(this.options.modelPath);
    if (this.disposed) return;
    this.renderDetails();
    this.rebuildOverlays();
  }

  private async loadUvw(): Promise<void> {
    this.uvw = await loadAssetUvw(this.options.modelPath);
    if (this.disposed) return;
    this.applyCurrentUvw();
    this.renderDetails();
    this.rebuildUvwOverlay();
  }

  private async loadMaterialSlots(): Promise<void> {
    this.materialSlots = await loadAssetMaterialSlots(this.options.modelPath);
    if (this.disposed) return;
    this.renderDetails();
    if (assignedMaterialSlotIds(this.materialSlots).length > 0) {
      await this.applyPreviewMaterials({ dirty: false, status: false });
    }
  }

  private async loadVertexColors(): Promise<void> {
    this.vertexColors = await loadAssetVertexColors(this.options.modelPath);
    if (this.disposed) return;
    this.applyAssetVertexColorPreview();
    this.renderDetails();
  }

  /** Lists render primitives with the same name/index identity used by the sidecar. */
  private assetVertexColorTargets(): Array<{
    mesh: Mesh;
    meshName: string;
    primitiveIndex: number;
    vertexCount: number;
    positions: number[];
  }> {
    const primitiveIndexByMeshName = new Map<string, number>();
    const targets: Array<{
      mesh: Mesh;
      meshName: string;
      primitiveIndex: number;
      vertexCount: number;
      positions: number[];
    }> = [];
    this.modelGroup.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const position = object.geometry.getAttribute("position");
      if (!position) return;
      const meshName = object.name || "__unnamed_mesh";
      const primitiveIndex = primitiveIndexByMeshName.get(meshName) ?? 0;
      primitiveIndexByMeshName.set(meshName, primitiveIndex + 1);
      targets.push({
        mesh: object,
        meshName,
        primitiveIndex,
        vertexCount: position.count,
        positions: Array.from(position.array as ArrayLike<number>),
      });
    });
    return targets;
  }

  /** Applies the asset sidecar to this editor-only model without touching the GLB. */
  private applyAssetVertexColorPreview(): void {
    for (const target of this.assetVertexColorTargets()) {
      const defaults = this.vertexColors.meshes.find(
        (entry) =>
          entry.meshName === target.meshName &&
          entry.primitiveIndex === target.primitiveIndex &&
          entry.vertexCount === target.vertexCount,
      );
      const original = this.originalMeshColors.get(target.mesh);
      if (!defaults && original === undefined) continue;
      if (defaults) {
        target.mesh.geometry.setAttribute("color", new Float32BufferAttribute(defaults.colors, 4));
      } else if (original) {
        target.mesh.geometry.setAttribute("color", original.clone());
      } else {
        target.mesh.geometry.deleteAttribute("color");
      }
      const color = target.mesh.geometry.getAttribute("color");
      if (color) color.needsUpdate = true;
    }
  }

  private fillAssetVertexColors(): void {
    const targets = this.assetVertexColorTargets();
    if (targets.length === 0) {
      this.setStatus("Model geometry is not ready for vertex-color fill.", "warning");
      return;
    }
    let next = createEmptyAssetVertexColors();
    for (const target of targets) {
      const colors = new Array<number>(target.vertexCount * 4);
      for (let vertex = 0; vertex < target.vertexCount; vertex += 1) {
        const offset = vertex * 4;
        colors[offset] = this.vertexColorFill[0];
        colors[offset + 1] = this.vertexColorFill[1];
        colors[offset + 2] = this.vertexColorFill[2];
        colors[offset + 3] = this.vertexColorFill[3];
      }
      next = upsertAssetVertexColorMesh(next, {
        meshName: target.meshName,
        primitiveIndex: target.primitiveIndex,
        vertexCount: target.vertexCount,
        colors,
        positions: target.positions,
      });
    }
    this.vertexColors = next;
    this.applyAssetVertexColorPreview();
    this.markDirty();
    this.renderDetails();
    this.setStatus(`Filled ${targets.length} mesh primitive${targets.length === 1 ? "" : "s"} with asset vertex colors.`);
  }

  private removeAssetVertexColors(): void {
    if (this.vertexColors.meshes.length === 0) return;
    this.vertexColors = createEmptyAssetVertexColors();
    this.applyAssetVertexColorPreview();
    this.markDirty();
    this.renderDetails();
    this.setStatus("Removed asset vertex-color defaults.");
  }

  /** Repairs asset defaults after a model reimport without mutating the GLB. */
  private fixAssetVertexColorsTopology(): void {
    if (this.vertexColors.meshes.length === 0) {
      this.setStatus("This asset has no vertex-color defaults to repair.", "warning");
      return;
    }
    const targets = this.assetVertexColorTargets();
    let next = this.vertexColors;
    let repaired = 0;
    let skipped = 0;
    for (const source of this.vertexColors.meshes) {
      const target = targets.find(
        (entry) => entry.meshName === source.meshName && entry.primitiveIndex === source.primitiveIndex,
      );
      const repair = target ? repairMeshPaintTopology(source, target.positions) : null;
      if (!target || !repair) {
        skipped += 1;
        continue;
      }
      next = upsertAssetVertexColorMesh(next, {
        meshName: target.meshName,
        primitiveIndex: target.primitiveIndex,
        vertexCount: target.vertexCount,
        colors: repair.colors,
        positions: repair.positions,
      });
      repaired += 1;
    }
    if (repaired === 0) {
      this.setStatus("Vertex-color repair needs saved source positions and a compatible primitive. Refill legacy sidecars once before a future reimport.", "warning");
      return;
    }
    this.vertexColors = next;
    this.applyAssetVertexColorPreview();
    this.markDirty();
    this.renderDetails();
    this.setStatus(
      skipped > 0
        ? `Repaired ${repaired} asset vertex-color default${repaired === 1 ? "" : "s"}; skipped ${skipped}.`
        : `Repaired ${repaired} asset vertex-color default${repaired === 1 ? "" : "s"}.`,
      skipped > 0 ? "warning" : "info",
    );
  }

  // --- toolbar -----------------------------------------------------------

  private renderToolbar(): void {
    this.toolbarHost.innerHTML = `
      <div class="sm-tool-group">
        <button type="button" class="sm-tool-btn" data-sm-menu="collision">
          <span class="sm-tool-icon">⬡</span> Collision <span class="sm-tool-caret">▾</span>
        </button>
        <div class="sm-tool-menu" data-sm-menu-panel="collision" hidden></div>
      </div>
      <div class="sm-tool-group">
        <button type="button" class="sm-tool-btn" data-sm-menu="uvw">
          <span class="sm-tool-icon">▦</span> UVW Map <span class="sm-tool-caret">▾</span>
        </button>
        <div class="sm-tool-menu" data-sm-menu-panel="uvw" hidden></div>
      </div>
      <div class="sm-tool-sep"></div>
      <div class="sm-tool-group sm-tool-modes">
        ${modeButton("select", "▦", "Select (Q)")}
        ${modeButton("translate", "✥", "Move (W)")}
        ${modeButton("rotate", "⟳", "Rotate (E)")}
        ${modeButton("scale", "⤢", "Scale (R)")}
      </div>
      <div class="sm-tool-sep"></div>
      <div class="sm-tool-group sm-tool-visibility" aria-label="Collision visibility">
        <label class="sm-tool-check">
          <input type="checkbox" data-sm-show-simple ${this.showSimpleCollision ? "checked" : ""} />
          <span>Simple</span>
        </label>
        <label class="sm-tool-check">
          <input type="checkbox" data-sm-show-complex ${this.showComplexCollision ? "checked" : ""} />
          <span>Complex</span>
        </label>
      </div>
    `;
    this.toolbarHost.querySelectorAll<HTMLButtonElement>("[data-sm-menu]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleMenu(button.dataset.smMenu === "uvw" ? "uvw" : "collision");
      });
    });
    this.toolbarHost.querySelectorAll<HTMLButtonElement>("[data-sm-mode]").forEach((item) => {
      item.addEventListener("click", () => this.setGizmoMode(item.dataset.smMode as GizmoMode));
    });
    this.toolbarHost
      .querySelector<HTMLInputElement>("[data-sm-show-simple]")
      ?.addEventListener("change", (event) => {
        this.showSimpleCollision = (event.target as HTMLInputElement).checked;
        this.updateCollisionVisibility();
      });
    this.toolbarHost
      .querySelector<HTMLInputElement>("[data-sm-show-complex]")
      ?.addEventListener("change", (event) => {
        this.showComplexCollision = (event.target as HTMLInputElement).checked;
        this.updateCollisionVisibility();
      });
    this.updateToolbarModes();
    document.addEventListener("pointerdown", this.onDocPointerDown);
  }

  private updateToolbarModes(): void {
    this.toolbarHost.querySelectorAll<HTMLButtonElement>("[data-sm-mode]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.smMode === this.gizmoMode);
    });
  }

  private readonly onDocPointerDown = (event: PointerEvent): void => {
    if (!this.menuOpen) return;
    if ((event.target as HTMLElement).closest(".sm-tool-group")) return;
    this.closeMenu();
  };

  private toggleMenu(kind: "collision" | "uvw"): void {
    this.menuOpen === kind ? this.closeMenu() : this.openMenu(kind);
  }

  private openMenu(kind: "collision" | "uvw"): void {
    this.closeMenu();
    const panel = this.requireEl(`[data-sm-menu-panel="${kind}"]`);
    if (kind === "uvw") {
      const hasUvw = Boolean(this.uvw.mapType);
      panel.innerHTML = `
        <div class="sm-menu-section">Apply UVW Map</div>
        ${menuItem("uvw-planar", "Planar")}
        ${menuItem("uvw-box", "Box")}
        ${menuItem("uvw-sphere", "Sphere")}
        ${menuItem("uvw-cylinder", "Cylinder")}
        <div class="sm-menu-sep"></div>
        ${menuItem("uvw-select", "Select UVW Gizmo", !hasUvw)}
        ${menuItem("uvw-remove", "Remove UVW Map", !hasUvw)}
      `;
      panel.hidden = false;
      this.menuOpen = kind;
      panel.querySelectorAll<HTMLButtonElement>("[data-sm-action]").forEach((item) => {
        item.addEventListener("click", () => {
          this.closeMenu();
          this.runMenuAction(item.dataset.smAction ?? "");
        });
      });
      return;
    }
    const hasPrimitives = this.collision.primitives.length > 0;
    const hasSelection = this.selectedPrimitive >= 0;
    panel.innerHTML = `
      <div class="sm-menu-section">Edit Collision</div>
      ${menuItem("add-box", "Add Box Simplified Collision")}
      ${menuItem("add-sphere", "Add Sphere Simplified Collision")}
      ${menuItem("add-capsule", "Add Capsule Simplified Collision")}
      ${menuItem("add-cylinder", "Add Cylinder Simplified Collision")}
      <div class="sm-menu-sep"></div>
      ${menuItem("kdop10", "Add 10DOP-X Simplified Collision")}
      ${menuItem("kdop10y", "Add 10DOP-Y Simplified Collision")}
      ${menuItem("kdop10z", "Add 10DOP-Z Simplified Collision")}
      ${menuItem("kdop18", "Add 18DOP Simplified Collision")}
      ${menuItem("kdop26", "Add 26DOP Simplified Collision")}
      ${menuItem("convex", "Auto Convex Collision")}
      <div class="sm-menu-sep"></div>
      ${menuItem("delete", "Delete Selected Collision", !hasSelection)}
      ${menuItem("duplicate", "Duplicate Selected Collision", !hasSelection)}
      ${menuItem("remove", "Remove Collision", !hasPrimitives)}
    `;
    panel.hidden = false;
    this.menuOpen = kind;
    panel.querySelectorAll<HTMLButtonElement>("[data-sm-action]").forEach((item) => {
      item.addEventListener("click", () => {
        this.closeMenu();
        this.runMenuAction(item.dataset.smAction ?? "");
      });
    });
  }

  private closeMenu(): void {
    if (!this.menuOpen) return;
    const panel = this.overlay.querySelector<HTMLElement>(
      `[data-sm-menu-panel="${this.menuOpen}"]`,
    );
    if (panel) panel.hidden = true;
    this.menuOpen = null;
  }

  private runMenuAction(action: string): void {
    switch (action) {
      case "add-box":
        this.addPrimitive("box");
        break;
      case "add-sphere":
        this.addPrimitive("sphere");
        break;
      case "add-capsule":
        this.addPrimitive("capsule");
        break;
      case "add-cylinder":
        this.addPrimitive("cylinder");
        break;
      case "delete":
        this.deleteSelected();
        break;
      case "duplicate":
        this.duplicateSelected();
        break;
      case "remove":
        this.removeAll();
        break;
      case "convex":
        this.addConvexCollision();
        break;
      case "kdop10":
        this.addKdopCollision("10DOP-X");
        break;
      case "kdop10y":
        this.addKdopCollision("10DOP-Y");
        break;
      case "kdop10z":
        this.addKdopCollision("10DOP-Z");
        break;
      case "kdop18":
        this.addKdopCollision("18DOP");
        break;
      case "kdop26":
        this.addKdopCollision("26DOP");
        break;
      case "uvw-planar":
      case "uvw-box":
      case "uvw-sphere":
      case "uvw-cylinder":
        this.applyUvwMap(action.replace("uvw-", "") as UvwMapType);
        break;
      case "uvw-select":
        this.selectUvwGizmo();
        break;
      case "uvw-remove":
        this.removeUvwMap();
        break;
      default:
        this.setStatus("That collision generator is not available yet.", "warning");
    }
  }

  // --- collision primitive editing --------------------------------------

  private addPrimitive(shape: CollisionPrimitiveShape): void {
    const size = this.modelBounds.getSize(new Vector3());
    const center = this.modelBounds.getCenter(new Vector3());
    const defaults = defaultPrimitiveTransform(shape, size);
    const primitive: CollisionPrimitive = {
      shape,
      size: defaults.size,
    };
    if (center.lengthSq() > 1e-6) primitive.center = [round(center.x), round(center.y), round(center.z)];
    if (defaults.rotation) primitive.rotation = defaults.rotation;
    this.collision.primitives.push(primitive);
    this.selectedPrimitive = this.collision.primitives.length - 1;
    this.activeTarget = "collision";
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
    this.setStatus(`Added ${shape} collision.`);
  }

  /** Generates a single convex hull collision shape from the loaded model. */
  private addConvexCollision(): void {
    const points = this.computeConvexHullPoints();
    if (!points) {
      this.setStatus("Could not generate a convex hull for this model.", "warning");
      return;
    }
    this.addConvexPrimitive(points, "convex collision");
  }

  /** Generates a K-DOP convex collision hull from directional model extents. */
  private addKdopCollision(kind: KdopKind): void {
    const points = computeKdopPoints(this.collectModelVertices(), kind);
    if (!points) {
      this.setStatus(`Could not generate ${kind} collision for this model.`, "warning");
      return;
    }
    this.addConvexPrimitive(points, `${kind} collision`);
  }

  private addConvexPrimitive(points: Vec3[], label: string): void {
    const bounds = new Box3();
    for (const point of points) bounds.expandByPoint(new Vector3(point[0], point[1], point[2]));
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const primitive: CollisionPrimitive = {
      shape: "convex",
      size: [round(size.x), round(size.y), round(size.z)],
      points,
    };
    if (center.lengthSq() > 1e-6) primitive.center = [round(center.x), round(center.y), round(center.z)];
    this.collision.primitives.push(primitive);
    this.selectedPrimitive = this.collision.primitives.length - 1;
    this.activeTarget = "collision";
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
    this.setStatus(`Added ${label} (${points.length} hull points).`);
  }

  /** Collects model vertices in model space, with large meshes sampled for editor responsiveness. */
  private collectModelVertices(): Vector3[] {
    this.modelGroup.updateMatrixWorld(true);
    const vertices: Vector3[] = [];
    const scratch = new Vector3();
    this.modelGroup.traverse((object) => {
      const geometry = (object as Mesh).geometry as BufferGeometry | undefined;
      if (!geometry || typeof geometry.getAttribute !== "function") return;
      const position = geometry.getAttribute("position");
      if (!position) return;
      const step = Math.max(1, Math.floor(position.count / 4000));
      for (let i = 0; i < position.count; i += step) {
        scratch.fromBufferAttribute(position, i).applyMatrix4((object as Mesh).matrixWorld);
        vertices.push(scratch.clone());
      }
    });
    return vertices;
  }

  /** Collects model vertices and returns the deduped convex-hull points (model space). */
  private computeConvexHullPoints(): Vec3[] | null {
    const raw = this.collectModelVertices();
    if (raw.length < 4) return null;
    let hull: BufferGeometry;
    try {
      hull = new ConvexGeometry(raw);
    } catch {
      return null;
    }
    const hullPosition = hull.getAttribute("position");
    const seen = new Set<string>();
    const points: Vec3[] = [];
    const vertex = new Vector3();
    for (let i = 0; i < hullPosition.count; i += 1) {
      vertex.fromBufferAttribute(hullPosition, i);
      const key = `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push([round(vertex.x), round(vertex.y), round(vertex.z)]);
    }
    hull.dispose();
    return points.length >= 4 ? points : null;
  }

  private deleteSelected(): void {
    if (this.selectedPrimitive < 0) return;
    this.collision.primitives.splice(this.selectedPrimitive, 1);
    this.selectedPrimitive = Math.min(this.selectedPrimitive, this.collision.primitives.length - 1);
    this.activeTarget = this.selectedPrimitive >= 0 ? "collision" : null;
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
  }

  private duplicateSelected(): void {
    const source = this.collision.primitives[this.selectedPrimitive];
    if (!source) return;
    this.collision.primitives.push(clonePrimitive(source));
    this.selectedPrimitive = this.collision.primitives.length - 1;
    this.activeTarget = "collision";
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
  }

  private removeAll(): void {
    this.collision.primitives = [];
    this.selectedPrimitive = -1;
    this.activeTarget = null;
    this.markDirty();
    this.renderDetails();
    this.rebuildOverlays();
  }

  private selectPrimitive(index: number): void {
    this.selectedPrimitive = index;
    this.activeTarget = index >= 0 ? "collision" : null;
    this.renderDetails();
    this.refreshOverlayColors();
    this.attachGizmo();
  }

  // --- UVW map editing --------------------------------------------------

  private applyUvwMap(mapType: UvwMapType): void {
    const size = this.modelBounds.getSize(new Vector3());
    const center = this.modelBounds.getCenter(new Vector3());
    const fallbackScale: Vec3 = [
      round(Math.max(size.x || 1, 0.001)),
      round(Math.max(size.y || 1, 0.001)),
      round(Math.max(size.z || 1, 0.001)),
    ];
    this.uvw = {
      schema: 1,
      mapType,
      position: this.uvw.mapType
        ? ([...this.uvw.position] as Vec3)
        : [round(center.x), round(center.y), round(center.z)],
      rotation: this.uvw.mapType ? ([...this.uvw.rotation] as Vec3) : [0, 0, 0],
      scale: this.uvw.mapType ? ([...this.uvw.scale] as Vec3) : fallbackScale,
    };
    this.activeTarget = "uvw";
    this.selectedPrimitive = -1;
    this.applyCurrentUvw();
    this.rebuildUvwOverlay();
    this.refreshOverlayColors();
    this.markDirty();
    this.renderDetails();
    this.setStatus(`Applied ${UVW_LABELS[mapType]} UVW map.`);
  }

  private removeUvwMap(): void {
    this.uvw = defaultAssetUvw();
    restoreAssetUvs(this.modelGroup);
    this.disposeUvwOverlay();
    if (this.activeTarget === "uvw") this.activeTarget = null;
    this.attachGizmo();
    this.markDirty();
    this.renderDetails();
    this.setStatus("Removed UVW map.");
  }

  private selectUvwGizmo(): void {
    if (!this.uvw.mapType) return;
    this.activeTarget = "uvw";
    this.selectedPrimitive = -1;
    this.refreshOverlayColors();
    this.renderDetails();
    this.attachGizmo();
  }

  private applyCurrentUvw(): void {
    applyAssetUvwMapping(this.modelGroup, this.uvw);
  }

  // --- transform gizmo ---------------------------------------------------

  private setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.updateToolbarModes();
    this.attachGizmo();
  }

  /** Attaches the gizmo to the selected primitive (or detaches when none / Select mode). */
  private attachGizmo(): void {
    const controls = this.transformControls;
    if (!controls) return;
    if (this.activeTarget === "uvw") {
      if (!this.uvwOverlay || this.gizmoMode === "select") {
        controls.detach();
        return;
      }
      controls.setMode(this.gizmoMode);
      controls.attach(this.uvwOverlay.root);
      return;
    }
    const overlay = this.overlays[this.selectedPrimitive];
    const primitive = this.collision.primitives[this.selectedPrimitive];
    // Convex hulls store absolute points, so the unit-transform gizmo doesn't
    // apply — they are generated/deleted, not transformed.
    if (
      !this.showSimpleCollision ||
      !overlay ||
      this.gizmoMode === "select" ||
      primitive?.shape === "convex"
    ) {
      controls.detach();
      return;
    }
    controls.setMode(this.gizmoMode);
    controls.attach(overlay.root);
  }

  /**
   * Alt-drag copy: clones the selected primitive at its current (drag-start)
   * transform and leaves the clone in place, while the gizmo keeps moving the
   * original. Appends the clone without rebuilding the dragged overlay so the
   * in-progress drag is undisturbed.
   */
  private duplicateForDrag(): void {
    const source = this.collision.primitives[this.selectedPrimitive];
    if (!source) return;
    const clone = clonePrimitive(source);
    const cloneIndex = this.collision.primitives.length;
    this.collision.primitives.push(clone);
    const overlay = buildPrimitiveOverlay(clone, false);
    overlay.pickMesh.userData.primitiveIndex = cloneIndex;
    this.overlays.push(overlay);
    this.overlayGroup.add(overlay.root);
    this.markDirty();
    this.setStatus("Duplicated collision (Alt-drag).");
  }

  /** Live write-back from the gizmo: root transform -> selected primitive data. */
  private onGizmoChange(): void {
    if (this.activeTarget === "uvw") {
      this.onUvwGizmoChange();
      return;
    }
    const overlay = this.overlays[this.selectedPrimitive];
    const primitive = this.collision.primitives[this.selectedPrimitive];
    if (!overlay || !primitive) return;
    const { position, rotation, scale } = overlay.root;
    primitive.size = [
      round(Math.max(scale.x, 0.001)),
      round(Math.max(scale.y, 0.001)),
      round(Math.max(scale.z, 0.001)),
    ];
    if (position.lengthSq() > 1e-8) {
      primitive.center = [round(position.x), round(position.y), round(position.z)];
    } else {
      delete primitive.center;
    }
    const rot: Vec3 = [
      roundDeg(MathUtils.radToDeg(rotation.x)),
      roundDeg(MathUtils.radToDeg(rotation.y)),
      roundDeg(MathUtils.radToDeg(rotation.z)),
    ];
    if (rot.some((axis) => Math.abs(axis) > 1e-3)) primitive.rotation = rot;
    else delete primitive.rotation;
    this.updateSelectedRowText();
  }

  private onUvwGizmoChange(): void {
    if (!this.uvwOverlay || !this.uvw.mapType) return;
    const { position, rotation, scale } = this.uvwOverlay.root;
    this.uvw.position = [round(position.x), round(position.y), round(position.z)];
    this.uvw.rotation = [
      roundDeg(MathUtils.radToDeg(rotation.x)),
      roundDeg(MathUtils.radToDeg(rotation.y)),
      roundDeg(MathUtils.radToDeg(rotation.z)),
    ];
    this.uvw.scale = [
      round(Math.max(scale.x, 0.001)),
      round(Math.max(scale.y, 0.001)),
      round(Math.max(scale.z, 0.001)),
    ];
    this.applyCurrentUvw();
    this.updateUvwDetailsText();
  }

  /** Updates the size readout of the selected primitive row without a full re-render. */
  private updateSelectedRowText(): void {
    const primitive = this.collision.primitives[this.selectedPrimitive];
    if (!primitive) return;
    const small = this.detailsHost.querySelector<HTMLElement>(
      `[data-sm-prim="${this.selectedPrimitive}"] small`,
    );
    if (small) small.textContent = primitive.size.map((axis) => axis.toFixed(2)).join(" × ");
  }

  private pickPrimitiveAt(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.uvwOverlay) {
      const uvwHits = this.raycaster.intersectObject(this.uvwOverlay.pickMesh, false);
      if (uvwHits.length > 0) {
        this.selectUvwGizmo();
        return;
      }
    }
    if (!this.showSimpleCollision) {
      if (this.selectedPrimitive !== -1) this.selectPrimitive(-1);
      return;
    }
    const hits = this.raycaster.intersectObjects(
      this.overlays.map((overlay) => overlay.pickMesh),
      false,
    );
    const index = hits.length > 0 ? Number(hits[0]!.object.userData.primitiveIndex) : -1;
    if (index !== this.selectedPrimitive) this.selectPrimitive(index);
  }

  // --- viewport overlays -------------------------------------------------

  private rebuildOverlays(): void {
    this.transformControls?.detach();
    for (const overlay of this.overlays) {
      this.overlayGroup.remove(overlay.root);
      disposeOverlay(overlay);
    }
    this.overlays.length = 0;
    this.collision.primitives.forEach((primitive, index) => {
      const overlay = buildPrimitiveOverlay(primitive, index === this.selectedPrimitive);
      overlay.pickMesh.userData.primitiveIndex = index;
      overlay.root.visible = this.showSimpleCollision;
      this.overlays.push(overlay);
      this.overlayGroup.add(overlay.root);
    });
    this.attachGizmo();
  }

  private updateCollisionVisibility(): void {
    for (const overlay of this.overlays) {
      overlay.root.visible = this.showSimpleCollision;
    }
    this.complexCollisionGroup.visible = this.showComplexCollision;
    if (!this.showSimpleCollision && this.activeTarget === "collision") {
      this.activeTarget = null;
    }
    this.refreshOverlayColors();
    this.attachGizmo();
  }

  private rebuildComplexCollisionOverlay(): void {
    this.disposeComplexCollisionOverlay();
    this.modelGroup.updateMatrixWorld(true);
    this.modelGroup.traverse((object) => {
      if (!(object instanceof Mesh) || !object.geometry) return;
      const geometry = new EdgesGeometry(object.geometry);
      const line = new LineSegments(geometry, this.complexCollisionMaterial);
      line.matrixAutoUpdate = false;
      line.matrix.copy(object.matrixWorld);
      line.renderOrder = 4;
      this.complexCollisionLines.push(line);
      this.complexCollisionGroup.add(line);
    });
    this.complexCollisionGroup.visible = this.showComplexCollision;
  }

  private disposeComplexCollisionOverlay(): void {
    for (const line of this.complexCollisionLines) {
      this.complexCollisionGroup.remove(line);
      line.geometry.dispose();
    }
    this.complexCollisionLines.length = 0;
  }

  private rebuildUvwOverlay(): void {
    this.disposeUvwOverlay();
    if (!this.uvw.mapType) {
      this.attachGizmo();
      return;
    }
    this.uvwOverlay = buildUvwOverlay(this.uvw, this.activeTarget === "uvw");
    this.overlayGroup.add(this.uvwOverlay.root);
    this.attachGizmo();
  }

  private disposeUvwOverlay(): void {
    if (!this.uvwOverlay) return;
    this.overlayGroup.remove(this.uvwOverlay.root);
    disposeOverlay(this.uvwOverlay);
    this.uvwOverlay = null;
  }

  private refreshOverlayColors(): void {
    this.overlays.forEach((overlay, index) => {
      overlay.wireMaterial.color.setHex(
        this.activeTarget === "collision" && index === this.selectedPrimitive
          ? WIRE_SELECTED_COLOR
          : WIRE_COLOR,
      );
    });
    this.uvwOverlay?.wireMaterial.color.setHex(
      this.activeTarget === "uvw" ? UVW_WIRE_SELECTED_COLOR : UVW_WIRE_COLOR,
    );
  }

  // --- details panel -----------------------------------------------------

  private renderDetails(): void {
    const presetOptions = COLLISION_PRESET_IDS.map(
      (id) =>
        `<option value="${id}" ${id === this.collision.preset ? "selected" : ""}>${PRESET_LABELS[id]}</option>`,
    ).join("");
    const complexityOptions = COLLISION_COMPLEXITY_VALUES.map(
      (id) =>
        `<option value="${id}" ${id === this.collision.complexity ? "selected" : ""}>${COMPLEXITY_LABELS[id]}</option>`,
    ).join("");
    const navigationRole = this.collision.navigationRole ?? DEFAULT_NAVIGATION_ROLE;
    const navigationRoleOptions = NAVIGATION_ROLE_VALUES.map(
      (role) =>
        `<option value="${role}" ${role === navigationRole ? "selected" : ""}>${NAVIGATION_ROLE_LABELS[role]}</option>`,
    ).join("");
    const currentMaterial = this.collision.physicalMaterialId ?? "";
    const physMaterialOptions = [`<option value="" ${currentMaterial ? "" : "selected"}>None</option>`]
      .concat(
        PHYSICAL_MATERIAL_IDS.map(
          (id) =>
            `<option value="${id}" ${id === currentMaterial ? "selected" : ""}>${capitalize(id)}</option>`,
        ),
      )
      .join("");
    const primitiveRows = this.collision.primitives.length
      ? this.collision.primitives
          .map(
            (primitive, index) => `
        <div class="sm-prim-row ${index === this.selectedPrimitive ? "is-selected" : ""}" data-sm-prim="${index}">
          <span class="sm-prim-kind">${primitive.shape}</span>
          <small>${primitive.size.map((axis) => axis.toFixed(2)).join(" × ")}</small>
          <button type="button" class="sm-prim-del" data-sm-prim-del="${index}" title="Delete">✕</button>
        </div>`,
          )
          .join("")
      : `<div class="sm-empty">No simple collision. Use the Collision menu to add a shape.</div>`;
    const uvwDetails = this.uvw.mapType
      ? `
        <div class="sm-prim-row ${this.activeTarget === "uvw" ? "is-selected" : ""}" data-sm-uvw-row>
          <span class="sm-prim-kind">${UVW_LABELS[this.uvw.mapType]}</span>
          <small data-sm-uvw-readout>${this.uvwReadout()}</small>
          <button type="button" class="sm-prim-del" data-sm-uvw-remove title="Remove">✕</button>
        </div>`
      : `<div class="sm-empty">No UVW map. Use the UVW Map menu to apply a projection.</div>`;
    const materialRows = this.materialElements
      .map((element) => {
        const suffix =
          element.sourceMaterialName && element.sourceMaterialName !== element.label
            ? `<small>${escapeHtml(element.sourceMaterialName)}</small>`
            : "";
        return `
        <label class="sm-row">
          <span>${escapeHtml(element.label)}${suffix}</span>
          <select data-sm-material-slot="${element.slotIndex}">${this.materialSlotOptions(element.slotIndex)}</select>
        </label>`;
      })
      .join("");
    const vertexColorRows = this.vertexColors.meshes.length
      ? this.vertexColors.meshes
          .map(
            (entry) => `
        <div class="sm-prim-row">
          <span class="sm-prim-kind">${escapeHtml(entry.meshName)} · P${entry.primitiveIndex}</span>
          <small>${entry.vertexCount.toLocaleString()} vertices · RGBA</small>
        </div>`,
          )
          .join("")
      : `<div class="sm-empty">No asset vertex-color defaults. Use Mesh Paint &gt; To Mesh, or fill this asset here.</div>`;
    const fillHex = rgbHex(this.vertexColorFill);

    this.detailsHost.innerHTML = `
      <div class="sm-details-heading">Details</div>
      <div class="sm-section">
        <div class="sm-section-title">Materials</div>
        ${materialRows}
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Vertex Colors <span class="sm-count">${this.vertexColors.meshes.length}</span></div>
        <div class="sm-hint">Asset defaults are stored beside the model and do not rewrite the source GLB. Placement-specific Mesh Paint remains independent.</div>
        <div class="sm-prim-list">${vertexColorRows}</div>
        <label class="sm-row"><span>Fill Color</span><input type="color" value="#${fillHex}" data-sm-vertex-color /></label>
        <label class="sm-row"><span>Fill Alpha</span><input type="number" min="0" max="1" step="0.05" value="${this.vertexColorFill[3]}" data-sm-vertex-alpha /></label>
        <div class="sm-prim-list">
          <button type="button" data-sm-vertex-fill>Fill Asset Colors</button>
          <button type="button" data-sm-vertex-fix ${this.vertexColors.meshes.length > 0 ? "" : "disabled"}>Fix After Reimport</button>
          <button type="button" data-sm-vertex-remove ${this.vertexColors.meshes.length > 0 ? "" : "disabled"}>Remove Asset Colors</button>
        </div>
      </div>
      <div class="sm-section">
        <div class="sm-section-title">UVW Map</div>
        <div class="sm-prim-list">${uvwDetails}</div>
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Collision</div>
        <label class="sm-row">
          <span>Collision Presets</span>
          <select data-sm-field="preset">${presetOptions}</select>
        </label>
        <label class="sm-row">
          <span>Collision Complexity</span>
          <select data-sm-field="complexity">${complexityOptions}</select>
        </label>
        <label class="sm-row">
          <span>AI Navigation Role</span>
          <select data-sm-field="navigationRole">${navigationRoleOptions}</select>
        </label>
        ${
          this.collision.complexity === "complexAsSimple"
            ? `<div class="sm-hint">Uses the render mesh as a static trimesh collider. Static-only — placements of this asset can't Simulate Physics. Best for level geometry (walls, rooms) instead of hand-placing boxes.</div>`
            : ""
        }
        <label class="sm-row sm-toggle">
          <input type="checkbox" data-sm-field="doubleSided" ${this.collision.doubleSided ? "checked" : ""} />
          <span>Double Sided Geometry</span>
        </label>
        <label class="sm-row">
          <span>Simple Collision Physical Material</span>
          <select data-sm-field="physicalMaterialId">${physMaterialOptions}</select>
        </label>
        <label class="sm-row sm-toggle">
          <input type="checkbox" data-sm-field="generateOverlapEvents" ${
            this.collision.generateOverlapEvents !== false ? "checked" : ""
          } />
          <span>Generate Overlap Events</span>
        </label>
        <label class="sm-row sm-toggle">
          <input type="checkbox" data-sm-field="simulationGeneratesHitEvents" ${
            this.collision.simulationGeneratesHitEvents !== false ? "checked" : ""
          } />
          <span>Simulation Generates Hit Events</span>
        </label>
      </div>
      <div class="sm-section">
        <div class="sm-section-title">Primitives <span class="sm-count">${this.collision.primitives.length}</span></div>
        <div class="sm-prim-list">${primitiveRows}</div>
      </div>
    `;

    this.detailsHost.querySelectorAll<HTMLSelectElement>("[data-sm-material-slot]").forEach((select) => {
      select.addEventListener("change", (event) => {
        const slotIndex = Number(select.dataset.smMaterialSlot);
        const value = (event.target as HTMLSelectElement).value;
        void this.applyPreviewMaterial(slotIndex, value, { dirty: true, status: true });
      });
    });
    this.detailsHost.querySelector<HTMLInputElement>("[data-sm-vertex-color]")?.addEventListener("change", (event) => {
      const [r, g, b] = hexRgb((event.currentTarget as HTMLInputElement).value);
      this.vertexColorFill = [r, g, b, this.vertexColorFill[3]];
    });
    this.detailsHost.querySelector<HTMLInputElement>("[data-sm-vertex-alpha]")?.addEventListener("change", (event) => {
      this.vertexColorFill = [
        this.vertexColorFill[0],
        this.vertexColorFill[1],
        this.vertexColorFill[2],
        clampUnit(Number((event.currentTarget as HTMLInputElement).value)),
      ];
    });
    this.detailsHost.querySelector<HTMLButtonElement>("[data-sm-vertex-fill]")?.addEventListener("click", () => {
      this.fillAssetVertexColors();
    });
    this.detailsHost.querySelector<HTMLButtonElement>("[data-sm-vertex-fix]")?.addEventListener("click", () => {
      this.fixAssetVertexColorsTopology();
    });
    this.detailsHost.querySelector<HTMLButtonElement>("[data-sm-vertex-remove]")?.addEventListener("click", () => {
      this.removeAssetVertexColors();
    });
    this.detailsHost
      .querySelector<HTMLSelectElement>('[data-sm-field="preset"]')
      ?.addEventListener("change", (event) => {
        this.collision.preset = (event.target as HTMLSelectElement).value as CollisionPresetId;
        this.markDirty();
      });
    this.detailsHost
      .querySelector<HTMLSelectElement>('[data-sm-field="complexity"]')
      ?.addEventListener("change", (event) => {
        this.collision.complexity = (event.target as HTMLSelectElement).value as CollisionComplexity;
        this.markDirty();
        // Re-render so the static-only hint appears/disappears with the choice.
        this.renderDetails();
      });
    this.detailsHost
      .querySelector<HTMLSelectElement>('[data-sm-field="navigationRole"]')
      ?.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value as NavigationRole;
        if (value === DEFAULT_NAVIGATION_ROLE) delete this.collision.navigationRole;
        else this.collision.navigationRole = value;
        this.markDirty();
      });
    this.detailsHost
      .querySelector<HTMLInputElement>('[data-sm-field="doubleSided"]')
      ?.addEventListener("change", (event) => {
        this.collision.doubleSided = (event.target as HTMLInputElement).checked;
        this.markDirty();
      });
    this.detailsHost
      .querySelector<HTMLSelectElement>('[data-sm-field="physicalMaterialId"]')
      ?.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        if (value) this.collision.physicalMaterialId = value;
        else delete this.collision.physicalMaterialId;
        this.markDirty();
      });
    this.bindEventFlagToggle("generateOverlapEvents");
    this.bindEventFlagToggle("simulationGeneratesHitEvents");
    this.detailsHost.querySelectorAll<HTMLElement>("[data-sm-prim]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("[data-sm-prim-del]")) return;
        this.selectPrimitive(Number(row.dataset.smPrim));
      });
    });
    this.detailsHost.querySelectorAll<HTMLButtonElement>("[data-sm-prim-del]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedPrimitive = Number(button.dataset.smPrimDel);
        this.deleteSelected();
      });
    });
    this.detailsHost.querySelector<HTMLElement>("[data-sm-uvw-row]")?.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("[data-sm-uvw-remove]")) return;
      this.selectUvwGizmo();
    });
    this.detailsHost.querySelector<HTMLButtonElement>("[data-sm-uvw-remove]")?.addEventListener("click", () => {
      this.removeUvwMap();
    });
  }

  private uvwReadout(): string {
    return `P ${formatVec3(this.uvw.position)} / R ${formatVec3(this.uvw.rotation)} / S ${formatVec3(this.uvw.scale)}`;
  }

  private updateUvwDetailsText(): void {
    const readout = this.detailsHost.querySelector<HTMLElement>("[data-sm-uvw-readout]");
    if (readout) readout.textContent = this.uvwReadout();
  }

  private materialSlotOptions(slotIndex: number): string {
    const materials = this.options.assets?.filter((asset) => asset.assetType === "material") ?? [];
    const selectedMaterialId = this.materialSlots.slots[slotIndex] ?? "";
    return [`<option value="" ${selectedMaterialId ? "" : "selected"}>None</option>`]
      .concat(
        materials.map(
          (asset) =>
            `<option value="${escapeHtml(asset.id)}" ${
              selectedMaterialId === asset.id ? "selected" : ""
            }>${escapeHtml(asset.name)}</option>`,
        ),
      )
      .join("");
  }

  private async applyPreviewMaterial(
    slotIndex: number,
    materialId: string,
    options: { dirty?: boolean; status?: boolean } = {},
  ): Promise<void> {
    const slots = [...this.materialSlots.slots];
    slots[slotIndex] = materialId;
    while (slots.length > 0 && !slots[slots.length - 1]) slots.pop();
    this.materialSlots = { schema: 1, slots };
    await this.applyPreviewMaterials(options);
  }

  private async applyPreviewMaterials(options: { dirty?: boolean; status?: boolean } = {}): Promise<void> {
    this.disposePreviewMaterials();
    this.restoreOriginalMaterials();
    const materialIds = [...new Set(assignedMaterialSlotIds(this.materialSlots))];
    if (materialIds.length === 0) {
      if (options.dirty) this.markDirty();
      if (options.status !== false) this.setStatus("Material slots cleared.");
      return;
    }
    try {
      const manifest = this.previewAssetManifest();
      for (const id of materialIds) {
        const record = this.options.assets?.find((asset) => asset.id === id);
        if (!record) {
          this.setStatus(`Material not found: ${id}`, "warning");
          return;
        }
        const material = await loadForgeMaterial(
          manifest,
          id,
          this.textureLoader,
          { maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy() },
        );
        this.previewMaterials.set(id, material);
      }
      applyMaterialSlotOverrides(this.modelGroup, this.materialSlots, (id) =>
        this.previewMaterials.get(id),
      );
      if (options.dirty) this.markDirty();
      if (options.status !== false) this.setStatus("Preview material slots updated.");
    } catch (error) {
      this.setStatus(`Material preview failed: ${describeError(error)}`, "error");
    }
  }

  private previewAssetManifest(): AssetManifest {
    const assets: AssetRecord[] = [];
    for (const asset of this.options.assets ?? []) {
      if (asset.assetType !== "material" && asset.assetType !== "texture") continue;
      assets.push({
        id: asset.id,
        name: asset.name,
        assetType: asset.assetType,
        category: "",
        path: asset.path,
        tags: [],
        placeable: false,
        placement: {
          surface: "floor",
          snapToWall: false,
          allowRotation: true,
          allowScale: true,
        },
        runtime: {
          loadGroup: "editor",
          castShadow: false,
          receiveShadow: false,
          collision: false,
          bytes: 0,
        },
        license: "unknown",
      });
    }
    return {
      version: 1,
      generated: "static-mesh-editor-preview",
      ktx2: false,
      assets,
    };
  }

  private disposePreviewMaterials(): void {
    for (const material of this.previewMaterials.values()) {
      material.map?.dispose();
      if (material instanceof MeshStandardMaterial) {
        material.normalMap?.dispose();
      }
      material.dispose();
    }
    this.previewMaterials.clear();
  }

  private restoreOriginalMaterials(): void {
    for (const [mesh, material] of this.originalMeshMaterials) {
      mesh.material = material;
    }
  }

  // --- save / status -----------------------------------------------------

  /** Wires a default-on event-flag checkbox (stores only an explicit opt-out). */
  private bindEventFlagToggle(
    field: "generateOverlapEvents" | "simulationGeneratesHitEvents",
  ): void {
    this.detailsHost
      .querySelector<HTMLInputElement>(`[data-sm-field="${field}"]`)
      ?.addEventListener("change", (event) => {
        if ((event.target as HTMLInputElement).checked) delete this.collision[field];
        else this.collision[field] = false;
        this.markDirty();
      });
  }

  private markDirty(): void {
    const save = this.overlay.querySelector<HTMLButtonElement>("[data-sm-save]");
    if (save) save.classList.add("is-dirty");
  }

  private async save(): Promise<void> {
    try {
      const [collisionResult, materialResult, uvwResult, vertexColorResult] = await Promise.all([
        saveAssetCollision(this.options.modelPath, this.collision),
        saveAssetMaterialSlots(this.options.modelPath, this.materialSlots),
        saveAssetUvw(this.options.modelPath, this.uvw),
        saveAssetVertexColors(this.options.modelPath, this.vertexColors),
      ]);
      this.overlay.querySelector<HTMLButtonElement>("[data-sm-save]")?.classList.remove("is-dirty");
      const changed = collisionResult.changed || materialResult.changed || uvwResult.changed || vertexColorResult.changed;
      this.setStatus(
        changed
          ? `Saved ${collisionResult.path}, ${materialResult.path}, ${uvwResult.path}, and ${vertexColorResult.path}`
          : "No changes to save.",
      );
      if (this.options.assetId) {
        this.options.onMaterialSlotsSaved?.(this.options.assetId);
        this.options.onAssetUvwSaved?.(this.options.assetId);
        this.options.onCollisionSaved?.(this.options.assetId);
      }
    } catch (error) {
      this.setStatus(`Save failed: ${describeError(error)}`, "error");
    }
  }

  private setStatus(message: string, tone: "info" | "warning" | "error" = "info"): void {
    const status = this.overlay.querySelector<HTMLElement>("[data-sm-status]");
    if (status) {
      status.textContent = message;
      status.dataset.tone = tone;
    }
    this.options.onStatus?.(message, tone);
  }

  // --- lifecycle ---------------------------------------------------------

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    document.removeEventListener("pointerdown", this.onDocPointerDown);
    this.resizeObserver.disconnect();
    this.transformControls?.detach();
    this.transformControls?.dispose();
    this.disposePreviewMaterials();
    for (const overlay of this.overlays) disposeOverlay(overlay);
    this.disposeUvwOverlay();
    this.disposeComplexCollisionOverlay();
    this.complexCollisionMaterial.dispose();
    this.renderer.dispose();
    this.overlay.remove();
    if (StaticMeshEditor.active === this) StaticMeshEditor.active = null;
  }

  private requireEl<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.overlay.querySelector<T>(selector);
    if (!el) throw new Error(`StaticMeshEditor: missing ${selector}`);
    return el;
  }
}

function menuItem(action: string, label: string, disabled = false): string {
  return `<button type="button" class="sm-menu-item" data-sm-action="${action}" ${
    disabled ? "disabled" : ""
  }>${label}</button>`;
}

function modeButton(mode: GizmoMode, icon: string, title: string): string {
  return `<button type="button" class="sm-tool-btn sm-mode-btn" data-sm-mode="${mode}" title="${title}">${icon}</button>`;
}

/** Unit-space solid geometry for a primitive; the root scale stores authored size. */
function solidGeometryForPrimitive(primitive: CollisionPrimitive): BufferGeometry {
  if (primitive.shape === "sphere") {
    const geometry = new SphereGeometry(1, 16, 10);
    const radius = normalizedSphereRadius(primitive.size);
    geometry.scale(radius.x, radius.y, radius.z);
    return geometry;
  }
  if (primitive.shape === "capsule") {
    const dims = normalizedCapsuleDimensions(primitive.size);
    const length =
      dims.radiusY > 1e-6 ? Math.max((dims.capCenterY * 2) / dims.radiusY, 0.0001) : 0.0001;
    const geometry = new CapsuleGeometry(1, length, 6, 12);
    geometry.scale(dims.radiusX, dims.radiusY, dims.radiusZ);
    return geometry;
  }
  if (primitive.shape === "cylinder") {
    return new CylinderGeometry(0.5, 0.5, 1, 16);
  }
  if (primitive.shape === "cone") return new ConeGeometry(0.5, 1, 24);
  return new BoxGeometry(1, 1, 1);
}

function unitGeometryForUvw(type: UvwMapType): BufferGeometry {
  if (type === "sphere") return new SphereGeometry(0.5, 24, 16);
  if (type === "cylinder") return new CylinderGeometry(0.5, 0.5, 1, 24);
  if (type === "planar") return new BoxGeometry(1, 0.01, 1);
  return new BoxGeometry(1, 1, 1);
}

interface PrimitiveTransformDefaults {
  size: Vec3;
  rotation?: Vec3;
}

interface NormalizedSphereRadius {
  x: number;
  y: number;
  z: number;
}

interface NormalizedRadialDimensions {
  radiusX: number;
  radiusZ: number;
}

interface NormalizedCapsuleDimensions extends NormalizedRadialDimensions {
  radiusY: number;
  capCenterY: number;
}

const COLLISION_WIRE_STEPS = 24;

function defaultPrimitiveTransform(
  shape: CollisionPrimitiveShape,
  boundsSize: Vector3,
): PrimitiveTransformDefaults {
  const size: Vec3 = [
    round(boundsSize.x || 1),
    round(boundsSize.y || 1),
    round(boundsSize.z || 1),
  ];
  if (shape === "sphere") {
    const diameter = round(Math.max(size[0], size[1], size[2], 0.001));
    return { size: [diameter, diameter, diameter] };
  }
  if (shape === "capsule" || shape === "cylinder") {
    return defaultRadialPrimitiveTransform(shape, size);
  }
  return { size };
}

function defaultRadialPrimitiveTransform(
  shape: "capsule" | "cylinder",
  boundsSize: Vec3,
): PrimitiveTransformDefaults {
  const axes = [boundsSize[0], boundsSize[1], boundsSize[2]];
  let lengthAxis = 0;
  for (let index = 1; index < axes.length; index += 1) {
    if (axes[index]! > axes[lengthAxis]!) lengthAxis = index;
  }
  const crossAxes = axes.filter((_, index) => index !== lengthAxis);
  const diameter = round(Math.max(...crossAxes, 0.001));
  const minCapsuleHeight = shape === "capsule" ? diameter * 2 : diameter;
  const height = round(Math.max(axes[lengthAxis]!, minCapsuleHeight, 0.001));
  const rotation =
    lengthAxis === 0 ? ([0, 0, 90] as Vec3) : lengthAxis === 2 ? ([90, 0, 0] as Vec3) : undefined;
  const result: PrimitiveTransformDefaults = { size: [diameter, height, diameter] };
  if (rotation) result.rotation = rotation;
  return result;
}

function normalizedAxis(size: Vec3, index: 0 | 1 | 2): number {
  return Math.max(Math.abs(size[index] || 1), 0.001);
}

function normalizedSphereRadius(size: Vec3): NormalizedSphereRadius {
  const sx = normalizedAxis(size, 0);
  const sy = normalizedAxis(size, 1);
  const sz = normalizedAxis(size, 2);
  const radius = Math.max(sx, sy, sz) / 2;
  return { x: radius / sx, y: radius / sy, z: radius / sz };
}

function normalizedCapsuleDimensions(size: Vec3): NormalizedCapsuleDimensions {
  const sx = normalizedAxis(size, 0);
  const sy = normalizedAxis(size, 1);
  const sz = normalizedAxis(size, 2);
  const radius = Math.max(sx, sz) / 2;
  const halfHeight = Math.max(0, sy / 2 - radius);
  return {
    radiusX: radius / sx,
    radiusY: radius / sy,
    radiusZ: radius / sz,
    capCenterY: halfHeight / sy,
  };
}

function wireGeometryForPrimitive(
  primitive: CollisionPrimitive,
  solidGeometry: BufferGeometry,
): BufferGeometry {
  const segments = wireSegmentsForPrimitive(primitive);
  if (!segments) return new EdgesGeometry(solidGeometry);
  return new BufferGeometry().setFromPoints(
    segments.map((point) => new Vector3(point[0], point[1], point[2])),
  );
}

function wireSegmentsForPrimitive(primitive: CollisionPrimitive): Vec3[] | null {
  if (primitive.shape === "sphere") return sphereWireSegments(primitive.size);
  if (primitive.shape === "capsule") return capsuleWireSegments(primitive.size);
  if (primitive.shape === "cylinder") return cylinderWireSegments();
  return null;
}

function sphereWireSegments(size: Vec3): Vec3[] {
  const radius = normalizedSphereRadius(size);
  return [
    ...ellipseSegments("xy", 0, radius.x, radius.y),
    ...ellipseSegments("xz", 0, radius.x, radius.z),
    ...ellipseSegments("yz", 0, radius.y, radius.z),
  ];
}

function capsuleWireSegments(size: Vec3): Vec3[] {
  const dims = normalizedCapsuleDimensions(size);
  if (dims.capCenterY <= 1e-5) return sphereWireSegments(size);
  return [
    ...ellipseSegments("xz", -dims.capCenterY, dims.radiusX, dims.radiusZ),
    ...ellipseSegments("xz", dims.capCenterY, dims.radiusX, dims.radiusZ),
    ...capsuleProfileSegments("x", dims.capCenterY, dims.radiusX, dims.radiusY),
    ...capsuleProfileSegments("z", dims.capCenterY, dims.radiusZ, dims.radiusY),
    [-dims.radiusX, -dims.capCenterY, 0],
    [-dims.radiusX, dims.capCenterY, 0],
    [dims.radiusX, -dims.capCenterY, 0],
    [dims.radiusX, dims.capCenterY, 0],
    [0, -dims.capCenterY, -dims.radiusZ],
    [0, dims.capCenterY, -dims.radiusZ],
    [0, -dims.capCenterY, dims.radiusZ],
    [0, dims.capCenterY, dims.radiusZ],
  ];
}

function cylinderWireSegments(): Vec3[] {
  const top = ellipseSegments("xz", 0.5, 0.5, 0.5);
  const bottom = ellipseSegments("xz", -0.5, 0.5, 0.5);
  const verticals: Vec3[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const x = Math.cos(angle) * 0.5;
    const z = Math.sin(angle) * 0.5;
    verticals.push([x, -0.5, z], [x, 0.5, z]);
  }
  return [...top, ...bottom, ...verticals];
}

function ellipseSegments(
  plane: "xy" | "xz" | "yz",
  offset: number,
  radiusA: number,
  radiusB: number,
): Vec3[] {
  const segments: Vec3[] = [];
  for (let i = 0; i < COLLISION_WIRE_STEPS; i += 1) {
    const a = (i / COLLISION_WIRE_STEPS) * Math.PI * 2;
    const b = ((i + 1) / COLLISION_WIRE_STEPS) * Math.PI * 2;
    segments.push(ellipsePoint(plane, offset, radiusA, radiusB, a));
    segments.push(ellipsePoint(plane, offset, radiusA, radiusB, b));
  }
  return segments;
}

function ellipsePoint(
  plane: "xy" | "xz" | "yz",
  offset: number,
  radiusA: number,
  radiusB: number,
  angle: number,
): Vec3 {
  const a = Math.cos(angle) * radiusA;
  const b = Math.sin(angle) * radiusB;
  if (plane === "xy") return [a, b, offset];
  if (plane === "xz") return [a, offset, b];
  return [offset, a, b];
}

function capsuleProfileSegments(
  axis: "x" | "z",
  capCenterY: number,
  radiusHorizontal: number,
  radiusY: number,
): Vec3[] {
  const segments: Vec3[] = [];
  const point = (horizontal: number, y: number): Vec3 =>
    axis === "x" ? [horizontal, y, 0] : [0, y, horizontal];
  for (let i = 0; i < COLLISION_WIRE_STEPS / 2; i += 1) {
    const topA = (i / (COLLISION_WIRE_STEPS / 2)) * Math.PI;
    const topB = ((i + 1) / (COLLISION_WIRE_STEPS / 2)) * Math.PI;
    const bottomA = Math.PI + topA;
    const bottomB = Math.PI + topB;
    segments.push(
      point(Math.cos(topA) * radiusHorizontal, capCenterY + Math.sin(topA) * radiusY),
      point(Math.cos(topB) * radiusHorizontal, capCenterY + Math.sin(topB) * radiusY),
      point(Math.cos(bottomA) * radiusHorizontal, -capCenterY + Math.sin(bottomA) * radiusY),
      point(Math.cos(bottomB) * radiusHorizontal, -capCenterY + Math.sin(bottomB) * radiusY),
    );
  }
  return segments;
}

function buildUvwOverlay(uvw: AssetUvwDef, selected: boolean): PrimitiveOverlay {
  const solidGeometry = unitGeometryForUvw(uvw.mapType ?? "box");
  const wireGeometry = new EdgesGeometry(solidGeometry);
  const wireMaterial = new LineBasicMaterial({
    color: selected ? UVW_WIRE_SELECTED_COLOR : UVW_WIRE_COLOR,
    depthTest: false,
    transparent: true,
  });
  const wire = new LineSegments(wireGeometry, wireMaterial);
  wire.renderOrder = 4;
  const pickMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const pickMesh = new Mesh(solidGeometry, pickMaterial);

  const root = new Group();
  root.name = "uvw-map-gizmo";
  root.add(pickMesh);
  root.add(wire);
  root.position.set(uvw.position[0], uvw.position[1], uvw.position[2]);
  root.rotation.set(degToRad(uvw.rotation[0]), degToRad(uvw.rotation[1]), degToRad(uvw.rotation[2]));
  root.scale.set(
    Math.max(uvw.scale[0], 0.001),
    Math.max(uvw.scale[1], 0.001),
    Math.max(uvw.scale[2], 0.001),
  );
  return { root, wire, pickMesh, solidGeometry, wireGeometry, wireMaterial, pickMaterial };
}

function buildPrimitiveOverlay(primitive: CollisionPrimitive, selected: boolean): PrimitiveOverlay {
  const solidGeometry =
    primitive.shape === "convex" && primitive.points && primitive.points.length >= 4
      ? new ConvexGeometry(primitive.points.map((point) => new Vector3(point[0], point[1], point[2])))
      : solidGeometryForPrimitive(primitive);
  const wireGeometry = wireGeometryForPrimitive(primitive, solidGeometry);
  const wireMaterial = new LineBasicMaterial({
    color: selected ? WIRE_SELECTED_COLOR : WIRE_COLOR,
    depthTest: false,
    transparent: true,
  });
  const wire = new LineSegments(wireGeometry, wireMaterial);
  wire.renderOrder = 3;
  // Invisible but raycastable solid for viewport picking.
  const pickMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const pickMesh = new Mesh(solidGeometry, pickMaterial);

  const root = new Group();
  root.add(pickMesh);
  root.add(wire);
  applyPrimitiveToRoot(root, primitive);
  return { root, wire, pickMesh, solidGeometry, wireGeometry, wireMaterial, pickMaterial };
}

/** Drives a unit overlay's transform from the primitive (center/rotation/size). */
function applyPrimitiveToRoot(root: Group, primitive: CollisionPrimitive): void {
  if (primitive.shape === "convex") {
    // Convex geometry is built at absolute points, so the root stays at identity.
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    return;
  }
  const center = primitive.center ?? [0, 0, 0];
  root.position.set(center[0], center[1], center[2]);
  const rotation = primitive.rotation ?? [0, 0, 0];
  root.rotation.set(degToRad(rotation[0]), degToRad(rotation[1]), degToRad(rotation[2]));
  const [sx, sy, sz] = primitive.size;
  root.scale.set(Math.max(sx || 1, 0.001), Math.max(sy || 1, 0.001), Math.max(sz || 1, 0.001));
}

interface KdopPlane {
  normal: Vector3;
  distance: number;
}

function computeKdopPoints(vertices: readonly Vector3[], kind: KdopKind): Vec3[] | null {
  if (vertices.length < 4) return null;
  const directions = kdopDirections(kind);
  const planes: KdopPlane[] = [];
  for (const direction of directions) {
    let min = Infinity;
    let max = -Infinity;
    for (const vertex of vertices) {
      const projection = direction.dot(vertex);
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }
    planes.push({ normal: direction.clone(), distance: max });
    planes.push({ normal: direction.clone().multiplyScalar(-1), distance: -min });
  }

  const points: Vec3[] = [];
  const seen = new Set<string>();
  for (let a = 0; a < planes.length - 2; a += 1) {
    for (let b = a + 1; b < planes.length - 1; b += 1) {
      for (let c = b + 1; c < planes.length; c += 1) {
        const point = intersectPlanes(planes[a]!, planes[b]!, planes[c]!);
        if (!point || !insidePlanes(point, planes)) continue;
        const key = `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        points.push([round(point.x), round(point.y), round(point.z)]);
      }
    }
  }
  return points.length >= 4 ? points : null;
}

function kdopDirections(kind: KdopKind): Vector3[] {
  const axes = [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ];
  const edgeDiagonals = [
    new Vector3(1, 1, 0),
    new Vector3(1, -1, 0),
    new Vector3(1, 0, 1),
    new Vector3(1, 0, -1),
    new Vector3(0, 1, 1),
    new Vector3(0, 1, -1),
  ];
  const cornerDiagonals = [
    new Vector3(1, 1, 1),
    new Vector3(1, 1, -1),
    new Vector3(1, -1, 1),
    new Vector3(-1, 1, 1),
  ];
  if (kind === "10DOP-X") {
    return normalizeDirections([...axes, new Vector3(0, 1, 1), new Vector3(0, 1, -1)]);
  }
  if (kind === "10DOP-Y") {
    return normalizeDirections([...axes, new Vector3(1, 0, 1), new Vector3(1, 0, -1)]);
  }
  if (kind === "10DOP-Z") {
    return normalizeDirections([...axes, new Vector3(1, 1, 0), new Vector3(1, -1, 0)]);
  }
  if (kind === "18DOP") return normalizeDirections([...axes, ...edgeDiagonals]);
  return normalizeDirections([...axes, ...edgeDiagonals, ...cornerDiagonals]);
}

function normalizeDirections(directions: Vector3[]): Vector3[] {
  return directions.map((direction) => direction.normalize());
}

function intersectPlanes(a: KdopPlane, b: KdopPlane, c: KdopPlane): Vector3 | null {
  const n1 = a.normal;
  const n2 = b.normal;
  const n3 = c.normal;
  const denominator = n1.dot(new Vector3().crossVectors(n2, n3));
  if (Math.abs(denominator) < 1e-8) return null;
  const term1 = new Vector3().crossVectors(n2, n3).multiplyScalar(a.distance);
  const term2 = new Vector3().crossVectors(n3, n1).multiplyScalar(b.distance);
  const term3 = new Vector3().crossVectors(n1, n2).multiplyScalar(c.distance);
  return term1.add(term2).add(term3).multiplyScalar(1 / denominator);
}

function insidePlanes(point: Vector3, planes: readonly KdopPlane[]): boolean {
  return planes.every((plane) => plane.normal.dot(point) <= plane.distance + 1e-4);
}

function disposeOverlay(overlay: PrimitiveOverlay): void {
  overlay.solidGeometry.dispose();
  overlay.wireGeometry.dispose();
  overlay.wireMaterial.dispose();
  overlay.pickMaterial.dispose();
}

function clonePrimitive(primitive: CollisionPrimitive): CollisionPrimitive {
  const clone: CollisionPrimitive = { shape: primitive.shape, size: [...primitive.size] as Vec3 };
  if (primitive.center) clone.center = [...primitive.center] as Vec3;
  if (primitive.rotation) clone.rotation = [...primitive.rotation] as Vec3;
  if (primitive.points) clone.points = primitive.points.map((point) => [...point] as Vec3);
  return clone;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundDeg(value: number): number {
  return Number(value.toFixed(2));
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function rgbHex(color: readonly [number, number, number, number]): string {
  return color
    .slice(0, 3)
    .map((value) => Math.round(clampUnit(value) * 255).toString(16).padStart(2, "0"))
    .join("");
}

function hexRgb(value: string): [number, number, number] {
  const hex = value.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return [1, 1, 1];
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatVec3(value: Vec3): string {
  return value.map((axis) => axis.toFixed(2)).join(", ");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
