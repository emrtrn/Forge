import {
  LANDSCAPE_DEFAULT_LAYERS,
  resampleLandscapeData,
  type ForgeLandscapeData,
  type ForgeLandscapeSpline,
} from "../scene/landscape";
import type { LayoutLandscape } from "../scene/layout";
import {
  TERRAIN_DEFAULT_HEIGHT_MAX,
  TERRAIN_DEFAULT_HEIGHT_MIN,
  TERRAIN_LAYERS_PER_WEIGHT_BLOCK,
  TERRAIN_MAX_LAYERS,
  TERRAIN_MAX_TILE_QUADS,
  TERRAIN_MIN_TILE_QUADS,
  TERRAIN_SCHEMA,
  isValidTileQuads,
  terrainTileHeightRange,
  terrainWeightBlockCount,
  tileKey,
  type TerrainTileData,
  type WorldTerrainDef,
} from "./terrainTypes";

/**
 * Legacy single Landscape → 1×1 World Terrain (OPEN_WORLD_PLAN K1: one terrain
 * path). The legacy grid is centred on the actor; the terrain's origin is its
 * min corner, so the converted surface lands on exactly the same world
 * positions. `heightScale` is folded into the heights.
 *
 * Shapes a tile cannot hold are adapted, never silently: a non-power-of-two
 * grid is resampled up to the next valid tile size (footprint preserved), a
 * non-square grid is resampled to square (its Z footprint follows X), and a
 * rotation is dropped — the terrain is world-aligned. Each adaptation is
 * reported in `warnings`.
 */

export interface LegacyLandscapeConversion {
  def: WorldTerrainDef;
  tile: TerrainTileData;
  /** Landscape-local splines, carried unchanged until world-space splines (Faz 8). */
  splines: ForgeLandscapeSpline[];
  warnings: string[];
}

/** Headroom kept around legacy relief so a first sculpt stroke does not clip. */
const LEGACY_HEIGHT_PADDING = 16;

function nextValidTileQuads(quads: number): number {
  let value = TERRAIN_MIN_TILE_QUADS;
  while (value < quads && value < TERRAIN_MAX_TILE_QUADS) value *= 2;
  return value;
}

function legacyLayerColor(id: string): string {
  return LANDSCAPE_DEFAULT_LAYERS.find((layer) => layer.id === id)?.color ?? LANDSCAPE_DEFAULT_LAYERS[0]!.color;
}

export function legacyLandscapeToWorldTerrain(actor: LayoutLandscape, source: ForgeLandscapeData): LegacyLandscapeConversion {
  const warnings: string[] = [];
  const label = actor.name ?? actor.id;
  let data = source;
  const { verticesX, verticesZ } = source.size;
  if (verticesX !== verticesZ) {
    warnings.push(`${label}: non-square ${verticesX}×${verticesZ} grid resampled to square; its depth now matches its width.`);
  }
  const quads = Math.max(verticesX, verticesZ) - 1;
  const tileQuads = isValidTileQuads(quads) ? quads : nextValidTileQuads(quads);
  if (tileQuads !== quads) {
    warnings.push(`${label}: ${quads}-quad grid resampled to ${tileQuads} quads (power-of-two tile).`);
  }
  if (verticesX !== verticesZ || tileQuads !== quads) {
    data = resampleLandscapeData(source, { verticesX: tileQuads + 1, verticesZ: tileQuads + 1 });
  }
  const rotation = actor.rotation ?? [0, 0, 0];
  if (rotation.some((axis) => Math.abs(axis) > 1e-6)) {
    warnings.push(`${label}: rotation [${rotation.join(", ")}] dropped; World Terrain is world-aligned.`);
  }

  const size = tileQuads + 1;
  const count = size * size;
  const heightScale = data.size.heightScale;
  const heights = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const height = (data.heights[index] ?? 0) * heightScale;
    heights[index] = Number.isFinite(height) ? height : 0;
  }

  const layers = data.layers.slice(0, TERRAIN_MAX_LAYERS);
  if (data.layers.length > TERRAIN_MAX_LAYERS) {
    warnings.push(`${label}: ${data.layers.length} paint layers truncated to ${TERRAIN_MAX_LAYERS}.`);
  }
  const weights = new Uint8Array(terrainWeightBlockCount(layers.length) * count * 4);
  layers.forEach((layer, layerIndex) => {
    const base = Math.floor(layerIndex / TERRAIN_LAYERS_PER_WEIGHT_BLOCK) * count * 4 + (layerIndex % TERRAIN_LAYERS_PER_WEIGHT_BLOCK);
    for (let index = 0; index < count; index += 1) {
      const weight = layer.weights[index] ?? 0;
      weights[base + index * 4] = Math.round(Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0)) * 255);
    }
  });

  const tile: TerrainTileData = { x: 0, z: 0, size, heights, layerCount: layers.length, weights };
  const range = terrainTileHeightRange(tile);
  const half = (tileQuads * data.size.spacing) / 2;
  const def: WorldTerrainDef = {
    schema: TERRAIN_SCHEMA,
    type: "worldTerrain",
    name: label,
    tileQuads,
    spacing: data.size.spacing,
    tilesX: 1,
    tilesZ: 1,
    origin: [actor.position[0] - half, actor.position[1], actor.position[2] - half],
    heightMin: Math.min(TERRAIN_DEFAULT_HEIGHT_MIN, Math.floor(range.min - LEGACY_HEIGHT_PADDING)),
    heightMax: Math.max(TERRAIN_DEFAULT_HEIGHT_MAX, Math.ceil(range.max + LEGACY_HEIGHT_PADDING)),
    layers: layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      color: legacyLayerColor(layer.id),
      ...(layer.material ? { material: layer.material } : {}),
    })),
    tiles: [{ key: tileKey(0, 0), minHeight: range.min, maxHeight: range.max }],
    collision: actor.collision ?? true,
  };
  return { def, tile, splines: data.splines ?? [], warnings };
}
