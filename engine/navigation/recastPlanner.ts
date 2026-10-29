/**
 * Path planning and tile streaming over {@link RecastNavMesh}es for a host
 * with many agents (OPEN_WORLD_PLAN Faz 9, R2–R3).
 *
 * Keeps one tiled mesh per agent profile (size, step, slope) and the authored
 * bounds it was built for. Tiles follow **invokers** (Unreal's Navigation
 * Invoker): {@link RecastPlanner.update} builds the tiles within
 * `buildRadius` of every invoker, nearest first, inside a per-frame time
 * budget, and drops tiles that stayed beyond `keepRadius` for `lingerSeconds`.
 * An invoker with an agent feeds that agent's mesh; one without (the player)
 * feeds every mesh.
 *
 * Geometry changes arrive as dirty rectangles ({@link invalidateRect}) or as a
 * whole-world {@link invalidateAll}: the affected tiles turn stale, stay
 * searchable, and are rebuilt by the same budgeted queue — or dropped when no
 * invoker wants them any more. A host without dirty regions can instead
 * declare a revision ({@link setRevision}); a new one drops every mesh.
 *
 * A path request needs every tile of its corridor (the start→goal rectangle
 * plus one tile of margin, at most `maxTilesPerRequest`, endpoint tiles
 * first). With `maxSyncBuilds` it builds up to that many on the spot;
 * otherwise the missing ones jump the queue and the request answers
 * `"pending"` until a later frame has built them.
 *
 * Pure engine module: no DOM, Three.js or editor imports.
 */
import type { Vec3 } from "../scene/layout";
import type { NavAabb, NavAgent, PathResult } from "./gridNavigation";
import {
  recastTileKey,
  RecastNavMesh,
  type NavTriangleSource,
  type RecastModules,
  type RecastNavMeshOptions,
  type RecastTileCoord,
} from "./recastNavMesh";

export interface RecastPlanRequest {
  readonly agent: NavAgent;
  readonly start: Vec3;
  readonly goal: Vec3;
  /** Authored AI Navigation Volumes; empty means unbounded. */
  readonly bounds: readonly NavAabb[];
}

/** A path, or `"pending"` while the corridor's tiles wait in the build queue. */
export type RecastPlanResult = PathResult | { readonly status: "pending"; readonly points: readonly Vec3[]; readonly visited: 0 };

export interface RecastInvoker {
  readonly position: Vec3;
  /** The agent whose mesh this invoker feeds; absent feeds every mesh (the player). */
  readonly agent?: NavAgent;
}

export interface RecastStreamingUpdate {
  readonly invokers: readonly RecastInvoker[];
  /** Authored AI Navigation Volumes; selects the meshes agent invokers feed. */
  readonly bounds: readonly NavAabb[];
  /** Host clock in seconds; drives eviction. */
  readonly now: number;
}

export interface RecastPlannerOptions extends Omit<RecastNavMeshOptions, "bounds"> {
  /** Most tiles one request may need. Default 64 (a 256 m square at 32 m tiles). */
  readonly maxTilesPerRequest?: number;
  /**
   * Tiles a request may build synchronously before answering `"pending"`.
   * Default unlimited (tests, small hosts); a frame-budgeted host passes 0.
   */
  readonly maxSyncBuilds?: number;
  /** Tiles within this distance of an invoker are built. Default 48. */
  readonly buildRadius?: number;
  /** Tiles beyond this distance from every invoker may be dropped. Default 96. */
  readonly keepRadius?: number;
  /** How long an unwanted tile survives, so a request's corridor is not thrown away at once. Default 10. */
  readonly lingerSeconds?: number;
  /** Build time per {@link RecastPlanner.update}; at least one tile is built when any waits. Default 4. */
  readonly frameBudgetMs?: number;
  /** Clock for the frame budget; defaults to `performance.now`. */
  readonly clockMs?: () => number;
  /**
   * Moves a corner onto the host's real floor. Detour corners sit on the
   * voxelized mesh, up to a cell height off; a follower that compares heights
   * tightly wants the floor its character actually stands on.
   */
  readonly snapHeight?: (agent: NavAgent, point: Vec3) => number;
}

