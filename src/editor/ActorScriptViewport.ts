/**
 * Actor Script editor 3D viewport — a self-contained, read-only preview of a
 * class's component tree, rendered with its own `WebGLRenderer` / camera /
 * scene / grid / orbit controls (the {@link StaticMeshEditor} viewport pattern).
 *
 * It consumes the pure {@link actorPreviewNodes} helper (engine, Three.js-free)
 * and builds one `Object3D` per node, parenting nodes via `parent` so Three.js
 * composes the world transform. Meshes load lazily (cached) with a placeholder
 * box until ready; colliders draw wireframes; lights add a light + gizmo; other
 * components render a small icon marker.
 *
 * A class with a `Vehicle` component also gets its wheels drawn over the model
 * (vehicle plan Faz 5, {@link setVehicleWheels}): per wheel a hard-point handle,
 * the spring range and the tyre circle, in the actor-root (chassis) frame the
 * runtime wheel rig uses. Clicking a handle selects that wheel and the Move
 * gizmo drags its hard point ({@link ActorScriptViewportOptions.onMoveWheel}).
 *
 * Editor-only: lives under `src/editor/`, behind the dynamic `?editor` import,
 * so it never ships in the game build. The whole viewport disposes cleanly when
 * the editor closes.
 */
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Spherical,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";

import {
  actorPreviewNodes,
  type ActorPreviewNode,
  type PreviewCollider,
  type PreviewLight,
} from "@engine/scene/actorPreview";
import type { ActorScriptDef } from "@engine/scene/actorScript";
import {
  createLightObject,
  disposeLightGizmo,
  type LightObjectRecord,
  type LightRenderItem,
} from "@engine/render-three/lights";
import { createForgeGltfLoader } from "@engine/render-three/gltfLoader";
import { applyEulerDegrees } from "@engine/render-three/transforms";
import { projectFileUrl } from "@/project/ProjectSystem";
import { wheelWireSegments, type VehicleWheelPreview } from "@/editor/vehicleAssetEditorModel";

export interface ActorScriptViewportOptions {
  /** The element the canvas mounts into (the editor's `[data-as-viewport]`). */
  host: HTMLElement;
  /** Resolves a manifest asset id to a public-relative model path, or undefined. */
  resolveModelPath: (assetId: string) => string | undefined;
  /** Notified when the user clicks a node's object in the viewport (or empty → null). */
  onPickNode?: (nodeId: string | null) => void;
  /** Notified (live, during drag) when a transform gizmo edits a node's local transform. */
  onTransformNode?: (nodeId: string, transform: NodeTransform) => void;
  /** A wheel's hard-point handle was clicked (null: a click elsewhere cleared it). */
  onPickWheel?: (index: number | null) => void;
  /** Live, during drag: the selected wheel's new hard point (chassis frame, metres). */
  onMoveWheel?: (index: number, position: [number, number, number]) => void;
}

/** A node's local transform written back from the viewport gizmo (rotation in degrees). */
export interface NodeTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

type GizmoMode = "select" | "translate" | "rotate" | "scale";

const GIZMO_BUTTONS: ReadonlyArray<{ mode: GizmoMode; glyph: string; title: string }> = [
  { mode: "select", glyph: "▦", title: "Select (no gizmo)" },
  { mode: "translate", glyph: "✥", title: "Move" },
  { mode: "rotate", glyph: "⟳", title: "Rotate" },
  { mode: "scale", glyph: "⤢", title: "Scale" },
];

const PLACEHOLDER_COLOR = 0x8a8f96;
const COLLIDER_COLOR = 0x49e6a2;
const SENSOR_COLOR = 0xffb648;
// Matches the main scene's selection outline (editorSelectionOutline.ts).
// Keep the asset viewport selection look aligned with the editor UI accent.
const SELECT_OUTLINE_COLOR = 0x2f6fed;
const WHEEL_WIRE_COLOR = 0xffd166;
// Cyan: stands out on the warm car bodies the yellow wire and orange sensors share.
const WHEEL_HANDLE_COLOR = 0x22d3ee;
const WHEEL_SELECTED_COLOR = 0xffffff;
const MARKER_GLYPHS: Record<string, string> = {
  Audio: "♪",
  ParticleEmitter: "✺",
  Interaction: "☞",
  Behavior: "⚙",
  CharacterMovement: "CM",
  Metadata: "ℹ",
};

