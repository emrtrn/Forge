/**
 * Canonical level-content orchestration.
 *
 * Phase C moves capability groups here one at a time. Shell-specific rendering
 * implementations remain injected handlers until the group itself can be
 * consolidated without changing editor authoring behavior.
 */
export type LevelRuntimeMode = "editor" | "runtime";

export const LEVEL_RUNTIME_ENVIRONMENT_RENDER_STEPS = [
  "sun-shadow",
  "background-ambient",
  "sky",
  "reflection-environment",
  "post-process",
  "fog",
  "clouds",
] as const;

export const LEVEL_RUNTIME_REFLECTION_OBJECT_STEPS = [
  "reflection-captures",
  "reflection-planes",
  "reflective-surfaces",
] as const;

export const LEVEL_RUNTIME_WORLD_GEOMETRY_STEPS = [
  "blocking-volumes",
  "splines",
  "landscapes",
  "foliage",
] as const;

export const LEVEL_RUNTIME_CORE_CONTENT_STEPS = [
  "models",
  "shape-models",
  "asset-uvw",
  "material-slots",
  "scene-entities",
  "actor-instances",
] as const;

export const LEVEL_RUNTIME_BUILD_STEPS = [
  ...LEVEL_RUNTIME_CORE_CONTENT_STEPS,
  ...LEVEL_RUNTIME_ENVIRONMENT_RENDER_STEPS,
  ...LEVEL_RUNTIME_REFLECTION_OBJECT_STEPS,
  ...LEVEL_RUNTIME_WORLD_GEOMETRY_STEPS,
] as const;

export interface LevelRuntimeEnvironmentRenderHandlers {
  readonly fitSunShadow: () => void;
  readonly applyBackgroundAndAmbient: () => void;
  readonly applySky: () => void;
  readonly applyReflectionEnvironment: () => void;
  readonly applyPostProcess: () => void;
  readonly applyFog: () => void;
  readonly applyClouds: () => void;
}

export interface LevelRuntimeReflectionObjectHandlers {
  readonly buildReflectionCaptures: () => void;
  readonly buildReflectionPlanes: () => void;
  readonly buildReflectiveSurfaces: () => void;
}

export interface LevelRuntimeWorldGeometryHandlers {
  readonly buildBlockingVolumes: () => void;
  readonly buildSplines: () => void;
  readonly buildLandscapes: () => Promise<void>;
  readonly buildFoliage: () => Promise<void>;
}

export interface LevelRuntimeCoreContentHandlers {
  readonly loadModels: () => Promise<void>;
  readonly registerShapeModels: () => void;
  readonly applyAssetUvwMappings: () => Promise<void>;
  readonly applyMaterialSlots: () => Promise<void>;
  readonly beforeBuildSceneEntities: () => Promise<void>;
  readonly buildSceneEntities: () => void;
  readonly buildActorInstances: () => Promise<void>;
}

export interface LevelRuntimeOptions {
  readonly mode: LevelRuntimeMode;
  readonly environmentRender: LevelRuntimeEnvironmentRenderHandlers;
  readonly reflectionObjects: LevelRuntimeReflectionObjectHandlers;
  readonly worldGeometry: LevelRuntimeWorldGeometryHandlers;
  readonly coreContent: LevelRuntimeCoreContentHandlers;
}

export class LevelRuntime {
  readonly mode: LevelRuntimeMode;
  private readonly environmentRender: LevelRuntimeEnvironmentRenderHandlers;
  private readonly reflectionObjects: LevelRuntimeReflectionObjectHandlers;
  private readonly worldGeometry: LevelRuntimeWorldGeometryHandlers;
  private readonly coreContent: LevelRuntimeCoreContentHandlers;

  constructor(options: LevelRuntimeOptions) {
    this.mode = options.mode;
    this.environmentRender = options.environmentRender;
    this.reflectionObjects = options.reflectionObjects;
    this.worldGeometry = options.worldGeometry;
    this.coreContent = options.coreContent;
  }

  /**
   * The first canonical LevelRuntime group. Reflection environment must be
   * ready before post/fog/cloud consumers evaluate their final render state.
   */
  buildEnvironmentRender(): void {
    const handlers = this.environmentRender;
    handlers.fitSunShadow();
    handlers.applyBackgroundAndAmbient();
    handlers.applySky();
    handlers.applyReflectionEnvironment();
    handlers.applyPostProcess();
    handlers.applyFog();
    handlers.applyClouds();
  }

  /**
   * Bake cubemap probes before adding planar or mirror surfaces. Those surfaces
   * must not feed back into the probe environment map they later consume.
   */
  buildReflectionObjects(): void {
    const handlers = this.reflectionObjects;
    handlers.buildReflectionCaptures();
    handlers.buildReflectionPlanes();
    handlers.buildReflectiveSurfaces();
  }

  /** Builds authored world geometry after render environment and reflections exist. */
  async buildWorldGeometry(): Promise<void> {
    const handlers = this.worldGeometry;
    handlers.buildBlockingVolumes();
    handlers.buildSplines();
    await handlers.buildLandscapes();
    await handlers.buildFoliage();
  }

  /** Loads all authored models and material state before building scene objects. */
  async buildCoreContent(): Promise<void> {
    const handlers = this.coreContent;
    await handlers.loadModels();
    handlers.registerShapeModels();
    await handlers.applyAssetUvwMappings();
    await handlers.applyMaterialSlots();
    await handlers.beforeBuildSceneEntities();
    handlers.buildSceneEntities();
    await handlers.buildActorInstances();
  }

  /** Builds every shared authored level-content group in canonical order. */
  async build(): Promise<void> {
    await this.buildCoreContent();
    this.buildEnvironmentRender();
    this.buildReflectionObjects();
    await this.buildWorldGeometry();
  }
}