export interface RecastStreamingStats {
  /** Tiles built by the last update. */
  readonly built: number;
  /** Tiles dropped by the last update. */
  readonly dropped: number;
  /** Tiles still waiting after the last update. */
  readonly queued: number;
}

const DEFAULT_MAX_TILES_PER_REQUEST = 64;
const DEFAULT_BUILD_RADIUS = 48;
const DEFAULT_KEEP_RADIUS = 96;
const DEFAULT_LINGER_SECONDS = 10;
const DEFAULT_FRAME_BUDGET_MS = 4;

interface QueuedTile {
  readonly mesh: RecastNavMesh;
  readonly x: number;
  readonly z: number;
  readonly priority: number;
}

export class RecastPlanner {
  private readonly meshes = new Map<string, RecastNavMesh>();
  /** Tiles a pending request waits for, per mesh; they jump the queue. */
  private readonly requested = new Map<RecastNavMesh, Set<string>>();
  private revision: unknown = undefined;
  private now = 0;
  private lastStats: RecastStreamingStats = { built: 0, dropped: 0, queued: 0 };

  constructor(
    private readonly modules: RecastModules,
    private readonly source: NavTriangleSource,
    private readonly options: RecastPlannerOptions = {},
  ) {}

  /**
   * Declares the host's static-geometry revision. A different value than the
   * last one drops every mesh, so the next request rebuilds from the new world.
   */
  setRevision(revision: unknown): void {
    if (Object.is(revision, this.revision)) return;
    this.revision = revision;
    this.clear();
  }

  /** Static geometry changed inside the rectangle: its tiles turn stale. */
  invalidateRect(minX: number, minZ: number, maxX: number, maxZ: number): void {
    for (const mesh of this.meshes.values()) mesh.markStaleInRect(minX, minZ, maxX, maxZ);
  }

  /** Everything may have changed: every loaded tile turns stale. */
  invalidateAll(): void {
    for (const mesh of this.meshes.values()) mesh.markAllStale();
  }

  findPath(request: RecastPlanRequest): RecastPlanResult {
    const mesh = this.meshFor(request.agent, request.bounds);
    const corridor = this.corridorTiles(mesh, request.start, request.goal);
    for (const tile of corridor) mesh.touchTile(tile.x, tile.z, this.now);
    let missing = corridor.filter((tile) => mesh.needsBuild(tile.x, tile.z));
    const syncBuilds = this.options.maxSyncBuilds ?? Infinity;
    for (const tile of missing.slice(0, Math.max(0, syncBuilds))) this.buildTile(mesh, tile.x, tile.z);
    missing = missing.filter((tile) => mesh.needsBuild(tile.x, tile.z));
    if (missing.length > 0) {
      const waiting = this.requested.get(mesh) ?? new Set<string>();
      for (const tile of missing) waiting.add(recastTileKey(tile.x, tile.z));
      this.requested.set(mesh, waiting);
      return { status: "pending", points: [], visited: 0 };
    }
    const result = mesh.findPath(request.start, request.goal);
    const snap = this.options.snapHeight;
    if (result.status !== "success" || !snap) return result;
    return {
      ...result,
      points: result.points.map((point): Vec3 => [point[0], snap(request.agent, point), point[2]]),
    };
  }

