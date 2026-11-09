import { CooperativeWork } from "../core/cooperativeWork";
import { OCEAN_LIMITS, validateOceanWater, type OceanWaterBody } from "../scene/oceanWater";
import { prepareOceanCoverage, type OceanCoverage } from "./oceanCoverage";
import { resolveOceanInlets } from "./oceanInlets";
import type { LayoutRiverWater } from "../scene/layout";
import type { WorldTerrainDocument } from "./terrainLoader";
import { tileKey, type TerrainTileData } from "./terrainTypes";
import { createOceanCoverageStorage } from "./oceanCoverageStorage";

/** Snapshots native World Terrain samples before building coverage. Source data
 * is never inserted into streaming residency or replaced with the global map.
 * Caller must compare its document revision before publishing this result. */
export async function prepareOceanTerrain(document: WorldTerrainDocument, value: OceanWaterBody,
  load?: (key: string, signal?: AbortSignal) => Promise<TerrainTileData>, work = new CooperativeWork(),
  signal?: AbortSignal, rivers?: readonly LayoutRiverWater[]): Promise<OceanCoverage> {
  work.check(); signal?.throwIfAborted();
  const body = validateOceanWater(value), def = structuredClone(document.def);
  const inlets = resolveOceanInlets(def, body, rivers);
  const nx = def.tilesX * def.tileQuads, nz = def.tilesZ * def.tileQuads;
  if (nx * nz > OCEAN_LIMITS.cells || nx > OCEAN_LIMITS.axisCells || nz > OCEAN_LIMITS.axisCells)
    throw new Error("over-budget: Ocean native terrain exceeds the preparation grid limit");
  // Defining offshore just beyond a smaller crop could flood unexamined terrain.
  const expected = [def.origin[0], def.origin[2], def.origin[0] + nx * def.spacing, def.origin[2] + nz * def.spacing];
  const actual = [...body.bounds.min, ...body.bounds.max];
  if (actual.some((v, i) => Math.abs(v - expected[i]!) > 1e-6))
    throw new Error("Ocean domain must match the full terrain bounds before declaring offshore");
  const heights = new Float64Array((nx + 1) * (nz + 1)).fill(NaN), present = new Uint8Array(nx * nz);
  const tileBytes = (def.tileQuads + 1) ** 2 * (8 + 8 * Math.ceil(def.layers.length / 4));
  if (Math.min(4, def.tiles.length) * tileBytes > 32 * 1024 ** 2) throw new Error("over-budget: Ocean tile reads exceed 32 MiB");
  function* copy(key: string, tile: TerrainTileData): Generator<void, void> {
    if (tileKey(tile.x, tile.z) !== key || tile.size !== def.tileQuads + 1)
      throw new Error(`Invalid Ocean terrain tile ${key}`);
    for (let z = 0; z < tile.size; z++) {
      for (let x = 0; x < tile.size; x++) {
        const gx = tile.x * def.tileQuads + x, gz = tile.z * def.tileQuads + z, index = gz * (nx + 1) + gx;
        const h = tile.heights[z * tile.size + x]! + def.origin[1];
        if (!Number.isFinite(h)) throw new Error(`Invalid Ocean terrain height ${key}`);
        if (Number.isFinite(heights[index]) && Math.abs(heights[index]! - h) > 1e-5) throw new Error(`Ocean terrain seam mismatch ${key}`);
        heights[index] = h;
        if (x < def.tileQuads && z < def.tileQuads) present[gz * nx + gx] = 1;
      }
      yield;
    }
  }
  const pending: string[] = [];
  // Snapshot incrementally. The caller's revision check rejects any source
  // mutation during these yields rather than publishing a mixed revision.
  for (const { key } of def.tiles) {
    const tile = document.tiles.get(key);
    if (!tile) pending.push(key);
    else await work.run("ocean-terrain-snapshot", copy(key, tile));
  }
  // Only I/O is concurrent. Shared snapshot mutation remains serial/cooperative.
  for (let offset = 0; offset < pending.length; offset += 4) {
    signal?.throwIfAborted(); work.check();
    const keys = pending.slice(offset, offset + 4);
    const reads = await Promise.allSettled(keys.map(key => load ? load(key, signal) : Promise.reject(new Error(`Ocean requires tile ${key}`))));
    signal?.throwIfAborted(); work.check();
    for (let i = 0; i < reads.length; i++) {
      const result = reads[i]!; if (result.status === "rejected") throw result.reason;
      await work.run("ocean-terrain-snapshot", copy(keys[i]!, result.value));
    }
  }
  // A sparse tile definition may share all edge vertices around a hole. Missing
  // cells still invalidate the domain; vertex presence alone isn't sufficient.
  if (present.some(v => v === 0)) {
    const storage = createOceanCoverageStorage(nx, nz); storage.heights.fill(NaN);
    return { storage, minBed: NaN, body, spacing: def.spacing, nx, nz, heights: storage.heights,
      triangles: new Uint8Array(nx * nz), status: "missing-data", wetFaces: 0 };
  }
  return prepareOceanCoverage(body, def.spacing, (x, z) => {
    signal?.throwIfAborted();
    const gx = Math.round((x - def.origin[0]) / def.spacing), gz = Math.round((z - def.origin[2]) / def.spacing);
    return heights[gz * (nx + 1) + gx] ?? null;
  }, work, inlets);
}
