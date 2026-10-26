import type { LayoutLakeWaterBody } from "../scene/layout";
import { lakeBedDistance, lakeBedPolyline, type BedPoint } from "../scene/lakeBed";
import { LAKE_LIMITS, validateWaterBody } from "../scene/waterBody";
import { captureTerrainTileRect, type TerrainDirtyRect, type TerrainUndoPatch } from "./terrainEdit";
import { terrainHeightAt } from "./terrainHeightQuery";
import { buildLakeGeometry, lakeGrid, prepareLakeSnapshot, type LakeGeometry, type LakeSnapshot } from "./terrainLakeWater";
import { readLakeTile } from "./lakeTileReads";
import type { WorldTerrainDocument } from "./terrainLoader";
import { terrainWeightBlockCount, tileKey, type TerrainTileData, type WorldTerrainDef } from "./terrainTypes";

export const LAKE_BED_LIMITS = { cpuBytes: 64 * 1024 ** 2, patchBytes: 16 * 1024 ** 2 } as const;
export interface LakeBedPreview {
  lake: LayoutLakeWaterBody;
  /** Immutable originals, including full missing tiles to adopt only on successful bake. */
  originals: Map<string, TerrainTileData>;
  patches: TerrainUndoPatch[];
  snapshot: LakeSnapshot;
  geometry: LakeGeometry;
  patchBytes: number;
  cpuBytes: number;
  buildMs: number;
  maxSliceMs: number;
  actualMaxDepth: number;
}

function checkpoint(signal?: AbortSignal) {
  let since = performance.now(), max = 0;
  return { get maxMs() { return max; }, resume() { since = performance.now(); }, async step(force = false) {
    if (signal?.aborted) throw new DOMException("Lake bed cancelled", "AbortError");
    const elapsed = performance.now() - since; max = Math.max(max, elapsed);
    if (force || elapsed >= 3) { await new Promise<void>((r) => setTimeout(r, 0)); since = performance.now(); }
  } };
}

export function fitLakeBedBounds(def: WorldTerrainDef, lake: LayoutLakeWaterBody): LayoutLakeWaterBody["bounds"] {
  if (!lake.bed) throw new Error("Lake has no bed recipe");
  const poly = lakeBedPolyline(lake.bed), pad = lake.bed.transitionWidth + 2 * def.spacing;
  const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
  for (const p of poly) for (let a = 0; a < 2; a++) { low[a] = Math.min(low[a]!, p[a]! - pad); high[a] = Math.max(high[a]!, p[a]! + pad); }
  return { min: low.map((v, a) => { const o = def.origin[a === 0 ? 0 : 2]; return o + Math.floor((v - o) / def.spacing) * def.spacing; }) as BedPoint,
    max: high.map((v, a) => { const o = def.origin[a === 0 ? 0 : 2]; return o + Math.ceil((v - o) / def.spacing) * def.spacing; }) as BedPoint };
}

export function preflightLakeBed(def: WorldTerrainDef, lake: LayoutLakeWaterBody) {
  if (!lake.bed) throw new Error("Lake has no bed recipe");
  const bed = lake.bed, grid = lakeGrid(def, lake), poly = lakeBedPolyline(bed), fit = fitLakeBedBounds(def, lake);
  if (bed.transitionWidth < def.spacing * 2) throw new Error("Lake bed transition width must be at least two terrain samples");
  if (fit.min.some((v, a) => v < lake.bounds.min[a]! - 1e-7) || fit.max.some((v, a) => v > lake.bounds.max[a]! + 1e-7)) throw new Error("Lake bed exceeds work area; fit or enlarge bounds");
  if (bed.shorePaint && !def.layers.some((l) => l.id === bed.shorePaint!.layerId)) throw new Error("Lake shore paint layer is missing");
  const q = def.tileQuads, keys: string[] = [], declared = new Set(def.tiles.map((t) => t.key));
  for (let z = Math.max(0, Math.ceil(grid.gz / q) - 1); z <= Math.min(def.tilesZ - 1, Math.floor((grid.gz + grid.nz) / q)); z++) {
    for (let x = Math.max(0, Math.ceil(grid.gx / q) - 1); x <= Math.min(def.tilesX - 1, Math.floor((grid.gx + grid.nx) / q)); x++) {
      const key = tileKey(x, z); if (declared.has(key)) keys.push(key);
    }
  }
  if (keys.length > LAKE_LIMITS.tiles) throw new Error(`over-budget: Lake bed needs ${keys.length} tiles (limit 16)`);
  const tileBytes = (q + 1) ** 2 * (4 + 4 * terrainWeightBlockCount(def.layers.length));
  if (Math.min(4, keys.length) * tileBytes * 2 > LAKE_LIMITS.decodeBytes) throw new Error("over-budget: Lake bed decode exceeds 32 MiB");
  // Originals + working tile copies + worst-case rectangular undo payload + W1 transient graph/buffers.
  const estimate = keys.length * tileBytes * 4 + grid.nx * grid.nz * 360;
  if (estimate > LAKE_BED_LIMITS.cpuBytes) throw new Error(`over-budget: Lake bed needs ${estimate} CPU bytes (limit 64 MiB)`);
  return { ...grid, keys, poly, tileBytes, estimate };
}

