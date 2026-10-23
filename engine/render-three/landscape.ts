import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Camera,
  type Texture,
} from "three";

import type { Vec3 } from "@engine/scene/layout";
import {
  LANDSCAPE_DEFAULT_LAYERS,
  LANDSCAPE_QUADS_PER_CHUNK,
  ensureLandscapeLayers,
  type ForgeLandscapeData,
  type ResolvedLandscape,
} from "@engine/scene/landscape";
import { TERRAIN_RENDER_LAYERS, isCdlodRenderableSize } from "@engine/terrain/terrainRenderData";
import { TerrainRenderer, terrainRendererOf } from "./terrain/terrainRenderer";
import type { TerrainLayerInput } from "./terrain/terrainMaterial";

export {
  DEFAULT_LANDSCAPE_MATERIAL,
  resolveLandscape,
  LANDSCAPE_DEFAULTS,
  LANDSCAPE_DEFAULT_LAYERS,
  uniqueLandscapeId,
  uniqueLandscapeName,
  landscapeSizeForPreset,
  createFlatLandscapeData,
  createLandscapeColliderPrimitive,
  landscapeDataPath,
  ensureLandscapeLayers,
  normalizeLandscapeLayerWeights,
  resampleLandscapeHeightmap,
  landscapeHeightsToGrayscale,
  resampleLandscapeData,
  applyLandscapeSplineDeform,
  applyLandscapeSplinePaint,
  computeLandscapeSplineMeshInstances,
  splineToPolyline,
  landscapeSplineMeshAssetIds,
  LANDSCAPE_MIN_VERTICES,
  LANDSCAPE_MAX_VERTICES,
  LANDSCAPE_QUADS_PER_CHUNK,
  type ResolvedLandscape,
  type ForgeLandscapeData,
  type ForgeLandscapeMaterialDef,
  type LandscapeSize,
  type LandscapeSizePreset,
  type LandscapeLayerWeights,
  type LandscapeDefaultLayer,
  type LandscapeLayerId,
  type ForgeLandscapeSpline,
  type ForgeLandscapeSplinePoint,
  type ForgeLandscapeSplineSegment,
} from "@engine/scene/landscape";

/**
 * Landscape render binding — the web/three counterpart to Unreal's Landscape
 * actor. Faz 1 builds a flat chunked heightfield mesh from the sidecar's
 * `heights` array; the actor's transform (position/rotation) places it in the
 * world (there is no transform scale — terrain size is fixed by the sidecar's
 * `size`). Normals are computed on the CPU from neighboring heights.
 *
 * The mesh is split into `quadsPerChunk`-sized chunk meshes (Faz 1 doesn't
 * dirty-track individual chunks yet — that lands with Faz 2 sculpt — but
 * building chunked from day one avoids a reshape later).
 */

/** The three.js object backing a Landscape actor: one child mesh per chunk. */
export type LandscapeObject = Group;

export interface LandscapeDirtyBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export type LandscapeViewMode = "lit" | "height" | "slope" | "layer";

/** Per-layer color override (layerId → hex), resolved from assigned materials. */
export type LandscapeLayerColors = Record<string, string>;

/**
 * A paint layer's resolved render inputs, aligned to `data.layers` order. The
 * base-color `texture` (when present) is weight-blended across the terrain in
 * "lit" view; `color` is the fallback tint (and the debug/vertex-color look).
 */
export interface LandscapeLayerTexture {
  id: string;
  texture: Texture | null;
  color: string;
  /** UV repeat count across the whole terrain for this layer's texture. */
  tiling: number;
}

/** Resolved settings + world transform + sidecar data the binding needs to build a landscape. */
export interface LandscapeRenderItem extends ResolvedLandscape {
  position: Vec3;
  /** XYZ-order Euler rotation in degrees. */
  rotation: Vec3;
  data: ForgeLandscapeData;
  viewMode?: LandscapeViewMode;
  activeLayerId?: string;
  /** Layer tint overrides (assigned-material base colors); falls back to preset colors. */
  layerColors?: LandscapeLayerColors;
  /** Per-layer base-color textures for weight-blended splat rendering (lit view). */
  layerTextures?: LandscapeLayerTexture[];
}

const DEFAULT_LAYER_COLOR = new Color(LANDSCAPE_DEFAULT_LAYERS[0]!.color);

