import { restingImpulseFloor } from "../impactEvents";
import type { FractureSourceMesh } from "./voronoiFracture";

/** Current fracture sidecar version. */
export const FRACTURE_ASSET_VERSION = 1;

/** `<Model>.fracture.json`: break parameters only; chunks are re-baked on load. */
export interface AssetFractureDef {
  version: 1;
  source: "voronoi";
  /** Off keeps the sidecar but the asset never breaks. */
  enabled: boolean;
  seed: number; // integer 0..999 999
  cellCount: number; // integer
  /** `uniform`: even cells (stone, glass); `splinter`: cells stretched along the grain (wood). */
  pattern: FracturePattern;
  /** Model-root axis the grain runs along; used by `splinter`. */
  grainAxis: FractureGrainAxis;
  /** How many times longer a splinter is along the grain than across it. */
  grainStretch: number;
  /** kg per cubic metre of model-root space; mass = volume × density (× placement scale³ at runtime). */
  density: number;
  /** Manifest material asset id for cut faces; null reuses the exterior material. */
  interiorMaterialId: string | null;
  /** Metres per interior UV unit (box projection). */
  interiorUvScale: number;
  /** Impulse that breaks it, N·s. */
  breakImpulse: number;
  /** Accumulated Damage.Apply amount that breaks it; null = impacts only. */
  damageToBreak: number | null;
  /** Seconds a chunk lives; 0 = permanent. */
  chunkLifetime: number;
  maxActiveChunks: number; // integer
  /** Manifest `effect` id played once where it breaks; null = none. */
  breakEffect: string | null;
  /** Manifest `sound` or `soundCue` id played once, spatially, where it breaks; null = none. */
  breakSound: string | null;
  /**
   * Chunks smaller than this share of the source volume do not become bodies:
   * `crumbleEffect` plays where they were (APEX "Crumble Smallest Chunks"). 0 = off.
   */
  crumbleBelow: number;
  /** Manifest `effect` id for crumbled chunks; null = they just vanish. */
  crumbleEffect: string | null;
  /** Metres a chunk may travel from the break point before it is removed; 0 = no limit. */
  maxSeparation: number;
  /** Support graph (Faz 4c): which chunks hold, and how much of it a hit breaks. */
  support: FractureSupportDef;
  /** Source mesh hash when last baked in the editor; null = never baked. */
  sourceHash: string | null;
}

/**
 * How a fractured object holds together (DEFORMABLE_FRACTURABLE Faz 4c, after
 * APEX Destruction's support chunks). `none` keeps the all-or-nothing break;
 * `anchored` breaks only the chunks around a hit and lets the rest stand while
 * a path of neighbouring chunks still reaches an anchor.
 */
export interface FractureSupportDef {
  mode: FractureSupportMode;
  /**
   * Model-space boxes; chunks overlapping one are anchored. Regions, not chunk
   * ids, so a re-bake (new seed, cell count) keeps them meaningful.
   */
  anchors: FractureAnchorRegion[];
  /** Chunks touching static world geometry at level load are anchored too (APEX World Support). */
  worldSupport: boolean;
  /** Metres around the hit point whose chunks break, before the impulse term. */
  damageRadius: number;
  /** Extra metres of damage radius per N·s of impulse. */
  damageRadiusPerImpulse: number;
  /** Upper bound of the damage radius, metres. */
  damageRadiusMax: number;
}

export type FractureSupportMode = "none" | "anchored";
export const FRACTURE_SUPPORT_MODES: readonly FractureSupportMode[] = ["none", "anchored"];

/** An axis-aligned model-space box (`min` ≤ `max` per axis). */
export interface FractureAnchorRegion {
  min: [number, number, number];
  max: [number, number, number];
}

/** Anchor boxes a sidecar may hold. */
export const FRACTURE_MAX_ANCHORS = 16;

export type FracturePattern = "uniform" | "splinter";
export type FractureGrainAxis = "x" | "y" | "z";
export const FRACTURE_PATTERNS: readonly FracturePattern[] = ["uniform", "splinter"];
export const FRACTURE_GRAIN_AXES: readonly FractureGrainAxis[] = ["x", "y", "z"];

