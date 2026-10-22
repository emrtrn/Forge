import {
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type Mesh,
  type Object3D,
} from "three";

export interface ForgeTextureRepeat {
  x: number;
  y: number;
}

export interface ForgeTextureConfig {
  srgb?: boolean;
  repeat?: ForgeTextureRepeat | null;
  anisotropy?: number;
  maxAnisotropy?: number | null | undefined;
  /**
   * Vertical flip on upload. Defaults to three.js' own `true`, which is what
   * engine-generated UVs expect; pass `false` for glTF-exported UVs, whose V axis
   * runs downward from the image top (`GLTFLoader` sets `flipY = false` for the
   * same reason).
   */
  flipY?: boolean;
}

const DEFAULT_REPEAT: ForgeTextureRepeat = { x: 1, y: 1 };
const DEFAULT_ANISOTROPY_CAP = 8;

export function configureForgeTexture(
  texture: Texture,
  config: ForgeTextureConfig = {},
): Texture {
  const repeat = config.repeat ?? DEFAULT_REPEAT;
  texture.colorSpace = config.srgb ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat.x, repeat.y);
  texture.flipY = config.flipY ?? true;
  texture.anisotropy = resolveTextureAnisotropy(config);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Raises every texture a loaded model's materials reference (glTF-embedded
 * maps never pass through `configureForgeTexture`) to the same default
 * anisotropy, so they don't fall back to three's 1x and smear at grazing angles.
 */
export function applyDefaultModelTextureAnisotropy(
  root: Object3D,
  maxAnisotropy: number | null | undefined,
): void {
  const anisotropy = resolveTextureAnisotropy({ maxAnisotropy });
  if (anisotropy <= 1) return;
  root.traverse((object) => {
    const material = (object as Partial<Mesh>).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(entry)) {
        if (value instanceof Texture && value.anisotropy < anisotropy) {
          value.anisotropy = anisotropy;
          value.needsUpdate = true;
        }
      }
    }
  });
}

function resolveTextureAnisotropy(config: ForgeTextureConfig): number {
  const max = Number(config.maxAnisotropy);
  const maxAnisotropy = Number.isFinite(max) && max > 0 ? max : 1;
  const requested = Number.isFinite(config.anisotropy)
    ? Number(config.anisotropy)
    : Math.min(DEFAULT_ANISOTROPY_CAP, maxAnisotropy);
  return Math.min(Math.max(1, requested), maxAnisotropy);
}
