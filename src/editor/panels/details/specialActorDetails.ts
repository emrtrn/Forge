import { assetType, isModelAssetType, type EditableAsset } from "@engine/assets/manifest";
import type { BrushShape, LayoutLightActor, Vec3 } from "@engine/scene/layout";
import type { ForgeSplineDeformMeshGeneratorDef, ForgeSplineGeneratorDef, ForgeSplineInstanceGeneratorDef, ForgeSplineRigidSegmentGeneratorDef, SplineMeshAxis } from "@engine/scene/splineGenerator";
import { BRUSH_SHAPES } from "@engine/scene/blockingVolume";
import { NAVIGATION_ROLE_VALUES, type NavigationRole } from "@engine/scene/collision";
import { splinePerformanceWarnings } from "@engine/scene/splineDiagnostics";
import type {
  EditableAiNavigationVolume,
  EditableBlockingVolume,
  EditableSelection,
  LandscapeEditMode,
  LandscapeLayerView,
  LandscapeSplineView,
  LandscapeSplinePointView,
  LandscapeSplineSegmentView,
  LandscapeSplineSegmentPatch,
  LandscapePaintTool,
  LandscapeSculptSettings,
  LandscapeSculptTool,
  LandscapeSplineTool,
  TargetPointReference,
} from "@/scene/SceneApp";
import { type LandscapeViewMode } from "@engine/render-three/landscape";
import { axisField, scaleRow, vectorRow } from "./transformRows";

type CaptureNumericKey = "radius" | "intensity" | "resolution" | "near" | "far" | "priority";
type SurfaceNumericKey =
  | "reflectionStrength"
  | "fresnelPower"
  | "fresnelBias"
  | "distortion"
  | "resolution";

interface TransformBindOptions {
  body: HTMLElement;
  selection: EditableSelection;
  beginDetailsEdit: () => void;
  applyDetails: () => void;
  applyScaleInput: (input: HTMLInputElement) => void;
  commitDetailsEdit: () => void;
  setSelectionScaleLocked: (locked: boolean) => void;
  renameSceneObject: (id: string, name: string) => void;
  handleDetailToggle: (toggle: string, checked: boolean) => void;
}

export interface SpecialActorDetailsOptions extends TransformBindOptions {
  editableAssets: readonly EditableAsset[];
  targetPoints: readonly TargetPointReference[];
  setDetailsScale: (scale: Vec3) => void;
  setSelectedLightSettings: (values: Partial<LayoutLightActor>) => void;
  setSelectedReflectionPlane: (patch: { color?: string; resolution?: number | undefined }) => void;
  setSelectedReflectiveSurface: (patch: {
    material?: string | null;
    reflectionStrength?: number;
    fresnelPower?: number;
    fresnelBias?: number;
    distortion?: number;
    tint?: string;
    resolution?: number | undefined;
  }) => void;
  setSelectedBlockingVolume: (patch: {
    brushShape?: BrushShape;
    size?: Vec3;
    brushSides?: number;
    renderInGame?: boolean;
    color?: string;
    navigationRole?: NavigationRole;
  }) => void;
  setSelectedAiNavigationVolume: (patch: {
    size?: Vec3;
    agentRadius?: number;
    clearancePadding?: number;
  }) => void;
  setSelectedTargetPoint: (patch: {
    nextTargetPoint?: string | undefined;
    startPoint?: boolean;
    waitTime?: number;
    acceptanceRadius?: number;
    speedOverride?: number | null;
    patrolTag?: string;
    color?: string;
  }) => void;
  setSelectedSpline: (patch: { closed?: boolean; debugVisible?: boolean; debugResolution?: number; showPointIds?: boolean }) => void;
  getSelectedSplineGenerators: () => ForgeSplineGeneratorDef[];
  getSelectedSplineGeneratorDiagnostics: () => Array<{ generatorId: string; instanceCount: number; triangleCount: number; rebuildMs: number | null; preview: boolean; missingAssetId: string | null; warnings: string[] }>;
  addSelectedSplineInstanceGenerator: () => void;
  addSelectedSplineRigidSegmentGenerator: () => void;
  addSelectedSplineDeformMeshGenerator: () => void;
  removeSelectedSplineGenerator: (generatorId: string) => void;
  setSelectedSplineInstanceGenerator: (generatorId: string, patch: Partial<ForgeSplineInstanceGeneratorDef>) => void;
  setSelectedSplineRigidSegmentGenerator: (generatorId: string, patch: Partial<ForgeSplineRigidSegmentGeneratorDef>) => void;
  setSelectedSplineDeformMeshGenerator: (generatorId: string, patch: Partial<ForgeSplineDeformMeshGeneratorDef>) => void;
  getSelectedSplinePoints: () => Array<{ id: string; position: Vec3; pointType: "linear" | "curveAuto" | "curveCustom"; tangentsLinked: boolean }>;
  getActiveSplinePointId: () => string | null;
  selectSplinePoint: (pointId: string | null) => void;
  addSelectedSplinePoint: () => void;
  deleteSelectedSplinePoint: (pointId?: string | null) => void;
  splitSelectedSplineSegment: (segmentIndex?: number) => void;
  setSelectedSplinePoint: (pointId: string, patch: { position?: Vec3; pointType?: "linear" | "curveAuto" | "curveCustom" }) => void;
  setSelectedSplinePointTangentsLinked: (pointId: string, linked: boolean) => void;
  setSelectedReflectionCapture: (patch: {
    radius?: number;
    intensity?: number;
    resolution?: number;
    near?: number;
    far?: number;
    parallax?: boolean;
    priority?: number;
  }) => void;
  setSelectedLandscape: (patch: { collision?: boolean }) => void;
  getLandscapeSculptSettings: () => LandscapeSculptSettings;
  setLandscapeSculptSettings: (
    patch: Partial<LandscapeSculptSettings>,
  ) => LandscapeSculptSettings;
  fillSelectedLandscapeLayer: (layerId?: string) => void;
  getSelectedLandscapeLayers: () => LandscapeLayerView[];
  getSelectedLandscapeSplines: () => LandscapeSplineView[];
  createSelectedLandscapeSpline: () => void;
  deleteSelectedLandscapeSpline: (splineId?: string | null) => void;
  closeSelectedLandscapeSpline: () => void;
  setSelectedLandscapeSplineSmooth: (smooth: boolean) => void;
  getSelectedLandscapeSplinePoints: () => LandscapeSplinePointView[];
  setSelectedLandscapeSplinePointPosition: (pointId: string, position: Vec3) => void;
  deleteSelectedLandscapeSplinePoint: (pointId?: string | null) => void;
  setSelectedLandscapeSplinePointShape: (pointId: string, patch: { width?: number; falloff?: number }) => void;
  getSelectedLandscapeSplineSegments: () => LandscapeSplineSegmentView[];
  splitSelectedLandscapeSplineSegment: (segmentId?: string | null) => void;
  setSelectedLandscapeSplineSegment: (segmentId: string, patch: LandscapeSplineSegmentPatch) => void;
  applySelectedLandscapeSplineDeform: () => void;
  applySelectedLandscapeSplinePaint: () => void;
  setSelectedLandscapeLayerMaterial: (layerId: string, materialId: string | null) => void;
  importSelectedLandscapeHeightmap: (rgba: ArrayLike<number>, width: number, height: number, heightRange: number) => Promise<void>;
  exportSelectedLandscapeHeightmap: () => { width: number; height: number; pixels: Uint8ClampedArray } | null;
  getSelectedLandscapeResolution: () => { verticesX: number; verticesZ: number; worldSize: number } | null;
  resampleSelectedLandscape: (preset: "small" | "medium" | "large") => void;
  setSelectedLandscapeWorldSize: (worldSize: number) => void;
  getSelectedLandscapeImportHeight: () => number;
  setSelectedWorldWidget: (patch: {
    widget?: string;
    worldPos?: Vec3;
    entityId?: string;
    offset3d?: Vec3;
    offset?: [number, number];
    maxDistance?: number;
  }) => void;
  isSelectedReflectionCaptureBakeStale: () => boolean;
  recaptureSelectedReflectionCapture: () => void;
  recaptureAllReflectionCaptures: () => void;
  rebakeAiNavigation: () => void;
}

const LANDSCAPE_SCULPT_TOOLS: readonly LandscapeSculptTool[] = [
  "raise",
  "lower",
  "smooth",
  "flatten",
];
const LANDSCAPE_PAINT_TOOLS: readonly LandscapePaintTool[] = ["paint", "erase", "smoothWeights"];
const LANDSCAPE_VIEW_MODES: readonly LandscapeViewMode[] = ["lit", "height", "slope", "layer"];
const LANDSCAPE_EDIT_MODES: readonly LandscapeEditMode[] = ["sculpt", "paint", "splines"];
const LANDSCAPE_SPLINE_TOOLS: readonly LandscapeSplineTool[] = ["draw", "edit"];

