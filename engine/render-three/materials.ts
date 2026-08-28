import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector2,
  type Material,
  type Texture,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  ForgeMaterialDef,
  ForgeMaterialLayerBlend,
  ForgeMaterialNormalMotion,
  ForgeMaterialSide,
} from "../assets/material";
import { configureForgeTexture, type ForgeTextureConfig } from "./textureConfig";

type ShaderPatch = Parameters<MeshStandardMaterial["onBeforeCompile"]>[0];

/**
 * `configureForgeTexture` with the material's own flip convention already bound,
 * so every map on one material shares it and a map added later cannot silently
 * fall back to three.js' flipped default.
 */
type ForgeTextureConfigurer = (texture: Texture, config: ForgeTextureConfig) => Texture;

export interface MaterialStats {
  basic: number;
  lit: number;
  total: number;
}

export interface ForgeMaterialTextureMaps {
  baseColorTexture?: Texture | null;
  normalTexture?: Texture | null;
  roughnessTexture?: Texture | null;
  metalnessTexture?: Texture | null;
  aoTexture?: Texture | null;
  opacityTexture?: Texture | null;
  emissiveTexture?: Texture | null;
  ormTexture?: Texture | null;
  layer1BaseColorTexture?: Texture | null;
  layer1NormalTexture?: Texture | null;
  layer1RoughnessTexture?: Texture | null;
  layer1MetalnessTexture?: Texture | null;
  layer1OpacityTexture?: Texture | null;
  layer1EmissiveTexture?: Texture | null;
  layer1AoTexture?: Texture | null;
  layerBlendMaskTexture?: Texture | null;
}

export interface ForgeMaterialOptions {
  maxAnisotropy?: number;
}

export type ForgeThreeMaterial = MeshStandardMaterial | MeshBasicMaterial;

export function isRenderableMesh(
  object: Object3D,
): object is Mesh & { material: Material | Material[] } {
  return object instanceof Mesh;
}

/**
 * Emissive is authored in intuitive ~1-based units (1 starts to read as bloom) but
 * the scene tone-maps from large linear-HDR values, so a small authored number must
 * map to a large actual emissive to glow/bloom. This factor scales the authored
 * `emissiveIntensity` to the three.js material's emissive strength (authored 1 →
 * 1000). It is the counterpart to the bloom strength scale in `postProcess.ts`.
 */
export const EMISSIVE_INTENSITY_SCALE = 1000;

interface NormalMotionState {
  time: { value: number };
  primaryVelocity: { value: Vector2 };
  secondaryTiling: { value: Vector2 };
  secondaryVelocity: { value: Vector2 };
  strength: { value: number };
}

const normalMotionStates = new Map<MeshStandardMaterial, NormalMotionState>();

/** Updates all live authored normal-motion materials once per rendered frame. */
export function advanceForgeMaterialAnimations(elapsedSeconds: number): void {
  const time = Math.max(0, elapsedSeconds);
  for (const state of normalMotionStates.values()) state.time.value = time;
}

export function hasForgeMaterialNormalMotion(material: Material | null | undefined): boolean {
  return material instanceof MeshStandardMaterial && normalMotionStates.has(material);
}

