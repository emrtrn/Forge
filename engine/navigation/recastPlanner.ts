/**
 * Path planning over {@link RecastNavMesh}es for a host with many agents
 * (OPEN_WORLD_PLAN Faz 9, R2).
 *
 * Keeps one tiled mesh per agent profile (size, step, slope) and the authored
 * bounds it was built for, drops them all when the host's static-geometry
 * revision changes, and builds the tiles a request needs before searching:
 * the start→goal rectangle plus one tile of margin for detours, capped so a
 * cross-world request cannot stall a frame on hundreds of tile builds. Tiles
 * stay loaded for later requests until the revision changes or the host
 * evicts them (R3 streams them around invokers).
 *
 * Pure engine module: no DOM, Three.js or editor imports.
 */
import type { Vec3 } from "../scene/layout";
import type { NavAabb, NavAgent, PathResult } from "./gridNavigation";
import { RecastNavMesh, type NavTriangleSource, type RecastModules, type RecastNavMeshOptions } from "./recastNavMesh";

export interface RecastPlanRequest {
  readonly agent: NavAgent;
  readonly start: Vec3;
  readonly goal: Vec3;
  /** Authored AI Navigation Volumes; empty means unbounded. */
  readonly bounds: readonly NavAabb[];
}

export interface RecastPlannerOptions extends Omit<RecastNavMeshOptions, "bounds"> {
  /** Most tiles one request may build synchronously. Default 64 (a 256 m square at 32 m tiles). */
  readonly maxTilesPerRequest?: number;
  /**
   * Moves a corner onto the host's real floor. Detour corners sit on the
   * voxelized mesh, up to a cell height off; a follower that compares heights
   * tightly wants the floor its character actually stands on.
   */
  readonly snapHeight?: (agent: NavAgent, point: Vec3) => number;
}

const DEFAULT_MAX_TILES_PER_REQUEST = 64;

export class RecastPlanner {
  private readonly meshes = new Map<string, RecastNavMesh>();
  private revision: unknown = undefined;

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

  findPath(request: RecastPlanRequest): PathResult {
    const mesh = this.meshFor(request.agent, request.bounds);
    const { start, goal } = request;
    const margin = mesh.tileSize;
    const minX = Math.min(start[0], goal[0]) - margin;
    const minZ = Math.min(start[2], goal[2]) - margin;
    const maxX = Math.max(start[0], goal[0]) + margin;
    const maxZ = Math.max(start[2], goal[2]) + margin;
    const cap = Math.max(1, this.options.maxTilesPerRequest ?? DEFAULT_MAX_TILES_PER_REQUEST);
    // The endpoints' own tiles first, so a capped request still has both ends.
    for (const point of [start, goal]) {
      mesh.ensureTilesInRect(point[0], point[2], point[0], point[2]);
    }
    mesh.ensureTilesInRect(minX, minZ, maxX, maxZ, cap);
    const result = mesh.findPath(start, goal);
    const snap = this.options.snapHeight;
    if (result.status !== "success" || !snap) return result;
    return {
      ...result,
      points: result.points.map((point): Vec3 => [point[0], snap(request.agent, point), point[2]]),
    };
  }

  /** Loaded tile keys per agent profile (debug). */
  loadedTiles(): { profile: string; tiles: string[] }[] {
    return [...this.meshes.entries()].map(([profile, mesh]) => ({ profile, tiles: mesh.loadedTileKeys() }));
  }

  /** Triangles of every loaded mesh (debug drawing). */
  debugGeometry(): { positions: number[]; indices: number[] }[] {
    return [...this.meshes.values()].map((mesh) => mesh.debugGeometry());
  }

  clear(): void {
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.meshes.clear();
  }

  dispose(): void {
    this.clear();
    this.revision = undefined;
  }

  private meshFor(agent: NavAgent, bounds: readonly NavAabb[]): RecastNavMesh {
    const key = profileKey(agent, bounds);
    let mesh = this.meshes.get(key);
    if (!mesh) {
      const { maxTilesPerRequest: _cap, snapHeight: _snap, ...meshOptions } = this.options;
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
