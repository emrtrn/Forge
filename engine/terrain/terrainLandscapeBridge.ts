import { LANDSCAPE_QUADS_PER_CHUNK, type ForgeLandscapeData } from "../scene/landscape";
import type { LayoutLandscape } from "../scene/layout";
import { legacyLandscapeToWorldTerrain } from "./terrainLegacy";
import { encodeTerrainGlobalMap } from "./terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "./terrainRenderSource";
import { type WorldTerrainDocument } from "./terrainLoader";
import { encodeTerrainTile } from "./terrainTileCodec";
import { createTerrainEditWorld, type TerrainDirtyRect, type TerrainEditWorld, type TerrainPatchValues } from "./terrainEdit";
import {
  TERRAIN_MAX_LAYERS,
  isValidTileQuads,
  isWorldTerrainPath,
  terrainTileLayerWeight,
  terrainWeightBlockCount,
  type WorldTerrainDef,
} from "./terrainTypes";
import { isMultiTileTerrain } from "./worldTerrainActor";

const sourceDefinitions = new WeakMap<ForgeLandscapeData, WorldTerrainDef>();

export function acknowledgeTerrainSnapshot(data: ForgeLandscapeData, def: WorldTerrainDef): void {
  sourceDefinitions.set(data, def);
}

/** Transform/collision edits live on the actor but also affect the world-space definition. */
export function terrainTransformNeedsSave(actor: LayoutLandscape, data: ForgeLandscapeData): boolean {
  const def = sourceDefinitions.get(data);
  if (!def) return false;
  const half = (data.size.verticesX - 1) * data.size.spacing / 2;
  return def.origin[0] !== actor.position[0] - half || def.origin[1] !== actor.position[1] ||
    def.origin[2] !== actor.position[2] - half || def.collision !== (actor.collision ?? true);
}

export function migratedTerrainPath(path: string): string {
  if (isWorldTerrainPath(path)) return path;
  if (!path.endsWith(".landscape.json")) throw new Error("legacy terrain path must end with .landscape.json");
  return path.slice(0, -".landscape.json".length) + ".terrain.json";
}

/**
 * The 1×1 editing adapter. A multi-tile World Terrain never comes through here:
 * it is drawn from and edited on its tiles (`worldTerrainActor.ts`,
 * `terrainEdit.ts`), so this refuses rather than flattening or discarding tiles.
 */
export function terrainDocumentToLandscape({ def, tiles }: WorldTerrainDocument): ForgeLandscapeData {
  if (isMultiTileTerrain(def) || !tiles.has("0_0")) {
    throw new Error("Multi-tile terrain cannot use the 1x1 Landscape editing adapter (OPEN_WORLD_PLAN Phase 2); refusing to flatten or discard tiles");
  }
  const tile = tiles.get("0_0")!;
  const data: ForgeLandscapeData = {
    schema: 1, type: "landscape",
    size: { verticesX: tile.size, verticesZ: tile.size, spacing: def.spacing, heightScale: 1 },
    chunks: { quadsPerChunk: LANDSCAPE_QUADS_PER_CHUNK },
    heights: Array.from(tile.heights),
    layers: def.layers.map((layer, index) => ({
      id: layer.id, name: layer.name, ...(layer.material === undefined ? {} : { material: layer.material }),
      ...(layer.physicalMaterial ? { physicalMaterial: layer.physicalMaterial } : {}),
      weights: Array.from(tile.heights, (_height, vertex) => terrainTileLayerWeight(tile, index, vertex)),
    })),
    ...(def.splines === undefined ? {} : { splines: structuredClone(def.splines) }),
  };
  sourceDefinitions.set(data, def);
  return data;
}

export interface TerrainSaveSnapshot {
  path: string;
  def: WorldTerrainDef;
  bytes: Uint8Array;
  global: Uint8Array;
}

/** Capture before the first await. Float heights preserve existing collider vertex positions. */
export function captureTerrainSnapshot(actor: LayoutLandscape, data: ForgeLandscapeData): TerrainSaveSnapshot {
  const converted = legacyLandscapeToWorldTerrain(actor, data);
  if (converted.warnings.length) {
    throw new Error(`Terrain migration requires explicit adaptation: ${converted.warnings.join(" ")}`);
  }
  const def = converted.def;
  const previous = sourceDefinitions.get(data);
  if (previous) {
    def.heightMin = Math.min(previous.heightMin, def.tiles[0]!.minHeight - 1);
    def.heightMax = Math.max(previous.heightMax, def.tiles[0]!.maxHeight + 1);
    for (const layer of def.layers) layer.color = previous.layers.find((entry) => entry.id === layer.id)?.color ?? layer.color;
  }
  return {
    path: migratedTerrainPath(actor.dataRef), def,
    bytes: encodeTerrainTile(converted.tile, { heightMin: def.heightMin, heightMax: def.heightMax, heightFormat: "f32" }),
    global: encodeTerrainGlobalMap(def, buildTerrainGlobalAttributes(worldTerrainRenderSource(def, new Map([["0_0", converted.tile]])))),
  };
}

