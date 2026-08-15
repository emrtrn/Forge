import { Box3, BoxGeometry, BufferGeometry, DirectionalLight, EdgesGeometry, Float32BufferAttribute, Group, Light as ThreeLight, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshStandardMaterial, Object3D, type Texture, TextureLoader, Vector3 } from "three";
import type {
  AmbientLight,
  InstancedMesh,
  Material,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { AssetLoader } from "./assetLoader";
import type { CapabilityModule } from "./capabilities/CapabilityModule";
import { CapabilityRegistry, createCapabilityRegistry } from "./capabilities/capabilityRegistry";
import { createRuntimeContext } from "./capabilities/RuntimeContext";
import { LoadingOverlay } from "./loadingOverlay";
import { LoadProgressTracker, formatLoadDetail } from "@engine/loading/loadProgress";
import { loadRoomLayout } from "./roomLayout";
import { EngineApp } from "@engine/core/EngineApp";
import { AnimationSubsystem } from "@engine/render-three/animationSubsystem";
import { applyLodBias } from "@engine/render-three/distanceLod";
import { ActionMap } from "@engine/input/actionMap";
import { DEFAULT_INPUT_BINDINGS } from "@/game/defaultInputBindings";
import { InputSubsystem } from "@engine/input/inputSubsystem";
import {
  BehaviorSubsystem,
  type ScriptMessageDebugSnapshot,
} from "@engine/behavior/behaviorSubsystem";
import type { ScriptMessagePayload } from "@engine/behavior/scriptMessages";
import { AISubsystem, type AiDebugSnapshot } from "@engine/ai/aiSubsystem";
import { createTargetPointIndex, targetPointEntriesFromLayout } from "@engine/ai/targetPoints";
import type { AiMoveRequest } from "@engine/ai/behaviorRunner";
import {
  normalizeAiBehaviorTreeAsset,
  normalizeAiBlackboardAsset,
  type AiBehaviorStatus,
  type AiBehaviorTreeAsset,
  type AiBlackboardAsset,
} from "@engine/ai/behaviorAsset";
import { normalizeAiStateTreeAsset, type AiStateTreeAsset } from "@engine/ai/stateTreeAsset";
import { PhysicsSubsystem } from "@engine/physics/physicsSubsystem";
import { MovingPlatformSubsystem } from "@engine/physics/movingPlatformSubsystem";
import {
  SplinePathFollowerSubsystem,
  type SplinePathFollowerDebugState,
} from "@engine/scene/splinePathFollower";
import { resolveCharacterCapsule } from "@engine/scene/capsule";
import {
  findGridPath,
  searchNavGrid,
  NavGridCache,
  advanceWaypoint,
  type NavAgent,
  type NavAabb,
  type NavBlocker,
  type PathFollowingState,
} from "@engine/navigation/gridNavigation";
import { resolveNavAgentProfile } from "@engine/navigation/navAgentProfile";
import {
  freshStuckState,
  isStuck,
  separationSteering,
  updateStuckState,
  type AvoidanceNeighbor,
  type StuckState,
} from "@engine/navigation/localAvoidance";
import {
  createAiNavigationView,
  disposeAiNavigationView,
  inflateNavBlocker2d,
  type AiNavAgentClearanceView,
  type AiPerceptionView,
  type AiQueryCandidateView,
  type AiTargetPointRouteView,
} from "@engine/render-three/aiNavigationView";
import { AudioSubsystem } from "@engine/audio/audioSubsystem";
import { isAudioBusId, type AudioBusId } from "@engine/audio/audioBus";
import { evaluateSoundCue } from "@engine/audio/soundCueEvaluator";
import type { SoundCueAsset } from "@engine/audio/soundCueTypes";
import { collapseCoincidentFloors, findGroundLayersAt } from "@/game/collision";
import { slopeCosFromDegrees } from "@/game/slopeSurface";
import {
  DialogueSubsystem,
  type DialogueAudioPlayback,
  type DialogueAudioRequest,
} from "@engine/dialogue/dialogueSubsystem";
import {
  isDialogueLineAsset,
  isDialogueVoiceAsset,
  type DialoguePlayContext,
} from "@engine/dialogue/dialogueTypes";
import { ConversationDirector } from "@engine/dialogue/conversationDirector";
import { isConversationAsset } from "@engine/dialogue/conversationTypes";
import { SubtitleOverlay } from "./subtitleOverlay";
import { ConversationOverlay } from "./conversationOverlay";
import { KeyboardInputSource } from "@/input/keyboardInputSource";
import { GamepadInputSource } from "@/input/gamepadInputSource";
import { TouchInputSource, isTouchLikely } from "@/input/touchInputSource";
import { PointerLookSource } from "@/input/pointerLookSource";
import { PointerButtonSource } from "@/input/pointerButtonSource";
import { consumePlayCameraPose } from "@/play/cameraHandoff";
import { createBehaviorRegistry } from "@/game/behaviors";
import { createGameAiTaskRegistry } from "@/game/ai/tasks";
import { CharacterMovementSubsystem, type CharacterMoveIntent } from "@/game/characterMovementSystem";
import type { Aabb3 } from "@/game/collision";
import {
  DEFAULT_LOCOMOTION_THRESHOLDS,
  locomotionConfigForSkeleton,
  resolveLocomotionAnimation,
  type LocomotionInput,
} from "@/game/locomotionAnimation";
import { resolveGameMode } from "@/game/gameModes/registry";
import { isGameModeClassRef } from "@/game/gameModes/catalog";
import { createProjectGameMode } from "@/game/gameModes/projectGameMode";
import {
  computePlayerStartSpawn,
  createDefaultPlayerCharacter,
  findPlayerStartTransform,
} from "@/game/gameModes/playerSpawn";
import type {
  GameModeContext,
  GameModeDefinition,
  GameModeSession,
  InputMode,
  PawnDefinition,
  RuntimeCharacterRef,
} from "@/game/gameModes/types";
import { loadActiveProject, projectFileUrl, type ActiveProject } from "@/project/ProjectSystem";
import {
  applySceneBackgroundAndAmbient,
  applyEditorMatchedPlayLook,
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
  DEFAULT_SCENE_BACKGROUND_COLOR,
  DEFAULT_SCENE_GRAVITY,
  DEFAULT_SCENE_KILL_Z,
  DEFAULT_SCENE_SUN_ID,
  ensureDefaultSceneLights,
  fitDirectionalShadowToBounds,
  isSceneSunLight,
  readSceneRuntimeStats,
  readSceneRuntimeMemory,
  registerSceneShapeModels,
  resolveSceneWorldSettings,
  sceneModelAssetIds,
  startSceneRuntime,
  tagSceneLightRecordIndex,
} from "./SceneRuntimeCore";
import { SceneShell } from "./SceneShell";
import { LevelRuntime } from "./LevelRuntime";
import type { RenderMemoryStats } from "@engine/render-three/renderer";
import type { SubsystemProfileSnapshot } from "@engine/core/subsystemProfiler";
import { FrameMetricsMonitor, type FrameMetrics } from "@engine/perf/frameMetrics";
import {
  applyQualityToPostProcess,
  defaultGraphicsPreferences,
  effectiveDevicePixelRatio,
  isQualityLevel,
  resolveQualitySettings,
  type GraphicsPreferences,
  type QualityExtensions,
  type QualityLevel,
  type QualitySettings,
} from "@engine/perf/qualityProfiles";
import {
  calibrateFromMeasurement,
  suggestStartingQualityLevel,
  type ConcreteQualityLevel,
  type HardwareHintInputs,
} from "@engine/perf/hardwareHints";
import {
  classifyBottleneck,
  type BottleneckResult,
} from "@engine/perf/bottleneckClassifier";
import {
  AdaptiveQualityController,
  type AdaptiveChangeRecord,
} from "@engine/perf/adaptiveQuality";
import { evaluatePerfBudget } from "@engine/perf/perfBudget";
import type { LightObjectRecord } from "@engine/render-three/lights";
import { attachActorLight } from "@engine/render-three/lights";
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
  hasPostProcessEffectPasses,
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
  applyProbeEnvMapToObject,
  assignProbeEnvMapMaterial,
  bakeSphereReflectionCapture,
  disposeSphereReflectionCaptureBake,
  resolveSphereReflectionCapture,
  selectNearestReflectionCapture,
  type SphereReflectionCaptureBake,
  type SphereReflectionCaptureRenderItem,
} from "@engine/render-three/reflectionCapture";
import {
  createReflectionPlaneObject,
  disposeReflectionPlaneObject,
  resolveReflectionPlane,
  type ReflectionPlaneObject,
  type ReflectionPlaneRenderItem,
} from "@engine/render-three/reflectionPlane";
import {
  createFlatLandscapeData,
  createLandscapeColliderPrimitive,
  createLandscapeObject,
  disposeLandscapeObject,
  landscapeSplineMeshAssetIds,
  LANDSCAPE_DEFAULT_LAYERS,
  resolveLandscape,
  type ForgeLandscapeData,
  type LandscapeLayerTexture,
  type LandscapeObject,
  type LandscapeRenderItem,
} from "@engine/render-three/landscape";
import { FoliageRenderBinding, foliageInstanceFromRoll } from "@engine/render-three/foliage";
import { generateLandscapeFoliageSamples } from "@engine/scene/landscapeFoliage";
import { makeFoliageRng, rollFoliageInstance } from "@engine/scene/foliagePaint";
import type { LayoutFoliageData, LayoutFoliageGroup } from "@engine/scene/foliage";
import { loadFoliageData, loadFoliageTypesForData } from "./foliageLoader";
import {
  createEmptyMeshPaintData,
  type LayoutMeshPaintData,
  type LayoutMeshPaintPlacement,
} from "@engine/scene/meshPaint";
import { loadMeshPaintData } from "./meshPaintLoader";
import {
  createReflectiveSurfaceObject,
  disposeReflectiveSurfaceObject,
  resolveReflectiveSurface,
  type ReflectiveSurfaceObject,
  type ReflectiveSurfaceRenderItem,
} from "@engine/render-three/reflectiveSurface";
import {
  createRuntimeBlockingVolumeObject,
  disposeBlockingVolumeObject,
  resolveBlockingVolume,
  type BlockingVolumeObject,
  type BlockingVolumeRenderItem,
} from "@engine/render-three/blockingVolume";
import {
  createSplineObject,
  disposeSplineObject,
  type SplineObject,
} from "@engine/render-three/spline";
import { splineDeformMeshColliderPrimitive } from "@engine/render-three/splineDeformMesh";
import { normalizeSplineGenerators, resolveSplineDeformMeshGenerator } from "@engine/scene/splineGenerator";
import { aiNavigationVolumeAabb } from "@engine/render-three/aiNavigationVolume";
import { readRotation, readScale } from "@engine/scene/transform";
import { createSplineRegistry, type SplineQuery, type SplineRegistry } from "@engine/scene/splineRegistry";
import type { Sky } from "three/examples/jsm/objects/Sky.js";
import {
  collectMaterialStats,
  convertUnlitModelMaterialsToLit,
  isRenderableMesh,
} from "@engine/render-three/materials";
import {
  applyEulerDegrees,
  colliderBoxFromBounds,
  composePlacementMatrix,
  composeTransformMatrix,
} from "@engine/render-three/transforms";
import type {
  LayoutActorInstance,
  LayoutCharacter,
  LayoutLightActor,
  LayoutPlacement,
  LayoutSplineActor,
  LayoutBlockingVolume,
  LayoutLandscape,
  LayoutReflectionPlane,
  LayoutReflectiveSurface,
  LayoutSphereReflectionCapture,
  RoomLayout,
  Vec3,
} from "@engine/scene/layout";
import {
  characterEntityId,
  roomLayoutToSceneDocument,
  type ColliderTransformSource,
} from "@engine/scene/legacyRoomLayoutAdapter";
import { actorInstanceToEntity } from "@engine/scene/actorInstance";
import {
  normalizeActorScriptDef,
  readGameModeDefaultPawnClassRef,
  type ActorScriptDef,
} from "@engine/scene/actorScript";
import { createCharacterSceneObject, entityCharacterItem } from "@engine/render-three/models";
import { CrossfadeAnimator } from "@engine/render-three/characterAnimator";
import { isMarkerAssetId, shapeAssetCollisionDef } from "@engine/scene/shapes";
import { loadAssetCollision } from "@/scene/assetCollisionLoader";
import {
  applyAssetUvwMapping,
  loadAssetUvw,
} from "@/scene/assetUvwLoader";
import { loadForgeMaterial, loadForgeMaterialLayer } from "@/scene/materialAssets";
import {
  applyMaterialSlotOverrides,
  assignedMaterialSlotIds,
  hasAssignedMaterialSlots,
  loadAssetMaterialSlots,
  resolveMeshMaterialSlots,
  type AssetMaterialSlotsDef,
} from "@/scene/assetMaterialSlotsLoader";
import {
  defaultAssetSkeleton,
  loadAssetSkeleton,
  type AssetSkeletonDef,
} from "@/scene/assetSkeletonLoader";
import { assetPath, assetType, isModelAssetType, type AssetManifest } from "@engine/assets/manifest";
import { normalizeUiWidgetDef, type UiWidgetDef } from "@engine/ui/uiWidget";
import { normalizeUiThemeDef, type UiThemeDef } from "@engine/ui/uiTheme";
import { UiViewModelStore, type UiFieldValue } from "@engine/ui/uiViewModel";
import { LocaleRegistry, normalizeUiLocaleTable } from "@engine/ui/uiLocale";
import { normalizeWorldWidgets } from "@engine/ui/uiWorldWidget";
import { RuntimeUiSubsystem } from "@/ui/RuntimeUiSubsystem";
import { WorldUiSubsystem, type WorldUiDebugSnapshot } from "@/ui/WorldUiSubsystem";
import {
  GameStateStore,
  normalizeGameRules,
  parseGameEvent,
  type GamePhase,
} from "@/game/gameRules";
import {
  collectSaveState,
  type GameSaveState,
  type SavedPlayerTransform,
} from "@/game/saveGame";
import {
  SaveGameStore,
  createLocalStorageAdapter,
} from "@engine/persistence/saveGameStore";
import {
  UserSettingsStore,
  defaultUserSettings,
  type UserSettings,
} from "@engine/persistence/userSettingsStore";
import { RuntimeSaveCoordinator } from "./runtimeSaveCoordinator";
import { RuntimeTravelCoordinator } from "./runtimeTravelCoordinator";
import { RuntimeActorSpawnCoordinator } from "./runtimeActorSpawnCoordinator";
import {
  buildGameModeDebugSnapshot,
  buildPerfMemorySnapshot,
  buildUiDebugSnapshot,
} from "./runtimeDebugSnapshot";
import type { AssetCollisionDef } from "@engine/scene/collision";
import {
  assetCollisionDefHasCollider,
  complexAsSimpleAssetIds,
} from "@engine/scene/collision";
import {
  COLLIDER_COMPONENT,
  readAudioComponent,
  readAIControllerComponent,
  readBehaviorComponent,
  readCharacterMovementComponent,
  readColliderComponent,
  readLightComponent,
  readRenderableMeshComponent,
  readParticleEmitterComponent,
  readScriptActorComponent,
  readTransformComponent,
  TRANSFORM_COMPONENT,
} from "@engine/scene/components";
import type { ColliderComponent, ColliderPrimitive, ColliderShape, TransformComponent } from "@engine/scene/components";
import type { Entity, EntityComponentData } from "@engine/scene/entity";
import type { SceneDocument } from "@engine/scene/sceneDocument";
import { VfxSubsystem, type VfxDebugSnapshot } from "@engine/render-three/vfxSubsystem";

/**
 * Live gameplay readout for the `?debug` overlay: the active Game Mode, the pawn
 * it possessed, and that pawn's movement state (mode + grounded + velocity). Fields
 * are null when nothing is possessed (e.g. the default camera mode) or the pawn
 * carries no CharacterMovement / has not reported locomotion yet.
 */
export interface GameModeDebugSnapshot {
  /** Active Game Mode display name (or "—" before one resolves). */
  gameMode: string;
  /** Possessed pawn entity id, or null when nothing is possessed. */
  possessed: string | null;
  /** Possessed pawn's authored CharacterMovement mode, or null. */
  movementMode: string | null;
  /** Whether the possessed pawn rests on the floor, or null when unknown. */
  grounded: boolean | null;
  /** Possessed pawn's vertical velocity (units/s, up positive), or null. */
  velocityY: number | null;
  /** Possessed pawn's planar speed this tick (units/s), or null. */
  planarSpeed: number | null;
  /** Possessed pawn's world position, or null when nothing is possessed. */
  position: readonly [number, number, number] | null;
  /** Controller yaw in degrees, when the active mode owns control rotation. */
  controlYawDeg: number | null;
  /** Controller pitch in degrees, when the active mode owns control rotation. */
  controlPitchDeg: number | null;
  /** Current camera source, e.g. an authored SpringArm or fallback follow config. */
  cameraSource: string | null;
  /** Current runtime input mode. */
  inputMode: InputMode;
}

/**
 * Live UI-host readout for the `?debug` overlay: the mounted HUD, the active
 * screen stack (bottom → top) and the ViewModel store's current fields. Lets an
 * author confirm which widget is up and watch bound values change in place.
 */
export interface UiDebugSnapshot {
  /** Mounted HUD widget name, or null when none. */
  hud: string | null;
  /** Active screen widget names, bottom → top. */
  screens: string[];
  /** ViewModel store fields as path-sorted `[path, value]` pairs. */
  fields: Array<[string, UiFieldValue]>;
  /** Active UI locale, or null when the scene authors no localization tables. */
  locale: string | null;
  /** Accessibility audit findings across the mounted HUD + screens. */
  audit: string[];
  /** World-space UI billboards: mounted + on-screen counts. */
  world: WorldUiDebugSnapshot;
}

/**
 * Memory readout for the `?debug` overlay: GPU resource counts (always present)
 * plus the JS heap when the browser exposes `performance.memory` (Chrome-only).
 */
export interface PerfMemorySnapshot {
  render: RenderMemoryStats;
  /** `performance.memory.usedJSHeapSize` in bytes, or null off Chrome. */
  jsHeapBytes: number | null;
  /** `performance.memory.jsHeapSizeLimit` in bytes, or null off Chrome. */
  jsHeapLimitBytes: number | null;
}

/**
 * Adaptive quality state for the `?debug` overlay (Faz 6, §13): the player's
 * chosen profile, whether adaptive is on, how many transient reduction rungs are
 * currently layered over the base, and the most recent automatic change + age.
 */
export interface AdaptiveDebugSnapshot {
  qualityLevel: QualityLevel;
  adaptiveEnabled: boolean;
  reductionDepth: number;
  lastChange: { record: AdaptiveChangeRecord; ageSeconds: number } | null;
}

interface RuntimeAiPathFollowing {
  goal: Vec3;
  /** Spline tangent supplied by patrol authoring; nav heading remains authoritative near blockers. */
  preferredDirection?: Vec3;
  speed?: number;
  acceptanceRadius?: number;
  state: PathFollowingState;
  /** Progress window feeding stuck detection (replan / give up). */
  stuck: StuckState;
  /** Stuck-recovery replans burned on the current goal. */
  replans: number;
}

interface RuntimeAiCharacterAnimator {
  readonly ref: RuntimeCharacterRef;
  readonly animator: CrossfadeAnimator;
  readonly config: ReturnType<typeof locomotionConfigForSkeleton>;
  oneShot: { clip: string; remaining: number; blendOutSeconds: number } | null;
}

/** One AI path follower's live state for the `?debug` overlay. */
export interface AiNavFollowerDebug {
  readonly entityId: string;
  readonly status: PathFollowingState["status"];
  readonly waypointIndex: number;
  readonly pathLength: number;
  readonly path: readonly Vec3[];
  readonly goal: Vec3;
  readonly speed?: number;
  readonly acceptanceRadius?: number;
  readonly replans: number;
  readonly secondsWithoutProgress: number;
}

export interface AiNavigationDebugSnapshot {
  readonly blockers: readonly NavAabb[];
  readonly inflatedBlockers: readonly NavBlocker[];
  readonly agentClearances: readonly AiNavAgentClearanceView[];
  readonly bounds: readonly NavAabb[];
  readonly cellSize: number;
  readonly followers: readonly AiNavFollowerDebug[];
}

/** Active-gameplay seconds before the one-time startup measurement pass fires
 * (Faz 4): long enough that the 5 s frame-time window has aged past load/shader
 * warm-up spikes, short enough to settle the profile early. */
const STARTUP_CALIBRATION_SECONDS = 12;

/** Rolling-window size (frames) for the profiler when it runs only for adaptive
 * classification (§7.3): ~1 s at 60 FPS — small, since the classifier reads
 * seconds-scale trends, not per-frame detail. */
const ADAPTIVE_PROFILER_WINDOW_FRAMES = 60;

/** How often the adaptive controller is ticked (Faz 6). It reasons over
 * seconds-scale trends, so ~2×/s is ample and keeps the per-frame cost off the
 * hot path — the frame-time `metrics()` percentile sort runs only on this cadence
 * (accumulated delta is passed through, so cooldown/stable timers stay accurate). */
const ADAPTIVE_TICK_INTERVAL_SECONDS = 0.5;

const AI_MOVE_ACCEPTANCE_RADIUS = 0.2;
const AI_NAV_CELL_SIZE = 0.5;
const AI_NAV_GRID_SAFETY_MARGIN = AI_NAV_CELL_SIZE * 0.5;
const AI_NAV_MIN_TOP_SUPPORT_RADIUS = 0.15;
/**
 * Acceptance radius for intermediate path waypoints. Kept tight (independent of
 * the authored final-goal acceptance) so a generous goal tolerance can't make
 * the agent skip a corner waypoint early and cut through an inflated blocker.
 */
const AI_INTERMEDIATE_WAYPOINT_ACCEPTANCE = Math.min(AI_NAV_CELL_SIZE * 0.35, 0.2);
/** How strongly agent-separation steering blends into the desired path direction. */
const AI_SEPARATION_WEIGHT = 0.75;
/** Spline patrols stay on their authored rail; nearby actors may nudge, not redirect, them. */
const AI_SPLINE_SEPARATION_WEIGHT = 0.25;
/** Spline tangent influence when a nav path points broadly in the same direction. */
const AI_SPLINE_TANGENT_STEERING_WEIGHT = 0.35;
/** Stuck recoveries (replans) per goal before the move fails outright. */
const AI_MAX_STUCK_REPLANS = 2;
/**
 * Granularity the agent foot height is snapped to when keying a baked nav grid.
 * Baking is per foot-plane (it decides which blockers are vertical obstacles), so
 * without bucketing an agent's per-frame Y jitter would rebuild the grid every
 * tick. Half a cell is coarse enough to keep the cache stable on flat ground yet
 * fine enough to separate distinct floors.
 */
const AI_NAV_FOOT_Y_BUCKET = AI_NAV_CELL_SIZE;

function bucketNavFootY(footY: number): number {
  if (!Number.isFinite(footY)) return 0;
  return Math.round(footY / AI_NAV_FOOT_Y_BUCKET) * AI_NAV_FOOT_Y_BUCKET;
}

/** Cheap order-sensitive signature of authored nav bounds for cache invalidation. */
function navBoundsSignature(bounds: readonly NavAabb[]): string {
  let signature = "";
  for (const bound of bounds) {
    signature += `${bound.min[0]},${bound.min[1]},${bound.min[2]},${bound.max[0]},${bound.max[1]},${bound.max[2]};`;
  }
  return signature;
}

export interface RuntimeStatsApp {
  onFrame: ((deltaMs: number) => void) | null;
  getRenderStats(): { drawCalls: number; triangles: number };
  getScriptMessageDebugSnapshot(): ScriptMessageDebugSnapshot;
  /** Optional: AI controllers + blackboards for the `?debug` overlay. */
  getAiDebugSnapshot?(): AiDebugSnapshot;
  /** Optional: AI path-following (waypoints, replans, stalls) for the `?debug` overlay. */
  getAiNavigationDebugSnapshot?(): AiNavigationDebugSnapshot;
  /** Optional: runtime Generic Spline followers for the `?debug` overlay. */
  getSplinePathFollowerDebugSnapshot?(): readonly SplinePathFollowerDebugState[];
  /** Optional: present on the runtime app, absent on the editor SceneApp. */
  getGameModeDebugSnapshot?(): GameModeDebugSnapshot;
  /** Optional: present on the runtime app, absent on the editor SceneApp. */
  getUiDebugSnapshot?(): UiDebugSnapshot;
  /** Optional: windowed frame-time stats (avg / P95 / spikes) — always on in runtime. */
  getFrameMetricsSnapshot?(): FrameMetrics;
  /** Optional: per-subsystem tick timing when `?debug` profiling is on, else null. */
  getSubsystemProfileSnapshot?(): SubsystemProfileSnapshot | null;
  /** Optional: live bottleneck classification (Faz 5) for the `?debug` overlay. */
  getBottleneckSnapshot?(): BottleneckResult | null;
  /** Optional: adaptive quality state (Faz 6) for the `?debug` overlay quality/last lines. */
  getAdaptiveDebugSnapshot?(): AdaptiveDebugSnapshot;
  /** Optional: GPU/JS memory counters for the `?debug` memory readout. */
  getPerfMemorySnapshot?(): PerfMemorySnapshot;
  /** Optional: live VFX runtime counts (active instances / alive particles / pool). */
  getVfxDebugSnapshot?(): VfxDebugSnapshot;
}

export interface RuntimeSceneAppOptions {
  readonly scriptMessageTraceLimit?: number;
  /** `?debug`: logs boot/travel load timing + asset counts to the console. */
  readonly debug?: boolean;
  /** Optional fork-owned Phase 7 content-quality settings (never authored layout data). */
  readonly qualityExtensions?: QualityExtensions;
  /** Optional fork override for asynchronous runtime-actor spawn dispatch. */
  readonly spawnBudgetPerFrame?: number;
  /**
   * Opt-in Layer 2 capability modules, in the order they should run. Injected by
   * the composition root (`main.ts`) so a fork changes its runtime behavior set
   * without editing this shell. Omitted means "no extra capabilities": the
   * Layer 1 level content still builds in full.
   */
  readonly capabilities?: readonly CapabilityModule[];
}

/** Mounts the dialogue subtitle overlay into `#ui-overlay`, or null when absent. */
function mountSubtitleOverlay(): SubtitleOverlay | null {
  const host = typeof document !== "undefined" ? document.getElementById("ui-overlay") : null;
  return host ? new SubtitleOverlay(host) : null;
}

/** Mounts the conversation choice overlay into `#ui-overlay`, or null when absent. */
function mountConversationOverlay(): ConversationOverlay | null {
  const host = typeof document !== "undefined" ? document.getElementById("ui-overlay") : null;
  return host ? new ConversationOverlay(host) : null;
}

const AI_SCRIPT_STIMULUS_MESSAGE_TYPES = [
  "Damage.Apply",
  "Damage.Died",
  "damage",
  "alert",
  "ui-action",
  "game-event",
] as const;

const AI_ATTACK_ANIMATION_MESSAGE_TYPES = ["ai.attack.intent", "boss.attack.intent"] as const;

/** Compact one-line reason for a failed asset load (for the load-progress detail). */
function describeLoadError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "load failed";
}

