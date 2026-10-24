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
  type DataTexture,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";

import { TERRAIN_RENDER_LAYERS, TERRAIN_WEIGHT_BLOCKS } from "@engine/terrain/terrainRenderData";

import {
  sharedTerrainDeformation,
  terrainDeformationLayerUniforms,
  TERRAIN_DEFORMATION_COLOR,
  TERRAIN_DEFORMATION_DISPLACEMENT_PARS,
  TERRAIN_DEFORMATION_FRAGMENT_PARS,
  TERRAIN_DEFORMATION_NORMAL,
  TERRAIN_DEFORMATION_ROUGHNESS,
  TERRAIN_DEFORMATION_VERTEX,
  TERRAIN_DEFORMATION_VERTEX_PARS,
  type TerrainDeformationTexture,
} from "./terrainDeformation";

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
 * Coordinates: "terrain-local" metres start at tile (0, 0)'s min corner; the
 * mesh frame adds `uTerrainOrigin` (a Landscape centres its grid on the actor).
 * Each instance names its source: a tile slot (`slot >= 0`, full resolution)
 * or the global map (`slot < 0`, one sample per parent-of-tile grid vertex,
 * for far nodes and tiles without a slot). Heights are exact R32F texels read
 * with `texelFetch`; morphing vertices between grid points blend the four
 * around them by hand, so no float filtering extension is needed. Normals and
 * weights are filtered textures at vertex resolution. A global sample with no
 * tile (a hole) is discarded in every material.
 */

export type TerrainViewMode = "lit" | "height" | "slope" | "layer";

/** Skirt depth as a share of the node's size (a 128 m node hangs a 6.4 m skirt). */
export const TERRAIN_SKIRT_RATIO = 0.05;

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

/**
 * CPU mirror of the vertex shader's tile-slot `forgeTerrainHeight`: texel
 * clamping and the collider's b–c diagonal, for tests that pin the drawn
 * surface to `terrainHeightAt`. `heights` is one slot (`tileVertices²` R32F
 * texels), `local` terrain-local metres, `tileOrigin` the tile's min corner.
 */
export function terrainSlotHeight(
  heights: ArrayLike<number>,
  tileVertices: number,
  spacing: number,
  tileOrigin: readonly [number, number],
  local: readonly [number, number],
): number {
  const gx = (local[0] - tileOrigin[0]) / spacing;
  const gz = (local[1] - tileOrigin[1]) / spacing;
  const cx = Math.floor(gx);
  const cz = Math.floor(gz);
  const fx = gx - cx;
  const fz = gz - cz;
  const last = tileVertices - 1;
  const texel = (x: number, z: number) => heights[Math.max(0, Math.min(z, last)) * tileVertices + Math.max(0, Math.min(x, last))]!;
  const ha = texel(cx, cz);
  const hb = texel(cx + 1, cz);
  const hc = texel(cx, cz + 1);
  const hd = texel(cx + 1, cz + 1);
  return fx + fz <= 1 ? ha + (hb - ha) * fx + (hc - ha) * fz : hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
}

export interface TerrainLayerInput {
  texture: Texture | null;
  color: string;
  /** Texture repeats per metre. */
  scale: number;
  /** Physical material id: its soft-surface profile tints this layer's tracks. */
  physicalMaterial?: string | null;
}

