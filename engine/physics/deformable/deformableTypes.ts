/**
 * `<Model>.deformable.json`: how a model dents under impacts (DEFORMABLE_FRACTURABLE
 * Faz 7). Parameters only; dents themselves are runtime state and go to the
 * save-game, never to authored data.
 *
 * A dent is plastic and visual: `collisionPolicy` is `visual_only`, the collider
 * never changes. This normalizer is the single field allowlist for the loader
 * and `/__save-deformable`.
 *
 * `parts` splits a model into pieces that take their own dents (a car's doors).
 * A hit inside a part's zone lands on that part's meshes alone; every mesh outside
 * the parts is the body. A model without parts dents as one surface.
 */

/** Current deformable sidecar version. */
export const DEFORMABLE_ASSET_VERSION = 1;

/** Most parts one model may list. */
export const DEFORMABLE_MAX_PARTS = 32;

export type DeformableVec3 = [number, number, number];

/** A box in the object's root space with its scale applied, metres. */
export interface DeformablePartZone {
  min: DeformableVec3;
  max: DeformableVec3;
}

/** A separately denting piece of a model. */
export interface AssetDeformablePart {
  /** Unique in the model and stable across model revisions. */
  id: string;
  /** Model node names; every mesh at or below one of them belongs to the part. */
  nodes: string[];
  /**
   * Where hits count for this part. A hit is first placed on the model along its
   * line, so the zone holds the outer surface there, not the collider's contact
   * point. On a car that surface can be a wider panel than the part itself.
   */
  zone: DeformablePartZone;
}

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
  /** Checked in list order, so an earlier zone wins where two overlap. Omitted when empty. */
  parts?: AssetDeformablePart[];
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

function readVec3(value: unknown): DeformableVec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value as unknown[];
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) && typeof z === "number" && Number.isFinite(z)
    ? [x, y, z]
    : null;
}

function normalizePart(value: unknown): AssetDeformablePart | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const nodes = Array.isArray(input.nodes)
    ? [...new Set(input.nodes.filter((node): node is string => typeof node === "string" && node.length > 0))]
    : [];
  const zone = input.zone as Record<string, unknown> | null | undefined;
  const min = readVec3(zone?.min);
  const max = readVec3(zone?.max);
  if (!id || nodes.length === 0 || !min || !max) return null;
  if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2]) return null;
  return { id, nodes, zone: { min, max } };
}

/** Valid parts only, the first of a repeated id wins. */
function normalizeParts(value: unknown): AssetDeformablePart[] {
  if (!Array.isArray(value)) return [];
  const parts = new Map<string, AssetDeformablePart>();
  for (const raw of value) {
    const part = normalizePart(raw);
    if (part && !parts.has(part.id)) parts.set(part.id, part);
  }
  return [...parts.values()].slice(0, DEFORMABLE_MAX_PARTS);
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
  const parts = normalizeParts(input.parts);
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
    ...(parts.length > 0 ? { parts } : {}),
  };
}

/** Maps a model path to its deformable sidecar, following the collision sidecar rule. */
export function deformableSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalized.replace(/\.[^./]+$/, "")}.deformable.json`;
}
