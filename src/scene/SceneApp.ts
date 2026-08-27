/**
 * SceneApp - the single render-layer orchestrator (L11 boundary).
 *
 * three.js is imported ONLY under src/scene/. Game rules live in pure-TS
 * modules (M1-M9, src/core/...) and talk to this layer via the event bus.
 * This class owns: renderer, scene graph, camera rig, lights, frame loop.
 */
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Plane,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector3,
} from "three";
import type {
  AmbientLight,
  Camera,
  InstancedMesh,
  Material,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AssetLoader } from "./assetLoader";
import { EngineApp } from "@engine/core/EngineApp";
import type { Subsystem } from "@engine/core/Subsystem";
import { AnimationSubsystem } from "@engine/render-three/animationSubsystem";
import { ActionMap, type ActionBindings } from "@engine/input/actionMap";
import { InputSubsystem } from "@engine/input/inputSubsystem";
import {
  BehaviorSubsystem,
  type ScriptMessageDebugSnapshot,
} from "@engine/behavior/behaviorSubsystem";
import { AISubsystem, type AiDebugSnapshot } from "@engine/ai/aiSubsystem";
import { createTargetPointIndex, targetPointEntriesFromLayout } from "@engine/ai/targetPoints";
import {
  normalizeAiBehaviorTreeAsset,
  normalizeAiBlackboardAsset,
  type AiBehaviorTreeAsset,
  type AiBlackboardAsset,
} from "@engine/ai/behaviorAsset";
import { normalizeAiStateTreeAsset, type AiStateTreeAsset } from "@engine/ai/stateTreeAsset";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { AudioSubsystem } from "@engine/audio/audioSubsystem";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { createBehaviorRegistry } from "@/game/behaviors";
import { createGameAiTaskRegistry } from "@/game/ai/tasks";
import { collapseCoincidentFloors, findGroundLayersAt } from "@engine/movement/characterCollision";
import { DEFAULT_GAME_MODE_ID, normalizeGameModeId } from "@/game/gameModes/catalog";
import { slopeCosFromDegrees } from "@engine/movement/slopeSurface";
import type { PlayCameraPose } from "@/play/cameraHandoff";
import {
  assetPath,
  assetRecordById,
  assetType,
  isModelAssetType,
  type AssetManifest,
  type EditableAsset,
} from "@engine/assets/manifest";
import {
  dirnameProjectPath,
  loadActiveProject,
  projectFileUrl,
  type ActiveProject,
} from "@/project/ProjectSystem";
import { loadRoomLayout } from "./roomLayout";
import {
  applyEulerDegrees,
  colliderBoxFromBounds,
  composePlacementMatrix,
} from "@engine/render-three/transforms";
import {
  collisionWireboxes,
  collisionSurfaceTriangles,
  trimeshWireSegments,
} from "@engine/render-three/collisionView";
import {
  createAiNavigationView,
  disposeAiNavigationView,
  inflateNavBlocker2d,
  type AiNavAgentClearanceView,
  type AiPerceptionView,
  type AiQueryCandidateView,
  type AiTargetPointRouteView,
} from "@engine/render-three/aiNavigationView";
import {
  collectMaterialStats,
  convertUnlitModelMaterialsToLit,
  isRenderableMesh,
} from "@engine/render-three/materials";
import { buildNavGrid, type NavAabb, type NavAgent, type NavBlocker } from "@engine/navigation/gridNavigation";
import { convexHullXZ } from "@engine/physics/rotatedBox";
import {
  attachActorLight,
  entityLightItem,
  disposeLightGizmo,
  syncLightObject,
  type LightObjectRecord,
} from "@engine/render-three/lights";
import {
  applySkySunDirection,
  applySkyToneMapping,
  applySkyUniforms,
  createSkyObject,
  followCameraWithSky,
  resolveSkyAtmosphere,
  setSkyLocalToneMappingExposure,
  skyAtmosphereToneMappingExposure,
  sunDirectionFromLightRotation,
} from "@engine/render-three/skyAtmosphere";
import { applySceneFog, resolveHeightFog } from "@engine/render-three/heightFog";
import {
  advanceCloudTime,
  applyCloudUniforms,
  createCloudObject,
  followCameraWithClouds,
  resolveCloudLayer,
  type CloudDome,
} from "@engine/render-three/cloudLayer";
import {
  applyPostProcessToneMapping,
  createPostProcessAntialiasPass,
  createPostProcessEffectPasses,
  PostProcessPipeline,
  postProcessToneMappingExposure,
  resolvePostProcess,
  type ResolvedPostProcess,
} from "@engine/render-three/postProcess";
import {
  applyReflectionEnvironment,
  captureSkyEnvironment,
  resolveReflection,
} from "@engine/render-three/reflection";
import {
  applyReflectionPlaneTransform,
  createReflectionPlaneIcon,
  createReflectionPlaneObject,
  disposeReflectionPlaneObject,
  resolveReflectionPlane,
  uniqueReflectionPlaneId,
  uniqueReflectionPlaneName,
  type ReflectionPlaneObject,
  type ReflectionPlaneRenderItem,
} from "@engine/render-three/reflectionPlane";
import {
  applyLandscapeTransform,
  createFlatLandscapeData,
  createLandscapeColliderPrimitive,
  createLandscapeObject,
  disposeLandscapeObject,
  ensureLandscapeLayers,
  LANDSCAPE_DEFAULT_LAYERS,
  landscapeDataPath,
  normalizeLandscapeLayerWeights,
  resampleLandscapeHeightmap,
  landscapeHeightsToGrayscale,
  landscapeSizeForPreset,
  resampleLandscapeData,
  applyLandscapeSplineDeform,
  applyLandscapeSplinePaint,
  landscapeSplineMeshAssetIds,
  splineToPolyline,
  resolveLandscape,
  uniqueLandscapeId,
  uniqueLandscapeName,
  updateLandscapeObjectGeometry,
  type ForgeLandscapeData,
  type ForgeLandscapeSpline,
  type LandscapeDirtyBounds,
  type LandscapeLayerColors,
  type LandscapeLayerTexture,
  type LandscapeLayerWeights,
  type LandscapeObject,
  type LandscapeRenderItem,
  type LandscapeViewMode,
} from "@engine/render-three/landscape";
import {
  FoliageRenderBinding,
  foliageInstanceFromRoll,
  reapplyFoliageInstance,
  reattachFoliageInstance,
  type FoliageSelectionEntry,
} from "@engine/render-three/foliage";
import {
  computeFoliageResourceUsage,
  createEmptyFoliageData,
  foliageDataPath,
  normalizeFoliageType,
  uniqueLandscapeFoliageRuleId,
  uniqueFoliageGroupId,
  type FoliageResourceUsage,
  type ForgeFoliageTypeDef,
  type LandscapeFoliageRule,
  type LayoutFoliageData,
  type LayoutFoliageGroup,
} from "@engine/scene/foliage";
import { generateLandscapeFoliageSamples } from "@engine/scene/landscapeFoliage";
import {
  FoliageSelection,
  foliageIndicesInRadius,
  removeFoliageIndices,
} from "@engine/scene/foliageSelection";
import {
  eraseFoliageInRadius,
  foliageFillSamplePoints,
  foliageOverlaps,
  foliageSampleTargetCount,
  makeFoliageRng,
  passesFoliageFilters,
  rollFoliageInstance,
  type FoliageBrush,
  type FoliageFillArea,
  type FoliageSurfaceHit,
} from "@engine/scene/foliagePaint";
import { loadFoliageData, loadFoliageTypeByPath, loadFoliageTypesForData } from "./foliageLoader";
import {
  createEmptyMeshPaintData,
  fillMeshVertexColors,
  meshPaintDataPath,
  paintMeshVertexColors,
  repairMeshPaintTopology,
  removeMeshPaintPlacement,
  upsertMeshPaintPlacement,
  type MeshPaintChannel,
  type LayoutMeshPaintData,
  type LayoutMeshPaintPlacement,
} from "@engine/scene/meshPaint";
import { saveMeshPaintData } from "@/editor/meshPaintStore";
import {
  loadAssetVertexColors,
  saveAssetVertexColors,
  upsertAssetVertexColorMesh,
} from "@/editor/assetVertexColorsStore";
import { loadMeshPaintData } from "./meshPaintLoader";
import type { FoliageSurfacePick, MeshPaintSurfacePick } from "@editor/render-three/scenePicker";
import {
  applyReflectiveSurfaceTransform,
  createReflectiveSurfaceObject,
  disposeReflectiveSurfaceObject,
  resolveReflectiveSurface,
  uniqueReflectiveSurfaceId,
  uniqueReflectiveSurfaceName,
  type ReflectiveSurfaceObject,
  type ReflectiveSurfaceRenderItem,
} from "@engine/render-three/reflectiveSurface";
import {
  applyBlockingVolumeTransform,
  canonicalBrushSize,
  clampBrushSides,
  createBlockingVolumeObject,
  disposeBlockingVolumeObject,
  resolveBlockingVolume,
  uniqueBlockingVolumeId,
  uniqueBlockingVolumeName,
  BLOCKING_VOLUME_DEFAULTS,
  type BlockingVolumeObject,
  type BlockingVolumeRenderItem,
} from "@engine/render-three/blockingVolume";
import {
  AI_NAVIGATION_VOLUME_DEFAULT_AGENT_RADIUS,
  AI_NAVIGATION_VOLUME_DEFAULT_CLEARANCE_PADDING,
  aiNavigationVolumeAabb,
  applyAiNavigationVolumeTransform,
  createAiNavigationVolumeObject,
  disposeAiNavigationVolumeObject,
  readVolumeScale,
  resolveAiNavigationVolume,
  uniqueAiNavigationVolumeId,
  uniqueAiNavigationVolumeName,
  type AiNavigationVolumeObject,
  type AiNavigationVolumeRenderItem,
} from "@engine/render-three/aiNavigationVolume";
import {
  applyTargetPointTransform,
  createTargetPointObject,
  disposeTargetPointObject,
  resolveTargetPoint,
  uniqueTargetPointId,
  uniqueTargetPointName,
  type TargetPointObject,
  type TargetPointRenderItem,
} from "@engine/render-three/targetPoint";
import {
  createSplineObject,
  disposeSplineObject,
  updateSplineObject,
  type SplineObject,
} from "@engine/render-three/spline";
import {
  cloneSplineActor,
  createDefaultSplineActor,
  resolveSplineActorDebug,
} from "@engine/scene/splineActor";
import {
  uniqueSplinePointId as uniqueGenericSplinePointId,
  type ForgeSplinePoint,
} from "@engine/scene/spline";
import {
  createDefaultSplineInstanceGenerator,
  createDefaultSplineRigidSegmentGenerator,
  createDefaultSplineDeformMeshGenerator,
  generateSplineInstancePlacements,
  generateSplineRigidSegmentPlacements,
  normalizeSplineGenerators,
  resolveSplineDeformMeshGenerator,
  splineDeformMeshWarnings,
  splineRigidSegmentWarnings,
  type ForgeSplineGeneratorDef,
  type ForgeSplineDeformMeshGeneratorDef,
  type ForgeSplineInstanceGeneratorDef,
  type ForgeSplineRigidSegmentGeneratorDef,
} from "@engine/scene/splineGenerator";
import { buildSplineCurveCache } from "@engine/scene/splineCurve";
import { buildSplineDeformMeshGroup } from "@engine/render-three/splineDeformMesh";
import { evaluateSplineSegment } from "@engine/scene/splineCurve";
import {
  applyProbeEnvMapToObject,
  applySphereReflectionCaptureTransform,
  assignProbeEnvMapMaterial,
  bakeSphereReflectionCapture,
  createSphereReflectionCaptureIcon,
  createSphereReflectionCaptureObject,
  disposeSphereReflectionCaptureBake,
  disposeSphereReflectionCaptureObject,
  isReflectionCaptureBakeStale,
  resolveSphereReflectionCapture,
  selectNearestReflectionCapture,
  setSphereReflectionCaptureStale,
  uniqueSphereReflectionCaptureId,
  uniqueSphereReflectionCaptureName,
  type SphereReflectionCaptureBake,
  type SphereReflectionCaptureObject,
  type SphereReflectionCaptureRenderItem,
} from "@engine/render-three/reflectionCapture";
import type { Sky } from "three/examples/jsm/objects/Sky.js";
import {
  applySceneBackgroundAndAmbient,
  buildLandscapeSplineMeshGroup,
  buildSplineInstanceGeneratorGroup,
  disposeSplineGeneratedGroup,
  buildSceneCharacterObject,
  buildSceneEntities,
  buildSceneInstancedModel,
  buildSceneLightObject,
  computeComplexCollisionMeshes,
  type AssetComplexCollisionMesh,
  computeModelLocalBounds,
  computeSceneRoomBounds,
  createSceneCharacterMixer,
  DEFAULT_SCENE_AMBIENT_COLOR,
  DEFAULT_SCENE_AMBIENT_INTENSITY,
  DEFAULT_SCENE_BACKGROUND_COLOR,
  DEFAULT_SCENE_KILL_Z,
  DEFAULT_SCENE_LIGHT_COLOR,
  DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS,
  DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS,
  DEFAULT_SCENE_SUN_ID,
  ensureDefaultSceneLights,
  fitDirectionalShadowToBounds,
  isSceneSunLight,
  readSceneRuntimeStats,
  registerSceneShapeModels,
  resolveSceneWorldSettings,
  sceneModelAssetIds,
  SCENE_CAMERA_TARGET,
  startSceneRuntime,
  tagSceneLightRecordIndex,
} from "./SceneRuntimeCore";
import { SceneShell } from "./SceneShell";
import { LevelRuntime } from "./LevelRuntime";
import {
  defaultLightIntensity,
  formatLightType,
  uniqueActorName,
} from "@engine/scene/lights";
import {
  formatShapeType,
  isAmbientSoundAssetId,
  isMarkerAssetId,
  isPlayerStartAssetId,
  parseShapeAssetId,
  PLAYER_START_ASSET_ID,
  shapeAssetCollisionDef,
  shapeAssetId,
  type ShapePrimitiveType,
} from "@engine/scene/shapes";
import { createProceduralAssetGltf } from "./shapePrimitives";
import {
  AMBIENT_SOUND_MARKER_CENTER_Y,
  PLAYER_START_CAPSULE_CENTER_Y,
} from "./markerPrimitives";
import { createPlayerStartIcon } from "./playerStartIcon";
import { createAmbientSoundIcon } from "./ambientSoundIcon";
import { loadForgeMaterial, loadForgeMaterialLayer, type ForgeMaterialLayer } from "./materialAssets";
import {
  readPivot,
  readRotation,
  readScale,
} from "@engine/scene/transform";
import type {
  LayoutActorInstance,
  LayoutAiNavigationVolume,
  LayoutAudio,
  LayoutBehavior,
  LayoutCharacter,
  LayoutCloudLayer,
  LayoutInteraction,
  LayoutLightActor,
  LayoutHeightFog,
  LayoutMovingPlatform,
  LayoutParticleEmitter,
  LayoutPlacement,
  LayoutPhysics,
  LayoutPostProcess,
  LayoutBlockingVolume,
  LayoutLandscape,
  LayoutReflectionPlane,
  LayoutReflectiveSurface,
  LayoutSkyAtmosphere,
  LayoutSphereReflectionCapture,
  LayoutSplineActor,
  LayoutTargetPoint,
  LayoutWorldSettings,
  MetadataValue,
  RoomLayout,
  Vec3,
} from "@engine/scene/layout";
import { normalizeWorldWidgets, type WorldUiWidget } from "@engine/ui/uiWorldWidget";
import { createActorBillboardIcon } from "@engine/render-three/actorIcon";
import type {
  AssetCollisionDef,
  CollisionComplexity,
  CollisionEnabled,
  CollisionObjectChannel,
  CollisionPresetId,
  CollisionResponseMap,
  NavigationRole,
} from "@engine/scene/collision";
import {
  assetCollisionDefHasCollider,
  complexAsSimpleAssetIds,
} from "@engine/scene/collision";
import { loadAssetCollision } from "@/scene/assetCollisionLoader";
import {
  applyMaterialSlotOverrides,
  assignedMaterialSlotIds,
  hasAssignedMaterialSlots,
  loadAssetMaterialSlots,
  resolveMeshMaterialSlots,
  type AssetMaterialSlotsDef,
} from "@/scene/assetMaterialSlotsLoader";
import {
  applyAssetUvwMapping,
  loadAssetUvw,
} from "@/scene/assetUvwLoader";
import { loadAssetSkeleton, skeletonClipNames } from "@/scene/assetSkeletonLoader";
import {
  lightEntity,
  roomLayoutToSceneDocument,
  type ColliderTransformSource,
} from "@engine/scene/legacyRoomLayoutAdapter";
import type { SceneDocument } from "@engine/scene/sceneDocument";
import { readRenderableMeshComponent } from "@engine/scene/components";
import type { AiPatrolRoute, TransformComponent } from "@engine/scene/components";
import type { Entity } from "@engine/scene/entity";
import { createCharacterSceneObject, entityCharacterItem } from "@engine/render-three/models";
import { actorInstanceToEntity } from "@engine/scene/actorInstance";
import { normalizeActorScriptDef, type ActorScriptDef } from "@engine/scene/actorScript";
import type { MetadataSchema } from "@engine/scene/metadataSchema";
import {
  cloneActorInstance,
  cloneAiNavigationVolume,
  cloneBlockingVolume,
  cloneCharacter,
  cloneLandscape,
  cloneLightActor,
  clonePlacement,
  cloneReflectionPlane,
  cloneReflectiveSurface,
  cloneSphereReflectionCapture,
  cloneTargetPoint,
  cloneWorldWidget,
  lightActorsEqual,
  transformsEqual,
} from "@editor/core/layoutSnapshots";
import {
  writeRotation,
  writeScale,
} from "@editor/core/layoutTransforms";
import {
  clamp,
  clampIndex,
  round,
  snapStatus,
  snapValue,
} from "@editor/core/numeric";
import { actorClassName, buildEditableSelection, buildSceneObjects } from "@editor/core/sceneObjects";
import type {
  CameraView,
  EditorTool,
  TransformSpace,
  ViewMode,
  ViewportViewState,
} from "@editor/core/tools";
import {
  worldSettingsEqual,
  type EditableSceneObject,
  type EditableSelection,
  type EditableTransform,
  type EditorProjectInfo,
  type EditorSnapSettings,
  type EditorWorldSettings,
} from "@editor/core/editableScene";
import type {
  EditorCommand,
  EditorHistoryState,
} from "@editor/core/history";
import {
  descendantSelections,
  groupedSelections,
} from "@editor/core/hierarchy";
import { uniqueEditorId } from "@editor/core/ids";
import {
  cloneSelection,
  parseSelectionId,
  selectionId,
  selectionsEqual,
  type InstanceSelection,
  type LightSelection,
  type Selection,
} from "@editor/core/selection";
import { isPlaneAxis } from "@editor/gizmos/axes";
import { type GizmoHandle } from "@editor/gizmos/handles";
import { buildGizmoHandles, clearGizmoGroup } from "@editor/gizmos/builder";
import {
  axisYMoveDragPosition,
  freeMoveDragPosition,
  localAxisMoveDragPosition,
  planeMoveDragPosition,
  rotateDragRotation,
  scaleDragScale,
  worldAxisMoveDragPosition,
} from "@editor/gizmos/transformDrag";
import {
  calculateGizmoScreenScale,
  createGizmoMovePlane,
  createGizmoPointerDrag,
  gizmoDragBaseWorld,
  GizmoInteractionStore,
  screenSpaceMoveBasis,
  type GizmoPointerDrag,
  type LinkedMoveStart,
} from "@editor/gizmos/interaction";
import { bindEditorInputEvents } from "@editor/input/bindings";
import { EditorCameraController } from "@editor/input/editorCameraController";
import { ScenePicker } from "@editor/render-three/scenePicker";
import { EditorSceneController } from "@editor/scene/EditorSceneController";
import { floorSnapPosition } from "@editor/render-three/floorSnap";
import { computeWallSnap } from "@editor/render-three/wallSnap";
import {
  matrixToTransform,
  pivotCorrectedPosition,
  transformToMatrix,
} from "@editor/render-three/transformMatrices";
import { EditorSelectionOutline } from "./editorSelectionOutline";

export type {
  EditableAiNavigationVolume,
  EditableBlockingVolume,
  EditableSceneObject,
  EditableSelection,
  EditableTargetPoint,
  EditableTransform,
  EditorProjectInfo,
  EditorSnapSettings,
  EditorWorldSettings,
} from "@editor/core/editableScene";
export type {
  EditorHistoryState,
} from "@editor/core/history";

export interface EditableTransformSnapshot {
  selection: Selection;
  transform: EditableTransform;
}

export interface TargetPointReference {
  id: string;
  name: string;
}

export interface SplineReference {
  id: string;
  name: string;
}

export type LandscapeSculptTool = "raise" | "lower" | "smooth" | "flatten";
export type LandscapeEditMode = "sculpt" | "paint" | "splines";
export type LandscapePaintTool = "paint" | "erase" | "smoothWeights";
/**
 * Splines sub-mode (Faz 6.1). "draw" authors the spline (click terrain to add a
 * connected point; click an existing marker to weld / close / branch), while
 * "edit" selects a control point so the move gizmo can drag it. Splitting the
 * two intents keeps a marker click from being ambiguous.
 */
export type LandscapeSplineTool = "draw" | "edit";

export interface LandscapeSculptSettings {
  editMode: LandscapeEditMode;
  tool: LandscapeSculptTool;
  paintTool: LandscapePaintTool;
  splineTool: LandscapeSplineTool;
  activeLayerId: string;
  viewMode: LandscapeViewMode;
  brushSize: number;
  strength: number;
  falloff: number;
  flattenTargetHeight: number;
  activeSplineId: string | null;
  activeSplinePointId: string | null;
  activeSplineSegmentId: string | null;
}

export interface LandscapeSplineView {
  id: string;
  name: string;
  pointCount: number;
  /** Whether the spline renders as a smooth Catmull-Rom curve (Faz 6.2a). */
  smooth: boolean;
}

/** Foliage Mode tool set. `select`/`lasso` drive instance selection (Faz 2). */
export type FoliageTool = "select" | "lasso" | "paint" | "erase" | "single" | "fill" | "remove";

/** Which target surfaces the foliage brush is allowed to paint onto (Faz 1 filters). */
export interface FoliageTargetFilters {
  landscape: boolean;
  staticMesh: boolean;
}

export interface FoliageToolSettings {
  tool: FoliageTool;
  /** Asset id of the active Foliage Type, or null when none is selected. */
  activeTypeId: string | null;
  brushSize: number;
  paintDensity: number;
  eraseDensity: number;
  randomSeed: number;
  filters: FoliageTargetFilters;
}

/** Vertex-color authoring state for Scene Editor's Mesh Paint Mode. */
export interface MeshPaintToolSettings {
  tool: "paint" | "erase";
  colorView: MeshPaintColorView;
  color: [number, number, number, number];
  channels: MeshPaintChannel[];
  brushSize: number;
  strength: number;
  falloff: number;
  /** Continuous paint rate while the pointer is held (0 disables it). */
  flow: number;
  ignoreBackfaces: boolean;
}

export type MeshPaintColorView = "off" | "rgb" | "alpha" | "r" | "g" | "b";

/** A Foliage Type row surfaced to the editor panel (asset id + resolved def). */
export interface FoliageTypeView {
  id: string;
  name: string;
  meshAssetId: string;
  instanceCount: number;
}

export interface LandscapeFoliageLandscapeView {
  id: string;
  name: string;
  layers: Array<{ id: string; name: string }>;
}

export interface LandscapeFoliageRuleView extends LandscapeFoliageRule {
  landscapeName: string;
  layerName: string;
  foliageTypeName: string;
}

export interface LandscapeSplinePointView {
  id: string;
  position: Vec3;
  width: number;
  falloff: number;
}

/** A generic Spline Actor control point as surfaced by the contextual Details panel. */
export interface SplinePointView {
  id: string;
  position: Vec3;
  pointType: ForgeSplinePoint["pointType"];
  tangentsLinked: boolean;
}

export interface LandscapeSplineSegmentView {
  id: string;
  startPointId: string;
  endPointId: string;
  deform: { enabled: boolean; raiseTerrain: boolean; lowerTerrain: boolean; flatten: boolean; targetOffset: number };
  paint: { enabled: boolean; layerId: string; strength: number };
  mesh: { enabled: boolean; assetId: string; spacing: number; yawOffset: number; fitToLength: boolean; alignToTerrain: boolean; bank: number; deform: boolean };
}

/** The spline control point the move gizmo targets (Faz 6.1), with its world anchor. */
interface LandscapeSplinePointGizmoTarget {
  index: number;
  landscapeId: string;
  object: LandscapeObject;
  splineId: string;
  pointId: string;
  world: Vector3;
}

/** The selected generic-spline point, with a world anchor for the shared move gizmo. */
interface SplinePointGizmoTarget {
  index: number;
  pointId: string;
  handle: "point" | "arrive" | "leave";
  actor: LayoutSplineActor;
  world: Vector3;
  worldMatrix: Matrix4;
}

type SplineTangentHandle = Exclude<SplinePointGizmoTarget["handle"], "point">;

/** Config patch for one spline segment's destructive effects (Faz 6 Road Tool). */
export interface LandscapeSplineSegmentPatch {
  deform?: Partial<{ enabled: boolean; raiseTerrain: boolean; lowerTerrain: boolean; flatten: boolean; targetOffset: number }>;
  paint?: Partial<{ enabled: boolean; layerId: string; strength: number }>;
  mesh?: Partial<{ enabled: boolean; assetId: string; spacing: number; yawOffset: number; fitToLength: boolean; alignToTerrain: boolean; bank: number; deform: boolean }>;
}

/**
 * A landscape paint layer as shown in the Details panel. The display name is
 * resolved by the panel from `material` against its asset list (so it matches
 * the picker labels); SceneApp supplies the base placeholder name and the
 * resolved swatch color.
 */
export interface LandscapeLayerView {
  id: string;
  /** Built-in placeholder name (Grass/Dirt/Rock/Snow). */
  baseName: string;
  /** Swatch/tint color — the assigned material's base color, else the preset color. */
  color: string;
  /** Assigned material asset id, or `null` for the built-in preset look. */
  material: string | null;
}

interface LandscapeSculptStroke {
  pointerId: number;
  landscapeIndex: number;
  landscapeId: string;
  mode: LandscapeEditMode;
  beforeHeights: number[];
  beforeLayers: LandscapeLayerWeights[];
  changed: boolean;
  dirty: LandscapeDirtyBounds | null;
}

function cloneLandscapeLayers(layers: readonly LandscapeLayerWeights[]): LandscapeLayerWeights[] {
  return layers.map((layer) => {
    const clone: LandscapeLayerWeights = {
      id: layer.id,
      name: layer.name,
      weights: [...layer.weights],
    };
    if (typeof layer.material === "string" && layer.material.length > 0) {
      clone.material = layer.material;
    }
    return clone;
  });
}

function cloneLandscapeSplines(splines: readonly ForgeLandscapeSpline[]): ForgeLandscapeSpline[] {
  return splines.map((spline) => ({
    ...spline,
    points: spline.points.map((point) => ({
      ...point,
      position: [...point.position] as Vec3,
      ...(point.arriveTangent ? { arriveTangent: [...point.arriveTangent] as Vec3 } : {}),
      ...(point.leaveTangent ? { leaveTangent: [...point.leaveTangent] as Vec3 } : {}),
    })),
    segments: spline.segments.map((segment) => ({
      ...segment,
      ...(segment.deform ? { deform: { ...segment.deform } } : {}),
      ...(segment.paint ? { paint: { ...segment.paint } } : {}),
      ...(segment.mesh
        ? { mesh: { ...segment.mesh, ...(segment.mesh.scale ? { scale: [...segment.mesh.scale] as Vec3 } : {}), ...(segment.mesh.offset ? { offset: [...segment.mesh.offset] as Vec3 } : {}) } }
        : {}),
    })),
  }));
}

/** Collision-free `point-<n>` id for a spline (safe after point deletions). */
function uniqueSplinePointId(spline: ForgeLandscapeSpline): string {
  const used = new Set(spline.points.map((point) => point.id));
  let number = spline.points.length + 1;
  while (used.has(`point-${number}`)) number += 1;
  return `point-${number}`;
}

/** Collision-free `segment-<n>` id for a spline (safe after segment deletions). */
function uniqueSplineSegmentId(spline: ForgeLandscapeSpline): string {
  const used = new Set(spline.segments.map((segment) => segment.id));
  let number = spline.segments.length + 1;
  while (used.has(`segment-${number}`)) number += 1;
  return `segment-${number}`;
}

function mergeLandscapeDirtyBounds(
  left: LandscapeDirtyBounds,
  right: LandscapeDirtyBounds,
): LandscapeDirtyBounds {
  return {
    x0: Math.min(left.x0, right.x0),
    x1: Math.max(left.x1, right.x1),
    z0: Math.min(left.z0, right.z0),
    z1: Math.max(left.z1, right.z1),
  };
}

/**
 * Default raw-code -> action bindings for the runtime input map. Game-specific
 * config lives in runtime code, not the engine. Observer-only: these share keys
 * with editor camera navigation (WASD) without consuming the events.
 */
const DEFAULT_INPUT_BINDINGS: ActionBindings = {
  KeyW: "move-forward",
  ArrowUp: "move-forward",
  KeyS: "move-back",
  ArrowDown: "move-back",
  KeyA: "move-left",
  ArrowLeft: "move-left",
  KeyD: "move-right",
  ArrowRight: "move-right",
  Space: "jump",
};

const AI_NAV_DEBUG_CELL_SIZE = 0.5;
const AI_NAV_DEBUG_DEFAULT_AGENT_RADIUS = AI_NAVIGATION_VOLUME_DEFAULT_AGENT_RADIUS;
const AI_NAV_DEBUG_DEFAULT_CLEARANCE_PADDING = AI_NAVIGATION_VOLUME_DEFAULT_CLEARANCE_PADDING;
const AI_NAV_DEBUG_GRID_SAFETY_MARGIN = AI_NAV_DEBUG_CELL_SIZE * 0.5;
const AI_NAV_DEBUG_MIN_TOP_SUPPORT_RADIUS = 0.15;
/** Standing height + step height of the default agent the walkable-area preview bakes for. */
const AI_NAV_DEBUG_AGENT_HEIGHT = 1.8;
const AI_NAV_DEBUG_AGENT_STEP_HEIGHT = 0.45;
const AI_NAV_DEBUG_AGENT_STEP_DOWN = 0.5;
const AI_NAV_DEBUG_AGENT_MAX_SLOPE_DEG = 50;

interface AiNavDebugProfile {
  readonly agentRadius: number;
  readonly clearancePadding: number;
  readonly clearanceRadius: number;
}

function saneAiNavPreviewNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(3)) : fallback;
}

/**
 * Oriented XZ footprint for an editor nav blocker, hulled from a collision
 * wirebox's *rotated* world corner segments. Returns `undefined` when the hull
 * fills the box's AABB (an axis-aligned collider) so that common case stays on
 * the exact, cheaper AABB nav path; a rotated collider yields its tight convex
 * ground silhouette, matching the physics blocker path.
 */
function navFootprintFromSegments(segments: readonly Vec3[], box: Box3): readonly [number, number][] | undefined {
  if (segments.length < 3) return undefined;
  const hull = convexHullXZ(segments.map((point) => [point[0], point[2]] as [number, number]));
  if (!hull || hull.length < 3) return undefined;
  const aabbArea = (box.max.x - box.min.x) * (box.max.z - box.min.z);
  if (aabbArea <= 1e-9) return undefined;
  if (polygonAreaXZ(hull) >= aabbArea - 1e-6 * aabbArea) return undefined;
  return hull;
}

function polygonAreaXZ(poly: readonly (readonly [number, number])[]): number {
  let area2 = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area2) / 2;
}

interface EditorOptions {
  enabled: boolean;
  scriptMessageTraceLimit?: number;
}

export interface LayoutSavePayload {
  layout: RoomLayout;
  editor: {
    gridSize: number;
    gridEnabled: boolean;
    snapRotationDeg: number;
    snapRotationEnabled: boolean;
    snapScale: number;
    snapScaleEnabled: boolean;
  };
}

export interface LayoutSaveResult {
  path?: string;
  /**
   * Fields the save validator did not copy through (plan I5). Empty/absent on a
   * clean save; anything listed here was silently lost before this report
   * existed, and is reported to the user instead of vanishing.
   */
  dropped?: readonly string[];
}

export type LayoutSaver = (payload: LayoutSavePayload) => Promise<LayoutSaveResult>;

const ORTHO_MIN_VIEW_HEIGHT = 3;
const ORTHO_MAX_VIEW_HEIGHT = 80;
const ORTHO_DEFAULT_VIEW_HEIGHT = 10;
const GIZMO_MIN_SCALE = 0.35;
const GIZMO_MAX_SCALE = 4;
const GIZMO_SCREEN_SIZE_PX = 118;

type WireframeCapableMaterial = Material & { wireframe: boolean };

const AI_SCRIPT_STIMULUS_MESSAGE_TYPES = [
  "Damage.Apply",
  "Damage.Died",
  "damage",
  "alert",
  "ui-action",
  "game-event",
] as const;

export class SceneApp {
  private readonly sceneShell: SceneShell;
  private readonly levelRuntime: LevelRuntime;
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  private readonly orthoCamera: OrthographicCamera;
  private activeCamera: Camera;
  private orthoViewHeight = ORTHO_DEFAULT_VIEW_HEIGHT;
  private sun: DirectionalLight | null = null;
  private ambientLight: AmbientLight | null = null;
  /** Sky Atmosphere dome (singleton); null when no sky actor is placed. */
  private skyObject: Sky | null = null;
  private cloudObject: CloudDome | null = null;
  /** Captured Sky Light environment (PMREM) backing `scene.environment`; null when none. */
  private reflectionTarget: WebGLRenderTarget | null = null;
  /** Live `Reflector` meshes for placed Planar Reflection actors, by index. */
  private reflectionPlaneObjects: ReflectionPlaneObject[] = [];
  /** Billboard icons (clickable handles) for placed Mirror Plane actors, by index. */
  private reflectionPlaneIcons: Sprite[] = [];
  /** Live textured reflective-surface meshes for placed Reflective Surface actors, by index. */
  private reflectiveSurfaceObjects: ReflectiveSurfaceObject[] = [];
  /** Editor brush objects (translucent + wireframe) for placed Blocking Volume actors, by index. */
  private blockingVolumeObjects: BlockingVolumeObject[] = [];
  /** Editor box volumes limiting AI grid navigation, by index. */
  private aiNavigationVolumeObjects: AiNavigationVolumeObject[] = [];
  /** InstancedMesh foliage batches painted onto the level (Foliage Mode). */
  private foliageBinding: FoliageRenderBinding | null = null;
  /** In-memory level foliage sidecar (`<layout>.foliage.json`). */
  private foliageData: LayoutFoliageData = createEmptyFoliageData();
  /** Placement-scoped vertex-color sidecar for Mesh Paint Mode. */
  private meshPaintData: LayoutMeshPaintData = createEmptyMeshPaintData();
  /** True when Mesh Paint sidecar changes still need the editor Save action. */
  private meshPaintDataDirty = false;
  /** Mesh Paint Mode is separate from Material Editor and owns the left pointer. */
  private meshPaintModeActive = false;
  private meshPaintBrushCursor: Mesh | null = null;
  private meshPaintStrokePointerId: number | null = null;
  private meshPaintFlowPointer: {
    clientX: number;
    clientY: number;
    pointerId: number;
    erase: boolean;
  } | null = null;
  /** In-editor, non-persistent source paint for Copy/Paste between placements. */
  private meshPaintClipboard: LayoutMeshPaintPlacement[] = [];
  /** Original materials temporarily replaced by the selected-placement Color View. */
  private readonly meshPaintColorViewOriginalMaterials = new Map<Mesh, Material | Material[]>();
  private readonly meshPaintColorViewPreviewMaterials = new Set<MeshBasicMaterial>();
  private meshPaintToolSettings: MeshPaintToolSettings = {
    tool: "paint",
    colorView: "off",
    // Mesh Paint is standardized on the R channel: paint drives R->1, erase R->0.
    color: [1, 0, 0, 1],
    channels: ["r"],
    brushSize: 1,
    strength: 0.75,
    falloff: 1,
    flow: 0,
    ignoreBackfaces: true,
  };
  /** Resolved Foliage Types referenced by the sidecar, keyed by asset id. */
  private foliageTypes = new Map<string, ForgeFoliageTypeDef>();
  /** True when the foliage sidecar has unsaved changes. */
  private foliageDataDirty = false;
  /** Terrain ids whose generated foliage batches are waiting for a debounced rebuild. */
  private readonly dirtyGeneratedFoliageLandscapes = new Set<string>();
  private generatedFoliageRebuildTimer: number | null = null;
  /** Whether Foliage Mode is the active editor mode (its brush owns pointer input). */
  private foliageModeActive = false;
  /** Ring cursor showing the foliage brush footprint on hover. */
  private foliageBrushCursor: Mesh | null = null;
  /** Pointer id of the in-progress foliage paint/erase stroke, or null. */
  private foliageStrokePointerId: number | null = null;
  /** World position of the last paint dab, for brush spacing throttle during a drag. */
  private foliagePaintLastDab: Vec3 | null = null;
  /** Selected foliage instances (Faz 2 select/lasso/invalid/reattach/remove tools). */
  private readonly foliageSelection = new FoliageSelection();
  private foliageToolSettings: FoliageToolSettings = {
    tool: "paint",
    activeTypeId: null,
    brushSize: 4,
    paintDensity: 0.5,
    eraseDensity: 1,
    randomSeed: 1,
    filters: { landscape: true, staticMesh: true },
  };
  /** Live chunked terrain meshes for placed Landscape actors, by index. */
  private landscapeObjects: LandscapeObject[] = [];
  /** Instanced spline-mesh groups (Faz 6 Road Tool) parented under each landscape, by index. */
  private landscapeSplineMeshGroups: (Group | null)[] = [];
  /** Editor-only spline control-point/segment overlay, parented under each landscape, by index. */
  private landscapeSplineOverlays: (Group | null)[] = [];
  /** In-memory sidecar height/layer data for placed Landscape actors, keyed by landscape id. */
  private landscapeData = new Map<string, ForgeLandscapeData>();
  /** Last height scale used for a heightmap import, echoed back into the Details input. */
  private lastLandscapeImportHeight = 20;
  /** Landscape ids whose sidecar has changed since the last successful save. */
  private landscapeDataDirty = new Set<string>();
  /** Resolved albedo (base color + tiling texture) of materials assigned to landscape layers, by material id. */
  private landscapeLayerMaterialCache = new Map<string, ForgeMaterialLayer>();
  private landscapeSculptSettings: LandscapeSculptSettings = {
    editMode: "sculpt",
    tool: "raise",
    paintTool: "paint",
    splineTool: "draw",
    activeLayerId: LANDSCAPE_DEFAULT_LAYERS[0]!.id,
    viewMode: "lit",
    brushSize: 6,
    strength: 0.25,
    falloff: 2,
    flattenTargetHeight: 0,
    activeSplineId: null,
    activeSplinePointId: null,
    activeSplineSegmentId: null,
  };
  private landscapeSculptStroke: LandscapeSculptStroke | null = null;
  /**
   * Active gizmo-drag of a landscape spline control point (Faz 6.1). While set,
   * the shared move-gizmo path drives `point.position` (world→local) instead of a
   * layout transform; `before` is the pre-drag spline snapshot for the undo commit.
   */
  private landscapeSplinePointDrag: {
    index: number;
    landscapeId: string;
    splineId: string;
    pointId: string;
    before: ForgeLandscapeSpline[];
    objectMatrixInverse: Matrix4;
  } | null = null;
  private landscapeBrushCursor: Mesh | null = null;
  /** Editor markers for AI patrol Target Points, by index. */
  private targetPointObjects: TargetPointObject[] = [];
  /** Editor sampled-line helpers for placed generic Spline actors, by index. */
  private splineObjects: SplineObject[] = [];
  /** Non-pickable InstancedMesh outputs owned by generic spline generators, by index. */
  private splineGeneratedGroups: (Group | null)[] = [];
  /** Coalesces high-frequency control-point drags into one generated-preview rebuild. */
  private splineGeneratorPreviewTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Segments touched during a pointer drag; merged until the coalesced preview rebuild runs. */
  private splineGeneratorDirtySegments = new Map<number, Set<number>>();
  /** Latest generated-mesh diagnostics, kept outside the persisted spline data. */
  private splineGeneratorBuildStats = new Map<number, { triangleCount: number; rebuildMs: number; preview: boolean; warnings: string[] }>();
  /** Contextual, editor-only point markers for the currently selected generic spline. */
  private splinePointOverlay: Group | null = null;
  private activeSplinePointId: string | null = null;
  private activeSplineTangent: SplineTangentHandle | null = null;
  /** Live generic-spline point drag; one snapshot becomes one undo command on release. */
  private splinePointDrag: { index: number; pointId: string; handle: SplinePointGizmoTarget["handle"]; before: LayoutSplineActor; worldMatrixInverse: Matrix4 } | null = null;
  /** Editor wireframe-sphere helpers for placed Sphere Reflection Capture actors, by index. */
  private reflectionCaptureObjects: SphereReflectionCaptureObject[] = [];
  /** Billboard icons (clickable handles) for placed Sphere Reflection Capture actors, by index. */
  private reflectionCaptureIcons: Sprite[] = [];
  /** Baked PMREM cache per Sphere Reflection Capture, by index (null = not baked / hidden). */
  private reflectionCaptureBakes: (SphereReflectionCaptureBake | null)[] = [];
  /** Billboard icons (clickable markers) for placed world-space UI widgets, by index. */
  private worldWidgetIcons: Sprite[] = [];
  private postProcessPipeline: PostProcessPipeline | null = null;
  private autoSaveTimer = 0;
  private frameHandle = 0;
  private lastTime = 0;
  /**
   * Engine-core spine. Owns the subsystem registry and per-tick fan-out. The
   * SceneApp rAF loop drives `engineApp.update()` each frame (see `start()`);
   * subsystems registered via `registerSubsystem()` attach to the same tick.
   */
  private readonly engineApp = new EngineApp();
  private assetLoader: AssetLoader | null = null;
  private activeProject: ActiveProject | null = null;
  private readonly projectReady: Promise<void>;
  /** Drives Three.js AnimationMixers through the engine-core tick. */
  private readonly animationSubsystem = new AnimationSubsystem();
  /** Raw-code -> named-action map; advanced each tick by the InputSubsystem. */
  private readonly inputActions = new ActionMap(DEFAULT_INPUT_BINDINGS);
  private readonly inputSubsystem = new InputSubsystem(this.inputActions);
  private readonly physicsSubsystem = new PhysicsSubsystem({ backend: "rapier" });
  private readonly audioSubsystem = new AudioSubsystem({ backend: "web-audio" });
  /** Browser keyboard -> action map bridge (observer only, both modes). */
  private readonly keyboardInput = new KeyboardInputSource(this.inputActions);
  /** Ticks scene behaviors against the derived entity set (assigned in ctor). */
  private readonly behaviorSubsystem: BehaviorSubsystem;
  /** Owns AIControllers in editor Play mode; gated off (`setEnabled(false)`) while editing. */
  private readonly aiSubsystem = new AISubsystem({
    taskRegistry: createGameAiTaskRegistry(),
    blockers: () => this.physicsSubsystem.staticBlockerAabbs(),
  });
  /** Unsubscribes script-message -> AI perception stimulus bridge handlers. */
  private aiStimulusUnsubs: Array<() => void> = [];
  /**
   * BehaviorSubsystem transform sink: writes a behavior-mutated entity transform
   * back onto its rendered object. This slice targets characters (each is its
   * own Object3D); instanced static meshes and lights are not synced yet. Bound
   * arrow so it can be passed as a callback.
   */
  private readonly syncEntityTransform = (entityId: string, transform: TransformComponent): void => {
    const selection = parseSelectionId(entityId);
    if (!selection || selection.kind !== "character") return;
    const object = this.characterObjects[selection.index];
    if (!object) return;
    object.position.set(transform.position[0], transform.position[1], transform.position[2]);
    applyEulerDegrees(object, transform.rotation);
    object.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
    this.physicsSubsystem.setEntityTransform(entityId, transform);
  };
  private readonly canvas: HTMLCanvasElement;
  private readonly editorEnabled: boolean;
  /** Observes the canvas panel so renderer/camera track its real size, not the window. */
  private viewportResizeObserver: ResizeObserver | null = null;
  /** Last applied viewport size, so redundant resize callbacks are skipped. */
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  /** Scratch raycaster + floor plane for the selection-aware orbit target. */
  private readonly raycaster = new Raycaster();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  /** Editor viewport camera (fly / orbit / pan / dolly). Editor-only. */
  private readonly cameraController: EditorCameraController;
  /** Editor viewport raycasting (selection / gizmo / surface picks). */
  private readonly picker: ScenePicker;

  private manifest: AssetManifest | null = null;
  private metadataSchema: MetadataSchema | null = null;
  private layout: RoomLayout | null = null;
  private models = new Map<string, GLTF>();
  private convertedUnlitMaterials = 0;
  private instanceGroups = new Map<string, Group>();
  private instanceMeshes = new Map<string, InstancedMesh[]>();
  private instanceOverrideObjects = new Map<string, Object3D[]>();
  /** Marker gizmos (Player Start / Ambient Sound) are line/sprite objects, not InstancedMesh surfaces. */
  private markerObjects = new Map<string, Object3D[]>();
  /** Per-asset materials cloned to carry a probe envMap; disposed on instance-group rebuild. */
  private instanceProbeMaterials = new Map<string, Material[]>();
  private readonly textureLoader = new TextureLoader();
  private readonly materialCache = new Map<string, Material>();
  private readonly materialLoads = new Map<string, Promise<Material>>();
  private readonly wireframeMaterialStates = new Map<WireframeCapableMaterial, boolean>();
  private characterObjects: Object3D[] = [];
  /** Render object per placed actor instance, index-aligned with `layout.actors`. */
  private actorObjects: Object3D[] = [];
  /** Resolved `*.actor.json` classes, cached by classRef across instances. */
  private readonly actorClassCache = new Map<string, ActorScriptDef>();
  /** Shared geometry/material for mesh-less actor placeholders (logic/trigger actors). */
  private readonly actorPlaceholderGeometry = new BoxGeometry(0.5, 0.5, 0.5);
  private readonly actorPlaceholderMaterial = new MeshStandardMaterial({
    color: 0x7c5cff,
    transparent: true,
    opacity: 0.65,
  });
  private lightObjects: LightObjectRecord[] = [];
  private localBounds = new Map<string, Box3>();
  /** Authored asset collision definitions (sidecars) for assets that have primitives. */
  private collisionDefs = new Map<string, AssetCollisionDef>();
  /** Render-mesh triangle data for `complexAsSimple` assets (static trimesh collider). */
  private complexCollisionMeshes = new Map<string, AssetComplexCollisionMesh>();
  private assetMaterialSlots = new Map<string, AssetMaterialSlotsDef>();
  private assetPlacements = new Map<string, EditableAsset["placement"]>();
  /** Active selection, delegating to the store so ownership lives there. */
  private get selection(): Selection | null {
    return this.editorSceneController.selection;
  }
  private set selection(value: Selection | null) {
    this.editorSceneController.selection = value;
  }
  private selectionOutline: EditorSelectionOutline | null = null;
  private readonly lightOutlineGeometry = new SphereGeometry(0.35, 16, 8);
  /** Unit sphere reused as the selection-outline proxy for capture probes (scaled by the helper's radius). */
  private readonly captureOutlineGeometry = new SphereGeometry(1, 24, 16);
  /** "Show > Collision" overlay: wireframe boxes of every collider, off by default. */
  private readonly collisionBoxes: LineSegments[] = [];
  private showCollision = false;
  /** "Show > AI Navigation" overlay: nav grid + blocking footprints, off by default. */
  private aiNavigationView: Group | null = null;
  private showAiNavigation = false;
  private readonly gizmoGroup = new Group();
  private readonly gizmoPickables: Object3D[] = [];
  /** Owns active/hovered gizmo handle state (editor-only interaction state). */
  private readonly gizmoInteraction = new GizmoInteractionStore();
  /** When on, the move gizmo drags the selection's pivot instead of the object. */
  private pivotEditMode = false;
  private activeTool: EditorTool = "move";
  private transformSpace: TransformSpace = "world";
  /** Current viewport camera preset (drives the editor Camera menu label). */
  private cameraView: CameraView = "perspective";
  /** Current viewport shading mode (drives the editor View Mode menu label). */
  private viewMode: ViewMode = "lit";
  private snapSettings = {
    move: 1,
    rotate: 15,
    scale: 0.1,
    moveEnabled: true,
    rotateEnabled: true,
    scaleEnabled: true,
  };
  /** Live drag-and-drop placement ghost (a translucent clone of the dragged
   *  asset shown in the viewport before the drop commits). */
  private dragPreview: {
    kind: "asset" | "light";
    key: string;
    group: Object3D;
    dispose: () => void;
  } | null = null;
  /** Asset/light key currently being dragged from the UI. */
  private dragPreviewAssetId: string | null = null;
  /** Last viewport client coords seen during a drag (so a lazily-loaded ghost
   *  can snap to the cursor as soon as its model finishes loading). */
  private dragPreviewClient: { x: number; y: number } | null = null;
  private pointerDrag: GizmoPointerDrag | null = null;
  private readonly editorSceneController: EditorSceneController;
  private unbindEditorInput: (() => void) | null = null;
  private layoutSaver: LayoutSaver | null = null;

  /** Called every frame with the smoothed delta; used by the debug overlay. */
  onFrame: ((deltaMs: number) => void) | null = null;
  onSelectionChanged: ((selection: EditableSelection | null) => void) | null = null;
  onSceneObjectsChanged: ((objects: EditableSceneObject[]) => void) | null = null;
  onHistoryChanged: ((state: EditorHistoryState) => void) | null = null;
  onWorldSettingsChanged: ((settings: EditorWorldSettings) => void) | null = null;
  onPivotEditModeChanged: ((enabled: boolean) => void) | null = null;
  onStatus: ((message: string, tone?: "info" | "success" | "warning" | "error") => void) | null =
    null;
  /** Reports the current camera preset + shading mode so the editor menus sync. */
  onViewStateChanged: ((state: ViewportViewState) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, options: EditorOptions = { enabled: false }) {
    this.canvas = canvas;
    this.editorEnabled = options.enabled;

    this.sceneShell = new SceneShell(canvas, {
      backgroundColor: DEFAULT_SCENE_BACKGROUND_COLOR,
    });
    this.renderer = this.sceneShell.renderer;
    this.scene = this.sceneShell.scene;
    this.camera = this.sceneShell.camera;
    this.levelRuntime = new LevelRuntime({
      mode: "editor",
      environmentRender: {
        fitSunShadow: () => this.fitSunShadowToScene(),
        applyBackgroundAndAmbient: () => this.applyBackgroundAndAmbient(),
        applySky: () => this.applySkyAtmosphere(),
        applyReflectionEnvironment: () => this.applyReflection(true),
        applyPostProcess: () => this.applyPostProcess(),
        applyFog: () => this.applyHeightFog(),
        applyClouds: () => this.applyCloudLayer(),
      },
      reflectionObjects: {
        buildReflectionCaptures: () => this.buildReflectionCaptures(),
        buildReflectionPlanes: () => this.buildReflectionPlanes(),
        buildReflectiveSurfaces: () => this.buildReflectiveSurfaces(),
      },
      worldGeometry: {
        buildBlockingVolumes: () => this.buildBlockingVolumes(),
        buildSplines: () => this.buildSplines(),
        buildLandscapes: () => this.buildLandscapes(),
        buildFoliage: () => this.buildFoliage(),
      },
      coreContent: {
        loadModels: async () => {
          const loader = this.assetLoader;
          const layout = this.layout;
          if (!loader || !layout) throw new Error("Editor level content is not ready to load models.");
          this.models = await loader.loadGroups(layout.loadGroups);
          await this.loadMissingSceneModels();
          this.convertedUnlitMaterials = convertUnlitModelMaterialsToLit(this.models);
          this.localBounds = computeModelLocalBounds(this.models);
        },
        registerShapeModels: () => this.registerShapeModelsFromLayout(),
        applyAssetUvwMappings: () => this.refreshAssetUvwMapping(undefined, { rebuild: false }),
        applyMaterialSlots: () => this.refreshAssetMaterialSlots(undefined, { rebuild: false }),
        beforeBuildSceneEntities: async () => {
          const loader = this.assetLoader;
          if (!loader) throw new Error("Editor level content is not ready to load asset placements.");
          this.assetPlacements.clear();
          for (const asset of await loader.loadEditableAssets()) {
            this.assetPlacements.set(asset.id, asset.placement);
          }
        },
        buildSceneEntities: () => {
          const layout = this.layout;
          if (!layout) throw new Error("Editor level content is not ready to build entities.");
          buildSceneEntities(layout, {
            addInstance: (assetId, placements) =>
              this.scene.add(this.createInstancedModel(assetId, placements)),
            addCharacter: (assetId, character) => this.addCharacter(this.models.get(assetId), character),
            addLight: (light) => this.addLight(light),
          });
        },
        buildActorInstances: () => this.loadActorInstances(),
      },
    });
    this.orthoCamera = new OrthographicCamera(-5, 5, 5, -5, this.camera.near, this.camera.far);
    this.activeCamera = this.camera;
    this.syncOrthoCameraFromPerspective();
    this.editorSceneController = new EditorSceneController({
      applyCastShadow: (selection) => this.applyCastShadow(selection),
      applyGroupId: (selection, groupId, options) =>
        this.applyGroupId(selection, groupId, options),
      applyMaterialSlot: (selection) => this.applyMaterialSlot(selection),
      applyVisibility: (selection) => this.applyVisibility(selection),
      descendantsOf: (selection) => this.descendantsOf(selection),
      emitHistoryChanged: () => this.emitHistoryChanged(),
      emitSelectionChanged: () => this.emitSelectionChanged(),
      getAllSelections: (options) => this.getAllSelections(options),
      getGroupedSelections: (selection) => this.getGroupedSelections(selection),
      getMutableLayout: () => this.layout,
      getMutableTransform: (selection) => this.getMutableTransform(selection),
      getSelectionLabel: (selection) => this.getSelectionLabel(selection),
      hasSelection: (selection) => this.hasSelection(selection),
      createLightId: (type) => this.createLightId(type),
      insertActorPlacement: (index, actor) => this.insertActorPlacement(index, actor),
      removeActorPlacement: (index) => this.removeActorPlacement(index),
      insertCharacterPlacement: (index, placement) => this.insertCharacterPlacement(index, placement),
      insertInstancePlacement: (assetId, placementIndex, placement) =>
        this.insertInstancePlacement(assetId, placementIndex, placement),
      insertLightActor: (index, actor) => this.insertLightActor(index, actor),
      onStatus: (message, tone) => this.onStatus?.(message, tone),
      removeCharacterPlacement: (index) => this.removeCharacterPlacement(index),
      removeInstancePlacement: (assetId, placementIndex) =>
        this.removeInstancePlacement(assetId, placementIndex),
      removeLightActor: (index) => this.removeLightActor(index),
      updateGizmo: () => this.updateGizmo(),
      updateSelectionBox: () => this.updateSelectionBox(),
    });
    this.cameraController = new EditorCameraController({
      camera: () => this.editorViewportCamera(),
      canvas: this.canvas,
      getOrbitTarget: () => this.getCameraOrbitTarget(),
      onInteractionStart: () => {
        this.pointerDrag = null;
        this.endAssetDragPreview();
      },
      onStatus: (message, tone) => this.onStatus?.(message, tone),
    });
    this.picker = new ScenePicker({
      camera: () => this.editorViewportCamera(),
      canvas: this.canvas,
      pickables: () => {
        const objects: Object3D[] = [];
        for (const meshes of this.instanceMeshes.values()) objects.push(...meshes);
        for (const objectsForAsset of this.instanceOverrideObjects.values()) {
          objects.push(...objectsForAsset);
        }
        for (const objectsForAsset of this.markerObjects.values()) {
          objects.push(...objectsForAsset);
        }
        objects.push(...this.characterObjects);
        objects.push(...this.actorObjects);
        for (const record of this.lightObjects) objects.push(record.root);
        objects.push(...this.reflectionPlaneObjects);
        objects.push(...this.reflectionPlaneIcons);
        objects.push(...this.reflectiveSurfaceObjects);
        objects.push(...this.blockingVolumeObjects);
        // The influence sphere never picks — it only previews the radius while the
        // probe is selected. The probe is selected through its billboard icon.
        objects.push(...this.reflectionCaptureIcons);
        objects.push(...this.worldWidgetIcons);
        objects.push(...this.aiNavigationVolumeObjects);
        objects.push(...this.targetPointObjects);
        objects.push(...this.splineObjects);
        objects.push(...this.landscapeObjects);
        return objects;
      },
      surfacePickables: () => {
        const objects: Object3D[] = [];
        for (const meshes of this.instanceMeshes.values()) objects.push(...meshes);
        for (const objectsForAsset of this.instanceOverrideObjects.values()) {
          objects.push(...objectsForAsset);
        }
        objects.push(...this.characterObjects);
        objects.push(...this.actorObjects);
        objects.push(...this.landscapeObjects);
        return objects;
      },
      gizmo: () => ({ visible: this.gizmoGroup.visible, pickables: this.gizmoPickables }),
      // Locked objects are click-through in the viewport: picking skips them and
      // falls through to whatever is behind, so a locked object can only be
      // re-selected by unlocking it in the Scene Outliner.
      isSelectionLocked: (selection) => this.isSelectionLocked(selection),
    });

    if (this.editorEnabled) {
      const { width, height } = this.viewportSize();
      this.postProcessPipeline = new PostProcessPipeline({
        renderer: this.renderer,
        scene: this.scene,
        camera: this.editorViewportCamera(),
        width,
        height,
      });
      this.selectionOutline = new EditorSelectionOutline({
        scene: this.scene,
        camera: this.editorViewportCamera(),
        pipeline: this.postProcessPipeline,
        width,
        height,
      });
    }

    this.gizmoGroup.name = "editor-transform-gizmo";
    this.gizmoGroup.visible = false;
    this.scene.add(this.gizmoGroup);

    // Register subsystems before scene load adds work to them (e.g. character
    // animations push mixers during loadActiveProjectScene) and before the
    // engine init()/start() that load triggers. Input advances before any later
    // behavior subsystem so behaviors read current-tick action state.
    this.engineApp.registerSubsystem(this.animationSubsystem);
    this.engineApp.registerSubsystem(this.inputSubsystem);
    this.engineApp.registerSubsystem(this.physicsSubsystem);
    this.engineApp.registerSubsystem(this.aiSubsystem);
    // Registered after input so behaviors read current-tick action state.
    this.behaviorSubsystem = new BehaviorSubsystem(
      createBehaviorRegistry(),
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
      this.audioSubsystem,
      {
        messageTraceLimit: options.scriptMessageTraceLimit ?? 0,
        onMessageWarnings: (warnings) => {
          this.onStatus?.(`Script message warning: ${warnings[0]?.message ?? "unknown"}`, "warning");
        },
      },
    );
    this.aiSubsystem.configure({
      emitMessage: (message) =>
        this.behaviorSubsystem.emitScriptMessage(
          message.type,
          message.source,
          message.payload,
          message.target,
        ),
    });
    this.engineApp.registerSubsystem(this.behaviorSubsystem);
    this.engineApp.registerSubsystem(this.audioSubsystem);

    // The editor viewport is an authoring surface, not Play mode: keep gameplay
    // behaviors and dynamic rigid bodies from mutating placed objects while editing.
    if (this.editorEnabled) {
      this.behaviorSubsystem.setEnabled(false);
      this.physicsSubsystem.setEnabled(false);
      this.aiSubsystem.setEnabled(false);
    }

    // Observer-only keyboard source: records raw codes into the action map in
    // both modes without consuming events, so editor shortcuts/camera nav are
    // untouched.
    this.keyboardInput.attach();

    this.projectReady = this.loadActiveProjectScene();

    if (this.editorEnabled) this.bindEditorInput();

    this.handleResize();
    window.addEventListener("resize", this.handleResize);
    // The canvas is a panel-bounded work surface in the editor: its box changes
    // when the outliner/details/content-drawer resize, not only on window resize.
    // Observing the canvas itself catches both, keeping the renderer/camera in
    // lockstep with the actual drawing area.
    if (typeof ResizeObserver !== "undefined") {
      this.viewportResizeObserver = new ResizeObserver(() => this.handleResize());
      this.viewportResizeObserver.observe(this.canvas);
    }
  }

  start(): void {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      const deltaMs = Math.min(now - this.lastTime, 100);
      this.lastTime = now;
      const deltaSeconds = deltaMs / 1000;

      // Engine-core tick: fans out to registered subsystems. The
      // AnimationSubsystem advances character mixers here â€” that work no longer
      // runs inline in this loop. Camera/gizmo work stays inline for now.
      this.engineApp.update(deltaSeconds);

      this.cameraController.update(deltaSeconds);
      this.updateMeshPaintFlow(deltaSeconds);
      this.updateGizmoScreenScale();
      if (this.skyObject) followCameraWithSky(this.skyObject, this.camera);
      if (this.cloudObject) {
        followCameraWithClouds(this.cloudObject, this.camera);
        advanceCloudTime(this.cloudObject, deltaSeconds);
      }
      this.foliageBinding?.updateCulling(this.editorViewportCamera().position);

      if (this.postProcessPipeline) this.postProcessPipeline.render(deltaSeconds);
      else this.renderer.render(this.scene, this.editorViewportCamera());
      this.onFrame?.(deltaMs);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  /**
   * Registers a subsystem on the engine-core spine so it ticks with the rAF
   * loop. Thin pass-through to {@link EngineApp.registerSubsystem}; returns the
   * subsystem for convenient capture at the call site.
   */
  registerSubsystem(subsystem: Subsystem): Subsystem {
    return this.engineApp.registerSubsystem(subsystem);
  }

  setLayoutSaver(saver: LayoutSaver): void {
    this.layoutSaver = saver;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.handleResize);
    this.viewportResizeObserver?.disconnect();
    this.viewportResizeObserver = null;
    this.unbindEditorInput?.();
    this.unbindEditorInput = null;
    this.clearAiScriptStimulusBridge();
    this.keyboardInput.detach();
    this.selectionOutline?.dispose();
    this.selectionOutline = null;
    this.removeAiNavigationView();
    for (const object of this.aiNavigationVolumeObjects) {
      this.scene.remove(object);
      disposeAiNavigationVolumeObject(object);
    }
    this.aiNavigationVolumeObjects = [];
    for (const object of this.targetPointObjects) {
      this.scene.remove(object);
      disposeTargetPointObject(object);
    }
    this.targetPointObjects = [];
    for (const object of this.splineObjects) {
      this.scene.remove(object);
      disposeSplineObject(object);
    }
    this.splineObjects = [];
    this.clearSplineGeneratedGroups();
    this.clearSplineGeneratorPreviewTimers();
    this.clearSplinePointOverlay();
    this.postProcessPipeline?.dispose();
    this.postProcessPipeline = null;
    this.disposeReflectionCaptureBakes();
    this.disposeInstanceProbeMaterials();
    this.clearMeshPaintColorView();
    if (this.meshPaintBrushCursor) {
      this.scene.remove(this.meshPaintBrushCursor);
      this.meshPaintBrushCursor.geometry.dispose();
      const material = this.meshPaintBrushCursor.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
      this.meshPaintBrushCursor = null;
    }
    if (this.landscapeBrushCursor) {
      this.scene.remove(this.landscapeBrushCursor);
      this.landscapeBrushCursor.geometry.dispose();
      const material = this.landscapeBrushCursor.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
      this.landscapeBrushCursor = null;
    }
    for (const layer of this.landscapeLayerMaterialCache.values()) layer.texture?.dispose();
    this.landscapeLayerMaterialCache.clear();
    this.lightOutlineGeometry.dispose();
    this.captureOutlineGeometry.dispose();
    // EngineApp.dispose() is async (subsystems may release async resources);
    // SceneApp.dispose() is sync, so fire-and-forget like the renderer teardown.
    void this.engineApp.dispose();
    this.sceneShell.dispose();
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return readSceneRuntimeStats(this.renderer);
  }

  getScriptMessageDebugSnapshot(): ScriptMessageDebugSnapshot {
    return this.behaviorSubsystem.getScriptMessageDebugSnapshot();
  }

  /** Snapshots the AI subsystem for `?debug` (editor Play mode); off while editing. */
  getAiDebugSnapshot(): AiDebugSnapshot {
    return this.aiSubsystem.getDebugSnapshot();
  }

  async getManifest(): Promise<AssetManifest> {
    await this.projectReady;
    if (!this.assetLoader) throw new Error("Project is not loaded yet.");
    this.manifest ??= await this.assetLoader.loadManifest();
    return this.manifest;
  }

  async getEditableAssets(): Promise<EditableAsset[]> {
    await this.projectReady;
    if (!this.assetLoader) throw new Error("Project is not loaded yet.");
    return this.assetLoader.loadEditableAssets();
  }

  /**
   * Drops the cached asset manifest and re-reads the editable asset list. Used
   * after the editor mutates the manifest on disk (e.g. importing a new asset).
   */
  async reloadEditableAssets(): Promise<EditableAsset[]> {
    await this.projectReady;
    if (!this.assetLoader) throw new Error("Project is not loaded yet.");
    this.assetLoader.invalidateManifest();
    // Re-prime the cached manifest so direct lookups (drag-to-place, materials)
    // stay consistent with the freshly reloaded editable list.
    this.manifest = await this.assetLoader.loadManifest();
    return this.assetLoader.loadEditableAssets();
  }

  async getEditorProjectInfo(): Promise<EditorProjectInfo> {
    await this.projectReady;
    if (!this.activeProject) throw new Error("Project is not loaded yet.");
    return {
      manifest: this.activeProject.manifest,
      rootName: this.activeProject.rootName,
      assetRoot: dirnameProjectPath(this.activeProject.manifest.editor.assetManifest),
    };
  }

  getLayout(): RoomLayout {
    if (!this.layout) throw new Error("Layout is not loaded yet.");
    return structuredClone(this.layout);
  }

  /**
   * Derives the engine `SceneDocument` from the currently loaded layout via the
   * legacy adapter. Inspection-only: this does NOT drive rendering yet. The
   * runtime and editor still render from the existing `RoomLayout` path, so the
   * derived spine can be observed without changing visible behavior.
   */
  getSceneDocument(): SceneDocument {
    if (!this.layout) throw new Error("Layout is not loaded yet.");
    return roomLayoutToSceneDocument(this.layout, {
      colliderBox: (assetId, source) => this.colliderBoxFor(assetId, source),
      collisionDefs: this.collisionDefs,
      complexCollisionMeshes: this.complexCollisionMeshes,
    });
  }

  /**
   * World-aligned collider footprint for a placed asset, from its loaded model
   * bounds, so derived colliders match the rendered mesh instead of a unit cube.
   * Returns undefined when the model's bounds are not loaded (adapter falls back
   * to a scaled unit box).
   */
  private colliderBoxFor(assetId: string, source: ColliderTransformSource) {
    const bounds = this.localBounds.get(assetId);
    return bounds ? colliderBoxFromBounds(bounds, source) : undefined;
  }

  getSceneObjects(): EditableSceneObject[] {
    if (!this.layout) return [];
    return buildSceneObjects(this.layout, {
      assetCategory: (assetId) => this.assetCategory(assetId),
      isSelected: (selection) => this.isSelectionSelected(selection),
      staticObjectsCastShadow: this.staticObjectsCastShadow(),
    });
  }

  selectSceneObject(id: string, options: { additive?: boolean } = {}): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (options.additive) this.toggleSelection(selection);
    else this.select(selection);
  }

  clearSelection(): void {
    this.select(null);
  }

  selectAllObjects(): void {
    const selections = this.getAllSelections({ includeHidden: false });
    if (selections.length === 0) {
      this.onStatus?.("No visible objects to select.", "warning");
      return;
    }
    const active =
      this.selection && selections.some((selection) => selectionsEqual(selection, this.selection))
        ? cloneSelection(this.selection)
        : cloneSelection(selections[0]!);
    this.selectMany(selections, active);
    this.onStatus?.(`Selected ${selections.length} objects.`, "info");
  }

  renameSceneObject(id: string, name: string): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (selection.kind === "sky") {
      const next = name.trim();
      this.setSkyAtmosphere({ name: next.length > 0 ? next : undefined }, "Rename Sky Atmosphere");
      return;
    }
    if (selection.kind === "fog") {
      const next = name.trim();
      this.setHeightFog(
        { name: next.length > 0 ? next : undefined },
        "Rename Exponential Height Fog",
      );
      return;
    }
    if (selection.kind === "cloud") {
      const next = name.trim();
      this.setCloudLayer({ name: next.length > 0 ? next : undefined }, "Rename Cloud Layer");
      return;
    }
    if (selection.kind === "post") {
      const next = name.trim();
      this.setPostProcess({ name: next.length > 0 ? next : undefined }, "Rename Post Process");
      return;
    }
    this.renameSelection(selection, name);
  }

  setSceneObjectHidden(id: string, hidden: boolean): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (selection.kind === "sky") {
      this.setSkyAtmosphere({ hidden }, hidden ? "Hide Sky Atmosphere" : "Show Sky Atmosphere");
      return;
    }
    if (selection.kind === "fog") {
      this.setHeightFog(
        { hidden },
        hidden ? "Hide Exponential Height Fog" : "Show Exponential Height Fog",
      );
      return;
    }
    if (selection.kind === "cloud") {
      this.setCloudLayer({ hidden }, hidden ? "Hide Cloud Layer" : "Show Cloud Layer");
      return;
    }
    if (selection.kind === "post") {
      this.setPostProcess({ hidden }, hidden ? "Hide Post Process" : "Show Post Process");
      return;
    }
    if (this.editorSceneController.selectedCount > 1 && this.isSelectionSelected(selection)) {
      this.setSelectedHidden(hidden);
      return;
    }
    this.editorSceneController.setSelectionFlag(selection, "hidden", hidden);
  }

  setSceneObjectLocked(id: string, locked: boolean): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (this.editorSceneController.selectedCount > 1 && this.isSelectionSelected(selection)) {
      this.setSelectedLocked(locked);
      return;
    }
    this.editorSceneController.setSelectionFlag(selection, "locked", locked);
  }

  getHistoryState(): EditorHistoryState {
    return this.editorSceneController.getHistoryState();
  }

  undo(): void {
    this.editorSceneController.undo();
  }

  redo(): void {
    this.editorSceneController.redo();
  }

  setEditorTool(tool: EditorTool): void {
    this.activeTool = tool;
    this.endAssetDragPreview();
    // Switching transform tool leaves pivot-edit mode so tools behave normally.
    if (this.pivotEditMode) this.setPivotEditMode(false);
    this.updateGizmo();
    this.onStatus?.(`Tool: ${tool}`);
  }

  getLandscapeSculptSettings(): LandscapeSculptSettings {
    return { ...this.landscapeSculptSettings };
  }

  setLandscapeSculptSettings(patch: Partial<LandscapeSculptSettings>): LandscapeSculptSettings {
    const previousViewMode = this.landscapeSculptSettings.viewMode;
    const previousLayerId = this.landscapeSculptSettings.activeLayerId;
    const previousEditMode = this.landscapeSculptSettings.editMode;
    const previousSplineTool = this.landscapeSculptSettings.splineTool;
    const next = { ...this.landscapeSculptSettings, ...patch };
    const layerIds = new Set<string>(LANDSCAPE_DEFAULT_LAYERS.map((layer) => layer.id));
    this.landscapeSculptSettings = {
      editMode: ["sculpt", "paint", "splines"].includes(next.editMode) ? next.editMode : "sculpt",
      tool: ["raise", "lower", "smooth", "flatten"].includes(next.tool) ? next.tool : "raise",
      paintTool: ["paint", "erase", "smoothWeights"].includes(next.paintTool)
        ? next.paintTool
        : "paint",
      splineTool: next.splineTool === "edit" ? "edit" : "draw",
      activeLayerId: layerIds.has(next.activeLayerId)
        ? next.activeLayerId
        : LANDSCAPE_DEFAULT_LAYERS[0]!.id,
      viewMode: ["lit", "height", "slope", "layer"].includes(next.viewMode)
        ? next.viewMode
        : "lit",
      brushSize: clamp(next.brushSize, 0.5, 50),
      strength: clamp(next.strength, 0.01, 2),
      falloff: clamp(next.falloff, 0.25, 8),
      flattenTargetHeight: clamp(next.flattenTargetHeight, -1000, 1000),
      activeSplineId: typeof next.activeSplineId === "string" && next.activeSplineId.length > 0 ? next.activeSplineId : null,
      activeSplinePointId: typeof next.activeSplinePointId === "string" && next.activeSplinePointId.length > 0 ? next.activeSplinePointId : null,
      activeSplineSegmentId: typeof next.activeSplineSegmentId === "string" && next.activeSplineSegmentId.length > 0 ? next.activeSplineSegmentId : null,
    };
    this.updateLandscapeBrushCursorScale();
    if (previousViewMode !== this.landscapeSculptSettings.viewMode) {
      // Switching to/from "lit" can flip between the splat and vertex-color
      // material, so rebuild the whole object rather than just its geometry.
      this.landscapeObjects.forEach((_object, index) => this.rebuildLandscapeObject(index));
    } else if (previousLayerId !== this.landscapeSculptSettings.activeLayerId) {
      this.refreshAllLandscapeGeometry();
    }
    const mode = this.landscapeSculptSettings.editMode === "splines"
      ? "Splines"
      : this.landscapeSculptSettings.editMode === "paint"
        ? this.landscapeSculptSettings.paintTool
        : this.landscapeSculptSettings.tool;
    this.onStatus?.(`Landscape ${mode}`, "info");
    this.refreshAllLandscapeSplineOverlays();
    if (
      previousEditMode !== this.landscapeSculptSettings.editMode ||
      previousSplineTool !== this.landscapeSculptSettings.splineTool
    ) {
      // The spline move gizmo only exists in splines + "edit" sub-mode, so refresh
      // it when either changes — otherwise a stale gizmo lingers after switching.
      this.updateGizmo();
    }
    return this.getLandscapeSculptSettings();
  }

  getTransformSpace(): TransformSpace {
    return this.transformSpace;
  }

  toggleTransformSpace(): TransformSpace {
    this.transformSpace = this.transformSpace === "world" ? "local" : "world";
    this.updateGizmo();
    this.onStatus?.(`Transform space: ${this.transformSpace}`, "info");
    return this.transformSpace;
  }

  isCameraNavigating(): boolean {
    return this.cameraController.isInteracting;
  }

  private editorViewportCamera(): PerspectiveCamera | OrthographicCamera {
    return this.activeCamera instanceof OrthographicCamera ? this.orthoCamera : this.camera;
  }

  private syncOrthoCameraFromPerspective(): void {
    this.orthoCamera.position.copy(this.camera.position);
    this.orthoCamera.quaternion.copy(this.camera.quaternion);
    this.orthoCamera.up.copy(this.camera.up);
    this.orthoCamera.near = this.camera.near;
    this.orthoCamera.far = this.camera.far;
    this.updateOrthoProjection();
  }

  private setActiveCamera(camera: Camera): void {
    if (this.activeCamera === camera) return;
    this.activeCamera = camera;
    this.postProcessPipeline?.setCamera(camera);
    this.selectionOutline?.setCamera(camera);
    this.applyPostProcess();
    this.updateGizmoScreenScale();
  }

  private updateOrthoProjection(): void {
    const width = this.renderer?.domElement.clientWidth || window.innerWidth || 1;
    const height = this.renderer?.domElement.clientHeight || window.innerHeight || 1;
    const aspect = width / Math.max(height, 1);
    const halfHeight = this.orthoViewHeight * 0.5;
    const halfWidth = halfHeight * aspect;
    this.orthoCamera.left = -halfWidth;
    this.orthoCamera.right = halfWidth;
    this.orthoCamera.top = halfHeight;
    this.orthoCamera.bottom = -halfHeight;
    this.orthoCamera.updateProjectionMatrix();
  }

  setSnapSettings(values: Partial<typeof this.snapSettings>): void {
    this.snapSettings = { ...this.snapSettings, ...values };
    this.onStatus?.(
      `Snap move ${snapStatus(this.snapSettings.moveEnabled, this.snapSettings.move)}, rotate ${snapStatus(this.snapSettings.rotateEnabled, this.snapSettings.rotate)}, scale ${snapStatus(this.snapSettings.scaleEnabled, this.snapSettings.scale)}`,
    );
  }

  getSnapSettings(): EditorSnapSettings {
    return { ...this.snapSettings };
  }

  getWorldSettings(): EditorWorldSettings {
    return {
      lightingMode: "Dynamic",
      shadowFilter: "PCF Soft",
      staticObjectsCastShadow: this.staticObjectsCastShadow(),
      staticObjectsReceiveShadow: this.staticObjectsReceiveShadow(),
      backgroundColor: this.backgroundColor(),
      ambientColor: this.ambientColor(),
      ambientIntensity: this.ambientIntensity(),
      killZ: this.killZ(),
      gameMode: this.gameMode(),
    };
  }

  setWorldSettings(
    values: Partial<
      Pick<
        EditorWorldSettings,
        | "staticObjectsCastShadow"
        | "staticObjectsReceiveShadow"
        | "backgroundColor"
        | "ambientColor"
        | "ambientIntensity"
        | "killZ"
        | "gameMode"
      >
    >,
  ): void {
    if (!this.layout) return;
    const previous = this.getWorldSettings();
    const next: EditorWorldSettings = { ...previous, ...values };
    if (worldSettingsEqual(previous, next)) return;

    this.executeCommand({
      label: "Update world settings",
      redo: () => this.applyWorldSettings(next),
      undo: () => this.applyWorldSettings(previous),
    });
  }

  setSelectedLightSettings(values: Partial<LayoutLightActor>): void {
    if (!this.layout || !this.selection || this.selection.kind !== "light") return;
    const light = this.layout.lights?.[this.selection.index];
    if (!light) return;
    const previous = cloneLightActor(light);
    const next = { ...previous, ...values };
    if (lightActorsEqual(previous, next)) return;
    const selection = cloneSelection(this.selection) as LightSelection;

    this.executeCommand({
      label: "Update light",
      redo: () => this.applyLightActor(selection, next),
      undo: () => this.applyLightActor(selection, previous),
    });
  }

  focusSelected(): void {
    const selected = this.getSelected();
    if (!selected || !this.selection) {
      this.onStatus?.("No selected object to focus.", "warning");
      return;
    }

    const box = this.getSelectionWorldBox(this.selection);
    const target = box && !box.isEmpty()
      ? box.getCenter(new Vector3())
      : new Vector3(selected.position[0], selected.position[1] + 0.65, selected.position[2]);

    const viewDirection = new Vector3();
    const camera = this.editorViewportCamera();
    camera.getWorldDirection(viewDirection);
    if (viewDirection.lengthSq() === 0) {
      viewDirection.copy(SCENE_CAMERA_TARGET).sub(camera.position).normalize();
    }

    const radius = box && !box.isEmpty() ? box.getSize(new Vector3()).length() * 0.5 : 0.8;
    const distance = clamp(radius * 1.8, 1.25, 4.2);
    if (camera instanceof OrthographicCamera) {
      this.orthoViewHeight = clamp(radius * 4, ORTHO_MIN_VIEW_HEIGHT, ORTHO_MAX_VIEW_HEIGHT);
      this.updateOrthoProjection();
    }
    camera.position.copy(target).addScaledVector(viewDirection, -distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    this.cameraController.markViewChanged();
    this.cameraController.syncAnglesFromCurrentView();
    this.onStatus?.(`Focused ${selected.label}.`, "info");
  }

  /**
   * Current viewport camera pose, for the Play button to hand off to the runtime
   * so the default camera mode starts where the editor was looking. Editor-only
   * handoff â€” never written into the layout.
   */
  getPlayCameraPose(): PlayCameraPose {
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      quaternion: [
        this.camera.quaternion.x,
        this.camera.quaternion.y,
        this.camera.quaternion.z,
        this.camera.quaternion.w,
      ],
    };
  }

  setTechnicalView(view: "top" | "front" | "side"): void {
    const target = this.getCameraOrbitTarget();
    const currentCamera = this.editorViewportCamera();
    const distance = clamp(currentCamera.position.distanceTo(target), 3, 10);
    this.cameraController.markViewChanged();
    this.orthoViewHeight = clamp(distance * 1.8, ORTHO_MIN_VIEW_HEIGHT, ORTHO_MAX_VIEW_HEIGHT);
    this.orthoCamera.zoom = 1;
    this.updateOrthoProjection();

    if (view === "top") {
      this.orthoCamera.up.set(0, 0, -1);
      this.orthoCamera.position.copy(target).add(new Vector3(0, distance, 0));
    } else if (view === "front") {
      this.orthoCamera.up.set(0, 1, 0);
      this.orthoCamera.position.copy(target).add(new Vector3(0, 0, distance));
    } else {
      this.orthoCamera.up.set(0, 1, 0);
      this.orthoCamera.position.copy(target).add(new Vector3(distance, 0, 0));
    }

    this.orthoCamera.lookAt(target);
    this.setActiveCamera(this.orthoCamera);
    this.cameraController.syncAnglesFromCurrentView();
    this.onStatus?.(`${view[0]!.toUpperCase()}${view.slice(1)} view`, "info");
  }

  /** Restores an angled 3/4 perspective orbit around the current focus point. */
  private applyPerspectivePose(): void {
    const target = this.getCameraOrbitTarget();
    const distance = clamp(this.editorViewportCamera().position.distanceTo(target), 4, 12);
    this.cameraController.markViewChanged();
    this.camera.up.set(0, 1, 0);
    this.camera.position
      .copy(target)
      .add(new Vector3(distance * 0.7, distance * 0.6, distance * 0.7));
    this.camera.lookAt(target);
    this.setActiveCamera(this.camera);
    this.cameraController.syncAnglesFromCurrentView();
  }

  /**
   * Editor Camera menu entry point. Positions the viewport camera for the chosen
   * preset and, per the UE-style contract, couples shading to it: the technical
   * (Top/Left/Front) presets read as Wireframe while Perspective returns to Lit.
   *
   * NOTE: the technical presets currently reposition the perspective camera; the
   * true orthographic projection swap + wireframe rendering land in a later step.
   * The camera/shading *state* is authoritative here so the editor menus and that
   * later rendering pass share one source of truth.
   */
  setCameraView(view: CameraView): void {
    if (view === "perspective") {
      this.applyPerspectivePose();
      this.onStatus?.("Perspective view", "info");
    } else {
      this.setTechnicalView(view === "left" ? "side" : view);
    }
    this.cameraView = view;
    this.applyViewMode(view === "perspective" ? "lit" : "wireframe", false);
    this.notifyViewState();
  }

  /** Editor View Mode menu entry point (Lit / Wireframe). */
  setViewMode(mode: ViewMode): void {
    this.applyViewMode(mode, true);
    this.notifyViewState();
  }

  private applyViewMode(mode: ViewMode, announce: boolean): void {
    this.viewMode = mode;
    this.applyWireframeViewMode(mode === "wireframe");
    if (announce) this.onStatus?.(`${mode === "lit" ? "Lit" : "Wireframe"} view mode`, "info");
  }

  private applyWireframeViewMode(enabled: boolean): void {
    if (!enabled) {
      for (const [material, wireframe] of this.wireframeMaterialStates) {
        material.wireframe = wireframe;
        material.needsUpdate = true;
      }
      this.wireframeMaterialStates.clear();
      return;
    }

    for (const root of this.levelWireframeRoots()) this.applyWireframeToLevelObject(root);
  }

  private applyWireframeToLevelObject(root: Object3D): void {
    if (this.viewMode !== "wireframe") return;
    root.traverse((object) => {
      if (!isRenderableMesh(object)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) this.setMaterialWireframe(material, true);
    });
  }

  private setMaterialWireframe(material: Material, wireframe: boolean): void {
    if (!isWireframeCapableMaterial(material)) return;
    if (!this.wireframeMaterialStates.has(material)) {
      this.wireframeMaterialStates.set(material, material.wireframe);
    }
    material.wireframe = wireframe;
    material.needsUpdate = true;
  }

  private levelWireframeRoots(): Object3D[] {
    const roots: Object3D[] = [];
    for (const meshes of this.instanceMeshes.values()) roots.push(...meshes);
    for (const objects of this.instanceOverrideObjects.values()) roots.push(...objects);
    roots.push(...this.characterObjects);
    roots.push(...this.actorObjects);
    return roots;
  }

  getViewState(): ViewportViewState {
    return { view: this.cameraView, mode: this.viewMode };
  }

  private notifyViewState(): void {
    this.onViewStateChanged?.(this.getViewState());
  }

  surfaceSnapSelected(): void {
    if (!this.selection) {
      this.onStatus?.("No selected object to snap.", "warning");
      return;
    }
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    const before = this.captureTransform(this.selection);
    const box = this.getSelectionWorldBox(this.selection);
    if (!before || !box || box.isEmpty()) {
      this.onStatus?.("Cannot compute bounds for surface snap.", "warning");
      return;
    }

    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    // Start a hair above the bottom so a surface flush with it still registers.
    const origin = new Vector3(centerX, box.min.y + 0.02, centerZ);
    const surfaceY = this.picker.raycastSurfaceBelow(origin, this.selection);
    // Fall back to the floor plane (y = 0) when nothing solid is underneath.
    const restY = surfaceY ?? 0;
    const deltaY = restY - box.min.y;
    if (Math.abs(deltaY) < 1e-3) {
      this.onStatus?.("Already resting on a surface.", "info");
      return;
    }

    this.updateSelectedTransform({
      position: [
        before.position[0],
        round(before.position[1] + deltaY),
        before.position[2],
      ],
    });
    this.commitTransformChange(
      this.selection,
      before,
      surfaceY === null ? "Surface snap (floor)" : "Surface snap",
    );
  }

  snapSelectedToFloor(): void {
    if (!this.selection) {
      this.onStatus?.("No selected object to snap.", "warning");
      return;
    }
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    const before = this.captureTransform(this.selection);
    const box = this.getSelectionWorldBox(this.selection);
    if (!before || !box || box.isEmpty()) {
      this.onStatus?.("Cannot compute bounds for floor snap.", "warning");
      return;
    }

    const position = floorSnapPosition(box, before.position);
    if (!position) {
      this.onStatus?.("Already resting on the floor.", "info");
      return;
    }

    this.updateSelectedTransform({ position });
    this.commitTransformChange(this.selection, before, "Snap to floor");
  }

  /** End entry: drops the active selection onto the floor plane. */
  snapSelected(): void {
    this.snapSelectedToFloor();
  }

  isSelectionWallAsset(): boolean {
    return Boolean(
      this.selection &&
        this.selection.kind === "instance" &&
        this.isWallAsset(this.selection.assetId),
    );
  }

  /**
   * Details "Snap to Wall": forces a wall snap on the active instance regardless
   * of its catalog surface type. Characters and empty selections are no-ops.
   */
  snapSelectedToWall(): void {
    if (!this.selection || this.selection.kind !== "instance") {
      this.onStatus?.("Select a model to snap to a wall.", "warning");
      return;
    }
    this.performWallSnap(this.selection);
  }

  /** Slides and orients an instance flush against the nearest room wall. */
  private performWallSnap(selection: InstanceSelection): void {
    if (this.isSelectionLocked(selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    const before = this.captureTransform(selection);
    if (!before) return;
    const bounds = this.localBounds.get(selection.assetId);
    const room = this.getRoomBounds();
    if (!bounds || !room) {
      this.onStatus?.("No room walls found to snap to.", "warning");
      return;
    }
    const snap = computeWallSnap(bounds, room, before.position, before.rotation[1], before.scale);

    this.updateSelectedTransform({
      position: snap.position,
      rotation: [before.rotation[0], snap.rotationYDeg, before.rotation[2]],
    });
    this.commitTransformChange(selection, before, "Wall snap");
  }

  /** Fits the sun's shadow frustum to the room AABB so shadows stay crisp. */
  private fitSunShadowToScene(): void {
    fitDirectionalShadowToBounds(this.sun, this.getRoomBounds());
  }

  private getRoomBounds(): Box3 | null {
    return computeSceneRoomBounds(this.layout, this.localBounds, {
      includeAsset: (assetId) => this.isRoomAsset(assetId),
    });
  }

  private isWallAsset(assetId: string): boolean {
    const placement = this.assetPlacements.get(assetId);
    return Boolean(placement && (placement.surface === "wall" || placement.snapToWall));
  }

  private isRoomAsset(assetId: string): boolean {
    return this.assetPlacements.get(assetId)?.surface === "room";
  }

  /**
   * Begin a drag-and-drop placement: builds a translucent ghost of the dragged
   * asset so the viewport shows where it will land before the drop. The Content
   * Browser lists every manifest asset but only loadGroups are loaded up front,
   * so a ghost for an unloaded asset is built once its model lazy-loads.
   * Characters are skinned meshes and skip the ghost (they still drop fine).
   */
  beginAssetDragPreview(assetId: string): void {
    this.endAssetDragPreview();
    this.dragPreviewAssetId = assetId;
    this.dragPreviewClient = null;
    this.ensureShapeModel(assetId);

    const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
    if (asset && assetType(asset) === "skeletalMesh") return;

    if (this.models.has(assetId)) {
      this.createDragPreview(assetId);
      return;
    }
    void this.ensureAssetLoaded(assetId).then((ok) => {
      // Bail if the drag was cancelled or moved on while we were loading.
      if (!ok || this.dragPreviewAssetId !== assetId || this.dragPreview) return;
      this.createDragPreview(assetId);
      if (this.dragPreviewClient) {
        this.updateAssetDragPreview(this.dragPreviewClient.x, this.dragPreviewClient.y);
      }
    });
  }

  beginLightDragPreview(type: LayoutLightActor["type"]): void {
    this.endAssetDragPreview();
    const key = `light:${type}`;
    this.dragPreviewAssetId = key;
    this.dragPreviewClient = null;
    const actor = this.createDefaultLightActor(type);
    actor.position = [0, 0, 0];
    const record = buildSceneLightObject(actor, -1);
    record.light.visible = false;
    const wire = record.gizmo.getObjectByName("light-wire");
    if (wire) wire.visible = true;
    record.root.visible = false;
    this.dragPreview = {
      kind: "light",
      key,
      group: record.root,
      dispose: () => disposeLightGizmo(record.gizmo),
    };
    this.scene.add(record.root);
  }

  private createDragPreview(assetId: string): void {
    const gltf = this.models.get(assetId);
    if (!gltf) return;
    // clone(true) shares geometries with the source gltf (Mesh.clone keeps the
    // geometry/material by reference), so only the override material we add here
    // needs disposing on cleanup â€” never the shared geometries.
    const group = gltf.scene.clone(true);
    const material = new MeshStandardMaterial({
      color: 0xf59e2c,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      roughness: 0.6,
      metalness: 0,
    });
    group.traverse((object) => {
      if (object instanceof Mesh) {
        object.material = material;
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    group.visible = false;
    this.dragPreview = {
      kind: "asset",
      key: assetId,
      group,
      dispose: () => material.dispose(),
    };
    this.scene.add(group);
  }

  /** Position the drag ghost under the cursor (snapped/wall-mounted exactly as
   *  the drop will land). No-op for assets without a ghost (e.g. characters). */
  updateAssetDragPreview(clientX: number, clientY: number): void {
    this.dragPreviewClient = { x: clientX, y: clientY };
    const preview = this.dragPreview;
    if (!preview) return;
    if (preview.kind === "light") {
      const position = this.computeLightDropPosition(clientX, clientY);
      if (!position) {
        preview.group.visible = false;
        return;
      }
      preview.group.position.set(...position);
      preview.group.visible = true;
      return;
    }
    const transform = this.computeInstanceDropTransform(preview.key, clientX, clientY);
    if (!transform) {
      preview.group.visible = false;
      return;
    }
    preview.group.position.set(...transform.position);
    applyEulerDegrees(preview.group, [0, transform.rotationYDeg, 0]);
    preview.group.visible = true;
  }

  /** Hide the drag ghost while the cursor is off the viewport (kept alive so it
   *  reappears if the cursor returns before the drop). */
  hideAssetDragPreview(): void {
    if (this.dragPreview) this.dragPreview.group.visible = false;
  }

  /** Tear down the drag ghost (drop committed, drag cancelled, or interrupted). */
  endAssetDragPreview(): void {
    this.dragPreviewAssetId = null;
    this.dragPreviewClient = null;
    const preview = this.dragPreview;
    if (!preview) return;
    this.dragPreview = null;
    this.scene.remove(preview.group);
    preview.dispose();
  }

  /**
   * Ensure a single model is loaded and integrated (materials + local bounds)
   * exactly as the bulk loadGroups path does, so on-demand placement of assets
   * outside the layout's loadGroups behaves identically.
   */
  private async ensureAssetLoaded(assetId: string): Promise<boolean> {
    if (this.models.has(assetId)) return true;
    if (!this.assetLoader) return false;
    try {
      const gltf = await this.assetLoader.loadModel(assetId);
      this.models.set(assetId, gltf);
      const single = new Map<string, GLTF>([[assetId, gltf]]);
      convertUnlitModelMaterialsToLit(single);
      for (const [id, box] of computeModelLocalBounds(single)) {
        this.localBounds.set(id, box);
      }
      await this.refreshAssetUvwMapping(assetId, { rebuild: false });
      await this.refreshAssetMaterialSlots(assetId);
      return true;
    } catch (error) {
      this.onStatus?.(
        `Asset failed to load: ${assetId} (${error instanceof Error ? error.message : String(error)})`,
        "warning",
      );
      return false;
    }
  }

  private async loadMissingSceneModels(): Promise<void> {
    if (!this.assetLoader) return;
    const needed = sceneModelAssetIds(this.layout).filter((assetId) => !this.models.has(assetId));
    if (needed.length === 0) return;
    // Only load ids the manifest still knows as meshes. A layout can outlive an
    // asset (e.g. a model imported then deleted leaves a dangling placement); such
    // ids are skipped with a warning instead of throwing and blanking the editor scene.
    const manifest = await this.assetLoader.loadManifest();
    const loadable = new Set(
      manifest.assets.filter((asset) => isModelAssetType(assetType(asset))).map((asset) => asset.id),
    );
    const absent = needed.filter((assetId) => !loadable.has(assetId));
    if (absent.length > 0) {
      console.warn("[editor] layout references assets absent from the manifest; skipping:", absent);
    }
    const missing = needed.filter((assetId) => loadable.has(assetId));
    if (missing.length === 0) return;
    const models = await this.assetLoader.loadModels(missing);
    for (const [assetId, model] of models) this.models.set(assetId, model);
  }

  getSelected(): EditableSelection | null {
    if (!this.layout || !this.selection) return null;
    return buildEditableSelection(this.layout, this.selection, {
      assetCategory: (assetId) => this.assetCategory(assetId),
      staticObjectsCastShadow: this.staticObjectsCastShadow(),
    });
  }

  /** Resolves an asset's manifest category for Details display. */
  private assetCategory(assetId: string): string {
    return this.manifest?.assets.find((entry) => entry.id === assetId)?.category ?? "";
  }

  private isMaterialAsset(assetId: string): boolean {
    const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
    return Boolean(asset && assetType(asset) === "material");
  }

  captureSelectedTransform(): EditableTransform | null {
    if (!this.selection) return null;
    return this.captureTransform(this.selection);
  }

  captureSelectedTransforms(): EditableTransformSnapshot[] {
    return this.getSelectedSelections().flatMap((selection) => {
      const transform = this.captureTransform(selection);
      return transform ? [{ selection: cloneSelection(selection), transform }] : [];
    });
  }

  commitSelectedTransform(before: EditableTransform | null, label = "Transform"): void {
    if (!before || !this.selection) return;
    this.commitTransformChange(this.selection, before, label);
  }

  commitSelectedTransforms(before: EditableTransformSnapshot[], label = "Transform"): void {
    if (before.length === 0) return;
    const entries = before.map((entry) => ({
      selection: cloneSelection(entry.selection),
      before: entry.transform,
      after: this.captureTransform(entry.selection),
    }));

    const changes: Array<{
      selection: Selection;
      before: EditableTransform;
      after: EditableTransform;
    }> = [];
    for (const entry of entries) {
      if (!entry.after || transformsEqual(entry.before, entry.after)) continue;
      changes.push({
        selection: entry.selection,
        before: entry.before,
        after: entry.after,
      });
    }
    if (changes.length === 0) return;

    const selections = changes.map((entry) => cloneSelection(entry.selection));
    const active =
      this.selection && selections.some((selection) => selectionsEqual(selection, this.selection))
        ? cloneSelection(this.selection)
        : cloneSelection(selections[0]!);

    this.executeCommand({
      label: changes.length === 1 ? label : `${label} ${changes.length} objects`,
      redo: () => {
        this.selectMany(selections, active);
        for (const change of changes) this.applyTransform(change.selection, change.after);
      },
      undo: () => {
        this.selectMany(selections, active);
        for (const change of changes) this.applyTransform(change.selection, change.before);
      },
    });
  }

  updateSelectedTransform(values: {
    position?: Vec3;
    rotation?: Vec3;
    scale?: Vec3;
  }, options: { notifySelection?: boolean } = {}): void {
    if (!this.layout || !this.selection) return;
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }
    const transform = this.getMutableTransform(this.selection);
    if (!transform) return;

    if (values.position) transform.position = values.position;
    if (values.rotation) writeRotation(transform, values.rotation);
    if (values.scale && this.selection.kind !== "reflectionCapture" && this.selection.kind !== "landscape") {
      writeScale(transform, values.scale);
    }

    this.refreshSelectionObject(this.selection);
    this.updateSelectionBox();
    this.updateGizmo();
    if (options.notifySelection !== false) this.emitSelectionChanged();
  }

  updateSelectedTransforms(values: {
    position?: Vec3;
    rotation?: Vec3;
    scale?: Vec3;
  }, options: { notifySelection?: boolean } = {}): void {
    if (!this.layout || !this.selection) return;

    const selections = this.getSelectedSelections();
    const editableSelections = selections.filter((selection) => !this.isSelectionLocked(selection));
    if (editableSelections.length === 0) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }

    for (const selection of editableSelections) {
      const transform = this.getMutableTransform(selection);
      if (!transform) continue;
      if (values.position) transform.position = [...values.position];
      if (values.rotation) writeRotation(transform, values.rotation);
      if (values.scale && selection.kind !== "reflectionCapture" && selection.kind !== "landscape") {
        writeScale(transform, values.scale);
      }
      this.refreshSelectionObject(selection);
    }

    this.updateSelectionBox();
    this.updateGizmo();
    if (options.notifySelection !== false) this.emitSelectionChanged();
  }

  deleteSelected(): void {
    // Environment singletons are outside the transform/
    // multi-select stack; route their deletes through the dedicated (undoable)
    // commands.
    if (this.selection?.kind === "sky" && this.editorSceneController.selectedCount <= 1) {
      this.removeSkyAtmosphere();
      return;
    }
    if (this.selection?.kind === "fog" && this.editorSceneController.selectedCount <= 1) {
      this.removeHeightFog();
      return;
    }
    if (this.selection?.kind === "cloud" && this.editorSceneController.selectedCount <= 1) {
      this.removeCloudLayer();
      return;
    }
    if (this.selection?.kind === "post" && this.editorSceneController.selectedCount <= 1) {
      this.removePostProcess();
      return;
    }
    if (
      this.selection?.kind === "reflectionPlane" &&
      this.editorSceneController.selectedCount <= 1
    ) {
      this.removeReflectionPlane(this.selection.index);
      return;
    }
    if (
      this.selection?.kind === "reflectiveSurface" &&
      this.editorSceneController.selectedCount <= 1
    ) {
      this.removeReflectiveSurface(this.selection.index);
      return;
    }
    if (
      this.selection?.kind === "reflectionCapture" &&
      this.editorSceneController.selectedCount <= 1
    ) {
      this.removeReflectionCapture(this.selection.index);
      return;
    }
    if (
      this.selection?.kind === "blockingVolume" &&
      this.editorSceneController.selectedCount <= 1
    ) {
      this.removeBlockingVolume(this.selection.index);
      return;
    }
    if (
      this.selection?.kind === "aiNavigationVolume" &&
      this.editorSceneController.selectedCount <= 1
    ) {
      this.removeAiNavigationVolume(this.selection.index);
      return;
    }
    if (
      this.selection?.kind === "targetPoint" &&
      this.editorSceneController.selectedCount <= 1
    ) {
      this.removeTargetPoint(this.selection.index);
      return;
    }
    if (this.selection?.kind === "spline" && this.editorSceneController.selectedCount <= 1) {
      this.removeSpline(this.selection.index);
      return;
    }
    if (
      this.selection?.kind === "worldWidget" &&
      this.editorSceneController.selectedCount <= 1
    ) {
      this.removeWorldWidget(this.selection.index);
      return;
    }
    if (
      this.selection?.kind === "landscape" &&
      this.editorSceneController.selectedCount <= 1
    ) {
      this.removeLandscape(this.selection.index);
      return;
    }
    this.editorSceneController.deleteSelected();
  }

  duplicateSelected(): void {
    this.editorSceneController.duplicateSelected();
  }

  hideSelected(): void {
    this.editorSceneController.hideSelected();
  }

  setSelectedHidden(hidden: boolean): void {
    this.editorSceneController.setSelectedHidden(hidden);
  }

  setSelectedLocked(locked: boolean): void {
    this.editorSceneController.setSelectedLocked(locked);
  }

  groupSelected(): void {
    this.editorSceneController.groupSelected();
  }

  /** Clears the group id from every member of any group in the current selection. */
  ungroupSelected(): void {
    this.editorSceneController.ungroupSelected();
  }

  /** Parents the other selected objects to the active selection (the parent). */
  parentSelectionToActive(): void {
    this.editorSceneController.parentSelectionToActive();
  }

  /**
   * Parents one or more objects (by scene-object id) to a target object.
   * Used by outliner drag-and-drop: drag child rows onto a parent row.
   * Cycle-safe (a target that is a descendant of a dragged object is skipped).
   */
  parentObjectsTo(childIds: string[], parentId: string): void {
    this.editorSceneController.parentObjectsTo(childIds, parentId);
  }

  /** Clears the parent of every selected object. */
  unparentSelected(): void {
    this.editorSceneController.unparentSelected();
  }

  /**
   * Sets the active selection's local authoring pivot (the point rotation/scale
   * gizmos act around). Does not move the object â€” only where the gizmo sits.
   */
  setSelectionPivot(pivot: Vec3): void {
    if (
      !this.selection ||
      this.selection.kind === "light" ||
      this.selection.kind === "reflectionCapture"
    ) {
      this.onStatus?.("This selection has no pivot.", "warning");
      return;
    }
    const selection = cloneSelection(this.selection);
    const target = this.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!target) return;
    const before = readPivot(target);
    const next: Vec3 = [round(pivot[0]), round(pivot[1]), round(pivot[2])];
    this.commitPivotChange(selection, before, next);
  }

  /** Writes a pivot value live (no command); deletes the field when at origin. */
  private applyPivotValue(selection: Selection, value: Vec3): void {
    const mut = this.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    if (!mut) return;
    if (value[0] === 0 && value[1] === 0 && value[2] === 0) delete mut.pivot;
    else mut.pivot = [...value];
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  /** Pushes an undoable pivot change from `before` to `after` (no-op when equal). */
  private commitPivotChange(selection: Selection, before: Vec3, after: Vec3): void {
    if (before[0] === after[0] && before[1] === after[1] && before[2] === after[2]) return;
    const sel = cloneSelection(selection);
    this.executeCommand({
      label: "Edit pivot",
      redo: () => {
        this.select(sel);
        this.applyPivotValue(sel, after);
      },
      undo: () => {
        this.select(sel);
        this.applyPivotValue(sel, before);
      },
    });
  }

  isPivotEditMode(): boolean {
    return this.pivotEditMode;
  }

  togglePivotEditMode(): void {
    this.setPivotEditMode(!this.pivotEditMode);
  }

  /** Enters/leaves pivot-edit mode: the move gizmo then drags the pivot point. */
  setPivotEditMode(enabled: boolean): void {
    if (this.pivotEditMode === enabled) return;
    this.pivotEditMode = enabled;
    this.updateGizmo();
    this.onPivotEditModeChanged?.(enabled);
    this.onStatus?.(
      enabled ? "Pivot edit: drag the move gizmo to set the pivot." : "Pivot edit off.",
      "info",
    );
  }

  /** Quick pivot presets derived from the model's local bounds. */
  applySelectionPivotPreset(preset: "reset" | "center" | "base"): void {
    if (!this.selection) return;
    if (preset === "reset") {
      this.setSelectionPivot([0, 0, 0]);
      return;
    }
    const bounds = this.getLocalBounds(this.selection);
    if (!bounds) {
      this.onStatus?.("No local bounds available for this pivot preset.", "warning");
      return;
    }
    const center = bounds.getCenter(new Vector3());
    if (preset === "center") {
      this.setSelectionPivot([center.x, center.y, center.z]);
    } else {
      // base: bottom-centre â€” natural hinge for objects resting on the floor.
      this.setSelectionPivot([center.x, bounds.min.y, center.z]);
    }
  }

  showHiddenObjects(): void {
    this.editorSceneController.showHiddenObjects();
  }

  addLightActor(type: LayoutLightActor["type"]): void {
    if (!this.layout) return;
    const index = this.layout.lights?.length ?? 0;
    const actor = this.createDefaultLightActor(type);
    const selection: Selection = { kind: "light", index };

    this.executeCommand({
      label: `Add ${formatLightType(type)}`,
      redo: () => {
        this.insertLightActor(index, actor);
        this.select(selection);
      },
      undo: () => {
        this.removeLightActor(index);
        this.select(null);
      },
    });
  }

  /**
   * Spawn a built-in primitive (cube/sphere/â€¦) in front of the camera. Shapes
   * are model instances under a synthetic `shape:<type>` asset, so they reuse
   * the instance transform/selection/save pipeline; only the procedural model
   * needs registering on first use.
   */
  addShapeActor(type: ShapePrimitiveType): void {
    if (!this.layout) return;
    const assetId = shapeAssetId(type);
    this.ensureShapeModel(assetId);

    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    const placementIndex = instance?.placements.length ?? 0;
    const placement: LayoutPlacement = {
      name: this.uniqueInstanceName(formatShapeType(type)),
      position: this.defaultActorPosition(3),
      scale: 1,
    };
    const selection: Selection = { kind: "instance", assetId, placementIndex };

    this.executeCommand({
      label: `Add ${formatShapeType(type)}`,
      redo: () => {
        this.insertInstancePlacement(assetId, placementIndex, placement);
        this.select(selection);
      },
      undo: () => {
        this.removeInstancePlacement(assetId, placementIndex);
        this.select(null);
      },
    });
  }

  /**
   * Spawn a Player Start marker (Unreal's PlayerStart). It persists as an
   * ordinary instance under the synthetic `marker:playerStart` asset, so it
   * reuses the instance transform/selection/save pipeline; the runtime skips
   * rendering it and reads its transform as the TPS spawn point. Non-colliding.
   */
  addPlayerStartActor(): void {
    if (!this.layout) return;
    const assetId = PLAYER_START_ASSET_ID;
    this.ensureShapeModel(assetId);

    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    const placementIndex = instance?.placements.length ?? 0;
    const placement: LayoutPlacement = {
      name: this.uniqueInstanceName("Player Start"),
      position: this.defaultActorPosition(3),
      scale: 1,
      collision: false,
    };
    const selection: Selection = { kind: "instance", assetId, placementIndex };

    this.executeCommand({
      label: "Add Player Start",
      redo: () => {
        this.insertInstancePlacement(assetId, placementIndex, placement);
        this.select(selection);
      },
      undo: () => {
        this.removeInstancePlacement(assetId, placementIndex);
        this.select(null);
      },
    });
  }

  /**
   * Resolve the snapped world transform for dropping an instance asset under the
   * cursor. Shared by the live drag ghost and the committed drop so the preview
   * lands exactly where the asset will. Returns null when the cursor isn't over
   * a placeable surface.
   */
  private computeInstanceDropTransform(
    assetId: string,
    clientX: number,
    clientY: number,
  ): { position: [number, number, number]; rotationYDeg: number } | null {
    const hit = this.picker.clientToSurface(clientX, clientY);
    if (!hit) return null;
    const bounds = this.localBounds.get(assetId);
    // Rest the model's base on the surface; bounds.min.y is the offset from the
    // model origin down to its lowest point (y is unaffected by Y rotation).
    let position: [number, number, number] = [
      snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled),
      round(hit.y - (bounds ? bounds.min.y : 0)),
      snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled),
    ];
    let rotationYDeg = snapValue(0, this.snapSettings.rotate, this.snapSettings.rotateEnabled);

    // Wall assets dropped near a wall mount flush against it, facing the room.
    if (this.isWallAsset(assetId)) {
      const room = this.getRoomBounds();
      if (bounds && room) {
        const snap = computeWallSnap(bounds, room, position, rotationYDeg, 1);
        position = snap.position;
        rotationYDeg = snap.rotationYDeg;
      }
    }
    return { position, rotationYDeg };
  }

  private computeLightDropPosition(clientX: number, clientY: number): Vec3 | null {
    const hit = this.picker.clientToSurface(clientX, clientY);
    if (!hit) return null;
    return [
      snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled),
      round(hit.y + 1.5),
      snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled),
    ];
  }

  addAssetAt(assetId: string, clientX: number, clientY: number): void {
    if (!this.layout) return;
    this.ensureShapeModel(assetId);
    // Drag-and-drop can target an asset whose loadGroup wasn't loaded up front;
    // lazy-load it, then retry the placement at the original drop coordinates.
    if (!this.models.has(assetId)) {
      void this.ensureAssetLoaded(assetId).then((ok) => {
        if (ok) this.addAssetAt(assetId, clientX, clientY);
      });
      return;
    }
    const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
    if (asset && assetType(asset) === "skeletalMesh") {
      const hit = this.picker.clientToSurface(clientX, clientY);
      if (!hit) return;
      const characterScale = 0.42;
      const bounds = this.localBounds.get(assetId);
      // Rest the model's base on the surface; bounds.min.y * scale is the offset
      // from the model origin down to its lowest point.
      const baseY = round(hit.y - (bounds ? bounds.min.y * characterScale : 0));
      const character: LayoutCharacter = {
        assetId,
        name: assetId,
        position: [
          snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled),
          baseY,
          snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled),
        ],
        rotationYDeg: snapValue(0, this.snapSettings.rotate, this.snapSettings.rotateEnabled),
        scale: characterScale,
        animation: "idle",
      };
      const index = this.layout.characters.length;
      const selection: Selection = { kind: "character", index };
      this.executeCommand({
        label: `Place ${assetId}`,
        redo: () => {
          this.insertCharacterPlacement(index, character);
          this.select(selection);
        },
        undo: () => {
          this.removeCharacterPlacement(index);
          this.select(null);
        },
      });
      return;
    }

    const transform = this.computeInstanceDropTransform(assetId, clientX, clientY);
    if (!transform) return;
    const placement: LayoutPlacement = {
      position: transform.position,
      rotationYDeg: transform.rotationYDeg,
      scale: 1,
    };
    const shapeType = parseShapeAssetId(assetId);
    if (shapeType) placement.name = this.uniqueInstanceName(formatShapeType(shapeType));
    if (isPlayerStartAssetId(assetId)) {
      placement.name = this.uniqueInstanceName("Player Start");
      placement.collision = false;
    }
    if (isAmbientSoundAssetId(assetId)) {
      placement.name = this.uniqueInstanceName("Ambient Sound");
      placement.collision = false;
      // An Ambient Sound ships with an Audio component already attached, looping
      // spatially on scene load — the placement's transform is the emitter point.
      placement.audio = this.defaultAmbientSoundAudio();
    }

    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    const placementIndex = instance?.placements.length ?? 0;
    const selection: Selection = { kind: "instance", assetId, placementIndex };
    this.executeCommand({
      label: `Place ${assetId}`,
      redo: () => {
        this.insertInstancePlacement(assetId, placementIndex, placement);
        this.select(selection);
      },
      undo: () => {
        this.removeInstancePlacement(assetId, placementIndex);
        this.select(null);
      },
    });
  }

  /**
   * Default Audio component seeded onto a freshly-placed Ambient Sound: the first
   * manifest sound clip (so it is audible on Play) or the built-in chime tone,
   * looping spatially with auto-play. The user re-points it from the Details panel.
   */
  private defaultAmbientSoundAudio(): LayoutAudio {
    const firstSound = this.manifest?.assets.find((asset) => assetType(asset) === "sound");
    return {
      clipId: firstSound?.id ?? "collision-chime",
      autoPlay: true,
      loop: true,
      spatial: true,
    };
  }

  addLightActorAt(type: LayoutLightActor["type"], clientX: number, clientY: number): void {
    if (!this.layout) return;
    const position = this.computeLightDropPosition(clientX, clientY);
    if (!position) return;
    const index = this.layout.lights?.length ?? 0;
    const actor = this.createDefaultLightActor(type);
    actor.position = position;
    const selection: Selection = { kind: "light", index };

    this.executeCommand({
      label: `Place ${formatLightType(type)}`,
      redo: () => {
        this.insertLightActor(index, actor);
        this.select(selection);
      },
      undo: () => {
        this.removeLightActor(index);
        this.select(null);
      },
    });
  }

  /**
   * Places a "special" (non-asset, non-light) actor at the viewport drop point.
   * The `payload` is the drag channel string: a bare actor kind, or for a world
   * widget `worldWidget:<assetId>` (the widget asset is resolved on dragstart in
   * the editor UI, which has the manifest of `*.ui.json` assets). Each actor
   * rests on the picked surface using its default half-height so it doesn't sink
   * into the floor; XZ follow the active move snap, exactly like an asset drop.
   */
  addSpecialActorAt(payload: string, clientX: number, clientY: number): void {
    if (!this.layout) return;
    const hit = this.picker.clientToSurface(clientX, clientY);
    if (!hit) return;
    const x = snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled);
    const z = snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled);
    const separator = payload.indexOf(":");
    const kind = separator >= 0 ? payload.slice(0, separator) : payload;
    const assetId = separator >= 0 ? payload.slice(separator + 1) : "";
    switch (kind) {
      case "aiNavigationVolume":
        // Default size [10, 4, 10] → half-height 2 rests the box on the surface.
        this.addAiNavigationVolume([x, round(hit.y + 2), z]);
        break;
      case "blockingVolume":
        // Default box brush [2, 2, 2] → half-height 1 rests it on the surface.
        this.addBlockingVolume([x, round(hit.y + 1), z]);
        break;
      case "targetPoint":
        this.addTargetPoint([x, round(hit.y), z]);
        break;
      case "spline":
        this.addSpline([x, round(hit.y), z]);
        break;
      case "worldWidget":
        // Float the billboard a little above the surface so it reads clearly.
        this.addWorldWidget(assetId, [x, round(hit.y + 1), z]);
        break;
    }
  }

  async saveLayout(): Promise<void> {
    if (!this.layout) throw new Error("Layout is not loaded yet.");
    if (!this.layoutSaver) {
      throw new Error("Layout saving is available only when the editor saver is installed.");
    }
    const result = await this.layoutSaver({
      layout: this.layout,
      editor: {
        gridSize: this.snapSettings.move,
        gridEnabled: this.snapSettings.moveEnabled,
        snapRotationDeg: this.snapSettings.rotate,
        snapRotationEnabled: this.snapSettings.rotateEnabled,
        snapScale: this.snapSettings.scale,
        snapScaleEnabled: this.snapSettings.scaleEnabled,
      },
    });
    for (const id of this.landscapeDataDirty) {
      await this.saveLandscapeData(id);
    }
    await this.saveFoliageData();
    await this.saveMeshPaintSidecar();
    const dropped = result.dropped ?? [];
    if (dropped.length > 0) {
      // The save still happened — the level is written, minus these fields. Say
      // so loudly rather than reporting a clean success (I5).
      console.warn("[save] dropped by the save validator:", dropped.join(", "));
      this.onStatus?.(
        `Saved ${result.path ?? "layout"} — ${dropped.length} unsupported field(s) dropped: ${dropped.slice(0, 3).join(", ")}${dropped.length > 3 ? ", …" : ""}`,
        "warning",
      );
      return;
    }
    this.onStatus?.(`Saved ${result.path ?? "layout"}.`, "success");
  }

  private async loadActiveProjectScene(): Promise<void> {
    this.activeProject = await loadActiveProject();
    this.assetLoader = new AssetLoader(this.activeProject.manifest, this.renderer);
    this.snapSettings.move = this.activeProject.manifest.editor.gridSize ?? this.snapSettings.move;
    this.snapSettings.moveEnabled =
      this.activeProject.manifest.editor.gridEnabled ?? this.snapSettings.moveEnabled;
    this.snapSettings.rotate =
      this.activeProject.manifest.editor.snapRotationDeg ?? this.snapSettings.rotate;
    this.snapSettings.rotateEnabled =
      this.activeProject.manifest.editor.snapRotationEnabled ?? this.snapSettings.rotateEnabled;
    this.snapSettings.scale =
      this.activeProject.manifest.editor.snapScale ?? this.snapSettings.scale;
    this.snapSettings.scaleEnabled =
      this.activeProject.manifest.editor.snapScaleEnabled ?? this.snapSettings.scaleEnabled;
    this.manifest = await this.assetLoader.loadManifest();
    this.metadataSchema = await this.assetLoader.loadMetadataSchema().catch((error) => {
      this.onStatus?.(
        `Metadata schema failed to load: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
      return null;
    });
    this.layout = await loadRoomLayout(this.activeProject.manifest.editor.defaultScene);
    this.meshPaintData = await loadMeshPaintData(this.activeProject.manifest.editor.defaultScene);
    this.meshPaintDataDirty = false;
    // Normalize world widgets so the editor never reads a malformed anchor (the
    // runtime normalizes on its own load path); keeps the saved JSON clean too.
    if (this.layout.worldWidgets) {
      this.layout.worldWidgets = normalizeWorldWidgets(this.layout.worldWidgets);
    }
    this.ensureDefaultLights();
    this.physicsSubsystem.setGravity(resolveSceneWorldSettings(this.layout).gravity);
    await this.levelRuntime.build();

    this.buildAiNavigationVolumes();
    this.buildTargetPoints();
    this.buildWorldWidgetMarkers();
    this.emitSceneObjectsChanged();
    this.emitWorldSettingsChanged();
    this.emitHistoryChanged();

    const bytes = await this.assetLoader.totalBytesForGroups(this.layout.loadGroups);
    const materialStats = collectMaterialStats(this.models);
    console.info(
      "[render-test] Kenney room loaded",
      JSON.stringify({
        project: this.activeProject.manifest.name,
        layout: this.layout.name,
        processedAssetBytes: bytes,
        materialStats,
        convertedUnlitMaterials: this.convertedUnlitMaterials,
        note:
          materialStats.basic > 0
            ? "Unlit runtime materials remain; scene lights do not affect those assets."
            : "Runtime model materials are lit and can receive dynamic lighting.",
      }),
    );

    // Derive the runtime entity set once and bring the engine-core spine online
    // now that the scene is fully built. SceneDocument starts acting as a runtime
    // source of truth here: behaviors mutate per-entity transform copies, synced
    // back to the rendered objects each tick via syncEntityTransform. The rAF
    // loop's engineApp.update() has been ticking the registry since start();
    // behaviors only have entities to act on from here.
    // Load authored collision sidecars first so the runtime collider (and the
    // "Show > Collision" overlay) use the compound shapes, not the auto box.
    await this.refreshCollisionDefs();
    await this.loadAiAssets();
    this.aiSubsystem.setTargetPoints(targetPointEntriesFromLayout(this.layout?.targetPoints));
    await startSceneRuntime({
      sceneDocument: this.getSceneDocument(),
      physics: this.physicsSubsystem,
      ai: this.aiSubsystem,
      behavior: this.behaviorSubsystem,
      engineApp: this.engineApp,
    });
    this.bindAiScriptStimulusBridge();
  }

  private bindAiScriptStimulusBridge(): void {
    this.clearAiScriptStimulusBridge();
    this.aiStimulusUnsubs = AI_SCRIPT_STIMULUS_MESSAGE_TYPES.map((type) =>
      this.behaviorSubsystem.subscribeScriptMessage(type, (envelope) => {
        this.aiSubsystem.emitScriptStimulus({
          type: envelope.type,
          source: envelope.source,
          ...(envelope.target !== undefined ? { target: envelope.target } : {}),
          payload: envelope.payload,
        });
      }),
    );
  }

  private clearAiScriptStimulusBridge(): void {
    for (const unsubscribe of this.aiStimulusUnsubs) unsubscribe();
    this.aiStimulusUnsubs = [];
  }

  private async loadAiAssets(): Promise<void> {
    if (!this.assetLoader) return;
    const manifest = await this.assetLoader.loadManifest();
    const blackboards = new Map<string, AiBlackboardAsset>();
    const behaviors = new Map<string, AiBehaviorTreeAsset>();
    const stateTrees = new Map<string, AiStateTreeAsset>();
    await Promise.all(
      manifest.assets.map(async (asset) => {
        const type = assetType(asset);
        if (type !== "blackboard" && type !== "behaviorTree" && type !== "stateTree") return;
        const path = assetPath(asset);
        try {
          const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          const json = await response.json();
          if (type === "blackboard") {
            const blackboard = normalizeAiBlackboardAsset(json);
            blackboards.set(asset.id, blackboard);
            blackboards.set(path, blackboard);
          } else if (type === "stateTree") {
            const stateTree = normalizeAiStateTreeAsset(json);
            stateTrees.set(asset.id, stateTree);
            stateTrees.set(path, stateTree);
          } else {
            const behavior = normalizeAiBehaviorTreeAsset(json);
            behaviors.set(asset.id, behavior);
            behaviors.set(path, behavior);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[ai] failed to load AI asset", path, message);
          this.onStatus?.(`AI asset load failed: ${path}`, "warning");
        }
      }),
    );
    this.aiSubsystem.setAssetLibrary({ blackboards, behaviors, stateTrees });
  }

  /** Register synthetic models for any `shape:<type>` instances in the layout. */
  private registerShapeModelsFromLayout(): void {
    registerSceneShapeModels(this.layout, this.models, this.localBounds);
  }

  /** Lazily build + register the procedural model and bounds for a shape/marker asset. */
  private ensureShapeModel(assetId: string): void {
    if (this.models.has(assetId)) return;
    const gltf = createProceduralAssetGltf(assetId);
    if (!gltf) return;
    this.models.set(assetId, gltf);
    for (const [id, box] of computeModelLocalBounds(new Map([[assetId, gltf]]))) {
      this.localBounds.set(id, box);
    }
  }

  /** A name unique across every instance placement (shapes show it verbatim). */
  private uniqueInstanceName(baseName: string): string {
    const existing = new Set<string>();
    for (const instance of this.layout?.instances ?? []) {
      for (const placement of instance.placements) {
        if (placement.name) existing.add(placement.name);
      }
    }
    if (!existing.has(baseName)) return baseName;
    let index = 2;
    while (existing.has(`${baseName} ${index}`)) index += 1;
    return `${baseName} ${index}`;
  }

  private createInstancedModel(assetId: string, placements: LayoutPlacement[]): Group {
    const gltf = this.models.get(assetId);
    // A dangling layout placement (asset removed from the manifest) renders
    // nothing rather than aborting the whole editor scene build.
    if (!gltf) {
      console.warn(`[editor] skipping placement for unloaded asset: ${assetId}`);
      return new Group();
    }
    if (isMarkerAssetId(assetId)) {
      return this.createMarkerInstanceGroup(assetId, placements, gltf);
    }
    const renderedOverrideObjects: Object3D[] = [];
    const clonedMaterials: Material[] = [];

    // Per placement: resolve the override material (if any) and the nearest
    // reflection-capture probe (if it covers the placement). A placement renders
    // as a separate clone â€” and is hidden in the shared InstancedMesh â€” when it has
    // an override material OR a probe envMap (clone-fallback per the plan); picking
    // stays intact because the clone carries `userData.placementIndex`.
    const decisions = placements.map((placement, placementIndex) => {
      const meshPaint = this.meshPaintData.placements.filter(
        (entry) => entry.target.assetId === assetId && entry.target.placementIndex === placementIndex,
      );
      const materialSlot = placement.materialSlot;
      const materialSlots = materialSlot ? undefined : this.resolveAssetMaterialSlots(assetId);
      const overrideMaterial = materialSlot && this.materialCache.has(materialSlot)
          ? this.materialCache.get(materialSlot)
          : undefined;
      if (materialSlot && !overrideMaterial) this.ensureMaterialLoaded(materialSlot, assetId);
      for (const slotId of assignedMaterialSlotIds(materialSlots)) {
        if (!this.materialCache.has(slotId)) this.ensureMaterialLoaded(slotId, assetId);
      }
      const bake = placement.hidden
        ? null
        : this.probeBakeForPoint(this.placementWorldCenter(assetId, placement));
      return {
        placement,
        overrideMaterial,
        materialSlots,
        bake,
        meshPaint,
        asClone:
          Boolean(overrideMaterial) ||
          hasAssignedMaterialSlots(materialSlots) ||
          Boolean(bake) ||
          meshPaint.length > 0,
      };
    });

    const instancedPlacements = decisions.map((decision) =>
      decision.asClone ? { ...decision.placement, hidden: true } : decision.placement,
    );

    const { group, meshes } = buildSceneInstancedModel({
      assetId,
      gltf,
      placements: instancedPlacements,
      castShadow: this.staticObjectsCastShadow(),
      receiveShadow: this.staticObjectsReceiveShadow(),
    });
    decisions.forEach((decision, placementIndex) => {
      if (!decision.asClone || decision.placement.hidden) return;
      const object = this.createInstancedCloneObject(
        assetId,
        placementIndex,
        decision.placement,
        gltf,
        decision.overrideMaterial,
        decision.materialSlots,
        decision.bake,
        clonedMaterials,
        decision.meshPaint,
      );
      group.add(object);
      renderedOverrideObjects.push(object);
    });
    this.instanceGroups.set(assetId, group);
    this.instanceMeshes.set(assetId, meshes);
    this.instanceOverrideObjects.set(assetId, renderedOverrideObjects);
    this.instanceProbeMaterials.set(assetId, clonedMaterials);
    this.applyWireframeToLevelObject(group);
    return group;
  }

  /**
   * Build the instance group for an editor-only marker gizmo (Player Start /
   * Ambient Sound). Each placement is a clone of the procedural line geometry
   * plus a billboard icon; the lines are excluded from raycasting so picking
   * resolves through the icon/clone. These are not InstancedMesh surfaces, so
   * they are tracked in `markerObjects` for the show-collision picking sweep.
   */
  private createMarkerInstanceGroup(
    assetId: string,
    placements: LayoutPlacement[],
    gltf: GLTF,
  ): Group {
    const isAmbient = isAmbientSoundAssetId(assetId);
    const makeIcon = isAmbient ? createAmbientSoundIcon : createPlayerStartIcon;
    const iconY = isAmbient ? AMBIENT_SOUND_MARKER_CENTER_Y : PLAYER_START_CAPSULE_CENTER_Y;
    const baseLabel = isAmbient ? "Ambient Sound" : "Player Start";

    const group = new Group();
    const objects: Object3D[] = [];
    group.name = `instanced-${assetId}`;

    placements.forEach((placement, placementIndex) => {
      const object = gltf.scene.clone(true);
      object.name = placement.name ?? `${baseLabel} ${placementIndex + 1}`;
      object.matrix.copy(composePlacementMatrix(placement));
      object.matrixAutoUpdate = false;
      object.visible = !(placement.hidden ?? false);
      object.userData.assetId = assetId;
      object.userData.placementIndex = placementIndex;

      object.traverse((child) => {
        child.userData.assetId = assetId;
        child.userData.placementIndex = placementIndex;
        if (child instanceof LineSegments) {
          child.raycast = () => {};
          return;
        }
        if (!isRenderableMesh(child)) return;
        child.castShadow = false;
        child.receiveShadow = false;
      });

      const icon = makeIcon();
      icon.position.set(0, iconY, 0);
      icon.userData.assetId = assetId;
      icon.userData.placementIndex = placementIndex;
      object.add(icon);

      group.add(object);
      objects.push(object);
    });

    this.instanceGroups.set(assetId, group);
    this.instanceMeshes.set(assetId, []);
    this.instanceOverrideObjects.delete(assetId);
    this.markerObjects.set(assetId, objects);
    this.instanceProbeMaterials.set(assetId, []);
    return group;
  }

  private resolveAssetMaterialSlots(assetId: string): AssetMaterialSlotsDef | undefined {
    const slots = this.assetMaterialSlots.get(assetId);
    return hasAssignedMaterialSlots(slots) ? slots : undefined;
  }

  /**
   * A clone of the asset mesh used for placements excluded from the shared
   * InstancedMesh: those with a material override and/or a reflection-capture probe
   * envMap. The base material is the override (when set) else the GLTF's own; when a
   * `bake` applies, that base is cloned per-mesh and given the probe's PMREM envMap
   * (tracked in `clonedMaterials` for disposal). `MeshBasicMaterial` is left alone.
   */
  private createInstancedCloneObject(
    assetId: string,
    placementIndex: number,
    placement: LayoutPlacement,
    gltf: GLTF,
    overrideMaterial: Material | undefined,
    materialSlots: AssetMaterialSlotsDef | undefined,
    bake: SphereReflectionCaptureBake | null,
    clonedMaterials: Material[],
    meshPaint: readonly LayoutMeshPaintPlacement[] = [],
  ): Object3D {
    const object = gltf.scene.clone(true);
    object.name = `${assetId}-clone-${placementIndex}`;
    object.matrix.copy(composePlacementMatrix(placement));
    object.matrixAutoUpdate = false;
    object.visible = !(placement.hidden ?? false);
    object.userData.assetId = assetId;
    object.userData.placementIndex = placementIndex;
    const primitiveIndexByMeshName = new Map<string, number>();
    object.traverse((child) => {
      child.userData.assetId = assetId;
      child.userData.placementIndex = placementIndex;
      if (!isRenderableMesh(child)) return;
      const meshName = child.name || "__unnamed_mesh";
      const primitiveIndex = primitiveIndexByMeshName.get(meshName) ?? 0;
      primitiveIndexByMeshName.set(meshName, primitiveIndex + 1);
      child.userData.forgeMeshPaintTarget = {
        assetId,
        placementIndex,
        meshName,
        primitiveIndex,
      };
      const paint = meshPaint.find(
        (entry) => entry.target.meshName === meshName && entry.target.primitiveIndex === primitiveIndex,
      );
      if (paint && child.geometry.getAttribute("position")?.count === paint.vertexCount) {
        const geometry = child.geometry.clone();
        geometry.setAttribute("color", new Float32BufferAttribute(paint.colors, 4));
        geometry.userData.forgeMeshPaintClone = true;
        child.geometry = geometry;
      }
      const applyBake = (source: Material): Material => {
        const base = overrideMaterial ?? source;
        return bake
          ? assignProbeEnvMapMaterial(
              base,
              bake,
              clonedMaterials,
              this.scene.environment,
              this.scene.environmentIntensity,
            )
          : base;
      };
      if (overrideMaterial || !hasAssignedMaterialSlots(materialSlots)) {
        child.material = resolveMeshMaterialSlots(child.material, undefined, () => undefined, applyBake);
      }
      child.castShadow = this.staticObjectsCastShadow();
      child.receiveShadow = this.staticObjectsReceiveShadow();
    });
    if (!overrideMaterial && hasAssignedMaterialSlots(materialSlots)) {
      applyMaterialSlotOverrides(
        object,
        materialSlots,
        (materialId) => this.materialCache.get(materialId),
        (material) =>
          bake
            ? assignProbeEnvMapMaterial(
                material,
                bake,
                clonedMaterials,
                this.scene.environment,
                this.scene.environmentIntensity,
              )
            : material,
      );
    }
    return object;
  }

  private ensureMaterialLoaded(
    materialId: string,
    assetIdToRebuild?: string,
  ): Promise<Material | undefined> {
    const cached = this.materialCache.get(materialId);
    if (cached) return Promise.resolve(cached);
    const pending = this.materialLoads.get(materialId);
    if (pending) {
      if (assetIdToRebuild) {
        void pending.then(
          () => this.rebuildInstanceGroup(assetIdToRebuild),
          () => undefined,
        );
      }
      return pending;
    }
    if (!this.manifest) return Promise.resolve(undefined);
    const load = loadForgeMaterial(this.manifest, materialId, this.textureLoader, {
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    })
      .then((material) => {
        this.materialCache.set(materialId, material);
        this.materialLoads.delete(materialId);
        if (assetIdToRebuild) this.rebuildInstanceGroup(assetIdToRebuild);
        return material;
      })
      .catch((error) => {
        this.materialLoads.delete(materialId);
        this.onStatus?.(
          `Material load failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        throw error;
      });
    this.materialLoads.set(materialId, load);
    return load;
  }

  private rebuildInstanceGroup(assetId: string): void {
    if (!this.layout) return;
    // Preview materials belong to clone meshes that are about to be discarded.
    this.clearMeshPaintColorView();
    const previous = this.instanceGroups.get(assetId);
    if (previous) {
      previous.traverse((child) => {
        if (!isRenderableMesh(child) || child.geometry.userData.forgeMeshPaintClone !== true) return;
        child.geometry.dispose();
      });
      this.scene.remove(previous);
    }
    this.disposeInstanceProbeMaterials(assetId);
    this.instanceGroups.delete(assetId);
    this.instanceMeshes.delete(assetId);
    this.instanceOverrideObjects.delete(assetId);
    this.markerObjects.delete(assetId);

    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    if (!instance) return;
    this.scene.add(this.createInstancedModel(assetId, instance.placements));
    this.applyMeshPaintColorView();
  }

  private insertInstancePlacement(
    assetId: string,
    placementIndex: number,
    placement: LayoutPlacement,
  ): void {
    if (!this.layout) return;
    let instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    if (!instance) {
      instance = { assetId, placements: [] };
      this.layout.instances.push(instance);
    }
    const index = clampIndex(placementIndex, instance.placements.length);
    instance.placements.splice(index, 0, clonePlacement(placement));
    this.rebuildInstanceGroup(assetId);
  }

  private removeInstancePlacement(assetId: string, placementIndex: number): LayoutPlacement | null {
    if (!this.layout) return null;
    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    if (!instance) return null;
    const [removed] = instance.placements.splice(placementIndex, 1);
    this.rebuildInstanceGroup(assetId);
    return removed ? clonePlacement(removed) : null;
  }

  private refreshSelectionObject(selection: Selection): void {
    if (selection.kind === "instance") {
      this.rebuildInstanceGroup(selection.assetId);
      return;
    }
    // Environment singletons have no scene object to re-sync from a transform.
    if (
      selection.kind === "sky" ||
      selection.kind === "fog" ||
      selection.kind === "cloud" ||
      selection.kind === "post"
    ) return;

    if (selection.kind === "light") {
      this.refreshLightObject(selection.index);
      return;
    }

    if (selection.kind === "reflectionPlane") {
      this.refreshReflectionPlaneObject(selection.index);
      return;
    }

    if (selection.kind === "reflectiveSurface") {
      this.refreshReflectiveSurfaceObject(selection.index);
      return;
    }

    if (selection.kind === "reflectionCapture") {
      this.refreshReflectionCaptureObject(selection.index);
      return;
    }

    if (selection.kind === "blockingVolume") {
      this.refreshBlockingVolumeObject(selection.index);
      return;
    }

    if (selection.kind === "aiNavigationVolume") {
      this.refreshAiNavigationVolumeObject(selection.index);
      return;
    }

    if (selection.kind === "targetPoint") {
      this.refreshTargetPointObject(selection.index);
      return;
    }
    if (selection.kind === "spline") {
      this.refreshSpline(selection.index);
      return;
    }

    if (selection.kind === "landscape") {
      this.refreshLandscapeObject(selection.index);
      return;
    }

    if (selection.kind === "worldWidget") {
      this.refreshWorldWidgetObject(selection.index);
      return;
    }

    if (selection.kind === "actor") {
      const actorObject = this.actorObjects[selection.index];
      const actorTransform = this.getMutableTransform(selection);
      if (!actorObject || !actorTransform) return;
      actorObject.position.set(...actorTransform.position);
      applyEulerDegrees(actorObject, readRotation(actorTransform));
      actorObject.scale.set(...readScale(actorTransform as LayoutActorInstance));
      actorObject.visible = !(actorTransform.hidden ?? false);
      return;
    }

    const object = this.characterObjects[selection.index];
    const transform = this.getMutableTransform(selection);
    if (!object || !transform) return;
    object.position.set(...transform.position);
    applyEulerDegrees(object, readRotation(transform));
    object.scale.set(...readScale(transform as LayoutCharacter));
  }

  private addCharacter(gltf: GLTF | undefined, placement: LayoutCharacter): void {
    if (!gltf) return;

    const character = this.createCharacterObject(gltf, placement, this.characterObjects.length);
    character.userData.characterIndex = this.characterObjects.length;
    this.applyWireframeToLevelObject(character);
    this.scene.add(character);
    this.characterObjects.push(character);
    this.playCharacterAnimation(character, gltf, placement.animation);
  }

  private insertCharacterPlacement(index: number, placement: LayoutCharacter): void {
    if (!this.layout) return;
    const gltf = this.models.get(placement.assetId);
    if (!gltf) return;

    const insertionIndex = clampIndex(index, this.layout.characters.length);
    const character = this.createCharacterObject(gltf, placement, insertionIndex);
    this.applyWireframeToLevelObject(character);
    this.layout.characters.splice(insertionIndex, 0, cloneCharacter(placement));
    this.characterObjects.splice(insertionIndex, 0, character);
    this.scene.add(character);
    this.playCharacterAnimation(character, gltf, placement.animation);
    this.refreshCharacterIndices();
  }

  private removeCharacterPlacement(index: number): LayoutCharacter | null {
    if (!this.layout) return null;
    const [removedLayout] = this.layout.characters.splice(index, 1);
    const [removedObject] = this.characterObjects.splice(index, 1);
    removedObject?.removeFromParent();
    this.refreshCharacterIndices();
    return removedLayout ? cloneCharacter(removedLayout) : null;
  }

  // --- Actor Script class instances (placed `layout.actors`) ----------------

  /**
   * Resolves every placed actor class, flattens each instance into an entity,
   * loads any referenced mesh assets, then builds a render object per instance.
   * Mirrors RuntimeSceneApp's actor pipeline but for the edit-mode scene so
   * placements are visible + selectable (WYSIWYG). Mesh-less logic/trigger actors
   * fall back to a placeholder marker so they stay pickable + gizmo-movable.
   */
  private async loadActorInstances(): Promise<void> {
    const actors = this.layout?.actors ?? [];
    const entities = await Promise.all(
      actors.map(async (instance, index) => {
        const def = await this.resolveActorClass(instance.classRef);
        return actorInstanceToEntity(def, instance, index);
      }),
    );
    await this.loadActorMeshModels(entities);
    this.addActorObjects(entities);
  }

  /** Fetches + normalizes a `*.actor.json` class, caching by classRef (never throws). */
  private async resolveActorClass(classRef: string): Promise<ActorScriptDef> {
    const cached = this.actorClassCache.get(classRef);
    if (cached) return cached;
    let def: ActorScriptDef;
    try {
      const response = await fetch(projectFileUrl(classRef), { cache: "no-cache" });
      def = normalizeActorScriptDef(response.ok ? await response.json() : {}, classRef);
    } catch {
      def = normalizeActorScriptDef({}, classRef);
    }
    this.actorClassCache.set(classRef, def);
    return def;
  }

  /** Loads manifest meshes referenced by the given actor entities (missing/non-mesh ids are skipped). */
  private async loadActorMeshModels(entities: Entity[]): Promise<void> {
    if (!this.assetLoader) return;
    const needed = new Set<string>();
    for (const entity of entities) {
      const renderer = readRenderableMeshComponent(entity);
      if (renderer && !this.models.has(renderer.assetId)) needed.add(renderer.assetId);
    }
    if (needed.size === 0) return;
    const manifest = this.manifest ?? (await this.assetLoader.loadManifest());
    const loadable: string[] = [];
    for (const id of needed) {
      const record = manifest.assets.find((asset) => asset.id === id);
      if (record && isModelAssetType(assetType(record))) loadable.push(id);
    }
    if (loadable.length === 0) return;
    const models = await this.assetLoader.loadModels(loadable);
    for (const [id, model] of models) this.models.set(id, model);
  }

  /** Rebuilds the actor render objects array (index-aligned with layout.actors) from entities. */
  private addActorObjects(entities: Entity[]): void {
    for (const object of this.actorObjects) object.removeFromParent();
    this.actorObjects = [];
    entities.forEach((entity, index) => {
      const object = this.buildActorObject(entity);
      object.userData.actorIndex = index;
      this.applyWireframeToLevelObject(object);
      this.scene.add(object);
      this.actorObjects[index] = object;
    });
  }

  /**
   * Real mesh when the class has a loadable MeshRenderer; a placeholder marker
   * otherwise. A Light component is attached as a child so a placed actor light
   * illuminates the edit-mode scene (WYSIWYG) and tracks the object as the gizmo
   * moves it.
   */
  private buildActorObject(entity: Entity): Object3D {
    const renderer = readRenderableMeshComponent(entity);
    const gltf = renderer ? this.models.get(renderer.assetId) : undefined;
    let object: Object3D;
    if (gltf) {
      object = createCharacterSceneObject(gltf, entityCharacterItem(entity));
    } else {
      const item = entityCharacterItem(entity);
      const mesh = new Mesh(this.actorPlaceholderGeometry, this.actorPlaceholderMaterial);
      mesh.name = item.name;
      mesh.position.set(...item.position);
      applyEulerDegrees(mesh, item.rotation);
      mesh.scale.set(...item.scale);
      mesh.visible = !item.hidden;
      object = mesh;
    }
    attachActorLight(object, entity);
    return object;
  }

  private insertActorPlacement(index: number, instance: LayoutActorInstance): void {
    if (!this.layout) return;
    if (!this.layout.actors) this.layout.actors = [];
    // The class is resolved + cached (and its mesh loaded) before any placement
    // command runs, so a cache hit is expected here; fall back to an empty class.
    const def =
      this.actorClassCache.get(instance.classRef) ??
      normalizeActorScriptDef({}, instance.classRef);
    const insertionIndex = clampIndex(index, this.layout.actors.length);
    const entity = actorInstanceToEntity(def, instance, insertionIndex);
    const object = this.buildActorObject(entity);
    object.userData.actorIndex = insertionIndex;
    this.applyWireframeToLevelObject(object);
    this.layout.actors.splice(insertionIndex, 0, cloneActorInstance(instance));
    this.actorObjects.splice(insertionIndex, 0, object);
    this.scene.add(object);
    this.refreshActorIndices();
  }

  private removeActorPlacement(index: number): LayoutActorInstance | null {
    if (!this.layout?.actors) return null;
    const [removedLayout] = this.layout.actors.splice(index, 1);
    const [removedObject] = this.actorObjects.splice(index, 1);
    removedObject?.removeFromParent();
    this.refreshActorIndices();
    return removedLayout ? cloneActorInstance(removedLayout) : null;
  }

  private refreshActorIndices(): void {
    this.actorObjects.forEach((object, index) => {
      object.userData.actorIndex = index;
    });
  }

  /**
   * Places an actor class instance from a Content Browser drop. Resolves the
   * class + loads its mesh (so the object renders immediately), then commits the
   * placement through the undo stack and selects it. Async: the drop handler
   * fires this without awaiting.
   */
  async addActorAt(classRef: string, clientX: number, clientY: number): Promise<void> {
    if (!this.layout) return;
    const hit = this.picker.clientToSurface(clientX, clientY);
    if (!hit) return;
    const def = await this.resolveActorClass(classRef);
    const instance: LayoutActorInstance = {
      classRef,
      position: [
        snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled),
        round(hit.y),
        snapValue(hit.z, this.snapSettings.move, this.snapSettings.moveEnabled),
      ],
      rotationYDeg: snapValue(0, this.snapSettings.rotate, this.snapSettings.rotateEnabled),
    };
    // Ensure the class's mesh is loaded before the (synchronous) insert builds its object.
    await this.loadActorMeshModels([actorInstanceToEntity(def, instance, 0)]);
    const index = this.layout.actors?.length ?? 0;
    const selection: Selection = { kind: "actor", index };
    this.executeCommand({
      label: `Place ${actorClassName(classRef)}`,
      redo: () => {
        this.insertActorPlacement(index, instance);
        this.select(selection);
      },
      undo: () => {
        this.removeActorPlacement(index);
        this.select(null);
      },
    });
  }

  private ensureDefaultLights(): void {
    ensureDefaultSceneLights(this.layout);
  }

  private createDefaultLightActor(type: LayoutLightActor["type"]): LayoutLightActor {
    const position = this.defaultActorPosition(type === "directional" ? 4 : 2);
    const id = this.createLightId(type);
    return {
      id,
      type,
      name: uniqueActorName(formatLightType(type), this.layout?.lights ?? []),
      position,
      rotation: type === "point" ? [0, 0, 0] : [-55, 35, 0],
      color: DEFAULT_SCENE_LIGHT_COLOR,
      intensity: defaultLightIntensity(type),
      castShadow: type !== "point",
      ...(type === "point" ? { distance: 8, decay: 2 } : {}),
      ...(type === "spot" ? { distance: 10, angle: 30, penumbra: 0.35, decay: 2 } : {}),
    };
  }

  private createLightId(type: LayoutLightActor["type"]): string {
    const existing = new Set(this.layout?.lights?.map((light) => light.id) ?? []);
    return uniqueEditorId(`${type}-light`, existing, 10_000);
  }

  private defaultActorPosition(distance: number): Vec3 {
    const direction = new Vector3();
    const camera = this.editorViewportCamera();
    camera.getWorldDirection(direction);
    const position = camera.position.clone().addScaledVector(direction.normalize(), distance);
    position.y = Math.max(1, position.y);
    return [round(position.x), round(position.y), round(position.z)];
  }

  private addLight(actor: LayoutLightActor): void {
    const record = this.createLightObject(actor, this.lightObjects.length);
    tagSceneLightRecordIndex(record, this.lightObjects.length);
    this.scene.add(record.root);
    if (record.target) this.scene.add(record.target);
    this.lightObjects.push(record);
    if (isSceneSunLight(actor, this.sun)) {
      this.sun = record.light as DirectionalLight;
    }
    this.refreshLightObject(this.lightObjects.length - 1);
  }

  private createLightObject(actor: LayoutLightActor, index: number): LightObjectRecord {
    return buildSceneLightObject(actor, index);
  }

  private insertLightActor(index: number, actor: LayoutLightActor): void {
    if (!this.layout) return;
    const insertionIndex = clampIndex(index, this.layout.lights?.length ?? 0);
    this.layout.lights ??= [];
    const record = this.createLightObject(actor, insertionIndex);
    this.layout.lights.splice(insertionIndex, 0, cloneLightActor(actor));
    this.lightObjects.splice(insertionIndex, 0, record);
    this.scene.add(record.root);
    if (record.target) this.scene.add(record.target);
    if (actor.type === "directional" && (!this.sun || actor.id === DEFAULT_SCENE_SUN_ID)) {
      this.sun = record.light as DirectionalLight;
    }
    this.refreshLightIndices();
    this.refreshLightObject(insertionIndex);
  }

  private removeLightActor(index: number): LayoutLightActor | null {
    if (!this.layout?.lights) return null;
    const [removedLayout] = this.layout.lights.splice(index, 1);
    const [removedObject] = this.lightObjects.splice(index, 1);
    removedObject?.root.removeFromParent();
    removedObject?.target?.removeFromParent();
    this.refreshLightIndices();
    this.sun =
      (this.lightObjects.find((entry) => entry.light instanceof DirectionalLight)
        ?.light as DirectionalLight | undefined) ?? null;
    return removedLayout ? cloneLightActor(removedLayout) : null;
  }

  private refreshLightIndices(): void {
    this.lightObjects.forEach((record, index) => {
      record.root.userData.lightIndex = index;
      record.root.traverse((child) => {
        child.userData.lightIndex = index;
      });
    });
  }

  private refreshLightObject(index: number): void {
    const actor = this.layout?.lights?.[index];
    const record = this.lightObjects[index];
    if (!actor || !record) return;
    syncLightObject(record, entityLightItem(lightEntity(index, actor)), {
      defaultColor: DEFAULT_SCENE_LIGHT_COLOR,
      selected: this.isLightSelected(index),
    });
    // Sun = source of truth for the sky's sun: keep the sky disc in sync as the
    // (directional) Sun light is rotated via gizmo or its rotation fields.
    if (actor.type === "directional") this.updateSkySunFromLight();
  }

  // --- Planar Reflection (mirror) actors -----------------------------------

  /** Resolved settings + world transform for a reflection-plane layout actor. */
  private reflectionPlaneItem(actor: LayoutReflectionPlane): ReflectionPlaneRenderItem {
    return {
      ...resolveReflectionPlane(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      scale: readScale(actor),
    };
  }

  /** Rebuilds every reflector + icon from `layout.reflectionPlanes` (used on load). */
  private buildReflectionPlanes(): void {
    for (const reflector of this.reflectionPlaneObjects) {
      this.scene.remove(reflector);
      disposeReflectionPlaneObject(reflector);
    }
    // Icons share cached material/texture, so just detach them (never dispose).
    for (const icon of this.reflectionPlaneIcons) this.scene.remove(icon);
    this.reflectionPlaneObjects = [];
    this.reflectionPlaneIcons = [];
    const planes = this.layout?.reflectionPlanes ?? [];
    planes.forEach((actor, index) => {
      const reflector = createReflectionPlaneObject(this.reflectionPlaneItem(actor));
      reflector.userData.reflectionPlaneIndex = index;
      this.reflectionPlaneObjects.push(reflector);
      this.scene.add(reflector);
      const icon = createReflectionPlaneIcon();
      icon.userData.reflectionPlaneIndex = index;
      this.reflectionPlaneIcons.push(icon);
      this.scene.add(icon);
      this.syncReflectionPlaneIcon(index);
    });
  }

  /** Positions a Mirror Plane's billboard icon at the actor and tracks `hidden`. */
  private syncReflectionPlaneIcon(index: number): void {
    const icon = this.reflectionPlaneIcons[index];
    const actor = this.layout?.reflectionPlanes?.[index];
    if (!icon || !actor) return;
    icon.position.set(actor.position[0], actor.position[1], actor.position[2]);
    icon.visible = !(actor.hidden ?? false);
  }

  /** Cheap transform/visibility/color sync for one reflector + icon (gizmo drag). */
  private refreshReflectionPlaneObject(index: number): void {
    const actor = this.layout?.reflectionPlanes?.[index];
    const reflector = this.reflectionPlaneObjects[index];
    if (!actor || !reflector) return;
    applyReflectionPlaneTransform(reflector, this.reflectionPlaneItem(actor));
    this.syncReflectionPlaneIcon(index);
  }

  /** Recreates one reflector (needed when resolution changes â€” fixed at build). */
  private rebuildReflectionPlaneObject(index: number): void {
    const old = this.reflectionPlaneObjects[index];
    if (old) {
      this.scene.remove(old);
      disposeReflectionPlaneObject(old);
    }
    const actor = this.layout?.reflectionPlanes?.[index];
    if (!actor) return;
    const reflector = createReflectionPlaneObject(this.reflectionPlaneItem(actor));
    reflector.userData.reflectionPlaneIndex = index;
    this.reflectionPlaneObjects[index] = reflector;
    this.scene.add(reflector);
  }

  private refreshReflectionPlaneIndices(): void {
    this.reflectionPlaneObjects.forEach((reflector, index) => {
      reflector.userData.reflectionPlaneIndex = index;
    });
    this.reflectionPlaneIcons.forEach((icon, index) => {
      icon.userData.reflectionPlaneIndex = index;
    });
  }

  private insertReflectionPlane(index: number, actor: LayoutReflectionPlane): void {
    if (!this.layout) return;
    this.layout.reflectionPlanes ??= [];
    const insertionIndex = clampIndex(index, this.layout.reflectionPlanes.length);
    this.layout.reflectionPlanes.splice(insertionIndex, 0, cloneReflectionPlane(actor));
    const reflector = createReflectionPlaneObject(this.reflectionPlaneItem(actor));
    this.reflectionPlaneObjects.splice(insertionIndex, 0, reflector);
    this.scene.add(reflector);
    const icon = createReflectionPlaneIcon();
    this.reflectionPlaneIcons.splice(insertionIndex, 0, icon);
    this.scene.add(icon);
    this.refreshReflectionPlaneIndices();
    this.syncReflectionPlaneIcon(insertionIndex);
  }

  private removeReflectionPlaneAt(index: number): LayoutReflectionPlane | null {
    if (!this.layout?.reflectionPlanes) return null;
    const [removed] = this.layout.reflectionPlanes.splice(index, 1);
    const [reflector] = this.reflectionPlaneObjects.splice(index, 1);
    if (reflector) {
      this.scene.remove(reflector);
      disposeReflectionPlaneObject(reflector);
    }
    const [icon] = this.reflectionPlaneIcons.splice(index, 1);
    if (icon) this.scene.remove(icon);
    this.refreshReflectionPlaneIndices();
    return removed ? cloneReflectionPlane(removed) : null;
  }

  /** Adds a Planar Reflection actor (flat floor mirror by default) and selects it. */
  addReflectionPlane(): void {
    if (!this.layout) return;
    const planes = this.layout.reflectionPlanes ?? [];
    const actor: LayoutReflectionPlane = {
      id: uniqueReflectionPlaneId(planes),
      name: uniqueReflectionPlaneName("Mirror Plane", planes),
      position: [0, 0.01, 0],
      rotation: [-90, 0, 0],
      scale: [4, 4, 1],
    };
    const index = planes.length;
    this.executeCommand({
      label: "Add Mirror Plane",
      redo: () => {
        this.insertReflectionPlane(index, actor);
        this.select({ kind: "reflectionPlane", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.removeReflectionPlaneAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Added Mirror Plane.", "info");
  }

  /** Removes a Planar Reflection actor (undoable). */
  removeReflectionPlane(index: number): void {
    const actor = this.layout?.reflectionPlanes?.[index];
    if (!actor) return;
    const snapshot = cloneReflectionPlane(actor);
    this.executeCommand({
      label: "Delete Mirror Plane",
      redo: () => {
        this.removeReflectionPlaneAt(index);
        if (this.selection?.kind === "reflectionPlane") this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.insertReflectionPlane(index, snapshot);
        this.select({ kind: "reflectionPlane", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
  }

  /**
   * Applies a partial property edit (color/resolution) to a reflection plane as
   * one undoable command. Transform/name/hidden edits flow through the generic
   * selection pipeline; this path rebuilds the reflector since resolution is
   * baked into its render target.
   */
  setReflectionPlane(
    index: number,
    patch: { color?: string; resolution?: number | undefined },
    label = "Edit Mirror Plane",
  ): void {
    const actor = this.layout?.reflectionPlanes?.[index];
    if (!actor) return;
    const previous = cloneReflectionPlane(actor);
    const next = cloneReflectionPlane(actor);
    if (patch.color !== undefined) next.color = patch.color;
    if ("resolution" in patch) {
      if (patch.resolution === undefined) delete next.resolution;
      else next.resolution = patch.resolution;
    }

    const apply = (value: LayoutReflectionPlane): void => {
      if (!this.layout?.reflectionPlanes?.[index]) return;
      this.layout.reflectionPlanes[index] = cloneReflectionPlane(value);
      this.rebuildReflectionPlaneObject(index);
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(next),
      undo: () => apply(previous),
    });
  }

  /** Edits the currently selected reflection plane's color/resolution (Details panel). */
  setSelectedReflectionPlane(patch: { color?: string; resolution?: number | undefined }): void {
    if (this.selection?.kind !== "reflectionPlane") return;
    this.setReflectionPlane(this.selection.index, patch);
  }

  // --- Reflective Surface (textured glossy planar reflection) actors --------

  /** Resolved settings + world transform for a reflective-surface layout actor. */
  private reflectiveSurfaceItem(actor: LayoutReflectiveSurface): ReflectiveSurfaceRenderItem {
    return {
      ...resolveReflectiveSurface(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      scale: readScale(actor),
    };
  }

  /**
   * Resolves a reflective surface's material to a fresh `MeshStandardMaterial`. The
   * surface patches its material (`onBeforeCompile`), so it must own a CLONE — never
   * the shared cache instance that placed-instance meshes also use. Returns null when
   * no material is assigned or it isn't cached yet (built with the default; see
   * {@link ensureReflectiveSurfaceMaterial}).
   */
  private reflectiveSurfaceMaterial(materialId: string | null): MeshStandardMaterial | null {
    if (!materialId) return null;
    const cached = this.materialCache.get(materialId);
    return cached instanceof MeshStandardMaterial ? (cached.clone() as MeshStandardMaterial) : null;
  }

  /** Kicks off an async material load (if needed), rebuilding the surface once it lands. */
  private ensureReflectiveSurfaceMaterial(index: number, materialId: string | null): void {
    if (!materialId || this.materialCache.has(materialId)) return;
    void this.ensureMaterialLoaded(materialId).then(
      () => this.rebuildReflectiveSurfaceObject(index),
      () => undefined,
    );
  }

  /** Rebuilds every reflective surface from `layout.reflectiveSurfaces` (used on load). */
  private buildReflectiveSurfaces(): void {
    for (const surface of this.reflectiveSurfaceObjects) {
      this.scene.remove(surface);
      disposeReflectiveSurfaceObject(surface);
    }
    this.reflectiveSurfaceObjects = [];
    const surfaces = this.layout?.reflectiveSurfaces ?? [];
    surfaces.forEach((actor, index) => {
      const item = this.reflectiveSurfaceItem(actor);
      const surface = createReflectiveSurfaceObject(item, this.reflectiveSurfaceMaterial(item.material));
      surface.userData.reflectiveSurfaceIndex = index;
      this.reflectiveSurfaceObjects.push(surface);
      this.scene.add(surface);
      this.ensureReflectiveSurfaceMaterial(index, item.material);
    });
  }

  /** Cheap transform/visibility/live-param sync for one surface (gizmo drag). */
  private refreshReflectiveSurfaceObject(index: number): void {
    const actor = this.layout?.reflectiveSurfaces?.[index];
    const surface = this.reflectiveSurfaceObjects[index];
    if (!actor || !surface) return;
    applyReflectiveSurfaceTransform(surface, this.reflectiveSurfaceItem(actor));
  }

  /** Recreates one surface (needed when material or resolution changes — baked at build). */
  private rebuildReflectiveSurfaceObject(index: number): void {
    const old = this.reflectiveSurfaceObjects[index];
    if (old) {
      this.scene.remove(old);
      disposeReflectiveSurfaceObject(old);
    }
    const actor = this.layout?.reflectiveSurfaces?.[index];
    if (!actor) return;
    const item = this.reflectiveSurfaceItem(actor);
    const surface = createReflectiveSurfaceObject(item, this.reflectiveSurfaceMaterial(item.material));
    surface.userData.reflectiveSurfaceIndex = index;
    this.reflectiveSurfaceObjects[index] = surface;
    this.scene.add(surface);
    this.ensureReflectiveSurfaceMaterial(index, item.material);
  }

  private refreshReflectiveSurfaceIndices(): void {
    this.reflectiveSurfaceObjects.forEach((surface, index) => {
      surface.userData.reflectiveSurfaceIndex = index;
    });
  }

  private insertReflectiveSurface(index: number, actor: LayoutReflectiveSurface): void {
    if (!this.layout) return;
    this.layout.reflectiveSurfaces ??= [];
    const insertionIndex = clampIndex(index, this.layout.reflectiveSurfaces.length);
    this.layout.reflectiveSurfaces.splice(insertionIndex, 0, cloneReflectiveSurface(actor));
    const item = this.reflectiveSurfaceItem(actor);
    const surface = createReflectiveSurfaceObject(item, this.reflectiveSurfaceMaterial(item.material));
    this.reflectiveSurfaceObjects.splice(insertionIndex, 0, surface);
    this.scene.add(surface);
    this.refreshReflectiveSurfaceIndices();
    this.ensureReflectiveSurfaceMaterial(insertionIndex, item.material);
  }

  private removeReflectiveSurfaceAt(index: number): LayoutReflectiveSurface | null {
    if (!this.layout?.reflectiveSurfaces) return null;
    const [removed] = this.layout.reflectiveSurfaces.splice(index, 1);
    const [surface] = this.reflectiveSurfaceObjects.splice(index, 1);
    if (surface) {
      this.scene.remove(surface);
      disposeReflectiveSurfaceObject(surface);
    }
    this.refreshReflectiveSurfaceIndices();
    return removed ? cloneReflectiveSurface(removed) : null;
  }

  /** Adds a Reflective Surface actor (flat floor by default) and selects it. */
  addReflectiveSurface(): void {
    if (!this.layout) return;
    const surfaces = this.layout.reflectiveSurfaces ?? [];
    const actor: LayoutReflectiveSurface = {
      id: uniqueReflectiveSurfaceId(surfaces),
      name: uniqueReflectiveSurfaceName("Reflective Surface", surfaces),
      position: [0, 0.01, 0],
      rotation: [-90, 0, 0],
      scale: [4, 4, 1],
    };
    const index = surfaces.length;
    this.executeCommand({
      label: "Add Reflective Surface",
      redo: () => {
        this.insertReflectiveSurface(index, actor);
        this.select({ kind: "reflectiveSurface", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.removeReflectiveSurfaceAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Added Reflective Surface.", "info");
  }

  /** Removes a Reflective Surface actor (undoable). */
  removeReflectiveSurface(index: number): void {
    const actor = this.layout?.reflectiveSurfaces?.[index];
    if (!actor) return;
    const snapshot = cloneReflectiveSurface(actor);
    this.executeCommand({
      label: "Delete Reflective Surface",
      redo: () => {
        this.removeReflectiveSurfaceAt(index);
        if (this.selection?.kind === "reflectiveSurface") this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.insertReflectiveSurface(index, snapshot);
        this.select({ kind: "reflectiveSurface", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
  }

  /**
   * Applies a partial property edit to a reflective surface as one undoable command.
   * Material + resolution are baked into the object (render target / patched material),
   * so those rebuild it; the fresnel/strength/distortion/tint params are live uniforms
   * and only need a cheap refresh. Transform/name/hidden flow through the generic
   * selection pipeline.
   */
  setReflectiveSurface(
    index: number,
    patch: {
      material?: string | null;
      reflectionStrength?: number;
      fresnelPower?: number;
      fresnelBias?: number;
      distortion?: number;
      tint?: string;
      resolution?: number | undefined;
    },
    label = "Edit Reflective Surface",
  ): void {
    const actor = this.layout?.reflectiveSurfaces?.[index];
    if (!actor) return;
    const previous = cloneReflectiveSurface(actor);
    const next = cloneReflectiveSurface(actor);
    if ("material" in patch) {
      if (patch.material === null || patch.material === undefined) delete next.material;
      else next.material = patch.material;
    }
    if (patch.reflectionStrength !== undefined) next.reflectionStrength = patch.reflectionStrength;
    if (patch.fresnelPower !== undefined) next.fresnelPower = patch.fresnelPower;
    if (patch.fresnelBias !== undefined) next.fresnelBias = patch.fresnelBias;
    if (patch.distortion !== undefined) next.distortion = patch.distortion;
    if (patch.tint !== undefined) next.tint = patch.tint;
    if ("resolution" in patch) {
      if (patch.resolution === undefined) delete next.resolution;
      else next.resolution = patch.resolution;
    }

    const needsRebuild = "material" in patch || "resolution" in patch;
    const apply = (value: LayoutReflectiveSurface): void => {
      if (!this.layout?.reflectiveSurfaces?.[index]) return;
      this.layout.reflectiveSurfaces[index] = cloneReflectiveSurface(value);
      if (needsRebuild) this.rebuildReflectiveSurfaceObject(index);
      else this.refreshReflectiveSurfaceObject(index);
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(next),
      undo: () => apply(previous),
    });
  }

  /** Edits the currently selected reflective surface's params (Details panel). */
  setSelectedReflectiveSurface(patch: {
    material?: string | null;
    reflectionStrength?: number;
    fresnelPower?: number;
    fresnelBias?: number;
    distortion?: number;
    tint?: string;
    resolution?: number | undefined;
  }): void {
    if (this.selection?.kind !== "reflectiveSurface") return;
    this.setReflectiveSurface(this.selection.index, patch);
  }

  // --- Blocking Volume (parametric blockout brush) actors -------------------

  /** Resolved brush settings + world transform for a blocking-volume layout actor. */
  private blockingVolumeItem(actor: LayoutBlockingVolume): BlockingVolumeRenderItem {
    return {
      ...resolveBlockingVolume(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      scale: readScale(actor),
    };
  }

  /** Rebuilds every brush object from `layout.blockingVolumes` (used on load). */
  private buildBlockingVolumes(): void {
    for (const object of this.blockingVolumeObjects) {
      this.scene.remove(object);
      disposeBlockingVolumeObject(object);
    }
    this.blockingVolumeObjects = [];
    const volumes = this.layout?.blockingVolumes ?? [];
    volumes.forEach((actor, index) => {
      const object = createBlockingVolumeObject(this.blockingVolumeItem(actor));
      object.userData.blockingVolumeIndex = index;
      this.blockingVolumeObjects.push(object);
      this.scene.add(object);
    });
  }

  /** Cheap transform/visibility sync for one brush (gizmo drag / Details transform). */
  private refreshBlockingVolumeObject(index: number): void {
    const actor = this.layout?.blockingVolumes?.[index];
    const object = this.blockingVolumeObjects[index];
    if (!actor || !object) return;
    applyBlockingVolumeTransform(object, this.blockingVolumeItem(actor));
  }

  /** Recreates one brush (needed when shape/size/color change — baked into geometry). */
  private rebuildBlockingVolumeObject(index: number): void {
    const old = this.blockingVolumeObjects[index];
    if (old) {
      this.scene.remove(old);
      disposeBlockingVolumeObject(old);
    }
    const actor = this.layout?.blockingVolumes?.[index];
    if (!actor) return;
    const object = createBlockingVolumeObject(this.blockingVolumeItem(actor));
    object.userData.blockingVolumeIndex = index;
    this.blockingVolumeObjects[index] = object;
    this.scene.add(object);
  }

  private refreshBlockingVolumeIndices(): void {
    this.blockingVolumeObjects.forEach((object, index) => {
      object.userData.blockingVolumeIndex = index;
    });
  }

  private insertBlockingVolume(index: number, actor: LayoutBlockingVolume): void {
    if (!this.layout) return;
    this.layout.blockingVolumes ??= [];
    const insertionIndex = clampIndex(index, this.layout.blockingVolumes.length);
    this.layout.blockingVolumes.splice(insertionIndex, 0, cloneBlockingVolume(actor));
    const object = createBlockingVolumeObject(this.blockingVolumeItem(actor));
    this.blockingVolumeObjects.splice(insertionIndex, 0, object);
    this.scene.add(object);
    this.refreshBlockingVolumeIndices();
  }

  private removeBlockingVolumeAt(index: number): LayoutBlockingVolume | null {
    if (!this.layout?.blockingVolumes) return null;
    const [removed] = this.layout.blockingVolumes.splice(index, 1);
    const [object] = this.blockingVolumeObjects.splice(index, 1);
    if (object) {
      this.scene.remove(object);
      disposeBlockingVolumeObject(object);
    }
    this.refreshBlockingVolumeIndices();
    return removed ? cloneBlockingVolume(removed) : null;
  }

  /** Adds a Blocking Volume actor (default box brush) and selects it. */
  addBlockingVolume(position: Vec3 = [0, 1, 0]): void {
    if (!this.layout) return;
    const volumes = this.layout.blockingVolumes ?? [];
    const actor: LayoutBlockingVolume = {
      id: uniqueBlockingVolumeId(volumes),
      name: uniqueBlockingVolumeName("Blocking Volume", volumes),
      position: [...position],
    };
    const index = volumes.length;
    this.executeCommand({
      label: "Add Blocking Volume",
      redo: () => {
        this.insertBlockingVolume(index, actor);
        this.select({ kind: "blockingVolume", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.removeBlockingVolumeAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Added Blocking Volume.", "info");
  }

  /** Removes a Blocking Volume actor (undoable). */
  removeBlockingVolume(index: number): void {
    const actor = this.layout?.blockingVolumes?.[index];
    if (!actor) return;
    const snapshot = cloneBlockingVolume(actor);
    this.executeCommand({
      label: "Delete Blocking Volume",
      redo: () => {
        this.removeBlockingVolumeAt(index);
        if (this.selection?.kind === "blockingVolume") this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.insertBlockingVolume(index, snapshot);
        this.select({ kind: "blockingVolume", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
  }

  /**
   * Applies a partial brush-settings edit (shape/size/renderInGame/color) to a
   * blocking volume as one undoable command. Shape/size/color are baked into the
   * geometry, so they rebuild the object; `renderInGame` only affects Play and
   * needs no editor re-sync. Transform/name/hidden flow through the generic
   * selection pipeline.
   */
  setBlockingVolume(
    index: number,
    patch: {
      brushShape?: LayoutBlockingVolume["brushShape"];
      size?: Vec3;
      brushSides?: number;
      renderInGame?: boolean;
      color?: string;
    },
    label = "Edit Blocking Volume",
  ): void {
    const actor = this.layout?.blockingVolumes?.[index];
    if (!actor) return;
    const previous = cloneBlockingVolume(actor);
    const next = cloneBlockingVolume(actor);
    if (patch.brushShape !== undefined) next.brushShape = patch.brushShape;
    if (patch.size !== undefined) next.size = [...patch.size];
    if (patch.brushSides !== undefined) next.brushSides = clampBrushSides(patch.brushSides);
    if (patch.renderInGame !== undefined) next.renderInGame = patch.renderInGame;
    if (patch.color !== undefined) next.color = patch.color;

    // Keep `size` canonical for its shape so the brush and its collider (both read
    // `size`) stay consistent — a shape switch reinterprets the existing extents.
    const resolvedShape = next.brushShape ?? BLOCKING_VOLUME_DEFAULTS.brushShape;
    const resolvedSize = next.size ?? [...BLOCKING_VOLUME_DEFAULTS.size];
    next.size = canonicalBrushSize(resolvedShape, resolvedSize);

    const needsRebuild =
      patch.brushShape !== undefined ||
      patch.size !== undefined ||
      patch.brushSides !== undefined ||
      patch.color !== undefined;
    const apply = (value: LayoutBlockingVolume): void => {
      if (!this.layout?.blockingVolumes?.[index]) return;
      this.layout.blockingVolumes[index] = cloneBlockingVolume(value);
      if (needsRebuild) {
        this.rebuildBlockingVolumeObject(index);
        // The rebuild swaps in a fresh three.js object, so the selection outline
        // and gizmo must re-anchor to it (otherwise they keep glowing the old,
        // disposed brush and the new shape looks like it "didn't apply").
        if (this.selection?.kind === "blockingVolume" && this.selection.index === index) {
          this.updateSelectionBox();
          this.updateGizmo();
        }
      } else {
        this.refreshBlockingVolumeObject(index);
      }
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(next),
      undo: () => apply(previous),
    });
  }

  /** Edits the currently selected blocking volume's brush settings (Details panel). */
  setSelectedBlockingVolume(patch: {
    brushShape?: LayoutBlockingVolume["brushShape"];
    size?: Vec3;
    brushSides?: number;
    renderInGame?: boolean;
    color?: string;
  }): void {
    if (this.selection?.kind !== "blockingVolume") return;
    this.setBlockingVolume(this.selection.index, patch);
  }

  // --- AI Navigation Volume actors -----------------------------------------

  private aiNavigationVolumeItem(actor: LayoutAiNavigationVolume): AiNavigationVolumeRenderItem {
    return {
      ...resolveAiNavigationVolume(actor),
      position: [...actor.position],
      rotation: actor.rotation ? [...actor.rotation] : [0, 0, 0],
      scale: readVolumeScale(actor.scale),
    };
  }

  private buildAiNavigationVolumes(): void {
    for (const object of this.aiNavigationVolumeObjects) {
      this.scene.remove(object);
      disposeAiNavigationVolumeObject(object);
    }
    this.aiNavigationVolumeObjects = [];
    const volumes = this.layout?.aiNavigationVolumes ?? [];
    volumes.forEach((actor, index) => {
      const object = createAiNavigationVolumeObject(this.aiNavigationVolumeItem(actor));
      object.userData.aiNavigationVolumeIndex = index;
      this.aiNavigationVolumeObjects.push(object);
      this.scene.add(object);
    });
    this.updateAiNavigationView();
  }

  private refreshAiNavigationVolumeObject(index: number): void {
    const actor = this.layout?.aiNavigationVolumes?.[index];
    const object = this.aiNavigationVolumeObjects[index];
    if (!actor || !object) return;
    applyAiNavigationVolumeTransform(object, this.aiNavigationVolumeItem(actor));
  }

  private rebuildAiNavigationVolumeObject(index: number): void {
    const old = this.aiNavigationVolumeObjects[index];
    if (old) {
      this.scene.remove(old);
      disposeAiNavigationVolumeObject(old);
    }
    const actor = this.layout?.aiNavigationVolumes?.[index];
    if (!actor) return;
    const object = createAiNavigationVolumeObject(this.aiNavigationVolumeItem(actor));
    object.userData.aiNavigationVolumeIndex = index;
    this.aiNavigationVolumeObjects[index] = object;
    this.scene.add(object);
  }

  private refreshAiNavigationVolumeIndices(): void {
    this.aiNavigationVolumeObjects.forEach((object, index) => {
      object.userData.aiNavigationVolumeIndex = index;
    });
  }

  private insertAiNavigationVolume(index: number, actor: LayoutAiNavigationVolume): void {
    if (!this.layout) return;
    this.layout.aiNavigationVolumes ??= [];
    const insertionIndex = clampIndex(index, this.layout.aiNavigationVolumes.length);
    this.layout.aiNavigationVolumes.splice(insertionIndex, 0, cloneAiNavigationVolume(actor));
    const object = createAiNavigationVolumeObject(this.aiNavigationVolumeItem(actor));
    this.aiNavigationVolumeObjects.splice(insertionIndex, 0, object);
    this.scene.add(object);
    this.refreshAiNavigationVolumeIndices();
    this.updateAiNavigationView();
  }

  private removeAiNavigationVolumeAt(index: number): LayoutAiNavigationVolume | null {
    if (!this.layout?.aiNavigationVolumes) return null;
    const [removed] = this.layout.aiNavigationVolumes.splice(index, 1);
    const [object] = this.aiNavigationVolumeObjects.splice(index, 1);
    if (object) {
      this.scene.remove(object);
      disposeAiNavigationVolumeObject(object);
    }
    this.refreshAiNavigationVolumeIndices();
    this.updateAiNavigationView();
    return removed ? cloneAiNavigationVolume(removed) : null;
  }

  /** Adds an AI Navigation Volume actor and selects it. */
  addAiNavigationVolume(position: Vec3 = [0, 2, 0]): void {
    if (!this.layout) return;
    const volumes = this.layout.aiNavigationVolumes ?? [];
    const actor: LayoutAiNavigationVolume = {
      id: uniqueAiNavigationVolumeId(volumes),
      name: uniqueAiNavigationVolumeName("AI Navigation Volume", volumes),
      position: [...position],
      size: [10, 4, 10],
    };
    const index = volumes.length;
    this.executeCommand({
      label: "Add AI Navigation Volume",
      redo: () => {
        this.insertAiNavigationVolume(index, actor);
        this.select({ kind: "aiNavigationVolume", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.removeAiNavigationVolumeAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Added AI Navigation Volume.", "info");
  }

  /** Removes an AI Navigation Volume actor (undoable). */
  removeAiNavigationVolume(index: number): void {
    const actor = this.layout?.aiNavigationVolumes?.[index];
    if (!actor) return;
    const snapshot = cloneAiNavigationVolume(actor);
    this.executeCommand({
      label: "Delete AI Navigation Volume",
      redo: () => {
        this.removeAiNavigationVolumeAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.insertAiNavigationVolume(index, snapshot);
        this.select({ kind: "aiNavigationVolume", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Deleted AI Navigation Volume.", "info");
  }

  setAiNavigationVolume(
    index: number,
    patch: { size?: Vec3; agentRadius?: number; clearancePadding?: number },
    label = "Edit AI Navigation Volume",
  ): void {
    const actor = this.layout?.aiNavigationVolumes?.[index];
    if (!actor) return;
    const previous = cloneAiNavigationVolume(actor);
    const next = cloneAiNavigationVolume(actor);
    if (patch.size) next.size = [...patch.size];
    if (patch.agentRadius !== undefined) next.agentRadius = saneAiNavPreviewNumber(patch.agentRadius, AI_NAV_DEBUG_DEFAULT_AGENT_RADIUS);
    if (patch.clearancePadding !== undefined) {
      next.clearancePadding = saneAiNavPreviewNumber(patch.clearancePadding, AI_NAV_DEBUG_DEFAULT_CLEARANCE_PADDING);
    }
    const needsRebuild = patch.size !== undefined;
    const apply = (value: LayoutAiNavigationVolume): void => {
      if (!this.layout?.aiNavigationVolumes?.[index]) return;
      this.layout.aiNavigationVolumes[index] = cloneAiNavigationVolume(value);
      if (needsRebuild) this.rebuildAiNavigationVolumeObject(index);
      else this.refreshAiNavigationVolumeObject(index);
      this.updateAiNavigationView();
      if (this.selection?.kind === "aiNavigationVolume" && this.selection.index === index) {
        this.updateSelectionBox();
        this.updateGizmo();
      }
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label,
      redo: () => apply(next),
      undo: () => apply(previous),
    });
  }

  setSelectedAiNavigationVolume(patch: { size?: Vec3; agentRadius?: number; clearancePadding?: number }): void {
    if (this.selection?.kind !== "aiNavigationVolume") return;
    this.setAiNavigationVolume(this.selection.index, patch);
  }

  // --- Target Point actors --------------------------------------------------

  // --- Generic Spline actors ------------------------------------------------

  private splineActorWorldMatrix(actor: LayoutSplineActor): Matrix4 {
    const transform = new Object3D();
    transform.position.set(...actor.position);
    applyEulerDegrees(transform, readRotation(actor));
    transform.scale.set(...readScale(actor));
    transform.updateMatrix();
    return transform.matrix.clone();
  }

  /** Default Hermite tangent used when switching a point into Curve Custom mode. */
  private autoSplinePointTangent(actor: LayoutSplineActor, index: number): Vec3 {
    const points = actor.spline.points;
    const point = points[index];
    if (!point || points.length < 2) return [1, 0, 0];
    const subtract = (left: Vec3, right: Vec3): Vec3 => [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
    if (actor.spline.closed) {
      const previous = points[(index - 1 + points.length) % points.length]!.position;
      const next = points[(index + 1) % points.length]!.position;
      const direction = subtract(next, previous);
      return [direction[0] * 0.5, direction[1] * 0.5, direction[2] * 0.5];
    }
    if (index === 0) return subtract(points[1]!.position, point.position);
    if (index === points.length - 1) return subtract(point.position, points[index - 1]!.position);
    const direction = subtract(points[index + 1]!.position, points[index - 1]!.position);
    return [direction[0] * 0.5, direction[1] * 0.5, direction[2] * 0.5];
  }

  private splinePointTangents(actor: LayoutSplineActor, pointId: string): { arrive: Vec3; leave: Vec3 } | null {
    const index = actor.spline.points.findIndex((point) => point.id === pointId);
    const point = actor.spline.points[index];
    if (!point || point.pointType !== "curveCustom") return null;
    const fallback = this.autoSplinePointTangent(actor, index);
    return {
      arrive: point.arriveTangent ? [...point.arriveTangent] : fallback,
      leave: point.leaveTangent ? [...point.leaveTangent] : fallback,
    };
  }

  private clearSplinePointOverlay(): void {
    const overlay = this.splinePointOverlay;
    this.splinePointOverlay = null;
    if (!overlay) return;
    this.scene.remove(overlay);
    overlay.traverse((child) => {
      const drawable = child as Mesh<BufferGeometry, MeshBasicMaterial | LineBasicMaterial | SpriteMaterial>;
      drawable.geometry?.dispose();
      drawable.material?.dispose();
      if (drawable.material instanceof SpriteMaterial) drawable.material.map?.dispose();
    });
  }

  /** Rebuilds lightweight point markers only while a generic Spline Actor is selected. */
  private refreshSplinePointOverlay(): void {
    this.clearSplinePointOverlay();
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.hidden) return;
    const overlay = new Group();
    overlay.name = "spline-point-overlay";
    overlay.matrixAutoUpdate = false;
    overlay.matrix.copy(this.splineActorWorldMatrix(actor));
    overlay.matrixWorldNeedsUpdate = true;
    const markerGeometry = new SphereGeometry(0.16, 12, 8);
    for (const point of actor.spline.points) {
      const marker = new Mesh(
        markerGeometry.clone(),
        new MeshBasicMaterial({
          color: point.id === this.activeSplinePointId ? 0xffd166 : 0x4fd1ff,
          depthTest: false,
          depthWrite: false,
        }),
      );
      marker.position.set(...point.position);
      marker.renderOrder = 30;
      marker.raycast = () => {};
      overlay.add(marker);
      if (resolveSplineActorDebug(actor).showPointIds) {
        const label = this.createSplinePointLabel(`${actor.spline.points.indexOf(point) + 1}: ${point.id}`);
        label.position.set(point.position[0], point.position[1] + 0.35, point.position[2]);
        overlay.add(label);
      }
    }
    const activePoint = this.activeSplinePointId
      ? actor.spline.points.find((point) => point.id === this.activeSplinePointId)
      : null;
    const tangents = activePoint ? this.splinePointTangents(actor, activePoint.id) : null;
    if (activePoint && tangents) {
      const position = activePoint.position;
      const arriveHandle: Vec3 = [position[0] - tangents.arrive[0], position[1] - tangents.arrive[1], position[2] - tangents.arrive[2]];
      const leaveHandle: Vec3 = [position[0] + tangents.leave[0], position[1] + tangents.leave[1], position[2] + tangents.leave[2]];
      const lineGeometry = new BufferGeometry();
      lineGeometry.setAttribute("position", new Float32BufferAttribute([...arriveHandle, ...position, ...leaveHandle], 3));
      const line = new LineSegments(lineGeometry, new LineBasicMaterial({ color: 0xff9f43, depthTest: false, depthWrite: false }));
      line.renderOrder = 29;
      overlay.add(line);
      for (const [handle, handlePosition] of [["arrive", arriveHandle], ["leave", leaveHandle]] as const) {
        const marker = new Mesh(
          new SphereGeometry(0.12, 10, 8),
          new MeshBasicMaterial({ color: this.activeSplineTangent === handle ? 0xffffff : 0xff9f43, depthTest: false, depthWrite: false }),
        );
        marker.position.set(...handlePosition);
        marker.renderOrder = 31;
        marker.raycast = () => {};
        overlay.add(marker);
      }
    }
    this.splinePointOverlay = overlay;
    this.scene.add(overlay);
  }

  private createSplinePointLabel(text: string): Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 48;
    const context = canvas.getContext("2d")!;
    context.font = "bold 24px sans-serif";
    context.fillStyle = "rgba(8, 18, 30, 0.82)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillText(text, 8, 32);
    const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false, depthWrite: false }));
    sprite.scale.set(1.9, 0.36, 1);
    sprite.renderOrder = 32;
    return sprite;
  }

  /** Screen-space marker hit-test keeps spline points out of normal actor picking. */
  private pickSplinePoint(clientX: number, clientY: number): { pointId: string; handle: SplinePointGizmoTarget["handle"] } | null {
    if (this.selection?.kind !== "spline") return null;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.hidden || actor.locked) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const matrix = this.splineActorWorldMatrix(actor);
    const camera = this.editorViewportCamera();
    const pointer = new Vector3(clientX - rect.left, clientY - rect.top, 0);
    const projected = new Vector3();
    const best: { value: { pointId: string; handle: SplinePointGizmoTarget["handle"]; distance: number } | null } = { value: null };
    const consider = (pointId: string, handle: SplinePointGizmoTarget["handle"], position: Vec3): void => {
      projected.set(...position).applyMatrix4(matrix).project(camera);
      if (projected.z < -1 || projected.z > 1) return;
      const distance = Math.hypot(
        (projected.x * 0.5 + 0.5) * rect.width - pointer.x,
        (-projected.y * 0.5 + 0.5) * rect.height - pointer.y,
      );
      if (distance <= 14 && (!best.value || distance < best.value.distance)) best.value = { pointId, handle, distance };
    };
    for (const point of actor.spline.points) {
      consider(point.id, "point", point.position);
      const tangents = point.id === this.activeSplinePointId ? this.splinePointTangents(actor, point.id) : null;
      if (tangents) {
        consider(point.id, "arrive", [point.position[0] - tangents.arrive[0], point.position[1] - tangents.arrive[1], point.position[2] - tangents.arrive[2]]);
        consider(point.id, "leave", [point.position[0] + tangents.leave[0], point.position[1] + tangents.leave[1], point.position[2] + tangents.leave[2]]);
      }
    }
    return best.value ? { pointId: best.value.pointId, handle: best.value.handle } : null;
  }

  private activeSplinePoint(): SplinePointGizmoTarget | null {
    if (this.selection?.kind !== "spline" || !this.activeSplinePointId) return null;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return null;
    const point = actor.spline.points.find((entry) => entry.id === this.activeSplinePointId);
    if (!point) return null;
    const worldMatrix = this.splineActorWorldMatrix(actor);
    return {
      index: this.selection.index,
      pointId: point.id,
      handle: this.activeSplineTangent ?? "point",
      actor,
      world: new Vector3(...this.splinePointHandlePosition(actor, point.id, this.activeSplineTangent ?? "point")).applyMatrix4(worldMatrix),
      worldMatrix,
    };
  }

  private splinePointHandlePosition(actor: LayoutSplineActor, pointId: string, handle: SplinePointGizmoTarget["handle"]): Vec3 {
    const point = actor.spline.points.find((entry) => entry.id === pointId);
    if (!point || handle === "point") return point ? [...point.position] : [0, 0, 0];
    const tangents = this.splinePointTangents(actor, pointId);
    const tangent = tangents?.[handle] ?? [0, 0, 0];
    return handle === "arrive"
      ? [point.position[0] - tangent[0], point.position[1] - tangent[1], point.position[2] - tangent[2]]
      : [point.position[0] + tangent[0], point.position[1] + tangent[1], point.position[2] + tangent[2]];
  }

  private buildSplines(): void {
    this.clearSplinePointOverlay();
    for (const object of this.splineObjects) {
      this.scene.remove(object);
      disposeSplineObject(object);
    }
    this.splineObjects = [];
    this.clearSplineGeneratedGroups();
    for (const actor of this.layout?.splines ?? []) {
      const object = createSplineObject(actor);
      object.userData.splineIndex = this.splineObjects.length;
      this.splineObjects.push(object);
      this.scene.add(object);
    }
    for (let index = 0; index < this.splineObjects.length; index += 1) this.rebuildSplineGeneratedGroup(index);
  }

  private insertSpline(index: number, actor: LayoutSplineActor): void {
    if (!this.layout) return;
    this.clearSplineGeneratorPreviewTimers();
    this.splineGeneratorBuildStats.clear();
    this.layout.splines ??= [];
    const insertionIndex = clampIndex(index, this.layout.splines.length);
    const snapshot = cloneSplineActor(actor);
    this.layout.splines.splice(insertionIndex, 0, snapshot);
    const object = createSplineObject(snapshot);
    object.userData.splineIndex = insertionIndex;
    this.splineObjects.splice(insertionIndex, 0, object);
    this.splineGeneratedGroups.splice(insertionIndex, 0, null);
    this.scene.add(object);
    this.rebuildSplineGeneratedGroup(insertionIndex);
    this.refreshSplineIndices();
  }

  private refreshSplineIndices(): void {
    this.splineObjects.forEach((object, index) => {
      object.userData.splineIndex = index;
    });
  }

  private removeSplineAt(index: number): LayoutSplineActor | null {
    if (!this.layout?.splines) return null;
    this.clearSplineGeneratorPreviewTimers();
    this.splineGeneratorBuildStats.clear();
    const [removed] = this.layout.splines.splice(index, 1);
    const [object] = this.splineObjects.splice(index, 1);
    if (object) {
      this.scene.remove(object);
      disposeSplineObject(object);
    }
    const [generated] = this.splineGeneratedGroups.splice(index, 1);
    if (generated) disposeSplineGeneratedGroup(generated);
    this.refreshSplineIndices();
    return removed ? cloneSplineActor(removed) : null;
  }

  /** Adds a level-owned generic Spline Actor with its default two control points. */
  addSpline(position: Vec3 = [0, 0, 0]): void {
    if (!this.layout) return;
    const actor = createDefaultSplineActor(this.layout.splines ?? []);
    actor.position = [...position];
    const index = (this.layout.splines ?? []).length;
    this.executeCommand({
      label: "Add Spline",
      redo: () => {
        this.insertSpline(index, actor);
        this.select({ kind: "spline", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.removeSplineAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Added Spline.", "info");
  }

  /** Deletes a generic Spline Actor by index (undoable; selection UI follows next slice). */
  removeSpline(index: number): void {
    const actor = this.layout?.splines?.[index];
    if (!actor) return;
    const snapshot = cloneSplineActor(actor);
    this.executeCommand({
      label: "Delete Spline",
      redo: () => {
        this.removeSplineAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.insertSpline(index, snapshot);
        this.select({ kind: "spline", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
  }

  /** Rebuilds an actor's sampled debug line after a future point/details edit. */
  refreshSpline(index: number, generationQuality: "preview" | "full" = "full", dirtySegments?: readonly number[]): void {
    const actor = this.layout?.splines?.[index];
    const object = this.splineObjects[index];
    if (actor && object) updateSplineObject(object, actor);
    this.scheduleSplineGeneratedPreviewRebuild(index, generationQuality, dirtySegments);
    this.refreshSplinePointOverlay();
  }

  private clearSplineGeneratedGroups(): void {
    for (const group of this.splineGeneratedGroups) if (group) disposeSplineGeneratedGroup(group);
    this.splineGeneratedGroups = [];
    this.splineGeneratorBuildStats.clear();
  }

  private clearSplineGeneratorPreviewTimers(): void {
    for (const timer of this.splineGeneratorPreviewTimers.values()) clearTimeout(timer);
    this.splineGeneratorPreviewTimers.clear();
    this.splineGeneratorDirtySegments.clear();
  }

  /** Keep line/point feedback immediate while avoiding InstancedMesh rebuilds on every drag event. */
  private scheduleSplineGeneratedPreviewRebuild(index: number, quality: "preview" | "full" = "full", dirtySegments?: readonly number[]): void {
    if (quality === "preview" && dirtySegments?.length) {
      const pending = this.splineGeneratorDirtySegments.get(index) ?? new Set<number>();
      dirtySegments.forEach((segment) => pending.add(segment));
      this.splineGeneratorDirtySegments.set(index, pending);
    }
    const previous = this.splineGeneratorPreviewTimers.get(index);
    if (previous) clearTimeout(previous);
    this.splineGeneratorPreviewTimers.set(index, setTimeout(() => {
      this.splineGeneratorPreviewTimers.delete(index);
      const dirty = this.splineGeneratorDirtySegments.get(index);
      this.splineGeneratorDirtySegments.delete(index);
      if (quality === "preview" && dirty?.size && this.rebuildSplineGeneratedDirtySegments(index, dirty)) return;
      this.rebuildSplineGeneratedGroup(index, quality);
    }, 80));
  }

  /** Rebuilds only this spline's generated preview. Full quality is committed after point drags. */
  private rebuildSplineGeneratedGroup(index: number, quality: "preview" | "full" = "full"): void {
    if (quality === "full") {
      const pending = this.splineGeneratorPreviewTimers.get(index);
      if (pending) clearTimeout(pending);
      this.splineGeneratorPreviewTimers.delete(index);
      this.splineGeneratorDirtySegments.delete(index);
    }
    const previous = this.splineGeneratedGroups[index];
    if (previous) disposeSplineGeneratedGroup(previous);
    this.splineGeneratedGroups[index] = null;
    const actor = this.layout?.splines?.[index];
    if (!actor) return;
    const startedAt = performance.now();
    const built = buildSplineInstanceGeneratorGroup({
      actor,
      mode: "editor",
      deformQuality: quality,
      models: this.models,
      castShadow: this.staticObjectsCastShadow(),
      receiveShadow: this.staticObjectsReceiveShadow(),
      applyMaterialSlots: (assetId, group) => {
        const slots = this.resolveAssetMaterialSlots(assetId);
        if (slots) applyMaterialSlotOverrides(group, slots, (materialId) => this.materialCache.get(materialId));
      },
    });
    if (!built) {
      this.splineGeneratorBuildStats.set(index, { triangleCount: 0, rebuildMs: performance.now() - startedAt, preview: quality === "preview", warnings: [] });
      return;
    }
    this.splineGeneratorBuildStats.set(index, {
      triangleCount: built.triangleCount,
      rebuildMs: performance.now() - startedAt,
      preview: quality === "preview",
      warnings: built.warnings,
    });
    if (built.missingAssetIds.length > 0) {
      this.onStatus?.(`Spline generator mesh missing: ${built.missingAssetIds.join(", ")}`, "warning");
    }
    if (!built.group) return;
    built.group.userData.splineIndex = index;
    this.scene.add(built.group);
    this.splineGeneratedGroups[index] = built.group;
  }

  /** Replaces only mesh chunks adjacent to a moved point. Other generator types retain full rebuild semantics. */
  private rebuildSplineGeneratedDirtySegments(index: number, dirtySegments: ReadonlySet<number>): boolean {
    const actor = this.layout?.splines?.[index];
    const outer = this.splineGeneratedGroups[index];
    if (!actor || !outer) return false;
    const generators = normalizeSplineGenerators(actor.generators);
    const deformGenerators = generators.filter((definition) => definition.type === "deformMesh").map(resolveSplineDeformMeshGenerator)
      .filter((definition) => definition.enabled && definition.previewEnabled && definition.geometryMode === "segments" && Boolean(definition.meshAsset));
    if (deformGenerators.length === 0 || generators.some((definition) => (definition.type === "instances" || definition.type === "rigidSegments") && definition.enabled && definition.previewEnabled)) return false;
    const cache = buildSplineCurveCache(actor.spline);
    const segmentIndices = [...dirtySegments].filter((segmentIndex) => cache.segments.some((segment) => segment.index === segmentIndex));
    if (segmentIndices.length === 0) return false;
    const startedAt = performance.now();
    const warnings: string[] = [];
    for (const generator of deformGenerators) {
      const gltf = this.models.get(generator.meshAsset);
      if (!gltf) return false;
      for (const segmentIndex of segmentIndices) {
        const old = outer.children.find((child) => child.userData.splineGeneratorId === generator.id && child.userData.splineSegmentIndex === segmentIndex);
        if (old instanceof Group) disposeSplineGeneratedGroup(old);
        const built = buildSplineDeformMeshGroup({
          actor,
          gltf,
          definition: { ...generator, sampleSteps: Math.min(generator.sampleSteps, 4) },
          segmentIndex,
          castShadow: this.staticObjectsCastShadow(),
          receiveShadow: this.staticObjectsReceiveShadow(),
        });
        warnings.push(...built.warnings);
        if (!built.group) continue;
        built.group.traverse((child) => { child.raycast = () => {}; });
        const slots = this.resolveAssetMaterialSlots(generator.meshAsset);
        if (slots) applyMaterialSlotOverrides(built.group, slots, (materialId) => this.materialCache.get(materialId));
        outer.add(built.group);
      }
    }
    this.splineGeneratorBuildStats.set(index, {
      triangleCount: splineGeneratedTriangleCount(outer),
      rebuildMs: performance.now() - startedAt,
      preview: true,
      warnings,
    });
    return true;
  }

  getSelectedSplinePoints(): SplinePointView[] {
    if (this.selection?.kind !== "spline") return [];
    return (this.layout?.splines?.[this.selection.index]?.spline.points ?? []).map((point) => ({
      id: point.id,
      position: [...point.position],
      pointType: point.pointType,
      tangentsLinked: point.tangentsLinked ?? true,
    }));
  }

  getActiveSplinePointId(): string | null {
    return this.activeSplinePointId;
  }

  selectSplinePoint(pointId: string | null): void {
    if (this.selection?.kind !== "spline") return;
    const points = this.layout?.splines?.[this.selection.index]?.spline.points ?? [];
    this.activeSplinePointId = points.some((point) => point.id === pointId) ? pointId : null;
    this.activeSplineTangent = null;
    this.refreshSplinePointOverlay();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  addSelectedSplinePoint(): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    const last = after.spline.points.at(-1);
    const beforeLast = after.spline.points.at(-2);
    const offset: Vec3 = last && beforeLast
      ? [last.position[0] - beforeLast.position[0], last.position[1] - beforeLast.position[1], last.position[2] - beforeLast.position[2]]
      : [4, 0, 0];
    const position: Vec3 = last
      ? [last.position[0] + offset[0], last.position[1] + offset[1], last.position[2] + offset[2]]
      : [0, 0, 0];
    const point: ForgeSplinePoint = { id: uniqueGenericSplinePointId(after.spline.points), position, pointType: "curveAuto" };
    after.spline.points.push(point);
    this.applySelectedSplineSnapshot(actor, after, "Add Spline Point", point.id);
  }

  deleteSelectedSplinePoint(pointId = this.activeSplinePointId): void {
    if (this.selection?.kind !== "spline" || !pointId) return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked || actor.spline.points.length <= 2) return;
    const after = cloneSplineActor(actor);
    const index = after.spline.points.findIndex((point) => point.id === pointId);
    if (index < 0) return;
    after.spline.points.splice(index, 1);
    if (after.spline.points.length < 3) after.spline.closed = false;
    this.applySelectedSplineSnapshot(actor, after, "Delete Spline Point", after.spline.points[Math.max(0, index - 1)]?.id ?? null);
  }

  splitSelectedSplineSegment(segmentIndex?: number): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked || actor.spline.points.length < 2) return;
    const after = cloneSplineActor(actor);
    const segmentCount = after.spline.closed ? after.spline.points.length : after.spline.points.length - 1;
    const index = Math.min(Math.max(0, segmentIndex ?? 0), segmentCount - 1);
    const sample = evaluateSplineSegment(after.spline, index, 0.5);
    const point: ForgeSplinePoint = {
      id: uniqueGenericSplinePointId(after.spline.points),
      position: [...sample.position],
      pointType: "curveAuto",
    };
    after.spline.points.splice(index + 1, 0, point);
    this.applySelectedSplineSnapshot(actor, after, "Split Spline Segment", point.id);
  }

  setSelectedSplinePoint(pointId: string, patch: { position?: Vec3; pointType?: ForgeSplinePoint["pointType"] }): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    const point = after.spline.points.find((entry) => entry.id === pointId);
    if (!point) return;
    if (patch.position) point.position = [...patch.position];
    if (patch.pointType) {
      point.pointType = patch.pointType;
      if (patch.pointType === "curveCustom") {
        const tangent = this.autoSplinePointTangent(after, after.spline.points.indexOf(point));
        point.arriveTangent ??= [...tangent];
        point.leaveTangent ??= [...tangent];
        point.tangentsLinked ??= true;
      }
    }
    this.applySelectedSplineSnapshot(actor, after, "Edit Spline Point", point.id);
  }

  setSelectedSplinePointTangentsLinked(pointId: string, linked: boolean): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    const point = after.spline.points.find((entry) => entry.id === pointId);
    if (!point || point.pointType !== "curveCustom") return;
    const tangent = this.autoSplinePointTangent(after, after.spline.points.indexOf(point));
    point.arriveTangent ??= [...tangent];
    point.leaveTangent ??= [...tangent];
    point.tangentsLinked = linked;
    this.applySelectedSplineSnapshot(actor, after, linked ? "Link Spline Tangents" : "Break Spline Tangents", point.id);
  }

  getSelectedSplineGenerators(): ForgeSplineGeneratorDef[] {
    if (this.selection?.kind !== "spline") return [];
    return normalizeSplineGenerators(this.layout?.splines?.[this.selection.index]?.generators);
  }

  getSelectedSplineGeneratorDiagnostics(): Array<{ generatorId: string; instanceCount: number; triangleCount: number; rebuildMs: number | null; preview: boolean; missingAssetId: string | null; warnings: string[] }> {
    if (this.selection?.kind !== "spline") return [];
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor) return [];
    const index = this.selection.index;
    const build = this.splineGeneratorBuildStats.get(index);
    const group = this.splineGeneratedGroups[index];
    return normalizeSplineGenerators(actor.generators).map((generator) => ({
      generatorId: generator.id,
      instanceCount: generator.type === "instances"
        ? generateSplineInstancePlacements(actor, generator).length
        : generator.type === "rigidSegments"
          ? generateSplineRigidSegmentPlacements(actor, generator).length
          : 1,
      triangleCount: generator.type === "deformMesh"
        ? splineGeneratedTriangleCount(group, generator.id)
        : 0,
      rebuildMs: build?.rebuildMs ?? null,
      preview: build?.preview ?? false,
      missingAssetId: (generator.type === "instances" || generator.type === "rigidSegments" || generator.type === "deformMesh") && generator.meshAsset && !this.models.has(generator.meshAsset) ? generator.meshAsset : null,
      warnings: generator.type === "rigidSegments"
        ? splineRigidSegmentWarnings(actor, generator)
        : generator.type === "deformMesh" ? [...splineDeformMeshWarnings(generator), ...(build?.warnings ?? [])] : [],
    }));
  }

  addSelectedSplineInstanceGenerator(): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    after.generators = [...(after.generators ?? []), createDefaultSplineInstanceGenerator(after.generators ?? [])];
    this.applySelectedSplineGeneratorSnapshot(actor, after, "Add Spline Instance Generator");
  }

  addSelectedSplineRigidSegmentGenerator(): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    after.generators = [...(after.generators ?? []), createDefaultSplineRigidSegmentGenerator(after.generators ?? [])];
    this.applySelectedSplineGeneratorSnapshot(actor, after, "Add Spline Rigid Segment Generator");
  }

  addSelectedSplineDeformMeshGenerator(): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    after.generators = [...(after.generators ?? []), createDefaultSplineDeformMeshGenerator(after.generators ?? [])];
    this.applySelectedSplineGeneratorSnapshot(actor, after, "Add Spline Deform Mesh Generator");
  }

  removeSelectedSplineGenerator(generatorId: string): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    after.generators = (after.generators ?? []).filter((generator) => generator.id !== generatorId);
    this.applySelectedSplineGeneratorSnapshot(actor, after, "Remove Spline Instance Generator");
  }

  setSelectedSplineInstanceGenerator(generatorId: string, patch: Partial<ForgeSplineInstanceGeneratorDef>): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    const index = after.generators?.findIndex((generator) => generator.id === generatorId) ?? -1;
    if (index < 0 || !after.generators) return;
    const previous = after.generators[index]!;
    if (previous.type !== "instances") return;
    const next = { ...previous, ...patch, id: previous.id, type: "instances" as const };
    if (patch.random) next.random = { ...previous.random, ...patch.random };
    after.generators[index] = normalizeSplineGenerators([next])[0]!;
    this.applySelectedSplineGeneratorSnapshot(actor, after, "Edit Spline Instance Generator");
  }

  setSelectedSplineRigidSegmentGenerator(generatorId: string, patch: Partial<ForgeSplineRigidSegmentGeneratorDef>): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    const index = after.generators?.findIndex((generator) => generator.id === generatorId) ?? -1;
    if (index < 0 || !after.generators) return;
    const previous = after.generators[index];
    if (!previous || previous.type !== "rigidSegments") return;
    const next = { ...previous, ...patch, id: previous.id, type: "rigidSegments" as const };
    after.generators[index] = normalizeSplineGenerators([next])[0]!;
    this.applySelectedSplineGeneratorSnapshot(actor, after, "Edit Spline Rigid Segment Generator");
  }

  setSelectedSplineDeformMeshGenerator(generatorId: string, patch: Partial<ForgeSplineDeformMeshGeneratorDef>): void {
    if (this.selection?.kind !== "spline") return;
    const actor = this.layout?.splines?.[this.selection.index];
    if (!actor || actor.locked) return;
    const after = cloneSplineActor(actor);
    const index = after.generators?.findIndex((generator) => generator.id === generatorId) ?? -1;
    if (index < 0 || !after.generators) return;
    const previous = after.generators[index];
    if (!previous || previous.type !== "deformMesh") return;
    const next = { ...previous, ...patch, id: previous.id, type: "deformMesh" as const };
    after.generators[index] = normalizeSplineGenerators([next])[0]!;
    this.applySelectedSplineGeneratorSnapshot(actor, after, "Edit Spline Deform Mesh Generator");
  }

  private applySelectedSplineGeneratorSnapshot(before: LayoutSplineActor, after: LayoutSplineActor, label: string): void {
    if (this.selection?.kind !== "spline") return;
    const index = this.selection.index;
    const apply = (value: LayoutSplineActor): void => {
      if (!this.layout?.splines?.[index]) return;
      this.layout.splines[index] = cloneSplineActor(value);
      this.refreshSpline(index);
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => apply(after), undo: () => apply(before) });
  }

  private applySelectedSplineSnapshot(before: LayoutSplineActor, after: LayoutSplineActor, label: string, activePointId: string | null): void {
    if (this.selection?.kind !== "spline") return;
    const index = this.selection.index;
    const apply = (value: LayoutSplineActor): void => {
      if (!this.layout?.splines?.[index]) return;
      this.layout.splines[index] = cloneSplineActor(value);
      this.activeSplinePointId = activePointId;
      this.activeSplineTangent = null;
      this.refreshSpline(index);
      this.updateGizmo();
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => apply(after), undo: () => apply(before) });
  }

  setSelectedSpline(patch: { closed?: boolean; debugVisible?: boolean; debugResolution?: number; showPointIds?: boolean }): void {
    if (this.selection?.kind !== "spline") return;
    const index = this.selection.index;
    const actor = this.layout?.splines?.[index];
    if (!actor) return;
    const before = cloneSplineActor(actor);
    const after = cloneSplineActor(actor);
    if (patch.closed !== undefined) after.spline.closed = patch.closed && after.spline.points.length >= 3;
    if (patch.debugVisible !== undefined || patch.debugResolution !== undefined || patch.showPointIds !== undefined) {
      after.debug = { ...after.debug };
      if (patch.debugVisible !== undefined) after.debug.visible = patch.debugVisible;
      if (patch.debugResolution !== undefined) after.debug.resolution = Math.min(128, Math.max(2, Math.floor(patch.debugResolution)));
      if (patch.showPointIds !== undefined) after.debug.showPointIds = patch.showPointIds;
    }
    const apply = (value: LayoutSplineActor): void => {
      if (!this.layout?.splines?.[index]) return;
      this.layout.splines[index] = cloneSplineActor(value);
      this.refreshSpline(index);
      this.emitSelectionChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label: "Edit Spline", redo: () => apply(after), undo: () => apply(before) });
  }

  private targetPointItem(point: LayoutTargetPoint): TargetPointRenderItem {
    return {
      ...resolveTargetPoint(point),
      position: [...point.position],
      rotation: point.rotation ? [...point.rotation] : [0, 0, 0],
      scale: readScale(point),
    };
  }

  private buildTargetPoints(): void {
    for (const object of this.targetPointObjects) {
      this.scene.remove(object);
      disposeTargetPointObject(object);
    }
    this.targetPointObjects = [];
    const points = this.layout?.targetPoints ?? [];
    points.forEach((point, index) => {
      const object = createTargetPointObject(this.targetPointItem(point));
      object.userData.targetPointIndex = index;
      this.targetPointObjects.push(object);
      this.scene.add(object);
    });
  }

  private refreshTargetPointObject(index: number): void {
    const point = this.layout?.targetPoints?.[index];
    const object = this.targetPointObjects[index];
    if (!point || !object) return;
    applyTargetPointTransform(object, this.targetPointItem(point));
  }

  private rebuildTargetPointObject(index: number): void {
    const old = this.targetPointObjects[index];
    if (old) {
      this.scene.remove(old);
      disposeTargetPointObject(old);
    }
    const point = this.layout?.targetPoints?.[index];
    if (!point) return;
    const object = createTargetPointObject(this.targetPointItem(point));
    object.userData.targetPointIndex = index;
    this.targetPointObjects[index] = object;
    this.scene.add(object);
  }

  private refreshTargetPointIndices(): void {
    this.targetPointObjects.forEach((object, index) => {
      object.userData.targetPointIndex = index;
    });
  }

  private insertTargetPoint(index: number, point: LayoutTargetPoint): void {
    if (!this.layout) return;
    this.layout.targetPoints ??= [];
    const insertionIndex = clampIndex(index, this.layout.targetPoints.length);
    this.layout.targetPoints.splice(insertionIndex, 0, cloneTargetPoint(point));
    const object = createTargetPointObject(this.targetPointItem(point));
    object.userData.targetPointIndex = insertionIndex;
    this.targetPointObjects.splice(insertionIndex, 0, object);
    this.scene.add(object);
    this.refreshTargetPointIndices();
  }

  private removeTargetPointAt(index: number): LayoutTargetPoint | null {
    if (!this.layout?.targetPoints) return null;
    const [removed] = this.layout.targetPoints.splice(index, 1);
    const [object] = this.targetPointObjects.splice(index, 1);
    if (object) {
      this.scene.remove(object);
      disposeTargetPointObject(object);
    }
    this.refreshTargetPointIndices();
    return removed ? cloneTargetPoint(removed) : null;
  }

  /** Adds a Target Point actor and selects it. */
  addTargetPoint(position: Vec3 = [0, 0, 0]): void {
    if (!this.layout) return;
    const points = this.layout.targetPoints ?? [];
    const point: LayoutTargetPoint = {
      id: uniqueTargetPointId(points),
      name: uniqueTargetPointName("Target Point", points),
      position: [...position],
    };
    const index = points.length;
    this.executeCommand({
      label: "Add Target Point",
      redo: () => {
        this.insertTargetPoint(index, point);
        this.select({ kind: "targetPoint", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.removeTargetPointAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Added Target Point.", "info");
  }

  /** Removes a Target Point actor (undoable). */
  removeTargetPoint(index: number): void {
    const point = this.layout?.targetPoints?.[index];
    if (!point) return;
    const snapshot = cloneTargetPoint(point);
    this.executeCommand({
      label: "Delete Target Point",
      redo: () => {
        this.removeTargetPointAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.insertTargetPoint(index, snapshot);
        this.select({ kind: "targetPoint", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Deleted Target Point.", "info");
  }

  setTargetPoint(
    index: number,
    patch: {
      nextTargetPoint?: string | undefined;
      waitTime?: number;
      acceptanceRadius?: number;
      speedOverride?: number | null;
      patrolTag?: string;
      color?: string;
    },
    label = "Edit Target Point",
  ): void {
    const point = this.layout?.targetPoints?.[index];
    if (!point) return;
    const previous = cloneTargetPoint(point);
    const next = cloneTargetPoint(point);
    if (patch.nextTargetPoint !== undefined) {
      if (patch.nextTargetPoint.trim().length > 0) next.nextTargetPoint = patch.nextTargetPoint.trim();
      else delete next.nextTargetPoint;
    }
    if (patch.waitTime !== undefined) next.waitTime = Math.max(0, patch.waitTime);
    if (patch.acceptanceRadius !== undefined) {
      next.acceptanceRadius = Math.max(0.01, patch.acceptanceRadius);
    }
    if (patch.speedOverride !== undefined) {
      if (patch.speedOverride !== null && patch.speedOverride > 0) next.speedOverride = patch.speedOverride;
      else delete next.speedOverride;
    }
    if (patch.patrolTag !== undefined) {
      if (patch.patrolTag.trim().length > 0) next.patrolTag = patch.patrolTag.trim();
      else delete next.patrolTag;
    }
    if (patch.color !== undefined) next.color = patch.color;
    const needsRebuild = patch.color !== undefined;
    const apply = (value: LayoutTargetPoint): void => {
      if (!this.layout?.targetPoints?.[index]) return;
      this.layout.targetPoints[index] = cloneTargetPoint(value);
      if (needsRebuild) this.rebuildTargetPointObject(index);
      else this.refreshTargetPointObject(index);
      if (this.selection?.kind === "targetPoint" && this.selection.index === index) {
        this.updateSelectionBox();
        this.updateGizmo();
      }
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label,
      redo: () => apply(next),
      undo: () => apply(previous),
    });
  }

  setSelectedTargetPoint(patch: {
    nextTargetPoint?: string | undefined;
    startPoint?: boolean;
    waitTime?: number;
    acceptanceRadius?: number;
    speedOverride?: number | null;
    patrolTag?: string;
    color?: string;
  }): void {
    if (this.selection?.kind !== "targetPoint") return;
    if (patch.startPoint !== undefined) {
      this.setTargetPointStart(this.selection.index, patch.startPoint);
      return;
    }
    this.setTargetPoint(this.selection.index, patch);
  }

  /**
   * Toggles the patrol-route start flag on a Target Point. Enabling it clears the
   * flag on every other point sharing the same `patrolTag` so a route has a single
   * start; the whole change is one undoable command that mutates points in place.
   */
  private setTargetPointStart(index: number, value: boolean): void {
    const points = this.layout?.targetPoints;
    const target = points?.[index];
    if (!points || !target) return;
    const tag = resolveTargetPoint(target).patrolTag;
    const before = points.map((point) => cloneTargetPoint(point));
    const after = points.map((point, i) => {
      const clone = cloneTargetPoint(point);
      if (i === index) {
        if (value) clone.startPoint = true;
        else delete clone.startPoint;
      } else if (value && resolveTargetPoint(point).patrolTag === tag) {
        delete clone.startPoint;
      }
      return clone;
    });
    const apply = (snapshot: LayoutTargetPoint[]): void => {
      const arr = this.layout?.targetPoints;
      if (!arr) return;
      const count = Math.min(arr.length, snapshot.length);
      for (let i = 0; i < count; i += 1) {
        const entry = snapshot[i];
        if (entry) arr[i] = cloneTargetPoint(entry);
      }
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: "Edit Target Point Start",
      redo: () => apply(after),
      undo: () => apply(before),
    });
  }

  getTargetPointReferences(): TargetPointReference[] {
    return (this.layout?.targetPoints ?? []).map((point) => ({
      id: point.id,
      name: resolveTargetPoint(point).name,
    }));
  }

  getSplineReferences(): SplineReference[] {
    return (this.layout?.splines ?? []).map((spline) => ({
      id: spline.id,
      name: spline.name ?? spline.id,
    }));
  }

  getSelectedActorPatrolRoute(): AiPatrolRoute | undefined {
    if (!this.selection || this.selection.kind !== "actor") return undefined;
    const route = this.layout?.actors?.[this.selection.index]?.patrolRoute;
    return route ? { ...route } : undefined;
  }

  setSelectedActorPatrolRoute(route: AiPatrolRoute | undefined): void {
    if (!this.layout || !this.selection || this.selection.kind !== "actor") return;
    const index = this.selection.index;
    const actor = this.layout.actors?.[index];
    if (!actor || actor.locked) return;
    const before = cloneActorInstance(actor);
    const after = cloneActorInstance(actor);
    if (route) after.patrolRoute = { ...route };
    else delete after.patrolRoute;
    this.executeCommand({
      label: "Edit AI Patrol Route",
      redo: () => {
        if (!this.layout?.actors) return;
        this.layout.actors[index] = cloneActorInstance(after);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        if (!this.layout?.actors) return;
        this.layout.actors[index] = cloneActorInstance(before);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
  }

  // --- Landscape (heightfield terrain) actors --------------------------------

  /** Resolved settings + world transform + sidecar data for a landscape layout actor. */
  private landscapeItem(actor: LayoutLandscape): LandscapeRenderItem {
    const data = this.landscapeData.get(actor.id) ?? createFlatLandscapeData("medium");
    ensureLandscapeLayers(data);
    return {
      ...resolveLandscape(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      data,
      viewMode: this.landscapeSculptSettings.viewMode,
      activeLayerId: this.landscapeSculptSettings.activeLayerId,
      layerColors: this.resolveLandscapeLayerColors(data),
      layerTextures: this.resolveLandscapeLayerTextures(data),
    };
  }

  /** UV repeat count so each layer texture tiles roughly every ~8 world units. */
  private landscapeLayerTiling(data: ForgeLandscapeData): number {
    const worldSize = (data.size.verticesX - 1) * data.size.spacing;
    return Math.min(128, Math.max(1, Math.round(worldSize / 8)));
  }

  /**
   * Builds the layerId→hex tint map for a landscape from its layers' assigned
   * materials, reading cached base colors (populated by `warmLandscapeLayerMaterials`).
   * Layers with no material — or whose color hasn't loaded yet — are omitted so the
   * render binding falls back to the preset swatch.
   */
  private resolveLandscapeLayerColors(data: ForgeLandscapeData): LandscapeLayerColors {
    const colors: LandscapeLayerColors = {};
    for (const layer of data.layers) {
      const materialId = layer.material;
      if (!materialId) continue;
      const color = this.landscapeLayerMaterialCache.get(materialId)?.baseColor;
      if (color) colors[layer.id] = color;
    }
    return colors;
  }

  /**
   * Resolved per-layer splat inputs (base-color texture + tint), aligned to
   * `data.layers` order, from the material cache. Layers with no assigned
   * material — or whose material hasn't loaded yet — carry a `null` texture and
   * the preset color, so the render falls back to the flat vertex-color look.
   */
  private resolveLandscapeLayerTextures(data: ForgeLandscapeData): LandscapeLayerTexture[] {
    const tiling = this.landscapeLayerTiling(data);
    const presetById = new Map(LANDSCAPE_DEFAULT_LAYERS.map((preset) => [preset.id as string, preset]));
    return data.layers.map((layer) => {
      const presetColor = presetById.get(layer.id)?.color ?? LANDSCAPE_DEFAULT_LAYERS[0]!.color;
      const cached = layer.material ? this.landscapeLayerMaterialCache.get(layer.material) : undefined;
      return {
        id: layer.id,
        texture: cached?.texture ?? null,
        color: cached?.baseColor ?? presetColor,
        tiling,
      };
    });
  }

  /**
   * Loads (once, then caches) the albedo — base color + tiling texture — of every
   * material assigned to a landscape's layers, then rebuilds that landscape so the
   * splat material picks up the new textures. Safe to call repeatedly; skips ids
   * already cached.
   */
  private async warmLandscapeLayerMaterials(index: number): Promise<void> {
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const manifest = this.manifest;
    if (!manifest) return;
    const pending = data.layers
      .map((layer) => layer.material)
      .filter((id): id is string => Boolean(id) && !this.landscapeLayerMaterialCache.has(id!));
    if (pending.length === 0) return;
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    let loadedAny = false;
    await Promise.all(
      Array.from(new Set(pending)).map(async (materialId) => {
        const layer = await loadForgeMaterialLayer(manifest, materialId, this.textureLoader, {
          maxAnisotropy,
        });
        if (layer) {
          this.landscapeLayerMaterialCache.set(materialId, layer);
          loadedAny = true;
        }
      }),
    );
    if (loadedAny) this.rebuildLandscapeObject(index);
  }

  /**
   * Fully rebuilds one landscape's chunk group (geometry + material) in place,
   * preserving its scene slot and index. Needed when the material *kind* changes
   * (a layer texture assigned, or a view-mode switch between splat and vertex
   * colors) — sculpt/paint dabs use the lighter geometry-only refresh.
   */
  private rebuildLandscapeObject(index: number): void {
    const actor = this.layout?.landscapes?.[index];
    const previous = this.landscapeObjects[index];
    if (!actor || !previous) return;
    const object = createLandscapeObject(this.landscapeItem(actor));
    object.userData.landscapeIndex = index;
    object.traverse((child) => {
      child.userData.landscapeIndex = index;
    });
    this.scene.remove(previous);
    disposeLandscapeObject(previous);
    this.scene.add(object);
    this.landscapeObjects[index] = object;
    // The rebuilt group drops the previous spline-mesh child + overlay; re-attach.
    this.landscapeSplineMeshGroups[index] = null;
    this.landscapeSplineOverlays[index] = null;
    void this.rebuildLandscapeSplineMeshes(index);
    this.refreshLandscapeSplineOverlay(index);
    if (this.selection?.kind === "landscape" && this.selection.index === index) {
      this.updateSelectionBox();
    }
  }

  /**
   * Rebuilds one landscape's instanced spline meshes (Faz 6). The group is parented
   * under the landscape object so it inherits the actor transform. Referenced mesh
   * assets are loaded on demand; shared gltf geometry is never disposed here (only
   * the group is detached), mirroring `rebuildInstanceGroup`.
   */
  private async rebuildLandscapeSplineMeshes(index: number): Promise<void> {
    const actor = this.layout?.landscapes?.[index];
    const object = this.landscapeObjects[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    const previous = this.landscapeSplineMeshGroups[index];
    if (previous) {
      previous.removeFromParent();
      this.landscapeSplineMeshGroups[index] = null;
    }
    if (!actor || !object || !data) return;
    const assetIds = landscapeSplineMeshAssetIds(data);
    if (assetIds.length === 0) return;
    await Promise.all(assetIds.map((assetId) => this.ensureAssetLoaded(assetId)));
    // The landscape object may have been rebuilt/removed while assets loaded.
    if (this.landscapeObjects[index] !== object || !object.parent) return;
    const built = buildLandscapeSplineMeshGroup({
      data,
      models: this.models,
      castShadow: this.staticObjectsCastShadow(),
      receiveShadow: this.staticObjectsReceiveShadow(),
      applyMaterialSlots: (assetId, assetGroup) => {
        const slots = this.resolveAssetMaterialSlots(assetId);
        if (slots) {
          applyMaterialSlotOverrides(assetGroup, slots, (materialId) => this.materialCache.get(materialId));
        }
      },
    });
    if (!built) return;
    built.group.userData.landscapeIndex = index;
    // Spline meshes are non-authored previews: exclude them from picking so a
    // click resolves to the landscape/terrain, not a phantom placement.
    built.group.traverse((child) => {
      child.userData.landscapeIndex = index;
      child.raycast = () => {};
    });
    object.add(built.group);
    this.landscapeSplineMeshGroups[index] = built.group;
  }

  private disposeSplineOverlayGroup(group: Group): void {
    group.removeFromParent();
    group.traverse((child) => {
      if (child instanceof Mesh || child instanceof LineSegments) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    });
  }

  /**
   * Rebuilds the editor-only spline overlay for one landscape: control points as
   * depth-independent markers and segments as lines, with the active point/segment
   * highlighted. Shown only for the selected landscape while in Splines mode, so
   * the road being authored is visible in the viewport.
   */
  private refreshLandscapeSplineOverlay(index: number): void {
    const previous = this.landscapeSplineOverlays[index];
    if (previous) {
      this.disposeSplineOverlayGroup(previous);
      this.landscapeSplineOverlays[index] = null;
    }
    const object = this.landscapeObjects[index];
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!object || !data) return;
    const visible =
      this.landscapeSculptSettings.editMode === "splines" &&
      this.selection?.kind === "landscape" &&
      this.selection.index === index;
    const splines = data.splines ?? [];
    if (!visible || splines.length === 0) return;

    const settings = this.landscapeSculptSettings;
    const overlay = new Group();
    overlay.name = "landscape-spline-overlay";
    const markerGeometry = new SphereGeometry(0.6, 16, 12);
    const pointMaterial = new MeshBasicMaterial({ color: 0x35c4ff, depthTest: false, transparent: true, opacity: 0.95 });
    const activePointMaterial = new MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true, opacity: 1 });
    const lineMaterial = new LineBasicMaterial({ color: 0xdfe7ec, depthTest: false, transparent: true, opacity: 0.9 });
    const activeLineMaterial = new LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true, opacity: 1 });

    for (const spline of splines) {
      const isActiveSpline = spline.id === settings.activeSplineId;
      for (const point of spline.points) {
        const active = isActiveSpline && point.id === settings.activeSplinePointId;
        const marker = new Mesh(markerGeometry, active ? activePointMaterial : pointMaterial);
        marker.position.set(point.position[0], point.position[1] + 0.4, point.position[2]);
        marker.renderOrder = 22;
        // Picked via screen-space projection ({@link pickLandscapeSplinePoint}), so
        // stays out of the generic scene raycaster; metadata records what it maps to.
        marker.raycast = () => {};
        marker.userData.splinePoint = { splineId: spline.id, pointId: point.id };
        overlay.add(marker);
      }
      // Draw the resolved centerline: one line per straight segment, or the
      // Catmull-Rom sub-segments when the spline is curved (Faz 6.2a).
      for (const sub of splineToPolyline(spline)) {
        const active = isActiveSpline && sub.segment.id === settings.activeSplineSegmentId;
        const geometry = new BufferGeometry().setFromPoints([
          new Vector3(sub.start.position[0], sub.start.position[1] + 0.4, sub.start.position[2]),
          new Vector3(sub.end.position[0], sub.end.position[1] + 0.4, sub.end.position[2]),
        ]);
        const line = new LineSegments(geometry, active ? activeLineMaterial : lineMaterial);
        line.renderOrder = 21;
        line.raycast = () => {};
        overlay.add(line);
      }
    }
    object.add(overlay);
    this.landscapeSplineOverlays[index] = overlay;
  }

  /** Refreshes every landscape's spline overlay (selection/mode/data changed). */
  private refreshAllLandscapeSplineOverlays(): void {
    const count = this.landscapeObjects.length;
    for (let index = 0; index < count; index += 1) this.refreshLandscapeSplineOverlay(index);
  }

  /**
   * Rebuilds every landscape mesh from `layout.landscapes` (used on load). Also
   * fetches each landscape's `dataRef` sidecar (public-root-relative), falling
   * back to a flat Medium heightfield if the sidecar can't be read yet (e.g. a
   * freshly authored landscape whose sidecar hasn't been saved).
   */
  private async buildLandscapes(): Promise<void> {
    for (const object of this.landscapeObjects) {
      this.scene.remove(object);
      disposeLandscapeObject(object);
    }
    this.landscapeObjects = [];
    this.landscapeSplineMeshGroups = [];
    this.landscapeSplineOverlays = [];
    this.landscapeData.clear();
    this.landscapeDataDirty.clear();
    const landscapes = this.layout?.landscapes ?? [];
    for (const actor of landscapes) {
      const data = await this.fetchLandscapeData(actor.dataRef);
      if (ensureLandscapeLayers(data)) this.landscapeDataDirty.add(actor.id);
      this.landscapeData.set(actor.id, data);
    }
    landscapes.forEach((actor, index) => {
      const object = createLandscapeObject(this.landscapeItem(actor));
      object.userData.landscapeIndex = index;
      object.traverse((child) => {
        child.userData.landscapeIndex = index;
      });
      this.landscapeObjects.push(object);
      this.scene.add(object);
    });
    landscapes.forEach((_actor, index) => {
      void this.warmLandscapeLayerMaterials(index);
      void this.rebuildLandscapeSplineMeshes(index);
      this.refreshLandscapeSplineOverlay(index);
    });
  }

  // --- Foliage Mode (Faz 1: manual Static Mesh foliage paint) ---------------

  /** Public-relative path of the level whose foliage sidecar is authored. */
  private foliageScenePath(): string {
    return this.activeProject?.manifest.editor.defaultScene ?? "";
  }

  private foliageResolver(): {
    getType: (id: string) => ForgeFoliageTypeDef | null;
    getModel: (assetId: string) => GLTF | null;
    applyMaterialSlots: (assetId: string, group: Group) => void;
  } {
    return {
      getType: (id) => this.foliageTypes.get(id) ?? null,
      getModel: (assetId) => this.models.get(assetId) ?? null,
      applyMaterialSlots: (assetId, group) => {
        const slots = this.resolveAssetMaterialSlots(assetId);
        if (slots) {
          applyMaterialSlotOverrides(group, slots, (materialId) => this.materialCache.get(materialId));
        }
      },
    };
  }

  /** Foliage batches are decorative, not paint surfaces — keep them out of picking. */
  private disableFoliagePicking(): void {
    this.foliageBinding?.root.traverse((child) => {
      child.raycast = () => {};
    });
  }

  private async ensureFoliageMeshesLoaded(): Promise<void> {
    const ids = new Set<string>();
    for (const type of this.foliageTypes.values()) {
      if (type.meshAssetId) ids.add(type.meshAssetId);
    }
    await Promise.all([...ids].map((id) => this.ensureAssetLoaded(id)));
  }

  /**
   * Loads the level foliage sidecar + its referenced Foliage Types, ensures their
   * meshes are resident, and builds the InstancedMesh batches (used on scene load).
   */
  private async buildFoliage(): Promise<void> {
    if (this.foliageBinding) {
      this.foliageBinding.dispose();
      this.foliageBinding = null;
    }
    this.foliageTypes.clear();
    this.foliageSelection.clear();
    this.foliageData = await loadFoliageData(this.foliageScenePath());
    this.foliageDataDirty = false;
    const manifest = this.manifest ?? (await this.assetLoader?.loadManifest()) ?? null;
    if (manifest) {
      this.foliageTypes = await loadFoliageTypesForData(this.foliageData, manifest);
    }
    await this.ensureFoliageMeshesLoaded();
    const binding = new FoliageRenderBinding();
    this.scene.add(binding.root);
    binding.rebuild(this.foliageRenderData(), this.foliageResolver());
    this.foliageBinding = binding;
    this.disableFoliagePicking();
    // Default the active type to the first referenced type (if any) for convenience.
    if (!this.foliageToolSettings.activeTypeId) {
      const first = this.foliageTypes.keys().next().value;
      if (first) this.foliageToolSettings.activeTypeId = first;
    }
    this.emitFoliageChanged();
  }

  /** Rebuilds a single group's batch and re-suppresses picking on the new meshes. */
  private rebuildFoliageGroupObject(group: LayoutFoliageGroup): void {
    this.foliageBinding?.rebuildGroup(group, this.foliageResolver());
    this.disableFoliagePicking();
  }

  /** Generated foliage is transient render data; only its rules live in the sidecar. */
  private generatedFoliageGroup(rule: LandscapeFoliageRule): LayoutFoliageGroup | null {
    const actor = (this.layout?.landscapes ?? []).find((entry) => entry.id === rule.landscapeId);
    const data = actor ? this.landscapeData.get(actor.id) : null;
    const type = this.foliageTypes.get(rule.foliageTypeId);
    if (!actor || !data || !type) return null;
    const instances = generateLandscapeFoliageSamples(rule, {
      id: actor.id,
      position: [...actor.position],
      rotation: readRotation(actor),
      data,
    }).map((sample) =>
      foliageInstanceFromRoll(type, rollFoliageInstance(type, sample, makeFoliageRng(sample.seed))),
    );
    return {
      id: `generated-${rule.id}`,
      foliageTypeId: rule.foliageTypeId,
      target: { kind: "landscape", id: rule.landscapeId },
      instances,
    };
  }

  private foliageRenderData(): LayoutFoliageData {
    const generated = (this.foliageData.landscapeRules ?? [])
      .map((rule) => this.generatedFoliageGroup(rule))
      .filter((group): group is LayoutFoliageGroup => group !== null);
    return { schema: 1, type: "foliage", groups: [...this.foliageData.groups, ...generated] };
  }

  /** Rebuilds only the generated rule groups affected by a terrain change. */
  private rebuildGeneratedFoliageForLandscape(landscapeId: string): void {
    for (const rule of this.foliageData.landscapeRules ?? []) {
      if (rule.landscapeId !== landscapeId) continue;
      const group = this.generatedFoliageGroup(rule);
      if (group && group.instances.length > 0) this.foliageBinding?.rebuildGroup(group, this.foliageResolver());
      else this.foliageBinding?.removeGroup(`generated-${rule.id}`);
    }
    this.disableFoliagePicking();
  }

  /** Coalesces a paint/sculpt stroke into one rebuild of its affected generated batches. */
  private scheduleLandscapeFoliageRebuild(landscapeId: string): void {
    if (!(this.foliageData.landscapeRules ?? []).some((rule) => rule.landscapeId === landscapeId)) return;
    this.dirtyGeneratedFoliageLandscapes.add(landscapeId);
    if (this.generatedFoliageRebuildTimer !== null) window.clearTimeout(this.generatedFoliageRebuildTimer);
    this.generatedFoliageRebuildTimer = window.setTimeout(() => {
      this.generatedFoliageRebuildTimer = null;
      for (const id of this.dirtyGeneratedFoliageLandscapes) this.rebuildGeneratedFoliageForLandscape(id);
      this.dirtyGeneratedFoliageLandscapes.clear();
      this.emitFoliageChanged();
    }, 120);
  }

  private rebuildAllGeneratedFoliage(): void {
    this.foliageBinding?.rebuild(this.foliageRenderData(), this.foliageResolver());
    this.disableFoliagePicking();
  }

  private emitFoliageChanged(): void {
    this.onFoliageChanged?.();
  }

  /** Subscriber (EditorUi) notified whenever foliage data/types/tool state changes. */
  onFoliageChanged: (() => void) | undefined;

  isFoliageModeActive(): boolean {
    return this.foliageModeActive;
  }

  setFoliageModeActive(active: boolean): void {
    if (this.foliageModeActive === active) return;
    this.foliageModeActive = active;
    // Leaving Foliage Mode drops the instance selection + its cage overlay.
    if (!active && !this.foliageSelection.isEmpty()) {
      this.foliageSelection.clear();
      this.refreshFoliageSelectionOverlay();
    }
    this.emitFoliageChanged();
  }

  getFoliageToolSettings(): FoliageToolSettings {
    return { ...this.foliageToolSettings, filters: { ...this.foliageToolSettings.filters } };
  }

  setFoliageToolSettings(patch: Partial<FoliageToolSettings>): FoliageToolSettings {
    const next = { ...this.foliageToolSettings, ...patch };
    this.foliageToolSettings = {
      tool: (["select", "lasso", "paint", "erase", "single", "fill", "remove"] as const).includes(next.tool)
        ? next.tool
        : "paint",
      activeTypeId: next.activeTypeId ?? null,
      brushSize: Math.max(0.1, next.brushSize),
      paintDensity: Math.max(0, next.paintDensity),
      eraseDensity: Math.max(0, next.eraseDensity),
      randomSeed: Math.max(0, Math.floor(next.randomSeed)) || 1,
      filters: patch.filters ? { ...patch.filters } : { ...this.foliageToolSettings.filters },
    };
    this.emitFoliageChanged();
    return this.getFoliageToolSettings();
  }

  getFoliageTypeViews(): FoliageTypeView[] {
    const counts = new Map<string, number>();
    for (const group of this.foliageData.groups) {
      counts.set(group.foliageTypeId, (counts.get(group.foliageTypeId) ?? 0) + group.instances.length);
    }
    return [...this.foliageTypes.entries()].map(([id, type]) => ({
      id,
      name: type.name,
      meshAssetId: type.meshAssetId,
      instanceCount: counts.get(id) ?? 0,
    }));
  }

  getLandscapeFoliageLandscapeViews(): LandscapeFoliageLandscapeView[] {
    return (this.layout?.landscapes ?? []).map((actor) => {
      const data = this.landscapeData.get(actor.id);
      if (data) ensureLandscapeLayers(data);
      const layers = data?.layers ?? LANDSCAPE_DEFAULT_LAYERS.map((layer) => ({ id: layer.id, name: layer.name }));
      return {
        id: actor.id,
        name: actor.name ?? actor.id,
        layers: layers.map((layer) => ({ id: layer.id, name: layer.name })),
      };
    });
  }

  getLandscapeFoliageRuleViews(): LandscapeFoliageRuleView[] {
    const landscapes = new Map(this.getLandscapeFoliageLandscapeViews().map((entry) => [entry.id, entry]));
    return (this.foliageData.landscapeRules ?? []).map((rule) => {
      const landscape = landscapes.get(rule.landscapeId);
      return {
        ...rule,
        landscapeName: landscape?.name ?? rule.landscapeId,
        layerName: landscape?.layers.find((layer) => layer.id === rule.layerId)?.name ?? rule.layerId,
        foliageTypeName: this.foliageTypes.get(rule.foliageTypeId)?.name ?? rule.foliageTypeId,
      };
    });
  }

  /** The active foliage type's resolved def (a copy), or null when none is selected. */
  getActiveFoliageTypeDef(): ForgeFoliageTypeDef | null {
    const active = this.foliageActiveType();
    if (!active) return null;
    return {
      ...active.type,
      scaleMin: [...active.type.scaleMin],
      scaleMax: [...active.type.scaleMax],
    };
  }

  /**
   * Edits an existing Foliage Type's fields (Type Details panel): merges the patch,
   * re-normalizes, updates the in-memory type, rebuilds its batches (so shadow/mesh
   * changes show immediately — scale/rotation changes only affect NEW paints until a
   * Reapply), and persists the change back to its `*.foliagetype.json` asset.
   */
  async updateFoliageType(typeId: string, patch: Partial<ForgeFoliageTypeDef>): Promise<void> {
    const current = this.foliageTypes.get(typeId);
    if (!current) return;
    const next = normalizeFoliageType({ ...current, ...patch });
    this.foliageTypes.set(typeId, next);
    if (next.meshAssetId && next.meshAssetId !== current.meshAssetId) {
      await this.ensureAssetLoaded(next.meshAssetId);
    }
    for (const group of this.foliageData.groups) {
      if (group.foliageTypeId === typeId) this.rebuildFoliageGroupObject(group);
    }
    if ((this.foliageData.landscapeRules ?? []).some((rule) => rule.foliageTypeId === typeId)) {
      this.rebuildAllGeneratedFoliage();
    }
    this.emitFoliageChanged();
    await this.saveFoliageTypeAsset(typeId, next);
  }

  /** Persists a Foliage Type def back to its manifest asset via the dev endpoint. */
  private async saveFoliageTypeAsset(assetId: string, def: ForgeFoliageTypeDef): Promise<void> {
    const manifest = this.manifest ?? (await this.assetLoader?.loadManifest()) ?? null;
    const record = manifest ? assetRecordById(manifest, assetId) : null;
    if (!record) {
      this.onStatus?.(`Foliage type asset not found for save: ${assetId}`, "warning");
      return;
    }
    try {
      const response = await fetch("/__save-foliage-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: assetPath(record), foliageType: def }),
      });
      if (!response.ok) {
        this.onStatus?.(`Foliage type save failed: HTTP ${response.status}`, "warning");
      }
    } catch (error) {
      this.onStatus?.(
        `Foliage type save endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  }

  /** Adds a Foliage Type asset (by asset id) to the active type list and loads its mesh. */
  async addFoliageType(assetId: string): Promise<void> {
    if (this.foliageTypes.has(assetId)) {
      this.foliageToolSettings.activeTypeId = assetId;
      this.emitFoliageChanged();
      return;
    }
    const manifest = this.manifest ?? (await this.assetLoader?.loadManifest()) ?? null;
    const record = manifest ? assetRecordById(manifest, assetId) : null;
    if (!record) {
      this.onStatus?.(`Foliage type asset not found: ${assetId}`, "warning");
      return;
    }
    const type = await loadFoliageTypeByPath(assetPath(record));
    if (!type) {
      this.onStatus?.(`Failed to load foliage type: ${assetId}`, "warning");
      return;
    }
    this.foliageTypes.set(assetId, type);
    if (type.meshAssetId) await this.ensureAssetLoaded(type.meshAssetId);
    this.foliageToolSettings.activeTypeId = assetId;
    this.emitFoliageChanged();
  }

  /**
   * Registers an already-loaded Foliage Type def under its asset id (used right
   * after the editor creates a new `*.foliagetype.json`, so it works without
   * waiting for the SceneApp manifest cache to pick up the new asset — the source
   * of the "created a type but nothing paints / selection resets" bug).
   */
  async registerLoadedFoliageType(assetId: string, def: ForgeFoliageTypeDef): Promise<void> {
    const type = normalizeFoliageType(def);
    this.foliageTypes.set(assetId, type);
    if (type.meshAssetId) await this.ensureAssetLoaded(type.meshAssetId);
    this.foliageToolSettings.activeTypeId = assetId;
    this.emitFoliageChanged();
  }

  /** Removes a Foliage Type from the list along with all of its painted instances. */
  removeFoliageType(assetId: string): void {
    const removedGroups = this.foliageData.groups.filter((group) => group.foliageTypeId === assetId);
    if (removedGroups.length > 0) {
      for (const group of removedGroups) this.foliageBinding?.removeGroup(group.id);
      this.foliageData.groups = this.foliageData.groups.filter(
        (group) => group.foliageTypeId !== assetId,
      );
      this.foliageDataDirty = true;
    }
    this.foliageTypes.delete(assetId);
    const removedRuleIds = (this.foliageData.landscapeRules ?? [])
      .filter((rule) => rule.foliageTypeId === assetId)
      .map((rule) => rule.id);
    const beforeRuleCount = this.foliageData.landscapeRules?.length ?? 0;
    this.foliageData.landscapeRules = (this.foliageData.landscapeRules ?? []).filter(
      (rule) => rule.foliageTypeId !== assetId,
    );
    if (this.foliageData.landscapeRules.length !== beforeRuleCount) {
      for (const ruleId of removedRuleIds) this.foliageBinding?.removeGroup(`generated-${ruleId}`);
      this.foliageDataDirty = true;
    }
    if (this.foliageToolSettings.activeTypeId === assetId) {
      this.foliageToolSettings.activeTypeId = this.foliageTypes.keys().next().value ?? null;
    }
    this.emitFoliageChanged();
  }

  /** Adds a persisted Landscape layer rule; its generated instances are never saved. */
  addLandscapeFoliageRule(input: Omit<LandscapeFoliageRule, "id">): void {
    const rules = this.foliageData.landscapeRules ?? [];
    const rule: LandscapeFoliageRule = {
      id: uniqueLandscapeFoliageRuleId(rules),
      landscapeId: input.landscapeId,
      layerId: input.layerId,
      foliageTypeId: input.foliageTypeId,
      density: Math.max(0, Math.min(10, input.density)),
      minWeight: Math.max(0, Math.min(1, input.minWeight)),
      seed: Math.max(0, Math.floor(input.seed)) >>> 0,
    };
    this.foliageData.landscapeRules = [...rules, rule];
    this.foliageDataDirty = true;
    this.rebuildAllGeneratedFoliage();
    this.emitFoliageChanged();
    this.scheduleAutoSave();
  }

  updateLandscapeFoliageRule(id: string, patch: Partial<Omit<LandscapeFoliageRule, "id">>): void {
    const rules = this.foliageData.landscapeRules ?? [];
    const index = rules.findIndex((rule) => rule.id === id);
    if (index < 0) return;
    const current = rules[index]!;
    const next: LandscapeFoliageRule = {
      ...current,
      ...patch,
      density: Math.max(0, Math.min(10, patch.density ?? current.density)),
      minWeight: Math.max(0, Math.min(1, patch.minWeight ?? current.minWeight)),
      seed: Math.max(0, Math.floor(patch.seed ?? current.seed)) >>> 0,
    };
    this.foliageData.landscapeRules = rules.map((rule) => (rule.id === id ? next : rule));
    this.foliageDataDirty = true;
    this.rebuildAllGeneratedFoliage();
    this.emitFoliageChanged();
    this.scheduleAutoSave();
  }

  removeLandscapeFoliageRule(id: string): void {
    const rules = this.foliageData.landscapeRules ?? [];
    const next = rules.filter((rule) => rule.id !== id);
    if (next.length === rules.length) return;
    this.foliageData.landscapeRules = next;
    this.foliageDataDirty = true;
    this.foliageBinding?.removeGroup(`generated-${id}`);
    this.emitFoliageChanged();
    this.scheduleAutoSave();
  }

  private foliageActiveType(): { id: string; type: ForgeFoliageTypeDef } | null {
    const id = this.foliageToolSettings.activeTypeId;
    if (!id) return null;
    const type = this.foliageTypes.get(id);
    return type ? { id, type } : null;
  }

  /** Classifies a pointer hit against the active target filters. */
  private foliageTargetAt(
    pick: FoliageSurfacePick,
  ): { kind: "landscape" | "staticMesh"; id: string } | null {
    const filters = this.foliageToolSettings.filters;
    if (pick.landscapeIndex !== null) {
      if (!filters.landscape) return null;
      const actor = this.layout?.landscapes?.[pick.landscapeIndex];
      return actor ? { kind: "landscape", id: actor.id } : null;
    }
    if (pick.staticMeshAssetId) {
      if (!filters.staticMesh) return null;
      return { kind: "staticMesh", id: pick.staticMeshAssetId };
    }
    return null;
  }

  private foliageGroupFor(
    typeId: string,
    target: { kind: "landscape" | "staticMesh"; id: string },
    create: boolean,
  ): LayoutFoliageGroup | null {
    let group = this.foliageData.groups.find(
      (entry) =>
        entry.foliageTypeId === typeId &&
        entry.target.kind === target.kind &&
        entry.target.id === target.id,
    );
    if (!group && create) {
      group = {
        id: uniqueFoliageGroupId(this.foliageData.groups),
        foliageTypeId: typeId,
        target: { kind: target.kind, id: target.id },
        instances: [],
      };
      this.foliageData.groups.push(group);
    }
    return group ?? null;
  }

  /**
   * Applies one foliage tool action at a pointer position. Returns true when it
   * consumed the pointer (so the caller suppresses camera/selection handling).
   * The EditorUi wires this to pointer-down and drag while a foliage tool is live.
   */
  applyFoliageActionAt(clientX: number, clientY: number): boolean {
    if (!this.foliageModeActive) return false;
    const tool = this.foliageToolSettings.tool;
    if (tool === "select") return false;
    const pick = this.picker.pickFoliageSurface(clientX, clientY);
    if (!pick) return false;
    if (tool === "erase") return this.applyFoliageErase(pick);
    if (tool === "remove") return this.applyFoliageErase(pick, this.foliageToolSettings.activeTypeId);
    const active = this.foliageActiveType();
    if (!active) {
      this.onStatus?.("Select a Foliage Type first.", "warning");
      return false;
    }
    const target = this.foliageTargetAt(pick);
    if (!target) return false;
    if (tool === "single") return this.applyFoliageSingle(active, target, pick);
    if (tool === "fill") return this.applyFoliageFill(active, target);
    return this.applyFoliagePaint(active, target, pick);
  }

  private applyFoliagePaint(
    active: { id: string; type: ForgeFoliageTypeDef },
    target: { kind: "landscape" | "staticMesh"; id: string },
    pick: FoliageSurfacePick,
  ): boolean {
    const brush: FoliageBrush = {
      center: [pick.point.x, pick.point.y, pick.point.z],
      radius: this.foliageToolSettings.brushSize,
      density: this.foliageToolSettings.paintDensity,
      seed: this.foliageToolSettings.randomSeed,
    };
    // Brush spacing throttle: during a drag, only lay a new dab once the cursor has
    // moved ~one brush radius. Without this, every pointermove re-dabs the same spot
    // and saturates it far past a single click's density; a full-radius step keeps
    // consecutive dabs overlapping enough for continuous coverage at click density.
    if (this.foliagePaintLastDab) {
      const dx = brush.center[0] - this.foliagePaintLastDab[0];
      const dz = brush.center[2] - this.foliagePaintLastDab[2];
      const spacing = brush.radius;
      if (dx * dx + dz * dz < spacing * spacing) return true;
    }
    this.foliagePaintLastDab = [brush.center[0], brush.center[1], brush.center[2]];
    const group = this.foliageGroupFor(active.id, target, true);
    if (!group) return false;
    const count = foliageSampleTargetCount(active.type, brush);
    // Vary the dab seed so a held drag doesn't stamp the same pattern repeatedly,
    // while staying seeded off Random Seed for broad reproducibility.
    const rng = makeFoliageRng((brush.seed * 2654435761 + this.foliageData.groups.length + count) >>> 0);
    const existing: Vec3[] = group.instances.map((instance) => [...instance.position] as Vec3);
    let added = 0;
    for (let i = 0; i < count; i += 1) {
      const radius = brush.radius * Math.sqrt(rng());
      const angle = rng() * Math.PI * 2;
      const sampleX = brush.center[0] + Math.cos(angle) * radius;
      const sampleZ = brush.center[2] + Math.sin(angle) * radius;
      const surface = this.picker.raycastFoliageSurfaceDown(sampleX, sampleZ);
      const sampleTarget = surface ? this.foliageTargetAt(surface) : null;
      let hit: FoliageSurfaceHit;
      if (surface && sampleTarget && sampleTarget.kind === target.kind && sampleTarget.id === target.id) {
        hit = {
          position: [surface.point.x, surface.point.y, surface.point.z],
          normal: [surface.normal.x, surface.normal.y, surface.normal.z],
        };
      } else if (target.kind === "landscape") {
        // Fallback for a missed/other-target down-cast on landscape: place on the
        // cursor-hit plane so the brush always scatters (accurate on flat ground).
        hit = { position: [sampleX, pick.point.y, sampleZ], normal: [pick.normal.x, pick.normal.y, pick.normal.z] };
      } else {
        continue;
      }
      if (!passesFoliageFilters(active.type, hit)) continue;
      if (foliageOverlaps(hit.position, existing, active.type.radius)) continue;
      const instance = foliageInstanceFromRoll(active.type, rollFoliageInstance(active.type, hit, rng));
      group.instances.push(instance);
      existing.push([...instance.position] as Vec3);
      added += 1;
    }
    if (added === 0) return true;
    this.foliageDataDirty = true;
    this.rebuildFoliageGroupObject(group);
    this.emitFoliageChanged();
    return true;
  }

  private applyFoliageSingle(
    active: { id: string; type: ForgeFoliageTypeDef },
    target: { kind: "landscape" | "staticMesh"; id: string },
    pick: FoliageSurfacePick,
  ): boolean {
    const hit: FoliageSurfaceHit = {
      position: [pick.point.x, pick.point.y, pick.point.z],
      normal: [pick.normal.x, pick.normal.y, pick.normal.z],
    };
    if (!passesFoliageFilters(active.type, hit)) return true;
    const group = this.foliageGroupFor(active.id, target, true);
    if (!group) return false;
    // Space single placements by the type radius so a drag scatters instances
    // instead of stacking dozens on the same spot under a held button.
    if (foliageOverlaps(hit.position, group.instances.map((instance) => instance.position), active.type.radius)) {
      return true;
    }
    const rng = makeFoliageRng((this.foliageToolSettings.randomSeed + group.instances.length + 1) >>> 0);
    const instance = foliageInstanceFromRoll(active.type, rollFoliageInstance(active.type, hit, rng));
    group.instances.push(instance);
    this.foliageDataDirty = true;
    this.rebuildFoliageGroupObject(group);
    this.emitFoliageChanged();
    return true;
  }

  /**
   * Fill: scatters the active foliage type across the ENTIRE clicked target's
   * footprint (a landscape, or all placements of a static-mesh asset) in one action,
   * grid-sampling its world-XZ bounds and down-casting each point onto the real
   * surface. Reuses the paint core's slope/height/overlap acceptance, so a fill
   * honours the same type rules as a brush dab. The sample count is capped so a huge
   * target stays responsive — the grid spacing widens to fit the cap.
   */
  private applyFoliageFill(
    active: { id: string; type: ForgeFoliageTypeDef },
    target: { kind: "landscape" | "staticMesh"; id: string },
  ): boolean {
    const area = this.foliageTargetArea(target);
    if (!area) {
      this.onStatus?.("Could not resolve the fill target bounds.", "warning");
      return false;
    }
    const width = area.maxX - area.minX;
    const depth = area.maxZ - area.minZ;
    // Grid at the type radius (the densest packing the overlap test allows), widening
    // the spacing when the target is large enough to blow past the sample cap.
    const MAX_FILL_SAMPLES = 20000;
    const baseSpacing = Math.max(active.type.radius, 0.05);
    const capSpacing = Math.sqrt(Math.max((width * depth) / MAX_FILL_SAMPLES, 0));
    const spacing = Math.max(baseSpacing, capSpacing);
    const rng = makeFoliageRng((this.foliageToolSettings.randomSeed * 40503 + 1) >>> 0);
    const points = foliageFillSamplePoints(area, spacing, this.foliageToolSettings.paintDensity, rng);
    const group = this.foliageGroupFor(active.id, target, true);
    if (!group) return false;
    const existing: Vec3[] = group.instances.map((instance) => [...instance.position] as Vec3);
    let added = 0;
    for (const [sampleX, sampleZ] of points) {
      const surface = this.picker.raycastFoliageSurfaceDown(sampleX, sampleZ);
      const sampleTarget = surface ? this.foliageTargetAt(surface) : null;
      if (
        !surface ||
        !sampleTarget ||
        sampleTarget.kind !== target.kind ||
        sampleTarget.id !== target.id
      ) {
        continue;
      }
      const hit: FoliageSurfaceHit = {
        position: [surface.point.x, surface.point.y, surface.point.z],
        normal: [surface.normal.x, surface.normal.y, surface.normal.z],
      };
      if (!passesFoliageFilters(active.type, hit)) continue;
      if (foliageOverlaps(hit.position, existing, active.type.radius)) continue;
      const instance = foliageInstanceFromRoll(active.type, rollFoliageInstance(active.type, hit, rng));
      group.instances.push(instance);
      existing.push([...instance.position] as Vec3);
      added += 1;
    }
    if (added === 0) {
      this.onStatus?.("Fill added no foliage — filters or spacing rejected every sample.", "info");
      return true;
    }
    this.foliageDataDirty = true;
    this.rebuildFoliageGroupObject(group);
    this.onStatus?.(`Filled ${added} foliage instance${added === 1 ? "" : "s"}.`, "success");
    this.emitFoliageChanged();
    return true;
  }

  /** World-XZ footprint of a fill target, or null when its scene object isn't resolved. */
  private foliageTargetArea(
    target: { kind: "landscape" | "staticMesh"; id: string },
  ): FoliageFillArea | null {
    let object: Object3D | null = null;
    if (target.kind === "landscape") {
      const index = this.layout?.landscapes?.findIndex((actor) => actor.id === target.id) ?? -1;
      object = index >= 0 ? (this.landscapeObjects[index] ?? null) : null;
    } else {
      object = this.instanceGroups.get(target.id) ?? null;
    }
    if (!object) return null;
    const box = new Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  }

  /** Erases instances under the brush; when `onlyTypeId` is set, only that type. */
  private applyFoliageErase(pick: FoliageSurfacePick, onlyTypeId?: string | null): boolean {
    const center: Vec3 = [pick.point.x, pick.point.y, pick.point.z];
    const radius = this.foliageToolSettings.brushSize;
    let changed = false;
    for (const group of this.foliageData.groups) {
      if (onlyTypeId && group.foliageTypeId !== onlyTypeId) continue;
      const { kept, removed } = eraseFoliageInRadius(group.instances, center, radius);
      if (removed > 0) {
        group.instances = kept;
        this.rebuildFoliageGroupObject(group);
        changed = true;
      }
    }
    if (!changed) return true;
    // Drop groups emptied by the erase so the sidecar stays tidy.
    this.foliageData.groups = this.foliageData.groups.filter((group) => {
      if (group.instances.length > 0) return true;
      this.foliageBinding?.removeGroup(group.id);
      return false;
    });
    // Erase re-indexes kept instances, so any instance selection is now stale.
    this.clearFoliageSelection();
    this.foliageDataDirty = true;
    this.emitFoliageChanged();
    return true;
  }

  // --- Foliage instance selection (Faz 2: select / lasso / invalid / reattach / remove) ---

  /** Rebuilds the selection cage overlay from the current instance selection. */
  private refreshFoliageSelectionOverlay(): void {
    if (!this.foliageBinding) return;
    const entries: FoliageSelectionEntry[] = [];
    this.foliageSelection.forEach((groupId, indices) => {
      entries.push({ groupId, indices: [...indices] });
    });
    this.foliageBinding.setSelection(this.foliageData, entries, this.foliageResolver());
  }

  /** Clears the instance selection and its overlay (no-op when already empty). */
  private clearFoliageSelection(): void {
    if (this.foliageSelection.isEmpty()) return;
    this.foliageSelection.clear();
    this.refreshFoliageSelectionOverlay();
  }

  /** Number of currently-selected foliage instances (panel resource readout). */
  getFoliageSelectionCount(): number {
    return this.foliageSelection.size();
  }

  /**
   * Per-type foliage resource report (instances / triangles / draw calls) for the
   * panel's Resource Usage section. Triangle + draw-call cost is read from the live
   * InstancedMesh batches, so it reflects exactly what the viewport draws.
   */
  getFoliageResourceUsage(): FoliageResourceUsage {
    return computeFoliageResourceUsage(
      this.foliageRenderData(),
      (typeId) => this.foliageTypes.get(typeId)?.name ?? typeId,
      (groupId) => this.foliageBinding?.groupRenderStat(groupId) ?? null,
    );
  }

  /** Select tool: click-picks a single instance (shift/ctrl toggles; empty clears). */
  private applyFoliageSelectClick(clientX: number, clientY: number, additive: boolean): void {
    const meshes = this.foliageBinding?.allMeshes() ?? [];
    const hit = this.picker.pickFoliageInstance(clientX, clientY, meshes);
    if (!hit) {
      if (!additive) this.clearFoliageSelection();
      this.emitFoliageChanged();
      return;
    }
    if (additive) {
      this.foliageSelection.toggle(hit.groupId, hit.index);
    } else {
      this.foliageSelection.clear();
      this.foliageSelection.add(hit.groupId, hit.index);
    }
    this.refreshFoliageSelectionOverlay();
    this.emitFoliageChanged();
  }

  /** Lasso tool: brush-drag over instances to add them (Ctrl/Alt subtracts). */
  private applyFoliageLassoAt(clientX: number, clientY: number, subtract: boolean): boolean {
    const pick = this.picker.pickFoliageSurface(clientX, clientY);
    if (!pick) return true;
    const center: Vec3 = [pick.point.x, pick.point.y, pick.point.z];
    const radius = this.foliageToolSettings.brushSize;
    let changed = false;
    for (const group of this.foliageData.groups) {
      for (const index of foliageIndicesInRadius(group.instances, center, radius)) {
        if (subtract) {
          if (this.foliageSelection.has(group.id, index)) {
            this.foliageSelection.remove(group.id, index);
            changed = true;
          }
        } else if (!this.foliageSelection.has(group.id, index)) {
          this.foliageSelection.add(group.id, index);
          changed = true;
        }
      }
    }
    if (changed) {
      this.refreshFoliageSelectionOverlay();
      this.emitFoliageChanged();
    }
    return true;
  }

  /** Deselect All action (panel button + Escape while foliage mode). */
  deselectAllFoliage(): void {
    if (this.foliageSelection.isEmpty()) return;
    this.clearFoliageSelection();
    this.emitFoliageChanged();
  }

  /**
   * Select Invalid: selects instances that no longer sit on valid ground — nothing
   * solid beneath them, a large vertical gap to the surface below, or a surface that
   * now fails the type's slope/height filters (e.g. after a landscape sculpt).
   */
  selectInvalidFoliage(): void {
    this.foliageSelection.clear();
    for (const group of this.foliageData.groups) {
      const type = this.foliageTypes.get(group.foliageTypeId) ?? null;
      const tolerance =
        0.5 + (type ? Math.max(Math.abs(type.zOffsetMin), Math.abs(type.zOffsetMax)) : 0);
      group.instances.forEach((instance, index) => {
        const surface = this.picker.raycastFoliageSurfaceDown(instance.position[0], instance.position[2]);
        let invalid = false;
        if (!surface) {
          invalid = true;
        } else if (Math.abs(surface.point.y - instance.position[1]) > tolerance) {
          invalid = true;
        } else if (
          type &&
          !passesFoliageFilters(type, {
            position: [surface.point.x, surface.point.y, surface.point.z],
            normal: [surface.normal.x, surface.normal.y, surface.normal.z],
          })
        ) {
          invalid = true;
        }
        if (invalid) this.foliageSelection.add(group.id, index);
      });
    }
    const count = this.foliageSelection.size();
    this.refreshFoliageSelectionOverlay();
    this.onStatus?.(
      count > 0
        ? `Selected ${count} invalid foliage instance${count === 1 ? "" : "s"}.`
        : "No invalid foliage found.",
      count > 0 ? "info" : "success",
    );
    this.emitFoliageChanged();
  }

  /**
   * Reattach / snap to ground: re-seats every selected instance onto the surface
   * directly below it, preserving scale + painted yaw (and re-tilting to the new
   * normal when the type aligns to it). Positions are re-indexed in place, so the
   * selection survives.
   */
  reattachSelectedFoliage(): void {
    if (this.foliageSelection.isEmpty()) return;
    const groupsById = new Map(this.foliageData.groups.map((group) => [group.id, group]));
    const touched = new Set<string>();
    this.foliageSelection.forEach((groupId, indices) => {
      const group = groupsById.get(groupId);
      if (!group) return;
      const type = this.foliageTypes.get(group.foliageTypeId) ?? null;
      if (!type) return;
      for (const index of indices) {
        const instance = group.instances[index];
        if (!instance) continue;
        const surface = this.picker.raycastFoliageSurfaceDown(instance.position[0], instance.position[2]);
        if (!surface) continue;
        group.instances[index] = reattachFoliageInstance(instance, type, {
          position: [surface.point.x, surface.point.y, surface.point.z],
          normal: [surface.normal.x, surface.normal.y, surface.normal.z],
        });
        touched.add(groupId);
      }
    });
    if (touched.size === 0) {
      this.onStatus?.("No ground found under the selected foliage.", "warning");
      return;
    }
    for (const groupId of touched) {
      const group = groupsById.get(groupId);
      if (group) this.rebuildFoliageGroupObject(group);
    }
    this.foliageDataDirty = true;
    this.refreshFoliageSelectionOverlay();
    this.emitFoliageChanged();
  }

  /**
   * Reapply: re-rolls scale + rotation of existing instances from their type's
   * CURRENT settings (deterministic per stored seed). Acts on the instance selection
   * when there is one; otherwise on every instance of the active type. Position is
   * preserved — Z-offset changes need a repaint (see {@link reapplyFoliageInstance}).
   */
  reapplyFoliage(): void {
    const active = this.foliageActiveType();
    const useSelection = !this.foliageSelection.isEmpty();
    if (!useSelection && !active) {
      this.onStatus?.("Select a Foliage Type (or some instances) to reapply.", "warning");
      return;
    }
    const groupsById = new Map(this.foliageData.groups.map((group) => [group.id, group]));
    const touched = new Set<string>();
    let count = 0;
    if (useSelection) {
      this.foliageSelection.forEach((groupId, indices) => {
        const group = groupsById.get(groupId);
        if (!group) return;
        const type = this.foliageTypes.get(group.foliageTypeId);
        if (!type) return;
        for (const index of indices) {
          const instance = group.instances[index];
          if (!instance) continue;
          group.instances[index] = reapplyFoliageInstance(type, instance);
          count += 1;
        }
        touched.add(groupId);
      });
    } else if (active) {
      for (const group of this.foliageData.groups) {
        if (group.foliageTypeId !== active.id || group.instances.length === 0) continue;
        group.instances = group.instances.map((instance) =>
          reapplyFoliageInstance(active.type, instance),
        );
        touched.add(group.id);
        count += group.instances.length;
      }
    }
    if (count === 0) {
      this.onStatus?.("No foliage instances to reapply.", "info");
      return;
    }
    for (const groupId of touched) {
      const group = groupsById.get(groupId);
      if (group) this.rebuildFoliageGroupObject(group);
    }
    this.foliageDataDirty = true;
    this.refreshFoliageSelectionOverlay();
    this.onStatus?.(
      `Reapplied ${count} foliage instance${count === 1 ? "" : "s"}.`,
      "success",
    );
    this.emitFoliageChanged();
  }

  /** Removes every selected instance, drops emptied groups, and clears the selection. */
  removeSelectedFoliage(): void {
    if (this.foliageSelection.isEmpty()) return;
    const groupsById = new Map(this.foliageData.groups.map((group) => [group.id, group]));
    const affected = new Set(this.foliageSelection.groupIds());
    let changed = false;
    this.foliageSelection.forEach((groupId, indices) => {
      const group = groupsById.get(groupId);
      if (!group) return;
      const kept = removeFoliageIndices(group.instances, indices);
      if (kept.length !== group.instances.length) {
        group.instances = kept;
        changed = true;
      }
    });
    if (!changed) {
      this.clearFoliageSelection();
      this.emitFoliageChanged();
      return;
    }
    this.foliageData.groups = this.foliageData.groups.filter((group) => {
      if (group.instances.length > 0) return true;
      this.foliageBinding?.removeGroup(group.id);
      return false;
    });
    for (const group of this.foliageData.groups) {
      if (affected.has(group.id)) this.rebuildFoliageGroupObject(group);
    }
    this.foliageSelection.clear();
    this.foliageDataDirty = true;
    this.refreshFoliageSelectionOverlay();
    this.emitFoliageChanged();
  }

  private ensureFoliageBrushCursor(): Mesh {
    if (this.foliageBrushCursor) return this.foliageBrushCursor;
    const cursor = new Mesh(
      new RingGeometry(0.96, 1, 96),
      new MeshBasicMaterial({
        color: 0x7fd77f,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    cursor.name = "foliage-brush-cursor";
    cursor.rotation.x = -Math.PI / 2;
    cursor.renderOrder = 20;
    cursor.visible = false;
    this.foliageBrushCursor = cursor;
    this.scene.add(cursor);
    return cursor;
  }

  updateFoliageBrushHover(clientX: number, clientY: number): void {
    const tool = this.foliageToolSettings.tool;
    // Select is a click-pick and Fill covers a whole target — neither uses the brush
    // disk, so the radius ring would be misleading; hide it for both.
    if (!this.foliageModeActive || tool === "select" || tool === "fill") {
      this.clearFoliageBrushHover();
      return;
    }
    const pick = this.picker.pickFoliageSurface(clientX, clientY);
    if (!pick) {
      this.clearFoliageBrushHover();
      return;
    }
    const cursor = this.ensureFoliageBrushCursor();
    cursor.position.copy(pick.point);
    cursor.position.y += 0.03;
    cursor.scale.setScalar(this.foliageToolSettings.brushSize);
    cursor.visible = true;
  }

  clearFoliageBrushHover(): void {
    if (this.foliageBrushCursor) this.foliageBrushCursor.visible = false;
  }

  /** Pointer-down entry for a foliage tool; returns true when it owns the pointer. */
  beginFoliageStroke(event: PointerEvent): boolean {
    if (!this.foliageModeActive) return false;
    const tool = this.foliageToolSettings.tool;
    // Select is a click-pick (no drag/capture): resolve it and consume the pointer
    // so it never falls through to normal scene selection under the foliage batches.
    if (tool === "select") {
      this.applyFoliageSelectClick(event.clientX, event.clientY, event.shiftKey || event.ctrlKey);
      return true;
    }
    // Foliage mode owns the left button for paint/erase/single/remove/lasso: consume
    // the pointer even when a dab places/selects nothing, so it NEVER falls through to
    // landscape sculpt or scene selection (that was deforming terrain under Paint).
    this.foliagePaintLastDab = null;
    if (tool === "lasso") {
      this.applyFoliageLassoAt(event.clientX, event.clientY, event.ctrlKey || event.altKey);
    } else {
      this.applyFoliageActionAt(event.clientX, event.clientY);
    }
    this.foliageStrokePointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    return true;
  }

  /** Pointer-move during a foliage stroke (drag paint/erase/lasso). */
  updateFoliageStroke(event: PointerEvent): boolean {
    if (this.foliageStrokePointerId !== event.pointerId) return false;
    // Keep the brush ring under the cursor while the button is held (pointer is
    // captured, so the normal hover path doesn't run during a drag).
    this.updateFoliageBrushHover(event.clientX, event.clientY);
    const tool = this.foliageToolSettings.tool;
    if (tool === "lasso") {
      this.applyFoliageLassoAt(event.clientX, event.clientY, event.ctrlKey || event.altKey);
    } else if (tool !== "single" && tool !== "fill") {
      // Single/Fill act exactly once per click — they must not drag-repeat.
      this.applyFoliageActionAt(event.clientX, event.clientY);
    }
    return true;
  }

  endFoliageStroke(event: PointerEvent): boolean {
    if (this.foliageStrokePointerId !== event.pointerId) return false;
    this.foliageStrokePointerId = null;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released (pointercancel); ignore.
    }
    return true;
  }

  /** Saves the foliage sidecar via the dev endpoint when it has unsaved changes. */
  private async saveFoliageData(): Promise<void> {
    if (!this.foliageDataDirty) return;
    const path = foliageDataPath(this.foliageScenePath());
    const response = await fetch("/__save-foliage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, foliage: this.foliageData }),
    });
    if (!response.ok) throw new Error(`Foliage save failed: HTTP ${response.status}`);
    this.foliageDataDirty = false;
  }

  onMeshPaintChanged: (() => void) | undefined;

  isMeshPaintModeActive(): boolean {
    return this.meshPaintModeActive;
  }

  setMeshPaintModeActive(active: boolean): void {
    if (this.meshPaintModeActive === active) return;
    this.meshPaintModeActive = active;
    if (!active) {
      this.meshPaintFlowPointer = null;
      this.clearMeshPaintBrushHover();
      this.clearMeshPaintColorView();
    } else {
      this.applyMeshPaintColorView();
    }
    this.onMeshPaintChanged?.();
  }

  getMeshPaintToolSettings(): MeshPaintToolSettings {
    return {
      ...this.meshPaintToolSettings,
      color: [...this.meshPaintToolSettings.color],
      channels: [...this.meshPaintToolSettings.channels],
    };
  }

  setMeshPaintToolSettings(patch: Partial<MeshPaintToolSettings>): MeshPaintToolSettings {
    const next = { ...this.meshPaintToolSettings, ...patch };
    const channels = (next.channels ?? []).filter((channel): channel is MeshPaintChannel =>
      (["r", "g", "b", "a"] as const).includes(channel),
    );
    this.meshPaintToolSettings = {
      tool: next.tool === "erase" ? "erase" : "paint",
      colorView: isMeshPaintColorView(next.colorView) ? next.colorView : "off",
      color: [
        clampUnit(next.color?.[0]),
        clampUnit(next.color?.[1]),
        clampUnit(next.color?.[2]),
        clampUnit(next.color?.[3]),
      ],
      channels: channels.length > 0 ? channels : ["r"],
      brushSize: Math.max(0.01, Number.isFinite(next.brushSize) ? next.brushSize : 1),
      strength: clampUnit(next.strength),
      falloff: Math.min(32, Math.max(0.01, Number.isFinite(next.falloff) ? next.falloff : 1)),
      flow: clampUnit(next.flow),
      ignoreBackfaces: next.ignoreBackfaces !== false,
    };
    this.applyMeshPaintColorView();
    this.onMeshPaintChanged?.();
    return this.getMeshPaintToolSettings();
  }

  /** Fills every primitive of the selected placed mesh, retaining non-selected channels. */
  fillSelectedMeshPaint(): void {
    const selection = this.selectedMeshPaintInstance();
    if (!selection || !this.ensureMeshPaintPlacementData(selection)) return;
    let changed = 0;
    for (const object of this.meshPaintObjects(selection)) {
      const target = meshPaintTargetFromObject(object);
      const position = object.geometry.getAttribute("position");
      if (!target || !position) continue;
      const geometry = this.ensureMeshPaintGeometry(object);
      const existing = geometry.getAttribute("color");
      const color = this.meshPaintToolSettings.tool === "erase"
        ? ([0, 0, 0, 0] as const)
        : this.meshPaintToolSettings.color;
      const colors = fillMeshVertexColors(
        position.count,
        existing?.itemSize === 4 ? existing.array : initialMeshPaintColors(geometry, position.count),
        color,
        this.meshPaintToolSettings.channels,
      );
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
      this.meshPaintData = upsertMeshPaintPlacement(this.meshPaintData, {
        target,
        vertexCount: position.count,
        colors: Array.from(colors),
        positions: Array.from(position.array as ArrayLike<number>),
      });
      changed += 1;
    }
    if (changed > 0) {
      this.meshPaintDataDirty = true;
      this.onStatus?.(`Filled ${changed} mesh primitive${changed === 1 ? "" : "s"}.`, "success");
      this.onMeshPaintChanged?.();
    }
  }

  copySelectedMeshPaint(): void {
    const selection = this.selectedMeshPaintInstance();
    if (!selection) return;
    const copied = this.meshPaintData.placements.filter(
      (entry) =>
        entry.target.assetId === selection.assetId &&
        entry.target.placementIndex === selection.placementIndex,
    );
    if (copied.length === 0) {
      this.onStatus?.("Selected placement has no Mesh Paint data to copy.", "warning");
      return;
    }
    this.meshPaintClipboard = copied.map((entry) => ({
      target: { ...entry.target },
      vertexCount: entry.vertexCount,
      colors: [...entry.colors],
      ...(entry.positions ? { positions: [...entry.positions] } : {}),
    }));
    this.onStatus?.(`Copied ${copied.length} mesh primitive${copied.length === 1 ? "" : "s"}.`, "success");
    this.onMeshPaintChanged?.();
  }

  /** Pastes compatible primitive colors onto the selected placement. */
  pasteSelectedMeshPaint(): void {
    const selection = this.selectedMeshPaintInstance();
    if (!selection || this.meshPaintClipboard.length === 0) {
      this.onStatus?.("Copy Mesh Paint data before pasting.", "warning");
      return;
    }
    if (!this.ensureMeshPaintPlacementData(selection)) return;
    const targets = this.meshPaintData.placements.filter(
      (entry) =>
        entry.target.assetId === selection.assetId &&
        entry.target.placementIndex === selection.placementIndex,
    );
    let pasted = 0;
    for (const source of this.meshPaintClipboard) {
      const target = targets.find(
        (entry) =>
          entry.target.meshName === source.target.meshName &&
          entry.target.primitiveIndex === source.target.primitiveIndex &&
          entry.vertexCount === source.vertexCount,
      );
      if (!target) continue;
      this.meshPaintData = upsertMeshPaintPlacement(this.meshPaintData, {
        target: { ...target.target },
        vertexCount: source.vertexCount,
        colors: [...source.colors],
        ...(target.positions ? { positions: [...target.positions] } : {}),
      });
      pasted += 1;
    }
    if (pasted === 0) {
      this.onStatus?.("Paste skipped: selected placement topology is incompatible.", "warning");
      return;
    }
    this.meshPaintDataDirty = true;
    this.rebuildInstanceGroup(selection.assetId);
    this.onStatus?.(`Pasted ${pasted} mesh primitive${pasted === 1 ? "" : "s"}.`, "success");
    this.onMeshPaintChanged?.();
  }

  hasMeshPaintClipboard(): boolean {
    return this.meshPaintClipboard.length > 0;
  }

  /**
   * Promotes this placement's painted primitive colours into the model sidecar.
   * It intentionally does not change other placements; `To Instances` is a
   * separate, explicit operation that applies these defaults on demand.
   */
  async transferSelectedMeshPaintToAsset(): Promise<void> {
    const selection = this.selectedMeshPaintInstance();
    const asset = this.manifest && selection ? assetRecordById(this.manifest, selection.assetId) : undefined;
    if (!selection || !asset || !isModelAssetType(assetType(asset))) {
      this.onStatus?.("Select a static-mesh placement before using To Mesh.", "warning");
      return;
    }
    const painted = this.meshPaintData.placements.filter(
      (entry) => entry.target.assetId === selection.assetId && entry.target.placementIndex === selection.placementIndex,
    );
    if (painted.length === 0) {
      this.onStatus?.("Selected placement has no Mesh Paint data to transfer.", "warning");
      return;
    }
    try {
      const modelPath = assetPath(asset);
      let vertexColors = await loadAssetVertexColors(modelPath);
      for (const entry of painted) {
        vertexColors = upsertAssetVertexColorMesh(vertexColors, {
          meshName: entry.target.meshName,
          primitiveIndex: entry.target.primitiveIndex,
          vertexCount: entry.vertexCount,
          colors: entry.colors,
          ...(entry.positions ? { positions: entry.positions } : {}),
        });
      }
      const result = await saveAssetVertexColors(modelPath, vertexColors);
      this.onStatus?.(
        result.changed
          ? `Transferred ${painted.length} painted primitive${painted.length === 1 ? "" : "s"} to ${result.path}.`
          : "Asset vertex-color defaults already match the selected placement.",
        "success",
      );
    } catch (error) {
      this.onStatus?.(
        `To Mesh failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /** Applies compatible asset defaults to this placement without affecting its peers. */
  async applyAssetVertexColorsToSelectedMeshPaint(): Promise<void> {
    const selection = this.selectedMeshPaintInstance();
    const asset = this.manifest && selection ? assetRecordById(this.manifest, selection.assetId) : undefined;
    const gltf = selection ? this.models.get(selection.assetId) : undefined;
    if (!selection || !asset || !gltf || !isModelAssetType(assetType(asset))) {
      this.onStatus?.("Select a loaded static-mesh placement before using To Instances.", "warning");
      return;
    }
    try {
      const vertexColors = await loadAssetVertexColors(assetPath(asset));
      if (vertexColors.meshes.length === 0) {
        this.onStatus?.("This asset has no vertex-color defaults. Use To Mesh on a painted placement first.", "warning");
        return;
      }
      const sourcePrimitives = meshPaintPlacementsFromModel(selection, gltf);
      let applied = 0;
      for (const defaults of vertexColors.meshes) {
        const target = sourcePrimitives.find(
          (entry) =>
            entry.target.meshName === defaults.meshName &&
            entry.target.primitiveIndex === defaults.primitiveIndex &&
            entry.vertexCount === defaults.vertexCount,
        );
        if (!target) continue;
        this.meshPaintData = upsertMeshPaintPlacement(this.meshPaintData, {
          target: target.target,
          vertexCount: defaults.vertexCount,
          colors: [...defaults.colors],
          ...(target.positions ? { positions: [...target.positions] } : {}),
        });
        applied += 1;
      }
      if (applied === 0) {
        this.onStatus?.("Asset defaults are incompatible with this placement's current mesh topology.", "warning");
        return;
      }
      this.meshPaintDataDirty = true;
      this.rebuildInstanceGroup(selection.assetId);
      this.onStatus?.(`Applied ${applied} asset vertex-color default${applied === 1 ? "" : "s"} to the selected placement.`, "success");
      this.onMeshPaintChanged?.();
    } catch (error) {
      this.onStatus?.(
        `To Instances failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  /** Repairs a selected placement after reimport by nearest old local-space vertex. */
  fixSelectedMeshPaintTopology(): void {
    const selection = this.selectedMeshPaintInstance();
    const gltf = selection ? this.models.get(selection.assetId) : undefined;
    if (!selection || !gltf) {
      this.onStatus?.("Select a loaded painted placement before using Fix Mesh Paint.", "warning");
      return;
    }
    const existing = this.meshPaintData.placements.filter(
      (entry) => entry.target.assetId === selection.assetId && entry.target.placementIndex === selection.placementIndex,
    );
    if (existing.length === 0) {
      this.onStatus?.("Selected placement has no Mesh Paint data to repair.", "warning");
      return;
    }
    const targetPrimitives = meshPaintPlacementsFromModel(selection, gltf);
    let repaired = 0;
    let skipped = 0;
    for (const source of existing) {
      const target = targetPrimitives.find(
        (entry) =>
          entry.target.meshName === source.target.meshName &&
          entry.target.primitiveIndex === source.target.primitiveIndex,
      );
      if (!target?.positions) {
        skipped += 1;
        continue;
      }
      const repair = repairMeshPaintTopology(source, target.positions);
      if (!repair) {
        skipped += 1;
        continue;
      }
      this.meshPaintData = upsertMeshPaintPlacement(this.meshPaintData, {
        target: target.target,
        vertexCount: target.vertexCount,
        colors: repair.colors,
        positions: repair.positions,
      });
      repaired += 1;
    }
    if (repaired === 0) {
      this.onStatus?.("Mesh Paint repair needs saved source positions and a compatible primitive. Repaint legacy sidecars once before a future reimport.", "warning");
      return;
    }
    this.meshPaintDataDirty = true;
    this.rebuildInstanceGroup(selection.assetId);
    this.onStatus?.(
      skipped > 0
        ? `Repaired ${repaired} mesh primitive${repaired === 1 ? "" : "s"}; skipped ${skipped} incompatible primitive${skipped === 1 ? "" : "s"}.`
        : `Repaired ${repaired} mesh primitive${repaired === 1 ? "" : "s"}.`,
      skipped > 0 ? "warning" : "success",
    );
    this.onMeshPaintChanged?.();
  }

  /** Removes paint data from the selected placement and returns it to shared instancing. */
  clearSelectedMeshPaint(): void {
    const selection = this.selectedMeshPaintInstance();
    if (!selection) return;
    const before = this.meshPaintData.placements.length;
    this.meshPaintData = removeMeshPaintPlacement(
      this.meshPaintData,
      selection.assetId,
      selection.placementIndex,
    );
    if (this.meshPaintData.placements.length === before) return;
    this.meshPaintDataDirty = true;
    this.rebuildInstanceGroup(selection.assetId);
    this.onStatus?.("Cleared Mesh Paint for selected placement.", "success");
    this.onMeshPaintChanged?.();
  }

  private selectedMeshPaintInstance(): InstanceSelection | null {
    if (this.selection?.kind !== "instance" || this.isSelectionLocked(this.selection)) return null;
    return this.selection;
  }

  private ensureMeshPaintPlacementData(selection: InstanceSelection): boolean {
    const alreadyPrepared = this.meshPaintData.placements.some(
      (entry) =>
        entry.target.assetId === selection.assetId &&
        entry.target.placementIndex === selection.placementIndex,
    );
    if (alreadyPrepared) return true;
    const gltf = this.models.get(selection.assetId);
    if (!gltf) return false;
    const placements = meshPaintPlacementsFromModel(selection, gltf);
    if (placements.length === 0) return false;
    for (const placement of placements) {
      this.meshPaintData = upsertMeshPaintPlacement(this.meshPaintData, placement);
    }
    this.meshPaintDataDirty = true;
    this.rebuildInstanceGroup(selection.assetId);
    return true;
  }

  private meshPaintObjects(selection: InstanceSelection): Mesh[] {
    const root = this.instanceOverrideObjects
      .get(selection.assetId)
      ?.find((object) => object.userData.placementIndex === selection.placementIndex);
    if (!root) return [];
    const meshes: Mesh[] = [];
    root.traverse((child) => {
      if (isRenderableMesh(child) && meshPaintTargetFromObject(child)) meshes.push(child);
    });
    return meshes;
  }

  /** Restores the authored materials after a Color View change, selection change, or mode exit. */
  private clearMeshPaintColorView(): void {
    for (const [mesh, material] of this.meshPaintColorViewOriginalMaterials) mesh.material = material;
    this.meshPaintColorViewOriginalMaterials.clear();
    for (const material of this.meshPaintColorViewPreviewMaterials) material.dispose();
    this.meshPaintColorViewPreviewMaterials.clear();
  }

  /** Applies a temporary unlit RGBA/channel preview only to the selected painted placement. */
  private applyMeshPaintColorView(): void {
    this.clearMeshPaintColorView();
    if (!this.meshPaintModeActive || this.meshPaintToolSettings.colorView === "off") return;
    const selection = this.selectedMeshPaintInstance();
    if (!selection) return;
    for (const mesh of this.meshPaintObjects(selection)) {
      this.meshPaintColorViewOriginalMaterials.set(mesh, mesh.material);
      const material = createMeshPaintColorViewMaterial(this.meshPaintToolSettings.colorView);
      this.meshPaintColorViewPreviewMaterials.add(material);
      mesh.material = material;
    }
  }

  private ensureMeshPaintGeometry(object: Mesh): BufferGeometry {
    if (object.geometry.userData.forgeMeshPaintClone === true) return object.geometry;
    const geometry = object.geometry.clone();
    geometry.userData.forgeMeshPaintClone = true;
    object.geometry = geometry;
    return geometry;
  }

  private ensureMeshPaintBrushCursor(): Mesh {
    if (this.meshPaintBrushCursor) return this.meshPaintBrushCursor;
    const cursor = new Mesh(
      new RingGeometry(0.96, 1, 96),
      new MeshBasicMaterial({
        color: 0xf27836,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    cursor.name = "mesh-paint-brush-cursor";
    cursor.renderOrder = 20;
    cursor.visible = false;
    this.meshPaintBrushCursor = cursor;
    this.scene.add(cursor);
    return cursor;
  }

  updateMeshPaintBrushHover(clientX: number, clientY: number): void {
    const selection = this.meshPaintModeActive ? this.selectedMeshPaintInstance() : null;
    if (!selection) return this.clearMeshPaintBrushHover();
    const hit = this.picker.pickMeshPaintSurface(clientX, clientY, selection);
    if (!hit) return this.clearMeshPaintBrushHover();
    const cursor = this.ensureMeshPaintBrushCursor();
    cursor.position.copy(hit.point).addScaledVector(hit.normal, 0.01);
    cursor.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), hit.normal);
    cursor.scale.setScalar(this.meshPaintToolSettings.brushSize);
    cursor.visible = true;
  }

  clearMeshPaintBrushHover(): void {
    if (this.meshPaintBrushCursor) this.meshPaintBrushCursor.visible = false;
  }

  beginMeshPaintStroke(event: PointerEvent): boolean {
    if (!this.meshPaintModeActive) return false;
    const selection = this.selectedMeshPaintInstance();
    if (!selection || !this.ensureMeshPaintPlacementData(selection)) return false;
    const hit = this.picker.pickMeshPaintSurface(event.clientX, event.clientY, selection);
    if (!hit) return false;
    this.meshPaintStrokePointerId = event.pointerId;
    this.meshPaintFlowPointer = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      erase: event.shiftKey,
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.applyMeshPaintDab(hit, 1, event.shiftKey);
    return true;
  }

  updateMeshPaintStroke(event: PointerEvent): boolean {
    if (this.meshPaintStrokePointerId !== event.pointerId) return false;
    this.meshPaintFlowPointer = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      erase: event.shiftKey,
    };
    const selection = this.selectedMeshPaintInstance();
    if (!selection) return true;
    const hit = this.picker.pickMeshPaintSurface(event.clientX, event.clientY, selection);
    if (hit) this.applyMeshPaintDab(hit, 1, event.shiftKey);
    this.updateMeshPaintBrushHover(event.clientX, event.clientY);
    return true;
  }

  endMeshPaintStroke(event: PointerEvent): boolean {
    if (this.meshPaintStrokePointerId !== event.pointerId) return false;
    this.meshPaintStrokePointerId = null;
    this.meshPaintFlowPointer = null;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may have released capture after a pointercancel.
    }
    return true;
  }

  private updateMeshPaintFlow(deltaSeconds: number): void {
    const pointer = this.meshPaintFlowPointer;
    if (!pointer || !this.meshPaintModeActive || this.meshPaintToolSettings.flow <= 0) return;
    const selection = this.selectedMeshPaintInstance();
    if (!selection || this.meshPaintStrokePointerId !== pointer.pointerId) return;
    const hit = this.picker.pickMeshPaintSurface(pointer.clientX, pointer.clientY, selection);
    if (!hit) return;
    // A frame-rate independent continuous paint rate; one means a firm brush,
    // while zero leaves ordinary pointer dabs unchanged.
    this.applyMeshPaintDab(
      hit,
      Math.min(1, deltaSeconds * this.meshPaintToolSettings.flow * 8),
      pointer.erase,
    );
  }

  private applyMeshPaintDab(
    hit: MeshPaintSurfacePick,
    strengthMultiplier = 1,
    forceErase = false,
  ): void {
    if (
      this.meshPaintToolSettings.ignoreBackfaces &&
      hit.normal.dot(this.editorViewportCamera().position.clone().sub(hit.point)) <= 0
    ) {
      return;
    }
    const target = meshPaintTargetFromObject(hit.object);
    const position = hit.object.geometry.getAttribute("position");
    if (!target || !position) return;
    const geometry = this.ensureMeshPaintGeometry(hit.object);
    const existing = geometry.getAttribute("color");
    const local = hit.object.worldToLocal(hit.point.clone());
    const color = forceErase || this.meshPaintToolSettings.tool === "erase"
      ? ([0, 0, 0, 0] as const)
      : this.meshPaintToolSettings.color;
    const result = paintMeshVertexColors(
      position.array,
      existing?.itemSize === 4 ? existing.array : initialMeshPaintColors(geometry, position.count),
      [local.x, local.y, local.z],
      {
        radius: this.meshPaintToolSettings.brushSize,
        strength: this.meshPaintToolSettings.strength * strengthMultiplier,
        falloff: this.meshPaintToolSettings.falloff,
        channels: this.meshPaintToolSettings.channels,
        color,
      },
    );
    if (result.changedVertices === 0) return;
    geometry.setAttribute("color", new Float32BufferAttribute(result.colors, 4));
    this.meshPaintData = upsertMeshPaintPlacement(this.meshPaintData, {
      target,
      vertexCount: position.count,
      colors: Array.from(result.colors),
      positions: Array.from(position.array as ArrayLike<number>),
    });
    this.meshPaintDataDirty = true;
  }

  private async saveMeshPaintSidecar(): Promise<void> {
    if (!this.meshPaintDataDirty) return;
    if (!this.activeProject) throw new Error("Mesh Paint save requires an active project.");
    await saveMeshPaintData(
      meshPaintDataPath(this.activeProject.manifest.editor.defaultScene),
      this.meshPaintData,
    );
    this.meshPaintDataDirty = false;
  }

  /** Fetches a landscape sidecar (public-root-relative path); flat Medium data on any failure. */
  private async fetchLandscapeData(dataRef: string): Promise<ForgeLandscapeData> {
    try {
      const response = await fetch(`/${dataRef}`);
      if (!response.ok) return createFlatLandscapeData("medium");
      return (await response.json()) as ForgeLandscapeData;
    } catch {
      return createFlatLandscapeData("medium");
    }
  }

  /** Cheap transform/visibility sync for one landscape (gizmo drag). */
  private refreshLandscapeObject(index: number): void {
    const actor = this.layout?.landscapes?.[index];
    const object = this.landscapeObjects[index];
    if (!actor || !object) return;
    applyLandscapeTransform(object, this.landscapeItem(actor));
  }

  private refreshLandscapeIndices(): void {
    this.landscapeObjects.forEach((object, index) => {
      object.userData.landscapeIndex = index;
      object.traverse((child) => {
        child.userData.landscapeIndex = index;
      });
    });
  }

  private landscapeLocalHit(clientX: number, clientY: number): {
    landscapeIndex: number;
    local: Vector3;
  } | null {
    const hit = this.picker.pickLandscapeSurface(clientX, clientY);
    if (!hit) return null;
    const object = this.landscapeObjects[hit.index];
    if (!object) return null;
    return { landscapeIndex: hit.index, local: object.worldToLocal(hit.point.clone()) };
  }

  private selectedEditableLandscapeIndex(): number | null {
    if (this.selection?.kind !== "landscape") return null;
    if (this.isSelectionLocked(this.selection)) return null;
    return this.selection.index;
  }

  private ensureLandscapeBrushCursor(): Mesh {
    if (this.landscapeBrushCursor) return this.landscapeBrushCursor;
    const cursor = new Mesh(
      new RingGeometry(0.96, 1, 96),
      new MeshBasicMaterial({
        color: 0xf2d16b,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    cursor.name = "landscape-brush-cursor";
    cursor.rotation.x = -Math.PI / 2;
    cursor.renderOrder = 20;
    cursor.visible = false;
    this.landscapeBrushCursor = cursor;
    this.scene.add(cursor);
    return cursor;
  }

  private updateLandscapeBrushCursorScale(): void {
    if (!this.landscapeBrushCursor) return;
    this.landscapeBrushCursor.scale.setScalar(this.landscapeSculptSettings.brushSize);
  }

  private updateLandscapeBrushHover(clientX: number, clientY: number): void {
    // Foliage mode owns the brush cursor; never show the landscape sculpt ring too.
    if (this.foliageModeActive || this.meshPaintModeActive) {
      this.clearLandscapeBrushHover();
      return;
    }
    const selectedIndex = this.selectedEditableLandscapeIndex();
    if (selectedIndex === null) {
      this.clearLandscapeBrushHover();
      return;
    }
    const hit = this.picker.pickLandscapeSurface(clientX, clientY);
    if (!hit || hit.index !== selectedIndex) {
      this.clearLandscapeBrushHover();
      return;
    }
    const cursor = this.ensureLandscapeBrushCursor();
    cursor.position.copy(hit.point);
    cursor.position.y += 0.03;
    cursor.visible = true;
    this.updateLandscapeBrushCursorScale();
  }

  private clearLandscapeBrushHover(): void {
    if (this.landscapeBrushCursor) this.landscapeBrushCursor.visible = false;
  }

  private beginLandscapeSculpt(event: PointerEvent): boolean {
    // Foliage Mode disables terrain sculpting entirely (its brush owns the pointer).
    if (this.foliageModeActive || this.meshPaintModeActive) return false;
    if (this.landscapeSculptSettings.editMode === "splines") {
      return this.addLandscapeSplinePointAtPointer(event);
    }
    const selectedIndex = this.selectedEditableLandscapeIndex();
    if (selectedIndex === null) return false;
    const hit = this.landscapeLocalHit(event.clientX, event.clientY);
    if (!hit || hit.landscapeIndex !== selectedIndex) return false;
    const actor = this.layout?.landscapes?.[selectedIndex];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return false;
    this.landscapeSculptStroke = {
      pointerId: event.pointerId,
      landscapeIndex: selectedIndex,
      landscapeId: actor.id,
      mode: this.landscapeSculptSettings.editMode,
      beforeHeights: [...data.heights],
      beforeLayers: cloneLandscapeLayers(data.layers),
      changed: false,
      dirty: null,
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.applyLandscapeSculptDab(selectedIndex, hit.local);
    return true;
  }

  /**
   * Screen-space pick of a spline control-point marker on the selected landscape
   * (Faz 6.1). The overlay markers stay out of the generic raycaster, so this
   * projects each point's world position to the viewport and returns the closest
   * within a small pixel radius. Returns `null` when nothing is close enough.
   */
  private pickLandscapeSplinePoint(
    clientX: number,
    clientY: number,
  ): { splineId: string; pointId: string } | null {
    if (this.selection?.kind !== "landscape" || this.landscapeSculptSettings.editMode !== "splines") {
      return null;
    }
    const index = this.selection.index;
    const object = this.landscapeObjects[index];
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!object || !data?.splines?.length) return null;
    object.updateWorldMatrix(true, false);
    const camera = this.editorViewportCamera();
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const threshold = 14; // px — matches the on-screen marker footprint.
    const projected = new Vector3();
    let best: { splineId: string; pointId: string; dist: number } | null = null;
    for (const spline of data.splines) {
      for (const point of spline.points) {
        projected
          .set(point.position[0], point.position[1] + 0.4, point.position[2])
          .applyMatrix4(object.matrixWorld)
          .project(camera);
        if (projected.z < -1 || projected.z > 1) continue; // behind camera / clipped
        const sx = (projected.x * 0.5 + 0.5) * rect.width;
        const sy = (-projected.y * 0.5 + 0.5) * rect.height;
        const dist = Math.hypot(sx - px, sy - py);
        if (dist <= threshold && (!best || dist < best.dist)) {
          best = { splineId: spline.id, pointId: point.id, dist };
        }
      }
    }
    return best ? { splineId: best.splineId, pointId: best.pointId } : null;
  }

  /**
   * Resolves the spline control point the move gizmo should target: the active
   * point of the selected, unlocked landscape while in Splines mode (Faz 6.1).
   * Returns its owning object + world position, or `null` when no point is active.
   */
  private activeLandscapeSplinePoint(): LandscapeSplinePointGizmoTarget | null {
    if (
      this.selection?.kind !== "landscape" ||
      this.landscapeSculptSettings.editMode !== "splines" ||
      this.landscapeSculptSettings.splineTool !== "edit"
    ) {
      // The move gizmo only targets a control point in the "edit" sub-mode; in
      // "draw" mode a marker click welds/closes instead of selecting for drag.
      return null;
    }
    const { activeSplineId, activeSplinePointId } = this.landscapeSculptSettings;
    if (!activeSplineId || !activeSplinePointId) return null;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const object = this.landscapeObjects[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || actor.locked || !object || !data) return null;
    const point = data.splines
      ?.find((spline) => spline.id === activeSplineId)
      ?.points.find((entry) => entry.id === activeSplinePointId);
    if (!point) return null;
    object.updateWorldMatrix(true, false);
    const world = new Vector3(point.position[0], point.position[1], point.position[2]).applyMatrix4(
      object.matrixWorld,
    );
    return { index, landscapeId: actor.id, object, splineId: activeSplineId, pointId: activeSplinePointId, world };
  }

  /**
   * Splines mode click. Extends the active spline from its "pen tip" (the active
   * control point, else the last point): a plain click adds a new connected point,
   * while a click near an existing point of the same spline welds to it instead of
   * duplicating — connecting the pen tip to that point. Welding lets a road close
   * into a loop (click the first point) or branch (select a mid point, then click).
   */
  private addLandscapeSplinePointAtPointer(event: PointerEvent): boolean {
    const index = this.selectedEditableLandscapeIndex();
    if (index === null) return false;
    // In the "edit" sub-mode a click selects an existing control-point marker so
    // the move gizmo can drag it (Faz 6.1); empty terrain does nothing. Authoring
    // (add / weld / close / branch) lives in the "draw" sub-mode below, so a
    // marker click there falls through to the weld logic instead of being hijacked.
    if (this.landscapeSculptSettings.splineTool === "edit") {
      const marker = this.pickLandscapeSplinePoint(event.clientX, event.clientY);
      if (!marker) return false;
      this.setLandscapeSculptSettings({
        activeSplineId: marker.splineId,
        activeSplinePointId: marker.pointId,
        activeSplineSegmentId: null,
      });
      this.emitSelectionChanged();
      this.updateGizmo();
      return true;
    }
    const hit = this.landscapeLocalHit(event.clientX, event.clientY);
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!hit || hit.landscapeIndex !== index || !actor || !data) return false;
    const before = cloneLandscapeSplines(data.splines ?? []);
    let spline = before.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId);
    if (!spline) {
      const used = new Set(before.map((entry) => entry.id));
      let number = 1;
      while (used.has(`spline-${number}`)) number += 1;
      spline = { id: `spline-${number}`, name: `Spline ${number}`, points: [], segments: [] };
      before.push(spline);
    }
    const local: Vec3 = [round(hit.local.x), round(hit.local.y), round(hit.local.z)];
    const from =
      spline.points.find((point) => point.id === this.landscapeSculptSettings.activeSplinePointId) ??
      spline.points.at(-1);
    // Weld radius scales with the terrain footprint so it feels the same at any size.
    const worldSize = (data.size.verticesX - 1) * data.size.spacing;
    const weldDist = Math.max(1.5, worldSize * 0.02);
    // Search every spline, not just the active one, so a click can weld onto a
    // point of another spline to fork/join two roads. The nearest point wins
    // regardless of which spline owns it; `from` (the pen tip) is excluded by
    // reference so it can't weld to itself.
    const weldTarget = before
      .flatMap((entry) =>
        entry.points
          .filter((point) => point !== from)
          .map((point) => ({
            spline: entry,
            point,
            distance: Math.hypot(point.position[0] - local[0], point.position[2] - local[2]),
          })),
      )
      .filter((entry) => entry.distance <= weldDist)
      .sort((a, b) => a.distance - b.distance)[0];

    let activeSplineId = spline.id;
    let activePointId: string;
    if (weldTarget && weldTarget.spline !== spline) {
      // Cross-spline weld: fold the active spline into the target so the shared
      // point becomes a real fork, then connect the pen tip (remapped) to it.
      const idMap = this.mergeSplineInto(weldTarget.spline, spline);
      const merged = before.indexOf(spline);
      if (merged >= 0) before.splice(merged, 1);
      if (from) this.linkSplineSegment(weldTarget.spline, idMap.get(from.id) ?? from.id, weldTarget.point.id);
      activeSplineId = weldTarget.spline.id;
      activePointId = weldTarget.point.id;
    } else if (weldTarget) {
      if (from && from.id !== weldTarget.point.id) this.linkSplineSegment(spline, from.id, weldTarget.point.id);
      activePointId = weldTarget.point.id; // continue authoring from the welded point
    } else {
      const pointId = uniqueSplinePointId(spline);
      spline.points.push({ id: pointId, position: local, width: 6, falloff: 3 });
      if (from) this.linkSplineSegment(spline, from.id, pointId);
      activePointId = pointId;
    }
    this.applySelectedLandscapeSplines(index, actor.id, data.splines ? cloneLandscapeSplines(data.splines) : [], before, "Add Landscape Spline Point", activeSplineId, activePointId);
    return true;
  }

  /** Adds a segment between two points if one doesn't already connect them (either direction). */
  private linkSplineSegment(spline: ForgeLandscapeSpline, startPointId: string, endPointId: string): void {
    const exists = spline.segments.some(
      (segment) =>
        (segment.startPointId === startPointId && segment.endPointId === endPointId) ||
        (segment.startPointId === endPointId && segment.endPointId === startPointId),
    );
    if (exists) return;
    spline.segments.push({ id: uniqueSplineSegmentId(spline), startPointId, endPointId });
  }

  /**
   * Folds `source`'s points and segments into `target`, remapping their ids to
   * stay unique within `target`, and returns the old→new point-id map so the
   * caller can reconnect the pen tip. This lets a draw-mode weld onto another
   * spline's point fork/join two roads into one spline with a genuinely shared
   * branch point (instead of leaving a coincident duplicate).
   */
  private mergeSplineInto(
    target: ForgeLandscapeSpline,
    source: ForgeLandscapeSpline,
  ): Map<string, string> {
    const idMap = new Map<string, string>();
    for (const point of source.points) {
      const newId = uniqueSplinePointId(target);
      idMap.set(point.id, newId);
      target.points.push({ ...point, id: newId, position: [...point.position] as Vec3 });
    }
    for (const segment of source.segments) {
      target.segments.push({
        ...segment,
        id: uniqueSplineSegmentId(target),
        startPointId: idMap.get(segment.startPointId) ?? segment.startPointId,
        endPointId: idMap.get(segment.endPointId) ?? segment.endPointId,
      });
    }
    return idMap;
  }

  /** Closes the active spline into a loop by linking its last point back to its first. */
  closeSelectedLandscapeSpline(): void {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const spline = after.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId);
    if (!spline || spline.points.length < 3) {
      this.onStatus?.("Add at least three control points before closing the loop.", "info");
      return;
    }
    const first = spline.points[0]!;
    const last = spline.points.at(-1)!;
    if (first.id === last.id) return;
    const segmentCountBefore = spline.segments.length;
    this.linkSplineSegment(spline, last.id, first.id);
    if (spline.segments.length === segmentCountBefore) {
      this.onStatus?.("The spline loop is already closed.", "info");
      return;
    }
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Close Landscape Spline Loop", spline.id, first.id);
  }

  private updateLandscapeSculpt(event: PointerEvent): boolean {
    const stroke = this.landscapeSculptStroke;
    if (!stroke || stroke.pointerId !== event.pointerId) return false;
    const hit = this.landscapeLocalHit(event.clientX, event.clientY);
    if (!hit || hit.landscapeIndex !== stroke.landscapeIndex) return true;
    this.applyLandscapeSculptDab(stroke.landscapeIndex, hit.local);
    this.updateLandscapeBrushHover(event.clientX, event.clientY);
    return true;
  }

  private endLandscapeSculpt(event: PointerEvent): boolean {
    const stroke = this.landscapeSculptStroke;
    if (!stroke || stroke.pointerId !== event.pointerId) return false;
    this.landscapeSculptStroke = null;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be gone after pointercancel.
    }
    const actor = this.layout?.landscapes?.[stroke.landscapeIndex];
    const data = actor ? this.landscapeData.get(stroke.landscapeId) : null;
    if (!actor || !data || !stroke.changed) return true;
    const before = stroke.beforeHeights;
    const after = [...data.heights];
    const beforeLayers = stroke.beforeLayers;
    const afterLayers = cloneLandscapeLayers(data.layers);
    const dirty = stroke.dirty;
    const selection: Selection = { kind: "landscape", index: stroke.landscapeIndex };
    const applySnapshot = (heights: number[], layers: LandscapeLayerWeights[]): void => {
      const current = this.landscapeData.get(stroke.landscapeId);
      if (!current) return;
      current.heights = [...heights];
      current.layers = cloneLandscapeLayers(layers);
      ensureLandscapeLayers(current);
      this.landscapeDataDirty.add(stroke.landscapeId);
      if (dirty) this.refreshLandscapeGeometry(stroke.landscapeIndex, dirty);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    const label =
      stroke.mode === "paint"
        ? `Landscape ${this.landscapeSculptSettings.paintTool}`
        : `Landscape ${this.landscapeSculptSettings.tool}`;
    this.executeCommand({
      label,
      redo: () => applySnapshot(after, afterLayers),
      undo: () => applySnapshot(before, beforeLayers),
    });
    return true;
  }

  private refreshLandscapeGeometry(index: number, dirty: LandscapeDirtyBounds): void {
    const actor = this.layout?.landscapes?.[index];
    const object = this.landscapeObjects[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !object || !data) return;
    updateLandscapeObjectGeometry(
      object,
      data,
      dirty,
      this.landscapeSculptSettings.viewMode,
      this.landscapeSculptSettings.activeLayerId,
      this.resolveLandscapeLayerColors(data),
    );
    this.scheduleLandscapeFoliageRebuild(actor.id);
  }

  private landscapeFullDirtyBounds(data: ForgeLandscapeData): LandscapeDirtyBounds {
    return {
      x0: 0,
      x1: data.size.verticesX - 1,
      z0: 0,
      z1: data.size.verticesZ - 1,
    };
  }

  private refreshAllLandscapeGeometry(): void {
    const landscapes = this.layout?.landscapes ?? [];
    landscapes.forEach((actor, index) => {
      const data = this.landscapeData.get(actor.id);
      if (!data) return;
      this.refreshLandscapeGeometry(index, this.landscapeFullDirtyBounds(data));
    });
  }

  private applyLandscapeSculptDab(index: number, localHit: Vector3): void {
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    const stroke = this.landscapeSculptStroke;
    if (!actor || !data || !stroke) return;
    const dirty =
      stroke.mode === "paint"
        ? this.editLandscapeWeights(data, localHit)
        : this.editLandscapeHeights(data, localHit);
    if (!dirty) return;
    stroke.changed = true;
    stroke.dirty = stroke.dirty ? mergeLandscapeDirtyBounds(stroke.dirty, dirty) : dirty;
    this.landscapeDataDirty.add(actor.id);
    this.refreshLandscapeGeometry(index, dirty);
  }

  private editLandscapeHeights(data: ForgeLandscapeData, localHit: Vector3): LandscapeDirtyBounds | null {
    const { verticesX, verticesZ, spacing, heightScale } = data.size;
    const radius = this.landscapeSculptSettings.brushSize;
    const originX = ((verticesX - 1) * spacing) / 2;
    const originZ = ((verticesZ - 1) * spacing) / 2;
    const centerX = (localHit.x + originX) / spacing;
    const centerZ = (localHit.z + originZ) / spacing;
    const minX = Math.max(0, Math.floor(centerX - radius / spacing));
    const maxX = Math.min(verticesX - 1, Math.ceil(centerX + radius / spacing));
    const minZ = Math.max(0, Math.floor(centerZ - radius / spacing));
    const maxZ = Math.min(verticesZ - 1, Math.ceil(centerZ + radius / spacing));
    const sourceHeights = [...data.heights];
    let changed = false;

    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const worldX = x * spacing - originX;
        const worldZ = z * spacing - originZ;
        const distance = Math.hypot(worldX - localHit.x, worldZ - localHit.z);
        if (distance > radius) continue;
        const falloff = Math.pow(clamp(1 - distance / radius, 0, 1), this.landscapeSculptSettings.falloff);
        if (falloff <= 0) continue;
        const index = z * verticesX + x;
        const before = data.heights[index] ?? 0;
        const after = this.nextLandscapeHeight(
          sourceHeights,
          verticesX,
          verticesZ,
          x,
          z,
          before,
          localHit.y / Math.max(heightScale, 0.0001),
          falloff,
        );
        if (Math.abs(after - before) <= 0.000001) continue;
        data.heights[index] = Math.round(after * 10_000) / 10_000;
        changed = true;
      }
    }

    return changed ? { x0: minX, x1: maxX, z0: minZ, z1: maxZ } : null;
  }

  private editLandscapeWeights(data: ForgeLandscapeData, localHit: Vector3): LandscapeDirtyBounds | null {
    ensureLandscapeLayers(data);
    const { verticesX, verticesZ, spacing } = data.size;
    const radius = this.landscapeSculptSettings.brushSize;
    const originX = ((verticesX - 1) * spacing) / 2;
    const originZ = ((verticesZ - 1) * spacing) / 2;
    const centerX = (localHit.x + originX) / spacing;
    const centerZ = (localHit.z + originZ) / spacing;
    const minX = Math.max(0, Math.floor(centerX - radius / spacing));
    const maxX = Math.min(verticesX - 1, Math.ceil(centerX + radius / spacing));
    const minZ = Math.max(0, Math.floor(centerZ - radius / spacing));
    const maxZ = Math.min(verticesZ - 1, Math.ceil(centerZ + radius / spacing));
    const sourceLayers = cloneLandscapeLayers(data.layers);
    const activeIndex = Math.max(
      0,
      data.layers.findIndex((layer) => layer.id === this.landscapeSculptSettings.activeLayerId),
    );
    let changed = false;

    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const worldX = x * spacing - originX;
        const worldZ = z * spacing - originZ;
        const distance = Math.hypot(worldX - localHit.x, worldZ - localHit.z);
        if (distance > radius) continue;
        const falloff = Math.pow(clamp(1 - distance / radius, 0, 1), this.landscapeSculptSettings.falloff);
        if (falloff <= 0) continue;
        const vertexIndex = z * verticesX + x;
        if (this.applyLandscapeWeightEdit(data, sourceLayers, vertexIndex, x, z, activeIndex, falloff)) {
          changed = true;
        }
      }
    }

    return changed ? { x0: minX, x1: maxX, z0: minZ, z1: maxZ } : null;
  }

  private applyLandscapeWeightEdit(
    data: ForgeLandscapeData,
    sourceLayers: readonly LandscapeLayerWeights[],
    vertexIndex: number,
    x: number,
    z: number,
    activeIndex: number,
    falloff: number,
  ): boolean {
    const amount = clamp(this.landscapeSculptSettings.strength * falloff, 0, 1);
    const before = data.layers.map((layer) => layer.weights[vertexIndex] ?? 0);

    if (this.landscapeSculptSettings.paintTool === "smoothWeights") {
      for (const [layerIndex, layer] of data.layers.entries()) {
        let total = 0;
        let count = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sx = x + dx;
            const sz = z + dz;
            if (sx < 0 || sx >= data.size.verticesX || sz < 0 || sz >= data.size.verticesZ) continue;
            total += sourceLayers[layerIndex]?.weights[sz * data.size.verticesX + sx] ?? 0;
            count += 1;
          }
        }
        const average = count > 0 ? total / count : before[layerIndex] ?? 0;
        layer.weights[vertexIndex] = (before[layerIndex] ?? 0) + (average - (before[layerIndex] ?? 0)) * amount;
      }
      normalizeLandscapeLayerWeights(data, vertexIndex);
      return data.layers.some(
        (layer, index) => Math.abs((layer.weights[vertexIndex] ?? 0) - (before[index] ?? 0)) > 0.0001,
      );
    }

    const activeLayer = data.layers[activeIndex];
    if (!activeLayer) return false;
    if (this.landscapeSculptSettings.paintTool === "erase") {
      const removed = Math.min(activeLayer.weights[vertexIndex] ?? 0, amount);
      if (removed <= 0.0001) return false;
      activeLayer.weights[vertexIndex] = (activeLayer.weights[vertexIndex] ?? 0) - removed;
      const baseLayer = data.layers[0]!;
      if (activeIndex !== 0) baseLayer.weights[vertexIndex] = (baseLayer.weights[vertexIndex] ?? 0) + removed;
      normalizeLandscapeLayerWeights(data, vertexIndex);
      return true;
    }

    const target = Math.min(1, (activeLayer.weights[vertexIndex] ?? 0) + amount);
    const remaining = 1 - target;
    const otherTotal = data.layers.reduce(
      (total, layer, index) => total + (index === activeIndex ? 0 : layer.weights[vertexIndex] ?? 0),
      0,
    );
    activeLayer.weights[vertexIndex] = target;
    for (const [layerIndex, layer] of data.layers.entries()) {
      if (layerIndex === activeIndex) continue;
      const current = layer.weights[vertexIndex] ?? 0;
      layer.weights[vertexIndex] = otherTotal > 0 ? (current / otherTotal) * remaining : 0;
    }
    normalizeLandscapeLayerWeights(data, vertexIndex);
    return data.layers.some(
      (layer, index) => Math.abs((layer.weights[vertexIndex] ?? 0) - (before[index] ?? 0)) > 0.0001,
    );
  }

  private nextLandscapeHeight(
    sourceHeights: number[],
    verticesX: number,
    verticesZ: number,
    x: number,
    z: number,
    current: number,
    hitHeight: number,
    falloff: number,
  ): number {
    const amount = this.landscapeSculptSettings.strength * falloff;
    if (this.landscapeSculptSettings.tool === "raise") return current + amount;
    if (this.landscapeSculptSettings.tool === "lower") return current - amount;
    if (this.landscapeSculptSettings.tool === "flatten") {
      const target = Number.isFinite(this.landscapeSculptSettings.flattenTargetHeight)
        ? this.landscapeSculptSettings.flattenTargetHeight
        : hitHeight;
      return current + (target - current) * clamp(amount, 0, 1);
    }
    let total = 0;
    let count = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const sx = x + dx;
        const sz = z + dz;
        if (sx < 0 || sx >= verticesX || sz < 0 || sz >= verticesZ) continue;
        total += sourceHeights[sz * verticesX + sx] ?? 0;
        count += 1;
      }
    }
    const average = count > 0 ? total / count : current;
    return current + (average - current) * clamp(amount, 0, 1);
  }

  private insertLandscape(index: number, actor: LayoutLandscape, data: ForgeLandscapeData): void {
    if (!this.layout) return;
    this.layout.landscapes ??= [];
    const insertionIndex = clampIndex(index, this.layout.landscapes.length);
    this.layout.landscapes.splice(insertionIndex, 0, cloneLandscape(actor));
    this.landscapeData.set(actor.id, data);
    this.landscapeDataDirty.add(actor.id);
    const object = createLandscapeObject(this.landscapeItem(actor));
    this.landscapeObjects.splice(insertionIndex, 0, object);
    this.scene.add(object);
    this.refreshLandscapeIndices();
  }

  private removeLandscapeAt(index: number): LayoutLandscape | null {
    if (!this.layout?.landscapes) return null;
    const [removed] = this.layout.landscapes.splice(index, 1);
    const [object] = this.landscapeObjects.splice(index, 1);
    if (object) {
      this.scene.remove(object);
      disposeLandscapeObject(object);
    }
    if (removed) {
      this.landscapeData.delete(removed.id);
    }
    this.refreshLandscapeIndices();
    return removed ? cloneLandscape(removed) : null;
  }

  /** Adds a flat Medium (129x129) Landscape actor at the origin and selects it. */
  addLandscape(): void {
    if (!this.layout) return;
    const landscapes = this.layout.landscapes ?? [];
    if (landscapes.length > 0) {
      this.onStatus?.("Only one Landscape is supported per level in this build.", "error");
      return;
    }
    const id = uniqueLandscapeId(landscapes);
    const actor: LayoutLandscape = {
      id,
      name: uniqueLandscapeName("Landscape", landscapes),
      position: [0, 0, 0],
      dataRef: landscapeDataPath(id),
    };
    const data = createFlatLandscapeData("medium");
    const index = landscapes.length;
    this.executeCommand({
      label: "Add Landscape",
      redo: () => {
        this.insertLandscape(index, actor, data);
        this.select({ kind: "landscape", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
        this.saveLandscapeData(actor.id).catch(() => {});
      },
      undo: () => {
        this.removeLandscapeAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Added Landscape.", "info");
  }

  /** Removes a Landscape actor (undoable). */
  removeLandscape(index: number): void {
    const actor = this.layout?.landscapes?.[index];
    if (!actor) return;
    const snapshot = cloneLandscape(actor);
    const data = this.landscapeData.get(actor.id);
    this.executeCommand({
      label: "Delete Landscape",
      redo: () => {
        this.removeLandscapeAt(index);
        if (this.selection?.kind === "landscape") this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.insertLandscape(index, snapshot, data ?? createFlatLandscapeData("medium"));
        this.select({ kind: "landscape", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Deleted Landscape.", "info");
  }

  /** Applies a partial property edit (name/collision) to a landscape actor as one undoable command. */
  setLandscape(index: number, patch: { collision?: boolean }, label = "Edit Landscape"): void {
    const actor = this.layout?.landscapes?.[index];
    if (!actor) return;
    const previous = cloneLandscape(actor);
    const next = cloneLandscape(actor);
    if (patch.collision !== undefined) next.collision = patch.collision;

    const apply = (value: LayoutLandscape): void => {
      if (!this.layout?.landscapes?.[index]) return;
      this.layout.landscapes[index] = cloneLandscape(value);
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(next),
      undo: () => apply(previous),
    });
  }

  /** Edits the currently selected landscape's collision toggle (Details panel). */
  setSelectedLandscape(patch: { collision?: boolean }): void {
    if (this.selection?.kind !== "landscape") return;
    this.setLandscape(this.selection.index, patch);
  }

  /**
   * Resolved paint layers for the selected landscape: each layer's display name
   * and swatch follow its assigned material (falling back to the built-in preset).
   * Returns the preset four layers if no landscape is selected.
   */
  getSelectedLandscapeLayers(): LandscapeLayerView[] {
    const presets = LANDSCAPE_DEFAULT_LAYERS;
    const presetById = new Map(presets.map((preset) => [preset.id as string, preset] as const));
    const layers =
      this.selection?.kind === "landscape"
        ? this.landscapeData.get(this.layout?.landscapes?.[this.selection.index]?.id ?? "")?.layers
        : undefined;
    const source = layers ?? presets.map((preset) => ({ id: preset.id, name: preset.name, weights: [] }));
    return source.map((layer) => {
      const preset = presetById.get(layer.id);
      const baseName = preset?.name ?? layer.name;
      const presetColor = preset?.color ?? LANDSCAPE_DEFAULT_LAYERS[0]!.color;
      const materialId = ("material" in layer && layer.material) || null;
      return {
        id: layer.id,
        baseName,
        color: materialId
          ? this.landscapeLayerMaterialCache.get(materialId)?.baseColor ?? presetColor
          : presetColor,
        material: materialId,
      };
    });
  }

  getSelectedLandscapeSplines(): LandscapeSplineView[] {
    if (this.selection?.kind !== "landscape") return [];
    const actor = this.layout?.landscapes?.[this.selection.index];
    const splines = actor ? this.landscapeData.get(actor.id)?.splines : undefined;
    return (splines ?? []).map((spline) => ({
      id: spline.id,
      name: spline.name ?? spline.id,
      pointCount: spline.points.length,
      smooth: spline.smooth === true,
    }));
  }

  getSelectedLandscapeSplinePoints(): LandscapeSplinePointView[] {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return [];
    const actor = this.layout?.landscapes?.[this.selection.index];
    const spline = actor
      ? this.landscapeData.get(actor.id)?.splines?.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId)
      : undefined;
    return (spline?.points ?? []).map((point) => ({ id: point.id, position: [...point.position] as Vec3, width: point.width, falloff: point.falloff }));
  }

  getSelectedLandscapeSplineSegments(): LandscapeSplineSegmentView[] {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return [];
    const actor = this.layout?.landscapes?.[this.selection.index];
    const spline = actor ? this.landscapeData.get(actor.id)?.splines?.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId) : undefined;
    return (spline?.segments ?? []).map((segment) => ({
      id: segment.id,
      startPointId: segment.startPointId,
      endPointId: segment.endPointId,
      deform: {
        enabled: segment.deform?.enabled ?? false,
        raiseTerrain: segment.deform?.raiseTerrain ?? true,
        lowerTerrain: segment.deform?.lowerTerrain ?? true,
        flatten: segment.deform?.flatten ?? true,
        targetOffset: segment.deform?.targetOffset ?? 0,
      },
      paint: {
        enabled: segment.paint?.enabled ?? false,
        layerId: segment.paint?.layerId ?? LANDSCAPE_DEFAULT_LAYERS[1]!.id,
        strength: segment.paint?.strength ?? 1,
      },
      mesh: {
        enabled: segment.mesh?.enabled ?? false,
        assetId: segment.mesh?.assetId ?? "",
        spacing: segment.mesh?.spacing ?? 2,
        yawOffset: segment.mesh?.yawOffset ?? 0,
        fitToLength: segment.mesh?.fitToLength !== false,
        alignToTerrain: segment.mesh?.alignToTerrain ?? false,
        bank: segment.mesh?.bank ?? 0,
        deform: segment.mesh?.deform ?? false,
      },
    }));
  }

  /** Updates one spline segment's deform/paint/mesh config (undoable). */
  setSelectedLandscapeSplineSegment(segmentId: string, patch: LandscapeSplineSegmentPatch): void {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const segment = after
      .find((spline) => spline.id === this.landscapeSculptSettings.activeSplineId)
      ?.segments.find((entry) => entry.id === segmentId);
    if (!segment) return;
    if (patch.deform) {
      const current = segment.deform ?? { enabled: false, raiseTerrain: true, lowerTerrain: true, flatten: true };
      segment.deform = {
        enabled: patch.deform.enabled ?? current.enabled,
        raiseTerrain: patch.deform.raiseTerrain ?? current.raiseTerrain,
        lowerTerrain: patch.deform.lowerTerrain ?? current.lowerTerrain,
        flatten: patch.deform.flatten ?? current.flatten,
        ...(patch.deform.targetOffset ?? current.targetOffset
          ? { targetOffset: round(patch.deform.targetOffset ?? current.targetOffset ?? 0) }
          : {}),
      };
    }
    if (patch.paint) {
      const current = segment.paint ?? { enabled: false, layerId: LANDSCAPE_DEFAULT_LAYERS[1]!.id, strength: 1 };
      segment.paint = {
        enabled: patch.paint.enabled ?? current.enabled,
        layerId: patch.paint.layerId ?? current.layerId,
        strength: Math.min(1, Math.max(0, round(patch.paint.strength ?? current.strength))),
      };
    }
    if (patch.mesh) {
      const current = segment.mesh ?? { enabled: false, assetId: "" };
      const assetId = patch.mesh.assetId ?? current.assetId;
      const yawOffset = round(patch.mesh.yawOffset ?? current.yawOffset ?? 0);
      const bank = round(patch.mesh.bank ?? current.bank ?? 0);
      segment.mesh = {
        enabled: patch.mesh.enabled ?? current.enabled,
        assetId,
        ...(patch.mesh.spacing ?? current.spacing
          ? { spacing: Math.max(0.01, round(patch.mesh.spacing ?? current.spacing ?? 2)) }
          : {}),
        ...(yawOffset ? { yawOffset } : {}),
        ...(patch.mesh.fitToLength === false ? { fitToLength: false } : current.fitToLength === false ? { fitToLength: false } : {}),
        ...(current.scale ? { scale: current.scale } : {}),
        ...(current.offset ? { offset: current.offset } : {}),
        ...((patch.mesh.alignToTerrain ?? current.alignToTerrain) ? { alignToTerrain: true } : {}),
        ...(bank ? { bank } : {}),
        ...((patch.mesh.deform ?? current.deform) ? { deform: true } : {}),
        ...(current.collision !== undefined ? { collision: current.collision } : {}),
      };
    }
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Edit Landscape Spline Segment", this.landscapeSculptSettings.activeSplineId, this.landscapeSculptSettings.activeSplinePointId, segmentId);
  }

  /** Destructively bakes the active spline's deform config into the heightfield (undoable). */
  applySelectedLandscapeSplineDeform(): void {
    this.applyActiveLandscapeSplineHeights(
      (data, spline) => applyLandscapeSplineDeform(data, spline),
      "Apply Spline Terrain Deform",
      "No terrain change: enable Deform on a segment, then set a Target Offset or raise/lower control-point heights (flatten does nothing on already-flat terrain).",
    );
  }

  private applyActiveLandscapeSplineHeights(
    run: (data: ForgeLandscapeData, spline: ForgeLandscapeSpline) => { changed: boolean; bounds: LandscapeDirtyBounds | null },
    label: string,
    emptyMessage: string,
  ): void {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    const spline = data?.splines?.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId);
    if (!actor || !data || !spline) return;
    const before = data.heights.slice();
    const result = run(data, spline);
    if (!result.changed || !result.bounds) {
      this.onStatus?.(emptyMessage, "info");
      return;
    }
    const after = data.heights.slice();
    data.heights = before.slice();
    const dirty = result.bounds;
    const selection: Selection = { kind: "landscape", index };
    const apply = (heights: readonly number[]): void => {
      const current = this.landscapeData.get(actor.id);
      if (!current) return;
      current.heights = heights.slice();
      this.landscapeDataDirty.add(actor.id);
      this.refreshLandscapeGeometry(index, dirty);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => apply(after), undo: () => apply(before) });
    this.onStatus?.("Spline terrain deform applied.", "info");
  }

  /** Destructively bakes the active spline's paint config into the paint layers (undoable). */
  applySelectedLandscapeSplinePaint(): void {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    const spline = data?.splines?.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId);
    if (!actor || !data || !spline) return;
    ensureLandscapeLayers(data);
    const before = cloneLandscapeLayers(data.layers);
    const result = applyLandscapeSplinePaint(data, spline);
    if (!result.changed || !result.bounds) {
      this.onStatus?.("No paint applied: enable Paint on a segment and pick a target Layer with Strength > 0.", "info");
      return;
    }
    const after = cloneLandscapeLayers(data.layers);
    data.layers = cloneLandscapeLayers(before);
    const dirty = result.bounds;
    const selection: Selection = { kind: "landscape", index };
    const apply = (layers: LandscapeLayerWeights[]): void => {
      const current = this.landscapeData.get(actor.id);
      if (!current) return;
      current.layers = cloneLandscapeLayers(layers);
      ensureLandscapeLayers(current);
      this.landscapeDataDirty.add(actor.id);
      this.refreshLandscapeGeometry(index, dirty);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label: "Apply Spline Layer Paint", redo: () => apply(after), undo: () => apply(before) });
    this.onStatus?.("Spline layer paint applied.", "info");
  }

  createSelectedLandscapeSpline(): void {
    if (this.selection?.kind !== "landscape") return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const number = before.length + 1;
    const spline: ForgeLandscapeSpline = { id: `spline-${number}`, name: `Spline ${number}`, points: [], segments: [] };
    const after = [...before, spline];
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Create Landscape Spline", spline.id);
  }

  /**
   * Toggles the active spline's smooth/curved flag (Faz 6.2a). When on, segments
   * render and apply as a Catmull-Rom curve; off keeps the straight polyline.
   * Undoable; rebuilds spline meshes so any placed mesh follows the new shape.
   * Baked deform/paint are not re-run — the user re-applies them if desired.
   */
  setSelectedLandscapeSplineSmooth(smooth: boolean): void {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const spline = after.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId);
    if (!spline || (spline.smooth === true) === smooth) return;
    if (smooth) spline.smooth = true;
    else delete spline.smooth;
    this.applySelectedLandscapeSplines(
      index,
      actor.id,
      before,
      after,
      smooth ? "Curve Landscape Spline" : "Straighten Landscape Spline",
      spline.id,
      this.landscapeSculptSettings.activeSplinePointId,
      this.landscapeSculptSettings.activeSplineSegmentId,
    );
  }

  deleteSelectedLandscapeSpline(splineId = this.landscapeSculptSettings.activeSplineId): void {
    if (this.selection?.kind !== "landscape" || !splineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = before.filter((spline) => spline.id !== splineId);
    if (after.length === before.length) return;
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Delete Landscape Spline", after[0]?.id ?? null);
  }

  setSelectedLandscapeSplinePointPosition(pointId: string, position: Vec3): void {
    if (this.selection?.kind !== "landscape" || !Number.isFinite(position[0]) || !Number.isFinite(position[1]) || !Number.isFinite(position[2])) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    const splineId = this.landscapeSculptSettings.activeSplineId;
    if (!actor || !data || !splineId) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const point = after.find((spline) => spline.id === splineId)?.points.find((entry) => entry.id === pointId);
    if (!point) return;
    const next: Vec3 = [round(position[0]), round(position[1]), round(position[2])];
    if (point.position.every((value, axis) => value === next[axis])) return;
    point.position = next;
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Move Landscape Spline Point", splineId, pointId);
  }

  setSelectedLandscapeSplinePointShape(pointId: string, patch: { width?: number; falloff?: number }): void {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const point = after.find((spline) => spline.id === this.landscapeSculptSettings.activeSplineId)?.points.find((entry) => entry.id === pointId);
    if (!point) return;
    const width = patch.width === undefined ? point.width : clamp(patch.width, 0.1, 10000);
    const falloff = patch.falloff === undefined ? point.falloff : clamp(patch.falloff, 0, 10000);
    if (point.width === width && point.falloff === falloff) return;
    point.width = round(width);
    point.falloff = round(falloff);
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Edit Landscape Spline Width", this.landscapeSculptSettings.activeSplineId, pointId, this.landscapeSculptSettings.activeSplineSegmentId);
  }

  splitSelectedLandscapeSplineSegment(segmentId = this.landscapeSculptSettings.activeSplineSegmentId): void {
    if (this.selection?.kind !== "landscape" || !segmentId || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const spline = after.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId);
    const segmentIndex = spline?.segments.findIndex((entry) => entry.id === segmentId) ?? -1;
    const segment = segmentIndex >= 0 ? spline!.segments[segmentIndex] : undefined;
    const start = segment ? spline!.points.find((point) => point.id === segment.startPointId) : undefined;
    const end = segment ? spline!.points.find((point) => point.id === segment.endPointId) : undefined;
    if (!spline || !segment || !start || !end) return;
    const pointId = uniqueSplinePointId(spline);
    const newSegmentId = uniqueSplineSegmentId(spline);
    spline.points.push({ id: pointId, position: [round((start.position[0] + end.position[0]) / 2), round((start.position[1] + end.position[1]) / 2), round((start.position[2] + end.position[2]) / 2)], width: round((start.width + end.width) / 2), falloff: round((start.falloff + end.falloff) / 2) });
    spline.segments.splice(segmentIndex, 1, { ...segment, endPointId: pointId }, { id: newSegmentId, startPointId: pointId, endPointId: end.id });
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Split Landscape Spline Segment", spline.id, pointId, newSegmentId);
  }

  deleteSelectedLandscapeSplinePoint(pointId = this.landscapeSculptSettings.activeSplinePointId): void {
    if (this.selection?.kind !== "landscape" || !pointId || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    const splineId = this.landscapeSculptSettings.activeSplineId;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const spline = after.find((entry) => entry.id === splineId);
    if (!spline || !spline.points.some((point) => point.id === pointId)) return;
    spline.points = spline.points.filter((point) => point.id !== pointId);
    spline.segments = spline.segments.filter((segment) => segment.startPointId !== pointId && segment.endPointId !== pointId);
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Delete Landscape Spline Point", splineId);
  }

  private applySelectedLandscapeSplines(index: number, landscapeId: string, before: ForgeLandscapeSpline[], after: ForgeLandscapeSpline[], label: string, activeSplineId: string | null, activeSplinePointId: string | null = null, activeSplineSegmentId: string | null = null): void {
    const selection: Selection = { kind: "landscape", index };
    const apply = (splines: ForgeLandscapeSpline[]): void => {
      const data = this.landscapeData.get(landscapeId);
      if (!data) return;
      data.splines = cloneLandscapeSplines(splines);
      this.landscapeDataDirty.add(landscapeId);
      this.setLandscapeSculptSettings({ activeSplineId, activeSplinePointId, activeSplineSegmentId });
      void this.rebuildLandscapeSplineMeshes(index);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => apply(after), undo: () => apply(before) });
  }

  /**
   * Assigns (or clears, with `null`) the material of one paint layer on the
   * selected landscape. Undoable; the layer's display name and terrain tint then
   * follow the material. Only the layer's `material` changes — weights are kept.
   */
  setSelectedLandscapeLayerMaterial(layerId: string, materialId: string | null): void {
    if (this.selection?.kind !== "landscape") return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    ensureLandscapeLayers(data);
    const layer = data.layers.find((entry) => entry.id === layerId);
    if (!layer) return;
    const nextMaterial = materialId && materialId.length > 0 ? materialId : null;
    if ((layer.material ?? null) === nextMaterial) return;
    const before = cloneLandscapeLayers(data.layers);
    const after = cloneLandscapeLayers(data.layers).map((entry) =>
      entry.id === layerId
        ? nextMaterial
          ? { ...entry, material: nextMaterial }
          : { id: entry.id, name: entry.name, weights: entry.weights }
        : entry,
    );
    const selection: Selection = { kind: "landscape", index };
    const applyLayers = (layers: LandscapeLayerWeights[]): void => {
      const current = this.landscapeData.get(actor.id);
      if (!current) return;
      current.layers = cloneLandscapeLayers(layers);
      ensureLandscapeLayers(current);
      this.landscapeDataDirty.add(actor.id);
      // A material change swaps the layer's texture, so the splat material itself
      // must be rebuilt (not just geometry); warming then reloads any new texture.
      this.rebuildLandscapeObject(index);
      void this.warmLandscapeLayerMaterials(index);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: nextMaterial ? "Assign Landscape Layer Material" : "Clear Landscape Layer Material",
      redo: () => applyLayers(after),
      undo: () => applyLayers(before),
    });
  }

  fillSelectedLandscapeLayer(layerId = this.landscapeSculptSettings.activeLayerId): void {
    if (this.selection?.kind !== "landscape") return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    ensureLandscapeLayers(data);
    if (!data.layers.some((layer) => layer.id === layerId)) return;
    const before = cloneLandscapeLayers(data.layers);
    const after = cloneLandscapeLayers(data.layers).map((layer) => ({
      ...layer,
      weights: layer.weights.map(() => (layer.id === layerId ? 1 : 0)),
    }));
    const dirty = this.landscapeFullDirtyBounds(data);
    const selection: Selection = { kind: "landscape", index };
    const applyLayers = (layers: LandscapeLayerWeights[]): void => {
      const current = this.landscapeData.get(actor.id);
      if (!current) return;
      current.layers = cloneLandscapeLayers(layers);
      ensureLandscapeLayers(current);
      this.landscapeDataDirty.add(actor.id);
      this.refreshLandscapeGeometry(index, dirty);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: "Landscape Fill Layer",
      redo: () => applyLayers(after),
      undo: () => applyLayers(before),
    });
    this.onStatus?.(`Filled Landscape layer: ${layerId}`, "info");
  }

  /**
   * Imports decoded PNG pixels into the selected landscape without changing its
   * grid resolution. The PNG's luminance is scaled by `heightRange` and baked
   * straight into the sidecar heights — the source image is not stored, so the
   * height scale is chosen at import time and re-import is the way to change it.
   */
  async importSelectedLandscapeHeightmap(
    rgba: ArrayLike<number>,
    width: number,
    height: number,
    heightRange = 20,
  ): Promise<void> {
    if (this.selection?.kind !== "landscape") return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    let samples: number[];
    try {
      samples = resampleLandscapeHeightmap(rgba, width, height, data.size, 1);
    } catch (error) {
      this.onStatus?.(error instanceof Error ? error.message : "Heightmap import failed.", "error");
      return;
    }
    this.lastLandscapeImportHeight = heightRange;
    this.applyImportedLandscapeHeightmap(index, actor.id, samples, heightRange, "Import Landscape Heightmap");
    try {
      await this.saveLandscapeData(actor.id);
    } catch (error) {
      this.onStatus?.(`Heightmap save failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
    this.onStatus?.(`Imported ${width} x ${height} heightmap.`, "info");
  }

  getSelectedLandscapeImportHeight(): number {
    return this.lastLandscapeImportHeight;
  }

  private applyImportedLandscapeHeightmap(
    index: number,
    landscapeId: string,
    samples: readonly number[],
    heightRange: number,
    label: string,
  ): void {
    const data = this.landscapeData.get(landscapeId);
    if (!data) return;
    const before = data.heights.slice();
    const after = samples.map((sample) => Math.round(sample * heightRange * 1_000_000) / 1_000_000);
    const dirty = this.landscapeFullDirtyBounds(data);
    const selection: Selection = { kind: "landscape", index };
    const apply = (heights: readonly number[]): void => {
      const current = this.landscapeData.get(landscapeId);
      if (!current) return;
      current.heights = heights.slice();
      this.landscapeDataDirty.add(landscapeId);
      this.refreshLandscapeGeometry(index, dirty);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => apply(after), undo: () => apply(before) });
  }

  /** Produces a normalized grayscale PNG-ready buffer for the selected landscape. */
  exportSelectedLandscapeHeightmap(): { width: number; height: number; pixels: Uint8ClampedArray } | null {
    if (this.selection?.kind !== "landscape") return null;
    const actor = this.layout?.landscapes?.[this.selection.index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!data) return null;
    return {
      width: data.size.verticesX,
      height: data.size.verticesZ,
      pixels: landscapeHeightsToGrayscale(data),
    };
  }

  getSelectedLandscapeResolution(): { verticesX: number; verticesZ: number; worldSize: number } | null {
    if (this.selection?.kind !== "landscape") return null;
    const actor = this.layout?.landscapes?.[this.selection.index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    return data
      ? {
          verticesX: data.size.verticesX,
          verticesZ: data.size.verticesZ,
          worldSize: (data.size.verticesX - 1) * data.size.spacing,
        }
      : null;
  }

  /** Resamples the selected terrain and paint layers to a supported editor preset. */
  resampleSelectedLandscape(preset: "small" | "medium"): void {
    if (this.selection?.kind !== "landscape") return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const target = landscapeSizeForPreset(preset);
    if (data.size.verticesX === target.verticesX && data.size.verticesZ === target.verticesZ) return;
    const before: ForgeLandscapeData = {
      schema: 1,
      type: "landscape",
      size: { ...data.size },
      chunks: { ...data.chunks },
      heights: [...data.heights],
      layers: cloneLandscapeLayers(data.layers),
    };
    const after = resampleLandscapeData(before, target);
    const selection: Selection = { kind: "landscape", index };
    const apply = (snapshot: ForgeLandscapeData): void => {
      const current = this.landscapeData.get(actor.id);
      if (!current) return;
      current.size = { ...snapshot.size };
      current.chunks = { ...snapshot.chunks };
      current.heights = [...snapshot.heights];
      current.layers = cloneLandscapeLayers(snapshot.layers);
      this.landscapeDataDirty.add(actor.id);
      this.rebuildLandscapeObject(index);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label: "Resample Landscape Resolution", redo: () => apply(after), undo: () => apply(before) });
    this.onStatus?.(`Landscape resampled to ${target.verticesX} x ${target.verticesZ}.`, "info");
  }

  /** Changes the selected terrain's X/Z footprint while retaining its grid and authored data. */
  setSelectedLandscapeWorldSize(worldSize: number): void {
    if (this.selection?.kind !== "landscape" || !Number.isFinite(worldSize)) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeData.get(actor.id) : null;
    if (!actor || !data) return;
    const spacing = worldSize / Math.max(1, data.size.verticesX - 1);
    if (spacing < 0.01 || spacing > 100) {
      this.onStatus?.("Landscape world size is outside the supported range.", "error");
      return;
    }
    if (Math.abs(spacing - data.size.spacing) < 0.000001) return;
    const before = { ...data.size };
    const after = { ...data.size, spacing };
    const selection: Selection = { kind: "landscape", index };
    const apply = (size: typeof data.size): void => {
      const current = this.landscapeData.get(actor.id);
      if (!current) return;
      current.size = { ...size };
      this.landscapeDataDirty.add(actor.id);
      this.rebuildLandscapeObject(index);
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label: "Resize Landscape", redo: () => apply(after), undo: () => apply(before) });
    this.onStatus?.(`Landscape world size set to ${worldSize.toFixed(2)}.`, "info");
  }

  /**
   * Persists one landscape's in-memory sidecar data to disk via `/__save-landscape`.
   * Called after `addLandscape()` and from `saveLayout()` for every dirty landscape,
   * mirroring how the layout itself is saved through the dev-endpoint saver.
   */
  private async saveLandscapeData(landscapeId: string): Promise<void> {
    const actor = this.layout?.landscapes?.find((entry) => entry.id === landscapeId);
    const data = this.landscapeData.get(landscapeId);
    if (!actor || !data) return;
    const response = await fetch("/__save-landscape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: actor.dataRef, landscape: data }),
    });
    if (!response.ok) throw new Error(`Landscape data save failed: HTTP ${response.status}`);
    this.landscapeDataDirty.delete(landscapeId);
  }

  // --- Sphere Reflection Capture (probe) actors ----------------------------

  /** Resolved settings + world transform for a reflection-capture layout actor. */
  private reflectionCaptureItem(
    actor: LayoutSphereReflectionCapture,
  ): SphereReflectionCaptureRenderItem {
    return {
      ...resolveSphereReflectionCapture(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
    };
  }

  /** Rebuilds every capture helper + icon from `layout.reflectionCaptures` (used on load). */
  private buildReflectionCaptures(): void {
    for (const helper of this.reflectionCaptureObjects) {
      this.scene.remove(helper);
      disposeSphereReflectionCaptureObject(helper);
    }
    // Icons share cached material/texture, so just detach them (never dispose).
    for (const icon of this.reflectionCaptureIcons) this.scene.remove(icon);
    this.disposeReflectionCaptureBakes();
    this.reflectionCaptureObjects = [];
    this.reflectionCaptureIcons = [];
    const captures = this.layout?.reflectionCaptures ?? [];
    this.reflectionCaptureBakes = captures.map(() => null);
    captures.forEach((actor, index) => {
      const helper = createSphereReflectionCaptureObject(this.reflectionCaptureItem(actor));
      helper.userData.reflectionCaptureIndex = index;
      this.reflectionCaptureObjects.push(helper);
      this.scene.add(helper);
      const icon = createSphereReflectionCaptureIcon();
      icon.userData.reflectionCaptureIndex = index;
      this.reflectionCaptureIcons.push(icon);
      this.scene.add(icon);
      this.syncReflectionCaptureIcon(index);
    });
    // The influence sphere shows only while the probe is selected; nothing is on
    // load, so hide every helper now (the icons remain the visible markers).
    this.updateReflectionCaptureHelperVisibility();
    // Bake each probe once the whole scene is in place (helpers + icons stay
    // hidden during the cubemap render so they never pollute the reflection).
    captures.forEach((_actor, index) => this.bakeReflectionCaptureAt(index));
  }

  /** Positions a probe's billboard icon at the actor center and tracks `hidden`. */
  private syncReflectionCaptureIcon(index: number): void {
    const icon = this.reflectionCaptureIcons[index];
    const actor = this.layout?.reflectionCaptures?.[index];
    if (!icon || !actor) return;
    icon.position.set(actor.position[0], actor.position[1], actor.position[2]);
    icon.visible = !(actor.hidden ?? false);
  }

  /**
   * Shows each probe's influence-sphere helper only while that probe is selected
   * (and not hidden); the always-visible billboard icon stays the marker the rest
   * of the time. Mirrors the light wireframe's selection-gated visibility.
   */
  private updateReflectionCaptureHelperVisibility(): void {
    this.reflectionCaptureObjects.forEach((helper, index) => {
      const actor = this.layout?.reflectionCaptures?.[index];
      const hidden = actor?.hidden ?? false;
      helper.visible = !hidden && this.isSelectionSelected({ kind: "reflectionCapture", index });
    });
  }

  /**
   * Bakes (or re-bakes) one probe's PMREM cache, disposing any prior bake first.
   * Hidden probes are not baked â€” their cache stays null so they never feed an
   * envMap. Editor-only aids (helpers, gizmo, light icons, mirrors) are hidden for
   * the duration of the cubemap render so the capture sees only the real scene.
   */
  private bakeReflectionCaptureAt(index: number): void {
    const previous = this.reflectionCaptureBakes[index];
    if (previous) disposeSphereReflectionCaptureBake(previous);
    this.reflectionCaptureBakes[index] = null;
    const actor = this.layout?.reflectionCaptures?.[index];
    if (!actor) return;
    const item = this.reflectionCaptureItem(actor);
    if (item.hidden) {
      this.refreshReflectionCaptureStaleTint(index);
      this.applyReflectionCaptureEnvMaps();
      return;
    }
    this.reflectionCaptureBakes[index] = this.withEditorAidsHidden(() =>
      bakeSphereReflectionCapture(this.renderer, this.scene, item),
    );
    this.refreshReflectionCaptureStaleTint(index);
    this.applyReflectionCaptureEnvMaps();
  }

  /** Disposes every cached probe bake and clears the cache array. */
  private disposeReflectionCaptureBakes(): void {
    for (const bake of this.reflectionCaptureBakes) {
      if (bake) disposeSphereReflectionCaptureBake(bake);
    }
    this.reflectionCaptureBakes = [];
  }

  /** Disposes cloned envMap materials created for instanced static fallback clones. */
  private disposeInstanceProbeMaterials(assetId?: string): void {
    const disposeSet = (materials: Material[] | undefined): void => {
      if (!materials) return;
      for (const material of materials) material.dispose();
    };
    if (assetId !== undefined) {
      disposeSet(this.instanceProbeMaterials.get(assetId));
      this.instanceProbeMaterials.delete(assetId);
      return;
    }
    for (const materials of this.instanceProbeMaterials.values()) disposeSet(materials);
    this.instanceProbeMaterials.clear();
  }

  /** The baked, visible probes in layout order (the eligible nearest-probe pool). */
  private eligibleProbeBakes(): SphereReflectionCaptureBake[] {
    return this.reflectionCaptureBakes.filter(
      (bake): bake is SphereReflectionCaptureBake => bake !== null,
    );
  }

  /** The baked probe whose influence best covers `point`, or null for global fallback. */
  private probeBakeForPoint(point: Vec3): SphereReflectionCaptureBake | null {
    const bakes = this.eligibleProbeBakes();
    if (bakes.length === 0) return null;
    const index = selectNearestReflectionCapture(
      point,
      bakes.map((bake) => ({ position: bake.position, radius: bake.radius, priority: bake.priority })),
    );
    return index === null ? null : bakes[index]!;
  }

  /** World-space center of a static placement (bounds center if known, else its origin). */
  private placementWorldCenter(assetId: string, placement: LayoutPlacement): Vec3 {
    const matrix = composePlacementMatrix(placement);
    const bounds = this.localBounds.get(assetId);
    const center = bounds ? bounds.getCenter(new Vector3()) : new Vector3();
    center.applyMatrix4(matrix);
    return [center.x, center.y, center.z];
  }

  /** World-space center of an existing scene object (its current bounding box). */
  private objectWorldCenter(object: Object3D): Vec3 {
    const center = new Box3().setFromObject(object).getCenter(new Vector3());
    return [center.x, center.y, center.z];
  }

  /**
   * Re-assigns nearest-probe envMaps across the scene after the probe bakes change
   * (load / add / remove / recapture / hidden / resolution). Instanced statics are
   * rebuilt so probe-covered placements route to envMap clones (clone-fallback);
   * characters + actors get an in-place material clone + envMap. Called once per
   * bake batch, not per probe.
   */
  private applyReflectionCaptureEnvMaps(): void {
    if (!this.layout) return;
    for (const instance of this.layout.instances) {
      this.rebuildInstanceGroup(instance.assetId);
    }
    const globalEnv = this.scene.environment;
    const globalEnvIntensity = this.scene.environmentIntensity;
    this.characterObjects.forEach((object, index) => {
      const character = this.layout?.characters[index];
      if (!object || !character) return;
      const bake = character.hidden ? null : this.probeBakeForPoint(this.objectWorldCenter(object));
      applyProbeEnvMapToObject(object, bake, globalEnv, globalEnvIntensity);
    });
    this.actorObjects.forEach((object, index) => {
      const actor = this.layout?.actors?.[index];
      if (!object || !actor) return;
      const bake = actor.hidden ? null : this.probeBakeForPoint(this.objectWorldCenter(object));
      applyProbeEnvMapToObject(object, bake, globalEnv, globalEnvIntensity);
    });
    // Instance groups were rebuilt, so refresh the selection outline against the
    // new objects (a selected instance may have become an envMap clone).
    this.updateSelectionBox();
  }

  /**
   * Runs `fn` with the editor-only visual aids hidden, restoring exactly the
   * objects it hid. Used so a reflection-capture cubemap bake sees only the real
   * scene (sky/instances/characters), not the gizmo, probe helpers, light icons,
   * or planar mirrors.
   */
  private withEditorAidsHidden<T>(fn: () => T): T {
    const hidden: Object3D[] = [];
    const hide = (object: Object3D | null | undefined): void => {
      if (object && object.visible) {
        object.visible = false;
        hidden.push(object);
      }
    };
    hide(this.gizmoGroup);
    for (const helper of this.reflectionCaptureObjects) hide(helper);
    for (const icon of this.reflectionCaptureIcons) hide(icon);
    for (const icon of this.worldWidgetIcons) hide(icon);
    for (const reflector of this.reflectionPlaneObjects) hide(reflector);
    for (const icon of this.reflectionPlaneIcons) hide(icon);
    for (const surface of this.reflectiveSurfaceObjects) hide(surface);
    for (const volume of this.blockingVolumeObjects) hide(volume);
    for (const volume of this.aiNavigationVolumeObjects) hide(volume);
    for (const point of this.targetPointObjects) hide(point);
    for (const record of this.lightObjects) hide(record.gizmo);
    try {
      return fn();
    } finally {
      for (const object of hidden) object.visible = true;
    }
  }

  /** Cheap transform/visibility/radius sync for one capture helper + icon (gizmo drag + radius edit). */
  private refreshReflectionCaptureObject(index: number): void {
    const actor = this.layout?.reflectionCaptures?.[index];
    const helper = this.reflectionCaptureObjects[index];
    if (!actor || !helper) return;
    applySphereReflectionCaptureTransform(helper, this.reflectionCaptureItem(actor));
    // The transform sync re-derives helper visibility from `hidden` alone; keep it
    // selection-gated so the influence sphere only shows for the selected probe.
    helper.visible =
      helper.visible && this.isSelectionSelected({ kind: "reflectionCapture", index });
    this.syncReflectionCaptureIcon(index);
    this.refreshReflectionCaptureStaleTint(index);
  }

  /**
   * Repaints one probe helper to flag a stale bake (moved / near-far edited since
   * capture). Cheap pure comparison; an unbaked/hidden probe shows the normal tint.
   * Driven from transform edits and (re)bakes so the amber warning tracks live drags.
   */
  private refreshReflectionCaptureStaleTint(index: number): void {
    const helper = this.reflectionCaptureObjects[index];
    if (!helper) return;
    const bake = this.reflectionCaptureBakes[index];
    const actor = this.layout?.reflectionCaptures?.[index];
    const stale = Boolean(bake && actor && isReflectionCaptureBakeStale(bake, this.reflectionCaptureItem(actor)));
    setSphereReflectionCaptureStale(helper, stale);
  }

  /** Whether the selected probe's cached bake is stale (drives the Details warning). */
  isSelectedReflectionCaptureBakeStale(): boolean {
    if (this.selection?.kind !== "reflectionCapture") return false;
    const index = this.selection.index;
    const bake = this.reflectionCaptureBakes[index];
    const actor = this.layout?.reflectionCaptures?.[index];
    return Boolean(bake && actor && isReflectionCaptureBakeStale(bake, this.reflectionCaptureItem(actor)));
  }

  private refreshReflectionCaptureIndices(): void {
    this.reflectionCaptureObjects.forEach((helper, index) => {
      helper.userData.reflectionCaptureIndex = index;
    });
    this.reflectionCaptureIcons.forEach((icon, index) => {
      icon.userData.reflectionCaptureIndex = index;
    });
  }

  private insertReflectionCapture(index: number, actor: LayoutSphereReflectionCapture): void {
    if (!this.layout) return;
    this.layout.reflectionCaptures ??= [];
    const insertionIndex = clampIndex(index, this.layout.reflectionCaptures.length);
    this.layout.reflectionCaptures.splice(insertionIndex, 0, cloneSphereReflectionCapture(actor));
    const helper = createSphereReflectionCaptureObject(this.reflectionCaptureItem(actor));
    this.reflectionCaptureObjects.splice(insertionIndex, 0, helper);
    this.reflectionCaptureBakes.splice(insertionIndex, 0, null);
    this.scene.add(helper);
    const icon = createSphereReflectionCaptureIcon();
    this.reflectionCaptureIcons.splice(insertionIndex, 0, icon);
    this.scene.add(icon);
    this.refreshReflectionCaptureIndices();
    this.syncReflectionCaptureIcon(insertionIndex);
    this.updateReflectionCaptureHelperVisibility();
    this.bakeReflectionCaptureAt(insertionIndex);
  }

  private removeReflectionCaptureAt(index: number): LayoutSphereReflectionCapture | null {
    if (!this.layout?.reflectionCaptures) return null;
    const [removed] = this.layout.reflectionCaptures.splice(index, 1);
    const [helper] = this.reflectionCaptureObjects.splice(index, 1);
    const [bake] = this.reflectionCaptureBakes.splice(index, 1);
    if (bake) disposeSphereReflectionCaptureBake(bake);
    if (helper) {
      this.scene.remove(helper);
      disposeSphereReflectionCaptureObject(helper);
    }
    const [icon] = this.reflectionCaptureIcons.splice(index, 1);
    if (icon) this.scene.remove(icon);
    this.refreshReflectionCaptureIndices();
    // The removed probe's texture is now disposed â€” re-assign so nothing still
    // references it (covered surfaces fall back to the next probe / global env).
    this.applyReflectionCaptureEnvMaps();
    return removed ? cloneSphereReflectionCapture(removed) : null;
  }

  /** Adds a Sphere Reflection Capture probe (default radius) and selects it. */
  addReflectionCapture(): void {
    if (!this.layout) return;
    const captures = this.layout.reflectionCaptures ?? [];
    const actor: LayoutSphereReflectionCapture = {
      id: uniqueSphereReflectionCaptureId(captures),
      name: uniqueSphereReflectionCaptureName("Sphere Reflection Capture", captures),
      position: [0, 2, 0],
    };
    const index = captures.length;
    this.executeCommand({
      label: "Add Sphere Reflection Capture",
      redo: () => {
        this.insertReflectionCapture(index, actor);
        this.select({ kind: "reflectionCapture", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.removeReflectionCaptureAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    this.onStatus?.("Added Sphere Reflection Capture.", "info");
  }

  /** Removes a Sphere Reflection Capture probe (undoable). */
  removeReflectionCapture(index: number): void {
    const actor = this.layout?.reflectionCaptures?.[index];
    if (!actor) return;
    const snapshot = cloneSphereReflectionCapture(actor);
    this.executeCommand({
      label: "Delete Sphere Reflection Capture",
      redo: () => {
        this.removeReflectionCaptureAt(index);
        if (this.selection?.kind === "reflectionCapture") this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        this.insertReflectionCapture(index, snapshot);
        this.select({ kind: "reflectionCapture", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
  }

  /**
   * Applies a partial probe-property edit (radius/intensity/resolution/near/far/
   * parallax/priority) to a reflection capture as one undoable command. Transform/
   * name/hidden edits flow through the generic selection pipeline; a radius change
   * just re-syncs the helper scale.
   */
  setReflectionCapture(
    index: number,
    patch: {
      radius?: number;
      intensity?: number;
      resolution?: number;
      near?: number;
      far?: number;
      parallax?: boolean;
      priority?: number;
    },
    label = "Edit Sphere Reflection Capture",
  ): void {
    const actor = this.layout?.reflectionCaptures?.[index];
    if (!actor) return;
    const previous = cloneSphereReflectionCapture(actor);
    const next = cloneSphereReflectionCapture(actor);
    if (patch.radius !== undefined) next.radius = patch.radius;
    if (patch.intensity !== undefined) next.intensity = patch.intensity;
    if (patch.resolution !== undefined) next.resolution = patch.resolution;
    if (patch.near !== undefined) next.near = patch.near;
    if (patch.far !== undefined) next.far = patch.far;
    if (patch.parallax !== undefined) next.parallax = patch.parallax;
    if (patch.priority !== undefined) next.priority = patch.priority;

    const apply = (value: LayoutSphereReflectionCapture): void => {
      if (!this.layout?.reflectionCaptures?.[index]) return;
      this.layout.reflectionCaptures[index] = cloneSphereReflectionCapture(value);
      this.refreshReflectionCaptureObject(index);
      // Resolution is baked into the cube target, so a resolution change disposes
      // the old bake and re-captures (which re-assigns envMaps). Radius/intensity/
      // priority/parallax feed selection + envMap clones, so refresh the cached bake
      // scalars and re-assign live without a re-render (parallax toggles the shader
      // patch on the re-clone); near/far only affect the cubemap and wait for an
      // explicit Recapture.
      const baked = this.reflectionCaptureBakes[index];
      const resolved = resolveSphereReflectionCapture(this.layout.reflectionCaptures[index]);
      if (!resolved.hidden && (!baked || baked.resolution !== resolved.resolution)) {
        this.bakeReflectionCaptureAt(index);
      } else if (baked) {
        baked.radius = resolved.radius;
        baked.intensity = resolved.intensity;
        baked.priority = resolved.priority;
        baked.parallax = resolved.parallax;
        this.applyReflectionCaptureEnvMaps();
      }
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(next),
      undo: () => apply(previous),
    });
  }

  /** Edits the currently selected reflection capture's probe settings (Details panel). */
  setSelectedReflectionCapture(patch: {
    radius?: number;
    intensity?: number;
    resolution?: number;
    near?: number;
    far?: number;
    parallax?: boolean;
    priority?: number;
  }): void {
    if (this.selection?.kind !== "reflectionCapture") return;
    this.setReflectionCapture(this.selection.index, patch);
  }

  // --- World-space UI widget markers (editor) ------------------------------

  /** Builds one clickable billboard marker for the world widget at `index`. */
  private createWorldWidgetIcon(index: number): Sprite {
    const icon = createActorBillboardIcon("world-widget", drawWorldWidgetGlyph, 0.5);
    icon.userData.worldWidgetIndex = index;
    return icon;
  }

  /** Positions a marker at its widget's anchor world point (+ any world offset). */
  private positionWorldWidgetIcon(icon: Sprite, widget: WorldUiWidget): void {
    const [px, py, pz] = widget.anchor.worldPos;
    const [ox, oy, oz] = widget.anchor.offset3d ?? [0, 0, 0];
    icon.position.set(px + ox, py + oy, pz + oz);
  }

  /** Rebuilds every world-widget billboard marker from `layout.worldWidgets` (load). */
  private buildWorldWidgetMarkers(): void {
    for (const icon of this.worldWidgetIcons) this.scene.remove(icon);
    this.worldWidgetIcons = [];
    const widgets = this.layout?.worldWidgets ?? [];
    widgets.forEach((widget, index) => {
      const icon = this.createWorldWidgetIcon(index);
      this.positionWorldWidgetIcon(icon, widget);
      this.worldWidgetIcons.push(icon);
      this.scene.add(icon);
    });
  }

  /** Repositions one world-widget marker after its anchor changes. */
  private refreshWorldWidgetObject(index: number): void {
    const widget = this.layout?.worldWidgets?.[index];
    const icon = this.worldWidgetIcons[index];
    if (widget && icon) this.positionWorldWidgetIcon(icon, widget);
  }

  /** Re-tags marker `userData.worldWidgetIndex` after an insert/remove shifts indices. */
  private refreshWorldWidgetIndices(): void {
    this.worldWidgetIcons.forEach((icon, index) => {
      icon.userData.worldWidgetIndex = index;
    });
  }

  private insertWorldWidget(index: number, widget: WorldUiWidget): void {
    if (!this.layout) return;
    this.layout.worldWidgets ??= [];
    const insertionIndex = clampIndex(index, this.layout.worldWidgets.length);
    this.layout.worldWidgets.splice(insertionIndex, 0, cloneWorldWidget(widget));
    const icon = this.createWorldWidgetIcon(insertionIndex);
    this.positionWorldWidgetIcon(icon, widget);
    this.worldWidgetIcons.splice(insertionIndex, 0, icon);
    this.scene.add(icon);
    this.refreshWorldWidgetIndices();
    this.emitSceneObjectsChanged();
  }

  private removeWorldWidgetAt(index: number): WorldUiWidget | null {
    if (!this.layout?.worldWidgets) return null;
    const [removed] = this.layout.worldWidgets.splice(index, 1);
    const [icon] = this.worldWidgetIcons.splice(index, 1);
    if (icon) this.scene.remove(icon);
    this.refreshWorldWidgetIndices();
    this.emitSceneObjectsChanged();
    return removed ? cloneWorldWidget(removed) : null;
  }

  /** Appends a world widget referencing `assetId` in front of the camera + selects it. */
  addWorldWidget(assetId: string, worldPos?: Vec3): void {
    if (!this.layout) return;
    const index = this.layout.worldWidgets?.length ?? 0;
    const widget: WorldUiWidget = {
      widget: assetId,
      anchor: { worldPos: worldPos ? [...worldPos] : this.defaultWorldWidgetAnchor() },
    };
    this.executeCommand({
      label: "Add World Widget",
      redo: () => {
        this.insertWorldWidget(index, widget);
        this.select({ kind: "worldWidget", index });
      },
      undo: () => {
        this.removeWorldWidgetAt(index);
        this.select(null);
      },
    });
  }

  /** Deletes the world widget at `index` (undoable). */
  removeWorldWidget(index: number): void {
    const widget = this.layout?.worldWidgets?.[index];
    if (!widget) return;
    const snapshot = cloneWorldWidget(widget);
    this.executeCommand({
      label: "Delete World Widget",
      redo: () => {
        this.removeWorldWidgetAt(index);
        if (this.selection?.kind === "worldWidget" && this.selection.index === index) {
          this.select(null);
        }
      },
      undo: () => {
        this.insertWorldWidget(index, snapshot);
        this.select({ kind: "worldWidget", index });
      },
    });
  }

  /** A point ~5 units in front of the camera (where a new world widget lands). */
  private defaultWorldWidgetAnchor(): Vec3 {
    const direction = new Vector3();
    const camera = this.editorViewportCamera();
    camera.getWorldDirection(direction);
    const point = camera.position.clone().addScaledVector(direction, 5);
    return [
      Number(point.x.toFixed(3)),
      Number(point.y.toFixed(3)),
      Number(point.z.toFixed(3)),
    ];
  }

  /**
   * Edits a placed world widget's fields (Details panel). Empty/zero optional
   * fields are dropped so the saved JSON stays clean; undoable.
   */
  setWorldWidget(
    index: number,
    patch: {
      widget?: string;
      worldPos?: Vec3;
      entityId?: string;
      offset3d?: Vec3;
      offset?: [number, number];
      maxDistance?: number;
    },
    label = "Edit World Widget",
  ): void {
    const current = this.layout?.worldWidgets?.[index];
    if (!current) return;
    const previous = cloneWorldWidget(current);
    const draft = cloneWorldWidget(current);
    if (patch.widget !== undefined) draft.widget = patch.widget;
    if (patch.worldPos !== undefined) draft.anchor.worldPos = [...patch.worldPos];
    if (patch.entityId !== undefined) {
      if (patch.entityId) draft.anchor.entityId = patch.entityId;
      else delete draft.anchor.entityId;
    }
    if (patch.offset3d !== undefined) {
      if (patch.offset3d.some((value) => value !== 0)) draft.anchor.offset3d = [...patch.offset3d];
      else delete draft.anchor.offset3d;
    }
    if (patch.offset !== undefined) {
      if (patch.offset[0] !== 0 || patch.offset[1] !== 0) draft.offset = [...patch.offset];
      else delete draft.offset;
    }
    if (patch.maxDistance !== undefined) {
      if (patch.maxDistance > 0) draft.maxDistance = patch.maxDistance;
      else delete draft.maxDistance;
    }
    const next = cloneWorldWidget(draft);

    const apply = (value: WorldUiWidget): void => {
      if (!this.layout?.worldWidgets?.[index]) return;
      this.layout.worldWidgets[index] = cloneWorldWidget(value);
      this.refreshWorldWidgetObject(index);
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => apply(next), undo: () => apply(previous) });
  }

  /** Edits the currently selected world widget (Details panel). */
  setSelectedWorldWidget(patch: {
    widget?: string;
    worldPos?: Vec3;
    entityId?: string;
    offset3d?: Vec3;
    offset?: [number, number];
    maxDistance?: number;
  }): void {
    if (this.selection?.kind !== "worldWidget") return;
    this.setWorldWidget(this.selection.index, patch);
  }

  /**
   * Live-writes a world widget's anchor world point during a gizmo move drag (no
   * undo entry — {@link commitWorldWidgetMove} records the before/after on release).
   */
  private applyWorldWidgetWorldPos(index: number, position: Vec3): void {
    const widget = this.layout?.worldWidgets?.[index];
    if (!widget) return;
    widget.anchor.worldPos = [round(position[0]), round(position[1]), round(position[2])];
    this.refreshWorldWidgetObject(index);
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  /** Records one undoable command for a gizmo-drag move of a world widget anchor. */
  private commitWorldWidgetMove(index: number, before: Vec3): void {
    const widget = this.layout?.worldWidgets?.[index];
    if (!widget) return;
    const after: Vec3 = [...widget.anchor.worldPos];
    if (after[0] === before[0] && after[1] === before[1] && after[2] === before[2]) return;
    const start: Vec3 = [...before];
    const apply = (worldPos: Vec3): void => {
      const target = this.layout?.worldWidgets?.[index];
      if (!target) return;
      target.anchor.worldPos = [...worldPos];
      this.select({ kind: "worldWidget", index });
      this.refreshWorldWidgetObject(index);
      this.updateSelectionBox();
      this.updateGizmo();
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: "Move World Widget",
      redo: () => apply(after),
      undo: () => apply(start),
    });
  }

  /**
   * Re-bakes one probe's cubemap from the current scene. Not undoable: the cached
   * PMREM is derived data (like {@link recaptureSkyLightCapture}), so moving objects or
   * the probe then pressing Recapture refreshes the capture without a history entry.
   */
  recaptureReflectionCapture(index: number): void {
    if (!this.layout?.reflectionCaptures?.[index]) return;
    this.bakeReflectionCaptureAt(index);
    this.onStatus?.("Recaptured Sphere Reflection Capture.", "info");
  }

  /** Re-bakes the currently selected probe (Details panel Recapture button). */
  recaptureSelectedReflectionCapture(): void {
    if (this.selection?.kind !== "reflectionCapture") return;
    this.recaptureReflectionCapture(this.selection.index);
  }

  /** Re-bakes every placed probe from the current scene (bulk Recapture command). */
  recaptureAllReflectionCaptures(): void {
    const captures = this.layout?.reflectionCaptures ?? [];
    if (captures.length === 0) return;
    captures.forEach((_actor, index) => this.bakeReflectionCaptureAt(index));
    this.onStatus?.(`Recaptured ${captures.length} Sphere Reflection Capture(s).`, "info");
  }

  private duplicateSelectionForDrag(selection: Selection): Selection | null {
    return this.editorSceneController.duplicateSelectionForDrag(selection);
  }

  private renameSelection(selection: Selection, name: string): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    const previous = target.name ?? "";
    const next = name.trim();
    if (previous === next) return;

    this.executeCommand({
      label: "Rename",
      redo: () => {
        this.applyName(selection, next);
      },
      undo: () => {
        this.applyName(selection, previous);
      },
    });
  }

  private applyName(selection: Selection, name: string): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    if (name) target.name = name;
    else delete target.name;

    if (selection.kind === "character") {
      const object = this.characterObjects[selection.index];
      const character = this.layout?.characters[selection.index];
      if (object && character) object.name = target.name ?? character.assetId;
    }
    if (selection.kind === "actor") {
      const object = this.actorObjects[selection.index];
      if (object) object.name = target.name ?? object.name;
    }
    if (selection.kind === "light") this.refreshLightObject(selection.index);

    this.emitSelectionChanged();
  }

  private isSelectionLocked(selection: Selection): boolean {
    return Boolean(this.getMutableTransform(selection)?.locked);
  }

  /** Toggles proportional-scale lock on the current selection (Details panel). */
  setSelectionScaleLocked(value: boolean): void {
    this.editorSceneController.setSelectionScaleLocked(value);
  }

  /** Details "Cast Shadow" toggle for the active selection (default on). */
  setSelectionCastShadow(value: boolean): void {
    this.editorSceneController.setSelectionCastShadow(value);
  }

  /** Details "Collision" toggle for the active selection (default on). */
  setSelectionCollision(value: boolean): void {
    this.editorSceneController.setSelectionCollision(value);
  }

  /** Details "Simulate Physics" toggle for the active selection (default off). */
  setSelectionSimulatePhysics(value: boolean): void {
    this.editorSceneController.setSelectionSimulatePhysics(value);
  }

  /** Details "Collision" section preset override (undefined inherits asset default). */
  setSelectionCollisionPreset(value: CollisionPresetId | undefined): void {
    this.editorSceneController.setSelectionCollisionPreset(value);
  }

  /** Details "Collision" section per-placement overrides (undefined fields inherit). */
  setSelectionCollisionOverrides(patch: {
    collisionEnabled?: CollisionEnabled | undefined;
    objectType?: CollisionObjectChannel | undefined;
    responses?: CollisionResponseMap | undefined;
    physicalMaterialId?: string | undefined;
    generateOverlapEvents?: boolean | undefined;
    simulationGeneratesHitEvents?: boolean | undefined;
  }): void {
    this.editorSceneController.setSelectionCollisionOverrides(patch);
  }

  /** Details "AI Navigation" role override (undefined inherits asset default). */
  setSelectionNavigationRole(value: NavigationRole | undefined): void {
    this.editorSceneController.setSelectionNavigationRole(value);
  }

  /** Details / Content Drawer material slot override for static mesh instances. */
  setSelectionMaterialSlot(value: string | undefined): void {
    if (value !== undefined && !this.isMaterialAsset(value)) {
      this.onStatus?.(`Material asset not found: ${value}`, "warning");
      return;
    }
    this.editorSceneController.setSelectionMaterialSlot(value);
  }

  /** Assigns a dragged material to the static mesh instance under the cursor. */
  assignMaterialAt(materialId: string, clientX: number, clientY: number): void {
    if (!this.isMaterialAsset(materialId)) {
      this.onStatus?.(`Material asset not found: ${materialId}`, "warning");
      return;
    }
    const selection = this.picker.pickSelection(clientX, clientY);
    if (!selection || selection.kind !== "instance") {
      this.onStatus?.("Drop the material on a static mesh instance.", "warning");
      return;
    }
    this.select(selection);
    this.setSelectionMaterialSlot(materialId);
  }

  /** Details Physics section settings for the active selection. */
  setSelectionPhysics(patch: Partial<LayoutPhysics>): void {
    this.editorSceneController.setSelectionPhysics(patch);
  }

  /** Sets (or clears, when `undefined`) the selection's Interaction component with undo/redo. */
  setSelectionInteraction(value: LayoutInteraction | undefined): void {
    this.editorSceneController.setSelectionInteraction(value);
  }

  /** Sets (or clears, when `undefined`) the selection's Audio component with undo/redo. */
  setSelectionAudio(value: LayoutAudio | undefined): void {
    this.editorSceneController.setSelectionAudio(value);
  }

  /** Sets (or clears, when `undefined`) the selection's Behavior component with undo/redo. */
  setSelectionBehavior(value: LayoutBehavior | undefined): void {
    this.editorSceneController.setSelectionBehavior(value);
  }

  /** Sets (or clears, when `undefined`) the selection's Particle Emitter component with undo/redo. */
  setSelectionParticle(value: LayoutParticleEmitter | undefined): void {
    this.editorSceneController.setSelectionParticle(value);
  }

  /** Sets (or clears, when `undefined`) the selection's Moving Platform component with undo/redo. */
  setSelectionMovingPlatform(value: LayoutMovingPlatform | undefined): void {
    this.editorSceneController.setSelectionMovingPlatform(value);
  }

  /**
   * Sets (or clears, when `undefined`) the Play-mode animation clip for the
   * selected directly-placed skeletal mesh (character), with undo/redo.
   */
  setSelectionAnimation(value: string | undefined): void {
    this.editorSceneController.setSelectionAnimation(value);
  }

  /**
   * Best-effort clip names for a skeletal mesh asset id, read from its
   * `*.skeleton.json` sidecar. Empty when the asset is missing, not skeletal, or
   * has no sidecar clips. Used by the character Details Animation dropdown.
   */
  async getSkeletonClipNames(assetId: string): Promise<string[]> {
    if (!this.assetLoader) return [];
    const manifest = this.manifest ?? (await this.assetLoader.loadManifest());
    const record = manifest.assets.find((asset) => asset.id === assetId);
    if (!record || assetType(record) !== "skeletalMesh") return [];
    try {
      const skeleton = await loadAssetSkeleton(assetPath(record));
      return skeletonClipNames(skeleton);
    } catch {
      return [];
    }
  }

  /** Active project's gameplay metadata schema, or null when none is declared. */
  getMetadataSchema(): MetadataSchema | null {
    return this.metadataSchema;
  }

  /**
   * Sets a single schema-driven metadata field on the active selection with
   * undo/redo. Passing `undefined` (or an empty value, decided by the caller)
   * removes the key so saved layouts only carry meaningful deviations.
   */
  setSelectionMetadata(key: string, value: MetadataValue | undefined, label?: string): void {
    this.editorSceneController.setSelectionMetadata(key, value, label);
  }

  /**
   * Reflects a castShadow change on the live object. Only characters are
   * individual objects; instanced meshes are batched per asset, so their flag
   * stays authoring-only data the runtime can consume.
   */
  private applyCastShadow(selection: Selection): void {
    if (selection.kind !== "character") return;
    const object = this.characterObjects[selection.index];
    const character = this.layout?.characters[selection.index];
    if (!object || !character) return;
    const castShadow = character.castShadow ?? true;
    object.traverse((child) => {
      if (isRenderableMesh(child)) child.castShadow = castShadow;
    });
  }

  private applyWorldSettings(settings: EditorWorldSettings): void {
    if (!this.layout) return;
    const worldSettings: LayoutWorldSettings = { ...(this.layout.worldSettings ?? {}) };

    if (settings.staticObjectsCastShadow === DEFAULT_SCENE_STATIC_OBJECTS_CAST_SHADOWS) {
      delete worldSettings.staticObjectsCastShadow;
    } else {
      worldSettings.staticObjectsCastShadow = settings.staticObjectsCastShadow;
    }

    if (settings.staticObjectsReceiveShadow === DEFAULT_SCENE_STATIC_OBJECTS_RECEIVE_SHADOWS) {
      delete worldSettings.staticObjectsReceiveShadow;
    } else {
      worldSettings.staticObjectsReceiveShadow = settings.staticObjectsReceiveShadow;
    }

    if (settings.backgroundColor.toLowerCase() === DEFAULT_SCENE_BACKGROUND_COLOR) {
      delete worldSettings.backgroundColor;
    } else {
      worldSettings.backgroundColor = settings.backgroundColor;
    }

    if (settings.ambientColor.toLowerCase() === DEFAULT_SCENE_AMBIENT_COLOR) {
      delete worldSettings.ambientColor;
    } else {
      worldSettings.ambientColor = settings.ambientColor;
    }

    if (settings.ambientIntensity === DEFAULT_SCENE_AMBIENT_INTENSITY) {
      delete worldSettings.ambientIntensity;
    } else {
      worldSettings.ambientIntensity = settings.ambientIntensity;
    }

    if (settings.killZ === DEFAULT_SCENE_KILL_Z) {
      delete worldSettings.killZ;
    } else {
      worldSettings.killZ = settings.killZ;
    }

    // The default camera mode is implicit: omit it so layouts stay clean and old
    // layouts (no gameMode) keep round-tripping unchanged.
    if (settings.gameMode === DEFAULT_GAME_MODE_ID) {
      delete worldSettings.gameMode;
    } else {
      worldSettings.gameMode = settings.gameMode;
    }

    if (Object.keys(worldSettings).length === 0) delete this.layout.worldSettings;
    else this.layout.worldSettings = worldSettings;

    this.applyStaticObjectShadowSettings();
    this.applyBackgroundAndAmbient();
    this.emitWorldSettingsChanged();
    this.emitSceneObjectsChanged();
    this.scheduleAutoSave();
  }

  /** Applies the resolved background color and ambient light to the live scene. */
  private applyBackgroundAndAmbient(): void {
    this.ambientLight = applySceneBackgroundAndAmbient({
      scene: this.scene,
      ambientLight: this.ambientLight,
      settings: resolveSceneWorldSettings(this.layout),
      ambientName: "editor-ambient-light",
    });
  }

  /**
   * Builds/updates/removes the Sky Atmosphere dome to match `layout.skyAtmosphere`,
   * pushes the scattering uniforms + tone mapping, and positions the sun disc from
   * the directional Sun light (the source of truth â€” Unreal's Atmosphere Sun Light).
   */
  private applySkyAtmosphere(): void {
    const actor = this.layout?.skyAtmosphere ?? null;
    if (!actor) {
      if (this.skyObject) {
        this.scene.remove(this.skyObject);
        this.skyObject.material.dispose();
        this.skyObject.geometry.dispose();
        this.skyObject = null;
      }
      applySkyToneMapping(this.renderer, null);
      return;
    }

    const resolved = resolveSkyAtmosphere(actor);
    if (!this.skyObject) {
      this.skyObject = createSkyObject();
      this.scene.add(this.skyObject);
    }
    applySkyUniforms(this.skyObject, resolved);
    this.updateSkySunFromLight();
    followCameraWithSky(this.skyObject, this.camera);
    applySkyToneMapping(this.renderer, resolved);
  }

  /**
   * Re-reads the directional Sun light's rotation and repositions the sky's sun
   * disc/horizon glow. Cheap; called from the render loop so rotating the Sun
   * (gizmo or rotation fields) moves the sky live, plus after sky/light edits.
   */
  private updateSkySunFromLight(): void {
    if (!this.skyObject) return;
    const sun = this.sunLightActor();
    if (!sun) return;
    applySkySunDirection(this.skyObject, sunDirectionFromLightRotation(readRotation(sun)));
  }

  /** The scene's Sun light actor (preferred id, else the first directional light). */
  private sunLightActor(): LayoutLightActor | null {
    const index = this.sunLightIndex();
    return index >= 0 ? (this.layout?.lights?.[index] ?? null) : null;
  }

  /** Index of the scene's Sun (preferred id) or the first directional light. */
  private sunLightIndex(): number {
    const lights = this.layout?.lights;
    if (!lights) return -1;
    const preferred = lights.findIndex(
      (light) => light.type === "directional" && light.id === DEFAULT_SCENE_SUN_ID,
    );
    if (preferred >= 0) return preferred;
    return lights.findIndex((light) => light.type === "directional");
  }

  /** Adds the singleton Sky Atmosphere (or selects the existing one). */
  addSkyAtmosphere(): void {
    if (!this.layout) return;
    if (this.layout.skyAtmosphere) {
      this.select({ kind: "sky" });
      this.onStatus?.("Sky Atmosphere already exists - selected it.", "info");
      return;
    }
    this.commitSky({}, "Add Sky Atmosphere");
    this.select({ kind: "sky" });
    this.onStatus?.("Added Sky Atmosphere.", "info");
  }

  /** Removes the singleton Sky Atmosphere (undoable). */
  removeSkyAtmosphere(): void {
    if (!this.layout?.skyAtmosphere) return;
    this.commitSky(undefined, "Delete Sky Atmosphere");
  }

  /**
   * Applies a partial scattering edit to the Sky Atmosphere as one undoable
   * command. A patch value of `undefined` clears that field (reverts to its
   * default); any other value overrides it. (Sun direction lives on the Sun
   * light â€” see {@link setSkySunDirection}.)
   */
  setSkyAtmosphere(
    patch: { [K in keyof LayoutSkyAtmosphere]?: LayoutSkyAtmosphere[K] | undefined },
    label = "Edit Sky Atmosphere",
  ): void {
    if (!this.layout?.skyAtmosphere) return;
    const next: LayoutSkyAtmosphere = { ...this.layout.skyAtmosphere };
    for (const key of Object.keys(patch) as Array<keyof LayoutSkyAtmosphere>) {
      const value = patch[key];
      if (value === undefined) delete next[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    this.commitSky(next, label);
  }

  /**
   * Single undoable Sky Atmosphere mutation: swaps `layout.skyAtmosphere`,
   * re-renders, and re-emits panels. The sky no longer touches the Sun light, so
   * no light snapshot is needed. Selection is cleared if the sky disappears while
   * it was the active selection.
   */
  private commitSky(nextSky: LayoutSkyAtmosphere | undefined, label: string): void {
    if (!this.layout) return;
    const previousSky = this.layout.skyAtmosphere ? { ...this.layout.skyAtmosphere } : undefined;

    const apply = (sky: LayoutSkyAtmosphere | undefined): void => {
      if (!this.layout) return;
      if (sky) this.layout.skyAtmosphere = { ...sky };
      else delete this.layout.skyAtmosphere;
      this.applySkyAtmosphere();
      this.applyPostProcess();
      // Sky/sun scattering changed â†’ re-bake the Sky Light capture if one exists.
      this.applyReflection(true);
      if (!this.layout.skyAtmosphere && this.selection?.kind === "sky") this.select(null);
      else this.emitSelectionChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(nextSky),
      undo: () => apply(previousSky),
    });
  }

  /**
   * Applies `layout.heightFog` to `scene.fog` (or clears it). Distance-based scene
   * fog (Faz 1); three.js applies it to every fog-aware material automatically.
   */
  private applyHeightFog(): void {
    const actor = this.layout?.heightFog ?? null;
    applySceneFog(this.scene, actor ? resolveHeightFog(actor) : null);
  }

  /** Adds the singleton Height Fog (or selects the existing one). */
  addHeightFog(): void {
    if (!this.layout) return;
    if (this.layout.heightFog) {
      this.select({ kind: "fog" });
      this.onStatus?.("Exponential Height Fog already exists - selected it.", "info");
      return;
    }
    this.commitFog({}, "Add Exponential Height Fog");
    this.select({ kind: "fog" });
    this.onStatus?.("Added Exponential Height Fog.", "info");
  }

  /** Removes the singleton Height Fog (undoable). */
  removeHeightFog(): void {
    if (!this.layout?.heightFog) return;
    this.commitFog(undefined, "Delete Exponential Height Fog");
  }

  /**
   * Applies a partial edit to the Height Fog as one undoable command. A patch
   * value of `undefined` clears that field (reverts to its default); any other
   * value overrides it.
   */
  setHeightFog(
    patch: { [K in keyof LayoutHeightFog]?: LayoutHeightFog[K] | undefined },
    label = "Edit Exponential Height Fog",
  ): void {
    if (!this.layout?.heightFog) return;
    const next: LayoutHeightFog = { ...this.layout.heightFog };
    for (const key of Object.keys(patch) as Array<keyof LayoutHeightFog>) {
      const value = patch[key];
      if (value === undefined) delete next[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    this.commitFog(next, label);
  }

  /**
   * Single undoable Height Fog mutation: swaps `layout.heightFog`, re-renders, and
   * re-emits panels. Selection is cleared if the fog disappears while it was the
   * active selection. Mirrors {@link commitSky}.
   */
  private commitFog(nextFog: LayoutHeightFog | undefined, label: string): void {
    if (!this.layout) return;
    const previousFog = this.layout.heightFog ? { ...this.layout.heightFog } : undefined;

    const apply = (fog: LayoutHeightFog | undefined): void => {
      if (!this.layout) return;
      if (fog) this.layout.heightFog = { ...fog };
      else delete this.layout.heightFog;
      this.applyHeightFog();
      if (!this.layout.heightFog && this.selection?.kind === "fog") this.select(null);
      else this.emitSelectionChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(nextFog),
      undo: () => apply(previousFog),
    });
  }

  /**
   * Builds/updates/removes the static Cloud Layer dome to match
   * `layout.cloudLayer` and pushes the procedural uniforms. A hidden/absent cloud
   * removes the dome from the scene.
   */
  private applyCloudLayer(): void {
    const actor = this.layout?.cloudLayer ?? null;
    if (!actor) {
      if (this.cloudObject) {
        this.scene.remove(this.cloudObject);
        this.cloudObject.material.dispose();
        this.cloudObject.geometry.dispose();
        this.cloudObject = null;
      }
      return;
    }

    const resolved = resolveCloudLayer(actor);
    if (!this.cloudObject) {
      this.cloudObject = createCloudObject();
      this.scene.add(this.cloudObject);
    }
    applyCloudUniforms(this.cloudObject, resolved);
    followCameraWithClouds(this.cloudObject, this.camera);
  }

  /** Adds the singleton Cloud Layer (or selects the existing one). */
  addCloudLayer(): void {
    if (!this.layout) return;
    if (this.layout.cloudLayer) {
      this.select({ kind: "cloud" });
      this.onStatus?.("Cloud Layer already exists - selected it.", "info");
      return;
    }
    this.commitCloud({}, "Add Cloud Layer");
    this.select({ kind: "cloud" });
    this.onStatus?.("Added Cloud Layer.", "info");
  }

  /** Removes the singleton Cloud Layer (undoable). */
  removeCloudLayer(): void {
    if (!this.layout?.cloudLayer) return;
    this.commitCloud(undefined, "Delete Cloud Layer");
  }

  /**
   * Applies a partial edit to the Cloud Layer as one undoable command. A patch
   * value of `undefined` clears that field (reverts to its default); any other
   * value overrides it.
   */
  setCloudLayer(
    patch: { [K in keyof LayoutCloudLayer]?: LayoutCloudLayer[K] | undefined },
    label = "Edit Cloud Layer",
  ): void {
    if (!this.layout?.cloudLayer) return;
    const next: LayoutCloudLayer = { ...this.layout.cloudLayer };
    for (const key of Object.keys(patch) as Array<keyof LayoutCloudLayer>) {
      const value = patch[key];
      if (value === undefined) delete next[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    this.commitCloud(next, label);
  }

  /**
   * Single undoable Cloud Layer mutation: swaps `layout.cloudLayer`, re-renders,
   * and re-emits panels. Selection is cleared if the cloud disappears while it
   * was the active selection. Mirrors {@link commitFog}.
   */
  private commitCloud(nextCloud: LayoutCloudLayer | undefined, label: string): void {
    if (!this.layout) return;
    const previousCloud = this.layout.cloudLayer ? { ...this.layout.cloudLayer } : undefined;

    const apply = (cloud: LayoutCloudLayer | undefined): void => {
      if (!this.layout) return;
      if (cloud) this.layout.cloudLayer = { ...cloud };
      else delete this.layout.cloudLayer;
      this.applyCloudLayer();
      if (!this.layout.cloudLayer && this.selection?.kind === "cloud") this.select(null);
      else this.emitSelectionChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(nextCloud),
      undo: () => apply(previousCloud),
    });
  }

  /**
   * Captures/refreshes the Sky Atmosphere's Sky Light Capture and hangs it on
   * `scene.environment`, so PBR materials reflect it where no local Sphere
   * Reflection Capture applies. `recapture` forces a fresh PMREM bake (first
   * apply, or the sky/sun changed); otherwise an existing capture is reused and
   * only the intensity is re-applied. A hidden/absent sky clears the environment.
   */
  private applyReflection(recapture = false): void {
    const skyActor = this.layout?.skyAtmosphere ?? null;
    const sky = skyActor ? resolveSkyAtmosphere(skyActor) : null;
    if (!sky || sky.hidden) {
      this.disposeReflectionTarget();
      applyReflectionEnvironment(this.scene, null, null);
    } else {
      if (recapture || !this.reflectionTarget) {
        this.disposeReflectionTarget();
        const sun = this.sunLightActor();
        const sunDirection = sun
          ? sunDirectionFromLightRotation(readRotation(sun))
          : new Vector3(0, 1, 0);
        this.reflectionTarget = captureSkyEnvironment(this.renderer, sky, sunDirection);
      }
      applyReflectionEnvironment(
        this.scene,
        this.reflectionTarget,
        resolveReflection(sky.skyLightCapture),
      );
    }
    // The global env that probe boundary-blend fades toward just changed; rebind it
    // onto the probe-covered clones. No-op during initial build (no bakes yet) and
    // when there are no probes, so it only costs on later Sky Light Capture edits.
    if (this.eligibleProbeBakes().length > 0) this.applyReflectionCaptureEnvMaps();
  }

  /** Frees the captured PMREM render target backing `scene.environment`, if any. */
  private disposeReflectionTarget(): void {
    if (this.reflectionTarget) {
      this.reflectionTarget.dispose();
      this.reflectionTarget = null;
    }
  }

  /**
   * Re-bakes the Sky Atmosphere's global sky-light capture from the current sky
   * and Sun rotation. The captured PMREM is derived data, so recapture is not an
   * undoable layout mutation.
   */
  recaptureSkyLightCapture(): void {
    if (!this.layout?.skyAtmosphere) return;
    this.applyReflection(true);
    this.onStatus?.("Recaptured Sky Light Capture from the sky.", "info");
  }

  /** Applies the global Post Process renderer properties after Sky tone mapping. */
  private applyPostProcess(): void {
    const actor = this.layout?.postProcess ?? null;
    const resolved = actor ? resolvePostProcess(actor) : null;
    applyPostProcessToneMapping(this.renderer, resolved);
    this.applySkyPostProcessExposure(resolved);
    const { width, height } = this.viewportSize();
    this.postProcessPipeline?.setEffectPasses(
      createPostProcessEffectPasses(resolved, {
        scene: this.scene,
        camera: this.editorViewportCamera(),
        width,
        height,
      }),
    );
    this.postProcessPipeline?.setAntialiasPass(
      createPostProcessAntialiasPass(resolved, {
        width,
        height,
      }),
    );
  }

  private applySkyPostProcessExposure(post: ResolvedPostProcess | null): void {
    if (!this.skyObject) return;
    const sky = this.layout?.skyAtmosphere ? resolveSkyAtmosphere(this.layout.skyAtmosphere) : null;
    if (!sky || sky.hidden || !post || post.hidden) {
      setSkyLocalToneMappingExposure(this.skyObject, null);
      return;
    }
    setSkyLocalToneMappingExposure(
      this.skyObject,
      postProcessToneMappingExposure(post.exposure) * skyAtmosphereToneMappingExposure(sky.exposure),
    );
  }

  /** Adds the singleton Post Process actor (or selects the existing one). */
  addPostProcess(): void {
    if (!this.layout) return;
    if (this.layout.postProcess) {
      this.select({ kind: "post" });
      this.onStatus?.("Post Process already exists - selected it.", "info");
      return;
    }
    this.commitPostProcess({}, "Add Post Process");
    this.select({ kind: "post" });
    this.onStatus?.("Added Post Process.", "info");
  }

  /** Removes the singleton Post Process actor (undoable). */
  removePostProcess(): void {
    if (!this.layout?.postProcess) return;
    this.commitPostProcess(undefined, "Delete Post Process");
  }

  /** Applies a partial edit to Post Process as one undoable command. */
  setPostProcess(
    patch: { [K in keyof LayoutPostProcess]?: LayoutPostProcess[K] | undefined },
    label = "Edit Post Process",
  ): void {
    if (!this.layout?.postProcess) return;
    const next: LayoutPostProcess = { ...this.layout.postProcess };
    for (const key of Object.keys(patch) as Array<keyof LayoutPostProcess>) {
      const value = patch[key];
      if (value === undefined) delete next[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    this.commitPostProcess(next, label);
  }

  /**
   * Single undoable Post Process mutation. Sky is applied first so an active PP
   * actor owns the final renderer tone mapping/exposure.
   */
  private commitPostProcess(nextPost: LayoutPostProcess | undefined, label: string): void {
    if (!this.layout) return;
    const previousPost = this.layout.postProcess ? { ...this.layout.postProcess } : undefined;

    const apply = (post: LayoutPostProcess | undefined): void => {
      if (!this.layout) return;
      if (post) this.layout.postProcess = { ...post };
      else delete this.layout.postProcess;
      this.applySkyAtmosphere();
      this.applyPostProcess();
      if (!this.layout.postProcess && this.selection?.kind === "post") this.select(null);
      else this.emitSelectionChanged();
      this.scheduleAutoSave();
    };

    this.executeCommand({
      label,
      redo: () => apply(nextPost),
      undo: () => apply(previousPost),
    });
  }

  /**
   * World-settings edits persist immediately (debounced) so the user never has
   * to press Save for scene rendering tweaks.
   */
  private scheduleAutoSave(): void {
    window.clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = window.setTimeout(() => {
      void this.saveLayout().catch((error) => {
        this.onStatus?.(
          `Auto-save failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      });
    }, 500);
  }

  private applyLightActor(selection: LightSelection, actor: LayoutLightActor): void {
    if (!this.layout?.lights?.[selection.index]) return;
    this.layout.lights[selection.index] = cloneLightActor(actor);
    this.refreshLightObject(selection.index);
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private applyStaticObjectShadowSettings(): void {
    const castShadow = this.staticObjectsCastShadow();
    const receiveShadow = this.staticObjectsReceiveShadow();
    for (const meshes of this.instanceMeshes.values()) {
      for (const mesh of meshes) {
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
      }
    }
    for (const objects of this.instanceOverrideObjects.values()) {
      for (const object of objects) {
        object.traverse((child) => {
          if (!isRenderableMesh(child)) return;
          child.castShadow = castShadow;
          child.receiveShadow = receiveShadow;
        });
      }
    }
  }

  private applyGroupId(
    selection: Selection,
    groupId: string | undefined,
    options: { notify?: boolean } = {},
  ): void {
    const target = this.getMutableTransform(selection);
    if (!target) return;
    if (groupId) target.groupId = groupId;
    else delete target.groupId;

    if (options.notify !== false) this.emitSelectionChanged();
  }

  private applyMaterialSlot(selection: Selection): void {
    if (selection.kind !== "instance") return;
    const placement = this.getMutableTransform(selection) as LayoutPlacement | null;
    if (placement?.materialSlot) this.ensureMaterialLoaded(placement.materialSlot, selection.assetId);
    this.rebuildInstanceGroup(selection.assetId);
    this.updateSelectionBox();
    this.updateGizmo();
  }

  private applyVisibility(selection: Selection): void {
    if (selection.kind === "instance") {
      this.rebuildInstanceGroup(selection.assetId);
      return;
    }
    if (selection.kind === "light") {
      this.refreshLightObject(selection.index);
      return;
    }
    if (selection.kind === "actor") {
      const object = this.actorObjects[selection.index];
      const actor = this.layout?.actors?.[selection.index];
      if (object && actor) object.visible = !(actor.hidden ?? false);
      return;
    }
    // Placed reflection actors carry their visibility in the render-item transform,
    // so re-sync the helper/reflector to pick up the new hidden flag.
    if (selection.kind === "reflectionPlane") {
      this.refreshReflectionPlaneObject(selection.index);
      return;
    }
    if (selection.kind === "reflectiveSurface") {
      this.refreshReflectiveSurfaceObject(selection.index);
      return;
    }
    if (selection.kind === "reflectionCapture") {
      this.refreshReflectionCaptureObject(selection.index);
      // Hiding disposes the probe bake (it leaves the envMap pool); showing re-bakes.
      this.bakeReflectionCaptureAt(selection.index);
      return;
    }
    if (selection.kind === "blockingVolume") {
      this.refreshBlockingVolumeObject(selection.index);
      return;
    }
    if (selection.kind === "aiNavigationVolume") {
      this.refreshAiNavigationVolumeObject(selection.index);
      return;
    }
    if (selection.kind === "targetPoint") {
      this.refreshTargetPointObject(selection.index);
      return;
    }
    if (selection.kind === "landscape") {
      this.refreshLandscapeObject(selection.index);
      return;
    }
    // The Sky Atmosphere's visibility is applied through applySkyAtmosphere().
    if (selection.kind === "sky") {
      this.applySkyAtmosphere();
      this.applyReflection(true);
      return;
    }
    // The Height Fog's visibility is applied through applyHeightFog().
    if (selection.kind === "fog") {
      this.applyHeightFog();
      return;
    }
    // The Cloud Layer's visibility is applied through applyCloudLayer().
    if (selection.kind === "cloud") {
      this.applyCloudLayer();
      return;
    }
    if (selection.kind === "post") {
      this.applySkyAtmosphere();
      this.applyPostProcess();
      return;
    }
    // World-widget markers carry no hidden flag (always shown in the editor).
    if (selection.kind === "worldWidget") return;
    const object = this.characterObjects[selection.index];
    const character = this.layout?.characters[selection.index];
    if (object && character) object.visible = !(character.hidden ?? false);
  }

  private createCharacterObject(gltf: GLTF, placement: LayoutCharacter, index: number): Object3D {
    return buildSceneCharacterObject(gltf, placement, index);
  }

  private playCharacterAnimation(
    character: Object3D,
    gltf: GLTF,
    animationName: string | undefined,
  ): void {
    const mixer = createSceneCharacterMixer(character, gltf, animationName);
    if (mixer) this.animationSubsystem.add(mixer);
  }

  private refreshCharacterIndices(): void {
    this.characterObjects.forEach((object, index) => {
      object.userData.characterIndex = index;
    });
  }

  private bindEditorInput(): void {
    this.unbindEditorInput = bindEditorInputEvents(this.canvas, {
      hasSelection: () => Boolean(this.selection),
      pickGizmoHandle: (clientX, clientY) => this.picker.pickGizmoHandle(clientX, clientY),
      startGizmoDrag: (handle, event) => this.startGizmoDrag(handle, event),
      beginAltCameraDrag: (event) => this.cameraController.beginAltDrag(event),
      beginCameraNavigation: (event) => this.cameraController.beginNavigation(event),
      pickSelection: (clientX, clientY) => {
        const hit = this.pickSplinePoint(clientX, clientY);
        if (hit && this.selection?.kind === "spline") {
          this.activeSplinePointId = hit.pointId;
          this.activeSplineTangent = hit.handle === "point" ? null : hit.handle;
          this.refreshSplinePointOverlay();
          this.updateGizmo();
          return { kind: "spline", index: this.selection.index };
        }
        return this.picker.pickSelection(clientX, clientY);
      },
      toggleSelection: (selection) => this.toggleSelection(selection),
      select: (selection) => this.select(selection),
      beginLandscapeSculpt: (event) => this.beginLandscapeSculpt(event),
      updateLandscapeSculpt: (event) => this.updateLandscapeSculpt(event),
      endLandscapeSculpt: (event) => this.endLandscapeSculpt(event),
      updateLandscapeBrushHover: (clientX, clientY) => this.updateLandscapeBrushHover(clientX, clientY),
      clearLandscapeBrushHover: () => this.clearLandscapeBrushHover(),
      beginMeshPaintStroke: (event) => this.beginMeshPaintStroke(event),
      updateMeshPaintStroke: (event) => this.updateMeshPaintStroke(event),
      endMeshPaintStroke: (event) => this.endMeshPaintStroke(event),
      updateMeshPaintBrushHover: (clientX, clientY) => this.updateMeshPaintBrushHover(clientX, clientY),
      clearMeshPaintBrushHover: () => this.clearMeshPaintBrushHover(),
      beginFoliageStroke: (event) => this.beginFoliageStroke(event),
      updateFoliageStroke: (event) => this.updateFoliageStroke(event),
      endFoliageStroke: (event) => this.endFoliageStroke(event),
      updateFoliageBrushHover: (clientX, clientY) => this.updateFoliageBrushHover(clientX, clientY),
      clearFoliageBrushHover: () => this.clearFoliageBrushHover(),
      isCameraNavigationActive: () => this.cameraController.isNavigating,
      cameraNavigationPointerId: () => this.cameraController.navigationPointerId,
      updateCameraLook: (movementX, movementY) => this.cameraController.updateLook(movementX, movementY),
      endCameraNavigation: (event) => this.cameraController.endNavigation(event),
      cameraDragPointerId: () => this.cameraController.dragPointerId,
      updateCameraDrag: (event) => this.cameraController.updateDrag(event),
      endCameraDrag: (event) => this.cameraController.endDrag(event),
      pointerDrag: () => this.pointerDrag,
      clearPointerDrag: () => {
        const drag = this.pointerDrag;
        this.pointerDrag = null;
        return drag;
      },
      endGizmoDrag: () => this.gizmoInteraction.endDrag(),
      selected: () => this.getSelected(),
      updateGizmoHover: (clientX, clientY) => this.updateGizmoHover(clientX, clientY),
      clearGizmoHover: () => this.clearGizmoHover(),
      updateMoveDrag: (event, selected) => this.updateMoveDrag(event, selected),
      updateRotateDrag: (event) => this.updateRotateDrag(event),
      updateScaleDrag: (event) => this.updateScaleDrag(event),
      commitPointerDrag: (drag) => this.commitPointerDrag(drag),
      updateGizmo: () => this.updateGizmo(),
      onAssetDragOver: (clientX, clientY) => this.updateAssetDragPreview(clientX, clientY),
      onAssetDragLeave: () => this.hideAssetDragPreview(),
      onAssetDrop: (assetId, clientX, clientY) => {
        this.endAssetDragPreview();
        this.addAssetAt(assetId, clientX, clientY);
      },
      onActorClassDrop: (classRef, clientX, clientY) => {
        this.endAssetDragPreview();
        void this.addActorAt(classRef, clientX, clientY);
      },
      onMaterialDrop: (materialId, clientX, clientY) => {
        this.endAssetDragPreview();
        this.assignMaterialAt(materialId, clientX, clientY);
      },
      onLightDrop: (type, clientX, clientY) => {
        this.endAssetDragPreview();
        this.addLightActorAt(type, clientX, clientY);
      },
      onSpecialActorDrop: (payload, clientX, clientY) => {
        this.endAssetDragPreview();
        this.addSpecialActorAt(payload, clientX, clientY);
      },
      onWheel: (event) => this.cameraController.handleWheel(event),
      addPressedKey: (code) => this.cameraController.addPressedKey(code),
      deletePressedKey: (code) => this.cameraController.deletePressedKey(code),
    });
  }

  private getCameraOrbitTarget(): Vector3 {
    if (this.selection) {
      const box = this.getSelectionWorldBox(this.selection);
      if (box && !box.isEmpty()) return box.getCenter(new Vector3());
    }

    const direction = new Vector3();
    const camera = this.editorViewportCamera();
    camera.getWorldDirection(direction);
    const floorHit = this.raycaster.ray
      .set(camera.position, direction)
      .intersectPlane(this.floorPlane, new Vector3());
    return floorHit ?? camera.position.clone().addScaledVector(direction, 5);
  }

  private commitPointerDrag(drag: GizmoPointerDrag): void {
    // A spline-point drag (Faz 6.1) commits the whole spline snapshot, not a layout
    // transform — check it first since its `drag.selection` is the landscape.
    if (this.landscapeSplinePointDrag) {
      this.commitLandscapeSplinePointDrag();
      return;
    }
    if (this.splinePointDrag) {
      this.commitSplinePointDrag();
      return;
    }
    if (drag.selection.kind === "worldWidget") {
      this.commitWorldWidgetMove(drag.selection.index, drag.startTransform.position);
      return;
    }
    if (drag.mode === "move" && drag.pivotEdit) {
      this.commitPivotChange(
        drag.selection,
        drag.startPivot ?? [0, 0, 0],
        this.getSelectionPivot(drag.selection),
      );
      return;
    }
    if (drag.linkedTransforms?.length) {
      const verb = drag.mode === "rotate" ? "Rotate" : drag.mode === "scale" ? "Scale" : "Move";
      this.commitLinkedMoveChange(drag, verb);
      return;
    }
    this.commitTransformChange(drag.selection, drag.startTransform);
  }

  private startGizmoDrag(handle: GizmoHandle, event: PointerEvent): void {
    if (!this.selection) return;
    if (this.isSelectionLocked(this.selection)) {
      this.onStatus?.("Selected object is locked.", "warning");
      return;
    }
    // Landscape spline control point (Faz 6.1): drag its world position, mapped
    // back to the point's local space — only the move tool acts on it.
    const splinePoint = this.activeLandscapeSplinePoint();
    if (splinePoint) {
      if (handle.tool !== "move") return;
      this.startLandscapeSplinePointDrag(handle, event, splinePoint);
      return;
    }
    const genericSplinePoint = this.activeSplinePoint();
    if (genericSplinePoint) {
      if (handle.tool !== "move") return;
      this.startSplinePointDrag(handle, event, genericSplinePoint);
      return;
    }
    let linkedTransforms: LinkedMoveStart[] | undefined;
    if (event.altKey && handle.tool === "move") {
      const selection = this.duplicateSelectionForDrag(this.selection);
      if (selection) linkedTransforms = this.captureLinkedTransformStarts(selection);
    } else if (handle.tool === "move") {
      linkedTransforms = this.captureLinkedTransformStarts(this.selection);
    }
    const selected = this.getSelected();
    if (!selected) return;

    this.gizmoInteraction.beginDrag(handle);
    this.updateGizmo();

    const pivot = this.getSelectionPivot(this.selection);
    const pivotWorld = this.getSelectionPivotWorld(this.selection);
    const pivotEditing = handle.tool === "move" && this.pivotEditMode && this.selection.kind !== "light";
    const base = gizmoDragBaseWorld(selected, pivotWorld, pivotEditing);
    const movePlane = createGizmoMovePlane(handle, base, this.gizmoGroup.quaternion);
    const planeStartHit = movePlane
      ? this.picker.clientToPlane(event.clientX, event.clientY, movePlane) ?? base.clone()
      : undefined;
    this.pointerDrag = createGizmoPointerDrag({
      handle,
      selection: this.selection,
      selected,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      floorHit: handle.tool === "move" ? this.picker.clientToFloor(event.clientX, event.clientY) : null,
      freeMoveBasis: this.getScreenSpaceMoveBasis(),
      linkedTransforms,
      descendantTransforms:
        handle.tool === "rotate" || handle.tool === "scale"
          ? this.captureLinkedTransformStarts(this.selection)
          : undefined,
      movePlane,
      planeStartHit,
      pivot,
      pivotWorld,
      pivotEditing,
    });

    this.canvas.setPointerCapture(event.pointerId);
  }

  /**
   * Sets up a move-gizmo drag for a landscape spline control point (Faz 6.1). It
   * reuses the shared move-drag math with a synthetic world-space base at the
   * point, and records the pre-drag spline snapshot for the undo commit.
   */
  private startLandscapeSplinePointDrag(
    handle: GizmoHandle,
    event: PointerEvent,
    splinePoint: LandscapeSplinePointGizmoTarget,
  ): void {
    const landscapeEditable = this.getSelected();
    if (!landscapeEditable) return;
    const data = this.landscapeData.get(splinePoint.landscapeId);
    if (!data) return;

    this.gizmoInteraction.beginDrag(handle);
    this.updateGizmo();

    const base = splinePoint.world.clone();
    // The point carries no rotation/scale of its own — drag it in world space.
    const selected: EditableSelection = {
      ...landscapeEditable,
      position: [base.x, base.y, base.z],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const movePlane = createGizmoMovePlane(handle, base, this.gizmoGroup.quaternion);
    const planeStartHit = movePlane
      ? this.picker.clientToPlane(event.clientX, event.clientY, movePlane) ?? base.clone()
      : undefined;
    this.landscapeSplinePointDrag = {
      index: splinePoint.index,
      landscapeId: splinePoint.landscapeId,
      splineId: splinePoint.splineId,
      pointId: splinePoint.pointId,
      before: cloneLandscapeSplines(data.splines ?? []),
      objectMatrixInverse: splinePoint.object.matrixWorld.clone().invert(),
    };
    this.pointerDrag = createGizmoPointerDrag({
      handle,
      selection: { kind: "landscape", index: splinePoint.index },
      selected,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      floorHit: this.picker.clientToFloor(event.clientX, event.clientY),
      freeMoveBasis: this.getScreenSpaceMoveBasis(),
      linkedTransforms: undefined,
      descendantTransforms: undefined,
      movePlane,
      planeStartHit,
      pivot: [0, 0, 0],
      pivotWorld: null,
      pivotEditing: false,
    });

    this.canvas.setPointerCapture(event.pointerId);
  }

  private startSplinePointDrag(handle: GizmoHandle, event: PointerEvent, splinePoint: SplinePointGizmoTarget): void {
    const selected = this.getSelected();
    if (!selected) return;
    this.gizmoInteraction.beginDrag(handle);
    this.updateGizmo();
    const base = splinePoint.world.clone();
    const movePlane = createGizmoMovePlane(handle, base, this.gizmoGroup.quaternion);
    const planeStartHit = movePlane
      ? this.picker.clientToPlane(event.clientX, event.clientY, movePlane) ?? base.clone()
      : undefined;
    this.splinePointDrag = {
      index: splinePoint.index,
      pointId: splinePoint.pointId,
      handle: splinePoint.handle,
      before: cloneSplineActor(splinePoint.actor),
      worldMatrixInverse: splinePoint.worldMatrix.clone().invert(),
    };
    this.pointerDrag = createGizmoPointerDrag({
      handle,
      selection: { kind: "spline", index: splinePoint.index },
      selected: { ...selected, position: [base.x, base.y, base.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      floorHit: this.picker.clientToFloor(event.clientX, event.clientY),
      freeMoveBasis: this.getScreenSpaceMoveBasis(),
      linkedTransforms: undefined,
      descendantTransforms: undefined,
      movePlane,
      planeStartHit,
      pivot: [0, 0, 0],
      pivotWorld: null,
      pivotEditing: false,
    });
    this.canvas.setPointerCapture(event.pointerId);
  }

  private splinePointDragWorld(): Vec3 | null {
    const drag = this.splinePointDrag;
    const actor = drag ? this.layout?.splines?.[drag.index] : null;
    const point = actor?.spline.points.find((entry) => entry.id === drag?.pointId);
    if (!drag || !actor || !point) return null;
    const world = new Vector3(...this.splinePointHandlePosition(actor, point.id, drag.handle)).applyMatrix4(this.splineActorWorldMatrix(actor));
    return [world.x, world.y, world.z];
  }

  private applySplinePointWorld(world: Vec3): void {
    const drag = this.splinePointDrag;
    const actor = drag ? this.layout?.splines?.[drag.index] : null;
    const point = actor?.spline.points.find((entry) => entry.id === drag?.pointId);
    if (!drag || !point) return;
    const local = new Vector3(...world).applyMatrix4(drag.worldMatrixInverse);
    if (drag.handle === "point") {
      point.position = [round(local.x), round(local.y), round(local.z)];
    } else {
      const tangent: Vec3 = drag.handle === "arrive"
        ? [point.position[0] - local.x, point.position[1] - local.y, point.position[2] - local.z]
        : [local.x - point.position[0], local.y - point.position[1], local.z - point.position[2]];
      if (drag.handle === "arrive") point.arriveTangent = tangent;
      else point.leaveTangent = tangent;
      if (point.tangentsLinked) {
        if (drag.handle === "arrive") point.leaveTangent = [...tangent];
        else point.arriveTangent = [...tangent];
      }
    }
    this.refreshSpline(drag.index, "preview", splineDirtySegmentsForPoint(actor!, drag.pointId));
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private commitSplinePointDrag(): void {
    const drag = this.splinePointDrag;
    this.splinePointDrag = null;
    const after = drag ? this.layout?.splines?.[drag.index] : null;
    if (!drag || !after || JSON.stringify(drag.before) === JSON.stringify(after)) return;
    const index = drag.index;
    const apply = (value: LayoutSplineActor): void => {
      if (!this.layout?.splines?.[index]) return;
      this.layout.splines[index] = cloneSplineActor(value);
      this.activeSplinePointId = drag.pointId;
      this.activeSplineTangent = drag.handle === "point" ? null : drag.handle;
      this.refreshSpline(index);
      this.updateGizmo();
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label: "Move Spline Point", redo: () => apply(after), undo: () => apply(drag.before) });
    this.rebuildSplineGeneratedGroup(index, "full");
  }

  /** Current world position of the point being dragged (Faz 6.1 gizmo base). */
  private landscapeSplinePointDragWorld(): Vec3 | null {
    const drag = this.landscapeSplinePointDrag;
    if (!drag) return null;
    const object = this.landscapeObjects[drag.index];
    const point = this.landscapeData
      .get(drag.landscapeId)
      ?.splines?.find((spline) => spline.id === drag.splineId)
      ?.points.find((entry) => entry.id === drag.pointId);
    if (!object || !point) return null;
    object.updateWorldMatrix(true, false);
    const world = new Vector3(point.position[0], point.position[1], point.position[2]).applyMatrix4(
      object.matrixWorld,
    );
    return [world.x, world.y, world.z];
  }

  /**
   * Live-writes the dragged spline point's local position from a world point (no
   * undo entry — {@link commitLandscapeSplinePointDrag} records before/after on
   * release), keeping the overlay + gizmo in sync.
   */
  private applyLandscapeSplinePointWorld(world: Vec3): void {
    const drag = this.landscapeSplinePointDrag;
    if (!drag) return;
    const point = this.landscapeData
      .get(drag.landscapeId)
      ?.splines?.find((spline) => spline.id === drag.splineId)
      ?.points.find((entry) => entry.id === drag.pointId);
    if (!point) return;
    const local = new Vector3(...world).applyMatrix4(drag.objectMatrixInverse);
    point.position = [round(local.x), round(local.y), round(local.z)];
    this.landscapeDataDirty.add(drag.landscapeId);
    this.refreshLandscapeSplineOverlay(drag.index);
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  /** Records one undoable command for a gizmo-drag move of a spline control point. */
  private commitLandscapeSplinePointDrag(): void {
    const drag = this.landscapeSplinePointDrag;
    this.landscapeSplinePointDrag = null;
    if (!drag) return;
    const data = this.landscapeData.get(drag.landscapeId);
    if (!data) return;
    const after = cloneLandscapeSplines(data.splines ?? []);
    if (JSON.stringify(drag.before) === JSON.stringify(after)) return;
    this.applySelectedLandscapeSplines(
      drag.index,
      drag.landscapeId,
      drag.before,
      after,
      "Move Landscape Spline Point",
      drag.splineId,
      drag.pointId,
    );
  }

  private updateMoveDrag(event: PointerEvent, selected: EditableSelection): void {
    const drag = this.pointerDrag;
    if (!drag || drag.mode !== "move") return;

    // When editing the pivot the object stays put, so the unchanged components
    // come from the pivot's start point (startPosition), not the object origin.
    // A spline-point drag (Faz 6.1) tracks the point's own world position instead.
    const base: Vec3 = drag.pivotEdit
      ? [...drag.startPosition]
      : this.landscapeSplinePointDragWorld() ?? this.splinePointDragWorld() ?? [...selected.position];

    if (drag.axis === "xyz") {
      const position = freeMoveDragPosition(
        drag,
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
        this.snapSettings,
      );
      this.updateMoveDragPosition(position);
      return;
    }

    if (isPlaneAxis(drag.axis) && drag.movePlane && drag.planeStartHit) {
      const hit = this.picker.clientToPlane(event.clientX, event.clientY, drag.movePlane);
      if (!hit) return;
      this.updateMoveDragPosition(planeMoveDragPosition(drag, hit, this.snapSettings));
      return;
    }

    if (drag.axis === "y") {
      this.updateMoveDragPosition(
        axisYMoveDragPosition(base, drag, event.clientY - drag.startClientY, this.snapSettings),
      );
      return;
    }

    const hit = this.picker.clientToFloor(event.clientX, event.clientY);
    if (!hit) return;

    if (this.transformSpace === "local" && (drag.axis === "x" || drag.axis === "z")) {
      this.updateMoveDragPosition(localAxisMoveDragPosition(base, drag, hit, this.snapSettings));
      return;
    }

    this.updateMoveDragPosition(worldAxisMoveDragPosition(base, drag, hit, this.snapSettings));
  }

  private updateMoveDragPosition(position: Vec3): void {
    if (!this.pointerDrag || this.pointerDrag.mode !== "move") return;
    const drag = this.pointerDrag;

    // A spline control point (Faz 6.1) lives in the landscape sidecar, not the
    // layout, so it bypasses getMutableTransform / pivot / linked moves entirely.
    if (this.landscapeSplinePointDrag) {
      this.applyLandscapeSplinePointWorld(position);
      return;
    }
    if (this.splinePointDrag) {
      this.applySplinePointWorld(position);
      return;
    }

    // World widgets store their drag position on the UI anchor world point, not a
    // layout transform, so they bypass getMutableTransform / pivot / linked moves.
    if (drag.selection.kind === "worldWidget") {
      this.applyWorldWidgetWorldPos(drag.selection.index, position);
      return;
    }

    const activeTransform = this.getMutableTransform(drag.selection);
    if (!activeTransform) return;

    // Pivot edit: `position` is the new pivot world point; map it back into the
    // object's (fixed) local space and store as the pivot â€” the object stays put.
    if (drag.pivotEdit && drag.pivotMatrixInverse) {
      const local = new Vector3(...position).applyMatrix4(drag.pivotMatrixInverse);
      this.applyPivotValue(drag.selection, [
        round(local.x),
        round(local.y),
        round(local.z),
      ]);
      return;
    }

    const delta: Vec3 = [
      position[0] - drag.startPosition[0],
      position[1] - drag.startPosition[1],
      position[2] - drag.startPosition[2],
    ];

    activeTransform.position = [...position];
    this.refreshSelectionObject(drag.selection);

    for (const linked of drag.linkedTransforms ?? []) {
      const transform = this.getMutableTransform(linked.selection);
      if (!transform) continue;
      transform.position = [
        round(linked.startTransform.position[0] + delta[0]),
        round(linked.startTransform.position[1] + delta[1]),
        round(linked.startTransform.position[2] + delta[2]),
      ];
      this.refreshSelectionObject(linked.selection);
    }

    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private updateRotateDrag(event: PointerEvent): void {
    const drag = this.pointerDrag;
    if (!drag || drag.mode !== "rotate") return;
    const rotation = rotateDragRotation(drag, event.clientX - drag.startClientX, this.snapSettings);
    const values: { rotation: Vec3; position?: Vec3 } = { rotation };
    if (drag.pivotWorld && drag.pivot) {
      // Pivot around the offset point: keep it fixed by shifting the origin.
      values.position = pivotCorrectedPosition(
        drag.pivotWorld,
        rotation,
        drag.startTransform.scale,
        drag.pivot,
      );
    }
    this.updateSelectedTransform(values, { notifySelection: false });
    this.cascadeActiveDragToLinks();
    this.emitSelectionChanged();
  }

  private updateScaleDrag(event: PointerEvent): void {
    const drag = this.pointerDrag;
    if (!drag || drag.mode !== "scale") return;
    const scale = scaleDragScale(
      drag,
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
      this.snapSettings,
    );
    const values: { scale: Vec3; position?: Vec3 } = { scale };
    if (drag.pivotWorld && drag.pivot) {
      values.position = pivotCorrectedPosition(
        drag.pivotWorld,
        drag.startTransform.rotation,
        scale,
        drag.pivot,
      );
    }
    this.updateSelectedTransform(values, { notifySelection: false });
    this.cascadeActiveDragToLinks();
    this.emitSelectionChanged();
  }

  /** Highlights the handle under the cursor (idle, not dragging) so it's clear what a click will grab. */
  private updateGizmoHover(clientX: number, clientY: number): void {
    if (this.cameraController.isInteracting) return;
    const handle = this.gizmoGroup.visible ? this.picker.pickGizmoHandle(clientX, clientY) : null;
    const changed = this.gizmoInteraction.setHover(handle);
    if (!changed) return;
    this.canvas.style.cursor = handle ? "pointer" : "";
    this.updateGizmo();
  }

  private clearGizmoHover(): void {
    if (!this.gizmoInteraction.clearHover()) return;
    if (this.canvas.style.cursor === "pointer") this.canvas.style.cursor = "";
    this.updateGizmo();
  }

  private getScreenSpaceMoveBasis(): { right: Vector3; up: Vector3 } {
    return screenSpaceMoveBasis(this.editorViewportCamera().quaternion);
  }

  private select(selection: Selection | null): void {
    this.editorSceneController.select(selection);
    this.updateAiNavigationView();
    this.refreshAllLandscapeSplineOverlays();
  }

  private selectMany(selections: Selection[], active: Selection | null): void {
    this.editorSceneController.selectMany(selections, active);
    this.updateAiNavigationView();
  }

  private toggleSelection(selection: Selection): void {
    this.editorSceneController.toggleSelection(selection);
    this.updateAiNavigationView();
  }

  private captureLinkedTransformStarts(active: Selection): LinkedMoveStart[] | undefined {
    // Everything that should be carried by the active object during a
    // move/rotate/scale drag: the rest of the selection (groups/multi-select)
    // plus all parentâ†’child descendants. For a single selection this reduces to
    // descendants only, matching the old descendant-only rotate/scale capture.
    const targets = new Map<string, Selection>();
    const add = (selection: Selection): void => {
      const id = selectionId(selection);
      if (!targets.has(id)) targets.set(id, cloneSelection(selection));
    };
    for (const selection of this.getSelectedSelections()) add(selection);
    for (const selection of [active, ...targets.values()]) {
      for (const descendant of this.descendantsOf(selection)) add(descendant);
    }

    const linked = [...targets.values()].flatMap((selection) => {
      if (selectionsEqual(selection, active)) return [];
      if (this.isSelectionLocked(selection)) return [];
      const startTransform = this.captureTransform(selection);
      return startTransform ? [{ selection: cloneSelection(selection), startTransform }] : [];
    });
    return linked.length > 0 ? linked : undefined;
  }

  /** During a rotate/scale drag, re-derives linked descendants from the parent. */
  private cascadeActiveDragToLinks(): void {
    const drag = this.pointerDrag;
    if (!drag || (drag.mode !== "rotate" && drag.mode !== "scale")) return;
    if (!drag.linkedTransforms || drag.linkedTransforms.length === 0) return;
    const parentNow = this.captureTransform(drag.selection);
    if (!parentNow) return;
    this.applyCascadeToLinks(drag.startTransform, parentNow, drag.linkedTransforms);
  }

  /**
   * Re-derives each linked descendant's world transform as the parent moves:
   * D1 = (P1 Â· P0â»Â¹) Â· D0, so children keep their start offset/orientation
   * relative to the parent (UE-style hierarchy). Lights skip scale.
   */
  private applyCascadeToLinks(
    parentStart: EditableTransform,
    parentNow: EditableTransform,
    links: LinkedMoveStart[],
  ): void {
    const delta = new Matrix4().multiplyMatrices(
      transformToMatrix(parentNow),
      transformToMatrix(parentStart).invert(),
    );
    for (const link of links) {
      const transform = this.getMutableTransform(link.selection);
      if (!transform) continue;
      const next = matrixToTransform(
        new Matrix4().multiplyMatrices(delta, transformToMatrix(link.startTransform)),
      );
      transform.position = [
        round(next.position[0]),
        round(next.position[1]),
        round(next.position[2]),
      ];
      writeRotation(transform, next.rotation);
      if (link.selection.kind !== "light") writeScale(transform, next.scale);
      this.refreshSelectionObject(link.selection);
    }
    this.updateSelectionBox();
    this.updateGizmo();
  }

  private getGroupedSelections(selection: Selection): Selection[] {
    return groupedSelections(
      selection,
      this.getAllSelections({ includeHidden: true }),
      (entry) => this.getMutableTransform(entry),
    );
  }

  /** All descendants (depth-first), cycle-safe via a visited-nodeId set. */
  private descendantsOf(selection: Selection): Selection[] {
    return descendantSelections(
      selection,
      this.getAllSelections({ includeHidden: true }),
      (entry) => this.getMutableTransform(entry),
    );
  }

  private isSelectionSelected(selection: Selection): boolean {
    return this.editorSceneController.isSelectionSelected(selection);
  }

  private getSelectedSelections(): Selection[] {
    return this.editorSceneController.getSelectedSelections();
  }

  private getAllSelections(options: { includeHidden: boolean }): Selection[] {
    if (!this.layout) return [];
    const selections: Selection[] = [];
    for (const instance of this.layout.instances) {
      instance.placements.forEach((placement, placementIndex) => {
        if (!options.includeHidden && placement.hidden) return;
        selections.push({ kind: "instance", assetId: instance.assetId, placementIndex });
      });
    }
    this.layout.characters.forEach((character, index) => {
      if (!options.includeHidden && character.hidden) return;
      selections.push({ kind: "character", index });
    });
    this.layout.lights?.forEach((light, index) => {
      if (!options.includeHidden && light.hidden) return;
      selections.push({ kind: "light", index });
    });
    this.layout.actors?.forEach((actor, index) => {
      if (!options.includeHidden && actor.hidden) return;
      selections.push({ kind: "actor", index });
    });
    this.layout.reflectionPlanes?.forEach((plane, index) => {
      if (!options.includeHidden && plane.hidden) return;
      selections.push({ kind: "reflectionPlane", index });
    });
    this.layout.reflectiveSurfaces?.forEach((surface, index) => {
      if (!options.includeHidden && surface.hidden) return;
      selections.push({ kind: "reflectiveSurface", index });
    });
    this.layout.reflectionCaptures?.forEach((capture, index) => {
      if (!options.includeHidden && capture.hidden) return;
      selections.push({ kind: "reflectionCapture", index });
    });
    this.layout.blockingVolumes?.forEach((volume, index) => {
      if (!options.includeHidden && volume.hidden) return;
      selections.push({ kind: "blockingVolume", index });
    });
    this.layout.aiNavigationVolumes?.forEach((volume, index) => {
      if (!options.includeHidden && volume.hidden) return;
      selections.push({ kind: "aiNavigationVolume", index });
    });
    this.layout.targetPoints?.forEach((point, index) => {
      if (!options.includeHidden && point.hidden) return;
      selections.push({ kind: "targetPoint", index });
    });
    this.layout.splines?.forEach((actor, index) => {
      if (!options.includeHidden && actor.hidden) return;
      selections.push({ kind: "spline", index });
    });
    this.layout.landscapes?.forEach((actor, index) => {
      if (!options.includeHidden && actor.hidden) return;
      selections.push({ kind: "landscape", index });
    });
    return selections;
  }

  private getSelectionLabel(selection: Selection): string {
    if (selection.kind === "sky") {
      return resolveSkyAtmosphere(this.layout?.skyAtmosphere ?? null).name;
    }
    if (selection.kind === "fog") {
      return resolveHeightFog(this.layout?.heightFog ?? null).name;
    }
    if (selection.kind === "cloud") {
      return resolveCloudLayer(this.layout?.cloudLayer ?? null).name;
    }
    if (selection.kind === "post") {
      return resolvePostProcess(this.layout?.postProcess ?? null).name;
    }
    if (selection.kind === "reflectionPlane") {
      return resolveReflectionPlane(this.layout?.reflectionPlanes?.[selection.index] ?? null).name;
    }
    if (selection.kind === "reflectiveSurface") {
      return resolveReflectiveSurface(
        this.layout?.reflectiveSurfaces?.[selection.index] ?? null,
      ).name;
    }
    if (selection.kind === "reflectionCapture") {
      return resolveSphereReflectionCapture(
        this.layout?.reflectionCaptures?.[selection.index] ?? null,
      ).name;
    }
    if (selection.kind === "blockingVolume") {
      return resolveBlockingVolume(this.layout?.blockingVolumes?.[selection.index] ?? null).name;
    }
    if (selection.kind === "aiNavigationVolume") {
      return resolveAiNavigationVolume(this.layout?.aiNavigationVolumes?.[selection.index] ?? null).name;
    }
    if (selection.kind === "targetPoint") {
      return resolveTargetPoint(this.layout?.targetPoints?.[selection.index] ?? null).name;
    }
    if (selection.kind === "spline") {
      return this.layout?.splines?.[selection.index]?.name ?? "Spline";
    }
    if (selection.kind === "landscape") {
      return resolveLandscape(this.layout?.landscapes?.[selection.index] ?? null).name;
    }
    const transform = this.getMutableTransform(selection);
    if (selection.kind === "instance") {
      return transform?.name ?? selection.assetId;
    }
    if (selection.kind === "light") {
      const light = transform as LayoutLightActor | null;
      return light?.name ?? light?.id ?? "light";
    }
    if (selection.kind === "actor") {
      const actor = transform as LayoutActorInstance | null;
      return actor?.name ?? (actor ? actorClassName(actor.classRef) : "actor");
    }
    const character = transform as LayoutCharacter | null;
    return character?.name ?? character?.assetId ?? "object";
  }

  /** The active selection's local authoring pivot (`[0,0,0]` when none / light). */
  private getSelectionPivot(selection: Selection): Vec3 {
    if (
      selection.kind === "light" ||
      selection.kind === "actor" ||
      selection.kind === "reflectionCapture" ||
      selection.kind === "aiNavigationVolume" ||
      selection.kind === "targetPoint" ||
      selection.kind === "spline" ||
      selection.kind === "landscape"
    ) {
      return [0, 0, 0];
    }
    const transform = this.getMutableTransform(selection) as
      | LayoutPlacement
      | LayoutCharacter
      | null;
    return transform ? readPivot(transform) : [0, 0, 0];
  }

  /** World-space position of a selection's pivot point (gizmo anchor). */
  private getSelectionPivotWorld(selection: Selection): Vector3 | null {
    const editable = this.captureTransform(selection);
    if (!editable) return null;
    const pivot = this.getSelectionPivot(selection);
    return new Vector3(...pivot).applyMatrix4(transformToMatrix(editable));
  }

  /** Model-space AABB for pivot presets (instances only for now). */
  private getLocalBounds(selection: Selection): Box3 | null {
    if (selection.kind === "instance") return this.localBounds.get(selection.assetId) ?? null;
    return null;
  }

  private getSelectionWorldBox(selection: Selection): Box3 | null {
    if (selection.kind === "instance") {
      const bounds = this.localBounds.get(selection.assetId);
      const transform = this.getMutableTransform(selection);
      if (!bounds || !transform) return null;
      return bounds.clone().applyMatrix4(composePlacementMatrix(transform));
    }
    if (selection.kind === "light") {
      const record = this.lightObjects[selection.index];
      if (!record) return null;
      // Box the small icon, not the (large) wireframe reach.
      const icon = record.gizmo.getObjectByName("light-icon") ?? record.root;
      return new Box3().setFromObject(icon);
    }
    if (selection.kind === "actor") {
      const actorObject = this.actorObjects[selection.index];
      return actorObject ? new Box3().setFromObject(actorObject) : null;
    }
    if (selection.kind === "reflectionPlane") {
      const reflector = this.reflectionPlaneObjects[selection.index];
      return reflector ? new Box3().setFromObject(reflector) : null;
    }
    if (selection.kind === "reflectiveSurface") {
      const surface = this.reflectiveSurfaceObjects[selection.index];
      return surface ? new Box3().setFromObject(surface) : null;
    }
    if (selection.kind === "reflectionCapture") {
      const helper = this.reflectionCaptureObjects[selection.index];
      return helper ? new Box3().setFromObject(helper) : null;
    }
    if (selection.kind === "blockingVolume") {
      const object = this.blockingVolumeObjects[selection.index];
      return object ? new Box3().setFromObject(object) : null;
    }
    if (selection.kind === "aiNavigationVolume") {
      const object = this.aiNavigationVolumeObjects[selection.index];
      return object ? new Box3().setFromObject(object) : null;
    }
    if (selection.kind === "targetPoint") {
      const object = this.targetPointObjects[selection.index];
      return object ? new Box3().setFromObject(object) : null;
    }
    if (selection.kind === "spline") {
      const object = this.splineObjects[selection.index];
      return object ? new Box3().setFromObject(object) : null;
    }
    if (selection.kind === "worldWidget") {
      const icon = this.worldWidgetIcons[selection.index];
      return icon ? new Box3().setFromObject(icon) : null;
    }
    if (selection.kind === "landscape") {
      const object = this.landscapeObjects[selection.index];
      return object ? new Box3().setFromObject(object) : null;
    }
    // Environment singletons have no transform bounds.
    if (
      selection.kind === "sky" ||
      selection.kind === "fog" ||
      selection.kind === "cloud" ||
      selection.kind === "post"
    ) {
      return null;
    }
    const object = this.characterObjects[selection.index];
    return object ? new Box3().setFromObject(object) : null;
  }

  private updateSelectionBox(): void {
    this.removeSelectionBox();
    this.updateLightGizmoVisibility();
    // Probe influence spheres follow selection (like the light wireframes).
    this.updateReflectionCaptureHelperVisibility();
    // Collision overlay refreshes with the same cadence as selection boxes, so it
    // tracks live transform edits (drag/cascade all route through here).
    this.updateCollisionBoxes();
    this.updateAiNavigationView();
    if (!this.layout || !this.selectionOutline) return;

    const outlineTargets: Object3D[] = [];
    for (const selection of this.getSelectedSelections()) {
      const target = this.createSelectionOutlineTarget(selection);
      if (target) outlineTargets.push(target);
    }
    this.selectionOutline.setTargets(outlineTargets);
  }

  private createSelectionOutlineTarget(selection: Selection): Object3D | null {
    if (!this.selectionOutline || !this.layout) return null;
    // The Sky Atmosphere + Cloud Layer are full-screen backdrops and Height Fog is scene-wide; none has an outline proxy.
    if (selection.kind === "sky" || selection.kind === "fog" || selection.kind === "cloud") {
      return null;
    }

    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      const placement = instance?.placements[selection.placementIndex];
      const gltf = this.models.get(selection.assetId);
      if (!placement || !gltf || placement.hidden) return null;
      return this.createInstanceOutlineTarget(selection.assetId, placement, gltf);
    }

    if (selection.kind === "reflectionPlane") {
      const reflector = this.reflectionPlaneObjects[selection.index];
      const actor = this.layout.reflectionPlanes?.[selection.index];
      if (!reflector || actor?.hidden) return null;
      return this.selectionOutline.cloneRenderableMeshes(reflector);
    }

    if (selection.kind === "landscape") {
      const object = this.landscapeObjects[selection.index];
      const actor = this.layout.landscapes?.[selection.index];
      if (!object || actor?.hidden) return null;
      return this.selectionOutline.cloneRenderableMeshes(object);
    }

    if (selection.kind === "reflectiveSurface") {
      const surface = this.reflectiveSurfaceObjects[selection.index];
      const actor = this.layout.reflectiveSurfaces?.[selection.index];
      if (!surface || actor?.hidden) return null;
      return this.selectionOutline.cloneRenderableMeshes(surface);
    }

    if (selection.kind === "blockingVolume") {
      const object = this.blockingVolumeObjects[selection.index];
      const actor = this.layout.blockingVolumes?.[selection.index];
      if (!object || actor?.hidden) return null;
      return this.selectionOutline.cloneRenderableMeshes(object);
    }

    if (selection.kind === "aiNavigationVolume") {
      const object = this.aiNavigationVolumeObjects[selection.index];
      const actor = this.layout.aiNavigationVolumes?.[selection.index];
      if (!object || actor?.hidden) return null;
      return this.selectionOutline.cloneRenderableMeshes(object);
    }

    if (selection.kind === "targetPoint") {
      const object = this.targetPointObjects[selection.index];
      const point = this.layout.targetPoints?.[selection.index];
      if (!object || point?.hidden) return null;
      return this.selectionOutline.cloneRenderableMeshes(object);
    }

    if (selection.kind === "reflectionCapture") {
      const helper = this.reflectionCaptureObjects[selection.index];
      const actor = this.layout.reflectionCaptures?.[selection.index];
      if (!helper || actor?.hidden) return null;
      // The helper is line geometry (no renderable mesh to clone), so glow the
      // influence sphere via an invisible proxy sized by the helper's world
      // matrix — mirrors the light-icon outline path and matches Unreal, where
      // selecting a capture highlights its influence sphere.
      helper.updateMatrixWorld(true);
      const proxy = new Mesh(this.captureOutlineGeometry, this.selectionOutline.getInvisibleMaterial());
      proxy.name = "reflection-capture-outline-proxy";
      proxy.matrix.copy(helper.matrixWorld);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      proxy.raycast = () => {};
      return proxy;
    }

    if (selection.kind === "light") {
      const record = this.lightObjects[selection.index];
      const actor = this.layout.lights?.[selection.index];
      if (!record || actor?.hidden) return null;
      const proxy = new Mesh(
        this.lightOutlineGeometry,
        this.selectionOutline.getInvisibleMaterial(),
      );
      proxy.name = "light-outline-proxy";
      proxy.matrix.copy(record.root.matrixWorld);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      proxy.raycast = () => {};
      return proxy;
    }

    if (selection.kind === "actor") {
      const actorObject = this.actorObjects[selection.index];
      const actor = this.layout.actors?.[selection.index];
      if (!actorObject || actor?.hidden) return null;
      return this.selectionOutline.cloneRenderableMeshes(actorObject);
    }

    if (selection.kind === "post") {
      return null;
    }

    // World widgets are billboard markers, not renderable meshes — the selection
    // box (selectionBounds) is feedback enough; no outline.
    if (selection.kind === "worldWidget") {
      return null;
    }

    const object = this.characterObjects[selection.index];
    const character = this.layout.characters[selection.index];
    if (!object || character?.hidden) return null;
    return this.selectionOutline.cloneRenderableMeshes(object);
  }

  private createInstanceOutlineTarget(
    assetId: string,
    placement: LayoutPlacement,
    gltf: GLTF,
  ): Object3D | null {
    const outline = this.selectionOutline;
    if (!outline) return null;
    const placementMatrix = composePlacementMatrix(placement);
    const group = new Group();
    group.name = `${assetId}-outline-proxy`;

    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if (!isRenderableMesh(object)) return;
      const proxy = new Mesh(object.geometry, outline.getInvisibleMaterial());
      proxy.name = `${object.name || "mesh"}-outline-proxy`;
      proxy.matrix.copy(placementMatrix).multiply(object.matrixWorld);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      proxy.raycast = () => {};
      group.add(proxy);
    });

    return group.children.length > 0 ? group : null;
  }

  /** Whether the "Show > Collision" overlay is on. */
  getShowCollision(): boolean {
    return this.showCollision;
  }

  /** Toggles the "Show > Collision" overlay and rebuilds it immediately. */
  setShowCollision(visible: boolean): void {
    if (this.showCollision === visible) return;
    this.showCollision = visible;
    this.updateCollisionBoxes();
    // Pick up sidecars authored/edited since the scene loaded, then rebuild.
    if (visible) void this.refreshCollisionDefs();
  }

  /** Whether the "Show > AI Navigation" overlay is on. */
  getShowAiNavigation(): boolean {
    return this.showAiNavigation;
  }

  /** Toggles the "Show > AI Navigation" authoring overlay. */
  setShowAiNavigation(visible: boolean): void {
    if (this.showAiNavigation === visible) return;
    this.showAiNavigation = visible;
    this.updateAiNavigationView();
    // Pick up sidecars authored/edited since the scene loaded, then rebuild.
    if (visible) void this.refreshCollisionDefs();
  }

  /**
   * Forces the AI Navigation preview to recompute from the live layout. The
   * overlay already rebakes automatically on every scene edit (see
   * {@link emitSceneObjectsChanged}) and the runtime bakes on demand via the
   * revision-tokened grid cache, so there is no persistent bake to regenerate;
   * this is the explicit "recompute now" for the Nav Volume details panel. It also
   * reloads `*.collision.json` sidecars so externally edited collision picks up.
   */
  rebakeAiNavigation(): void {
    void this.refreshCollisionDefs();
    this.updateAiNavigationView();
    this.onStatus?.("AI Navigation rebaked.", "info");
  }

  /**
   * Loads authored collision sidecars (`*.collision.json`) for the assets in the
   * current layout into `collisionDefs`, then rebuilds the overlay. Async and
   * race-safe: only definitions with primitives are kept (others fall back to the
   * auto bounding box). Shape actors aren't in the manifest, so they are skipped.
   */
  private async refreshCollisionDefs(): Promise<void> {
    if (!this.manifest || !this.layout) return;
    const assetIds = new Set<string>();
    for (const instance of this.layout.instances) assetIds.add(instance.assetId);
    for (const character of this.layout.characters) assetIds.add(character.assetId);
    const next = new Map<string, AssetCollisionDef>();
    for (const assetId of assetIds) {
      const def = shapeAssetCollisionDef(assetId);
      if (def && assetCollisionDefHasCollider(def)) next.set(assetId, def);
    }
    await Promise.all(
      [...assetIds].map(async (assetId) => {
        if (next.has(assetId)) return;
        const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
        if (!asset) return;
        const def = await loadAssetCollision(assetPath(asset));
        if (assetCollisionDefHasCollider(def)) next.set(assetId, def);
      }),
    );
    this.collisionDefs = next;
    this.complexCollisionMeshes = computeComplexCollisionMeshes(
      this.models,
      complexAsSimpleAssetIds(next),
    );
    this.updateCollisionBoxes();
    this.updateAiNavigationView();
  }

  /** Returns the authored collision complexity for an asset, if a sidecar is loaded. */
  assetCollisionComplexity(assetId: string): CollisionComplexity | undefined {
    return this.collisionDefs.get(assetId)?.complexity;
  }

  /**
   * Reloads authored collision sidecars after the Static Mesh editor saves one,
   * so the overlay, Play-mode physics document, and the Details collision/physics
   * guards pick up the new preset/complexity/primitives. Reloads the whole set
   * (cheap; mirrors the material/UVW refresh hooks).
   */
  async refreshAssetCollision(): Promise<void> {
    await this.refreshCollisionDefs();
  }

  async refreshAssetMaterialSlots(
    assetIds?: string | string[],
    options: { rebuild?: boolean } = {},
  ): Promise<void> {
    if (!this.manifest) return;
    const rebuild = options.rebuild !== false;
    const ids = typeof assetIds === "string"
      ? [assetIds]
      : assetIds ?? sceneModelAssetIds(this.layout);
    await Promise.all(
      [...new Set(ids)].map(async (assetId) => {
        const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
        if (!asset) return;
        const materialSlots = await loadAssetMaterialSlots(assetPath(asset));
        if (hasAssignedMaterialSlots(materialSlots)) {
          this.assetMaterialSlots.set(assetId, materialSlots);
          await Promise.all(assignedMaterialSlotIds(materialSlots).map((slotId) =>
            this.ensureMaterialLoaded(slotId),
          ));
        } else {
          this.assetMaterialSlots.delete(assetId);
        }
      }),
    );
    if (rebuild) {
      for (const assetId of new Set(ids)) this.rebuildInstanceGroup(assetId);
    }
  }

  async refreshMaterialAsset(materialId: string): Promise<void> {
    if (!this.layout) return;
    this.materialCache.delete(materialId);
    this.materialLoads.delete(materialId);
    const affectedAssetIds = new Set<string>();
    for (const instance of this.layout.instances) {
      const defaultSlots = this.assetMaterialSlots.get(instance.assetId)?.slots ?? [];
      if (defaultSlots.includes(materialId)) {
        affectedAssetIds.add(instance.assetId);
        continue;
      }
      if (instance.placements.some((placement) => placement.materialSlot === materialId)) {
        affectedAssetIds.add(instance.assetId);
      }
    }
    if (affectedAssetIds.size === 0) return;
    await this.ensureMaterialLoaded(materialId);
    for (const assetId of affectedAssetIds) this.rebuildInstanceGroup(assetId);
  }

  async refreshAssetUvwMapping(
    assetIds?: string | string[],
    options: { rebuild?: boolean } = {},
  ): Promise<void> {
    if (!this.manifest || !this.layout) return;
    const rebuild = options.rebuild !== false;
    const ids = typeof assetIds === "string"
      ? [assetIds]
      : assetIds ?? sceneModelAssetIds(this.layout);
    await Promise.all(
      [...new Set(ids)].map(async (assetId) => {
        const asset = this.manifest?.assets.find((entry) => entry.id === assetId);
        const gltf = this.models.get(assetId);
        if (!asset || !gltf) return;
        applyAssetUvwMapping(gltf.scene, await loadAssetUvw(assetPath(asset)));
      }),
    );
    if (rebuild) {
      for (const assetId of new Set(ids)) this.rebuildInstanceGroup(assetId);
    }
  }

  /**
   * Rebuilds the collision overlay from the current layout + model bounds. Solid
   * colliders draw green, sensors amber; both match the collider physics derives
   * (see `collisionWireboxes`). A no-op (after clearing) while the overlay is off.
   */
  private updateCollisionBoxes(): void {
    this.removeCollisionBoxes();
    if (!this.showCollision || !this.layout) return;
    for (const { box, segments, sensor } of collisionWireboxes(
      this.layout,
      this.localBounds,
      this.collisionDefs,
      this.complexCollisionMeshes,
    )) {
      if (box.isEmpty() || segments.length === 0) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(segments.flatMap((point) => point), 3),
      );
      const material = new LineBasicMaterial({ color: sensor ? 0xffb454 : 0x4cd07d });
      const helper = new LineSegments(geometry, material);
      helper.name = "editor-collision-box";
      this.collisionBoxes.push(helper);
      this.scene.add(helper);
    }
    this.updateLandscapeCollisionWires();
  }

  /**
   * Adds the terrain trimesh wire for every collidable landscape actor to the
   * "Show > Collision" overlay — the editor twin of the collider debug wire the
   * runtime always draws in Play. The heightfield collider mirrors the render
   * mesh, so this reveals exactly the surface characters walk on. Built in local
   * landscape space and positioned by the actor transform, matching
   * `applyLandscapeTransform` (there is no landscape transform scale).
   */
  private updateLandscapeCollisionWires(): void {
    if (!this.layout) return;
    for (const actor of this.layout.landscapes ?? []) {
      const item = this.landscapeItem(actor);
      if (!item.collision) continue;
      const data = this.landscapeData.get(actor.id);
      if (!data) continue;
      const primitive = createLandscapeColliderPrimitive(data);
      const segments = trimeshWireSegments(primitive.vertices, primitive.indices);
      if (segments.length === 0) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(segments.flatMap((point) => point), 3),
      );
      // Depth-tested (like the other editor collision wireboxes): the terrain
      // occludes edges behind its surface, so the overlay stays readable and
      // doesn't draw over the actors in front of it. The runtime's Play wire
      // uses depthTest:false for an always-on-top debug look; the editor
      // authoring overlay deliberately does not.
      const helper = new LineSegments(
        geometry,
        new LineBasicMaterial({ color: 0x4cd07d }),
      );
      helper.name = "editor-collision-box";
      helper.position.set(actor.position[0], actor.position[1], actor.position[2]);
      helper.rotation.set(
        (item.rotation[0] * Math.PI) / 180,
        (item.rotation[1] * Math.PI) / 180,
        (item.rotation[2] * Math.PI) / 180,
        "XYZ",
      );
      this.collisionBoxes.push(helper);
      this.scene.add(helper);
    }
  }

  private updateAiNavigationView(): void {
    this.removeAiNavigationView();
    if (!this.showAiNavigation || !this.layout) return;
    const blockers = this.editorNavBlockers();
    const profile = this.aiNavDebugProfile();
    const inflatedBlockers = blockers.map((blocker) => inflateNavBlocker2d(blocker, profile.clearanceRadius));
    const bounds = this.aiNavigationBounds();
    const perception = this.aiPerceptionView();
    const queries = this.aiQueryView();
    const routes = this.aiTargetPointRouteView();
    const agentClearances = this.aiAgentClearanceView(profile);
    const passableCells = this.aiNavPassableCells(blockers, bounds, profile);
    if (
      blockers.length === 0 &&
      inflatedBlockers.length === 0 &&
      bounds.length === 0 &&
      perception.length === 0 &&
      queries.length === 0 &&
      routes.length === 0 &&
      agentClearances.length === 0
    ) {
      return;
    }
    this.aiNavigationView = createAiNavigationView({
      blockers,
      inflatedBlockers,
      passableCells,
      bounds,
      cellSize: AI_NAV_DEBUG_CELL_SIZE,
      perception,
      queries,
      routes,
      agentClearances,
    });
    this.scene.add(this.aiNavigationView);
  }

  /**
   * Walkable cell centers of the baked nav grid for the default debug agent —
   * drawn as the green walkable-area fill. Only meaningful inside authored AI
   * Navigation Volumes (they give the grid a fixed extent); returns [] otherwise.
   * Baked at the volume floor so floor-level obstacles erode the area while an
   * agent still reads as able to stand under high overhangs (vertical filtering).
   */
  private aiNavPassableCells(
    blockers: readonly NavBlocker[],
    bounds: readonly NavAabb[],
    profile: AiNavDebugProfile,
  ): Vec3[] {
    if (bounds.length === 0) return [];
    let floorY = Infinity;
    for (const bound of bounds) floorY = Math.min(floorY, bound.min[1]);
    if (!Number.isFinite(floorY)) return [];
    const agent: NavAgent = {
      radius: profile.agentRadius,
      // Realistic standing agent, not the full volume height — a beam above head
      // height must not paint the floor under it as blocked.
      height: AI_NAV_DEBUG_AGENT_HEIGHT,
      // Without a step height the ground slab itself (top ~= floor) reads as a
      // vertical obstacle and blocks every cell, so nothing renders green.
      stepHeight: AI_NAV_DEBUG_AGENT_STEP_HEIGHT,
      maxStepDown: AI_NAV_DEBUG_AGENT_STEP_DOWN,
      maxSlopeAngleDeg: AI_NAV_DEBUG_AGENT_MAX_SLOPE_DEG,
      clearancePadding: profile.clearancePadding,
    };
    const grid = buildNavGrid({
      agent,
      blockers,
      bounds,
      footY: floorY,
      sampleFloorYs: this.aiNavDebugFloorSampler(blockers, bounds, agent, floorY),
      cellSize: AI_NAV_DEBUG_CELL_SIZE,
      safetyMargin: AI_NAV_DEBUG_GRID_SAFETY_MARGIN,
    });
    if (!grid) return [];
    const cells: Vec3[] = [];
    if (grid.layerOffsets && grid.layerCell && grid.layerFloorY) {
      for (let i = 0; i < grid.layerFloorY.length; i += 1) {
        const cell = grid.layerCell[i] ?? 0;
        const x = cell % grid.cols;
        const z = Math.floor(cell / grid.cols);
        cells.push([grid.originX + x * grid.cellSize, grid.layerFloorY[i] ?? floorY, grid.originZ + z * grid.cellSize]);
      }
      return cells;
    }
    for (let z = 0; z < grid.rows; z += 1) {
      for (let x = 0; x < grid.cols; x += 1) {
        const idx = z * grid.cols + x;
        if (grid.passable[idx] !== 1) continue;
        cells.push([grid.originX + x * grid.cellSize, grid.floorY[idx] ?? floorY, grid.originZ + z * grid.cellSize]);
      }
    }
    return cells;
  }

  private aiNavDebugFloorSampler(
    blockers: readonly NavBlocker[],
    bounds: readonly NavAabb[],
    agent: NavAgent,
    preferredFloorY: number,
  ): (x: number, z: number) => readonly number[] | null {
    const footprintHalf: [number, number] = [Math.max(0, agent.radius), Math.max(0, agent.radius)];
    const maxSlopeCos = slopeCosFromDegrees(agent.maxSlopeAngleDeg ?? AI_NAV_DEBUG_AGENT_MAX_SLOPE_DEG);
    // Live surfaces from the layout (like `editorNavBlockers`), NOT the physics
    // cache — physics static bodies are only populated at scene load, so a deleted
    // or moved ramp would otherwise leave its walkable cells frozen in the preview.
    const surfaces = this.layout
      ? collisionSurfaceTriangles(this.layout, this.complexCollisionMeshes, this.collisionDefs)
      : [];
    return (x, z) => {
      let minY = Infinity;
      let maxY = -Infinity;
      for (const bound of bounds) {
        if (x < bound.min[0] || x > bound.max[0] || z < bound.min[2] || z > bound.max[2]) continue;
        minY = Math.min(minY, bound.min[1]);
        maxY = Math.max(maxY, bound.max[1]);
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY < minY) return null;
      const hits = findGroundLayersAt([x, maxY, z], blockers, {
        footprintHalf,
        maxStepUp: 0,
        maxStepDown: maxY - minY,
        surfaces,
        maxSlopeCos,
        preferredFloorY,
        requiredSupportRadius: Math.min(Math.max(0, agent.radius), AI_NAV_DEBUG_MIN_TOP_SUPPORT_RADIUS),
        // Recast walkableHeight, mirroring the runtime sampler: a floor layer with
        // less than the agent's height of clearance above it (a ramp/stair body
        // overhead) is not walkable, so no green cells are painted under ramps.
        requiredHeadroom: Math.max(0, agent.height),
        respectNavigationRole: true,
      });
      // Same collapse as the runtime sampler: near-coincident surfaces (a solid
      // floor's top face vs. its slab underside) are one navigable floor.
      const layers = collapseCoincidentFloors(
        hits.map((hit) => hit.floorY),
        Math.max(agent.stepHeight ?? 0, 1e-3),
      );
      return layers.length > 0 ? layers : null;
    };
  }

  /**
   * Builds the Target Point patrol route overlay: one marker per point, a
   * directed link to its `nextTargetPoint`, and an active highlight for any point
   * a live AI (editor Play) is currently patrolling toward.
   */
  private aiTargetPointRouteView(): AiTargetPointRouteView[] {
    const points = this.layout?.targetPoints ?? [];
    if (points.length === 0) return [];
    const index = createTargetPointIndex(targetPointEntriesFromLayout(points));
    const activeIds = this.aiActivePatrolTargetIds();
    return index.all().map((entry) => {
      const next = index.next(entry.id);
      return {
        id: entry.id,
        position: entry.position,
        next: next ? next.position : null,
        ...(activeIds.has(entry.id) ? { active: true } : {}),
      };
    });
  }

  /** Target Point ids referenced as string blackboard values by any live AI. */
  private aiActivePatrolTargetIds(): Set<string> {
    const ids = new Set<string>();
    for (const controller of this.aiSubsystem.getDebugSnapshot().controllers) {
      for (const entry of controller.blackboard.entries) {
        if (typeof entry.value === "string" && entry.value.length > 0) ids.add(entry.value);
      }
    }
    return ids;
  }

  private aiPerceptionView(): AiPerceptionView[] {
    return this.aiSubsystem.getDebugSnapshot().controllers
      .filter((controller) => controller.position && controller.forward && controller.perceptionConfig)
      .map((controller) => ({
        entityId: controller.pawnEntityId,
        position: controller.position!,
        forward: controller.forward!,
        ...(controller.perceptionConfig!.sightRadius !== undefined
          ? { sightRadius: controller.perceptionConfig!.sightRadius }
          : {}),
        ...(controller.perceptionConfig!.fieldOfViewDeg !== undefined
          ? { fieldOfViewDeg: controller.perceptionConfig!.fieldOfViewDeg }
          : {}),
        ...(controller.perceptionConfig!.hearingRadius !== undefined
          ? { hearingRadius: controller.perceptionConfig!.hearingRadius }
          : {}),
      }));
  }

  private aiQueryView(): AiQueryCandidateView[] {
    const out: AiQueryCandidateView[] = [];
    for (const controller of this.aiSubsystem.getDebugSnapshot().controllers) {
      const query = controller.query;
      if (!query) continue;
      const winnerId = query.winner?.id ?? null;
      const candidates = query.candidates.length > 0
        ? query.candidates
        : query.winner
          ? [query.winner]
          : [];
      for (const candidate of candidates) {
        out.push({
          ...(candidate.entityId ? { entityId: candidate.entityId } : {}),
          position: candidate.position,
          score: candidate.score,
          failedTests: candidate.failedTests,
          winner: candidate.id === winnerId,
        });
      }
    }
    return out;
  }

  private aiAgentClearanceView(profile: AiNavDebugProfile): AiNavAgentClearanceView[] {
    const selectedAiEntityId = this.selectedAiEntityId();
    return this.aiSubsystem.getDebugSnapshot().controllers
      .filter((controller) => controller.position)
      .map((controller) => ({
        entityId: controller.pawnEntityId,
        position: controller.position!,
        agentRadius: profile.agentRadius,
        radius: profile.clearanceRadius,
        ...(selectedAiEntityId === controller.pawnEntityId ? { selected: true } : {}),
      }));
  }

  private aiNavDebugProfile(): AiNavDebugProfile {
    const selectedVolume =
      this.selection?.kind === "aiNavigationVolume"
        ? this.layout?.aiNavigationVolumes?.[this.selection.index]
        : undefined;
    const fallbackVolume = this.layout?.aiNavigationVolumes?.find((volume) => volume.hidden !== true);
    const resolved = resolveAiNavigationVolume(selectedVolume ?? fallbackVolume ?? null);
    const agentRadius = saneAiNavPreviewNumber(resolved.agentRadius, AI_NAV_DEBUG_DEFAULT_AGENT_RADIUS);
    const clearancePadding = saneAiNavPreviewNumber(
      resolved.clearancePadding,
      AI_NAV_DEBUG_DEFAULT_CLEARANCE_PADDING,
    );
    return {
      agentRadius,
      clearancePadding,
      clearanceRadius: agentRadius + clearancePadding + AI_NAV_DEBUG_GRID_SAFETY_MARGIN,
    };
  }

  private selectedAiEntityId(): string | null {
    const selection = this.selection;
    if (!selection || (selection.kind !== "actor" && selection.kind !== "character")) return null;
    return selectionId(selection);
  }

  private aiNavigationBounds(): NavAabb[] {
    const bounds: NavAabb[] = [];
    for (const volume of this.layout?.aiNavigationVolumes ?? []) {
      const bound = aiNavigationVolumeAabb(volume);
      if (!bound) continue;
      bounds.push({
        min: [bound.min[0], bound.min[1], bound.min[2]],
        max: [bound.max[0], bound.max[1], bound.max[2]],
      });
    }
    return bounds;
  }

  private editorNavBlockers(): NavBlocker[] {
    if (!this.layout) return [];
    // Derive blockers straight from the live layout (same source as the green
    // "Show > Collision" overlay), NOT from `physicsSubsystem.staticBlockerAabbs()`.
    // Physics bodies are only populated once at scene load and edit-mode transform
    // edits don't push into them, so the cached AABBs go stale the moment you drag
    // a static mesh — which left the red blocker footprints frozen. The layout is
    // mutated in place on every edit, so this path tracks drags/cascades live.
    return collisionWireboxes(
      this.layout,
      this.localBounds,
      this.collisionDefs,
      this.complexCollisionMeshes,
    )
      .filter((wirebox) => !wirebox.sensor && wirebox.navigationRole !== "ignored" && !wirebox.box.isEmpty())
      .map((wirebox) => {
        const aabb: NavBlocker & { seedsGround?: boolean } = {
          min: [wirebox.box.min.x, wirebox.box.min.y, wirebox.box.min.z],
          max: [wirebox.box.max.x, wirebox.box.max.y, wirebox.box.max.z],
          navigationRole: wirebox.navigationRole,
          // A complexAsSimple hull box's flat top is fictional (a peak-height
          // plane over the whole footprint) — the mesh's real floors come from
          // its surface triangles, so the ground probe must not seed from it.
          ...(wirebox.complexHull ? { seedsGround: false } : {}),
        };
        // The wirebox `segments` are the collider's *rotated* world corners, so
        // their XZ hull is the true oriented ground footprint — the same tight
        // shape the physics blocker path bakes. Skip it when the hull already
        // fills the AABB (an axis-aligned box), keeping that case on the exact,
        // cheaper AABB path.
        const footprint = navFootprintFromSegments(wirebox.segments, wirebox.box);
        return footprint ? { ...aabb, footprint } : aabb;
      });
  }

  private removeCollisionBoxes(): void {
    for (const collisionBox of this.collisionBoxes) {
      this.scene.remove(collisionBox);
      collisionBox.geometry.dispose();
      const materials = Array.isArray(collisionBox.material)
        ? collisionBox.material
        : [collisionBox.material];
      for (const material of materials) material.dispose();
    }
    this.collisionBoxes.length = 0;
  }

  private removeAiNavigationView(): void {
    if (!this.aiNavigationView) return;
    this.scene.remove(this.aiNavigationView);
    disposeAiNavigationView(this.aiNavigationView);
    this.aiNavigationView = null;
  }

  /** Shows a light's wireframe reach only while it is selected. */
  private updateLightGizmoVisibility(): void {
    this.lightObjects.forEach((record, index) => {
      const wire = record.gizmo.getObjectByName("light-wire");
      if (wire) wire.visible = this.isLightSelected(index);
    });
  }

  private isLightSelected(index: number): boolean {
    return this.isSelectionSelected({ kind: "light", index });
  }

  private removeSelectionBox(): void {
    this.selectionOutline?.setTargets([]);
  }

  private updateGizmo(): void {
    clearGizmoGroup(this.gizmoGroup, this.gizmoPickables);
    this.refreshSplinePointOverlay();
    if (!this.selection) return;
    // The Sky Atmosphere, Height Fog, Cloud Layer and Post Process are scene-wide
    // environment singletons with no transform, so they never show a move gizmo.
    if (
      this.selection.kind === "sky" ||
      this.selection.kind === "fog" ||
      this.selection.kind === "cloud" ||
      this.selection.kind === "post"
    ) {
      return;
    }

    // A landscape spline control point (Faz 6.1) shows a world-space move gizmo at
    // the point regardless of the active tool — it's the only transform for it.
    const splinePoint = this.activeLandscapeSplinePoint();
    if (splinePoint) {
      this.gizmoGroup.visible = true;
      this.gizmoGroup.position.copy(splinePoint.world);
      this.gizmoGroup.rotation.set(0, 0, 0);
      buildGizmoHandles("move", this.gizmoGroup, this.gizmoPickables, this.gizmoInteraction);
      this.updateGizmoScreenScale();
      return;
    }

    const genericSplinePoint = this.activeSplinePoint();
    if (genericSplinePoint) {
      this.gizmoGroup.visible = true;
      this.gizmoGroup.position.copy(genericSplinePoint.world);
      this.gizmoGroup.rotation.set(0, 0, 0);
      buildGizmoHandles("move", this.gizmoGroup, this.gizmoPickables, this.gizmoInteraction);
      this.updateGizmoScreenScale();
      return;
    }

    const selected = this.getSelected();
    // In pivot-edit mode the move gizmo is shown even under the Select tool.
    const pivotEditing = this.pivotEditMode && this.selection.kind !== "light";
    if (!selected || (this.activeTool === "select" && !pivotEditing)) return;
    if (this.selection && this.isSelectionLocked(this.selection)) return;

    this.gizmoGroup.visible = true;
    const pivotWorld = this.getSelectionPivotWorld(this.selection);
    if (pivotWorld) this.gizmoGroup.position.copy(pivotWorld);
    else this.gizmoGroup.position.set(...selected.position);
    if (this.transformSpace === "local") {
      applyEulerDegrees(this.gizmoGroup, selected.rotation);
    } else {
      this.gizmoGroup.rotation.set(0, 0, 0);
    }

    // World widgets are screen-projected billboards: only translation is
    // meaningful, so they always show the move gizmo regardless of the active tool.
    const tool =
      this.selection.kind === "worldWidget" ? "move" : pivotEditing ? "move" : this.activeTool;
    if (tool === "move" || tool === "rotate" || tool === "scale") {
      buildGizmoHandles(tool, this.gizmoGroup, this.gizmoPickables, this.gizmoInteraction);
    }
    this.updateGizmoScreenScale();
  }

  private updateGizmoScreenScale(): void {
    if (!this.gizmoGroup.visible) return;
    const viewportHeight = this.renderer.domElement.clientHeight || window.innerHeight || 1;
    const camera = this.editorViewportCamera();
    const scale =
      camera instanceof OrthographicCamera
        ? clamp(
            ((camera.top - camera.bottom) / Math.max(camera.zoom, 0.01) / viewportHeight) *
              GIZMO_SCREEN_SIZE_PX,
            GIZMO_MIN_SCALE,
            GIZMO_MAX_SCALE,
          )
        : calculateGizmoScreenScale(
            camera.fov,
            camera.position.distanceTo(this.gizmoGroup.position),
            viewportHeight,
          );
    this.gizmoGroup.scale.setScalar(scale);
  }

  private getMutableTransform(
    selection: Selection,
  ):
    | LayoutPlacement
    | LayoutCharacter
    | LayoutLightActor
    | LayoutActorInstance
    | LayoutReflectionPlane
    | LayoutReflectiveSurface
    | LayoutSphereReflectionCapture
    | LayoutBlockingVolume
    | LayoutAiNavigationVolume
    | LayoutTargetPoint
    | LayoutSplineActor
    | LayoutLandscape
    | null {
    if (!this.layout) return null;
    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      return instance?.placements[selection.placementIndex] ?? null;
    }
    if (selection.kind === "light") return this.layout.lights?.[selection.index] ?? null;
    if (selection.kind === "actor") return this.layout.actors?.[selection.index] ?? null;
    if (selection.kind === "reflectionPlane") {
      return this.layout.reflectionPlanes?.[selection.index] ?? null;
    }
    if (selection.kind === "reflectiveSurface") {
      return this.layout.reflectiveSurfaces?.[selection.index] ?? null;
    }
    if (selection.kind === "reflectionCapture") {
      return this.layout.reflectionCaptures?.[selection.index] ?? null;
    }
    if (selection.kind === "blockingVolume") {
      return this.layout.blockingVolumes?.[selection.index] ?? null;
    }
    if (selection.kind === "aiNavigationVolume") {
      return this.layout.aiNavigationVolumes?.[selection.index] ?? null;
    }
    if (selection.kind === "targetPoint") {
      return this.layout.targetPoints?.[selection.index] ?? null;
    }
    if (selection.kind === "spline") return this.layout.splines?.[selection.index] ?? null;
    if (selection.kind === "landscape") {
      return this.layout.landscapes?.[selection.index] ?? null;
    }
    // Environment singletons are transform-less (no gizmo / move target). World
    // widgets are placed via the Details panel + marker, not the gizmo (v1).
    if (
      selection.kind === "sky" ||
      selection.kind === "fog" ||
      selection.kind === "cloud" ||
      selection.kind === "post" ||
      selection.kind === "worldWidget"
    ) {
      return null;
    }
    return this.layout.characters[selection.index] ?? null;
  }

  private captureTransform(selection: Selection): EditableTransform | null {
    const transform = this.getMutableTransform(selection);
    if (!transform) return null;
    return {
      position: [...transform.position],
      rotation: readRotation(transform),
      scale:
        selection.kind === "light" ||
        selection.kind === "reflectionCapture" ||
        selection.kind === "landscape"
          ? [1, 1, 1]
          : readScale(
              transform as
                | LayoutPlacement
                | LayoutCharacter
                | LayoutActorInstance
                | LayoutBlockingVolume
                | LayoutAiNavigationVolume
                | LayoutTargetPoint,
            ),
    };
  }

  private applyTransform(selection: Selection, values: EditableTransform): void {
    if (!this.layout || !this.hasSelection(selection)) return;
    const transform = this.getMutableTransform(selection);
    if (!transform) return;
    transform.position = [...values.position];
    writeRotation(transform, values.rotation);
    // A Sphere Reflection Capture has no meaningful scale (its size is the
    // `radius`); a Landscape has no scale either (terrain size is the sidecar's
    // `size`) — never write a phantom `scale` field onto either.
    if (selection.kind !== "reflectionCapture" && selection.kind !== "landscape") {
      writeScale(transform, values.scale);
    }
    this.refreshSelectionObject(selection);
    this.updateSelectionBox();
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private commitTransformChange(
    selection: Selection,
    before: EditableTransform,
    label = "Transform",
  ): void {
    const after = this.captureTransform(selection);
    if (!after || transformsEqual(before, after)) return;
    const commandSelection = { ...selection } as Selection;
    this.executeCommand({
      label,
      redo: () => {
        this.selectMany([commandSelection], commandSelection);
        this.applyTransform(commandSelection, after);
      },
      undo: () => {
        this.selectMany([commandSelection], commandSelection);
        this.applyTransform(commandSelection, before);
      },
    });
  }

  private commitLinkedMoveChange(
    drag: {
      selection: Selection;
      startTransform: EditableTransform;
      linkedTransforms?: LinkedMoveStart[] | undefined;
    },
    verb = "Move",
  ): void {
    const entries = [
      {
        selection: cloneSelection(drag.selection),
        before: drag.startTransform,
        after: this.captureTransform(drag.selection),
      },
      ...(drag.linkedTransforms ?? []).map((linked) => ({
        selection: cloneSelection(linked.selection),
        before: linked.startTransform,
        after: this.captureTransform(linked.selection),
      })),
    ];

    const changes: Array<{
      selection: Selection;
      before: EditableTransform;
      after: EditableTransform;
    }> = [];
    for (const entry of entries) {
      if (!entry.after || transformsEqual(entry.before, entry.after)) continue;
      changes.push({
        selection: entry.selection,
        before: entry.before,
        after: entry.after,
      });
    }

    if (changes.length === 0) return;
    const selections = changes.map((entry) => cloneSelection(entry.selection));
    const active = cloneSelection(drag.selection);

    this.executeCommand({
      label: `${verb} ${changes.length} objects`,
      redo: () => {
        this.selectMany(selections, active);
        for (const change of changes) this.applyTransform(change.selection, change.after);
      },
      undo: () => {
        this.selectMany(selections, active);
        for (const change of changes) this.applyTransform(change.selection, change.before);
      },
    });
  }

  private executeCommand(command: EditorCommand): void {
    this.editorSceneController.executeCommand(command);
  }

  private emitSelectionChanged(): void {
    this.applyMeshPaintColorView();
    this.onSelectionChanged?.(this.getSelected());
    this.emitSceneObjectsChanged();
  }

  private emitSceneObjectsChanged(): void {
    this.onSceneObjectsChanged?.(this.getSceneObjects());
    // Any structural change (add/delete/edit of a collider, placement or nav
    // volume) can alter the baked walkable area, so refresh the AI Navigation
    // overlay from the live layout. Without this, deleting an obstacle left its
    // eroded footprint and stale walkable cells frozen in the view. Cheap when the
    // overlay is off (updateAiNavigationView early-returns on !showAiNavigation).
    this.updateAiNavigationView();
  }

  private emitHistoryChanged(): void {
    this.onHistoryChanged?.(this.getHistoryState());
  }

  private emitWorldSettingsChanged(): void {
    this.onWorldSettingsChanged?.(this.getWorldSettings());
  }

  private staticObjectsCastShadow(): boolean {
    return resolveSceneWorldSettings(this.layout).staticObjectsCastShadow;
  }

  private staticObjectsReceiveShadow(): boolean {
    return resolveSceneWorldSettings(this.layout).staticObjectsReceiveShadow;
  }

  private backgroundColor(): string {
    return resolveSceneWorldSettings(this.layout).backgroundColor;
  }

  private ambientColor(): string {
    return resolveSceneWorldSettings(this.layout).ambientColor;
  }

  private ambientIntensity(): number {
    return resolveSceneWorldSettings(this.layout).ambientIntensity;
  }

  private killZ(): number {
    return resolveSceneWorldSettings(this.layout).killZ;
  }

  private gameMode(): string {
    return normalizeGameModeId(this.layout?.worldSettings?.gameMode);
  }

  private hasSelection(selection: Selection): boolean {
    if (!this.layout) return false;
    if (selection.kind === "instance") {
      const instance = this.layout.instances.find((entry) => entry.assetId === selection.assetId);
      return Boolean(instance?.placements[selection.placementIndex]);
    }
    if (selection.kind === "light") return Boolean(this.layout.lights?.[selection.index]);
    if (selection.kind === "actor") return Boolean(this.layout.actors?.[selection.index]);
    if (selection.kind === "sky") return Boolean(this.layout.skyAtmosphere);
    if (selection.kind === "fog") return Boolean(this.layout.heightFog);
    if (selection.kind === "cloud") return Boolean(this.layout.cloudLayer);
    if (selection.kind === "post") return Boolean(this.layout.postProcess);
    if (selection.kind === "reflectionPlane") {
      return Boolean(this.layout.reflectionPlanes?.[selection.index]);
    }
    if (selection.kind === "reflectiveSurface") {
      return Boolean(this.layout.reflectiveSurfaces?.[selection.index]);
    }
    if (selection.kind === "reflectionCapture") {
      return Boolean(this.layout.reflectionCaptures?.[selection.index]);
    }
    if (selection.kind === "blockingVolume") {
      return Boolean(this.layout.blockingVolumes?.[selection.index]);
    }
    if (selection.kind === "aiNavigationVolume") {
      return Boolean(this.layout.aiNavigationVolumes?.[selection.index]);
    }
    if (selection.kind === "targetPoint") {
      return Boolean(this.layout.targetPoints?.[selection.index]);
    }
    if (selection.kind === "spline") return Boolean(this.layout.splines?.[selection.index]);
    if (selection.kind === "landscape") {
      return Boolean(this.layout.landscapes?.[selection.index]);
    }
    if (selection.kind === "worldWidget") {
      return Boolean(this.layout.worldWidgets?.[selection.index]);
    }
    return Boolean(this.layout.characters[selection.index]);
  }

  /**
   * The real drawing area: the canvas panel's own box, not the window. In the
   * editor the canvas is a sub-region between the outliner/details panels, so
   * sizing the renderer to `window.inner*` would over-render and skew the aspect.
   * Falls back to the window before the canvas has been laid out.
   */
  private viewportSize(): { width: number; height: number } {
    const width = this.canvas.clientWidth || window.innerWidth || 1;
    const height = this.canvas.clientHeight || window.innerHeight || 1;
    return { width, height };
  }

  private handleResize = (): void => {
    const { width, height } = this.viewportSize();
    if (width === this.lastViewportWidth && height === this.lastViewportHeight) return;
    this.lastViewportWidth = width;
    this.lastViewportHeight = height;
    const resetView = this.sceneShell.resize({
      width,
      height,
      viewTouched: this.cameraController.hasTouched,
    });
    this.updateOrthoProjection();
    this.postProcessPipeline?.setSize(width, height);
    if (resetView) {
      this.syncOrthoCameraFromPerspective();
      this.cameraController.syncAnglesFromCurrentView();
    }
  };
}

function meshPaintPlacementsFromModel(
  selection: InstanceSelection,
  gltf: GLTF,
): LayoutMeshPaintPlacement[] {
  const primitiveIndexByMeshName = new Map<string, number>();
  const placements: LayoutMeshPaintPlacement[] = [];
  gltf.scene.traverse((child) => {
    if (!isRenderableMesh(child)) return;
    const position = child.geometry.getAttribute("position");
    if (!position) return;
    const meshName = child.name || "__unnamed_mesh";
    const primitiveIndex = primitiveIndexByMeshName.get(meshName) ?? 0;
    primitiveIndexByMeshName.set(meshName, primitiveIndex + 1);
    placements.push({
      target: {
        assetId: selection.assetId,
        placementIndex: selection.placementIndex,
        meshName,
        primitiveIndex,
      },
      vertexCount: position.count,
      colors: initialMeshPaintColors(child.geometry, position.count),
      positions: Array.from(position.array as ArrayLike<number>),
    });
  });
  return placements;
}

function meshPaintTargetFromObject(object: Object3D): LayoutMeshPaintPlacement["target"] | null {
  const value = object.userData.forgeMeshPaintTarget as Partial<LayoutMeshPaintPlacement["target"]> | undefined;
  if (
    !value ||
    typeof value.assetId !== "string" ||
    !Number.isInteger(value.placementIndex) ||
    typeof value.meshName !== "string" ||
    !Number.isInteger(value.primitiveIndex)
  ) {
    return null;
  }
  return {
    assetId: value.assetId,
    placementIndex: value.placementIndex!,
    meshName: value.meshName,
    primitiveIndex: value.primitiveIndex!,
  };
}

/** Converts imported RGB/RGBA attribute data to the sidecar's canonical float RGBA shape. */
function initialMeshPaintColors(geometry: BufferGeometry, vertexCount: number): number[] {
  const colors = new Array<number>(vertexCount * 4).fill(1);
  const source = geometry.getAttribute("color");
  if (!source) return colors;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 4;
    colors[offset] = normalizedAttributeComponent(source.getX(vertex), source) ?? 1;
    colors[offset + 1] = source.itemSize > 1
      ? normalizedAttributeComponent(source.getY(vertex), source) ?? 1
      : colors[offset];
    colors[offset + 2] = source.itemSize > 2
      ? normalizedAttributeComponent(source.getZ(vertex), source) ?? 1
      : colors[offset];
    colors[offset + 3] = source.itemSize > 3
      ? normalizedAttributeComponent(source.getW(vertex), source) ?? 1
      : 1;
  }
  return colors;
}

function normalizedAttributeComponent(
  value: number,
  attribute: ReturnType<BufferGeometry["getAttribute"]>,
): number | null {
  if (!Number.isFinite(value)) return null;
  if (!attribute.normalized) return clampUnit(value);
  const array = attribute.array;
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return clampUnit(value / 255);
  if (array instanceof Uint16Array) return clampUnit(value / 65535);
  if (array instanceof Int8Array) return clampUnit((value + 128) / 255);
  if (array instanceof Int16Array) return clampUnit((value + 32768) / 65535);
  return clampUnit(value);
}

function clampUnit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function isMeshPaintColorView(value: unknown): value is MeshPaintColorView {
  return value === "off" || value === "rgb" || value === "alpha" || value === "r" || value === "g" || value === "b";
}

/** An editor-only material for inspecting the selected placement's color attribute. */
function createMeshPaintColorViewMaterial(view: Exclude<MeshPaintColorView, "off">): MeshBasicMaterial {
  const expression = view === "rgb"
    ? "vColor.rgb"
    : view === "alpha"
      ? "vec3(vColor.a)"
      : view === "r"
        ? "vec3(vColor.r)"
        : view === "g"
          ? "vec3(vColor.g)"
          : "vec3(vColor.b)";
  const material = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\n  diffuseColor.rgb = ${expression};`,
    );
  };
  material.customProgramCacheKey = () => `forge-mesh-paint-color-view:${view}`;
  return material;
}

function splineGeneratedTriangleCount(group: Group | null | undefined, generatorId?: string): number {
  if (!group) return 0;
  let triangles = 0;
  group.traverse((object) => {
    if (object instanceof Group && (generatorId === undefined || object.userData.splineGeneratorId === generatorId)) {
      const count = object.userData.splineTriangleCount;
      if (typeof count === "number" && Number.isFinite(count)) triangles += count;
    }
  });
  return triangles;
}

/** A moved control point changes its incoming/outgoing spans plus one neighbour on each side for curve tangents. */
function splineDirtySegmentsForPoint(actor: LayoutSplineActor, pointId: string): number[] {
  const pointIndex = actor.spline.points.findIndex((point) => point.id === pointId);
  const cache = buildSplineCurveCache(actor.spline);
  if (pointIndex < 0) return cache.segments.map((segment) => segment.index);
  const count = cache.segments.length;
  const result = new Set<number>();
  for (const offset of [-2, -1, 0, 1]) {
    const candidate = pointIndex + offset;
    if (actor.spline.closed) result.add((candidate % count + count) % count);
    else if (candidate >= 0 && candidate < count) result.add(candidate);
  }
  return [...result];
}

/**
 * Paints the world-widget editor billboard glyph: a rounded speech-tag with a
 * downward pointer, evoking a screen-space label pinned in the world.
 */
function drawWorldWidgetGlyph(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);
  const pad = size * 0.14;
  const left = pad;
  const top = pad;
  const right = size - pad;
  const bottom = size * 0.66;
  const radius = size * 0.16;
  const tipX = size * 0.4;

  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.lineTo(right - radius, top);
  ctx.quadraticCurveTo(right, top, right, top + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(tipX + size * 0.12, bottom);
  ctx.lineTo(tipX, bottom + size * 0.18);
  ctx.lineTo(tipX - size * 0.04, bottom);
  ctx.lineTo(left + radius, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - radius);
  ctx.lineTo(left, top + radius);
  ctx.quadraticCurveTo(left, top, left + radius, top);
  ctx.closePath();

  ctx.fillStyle = "rgba(18, 22, 32, 0.92)";
  ctx.fill();
  ctx.lineWidth = size * 0.045;
  ctx.strokeStyle = "#4f8cff";
  ctx.stroke();

  // Two text lines inside the tag.
  ctx.fillStyle = "#dfe7ff";
  const lineH = size * 0.07;
  ctx.fillRect(left + radius, top + size * 0.16, (right - left) * 0.62, lineH);
  ctx.fillRect(left + radius, top + size * 0.31, (right - left) * 0.4, lineH);
}

function isWireframeCapableMaterial(material: Material): material is WireframeCapableMaterial {
  return (
    "wireframe" in material &&
    typeof (material as Partial<WireframeCapableMaterial>).wireframe === "boolean"
  );
}