export function lakeBedTarget(level: number, depth: number, slopeDegrees: number, width: number, distance: number): number {
  const m = Math.tan(slopeDegrees * Math.PI / 180);
  if (distance >= 0) return level - Math.min(depth, distance * m);
  const r = -distance; if (r >= width) return Infinity;
  const t = r / width, blend = t * t * (3 - 2 * t);
  return level + m * r / (1 - blend);
}

function copies(def: WorldTerrainDef, tiles: Map<string, TerrainTileData>, gx: number, gz: number) {
  const q = def.tileQuads, tx = Math.min(def.tilesX - 1, Math.floor(gx / q)), tz = Math.min(def.tilesZ - 1, Math.floor(gz / q));
  const out: { tile: TerrainTileData; index: number }[] = [];
  for (const z of tz > 0 && gz === tz * q ? [tz, tz - 1] : [tz]) for (const x of tx > 0 && gx === tx * q ? [tx, tx - 1] : [tx]) {
    const tile = tiles.get(tileKey(x, z)); if (tile) out.push({ tile, index: (gz - z * q) * tile.size + gx - x * q });
  }
  return out;
}
const offset = (tile: TerrainTileData, i: number, layer: number) => Math.floor(layer / 4) * tile.size ** 2 * 4 + i * 4 + layer % 4;
function shoreDistance(shore: Float32Array, x: number, z: number): number {
  let distance = Infinity;
  for (let i = 0; i < shore.length; i += 4) {
    const dx = shore[i + 2]! - shore[i]!, dz = shore[i + 3]! - shore[i + 1]!, len = dx * dx + dz * dz;
    const t = len ? Math.max(0, Math.min(1, ((x - shore[i]!) * dx + (z - shore[i + 1]!) * dz) / len)) : 0;
    distance = Math.min(distance, Math.hypot(x - shore[i]! - t * dx, z - shore[i + 1]! - t * dz));
  }
  return distance;
}
function paintBytes(tile: TerrainTileData, index: number, layer: number, target: number): Uint8Array | null {
  const current = tile.weights[offset(tile, index, layer)]!; if (target <= current) return null;
  const out = new Uint8Array(tile.layerCount), rest = 255 - target;
  let other = 0; for (let l = 0; l < out.length; l++) if (l !== layer) other += tile.weights[offset(tile, index, l)]!;
  out[layer] = target;
  const remainders: { layer: number; value: number }[] = []; let assigned = 0;
  for (let l = 0; l < out.length; l++) if (l !== layer) {
    const scaled = other ? tile.weights[offset(tile, index, l)]! / other * rest : rest / (out.length - 1);
    out[l] = Math.floor(scaled); assigned += out[l]!; remainders.push({ layer: l, value: scaled - out[l]! });
  }
  remainders.sort((a, b) => b.value - a.value || a.layer - b.layer);
  for (let i = 0; i < rest - assigned; i++) out[remainders[i]!.layer] = out[remainders[i]!.layer]! + 1;
  return out;
}