export class RuntimeSceneApp implements RuntimeStatsApp {
  private readonly sceneShell: SceneShell;
  private readonly levelRuntime: LevelRuntime;
  /** Layer 2 modules registered for this runtime; empty until a fork opts in. */
  private readonly capabilities: CapabilityRegistry;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly engineApp = new EngineApp();
  private readonly animationSubsystem = new AnimationSubsystem();
  private readonly inputActions = new ActionMap(DEFAULT_INPUT_BINDINGS);
  private readonly inputSubsystem = new InputSubsystem(this.inputActions);
  private readonly physicsSubsystem = new PhysicsSubsystem({ backend: "rapier" });
  private readonly movingPlatformSubsystem: MovingPlatformSubsystem;
  private readonly splinePathFollowerSubsystem: SplinePathFollowerSubsystem;
  private readonly characterMovementSubsystem: CharacterMovementSubsystem;
  /** Owns every AIController possessing an NPC pawn (decision tick lands in Faz 2). */
  private readonly aiSubsystem = new AISubsystem({
    taskRegistry: createGameAiTaskRegistry(),
    blockers: () => this.physicsSubsystem.staticBlockerAabbs(),
    perceptionSourceFilter: (entity) => this.isAiPerceptionSource(entity),
    qualityFocusPosition: () => this.qualityFocusPosition(),
  });
  private readonly aiPathFollowing = new Map<string, RuntimeAiPathFollowing>();
  /**
   * Bakes one nav grid per agent profile and reuses it across path queries while
   * static blockers + nav bounds are unchanged (the Unreal navmesh-bake analogue).
   * Keyed by {@link aiNavRevisionToken}; rebuilds automatically when that token
   * changes. Only used when an AI Navigation Volume supplies query-independent
   * bounds — otherwise the grid extent depends on start/goal and can't be baked.
   */
  private readonly navGridCache = new NavGridCache();
  /** Last static-blocker array identity seen; a new reference bumps the revision. */
  private navBlockerRevisionRef: readonly NavAabb[] | null = null;
  private navSurfaceRevisionRef: ReturnType<PhysicsSubsystem["staticSurfaceTriangles"]> | null = null;
  private navBlockerRevision = 0;
  private readonly aiCharacterAnimators = new Map<string, RuntimeAiCharacterAnimator>();
  private aiNavigationView: Group | null = null;
  /** Manifest sound asset id -> fetchable file URL, filled after the manifest loads. */
  private readonly soundUrlById = new Map<string, string>();
  /** Manifest soundCue asset id -> fetchable file URL. */
  private readonly soundCueUrlById = new Map<string, string>();
  /** Parsed soundCue assets, cached by id. */
  private readonly soundCueDefs = new Map<string, SoundCueAsset | null>();
  /** Manifest effect (`.effect.json`) asset id -> fetchable file URL. */
  private readonly effectUrlById = new Map<string, string>();
  /** Manifest texture asset id -> fetchable image URL (particle sprite textures). */
  private readonly textureUrlById = new Map<string, string>();
  /**
   * Owns every live particle effect: definition cache, pooling, per-frame advance
   * and one-shot recycling. Resolves effect ids to URLs through
   * {@link effectUrlById} and sprite-texture ids through {@link textureUrlById}.
   */
  private readonly vfxSubsystem = new VfxSubsystem({
    resolveEffectUrl: (effectId) => this.effectUrlById.get(effectId) ?? null,
    resolveTextureUrl: (textureId) => this.textureUrlById.get(textureId) ?? null,
  });
  private readonly audioSubsystem = new AudioSubsystem({
    backend: "web-audio",
    resolveClipUrl: (clipId) => this.soundUrlById.get(clipId) ?? null,
  });
  /** Bottom-centre subtitle line for dialogue (null when no #ui-overlay host). */
  private readonly subtitleOverlay = mountSubtitleOverlay();
  /**
   * Dialogue & Voice runtime: resolves authored lines to audio + subtitles.
   * Audio is delegated back to {@link audioSubsystem}; subtitles drive the
   * overlay above. Voices/lines are registered from the manifest on scene load.
   */
  private readonly dialogueSubsystem = new DialogueSubsystem({
    playAudio: (request) => this.playDialogueAudio(request),
    // D4 localization: a line's localizationKey resolves its subtitle against the
    // active `.loc.json` locale table (read live so a locale switch takes effect).
    // Missing entries fall back to the authored text. Per-locale *audio* stays as
    // context mappings, so no audio lookup is wired here.
    localization: {
      resolveSubtitle: (key) => this.localeRegistry?.resolveOptional(key),
    },
    onSubtitleShow: (event) =>
      this.subtitleOverlay?.show({
        lineId: event.lineId,
        text: event.text,
        ...(event.speakerName ? { speakerName: event.speakerName } : {}),
      }),
    onSubtitleHide: (lineId) => this.subtitleOverlay?.hide(lineId),
    // Feeds line completion to the conversation director so it can advance a
    // running conversation to the next node once a line's subtitle finishes.
    onLineEnd: (info) => this.conversationDirector.notifyLineEnd(info.lineId, info.interrupted),
  });
  /** Unsubscribes the `play-dialogue` script-message trigger (released on dispose). */
  private dialogueUnsub: (() => void) | null = null;
  /** Interactive choice panel for conversations (null when no #ui-overlay host). */
  private readonly conversationOverlay = mountConversationOverlay();
  /**
   * Conversation runtime (Faz D3): walks authored `*.conversation.json` graphs,
   * playing each line through {@link dialogueSubsystem}, showing choice UI, and
   * emitting `event` nodes onto the script-message bus. Started by the
   * `start-conversation` script message.
   */
  private readonly conversationDirector = new ConversationDirector({
    playLine: (lineId, context) => this.dialogueSubsystem.playLine(lineId, context),
    stopLine: (lineId) => this.dialogueSubsystem.stopLine(lineId),
    emitEvent: (event) =>
      this.behaviorSubsystem.emitScriptMessage(
        event.eventId,
        "conversation",
        event.payload ?? {},
      ),
    showChoices: (view) =>
      this.conversationOverlay?.show(
        {
          choices: view.choices,
          ...(view.prompt !== undefined ? { prompt: view.prompt } : {}),
        },
        (index) => this.conversationDirector.choose(index),
      ),
    hideChoices: () => this.conversationOverlay?.hide(),
  });
  /** Unsubscribes the `start-conversation` script-message trigger (released on dispose). */
  private conversationUnsub: (() => void) | null = null;
  private readonly keyboardInput = new KeyboardInputSource(this.inputActions);
  /** Gamepad → action-map bridge (poll-only, fed once per frame in the loop). */
  private readonly gamepadInput = new GamepadInputSource(this.inputActions);
  /** On-screen touch controls (virtual move stick + look pad + buttons); null until mounted. */
  private touchInput: TouchInputSource | null = null;
  /** Reusable scratch vectors for the per-frame spatial-audio listener update. */
  private readonly listenerPos = new Vector3();
  private readonly listenerDir = new Vector3();
  private readonly pointerLook: PointerLookSource;
  private readonly pointerButtons: PointerButtonSource;
  private readonly behaviorSubsystem: BehaviorSubsystem;
  private frameHandle = 0;
  private lastTime = 0;
  /** Frame-time telemetry (avg / P95 / spikes) — stays on in production for the
   * adaptive quality controller; fed the raw pre-clamp rAF delta (plan §3.1). */
  private readonly frameMetrics = new FrameMetricsMonitor();
  /** Skips one frame-time sample after the tab regains focus (drops the rAF
   * catch-up delta so a visibility change is not miscounted as a spike). */
  private skipFrameMetricSample = false;
  /** Active runtime quality profile. Defaults to Ultra so behaviour is identical
   * to the pre-quality-layer runtime until a profile is applied (Principle #2:
   * this only ever gates authored effects down, never writes layout data). */
  private qualitySettings: QualitySettings = resolveQualitySettings("ultra");
  /** Fork-provided Phase 7 content scaling; template profiles deliberately omit it. */
  private qualityExtensions: QualityExtensions = {};
  /** Adaptive quality controller (Faz 6). Owns the player's profile as its base
   * ceiling and layers transient runtime reductions over it (never persisted,
   * never above the ceiling). Constructed once the profile is resolved in the
   * constructor; the frame loop ticks it via {@link tickAdaptiveQuality}. */
  private adaptiveController!: AdaptiveQualityController;
  /** Seconds accumulated toward the next adaptive controller tick (Faz 6). */
  private adaptiveTickAccumulator = 0;
  /** Active-gameplay seconds accumulated toward the one-time startup measurement
   * calibration (Faz 4). `null` once calibration is done or not pending, so the
   * update tick does nothing after the single pass. */
  private startupCalibrationElapsed: number | null = null;
  private activeProject: ActiveProject | null = null;
  private assetLoader: AssetLoader | null = null;
  private layout: RoomLayout | null = null;
  private activeLevelPath: string | null = null;
  /** Placement-scoped vertex colors authored in Scene Editor's Mesh Paint Mode. */
  private meshPaintData: LayoutMeshPaintData = createEmptyMeshPaintData();
  /** Owns slot-based save/load: store, pending-restore latch, checkpoint + UI (P2.3). */
  private readonly saveCoordinator: RuntimeSaveCoordinator;
  /** Owns Level Travel: the travel state machine + async teardown/rebuild loop (P2.2). */
  private readonly travelCoordinator: RuntimeTravelCoordinator;
  /** Owns runtime actor spawning: the spawn id counter + spawn orchestration (P2.4). */
  private readonly spawnCoordinator: RuntimeActorSpawnCoordinator;
  private collisionDefs = new Map<string, AssetCollisionDef>();
  /** Render-mesh triangle data for `complexAsSimple` assets (static trimesh collider). */
  private complexCollisionMeshes = new Map<string, AssetComplexCollisionMesh>();
  private models = new Map<string, GLTF>();
  private convertedUnlitMaterials = 0;
  private instanceGroups = new Map<string, Group>();
  private instanceMeshes = new Map<string, InstancedMesh[]>();
  /**
   * Instanced-static placements a `collectible` behavior has collected, keyed by
   * `overrideObjectKey(assetId, placementIndex)`. The per-frame instance-transform
   * sink re-writes an instance's matrix, so a one-shot collapse would reappear;
   * this set keeps the collected slot collapsed every frame instead.
   */
  private readonly collectedInstances = new Set<string>();
  /** Level-owned splines, indexed once for gameplay queries without render coupling. */
  private splineRegistry: SplineRegistry = createSplineRegistry();
  /** Optional `?debug` sampled-line views; regular Play never creates these resources. */
  private splineDebugObjects: SplineObject[] = [];
  /** Runtime InstancedMesh outputs authored by generic spline generators. */
  private splineGeneratedGroups: Group[] = [];
  /** Static physics entities emitted by opt-in spline deform-mesh collision. */
  private splineColliderEntities: Entity[] = [];
  /** Asset manifest (with `.assets`), cached once the scene begins loading. */
  private assetManifest: AssetManifest | null = null;
  private readonly textureLoader = new TextureLoader();
  /** Loaded material override assets, cached by material id. */
  private readonly materialCache = new Map<string, Material>();
  /** In-flight material loads, deduped by material id. */
  private readonly materialLoads = new Map<string, Promise<Material | undefined>>();
  /** Per-asset default material slots (`*.materials.json` sidecars). */
  private readonly assetMaterialSlots = new Map<string, AssetMaterialSlotsDef>();
  /** Cloned override mesh per overridden placement, keyed by `assetId:placementIndex`. */
  private readonly instanceOverrideObjects = new Map<string, Object3D>();
  /** Baked PMREM cache per Sphere Reflection Capture, by index (null = hidden / unbaked). */
  private reflectionCaptureBakes: (SphereReflectionCaptureBake | null)[] = [];
  /** Per-asset materials cloned to carry a probe envMap; disposed on rebuild. */
  private readonly instanceProbeMaterials = new Map<string, Material[]>();
  /** Planar Reflection (mirror) reflectors built from `layout.reflectionPlanes`. */
  private reflectionPlaneObjects: ReflectionPlaneObject[] = [];
  /** Solid grey-box meshes for `renderInGame` Blocking Volumes (collision is separate). */
  private blockingVolumeObjects: BlockingVolumeObject[] = [];
  /** Textured reflective-surface meshes built from `layout.reflectiveSurfaces`. */
  private reflectiveSurfaceObjects: ReflectiveSurfaceObject[] = [];
  /** InstancedMesh foliage batches painted onto the level (Foliage Mode). */
  private foliageBinding: FoliageRenderBinding | null = null;
  /** Chunked terrain meshes built from `layout.landscapes`. */
  private landscapeObjects: LandscapeObject[] = [];
  /** Base-color textures loaded for landscape paint-layer splatting; disposed on scene rebuild. */
  private landscapeLayerTextures: Texture[] = [];
  /** Static collider entities generated from collidable runtime landscapes. */
  private landscapeColliderEntities: Entity[] = [];
  /** Render host per generated landscape collider entity, for Play collision debug wires. */
  private readonly landscapeColliderObjects = new Map<string, Object3D>();
  private characterObjects: Object3D[] = [];
  private characterRefs: RuntimeCharacterRef[] = [];
  private lightObjects: LightObjectRecord[] = [];
  /** Entities flattened from placed Actor Script instances (`layout.actors`). */
  private actorEntities: Entity[] = [];
  /** Live actor entities keyed by entity id (`actor:<n>` and runtime `spawned:<n>`). */
  private readonly actorEntityById = new Map<string, Entity>();
  /** Rendered object per actor entity id (absent for mesh-less logic actors). */
  private readonly actorObjects = new Map<string, Object3D>();
  /**
   * Collider debug wireframe per actor entity id: a green box traced around the
   * actual (scale-baked) physics collider, so scaling a placed actor visibly
   * scales its collider in Play. Suppressed by the Collider component's
   * `hideInGame` flag; updated each frame from {@link PhysicsSubsystem.colliderDebugBox}.
   */
  private readonly colliderDebugWires = new Map<string, LineSegments>();
  /**
   * Authored MeshRenderer local scale per actor entity id, multiplied into the
   * placement scale on every transform sync so a class's visual scale survives
   * the per-frame override (the sync writes the placement scale, which omits it).
   */
  private readonly actorMeshScales = new Map<string, Vec3>();
  /** Resolved `*.actor.json` classes, cached by classRef across instances. */
  private readonly actorClassCache = new Map<string, ActorScriptDef>();
  private localBounds = new Map<string, Box3>();
  private sun: DirectionalLight | null = null;
  private ambientLight: AmbientLight | null = null;
  /** Sky Atmosphere dome (singleton); null when no sky actor is in the layout. */
  private skyObject: Sky | null = null;
  private cloudObject: CloudDome | null = null;
  /** Captured Sky Light environment (PMREM) backing `scene.environment`; null when none. */
  private reflectionTarget: WebGLRenderTarget | null = null;
  private postProcessPipeline: PostProcessPipeline | null = null;
  private cameraViewTouched = false;
  /** Latest per-entity locomotion snapshot a behavior reported (read by the Game Mode). */
  private readonly locomotionReports = new Map<string, LocomotionInput>();
  private readonly interactionPromptElement: HTMLDivElement;
  private activeInteractionPromptEntityId: string | null = null;
  /** The active Game Mode session driving camera/possession this Play boot. */
  private gameModeSession: GameModeSession | null = null;
  /**
   * The Game Mode resolved for this Play boot (built-in registry mode, or a
   * project `gameMode` Actor Script). Resolved once (it may load a class file),
   * then reused by the spawn and session-start steps.
   */
  private activeGameMode: GameModeDefinition | null = null;
  private gravityY = DEFAULT_SCENE_GRAVITY[1];
  private killZ = DEFAULT_SCENE_KILL_Z;
  private readonly pawnRespawnTransforms = new Map<string, TransformComponent>();
  private inputMode: InputMode = "ui";
  /** UMG Lite runtime UI host; null when the layout authors no HUD/pause widget. */
  private uiSubsystem: RuntimeUiSubsystem | null = null;
  /** World-space UI host (projected DOM billboards); null when the layout places none. */
  private worldUiSubsystem: WorldUiSubsystem | null = null;
  /** ViewModel-lite store backing UI `{ "bind": "path" }` props (e.g. `player.speed`). */
  private readonly uiStore = new UiViewModelStore();
  /** Pause-menu widget pushed on the `menu` action; null when none is configured. */
  private pauseMenuDef: UiWidgetDef | null = null;
  /** Minimal gameplay-rules store; null when the scene authors no `gameRules`. */
  private gameStateStore: GameStateStore | null = null;
  /** Unsubscribe for the `game-event` script-message bridge into the rules store. */
  private gameEventUnsub: (() => void) | null = null;
  /** Unsubscribes script-message -> AI perception stimulus bridge handlers. */
  private aiStimulusUnsubs: Array<() => void> = [];
  /** Unsubscribes AI attack intent -> one-shot animation bridge handlers. */
  private aiAttackAnimationUnsubs: Array<() => void> = [];
  /** Modal screens shown when the rules layer resolves a win/loss; null when none. */
  private winScreenDef: UiWidgetDef | null = null;
  private loseScreenDef: UiWidgetDef | null = null;
  /** True once the win/loss screen for the current terminal round has been pushed. */
  private gameOutcomeShown = false;
  /** All loaded `.ui.json` widget defs keyed by asset id (used by Include resolution). */
  private readonly uiDefs = new Map<string, UiWidgetDef>();
  /** Loaded UI theme defs keyed by their `theme` reference (asset id or path). */
  private readonly uiThemes = new Map<string, UiThemeDef>();
  /** Loaded UI localization tables + active locale; null when the scene authors none. */
  private localeRegistry: LocaleRegistry | null = null;
  /** Slotless user preferences (audio mix, locale); null when storage is unavailable. */
  private userSettingsStore: UserSettingsStore | null = null;
  private userSettings: UserSettings = defaultUserSettings();
  /** Boot/travel model-load progress (P4); drives the loading overlay + `loading.*` fields. */
  private readonly loadProgress = new LoadProgressTracker();
  /** Full-screen loading overlay shown during boot + level travel; null with no DOM host. */
  private loadingOverlay: LoadingOverlay | null = null;
  /** `?debug`: logs load timing + asset counts. */
  private readonly debug: boolean;
  /** performance.now() at the current load's start, for the `?debug` timing readout. */
  private loadStartMs = 0;

  onFrame: ((deltaMs: number) => void) | null = null;

  private readonly applyEntityTransformToRender = (
    entityId: string,
    transform: TransformComponent,
  ): void => {
    const instance = parseInstanceEntityId(entityId);
    if (instance) {
      this.syncInstanceTransform(instance.assetId, instance.placementIndex, transform);
      return;
    }

    const actorObject = this.actorObjects.get(entityId);
    if (actorObject) {
      if (!actorObject) return;
      actorObject.position.set(transform.position[0], transform.position[1], transform.position[2]);
      applyEulerDegrees(actorObject, transform.rotation);
      // Re-apply the class's MeshRenderer scale: the synced transform carries only
      // the placement scale, so without this the per-frame override would reset a
      // shrunk/grown character to full size.
      const meshScale = this.actorMeshScales.get(entityId) ?? [1, 1, 1];
      actorObject.scale.set(
        transform.scale[0] * meshScale[0],
        transform.scale[1] * meshScale[1],
        transform.scale[2] * meshScale[2],
      );
      return;
    }

    const index = parseCharacterEntityIndex(entityId);
    if (index === null) return;
    const object = this.characterObjects[index];
    if (!object) return;
    object.position.set(transform.position[0], transform.position[1], transform.position[2]);
    applyEulerDegrees(object, transform.rotation);
    object.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
  };

  private readonly syncEntityTransform = (entityId: string, transform: TransformComponent): void => {
    this.applyEntityTransformToRender(entityId, transform);
    this.physicsSubsystem.setEntityTransform(entityId, transform);
    this.aiSubsystem.updateEntityTransform(entityId, transform);
  };

