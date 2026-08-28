export const FORGE_MATERIAL_TYPES = ["standard", "basic"] as const;
export type ForgeMaterialType = (typeof FORGE_MATERIAL_TYPES)[number];

export const FORGE_MATERIAL_SIDES = ["front", "back", "double"] as const;
export type ForgeMaterialSide = (typeof FORGE_MATERIAL_SIDES)[number];

export const FORGE_MATERIAL_ALPHA_MODES = ["opaque", "blend", "mask"] as const;
export type ForgeMaterialAlphaMode = (typeof FORGE_MATERIAL_ALPHA_MODES)[number];

export const FORGE_MATERIAL_PRESETS = [
  "standard",
  "textured",
  "metal",
  "glass",
  "emissive",
  "basic",
] as const;
export type ForgeMaterialPreset = (typeof FORGE_MATERIAL_PRESETS)[number];

export const FORGE_MATERIAL_LAYER_BLEND_DRIVERS = [
  "constant",
  "slope",
  "worldHeight",
  "maskTexture",
  "vertexColor",
] as const;
export type ForgeMaterialLayerBlendDriver =
  (typeof FORGE_MATERIAL_LAYER_BLEND_DRIVERS)[number];

export const FORGE_MATERIAL_VERTEX_COLOR_CHANNELS = ["r", "g", "b", "a"] as const;
export type ForgeMaterialVertexColorChannel =
  (typeof FORGE_MATERIAL_VERTEX_COLOR_CHANNELS)[number];

export interface ForgeMaterialUvTiling {
  x: number;
  y: number;
}

/** A signed UV-space velocity in repeats per second. */
export interface ForgeMaterialUvVelocity {
  x: number;
  y: number;
}

/**
 * Optional two-sample normal-map motion. It is deliberately generic: water is
 * one consumer, while materials without this field retain the stock shader.
 */
export interface ForgeMaterialNormalMotion {
  primaryVelocity: ForgeMaterialUvVelocity;
  secondaryTiling: ForgeMaterialUvTiling;
  secondaryVelocity: ForgeMaterialUvVelocity;
  strength: number;
}

export interface ForgeMaterialLayer {
  baseColor: string;
  baseColorTexture: string | null;
  normalTexture: string | null;
  roughnessTexture: string | null;
  metalnessTexture: string | null;
  opacityTexture: string | null;
  emissiveTexture: string | null;
  aoTexture: string | null;
  roughness: number;
  metalness: number;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
  aoIntensity: number;
  uvTiling: ForgeMaterialUvTiling;
}

export interface ForgeMaterialLayerBlend {
  layer1: ForgeMaterialLayer;
  driver: ForgeMaterialLayerBlendDriver;
  amount: number;
  min: number;
  max: number;
  contrast: number;
  maskTexture: string | null;
  /** Vertex-color channel used when the blend driver is `vertexColor`. */
  vertexColorChannel: ForgeMaterialVertexColorChannel;
  /** Reverses the selected vertex-color channel before layer blending. */
  invertVertexColor: boolean;
}

export interface ForgeMaterialDef {
  schema: 1;
  type: "material";
  materialType: ForgeMaterialType;
  name: string;
  baseColor: string;
  baseColorTexture: string | null;
  normalTexture: string | null;
  maskTexture: string | null;
  roughnessTexture: string | null;
  metalnessTexture: string | null;
  aoTexture: string | null;
  opacityTexture: string | null;
  /** Uses the alpha channel already packed into Base Color Map when no opacity map is needed. */
  useBaseColorAlphaForOpacity: boolean;
  emissiveTexture: string | null;
  ormTexture: string | null;
  uvTiling: ForgeMaterialUvTiling;
  /**
   * Whether this material's textures are flipped on upload (three.js' default,
   * matching engine-generated UVs: landscape splats, UVW projection, primitives).
   *
   * Turn it **off** for a material assigned to a glTF/GLB mesh through its
   * material slots: glTF authors V downward from the image top and `GLTFLoader`
   * therefore never flips its own textures, so a `TextureLoader`-loaded PNG binds
   * upside down against those exported UVs — the atlas lands on the wrong
   * islands, which reads as a broken UV layout rather than a flipped image.
   */
  flipY: boolean;
  roughness: number;
  metalness: number;
  aoIntensity: number;
  opacity: number;
  alphaMode: ForgeMaterialAlphaMode;
  alphaTest: number;
  side: ForgeMaterialSide;
  emissive: string;
  emissiveIntensity: number;
  normalMotion: ForgeMaterialNormalMotion | null;
  layerBlend: ForgeMaterialLayerBlend | null;
}

export function isForgeMaterialPreset(value: unknown): value is ForgeMaterialPreset {
  return typeof value === "string" && FORGE_MATERIAL_PRESETS.includes(value as ForgeMaterialPreset);
}

