import { Group, Mesh, Vector3, type Camera, type DirectionalLight, type Material, type Texture } from "three";

import type { Vec3 } from "@engine/scene/layout";
import { LANDSCAPE_DEFAULT_LAYERS, type ResolvedLandscape } from "@engine/scene/landscape";
import { TERRAIN_RENDER_LAYERS } from "@engine/terrain/terrainRenderData";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { worldTerrainRenderSource } from "@engine/terrain/terrainRenderSource";
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
  resampleLandscapeHeightmap,
  computeLandscapeSplineMeshInstances,
  splineToPolyline,
  landscapeSplineMeshAssetIds,
  type ResolvedLandscape,
  type ForgeLandscapeMaterialDef,
  type LandscapeSize,
  type LandscapeSizePreset,
  type LandscapeDefaultLayer,
  type LandscapeLayerId,
  type ForgeLandscapeSpline,
  type ForgeLandscapeSplinePoint,
  type ForgeLandscapeSplineSegment,
} from "@engine/scene/landscape";

/**
 * Landscape render binding — the web/three counterpart to Unreal's Landscape
 * actor. Its World Terrain tiles are drawn by the GPU CDLOD terrain renderer
 * (`./terrain/terrainRenderer.ts`, OPEN_WORLD_PLAN Faz 2); the definition's
 * origin places it in the world, unrotated.
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
  textureScale?: number;
  normalTexture?: Texture | null;
  roughness?: number;
  roughnessInAlpha?: boolean;
  id: string;
  texture: Texture | null;
  color: string;
  /** UV repeat count across the whole terrain for this layer's texture. */
  tiling: number;
}

/** A World Terrain actor's render inputs: the tiles are drawn as they are, with no editing adapter. */
export interface WorldTerrainRenderItem extends ResolvedLandscape {
  terrainRef?: string;
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
  layers: readonly { id: string; color?: string; physicalMaterial?: string | null; physicalMaterialOverrides?: import("../terrain/terrainPhysicalMaterial").TerrainPhysicalMaterialOverrides }[],
  worldSize: number,
  layerColors?: LandscapeLayerColors,
  layerTextures?: LandscapeLayerTexture[],
): TerrainLayerInput[] {
  const colors = terrainLayerColors(layers, layerColors, layerTextures);
  return colors.map((color, index) => {
    const texture = layerTextures?.[index];
    // `tiling` repeats across the grid's X width, from its min corner.
    return {
      texture: texture?.texture ?? null, color, scale: texture?.textureScale ?? (texture?.tiling ?? 1) / worldSize,
      normalTexture: texture?.normalTexture ?? null,
      physicalMaterial: layers[index]?.physicalMaterial ?? null,
      ...(layers[index]?.physicalMaterialOverrides ? { physicalMaterialOverrides: layers[index]!.physicalMaterialOverrides } : {}),
      roughness: texture?.roughness ?? 1,
      roughnessInAlpha: texture?.roughnessInAlpha ?? false,
    };
  });
}

function terrainActiveLayer(layers: readonly { id: string }[], activeLayerId: string): number {
  const index = layers.findIndex((layer) => layer.id === activeLayerId);
  return index >= 0 && index < TERRAIN_RENDER_LAYERS ? index : 0;
}

/**
 * Builds a World Terrain's group: the group sits at the grid centre (`worldTerrainActorPosition`,
 * so `def.origin` is the world position of tile (0, 0)'s min corner) and is
 * never rotated. Edits go through `updateWorldTerrainObjectTiles`.
 */
export function createWorldTerrainObject(item: WorldTerrainRenderItem): LandscapeObject {
  const { def, tiles } = item.document;
  const group = new Group();
  group.name = item.name;
  const [width, depth] = worldTerrainExtent(def);
  const terrain = new TerrainRenderer(worldTerrainRenderSource(def, tiles, item.document.globalAttributes), {
    ...(item.terrainRef ? { terrainRef: item.terrainRef } : {}),
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
  item: { position: Vec3; rotation: Vec3; hidden?: boolean },
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

/**
 * Re-selects the terrain's LOD for `camera`. Call once per frame before
 * rendering, after the frame's shadow fit; `shadowLights` are the lights whose
 * shadow maps the terrain may cast into (their frusta join the node cull).
 */
export function updateLandscapeLod(object: LandscapeObject, camera: Camera, shadowLights: readonly DirectionalLight[] = []): void {
  landscapeTerrain(object)?.updateLod(camera, shadowLights);
}

/** Frees the terrain and every other mesh (spline meshes) under a landscape group. */
export function disposeLandscapeObject(object: LandscapeObject): void {
  const disposedMaterials = new Set<Material>();
  landscapeTerrain(object)?.dispose();
  object.traverse((child) => {
    if (terrainRendererOf(child) || !(child instanceof Mesh)) return;
    if (child.userData.landscapeSplineMesh) {
      if (child.userData.landscapeSplineGeometry) child.geometry.dispose();
      return;
    }
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (disposedMaterials.has(material)) continue;
      material.dispose();
      disposedMaterials.add(material);
    }
  });
}
