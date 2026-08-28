/**
 * Tiny fps / draw-call readout for the HTML overlay (#debug-stats).
 * Enabled only with `?debug` in the URL so it never ships visible.
 * lil-gui (devDependency) is dynamically imported on demand later, when
 * scene parameters need live tweaking — keeps it out of the base bundle.
 */
import {
  DEFAULT_PERF_BUDGET,
  evaluatePerfBudget,
  formatByteSize,
  isOverBudget,
  type BudgetMetric,
} from "@engine/perf/perfBudget";
import type { SubsystemProfileSnapshot } from "@engine/core/subsystemProfiler";
import type { FrameMetrics } from "@engine/perf/frameMetrics";
import type { GpuFrameStats } from "@engine/perf/gpuTimer";
import type { BottleneckResult } from "@engine/perf/bottleneckClassifier";
import { formatAdaptiveChange } from "@engine/perf/adaptiveQuality";
import type { VfxDebugSnapshot } from "@engine/render-three/vfxSubsystem";
import type { AiDebugSnapshot } from "@engine/ai/aiSubsystem";
import type { AiNavigationDebugSnapshot } from "./capabilities/runtimeServiceKeys";
import type {
  GameModeDebugSnapshot,
  PerfMemorySnapshot,
  RuntimeStatsApp,
  UiDebugSnapshot,
} from "./RuntimeSceneApp";

const UPDATE_INTERVAL_MS = 500;
/** How many of the most expensive subsystems the overlay lists. */
const TOP_SUBSYSTEMS = 3;

export function attachDebugStats(app: RuntimeStatsApp, element: HTMLElement): void {
  let accumMs = 0;
  let frames = 0;

  app.onFrame = (deltaMs) => {
    accumMs += deltaMs;
    frames += 1;
    if (accumMs < UPDATE_INTERVAL_MS) return;

    // Skip the per-interval snapshot/format work while the overlay is hidden
    // (editor Show > Stats toggled off): `hidden`/`display:none` yields a null
    // offsetParent. Reset the accumulator so the next show starts a fresh window.
    if (element.offsetParent === null) {
      accumMs = 0;
      frames = 0;
      return;
    }

    const fps = (frames * 1000) / accumMs;
    const { drawCalls, triangles } = app.getRenderStats();
    element.textContent =
      `${fps.toFixed(0)} fps\n` +
      `${drawCalls} draw calls\n` +
      `${triangles} tris` +
      frameMetricsText(app) +
      gpuFrameText(app) +
      bottleneckText(app) +
      adaptiveText(app) +
      subsystemTimingText(app) +
      memoryText(app) +
      budgetText(app, drawCalls, triangles) +
      vfxDebugText(app) +
      gameModeDebugText(app) +
      aiDebugText(app) +
      aiInspectorText(app) +
      aiNavDebugText(app) +
      splinePathFollowerDebugText(app) +
      uiDebugText(app) +
      scriptMessageDebugText(app);
    accumMs = 0;
    frames = 0;
  };
}

/** The frame-time block, or "" when the app exposes no snapshot / no samples yet. */
function frameMetricsText(app: RuntimeStatsApp): string {
  const metrics = app.getFrameMetricsSnapshot?.();
  if (!metrics || metrics.sampleCount === 0) return "";
  return `\n${formatFrameMetrics(metrics).join("\n")}`;
}

/**
 * Formats {@link FrameMetrics} into an overlay line (pure, DOM-free for unit
 * tests): windowed average frame time, P95 and the spike count over the window.
 * Average + P95 together read "smooth on average, but does it hitch?" — the
 * reason frame time (not FPS) drives the adaptive quality controller.
 */
export function formatFrameMetrics(metrics: FrameMetrics): string[] {
  return [
    `frame ${metrics.averageFrameTimeMs.toFixed(1)}ms ` +
      `p95 ${metrics.p95FrameTimeMs.toFixed(1)} spikes ${metrics.spikeCount}`,
  ];
}

