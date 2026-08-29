import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  PerspectiveCamera,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  type Material,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  ForgeMaterialAlphaMode,
  ForgeMaterialDef,
  ForgeMaterialLayerBlend,
  ForgeMaterialSide,
  ForgeMaterialType,
  ForgeMaterialUvTiling,
} from "@engine/assets/material";
import { createThreeMaterialFromForgeDef } from "@engine/render-three/materials";
import { createForgeGltfLoader } from "@engine/render-three/gltfLoader";

export interface ThumbnailMaterialPreview {
  materialType: ForgeMaterialType;
  baseColor: string;
  baseColorTextureUrl?: string;
  normalTextureUrl?: string;
  roughnessTextureUrl?: string;
  metalnessTextureUrl?: string;
  aoTextureUrl?: string;
  opacityTextureUrl?: string;
  emissiveTextureUrl?: string;
  ormTextureUrl?: string;
  layerBlend?: ForgeMaterialLayerBlend | null;
  layer1BaseColorTextureUrl?: string;
  layer1NormalTextureUrl?: string;
  layer1RoughnessTextureUrl?: string;
  layer1MetalnessTextureUrl?: string;
  layer1OpacityTextureUrl?: string;
  layer1EmissiveTextureUrl?: string;
  layer1AoTextureUrl?: string;
  layerBlendMaskTextureUrl?: string;
  uvTiling: ForgeMaterialUvTiling;
  flipY: boolean;
  roughness: number;
  metalness: number;
  aoIntensity: number;
  opacity: number;
  useBaseColorAlphaForOpacity: boolean;
  alphaMode: ForgeMaterialAlphaMode;
  alphaTest: number;
  side: ForgeMaterialSide;
  emissive: string;
  emissiveIntensity: number;
}

export class ThumbnailRenderer {
  private readonly loader: GLTFLoader;
  private readonly textureLoader = new TextureLoader();
  private readonly renderer: WebGLRenderer;
  private readonly cache = new Map<string, Promise<string>>();

  constructor(size = 192) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.loader = createForgeGltfLoader(this.renderer);
  }

  renderModel(url: string, material?: ThumbnailMaterialPreview): Promise<string> {
    const cacheKey = material ? `model:${url}:${materialCacheKey(material)}` : url;
    let cached = this.cache.get(cacheKey);
    if (!cached) {
      cached = this.renderModelUncached(url, material);
      this.cache.set(cacheKey, cached);
    }
    return cached;
  }

  renderMaterial(key: string, material: ThumbnailMaterialPreview): Promise<string> {
    const cacheKey = `material:${key}:${materialCacheKey(material)}`;
    let cached = this.cache.get(cacheKey);
    if (!cached) {
      cached = this.renderMaterialUncached(material);
      this.cache.set(cacheKey, cached);
    }
    return cached;
  }

  dispose(): void {
    this.renderer.dispose();
    this.cache.clear();
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async renderModelUncached(
    url: string,
    materialPreview?: ThumbnailMaterialPreview,
  ): Promise<string> {
    const gltf = await this.loader.loadAsync(url);
    const model = gltf.scene.clone(true);
    const scene = new Scene();
    scene.background = new Color(0x191b1f);
    scene.add(new AmbientLight(0xffffff, 1.2));

    const keyLight = new DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(2.5, 4, 3);
    scene.add(keyLight);

    const fillLight = new DirectionalLight(0xb9d4ff, 1.2);
    fillLight.position.set(-3, 2.5, -2);
    scene.add(fillLight);

    const group = new Group();
    const material = materialPreview
      ? await this.createMaterialFromPreview(materialPreview)
      : null;
    if (material) {
      model.traverse((object) => {
        if (object instanceof Mesh) object.material = material;
      });
    }
    group.add(model);
    scene.add(group);

    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z, 0.1);
    model.position.sub(center);
    model.position.y += size.y / 2;
    group.rotation.y = -Math.PI / 5;

    const grid = new GridHelper(Math.max(maxAxis * 2.6, 2), 12, 0x464a51, 0x292c31);
    grid.position.y = -0.01;
    scene.add(grid);

    const camera = new PerspectiveCamera(32, 1, 0.01, 100);
    const distance = maxAxis * 2.4;
    camera.position.set(distance * 0.85, distance * 0.7, distance);
    camera.lookAt(0, size.y * 0.38, 0);
    camera.updateProjectionMatrix();

    this.renderer.setClearColor(0x191b1f, 1);
    this.renderer.render(scene, camera);
    const imageUrl = this.renderer.domElement.toDataURL("image/png");
    disposeMaterial(material);
    return imageUrl;
  }

  private async renderMaterialUncached(materialPreview: ThumbnailMaterialPreview): Promise<string> {
    const scene = new Scene();
    scene.background = new Color(0x191b1f);
    scene.add(new AmbientLight(0xffffff, 1.1));

    const keyLight = new DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(3, 4, 3);
    scene.add(keyLight);

    const rimLight = new DirectionalLight(0xb9d4ff, 1.0);
    rimLight.position.set(-3, 2, -2);
    scene.add(rimLight);

    const material = await this.createMaterialFromPreview(materialPreview);

    const sphere = new Mesh(new SphereGeometry(0.82, 48, 32), material);
    sphere.rotation.y = -Math.PI / 7;
    scene.add(sphere);

    const camera = new PerspectiveCamera(28, 1, 0.01, 100);
    camera.position.set(0, 0.05, 4.2);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    this.renderer.setClearColor(0x191b1f, 1);
    this.renderer.render(scene, camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    sphere.geometry.dispose();
    disposeMaterial(material);
    return url;
  }

  private async createMaterialFromPreview(
    preview: ThumbnailMaterialPreview,
  ): Promise<MeshStandardMaterial | MeshBasicMaterial> {
    const material =
      createThreeMaterialFromForgeDef(
        thumbnailPreviewToMaterialDef(preview),
        {
          baseColorTexture: await this.loadPreviewTexture(preview.baseColorTextureUrl),
          normalTexture: await this.loadPreviewTexture(preview.normalTextureUrl),
          roughnessTexture: await this.loadPreviewTexture(preview.roughnessTextureUrl),
          metalnessTexture: await this.loadPreviewTexture(preview.metalnessTextureUrl),
          aoTexture: await this.loadPreviewTexture(preview.aoTextureUrl),
          opacityTexture: await this.loadPreviewTexture(preview.opacityTextureUrl),
          emissiveTexture: await this.loadPreviewTexture(preview.emissiveTextureUrl),
          ormTexture: await this.loadPreviewTexture(preview.ormTextureUrl),
          layer1BaseColorTexture: await this.loadPreviewTexture(preview.layer1BaseColorTextureUrl),
          layer1NormalTexture: await this.loadPreviewTexture(preview.layer1NormalTextureUrl),
          layer1RoughnessTexture: await this.loadPreviewTexture(preview.layer1RoughnessTextureUrl),
          layer1MetalnessTexture: await this.loadPreviewTexture(preview.layer1MetalnessTextureUrl),
          layer1OpacityTexture: await this.loadPreviewTexture(preview.layer1OpacityTextureUrl),
          layer1EmissiveTexture: await this.loadPreviewTexture(preview.layer1EmissiveTextureUrl),
          layer1AoTexture: await this.loadPreviewTexture(preview.layer1AoTextureUrl),
          layerBlendMaskTexture: await this.loadPreviewTexture(preview.layerBlendMaskTextureUrl),
        },
        { maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy() },
      );
    return material;
  }

  private async loadPreviewTexture(url: string | undefined): Promise<import("three").Texture | null> {
    return url ? this.textureLoader.loadAsync(url) : null;
  }
}

