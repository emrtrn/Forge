export type AssetType =
  | "staticMesh"
  | "skeletalMesh"
  | "texture"
  | "material"
  | "sound"
  | "soundCue"
  | "dialogueVoice"
  | "dialogueLine"
  | "conversation"
  | "blackboard"
  | "behaviorTree"
  | "aiQuery"
  | "stateTree"
  | "animation"
  | "effect"
  | "vehicle"
  | "foliageType"
  | "prefab"
  | "ui"
  | "level";
export type LegacyAssetType = "model";

export type PlacementSurface = "floor" | "wall" | "room" | "character";

export interface AssetPlacementRules {
  surface: PlacementSurface;
  snapToWall: boolean;
  allowRotation: boolean;
  allowScale: boolean;
}

export interface AssetRuntimeSettings {
  loadGroup: string;
  castShadow: boolean;
  receiveShadow: boolean;
  collision: boolean;
  bytes: number;
}

export interface AssetSourceInfo {
  origin: string;
  pack?: string;
  packVersion?: string;
  url?: string;
}

export interface AssetRecord {
  id: string;
  name: string;
  assetType: AssetType;
  category: string;
  /** Public-root-relative asset path. Example: `assets/models/props/chair.glb`. */
  path: string;
  /** Optional public-root-relative thumbnail image path. */
  thumbnail?: string;
  tags: string[];
  placeable: boolean;
  placement: AssetPlacementRules;
  runtime: AssetRuntimeSettings;
  source?: AssetSourceInfo;
  license: string;
  /** Legacy alias accepted while older manifests are phased out. */
  type?: AssetType | LegacyAssetType;
  /** Legacy path alias accepted while older manifests are phased out. */
  file?: string;
  /** Legacy top-level load group accepted while older manifests are phased out. */
  loadGroup?: string;
  /** Legacy top-level byte count accepted while older manifests are phased out. */
  bytes?: number;
}

export interface AssetManifest {
  version: number;
  generated: string;
  ktx2: boolean;
  assets: AssetRecord[];
}

export interface AssetCatalogRecord {
  id: string;
  name: string;
  assetType: AssetType;
  /** Legacy type alias accepted while older catalogs are phased out. */
  type?: AssetType | LegacyAssetType;
  category: string;
  model: string;
  preview?: string;
  placement: AssetPlacementRules;
  tags?: string[];
}

export interface AssetCatalog {
  schema: 1;
  assets: AssetCatalogRecord[];
}

export interface EditableAsset extends AssetRecord {
  displayName: string;
  catalogCategory: string;
  placement: AssetPlacementRules;
  tags: string[];
}

export type AssetManifestIssueLevel = "error" | "warning";

export interface AssetManifestIssue {
  level: AssetManifestIssueLevel;
  code: string;
  message: string;
  assetId?: string | undefined;
  path?: string | undefined;
}

export interface AssetManifestHealthReport {
  valid: boolean;
  assetCount: number;
  placeableCount: number;
  errorCount: number;
  warningCount: number;
  issues: AssetManifestIssue[];
}

export interface AssetManifestValidationOptions {
  /** Public-root-relative files currently present on disk, such as `assets/models/a.glb`. */
  publicFiles?: Iterable<string>;
}

const MODEL_EXTENSIONS = new Set(["glb", "gltf"]);
const THUMBNAIL_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const SOUND_EXTENSIONS = new Set(["mp3", "ogg", "wav"]);
const SOUND_CUE_EXTENSIONS = new Set(["soundcue.json"]);
const DIALOGUE_VOICE_EXTENSIONS = new Set(["dialoguevoice.json"]);
const DIALOGUE_LINE_EXTENSIONS = new Set(["dialogue.json"]);
const CONVERSATION_EXTENSIONS = new Set(["conversation.json"]);
const BLACKBOARD_EXTENSIONS = new Set(["blackboard.json"]);
const BEHAVIOR_TREE_EXTENSIONS = new Set(["behavior.json"]);
const AI_QUERY_EXTENSIONS = new Set(["query.json"]);
const STATE_TREE_EXTENSIONS = new Set(["statetree.json"]);
const MATERIAL_EXTENSIONS = new Set(["material.json", "mat.json"]);
const LEVEL_EXTENSIONS = new Set(["level.json", "layout.json"]);
const UI_EXTENSIONS = new Set(["ui.json", "theme.json", "loc.json"]);
// VFX Lite particle effect assets (engine/vfx/particleEffectTypes.ts). Split out
// of PREFAB_EXTENSIONS so effect assets carry `assetType: "effect"` rather than
// being sniffed as generic prefabs.
const EFFECT_EXTENSIONS = new Set(["effect.json"]);
const VEHICLE_EXTENSIONS = new Set(["vehicle.json"]);
// Foliage Type assets (engine/scene/foliage.ts). Distinct from the per-layout
// `<layout>.foliage.json` instance sidecar (which is a layout companion, not a
// manifest asset) so path-based classification never confuses the two.
const FOLIAGE_TYPE_EXTENSIONS = new Set(["foliagetype.json"]);
const PREFAB_EXTENSIONS = new Set([
  "actor.json",
  "particle.json",
  "prefab.json",
  "script.json",
  "sound.json",
]);
const ASSET_FILE_EXTENSIONS = new Set([
  ...MODEL_EXTENSIONS,
  ...THUMBNAIL_EXTENSIONS,
  ...SOUND_EXTENSIONS,
  "json",
]);
const DEVELOPMENT_CONTENT_VARIANT_PARENT_TEXTURE =
  /^assets\/DevelopmentContent\/Textures\/(?:LightMasks|Particle)\/[^/]+\.png$/;