/** The GPU frame-time line, or "" when nothing measured it (no `?debug`, or a
 * browser without timer queries). Never a zero — see {@link formatGpuFrameStats}. */
function gpuFrameText(app: RuntimeStatsApp): string {
  const stats = app.getGpuFrameStats?.();
  if (!stats) return "";
  return `\n${formatGpuFrameStats(stats).join("\n")}`;
}

/**
 * Formats {@link GpuFrameStats} into an overlay line (pure, DOM-free for unit
 * tests). Read next to the `frame` line above it, this is the whole point of the
 * timer: CPU high + GPU low means the frame is bound by what we are issuing, the
 * reverse means it is bound by what we are asking the GPU to draw.
 *
 * The two numbers do NOT add up to the frame time and must not be presented as
 * though they did — they overlap, and vsync sits outside both. Browsers also
 * quantise the returned nanoseconds as a side-channel mitigation, so one decimal
 * is all the precision there is.
 */
export function formatGpuFrameStats(stats: GpuFrameStats): string[] {
  return [
    `gpu ${stats.lastMs.toFixed(1)}ms ` +
      `avg ${stats.averageMs.toFixed(1)} max ${stats.maxMs.toFixed(1)}`,
  ];
}

/** The bottleneck diagnosis line, or "" when the app exposes none / no samples. */
function bottleneckText(app: RuntimeStatsApp): string {
  const result = app.getBottleneckSnapshot?.();
  if (!result) return "";
  return `\n${formatBottleneck(result).join("\n")}`;
}

/**
 * Formats a {@link BottleneckResult} into overlay lines (pure, DOM-free for unit
 * tests): a `bottleneck: <type> (conf X.XX)` header plus the top evidence item,
 * so the overlay answers "it got slow — but why?" (plan §8, §13).
 */
export function formatBottleneck(result: BottleneckResult): string[] {
  const head = `bottleneck: ${result.type} (conf ${result.confidence.toFixed(2)})`;
  return result.evidence.length > 0 ? [head, `  ${result.evidence[0]}`] : [head];
}

/** The adaptive quality block (profile + adaptive state + last change), or "". */
function adaptiveText(app: RuntimeStatsApp): string {
  const snapshot = app.getAdaptiveDebugSnapshot?.();
  if (!snapshot) return "";
  return `\n${formatAdaptiveQuality(snapshot).join("\n")}`;
}

/**
 * Formats the adaptive quality state into overlay lines (pure, DOM-free for unit
 * tests): a `quality:` line with the player's profile, the adaptive on/off state
 * and the live reduction depth, plus a `last:` line describing the most recent
 * automatic change and its age (plan §13).
 */
export function formatAdaptiveQuality(snapshot: {
  qualityLevel: string;
  adaptiveEnabled: boolean;
  reductionDepth: number;
  lastChange: { record: Parameters<typeof formatAdaptiveChange>[0]; ageSeconds: number } | null;
}): string[] {
  const mode = snapshot.adaptiveEnabled ? "adaptive on" : "adaptive off";
  const depth = snapshot.reductionDepth > 0 ? ` -${snapshot.reductionDepth}` : "";
  const lines = [`quality: ${snapshot.qualityLevel} (${mode})${depth}`];
  if (snapshot.lastChange) {
    lines.push(formatAdaptiveChange(snapshot.lastChange.record, snapshot.lastChange.ageSeconds));
  }
  return lines;
}

/** The subsystem-timing block, or "" when profiling is off / no samples yet. */
function subsystemTimingText(app: RuntimeStatsApp): string {
  const snapshot = app.getSubsystemProfileSnapshot?.();
  if (!snapshot || snapshot.subsystems.length === 0) return "";
  return `\n${formatSubsystemTiming(snapshot, TOP_SUBSYSTEMS).join("\n")}`;
}

/**
 * Formats a {@link SubsystemProfileSnapshot} into overlay lines (pure, DOM-free
 * for unit tests): a header with the total windowed tick cost, then the `topN`
 * most expensive subsystems with their average / last / peak millisecond cost.
 */
