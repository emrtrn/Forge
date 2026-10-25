import { Group, Mesh, Vector3, type Camera, type Material, type Texture } from "three";

import type { Vec3 } from "@engine/scene/layout";
import {
  LANDSCAPE_DEFAULT_LAYERS,
  ensureLandscapeLayers,
  type ForgeLandscapeData,
  type ResolvedLandscape,
} from "@engine/scene/landscape";
import { TERRAIN_RENDER_LAYERS } from "@engine/terrain/terrainRenderData";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { landscapeRenderSource, worldTerrainRenderSource, type LandscapeRenderSource } from "@engine/terrain/terrainRenderSource";
import { tileKey } from "@engine/terrain/terrainTypes";
import { worldTerrainActorPosition, worldTerrainExtent } from "@engine/terrain/worldTerrainActor";
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
  createLandscapeHeightfieldPrimitive,
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
 * actor. The sidecar's height/weight grid is drawn by the GPU CDLOD terrain
 * renderer (`./terrain/terrainRenderer.ts`, OPEN_WORLD_PLAN Faz 2); the actor's
 * transform (position/rotation) places it in the world (there is no transform
 * scale — terrain size is fixed by the sidecar's `size`), with the grid centred
 * on the actor.
 */

/** The three.js object backing a Landscape actor: a group holding the terrain mesh (plus spline meshes). */
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
 * "lit" view; `color` is the fallback tint (and the debug-view look).
 */
export interface LandscapeLayerTexture {
  roughness?: number;
  roughnessInAlpha?: boolean;
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

/** A World Terrain actor's render inputs: the tiles are drawn as they are, with no editing adapter. */
export interface WorldTerrainRenderItem extends ResolvedLandscape {
  document: WorldTerrainDocument;
  viewMode?: LandscapeViewMode;
  activeLayerId?: string;
  layerColors?: LandscapeLayerColors;
  /** Aligned to `document.def.layers`; `tiling` repeats across the whole grid's X width. */
  layerTextures?: LandscapeLayerTexture[];
}

/** Per-layer colour: material override, then the layer's own tint, then the preset swatch for that layer id. */
function terrainLayerColors(
  layers: readonly { id: string; color?: string }[],
  colors?: LandscapeLayerColors,
  layerTextures?: LandscapeLayerTexture[],
): string[] {
  return layers.slice(0, TERRAIN_RENDER_LAYERS).map((layer, index) =>
    colors?.[layer.id]
      ?? layerTextures?.[index]?.color
      ?? layer.color
      ?? LANDSCAPE_DEFAULT_LAYERS.find((preset) => preset.id === layer.id)?.color
      ?? LANDSCAPE_DEFAULT_LAYERS[0]!.color);
}

function terrainLayerInputs(
  layers: readonly { id: string; color?: string; physicalMaterial?: string | null }[],
  worldSize: number,
  layerColors?: LandscapeLayerColors,
  layerTextures?: LandscapeLayerTexture[],
): TerrainLayerInput[] {
  const colors = terrainLayerColors(layers, layerColors, layerTextures);
  return colors.map((color, index) => {
    const texture = layerTextures?.[index];
    // `tiling` repeats across the grid's X width, from its min corner.
    return {
      texture: texture?.texture ?? null, color, scale: (texture?.tiling ?? 1) / worldSize,
      physicalMaterial: layers[index]?.physicalMaterial ?? null,
      roughness: texture?.roughness ?? 1,
      roughnessInAlpha: texture?.roughnessInAlpha ?? false,
    };
  });
}

function terrainActiveLayer(layers: readonly { id: string }[], activeLayerId: string): number {
  const index = layers.findIndex((layer) => layer.id === activeLayerId);
  return index >= 0 && index < TERRAIN_RENDER_LAYERS ? index : 0;
}

/** Each Landscape's one-tile render source, re-read after sculpt/paint. */
const landscapeSources = new WeakMap<TerrainRenderer, LandscapeRenderSource>();

/** Builds a landscape's terrain group; rebuild required whenever `data` changes shape. */
export function createLandscapeObject(item: LandscapeRenderItem): LandscapeObject {
  const group = new Group();
  group.name = item.name;
  ensureLandscapeLayers(item.data);
  const { verticesX, verticesZ, spacing } = item.data.size;
  const source = landscapeRenderSource(item.data);
  const terrain = new TerrainRenderer(source, {
    viewMode: item.viewMode ?? "lit",
    activeLayer: terrainActiveLayer(item.data.layers, item.activeLayerId ?? LANDSCAPE_DEFAULT_LAYERS[0]!.id),
    layers: terrainLayerInputs(item.data.layers, (verticesX - 1) * spacing, item.layerColors, item.layerTextures),
    // The grid is centred on the actor (the collider uses the same frame).
    origin: new Vector3(-((verticesX - 1) * spacing) / 2, 0, -((verticesZ - 1) * spacing) / 2),
  });
  landscapeSources.set(terrain, source);
  group.add(terrain.mesh);
  applyLandscapeTransform(group, item);
  return group;
}

/**
 * Builds a multi-tile World Terrain's group, in the same frame as a 1×1
 * Landscape: the group sits at the grid centre (`worldTerrainActorPosition`,
 * so `def.origin` is the world position of tile (0, 0)'s min corner) and is
 * never rotated. Edits go through `updateWorldTerrainObjectTiles`.
 */
export function createWorldTerrainObject(item: WorldTerrainRenderItem): LandscapeObject {
  const { def, tiles } = item.document;
  const group = new Group();
  group.name = item.name;
  const [width, depth] = worldTerrainExtent(def);
  const terrain = new TerrainRenderer(worldTerrainRenderSource(def, tiles, item.document.globalAttributes), {
    viewMode: item.viewMode ?? "lit",
    activeLayer: terrainActiveLayer(def.layers, item.activeLayerId ?? LANDSCAPE_DEFAULT_LAYERS[0]!.id),
    layers: terrainLayerInputs(def.layers, width, item.layerColors, item.layerTextures),
    origin: new Vector3(-width / 2, 0, -depth / 2),
  });
  group.add(terrain.mesh);
  applyLandscapeTransform(group, { position: worldTerrainActorPosition(def), rotation: [0, 0, 0], hidden: item.hidden });
  return group;
}

/** Pushes the transform + visibility onto an existing landscape group (no geometry rebuild). */
export function applyLandscapeTransform(
  object: LandscapeObject,
  item: Pick<LandscapeRenderItem, "position" | "rotation" | "hidden">,
): void {
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
 * Re-reads the edited vertex bounds into the terrain textures and refreshes the
 * debug-view uniforms. Sculpt/paint never change the grid size, so this keeps
 * selection and scene ownership stable instead of rebuilding the actor per dab.
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
  const source = terrain ? landscapeSources.get(terrain) : undefined;
  if (!terrain || !source) return;
  terrain.updateTile(tileKey(0, 0), source.refresh(dirty));
  terrain.setAppearance(viewMode, terrainActiveLayer(data.layers, activeLayerId), terrainLayerColors(data.layers, colors));
}

/**
 * Re-reads edited World Terrain tiles (tile-local inclusive vertex rectangles,
 * as `applyTerrainBrush` reports them). The group draws the same tile objects
 * the editor edits, so this only refreshes textures, bounds and picking.
 */
export function updateWorldTerrainObjectTiles(object: LandscapeObject, dirty: ReadonlyMap<string, LandscapeDirtyBounds>): void {
  const terrain = landscapeTerrain(object);
  if (!terrain) return;
  for (const [key, rect] of dirty) terrain.updateTile(key, rect);
}

/** A World Terrain tile entered or left the edit world (editor streaming). */
export function refreshWorldTerrainObjectTile(object: LandscapeObject, key: string): void {
  landscapeTerrain(object)?.refreshTile(key);
}

/** Debug view, active layer and layer colours of a World Terrain group; no texture work. */
export function updateWorldTerrainAppearance(
  object: LandscapeObject,
  layers: readonly { id: string; color?: string }[],
  viewMode: LandscapeViewMode = "lit",
  activeLayerId: string = LANDSCAPE_DEFAULT_LAYERS[0]!.id,
  colors?: LandscapeLayerColors,
): void {
  landscapeTerrain(object)?.setAppearance(viewMode, terrainActiveLayer(layers, activeLayerId), terrainLayerColors(layers, colors));
}

/**
 * Texture units the costliest lit terrain among `objects` takes for itself
 * (0 without terrain): what the sun's shadow cascades are budgeted against.
 */
export function landscapeLitFragmentSamplers(objects: Iterable<LandscapeObject>): number {
  let most = 0;
  for (const object of objects) most = Math.max(most, landscapeTerrain(object)?.litFragmentSamplers ?? 0);
  return most;
}

/** The GPU terrain drawing a landscape group. */
function landscapeTerrain(object: LandscapeObject): TerrainRenderer | null {
  for (const child of object.children) {
    const terrain = terrainRendererOf(child);
    if (terrain) return terrain;
  }
  return null;
}

/** Re-selects the terrain's LOD for `camera`. Call once per frame before rendering. */
export function updateLandscapeLod(object: LandscapeObject, camera: Camera): void {
  landscapeTerrain(object)?.updateLod(camera);
}

/** Frees the terrain and every other mesh (spline meshes) under a landscape group. */
export function disposeLandscapeObject(object: LandscapeObject): void {
  const disposedMaterials = new Set<Material>();
  landscapeTerrain(object)?.dispose();
  object.traverse((child) => {
    if (terrainRendererOf(child) || !(child instanceof Mesh)) return;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (disposedMaterials.has(material)) continue;
      material.dispose();
      disposedMaterials.add(material);
    }
  });
}
