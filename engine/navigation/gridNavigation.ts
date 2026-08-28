/**
 * Minimal 2D grid navigation for AI path requests.
 *
 * Pure engine module: no DOM, Three.js or editor imports. The first
 * implementation plans over X/Z using static blocker AABBs inflated by the
 * agent radius. It is intentionally small so higher-level AI can start using
 * path-following before a full navmesh/Recast adapter exists.
 *
 * Navigation contract (Unreal/Recast `Agent Radius` analogue): a path point is
 * the agent capsule *center* at foot height, never a surface point. Obstacles
 * are eroded by an effective clearance so the capsule body stays clear:
 *
 *   effectiveRadius = agent.radius + agent.clearancePadding + safetyMargin
 *
 * `clearancePadding` is optional per-agent slack beyond the capsule radius (kept
 * small so narrow corridors stay traversable). `safetyMargin` absorbs the grid
 * discretization error and defaults to `cellSize * 0.5` — half a cell, the worst
 * case rounding of a continuous position onto a cell center. Authored navigation
 * bounds are eroded inward by the same effective radius.
 */
import type { Vec3 } from "../scene/layout";
import type { NavigationRole } from "../scene/collision";

export interface NavAabb {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** World XZ point `[x, z]` (a blocker footprint vertex). */
export type NavVec2 = readonly [number, number];

/**
 * A static obstacle for path planning. Its {@link NavAabb} `min`/`max` always
 * bound it (broadphase, grid extent, and vertical filtering all use the AABB Y
 * span). When `footprint` is present it is the *oriented* convex XZ shape the box
 * projects onto the ground — the exact ground silhouette of a rotated wall,
 * instead of the axis-aligned box that encloses (and bloats) it. Nav queries
 * erode/collide against the footprint when present and fall back to the
 * axis-aligned `min.xz..max.xz` rectangle otherwise, so a plain {@link NavAabb}
 * is a valid `NavBlocker` and every existing axis-aligned caller is unchanged.
 *
 * The footprint is a convex polygon (CCW or CW; winding-independent tests); a
 * yaw-rotated box projects to a 4-vertex oriented rectangle, a fully tilted box
 * to its ≤6-vertex hull.
 */
export interface NavBlocker extends NavAabb {
  readonly footprint?: readonly NavVec2[];
  readonly navigationRole?: NavigationRole;
}

export interface NavAgent {
  readonly radius: number;
  readonly height: number;
  readonly stepHeight?: number;
  readonly maxStepDown?: number;
  readonly maxSlopeAngleDeg?: number;
  /**
   * Extra clearance beyond the capsule radius (Unreal `Nav Agent` slack). Added
   * to the effective blocker erosion so the agent keeps a safety gap from walls.
   * Keep it small — large values close off narrow corridors. Defaults to 0.
   */
  readonly clearancePadding?: number;
}

export interface PathRequest {
  readonly start: Vec3;
  readonly goal: Vec3;
  readonly agent: NavAgent;
  readonly blockers: readonly NavBlocker[];
  /** Optional authored navigation bounds; when present both start and goal must be inside one. */
  readonly bounds?: readonly NavAabb[];
  readonly cellSize?: number;
  readonly boundsPadding?: number;
  /**
   * Grid discretization safety margin added to the effective blocker erosion.
   * Defaults to `cellSize * 0.5`. Pass `0` to disable (e.g. exact-grid tests).
   */
  readonly safetyMargin?: number;
}

export interface PathResult {
  readonly status: "success" | "failure";
  readonly points: readonly Vec3[];
  readonly visited: number;
}

export interface PathFollowingState {
  readonly path: readonly Vec3[];
  readonly waypointIndex: number;
  readonly status: "idle" | "following" | "success" | "failure";
}

export interface WaypointAcceptance {
  /** Acceptance radius for the final goal waypoint (authored, may be generous). */
  readonly final: number;
  /** Acceptance radius for intermediate waypoints (kept tight so corners aren't cut). */
  readonly intermediate: number;
}

export interface WaypointAdvance {
  /** Index of the waypoint the agent should now steer toward. */
  readonly waypointIndex: number;
  /** True once the final waypoint is within its acceptance radius (path complete). */
  readonly arrived: boolean;
}

/**
 * Advances a path-follower's waypoint cursor past every waypoint already within
 * acceptance in 3D space. Intermediate waypoints use a tight radius so a
 * generous final `acceptance` cannot make the agent skip a corner early and cut
 * through an inflated blocker; only the final goal honors the authored
 * acceptance. The vertical component matters for heightfield paths: reaching a
 * ramp/platform waypoint's X/Z is not enough if the agent has not actually
 * climbed to that floor yet.
 */
export function advanceWaypoint(
  path: readonly Vec3[],
  waypointIndex: number,
  position: Vec3,
  acceptance: WaypointAcceptance,
): WaypointAdvance {
  let index = Math.max(0, waypointIndex);
  while (index < path.length) {
    const isFinal = index >= path.length - 1;
    const radius = isFinal ? acceptance.final : acceptance.intermediate;
    if (distance3d(position, path[index]!) > radius) break;
    if (isFinal) return { waypointIndex: index, arrived: true };
    index += 1;
  }
  return { waypointIndex: index, arrived: false };
}

function distance3d(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function planarDistanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

interface GridCoord {
  readonly x: number;
  readonly z: number;
}

interface SearchNode extends GridCoord {
  readonly g: number;
  readonly f: number;
}

interface LayerSearchNode {
  readonly id: number;
  readonly g: number;
  readonly f: number;
}

const DEFAULT_CELL_SIZE = 0.5;
const DEFAULT_BOUNDS_PADDING = 2;
const MAX_GRID_CELLS = 20000;
const CLEARANCE_COST_CELL_RADIUS = 3;
const CLEARANCE_COST_WEIGHT = 4;
/**
 * Max cells an endpoint may be projected onto the nearest walkable cell (see
 * {@link projectEndpoint}). At the default 0.5 cell size this is a ~1m query
 * extent — enough to rescue platform-edge rounding without teleporting a goal
 * across a wall into an unrelated region.
 */
const PROJECTION_MAX_CELL_RADIUS = 2;

/**
 * A baked ("built") navigation grid: the query-independent half of a path
 * request precomputed once. {@link findGridPath} rebuilds this on every call;
 * {@link buildNavGrid} + {@link searchNavGrid} let a caller bake it once (per
 * agent profile) and reuse it for many `start`/`goal` queries — the Unreal
 * navmesh-bake analogue. A grid is only query-independent when authored bounds
 * are supplied (the AI Navigation Volume); the unbounded case derives its extent
 * from `start`/`goal`, so it can only be built inline by {@link findGridPath}.
 */
export interface NavGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  /** World X of grid cell (0,0), i.e. the eroded extent's minX. */
  readonly originX: number;
  /** World Z of grid cell (0,0), i.e. the eroded extent's minZ. */
  readonly originZ: number;
  /** Y-plane the grid was baked for (vertical blocker filtering + output height). */
  readonly footY: number;
  /** Effective erosion (agent radius + clearance padding + grid safety margin). */
  readonly clearanceRadius: number;
  /** Agent capsule height used for vertical blocker tests. */
  readonly height: number;
  /** Maximum floor-height delta allowed when stepping to a higher neighbor. */
  readonly stepHeight: number;
  /** Maximum floor-height delta allowed when stepping down to a lower neighbor. */
  readonly maxStepDown: number;
  /** `cols*rows` row-major passability bitset (1 = walkable). */
  readonly passable: Uint8Array;
  /** `cols*rows` row-major floor height sampled at each walkable cell. */
  readonly floorY: Float32Array;
  /** `cols*rows` row-major soft clearance cost added when stepping onto a cell. */
  readonly penalty: Float32Array;
  /**
   * True when the grid was baked as a single flat `footY` plane (no
   * `sampleFloorY`/`sampleFloorYs` hook). On such a grid walkability is fully
   * described by the blockers + bounds the grid retains, which is exactly what
   * {@link segmentSafe} tests — so a straight segment it accepts is genuinely
   * walkable, and the final path may be string-pulled (see
   * {@link compressPathPoints}). A heightfield grid also encodes floor holes,
   * ledge erosion and step limits that no segment test can see, so it keeps the
   * conservative cell-by-cell route.
   */
  readonly flatFloor: boolean;
  /** Optional multi-layer heightfield offsets into `layer*` arrays, length `cols*rows + 1`. */
  readonly layerOffsets?: Uint32Array;
  /** Optional multi-layer cell index per layer entry. */
  readonly layerCell?: Uint32Array;
  /** Optional multi-layer floor heights. */
  readonly layerFloorY?: Float32Array;
  /** Optional multi-layer soft clearance costs. */
  readonly layerPenalty?: Float32Array;
  /** Vertically-filtered blockers, retained for final-path segment shortcutting. */
  readonly blockers: readonly NavBlocker[];
  /** Authored navigation bounds, retained for membership + segment checks. */
  readonly bounds?: readonly NavAabb[];
}

interface LayeredNavGrid extends NavGrid {
  readonly layerOffsets: Uint32Array;
  readonly layerCell: Uint32Array;
  readonly layerFloorY: Float32Array;
  readonly layerPenalty: Float32Array;
}

export interface NavGridBuildRequest {
  readonly agent: NavAgent;
  readonly blockers: readonly NavBlocker[];
  /** Authored navigation bounds; required for a query-independent (cacheable) grid. */
  readonly bounds?: readonly NavAabb[];
  /** Y-plane to bake for (vertical blocker filter + output waypoint height). */
  readonly footY: number;
  /**
   * Optional heightfield hook. When provided, each X/Z cell is baked at its own
   * floor height; `null` marks the cell as not walkable. Without this hook the
   * grid remains a flat `footY` plane for backwards compatibility.
   */
  readonly sampleFloorY?: (x: number, z: number) => number | null;
  /**
   * Optional multi-layer heightfield hook. Use when stacked walkable surfaces
   * overlap the same X/Z cell (e.g. a lower floor under an upper platform).
   */
  readonly sampleFloorYs?: (x: number, z: number) => readonly number[] | null;
  readonly cellSize?: number;
  readonly safetyMargin?: number;
  readonly boundsPadding?: number;
  /**
   * Unbounded fallback: without authored bounds the extent is derived from these
   * endpoints (used by {@link findGridPath}); such a grid is single-query only.
   */
  readonly extentSeed?: { readonly start: Vec3; readonly goal: Vec3 };
}

/**
 * Bakes a {@link NavGrid} from blockers + authored bounds for one agent profile.
 * Returns `null` when there is no extent to bake (no authored bounds and no
 * `extentSeed`) or the grid would exceed {@link MAX_GRID_CELLS}. The passability
 * and penalty tables are computed for every cell up front so {@link searchNavGrid}
 * is a pure table read — this is the work {@link findGridPath} otherwise repeats
 * per query.
 */
export function buildNavGrid(request: NavGridBuildRequest): NavGrid | null {
  const cellSize = sanePositive(request.cellSize, DEFAULT_CELL_SIZE);
  const radius = Math.max(0, finiteOr(request.agent.radius, 0));
  const clearance = Math.max(0, finiteOr(request.agent.clearancePadding, 0));
  const safetyMargin = nonNegativeOr(request.safetyMargin, cellSize * 0.5);
  // Effective erosion applied to blockers and authored bounds: the capsule body
  // plus per-agent slack plus grid rounding slack (see module contract).
  const clearanceRadius = radius + clearance + safetyMargin;
  const height = Math.max(0, finiteOr(request.agent.height, 0));
  const stepHeight = Math.max(0, finiteOr(request.agent.stepHeight, 0));
  const maxStepDown = Math.max(0, finiteOr(request.agent.maxStepDown, stepHeight));
  const footY = finiteOr(request.footY, 0);
  // Erosion honors `navigationRole`: a `walkable` body is declared navigable
  // ground, so it must never erode the grid. This is what lets a `walkable`
  // staircase be climbed — its vertical riser AABBs would otherwise carve out the
  // narrow tread strip between steps (a ramp has no risers, so it always worked).
  // Ground seeding is unaffected: it comes from `sampleFloorY`/`sampleFloorYs`
  // (the host's role-aware floor probe), not from this list, so a `walkable`
  // floor/platform still contributes its walkable surface.
  const erosionBlockers = request.blockers.filter((blocker) => blocker.navigationRole !== "walkable");
  const flatBlockers = erosionBlockers.filter((blocker) =>
    blocksAgentVertically(blocker, footY, height, stepHeight),
  );
  const heightfield = Boolean(request.sampleFloorY || request.sampleFloorYs);
  const blockers = heightfield ? erosionBlockers : flatBlockers;
  const authoredBounds = request.bounds && request.bounds.length > 0 ? request.bounds : undefined;
  const extent = authoredBounds
    ? navBoundsFromAuthored(authoredBounds, clearanceRadius)
    : request.extentSeed
      ? navBounds(request.extentSeed.start, request.extentSeed.goal, blockers, clearanceRadius, request.boundsPadding)
      : null;
  if (!extent) return null;
  const cols = Math.max(1, Math.ceil((extent.maxX - extent.minX) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((extent.maxZ - extent.minZ) / cellSize) + 1);
  if (cols * rows > MAX_GRID_CELLS) return null;

  const originX = extent.minX;
  const originZ = extent.minZ;
  const passable = new Uint8Array(cols * rows);
  const floorY = new Float32Array(cols * rows);
  const penalty = new Float32Array(cols * rows);
  // Ground presence per cell, independent of walkability (blocked cells that still
  // have a floor count as ground). Used by ledge erosion to tell a genuine
  // drop-off apart from a floor the agent simply can't stand on. Single-layer only;
  // the layered path reads ground heights straight from the packed layer arrays.
  const hasGround = new Uint8Array(cols * rows);
  const clearanceCostRadius = cellSize * CLEARANCE_COST_CELL_RADIUS;
  const layerOffsets = request.sampleFloorYs ? new Uint32Array(cols * rows + 1) : undefined;
  const layerCells: number[] = [];
  const layerFloors: number[] = [];
  const layerPenalties: number[] = [];
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < cols; x += 1) {
      const point: Vec3 = [originX + x * cellSize, footY, originZ + z * cellSize];
      const idx = z * cols + x;
      if (request.sampleFloorYs && layerOffsets) {
        layerOffsets[idx] = layerFloors.length;
        const sampledFloors = uniqueSortedFloors(request.sampleFloorYs(point[0], point[2]) ?? []);
        const firstLayer = layerFloors.length;
        for (const sampledFloorY of sampledFloors) {
          point[1] = sampledFloorY;
          const cellBlockers = blockers.filter((blocker) =>
            blocksAgentVertically(blocker, sampledFloorY, height, stepHeight),
          );
          const walkable =
            !pointBlocked(point, cellBlockers, clearanceRadius) &&
            (!authoredBounds || pointInsideAnyAabb2d(point, authoredBounds));
          if (!walkable) continue;
          let layerPenalty = 0;
          if (cellBlockers.length > 0) {
            const distance = nearestInflatedBlockerDistance(point, cellBlockers, clearanceRadius);
            const pressure = distance >= clearanceCostRadius ? 0 : 1 - distance / clearanceCostRadius;
            layerPenalty = pressure * pressure * CLEARANCE_COST_WEIGHT;
          }
          layerCells.push(idx);
          layerFloors.push(sampledFloorY);
          layerPenalties.push(layerPenalty);
        }
        if (layerFloors.length <= firstLayer) {
          floorY[idx] = footY;
          continue;
        }
        const representative = nearestLayerIndex(layerFloors, firstLayer, layerFloors.length, footY);
        passable[idx] = 1;
        floorY[idx] = layerFloors[representative] ?? footY;
        penalty[idx] = layerPenalties[representative] ?? 0;
        continue;
      }
      const sampledFloorY = request.sampleFloorY ? request.sampleFloorY(point[0], point[2]) : footY;
      floorY[idx] = sampledFloorY ?? footY;
      if (sampledFloorY === null || !Number.isFinite(sampledFloorY)) continue;
      point[1] = sampledFloorY;
      hasGround[idx] = 1;
      const cellBlockers = heightfield
        ? blockers.filter((blocker) => blocksAgentVertically(blocker, sampledFloorY, height, stepHeight))
        : flatBlockers;
      const walkable =
        !pointBlocked(point, cellBlockers, clearanceRadius) &&
        (!authoredBounds || pointInsideAnyAabb2d(point, authoredBounds));
      if (!walkable) continue;
      passable[idx] = 1;
      if (cellBlockers.length > 0) {
        const distance = nearestInflatedBlockerDistance(point, cellBlockers, clearanceRadius);
        const pressure = distance >= clearanceCostRadius ? 0 : 1 - distance / clearanceCostRadius;
        penalty[idx] = pressure * pressure * CLEARANCE_COST_WEIGHT;
      }
    }
  }
  if (layerOffsets) layerOffsets[cols * rows] = layerFloors.length;