export function createThreeMaterialFromForgeDef(
  def: ForgeMaterialDef,
  textures: ForgeMaterialTextureMaps = {},
  options: ForgeMaterialOptions = {},
): ForgeThreeMaterial {
  // Three.js' standard map shader already multiplies diffuse alpha by `map.a`.
  // This flag makes that authored intent explicit and provides a safe fallback for
  // hand-authored JSON: use a cutout rather than silently rendering it opaque.
  const baseColorAlphaCutout =
    def.useBaseColorAlphaForOpacity &&
    !!textures.baseColorTexture &&
    !textures.opacityTexture &&
    def.alphaMode === "opaque";
  const shared = {
    name: def.name,
    color: new Color(def.baseColor),
    transparent: def.alphaMode === "blend" || def.opacity < 1,
    opacity: def.opacity,
    alphaTest: def.alphaMode === "mask" || baseColorAlphaCutout ? def.alphaTest : 0,
    depthWrite: def.alphaMode !== "blend",
    side: materialSide(def.side),
  };
  const material =
    def.materialType === "basic"
      ? new MeshBasicMaterial(shared)
      : new MeshStandardMaterial({
          ...shared,
          roughness: def.roughness,
          metalness: def.metalness,
          emissive: new Color(def.emissive),
          emissiveIntensity: def.emissiveIntensity * EMISSIVE_INTENSITY_SCALE,
        });

  const configureTexture: ForgeTextureConfigurer = (texture, config) =>
    configureForgeTexture(texture, { ...config, flipY: def.flipY });

  if (textures.baseColorTexture) {
    material.map = configureTexture(textures.baseColorTexture, {
      srgb: true,
      repeat: def.uvTiling,
      maxAnisotropy: options.maxAnisotropy,
    });
  }
  if (textures.opacityTexture) {
    material.alphaMap = configureTexture(textures.opacityTexture, {
      srgb: false,
      repeat: def.uvTiling,
      maxAnisotropy: options.maxAnisotropy,
    });
    material.transparent = true;
  }
  if (textures.normalTexture && material instanceof MeshStandardMaterial) {
    material.normalMap = configureTexture(textures.normalTexture, {
      srgb: false,
      repeat: def.uvTiling,
      maxAnisotropy: options.maxAnisotropy,
    });
  }
  if (material instanceof MeshStandardMaterial) {
    const ormMap = textures.ormTexture
      ? configureTexture(textures.ormTexture, {
          srgb: false,
          repeat: def.uvTiling,
          maxAnisotropy: options.maxAnisotropy,
        })
      : null;
    if (ormMap) {
      material.roughnessMap = ormMap;
      material.metalnessMap = ormMap;
      material.aoMap = ormMap;
      material.aoMapIntensity = def.aoIntensity;
    } else {
      if (textures.roughnessTexture) {
        material.roughnessMap = configureTexture(textures.roughnessTexture, {
          srgb: false,
          repeat: def.uvTiling,
          maxAnisotropy: options.maxAnisotropy,
        });
      }
      if (textures.metalnessTexture) {
        material.metalnessMap = configureTexture(textures.metalnessTexture, {
          srgb: false,
          repeat: def.uvTiling,
          maxAnisotropy: options.maxAnisotropy,
        });
      }
      if (textures.aoTexture) {
        material.aoMap = configureTexture(textures.aoTexture, {
          srgb: false,
          repeat: def.uvTiling,
          maxAnisotropy: options.maxAnisotropy,
        });
        material.aoMapIntensity = def.aoIntensity;
      }
    }
    if (textures.emissiveTexture) {
      material.emissiveMap = configureTexture(textures.emissiveTexture, {
        srgb: true,
        repeat: def.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      });
    }
    if (def.layerBlend) {
      applyLayerBlendMaterial(material, def.layerBlend, textures, options, configureTexture);
    }
    if (def.normalMotion && textures.normalTexture) {
      applyNormalMotionMaterial(material, def.normalMotion);
    }
  }

  material.needsUpdate = true;
  return material;
}

function applyNormalMotionMaterial(
  material: MeshStandardMaterial,
  motion: ForgeMaterialNormalMotion,
): void {
  const state: NormalMotionState = {
    time: { value: 0 },
    primaryVelocity: { value: new Vector2(motion.primaryVelocity.x, motion.primaryVelocity.y) },
    secondaryTiling: { value: new Vector2(motion.secondaryTiling.x, motion.secondaryTiling.y) },
    secondaryVelocity: { value: new Vector2(motion.secondaryVelocity.x, motion.secondaryVelocity.y) },
    strength: { value: motion.strength },
  };
  normalMotionStates.set(material, state);
  material.addEventListener("dispose", () => normalMotionStates.delete(material));

  const priorPatch = material.onBeforeCompile;
  const priorCacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    priorPatch?.(shader, renderer);
    patchNormalMotionShader(shader, state);
  };
  material.customProgramCacheKey = () =>
    `${priorCacheKey ? `${priorCacheKey.call(material)}|` : ""}forge-normal-motion-v1`;
  material.needsUpdate = true;
}

