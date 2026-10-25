/**
 * Engine-generic collision model, mirroring Unreal's collision concepts in a
 * web-first, simplified form:
 *
 * - `CollisionEnabled`    — what kind of collision a body participates in.
 * - object/trace channels — a fixed, built-in set (no project-defined channels).
 * - `CollisionResponse`   — per-channel Block / Overlap / Ignore.
 * - `CollisionPreset`     — named profiles bundling the above (+ `custom`).
 * - `CollisionComplexity` — how the collision geometry is resolved.
 * - `CollisionPrimitive`  — a simple collision shape authored in the Static Mesh
 *   editor; an asset owns a list of them (`AssetCollisionDef`).
 *
 * Project-specific rules (which channel blocks what) live in game runtime/data;
 * this module only defines the generic surface and the built-in preset catalog.
 *
 * Keep this module dependency-light (only `./layout` types) so the editor,
 * runtime, tools, and tests can all import it.
 */
import type { Vec3 } from "./layout";

/** Unreal "Collision Enabled": which collision interactions a body runs. */
export type CollisionEnabled = "none" | "query" | "physics" | "queryAndPhysics";

export const COLLISION_ENABLED_VALUES: readonly CollisionEnabled[] = [
  "none",
  "query",
  "physics",
  "queryAndPhysics",
];

/** Unreal "Collision Complexity": how collision geometry is resolved. */
export type CollisionComplexity =
  | "projectDefault"
  | "simpleAndComplex"
  | "simpleAsComplex"
  | "complexAsSimple";

export const COLLISION_COMPLEXITY_VALUES: readonly CollisionComplexity[] = [
  "projectDefault",
  "simpleAndComplex",
  "simpleAsComplex",
  "complexAsSimple",
];

/** Per-channel response (Unreal Block / Overlap / Ignore). */
export type CollisionResponse = "ignore" | "overlap" | "block";

export const COLLISION_RESPONSE_VALUES: readonly CollisionResponse[] = [
  "ignore",
  "overlap",
  "block",
];

/**
 * AI navigation interpretation for a collidable mesh.
 *
 * - `auto`: current geometry-derived behavior.
 * - `walkable`: explicitly allowed to produce nav floor samples.
 * - `obstacleOnly`: blocks pathing but never produces walkable nav floor.
 * - `ignored`: ignored by AI nav generation while keeping physics collision.
 */
export type NavigationRole = "auto" | "walkable" | "obstacleOnly" | "ignored";

export const NAVIGATION_ROLE_VALUES: readonly NavigationRole[] = [
  "auto",
  "walkable",
  "obstacleOnly",
  "ignored",
];

export const DEFAULT_NAVIGATION_ROLE: NavigationRole = "auto";

/** Built-in object channels: a body's collision identity + what it responds to. */
export type CollisionObjectChannel =
  | "worldStatic"
  | "worldDynamic"
  | "pawn"
  | "physicsBody"
  | "trigger";

export const COLLISION_OBJECT_CHANNELS: readonly CollisionObjectChannel[] = [
  "worldStatic",
  "worldDynamic",
  "pawn",
  "physicsBody",
  "trigger",
];

/** Built-in trace channels for queries (raycast / camera). */
export type CollisionTraceChannel = "visibility" | "camera";

export const COLLISION_TRACE_CHANNELS: readonly CollisionTraceChannel[] = [
  "visibility",
  "camera",
];

export type CollisionChannel = CollisionObjectChannel | CollisionTraceChannel;

export const COLLISION_CHANNELS: readonly CollisionChannel[] = [
  ...COLLISION_OBJECT_CHANNELS,
  ...COLLISION_TRACE_CHANNELS,
];

/** Sparse per-channel overrides; an absent channel falls back to the preset. */
export type CollisionResponseMap = Partial<Record<CollisionChannel, CollisionResponse>>;

/** Full per-channel response table (every channel resolved). */
export type CollisionResponseTable = Record<CollisionChannel, CollisionResponse>;

/** Built-in collision presets (Unreal-style named profiles) + `custom`. */
export type CollisionPresetId =
  | "noCollision"
  | "blockAll"
  | "overlapAll"
  | "blockAllDynamic"
  | "overlapAllDynamic"
  | "pawn"
  | "physicsActor"
  | "trigger"
  | "custom";

export const COLLISION_PRESET_IDS: readonly CollisionPresetId[] = [
  "noCollision",
  "blockAll",
  "overlapAll",
  "blockAllDynamic",
  "overlapAllDynamic",
  "pawn",
  "physicsActor",
  "trigger",
  "custom",
];

