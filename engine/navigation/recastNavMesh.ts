/**
 * Tiled Recast/Detour navigation mesh (OPEN_WORLD_PLAN Faz 9).
 *
 * Pure engine module: no DOM, Three.js or editor imports. The wasm library is
 * never imported statically — {@link loadRecastModules} pulls it in on demand,
 * so a level without AI never downloads it and the game bundle only carries a
 * lazy chunk.
 *
 * The mesh is built tile by tile. Each tile asks a {@link NavTriangleSource}
 * for the static triangles inside its rectangle (plus Recast's border, so
 * neighbouring tiles stitch), voxelizes them and adds the result to one Detour
 * mesh. Tiles can be built, dropped and rebuilt independently; that is what
 * lets the host keep only the tiles around its "invokers" (AI pawns, the
 * player) loaded in an open world (Unreal's Navigation Invoker).
 *
 * Agent contract matches {@link NavAgent} and the grid planner it replaces:
 * `radius + clearancePadding` erodes walls, `height` is the required headroom,
 * `stepHeight` is the climbable ledge and `maxSlopeAngleDeg` the walkable
 * slope. Detour has one symmetric climb, so `maxStepDown` is not modelled; a
 * drop off a ledge higher than `stepHeight` is never planned.
 *
 * Path points are Detour's string-pulled corners. Their heights come from the
 * voxelized poly mesh and can sit up to a cell height off the real floor, so a
 * host whose follower compares heights tightly should snap them to its own
 * ground query.
 */
import type * as RecastCore from "@recast-navigation/core";
import type { Vec3 } from "../scene/layout";
import type { NavAabb, NavAgent, NavVec2, PathResult } from "./gridNavigation";
import {
  buildRecastTileBytes,
  createTileRcConfig,
  recastTileConfigFor,
  type RecastObstacleVolume,
  type RecastRcConfig,
  type RecastTileConfig,
  type RecastTileInput,
} from "./recastTileBuild";

export interface RecastModules {
  readonly core: typeof RecastCore;
}

let modulesPromise: Promise<RecastModules> | null = null;

/** Loads and initializes the wasm library once; every caller shares the promise. */
export function loadRecastModules(): Promise<RecastModules> {
  modulesPromise ??= (async () => {
    const core = await import("@recast-navigation/core");
    await core.init();
    return { core };
  })();
  return modulesPromise;
}

/**
 * Static navigation geometry, queried per tile. Triangles use Recast's
 * winding: `(b - a) × (c - a)` points away from the solid, so a floor faces up.
 * A surface that must never be walked on (an `obstacleOnly` body) is emitted
 * facing down and also reported by `forEachObstacleInRect`: Recast turns a
 * non-walkable top lower than the step height back into floor (a kerb), so
 * only an explicit null-area volume keeps a low obstacle off the mesh.
 */
export interface NavTriangleSource {
  forEachTriangleInRect(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    visit: (a: Vec3, b: Vec3, c: Vec3) => void,
  ): void;
  /** Volumes whose floor must never be walkable: a convex XZ footprint and its Y span. */
  forEachObstacleInRect?(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    visit: (footprint: readonly NavVec2[], minY: number, maxY: number) => void,
  ): void;
}

export interface RecastNavMeshOptions {
  /** Tile edge in world units. Default 32 (four tiles per default 128 m partition cell). */
  readonly tileSize?: number;
  /** Voxel size in X/Z. Default 0.2; `tileSize` must be a whole number of cells. */
  readonly cellSize?: number;
  /** Voxel size in Y. Default 0.1. */
  readonly cellHeight?: number;
  /**
   * Authored navigation bounds (AI Navigation Volumes). When present only tiles
   * overlapping a bound are built and path endpoints must lie inside one, as
   * with the grid planner.
   */
  readonly bounds?: readonly NavAabb[];
  /** Detail-mesh sampling in cells / cell heights (see {@link RecastTileConfigOptions}). */
  readonly detailSampleCells?: number;
  readonly detailSampleErrorCells?: number;
}

export interface RecastTileCoord {
  readonly x: number;
  readonly z: number;
}

const DEFAULT_TILE_SIZE = 32;
const DEFAULT_CELL_SIZE = 0.2;
const DEFAULT_CELL_HEIGHT = 0.1;
/** Detour poly refs are 32-bit: 22 bits shared by tile index and poly index. */
const TILE_BITS = 10;
const POLY_BITS = 22 - TILE_BITS;
const MAX_PATH_POLYS = 1024;
const MAX_STRAIGHT_PATH_POINTS = 512;

