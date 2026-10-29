/**
 * Planner-independent navigation types and path following.
 *
 * Paths come from the Recast/Detour planner (`recastPlanner.ts`); these types
 * describe what every part of the AI stack shares around it — the agent
 * profile, static obstacle boxes (perception, line of sight, debug drawing),
 * a path result and a follower's waypoint cursor.
 *
 * Navigation contract (Unreal/Recast `Agent Radius` analogue): a path point is
 * the agent capsule *center* at foot height, never a surface point. The nav
 * mesh is eroded by `agent.radius + agent.clearancePadding`, so the capsule
 * body stays clear of walls.
 *
 * Pure engine module: no DOM, Three.js or editor imports.
 */
import type { NavigationRole } from "../scene/collision";
import type { Vec3 } from "../scene/layout";

export interface NavAabb {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** World XZ point `[x, z]` (a blocker footprint vertex). */
export type NavVec2 = readonly [number, number];

/**
 * A static obstacle box. Its {@link NavAabb} `min`/`max` always bound it.
 * When `footprint` is present it is the *oriented* convex XZ shape the box
 * projects onto the ground — the exact ground silhouette of a rotated wall,
 * instead of the axis-aligned box that encloses (and bloats) it. Consumers
 * test against the footprint when present and fall back to the axis-aligned
 * `min.xz..max.xz` rectangle otherwise, so a plain {@link NavAabb} is a valid
 * `NavBlocker`.
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
   * to the nav mesh erosion so the agent keeps a safety gap from walls. Keep it
   * small — large values close off narrow corridors. Defaults to 0.
   */
  readonly clearancePadding?: number;
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
 * past a wall; only the final goal honors the authored acceptance. The vertical
 * component matters on slopes and stairs: reaching a ramp/platform waypoint's
 * X/Z is not enough if the agent has not actually climbed to that floor yet.
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