  let finalLayerOffsets = layerOffsets;
  let finalLayerCells = layerCells;
  let finalLayerFloors = layerFloors;
  let finalLayerPenalties = layerPenalties;

  // Ledge (drop-off) erosion — the walkable-surface analogue of blocker erosion.
  // Blocker erosion above insets the grid only where an obstacle footprint pushes
  // in; an open *walkable edge* (a ramp's side, a platform rim, a stair's flank)
  // got no inset, so an agent could path to the very lip and fall — the missing
  // "border" a walkable surface has that a wall does. Recast/Unreal inset the
  // navigable surface from every ledge by the agent radius; this pass reproduces
  // that: demote any walkable cell within `clearanceRadius` of a genuine drop.
  //
  // A neighbour is a drop only when (a) it has no ground reachable within
  // `maxStepDown` of this cell's floor — so a ramp/stair's own traversable steps
  // and the ramp-to-floor join are kept, satisfying the "only drops beyond
  // maxStepDown" rule — and (b) it is not a solid wall face at this height, since
  // walls are already handled by blocker erosion and must not be inset twice.
  // Flat/non-heightfield grids have no ledges (uniform floor), so this is a no-op
  // there; with `clearanceRadius` 0 (e.g. radius-0 exact-grid tests) it never runs.
  if (heightfield && clearanceRadius > 0) {
    const EPS = 1e-6;
    const ledgeReach = Math.max(1, Math.ceil(clearanceRadius / cellSize));
    const solidAt = (worldX: number, worldZ: number, refY: number): boolean =>
      request.blockers.some(
        (blocker) =>
          blocksAgentVertically(blocker, refY, height, stepHeight) &&
          blockerCoversPointXZ(blocker, worldX, worldZ),
      );
    const hasLedgeWithinReach = (
      x: number,
      z: number,
      refY: number,
      reachableGround: (cellIdx: number, refY: number) => boolean,
    ): boolean => {
      for (let dz = -ledgeReach; dz <= ledgeReach; dz += 1) {
        for (let dx = -ledgeReach; dx <= ledgeReach; dx += 1) {
          if (dx === 0 && dz === 0) continue;
          if (Math.hypot(dx * cellSize, dz * cellSize) > clearanceRadius + EPS) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          if (reachableGround(nz * cols + nx, refY)) continue;
          if (solidAt(originX + nx * cellSize, originZ + nz * cellSize, refY)) continue;
          return true;
        }
      }
      return false;
    };

    if (finalLayerOffsets) {
      const layerOffs = finalLayerOffsets;
      const cellHasReachableLayer = (cellIdx: number, refY: number): boolean => {
        for (let id = layerOffs[cellIdx] ?? 0; id < (layerOffs[cellIdx + 1] ?? 0); id += 1) {
          const lf = finalLayerFloors[id]!;
          if (refY - lf <= maxStepDown + EPS && lf - refY <= stepHeight + EPS) return true;
        }
        return false;
      };
      const removeLayer = new Uint8Array(finalLayerFloors.length);
      let removedAny = false;
      for (let z = 0; z < rows; z += 1) {
        for (let x = 0; x < cols; x += 1) {
          const cellIdx = z * cols + x;
          for (let id = layerOffs[cellIdx] ?? 0; id < (layerOffs[cellIdx + 1] ?? 0); id += 1) {
            if (hasLedgeWithinReach(x, z, finalLayerFloors[id]!, cellHasReachableLayer)) {
              removeLayer[id] = 1;
              removedAny = true;
            }
          }
        }
      }
      if (removedAny) {
        const newOffsets = new Uint32Array(cols * rows + 1);
        const newCells: number[] = [];
        const newFloors: number[] = [];
        const newPenalties: number[] = [];
        for (let cellIdx = 0; cellIdx < cols * rows; cellIdx += 1) {
          newOffsets[cellIdx] = newFloors.length;
          const first = newFloors.length;
          for (let id = layerOffs[cellIdx] ?? 0; id < (layerOffs[cellIdx + 1] ?? 0); id += 1) {
            if (removeLayer[id]) continue;
            newCells.push(cellIdx);
            newFloors.push(finalLayerFloors[id]!);
            newPenalties.push(finalLayerPenalties[id]!);
          }
          if (newFloors.length <= first) {
            passable[cellIdx] = 0;
            floorY[cellIdx] = footY;
            penalty[cellIdx] = 0;
          } else {
            const rep = nearestLayerIndex(newFloors, first, newFloors.length, footY);
            passable[cellIdx] = 1;
            floorY[cellIdx] = newFloors[rep] ?? footY;
            penalty[cellIdx] = newPenalties[rep] ?? 0;
          }
        }
        newOffsets[cols * rows] = newFloors.length;
        finalLayerOffsets = newOffsets;
        finalLayerCells = newCells;
        finalLayerFloors = newFloors;
        finalLayerPenalties = newPenalties;
      }
    } else {
      const reachableSingle = (nIdx: number, refY: number): boolean =>
        hasGround[nIdx] === 1 &&
        refY - floorY[nIdx]! <= maxStepDown + EPS &&
        floorY[nIdx]! - refY <= stepHeight + EPS;
      const toDemote: number[] = [];
      for (let z = 0; z < rows; z += 1) {
        for (let x = 0; x < cols; x += 1) {
          const cellIdx = z * cols + x;
          if (passable[cellIdx] !== 1) continue;
          if (hasLedgeWithinReach(x, z, floorY[cellIdx]!, reachableSingle)) toDemote.push(cellIdx);
        }
      }
      for (const idx of toDemote) passable[idx] = 0;
    }
  }