export function renderLandscapeDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection, editableAssets } = options;
  options.setDetailsScale([1, 1, 1]);
  const lockedAttr = selection.locked ? "disabled" : "";
  const settings = options.getLandscapeSculptSettings();
  const layers = options.getSelectedLandscapeLayers();
  const splines = options.getSelectedLandscapeSplines();
  const activeSpline = splines.find((spline) => spline.id === settings.activeSplineId);
  const splinePoints = options.getSelectedLandscapeSplinePoints();
  const activeSplinePoint = splinePoints.find((point) => point.id === settings.activeSplinePointId) ?? splinePoints.at(-1);
  const splineSegments = options.getSelectedLandscapeSplineSegments();
  const activeSegment = splineSegments.find((segment) => segment.id === settings.activeSplineSegmentId) ?? splineSegments.at(-1);
  const meshAssets = editableAssets.filter((asset) => assetType(asset) === "staticMesh");
  const resolution = options.getSelectedLandscapeResolution();
  const importHeight = options.getSelectedLandscapeImportHeight();
  const materialAssets = editableAssets.filter((asset) => assetType(asset) === "material");
  const materialNameById = new Map(
    materialAssets.map((asset) => [asset.id, asset.displayName ?? asset.name] as const),
  );
  const layerDisplayName = (layer: LandscapeLayerView): string =>
    layer.material ? materialNameById.get(layer.material) ?? layer.baseName : layer.baseName;
  const activeLayer = layers.find((layer) => layer.id === settings.activeLayerId) ?? layers[0];
  const layerMaterialOptions = [
    `<option value="" ${activeLayer?.material ? "" : "selected"}>None (preset ${escapeHtml(
      activeLayer?.baseName ?? "",
    )})</option>`,
  ]
    .concat(
      materialAssets.map(
        (asset) =>
          `<option value="${escapeHtml(asset.id)}" ${
            activeLayer?.material === asset.id ? "selected" : ""
          }>${escapeHtml(asset.displayName ?? asset.name)}</option>`,
      ),
    )
    .join("");
  const splinePointMarkup = activeSplinePoint
    ? `<div class="detail-subsection-title">Control Point</div>
      <div class="landscape-layer-list">${splinePoints
        .map(
          (point) =>
            `<button type="button" data-landscape-spline-point="${escapeHtml(point.id)}" class="${
              activeSplinePoint.id === point.id ? "active" : ""
            }" ${lockedAttr}>${escapeHtml(point.id)}</button>`,
        )
        .join("")}</div>
      <div class="detail-vector">
        <span class="detail-vector-label">Location</span>
        <div class="vector-fields">${["x", "y", "z"]
          .map(
            (axis, index) =>
              `<label class="axis-field axis-${axis}"><span class="axis-tag">${axis.toUpperCase()}</span><input data-landscape-spline-point-axis="${axis}" type="number" step="0.1" value="${Number(
                (activeSplinePoint.position[index] ?? 0).toFixed(3),
              )}" ${lockedAttr} /></label>`,
          )
          .join("")}</div>
      </div>
      <label class="detail-row"><span>Width</span><input data-landscape-spline-point-shape="width" type="number" min="0.1" step="0.1" value="${activeSplinePoint.width}" ${lockedAttr} /></label>
      <label class="detail-row"><span>Falloff</span><input data-landscape-spline-point-shape="falloff" type="number" min="0" step="0.1" value="${activeSplinePoint.falloff}" ${lockedAttr} /></label>
      <button type="button" class="detail-action-button" data-landscape-spline-point-delete ${lockedAttr}>Delete Point</button>`
    : "";
  const segmentLayerOptions = layers
    .map((layer) => `<option value="${escapeHtml(layer.id)}" ${activeSegment?.paint.layerId === layer.id ? "selected" : ""}>${escapeHtml(layerDisplayName(layer))}</option>`)
    .join("");
  const segmentMeshOptions = [`<option value="" ${activeSegment?.mesh.assetId ? "" : "selected"}>None</option>`]
    .concat(meshAssets.map((asset) => `<option value="${escapeHtml(asset.id)}" ${activeSegment?.mesh.assetId === asset.id ? "selected" : ""}>${escapeHtml(asset.displayName ?? asset.name)}</option>`))
    .join("");
  const splineSegmentMarkup = activeSegment
    ? `<div class="detail-subsection-title">Segment Effects</div>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="deform.enabled" ${activeSegment.deform.enabled ? "checked" : ""} ${lockedAttr} /><span>Deform Terrain</span></label>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="deform.flatten" ${activeSegment.deform.flatten ? "checked" : ""} ${lockedAttr} /><span>Flatten</span></label>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="deform.raiseTerrain" ${activeSegment.deform.raiseTerrain ? "checked" : ""} ${lockedAttr} /><span>Raise</span></label>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="deform.lowerTerrain" ${activeSegment.deform.lowerTerrain ? "checked" : ""} ${lockedAttr} /><span>Lower</span></label>
      <label class="detail-row"><span>Target Offset</span><input data-landscape-segment-number="deform.targetOffset" type="number" step="0.1" value="${activeSegment.deform.targetOffset}" ${lockedAttr} /></label>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="paint.enabled" ${activeSegment.paint.enabled ? "checked" : ""} ${lockedAttr} /><span>Paint Layer</span></label>
      <label class="detail-row"><span>Layer</span><select data-landscape-segment-layer ${lockedAttr}>${segmentLayerOptions}</select></label>
      <label class="detail-row"><span>Paint Strength</span><input data-landscape-segment-number="paint.strength" type="number" min="0" max="1" step="0.05" value="${activeSegment.paint.strength}" ${lockedAttr} /></label>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="mesh.enabled" ${activeSegment.mesh.enabled ? "checked" : ""} ${lockedAttr} /><span>Spline Mesh</span></label>
      <label class="detail-row"><span>Mesh</span><select data-landscape-segment-mesh ${lockedAttr}>${segmentMeshOptions}</select></label>
      <label class="detail-row"><span>Mesh Spacing</span><input data-landscape-segment-number="mesh.spacing" type="number" min="0.01" step="0.1" value="${activeSegment.mesh.spacing}" ${lockedAttr} /></label>
      <label class="detail-row"><span>Mesh Yaw</span><input data-landscape-segment-number="mesh.yawOffset" type="number" step="15" value="${activeSegment.mesh.yawOffset}" ${lockedAttr} /></label>
      <label class="detail-row"><span>Mesh Bank</span><input data-landscape-segment-number="mesh.bank" type="number" step="5" value="${activeSegment.mesh.bank}" ${lockedAttr} /></label>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="mesh.fitToLength" ${activeSegment.mesh.fitToLength ? "checked" : ""} ${lockedAttr} /><span>Fit Mesh To Segment</span></label>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="mesh.alignToTerrain" ${activeSegment.mesh.alignToTerrain ? "checked" : ""} ${lockedAttr} /><span>Align To Terrain</span></label>
      <label class="detail-toggle"><input type="checkbox" data-landscape-segment-flag="mesh.deform" ${activeSegment.mesh.deform ? "checked" : ""} ${lockedAttr} /><span>Deform Mesh Along Curve</span></label>
      <div class="detail-hint">Mesh length runs along local +Z. Deform Mesh creates curved geometry; it is more expensive than fitted instances.</div>
      <div class="landscape-heightmap-actions">
        <button type="button" class="detail-action-button" data-landscape-spline-apply-deform ${lockedAttr}>Apply Deform</button>
        <button type="button" class="detail-action-button" data-landscape-spline-apply-paint ${lockedAttr}>Apply Paint</button>
      </div>
      <div class="detail-hint">Apply bakes the whole active spline's enabled effects into the heightfield / paint layers (destructive).</div>`
    : "";
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>terrain / landscape</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Landscape" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Landscape Mode</div>
        <div class="landscape-tool-segment landscape-tool-segment--two" role="group" aria-label="Landscape edit mode">
          ${LANDSCAPE_EDIT_MODES.map(
            (mode) => `<button type="button" data-landscape-mode="${mode}" class="${
              settings.editMode === mode ? "active" : ""
            }" ${lockedAttr}>${mode === "sculpt" ? "Sculpt" : mode === "paint" ? "Paint" : "Splines"}</button>`,
          ).join("")}
        </div>
        ${
          settings.editMode === "splines"
            ? `<div class="detail-subsection-title">Landscape Splines</div>
              <div class="landscape-tool-segment landscape-tool-segment--two" role="group" aria-label="Landscape spline tool">
                ${LANDSCAPE_SPLINE_TOOLS.map(
                  (tool) => `<button type="button" data-landscape-spline-tool="${tool}" class="${
                    settings.splineTool === tool ? "active" : ""
                  }" ${lockedAttr}>${tool === "draw" ? "Draw" : "Edit Points"}</button>`,
                ).join("")}
              </div>
              <div class="detail-hint">${
                settings.splineTool === "draw"
                  ? "Draw: click the terrain to add connected control points. Click near an existing point to weld — close a loop (click the first point), branch (select a mid point, then click), or fork onto another spline's point (the two merge into one)."
                  : "Edit Points: click a control point to select it, then drag the move gizmo. Switch to Draw to add or connect points."
              }</div>
              <div class="landscape-layer-list">
                ${splines.map((spline) => `<button type="button" data-landscape-spline="${escapeHtml(spline.id)}" class="${
                  settings.activeSplineId === spline.id ? "active" : ""
                }" ${lockedAttr}><span>${escapeHtml(spline.name)}</span><span>${spline.pointCount} pts</span></button>`).join("") || "<div class=\"detail-hint\">No splines yet.</div>"}
              </div>
              <div class="landscape-heightmap-actions">
                <button type="button" class="detail-action-button" data-landscape-spline-create ${lockedAttr}>New Spline</button>
                <button type="button" class="detail-action-button" data-landscape-spline-delete ${lockedAttr}>Delete Spline</button>
                <button type="button" class="detail-action-button" data-landscape-spline-close ${lockedAttr}>Close Loop</button>
              </div>
              ${
                activeSpline
                  ? `<label class="detail-toggle"><input type="checkbox" data-landscape-spline-smooth ${activeSpline.smooth ? "checked" : ""} ${lockedAttr} /><span>Curved (smooth)</span></label>
                     <div class="detail-hint">Bends segments into a smooth curve through the control points. Re-apply Deform/Paint after toggling to bake the new shape.</div>`
                  : ""
              }
              ${splinePointMarkup}
              ${splineSegments.length ? `<div class="detail-subsection-title">Segments</div><div class="landscape-layer-list">${splineSegments.map((segment) => `<button type="button" data-landscape-spline-segment="${escapeHtml(segment.id)}" class="${
                settings.activeSplineSegmentId === segment.id ? "active" : ""
              }" ${lockedAttr}>${escapeHtml(segment.startPointId)} → ${escapeHtml(segment.endPointId)}</button>`).join("")}</div><button type="button" class="detail-action-button" data-landscape-spline-segment-split ${lockedAttr}>Split Segment</button>${splineSegmentMarkup}` : ""}`
            : settings.editMode === "paint"
            ? `<div class="landscape-tool-segment" role="group" aria-label="Landscape paint tool">
              ${LANDSCAPE_PAINT_TOOLS.map(
                (tool) => `<button type="button" data-landscape-paint-tool="${tool}" class="${
                  settings.paintTool === tool ? "active" : ""
                }" ${lockedAttr}>${formatLandscapePaintTool(tool)}</button>`,
              ).join("")}
            </div>
            <div class="detail-subsection-title">Layer</div>
            <div class="landscape-layer-list">
              ${layers
                .map(
                  (layer) => `<button type="button" data-landscape-layer="${escapeHtml(layer.id)}" class="${
                    settings.activeLayerId === layer.id ? "active" : ""
                  }" ${lockedAttr}>
                  <span class="landscape-layer-swatch" style="background:${escapeHtml(layer.color)}"></span>
                  <span>${escapeHtml(layerDisplayName(layer))}</span>
                </button>`,
                )
                .join("")}
            </div>
            <label class="detail-row">
              <span>Material</span>
              <select data-landscape-layer-material ${lockedAttr}>${layerMaterialOptions}</select>
            </label>
            <div class="detail-hint">Assigns a material to the active layer; the layer then takes the material's name and color.</div>
            <button type="button" class="detail-action-button" data-landscape-fill ${lockedAttr}>Fill Layer</button>`
            : `<div class="landscape-tool-segment" role="group" aria-label="Landscape sculpt tool">
              ${LANDSCAPE_SCULPT_TOOLS.map(
                (tool) => `<button type="button" data-landscape-tool="${tool}" class="${
                  settings.tool === tool ? "active" : ""
                }" ${lockedAttr}>${formatLandscapeTool(tool)}</button>`,
              ).join("")}
            </div>
            <label class="detail-row">
              <span>Flatten Target</span>
              <input data-landscape-number="flattenTargetHeight" type="number" step="0.1"
                value="${settings.flattenTargetHeight}" ${lockedAttr} />
            </label>`
        }
        <label class="detail-row">
          <span>Brush Size</span>
          <input data-landscape-number="brushSize" type="number" min="0.5" max="50" step="0.5"
            value="${settings.brushSize}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Strength</span>
          <input data-landscape-number="strength" type="number" min="0.01" max="2" step="0.01"
            value="${settings.strength}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Falloff</span>
          <input data-landscape-number="falloff" type="number" min="0.25" max="8" step="0.25"
            value="${settings.falloff}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>View</span>
          <select data-landscape-view ${lockedAttr}>
            ${LANDSCAPE_VIEW_MODES.map(
              (mode) => `<option value="${mode}" ${
                settings.viewMode === mode ? "selected" : ""
              }>${formatLandscapeViewMode(mode)}</option>`,
            ).join("")}
          </select>
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Runtime</div>
        <label class="detail-toggle">
          <input type="checkbox" data-landscape-collision ${selection.collision ? "checked" : ""} ${lockedAttr} />
          <span>Collision</span>
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Landscape Size</div>
        <label class="detail-row">
          <span>Resolution</span>
          <select data-landscape-resolution ${lockedAttr}>
            <option value="small" ${resolution?.verticesX === 65 && resolution.verticesZ === 65 ? "selected" : ""}>Small (65 × 65)</option>
            <option value="medium" ${resolution?.verticesX === 129 && resolution.verticesZ === 129 ? "selected" : ""}>Medium (129 × 129)</option>
            <option value="large" ${resolution?.verticesX === 257 && resolution.verticesZ === 257 ? "selected" : ""}>High (257 × 257)</option>
          </select>
        </label>
        <label class="detail-row">
          <span>World Size</span>
          <input data-landscape-world-size type="number" min="${resolution ? (resolution.verticesX - 1) * 0.01 : 0.01}" max="${resolution ? (resolution.verticesX - 1) * 100 : 10000}" step="0.1" value="${resolution?.worldSize ?? ""}" ${lockedAttr} />
        </label>
        <div class="detail-hint">Changes the terrain width and depth while keeping its height and paint data.</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Heightmap</div>
        <label class="detail-row">
          <span>Import Height</span>
          <input data-landscape-import-range type="number" min="0" step="0.1" value="${importHeight}" ${lockedAttr} />
        </label>
        <div class="landscape-heightmap-actions">
          <label class="detail-action-button detail-action-button--centered" ${lockedAttr}>Import PNG<input data-landscape-heightmap-import type="file" accept="image/png" hidden ${lockedAttr} /></label>
          <button type="button" class="detail-action-button" data-landscape-heightmap-export>Export PNG</button>
        </div>
        <div class="detail-hint">Import Height scales the PNG's brightness into terrain height. The imported terrain is baked into the level; re-import to change the height scale.</div>
      </div>
      ${actorLockSection(selection)}
    `;

  bindPositionRotation(options);
  bindNameAndLock(options);

  body.querySelectorAll<HTMLButtonElement>("[data-landscape-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const editMode = button.dataset.landscapeMode as LandscapeEditMode | undefined;
      if (!editMode || !LANDSCAPE_EDIT_MODES.includes(editMode)) return;
      options.setLandscapeSculptSettings({ editMode });
      renderLandscapeDetails(options);
    });
  });

  body.querySelectorAll<HTMLButtonElement>("[data-landscape-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.dataset.landscapeTool as LandscapeSculptTool | undefined;
      if (!tool || !LANDSCAPE_SCULPT_TOOLS.includes(tool)) return;
      options.setLandscapeSculptSettings({ tool });
      renderLandscapeDetails(options);
    });
  });

  body.querySelectorAll<HTMLButtonElement>("[data-landscape-spline-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const splineTool = button.dataset.landscapeSplineTool as LandscapeSplineTool | undefined;
      if (!splineTool || !LANDSCAPE_SPLINE_TOOLS.includes(splineTool)) return;
      options.setLandscapeSculptSettings({ splineTool });
      renderLandscapeDetails(options);
    });
  });

  body.querySelectorAll<HTMLButtonElement>("[data-landscape-paint-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const paintTool = button.dataset.landscapePaintTool as LandscapePaintTool | undefined;
      if (!paintTool || !LANDSCAPE_PAINT_TOOLS.includes(paintTool)) return;
      options.setLandscapeSculptSettings({ paintTool });
      renderLandscapeDetails(options);
    });
  });

  body.querySelectorAll<HTMLButtonElement>("[data-landscape-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      const activeLayerId = button.dataset.landscapeLayer;
      if (!activeLayerId) return;
      options.setLandscapeSculptSettings({ activeLayerId });
      renderLandscapeDetails(options);
    });
  });

  body.querySelectorAll<HTMLButtonElement>("[data-landscape-spline]").forEach((button) => {
    button.addEventListener("click", () => {
      const activeSplineId = button.dataset.landscapeSpline;
      if (!activeSplineId) return;
      options.setLandscapeSculptSettings({ activeSplineId, activeSplinePointId: null, activeSplineSegmentId: null });
      renderLandscapeDetails(options);
    });
  });
  body.querySelector<HTMLButtonElement>("[data-landscape-spline-create]")?.addEventListener("click", () => {
    options.createSelectedLandscapeSpline();
    renderLandscapeDetails(options);
  });
  body.querySelector<HTMLButtonElement>("[data-landscape-spline-delete]")?.addEventListener("click", () => {
    options.deleteSelectedLandscapeSpline(options.getLandscapeSculptSettings().activeSplineId);
    renderLandscapeDetails(options);
  });
  body.querySelector<HTMLButtonElement>("[data-landscape-spline-close]")?.addEventListener("click", () => {
    options.closeSelectedLandscapeSpline();
    renderLandscapeDetails(options);
  });
  body.querySelector<HTMLInputElement>("[data-landscape-spline-smooth]")?.addEventListener("change", (event) => {
    options.setSelectedLandscapeSplineSmooth((event.currentTarget as HTMLInputElement).checked);
    renderLandscapeDetails(options);
  });
  body.querySelectorAll<HTMLButtonElement>("[data-landscape-spline-point]").forEach((button) => {
    button.addEventListener("click", () => {
      const activeSplinePointId = button.dataset.landscapeSplinePoint;
      if (!activeSplinePointId) return;
      options.setLandscapeSculptSettings({ activeSplinePointId });
      renderLandscapeDetails(options);
    });
  });
  body.querySelectorAll<HTMLInputElement>("[data-landscape-spline-point-axis]").forEach((input) => {
    input.addEventListener("change", () => {
      const point = options.getSelectedLandscapeSplinePoints().find((entry) => entry.id === options.getLandscapeSculptSettings().activeSplinePointId);
      const axis = input.dataset.landscapeSplinePointAxis;
      const value = Number(input.value);
      if (!point || !axis || !Number.isFinite(value)) return;
      const position: Vec3 = [...point.position];
      position[axis === "x" ? 0 : axis === "y" ? 1 : 2] = value;
      options.setSelectedLandscapeSplinePointPosition(point.id, position);
      renderLandscapeDetails(options);
    });
  });
  body.querySelectorAll<HTMLInputElement>("[data-landscape-spline-point-shape]").forEach((input) => {
    input.addEventListener("change", () => {
      const point = options.getSelectedLandscapeSplinePoints().find((entry) => entry.id === options.getLandscapeSculptSettings().activeSplinePointId);
      const key = input.dataset.landscapeSplinePointShape as "width" | "falloff" | undefined;
      const value = Number(input.value);
      if (!point || !key || !Number.isFinite(value)) return;
      options.setSelectedLandscapeSplinePointShape(point.id, { [key]: value });
      renderLandscapeDetails(options);
    });
  });
  body.querySelector<HTMLButtonElement>("[data-landscape-spline-point-delete]")?.addEventListener("click", () => {
    options.deleteSelectedLandscapeSplinePoint(options.getLandscapeSculptSettings().activeSplinePointId);
    renderLandscapeDetails(options);
  });
  body.querySelectorAll<HTMLButtonElement>("[data-landscape-spline-segment]").forEach((button) => {
    button.addEventListener("click", () => {
      const activeSplineSegmentId = button.dataset.landscapeSplineSegment;
      if (!activeSplineSegmentId) return;
      options.setLandscapeSculptSettings({ activeSplineSegmentId });
      renderLandscapeDetails(options);
    });
  });
  body.querySelector<HTMLButtonElement>("[data-landscape-spline-segment-split]")?.addEventListener("click", () => {
    options.splitSelectedLandscapeSplineSegment(options.getLandscapeSculptSettings().activeSplineSegmentId);
    renderLandscapeDetails(options);
  });
  const activeSegmentId = (): string | null =>
    options.getLandscapeSculptSettings().activeSplineSegmentId ??
    options.getSelectedLandscapeSplineSegments().at(-1)?.id ??
    null;
  body.querySelectorAll<HTMLInputElement>("[data-landscape-segment-flag]").forEach((input) => {
    input.addEventListener("change", () => {
      const segmentId = activeSegmentId();
      const key = input.dataset.landscapeSegmentFlag as
        | `deform.${"enabled" | "flatten" | "raiseTerrain" | "lowerTerrain"}`
        | `paint.enabled`
        | `mesh.${"enabled" | "fitToLength" | "alignToTerrain" | "deform"}`
        | undefined;
      if (!segmentId || !key) return;
      const [group, flag] = key.split(".") as [string, string];
      options.setSelectedLandscapeSplineSegment(segmentId, { [group]: { [flag]: input.checked } } as LandscapeSplineSegmentPatch);
      renderLandscapeDetails(options);
    });
  });
  body.querySelectorAll<HTMLInputElement>("[data-landscape-segment-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const segmentId = activeSegmentId();
      const key = input.dataset.landscapeSegmentNumber as
        | "deform.targetOffset"
        | "paint.strength"
        | "mesh.spacing"
        | "mesh.yawOffset"
        | "mesh.bank"
        | undefined;
      const value = Number(input.value);
      if (!segmentId || !key || !Number.isFinite(value)) return;
      const [group, flag] = key.split(".") as [string, string];
      options.setSelectedLandscapeSplineSegment(segmentId, { [group]: { [flag]: value } } as LandscapeSplineSegmentPatch);
      renderLandscapeDetails(options);
    });
  });
  body.querySelector<HTMLSelectElement>("[data-landscape-segment-layer]")?.addEventListener("change", (event) => {
    const segmentId = activeSegmentId();
    const layerId = (event.currentTarget as HTMLSelectElement).value;
    if (!segmentId || !layerId) return;
    options.setSelectedLandscapeSplineSegment(segmentId, { paint: { layerId } });
    renderLandscapeDetails(options);
  });
  body.querySelector<HTMLSelectElement>("[data-landscape-segment-mesh]")?.addEventListener("change", (event) => {
    const segmentId = activeSegmentId();
    if (!segmentId) return;
    options.setSelectedLandscapeSplineSegment(segmentId, { mesh: { assetId: (event.currentTarget as HTMLSelectElement).value } });
    renderLandscapeDetails(options);
  });
  body.querySelector<HTMLButtonElement>("[data-landscape-spline-apply-deform]")?.addEventListener("click", () => {
    options.applySelectedLandscapeSplineDeform();
    renderLandscapeDetails(options);
  });
  body.querySelector<HTMLButtonElement>("[data-landscape-spline-apply-paint]")?.addEventListener("click", () => {
    options.applySelectedLandscapeSplinePaint();
    renderLandscapeDetails(options);
  });

  body.querySelector<HTMLSelectElement>("[data-landscape-view]")?.addEventListener(
    "change",
    (event) => {
      const viewMode = (event.currentTarget as HTMLSelectElement).value as LandscapeViewMode;
      if (!LANDSCAPE_VIEW_MODES.includes(viewMode)) return;
      options.setLandscapeSculptSettings({ viewMode });
      renderLandscapeDetails(options);
    },
  );

  body
    .querySelector<HTMLSelectElement>("[data-landscape-layer-material]")
    ?.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      options.setSelectedLandscapeLayerMaterial(
        options.getLandscapeSculptSettings().activeLayerId,
        value || null,
      );
      renderLandscapeDetails(options);
    });

  body.querySelector<HTMLButtonElement>("[data-landscape-fill]")?.addEventListener("click", () => {
    options.fillSelectedLandscapeLayer(options.getLandscapeSculptSettings().activeLayerId);
    renderLandscapeDetails(options);
  });

  body.querySelectorAll<HTMLInputElement>("[data-landscape-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.landscapeNumber as keyof LandscapeSculptSettings | undefined;
      const value = Number(input.value);
      if (!key || !Number.isFinite(value)) return;
      options.setLandscapeSculptSettings({ [key]: value } as Partial<LandscapeSculptSettings>);
      renderLandscapeDetails(options);
    });
  });

  body.querySelector<HTMLInputElement>("[data-landscape-collision]")?.addEventListener(
    "change",
    (event) => {
      options.setSelectedLandscape({ collision: (event.currentTarget as HTMLInputElement).checked });
    },
  );

  body.querySelector<HTMLInputElement>("[data-landscape-heightmap-import]")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const heightRange = Number(body.querySelector<HTMLInputElement>("[data-landscape-import-range]")?.value ?? 20);
    if (!Number.isFinite(heightRange) || heightRange < 0) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Unable to read PNG pixels.");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      await options.importSelectedLandscapeHeightmap(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, heightRange);
    } catch {
      // The browser only decodes image/png here; malformed files leave the terrain untouched.
    } finally {
      input.value = "";
    }
  });

  body.querySelector<HTMLSelectElement>("[data-landscape-resolution]")?.addEventListener("change", (event) => {
    const preset = (event.currentTarget as HTMLSelectElement).value;
    if (preset !== "small" && preset !== "medium" && preset !== "large") return;
    options.resampleSelectedLandscape(preset);
    renderLandscapeDetails(options);
  });

  body.querySelector<HTMLInputElement>("[data-landscape-world-size]")?.addEventListener("change", (event) => {
    const worldSize = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(worldSize)) return;
    options.setSelectedLandscapeWorldSize(worldSize);
    renderLandscapeDetails(options);
  });

  body.querySelector<HTMLButtonElement>("[data-landscape-heightmap-export]")?.addEventListener("click", () => {
    const heightmap = options.exportSelectedLandscapeHeightmap();
    if (!heightmap) return;
    const canvas = document.createElement("canvas");
    canvas.width = heightmap.width;
    canvas.height = heightmap.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(heightmap.pixels), heightmap.width, heightmap.height),
      0,
      0,
    );
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "landscape-heightmap.png";
      anchor.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  });
}