const PLACEMENT_SURFACES: readonly PlacementSurface[] = ["floor", "wall", "room", "character"];
export const ASSET_TYPES: readonly AssetType[] = [
  "staticMesh",
  "skeletalMesh",
  "texture",
  "material",
  "sound",
  "soundCue",
  "dialogueVoice",
  "dialogueLine",
  "conversation",
  "blackboard",
  "behaviorTree",
  "aiQuery",
  "stateTree",
  "animation",
  "effect",
  "vehicle",
  "foliageType",
  "prefab",
  "ui",
  "level",
];

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === "string" && ASSET_TYPES.includes(value as AssetType);
}

export function isModelAssetType(value: AssetType): boolean {
  return value === "staticMesh" || value === "skeletalMesh";
}

export function assetType(asset: AssetRecord): AssetType {
  if (isAssetType(asset.assetType)) return asset.assetType;
  if (isAssetType(asset.type)) return asset.type;
  if (asset.type === "model") return "staticMesh";
  return inferAssetTypeFromPath(assetPath(asset)) ?? "staticMesh";
}

export function inferAssetTypeFromPath(path: string): AssetType | null {
  const lower = normalizePublicPath(path).toLowerCase();
  const ext = extensionOf(lower);
  if (MODEL_EXTENSIONS.has(ext)) return "staticMesh";
  if (THUMBNAIL_EXTENSIONS.has(ext)) return "texture";
  if (SOUND_EXTENSIONS.has(ext)) return "sound";
  if (SOUND_CUE_EXTENSIONS.has(compoundExtensionOf(lower))) return "soundCue";
  if (DIALOGUE_VOICE_EXTENSIONS.has(compoundExtensionOf(lower))) return "dialogueVoice";
  if (CONVERSATION_EXTENSIONS.has(compoundExtensionOf(lower))) return "conversation";
  if (DIALOGUE_LINE_EXTENSIONS.has(compoundExtensionOf(lower))) return "dialogueLine";
  if (BLACKBOARD_EXTENSIONS.has(compoundExtensionOf(lower))) return "blackboard";
  if (BEHAVIOR_TREE_EXTENSIONS.has(compoundExtensionOf(lower))) return "behaviorTree";
  if (AI_QUERY_EXTENSIONS.has(compoundExtensionOf(lower))) return "aiQuery";
  if (STATE_TREE_EXTENSIONS.has(compoundExtensionOf(lower))) return "stateTree";
  if (MATERIAL_EXTENSIONS.has(compoundExtensionOf(lower))) return "material";
  if (LEVEL_EXTENSIONS.has(compoundExtensionOf(lower))) return "level";
  if (UI_EXTENSIONS.has(compoundExtensionOf(lower))) return "ui";
  if (EFFECT_EXTENSIONS.has(compoundExtensionOf(lower))) return "effect";
  if (VEHICLE_EXTENSIONS.has(compoundExtensionOf(lower))) return "vehicle";
  if (FOLIAGE_TYPE_EXTENSIONS.has(compoundExtensionOf(lower))) return "foliageType";
  if (PREFAB_EXTENSIONS.has(compoundExtensionOf(lower))) return "prefab";
  return null;
}

export function assetPath(asset: AssetRecord): string {
  return asset.path ?? asset.file ?? "";
}

export function assetLoadGroup(asset: AssetRecord): string {
  return asset.runtime?.loadGroup ?? asset.loadGroup ?? "";
}

export function assetByteSize(asset: AssetRecord): number {
  return asset.runtime?.bytes ?? asset.bytes ?? 0;
}

