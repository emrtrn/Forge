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

/**
 * Removes one paint layer from every tile. Per vertex its weight goes to the
 * remaining layers in proportion to theirs, with largest remainders so the
 * vertex sums to exactly 255 in RGBA8 (an untouched vertex only shifts, an
 * unpainted one stays unpainted); a vertex painted only
 * with the removed layer goes to the first remaining one. Later layers shift
 * down a channel, and the weight block count drops with the layer count.
 */
export function createTerrainLayerRemoval(world: TerrainEditWorld, layerId: string): { before: TerrainLayerState; after: TerrainLayerState } {
  const removed = world.def.layers.findIndex((entry) => entry.id === layerId);
  if (removed < 0) throw new Error(`Terrain layer ${layerId} does not exist`);
  if (world.def.layers.length <= 1) throw new Error("A terrain keeps at least one paint layer");
  if (!world.def.tiles.every(({ key }) => world.tiles.has(key))) throw new Error("Load all terrain tiles before removing a layer");
  const before: TerrainLayerState = { layers: [...world.def.layers], weights: new Map() };
  const after: TerrainLayerState = { layers: world.def.layers.filter((_, index) => index !== removed), weights: new Map() };
  const kept = after.layers.length;
  const source = new Array<number>(before.layers.length);
  const remainders = new Array<number>(kept);
  for (const { key } of world.def.tiles) {
    const tile = world.tiles.get(key)!;
    before.weights.set(key, tile.weights.slice());
    const count = tile.size * tile.size;
    const offset = (layer: number, index: number): number => Math.floor(layer / 4) * count * 4 + index * 4 + layer % 4;
    const weights = new Uint8Array(terrainWeightBlockCount(kept) * count * 4);
    for (let i = 0; i < count; i++) {
      let total = 0;
      for (let layer = 0; layer < source.length; layer++) total += source[layer] = tile.weights[offset(layer, i)]!;
      const rest = total - source[removed]!;
      if (source[removed]! > 0) total = 255;
      let remaining = total;
      for (let layer = 0; layer < kept; layer++) {
        const weight = source[layer < removed ? layer : layer + 1]!;
        // weight * total / rest in integers: the floor now, the remainder ranks the leftover units.
        const share = rest > 0 ? Math.floor(weight * total / rest) : layer === 0 ? total : 0;
        remainders[layer] = rest > 0 ? weight * total - share * rest : 0;
        remaining -= weights[offset(layer, i)] = share;
      }
      for (; remaining > 0; remaining--) {
        let best = 0;
        for (let layer = 1; layer < kept; layer++) if (remainders[layer]! > remainders[best]!) best = layer;
        const target = offset(best, i);
        weights[target] = weights[target]! + 1;
        remainders[best] = -1;
      }
    }
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
