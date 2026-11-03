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
  /** Source mesh hash when last baked in the editor; null = never baked. */
  sourceHash: string | null;
}

/** Inclusive numeric bounds shared by normalization and editor sliders. */
export const FRACTURE_LIMITS = {
  // Any integer seeds the bake; a six-digit range keeps the editor field readable.
  seed: [0, 999999],
  cellCount: [2, 64],
  density: [1, 20000],
  interiorUvScale: [0.01, 100],
  breakImpulse: [0, 1000000],
  damageToBreak: [0.001, 1000000],
  chunkLifetime: [0, 600],
  maxActiveChunks: [1, 256],
} as const;

/** Defaults for a new fracture sidecar. */
export const FRACTURE_DEFAULTS: AssetFractureDef = {
  version: FRACTURE_ASSET_VERSION,
  source: "voronoi",
  enabled: true,
  seed: 1,
  cellCount: 12,
  density: 600,
  interiorMaterialId: null,
  interiorUvScale: 1,
  breakImpulse: 400,
  damageToBreak: null,
  chunkLifetime: 8,
  maxActiveChunks: 16,
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

/** Returns a fresh copy of the defaults. */
export function createAssetFracture(): AssetFractureDef {
  return { ...FRACTURE_DEFAULTS };
}

function bounded(value: unknown, fallback: number, limits: readonly [number, number], integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(limits[0], Math.min(limits[1], integer ? Math.round(value) : value));
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