export function formatSubsystemTiming(
  snapshot: SubsystemProfileSnapshot,
  topN: number,
): string[] {
  const lines = [`perf (avg/frame ${snapshot.totalAverageMs.toFixed(2)}ms)`];
  for (const timing of snapshot.subsystems.slice(0, Math.max(0, topN))) {
    lines.push(
      `  ${timing.id} ${timing.averageMs.toFixed(2)}ms ` +
        `(last ${timing.lastMs.toFixed(2)} peak ${timing.maxMs.toFixed(2)})`,
    );
  }
  return lines;
}

/** The memory-counter block, or "" when the app exposes no memory snapshot. */
function memoryText(app: RuntimeStatsApp): string {
  if (!app.getPerfMemorySnapshot) return "";
  return `\n${formatMemory(app.getPerfMemorySnapshot()).join("\n")}`;
}

/**
 * Formats a {@link PerfMemorySnapshot} into overlay lines (pure, DOM-free): GPU
 * geometry/texture/program counts, and the JS heap when the browser reports it
 * (Chrome-only); the heap line is omitted entirely off Chrome.
 */
export function formatMemory(snapshot: PerfMemorySnapshot): string[] {
  const { geometries, textures, programs } = snapshot.render;
  const lines = ["memory", `  geo ${geometries} tex ${textures} prog ${programs}`];
  if (snapshot.jsHeapBytes !== null) {
    const used = formatByteSize(snapshot.jsHeapBytes);
    const limit = snapshot.jsHeapLimitBytes !== null ? ` / ${formatByteSize(snapshot.jsHeapLimitBytes)}` : "";
    lines.push(`  heap ${used}${limit}`);
  }
  return lines;
}

/** The budget block, or "" when the app exposes no memory snapshot (texture count). */
function budgetText(app: RuntimeStatsApp, drawCalls: number, triangles: number): string {
  const memory = app.getPerfMemorySnapshot?.();
  if (!memory) return "";
  const metrics = evaluatePerfBudget(
    { drawCalls, triangles, textures: memory.render.textures },
    DEFAULT_PERF_BUDGET,
  );
  return `\n${formatPerfBudget(metrics).join("\n")}`;
}

/**
 * Formats budget rows into overlay lines (pure, DOM-free). Over-budget rows are
 * prefixed with `!` (the overlay is single-color plain text, so a marker is the
 * only affordance); the header gains an `(OVER)` tag when anything is over.
 */
export function formatPerfBudget(metrics: BudgetMetric[]): string[] {
  const lines = [isOverBudget(metrics) ? "budget (OVER)" : "budget"];
  for (const metric of metrics) {
    const marker = metric.over ? "!" : " ";
    lines.push(`${marker} ${metric.label} ${groupThousands(metric.value)}/${groupThousands(metric.budget)}`);
  }
  return lines;
}