function disposeMaterial(material: Material | null): void {
  if (!material) return;
  const textures = new Set<import("three").Texture>();
  if (material instanceof MeshBasicMaterial || material instanceof MeshStandardMaterial) {
    if (material.map) textures.add(material.map);
  }
  if (material instanceof MeshStandardMaterial) {
    if (material.normalMap) textures.add(material.normalMap);
    if (material.roughnessMap) textures.add(material.roughnessMap);
    if (material.metalnessMap) textures.add(material.metalnessMap);
    if (material.aoMap) textures.add(material.aoMap);
  }
  textures.forEach((texture) => texture.dispose());
  material.dispose();
}

function materialCacheKey(material: ThumbnailMaterialPreview): string {
  return JSON.stringify(material);
}

function thumbnailPreviewToMaterialDef(preview: ThumbnailMaterialPreview): ForgeMaterialDef {
  return {
    schema: 1,
    type: "material",
    materialType: preview.materialType,
    name: "Thumbnail",
    baseColor: preview.baseColor,
    baseColorTexture: preview.baseColorTextureUrl ? "__thumbnail-base-color" : null,
    normalTexture: preview.normalTextureUrl ? "__thumbnail-normal" : null,
    maskTexture: null,
    roughnessTexture: preview.roughnessTextureUrl ? "__thumbnail-roughness" : null,
    metalnessTexture: preview.metalnessTextureUrl ? "__thumbnail-metalness" : null,
    aoTexture: preview.aoTextureUrl ? "__thumbnail-ao" : null,
    opacityTexture: preview.opacityTextureUrl ? "__thumbnail-opacity" : null,
    emissiveTexture: preview.emissiveTextureUrl ? "__thumbnail-emissive" : null,
    ormTexture: preview.ormTextureUrl ? "__thumbnail-orm" : null,
    uvTiling: preview.uvTiling,
    flipY: preview.flipY,
    roughness: preview.roughness,
    metalness: preview.metalness,
    aoIntensity: preview.aoIntensity,
    opacity: preview.opacity,
    useBaseColorAlphaForOpacity: preview.useBaseColorAlphaForOpacity,
    alphaMode: preview.alphaMode,
    alphaTest: preview.alphaTest,
    side: preview.side,
    emissive: preview.emissive,
    emissiveIntensity: preview.emissiveIntensity,
    // A thumbnail is a single still frame, so animated normals buy it nothing.
    normalMotion: null,
    layerBlend: preview.layerBlend ?? null,
  };
}
