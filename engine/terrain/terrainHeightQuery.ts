import type { Vec3 } from "../scene/layout";
import type { TerrainGlobalMap } from "./terrainGlobalMap";
import {
  terrainTileHeightRange,
  terrainTileLayerWeight,
  tileKey,
  type TerrainTileData,
  type WorldTerrainDef,
} from "./terrainTypes";

/**
 * CPU queries against loaded World Terrain tiles (OPEN_WORLD_PLAN K2/K3): exact
 * height, face/smooth normals, paint weights and a heightfield raycast. These
 * replace three.js mesh raycasts (the GPU-displaced terrain has no CPU
 * geometry) and the physics triangle list for terrain ground probes.
 *
 * Triangulation matches the render mesh and the legacy Landscape collider: a
 * cell with corners a=(x,z) b=(x+1,z) c=(x,z+1) d=(x+1,z+1) is split along the
 * b–c diagonal into triangles (a,c,b) and (b,c,d), so a sampled height is the
 * height of the surface that is drawn and collided with, not a bilinear blend.
 *
 * A query over a missing (hole or unloaded) tile returns `null`, unless a
 * raycast is given a coarse global map for unloaded tiles.
 */

export type TerrainQueryDef = Pick<WorldTerrainDef, "tileQuads" | "spacing" | "tilesX" | "tilesZ" | "origin">;

export interface TerrainTileLookup {
  tile(x: number, z: number): TerrainTileData | undefined;
}

/** Map-backed {@link TerrainTileLookup}, the resident tile set. */
export class TerrainTileMap implements TerrainTileLookup {
  private readonly tiles = new Map<string, TerrainTileData>();

  tile(x: number, z: number): TerrainTileData | undefined {
    return this.tiles.get(tileKey(x, z));
  }

  set(tile: TerrainTileData): void {
    this.tiles.set(tileKey(tile.x, tile.z), tile);
  }

  delete(x: number, z: number): boolean {
    return this.tiles.delete(tileKey(x, z));
  }

  values(): IterableIterator<TerrainTileData> {
    return this.tiles.values();
  }

  get size(): number {
    return this.tiles.size;
  }
}

interface CellLocation {
  tile: TerrainTileData;
  /** Cell index within the tile (`0..tileQuads-1`). */
  cx: number;
  cz: number;
  /** Position inside the cell, `0..1`. */
  fx: number;
  fz: number;
}

/**
 * Tile indices that hold grid coordinate `g` on one axis: its owner, plus the
 * previous tile when `g` sits exactly on their shared (duplicated) edge.
 */
function tileCandidates(g: number, q: number, tiles: number): number[] {
  const owner = Math.min(Math.floor(g / q), tiles - 1);
  return owner > 0 && g === owner * q ? [owner, owner - 1] : [owner];
}

function locateCell(def: TerrainQueryDef, tiles: TerrainTileLookup, worldX: number, worldZ: number): CellLocation | null {
  const q = def.tileQuads;
  const gx = (worldX - def.origin[0]) / def.spacing;
  const gz = (worldZ - def.origin[2]) / def.spacing;
  if (!(gx >= 0 && gz >= 0 && gx <= def.tilesX * q && gz <= def.tilesZ * q)) return null;
  // On a seam either neighbour's copy is exact; fall back when the owner is not resident.
  for (const tz of tileCandidates(gz, q, def.tilesZ)) {
    for (const tx of tileCandidates(gx, q, def.tilesX)) {
      const tile = tiles.tile(tx, tz);
      if (!tile) continue;
      const lx = gx - tx * q;
      const lz = gz - tz * q;
      const cx = Math.min(Math.floor(lx), q - 1);
      const cz = Math.min(Math.floor(lz), q - 1);
      return { tile, cx, cz, fx: lx - cx, fz: lz - cz };
    }
  }
  return null;
}

function cellHeights(tile: TerrainTileData, cx: number, cz: number): [number, number, number, number] {
  const row = cz * tile.size + cx;
  const h = tile.heights;
  return [h[row]!, h[row + 1]!, h[row + tile.size]!, h[row + tile.size + 1]!];
}