function heightAt(data: ForgeLandscapeData, x: number, z: number): number {
  const { verticesX, verticesZ } = data.size;
  const cx = Math.min(Math.max(x, 0), verticesX - 1);
  const cz = Math.min(Math.max(z, 0), verticesZ - 1);
  return data.heights[cz * verticesX + cx] ?? 0;
}

function heightRange(data: ForgeLandscapeData): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const height of data.heights) {
    if (!Number.isFinite(height)) continue;
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (Math.abs(max - min) < 0.0001) return { min: min - 0.5, max: max + 0.5 };
  return { min, max };
}

function layerColor(layerId: string, colors?: LandscapeLayerColors): Color {
  const override = colors?.[layerId];
  if (override) return new Color(override);
  const defaults = LANDSCAPE_DEFAULT_LAYERS.find((layer) => layer.id === layerId);
  return new Color(defaults?.color ?? DEFAULT_LAYER_COLOR);
}

function setColor(values: Float32Array, vertexIndex: number, color: Color): void {
  values[vertexIndex * 3] = color.r;
  values[vertexIndex * 3 + 1] = color.g;
  values[vertexIndex * 3 + 2] = color.b;
}

function landscapeVertexColor(
  data: ForgeLandscapeData,
  vertexIndex: number,
  height: number,
  normalY: number,
  viewMode: LandscapeViewMode,
  activeLayerId: string,
  range: { min: number; max: number },
  colors?: LandscapeLayerColors,
): Color {
  if (viewMode === "height") {
    const t = (height - range.min) / Math.max(0.0001, range.max - range.min);
    return new Color().setRGB(0.16 + t * 0.62, 0.28 + t * 0.5, 0.2 + t * 0.68);
  }
  if (viewMode === "slope") {
    const slope = Math.min(1, Math.max(0, 1 - normalY));
    return new Color().setRGB(0.15 + slope * 0.75, 0.62 - slope * 0.34, 0.22 + slope * 0.32);
  }

  if (viewMode === "layer") {
    const layer = data.layers.find((entry) => entry.id === activeLayerId) ?? data.layers[0];
    const weight = Math.min(1, Math.max(0, layer?.weights[vertexIndex] ?? 0));
    return layerColor(layer?.id ?? activeLayerId, colors).multiplyScalar(0.2 + weight * 0.8);
  }

  const color = new Color(0, 0, 0);
  for (const layer of data.layers) {
    const weight = Math.min(1, Math.max(0, layer.weights[vertexIndex] ?? 0));
    if (weight <= 0) continue;
    color.add(layerColor(layer.id, colors).multiplyScalar(weight));
  }
  return color.r + color.g + color.b > 0 ? color : DEFAULT_LAYER_COLOR.clone();
}

/**
 * Builds one chunk's geometry covering vertex range `[x0, x1] x [z0, z1]`
 * (inclusive), with position/normal/uv attributes. Normals sample one vertex
 * of padding beyond the chunk so seams between chunks shade continuously.
 */
