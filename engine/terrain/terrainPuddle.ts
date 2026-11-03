/** Bounded Puddle prototype. The caller supplies the current (deformed) bed,
 * including any authoring-time Sculpt changes. null means unknown terrain.
 * No authored height/paint data is mutated. Heights are metres in world space. */
export interface TerrainPuddleRegion {
  minX: number; minZ: number; size: number; cellSize: number;
  level: number; seed: readonly [number, number];
}
export interface TerrainPuddleGeometry {
  status: "ready" | "dry" | "open-boundary" | "missing-terrain";
  positions: Float32Array;
  depths: Float32Array;
  area: number;
  coverage?: { region: TerrainPuddleRegion; bed: Float32Array; triangles: Uint8Array; cells: number };
  /** Exact shoreline segments (x,z,x,z), including dry islands and raised rims. */
  shore?: Float32Array;
}
type Vertex = { x: number; z: number; h: number };
const empty = (status: TerrainPuddleGeometry["status"]): TerrainPuddleGeometry =>
  ({ status, positions: new Float32Array(), depths: new Float32Array(), area: 0 });

/** Clips the seed-connected wet triangles at one horizontal level. Sampling
 * resolution is explicit; it must match the caller's rendered bed topology.
 * An open boundary or unknown neighbour is reported, never silently flooded.
 * Call only after bed/paint/level revisions, not once per animation frame. */
export function buildTerrainPuddle(region: TerrainPuddleRegion, heightAt: (x: number, z: number) => number | null): TerrainPuddleGeometry {
  const job = terrainPuddleSteps(region, heightAt);
  let step = job.next(); while (!step.done) step = job.next(); return step.value;
}

/** Batches sampling, adjacency and flood work for a cooperative runtime owner. */
export function* terrainPuddleSteps(region: TerrainPuddleRegion, heightAt: (x: number, z: number) => number | null): Generator<void, TerrainPuddleGeometry> {
  const { minX, minZ, size, cellSize, level, seed } = region;
  const n = Math.round(size / cellSize);
  if (![minX, minZ, size, cellSize, level, ...seed].every(Number.isFinite)
    || size <= 0 || cellSize <= 0 || n < 1 || n > 128 || Math.abs(n * cellSize - size) > 1e-7) {
    throw new RangeError("Puddle requires finite bounds and at most 128 × 128 exact cells");
  }
  const sx = (seed[0] - minX) / cellSize, sz = (seed[1] - minZ) / cellSize;
  if (sx < 0 || sz < 0 || sx >= n || sz >= n) return empty("dry");
  const vertices: Vertex[] = [];
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
    const wx = minX + x * cellSize, wz = minZ + z * cellSize;
    const h = heightAt(wx, wz);
    vertices.push({ x: wx, z: wz, h: h === null || !Number.isFinite(h) ? NaN : h });
    if (x === n) yield;
  }
  // Diagonal b--c, same topology the prototype bed renders. Winding faces +Y.
  const triangles: number[][] = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const a = z * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
    triangles.push([a, c, b], [b, c, d]);
    if (x === n - 1) yield;
  }
  const start = (Math.floor(sz) * n + Math.floor(sx)) * 2 + ((sx % 1) + (sz % 1) > 1 ? 1 : 0);
  const first = triangles[start]!.map(i => vertices[i]!);
  if (first.some(v => !Number.isFinite(v.h))) return empty("missing-terrain");
  const fx = sx % 1, fz = sz % 1;
  const seedBed = start % 2 === 0
    ? first[0]!.h * (1 - fx - fz) + first[1]!.h * fz + first[2]!.h * fx
    : first[0]!.h * (1 - fz) + first[1]!.h * (1 - fx) + first[2]!.h * (fx + fz - 1);
  if (seedBed >= level) return empty("dry");
  const edges = new Map<string, number[]>();
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (let index = 0; index < triangles.length; index++) {
    const t = triangles[index]!;
    for (let i = 0; i < 3; i++) {
      const k = key(t[i]!, t[(i + 1) % 3]!);
      const list = edges.get(k);
      if (list) list.push(index); else edges.set(k, [index]);
    }
    if (index % 128 === 0) yield;
  }
  const queue = [start], visited = new Set(queue);
  const positions: number[] = [], depths: number[] = [], shore: number[] = [];
  let area = 0;
  const faces = new Uint8Array(n * n);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const t = triangles[queue[cursor]!]!;
    if (t.some(i => !Number.isFinite(vertices[i]!.h))) return empty("missing-terrain");
    for (let i = 0; i < 3; i++) {
      const a = t[i]!, b = t[(i + 1) % 3]!;
      if (Math.min(vertices[a]!.h, vertices[b]!.h) >= level) continue;
      const neighbours = edges.get(key(a, b))!;
      if (neighbours.length === 1) return empty("open-boundary");
      for (const next of neighbours) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    const polygon: Vertex[] = [], crossings: Vertex[] = [];
    const face = queue[cursor]!;
    faces[Math.floor(face / 2)]! |= 1 << (face % 2);
    for (let i = 0; i < 3; i++) {
      const a = vertices[t[i]!]!, b = vertices[t[(i + 1) % 3]!]!;
      if (a.h < level) polygon.push(a);
      if ((a.h < level) !== (b.h < level)) {
        const f = (level - a.h) / (b.h - a.h);
        const cut = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: level };
        polygon.push(cut); crossings.push(cut);
      }
    }
    if (crossings.length === 2 && Math.hypot(crossings[0]!.x - crossings[1]!.x, crossings[0]!.z - crossings[1]!.z) > 1e-8) {
      shore.push(crossings[0]!.x, crossings[0]!.z, crossings[1]!.x, crossings[1]!.z);
    }
    for (let i = 1; i + 1 < polygon.length; i++) {
      const a = polygon[0]!, b = polygon[i]!, c = polygon[i + 1]!;
      const triangleArea = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
      if (triangleArea < 1e-12) continue;
      area += triangleArea;
      for (const v of [a, b, c]) { positions.push(v.x, level, v.z); depths.push(Math.max(0, level - v.h)); }
    }
    if (cursor % 128 === 0) yield;
  }
  return { status: "ready", positions: new Float32Array(positions), depths: new Float32Array(depths), area,
    shore: new Float32Array(shore),
    coverage: { region, bed: Float32Array.from(vertices, v => v.h), triangles: faces, cells: n } };
}

/** Exact triangle query against the published connected surface, for water contacts. */
export function samplePuddleWater(data: TerrainPuddleGeometry, x: number, z: number): { level: number; bed: number; depth: number } | null {
  const c = data.coverage; if (!c) return null;
  const { region: r, cells: n, bed } = c;
  const gx = (x - r.minX) / r.cellSize, gz = (z - r.minZ) / r.cellSize;
  if (!(gx >= 0 && gz >= 0 && gx < n && gz < n)) return null;
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const face = fx + fz <= 1 ? 1 : 2;
  if (!(c.triangles[iz * n + ix]! & face)) return null;
  const a = iz * (n + 1) + ix, h = face === 1 ? bed[a]! * (1 - fx - fz) + bed[a + 1]! * fx + bed[a + n + 1]! * fz
    : bed[a + n + 2]! * (fx + fz - 1) + bed[a + n + 1]! * (1 - fx) + bed[a + 1]! * (1 - fz);
  return h < r.level ? { level: r.level, bed: h, depth: r.level - h } : null;
}