export interface TerrainMaterialInputs {
  /** Tile slots: R32F heights, RG16F normal X/Z, two RGBA8 weight layers per slot. */
  heights: DataArrayTexture;
  normals: DataArrayTexture;
  weights: DataArrayTexture;
  /** Global map: R32F heights, RGBA16F (normal X, normal Z, hole flag), two RGBA8 weight layers. */
  globalHeights: DataTexture;
  globalNormals: DataTexture;
  globalWeights: DataArrayTexture;
  /** Global map samples per axis. */
  globalSize: Vector2;
  /** Metres between global samples. */
  globalSpacing: number;
  /** Mesh-frame position of terrain-local (0, 0, 0). */
  origin: Vector3;
  spacing: number;
  /** Vertices per side of one slot (tile). */
  tileVertices: number;
  /** Terrain-local X/Z edge lengths that are drawn; vertices past them clamp to the edge. */
  extent: Vector2;
  patchQuads: number;
  viewMode: TerrainViewMode;
  activeLayer: number;
  /** Height-view range (world metres). */
  heightRange: Vector2;
  layers: TerrainLayerInput[];
  /** Runtime track texture the lit material samples (default: the page's shared one). */
  deformation?: TerrainDeformationTexture;
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
uniform highp sampler2D uTerrainGlobalHeights;
uniform vec2 uTerrainGlobalSize;
uniform float uTerrainGlobalSpacing;
uniform vec3 uTerrainOrigin;
uniform float uTerrainSpacing;
uniform float uTerrainTileVertices;
uniform vec2 uTerrainExtent;
uniform vec3 uTerrainLodCamera;
uniform float uTerrainPatchQuads;
uniform float uTerrainSkirtRatio;
attribute vec4 terrainNodeA; // terrain-local node origin x/z, node size, slot (-1: global map)
attribute vec4 terrainNodeB; // terrain-local tile origin x/z, morph start/end
attribute float terrainNodeC; // 1: hang the skirt (this node or its neighbour stands in from the global map)
varying vec2 vTerrainLocal;
varying vec4 vTerrainTile; // slot, tile origin x/z, height
varying vec3 vTerrainAxisX;
varying vec3 vTerrainAxisY;
varying vec3 vTerrainAxisZ;

float forgeTerrainTexel(ivec2 cell, int slot) {
  ivec2 last = ivec2(int(uTerrainTileVertices) - 1);
  return texelFetch(uTerrainHeights, ivec3(clamp(cell, ivec2(0), last), slot), 0).r;
}

float forgeTerrainGlobalTexel(ivec2 cell) {
  return texelFetch(uTerrainGlobalHeights, clamp(cell, ivec2(0), ivec2(uTerrainGlobalSize) - 1), 0).r;
}

// Tile slots: the collider's triangle (b–c diagonal, as terrainHeightAt), so a
// detail vertex between grid points sits on the surface the wheels touch. The
// global map stays bilinear (far nodes, one sample per parent-of-tile vertex).
float forgeTerrainHeight(vec2 local, vec2 tileOrigin, int slot) {
  vec2 grid = slot >= 0 ? (local - tileOrigin) / uTerrainSpacing : local / uTerrainGlobalSpacing;
  vec2 base = floor(grid);
  vec2 f = grid - base;
  ivec2 cell = ivec2(base);
  if (slot >= 0) {
    float ha = forgeTerrainTexel(cell, slot);
    float hb = forgeTerrainTexel(cell + ivec2(1, 0), slot);
    float hc = forgeTerrainTexel(cell + ivec2(0, 1), slot);
    float hd = forgeTerrainTexel(cell + ivec2(1, 1), slot);
    return f.x + f.y <= 1.0
      ? ha + (hb - ha) * f.x + (hc - ha) * f.y
      : hd + (hc - hd) * (1.0 - f.x) + (hb - hd) * (1.0 - f.y);
  }
  float h00 = forgeTerrainGlobalTexel(cell);
  float h10 = forgeTerrainGlobalTexel(cell + ivec2(1, 0));
  float h01 = forgeTerrainGlobalTexel(cell + ivec2(0, 1));
  float h11 = forgeTerrainGlobalTexel(cell + ivec2(1, 1));
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
${TERRAIN_DEFORMATION_DISPLACEMENT_PARS}`;

const VERTEX_BEGIN = /* glsl */ `
// floor, not int(): int() truncates toward zero and would turn slot -1 into 0.
int forgeSlot = int(floor(terrainNodeA.w + 0.5));
vec2 forgeGrid = position.xz;
vec2 forgeLocal = terrainNodeA.xy + forgeGrid * terrainNodeA.z;
vec2 forgeEdge = uTerrainExtent;
float forgeH0 = forgeTerrainHeight(clamp(forgeLocal, vec2(0.0), forgeEdge), terrainNodeB.xy, forgeSlot);
float forgeMorph = clamp(
  (distance(vec3(forgeLocal.x, forgeH0, forgeLocal.y), uTerrainLodCamera) - terrainNodeB.z) /
    (terrainNodeB.w - terrainNodeB.z),
  0.0, 1.0);
// Odd grid vertices slide onto the even (parent) grid as forgeMorph -> 1.
vec2 forgeFrac = fract(forgeGrid * uTerrainPatchQuads * 0.5) * 2.0 / uTerrainPatchQuads;
forgeLocal = clamp(forgeLocal - forgeFrac * terrainNodeA.z * forgeMorph, vec2(0.0), forgeEdge);
float forgeH = forgeTerrainHeight(forgeLocal, terrainNodeB.xy, forgeSlot);
// Runtime tracks (TERRAIN_DEFORMATION Faz 3): a pure function of world X/Z,
// so shared node edges still meet; the morph above keeps the undented height.
vec2 forgeDisp = forgeDeformDisplacement((modelMatrix * vec4(uTerrainOrigin + vec3(forgeLocal.x, forgeH, forgeLocal.y), 1.0)).xz);
forgeH += forgeDisp.x;
// Skirt vertices (position.y = 1) drop below the surface only on flagged nodes
// and never on the terrain's outer border; otherwise they fold onto the edge.
bool forgeBorder = forgeLocal.x <= 0.0 || forgeLocal.y <= 0.0 || forgeLocal.x >= forgeEdge.x || forgeLocal.y >= forgeEdge.y;
if (position.y > 0.5 && terrainNodeC > 0.5 && !forgeBorder) forgeH -= terrainNodeA.z * uTerrainSkirtRatio;
vec3 transformed = uTerrainOrigin + vec3(forgeLocal.x, forgeH, forgeLocal.y);
vTerrainLocal = forgeLocal;
vTerrainTile = vec4(terrainNodeA.w, terrainNodeB.xy, forgeH);
vTerrainAxisX = normalMatrix * vec3(1.0, 0.0, 0.0);
vTerrainAxisY = normalMatrix * vec3(0.0, 1.0, 0.0);
vTerrainAxisZ = normalMatrix * vec3(0.0, 0.0, 1.0);
`;

/** The lit material's vertex additions: world X/Z for the track lookup. */
const LIT_VERTEX_BEGIN = `${VERTEX_BEGIN}${TERRAIN_DEFORMATION_VERTEX}`;

const FRAGMENT_TERRAIN_PARS = /* glsl */ `
uniform highp sampler2DArray uTerrainNormals;
uniform highp sampler2D uTerrainGlobalNormals;
uniform float uTerrainSpacing;
uniform float uTerrainTileVertices;
uniform vec2 uTerrainGlobalSize;
uniform float uTerrainGlobalSpacing;
varying vec2 vTerrainLocal;
varying vec4 vTerrainTile;
varying vec3 vTerrainAxisX;
varying vec3 vTerrainAxisY;
varying vec3 vTerrainAxisZ;

float forgeTerrainSlot() {
  return floor(vTerrainTile.x + 0.5);
}

// Slot texture UV (slot >= 0) or global map UV (slot < 0).
vec2 forgeTerrainUv() {
  return forgeTerrainSlot() >= 0.0
    ? ((vTerrainLocal - vTerrainTile.yz) / uTerrainSpacing + 0.5) / uTerrainTileVertices
    : (vTerrainLocal / uTerrainGlobalSpacing + 0.5) / uTerrainGlobalSize;
}

bool forgeTerrainHole() {
  return forgeTerrainSlot() < 0.0 && texture(uTerrainGlobalNormals, forgeTerrainUv()).b > 0.5;
}

vec3 forgeTerrainLocalNormal() {
  float slot = forgeTerrainSlot();
  vec2 n = slot >= 0.0
    ? texture(uTerrainNormals, vec3(forgeTerrainUv(), slot)).rg
    : texture(uTerrainGlobalNormals, forgeTerrainUv()).rg;
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
uniform highp sampler2DArray uTerrainGlobalWeights;
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

// The Landscape look: weighted layer colours/textures, or a debug view.
const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec2 forgeUv = forgeTerrainUv();
  float forgeSlotIndex = forgeTerrainSlot();
  float forgeWeightLayer = forgeSlotIndex * ${TERRAIN_WEIGHT_BLOCKS.toFixed(1)};
  vec4 forgeW0 = forgeSlotIndex >= 0.0
    ? texture(uTerrainWeights, vec3(forgeUv, forgeWeightLayer))
    : texture(uTerrainGlobalWeights, vec3(forgeUv, 0.0));
  vec4 forgeW1 = forgeSlotIndex >= 0.0
    ? texture(uTerrainWeights, vec3(forgeUv, forgeWeightLayer + 1.0))
    : texture(uTerrainGlobalWeights, vec3(forgeUv, 1.0));
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
${TERRAIN_DEFORMATION_COLOR}
  diffuseColor.rgb = forgeColor;
}
`;

function injectVertex(shader: WebGLProgramParametersWithUniforms, lit = false): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_PARS}${lit ? TERRAIN_DEFORMATION_VERTEX_PARS : ""}`)
    .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
    .replace("#include <begin_vertex>", lit ? LIT_VERTEX_BEGIN : VERTEX_BEGIN);
}

