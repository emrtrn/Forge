/**
 * Auto Paint: one pass that paints a whole World Terrain from rules on height
 * and slope (snow above a line, rock on steep ground, ...). It is a one-shot
 * editor action, not a live layer: the result is ordinary paint weights the
 * user keeps painting over by hand, and running it again overwrites them.
 * Rules are editor-session settings and are not saved with the terrain.
 *
 * Every vertex starts as the base layer; each enabled rule, top to bottom,
 * then lays its layer over what is there with `mask × strength`, so a later
 * rule wins where rules overlap. The mask (`terrainMask.ts`, shared with the
 * Landscape foliage rules) is the product of a height band and a slope band,
 * each full inside `[min, max]` and fading to nothing over its falloff outside
 * it, and optional noise breaks up the coverage.
 *
 * Slope comes from the neighbouring vertices across tile seams, so the two
 * copies of a seam vertex get the same weights. Pure; no three.js.
 */
import { captureTerrainTileRect, quantizeTerrainWeights, type TerrainEditWorld, type TerrainUndoPatch } from "./terrainEdit";
import { terrainMaskAt, terrainMaskBand, TERRAIN_MASK_RANGES, type TerrainMaskBands } from "./terrainMask";
import { tileKey } from "./terrainTypes";

export interface TerrainAutoPaintRule extends TerrainMaskBands {
  /** Paint layer id this rule lays down. */
  layerId: string;
  enabled: boolean;
  /** 0..1, the rule's weight where it fully applies. */
  strength: number;
}

export interface TerrainAutoPaintSettings {
  /** Layer for ground no rule covers. */
  baseLayerId: string;
  rules: readonly TerrainAutoPaintRule[];
  /** Noise seed shared by all rules (each rule offsets it). */
  seed: number;
}

/** UI and clamp ranges, the single source for the editor's sliders. */
export const TERRAIN_AUTO_PAINT_RANGES = {
  ...TERRAIN_MASK_RANGES,
  strength: { min: 0, max: 1 },
} as const;

