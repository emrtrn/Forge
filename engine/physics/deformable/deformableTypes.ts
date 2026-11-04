/**
 * `<Model>.deformable.json`: how a model dents under impacts (DEFORMABLE_FRACTURABLE
 * Faz 7). Parameters only; dents themselves are runtime state and go to the
 * save-game, never to authored data.
 *
 * A dent is plastic and visual: `collisionPolicy` is `visual_only`, the collider
 * never changes. This normalizer is the single field allowlist for the loader
 * and `/__save-deformable`.
 */

/** Current deformable sidecar version. */
export const DEFORMABLE_ASSET_VERSION = 1;

export interface AssetDeformableDef {
  version: 1;
  /** Off keeps the sidecar but the asset never dents. */
  enabled: boolean;
  mode: "impact";
  /** Impulse below which a hit leaves no mark, N·s. */
  dentImpulse: number;
  /** Impulse that gives a hit its full depth, N·s; always above `dentImpulse`. */
  fullImpulse: number;
  /** Radius of one dent, world metres. */
  radius: number;
  /** Deepest a vertex may ever move from its rest position, metres. */
  maxDepth: number;
  /** Share of `maxDepth` one full hit leaves (0..1); the rest needs repeated hits. */
  plasticity: number;
  /** Most dents one object keeps; a hit elsewhere past this leaves no new dent. */
  maxDents: number; // integer
  collisionPolicy: "visual_only";
}

/** Inclusive numeric bounds shared by normalization and editor sliders. */
export const DEFORMABLE_LIMITS = {
  dentImpulse: [0, 1000000],
  fullImpulse: [0.001, 2000000],
  radius: [0.01, 10],
  maxDepth: [0.001, 2],
  plasticity: [0, 1],
  maxDents: [1, 64],
} as const;

/** Defaults of a new sidecar; starting values, not measured ones. */
export const DEFORMABLE_DEFAULTS: Readonly<AssetDeformableDef> = {
  version: DEFORMABLE_ASSET_VERSION,
  enabled: true,
  mode: "impact",
  dentImpulse: 300,
  fullImpulse: 3000,
  radius: 0.35,
  maxDepth: 0.12,
  plasticity: 0.5,
  maxDents: 32,
  collisionPolicy: "visual_only",
};

export function createAssetDeformable(): AssetDeformableDef {
  return { ...DEFORMABLE_DEFAULTS };
}

function bounded(value: unknown, fallback: number, limits: readonly [number, number], integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(limits[0], Math.min(limits[1], integer ? Math.round(value) : value));
}

/** Normalizes the shared loader/save field shape; unsupported objects return null. */
export function normalizeAssetDeformable(value: unknown): AssetDeformableDef | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    ("version" in input && input.version !== DEFORMABLE_ASSET_VERSION) ||
    ("mode" in input && input.mode !== "impact") ||
    ("collisionPolicy" in input && input.collisionPolicy !== "visual_only")
  ) {
    return null;
  }
  const defaults = DEFORMABLE_DEFAULTS;
  const dentImpulse = bounded(input.dentImpulse, defaults.dentImpulse, DEFORMABLE_LIMITS.dentImpulse);
  const fullImpulse = bounded(input.fullImpulse, defaults.fullImpulse, DEFORMABLE_LIMITS.fullImpulse);
  return {
    version: DEFORMABLE_ASSET_VERSION,
    enabled: typeof input.enabled === "boolean" ? input.enabled : defaults.enabled,
    mode: "impact",
    dentImpulse,
    // The depth ramp divides by their difference.
    fullImpulse: fullImpulse > dentImpulse ? fullImpulse : dentImpulse + 1,
    radius: bounded(input.radius, defaults.radius, DEFORMABLE_LIMITS.radius),
    maxDepth: bounded(input.maxDepth, defaults.maxDepth, DEFORMABLE_LIMITS.maxDepth),
    plasticity: bounded(input.plasticity, defaults.plasticity, DEFORMABLE_LIMITS.plasticity),
    maxDents: bounded(input.maxDents, defaults.maxDents, DEFORMABLE_LIMITS.maxDents, true),
    collisionPolicy: "visual_only",
  };
}

/** Maps a model path to its deformable sidecar, following the collision sidecar rule. */
export function deformableSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalized.replace(/\.[^./]+$/, "")}.deformable.json`;
}