  return {
    cellSize,
    cols,
    rows,
    originX,
    originZ,
    footY,
    clearanceRadius,
    height,
    stepHeight,
    maxStepDown,
    passable,
    floorY,
    penalty,
    flatFloor: !heightfield,
    ...(finalLayerOffsets
      ? {
          layerOffsets: finalLayerOffsets,
          layerCell: Uint32Array.from(finalLayerCells),
          layerFloorY: Float32Array.from(finalLayerFloors),
          layerPenalty: Float32Array.from(finalLayerPenalties),
        }
      : {}),
    blockers,
    ...(authoredBounds ? { bounds: authoredBounds } : {}),
  };
}

/**
 * A* over a prebuilt {@link NavGrid} for one `start`/`goal`. Produces the exact
 * same {@link PathResult} as {@link findGridPath} would for the inputs the grid
 * was baked from (start/goal endpoints are preserved verbatim; interior waypoints
 * sit on the grid at `grid.footY`).
 */
export function searchNavGrid(grid: NavGrid, start: Vec3, goal: Vec3): PathResult {
  const authoredBounds = grid.bounds;
  if (authoredBounds && !pointInsideAnyAabb2d(start, authoredBounds)) {
    return { status: "failure", points: [], visited: 0 };
  }
  if (authoredBounds && !pointInsideAnyAabb2d(goal, authoredBounds)) {
    return { status: "failure", points: [], visited: 0 };
  }
  if (hasLayerData(grid)) {
    return searchLayeredNavGrid(grid, start, goal, authoredBounds);
  }
  const { cols, rows, cellSize, originX, originZ } = grid;
  const toCoord = (point: Vec3): GridCoord => ({
    x: clamp(Math.round((point[0] - originX) / cellSize), 0, cols - 1),
    z: clamp(Math.round((point[2] - originZ) / cellSize), 0, rows - 1),
  });
  const toPoint = (coord: GridCoord): Vec3 => [
    originX + coord.x * cellSize,
    grid.floorY[coord.z * cols + coord.x] ?? grid.footY,
    originZ + coord.z * cellSize,
  ];
  const passable = (coord: GridCoord): boolean =>
    coord.x >= 0 &&
    coord.z >= 0 &&
    coord.x < cols &&
    coord.z < rows &&
    grid.passable[coord.z * cols + coord.x] === 1;

  // Project each endpoint onto the nearest walkable cell (Unreal
  // `ProjectPointToNavigation`). A start/goal that rounds onto a blocked or
  // off-mesh cell — e.g. a Target Point sitting near a platform edge, or a
  // heightfield hole where the authored point's exact X/Z has no floor — would
  // otherwise fail the whole query. Projection is height-aware (3D nearest) so a
  // goal on an upper platform snaps to that platform, not the floor beneath it.
  // When the rounded cell is already walkable this is a no-op (raw endpoint kept
  // verbatim), so flat-plane behavior is unchanged.
  const startFix = projectEndpoint(start, toCoord, toPoint, passable);
  const goalFix = projectEndpoint(goal, toCoord, toPoint, passable);
  if (!startFix || !goalFix) {
    return { status: "failure", points: [], visited: 0 };
  }
  const startCoord = startFix.coord;
  const goalCoord = goalFix.coord;
  if (sameCoord(startCoord, goalCoord)) {
    return { status: "success", points: [cloneVec3(startFix.point), cloneVec3(goalFix.point)], visited: 1 };
  }

  const open: SearchNode[] = [{ ...startCoord, g: 0, f: heuristic(startCoord, goalCoord) }];
  const bestG = new Map<string, number>([[coordKey(startCoord), 0]]);
  const cameFrom = new Map<string, string>();
  let visited = 0;

  while (open.length > 0) {
    const current = popLowest(open);
    visited += 1;
    if (sameCoord(current, goalCoord)) {
      const cells = reconstructCells(cameFrom, current).map(coordFromKey);
      return {
        status: "success",
        points: pathPoints(
          startFix.point,
          goalFix.point,
          cells,
          toPoint,
          (a, b) =>
            segmentSafe(a, b, grid.blockers, grid.clearanceRadius, grid.height, grid.stepHeight, authoredBounds),
          grid.flatFloor,
        ),
        visited,
      };
    }
    for (const next of neighbors(current, passable, (from, to) => canTraverseHeight(grid, from, to))) {
      const step = next.x !== current.x && next.z !== current.z ? Math.SQRT2 : 1;
      const nextG = current.g + step + grid.penalty[next.z * cols + next.x]!;
      const key = coordKey(next);
      if (nextG >= (bestG.get(key) ?? Infinity)) continue;
      bestG.set(key, nextG);
      cameFrom.set(key, coordKey(current));
      open.push({ ...next, g: nextG, f: nextG + heuristic(next, goalCoord) });
    }
  }

  return { status: "failure", points: [], visited };
}

