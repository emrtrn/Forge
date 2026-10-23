import {
  Color,
  MeshDepthMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  NoBlending,
  RGBADepthPacking,
  Vector2,
  Vector3,
  Vector4,
  type DataArrayTexture,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";

import { TERRAIN_RENDER_LAYERS, TERRAIN_WEIGHT_BLOCKS } from "@engine/terrain/terrainRenderData";

/**
 * CDLOD terrain materials (OPEN_WORLD_PLAN Faz 2, from the Faz 0 S2 spike). The
 * mesh is one flat instanced patch; the vertex shader places every instance on
 * the heightfield texture and morphs odd vertices onto the parent grid with
 * distance, so the same injection is shared by:
 *
 *  - the lit `MeshStandardMaterial` (PBR, fog, shadow receiving) with the
 *    Landscape splat and its height/slope/layer debug views,
 *  - a `MeshNormalMaterial` for the GTAO normal pass and a `MeshDepthMaterial`
 *    for the DOF depth pass — those passes override the scene material, which
 *    would otherwise draw the undisplaced patch (see `postProcess.ts`).
 *
 * Coordinates: "terrain-local" metres start at the grid's min corner; the mesh
 * frame adds `uTerrainOrigin` (the legacy Landscape centres its grid on the
 * actor). Heights are exact R32F texels read with `texelFetch`; morphing
 * vertices between grid points blend the four around them by hand, so no float
 * filtering extension is needed. Normals and weights are filtered textures
 * built at vertex resolution, which matches the legacy per-vertex attributes.
 */

export type TerrainViewMode = "lit" | "height" | "slope" | "layer";

const VIEW_MODE_INDEX: Record<TerrainViewMode, number> = { lit: 0, height: 1, slope: 2, layer: 3 };

/** Updates the view-mode, active-layer and layer-colour uniforms in place. */
export function setTerrainAppearance(
  uniforms: TerrainUniforms,
  viewMode: TerrainViewMode,
  activeLayer: number,
  colors: readonly string[],
): void {
  uniforms.uTerrainView!.value = VIEW_MODE_INDEX[viewMode];
  uniforms.uTerrainActiveLayer!.value = activeLayer;
  const values = uniforms.uLayerColors!.value as Color[];
  values.forEach((color, index) => color.set(colors[index] ?? colors[0] ?? "#808080"));
}

export interface TerrainLayerInput {
  texture: Texture | null;
  color: string;
  /** Texture repeats per metre. */
  scale: number;
}

export interface TerrainMaterialInputs {
  heights: DataArrayTexture;
  normals: DataArrayTexture;
  weights: DataArrayTexture;
  /** Mesh-frame position of terrain-local (0, 0, 0). */
  origin: Vector3;
  spacing: number;
  /** Vertices per side of one slot (tile). */
  tileVertices: number;
  /** Terrain-local edge length; vertices of larger root nodes clamp to it. */
  extent: number;
  patchQuads: number;
  viewMode: TerrainViewMode;
  activeLayer: number;
  /** Height-view range (world metres). */
  heightRange: Vector2;
  layers: TerrainLayerInput[];
}

export interface TerrainUniforms {
  [name: string]: { value: unknown };
}

export interface TerrainMaterials {
  material: MeshStandardMaterial;
  normalMaterial: MeshNormalMaterial;
  depthMaterial: MeshDepthMaterial;
  uniforms: TerrainUniforms;
}

const VERTEX_PARS = /* glsl */ `
uniform highp sampler2DArray uTerrainHeights;
uniform vec3 uTerrainOrigin;
uniform float uTerrainSpacing;
uniform float uTerrainTileVertices;
uniform float uTerrainExtent;
uniform vec3 uTerrainLodCamera;
uniform float uTerrainPatchQuads;
attribute vec4 terrainNodeA; // terrain-local node origin x/z, node size, slot
attribute vec4 terrainNodeB; // terrain-local tile origin x/z, morph start/end
varying vec2 vTerrainLocal;
varying vec4 vTerrainTile; // slot, tile origin x/z, height
varying vec3 vTerrainAxisX;
varying vec3 vTerrainAxisY;
varying vec3 vTerrainAxisZ;

float forgeTerrainTexel(ivec2 cell, int slot) {
  ivec2 last = ivec2(int(uTerrainTileVertices) - 1);
  return texelFetch(uTerrainHeights, ivec3(clamp(cell, ivec2(0), last), slot), 0).r;
}

float forgeTerrainHeight(vec2 local, vec2 tileOrigin, int slot) {
  vec2 grid = (local - tileOrigin) / uTerrainSpacing;
  vec2 base = floor(grid);
  vec2 f = grid - base;
  ivec2 cell = ivec2(base);
  float h00 = forgeTerrainTexel(cell, slot);
  float h10 = forgeTerrainTexel(cell + ivec2(1, 0), slot);
  float h01 = forgeTerrainTexel(cell + ivec2(0, 1), slot);
  float h11 = forgeTerrainTexel(cell + ivec2(1, 1), slot);
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
`;

const VERTEX_BEGIN = /* glsl */ `
int forgeSlot = int(terrainNodeA.w + 0.5);
vec2 forgeGrid = position.xz;
vec2 forgeLocal = terrainNodeA.xy + forgeGrid * terrainNodeA.z;
vec2 forgeEdge = vec2(uTerrainExtent);
float forgeH0 = forgeTerrainHeight(clamp(forgeLocal, vec2(0.0), forgeEdge), terrainNodeB.xy, forgeSlot);
float forgeMorph = clamp(
  (distance(vec3(forgeLocal.x, forgeH0, forgeLocal.y), uTerrainLodCamera) - terrainNodeB.z) /
    (terrainNodeB.w - terrainNodeB.z),
  0.0, 1.0);
// Odd grid vertices slide onto the even (parent) grid as forgeMorph -> 1.
vec2 forgeFrac = fract(forgeGrid * uTerrainPatchQuads * 0.5) * 2.0 / uTerrainPatchQuads;
forgeLocal = clamp(forgeLocal - forgeFrac * terrainNodeA.z * forgeMorph, vec2(0.0), forgeEdge);
float forgeH = forgeTerrainHeight(forgeLocal, terrainNodeB.xy, forgeSlot);
vec3 transformed = uTerrainOrigin + vec3(forgeLocal.x, forgeH, forgeLocal.y);
vTerrainLocal = forgeLocal;
vTerrainTile = vec4(terrainNodeA.w, terrainNodeB.xy, forgeH);
vTerrainAxisX = normalMatrix * vec3(1.0, 0.0, 0.0);
vTerrainAxisY = normalMatrix * vec3(0.0, 1.0, 0.0);
vTerrainAxisZ = normalMatrix * vec3(0.0, 0.0, 1.0);
`;

const FRAGMENT_NORMAL_PARS = /* glsl */ `
uniform highp sampler2DArray uTerrainNormals;
uniform float uTerrainSpacing;
uniform float uTerrainTileVertices;
varying vec2 vTerrainLocal;
varying vec4 vTerrainTile;
varying vec3 vTerrainAxisX;
varying vec3 vTerrainAxisY;
varying vec3 vTerrainAxisZ;

vec2 forgeTerrainUv() {
  return ((vTerrainLocal - vTerrainTile.yz) / uTerrainSpacing + 0.5) / uTerrainTileVertices;
}

float forgeTerrainSlot() {
  return floor(vTerrainTile.x + 0.5);
}

vec3 forgeTerrainLocalNormal() {
  vec2 n = texture(uTerrainNormals, vec3(forgeTerrainUv(), forgeTerrainSlot())).rg;
  return normalize(vec3(n.x, sqrt(max(0.0, 1.0 - dot(n, n))), n.y));
}
`;

const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_begin>
{
  vec3 forgeN = forgeTerrainLocalNormal();
  normal = normalize(vTerrainAxisX * forgeN.x + vTerrainAxisY * forgeN.y + vTerrainAxisZ * forgeN.z);
  nonPerturbedNormal = normal;
}
`;

const FRAGMENT_COLOR_PARS = /* glsl */ `
uniform highp sampler2DArray uTerrainWeights;
uniform float uTerrainView;
uniform vec2 uTerrainHeightRange;
uniform float uTerrainActiveLayer;
uniform vec3 uLayerColors[${TERRAIN_RENDER_LAYERS}];
uniform sampler2D uLayerTex0;
uniform sampler2D uLayerTex1;
uniform sampler2D uLayerTex2;
uniform sampler2D uLayerTex3;
uniform vec4 uLayerHasTex;
uniform vec4 uLayerScale;
`;

// Mirrors `landscapeVertexColor` in landscape.ts, per pixel instead of per vertex.
const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec2 forgeUv = forgeTerrainUv();
  float forgeWeightLayer = forgeTerrainSlot() * ${TERRAIN_WEIGHT_BLOCKS.toFixed(1)};
  vec4 forgeW0 = texture(uTerrainWeights, vec3(forgeUv, forgeWeightLayer));
  vec4 forgeW1 = texture(uTerrainWeights, vec3(forgeUv, forgeWeightLayer + 1.0));
  vec3 forgeColor;
  if (uTerrainView < 0.5) {
    vec2 forgeP = vTerrainLocal;
    vec3 forgeC0 = uLayerHasTex.x > 0.5 ? texture(uLayerTex0, forgeP * uLayerScale.x).rgb : uLayerColors[0];
    vec3 forgeC1 = uLayerHasTex.y > 0.5 ? texture(uLayerTex1, forgeP * uLayerScale.y).rgb : uLayerColors[1];
    vec3 forgeC2 = uLayerHasTex.z > 0.5 ? texture(uLayerTex2, forgeP * uLayerScale.z).rgb : uLayerColors[2];
    vec3 forgeC3 = uLayerHasTex.w > 0.5 ? texture(uLayerTex3, forgeP * uLayerScale.w).rgb : uLayerColors[3];
    vec3 forgeSum = forgeC0 * forgeW0.x + forgeC1 * forgeW0.y + forgeC2 * forgeW0.z + forgeC3 * forgeW0.w
      + uLayerColors[4] * forgeW1.x + uLayerColors[5] * forgeW1.y + uLayerColors[6] * forgeW1.z + uLayerColors[7] * forgeW1.w;
    float forgeTotal = dot(forgeW0, vec4(1.0)) + dot(forgeW1, vec4(1.0));
    forgeColor = forgeTotal > 0.0001 ? forgeSum / forgeTotal : uLayerColors[0];
  } else if (uTerrainView < 1.5) {
    float forgeT = (vTerrainTile.w - uTerrainHeightRange.x) / max(0.0001, uTerrainHeightRange.y - uTerrainHeightRange.x);
    forgeColor = vec3(0.16 + forgeT * 0.62, 0.28 + forgeT * 0.5, 0.2 + forgeT * 0.68);
  } else if (uTerrainView < 2.5) {
    float forgeSlope = clamp(1.0 - forgeTerrainLocalNormal().y, 0.0, 1.0);
    forgeColor = vec3(0.15 + forgeSlope * 0.75, 0.62 - forgeSlope * 0.34, 0.22 + forgeSlope * 0.32);
  } else {
    int forgeLayer = int(uTerrainActiveLayer + 0.5);
    vec4 forgeBlock = forgeLayer < 4 ? forgeW0 : forgeW1;
    int forgeChannel = forgeLayer - (forgeLayer < 4 ? 0 : 4);
    float forgeWeight = forgeChannel == 0 ? forgeBlock.x : forgeChannel == 1 ? forgeBlock.y : forgeChannel == 2 ? forgeBlock.z : forgeBlock.w;
    forgeColor = uLayerColors[forgeLayer] * (0.2 + clamp(forgeWeight, 0.0, 1.0) * 0.8);
  }
  diffuseColor.rgb = forgeColor;
}
`;

function injectVertex(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
    .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
    .replace("#include <begin_vertex>", VERTEX_BEGIN);
}

/** Fragment declarations go before `main`: unlike the vertex shaders, not every
 * fragment shader (`MeshNormalMaterial`'s) includes `<common>`. */
const FRAGMENT_MAIN = "void main() {";

function injectNormal(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace(FRAGMENT_MAIN, `${FRAGMENT_NORMAL_PARS}\n${FRAGMENT_MAIN}`)
    .replace("#include <normal_fragment_begin>", FRAGMENT_NORMAL);
}

function patch(material: Material, uniforms: TerrainUniforms, key: string, fragment?: (shader: WebGLProgramParametersWithUniforms) => void): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectVertex(shader);
    fragment?.(shader);
  };
  material.customProgramCacheKey = () => key;
}