/**
 * Why a 1×1 Landscape grid cannot be sculpted or painted through the shared
 * tile editor (`terrainEdit`); empty when it can. Only a legacy sidecar the
 * migration would have to resample reaches the editor in such a shape.
 */
export function landscapeEditIssues(data: ForgeLandscapeData): string[] {
  const { verticesX, verticesZ, heightScale } = data.size;
  const issues: string[] = [];
  if (verticesX !== verticesZ) issues.push(`non-square ${verticesX}×${verticesZ} grid`);
  else if (!isValidTileQuads(verticesX - 1)) issues.push(`${verticesX - 1}-quad grid is not a power-of-two tile`);
  if (!(heightScale > 0) || !Number.isFinite(heightScale)) issues.push(`invalid height scale ${heightScale}`);
  if (data.layers.length > TERRAIN_MAX_LAYERS) issues.push(`${data.layers.length} paint layers (at most ${TERRAIN_MAX_LAYERS})`);
  return issues;
}

/**
 * A 1×1 Landscape grid as a one-tile edit world in the actor's local frame:
 * the origin is the grid's min corner, Y is local height in metres
 * (`heightScale` folded in), so a rotated or moved actor edits the same way.
 * Weights quantize to RGBA8 exactly as the terrain save does.
 */
export function landscapeEditWorld(data: ForgeLandscapeData): TerrainEditWorld {
  const issues = landscapeEditIssues(data);
  if (issues.length > 0) throw new Error(`Landscape grid is not editable as a terrain tile: ${issues.join("; ")}`);
  const { def, tile } = legacyLandscapeToWorldTerrain({ id: "landscape", position: [0, 0, 0], dataRef: "" }, data);
  return createTerrainEditWorld(def, [tile]);
}

/**
 * Reads one rectangle of a 1×1 grid as tile patch values (metres, RGBA8
 * rounded as the terrain save rounds them), so an operation that still runs on
 * the grid itself (spline deform/paint) can keep a rectangle-sized undo.
 */
export function landscapeGridPatchValues(data: ForgeLandscapeData, rect: TerrainDirtyRect): TerrainPatchValues {
  const { verticesX, heightScale } = data.size;
  const width = rect.x1 - rect.x0 + 1;
  const count = width * (rect.z1 - rect.z0 + 1);
  const heights = new Float32Array(count);
  const weights = new Uint8Array(terrainWeightBlockCount(data.layers.length) * count * 4);
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      const target = (z - rect.z0) * width + x - rect.x0;
      const source = z * verticesX + x;
      heights[target] = (data.heights[source] ?? 0) * heightScale;
      data.layers.forEach((layer, index) => {
        const weight = layer.weights[source] ?? 0;
        weights[Math.floor(index / 4) * count * 4 + target * 4 + index % 4] = Math.round(Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0)) * 255);
      });
    }
  }
  return { heights, weights };
}

/**
 * Writes one tile rectangle (an undo patch side, or a dab's result) back into
 * the 1×1 grid that `landscapeEditWorld` was built from.
 */
export function writeTerrainPatchToLandscape(data: ForgeLandscapeData, rect: TerrainDirtyRect, values: TerrainPatchValues): void {
  const { verticesX, heightScale } = data.size;
  const width = rect.x1 - rect.x0 + 1;
  const count = width * (rect.z1 - rect.z0 + 1);
  const blocks = terrainWeightBlockCount(data.layers.length);
  if (values.heights.length !== count || values.weights.length !== blocks * count * 4) {
    throw new Error("Terrain patch does not match the Landscape grid");
  }
  for (let z = rect.z0; z <= rect.z1; z += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      const source = (z - rect.z0) * width + x - rect.x0;
      const target = z * verticesX + x;
      data.heights[target] = values.heights[source]! / heightScale;
      data.layers.forEach((layer, index) => {
        layer.weights[target] = values.weights[Math.floor(index / 4) * count * 4 + source * 4 + index % 4]! / 255;
      });
    }
  }
}