function searchLayeredNavGrid(
  grid: LayeredNavGrid,
  start: Vec3,
  goal: Vec3,
  authoredBounds: readonly NavAabb[] | undefined,
): PathResult {
  const startFix = projectLayeredEndpoint(grid, start);
  const goalFix = projectLayeredEndpoint(grid, goal);
  if (!startFix || !goalFix) return { status: "failure", points: [], visited: 0 };
  if (startFix.id === goalFix.id) {
    return { status: "success", points: [cloneVec3(startFix.point), cloneVec3(goalFix.point)], visited: 1 };
  }

  const open: LayerSearchNode[] = [{ id: startFix.id, g: 0, f: layeredHeuristic(grid, startFix.id, goalFix.id) }];
  const bestG = new Map<string, number>([[layerKey(startFix.id), 0]]);
  const cameFrom = new Map<string, string>();
  let visited = 0;

  while (open.length > 0) {
    const current = popLowestLayer(open);
    visited += 1;
    if (current.id === goalFix.id) {
      const layers = reconstructLayers(cameFrom, current.id);
      return {
        status: "success",
        points: layerPathPoints(
          startFix.point,
          goalFix.point,
          layers,
          grid,
          (a, b) =>
            segmentSafe(a, b, grid.blockers, grid.clearanceRadius, grid.height, grid.stepHeight, authoredBounds),
        ),
        visited,
      };
    }

    for (const nextId of layeredNeighbors(grid, current.id)) {
      const currentCoord = layerCoord(grid, current.id);
      const nextCoord = layerCoord(grid, nextId);
      const step = currentCoord.x !== nextCoord.x && currentCoord.z !== nextCoord.z ? Math.SQRT2 : 1;
      const nextG = current.g + step + (grid.layerPenalty[nextId] ?? 0);
      const key = layerKey(nextId);
      if (nextG >= (bestG.get(key) ?? Infinity)) continue;
      bestG.set(key, nextG);
      cameFrom.set(key, layerKey(current.id));
      open.push({ id: nextId, g: nextG, f: nextG + layeredHeuristic(grid, nextId, goalFix.id) });
    }
  }

  return { status: "failure", points: [], visited };
}

export function findGridPath(request: PathRequest): PathResult {
  const cellSize = sanePositive(request.cellSize, DEFAULT_CELL_SIZE);
  const authoredBounds = request.bounds && request.bounds.length > 0 ? request.bounds : undefined;
  const grid = buildNavGrid({
    agent: request.agent,
    blockers: request.blockers,
    ...(authoredBounds ? { bounds: authoredBounds } : {}),
    footY: request.start[1],
    cellSize,
    ...(request.safetyMargin !== undefined ? { safetyMargin: request.safetyMargin } : {}),
    ...(request.boundsPadding !== undefined ? { boundsPadding: request.boundsPadding } : {}),
    ...(authoredBounds ? {} : { extentSeed: { start: request.start, goal: request.goal } }),
  });
  if (!grid) return { status: "failure", points: [], visited: 0 };
  return searchNavGrid(grid, request.start, request.goal);
}

