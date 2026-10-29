/**
 * One Recast nav tile from plain data (OPEN_WORLD_PLAN Faz 9, R3b).
 *
 * The tile build is split from {@link RecastNavMesh} so it can run anywhere
 * the wasm runs: on the main thread for a synchronous build, or in a Web
 * Worker with its own wasm instance. Everything crossing that boundary is
 * plain data — a {@link RecastTileConfig} describing the agent and voxel
 * grid, a {@link RecastTileInput} with the tile's triangles and obstacle
 * volumes — and the result is the Detour tile as bytes, which the owning mesh
 * adds with `addTile`. The same inputs give the same bytes on either side.
 *
 * Pure engine module: no DOM, Three.js or editor imports; the wasm module is
 * passed in.
 */
import type * as RecastCore from "@recast-navigation/core";
import type { NavAgent, NavVec2 } from "./navigationTypes";

type Core = typeof RecastCore;
export type RecastRcConfig = ReturnType<Core["createRcConfig"]>;

/** Agent + voxel grid of one nav mesh; identical for every tile of it. */
export interface RecastTileConfig {
  readonly cellSize: number;
  readonly cellHeight: number;
  /** Tile edge in cells. */
  readonly tileCells: number;
  /** Erosion in cells (agent radius + clearance padding). */
  readonly walkableRadius: number;
  /** Headroom in cells. */
  readonly walkableHeight: number;
  /** Climbable ledge in cells. */
  readonly walkableClimb: number;
  readonly walkableSlopeAngle: number;
  /** Detail-mesh sample spacing, in cells. */
  readonly detailSampleCells: number;
  /** Detail-mesh height error, in cell heights. */
  readonly detailSampleErrorCells: number;
  /** Extra headroom above the tile's geometry the voxel grid reaches, in world units. */
  readonly agentHeight: number;
}

export interface RecastObstacleVolume {
  readonly footprint: readonly NavVec2[];
  readonly minY: number;
  readonly maxY: number;
}

/** A tile's input, gathered on the thread that owns the physics world. */
export interface RecastTileInput {
  readonly tileX: number;
  readonly tileZ: number;
  /** The tile's square plus the border, in world X/Z. */
  readonly rect: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number };
  readonly minY: number;
  readonly maxY: number;
  /** Triangle soup, nine floats per triangle. */
  readonly positions: Float32Array;
  readonly obstacles: readonly RecastObstacleVolume[];
}

export interface RecastTileConfigOptions {
  readonly cellSize: number;
  readonly cellHeight: number;
  readonly tileCells: number;
  /**
   * Detail sampling. Recast's default (6 cells / 1 cell) was ~85% of a tile
   * build (78 ms on a 32 m terrain tile); 16 / 2 cut it to ~9 ms. Hosts snap
   * path corners to their real floor, so the default is the sparse one. A
   * sample distance of 0 crashes this wasm build's detail pass.
   */
  readonly detailSampleCells?: number;
  readonly detailSampleErrorCells?: number;
}

const DEFAULT_SLOPE_DEG = 50;
const DEFAULT_DETAIL_SAMPLE_CELLS = 16;
const DEFAULT_DETAIL_SAMPLE_ERROR_CELLS = 2;

export function recastTileConfigFor(agent: NavAgent, options: RecastTileConfigOptions): RecastTileConfig {
  const radius = Math.max(0, finiteOr(agent.radius, 0)) + Math.max(0, finiteOr(agent.clearancePadding, 0));
  return {
    cellSize: options.cellSize,
    cellHeight: options.cellHeight,
    tileCells: options.tileCells,
    walkableRadius: Math.ceil(radius / options.cellSize),
    walkableHeight: Math.max(1, Math.ceil(Math.max(0, finiteOr(agent.height, 0)) / options.cellHeight)),
    walkableClimb: Math.max(0, Math.floor(Math.max(0, finiteOr(agent.stepHeight, 0)) / options.cellHeight)),
    walkableSlopeAngle: finiteOr(agent.maxSlopeAngleDeg, DEFAULT_SLOPE_DEG),
    detailSampleCells: Math.max(1, finiteOr(options.detailSampleCells, DEFAULT_DETAIL_SAMPLE_CELLS)),
    detailSampleErrorCells: Math.max(0, finiteOr(options.detailSampleErrorCells, DEFAULT_DETAIL_SAMPLE_ERROR_CELLS)),
    agentHeight: Math.max(1, finiteOr(agent.height, 0)),
  };
}

/** Recast's tiled-sample configuration for one mesh. Free it with `Raw.Module.destroy`. */
export function createTileRcConfig(core: Core, tile: RecastTileConfig): RecastRcConfig {
  const config = core.createRcConfig({
    ...core.recastConfigDefaults,
    cs: tile.cellSize,
    ch: tile.cellHeight,
    tileSize: tile.tileCells,
    walkableRadius: tile.walkableRadius,
    walkableHeight: tile.walkableHeight,
    walkableClimb: tile.walkableClimb,
    walkableSlopeAngle: tile.walkableSlopeAngle,
    // Edge length in cells: about 12 m keeps long walls to a few vertices.
    maxEdgeLen: Math.round(12 / tile.cellSize),
  });
  // The per-tile derivations of Recast's tiled sample: region areas are
  // authored as edge lengths, detail errors in cells, and the border keeps
  // the erosion of neighbouring geometry inside each tile.
  config.minRegionArea = config.minRegionArea * config.minRegionArea;
  config.mergeRegionArea = config.mergeRegionArea * config.mergeRegionArea;
  config.borderSize = tile.walkableRadius + 3;
  config.width = tile.tileCells + config.borderSize * 2;
  config.height = tile.tileCells + config.borderSize * 2;
  config.detailSampleDist = tile.cellSize * tile.detailSampleCells;
  config.detailSampleMaxError = tile.cellHeight * tile.detailSampleErrorCells;
  return config;
}

/**
 * Recast's per-tile pipeline (rasterize → filter → compact → erode → regions
 * → contours → poly mesh → detail mesh → Detour data). Obstacle volumes are
 * marked null before erosion so the agent radius keeps clear of them too.
 * Returns the Detour tile bytes, or null when the tile has no walkable polygons.
 */
export function buildRecastTileBytes(
  core: Core,
  config: RecastRcConfig,
  tile: RecastTileConfig,
  input: RecastTileInput,
): Uint8Array | null {
  const { positions, obstacles, rect } = input;
  if (positions.length < 9) return null;
  const context = new core.RecastBuildContext(false);
  const triangleCount = Math.floor(positions.length / 9);
  const vertexCount = triangleCount * 3;
  const vertices = new core.VerticesArray();
  vertices.copy(positions.length === vertexCount * 3 ? positions : positions.subarray(0, vertexCount * 3));
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
    const bmin: [number, number, number] = [rect.minX, input.minY - tile.cellHeight, rect.minZ];
    const bmax: [number, number, number] = [rect.maxX, input.maxY + tile.agentHeight, rect.maxZ];
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
      core.markConvexPolyArea(context, footprint, obstacle.footprint.length, obstacle.minY - tile.cellHeight,
        obstacle.maxY + (config.walkableClimb + 1) * tile.cellHeight, core.Recast.RC_NULL_AREA, compact);
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
    params.setTileX(input.tileX);
    params.setTileY(input.tileZ);
    const created = core.createNavMeshData(params);
    core.Raw.Module.destroy(params.raw);
    if (!created.success) return null;
    const bytes = created.navMeshData.toTypedArray().slice();
    created.navMeshData.destroy();
    return bytes;
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

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