function buildChunkGeometry(
  data: ForgeLandscapeData,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  viewMode: LandscapeViewMode,
  activeLayerId: string,
  layerColors?: LandscapeLayerColors,
): BufferGeometry {
  const { spacing, heightScale, verticesX, verticesZ } = data.size;
  const cols = x1 - x0 + 1;
  const rows = z1 - z0 + 1;
  const vertexCount = cols * rows;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  // Per-vertex weight of the first four paint layers (grass/dirt/rock/snow),
  // consumed by the splat material to blend up to four base-color textures.
  const layerWeights = new Float32Array(vertexCount * 4);
  const range = heightRange(data);

  // World-space origin centers the full grid on the actor's position.
  const originX = ((verticesX - 1) * spacing) / 2;
  const originZ = ((verticesZ - 1) * spacing) / 2;

  for (let row = 0; row < rows; row += 1) {
    const z = z0 + row;
    for (let col = 0; col < cols; col += 1) {
      const x = x0 + col;
      const vertexIndex = row * cols + col;
      const height = heightAt(data, x, z) * heightScale;
      positions[vertexIndex * 3] = x * spacing - originX;
      positions[vertexIndex * 3 + 1] = height;
      positions[vertexIndex * 3 + 2] = z * spacing - originZ;

      const left = heightAt(data, x - 1, z) * heightScale;
      const right = heightAt(data, x + 1, z) * heightScale;
      const up = heightAt(data, x, z - 1) * heightScale;
      const down = heightAt(data, x, z + 1) * heightScale;
      const dx = left - right;
      const dz = up - down;
      const length = Math.sqrt(dx * dx + 4 * spacing * spacing + dz * dz) || 1;
      normals[vertexIndex * 3] = dx / length;
      const normalY = (2 * spacing) / length;
      normals[vertexIndex * 3 + 1] = normalY;
      normals[vertexIndex * 3 + 2] = dz / length;

      uvs[vertexIndex * 2] = x / (verticesX - 1);
      uvs[vertexIndex * 2 + 1] = z / (verticesZ - 1);

      const globalVertexIndex = z * verticesX + x;
      setColor(
        colors,
        vertexIndex,
        landscapeVertexColor(
          data,
          globalVertexIndex,
          height,
          normalY,
          viewMode,
          activeLayerId,
          range,
          layerColors,
        ),
      );
      for (let layer = 0; layer < 4; layer += 1) {
        const weight = data.layers[layer]?.weights[globalVertexIndex] ?? 0;
        layerWeights[vertexIndex * 4 + layer] = Math.min(1, Math.max(0, weight));
      }
    }
  }

  const indexCount = (cols - 1) * (rows - 1) * 6;
  const indices = indexCount > 0 ? new Uint32Array(indexCount) : new Uint32Array(0);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("landscapeWeight", new BufferAttribute(layerWeights, 4));
  if (indices.length > 0) geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Builds a MeshStandardMaterial that blends up to four paint-layer base-color
 * textures by the per-vertex `landscapeWeight` attribute, keeping full PBR
 * lighting/shadows. Layers without a texture fall back to their flat color.
 * Used only in "lit" view when at least one layer has a texture; otherwise the
 * plain vertex-color material renders the tint and the debug view modes.
 */
function createLandscapeSplatMaterial(layerTextures: LandscapeLayerTexture[]): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: new Color("#ffffff"), roughness: 1, metalness: 0 });
  material.defines = { ...(material.defines ?? {}), USE_UV: "" };
  const texAt = (index: number): Texture | null => layerTextures[index]?.texture ?? null;
  const colorAt = (index: number): Color =>
    new Color(layerTextures[index]?.color ?? LANDSCAPE_DEFAULT_LAYERS[0]!.color);
  const tilingAt = (index: number): number => Math.max(0.0001, layerTextures[index]?.tiling ?? 1);

  material.onBeforeCompile = (shader) => {
    for (let index = 0; index < 4; index += 1) {
      shader.uniforms[`uLayerTex${index}`] = { value: texAt(index) };
      shader.uniforms[`uLayerColor${index}`] = { value: colorAt(index) };
      shader.uniforms[`uLayerHasTex${index}`] = { value: texAt(index) ? 1 : 0 };
      shader.uniforms[`uLayerTiling${index}`] = { value: tilingAt(index) };
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 landscapeWeight;\nvarying vec4 vLandscapeWeight;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvLandscapeWeight = landscapeWeight;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
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
uniform float uLayerTiling0;
uniform float uLayerTiling1;
uniform float uLayerTiling2;
uniform float uLayerTiling3;
varying vec4 vLandscapeWeight;`,
      )
      // Inlined here (not a helper at <common>) because vUv is only in scope
      // inside main(), after three's <uv_pars_fragment> declares it.
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 forgeC0 = uLayerHasTex0 > 0.5 ? texture2D(uLayerTex0, vUv * uLayerTiling0).rgb : uLayerColor0;
  vec3 forgeC1 = uLayerHasTex1 > 0.5 ? texture2D(uLayerTex1, vUv * uLayerTiling1).rgb : uLayerColor1;
  vec3 forgeC2 = uLayerHasTex2 > 0.5 ? texture2D(uLayerTex2, vUv * uLayerTiling2).rgb : uLayerColor2;
  vec3 forgeC3 = uLayerHasTex3 > 0.5 ? texture2D(uLayerTex3, vUv * uLayerTiling3).rgb : uLayerColor3;
  vec3 forgeAlbedo =
    forgeC0 * vLandscapeWeight.x +
    forgeC1 * vLandscapeWeight.y +
    forgeC2 * vLandscapeWeight.z +
    forgeC3 * vLandscapeWeight.w;
  float forgeWeight = vLandscapeWeight.x + vLandscapeWeight.y + vLandscapeWeight.z + vLandscapeWeight.w;
  diffuseColor.rgb = forgeWeight > 0.0001 ? forgeAlbedo / forgeWeight : uLayerColor0;
}`,
      );
  };
  // Distinguish this program from the plain landscape material in three's cache.
  material.customProgramCacheKey = () => "forge-landscape-splat";
  return material;
}

