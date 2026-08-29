/**
 * Pure bottleneck classification (Adaptive Performance & Graphics Quality, Faz 5).
 *
 * Side-effect free: no DOM, no three.js, no clock. It reasons over
 * already-collected signals — {@link FrameMetrics}, the CPU
 * {@link SubsystemProfileSnapshot}, the perf-budget rows and (rarely) a
 * render-scale probe — and returns a probability-weighted verdict with evidence.
 * Because it only takes numbers, it is deterministic and unit-tested without a
 * browser.
 *
 * The browser cannot cleanly separate GPU from CPU time on every device (plan
 * §8), so this is **probabilistic**, not a measurement. It leans first on the
 * free *passive* signals Forge already has (plan §8.1):
 *
 * - Smooth average but a hitchy P95 → a spike, not steady load. Don't drop
 *   quality; blame a load / GC / shader compile (transient / asset / memory).
 * - Sustained over-budget frame + subsystems explaining most of it → **CPU**
 *   bound, and the profiler already names the worst subsystem to target (§10.2).
 * - Sustained over-budget frame + subsystems explaining little → the cost is
 *   off-CPU → **GPU** / compositor (or draw-call prep, which a budget overage
 *   disambiguates).
 *
 * Only when the passive signals are inconclusive does a caller run the rare,
 * short render-scale probe (§8.2) and feed its result back in as extra evidence.
 */

import type { SubsystemProfileSnapshot } from "../core/subsystemProfiler";
import type { BudgetMetric } from "./perfBudget";
import type { FrameMetrics } from "./frameMetrics";

/** The §8 bottleneck taxonomy. `unknown` = no clean signal (take a small step). */
export type BottleneckType =
  | "gpu"
  | "cpu"
  | "draw-call"
  | "asset-loading"
  | "memory-pressure"
  | "transient-spike"
  | "unknown";

/** A classification with its confidence and human-readable evidence (§8). */
export interface BottleneckResult {
  readonly type: BottleneckType;
  /** 0–1 probability weight — low when signals are weak or conflicting. */
  readonly confidence: number;
  /** Short signals that fed the verdict (for the debug overlay / log). */
  readonly evidence: readonly string[];
  /** For a `cpu` verdict, the most expensive subsystem to target first (§10.2). */
  readonly suspectSubsystemId?: string;
}

/** Result of the rare fallback render-scale comparison probe (§8.2). */
export interface GpuProbeResult {
  /** Fractional frame-time improvement when render scale was dropped (0–1). */
  readonly improvedFraction: number;
}

/** Everything {@link classifyBottleneck} reasons over. */
export interface BottleneckInput {
  /** Windowed frame-time stats (the settled decision window). */
  readonly metrics: FrameMetrics;
  /** CPU subsystem timings, or null when the profiler is not attached. */
  readonly subsystems: SubsystemProfileSnapshot | null;
  /** Perf-budget rows (draw calls / tris / textures), or null. */
  readonly budget: readonly BudgetMetric[] | null;
  /** Frame-time budget for the player's FPS target (16.7 for 60, 33.3 for 30). */
  readonly targetFrameTimeMs: number;
  /** A load / spawn happened in the recent window (correlates spikes, §8.4). */
  readonly recentAssetActivity?: boolean;
  /** JS heap is near its limit (a GC-pressure hint, never a primary signal, §3.1). */
  readonly memoryPressure?: boolean;
  /** Optional fallback probe result when passive signals were inconclusive (§8.2). */
  readonly gpuProbe?: GpuProbeResult | null;
}

/** Frame counted as over budget above target × this (matches the controller, §9.1). */
const DEGRADE_MULTIPLIER = 1.25;
/** P95 above target × this, with an OK average, reads as a hitch not steady load. */
const SPIKE_P95_MULTIPLIER = 2;
/**
 * Measured CPU explaining ≥ this share of the frame → CPU bound.
 *
 * Reviewed when frame regions landed (F1) and deliberately left where it was.
 * The window these are read against widened that day — `totalAverageMs` used
 * to cover only the engine subsystem block, and now covers every top-level
 * region of the frame, so a frame whose cost sat in the Game Mode or the
 * render submit used to read as `gpu` purely because nothing had measured it.
 * That was a bug in the input, not in the thresholds: 60% of the frame spent
 * on CPU meant CPU-bound before and means it now. Moving the numbers to
 * compensate for a signal that has just become correct would be guessing, and
 * they are re-tuned when there is data saying so.
 *
 * Diagnostic-only regions stay out of that total (see `debugOnlyAverageMs`),
 * so running the overlay cannot tip its own verdict.
 */
const CPU_SHARE_HIGH = 0.6;
/** Measured CPU explaining ≤ this share → the rest is off-CPU (GPU/compositor). */
const CPU_SHARE_LOW = 0.35;
/** Render-scale probe improvement that counts as confirming a GPU bottleneck. */
const PROBE_IMPROVEMENT = 0.15;