/** A fully resolved collision profile (what the runtime ultimately consumes). */
export interface CollisionProfile {
  collisionEnabled: CollisionEnabled;
  objectType: CollisionObjectChannel;
  responses: CollisionResponseTable;
}

/** Simple collision primitive shapes authored in the Static Mesh editor. */
export type CollisionPrimitiveShape =
  | "box"
  | "sphere"
  | "capsule"
  | "cylinder"
  | "cone"
  | "convex";

export const COLLISION_PRIMITIVE_SHAPES: readonly CollisionPrimitiveShape[] = [
  "box",
  "sphere",
  "capsule",
  "cylinder",
  "cone",
  "convex",
];

/**
 * A single simple-collision shape in the asset's local space (before placement
 * scale). `convex` carries baked hull `points` and derives its runtime size
 * from those points.
 */
export interface CollisionPrimitive {
  shape: CollisionPrimitiveShape;
  /** Full local size for box/sphere/capsule (sphere/capsule use the max axis). */
  size: Vec3;
  /** Local center offset from the model origin. Absent means origin. */
  center?: Vec3;
  /** Local rotation in degrees for oriented primitives. Absent means axis-aligned. */
  rotation?: Vec3;
  /** Baked convex hull points (only for `shape === "convex"`). */
  points?: Vec3[];
}

/**
 * Asset-level collision setup (the default for every placement of the asset).
 * Persisted as a `*.collision.json` sidecar next to the model file.
 */
export interface AssetCollisionDef {
  /** Authored simple collision shapes. Empty means "no simple collision". */
  primitives: CollisionPrimitive[];
  complexity: CollisionComplexity;
  preset: CollisionPresetId;
  /** Default AI navigation interpretation for every placement of this asset. */
  navigationRole?: NavigationRole;
  /** Per-channel overrides; only meaningful when `preset === "custom"`. */
  responses?: CollisionResponseMap;
  /** Physical material reference (friction/restitution/density source). */
  physicalMaterialId?: string;
  /** Use complex (per-poly) collision from both triangle sides. */
  doubleSided?: boolean;
  /** Emit begin/end overlap events for sensors. Absent means true. */
  generateOverlapEvents?: boolean;
  /** Emit hit events while simulating physics. Absent means true. */
  simulationGeneratesHitEvents?: boolean;
}

export const DEFAULT_COLLISION_PRESET: CollisionPresetId = "blockAll";
export const DEFAULT_COLLISION_COMPLEXITY: CollisionComplexity = "projectDefault";

/** Physical surface response, with optional wheel and soft-surface profiles. */
export interface PhysicalMaterialDef {
  friction: number;
  restitution: number;
  /** Preset-only effect asset id or public-root-relative .effect.json path.
   * Saves carry only the preset id. */
  wheelEffect?: string;
  /** Preset-only sound/soundCue id for a spatial tyre loop. */
  wheelSound?: string;
  /** Optional ray-cast wheel response. Absent keeps the authored wheel values. */
  vehicle?: {
    /** Multiplier on the wheel's longitudinal friction slip. */
    frictionSlipScale: number;
    /** Longitudinal force / suspension load. Independent of Rapier's lateral tuning. */
    tractionCoefficient?: number;
    /** Multiplier on the wheel's lateral friction stiffness. */
    sideFrictionScale: number;
    /** Load-relative rolling drag coefficient; ramps up over the first 1 m/s. */
    rollingResistance: number;
  };
  /** Soft-surface profile for runtime tracks; never written into level data. */
  deformation?: {
    /**
     * Soft layer thickness over a hard base (m): the depth a wheel approaches as
     * its load grows; an empty vehicle presses half of it (see `sinkage`).
     */
    maxDepth: number;
    /** Fraction of target depth reached per pass (0..1). */
    compaction: number;
    /** Additional digging while slipping (m/s). */
    digRate: number;
    /** Track refill rate (m/s); zero keeps tracks indefinitely. */
    recoveryRate: number;
    /** Extra resistance multiplier as the wheel sinks. */
    sinkResistance: number;
    /** Track albedo blend colour (RGB, 0..1). */
    tint: Vec3;
    /** Track albedo blend strength (0..1). */
    tintStrength: number;
    /** Track roughness reduction (0..1). */
    wetness: number;
  };
}

export const DEFAULT_PHYSICAL_MATERIAL: PhysicalMaterialDef = { friction: 0.8, restitution: 0 };