export function isForgeMaterialType(value: unknown): value is ForgeMaterialType {
  return typeof value === "string" && FORGE_MATERIAL_TYPES.includes(value as ForgeMaterialType);
}

export function isForgeMaterialSide(value: unknown): value is ForgeMaterialSide {
  return typeof value === "string" && FORGE_MATERIAL_SIDES.includes(value as ForgeMaterialSide);
}

export function isForgeMaterialAlphaMode(value: unknown): value is ForgeMaterialAlphaMode {
  return (
    typeof value === "string" &&
    FORGE_MATERIAL_ALPHA_MODES.includes(value as ForgeMaterialAlphaMode)
  );
}

export function defaultForgeMaterialDef(
  name: string,
  preset: ForgeMaterialPreset = "standard",
): ForgeMaterialDef {
  const base: ForgeMaterialDef = {
    schema: 1,
    type: "material",
    materialType: "standard",
    name,
    baseColor: "#ffffff",
    baseColorTexture: null,
    normalTexture: null,
    maskTexture: null,
    roughnessTexture: null,
    metalnessTexture: null,
    aoTexture: null,
    opacityTexture: null,
    useBaseColorAlphaForOpacity: false,
    emissiveTexture: null,
    ormTexture: null,
    uvTiling: { x: 1, y: 1 },
    flipY: true,
    roughness: 0.8,
    metalness: 0,
    aoIntensity: 1,
    opacity: 1,
    alphaMode: "opaque",
    alphaTest: 0.5,
    side: "front",
    emissive: "#000000",
    emissiveIntensity: 0,
    normalMotion: null,
    layerBlend: null,
  };

  if (preset === "textured") {
    return { ...base, roughness: 0.75 };
  }
  if (preset === "metal") {
    return { ...base, baseColor: "#b9c0c7", roughness: 0.3, metalness: 1 };
  }
  if (preset === "glass") {
    return {
      ...base,
      baseColor: "#bfe9ff",
      roughness: 0.05,
      opacity: 0.35,
      alphaMode: "blend",
      side: "double",
    };
  }
  if (preset === "emissive") {
    return {
      ...base,
      baseColor: "#46b5ff",
      roughness: 0.4,
      emissive: "#46b5ff",
      emissiveIntensity: 1.5,
    };
  }
  if (preset === "basic") {
    return { ...base, materialType: "basic", roughness: 1 };
  }
  return base;
}

export function normalizeForgeMaterialDef(value: unknown, fallbackName = "Material"): ForgeMaterialDef {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const opacity = clamp01(numberOr(input.opacity, 1));
  const alphaMode = isForgeMaterialAlphaMode(input.alphaMode)
    ? input.alphaMode
    : opacity < 1
      ? "blend"
      : "opaque";
  const legacyMaskTexture = textureRefOrNull(input.maskTexture);
  const layerBlend = layerBlendOrNull(input.layerBlend, legacyMaskTexture);
  const normalMotion = normalMotionOrNull(input.normalMotion);
  const legacyMaskConsumedByLayerBlend =
    layerBlend?.driver === "maskTexture" &&
    layerBlend.maskTexture === legacyMaskTexture &&
    !(
      input.layerBlend &&
      typeof input.layerBlend === "object" &&
      !Array.isArray(input.layerBlend) &&
      textureRefOrNull((input.layerBlend as Record<string, unknown>).maskTexture)
    );
  return {
    schema: 1,
    type: "material",
    materialType: isForgeMaterialType(input.materialType) ? input.materialType : "standard",
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : fallbackName,
    baseColor: colorOr(input.baseColor, "#ffffff"),
    baseColorTexture: textureRefOrNull(input.baseColorTexture),
    normalTexture: textureRefOrNull(input.normalTexture),
    maskTexture: legacyMaskConsumedByLayerBlend ? null : legacyMaskTexture,
    roughnessTexture: textureRefOrNull(input.roughnessTexture),
    metalnessTexture: textureRefOrNull(input.metalnessTexture),
    aoTexture: textureRefOrNull(input.aoTexture),
    opacityTexture: textureRefOrNull(input.opacityTexture),
    useBaseColorAlphaForOpacity: input.useBaseColorAlphaForOpacity === true,
    emissiveTexture: textureRefOrNull(input.emissiveTexture),
    ormTexture: textureRefOrNull(input.ormTexture) ?? (legacyMaskConsumedByLayerBlend ? null : legacyMaskTexture),
    uvTiling: uvTilingOr(input.uvTiling, { x: 1, y: 1 }),
    // Opt-out, not opt-in: every material authored before this field existed was
    // rendering with three.js' flipped default, so absent must keep meaning `true`.
    flipY: input.flipY !== false,
    roughness: clamp01(numberOr(input.roughness, 0.8)),
    metalness: clamp01(numberOr(input.metalness, 0)),
    aoIntensity: clamp01(numberOr(input.aoIntensity, 1)),
    opacity,
    alphaMode,
    alphaTest: clamp01(numberOr(input.alphaTest, 0.5)),
    side: isForgeMaterialSide(input.side) ? input.side : "front",
    emissive: colorOr(input.emissive, "#000000"),
    emissiveIntensity: Math.max(0, numberOr(input.emissiveIntensity, 0)),
    normalMotion,
    layerBlend,
  };
}

