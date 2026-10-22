import {
  Color,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  type DataArrayTexture,
  type DataTexture,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";

/**
 * Spike of `engine/render-three/terrain/terrainMaterial.ts` (S2): GPU height
 * displacement + CDLOD morph injected into a MeshStandardMaterial with
 * `onBeforeCompile`, keeping full PBR lighting, fog and shadow receiving.
 *
 * The splat block is the one from `engine/render-three/landscape.ts`
 * (`createLandscapeSplatMaterial`): four `sampler2D` layers with a flat-colour
 * fallback, weight-blended into `diffuseColor` at `<color_fragment>`. What
 * changes: weights come from the slot/global weight textures instead of a
 * vertex attribute, UVs are world-space metres (tile-local + tile origin, so
 * float32 never sees 4 km magnitudes), a second, larger sample scale is mixed
 * in with distance to break tiling, and the normal is rebuilt per pixel from
 * the height texture.
 *
 * The same vertex injection drives a MeshDepthMaterial used as the mesh's
 * `customDepthMaterial`, so the terrain casts self-shadow from the displaced
 * surface. LOD morph distances read `uTerrainLodCamera` (the view camera), not
 * the built-in `cameraPosition`, so the shadow pass draws the same geometry.
 */

export interface TerrainLayerInput {
  texture: Texture | null;
  color: string;
  /** Metres per texture repeat. */
  repeatMetres: number;
}

export interface TerrainUniforms {
  [name: string]: { value: unknown };
}

export interface TerrainMaterialInputs {
  heightArray: DataArrayTexture;
  weightArray: DataArrayTexture;
  globalHeight: DataTexture;
  globalWeight: DataTexture;
  origin: Vector3;
  /** World metres per texel: tile, global. */
  texel: Vector2;
  /** Texels per side: tile, global. */
  texels: Vector2;
  /** World edge: tile, whole terrain. */
  extent: Vector2;
  /** Height min, height range (max − min). */
  heightRange: Vector2;
  morph: Array<[number, number]>;
  patchQuads: number;
  /** Weight array layers per slot (1 or 2); the splat reads block 0. */
  weightBlocks: number;
  layers: TerrainLayerInput[];
}

export interface TerrainMaterials {
  material: MeshStandardMaterial;
  depthMaterial: MeshDepthMaterial;
  uniforms: TerrainUniforms;
}

const SHARED_PARS = /* glsl */ `
uniform highp sampler2DArray uTerrainHeightArray;
uniform highp sampler2D uTerrainGlobalHeight;
uniform vec3 uTerrainOrigin;
uniform vec2 uTerrainTexel;
uniform vec2 uTerrainTexels;
uniform vec2 uTerrainExtent;
uniform vec2 uTerrainHeightRange;

// local: tile-local metres when slot >= 0, terrain-local metres otherwise.
float forgeTerrainHeight(vec2 local, float slot) {
  float v;
  if (slot >= 0.0) {
    vec2 uv = (local / uTerrainTexel.x + 0.5) / uTerrainTexels.x;
    v = textureLod(uTerrainHeightArray, vec3(uv, slot), 0.0).r;
  } else {
    vec2 uv = (local / uTerrainTexel.y + 0.5) / uTerrainTexels.y;
    v = textureLod(uTerrainGlobalHeight, uv, 0.0).r;
  }
  return uTerrainHeightRange.x + v * uTerrainHeightRange.y;
}
`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 terrainNodeA; // local origin x/z, node size, LOD level
attribute vec4 terrainNodeB; // slot (-1 = global map), tile origin x/z (terrain-local)
uniform vec3 uTerrainLodCamera;
uniform vec2 uTerrainMorph[TERRAIN_LOD_LEVELS];
uniform float uTerrainPatchQuads;
varying vec2 vTerrainLocal;
varying vec2 vTerrainBase;
varying vec3 vTerrainInfo; // slot, level, morph
`;

const VERTEX_BEGIN = /* glsl */ `
vec2 forgeGrid = position.xz;
float forgeSize = terrainNodeA.z;
float forgeSlot = terrainNodeB.x;
vec2 forgeBase = terrainNodeB.yz;
vec2 forgeLocal = terrainNodeA.xy + forgeGrid * forgeSize;
float forgeH0 = forgeTerrainHeight(forgeLocal, forgeSlot);
vec3 forgeWorld0 = uTerrainOrigin + vec3(forgeBase.x + forgeLocal.x, forgeH0, forgeBase.y + forgeLocal.y);
vec2 forgeMorphRange = uTerrainMorph[int(terrainNodeA.w + 0.5)];
float forgeMorph = clamp(
  (distance(forgeWorld0, uTerrainLodCamera) - forgeMorphRange.x) / (forgeMorphRange.y - forgeMorphRange.x),
  0.0, 1.0);
// Odd grid vertices slide onto the even (parent) grid as forgeMorph -> 1.
vec2 forgeFrac = fract(forgeGrid * uTerrainPatchQuads * 0.5) * 2.0 / uTerrainPatchQuads;
forgeLocal -= forgeFrac * forgeSize * forgeMorph;
float forgeH = forgeTerrainHeight(forgeLocal, forgeSlot);
vec3 transformed = uTerrainOrigin + vec3(forgeBase.x + forgeLocal.x, forgeH, forgeBase.y + forgeLocal.y);
vTerrainLocal = forgeLocal;
vTerrainBase = forgeBase;
vTerrainInfo = vec3(forgeSlot, terrainNodeA.w, forgeMorph);
`;

const FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray uTerrainWeightArray;
uniform sampler2D uTerrainGlobalWeight;
uniform float uTerrainWeightBlocks;
uniform float uTerrainDebug;
uniform sampler2D uLayerTex0;
uniform sampler2D uLayerTex1;
uniform sampler2D uLayerTex2;
uniform sampler2D uLayerTex3;
uniform vec3 uLayerColor0;
uniform vec3 uLayerColor1;
uniform vec3 uLayerColor2;
uniform vec3 uLayerColor3;
uniform float uLayerHasTex0;
uniform float uLayerHasTex1;
uniform float uLayerHasTex2;
uniform float uLayerHasTex3;
uniform float uLayerScale0;
uniform float uLayerScale1;
uniform float uLayerScale2;
uniform float uLayerScale3;
varying vec2 vTerrainLocal;
varying vec2 vTerrainBase;
varying vec3 vTerrainInfo;

vec4 forgeTerrainWeights(vec2 local, float slot) {
  vec4 w;
  if (slot >= 0.0) {
    vec2 uv = (local / uTerrainTexel.x + 0.5) / uTerrainTexels.x;
    w = textureLod(uTerrainWeightArray, vec3(uv, slot * uTerrainWeightBlocks), 0.0);
  } else {
    vec2 uv = (local / uTerrainTexel.y + 0.5) / uTerrainTexels.y;
    w = textureLod(uTerrainGlobalWeight, uv, 0.0);
  }
  return w;
}

// Per-pixel normal from the height texture. Clamped one-sided differences at
// the texture edge keep the right scale; tile seams still switch from central
// to one-sided differences (a faint lighting seam, recorded in the plan).
vec3 forgeTerrainNormal(vec2 local, float slot) {
  float t = slot >= 0.0 ? uTerrainTexel.x : uTerrainTexel.y;
  float edge = slot >= 0.0 ? uTerrainExtent.x : uTerrainExtent.y;
  vec2 lo = clamp(local - t, vec2(0.0), vec2(edge));
  vec2 hi = clamp(local + t, vec2(0.0), vec2(edge));
  float hl = forgeTerrainHeight(vec2(lo.x, local.y), slot);
  float hr = forgeTerrainHeight(vec2(hi.x, local.y), slot);
  float hd = forgeTerrainHeight(vec2(local.x, lo.y), slot);
  float hu = forgeTerrainHeight(vec2(local.x, hi.y), slot);
  return normalize(vec3((hl - hr) / max(hi.x - lo.x, 1e-4), 1.0, (hd - hu) / max(hi.y - lo.y, 1e-4)));
}

vec3 forgeLayer(sampler2D tex, float hasTex, vec3 color, vec2 uv, float far) {
  if (hasTex < 0.5) return color;
  vec3 near = texture(tex, uv).rgb;
  vec3 wide = texture(tex, uv * 0.173).rgb;
  return mix(near, (near + wide) * 0.5, far);
}

vec3 forgeLodColor(float level) {
  int l = int(level + 0.5);
  if (l == 0) return vec3(0.95, 0.25, 0.25);
  if (l == 1) return vec3(0.95, 0.6, 0.2);
  if (l == 2) return vec3(0.95, 0.9, 0.25);
  if (l == 3) return vec3(0.35, 0.85, 0.3);
  if (l == 4) return vec3(0.25, 0.8, 0.85);
  if (l == 5) return vec3(0.3, 0.45, 0.95);
  if (l == 6) return vec3(0.65, 0.35, 0.95);
  return vec3(0.9, 0.9, 0.9);
}
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  float forgeSlot = floor(vTerrainInfo.x + 0.5);
  vec4 forgeW = forgeTerrainWeights(vTerrainLocal, forgeSlot);
  vec2 forgeUv = vTerrainBase + vTerrainLocal;
  float forgeFar = smoothstep(40.0, 220.0, length(vViewPosition));
  vec3 forgeC0 = forgeLayer(uLayerTex0, uLayerHasTex0, uLayerColor0, forgeUv * uLayerScale0, forgeFar);
  vec3 forgeC1 = forgeLayer(uLayerTex1, uLayerHasTex1, uLayerColor1, forgeUv * uLayerScale1, forgeFar);
  vec3 forgeC2 = forgeLayer(uLayerTex2, uLayerHasTex2, uLayerColor2, forgeUv * uLayerScale2, forgeFar);
  vec3 forgeC3 = forgeLayer(uLayerTex3, uLayerHasTex3, uLayerColor3, forgeUv * uLayerScale3, forgeFar);
  vec3 forgeAlbedo = forgeC0 * forgeW.x + forgeC1 * forgeW.y + forgeC2 * forgeW.z + forgeC3 * forgeW.w;
  float forgeWeight = forgeW.x + forgeW.y + forgeW.z + forgeW.w;
  diffuseColor.rgb = forgeWeight > 0.0001 ? forgeAlbedo / forgeWeight : uLayerColor0;
  if (uTerrainDebug > 0.5 && uTerrainDebug < 1.5) {
    diffuseColor.rgb = forgeLodColor(vTerrainInfo.y) * (1.0 - 0.55 * vTerrainInfo.z);
  } else if (uTerrainDebug > 1.5) {
    diffuseColor.rgb = forgeSlot >= 0.0 ? vec3(0.3, 0.8, 0.35) : vec3(0.3, 0.45, 0.95);
  }
}
`;

const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_begin>
{
  vec3 forgeN = forgeTerrainNormal(vTerrainLocal, floor(vTerrainInfo.x + 0.5));
  normal = normalize((viewMatrix * vec4(forgeN, 0.0)).xyz);
  nonPerturbedNormal = normal;
}
`;

function injectVertex(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${SHARED_PARS}\n${VERTEX_PARS}`)
    .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
    .replace("#include <begin_vertex>", VERTEX_BEGIN);
}

