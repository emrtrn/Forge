import {
  Color,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  Vector4,
  type DataArrayTexture,
  type DataTexture,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";

/**
 * World Terrain surface material (OPEN_WORLD_PLAN K2, Faz 2): a
 * `MeshStandardMaterial` whose vertex stage displaces a shared flat patch by
 * the resident tile heights (or the global map for coarse nodes) with CDLOD
 * morphing, so the terrain keeps full PBR lighting, fog and shadow receiving.
 *
 * Per-instance node data comes from a float texture indexed by
 * `gl_InstanceID`, not from instanced attributes: the renderer selects nodes in
 * `onBeforeRender` for whichever camera is drawing, and three uploads textures
 * after that hook but attributes before it.
 *
 * Heights are fetched with `texelFetch` and interpolated by hand, so the R32F
 * textures need no float-linear filtering. Vertices sit on whole texels, where
 * the interpolation is exact — the drawn surface is the collider's surface.
 *
 * The fragment stage keeps the legacy Landscape looks: the four-texture splat
 * (UV = terrain-local position / extent × tiling, as the chunk renderer did),
 * the weighted layer-colour blend, and the editor's height/slope/layer views;
 * normals are rebuilt per pixel from the height texture.
 */

export type TerrainShaderViewMode = "lit" | "height" | "slope" | "layer";

const VIEW_MODE_DEFINE: Record<TerrainShaderViewMode, string> = { lit: "0", height: "1", slope: "2", layer: "3" };

/** Layer colours the shader can blend (two RGBA8 weight blocks). */
export const TERRAIN_SHADER_LAYERS = 8;
/** Layers that can carry a base-colour texture in the splat. */
export const TERRAIN_SHADER_TEXTURED_LAYERS = 4;

export interface TerrainMaterialInputs {
  heights: DataArrayTexture;
  weights: DataArrayTexture;
  globalHeights: DataTexture;
  nodes: DataTexture;
  /** Renderer-local terrain origin (min X/Z corner, Y datum). */
  origin: Vector3;
  /** World metres between tile vertices / global map samples. */
  tileSpacing: number;
  globalSpacing: number;
  /** Vertices per tile side; global map width × height. */
  tileTexels: number;
  globalSize: Vector2;
  extent: Vector2;
  morph: ReadonlyArray<readonly [number, number]>;
  patchQuads: number;
  weightBlocks: number;
}

export interface TerrainUniforms {
  [name: string]: { value: unknown };
}

export interface TerrainMaterial {
  material: MeshStandardMaterial;
  uniforms: TerrainUniforms;
}

const SHARED_PARS = /* glsl */ `
uniform highp sampler2DArray uTerrainHeights;
uniform highp sampler2D uTerrainGlobalHeights;
uniform vec3 uTerrainOrigin;
uniform vec2 uTerrainSpacing; // tile, global
uniform float uTerrainTileTexels;
uniform vec2 uTerrainGlobalSize;
uniform vec2 uTerrainExtent;

float forgeTileTexel(ivec2 p, int slot) {
  p = clamp(p, ivec2(0), ivec2(int(uTerrainTileTexels) - 1));
  return texelFetch(uTerrainHeights, ivec3(p, slot), 0).r;
}

float forgeGlobalTexel(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uTerrainGlobalSize) - 1);
  return texelFetch(uTerrainGlobalHeights, p, 0).r - uTerrainOrigin.y;
}

// Height above the datum at terrain-local metres. slot >= 0 reads that tile
// (tileOrigin = its min corner, terrain-local); otherwise the global map. NaN
// marks a hole / missing tile.
float forgeTerrainHeight(vec2 local, float slot, vec2 tileOrigin) {
  if (slot >= 0.0) {
    vec2 g = (local - tileOrigin) / uTerrainSpacing.x;
    ivec2 i = ivec2(floor(g));
    vec2 f = g - vec2(i);
    int s = int(slot + 0.5);
    float h00 = forgeTileTexel(i, s);
    float h10 = forgeTileTexel(i + ivec2(1, 0), s);
    float h01 = forgeTileTexel(i + ivec2(0, 1), s);
    float h11 = forgeTileTexel(i + ivec2(1, 1), s);
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }
  vec2 g = local / uTerrainSpacing.y;
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float h00 = forgeGlobalTexel(i);
  float h10 = forgeGlobalTexel(i + ivec2(1, 0));
  float h01 = forgeGlobalTexel(i + ivec2(0, 1));
  float h11 = forgeGlobalTexel(i + ivec2(1, 1));
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
`;

const VERTEX_PARS = /* glsl */ `
uniform highp sampler2D uTerrainNodes;
uniform int uTerrainNodesWidth;
uniform vec3 uTerrainLodCamera;
uniform vec2 uTerrainMorph[TERRAIN_LOD_LEVELS];
uniform float uTerrainPatchQuads;
varying vec2 vTerrainLocal;
varying vec3 vTerrainTile; // slot, tile origin x/z
varying float vTerrainHole;
`;

const VERTEX_BEGIN = /* glsl */ `
int forgeTexel = gl_InstanceID * 2;
ivec2 forgeNodeUv = ivec2(forgeTexel % uTerrainNodesWidth, forgeTexel / uTerrainNodesWidth);
vec4 forgeNodeA = texelFetch(uTerrainNodes, forgeNodeUv, 0); // offset x/z, size, level
vec4 forgeNodeB = texelFetch(uTerrainNodes, forgeNodeUv + ivec2(1, 0), 0); // slot, tile origin x/z
vec2 forgeGrid = position.xz;
float forgeSize = forgeNodeA.z;
vec2 forgeLocal = min(forgeNodeA.xy + forgeGrid * forgeSize, uTerrainExtent);
float forgeH0 = forgeTerrainHeight(forgeLocal, forgeNodeB.x, forgeNodeB.yz);
vec3 forgeP0 = uTerrainOrigin + vec3(forgeLocal.x, isnan(forgeH0) ? 0.0 : forgeH0, forgeLocal.y);
vec2 forgeMorphRange = uTerrainMorph[int(forgeNodeA.w + 0.5)];
float forgeMorph = clamp(
  (distance(forgeP0, uTerrainLodCamera) - forgeMorphRange.x) / (forgeMorphRange.y - forgeMorphRange.x),
  0.0, 1.0);
// Odd grid vertices slide onto the even (parent) grid as forgeMorph -> 1.
vec2 forgeFrac = fract(forgeGrid * uTerrainPatchQuads * 0.5) * 2.0 / uTerrainPatchQuads;
forgeLocal = min(forgeNodeA.xy + (forgeGrid - forgeFrac * forgeMorph) * forgeSize, uTerrainExtent);
float forgeH = forgeTerrainHeight(forgeLocal, forgeNodeB.x, forgeNodeB.yz);
vTerrainHole = isnan(forgeH) ? 1.0 : 0.0;
vec3 transformed = uTerrainOrigin + vec3(forgeLocal.x, vTerrainHole > 0.5 ? 0.0 : forgeH, forgeLocal.y);
vTerrainLocal = forgeLocal;
vTerrainTile = forgeNodeB.xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray uTerrainWeights;
uniform vec3 uLayerColor[${TERRAIN_SHADER_LAYERS}];
uniform vec3 uTerrainDefaultColor;
uniform int uTerrainActiveLayer;
uniform vec2 uTerrainHeightRange; // min, max (relative to the datum)
uniform sampler2D uLayerTex0;
uniform sampler2D uLayerTex1;
uniform sampler2D uLayerTex2;
uniform sampler2D uLayerTex3;
uniform vec4 uLayerHasTex;
uniform vec4 uLayerTiling;
varying vec2 vTerrainLocal;
varying vec3 vTerrainTile;
varying float vTerrainHole;

// Paint weights of block 0 (layers 0-3) and block 1 (layers 4-7). Coarse
// global-map nodes carry no weights and show the base layer.
void forgeTerrainWeights(out vec4 w0, out vec4 w1) {
  w0 = vec4(1.0, 0.0, 0.0, 0.0);
  w1 = vec4(0.0);
  float slot = floor(vTerrainTile.x + 0.5);
  if (slot < 0.0) return;
  vec2 uv = ((vTerrainLocal - vTerrainTile.yz) / uTerrainSpacing.x + 0.5) / uTerrainTileTexels;
  w0 = texture(uTerrainWeights, vec3(uv, slot * float(TERRAIN_WEIGHT_BLOCKS)));
#if TERRAIN_WEIGHT_BLOCKS > 1
  w1 = texture(uTerrainWeights, vec3(uv, slot * float(TERRAIN_WEIGHT_BLOCKS) + 1.0));
#endif
}

// Per-pixel normal from the height texture; one-sided at the footprint edge.
vec3 forgeTerrainNormal() {
  float slot = floor(vTerrainTile.x + 0.5);
  float t = slot >= 0.0 ? uTerrainSpacing.x : uTerrainSpacing.y;
  vec2 lo = clamp(vTerrainLocal - t, vec2(0.0), uTerrainExtent);
  vec2 hi = clamp(vTerrainLocal + t, vec2(0.0), uTerrainExtent);
  float hl = forgeTerrainHeight(vec2(lo.x, vTerrainLocal.y), slot, vTerrainTile.yz);
  float hr = forgeTerrainHeight(vec2(hi.x, vTerrainLocal.y), slot, vTerrainTile.yz);
  float hd = forgeTerrainHeight(vec2(vTerrainLocal.x, lo.y), slot, vTerrainTile.yz);
  float hu = forgeTerrainHeight(vec2(vTerrainLocal.x, hi.y), slot, vTerrainTile.yz);
  return normalize(vec3((hl - hr) / max(hi.x - lo.x, 1e-4), 1.0, (hd - hu) / max(hi.y - lo.y, 1e-4)));
}

float forgeLayerWeight(vec4 w0, vec4 w1, int layer) {
  return layer < 4 ? w0[layer] : w1[layer - 4];
}
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec4 forgeW0;
  vec4 forgeW1;
  forgeTerrainWeights(forgeW0, forgeW1);
  vec3 forgeN = forgeTerrainNormal();
#if TERRAIN_VIEW_MODE == 1
  float forgeH = forgeTerrainHeight(vTerrainLocal, floor(vTerrainTile.x + 0.5), vTerrainTile.yz);
  float forgeT = clamp((forgeH - uTerrainHeightRange.x) / max(0.0001, uTerrainHeightRange.y - uTerrainHeightRange.x), 0.0, 1.0);
  diffuseColor.rgb = vec3(0.16 + forgeT * 0.62, 0.28 + forgeT * 0.5, 0.2 + forgeT * 0.68);
#elif TERRAIN_VIEW_MODE == 2
  float forgeSlope = clamp(1.0 - forgeN.y, 0.0, 1.0);
  diffuseColor.rgb = vec3(0.15 + forgeSlope * 0.75, 0.62 - forgeSlope * 0.34, 0.22 + forgeSlope * 0.32);
#elif TERRAIN_VIEW_MODE == 3
  float forgeActive = clamp(forgeLayerWeight(forgeW0, forgeW1, uTerrainActiveLayer), 0.0, 1.0);
  diffuseColor.rgb = uLayerColor[uTerrainActiveLayer] * (0.2 + forgeActive * 0.8);
#elif defined(TERRAIN_SPLAT)
  vec2 forgeUv = vTerrainLocal / uTerrainExtent;
  vec3 forgeC0 = uLayerHasTex.x > 0.5 ? texture(uLayerTex0, forgeUv * uLayerTiling.x).rgb : uLayerColor[0];
  vec3 forgeC1 = uLayerHasTex.y > 0.5 ? texture(uLayerTex1, forgeUv * uLayerTiling.y).rgb : uLayerColor[1];
  vec3 forgeC2 = uLayerHasTex.z > 0.5 ? texture(uLayerTex2, forgeUv * uLayerTiling.z).rgb : uLayerColor[2];
  vec3 forgeC3 = uLayerHasTex.w > 0.5 ? texture(uLayerTex3, forgeUv * uLayerTiling.w).rgb : uLayerColor[3];
  vec3 forgeAlbedo = forgeC0 * forgeW0.x + forgeC1 * forgeW0.y + forgeC2 * forgeW0.z + forgeC3 * forgeW0.w;
  float forgeWeight = forgeW0.x + forgeW0.y + forgeW0.z + forgeW0.w;
  diffuseColor.rgb = forgeWeight > 0.0001 ? forgeAlbedo / forgeWeight : uLayerColor[0];
#else
  vec3 forgeBlend = vec3(0.0);
  for (int forgeLayer = 0; forgeLayer < TERRAIN_LAYER_COUNT; forgeLayer += 1) {
    forgeBlend += uLayerColor[forgeLayer] * clamp(forgeLayerWeight(forgeW0, forgeW1, forgeLayer), 0.0, 1.0);
  }
  diffuseColor.rgb = forgeBlend.r + forgeBlend.g + forgeBlend.b > 0.0 ? forgeBlend : uTerrainDefaultColor;
#endif
}
`;

const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_begin>
{
  normal = normalize((viewMatrix * modelMatrix * vec4(forgeTerrainNormal(), 0.0)).xyz);
  nonPerturbedNormal = normal;
}
`;

const FRAGMENT_HOLE = /* glsl */ `
if (vTerrainHole > 0.5) discard;
#include <clipping_planes_fragment>
`;

export function injectTerrainVertex(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${SHARED_PARS}\n${VERTEX_PARS}`)
    .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
    .replace("#include <begin_vertex>", VERTEX_BEGIN);
}