/** Inclusive numeric bounds shared by normalization and editor sliders. */
export const FRACTURE_LIMITS = {
  // Any integer seeds the bake; a six-digit range keeps the editor field readable.
  seed: [0, 999999],
  cellCount: [2, 64],
  grainStretch: [1, 16],
  density: [1, 20000],
  interiorUvScale: [0.01, 100],
  breakImpulse: [0, 1000000],
  damageToBreak: [0.001, 1000000],
  chunkLifetime: [0, 600],
  maxActiveChunks: [1, 256],
  crumbleBelow: [0, 0.2],
  maxSeparation: [0, 500],
} as const;

/** Bounds of the `support` block's fields (same role as {@link FRACTURE_LIMITS}). */
export const FRACTURE_SUPPORT_LIMITS = {
  damageRadius: [0, 20],
  damageRadiusPerImpulse: [0, 0.05],
  damageRadiusMax: [0, 50],
  // Anchor box coordinates, model space (metres).
  anchorCoordinate: [-10000, 10000],
} as const;

/** Defaults for a new fracture sidecar. */
export const FRACTURE_DEFAULTS: AssetFractureDef = {
  version: FRACTURE_ASSET_VERSION,
  source: "voronoi",
  enabled: true,
  seed: 1,
  cellCount: 12,
  pattern: "uniform",
  grainAxis: "y",
  grainStretch: 6,
  density: 600,
  interiorMaterialId: null,
  interiorUvScale: 1,
  breakImpulse: 400,
  damageToBreak: null,
  chunkLifetime: 8,
  maxActiveChunks: 16,
  breakEffect: null,
  breakSound: null,
  crumbleBelow: 0,
  crumbleEffect: null,
  maxSeparation: 0,
  support: {
    mode: "none",
    anchors: [],
    worldSupport: true,
    damageRadius: 0.4,
    damageRadiusPerImpulse: 0.0004,
    damageRadiusMax: 3,
  },
  sourceHash: null,
};

/**
 * Level-owned override on one placement (`LayoutPlacement.fracture`, plan §4
 * K-04). The asset sidecar stays the definition: a placement can only keep
 * itself whole (`enabled: false`) or move the threshold. Absent fields use the
 * asset; without an enabled sidecar the override does nothing.
 */
export interface PlacementFractureOverride {
  enabled?: false;
  /** Replaces the asset's `breakImpulse`, N·s (`FRACTURE_LIMITS.breakImpulse`). */
  breakImpulse?: number;
}

/** The bake's grain option for a def; undefined for the uniform pattern. */
export function fractureGrain(def: AssetFractureDef): { axis: 0 | 1 | 2; stretch: number } | undefined {
  if (def.pattern !== "splinter") return undefined;
  return { axis: FRACTURE_GRAIN_AXES.indexOf(def.grainAxis) as 0 | 1 | 2, stretch: def.grainStretch };
}

/** Returns a fresh copy of the defaults. */
export function createAssetFracture(): AssetFractureDef {
  return { ...FRACTURE_DEFAULTS, support: normalizeFractureSupport(undefined) };
}

/** Normalizes the `support` block; missing or malformed fields take the defaults. */
export function normalizeFractureSupport(value: unknown): FractureSupportDef {
  const defaults = FRACTURE_DEFAULTS.support;
  const input = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const anchors: FractureAnchorRegion[] = [];
  for (const entry of Array.isArray(input.anchors) ? input.anchors : []) {
    const region = normalizeAnchorRegion(entry);
    if (region && anchors.length < FRACTURE_MAX_ANCHORS) anchors.push(region);
  }
  return {
    mode: FRACTURE_SUPPORT_MODES.includes(input.mode as FractureSupportMode)
      ? input.mode as FractureSupportMode : defaults.mode,
    anchors,
    worldSupport: typeof input.worldSupport === "boolean" ? input.worldSupport : defaults.worldSupport,
    damageRadius: bounded(input.damageRadius, defaults.damageRadius, FRACTURE_SUPPORT_LIMITS.damageRadius),
    damageRadiusPerImpulse: bounded(
      input.damageRadiusPerImpulse, defaults.damageRadiusPerImpulse, FRACTURE_SUPPORT_LIMITS.damageRadiusPerImpulse,
    ),
    damageRadiusMax: bounded(input.damageRadiusMax, defaults.damageRadiusMax, FRACTURE_SUPPORT_LIMITS.damageRadiusMax),
  };
}