/** Fragment declarations go before `main`: unlike the vertex shaders, not every
 * fragment shader (`MeshNormalMaterial`'s) includes `<common>`. */
const FRAGMENT_MAIN = "void main() {";

/** Every terrain material discards holes, so the depth/normal passes agree with the lit one. */
function injectFragmentBase(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    FRAGMENT_MAIN,
    `${FRAGMENT_TERRAIN_PARS}\n${FRAGMENT_MAIN}\n  if (forgeTerrainHole()) discard;`,
  );
}

function injectNormal(shader: WebGLProgramParametersWithUniforms): void {
  injectFragmentBase(shader);
  shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", FRAGMENT_NORMAL);
}

function patch(
  material: Material, uniforms: TerrainUniforms, key: string,
  fragment?: (shader: WebGLProgramParametersWithUniforms) => void, lit = false,
): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectVertex(shader, lit);
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
    uTerrainGlobalHeights: { value: inputs.globalHeights },
    uTerrainGlobalNormals: { value: inputs.globalNormals },
    uTerrainGlobalWeights: { value: inputs.globalWeights },
    uTerrainGlobalSize: { value: inputs.globalSize },
    uTerrainGlobalSpacing: { value: inputs.globalSpacing },
    uTerrainOrigin: { value: inputs.origin },
    uTerrainSpacing: { value: inputs.spacing },
    uTerrainTileVertices: { value: inputs.tileVertices },
    uTerrainExtent: { value: inputs.extent },
    uTerrainLodCamera: { value: new Vector3() },
    uTerrainPatchQuads: { value: inputs.patchQuads },
    uTerrainSkirtRatio: { value: TERRAIN_SKIRT_RATIO },
    uTerrainView: { value: VIEW_MODE_INDEX[inputs.viewMode] },
    uTerrainActiveLayer: { value: inputs.activeLayer },
    uTerrainHeightRange: { value: inputs.heightRange },
  };
  layerUniforms(uniforms, inputs.layers);
  // Runtime tracks (TERRAIN_DEFORMATION Faz 2/3): always compiled in; the
  // shared texture's `uDeformActive` skips the block until a runtime module
  // attaches a field, so the editor and track-free levels pay a uniform branch
  // and no texture reads. Every material displaces vertices (the GTAO/DOF
  // passes see the dents); only the lit one tints and tilts normals.
  const deformation = inputs.deformation ?? sharedTerrainDeformation();
  Object.assign(uniforms, deformation.uniforms);
  const litUniforms: TerrainUniforms = {
    ...uniforms,
    ...terrainDeformationLayerUniforms(inputs.layers.map((layer) => layer.physicalMaterial)),
  };

  const material = new MeshStandardMaterial({ color: new Color("#ffffff"), roughness: 1, metalness: 0 });
  patch(material, litUniforms, "forge-terrain-cdlod", (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      FRAGMENT_MAIN, `${FRAGMENT_COLOR_PARS}\n${TERRAIN_DEFORMATION_FRAGMENT_PARS}\n${FRAGMENT_MAIN}`);
    injectNormal(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <color_fragment>", `forgeSampleDeformation();\n${FRAGMENT_COLOR}`)
      .replace("#include <roughnessmap_fragment>", TERRAIN_DEFORMATION_ROUGHNESS)
      .replace("  nonPerturbedNormal = normal;\n}", `  nonPerturbedNormal = normal;\n${TERRAIN_DEFORMATION_NORMAL}}`);
  }, true);
  material.onBeforeRender = (renderer) => deformation.flush(renderer);

  const normalMaterial = new MeshNormalMaterial();
  normalMaterial.blending = NoBlending;
  patch(normalMaterial, uniforms, "forge-terrain-cdlod-normal", injectNormal);

  const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depthMaterial.blending = NoBlending;
  patch(depthMaterial, uniforms, "forge-terrain-cdlod-depth", injectFragmentBase);

  return { material, normalMaterial, depthMaterial, uniforms };
}
