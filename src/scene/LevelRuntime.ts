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

export interface LevelRuntimeOptions {
  readonly mode: LevelRuntimeMode;
  readonly environmentRender: LevelRuntimeEnvironmentRenderHandlers;
  readonly reflectionObjects: LevelRuntimeReflectionObjectHandlers;
}

export class LevelRuntime {
  readonly mode: LevelRuntimeMode;
  private readonly environmentRender: LevelRuntimeEnvironmentRenderHandlers;
  private readonly reflectionObjects: LevelRuntimeReflectionObjectHandlers;

  constructor(options: LevelRuntimeOptions) {
    this.mode = options.mode;
    this.environmentRender = options.environmentRender;
    this.reflectionObjects = options.reflectionObjects;
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
}