  constructor(canvas: HTMLCanvasElement, options: RuntimeSceneAppOptions = {}) {
    this.debug = options.debug ?? false;
    this.sceneShell = new SceneShell(canvas, {
      backgroundColor: DEFAULT_SCENE_BACKGROUND_COLOR,
    });
    this.renderer = this.sceneShell.renderer;
    applyEditorMatchedPlayLook(this.renderer);
    this.scene = this.sceneShell.scene;
    // The VFX subsystem owns one persistent container; live effects come and go
    // as its children (survives scene rebuilds — only its instances are cleared).
    this.scene.add(this.vfxSubsystem.root);
    this.camera = this.sceneShell.camera;
    this.capabilities = createCapabilityRegistry(options.capabilities ?? []);
    this.levelRuntime = new LevelRuntime({
      mode: "runtime",
      environmentRender: {
        fitSunShadow: () => this.fitSunShadowToScene(),
        applyBackgroundAndAmbient: () => this.applyBackgroundAndAmbient(),
        applySky: () => this.applyRuntimeSky(),
        applyReflectionEnvironment: () => this.applyRuntimeReflection(true),
        applyPostProcess: () => this.applyRuntimePostProcess(),
        applyFog: () => this.applyRuntimeFog(),
        applyClouds: () => this.applyRuntimeClouds(),
      },
      reflectionObjects: {
        buildReflectionCaptures: () => this.buildRuntimeReflectionCaptures(),
        buildReflectionPlanes: () => this.buildRuntimeReflectionPlanes(),
        buildReflectiveSurfaces: () => this.buildRuntimeReflectiveSurfaces(),
      },
      worldGeometry: {
        buildBlockingVolumes: () => this.buildRuntimeBlockingVolumes(),
        buildSplines: () => this.buildRuntimeSplines(),
        buildLandscapes: () => this.buildRuntimeLandscapes(),
        buildFoliage: () => this.buildRuntimeFoliage(),
      },
      coreContent: {
        loadModels: async () => {
          const loader = this.assetLoader;
          const layout = this.layout;
          if (!loader || !layout) throw new Error("Runtime level content is not ready to load models.");
          this.setLoadingStatus("Loading models");
          const expectedModelIds = await this.collectExpectedModelIds();
          this.loadProgress.clear();
          this.loadProgress.expectAll(expectedModelIds);
          this.models = await loader.loadGroups(layout.loadGroups);
          await this.loadMissingSceneModels();
          await this.loadActorMeshModels();
          this.setLoadingStatus("Preparing scene");
          this.convertedUnlitMaterials = convertUnlitModelMaterialsToLit(this.models);
          this.localBounds = computeModelLocalBounds(this.models);
        },
        registerShapeModels: () => {
          const layout = this.layout;
          if (!layout) throw new Error("Runtime level content is not ready to register shape models.");
          registerSceneShapeModels(layout, this.models, this.localBounds);
        },
        applyAssetUvwMappings: () => this.applyAssetUvwMappings(),
        applyMaterialSlots: () => this.loadSceneMaterials(),
        beforeBuildSceneEntities: async () => {},
        buildSceneEntities: () => {
          const layout = this.layout;
          if (!layout) throw new Error("Runtime level content is not ready to build entities.");
          buildSceneEntities(layout, {
            addInstance: (assetId, placements) => {
              if (isMarkerAssetId(assetId)) return;
              this.scene.add(this.createInstancedModel(assetId, placements));
            },
            addCharacter: (assetId, character) => this.addCharacter(this.models.get(assetId), character),
            addLight: (light) => this.addLight(light),
          });
        },
        buildActorInstances: async () => this.addActorObjects(),
      },
    });
    this.pointerLook = new PointerLookSource(canvas, {
      onInputModeChange: (mode) => {
        const wasGame = this.inputMode === "game";
        this.inputMode = mode;
        // Losing pointer lock during play (Escape / alt-tab) opens the pause menu.
        // This covers browsers that swallow the Escape keydown under pointer lock,
        // where the `menu` action edge would otherwise never fire.
        if (mode === "ui" && wasGame) this.openPauseMenu();
      },
    });
    this.pointerButtons = new PointerButtonSource(this.inputActions, canvas);
    this.interactionPromptElement = this.createInteractionPromptElement();
    this.userSettingsStore = createRuntimeUserSettingsStore();
    this.userSettings = this.userSettingsStore?.read() ?? defaultUserSettings();
    this.applyUserAudioSettings(this.userSettings);
    // Seed the active quality profile from the persisted graphics preference so the
    // first scene build resolves post-process at the player's chosen profile (the
    // remaining knobs — shadows, resolution, particle density — are applied once
    // the scene's lights + composer exist; see applyQualitySettings at build end).
    this.qualitySettings = resolveQualitySettings(
      this.userSettings.graphics.selectedQualityLevel,
      this.userSettings.graphics.customSettings,
    );
    if (options.qualityExtensions) this.applyQualityExtensions(options.qualityExtensions);
    // Startup calibration (Faz 4): a fresh player who has never picked a profile
    // gets a hardware-hinted starting profile now, and arms a one-time
    // first-gameplay measurement pass. A manual choice or a prior calibration
    // both suppress this — measurement decides, but the player always wins.
    this.runStartupHintCalibration();
    // The adaptive controller's base ceiling is the resolved profile above; it
    // only ever reduces below it and restores back up to it (plan §17.3).
    this.adaptiveController = new AdaptiveQualityController(this.qualitySettings);
    this.movingPlatformSubsystem = new MovingPlatformSubsystem(this.syncEntityTransform);
    this.characterMovementSubsystem = new CharacterMovementSubsystem(
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
      {
        getGravityY: () => this.gravityY,
        getControlYaw: (entityId) => this.gameModeSession?.controlYawForEntity?.(entityId),
        reportLocomotion: (entityId, report) => {
          this.locomotionReports.set(entityId, report);
        },
        dynamicBlockers: (entityId) => this.characterBlockerAabbs(entityId),
        isPlayerControlled: (entityId) =>
          this.inputMode !== "ui" &&
          this.gameModeSession?.playerState.pawnEntityId === entityId &&
          !this.gameModeSession.playerState.pawnControlSuspended,
        getMoveIntent: (entityId, transform, deltaSeconds) =>
          this.aiMoveIntentForEntity(entityId, transform, deltaSeconds),
        platforms: this.movingPlatformSubsystem,
      },
    );
    // A SplinePathFollower is an explicit kinematic route owner. It runs after
    // character/AI movement and resets that subsystem's local copy, so an AI
    // controller cannot overwrite its spline sample on the following frame.
    this.splinePathFollowerSubsystem = new SplinePathFollowerSubsystem(
      () => this.splineRegistry,
      (entityId, transform) => {
        this.characterMovementSubsystem.resetEntityTransform(entityId, transform);
        this.syncEntityTransform(entityId, transform);
      },
    );

    this.engineApp.registerSubsystem(this.animationSubsystem);
    this.engineApp.registerSubsystem(this.inputSubsystem);
    this.engineApp.registerSubsystem(this.physicsSubsystem);
    // The platform subsystem must tick before character movement so a rider is
    // carried by the same frame's platform delta (no one-frame lag).
    this.engineApp.registerSubsystem(this.movingPlatformSubsystem);
    // AI decisions tick before character movement so an agent's move-intent (Faz 3)
    // is consumed by the same frame's movement resolve. In Faz 1 the subsystem
    // holds controllers + blackboards only and does no per-frame work.
    this.engineApp.registerSubsystem(this.aiSubsystem);
    this.engineApp.registerSubsystem(this.characterMovementSubsystem);
    // Explicit spline movement is applied last so it wins over optional AI/nav
    // move intents on the same actor.
    this.engineApp.registerSubsystem(this.splinePathFollowerSubsystem);
    this.physicsSubsystem.setTransformSink(this.applyEntityTransformToRender);
    this.behaviorSubsystem = new BehaviorSubsystem(
      this.createSceneBehaviorRegistry(),
      this.inputActions,
      this.syncEntityTransform,
      this.physicsSubsystem,
      this.audioSubsystem,
      {
        messageTraceLimit: options.scriptMessageTraceLimit ?? 0,
        onMessageWarnings: (warnings) => {
          for (const warning of warnings) {
            // Animation notifies are fire-and-forget; no subscriber is normal, so
            // don't spam the console when nothing reacts to one.
            if (warning.code === "missing-handler" && warning.envelope?.type === "anim-notify") {
              continue;
            }
            console.warn("[script-message]", warning.message, warning.envelope ?? "");
          }
        },
        // Generic actor command surface (A1/A6): a behavior's setVisibility/
        // setCollisionEnabled/destroy is applied here to the rendered object +
        // physics body.
        actorCommandSink: {
          setVisibility: (entityId, visible) => this.setActorObjectVisible(entityId, visible),
          setCollisionEnabled: (entityId, enabled) =>
            this.physicsSubsystem.setEntityCollisionEnabled(entityId, enabled),
          destroy: (entityId) => this.destroyActorEntity(entityId),
          // Impulse routes to the simulated body; launch to the (kinematic)
          // character subsystem — the two write surfaces Unreal splits as
          // AddImpulse vs LaunchCharacter (A6).
          addImpulse: (entityId, impulse) => this.physicsSubsystem.applyImpulse(entityId, impulse),
          launch: (entityId, velocity, launchOptions) =>
            this.characterMovementSubsystem.launch(entityId, velocity, launchOptions),
          spawn: (request) => {
            this.spawnCoordinator.enqueueRuntimeActor(request);
          },
        },
        // Velocity source for `world.velocityOf` (A6, Unreal GetVelocity): the
        // character subsystem owns the (kinematic) pawn velocity, the physics
        // subsystem the simulated dynamic bodies; character wins when both exist.
        velocityProvider: {
          velocityOf: (entityId) =>
            this.characterMovementSubsystem.velocityOf(entityId) ??
            this.physicsSubsystem.velocityOf(entityId),
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
      moveTo: (request) => this.requestAiMove(request),
    });
    this.engineApp.registerSubsystem(this.behaviorSubsystem);
    this.engineApp.registerSubsystem(this.audioSubsystem);
    this.engineApp.registerSubsystem(this.dialogueSubsystem);
    this.engineApp.registerSubsystem(this.vfxSubsystem);
    // Per-subsystem tick timing (P5.1): `?debug` enables it for the overlay; the
    // adaptive controller also needs it as the bottleneck classifier's passive CPU
    // signal (§7.3), then with a smaller window since it reads seconds-scale trends.
    // Enabling wraps each subsystem update in a clock read; production without
    // either keeps the un-timed loop.
    if (this.debug) this.engineApp.enableProfiling();
    else if (this.userSettings.graphics.adaptiveOptimizationEnabled) {
      this.engineApp.enableProfiling(undefined, ADAPTIVE_PROFILER_WINDOW_FRAMES);
    }
    this.keyboardInput.attach();
    this.gamepadInput.attach();
    this.attachTouchControls(canvas);
    this.pointerLook.attach();
    this.pointerButtons.attach();
    this.resumeAudioOnFirstGesture();

    this.travelCoordinator = new RuntimeTravelCoordinator({
      clearPendingRestore: () => this.saveCoordinator.clearPendingRestore(),
      beginLoadingUi: (status) => this.beginLoadingUi(status),
      finishLoadingUi: () => this.finishLoadingUi(),
      showLoadError: (message) =>
        this.loadingOverlay?.showError(message, () => {
          if (typeof location !== "undefined") location.reload();
        }),
      teardownScene: () => this.teardownScene(),
      buildScene: (layoutPath, spawnTag) => this.buildScene(layoutPath, spawnTag),
    });

    this.spawnCoordinator = new RuntimeActorSpawnCoordinator({
      hasLayout: () => this.layout !== null,
      hasActorEntity: (entityId) => this.actorEntityById.has(entityId),
      loadActorClass: (classRef) => this.loadActorClass(classRef),
      registerActorEntity: (entity) => this.registerActorEntity(entity),
      loadActorMeshModels: (entities) => this.loadActorMeshModels(entities),
      addActorObject: (entity) => this.addActorObject(entity),
      addEntityToPhysics: (entity) => this.physicsSubsystem.addEntity(entity),
      addEntityToBehavior: (entity, owner) =>
        this.behaviorSubsystem.addEntity(entity, { owner }),
      playAutoPlayAudio: (entity) => this.playAutoPlayAudioEntity(entity),
      playAutoPlayParticle: (entity) => {
        void this.playAutoPlayParticleEntity(entity);
      },
    }, options.spawnBudgetPerFrame !== undefined ? { maxSpawnsPerFrame: options.spawnBudgetPerFrame } : {});

    this.saveCoordinator = new RuntimeSaveCoordinator({
      uiStore: this.uiStore,
      collectSaveState: () => this.collectCurrentSaveState(),
      applyRestore: (restore) => {
        this.behaviorSubsystem.applyPersistentStateSnapshot(restore.persistentState);
        if (restore.player) this.applySavedPlayerTransform(restore.player);
      },
      enqueueLevelTravel: (levelPath) => this.travelCoordinator.enqueueLevelTravel(levelPath),
      clearScreens: () => this.uiSubsystem?.clearScreens(),
    });

    this.setupLoadingOverlay();
    void this.loadActiveProjectScene();
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
  }

  private createSceneBehaviorRegistry(): ReturnType<typeof createBehaviorRegistry> {
    return createBehaviorRegistry({
      getGravityY: () => this.gravityY,
      reportLocomotion: (entityId, report) => {
        this.locomotionReports.set(entityId, report);
      },
      onGoalReached: (entityId) => {
        console.info("[runtime] goal reached", entityId);
      },
      onInteraction: (entityId, action) => {
        console.info("[runtime] interaction", action, entityId);
      },
      onInteractionOverlap: (entityId, action, prompt, overlapping) => {
        this.setInteractionPrompt(entityId, action, prompt, overlapping);
      },
      onActorLightToggle: (entityId, enabled) => {
        this.setActorLightEnabled(entityId, enabled);
      },
      onActorParticleEffect: (entityId) => {
        void this.playActorParticleEffect(entityId);
      },
      onLevelTravel: (_entityId, targetLevel, targetSpawn) => {
        this.travelCoordinator.requestLevelTravel(targetLevel, targetSpawn);
      },
      onCheckpoint: (_entityId, slot) => {
        this.saveCoordinator.writeCheckpointSave(slot);
      },
      // The active Game Mode owns possession: only the pawn it possessed
      // (none, under the default camera mode) is driven by player input.
      isPlayerControlled: (entityId) =>
        this.inputMode !== "ui" &&
        this.gameModeSession?.playerState.pawnEntityId === entityId &&
        !this.gameModeSession.playerState.pawnControlSuspended,
    });
  }

  /**
   * Mounts the boot/travel loading overlay (P4) and subscribes it to the model
   * load tracker: every settle updates the bar + detail line and mirrors the same
   * values into the UI ViewModel (`loading.*`) for any fork HUD binding them.
   * Shown immediately so boot never flashes a black canvas.
   */
  private setupLoadingOverlay(): void {
    const host = typeof document !== "undefined" ? document.getElementById("ui-overlay") : null;
    if (!host) return;
    this.loadingOverlay = new LoadingOverlay(host);
    this.loadProgress.subscribe((snapshot) => {
      const detail = formatLoadDetail(snapshot);
      this.loadingOverlay?.setProgress(snapshot.fraction, detail);
      this.uiStore.setField("loading.percent", Math.round(snapshot.fraction * 100));
      this.uiStore.setField("loading.detail", detail);
    });
    // Shown/hidden by beginLoadingUi / finishLoadingUi around each boot + travel.
  }

  /** Sets the loading overlay's phase status line + the `loading.status` field. */
  private setLoadingStatus(status: string): void {
    this.loadingOverlay?.setStatus(status);
    this.uiStore.setField("loading.status", status);
  }

  start(): void {
    this.lastTime = performance.now();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      const rawDeltaMs = now - this.lastTime;
      // Frame-time stats see the RAW delta so >100 ms hitches stay visible; the
      // simulation still runs on the clamped delta for stability (plan §3.1).
      if (this.skipFrameMetricSample) this.skipFrameMetricSample = false;
      else this.frameMetrics.record(rawDeltaMs);
      const deltaMs = Math.min(rawDeltaMs, 100);
      this.lastTime = now;
      // Gamepad is poll-only: feed it before the input subsystem advances.
      this.gamepadInput.poll();
      this.gameModeSession?.beforeEngineUpdate?.(deltaMs / 1000);
      this.engineApp.update(deltaMs / 1000);
      this.spawnCoordinator.advance();
      this.tickStartupCalibration(deltaMs / 1000);
      this.tickAdaptiveQuality(deltaMs / 1000);
      this.applyKillZ();
      // Layer 2 ticks after the engine spine and before the Game Mode (Layer 3),
      // so game rules read capability state produced this frame.
      this.capabilities.update(deltaMs / 1000);
      // Consume the `menu` edge after input advances, before the Game Mode reads
      // input, so opening a screen suppresses this frame's camera/movement.
      this.updateUiInput();
      this.gameModeSession?.update(deltaMs / 1000);
      this.updateAiCharacterAnimations(deltaMs / 1000);
      this.updateGameRules(deltaMs / 1000);
      this.updateUiStore();
      this.updateWorldUi();
      this.updateAudioListener();
      this.updateColliderDebugWires();
      if (this.skyObject) followCameraWithSky(this.skyObject, this.camera);
      if (this.cloudObject) {
        followCameraWithClouds(this.cloudObject, this.camera);
        advanceCloudTime(this.cloudObject, deltaMs / 1000);
      }
      this.foliageBinding?.updateCulling(
        this.camera.position,
        this.qualitySettings.foliageCullDistanceScale,
      );
      if (this.debug) this.updateAiNavigationDebugView();
      if (this.postProcessPipeline) this.postProcessPipeline.render(deltaMs / 1000);
      else this.renderer.render(this.scene, this.camera);
      this.onFrame?.(deltaMs);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.capabilities.dispose();
    window.removeEventListener("resize", this.handleResize);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.uiSubsystem?.dispose();
    this.uiSubsystem = null;
    this.worldUiSubsystem?.dispose();
    this.worldUiSubsystem = null;
    this.gameEventUnsub?.();
    this.gameEventUnsub = null;
    this.clearAiScriptStimulusBridge();
    this.clearAiAttackAnimationBridge();
    this.gameStateStore = null;
    this.dialogueUnsub?.();
    this.dialogueUnsub = null;
    this.conversationUnsub?.();
    this.conversationUnsub = null;
    this.conversationDirector.stop();
    this.subtitleOverlay?.dispose();
    this.conversationOverlay?.dispose();
    this.loadingOverlay?.dispose();
    this.loadingOverlay = null;
    this.removeAiNavigationDebugView();
    this.keyboardInput.detach();
    this.gamepadInput.detach();
    this.touchInput?.detach();
    this.touchInput = null;
    this.pointerLook.detach();
    this.pointerButtons.detach();
    // The VFX subsystem is registered, so engineApp.dispose() (below) tears down
    // its effects + caches through the subsystem registry, like the audio one.
    this.gameModeSession?.dispose();
    this.postProcessPipeline?.dispose();
    this.postProcessPipeline = null;
    this.disposeReflectionTarget();
    for (const bake of this.reflectionCaptureBakes) {
      if (bake) disposeSphereReflectionCaptureBake(bake);
    }
    this.reflectionCaptureBakes = [];
    for (const reflector of this.reflectionPlaneObjects) {
      this.scene.remove(reflector);
      disposeReflectionPlaneObject(reflector);
    }
    this.reflectionPlaneObjects = [];
    for (const surface of this.reflectiveSurfaceObjects) {
      this.scene.remove(surface);
      disposeReflectiveSurfaceObject(surface);
    }
    this.reflectiveSurfaceObjects = [];
    for (const volume of this.blockingVolumeObjects) {
      this.scene.remove(volume);
      disposeBlockingVolumeObject(volume);
    }
    this.blockingVolumeObjects = [];
    for (const spline of this.splineDebugObjects) {
      this.scene.remove(spline);
      disposeSplineObject(spline);
    }
    this.splineDebugObjects = [];
    for (const group of this.splineGeneratedGroups) disposeSplineGeneratedGroup(group);
    this.splineGeneratedGroups = [];
    this.splineColliderEntities = [];
    for (const object of this.landscapeObjects) {
      this.scene.remove(object);
      disposeLandscapeObject(object);
    }
    this.landscapeObjects = [];
    for (const texture of this.landscapeLayerTextures) texture.dispose();
    this.landscapeLayerTextures = [];
    this.landscapeColliderEntities = [];
    this.landscapeColliderObjects.clear();
    this.disposeInstanceProbeMaterials();
    this.interactionPromptElement.remove();
    void this.engineApp.dispose();
    this.sceneShell.dispose();
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return readSceneRuntimeStats(this.renderer);
  }

  /** Windowed frame-time stats (avg / P95 / spikes) over the 5 s decision window. */
  getFrameMetricsSnapshot(): FrameMetrics {
    return this.frameMetrics.metrics();
  }

  /** The active runtime quality profile (defaults to Ultra). */
  getQualitySettings(): QualitySettings {
    return this.qualitySettings;
  }

  /**
   * Applies the optional Phase 7 content-quality hooks supplied by a game fork.
   * These values are runtime-only and intentionally separate from the template
   * profiles: Forge has no universal NPC population, world scale or LOD policy.
   */
  applyQualityExtensions(extensions: QualityExtensions): void {
    this.qualityExtensions = { ...extensions };
    this.aiSubsystem.setDistanceUpdateSettings(
      extensions.aiUpdateHz !== undefined ? { farUpdateHz: extensions.aiUpdateHz } : {},
    );
    this.animationSubsystem.setDistanceUpdateSettings(
      extensions.farAnimationUpdateHz !== undefined ? { farUpdateHz: extensions.farAnimationUpdateHz } : {},
    );
    this.physicsSubsystem.setDynamicActiveArea(
      extensions.physicsActiveDistance !== undefined
        ? {
            activeDistance: extensions.physicsActiveDistance,
            focusPosition: () => this.qualityFocusPosition(),
          }
        : {},
    );
    applyLodBias(this.scene, extensions.lodBias);
  }

  getQualityExtensions(): Readonly<QualityExtensions> {
    return this.qualityExtensions;
  }

  /**
   * Central quality applier (Faz 2). Sets the active profile and re-resolves the
   * runtime accordingly, without ever writing layout/authored data (Principle
   * #2). Drives render scale + pixel-ratio cap, shadows (toggle / map size /
   * coverage), the post-process chain (GTAO / DoF / bloom / SMAA gate off through
   * {@link applyQualityToPostProcess}) and particle density; foliage cull is read
   * live in the frame loop from {@link QualitySettings.foliageCullDistanceScale}.
   * Runtime-only: the editor SceneApp never calls this, so the editor viewport is
   * unaffected.
   *
   * Resolution is applied before the post-process rebuild so a freshly created
   * composer inherits the scaled pixel ratio from the renderer at construction.
   */
  applyQualitySettings(settings: QualitySettings): void {
    this.qualitySettings = settings;
    this.applyRuntimeResolution();
    this.applyRuntimeShadowQuality();
    this.vfxSubsystem.setGlobalDensity(settings.particleDensity);
    this.applyRuntimePostProcess();
  }

  /**
   * Applies a new player-chosen or calibrated **base profile** (Faz 6): resets the
   * adaptive controller's ceiling to this profile — dropping any transient runtime
   * reductions — then drives the renderer. Distinct from {@link applyQualitySettings},
   * which the adaptive controller uses to push its own reduced settings *without*
   * moving the base.
   */
  private applyQualityProfile(base: QualitySettings): void {
    this.adaptiveController?.setBase(base);
    this.applyQualitySettings(base);
  }

  /**
   * Applies the active profile's render scale + pixel-ratio cap by folding both
   * into the renderer's pixel ratio (drawing-buffer scale; CSS size unchanged),
   * then syncs the post-process composer's cached ratio so its targets match.
   */
  private applyRuntimeResolution(): void {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    const ratio = effectiveDevicePixelRatio(dpr, this.qualitySettings);
    this.renderer.setPixelRatio(ratio);
    this.postProcessPipeline?.setPixelRatio(ratio);
  }

  /** Per-subsystem tick timing for the `?debug` overlay, or null when profiling is off. */
  getSubsystemProfileSnapshot(): SubsystemProfileSnapshot | null {
    return this.engineApp.getProfileSnapshot();
  }

  /**
   * Classifies the current bottleneck (Faz 5) from live passive signals — frame
   * metrics, the CPU subsystem profile (when profiling is on) and the perf budget
   * — for the `?debug` overlay and, later, the adaptive controller (Faz 6). Pure
   * reasoning lives in {@link classifyBottleneck}; this only gathers the inputs.
   * Returns null until the frame-time window has samples. The rare render-scale
   * probe and the load-activity correlation are Faz 6 inputs, so they are omitted
   * here (the classifier stays on passive signals).
   */
  getBottleneckSnapshot(): BottleneckResult | null {
    const metrics = this.frameMetrics.metrics();
    if (metrics.sampleCount === 0) return null;
    const { drawCalls, triangles } = this.getRenderStats();
    const memory = readSceneRuntimeMemory(this.renderer);
    return classifyBottleneck({
      metrics,
      subsystems: this.engineApp.getProfileSnapshot(),
      budget: evaluatePerfBudget({ drawCalls, triangles, textures: memory.textures }),
      targetFrameTimeMs: this.userSettings.graphics.targetFrameRate === 30 ? 33.3 : 16.7,
    });
  }

  /** Live VFX runtime counts for the `?debug` overlay (active/alive/pool/cache). */
  getVfxDebugSnapshot(): VfxDebugSnapshot {
    return this.vfxSubsystem.getDebugSnapshot();
  }

  /**
   * GPU resource counts (always) plus the JS heap when the browser exposes
   * `performance.memory` (Chrome-only, guarded) for the `?debug` memory readout.
   */
  getPerfMemorySnapshot(): PerfMemorySnapshot {
    return buildPerfMemorySnapshot(readSceneRuntimeMemory(this.renderer));
  }

  getScriptMessageDebugSnapshot(): ScriptMessageDebugSnapshot {
    return this.behaviorSubsystem.getScriptMessageDebugSnapshot();
  }

  /** Snapshots the AI subsystem (active controllers + blackboards) for `?debug`. */
  getAiDebugSnapshot(): AiDebugSnapshot {
    return this.aiSubsystem.getDebugSnapshot();
  }

  /** Public runtime spline facade for game systems; never exposes mutable layout data. */
  getSplineById(id: string | null | undefined): SplineQuery | null {
    return this.splineRegistry.getSplineById(id);
  }

  getSplinesByTag(tag: string | null | undefined): readonly SplineQuery[] {
    return this.splineRegistry.getSplinesByTag(tag);
  }

  /** Snapshots Generic Spline-driven entities for `?debug` and browser smoke checks. */
  getSplinePathFollowerDebugSnapshot(): readonly SplinePathFollowerDebugState[] {
    return this.splinePathFollowerSubsystem.followers();
  }

  /** Snapshots AI path following (waypoints, stuck recovery) for `?debug`. */
  getAiNavigationDebugSnapshot(): AiNavigationDebugSnapshot {
    const blockers = this.physicsSubsystem.staticNavigationBlockerAabbs();
    const agentClearances = this.aiAgentClearanceView();
    const maxClearance = Math.max(0, ...agentClearances.map((clearance) => clearance.radius));
    return {
      blockers,
      inflatedBlockers: maxClearance > 0 ? blockers.map((blocker) => inflateNavBlocker2d(blocker, maxClearance)) : [],
      agentClearances,
      bounds: this.aiNavigationBounds(),
      cellSize: AI_NAV_CELL_SIZE,
      followers: [...this.aiPathFollowing.entries()].map(([entityId, follow]) => ({
        entityId,
        status: follow.state.status,
        waypointIndex: follow.state.waypointIndex,
        pathLength: follow.state.path.length,
        path: follow.state.path,
        goal: follow.goal,
        ...(follow.speed !== undefined ? { speed: follow.speed } : {}),
        ...(follow.acceptanceRadius !== undefined ? { acceptanceRadius: follow.acceptanceRadius } : {}),
        replans: follow.replans,
        secondsWithoutProgress: follow.stuck.secondsWithoutProgress,
      })),
    };
  }

  private updateAiNavigationDebugView(): void {
    this.removeAiNavigationDebugView();
    const snapshot = this.getAiNavigationDebugSnapshot();
    const perception = this.aiPerceptionView();
    const queries = this.aiQueryView();
    const routes = this.aiTargetPointRouteView();
    if (
      snapshot.followers.length === 0 &&
      snapshot.blockers.length === 0 &&
      snapshot.inflatedBlockers.length === 0 &&
      snapshot.agentClearances.length === 0 &&
      snapshot.bounds.length === 0 &&
      perception.length === 0 &&
      queries.length === 0 &&
      routes.length === 0
    ) return;
    this.aiNavigationView = createAiNavigationView({
      blockers: snapshot.blockers,
      inflatedBlockers: snapshot.inflatedBlockers,
      agentClearances: snapshot.agentClearances,
      bounds: snapshot.bounds,
      cellSize: snapshot.cellSize,
      followers: snapshot.followers,
      perception,
      queries,
      routes,
    });
    this.scene.add(this.aiNavigationView);
  }

  /** Target Point patrol route overlay: markers, `next` links, active AI highlight. */
  private aiTargetPointRouteView(): AiTargetPointRouteView[] {
    const points = this.layout?.targetPoints ?? [];
    if (points.length === 0) return [];
    const index = createTargetPointIndex(targetPointEntriesFromLayout(points));
    const activeIds = new Set<string>();
    for (const controller of this.aiSubsystem.getDebugSnapshot().controllers) {
      for (const entry of controller.blackboard.entries) {
        if (typeof entry.value === "string" && entry.value.length > 0) activeIds.add(entry.value);
      }
    }
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

  private aiAgentClearanceView(): AiNavAgentClearanceView[] {
    const out: AiNavAgentClearanceView[] = [];
    for (const entityId of this.aiPathFollowing.keys()) {
      const transform = this.characterMovementSubsystem.transformOf(entityId);
      if (!transform) continue;
      const agent = this.aiNavAgentForEntity(entityId);
      out.push({
        entityId,
        position: transform.position,
        agentRadius: Math.max(0, agent.radius),
        radius: this.aiEffectiveClearanceRadius(agent),
      });
    }
    return out;
  }

  private removeAiNavigationDebugView(): void {
    if (!this.aiNavigationView) return;
    this.scene.remove(this.aiNavigationView);
    disposeAiNavigationView(this.aiNavigationView);
    this.aiNavigationView = null;
  }

  private requestAiMove(request: AiMoveRequest): AiBehaviorStatus {
    const entityId = request.controller.pawnEntityId;
    const transform = this.characterMovementSubsystem.transformOf(entityId);
    if (!transform) return "failure";
    const acceptanceRadius = request.acceptanceRadius ?? AI_MOVE_ACCEPTANCE_RADIUS;
    if (distance3d(transform.position, request.position) <= acceptanceRadius) {
      this.aiPathFollowing.delete(entityId);
      if (request.preserveLocomotionOnSuccess !== true) this.reportAiIdleLocomotion(entityId);
      return "success";
    }
    const existing = this.aiPathFollowing.get(entityId);
    if (!existing || !samePoint3d(existing.goal, request.position)) {
      const path = this.buildAiPath(entityId, transform.position, request.position);
      if (path.status === "failure" || path.points.length < 2) {
        this.aiPathFollowing.set(entityId, {
          goal: [...request.position],
          ...(request.preferredDirection ? { preferredDirection: [...request.preferredDirection] } : {}),
          ...(request.speed !== undefined ? { speed: request.speed } : {}),
          ...(request.acceptanceRadius !== undefined ? { acceptanceRadius: request.acceptanceRadius } : {}),
          state: { path: [], waypointIndex: 0, status: "failure" },
          stuck: freshStuckState(transform.position),
          replans: 0,
        });
        return "failure";
      }
      this.aiPathFollowing.set(entityId, {
        goal: [...request.position],
        ...(request.preferredDirection ? { preferredDirection: [...request.preferredDirection] } : {}),
        ...(request.speed !== undefined ? { speed: request.speed } : {}),
        ...(request.acceptanceRadius !== undefined ? { acceptanceRadius: request.acceptanceRadius } : {}),
        state: { path: path.points, waypointIndex: 1, status: "following" },
        stuck: freshStuckState(transform.position),
        replans: 0,
      });
      return "running";
    }
    if (existing.speed !== request.speed) {
      if (request.speed === undefined) {
        delete existing.speed;
      } else {
        existing.speed = request.speed;
      }
    }
    if (existing.acceptanceRadius !== request.acceptanceRadius) {
      if (request.acceptanceRadius === undefined) {
        delete existing.acceptanceRadius;
      } else {
        existing.acceptanceRadius = request.acceptanceRadius;
      }
    }
    if (request.preferredDirection) {
      existing.preferredDirection = [...request.preferredDirection];
    } else {
      delete existing.preferredDirection;
    }
    // A memoized failure (unreachable goal or exhausted stuck recovery) keeps
    // failing this goal until the task asks for a different one — replanning
    // the same unreachable goal every behavior tick would re-run A* for nothing.
    return existing.state.status === "failure" ? "failure" : "running";
  }

  private buildAiPath(entityId: string, start: Vec3, goal: Vec3) {
    const bounds = this.aiNavigationBounds();
    const agent = this.aiNavAgentForEntity(entityId);
    const blockers = this.physicsSubsystem.staticNavigationBlockerAabbs();
    if (bounds.length === 0) {
      // No authored AI Navigation Volume: the grid extent is derived from
      // start/goal, so it is single-query only and can't be baked/reused.
      return findGridPath({ start, goal: [...goal], agent, blockers, cellSize: AI_NAV_CELL_SIZE });
    }
    const surfaces = this.physicsSubsystem.staticNavigationSurfaceTriangles();
    // Bounded case: bake once per agent profile and reuse across queries. The
    // grid rebuilds automatically when a static blocker moves or a nav volume is
    // edited (both fold into the revision token), so there is no manual build.
    const navFootY = bucketNavFootY(start[1]);
    const grid = this.navGridCache.getOrBuild(this.aiNavRevisionToken(blockers, surfaces, bounds), {
      agent,
      blockers,
      bounds,
      footY: navFootY,
      cellSize: AI_NAV_CELL_SIZE,
      sampleFloorYs: this.aiNavFloorSampler(blockers, surfaces, bounds, agent, navFootY),
    });
    if (!grid) return { status: "failure" as const, points: [], visited: 0 };
    return searchNavGrid(grid, start, goal);
  }

  private reportAiIdleLocomotion(entityId: string): void {
    const previous = this.locomotionReports.get(entityId);
    this.locomotionReports.set(entityId, {
      planarSpeed: 0,
      grounded: previous?.grounded ?? true,
      velocityY: 0,
    });
  }

  /**
   * Revision token for the baked nav grid cache: bumps a counter whenever the
   * physics static-blocker array is rebuilt (identity changes on spawn/destroy/
   * move/collision-toggle) and folds in an authored-bounds signature, so any
   * change to obstacles or nav volumes invalidates every cached grid.
   */
  private aiNavRevisionToken(
    blockers: readonly NavAabb[],
    surfaces: ReturnType<PhysicsSubsystem["staticSurfaceTriangles"]>,
    bounds: readonly NavAabb[],
  ): string {
    if (blockers !== this.navBlockerRevisionRef) {
      this.navBlockerRevisionRef = blockers;
      this.navBlockerRevision += 1;
    }
    if (surfaces !== this.navSurfaceRevisionRef) {
      this.navSurfaceRevisionRef = surfaces;
      this.navBlockerRevision += 1;
    }
    return `${this.navBlockerRevision}|${navBoundsSignature(bounds)}`;
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

  private aiNavAgentForEntity(entityId: string): NavAgent {
    const entity = this.actorEntityById.get(entityId);
    const movement = entity ? readCharacterMovementComponent(entity) : undefined;
    const navAgent = entity ? readAIControllerComponent(entity)?.navAgent : undefined;
    const characterCapsule = entity && movement ? resolveCharacterCapsule(entity) : undefined;
    return resolveNavAgentProfile({
      ...(navAgent ? { navAgent } : {}),
      ...(movement ? { movement } : {}),
      colliderHalfExtents:
        characterCapsule?.halfExtents ?? this.physicsSubsystem.colliderHalfExtents(entityId),
    });
  }

  private aiNavFloorSampler(
    blockers: readonly NavAabb[],
    surfaces: ReturnType<PhysicsSubsystem["staticSurfaceTriangles"]>,
    bounds: readonly NavAabb[],
    agent: NavAgent,
    preferredFloorY: number,
  ): (x: number, z: number) => readonly number[] | null {
    const footprintHalf: [number, number] = [Math.max(0, agent.radius), Math.max(0, agent.radius)];
    const maxSlopeCos = slopeCosFromDegrees(agent.maxSlopeAngleDeg ?? 50);
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
        requiredSupportRadius: Math.min(Math.max(0, agent.radius), AI_NAV_MIN_TOP_SUPPORT_RADIUS),
        // Recast walkableHeight: reject floor cells with less than the agent's
        // height of clearance above them, so no nav floor is baked under a
        // ramp/stair (nor on a wedge's downward-facing underside).
        requiredHeadroom: Math.max(0, agent.height),
        respectNavigationRole: true,
      });
      // Collapse near-coincident walkable surfaces into a single navigable floor,
      // keeping the highest of each cluster. A solid floor mesh (`complexAsSimple`)
      // reports both its top face and its slab underside/thickness as walkable
      // layers a few centimetres apart; CharacterMovement grounds the pawn on the
      // highest one, but the multi-layer nav grid would otherwise keep the lower
      // phantom layer and route the path through it — leaving interior waypoints
      // below the walking pawn. The follower's tight vertical acceptance can't
      // clear that gap, so the agent stalls a few steps in. Surfaces within the
      // agent's step height are one floor it can freely traverse, so this matches
      // movement while leaving genuinely distinct floors (upper platforms) intact.
      const layers = collapseCoincidentFloors(
        hits.map((hit) => hit.floorY),
        Math.max(agent.stepHeight ?? 0, 1e-3),
      );
      return layers.length > 0 ? layers : null;
    };
  }