/**
 * Caches one baked {@link NavGrid} per distinct agent profile, keyed off a
 * caller-supplied `token` that encodes the blocker + bounds revision. When the
 * token changes (a static obstacle moved / a nav volume was edited) every cached
 * grid is treated as stale and rebuilt lazily on next access — this is the
 * automatic-rebuild behavior (no manual "Build Navigation" step). Agent profile
 * (radius/clearance/height/step + footY + cellSize + safetyMargin) is part of the
 * cache key so differently-sized agents keep their own grids.
 */
export class NavGridCache {
  private entries = new Map<string, { token: string; grid: NavGrid | null }>();

  getOrBuild(token: string, request: NavGridBuildRequest): NavGrid | null {
    const key = navGridAgentKey(request);
    const cached = this.entries.get(key);
    if (cached && cached.token === token) return cached.grid;
    const grid = buildNavGrid(request);
    this.entries.set(key, { token, grid });
    return grid;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

function navGridAgentKey(request: NavGridBuildRequest): string {
  const cellSize = sanePositive(request.cellSize, DEFAULT_CELL_SIZE);
  const safetyMargin = nonNegativeOr(request.safetyMargin, cellSize * 0.5);
  const agent = request.agent;
  return [
    finiteOr(agent.radius, 0),
    finiteOr(agent.clearancePadding, 0),
    finiteOr(agent.height, 0),
    finiteOr(agent.stepHeight, 0),
    finiteOr(agent.maxStepDown, finiteOr(agent.stepHeight, 0)),
    finiteOr(agent.maxSlopeAngleDeg, 0),
    finiteOr(request.footY, 0),
    request.sampleFloorYs ? "heightfield-layers" : request.sampleFloorY ? "heightfield" : "flat",
    cellSize,
    safetyMargin,
  ].join(":");
}

function navBounds(
  start: Vec3,
  goal: Vec3,
  blockers: readonly NavAabb[],
  radius: number,
  padding: number | undefined,
) {
  const pad = sanePositive(padding, DEFAULT_BOUNDS_PADDING) + radius;
  let minX = Math.min(start[0], goal[0]) - pad;
  let maxX = Math.max(start[0], goal[0]) + pad;
  let minZ = Math.min(start[2], goal[2]) - pad;
  let maxZ = Math.max(start[2], goal[2]) + pad;
  for (const blocker of blockers) {
    minX = Math.min(minX, blocker.min[0] - pad);
    maxX = Math.max(maxX, blocker.max[0] + pad);
    minZ = Math.min(minZ, blocker.min[2] - pad);
    maxZ = Math.max(maxZ, blocker.max[2] + pad);
  }
  return { minX, maxX, minZ, maxZ };
}

function navBoundsFromAuthored(bounds: readonly NavAabb[], radius: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const bound of bounds) {
    minX = Math.min(minX, bound.min[0] + radius);
    maxX = Math.max(maxX, bound.max[0] - radius);
    minZ = Math.min(minZ, bound.min[2] + radius);
    maxZ = Math.max(maxZ, bound.max[2] - radius);
  }
  return { minX, maxX, minZ, maxZ };
}

function pointInsideAnyAabb2d(point: Vec3, bounds: readonly NavAabb[]): boolean {
  return bounds.some((bound) => pointInsideAabb2d(point, bound));
}

function pointInsideAabb2d(point: Vec3, bound: NavAabb): boolean {
  return point[0] >= bound.min[0] &&
    point[0] <= bound.max[0] &&
    point[2] >= bound.min[2] &&
    point[2] <= bound.max[2];
}

function blocksAgentVertically(
  blocker: NavAabb,
  footY: number,
  height: number,
  stepHeight: number,
): boolean {
  return blocker.max[1] > footY + stepHeight && blocker.min[1] < footY + Math.max(height, 0.001);
}

function pointBlocked(point: Vec3, blockers: readonly NavBlocker[], radius: number): boolean {
  return blockers.some((blocker) => blockerContainsPointXZ(point, blocker, radius));
}

/** True when world XZ `point` is within `radius` of `blocker`'s inflated footprint (ignores Y). */
function blockerContainsPointXZ(point: Vec3, blocker: NavBlocker, radius: number): boolean {
  // Broadphase: the AABB (inflated by radius) always bounds the footprint, so a
  // point outside it can never be within `radius` of the oriented shape.
  if (
    point[0] < blocker.min[0] - radius ||
    point[0] > blocker.max[0] + radius ||
    point[2] < blocker.min[2] - radius ||
    point[2] > blocker.max[2] + radius
  ) {
    return false;
  }
  const footprint = blocker.footprint;
  if (footprint && footprint.length >= 2) {
    // Oriented (rotated) obstacle: block when the capsule center is within the
    // effective radius of the tight ground silhouette (rounded-corner erosion).
    return distancePointToFootprintXZ(point[0], point[2], footprint) <= radius;
  }
  // Axis-aligned: the broadphase test above already is the exact answer.
  return true;
}

/**
 * True when world XZ `(x, z)` lies on/inside the blocker's ground silhouette
 * (radius 0, unlike {@link pointBlocked}). Ledge erosion uses this to tell a wall
 * face from open air: a neighbour under a solid body is a wall (handled by blocker
 * erosion), not a fall, so it must not seed a second inset.
 */
function blockerCoversPointXZ(blocker: NavBlocker, x: number, z: number): boolean {
  if (x < blocker.min[0] || x > blocker.max[0] || z < blocker.min[2] || z > blocker.max[2]) {
    return false;
  }
  const footprint = blocker.footprint;
  if (footprint && footprint.length >= 2) {
    return distancePointToFootprintXZ(x, z, footprint) <= 1e-6;
  }
  return true;
}

function nearestInflatedBlockerDistance(point: Vec3, blockers: readonly NavBlocker[], radius: number): number {
  let nearest = Infinity;
  for (const blocker of blockers) {
    const footprint = blocker.footprint;
    const distance =
      footprint && footprint.length >= 2
        ? Math.max(0, distancePointToFootprintXZ(point[0], point[2], footprint) - radius)
        : distanceToAabb2d(point, blocker, radius);
    nearest = Math.min(nearest, distance);
  }
  return nearest;
}

function distanceToAabb2d(point: Vec3, blocker: NavAabb, radius: number): number {
  const minX = blocker.min[0] - radius;
  const maxX = blocker.max[0] + radius;
  const minZ = blocker.min[2] - radius;
  const maxZ = blocker.max[2] + radius;
  const dx = point[0] < minX ? minX - point[0] : point[0] > maxX ? point[0] - maxX : 0;
  const dz = point[2] < minZ ? minZ - point[2] : point[2] > maxZ ? point[2] - maxZ : 0;
  return Math.hypot(dx, dz);
}

function distancePointToFootprintXZ(px: number, pz: number, footprint: readonly NavVec2[]): number {
  if (footprint.length === 2) {
    const a = footprint[0]!;
    const b = footprint[1]!;
    return distancePointToSegmentXZ(px, pz, a[0], a[1], b[0], b[1]);
  }
  return distancePointToConvexXZ(px, pz, footprint);
}

function neighbors(
  coord: GridCoord,
  passable: (coord: GridCoord) => boolean,
  canTraverse: (from: GridCoord, to: GridCoord) => boolean,
): GridCoord[] {
  const out: GridCoord[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const next = { x: coord.x + dx, z: coord.z + dz };
      if (!passable(next)) continue;
      if (!canTraverse(coord, next)) continue;
      if (dx !== 0 && dz !== 0) {
        const sideX = { x: coord.x + dx, z: coord.z };
        const sideZ = { x: coord.x, z: coord.z + dz };
        if (
          !passable(sideX) ||
          !passable(sideZ) ||
          !canTraverse(coord, sideX) ||
          !canTraverse(coord, sideZ)
        ) {
          continue;
        }
      }
      out.push(next);
    }
  }
  return out;
}

