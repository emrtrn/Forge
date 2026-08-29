/**
 * Side-effect-free `?debug` overlay snapshot builders extracted from
 * {@link RuntimeSceneApp} (P2.5). Each function assembles one overlay readout
 * from already-resolved inputs (values + a few lookup callbacks); none of them
 * touch a subsystem, the renderer or the DOM directly, so the null-branching and
 * default-fallback logic is unit-testable in isolation. The snapshot *shapes*
 * stay defined on {@link RuntimeSceneApp} (their `debugStats.ts` formatter
 * consumers import them from there) and are referenced here type-only, so this
 * module carries no runtime import and cannot widen the game bundle.
 *
 * Only the readouts with real resolution logic moved here; the one-line
 * subsystem delegations (`getRenderStats`, `getVfxDebugSnapshot`, etc.) stay in
 * the shell where they add no branching worth extracting.
 */
import type { RenderMemoryStats } from "@engine/render-three/renderer";
import type { UiFieldValue } from "@engine/ui/uiViewModel";
import type { InputMode } from "./gameModeTypes";
import type { LocomotionInput } from "@engine/movement/locomotionAnimation";
import type { WorldUiDebugSnapshot } from "@/ui/WorldUiSubsystem";
import type {
  GameModeDebugSnapshot,
  PerfMemorySnapshot,
  UiDebugSnapshot,
} from "./RuntimeSceneApp";