function layerUniforms(uniforms: TerrainUniforms, layers: TerrainLayerInput[]): void {
  const hasTex = new Vector4();
  const scale = new Vector4(1, 1, 1, 1);
  for (let index = 0; index < 4; index += 1) {
    const layer = layers[index];
    uniforms[`uLayerTex${index}`] = { value: layer?.texture ?? null };
    hasTex.setComponent(index, layer?.texture ? 1 : 0);
    scale.setComponent(index, layer?.scale ?? 1);
  }
  uniforms.uLayerHasTex = { value: hasTex };
  uniforms.uLayerScale = { value: scale };
  const fallback = layers[0]?.color ?? "#808080";
  uniforms.uLayerColors = {
    value: Array.from({ length: TERRAIN_RENDER_LAYERS }, (_, index) => new Color(layers[index]?.color ?? fallback)),
  };
}

export function createTerrainMaterials(inputs: TerrainMaterialInputs): TerrainMaterials {
  const uniforms: TerrainUniforms = {
    uTerrainHeights: { value: inputs.heights },
    uTerrainNormals: { value: inputs.normals },
    uTerrainWeights: { value: inputs.weights },
    uTerrainOrigin: { value: inputs.origin },
    uTerrainSpacing: { value: inputs.spacing },
    uTerrainTileVertices: { value: inputs.tileVertices },
    uTerrainExtent: { value: inputs.extent },
    uTerrainLodCamera: { value: new Vector3() },
    uTerrainPatchQuads: { value: inputs.patchQuads },
    uTerrainView: { value: VIEW_MODE_INDEX[inputs.viewMode] },
    uTerrainActiveLayer: { value: inputs.activeLayer },
    uTerrainHeightRange: { value: inputs.heightRange },
  };
  layerUniforms(uniforms, inputs.layers);

  const material = new MeshStandardMaterial({ color: new Color("#ffffff"), roughness: 1, metalness: 0 });
  patch(material, uniforms, "forge-terrain-cdlod", (shader) => {
    injectNormal(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(FRAGMENT_MAIN, `${FRAGMENT_COLOR_PARS}\n${FRAGMENT_MAIN}`)
      .replace("#include <color_fragment>", FRAGMENT_COLOR);
  });

  const normalMaterial = new MeshNormalMaterial();
  normalMaterial.blending = NoBlending;
  patch(normalMaterial, uniforms, "forge-terrain-cdlod-normal", injectNormal);

  const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depthMaterial.blending = NoBlending;
  patch(depthMaterial, uniforms, "forge-terrain-cdlod-depth");

  return { material, normalMaterial, depthMaterial, uniforms };
}
