import type { WorldTerrainDocument } from "./terrainLoader";
import { terrainHeightAt } from "./terrainHeightQuery";
import { tileKey, type TerrainTileData, type WorldTerrainDef } from "./terrainTypes";
import { buildTerrainPuddle, type TerrainPuddleRegion } from "./terrainPuddle";
import { PUDDLE_LIMITS, type PuddleWaterBody } from "../scene/puddleWater";

export function puddleRegionAroundSeed(def: WorldTerrainDef, seed: readonly [number, number], size: number, level: number): TerrainPuddleRegion {
  const s = def.spacing, cells = Math.max(2, Math.ceil(size / s));
  if (!Number.isFinite(size) || size <= 0 || cells > 128 || cells * s > PUDDLE_LIMITS.extent) throw new Error("Puddle working area exceeds its budget");
  return { minX: def.origin[0] + Math.floor((seed[0] - cells * s / 2 - def.origin[0]) / s) * s,
    minZ: def.origin[2] + Math.floor((seed[1] - cells * s / 2 - def.origin[2]) / s) * s,
    size: cells * s, cellSize: s, level, seed };
}

/** Shared editor/runtime preparation; reads own a temporary tile map. Never
 * installs tiles in streaming or changes authored height/paint state. */
export async function preparePuddleWater(body: PuddleWaterBody, document: WorldTerrainDocument,
  load: (key: string, signal: AbortSignal) => Promise<TerrainTileData>, signal: AbortSignal) {
  const { def } = document, s = def.spacing, size = body.bounds.max[0] - body.bounds.min[0], n = size / s;
  const aligned = (value: number) => Math.abs(value - Math.round(value)) < 1e-6;
  if (!(n >= 2 && n <= 128) || !aligned(n) || !aligned((body.bounds.min[0] - def.origin[0]) / s)
    || !aligned((body.bounds.min[1] - def.origin[2]) / s)) throw new Error("Puddle bounds must match the native terrain grid (2–128 cells)");
  const region: TerrainPuddleRegion = { minX: body.bounds.min[0], minZ: body.bounds.min[1], size,
    cellSize: s, level: body.surfaceLevel, seed: body.seed };
  const tiles = new Map(document.tiles), known = new Set(def.tiles.map(tile => tile.key));
  const span = def.tileQuads * s, keys: string[] = [];
  for (let z = Math.max(0, Math.floor((region.minZ - def.origin[2]) / span)); z <= Math.min(def.tilesZ - 1, Math.floor((region.minZ + size - def.origin[2]) / span)); z++) {
    for (let x = Math.max(0, Math.floor((region.minX - def.origin[0]) / span)); x <= Math.min(def.tilesX - 1, Math.floor((region.minX + size - def.origin[0]) / span)); x++) {
      const key = tileKey(x, z); if (known.has(key) && !tiles.has(key)) keys.push(key);
    }
  }
  if (keys.length > PUDDLE_LIMITS.tiles) throw new Error("Puddle tile read budget exceeded");
  const cancelled = () => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
  cancelled();
  for (const key of keys) { tiles.set(key, await load(key, signal)); cancelled(); }
  const data = buildTerrainPuddle(region, (x, z) => terrainHeightAt(def, { tile: (tx, tz) => tiles.get(tileKey(tx, tz)) }, x, z));
  cancelled(); return data;
}