  private aiEffectiveClearanceRadius(agent: NavAgent): number {
    return Math.max(0, agent.radius) + Math.max(0, agent.clearancePadding ?? 0) + AI_NAV_GRID_SAFETY_MARGIN;
  }

  private aiMoveIntentForEntity(
    entityId: string,
    transform: Readonly<TransformComponent>,
    deltaSeconds: number,
  ): CharacterMoveIntent | null {
    const follow = this.aiPathFollowing.get(entityId);
    if (!follow || follow.state.status !== "following") return null;
    let state = follow.state;
    const advance = advanceWaypoint(state.path, state.waypointIndex, transform.position, {
      final: follow.acceptanceRadius ?? AI_MOVE_ACCEPTANCE_RADIUS,
      intermediate: AI_INTERMEDIATE_WAYPOINT_ACCEPTANCE,
    });
    if (advance.arrived) {
      this.aiPathFollowing.delete(entityId);
      return { direction: [0, 0], speed: 0 };
    }
    if (advance.waypointIndex !== state.waypointIndex) {
      state = { ...state, waypointIndex: advance.waypointIndex };
      follow.state = state;
    }
    let target = state.path[state.waypointIndex];
    if (!target) {
      this.aiPathFollowing.delete(entityId);
      return null;
    }
    // Stuck recovery: no planar progress for a while means something the grid
    // doesn't know about (usually another agent) is blocking the lane. Replan
    // from the current position, and fail the move once replanning stops helping.
    follow.stuck = updateStuckState(follow.stuck, transform.position, deltaSeconds);
    if (isStuck(follow.stuck)) {
      follow.stuck = freshStuckState(transform.position);
      follow.replans += 1;
      const path =
        follow.replans > AI_MAX_STUCK_REPLANS
          ? null
          : this.buildAiPath(entityId, transform.position, follow.goal);
      if (!path || path.status === "failure" || path.points.length < 2) {
        follow.state = { path: [], waypointIndex: 0, status: "failure" };
        return null;
      }
      follow.state = { path: path.points, waypointIndex: 1, status: "following" };
      target = follow.state.path[1]!;
    }
    const dx = target[0] - transform.position[0];
    const dz = target[2] - transform.position[2];
    const length = Math.hypot(dx, dz);
    // Local avoidance: blend a separation push away from nearby characters into
    // the path direction so agents shoulder past each other instead of stacking.
    const separation = separationSteering(
      transform.position,
      this.aiNavAgentForEntity(entityId).radius,
      this.aiSeparationNeighbors(entityId),
    );
    const pathDirection: [number, number] = length > 0 ? [dx / length, dz / length] : [0, 0];
    const steered = blendAiPathDirection(pathDirection, follow.preferredDirection);
    const separationWeight = follow.preferredDirection
      ? AI_SPLINE_SEPARATION_WEIGHT
      : AI_SEPARATION_WEIGHT;
    const direction: [number, number] = [
      steered[0] + separation[0] * separationWeight,
      steered[1] + separation[1] * separationWeight,
    ];
    return {
      direction,
      ...(follow.speed !== undefined ? { speed: follow.speed } : {}),
    };
  }

  /** Every other live character (player + NPCs) as a separation neighbor. */
  private aiSeparationNeighbors(entityId: string): AvoidanceNeighbor[] {
    const neighbors: AvoidanceNeighbor[] = [];
    this.characterMovementSubsystem.forEachCharacter((otherId, other) => {
      if (otherId === entityId) return;
      neighbors.push({
        position: other.position,
        radius: this.aiNavAgentForEntity(otherId).radius,
      });
    });
    return neighbors;
  }

  private isAiPerceptionSource(entity: Entity): boolean {
    if (readCharacterMovementComponent(entity)) return true;
    if (readAIControllerComponent(entity)) return true;
    return readBehaviorComponent(entity)?.scriptId === "input-move";
  }

  private characterBlockerAabbs(excludeEntityId: string): Aabb3[] {
    const blockers: Aabb3[] = [];
    this.characterMovementSubsystem.forEachCharacter((entityId, transform) => {
      if (entityId === excludeEntityId) return;
      const half = this.physicsSubsystem.colliderHalfExtents(entityId);
      if (!half) return;
      blockers.push({
        min: [
          transform.position[0] - half[0],
          transform.position[1],
          transform.position[2] - half[2],
        ],
        max: [
          transform.position[0] + half[0],
          transform.position[1] + half[1] * 2,
          transform.position[2] + half[2],
        ],
      });
    });
    return blockers;
  }

  /**
   * Snapshots the active Game Mode + possessed pawn's movement state for the
   * `?debug` overlay. The possessed pawn's grounded/velocity come from the latest
   * locomotion report (written by the CharacterMovement subsystem or the
   * input-move behavior); the movement mode is the pawn's authored
   * CharacterMovement mode when it is an Actor Script character.
   */
  getGameModeDebugSnapshot(): GameModeDebugSnapshot {
    return buildGameModeDebugSnapshot({
      activeGameModeName: this.activeGameMode?.displayName ?? null,
      possessed: this.gameModeSession?.playerState.pawnEntityId ?? null,
      inputMode: this.inputMode,
      cameraDebug: this.gameModeSession?.getCameraDebug?.(),
      locomotionReportOf: (entityId) => this.locomotionReports.get(entityId),
      movementModeOf: (entityId) => this.possessedMovementMode(entityId),
      positionOf: (entityId) => {
        const transform = this.characterMovementSubsystem.transformOf(entityId);
        return transform
          ? [transform.position[0], transform.position[1], transform.position[2]]
          : null;
      },
    });
  }

  /**
   * Snapshots the runtime UI host for the `?debug` overlay: the mounted HUD, the
   * active screen stack and the ViewModel store fields the widgets bind to.
   * Returns empty layers before the UI subsystem boots.
   */
  getUiDebugSnapshot(): UiDebugSnapshot {
    return buildUiDebugSnapshot({
      host: this.uiSubsystem?.getDebugSnapshot() ?? null,
      fields: this.uiStore.snapshot(),
      locale: this.localeRegistry?.activeLocale ?? null,
      world: this.worldUiSubsystem?.getDebugSnapshot() ?? { count: 0, visible: 0 },
    });
  }

  /** Authored CharacterMovement mode of a possessed Actor Script pawn, else null. */
  private possessedMovementMode(entityId: string | null): string | null {
    if (entityId === null) return null;
    const entity = this.actorEntityById.get(entityId);
    if (!entity) return null;
    return readCharacterMovementComponent(entity)?.movementMode ?? null;
  }