function patchNormalMotionShader(shader: ShaderPatch, state: NormalMotionState): void {
  const normalChunk = "#include <normal_fragment_maps>";
  if (!shader.fragmentShader.includes(normalChunk)) return;
  shader.uniforms.forgeNormalMotionTime = state.time;
  shader.uniforms.forgeNormalMotionPrimaryVelocity = state.primaryVelocity;
  shader.uniforms.forgeNormalMotionSecondaryTiling = state.secondaryTiling;
  shader.uniforms.forgeNormalMotionSecondaryVelocity = state.secondaryVelocity;
  shader.uniforms.forgeNormalMotionStrength = state.strength;
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <normal_pars_fragment>",
    `uniform float forgeNormalMotionTime;
uniform vec2 forgeNormalMotionPrimaryVelocity;
uniform vec2 forgeNormalMotionSecondaryTiling;
uniform vec2 forgeNormalMotionSecondaryVelocity;
uniform float forgeNormalMotionStrength;
#include <normal_pars_fragment>`,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    normalChunk,
    `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 forgeNormalA = texture2D(
    normalMap,
    vNormalMapUv + forgeNormalMotionPrimaryVelocity * forgeNormalMotionTime
  ).xyz * 2.0 - 1.0;
  vec3 forgeNormalB = texture2D(
    normalMap,
    vNormalMapUv * forgeNormalMotionSecondaryTiling + forgeNormalMotionSecondaryVelocity * forgeNormalMotionTime
  ).xyz * 2.0 - 1.0;
  #ifdef USE_PACKED_NORMALMAP
    forgeNormalA = vec3(forgeNormalA.xy, sqrt(saturate(1.0 - dot(forgeNormalA.xy, forgeNormalA.xy))));
    forgeNormalB = vec3(forgeNormalB.xy, sqrt(saturate(1.0 - dot(forgeNormalB.xy, forgeNormalB.xy))));
  #endif
  vec3 mapN = normalize(mix(forgeNormalA, forgeNormalB, 0.5));
  mapN.xy *= normalScale * forgeNormalMotionStrength;
  normal = normalize(tbn * normalize(mapN));
#else
  #include <normal_fragment_maps>
#endif`,
  );
}

