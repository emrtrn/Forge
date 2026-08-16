/**
 * Declarative snapshot of the level-build work currently owned by the editor
 * and runtime shells.
 *
 * Phase A deliberately keeps this as data: it makes the duplicated pipelines
 * measurable before Phase C replaces them with one LevelRuntime pipeline.
 */
export type BuildShell = "editor" | "runtime";

export type BuildStepCategory = "level-content" | "editor-only" | "runtime-only";

export interface BuildManifestStep {
  readonly id: string;
  readonly category: BuildStepCategory;
}

const levelContent = (id: string): BuildManifestStep => ({ id, category: "level-content" });
const editorOnly = (id: string): BuildManifestStep => ({ id, category: "editor-only" });
const runtimeOnly = (id: string): BuildManifestStep => ({ id, category: "runtime-only" });

/**
 * Current SceneApp.loadActiveProjectScene order. It is intentionally not
 * normalized to the runtime order yet; the known ordering drift is a Phase C
 * input, not something this measurement phase should hide.
 */
const EDITOR_BUILD_MANIFEST: readonly BuildManifestStep[] = [
  levelContent("layout"),
  levelContent("mesh-paint"),
  levelContent("world-settings"),
  levelContent("default-lights"),
  levelContent("models"),
  levelContent("shape-models"),
  levelContent("asset-uvw"),
  levelContent("material-slots"),
  levelContent("scene-entities"),
  levelContent("actor-instances"),
  levelContent("sun-shadow"),
  levelContent("background-ambient"),
  levelContent("sky"),
  levelContent("reflection-environment"),
  levelContent("post-process"),
  levelContent("fog"),
  levelContent("clouds"),
  levelContent("reflection-captures"),
  levelContent("reflection-planes"),
  levelContent("reflective-surfaces"),
  levelContent("blocking-volumes"),
  editorOnly("ai-navigation-volumes"),
  editorOnly("target-points"),
  levelContent("splines"),
  levelContent("landscapes"),
  levelContent("foliage"),
  editorOnly("world-widget-markers"),
];

/** Current RuntimeSceneApp.buildScene order. */
const RUNTIME_BUILD_MANIFEST: readonly BuildManifestStep[] = [
  levelContent("layout"),
  levelContent("mesh-paint"),
  levelContent("world-settings"),
  levelContent("default-lights"),
  runtimeOnly("actor-class-resolution"),
  runtimeOnly("player-start-spawn"),
  runtimeOnly("loading-progress-model-discovery"),
  levelContent("models"),
  levelContent("shape-models"),
  levelContent("asset-uvw"),
  levelContent("material-slots"),
  levelContent("scene-entities"),
  levelContent("actor-instances"),
  levelContent("sun-shadow"),
  levelContent("background-ambient"),
  levelContent("sky"),
  levelContent("reflection-environment"),
  levelContent("post-process"),
  levelContent("fog"),
  levelContent("clouds"),
  levelContent("reflection-captures"),
  levelContent("reflection-planes"),
  levelContent("reflective-surfaces"),
  levelContent("blocking-volumes"),
  levelContent("splines"),
  levelContent("landscapes"),
  levelContent("foliage"),
  runtimeOnly("collision-definitions"),
  runtimeOnly("asset-urls"),
  runtimeOnly("ai-assets"),
  runtimeOnly("runtime-scene-document"),
  runtimeOnly("physics-and-runtime-subsystems"),
  runtimeOnly("auto-play-audio"),
  runtimeOnly("auto-play-particles"),
  runtimeOnly("character-skeletons"),
  runtimeOnly("game-mode"),
  // Shell-side UI only: the ViewModel seed + the game-rules store. Mounting the
  // widgets is `runtimeUiModule`'s work, inside `capability-modules` below.
  runtimeOnly("game-rules"),
  runtimeOnly("quality-settings"),
  runtimeOnly("lod-bias"),
  // Layer 2 modules run their own level setup here: dialogue asset registration
  // with its script-message triggers, the save-game restore + slot-field seeding,
  // and the runtime UI hosts — all moved out of the shell in Phase E.
  runtimeOnly("capability-modules"),
  runtimeOnly("shader-warmup"),
];

export function buildManifestFor(shell: BuildShell): readonly BuildManifestStep[] {
  return shell === "editor" ? EDITOR_BUILD_MANIFEST : RUNTIME_BUILD_MANIFEST;
}

export function buildStepIds(
  shell: BuildShell,
  category?: BuildStepCategory,
): readonly string[] {
  return buildManifestFor(shell)
    .filter((step) => category === undefined || step.category === category)
    .map((step) => step.id);
}

export interface BuildManifestParityReport {
  readonly sharedLevelContent: readonly string[];
  readonly editorOnly: readonly string[];
  readonly runtimeOnly: readonly string[];
}

/** Returns the explicit shell delta used by the Phase A invariant test. */
export function buildManifestParityReport(): BuildManifestParityReport {
  return {
    sharedLevelContent: buildStepIds("editor", "level-content"),
    editorOnly: buildStepIds("editor", "editor-only"),
    runtimeOnly: buildStepIds("runtime", "runtime-only"),
  };
}