export function renderLightDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection } = options;
  options.setDetailsScale([1, 1, 1]);
  const lockedAttr = selection.locked ? "disabled" : "";
  const isPoint = selection.lightType === "point";
  const isSpot = selection.lightType === "spot";
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>light / ${escapeHtml(selection.lightType ?? selection.assetId)}</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="${escapeHtml(selection.assetId)}" />
      </label>
      <div class="detail-row">
        <span>Type</span>
        <span class="detail-value">${escapeHtml(selection.lightType ?? "light")}</span>
      </div>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${!isPoint ? vectorRow("Rotation", "r", selection.rotation, 1, selection.locked) : ""}
      <div class="detail-section">
        <div class="detail-section-title">Light</div>
        <label class="detail-row">
          <span>Color</span>
          <input data-light-color type="color" value="${escapeHtml(selection.color ?? "#ffffff")}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-light-number="intensity" type="number" step="0.1" min="0" max="20"
            value="${selection.intensity ?? 1}" ${lockedAttr} />
        </label>
        ${
          isPoint || isSpot
            ? `<label class="detail-row">
              <span>Distance</span>
              <input data-light-number="distance" type="number" step="0.1" min="0" max="100"
                value="${selection.distance ?? (isPoint ? 8 : 10)}" ${lockedAttr} />
            </label>
            <label class="detail-row">
              <span>Decay</span>
              <input data-light-number="decay" type="number" step="0.1" min="0" max="8"
                value="${selection.decay ?? 2}" ${lockedAttr} />
            </label>`
            : ""
        }
        ${
          isSpot
            ? `<label class="detail-row">
              <span>Angle</span>
              <input data-light-number="angle" type="number" step="1" min="1" max="90"
                value="${selection.angle ?? 30}" ${lockedAttr} />
            </label>
            <label class="detail-row">
              <span>Penumbra</span>
              <input data-light-number="penumbra" type="number" step="0.05" min="0" max="1"
                value="${selection.penumbra ?? 0.35}" ${lockedAttr} />
            </label>`
            : ""
        }
        <label class="detail-toggle">
          <input type="checkbox" data-light-toggle="castShadow" ${
            selection.castShadow ? "checked" : ""
          } ${lockedAttr} />
          <span>Cast Shadow</span>
        </label>
      </div>
      ${actorLockSection(selection)}
    `;

  bindPositionRotation(options);
  bindNameAndLock(options);

  body.querySelector<HTMLInputElement>("[data-light-color]")?.addEventListener(
    "change",
    (event) => {
      options.setSelectedLightSettings({ color: (event.currentTarget as HTMLInputElement).value });
    },
  );

  body.querySelectorAll<HTMLInputElement>("[data-light-number]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.lightNumber;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (key === "intensity") options.setSelectedLightSettings({ intensity: value });
      if (key === "distance") options.setSelectedLightSettings({ distance: value });
      if (key === "decay") options.setSelectedLightSettings({ decay: value });
      if (key === "angle") options.setSelectedLightSettings({ angle: value });
      if (key === "penumbra") options.setSelectedLightSettings({ penumbra: value });
    });
  });

  body.querySelector<HTMLInputElement>("[data-light-toggle]")?.addEventListener(
    "change",
    (event) => {
      options.setSelectedLightSettings({
        castShadow: (event.currentTarget as HTMLInputElement).checked,
      });
    },
  );
}

export function renderReflectionPlaneDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection } = options;
  options.setDetailsScale([...selection.scale]);
  const lockedAttr = selection.locked ? "disabled" : "";
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>reflection / planar mirror</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Mirror Plane" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Reflection</div>
        <label class="detail-row">
          <span>Tint</span>
          <input data-reflection-plane-color type="color"
            value="${escapeHtml(selection.color ?? "#888888")}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Resolution</span>
          <select data-reflection-plane-resolution ${lockedAttr}>
            ${[128, 256, 512, 1024, 2048]
              .map(
                (res) =>
                  `<option value="${res}" ${
                    (selection.reflectionResolution ?? 512) === res ? "selected" : ""
                  }>${res}px</option>`,
              )
              .join("")}
          </select>
        </label>
        <div class="detail-hint">Higher resolution = sharper mirror, more GPU cost.</div>
      </div>
      ${actorLockSection(selection)}
    `;

  bindTransformInputs(options, true);
  bindNameAndLock(options);

  body
    .querySelector<HTMLInputElement>("[data-reflection-plane-color]")
    ?.addEventListener("change", (event) => {
      options.setSelectedReflectionPlane({
        color: (event.currentTarget as HTMLInputElement).value,
      });
    });

  body
    .querySelector<HTMLSelectElement>("[data-reflection-plane-resolution]")
    ?.addEventListener("change", (event) => {
      const value = Number((event.currentTarget as HTMLSelectElement).value);
      if (!Number.isFinite(value)) return;
      options.setSelectedReflectionPlane({ resolution: value });
    });
}

