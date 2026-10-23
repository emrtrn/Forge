import { LANDSCAPE_QUADS_PER_CHUNK, type ForgeLandscapeData } from "../scene/landscape";
import type { LayoutLandscape } from "../scene/layout";
import { legacyLandscapeToWorldTerrain } from "./terrainLegacy";
import { type WorldTerrainDocument } from "./terrainLoader";
import { encodeTerrainTile } from "./terrainTileCodec";
import { isWorldTerrainPath, terrainTileLayerWeight, type WorldTerrainDef } from "./terrainTypes";

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

/** The old mesh/brush adapter is temporary until the Phase 2 renderer replaces it. */
export function terrainDocumentToLandscape({ def, tiles }: WorldTerrainDocument): ForgeLandscapeData {
  if (def.tilesX !== 1 || def.tilesZ !== 1 || def.tiles.length !== 1 || !tiles.has("0_0")) {
    throw new Error("Multi-tile terrain rendering requires OPEN_WORLD_PLAN Phase 2; refusing to flatten or discard tiles");
  }
  const tile = tiles.get("0_0")!;
  const data: ForgeLandscapeData = {
    schema: 1, type: "landscape",
    size: { verticesX: tile.size, verticesZ: tile.size, spacing: def.spacing, heightScale: 1 },
    chunks: { quadsPerChunk: LANDSCAPE_QUADS_PER_CHUNK },
    heights: Array.from(tile.heights),
    layers: def.layers.map((layer, index) => ({
      id: layer.id, name: layer.name, ...(layer.material === undefined ? {} : { material: layer.material }),
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
  };
}