  /**
   * One streaming step: keeps the tiles around the invokers fresh, drops the
   * ones nobody wants, and builds queued tiles within the frame budget.
   */
  update(update: RecastStreamingUpdate): RecastStreamingStats {
    this.now = update.now;
    const buildRadius = this.options.buildRadius ?? DEFAULT_BUILD_RADIUS;
    const keepRadius = Math.max(buildRadius, this.options.keepRadius ?? DEFAULT_KEEP_RADIUS);
    const linger = this.options.lingerSeconds ?? DEFAULT_LINGER_SECONDS;
    // Agent invokers bring their profile's mesh into existence, so its tiles
    // are ready before the agent's first request.
    for (const invoker of update.invokers) {
      if (invoker.agent) this.meshFor(invoker.agent, update.bounds);
    }

    const queue: QueuedTile[] = [];
    let dropped = 0;
    for (const [key, mesh] of this.meshes) {
      const points = update.invokers
        .filter((invoker) => !invoker.agent || profileKey(invoker.agent, update.bounds) === key)
        .map((invoker) => invoker.position);
      const waiting = this.requested.get(mesh);
      const wanted = new Set<string>();
      for (const point of points) {
        for (const tile of tilesAround(mesh, point, keepRadius)) {
          mesh.touchTile(tile.x, tile.z, update.now);
          if (tileDistance(mesh, tile, point) > buildRadius) continue;
          const tileKey = recastTileKey(tile.x, tile.z);
          if (wanted.has(tileKey)) continue;
          wanted.add(tileKey);
          if (!mesh.needsBuild(tile.x, tile.z) || waiting?.has(tileKey)) continue;
          queue.push({ mesh, x: tile.x, z: tile.z, priority: 1 + nearestDistance(mesh, tile, points) });
        }
      }
      for (const tileKey of waiting ?? []) {
        const [x, z] = parseTileKey(tileKey);
        if (mesh.needsBuild(x, z)) queue.push({ mesh, x, z, priority: 0 });
        else waiting!.delete(tileKey);
      }
      for (const tileKey of mesh.loadedTileKeys()) {
        if (wanted.has(tileKey) || waiting?.has(tileKey)) continue;
        const [x, z] = parseTileKey(tileKey);
        // Outside the build radius a stale tile is dropped rather than rebuilt;
        // a request that needs it again queues it.
        const stale = mesh.needsBuild(x, z);
        if (!stale && update.now - mesh.tileLastUsed(tileKey) <= linger) continue;
        mesh.removeTile(x, z);
        dropped += 1;
      }
    }

    queue.sort((a, b) => a.priority - b.priority);
    const clock = this.options.clockMs ?? (() => performance.now());
    const budget = this.options.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS;
    const started = clock();
    let built = 0;
    for (const tile of queue) {
      if (built > 0 && clock() - started >= budget) break;
      // An earlier entry (a request and an invoker can both want it) may have built it.
      if (!tile.mesh.needsBuild(tile.x, tile.z)) continue;
      this.buildTile(tile.mesh, tile.x, tile.z);
      built += 1;
    }
    const queued = queue.filter((tile) => tile.mesh.needsBuild(tile.x, tile.z)).length;
    this.lastStats = { built, dropped, queued };
    return this.lastStats;
  }

  /** Loaded and stale tile counts per agent profile (debug). */
  loadedTiles(): { profile: string; tiles: string[]; stale: number }[] {
    return [...this.meshes.entries()].map(([profile, mesh]) => ({
      profile,
      tiles: mesh.loadedTileKeys(),
      stale: mesh.staleTileCount(),
    }));
  }

  /** What the last {@link update} did (debug). */
  streamingStats(): RecastStreamingStats {
    return this.lastStats;
  }

  /** Triangles of every loaded mesh (debug drawing). */
  debugGeometry(): { positions: number[]; indices: number[] }[] {
    return [...this.meshes.values()].map((mesh) => mesh.debugGeometry());
  }

  clear(): void {
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.meshes.clear();
    this.requested.clear();
  }

  dispose(): void {
    this.clear();
    this.revision = undefined;
  }

  private buildTile(mesh: RecastNavMesh, x: number, z: number): void {
    mesh.buildTile(x, z);
    mesh.touchTile(x, z, this.now);
    this.requested.get(mesh)?.delete(recastTileKey(x, z));
  }