/** Surface height relative to the terrain datum inside one cell (no origin offset). */
function heightInCell(ha: number, hb: number, hc: number, hd: number, fx: number, fz: number): number {
  if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
  return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
}

/**
 * Exact world-space surface height at X/Z — the collider's height, for
 * physics, movement, foliage placement and deformation — or `null` off-terrain
 * / over a missing tile.
 */
export function terrainHeightAt(def: TerrainQueryDef, tiles: TerrainTileLookup, worldX: number, worldZ: number): number | null {
  const cell = locateCell(def, tiles, worldX, worldZ);
  if (!cell) return null;
  const [ha, hb, hc, hd] = cellHeights(cell.tile, cell.cx, cell.cz);
  return def.origin[1] + heightInCell(ha, hb, hc, hd, cell.fx, cell.fz);
}

/**
 * Bilinear height, smoother than the surface by up to `twist / 4` per cell
 * (OPEN_WORLD_PLAN K3a). Visual-only uses — never anything that must sit on
 * or collide with the ground.
 */
export function terrainHeightAtSmooth(def: TerrainQueryDef, tiles: TerrainTileLookup, worldX: number, worldZ: number): number | null {
  const cell = locateCell(def, tiles, worldX, worldZ);
  if (!cell) return null;
  const [ha, hb, hc, hd] = cellHeights(cell.tile, cell.cx, cell.cz);
  const top = ha + (hb - ha) * cell.fx;
  const bottom = hc + (hd - hc) * cell.fx;
  return def.origin[1] + top + (bottom - top) * cell.fz;
}