export function recastTileKey(x: number, z: number): string {
  return `${x}_${z}`;
}

/** One tiled Detour mesh for one agent profile. Call {@link dispose} when done. */
export class RecastNavMesh {
  readonly tileSize: number;
  readonly cellSize: number;
  readonly cellHeight: number;
  readonly agent: NavAgent;
  private readonly modules: RecastModules;
  private readonly source: NavTriangleSource;
  private readonly bounds: readonly NavAabb[] | undefined;
  private readonly navMesh: RecastCore.NavMesh;
  private readonly query: RecastCore.NavMeshQuery;
  private readonly rcConfig: RecastRcConfig;
  /** The plain agent/voxel description a worker rebuilds this mesh's config from. */
  readonly tileConfig: RecastTileConfig;
  /** Tile key → Detour tile ref; `0` marks a built tile that produced no polygons. */
  private readonly tiles = new Map<string, number>();
  /** Loaded tiles whose source geometry changed; still searchable until rebuilt. */
  private readonly stale = new Set<string>();
  /** Last time (host seconds) each loaded tile was wanted, for eviction. */
  private readonly lastUsed = new Map<string, number>();
  /**
   * Geometry generation per tile, bumped when its input changes (and for
   * every tile by {@link markAllStale}): a build started before the change
   * carries the old generation and its result is discarded.
   */
  private readonly generations = new Map<string, number>();
  private epoch = 0;
  private revision = 0;
  private disposed = false;

  constructor(modules: RecastModules, agent: NavAgent, source: NavTriangleSource, options: RecastNavMeshOptions = {}) {
    const { core } = modules;
    this.modules = modules;
    this.agent = agent;
    this.source = source;
    this.cellSize = positiveOr(options.cellSize, DEFAULT_CELL_SIZE);
    this.cellHeight = positiveOr(options.cellHeight, DEFAULT_CELL_HEIGHT);
    const tileCells = Math.max(16, Math.round(positiveOr(options.tileSize, DEFAULT_TILE_SIZE) / this.cellSize));
    this.tileSize = tileCells * this.cellSize;
    this.bounds = options.bounds && options.bounds.length > 0 ? options.bounds : undefined;

    this.tileConfig = recastTileConfigFor(agent, {
      cellSize: this.cellSize,
      cellHeight: this.cellHeight,
      tileCells,
      ...(options.detailSampleCells !== undefined ? { detailSampleCells: options.detailSampleCells } : {}),
      ...(options.detailSampleErrorCells !== undefined ? { detailSampleErrorCells: options.detailSampleErrorCells } : {}),
    });
    this.rcConfig = createTileRcConfig(core, this.tileConfig);

    this.navMesh = new core.NavMesh();
    const params = core.NavMeshParams.create({
      orig: { x: 0, y: 0, z: 0 },
      tileWidth: this.tileSize,
      tileHeight: this.tileSize,
      maxTiles: 1 << TILE_BITS,
      maxPolys: 1 << POLY_BITS,
    });
    if (!this.navMesh.initTiled(params)) throw new Error("Recast: could not initialize the tiled nav mesh");
    this.query = new core.NavMeshQuery(this.navMesh, { maxNodes: 4096 });
  }

  tileAt(x: number, z: number): RecastTileCoord {
    return { x: Math.floor(x / this.tileSize), z: Math.floor(z / this.tileSize) };
  }

  hasTile(x: number, z: number): boolean {
    return this.tiles.has(recastTileKey(x, z));
  }

  /** Missing, or loaded but stale. */
  needsBuild(x: number, z: number): boolean {
    const key = recastTileKey(x, z);
    return !this.tiles.has(key) || this.stale.has(key);
  }

  staleTileCount(): number {
    return this.stale.size;
  }

  /** Border (world units) a tile reads geometry from beyond its own edges. */
  get borderSize(): number {
    return this.rcConfig.borderSize * this.cellSize;
  }

  /**
   * Marks the loaded tiles whose input reaches into the rectangle (their own
   * area plus the border) as stale. Returns how many were marked.
   */
  markStaleInRect(minX: number, minZ: number, maxX: number, maxZ: number): number {
    const border = this.borderSize;
    let marked = 0;
    for (const tile of this.tilesInRect(minX - border, minZ - border, maxX + border, maxZ + border)) {
      const key = recastTileKey(tile.x, tile.z);
      // Loaded or not: a build of this tile in flight read the old geometry.
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
      if (!this.tiles.has(key) || this.stale.has(key)) continue;
      this.stale.add(key);
      marked += 1;
    }
    if (marked > 0) this.revision += 1;
    return marked;
  }

