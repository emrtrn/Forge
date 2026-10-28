import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from "three";

import { assetPath, assetRecordById, assetType, type AssetManifest } from "@engine/assets/manifest";
import { normalizeForgeMaterialDef } from "@engine/assets/material";
import {
  createThreeMaterialFromForgeDef,
  type ForgeThreeMaterial,
} from "@engine/render-three/materials";
import { projectFileUrl } from "@/project/ProjectSystem";

export async function loadForgeMaterial(
  manifest: AssetManifest,
  materialId: string,
  textureLoader = new TextureLoader(),
  options: { maxAnisotropy?: number } = {},
): Promise<ForgeThreeMaterial> {
  const materialRecord = assetRecordById(manifest, materialId);
  if (!materialRecord || assetType(materialRecord) !== "material") {
    throw new Error(`Material asset not found: ${materialId}`);
  }
  // Revalidate against the dev server (matches the Material Editor's loader). Without
  // this the browser can serve a stale heuristic-cached material JSON, so a layer
  // blend / mask edited and saved in the editor never reaches the scene or Play.
  const response = await fetch(projectFileUrl(assetPath(materialRecord)), { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Material asset failed: ${response.status} ${response.statusText}`);
  }
  const def = normalizeForgeMaterialDef(await response.json(), materialRecord.name);
  return createThreeMaterialFromForgeDef(
    def,
    {
      baseColorTexture: def.baseColorTexture
        ? await loadTextureByAssetId(manifest, def.baseColorTexture, textureLoader)
        : null,
      normalTexture: def.normalTexture
        ? await loadTextureByAssetId(manifest, def.normalTexture, textureLoader)
        : null,
      roughnessTexture: def.roughnessTexture
        ? await loadTextureByAssetId(manifest, def.roughnessTexture, textureLoader)
        : null,
      metalnessTexture: def.metalnessTexture
        ? await loadTextureByAssetId(manifest, def.metalnessTexture, textureLoader)
        : null,
      aoTexture: def.aoTexture
        ? await loadTextureByAssetId(manifest, def.aoTexture, textureLoader)
        : null,
      opacityTexture: def.opacityTexture
        ? await loadTextureByAssetId(manifest, def.opacityTexture, textureLoader)
        : null,
      emissiveTexture: def.emissiveTexture
        ? await loadTextureByAssetId(manifest, def.emissiveTexture, textureLoader)
        : null,
      ormTexture: def.ormTexture
        ? await loadTextureByAssetId(manifest, def.ormTexture, textureLoader)
        : null,
      layer1BaseColorTexture: def.layerBlend?.layer1.baseColorTexture
        ? await loadTextureByAssetId(manifest, def.layerBlend.layer1.baseColorTexture, textureLoader)
        : null,
      layer1NormalTexture: def.layerBlend?.layer1.normalTexture
        ? await loadTextureByAssetId(manifest, def.layerBlend.layer1.normalTexture, textureLoader)
        : null,
      layer1RoughnessTexture: def.layerBlend?.layer1.roughnessTexture
        ? await loadTextureByAssetId(manifest, def.layerBlend.layer1.roughnessTexture, textureLoader)
        : null,
      layer1MetalnessTexture: def.layerBlend?.layer1.metalnessTexture
        ? await loadTextureByAssetId(manifest, def.layerBlend.layer1.metalnessTexture, textureLoader)
        : null,
      layer1OpacityTexture: def.layerBlend?.layer1.opacityTexture
        ? await loadTextureByAssetId(manifest, def.layerBlend.layer1.opacityTexture, textureLoader)
        : null,
      layer1EmissiveTexture: def.layerBlend?.layer1.emissiveTexture
        ? await loadTextureByAssetId(manifest, def.layerBlend.layer1.emissiveTexture, textureLoader)
        : null,
      layer1AoTexture: def.layerBlend?.layer1.aoTexture
        ? await loadTextureByAssetId(manifest, def.layerBlend.layer1.aoTexture, textureLoader)
        : null,
      layerBlendMaskTexture: def.layerBlend?.maskTexture
        ? await loadTextureByAssetId(manifest, def.layerBlend.maskTexture, textureLoader)
        : null,
    },
    options,
  );
}

export interface ForgeMaterialLayer {
  normalTexture?: Texture | null;
  /** Texture repeats per metre, when authored by the material. */
  textureScale?: number;
  roughness?: number;
  /** Terrain packs linear roughness into albedo alpha to avoid extra samplers. */
  roughnessInAlpha?: boolean;
  /** Material base color (hex), used as the flat tint when there's no texture. */
  baseColor: string;
  /** Base-color (albedo) texture, tiling-wrapped for terrain splatting, or `null`. */
  texture: Texture | null;
}

/**
 * Loads albedo and optional roughness for Landscape layer splatting. Roughness
 * is packed into albedo alpha (RGB stays sRGB, alpha stays linear), keeping the
 * eight-layer terrain within the existing texture-unit budget. Normals use a
 * separate linear array in the terrain renderer. Skips material layer blends. Returns
 * `null` if the id isn't a material asset or can't be read.
 */
export async function loadForgeMaterialLayer(
  manifest: AssetManifest,
  materialId: string,
  textureLoader = new TextureLoader(),
  options: { maxAnisotropy?: number } = {},
): Promise<ForgeMaterialLayer | null> {
  const materialRecord = assetRecordById(manifest, materialId);
  if (!materialRecord || assetType(materialRecord) !== "material") return null;
  let texture: Texture | null = null;
  let normalTexture: Texture | null = null;
  try {
    const response = await fetch(projectFileUrl(assetPath(materialRecord)), { cache: "no-cache" });
    if (!response.ok) return null;
    const def = normalizeForgeMaterialDef(await response.json(), materialRecord.name);
    if (def.normalTexture) {
      try {
        normalTexture = await loadTextureByAssetId(manifest, def.normalTexture, textureLoader);
        normalTexture.colorSpace = NoColorSpace;
        normalTexture.flipY = def.flipY;
        normalTexture.wrapS = normalTexture.wrapT = RepeatWrapping;
        if (options.maxAnisotropy) normalTexture.anisotropy = options.maxAnisotropy;
        normalTexture.needsUpdate = true;
      } catch { normalTexture = null; } // A missing detail map must not erase the painted layer.
    }
    if (def.baseColorTexture) {
      texture = await loadTextureByAssetId(manifest, def.baseColorTexture, textureLoader);
      texture.colorSpace = SRGBColorSpace;
      texture.flipY = def.flipY;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      if (options.maxAnisotropy) texture.anisotropy = options.maxAnisotropy;
      texture.needsUpdate = true;
    }
    if (def.roughnessTexture) {
      const roughness = await loadTextureByAssetId(manifest, def.roughnessTexture, textureLoader);
      try {
        const packed = packTerrainRoughness(texture, roughness, def.baseColor);
        texture?.dispose();
        texture = packed;
        texture.flipY = def.flipY;
        if (options.maxAnisotropy) texture.anisotropy = options.maxAnisotropy;
      } finally {
        roughness.dispose();
      }
    }
    return { baseColor: def.baseColor ?? "#ffffff", texture, normalTexture, roughness: def.roughness, roughnessInAlpha: Boolean(def.roughnessTexture),
      ...(def.terrainMetersPerRepeat ? { textureScale: 1 / def.terrainMetersPerRepeat } : {}) };
  } catch {
    texture?.dispose();
    normalTexture?.dispose();
    return null;
  }
}

/** Only terrain consumes alpha as roughness; regular materials keep opacity. */
function packTerrainRoughness(albedo: Texture | null, roughness: Texture, color: string): Texture {
  // Both inputs come from TextureLoader, which produces HTMLImageElements.
  const albedoImage = albedo?.image as HTMLImageElement | undefined;
  const roughnessImage = roughness.image as HTMLImageElement;
  const image = albedoImage ?? roughnessImage;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Terrain roughness packing requires a 2D canvas");
  if (albedoImage) context.drawImage(albedoImage, 0, 0, canvas.width, canvas.height);
  else { context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height); }
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(roughnessImage, 0, 0, canvas.width, canvas.height);
  const roughPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  // Three.js roughness maps use green. Read raw bytes without sRGB conversion.
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = roughPixels[i + 1]!;
  const texture = new DataTexture(new Uint8Array(pixels), canvas.width, canvas.height);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

async function loadTextureByAssetId(
  manifest: AssetManifest,
  textureId: string,
  loader: TextureLoader,
) {
  const record = assetRecordById(manifest, textureId);
  if (!record || assetType(record) !== "texture") {
    throw new Error(`Texture asset not found: ${textureId}`);
  }
  return loader.loadAsync(projectFileUrl(assetPath(record)));
}
