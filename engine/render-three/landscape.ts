import { Group, Mesh, type Material, type Texture } from "three";

import type { Vec3 } from "@engine/scene/layout";
import {
  LANDSCAPE_DEFAULT_LAYERS,
  ensureLandscapeLayers,
  type ForgeLandscapeData,
  type ResolvedLandscape,
} from "@engine/scene/landscape";
import { landscapeRenderSource, writeLandscapeRegion } from "@engine/terrain/terrainRenderSource";

import type { TerrainLayerLook, TerrainLook } from "./terrain/terrainMaterial";
import { TerrainRenderer } from "./terrain/terrainRenderer";

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
 * actor. Since OPEN_WORLD_PLAN Faz 2 the surface is drawn by the GPU CDLOD
 * {@link TerrainRenderer}: the sidecar's grid becomes a padded 1×1 terrain tile
 * (`landscapeRenderSource`), displaced in the vertex shader, LOD-selected per
 * camera and raycast on the CPU heightfield. The actor's transform
 * (position/rotation) places the group; there is no transform scale — terrain
 * size is fixed by the sidecar's `size`.
 *
 * The group stays an ordinary `Group`, so callers keep parenting spline meshes
 * and overlays under it and tagging `userData` on it.
 */

/** The three.js object backing a Landscape actor: a group holding the terrain mesh. */
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

interface LandscapeBinding {
  terrain: TerrainRenderer;
  layerTextures: LandscapeLayerTexture[] | undefined;
}

const bindings = new WeakMap<LandscapeObject, LandscapeBinding>();

const DEFAULT_LAYER_COLOR = LANDSCAPE_DEFAULT_LAYERS[0]!.color;

function presetLayerColor(layerId: string, colors?: LandscapeLayerColors): string {
  return colors?.[layerId] ?? LANDSCAPE_DEFAULT_LAYERS.find((layer) => layer.id === layerId)?.color ?? DEFAULT_LAYER_COLOR;
}

/**
 * The chunk renderer's two looks, as one: with a layer texture in "lit" view the
 * splat tints come from `layerTextures` (by index); otherwise each layer shows
 * its assigned-material/preset colour (by id).
 */
function landscapeLook(
  data: ForgeLandscapeData,
  viewMode: LandscapeViewMode,
  activeLayerId: string,
  colors: LandscapeLayerColors | undefined,
  layerTextures: LandscapeLayerTexture[] | undefined,
): TerrainLook {
  const splat = viewMode === "lit" && Boolean(layerTextures?.some((layer) => layer.texture));
  const layers = data.layers.map((layer, index): TerrainLayerLook => {
    const textured = layerTextures?.[index];
    return {
      color: splat ? textured?.color ?? DEFAULT_LAYER_COLOR : presetLayerColor(layer.id, colors),
      texture: splat ? textured?.texture ?? null : null,
      tiling: textured?.tiling ?? 1,
    };
  });
  const active = data.layers.findIndex((layer) => layer.id === activeLayerId);
  return { viewMode, layers, activeLayer: Math.max(0, active), defaultColor: DEFAULT_LAYER_COLOR };
}

function createLandscapeTerrain(item: LandscapeRenderItem): TerrainRenderer {
  ensureLandscapeLayers(item.data);
  return new TerrainRenderer(
    landscapeRenderSource(item.data),
    landscapeLook(
      item.data,
      item.viewMode ?? "lit",
      item.activeLayerId ?? LANDSCAPE_DEFAULT_LAYERS[0]!.id,
      item.layerColors,
      item.layerTextures,
    ),
  );
}

/** Builds a landscape's terrain group; rebuild required whenever `data` changes shape. */
export function createLandscapeObject(item: LandscapeRenderItem): LandscapeObject {
  const group = new Group();
  group.name = item.name;
  const terrain = createLandscapeTerrain(item);
  group.add(terrain.mesh);
  bindings.set(group, { terrain, layerTextures: item.layerTextures });
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

/**
 * Re-sends the edited vertex bounds to the GPU (a sub-rectangle copy and one
 * texture-layer upload, no geometry rebuild) and applies the current view
 * mode / active layer / tints. A grid that changed shape gets a new terrain mesh
 * in the same group, keeping selection and scene ownership stable.
 */
export function updateLandscapeObjectGeometry(
  object: LandscapeObject,
  data: ForgeLandscapeData,
  dirty: LandscapeDirtyBounds,
  viewMode: LandscapeViewMode = "lit",
  activeLayerId: string = LANDSCAPE_DEFAULT_LAYERS[0]!.id,
  colors?: LandscapeLayerColors,
): void {
  const binding = bindings.get(object);
  if (!binding) return;
  ensureLandscapeLayers(data);
  const look = landscapeLook(data, viewMode, activeLayerId, colors, binding.layerTextures);
  const grid = binding.terrain.source.legacyGrid;
  if (!grid || grid.verticesX !== data.size.verticesX || grid.verticesZ !== data.size.verticesZ
    || binding.terrain.source.layerCount !== Math.min(data.layers.length, 8)) {
    const previous = binding.terrain;
    const terrain = new TerrainRenderer(landscapeRenderSource(data), look);
    terrain.mesh.userData = { ...previous.mesh.userData, forgeTerrain: terrain };
    terrain.material.wireframe = previous.material.wireframe;
    object.remove(previous.mesh);
    previous.dispose();
    object.add(terrain.mesh);
    binding.terrain = terrain;
    return;
  }
  const rect = writeLandscapeRegion(binding.terrain.source, data, dirty);
  binding.terrain.updateTile(0, 0, rect);
  binding.terrain.setLook(look);
}

/** The GPU terrain behind a landscape group (debug readouts, tests). */
export function landscapeTerrainRenderer(object: LandscapeObject): TerrainRenderer | null {
  return bindings.get(object)?.terrain ?? null;
}

/**
 * Frees the terrain's GPU resources, plus — as before the GPU renderer — the
 * geometry and materials of meshes callers parented under the group.
 */
export function disposeLandscapeObject(object: LandscapeObject): void {
  const binding = bindings.get(object);
  const disposedMaterials = new Set<Material>();
  object.traverse((child) => {
    if (!(child instanceof Mesh) || child === binding?.terrain.mesh) return;
    child.geometry.dispose();
    const materials: Material[] = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (disposedMaterials.has(material)) continue;
      material.dispose();
      disposedMaterials.add(material);
    }
  });
  binding?.terrain.dispose();
  bindings.delete(object);
}
