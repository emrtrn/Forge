/**
 * Pure quality-profile definitions and resolution (Adaptive Performance &
 * Graphics Quality, Faz 2).
 *
 * Side-effect free: no DOM, no three.js, no renderer. This module owns the
 * template `QUALITY_PROFILES` defaults (the `DEFAULT_PERF_BUDGET` pattern — a
 * fork overrides the values, the keys stay shared) and the pure functions that
 * turn a chosen {@link QualityLevel} into effective {@link QualitySettings} and
 * merge those onto authored post-process. The `src/scene` applier adapter takes
 * the resolved values and drives the renderer; that layer is where three.js
 * lives.
 *
 * **Principle #2 (authored data is sacred).** The quality layer only ever turns
 * an effect **off** or scales it **down**. It never enables an effect the
 * author left disabled: an effective gate is `authored && qualityAllows`. So a
 * scene whose `LayoutPostProcess` ships bloom off stays bloom-off on Ultra, and
 * the layout file is never written by the quality layer.
 */

import type { ResolvedPostProcess } from "../scene/postProcess";

export type QualityLevel = "ultra" | "high" | "medium" | "low" | "custom";

/** The four concrete profiles, ordered highest → lowest (adaptive ladder). */
export const QUALITY_LEVELS: readonly Exclude<QualityLevel, "custom">[] = [
  "ultra",
  "high",
  "medium",
  "low",
];

/** Shadow map resolutions the quality layer may select (256 = lowest usable). */
export type ShadowMapSize = 256 | 512 | 1024 | 2048;

/** Sun shadow cascades in far view mode (OPEN_WORLD_PLAN Faz 7c2; 1 = the 7c1 follow shadow). */
export type ShadowCascadeCount = 1 | 2 | 3 | 4;

/**
 * Core quality settings — every field has a direct applier in today's engine
 * (render scale, pixel ratio, post-process gates, shadows, particles, foliage).
 * Post-process gates are **allow** flags, not force-on: see Principle #2.
 */
export interface QualitySettings {
  /** Composer + renderer internal-resolution scale (1 = native). */
  renderScale: number;
  /** Upper bound on device pixel ratio (replaces the MAX_PIXEL_RATIO constant). */
  maxPixelRatio: number;

  /** Allow the authored GTAO pass (the most expensive pass). */
  aoAllowed: boolean;
  /** Allow the authored Bokeh depth-of-field pass. */
  dofAllowed: boolean;
  /** Allow the authored bloom pass. */
  bloomAllowed: boolean;
  /** Bloom render-target scale when bloom is on (0.5 = half resolution). */
  bloomResolutionScale: 1 | 0.5;
  /** Allow authored SMAA (MSAA is fixed at context creation, so runtime AA = SMAA). */
  smaaAllowed: boolean;

  /** Master shadow toggle (`renderer.shadowMap.enabled`). */
  shadowsEnabled: boolean;
  /** Directional shadow map resolution (2048 is today's hard-coded value). */
  shadowMapSize: ShadowMapSize;
  /** Shadow camera extent multiplier (smaller = shadows fade in nearer). */
  shadowDistanceScale: number;
  /**
   * Sun shadow cascades in far view mode (OPEN_WORLD_PLAN Faz 7c2). Smaller
   * levels keep one bounds-fitted map whatever this says.
   */
  shadowCascades: ShadowCascadeCount;
  /** Redraw cascades 2+ every other frame, alternating (saves ~0.3 ms on Ultra). */
  shadowCascadeStagger: boolean;