/**
 * Classifies the current bottleneck from passive signals first, falling back to
 * a supplied render-scale probe only when the passive picture is ambiguous. See
 * the module doc + plan §8 for the reasoning; the decision order mirrors §9.3.
 */
export function classifyBottleneck(input: BottleneckInput): BottleneckResult {
  const { metrics, subsystems, budget, targetFrameTimeMs } = input;
  const avg = metrics.averageFrameTimeMs;
  const p95 = metrics.p95FrameTimeMs;
  const degradeMs = targetFrameTimeMs * DEGRADE_MULTIPLIER;
  const averageOk = avg <= degradeMs;
  const hitchy = p95 > targetFrameTimeMs * SPIKE_P95_MULTIPLIER;

  // 1) Spike family (§9.3, top of the tree): a smooth average with a bad P95 is a
  // transient hitch, not steady load — dropping quality would be the wrong fix.
  if (averageOk && hitchy) {
    const base = [`avg ${avg.toFixed(1)}ms ok, p95 ${p95.toFixed(1)}ms hitchy`];
    if (input.memoryPressure) {
      return { type: "memory-pressure", confidence: 0.6, evidence: [...base, "heap under pressure"] };
    }
    if (input.recentAssetActivity) {
      return { type: "asset-loading", confidence: 0.7, evidence: [...base, "recent load/spawn"] };
    }
    return { type: "transient-spike", confidence: 0.5, evidence: base };
  }

  // Sustained branches only apply when the average itself is over budget.
  if (!averageOk) {
    const subsystemTotal = subsystems?.totalAverageMs ?? 0;
    const cpuShare = avg > 0 ? subsystemTotal / avg : 0;
    const sharePct = Math.round(cpuShare * 100);

    // 2) CPU bound: engine subsystems explain most of the frame. The profiler
    // already ranks them, so the worst one is the target (§10.2).
    if (subsystems && subsystemTotal > 0 && cpuShare >= CPU_SHARE_HIGH) {
      const suspect = subsystems.subsystems[0];
      const evidence = [`subsystem cpu ${subsystemTotal.toFixed(1)}ms (${sharePct}% of frame)`];
      if (suspect) evidence.push(`top: ${suspect.id} ${suspect.averageMs.toFixed(1)}ms`);
      return {
        type: "cpu",
        confidence: clamp01(0.5 + (cpuShare - CPU_SHARE_HIGH)),
        evidence,
        ...(suspect ? { suspectSubsystemId: suspect.id } : {}),
      };
    }

    // 3) Draw-call bound: over the draw-call budget while CPU didn't explain the
    // frame — draw-call prep is CPU+GPU and shows in the "unexplained" part (§8.3).
    const drawOver = budget?.find((m) => m.key === "drawCalls" && m.over);
    if (drawOver) {
      const probeWeak = input.gpuProbe ? input.gpuProbe.improvedFraction < PROBE_IMPROVEMENT : false;
      const evidence = [`draw calls ${drawOver.value}/${drawOver.budget} over budget`];
      if (probeWeak) evidence.push("render-scale probe gained little");
      return { type: "draw-call", confidence: probeWeak ? 0.75 : 0.6, evidence };
    }

    // 4) GPU bound: frame over budget but subsystems explain little → the work is
    // GPU / compositor. A confirming probe raises confidence (§8.1, §8.2).
    if (cpuShare <= CPU_SHARE_LOW) {
      const probe = input.gpuProbe;
      const confirmed = probe ? probe.improvedFraction >= PROBE_IMPROVEMENT : false;
      const evidence = subsystems
        ? [`subsystem cpu ${subsystemTotal.toFixed(1)}ms (${sharePct}% of frame) — rest off-CPU`]
        : [`frame ${avg.toFixed(1)}ms over budget, cpu timing unavailable`];
      if (confirmed) evidence.push(`render-scale probe -${Math.round(probe!.improvedFraction * 100)}%`);
      return { type: "gpu", confidence: confirmed ? 0.85 : 0.55, evidence };
    }

    // Ambiguous CPU share (between low and high): a positive probe tips it to GPU.
    if (input.gpuProbe && input.gpuProbe.improvedFraction >= PROBE_IMPROVEMENT) {
      return {
        type: "gpu",
        confidence: 0.6,
        evidence: [`render-scale probe -${Math.round(input.gpuProbe.improvedFraction * 100)}%`],
      };
    }
  }

  // 5) Unknown: no dominant signal → the controller takes a small, safe general
  // step (§9.3 fallback). Low confidence keeps that step conservative.
  return {
    type: "unknown",
    confidence: 0.2,
    evidence: [averageOk ? "within budget" : "no dominant signal"],
  };
}

/** Compact one-line description of a verdict for the debug overlay / log. */
export function describeBottleneck(result: BottleneckResult): string {
  return `${result.type} (conf ${result.confidence.toFixed(2)})`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
