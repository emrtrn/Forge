import assert from "node:assert/strict";
import {
  LEVEL_RUNTIME_ENVIRONMENT_RENDER_STEPS,
  LEVEL_RUNTIME_REFLECTION_OBJECT_STEPS,
  LevelRuntime,
  type LevelRuntimeEnvironmentRenderHandlers,
  type LevelRuntimeReflectionObjectHandlers,
} from "../../src/scene/LevelRuntime";

type Check = (label: string, fn: () => void) => void;

export function registerLevelRuntimeTests(check: Check): void {
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
      const runtime = new LevelRuntime({ mode, environmentRender, reflectionObjects });
      runtime.buildEnvironmentRender();
      runtime.buildReflectionObjects();
      assert.equal(runtime.mode, mode);
      assert.deepEqual(calls, [
        ...LEVEL_RUNTIME_ENVIRONMENT_RENDER_STEPS,
        ...LEVEL_RUNTIME_REFLECTION_OBJECT_STEPS,
      ]);
    }
  });
}