  markAllStale(): void {
    this.epoch += 1;
    for (const key of this.tiles.keys()) this.stale.add(key);
    if (this.tiles.size > 0) this.revision += 1;
  }

  /** Bumped whenever a tile is added, removed or turns stale: debug views redraw on a change. */
  get debugRevision(): number {
    return this.revision;
  }

  /** Loaded tiles awaiting a rebuild (debug). */
  staleTileKeys(): string[] {
    return [...this.stale];
  }

  /** Opaque geometry generation of a tile; compare before adding an asynchronously built result. */
  tileGeneration(x: number, z: number): string {
    return `${this.epoch}:${this.generations.get(recastTileKey(x, z)) ?? 0}`;
  }

  /** Records that a loaded tile is wanted at `now` (host seconds). */
  touchTile(x: number, z: number, now: number): void {
    const key = recastTileKey(x, z);
    if (this.tiles.has(key)) this.lastUsed.set(key, now);
  }

  /** Host seconds the tile was last wanted; -Infinity when never. */
  tileLastUsed(key: string): number {
    return this.lastUsed.get(key) ?? -Infinity;
  }

  loadedTileKeys(): string[] {
    return [...this.tiles.keys()];
  }

  /** True when the tile overlaps an authored bound, or there are none. */
  tileInBounds(x: number, z: number): boolean {
    if (!this.bounds) return true;
    const minX = x * this.tileSize;
    const minZ = z * this.tileSize;
    return this.bounds.some((bound) =>
      bound.max[0] >= minX && bound.min[0] <= minX + this.tileSize &&
      bound.max[2] >= minZ && bound.min[2] <= minZ + this.tileSize);
  }

  /** Every tile coordinate overlapping the XZ rectangle and the authored bounds. */
  tilesInRect(minX: number, minZ: number, maxX: number, maxZ: number): RecastTileCoord[] {
    const from = this.tileAt(minX, minZ);
    const to = this.tileAt(maxX, maxZ);
    const tiles: RecastTileCoord[] = [];
    for (let z = from.z; z <= to.z; z += 1) {
      for (let x = from.x; x <= to.x; x += 1) {
        if (this.tileInBounds(x, z)) tiles.push({ x, z });
      }
    }
    return tiles;
  }

  /**
   * Builds the missing or stale tiles overlapping the rectangle, nearest to its centre
   * first, stopping after `maxBuilds`. Returns how many were built.
   */
  ensureTilesInRect(minX: number, minZ: number, maxX: number, maxZ: number, maxBuilds = Infinity): number {
    const cx = (minX + maxX) / 2 / this.tileSize - 0.5;
    const cz = (minZ + maxZ) / 2 / this.tileSize - 0.5;
    const missing = this.tilesInRect(minX, minZ, maxX, maxZ)
      .filter((tile) => this.needsBuild(tile.x, tile.z))
      .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
    let built = 0;
    for (const tile of missing) {
      if (built >= maxBuilds) break;
      this.buildTile(tile.x, tile.z);
      built += 1;
    }
    return built;
  }

  /** (Re)builds one tile from the triangle source. Returns false when it has no walkable polygons. */
  buildTile(x: number, z: number): boolean {
    this.assertLive();
    const input = this.gatherTileInput(x, z);
    const bytes = input ? buildRecastTileBytes(this.modules.core, this.rcConfig, this.tileConfig, input) : null;
    return this.addTileBytes(x, z, bytes);
  }

  /**
   * The tile's input from the triangle source: its square plus the border.
   * Null when nothing there could become floor (no triangles).
   */
  gatherTileInput(x: number, z: number): RecastTileInput | null {
    this.assertLive();
    const border = this.borderSize;
    const rect = {
      minX: x * this.tileSize - border,
      minZ: z * this.tileSize - border,
      maxX: (x + 1) * this.tileSize + border,
      maxZ: (z + 1) * this.tileSize + border,
    };
    const positions: number[] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    this.source.forEachTriangleInRect(rect.minX, rect.minZ, rect.maxX, rect.maxZ, (a, b, c) => {
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      minY = Math.min(minY, a[1], b[1], c[1]);
      maxY = Math.max(maxY, a[1], b[1], c[1]);
    });
    if (positions.length === 0) return null;
    const obstacles: RecastObstacleVolume[] = [];
    this.source.forEachObstacleInRect?.(rect.minX, rect.minZ, rect.maxX, rect.maxZ, (footprint, low, high) => {
      if (footprint.length >= 3) obstacles.push({ footprint, minY: low, maxY: high });
    });
    return { tileX: x, tileZ: z, rect, minY, maxY, positions: new Float32Array(positions), obstacles };
  }

