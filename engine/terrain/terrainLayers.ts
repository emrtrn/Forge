import type { TerrainEditWorld } from "./terrainEdit";
import { TERRAIN_MAX_LAYERS, terrainWeightBlockCount, type WorldTerrainLayerDef } from "./terrainTypes";

export interface TerrainLayerState {
  layers: WorldTerrainLayerDef[];
  weights: Map<string, Uint8Array>;
}

/** Structural layer changes require the complete grid, including streamed tiles. */
export function createTerrainLayerAddition(world: TerrainEditWorld, layer: WorldTerrainLayerDef): { before: TerrainLayerState; after: TerrainLayerState } {
  if (world.def.layers.length >= TERRAIN_MAX_LAYERS || world.def.layers.some((entry) => entry.id === layer.id)) {
    throw new Error("Terrain layer limit or duplicate id");
  }
  if (!world.def.tiles.every(({ key }) => world.tiles.has(key))) throw new Error("Load all terrain tiles before adding a layer");
  const before: TerrainLayerState = { layers: [...world.def.layers], weights: new Map() };
  const after: TerrainLayerState = { layers: [...world.def.layers, layer], weights: new Map() };
  for (const { key } of world.def.tiles) {
    const tile = world.tiles.get(key)!;
    before.weights.set(key, tile.weights.slice());
    const weights = new Uint8Array(terrainWeightBlockCount(after.layers.length) * tile.size * tile.size * 4);
    weights.set(tile.weights);
    const added = before.layers.length;
    const base = Math.floor(added / 4) * tile.size * tile.size * 4 + added % 4;
    for (let i = 0; i < tile.size * tile.size; i++) weights[base + i * 4] = 0;
    after.weights.set(key, weights);
  }
  return { before, after };
}

/** Keeps layer object identities for earlier material-assignment undo commands. */
export function applyTerrainLayerState(world: TerrainEditWorld, state: TerrainLayerState): void {
  world.def.layers = [...state.layers];
  for (const [key, weights] of state.weights) {
    const tile = world.tiles.get(key)!;
    tile.layerCount = state.layers.length;
    tile.weights = weights.slice();
  }
}