export function defaultForgeMaterialNormalMotion(): ForgeMaterialNormalMotion {
  return {
    primaryVelocity: { x: 0.012, y: 0.006 },
    secondaryTiling: { x: 1.37, y: 1.37 },
    secondaryVelocity: { x: -0.009, y: 0.014 },
    strength: 0.65,
  };
}

function normalMotionOrNull(value: unknown): ForgeMaterialNormalMotion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const fallback = defaultForgeMaterialNormalMotion();
  return {
    primaryVelocity: velocityOr(input.primaryVelocity, fallback.primaryVelocity),
    secondaryTiling: uvTilingOr(input.secondaryTiling, fallback.secondaryTiling),
    secondaryVelocity: velocityOr(input.secondaryVelocity, fallback.secondaryVelocity),
    strength: Math.min(4, Math.max(0.05, numberOr(input.strength, fallback.strength))),
  };
}

function velocityOr(value: unknown, fallback: ForgeMaterialUvVelocity): ForgeMaterialUvVelocity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const input = value as Record<string, unknown>;
  return {
    x: Math.min(10, Math.max(-10, numberOr(input.x, fallback.x))),
    y: Math.min(10, Math.max(-10, numberOr(input.y, fallback.y))),
  };
}

export function isForgeMaterialLayerBlendDriver(
  value: unknown,
): value is ForgeMaterialLayerBlendDriver {
  return (
    typeof value === "string" &&
    FORGE_MATERIAL_LAYER_BLEND_DRIVERS.includes(value as ForgeMaterialLayerBlendDriver)
  );
}

export function isForgeMaterialVertexColorChannel(
  value: unknown,
): value is ForgeMaterialVertexColorChannel {
  return (
    typeof value === "string" &&
    FORGE_MATERIAL_VERTEX_COLOR_CHANNELS.includes(value as ForgeMaterialVertexColorChannel)
  );
}

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function colorOr(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function textureRefOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uvTilingOr(value: unknown, fallback: ForgeMaterialUvTiling): ForgeMaterialUvTiling {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const input = value as Record<string, unknown>;
  return {
    x: clampUvTiling(numberOr(input.x, fallback.x)),
    y: clampUvTiling(numberOr(input.y, fallback.y)),
  };
}

function clampUvTiling(value: number): number {
  return Math.min(Math.max(value, 0.001), 100);
}

function layerBlendOrNull(
  value: unknown,
  legacyMaskTexture: string | null = null,
): ForgeMaterialLayerBlend | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const layer1 = layerOr(input.layer1);
  if (!layer1) return null;
  const min = numberOr(input.min, 0);
  const max = numberOr(input.max, 1);
  const driver = isForgeMaterialLayerBlendDriver(input.driver) ? input.driver : "constant";
  const explicitMaskTexture = textureRefOrNull(input.maskTexture);
  return {
    layer1,
    driver,
    amount: clamp01(numberOr(input.amount, 0.5)),
    min: Math.min(min, max),
    max: Math.max(min, max),
    contrast: Math.min(Math.max(numberOr(input.contrast, 1), 0.01), 8),
    maskTexture: explicitMaskTexture ?? (driver === "maskTexture" ? legacyMaskTexture : null),
    vertexColorChannel: isForgeMaterialVertexColorChannel(input.vertexColorChannel)
      ? input.vertexColorChannel
      : "r",
    invertVertexColor: input.invertVertexColor === true,
  };
}

function layerOr(value: unknown): ForgeMaterialLayer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  return {
    baseColor: colorOr(input.baseColor, "#ffffff"),
    baseColorTexture: textureRefOrNull(input.baseColorTexture),
    normalTexture: textureRefOrNull(input.normalTexture),
    roughnessTexture: textureRefOrNull(input.roughnessTexture),
    metalnessTexture: textureRefOrNull(input.metalnessTexture),
    opacityTexture: textureRefOrNull(input.opacityTexture),
    emissiveTexture: textureRefOrNull(input.emissiveTexture),
    aoTexture: textureRefOrNull(input.aoTexture),
    roughness: clamp01(numberOr(input.roughness, 0.8)),
    metalness: clamp01(numberOr(input.metalness, 0)),
    opacity: clamp01(numberOr(input.opacity, 1)),
    emissive: colorOr(input.emissive, "#000000"),
    emissiveIntensity: Math.max(0, numberOr(input.emissiveIntensity, 0)),
    aoIntensity: clamp01(numberOr(input.aoIntensity, 1)),
    uvTiling: uvTilingOr(input.uvTiling, { x: 1, y: 1 }),
  };
}