/** Inserts thousands separators (deterministic, locale-independent for tests). */
export function groupThousands(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0;
  const digits = Math.trunc(Math.abs(value)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

/** The VFX runtime block, or "" when the app exposes no snapshot (editor). */
function vfxDebugText(app: RuntimeStatsApp): string {
  if (!app.getVfxDebugSnapshot) return "";
  return `\n${formatVfxDebug(app.getVfxDebugSnapshot()).join("\n")}`;
}

/**
 * Formats a {@link VfxDebugSnapshot} into overlay lines (pure, DOM-free for unit
 * tests): the active-instance / alive-particle / pooled / cached counts, then the
 * busiest instances (effect id + alive count, disabled ones tagged). Caps the list
 * so a scene full of emitters can't flood the overlay.
 */
export function formatVfxDebug(snapshot: VfxDebugSnapshot, topN = 4): string[] {
  const lines = [
    "vfx",
    `active:${snapshot.activeInstances} alive:${snapshot.aliveParticles} ` +
      `pool:${snapshot.pooledInstances} defs:${snapshot.cachedDefinitions}`,
  ];
  const busiest = [...snapshot.instances]
    .sort((a, b) => b.aliveParticles - a.aliveParticles)
    .slice(0, Math.max(0, topN));
  for (const instance of busiest) {
    const off = instance.enabled ? "" : " (off)";
    lines.push(`  ${instance.effectId} ${instance.aliveParticles}${off}`);
  }
  return lines;
}

/** The Game Mode / possessed-pawn block, or "" when the app exposes no snapshot. */
function gameModeDebugText(app: RuntimeStatsApp): string {
  if (!app.getGameModeDebugSnapshot) return "";
  return `\n${formatGameModeDebug(app.getGameModeDebugSnapshot()).join("\n")}`;
}

/**
 * Formats a {@link GameModeDebugSnapshot} into overlay lines (pure, so it is
 * unit-tested without the DOM): the active mode, the possessed pawn, and that
 * pawn's movement state. Null fields render as placeholders.
 */
export function formatGameModeDebug(snapshot: GameModeDebugSnapshot): string[] {
  const num = (value: number | null): string => (value === null ? "—" : value.toFixed(2));
  const stance =
    snapshot.grounded === null ? "" : snapshot.grounded ? " (grounded)" : " (airborne)";
  const pos = snapshot.position
    ? `${snapshot.position[0].toFixed(2)} ${snapshot.position[1].toFixed(2)} ${snapshot.position[2].toFixed(2)}`
    : "—";
  return [
    "game mode",
    `mode: ${snapshot.gameMode}`,
    `possessed: ${snapshot.possessed ?? "none"}`,
    `movement: ${snapshot.movementMode ?? "—"}${stance}`,
    `vel y:${num(snapshot.velocityY)} planar:${num(snapshot.planarSpeed)}`,
    `pos: ${pos}`,
    `control yaw:${num(snapshot.controlYawDeg)} pitch:${num(snapshot.controlPitchDeg)}`,
    `camera: ${snapshot.cameraSource ?? "â€”"}`,
    `input: ${snapshot.inputMode}`,
  ];
}

/** The AI controllers block, or "" when the app exposes no snapshot. */
function aiDebugText(app: RuntimeStatsApp): string {
  if (!app.getAiDebugSnapshot) return "";
  return `\n${formatAiDebug(app.getAiDebugSnapshot()).join("\n")}`;
}

/** The focused AI inspector block, or "" when no live controller is worth expanding. */
function aiInspectorText(app: RuntimeStatsApp): string {
  if (!app.getAiDebugSnapshot) return "";
  const lines = formatAiInspector(app.getAiDebugSnapshot());
  return lines.length > 0 ? `\n${lines.join("\n")}` : "";
}

/**
 * Formats an {@link AiDebugSnapshot} into overlay lines (pure, DOM-free for unit
 * tests): the active-controller count (tagged `(off)` while the subsystem is
 * gated in editor edit mode), then each controller's possessed pawn, current
 * goal and blackboard key count. Caps the list so a crowd of NPCs can't flood it.
 */
export function formatAiDebug(snapshot: AiDebugSnapshot, topN = 4): string[] {
  const lines = [
    "ai",
    `controllers: ${snapshot.controllerCount}${snapshot.enabled ? "" : " (off)"}`,
  ];
  for (const controller of snapshot.controllers.slice(0, Math.max(0, topN))) {
    const behaviorStatus = controller.behavior?.lastStatus;
    if (behaviorStatus) {
      const behavior = controller.behavior;
      const path = behavior?.activePath.at(-1);
      const elapsed = behavior ? ` ${behavior.elapsedSeconds.toFixed(2)}s` : "";
      const failed = behavior?.failedDecorator ? ` fail:${behavior.failedDecorator}` : "";
      lines.push(`  bt ${controller.pawnEntityId}: ${behaviorStatus}${elapsed}${path ? ` ${path}` : ""}${failed}`);
    }
    const stateTree = controller.stateTree;
    if (stateTree?.lastStatus || stateTree?.activePath.length) {
      const state = stateTree.activePath.at(-1);
      const elapsed = ` ${stateTree.elapsedSeconds.toFixed(2)}s`;
      const status = stateTree.lastStatus ?? "idle";
      lines.push(`  st ${controller.pawnEntityId}: ${status}${elapsed}${state ? ` ${state}` : ""}`);
    }
    const sensed = controller.perception?.[0];
    if (sensed) {
      lines.push(
        `  sense ${controller.pawnEntityId}: ${sensed.sense}:${sensed.sourceEntityId} d:${sensed.distance.toFixed(1)}`,
      );
    }
    if (controller.query) {
      lines.push(`  query ${controller.pawnEntityId}: ${formatAiQueryDebug(controller.query)}`);
    }
    const patrol = controller.patrolRoute;
    if (patrol) {
      const source = patrol.source === "spline"
        ? `spline:${patrol.splineId ?? "unset"}${controller.patrolSplineMissing ? " (missing)" : ""}`
        : `targetPoints${patrol.targetPointTag ? `:${patrol.targetPointTag}` : ""}`;
      lines.push(`  patrol ${controller.pawnEntityId}: ${source}`);
    }
    const knownPositions = formatAiKnownPositions(controller.blackboard.entries);
    if (knownPositions.length > 0) {
      lines.push(`  known ${controller.pawnEntityId}: ${knownPositions.join(" ")}`);
    }
    lines.push(
      `  ${controller.pawnEntityId} goal:${controller.goal ?? "—"} bb:${controller.blackboard.keyCount}`,
    );
  }
  return lines;
}

type AiControllerDebug = AiDebugSnapshot["controllers"][number];

/**
 * Expands a **single focused controller** into a detailed inspector block (pure,
 * DOM-free for unit tests) for the runtime `?debug` overlay — the richer sibling
 * of {@link formatAiDebug}'s one-line-per-controller summary:
 *   - active behavior path (full `a > b > c`, plus status/elapsed/failed decorator)
 *   - every blackboard key with its live value (capped at `topBlackboard`)
 *   - the currently perceived stimuli (capped at `topStimuli`)
 *   - the last environment query result, when present.
 *
 * Returns `[]` while the subsystem is gated off (editor edit mode has no live
 * values) or when there are no controllers. The focused controller is the first
 * one currently perceiving a stimulus, falling back to the first controller, so
 * the overlay stays bounded even in a crowd.
 */
export function formatAiInspector(
  snapshot: AiDebugSnapshot,
  topBlackboard = 8,
  topStimuli = 4,
): string[] {
  if (!snapshot.enabled || snapshot.controllers.length === 0) return [];
  const focus =
    snapshot.controllers.find((controller) => (controller.perception?.length ?? 0) > 0) ??
    snapshot.controllers[0];
  if (!focus) return [];

  const lines = [`ai inspect ${focus.pawnEntityId}`];

  const stateTree = focus.stateTree;
  if (stateTree) {
    const asset = focus.stateTreeAsset?.split("/").at(-1);
    lines.push(`  st: ${asset ?? "—"} goal:${focus.goal ?? "—"}`);
    const status = stateTree.lastStatus ?? "idle";
    lines.push(`    ${status} ${stateTree.elapsedSeconds.toFixed(2)}s`);
    if (stateTree.activePath.length > 0) {
      lines.push(`    state: ${stateTree.activePath.join(" > ")}`);
    }
    const transition = stateTree.lastTransition;
    if (transition) {
      lines.push(`    from: ${transition.from ?? "—"} → ${transition.to} (${transition.reason})`);
    }
  } else {
    const asset = focus.behaviorTreeAsset?.split("/").at(-1);
    lines.push(`  bt: ${asset ?? "—"} goal:${focus.goal ?? "—"}`);
    const behavior = focus.behavior;
    if (behavior) {
      const status = behavior.lastStatus ?? "idle";
      lines.push(`    ${status} ${behavior.elapsedSeconds.toFixed(2)}s`);
      if (behavior.activePath.length > 0) {
        lines.push(`    path: ${behavior.activePath.join(" > ")}`);
      }
      if (behavior.failedDecorator) lines.push(`    fail: ${behavior.failedDecorator}`);
    }
  }

  const entries = focus.blackboard.entries;
  lines.push(`  bb (${focus.blackboard.keyCount}):`);
  for (const entry of entries.slice(0, Math.max(0, topBlackboard))) {
    lines.push(`    ${entry.key} [${entry.kind}] = ${formatBlackboardValue(entry.value)}`);
  }
  if (entries.length > topBlackboard) lines.push(`    … +${entries.length - topBlackboard} more`);

  const stimuli = focus.perception ?? [];
  if (stimuli.length > 0) {
    lines.push(`  sense (${stimuli.length}):`);
    for (const stimulus of stimuli.slice(0, Math.max(0, topStimuli))) {
      const los = stimulus.lineOfSight === undefined ? "" : stimulus.lineOfSight ? " los" : " noLos";
      lines.push(
        `    ${stimulus.sense}:${stimulus.sourceEntityId} d:${stimulus.distance.toFixed(1)} s:${stimulus.strength.toFixed(2)}${los}`,
      );
    }
  }

  if (focus.query) lines.push(`  query: ${formatAiQueryDebug(focus.query)}`);
  return lines;
}

/** Compact, overlay-friendly rendering of a blackboard value by runtime type. */
function formatBlackboardValue(value: AiControllerDebug["blackboard"]["entries"][number]["value"]): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value;
  if (isVec3Value(value)) return formatVec3Compact(value);
  return String(value);
}

function formatAiQueryDebug(
  query: NonNullable<AiDebugSnapshot["controllers"][number]["query"]>,
): string {
  const name = query.query.split("/").at(-1) ?? query.query;
  if (query.status === "failure") {
    return `${name} fail c:${query.candidateCount}${query.failureReason ? ` ${query.failureReason}` : ""}`;
  }
  const winner = query.winner;
  const winnerId = winner?.entityId ?? winner?.id ?? "none";
  const score = winner ? ` score:${winner.score.toFixed(2)}` : "";
  return `${name} win:${winnerId}${score} c:${query.candidateCount}`;
}

function formatAiKnownPositions(
  entries: readonly { readonly key: string; readonly kind: string; readonly value: unknown }[],
): string[] {
  const positions: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== "vec3" || !isVec3Value(entry.value)) continue;
    const key = entry.key.toLowerCase();
    if (
      !key.includes("lastknown") &&
      !key.includes("lastheard") &&
      !key.includes("laststimulus") &&
      !(key.includes("known") && key.includes("position"))
    ) {
      continue;
    }
    positions.push(`${entry.key}:${formatVec3Compact(entry.value)}`);
    if (positions.length >= 3) break;
  }
  return positions;
}