export function assetRecordById(
  manifest: AssetManifest,
  id: string,
): AssetRecord | null {
  return manifest.assets.find((asset) => asset.id === id) ?? null;
}

export function recordsForGroup(
  manifest: AssetManifest,
  loadGroup: string,
): AssetRecord[] {
  return manifest.assets.filter((asset) => assetLoadGroup(asset) === loadGroup);
}

export function totalBytesForGroups(
  manifest: AssetManifest,
  loadGroups: string[],
): number {
  const groupSet = new Set(loadGroups);
  return manifest.assets
    .filter((asset) => groupSet.has(assetLoadGroup(asset)))
    .reduce((total, asset) => total + assetByteSize(asset), 0);
}

export function editableAssetsFromManifest(
  manifest: AssetManifest,
  catalog: AssetCatalog | null,
): EditableAsset[] {
  const catalogById = new Map(catalog?.assets.map((asset) => [asset.id, asset]));
  return manifest.assets
    .map((asset) => {
      const catalogAsset = catalogById.get(asset.id);
      return {
        ...asset,
        assetType: catalogAsset?.assetType
          ? catalogAsset.assetType
          : catalogAsset?.type
            ? (normalizeAssetType(catalogAsset.type) ?? assetType(asset))
            : assetType(asset),
        displayName: catalogAsset?.name ?? asset.name ?? asset.id,
        catalogCategory: catalogAsset?.category ?? asset.category,
        placement:
          catalogAsset?.placement ?? asset.placement ?? defaultPlacementForAsset(assetType(asset)),
        tags: catalogAsset?.tags ?? asset.tags ?? [],
      };
    });
}

/**
 * Fallback placement affordances for an asset with no explicit `placement`
 * (e.g. a freshly imported file). Driven by asset *type*, not by folder/category,
 * so the template stays generic: skinned characters get a character surface,
 * everything else rests on the floor. Folder organization is the user's concern.
 */
export function defaultPlacementForAsset(type: AssetType): AssetPlacementRules {
  if (type === "skeletalMesh") {
    return {
      surface: "character",
      snapToWall: false,
      allowRotation: true,
      allowScale: true,
    };
  }
  if (type === "staticMesh") {
    return {
      surface: "floor",
      snapToWall: false,
      allowRotation: true,
      allowScale: true,
    };
  }
  return {
    surface: "floor",
    snapToWall: false,
    allowRotation: false,
    allowScale: false,
  };
}