export function renderReflectiveSurfaceDetails(options: SpecialActorDetailsOptions): void {
  const { body, editableAssets, selection } = options;
  const surface = selection.reflectiveSurface;
  if (!surface) return;
  options.setDetailsScale([...selection.scale]);
  const lockedAttr = selection.locked ? "disabled" : "";
  const materialAssets = editableAssets.filter((asset) => assetType(asset) === "material");
  const materialOptions = [
    `<option value="" ${surface.material ? "" : "selected"}>Default (glossy)</option>`,
  ]
    .concat(
      materialAssets.map(
        (asset) =>
          `<option value="${escapeHtml(asset.id)}" ${
            surface.material === asset.id ? "selected" : ""
          }>${escapeHtml(asset.displayName ?? asset.name)}</option>`,
      ),
    )
    .join("");
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>reflection / reflective surface</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Reflective Surface" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Material</div>
        <label class="detail-row">
          <span>Surface</span>
          <select data-surface-material ${lockedAttr}>${materialOptions}</select>
        </label>
        <div class="detail-hint">Albedo + normal map + roughness come from this material (asphalt, marble, ...).</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Reflection</div>
        <label class="detail-row">
          <span>Strength</span>
          <input data-surface-field="reflectionStrength" type="number" min="0" max="1" step="0.05"
            value="${surface.reflectionStrength}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Fresnel Power</span>
          <input data-surface-field="fresnelPower" type="number" min="0" max="16" step="0.5"
            value="${surface.fresnelPower}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Fresnel Bias</span>
          <input data-surface-field="fresnelBias" type="number" min="0" max="1" step="0.02"
            value="${surface.fresnelBias}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Distortion</span>
          <input data-surface-field="distortion" type="number" min="0" max="1" step="0.01"
            value="${surface.distortion}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Tint</span>
          <input data-surface-tint type="color" value="${escapeHtml(surface.tint)}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Resolution</span>
          <select data-surface-field="resolution" ${lockedAttr}>
            ${[128, 256, 512, 1024, 2048]
              .map(
                (res) =>
                  `<option value="${res}" ${
                    surface.resolution === res ? "selected" : ""
                  }>${res}px</option>`,
              )
              .join("")}
          </select>
        </label>
        <div class="detail-hint">Lower roughness + higher strength = sharper reflection; fresnel concentrates it at grazing angles.</div>
      </div>
      ${actorLockSection(selection)}
    `;

  bindTransformInputs(options, true);
  bindNameAndLock(options);

  body
    .querySelector<HTMLSelectElement>("[data-surface-material]")
    ?.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      options.setSelectedReflectiveSurface({ material: value || null });
    });

  body
    .querySelector<HTMLInputElement>("[data-surface-tint]")
    ?.addEventListener("change", (event) => {
      options.setSelectedReflectiveSurface({
        tint: (event.currentTarget as HTMLInputElement).value,
      });
    });

  body
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-surface-field]")
    .forEach((field) => {
      field.addEventListener("change", () => {
        const key = field.dataset.surfaceField as SurfaceNumericKey | undefined;
        if (!key) return;
        const value = Number(field.value);
        if (!Number.isFinite(value)) return;
        const patch: Partial<Record<SurfaceNumericKey, number>> = {};
        patch[key] = value;
        options.setSelectedReflectiveSurface(patch);
      });
    });
}

export function renderBlockingVolumeDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection } = options;
  const volume = selection.blockingVolume;
  if (!volume) return;
  options.setDetailsScale([...selection.scale]);
  const lockedAttr = selection.locked ? "disabled" : "";
  const shapeOptions = BRUSH_SHAPES.map(
    (shape) =>
      `<option value="${shape}" ${volume.brushShape === shape ? "selected" : ""}>${
        formatBrushShapeLabel(shape)
      }</option>`,
  ).join("");
  const navigationRoleOptions = NAVIGATION_ROLE_VALUES.map((role) => {
    const label = role === "auto"
      ? "Block Movement"
      : role === "walkable"
        ? "Walkable Deck"
        : role === "obstacleOnly"
          ? "Block Movement (No Floor)"
          : "Ignore for Navigation";
    return `<option value="${role}" ${volume.navigationRole === role ? "selected" : ""}>${label}</option>`;
  }).join("");
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>volume / blocking volume</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Blocking Volume" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Brush Settings</div>
        <label class="detail-row">
          <span>Brush Shape</span>
          <select data-brush-shape ${lockedAttr}>${shapeOptions}</select>
        </label>
        ${brushDimensionRows(volume, lockedAttr)}
        <label class="detail-row">
          <span>Color</span>
          <input data-brush-color type="color" value="${escapeHtml(volume.color)}" ${lockedAttr} />
        </label>
        <div class="detail-hint">Brush dimensions are world units; the transform scale multiplies them.</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Actor</div>
        <label class="detail-row">
          <span>AI Navigation</span>
          <select data-brush-navigation-role ${lockedAttr}>${navigationRoleOptions}</select>
        </label>
        <div class="detail-hint">Walkable Deck is a horizontal floor: AI agents stand on its top instead of treating it as an obstacle. Use a box fitted to a bridge deck.</div>
        <label class="detail-toggle">
          <input type="checkbox" data-brush-render-in-game ${volume.renderInGame ? "checked" : ""} />
          <span>Render in Game</span>
        </label>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="locked" ${selection.locked ? "checked" : ""} />
          <span>Lock Movement</span>
        </label>
      </div>
    `;

  bindTransformInputs(options, true);
  bindNameAndLock(options);

  body
    .querySelector<HTMLSelectElement>("[data-brush-shape]")
    ?.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value as BrushShape;
      options.setSelectedBlockingVolume({ brushShape: value });
    });

  body.querySelectorAll<HTMLInputElement>("[data-brush-dim]").forEach((input) => {
    input.addEventListener("change", () => {
      options.setSelectedBlockingVolume(readBrushDimensions(body, volume));
    });
  });

  body
    .querySelector<HTMLInputElement>("[data-brush-color]")
    ?.addEventListener("change", (event) => {
      options.setSelectedBlockingVolume({
        color: (event.currentTarget as HTMLInputElement).value,
      });
    });

  body
    .querySelector<HTMLSelectElement>("[data-brush-navigation-role]")
    ?.addEventListener("change", (event) => {
      options.setSelectedBlockingVolume({
        navigationRole: (event.currentTarget as HTMLSelectElement).value as NavigationRole,
      });
    });

  body
    .querySelector<HTMLInputElement>("[data-brush-render-in-game]")
    ?.addEventListener("change", (event) => {
      options.setSelectedBlockingVolume({
        renderInGame: (event.currentTarget as HTMLInputElement).checked,
      });
    });
}

export function renderAiNavigationVolumeDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection } = options;
  const volume = selection.aiNavigationVolume;
  if (!volume) return;
  options.setDetailsScale([...selection.scale]);
  const lockedAttr = selection.locked ? "disabled" : "";
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>volume / AI navigation volume</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="AI Navigation Volume" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Navigation Bounds</div>
        ${navigationVolumeDimensionRows(volume, lockedAttr)}
        <div class="detail-hint">AI pathfinding is allowed inside this volume; the transform scale multiplies its size.</div>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Preview Agent</div>
        <label class="detail-row">
          <span>Agent Radius</span>
          <input data-ai-nav-agent="agentRadius" type="number" min="0" step="0.05"
            value="${volume.agentRadius}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Clearance Padding</span>
          <input data-ai-nav-agent="clearancePadding" type="number" min="0" step="0.05"
            value="${volume.clearancePadding}" ${lockedAttr} />
        </label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Navigation Bake</div>
        <button type="button" data-ai-nav-rebake class="detail-button">Rebake Navigation</button>
        <div class="detail-hint">The walkable area rebakes automatically on every scene edit and at runtime. Press to force a recompute now (also reloads edited collision sidecars) and show the preview.</div>
      </div>
      ${actorLockSection(selection)}
    `;

  bindTransformInputs(options, true);
  bindNameAndLock(options);

  body.querySelectorAll<HTMLInputElement>("[data-ai-nav-size]").forEach((input) => {
    input.addEventListener("change", () => {
      options.setSelectedAiNavigationVolume({ size: readNavigationVolumeSize(body, volume) });
    });
  });

  body.querySelectorAll<HTMLInputElement>("[data-ai-nav-agent]").forEach((input) => {
    input.addEventListener("change", () => {
      const value = Math.max(0, Number(input.value));
      if (!Number.isFinite(value)) return;
      const key = input.dataset.aiNavAgent;
      if (key === "agentRadius") options.setSelectedAiNavigationVolume({ agentRadius: value });
      if (key === "clearancePadding") options.setSelectedAiNavigationVolume({ clearancePadding: value });
    });
  });

  body
    .querySelector<HTMLButtonElement>("[data-ai-nav-rebake]")
    ?.addEventListener("click", () => options.rebakeAiNavigation());
}

export function renderTargetPointDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection } = options;
  const point = selection.targetPoint;
  if (!point) return;
  options.setDetailsScale([...selection.scale]);
  const lockedAttr = selection.locked ? "disabled" : "";
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>ai / target point</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Target Point" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      ${vectorRow("Rotation", "r", selection.rotation, 1, selection.locked)}
      ${scaleRow(selection.scale, selection.scaleLocked, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Patrol</div>
        <label class="detail-toggle">
          <input data-target-point-start type="checkbox"
            ${point.startPoint ? "checked" : ""} ${lockedAttr} />
          <span>Start Point</span>
        </label>
        <label class="detail-row">
          <span>Next Target</span>
          ${targetPointSelect(point, options.targetPoints, lockedAttr)}
        </label>
        <label class="detail-row">
          <span>Wait Time</span>
          <input data-target-point-number="waitTime" type="number" min="0" step="0.1"
            value="${point.waitTime}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Acceptance</span>
          <input data-target-point-number="acceptanceRadius" type="number" min="0.01" step="0.05"
            value="${point.acceptanceRadius}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Speed</span>
          <input data-target-point-number="speedOverride" type="number" min="0" step="0.1"
            value="${point.speedOverride ?? ""}" placeholder="default" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Route Tag</span>
          <input data-target-point-field="patrolTag" type="text"
            value="${escapeHtml(point.patrolTag)}" placeholder="route id" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Color</span>
          <input data-target-point-color type="color" value="${escapeHtml(point.color)}" ${lockedAttr} />
        </label>
      </div>
      ${actorLockSection(selection)}
    `;

  bindTransformInputs(options, true);
  bindNameAndLock(options);

  body
    .querySelector<HTMLInputElement>("[data-target-point-start]")
    ?.addEventListener("change", (event) => {
      options.setSelectedTargetPoint({
        startPoint: (event.currentTarget as HTMLInputElement).checked,
      });
    });

  body
    .querySelector<HTMLSelectElement>("[data-target-point-next]")
    ?.addEventListener("change", (event) => {
      options.setSelectedTargetPoint({
        nextTargetPoint: (event.currentTarget as HTMLSelectElement).value,
      });
    });

  body
    .querySelectorAll<HTMLInputElement>("[data-target-point-field]")
    .forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.targetPointField as "patrolTag" | undefined;
        if (!key) return;
        options.setSelectedTargetPoint({ [key]: input.value });
      });
    });

  body
    .querySelectorAll<HTMLInputElement>("[data-target-point-number]")
    .forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.targetPointNumber as
          | "waitTime"
          | "acceptanceRadius"
          | "speedOverride"
          | undefined;
        if (!key) return;
        const value = input.value.trim() === "" ? null : Number(input.value);
        if (value !== null && !Number.isFinite(value)) return;
        if (key === "speedOverride") {
          options.setSelectedTargetPoint({ speedOverride: value });
          return;
        }
        if (value === null) return;
        options.setSelectedTargetPoint({ [key]: value });
      });
    });

  body
    .querySelector<HTMLInputElement>("[data-target-point-color]")
    ?.addEventListener("change", (event) => {
      options.setSelectedTargetPoint({
        color: (event.currentTarget as HTMLInputElement).value,
      });
    });
}