  /** Global VFX spawn-rate / maxParticles multiplier (1 = authored density). */
  particleDensity: number;
  /** Foliage cull-distance multiplier (smaller = cull nearer). */
  foliageCullDistanceScale: number;
  /**
   * Procedural grass/foliage ring density (`0..1` keep fraction of each rule's
   * candidates, OPEN_WORLD_PLAN Faz 6). Painted foliage is unaffected.
   */
  grassDensity: number;
  /**
   * CDLOD levels finer than the terrain grid inside the runtime track window
   * (TERRAIN_DEFORMATION Faz 3; each halves the vertex spacing, 0 = flat
   * tracks drawn by shading only, the Faz 2 look).
   */
  terrainTrackDetailLevels: number;
  /**
   * The terrain casts shadows onto itself (ridges onto valleys) as well as
   * receiving them; costs one terrain draw per shadow map / cascade.
   */
  terrainSelfShadow: boolean;
  /**
   * Past 25 m each textured terrain layer blends in a second, rotated sample to
   * break up the repeat grid; costs up to one extra texture read per layer.
   */
  terrainFarTiling: boolean;
  /** Local puddle ripple resolution and planar reflection tier (low = sky only). */
  terrainWaterQuality: "low" | "medium" | "high";
  /** Runtime/viewport ceilings; never enable an effect disabled on the Lake. */
  lakeCausticsAllowed: boolean;
  lakeFoamAllowed: boolean;
  lakeShoreWetnessAllowed: boolean;
  lakeReflectionQuality: "off" | "medium" | "high";
  lakeMaxRipples: number;
}

/**
 * Extension settings whose mechanism is Phase-7 optional or fork-owned. AI,
 * far-animation cadence and dynamic-physics active areas have generic runtime
 * appliers; scene chunking, LOD, NPC budgets and texture streaming remain
 * fork-specific. Template profiles do **not** write these; a fork opts in with
 * values appropriate to its world scale.
 */
export interface QualityExtensions {
  viewDistanceMultiplier?: number;
  lodBias?: number;
  npcBudgetMultiplier?: number;
  aiUpdateHz?: number;
  farAnimationUpdateHz?: number;
  physicsActiveDistance?: number;
  maxTextureSize?: 512 | 1024 | 2048;
}

/**
 * Template default profiles. A fork overrides the **values** (a dense-NPC sim
 * and a tiny service game have different budgets); the **names** and setting
 * **keys** stay shared across forks (plan §6.1).
 */
export const QUALITY_PROFILES: Record<Exclude<QualityLevel, "custom">, QualitySettings> = {
  ultra: {
    renderScale: 1.0,
    maxPixelRatio: 2.0,
    aoAllowed: true,
    dofAllowed: true,
    bloomAllowed: true,
    bloomResolutionScale: 1,
    smaaAllowed: true,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    shadowDistanceScale: 1.0,
    shadowCascades: 4,
    shadowCascadeStagger: true,
    particleDensity: 1.0,
    foliageCullDistanceScale: 1.0,
    grassDensity: 1.0,
    terrainTrackDetailLevels: 2,
    terrainSelfShadow: true,
    terrainFarTiling: true,
    terrainWaterQuality: "high",
    lakeCausticsAllowed: true,
    lakeFoamAllowed: true,
    lakeShoreWetnessAllowed: true,
    lakeReflectionQuality: "high",
    lakeMaxRipples: 24,
  },
  high: {
    renderScale: 1.0,
    maxPixelRatio: 1.75,
    aoAllowed: true,
    dofAllowed: true,
    bloomAllowed: true,
    bloomResolutionScale: 1,
    smaaAllowed: true,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    shadowDistanceScale: 0.75,
    shadowCascades: 3,
    shadowCascadeStagger: false,
    particleDensity: 0.8,
    foliageCullDistanceScale: 0.85,
    grassDensity: 0.8,
    terrainTrackDetailLevels: 2,
    terrainSelfShadow: true,
    terrainFarTiling: true,
    terrainWaterQuality: "high",
    lakeCausticsAllowed: true,
    lakeFoamAllowed: true,
    lakeShoreWetnessAllowed: true,
    lakeReflectionQuality: "medium",
    lakeMaxRipples: 24,
  },
  medium: {
    renderScale: 0.85,
    maxPixelRatio: 1.5,
    aoAllowed: false,
    dofAllowed: false,
    bloomAllowed: true,
    bloomResolutionScale: 0.5,
    smaaAllowed: true,
    shadowsEnabled: true,
    shadowMapSize: 512,
    shadowDistanceScale: 0.5,
    shadowCascades: 2,
    shadowCascadeStagger: false,
    particleDensity: 0.55,
    foliageCullDistanceScale: 0.65,
    grassDensity: 0.55,
    terrainTrackDetailLevels: 1,
    terrainSelfShadow: false,
    terrainFarTiling: false,
    terrainWaterQuality: "medium",
    lakeCausticsAllowed: false,
    lakeFoamAllowed: true,
    lakeShoreWetnessAllowed: true,
    lakeReflectionQuality: "off",
    lakeMaxRipples: 12,
  },
  low: {
    renderScale: 0.7,
    maxPixelRatio: 1.0,
    aoAllowed: false,
    dofAllowed: false,
    bloomAllowed: false,
    bloomResolutionScale: 0.5,
    smaaAllowed: false,
    shadowsEnabled: false,
    shadowMapSize: 256,
    shadowDistanceScale: 0.35,
    shadowCascades: 2,
    shadowCascadeStagger: false,
    particleDensity: 0.3,
    foliageCullDistanceScale: 0.45,
    grassDensity: 0.3,
    terrainTrackDetailLevels: 0,
    terrainSelfShadow: false,
    terrainFarTiling: false,
    terrainWaterQuality: "low",
    lakeCausticsAllowed: false,
    lakeFoamAllowed: false,
    lakeShoreWetnessAllowed: false,
    lakeReflectionQuality: "off",
    lakeMaxRipples: 8,
  },
};