export class ActorScriptViewport {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  private readonly modelGroup = new Group();
  private readonly loader: GLTFLoader;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private readonly hintEl: HTMLElement;
  private readonly toolsEl: HTMLElement;
  private transformControls: TransformControls | null = null;
  private gizmoMode: GizmoMode = "select";
  private gizmoDragging = false;

  private readonly target = new Vector3(0, 0.5, 0);
  private readonly spherical = new Spherical(5, Math.PI / 3, Math.PI / 4);
  private userAdjustedCamera = false;

  /** node id → its group (root of that node's local subtree). */
  private readonly nodeObjects = new Map<string, Group>();
  private composer: EffectComposer | null = null;
  private outlinePass: OutlinePass | null = null;
  private selectedNodeId: string | null = null;

  /** Loaded GLTF cache keyed by public-relative model path. */
  private readonly modelCache = new Map<string, Promise<GLTF>>();
  private buildGeneration = 0;

  // Per-build disposables (cleared on each rebuild + at teardown).
  private readonly buildGeometries: BufferGeometry[] = [];
  private readonly buildMaterials: Material[] = [];
  private readonly buildTextures: Texture[] = [];
  private readonly buildLightGizmos: Object3D[] = [];

  /** Vehicle wheel wires (scene-level, identity = actor root); rebuilt by setVehicleWheels. */
  private readonly vehicleGroup = new Group();
  private wheelGroups: Group[] = [];
  private readonly wheelHandles: Mesh[] = [];
  private readonly vehicleGeometries: BufferGeometry[] = [];
  private readonly vehicleMaterials: Material[] = [];
  private selectedWheel: number | null = null;

  private rafId = 0;
  private disposed = false;

  constructor(private readonly options: ActorScriptViewportOptions) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    options.host.append(this.renderer.domElement);
    this.loader = createForgeGltfLoader(this.renderer);

    this.hintEl = document.createElement("div");
    this.hintEl.className = "as-viewport-hint";
    this.hintEl.textContent = "Add components to preview this class.";
    options.host.append(this.hintEl);

    this.toolsEl = this.buildToolbar();
    options.host.append(this.toolsEl);