export function validateAssetManifest(
  value: unknown,
  options: AssetManifestValidationOptions = {},
): AssetManifestHealthReport {
  const issues: AssetManifestIssue[] = [];
  const addIssue = (issue: AssetManifestIssue): void => {
    issues.push(issue);
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addIssue({
      level: "error",
      code: "manifest-invalid",
      message: "Asset manifest must be an object.",
    });
    return finalize(0, 0, issues);
  }

  const manifest = value as Record<string, unknown>;
  if (typeof manifest.version !== "number") {
    addIssue({
      level: "error",
      code: "manifest-version",
      message: "Asset manifest `version` must be a number.",
    });
  }
  if (typeof manifest.generated !== "string") {
    addIssue({
      level: "error",
      code: "manifest-generated",
      message: "Asset manifest `generated` must be a string.",
    });
  }
  if (typeof manifest.ktx2 !== "boolean") {
    addIssue({
      level: "error",
      code: "manifest-ktx2",
      message: "Asset manifest `ktx2` must be a boolean.",
    });
  }
  if (!Array.isArray(manifest.assets)) {
    addIssue({
      level: "error",
      code: "manifest-assets",
      message: "Asset manifest `assets` must be an array.",
    });
    return finalize(0, 0, issues);
  }

  const publicFiles = new Set(
    [...(options.publicFiles ?? [])].map((path) => normalizePublicPath(path)),
  );
  const manifestPaths = new Set<string>();
  const manifestThumbs = new Set<string>();
  const ids = new Set<string>();
  let placeableCount = 0;

  for (const rawAsset of manifest.assets) {
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) {
      addIssue({
        level: "error",
        code: "asset-invalid",
        message: "Manifest asset entry must be an object.",
      });
      continue;
    }

    const asset = rawAsset as Partial<AssetRecord> & Record<string, unknown>;
    const assetId = typeof asset.id === "string" ? asset.id : undefined;
    if (!assetId) {
      addIssue({
        level: "error",
        code: "asset-id",
        message: "Asset `id` must be a non-empty string.",
      });
    } else if (ids.has(assetId)) {
      addIssue({
        level: "error",
        code: "asset-id-duplicate",
        assetId,
        message: `Duplicate asset id: ${assetId}`,
      });
    } else {
      ids.add(assetId);
    }

    checkString(asset.name, "asset-name", "`name` must be a non-empty string", addIssue, assetId);
    checkString(asset.category, "asset-category", "`category` must be a non-empty string", addIssue, assetId);
    const normalizedType = normalizeAssetType(asset.assetType ?? asset.type);
    if (!normalizedType) {
      addIssue({
        level: "error",
        code: "asset-type",
        assetId,
        message:
          "`assetType` must be one of staticMesh, skeletalMesh, texture, material, sound, soundCue, dialogueVoice, dialogueLine, conversation, blackboard, behaviorTree, aiQuery, stateTree, animation, effect, vehicle, foliageType, prefab, ui, or level.",
      });
    }

    const path = normalizePublicPath(
      typeof asset.path === "string" ? asset.path : typeof asset.file === "string" ? asset.file : "",
    );
    if (!path) {
      addIssue({
        level: "error",
        code: "asset-path",
        assetId,
        message: "`path` must be a public-root-relative asset path.",
      });
    } else {
      manifestPaths.add(path);
      validateRelativePath(path, "asset-path", assetId, addIssue);
      if (normalizedType === "texture" && isDevelopmentContentVariantParentTexture(path)) {
        addIssue({
          level: "error",
          code: "asset-texture-variant-parent",
          assetId,
          path,
          message:
            "DevelopmentContent LightMasks/Particle textures must reference a concrete variant folder such as Black or Transparent.",
        });
      }
      if (normalizedType && isModelAssetType(normalizedType) && !MODEL_EXTENSIONS.has(extensionOf(path))) {
        addIssue({
          level: "error",
          code: "asset-path-extension",
          assetId,
          path,
          message: "Mesh asset path must end with .glb or .gltf.",
        });
      }
      if (publicFiles.size > 0 && !publicFiles.has(path)) {
        addIssue({
          level: "error",
          code: "asset-path-missing",
          assetId,
          path,
          message: `Manifest asset path does not exist on disk: ${path}`,
        });
      }
    }

    if (typeof asset.thumbnail === "string" && asset.thumbnail.length > 0) {
      const thumbnail = normalizePublicPath(asset.thumbnail);
      manifestThumbs.add(thumbnail);
      validateRelativePath(thumbnail, "asset-thumbnail", assetId, addIssue);
      if (!THUMBNAIL_EXTENSIONS.has(extensionOf(thumbnail))) {
        addIssue({
          level: "warning",
          code: "asset-thumbnail-extension",
          assetId,
          path: thumbnail,
          message: "Thumbnail should be a .png, .jpg, .jpeg, or .webp image.",
        });
      }
      if (publicFiles.size > 0 && !publicFiles.has(thumbnail)) {
        addIssue({
          level: "warning",
          code: "asset-thumbnail-file-missing",
          assetId,
          path: thumbnail,
          message: `Thumbnail path does not exist on disk: ${thumbnail}`,
        });
      }
    } else {
      addIssue({
        level: "warning",
        code: "asset-thumbnail-missing",
        assetId,
        message: "Asset has no manifest thumbnail; editor will fall back to generated preview.",
      });
    }

    if (!Array.isArray(asset.tags) || !asset.tags.every((tag) => typeof tag === "string")) {
      addIssue({
        level: "error",
        code: "asset-tags",
        assetId,
        message: "`tags` must be a string array.",
      });
    }

    if (typeof asset.placeable !== "boolean") {
      addIssue({
        level: "error",
        code: "asset-placeable",
        assetId,
        message: "`placeable` must be a boolean.",
      });
    } else if (asset.placeable) {
      placeableCount += 1;
    }

    validatePlacementRules(asset.placement, assetId, addIssue);
    validateRuntimeSettings(asset.runtime, assetId, addIssue);
    if (typeof asset.license !== "string" || asset.license.length === 0) {
      addIssue({
        level: "error",
        code: "asset-license",
        assetId,
        message: "`license` must be a non-empty string.",
      });
    }
  }

  for (const path of publicFiles) {
    if (!isHealthCheckAssetFile(path)) continue;
    if (manifestPaths.has(path) || manifestThumbs.has(path)) continue;
    addIssue({
      level: "warning",
      code: "asset-file-unregistered",
      path,
      message: `Asset-like file exists but is not registered in the manifest: ${path}`,
    });
  }

  return finalize(manifest.assets.length, placeableCount, issues);
}