/** Player-facing graphics preferences persisted in {@link UserSettings.graphics}.
 *
 * These are the player's *intent* (the profile they chose, whether adaptive
 * tuning may run, their FPS target) — not the adaptive controller's transient
 * runtime overrides, which are never persisted. When `selectedQualityLevel` is
 * `"custom"`, `customSettings` layers over the base (Faz 7 advanced sliders). */
export interface GraphicsPreferences {
  /** Whether the adaptive quality controller (Faz 6) may fine-tune at runtime. */
  adaptiveOptimizationEnabled: boolean;
  /** Frame-time budget target the adaptive controller aims for. */
  targetFrameRate: 30 | 60;
  /** The player's chosen profile (or `"custom"` for hand-tuned settings). */
  selectedQualityLevel: QualityLevel;
  /** When a manual profile is selected, whether adaptive may still nudge within it. */
  allowAdaptiveFineTuning: boolean;
  /**
   * True once the player explicitly picked a profile in the settings menu. Startup
   * auto-calibration (Faz 4) and adaptive overrides must respect this as the
   * player's deliberate choice: a manual selection always beats auto-calibration.
   */
  manuallySelected: boolean;
  /**
   * True once the one-time first-gameplay measurement calibration (Faz 4) has run.
   * Prevents re-calibrating every session — the measured profile is remembered.
   */
  startupCalibrated: boolean;
  /** Partial overrides layered onto the base when `selectedQualityLevel` is `"custom"`. */
  customSettings?: Partial<QualitySettings>;
}

/** The two supported frame-time targets (60 = smooth, 30 = weak-device floor). */
export const TARGET_FRAME_RATES = [30, 60] as const;

/** Every valid {@link QualityLevel}, for menu enumeration + normalization. */
export const QUALITY_LEVEL_VALUES: readonly QualityLevel[] = [...QUALITY_LEVELS, "custom"];

/** Narrow guard: a valid {@link QualityLevel} string. */
export function isQualityLevel(value: unknown): value is QualityLevel {
  return typeof value === "string" && (QUALITY_LEVEL_VALUES as readonly string[]).includes(value);
}

