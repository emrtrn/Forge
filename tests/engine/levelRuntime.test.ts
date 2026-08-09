import assert from "node:assert/strict";
import {
  LEVEL_RUNTIME_ENVIRONMENT_RENDER_STEPS,
  LEVEL_RUNTIME_REFLECTION_OBJECT_STEPS,
  LEVEL_RUNTIME_WORLD_GEOMETRY_STEPS,
  LevelRuntime,
  type LevelRuntimeEnvironmentRenderHandlers,
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
        buildFoliage: async () => record("foliage")(),
      };
      const runtime = new LevelRuntime({ mode, environmentRender, reflectionObjects, worldGeometry });
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
        buildFoliage: async () => record("foliage")(),
      },
    });
    await runtime.buildWorldGeometry();
    assert.deepEqual(calls, LEVEL_RUNTIME_WORLD_GEOMETRY_STEPS);
  });
}