export function renderSplineDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection } = options;
  const spline = selection.spline;
  if (!spline) return;
  options.setDetailsScale([...selection.scale]);
  const locked = selection.locked ? "disabled" : "";
  const points = options.getSelectedSplinePoints();
  const activePoint = points.find((point) => point.id === options.getActiveSplinePointId()) ?? points[0];
  const pointButtons = points
    .map((point, index) => `<button type="button" class="${activePoint?.id === point.id ? "active" : ""}" data-spline-point="${escapeHtml(point.id)}" ${locked}><span>${index + 1}</span>${escapeHtml(point.id)}</button>`)
    .join("");
  const splitButtons = Array.from(
    { length: points.length >= 2 ? (spline.closed ? points.length : points.length - 1) : 0 },
    (_, index) => `<button type="button" data-spline-split="${index}" ${locked}>Split ${index + 1}</button>`,
  ).join("");
  const segmentCount = points.length >= 2 ? (spline.closed ? points.length : points.length - 1) : 0;
  const hasDegenerateSegment = Array.from({ length: segmentCount }, (_, index) => {
    const start = points[index]!.position;
    const end = points[(index + 1) % points.length]!.position;
    return Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2]) < 1e-4;
  }).some(Boolean);
  const meshOptions = options.editableAssets
    .filter((asset) => isModelAssetType(assetType(asset)))
    .map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.displayName ?? asset.name)}</option>`)
    .join("");
  const generators = options.getSelectedSplineGenerators();
  const generatorDiagnostics = new Map(options.getSelectedSplineGeneratorDiagnostics().map((entry) => [entry.generatorId, entry]));
  const generatorMarkup = generators.length === 0
    ? "<div class=\"spline-generator-empty\"><strong>No generators yet</strong><span>Add instances for repeated props, or rigid segments for fences, rails and walls.</span></div>"
    : generators.map((generator) => {
      const diagnostic = generatorDiagnostics.get(generator.id);
      const warningMarkup = diagnostic?.warnings.map((warning) => `<div class="detail-readonly">Warning: ${escapeHtml(warning)}</div>`).join("") ?? "";
      if (generator.type !== "instances" && generator.type !== "rigidSegments" && generator.type !== "deformMesh") {
        return `<div class="detail-subsection spline-generator" data-spline-generator-card="${escapeHtml(generator.id)}">
          <div class="detail-subsection-title">Missing plugin · ${escapeHtml(generator.type)}</div>
          <div class="detail-readonly">This generator is retained for save compatibility but its game plugin is not loaded, so Forge will not build an output.</div>
          <div class="detail-readonly">Version: ${generator.pluginVersion ?? 1} · Settings are preserved unchanged.</div>
          <div class="detail-button-row"><button type="button" data-spline-generator-remove="${escapeHtml(generator.id)}" ${locked}>Remove Generator</button></div>
        </div>`;
      }
      if (generator.type === "rigidSegments") {
        return `<div class="detail-subsection spline-generator" data-spline-generator-card="${escapeHtml(generator.id)}">
          <div class="detail-subsection-title">Rigid Segments Â· ${escapeHtml(generator.id)}</div>
          <div class="detail-readonly">${diagnostic?.instanceCount ?? 0} generated meshes${diagnostic?.missingAssetId ? ` Â· Missing mesh: ${escapeHtml(diagnostic.missingAssetId)}` : ""}</div>
          ${warningMarkup}
          <label class="detail-row"><span>Panel Mesh</span><select data-spline-rigid-mesh="${escapeHtml(generator.id)}" ${locked}><option value="">Choose meshâ€¦</option>${meshOptions.replace(`value="${escapeHtml(generator.meshAsset)}"`, `value="${escapeHtml(generator.meshAsset)}" selected`)}</select></label>
          <label class="detail-row"><span>Fit Mode</span><select data-spline-rigid-fit="${escapeHtml(generator.id)}" ${locked}>${["fixed", "stretchLast", "distribute"].map((mode) => `<option value="${mode}" ${(generator.fitMode ?? "fixed") === mode ? "selected" : ""}>${mode === "stretchLast" ? "Stretch Last" : mode === "distribute" ? "Distribute" : "Fixed"}</option>`).join("")}</select></label>
          <label class="detail-row"><span>Segment Length</span><input type="number" min="0.01" step="0.1" data-spline-rigid-number="segmentLength" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.segmentLength}" ${locked}></label>
          <label class="detail-row"><span>Gap</span><input type="number" min="0" step="0.05" data-spline-rigid-number="gap" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.gap ?? 0}" ${locked}></label>
          <label class="detail-row"><span>Mesh Yaw</span><input type="number" step="15" data-spline-rigid-number="yaw" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.rotationOffset?.[1] ?? 0}" ${locked}></label>
          <label class="detail-row"><span>Enabled</span><input type="checkbox" data-spline-rigid-flag="enabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.enabled !== false ? "checked" : ""} ${locked}></label>
          <label class="detail-row"><span>Editor Preview</span><input type="checkbox" data-spline-rigid-flag="previewEnabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.previewEnabled !== false ? "checked" : ""} ${locked}></label>
          <label class="detail-row"><span>Runtime Enabled</span><input type="checkbox" data-spline-rigid-flag="runtimeEnabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.runtimeEnabled !== false ? "checked" : ""} ${locked}></label>
          <label class="detail-row"><span>Align to Spline</span><input type="checkbox" data-spline-rigid-flag="alignToSpline" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.alignToSpline !== false ? "checked" : ""} ${locked}></label>
          <label class="detail-row"><span>Posts at Joints</span><input type="checkbox" data-spline-rigid-flag="placePostsAtJoints" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.placePostsAtJoints ? "checked" : ""} ${locked}></label>
          <label class="detail-row"><span>Joint Post Mesh</span><select data-spline-rigid-joint-mesh="${escapeHtml(generator.id)}" ${locked}><option value="">None</option>${meshOptions.replace(`value="${escapeHtml(generator.jointMeshAsset ?? "")}"`, `value="${escapeHtml(generator.jointMeshAsset ?? "")}" selected`)}</select></label>
          <div class="detail-readonly">Fixed leaves an end gap; Stretch Last scales only the final +Z panel; Distribute spaces the nominal panels uniformly.</div>
          <div class="detail-button-row"><button type="button" data-spline-generator-remove="${escapeHtml(generator.id)}" ${locked}>Remove Generator</button></div>
        </div>`;
      }
      if (generator.type === "deformMesh") {
        const axes: SplineMeshAxis[] = ["x", "y", "z", "-x", "-y", "-z"];
        const axisOptions = (selected: SplineMeshAxis | undefined) => axes.map((axis) => `<option value="${axis}" ${axis === selected ? "selected" : ""}>${axis.toUpperCase()}</option>`).join("");
        return `<div class="detail-subsection spline-generator" data-spline-generator-card="${escapeHtml(generator.id)}">
          <div class="detail-subsection-title">Deformed Mesh · ${escapeHtml(generator.id)}</div>
          <div class="detail-readonly">${diagnostic?.instanceCount ?? 0} continuous mesh · ${diagnostic?.triangleCount ?? 0} triangles${diagnostic?.rebuildMs !== null && diagnostic?.rebuildMs !== undefined ? ` · ${diagnostic.rebuildMs.toFixed(1)} ms${diagnostic.preview ? " preview" : ""}` : ""}${diagnostic?.missingAssetId ? ` · Missing mesh: ${escapeHtml(diagnostic.missingAssetId)}` : ""}</div>
          ${warningMarkup}
          <label class="detail-row"><span>Mesh</span><select data-spline-deform-mesh="${escapeHtml(generator.id)}" ${locked}><option value="">Choose mesh…</option>${meshOptions.replace(`value="${escapeHtml(generator.meshAsset)}"`, `value="${escapeHtml(generator.meshAsset)}" selected`)}</select></label>
          <label class="detail-row"><span>Forward Axis</span><select data-spline-deform-axis="forwardAxis" data-spline-generator-id="${escapeHtml(generator.id)}" ${locked}>${axisOptions(generator.forwardAxis ?? "z")}</select></label>
          <label class="detail-row"><span>Up Axis</span><select data-spline-deform-axis="upAxis" data-spline-generator-id="${escapeHtml(generator.id)}" ${locked}>${axisOptions(generator.upAxis ?? "y")}</select></label>
          <label class="detail-row"><span>Geometry</span><select data-spline-deform-geometry="${escapeHtml(generator.id)}" ${locked}><option value="segments" ${(generator.geometryMode ?? "segments") === "segments" ? "selected" : ""}>Per segment chunks</option><option value="whole" ${generator.geometryMode === "whole" ? "selected" : ""}>One whole mesh</option></select></label>
          <div class="detail-hint">Segment chunks make point drags rebuild only the nearby geometry; whole mesh preserves a continuous source asset.</div>
          <label class="detail-row"><span>Sample Steps</span><input type="number" min="2" max="128" step="1" data-spline-deform-number="sampleSteps" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.sampleSteps ?? 16}" ${locked}></label>
          <label class="detail-row"><span>UV Mode</span><select data-spline-deform-uv="${escapeHtml(generator.id)}" ${locked}><option value="stretch" ${(generator.uvMode ?? "stretch") === "stretch" ? "selected" : ""}>Stretch</option><option value="tileByDistance" ${generator.uvMode === "tileByDistance" ? "selected" : ""}>Tile by distance</option></select></label>
          <label class="detail-row"><span>UV Tile Length</span><input type="number" min="0.01" step="0.1" data-spline-deform-number="uvTileLength" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.uvTileLength ?? 1}" ${locked}></label>
          <label class="detail-row"><span>Lateral Offset</span><input type="number" step="0.1" data-spline-deform-number="lateralOffset" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.lateralOffset ?? 0}" ${locked}></label>
          <label class="detail-row"><span>Vertical Offset</span><input type="number" step="0.1" data-spline-deform-number="verticalOffset" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.verticalOffset ?? 0}" ${locked}></label>
          <label class="detail-row"><span>Enabled</span><input type="checkbox" data-spline-deform-flag="enabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.enabled !== false ? "checked" : ""} ${locked}></label>
          <label class="detail-row"><span>Editor Preview</span><input type="checkbox" data-spline-deform-flag="previewEnabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.previewEnabled !== false ? "checked" : ""} ${locked}></label>
          <label class="detail-row"><span>Runtime Enabled</span><input type="checkbox" data-spline-deform-flag="runtimeEnabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.runtimeEnabled !== false ? "checked" : ""} ${locked}></label>
          <label class="detail-row"><span>Static Mesh Collision</span><input type="checkbox" data-spline-deform-flag="collisionEnabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.collisionEnabled ? "checked" : ""} ${locked}></label>
          <div class="detail-button-row"><button type="button" data-spline-generator-remove="${escapeHtml(generator.id)}" ${locked}>Remove Generator</button></div>
        </div>`;
      }
      const random = generator.random ?? {};
      return `<div class="detail-subsection spline-generator" data-spline-generator-card="${escapeHtml(generator.id)}">
        <div class="detail-subsection-title">Instances · ${escapeHtml(generator.id)}</div>
        <div class="detail-readonly">${diagnostic?.instanceCount ?? 0} generated instances${diagnostic?.missingAssetId ? ` · Missing mesh: ${escapeHtml(diagnostic.missingAssetId)}` : ""}</div>
        <label class="detail-row"><span>Mesh</span><select data-spline-generator-mesh="${escapeHtml(generator.id)}" ${locked}><option value="">Choose mesh…</option>${meshOptions.replace(`value="${escapeHtml(generator.meshAsset)}"`, `value="${escapeHtml(generator.meshAsset)}" selected`)}</select></label>
        <label class="detail-row"><span>Enabled</span><input type="checkbox" data-spline-generator-flag="enabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.enabled !== false ? "checked" : ""} ${locked}></label>
        <label class="detail-row"><span>Editor Preview</span><input type="checkbox" data-spline-generator-flag="previewEnabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.previewEnabled !== false ? "checked" : ""} ${locked}></label>
        <label class="detail-row"><span>Runtime Enabled</span><input type="checkbox" data-spline-generator-flag="runtimeEnabled" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.runtimeEnabled !== false ? "checked" : ""} ${locked}></label>
        <label class="detail-row"><span>Point Placement</span><input type="checkbox" data-spline-generator-flag="placementMode" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.placementMode === "point" ? "checked" : ""} ${locked}></label>
        <label class="detail-row"><span>Align to Spline</span><input type="checkbox" data-spline-generator-flag="alignToSpline" data-spline-generator-id="${escapeHtml(generator.id)}" ${generator.alignToSpline !== false ? "checked" : ""} ${locked}></label>
        <label class="detail-row"><span>Spacing</span><input type="number" min="0.01" step="0.1" data-spline-generator-number="spacing" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.spacing}" ${locked}></label>
        <label class="detail-row"><span>Start Offset</span><input type="number" step="0.1" data-spline-generator-number="startOffset" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.startOffset ?? 0}" ${locked}></label>
        <label class="detail-row"><span>End Offset</span><input type="number" step="0.1" data-spline-generator-number="endOffset" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.endOffset ?? 0}" ${locked}></label>
        <label class="detail-row"><span>Lateral Offset</span><input type="number" step="0.1" data-spline-generator-number="lateralOffset" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.lateralOffset ?? 0}" ${locked}></label>
        <label class="detail-row"><span>Vertical Offset</span><input type="number" step="0.1" data-spline-generator-number="verticalOffset" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.verticalOffset ?? 0}" ${locked}></label>
        <label class="detail-row"><span>Seed</span><input type="number" step="1" data-spline-generator-number="seed" data-spline-generator-id="${escapeHtml(generator.id)}" value="${generator.seed ?? 0}" ${locked}></label>
        <label class="detail-row"><span>Scale Min</span><input type="number" min="0.001" step="0.05" data-spline-generator-random="scaleMin" data-spline-generator-id="${escapeHtml(generator.id)}" value="${random.scaleMin ?? 1}" ${locked}></label>
        <label class="detail-row"><span>Scale Max</span><input type="number" min="0.001" step="0.05" data-spline-generator-random="scaleMax" data-spline-generator-id="${escapeHtml(generator.id)}" value="${random.scaleMax ?? 1}" ${locked}></label>
        <div class="detail-button-row"><button type="button" data-spline-generator-remove="${escapeHtml(generator.id)}" ${locked}>Remove Generator</button></div>
      </div>`;
    }).join("");
  const performanceWarnings = splinePerformanceWarnings({
    pointCount: spline.pointCount,
    generatedInstanceCount: generators.reduce((sum, generator) =>
      generator.type === "instances" || generator.type === "rigidSegments"
        ? sum + (generatorDiagnostics.get(generator.id)?.instanceCount ?? 0)
        : sum, 0),
    deformSegmentCount: generators.reduce((max, generator) =>
      generator.type === "deformMesh" && (generator.geometryMode ?? "segments") !== "whole"
        ? Math.max(max, segmentCount)
        : max, 0),
    maxDeformSampleSteps: generators.reduce((max, generator) =>
      generator.type === "deformMesh" ? Math.max(max, generator.sampleSteps ?? 16) : max, 0),
  });
  const performanceWarningMarkup = performanceWarnings
    .map((warning) => `<div class="detail-readonly">Warning: ${escapeHtml(warning)}</div>`)
    .join("");
  const pointEditor = activePoint
    ? `<div class="spline-point-editor">
      <div class="spline-point-editor__heading"><div><span>Selected point</span><strong>${escapeHtml(activePoint.id)}</strong></div><label class="detail-row"><span>Type</span><select data-spline-point-type ${locked}>${["linear", "curveAuto", "curveCustom"].map((type) => `<option value="${type}" ${activePoint.pointType === type ? "selected" : ""}>${type === "curveAuto" ? "Curve Auto" : type === "curveCustom" ? "Curve Custom" : "Linear"}</option>`).join("")}</select></label></div>
      <div class="detail-vector"><span class="detail-vector-label">Position</span><div class="vector-fields">${activePoint.position.map((value, index) => axisField(`splinePoint${index}`, ["X", "Y", "Z"][index]!, index, value, 0.05, "pr", selection.locked).replace(`data-axis=\"${index}\"`, `data-spline-point-axis=\"${index}\"`)).join("")}</div></div>
      ${activePoint.pointType === "curveCustom" ? `<label class="detail-row"><span>Linked Tangents</span><input type="checkbox" data-spline-tangents-linked ${activePoint.tangentsLinked ? "checked" : ""} ${locked}></label><div class="detail-readonly">Drag the orange handles in the viewport.</div>` : ""}
      <div class="detail-button-row spline-point-editor__actions"><button type="button" data-spline-point-delete ${locked}>Delete Point</button>${splitButtons}</div>
      </div>`
    : "<div class=\"spline-generator-empty\"><strong>No control points</strong><span>Add a point to begin shaping this spline.</span></div>";
  body.innerHTML = `
    <section class="details-section spline-details"><div class="spline-details__header"><div><h3>Spline</h3><span>${spline.pointCount} control points</span></div><span class="spline-status ${spline.closed ? "is-closed" : ""}">${spline.closed ? "Closed loop" : "Open path"}</span></div>
      ${hasDegenerateSegment ? "<div class=\"detail-readonly\">Warning: a segment has coincident control points; move or delete one point.</div>" : ""}
      ${performanceWarningMarkup}
      <div class="spline-details__section"><div class="spline-details__section-heading"><span>Path settings</span><small>Shape and editor display</small></div>
        <div class="spline-toggle-grid">
          <label class="spline-toggle"><input type="checkbox" data-spline-closed ${spline.closed ? "checked" : ""} ${locked}><span><strong>Closed loop</strong><small>Connect last point to first</small></span></label>
          <label class="spline-toggle"><input type="checkbox" data-spline-debug-visible ${spline.debugVisible ? "checked" : ""} ${locked}><span><strong>Show path</strong><small>Display in the viewport</small></span></label>
          <label class="spline-toggle"><input type="checkbox" data-spline-show-point-ids ${spline.showPointIds ? "checked" : ""} ${locked}><span><strong>Point labels</strong><small>Show point IDs in the viewport</small></span></label>
        </div>
        <div class="spline-debug-controls"><label><span>Preview detail</span><input type="number" min="2" max="128" step="1" data-spline-debug-resolution value="${spline.debugResolution}" ${locked}></label></div>
      </div>
      <div class="spline-details__section"><div class="spline-details__section-heading"><span>Generators</span><small>Procedural content along this path</small></div>
      ${generatorMarkup}
      <div class="spline-generator-actions"><button type="button" class="spline-action-primary" data-spline-generator-add ${locked}>+ Instance generator</button><button type="button" data-spline-rigid-generator-add ${locked}>+ Rigid segments</button><button type="button" data-spline-deform-generator-add ${locked}>+ Deformed mesh</button></div>
      </div>
      <div class="spline-details__section"><div class="spline-details__section-heading"><span>Control points</span><small>Select, shape and split the path</small></div>
      <div class="spline-point-toolbar"><div class="spline-point-list">${pointButtons}</div><button type="button" class="spline-action-primary spline-icon-button" data-spline-point-add aria-label="Add control point" title="Add control point" ${locked}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg></button></div>
      ${pointEditor}</div>
    </section>`;
  body.querySelector<HTMLInputElement>("[data-spline-closed]")?.addEventListener("change", (event) => options.setSelectedSpline({ closed: (event.currentTarget as HTMLInputElement).checked }));
  body.querySelector<HTMLInputElement>("[data-spline-debug-visible]")?.addEventListener("change", (event) => options.setSelectedSpline({ debugVisible: (event.currentTarget as HTMLInputElement).checked }));
  body.querySelector<HTMLInputElement>("[data-spline-show-point-ids]")?.addEventListener("change", (event) => options.setSelectedSpline({ showPointIds: (event.currentTarget as HTMLInputElement).checked }));
  body.querySelector<HTMLInputElement>("[data-spline-debug-resolution]")?.addEventListener("change", (event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) options.setSelectedSpline({ debugResolution: value });
  });
  body.querySelector<HTMLButtonElement>("[data-spline-generator-add]")?.addEventListener("click", () => options.addSelectedSplineInstanceGenerator());
  body.querySelector<HTMLButtonElement>("[data-spline-rigid-generator-add]")?.addEventListener("click", () => options.addSelectedSplineRigidSegmentGenerator());
  body.querySelector<HTMLButtonElement>("[data-spline-deform-generator-add]")?.addEventListener("click", () => options.addSelectedSplineDeformMeshGenerator());
  body.querySelectorAll<HTMLButtonElement>("[data-spline-generator-remove]").forEach((button) => button.addEventListener("click", () => options.removeSelectedSplineGenerator(button.dataset.splineGeneratorRemove ?? "")));
  body.querySelectorAll<HTMLSelectElement>("[data-spline-generator-mesh]").forEach((input) => input.addEventListener("change", () => {
    options.setSelectedSplineInstanceGenerator(input.dataset.splineGeneratorMesh ?? "", { meshAsset: input.value });
  }));
  body.querySelectorAll<HTMLInputElement>("[data-spline-generator-flag]").forEach((input) => input.addEventListener("change", () => {
    const id = input.dataset.splineGeneratorId ?? "";
    const key = input.dataset.splineGeneratorFlag;
    if (key === "placementMode") options.setSelectedSplineInstanceGenerator(id, { placementMode: input.checked ? "point" : "distance" });
    else if (key === "enabled" || key === "previewEnabled" || key === "runtimeEnabled" || key === "alignToSpline") {
      options.setSelectedSplineInstanceGenerator(id, { [key]: input.checked } as Partial<ForgeSplineInstanceGeneratorDef>);
    }
  }));
  body.querySelectorAll<HTMLInputElement>("[data-spline-generator-number]").forEach((input) => input.addEventListener("change", () => {
    const value = Number(input.value);
    const id = input.dataset.splineGeneratorId ?? "";
    const key = input.dataset.splineGeneratorNumber;
    if (!Number.isFinite(value) || !key) return;
    options.setSelectedSplineInstanceGenerator(id, { [key]: value } as Partial<ForgeSplineInstanceGeneratorDef>);
  }));
  body.querySelectorAll<HTMLInputElement>("[data-spline-generator-random]").forEach((input) => input.addEventListener("change", () => {
    const value = Number(input.value);
    const id = input.dataset.splineGeneratorId ?? "";
    const key = input.dataset.splineGeneratorRandom;
    if (!Number.isFinite(value) || (key !== "scaleMin" && key !== "scaleMax")) return;
    options.setSelectedSplineInstanceGenerator(id, { random: { [key]: value } });
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-spline-deform-mesh]").forEach((input) => input.addEventListener("change", () => options.setSelectedSplineDeformMeshGenerator(input.dataset.splineDeformMesh ?? "", { meshAsset: input.value })));
  body.querySelectorAll<HTMLSelectElement>("[data-spline-deform-axis]").forEach((input) => input.addEventListener("change", () => {
    const key = input.dataset.splineDeformAxis;
    const value = input.value as SplineMeshAxis;
    if (key === "forwardAxis" || key === "upAxis") options.setSelectedSplineDeformMeshGenerator(input.dataset.splineGeneratorId ?? "", { [key]: value } as Partial<ForgeSplineDeformMeshGeneratorDef>);
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-spline-deform-uv]").forEach((input) => input.addEventListener("change", () => {
    if (input.value === "stretch" || input.value === "tileByDistance") options.setSelectedSplineDeformMeshGenerator(input.dataset.splineDeformUv ?? "", { uvMode: input.value });
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-spline-deform-geometry]").forEach((input) => input.addEventListener("change", () => {
    if (input.value === "whole" || input.value === "segments") options.setSelectedSplineDeformMeshGenerator(input.dataset.splineDeformGeometry ?? "", { geometryMode: input.value });
  }));
  body.querySelectorAll<HTMLInputElement>("[data-spline-deform-number]").forEach((input) => input.addEventListener("change", () => {
    const key = input.dataset.splineDeformNumber;
    const value = Number(input.value);
    if (!Number.isFinite(value) || !key) return;
    if (key === "sampleSteps" || key === "uvTileLength" || key === "lateralOffset" || key === "verticalOffset") options.setSelectedSplineDeformMeshGenerator(input.dataset.splineGeneratorId ?? "", { [key]: value } as Partial<ForgeSplineDeformMeshGeneratorDef>);
  }));
  body.querySelectorAll<HTMLInputElement>("[data-spline-deform-flag]").forEach((input) => input.addEventListener("change", () => {
    const key = input.dataset.splineDeformFlag;
    if (key === "enabled" || key === "previewEnabled" || key === "runtimeEnabled" || key === "collisionEnabled") options.setSelectedSplineDeformMeshGenerator(input.dataset.splineGeneratorId ?? "", { [key]: input.checked } as Partial<ForgeSplineDeformMeshGeneratorDef>);
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-spline-rigid-mesh]").forEach((input) => input.addEventListener("change", () => {
    options.setSelectedSplineRigidSegmentGenerator(input.dataset.splineRigidMesh ?? "", { meshAsset: input.value });
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-spline-rigid-joint-mesh]").forEach((input) => input.addEventListener("change", () => {
    options.setSelectedSplineRigidSegmentGenerator(input.dataset.splineRigidJointMesh ?? "", { jointMeshAsset: input.value });
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-spline-rigid-fit]").forEach((input) => input.addEventListener("change", () => {
    const fitMode = input.value;
    if (fitMode === "fixed" || fitMode === "stretchLast" || fitMode === "distribute") options.setSelectedSplineRigidSegmentGenerator(input.dataset.splineRigidFit ?? "", { fitMode });
  }));
  body.querySelectorAll<HTMLInputElement>("[data-spline-rigid-flag]").forEach((input) => input.addEventListener("change", () => {
    const key = input.dataset.splineRigidFlag;
    if (key === "enabled" || key === "previewEnabled" || key === "runtimeEnabled" || key === "alignToSpline" || key === "placePostsAtJoints") {
      options.setSelectedSplineRigidSegmentGenerator(input.dataset.splineGeneratorId ?? "", { [key]: input.checked } as Partial<ForgeSplineRigidSegmentGeneratorDef>);
    }
  }));
  body.querySelectorAll<HTMLInputElement>("[data-spline-rigid-number]").forEach((input) => input.addEventListener("change", () => {
    const value = Number(input.value);
    const key = input.dataset.splineRigidNumber;
    if (!Number.isFinite(value) || !key) return;
    const id = input.dataset.splineGeneratorId ?? "";
    if (key === "yaw") options.setSelectedSplineRigidSegmentGenerator(id, { rotationOffset: [0, value, 0] });
    else if (key === "segmentLength" || key === "gap") options.setSelectedSplineRigidSegmentGenerator(id, { [key]: value } as Partial<ForgeSplineRigidSegmentGeneratorDef>);
  }));
  body.querySelector<HTMLButtonElement>("[data-spline-point-add]")?.addEventListener("click", () => options.addSelectedSplinePoint());
  body.querySelectorAll<HTMLButtonElement>("[data-spline-point]").forEach((button) => button.addEventListener("click", () => options.selectSplinePoint(button.dataset.splinePoint ?? null)));
  body.querySelector<HTMLButtonElement>("[data-spline-point-delete]")?.addEventListener("click", () => options.deleteSelectedSplinePoint(activePoint?.id));
  body.querySelectorAll<HTMLButtonElement>("[data-spline-split]").forEach((button) => button.addEventListener("click", () => options.splitSelectedSplineSegment(Number(button.dataset.splineSplit))));
  body.querySelector<HTMLSelectElement>("[data-spline-point-type]")?.addEventListener("change", (event) => {
    if (!activePoint) return;
    options.setSelectedSplinePoint(activePoint.id, { pointType: (event.currentTarget as HTMLSelectElement).value as "linear" | "curveAuto" | "curveCustom" });
  });
  body.querySelector<HTMLInputElement>("[data-spline-tangents-linked]")?.addEventListener("change", (event) => {
    if (activePoint) options.setSelectedSplinePointTangentsLinked(activePoint.id, (event.currentTarget as HTMLInputElement).checked);
  });
  body.querySelectorAll<HTMLInputElement>("[data-spline-point-axis]").forEach((input) => input.addEventListener("change", () => {
    if (!activePoint) return;
    const axis = Number(input.dataset.splinePointAxis);
    const value = Number(input.value);
    if (!Number.isInteger(axis) || axis < 0 || axis > 2 || !Number.isFinite(value)) return;
    const position: Vec3 = [...activePoint.position];
    position[axis] = value;
    options.setSelectedSplinePoint(activePoint.id, { position });
  }));
}

export function renderWorldWidgetDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection } = options;
  const widget = selection.worldWidget;
  if (!widget) return;
  options.setDetailsScale([...selection.scale]);
  const p = selection.position;
  const o3 = widget.offset3d;
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>ui / world widget</span>
      </div>
      <label class="detail-row">
        <span>Widget</span>
        <input data-ww-field="widget" type="text" value="${escapeHtml(widget.widget)}"
          placeholder="ui asset id (e.g. world-label)" />
      </label>
      <div class="detail-section">
        <div class="detail-section-title">Anchor</div>
        <label class="detail-row"><span>World X</span>
          <input data-ww-pos="0" type="number" step="0.1" value="${p[0]}" /></label>
        <label class="detail-row"><span>World Y</span>
          <input data-ww-pos="1" type="number" step="0.1" value="${p[1]}" /></label>
        <label class="detail-row"><span>World Z</span>
          <input data-ww-pos="2" type="number" step="0.1" value="${p[2]}" /></label>
        <label class="detail-row"><span>Entity Id</span>
          <input data-ww-field="entityId" type="text" value="${escapeHtml(widget.entityId)}"
            placeholder="actor:0 (optional, tracks entity)" /></label>
        <label class="detail-row"><span>Offset X</span>
          <input data-ww-off3="0" type="number" step="0.1" value="${o3[0]}" /></label>
        <label class="detail-row"><span>Offset Y</span>
          <input data-ww-off3="1" type="number" step="0.1" value="${o3[1]}" /></label>
        <label class="detail-row"><span>Offset Z</span>
          <input data-ww-off3="2" type="number" step="0.1" value="${o3[2]}" /></label>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Screen</div>
        <label class="detail-row"><span>Offset X (px)</span>
          <input data-ww-off="0" type="number" step="1" value="${widget.offset[0]}" /></label>
        <label class="detail-row"><span>Offset Y (px)</span>
          <input data-ww-off="1" type="number" step="1" value="${widget.offset[1]}" /></label>
        <label class="detail-row"><span>Max Distance</span>
          <input data-ww-field="maxDistance" type="number" min="0" step="1"
            value="${widget.maxDistance}" /></label>
      </div>
      <div class="detail-hint">World-space billboard. Anchor by a world point or an entity id; offsets nudge it. Position is edited numerically here (no gizmo yet).</div>
    `;

  body.querySelectorAll<HTMLInputElement>("[data-ww-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.wwField;
      if (key === "widget") options.setSelectedWorldWidget({ widget: input.value.trim() });
      else if (key === "entityId") options.setSelectedWorldWidget({ entityId: input.value.trim() });
      else if (key === "maxDistance") {
        const value = Number(input.value);
        options.setSelectedWorldWidget({ maxDistance: Number.isFinite(value) ? value : 0 });
      }
    });
  });

  body.querySelectorAll<HTMLInputElement>("[data-ww-pos]").forEach((input) => {
    input.addEventListener("change", () =>
      options.setSelectedWorldWidget({ worldPos: readWorldWidgetVec(body, "ww-pos", selection.position) }),
    );
  });
  body.querySelectorAll<HTMLInputElement>("[data-ww-off3]").forEach((input) => {
    input.addEventListener("change", () =>
      options.setSelectedWorldWidget({ offset3d: readWorldWidgetVec(body, "ww-off3", widget.offset3d) }),
    );
  });
  body.querySelectorAll<HTMLInputElement>("[data-ww-off]").forEach((input) => {
    input.addEventListener("change", () =>
      options.setSelectedWorldWidget({ offset: readWorldWidgetOffset(body, widget.offset) }),
    );
  });
}