/**
 * Template default preferences for a fresh player: adaptive on, 60 FPS target,
 * Medium profile (the plan §5.2 "auto" starting point). A fork may ship a
 * different default by writing its own {@link GraphicsPreferences}.
 */
export function defaultGraphicsPreferences(): GraphicsPreferences {
  return {
    adaptiveOptimizationEnabled: true,
    targetFrameRate: 60,
    selectedQualityLevel: "medium",
    allowAdaptiveFineTuning: true,
    manuallySelected: false,
    startupCalibrated: false,
  };
}

/**
 * Normalizes an unknown persisted value into valid {@link GraphicsPreferences},
 * falling back to {@link defaultGraphicsPreferences} field-by-field (the defensive
 * store pattern — an old or partial record never crashes, it just fills gaps).
 * `customSettings` is dropped unless the level is `"custom"` (a stale override
 * on a concrete profile would be misleading), and only known numeric/boolean
 * quality keys survive the whitelist.
 */
export function normalizeGraphicsPreferences(value: unknown): GraphicsPreferences {
  const defaults = defaultGraphicsPreferences();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const level = isQualityLevel(raw.selectedQualityLevel)
    ? raw.selectedQualityLevel
    : defaults.selectedQualityLevel;
  const target = raw.targetFrameRate === 30 || raw.targetFrameRate === 60
    ? raw.targetFrameRate
    : defaults.targetFrameRate;
  const prefs: GraphicsPreferences = {
    adaptiveOptimizationEnabled:
      typeof raw.adaptiveOptimizationEnabled === "boolean"
        ? raw.adaptiveOptimizationEnabled
        : defaults.adaptiveOptimizationEnabled,
    targetFrameRate: target,
    selectedQualityLevel: level,
    allowAdaptiveFineTuning:
      typeof raw.allowAdaptiveFineTuning === "boolean"
        ? raw.allowAdaptiveFineTuning
        : defaults.allowAdaptiveFineTuning,
    manuallySelected:
      typeof raw.manuallySelected === "boolean"
        ? raw.manuallySelected
        : defaults.manuallySelected,
    startupCalibrated:
      typeof raw.startupCalibrated === "boolean"
        ? raw.startupCalibrated
        : defaults.startupCalibrated,
  };
  if (level === "custom") {
    const custom = normalizeCustomSettings(raw.customSettings);
    if (custom) prefs.customSettings = custom;
  }
  return prefs;
}

/** Whitelisted shallow copy of the {@link QualitySettings} keys a custom override
 * may carry. Unknown keys and wrong types are dropped; returns null when empty. */
