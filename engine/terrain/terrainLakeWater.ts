import type { LayoutLakeWaterBody, Vec3 } from "../scene/layout";
import { LAKE_LIMITS, validateWaterBody } from "../scene/waterBody";
import type { WorldTerrainDocument } from "./terrainLoader";
import { tileKey, type TerrainTileData, type WorldTerrainDef } from "./terrainTypes";

export type LakeStatus = "ready" | "dry-seed" | "open-boundary" | "missing-data" | "over-budget" | "invalid";
export interface LakeGeometry {
  status: LakeStatus;
  message: string;
  position: Vec3;
  escapeLevel: number | null;
  positions: Float32Array;
  depths: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Local XZ pairs, two endpoints per segment; includes island shores. */
  shore: Float32Array;
  cuts: Float32Array;
  cells: number;
  bytes: number;
  buildMs: number;
}
export interface LakeSnapshot {
  def: WorldTerrainDef;
  nx: number; nz: number; gx: number; gz: number;
  heights: Float64Array;
  present: Uint8Array;
  lake: LayoutLakeWaterBody;
}
const EPS = 1e-5;
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Lake cancelled", "AbortError"); }
export function lakeGrid(def: WorldTerrainDef, lake: LayoutLakeWaterBody) {
  const coords = [lake.bounds.min[0] - def.origin[0], lake.bounds.min[1] - def.origin[2],
    lake.bounds.max[0] - def.origin[0], lake.bounds.max[1] - def.origin[2]].map((v) => v / def.spacing);
  if (coords.some((v) => Math.abs(v - Math.round(v)) > 1e-6)) throw new Error("Lake bounds must align with terrain grid");
  const [gx, gz, ex, ez] = coords.map(Math.round) as [number, number, number, number];
  if (gx < 0 || gz < 0 || ex > def.tilesX * def.tileQuads || ez > def.tilesZ * def.tileQuads) throw new Error("Lake bounds are outside terrain");
  const nx = ex - gx, nz = ez - gz;
  if (nx < 1 || nz < 1) throw new Error("Lake bounds must contain terrain cells");
  if (nx * nz > LAKE_LIMITS.cells) throw new Error(`over-budget: Lake requires ${nx * nz} cells (limit ${LAKE_LIMITS.cells})`);
  return { gx, gz, nx, nz };
}

/** Exact bounded immutable height snapshot. Never inserts temporary tiles into the document. */
export async function prepareLakeSnapshot(document: WorldTerrainDocument, value: LayoutLakeWaterBody,
  load?: (key: string, signal?: AbortSignal) => Promise<TerrainTileData>, signal?: AbortSignal): Promise<LakeSnapshot> {
  const lake = validateWaterBody(value), def = structuredClone(document.def), grid = lakeGrid(def, lake);
  const { gx, gz, nx, nz } = grid, q = def.tileQuads;
  const defined = new Set(def.tiles.map((t) => t.key));
  const keys: string[] = [];
  for (let z = Math.max(0, Math.ceil(gz / q) - 1); z <= Math.min(def.tilesZ - 1, Math.floor((gz + nz) / q)); z++) {
    for (let x = Math.max(0, Math.ceil(gx / q) - 1); x <= Math.min(def.tilesX - 1, Math.floor((gx + nx) / q)); x++) {
      const key = tileKey(x, z); if (defined.has(key)) keys.push(key);
    }
  }
  if (keys.length > LAKE_LIMITS.tiles) throw new Error(`over-budget: Lake requires ${keys.length} tiles (limit 16)`);
  const perTile = (q + 1) ** 2 * (8 + 8 * Math.ceil(def.layers.length / 4));
  if (Math.min(4, keys.length) * perTile > LAKE_LIMITS.decodeBytes) throw new Error("over-budget: Lake decode exceeds 32 MiB");
  const heights = new Float64Array((nx + 1) * (nz + 1)).fill(NaN), present = new Uint8Array(nx * nz);
  // Snapshot resident data before the first await; a later revision check belongs to the owner.
  const copy = (key: string, tile: TerrainTileData): void => {
    if (tileKey(tile.x, tile.z) !== key || tile.size !== q + 1) throw new Error(`Invalid Lake tile ${key}`);
    for (let z = Math.max(gz, tile.z * q); z <= Math.min(gz + nz, (tile.z + 1) * q); z++) {
      for (let x = Math.max(gx, tile.x * q); x <= Math.min(gx + nx, (tile.x + 1) * q); x++) {
        const index = (z - gz) * (nx + 1) + x - gx;
        const h = tile.heights[(z - tile.z * q) * tile.size + x - tile.x * q]!;
        if (!Number.isFinite(h)) throw new Error(`Invalid Lake height ${key}`);
        if (Number.isFinite(heights[index]) && Math.abs(heights[index]! - h) > EPS) throw new Error(`Lake seam mismatch ${key}`);
        heights[index] = h;
      }
    }
  };
  const missing: string[] = [];
  for (const key of keys) {
    const tile = document.tiles.get(key);
    if (tile) copy(key, tile); else missing.push(key);
  }
  let cursor = 0;
  const reads = await Promise.allSettled(Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (cursor < missing.length) {
      abort(signal); const key = missing[cursor++]!;
      if (!load) throw new Error(`missing-data: Lake requires tile ${key}`);
      copy(key, await load(key, signal));
    }
  }));
  abort(signal);
  for (const r of reads) if (r.status === "rejected") throw r.reason;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    if (defined.has(tileKey(Math.floor((gx + x) / q), Math.floor((gz + z) / q)))) present[z * nx + x] = 1;
  }
  return { def, lake, ...grid, heights, present };
}