function hasLayerData(grid: NavGrid): grid is LayeredNavGrid {
  return Boolean(grid.layerOffsets && grid.layerCell && grid.layerFloorY && grid.layerPenalty);
}

function uniqueSortedFloors(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (out.some((existing) => Math.abs(existing - value) <= 1e-6)) continue;
    out.push(value);
  }
  return out.sort((a, b) => a - b);
}

function nearestLayerIndex(values: ArrayLike<number>, start: number, end: number, y: number): number {
  let best = start;
  let bestDelta = Infinity;
  for (let i = start; i < end; i += 1) {
    const delta = Math.abs((values[i] ?? 0) - y);
    if (delta < bestDelta) {
      best = i;
      bestDelta = delta;
    }
  }
  return best;
}

function projectLayeredEndpoint(
  grid: LayeredNavGrid,
  point: Vec3,
): { readonly id: number; readonly point: Vec3 } | null {
  const baseX = clamp(Math.round((point[0] - grid.originX) / grid.cellSize), 0, grid.cols - 1);
  const baseZ = clamp(Math.round((point[2] - grid.originZ) / grid.cellSize), 0, grid.rows - 1);
  const base = baseZ * grid.cols + baseX;
  const baseLayer = nearestLayerInCell(grid, base, point[1]);
  if (baseLayer !== null && Math.abs((grid.layerFloorY[baseLayer] ?? grid.footY) - point[1]) <= 1e-4) {
    return { id: baseLayer, point: cloneVec3(point) };
  }

  let best: { id: number; d2: number } | null = null;
  for (let dz = -PROJECTION_MAX_CELL_RADIUS; dz <= PROJECTION_MAX_CELL_RADIUS; dz += 1) {
    for (let dx = -PROJECTION_MAX_CELL_RADIUS; dx <= PROJECTION_MAX_CELL_RADIUS; dx += 1) {
      const x = baseX + dx;
      const z = baseZ + dz;
      if (x < 0 || z < 0 || x >= grid.cols || z >= grid.rows) continue;
      const cell = z * grid.cols + x;
      for (let id = grid.layerOffsets[cell] ?? 0; id < (grid.layerOffsets[cell + 1] ?? 0); id += 1) {
        const candidate = layerPoint(grid, id);
        const ex = candidate[0] - point[0];
        const ey = candidate[1] - point[1];
        const ez = candidate[2] - point[2];
        const d2 = ex * ex + ey * ey + ez * ez;
        if (!best || d2 < best.d2) best = { id, d2 };
      }
    }
  }
  return best ? { id: best.id, point: layerPoint(grid, best.id) } : null;
}

function nearestLayerInCell(grid: LayeredNavGrid, cell: number, y: number): number | null {
  const start = grid.layerOffsets[cell] ?? 0;
  const end = grid.layerOffsets[cell + 1] ?? 0;
  if (end <= start) return null;
  return nearestLayerIndex(grid.layerFloorY, start, end, y);
}

function layeredNeighbors(grid: LayeredNavGrid, id: number): number[] {
  const coord = layerCoord(grid, id);
  const out: number[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const x = coord.x + dx;
      const z = coord.z + dz;
      if (x < 0 || z < 0 || x >= grid.cols || z >= grid.rows) continue;
      if (dx !== 0 && dz !== 0) {
        const sideX = coord.z * grid.cols + x;
        const sideZ = z * grid.cols + coord.x;
        if (!hasTraversableLayer(grid, id, sideX) || !hasTraversableLayer(grid, id, sideZ)) continue;
      }
      const cell = z * grid.cols + x;
      for (let next = grid.layerOffsets[cell] ?? 0; next < (grid.layerOffsets[cell + 1] ?? 0); next += 1) {
        if (canTraverseLayer(grid, id, next)) out.push(next);
      }
    }
  }
  return out;
}

function hasTraversableLayer(grid: LayeredNavGrid, from: number, cell: number): boolean {
  for (let id = grid.layerOffsets[cell] ?? 0; id < (grid.layerOffsets[cell + 1] ?? 0); id += 1) {
    if (canTraverseLayer(grid, from, id)) return true;
  }
  return false;
}

function canTraverseLayer(grid: LayeredNavGrid, from: number, to: number): boolean {
  const delta = (grid.layerFloorY[to] ?? grid.footY) - (grid.layerFloorY[from] ?? grid.footY);
  return delta <= grid.stepHeight + 1e-6 && -delta <= grid.maxStepDown + 1e-6;
}

function layerCoord(grid: LayeredNavGrid, id: number): GridCoord & { readonly id: number } {
  const cell = grid.layerCell[id] ?? 0;
  return { id, x: cell % grid.cols, z: Math.floor(cell / grid.cols) };
}

function layerPoint(grid: LayeredNavGrid, id: number): Vec3 {
  const coord = layerCoord(grid, id);
  return [
    grid.originX + coord.x * grid.cellSize,
    grid.layerFloorY[id] ?? grid.footY,
    grid.originZ + coord.z * grid.cellSize,
  ];
}

function reconstructLayers(cameFrom: ReadonlyMap<string, string>, current: number): number[] {
  const layers = [current];
  let cursor = layerKey(current);
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor)!;
    layers.push(Number(cursor));
  }
  layers.reverse();
  return layers;
}

function layerPathPoints(
  start: Vec3,
  goal: Vec3,
  layers: readonly number[],
  grid: LayeredNavGrid,
  segmentSafe: (a: Vec3, b: Vec3) => boolean,
): Vec3[] {
  const raw: Vec3[] = [cloneVec3(start)];
  for (const layer of layers) pushDistinctPoint(raw, layerPoint(grid, layer));
  pushDistinctPoint(raw, cloneVec3(goal));
  // A layered grid is a heightfield by construction, so never string-pull here.
  return compressPathPoints(raw, segmentSafe, false);
}

function popLowestLayer(open: LayerSearchNode[]): LayerSearchNode {
  let bestIndex = 0;
  for (let i = 1; i < open.length; i += 1) {
    if (open[i]!.f < open[bestIndex]!.f) bestIndex = i;
  }
  return open.splice(bestIndex, 1)[0]!;
}

function layeredHeuristic(grid: LayeredNavGrid, a: number, b: number): number {
  const ca = layerCoord(grid, a);
  const cb = layerCoord(grid, b);
  return Math.hypot(ca.x - cb.x, ca.z - cb.z);
}

function layerKey(id: number): string {
  return String(id);
}

/**
 * Snaps an endpoint to the nearest walkable cell within
 * {@link PROJECTION_MAX_CELL_RADIUS} (the query-extent analogue of Unreal's
 * `ProjectPointToNavigation`). Returns the raw endpoint untouched when its
 * rounded cell is already walkable — so paths whose endpoints sit cleanly on the
 * grid are byte-for-byte unchanged. Candidates are ranked by 3D distance so the
 * projection is height-aware: a goal on an upper platform snaps to the platform
 * cell, not the (X/Z-closer) floor cell directly below it. Returns `null` when no
 * walkable cell exists within the window, so a genuinely unreachable endpoint
 * still fails the query.
 */