function normalizeCustomSettings(value: unknown): Partial<QualitySettings> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: Partial<QualitySettings> = {};
  const num = (k: keyof QualitySettings): void => {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) (out[k] as number) = v;
  };
  const bool = (k: keyof QualitySettings): void => {
    const v = raw[k];
    if (typeof v === "boolean") (out[k] as boolean) = v;
  };
  num("renderScale");
  num("maxPixelRatio");
  bool("aoAllowed");
  bool("dofAllowed");
  bool("bloomAllowed");
  if (raw.bloomResolutionScale === 1 || raw.bloomResolutionScale === 0.5) {
    out.bloomResolutionScale = raw.bloomResolutionScale;
  }
  bool("smaaAllowed");
  bool("shadowsEnabled");
  if (raw.shadowMapSize === 256 || raw.shadowMapSize === 512 || raw.shadowMapSize === 1024 || raw.shadowMapSize === 2048) {
    out.shadowMapSize = raw.shadowMapSize;
  }
  num("shadowDistanceScale");
  if (raw.shadowCascades === 1 || raw.shadowCascades === 2 || raw.shadowCascades === 3 || raw.shadowCascades === 4) {
    out.shadowCascades = raw.shadowCascades;
  }
  bool("shadowCascadeStagger");
  num("particleDensity");
  num("foliageCullDistanceScale");
  num("grassDensity");
  num("terrainTrackDetailLevels");
  bool("terrainSelfShadow");
  bool("terrainFarTiling");
  bool("lakeCausticsAllowed");
  bool("lakeFoamAllowed");
  bool("lakeShoreWetnessAllowed");
  if (typeof raw.lakeMaxRipples === "number" && Number.isFinite(raw.lakeMaxRipples)) {
    out.lakeMaxRipples = Math.max(0, Math.min(24, Math.floor(raw.lakeMaxRipples)));
  }
  if (raw.lakeReflectionQuality === "off" || raw.lakeReflectionQuality === "medium" || raw.lakeReflectionQuality === "high") {
    out.lakeReflectionQuality = raw.lakeReflectionQuality;
  }
  if (raw.terrainWaterQuality === "low" || raw.terrainWaterQuality === "medium" || raw.terrainWaterQuality === "high") {
    out.terrainWaterQuality = raw.terrainWaterQuality;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Fallback base for `custom` when no explicit base level is supplied. */
const DEFAULT_CUSTOM_BASE: Exclude<QualityLevel, "custom"> = "medium";

/**
 * Resolves a {@link QualityLevel} to concrete {@link QualitySettings}.
 *
 * - A concrete level returns a **fresh copy** of its template profile (callers
 *   never mutate the shared `QUALITY_PROFILES` objects).
 * - `"custom"` layers `customSettings` over `baseLevel`'s profile, so a player
 *   who tweaks one advanced slider keeps every other value from their base.
 */
export function resolveQualitySettings(
  level: QualityLevel,
  customSettings?: Partial<QualitySettings>,
  baseLevel: Exclude<QualityLevel, "custom"> = DEFAULT_CUSTOM_BASE,
): QualitySettings {
  if (level === "custom") {
    return { ...QUALITY_PROFILES[baseLevel], ...customSettings };
  }
  return { ...QUALITY_PROFILES[level] };
}

/**
 * Effective renderer pixel ratio for a quality profile: the device ratio capped
 * by {@link QualitySettings.maxPixelRatio}, then scaled by
 * {@link QualitySettings.renderScale}. Folding render scale into the pixel ratio
 * is the standard three.js knob — it shrinks the drawing buffer while the CSS
 * canvas size (and layout) stay put. The result is never zero (guards a bad DPR
 * or a zero scale).
 *
 * On Ultra (scale 1, cap 2) this equals `min(dpr, 2)` — identical to the
 * `MAX_PIXEL_RATIO` value the renderer boots with, so applying Ultra is a no-op.
 */
export function effectiveDevicePixelRatio(
  devicePixelRatio: number,
  quality: QualitySettings,
): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const cap = quality.maxPixelRatio > 0 ? quality.maxPixelRatio : dpr;
  const capped = Math.min(dpr, cap);
  const scaled = capped * quality.renderScale;
  return scaled > 0 ? scaled : capped;
}

/**
 * Merges quality gates onto authored post-process (Principle #2): returns a new
 * {@link ResolvedPostProcess} whose bloom / DoF / GTAO / SMAA are on **only when
 * the author enabled them AND the quality profile allows them**. Every other
 * authored field (colour grading, vignette, exposure, numeric bloom params) is
 * passed through untouched — quality gates effects, it does not re-author them.
 *
 * Bloom's render-target scale is a renderer concern
 * ({@link QualitySettings.bloomResolutionScale}); this function only decides
 * whether bloom runs at all.
 */
export function applyQualityToPostProcess(
  authored: ResolvedPostProcess,
  quality: QualitySettings,
): ResolvedPostProcess {
  return {
    ...authored,
    antialias: quality.smaaAllowed ? authored.antialias : "none",
    bloom: { ...authored.bloom, enabled: authored.bloom.enabled && quality.bloomAllowed },
    dof: { ...authored.dof, enabled: authored.dof.enabled && quality.dofAllowed },
    ao: { ...authored.ao, enabled: authored.ao.enabled && quality.aoAllowed },
  };
}
