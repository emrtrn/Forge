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
 * the parts is the body. A model without parts dents as one surface. A part with
 * `detach` tears off under a hard enough hit and carries its dents with it.
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

/** How a part tears off its object. */
export interface DeformablePartDetach {
  /** A hit on the part at least this hard tears it off, N·s. */
  impulse: number;
  /** Mass of the loose piece, kg. The object keeps its own mass. */
  massKg: number;
  /** Speed added away from the object when it tears off, m/s. */
  kick: number;
}

/** Paint a dent scrapes off, on the materials named here. */
export interface AssetDeformableWear {
  /** A vertex pushed this far shows bare metal, metres. */
  depth: number;
  /** The bare surface: linear RGB, 0..1. */
  color: DeformableVec3;
  /** Its roughness, 0..1. */
  roughness: number;
  /** Model material names that take the wear; glass and lamps stay out by not being listed. */
  materials: string[];
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
  /** Omitted: the part stays on, however hard the hit. */
  detach?: DeformablePartDetach;
  /**
   * Parts a hit here also dents, at the same spot: the panel a lamp sits in. Each
   * keeps a dent of its own, so the panel keeps its shape when the lamp falls out.
   * One step only; an id that matches no part is ignored.
   */
  alsoDents?: string[];
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
  /** Omitted: dents leave the paint as it is. */
  wear?: AssetDeformableWear;
}

/** Inclusive numeric bounds shared by normalization and editor sliders. */
export const DEFORMABLE_LIMITS = {
  dentImpulse: [0, 1000000],
  fullImpulse: [0.001, 2000000],
  radius: [0.01, 10],
  maxDepth: [0.001, 2],
  plasticity: [0, 1],
  maxDents: [1, 64],
  wearDepth: [0.001, 2],
  unit: [0, 1],
} as const;

export const DEFORMABLE_DETACH_LIMITS = {
  impulse: [0, 1000000],
  massKg: [0.1, 100000],
  kick: [0, 50],
} as const;

/** Starting values of a new `detach`; `massKg` and `kick` also fill what a sidecar leaves out. */
export const DEFORMABLE_DETACH_DEFAULTS: Readonly<DeformablePartDetach> = { impulse: 5000, massKg: 20, kick: 1 };

/** Bounds of a zone corner, metres. */
export const DEFORMABLE_ZONE_COORDINATE = [-1000, 1000] as const;

/** Room left around a fitted zone, metres. */
const ZONE_FIT_MARGIN = 0.05;

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
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y) || typeof z !== "number" || !Number.isFinite(z)) return null;
  const [low, high] = DEFORMABLE_ZONE_COORDINATE;
  return [Math.max(low, Math.min(high, x)), Math.max(low, Math.min(high, y)), Math.max(low, Math.min(high, z))];
}

/**
 * The zone for a part from its nodes' box and the model's. A hit is placed on the
 * outer surface, and over a thin part such as a door that surface can be a wider
 * panel, so the zone reaches from the part out to the model's bounds along the
 * part's thinnest axis, on the side facing away from the model's centre.
 */
export function fitPartZone(part: DeformablePartZone, model: DeformablePartZone): DeformablePartZone {
  const min: DeformableVec3 = [part.min[0] - ZONE_FIT_MARGIN, part.min[1] - ZONE_FIT_MARGIN, part.min[2] - ZONE_FIT_MARGIN];
  const max: DeformableVec3 = [part.max[0] + ZONE_FIT_MARGIN, part.max[1] + ZONE_FIT_MARGIN, part.max[2] + ZONE_FIT_MARGIN];
  const sizes = [0, 1, 2].map((axis) => part.max[axis]! - part.min[axis]!);
  const thin = sizes.indexOf(Math.min(...sizes));
  const partCentre = (part.min[thin]! + part.max[thin]!) / 2;
  const modelCentre = (model.min[thin]! + model.max[thin]!) / 2;
  if (partCentre >= modelCentre) max[thin] = Math.max(max[thin]!, model.max[thin]! + ZONE_FIT_MARGIN);
  else min[thin] = Math.min(min[thin]!, model.min[thin]! - ZONE_FIT_MARGIN);
  return { min, max };
}

/** `impulse` is the one required field: without it nothing would ever tear off. */
function normalizeDetach(value: unknown): DeformablePartDetach | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.impulse !== "number" || !Number.isFinite(input.impulse)) return null;
  return {
    impulse: bounded(input.impulse, 0, DEFORMABLE_DETACH_LIMITS.impulse),
    massKg: bounded(input.massKg, DEFORMABLE_DETACH_DEFAULTS.massKg, DEFORMABLE_DETACH_LIMITS.massKg),
    kick: bounded(input.kick, DEFORMABLE_DETACH_DEFAULTS.kick, DEFORMABLE_DETACH_LIMITS.kick),
  };
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
  const detach = normalizeDetach(input.detach);
  const alsoDents = Array.isArray(input.alsoDents)
    ? [...new Set(input.alsoDents.filter((other): other is string => typeof other === "string" && other.length > 0 && other !== id))]
    : [];
  return { id, nodes, zone: { min, max }, ...(detach ? { detach } : {}), ...(alsoDents.length > 0 ? { alsoDents } : {}) };
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
function normalizeWear(value: unknown): AssetDeformableWear | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const color = input.color;
  const materials = Array.isArray(input.materials)
    ? [...new Set(input.materials.filter((name): name is string => typeof name === "string" && name.length > 0))]
    : [];
  if (materials.length === 0 || !Array.isArray(color) || color.length !== 3) return null;
  return {
    depth: bounded(input.depth, 0.05, DEFORMABLE_LIMITS.wearDepth),
    color: [
      bounded(color[0], 0, DEFORMABLE_LIMITS.unit),
      bounded(color[1], 0, DEFORMABLE_LIMITS.unit),
      bounded(color[2], 0, DEFORMABLE_LIMITS.unit),
    ],
    roughness: bounded(input.roughness, 0.7, DEFORMABLE_LIMITS.unit),
    materials,
  };
}

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
  const wear = normalizeWear(input.wear);
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
    ...(wear ? { wear } : {}),
  };
}

/** Maps a model path to its deformable sidecar, following the collision sidecar rule. */
export function deformableSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalized.replace(/\.[^./]+$/, "")}.deformable.json`;
}