/** Built-in physical materials referenced by `AssetCollisionDef.physicalMaterialId`. */
export const PHYSICAL_MATERIALS: Record<string, PhysicalMaterialDef> = {
  default: DEFAULT_PHYSICAL_MATERIAL,
  slippery: { friction: 0.05, restitution: 0 },
  rubber: { friction: 0.9, restitution: 0.7 },
  metal: { friction: 0.4, restitution: 0.1 },
  wood: { friction: 0.6, restitution: 0 },
  stone: { friction: 0.7, restitution: 0.05 },
  snow: {
    friction: 0.3, restitution: 0,
    wheelEffect: "starter-fx-snow-dust",
    vehicle: { frictionSlipScale: 0.6, tractionCoefficient: 0.22, sideFrictionScale: 0.5, rollingResistance: 0.06 },
    deformation: {
      maxDepth: 0.3, compaction: 0.25, digRate: 0.05, recoveryRate: 0.01,
      sinkResistance: 0.4, tint: [0.85, 0.9, 0.95], tintStrength: 0.3, wetness: 0.1,
    },
  },
  mud: {
    friction: 0.6, restitution: 0,
    wheelEffect: "starter-fx-mud-splash",
    vehicle: { frictionSlipScale: 0.55, tractionCoefficient: 0.35, sideFrictionScale: 0.7, rollingResistance: 0.12 },
    deformation: {
      maxDepth: 0.22, compaction: 0.5, digRate: 0.08, recoveryRate: 0,
      sinkResistance: 0.6, tint: [0.035, 0.025, 0.015], tintStrength: 0.85, wetness: 0.9,
    },
  },
  sand: {
    friction: 0.5, restitution: 0,
    vehicle: { frictionSlipScale: 0.75, sideFrictionScale: 0.8, rollingResistance: 0.25 },
    deformation: {
      maxDepth: 0.15, compaction: 0.4, digRate: 0.06, recoveryRate: 0.002,
      sinkResistance: 0.45, tint: [0.65, 0.5, 0.3], tintStrength: 0.4, wetness: 0.05,
    },
  },
};

export const PHYSICAL_MATERIAL_IDS: readonly string[] = Object.keys(PHYSICAL_MATERIALS);

/** Resolves a physical-material id to its surface response, defaulting safely. */
export function resolvePhysicalMaterial(id: string | undefined): PhysicalMaterialDef {
  if (id && Object.prototype.hasOwnProperty.call(PHYSICAL_MATERIALS, id)) {
    return PHYSICAL_MATERIALS[id]!;
  }
  return DEFAULT_PHYSICAL_MATERIAL;
}

/**
 * Whether an asset collision definition yields a runtime collider. Authored
 * simple primitives always do; `complexAsSimple` does too even with no
 * primitives, since it derives a static trimesh collider from the render mesh.
 * Other empty definitions fall back to the engine's auto bounding box, so they
 * are not worth keeping in the loaded sidecar map.
 */
export function assetCollisionDefHasCollider(def: AssetCollisionDef): boolean {
  return def.primitives.length > 0 || def.complexity === "complexAsSimple";
}

/** The asset ids in a loaded sidecar map that use `complexAsSimple` complexity. */
export function complexAsSimpleAssetIds(
  defs: ReadonlyMap<string, AssetCollisionDef>,
): Set<string> {
  const ids = new Set<string>();
  for (const [assetId, def] of defs) {
    if (def.complexity === "complexAsSimple") ids.add(assetId);
  }
  return ids;
}

/** A fresh, empty asset collision definition (block-all, no shapes yet). */
export function defaultAssetCollisionDef(): AssetCollisionDef {
  return {
    primitives: [],
    complexity: DEFAULT_COLLISION_COMPLEXITY,
    preset: DEFAULT_COLLISION_PRESET,
  };
}

interface PresetSeed {
  collisionEnabled: CollisionEnabled;
  objectType: CollisionObjectChannel;
  /** Default response applied to every channel. */
  base: CollisionResponse;
  /** Per-channel overrides on top of `base`. */
  overrides?: CollisionResponseMap;
}

function buildResponses(seed: PresetSeed): CollisionResponseTable {
  const table = {} as CollisionResponseTable;
  for (const channel of COLLISION_CHANNELS) {
    table[channel] = seed.overrides?.[channel] ?? seed.base;
  }
  return table;
}

/**
 * Built-in preset seeds. `custom` is intentionally absent: it is resolved from
 * an explicit object type + response map rather than a fixed profile.
 */
const PRESET_SEEDS: Record<Exclude<CollisionPresetId, "custom">, PresetSeed> = {
  noCollision: { collisionEnabled: "none", objectType: "worldStatic", base: "ignore" },
  blockAll: { collisionEnabled: "queryAndPhysics", objectType: "worldStatic", base: "block" },
  overlapAll: { collisionEnabled: "query", objectType: "worldStatic", base: "overlap" },
  blockAllDynamic: {
    collisionEnabled: "queryAndPhysics",
    objectType: "worldDynamic",
    base: "block",
  },
  overlapAllDynamic: {
    collisionEnabled: "query",
    objectType: "worldDynamic",
    base: "overlap",
  },
  pawn: { collisionEnabled: "queryAndPhysics", objectType: "pawn", base: "block" },
  physicsActor: {
    collisionEnabled: "queryAndPhysics",
    objectType: "physicsBody",
    base: "block",
  },
  trigger: {
    collisionEnabled: "query",
    objectType: "trigger",
    base: "overlap",
    overrides: { visibility: "ignore", camera: "ignore" },
  },
};