/** Reads the browser's Chrome-only `performance.memory` heap counters, guarded. */
function readJsHeap(): { used: number | null; limit: number | null } {
  const perfMemory =
    typeof performance !== "undefined"
      ? (performance as { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory
      : undefined;
  return {
    used: typeof perfMemory?.usedJSHeapSize === "number" ? perfMemory.usedJSHeapSize : null,
    limit: typeof perfMemory?.jsHeapSizeLimit === "number" ? perfMemory.jsHeapSizeLimit : null,
  };
}

/**
 * Builds the memory readout: GPU resource counts (always) plus the JS heap when
 * the browser exposes `performance.memory` (Chrome-only, guarded).
 */
export function buildPerfMemorySnapshot(renderMemory: RenderMemoryStats): PerfMemorySnapshot {
  const heap = readJsHeap();
  return { render: renderMemory, jsHeapBytes: heap.used, jsHeapLimitBytes: heap.limit };
}

/** Camera-rotation debug values the active Game Mode may expose (all optional). */
export interface CameraDebugValues {
  controlYawDeg: number | null;
  controlPitchDeg: number | null;
  cameraSource: string | null;
}

/**
 * Inputs for {@link buildGameModeDebugSnapshot}. Subsystem access stays in the
 * shell behind these lookups; the builder owns the "null unless a pawn is
 * possessed" branching so it can be exercised without a live scene.
 */
export interface GameModeDebugInputs {
  /** Active Game Mode display name, or null before one resolves (→ "—"). */
  activeGameModeName: string | null;
  /** Possessed pawn entity id, or null when nothing is possessed. */
  possessed: string | null;
  /** Current runtime input mode. */
  inputMode: InputMode;
  /** Camera-rotation debug values, when the active mode owns control rotation. */
  cameraDebug: CameraDebugValues | null | undefined;
  /** Latest locomotion report for a possessed pawn, or undefined when none yet. */
  locomotionReportOf(entityId: string): LocomotionInput | undefined;
  /** Authored CharacterMovement mode of a possessed pawn, or null. */
  movementModeOf(entityId: string): string | null;
  /** World position of a possessed pawn, or null when it has no transform. */
  positionOf(entityId: string): readonly [number, number, number] | null;
}

/**
 * Builds the Game Mode readout: which mode is active, what it possessed, and the
 * possessed pawn's movement state (mode + grounded + velocity + position). Fields
 * are null when nothing is possessed or the pawn has not reported locomotion yet.
 */
export function buildGameModeDebugSnapshot(inputs: GameModeDebugInputs): GameModeDebugSnapshot {
  const { possessed } = inputs;
  const report = possessed ? inputs.locomotionReportOf(possessed) : undefined;
  return {
    gameMode: inputs.activeGameModeName ?? "—",
    possessed,
    movementMode: possessed ? inputs.movementModeOf(possessed) : null,
    grounded: report ? report.grounded : null,
    velocityY: report ? report.velocityY : null,
    planarSpeed: report ? report.planarSpeed : null,
    position: possessed ? inputs.positionOf(possessed) : null,
    controlYawDeg: inputs.cameraDebug?.controlYawDeg ?? null,
    controlPitchDeg: inputs.cameraDebug?.controlPitchDeg ?? null,
    cameraSource: inputs.cameraDebug?.cameraSource ?? null,
    inputMode: inputs.inputMode,
  };
}

/** The subset of the runtime UI host readout the snapshot needs (structural). */
export interface UiHostDebugLayers {
  hud: string | null;
  screens: string[];
  audit: string[];
}

/** Inputs for {@link buildUiDebugSnapshot}; `host` is null before the UI boots. */
export interface UiDebugInputs {
  host: UiHostDebugLayers | null;
  fields: Array<[string, UiFieldValue]>;
  locale: string | null;
  world: WorldUiDebugSnapshot;
}

/**
 * Builds the UI-host readout: the mounted HUD, active screen stack and the
 * ViewModel store fields the widgets bind to. Returns empty layers before the UI
 * subsystem boots.
 */
export function buildUiDebugSnapshot(inputs: UiDebugInputs): UiDebugSnapshot {
  const host = inputs.host ?? { hud: null, screens: [], audit: [] };
  return {
    hud: host.hud,
    screens: host.screens,
    fields: inputs.fields,
    locale: inputs.locale,
    audit: host.audit,
    world: inputs.world,
  };
}

/**
 * The drawing buffer actually being shaded: CSS size in `width`/`height` times
 * the effective `pixelRatio`, which the quality profile caps and scales.
 */
export interface DrawingBufferSnapshot {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/**
 * The shared voice budget as the `?debug` overlay reads it.
 *
 * Structural on purpose: {@link AudioSubsystem.voiceStats} satisfies it, and so
 * does an `AudioEventDirector.budgetStats()` in a fork that runs one — which is
 * where `eventRefusals` (a single event's own `maxInstances` biting, usually by
 * design) comes from. Absent rather than zero where nothing measures it.
 */
export interface AudioBudgetReadout {
  readonly active: number;
  readonly peak: number;
  readonly limit: number;
  /** Plays refused because the shared ceiling was full — the budget biting. */
  readonly budgetRefusals: number;
  readonly eventRefusals?: number;
  readonly byBus: ReadonlyArray<{
    readonly bus: string;
    readonly active: number;
    readonly peak: number;
  }>;
}

/**
 * What `renderer.render` actually walks, per pass (`?debug` scene-graph line).
 *
 * Draw calls say how much reaches the GPU; this says how much the CPU had to
 * look at to decide that, and the two come apart completely — instancing
 * collapses a forest into one draw call while leaving every one of its nodes in
 * the graph, and a shadowing light walks the whole thing a second time. Counted
 * over visible subtrees only, because an invisible parent costs the renderer
 * nothing below it.
 */
export interface SceneGraphCost {
  readonly objects: number;
  readonly meshes: number;
}

/** Shadow-casting geometry attributed to one scene source (a `?debug` bucket). */
export interface ShadowCasterBucket {
  /** Where the geometry came from — see {@link sceneSourceOf}. */
  readonly source: string;
  /** Draw-time meshes, with an `InstancedMesh`'s live `count` already applied. */
  readonly meshes: number;
  readonly triangles: number;
}

/** The two traversal-derived readouts, built from one walk of the scene. */
export interface SceneCostSnapshot {
  readonly graph: SceneGraphCost;
  readonly shadows: readonly ShadowCasterBucket[];
}

/**
 * The minimum of `THREE.Object3D` this module needs. Declared structurally
 * rather than imported so the snapshot builder stays testable with plain
 * objects, and so this module keeps carrying no runtime import at all.
 */
export interface SceneCostObject {
  readonly name?: string;
  readonly type?: string;
  readonly userData?: Record<string, unknown>;
  readonly parent?: SceneCostObject | null;
  readonly children?: readonly SceneCostObject[];
  readonly visible?: boolean;
  readonly castShadow?: boolean;
  readonly isMesh?: boolean;
  readonly isInstancedMesh?: boolean;
  /** Live instance count of an `InstancedMesh` (`count`, not `instanceMatrix`). */
  readonly count?: number;
  readonly geometry?: {
    readonly index?: { readonly count: number } | null;
    readonly attributes?: { readonly position?: { readonly count: number } };
  };
}

/** userData key a scene builder tags an object with to name its content source. */
export const SCENE_SOURCE_KEY = "forgeSceneSource";

/**
 * Names the content source of a subtree the shell just built, for the shadow
 * inventory. The tag is authored by whoever builds the object, never inferred
 * here: the engine has no content taxonomy, and a fork that adds a content kind
 * gets its own bucket by tagging it, without editing the readout.
 */
export function tagSceneSource<T extends { userData: Record<string, unknown> }>(
  object: T,
  source: string,
): T {
  object.userData[SCENE_SOURCE_KEY] = source;
  return object;
}

/**
 * Which content bucket an object belongs to, generically.
 *
 * The template has no fixed content taxonomy, so the label is *data*: the
 * nearest ancestor (or the object itself) carrying a {@link SCENE_SOURCE_KEY}
 * tag wins, and an untagged object falls back to the name — else the type — of
 * the top-level scene child it hangs under. That keeps the bucket meaningful in
 * a fork that tags nothing, without the engine ever naming a game concept.
 */
export function sceneSourceOf(object: SceneCostObject, root: SceneCostObject): string {
  let node: SceneCostObject | null | undefined = object;
  let topLevel: SceneCostObject = object;
  while (node && node !== root) {
    const tag = node.userData?.[SCENE_SOURCE_KEY];
    if (typeof tag === "string" && tag.length > 0) return tag;
    topLevel = node;
    node = node.parent;
  }
  const name = topLevel.name;
  if (typeof name === "string" && name.length > 0) return name;
  return topLevel.type ?? "other";
}

/** Triangle count of one geometry (indexed or not); 0 when it has no positions. */
function triangleCount(object: SceneCostObject): number {
  const geometry = object.geometry;
  if (!geometry) return 0;
  const indexed = geometry.index?.count;
  if (typeof indexed === "number") return Math.floor(indexed / 3);
  const positions = geometry.attributes?.position?.count;
  return typeof positions === "number" ? Math.floor(positions / 3) : 0;
}

export interface SceneCostOptions {
  /** Bucket labeller; defaults to {@link sceneSourceOf}. */
  readonly classify?: (object: SceneCostObject, root: SceneCostObject) => string;
  /** Buckets kept before the rest collapse into `other` (0 = keep all). */
  readonly maxBuckets?: number;
}

/**
 * Walks the visible scene once and builds both traversal readouts.
 *
 * Deliberately *not* per frame: the overlay samples it on its own half-second
 * cadence, because a full `traverseVisible` run charged to every frame would
 * become part of the cost it exists to explain.
 */
export function buildSceneCostSnapshot(
  root: SceneCostObject,
  options: SceneCostOptions = {},
): SceneCostSnapshot {
  const classify = options.classify ?? sceneSourceOf;
  const maxBuckets = options.maxBuckets ?? 6;
  let objects = 0;
  let meshes = 0;
  const buckets = new Map<string, { meshes: number; triangles: number }>();

  const visit = (node: SceneCostObject): void => {
    if (node.visible === false) return;
    objects += 1;
    if (node.isMesh) {
      meshes += 1;
      if (node.castShadow) {
        // An InstancedMesh draws `count` copies of one geometry; charging it as
        // a single mesh understates a painted forest by four orders of magnitude.
        const instances = node.isInstancedMesh ? Math.max(0, node.count ?? 0) : 1;
        const source = classify(node, root);
        const bucket = buckets.get(source) ?? { meshes: 0, triangles: 0 };
        bucket.meshes += instances;
        bucket.triangles += triangleCount(node) * instances;
        buckets.set(source, bucket);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of root.children ?? []) visit(child);

  const sorted = [...buckets.entries()]
    .map(([source, bucket]) => ({ source, ...bucket }))
    .sort((a, b) => b.triangles - a.triangles || a.source.localeCompare(b.source));
  if (maxBuckets <= 0 || sorted.length <= maxBuckets) {
    return { graph: { objects, meshes }, shadows: sorted };
  }
  const kept = sorted.slice(0, maxBuckets);
  const rest = sorted.slice(maxBuckets);
  kept.push({
    source: "other",
    meshes: rest.reduce((sum, bucket) => sum + bucket.meshes, 0),
    triangles: rest.reduce((sum, bucket) => sum + bucket.triangles, 0),
  });
  return { graph: { objects, meshes }, shadows: kept };
}