  private createInteractionPromptElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.textContent = "Press E Key";
    element.hidden = true;
    element.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:16%",
      "transform:translateX(-50%)",
      "z-index:20",
      "padding:8px 12px",
      "border-radius:6px",
      "background:rgba(12,16,22,0.82)",
      "color:#ffffff",
      "font:600 15px system-ui,sans-serif",
      "letter-spacing:0",
      "pointer-events:none",
      "box-shadow:0 6px 18px rgba(0,0,0,0.24)",
    ].join(";");
    document.body.append(element);
    return element;
  }

  private setInteractionPrompt(
    entityId: string,
    _action: string,
    prompt: string | undefined,
    overlapping: boolean,
  ): void {
    if (overlapping) {
      this.activeInteractionPromptEntityId = entityId;
      this.interactionPromptElement.textContent = prompt?.trim() || "Press E Key";
      this.interactionPromptElement.hidden = false;
      return;
    }
    if (this.activeInteractionPromptEntityId !== entityId) return;
    this.activeInteractionPromptEntityId = null;
    this.interactionPromptElement.hidden = true;
  }

  private async loadActiveProjectScene(): Promise<void> {
    this.beginLoadingUi("Loading project");
    try {
      this.activeProject = await loadActiveProject();
      this.assetLoader = new AssetLoader(this.activeProject.manifest, this.renderer, {
        onLoaded: (id) => this.loadProgress.markLoaded(id),
        onFailed: (id, error) => this.loadProgress.markFailed(id, describeLoadError(error)),
      });
      this.saveCoordinator.setStore(createRuntimeSaveGameStore(this.activeProject.manifest.name));
      await this.buildScene(this.activeProject.manifest.editor.defaultScene, undefined);
      this.finishLoadingUi();
    } catch (error) {
      // A critical boot failure (project/manifest/layout unreachable) leaves a
      // black canvas; surface an error screen with a Retry (a fresh page load is
      // the safe recovery from a half-built boot).
      console.error("[runtime] boot failed:", error);
      this.loadingOverlay?.showError(
        "Failed to load the game. Check your connection and try again.",
        () => {
          if (typeof location !== "undefined") location.reload();
        },
      );
    }
  }

  /** Resets the loading overlay to an empty bar and shows it (boot/travel start). */
  private beginLoadingUi(status: string): void {
    this.loadStartMs = typeof performance !== "undefined" ? performance.now() : 0;
    this.loadingOverlay?.clearError();
    this.loadingOverlay?.setProgress(0, "");
    this.setLoadingStatus(status);
    this.loadingOverlay?.show();
  }

  /** Hides the loading overlay after one painted frame (so the built scene shows first). */
  private finishLoadingUi(): void {
    const hide = (): void => {
      this.loadingOverlay?.hide();
      if (this.debug && typeof performance !== "undefined") {
        const ms = (performance.now() - this.loadStartMs).toFixed(0);
        const snap = this.loadProgress.snapshot();
        console.info(
          `[loading] ready in ${ms}ms — ${snap.loaded} model(s) loaded, ${snap.failed} failed`,
        );
      }
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(hide));
    } else {
      hide();
    }
  }

  /**
   * The set of model ids this level will load, across all three phases (load
   * groups, layout-referenced meshes, actor meshes), filtered to ids the manifest
   * still knows as loadable meshes. Declared up front so the loading bar's total
   * is accurate and never jumps as later phases discover more work.
   */
  private async collectExpectedModelIds(): Promise<string[]> {
    if (!this.assetLoader || !this.layout) return [];
    const manifest = await this.assetLoader.loadManifest();
    const loadable = new Set(
      manifest.assets.filter((asset) => isModelAssetType(assetType(asset))).map((asset) => asset.id),
    );
    const ids = new Set<string>();
    for (const group of this.layout.loadGroups) {
      for (const record of await this.assetLoader.recordsForGroup(group)) ids.add(record.id);
    }
    for (const id of sceneModelAssetIds(this.layout)) if (loadable.has(id)) ids.add(id);
    for (const entity of this.actorEntities) {
      const renderer = readRenderableMeshComponent(entity);
      if (renderer && loadable.has(renderer.assetId)) ids.add(renderer.assetId);
    }
    return [...ids];
  }

  /**
   * Builds a level's scene graph, physics/behavior world, Game Mode and UI from
   * a layout path. Shared by the initial boot and Level Travel (P2); travel reuses
   * the already-live engine — `startSceneRuntime` re-feeds the subsystems via
   * `setEntities` and re-inits physics (which loads Rapier if this level newly
   * needs it), and no subsystem implements `start()`, so re-running it is safe.
   * `spawnTag` selects a tagged Player Start for the arriving player (travel); the
   * initial boot passes none.
   *
   * Assumes a clean slate — the caller runs {@link teardownScene} before a travel
   * rebuild so no previous scene's objects, entities or subscriptions leak in.
   */
  private async buildScene(layoutPath: string, spawnTag: string | undefined): Promise<void> {
    if (!this.assetLoader || !this.activeProject) return;
    this.behaviorSubsystem.setRegistry(this.createSceneBehaviorRegistry());
    this.layout = await loadRoomLayout(layoutPath);
    this.meshPaintData = await loadMeshPaintData(layoutPath);
    this.activeLevelPath = layoutPath;
    const worldSettings = resolveSceneWorldSettings(this.layout);
    this.gravityY = worldSettings.gravity[1];
    this.killZ = worldSettings.killZ;
    this.physicsSubsystem.setGravity(worldSettings.gravity);
    this.ensureDefaultLights();
    // Resolve placed Actor Script classes -> entities before models load, so their
    // mesh assets join the load list (loadActorMeshModels reads these entities).
    await this.resolveActorClasses();
    await this.applyPlayerStartSpawn(spawnTag);
    // Declare every model this level will load up front (P4) so the loading bar's
    // total is right before the first GLB streams in; the loader marks each done.
    await this.levelRuntime.build();
    // Shape actors persist as `shape:<type>` instances whose synthetic models are
    // not in any loadGroup; register them before the scene is built, or the
    // instanced-model builder throws and aborts scene construction (the editor
    // does the same via registerShapeModelsFromLayout).
    // Resolve material overrides + default slots into the cache before instances
    // build, so createInstancedModel can render the assigned materials (mirrors
    // the editor's material-override path; otherwise Play shows the base mesh).

    /*
        // Marker gizmos (Player Start, Ambient Sound) are editor-only authoring
        // helpers: the runtime never renders the gizmo mesh. It still reads their
        // transform — Player Start as the TPS spawn, Ambient Sound as the emitter
        // point for its (separately-built) audio entity.
    */


    const bytes = await this.assetLoader.totalBytesForGroups(this.layout.loadGroups);
    const materialStats = collectMaterialStats(this.models);
    console.info(
      "[runtime] scene loaded",
      JSON.stringify({
        project: this.activeProject.manifest.name,
        layout: this.layout.name,
        processedAssetBytes: bytes,
        materialStats,
        convertedUnlitMaterials: this.convertedUnlitMaterials,
      }),
    );

    await this.loadCollisionDefs();
    await this.populateAssetUrls();
    await this.loadAiAssets();
    this.aiSubsystem.setTargetPoints(targetPointEntriesFromLayout(this.layout.targetPoints));
    const baseDocument = roomLayoutToSceneDocument(this.layout, {
      colliderBox: (assetId, source) => this.colliderBoxFor(assetId, source),
      collisionDefs: this.collisionDefs,
      complexCollisionMeshes: this.complexCollisionMeshes,
    });
    // Append flattened actor-instance entities so physics + behavior derive them
    // alongside the legacy instances/characters/lights.
    const sceneDocument: SceneDocument = {
      ...baseDocument,
      entities: [
        ...baseDocument.entities,
        ...this.actorEntities,
        ...this.landscapeColliderEntities,
        ...this.splineColliderEntities,
      ],
    };
    await startSceneRuntime({
      sceneDocument,
      physics: this.physicsSubsystem,
      movingPlatform: this.movingPlatformSubsystem,
      splinePathFollower: this.splinePathFollowerSubsystem,
      characterMovement: this.characterMovementSubsystem,
      ai: this.aiSubsystem,
      behavior: this.behaviorSubsystem,
      engineApp: this.engineApp,
    });
    this.bindAiScriptStimulusBridge();
    this.bindAiAttackAnimationBridge();
    // Auto-play audio/particles must never abort scene start: a single bad cue or
    // emitter cannot be allowed to stop the game mode + UI (lines below) from
    // initialising, which would look like "Play won't start".
    try {
      this.playAutoPlayAudio(sceneDocument);
    } catch (error) {
      console.error("[runtime] auto-play audio failed:", error);
    }
    void this.playAutoPlayParticles(sceneDocument);

    // Character skeletal metadata (blend spaces / anim-set) drives the Game Mode's
    // locomotion animator, so attach it to the refs before the session possesses.
    this.setLoadingStatus("Starting");
    await this.loadCharacterSkeletons();
    await this.startGameMode();
    this.saveCoordinator.applyPendingRestore(layoutPath);
    await this.setupRuntimeUi();
    // Apply the persisted graphics profile now that the scene's lights + composer
    // exist (shadows, render scale, particle density; post-process already resolved
    // at the seeded profile during build). Runs on every scene build so Level
    // Travel keeps the player's chosen quality.
    this.applyQualitySettings(this.qualitySettings);
    // LOD templates are fork-authored alternatives; apply the current optional
    // quality bias after this level's scene graph has been fully assembled.
    applyLodBias(this.scene, this.qualityExtensions.lodBias);
    this.refreshGraphicsUiFields();
    await this.setupDialogue();
    // Layer 2 modules see the finished level (scene content + engine world) and
    // may add their own scene objects, so they run before the shader warm-up
    // compiles what is visible. The registry isolates module failures itself.
    await this.capabilities.levelLoaded(
      createRuntimeContext({
        mode: this.levelRuntime.mode,
        levelPath: layoutPath,
        scene: this.scene,
        camera: this.camera,
        engineApp: this.engineApp,
        assetLoader: this.assetLoader,
        layout: this.layout,
        sceneDocument,
      }),
    );
    await this.warmRuntimeShaders();
  }

  /**
   * Compiles the visible scene's material programs while the loading overlay is
   * still present, moving first-use shader work out of active gameplay.  The
   * renderer's compile pass is a best-effort preload: browser/driver failures
   * must not turn an otherwise valid level boot into a black screen.
   */
  private async warmRuntimeShaders(): Promise<void> {
    this.setLoadingStatus("Warming shaders");
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch (error) {
      console.warn("[runtime] shader warm-up failed; continuing without preload:", describeLoadError(error));
    }
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
          console.warn("[ai] failed to load AI asset", path, describeLoadError(error));
        }
      }),
    );
    this.aiSubsystem.setAssetLibrary({ blackboards, behaviors, stateTrees });
  }

  requestSaveGameLoad(payload: unknown): boolean {
    return this.saveCoordinator.requestSaveGameLoad(payload);
  }

  setUserAudioBusVolume(bus: AudioBusId, volume: number): boolean {
    this.audioSubsystem.setBusVolume(bus, volume);
    const ok = this.userSettingsStore?.setAudioBusVolume(bus, volume) ?? false;
    this.userSettings = this.userSettingsStore?.read() ?? {
      ...this.userSettings,
      audio: {
        busVolumes: {
          ...this.userSettings.audio.busVolumes,
          [bus]: this.audioSubsystem.getBusVolume(bus),
        },
      },
    };
    return ok;
  }

  setUserLocale(locale: string): boolean {
    if (!this.localeRegistry || !this.localeRegistry.availableLocales().includes(locale)) return false;
    this.localeRegistry.setActiveLocale(locale);
    const ok = this.userSettingsStore?.setLocale(locale) ?? false;
    this.userSettings = this.userSettingsStore?.read() ?? { ...this.userSettings, locale };
    return ok;
  }

  /**
   * Selects a graphics quality profile (Ultra/High/Medium/Low/Custom): persists the
   * preference, re-resolves + applies the profile to the live renderer, and refreshes
   * the settings-screen fields with a status line (plan §5.3 — no aggressive popup).
   */
  setGraphicsQualityLevel(level: QualityLevel): boolean {
    // A manual pick ends any pending startup calibration and marks the choice as
    // deliberate, so auto-calibration never overrides it again (Faz 4, §17.3).
    this.startupCalibrationElapsed = null;
    return this.applyAndPersistGraphics(
      { ...this.userSettings.graphics, selectedQualityLevel: level, manuallySelected: true },
      `Quality set to ${qualityLevelLabel(level)}.`,
      true,
    );
  }

  /**
   * Toggles adaptive optimization. This only records the player's intent — the
   * adaptive controller (Faz 6) reads it — so the live quality profile is not
   * re-applied (nothing about the resolved settings changes).
   */
  setGraphicsAdaptive(enabled: boolean): boolean {
    return this.applyAndPersistGraphics(
      { ...this.userSettings.graphics, adaptiveOptimizationEnabled: enabled },
      enabled ? "Adaptive optimization on." : "Adaptive optimization off. Manual profile active.",
      false,
    );
  }

  /** Sets the adaptive frame-time target (30 or 60 FPS); intent-only, like adaptive. */
  setGraphicsTargetFrameRate(fps: 30 | 60): boolean {
    return this.applyAndPersistGraphics(
      { ...this.userSettings.graphics, targetFrameRate: fps },
      `Target frame rate ${fps} FPS.`,
      false,
    );
  }

  /** Restores the template default graphics preferences and re-applies them. The
   * defaults clear the manual + calibrated flags, so startup auto-calibration
   * re-arms (a reset is an explicit "start fresh"). */
  resetGraphicsPreferences(): boolean {
    const ok = this.applyAndPersistGraphics(
      defaultGraphicsPreferences(),
      "Graphics settings restored to defaults.",
      true,
    );
    this.runStartupHintCalibration();
    return ok;
  }

  /** Current player graphics preferences (chosen profile, adaptive, FPS target). */
  getGraphicsPreferences(): GraphicsPreferences {
    return this.userSettings.graphics;
  }

  /**
   * Persists new graphics preferences, optionally re-applies the resolved quality
   * profile to the live renderer (only when the profile itself changed), and
   * refreshes the settings-screen ViewModel fields + status message.
   */
  private applyAndPersistGraphics(
    graphics: GraphicsPreferences,
    status: string,
    reapplyQuality: boolean,
  ): boolean {
    this.userSettings = { ...this.userSettings, graphics };
    const ok = this.userSettingsStore?.setGraphics(graphics) ?? false;
    if (reapplyQuality) {
      this.applyQualityProfile(
        resolveQualitySettings(graphics.selectedQualityLevel, graphics.customSettings),
      );
    }
    this.refreshGraphicsUiFields(status);
    return ok;
  }

  /**
   * Startup calibration boot step (Faz 4): when the player has neither picked a
   * profile manually nor been calibrated before, applies a hardware-hinted
   * starting profile and arms the one-time first-gameplay measurement pass. Both
   * a manual choice and a prior calibration suppress it — the player's deliberate
   * choice always wins, and a remembered measurement is never redone.
   */
  private runStartupHintCalibration(): void {
    const g = this.userSettings.graphics;
    if (g.manuallySelected || g.startupCalibrated) {
      this.startupCalibrationElapsed = null;
      return;
    }
    const hint = suggestStartingQualityLevel(this.collectHardwareHints());
    // Apply the hinted start only if it differs; keep it non-manual so the
    // measurement pass can still refine it up or down.
    if (hint.level !== g.selectedQualityLevel) {
      // Concrete hinted level, so any stale `customSettings` is dropped (omitted).
      const graphics: GraphicsPreferences = {
        adaptiveOptimizationEnabled: g.adaptiveOptimizationEnabled,
        targetFrameRate: g.targetFrameRate,
        selectedQualityLevel: hint.level,
        allowAdaptiveFineTuning: g.allowAdaptiveFineTuning,
        manuallySelected: g.manuallySelected,
        startupCalibrated: g.startupCalibrated,
      };
      this.userSettings = { ...this.userSettings, graphics };
      this.userSettingsStore?.setGraphics(graphics);
      this.qualitySettings = resolveQualitySettings(hint.level);
      // Keep the adaptive ceiling in sync when the hint moves the profile (the
      // controller is absent on the constructor's first call — seeded right after).
      this.adaptiveController?.setBase(this.qualitySettings);
    }
    // Arm the measurement pass; the update loop counts active-gameplay seconds.
    this.startupCalibrationElapsed = 0;
  }

  /**
   * Counts active-gameplay seconds toward the one-time measurement calibration and
   * fires it once the warm-up window has passed. Only accumulates while actually
   * playing (menus under-load the frame and would skew the measurement); a manual
   * pick or a completed calibration cancels the pending pass.
   */
  private tickStartupCalibration(deltaSeconds: number): void {
    if (this.startupCalibrationElapsed === null) return;
    const g = this.userSettings.graphics;
    if (g.manuallySelected || g.startupCalibrated) {
      this.startupCalibrationElapsed = null;
      return;
    }
    if (this.inputMode !== "game") return;
    this.startupCalibrationElapsed += deltaSeconds;
    if (this.startupCalibrationElapsed < STARTUP_CALIBRATION_SECONDS) return;
    this.startupCalibrationElapsed = null;
    this.applyMeasuredCalibration();
  }

  /**
   * Runs the measurement step: reads the settled frame-time window (warm-up
   * already aged out) and nudges the profile at most one step. The result is
   * always persisted with `startupCalibrated`, so calibration never repeats; the
   * renderer is only re-applied (and a status shown) when the profile changed.
   */
  private applyMeasuredCalibration(): void {
    const g = this.userSettings.graphics;
    const current: ConcreteQualityLevel = isConcreteQualityLevel(g.selectedQualityLevel)
      ? g.selectedQualityLevel
      : "medium";
    const result = calibrateFromMeasurement({
      currentLevel: current,
      metrics: this.frameMetrics.metrics(),
      targetFrameRate: g.targetFrameRate,
    });
    // Concrete measured level, so any stale `customSettings` is dropped (omitted).
    const graphics: GraphicsPreferences = {
      adaptiveOptimizationEnabled: g.adaptiveOptimizationEnabled,
      targetFrameRate: g.targetFrameRate,
      selectedQualityLevel: result.level,
      allowAdaptiveFineTuning: g.allowAdaptiveFineTuning,
      manuallySelected: g.manuallySelected,
      startupCalibrated: true,
    };
    this.userSettings = { ...this.userSettings, graphics };
    this.userSettingsStore?.setGraphics(graphics);
    if (result.changed) {
      this.applyQualityProfile(resolveQualitySettings(result.level));
      this.refreshGraphicsUiFields(
        `Auto quality ${result.direction === "up" ? "raised" : "lowered"} to ${qualityLevelLabel(result.level)}.`,
      );
    }
  }

  /**
   * Ticks the adaptive quality controller (Faz 6): feeds it the settled frame-time
   * window and lets it step quality down under sustained load or back up once
   * stable, applying at most one ladder rung per decision. Held back until the
   * one-time startup measurement is done (so the two don't fight over the profile)
   * and gated on the player's toggle + fine-tune permission, and on active
   * gameplay (light menu frames must not skew the raise timer, plan §17.3). A
   * change drives the reduced/raised settings into the renderer and surfaces a
   * subtle status line (plan §5.3) — the persisted profile is never touched.
   */
  private tickAdaptiveQuality(deltaSeconds: number): void {
    if (this.startupCalibrationElapsed !== null) return;
    // Batch to a seconds-scale cadence: the controller reads trends, and this
    // keeps the frame-time percentile sort off the per-frame hot path.
    this.adaptiveTickAccumulator += deltaSeconds;
    if (this.adaptiveTickAccumulator < ADAPTIVE_TICK_INTERVAL_SECONDS) return;
    const dt = this.adaptiveTickAccumulator;
    this.adaptiveTickAccumulator = 0;
    const g = this.userSettings.graphics;
    const active =
      g.adaptiveOptimizationEnabled &&
      (!g.manuallySelected || g.allowAdaptiveFineTuning) &&
      this.inputMode === "game";
    const update = this.adaptiveController.update({
      metrics: this.frameMetrics.metrics(),
      preferences: g,
      deltaSeconds: dt,
      active,
      classify: () => this.classifyLiveBottleneck(),
    });
    if (update.kind === "none" || !update.settings) return;
    this.applyQualitySettings(update.settings);
    if (update.change) this.refreshGraphicsUiFields(update.change.message);
  }

  /** Live bottleneck verdict for the adaptive controller, with a safe `unknown`
   * fallback before the frame-time window has samples (plan §8, §9.3). */
  private classifyLiveBottleneck(): BottleneckResult {
    return this.getBottleneckSnapshot() ?? { type: "unknown", confidence: 0.2, evidence: ["no signal"] };
  }

  /**
   * Reverts the most recent automatic adaptive change (plan §17.3 one-click undo):
   * restores the last-reduced rung and drives the raised settings, returning true
   * when something was undone. Exposed for a settings-screen "undo" affordance.
   */
  revertLastAdaptiveChange(): boolean {
    const update = this.adaptiveController?.revertLastChange();
    if (!update || !update.settings) return false;
    this.applyQualitySettings(update.settings);
    if (update.change) this.refreshGraphicsUiFields(update.change.message);
    return true;
  }

  /** Adaptive quality state for the `?debug` overlay `quality:` + `last:` lines
   * (§13): the player's profile, whether adaptive is on, how many transient rungs
   * are currently layered, and the most recent automatic change (+ its age). */
  getAdaptiveDebugSnapshot(): AdaptiveDebugSnapshot {
    const g = this.userSettings.graphics;
    return {
      qualityLevel: g.selectedQualityLevel,
      adaptiveEnabled: g.adaptiveOptimizationEnabled,
      reductionDepth: this.adaptiveController?.reductionDepth ?? 0,
      lastChange: this.adaptiveController?.getLastChange() ?? null,
    };
  }

  /**
   * Collects coarse browser hints for {@link suggestStartingQualityLevel} (thin
   * adapter — the reasoning is the pure engine core). Every field degrades to
   * `null` when the global or WebGL extension is unavailable (privacy / headless),
   * which the pure core treats as "no signal".
   */
  private collectHardwareHints(): HardwareHintInputs {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const scr = typeof screen !== "undefined" ? screen : undefined;
    const win = typeof window !== "undefined" ? window : undefined;
    const deviceMemory = (nav as { deviceMemory?: number } | undefined)?.deviceMemory;
    const touch =
      (nav?.maxTouchPoints ?? 0) > 0 ||
      (win !== undefined && "ontouchstart" in win) ||
      (win?.matchMedia?.("(pointer: coarse)").matches ?? false);
    return {
      hardwareConcurrency: nav?.hardwareConcurrency ?? null,
      deviceMemoryGb: typeof deviceMemory === "number" ? deviceMemory : null,
      screenWidth: scr?.width ?? null,
      screenHeight: scr?.height ?? null,
      devicePixelRatio: win?.devicePixelRatio ?? null,
      isTouch: touch,
      webglRenderer: this.readWebglRenderer(),
    };
  }

  /** Reads the unmasked GPU string via WEBGL_debug_renderer_info, or null when the
   * extension is withheld (Firefox privacy, some Safari builds). */
  private readWebglRenderer(): string | null {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (!ext) return null;
      const value = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as unknown;
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * Mirrors the current graphics preferences into the UI ViewModel so the graphics
   * settings screen shows the active profile / adaptive state / FPS target, plus an
   * optional one-line status message.
   */
  private refreshGraphicsUiFields(status?: string): void {
    const g = this.userSettings.graphics;
    this.uiStore.setField("graphics.quality", g.selectedQualityLevel);
    this.uiStore.setField("graphics.qualityLabel", `Quality: ${qualityLevelLabel(g.selectedQualityLevel)}`);
    this.uiStore.setField("graphics.adaptive", g.adaptiveOptimizationEnabled);
    this.uiStore.setField("graphics.adaptiveLabel", `Adaptive: ${g.adaptiveOptimizationEnabled ? "On" : "Off"}`);
    this.uiStore.setField("graphics.targetFps", g.targetFrameRate);
    this.uiStore.setField("graphics.targetFpsLabel", `Target: ${g.targetFrameRate} FPS`);
    if (status !== undefined) this.uiStore.setField("graphics.status", status);
  }

  /**
   * Disposes the current scene so a Level Travel rebuild starts from a clean
   * slate, keeping the renderer, camera, engine spine and input/resize listeners
   * (constructor-owned, reused across levels). Because the runtime shares loaded
   * GLTFs through the loader cache, mesh objects that clone or instance a cached
   * model (statics, characters, actors, override clones) are only removed from the
   * graph — their geometry/materials stay cached for the next level. Only
   * scene-owned GPU resources are disposed: InstancedMesh instance buffers,
   * synthetic `shape:` primitive geometry, probe/planar/reflective/blocking
   * objects, sky/cloud domes, reflection targets, light shadow maps, the
   * post-process pipeline and per-scene override materials. Subsystems are emptied
   * immediately so the engine loop ticks an empty world during the async load.
   */
  private teardownScene(): void {
    // Layer 2 first: modules drop their per-level state while the world they
    // observed is still intact, before Layer 1 content starts disappearing.
    this.capabilities.levelUnloaded();
    // Game Mode + UI hosts first: null them before emptying the world so the
    // frame(s) between teardown and rebuild skip their update paths.
    this.gameModeSession?.dispose();
    this.gameModeSession = null;
    this.activeGameMode = null;
    this.uiSubsystem?.dispose();
    this.uiSubsystem = null;
    this.worldUiSubsystem?.dispose();
    this.worldUiSubsystem = null;
    this.gameEventUnsub?.();
    this.gameEventUnsub = null;
    this.clearAiScriptStimulusBridge();
    this.clearAiAttackAnimationBridge();
    this.gameStateStore = null;
    this.gameOutcomeShown = false;
    this.pauseMenuDef = null;
    this.winScreenDef = null;
    this.loseScreenDef = null;
    this.uiDefs.clear();
    this.uiThemes.clear();
    this.localeRegistry = null;
    this.dialogueUnsub?.();
    this.dialogueUnsub = null;
    this.conversationUnsub?.();
    this.conversationUnsub = null;
    this.conversationDirector.stop();

    // Empty the subsystems so the engine loop ticks nothing until the rebuild
    // re-feeds them (a half-built scene must never be simulated/animated).
    this.animationSubsystem.clear();
    this.physicsSubsystem.setEntities([]);
    this.movingPlatformSubsystem.clear();
    this.splinePathFollowerSubsystem.clear();
    this.characterMovementSubsystem.clear();
    this.aiPathFollowing.clear();
    this.navGridCache.clear();
    this.navBlockerRevisionRef = null;
    this.aiCharacterAnimators.clear();
    this.aiSubsystem.setEntities([]);
    this.behaviorSubsystem.setEntities([]);
    this.splineRegistry = createSplineRegistry();

    // Particle effects: stop live instances (definition cache + pool stay warm
    // for the rebuild, which re-spawns the same project's effects).
    this.vfxSubsystem.clear();

    // Instanced statics: remove each group (their override clones are children,
    // so they leave with it) and dispose only the InstancedMesh instance buffers
    // — the underlying geometry/material is the shared cached GLTF's.
    for (const group of this.instanceGroups.values()) {
      disposeMeshPaintCloneGeometries(group);
      this.scene.remove(group);
    }
    for (const meshes of this.instanceMeshes.values()) {
      for (const mesh of meshes) mesh.dispose();
    }
    this.instanceGroups.clear();
    this.instanceMeshes.clear();
    this.instanceOverrideObjects.clear();
    this.collectedInstances.clear();
    this.disposeInstanceProbeMaterials();

    // Reflection captures / planar reflectors / reflective surfaces / blocking
    // volumes: dedicated disposers free their render targets + owned meshes.
    for (const bake of this.reflectionCaptureBakes) {
      if (bake) disposeSphereReflectionCaptureBake(bake);
    }
    this.reflectionCaptureBakes = [];
    for (const reflector of this.reflectionPlaneObjects) {
      this.scene.remove(reflector);
      disposeReflectionPlaneObject(reflector);
    }
    this.reflectionPlaneObjects = [];
    for (const surface of this.reflectiveSurfaceObjects) {
      this.scene.remove(surface);
      disposeReflectiveSurfaceObject(surface);
    }
    this.reflectiveSurfaceObjects = [];
    for (const volume of this.blockingVolumeObjects) {
      this.scene.remove(volume);
      disposeBlockingVolumeObject(volume);
    }
    this.blockingVolumeObjects = [];
    for (const spline of this.splineDebugObjects) {
      this.scene.remove(spline);
      disposeSplineObject(spline);
    }
    this.splineDebugObjects = [];
    for (const group of this.splineGeneratedGroups) disposeSplineGeneratedGroup(group);
    this.splineGeneratedGroups = [];
    this.splineColliderEntities = [];
    for (const object of this.landscapeObjects) {
      this.scene.remove(object);
      disposeLandscapeObject(object);
    }
    this.landscapeObjects = [];
    for (const texture of this.landscapeLayerTextures) texture.dispose();
    this.landscapeLayerTextures = [];
    this.landscapeColliderEntities = [];
    this.landscapeColliderObjects.clear();
    if (this.foliageBinding) {
      this.foliageBinding.dispose();
      this.foliageBinding = null;
    }

    // Characters + actor host objects: clones over cached GLTFs, so remove only.
    for (const object of this.characterObjects) this.scene.remove(object);
    this.characterObjects = [];
    this.characterRefs = [];
    for (const object of this.actorObjects.values()) this.scene.remove(object);
    this.actorObjects.clear();
    for (const wire of this.colliderDebugWires.values()) {
      this.scene.remove(wire);
      wire.geometry.dispose();
      (wire.material as LineBasicMaterial).dispose();
    }
    this.colliderDebugWires.clear();
    this.actorMeshScales.clear();
    this.actorEntityById.clear();
    this.actorEntities = [];
    this.spawnCoordinator.reset();

    // Lights: remove root (+ target) and free the shadow map.
    for (const record of this.lightObjects) {
      this.scene.remove(record.root);
      if (record.target) this.scene.remove(record.target);
      record.light.dispose();
    }
    this.lightObjects = [];
    this.sun = null;
    if (this.ambientLight) {
      this.scene.remove(this.ambientLight);
      this.ambientLight = null;
    }

    // Sky / cloud domes own their geometry + shader material.
    if (this.skyObject) {
      this.scene.remove(this.skyObject);
      disposeSceneMeshResources(this.skyObject);
      this.skyObject = null;
    }
    if (this.cloudObject) {
      this.scene.remove(this.cloudObject);
      disposeSceneMeshResources(this.cloudObject);
      this.cloudObject = null;
    }
    this.disposeReflectionTarget();
    this.scene.environment = null;
    this.postProcessPipeline?.dispose();
    this.postProcessPipeline = null;

    // Synthetic `shape:` primitive models are rebuilt per scene, so their geometry
    // is scene-owned (unlike loader-cached GLTFs) and must be disposed here.
    for (const [assetId, gltf] of this.models) {
      if (assetId.startsWith("shape:")) disposeSceneMeshResources(gltf.scene);
    }
    this.models = new Map();

    // Per-scene material/bounds caches (override materials are reloaded per level).
    for (const material of this.materialCache.values()) material.dispose();
    this.materialCache.clear();
    this.materialLoads.clear();
    this.assetMaterialSlots.clear();
    this.localBounds = new Map();
    this.collisionDefs = new Map();
    this.complexCollisionMeshes = new Map();

    this.locomotionReports.clear();
    this.pawnRespawnTransforms.clear();
    this.activeInteractionPromptEntityId = null;
    this.interactionPromptElement.hidden = true;
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

  private bindAiAttackAnimationBridge(): void {
    this.clearAiAttackAnimationBridge();
    this.aiAttackAnimationUnsubs = AI_ATTACK_ANIMATION_MESSAGE_TYPES.map((type) =>
      this.behaviorSubsystem.subscribeScriptMessage(type, (envelope) => {
        this.playAiAttackAnimation(envelope.source, envelope.payload);
      }),
    );
  }

  private clearAiAttackAnimationBridge(): void {
    for (const unsubscribe of this.aiAttackAnimationUnsubs) unsubscribe();
    this.aiAttackAnimationUnsubs = [];
  }

  private playAiAttackAnimation(entityId: string, payload: ScriptMessagePayload): void {
    const runtime = this.aiCharacterAnimators.get(entityId);
    if (!runtime || runtime.oneShot) return;
    const clip = this.resolveAiAttackAnimationClip(payload, runtime.animator.clips);
    if (!clip) return;
    runtime.animator.play(clip, 0.08);
    const duration = runtime.animator.getActiveClip()?.duration ?? 0.65;
    runtime.oneShot = {
      clip,
      remaining: Math.max(0.1, duration),
      blendOutSeconds: 0.14,
    };
  }

  private resolveAiAttackAnimationClip(
    payload: ScriptMessagePayload,
    clips: ReadonlySet<string>,
  ): string | null {
    const candidates: string[] = [];
    const animation = payload.animation;
    if (typeof animation === "string") candidates.push(animation);
    const attack = payload.attack;
    if (typeof attack === "string") {
      candidates.push(attack);
      candidates.push(`${attack.charAt(0).toUpperCase()}${attack.slice(1)}`);
    }
    candidates.push("Punch");
    for (const candidate of candidates) {
      if (clips.has(candidate)) return candidate;
      const caseInsensitive = [...clips].find((clip) => clip.toLowerCase() === candidate.toLowerCase());
      if (caseInsensitive) return caseInsensitive;
    }
    return null;
  }

  /**
   * Mounts the UMG Lite runtime UI host when the layout authors a HUD and/or a
   * pause-menu widget (`worldSettings.hudWidget` / `pauseMenuWidget`). No-op when
   * neither is set, so a scene with no UI pays nothing. Widget `message` actions
   * are emitted as `ui-action` script messages (UI → gameplay); the screen stack
   * routes input through {@link handleUiScreenStackChange}.
   */
  private async setupRuntimeUi(): Promise<void> {
    if (!this.layout) return;
    const host = document.getElementById("ui-overlay");
    if (!host) return;
    const hudId = this.layout.worldSettings?.hudWidget;
    const pauseId = this.layout.worldSettings?.pauseMenuWidget;
    const winId = this.layout.worldSettings?.winScreenWidget;
    const loseId = this.layout.worldSettings?.loseScreenWidget;
    const gameRules = normalizeGameRules(this.layout.worldSettings?.gameRules);
    const worldWidgets = normalizeWorldWidgets(this.layout.worldWidgets);
    const wantsScreenHost = Boolean(hudId || pauseId || winId || loseId);
    if (!wantsScreenHost && worldWidgets.length === 0 && !gameRules) return;

    // Load ALL .ui.json assets so Include refs in any widget can be resolved.
    const allDefs = await this.loadAllUiWidgetDefs();
    for (const [id, def] of allDefs) this.uiDefs.set(id, def);
    await this.loadUiThemeDefs(this.uiDefs.values());
    this.localeRegistry = await this.loadUiLocaleRegistry();

    // Seed bound fields so the initial render shows values (not blanks/zeroes).
    this.uiStore.setField("player.speed", 0);
    this.uiStore.setField("player.speedLabel", "Speed 0.0 m/s");
    this.saveCoordinator.refreshUiFields();

    if (wantsScreenHost) {
      this.uiSubsystem = new RuntimeUiSubsystem(host, {
        store: this.uiStore,
        ...(this.localeRegistry ? { locale: this.localeRegistry } : {}),
        resolveTheme: (ref) => this.uiThemes.get(ref) ?? null,
        resolveWidget: (src) => this.uiDefs.get(src) ?? null,
        onMessageAction: (action) => {
          // Reserved `game:*` / `travel:` widget messages drive the rules layer or
          // Level Travel in-shell; all other messages forward to gameplay as a
          // `ui-action` script message.
          if (this.handleGameUiMessage(action.message)) return;
          if (this.handleTravelUiMessage(action.message)) return;
          if (this.saveCoordinator.handleUiMessage(action.message)) return;
          if (this.handleSettingsUiMessage(action.message)) return;
          this.behaviorSubsystem.emitScriptMessage("ui-action", "ui", { message: action.message });
        },
        onScreenStackChange: (depth) => this.handleUiScreenStackChange(depth),
      });
      if (hudId) {
        const hud = this.uiDefs.get(hudId);
        if (hud) this.uiSubsystem.setHud(hud);
      }
      if (pauseId) this.pauseMenuDef = this.uiDefs.get(pauseId) ?? null;
      if (winId) this.winScreenDef = this.uiDefs.get(winId) ?? null;
      if (loseId) this.loseScreenDef = this.uiDefs.get(loseId) ?? null;
    }

    if (gameRules) {
      this.gameStateStore = new GameStateStore(gameRules);
      // Bridge content-emitted `game-event` script messages into the rules store
      // so triggers/actor scripts (score, objective progress, win/lose) drive it
      // without the engine knowing any project rule. Released in dispose().
      this.gameEventUnsub = this.behaviorSubsystem.subscribeScriptMessage(
        "game-event",
        (envelope) => {
          const event = parseGameEvent(envelope.payload);
          if (event) this.gameStateStore?.dispatch(event);
        },
      );
      // Seed bound fields so the HUD's first render shows authored starting values.
      for (const [path, value] of Object.entries(this.gameStateStore.hudFields())) {
        this.uiStore.setField(path, value);
      }
    }

    if (worldWidgets.length > 0) {
      this.worldUiSubsystem = new WorldUiSubsystem(host, {
        resolveWidget: (src) => this.uiDefs.get(src) ?? null,
        resolveTheme: (ref) => this.uiThemes.get(ref) ?? null,
        store: this.uiStore,
        ...(this.localeRegistry ? { locale: this.localeRegistry } : {}),
        onMessageAction: (action) => {
          if (this.handleTravelUiMessage(action.message)) return;
          if (this.saveCoordinator.handleUiMessage(action.message)) return;
          if (this.handleSettingsUiMessage(action.message)) return;
          this.behaviorSubsystem.emitScriptMessage("ui-action", "ui", { message: action.message });
        },
        resolveEntityPosition: (entityId, target) => this.resolveEntityWorldPosition(entityId, target),
      });
      this.worldUiSubsystem.setWidgets(worldWidgets);
    }
  }

  /**
   * Loads all `.ui.json` widget assets from the manifest (excludes `.theme.json`).
   * Used by {@link setupRuntimeUi} to populate the Include resolver registry.
   */
  private async loadAllUiWidgetDefs(): Promise<Map<string, UiWidgetDef>> {
    const out = new Map<string, UiWidgetDef>();
    if (!this.assetLoader) return out;
    const manifest = await this.assetLoader.loadManifest();
    const uiAssets = manifest.assets.filter(
      (entry) => assetType(entry) === "ui" && assetPath(entry).endsWith(".ui.json"),
    );
    await Promise.all(
      uiAssets.map(async (asset) => {
        try {
          const response = await fetch(projectFileUrl(assetPath(asset)), { cache: "no-cache" });
          if (!response.ok) return;
          out.set(asset.id, normalizeUiWidgetDef(await response.json(), asset.name));
        } catch {
          // Missing/malformed UI asset: skip it (the scene still plays).
        }
      }),
    );
    return out;
  }

  /**
   * Loads the `.loc.json` localization tables from the manifest into a
   * {@link LocaleRegistry}, then selects the active locale from
   * `worldSettings.locale` (falling back to the first registered table). Returns
   * null when the project authors no locale tables, so non-localized scenes pay
   * nothing. Tables are registered in manifest order for a deterministic default.
   */
  private async loadUiLocaleRegistry(): Promise<LocaleRegistry | null> {
    if (!this.assetLoader) return null;
    const manifest = await this.assetLoader.loadManifest();
    const locAssets = manifest.assets.filter(
      (entry) => assetType(entry) === "ui" && assetPath(entry).endsWith(".loc.json"),
    );
    if (locAssets.length === 0) return null;
    const tables = await Promise.all(
      locAssets.map(async (asset) => {
        try {
          const response = await fetch(projectFileUrl(assetPath(asset)), { cache: "no-cache" });
          if (!response.ok) return null;
          return normalizeUiLocaleTable(await response.json());
        } catch {
          // Missing/malformed locale table: skip it (keys fall back to themselves).
          return null;
        }
      }),
    );
    const registry = new LocaleRegistry();
    for (const table of tables) if (table) registry.register(table);
    if (registry.availableLocales().length === 0) return null;
    const desired = this.layout?.worldSettings?.locale;
    if (desired) registry.setActiveLocale(desired);
    if (this.userSettings.locale) registry.setActiveLocale(this.userSettings.locale);
    return registry;
  }

  private applyUserAudioSettings(settings: UserSettings): void {
    for (const [bus, volume] of Object.entries(settings.audio.busVolumes)) {
      if (isAudioBusId(bus)) this.audioSubsystem.setBusVolume(bus, volume);
    }
  }

  /**
   * Loads the theme defs referenced by the given widgets (`def.theme`) into
   * {@link uiThemes}, keyed by the reference. A reference resolves as a manifest
   * `ui` asset id first, else as a direct public-relative path (matching the
   * plan's `assets/ui/default.theme.json` form). Missing/malformed themes are
   * skipped — a themeless widget falls back to the built-in CSS variables.
   */
  private async loadUiThemeDefs(widgets: Iterable<UiWidgetDef>): Promise<void> {
    const refs = new Set<string>();
    for (const widget of widgets) if (widget.theme) refs.add(widget.theme);
    if (refs.size === 0) return;
    const manifest = this.assetLoader ? await this.assetLoader.loadManifest() : null;
    await Promise.all(
      [...refs].map(async (ref) => {
        const asset = manifest?.assets.find((entry) => entry.id === ref);
        const path = asset ? assetPath(asset) : ref;
        try {
          const response = await fetch(projectFileUrl(path), { cache: "no-cache" });
          if (!response.ok) return;
          this.uiThemes.set(ref, normalizeUiThemeDef(await response.json(), ref));
        } catch {
          // Missing/malformed theme: skip it (widget uses default CSS variables).
        }
      }),
    );
  }

  /**
   * Routes input as the UI screen stack opens/closes. A screen forces `ui` input
   * (suppressing gameplay) and frees the cursor; closing the last screen re-grabs
   * pointer lock when the active camera uses it (a no-op for right-drag).
   */
  private handleUiScreenStackChange(depth: number): void {
    // Hide the on-screen touch controls behind any open menu/outcome screen so
    // the stick/buttons can't be hit through it (and held input is released).
    this.touchInput?.setVisible(depth === 0);
    if (depth > 0) {
      this.inputMode = "ui";
      this.pointerLook.release();
      this.pointerLook.setMouseCursorVisible(true);
    } else {
      this.pointerLook.reengage();
    }
  }

  /**
   * Mounts the on-screen touch controls when the host looks touch-driven (a
   * phone/tablet browser). Desktop pointer/keyboard hosts pay nothing. The
   * controls feed the same action map as keyboard/gamepad.
   */
  private attachTouchControls(canvas: HTMLCanvasElement): void {
    if (!isTouchLikely()) return;
    const host = document.getElementById("ui-overlay") ?? canvas.parentElement ?? document.body;
    this.touchInput = new TouchInputSource(this.inputActions, host);
    this.touchInput.attach();
  }

  /** Toggles the pause menu on the `menu` action edge (Escape). */
  private updateUiInput(): void {
    if (!this.uiSubsystem) return;
    if (!this.inputActions.pressed("menu")) return;
    if (this.uiSubsystem.screenDepth > 0) this.uiSubsystem.back();
    else this.openPauseMenu();
  }

  /** Pushes the configured pause menu when one exists and no screen is open. */
  private openPauseMenu(): void {
    if (!this.uiSubsystem || !this.pauseMenuDef) return;
    if (this.uiSubsystem.screenDepth > 0) return;
    this.uiSubsystem.pushScreen(this.pauseMenuDef);
  }

  /**
   * Feeds the ViewModel store the possessed pawn's live state, then flushes so
   * only widgets bound to a changed field re-render. v1 surfaces the player's
   * planar speed (`player.speed` / `player.speedLabel`); the HUD binds to these.
   */
  private updateUiStore(): void {
    if (!this.uiSubsystem && !this.worldUiSubsystem) return;
    const possessed = this.gameModeSession?.playerState.pawnEntityId ?? null;
    const speed = (possessed ? this.locomotionReports.get(possessed)?.planarSpeed : 0) ?? 0;
    this.uiStore.setField("player.speed", speed);
    this.uiStore.setField("player.speedLabel", `Speed ${speed.toFixed(1)} m/s`);
    this.uiStore.flush();
  }

  /**
   * Advances the gameplay-rules store (when configured), mirrors its bindable
   * `game.*` fields into the UI ViewModel store, and pushes the configured
   * win/loss screen once when the round settles. The round freezes while any
   * screen (pause or outcome) is open, so pausing genuinely pauses the timer.
   * Flushed by {@link updateUiStore}, which runs immediately after.
   */
  private updateGameRules(dt: number): void {
    const store = this.gameStateStore;
    if (!store) return;
    const paused = (this.uiSubsystem?.screenDepth ?? 0) > 0;
    if (!paused) store.tick(dt);
    for (const [path, value] of Object.entries(store.hudFields())) {
      this.uiStore.setField(path, value);
    }
    if (!this.gameOutcomeShown && store.phase !== "playing") {
      this.gameOutcomeShown = true;
      this.showGameOutcome(store.phase);
    }
  }

  /** Presents the win/loss screen for a settled round, replacing any open screen. */
  private showGameOutcome(phase: GamePhase): void {
    if (!this.uiSubsystem) return;
    const def = phase === "won" ? this.winScreenDef : this.loseScreenDef;
    if (!def) return;
    if (this.uiSubsystem.screenDepth > 0) this.uiSubsystem.clearScreens();
    this.uiSubsystem.pushScreen(def);
  }

  /**
   * Intercepts reserved `game:*` UI widget messages (win/loss/pause buttons):
   * `game:restart` restarts the round, `game:resume` closes the open screen.
   * Returns true when handled so the message isn't also forwarded to gameplay.
   */
  private handleGameUiMessage(message: string): boolean {
    switch (message) {
      case "game:restart":
        this.restartGame();
        return true;
      case "game:resume":
        this.uiSubsystem?.clearScreens();
        return true;
      default:
        return false;
    }
  }

  /**
   * Intercepts a reserved `travel:` UI widget message so a menu (e.g. "New Game")
   * can start Level Travel (P2). The message is `travel:<layoutPath>` or
   * `travel:<layoutPath>#<spawnTag>` — the path is the destination level, the
   * optional tag picks a Player Start there. Returns true when handled so the
   * message isn't also forwarded to gameplay as a `ui-action`.
   */
  private handleTravelUiMessage(message: string): boolean {
    if (!message.startsWith("travel:")) return false;
    const spec = message.slice("travel:".length);
    const hashIndex = spec.indexOf("#");
    const layoutPath = hashIndex >= 0 ? spec.slice(0, hashIndex) : spec;
    if (!layoutPath) return false;
    const spawnTag = hashIndex >= 0 ? spec.slice(hashIndex + 1) : "";
    this.travelCoordinator.requestLevelTravel(layoutPath, spawnTag || undefined);
    return true;
  }

  /**
   * Captures the current gameplay state into a save payload (delegated to by the
   * {@link saveCoordinator}), or null when there is nothing savable yet. Stays in
   * the shell because it reads the live game-mode/behavior/entity state.
   */
  private collectCurrentSaveState(): GameSaveState | null {
    if (!this.activeLevelPath) return null;
    const pawnId = this.gameModeSession?.playerState.pawnEntityId ?? null;
    const playerTransform = pawnId ? this.transformForEntity(pawnId) : null;
    return collectSaveState({
      activeLevelPath: this.activeLevelPath,
      playerTransform,
      persistentState: this.behaviorSubsystem.getPersistentStateSnapshot(),
    });
  }

  /**
   * Intercepts reserved user-settings widget messages:
   * - `settings:open:graphics` — pushes the graphics settings screen
   * - `settings:graphics:quality:<level>` / `:adaptive:<on|off>` / `:targetfps:<30|60>` / `:reset`
   * - `settings:locale:<locale>`
   * - `settings:audio:<bus>:<volume>`
   */
  private handleSettingsUiMessage(message: string): boolean {
    if (message === "settings:open:graphics") {
      const def = this.uiDefs.get("graphics-settings");
      if (def) this.uiSubsystem?.pushScreen(def);
      return true;
    }
    if (message.startsWith("settings:graphics:")) {
      return this.handleGraphicsSettingsMessage(message.slice("settings:graphics:".length));
    }
    if (message.startsWith("settings:locale:")) {
      const locale = message.slice("settings:locale:".length).trim();
      return locale.length > 0 ? this.setUserLocale(locale) : false;
    }
    if (!message.startsWith("settings:audio:")) return false;
    const spec = message.slice("settings:audio:".length);
    const [bus, rawVolume] = spec.split(":");
    if (!bus || !isAudioBusId(bus)) return false;
    const volume = Number(rawVolume);
    if (!Number.isFinite(volume)) return false;
    this.setUserAudioBusVolume(bus, volume);
    return true;
  }

  /** Routes a `settings:graphics:<spec>` widget message to the graphics setters. */
  private handleGraphicsSettingsMessage(spec: string): boolean {
    if (spec === "reset") return this.resetGraphicsPreferences();
    if (spec.startsWith("quality:")) {
      const level = spec.slice("quality:".length);
      return isQualityLevel(level) ? this.setGraphicsQualityLevel(level) : false;
    }
    if (spec.startsWith("adaptive:")) {
      const value = spec.slice("adaptive:".length);
      if (value !== "on" && value !== "off") return false;
      return this.setGraphicsAdaptive(value === "on");
    }
    if (spec.startsWith("targetfps:")) {
      const fps = Number(spec.slice("targetfps:".length));
      if (fps !== 30 && fps !== 60) return false;
      return this.setGraphicsTargetFrameRate(fps);
    }
    return false;
  }

  /**
   * Restarts the rules round in place: resets the store to its authored initial
   * state, closes any open screen (resuming gameplay), and broadcasts a
   * `game-restart` script message so content can reset itself (respawn pickups,
   * move the player home). A full world reset is the game's responsibility — the
   * framework owns only the rules state. No-op without a rules store.
   */
  private restartGame(): void {
    if (!this.gameStateStore) return;
    this.gameStateStore.dispatch({ kind: "restart" });
    this.gameOutcomeShown = false;
    this.uiSubsystem?.clearScreens();
    this.behaviorSubsystem.emitScriptMessage("game-restart", "game", {});
  }

  /**
   * Projects each world-space UI widget onto the screen for this frame, using the
   * live camera + the canvas pixel size. No-op when the layout places none.
   */
  private updateWorldUi(): void {
    if (!this.worldUiSubsystem) return;
    const canvas = this.renderer.domElement;
    this.worldUiSubsystem.update(this.camera, canvas.clientWidth, canvas.clientHeight);
  }

  /**
   * Drives the spatial-audio listener from the runtime camera each frame, so a
   * spatial cue's PannerNode pans/attenuates relative to where the player looks.
   */
  private updateAudioListener(): void {
    this.camera.getWorldPosition(this.listenerPos);
    this.camera.getWorldDirection(this.listenerDir);
    this.audioSubsystem.setListenerPose(
      [this.listenerPos.x, this.listenerPos.y, this.listenerPos.z],
      [this.listenerDir.x, this.listenerDir.y, this.listenerDir.z],
    );
  }

  /**
   * Resolves a world-widget `anchor.entityId` (`actor:<i>` / `character:<i>`) to
   * the entity's live world position, writing into `target`. Returns false when
   * the entity has no render object (e.g. a mesh-less logic actor, or an
   * instanced placement — unsupported for entity anchors), so its billboard hides.
   */
  private resolveEntityWorldPosition(entityId: string, target: Vector3): boolean {
    const actorObject = this.actorObjects.get(entityId);
    if (actorObject) {
      const object = actorObject;
      if (!object) return false;
      object.getWorldPosition(target);
      return true;
    }
    const characterIndex = parseCharacterEntityIndex(entityId);
    if (characterIndex !== null) {
      const object = this.characterObjects[characterIndex];
      if (!object) return false;
      object.getWorldPosition(target);
      return true;
    }
    return false;
  }

  /**
   * Loads each character's `*.skeleton.json` sidecar (deduped per asset) and
   * attaches the result to every {@link RuntimeCharacterRef}. The Game Mode reads
   * `ref.skeleton` to drive blend-space locomotion; assets without a sidecar get
   * the safe empty default. Runs after the refs are built, before possession.
   */
  private async loadCharacterSkeletons(): Promise<void> {
    if (!this.assetLoader || this.characterRefs.length === 0) return;
    const manifest = await this.assetLoader.loadManifest();
    const byAsset = new Map<string, Promise<AssetSkeletonDef>>();
    const skeletonFor = (assetId: string): Promise<AssetSkeletonDef> => {
      let pending = byAsset.get(assetId);
      if (!pending) {
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        pending = asset ? loadAssetSkeleton(assetPath(asset)) : Promise.resolve(defaultAssetSkeleton());
        byAsset.set(assetId, pending);
      }
      return pending;
    };
    await Promise.all(
      this.characterRefs.map(async (ref) => {
        ref.skeleton = await skeletonFor(ref.placement.assetId);
      }),
    );
  }

  /** Maps manifest `sound`, `soundCue`, and effect asset ids to fetchable file URLs. */
  private async populateAssetUrls(): Promise<void> {
    if (!this.assetLoader) return;
    const manifest = await this.assetLoader.loadManifest();
    for (const asset of manifest.assets) {
      const path = assetPath(asset);
      if (assetType(asset) === "sound") this.soundUrlById.set(asset.id, projectFileUrl(path));
      if (assetType(asset) === "soundCue") this.soundCueUrlById.set(asset.id, projectFileUrl(path));
      if (assetType(asset) === "texture") this.textureUrlById.set(asset.id, projectFileUrl(path));
      // Prefer the `effect` asset type; fall back to the `.effect.json` suffix so
      // older manifests (effect assets typed as `prefab`) keep resolving.
      if (assetType(asset) === "effect" || path.endsWith(".effect.json")) {
        this.effectUrlById.set(asset.id, projectFileUrl(path));
      }
    }
  }

  /** Fetches and caches a soundCue asset by id. Returns null on failure. */
  private async loadSoundCue(cueId: string): Promise<SoundCueAsset | null> {
    if (this.soundCueDefs.has(cueId)) return this.soundCueDefs.get(cueId) ?? null;
    const url = this.soundCueUrlById.get(cueId);
    if (!url) { this.soundCueDefs.set(cueId, null); return null; }
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) { this.soundCueDefs.set(cueId, null); return null; }
      const data = (await response.json()) as SoundCueAsset;
      this.soundCueDefs.set(cueId, data);
      return data;
    } catch {
      this.soundCueDefs.set(cueId, null);
      return null;
    }
  }

  /**
   * Registers every `dialogueVoice` / `dialogueLine` / `conversation` manifest
   * asset, then subscribes the `play-dialogue` and `start-conversation` script
   * messages as triggers. Gameplay/interactions emit `play-dialogue` with a
   * `lineId` (and optional `speakerVoiceId` / `targetVoiceId` / `locale`) to
   * start a bark, or `start-conversation` with a `conversationId` to run a
   * conversation graph.
   */
  private async setupDialogue(): Promise<void> {
    await this.loadDialogueAssets();
    // Ensure subtitle localization works even for a scene with no HUD/menu (where
    // `setupRuntimeUi` returns before loading locale tables). Reuses the registry
    // already loaded for the UI when present; loads it on demand otherwise.
    if (!this.localeRegistry) this.localeRegistry = await this.loadUiLocaleRegistry();
    // Re-subscribe from scratch: a scene rebuild clears message-bus subscriptions.
    this.dialogueUnsub?.();
    this.dialogueUnsub = this.behaviorSubsystem.subscribeScriptMessage(
      "play-dialogue",
      (envelope) => {
        const payload = envelope.payload;
        const lineId = typeof payload.lineId === "string" ? payload.lineId : "";
        if (!lineId) return;
        const context: DialoguePlayContext = {};
        if (typeof payload.speakerVoiceId === "string") {
          context.speakerVoiceId = payload.speakerVoiceId;
        }
        if (typeof payload.targetVoiceId === "string") {
          context.targetVoiceId = payload.targetVoiceId;
        }
        if (typeof payload.locale === "string") context.locale = payload.locale;
        this.dialogueSubsystem.playLine(lineId, context);
      },
    );

    this.conversationUnsub?.();
    this.conversationUnsub = this.behaviorSubsystem.subscribeScriptMessage(
      "start-conversation",
      (envelope) => {
        const conversationId =
          typeof envelope.payload.conversationId === "string"
            ? envelope.payload.conversationId
            : "";
        if (conversationId) this.conversationDirector.start(conversationId);
      },
    );
  }

  /**
   * Fetches + registers dialogue voice/line assets and conversation graphs from
   * the manifest. Conversations are re-registered fresh each scene load (the
   * director drops any running conversation and its stale registrations first).
   */
  private async loadDialogueAssets(): Promise<void> {
    if (!this.assetLoader) return;
    const manifest = await this.assetLoader.loadManifest();
    this.conversationDirector.clear();
    await Promise.all(
      manifest.assets.map(async (asset) => {
        const kind = assetType(asset);
        if (kind !== "dialogueVoice" && kind !== "dialogueLine" && kind !== "conversation") return;
        try {
          const response = await fetch(projectFileUrl(assetPath(asset)), { cache: "no-cache" });
          if (!response.ok) return;
          const data = (await response.json()) as unknown;
          if (kind === "dialogueVoice" && isDialogueVoiceAsset(data)) {
            this.dialogueSubsystem.registerVoice(data);
          } else if (kind === "dialogueLine" && isDialogueLineAsset(data)) {
            this.dialogueSubsystem.registerLine(data);
          } else if (kind === "conversation" && isConversationAsset(data)) {
            this.conversationDirector.register(data);
          }
        } catch {
          // Missing/malformed dialogue asset: skip it (the scene still plays).
        }
      }),
    );
  }

  /**
   * Plays a resolved dialogue line's audio through the {@link audioSubsystem} and
   * hands the subsystem a control handle. Raw `sound` sources play directly; a
   * `soundCue` source is evaluated and fired best-effort (subtitle timing then
   * falls back to the text-length estimate, since a cue reports no duration).
   */
  private playDialogueAudio(request: DialogueAudioRequest): DialogueAudioPlayback | null {
    if (request.sourceType === "soundCue") {
      void this.loadSoundCue(request.sourceId).then((cue) => {
        if (!cue) return;
        for (const ev of evaluateSoundCue(cue)) {
          const opts = {
            volume: ev.volume,
            loop: ev.loop,
            pitch: ev.pitch,
            ...(cue.output.bus ? { bus: cue.output.bus } : {}),
          };
          if (ev.delaySeconds > 0) {
            setTimeout(() => this.audioSubsystem.playOneShot(ev.clipId, opts), ev.delaySeconds * 1000);
          } else {
            this.audioSubsystem.playOneShot(ev.clipId, opts);
          }
        }
      });
      return { stop: () => undefined };
    }
    // Raw sound: the audio subsystem resolves the asset id to a file URL itself.
    const handle = this.audioSubsystem.play(request.sourceId, {});
    return { stop: () => handle.stop() };
  }

  /** Plays every Audio component flagged `autoPlay` once the scene is built (ambient). */
  private playAutoPlayAudio(document: SceneDocument): void {
    for (const entity of document.entities) {
      try {
        this.playAutoPlayAudioEntity(entity);
      } catch (error) {
        // One unplayable emitter must not stop the rest (or the scene start).
        console.error(`[runtime] auto-play audio failed for ${entity.id}:`, error);
      }
    }
  }

  private playAutoPlayAudioEntity(entity: Entity): void {
    {
      const audio = readAudioComponent(entity);
      if (!audio?.autoPlay) return;
      const position = audio.spatial ? readTransformComponent(entity)?.position : undefined;
      // Spatial placement + authored sphere-attenuation overrides for the PannerNode.
      const spatialOpts =
        audio.spatial && position
          ? {
              position: [position[0], position[1], position[2]] as const,
              ...(audio.refDistance !== undefined ? { refDistance: audio.refDistance } : {}),
              ...(audio.maxDistance !== undefined ? { maxDistance: audio.maxDistance } : {}),
              ...(audio.rolloff !== undefined ? { rolloff: audio.rolloff } : {}),
            }
          : {};
      const componentPitch = audio.pitch ?? 1;

      if (audio.sourceType === "soundCue" && audio.sourceId) {
        // Async: load cue, evaluate graph, fire each resolved event.
        void this.loadSoundCue(audio.sourceId).then((cue) => {
          if (!cue) return;
          const events = evaluateSoundCue(cue);
          for (const ev of events) {
            const opts = {
              volume: ev.volume * audio.volume,
              loop: ev.loop || audio.loop,
              // The component's pitch multiplier scales the cue's own pitch (Unreal parity).
              pitch: ev.pitch * componentPitch,
              spatial: audio.spatial,
              // Route the cue through its authored mix bus (default master).
              ...(cue.output.bus ? { bus: cue.output.bus } : {}),
              ...spatialOpts,
            };
            if (ev.delaySeconds > 0) {
              setTimeout(() => this.audioSubsystem.playOneShot(ev.clipId, opts), ev.delaySeconds * 1000);
            } else {
              this.audioSubsystem.playOneShot(ev.clipId, opts);
            }
          }
        });
      } else {
        this.audioSubsystem.playOneShot(audio.clipId, {
          volume: audio.volume,
          loop: audio.loop,
          spatial: audio.spatial,
          ...(audio.pitch !== undefined ? { pitch: audio.pitch } : {}),
          ...spatialOpts,
        });
      }
    }
  }

  /**
   * Spawns a live particle effect for every ParticleEmitter flagged `autoPlay`,
   * at the entity's authored position. Resolves the component's `effectId` to a
   * manifest `.effect.json`, loads + caches it, then adds the effect to the scene
   * for the frame loop to advance.
   */
  private async playAutoPlayParticles(document: SceneDocument): Promise<void> {
    for (const entity of document.entities) {
      await this.playAutoPlayParticleEntity(entity);
    }
  }

  private async playAutoPlayParticleEntity(entity: Entity): Promise<void> {
    const particle = readParticleEmitterComponent(entity);
    if (!particle?.autoPlay || particle.enabled === false) return;
    const transform = readTransformComponent(entity);
    if (!transform) return;
    // Warm the definition so the synchronous play() below hits the cache; the
    // component's scale/tint/loop fields are the §8 instance overrides.
    await this.vfxSubsystem.warm(particle.effectId);
    this.vfxSubsystem.play(particle.effectId, { ...particle, position: transform.position });
  }

  /**
   * Browser autoplay policies suspend the audio context until a user gesture, so
   * resume it on the first pointer/key input — then ambient cues auto-played at
   * scene load begin sounding. One-shot: removes itself after the first gesture.
   */
  private resumeAudioOnFirstGesture(): void {
    const resume = (): void => {
      this.audioSubsystem.resumeContext();
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
  }

  /**
   * Resolves the Game Mode for this Play boot, caching the result. A project Game
   * Mode (`worldSettings.gameMode` is a `*.actor.json` class ref) is loaded and
   * built from its Actor Script class; built-in ids resolve through the registry.
   * A class ref that is not actually a `gameMode` class falls back to the default
   * camera mode, so a stale/mis-typed reference can't break Play.
   */
  private async resolveActiveGameMode(): Promise<GameModeDefinition> {
    if (this.activeGameMode) return this.activeGameMode;
    const id = this.layout?.worldSettings?.gameMode;
    let mode: GameModeDefinition;
    if (isGameModeClassRef(id)) {
      const def = await this.loadActorClass(id as string);
      mode =
        def.parentClass === "gameMode"
          ? createProjectGameMode({
              classRef: id as string,
              displayName: def.name,
              defaultPawnClassRef: readGameModeDefaultPawnClassRef(def),
            })
          : resolveGameMode(undefined);
    } else {
      mode = resolveGameMode(id);
    }
    this.activeGameMode = mode;
    return mode;
  }

  /**
   * Anchors / spawns the player a character-possessing Game Mode will possess,
   * before the scene is built so render, physics and behavior all begin at the
   * spawn point. Preference order:
   *  1. An authored player character (legacy `layout.characters`) is moved to the
   *     first Player Start marker (or the origin when none exists).
   *  2. An authored player Actor (a `character` class with CharacterMovement) is
   *     left where it was placed.
   *  3. Otherwise the mode's default pawn is spawned at the Player Start — a
   *     project Game Mode spawns its `pawnClassRef` Actor Script, the built-in TPS
   *     mode spawns its `characterAssetId` legacy character.
   * Synthetic pawns are appended to the in-memory layout only — never persisted.
   * No-op for non-character modes (the default camera mode possesses nothing).
   */
  private async applyPlayerStartSpawn(spawnTag?: string): Promise<void> {
    if (!this.layout) return;
    const mode = await this.resolveActiveGameMode();
    if (mode.defaultPawn.kind !== "character") return;

    const spawn = computePlayerStartSpawn(this.layout, spawnTag);
    if (spawn) {
      const character = this.layout.characters[spawn.characterIndex];
      if (!character) return;
      character.position = [...spawn.position];
      if (spawn.yawDeg !== null) character.rotation = [0, spawn.yawDeg, 0];
      return;
    }
    // An authored player Actor (character class with movement, not AI-controlled)
    // already is a pawn.
    if (
      this.actorEntities.some(
        (entity) => readCharacterMovementComponent(entity) && !readAIControllerComponent(entity),
      )
    ) {
      return;
    }
    // No authored player: spawn the mode's default pawn at the Player Start.
    if (mode.defaultPawn.pawnClassRef) {
      await this.spawnDefaultPawnActor(mode.defaultPawn.pawnClassRef, spawnTag);
    } else {
      this.spawnDefaultPlayerPawn(mode.defaultPawn, spawnTag);
    }
  }

  /**
   * Appends the TPS default player pawn to the in-memory layout at the Player
   * Start, so the scene builder, physics and the TPS possession path treat it
   * like an authored player. No-op without a character pawn asset or a Player
   * Start marker. Runtime-only; never persisted.
   */
  private spawnDefaultPlayerPawn(pawn: PawnDefinition, spawnTag?: string): void {
    if (!this.layout) return;
    if (pawn.kind !== "character" || !pawn.characterAssetId) return;
    const start = findPlayerStartTransform(this.layout, spawnTag);
    if (!start) return;
    this.layout.characters.push(
      createDefaultPlayerCharacter(
        { assetId: pawn.characterAssetId, scale: pawn.characterScale, speed: pawn.movement?.speed },
        start.position,
        start.yawDeg,
      ),
    );
  }

  /**
   * Appends a project Game Mode's default pawn Actor Script to the in-memory
   * layout at the Player Start, and resolves its entity so the later model-load,
   * object-build and possession steps treat it like an authored player Actor (it
   * brings its own mesh + capsule + CharacterMovement from the class template).
   * No-op without a Player Start marker. Runtime-only; never persisted.
   */
  private async spawnDefaultPawnActor(classRef: string, spawnTag?: string): Promise<void> {
    if (!this.layout) return;
    const start = findPlayerStartTransform(this.layout, spawnTag);
    if (!start) return;
    const instance: LayoutActorInstance = {
      classRef,
      name: "Player",
      position: [start.position[0], start.position[1], start.position[2]],
      rotation: [0, start.yawDeg ?? 0, 0],
    };
    if (!this.layout.actors) this.layout.actors = [];
    const index = this.layout.actors.length;
    this.layout.actors.push(instance);
    const def = await this.loadActorClass(classRef);
    this.registerActorEntity(actorInstanceToEntity(def, instance, index));
  }

  /**
   * Resolves the layout's selected Game Mode (Unreal's GameMode analogue),
   * spawns + possesses its default pawn, then attaches ambient single-clip
   * animation to every character the mode did not possess. Unknown/absent
   * `worldSettings.gameMode` falls back to the default camera mode.
   */
  private async startGameMode(): Promise<void> {
    this.applyPlayCameraHandoff();
    const mode = await this.resolveActiveGameMode();
    const session = mode.createSession(this.createGameModeContext());
    session.spawnDefaultPawn();
    session.possess();
    this.gameModeSession = session;
    this.cachePawnRespawnTransform(session.playerState.pawnEntityId);

    // Characters the Game Mode did not possess keep their single authored clip.
    const possessedEntityId = session.playerState.pawnEntityId;
    for (const ref of this.characterRefs) {
      if (ref.entityId === possessedEntityId) continue;
      if (ref.isAiControlled && ref.hasCharacterMovement) {
        this.registerAiCharacterAnimator(ref);
        continue;
      }
      const mixer = createSceneCharacterMixer(
        ref.object,
        ref.gltf,
        ref.placement.animation,
        ref.skeleton?.rootMotion,
      );
      if (mixer) {
        this.animationSubsystem.add(mixer, {
          distanceSquared: () => ref.object.position.distanceToSquared(this.camera.position),
        });
      }
    }
  }

  private registerAiCharacterAnimator(ref: RuntimeCharacterRef): void {
    const config = locomotionConfigForSkeleton(ref.skeleton);
    const animator = new CrossfadeAnimator(ref.object, ref.gltf.animations, {
      ...(ref.skeleton?.rootMotion ? { rootMotion: ref.skeleton.rootMotion } : {}),
    });
    const initial = resolveLocomotionAnimation(
      { planarSpeed: 0, grounded: true, velocityY: 0 },
      animator.clips,
      config,
      DEFAULT_LOCOMOTION_THRESHOLDS,
    );
    if (initial.kind === "blend") animator.playBlend(initial.weights);
    else if (initial.clip) animator.play(initial.clip, 0);
    this.animationSubsystem.add(animator.mixer, {
      distanceSquared: () => ref.object.position.distanceToSquared(this.camera.position),
    });
    this.aiCharacterAnimators.set(ref.entityId, { ref, animator, config, oneShot: null });
  }

  private updateAiCharacterAnimations(deltaSeconds: number): void {
    for (const [entityId, runtime] of this.aiCharacterAnimators) {
      if (entityId === this.gameModeSession?.playerState.pawnEntityId) continue;
      let fadeSeconds = deltaSeconds > 0 ? 0.18 : 0;
      if (runtime.oneShot) {
        runtime.oneShot.remaining -= Math.max(0, deltaSeconds);
        if (runtime.oneShot.remaining > 0) continue;
        fadeSeconds = runtime.oneShot.blendOutSeconds;
        runtime.oneShot = null;
      }
      const report = this.locomotionReports.get(entityId);
      const result = resolveLocomotionAnimation(
        report ?? { planarSpeed: 0, grounded: true, velocityY: 0 },
        runtime.animator.clips,
        runtime.config,
        DEFAULT_LOCOMOTION_THRESHOLDS,
      );
      if (result.kind === "blend") runtime.animator.playBlend(result.weights);
      else if (result.clip) runtime.animator.play(result.clip, fadeSeconds);
    }
  }

  private cachePawnRespawnTransform(entityId: string | null): void {
    if (!entityId) return;
    const base = this.transformForCharacterEntity(entityId);
    if (!base) return;
    const start = this.layout ? findPlayerStartTransform(this.layout) : null;
    const respawn = cloneTransform(base);
    if (start) {
      respawn.position = [...start.position];
      if (start.yawDeg !== null) respawn.rotation = [0, start.yawDeg, 0];
    }
    this.pawnRespawnTransforms.set(entityId, respawn);
  }

  private applyKillZ(): void {
    const entityId = this.gameModeSession?.playerState.pawnEntityId;
    if (!entityId) return;
    const ref = this.characterRefs.find((candidate) => candidate.entityId === entityId);
    if (!ref || ref.object.position.y > this.killZ) return;
    const target = this.pawnRespawnTransforms.get(entityId) ?? this.transformForCharacterEntity(entityId);
    if (!target) return;
    const reset = cloneTransform(target);
    this.locomotionReports.delete(entityId);
    this.characterMovementSubsystem.resetEntityTransform(entityId, reset);
    this.syncEntityTransform(entityId, reset);
  }

  private applySavedPlayerTransform(player: SavedPlayerTransform): void {
    const entityId = this.gameModeSession?.playerState.pawnEntityId;
    if (!entityId) return;
    const current = this.transformForEntity(entityId);
    if (!current) return;
    const restored: TransformComponent = {
      position: [player.position[0], player.position[1], player.position[2]],
      rotation: [current.rotation[0], player.facingYawDeg, current.rotation[2]],
      scale: [...current.scale],
    };
    this.locomotionReports.delete(entityId);
    this.characterMovementSubsystem.resetEntityTransform(entityId, restored);
    this.behaviorSubsystem.resetEntityTransform(entityId, restored);
    this.syncEntityTransform(entityId, restored);
    this.pawnRespawnTransforms.set(entityId, cloneTransform(restored));
  }

  private transformForEntity(entityId: string): TransformComponent | null {
    const character = this.transformForCharacterEntity(entityId);
    if (character) return character;
    const entity = this.actorEntityById.get(entityId);
    if (!entity) return null;
    const transform = readTransformComponent(entity);
    return transform ? cloneTransform(transform) : null;
  }

  /** Possessed pawn is the gameplay focus; camera position is the safe fallback during boot. */
  private qualityFocusPosition(): readonly [number, number, number] {
    const pawnEntityId = this.gameModeSession?.playerState.pawnEntityId;
    const transform = pawnEntityId ? this.transformForEntity(pawnEntityId) : null;
    return transform
      ? [transform.position[0], transform.position[1], transform.position[2]]
      : [this.camera.position.x, this.camera.position.y, this.camera.position.z];
  }

  private transformForCharacterEntity(entityId: string): TransformComponent | null {
    const ref = this.characterRefs.find((candidate) => candidate.entityId === entityId);
    if (!ref) return null;
    if (ref.entity) {
      const transform = readTransformComponent(ref.entity);
      return transform ? cloneTransform(transform) : null;
    }
    return {
      position: [...ref.placement.position],
      rotation: readRotation(ref.placement),
      scale: readScale(ref.placement),
    };
  }

  /**
   * If the editor's Play button handed off a viewport camera pose, place the
   * runtime camera there before the Game Mode possesses it (the default camera
   * mode then seeds its look angles from this pose). One-shot: opening `/`
   * directly has no handoff and keeps the scene's default framing. The TPS mode
   * overrides the camera each tick, so the handoff only matters for default mode.
   */
  private applyPlayCameraHandoff(): void {
    const pose = consumePlayCameraPose();
    if (!pose) return;
    this.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.camera.quaternion.set(
      pose.quaternion[0],
      pose.quaternion[1],
      pose.quaternion[2],
      pose.quaternion[3],
    );
    this.camera.updateMatrixWorld();
    this.cameraViewTouched = true;
  }

  private createGameModeContext(): GameModeContext {
    return {
      camera: this.camera,
      actions: this.inputActions,
      characters: this.characterRefs,
      getLocomotion: (entityId) => this.locomotionReports.get(entityId),
      staticBlockerAabbs: () => this.physicsSubsystem.staticBlockerAabbs(),
      addMixer: (mixer) => this.animationSubsystem.add(mixer),
      emitAnimNotify: (entityId, name) =>
        this.behaviorSubsystem.emitScriptMessage("anim-notify", entityId, { name }, entityId),
      spawnRagdoll: (desc, options) => this.physicsSubsystem.spawnRagdoll(desc, options),
      sampleRagdoll: (id) => this.physicsSubsystem.sampleRagdoll(id),
      despawnRagdoll: (id) => this.physicsSubsystem.despawnRagdoll(id),
      onScriptMessage: (type, handler, options) =>
        this.behaviorSubsystem.subscribeScriptMessage(
          type,
          handler,
          options?.target !== undefined ? { target: options.target } : {},
        ),
      markCameraControlled: () => {
        this.cameraViewTouched = true;
      },
      consumeLookDelta: () =>
        this.inputMode === "ui" ? { dx: 0, dy: 0 } : this.pointerLook.consume(),
      getInputMode: () => this.inputMode,
      setInputMode: (mode) => {
        this.inputMode = mode;
      },
      setMouseCursorVisible: (visible) => this.pointerLook.setMouseCursorVisible(visible),
      setPointerLookMode: (mode) => this.pointerLook.setMode(mode),
    };
  }

  /**
   * World-aligned collider footprint for a placed asset, from its loaded model
   * bounds, so derived colliders match the rendered mesh instead of a unit cube.
   * Returns undefined when bounds are unavailable (adapter falls back to a
   * scaled unit box).
   */
  private colliderBoxFor(assetId: string, source: ColliderTransformSource) {
    const bounds = this.localBounds.get(assetId);
    return bounds ? colliderBoxFromBounds(bounds, source) : undefined;
  }

  /**
   * Loads authored collision sidecars for the layout's assets so the runtime
   * physics collider uses the compound shapes (not the auto bounding box). Only
   * definitions with primitives are kept; missing sidecars fall back silently.
   */
  private async loadCollisionDefs(): Promise<void> {
    if (!this.assetLoader || !this.layout) return;
    const manifest = await this.assetLoader.loadManifest();
    const assetIds = new Set<string>();
    for (const instance of this.layout.instances) assetIds.add(instance.assetId);
    for (const character of this.layout.characters) assetIds.add(character.assetId);
    const defs = new Map<string, AssetCollisionDef>();
    for (const assetId of assetIds) {
      const def = shapeAssetCollisionDef(assetId);
      if (def && assetCollisionDefHasCollider(def)) defs.set(assetId, def);
    }
    await Promise.all(
      [...assetIds].map(async (assetId) => {
        if (defs.has(assetId)) return;
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        if (!asset) return;
        const def = await loadAssetCollision(assetPath(asset));
        if (assetCollisionDefHasCollider(def)) defs.set(assetId, def);
      }),
    );
    this.collisionDefs = defs;
    this.complexCollisionMeshes = computeComplexCollisionMeshes(
      this.models,
      complexAsSimpleAssetIds(defs),
    );
  }

  private async loadMissingSceneModels(): Promise<void> {
    if (!this.assetLoader) return;
    const needed = sceneModelAssetIds(this.layout).filter((assetId) => !this.models.has(assetId));
    if (needed.length === 0) return;
    // Only load ids the manifest still knows as meshes. A layout can outlive an
    // asset (e.g. a model imported then deleted leaves a dangling placement); such
    // ids are skipped with a warning instead of throwing and blanking the scene.
    const manifest = await this.assetLoader.loadManifest();
    const loadable = new Set(
      manifest.assets.filter((asset) => isModelAssetType(assetType(asset))).map((asset) => asset.id),
    );
    const absent = needed.filter((assetId) => !loadable.has(assetId));
    if (absent.length > 0) {
      console.warn("[runtime] layout references assets absent from the manifest; skipping:", absent);
    }
    const missing = needed.filter((assetId) => loadable.has(assetId));
    if (missing.length === 0) return;
    const models = await this.assetLoader.loadModels(missing);
    for (const [assetId, model] of models) this.models.set(assetId, model);
  }

  /**
   * Resolves every placed Actor Script class (`layout.actors[].classRef`) and
   * flattens each instance into an entity. Classes are cached by classRef, so the
   * same blueprint placed N times is fetched once. Missing/malformed files
   * normalize to an empty `actor` class (loadActorClass never throws), so one bad
   * reference cannot abort scene construction.
   */
  private async resolveActorClasses(): Promise<void> {
    const actors = this.layout?.actors ?? [];
    const entities = await Promise.all(
      actors.map(async (instance, index) => {
        const def = await this.loadActorClass(instance.classRef);
        return actorInstanceToEntity(def, instance, index);
      }),
    );
    this.actorEntities = [];
    this.actorEntityById.clear();
    for (const entity of entities) this.registerActorEntity(entity);
  }

  /** Fetches + normalizes an `*.actor.json` class, caching by classRef (never throws). */
  private async loadActorClass(classRef: string): Promise<ActorScriptDef> {
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

  private registerActorEntity(entity: Entity): void {
    this.actorEntities = this.actorEntities.filter((candidate) => candidate.id !== entity.id);
    this.actorEntities.push(entity);
    this.actorEntityById.set(entity.id, entity);
  }

  /**
   * Loads the mesh assets referenced by actor classes' MeshRenderer components.
   * Guards against ids that are absent from the manifest or are not loadable
   * meshes (a malformed class reference is logged + skipped, not thrown, so it
   * can't abort the scene). Procedural `shape:<type>` meshes in actors are not
   * supported in this version (manifest assets only).
   */
  private async loadActorMeshModels(entities: readonly Entity[] = this.actorEntities): Promise<void> {
    if (!this.assetLoader) return;
    const needed = new Set<string>();
    for (const entity of entities) {
      const renderer = readRenderableMeshComponent(entity);
      if (renderer && !this.models.has(renderer.assetId)) needed.add(renderer.assetId);
    }
    if (needed.size === 0) return;
    const manifest = await this.assetLoader.loadManifest();
    const loadable: string[] = [];
    for (const id of needed) {
      const record = manifest.assets.find((asset) => asset.id === id);
      if (record && isModelAssetType(assetType(record))) loadable.push(id);
      else console.warn("[runtime] actor mesh asset missing or not a mesh:", id);
    }
    if (loadable.length === 0) return;
    const models = await this.assetLoader.loadModels(loadable);
    for (const [id, model] of models) this.models.set(id, model);
  }

  /**
   * Adds a renderable object for each actor entity that carries a MeshRenderer or
   * a Light, reusing the single-object (character) render path for meshes and an
   * empty host group for light-only actors. Mesh-less, light-less logic/trigger
   * actors get no object but still run as entities (behavior + collider). The
   * object is tracked by instance index so behavior/physics transform syncs find
   * it (see applyEntityTransformToRender); an attached actor light is a child, so
   * it tracks the host as it moves.
   */
  private addActorObjects(): void {
    this.actorEntities.forEach((entity) => this.addActorObject(entity));
  }

  private addActorObject(entity: Entity): void {
    const object = this.buildActorHostObject(entity);
    if (!object) return;
    object.userData.actorEntityId = entity.id;
    this.scene.add(object);
    this.actorObjects.set(entity.id, object);
    const meshScale = readRenderableMeshComponent(entity)?.scale;
    if (meshScale) this.actorMeshScales.set(entity.id, meshScale);
    this.addColliderDebugWire(entity);
    this.addActorCharacterRef(entity, object);
  }

  /**
   * Adds a green wireframe around a collider-bearing actor's physics collider
   * (unless the Collider opts out with `hideInGame`). The wire matches the
   * authored shape — a capsule outline for capsule colliders, else a box — and is
   * world-space (not parented to the scaled actor object). Its geometry is rebuilt
   * from {@link PhysicsSubsystem.colliderDebugBox} whenever the collider's baked
   * extents change and repositioned every frame, so it traces the actual
   * scale-baked collider and makes collider scaling observable in Play.
   *
   * Debug-only: normal Play (no `?debug`) ships a clean game with no collider
   * wires; add `?debug` to the runtime URL to visualise every collider (actors,
   * characters, and the landscape heightfield). The editor's own authoring view
   * is the separate "Show > Collision" toggle.
   */
  private addColliderDebugWire(entity: Entity): void {
    if (!this.debug) return;
    const collider = readColliderComponent(entity);
    if (!collider || collider.hideInGame === true) return;
    const wire = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0x49e6a2, depthTest: false, transparent: true }),
    );
    wire.userData.colliderShape = collider.shape;
    if (collider.primitives?.some((primitive) => primitive.shape === "trimesh")) {
      wire.userData.colliderPrimitives = collider.primitives;
      wire.userData.colliderPrimitiveWire = true;
    }
    wire.renderOrder = 999;
    wire.frustumCulled = false;
    this.scene.add(wire);
    this.colliderDebugWires.set(entity.id, wire);
    this.updateColliderDebugWire(entity.id, wire);
  }

  /** Refreshes every collider debug wire from the current physics collider box. */
  private updateColliderDebugWires(): void {
    for (const [entityId, wire] of this.colliderDebugWires) {
      this.updateColliderDebugWire(entityId, wire);
    }
  }

  private colliderDebugObject(entityId: string): Object3D | undefined {
    return this.actorObjects.get(entityId) ?? this.landscapeColliderObjects.get(entityId);
  }

  private updateColliderDebugWire(entityId: string, wire: LineSegments): void {
    const object = this.colliderDebugObject(entityId);
    const box = this.physicsSubsystem.colliderDebugBox(entityId);
    if (!object || !box) {
      wire.visible = false;
      return;
    }
    wire.visible = true;
    if (wire.userData.colliderPrimitiveWire === true) {
      if (wire.userData.builtPrimitiveWire !== true) {
        wire.geometry.dispose();
        wire.geometry = colliderTrimeshWireGeometry(
          wire.userData.colliderPrimitives as ColliderPrimitive[] | undefined,
        );
        wire.userData.builtPrimitiveWire = true;
      }
      wire.position.copy(object.position);
      wire.rotation.copy(object.rotation);
      wire.scale.set(1, 1, 1);
      return;
    }
    // The baked collider size is static during Play, so rebuild the exact-size
    // outline only when it actually changes (never, in practice, after the first
    // resolve) instead of scaling a unit mesh — a non-uniform scale would distort
    // a capsule's hemispheres.
    const built = wire.userData.builtHalfExtents as [number, number, number] | undefined;
    if (!built || built[0] !== box.halfExtents[0] || built[1] !== box.halfExtents[1] || built[2] !== box.halfExtents[2]) {
      wire.geometry.dispose();
      wire.geometry = colliderWireGeometry(
        wire.userData.colliderShape as ColliderShape,
        box.halfExtents,
      );
      wire.userData.builtHalfExtents = [...box.halfExtents];
    }
    wire.position.set(
      object.position.x + box.center[0],
      object.position.y + box.center[1],
      object.position.z + box.center[2],
    );
  }

  private addActorCharacterRef(entity: Entity, object: Object3D): void {
    const actor = readScriptActorComponent(entity);
    if (!actor) return;
    const def = this.actorClassCache.get(actor.classRef);
    if (def?.parentClass !== "character") return;
    const renderer = readRenderableMeshComponent(entity);
    const gltf = renderer ? this.models.get(renderer.assetId) : undefined;
    const transform = readTransformComponent(entity);
    if (!gltf) return;
    this.characterRefs.push({
      index: this.characterRefs.length,
      entityId: entity.id,
      object,
      gltf,
      placement: {
        assetId: renderer?.assetId ?? "actor-character",
        ...(entity.name ? { name: entity.name } : {}),
        // A SkeletalMeshComponent's authored clip drives the ambient single-clip
        // mixer for unpossessed characters (startGameMode), matching the scene
        // `layout.characters[]` animation path.
        ...(renderer?.animation ? { animation: renderer.animation } : {}),
        position: transform ? [...transform.position] : [0, 0, 0],
        rotation: transform ? [...transform.rotation] : [0, 0, 0],
        scale: transform ? [...transform.scale] : [1, 1, 1],
      },
      classRef: actor.classRef,
      parentClass: "character",
      hasCharacterMovement: readCharacterMovementComponent(entity) !== undefined,
      isAiControlled: readAIControllerComponent(entity) !== undefined,
      entity,
    });
  }

  /**
   * The host object for an actor instance: its mesh (when a MeshRenderer resolves
   * to a loaded model), else an empty group positioned at the instance transform
   * when the actor carries a Light. Returns null for logic-only actors. Any Light
   * component is attached as a child so it illuminates and tracks the host.
   */
  private buildActorHostObject(entity: Entity): Object3D | null {
    const renderer = readRenderableMeshComponent(entity);
    const gltf = renderer ? this.models.get(renderer.assetId) : undefined;
    const hasLight = readLightComponent(entity) !== undefined;
    let object: Object3D | null = null;
    if (gltf) {
      object = createCharacterSceneObject(gltf, entityCharacterItem(entity));
    } else if (hasLight) {
      const item = entityCharacterItem(entity);
      const group = new Group();
      group.name = item.name;
      group.position.set(item.position[0], item.position[1], item.position[2]);
      applyEulerDegrees(group, item.rotation);
      group.scale.set(item.scale[0], item.scale[1], item.scale[2]);
      group.visible = !item.hidden;
      object = group;
    }
    if (object) attachActorLight(object, entity);
    return object;
  }

  private setActorLightEnabled(entityId: string, enabled: boolean): void {
    const object = this.actorObjects.get(entityId);
    if (!object) return;
    const lights: ThreeLight[] = [];
    object.traverse((child) => {
      if (child instanceof ThreeLight) lights.push(child);
    });
    if (lights.length === 0) return;

    for (const light of lights) {
      if (typeof light.userData.forgeToggleBaseIntensity !== "number") {
        light.userData.forgeToggleBaseIntensity = light.intensity > 0 ? light.intensity : 1;
      }
      light.visible = enabled;
      light.intensity = enabled ? light.userData.forgeToggleBaseIntensity : 0;
    }
  }

  /**
   * Host sink for the generic actor `setVisibility` command (A1): shows/hides an
   * entity's rendered object. Idempotent, so a behavior re-applying a hide after a
   * save restore (the `collectible` pattern) is harmless. Works whether the actor
   * was authored as an Actor Script instance (its own Object3D) or as a plain
   * static-mesh placement (one slot of an InstancedMesh, collapsed to a point;
   * kept collapsed by the per-frame transform sink via `collectedInstances`).
   */
  private setActorObjectVisible = (entityId: string, visible: boolean): void => {
    if (this.actorEntityById.has(entityId)) {
      const object = this.actorObjects.get(entityId);
      if (object) object.visible = visible;
      return;
    }
    const instance = parseInstanceEntityId(entityId);
    if (!instance) return;
    // A material/probe override renders as a clone, not an instanced slot, so
    // toggle that clone directly when present.
    const key = overrideObjectKey(instance.assetId, instance.placementIndex);
    const overrideObject = this.instanceOverrideObjects.get(key);
    if (visible) {
      this.collectedInstances.delete(key);
      if (overrideObject) overrideObject.visible = true;
      // The per-frame transform sink rewrites the slot's matrix next tick, so the
      // pickup reappears at its authored pose once it leaves the hidden set.
    } else {
      // Add to the hidden set first: the per-frame transform sink honours it and
      // re-collapses the slot, so hiding survives the per-frame matrix rewrite.
      this.collectedInstances.add(key);
      if (overrideObject) overrideObject.visible = false;
      this.collapseInstance(instance.assetId, instance.placementIndex);
    }
  };

  /**
   * Host sink for the generic actor `destroy` command (A1): tears down an entity's
   * physics body (so contact queries read empty next frame) and its rendered
   * object. The BehaviorSubsystem has already dropped the entity from its own
   * instance set / indexes / message subscriptions before calling this. The
   * authored `actorEntities` list is left intact (rebuilt fresh on scene reload).
   */
  private destroyActorEntity = (entityId: string): void => {
    this.physicsSubsystem.removeEntity(entityId);
    if (this.actorEntityById.has(entityId)) {
      const object = this.actorObjects.get(entityId);
      if (object) {
        this.scene.remove(object);
        this.actorObjects.delete(entityId);
      }
      this.actorMeshScales.delete(entityId);
      this.actorEntityById.delete(entityId);
      this.actorEntities = this.actorEntities.filter((entity) => entity.id !== entityId);
      this.characterRefs = this.characterRefs.filter((ref) => ref.entityId !== entityId);
      return;
    }
    // A plain instanced static placement can't be freed mid-scene without a
    // rebuild, so collapse its slot to a point (renders as destroyed).
    if (parseInstanceEntityId(entityId)) this.setActorObjectVisible(entityId, false);
  };

  /** Collapses one instanced-static slot to a point so it renders invisibly. */
  private collapseInstance(assetId: string, placementIndex: number): void {
    const meshes = this.instanceMeshes.get(assetId);
    if (!meshes) return;
    for (const mesh of meshes) {
      mesh.setMatrixAt(placementIndex, COLLAPSED_INSTANCE_MATRIX);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private async playActorParticleEffect(entityId: string): Promise<void> {
    const entity = this.actorEntityById.get(entityId);
    if (!entity) return;
    const particle = readParticleEmitterComponent(entity);
    if (!particle || particle.enabled === false) return;
    const transform = readTransformComponent(entity);
    if (!transform) return;
    // Warm the definition so the synchronous play() below hits the cache; the
    // component's scale/tint/loop fields are the §8 instance overrides.
    await this.vfxSubsystem.warm(particle.effectId);
    this.vfxSubsystem.play(particle.effectId, { ...particle, position: transform.position });
  }

  private async applyAssetUvwMappings(): Promise<void> {
    if (!this.assetLoader || !this.layout) return;
    const manifest = await this.assetLoader.loadManifest();
    const assetIds = sceneModelAssetIds(this.layout);
    await Promise.all(
      assetIds.map(async (assetId) => {
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        const gltf = this.models.get(assetId);
        if (!asset || !gltf) return;
        applyAssetUvwMapping(gltf.scene, await loadAssetUvw(assetPath(asset)));
      }),
    );
  }

  private createInstancedModel(assetId: string, placements: LayoutPlacement[]): Group {
    const gltf = this.models.get(assetId);
    // A dangling layout placement (asset removed from the manifest) renders
    // nothing rather than aborting the whole scene build.
    if (!gltf) {
      console.warn(`[runtime] skipping placement for unloaded asset: ${assetId}`);
      return new Group();
    }
    const clonedMaterials: Material[] = [];
    // Placements with a material override and/or a reflection-capture probe envMap
    // are hidden in the instanced mesh and rendered as a separate clone (clone-
    // fallback), matching the editor so Play renders identically.
    const decisions = placements.map((placement, placementIndex) => {
      const meshPaint = this.meshPaintData.placements.filter(
        (entry) => entry.target.assetId === assetId && entry.target.placementIndex === placementIndex,
      );
      const materialSlot = placement.materialSlot;
      const materialSlots = materialSlot ? undefined : this.resolveAssetMaterialSlots(assetId);
      const overrideMaterial = materialSlot && this.materialCache.has(materialSlot)
          ? this.materialCache.get(materialSlot)
          : undefined;
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
      this.instanceOverrideObjects.set(overrideObjectKey(assetId, placementIndex), object);
    });
    this.instanceGroups.set(assetId, group);
    this.instanceMeshes.set(assetId, meshes);
    this.instanceProbeMaterials.set(assetId, clonedMaterials);
    return group;
  }

  private resolveAssetMaterialSlots(assetId: string): AssetMaterialSlotsDef | undefined {
    const slots = this.assetMaterialSlots.get(assetId);
    return hasAssignedMaterialSlots(slots) ? slots : undefined;
  }

  /**
   * A clone of the asset mesh used for placements excluded from the shared
   * InstancedMesh: those with a material override and/or a reflection-capture probe
   * envMap. The base material is the override (when set) else the GLTF's own; a
   * `bake` clones that base per-mesh and assigns the probe's PMREM envMap. Matches
   * the editor's authoring-time clone so Play renders identically.
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
      if (!isRenderableMesh(child)) return;
      const meshName = child.name || "__unnamed_mesh";
      const primitiveIndex = primitiveIndexByMeshName.get(meshName) ?? 0;
      primitiveIndexByMeshName.set(meshName, primitiveIndex + 1);
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

  private disposeInstanceProbeMaterials(): void {
    for (const materials of this.instanceProbeMaterials.values()) {
      for (const material of materials) material.dispose();
    }
    this.instanceProbeMaterials.clear();
  }

  /**
   * Bakes every visible Sphere Reflection Capture from the fully-built scene, then
   * assigns nearest-probe envMaps for Play (parity with the editor): instance groups
   * are rebuilt so probe-covered placements route to envMap clones (clone-fallback),
   * and characters/actors get an in-place material clone + envMap. Static, one-shot
   * at load — no recapture in Play. There are no editor aids in the runtime scene, so
   * the cubemap render needs no visibility juggling.
   */
  private buildRuntimeReflectionCaptures(): void {
    const captures = this.layout?.reflectionCaptures ?? [];
    this.reflectionCaptureBakes = captures.map(() => null);
    captures.forEach((actor, index) => {
      const item = this.reflectionCaptureItem(actor);
      if (item.hidden) return;
      this.reflectionCaptureBakes[index] = bakeSphereReflectionCapture(
        this.renderer,
        this.scene,
        item,
      );
    });
    if (this.eligibleProbeBakes().length === 0) return;
    this.applyRuntimeReflectionCaptureEnvMaps();
  }

  /** Re-routes instanced statics to probe envMap clones and assigns char/actor envMaps. */
  private applyRuntimeReflectionCaptureEnvMaps(): void {
    if (!this.layout) return;
    this.disposeInstanceProbeMaterials();
    this.instanceOverrideObjects.clear();
    for (const instance of this.layout.instances) {
      if (isMarkerAssetId(instance.assetId)) continue;
      const previous = this.instanceGroups.get(instance.assetId);
      if (previous) {
        disposeMeshPaintCloneGeometries(previous);
        this.scene.remove(previous);
      }
      this.scene.add(this.createInstancedModel(instance.assetId, instance.placements));
    }
    const globalEnv = this.scene.environment;
    const globalEnvIntensity = this.scene.environmentIntensity;
    this.characterObjects.forEach((object, index) => {
      const character = this.layout?.characters[index];
      if (!object || !character) return;
      const bake = character.hidden ? null : this.probeBakeForPoint(this.objectWorldCenter(object));
      applyProbeEnvMapToObject(object, bake, globalEnv, globalEnvIntensity);
    });
    for (const [entityId, object] of this.actorObjects) {
      const entity = this.actorEntityById.get(entityId);
      const bake = entity?.tags?.includes("hidden")
        ? null
        : this.probeBakeForPoint(this.objectWorldCenter(object));
      applyProbeEnvMapToObject(object, bake, globalEnv, globalEnvIntensity);
    }
  }

  /** Resolved settings + world transform for a reflection-plane layout actor. */
  private reflectionPlaneItem(actor: LayoutReflectionPlane): ReflectionPlaneRenderItem {
    return {
      ...resolveReflectionPlane(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      scale: readScale(actor),
    };
  }

  /**
   * Builds the Planar Reflection mirrors (`layout.reflectionPlanes`) for Play —
   * editor parity with {@link SceneApp.buildReflectionPlanes}. Each `Reflector`
   * self-updates via its own `onBeforeRender`, so the render loop never drives it.
   * Called after the Sphere Reflection Capture bake so the flat mirrors never leak
   * into the probe cubemaps (the editor hides them during its bake instead).
   */
  private buildRuntimeReflectionPlanes(): void {
    const planes = this.layout?.reflectionPlanes ?? [];
    planes.forEach((actor) => {
      const reflector = createReflectionPlaneObject(this.reflectionPlaneItem(actor));
      this.reflectionPlaneObjects.push(reflector);
      this.scene.add(reflector);
    });
  }

  /** Resolved settings + world transform for a reflective-surface layout actor. */
  private reflectiveSurfaceItem(actor: LayoutReflectiveSurface): ReflectiveSurfaceRenderItem {
    return {
      ...resolveReflectiveSurface(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      scale: readScale(actor),
    };
  }

  /** A fresh clone of a cached material (surfaces patch their material, so never share). */
  private reflectiveSurfaceMaterial(materialId: string | null): MeshStandardMaterial | null {
    if (!materialId) return null;
    const cached = this.materialCache.get(materialId);
    return cached instanceof MeshStandardMaterial ? (cached.clone() as MeshStandardMaterial) : null;
  }

  /**
   * Builds the Reflective Surface meshes (`layout.reflectiveSurfaces`) for Play —
   * editor parity with {@link SceneApp.buildReflectiveSurfaces}. Materials are
   * preloaded in {@link loadSceneMaterials}, so each surface clones its cached
   * material here. Built after the capture bake so the surfaces don't leak into the
   * probe cubemaps (mirrors the Planar Reflection ordering).
   */
  private buildRuntimeReflectiveSurfaces(): void {
    const surfaces = this.layout?.reflectiveSurfaces ?? [];
    surfaces.forEach((actor) => {
      const item = this.reflectiveSurfaceItem(actor);
      const surface = createReflectiveSurfaceObject(item, this.reflectiveSurfaceMaterial(item.material));
      this.reflectiveSurfaceObjects.push(surface);
      this.scene.add(surface);
    });
  }

  /** Resolved brush settings + world transform for a blocking-volume layout actor. */
  private blockingVolumeItem(actor: LayoutBlockingVolume): BlockingVolumeRenderItem {
    return {
      ...resolveBlockingVolume(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      scale: readScale(actor),
    };
  }

  /**
   * Builds the Blocking Volume grey-boxes (`layout.blockingVolumes`) for Play. Each
   * volume already blocks via its collider (built in the SceneDocument adapter);
   * here it only draws a solid grey-box when `renderInGame` is set — otherwise it
   * stays invisible (the true Unreal BlockingVolume). `hidden` always hides it.
   */
  private buildRuntimeBlockingVolumes(): void {
    const volumes = this.layout?.blockingVolumes ?? [];
    volumes.forEach((actor) => {
      const item = this.blockingVolumeItem(actor);
      const object = createRuntimeBlockingVolumeObject(item);
      object.visible = item.renderInGame && !item.hidden;
      this.blockingVolumeObjects.push(object);
      this.scene.add(object);
    });
  }

  /**
   * Prepares every authored spline for gameplay. Its sampled line is intentionally
   * limited to `?debug`: debug presentation remains editor-only by default and
   * normal Play pays no render-resource cost for spline authoring helpers.
   */
  private buildRuntimeSplines(): void {
    this.splineRegistry = createSplineRegistry(this.layout?.splines);
    this.aiSubsystem.configure({ splineRegistry: this.splineRegistry });
    for (const actor of this.layout?.splines ?? []) {
      const built = buildSplineInstanceGeneratorGroup({
        actor,
        mode: "runtime",
        models: this.models,
        castShadow: this.staticObjectsCastShadow(),
        receiveShadow: this.staticObjectsReceiveShadow(),
        applyMaterialSlots: (assetId, group) => {
          const slots = this.resolveAssetMaterialSlots(assetId);
          if (slots) applyMaterialSlotOverrides(group, slots, (materialId) => this.materialCache.get(materialId));
        },
      });
      if (!built) continue;
      if (built.missingAssetIds.length > 0) {
        console.warn("[runtime] spline generator mesh asset missing; skipping:", built.missingAssetIds);
      }
      if (!built.group) continue;
      this.splineGeneratedGroups.push(built.group);
      this.scene.add(built.group);
      this.splineColliderEntities.push(...this.splineDeformColliderEntities(actor, built.group));
    }
    if (!this.debug) return;
    for (const entry of this.splineRegistry.all()) {
      const object = createSplineObject(entry.actor);
      this.splineDebugObjects.push(object);
      this.scene.add(object);
    }
  }

  /** Emits one static trimesh body per opted-in deform generator, combining its segment chunks. */
  private splineDeformColliderEntities(actor: LayoutSplineActor, generated: Group): Entity[] {
    const result: Entity[] = [];
    for (const definition of normalizeSplineGenerators(actor.generators)) {
      if (definition.type !== "deformMesh") continue;
      const generator = resolveSplineDeformMeshGenerator(definition);
      if (!generator.enabled || !generator.runtimeEnabled || !generator.collisionEnabled) continue;
      const chunks = generated.children.filter((child) => child instanceof Group && child.userData.splineGeneratorId === generator.id) as Group[];
      const vertices: Vec3[] = [];
      const indices: number[] = [];
      for (const chunk of chunks) {
        const primitive = splineDeformMeshColliderPrimitive(chunk);
        if (!primitive) continue;
        const offset = vertices.length;
        vertices.push(...primitive.vertices);
        indices.push(...primitive.indices.map((entry) => entry + offset));
      }
      if (indices.length < 3) continue;
      const min: Vec3 = [Infinity, Infinity, Infinity];
      const max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const vertex of vertices) {
        min[0] = Math.min(min[0], vertex[0]); min[1] = Math.min(min[1], vertex[1]); min[2] = Math.min(min[2], vertex[2]);
        max[0] = Math.max(max[0], vertex[0]); max[1] = Math.max(max[1], vertex[1]); max[2] = Math.max(max[2], vertex[2]);
      }
      const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
      const collider: ColliderComponent = {
        shape: "box",
        size,
        isStatic: true,
        isSensor: false,
        primitives: [{ shape: "trimesh", size, vertices, indices }],
      };
      result.push({
        id: `spline:${actor.id}:${generator.id}`,
        name: `${actor.name} ${generator.id} Collider`,
        components: {
          [TRANSFORM_COMPONENT]: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          [COLLIDER_COMPONENT]: collider as unknown as EntityComponentData,
        },
      });
    }
    return result;
  }

  /** Resolved settings + world transform + sidecar data for a landscape layout actor. */
  private landscapeItem(
    actor: LayoutLandscape,
    data: ForgeLandscapeData,
    layerTextures?: LandscapeLayerTexture[],
  ): LandscapeRenderItem {
    const item: LandscapeRenderItem = {
      ...resolveLandscape(actor),
      position: [...actor.position],
      rotation: readRotation(actor),
      data,
    };
    if (layerTextures) {
      item.layerTextures = layerTextures;
      item.layerColors = Object.fromEntries(layerTextures.map((layer) => [layer.id, layer.color]));
    }
    return item;
  }

  /**
   * Resolves the per-layer splat inputs (base color + tiling texture) for a
   * landscape's material-assigned paint layers, aligned to `data.layers` order
   * (Play parity with the editor). Layers without a material — or whose material
   * can't be read — carry a null texture and the preset color.
   */
  private async resolveRuntimeLandscapeLayerTextures(
    data: ForgeLandscapeData,
  ): Promise<LandscapeLayerTexture[]> {
    const manifest = this.assetManifest;
    const worldSize = (data.size.verticesX - 1) * data.size.spacing;
    const tiling = Math.min(128, Math.max(1, Math.round(worldSize / 8)));
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const presetById = new Map(LANDSCAPE_DEFAULT_LAYERS.map((preset) => [preset.id as string, preset]));
    return Promise.all(
      data.layers.map(async (layer) => {
        const presetColor = presetById.get(layer.id)?.color ?? LANDSCAPE_DEFAULT_LAYERS[0]!.color;
        const resolved =
          manifest && layer.material
            ? await loadForgeMaterialLayer(manifest, layer.material, this.textureLoader, {
                maxAnisotropy,
              })
            : null;
        if (resolved?.texture) this.landscapeLayerTextures.push(resolved.texture);
        return {
          id: layer.id,
          texture: resolved?.texture ?? null,
          color: resolved?.baseColor ?? presetColor,
          tiling,
        } satisfies LandscapeLayerTexture;
      }),
    );
  }

  private landscapeColliderEntity(actor: LayoutLandscape, data: ForgeLandscapeData): Entity | null {
    const item = this.landscapeItem(actor, data);
    if (!item.collision) return null;
    const primitive = createLandscapeColliderPrimitive(data);
    const collider: ColliderComponent = {
      shape: "box",
      size: [...primitive.size] as [number, number, number],
      isStatic: true,
      isSensor: false,
      navigationRole: "walkable",
      primitives: [primitive],
    };
    if (primitive.center && !isZeroVec3(primitive.center)) {
      collider.center = [...primitive.center] as [number, number, number];
    }
    return {
      id: `landscape:${actor.id}`,
      name: `${item.name} Collider`,
      components: {
        [TRANSFORM_COMPONENT]: {
          position: [...actor.position] as [number, number, number],
          rotation: [...item.rotation] as [number, number, number],
          scale: [1, 1, 1],
        },
        [COLLIDER_COMPONENT]: collider as unknown as EntityComponentData,
      },
    };
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

  /**
   * Builds the Landscape terrain meshes (`layout.landscapes`) for Play. Collidable
   * landscapes also emit a hidden static trimesh entity so Play physics, character
   * movement and debug collision wires rebuild from the latest saved sidecar.
   */
  private async buildRuntimeLandscapes(): Promise<void> {
    const landscapes = this.layout?.landscapes ?? [];
    const datas: ForgeLandscapeData[] = [];
    for (const actor of landscapes) {
      const data = await this.fetchLandscapeData(actor.dataRef);
      datas.push(data);
      const layerTextures = await this.resolveRuntimeLandscapeLayerTextures(data);
      const object = createLandscapeObject(this.landscapeItem(actor, data, layerTextures));
      this.landscapeObjects.push(object);
      this.scene.add(object);
      const colliderEntity = this.landscapeColliderEntity(actor, data);
      if (colliderEntity) {
        this.landscapeColliderEntities.push(colliderEntity);
        this.landscapeColliderObjects.set(colliderEntity.id, object);
        this.addColliderDebugWire(colliderEntity);
      }
    }
    await this.buildRuntimeLandscapeSplineMeshes(datas);
  }

  /**
   * Loads the level foliage sidecar + its referenced Foliage Types, ensures their
   * static-mesh assets are resident, and builds the InstancedMesh batches for Play.
   * Foliage is decorative-only in Faz 1 (no collision emitted), so this runs purely
   * for the visual and never touches the physics scene document.
   */
  private async buildRuntimeFoliage(): Promise<void> {
    if (!this.activeLevelPath) return;
    const data = await loadFoliageData(this.activeLevelPath);
    if (data.groups.length === 0 && (data.landscapeRules?.length ?? 0) === 0) return;
    const manifest =
      this.assetManifest ?? (this.assetLoader ? await this.assetLoader.loadManifest() : null);
    if (!manifest) return;
    const types = await loadFoliageTypesForData(data, manifest);
    if (types.size === 0) return;
    const meshIds = new Set<string>();
    for (const type of types.values()) if (type.meshAssetId) meshIds.add(type.meshAssetId);
    const missingModels = [...meshIds].filter((assetId) => !this.models.has(assetId));
    if (missingModels.length > 0 && this.assetLoader) {
      const loaded = await this.assetLoader.loadModels(missingModels);
      for (const [id, model] of loaded) this.models.set(id, model);
    }
    const binding = new FoliageRenderBinding();
    this.scene.add(binding.root);
    const generated: LayoutFoliageGroup[] = [];
    for (const rule of data.landscapeRules ?? []) {
      const actor = (this.layout?.landscapes ?? []).find((entry) => entry.id === rule.landscapeId);
      const type = types.get(rule.foliageTypeId);
      if (!actor || !type) continue;
      const landscape = await this.fetchLandscapeData(actor.dataRef);
      const instances = generateLandscapeFoliageSamples(rule, {
        id: actor.id,
        position: [...actor.position],
        rotation: readRotation(actor),
        data: landscape,
      }).map((sample) =>
        foliageInstanceFromRoll(type, rollFoliageInstance(type, sample, makeFoliageRng(sample.seed))),
      );
      if (instances.length > 0) {
        generated.push({
          id: `generated-${rule.id}`,
          foliageTypeId: rule.foliageTypeId,
          target: { kind: "landscape", id: rule.landscapeId },
          instances,
        });
      }
    }
    const renderData: LayoutFoliageData = { schema: 1, type: "foliage", groups: [...data.groups, ...generated] };
    binding.rebuild(renderData, {
      getType: (id) => types.get(id) ?? null,
      getModel: (assetId) => this.models.get(assetId) ?? null,
      applyMaterialSlots: (assetId, group) => {
        const slots = this.assetMaterialSlots.get(assetId);
        if (slots) applyMaterialSlotOverrides(group, slots, (materialId) => this.materialCache.get(materialId));
      },
    });
    this.foliageBinding = binding;
  }

  /** Loads spline mesh assets (Faz 6) and parents their instanced groups under each landscape. */
  private async buildRuntimeLandscapeSplineMeshes(datas: readonly ForgeLandscapeData[]): Promise<void> {
    const splineAssetIds = new Set<string>();
    for (const data of datas) {
      for (const assetId of landscapeSplineMeshAssetIds(data)) splineAssetIds.add(assetId);
    }
    if (splineAssetIds.size === 0) return;
    const missingModels = [...splineAssetIds].filter((assetId) => !this.models.has(assetId));
    if (missingModels.length > 0 && this.assetLoader) {
      const loaded = await this.assetLoader.loadModels(missingModels);
      for (const [id, model] of loaded) this.models.set(id, model);
    }
    // Spline assets aren't in `layout.instances`, so `loadSceneMaterials` never
    // loaded their default material slots. An asset whose look comes from a slot
    // assignment (e.g. an asphalt road with a plain-white GLTF material) would
    // otherwise render untextured. Load slots + their materials before building.
    const manifest = this.assetManifest ?? (this.assetLoader ? await this.assetLoader.loadManifest() : null);
    if (manifest) {
      await Promise.all(
        [...splineAssetIds].map(async (assetId) => {
          if (this.assetMaterialSlots.has(assetId)) return;
          const asset = manifest.assets.find((entry) => entry.id === assetId);
          if (!asset) return;
          const slots = await loadAssetMaterialSlots(assetPath(asset));
          if (!hasAssignedMaterialSlots(slots)) return;
          this.assetMaterialSlots.set(assetId, slots);
          await Promise.all(
            assignedMaterialSlotIds(slots).map((id) => this.ensureMaterialLoaded(id).catch(() => undefined)),
          );
        }),
      );
    }
    datas.forEach((data, index) => {
      const object = this.landscapeObjects[index];
      if (!object) return;
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
      if (built) object.add(built.group);
    });
  }

  /**
   * Loads per-asset default material slots (`*.materials.json`) and every material
   * a placement references, caching them before instances build. Individual load
   * failures are swallowed so one bad material can't abort scene construction.
   */
  private async loadSceneMaterials(): Promise<void> {
    if (!this.assetLoader || !this.layout) return;
    const manifest = await this.assetLoader.loadManifest();
    this.assetManifest = manifest;
    const assetIds = sceneModelAssetIds(this.layout);
    await Promise.all(
      assetIds.map(async (assetId) => {
        const asset = manifest.assets.find((entry) => entry.id === assetId);
        if (!asset) return;
        const slots = await loadAssetMaterialSlots(assetPath(asset));
        if (hasAssignedMaterialSlots(slots)) this.assetMaterialSlots.set(assetId, slots);
      }),
    );
    const materialIds = new Set<string>();
    for (const instance of this.layout.instances) {
      const defaultSlots = this.resolveAssetMaterialSlots(instance.assetId);
      for (const id of assignedMaterialSlotIds(defaultSlots)) materialIds.add(id);
      for (const placement of instance.placements) {
        if (placement.materialSlot) materialIds.add(placement.materialSlot);
      }
    }
    for (const surface of this.layout.reflectiveSurfaces ?? []) {
      if (surface.material) materialIds.add(surface.material);
    }
    await Promise.all(
      [...materialIds].map((id) => this.ensureMaterialLoaded(id).catch(() => undefined)),
    );
  }

  /** Loads + caches a material override asset by id (deduped; never rejects callers via the cache). */
  private ensureMaterialLoaded(materialId: string): Promise<Material | undefined> {
    const cached = this.materialCache.get(materialId);
    if (cached) return Promise.resolve(cached);
    const pending = this.materialLoads.get(materialId);
    if (pending) return pending;
    const manifest = this.assetManifest;
    if (!manifest) return Promise.resolve(undefined);
    const load = loadForgeMaterial(manifest, materialId, this.textureLoader, {
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
    })
      .then((material) => {
        this.materialCache.set(materialId, material);
        this.materialLoads.delete(materialId);
        return material;
      })
      .catch((error) => {
        this.materialLoads.delete(materialId);
        console.warn(
          "[runtime] material load failed:",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      });
    this.materialLoads.set(materialId, load);
    return load;
  }

  private syncInstanceTransform(
    assetId: string,
    placementIndex: number,
    transform: TransformComponent,
  ): void {
    // A collected collectible stays hidden: keep its slot collapsed instead of
    // re-writing the authored transform (which would make the pickup reappear).
    if (this.collectedInstances.has(overrideObjectKey(assetId, placementIndex))) {
      this.collapseInstance(assetId, placementIndex);
      return;
    }
    const transformMatrix = composeTransformMatrix(
      transform.position,
      transform.rotation,
      transform.scale,
    );
    // Overridden placements render as a separate clone, not the instanced slot
    // (which stays hidden). Move that clone instead, or the base mesh would
    // reappear and the override would stay frozen at its authored pose.
    const overrideObject = this.instanceOverrideObjects.get(
      overrideObjectKey(assetId, placementIndex),
    );
    if (overrideObject) {
      overrideObject.matrix.copy(transformMatrix);
      overrideObject.matrixWorldNeedsUpdate = true;
      return;
    }
    const meshes = this.instanceMeshes.get(assetId);
    if (!meshes) return;
    for (const mesh of meshes) {
      const sourceMatrix =
        mesh.userData.sourceMatrix instanceof Matrix4
          ? mesh.userData.sourceMatrix
          : new Matrix4();
      mesh.setMatrixAt(placementIndex, transformMatrix.clone().multiply(sourceMatrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  private addCharacter(gltf: GLTF | undefined, placement: LayoutCharacter): void {
    if (!gltf) return;
    const index = this.characterObjects.length;
    const character = buildSceneCharacterObject(gltf, placement, index);
    character.userData.characterIndex = index;
    this.scene.add(character);
    this.characterObjects.push(character);
    // Offer the character to the active Game Mode; possession + animation are the
    // mode's responsibility (the default camera mode possesses nothing). The
    // single authored clip is attached for unpossessed characters in startGameMode.
    this.characterRefs.push({
      index,
      entityId: characterEntityId(index),
      object: character,
      gltf,
      placement,
    });
  }

  private addLight(actor: LayoutLightActor): void {
    const index = this.lightObjects.length;
    // Runtime lights illuminate but show no editor gizmo (icon billboard +
    // reach wireframe) — those are authoring-only helpers.
    const record = buildSceneLightObject(actor, index, { gizmo: false });
    tagSceneLightRecordIndex(record, index);
    this.scene.add(record.root);
    if (record.target) this.scene.add(record.target);
    this.lightObjects.push(record);
    if (isSceneSunLight(actor, this.sun)) {
      this.sun = record.light as DirectionalLight;
    }
  }

  private ensureDefaultLights(): void {
    ensureDefaultSceneLights(this.layout);
  }

  private fitSunShadowToScene(): void {
    fitDirectionalShadowToBounds(
      this.sun,
      this.getRoomBounds(),
      this.qualitySettings.shadowDistanceScale,
    );
  }

  /**
   * Applies the active profile's shadow knobs (Faz 2): the master toggle
   * (`renderer.shadowMap.enabled`), the shadow-map resolution on every
   * shadow-casting light (disposing the old map so three rebuilds it at the new
   * size), and the coverage scale via {@link fitSunShadowToScene}. On Ultra
   * (enabled, 2048, scale 1) this is a no-op, so default runtime shadows are
   * unchanged.
   */
  private applyRuntimeShadowQuality(): void {
    const quality = this.qualitySettings;
    this.renderer.shadowMap.enabled = quality.shadowsEnabled;
    for (const record of this.lightObjects) {
      const light = record.light;
      if (!light.castShadow) continue;
      if (light.shadow.mapSize.width !== quality.shadowMapSize) {
        light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
        // Drop the cached render target so three regenerates it at the new size.
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    }
    this.fitSunShadowToScene();
  }

  private getRoomBounds(): Box3 | null {
    return computeSceneRoomBounds(this.layout, this.localBounds);
  }

  private applyBackgroundAndAmbient(): void {
    this.ambientLight = applySceneBackgroundAndAmbient({
      scene: this.scene,
      ambientLight: this.ambientLight,
      settings: resolveSceneWorldSettings(this.layout),
    });
  }

  /**
   * Renders the Sky Atmosphere dome at runtime. Like the editor, the directional
   * Sun light is the source of truth for the sun: its (persisted) rotation places
   * the sun disc. The runtime only builds the backdrop + tone mapping.
   */
  private applyRuntimeSky(): void {
    const actor = this.layout?.skyAtmosphere ?? null;
    if (!actor) {
      applySkyToneMapping(this.renderer, null);
      return;
    }
    const resolved = resolveSkyAtmosphere(actor);
    if (!this.skyObject) {
      this.skyObject = createSkyObject();
      this.scene.add(this.skyObject);
    }
    applySkyUniforms(this.skyObject, resolved);
    const sun = this.sunLightActor();
    if (sun) applySkySunDirection(this.skyObject, sunDirectionFromLightRotation(readRotation(sun)));
    followCameraWithSky(this.skyObject, this.camera);
    applySkyToneMapping(this.renderer, resolved);
  }

  /**
   * Applies the Exponential Height Fog to `scene.fog` at runtime (distance-based,
   * Faz 1). Mirrors the editor's applyHeightFog so Play looks identical.
   */
  private applyRuntimeFog(): void {
    const actor = this.layout?.heightFog ?? null;
    applySceneFog(this.scene, actor ? resolveHeightFog(actor) : null);
  }

  /**
   * Builds the static Cloud Layer dome at runtime (mirrors the editor's
   * applyCloudLayer) so Play shows the same procedural clouds. Absent/hidden
   * clouds leave the scene without the dome.
   */
  private applyRuntimeClouds(): void {
    const actor = this.layout?.cloudLayer ?? null;
    if (!actor) return;
    const resolved = resolveCloudLayer(actor);
    if (!this.cloudObject) {
      this.cloudObject = createCloudObject();
      this.scene.add(this.cloudObject);
    }
    applyCloudUniforms(this.cloudObject, resolved);
    followCameraWithClouds(this.cloudObject, this.camera);
  }

  /**
   * Mirrors the editor's Sky Atmosphere-owned Sky Light Capture in Play: capture
   * the authored sky once and use it as the global PBR environment/ambient bounce
   * wherever no local Sphere Reflection Capture applies.
   */
  private applyRuntimeReflection(recapture = false): void {
    const skyActor = this.layout?.skyAtmosphere ?? null;
    const sky = skyActor ? resolveSkyAtmosphere(skyActor) : null;
    if (!sky || sky.hidden) {
      this.disposeReflectionTarget();
      applyReflectionEnvironment(this.scene, null, null);
      return;
    }

    if (recapture || !this.reflectionTarget) {
      this.disposeReflectionTarget();
      const sun = this.sunLightActor();
      const sunDirection = sun
        ? sunDirectionFromLightRotation(readRotation(sun))
        : new Vector3(0, 1, 0);
      this.reflectionTarget = captureSkyEnvironment(this.renderer, sky, sunDirection);
    }

    applyReflectionEnvironment(this.scene, this.reflectionTarget, resolveReflection(sky.skyLightCapture));
  }

  private disposeReflectionTarget(): void {
    if (!this.reflectionTarget) return;
    this.reflectionTarget.dispose();
    this.reflectionTarget = null;
  }

  /** Applies global Post Process renderer properties after Sky tone mapping. */
  private applyRuntimePostProcess(): void {
    const actor = this.layout?.postProcess ?? null;
    // Gate authored post-process through the active quality profile before it
    // reaches the renderer: quality only turns effects OFF (Principle #2), so a
    // null (no authored actor) stays null — quality never enables anything.
    const authored = actor ? resolvePostProcess(actor) : null;
    const resolved = authored ? applyQualityToPostProcess(authored, this.qualitySettings) : null;
    applyPostProcessToneMapping(this.renderer, resolved);
    this.applyRuntimeSkyPostProcessExposure(resolved);
    if (!hasPostProcessEffectPasses(resolved)) {
      this.postProcessPipeline?.dispose();
      this.postProcessPipeline = null;
      return;
    }
    this.postProcessPipeline ??= new PostProcessPipeline({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    this.postProcessPipeline.setEffectPasses(
      createPostProcessEffectPasses(resolved, {
        scene: this.scene,
        camera: this.camera,
        width: window.innerWidth,
        height: window.innerHeight,
        bloomResolutionScale: this.qualitySettings.bloomResolutionScale,
      }),
    );
    this.postProcessPipeline.setAntialiasPass(
      createPostProcessAntialiasPass(resolved, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }

  private applyRuntimeSkyPostProcessExposure(post: ResolvedPostProcess | null): void {
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

  /** The scene's Sun light actor (preferred id, else the first directional light). */
  private sunLightActor(): LayoutLightActor | null {
    const lights = this.layout?.lights;
    if (!lights) return null;
    return (
      lights.find((light) => light.type === "directional" && light.id === DEFAULT_SCENE_SUN_ID) ??
      lights.find((light) => light.type === "directional") ??
      null
    );
  }

  private staticObjectsCastShadow(): boolean {
    return resolveSceneWorldSettings(this.layout).staticObjectsCastShadow;
  }

  private staticObjectsReceiveShadow(): boolean {
    return resolveSceneWorldSettings(this.layout).staticObjectsReceiveShadow;
  }

  private handleResize = (): void => {
    const resetView = this.sceneShell.resize({
      width: window.innerWidth,
      height: window.innerHeight,
      viewTouched: this.cameraViewTouched,
    });
    if (resetView) this.cameraViewTouched = false;
    this.postProcessPipeline?.setSize(window.innerWidth, window.innerHeight);
  };

  /**
   * On regaining focus, rAF resumes after a long gap: discard the frame-time
   * windows and skip the next (catch-up) sample so a tab switch is not counted
   * as a spike (plan §3.1).
   */
  private handleVisibilityChange = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      this.frameMetrics.reset();
      this.skipFrameMetricSample = true;
    }
  };
}

function overrideObjectKey(assetId: string, placementIndex: number): string {
  return `${assetId}:${placementIndex}`;
}

/**
 * Disposes the geometry + materials of every mesh under a scene-owned object
 * (sky/cloud domes, synthetic `shape:` primitives). Only call on objects whose
 * resources are NOT shared through the loader cache — cloned/instanced cached
 * GLTFs must not be disposed here (their geometry is reused across levels).
 */
function disposeSceneMeshResources(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material?.dispose();
    }
  });
}

function isZeroVec3(vec: readonly [number, number, number]): boolean {
  return Math.abs(vec[0]) <= 1e-9 && Math.abs(vec[1]) <= 1e-9 && Math.abs(vec[2]) <= 1e-9;
}

function colliderTrimeshWireGeometry(primitives: readonly ColliderPrimitive[] | undefined): BufferGeometry {
  const positions: number[] = [];
  if (!primitives) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return geometry;
  }
  const pushEdge = (
    a: readonly [number, number, number] | undefined,
    b: readonly [number, number, number] | undefined,
  ): void => {
    if (!a || !b) return;
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  };
  for (const primitive of primitives) {
    if (
      primitive.shape !== "trimesh" ||
      !primitive.vertices ||
      !primitive.indices ||
      primitive.vertices.length < 3 ||
      primitive.indices.length < 3
    ) {
      continue;
    }
    for (let index = 0; index + 2 < primitive.indices.length; index += 3) {
      const a = primitive.vertices[primitive.indices[index]!];
      const b = primitive.vertices[primitive.indices[index + 1]!];
      const c = primitive.vertices[primitive.indices[index + 2]!];
      pushEdge(a, b);
      pushEdge(b, c);
      pushEdge(c, a);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Line-segment wireframe for a collider's debug overlay, sized to its baked
 * world half-extents. A capsule gets a true capsule outline (rings + side
 * profiles, feet-to-head) matching the Actor Script editor preview; every other
 * shape gets its axis-aligned box edges.
 */
function colliderWireGeometry(
  shape: ColliderShape,
  halfExtents: readonly [number, number, number],
): BufferGeometry {
  if (shape === "capsule") return capsuleWireGeometry(halfExtents);
  return new EdgesGeometry(
    new BoxGeometry(
      Math.max(halfExtents[0] * 2, 1e-4),
      Math.max(halfExtents[1] * 2, 1e-4),
      Math.max(halfExtents[2] * 2, 1e-4),
    ),
  );
}

function capsuleWireGeometry(halfExtents: readonly [number, number, number]): BufferGeometry {
  const radius = Math.max(halfExtents[0], halfExtents[2], 1e-4);
  const halfHeight = Math.max(halfExtents[1], radius);
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
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

function pushCapsuleRing(positions: number[], y: number, radius: number): void {
  const segments = 48;
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    positions.push(
      Math.cos(a0) * radius, y, Math.sin(a0) * radius,
      Math.cos(a1) * radius, y, Math.sin(a1) * radius,
    );
  }
}

function parseCharacterEntityIndex(entityId: string): number | null {
  if (!entityId.startsWith("character:")) return null;
  const index = Number(entityId.slice("character:".length));
  return Number.isInteger(index) ? index : null;
}

/** Zero-scale matrix that collapses an InstancedMesh slot to a point (invisible). */
const COLLAPSED_INSTANCE_MATRIX = new Matrix4().makeScale(0, 0, 0);

/** Frees per-placement clone geometry while leaving cached GLTF geometry untouched. */
function disposeMeshPaintCloneGeometries(root: Object3D): void {
  root.traverse((child) => {
    if (!isRenderableMesh(child) || child.geometry.userData.forgeMeshPaintClone !== true) return;
    child.geometry.dispose();
  });
}

function parseInstanceEntityId(entityId: string): { assetId: string; placementIndex: number } | null {
  if (!entityId.startsWith("instance:")) return null;
  const separator = entityId.lastIndexOf(":");
  if (separator <= "instance:".length) return null;
  const index = Number(entityId.slice(separator + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return {
    assetId: decodeURIComponent(entityId.slice("instance:".length, separator)),
    placementIndex: index,
  };
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function distance3d(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function samePoint3d(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return distance3d(a, b) <= 1e-6;
}

/**
 * Keeps navigation authoritative while smoothing clear spline patrol stretches.
 * A tangent pointing backward or sideways is ignored so this cannot pull an
 * agent through a nav corner or obstacle.
 */
function blendAiPathDirection(
  pathDirection: readonly [number, number],
  preferredDirection: Vec3 | undefined,
): [number, number] {
  const pathLength = Math.hypot(pathDirection[0], pathDirection[1]);
  if (!(pathLength > 1e-6) || !preferredDirection) return [pathDirection[0], pathDirection[1]];
  const tangentLength = Math.hypot(preferredDirection[0], preferredDirection[2]);
  if (!(tangentLength > 1e-6)) return [pathDirection[0], pathDirection[1]];
  const pathX = pathDirection[0] / pathLength;
  const pathZ = pathDirection[1] / pathLength;
  const tangentX = preferredDirection[0] / tangentLength;
  const tangentZ = preferredDirection[2] / tangentLength;
  const alignment = pathX * tangentX + pathZ * tangentZ;
  if (!(alignment > 0)) return [pathX, pathZ];
  const weight = AI_SPLINE_TANGENT_STEERING_WEIGHT * alignment;
  const blendedX = pathX * (1 - weight) + tangentX * weight;
  const blendedZ = pathZ * (1 - weight) + tangentZ * weight;
  const blendedLength = Math.hypot(blendedX, blendedZ);
  return blendedLength > 1e-6 ? [blendedX / blendedLength, blendedZ / blendedLength] : [pathX, pathZ];
}

/** Human-readable label for a quality level (settings-screen status text). */
function qualityLevelLabel(level: QualityLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/** Narrows a level to a concrete (non-custom) profile for calibration stepping. */
function isConcreteQualityLevel(level: QualityLevel): level is ConcreteQualityLevel {
  return level !== "custom";
}

function createRuntimeUserSettingsStore(): UserSettingsStore | null {
  try {
    return new UserSettingsStore({ storage: createLocalStorageAdapter(window.localStorage) });
  } catch {
    return null;
  }
}

function createRuntimeSaveGameStore(gameId: string): SaveGameStore<GameSaveState> | null {
  try {
    return new SaveGameStore<GameSaveState>({
      gameId,
      schema: 1,
      storage: createLocalStorageAdapter(window.localStorage),
    });
  } catch {
    return null;
  }
}