function normalizeVec(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/** Up-facing normal of the triangle under X/Z (what physics collides with). */
export function terrainFaceNormalAt(def: TerrainQueryDef, tiles: TerrainTileLookup, worldX: number, worldZ: number): Vec3 | null {
  const cell = locateCell(def, tiles, worldX, worldZ);
  if (!cell) return null;
  const [ha, hb, hc, hd] = cellHeights(cell.tile, cell.cx, cell.cz);
  const s = def.spacing;
  const lower = cell.fx + cell.fz <= 1;
  const slopeX = lower ? (hb - ha) / s : (hd - hc) / s;
  const slopeZ = lower ? (hc - ha) / s : (hd - hb) / s;
  return normalizeVec(-slopeX, 1, -slopeZ);
}

/** Height of global grid vertex (gx, gz), resolved through whichever tile owns it. */
function vertexHeight(def: TerrainQueryDef, tiles: TerrainTileLookup, gx: number, gz: number): number | undefined {
  const q = def.tileQuads;
  if (gx < 0 || gz < 0 || gx > def.tilesX * q || gz > def.tilesZ * q) return undefined;
  for (const tz of tileCandidates(gz, q, def.tilesZ)) {
    for (const tx of tileCandidates(gx, q, def.tilesX)) {
      const tile = tiles.tile(tx, tz);
      if (tile) return tile.heights[(gz - tz * q) * tile.size + (gx - tx * q)];
    }
  }
  return undefined;
}

/**
 * Smooth (vertex central-difference) normal at the nearest vertex — the shading
 * normal the renderer uses; foliage alignment reads this. A missing neighbour
 * (world edge, unloaded tile) falls back to a one-sided difference.
 */
export function terrainSmoothNormalAt(def: TerrainQueryDef, tiles: TerrainTileLookup, worldX: number, worldZ: number): Vec3 | null {
  const gx = Math.round((worldX - def.origin[0]) / def.spacing);
  const gz = Math.round((worldZ - def.origin[2]) / def.spacing);
  const center = vertexHeight(def, tiles, gx, gz);
  if (center === undefined) return null;
  const left = vertexHeight(def, tiles, gx - 1, gz) ?? center;
  const right = vertexHeight(def, tiles, gx + 1, gz) ?? center;
  const up = vertexHeight(def, tiles, gx, gz - 1) ?? center;
  const down = vertexHeight(def, tiles, gx, gz + 1) ?? center;
  return normalizeVec(left - right, 2 * def.spacing, up - down);
}

/**
 * Bilinear paint weights (`0..1`, one per tile layer) at X/Z. Pass `out` to
 * reuse an array on a per-step path; it is truncated to the tile's layer count.
 */
export function terrainLayerWeightsAt(
  def: TerrainQueryDef, tiles: TerrainTileLookup, worldX: number, worldZ: number, out: number[] = [],
): number[] | null {
  const cell = locateCell(def, tiles, worldX, worldZ);
  if (!cell) return null;
  const { tile, cx, cz, fx, fz } = cell;
  const a = cz * tile.size + cx;
  const b = a + 1;
  const c = a + tile.size;
  const d = c + 1;
  out.length = tile.layerCount;
  for (let layer = 0; layer < tile.layerCount; layer += 1) {
    const top = terrainTileLayerWeight(tile, layer, a) * (1 - fx) + terrainTileLayerWeight(tile, layer, b) * fx;
    const bottom = terrainTileLayerWeight(tile, layer, c) * (1 - fx) + terrainTileLayerWeight(tile, layer, d) * fx;
    out[layer] = top * (1 - fz) + bottom * fz;
  }
  return out;
}

// --- Raycast ------------------------------------------------------------------

export interface TerrainRayHit {
  /** Distance along the normalized ray direction. */
  distance: number;
  point: Vec3;
  /** Face normal of the hit triangle. */
  normal: Vec3;
  tileX: number;
  tileZ: number;
  approximate?: boolean;
}

const tileRangeCache = new WeakMap<TerrainTileData, { min: number; max: number }>();

/**
 * Cached height range of a tile. Editors that mutate `heights` in place must
 * call {@link invalidateTerrainTileRange} so raycasts don't skip a raised area.
 */
function tileRange(tile: TerrainTileData): { min: number; max: number } {
  let range = tileRangeCache.get(tile);
  if (!range) {
    range = terrainTileHeightRange(tile);
    tileRangeCache.set(tile, range);
  }
  return range;
}

export function invalidateTerrainTileRange(tile: TerrainTileData): void {
  tileRangeCache.delete(tile);
}

/** Möller–Trumbore, front faces only (terrain is hit from above). */
function intersectTriangle(origin: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const px = dir[1] * e2z - dir[2] * e2y;
  const py = dir[2] * e2x - dir[0] * e2z;
  const pz = dir[0] * e2y - dir[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  // Winding (a, c, b) faces up, so a downward ray sees det > 0 here.
  if (det <= 1e-12) return null;
  const inv = 1 / det;
  const tx = origin[0] - a[0], ty = origin[1] - a[1], tz = origin[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 ? t : null;
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const n = normalizeVec(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
  return n[1] < 0 ? [-n[0], -n[1], -n[2]] : n;
}

/** Ray parameter interval where `start + dir·t` lies in `[lo, hi]` on one axis. */
function slab(start: number, dir: number, lo: number, hi: number): [number, number] {
  if (Math.abs(dir) < 1e-12) return start >= lo && start <= hi ? [-Infinity, Infinity] : [Infinity, -Infinity];
  const t0 = (lo - start) / dir;
  const t1 = (hi - start) / dir;
  return t0 < t1 ? [t0, t1] : [t1, t0];
}

/**
 * First front-face hit within `maxDistance`, optionally using a coarse global
 * map for unloaded terrain tiles.
 * Walks tiles along the ray, skipping any tile the ray passes entirely above
 * (its cached height range), then walks that tile's cells with a 2D DDA and
 * tests only cells whose corner heights the ray's height span overlaps.
 */
export function raycastTerrain(
  def: TerrainQueryDef,
  tiles: TerrainTileLookup,
  origin: Vec3,
  direction: Vec3,
  maxDistance = Infinity,
  coarse?: TerrainGlobalMap,
): TerrainRayHit | null {
  const dir = normalizeVec(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(dir[0] + dir[1] + dir[2]) || (dir[0] === 0 && dir[1] === 0 && dir[2] === 0)) return null;
  const q = def.tileQuads;
  const s = def.spacing;
  const tileSize = q * s;
  const [ox, oy, oz] = [origin[0] - def.origin[0], origin[1] - def.origin[1], origin[2] - def.origin[2]];
  const [x0, x1] = slab(ox, dir[0], 0, def.tilesX * tileSize);
  const [z0, z1] = slab(oz, dir[2], 0, def.tilesZ * tileSize);
  let t = Math.max(0, x0, z0);
  const tEnd = Math.min(maxDistance, x1, z1);
  if (!(t <= tEnd)) return null;

  const yAt = (param: number): number => oy + dir[1] * param;
  const corner = (tile: TerrainTileData, tx: number, tz: number, vx: number, vz: number): Vec3 => [
    def.origin[0] + (tx * q + vx) * s,
    def.origin[1] + tile.heights[vz * tile.size + vx]!,
    def.origin[2] + (tz * q + vz) * s,
  ];

  const nudge = 1e-6 * s;
  for (let guard = 0; t <= tEnd && guard < 4 * (def.tilesX + def.tilesZ) + 4; guard += 1) {
    const px = ox + dir[0] * (t + nudge);
    const pz = oz + dir[2] * (t + nudge);
    const tx = Math.min(Math.max(Math.floor(px / tileSize), 0), def.tilesX - 1);
    const tz = Math.min(Math.max(Math.floor(pz / tileSize), 0), def.tilesZ - 1);
    const [, tileExitX] = slab(ox, dir[0], tx * tileSize, (tx + 1) * tileSize);
    const [, tileExitZ] = slab(oz, dir[2], tz * tileSize, (tz + 1) * tileSize);
    const segEnd = Math.min(tEnd, tileExitX, tileExitZ);
    const tile = tiles.tile(tx, tz);
    if (tile) {
      const range = tileRange(tile);
      if (Math.min(yAt(t), yAt(segEnd)) <= range.max) {
        const hit = marchTileCells(tile, tx, tz, t, segEnd);
        if (hit) return hit;
      }
    } else if (coarse) {
      const hit = marchCoarseCells(coarse, tx, tz, t, segEnd);
      if (hit) return hit;
    }
    if (segEnd >= tEnd) break;
    t = segEnd;
  }
  return null;

  function marchCoarseCells(map: TerrainGlobalMap, tx: number, tz: number, tStart: number, tStop: number): TerrainRayHit | null {
    const spacing = map.stride * s;
    const gx = (ox + dir[0] * (tStart + nudge)) / spacing;
    const gz = (oz + dir[2] * (tStart + nudge)) / spacing;
    let cx = Math.min(Math.max(Math.floor(gx), 0), map.width - 2);
    let cz = Math.min(Math.max(Math.floor(gz), 0), map.height - 2);
    const dgx = dir[0] / spacing;
    const dgz = dir[2] / spacing;
    const stepX = dgx > 0 ? 1 : -1;
    const stepZ = dgz > 0 ? 1 : -1;
    const deltaX = Math.abs(dgx) < 1e-12 ? Infinity : 1 / Math.abs(dgx);
    const deltaZ = Math.abs(dgz) < 1e-12 ? Infinity : 1 / Math.abs(dgz);
    let nextX = Math.abs(dgx) < 1e-12 ? Infinity : tStart + nudge + ((dgx > 0 ? cx + 1 - gx : gx - cx) * deltaX);
    let nextZ = Math.abs(dgz) < 1e-12 ? Infinity : tStart + nudge + ((dgz > 0 ? cz + 1 - gz : gz - cz) * deltaZ);
    let cellStart = tStart;
    while (cellStart <= tStop && cx >= 0 && cz >= 0 && cx < map.width - 1 && cz < map.height - 1) {
      const cellEnd = Math.min(nextX, nextZ, tStop);
      const row = cz * map.width + cx;
      const [ha, hb, hc, hd] = [map.heights[row]!, map.heights[row + 1]!, map.heights[row + map.width]!, map.heights[row + map.width + 1]!];
      const rayLow = origin[1] + dir[1] * (dir[1] < 0 ? cellEnd : cellStart);
      if (![ha, hb, hc, hd].some(Number.isNaN) && rayLow <= Math.max(ha, hb, hc, hd) + 1e-6) {
        // Global samples already include the terrain's Y datum.
        const x = def.origin[0] + cx * spacing;
        const z = def.origin[2] + cz * spacing;
        const a: Vec3 = [x, ha, z];
        const b: Vec3 = [x + spacing, hb, z];
        const c: Vec3 = [x, hc, z + spacing];
        const d: Vec3 = [x + spacing, hd, z + spacing];
        let best: { t: number; tri: [Vec3, Vec3, Vec3] } | null = null;
        for (const tri of [[a, c, b], [b, c, d]] as [Vec3, Vec3, Vec3][]) {
          const hitT = intersectTriangle(origin, dir, tri[0], tri[1], tri[2]);
          if (hitT !== null && hitT >= tStart && hitT <= tStop && hitT <= maxDistance && (!best || hitT < best.t)) best = { t: hitT, tri };
        }
        if (best) {
          return {
            distance: best.t,
            point: [origin[0] + dir[0] * best.t, origin[1] + dir[1] * best.t, origin[2] + dir[2] * best.t],
            normal: faceNormal(best.tri[0], best.tri[1], best.tri[2]),
            tileX: tx,
            tileZ: tz,
            approximate: true,
          };
        }
      }
      if (cellEnd >= tStop) break;
      cellStart = cellEnd;
      if (nextX < nextZ) {
        cx += stepX;
        nextX += deltaX;
      } else {
        cz += stepZ;
        nextZ += deltaZ;
      }
    }
    return null;
  }

  function marchTileCells(tile: TerrainTileData, tx: number, tz: number, tStart: number, tStop: number): TerrainRayHit | null {
    // Cell coordinates local to this tile, in grid units.
    const gx = (ox + dir[0] * (tStart + nudge)) / s - tx * q;
    const gz = (oz + dir[2] * (tStart + nudge)) / s - tz * q;
    let cx = Math.min(Math.max(Math.floor(gx), 0), q - 1);
    let cz = Math.min(Math.max(Math.floor(gz), 0), q - 1);
    const dgx = dir[0] / s;
    const dgz = dir[2] / s;
    const stepX = dgx > 0 ? 1 : -1;
    const stepZ = dgz > 0 ? 1 : -1;
    const deltaX = Math.abs(dgx) < 1e-12 ? Infinity : 1 / Math.abs(dgx);
    const deltaZ = Math.abs(dgz) < 1e-12 ? Infinity : 1 / Math.abs(dgz);
    let nextX = Math.abs(dgx) < 1e-12 ? Infinity : tStart + ((dgx > 0 ? cx + 1 - gx : gx - cx) * deltaX);
    let nextZ = Math.abs(dgz) < 1e-12 ? Infinity : tStart + ((dgz > 0 ? cz + 1 - gz : gz - cz) * deltaZ);
    let cellStart = tStart;
    while (cellStart <= tStop && cx >= 0 && cz >= 0 && cx < q && cz < q) {
      const cellEnd = Math.min(nextX, nextZ, tStop);
      const [ha, hb, hc, hd] = cellHeights(tile, cx, cz);
      const rayLow = Math.min(yAt(cellStart), yAt(cellEnd));
      if (rayLow <= Math.max(ha, hb, hc, hd) + 1e-6) {
        const a = corner(tile, tx, tz, cx, cz);
        const b = corner(tile, tx, tz, cx + 1, cz);
        const c = corner(tile, tx, tz, cx, cz + 1);
        const d = corner(tile, tx, tz, cx + 1, cz + 1);
        let best: { t: number; tri: [Vec3, Vec3, Vec3] } | null = null;
        for (const tri of [[a, c, b], [b, c, d]] as [Vec3, Vec3, Vec3][]) {
          const hitT = intersectTriangle(origin, dir, tri[0], tri[1], tri[2]);
          if (hitT !== null && hitT <= maxDistance && (!best || hitT < best.t)) best = { t: hitT, tri };
        }
        if (best) {
          return {
            distance: best.t,
            point: [origin[0] + dir[0] * best.t, origin[1] + dir[1] * best.t, origin[2] + dir[2] * best.t],
            normal: faceNormal(best.tri[0], best.tri[1], best.tri[2]),
            tileX: tx,
            tileZ: tz,
          };
        }
      }
      if (cellEnd >= tStop) break;
      cellStart = cellEnd;
      if (nextX < nextZ) {
        cx += stepX;
        nextX += deltaX;
      } else {
        cz += stepZ;
        nextZ += deltaZ;
      }
    }
    return null;
  }
}