export function injectTerrainFragment(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\nuniform mat4 modelMatrix;\n${SHARED_PARS}\n${FRAGMENT_PARS}`)
    .replace("#include <clipping_planes_fragment>", FRAGMENT_HOLE)
    .replace("#include <color_fragment>", FRAGMENT_COLOR)
    .replace("#include <normal_fragment_begin>", FRAGMENT_NORMAL);
}

export interface TerrainLayerLook {
  color: string;
  texture: Texture | null;
  /** Texture repeats across the whole drawn footprint. */
  tiling: number;
}

export interface TerrainLook {
  viewMode: TerrainShaderViewMode;
  /** Aligned to the source's paint layers (at most eight are drawn). */
  layers: TerrainLayerLook[];
  activeLayer: number;
  defaultColor: string;
  /** Height range for the height view, relative to the datum (the renderer derives it from the data). */
  heightRange?: { min: number; max: number };
}

export function createTerrainMaterial(inputs: TerrainMaterialInputs, look: TerrainLook): TerrainMaterial {
  const uniforms: TerrainUniforms = {
    uTerrainHeights: { value: inputs.heights },
    uTerrainWeights: { value: inputs.weights },
    uTerrainGlobalHeights: { value: inputs.globalHeights },
    uTerrainNodes: { value: inputs.nodes },
    uTerrainNodesWidth: { value: inputs.nodes.image.width },
    uTerrainOrigin: { value: inputs.origin },
    uTerrainSpacing: { value: new Vector2(inputs.tileSpacing, inputs.globalSpacing) },
    uTerrainTileTexels: { value: inputs.tileTexels },
    uTerrainGlobalSize: { value: inputs.globalSize },
    uTerrainExtent: { value: inputs.extent },
    uTerrainLodCamera: { value: new Vector3() },
    uTerrainMorph: { value: inputs.morph.map(([start, end]) => new Vector2(start, end)) },
    uTerrainPatchQuads: { value: inputs.patchQuads },
    uLayerColor: { value: Array.from({ length: TERRAIN_SHADER_LAYERS }, () => new Color()) },
    uTerrainDefaultColor: { value: new Color() },
    uTerrainActiveLayer: { value: 0 },
    uTerrainHeightRange: { value: new Vector2() },
    uLayerHasTex: { value: new Vector4() },
    uLayerTiling: { value: new Vector4(1, 1, 1, 1) },
  };
  for (let index = 0; index < TERRAIN_SHADER_TEXTURED_LAYERS; index += 1) uniforms[`uLayerTex${index}`] = { value: null };

  const material = new MeshStandardMaterial({ color: new Color("#ffffff"), roughness: 1, metalness: 0 });
  material.name = "forge-terrain";
  const lodLevels = inputs.morph.length;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectTerrainVertex(shader);
    injectTerrainFragment(shader);
  };
  material.customProgramCacheKey = () =>
    `forge-terrain:${material.defines?.TERRAIN_VIEW_MODE}:${material.defines?.TERRAIN_SPLAT !== undefined}:` +
    `${material.defines?.TERRAIN_LAYER_COUNT}:${inputs.weightBlocks}:${lodLevels}`;
  material.defines = {
    TERRAIN_LOD_LEVELS: String(lodLevels),
    TERRAIN_WEIGHT_BLOCKS: String(inputs.weightBlocks),
  };
  applyTerrainLook({ material, uniforms }, look);
  return { material, uniforms };
}

/** Pushes colours/textures/view mode; recompiles only when a define changes. */
export function applyTerrainLook({ material, uniforms }: TerrainMaterial, look: TerrainLook): void {
  const layers = look.layers.slice(0, TERRAIN_SHADER_LAYERS);
  const colors = uniforms.uLayerColor!.value as Color[];
  colors.forEach((color, index) => color.set(layers[index]?.color ?? look.defaultColor));
  (uniforms.uTerrainDefaultColor!.value as Color).set(look.defaultColor);
  uniforms.uTerrainActiveLayer!.value = Math.min(Math.max(0, look.activeLayer), TERRAIN_SHADER_LAYERS - 1);
  if (look.heightRange) (uniforms.uTerrainHeightRange!.value as Vector2).set(look.heightRange.min, look.heightRange.max);
  const hasTex = uniforms.uLayerHasTex!.value as Vector4;
  const tiling = uniforms.uLayerTiling!.value as Vector4;
  let anyTexture = false;
  for (let index = 0; index < TERRAIN_SHADER_TEXTURED_LAYERS; index += 1) {
    const texture = layers[index]?.texture ?? null;
    uniforms[`uLayerTex${index}`]!.value = texture;
    hasTex.setComponent(index, texture ? 1 : 0);
    tiling.setComponent(index, Math.max(0.0001, layers[index]?.tiling ?? 1));
    anyTexture ||= texture !== null;
  }
  const defines: Record<string, string> = {
    TERRAIN_LOD_LEVELS: material.defines!.TERRAIN_LOD_LEVELS as string,
    TERRAIN_WEIGHT_BLOCKS: material.defines!.TERRAIN_WEIGHT_BLOCKS as string,
    TERRAIN_VIEW_MODE: VIEW_MODE_DEFINE[look.viewMode],
    TERRAIN_LAYER_COUNT: String(Math.max(1, layers.length)),
  };
  if (look.viewMode === "lit" && anyTexture) defines.TERRAIN_SPLAT = "";
  const previous = material.defines ?? {};
  const changed = Object.keys(defines).length !== Object.keys(previous).length
    || Object.entries(defines).some(([key, value]) => previous[key] !== value);
  if (changed) {
    material.defines = defines;
    material.needsUpdate = true;
  }
}
