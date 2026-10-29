/**
 * Pure adaptive quality control (Adaptive Performance & Graphics Quality, Faz 6).
 *
 * Side-effect free: no DOM, no three.js, no clock of its own. The `src/scene`
 * subsystem wrapper feeds this the windowed {@link FrameMetrics}, the elapsed
 * seconds and a `classify` closure each tick; this module decides whether to
 * step quality down (fast, under load), back up (slow, only once stable) or hold,
 * and layers that as a **transient reduction stack** over the player's base
 * profile. Because it only takes already-measured numbers it is deterministic and
 * unit-tested without a browser.
 *
 * Three ideas from the plan (§9, §10, §12):
 *
 * 1. **Decide, then apply.** {@link decideAdaptiveStep} is the plan §12 pure
 *    decision — none / reduce / increase — driven by frame time vs. the target
 *    with hysteresis (drop fast, raise cautiously) and a cooldown. It never picks
 *    *which* setting to change; that is the applier's job.
 * 2. **One small rung at a time.** The applier walks an ordered reduction ladder
 *    (§10.1 GPU order, §10.2 CPU order) least-visible-first, choosing the first
 *    rung that matches the detected bottleneck family. Effective settings are
 *    always re-folded from the base through the applied stack, so raising quality
 *    is just popping the last rung (LIFO) — no drift, fully reversible.
 * 3. **Never above the player's ceiling.** The base is the player's chosen (or
 *    calibrated) profile. Adaptive only reduces *below* it and restores back *up
 *    to* it — it can never exceed a manual selection (plan §17.3). The transient
 *    reductions are never persisted (plan §17.6); only the base is.
 */

import type { FrameMetrics } from "./frameMetrics";
import type { BottleneckResult, BottleneckType } from "./bottleneckClassifier";
import type { GraphicsPreferences, QualitySettings, ShadowMapSize } from "./qualityProfiles";

/** Target frame time (ms) is exceeded above `target ×` this → degraded (plan §9.1). */
export const DEGRADE_MULTIPLIER = 1.25;
/** Frame time (ms) below `target ×` this reads as comfortable headroom (plan §9.2). */
export const RESTORE_MULTIPLIER = 0.9;
/** Frame-time budget (ms) per FPS target — 60 = smooth, 30 = weak-device floor. */
const TARGET_FRAME_TIME_MS: Record<30 | 60, number> = { 30: 33.3, 60: 16.7 };

/** Coarse bottleneck family a reduction rung addresses (drives rung selection). */
export type BottleneckFamily = "gpu" | "cpu";

/** The §12 decision: hold, step one rung down, or step one rung up. */
export type AdaptiveDecision =
  | { readonly kind: "none" }
  | { readonly kind: "reduce"; readonly bottleneck: BottleneckResult }
  | { readonly kind: "increase" };

/** Frame-time load class for a windowed average against the target (plan §9). */
export type FrameLoad = "degraded" | "stable" | "neutral";

/**
 * Classifies a windowed average frame time against the target: `degraded` above
 * the drop threshold (react fast), `stable` below the raise threshold (headroom),
 * `neutral` in the hysteresis band between (do nothing). Shared by the decision
 * and the controller's stable-duration timer so both use one threshold.
 */
export function classifyFrameLoad(averageFrameTimeMs: number, targetFrameTimeMs: number): FrameLoad {
  if (averageFrameTimeMs > targetFrameTimeMs * DEGRADE_MULTIPLIER) return "degraded";
  if (averageFrameTimeMs < targetFrameTimeMs * RESTORE_MULTIPLIER) return "stable";
  return "neutral";
}

/** Frame-time budget (ms) for a preferences target (plan §9.1). */
export function targetFrameTimeMs(targetFrameRate: 30 | 60): number {
  return TARGET_FRAME_TIME_MS[targetFrameRate];
}

