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

interface NavObstacleVolume {
  readonly footprint: readonly NavVec2[];
  readonly minY: number;
  readonly maxY: number;
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
}

export interface RecastTileCoord {
  readonly x: number;
  readonly z: number;
}

const DEFAULT_TILE_SIZE = 32;
const DEFAULT_CELL_SIZE = 0.2;
const DEFAULT_CELL_HEIGHT = 0.1;
const DEFAULT_SLOPE_DEG = 50;
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
  private readonly rcConfig: ReturnType<typeof RecastCore.createRcConfig>;
  /** Tile key → Detour tile ref; `0` marks a built tile that produced no polygons. */
  private readonly tiles = new Map<string, number>();
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

    const radius = Math.max(0, finiteOr(agent.radius, 0)) + Math.max(0, finiteOr(agent.clearancePadding, 0));
    const walkableRadius = Math.ceil(radius / this.cellSize);
    const config = core.createRcConfig({
      ...core.recastConfigDefaults,
      cs: this.cellSize,
      ch: this.cellHeight,
      tileSize: tileCells,
      walkableRadius,
      walkableHeight: Math.max(1, Math.ceil(Math.max(0, finiteOr(agent.height, 0)) / this.cellHeight)),
      walkableClimb: Math.max(0, Math.floor(Math.max(0, finiteOr(agent.stepHeight, 0)) / this.cellHeight)),
      walkableSlopeAngle: finiteOr(agent.maxSlopeAngleDeg, DEFAULT_SLOPE_DEG),
      // Edge length in cells: about 12 m keeps long walls to a few vertices.
      maxEdgeLen: Math.round(12 / this.cellSize),
    });
    // The per-tile derivations of Recast's tiled sample: region areas are
    // authored as edge lengths, detail errors in cells, and the border keeps
    // the erosion of neighbouring geometry inside each tile.
    config.minRegionArea = config.minRegionArea * config.minRegionArea;
    config.mergeRegionArea = config.mergeRegionArea * config.mergeRegionArea;
    config.borderSize = walkableRadius + 3;
    config.width = tileCells + config.borderSize * 2;
    config.height = tileCells + config.borderSize * 2;
    config.detailSampleDist = config.detailSampleDist < 0.9 ? 0 : this.cellSize * config.detailSampleDist;
    config.detailSampleMaxError = this.cellHeight * config.detailSampleMaxError;
    this.rcConfig = config;

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
   * Builds the missing tiles overlapping the rectangle, nearest to its centre
   * first, stopping after `maxBuilds`. Returns how many were built.
   */
  ensureTilesInRect(minX: number, minZ: number, maxX: number, maxZ: number, maxBuilds = Infinity): number {
    const cx = (minX + maxX) / 2 / this.tileSize - 0.5;
    const cz = (minZ + maxZ) / 2 / this.tileSize - 0.5;
    const missing = this.tilesInRect(minX, minZ, maxX, maxZ)
      .filter((tile) => !this.hasTile(tile.x, tile.z))
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
    this.removeTile(x, z);
    const key = recastTileKey(x, z);
    const border = this.rcConfig.borderSize * this.cellSize;
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
    const obstacles: NavObstacleVolume[] = [];
    this.source.forEachObstacleInRect?.(rect.minX, rect.minZ, rect.maxX, rect.maxZ, (footprint, low, high) => {
      if (footprint.length >= 3) obstacles.push({ footprint, minY: low, maxY: high });
    });
    const data = positions.length === 0 ? null : this.buildTileData(x, z, rect, minY, maxY, positions, obstacles);
    let tileRef = 0;
    if (data) {
      const { core } = this.modules;
      const added = this.navMesh.addTile(data, core.Detour.DT_TILE_FREE_DATA, 0);
      if (core.statusFailed(added.status)) data.destroy();
      else tileRef = added.tileRef;
    }
    this.tiles.set(key, tileRef);
    return tileRef !== 0;
  }

  /**
   * Recast's per-tile pipeline (rasterize → filter → compact → erode → regions
   * → contours → poly mesh → detail mesh → Detour data). Obstacle volumes are
   * marked null before erosion so the agent radius keeps clear of them too.
   * Returns null when the tile has no walkable polygons.
   */
  private buildTileData(
    tileX: number,
    tileZ: number,
    rect: { minX: number; minZ: number; maxX: number; maxZ: number },
    minY: number,
    maxY: number,
    positions: readonly number[],
    obstacles: readonly NavObstacleVolume[],
  ): RecastCore.UnsignedCharArray | null {
    const { core } = this.modules;
    const config = this.rcConfig;
    const context = new core.RecastBuildContext(false);
    const triangleCount = positions.length / 9;
    const vertexCount = triangleCount * 3;
    const vertices = new core.VerticesArray();
    vertices.copy(new Float32Array(positions));
    const indices = new Int32Array(vertexCount);
    for (let i = 0; i < indices.length; i += 1) indices[i] = i;
    const triangles = new core.TrianglesArray();
    triangles.copy(indices);
    // markWalkableTriangles only sets walkable entries: start from RC_NULL_AREA.
    const areas = new core.TriangleAreasArray();
    areas.copy(new Uint8Array(triangleCount));
    const heightfield = core.allocHeightfield();
    const compact = core.allocCompactHeightfield();
    const contours = core.allocContourSet();
    const polyMesh = core.allocPolyMesh();
    const detail = core.allocPolyMeshDetail();
    try {
      const bmin: [number, number, number] = [rect.minX, minY - this.cellHeight, rect.minZ];
      const bmax: [number, number, number] = [rect.maxX, maxY + Math.max(1, finiteOr(this.agent.height, 0)), rect.maxZ];
      if (!core.createHeightfield(context, heightfield, config.width, config.height, bmin, bmax, config.cs, config.ch)) {
        return null;
      }
      core.markWalkableTriangles(context, config.walkableSlopeAngle, vertices, vertexCount, triangles, triangleCount, areas);
      if (!core.rasterizeTriangles(context, vertices, vertexCount, triangles, areas, triangleCount, heightfield,
        config.walkableClimb)) return null;
      core.filterLowHangingWalkableObstacles(context, config.walkableClimb, heightfield);
      core.filterLedgeSpans(context, config.walkableHeight, config.walkableClimb, heightfield);
      core.filterWalkableLowHeightSpans(context, config.walkableHeight, heightfield);
      if (!core.buildCompactHeightfield(context, config.walkableHeight, config.walkableClimb, heightfield, compact)) {
        return null;
      }
      for (const obstacle of obstacles) {
        const footprint = new core.VerticesArray();
        footprint.copy(new Float32Array(obstacle.footprint.flatMap(([px, pz]) => [px, obstacle.minY, pz])));
        // A floor belongs to the obstacle when it lies within its span, up to a
        // step above its top (where Recast's kerb filter lifts a low top to).
        core.markConvexPolyArea(context, footprint, obstacle.footprint.length, obstacle.minY - this.cellHeight,
          obstacle.maxY + (config.walkableClimb + 1) * this.cellHeight, core.Recast.RC_NULL_AREA, compact);
        footprint.destroy();
      }
      if (!core.erodeWalkableArea(context, config.walkableRadius, compact)) return null;
      if (!core.buildDistanceField(context, compact)) return null;
      if (!core.buildRegions(context, compact, config.borderSize, config.minRegionArea, config.mergeRegionArea)) {
        return null;
      }
      if (!core.buildContours(context, compact, config.maxSimplificationError, config.maxEdgeLen, contours,
        core.Recast.RC_CONTOUR_TESS_WALL_EDGES)) return null;
      if (!core.buildPolyMesh(context, contours, config.maxVertsPerPoly, polyMesh)) return null;
      if (polyMesh.npolys() === 0) return null;
      if (!core.buildPolyMeshDetail(context, polyMesh, compact, config.detailSampleDist, config.detailSampleMaxError,
        detail)) return null;
      for (let i = 0; i < polyMesh.npolys(); i += 1) {
        // One walkable area (0) with one "walk" flag; Detour's default filter takes it.
        if (polyMesh.areas(i) === core.Recast.RC_WALKABLE_AREA) polyMesh.setAreas(i, 0);
        if (polyMesh.areas(i) === 0) polyMesh.setFlags(i, 1);
      }
      const params = new core.NavMeshCreateParams();
      params.setPolyMeshCreateParams(polyMesh);
      params.setPolyMeshDetailCreateParams(detail);
      params.setWalkableHeight(config.walkableHeight * config.ch);
      params.setWalkableRadius(config.walkableRadius * config.cs);
      params.setWalkableClimb(config.walkableClimb * config.ch);
      params.setCellSize(config.cs);
      params.setCellHeight(config.ch);
      params.setBuildBvTree(true);
      params.setTileX(tileX);
      params.setTileY(tileZ);
      const created = core.createNavMeshData(params);
      core.Raw.Module.destroy(params.raw);
      return created.success ? created.navMeshData : null;
    } finally {
      vertices.destroy();
      triangles.destroy();
      areas.destroy();
      core.freeHeightfield(heightfield);
      core.freeCompactHeightfield(compact);
      core.freeContourSet(contours);
      core.freePolyMesh(polyMesh);
      core.freePolyMeshDetail(detail);
      core.Raw.Module.destroy(context.raw);
    }
  }

  removeTile(x: number, z: number): void {
    const key = recastTileKey(x, z);
    const ref = this.tiles.get(key);
    if (ref === undefined) return;
    if (ref !== 0) this.navMesh.removeTile(ref);
    this.tiles.delete(key);
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