    this.buildScene();
    this.bindCameraControls();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(options.host);
    this.resize();
    this.startRenderLoop();
  }

  // --- scene setup -------------------------------------------------------

  private buildScene(): void {
    this.scene.background = new Color(0x23262b);
    this.scene.add(new AmbientLight(0xffffff, 1.0));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 2.5);
    this.scene.add(key);
    const fill = new DirectionalLight(0xb9d4ff, 0.9);
    fill.position.set(-3, 2.5, -2);
    this.scene.add(fill);

    const grid = new GridHelper(20, 40, 0x55585c, 0x33373d);
    this.scene.add(grid);
    this.scene.add(this.modelGroup);
    this.vehicleGroup.name = "as-vehicle-wheels";
    this.scene.add(this.vehicleGroup);

    const controls = new TransformControls(this.camera, this.renderer.domElement);
    controls.setSize(0.8);
    controls.addEventListener("dragging-changed", (event) => {
      this.gizmoDragging = event.value === true;
    });
    controls.addEventListener("objectChange", () => this.onGizmoChange());
    this.scene.add(controls.getHelper());
    this.transformControls = controls;

    this.setupComposer();
    this.updateCamera();
  }

  /**
   * Post-process pipeline (RenderPass → OutlinePass → OutputPass) so a selected
   * node is drawn with the same glowing outline as the main scene's selection,
   * instead of a bounding box. Sized lazily by {@link resize}.
   */
  private setupComposer(): void {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const outline = new OutlinePass(new Vector2(1, 1), this.scene, this.camera, []);
    outline.visibleEdgeColor.set(SELECT_OUTLINE_COLOR);
    outline.hiddenEdgeColor.set(SELECT_OUTLINE_COLOR);
    outline.edgeStrength = 4.5;
    outline.edgeThickness = 1.5;
    outline.edgeGlow = 0;
    outline.pulsePeriod = 0;
    composer.addPass(outline);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.outlinePass = outline;
  }

  // --- gizmo (move / rotate / scale) -------------------------------------

  private buildToolbar(): HTMLElement {
    const tools = document.createElement("div");
    tools.className = "as-viewport-tools";
    tools.innerHTML = GIZMO_BUTTONS.map(
      (button) =>
        `<button type="button" data-gizmo="${button.mode}" title="${button.title}" class="${
          button.mode === this.gizmoMode ? "is-active" : ""
        }">${button.glyph}</button>`,
    ).join("");
    tools.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
      btn.addEventListener("click", () => this.setGizmoMode(btn.dataset.gizmo as GizmoMode));
    });
    return tools;
  }

  private setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.toolsEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.gizmo === mode);
    });
    this.attachGizmo();
  }

  /**
   * Attaches the gizmo to the selected wheel (always Move: a hard point is a
   * position) or else the selected node's group (detached in Select mode / none).
   */
  private attachGizmo(): void {
    const controls = this.transformControls;
    if (!controls) return;
    const wheel = this.selectedWheel !== null ? this.wheelGroups[this.selectedWheel] : undefined;
    if (wheel) {
      controls.setMode("translate");
      controls.attach(wheel);
      return;
    }
    const group = this.selectedNodeId ? this.nodeObjects.get(this.selectedNodeId) : undefined;
    if (!group || this.gizmoMode === "select") {
      controls.detach();
      return;
    }
    controls.setMode(this.gizmoMode);
    controls.attach(group);
  }

  /** Live write-back: the dragged group's local transform → the node's props. */
  private onGizmoChange(): void {
    const wheel = this.selectedWheel !== null ? this.wheelGroups[this.selectedWheel] : undefined;
    if (wheel && this.transformControls?.object === wheel) {
      this.options.onMoveWheel?.(this.selectedWheel!, [
        round(wheel.position.x),
        round(wheel.position.y),
        round(wheel.position.z),
      ]);
      return;
    }
    if (!this.selectedNodeId || !this.options.onTransformNode) return;
    const group = this.nodeObjects.get(this.selectedNodeId);
    if (!group) return;
    this.options.onTransformNode(this.selectedNodeId, {
      position: [round(group.position.x), round(group.position.y), round(group.position.z)],
      rotation: [
        roundDeg(MathUtils.radToDeg(group.rotation.x)),
        roundDeg(MathUtils.radToDeg(group.rotation.y)),
        roundDeg(MathUtils.radToDeg(group.rotation.z)),
      ],
      scale: [
        round(Math.max(group.scale.x, 0.001)),
        round(Math.max(group.scale.y, 0.001)),
        round(Math.max(group.scale.z, 0.001)),
      ],
    });
  }

  private updateCamera(): void {
    const offset = new Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  private startRenderLoop(): void {
    const tick = (): void => {
      if (this.disposed) return;
      // The OutlinePass reads the selected group live, so async-loaded meshes and
      // gizmo edits update the outline automatically.
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private resize(): void {
    const width = this.options.host.clientWidth || 1;
    const height = this.options.host.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Composer.setSize propagates to the OutlinePass's internal render targets.
    this.composer?.setSize(width, height);
  }

  // --- camera controls (orbit / pan / dolly) -----------------------------

  private bindCameraControls(): void {
    const el = this.renderer.domElement;
    let mode: "orbit" | "pan" | null = null;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    el.addEventListener("contextmenu", (event) => event.preventDefault());
    el.addEventListener("pointerdown", (event) => {
      // Let the transform gizmo own the drag when the pointer is over a handle.
      if (this.transformControls?.axis) return;
      lastX = event.clientX;
      lastY = event.clientY;
      downX = event.clientX;
      downY = event.clientY;
      mode = event.button === 1 || event.shiftKey || event.button === 2 ? "pan" : "orbit";
      el.setPointerCapture(event.pointerId);
    });
    el.addEventListener("pointermove", (event) => {
      if (!mode || this.gizmoDragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      this.userAdjustedCamera = true;
      if (mode === "orbit") {
        this.spherical.theta -= dx * 0.01;
        this.spherical.phi = clamp(this.spherical.phi - dy * 0.01, 0.05, Math.PI - 0.05);
      } else {
        const panScale = this.spherical.radius * 0.0015;
        const right = new Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        this.target.addScaledVector(right, -dx * panScale);
        this.target.addScaledVector(up, dy * panScale);
      }
      this.updateCamera();
    });
    const end = (event: PointerEvent): void => {
      const wasDragging = mode !== null;
      mode = null;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      // A click (no meaningful drag, left button) picks a node under the cursor.
      if (
        wasDragging &&
        event.button === 0 &&
        Math.hypot(event.clientX - downX, event.clientY - downY) < 4
      ) {
        this.pickAt(event);
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.userAdjustedCamera = true;
        const factor = Math.exp(event.deltaY * 0.001);
        this.spherical.radius = clamp(this.spherical.radius * factor, 0.2, 200);
        this.updateCamera();
      },
      { passive: false },
    );
  }

  // --- build the component tree ------------------------------------------

  /** Rebuilds the whole preview from the class def (full rebuild for v1). */
  setDef(def: ActorScriptDef): void {
    if (this.disposed) return;
    this.buildGeneration += 1;
    this.clearBuild();

    const nodes = actorPreviewNodes(def);
    // First pass: a group per node with its local transform applied.
    for (const node of nodes) {
      const group = new Group();
      group.name = node.id;
      group.userData.nodeId = node.id;
      group.position.set(...node.position);
      applyEulerDegrees(group, node.rotation);
      group.scale.set(...node.scale);
      this.nodeObjects.set(node.id, group);
    }
    // Second pass: parent each node (unresolved parent → modelGroup root) and
    // attach its kind-specific visual.
    let visibleCount = 0;
    for (const node of nodes) {
      const group = this.nodeObjects.get(node.id)!;
      const parent = node.parent ? this.nodeObjects.get(node.parent) : undefined;
      (parent ?? this.modelGroup).add(group);
      if (this.attachVisual(node, group)) visibleCount += 1;
    }

    this.hintEl.style.display = visibleCount > 0 ? "none" : "";
    this.refreshOutline();
    this.attachGizmo();
    if (!this.userAdjustedCamera) this.frameToContent();
  }

  /** Adds the node's visual to its group; returns whether it produced content. */
  private attachVisual(node: ActorPreviewNode, group: Group): boolean {
    if (node.mesh) {
      this.attachMesh(node.mesh.assetId, group);
      return true;
    }
    if (node.collider) {
      group.add(this.buildColliderWire(node.collider));
      return true;
    }
    if (node.light) {
      group.add(this.buildLight(node.light));
      return true;
    }
    const glyph = MARKER_GLYPHS[node.component];
    if (glyph) {
      group.add(this.buildMarker(glyph));
      return true;
    }
    return false;
  }

  // --- mesh ---------------------------------------------------------------

  private attachMesh(assetId: string | undefined, group: Group): void {
    // Immediate placeholder; replaced by the model when it resolves.
    const placeholder = this.buildPlaceholderBox();
    placeholder.name = "as-placeholder";
    group.add(placeholder);

    const path = assetId ? this.options.resolveModelPath(assetId) : undefined;
    if (!path) return; // missing / shape: asset → keep the placeholder box

    const generation = this.buildGeneration;
    void this.loadModel(path)
      .then((gltf) => {
        // Drop the result if a rebuild happened or the group was detached.
        if (this.disposed || generation !== this.buildGeneration) return;
        const existing = group.getObjectByName("as-placeholder");
        if (existing) group.remove(existing);
        const model = gltf.scene.clone(true);
        model.name = "as-mesh";
        group.add(model);
        if (!this.userAdjustedCamera) this.frameToContent();
      })
      .catch(() => {
        // Leave the placeholder box on load failure.
      });
  }

  private loadModel(path: string): Promise<GLTF> {
    let promise = this.modelCache.get(path);
    if (!promise) {
      promise = this.loader.loadAsync(projectFileUrl(path));
      this.modelCache.set(path, promise);
    }
    return promise;
  }

  private buildPlaceholderBox(): Mesh {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial({
      color: PLACEHOLDER_COLOR,
      roughness: 0.85,
      metalness: 0,
      transparent: true,
      opacity: 0.6,
    });
    this.buildGeometries.push(geometry);
    this.buildMaterials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.position.y = 0.5;
    return mesh;
  }

  // --- collider -----------------------------------------------------------

  private buildColliderWire(collider: PreviewCollider): Object3D {
    const wireGeometry =
      collider.shape === "capsule" ? capsuleWireGeometry(collider.size) : edgedUnitGeometry(collider.shape);
    const material = new LineBasicMaterial({
      color: collider.isSensor ? SENSOR_COLOR : COLLIDER_COLOR,
      transparent: true,
      depthTest: false,
    });
    this.buildGeometries.push(wireGeometry);
    this.buildMaterials.push(material);
    const wire = new LineSegments(wireGeometry, material);
    wire.renderOrder = 3;
    if (collider.shape !== "capsule") {
      const [sx, sy, sz] = collider.size;
      wire.scale.set(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001));
    }
    if (collider.center) wire.position.set(...collider.center);
    if (collider.rotation) applyEulerDegrees(wire, collider.rotation);
    return wire;
  }

  // --- light --------------------------------------------------------------

  private buildLight(light: PreviewLight): Object3D {
    const item: LightRenderItem = {
      name: "preview-light",
      type: light.type,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      hidden: false,
    };
    if (light.color !== undefined) item.color = light.color;
    if (light.intensity !== undefined) item.intensity = light.intensity;
    if (light.distance !== undefined) item.distance = light.distance;
    if (light.angle !== undefined) item.angle = light.angle;
    if (light.penumbra !== undefined) item.penumbra = light.penumbra;
    if (light.decay !== undefined) item.decay = light.decay;
    const record: LightObjectRecord = createLightObject(item, light.color ?? "#ffffff");
    // Always show the reach wireframe in the editor preview.
    const wire = record.gizmo.getObjectByName("light-wire");
    if (wire) wire.visible = true;
    this.buildLightGizmos.push(record.gizmo);
    // The target is already positioned (and its world matrix updated) at creation;
    // leaving it out of the node subtree avoids a double transform when nested.
    return record.root;
  }

  // --- generic marker -----------------------------------------------------

  private buildMarker(glyph: string): Sprite {
    const texture = makeGlyphTexture(glyph);
    const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    this.buildTextures.push(texture);
    this.buildMaterials.push(material);
    const sprite = new Sprite(material);
    sprite.scale.set(0.5, 0.5, 0.5);
    sprite.position.y = 0.5;
    return sprite;
  }

  // --- selection ----------------------------------------------------------

  setSelection(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.refreshOutline();
    this.attachGizmo();
  }

  /** Points the OutlinePass at the selected node's group (the scene's selection look). */
  private refreshOutline(): void {
    if (!this.outlinePass) return;
    const group = this.selectedNodeId ? this.nodeObjects.get(this.selectedNodeId) : undefined;
    this.outlinePass.selectedObjects = group ? [group] : [];
  }

  private pickAt(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    // Wheel handles sit on top (drawn without depth test), so they pick first.
    const wheelHit = this.raycaster.intersectObjects(this.wheelHandles, false)[0];
    if (wheelHit && this.options.onPickWheel) {
      this.options.onPickWheel(wheelHit.object.userData.wheelIndex as number);
      return;
    }
    if (this.selectedWheel !== null) this.options.onPickWheel?.(null);
    if (!this.options.onPickNode) return;
    const hits = this.raycaster.intersectObject(this.modelGroup, true);
    for (const hit of hits) {
      const nodeId = findNodeId(hit.object);
      if (nodeId) {
        this.options.onPickNode(nodeId);
        return;
      }
    }
    this.options.onPickNode(null);
  }

  // --- vehicle wheels -----------------------------------------------------

  /**
   * Draws (or with null, clears) the class's wheels. Skipped mid-drag: the
   * dragged wheel group already shows the edit and must keep its gizmo.
   */
  setVehicleWheels(wheels: readonly VehicleWheelPreview[] | null): void {
    if (this.disposed || this.gizmoDragging) return;
    const attachedToWheel = this.wheelGroups.includes(this.transformControls?.object as Group);
    if (attachedToWheel) this.transformControls?.detach();
    this.clearVehicleWheels();
    (wheels ?? []).forEach((wheel, index) => {
      const group = new Group();
      group.name = `as-wheel-${index}`;
      group.position.set(...wheel.position);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(wheelWireSegments(wheel), 3));
      const lineMaterial = new LineBasicMaterial({ color: WHEEL_WIRE_COLOR, transparent: true, depthTest: false });
      const wire = new LineSegments(geometry, lineMaterial);
      wire.renderOrder = 4;
      const handleGeometry = new SphereGeometry(0.06, 12, 8);
      const handleMaterial = new MeshStandardMaterial({ color: WHEEL_HANDLE_COLOR, depthTest: false, transparent: true });
      const handle = new Mesh(handleGeometry, handleMaterial);
      handle.renderOrder = 5;
      handle.userData.wheelIndex = index;
      group.add(wire, handle);
      this.vehicleGeometries.push(geometry, handleGeometry);
      this.vehicleMaterials.push(lineMaterial, handleMaterial);
      this.wheelHandles.push(handle);
      this.wheelGroups.push(group);
      this.vehicleGroup.add(group);
    });
    if (this.selectedWheel !== null && this.selectedWheel >= this.wheelGroups.length) this.selectedWheel = null;
    this.refreshWheelHighlight();
    this.attachGizmo();
  }

  /** Selects a wheel for the Move gizmo (null: back to node selection). */
  setSelectedWheel(index: number | null): void {
    if (this.selectedWheel === index) return;
    this.selectedWheel = index;
    this.refreshWheelHighlight();
    this.attachGizmo();
  }

  private refreshWheelHighlight(): void {
    this.wheelHandles.forEach((handle, index) => {
      (handle.material as MeshStandardMaterial).color.setHex(
        index === this.selectedWheel ? WHEEL_SELECTED_COLOR : WHEEL_HANDLE_COLOR,
      );
      handle.scale.setScalar(index === this.selectedWheel ? 1.5 : 1);
    });
  }

  private clearVehicleWheels(): void {
    for (const group of this.wheelGroups) group.removeFromParent();
    this.wheelGroups = [];
    this.wheelHandles.length = 0;
    for (const geometry of this.vehicleGeometries) geometry.dispose();
    for (const material of this.vehicleMaterials) material.dispose();
    this.vehicleGeometries.length = 0;
    this.vehicleMaterials.length = 0;
  }

  // --- framing ------------------------------------------------------------

  private frameToContent(): void {
    this.modelGroup.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(this.modelGroup);
    if (bounds.isEmpty()) {
      this.target.set(0, 0.5, 0);
      this.spherical.radius = 5;
      this.updateCamera();
      return;
    }
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.5);
    this.target.copy(center);
    this.spherical.radius = radius * 2.6;
    this.updateCamera();
  }

  // --- teardown -----------------------------------------------------------

  private clearBuild(): void {
    // Detach the gizmo before the node groups it points at are removed.
    this.transformControls?.detach();
    // The node groups are about to be removed; drop the outline's stale references.
    if (this.outlinePass) this.outlinePass.selectedObjects = [];
    // Remove every node group; cloned model children share cached resources, so
    // they are detached (not disposed) — only build-created resources dispose.
    for (const group of this.nodeObjects.values()) {
      group.removeFromParent();
    }
    this.nodeObjects.clear();
    this.modelGroup.clear();
    for (const geometry of this.buildGeometries) geometry.dispose();
    for (const material of this.buildMaterials) material.dispose();
    for (const texture of this.buildTextures) texture.dispose();
    for (const gizmo of this.buildLightGizmos) disposeLightGizmo(gizmo);
    this.buildGeometries.length = 0;
    this.buildMaterials.length = 0;
    this.buildTextures.length = 0;
    this.buildLightGizmos.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.clearBuild();
    this.clearVehicleWheels();
    if (this.transformControls) {
      this.transformControls.detach();
      this.transformControls.dispose();
      this.transformControls = null;
    }
    // Dispose cached model resources once (clones shared these buffers).
    for (const promise of this.modelCache.values()) {
      void promise.then((gltf) => disposeGltf(gltf)).catch(() => {});
    }
    this.modelCache.clear();
    this.outlinePass?.dispose();
    this.composer?.dispose();
    this.outlinePass = null;
    this.composer = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hintEl.remove();
    this.toolsEl.remove();
  }
}