/** A finite box with min ≤ max per axis (swapped when authored the other way round); else null. */
function normalizeAnchorRegion(value: unknown): FractureAnchorRegion | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { min, max } = value as Record<string, unknown>;
  const read = (corner: unknown): [number, number, number] | null => {
    if (!Array.isArray(corner) || corner.length !== 3) return null;
    if (!corner.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
    const [low, high] = FRACTURE_SUPPORT_LIMITS.anchorCoordinate;
    return corner.map((item: number) => Math.max(low, Math.min(high, item))) as [number, number, number];
  };
  const a = read(min);
  const b = read(max);
  if (!a || !b) return null;
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

function bounded(value: unknown, fallback: number, limits: readonly [number, number], integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(limits[0], Math.min(limits[1], integer ? Math.round(value) : value));
}

/** A manifest asset id reference (non-empty, no path separators); anything else is null. */
function assetIdOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\\/:\u0000]/.test(value) ? value : null;
}

/** Normalizes the shared loader/save field shape; unsupported objects return null. */
export function normalizeAssetFracture(value: unknown): AssetFractureDef | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (("version" in input && input.version !== 1) || ("source" in input && input.source !== "voronoi")) {
    return null;
  }
  const defaults = FRACTURE_DEFAULTS;
  return {
    version: FRACTURE_ASSET_VERSION,
    source: "voronoi",
    enabled: typeof input.enabled === "boolean" ? input.enabled : defaults.enabled,
    seed: bounded(input.seed, defaults.seed, FRACTURE_LIMITS.seed, true),
    cellCount: bounded(input.cellCount, defaults.cellCount, FRACTURE_LIMITS.cellCount, true),
    pattern: FRACTURE_PATTERNS.includes(input.pattern as FracturePattern) ? input.pattern as FracturePattern : defaults.pattern,
    grainAxis: FRACTURE_GRAIN_AXES.includes(input.grainAxis as FractureGrainAxis)
      ? input.grainAxis as FractureGrainAxis : defaults.grainAxis,
    grainStretch: bounded(input.grainStretch, defaults.grainStretch, FRACTURE_LIMITS.grainStretch),
    density: bounded(input.density, defaults.density, FRACTURE_LIMITS.density),
    interiorMaterialId: typeof input.interiorMaterialId === "string" && input.interiorMaterialId.length > 0
      ? input.interiorMaterialId : null,
    interiorUvScale: bounded(input.interiorUvScale, defaults.interiorUvScale, FRACTURE_LIMITS.interiorUvScale),
    breakImpulse: bounded(input.breakImpulse, defaults.breakImpulse, FRACTURE_LIMITS.breakImpulse),
    damageToBreak: input.damageToBreak === null ? null
      : typeof input.damageToBreak === "number" && Number.isFinite(input.damageToBreak)
        ? bounded(input.damageToBreak, FRACTURE_LIMITS.damageToBreak[0], FRACTURE_LIMITS.damageToBreak)
        : defaults.damageToBreak,
    chunkLifetime: bounded(input.chunkLifetime, defaults.chunkLifetime, FRACTURE_LIMITS.chunkLifetime),
    maxActiveChunks: bounded(input.maxActiveChunks, defaults.maxActiveChunks, FRACTURE_LIMITS.maxActiveChunks, true),
    breakEffect: assetIdOrNull(input.breakEffect),
    breakSound: assetIdOrNull(input.breakSound),
    crumbleBelow: bounded(input.crumbleBelow, defaults.crumbleBelow, FRACTURE_LIMITS.crumbleBelow),
    crumbleEffect: assetIdOrNull(input.crumbleEffect),
    maxSeparation: bounded(input.maxSeparation, defaults.maxSeparation, FRACTURE_LIMITS.maxSeparation),
    support: normalizeFractureSupport(input.support),
    sourceHash: typeof input.sourceHash === "string" && /^fnv1a:[0-9a-f]{8}$/.test(input.sourceHash)
      ? input.sourceHash : null,
  };
}