/** State the pure {@link decideAdaptiveStep} reasons over (plan §12). */
export interface AdaptiveDecisionState {
  readonly metrics: FrameMetrics;
  readonly preferences: GraphicsPreferences;
  /** Seconds left before another automatic change is allowed (0 = ready). */
  readonly cooldownRemainingSeconds: number;
  /** Seconds performance has been continuously stable (for the raise gate). */
  readonly stableDurationSeconds: number;
  /** Bottleneck classifier, called only when a reduction is warranted. */
  readonly classify: () => BottleneckResult;
}

/** How long performance must be degraded (via the metrics window) to drop (plan §9.1). */
const DEGRADE_WINDOW_SECONDS = 5;
/** How long performance must be stable before a cautious raise (plan §9.2). */
const STABLE_WINDOW_SECONDS = 45;

/**
 * The plan §12 pure decision core. Returns `reduce` when the average frame time
 * has been degraded across a settled (≥ 5 s) window, `increase` after a long
 * stable stretch, else `none`. Off (adaptive disabled) or within cooldown always
 * holds. It never chooses a specific setting — the controller/applier does.
 */
export function decideAdaptiveStep(state: AdaptiveDecisionState): AdaptiveDecision {
  if (!state.preferences.adaptiveOptimizationEnabled) return { kind: "none" };
  if (state.cooldownRemainingSeconds > 0) return { kind: "none" };

  const target = targetFrameTimeMs(state.preferences.targetFrameRate);
  const load = classifyFrameLoad(state.metrics.averageFrameTimeMs, target);

  // Degraded across a window that already spans the decision horizon → drop.
  if (load === "degraded" && state.metrics.sampleWindowSeconds >= DEGRADE_WINDOW_SECONDS) {
    return { kind: "reduce", bottleneck: state.classify() };
  }
  // Long stable stretch → consider raising one rung.
  if (load === "stable" && state.stableDurationSeconds >= STABLE_WINDOW_SECONDS) {
    return { kind: "increase" };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Reduction ladder (§10.1 GPU order, §10.2 CPU order)
// ---------------------------------------------------------------------------

/** One reversible step along the reduction ladder (plan §10). */
interface ReductionRung {
  readonly id: string;
  /** Which bottleneck families this rung relieves (drives targeted selection). */
  readonly families: readonly BottleneckFamily[];
  /** Short player-facing message when this rung is applied (plan §5.3). */
  readonly message: string;
  /** True when this rung still has room to reduce the given settings. */
  canApply(settings: QualitySettings): boolean;
  /** Returns a new settings object one rung cheaper (never mutates the input). */
  reduce(settings: QualitySettings): QualitySettings;
}

/** Lowest render scale adaptive will descend to (below Low's 0.7 is still legible). */
const RENDER_SCALE_FLOOR = 0.5;
const RENDER_SCALE_STEP = 0.1;
/** Lowest particle density adaptive will descend to. */
const PARTICLE_DENSITY_FLOOR = 0.2;
const PARTICLE_DENSITY_STEP = 0.2;
/** Lowest foliage cull-distance scale adaptive will descend to. */
const FOLIAGE_FLOOR = 0.4;
const FOLIAGE_STEP = 0.15;
/** Float comparison slack so a value sitting on a floor is treated as exhausted. */
const EPSILON = 1e-6;

function lowerShadowMap(size: ShadowMapSize): ShadowMapSize {
  if (size > 1024) return 1024;
  if (size > 512) return 512;
  return 256;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The master ladder, ordered least-visible → most-visible (plan §10.1). GTAO,
 * DoF and particle density go first (barely noticeable); render scale and the
 * pixel-ratio floor are the visible last resorts. Each rung's `canApply` reads
 * the *current* (already-reduced) settings, so applying a rung twice — e.g.
 * shadow map 2048 → 1024 → 512 — needs no external counter; the ladder simply
 * terminates when every rung hits its floor.
 */
const REDUCTION_LADDER: readonly ReductionRung[] = [
  {
    id: "gtao-off",
    families: ["gpu"],
    message: "Ambient occlusion off for performance.",
    canApply: (s) => s.aoAllowed,
    reduce: (s) => ({ ...s, aoAllowed: false }),
  },
  {
    id: "dof-off",
    families: ["gpu"],
    message: "Depth of field off for performance.",
    canApply: (s) => s.dofAllowed,
    reduce: (s) => ({ ...s, dofAllowed: false }),
  },
  {
    id: "particle-density-down",
    families: ["gpu", "cpu"],
    message: "Particle density reduced for performance.",
    canApply: (s) => s.particleDensity > PARTICLE_DENSITY_FLOOR + EPSILON,
    reduce: (s) => ({
      ...s,
      particleDensity: round2(Math.max(PARTICLE_DENSITY_FLOOR, s.particleDensity - PARTICLE_DENSITY_STEP)),
    }),
  },
  {
    id: "lake-reflection-down",
    families: ["gpu"],
    message: "Lake reflection quality reduced for performance.",
    canApply: (s) => s.lakeReflectionQuality !== "off",
    reduce: (s) => ({ ...s, lakeReflectionQuality: s.lakeReflectionQuality === "high" ? "medium" : "off" }),
  },
  {
    id: "lake-caustics-off",
    families: ["gpu"],
    message: "Lake caustics off for performance.",
    canApply: (s) => s.lakeCausticsAllowed,
    reduce: (s) => ({ ...s, lakeCausticsAllowed: false }),
  },
  {
    id: "lake-ripples-down",
    families: ["gpu", "cpu"],
    message: "Lake wheel ripple count reduced for performance.",
    canApply: (s) => s.lakeMaxRipples > 8,
    reduce: (s) => ({ ...s, lakeMaxRipples: s.lakeMaxRipples > 12 ? 12 : 8 }),
  },
  {
    id: "lake-shore-effects-off",
    families: ["gpu"],
    message: "Lake foam and wet shore off for performance.",
    canApply: (s) => s.lakeFoamAllowed || s.lakeShoreWetnessAllowed,
    reduce: (s) => ({ ...s, lakeFoamAllowed: false, lakeShoreWetnessAllowed: false }),
  },
  {
    id: "bloom-half",
    families: ["gpu"],
    message: "Bloom quality lowered for performance.",
    canApply: (s) => s.bloomAllowed && s.bloomResolutionScale === 1,
    reduce: (s) => ({ ...s, bloomResolutionScale: 0.5 }),
  },
  {
    id: "bloom-off",
    families: ["gpu"],
    message: "Bloom off for performance.",
    canApply: (s) => s.bloomAllowed,
    reduce: (s) => ({ ...s, bloomAllowed: false }),
  },
  {
    id: "shadow-map-down",
    families: ["gpu"],
    message: "Shadow quality reduced for performance.",
    canApply: (s) => s.shadowsEnabled && s.shadowMapSize > 256,
    reduce: (s) => ({ ...s, shadowMapSize: lowerShadowMap(s.shadowMapSize) }),
  },
  {
    id: "shadow-distance-down",
    families: ["gpu"],
    message: "Shadow distance reduced for performance.",
    canApply: (s) => s.shadowsEnabled && s.shadowDistanceScale > 0.35 + EPSILON,
    reduce: (s) => ({ ...s, shadowDistanceScale: round2(Math.max(0.35, s.shadowDistanceScale - 0.15)) }),
  },
  {
    id: "smaa-off",
    families: ["gpu"],
    message: "Anti-aliasing off for performance.",
    canApply: (s) => s.smaaAllowed,
    reduce: (s) => ({ ...s, smaaAllowed: false }),
  },
  {
    id: "foliage-cull-down",
    families: ["gpu", "cpu"],
    message: "Foliage distance reduced for performance.",
    canApply: (s) => s.foliageCullDistanceScale > FOLIAGE_FLOOR + EPSILON,
    reduce: (s) => ({
      ...s,
      foliageCullDistanceScale: round2(Math.max(FOLIAGE_FLOOR, s.foliageCullDistanceScale - FOLIAGE_STEP)),
    }),
  },
  {
    id: "render-scale-down",
    families: ["gpu"],
    message: "Render resolution reduced for performance.",
    canApply: (s) => s.renderScale > RENDER_SCALE_FLOOR + EPSILON,
    reduce: (s) => ({ ...s, renderScale: round2(Math.max(RENDER_SCALE_FLOOR, s.renderScale - RENDER_SCALE_STEP)) }),
  },
  {
    id: "pixel-ratio-down",
    families: ["gpu"],
    message: "Render resolution reduced for performance.",
    canApply: (s) => s.maxPixelRatio > 1 + EPSILON,
    reduce: (s) => ({ ...s, maxPixelRatio: 1 }),
  },
];

const RUNG_BY_ID = new Map(REDUCTION_LADDER.map((rung) => [rung.id, rung]));

/** Preferred rung families for a bottleneck verdict; `[]` = take any rung (§9.3). */
function preferredFamilies(type: BottleneckType): readonly BottleneckFamily[] {
  switch (type) {
    case "gpu":
      return ["gpu"];
    case "cpu":
    case "draw-call":
      // CPU / draw-call: shed object counts first (particles, foliage), then any.
      return ["cpu"];
    default:
      // unknown / spike families → a small general step (plan §9.3 fallback).
      return [];
  }
}

/**
 * Picks the next reduction rung for a bottleneck: the first ladder rung (in
 * least-visible-first order) whose family matches the verdict and that still has
 * room; if none match — or the verdict has no preference — the first applicable
 * rung of any family (the general small step, §9.3). Returns null when every
 * rung is at its floor (nothing left to reduce).
 */
export function selectReductionRung(
  settings: QualitySettings,
  bottleneck: BottleneckType,
): ReductionRung | null {
  const families = preferredFamilies(bottleneck);
  if (families.length > 0) {
    for (const rung of REDUCTION_LADDER) {
      if (rung.families.some((f) => families.includes(f)) && rung.canApply(settings)) return rung;
    }
  }
  for (const rung of REDUCTION_LADDER) {
    if (rung.canApply(settings)) return rung;
  }
  return null;
}

/**
 * Re-folds the effective settings from `base` through the applied rung stack in
 * application order. Because rungs read the current value, the same rung id may
 * appear more than once (a repeated shadow-map / render-scale drop). Unknown ids
 * are skipped defensively. This is the single source of the live profile the
 * applier drives, so popping a rung and re-folding is a clean, drift-free raise.
 */
export function effectiveQualitySettings(
  base: QualitySettings,
  appliedRungIds: readonly string[],
): QualitySettings {
  let settings: QualitySettings = { ...base };
  for (const id of appliedRungIds) {
    const rung = RUNG_BY_ID.get(id);
    if (rung) settings = rung.reduce(settings);
  }
  return settings;
}

/** A single automatic change the controller made (for the overlay + undo, §13, §17.3). */
export interface AdaptiveChangeRecord {
  readonly kind: "reduce" | "increase";
  /** Ladder rung applied (reduce) or restored (increase). */
  readonly rungId: string;
  /** Short player-facing message (plan §5.3). */
  readonly message: string;
  /** The bottleneck that motivated a reduction (absent for a raise). */
  readonly bottleneck?: BottleneckResult;
}

/** What one controller tick did, plus the settings to apply when something changed. */
export interface AdaptiveUpdate {
  readonly kind: "none" | "reduce" | "increase";
  /** Effective settings to hand to the applier — present only when kind !== "none". */
  readonly settings?: QualitySettings;
  /** The change record — present only when kind !== "none". */
  readonly change?: AdaptiveChangeRecord;
}

/** Per-tick inputs to {@link AdaptiveQualityController.update}. */
export interface AdaptiveTickInput {
  readonly metrics: FrameMetrics;
  readonly preferences: GraphicsPreferences;
  readonly deltaSeconds: number;
  /**
   * Whether adaptive may act now: the master toggle AND (for a manual profile)
   * the fine-tune permission. The caller resolves this gate (plan §17.3); when
   * false the controller idles and its timers reset.
   */
  readonly active: boolean;
  readonly classify: () => BottleneckResult;
}

/** Tunable windows/cooldowns for {@link AdaptiveQualityController} (plan §9). */
export interface AdaptiveControllerConfig {
  /** Cooldown after a reduction before another change (plan §9.1, default 15 s). */
  readonly reduceCooldownSeconds?: number;
  /** Cooldown after a raise before another change (plan §9.1, default 20 s). */
  readonly increaseCooldownSeconds?: number;
  /** Below this many in-window samples the controller declines to act. */
  readonly minSamples?: number;
}

const DEFAULT_REDUCE_COOLDOWN_SECONDS = 15;
const DEFAULT_INCREASE_COOLDOWN_SECONDS = 20;
const DEFAULT_MIN_SAMPLES = 30;

/**
 * Stateful (but pure — no DOM/clock) adaptive controller. Owns the base profile
 * ceiling, the applied reduction stack, the change cooldown and the stable-time
 * accumulator. Each {@link update} advances timers from the injected delta,
 * consults {@link decideAdaptiveStep} and, on a decision, applies or reverses one
 * ladder rung and returns the freshly folded settings. The `src/scene` subsystem
 * wraps it: it supplies real metrics, resolves the `active` gate and drives the
 * returned settings into the renderer.
 */
export class AdaptiveQualityController {
  private base: QualitySettings;
  private readonly applied: string[] = [];
  private cooldownRemaining = 0;
  private stableDuration = 0;
  private lastChange: AdaptiveChangeRecord | null = null;
  private lastChangeAgeSeconds = 0;

  private readonly reduceCooldownSeconds: number;
  private readonly increaseCooldownSeconds: number;
  private readonly minSamples: number;

  constructor(base: QualitySettings, config: AdaptiveControllerConfig = {}) {
    this.base = { ...base };
    this.reduceCooldownSeconds = config.reduceCooldownSeconds ?? DEFAULT_REDUCE_COOLDOWN_SECONDS;
    this.increaseCooldownSeconds = config.increaseCooldownSeconds ?? DEFAULT_INCREASE_COOLDOWN_SECONDS;
    this.minSamples = config.minSamples ?? DEFAULT_MIN_SAMPLES;
  }

  /**
   * Resets the base ceiling (the player changed profile or a calibration ran).
   * Drops every transient reduction — the new base is applied clean — and clears
   * the timers so the fresh profile gets a full observation window before any
   * automatic change.
   */
  setBase(base: QualitySettings): void {
    this.base = { ...base };
    this.reset();
  }

  /** Clears the applied reductions and all timers (base is kept). */
  reset(): void {
    this.applied.length = 0;
    this.cooldownRemaining = 0;
    this.stableDuration = 0;
    this.lastChange = null;
    this.lastChangeAgeSeconds = 0;
  }

  /** Effective settings the applier should currently be driving (base + reductions). */
  currentSettings(): QualitySettings {
    return effectiveQualitySettings(this.base, this.applied);
  }

  /** Number of reduction rungs currently layered over the base (0 = at ceiling). */
  get reductionDepth(): number {
    return this.applied.length;
  }

  /** The most recent automatic change and its age (seconds), for the overlay + undo. */
  getLastChange(): { record: AdaptiveChangeRecord; ageSeconds: number } | null {
    return this.lastChange ? { record: this.lastChange, ageSeconds: this.lastChangeAgeSeconds } : null;
  }

  /**
   * Reverts the most recent automatic reduction on demand (plan §17.3 one-click
   * undo): pops the last rung and returns the raised settings, or null when there
   * is nothing to undo. Sets the raise cooldown so the controller does not
   * immediately re-drop what the player just restored.
   */
  revertLastChange(): AdaptiveUpdate | null {
    const rungId = this.applied.pop();
    if (rungId === undefined) return null;
    this.cooldownRemaining = this.increaseCooldownSeconds;
    this.stableDuration = 0;
    const settings = this.currentSettings();
    const change: AdaptiveChangeRecord = {
      kind: "increase",
      rungId,
      message: "Reverted automatic quality change.",
    };
    this.lastChange = change;
    this.lastChangeAgeSeconds = 0;
    return { kind: "increase", settings, change };
  }

  /**
   * Advances one tick: decrements the cooldown, tracks how long performance has
   * been stable, then asks {@link decideAdaptiveStep}. A `reduce` applies the next
   * bottleneck-matched ladder rung; an `increase` pops the last rung. Returns the
   * new settings + a change record when something changed, else `{ kind: "none" }`.
   */
  update(input: AdaptiveTickInput): AdaptiveUpdate {
    const { metrics, preferences, deltaSeconds, active, classify } = input;
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    if (this.lastChange) this.lastChangeAgeSeconds += dt;

    // Idle when adaptive can't act: hold timers at zero so a fresh enable starts
    // from a clean observation window.
    if (!active) {
      this.cooldownRemaining = 0;
      this.stableDuration = 0;
      return { kind: "none" };
    }

    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);

    // Not enough settled samples yet → don't accumulate stability or decide.
    if (metrics.sampleCount < this.minSamples || metrics.averageFrameTimeMs <= 0) {
      this.stableDuration = 0;
      return { kind: "none" };
    }

    const target = targetFrameTimeMs(preferences.targetFrameRate);
    const load = classifyFrameLoad(metrics.averageFrameTimeMs, target);
    this.stableDuration = load === "stable" ? this.stableDuration + dt : 0;

    const decision = decideAdaptiveStep({
      metrics,
      preferences,
      cooldownRemainingSeconds: this.cooldownRemaining,
      stableDurationSeconds: this.stableDuration,
      classify,
    });

    if (decision.kind === "reduce") return this.applyReduction(decision.bottleneck);
    if (decision.kind === "increase") return this.applyIncrease();
    return { kind: "none" };
  }

  private applyReduction(bottleneck: BottleneckResult): AdaptiveUpdate {
    const current = this.currentSettings();
    const rung = selectReductionRung(current, bottleneck.type);
    // Every rung is at its floor: nothing to reduce. Arm the cooldown anyway so
    // we don't re-classify every frame while pinned at the bottom.
    if (!rung) {
      this.cooldownRemaining = this.reduceCooldownSeconds;
      return { kind: "none" };
    }
    this.applied.push(rung.id);
    this.cooldownRemaining = this.reduceCooldownSeconds;
    this.stableDuration = 0;
    const change: AdaptiveChangeRecord = {
      kind: "reduce",
      rungId: rung.id,
      message: rung.message,
      bottleneck,
    };
    this.lastChange = change;
    this.lastChangeAgeSeconds = 0;
    return { kind: "reduce", settings: this.currentSettings(), change };
  }

  private applyIncrease(): AdaptiveUpdate {
    const rungId = this.applied.pop();
    // Already at the base ceiling: nothing to raise. Reset the stable timer so
    // the next raise needs another full stable window.
    if (rungId === undefined) {
      this.stableDuration = 0;
      return { kind: "none" };
    }
    this.cooldownRemaining = this.increaseCooldownSeconds;
    this.stableDuration = 0;
    const change: AdaptiveChangeRecord = {
      kind: "increase",
      rungId,
      message: "Performance stable — quality raised.",
    };
    this.lastChange = change;
    this.lastChangeAgeSeconds = 0;
    return { kind: "increase", settings: this.currentSettings(), change };
  }
}

/** Compact one-line summary of the last automatic change for the debug overlay (§13). */
export function formatAdaptiveChange(record: AdaptiveChangeRecord, ageSeconds: number): string {
  const age = `${Math.round(ageSeconds)}s`;
  if (record.kind === "reduce" && record.bottleneck) {
    const b = record.bottleneck;
    return `last: ${record.rungId} (${b.type}, conf ${b.confidence.toFixed(2)}, ${age})`;
  }
  return `last: ${record.rungId} (${record.kind}, ${age})`;
}