function projectEndpoint(
  point: Vec3,
  toCoord: (point: Vec3) => GridCoord,
  toPoint: (coord: GridCoord) => Vec3,
  passable: (coord: GridCoord) => boolean,
): { readonly coord: GridCoord; readonly point: Vec3 } | null {
  const base = toCoord(point);
  if (passable(base)) return { coord: base, point: cloneVec3(point) };
  let best: { coord: GridCoord; d2: number } | null = null;
  for (let dz = -PROJECTION_MAX_CELL_RADIUS; dz <= PROJECTION_MAX_CELL_RADIUS; dz += 1) {
    for (let dx = -PROJECTION_MAX_CELL_RADIUS; dx <= PROJECTION_MAX_CELL_RADIUS; dx += 1) {
      const coord = { x: base.x + dx, z: base.z + dz };
      if (!passable(coord)) continue;
      const candidate = toPoint(coord);
      const ex = candidate[0] - point[0];
      const ey = candidate[1] - point[1];
      const ez = candidate[2] - point[2];
      const d2 = ex * ex + ey * ey + ez * ez;
      if (!best || d2 < best.d2) best = { coord, d2 };
    }
  }
  return best ? { coord: best.coord, point: toPoint(best.coord) } : null;
}

function canTraverseHeight(grid: NavGrid, from: GridCoord, to: GridCoord): boolean {
  const fromY = grid.floorY[from.z * grid.cols + from.x] ?? grid.footY;
  const toY = grid.floorY[to.z * grid.cols + to.x] ?? grid.footY;
  const delta = toY - fromY;
  return delta <= grid.stepHeight + 1e-6 && -delta <= grid.maxStepDown + 1e-6;
}

function reconstructCells(cameFrom: ReadonlyMap<string, string>, current: GridCoord): string[] {
  const cells = [coordKey(current)];
  let cursor = coordKey(current);
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor)!;
    cells.push(cursor);
  }
  cells.reverse();
  return cells;
}

function pathPoints(
  start: Vec3,
  goal: Vec3,
  cells: readonly GridCoord[],
  toPoint: (coord: GridCoord) => Vec3,
  segmentSafe: (a: Vec3, b: Vec3) => boolean,
  stringPull: boolean,
): Vec3[] {
  const raw: Vec3[] = [cloneVec3(start)];
  for (const cell of cells) pushDistinctPoint(raw, toPoint(cell));
  pushDistinctPoint(raw, cloneVec3(goal));
  return compressPathPoints(raw, segmentSafe, stringPull);
}

function pushDistinctPoint(points: Vec3[], point: Vec3): void {
  const prev = points[points.length - 1];
  if (prev && planarDistanceXZ(prev, point) < 1e-9 && Math.abs(prev[1] - point[1]) < 1e-9) return;
  points.push(point);
}

/**
 * Reduce the raw cell-by-cell route to the waypoints an agent actually needs.
 *
 * With `stringPull` the rule is the classic funnel/pull-taut one: keep the last
 * emitted waypoint as an anchor and drop every intermediate point the anchor can
 * see past, so a route only turns where geometry forces it to. Without it, a
 * point is kept at every direction change, which preserves the 8-neighbour A*
 * staircase verbatim — a diagonal run alternates E/NE every cell, and each of
 * those steps survives as a waypoint the follower then visits one by one. That
 * is the zig-zag seen on open ground.
 *
 * String-pulling is only sound where {@link segmentSafe} is the whole truth about
 * walkability, i.e. flat grids ({@link NavGrid.flatFloor}). On a heightfield the
 * dropped cells also carried floor heights, holes and step limits the segment
 * test cannot see, so those grids keep the conservative route.
 */
function compressPathPoints(
  points: readonly Vec3[],
  segmentSafe: (a: Vec3, b: Vec3) => boolean,
  stringPull: boolean,
): Vec3[] {
  if (points.length <= 2) return points.map(cloneVec3);
  const out: Vec3[] = [cloneVec3(points[0]!)];
  let prevDir = pointDirection(points[0]!, points[1]!);
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i]!;
    const next = points[i + 1]!;
    const dir = pointDirection(current, next);
    const changedDirection = dir.x !== prevDir.x || dir.z !== prevDir.z;
    const changedHeight =
      Math.abs(current[1] - points[i - 1]![1]) > 1e-6 ||
      Math.abs(next[1] - current[1]) > 1e-6;
    const shortcutSafe = segmentSafe(out[out.length - 1]!, next);
    const keep = stringPull
      ? changedHeight || !shortcutSafe
      : changedDirection || changedHeight || !shortcutSafe;
    if (keep) out.push(cloneVec3(current));
    prevDir = dir;
  }
  out.push(cloneVec3(points[points.length - 1]!));
  return out;
}

function pointDirection(a: Vec3, b: Vec3): GridCoord {
  return {
    x: Math.sign(b[0] - a[0]),
    z: Math.sign(b[2] - a[2]),
  };
}

function segmentSafe(
  a: Vec3,
  b: Vec3,
  blockers: readonly NavBlocker[],
  radius: number,
  agentHeight: number,
  stepHeight: number,
  bounds: readonly NavAabb[] | undefined,
): boolean {
  if (blockers.some((blocker) => segmentIntersectsBlockingAabb(a, b, blocker, radius, agentHeight, stepHeight))) {
    return false;
  }
  return !bounds || segmentInsideAnyErodedAabb2d(a, b, bounds, radius);
}

function segmentInsideAnyErodedAabb2d(a: Vec3, b: Vec3, bounds: readonly NavAabb[], radius: number): boolean {
  return bounds.some((bound) => pointInsideErodedAabb2d(a, bound, radius) && pointInsideErodedAabb2d(b, bound, radius));
}

function pointInsideErodedAabb2d(point: Vec3, bound: NavAabb, radius: number): boolean {
  return point[0] >= bound.min[0] + radius &&
    point[0] <= bound.max[0] - radius &&
    point[2] >= bound.min[2] + radius &&
    point[2] <= bound.max[2] - radius;
}

function segmentIntersectsBlockingAabb(
  a: Vec3,
  b: Vec3,
  blocker: NavBlocker,
  radius: number,
  agentHeight: number,
  stepHeight: number,
): boolean {
  const footprint = blocker.footprint;
  let clipped: [number, number] | null;
  if (footprint && footprint.length === 2) {
    clipped = segmentIntersectsSegmentFootprintXZ(a, b, footprint[0]!, footprint[1]!, radius) ? [0, 1] : null;
  } else if (footprint && footprint.length >= 3) {
    clipped = clipSegmentConvexXZ(a, b, footprint, radius);
  } else {
    clipped = clipSegmentAabb2d(a, b, blocker, radius);
  }
  if (!clipped) return false;
  const [tMin, tMax] = clipped;
  const y0 = a[1] + (b[1] - a[1]) * tMin;
  const y1 = a[1] + (b[1] - a[1]) * tMax;
  const minFootY = Math.min(y0, y1);
  const maxFootY = Math.max(y0, y1);
  return maxFootY > blocker.min[1] - Math.max(agentHeight, 0.001) &&
    minFootY < blocker.max[1] - stepHeight;
}

function segmentIntersectsSegmentFootprintXZ(
  a: Vec3,
  b: Vec3,
  p: NavVec2,
  q: NavVec2,
  radius: number,
): boolean {
  return distanceSegmentToSegmentXZ(a[0], a[2], b[0], b[2], p[0], p[1], q[0], q[1]) <= radius;
}

