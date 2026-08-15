import assert from "node:assert/strict";
import {
  buildManifestFor,
  buildManifestParityReport,
  buildStepIds,
} from "../../src/scene/buildManifest";

type Check = (label: string, fn: () => void) => void;

const EXPECTED_EDITOR_ONLY = ["ai-navigation-volumes", "target-points", "world-widget-markers"];

const EXPECTED_RUNTIME_ONLY = [
  "actor-class-resolution",
  "player-start-spawn",
  "loading-progress-model-discovery",
  "collision-definitions",
  "asset-urls",
  "ai-assets",
  "runtime-scene-document",
  "physics-and-runtime-subsystems",
  "auto-play-audio",
  "auto-play-particles",
  "character-skeletons",
  "game-mode",
  "save-game-restore",
  "runtime-ui",
  "quality-settings",
  "lod-bias",
  "capability-modules",
  "shader-warmup",
];

export function registerBuildManifestParityTests(check: Check): void {
  check("build manifest keeps editor and runtime level-content steps in the same ordered pipeline", () => {
    assert.deepEqual(
      buildStepIds("editor", "level-content"),
      buildStepIds("runtime", "level-content"),
    );
  });

  check("build manifest lists the current shell-only steps explicitly", () => {
    const report = buildManifestParityReport();
    assert.deepEqual(report.editorOnly, EXPECTED_EDITOR_ONLY);
    assert.deepEqual(report.runtimeOnly, EXPECTED_RUNTIME_ONLY);
    assert.equal(report.sharedLevelContent.length, 24);
  });

  check("build manifest records the canonical LevelRuntime environment/render order", () => {
    const editor = buildManifestFor("editor").map((step) => step.id);
    const runtime = buildManifestFor("runtime").map((step) => step.id);
    assert.ok(editor.indexOf("reflection-environment") < editor.indexOf("post-process"));
    assert.ok(runtime.indexOf("reflection-environment") < runtime.indexOf("post-process"));
    assert.ok(editor.indexOf("reflection-captures") < editor.indexOf("reflection-planes"));
    assert.ok(runtime.indexOf("reflection-captures") < runtime.indexOf("reflection-planes"));
  });
}