function checkString(
  value: unknown,
  code: string,
  detail: string,
  addIssue: (issue: AssetManifestIssue) => void,
  assetId?: string,
): void {
  if (typeof value !== "string" || value.length === 0) {
    addIssue({
      level: "error",
      code,
      assetId,
      message: detail,
    });
  }
}

function validatePlacementRules(
  value: unknown,
  assetId: string | undefined,
  addIssue: (issue: AssetManifestIssue) => void,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addIssue({
      level: "error",
      code: "asset-placement",
      assetId,
      message: "`placement` must define surface and transform affordances.",
    });
    return;
  }
  const placement = value as Partial<AssetPlacementRules>;
  if (
    typeof placement.surface !== "string" ||
    !PLACEMENT_SURFACES.includes(placement.surface as PlacementSurface)
  ) {
    addIssue({
      level: "error",
      code: "asset-placement-surface",
      assetId,
      message: "`placement.surface` must be floor, wall, room, or character.",
    });
  }
  for (const key of ["snapToWall", "allowRotation", "allowScale"] as const) {
    if (typeof placement[key] !== "boolean") {
      addIssue({
        level: "error",
        code: `asset-placement-${key}`,
        assetId,
        message: `\`placement.${key}\` must be a boolean.`,
      });
    }
  }
}

function validateRuntimeSettings(
  value: unknown,
  assetId: string | undefined,
  addIssue: (issue: AssetManifestIssue) => void,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addIssue({
      level: "error",
      code: "asset-runtime",
      assetId,
      message: "`runtime` must define load group and runtime defaults.",
    });
    return;
  }
  const runtime = value as Partial<AssetRuntimeSettings>;
  checkString(runtime.loadGroup, "asset-runtime-loadGroup", "`runtime.loadGroup` must be a non-empty string", addIssue, assetId);
  for (const key of ["castShadow", "receiveShadow", "collision"] as const) {
    if (typeof runtime[key] !== "boolean") {
      addIssue({
        level: "error",
        code: `asset-runtime-${key}`,
        assetId,
        message: `\`runtime.${key}\` must be a boolean.`,
      });
    }
  }
  if (typeof runtime.bytes !== "number" || !Number.isFinite(runtime.bytes) || runtime.bytes < 0) {
    addIssue({
      level: "error",
      code: "asset-runtime-bytes",
      assetId,
      message: "`runtime.bytes` must be a non-negative number.",
    });
  }
}

function validateRelativePath(
  path: string,
  code: string,
  assetId: string | undefined,
  addIssue: (issue: AssetManifestIssue) => void,
): void {
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\")) {
    addIssue({
      level: "error",
      code,
      assetId,
      path,
      message: "Manifest paths must be public-root-relative, not absolute.",
    });
  }
  if (path.split("/").includes("..")) {
    addIssue({
      level: "error",
      code,
      assetId,
      path,
      message: "Manifest paths must not contain `..` segments.",
    });
  }
}

function isHealthCheckAssetFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (!lower.startsWith("assets/")) return false;
  if (lower.endsWith("/manifest.json") || lower.endsWith("/catalog.json")) return false;
  if (lower.endsWith("/metadata-schema.json")) return false;
  if (lower.endsWith(".collision.json")) return false;
  if (lower.endsWith(".materials.json")) return false;
  if (lower.endsWith(".uvw.json")) return false;
  if (lower.endsWith(".vertexcolors.json")) return false;
  return ASSET_FILE_EXTENSIONS.has(extensionOf(lower));
}

function isDevelopmentContentVariantParentTexture(path: string): boolean {
  return DEVELOPMENT_CONTENT_VARIANT_PARENT_TEXTURE.test(path);
}

function normalizePublicPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^public\//, "");
}

function normalizeAssetType(value: unknown): AssetType | null {
  if (isAssetType(value)) return value;
  if (value === "model") return "staticMesh";
  return null;
}

function extensionOf(path: string): string {
  const file = path.split("/").at(-1) ?? "";
  const index = file.lastIndexOf(".");
  return index === -1 ? "" : file.slice(index + 1).toLowerCase();
}

function compoundExtensionOf(path: string): string {
  const parts = path.split("/").at(-1)?.split(".") ?? [];
  return parts.length < 2 ? "" : parts.slice(1).join(".").toLowerCase();
}

function finalize(
  assetCount: number,
  placeableCount: number,
  issues: AssetManifestIssue[],
): AssetManifestHealthReport {
  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const warningCount = issues.filter((issue) => issue.level === "warning").length;
  return {
    valid: errorCount === 0,
    assetCount,
    placeableCount,
    errorCount,
    warningCount,
    issues,
  };
}
