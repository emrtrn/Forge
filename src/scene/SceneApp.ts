import { LakeFoamStore } from "./lakeFoamStore";
import { validateWaterCaustics, type WaterCaustics } from "@engine/scene/waterCaustics";
import { validateWaterShoreWetness, type WaterShoreWetness } from "@engine/scene/waterShoreWetness";
import { validateLakeGeometryFoam, type LakeGeometryFoam } from "@engine/scene/lakeFoamBake";
import { lakeFoamSaveSteps } from "@/editor/lakeFoamSaveSteps";
import { bakeLakeGeometryFoam, bakeRiverGeometryFoam, riverFoamSurfaceFingerprint, foamSource, foamFingerprint, wetFoamFingerprint } from "@engine/render-three/lakeFoamBake";
import { defaultLakeGeometryFoam, encodeLakeFoam } from "@engine/scene/lakeFoamBake";
import { validateWaterContactFoam, type WaterContactFoam } from "@engine/scene/waterContactFoam";
import { fetchTerrainActorDocument, type TerrainActorDocument } from "./terrainDocument";
import { LakeWaterController } from "./lakeWaterController";
import { lakeQuality } from "@engine/perf/lakeQuality";
import { WaterReflectionRegistry } from "@engine/render-three/waterReflectionRegistry";
import { createLakeAppearance, validateWaterBody, LAKE_LIMITS } from "@engine/scene/waterBody";
import type { LayoutLakeWaterBody } from "@engine/scene/layout";
import { compareWorldCellKeys, normalizeWorldPartitionSettings, type WorldPartitionSettings } from "@engine/world/worldPartition";
import { parseWorldCellKey } from "@engine/world/worldGrid";
import { worldMapHeightAt, worldMapFocusPosition, type WorldMapHeights, type WorldMapRect } from "@engine/world/worldMapView";
import { SCENE_CAMERA_FAR, setCameraFarOverride } from "@engine/render-three/camera";
import { levelTerrainPath, parseTileKey, terrainTilePath, terrainTileWorldSize, terrainWeightBlockCount, tileKey, type TerrainTileData, type WorldTerrainDef } from "@engine/terrain/terrainTypes";
import { applyTerrainLayerState, createTerrainLayerAddition, createTerrainLayerRemoval } from "@engine/terrain/terrainLayers";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "@engine/terrain/terrainRenderSource";
import { validateTerrainTile, type WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { editorStreamsTerrain, TerrainEditorStreaming, terrainBrushTileKeys, terrainTileKeysInRect } from "@engine/terrain/terrainEditorStreaming";
import { DEFAULT_TERRAIN_SCULPT_SETTINGS, type TerrainSculptSettings, type TerrainSculptTool, type TerrainRamp } from "@engine/terrain/terrainSculpt";
import {
  applyTerrainBrush,
  applyTerrainUndoPatches,
  createTerrainEditWorld,
  createTerrainHeightmapPatches,
  createTerrainLayerFillPatches,
  createTerrainPaintAccumulator,
  revertTerrainUndoPatches,
  type TerrainBrush,
  type TerrainBrushResult,
  type TerrainEditWorld,
  type TerrainPaintAccumulator,
  type TerrainUndoPatch,
} from "@engine/terrain/terrainEdit";
import { decodeTerrainTile, type DecodedTerrainTile, type TerrainHeightFormat } from "@engine/terrain/terrainTileCodec";
import { exportRawHeightmap, heightmapSamplesToRaw, importRawHeightmap, rawHeightmapToSamples } from "@engine/terrain/terrainImport";
import { decodeHeightmapPng, encodeHeightmapPng16 } from "@engine/terrain/heightmapPng";
import { captureWorldTerrainSave } from "@engine/terrain/worldTerrainSave";
import { migrateTerrainSplineCoordinates } from "@engine/terrain/terrainSplineData";
import { prepareTerrainSplineMeshSource } from "@engine/terrain/terrainSplineMeshes";
import { prepareTerrainRiverWaterSource } from "@engine/terrain/terrainRiverWater";
import { createTerrainSplinePatches, terrainSplineTileKeys, type WorldTerrainSpline, type TerrainSplineEffect } from "@engine/terrain/terrainSplines";
import { createTerrainPadPatches, terrainPadTileKeys, type TerrainPad } from "@engine/terrain/terrainPads";
import { terrainHeightAt, raycastTerrain } from "@engine/terrain/terrainHeightQuery";
import { createFlatWorldTerrain, createWorldTerrainFromHeightmap, type WorldTerrainCreateOptions, type WorldTerrainHeightmapSource } from "@engine/terrain/worldTerrainCreate";
import { openWorldFogPatch, openWorldPartitionSettings, type OpenWorldSetup } from "@engine/world/openWorldSetup";
import {
  expandSingleTileWorldTerrain, singleTileExpandProblems,
  type WorldTerrainExpandOptions, type WorldTerrainExpansionSource,
} from "@engine/terrain/worldTerrainExpand";
import {
  isMultiTileTerrain,
  terrainTileHeightfield,
  worldTerrainActorPosition,
  worldTerrainColliderEntities,
  worldTerrainExtent,
  worldTerrainPlacementIssues,
} from "@engine/terrain/worldTerrainActor";
import { isZeroMove, moveWorldTerrain, worldTerrainMoveDelta } from "@engine/terrain/worldTerrainMove";
import { resampleSingleTileTerrain, resizeSingleTileTerrain } from "@engine/terrain/terrainResample";
﻿/**
 * SceneApp - the single render-layer orchestrator (L11 boundary).
 *
 * three.js is imported ONLY under src/scene/. Game rules live in pure-TS
 * modules (M1-M9, src/core/...) and talk to this layer via the event bus.
 * This class owns: renderer, scene graph, camera rig, lights, frame loop.
 */
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
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
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from "three";
import { affordableSunCascades, SunCascadeShadow } from "@engine/render-three/sunCascadeShadow";
import { setTerrainFarTiling, setTerrainSelfShadow } from "@engine/render-three/terrain/terrainRenderer";
import { sunCascadeDistance } from "@engine/world/sunCascades";
import {
  applyQualityToPostProcess,
  QUALITY_PROFILES,
  resolveQualitySettings,
  type QualityLevel,
  type QualitySettings,
} from "@engine/perf/qualityProfiles";
import { createLocalStorageAdapter } from "@engine/persistence/saveGameStore";
import { UserSettingsStore } from "@engine/persistence/userSettingsStore";
import type {
  AmbientLight,
  Camera,
  InstancedMesh,
  Light,
  LightShadow,
  Material,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  buildSceneCostSnapshot,
  tagSceneSource,
  type DrawingBufferSnapshot,
  type SceneCostObject,
  type SceneCostSnapshot,
} from "./runtimeDebugSnapshot";
// Shared with the runtime shell, so both viewports measure the same way.
import { GpuSweepSession } from "./gpuSweepSession";
import type { GpuSweepOutcome } from "@engine/perf/gpuSweepRunner";
import type { GpuFrameStats } from "@engine/perf/gpuTimer";

/**
 * The bucket every authoring-only visual is tagged with: gizmo, selection
 * outline proxies, brush cursors, spline and collision helpers.
 *
 * One bucket rather than one per widget, because the question a reader has in
 * the editor is "how much of this frame is the editor itself?" — and because
 * these are the rows a runtime frame does not have at all, so lumping them in
 * with content would make an editor frame incomparable with a shipped one.
 */
const EDITOR_OVERLAY_SOURCE = "editor-overlay";

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
import { createPhysicalMaterialSurfaceProvider } from "@engine/physics/surface/surfaceResponse";
import { AudioSubsystem } from "@engine/audio/audioSubsystem";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { createBehaviorRegistry } from "@/game/behaviors";
import { createGameAiTaskRegistry } from "@/game/ai/tasks";
import { DEFAULT_GAME_MODE_ID, normalizeGameModeId } from "@/game/gameModes/catalog";
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
  collisionWireEntries,
  collisionWireboxes,
  heightfieldWireGeometry,
  type CollisionWireEntry,
} from "@engine/render-three/collisionView";
import {
  createAiNavigationView,
  disposeAiNavigationView,
  type AiNavAgentClearanceView,
  type AiPerceptionView,
  type AiQueryCandidateView,
  type AiTargetPointRouteView,
} from "@engine/render-three/aiNavigationView";
import {
  advanceForgeMaterialAnimations,
  collectMaterialStats,
  convertUnlitModelMaterialsToLit,
  isRenderableMesh,
} from "@engine/render-three/materials";
import { type NavAabb, type NavAgent, type NavBlocker } from "@engine/navigation/navigationTypes";
import { convexHullXZ } from "@engine/physics/rotatedBox";
import {
  attachActorLight,
  entityLightItem,
  disposeLightGizmo,
  syncLightObject,
  type LightObjectRecord,
} from "@engine/render-three/lights";
import { resolveSkyAtmosphere } from "@engine/render-three/skyAtmosphere";
import { resolveHeightFog } from "@engine/render-three/heightFog";
import { resolveCloudLayer } from "@engine/render-three/cloudLayer";
import {
  applyPostProcessToneMapping,
  createPostProcessAntialiasPass,
  createPostProcessEffectPasses,
  PostProcessPipeline,
  resolvePostProcess,
  type ResolvedPostProcess,
} from "@engine/render-three/postProcess";
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
  landscapeLitFragmentSamplers,
  applyLandscapeTransform,
  createWorldTerrainObject,
  disposeLandscapeObject,
  LANDSCAPE_DEFAULT_LAYERS,
  resampleLandscapeHeightmap,
  landscapeSizeForPreset,
  landscapeSplineMeshAssetIds,
  splineToPolyline,
  resolveLandscape,
  uniqueLandscapeId,
  uniqueLandscapeName,
  updateLandscapeLod,
  updateWorldTerrainAppearance,
  refreshWorldTerrainObjectTile,
  updateWorldTerrainObjectTiles,
  type ForgeLandscapeSpline,
  type LandscapeLayerColors,
  type LandscapeLayerTexture,
  type LandscapeObject,
  type LandscapeViewMode,
  type WorldTerrainRenderItem,
} from "@engine/render-three/landscape";
import {
  createRiverWaterObject,
  disposeRiverWaterObject,
  resolveRiverWater,
  type RiverWaterObjectLike,
  type RiverWaterRenderItem,
} from "@engine/render-three/riverWater";
import { uniqueRiverWaterId } from "@engine/scene/riverWater";
import { PlanarReflectionSource } from "@engine/render-three/planarReflectionSource";
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
  normalizeFoliageType,
  resolveFoliageTarget,
  uniqueLandscapeFoliageRuleId,
  uniqueFoliageGroupId,
  type FoliageResourceUsage,
  type ForgeFoliageTypeDef,
  type LandscapeFoliageRule,
  type LayoutFoliageData,
  type LayoutFoliageGroup,
} from "@engine/scene/foliage";
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
import { loadFoliageDocument, loadFoliageTypeByPath, loadFoliageTypesForData } from "./foliageLoader";
import { ProceduralFoliageRing, type ProceduralFoliageRuleSource, type ProceduralFoliageTerrain } from "./proceduralFoliageRing";
import { createFoliageCellGenerator, type FoliageCellGenerator } from "./foliageCellGenerator";
import {
  createEmptyMeshPaintData,
  fillMeshVertexColors,
  paintMeshVertexColors,
  repairMeshPaintTopology,
  removeMeshPaintPlacement,
  upsertMeshPaintPlacement,
  type MeshPaintChannel,
  type LayoutMeshPaintData,
  type LayoutMeshPaintPlacement,
} from "@engine/scene/meshPaint";
import { EditorSaveSession, type EditorSaveSource } from "@/editor/editorSaveCoordinator";
import { WorldTerrainEditSession } from "@/editor/terrainStore";
import { WorldBuilderSession } from "@/editor/worldBuilderSession";
import type { PreviewItem, StagePreview } from "@/editor/worldBuilderPreview";
import { WorldBuilderPreviewOverlay } from "./worldBuilderPreviewOverlay";
import { HANDLE_LIFT, WorldBuilderRecipeOverlay } from "./worldBuilderRecipeOverlay";
import type { PlanPointRef } from "@/editor/worldBuilderPlanEdit";
import {
  applyPlacementGroupChanges,
  type PlacementGroupChange,
  type StageTerrain,
  type TerrainSplineChange,
} from "@engine/worldbuilder/stage";
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
import {
  applySceneBackgroundAndAmbient,
  buildLandscapeSplineMeshGroup,
  disposeLandscapeSplineMeshGroup,
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
  invalidateMaterialsForShadowToggle,
  isSceneSunLight,
  beginSceneRuntimeFrameStats,
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
import { AuthoredEnvironment } from "@engine/render-three/authoredEnvironment";
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
  LayoutRiverWater,
  LayoutRiverWaterFoamStamp,
  LayoutRiverWaterSegmentProfile,
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
  PHYSICAL_MATERIAL_IDS,
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
import type { AiPatrolRoute, ColliderHeightfield, TransformComponent } from "@engine/scene/components";
import { VEHICLE_COMPONENT } from "@engine/scene/components";
import type { SceneJsonValue } from "@engine/scene/entity";
import type { VehicleOverrides } from "@engine/physics/vehicle/vehicleTypes";
import type { Entity } from "@engine/scene/entity";
import { EditorRecastPreview, type EditorRecastPreviewInput } from "./editorRecastPreview";
import { createCharacterSceneObject, entityCharacterItem, tintedMaterial } from "@engine/render-three/models";
import { actorInstanceToEntity, resolveActorInstanceVariables } from "@engine/scene/actorInstance";
import { normalizeActorScriptDef, type ActorScriptDef } from "@engine/scene/actorScript";
import type { MetadataFieldDef, MetadataSchema } from "@engine/scene/metadataSchema";

/**
 * One class-declared actor variable as the Details panel needs it: the field
 * definition to draw, the value this placement resolves to, and whether that
 * came from an instance override (so the panel can offer a reset).
 */
export interface ActorVariableView {
  readonly field: MetadataFieldDef;
  readonly value: MetadataValue | undefined;
  readonly overridden: boolean;
}
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
  worldPartitionCellsInRange,
  worldPartitionObjectCells,
  type OutlinerPartitionView,
} from "@editor/core/worldPartitionOutliner";
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
import { EditorCameraPoseStore } from "@editor/input/editorCameraPose";
import { KeptTerrainTilesStore } from "@editor/scene/keptTerrainTiles";
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

export type LandscapeSculptTool = TerrainSculptTool;
export type LandscapeEditMode = "sculpt" | "paint" | "splines" | "water";
export type LandscapePaintTool = "paint" | "erase" | "smoothWeights";
/**
 * Splines sub-mode (Faz 6.1). "draw" authors the spline (click terrain to add a
 * connected point; click an existing marker to weld / close / branch), while
 * "edit" selects a control point so the move gizmo can drag it. Splitting the
 * two intents keeps a marker click from being ambiguous.
 */
export type LandscapeSplineTool = "draw" | "edit";
type RiverWaterFoamStampAnchor = "start" | "end";

export interface LandscapeSculptSettings extends TerrainSculptSettings {
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
  /** Flatten to the initial terrain hit of each drag instead of the numeric target. */
  flattenUseClickedHeight: boolean;
  /** Retains the selected water body while Details re-renders. */
  activeRiverWaterId: string | null;
  /** Radial Foam placement mode; the next water/terrain click creates this point. */
  riverWaterRingFoamPlacementId: string | null;
  /** The authored Radial Foam point currently targeted by the shared move gizmo. */
  activeRiverWaterFoamStampId: string | null;
  /** Radial Foam uses its centre/start anchor. */
  activeRiverWaterFoamStampAnchor: RiverWaterFoamStampAnchor | null;
  activeSplineId: string | null;
  activeSplinePointId: string | null;
  activeSplineSegmentId: string | null;
}

export interface LandscapeSplineView {
  id: string;
  name: string;
  pointCount: number;
  segmentCount: number;
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

/** A terrain tile in the World Partition panel: residency in the editor and unsaved edits. */
export interface WorldPartitionTileView {
  key: string;
  x: number;
  z: number;
  state: "resident" | "loading" | "unloaded";
  unsaved: boolean;
  /** Kept loaded from the panel, wherever the camera is. */
  kept: boolean;
}

/** What the World Partition panel draws (OPEN_WORLD_PLAN Faz 8). */
export interface WorldPartitionView {
  terrain: {
    name: string;
    /** World X/Z the terrain covers (a rotated 1x1 Landscape: its unrotated footprint). */
    rect: WorldMapRect;
    tileSize: number;
    tilesX: number;
    tilesZ: number;
    /** Tiles load around the editor camera (more than 6x6 tiles). */
    streams: boolean;
    /** Editor load radius around the camera while streaming, in metres. */
    loadRange: number | null;
    /** Editor memory of one resident tile (Float32 heights + RGBA8 weights), in bytes. */
    tileBytes: number;
    tiles: WorldPartitionTileView[];
    /** Heights over `rect` for the minimap; null for a rotated 1x1 Landscape. */
    map: WorldMapHeights | null;
    metresPerSample: number;
    /** Changes whenever the heights may have: redraw the minimap. */
    mapRevision: string;
  } | null;
  partition: WorldPartitionSettings;
  /** Occupied `main` cells with their element count (empty while partition is off). */
  cells: { key: string; x: number; z: number; count: number }[];
  camera: { x: number; z: number; forwardX: number; forwardZ: number };
}

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
  /** The type casts shadows (procedural grass shadows cost ~2.5× its draw). */
  typeCastsShadow: boolean;
  /** The type's cull distance; 0 grows the rule over the whole surface. */
  typeCullEnd: number;
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
  mesh: { enabled: boolean; assetId: string; spacing: number; yawOffset: number; fitToLength: boolean; alignToTerrain: boolean; bank: number; deform: boolean; collision: boolean };
}

/** Editable water-body presentation exposed from the selected Landscape Details panel. */
export interface RiverWaterDetailsView {
  contactOrigin?: Vec3;
  coordinateSpace?: "world";
  id: string;
  name: string;
  splineRef: string;
  surfaceLevel: number;
  widthScale: number;
  flowSpeed: number;
  normalScale: number;
  normalTexture: string;
  deepColor: string;
  shallowColor: string;
  opacity: number;
  bedVisibility: number;
  absorptionDistance: number;
  waveAmplitude: number;
  waveLength: number;
  foamColor: string;
  foamOpacity: number;
  shoreWaveSpacing: number;
  shoreWaveSpeed: number;
  shoreWaveReach: number;
  shoreWaveBreakupScale: number;
  reflectionMode: "off" | "environment";
  reflectionGroup: string;
  reflectionQuality: "low" | "medium" | "high";
  reflectionStrength: number;
  contactFoam?: WaterContactFoam;
  geometryFoam?: LakeGeometryFoam;
  caustics?: WaterCaustics;
  shoreWetness?: WaterShoreWetness;
  foamStamps: LayoutRiverWaterFoamStamp[];
  segmentProfiles: LayoutRiverWaterSegmentProfile[];
  splineSegments: Array<{ id: string; startPointId: string; endPointId: string }>;
}

export type RiverWaterDetailsPatch = Partial<Pick<
  LayoutRiverWater,
  | "surfaceLevel"
  | "widthScale"
  | "flowSpeed"
  | "normalScale"
  | "deepColor"
  | "shallowColor"
  | "opacity"
  | "bedVisibility"
  | "absorptionDistance"
  | "waveAmplitude"
  | "waveLength"
  | "foamColor"
  | "foamOpacity"
  | "shoreWaveSpacing"
  | "shoreWaveSpeed"
  | "shoreWaveReach"
  | "shoreWaveBreakupScale"
  | "reflectionMode"
  | "reflectionGroup"
  | "reflectionQuality"
  | "reflectionStrength"
  | "geometryFoam"
  | "caustics"
  | "shoreWetness"
  | "contactFoam"
  | "foamStamps"
  | "segmentProfiles"
>>;

/** The spline control point the move gizmo targets (Faz 6.1), with its world anchor. */
interface LandscapeSplinePointGizmoTarget {
  index: number;
  landscapeId: string;
  object: LandscapeObject;
  splineId: string;
  pointId: string;
  world: Vector3;
}

/** A selected, Landscape-local Radial Foam point exposed through the shared move gizmo. */
interface RiverWaterFoamStampGizmoTarget {
  index: number;
  landscapeId: string;
  waterId: string;
  stampId: string;
  anchor: RiverWaterFoamStampAnchor;
  object: LandscapeObject;
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
  mesh?: Partial<{ enabled: boolean; assetId: string; spacing: number; yawOffset: number; fitToLength: boolean; alignToTerrain: boolean; bank: number; deform: boolean; collision: boolean }>;
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
  /** Built-in physical material id for vehicle surface response, or `null` (neutral). */
  physicalMaterial: string | null;
}

/** A landscape that references a multi-tile World Terrain, as the Details panel shows it. */
export type HeightmapFileFormat = "raw" | "png";

/** Exact 16-bit heightmap grid of the selected Landscape (`getSelectedLandscapeHeightmapShape`). */
export interface LandscapeHeightmapShape {
  width: number;
  height: number;
  /** Default metres (relative to terrain origin Y) for codes 0 and 65535. */
  heightMin: number;
  heightMax: number;
  multiTile: boolean;
  /** Why a 1×1 grid cannot use 16-bit heightmaps (`landscapeEditIssues`); empty when it can. */
  issues: string[];
}

export interface WorldTerrainDetailsView {
  dataRef: string;
  tileQuads: number;
  heightMin: number;
  heightMax: number;
  tilesX: number;
  tilesZ: number;
  /** Tiles present on disk; the rest of the grid is holes. */
  tileCount: number;
  /** World edge length of one tile. */
  tileSize: number;
  spacing: number;
  /** World X/Z size of the whole tile grid. */
  extent: [number, number];
}

export interface WorldTerrainResidencyView {
  streaming: boolean;
  resident: number;
  loading: number;
  unsaved: number;
  total: number;
}