/** Read/stage only. The owner must compare source and terrain revisions before publishing. */
export async function prepareLakeBed(document: WorldTerrainDocument, value: LayoutLakeWaterBody,
  load?: (key: string, signal?: AbortSignal) => Promise<TerrainTileData>, signal?: AbortSignal,
  chooseSeed = false): Promise<LakeBedPreview> {
  const started = performance.now(), work = checkpoint(signal), lake = validateWaterBody(value), def = structuredClone(document.def);
  const plan = preflightLakeBed(def, lake), bed = lake.bed!, originals = new Map<string, TerrainTileData>();
  const clone = (key: string, tile: TerrainTileData) => {
    if (tileKey(tile.x, tile.z) !== key || tile.size !== def.tileQuads + 1 || tile.layerCount !== def.layers.length
      || tile.heights.length !== tile.size ** 2 || tile.weights.length !== tile.size ** 2 * 4 * terrainWeightBlockCount(tile.layerCount)
      || !tile.heights.every(Number.isFinite)) throw new Error(`Invalid Lake bed tile ${key}`);
    originals.set(key, { ...tile, heights: tile.heights.slice(), weights: tile.weights.slice() });
  };
  // All live inputs are frozen before the first await; later edits invalidate at the owner.
  const missing: string[] = [];
  for (const key of plan.keys) { const tile = document.tiles.get(key); if (tile) clone(key, tile); else missing.push(key); }
  await work.step(); let cursor = 0;
  const reads = await Promise.allSettled(Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (cursor < missing.length) {
      await work.step(); const key = missing[cursor++]!;
      if (!load) throw new Error(`missing-data: Lake bed needs tile ${key}`);
      clone(key, await readLakeTile(() => load(key, signal), signal));
    }
  }));
  for (const r of reads) if (r.status === "rejected") throw r.reason;
  work.resume();
  await work.step(true);
  const source = { def, tiles: originals }, before = await prepareLakeSnapshot(source, lake, undefined, signal);
  work.resume();
  const snapshot: LakeSnapshot = { ...before, heights: before.heights.slice() };
  const candidate = new Map([...originals].map(([key, tile]) => [key, { ...tile, heights: tile.heights.slice(), weights: tile.weights.slice() }]));
  const width = plan.nx + 1, { spacing, origin } = def;
  const distances = new Float64Array(width * (plan.nz + 1));
  for (let z = 0; z <= plan.nz; z++) {
    for (let x = 0; x <= plan.nx; x++) {
      const wx = origin[0] + (plan.gx + x) * spacing, wz = origin[2] + (plan.gz + z) * spacing;
      const i = z * width + x, d = lakeBedDistance(plan.poly, wx, wz); distances[i] = d;
      if (d < -bed.transitionWidth) continue;
      if (!Number.isFinite(before.heights[i])) throw new Error("Lake bed footprint touches a terrain hole");
      const target = lakeBedTarget(lake.surfaceLevel, bed.maxDepth, bed.shoreSlopeDegrees, bed.transitionWidth, d) - origin[1];
      const h = Math.fround(Math.min(before.heights[i]!, target));
      if (h < def.heightMin || h > def.heightMax) throw new Error("Lake bed exceeds terrain height encoding range; change depth or level");
      snapshot.heights[i] = h;
      for (const copy of copies(def, candidate, plan.gx + x, plan.gz + z)) copy.tile.heights[copy.index] = h;
    }
    await work.step();
  }
  for (let z = 0; z < plan.nz; z++) {
    for (let x = 0; x < plan.nx; x++) if (!before.present[z * plan.nx + x]
      && lakeBedDistance(plan.poly, origin[0] + (plan.gx + x + 0.5) * spacing, origin[2] + (plan.gz + z + 0.5) * spacing) >= -bed.transitionWidth - spacing * Math.SQRT1_2) {
      throw new Error("Lake bed footprint touches a terrain hole");
    }
    await work.step();
  }
  const lookup = { tile: (x: number, z: number) => candidate.get(tileKey(x, z)) };
  const seedHeight = terrainHeightAt(def, lookup, ...lake.seed);
  if (chooseSeed || lakeBedDistance(plan.poly, ...lake.seed) <= 0 || seedHeight === null || seedHeight >= lake.surfaceLevel - 1e-5) {
    let best = Infinity, seed: BedPoint | null = null;
    for (let z = 0; z < plan.nz; z++) {
      for (let x = 0; x < plan.nx; x++) for (const t of [1 / 3, 2 / 3]) {
        const wx = origin[0] + (plan.gx + x + t) * spacing, wz = origin[2] + (plan.gz + z + t) * spacing;
        if (lakeBedDistance(plan.poly, wx, wz) <= 0) continue;
        const h = terrainHeightAt(def, lookup, wx, wz);
        if (h !== null && h < best && h < lake.surfaceLevel - 1e-5) { best = h; seed = [wx, wz]; }
      }
      await work.step();
    }
    if (!seed) throw new Error("dry-seed: Lake bed has no resolved wet interior; enlarge boundary or depth");
    lake.seed = seed;
  }
  snapshot.lake = lake;
  let connected: Uint8Array = new Uint8Array();
  const geometry = await buildLakeGeometry(snapshot, signal, (wet) => { connected = wet; });
  work.resume();
  if (geometry.status !== "ready") throw new Error(`${geometry.status}: ${geometry.message}`);
  for (let z = 0; z < plan.nz; z++) {
    for (let x = 0; x < plan.nx; x++) for (let t = 0; t < 2; t++) {
      const i = z * width + x, ids = t === 0 ? [i, i + width, i + 1] : [i + 1, i + width, i + width + 1];
      if (ids.some((v) => distances[v]! > 1e-7 && snapshot.heights[v]! < lake.surfaceLevel - origin[1] - 1e-5)
        && !connected[(z * plan.nx + x) * 2 + t]) throw new Error("disconnected-bed: Narrow terrain samples split the bed; enlarge the passage");
    }
    await work.step();
  }
  if (bed.shorePaint) {
    const layer = def.layers.findIndex((l) => l.id === bed.shorePaint!.layerId);
    if (def.layers.length < 2) throw new Error("Lake shore paint needs another terrain layer");
    for (let z = 0; z <= plan.nz; z++) {
      for (let x = 0; x <= plan.nx; x++) {
        if (distances[z * width + x]! < -bed.transitionWidth) continue;
        const wx = origin[0] + (plan.gx + x) * spacing, wz = origin[2] + (plan.gz + z) * spacing;
        const d = shoreDistance(geometry.shore, wx - geometry.position[0], wz - geometry.position[2]);
        if (d >= bed.transitionWidth) continue;
        const t = d / bed.transitionWidth, strength = bed.shorePaint.strength * (1 - t * t * (3 - 2 * t));
        const cc = copies(def, candidate, plan.gx + x, plan.gz + z), owner = cc[0]; if (!owner) continue;
        const bytes = paintBytes(owner.tile, owner.index, layer, Math.round(strength * 255));
        if (bytes) for (const copy of cc) for (let l = 0; l < bytes.length; l++) copy.tile.weights[offset(copy.tile, copy.index, l)] = bytes[l]!;
      }
      await work.step();
    }
  }
  const patches: TerrainUndoPatch[] = [];
  for (const key of plan.keys) {
    const a = originals.get(key)!, b = candidate.get(key)!; let rect: TerrainDirtyRect | null = null;
    for (let z = 0; z < a.size; z++) {
      for (let x = 0; x < a.size; x++) {
        const i = z * a.size + x;
        if (a.heights[i] === b.heights[i] && Array.from({ length: a.layerCount }, (_, l) => l).every((l) => a.weights[offset(a, i, l)] === b.weights[offset(b, i, l)])) continue;
        rect = rect ? { x0: Math.min(rect.x0, x), x1: Math.max(rect.x1, x), z0: Math.min(rect.z0, z), z1: Math.max(rect.z1, z) } : { x0: x, x1: x, z0: z, z1: z };
      }
      await work.step();
    }
    if (rect) patches.push({ key, rect, before: captureTerrainTileRect(a, rect), after: captureTerrainTileRect(b, rect) });
  }
  const patchBytes = patches.reduce((n, p) => n + p.before.heights.byteLength + p.before.weights.byteLength + p.after.heights.byteLength + p.after.weights.byteLength, 0);
  if (patchBytes > LAKE_BED_LIMITS.patchBytes) throw new Error("over-budget: Lake bed undo payload exceeds 16 MiB");
  return { lake, originals, patches, snapshot, geometry, patchBytes, cpuBytes: plan.estimate, buildMs: performance.now() - started,
    maxSliceMs: work.maxMs, actualMaxDepth: geometry.depths.reduce((a, b) => Math.max(a, b), 0) };
}

/** Detect edits since preview; residency-only changes are harmless. */
export function lakeBedStillCurrent(document: WorldTerrainDocument, preview: LakeBedPreview): boolean {
  if (JSON.stringify(document.def) !== JSON.stringify(preview.snapshot.def)) return false;
  for (const [key, before] of preview.originals) {
    const live = document.tiles.get(key); if (!live) continue;
    if (live.heights.length !== before.heights.length || live.weights.length !== before.weights.length
      || live.heights.some((v, i) => v !== before.heights[i]) || live.weights.some((v, i) => v !== before.weights[i])) return false;
  }
  return true;
}