function isVec3Value(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function formatVec3Compact(value: readonly [number, number, number]): string {
  return `(${value[0].toFixed(1)},${value[1].toFixed(1)},${value[2].toFixed(1)})`;
}

/** The AI navigation block, or "" without a snapshot or with no live followers. */
function aiNavDebugText(app: RuntimeStatsApp): string {
  const snapshot = app.getAiNavigationDebugSnapshot?.();
  if (!snapshot || snapshot.followers.length === 0) return "";
  return `\n${formatAiNavDebug(snapshot).join("\n")}`;
}

/** Generic Spline follower block, or "" when the runtime has none. */
function splinePathFollowerDebugText(app: RuntimeStatsApp): string {
  const followers = app.getSplinePathFollowerDebugSnapshot?.() ?? [];
  if (followers.length === 0) return "";
  const lines = [`spline followers (${followers.length})`];
  for (const follower of followers.slice(0, 4)) {
    const missing = follower.missingSpline ? " missing" : "";
    lines.push(`  ${follower.entityId}: ${follower.splineId} d:${follower.distance.toFixed(2)}${missing}`);
  }
  return `\n${lines.join("\n")}`;
}

/**
 * Formats an {@link AiNavigationDebugSnapshot} into overlay lines (pure, DOM-free
 * for unit tests): each path follower's status, waypoint progress, stuck-recovery
 * replans and the seconds it has stalled without progress. Caps the list so a
 * crowd of moving NPCs can't flood the overlay.
 */
export function formatAiNavDebug(snapshot: AiNavigationDebugSnapshot, topN = 4): string[] {
  const lines = [`ai nav (${snapshot.followers.length})`];
  for (const follower of snapshot.followers.slice(0, Math.max(0, topN))) {
    const waypoint =
      follower.pathLength > 0 ? ` wp:${follower.waypointIndex}/${follower.pathLength}` : "";
    const replans = follower.replans > 0 ? ` replans:${follower.replans}` : "";
    const stall =
      follower.secondsWithoutProgress >= 0.5
        ? ` stall:${follower.secondsWithoutProgress.toFixed(1)}s`
        : "";
    lines.push(`  ${follower.entityId}: ${follower.status}${waypoint}${replans}${stall}`);
  }
  return lines;
}

/** The UI inspector block, or "" when the app exposes no snapshot (editor). */
function uiDebugText(app: RuntimeStatsApp): string {
  if (!app.getUiDebugSnapshot) return "";
  return `\n${formatUiDebug(app.getUiDebugSnapshot()).join("\n")}`;
}

/**
 * Formats a {@link UiDebugSnapshot} into overlay lines (pure, DOM-free for unit
 * tests): the mounted HUD, the active screen stack (bottom → top) and each
 * bound ViewModel field. Long string values are clipped to keep lines readable.
 */
export function formatUiDebug(snapshot: UiDebugSnapshot): string[] {
  const lines = [
    "ui",
    `hud: ${snapshot.hud ?? "none"}`,
    snapshot.screens.length > 0
      ? `screens(${snapshot.screens.length}): ${snapshot.screens.join(" > ")}`
      : "screens: none",
    `locale: ${snapshot.locale ?? "none"}`,
    `world: ${snapshot.world.visible}/${snapshot.world.count}`,
  ];
  if (snapshot.fields.length === 0) {
    lines.push("fields: none");
  } else {
    lines.push(`fields(${snapshot.fields.length}):`);
    for (const [path, value] of snapshot.fields) {
      lines.push(`  ${path} = ${formatFieldValue(value)}`);
    }
  }
  if (snapshot.audit.length > 0) {
    lines.push(`a11y(${snapshot.audit.length}):`);
    for (const issue of snapshot.audit) lines.push(`  ${issue}`);
  }
  return lines;
}

/** Renders a store value compactly; strings are quoted and clipped at 32 chars. */
function formatFieldValue(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  const clipped = value.length > 32 ? `${value.slice(0, 29)}...` : value;
  return `"${clipped}"`;
}

function scriptMessageDebugText(app: RuntimeStatsApp): string {
  const snapshot = app.getScriptMessageDebugSnapshot();
  const { lastFlush, recentMessages } = snapshot;
  const lines = [
    "",
    "script messages",
    `flush p:${lastFlush.processed} d:${lastFlush.delivered} w:${lastFlush.warnings.length}`,
    `subscribers: ${snapshot.subscribers.length}`,
  ];
  for (const entry of recentMessages.slice(-5)) {
    const target = entry.envelope.target ?? "*";
    const payload = JSON.stringify(entry.envelope.payload);
    const payloadText = payload.length > 44 ? `${payload.slice(0, 41)}...` : payload;
    lines.push(
      `${entry.envelope.frame} ${entry.envelope.source}->${target} ${entry.envelope.type} ${entry.status}(${entry.delivered}) ${payloadText}`,
    );
  }
  if (lastFlush.warnings.length > 0) {
    lines.push(`last warning: ${lastFlush.warnings[0]?.code ?? "unknown"}`);
  }
  return `\n${lines.join("\n")}`;
}