// --- helpers --------------------------------------------------------------

/** Unit-sized solid geometry whose bounding box is 1×1×1 (scaled to collider size). */
function unitGeometryForShape(shape: PreviewCollider["shape"]): BufferGeometry {
  switch (shape) {
    case "sphere":
      return new SphereGeometry(0.5, 16, 12);
    case "capsule":
      return capsuleWireGeometry([1, 1, 1]);
    case "cylinder":
    case "cone":
      return new CylinderGeometry(0.5, 0.5, 1, 20);
    default:
      return new BoxGeometry(1, 1, 1);
  }
}

function edgedUnitGeometry(shape: PreviewCollider["shape"]): BufferGeometry {
  const solid = unitGeometryForShape(shape);
  if (shape === "capsule") return solid;
  const wire = new EdgesGeometry(solid);
  solid.dispose();
  return wire;
}

function capsuleWireGeometry(size: readonly number[]): BufferGeometry {
  const radius = Math.max(size[0] ?? 1, size[2] ?? 1, 0.001) / 2;
  const halfHeight = Math.max((size[1] ?? 1) / 2, radius);
  const cylinderHalfHeight = Math.max(0, halfHeight - radius);
  const positions: number[] = [];
  pushCapsuleProfile(positions, "x", radius, cylinderHalfHeight);
  pushCapsuleProfile(positions, "z", radius, cylinderHalfHeight);
  pushCapsuleRing(positions, cylinderHalfHeight, radius);
  pushCapsuleRing(positions, -cylinderHalfHeight, radius);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

function pushCapsuleProfile(
  positions: number[],
  plane: "x" | "z",
  radius: number,
  cylinderHalfHeight: number,
): void {
  const arcSteps = 16;
  const sideSteps = 4;
  const points: Vector3[] = [];
  const point = (across: number, y: number): Vector3 =>
    plane === "x" ? new Vector3(across, y, 0) : new Vector3(0, y, across);

  for (let i = 0; i <= arcSteps; i += 1) {
    const t = (i / arcSteps) * Math.PI;
    points.push(point(radius * Math.cos(t), cylinderHalfHeight + radius * Math.sin(t)));
  }
  for (let i = 1; i < sideSteps; i += 1) {
    points.push(point(-radius, cylinderHalfHeight - (i / sideSteps) * (2 * cylinderHalfHeight)));
  }
  for (let i = 0; i <= arcSteps; i += 1) {
    const t = Math.PI + (i / arcSteps) * Math.PI;
    points.push(point(radius * Math.cos(t), -cylinderHalfHeight + radius * Math.sin(t)));
  }
  for (let i = 1; i < sideSteps; i += 1) {
    points.push(point(radius, -cylinderHalfHeight + (i / sideSteps) * (2 * cylinderHalfHeight)));
  }
  pushLoopSegments(positions, points);
}

function pushCapsuleRing(positions: number[], y: number, radius: number): void {
  const segments = 48;
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    positions.push(
      Math.cos(a0) * radius,
      y,
      Math.sin(a0) * radius,
      Math.cos(a1) * radius,
      y,
      Math.sin(a1) * radius,
    );
  }
}

function pushLoopSegments(positions: number[], points: readonly Vector3[]): void {
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

function makeGlyphTexture(glyph: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = "rgba(20,23,27,0.85)";
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8fd0ff";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#e7eef3";
    ctx.font = "32px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, 32, 34);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Walks up the parent chain to the nearest node group's id. */
function findNodeId(object: Object3D): string | null {
  let current: Object3D | null = object;
  while (current) {
    const nodeId = current.userData?.nodeId;
    if (typeof nodeId === "string") return nodeId;
    current = current.parent;
  }
  return null;
}

function disposeGltf(gltf: GLTF): void {
  gltf.scene.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: Material): void {
  const slots = material as unknown as Record<string, unknown>;
  for (const value of Object.values(slots)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundDeg(value: number): number {
  return Number(value.toFixed(2));
}