export function defaultTerrainAutoPaintRule(layerId: string, heightMin: number, heightMax: number): TerrainAutoPaintRule {
  return {
    layerId, enabled: true,
    heightMin, heightMax, heightFalloff: 0,
    slopeMin: 0, slopeMax: 90, slopeFalloff: 0,
    noiseAmount: 0, noiseScale: 20, strength: 1,
  };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 1 inside `[min, max]`, smoothstep to 0 over `falloff` outside it. */
export const terrainAutoPaintBand = terrainMaskBand;

/** 0..1 coverage of one rule at a point; `strength` not applied. */
export function terrainAutoPaintMask(rule: TerrainAutoPaintRule, height: number, slopeDeg: number, x: number, z: number, seed: number): number {
  return terrainMaskAt(rule, height, slopeDeg, x, z, seed);
}

interface ResolvedRule { rule: TerrainAutoPaintRule; layer: number; seed: number }

function resolveRules(world: TerrainEditWorld, settings: TerrainAutoPaintSettings): { base: number; rules: ResolvedRule[] } {
  const index = (id: string): number => world.def.layers.findIndex((layer) => layer.id === id);
  const base = index(settings.baseLayerId);
  if (base < 0) throw new Error(`Auto Paint base layer ${settings.baseLayerId} does not exist`);
  const rules: ResolvedRule[] = [];
  settings.rules.forEach((rule, i) => {
    if (!rule.enabled || !(rule.strength > 0)) return;
    const layer = index(rule.layerId);
    if (layer < 0) throw new Error(`Auto Paint rule ${i + 1}: layer ${rule.layerId} does not exist`);
    const numbers = [rule.heightMin, rule.heightMax, rule.heightFalloff, rule.slopeMin, rule.slopeMax,
      rule.slopeFalloff, rule.noiseAmount, rule.noiseScale, rule.strength];
    if (!numbers.every(Number.isFinite)) throw new Error(`Auto Paint rule ${i + 1} has an invalid number`);
    rules.push({ rule, layer, seed: (Math.round(settings.seed) + i * 1013) | 0 });
  });
  return { base, rules };
}

/** Normalized layer weights for one point: base layer, then each rule laid over it. */
export function terrainAutoPaintWeights(
  layerCount: number, base: number, rules: readonly { rule: TerrainAutoPaintRule; layer: number; seed: number }[],
  height: number, slopeDeg: number, x: number, z: number,
): number[] {
  const weights = new Array<number>(layerCount).fill(0);
  weights[base] = 1;
  for (const { rule, layer, seed } of rules) {
    const amount = terrainAutoPaintMask(rule, height, slopeDeg, x, z, seed) * clamp(rule.strength, 0, 1);
    if (amount <= 0) continue;
    for (let i = 0; i < layerCount; i++) weights[i] = weights[i]! * (1 - amount);
    weights[layer] = weights[layer]! + amount;
  }
  return weights;
}

/**
 * Undo patches that repaint every tile from the rules; nothing is written
 * here. The whole grid must be resident. Heights are untouched; a tile whose
 * weights already match is skipped.
 */
export function createTerrainAutoPaintPatches(world: TerrainEditWorld, settings: TerrainAutoPaintSettings): TerrainUndoPatch[] {
  const { base, rules } = resolveRules(world, settings);
  const { def } = world;
  const { tileQuads: q, spacing, origin, tilesX, tilesZ } = def;
  for (const { key } of def.tiles) if (!world.tiles.has(key)) throw new Error(`Auto Paint tile is not resident: ${key}`);
  const maxX = tilesX * q, maxZ = tilesZ * q;
  /** World height of a grid vertex, or null in a hole / off the grid. Edge copies are equal, any one serves. */
  const gridHeight = (gx: number, gz: number): number | null => {
    if (gx < 0 || gz < 0 || gx > maxX || gz > maxZ) return null;
    const tx = Math.min(Math.floor(gx / q), tilesX - 1), tz = Math.min(Math.floor(gz / q), tilesZ - 1);
    const xs = tx > 0 && gx === tx * q ? [tx, tx - 1] : [tx];
    const zs = tz > 0 && gz === tz * q ? [tz, tz - 1] : [tz];
    for (const z of zs) for (const x of xs) {
      const tile = world.tile(x, z);
      if (tile) return origin[1] + tile.heights[(gz - z * q) * tile.size + gx - x * q]!;
    }
    return null;
  };
  /** Central difference, one-sided beside a hole or the grid edge, flat with no neighbour. */
  const gradient = (gx: number, gz: number, dx: number, dz: number, centre: number): number => {
    const ahead = gridHeight(gx + dx, gz + dz), behind = gridHeight(gx - dx, gz - dz);
    if (ahead !== null && behind !== null) return (ahead - behind) / (2 * spacing);
    if (ahead !== null) return (ahead - centre) / spacing;
    if (behind !== null) return (centre - behind) / spacing;
    return 0;
  };
  const layerCount = def.layers.length;
  const patches: TerrainUndoPatch[] = [];
  for (const { key } of def.tiles) {
    const tile = world.tiles.get(key)!;
    const rect = { x0: 0, z0: 0, x1: tile.size - 1, z1: tile.size - 1 };
    const before = captureTerrainTileRect(tile, rect);
    const weights = new Uint8Array(before.weights.length);
    const count = tile.size * tile.size;
    for (let lz = 0; lz < tile.size; lz++) {
      for (let lx = 0; lx < tile.size; lx++) {
        const gx = tile.x * q + lx, gz = tile.z * q + lz;
        const index = lz * tile.size + lx;
        const height = origin[1] + tile.heights[index]!;
        const slope = Math.atan(Math.hypot(gradient(gx, gz, 1, 0, height), gradient(gx, gz, 0, 1, height))) * (180 / Math.PI);
        const bytes = quantizeTerrainWeights(terrainAutoPaintWeights(layerCount, base, rules, height, slope,
          origin[0] + gx * spacing, origin[2] + gz * spacing));
        for (let layer = 0; layer < layerCount; layer++) weights[Math.floor(layer / 4) * count * 4 + index * 4 + layer % 4] = bytes[layer]!;
      }
    }
    if (weights.every((weight, i) => weight === before.weights[i])) continue;
    patches.push({ key: tileKey(tile.x, tile.z), rect, before, after: { heights: before.heights.slice(), weights } });
  }
  return patches;
}