/** Splits the vertex grid into `quadsPerChunk`-sized chunk meshes under one shared material. */
function buildLandscapeChunkMeshes(
  data: ForgeLandscapeData,
  viewMode: LandscapeViewMode,
  activeLayerId: string,
  colors?: LandscapeLayerColors,
  layerTextures?: LandscapeLayerTexture[],
): Mesh[] {
  const { verticesX, verticesZ } = data.size;
  const quadsPerChunk = Math.max(1, data.chunks?.quadsPerChunk || LANDSCAPE_QUADS_PER_CHUNK);
  ensureLandscapeLayers(data);
  const useSplat = viewMode === "lit" && Boolean(layerTextures?.some((layer) => layer.texture));
  const material = useSplat
    ? createLandscapeSplatMaterial(layerTextures!)
    : new MeshStandardMaterial({
        color: new Color("#ffffff"),
        roughness: 1,
        metalness: 0,
        vertexColors: true,
      });
  const meshes: Mesh[] = [];
  for (let z0 = 0; z0 < verticesZ - 1; z0 += quadsPerChunk) {
    const z1 = Math.min(z0 + quadsPerChunk, verticesZ - 1);
    for (let x0 = 0; x0 < verticesX - 1; x0 += quadsPerChunk) {
      const x1 = Math.min(x0 + quadsPerChunk, verticesX - 1);
      const geometry = buildChunkGeometry(data, x0, x1, z0, z1, viewMode, activeLayerId, colors);
      const mesh = new Mesh(geometry, material);
      mesh.name = "landscape-chunk";
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.landscapeChunk = { x0, x1, z0, z1 } satisfies LandscapeDirtyBounds;
      meshes.push(mesh);
    }
  }
  return meshes;
}

/**
 * Which renderer draws Landscapes. `"cdlod"` (default) uses the GPU terrain
 * renderer for grids it supports and falls back to the chunk mesh otherwise;
 * `"legacy"` forces the chunk mesh (`?terrainRenderer=legacy`, for comparison
 * until the chunk renderer is removed).
 */
export type LandscapeRendererMode = "cdlod" | "legacy";

let rendererMode: LandscapeRendererMode = "cdlod";

export function setLandscapeRendererMode(mode: LandscapeRendererMode): void {
  rendererMode = mode;
}

/** Reads `?terrainRenderer=legacy` from a URL query string. */
export function landscapeRendererModeFromQuery(search: string): LandscapeRendererMode {
  return new URLSearchParams(search).get("terrainRenderer") === "legacy" ? "legacy" : "cdlod";
}

/** Per-layer colour, the legacy vertex-colour rule: override, preset, default. */
function terrainLayerColors(
  data: ForgeLandscapeData,
  colors?: LandscapeLayerColors,
  layerTextures?: LandscapeLayerTexture[],
): string[] {
  return data.layers.slice(0, TERRAIN_RENDER_LAYERS).map((layer, index) =>
    colors?.[layer.id]
      ?? layerTextures?.[index]?.color
      ?? LANDSCAPE_DEFAULT_LAYERS.find((preset) => preset.id === layer.id)?.color
      ?? LANDSCAPE_DEFAULT_LAYERS[0]!.color);
}

function terrainLayerInputs(item: LandscapeRenderItem): TerrainLayerInput[] {
  const worldSize = (item.data.size.verticesX - 1) * item.data.size.spacing;
  const colors = terrainLayerColors(item.data, item.layerColors, item.layerTextures);
  return colors.map((color, index) => {
    const texture = item.layerTextures?.[index];
    // Same repeat as the chunk mesh's `vUv * tiling` over the whole grid.
    return { texture: texture?.texture ?? null, color, scale: (texture?.tiling ?? 1) / worldSize };
  });
}

function terrainActiveLayer(data: ForgeLandscapeData, activeLayerId: string): number {
  const index = data.layers.findIndex((layer) => layer.id === activeLayerId);
  return index >= 0 && index < TERRAIN_RENDER_LAYERS ? index : 0;
}