function applyLayerBlendMaterial(
  material: MeshStandardMaterial,
  blend: ForgeMaterialLayerBlend,
  textures: ForgeMaterialTextureMaps,
  options: ForgeMaterialOptions,
  configureTexture: ForgeTextureConfigurer,
): void {
  const layer1 = blend.layer1;
  const layer1Map = textures.layer1BaseColorTexture
    ? configureTexture(textures.layer1BaseColorTexture, {
        srgb: true,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1NormalMap = textures.normalTexture && textures.layer1NormalTexture
    ? configureTexture(textures.layer1NormalTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1RoughnessMap = textures.layer1RoughnessTexture
    ? configureTexture(textures.layer1RoughnessTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1MetalnessMap = textures.layer1MetalnessTexture
    ? configureTexture(textures.layer1MetalnessTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1OpacityMap = textures.layer1OpacityTexture
    ? configureTexture(textures.layer1OpacityTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1EmissiveMap = textures.layer1EmissiveTexture
    ? configureTexture(textures.layer1EmissiveTexture, {
        srgb: true,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layer1AoMap = textures.layer1AoTexture
    ? configureTexture(textures.layer1AoTexture, {
        srgb: false,
        repeat: layer1.uvTiling,
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;
  const layerBlendMaskMap = textures.layerBlendMaskTexture
    ? configureTexture(textures.layerBlendMaskTexture, {
        srgb: false,
        // The blend mask selects between layers across the whole surface, so it maps
        // 1:1 to the base UV — it must NOT inherit layer 1's detail tiling (which would
        // repeat the artist mask) and is sampled at raw `vUv` in the shader.
        repeat: { x: 1, y: 1 },
        maxAnisotropy: options.maxAnisotropy,
      })
    : null;

  material.defines = {
    ...(material.defines ?? {}),
    USE_UV: "",
    FORGE_LAYER_BLEND: "",
    ...(layer1Map ? { USE_FORGE_LAYER_MAP: "" } : {}),
    ...(layer1NormalMap ? { USE_FORGE_LAYER_NORMALMAP: "" } : {}),
    ...(layer1RoughnessMap ? { USE_FORGE_LAYER_ROUGHNESSMAP: "" } : {}),
    ...(layer1MetalnessMap ? { USE_FORGE_LAYER_METALNESSMAP: "" } : {}),
    ...(layer1OpacityMap ? { USE_FORGE_LAYER_OPACITYMAP: "" } : {}),
    ...(layer1EmissiveMap ? { USE_FORGE_LAYER_EMISSIVEMAP: "" } : {}),
    ...(layer1AoMap ? { USE_FORGE_LAYER_AOMAP: "" } : {}),
    ...(layerBlendMaskMap ? { USE_FORGE_LAYER_MASKMAP: "" } : {}),
  };
  if (layer1.opacity < 1 || layer1OpacityMap) {
    material.transparent = true;
  }
  // This enables Three.js' `vColor` varying for the vertex-color blend driver.
  // Mesh Paint writes a four-component `color` attribute, so alpha is available
  // when it is selected. Geometries without an RGBA color attribute safely use
  // zero for the alpha channel in the shader below.
  if (blend.driver === "vertexColor") material.vertexColors = true;
  material.onBeforeCompile = (shader) => {
    patchLayerBlendShader(shader, blend, {
      layer1Map,
      layer1NormalMap,
      layer1RoughnessMap,
      layer1MetalnessMap,
      layer1OpacityMap,
      layer1EmissiveMap,
      layer1AoMap,
      layerBlendMaskMap,
    });
  };
  material.customProgramCacheKey = () =>
    [
      "forge-layer-blend-v1",
      blend.driver,
      layer1Map ? "bc" : "color",
      layer1NormalMap ? "n" : "no-n",
      layer1RoughnessMap ? "r" : "rough",
      layer1MetalnessMap ? "m" : "metal",
      layer1OpacityMap ? "o" : "opacity",
      layer1EmissiveMap ? "e" : "emissive",
      layer1AoMap ? "ao" : "no-ao",
      layerBlendMaskMap ? "mask" : "no-mask",
    ].join(":");
}

function patchLayerBlendShader(
  shader: ShaderPatch,
  blend: ForgeMaterialLayerBlend,
  maps: {
    layer1Map: Texture | null;
    layer1NormalMap: Texture | null;
    layer1RoughnessMap: Texture | null;
    layer1MetalnessMap: Texture | null;
    layer1OpacityMap: Texture | null;
    layer1EmissiveMap: Texture | null;
    layer1AoMap: Texture | null;
    layerBlendMaskMap: Texture | null;
  },
): void {
  // Three.js enables `vColor` through material.vertexColors, then its stock
  // <color_fragment> multiplies diffuseColor by that value. Mesh Paint needs
  // the varying as a mask only: applying that stock tint made a red R-channel
  // stroke visibly red even after Color View was turned off.
  const colorFragment = blend.driver === "vertexColor"
    ? "// forge-layer-blend: vColor is sampled as a mask; do not tint the base material."
    : "#include <color_fragment>";
  shader.uniforms.forgeLayerColor = { value: new Color(blend.layer1.baseColor) };
  shader.uniforms.forgeLayerRoughness = { value: blend.layer1.roughness };
  shader.uniforms.forgeLayerMetalness = { value: blend.layer1.metalness };
  shader.uniforms.forgeLayerOpacity = { value: blend.layer1.opacity };
  shader.uniforms.forgeLayerAoIntensity = { value: blend.layer1.aoIntensity };
  shader.uniforms.forgeLayerEmissive = {
    value: new Color(blend.layer1.emissive).multiplyScalar(
      blend.layer1.emissiveIntensity * EMISSIVE_INTENSITY_SCALE,
    ),
  };
  shader.uniforms.forgeLayerTiling = {
    value: new Vector2(blend.layer1.uvTiling.x, blend.layer1.uvTiling.y),
  };
  shader.uniforms.forgeLayerAmount = { value: blend.amount };
  shader.uniforms.forgeLayerMin = { value: blend.min };
  shader.uniforms.forgeLayerMax = { value: blend.max };
  shader.uniforms.forgeLayerContrast = { value: blend.contrast };
  shader.uniforms.forgeLayerDriver = { value: layerBlendDriverIndex(blend.driver) };
  shader.uniforms.forgeLayerVertexColorChannel = {
    value: vertexColorChannelIndex(blend.vertexColorChannel),
  };
  shader.uniforms.forgeLayerInvertVertexColor = { value: blend.invertVertexColor ? 1 : 0 };
  if (maps.layer1Map) shader.uniforms.forgeLayerMap = { value: maps.layer1Map };
  if (maps.layer1NormalMap) {
    shader.uniforms.forgeLayerNormalMap = { value: maps.layer1NormalMap };
  }
  if (maps.layer1RoughnessMap) {
    shader.uniforms.forgeLayerRoughnessMap = { value: maps.layer1RoughnessMap };
  }
  if (maps.layer1MetalnessMap) {
    shader.uniforms.forgeLayerMetalnessMap = { value: maps.layer1MetalnessMap };
  }
  if (maps.layer1OpacityMap) {
    shader.uniforms.forgeLayerOpacityMap = { value: maps.layer1OpacityMap };
  }
  if (maps.layer1EmissiveMap) {
    shader.uniforms.forgeLayerEmissiveMap = { value: maps.layer1EmissiveMap };
  }
  if (maps.layer1AoMap) {
    shader.uniforms.forgeLayerAoMap = { value: maps.layer1AoMap };
  }
  if (maps.layerBlendMaskMap) {
    shader.uniforms.forgeLayerMaskMap = { value: maps.layerBlendMaskMap };
  }

  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
varying vec3 vForgeLayerWorldPosition;
varying vec3 vForgeLayerWorldNormal;`,
    )
    .replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vec4 forgeLayerWorldPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  forgeLayerWorldPosition = instanceMatrix * forgeLayerWorldPosition;
#endif
forgeLayerWorldPosition = modelMatrix * forgeLayerWorldPosition;
vForgeLayerWorldPosition = forgeLayerWorldPosition.xyz;
vec3 forgeLayerWorldNormal = objectNormal;
#ifdef USE_INSTANCING
  forgeLayerWorldNormal = mat3( instanceMatrix ) * forgeLayerWorldNormal;
#endif
vForgeLayerWorldNormal = normalize( mat3( modelMatrix ) * forgeLayerWorldNormal );`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
uniform vec3 forgeLayerColor;
uniform float forgeLayerRoughness;
uniform float forgeLayerMetalness;
uniform float forgeLayerOpacity;
uniform float forgeLayerAoIntensity;
uniform vec3 forgeLayerEmissive;
uniform vec2 forgeLayerTiling;
uniform float forgeLayerAmount;
uniform float forgeLayerMin;
uniform float forgeLayerMax;
uniform float forgeLayerContrast;
uniform int forgeLayerDriver;
uniform int forgeLayerVertexColorChannel;
uniform float forgeLayerInvertVertexColor;
varying vec3 vForgeLayerWorldPosition;
varying vec3 vForgeLayerWorldNormal;
#ifdef USE_FORGE_LAYER_MAP
  uniform sampler2D forgeLayerMap;
#endif
#ifdef USE_FORGE_LAYER_NORMALMAP
  uniform sampler2D forgeLayerNormalMap;
#endif
#ifdef USE_FORGE_LAYER_ROUGHNESSMAP
  uniform sampler2D forgeLayerRoughnessMap;
#endif
#ifdef USE_FORGE_LAYER_METALNESSMAP
  uniform sampler2D forgeLayerMetalnessMap;
#endif
#ifdef USE_FORGE_LAYER_OPACITYMAP
  uniform sampler2D forgeLayerOpacityMap;
#endif
#ifdef USE_FORGE_LAYER_EMISSIVEMAP
  uniform sampler2D forgeLayerEmissiveMap;
#endif
#ifdef USE_FORGE_LAYER_AOMAP
  uniform sampler2D forgeLayerAoMap;
#endif
#ifdef USE_FORGE_LAYER_MASKMAP
  uniform sampler2D forgeLayerMaskMap;
#endif
// The mask sample is passed in (not read here): this function is injected into
// <common>, which precedes <uv_pars_fragment>, so \`vUv\` is NOT yet declared at this
// point. Sampling the mask here compiled to "vUv undeclared" and blanked the material.
float forgeLayerBlendFactor( float forgeLayerMaskSample, float forgeLayerVertexColorSample ) {
  float value = forgeLayerAmount;
  if (forgeLayerDriver == 1) {
    value = smoothstep(forgeLayerMin, forgeLayerMax, clamp(dot(normalize(vForgeLayerWorldNormal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0));
  } else if (forgeLayerDriver == 2) {
    value = smoothstep(forgeLayerMin, forgeLayerMax, vForgeLayerWorldPosition.y);
  } else if (forgeLayerDriver == 3) {
    value = forgeLayerMaskSample;
  } else if (forgeLayerDriver == 4) {
    value = forgeLayerVertexColorSample;
  }
  return clamp(pow(clamp(value, 0.0, 1.0), forgeLayerContrast), 0.0, 1.0);
}`,
    )
    .replace("#include <color_fragment>", colorFragment)
    .replace(
      "#include <map_fragment>",
      `#include <map_fragment>
// vUv is in scope here (after <uv_pars_fragment>), so sample the mask now and feed it
// to the blend factor declared in <common>.
float forgeLayerMaskSample = 0.0;
#ifdef USE_FORGE_LAYER_MASKMAP
  forgeLayerMaskSample = texture2D( forgeLayerMaskMap, vUv ).r;
#endif
// \`vColor\` is declared by Three.js after <common>. Sampling it here (rather
// than in forgeLayerBlendFactor) keeps the shader valid for every material.
// Three.js only defines USE_COLOR_ALPHA for a four-component color attribute;
// treating alpha as zero otherwise preserves layer 0 for unpainted meshes.
float forgeLayerVertexColorSample = 0.0;
if (forgeLayerDriver == 4) {
#if defined( USE_COLOR_ALPHA )
  if (forgeLayerVertexColorChannel == 0) forgeLayerVertexColorSample = vColor.r;
  else if (forgeLayerVertexColorChannel == 1) forgeLayerVertexColorSample = vColor.g;
  else if (forgeLayerVertexColorChannel == 2) forgeLayerVertexColorSample = vColor.b;
  else forgeLayerVertexColorSample = vColor.a;
#elif defined( USE_COLOR )
  if (forgeLayerVertexColorChannel == 0) forgeLayerVertexColorSample = vColor.r;
  else if (forgeLayerVertexColorChannel == 1) forgeLayerVertexColorSample = vColor.g;
  else if (forgeLayerVertexColorChannel == 2) forgeLayerVertexColorSample = vColor.b;
#endif
  if (forgeLayerInvertVertexColor > 0.5) forgeLayerVertexColorSample = 1.0 - forgeLayerVertexColorSample;
}
float forgeLayerBlend = forgeLayerBlendFactor( forgeLayerMaskSample, forgeLayerVertexColorSample );
vec3 forgeLayerDiffuse = forgeLayerColor;
#ifdef USE_FORGE_LAYER_MAP
  vec4 forgeLayerSample = texture2D( forgeLayerMap, vUv * forgeLayerTiling );
  forgeLayerDiffuse *= forgeLayerSample.rgb;
#endif
diffuseColor.rgb = mix( diffuseColor.rgb, forgeLayerDiffuse, forgeLayerBlend );`,
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
float forgeLayerRoughnessFactor = forgeLayerRoughness;
#ifdef USE_FORGE_LAYER_ROUGHNESSMAP
  forgeLayerRoughnessFactor *= texture2D( forgeLayerRoughnessMap, vUv * forgeLayerTiling ).g;
#endif
roughnessFactor = mix( roughnessFactor, forgeLayerRoughnessFactor, forgeLayerBlend );`,
    )
    .replace(
      "#include <metalnessmap_fragment>",
      `#include <metalnessmap_fragment>
float forgeLayerMetalnessFactor = forgeLayerMetalness;
#ifdef USE_FORGE_LAYER_METALNESSMAP
  forgeLayerMetalnessFactor *= texture2D( forgeLayerMetalnessMap, vUv * forgeLayerTiling ).b;
#endif
metalnessFactor = mix( metalnessFactor, forgeLayerMetalnessFactor, forgeLayerBlend );`,
    )
    .replace(
      "#include <alphamap_fragment>",
      `#include <alphamap_fragment>
float forgeLayerOpacityFactor = forgeLayerOpacity;
#ifdef USE_FORGE_LAYER_OPACITYMAP
  forgeLayerOpacityFactor *= texture2D( forgeLayerOpacityMap, vUv * forgeLayerTiling ).g;
#endif
diffuseColor.a = mix( diffuseColor.a, forgeLayerOpacityFactor, forgeLayerBlend );`,
    )
    .replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
vec3 forgeLayerEmissiveRadiance = forgeLayerEmissive;
#ifdef USE_FORGE_LAYER_EMISSIVEMAP
  forgeLayerEmissiveRadiance *= texture2D( forgeLayerEmissiveMap, vUv * forgeLayerTiling ).rgb;
#endif
totalEmissiveRadiance = mix( totalEmissiveRadiance, forgeLayerEmissiveRadiance, forgeLayerBlend );`,
    )
    .replace(
      "#include <aomap_fragment>",
      `float forgeBaseAmbientOcclusion = 1.0;
#ifdef USE_AOMAP
  forgeBaseAmbientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
#endif
float forgeLayerAmbientOcclusion = 1.0;
#ifdef USE_FORGE_LAYER_AOMAP
  forgeLayerAmbientOcclusion = ( texture2D( forgeLayerAoMap, vUv * forgeLayerTiling ).r - 1.0 ) * forgeLayerAoIntensity + 1.0;
#endif
float ambientOcclusion = mix( forgeBaseAmbientOcclusion, forgeLayerAmbientOcclusion, forgeLayerBlend );
reflectedLight.indirectDiffuse *= ambientOcclusion;
#if defined( USE_CLEARCOAT )
  clearcoatSpecularIndirect *= ambientOcclusion;
#endif
#if defined( USE_SHEEN )
  sheenSpecularIndirect *= ambientOcclusion;
#endif
#if defined( USE_ENVMAP ) && defined( STANDARD )
  float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
  reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
#endif`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
#if defined( USE_NORMALMAP_TANGENTSPACE ) && defined( USE_FORGE_LAYER_NORMALMAP )
  vec3 forgeLayerN = texture2D( forgeLayerNormalMap, vUv * forgeLayerTiling ).xyz * 2.0 - 1.0;
  forgeLayerN.xy *= normalScale;
  normal = normalize( mix( normal, normalize( tbn * forgeLayerN ), forgeLayerBlend ) );
#endif`,
    );
}

function layerBlendDriverIndex(driver: ForgeMaterialLayerBlend["driver"]): number {
  if (driver === "slope") return 1;
  if (driver === "worldHeight") return 2;
  if (driver === "maskTexture") return 3;
  if (driver === "vertexColor") return 4;
  return 0;
}

function vertexColorChannelIndex(channel: ForgeMaterialLayerBlend["vertexColorChannel"]): number {
  if (channel === "g") return 1;
  if (channel === "b") return 2;
  if (channel === "a") return 3;
  return 0;
}

export function collectMaterialStats(models: Map<string, GLTF>): MaterialStats {
  const seen = new Set<Material>();
  for (const gltf of models.values()) {
    gltf.scene.traverse((object) => {
      if (!isRenderableMesh(object)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) seen.add(material);
    });
  }

  let basic = 0;
  let lit = 0;
  for (const material of seen) {
    if (material.type === "MeshBasicMaterial") basic += 1;
    else lit += 1;
  }

  return { basic, lit, total: seen.size };
}

export function convertUnlitModelMaterialsToLit(models: Map<string, GLTF>): number {
  const converted = new Map<Material, Material>();

  const resolveMaterial = (material: Material): Material => {
    if (!(material instanceof MeshBasicMaterial)) return material;
    const cached = converted.get(material);
    if (cached) return cached;

    const lit = new MeshStandardMaterial({
      name: material.name,
      color: material.color.clone(),
      map: material.map,
      alphaMap: material.alphaMap,
      transparent: material.transparent,
      opacity: material.opacity,
      alphaTest: material.alphaTest,
      side: material.side,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite,
      wireframe: material.wireframe,
    });
    lit.vertexColors = material.vertexColors;
    lit.toneMapped = material.toneMapped;
    lit.needsUpdate = true;
    converted.set(material, lit);
    return lit;
  };

  for (const gltf of models.values()) {
    gltf.scene.traverse((object) => {
      if (!isRenderableMesh(object)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map(resolveMaterial)
        : resolveMaterial(object.material);
    });
  }

  return converted.size;
}

function materialSide(side: ForgeMaterialSide): typeof FrontSide | typeof BackSide | typeof DoubleSide {
  if (side === "back") return BackSide;
  if (side === "double") return DoubleSide;
  return FrontSide;
}