  /** Endpoint tiles first, then the margin rectangle nearest the start→goal segment, capped. */
  private corridorTiles(mesh: RecastNavMesh, start: Vec3, goal: Vec3): RecastTileCoord[] {
    const cap = Math.max(2, this.options.maxTilesPerRequest ?? DEFAULT_MAX_TILES_PER_REQUEST);
    const margin = mesh.tileSize;
    const tiles = new Map<string, RecastTileCoord>();
    for (const point of [start, goal]) {
      for (const tile of mesh.tilesInRect(point[0], point[2], point[0], point[2])) tiles.set(recastTileKey(tile.x, tile.z), tile);
    }
    const rect = mesh.tilesInRect(
      Math.min(start[0], goal[0]) - margin, Math.min(start[2], goal[2]) - margin,
      Math.max(start[0], goal[0]) + margin, Math.max(start[2], goal[2]) + margin,
    ).sort((a, b) => segmentDistance(mesh, a, start, goal) - segmentDistance(mesh, b, start, goal));
    for (const tile of rect) {
      if (tiles.size >= cap) break;
      tiles.set(recastTileKey(tile.x, tile.z), tile);
    }
    return [...tiles.values()];
  }

  private meshFor(agent: NavAgent, bounds: readonly NavAabb[]): RecastNavMesh {
    const key = profileKey(agent, bounds);
    let mesh = this.meshes.get(key);
    if (!mesh) {
      const {
        maxTilesPerRequest: _cap, maxSyncBuilds: _sync, buildRadius: _build, keepRadius: _keep,
        lingerSeconds: _linger, frameBudgetMs: _budget, clockMs: _clock, snapHeight: _snap, ...meshOptions
      } = this.options;
      mesh = new RecastNavMesh(this.modules, agent, this.source, {
        ...meshOptions,
        ...(bounds.length > 0 ? { bounds } : {}),
      });
      this.meshes.set(key, mesh);
    }
    return mesh;
  }
}

function profileKey(agent: NavAgent, bounds: readonly NavAabb[]): string {
  const size = [agent.radius, agent.height, agent.stepHeight ?? 0, agent.maxSlopeAngleDeg ?? 0, agent.clearancePadding ?? 0];
  const volumes = bounds.map((bound) => [...bound.min, ...bound.max].join(",")).join(";");
  return `${size.join(",")}|${volumes}`;
}

function parseTileKey(key: string): [number, number] {
  const [x, z] = key.split("_").map(Number) as [number, number];
  return [x, z];
}

function tilesAround(mesh: RecastNavMesh, point: Vec3, radius: number): RecastTileCoord[] {
  return mesh.tilesInRect(point[0] - radius, point[2] - radius, point[0] + radius, point[2] + radius)
    .filter((tile) => tileDistance(mesh, tile, point) <= radius);
}

/** Distance from a point to the nearest point of a tile's square (0 inside it). */
function tileDistance(mesh: RecastNavMesh, tile: RecastTileCoord, point: Vec3): number {
  const minX = tile.x * mesh.tileSize;
  const minZ = tile.z * mesh.tileSize;
  const dx = Math.max(minX - point[0], 0, point[0] - (minX + mesh.tileSize));
  const dz = Math.max(minZ - point[2], 0, point[2] - (minZ + mesh.tileSize));
  return Math.hypot(dx, dz);
}

function nearestDistance(mesh: RecastNavMesh, tile: RecastTileCoord, points: readonly Vec3[]): number {
  let nearest = Infinity;
  for (const point of points) nearest = Math.min(nearest, tileDistance(mesh, tile, point));
  return nearest;
}

/** Distance from a tile's centre to the start→goal segment, in X/Z. */
function segmentDistance(mesh: RecastNavMesh, tile: RecastTileCoord, start: Vec3, goal: Vec3): number {
  const cx = (tile.x + 0.5) * mesh.tileSize;
  const cz = (tile.z + 0.5) * mesh.tileSize;
  const dx = goal[0] - start[0];
  const dz = goal[2] - start[2];
  const length = dx * dx + dz * dz;
  const t = length > 0 ? Math.max(0, Math.min(1, ((cx - start[0]) * dx + (cz - start[2]) * dz) / length)) : 0;
  return Math.hypot(cx - (start[0] + dx * t), cz - (start[2] + dz * t));
}