/** Builds a landscape's chunked mesh group; rebuild required whenever `data` changes shape. */
export function createLandscapeObject(item: LandscapeRenderItem): LandscapeObject {
  const group = new Group();
  group.name = item.name;
  const viewMode = item.viewMode ?? "lit";
  const activeLayerId = item.activeLayerId ?? LANDSCAPE_DEFAULT_LAYERS[0]!.id;
  if (rendererMode === "cdlod" && isCdlodRenderableSize(item.data.size)) {
    ensureLandscapeLayers(item.data);
    const { verticesX, verticesZ, spacing } = item.data.size;
    const terrain = new TerrainRenderer(item.data, {
      viewMode,
      activeLayer: terrainActiveLayer(item.data, activeLayerId),
      layers: terrainLayerInputs(item),
      // The chunk mesh centres the grid on the actor; keep that frame.
      origin: new Vector3(-((verticesX - 1) * spacing) / 2, 0, -((verticesZ - 1) * spacing) / 2),
    });
    group.add(terrain.mesh);
    applyLandscapeTransform(group, item);
    return group;
  }
  for (const mesh of buildLandscapeChunkMeshes(
    item.data,
    viewMode,
    activeLayerId,
    item.layerColors,
    item.layerTextures,
  )) {
    group.add(mesh);
  }
  applyLandscapeTransform(group, item);
  return group;
}

/** Pushes the transform + visibility onto an existing landscape group (no geometry rebuild). */
export function applyLandscapeTransform(object: LandscapeObject, item: LandscapeRenderItem): void {
  object.position.set(item.position[0], item.position[1], item.position[2]);
  object.rotation.set(
    (item.rotation[0] * Math.PI) / 180,
    (item.rotation[1] * Math.PI) / 180,
    (item.rotation[2] * Math.PI) / 180,
    "XYZ",
  );
  object.visible = !item.hidden;
}

function intersectsDirtyBounds(chunk: LandscapeDirtyBounds, dirty: LandscapeDirtyBounds): boolean {
  return (
    chunk.x0 <= dirty.x1 &&
    chunk.x1 >= dirty.x0 &&
    chunk.z0 <= dirty.z1 &&
    chunk.z1 >= dirty.z0
  );
}

/**
 * Rebuilds only the chunk geometries that overlap the edited vertex bounds.
 * Sculpt changes don't alter chunk count/materials, so replacing geometry in
 * place keeps selection and scene ownership stable while avoiding a full actor
 * rebuild for every brush dab.
 */
export function updateLandscapeObjectGeometry(
  object: LandscapeObject,
  data: ForgeLandscapeData,
  dirty: LandscapeDirtyBounds,
  viewMode: LandscapeViewMode = "lit",
  activeLayerId: string = LANDSCAPE_DEFAULT_LAYERS[0]!.id,
  colors?: LandscapeLayerColors,
): void {
  ensureLandscapeLayers(data);
  const terrain = landscapeTerrain(object);
  if (terrain) {
    terrain.updateData(dirty);
    terrain.setAppearance(viewMode, terrainActiveLayer(data, activeLayerId), terrainLayerColors(data, colors));
    return;
  }
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const chunk = child.userData.landscapeChunk as LandscapeDirtyBounds | undefined;
    if (!chunk || !intersectsDirtyBounds(chunk, dirty)) return;
    child.geometry.dispose();
    child.geometry = buildChunkGeometry(
      data,
      chunk.x0,
      chunk.x1,
      chunk.z0,
      chunk.z1,
      viewMode,
      activeLayerId,
      colors,
    );
  });
}

/** The GPU terrain drawing a landscape group, or null for the chunk mesh. */
function landscapeTerrain(object: LandscapeObject): TerrainRenderer | null {
  for (const child of object.children) {
    const terrain = terrainRendererOf(child);
    if (terrain) return terrain;
  }
  return null;
}

/** Re-selects a GPU terrain's LOD for `camera`; a no-op for the chunk mesh. Call once per frame before rendering. */
export function updateLandscapeLod(object: LandscapeObject, camera: Camera): void {
  landscapeTerrain(object)?.updateLod(camera);
}

/** Frees every chunk's geometry + (shared) material under a landscape group. */
export function disposeLandscapeObject(object: LandscapeObject): void {
  const disposedMaterials = new Set<MeshStandardMaterial>();
  landscapeTerrain(object)?.dispose();
  object.traverse((child) => {
    if (terrainRendererOf(child)) return;
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const material = child.material as MeshStandardMaterial;
      if (!disposedMaterials.has(material)) {
        material.dispose();
        disposedMaterials.add(material);
      }
    }
  });
}