/** Maps a model path to its fracture sidecar, following the collision sidecar rule. */
export function fractureSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${normalized.replace(/\.[^./]+$/, "")}.fracture.json`;
}

/** FNV-1a over little-endian float32 attributes followed by uint32 indices. */
export function fractureSourceHash(mesh: FractureSourceMesh): string {
  let hash = 0x811c9dc5;
  const bytes = new DataView(new ArrayBuffer(4));
  const append = (): void => {
    for (let byte = 0; byte < 4; byte += 1) {
      hash = Math.imul(hash ^ bytes.getUint8(byte), 0x01000193) >>> 0;
    }
  };
  for (const attribute of [mesh.positions, mesh.normals, mesh.uvs]) {
    if (attribute === null) continue;
    // Reinterpret the native float bits without canonicalizing NaN payloads.
    for (const bits of new Uint32Array(attribute.buffer, attribute.byteOffset, attribute.length)) {
      bytes.setUint32(0, bits, true);
      append();
    }
  }
  const count = mesh.indices?.length ?? mesh.positions.length / 3;
  for (let index = 0; index < count; index += 1) {
    bytes.setUint32(0, mesh.indices === null ? index : mesh.indices[index]!, true);
    append();
  }
  return `fnv1a:${hash.toString(16).padStart(8, "0")}`;
}

/** Editor warning identifiers in display order. */
export type FractureWarningCode =
  | "not-baked" | "stale-bake" | "not-closed" | "not-convex"
  | "many-chunks" | "self-weight" | "multi-material";

/** One user-visible editor warning. */
export interface FractureWarning {
  readonly code: FractureWarningCode;
  readonly message: string;
}

/** Current mesh and bake facts used by editor warnings. */
export interface FractureCheckInput {
  readonly def: AssetFractureDef;
  /** Hash of the current mesh. */
  readonly currentHash: string;
  readonly closed: boolean;
  readonly convex: boolean;
  /** Distinct materials in the source model. */
  readonly materialCount: number;
  /** Sum of current baked chunk masses (volume × density), kg. */
  readonly totalMass: number;
  /** Physics fixed step in seconds. */
  readonly step: number;
}

/** Returns ordered editor warnings, or none when fracture is disabled. */
export function fractureWarnings(input: FractureCheckInput): FractureWarning[] {
  const { def } = input;
  if (!def.enabled) return [];
  const warnings: FractureWarning[] = [];
  if (def.sourceHash === null) {
    warnings.push({ code: "not-baked", message: "Henüz bake edilmedi; önizleme için Bake'e basın." });
  } else if (def.sourceHash !== input.currentHash) {
    warnings.push({ code: "stale-bake", message: "Mesh son bake'ten sonra değişti; parçalar yeniden üretilecek, önizlemeyi yenileyin." });
  }
  if (!input.closed) {
    warnings.push({ code: "not-closed", message: "Mesh kapalı değil; v1 yalnız kapalı dışbükey mesh'leri doğru böler." });
  }
  if (!input.convex) {
    warnings.push({ code: "not-convex", message: "Mesh dışbükey değil; v1 parçaları dış hattı izlemez (Faz 8: import yolu)." });
  }
  if (def.cellCount > 32) {
    warnings.push({ code: "many-chunks", message: "32'den fazla parça var; kırılma anında takılma riski bulunuyor." });
  }
  const floor = restingImpulseFloor(input.totalMass, input.step);
  if (def.breakImpulse < floor) {
    warnings.push({ code: "self-weight", message: `Kırılma impulse'u kendi ağırlığının ürettiği temas sınırının (${floor.toFixed(1)} N·s) altında; nesne kendiliğinden kırılabilir.` });
  }
  if (input.materialCount > 1) {
    warnings.push({ code: "multi-material", message: "Model birden çok materyal kullanıyor; dış yüzler ilk materyali kullanır." });
  }
  return warnings;
}