export function emptyLake(lake: LayoutLakeWaterBody, status: LakeStatus, message: string): LakeGeometry {
  return { status, message, position: [(lake.bounds.min[0] + lake.bounds.max[0]) / 2, lake.surfaceLevel,
    (lake.bounds.min[1] + lake.bounds.max[1]) / 2], escapeLevel: null, positions: new Float32Array(),
    depths: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array(), shore: new Float32Array(),
    cuts: new Float32Array(), cells: 0, bytes: 0, buildMs: 0 };
}

/** Terrain triangle graph, exact clipping and minimax escape; yields between bounded batches. */
export async function buildLakeGeometry(snapshot: LakeSnapshot, signal?: AbortSignal): Promise<LakeGeometry> {
  const started = performance.now(); let slice = started;
  const yieldWork = async () => {
    abort(signal);
    if (performance.now() - slice >= 3) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); slice = performance.now(); abort(signal); }
  };
  const { lake, def, nx, nz, gx, gz, heights: h, present } = snapshot;
  const out = emptyLake(lake, "ready", "Lake ready"); out.cells = nx * nz;
  const width = nx + 1, count = nx * nz * 2, level = lake.surfaceLevel - def.origin[1];
  const sx = (lake.seed[0] - def.origin[0]) / def.spacing - gx, sz = (lake.seed[1] - def.origin[2]) / def.spacing - gz;
  const cx = Math.floor(sx), cz = Math.floor(sz), fx = sx - cx, fz = sz - cz;
  const seed = (cz * nx + cx) * 2 + (fx + fz <= 1 ? 0 : 1);
  if (!present[cz * nx + cx]) return { ...out, status: "invalid", message: "Lake seed is over a terrain hole" };
  const row = cz * width + cx;
  const seedH = fx + fz <= 1 ? h[row]! + fx * (h[row + 1]! - h[row]!) + fz * (h[row + width]! - h[row]!)
    : h[row + width + 1]! + (1 - fx) * (h[row + width]! - h[row + width + 1]!) + (1 - fz) * (h[row + 1]! - h[row + width + 1]!);
  // Each face has three implicit neighbours, so the graph costs O(cells), not JS objects per edge.
  const vertices = (t: number): [number, number, number] => {
    const cell = t >> 1, a = Math.floor(cell / nx) * width + cell % nx;
    return t & 1 ? [a + 1, a + width, a + width + 1] : [a, a + width, a + 1];
  };
  const neighbours = (t: number): [number, number, number] => {
    const cell = t >> 1, x = cell % nx, z = Math.floor(cell / nx);
    const n = t & 1 ? [t - 1, z + 1 < nz ? t + 2 * nx - 1 : -1, x + 1 < nx ? t + 1 : -1]
      : [x > 0 ? t - 1 : -1, t + 1, z > 0 ? t - 2 * nx + 1 : -1];
    return n.map((v) => v >= 0 && present[v >> 1] ? v : -1) as [number, number, number];
  };
  // Indexed binary heap: each face appears at most once.
  const costs = new Float64Array(count).fill(Infinity), heap = new Int32Array(count), slots = new Int32Array(count).fill(-1);
  let size = 0;
  const swap = (a: number, b: number) => { const v = heap[a]!; heap[a] = heap[b]!; heap[b] = v; slots[heap[a]!] = a; slots[v] = b; };
  const push = (t: number, cost: number) => {
    costs[t] = cost; let i = slots[t]!;
    if (i < 0) { i = size++; heap[i] = t; slots[t] = i; }
    while (i > 0) { const p = (i - 1) >> 1; if (costs[heap[p]!]! <= cost) break; swap(i, p); i = p; }
  };
  const pop = () => {
    const t = heap[0]!; slots[t] = -2; size--;
    if (size) { heap[0] = heap[size]!; slots[heap[0]!] = 0; let i = 0;
      while (true) { let j = i * 2 + 1; if (j >= size) break;
        if (j + 1 < size && costs[heap[j + 1]!]! < costs[heap[j]!]!) j++;
        if (costs[heap[i]!]! <= costs[heap[j]!]!) break; swap(i, j); i = j; }
    } return t;
  };
  push(seed, seedH); let steps = 0, escape = Infinity;
  while (size) {
    const t = pop(), cost = costs[t]!, v = vertices(t), n = neighbours(t);
    for (let e = 0; e < 3; e++) {
      const next = n[e]!, gate = Math.min(h[v[e]!]!, h[v[(e + 1) % 3]!]!), candidate = Math.max(cost, gate);
      if (next < 0) escape = Math.min(escape, candidate);
      else if (slots[next] !== -2 && candidate < costs[next]!) push(next, candidate);
    }
    if ((++steps & 255) === 0) await yieldWork();
  }
  out.escapeLevel = escape + def.origin[1];
  if (seedH >= level - EPS) return { ...out, status: "dry-seed", message: "Seed is dry: raise water level or choose another seed", buildMs: performance.now() - started };
  const wet = new Uint8Array(count), queue = new Int32Array(count); let head = 0, tail = 1; queue[0] = seed; wet[seed] = 1;
  while (head < tail) {
    const t = queue[head++]!, v = vertices(t), n = neighbours(t);
    for (let e = 0; e < 3; e++) {
      const next = n[e]!;
      if (next >= 0 && !wet[next] && Math.min(h[v[e]!]!, h[v[(e + 1) % 3]!]!) < level - EPS) { wet[next] = 1; queue[tail++] = next; }
    }
    if ((head & 255) === 0) await yieldWork();
  }
  // Bounded typed buffers. Shared source vertices and all three grid edge families are welded.
  const capacity = h.length + nx * (nz + 1) + (nx + 1) * nz + nx * nz;
  const pos = new Float32Array(capacity * 3), depths = new Float32Array(capacity), uv = new Float32Array(capacity * 2);
  const indices = new Uint32Array(tail * 6), vertexCache = new Int32Array(h.length).fill(-1);
  const edgeCache = new Int32Array(capacity - h.length).fill(-1);
  const shore = new Float32Array(tail * 12), cuts = new Float32Array(tail * 12);
  let vc = 0, ic = 0, sc = 0, bc = 0;
  const edgeSlot = (a: number, b: number) => {
    const lo = Math.min(a, b), x = lo % width, z = Math.floor(lo / width);
    return Math.floor(a / width) === Math.floor(b / width) ? z * nx + x : a % width === b % width ? nx * (nz + 1) + z * width + x
      : nx * (nz + 1) + width * nz + z * nx + x - 1;
  };
  const vertex = (a: number, b = a) => {
    if (a !== b && h[a] === level) b = a;
    if (a !== b && h[b] === level) a = b;
    const cache = a === b ? vertexCache : edgeCache, slot = a === b ? a : edgeSlot(a, b);
    if (cache[slot]! >= 0) return cache[slot]!;
    const t = a === b ? 0 : (level - h[a]!) / (h[b]! - h[a]!);
    const x = a % width + (b % width - a % width) * t, z = Math.floor(a / width) + (Math.floor(b / width) - Math.floor(a / width)) * t;
    const index = vc++; cache[slot] = index;
    pos[index * 3] = (x - nx / 2) * def.spacing; pos[index * 3 + 2] = (z - nz / 2) * def.spacing;
    depths[index] = a === b ? Math.max(0, level - h[a]!) : 0;
    uv[index * 2] = x * def.spacing; uv[index * 2 + 1] = z * def.spacing;
    return index;
  };
  for (let qi = 0; qi < tail; qi++) {
    const t = queue[qi]!, v = vertices(t), n = neighbours(t), polygon: number[] = [], edgeIds: number[][] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e]!, b = v[(e + 1) % 3]!, ids: number[] = [];
      if (h[a]! < level) { const i = vertex(a); polygon.push(i); ids.push(i); }
      if ((h[a]! < level) !== (h[b]! < level)) { const i = vertex(a, b); polygon.push(i); ids.push(i); }
      if (h[b]! < level) ids.push(vertex(b));
      edgeIds.push(ids);
    }
    const p = polygon.filter((v, i) => i === 0 || polygon[i - 1] !== v);
    if (p.length > 1 && p[0] === p[p.length - 1]) p.pop();
    for (let i = 1; i + 1 < p.length; i++) {
      const a = p[0]!, b = p[i]!, c = p[i + 1]!;
      const area = Math.abs((pos[b * 3]! - pos[a * 3]!) * (pos[c * 3 + 2]! - pos[a * 3 + 2]!) - (pos[c * 3]! - pos[a * 3]!) * (pos[b * 3 + 2]! - pos[a * 3 + 2]!));
      if (area > def.spacing ** 2 * 1e-12) { indices[ic++] = a; indices[ic++] = b; indices[ic++] = c; }
    }
    const segment = (buffer: Float32Array, offset: number, a: number, b: number) => {
      buffer.set([pos[a * 3]!, pos[a * 3 + 2]!, pos[b * 3]!, pos[b * 3 + 2]!], offset);
    };
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!, b = p[(i + 1) % p.length]!;
      if (depths[a] === 0 && depths[b] === 0 && a !== b) { segment(shore, sc, a, b); sc += 4; }
    }
    for (let e = 0; e < 3; e++) if (n[e]! < 0) {
      const ids = edgeIds[e]!; if (ids.length >= 2 && ids[0] !== ids[ids.length - 1]) { segment(cuts, bc, ids[0]!, ids[ids.length - 1]!); bc += 4; }
    }
    if ((qi & 255) === 0) await yieldWork();
  }
  out.positions = pos.slice(0, vc * 3); out.depths = depths.slice(0, vc); out.uvs = uv.slice(0, vc * 2);
  out.indices = indices.slice(0, ic); out.shore = shore.slice(0, sc); out.cuts = cuts.slice(0, bc);
  out.bytes = out.positions.byteLength + out.depths.byteLength + out.uvs.byteLength + out.indices.byteLength + out.shore.byteLength + out.cuts.byteLength;
  if (out.bytes > LAKE_LIMITS.geometryBytes) return { ...emptyLake(lake, "over-budget", "Lake geometry exceeds 16 MiB"), cells: out.cells };
  if (level >= escape - EPS) { out.status = "open-boundary"; out.message = `Area opens at world Y ${out.escapeLevel.toFixed(3)}; enlarge area or lower level`; }
  out.buildMs = performance.now() - started;
  return out;
}
