import assert from "node:assert/strict";
import {
  LEVEL_RUNTIME_ENVIRONMENT_RENDER_STEPS,
  LEVEL_RUNTIME_BUILD_STEPS,
  LEVEL_RUNTIME_CORE_CONTENT_STEPS,
  LEVEL_RUNTIME_REFLECTION_OBJECT_STEPS,
  LEVEL_RUNTIME_WORLD_GEOMETRY_STEPS,
  LevelRuntime,
  type LevelRuntimeEnvironmentRenderHandlers,
  type LevelRuntimeCoreContentHandlers,
  type LevelRuntimeReflectionObjectHandlers,
  type LevelRuntimeWorldGeometryHandlers,
} from "../../src/scene/LevelRuntime";

type Check = (label: string, fn: () => void) => void;

type CheckAsync = (label: string, fn: () => Promise<void>) => void;

export async function registerLevelRuntimeTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("LevelRuntime runs the canonical environment/render order in both modes", () => {
    for (const mode of ["editor", "runtime"] as const) {
      const calls: string[] = [];
      const record = (step: string) => () => calls.push(step);
      const environmentRender: LevelRuntimeEnvironmentRenderHandlers = {
        fitSunShadow: record("sun-shadow"),
        applyBackgroundAndAmbient: record("background-ambient"),
        applySky: record("sky"),
        applyReflectionEnvironment: record("reflection-environment"),
        applyPostProcess: record("post-process"),
        applyFog: record("fog"),
        applyClouds: record("clouds"),
      };
      const reflectionObjects: LevelRuntimeReflectionObjectHandlers = {
        buildReflectionCaptures: record("reflection-captures"),
        buildReflectionPlanes: record("reflection-planes"),
        buildReflectiveSurfaces: record("reflective-surfaces"),
      };
      const worldGeometry: LevelRuntimeWorldGeometryHandlers = {
        buildBlockingVolumes: record("blocking-volumes"),
        buildSplines: record("splines"),
        buildLandscapes: async () => record("landscapes")(),
        buildRiverWaters: async () => record("river-waters")(),
        buildFoliage: async () => record("foliage")(),
      };
      const coreContent: LevelRuntimeCoreContentHandlers = {
        loadModels: async () => record("models")(),
        registerShapeModels: record("shape-models"),
        applyAssetUvwMappings: async () => record("asset-uvw")(),
        applyMaterialSlots: async () => record("material-slots")(),
        beforeBuildSceneEntities: async () => {},
        buildSceneEntities: record("scene-entities"),
        buildActorInstances: async () => record("actor-instances")(),
      };
      const runtime = new LevelRuntime({ mode, environmentRender, reflectionObjects, worldGeometry, coreContent });
      runtime.buildEnvironmentRender();
      runtime.buildReflectionObjects();
      assert.equal(runtime.mode, mode);
      assert.deepEqual(calls, [
        ...LEVEL_RUNTIME_ENVIRONMENT_RENDER_STEPS,
        ...LEVEL_RUNTIME_REFLECTION_OBJECT_STEPS,
      ]);
    }
  });

  await checkAsync("LevelRuntime awaits the canonical world-geometry order", async () => {
    const calls: string[] = [];
    const record = (step: string) => () => calls.push(step);
    const runtime = new LevelRuntime({
      mode: "runtime",
      environmentRender: {
        fitSunShadow: record("unused"),
        applyBackgroundAndAmbient: record("unused"),
        applySky: record("unused"),
        applyReflectionEnvironment: record("unused"),
        applyPostProcess: record("unused"),
        applyFog: record("unused"),
        applyClouds: record("unused"),
      },
      reflectionObjects: {
        buildReflectionCaptures: record("unused"),
        buildReflectionPlanes: record("unused"),
        buildReflectiveSurfaces: record("unused"),
      },
      worldGeometry: {
        buildBlockingVolumes: record("blocking-volumes"),
        buildSplines: record("splines"),
        buildLandscapes: async () => {
          await Promise.resolve();
          record("landscapes")();
        },
        buildRiverWaters: async () => record("river-waters")(),
        buildFoliage: async () => record("foliage")(),
      },
      coreContent: {
        loadModels: async () => record("unused")(),
        registerShapeModels: record("unused"),
        applyAssetUvwMappings: async () => record("unused")(),
        applyMaterialSlots: async () => record("unused")(),
        beforeBuildSceneEntities: async () => {},
        buildSceneEntities: record("unused"),
        buildActorInstances: async () => record("unused")(),
      },
    });
    await runtime.buildWorldGeometry();
    assert.deepEqual(calls, LEVEL_RUNTIME_WORLD_GEOMETRY_STEPS);
  });

  await checkAsync("LevelRuntime awaits the canonical core-content order", async () => {
    const calls: string[] = [];
    const record = (step: string) => () => calls.push(step);
    const empty = () => {};
    const runtime = new LevelRuntime({
      mode: "editor",
      environmentRender: {
        fitSunShadow: empty,
        applyBackgroundAndAmbient: empty,
        applySky: empty,
        applyReflectionEnvironment: empty,
        applyPostProcess: empty,
        applyFog: empty,
        applyClouds: empty,
      },
      reflectionObjects: {
        buildReflectionCaptures: empty,
        buildReflectionPlanes: empty,
        buildReflectiveSurfaces: empty,
      },
      worldGeometry: {
        buildBlockingVolumes: empty,
        buildSplines: empty,
        buildLandscapes: async () => {},
        buildRiverWaters: async () => {},
        buildFoliage: async () => {},
      },
      coreContent: {
        loadModels: async () => record("models")(),
        registerShapeModels: record("shape-models"),
        applyAssetUvwMappings: async () => record("asset-uvw")(),
        applyMaterialSlots: async () => record("material-slots")(),
        beforeBuildSceneEntities: async () => {
          await Promise.resolve();
        },
        buildSceneEntities: record("scene-entities"),
        buildActorInstances: async () => record("actor-instances")(),
      },
    });
    await runtime.buildCoreContent();
    assert.deepEqual(calls, LEVEL_RUNTIME_CORE_CONTENT_STEPS);
  });

  await checkAsync("LevelRuntime builds every shared level-content group in one pipeline", async () => {
    const calls: string[] = [];
    const record = (step: string) => () => calls.push(step);
    const runtime = new LevelRuntime({
      mode: "runtime",
      environmentRender: {
        fitSunShadow: record("sun-shadow"),
        applyBackgroundAndAmbient: record("background-ambient"),
        applySky: record("sky"),
        applyReflectionEnvironment: record("reflection-environment"),
        applyPostProcess: record("post-process"),
        applyFog: record("fog"),
        applyClouds: record("clouds"),
      },
      reflectionObjects: {
        buildReflectionCaptures: record("reflection-captures"),
        buildReflectionPlanes: record("reflection-planes"),
        buildReflectiveSurfaces: record("reflective-surfaces"),
      },
      worldGeometry: {
        buildBlockingVolumes: record("blocking-volumes"),
        buildSplines: record("splines"),
        buildLandscapes: async () => record("landscapes")(),
        buildRiverWaters: async () => record("river-waters")(),
        buildFoliage: async () => record("foliage")(),
      },
      coreContent: {
        loadModels: async () => record("models")(),
        registerShapeModels: record("shape-models"),
        applyAssetUvwMappings: async () => record("asset-uvw")(),
        applyMaterialSlots: async () => record("material-slots")(),
        beforeBuildSceneEntities: async () => {},
        buildSceneEntities: record("scene-entities"),
        buildActorInstances: async () => record("actor-instances")(),
      },
    });
    await runtime.build();
    assert.deepEqual(calls, LEVEL_RUNTIME_BUILD_STEPS);
  });
}