/**
 * Resolves a preset id (plus optional `custom` object type / response overrides)
 * into a full `CollisionProfile`. For built-in presets the overrides default to
 * the preset's own values; for `custom` they are required-ish (fall back to a
 * block-all world-static profile so callers always get a usable table).
 */
export function resolveCollisionProfile(
  preset: CollisionPresetId,
  custom?: {
    collisionEnabled?: CollisionEnabled;
    objectType?: CollisionObjectChannel;
    responses?: CollisionResponseMap;
  },
): CollisionProfile {
  if (preset !== "custom") {
    const seed = PRESET_SEEDS[preset];
    return {
      collisionEnabled: seed.collisionEnabled,
      objectType: seed.objectType,
      responses: buildResponses(seed),
    };
  }
  const seed: PresetSeed = {
    collisionEnabled: custom?.collisionEnabled ?? "queryAndPhysics",
    objectType: custom?.objectType ?? "worldStatic",
    base: "block",
  };
  if (custom?.responses) seed.overrides = custom.responses;
  return {
    collisionEnabled: seed.collisionEnabled,
    objectType: seed.objectType,
    responses: buildResponses(seed),
  };
}

/** Bit per object channel for Rapier interaction-group membership/filter masks. */
export const COLLISION_OBJECT_CHANNEL_BITS: Record<CollisionObjectChannel, number> = {
  worldStatic: 1 << 0,
  worldDynamic: 1 << 1,
  pawn: 1 << 2,
  physicsBody: 1 << 3,
  trigger: 1 << 4,
};

/**
 * Packs a resolved profile into a Rapier interaction-groups value: the high 16
 * bits are membership (the body's own object channel), the low 16 are the
 * filter (object channels it does NOT ignore). Two colliders interact only when
 * each one's membership intersects the other's filter — so `Ignore` on a channel
 * filters that pair out entirely.
 */
export function collisionInteractionGroups(profile: CollisionProfile): number {
  const memberships = COLLISION_OBJECT_CHANNEL_BITS[profile.objectType];
  let filter = 0;
  for (const channel of COLLISION_OBJECT_CHANNELS) {
    if (profile.responses[channel] !== "ignore") filter |= COLLISION_OBJECT_CHANNEL_BITS[channel];
  }
  return ((memberships & 0xffff) << 16) | (filter & 0xffff);
}

/** Whether two packed interaction-group values interact (undefined = interact with all). */
export function interactionGroupsInteract(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return true;
  const aMem = a >>> 16;
  const aFilter = a & 0xffff;
  const bMem = b >>> 16;
  const bFilter = b & 0xffff;
  return (aMem & bFilter) !== 0 && (bMem & aFilter) !== 0;
}

export function isCollisionEnabled(value: unknown): value is CollisionEnabled {
  return typeof value === "string" && COLLISION_ENABLED_VALUES.includes(value as CollisionEnabled);
}

export function isCollisionComplexity(value: unknown): value is CollisionComplexity {
  return (
    typeof value === "string" &&
    COLLISION_COMPLEXITY_VALUES.includes(value as CollisionComplexity)
  );
}

export function isCollisionPresetId(value: unknown): value is CollisionPresetId {
  return typeof value === "string" && COLLISION_PRESET_IDS.includes(value as CollisionPresetId);
}

export function isCollisionResponse(value: unknown): value is CollisionResponse {
  return (
    typeof value === "string" && COLLISION_RESPONSE_VALUES.includes(value as CollisionResponse)
  );
}

export function isNavigationRole(value: unknown): value is NavigationRole {
  return typeof value === "string" && NAVIGATION_ROLE_VALUES.includes(value as NavigationRole);
}

export function isCollisionPrimitiveShape(value: unknown): value is CollisionPrimitiveShape {
  return (
    typeof value === "string" &&
    COLLISION_PRIMITIVE_SHAPES.includes(value as CollisionPrimitiveShape)
  );
}

export function isCollisionObjectChannel(value: unknown): value is CollisionObjectChannel {
  return (
    typeof value === "string" &&
    COLLISION_OBJECT_CHANNELS.includes(value as CollisionObjectChannel)
  );
}