export function createTerrainMaterials(inputs: TerrainMaterialInputs): TerrainMaterials {
  const layer = (index: number): TerrainLayerInput =>
    inputs.layers[index] ?? { texture: null, color: "#808080", repeatMetres: 8 };
  const uniforms: TerrainUniforms = {
    uTerrainHeightArray: { value: inputs.heightArray },
    uTerrainWeightArray: { value: inputs.weightArray },
    uTerrainGlobalHeight: { value: inputs.globalHeight },
    uTerrainGlobalWeight: { value: inputs.globalWeight },
    uTerrainOrigin: { value: inputs.origin },
    uTerrainTexel: { value: inputs.texel },
    uTerrainTexels: { value: inputs.texels },
    uTerrainExtent: { value: inputs.extent },
    uTerrainHeightRange: { value: inputs.heightRange },
    uTerrainLodCamera: { value: new Vector3() },
    uTerrainMorph: { value: inputs.morph.map(([start, end]) => new Vector2(start, end)) },
    uTerrainPatchQuads: { value: inputs.patchQuads },
    uTerrainDebug: { value: 0 },
    uTerrainWeightBlocks: { value: inputs.weightBlocks },
  };
  for (let index = 0; index < 4; index += 1) {
    const entry = layer(index);
    uniforms[`uLayerTex${index}`] = { value: entry.texture };
    uniforms[`uLayerHasTex${index}`] = { value: entry.texture ? 1 : 0 };
    uniforms[`uLayerColor${index}`] = { value: new Color(entry.color) };
    uniforms[`uLayerScale${index}`] = { value: 1 / Math.max(0.01, entry.repeatMetres) };
  }
  const defines = { TERRAIN_LOD_LEVELS: String(inputs.morph.length) };

  const material = new MeshStandardMaterial({ color: new Color("#ffffff"), roughness: 0.95, metalness: 0 });
  material.defines = { ...(material.defines ?? {}), ...defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SHARED_PARS}\n${FRAGMENT_PARS}`)
      .replace("#include <color_fragment>", FRAGMENT_COLOR)
      .replace("#include <normal_fragment_begin>", FRAGMENT_NORMAL);
  };
  material.customProgramCacheKey = () => "forge-spike-terrain";

  const depthMaterial = new MeshDepthMaterial();
  depthMaterial.defines = { ...(depthMaterial.defines ?? {}), ...defines };
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectVertex(shader);
  };
  depthMaterial.customProgramCacheKey = () => "forge-spike-terrain-depth";

  return { material, depthMaterial, uniforms };
}