function clipSegmentAabb2d(a: Vec3, b: Vec3, blocker: NavAabb, radius: number): [number, number] | null {
  let tMin = 0;
  let tMax = 1;
  const minX = blocker.min[0] - radius;
  const maxX = blocker.max[0] + radius;
  const minZ = blocker.min[2] - radius;
  const maxZ = blocker.max[2] + radius;
  const xHit = clipSegmentAxis(a[0], b[0], minX, maxX, tMin, tMax);
  if (!xHit) return null;
  tMin = xHit[0];
  tMax = xHit[1];
  const zHit = clipSegmentAxis(a[2], b[2], minZ, maxZ, tMin, tMax);
  return zHit;
}

/**
 * Distance from an XZ point to a convex polygon (0 when inside/on the boundary).
 * Winding-independent: a point is inside when it stays on one consistent side of
 * every edge. This is the oriented-blocker analogue of {@link distanceToAabb2d}'s
 * rounded-corner distance, so eroding by `radius` gives a capsule-correct
 * Minkowski clearance around a rotated wall.
 */
function distancePointToConvexXZ(px: number, pz: number, poly: readonly NavVec2[]): number {
  const n = poly.length;
  let minEdgeDistance = Infinity;
  let anyLeft = false;
  let anyRight = false;
  for (let i = 0; i < n; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const wx = px - p[0];
    const wz = pz - p[1];
    const cross = ex * wz - ez * wx;
    if (cross > 1e-9) anyLeft = true;
    else if (cross < -1e-9) anyRight = true;
    const lenSq = ex * ex + ez * ez;
    const t = lenSq > 0 ? clamp((wx * ex + wz * ez) / lenSq, 0, 1) : 0;
    const dx = wx - ex * t;
    const dz = wz - ez * t;
    minEdgeDistance = Math.min(minEdgeDistance, Math.hypot(dx, dz));
  }
  const inside = !(anyLeft && anyRight);
  return inside ? 0 : minEdgeDistance;
}

/**
 * Clips segment `a→b` (XZ) against a convex polygon inflated outward by `radius`,
 * returning the `[tMin, tMax]` sub-range inside it or `null` if it never enters.
 * The convex-polygon analogue of {@link clipSegmentAabb2d}: intersect the
 * segment's parameter range with each edge's outward half-plane pushed out by
 * `radius`. This covers the inflated polygon's straight sides exactly; the
 * rounded corner caps are (slightly permissively) not covered, matching the soft
 * role of this test in path-segment shortcutting.
 */
function distancePointToSegmentXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const ex = bx - ax;
  const ez = bz - az;
  const lenSq = ex * ex + ez * ez;
  const t = lenSq > 0 ? clamp(((px - ax) * ex + (pz - az) * ez) / lenSq, 0, 1) : 0;
  const cx = ax + ex * t;
  const cz = az + ez * t;
  return Math.hypot(px - cx, pz - cz);
}

function distanceSegmentToSegmentXZ(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segmentsIntersectXZ(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  return Math.min(
    distancePointToSegmentXZ(ax, az, cx, cz, dx, dz),
    distancePointToSegmentXZ(bx, bz, cx, cz, dx, dz),
    distancePointToSegmentXZ(cx, cz, ax, az, bx, bz),
    distancePointToSegmentXZ(dx, dz, ax, az, bx, bz),
  );
}

function segmentsIntersectXZ(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const o1 = orientXZ(ax, az, bx, bz, cx, cz);
  const o2 = orientXZ(ax, az, bx, bz, dx, dz);
  const o3 = orientXZ(cx, cz, dx, dz, ax, az);
  const o4 = orientXZ(cx, cz, dx, dz, bx, bz);
  if (Math.abs(o1) <= 1e-9 && pointOnSegmentXZ(cx, cz, ax, az, bx, bz)) return true;
  if (Math.abs(o2) <= 1e-9 && pointOnSegmentXZ(dx, dz, ax, az, bx, bz)) return true;
  if (Math.abs(o3) <= 1e-9 && pointOnSegmentXZ(ax, az, cx, cz, dx, dz)) return true;
  if (Math.abs(o4) <= 1e-9 && pointOnSegmentXZ(bx, bz, cx, cz, dx, dz)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function orientXZ(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function pointOnSegmentXZ(px: number, pz: number, ax: number, az: number, bx: number, bz: number): boolean {
  return px >= Math.min(ax, bx) - 1e-9 &&
    px <= Math.max(ax, bx) + 1e-9 &&
    pz >= Math.min(az, bz) - 1e-9 &&
    pz <= Math.max(az, bz) + 1e-9;
}

function clipSegmentConvexXZ(a: Vec3, b: Vec3, poly: readonly NavVec2[], radius: number): [number, number] | null {
  const n = poly.length;
  if (n < 3) return null;
  let area2 = 0;
  for (let i = 0; i < n; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  const ccw = area2 > 0;
  let tMin = 0;
  let tMax = 1;
  const ax = a[0];
  const az = a[2];
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  for (let i = 0; i < n; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    // Outward edge normal (unit); flip by winding so it points away from the interior.
    let nx = ccw ? ez : -ez;
    let nz = ccw ? -ex : ex;
    const len = Math.hypot(nx, nz);
    if (len < 1e-12) continue;
    nx /= len;
    nz /= len;
    // Constraint keeps the point inside the inflated edge: dist0 + rate*t <= radius.
    const dist0 = nx * (ax - p[0]) + nz * (az - p[1]);
    const rate = nx * dx + nz * dz;
    if (Math.abs(rate) < 1e-12) {
      if (dist0 - radius > 1e-9) return null; // parallel and wholly outside this side
      continue;
    }
    const t = (radius - dist0) / rate;
    if (rate > 0) tMax = Math.min(tMax, t);
    else tMin = Math.max(tMin, t);
    if (tMin > tMax) return null;
  }
  return tMin <= tMax ? [tMin, tMax] : null;
}

function clipSegmentAxis(from: number, to: number, min: number, max: number, tMin: number, tMax: number): [number, number] | null {
  const delta = to - from;
  if (Math.abs(delta) < 1e-9) return from >= min && from <= max ? [tMin, tMax] : null;
  let enter = (min - from) / delta;
  let exit = (max - from) / delta;
  if (enter > exit) [enter, exit] = [exit, enter];
  const clippedMin = Math.max(tMin, enter);
  const clippedMax = Math.min(tMax, exit);
  return clippedMin <= clippedMax ? [clippedMin, clippedMax] : null;
}

function popLowest(open: SearchNode[]): SearchNode {
  let bestIndex = 0;
  for (let i = 1; i < open.length; i += 1) {
    const best = open[bestIndex]!;
    const candidate = open[i]!;
    if (candidate.f < best.f || (candidate.f === best.f && candidate.g < best.g)) bestIndex = i;
  }
  return open.splice(bestIndex, 1)[0]!;
}

function heuristic(a: GridCoord, b: GridCoord): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function coordKey(coord: GridCoord): string {
  return `${coord.x},${coord.z}`;
}

function coordFromKey(key: string): GridCoord {
  const [x, z] = key.split(",").map(Number);
  return { x: x ?? 0, z: z ?? 0 };
}

function sameCoord(a: GridCoord, b: GridCoord): boolean {
  return a.x === b.x && a.z === b.z;
}

function cloneVec3(value: Vec3): Vec3 {
  return [value[0], value[1], value[2]];
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