  /**
   * Replaces the tile with built Detour bytes (null: a built tile with no
   * walkable polygons). Keeps its usage stamp. Returns true when polygons were added.
   */
  addTileBytes(x: number, z: number, bytes: Uint8Array | null): boolean {
    this.assertLive();
    const key = recastTileKey(x, z);
    const used = this.lastUsed.get(key);
    this.removeTile(x, z);
    let tileRef = 0;
    if (bytes && bytes.length > 0) {
      const { core } = this.modules;
      const data = new core.UnsignedCharArray();
      data.copy(bytes);
      // DT_TILE_FREE_DATA: Detour owns (and frees) the buffer once added.
      const added = this.navMesh.addTile(data, core.Detour.DT_TILE_FREE_DATA, 0);
      if (core.statusFailed(added.status)) data.destroy();
      else tileRef = added.tileRef;
    }
    this.tiles.set(key, tileRef);
    if (used !== undefined) this.lastUsed.set(key, used);
    this.revision += 1;
    return tileRef !== 0;
  }

  removeTile(x: number, z: number): void {
    const key = recastTileKey(x, z);
    const ref = this.tiles.get(key);
    if (ref === undefined) return;
    if (ref !== 0) this.navMesh.removeTile(ref);
    this.tiles.delete(key);
    this.stale.delete(key);
    this.lastUsed.delete(key);
    this.revision += 1;
  }

  /** Drops every loaded tile whose key is not in `keep`. Returns how many were dropped. */
  retainTiles(keep: ReadonlySet<string>): number {
    let dropped = 0;
    for (const key of [...this.tiles.keys()]) {
      if (keep.has(key)) continue;
      const [x, z] = key.split("_").map(Number) as [number, number];
      this.removeTile(x, z);
      dropped += 1;
    }
    return dropped;
  }

  /** Drops every tile; the next queries rebuild what they need. */
  clear(): void {
    this.retainTiles(new Set());
  }

  /** True when the point lies inside an authored bound (always true without bounds). */
  insideBounds(point: Vec3): boolean {
    if (!this.bounds) return true;
    return this.bounds.some((bound) =>
      point[0] >= bound.min[0] && point[0] <= bound.max[0] &&
      point[1] >= bound.min[1] && point[1] <= bound.max[1] &&
      point[2] >= bound.min[2] && point[2] <= bound.max[2]);
  }

  /**
   * Straight path over the loaded tiles. Tiles are not built here: a caller
   * that wants a path across unloaded ground ensures those tiles first.
   * `visited` reports the polygon corridor length.
   */
  findPath(start: Vec3, goal: Vec3): PathResult {
    this.assertLive();
    if (!this.insideBounds(start) || !this.insideBounds(goal)) return { status: "failure", points: [], visited: 0 };
    const search = Math.max(1, finiteOr(this.agent.height, 0));
    const halfExtents = { x: Math.max(1, this.tileSize / 16), y: search, z: Math.max(1, this.tileSize / 16) };
    const result = this.query.computePath(
      { x: start[0], y: start[1], z: start[2] },
      { x: goal[0], y: goal[1], z: goal[2] },
      { halfExtents, maxPathPolys: MAX_PATH_POLYS, maxStraightPathPoints: MAX_STRAIGHT_PATH_POINTS },
    );
    if (!result.success || result.path.length === 0) return { status: "failure", points: [], visited: 0 };
    // A partial corridor ends at the polygon nearest the goal; only a path that
    // actually reaches it counts, like the grid planner.
    const last = result.path[result.path.length - 1]!;
    if (Math.hypot(last.x - goal[0], last.z - goal[2]) > this.cellSize * 2 + finiteOr(this.agent.radius, 0)) {
      return { status: "failure", points: [], visited: result.path.length };
    }
    return {
      status: "success",
      points: result.path.map((point): Vec3 => [point.x, point.y, point.z]),
      visited: result.path.length,
    };
  }

  /** Triangles of the loaded nav mesh (debug drawing): flat XYZ positions + indices. */
  debugGeometry(): { positions: number[]; indices: number[] } {
    this.assertLive();
    const [positions, indices] = this.modules.core.getNavMeshPositionsAndIndices(this.navMesh);
    return { positions, indices };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.query.destroy();
    this.navMesh.destroy();
    this.modules.core.Raw.Module.destroy(this.rcConfig);
    this.tiles.clear();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Recast: nav mesh used after dispose");
  }
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