/** One sculpt/paint drag on a Landscape; undo keeps only the touched tile rectangles. */
interface TerrainStroke {
  pointerId: number;
  landscapeIndex: number;
  landscapeId: string;
  document: WorldTerrainDocument;
  /** The tiles the dabs edit: the World Terrain session's. */
  world: TerrainEditWorld;
  mode: "sculpt" | "paint";
  flattenSampleHeight: number;
  /** Ramp previews during the drag and applies on release. */
  tool: LandscapeSculptTool;
  /** Ramp ends in the stroke's edit frame (see `terrainStrokePoint`). */
  rampStart: Vector3 | null;
  rampEnd: Vector3 | null;
  /** A skipped dab owns its settings while streaming loads the required tiles. */
  pendingBrush: TerrainBrush | null;
  /** Dab patches in application order. */
  patches: TerrainUndoPatch[];
  /** Tiles this stroke asked a streaming terrain to load; held until it ends. */
  demanded: Set<string>;
  /** Unquantized paint weights, so low-strength dabs add up across the stroke. */
  paint: TerrainPaintAccumulator;
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

function cloneRiverWater(water: LayoutRiverWater): LayoutRiverWater {
  return {
    ...water,
    ...(water.contactFoam ? { contactFoam: structuredClone(water.contactFoam) } : {}),
    ...(water.geometryFoam ? { geometryFoam: structuredClone(water.geometryFoam) } : {}),
    ...(water.caustics ? { caustics: structuredClone(water.caustics) } : {}),
    ...(water.shoreWetness ? { shoreWetness: structuredClone(water.shoreWetness) } : {}),
    ...(water.foamStamps
      ? {
          foamStamps: water.foamStamps.map((stamp) => ({
            ...stamp,
            position: [...stamp.position] as Vec3,
            ...(stamp.endPosition ? { endPosition: [...stamp.endPosition] as Vec3 } : {}),
          })),
        }
      : {}),
    ...(water.segmentProfiles
      ? { segmentProfiles: water.segmentProfiles.map((profile) => ({ ...profile })) }
      : {}),
  };
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

/** Selections whose edits never change terrain heights (see `updateSelectionBox`). */
const TERRAIN_NEUTRAL_SELECTION_KINDS: ReadonlySet<Selection["kind"]> = new Set(["instance", "character", "actor", "light"]);

const AI_NAV_DEBUG_DEFAULT_AGENT_RADIUS = AI_NAVIGATION_VOLUME_DEFAULT_AGENT_RADIUS;
const AI_NAV_DEBUG_DEFAULT_CLEARANCE_PADDING = AI_NAVIGATION_VOLUME_DEFAULT_CLEARANCE_PADDING;
/** Standing height + step height of the default agent the nav mesh preview builds for. */
const AI_NAV_DEBUG_AGENT_HEIGHT = 1.8;
const AI_NAV_DEBUG_AGENT_STEP_HEIGHT = 0.45;
const AI_NAV_DEBUG_AGENT_STEP_DOWN = 0.5;
const AI_NAV_DEBUG_AGENT_MAX_SLOPE_DEG = 50;
/** Nav mesh preview without volumes: tiles within this distance of the camera. */
const AI_NAV_PREVIEW_CAMERA_RADIUS = 48;
/** The camera point snaps to this grid (the Recast tile size) before it keys a rebuild. */
const AI_NAV_PREVIEW_SNAP = 32;
/** Largest radius one AI Navigation Volume asks the preview to build. */
const AI_NAV_PREVIEW_MAX_RADIUS = 128;

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
  scenePath?: string;
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
  warnings?: readonly string[];
  /**
   * Fields the save validator did not copy through (plan I5). Empty/absent on a
   * clean save; anything listed here was silently lost before this report
   * existed, and is reported to the user instead of vanishing.
   */
  dropped?: readonly string[];
  /** Present when the level saved as World Partition cells; element counts span the cell arrays. */
  partition?: { cells: number; written: number; streamed: number; persistent: number };
}

export type LayoutSaver =(payload: LayoutSavePayload) => Promise<LayoutSaveResult>;

/** How close to a World Builder Edit Plan handle a press must land, screen pixels. */
const WORLD_BUILDER_HANDLE_REACH = 12;
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
  /** The sun's Cascaded Shadows preview in the perspective viewport; created on first use. */
  private sunCascades: SunCascadeShadow | null = null;
  /** The game's graphics preference, shared with Play (same-origin localStorage). */
  private readonly userSettingsStore = createEditorUserSettingsStore();
  /** What the viewport renders with: the chosen profile, or Ultra while Play picks it automatically. */
  private editorQuality: QualitySettings = QUALITY_PROFILES.ultra;
  private ambientLight: AmbientLight | null = null;
  /**
   * The authored environment singletons (sky dome, Sky Light capture, fog,
   * clouds). Shared with the runtime shell rather than reimplemented here — see
   * the header of `engine/render-three/authoredEnvironment.ts`.
   */
  private readonly environment: AuthoredEnvironment;
  /** Live `Reflector` meshes for placed Planar Reflection actors, by index. */
  private reflectionPlaneObjects: ReflectionPlaneObject[] = [];
  /** Billboard icons (clickable handles) for placed Mirror Plane actors, by index. */
  private reflectionPlaneIcons: Sprite[] = [];
  /** Live textured reflective-surface meshes for placed Reflective Surface actors, by index. */
  private reflectiveSurfaceObjects: ReflectiveSurfaceObject[] = [];
  /** Editor brush objects (translucent + wireframe) for placed Blocking Volume actors, by index. */
  private blockingVolumeObjects: BlockingVolumeObject[] = [];
  /** Editor box volumes limiting AI navigation, by index. */
  private aiNavigationVolumeObjects: AiNavigationVolumeObject[] = [];
  /** InstancedMesh foliage batches painted onto the level (Foliage Mode). */
  private foliageBinding: FoliageRenderBinding | null = null;
  /** In-memory level foliage sidecar (`<layout>.foliage.json`). */
  private foliageData: LayoutFoliageData = createEmptyFoliageData();
  /** Placement-scoped vertex-color sidecar for Mesh Paint Mode. */
  private meshPaintData: LayoutMeshPaintData = createEmptyMeshPaintData();
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
  /** Terrain ids whose generated foliage batches are waiting for a debounced rebuild. */
  private readonly dirtyGeneratedFoliageLandscapes = new Set<string>();
  /** Landscape foliage rules grown around the editor camera (OPEN_WORLD_PLAN Faz 6 F3). */
  private foliageRing: ProceduralFoliageRing | null = null;
  private foliageCellGenerator: FoliageCellGenerator | null = null;
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
  /** Visible spline-water ribbons, index-aligned with `layout.riverWaters`. */
  private riverWaterObjects: RiverWaterObjectLike[] = [];
  private riverWaterBuild = 0;
  private lakes: LakeWaterController | null = null;
  private readonly waterReflections = new WaterReflectionRegistry();
  private lakeDraft: LayoutLakeWaterBody | null = null;
  private lakePendingSelection: (() => void) | null = null;
  private lakePick: { terrainRef: string; reseed: string | null } | null = null;
  private lakeSeedAbort = new AbortController();
  private lakeDrag: { before: LayoutLakeWaterBody; edge: number; pointerId: number; draft: boolean } | null = null;
  private lakeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Shared planar reflection sources, one per River Water Body plane/group. */
  private riverReflectionSources: PlanarReflectionSource[] = [];
  /** Loaded normal maps owned by the editor water preview. */
  private readonly riverWaterTextures = new Map<string, Texture>();
  /** Instanced spline-mesh groups (Faz 6 Road Tool) parented under each landscape, by index. */
  private landscapeSplineMeshGroups: (Group | null)[] = [];
  private readonly landscapeSplineMeshBuilds = new WeakMap<Group, number>();
  /** Editor-only spline control-point/segment overlay, parented under each landscape, by index. */
  private landscapeSplineOverlays: (Group | null)[] = [];
  /**
   * World Terrains by landscape id (OPEN_WORLD_PLAN Faz 2): every Landscape
   * actor is drawn from and sculpted on its tiles, and Save writes edited tiles
   * in place at their reference.
   */
  private worldTerrains = new Map<string, WorldTerrainDocument>();
  /**
   * Edit state per World Terrain document. Keyed by the document object, so a
   * delete + undo (which restores the same document) keeps unsaved tile edits
   * and their save state, while a reload starts clean.
   */
  private worldTerrainSessions = new WeakMap<WorldTerrainDocument, WorldTerrainEditSession>();
  /**
   * Tile residency of World Terrains too large to hold whole (Faz 8). Keyed
   * like the sessions, so delete + undo keeps streaming; disposed when the
   * level's landscapes are rebuilt.
   */
  private worldTerrainStreams = new Map<WorldTerrainDocument, TerrainEditorStreaming>();
  private worldTerrainSplineBusy = false;
  /** Last height scale used for a heightmap import, echoed back into the Details input. */
  private lastLandscapeImportHeight = 20;
  private readonly editorSaves = new EditorSaveSession(
    () => this.editorSaveSource(),
    (message, tone) => this.onStatus?.(message, tone),
  );
  /** World Builder recipe and stage runner of the open level (World Builder plan v0.4 §6). */
  readonly worldBuilder = new WorldBuilderSession({
    scenePath: () => this.activeProject?.manifest.editor.defaultScene ?? "",
    layout: () => this.layout,
    sampleHeight: (x, z) => this.worldTerrainHeightAt(x, z),
    executeCommand: (command) => this.executeCommand(command),
    applyGroupChanges: (changes, side) => this.applyWorldBuilderGroupChanges(changes, side),
    terrains: () => this.worldBuilderTerrains(),
    applySplineChanges: (changes, side) => this.applyWorldBuilderSplineChanges(changes, side),
    applyPads: (pads) => this.applyWorldBuilderPads(pads),
    viewTarget: () => this.worldBuilderViewTarget(),
    showRecipeLayer: (recipe, options, selection) => this.worldBuilderRecipeLayer.show(recipe, options, selection),
    showPreview: (preview) => this.worldBuilderPreview.show(preview),
    focusPreview: (preview, item) => this.focusWorldBuilderPreview(preview, item),
    onStatus: (message, tone) => this.onStatus?.(message, tone),
  });
  /** The Edit Plan handle being dragged; `point` stays null until the pointer has moved. */
  private worldBuilderPlanDrag: { pointerId: number; ref: PlanPointRef; startX: number; startY: number; point: [number, number] | null } | null = null;
  /** Viewport layer of the World Builder recipe: reference underlay, plan and generated data. */
  private readonly worldBuilderRecipeLayer = new WorldBuilderRecipeOverlay(
    (x, z) => this.worldTerrainHeightAt(x, z),
    (path) => projectFileUrl(path),
    (counts) => this.worldBuilder.layerRedrawn(counts),
  );
  /** Viewport layer of the last World Builder dry run (T10). */
  private readonly worldBuilderPreview = new WorldBuilderPreviewOverlay((assetId) => {
    // Shape bounds come from the procedural model, which a level without that shape has not built yet.
    this.ensureShapeModel(assetId);
    return this.localBounds.get(assetId) ?? null;
  });
  /** Resolved albedo (base color + tiling texture) of materials assigned to landscape layers, by material id. */
  private landscapeLayerMaterialCache = new Map<string, ForgeMaterialLayer>();
  private landscapeSculptSettings: LandscapeSculptSettings = {
    ...DEFAULT_TERRAIN_SCULPT_SETTINGS,
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
    flattenUseClickedHeight: false,
    activeRiverWaterId: null,
    riverWaterRingFoamPlacementId: null,
    activeRiverWaterFoamStampId: null,
    activeRiverWaterFoamStampAnchor: null,
    activeSplineId: null,
    activeSplinePointId: null,
    activeSplineSegmentId: null,
  };
  private terrainStroke: TerrainStroke | null = null;
  private terrainStrokePending = false;
  private landscapeRampPreview: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
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
  /** Live Radial Foam point drag; snapshots one water body into one undo command. */
  private riverWaterFoamStampDrag: {
    index: number;
    landscapeId: string;
    waterId: string;
    stampId: string;
    anchor: RiverWaterFoamStampAnchor;
    before: LayoutRiverWater;
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
  /**
   * GPU-side frame timing and the A/B sweep that uses it — the same session the
   * runtime shell runs, so the editor viewport answers the question in the same
   * units the game will.
   *
   * Constructed always (it touches nothing until enabled) and enabled only while
   * the perf panel is up (`setGpuProfilingEnabled`, driven by Show > Stats):
   * timer queries cost a driver round trip per frame, and an authoring session
   * that never opens the overlay should not pay for one.
   */
  private readonly gpuSweepSession: GpuSweepSession;
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
    blockersNear: (x, z, radius) => this.physicsSubsystem.staticBlockerAabbsNear(x, z, radius),
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
  /** Remembers the viewport pose across editor reloads. Editor-only. */
  private readonly cameraPoseStore: EditorCameraPoseStore | null;
  /** Terrain regions kept loaded from the World Partition panel, per terrain (editor only). */
  private readonly keptTerrainTiles: KeptTerrainTilesStore | null;
  /** Grows on every scene structure change: the World Partition cell counts cache on it. */
  private sceneObjectsRevision = 0;
  /** A gizmo drag held back the Outliner refresh; the drag end emits it. */
  private sceneObjectsDeferredByDrag = false;
  private worldPartitionCellCache: {
    key: string;
    objectCells: Map<string, string>;
    cells: WorldPartitionView["cells"];
  } | null = null;
  /** Editor viewport raycasting (selection / gizmo / surface picks). */
  private readonly picker: ScenePicker;

  private manifest: AssetManifest | null = null;
  private assetCategoryIndex: {
    assets: AssetManifest["assets"];
    length: number;
    categories: Map<string, string>;
  } | null = null;
  private metadataSchema: MetadataSchema | null = null;
  private layout: RoomLayout | null = null;
  private readonly riverFoam = new LakeFoamStore();
  private riverFoamAborter = new AbortController();
  private riverFoamJob: { id:string; controller:AbortController; progress:string } | null = null;
  private readonly riverFoamMessages = new Map<string,string>();
  private lakeFoamJob: { id:string; controller:AbortController; progress:string } | null = null;
  private readonly lakeFoamMessages = new Map<string,string>();
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
  /** Instance groups to rebuild once a pending material load resolves (one rebuild per asset). */
  private readonly materialLoadRebuilds = new Map<string, Set<string>>();
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
  /** Placement/character collider lines of the overlay, reused per owner while unchanged. */
  private collisionWireEntryCache = new Map<string, CollisionWireEntry>();
  /** One line buffer per chunk of owners (and colour), rebuilt only when a member changed. */
  private readonly collisionWireChunks = new Map<string, { signature: string; helper: LineSegments }>();
  /** Terrain heightfield wires of the Collision overlay, kept while their heights and placement hold. */
  private readonly landscapeCollisionWires = new Map<string, { signature: string; helper: LineSegments }>();
  private collisionWireMaterials: { solid: LineBasicMaterial; sensor: LineBasicMaterial } | null = null;
  private showCollision = false;
  /** Coalesces streamed tile arrivals/departures into one overlay rebuild per frame. */
  private worldTerrainCollisionWiresDirty = false;
  /** "Show > AI Navigation" overlay: blocking footprints, clearances, routes; off by default. */
  private aiNavigationView: Group | null = null;
  /** Recast polygons of "Show > AI Navigation" (R4); rebuilt after edits go quiet. */
  private readonly recastPreview: EditorRecastPreview;
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
    kind: "asset" | "light" | "reflectiveSurface" | "reflectionCapture";
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
    this.recastPreview = new EditorRecastPreview({ scene: this.scene });
    // No `hold` is passed: this viewport has no time control, and it does not
    // need one — gameplay, physics and AI are already switched off while
    // authoring, and what still moves (a scrolling material, a drifting sky,
    // the camera under the reader's own hand) is exactly what the bracketed
    // baseline exists to catch. It marks a row `uncertain` rather than
    // reporting a saving it cannot stand behind.
    this.gpuSweepSession = new GpuSweepSession({
      renderer: this.renderer,
      scene: this.scene,
      renderStats: () => this.getRenderStats(),
      sceneSeconds: () => this.engineApp.sceneSeconds,
      postProcessActive: () => this.postProcessPipeline !== null,
    });
    this.environment = new AuthoredEnvironment({
      scene: this.scene,
      renderer: this.renderer,
      camera: () => this.camera,
      resolveSunActor: () => this.sunLightActor(),
      // The global env that a probe's boundary blend fades toward just changed,
      // so rebind it onto the probe-covered clones. Guarded because the rebind
      // rebuilds every instanced model and the initial build reaches this
      // before any probe has been baked.
      onEnvironmentChanged: () => {
        if (this.eligibleProbeBakes().length > 0) this.applyReflectionCaptureEnvMaps();
      },
    });
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
        buildRiverWaters: () => this.buildRiverWaters(),
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
          await this.preloadPlacementMaterials();
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
        this.flushDragDeferredSceneObjects();
        this.endAssetDragPreview();
      },
      onStatus: (message, tone) => this.onStatus?.(message, tone),
    });
    this.cameraPoseStore = this.editorEnabled ? new EditorCameraPoseStore() : null;
    this.keptTerrainTiles = this.editorEnabled ? new KeptTerrainTilesStore() : null;
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

    this.applyEditorQuality();

    this.gizmoGroup.name = "editor-transform-gizmo";
    this.gizmoGroup.visible = false;
    this.scene.add(tagSceneSource(this.gizmoGroup, EDITOR_OVERLAY_SOURCE));
    this.scene.add(tagSceneSource(this.worldBuilderPreview.group, EDITOR_OVERLAY_SOURCE));
    this.scene.add(tagSceneSource(this.worldBuilderRecipeLayer.group, EDITOR_OVERLAY_SOURCE));

    // Register subsystems before scene load adds work to them (e.g. character
    // animations push mixers during loadActiveProjectScene) and before the
    // engine init()/start() that load triggers. Input advances before any later
    // behavior subsystem so behaviors read current-tick action state.
    this.engineApp.registerSubsystem(this.animationSubsystem);
    this.engineApp.registerSubsystem(this.inputSubsystem);
    this.engineApp.registerSubsystem(this.physicsSubsystem);
    this.physicsSubsystem.setVehicleSurfaceProvider(createPhysicalMaterialSurfaceProvider(
      (entityId) => this.physicsSubsystem.colliderPhysicalMaterialId(entityId),
    ));
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
    // `pagehide` covers reload, navigation and tab close (and unlike `unload` it
    // fires on mobile/bfcache paths), so the viewport pose survives all of them.
    if (this.editorEnabled) window.addEventListener("pagehide", this.persistCameraPose);
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
      beginSceneRuntimeFrameStats(this.renderer);

      // Engine-core tick: fans out to registered subsystems. The
      // AnimationSubsystem advances character mixers here â€” that work no longer
      // runs inline in this loop. Camera/gizmo work stays inline for now.
      this.engineApp.update(deltaSeconds);

      this.cameraController.update(deltaSeconds);
      this.cameraPoseStore?.maybeSave(this.camera, now);
      this.updateMeshPaintFlow(deltaSeconds);
      this.updateGizmoScreenScale();
      this.environment.update(deltaSeconds);
      const foliageCamera = this.editorViewportCamera().position;
      this.foliageRing?.update([foliageCamera.x, foliageCamera.z], 1, 1, 2);
      this.foliageBinding?.updateCulling(foliageCamera);
      this.updateWorldTerrainStreaming();
      if (this.worldTerrainCollisionWiresDirty) {
        this.worldTerrainCollisionWiresDirty = false;
        this.updateCollisionBoxes();
      }
      // Shadow frusta first: the terrain keeps the nodes its own shadow casts from.
      this.updateSunCascades();
      const shadowLights = !this.renderer.shadowMap.enabled ? []
        : this.sunCascades?.isActive ? this.sunCascades.cascadeLights
          : this.sun?.castShadow ? [this.sun] : [];
      for (const object of this.landscapeObjects) updateLandscapeLod(object, this.editorViewportCamera(), shadowLights);
      advanceForgeMaterialAnimations(now / 1000);

      // The sweep decides what this frame draws and tags the GPU query with the
      // step it belongs to; with the panel closed both calls are a null check.
      this.gpuSweepSession.beginFrame();
      if (this.postProcessPipeline && !this.gpuSweepSession.bypassPostProcess) {
        this.postProcessPipeline.render(deltaSeconds);
      } else this.renderer.render(this.scene, this.editorViewportCamera());
      this.gpuSweepSession.endFrame();
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
    this.persistCameraPose();
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("pagehide", this.persistCameraPose);
    this.viewportResizeObserver?.disconnect();
    this.viewportResizeObserver = null;
    this.unbindEditorInput?.();
    this.unbindEditorInput = null;
    this.clearAiScriptStimulusBridge();
    this.keyboardInput.detach();
    this.selectionOutline?.dispose();
    this.selectionOutline = null;
    this.removeAiNavigationView();
    this.recastPreview.dispose();
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
    this.gpuSweepSession.dispose();
    this.postProcessPipeline?.dispose();
    this.postProcessPipeline = null;
    // Frees the sky/cloud domes and the Sky Light capture. Previously nothing
    // here did: the editor only disposed a dome when its actor was deleted, so
    // closing the editor leaked whatever was still standing.
    this.environment.teardown();
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
    if (this.landscapeRampPreview) {
      this.scene.remove(this.landscapeRampPreview);
      this.landscapeRampPreview.geometry.dispose();
      this.landscapeRampPreview.material.dispose();
      this.landscapeRampPreview = null;
    }
    for (const layer of this.landscapeLayerMaterialCache.values()) { layer.texture?.dispose(); layer.normalTexture?.dispose(); }
    this.landscapeLayerMaterialCache.clear();
    for (const water of this.riverWaterObjects) {
      this.scene.remove(water);
      disposeRiverWaterObject(water);
    }
    this.riverWaterObjects = [];
    for (const source of this.riverReflectionSources) this.waterReflections.release(source);
    this.riverReflectionSources = [];
    this.riverFoamJob?.controller.abort(); this.riverFoamJob=null;
    this.riverFoamAborter.abort(); this.riverFoam.clear(); this.riverFoamMessages.clear();
    this.lakeFoamJob?.controller.abort(); this.lakeFoamJob=null;
    this.lakes?.dispose();
    if (this.lakeTimer) clearTimeout(this.lakeTimer);
    for (const texture of this.riverWaterTextures.values()) texture.dispose();
    this.riverWaterTextures.clear();
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

  /**
   * Turns GPU timer queries on or off. Driven by the editor's Show > Stats flag,
   * so the per-frame driver round trip exists exactly while somebody is reading
   * the overlay — the editor's counterpart of the runtime's `?debug` gate.
   *
   * Switching it off abandons a sweep in progress: the scene is put back, but no
   * table appears, because whoever just closed the panel is not waiting for one.
   */
  setGpuProfilingEnabled(enabled: boolean): void {
    if (enabled) this.gpuSweepSession.enable();
    else this.gpuSweepSession.disable();
  }

  /**
   * Windowed GPU frame time, or `null` when nothing is measuring it — the perf
   * panel is closed, or the browser withholds `EXT_disjoint_timer_query_webgl2`.
   * Never a zero: "the GPU cost nothing" and "nobody measured the GPU" must not
   * read alike.
   */
  getGpuFrameStats(): GpuFrameStats | null {
    return this.gpuSweepSession.frameStats();
  }

  /**
   * Runs the GPU A/B sweep over the editor viewport: each content category is
   * switched off in turn and what it gives back is measured.
   *
   * Worth having here and not only in the runtime, because the editor scene is
   * the one being *authored* — and because it carries content the runtime never
   * draws. The authoring overlays are tagged `editor-overlay`, so the gizmo,
   * selection outlines and brush cursors come back as one honest row rather than
   * hiding inside everything else.
   */
  startGpuSweep(consume: (outcome: GpuSweepOutcome) => void): void {
    this.gpuSweepSession.start(consume);
  }

  /**
   * The drawing buffer being shaded, for the `?debug` overlay. Present on the
   * editor shell too because the question it answers — is this frame paying for
   * pixels or for content? — is asked while authoring, not only while playing.
   */
  getDrawingBufferSnapshot(): DrawingBufferSnapshot {
    const size = this.renderer.getSize(new Vector2());
    return { width: size.x, height: size.y, pixelRatio: this.renderer.getPixelRatio() };
  }

  /**
   * Graph size and shadow casters by scene source, for the `?debug` overlay.
   *
   * The editor scene carries the authoring overlays too (gizmo, outlines, brush
   * cursors), so its numbers are honestly larger than the runtime’s — which is
   * itself worth seeing, and is why the buckets are labelled rather than summed.
   */
  getSceneCostSnapshot(): SceneCostSnapshot {
    return buildSceneCostSnapshot(this.scene as unknown as SceneCostObject);
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

  selectSceneObject(id: string, options: { additive?: boolean; rangeIds?: readonly string[] } = {}): void {
    const selection = parseSelectionId(id);
    if (!selection || !this.hasSelection(selection)) return;
    if (options.rangeIds) {
      const selections = options.additive ? this.getSelectedSelections() : [];
      const ids = new Set(selections.map(selectionId));
      for (const rangeId of [...options.rangeIds, id]) {
        const entry = parseSelectionId(rangeId);
        if (!entry || !this.hasSelection(entry) || ids.has(rangeId)) continue;
        ids.add(rangeId);
        selections.push(entry);
      }
      this.selectMany(selections, selection);
      return;
    }
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
    if (id.startsWith("lake:")) { this.setLakeByIndex(Number(id.slice(5)), { name }); return; }
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
    if (id.startsWith("lake:")) { this.setLakeByIndex(Number(id.slice(5)), { hidden }); return; }
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
    if (id.startsWith("lake:")) { this.setLakeByIndex(Number(id.slice(5)), { locked }); return; }
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
    const previousSplineId = this.landscapeSculptSettings.activeSplineId;
    const previousSplinePointId = this.landscapeSculptSettings.activeSplinePointId;
    const previousFoamStampId = this.landscapeSculptSettings.activeRiverWaterFoamStampId;
    const previousFoamStampAnchor = this.landscapeSculptSettings.activeRiverWaterFoamStampAnchor;
    const next = { ...this.landscapeSculptSettings, ...patch };
    const layerIds = new Set<string>(LANDSCAPE_DEFAULT_LAYERS.map((layer) => layer.id));
    // World Terrain layers may use ids of their own.
    for (const world of this.worldTerrains.values()) for (const layer of world.def.layers) layerIds.add(layer.id);
    this.landscapeSculptSettings = {
      editMode: ["sculpt", "paint", "splines", "water"].includes(next.editMode) ? next.editMode : "sculpt",
      tool: ["raise", "lower", "smooth", "flatten", "noise", "ramp", "terrace", "erosion"].includes(next.tool) ? next.tool : "raise",
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
      flattenUseClickedHeight: next.flattenUseClickedHeight === true,
      noiseScale: Number.isFinite(next.noiseScale) ? clamp(next.noiseScale, 0.1, 1000) : DEFAULT_TERRAIN_SCULPT_SETTINGS.noiseScale,
      noiseSeed: Number.isFinite(next.noiseSeed) ? Math.round(clamp(next.noiseSeed, 0, 2147483647)) : DEFAULT_TERRAIN_SCULPT_SETTINGS.noiseSeed,
      terraceStep: Number.isFinite(next.terraceStep) ? clamp(next.terraceStep, 0.01, 1000) : DEFAULT_TERRAIN_SCULPT_SETTINGS.terraceStep,
      terraceSmoothing: Number.isFinite(next.terraceSmoothing) ? clamp(next.terraceSmoothing, 0, 1) : DEFAULT_TERRAIN_SCULPT_SETTINGS.terraceSmoothing,
      erosionHydraulic: next.erosionHydraulic === true,
      erosionIterations: Number.isFinite(next.erosionIterations) ? Math.round(clamp(next.erosionIterations, 1, 64)) : DEFAULT_TERRAIN_SCULPT_SETTINGS.erosionIterations,
      erosionTalus: Number.isFinite(next.erosionTalus) ? clamp(next.erosionTalus, 0, 89) : DEFAULT_TERRAIN_SCULPT_SETTINGS.erosionTalus,
      erosionRainAmount: Number.isFinite(next.erosionRainAmount) ? clamp(next.erosionRainAmount, 0, 10) : DEFAULT_TERRAIN_SCULPT_SETTINGS.erosionRainAmount,
      erosionSedimentCapacity: Number.isFinite(next.erosionSedimentCapacity) ? clamp(next.erosionSedimentCapacity, 0, 20) : DEFAULT_TERRAIN_SCULPT_SETTINGS.erosionSedimentCapacity,
      erosionEvaporation: Number.isFinite(next.erosionEvaporation) ? clamp(next.erosionEvaporation, 0, 1) : DEFAULT_TERRAIN_SCULPT_SETTINGS.erosionEvaporation,
      erosionSeed: Number.isFinite(next.erosionSeed) ? Math.round(clamp(next.erosionSeed, 0, 2147483647)) : DEFAULT_TERRAIN_SCULPT_SETTINGS.erosionSeed,
      rampStartOffset: Number.isFinite(next.rampStartOffset) ? clamp(next.rampStartOffset, -1000, 1000) : 0,
      rampEndOffset: Number.isFinite(next.rampEndOffset) ? clamp(next.rampEndOffset, -1000, 1000) : 0,
      rampShoulder: Number.isFinite(next.rampShoulder) ? clamp(next.rampShoulder, 0, 50) : DEFAULT_TERRAIN_SCULPT_SETTINGS.rampShoulder,
      activeRiverWaterId: typeof next.activeRiverWaterId === "string" && next.activeRiverWaterId.length > 0
        ? next.activeRiverWaterId
        : null,
      riverWaterRingFoamPlacementId:
        next.editMode === "water" && typeof next.riverWaterRingFoamPlacementId === "string" && next.riverWaterRingFoamPlacementId.length > 0
          ? next.riverWaterRingFoamPlacementId
          : null,
      activeRiverWaterFoamStampId:
        typeof next.activeRiverWaterFoamStampId === "string" && next.activeRiverWaterFoamStampId.length > 0
          ? next.activeRiverWaterFoamStampId
          : null,
      activeRiverWaterFoamStampAnchor:
        next.activeRiverWaterFoamStampAnchor === "start" || next.activeRiverWaterFoamStampAnchor === "end"
          ? next.activeRiverWaterFoamStampAnchor
          : null,
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
    const mode = this.landscapeSculptSettings.editMode === "water"
      ? "Water"
      : this.landscapeSculptSettings.editMode === "splines"
      ? "Splines"
      : this.landscapeSculptSettings.editMode === "paint"
        ? this.landscapeSculptSettings.paintTool
        : this.landscapeSculptSettings.tool;
    this.onStatus?.(`Landscape ${mode}`, "info");
    this.refreshAllLandscapeSplineOverlays();
    this.refreshAllRiverWaterFoamOverlays();
    if (
      previousEditMode !== this.landscapeSculptSettings.editMode ||
      previousSplineTool !== this.landscapeSculptSettings.splineTool ||
      previousSplineId !== this.landscapeSculptSettings.activeSplineId ||
      previousSplinePointId !== this.landscapeSculptSettings.activeSplinePointId ||
      previousFoamStampId !== this.landscapeSculptSettings.activeRiverWaterFoamStampId ||
      previousFoamStampAnchor !== this.landscapeSculptSettings.activeRiverWaterFoamStampAnchor
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
    const camera = this.activeCamera instanceof OrthographicCamera ? this.orthoCamera : this.camera;
    if (this.lakes) camera.layers.enable(31);
    return camera;
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

  /**
   * The World Partition panel's snapshot: the level's terrain (tile residency,
   * unsaved tiles and its live height map), the occupied partition cells and
   * the editor camera. Cheap enough to poll while the panel is open.
   */
  getWorldPartitionView(): WorldPartitionView {
    const camera = this.editorViewportCamera();
    const forward = camera.getWorldDirection(new Vector3());
    const { partition, cells } = this.worldPartitionCells();
    return {
      terrain: this.worldPartitionTerrainView(),
      partition,
      cells,
      camera: { x: camera.position.x, z: camera.position.z, forwardX: forward.x, forwardZ: forward.z },
    };
  }

  /**
   * The Outliner's World Partition view: each streamed object's `main` cell
   * and the occupied cells a pawn at the editor camera would load. Null while
   * the level's partition is off.
   */
  getOutlinerPartitionView(): OutlinerPartitionView | null {
    const { partition, objectCells, cells } = this.worldPartitionCells();
    if (!partition.enabled) return null;
    const camera = this.editorViewportCamera().position;
    return {
      cells: objectCells,
      loadedCells: worldPartitionCellsInRange(partition, cells.map(({ key }) => key), camera.x, camera.z),
    };
  }

  /** Routing walks the whole level; redo it only when the scene or the grid changed. */
  private worldPartitionCells(): {
    partition: WorldPartitionSettings;
    objectCells: Map<string, string>;
    cells: WorldPartitionView["cells"];
  } {
    const partition = normalizeWorldPartitionSettings(this.layout?.worldSettings?.partition);
    const cacheKey = `${this.sceneObjectsRevision}:${JSON.stringify(partition)}`;
    if (this.worldPartitionCellCache?.key !== cacheKey) {
      const objectCells = this.layout ? worldPartitionObjectCells(this.layout, partition) : new Map<string, string>();
      const counts = new Map<string, number>();
      for (const key of objectCells.values()) counts.set(key, (counts.get(key) ?? 0) + 1);
      const cells = [...counts].sort(([a], [b]) => compareWorldCellKeys(a, b)).map(([key, count]) => {
        const coord = parseWorldCellKey(key)!;
        return { key, x: coord.x, z: coord.z, count };
      });
      this.worldPartitionCellCache = { key: cacheKey, objectCells, cells };
    }
    return { partition, ...this.worldPartitionCellCache };
  }

  private worldPartitionTerrainView(): WorldPartitionView["terrain"] {
    const actor = this.layout?.landscapes?.[0];
    if (!actor) return null;
    const document = this.worldTerrains.get(actor.id);
    if (document) {
      const { def } = document;
      const size = terrainTileWorldSize(def);
      const rect = { minX: def.origin[0], minZ: def.origin[2], maxX: def.origin[0] + def.tilesX * size, maxZ: def.origin[2] + def.tilesZ * size };
      const streaming = this.worldTerrainStreams.get(document);
      const session = this.worldTerrainSessions.get(document);
      const unsaved = new Set(session?.dirtyKeys() ?? []);
      const tiles = def.tiles.map(({ key }): WorldPartitionTileView => {
        const coord = parseTileKey(key)!;
        const state = document.tiles.has(key) ? "resident" : streaming?.isLoading(key) ? "loading" : "unloaded";
        return { key, x: coord.x, z: coord.z, state, unsaved: unsaved.has(key), kept: streaming?.isKept(key) ?? false };
      });
      const map = document.globalAttributes?.map ?? null;
      const vertices = (def.tileQuads + 1) ** 2;
      return {
        name: actor.name || def.name, rect, tileSize: size, tilesX: def.tilesX, tilesZ: def.tilesZ,
        streams: Boolean(streaming), loadRange: streaming?.loadRange ?? null,
        tileBytes: vertices * (4 + 4 * terrainWeightBlockCount(def.layers.length)), tiles,
        map, metresPerSample: map ? (def.tilesX * size) / (map.width - 1) : def.spacing,
        mapRevision: `${actor.id}:${session?.editRevision ?? 0}:${document.tiles.size}`,
      };
    }
    return null;
  }

  /**
   * Keeps the terrain tiles a world X/Z rectangle touches loaded wherever the
   * camera goes (`load`), or stops keeping them (World Partition panel). Kept
   * regions are remembered per terrain for the next session. A terrain that
   * holds every tile in memory has nothing to load.
   */
  setWorldMapRegionLoaded(rect: WorldMapRect, load: boolean): void {
    const actor = this.layout?.landscapes?.[0];
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    const streaming = document ? this.worldTerrainStreams.get(document) : undefined;
    if (!actor || !document || !streaming) {
      this.onStatus?.("This terrain keeps every tile in memory; there is nothing to load or unload.", "info");
      return;
    }
    const keys = terrainTileKeysInRect(document.def, rect);
    if (keys.length === 0) {
      this.onStatus?.("The selected region covers no terrain tile.", "info");
      return;
    }
    if (load) void streaming.keepLoaded(keys).catch(() => {});
    else streaming.releaseKept(keys);
    this.keptTerrainTiles?.write(actor.dataRef, streaming.keptKeys());
    this.onStatus?.(load
      ? `Keeping ${keys.length} tile${keys.length === 1 ? "" : "s"} loaded (${streaming.keptKeys().length} kept in total).`
      : `Unloaded ${keys.length} tile${keys.length === 1 ? "" : "s"} from the kept region; tiles near the camera or with unsaved edits stay.`, "info");
  }

  /**
   * Moves the editor camera to look at world (`x`, `z`) from the same height
   * above the ground along its current view direction (World Partition panel).
   * A streaming terrain then loads the tiles around it.
   */
  focusWorldMapPoint(x: number, z: number): void {
    const view = this.worldPartitionTerrainView();
    const ground = view?.map ? worldMapHeightAt(view.map, view.rect, x, z) : null;
    const camera = this.editorViewportCamera();
    const forward = camera.getWorldDirection(new Vector3());
    const target = new Vector3(x, ground ?? 0, z);
    const position = worldMapFocusPosition(camera.position.toArray(), forward.toArray(), target.toArray());
    camera.position.set(position[0], position[1], position[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    this.cameraController.markViewChanged();
    this.cameraController.syncAnglesFromCurrentView();
    this.onStatus?.(`Moved the camera to ${Math.round(x)}, ${Math.round(z)}.`, "info");
  }

  /**
   * Frames a World Builder preview item, or the whole preview, along the
   * current view direction. Unlike Focus Selected the distance is not capped:
   * a stage can touch a whole settlement.
   */
  private focusWorldBuilderPreview(preview: StagePreview, item: PreviewItem | null): void {
    const box = this.worldBuilderPreview.worldBox(preview, item);
    if (!box) {
      this.onStatus?.(item ? `${item.id} has nothing to show in the viewport.` : "The preview has nothing to show in the viewport.", "warning");
      return;
    }
    const camera = this.editorViewportCamera();
    const viewDirection = camera.getWorldDirection(new Vector3());
    if (viewDirection.lengthSq() === 0) viewDirection.copy(SCENE_CAMERA_TARGET).sub(camera.position).normalize();
    const target = box.getCenter(new Vector3());
    const radius = Math.max(box.getSize(new Vector3()).length() * 0.5, 1);
    if (camera instanceof OrthographicCamera) {
      this.orthoViewHeight = clamp(radius * 2.4, ORTHO_MIN_VIEW_HEIGHT, ORTHO_MAX_VIEW_HEIGHT);
      this.updateOrthoProjection();
    }
    camera.position.copy(target).addScaledVector(viewDirection, -radius * 1.8);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    this.cameraController.markViewChanged();
    this.cameraController.syncAnglesFromCurrentView();
    this.onStatus?.(item ? `Focused ${item.id}.` : `Focused the ${preview.stageLabel} preview.`, "info");
  }

  /**
   * Edit Plan (World Builder 15b): a left press within reach of a plan handle
   * selects its element and drags the point over the ground; the drop is one
   * undo step. A press that misses every handle falls through to normal
   * picking, and a press released without moving only selects.
   */
  private beginWorldBuilderPlanDrag(event: PointerEvent): boolean {
    const handles = this.worldBuilder.planHandles();
    if (handles.length === 0) return false;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const camera = this.editorViewportCamera();
    const projected = new Vector3();
    let best: { ref: PlanPointRef; distance: number } | null = null;
    for (const { ref, point } of handles) {
      projected.set(point[0], (this.worldTerrainHeightAt(point[0], point[1]) ?? 0) + HANDLE_LIFT, point[1]).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const distance = Math.hypot(
        (projected.x * 0.5 + 0.5) * rect.width - (event.clientX - rect.left),
        (-projected.y * 0.5 + 0.5) * rect.height - (event.clientY - rect.top),
      );
      if (distance <= WORLD_BUILDER_HANDLE_REACH && (!best || distance < best.distance)) best = { ref, distance };
    }
    if (!best) return false;
    this.worldBuilderPlanDrag = { pointerId: event.pointerId, ref: best.ref, startX: event.clientX, startY: event.clientY, point: null };
    this.canvas.setPointerCapture(event.pointerId);
    this.worldBuilder.beginPlanDrag(best.ref);
    return true;
  }

  private updateWorldBuilderPlanDrag(event: PointerEvent): boolean {
    const drag = this.worldBuilderPlanDrag;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    // A few pixels of jitter on a click is not a move.
    if (!drag.point && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return true;
    const hit = this.picker.pickLandscapeSurface(event.clientX, event.clientY)?.point
      ?? this.picker.clientToPlane(event.clientX, event.clientY, this.floorPlane);
    if (!hit) return true;
    drag.point = [Math.round(hit.x * 100) / 100, Math.round(hit.z * 100) / 100];
    this.worldBuilder.dragPlanPoint(drag.ref, drag.point);
    return true;
  }

  private endWorldBuilderPlanDrag(event: PointerEvent): boolean {
    const drag = this.worldBuilderPlanDrag;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    this.worldBuilderPlanDrag = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.worldBuilder.endPlanDrag(drag.ref, event.type === "pointerup" ? drag.point : null);
    return true;
  }

  /**
   * Where the view ray from the viewport centre meets the ground (World
   * Builder adds a plan element there); without ground, a point ahead.
   */
  private worldBuilderViewTarget(): [number, number] {
    const camera = this.editorViewportCamera();
    const direction = camera.getWorldDirection(new Vector3());
    const point = camera.position.clone();
    for (let travelled = 0; travelled < 4000; travelled += 2) {
      point.addScaledVector(direction, 2);
      const ground = this.worldTerrainHeightAt(point.x, point.z) ?? 0;
      if (point.y <= ground) return [point.x, point.z];
    }
    const flat = new Vector3(direction.x, 0, direction.z);
    if (flat.lengthSq() > 0) flat.normalize().multiplyScalar(50);
    return [camera.position.x + flat.x, camera.position.z + flat.z];
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
      ...(this.layout?.worldSettings?.viewDistance !== undefined
        ? { viewDistance: this.layout.worldSettings.viewDistance }
        : {}),
      ...(this.layout?.worldSettings?.partition
        ? { partition: normalizeWorldPartitionSettings(this.layout.worldSettings.partition) }
        : {}),
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
        | "partition"
        | "viewDistance"
      >
    >,
  ): void {
    if (!this.layout) return;
    const previous = this.getWorldSettings();
    const next: EditorWorldSettings = { ...previous, ...values };
    if (next.partition) next.partition = normalizeWorldPartitionSettings(next.partition);
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
   * Binds the pose store to the level being opened and, when that level has a
   * remembered viewport pose, restores it instead of the default 3/4 framing.
   * Marking the view as touched keeps the responsive resize pass from re-framing
   * it once the editor panels settle into their final layout.
   */
  private restoreEditorCameraPose(scenePath: string): void {
    if (!this.cameraPoseStore) return;
    this.cameraPoseStore.setScenePath(scenePath);
    if (!this.cameraPoseStore.restore(this.camera)) return;
    this.cameraController.markViewChanged();
    this.cameraController.syncAnglesFromCurrentView();
    this.syncOrthoCameraFromPerspective();
  }

  /** Unthrottled pose write for teardown/`pagehide`, so the last pose is kept. */
  private persistCameraPose = (): void => {
    this.cameraPoseStore?.save(this.camera);
  };

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
    roots.push(...this.landscapeObjects);
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
    const blocked = this.transformBlockedReason(this.selection);
    if (blocked) {
      this.onStatus?.(blocked, "warning");
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
    const blocked = this.transformBlockedReason(this.selection);
    if (blocked) {
      this.onStatus?.(blocked, "warning");
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
    const blocked = this.transformBlockedReason(selection);
    if (blocked) {
      this.onStatus?.(blocked, "warning");
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
  /**
   * Previews a sun's Cascaded Shadows in the perspective viewport with the
   * graphics quality's cascades (count, map size, distance). The orthographic
   * views keep the bounds-fitted map.
   */
  private updateSunCascades(): void {
    const sun = this.sun;
    const index = sun ? this.lightObjects.findIndex((record) => record.light === sun) : -1;
    const actor = index >= 0 ? this.layout?.lights?.[index] : undefined;
    const camera = this.editorViewportCamera();
    if (
      !sun?.castShadow || actor?.cascadedShadows !== true || !this.renderer.shadowMap.enabled
      || !(camera as PerspectiveCamera).isPerspectiveCamera
    ) {
      this.sunCascades?.deactivate();
      return;
    }
    const profile = this.editorQuality;
    const count = affordableSunCascades(profile.shadowCascades, this.renderer.capabilities.maxTextures, landscapeLitFragmentSamplers(this.landscapeObjects));
    if (count < 2) {
      this.sunCascades?.deactivate();
      return;
    }
    this.sunCascades ??= new SunCascadeShadow(this.scene);
    this.sunCascades.update({
      sun,
      camera: camera as PerspectiveCamera,
      count,
      stagger: profile.shadowCascadeStagger,
      mapSize: profile.shadowMapSize,
      distance: sunCascadeDistance(profile.shadowDistanceScale),
    });
  }

  private fitSunShadowToScene(): void {
    fitDirectionalShadowToBounds(this.sun, this.getRoomBounds(), this.editorQuality.shadowDistanceScale);
  }

  /**
   * The graphics quality choice shared with Play: a profile picked here (or in
   * the game's settings), or `"auto"` while Play calibrates one itself.
   */
  getGraphicsQualityChoice(): QualityLevel | "auto" {
    const graphics = this.userSettingsStore?.read().graphics;
    return graphics?.manuallySelected ? graphics.selectedQualityLevel : "auto";
  }

  /**
   * Picks the graphics quality for the viewport and for Play (Unreal's
   * Scalability menu). A profile is stored as the player's manual choice, so
   * Play's startup calibration does not override it and an open Play tab
   * switches live; `"auto"` hands the choice back to Play's calibration and
   * renders the viewport at Ultra.
   */
  setGraphicsQualityChoice(choice: QualityLevel | "auto"): void {
    const store = this.userSettingsStore;
    if (store) {
      const graphics = store.read().graphics;
      store.setGraphics(choice === "auto"
        ? { ...graphics, manuallySelected: false }
        : { ...graphics, selectedQualityLevel: choice, manuallySelected: true });
    }
    this.applyEditorQuality();
    this.onStatus?.(`Graphics quality: ${choice === "auto" ? "Auto (Play calibrates)" : choice}.`, "info");
  }

  /** Renders the viewport with the chosen quality: shadows, cascades and post-process gates. */
  private applyEditorQuality(): void {
    const graphics = this.userSettingsStore?.read().graphics;
    const quality = graphics?.manuallySelected
      ? resolveQualitySettings(graphics.selectedQualityLevel, graphics.customSettings)
      : QUALITY_PROFILES.ultra;
    this.editorQuality = quality;
    if (this.renderer.shadowMap.enabled !== quality.shadowsEnabled) {
      this.renderer.shadowMap.enabled = quality.shadowsEnabled;
      invalidateMaterialsForShadowToggle(this.scene);
    }
    for (const record of this.lightObjects) this.applyShadowMapSize(record.light);
    setTerrainSelfShadow(quality.terrainSelfShadow);
    setTerrainFarTiling(quality.terrainFarTiling);
    void this.lakes?.setQuality(lakeQuality(quality)).catch(error => console.warn("[lake-quality]", error));
    for(const river of this.riverWaterObjects)river.setShoreWetnessAllowed(quality.lakeShoreWetnessAllowed);
    this.fitSunShadowToScene();
    this.applyPostProcess();
  }

  /** The quality's shadow map resolution on a shadow-casting light (the sun's cascades size their own). */
  private applyShadowMapSize(light: Light): void {
    const size = this.editorQuality.shadowMapSize;
    const shadow = (light as Light & { shadow?: LightShadow }).shadow;
    if (!light.castShadow || !shadow || shadow.mapSize.width === size) return;
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
    shadow.needsUpdate = true;
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

  /** Lightweight placement helpers; reflection rendering/baking starts only on drop. */
  beginReflectionDragPreview(kind: "reflectiveSurface" | "reflectionCapture"): void {
    this.endAssetDragPreview();
    this.dragPreviewAssetId = kind;
    const group = new Group();
    let dispose: () => void;
    if (kind === "reflectionCapture") {
      const helper = createSphereReflectionCaptureObject(this.reflectionCaptureItem({
        id: "drag-preview",
        position: [0, 0, 0],
      }));
      group.add(helper, createSphereReflectionCaptureIcon());
      // The icon uses a shared cached material; only the helper owns resources.
      dispose = () => disposeSphereReflectionCaptureObject(helper);
    } else {
      const geometry = new PlaneGeometry(4, 4);
      const material = new MeshBasicMaterial({
        color: 0xf59e2c,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
      dispose = () => { geometry.dispose(); material.dispose(); };
    }
    group.visible = false;
    this.dragPreview = { kind, key: kind, group, dispose };
    this.scene.add(tagSceneSource(group, EDITOR_OVERLAY_SOURCE));
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
    if (preview.kind === "reflectiveSurface" || preview.kind === "reflectionCapture") {
      const position = this.computeReflectionDropPosition(preview.kind, clientX, clientY);
      preview.group.visible = position !== null;
      if (position) preview.group.position.set(...position);
      return;
    }
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
    const assets = this.manifest?.assets;
    if (!assets) return "";
    // The Outliner asks once per scene object; a linear manifest scan each made
    // every refresh of a large level quadratic.
    if (this.assetCategoryIndex?.assets !== assets || this.assetCategoryIndex.length !== assets.length) {
      const categories = new Map<string, string>();
      for (const entry of assets) {
        if (!categories.has(entry.id)) categories.set(entry.id, entry.category ?? "");
      }
      this.assetCategoryIndex = { assets, length: assets.length, categories };
    }
    return this.assetCategoryIndex.categories.get(assetId) ?? "";
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
    const blocked = this.transformBlockedReason(this.selection);
    if (blocked) {
      this.onStatus?.(blocked, "warning");
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
    const editableSelections = selections.filter((selection) => !this.transformBlockedReason(selection));
    if (editableSelections.length === 0) {
      this.onStatus?.(this.transformBlockedReason(selections[0] ?? this.selection) ?? "Selected object is locked.", "warning");
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
    if (this.selection?.kind === "lake") { this.deleteLake(); return; }
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

  private computeReflectionDropPosition(
    kind: "reflectiveSurface" | "reflectionCapture",
    clientX: number,
    clientY: number,
  ): Vec3 | null {
    const hit = this.picker.clientToSurface(clientX, clientY);
    if (!hit) return null;
    return [
      snapValue(hit.x, this.snapSettings.move, this.snapSettings.moveEnabled),
      // Keep the plane clear of z-fighting and the probe above the picked surface.
      round(hit.y + (kind === "reflectiveSurface" ? 0.01 : 2)),
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
    if (payload === "reflectiveSurface" || payload === "reflectionCapture") {
      const position = this.computeReflectionDropPosition(payload, clientX, clientY);
      if (!position) return;
      if (payload === "reflectiveSurface") this.addReflectiveSurface(position);
      else this.addReflectionCapture(position);
      return;
    }
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

  saveLayout(): Promise<void> {
    return this.editorSaves.saveLayout();
  }

  private editorSaveSource(): EditorSaveSource {
    if (!this.layout) throw new Error("Layout is not loaded yet.");
    if (!this.layoutSaver) {
      throw new Error("Layout saving is available only when the editor saver is installed.");
    }
    if (!this.activeProject) throw new Error("Saving requires an active project.");
    return {
      layout: this.layout,
      layoutSaver: this.layoutSaver,
      scenePath: this.activeProject.manifest.editor.defaultScene,
      editor: {
        gridSize: this.snapSettings.move,
        gridEnabled: this.snapSettings.moveEnabled,
        snapRotationDeg: this.snapSettings.rotate,
        snapRotationEnabled: this.snapSettings.rotateEnabled,
        snapScale: this.snapSettings.scale,
        snapScaleEnabled: this.snapSettings.scaleEnabled,
      },
      worldTerrainIds: new Set(this.worldTerrains.keys()),
      worldTerrainSessions: new Map([...this.worldTerrains].flatMap(([id, document]) => {
        const session = this.worldTerrainSessions.get(document);
        return session ? [[id, session] as const] : [];
      })),
      lakeFoamSteps: () => [...lakeFoamSaveSteps(this.lakes?.foam,this.layout?.waterBodies ?? []),...lakeFoamSaveSteps(this.riverFoam,this.layout?.riverWaters??[])],
      foliageData: this.foliageData,
      meshPaintData: this.meshPaintData,
      worldRecipe: this.worldBuilder,
    };
  }

  private async loadActiveProjectScene(): Promise<void> {
    this.cancelRiverGeometryFoam();this.riverFoamAborter.abort();this.riverFoam.clear();this.riverFoamMessages.clear();
    this.activeProject = await loadActiveProject();
    this.restoreEditorCameraPose(this.activeProject.manifest.editor.defaultScene);
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
    this.editorSaves.meshPaintSaveRevision.reset();
    // Normalize world widgets so the editor never reads a malformed anchor (the
    // runtime normalizes on its own load path); keeps the saved JSON clean too.
    if (this.layout.worldWidgets) {
      this.layout.worldWidgets = normalizeWorldWidgets(this.layout.worldWidgets);
    }
    this.ensureDefaultLights();
    this.physicsSubsystem.setGravity(resolveSceneWorldSettings(this.layout).gravity);
    await this.levelRuntime.build();
    // After the build: stages sample the World Terrains, which exist only now.
    await this.worldBuilder.load(this.activeProject.manifest.editor.defaultScene);

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
        const chosen = overrideMaterial ?? source;
        const base = placement.color === undefined ? chosen : tintedMaterial(chosen, placement.color, clonedMaterials);
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
        (slotMaterial) => {
          const material = placement.color === undefined ? slotMaterial : tintedMaterial(slotMaterial, placement.color, clonedMaterials);
          return bake
            ? assignProbeEnvMapMaterial(
                material,
                bake,
                clonedMaterials,
                this.scene.environment,
                this.scene.environmentIntensity,
              )
            : material;
        },
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
      // Every placement sharing a still-loading slot lands here; queueing a
      // rebuild per call rebuilt an N-placement group N times (N² clones).
      if (assetIdToRebuild) this.materialLoadRebuilds.get(materialId)?.add(assetIdToRebuild);
      return pending;
    }
    if (!this.manifest) return Promise.resolve(undefined);
    const rebuildAssetIds = new Set<string>(assetIdToRebuild ? [assetIdToRebuild] : []);
    this.materialLoadRebuilds.set(materialId, rebuildAssetIds);
    const releaseRebuilds = () => {
      if (this.materialLoadRebuilds.get(materialId) === rebuildAssetIds) {
        this.materialLoadRebuilds.delete(materialId);
      }
    };
    const load = loadForgeMaterial(this.manifest, materialId, this.textureLoader, {
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    })
      .then((material) => {
        this.materialCache.set(materialId, material);
        this.materialLoads.delete(materialId);
        releaseRebuilds();
        for (const assetId of rebuildAssetIds) this.rebuildInstanceGroup(assetId);
        return material;
      })
      .catch((error) => {
        this.materialLoads.delete(materialId);
        releaseRebuilds();
        this.onStatus?.(
          `Material load failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        throw error;
      });
    this.materialLoads.set(materialId, load);
    return load;
  }

  /**
   * Loads every placement `materialSlot` override before the first scene build,
   * so each instance group is built once with its final materials instead of
   * being rebuilt as each override resolves. Failures are reported by
   * `ensureMaterialLoaded`; the build then falls back to the asset's material.
   */
  private async preloadPlacementMaterials(): Promise<void> {
    const materialIds = new Set<string>();
    for (const instance of this.layout?.instances ?? []) {
      for (const placement of instance.placements) {
        if (placement.materialSlot) materialIds.add(placement.materialSlot);
      }
    }
    await Promise.allSettled([...materialIds].map((materialId) => this.ensureMaterialLoaded(materialId)));
  }

  private rebuildInstanceGroup(assetId: string): void {
    if (!this.layout) return;
    // Preview materials belong to clone meshes that are about to be discarded.
    this.clearMeshPaintColorView();
    const previous = this.instanceGroups.get(assetId);
    if (previous) {
      previous.traverse((child) => {
        // Geometry and materials are the shared GLTF ones, but each group owns
        // its instance buffers; without this every rebuild leaked them on the GPU.
        if ((child as InstancedMesh).isInstancedMesh) (child as InstancedMesh).dispose();
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

  /**
   * Writes one side of a World Builder stage's group changes and rebuilds
   * those groups once each. Placement indices shift, so the selection clears.
   */
  private applyWorldBuilderGroupChanges(changes: readonly PlacementGroupChange[], side: "before" | "after"): void {
    if (!this.layout) return;
    this.clearSelection();
    // A stage can add the level's first shape of a kind; load only registered the ones it had.
    for (const change of changes) this.ensureShapeModel(change.assetId);
    for (const assetId of applyPlacementGroupChanges(this.layout, changes, side)) {
      if (this.models.has(assetId)) {
        this.rebuildInstanceGroup(assetId);
        continue;
      }
      // A profile model outside the level's load groups loads first, as a drag-and-drop does;
      // the rebuild then reads whatever the layout holds by the time it arrives.
      void this.ensureAssetLoaded(assetId).then((ok) => {
        if (ok) this.rebuildInstanceGroup(assetId);
      });
    }
    this.emitSceneObjectsChanged();
  }

  /**
   * Bakes World Builder pads into the World Terrains under them, one terrain
   * undo command per terrain (decision 19: an explicit button, like a spline
   * deform). Pads off every terrain or on a locked one are skipped and counted.
   */
  private async applyWorldBuilderPads(pads: readonly TerrainPad[]): Promise<void> {
    if (this.worldTerrainSplineBusy) {
      this.onStatus?.("Loading terrain for the previous terrain operation…", "info");
      return;
    }
    const terrains = this.worldBuilderTerrains();
    const byTerrain = new Map<string, TerrainPad[]>();
    let skipped = 0;
    for (const pad of pads) {
      const [x, z] = pad.polygon[0]!;
      const terrain = terrains.find((entry) => x >= entry.min[0] && x <= entry.max[0] && z >= entry.min[1] && z <= entry.max[1]);
      if (!terrain || terrain.locked) {
        skipped += 1;
        continue;
      }
      byTerrain.set(terrain.id, [...(byTerrain.get(terrain.id) ?? []), pad]);
    }
    this.worldTerrainSplineBusy = true;
    let applied = 0;
    let tiles = 0;
    try {
      for (const [landscapeId, own] of byTerrain) {
        const document = this.worldTerrains.get(landscapeId);
        const session = document ? this.worldTerrainSessions.get(document) : undefined;
        if (!document || !session) {
          skipped += own.length;
          continue;
        }
        const streaming = this.worldTerrainStreams.get(document);
        const keys = terrainPadTileKeys(document.def, own);
        if (streaming) this.onStatus?.("Loading terrain for pads…", "info");
        await streaming?.demand(keys);
        try {
          if (this.worldTerrains.get(landscapeId) !== document) continue;
          const patches = createTerrainPadPatches(session.world, own);
          if (patches.length === 0) continue;
          this.executeTerrainPatchCommand("World Builder: Apply Pads", landscapeId, document, patches);
          applied += own.length;
          tiles += patches.length;
        } finally {
          streaming?.release(keys);
        }
      }
      const rest = skipped > 0 ? `; ${skipped} off the terrain or on a locked one were skipped` : "";
      this.onStatus?.(applied > 0 ? `Pads applied: ${applied} pads on ${tiles} tiles${rest}.` : `No pad changed the terrain${rest}.`, applied > 0 ? "success" : "warning");
    } catch (error) {
      this.onStatus?.(`Pads failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      this.worldTerrainSplineBusy = false;
    }
  }

  /** The level's loaded World Terrains as World Builder stages read them. */
  private worldBuilderTerrains(): StageTerrain[] {
    return (this.layout?.landscapes ?? []).flatMap((actor) => {
      const def = this.worldTerrains.get(actor.id)?.def;
      if (!def) return [];
      const [width, depth] = worldTerrainExtent(def);
      return [{
        id: actor.id,
        min: [def.origin[0], def.origin[2]],
        max: [def.origin[0] + width, def.origin[2] + depth],
        layers: def.layers.map((layer) => ({ id: layer.id, name: layer.name })),
        splines: def.splines ?? [],
        locked: actor.locked === true,
      }];
    });
  }

  /**
   * Writes one side of a World Builder stage's spline changes: each touched
   * terrain's whole spline list, then its spline meshes, overlay and rivers —
   * the `applySelectedLandscapeSplines` path without touching the selection or
   * the active tool. The definition is marked dirty, so Save writes it.
   */
  private applyWorldBuilderSplineChanges(changes: readonly TerrainSplineChange[], side: "before" | "after"): void {
    let changed = false;
    for (const change of changes) {
      const index = this.layout?.landscapes?.findIndex((actor) => actor.id === change.landscapeId) ?? -1;
      const data = this.landscapeSplineSource(change.landscapeId);
      if (index < 0 || !data) continue;
      // Both sides are copies of the definition's own list, frames included.
      data.splines = structuredClone(change[side]);
      this.markLandscapeSplineDirty(change.landscapeId);
      void this.rebuildLandscapeSplineMeshes(index);
      this.refreshLandscapeSplineOverlay(index);
      changed = true;
    }
    if (!changed) return;
    void this.buildRiverWaters();
    this.emitSceneObjectsChanged();
  }

  /** World-space height of any World Terrain at X/Z, or null off-terrain / over a tile not loaded. */
  private worldTerrainHeightAt(x: number, z: number): number | null {
    for (const document of this.worldTerrains.values()) {
      const height = terrainHeightAt(document.def, { tile: (tileX, tileZ) => document.tiles.get(tileKey(tileX, tileZ)) }, x, z);
      if (height !== null) return height;
    }
    return null;
  }

  private removeInstancePlacement(assetId: string, placementIndex: number): LayoutPlacement | null {
    if (!this.layout) return null;
    const instance = this.layout.instances.find((entry) => entry.assetId === assetId);
    if (!instance) return null;
    const [removed] = instance.placements.splice(placementIndex, 1);
    this.rebuildInstanceGroup(assetId);
    return removed ? clonePlacement(removed) : null;
  }

  /**
   * Re-places one placement inside its live instance group without rebuilding
   * it, so a gizmo drag step costs one matrix instead of the whole asset group.
   * Clone routing and probe coverage stay as built; the drag commit rebuilds the
   * group and settles them. False when the group can't be patched.
   */
  private moveInstancePlacementInPlace(assetId: string, placementIndex: number): boolean {
    const placement = this.layout?.instances.find((entry) => entry.assetId === assetId)?.placements[placementIndex];
    if (!placement) return false;
    const matrix = composePlacementMatrix(placement);
    const separate = this.markerObjects.get(assetId)?.[placementIndex]
      ?? this.instanceOverrideObjects.get(assetId)?.find((object) => object.userData.placementIndex === placementIndex);
    if (separate) {
      separate.matrix.copy(matrix);
      separate.matrixWorldNeedsUpdate = true;
      return true;
    }
    const meshes = this.instanceMeshes.get(assetId);
    if (!meshes || meshes.length === 0 || meshes.some((mesh) => placementIndex >= mesh.count)) return false;
    // A hidden placement keeps its collapsed matrix; there is nothing to move.
    if (placement.hidden) return true;
    const instanceMatrix = new Matrix4();
    for (const mesh of meshes) {
      const source = mesh.userData.sourceMatrix;
      instanceMatrix.copy(matrix);
      if (source instanceof Matrix4) instanceMatrix.multiply(source);
      mesh.setMatrixAt(placementIndex, instanceMatrix);
      mesh.instanceMatrix.needsUpdate = true;
      // Picking recomputes these lazily from the moved instance.
      mesh.boundingBox = null;
      mesh.boundingSphere = null;
    }
    return true;
  }

  private refreshSelectionObject(selection: Selection): void {
    if (selection.kind === "instance") {
      if (this.pointerDrag && this.moveInstancePlacementInPlace(selection.assetId, selection.placementIndex)) return;
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
  /**
   * Class-declared variables for the selected actor, resolved against this
   * placement's overrides. Empty when the selection is not an actor or its class
   * declares no variables.
   *
   * The class is read from `actorClassCache`, which is populated before any
   * placement command runs; an unresolved class simply has no variables to show
   * rather than blocking the rest of the Details panel.
   */
  getSelectedActorVariables(): ActorVariableView[] {
    if (!this.selection || this.selection.kind !== "actor") return [];
    const instance = this.layout?.actors?.[this.selection.index];
    if (!instance) return [];
    const def = this.actorClassCache.get(instance.classRef);
    if (!def || def.variables.length === 0) return [];
    const resolved = resolveActorInstanceVariables(def, instance.variableOverrides);
    return def.variables.map((field) => ({
      field,
      value: resolved[field.key],
      overridden: instance.variableOverrides?.[field.key] !== undefined,
    }));
  }

  /**
   * Writes one instance variable override on the selected actor with undo/redo.
   *
   * `undefined` clears the override so the placement falls back to the class
   * default — the same "save only meaningful deviations" contract
   * {@link setSelectionMetadata} follows. The actor entity is rebuilt so the
   * flattened `ScriptActor.variables` the runtime reads stay in step with what
   * the panel shows.
   */
  setSelectedActorVariable(key: string, value: MetadataValue | undefined): void {
    if (!this.layout || !this.selection || this.selection.kind !== "actor") return;
    const index = this.selection.index;
    const actor = this.layout.actors?.[index];
    if (!actor || actor.locked) return;
    const before = cloneActorInstance(actor);
    const after = cloneActorInstance(actor);
    const overrides = { ...(after.variableOverrides ?? {}) };
    if (value === undefined) delete overrides[key];
    else overrides[key] = value;
    if (Object.keys(overrides).length > 0) after.variableOverrides = overrides;
    else delete after.variableOverrides;
    const apply = (next: LayoutActorInstance): void => {
      if (!this.layout?.actors) return;
      this.layout.actors[index] = cloneActorInstance(next);
      this.rebuildActorObject(index);
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: `Set ${key}`,
      redo: () => apply(after),
      undo: () => apply(before),
    });
  }

  /** Re-flattens one placed actor so its render object matches the layout entry. */
  private rebuildActorObject(index: number): void {
    const instance = this.layout?.actors?.[index];
    if (!instance) return;
    const def =
      this.actorClassCache.get(instance.classRef) ??
      normalizeActorScriptDef({}, instance.classRef);
    const previous = this.actorObjects[index];
    const object = this.buildActorObject(actorInstanceToEntity(def, instance, index));
    object.userData.actorIndex = index;
    this.applyWireframeToLevelObject(object);
    if (previous) previous.removeFromParent();
    this.actorObjects[index] = object;
    this.scene.add(object);
  }

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
  async addActorAt(
    classRef: string,
    clientX: number,
    clientY: number,
    options: { fallbackToCamera?: boolean } = {},
  ): Promise<void> {
    if (!this.layout) return;
    const hit = this.picker.clientToSurface(clientX, clientY);
    const point = hit
      ? [hit.x, hit.y, hit.z]
      : options.fallbackToCamera ? this.defaultActorPosition(6) : null;
    if (!point) return;
    const def = await this.resolveActorClass(classRef);
    const instance: LayoutActorInstance = {
      classRef,
      position: [
        snapValue(point[0]!, this.snapSettings.move, this.snapSettings.moveEnabled),
        round(point[1]!),
        snapValue(point[2]!, this.snapSettings.move, this.snapSettings.moveEnabled),
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

  /**
   * Places an actor class on the surface under the viewport centre (Add Actor
   * click), or in front of the camera when nothing is under it.
   */
  async addActorAtViewportCenter(classRef: string): Promise<void> {
    const rect = this.canvas.getBoundingClientRect();
    await this.addActorAt(classRef, rect.left + rect.width / 2, rect.top + rect.height / 2, {
      fallbackToCamera: true,
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
    this.applyShadowMapSize(record.light);
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
  addReflectiveSurface(position: Vec3 = [0, 0.01, 0]): void {
    if (!this.layout) return;
    const surfaces = this.layout.reflectiveSurfaces ?? [];
    const actor: LayoutReflectiveSurface = {
      id: uniqueReflectiveSurfaceId(surfaces),
      name: uniqueReflectiveSurfaceName("Reflective Surface", surfaces),
      position: [...position],
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
      navigationRole?: NavigationRole;
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
    if (patch.navigationRole !== undefined) next.navigationRole = patch.navigationRole;

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
    navigationRole?: NavigationRole;
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
    this.scene.add(tagSceneSource(overlay, EDITOR_OVERLAY_SOURCE));
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
          cache,
          ...(outer.userData.splineSharedMaterials ? { sharedMaterials: outer.userData.splineSharedMaterials as Map<Material, Material> } : {}),
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

  /**
   * The selected placement's class `Vehicle` props (as authored, asset
   * unexpanded) and its own overrides, or null when the class has no Vehicle
   * (or is not loaded yet).
   */
  getSelectedActorVehicle(): {
    classProps: Record<string, SceneJsonValue>;
    overrides: VehicleOverrides | undefined;
  } | null {
    if (!this.selection || this.selection.kind !== "actor") return null;
    const instance = this.layout?.actors?.[this.selection.index];
    if (!instance) return null;
    const node = this.actorClassCache.get(instance.classRef)?.components
      .find((component) => component.component === VEHICLE_COMPONENT);
    if (!node) return null;
    const overrides = cloneActorInstance(instance).vehicleOverrides;
    return { classProps: { ...node.props }, overrides };
  }

  /** Replaces the selected placement's vehicle overrides with undo/redo; empty clears them. */
  setSelectedActorVehicleOverrides(overrides: VehicleOverrides | undefined): void {
    if (!this.layout || !this.selection || this.selection.kind !== "actor") return;
    const index = this.selection.index;
    const actor = this.layout.actors?.[index];
    if (!actor || actor.locked) return;
    const before = cloneActorInstance(actor);
    const after = cloneActorInstance(actor);
    if (overrides && Object.keys(overrides).length > 0) after.vehicleOverrides = overrides;
    else delete after.vehicleOverrides;
    const apply = (next: LayoutActorInstance): void => {
      if (!this.layout?.actors) return;
      this.layout.actors[index] = cloneActorInstance(next);
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: "Edit Vehicle Overrides",
      redo: () => apply(after),
      undo: () => apply(before),
    });
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

  /** Render inputs of a World Terrain actor; placement comes from its definition. */
  private worldTerrainItem(actor: LayoutLandscape, document: WorldTerrainDocument): WorldTerrainRenderItem {
    const layers = document.def.layers;
    return {
      ...resolveLandscape(actor),
      document,
      terrainRef: actor.id,
      viewMode: this.landscapeSculptSettings.viewMode,
      activeLayerId: this.landscapeSculptSettings.activeLayerId,
      layerColors: this.resolveLandscapeLayerColors(layers),
      layerTextures: this.resolveLandscapeLayerTextures(layers, worldTerrainExtent(document.def)[0]),
    };
  }

  /** The scene object for a landscape actor, drawn from its World Terrain tiles. */
  private createLandscapeObjectFor(actor: LayoutLandscape): LandscapeObject {
    const world = this.worldTerrains.get(actor.id);
    if (!world) throw new Error(`Landscape ${actor.id} has no World Terrain loaded`);
    return createWorldTerrainObject(this.worldTerrainItem(actor, world));
  }

  /** Whatever backs a landscape actor in memory, for delete/undo round trips. */
  private terrainActorDocument(id: string): TerrainActorDocument | null {
    const world = this.worldTerrains.get(id);
    return world ? { kind: "world", document: world } : null;
  }

  /** The multi-tile World Terrain behind a landscape index, if that is what it references. */
  private worldTerrainAt(index: number): WorldTerrainDocument | null {
    const actor = this.layout?.landscapes?.[index];
    return actor ? this.worldTerrains.get(actor.id) ?? null : null;
  }

  private isWorldTerrainSelection(selection: Selection | null): boolean {
    return selection?.kind === "landscape" && this.worldTerrainAt(selection.index) !== null;
  }

  /**
   * Why the selection's transform cannot change right now, or null. A World
   * Terrain is placed by its definition's origin and cannot rotate; moving it
   * would need a definition save, which this build does not write.
   */
  private transformBlockedReason(selection: Selection): string | null {
    if (this.isSelectionLocked(selection)) return "Selected object is locked.";
    return null;
  }

  /** A World Terrain moves but never rotates or scales, so only the move gizmo acts on it. */
  private gizmoBlockedReason(selection: Selection): string | null {
    const blocked = this.transformBlockedReason(selection);
    if (blocked) return blocked;
    if (this.isWorldTerrainSelection(selection) && (this.activeTool === "rotate" || this.activeTool === "scale")) {
      return "A Landscape can only be moved; rotating or scaling it is not supported.";
    }
    return null;
  }

  /** UV repeat count so each layer texture tiles roughly every ~8 world units. */
  private landscapeLayerTiling(worldSize: number): number {
    return Math.min(128, Math.max(1, Math.round(worldSize / 8)));
  }

  /**
   * Builds the layerId→hex tint map for a landscape from its layers' assigned
   * materials, reading cached base colors (populated by `warmLandscapeLayerMaterials`).
   * Layers with no material — or whose color hasn't loaded yet — are omitted so the
   * render binding falls back to the preset swatch.
   */
  private resolveLandscapeLayerColors(layers: readonly { id: string; material?: string | null }[]): LandscapeLayerColors {
    const colors: LandscapeLayerColors = {};
    for (const layer of layers) {
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
  private resolveLandscapeLayerTextures(
    layers: readonly { id: string; color?: string; material?: string | null }[],
    worldSize: number,
  ): LandscapeLayerTexture[] {
    const tiling = this.landscapeLayerTiling(worldSize);
    const presetById = new Map(LANDSCAPE_DEFAULT_LAYERS.map((preset) => [preset.id as string, preset]));
    return layers.map((layer) => {
      const presetColor = layer.color ?? presetById.get(layer.id)?.color ?? LANDSCAPE_DEFAULT_LAYERS[0]!.color;
      const cached = layer.material ? this.landscapeLayerMaterialCache.get(layer.material) : undefined;
      return {
        id: layer.id,
        texture: cached?.texture ?? null,
        normalTexture: cached?.normalTexture ?? null,
        ...(cached?.textureScale ? { textureScale: cached.textureScale } : {}),
        color: cached?.baseColor ?? presetColor,
        roughness: cached?.roughness ?? 1,
        roughnessInAlpha: cached?.roughnessInAlpha ?? false,
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
    const layers = actor ? this.worldTerrains.get(actor.id)?.def.layers : null;
    if (!actor || !layers) return;
    const manifest = this.manifest;
    if (!manifest) return;
    const pending = layers
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
    const object = this.createLandscapeObjectFor(actor);
    this.applyWireframeToLevelObject(object);
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
    this.refreshRiverWaterFoamOverlay(index);
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
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    const source = document?.def;
    const previous = this.landscapeSplineMeshGroups[index];
    if (previous) {
      disposeLandscapeSplineMeshGroup(previous);
      this.landscapeSplineMeshGroups[index] = null;
    }
    if (!actor || !object || !document || !source) return;
    const build = (this.landscapeSplineMeshBuilds.get(object) ?? 0) + 1;
    this.landscapeSplineMeshBuilds.set(object, build);
    const current = () => this.landscapeObjects[index] === object && Boolean(object.parent)
      && this.landscapeSplineMeshBuilds.get(object) === build;
    const assetIds = landscapeSplineMeshAssetIds(source);
    if (assetIds.length === 0) return;
    try {
      await Promise.all(assetIds.map((assetId) => this.ensureAssetLoaded(assetId)));
      // The landscape object may have been rebuilt/removed while assets loaded.
      if (!current()) return;
      const data = await prepareTerrainSplineMeshSource(document, async (key) => {
        const path = terrainTilePath(actor.dataRef, key);
        const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return validateTerrainTile(document.def, key, new Uint8Array(await response.arrayBuffer()));
      });
      if (!current()) return;
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
      this.applyWireframeToLevelObject(built.group);
      this.landscapeSplineMeshGroups[index] = built.group;
    } catch (error) {
      if (current()) this.onStatus?.(`Spline mesh failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }
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
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
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
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    if (document) overlay.position.set(...worldTerrainActorPosition(document.def)).negate();
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

  /** Rebuilds the selected river's Radial Foam gizmo markers in the editor viewport. */
  private refreshRiverWaterFoamOverlay(index: number | undefined): void {
    if (index === undefined) return;
    const object = this.landscapeObjects[index];
    const landscape = this.layout?.landscapes?.[index];
    if (!object || !landscape) return;
    const existing = object.getObjectByName("river-water-foam-overlay");
    if (existing instanceof Group) this.disposeSplineOverlayGroup(existing);
    // Manual foam markers are retired; old serialized stamps remain untouched.
  }

  private refreshAllRiverWaterFoamOverlays(): void {
    for (let index = 0; index < this.landscapeObjects.length; index += 1) {
      this.refreshRiverWaterFoamOverlay(index);
    }
  }

  /**
   * Rebuilds every landscape mesh from `layout.landscapes` (used on load). Also
   * fetches each landscape's `dataRef` sidecar (public-root-relative), falling
   * back to a flat Medium heightfield if the sidecar can't be read yet (e.g. a
   * freshly authored landscape whose sidecar hasn't been saved).
   */
  private async buildLandscapes(): Promise<void> {
    this.lakes?.dispose(); this.lakeDraft = null; this.lakePick = null; this.lakePendingSelection = null;
    if (this.lakeTimer) { clearTimeout(this.lakeTimer); this.lakeTimer = null; }
    this.riverWaterBuild += 1;
    for (const object of this.landscapeObjects) {
      this.scene.remove(object);
      disposeLandscapeObject(object);
    }
    this.landscapeObjects = [];
    this.landscapeSplineMeshGroups = [];
    this.landscapeSplineOverlays = [];
    this.worldTerrains.clear();
    for (const streaming of this.worldTerrainStreams.values()) streaming.dispose();
    this.worldTerrainStreams.clear();
    const landscapes = this.layout?.landscapes ?? [];
    for (const actor of landscapes) {
      const loaded = await this.fetchLandscapeDocument(actor);
      this.adoptWorldTerrain(actor, loaded.document);
    }
    landscapes.forEach((actor, index) => {
      const object = this.createLandscapeObjectFor(actor);
      this.applyWireframeToLevelObject(object);
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
      this.refreshRiverWaterFoamOverlay(index);
    });
  }

  /**
   * Builds the visual River Water Body ribbons after their Landscape sidecars are
   * resident. This is presentation-only: water is excluded from picking and never
   * creates a collider or navigation rule.
   */
  private lakeDocument(id: string): WorldTerrainDocument | undefined {
    return this.worldTerrains.get(id);
  }

  private lakeController(): LakeWaterController {
    return this.lakes ??= new LakeWaterController({ scene: this.scene, editor: true, reflections: this.waterReflections,
      quality: lakeQuality(this.editorQuality),
      document: (id) => this.lakeDocument(id),
      load: async (id, key, signal) => {
        const actor = this.layout?.landscapes?.find((a) => a.id === id), document = this.lakeDocument(id);
        if (!actor || !document) throw new Error("Missing Lake terrain");
        const response = await fetch(projectFileUrl(terrainTilePath(actor.dataRef, key)), { ...(signal ? { signal } : {}), cache: "no-cache" });
        if (!response.ok) throw new Error(`Lake tile ${key}: HTTP ${response.status}`);
        return validateTerrainTile(document.def, key, new Uint8Array(await response.arrayBuffer()));
      }, normal: (id) => this.loadRiverWaterNormalTexture(id),
      changed: () => { if (this.lakeDraft || this.selection?.kind === "lake") this.emitSelectionChanged(); },
    });
  }

  private rebuildLakes(delay = 0): void {
    this.lakes?.invalidate();
    if (this.lakeTimer) clearTimeout(this.lakeTimer);
    const work = () => {
      this.lakeTimer = null;
      const bodies = [...(this.layout?.waterBodies ?? []), ...(this.lakeDraft ? [this.lakeDraft] : [])];
      if (!bodies.length && !this.lakes) return;
      const controller = this.lakeController();
      controller.select(this.lakeDraft?.id ?? (this.selection?.kind === "lake" ? this.layout?.waterBodies?.[this.selection.index]?.id ?? null : null));
      void controller.rebuild(bodies);
    };
    if (delay) this.lakeTimer = setTimeout(work, delay); else work();
  }

  private updateLakesForTerrainPatches(id: string, patches: readonly TerrainUndoPatch[]): void {
    const document = this.lakeDocument(id); if (!document) return;
    const bodies = [...(this.layout?.waterBodies ?? []), ...(this.lakeDraft ? [this.lakeDraft] : [])].filter((w) => w.terrainRef === id);
    if (!bodies.length) return;
    const { def } = document, q = def.tileQuads, s = def.spacing;
    for (const patch of patches) {
      if (!patch.before.heights.some((v, i) => v !== patch.after.heights[i])) continue;
      const [tx, tz] = patch.key.split("_").map(Number) as [number, number];
      // A vertex also influences the adjacent terrain triangles, including across a seam.
      const minX = def.origin[0] + (tx * q + patch.rect.x0 - 1) * s;
      const maxX = def.origin[0] + (tx * q + patch.rect.x1 + 1) * s;
      const minZ = def.origin[2] + (tz * q + patch.rect.z0 - 1) * s;
      const maxZ = def.origin[2] + (tz * q + patch.rect.z1 + 1) * s;
      if (bodies.some((w) => maxX >= w.bounds.min[0] && minX <= w.bounds.max[0] && maxZ >= w.bounds.min[1] && minZ <= w.bounds.max[1])) {
        this.rebuildLakes(); return;
      }
    }
  }

  private lakeFoamFingerprint(lake: LayoutLakeWaterBody): string {
    const document=this.worldTerrains.get(lake.terrainRef);
    return foamFingerprint(JSON.stringify({instances:this.layout?.instances,level:lake.surfaceLevel,bounds:lake.bounds,seed:lake.seed,
      width:lake.geometryFoam?.width??defaultLakeGeometryFoam().width,terrain:document?.def,
      wet:this.lakes?.results.get(lake.id)?wetFoamFingerprint(this.lakes.results.get(lake.id)!):null}));
  }

  getLakeGeometryFoamState() {
    const lake=this.getLakeEditorState().source,job=this.lakeFoamJob;
    if(!lake)return {busy:false,message:"",stale:false,ready:false};
    const settings=lake.geometryFoam,busy=job?.id===lake.id;
    const stale=!!settings?.bake&&settings.bake.fingerprint!==this.lakeFoamFingerprint(lake);
    const ready=this.lakes?.results.get(lake.id)?.status==="ready"&&this.lakes.objects.has(lake.id);
    return {busy,ready,message:busy?job.progress:!ready?"Preparing water surface":this.lakes?.foamErrors.get(lake.id)??this.lakeFoamMessages.get(lake.id)??(stale?"Recalculation required":settings?.bake?"Ready":"Not calculated"),stale};
  }

  cancelLakeGeometryFoam(): void {this.lakeFoamJob?.controller.abort();}
  clearLakeGeometryFoam(): void {
    this.lakeFoamJob?.controller.abort();
    const lake=this.getLakeEditorState().source;if(!lake||lake.locked)return;
    const settings={...(lake.geometryFoam??defaultLakeGeometryFoam())};delete settings.bake;
    this.lakeFoamMessages.delete(lake.id);this.editLake({geometryFoam:settings});
  }

  async calculateLakeGeometryFoam(): Promise<void> {
    const state=this.getLakeEditorState(),lake=state.source,layout=this.layout,controller=this.lakes;
    if(!lake||lake.locked||state.draft||this.lakeFoamJob||this.riverFoamJob||!layout||!controller)return;
    const wet=controller.results.get(lake.id);if(wet?.status!=="ready"){this.onStatus?.("Lake surface must be ready before calculating foam","warning");return;}
    const levelPath=this.activeProject?.manifest.editor.defaultScene;if(!levelPath)return;
    const job={id:lake.id,controller:new AbortController(),progress:"Collecting geometry"};this.lakeFoamJob=job;this.emitSelectionChanged();
    try {
      const fingerprint=this.lakeFoamFingerprint(lake);
      const sources:ReturnType<typeof foamSource>[]=[],versions:string[]=[];
      const document=this.worldTerrains.get(lake.terrainRef),terrainRevision=document?this.worldTerrainSessions.get(document)?.editRevision??0:0;
      let collectionTick=performance.now();
      for(const group of layout.instances) {
        if(group.assetId.startsWith("marker:")||/character|vehicle|foliage|vegetation|grass|plant|tree/i.test(this.assetCategory(group.assetId)))continue;
        const visible=group.placements.filter(p=>!p.hidden);if(!visible.length)continue;
        if(!this.models.has(group.assetId)&&!await this.ensureAssetLoaded(group.assetId))throw new Error(`Missing geometry: ${group.assetId}`);
        if(job.controller.signal.aborted)throw new DOMException("Cancelled","AbortError");
        const model=this.models.get(group.assetId);if(!model)throw new Error(`Missing geometry: ${group.assetId}`);
        const width=lake.geometryFoam?.width??defaultLakeGeometryFoam().width;
        const localBounds=this.localBounds.get(group.assetId)??new Box3().setFromObject(model.scene);
        for(const [index,placement] of group.placements.entries()) if(!placement.hidden) {
          const matrix=composePlacementMatrix(placement),bounds=localBounds.clone().applyMatrix4(matrix);
          if(bounds.max.x>=lake.bounds.min[0]-width&&bounds.min.x<=lake.bounds.max[0]+width&&bounds.max.z>=lake.bounds.min[1]-width&&bounds.min.z<=lake.bounds.max[1]+width&&bounds.min.y<=lake.surfaceLevel&&bounds.max.y>=lake.surfaceLevel) {
            const source=foamSource(`${group.assetId}:${index}`,model.scene,matrix);sources.push(source);
            for(const part of source.parts)versions.push(`${part.geometry.uuid}:${(part.geometry.getAttribute("position") as {version?:number})?.version??0}:${part.geometry.index?.version??0}`);
          }
          if(sources.length>4096)throw new Error("over-budget: Lake foam source count exceeds 4096");
          if(performance.now()-collectionTick>3){await new Promise<void>(resolve=>setTimeout(resolve,0));collectionTick=performance.now();if(job.controller.signal.aborted)throw new DOMException("Cancelled","AbortError");}
        }
      }
      let updated=0;
      const data=await bakeLakeGeometryFoam(lake,wet,sources,lake.geometryFoam?.width??defaultLakeGeometryFoam().width,fingerprint,job.controller.signal,text=>{
        job.progress=text;if(performance.now()-updated>200){updated=performance.now();this.emitSelectionChanged();}
      });
      const current=this.layout?.waterBodies?.find(w=>w.id===lake.id);
      const currentVersions=sources.flatMap(s=>s.parts.map(p=>`${p.geometry.uuid}:${(p.geometry.getAttribute("position") as {version?:number})?.version??0}:${p.geometry.index?.version??0}`));
      if(job.controller.signal.aborted)throw new DOMException("Cancelled","AbortError");
      if(this.layout!==layout||!current||current.locked||this.getLakeEditorState().source?.id!==lake.id||this.lakeFoamFingerprint(current)!==fingerprint||versions.join("|")!==currentVersions.join("|")||(document?this.worldTerrainSessions.get(document)?.editRevision??0:0)!==terrainRevision)throw new Error("Source changed; calculate foam again");
      const bake=await controller.foam.stage(levelPath,encodeLakeFoam(data));
      const latest=this.layout?.waterBodies?.find(w=>w.id===lake.id);
      if(job.controller.signal.aborted||this.layout!==layout||!latest||latest.locked||this.getLakeEditorState().source?.id!==lake.id||this.lakeFoamFingerprint(latest)!==fingerprint||(document?this.worldTerrainSessions.get(document)?.editRevision??0:0)!==terrainRevision) {
        if(!this.layout?.waterBodies?.some(w=>w.geometryFoam?.bake?.manifest===bake.manifest))controller.foam.discard(bake.manifest);
        throw new Error("Source changed; calculate foam again");
      }
      this.editLake({geometryFoam:{...(latest.geometryFoam??defaultLakeGeometryFoam()),bake}});
      this.lakeFoamMessages.set(lake.id,`${data.metadata.sources} objects, ${data.metadata.segments} segments, ${(data.metadata.milliseconds/1000).toFixed(2)} s`);
      this.onStatus?.("Lake geometry foam calculated. Save to keep this result.","success");
    } catch(error) {
      const message=job.controller.signal.aborted?"Cancelled; previous foam preserved":String(error);
      this.lakeFoamMessages.set(lake.id,message);this.onStatus?.(message,"warning");
    } finally {if(this.lakeFoamJob===job)this.lakeFoamJob=null;this.emitSelectionChanged();}
  }

  private selectedRiverFoam(id:string) {
    if(this.selection?.kind!=="landscape")return null;
    const terrain=this.layout?.landscapes?.[this.selection.index];
    const waters=this.layout?.riverWaters?.filter(w=>w.landscapeRef===terrain?.id)??[];
    // Match the Water panel's first-river fallback after Reload or terrain selection.
    const water=waters.find(w=>w.id===this.landscapeSculptSettings.activeRiverWaterId)??waters[0];
    return water?.id===id&&terrain&&!terrain.locked&&!water.locked?water:null;
  }
  private riverGeometryFingerprint(id:string):string {
    const water=this.layout?.riverWaters?.find(w=>w.id===id),document=water?this.worldTerrains.get(water.landscapeRef):undefined;
    const object=this.riverWaterObjects.find(o=>o.userData.riverWaterId===id);
    const instances=this.layout?.instances.map(g=>({assetId:g.assetId,placements:g.placements.map(p=>({matrix:composePlacementMatrix(p).elements,hidden:p.hidden===true}))}));
    return foamFingerprint(JSON.stringify({instances,spline:document?.def.splines?.find(s=>s.id===water?.splineRef),
      surface:object?riverFoamSurfaceFingerprint(object.getSurface()):null,width:water?.geometryFoam?.width??defaultLakeGeometryFoam().width}));
  }
  getRiverGeometryFoamState(id:string) {
    const water=this.layout?.riverWaters?.find(w=>w.id===id),job=this.riverFoamJob,busy=job?.id===id;
    let stale=false,message="Not calculated";
    try {stale=!!water?.geometryFoam?.bake&&water.geometryFoam.bake.fingerprint!==this.riverGeometryFingerprint(id);}
    catch(error){message=String(error);}
    if(water?.geometryFoam?.bake)message=stale?"Recalculation required":"Ready";
    const object=this.riverWaterObjects.find(o=>o.userData.riverWaterId===id);
    return {busy,stale,ready:!!object,message:busy?job.progress:!object?"Preparing water surface":this.riverFoamMessages.get(id)??object.effectErrors[0]??message};
  }
  cancelRiverGeometryFoam():void {this.riverFoamJob?.controller.abort();}
  clearRiverGeometryFoam(id:string):void {
    const water=this.selectedRiverFoam(id);if(!water)return;
    this.cancelRiverGeometryFoam();const settings={...(water.geometryFoam??defaultLakeGeometryFoam())};delete settings.bake;
    this.riverFoamMessages.delete(id);this.setSelectedLandscapeRiverWater(id,{geometryFoam:settings});
  }
  async calculateRiverGeometryFoam(id:string):Promise<void> {
    const water=this.selectedRiverFoam(id),layout=this.layout,object=this.riverWaterObjects.find(o=>o.userData.riverWaterId===id);
    const level=this.activeProject?.manifest.editor.defaultScene;
    if(!water||!layout||!object||!level||this.riverFoamJob||this.lakeFoamJob)return;
    const job={id,controller:new AbortController(),progress:"Collecting geometry"};this.riverFoamJob=job;this.emitSelectionChanged();
    try {
      const surface=object.getSurface(),fingerprint=this.riverGeometryFingerprint(id),width=water.geometryFoam?.width??defaultLakeGeometryFoam().width;
      const document=this.worldTerrains.get(water.landscapeRef),revision=document?this.worldTerrainSessions.get(document)?.editRevision??0:0;
      const sources:ReturnType<typeof foamSource>[]=[],versions:string[]=[];
      let tick=performance.now();
      for(const group of layout.instances) {
        if(group.assetId.startsWith("marker:")||/character|vehicle|foliage|vegetation|grass|plant|tree/i.test(this.assetCategory(group.assetId))||!group.placements.some(p=>!p.hidden))continue;
        if(!this.models.has(group.assetId)&&!await this.ensureAssetLoaded(group.assetId))throw new Error(`Missing geometry: ${group.assetId}`);
        if(job.controller.signal.aborted)throw new DOMException("Cancelled","AbortError");
        const model=this.models.get(group.assetId);if(!model)throw new Error(`Missing geometry: ${group.assetId}`);
        const localBounds=this.localBounds.get(group.assetId)??new Box3().setFromObject(model.scene);
        for(const [index,placement] of group.placements.entries())if(!placement.hidden) {
          const matrix=composePlacementMatrix(placement),b=localBounds.clone().applyMatrix4(matrix),o=surface.origin;
          if(b.max.x>=surface.min[0]+o[0]-width&&b.min.x<=surface.max[0]+o[0]+width&&b.max.z>=surface.min[1]+o[2]-width&&b.min.z<=surface.max[1]+o[2]+width&&b.max.y>=surface.levels[0]+o[1]&&b.min.y<=surface.levels[1]+o[1]) {
            const source=foamSource(`${group.assetId}:${index}`,model.scene,matrix);sources.push(source);
            for(const part of source.parts)versions.push(`${part.geometry.uuid}:${(part.geometry.getAttribute("position") as {version?:number})?.version??0}:${part.geometry.index?.version??0}`);
          }
          if(sources.length>4096)throw new Error("over-budget: River foam source count exceeds 4096");
          if(performance.now()-tick>3){await new Promise<void>(resolve=>setTimeout(resolve,0));tick=performance.now();if(job.controller.signal.aborted)throw new DOMException("Cancelled","AbortError");}
        }
      }
      let updated=0;
      const data=await bakeRiverGeometryFoam(surface,sources,width,fingerprint,job.controller.signal,text=>{job.progress=text;if(performance.now()-updated>200){updated=performance.now();this.emitSelectionChanged();}});
      const current=()=>this.layout===layout&&this.selectedRiverFoam(id)&&this.riverWaterObjects.includes(object)&&!job.controller.signal.aborted&&
        this.riverGeometryFingerprint(id)===fingerprint&&(document?this.worldTerrainSessions.get(document)?.editRevision??0:0)===revision&&
        versions.join("|")===sources.flatMap(s=>s.parts.map(p=>`${p.geometry.uuid}:${(p.geometry.getAttribute("position") as {version?:number})?.version??0}:${p.geometry.index?.version??0}`)).join("|");
      if(!current())throw new Error("Source changed; calculate foam again");
      const bake=await this.riverFoam.stage(level,encodeLakeFoam(data));
      if(!current()){this.riverFoam.discard(bake.manifest);throw new Error("Source changed; calculate foam again");}
      this.setSelectedLandscapeRiverWater(id,{geometryFoam:{...(this.selectedRiverFoam(id)!.geometryFoam??defaultLakeGeometryFoam()),bake}});
      this.riverFoamMessages.set(id,`${data.metadata.sources} objects, ${data.metadata.segments} segments, ${(data.metadata.milliseconds/1000).toFixed(2)} s`);
      this.onStatus?.("River geometry foam calculated. Save to keep this result.","success");
    }catch(error){const message=job.controller.signal.aborted?"Cancelled; previous foam preserved":String(error);this.riverFoamMessages.set(id,message);this.onStatus?.(message,"warning");}
    finally{if(this.riverFoamJob===job)this.riverFoamJob=null;this.emitSelectionChanged();}
  }

  getLakeEditorState() {
    const source = this.lakeDraft ?? (this.selection?.kind === "lake" ? this.layout?.waterBodies?.[this.selection.index] : undefined);
    const actor = this.selection?.kind === "landscape" ? this.layout?.landscapes?.[this.selection.index] : undefined;
    return { source: source ? structuredClone(source) : null, result: source ? this.lakes?.results.get(source.id) ?? null : null,
      leaving: !!this.lakePendingSelection,
      draft: !!this.lakeDraft, picking: !!this.lakePick, available: !!(actor && !actor.locked && this.lakeDocument(actor.id)) };
  }

  /** Context shared by the Landscape water panel and a selected Lake inspector. */
  getWaterSystemContext() {
    const lake = this.getLakeEditorState();
    const terrainId = lake.source?.terrainRef ?? this.lakePick?.terrainRef;
    const index = this.selection?.kind === "landscape" ? this.selection.index
      : this.layout?.landscapes?.findIndex((actor) => actor.id === terrainId) ?? -1;
    const terrain = this.layout?.landscapes?.[index];
    if (!terrain) return null;
    const rivers = (this.layout?.riverWaters ?? []).filter((water) => water.landscapeRef === terrain.id);
    const activeRiver = rivers.find((water) => water.id === this.landscapeSculptSettings.activeRiverWaterId) ?? rivers[0];
    return {
      index, name: terrain.name ?? terrain.id, locked: !!terrain.locked,
      busy: lake.draft || lake.picking,
      bodies: [
        ...rivers.map((water) => ({ id: water.id, name: water.name ?? water.id, kind: "river" as const,
          active: !lake.source && water.id === activeRiver?.id })),
        ...(this.layout?.waterBodies ?? []).filter((water) => water.terrainRef === terrain.id)
          .map((water) => ({ id: water.id, name: water.name ?? water.id, kind: "lake" as const, active: water.id === lake.source?.id })),
      ],
    };
  }

  selectWaterSystemTerrain(editMode: LandscapeEditMode = "water"): boolean {
    const context = this.getWaterSystemContext();
    if (!context || context.busy) return false;
    this.setLandscapeSculptSettings({ editMode });
    this.select({ kind: "landscape", index: context.index });
    return true;
  }

  selectWaterSystemBody(kind: "river" | "lake", id: string): void {
    const context = this.getWaterSystemContext();
    if (!context || context.busy || !context.bodies.some((body) => body.kind === kind && body.id === id)) return;
    if (kind === "river") {
      this.setLandscapeSculptSettings({ editMode: "water", activeRiverWaterId: id,
        activeRiverWaterFoamStampId: null, activeRiverWaterFoamStampAnchor: null });
      this.select({ kind: "landscape", index: context.index });
    } else {
      const index = this.layout?.waterBodies?.findIndex((water) => water.id === id) ?? -1;
      if (index >= 0) {
        this.setLandscapeSculptSettings({ editMode: "water", riverWaterRingFoamPlacementId: null });
        this.select({ kind: "lake", index });
      }
    }
  }

  beginLakeFill(): void {
    if (this.lakeDraft) return;
    if (this.selection?.kind !== "landscape") return;
    const actor = this.layout?.landscapes?.[this.selection.index];
    if (!actor || actor.locked || !this.lakeDocument(actor.id)) return;
    if ((this.layout?.waterBodies?.length ?? 0) >= LAKE_LIMITS.bodies) { this.onStatus?.("Lake limit: 8 bodies", "warning"); return; }
    this.lakePick = { terrainRef: actor.id, reseed: null }; this.lakeDraft = null;
    this.onStatus?.("Göl: çukurun içine tıklayın. Esc nokta seçimini bitirir.", "info"); this.emitSelectionChanged();
  }

  beginLakeReseed(): void {
    const source = this.getLakeEditorState().source;
    if (!source || source.locked) return;
    this.lakePick = { terrainRef: source.terrainRef, reseed: source.id }; this.emitSelectionChanged();
  }

  cancelLake(): boolean {
    const active = !!(this.lakePick || this.lakeDraft || this.lakeDrag);
    if (!active) return false;
    const next = this.lakePendingSelection;
    this.escapeLake();
    this.lakePendingSelection = next;
    this.lakePick = null; this.lakeDraft = null; this.lakeDrag = null;
    this.rebuildLakes(); this.emitSelectionChanged(); this.completeLakeSelection(); return true;
  }

  /** Escape ends the current gesture, never discards an uncommitted lake. */
  escapeLake(): boolean {
    const gesture = !!(this.lakePick || this.lakeDrag);
    this.lakeSeedAbort.abort();
    const active = !!(this.lakePick || this.lakeDraft || this.lakeDrag);
    this.lakePick = null;
    if (this.lakeDrag) {
      const drag = this.lakeDrag, index = this.layout?.waterBodies?.findIndex((w) => w.id === drag.before.id) ?? -1;
      if (drag.draft) this.lakeDraft = drag.before;
      else if (index >= 0) this.layout!.waterBodies![index] = drag.before;
      if (this.canvas.hasPointerCapture(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
      this.lakeDrag = null; this.rebuildLakes();
    }
    if (this.lakeDraft && !gesture && !this.lakePendingSelection) this.lakePendingSelection = () => this.select(null);
    if (active) this.emitSelectionChanged();
    return active;
  }

  resumeLakeEditing(): void {
    this.lakePendingSelection = null;
    this.emitSelectionChanged();
  }

  finishLakeEditing(): void { this.select(null); }

  private completeLakeSelection(): void {
    const next = this.lakePendingSelection; this.lakePendingSelection = null; next?.();
  }

  private deferLakeSelection(next: () => void): boolean {
    if (!this.lakeDraft) { this.lakeSeedAbort.abort(); this.lakePick = null; return false; }
    this.escapeLake(); this.lakePendingSelection = next; this.emitSelectionChanged(); return true;
  }

  retryLake(): void { this.rebuildLakes(); }

  selectLakeTerrain(): void {
    const source = this.getLakeEditorState().source;
    const index = this.layout?.landscapes?.findIndex((a) => a.id === source?.terrainRef) ?? -1;
    if (index >= 0) this.select({ kind: "landscape", index });
  }

  editLake(patch: Partial<LayoutLakeWaterBody>): void {
    if (this.lakeDraft) {
      try { this.lakeDraft = validateWaterBody({ ...this.lakeDraft, ...patch }); this.rebuildLakes(150); this.emitSelectionChanged(); }
      catch (error) {
        this.onStatus?.(String(error), "warning");
      }
    } else if (this.selection?.kind === "lake") this.setLakeByIndex(this.selection.index, patch);
  }

  private setLakeByIndex(index: number, patch: Partial<LayoutLakeWaterBody>): void {
    const before = this.layout?.waterBodies?.[index];
    if (!before || (before.locked && patch.locked === undefined)) return;
    try {
      const after = validateWaterBody({ ...before, ...patch }), previous = structuredClone(before);
      const apply = (lake: LayoutLakeWaterBody) => {
        const current = this.layout?.waterBodies?.findIndex((w) => w.id === previous.id) ?? -1;
        if (current < 0 || !this.layout?.waterBodies) return;
        this.layout.waterBodies[current] = structuredClone(lake); this.rebuildLakes();
        this.emitSelectionChanged(); this.emitSceneObjectsChanged(); this.scheduleAutoSave();
      };
      this.executeCommand({ label: "Edit Lake", redo: () => apply(after), undo: () => apply(previous) });
    } catch (error) {
      this.onStatus?.(String(error), "warning");
    }
  }

  commitLake(): void {
    const lake = this.lakeDraft;
    if (!lake || this.lakes?.results.get(lake.id)?.status !== "ready") return;
    const before = structuredClone(this.layout?.waterBodies ?? []), after = [...before, structuredClone(lake)];
    this.lakeDraft = null; this.lakePick = null;
    this.executeCommand({ label: "Create Lake", redo: () => this.restoreLakeList(after, lake.id), undo: () => this.restoreLakeList(before) });
    this.completeLakeSelection();
  }

  deleteLake(): void {
    if (this.selection?.kind !== "lake") return;
    const lake = this.layout?.waterBodies?.[this.selection.index]; if (!lake || lake.locked) return;
    const before = structuredClone(this.layout?.waterBodies ?? []), after = before.filter((w) => w.id !== lake.id);
    this.executeCommand({ label: "Delete Lake", redo: () => this.restoreLakeList(after), undo: () => this.restoreLakeList(before, lake.id) });
  }

  private restoreLakeList(bodies: LayoutLakeWaterBody[], selected?: string): void {
    if (!this.layout) return;
    if (bodies.length) this.layout.waterBodies = structuredClone(bodies); else delete this.layout.waterBodies;
    const index = selected ? bodies.findIndex((w) => w.id === selected) : -1;
    this.select(index >= 0 ? { kind: "lake", index } : null); this.rebuildLakes();
    this.emitSceneObjectsChanged(); this.scheduleAutoSave();
  }

  private lakeRay(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.editorViewportCamera());
  }

  private pickLake(clientX: number, clientY: number): { selection: Selection; distance: number } | null {
    if (!this.lakes) return null;
    this.lakeRay(clientX, clientY);
    const mask = this.raycaster.layers.mask; this.raycaster.layers.enable(31);
    const hits = this.raycaster.intersectObjects([...this.lakes.objects.values(), ...this.lakes.helpers.children], true);
    this.raycaster.layers.mask = mask;
    for (const hit of hits) {
      if (!hit.object.visible || !hit.object.parent?.visible) continue;
      const index = this.layout?.waterBodies?.findIndex((w) => w.id === hit.object.userData.waterBodyId && !w.hidden && !w.locked) ?? -1;
      if (index >= 0) return { selection: { kind: "lake", index }, distance: hit.distance };
    }
    return null;
  }

  private beginLakePointer(event: PointerEvent): boolean {
    if (event.altKey || event.button !== 0) return false;
    const picking = this.lakePick;
    if (picking) {
      void this.chooseLakeSeed(event.clientX, event.clientY, picking); return true;
    }
    const source = this.getLakeEditorState().source;
    if (!source || source.locked || !this.lakes) return false;
    this.lakeRay(event.clientX, event.clientY); const mask = this.raycaster.layers.mask; this.raycaster.layers.enable(31);
    const hit = this.raycaster.intersectObjects(this.lakes.helpers.children, true).find((h) => h.object.userData.lakeEdge !== undefined && h.object.parent?.visible);
    this.raycaster.layers.mask = mask;
    if (!hit) return false;
    this.lakeDrag = { before: structuredClone(source), edge: Number(hit.object.userData.lakeEdge), pointerId: event.pointerId, draft: !!this.lakeDraft };
    this.canvas.setPointerCapture(event.pointerId); return true;
  }

  private async chooseLakeSeed(clientX: number, clientY: number, picking: { terrainRef: string; reseed: string | null }): Promise<void> {
    this.lakeSeedAbort.abort(); this.lakeSeedAbort = new AbortController(); const signal = this.lakeSeedAbort.signal;
    const actor = this.layout?.landscapes?.find((a) => a.id === picking.terrainRef), document = this.lakeDocument(picking.terrainRef);
    if (!actor || actor.locked || !document) return;
    this.lakeRay(clientX, clientY); const origin = this.raycaster.ray.origin.toArray() as Vec3, direction = this.raycaster.ray.direction.toArray() as Vec3;
    const tiles = new Map(document.tiles), lookup = { tile: (x: number, z: number) => tiles.get(tileKey(x, z)) };
    try {
      let hit = raycastTerrain(document.def, lookup, origin, direction, Infinity, document.globalAttributes?.map);
      for (let i = 0; hit?.approximate && i < 4; i++) {
        const key = tileKey(hit.tileX, hit.tileZ);
        const response = await fetch(projectFileUrl(terrainTilePath(actor.dataRef, key)), { signal, cache: "no-cache" });
        if (!response.ok) throw new Error(`Lake seed tile ${key}: HTTP ${response.status}`);
        tiles.set(key, validateTerrainTile(document.def, key, new Uint8Array(await response.arrayBuffer())));
        hit = raycastTerrain(document.def, lookup, origin, direction, Infinity, document.globalAttributes?.map);
      }
      if (signal.aborted || this.lakePick !== picking) return;
      if (!hit || hit.approximate) throw new Error("No exact Lake seed hit; move closer and retry");
      const [x, height, z] = hit.point;
      this.lakePick = null;
      if (picking.reseed) this.editLake({ seed: [x, z] });
      else {
        const ids = new Set(this.layout?.waterBodies?.map((w) => w.id)); let i = 1; while (ids.has(`lake-${i}`)) i++;
        const s = document.def.spacing, o = document.def.origin;
        this.lakeDraft = { schema: 1, kind: "lake", mode: "fillExisting", coordinateSpace: "world", terrainRef: actor.id,
          id: `lake-${i}`, name: `Lake ${i}`, seed: [x, z], surfaceLevel: height + 0.5,
          appearance: createLakeAppearance(),
          bounds: { min: [o[0] + Math.floor((x - 32 - o[0]) / s) * s, o[2] + Math.floor((z - 32 - o[2]) / s) * s],
            max: [o[0] + Math.ceil((x + 32 - o[0]) / s) * s, o[2] + Math.ceil((z + 32 - o[2]) / s) * s] } };
        this.rebuildLakes();
      }
      this.emitSelectionChanged();
    } catch (error) { if (!signal.aborted) this.onStatus?.(error instanceof Error ? error.message : String(error), "warning"); }
  }

  private updateLakePointer(event: PointerEvent): boolean {
    const drag = this.lakeDrag; if (!drag || drag.pointerId !== event.pointerId) return false;
    this.lakeRay(event.clientX, event.clientY);
    const point = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -drag.before.surfaceLevel), new Vector3());
    const document = this.lakeDocument(drag.before.terrainRef); if (!point || !document) return true;
    const next = structuredClone(drag.before), axis = drag.edge % 2, s = document.def.spacing, o = document.def.origin[axis === 0 ? 0 : 2];
    const value = o + Math.round(((axis === 0 ? point.x : point.z) - o) / s) * s;
    (drag.edge < 2 ? next.bounds.min : next.bounds.max)[axis] = value;
    try { validateWaterBody(next); if (drag.draft) this.lakeDraft = next;
      else { const i = this.layout?.waterBodies?.findIndex((w) => w.id === next.id) ?? -1; if (i >= 0) this.layout!.waterBodies![i] = next; }
      this.rebuildLakes(150); this.emitSelectionChanged();
    } catch { /* Keep the last valid rectangle while a handle crosses its seed. */ }
    return true;
  }

  private endLakePointer(event: PointerEvent): boolean {
    const drag = this.lakeDrag; if (!drag || drag.pointerId !== event.pointerId) return false;
    this.lakeDrag = null; if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    const after = this.getLakeEditorState().source;
    if (!drag.draft && after) {
      const index = this.layout?.waterBodies?.findIndex((w) => w.id === after.id) ?? -1;
      if (index >= 0) { this.layout!.waterBodies![index] = drag.before; if (event.type !== "pointercancel") this.setLakeByIndex(index, after); }
    } else if (drag.draft && event.type === "pointercancel") this.lakeDraft = drag.before;
    this.rebuildLakes(); return true;
  }

  private async buildRiverWaters(includeLakes = true): Promise<void> {
    if (includeLakes) this.rebuildLakes();
    const build = ++this.riverWaterBuild;
    this.riverFoamAborter.abort(); this.riverFoamAborter=new AbortController();
    const foamSignal=this.riverFoamAborter.signal;
    for (const object of this.riverWaterObjects) {
      this.scene.remove(object);
      disposeRiverWaterObject(object);
    }
    this.riverWaterObjects = [];
    for (const source of this.riverReflectionSources) this.waterReflections.release(source);
    this.riverReflectionSources = [];
    const waters = this.layout?.riverWaters ?? [];
    for (const actor of waters) {
      try {
        const resolved = resolveRiverWater(actor);
        const landscape = this.layout?.landscapes?.find((candidate) => candidate.id === resolved.landscapeRef);
        const document = landscape ? this.worldTerrains.get(landscape.id) : undefined;
        const spline = document?.def.splines?.find((candidate) => candidate.id === resolved.splineRef);
        if (!landscape || !document || !spline) {
          console.warn(`[river-water] Skipped ${resolved.id}: missing Landscape/spline ${resolved.landscapeRef}/${resolved.splineRef}.`);
          continue;
        }
        const source = await prepareTerrainRiverWaterSource(document, resolved, async (key) => {
          const path = terrainTilePath(landscape.dataRef, key);
          const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
          if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
          return validateTerrainTile(document.def, key, new Uint8Array(await response.arrayBuffer()));
        });
        const normalMap = await this.loadRiverWaterNormalTexture(resolved.normalTexture);
        const foamNoiseMap = await this.loadRiverWaterTexture("perlin-noise", "foam noise");
        if (build !== this.riverWaterBuild) return;
        let bakedFoam;
        if(resolved.geometryFoam?.enabled && resolved.geometryFoam.bake) {
          try {
            const data=await this.riverFoam.read(resolved.geometryFoam.bake.manifest,foamSignal);
            if(data.metadata.fingerprint!==resolved.geometryFoam.bake.fingerprint)throw new Error("River foam fingerprint mismatch");
            const used=[...this.riverWaterObjects,...(this.lakes?.objects.values()??[])].reduce((n,o)=>n+(o.material.uniforms.geometryFoamMask?.value?.image?.data?.byteLength??0),0);
            const {nx,nz}=data.metadata,tw=Math.min(1024,nx),th=Math.min(1024,nz);
            if(used+tw*th*Math.ceil(nx/tw)*Math.ceil(nz/th)>32*1024**2)throw new Error("over-budget: combined water geometry foam exceeds 32 MiB");
            bakedFoam=data; this.riverFoamMessages.delete(resolved.id);
          }catch(error){if(foamSignal.aborted)return;this.riverFoamMessages.set(resolved.id,String(error));console.warn("[river-foam]",resolved.id,error);}
        }
        if(build!==this.riverWaterBuild)return;
        const item: RiverWaterRenderItem = {
          ...resolved,
          ...source,
          foamNoiseMap,
          ...(bakedFoam?{bakedFoam}:{}),
          environmentProbes: () => this.eligibleProbeBakes(),
        };
        const object = createRiverWaterObject(item, normalMap);
        object.raycast = () => {};
        object.userData.riverWaterId = resolved.id;
        object.setShoreWetnessAllowed(this.editorQuality.lakeShoreWetnessAllowed);
        this.scene.add(object);
        this.riverWaterObjects.push(object);
      } catch (error) {
        if (build !== this.riverWaterBuild) return;
        this.onStatus?.(`River Water ${actor.id} failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
      }
    }
    this.refreshAllRiverWaterFoamOverlays();
    this.emitSelectionChanged(); // Calculate becomes available only after the async surface is published.
  }

  private async loadRiverWaterNormalTexture(id: string): Promise<Texture | null> {
    return this.loadRiverWaterTexture(id, "normal");
  }

  /** Loads a repeatable manifest texture shared by water materials. */
  private async loadRiverWaterTexture(id: string, purpose: string): Promise<Texture | null> {
    const cached = this.riverWaterTextures.get(id);
    if (cached) return cached;
    const manifest = this.manifest;
    const record = manifest ? assetRecordById(manifest, id) : null;
    if (!record || assetType(record) !== "texture") {
      console.warn(`[river-water] ${purpose} texture is not a manifest texture: ${id}.`);
      return null;
    }
    try {
      const texture = await this.textureLoader.loadAsync(projectFileUrl(assetPath(record)));
      texture.wrapS = texture.wrapT = RepeatWrapping;
      this.riverWaterTextures.set(id, texture);
      return texture;
    } catch (error) {
      console.warn(`[river-water] Failed to load ${purpose} texture: ${id}.`, error);
      return null;
    }
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
    this.foliageRing?.dispose();
    this.foliageRing = null;
    this.foliageCellGenerator?.dispose();
    this.foliageCellGenerator = null;
    if (this.foliageBinding) {
      this.foliageBinding.dispose();
      this.foliageBinding = null;
    }
    this.foliageTypes.clear();
    this.foliageSelection.clear();
    const foliage = await loadFoliageDocument(this.foliageScenePath());
    this.foliageData = foliage.data;
    this.editorSaves.foliageLoaded(foliage.cells);
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
    this.rebuildFoliageRing();
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

  /**
   * The terrain a Landscape foliage rule grows on in the ring: a World Terrain's
   * edit tiles (resident ones when streamed), or a fresh one-tile view of a 1×1
   * Landscape; null for one the ring cannot express (rotated, non-square).
   */
  private proceduralFoliageTerrain(landscapeId: string): ProceduralFoliageTerrain | null {
    const actor = (this.layout?.landscapes ?? []).find((entry) => entry.id === landscapeId);
    if (!actor) return null;
    const document = this.worldTerrains.get(actor.id);
    if (document) {
      const { def } = document;
      return {
        id: actor.id,
        def: { tileQuads: def.tileQuads, spacing: def.spacing, tilesX: def.tilesX, tilesZ: def.tilesZ,
          origin: [...def.origin], layers: def.layers.map((layer) => ({ id: layer.id })) },
        tiles: { tile: (x, z) => document.tiles.get(tileKey(x, z)) },
        existingTiles: new Set(def.tiles.map((tile) => tile.key)),
      };
    }
    return null;
  }

  /** Recreates the editor ring from the current rules, types and terrains (the generator is kept). */
  private rebuildFoliageRing(): void {
    this.foliageRing?.dispose();
    this.foliageRing = null;
    const binding = this.foliageBinding;
    if (!binding) return;
    const rules: ProceduralFoliageRuleSource[] = [];
    for (const rule of this.foliageData.landscapeRules ?? []) {
      const type = this.foliageTypes.get(rule.foliageTypeId);
      const terrain = type ? this.proceduralFoliageTerrain(rule.landscapeId) : null;
      if (type && terrain) rules.push({ rule, type, terrain });
    }
    if (rules.length === 0) return;
    this.foliageCellGenerator ??= createFoliageCellGenerator();
    this.foliageRing = new ProceduralFoliageRing({ rules, binding, resolver: this.foliageResolver(), generator: this.foliageCellGenerator });
  }

  private foliageRenderData(): LayoutFoliageData {
    return { schema: 1, type: "foliage", groups: [...this.foliageData.groups] };
  }

  /** Rebuilds only the generated rule groups affected by a terrain change. */
  private rebuildGeneratedFoliageForLandscape(landscapeId: string): void {
    const terrain = this.proceduralFoliageTerrain(landscapeId);
    if (terrain) this.foliageRing?.replaceTerrain(terrain);
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
    this.rebuildFoliageRing();
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
      const world = this.worldTerrains.get(actor.id);
      if (world) {
        return { id: actor.id, name: actor.name ?? actor.id, layers: world.def.layers.map((layer) => ({ id: layer.id, name: layer.name })) };
      }
      return { id: actor.id, name: actor.name ?? actor.id, layers: [] };
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
        typeCastsShadow: this.foliageTypes.get(rule.foliageTypeId)?.castShadow ?? false,
        typeCullEnd: this.foliageTypes.get(rule.foliageTypeId)?.cullEnd ?? 0,
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
      this.editorSaves.foliageSaveRevision.markDirty();
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
      this.editorSaves.foliageSaveRevision.markDirty();
      this.rebuildFoliageRing();
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
    this.editorSaves.foliageSaveRevision.markDirty();
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
    this.editorSaves.foliageSaveRevision.markDirty();
    this.rebuildAllGeneratedFoliage();
    this.emitFoliageChanged();
    this.scheduleAutoSave();
  }

  removeLandscapeFoliageRule(id: string): void {
    const rules = this.foliageData.landscapeRules ?? [];
    const next = rules.filter((rule) => rule.id !== id);
    if (next.length === rules.length) return;
    this.foliageData.landscapeRules = next;
    this.editorSaves.foliageSaveRevision.markDirty();
    this.foliageBinding?.removeGroup(`generated-${id}`);
    this.rebuildFoliageRing();
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
    return resolveFoliageTarget(pick, this.layout?.landscapes ?? [], this.foliageToolSettings.filters);
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
  applyFoliageActionAt(clientX: number, clientY: number, shiftErase = false): boolean {
    if (!this.foliageModeActive) return false;
    const tool = this.foliageToolSettings.tool;
    if (tool === "select") return false;
    const pick = this.picker.pickFoliageSurface(clientX, clientY);
    if (!pick) return false;
    // Paint temporarily becomes the global erase brush while Shift is held. This
    // keeps the primary paint workflow under one tool without changing Erase or
    // Remove's explicit modes (Erase = every type; Remove = active type only).
    if (tool === "erase" || (tool === "paint" && shiftErase)) return this.applyFoliageErase(pick);
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
      } else {
        // Missing tiles, edges and other targets are not part of this surface.
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
    this.editorSaves.foliageSaveRevision.markDirty();
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
    this.editorSaves.foliageSaveRevision.markDirty();
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
    this.editorSaves.foliageSaveRevision.markDirty();
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
    this.editorSaves.foliageSaveRevision.markDirty();
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
    this.editorSaves.foliageSaveRevision.markDirty();
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
    this.editorSaves.foliageSaveRevision.markDirty();
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
    this.editorSaves.foliageSaveRevision.markDirty();
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
    this.scene.add(tagSceneSource(cursor, EDITOR_OVERLAY_SOURCE));
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
      this.applyFoliageActionAt(event.clientX, event.clientY, tool === "paint" && event.shiftKey);
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
      this.applyFoliageActionAt(event.clientX, event.clientY, tool === "paint" && event.shiftKey);
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
      this.editorSaves.meshPaintSaveRevision.markDirty();
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
    this.editorSaves.meshPaintSaveRevision.markDirty();
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
      this.editorSaves.meshPaintSaveRevision.markDirty();
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
    this.editorSaves.meshPaintSaveRevision.markDirty();
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
    this.editorSaves.meshPaintSaveRevision.markDirty();
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
    this.editorSaves.meshPaintSaveRevision.markDirty();
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
    this.scene.add(tagSceneSource(cursor, EDITOR_OVERLAY_SOURCE));
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
    this.editorSaves.meshPaintSaveRevision.markDirty();
  }

  /** Shared legacy/World Terrain document loader; renderer adapter lives outside SceneApp. */
  private fetchLandscapeDocument(actor: LayoutLandscape): Promise<TerrainActorDocument> {
    return fetchTerrainActorDocument(actor.dataRef, editorStreamsTerrain, actor);
  }

  /**
   * Registers a World Terrain actor. The definition is the source of truth for
   * placement, so a stale actor transform is snapped onto it (and reported)
   * instead of drawing the terrain away from where it collides. A terrain read
   * from a legacy sidecar has no files yet: the next Save writes all of it.
   */
  private adoptWorldTerrain(actor: LayoutLandscape, loaded: WorldTerrainDocument, unwritten = false): void {
    const document = this.editableWorldTerrain(actor.dataRef, loaded, unwritten ? "f32" : undefined);
    this.worldTerrains.set(actor.id, document);
    if (unwritten) {
      const session = this.worldTerrainSessions.get(document);
      session?.markTiles(document.tiles.keys());
      session?.markDefinitionDirty();
    }
    const issues = worldTerrainPlacementIssues(actor, document.def);
    if (issues.length > 0) {
      console.warn(`[terrain] ${actor.id}: ${issues.join("; ")}`);
      actor.position = worldTerrainActorPosition(document.def);
      delete actor.rotation;
      this.onStatus?.(`${actor.name ?? actor.id}: placement taken from its terrain definition.`, "warning");
    }
  }

  /**
   * The editor's one editable copy of a World Terrain, registered with its
   * save session. The render source reads the same tile objects the brush
   * writes, so a dab needs no data copy. Tiles keep the height format they were
   * loaded with; tiles that never came from disk use `newTileFormat`.
   */
  private editableWorldTerrain(path: string, loaded: WorldTerrainDocument, newTileFormat?: TerrainHeightFormat): WorldTerrainDocument {
    const world = createTerrainEditWorld(migrateTerrainSplineCoordinates(loaded.def), loaded.tiles.values());
    const formats = new Map<string, TerrainHeightFormat>();
    for (const [key, tile] of loaded.tiles) {
      const format = (tile as Partial<DecodedTerrainTile>).heightFormat ?? newTileFormat;
      if (format) formats.set(key, format);
    }
    // A new or expanded terrain has no global map yet; build it as the loader
    // does, so the renderer updates this shared copy (World Partition minimap).
    const globalAttributes = loaded.globalAttributes
      ?? (loaded.tiles.size === loaded.def.tiles.length ? buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles)) : undefined);
    const document: WorldTerrainDocument = { def: world.def, tiles: world.tiles, globalAttributes };
    const session = new WorldTerrainEditSession(path, world, formats, () => document.globalAttributes);
    this.worldTerrainSessions.set(document, session);
    // The loader left tiles out: this terrain is too large to hold whole.
    if (loaded.tiles.size < loaded.def.tiles.length) {
      const streaming = new TerrainEditorStreaming(world, {
        fetch: async (key, signal) => {
          const tilePath = terrainTilePath(path, key);
          const response = await fetch(projectFileUrl(tilePath), { signal, cache: "no-cache" });
          if (!response.ok) throw new Error(`${tilePath}: HTTP ${response.status}`);
          // Against the live definition: a Save may have widened its range since load.
          const tile = validateTerrainTile(world.def, key, new Uint8Array(await response.arrayBuffer()));
          session.recordFormat(key, tile.heightFormat);
          return tile;
        },
        changed: (key) => {
          const index = this.layout?.landscapes?.findIndex((actor) => this.worldTerrains.get(actor.id) === document) ?? -1;
          const object = this.landscapeObjects[index];
          if (object) {
            refreshWorldTerrainObjectTile(object, key);
            if (this.showCollision) this.worldTerrainCollisionWiresDirty = true;
          }
        },
        pinned: (key) => session.touched(key),
        warn: (message) => {
          console.warn(message);
          this.onStatus?.(message, "warning");
        },
      });
      this.worldTerrainStreams.set(document, streaming);
      // Regions kept loaded last session stream in again (read failures warn through the hook).
      const kept = this.keptTerrainTiles?.read(path) ?? [];
      if (kept.length > 0) void streaming.keepLoaded(kept).catch(() => {});
    }
    return document;
  }

  /** Streams each large World Terrain around the editor camera; called every frame. */
  private updateWorldTerrainStreaming(): void {
    if (this.worldTerrainStreams.size === 0) return;
    const { x, z } = this.editorViewportCamera().position;
    for (const document of this.worldTerrains.values()) this.worldTerrainStreams.get(document)?.update([{ position: [x, z] }]);
  }

  /**
   * Loads every tile of a streaming World Terrain and holds them, for
   * operations that read or replace the whole grid. No-op for an eager one.
   */
  private async loadWholeWorldTerrain(document: WorldTerrainDocument, purpose: string): Promise<void> {
    const streaming = this.worldTerrainStreams.get(document);
    if (!streaming || streaming.allResident) return;
    this.onStatus?.(`Loading all ${document.def.tiles.length} terrain tiles to ${purpose}…`, "info");
    await streaming.demandAll();
  }

  /** Cheap transform/visibility sync for one landscape (gizmo drag). */
  private refreshLandscapeObject(index: number): void {
    const actor = this.layout?.landscapes?.[index];
    const object = this.landscapeObjects[index];
    if (!actor || !object) return;
    // A World Terrain follows its actor while dragged; `syncWorldTerrainPlacement`
    // moves the definition (and what is authored on it) when the move commits.
    applyLandscapeTransform(object, { position: actor.position, rotation: [0, 0, 0], hidden: resolveLandscape(actor).hidden });
    this.syncRiverWaterTransformsForLandscape(actor);
  }

  /**
   * Moves a World Terrain's definition to where its actor now is (OPEN_WORLD_PLAN
   * Faz 8, K1): shifts `origin`, its world-frame splines and its lakes by the
   * same delta, then rebuilds what is drawn from them. Tiles are untouched.
   * Runs at every committed transform (gizmo release, Details, undo/redo).
   */
  private syncWorldTerrainPlacement(index: number): void {
    const actor = this.layout?.landscapes?.[index];
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    if (!this.layout || !actor || !document) return;
    delete actor.rotation;
    const delta = worldTerrainMoveDelta(document.def, actor.position);
    if (isZeroMove(delta)) return;
    const moved = moveWorldTerrain(document.def, actor.id, this.layout.waterBodies ?? [], delta, this.layout.riverWaters ?? []);
    document.def.origin = moved.origin;
    if (moved.splines) document.def.splines = moved.splines;
    if (this.layout.waterBodies) this.layout.waterBodies = moved.lakes;
    if (this.layout.riverWaters) this.layout.riverWaters = moved.rivers;
    actor.position = worldTerrainActorPosition(document.def);
    this.worldTerrainSessions.get(document)?.markDefinitionDirty();
    this.worldTerrainStreams.get(document)?.syncFrame();
    if (this.showCollision) this.worldTerrainCollisionWiresDirty = true;
    this.rebuildLandscapeObject(index);
    this.rebuildLakes();
    this.rebuildGeneratedFoliageForLandscape(actor.id);
  }

  /** Keeps water ribbons visually attached while a Landscape is moved or rotated in the editor. */
  private syncRiverWaterTransformsForLandscape(landscape: LayoutLandscape): void {
    const waters = this.layout?.riverWaters ?? [];
    for (const water of waters) {
      if (water.landscapeRef !== landscape.id) continue;
      const object = this.riverWaterObjects.find((entry) => entry.userData.riverWaterId === water.id);
      if (!object) continue;
      object.position.set(...landscape.position);
      const rotation = landscape.rotation ?? [0, 0, 0];
      object.rotation.set(
        (rotation[0] * Math.PI) / 180,
        (rotation[1] * Math.PI) / 180,
        (rotation[2] * Math.PI) / 180,
        "XYZ",
      );
    }
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

  /** Live editor source: world-space spline points on the World Terrain definition. */
  private landscapeSplineSource(id: string): Pick<WorldTerrainDef, "splines"> | null {
    return this.worldTerrains.get(id)?.def ?? null;
  }

  private markLandscapeSplineDirty(id: string): void {
    const document = this.worldTerrains.get(id);
    if (document) this.worldTerrainSessions.get(document)?.markDefinitionDirty();
  }

  private defaultLandscapeSplinePaintLayer(): string {
    const layers = this.getSelectedLandscapeLayers();
    return layers[1]?.id ?? layers[0]?.id ?? LANDSCAPE_DEFAULT_LAYERS[1]!.id;
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
    this.scene.add(tagSceneSource(cursor, EDITOR_OVERLAY_SOURCE));
    return cursor;
  }

  private updateLandscapeBrushCursorScale(): void {
    if (!this.landscapeBrushCursor) return;
    this.landscapeBrushCursor.scale.setScalar(this.landscapeSculptSettings.brushSize);
  }

  private updateLandscapeBrushHover(clientX: number, clientY: number): void {
    // Foliage mode owns the brush cursor; never show the landscape sculpt ring too.
    if (this.foliageModeActive || this.meshPaintModeActive || this.landscapeSculptSettings.editMode === "splines" || this.landscapeSculptSettings.editMode === "water") {
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
    // Alt+left is a temporary sculpt tool; other terrain modes keep camera orbit.
    if (event.altKey && this.landscapeSculptSettings.editMode !== "sculpt") return false;
    if (this.landscapeSculptSettings.editMode === "water") {
      if (this.landscapeSculptSettings.riverWaterRingFoamPlacementId) return this.placeRiverWaterRingFoamAtPointer(event);
      const marker = this.pickRiverWaterFoamStamp(event.clientX, event.clientY);
      if (marker) {
        this.setLandscapeSculptSettings({ activeRiverWaterId: marker.waterId,
          activeRiverWaterFoamStampId: marker.stampId, activeRiverWaterFoamStampAnchor: marker.anchor });
        this.emitSelectionChanged();
        this.updateGizmo();
        return true;
      }
      return false;
    }
    if (this.selection?.kind === "landscape" && this.isWorldTerrainSelection(this.selection)
      && this.landscapeSculptSettings.editMode !== "splines") {
      return this.beginTerrainStroke(event);
    }
    if (this.landscapeSculptSettings.editMode === "splines") {
      return this.addLandscapeSplinePointAtPointer(event);
    }
    return this.beginTerrainStroke(event);
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
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
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
        projected.set(point.position[0], point.position[1] + 0.4, point.position[2]);
        if (!actor || !this.worldTerrains.has(actor.id)) projected.applyMatrix4(object.matrixWorld);
        projected.project(camera);
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
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
    if (!actor || actor.locked || !object || !data) return null;
    const point = data.splines
      ?.find((spline) => spline.id === activeSplineId)
      ?.points.find((entry) => entry.id === activeSplinePointId);
    if (!point) return null;
    object.updateWorldMatrix(true, false);
    const world = new Vector3(...point.position);
    if (!this.worldTerrains.has(actor.id)) world.applyMatrix4(object.matrixWorld);
    return { index, landscapeId: actor.id, object, splineId: activeSplineId, pointId: activeSplinePointId, world };
  }

  /** Screen-space hit-test for visible Radial Foam editor markers. */
  private pickRiverWaterFoamStamp(
    clientX: number,
    clientY: number,
  ): { waterId: string; stampId: string; anchor: RiverWaterFoamStampAnchor } | null {
    if (this.selection?.kind !== "landscape" || this.landscapeSculptSettings.editMode !== "water") return null;
    const index = this.selection.index;
    const landscape = this.layout?.landscapes?.[index];
    const object = this.landscapeObjects[index];
    if (!landscape || !object) return null;
    const waterId = this.landscapeSculptSettings.activeRiverWaterId;
    const water = this.layout?.riverWaters?.find((entry) => entry.id === waterId && entry.landscapeRef === landscape.id);
    if (!water) return null;
    const resolved = resolveRiverWater(water);
    object.updateWorldMatrix(true, false);
    const camera = this.editorViewportCamera();
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const projected = new Vector3();
    let best: { stampId: string; anchor: RiverWaterFoamStampAnchor; distance: number } | null = null;
    for (const stamp of resolved.foamStamps) {
      if (stamp.kind !== "point") continue;
      projected.set(stamp.position[0], stamp.position[1] + 0.2, stamp.position[2]);
      if (water.coordinateSpace !== "world") projected.applyMatrix4(object.matrixWorld);
      projected.project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const distance = Math.hypot(
        (projected.x * 0.5 + 0.5) * rect.width - px,
        (-projected.y * 0.5 + 0.5) * rect.height - py,
      );
      if (distance <= 18 && (!best || distance < best.distance)) {
        best = { stampId: stamp.id, anchor: "start", distance };
      }
    }
    return best ? { waterId: resolved.id, stampId: best.stampId, anchor: best.anchor } : null;
  }

  /** Resolves the active Radial Foam point to the shared move-gizmo target. */
  private activeRiverWaterFoamStamp(): RiverWaterFoamStampGizmoTarget | null {
    if (this.selection?.kind !== "landscape" || this.landscapeSculptSettings.editMode !== "water") return null;
    const { activeRiverWaterId, activeRiverWaterFoamStampId } = this.landscapeSculptSettings;
    if (!activeRiverWaterId || !activeRiverWaterFoamStampId) return null;
    const index = this.selection.index;
    const landscape = this.layout?.landscapes?.[index];
    const object = this.landscapeObjects[index];
    const water = this.layout?.riverWaters?.find((entry) => entry.id === activeRiverWaterId && entry.landscapeRef === landscape?.id);
    const stamp = water?.foamStamps?.find((entry) => entry.id === activeRiverWaterFoamStampId && entry.kind === "point");
    if (!landscape || landscape.locked || !object || !stamp) return null;
    object.updateWorldMatrix(true, false);
    return {
      index,
      landscapeId: landscape.id,
      waterId: activeRiverWaterId,
      stampId: stamp.id,
      anchor: "start",
      object,
      world: water?.coordinateSpace === "world" ? new Vector3(...stamp.position)
        : new Vector3(...stamp.position).applyMatrix4(object.matrixWorld),
    };
  }

  /** Handles the one click that creates an authored Radial Foam point. */
  private placeRiverWaterRingFoamAtPointer(event: PointerEvent): boolean {
    const waterId = this.landscapeSculptSettings.riverWaterRingFoamPlacementId;
    const index = this.selectedEditableLandscapeIndex();
    if (!waterId || index === null) return false;
    const landscape = this.layout?.landscapes?.[index];
    const hit = this.landscapeLocalHit(event.clientX, event.clientY);
    const water = this.layout?.riverWaters?.find((entry) => entry.id === waterId && entry.landscapeRef === landscape?.id);
    if (!landscape || !water || !hit || hit.landscapeIndex !== index) return false;
    const resolved = resolveRiverWater(water);
    const used = new Set(resolved.foamStamps.map((stamp) => stamp.id));
    const point = hit.local.clone();
    if (water.coordinateSpace === "world") this.landscapeObjects[index]!.localToWorld(point);
    let number = 1;
    while (used.has(`foam-${number}`)) number += 1;
    const stamp: LayoutRiverWaterFoamStamp = {
      id: `foam-${number}`,
      kind: "point",
      position: [round(point.x), resolved.surfaceLevel, round(point.z)],
      radius: 2,
      intensity: 0.7,
    };
    this.setLandscapeSculptSettings({
      riverWaterRingFoamPlacementId: null,
      activeRiverWaterId: waterId,
      activeRiverWaterFoamStampId: stamp.id,
      activeRiverWaterFoamStampAnchor: "start",
    });
    this.setSelectedLandscapeRiverWater(waterId, { foamStamps: [...resolved.foamStamps, stamp] });
    this.updateGizmo();
    this.onStatus?.("Radial Foam placed. Move it with the gizmo.", "success");
    return true;
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
    const actor = this.layout?.landscapes?.[index];
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    if (document && actor) {
      const hit = this.picker.pickLandscapeSurface(event.clientX, event.clientY);
      if (!hit || hit.index !== index) return false;
      void this.addWorldTerrainSplinePoint(index, actor.id, document, hit.point);
      return true;
    }
    const hit = this.landscapeLocalHit(event.clientX, event.clientY);
    if (!hit || hit.landscapeIndex !== index) return false;
    this.appendLandscapeSplinePoint(index, [round(hit.local.x), round(hit.local.y), round(hit.local.z)]);
    return true;
  }

  private async addWorldTerrainSplinePoint(index: number, id: string, document: WorldTerrainDocument, point: Vector3): Promise<void> {
    if (this.worldTerrainSplineBusy) { this.onStatus?.("Loading terrain for the previous spline operation…", "info"); return; }
    this.worldTerrainSplineBusy = true;
    const streaming = this.worldTerrainStreams.get(document);
    const keys = terrainBrushTileKeys(document.def, point.x, point.z, 0);
    const active = this.landscapeSculptSettings.activeSplineId;
    const activePoint = this.landscapeSculptSettings.activeSplinePointId;
    const revision = JSON.stringify(document.def.splines);
    try {
      await streaming?.demand(keys);
      if (this.worldTerrains.get(id) !== document || this.selectedEditableLandscapeIndex() !== index
        || this.landscapeSculptSettings.editMode !== "splines" || this.landscapeSculptSettings.splineTool !== "draw"
        || this.landscapeSculptSettings.activeSplineId !== active || this.landscapeSculptSettings.activeSplinePointId !== activePoint
        || JSON.stringify(document.def.splines) !== revision) return;
      const height = terrainHeightAt(document.def, { tile: (x, z) => document.tiles.get(tileKey(x, z)) }, point.x, point.z);
      if (height === null) throw new Error("Exact terrain is unavailable at this point");
      this.appendLandscapeSplinePoint(index, [round(point.x), round(height), round(point.z)]);
    } catch (error) { this.onStatus?.(`Spline point failed: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    finally { streaming?.release(keys); this.worldTerrainSplineBusy = false; }
  }

  private appendLandscapeSplinePoint(index: number, local: Vec3): void {
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    let spline = before.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId);
    if (!spline) {
      const used = new Set(before.map((entry) => entry.id));
      let number = 1;
      while (used.has(`spline-${number}`)) number += 1;
      spline = { id: `spline-${number}`, name: `Spline ${number}`, points: [], segments: [] };
      before.push(spline);
    }
    const from =
      spline.points.find((point) => point.id === this.landscapeSculptSettings.activeSplinePointId) ??
      spline.points.at(-1);
    // Weld radius scales with the terrain footprint so it feels the same at any size.
    const document = this.worldTerrains.get(actor.id);
    const worldSize = document ? terrainTileWorldSize(document.def) : 0;
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
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
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

  /**
   * Sculpt/paint through `terrainEdit` (OPEN_WORLD_PLAN Faz 2): the shared
   * brush math runs across tile seams in `applyTerrainBrush`, each dab
   * re-uploads only its dirty tile rectangles, and undo stores those
   * rectangles' before/after values instead of whole height arrays. A
   * multi-tile World Terrain edits its session's tiles in world space. A 1×1
   * Landscape edits a Landscape-local tile built from its grid when the stroke
   * starts, and every dab writes its rectangles back into that grid, which the
   * renderer, splines, foliage and Save still read.
   */
  private beginTerrainStroke(event: PointerEvent): boolean {
    if (this.landscapeSculptSettings.editMode === "water") return false;
    if (this.terrainStrokePending) {
      this.onStatus?.("Loading terrain for the previous sculpt operation…", "info");
      return true;
    }
    const index = this.selectedEditableLandscapeIndex();
    if (index === null) return false;
    const hit = this.picker.pickLandscapeSurface(event.clientX, event.clientY);
    if (!hit || hit.index !== index) return false;
    const mode = this.landscapeSculptSettings.editMode;
    const actor = this.layout?.landscapes?.[index];
    if (!actor) return false;
    const document = this.worldTerrains.get(actor.id);
    if (!document) return false;
    if (mode === "splines") {
      // Say why nothing happens instead of silently selecting the terrain again.
      this.onStatus?.("Splines are not supported on a multi-tile Landscape yet.", "warning");
      return false;
    }
    const session = this.worldTerrainSessions.get(document);
    if (!session) return false;
    const world = session.world;
    const stroke: TerrainStroke = {
      pointerId: event.pointerId, landscapeIndex: index, landscapeId: actor.id, document, world, mode,
      flattenSampleHeight: 0, patches: [], demanded: new Set(), tool: this.landscapeSculptTool(event),
      rampStart: null, rampEnd: null, pendingBrush: null, paint: createTerrainPaintAccumulator(),
    };
    if (mode === "paint" && this.terrainStrokeLayer(stroke) < 0) {
      this.onStatus?.("The active paint layer is not one of this Landscape's layers.", "warning");
      return false;
    }
    const point = hit.point.clone();
    stroke.flattenSampleHeight = point.y - world.def.origin[1];
    if (mode === "sculpt" && stroke.tool === "ramp") stroke.rampStart = point;
    this.terrainStroke = stroke;
    this.canvas.setPointerCapture(event.pointerId);
    if (stroke.rampStart) this.updateTerrainRampPreview(hit.point, hit.point);
    else this.applyTerrainStrokeDab(stroke, point, event);
    return true;
  }

  private terrainStrokeLayer(stroke: TerrainStroke): number {
    return stroke.world.def.layers.findIndex((layer) => layer.id === this.landscapeSculptSettings.activeLayerId);
  }

  private landscapeSculptTool(event: Pick<PointerEvent, "shiftKey" | "ctrlKey" | "altKey">): LandscapeSculptTool {
    const tool = this.landscapeSculptSettings.tool;
    // Resolve every dab so modifiers can change the tool during the same drag
    // without changing the user's selected tool.
    // Alt wins over Ctrl: together they flatten to the initial click height.
    if (event.altKey) return "flatten";
    if (event.ctrlKey) return "smooth";
    if (event.shiftKey && tool === "raise") return "lower";
    if (event.shiftKey && tool === "lower") return "raise";
    return tool;
  }

  private landscapeFlattenTarget(sampleHeight: number, event: Pick<PointerEvent, "ctrlKey" | "altKey">): number {
    return this.landscapeSculptSettings.flattenUseClickedHeight || (event.ctrlKey && event.altKey)
      ? sampleHeight
      : this.landscapeSculptSettings.flattenTargetHeight;
  }

  private terrainStrokeRamp(stroke: TerrainStroke): TerrainRamp | undefined {
    if (!stroke.rampStart || !stroke.rampEnd) return undefined;
    const datum = stroke.world.def.origin[1];
    return {
      start: { x: stroke.rampStart.x, z: stroke.rampStart.z, height: stroke.rampStart.y - datum },
      end: { x: stroke.rampEnd.x, z: stroke.rampEnd.z, height: stroke.rampEnd.y - datum },
    };
  }

  private updateTerrainRampPreview(start: Vector3, end: Vector3): void {
    const settings = this.landscapeSculptSettings;
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz) || 1;
    const side = new Vector3(-dz / length * settings.brushSize, 0, dx / length * settings.brushSize);
    const shoulder = new Vector3(-dz / length * (settings.brushSize + settings.rampShoulder), 0, dx / length * (settings.brushSize + settings.rampShoulder));
    const a = start.clone().add(new Vector3(0, settings.rampStartOffset + 0.08, 0));
    const b = end.clone().add(new Vector3(0, settings.rampEndOffset + 0.08, 0));
    const al = a.clone().add(side), ar = a.clone().sub(side), bl = b.clone().add(side), br = b.clone().sub(side);
    if (!this.landscapeRampPreview) {
      this.landscapeRampPreview = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xf2d16b, depthTest: false }));
      this.landscapeRampPreview.name = "landscape-ramp-preview";
      this.landscapeRampPreview.renderOrder = 21;
      this.scene.add(tagSceneSource(this.landscapeRampPreview, EDITOR_OVERLAY_SOURCE));
    }
    this.landscapeRampPreview.geometry.setFromPoints([a, b, al, bl, ar, br, al, ar, bl, br,
      a.clone().add(shoulder), b.clone().add(shoulder), a.clone().sub(shoulder), b.clone().sub(shoulder)]);
    this.landscapeRampPreview.geometry.computeBoundingSphere();
    this.landscapeRampPreview.visible = true;
  }

  /** `point` is in the stroke's edit frame (`terrainStrokePoint`). */
  private applyTerrainStrokeDab(stroke: TerrainStroke, point: Vector3, event: Pick<PointerEvent, "shiftKey" | "ctrlKey" | "altKey">): void {
    const session = stroke.document ? this.worldTerrainSessions.get(stroke.document) : undefined;
    if (stroke.document && !session) return;
    const settings = this.landscapeSculptSettings;
    stroke.pendingBrush = null;
    const ramp = this.terrainStrokeRamp(stroke);
    const base = { x: point.x, z: point.z, radius: settings.brushSize, strength: settings.strength, falloff: settings.falloff };
    const brush: TerrainBrush = stroke.mode === "paint"
      ? { ...base, mode: settings.paintTool, layer: this.terrainStrokeLayer(stroke) }
      : {
          ...settings,
          ...base,
          mode: ramp ? "ramp" : this.landscapeSculptTool(event),
          ...(ramp ? { ramp } : {}),
          // Heights are relative to the datum (origin Y), like a Landscape's local Y.
          hitHeight: point.y - stroke.world.def.origin[1],
          flattenTargetHeight: this.landscapeFlattenTarget(stroke.flattenSampleHeight, event),
        };
    const streaming = stroke.document ? this.worldTerrainStreams.get(stroke.document) : undefined;
    if (streaming && session) {
      // A dab needs every tile under it; load the missing ones and skip this
      // dab rather than reject it. They stay held until the stroke ends.
      const keys = terrainBrushTileKeys(stroke.world.def, point.x, point.z, settings.brushSize, ramp, settings.rampShoulder);
      const missing = keys.filter((key) => !session.world.tiles.has(key));
      for (const key of keys) stroke.demanded.add(key);
      if (missing.length > 0) {
        stroke.pendingBrush = brush;
        if (stroke.patches.length === 0) this.onStatus?.(`Loading ${missing.length} terrain tile(s) under the brush…`, "info");
        streaming.demand(keys).catch(() => {});
        return;
      }
      streaming.demand(keys).catch(() => {});
    }
    this.applyTerrainStrokeBrush(stroke, brush);
  }

  private applyTerrainStrokeBrush(stroke: TerrainStroke, brush: TerrainBrush): void {
    const index = this.layout?.landscapes?.findIndex((actor) => actor.id === stroke.landscapeId) ?? -1;
    const object = this.landscapeObjects[index];
    const session = this.worldTerrainSessions.get(stroke.document);
    if (!object || !session || this.worldTerrains.get(stroke.landscapeId) !== stroke.document) return;
    let result: TerrainBrushResult;
    try {
      result = applyTerrainBrush(stroke.world, brush, { paint: stroke.paint });
      stroke.patches.push(...result.patches);
    } catch (error) {
      this.onStatus?.(`Terrain brush failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    if (result.dirty.size === 0) return;
    session.markTiles(result.dirty.keys());
    updateWorldTerrainObjectTiles(object, result.dirty);
    this.scheduleLandscapeFoliageRebuild(stroke.landscapeId);
  }

  private updateTerrainStroke(event: PointerEvent): boolean {
    const stroke = this.terrainStroke;
    if (!stroke || stroke.pointerId !== event.pointerId) return false;
    const hit = this.picker.pickLandscapeSurface(event.clientX, event.clientY);
    if (hit && hit.index === stroke.landscapeIndex) {
      const point = hit.point.clone();
      if (stroke.rampStart) {
        stroke.rampEnd = point;
        this.updateTerrainRampPreview(stroke.rampStart.clone(), hit.point);
      } else this.applyTerrainStrokeDab(stroke, point, event);
    }
    this.updateLandscapeBrushHover(event.clientX, event.clientY);
    return true;
  }

  private endTerrainStroke(event: PointerEvent): boolean {
    const stroke = this.terrainStroke;
    if (!stroke || stroke.pointerId !== event.pointerId) return false;
    this.terrainStroke = null;
    if (this.landscapeRampPreview) this.landscapeRampPreview.visible = false;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be gone after pointercancel.
    }
    if (stroke.rampStart) {
      const hit = event.type === "pointercancel" ? null : this.picker.pickLandscapeSurface(event.clientX, event.clientY);
      if (hit && hit.index === stroke.landscapeIndex) {
        const point = hit.point.clone();
        stroke.rampEnd = point;
        this.applyTerrainStrokeDab(stroke, point, event);
      } else this.onStatus?.("Ramp cancelled: release over the selected Landscape.", "info");
    }
    // Pointercancel must never defer an operation that has not changed terrain yet.
    if (event.type === "pointercancel") stroke.pendingBrush = null;
    void this.completeTerrainStroke(stroke);
    return true;
  }

  private async completeTerrainStroke(stroke: TerrainStroke): Promise<void> {
    const streaming = this.worldTerrainStreams.get(stroke.document);
    const pendingBrush = stroke.pendingBrush;
    if (pendingBrush && streaming) {
      this.terrainStrokePending = true;
      try {
        await streaming.demand(stroke.demanded);
        const actor = this.layout?.landscapes?.find((entry) => entry.id === stroke.landscapeId);
        if (actor && !actor.locked && this.worldTerrains.get(stroke.landscapeId) === stroke.document) {
          this.applyTerrainStrokeBrush(stroke, pendingBrush);
        }
      } catch (error) {
        this.onStatus?.(`Terrain sculpt cancelled: ${error instanceof Error ? error.message : String(error)}`, "warning");
      } finally {
        this.terrainStrokePending = false;
      }
    }
    // Edited tiles are pinned by the session; the rest may stream out again.
    streaming?.release(stroke.demanded);
    if (stroke.patches.length === 0) return;
    const tool = stroke.mode === "paint" ? this.landscapeSculptSettings.paintTool : this.landscapeSculptSettings.tool;
    this.executeTerrainPatchCommand(`Landscape ${tool}`, stroke.landscapeId, stroke.document, stroke.patches);
  }

  /**
   * One undoable terrain edit made of tile patches (a stroke, Fill Layer, a
   * spline bake); executing it applies the after side by replaying them on the
   * World Terrain's session tiles.
   */
  private executeTerrainPatchCommand(
    label: string, landscapeId: string, document: WorldTerrainDocument, patches: readonly TerrainUndoPatch[],
    companion?: { redo: () => void; undo: () => void; selectedId: string },
  ): void {
    const restore = (side: "before" | "after"): void => {
      const index = this.layout?.landscapes?.findIndex((actor) => actor.id === landscapeId) ?? -1;
      const object = this.landscapeObjects[index];
      if (!object) return;
      const session = this.worldTerrainSessions.get(document);
      // A reload replaced the document: its edits went with it.
      if (!session || this.worldTerrains.get(landscapeId) !== document) return;
      const dirty = (side === "after" ? applyTerrainUndoPatches : revertTerrainUndoPatches)(session.world, patches);
      session.markTiles(dirty.keys());
      updateWorldTerrainObjectTiles(object, dirty);
      void this.rebuildLandscapeSplineMeshes(index);
      void this.buildRiverWaters(false);
      if (this.showCollision) this.worldTerrainCollisionWiresDirty = true;
      this.scheduleLandscapeFoliageRebuild(landscapeId);
      companion?.[side === "after" ? "redo" : "undo"]();
      this.updateLakesForTerrainPatches(landscapeId, patches);
      if (companion) {
        this.rebuildLakes();
        const lakeIndex = this.layout?.waterBodies?.findIndex((w) => w.id === companion.selectedId) ?? -1;
        this.select(lakeIndex >= 0 ? { kind: "lake", index: lakeIndex } : { kind: "landscape", index });
      } else this.select({ kind: "landscape", index });
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => restore("after"), undo: () => restore("before") });
  }

  private updateLandscapeSculpt(event: PointerEvent): boolean {
    return this.updateTerrainStroke(event);
  }

  private endLandscapeSculpt(event: PointerEvent): boolean {
    return this.endTerrainStroke(event);
  }

  private refreshAllLandscapeGeometry(): void {
    const landscapes = this.layout?.landscapes ?? [];
    landscapes.forEach((actor, index) => {
      const world = this.worldTerrains.get(actor.id);
      const object = this.landscapeObjects[index];
      if (world && object) {
        const { layers } = world.def;
        updateWorldTerrainAppearance(object, layers, this.landscapeSculptSettings.viewMode,
          this.landscapeSculptSettings.activeLayerId, this.resolveLandscapeLayerColors(layers));
      }
    });
  }

  private insertLandscape(index: number, actor: LayoutLandscape, document: TerrainActorDocument): void {
    if (!this.layout) return;
    this.layout.landscapes ??= [];
    const insertionIndex = clampIndex(index, this.layout.landscapes.length);
    this.layout.landscapes.splice(insertionIndex, 0, cloneLandscape(actor));
    this.worldTerrains.set(actor.id, document.document);
    // New, or back after a delete whose Save pruned its level-owned files:
    // either way the next Save writes every tile.
    const session = this.worldTerrainSessions.get(document.document);
    session?.markTiles(document.document.tiles.keys());
    const object = this.createLandscapeObjectFor(actor);
    this.applyWireframeToLevelObject(object);
    this.landscapeObjects.splice(insertionIndex, 0, object);
    this.scene.add(object);
    this.refreshLandscapeIndices();
    this.rebuildFoliageRing();
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
      this.worldTerrains.delete(removed.id);
    }
    this.refreshLandscapeIndices();
    this.rebuildFoliageRing();
    return removed ? cloneLandscape(removed) : null;
  }

  /**
   * Adds a flat Landscape centred on the world origin and selects it (undoable).
   * One tile is the classic single-grid Landscape, edited through the 1x1
   * adapter; more tiles make a multi-tile World Terrain. Either way the next
   * Save writes the level's terrain folder before the level that references it.
   * `world` (New Open World, Faz 8) sets the level's partition and view
   * distance and fits the Height Fog in the same undo step; `heightmap` gives
   * the new terrain its heights instead of a flat grid.
   */
  addLandscape(
    options: WorldTerrainCreateOptions,
    world: OpenWorldSetup | null = null,
    heightmap: WorldTerrainHeightmapSource | null = null,
  ): void {
    if (!this.layout || !this.activeProject) return;
    const landscapes = this.layout.landscapes ?? [];
    if (landscapes.length > 0) {
      this.onStatus?.("Only one Landscape is supported per level in this build; delete the current one first.", "error");
      return;
    }
    let loaded: WorldTerrainDocument;
    try {
      loaded = heightmap ? createWorldTerrainFromHeightmap(options, heightmap) : createFlatWorldTerrain(options);
    } catch (error) {
      this.onStatus?.(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    const id = uniqueLandscapeId(landscapes);
    const actor: LayoutLandscape = {
      id,
      name: uniqueLandscapeName(loaded.def.name, landscapes),
      position: worldTerrainActorPosition(loaded.def),
      dataRef: levelTerrainPath(this.activeProject.manifest.editor.defaultScene, id),
    };
    // New multi-tile terrains use compact u16 heights (OPEN_WORLD_PLAN K1); a
    // single tile keeps the Float32 heights the 1x1 Landscape always saved.
    const terrain: TerrainActorDocument = {
      kind: "world", document: this.editableWorldTerrain(actor.dataRef, loaded, isMultiTileTerrain(loaded.def) ? "u16" : "f32"),
    };
    const index = landscapes.length;
    const previousSettings = this.getWorldSettings();
    let nextSettings = previousSettings;
    if (world) {
      const { viewDistance: _viewDistance, partition: _partition, ...kept } = previousSettings;
      const partition = openWorldPartitionSettings(world, this.layout.worldSettings?.partition);
      nextSettings = {
        ...kept,
        ...(world.viewDistance !== null ? { viewDistance: world.viewDistance } : {}),
        ...(partition ? { partition } : {}),
      };
    }
    const settingsChange = !worldSettingsEqual(previousSettings, nextSettings);
    const previousFog = this.layout.heightFog ? { ...this.layout.heightFog } : undefined;
    const nextFog = world?.fitFog && world.viewDistance !== null
      ? { ...(previousFog ?? {}), ...openWorldFogPatch(world.viewDistance) }
      : previousFog;
    const fogChange = nextFog !== previousFog;
    this.executeCommand({
      label: settingsChange || fogChange ? "Create Open World" : "Add Landscape",
      redo: () => {
        this.insertLandscape(index, actor, terrain);
        if (settingsChange) this.applyWorldSettings(nextSettings);
        if (fogChange) this.applyFogState(nextFog);
        this.select({ kind: "landscape", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        if (fogChange) this.applyFogState(previousFog);
        if (settingsChange) this.applyWorldSettings(previousSettings);
        this.removeLandscapeAt(index);
        this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
    });
    const [width, depth] = worldTerrainExtent(loaded.def);
    const extras = [
      settingsChange ? "world settings" : "",
      fogChange ? (previousFog ? "fitted Height Fog" : "added Height Fog") : "",
    ].filter(Boolean);
    this.onStatus?.(`Added Landscape${heightmap ? " from a heightmap" : ""}: ${loaded.def.tilesX} × ${loaded.def.tilesZ} tiles, ${width} m × ${depth} m${
      extras.length > 0 ? `; updated ${extras.join(" and ")}` : ""}.`, "info");
  }

  /**
   * A World Terrain of exactly one tile, with that tile: the terrain the
   * single-tile Resolution, World Size and resampling PNG import act on
   * (OPEN_WORLD_PLAN Faz 8, bridge removal K2). Null for a multi-tile one.
   */
  private singleTileWorldTerrain(id: string): { document: WorldTerrainDocument; tile: TerrainTileData } | null {
    const document = this.worldTerrains.get(id);
    if (!document || document.def.tilesX !== 1 || document.def.tilesZ !== 1) return null;
    const tile = document.tiles.get(tileKey(0, 0));
    return tile ? { document, tile } : null;
  }

  /**
   * Swaps a World Terrain's whole document (grid changes: resolution, world
   * size) in one undo step; undo puts the previous document object back, and
   * either way the next Save writes the definition and every tile.
   */
  private replaceWorldTerrainDocument(
    index: number, label: string, next: WorldTerrainDocument, status: string, newTileFormat: TerrainHeightFormat = "f32",
  ): void {
    const actor = this.layout?.landscapes?.[index];
    const previous = actor ? this.worldTerrains.get(actor.id) : undefined;
    if (!actor || !previous) return;
    const before = cloneLandscape(actor);
    const document = this.editableWorldTerrain(actor.dataRef, next, newTileFormat);
    const after = { ...cloneLandscape(actor), position: worldTerrainActorPosition(document.def) };
    const swap = (landscape: LayoutLandscape, terrain: WorldTerrainDocument): void => {
      this.removeLandscapeAt(index);
      this.insertLandscape(index, landscape, { kind: "world", document: terrain });
      this.worldTerrainSessions.get(terrain)?.markDefinitionDirty();
      void this.buildRiverWaters();
      this.rebuildLakes();
      this.select({ kind: "landscape", index });
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => swap(after, document), undo: () => swap(before, previous) });
    this.onStatus?.(status, "info");
  }

  /** The selected single-tile Landscape, for the editor-only expansion dialog. */
  getSelectedLandscapeExpansionSource(): (WorldTerrainExpansionSource & { actorId: string }) | null {
    if (this.selection?.kind !== "landscape") return null;
    const actor = this.layout?.landscapes?.[this.selection.index];
    if (!actor) return null;
    const single = this.singleTileWorldTerrain(actor.id);
    if (!single) return null;
    const { def } = single.document;
    return { actorId: actor.id, tileQuads: def.tileQuads, tileEdge: def.tileQuads * def.spacing,
      problems: (options) => singleTileExpandProblems(def, options) };
  }

  /** Replaces one authored grid in a single undo step; foliage is already world-space. */
  expandSelectedLandscapeToWorldTerrain(id: string, options: WorldTerrainExpandOptions): void {
    if (!this.activeProject || this.selection?.kind !== "landscape" || this.isSelectionLocked(this.selection)) return;
    const index = this.selection.index;
    const current = this.layout?.landscapes?.[index];
    if (!current || current.id !== id) {
      this.onStatus?.("Landscape selection changed; expansion cancelled.", "warning");
      return;
    }
    const single = this.singleTileWorldTerrain(id);
    if (!single) return;
    const expanded = expandSingleTileWorldTerrain(single.document, options);
    if (!expanded.ok) {
      this.onStatus?.(expanded.reasons.join(" "), "error");
      return;
    }
    // The original tile keeps its own height format; new tiles match it.
    const format = (single.tile as Partial<DecodedTerrainTile>).heightFormat ?? "f32";
    this.replaceWorldTerrainDocument(index, "Expand Landscape", expanded.document,
      `Expanded Landscape to ${options.tilesX} × ${options.tilesZ} tiles.`, format);
  }

  /** Removes a Landscape actor (undoable). */
  removeLandscape(index: number): void {
    const actor = this.layout?.landscapes?.[index];
    const world = actor ? this.worldTerrains.get(actor.id) : undefined;
    const streaming = world ? this.worldTerrainStreams.get(world) : undefined;
    if (!actor || !world || !streaming || streaming.allResident) {
      this.commitRemoveLandscape(index);
      return;
    }
    // Save prunes a deleted level terrain's files, and undo restores only what
    // memory holds: hold every tile first so undo can write the whole grid.
    void this.loadWholeWorldTerrain(world, "delete it").then(() => {
      const current = this.layout?.landscapes?.findIndex((entry) => entry.id === actor.id) ?? -1;
      if (current >= 0 && this.worldTerrains.get(actor.id) === world) this.commitRemoveLandscape(current);
    }, (error: unknown) => {
      this.onStatus?.(`Landscape not deleted: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }

  private commitRemoveLandscape(index: number): void {
    const actor = this.layout?.landscapes?.[index];
    if (!actor) return;
    const snapshot = cloneLandscape(actor);
    const document = this.terrainActorDocument(actor.id);
    this.executeCommand({
      label: "Delete Landscape",
      redo: () => {
        this.removeLandscapeAt(index);
        if (this.selection?.kind === "landscape") this.select(null);
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      },
      undo: () => {
        if (document) this.insertLandscape(index, snapshot, document);
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

  /** Water bodies whose spline and presentation are owned by the selected Landscape. */
  getSelectedLandscapeRiverWaters(): RiverWaterDetailsView[] {
    if (this.selection?.kind !== "landscape") return [];
    const landscape = this.layout?.landscapes?.[this.selection.index];
    if (!landscape) return [];
    const data = this.landscapeSplineSource(landscape.id);
    return (this.layout?.riverWaters ?? [])
      .filter((water) => water.landscapeRef === landscape.id)
      .map((water) => {
        const resolved = resolveRiverWater(water);
        const spline = data?.splines?.find((entry) => entry.id === resolved.splineRef);
        const origin = this.worldTerrains.get(landscape.id)?.def;
        const frame = origin ? worldTerrainActorPosition(origin) : [0,0,0];
        const point = spline?.points[0]?.position ?? [0,0,0];
        const conversion = (resolved.coordinateSpace === "world" ? 1 : 0) - (spline?.coordinateSpace === "world" ? 1 : 0);
        return {
          contactOrigin: [point[0]! + frame[0]! * conversion, resolved.surfaceLevel, point[2]! + frame[2]! * conversion] as Vec3,
          id: resolved.id,
          ...(resolved.coordinateSpace ? { coordinateSpace: resolved.coordinateSpace } : {}),
          name: resolved.name,
          splineRef: resolved.splineRef,
          surfaceLevel: resolved.surfaceLevel,
          widthScale: resolved.widthScale,
          flowSpeed: resolved.flowSpeed,
          normalScale: resolved.normalScale,
          normalTexture: resolved.normalTexture,
          deepColor: resolved.deepColor,
          shallowColor: resolved.shallowColor,
          opacity: resolved.opacity,
          bedVisibility: resolved.bedVisibility,
          absorptionDistance: resolved.absorptionDistance,
          waveAmplitude: resolved.waveAmplitude,
          waveLength: resolved.waveLength,
          foamColor: resolved.foamColor,
          foamOpacity: resolved.foamOpacity,
          shoreWaveSpacing: resolved.shoreWaveSpacing,
          shoreWaveSpeed: resolved.shoreWaveSpeed,
          shoreWaveReach: resolved.shoreWaveReach,
          shoreWaveBreakupScale: resolved.shoreWaveBreakupScale,
          reflectionMode: resolved.reflectionMode,
          reflectionGroup: resolved.reflectionGroup ?? "",
          reflectionQuality: resolved.reflectionQuality,
          reflectionStrength: resolved.reflectionStrength,
          ...(resolved.contactFoam ? { contactFoam: structuredClone(resolved.contactFoam) } : {}),
          ...(resolved.geometryFoam ? { geometryFoam: structuredClone(resolved.geometryFoam) } : {}),
          ...(resolved.caustics ? { caustics: structuredClone(resolved.caustics) } : {}),
          ...(resolved.shoreWetness ? { shoreWetness: structuredClone(resolved.shoreWetness) } : {}),
          foamStamps: resolved.foamStamps.map((stamp) => ({
            ...stamp,
            position: [...stamp.position] as Vec3,
            ...(stamp.endPosition ? { endPosition: [...stamp.endPosition] as Vec3 } : {}),
          })),
          segmentProfiles: resolved.segmentProfiles.map((profile) => ({ ...profile })),
          splineSegments: (spline?.segments ?? []).map((segment) => ({
            id: segment.id,
            startPointId: segment.startPointId,
            endPointId: segment.endPointId,
          })),
        };
      });
  }

  /** Applies one undoable River Water Body presentation edit and refreshes its live ribbon. */
  setSelectedLandscapeRiverWater(waterId: string, patch: RiverWaterDetailsPatch): void {
    if (this.selection?.kind !== "landscape") return;
    const landscape = this.layout?.landscapes?.[this.selection.index];
    const waters = this.layout?.riverWaters;
    if (!landscape || landscape.locked || !waters) return;
    const index = waters.findIndex((water) => water.id === waterId && water.landscapeRef === landscape.id);
    if (index < 0) return;

    const previous = cloneRiverWater(waters[index]!);
    const next = cloneRiverWater(previous);
    if (patch.surfaceLevel !== undefined) next.surfaceLevel = Number(clamp(patch.surfaceLevel, -10000, 10000).toFixed(3));
    if (patch.widthScale !== undefined) next.widthScale = Number(clamp(patch.widthScale, 0.05, 10).toFixed(3));
    if (patch.flowSpeed !== undefined) next.flowSpeed = Number(clamp(patch.flowSpeed, 0, 10).toFixed(3));
    if (patch.normalScale !== undefined) next.normalScale = Number(clamp(patch.normalScale, 0.05, 20).toFixed(3));
    if (patch.deepColor !== undefined) next.deepColor = patch.deepColor;
    if (patch.shallowColor !== undefined) next.shallowColor = patch.shallowColor;
    if (patch.opacity !== undefined) next.opacity = Number(clamp(patch.opacity, 0, 1).toFixed(3));
    if (patch.bedVisibility !== undefined) next.bedVisibility = Number(clamp(patch.bedVisibility, 0, 1).toFixed(3));
    if (patch.absorptionDistance !== undefined) next.absorptionDistance = Number(clamp(patch.absorptionDistance, 0.01, 100).toFixed(3));
    if (patch.waveAmplitude !== undefined) next.waveAmplitude = Number(clamp(patch.waveAmplitude, 0, 1).toFixed(3));
    if (patch.waveLength !== undefined) next.waveLength = Number(clamp(patch.waveLength, 0.1, 100).toFixed(3));
    if (patch.foamColor !== undefined) next.foamColor = patch.foamColor;
    if (patch.foamOpacity !== undefined) next.foamOpacity = Number(clamp(patch.foamOpacity, 0, 1).toFixed(3));
    if (patch.shoreWaveSpacing !== undefined) next.shoreWaveSpacing = Number(clamp(patch.shoreWaveSpacing, 0.5, 20).toFixed(3));
    if (patch.shoreWaveSpeed !== undefined) next.shoreWaveSpeed = Number(clamp(patch.shoreWaveSpeed, 0, 10).toFixed(3));
    if (patch.shoreWaveReach !== undefined) next.shoreWaveReach = Number(clamp(patch.shoreWaveReach, 0.05, 1).toFixed(3));
    if (patch.shoreWaveBreakupScale !== undefined) next.shoreWaveBreakupScale = Number(clamp(patch.shoreWaveBreakupScale, 0.1, 10).toFixed(3));
    if (patch.reflectionMode !== undefined) next.reflectionMode = patch.reflectionMode === "environment" ? "environment" : "off";
    if (patch.reflectionGroup !== undefined) {
      const group = patch.reflectionGroup.trim();
      if (group) next.reflectionGroup = group;
      else delete next.reflectionGroup;
    }
    if (patch.reflectionQuality !== undefined) {
      next.reflectionQuality = patch.reflectionQuality === "low" || patch.reflectionQuality === "high"
        ? patch.reflectionQuality
        : "medium";
    }
    if (patch.reflectionStrength !== undefined) {
      next.reflectionStrength = Number(clamp(patch.reflectionStrength, 0, 1).toFixed(3));
    }
    if(patch.geometryFoam!==undefined)next.geometryFoam=validateLakeGeometryFoam(patch.geometryFoam);
    if(patch.caustics!==undefined)next.caustics=validateWaterCaustics(patch.caustics);
    if(patch.shoreWetness!==undefined)next.shoreWetness=validateWaterShoreWetness(patch.shoreWetness);
    if (patch.contactFoam !== undefined) next.contactFoam = validateWaterContactFoam(patch.contactFoam);
    if (patch.foamStamps !== undefined) {
      next.foamStamps = patch.foamStamps.map((stamp) => ({
        ...stamp,
        kind: stamp.kind === "strip" ? "strip" : "point",
        position: [...stamp.position] as Vec3,
        ...(stamp.kind === "strip" && stamp.endPosition
          ? { endPosition: [...stamp.endPosition] as Vec3 }
          : {}),
        radius: Number(clamp(stamp.radius, 0.1, 100).toFixed(3)),
        intensity: Number(clamp(stamp.intensity, 0, 1).toFixed(3)),
      }));
    }
    if (patch.segmentProfiles !== undefined) {
      next.segmentProfiles = patch.segmentProfiles.map((profile) => ({
        splineSegmentRef: profile.splineSegmentRef,
        ...(profile.flowSpeedMultiplier !== undefined
          ? { flowSpeedMultiplier: Number(clamp(profile.flowSpeedMultiplier, 0, 10).toFixed(3)) }
          : {}),
        ...(profile.rapidness !== undefined ? { rapidness: Number(clamp(profile.rapidness, 0, 1).toFixed(3)) } : {}),
      }));
    }
    if (JSON.stringify(previous) === JSON.stringify(next)) return;

    const apply = (value: LayoutRiverWater): void => {
      if (!this.layout?.riverWaters?.[index]) return;
      this.layout.riverWaters[index] = cloneRiverWater(value);
      void this.buildRiverWaters();
      this.refreshRiverWaterFoamOverlay(this.selection?.kind === "landscape" ? this.selection.index : undefined);
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: "Edit River Water",
      redo: () => apply(next),
      undo: () => apply(previous),
    });
  }

  /** Arms one-click placement of a radial foam point on the selected Landscape. */
  beginSelectedLandscapeRiverWaterRingFoam(waterId: string): void {
    const water = this.getSelectedLandscapeRiverWaters().find((entry) => entry.id === waterId);
    if (!water) return;
    this.setLandscapeSculptSettings({
      activeRiverWaterId: waterId,
      riverWaterRingFoamPlacementId: waterId,
      activeRiverWaterFoamStampId: null,
      activeRiverWaterFoamStampAnchor: null,
    });
    this.onStatus?.("Click the water or terrain to place Radial Foam.", "info");
  }

  removeSelectedLandscapeRiverWaterFoamStamp(waterId: string, stampId: string): void {
    const water = this.getSelectedLandscapeRiverWaters().find((entry) => entry.id === waterId);
    if (!water) return;
    this.setSelectedLandscapeRiverWater(waterId, {
      foamStamps: water.foamStamps.filter((stamp) => stamp.id !== stampId),
    });
    if (this.landscapeSculptSettings.activeRiverWaterFoamStampId === stampId) {
      this.setLandscapeSculptSettings({ activeRiverWaterFoamStampId: null, activeRiverWaterFoamStampAnchor: null });
    }
  }

  /** Removes the visual water body only; its Landscape spline and terrain bed remain authored. */
  deleteSelectedLandscapeRiverWater(waterId: string): void {
    if (this.selection?.kind !== "landscape") return;
    const landscape = this.layout?.landscapes?.[this.selection.index];
    const waters = this.layout?.riverWaters;
    if (!landscape || landscape.locked || !waters) return;
    const target = waters.find((water) => water.id === waterId && water.landscapeRef === landscape.id);
    if (!target) return;

    // `waters` above was read from the present layout field, so undo restores it.
    const hadRiverWaters = true;
    const before = waters.map(cloneRiverWater);
    const after = before.filter((water) => water.id !== waterId);
    const nextActiveRiverWaterId = after.find((water) => water.landscapeRef === landscape.id)?.id ?? null;
    const apply = (value: LayoutRiverWater[], present: boolean, activeRiverWaterId: string | null): void => {
      if (!this.layout) return;
      if (present) this.layout.riverWaters = value.map(cloneRiverWater);
      else delete this.layout.riverWaters;
      this.landscapeSculptSettings = { ...this.landscapeSculptSettings, activeRiverWaterId };
      void this.buildRiverWaters();
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: "Delete River Water",
      redo: () => apply(after, after.length > 0, nextActiveRiverWaterId),
      undo: () => apply(before, hadRiverWaters, target.id),
    });
    this.onStatus?.("River Water deleted; its Landscape spline remains available.", "info");
  }

  /** Creates a visible River Water Body from one complete spline on the selected Landscape. */
  createSelectedLandscapeRiverWater(splineId: string): void {
    if (this.selection?.kind !== "landscape") return;
    const landscape = this.layout?.landscapes?.[this.selection.index];
    const data = landscape ? this.landscapeSplineSource(landscape.id) : null;
    if (!landscape || landscape.locked || !data) return;
    const spline = data.splines?.find((entry) => entry.id === splineId);
    if (!spline || spline.points.length < 2 || spline.segments.length < 1) return;
    const existing = this.layout?.riverWaters ?? [];
    if (existing.some((water) => water.landscapeRef === landscape.id && water.splineRef === spline.id)) return;

    const firstPoint = spline.points[0]!;
    const water: LayoutRiverWater = {
      id: uniqueRiverWaterId(existing),
      name: `River Water ${existing.filter((entry) => entry.landscapeRef === landscape.id).length + 1}`,
      landscapeRef: landscape.id,
      splineRef: spline.id,
      ...(this.worldTerrains.has(landscape.id) ? { coordinateSpace: "world" as const } : {}),
      // Begin 0.1 units above the first point's authored bed elevation; the
      // ribbon preserves this offset along the spline's elevation profile.
      surfaceLevel: Number((firstPoint.position[1] + 0.1).toFixed(3)),
    };
    const hadRiverWaters = this.layout?.riverWaters !== undefined;
    const before = existing.map(cloneRiverWater);
    const after = [...before, water];
    const apply = (value: LayoutRiverWater[], present: boolean, activeRiverWaterId: string | null): void => {
      if (!this.layout) return;
      if (present) this.layout.riverWaters = value.map(cloneRiverWater);
      else delete this.layout.riverWaters;
      this.landscapeSculptSettings = { ...this.landscapeSculptSettings, activeRiverWaterId };
      void this.buildRiverWaters();
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: "Create River Water",
      redo: () => apply(after, true, water.id),
      undo: () => apply(before, hadRiverWaters, null),
    });
    this.onStatus?.("River Water created from Landscape spline.", "info");
  }

  /**
   * Resolved paint layers for the selected landscape: each layer's display name
   * and swatch follow its assigned material (falling back to the built-in preset).
   * Returns the preset four layers if no landscape is selected.
   */
  getSelectedLandscapeLayers(): LandscapeLayerView[] {
    const presets = LANDSCAPE_DEFAULT_LAYERS;
    const presetById = new Map(presets.map((preset) => [preset.id as string, preset] as const));
    const selectedId = this.selection?.kind === "landscape" ? this.layout?.landscapes?.[this.selection.index]?.id ?? "" : "";
    const layers = this.worldTerrains.get(selectedId)?.def.layers;
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
        physicalMaterial: ("physicalMaterial" in layer && layer.physicalMaterial) || null,
      };
    });
  }

  getSelectedLandscapeSplines(): LandscapeSplineView[] {
    if (this.selection?.kind !== "landscape") return [];
    const actor = this.layout?.landscapes?.[this.selection.index];
    const splines = actor ? this.landscapeSplineSource(actor.id)?.splines : undefined;
    return (splines ?? []).map((spline) => ({
      id: spline.id,
      name: spline.name ?? spline.id,
      pointCount: spline.points.length,
      segmentCount: spline.segments.length,
      smooth: spline.smooth === true,
    }));
  }

  getSelectedLandscapeSplinePoints(): LandscapeSplinePointView[] {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return [];
    const actor = this.layout?.landscapes?.[this.selection.index];
    const spline = actor
      ? this.landscapeSplineSource(actor.id)?.splines?.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId)
      : undefined;
    return (spline?.points ?? []).map((point) => ({ id: point.id, position: [...point.position] as Vec3, width: point.width, falloff: point.falloff }));
  }

  getSelectedLandscapeSplineSegments(): LandscapeSplineSegmentView[] {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return [];
    const actor = this.layout?.landscapes?.[this.selection.index];
    const spline = actor ? this.landscapeSplineSource(actor.id)?.splines?.find((entry) => entry.id === this.landscapeSculptSettings.activeSplineId) : undefined;
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
        layerId: segment.paint?.layerId ?? this.defaultLandscapeSplinePaintLayer(),
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
        collision: segment.mesh?.collision !== false,
      },
    }));
  }

  /** Updates the supplied segments together as one undoable deform/paint/mesh edit. */
  setSelectedLandscapeSplineSegment(segmentId: string | readonly string[], patch: LandscapeSplineSegmentPatch): void {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
    if (!actor || actor.locked || !data || this.worldTerrainSplineBusy) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const ids = new Set(typeof segmentId === "string" ? [segmentId] : segmentId);
    const segments = after
      .find((spline) => spline.id === this.landscapeSculptSettings.activeSplineId)
      ?.segments.filter((entry) => ids.has(entry.id)) ?? [];
    if (!segments.length) return;
    for (const segment of segments) {
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
        const current = segment.paint ?? { enabled: false, layerId: this.defaultLandscapeSplinePaintLayer(), strength: 1 };
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
        if (!assetId) delete segment.mesh;
        else segment.mesh = {
          enabled: patch.mesh.enabled ?? current.enabled,
          assetId,
          ...(patch.mesh.spacing ?? current.spacing
            ? { spacing: Math.max(0.01, round(patch.mesh.spacing ?? current.spacing ?? 2)) }
            : {}),
          ...(yawOffset ? { yawOffset } : {}),
          ...((patch.mesh.fitToLength ?? current.fitToLength) === false ? { fitToLength: false } : {}),
          ...(current.scale ? { scale: current.scale } : {}),
          ...(current.offset ? { offset: current.offset } : {}),
          ...((patch.mesh.alignToTerrain ?? current.alignToTerrain) ? { alignToTerrain: true } : {}),
          ...(bank ? { bank } : {}),
          ...((patch.mesh.deform ?? current.deform) ? { deform: true } : {}),
          ...((patch.mesh.collision ?? current.collision) === false ? { collision: false } : {}),
        };
      }
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Edit Landscape Spline Segments", this.landscapeSculptSettings.activeSplineId, this.landscapeSculptSettings.activeSplinePointId, typeof segmentId === "string" ? segmentId : this.landscapeSculptSettings.activeSplineSegmentId ?? segments[0]!.id);
  }

  /** Destructively bakes the active spline's deform config into the heightfield (undoable). */
  applySelectedLandscapeSplineDeform(): void {
    if (this.selection?.kind === "landscape" && this.isWorldTerrainSelection(this.selection)) {
      void this.applyWorldTerrainSpline("deform");
    }
  }

  /** Destructively bakes the active spline's paint config into the paint layers (undoable). */
  applySelectedLandscapeSplinePaint(): void {
    if (this.selection?.kind === "landscape" && this.isWorldTerrainSelection(this.selection)) {
      void this.applyWorldTerrainSpline("paint");
    }
  }

  createSelectedLandscapeSpline(): void {
    if (this.selection?.kind !== "landscape") return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const used = new Set(before.map((entry) => entry.id));
    let number = 1;
    while (used.has(`spline-${number}`)) number++;
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
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
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
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
    if (!actor || !data) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = before.filter((spline) => spline.id !== splineId);
    if (after.length === before.length) return;
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Delete Landscape Spline", after[0]?.id ?? null);
  }

  setSelectedLandscapeSplinePointPosition(pointId: string, position: Vec3): void {
    this.setSelectedLandscapeSplinePoints([pointId], { x: position[0], y: position[1], z: position[2] });
  }

  /** Changes only the supplied fields, across all selected points, in one undo step. */
  setSelectedLandscapeSplinePoints(pointIds: readonly string[], patch: { x?: number; y?: number; z?: number; width?: number; falloff?: number }): void {
    if (this.selection?.kind !== "landscape" || Object.values(patch).some((value) => !Number.isFinite(value))) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
    const splineId = this.landscapeSculptSettings.activeSplineId;
    if (!actor || actor.locked || !data || !splineId || this.worldTerrainSplineBusy) return;
    const before = cloneLandscapeSplines(data.splines ?? []);
    const after = cloneLandscapeSplines(before);
    const ids = new Set(pointIds);
    const points = after.find((spline) => spline.id === splineId)?.points.filter((entry) => ids.has(entry.id)) ?? [];
    if (!points.length) return;
    for (const point of points) {
      for (const [axis, key] of (["x", "y", "z"] as const).entries()) {
        if (patch[key] !== undefined) point.position[axis] = round(patch[key]!);
      }
      if (patch.width !== undefined) point.width = round(clamp(patch.width, 0.1, 10000));
      if (patch.falloff !== undefined) point.falloff = round(clamp(patch.falloff, 0, 10000));
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.applySelectedLandscapeSplines(index, actor.id, before, after, "Edit Landscape Spline Points", splineId,
      this.landscapeSculptSettings.activeSplinePointId ?? points[0]!.id, this.landscapeSculptSettings.activeSplineSegmentId);
  }

  async snapSelectedLandscapeSplinePoint(): Promise<void> {
    const index = this.selectedEditableLandscapeIndex();
    const actor = index === null ? undefined : this.layout?.landscapes?.[index];
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    const splineId = this.landscapeSculptSettings.activeSplineId;
    const pointId = this.landscapeSculptSettings.activeSplinePointId;
    const point = document?.def.splines?.find((spline) => spline.id === splineId)?.points.find((point) => point.id === pointId);
    if (!actor || !document || !point || !pointId || this.worldTerrainSplineBusy) return;
    const position = [...point.position] as Vec3;
    const revision = JSON.stringify(document.def.splines);
    const keys = terrainBrushTileKeys(document.def, position[0], position[2], 0);
    const streaming = this.worldTerrainStreams.get(document);
    this.worldTerrainSplineBusy = true;
    try {
      await streaming?.demand(keys);
      if (this.worldTerrains.get(actor.id) !== document || this.selectedEditableLandscapeIndex() !== index
        || this.landscapeSculptSettings.activeSplineId !== splineId || this.landscapeSculptSettings.activeSplinePointId !== pointId
        || JSON.stringify(document.def.splines) !== revision) return;
      const height = terrainHeightAt(document.def, { tile: (x, z) => document.tiles.get(tileKey(x, z)) }, position[0], position[2]);
      if (height === null) throw new Error("Exact terrain is unavailable at this point");
      this.worldTerrainSplineBusy = false;
      this.setSelectedLandscapeSplinePointPosition(pointId, [position[0], height, position[2]]);
    } catch (error) { this.onStatus?.(`Snap to terrain failed: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    finally { streaming?.release(keys); this.worldTerrainSplineBusy = false; }
  }

  setSelectedLandscapeSplinePointShape(pointId: string, patch: { width?: number; falloff?: number }): void {
    if (this.selection?.kind !== "landscape" || !this.landscapeSculptSettings.activeSplineId) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
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
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
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
    const data = actor ? this.landscapeSplineSource(actor.id) : null;
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
    if (this.layout?.landscapes?.[index]?.locked) return;
    const document = this.worldTerrains.get(landscapeId);
    const selection: Selection = { kind: "landscape", index };
    const apply = (splines: ForgeLandscapeSpline[]): void => {
      if (document && this.worldTerrains.get(landscapeId) !== document) return;
      const data = this.landscapeSplineSource(landscapeId);
      if (!data) return;
      data.splines = cloneLandscapeSplines(splines).map((spline) => document ? { ...spline, coordinateSpace: "world" as const } : spline);
      this.markLandscapeSplineDirty(landscapeId);
      this.setLandscapeSculptSettings({ activeSplineId, activeSplinePointId, activeSplineSegmentId });
      void this.rebuildLandscapeSplineMeshes(index);
      // River Water Bodies reference the same sidecar spline, so an editor point,
      // width or smoothness edit must rebuild their ribbon too. The mesh remains
      // visual-only and is never used as terrain/collision authority.
      void this.buildRiverWaters();
      this.select(selection);
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({ label, redo: () => apply(after), undo: () => apply(before) });
  }

  private async applyWorldTerrainSpline(effect: TerrainSplineEffect): Promise<void> {
    const index = this.selectedEditableLandscapeIndex();
    const actor = index === null ? undefined : this.layout?.landscapes?.[index];
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    const session = document ? this.worldTerrainSessions.get(document) : undefined;
    const source = document?.def.splines?.find((spline) => spline.id === this.landscapeSculptSettings.activeSplineId);
    if (!actor || !document || !session || !source || this.worldTerrainSplineBusy) return;
    const spline: WorldTerrainSpline = { ...structuredClone(source), coordinateSpace: "world" };
    const revision = JSON.stringify(document.def.splines);
    let keys: string[] = [];
    const streaming = this.worldTerrainStreams.get(document);
    this.worldTerrainSplineBusy = true;
    try {
      keys = terrainSplineTileKeys(document.def, spline, effect);
      if (streaming) this.onStatus?.("Loading terrain for spline effects…", "info");
      await streaming?.demand(keys);
      if (this.worldTerrains.get(actor.id) !== document || this.selectedEditableLandscapeIndex() !== index
        || this.landscapeSculptSettings.activeSplineId !== spline.id || this.landscapeSculptSettings.editMode !== "splines"
        || JSON.stringify(document.def.splines) !== revision) return;
      const patches = createTerrainSplinePatches(session.world, spline, effect);
      if (patches.length === 0) { this.onStatus?.(`No spline ${effect} change: enable the segment effect and adjust its settings.`, "info"); return; }
      this.executeTerrainPatchCommand(effect === "deform" ? "Apply Spline Terrain Deform" : "Apply Spline Layer Paint", actor.id, document, patches);
      this.onStatus?.(`Spline ${effect} applied (${patches.length} tiles).`, "info");
    } catch (error) { this.onStatus?.(`Spline ${effect} failed: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    finally { streaming?.release(keys); this.worldTerrainSplineBusy = false; }
  }

  /**
   * Assigns (or clears, with `null`) the material of one paint layer on the
   * selected landscape. Undoable; the layer's display name and terrain tint then
   * follow the material. Only the layer's `material` changes — weights are kept.
   */
  async addSelectedLandscapeLayer(): Promise<void> {
    if (this.selection?.kind !== "landscape" || this.isSelectionLocked(this.selection)) return;
    const actor = this.layout?.landscapes?.[this.selection.index];
    if (!actor) return;
    const document = this.worldTerrains.get(actor.id);
    const session = document ? this.worldTerrainSessions.get(document) : undefined;
    const layers = document?.def.layers;
    if (!document || !session || !layers || layers.length >= 8) return;
    const id = Array.from({ length: 9 }, (_, i) => `layer-${i + 1}`).find((id) => !layers.some((layer) => layer.id === id))!;
    const layer = { id, name: `Layer ${layers.length + 1}`, color: "#55493b" };
    try {
      await this.loadWholeWorldTerrain(document, "add a paint layer");
      if (this.selection?.kind !== "landscape" || this.layout?.landscapes?.[this.selection.index]?.id !== actor.id
        || this.isSelectionLocked(this.selection) || this.worldTerrains.get(actor.id) !== document) return;
      const refresh = (): void => {
        const index = this.layout?.landscapes?.findIndex((entry) => entry.id === actor.id) ?? -1;
        if (index < 0) return;
        this.rebuildLandscapeObject(index);
        this.select({ kind: "landscape", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      };
      const addition = createTerrainLayerAddition(session.world, layer);
      const apply = (state: typeof addition.before): void => {
        if (this.worldTerrains.get(actor.id) !== document) return;
        applyTerrainLayerState(session.world, state);
        document.globalAttributes = buildTerrainGlobalAttributes(worldTerrainRenderSource(document.def, document.tiles));
        session.markTiles(document.tiles.keys());
        session.markDefinitionDirty();
        this.landscapeSculptSettings.activeLayerId = state.layers.some((entry) => entry.id === id) ? id : state.layers[0]!.id;
        refresh();
      };
      this.executeCommand({ label: "Add Landscape Paint Layer", redo: () => apply(addition.after), undo: () => apply(addition.before) });
    } catch (error) {
      this.onStatus?.(`Add layer failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      this.worldTerrainStreams.get(document)?.release();
    }
  }

  /**
   * Removes one paint layer from the selected landscape as one undo command;
   * its weight goes to the remaining layers (`createTerrainLayerRemoval`). A
   * multi-tile terrain loads every tile first and rewrites all of them plus
   * the definition on Save, like Add Layer. The active layer moves to the
   * first remaining one; undo restores the exact weights and selection.
   */
  async removeSelectedLandscapeLayer(layerId: string): Promise<void> {
    if (this.selection?.kind !== "landscape" || this.isSelectionLocked(this.selection)) return;
    const actor = this.layout?.landscapes?.[this.selection.index];
    if (!actor) return;
    const document = this.worldTerrains.get(actor.id);
    const session = document ? this.worldTerrainSessions.get(document) : undefined;
    const layers = document?.def.layers;
    if (!document || !session || !layers || layers.length <= 1 || !layers.some((layer) => layer.id === layerId)) return;
    try {
      await this.loadWholeWorldTerrain(document, "remove a paint layer");
      if (this.selection?.kind !== "landscape" || this.layout?.landscapes?.[this.selection.index]?.id !== actor.id
        || this.isSelectionLocked(this.selection) || this.worldTerrains.get(actor.id) !== document) return;
      const refresh = (activeLayerId: string): void => {
        this.landscapeSculptSettings.activeLayerId = activeLayerId;
        const index = this.layout?.landscapes?.findIndex((entry) => entry.id === actor.id) ?? -1;
        if (index < 0) return;
        this.rebuildLandscapeObject(index);
        this.select({ kind: "landscape", index });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      };
      const previousActive = this.landscapeSculptSettings.activeLayerId;
      const activeAfter = (remaining: readonly { id: string }[]): string =>
        remaining.some((entry) => entry.id === previousActive) ? previousActive : remaining[0]!.id;
      const removal = createTerrainLayerRemoval(session.world, layerId);
      const nextActive = activeAfter(removal.after.layers);
      const apply = (state: typeof removal.before, activeLayerId: string): void => {
        if (this.worldTerrains.get(actor.id) !== document) return;
        applyTerrainLayerState(session.world, state);
        document.globalAttributes = buildTerrainGlobalAttributes(worldTerrainRenderSource(document.def, document.tiles));
        session.markTiles(document.tiles.keys());
        session.markDefinitionDirty();
        refresh(activeLayerId);
      };
      this.executeCommand({
        label: "Remove Landscape Paint Layer",
        redo: () => apply(removal.after, nextActive),
        undo: () => apply(removal.before, previousActive),
      });
    } catch (error) {
      this.onStatus?.(`Remove layer failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      this.worldTerrainStreams.get(document)?.release();
    }
  }

  setSelectedLandscapeLayerMaterial(layerId: string, materialId: string | null): void {
    if (this.selection?.kind !== "landscape") return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const document = actor ? this.worldTerrains.get(actor.id) : null;
    if (actor && document) {
      const session = this.worldTerrainSessions.get(document);
      const layer = session?.world.def.layers.find((entry) => entry.id === layerId);
      if (!session || !layer || this.isSelectionLocked(this.selection)) return;
      const nextMaterial = materialId && materialId.length > 0 ? materialId : null;
      if ((layer.material ?? null) === nextMaterial) return;
      const before = layer.material;
      const applyMaterial = (material: string | null | undefined): void => {
        const currentIndex = this.layout?.landscapes?.findIndex((entry) => entry.id === actor.id) ?? -1;
        if (currentIndex < 0 || this.worldTerrains.get(actor.id) !== document) return;
        if (material === undefined) delete layer.material;
        else layer.material = material;
        session.markDefinitionDirty();
        this.rebuildLandscapeObject(currentIndex);
        void this.warmLandscapeLayerMaterials(currentIndex);
        this.select({ kind: "landscape", index: currentIndex });
        this.emitSceneObjectsChanged();
        this.scheduleAutoSave();
      };
      this.executeCommand({
        label: nextMaterial ? "Assign Landscape Layer Material" : "Clear Landscape Layer Material",
        redo: () => applyMaterial(nextMaterial),
        undo: () => applyMaterial(before),
      });
    }
  }

  /**
   * Assigns (or clears, with `null`) the physical material of one paint layer on
   * the selected landscape: the surface vehicles feel there (TERRAIN_DEFORMATION
   * Faz 1b). Undoable; nothing visible changes, so the terrain is not rebuilt.
   */
  setSelectedLandscapeLayerPhysicalMaterial(layerId: string, physicalMaterialId: string | null): void {
    if (this.selection?.kind !== "landscape" || this.isSelectionLocked(this.selection)) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    if (!actor) return;
    const next = physicalMaterialId && PHYSICAL_MATERIAL_IDS.includes(physicalMaterialId) ? physicalMaterialId : null;
    const document = this.worldTerrains.get(actor.id);
    const session = document ? this.worldTerrainSessions.get(document) : undefined;
    if (!session) return;
    const findLayer = (): { physicalMaterial?: string | null } | undefined =>
      session.world.def.layers.find((entry) => entry.id === layerId);
    const layer = findLayer();
    if (!layer || (layer.physicalMaterial ?? null) === next) return;
    const before = layer.physicalMaterial;
    const apply = (value: string | null | undefined): void => {
      const layer = findLayer();
      if (!layer || !this.layout?.landscapes?.some((entry) => entry.id === actor.id)) return;
      if (value) layer.physicalMaterial = value;
      else delete layer.physicalMaterial;
      session.markDefinitionDirty();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: next ? "Assign Landscape Layer Physical Material" : "Clear Landscape Layer Physical Material",
      redo: () => apply(next),
      undo: () => apply(before),
    });
  }

  /** Undoable: every vertex becomes 100 % `layerId`. A multi-tile Landscape loads all its tiles first. */
  async fillSelectedLandscapeLayer(layerId = this.landscapeSculptSettings.activeLayerId): Promise<void> {
    if (this.selection?.kind !== "landscape" || this.isSelectionLocked(this.selection)) return;
    const actor = this.layout?.landscapes?.[this.selection.index];
    if (!actor) return;
    const document = this.worldTerrains.get(actor.id);
    const session = document ? this.worldTerrainSessions.get(document) : undefined;
    if (!document || !session) return;
    try {
      await this.loadWholeWorldTerrain(document, "fill a paint layer");
      if (this.selection?.kind !== "landscape" || this.layout?.landscapes?.[this.selection.index]?.id !== actor.id
        || this.isSelectionLocked(this.selection) || this.worldTerrains.get(actor.id) !== document) return;
      const world = session.world;
      const layer = world.def.layers.findIndex((entry) => entry.id === layerId);
      if (layer < 0) return;
      const patches = createTerrainLayerFillPatches(world, layer);
      if (patches.length === 0) {
        this.onStatus?.(`Landscape layer ${layerId} already covers the whole terrain.`, "info");
        return;
      }
      this.executeTerrainPatchCommand("Landscape Fill Layer", actor.id, document, patches);
      this.onStatus?.(`Filled Landscape layer: ${layerId}`, "info");
    } catch (error) {
      this.onStatus?.(`Fill layer failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      if (document) this.worldTerrainStreams.get(document)?.release();
    }
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
    const single = actor ? this.singleTileWorldTerrain(actor.id) : null;
    if (actor && single) {
      const session = this.worldTerrainSessions.get(single.document);
      if (!session || this.isSelectionLocked(this.selection)) return;
      const size = single.document.def.tileQuads + 1;
      try {
        const samples = resampleLandscapeHeightmap(rgba, width, height, { verticesX: size, verticesZ: size }, 1);
        const heights = Float32Array.from(samples, (sample) => Math.round(sample * heightRange * 1_000_000) / 1_000_000);
        const patches = createTerrainHeightmapPatches(session.world, new Map([[tileKey(0, 0), heights]]));
        this.lastLandscapeImportHeight = heightRange;
        this.executeTerrainPatchCommand("Import Landscape Heightmap", actor.id, single.document, patches);
        this.onStatus?.(`Imported ${width} x ${height} heightmap.`, "info");
      } catch (error) {
        this.onStatus?.(error instanceof Error ? error.message : "Heightmap import failed.", "error");
      }
    }
  }

  getSelectedLandscapeImportHeight(): number {
    return this.lastLandscapeImportHeight;
  }

  /**
   * Grid of the selected Landscape's exact 16-bit RAW/PNG heightmap, with the
   * heights 0 and 65535 map to by default: the World Terrain's definition range.
   */
  getSelectedLandscapeHeightmapShape(): LandscapeHeightmapShape | null {
    if (this.selection?.kind !== "landscape") return null;
    const actor = this.layout?.landscapes?.[this.selection.index];
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    if (document) {
      const { def } = document;
      return { width: def.tilesX * def.tileQuads + 1, height: def.tilesZ * def.tileQuads + 1,
        heightMin: def.heightMin, heightMax: def.heightMax, multiTile: true, issues: [] };
    }
    return null;
  }

  /**
   * Replaces every height from a 16-bit RAW or PNG of exactly the grid's size
   * (0/65535 → `heightMin`/`heightMax`, metres relative to terrain origin Y), as
   * one undo command; paint is kept. Wrong sizes are rejected, never resampled.
   */
  async importSelectedLandscapeHeightmapFile(
    file: File, format: HeightmapFileFormat, endianness: "little" | "big", heightMin: number, heightMax: number,
  ): Promise<void> {
    if (this.selection?.kind !== "landscape" || this.isSelectionLocked(this.selection)) return;
    const actor = this.layout?.landscapes?.[this.selection.index];
    const shape = this.getSelectedLandscapeHeightmapShape();
    if (!actor || !shape) return;
    const document = this.worldTerrains.get(actor.id);
    const session = document ? this.worldTerrainSessions.get(document) : undefined;
    if (!document || !session) return;
    const { width, height } = shape;
    const label = format === "png" ? "PNG" : "RAW";
    try {
      if (shape.issues.length > 0) {
        throw new Error(`this grid cannot take a 16-bit heightmap (${shape.issues.join("; ")}); resample it to a preset resolution first.`);
      }
      if (format === "raw" && file.size !== width * height * 2) {
        throw new Error(`RAW expected ${width * height * 2} bytes for ${width} x ${height} samples (16-bit), got ${file.size}.`);
      }
      // Replacing every tile pins every tile (undo needs them all).
      await this.loadWholeWorldTerrain(document, "import the heightmap");
      let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
      let order = endianness;
      if (format === "png") {
        const png = await decodeHeightmapPng(bytes);
        if (png.width !== width || png.height !== height) {
          throw new Error(`PNG is ${png.width} x ${png.height}; this Landscape needs exactly ${width} x ${height} pixels (rows along +Z).`);
        }
        bytes = heightmapSamplesToRaw(png.samples);
        order = "little";
      }
      if (this.selection?.kind !== "landscape" || this.layout?.landscapes?.[this.selection.index]?.id !== actor.id
        || this.isSelectionLocked(this.selection)
        || this.worldTerrains.get(actor.id) !== document) {
        throw new Error(`Terrain selection changed while reading the ${label} file; import cancelled.`);
      }
      const world = session.world;
      const { def } = world;
      const imported = importRawHeightmap({ bytes, width, height, endianness: order, heightMin, heightMax,
        tileQuads: def.tileQuads, spacing: def.spacing, origin: def.origin });
      const heights = new Map([...imported.tiles].map(([key, tile]) => [key, decodeTerrainTile(tile).heights]));
      const patches = createTerrainHeightmapPatches(world, heights);
      this.executeTerrainPatchCommand("Import Landscape Heightmap", actor.id, document, patches);
      this.onStatus?.(`Imported ${width} x ${height} ${label} heightmap (${patches.length} tiles).`, "info");
    } catch (error) {
      this.onStatus?.(`Heightmap import failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      this.worldTerrainStreams.get(document)?.release();
    }
  }

  /** The whole grid as 16-bit RAW (little-endian) or greyscale PNG; the status line gives the re-import range. */
  async exportSelectedLandscapeHeightmapFile(format: HeightmapFileFormat): Promise<{ bytes: Uint8Array; name: string } | null> {
    if (this.selection?.kind !== "landscape") return null;
    const actor = this.layout?.landscapes?.[this.selection.index];
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    const session = document ? this.worldTerrainSessions.get(document) : undefined;
    if (!actor || !document || !session) return null;
    try {
      await this.loadWholeWorldTerrain(document, "export the heightmap");
      // The save snapshot includes unsaved relief outside the old encoding range.
      const snapshot = captureWorldTerrainSave(session.world, document.tiles.keys(), new Map());
      const def = snapshot.def;
      const tiles = new Map(snapshot.tiles.map((tile) => [tile.key, tile.bytes]));
      const raw = exportRawHeightmap(def, tiles);
      const bytes = format === "png"
        ? await encodeHeightmapPng16(def.tilesX * def.tileQuads + 1, def.tilesZ * def.tileQuads + 1, rawHeightmapToSamples(raw))
        : raw;
      const name = (actor.name || def.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
      this.onStatus?.(`Exported ${format === "png" ? "16-bit PNG" : "RAW (little-endian)"} heightmap. Re-import range: ${
        Math.fround(def.heightMin)} to ${Math.fround(def.heightMax)} m relative to terrain origin Y.`, "info");
      return { bytes, name: `${name}-heightmap.${format}` };
    } catch (error) {
      this.onStatus?.(`Heightmap export failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      return null;
    } finally {
      this.worldTerrainStreams.get(document)?.release();
    }
  }

  /** Shape of the selected landscape's multi-tile World Terrain, or null for an editable grid. */
  getSelectedWorldTerrain(): WorldTerrainDetailsView | null {
    if (this.selection?.kind !== "landscape") return null;
    const actor = this.layout?.landscapes?.[this.selection.index];
    const world = actor ? this.worldTerrains.get(actor.id) : undefined;
    if (!actor || !world) return null;
    const { def } = world;
    return {
      dataRef: actor.dataRef,
      tileQuads: def.tileQuads,
      heightMin: def.heightMin,
      heightMax: def.heightMax,
      tilesX: def.tilesX,
      tilesZ: def.tilesZ,
      tileCount: def.tiles.length,
      tileSize: terrainTileWorldSize(def),
      spacing: def.spacing,
      extent: worldTerrainExtent(def),
    };
  }

  /** Current residency and unsaved tile count of the selected World Terrain. */
  getSelectedWorldTerrainResidency(): WorldTerrainResidencyView | null {
    if (this.selection?.kind !== "landscape") return null;
    const actor = this.layout?.landscapes?.[this.selection.index];
    const document = actor ? this.worldTerrains.get(actor.id) : undefined;
    if (!document) return null;
    const streaming = this.worldTerrainStreams.get(document);
    return {
      streaming: streaming !== undefined,
      resident: document.tiles.size,
      loading: streaming?.loading ?? 0,
      unsaved: this.worldTerrainSessions.get(document)?.dirtyKeys().length ?? 0,
      total: document.def.tiles.length,
    };
  }

  getSelectedLandscapeResolution(): { verticesX: number; verticesZ: number; worldSize: number } | null {
    if (this.selection?.kind !== "landscape") return null;
    const actor = this.layout?.landscapes?.[this.selection.index];
    const single = actor ? this.singleTileWorldTerrain(actor.id) : null;
    if (single) {
      const { tileQuads, spacing } = single.document.def;
      return { verticesX: tileQuads + 1, verticesZ: tileQuads + 1, worldSize: tileQuads * spacing };
    }
    return null;
  }

  /** Resamples the selected terrain and paint layers to a supported editor preset. */
  resampleSelectedLandscape(preset: "small" | "medium" | "large"): void {
    if (this.selection?.kind !== "landscape") return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const target = landscapeSizeForPreset(preset);
    const single = actor ? this.singleTileWorldTerrain(actor.id) : null;
    if (single) {
      const { document, tile } = single;
      if (document.def.tileQuads + 1 === target.verticesX) return;
      try {
        const resampled = resampleSingleTileTerrain(document.def, tile, target.verticesX - 1);
        this.replaceWorldTerrainDocument(index, "Resample Landscape Resolution",
          { def: resampled.def, tiles: new Map([[tileKey(0, 0), resampled.tile]]) },
          `Landscape resampled to ${target.verticesX} x ${target.verticesZ}.`);
      } catch (error) {
        this.onStatus?.(`Resample failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    }
  }

  /** Changes the selected terrain's X/Z footprint while retaining its grid and authored data. */
  setSelectedLandscapeWorldSize(worldSize: number): void {
    if (this.selection?.kind !== "landscape" || !Number.isFinite(worldSize)) return;
    const index = this.selection.index;
    const actor = this.layout?.landscapes?.[index];
    const single = actor ? this.singleTileWorldTerrain(actor.id) : null;
    if (single) {
      const { document, tile } = single;
      if (Math.abs(worldSize - document.def.tileQuads * document.def.spacing) < 0.000001) return;
      try {
        const def = resizeSingleTileTerrain(document.def, worldSize);
        // The resized copy gets its own tile object: undo keeps the old document whole.
        const copy = { ...tile, heights: tile.heights.slice(), weights: tile.weights.slice() };
        this.replaceWorldTerrainDocument(index, "Resize Landscape", { def, tiles: new Map([[tileKey(0, 0), copy]]) },
          `Landscape resized to ${worldSize} m.`);
      } catch (error) {
        this.onStatus?.(error instanceof Error ? error.message : String(error), "error");
      }
    }
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
      this.scene.add(tagSceneSource(helper, EDITOR_OVERLAY_SOURCE));
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
    this.scene.add(tagSceneSource(helper, EDITOR_OVERLAY_SOURCE));
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
  addReflectionCapture(position: Vec3 = [0, 2, 0]): void {
    if (!this.layout) return;
    const captures = this.layout.reflectionCaptures ?? [];
    const actor: LayoutSphereReflectionCapture = {
      id: uniqueSphereReflectionCaptureId(captures),
      name: uniqueSphereReflectionCaptureName("Sphere Reflection Capture", captures),
      position: [...position],
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
    if (selection.kind === "lake") return this.layout?.waterBodies?.[selection.index]?.locked === true;
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

  /** Details "Spatially Loaded" toggle, using the default-true boolean command path. */
  setSelectionSpatiallyLoaded(value: boolean): void {
    this.editorSceneController.setSelectionSpatiallyLoaded(value);
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

    if (settings.viewDistance === undefined) {
      delete worldSettings.viewDistance;
    } else {
      worldSettings.viewDistance = settings.viewDistance;
    }

    if (settings.partition) {
      worldSettings.partition = normalizeWorldPartitionSettings(settings.partition);
    } else {
      delete worldSettings.partition;
    }

    if (Object.keys(worldSettings).length === 0) delete this.layout.worldSettings;
    else this.layout.worldSettings = worldSettings;

    this.applyStaticObjectShadowSettings();
    this.applyBackgroundAndAmbient();
    this.emitWorldSettingsChanged();
    this.emitSceneObjectsChanged();
    // Details shows the Spatially Loaded row only while partition is enabled.
    this.emitSelectionChanged();
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
    this.applyEditorViewDistance();
  }

  /**
   * The editor sees at least as far as the level's view distance (Faz 7a) and
   * never less than {@link SCENE_CAMERA_FAR}; quality multipliers are runtime-only.
   */
  private applyEditorViewDistance(): void {
    const viewDistance = resolveSceneWorldSettings(this.layout).viewDistance;
    setCameraFarOverride(this.camera, viewDistance !== null && viewDistance > SCENE_CAMERA_FAR ? viewDistance : null);
    this.orthoCamera.far = this.camera.far;
    this.updateOrthoProjection();
  }

  /**
   * Builds/updates/removes the Sky Atmosphere dome to match `layout.skyAtmosphere`,
   * pushes the scattering uniforms + tone mapping, and positions the sun disc from
   * the directional Sun light (the source of truth â€” Unreal's Atmosphere Sun Light).
   */
  private applySkyAtmosphere(): void {
    this.environment.applySky(this.layout);
  }

  /**
   * Re-reads the directional Sun light's rotation and repositions the sky's sun
   * disc/horizon glow. Cheap; called from the render loop so rotating the Sun
   * (gizmo or rotation fields) moves the sky live, plus after sky/light edits.
   */
  private updateSkySunFromLight(): void {
    this.environment.applySunDirection();
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
    this.environment.applyFog(this.layout);
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
    this.executeCommand({
      label,
      redo: () => this.applyFogState(nextFog),
      undo: () => this.applyFogState(previousFog),
    });
  }

  /** Swaps `layout.heightFog` and refreshes the scene, panels and autosave (the body of every fog command). */
  private applyFogState(fog: LayoutHeightFog | undefined): void {
    if (!this.layout) return;
    if (fog) this.layout.heightFog = { ...fog };
    else delete this.layout.heightFog;
    this.applyHeightFog();
    if (!this.layout.heightFog && this.selection?.kind === "fog") this.select(null);
    else this.emitSelectionChanged();
    this.scheduleAutoSave();
  }

  /**
   * Builds/updates/removes the static Cloud Layer dome to match
   * `layout.cloudLayer` and pushes the procedural uniforms. A hidden/absent cloud
   * removes the dome from the scene.
   */
  private applyCloudLayer(): void {
    this.environment.applyClouds(this.layout);
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
    // The probe-envmap rebind that used to sit here is now the environment's
    // `onEnvironmentChanged` hook, so the runtime shell gets it too.
    this.environment.applyReflection(this.layout, recapture);
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
    // The graphics quality only turns authored effects off, as in Play.
    const resolved = actor ? applyQualityToPostProcess(resolvePostProcess(actor), this.editorQuality) : null;
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
    this.environment.applySkyPostProcessExposure(post, this.layout);
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
      pickGizmoHandle: (clientX, clientY) => this.lakeDraft || this.lakePick ? null : this.picker.pickGizmoHandle(clientX, clientY),
      startGizmoDrag: (handle, event) => this.startGizmoDrag(handle, event),
      beginAltCameraDrag: (event) => this.cameraController.beginAltDrag(event),
      beginCameraNavigation: (event) => this.cameraController.beginNavigation(event),
      pickSelection: (clientX, clientY) => {
        const lake = this.pickLake(clientX, clientY), sceneHit = this.picker.pickSelectionHit(clientX, clientY);
        if (lake && (!sceneHit || lake.distance < sceneHit.distance)) return lake.selection;
        const hit = this.pickSplinePoint(clientX, clientY);
        if (hit && this.selection?.kind === "spline") {
          this.activeSplinePointId = hit.pointId;
          this.activeSplineTangent = hit.handle === "point" ? null : hit.handle;
          this.refreshSplinePointOverlay();
          this.updateGizmo();
          return { kind: "spline", index: this.selection.index };
        }
        return sceneHit?.selection ?? null;
      },
      toggleSelection: (selection) => this.toggleSelection(selection),
      select: (selection) => this.select(selection),
      beginLandscapeSculpt: (event) => this.beginLakePointer(event) || (!this.lakeDraft && !this.lakePick && !this.lakePendingSelection && this.beginLandscapeSculpt(event)),
      updateLandscapeSculpt: (event) => this.updateLakePointer(event) || this.updateLandscapeSculpt(event),
      endLandscapeSculpt: (event) => this.endLakePointer(event) || this.endLandscapeSculpt(event),
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
      beginOverlayHandleDrag: (event) => this.beginWorldBuilderPlanDrag(event),
      updateOverlayHandleDrag: (event) => this.updateWorldBuilderPlanDrag(event),
      endOverlayHandleDrag: (event) => this.endWorldBuilderPlanDrag(event),
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
      commitPointerDrag: (drag) => {
        this.commitPointerDrag(drag);
        this.flushDragDeferredSceneObjects();
      },
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
      onWheel: (event) => {
        if (
          event.ctrlKey && this.selectedEditableLandscapeIndex() !== null &&
          !this.foliageModeActive && !this.meshPaintModeActive &&
          this.landscapeSculptSettings.editMode !== "splines" && this.landscapeSculptSettings.editMode !== "water"
        ) {
          event.preventDefault();
          if (event.deltaY === 0) return;
          const current = this.landscapeSculptSettings.brushSize;
          // Half-metre steps for small brushes; larger brushes resize faster.
          const step = Math.max(0.5, Math.round(current * 0.1 * 2) / 2);
          const brushSize = clamp(Math.round((current - Math.sign(event.deltaY) * step) * 2) / 2, 0.5, 50);
          if (brushSize !== current) {
            this.setLandscapeSculptSettings({ brushSize });
            this.emitSelectionChanged();
          }
          return;
        }
        this.cameraController.handleWheel(event);
      },
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
    if (this.riverWaterFoamStampDrag) {
      this.commitRiverWaterFoamStampDrag();
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
    const splinePoint = this.activeLandscapeSplinePoint();
    if (splinePoint) {
      if (handle.tool === "move") this.startLandscapeSplinePointDrag(handle, event, splinePoint);
      return;
    }
    const blocked = this.gizmoBlockedReason(this.selection);
    if (blocked) {
      this.onStatus?.(blocked, "warning");
      return;
    }
    // Landscape spline control point (Faz 6.1): drag its world position, mapped
    // back to the point's local space — only the move tool acts on it.
    const foamStamp = this.activeRiverWaterFoamStamp();
    if (foamStamp) {
      if (handle.tool !== "move") return;
      this.startRiverWaterFoamStampDrag(handle, event, foamStamp);
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
    const data = this.landscapeSplineSource(splinePoint.landscapeId);
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
      objectMatrixInverse: this.worldTerrains.has(splinePoint.landscapeId) ? new Matrix4() : splinePoint.object.matrixWorld.clone().invert(),
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

  /** Starts a shared-gizmo drag for one Radial Foam point. */
  private startRiverWaterFoamStampDrag(
    handle: GizmoHandle,
    event: PointerEvent,
    stamp: RiverWaterFoamStampGizmoTarget,
  ): void {
    const landscapeEditable = this.getSelected();
    const water = this.layout?.riverWaters?.find((entry) => entry.id === stamp.waterId);
    if (!landscapeEditable || !water) return;
    this.gizmoInteraction.beginDrag(handle);
    this.updateGizmo();
    const base = stamp.world.clone();
    const movePlane = createGizmoMovePlane(handle, base, this.gizmoGroup.quaternion);
    const planeStartHit = movePlane
      ? this.picker.clientToPlane(event.clientX, event.clientY, movePlane) ?? base.clone()
      : undefined;
    this.riverWaterFoamStampDrag = {
      index: stamp.index,
      landscapeId: stamp.landscapeId,
      waterId: stamp.waterId,
      stampId: stamp.stampId,
      anchor: stamp.anchor,
      before: cloneRiverWater(water),
      objectMatrixInverse: water.coordinateSpace === "world" ? new Matrix4() : stamp.object.matrixWorld.clone().invert(),
    };
    this.pointerDrag = createGizmoPointerDrag({
      handle,
      selection: { kind: "landscape", index: stamp.index },
      selected: { ...landscapeEditable, position: [base.x, base.y, base.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
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
    const point = this.landscapeSplineSource(drag.landscapeId)
      ?.splines?.find((spline) => spline.id === drag.splineId)
      ?.points.find((entry) => entry.id === drag.pointId);
    if (!object || !point) return null;
    object.updateWorldMatrix(true, false);
    const world = new Vector3(...point.position);
    if (!this.worldTerrains.has(drag.landscapeId)) world.applyMatrix4(object.matrixWorld);
    return [world.x, world.y, world.z];
  }

  private riverWaterFoamStampDragWorld(): Vec3 | null {
    const drag = this.riverWaterFoamStampDrag;
    const object = drag ? this.landscapeObjects[drag.index] : null;
    const stamp = this.layout?.riverWaters
      ?.find((water) => water.id === drag?.waterId)
      ?.foamStamps?.find((entry) => entry.id === drag?.stampId);
    if (!drag || !object || !stamp) return null;
    object.updateWorldMatrix(true, false);
    const position = drag.anchor === "end" ? stamp.endPosition ?? stamp.position : stamp.position;
    const world = new Vector3(...position);
    if (drag.before.coordinateSpace !== "world") world.applyMatrix4(object.matrixWorld);
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
    const point = this.landscapeSplineSource(drag.landscapeId)
      ?.splines?.find((spline) => spline.id === drag.splineId)
      ?.points.find((entry) => entry.id === drag.pointId);
    if (!point) return;
    const local = new Vector3(...world).applyMatrix4(drag.objectMatrixInverse);
    point.position = [round(local.x), round(local.y), round(local.z)];
    this.markLandscapeSplineDirty(drag.landscapeId);
    this.refreshLandscapeSplineOverlay(drag.index);
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  private applyRiverWaterFoamStampWorld(world: Vec3): void {
    const drag = this.riverWaterFoamStampDrag;
    const water = this.layout?.riverWaters?.find((entry) => entry.id === drag?.waterId);
    const stamp = water?.foamStamps?.find((entry) => entry.id === drag?.stampId);
    if (!drag || !water || !stamp) return;
    const local = new Vector3(...world).applyMatrix4(drag.objectMatrixInverse);
    const surfaceLevel = resolveRiverWater(water).surfaceLevel;
    const position: Vec3 = [round(local.x), surfaceLevel, round(local.z)];
    if (drag.anchor === "end" && stamp.kind === "strip") stamp.endPosition = position;
    else stamp.position = position;
    void this.buildRiverWaters();
    this.refreshRiverWaterFoamOverlay(drag.index);
    this.updateGizmo();
    this.emitSelectionChanged();
  }

  /** Records one undoable command for a gizmo-drag move of a spline control point. */
  private commitLandscapeSplinePointDrag(): void {
    const drag = this.landscapeSplinePointDrag;
    this.landscapeSplinePointDrag = null;
    if (!drag) return;
    const data = this.landscapeSplineSource(drag.landscapeId);
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

  private commitRiverWaterFoamStampDrag(): void {
    const drag = this.riverWaterFoamStampDrag;
    this.riverWaterFoamStampDrag = null;
    const index = this.layout?.riverWaters?.findIndex((entry) => entry.id === drag?.waterId) ?? -1;
    const after = index >= 0 ? this.layout?.riverWaters?.[index] : null;
    if (!drag || !after || index < 0 || JSON.stringify(drag.before) === JSON.stringify(after)) return;
    const apply = (value: LayoutRiverWater): void => {
      if (!this.layout?.riverWaters?.[index]) return;
      this.layout.riverWaters[index] = cloneRiverWater(value);
      this.setLandscapeSculptSettings({
        activeRiverWaterId: drag.waterId,
        activeRiverWaterFoamStampId: drag.stampId,
        activeRiverWaterFoamStampAnchor: drag.anchor,
      });
      void this.buildRiverWaters();
      this.refreshRiverWaterFoamOverlay(drag.index);
      this.updateGizmo();
      this.emitSelectionChanged();
      this.emitSceneObjectsChanged();
      this.scheduleAutoSave();
    };
    this.executeCommand({
      label: "Move Radial Foam",
      redo: () => apply(after),
      undo: () => apply(drag.before),
    });
  }

  private updateMoveDrag(event: PointerEvent, selected: EditableSelection): void {
    const drag = this.pointerDrag;
    if (!drag || drag.mode !== "move") return;

    // When editing the pivot the object stays put, so the unchanged components
    // come from the pivot's start point (startPosition), not the object origin.
    // A spline-point drag (Faz 6.1) tracks the point's own world position instead.
    const base: Vec3 = drag.pivotEdit
      ? [...drag.startPosition]
      : this.landscapeSplinePointDragWorld() ?? this.riverWaterFoamStampDragWorld() ?? this.splinePointDragWorld() ?? [...selected.position];

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
    if (this.riverWaterFoamStampDrag) {
      this.applyRiverWaterFoamStampWorld(position);
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
    if (this.deferLakeSelection(() => this.select(selection))) return;
    this.lakes?.select(selection?.kind === "lake" ? this.layout?.waterBodies?.[selection.index]?.id ?? null : this.lakeDraft?.id ?? null);
    this.editorSceneController.select(selection);
    this.updateAiNavigationView();
    this.refreshAllLandscapeSplineOverlays();
    this.refreshAllRiverWaterFoamOverlays();
  }

  private selectMany(selections: Selection[], active: Selection | null): void {
    if (this.deferLakeSelection(() => this.selectMany(selections, active))) return;
    this.editorSceneController.selectMany(selections, active);
    this.updateAiNavigationView();
  }

  private toggleSelection(selection: Selection): void {
    if (this.deferLakeSelection(() => this.toggleSelection(selection))) return;
    this.editorSceneController.toggleSelection(selection);
    this.updateAiNavigationView();
    this.refreshAllRiverWaterFoamOverlays();
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
    this.layout.waterBodies?.forEach((lake, index) => {
      if (!options.includeHidden && lake.hidden) return;
      selections.push({ kind: "lake", index });
    });
    return selections;
  }

  private getSelectionLabel(selection: Selection): string {
    if (selection.kind === "lake") return this.layout?.waterBodies?.[selection.index]?.name ?? "Lake";
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
    if (selection.kind === "lake") {
      const lake = this.layout?.waterBodies?.[selection.index];
      return lake ? new Box3(new Vector3(lake.bounds.min[0], lake.surfaceLevel - 0.1, lake.bounds.min[1]), new Vector3(lake.bounds.max[0], lake.surfaceLevel + 0.1, lake.bounds.max[1])) : null;
    }
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
    // tracks live transform edits (drag/cascade all route through here). Placed
    // meshes, characters, actors and lights cannot reshape a terrain, so while
    // only they are selected the terrain wire check (a pass over every height
    // sample) is skipped; terrain edits select their landscape when they commit.
    const selected = this.getSelectedSelections();
    this.updateCollisionBoxes({
      terrain: selected.length === 0 || selected.some((selection) => !TERRAIN_NEUTRAL_SELECTION_KINDS.has(selection.kind)),
    });
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
    if (selection.kind === "lake") return null;
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
    // Forget the last nav mesh preview so it rebuilds even from unchanged input.
    this.recastPreview.clear();
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
    // Terrain owns packed layer textures separately from mesh materials. Play
    // loads them afresh; the editor must discard its old layer on save too.
    const cachedLayer = this.landscapeLayerMaterialCache.get(materialId);
    this.landscapeLayerMaterialCache.delete(materialId);
    const affectedLandscapes = this.layout.landscapes
      ?.flatMap((actor, index) => this.worldTerrains.get(actor.id)?.def.layers
        .some((layer) => layer.material === materialId) ? [index] : []) ?? [];
    await Promise.all(affectedLandscapes.map((index) => this.warmLandscapeLayerMaterials(index)));
    cachedLayer?.texture?.dispose();
    cachedLayer?.normalTexture?.dispose();
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
  private updateCollisionBoxes(options: { terrain?: boolean } = {}): void {
    if (!this.showCollision || !this.layout) {
      this.removeCollisionBoxes();
      this.removeLandscapeCollisionWires();
      return;
    }
    // The overlay refreshes on every selection change and drag step. Owners whose
    // lines did not change are reused, and each chunk of owners shares one line
    // buffer, so a drag step rebuilds and re-uploads one chunk instead of a
    // helper per collider (thousands of draw calls on an open-world level).
    const entries = collisionWireEntries(
      this.layout,
      this.localBounds,
      this.collisionDefs,
      this.complexCollisionMeshes,
      this.collisionWireEntryCache,
    );
    this.collisionWireEntryCache = new Map(entries.map((entry) => [entry.key, entry]));
    const chunks = new Map<string, CollisionWireEntry[]>();
    for (const entry of entries) {
      const key = `${entry.chunk}:${entry.sensor ? "sensor" : "solid"}`;
      const members = chunks.get(key);
      if (members) members.push(entry);
      else chunks.set(key, [entry]);
    }
    for (const [key, members] of chunks) {
      const signature = members.map((entry) => entry.signature).join("\n");
      const cached = this.collisionWireChunks.get(key);
      if (cached?.signature === signature) {
        if (cached.helper.parent !== this.scene) this.scene.add(cached.helper);
        continue;
      }
      if (cached) disposeCollisionWire(cached.helper);
      const positions = new Float32Array(members.reduce((total, entry) => total + entry.positions.length, 0));
      let offset = 0;
      for (const entry of members) {
        positions.set(entry.positions, offset);
        offset += entry.positions.length;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      const helper = new LineSegments(geometry, this.collisionWireMaterial(members[0]!.sensor ? "sensor" : "solid"));
      helper.name = "editor-collision-box";
      this.scene.add(tagSceneSource(helper, EDITOR_OVERLAY_SOURCE));
      this.collisionWireChunks.set(key, { signature, helper });
    }
    for (const [key, { helper }] of this.collisionWireChunks) {
      if (chunks.has(key)) continue;
      disposeCollisionWire(helper);
      this.collisionWireChunks.delete(key);
    }
    if (options.terrain !== false) this.updateLandscapeCollisionWires();
  }

  /** Shared overlay line materials; kept for the editor's lifetime so a refresh never recompiles them. */
  private collisionWireMaterial(kind: "solid" | "sensor"): LineBasicMaterial {
    this.collisionWireMaterials ??= {
      solid: new LineBasicMaterial({ color: 0x4cd07d }),
      sensor: new LineBasicMaterial({ color: 0xffb454 }),
    };
    return this.collisionWireMaterials[kind];
  }

  /**
   * Adds the heightfield collider wire for every collidable landscape actor to
   * the "Show > Collision" overlay — the editor twin of the collider debug wire
   * the runtime always draws in Play, built from the same collider primitives
   * (one per tile for a multi-tile Landscape). The heightfield mirrors the render
   * mesh, so this reveals exactly the surface characters walk on. Built in the
   * body frame and positioned like the collider body, matching
   * `applyLandscapeTransform` (there is no landscape transform scale).
   *
   * A wire is rebuilt only when its heights or placement changed: the overlay
   * refreshes on every selection change and drag step, and rebuilding a 4×4
   * tile terrain each time stalled the editor for seconds. Sculpt, undo and
   * streaming all change the heights, so the signature catches them.
   */
  private updateLandscapeCollisionWires(): void {
    const keep = new Set<string>();
    const use = (
      key: string,
      signature: string,
      build: () => { field: ColliderHeightfield; position: Vec3; rotation: Vec3 },
    ): void => {
      keep.add(key);
      const cached = this.landscapeCollisionWires.get(key);
      if (cached?.signature === signature) {
        if (cached.helper.parent !== this.scene) this.scene.add(cached.helper);
        return;
      }
      if (cached) disposeCollisionWire(cached.helper);
      this.landscapeCollisionWires.delete(key);
      const { field, position, rotation } = build();
      const helper = this.createLandscapeCollisionWire(field, position, rotation);
      if (helper) this.landscapeCollisionWires.set(key, { signature, helper });
    };
    for (const actor of this.layout?.landscapes ?? []) {
      if (!resolveLandscape(actor).collision) continue;
      const world = this.worldTerrains.get(actor.id);
      if (!world) continue;
      const { tileQuads, spacing, origin } = world.def;
      for (const [key, tile] of world.tiles) {
        use(`${actor.id}:${key}`, `${tileQuads}:${spacing}:${origin.join(",")}:${heightsSignature(tile.heights)}`, () => {
          const { translation, primitive } = terrainTileHeightfield(world.def, tile);
          return { field: primitive.heightfield!, position: translation, rotation: [0, 0, 0] };
        });
      }
    }
    for (const [key, { helper }] of this.landscapeCollisionWires) {
      if (keep.has(key)) continue;
      disposeCollisionWire(helper);
      this.landscapeCollisionWires.delete(key);
    }
  }

  /** One terrain heightfield wire for the "Show > Collision" overlay, placed like its collider body. */
  private createLandscapeCollisionWire(
    field: ColliderHeightfield,
    position: Vec3,
    rotation: Vec3,
  ): LineSegments | null {
    const { positions, indices } = heightfieldWireGeometry(field);
    if (indices.length === 0) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    // Depth-tested (like the other editor collision wireboxes): the terrain
    // occludes edges behind its surface, so the overlay stays readable and
    // doesn't draw over the actors in front of it. The runtime's Play wire
    // uses depthTest:false for an always-on-top debug look; the editor
    // authoring overlay deliberately does not.
    const helper = new LineSegments(geometry, this.collisionWireMaterial("solid"));
    helper.name = "editor-collision-box";
    helper.position.set(position[0], position[1], position[2]);
    helper.rotation.set(
      (rotation[0] * Math.PI) / 180,
      (rotation[1] * Math.PI) / 180,
      (rotation[2] * Math.PI) / 180,
      "XYZ",
    );
    this.scene.add(tagSceneSource(helper, EDITOR_OVERLAY_SOURCE));
    return helper;
  }

  private removeLandscapeCollisionWires(): void {
    for (const { helper } of this.landscapeCollisionWires.values()) disposeCollisionWire(helper);
    this.landscapeCollisionWires.clear();
  }

  private updateAiNavigationView(): void {
    this.removeAiNavigationView();
    if (!this.showAiNavigation || !this.layout) {
      this.recastPreview.clear();
      return;
    }
    const blockers = this.editorNavBlockers();
    const profile = this.aiNavDebugProfile();
    const bounds = this.aiNavigationBounds();
    const perception = this.aiPerceptionView();
    const queries = this.aiQueryView();
    const routes = this.aiTargetPointRouteView();
    const agentClearances = this.aiAgentClearanceView(profile);
    // The walkable area is the Recast mesh the runtime plans on, built off
    // the frame from the live layout (debounced; see EditorRecastPreview).
    this.recastPreview.request(() => this.editorRecastPreviewInput(bounds));
    if (
      blockers.length === 0 &&
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
      bounds,
      perception,
      queries,
      routes,
      agentClearances,
    });
    this.scene.add(this.aiNavigationView);
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
      // The nav mesh erosion: radius plus padding.
      clearanceRadius: agentRadius + clearancePadding,
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
    // Materials are the shared collisionWireMaterial ones.
    for (const { helper } of this.collisionWireChunks.values()) disposeCollisionWire(helper);
    this.collisionWireChunks.clear();
    this.collisionWireEntryCache.clear();
  }

  /**
   * The nav mesh preview's input: the live layout's collider entities plus
   * collidable World Terrain tiles, the debug agent profile, and where to
   * build — every authored AI Navigation Volume whole, or without volumes
   * the tiles around the camera (snapped to the tile grid, so orbiting does
   * not rebuild).
   */
  private editorRecastPreviewInput(bounds: readonly NavAabb[]): EditorRecastPreviewInput | null {
    if (!this.layout) return null;
    const entities: Entity[] = [...this.getSceneDocument().entities];
    for (const actor of this.layout.landscapes ?? []) {
      const resolved = resolveLandscape(actor);
      const world = this.worldTerrains.get(actor.id);
      if (!world || !resolved.collision) continue;
      entities.push(...worldTerrainColliderEntities({ id: actor.id, name: resolved.name, collision: true }, world));
    }
    const profile = this.aiNavDebugProfile();
    const agent: NavAgent = {
      radius: profile.agentRadius,
      height: AI_NAV_DEBUG_AGENT_HEIGHT,
      stepHeight: AI_NAV_DEBUG_AGENT_STEP_HEIGHT,
      maxStepDown: AI_NAV_DEBUG_AGENT_STEP_DOWN,
      maxSlopeAngleDeg: AI_NAV_DEBUG_AGENT_MAX_SLOPE_DEG,
      clearancePadding: profile.clearancePadding,
    };
    if (bounds.length > 0) {
      let radius = 0;
      const invokers: Vec3[] = bounds.map((bound) => {
        radius = Math.max(radius, Math.hypot(bound.max[0] - bound.min[0], bound.max[2] - bound.min[2]) / 2);
        return [(bound.min[0] + bound.max[0]) / 2, (bound.min[1] + bound.max[1]) / 2, (bound.min[2] + bound.max[2]) / 2];
      });
      return { entities, agent, bounds, invokers, buildRadius: Math.min(radius, AI_NAV_PREVIEW_MAX_RADIUS) };
    }
    const snap = (value: number) => (Math.floor(value / AI_NAV_PREVIEW_SNAP) + 0.5) * AI_NAV_PREVIEW_SNAP;
    const camera = this.camera.position;
    return {
      entities,
      agent,
      bounds,
      invokers: [[snap(camera.x), 0, snap(camera.z)]],
      buildRadius: AI_NAV_PREVIEW_CAMERA_RADIUS,
    };
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
    if (this.selection.kind === "lake") return;
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

    const foamStamp = this.activeRiverWaterFoamStamp();
    if (foamStamp) {
      this.gizmoGroup.visible = true;
      this.gizmoGroup.position.copy(foamStamp.world);
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
    if (this.selection && this.gizmoBlockedReason(this.selection)) return;

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
    if (!this.layout || selection.kind === "lake") return null;
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
    if (selection.kind === "landscape") this.syncWorldTerrainPlacement(selection.index);
    // The immediate sync above keeps the ribbon under the gizmo; rebuild at the
    // committed transform boundary so shared reflection sources get the new plane.
    if (selection.kind === "landscape") void this.buildRiverWaters();
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
    // A gizmo drag emits on every pointer move; listing every scene object per
    // step stalled large levels, so the Outliner catches up once the drag ends.
    if (this.pointerDrag) {
      this.sceneObjectsDeferredByDrag = true;
      return;
    }
    this.emitSceneObjectsChanged();
  }

  /** Emits the scene-object refresh a gizmo drag held back, unless one already ran. */
  private flushDragDeferredSceneObjects(): void {
    if (this.sceneObjectsDeferredByDrag) this.emitSceneObjectsChanged();
  }

  private emitSceneObjectsChanged(): void {
    this.sceneObjectsDeferredByDrag = false;
    this.sceneObjectsRevision += 1;
    this.onSceneObjectsChanged?.(this.getSceneObjects());
    // Any structural change (add/delete/edit of a collider, placement or nav
    // volume) can alter the baked walkable area, so refresh the AI Navigation
    // overlay from the live layout. Without this, deleting an obstacle left its
    // eroded footprint and stale walkable cells frozen in the view. Cheap when the
    // overlay is off (updateAiNavigationView early-returns on !showAiNavigation).
    this.updateAiNavigationView();
  }

  private emitHistoryChanged(): void {
    // A dry run preview was planned against the level before this step; the
    // recipe layer follows the ground, which the step may have moved.
    this.worldBuilder.clearPreview();
    this.worldBuilder.refreshLayer();
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
    if (selection.kind === "lake") return Boolean(this.layout?.waterBodies?.[selection.index]);
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

/** Cheap content key for a height grid: changes when any sample does (sculpt, undo, streaming). */
function heightsSignature(heights: Float32Array): string {
  let sum = 0;
  let weighted = 0;
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index]!;
    sum += height;
    weighted += height * ((index % 1021) + 1);
  }
  return `${heights.length}:${sum}:${weighted}`;
}

function disposeCollisionWire(helper: LineSegments): void {
  helper.removeFromParent();
  helper.geometry.dispose();
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

function createEditorUserSettingsStore(): UserSettingsStore | null {
  try {
    return new UserSettingsStore({ storage: createLocalStorageAdapter(window.localStorage) });
  } catch {
    return null;
  }
}