export function renderReflectionCaptureDetails(options: SpecialActorDetailsOptions): void {
  const { body, selection } = options;
  const capture = selection.reflectionCapture;
  if (!capture) return;
  options.setDetailsScale([...selection.scale]);
  const lockedAttr = selection.locked ? "disabled" : "";
  const resolutions = [64, 128, 256, 512, 1024];
  const bakeStale = options.isSelectedReflectionCaptureBakeStale();
  body.innerHTML = `
      <div class="detail-heading">
        <strong>${escapeHtml(selection.label)}</strong>
        <span>reflection / sphere capture</span>
      </div>
      <label class="detail-row">
        <span>Name</span>
        <input data-detail-name type="text" value="${escapeHtml(selection.label)}"
          placeholder="Sphere Reflection Capture" />
      </label>
      ${vectorRow("Location", "p", selection.position, 0.1, selection.locked)}
      <div class="detail-section">
        <div class="detail-section-title">Reflection Capture</div>
        <label class="detail-row">
          <span>Radius</span>
          <input data-capture-field="radius" type="number" min="0.1" step="0.1"
            value="${capture.radius}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Resolution</span>
          <select data-capture-field="resolution" ${lockedAttr}>
            ${resolutions
              .map(
                (res) =>
                  `<option value="${res}" ${
                    capture.resolution === res ? "selected" : ""
                  }>${res}px</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="detail-row">
          <span>Intensity</span>
          <input data-capture-field="intensity" type="number" min="0" max="4" step="0.05"
            value="${capture.intensity}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Near</span>
          <input data-capture-field="near" type="number" min="0.001" step="0.1"
            value="${capture.near}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Far</span>
          <input data-capture-field="far" type="number" min="0.1" step="1"
            value="${capture.far}" ${lockedAttr} />
        </label>
        <label class="detail-row">
          <span>Priority</span>
          <input data-capture-field="priority" type="number" step="1"
            value="${capture.priority}" ${lockedAttr} />
        </label>
        <label class="detail-toggle">
          <input type="checkbox" data-capture-field="parallax"
            ${capture.parallax ? "checked" : ""} ${lockedAttr} />
          <span>Parallax Correction</span>
        </label>
        ${
          bakeStale
            ? `<div class="detail-hint detail-hint-warning">Bake is stale - the probe moved or near/far changed since capture. Press Recapture.</div>`
            : ""
        }
        <button type="button" data-capture-recapture class="detail-button${
          bakeStale ? " detail-button-warning" : ""
        }">Recapture</button>
        <button type="button" data-capture-recapture-all class="detail-button">Recapture All</button>
        <div class="detail-hint">Static capture: bakes a cubemap from this point - press Recapture after moving the probe or scene.</div>
      </div>
      ${actorLockSection(selection)}
    `;

  bindPositionRotation(options);
  bindNameAndLock(options);

  body
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-capture-field]")
    .forEach((field) => {
      field.addEventListener("change", () => {
        const key = field.dataset.captureField as CaptureNumericKey | "parallax" | undefined;
        if (!key) return;
        if (key === "parallax") {
          options.setSelectedReflectionCapture({ parallax: (field as HTMLInputElement).checked });
          return;
        }
        const value = Number(field.value);
        if (!Number.isFinite(value)) return;
        const patch: Partial<Record<CaptureNumericKey, number>> = {};
        patch[key] = value;
        options.setSelectedReflectionCapture(patch);
      });
    });

  body
    .querySelector<HTMLButtonElement>("[data-capture-recapture]")
    ?.addEventListener("click", () => {
      options.recaptureSelectedReflectionCapture();
    });

  body
    .querySelector<HTMLButtonElement>("[data-capture-recapture-all]")
    ?.addEventListener("click", () => {
      options.recaptureAllReflectionCaptures();
    });
}

function bindTransformInputs(options: TransformBindOptions, includeScale: boolean): void {
  bindPositionRotation(options);
  if (includeScale) bindScale(options);
}

function bindPositionRotation({
  body,
  beginDetailsEdit,
  applyDetails,
  commitDetailsEdit,
}: TransformBindOptions): void {
  body.querySelectorAll<HTMLInputElement>('input[data-detail="pr"]').forEach((input) => {
    input.addEventListener("focus", () => beginDetailsEdit());
    input.addEventListener("input", () => {
      beginDetailsEdit();
      applyDetails();
    });
    input.addEventListener("change", () => commitDetailsEdit());
  });
}

function bindScale(options: TransformBindOptions): void {
  const { body, selection } = options;
  body.querySelectorAll<HTMLInputElement>('input[data-detail="scale"]').forEach((input) => {
    input.addEventListener("focus", () => options.beginDetailsEdit());
    input.addEventListener("input", () => {
      options.beginDetailsEdit();
      options.applyScaleInput(input);
      options.applyDetails();
    });
    input.addEventListener("change", () => options.commitDetailsEdit());
  });

  body.querySelector<HTMLButtonElement>("[data-scale-lock]")?.addEventListener("click", () => {
    options.setSelectionScaleLocked(!selection.scaleLocked);
  });
}

function bindNameAndLock(options: TransformBindOptions): void {
  const { body, selection } = options;
  const nameInput = body.querySelector<HTMLInputElement>("[data-detail-name]");
  nameInput?.addEventListener("change", () => {
    options.renameSceneObject(selection.id, nameInput.value);
  });

  body.querySelectorAll<HTMLInputElement>("[data-detail-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () =>
      options.handleDetailToggle(toggle.dataset.detailToggle ?? "", toggle.checked),
    );
  });
}

function actorLockSection(selection: EditableSelection): string {
  return `
      <div class="detail-section">
        <div class="detail-section-title">Actor</div>
        <label class="detail-toggle">
          <input type="checkbox" data-detail-toggle="locked" ${selection.locked ? "checked" : ""} />
          <span>Lock Movement</span>
        </label>
      </div>`;
}

function formatLandscapeTool(tool: LandscapeSculptTool): string {
  if (tool === "raise") return "Raise";
  if (tool === "lower") return "Lower";
  if (tool === "smooth") return "Smooth";
  return "Flatten";
}

function formatLandscapePaintTool(tool: LandscapePaintTool): string {
  if (tool === "paint") return "Paint";
  if (tool === "erase") return "Erase";
  return "Smooth Weights";
}

function formatLandscapeViewMode(mode: LandscapeViewMode): string {
  if (mode === "height") return "Height";
  if (mode === "slope") return "Slope";
  if (mode === "layer") return "Layer Weight";
  return "Lit";
}

function targetPointSelect(
  point: NonNullable<EditableSelection["targetPoint"]>,
  targetPoints: readonly TargetPointReference[],
  lockedAttr: string,
): string {
  const candidates = targetPoints.filter((candidate) => candidate.id !== point.id);
  const selected = point.nextTargetPoint;
  const hasSelected = candidates.some((candidate) => candidate.id === selected);
  const missingOption =
    selected && !hasSelected
      ? `<option value="${escapeHtml(selected)}" selected>Missing: ${escapeHtml(selected)}</option>`
      : "";
  const options = candidates
    .map((candidate) => {
      const label = `${candidate.name} (${candidate.id})`;
      return `<option value="${escapeHtml(candidate.id)}" ${
        candidate.id === selected ? "selected" : ""
      }>${escapeHtml(label)}</option>`;
    })
    .join("");
  return `
          <select data-target-point-next ${lockedAttr}>
            <option value="" ${selected ? "" : "selected"}>None</option>
            ${missingOption}
            ${options}
          </select>`;
}

function brushDimensionRows(volume: EditableBlockingVolume, lockedAttr: string): string {
  const numberRow = (label: string, attr: string, value: number, step = 0.1): string => `
        <label class="detail-row">
          <span>${label}</span>
          <input data-brush-dim ${attr} type="number" min="0.01" step="${step}"
            value="${value}" ${lockedAttr} />
        </label>`;
  if (volume.brushShape === "box") {
    return (
      numberRow("X", 'data-brush-size="0"', volume.size[0]) +
      numberRow("Y", 'data-brush-size="1"', volume.size[1]) +
      numberRow("Z", 'data-brush-size="2"', volume.size[2])
    );
  }
  if (volume.brushShape === "sphere") {
    return numberRow("Radius", "data-brush-radius", volume.size[0] / 2);
  }
  return (
    numberRow("Radius", "data-brush-radius", volume.size[0] / 2) +
    numberRow("Height", "data-brush-height", volume.size[1]) +
    `
        <label class="detail-row">
          <span>Sides</span>
          <input data-brush-dim data-brush-sides type="number" min="3" max="128" step="1"
            value="${volume.brushSides}" ${lockedAttr} />
        </label>`
  );
}

function navigationVolumeDimensionRows(volume: EditableAiNavigationVolume, lockedAttr: string): string {
  return [0, 1, 2]
    .map((axis) => {
      const label = axis === 0 ? "X" : axis === 1 ? "Y" : "Z";
      return `
        <label class="detail-row">
          <span>${label}</span>
          <input data-ai-nav-size="${axis}" type="number" min="0.01" step="0.1"
            value="${volume.size[axis]}" ${lockedAttr} />
        </label>`;
    })
    .join("");
}

function readNavigationVolumeSize(body: HTMLElement, volume: EditableAiNavigationVolume): Vec3 {
  const size: Vec3 = [volume.size[0], volume.size[1], volume.size[2]];
  for (let axis = 0; axis < 3; axis += 1) {
    const input = body.querySelector<HTMLInputElement>(`[data-ai-nav-size="${axis}"]`);
    if (!input) continue;
    const value = Number(input.value);
    if (Number.isFinite(value) && value > 0) size[axis] = value;
  }
  return size;
}

function readBrushDimensions(
  body: HTMLElement,
  volume: EditableBlockingVolume,
): { size: Vec3; brushSides?: number } {
  const readPositive = (attr: string, fallback: number): number => {
    const input = body.querySelector<HTMLInputElement>(`[${attr}]`);
    if (!input) return fallback;
    const value = Number(input.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  if (volume.brushShape === "box") {
    return {
      size: [
        readPositive('data-brush-size="0"', volume.size[0]),
        readPositive('data-brush-size="1"', volume.size[1]),
        readPositive('data-brush-size="2"', volume.size[2]),
      ],
    };
  }
  if (volume.brushShape === "sphere") {
    const diameter = readPositive("data-brush-radius", volume.size[0] / 2) * 2;
    return { size: [diameter, diameter, diameter] };
  }
  const diameter = readPositive("data-brush-radius", volume.size[0] / 2) * 2;
  const height = readPositive("data-brush-height", volume.size[1]);
  const sides = readPositive("data-brush-sides", volume.brushSides);
  return { size: [diameter, height, diameter], brushSides: sides };
}

function readWorldWidgetVec(body: HTMLElement, attr: string, fallback: Vec3): Vec3 {
  const vec: Vec3 = [fallback[0], fallback[1], fallback[2]];
  for (let i = 0; i < 3; i += 1) {
    const input = body.querySelector<HTMLInputElement>(`[data-${attr}="${i}"]`);
    if (input) {
      const value = Number(input.value);
      if (Number.isFinite(value)) vec[i] = value;
    }
  }
  return vec;
}

function readWorldWidgetOffset(body: HTMLElement, fallback: [number, number]): [number, number] {
  const out: [number, number] = [fallback[0], fallback[1]];
  for (let i = 0; i < 2; i += 1) {
    const input = body.querySelector<HTMLInputElement>(`[data-ww-off="${i}"]`);
    if (input) {
      const value = Number(input.value);
      if (Number.isFinite(value)) out[i] = value;
    }
  }
  return out;
}

function formatBrushShapeLabel(shape: BrushShape): string {
  return shape.charAt(0).toUpperCase() + shape.slice(1);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
