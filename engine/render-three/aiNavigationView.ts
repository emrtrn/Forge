import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
} from "three";

import type { NavAabb, NavBlocker } from "../navigation/navigationTypes";
import type { Vec3 } from "../scene/layout";

export interface AiNavigationFollowerView {
  readonly status: "idle" | "following" | "success" | "failure";
  readonly waypointIndex: number;
  readonly path: readonly Vec3[];
  readonly goal?: Vec3 | null;
  readonly secondsWithoutProgress?: number;
}

export interface AiPerceptionView {
  readonly entityId: string;
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly sightRadius?: number;
  readonly fieldOfViewDeg?: number;
  readonly hearingRadius?: number;
}

export interface AiQueryCandidateView {
  readonly entityId?: string;
  readonly position: Vec3;
  readonly score: number;
  readonly failedTests?: readonly string[];
  readonly winner?: boolean;
}

export interface AiTargetPointRouteView {
  readonly id: string;
  readonly position: Vec3;
  /** Resolved position of `nextTargetPoint`, drawn as a directed route link (null at route end). */
  readonly next?: Vec3 | null;
  /** True when a live AI is currently patrolling toward this point. */
  readonly active?: boolean;
}

export interface AiNavAgentClearanceView {
  readonly entityId: string;
  readonly position: Vec3;
  /** Physical agent/capsule radius before clearance padding and grid safety. */
  readonly agentRadius?: number;
  /** Effective planar clearance radius used for pathing (agent + padding + grid safety). */
  readonly radius: number;
  /** Selected AI receives an additional explicit radius + clearance highlight. */
  readonly selected?: boolean;
}

export interface AiNavigationViewInput {
  readonly blockers?: readonly NavBlocker[];
  readonly bounds?: readonly NavAabb[];
  readonly followers?: readonly AiNavigationFollowerView[];
  readonly perception?: readonly AiPerceptionView[];
  readonly queries?: readonly AiQueryCandidateView[];
  readonly routes?: readonly AiTargetPointRouteView[];
  readonly agentClearances?: readonly AiNavAgentClearanceView[];
  readonly y?: number;
}

const BLOCKER_COLOR = 0xff6b4a;
const BOUNDS_COLOR = 0x52a3ff;
const PATH_COLOR = 0x3fd47f;
const PATH_STALLED_COLOR = 0xffc857;
const PATH_FAILED_COLOR = 0xff4d6d;
const WAYPOINT_COLOR = 0xfff06a;
const AGENT_CLEARANCE_COLOR = 0xffe08a;
const SELECTED_AGENT_RADIUS_COLOR = 0x75d7ff;
const SELECTED_AGENT_CLEARANCE_COLOR = 0xffffff;
const SIGHT_COLOR = 0x8ee66b;
const HEARING_COLOR = 0x9f7aff;
const QUERY_CANDIDATE_COLOR = 0x75d7ff;
const QUERY_FAILED_COLOR = 0x7d8794;
const QUERY_WINNER_COLOR = 0x00f5a0;
const ROUTE_POINT_COLOR = 0xf5c542;
const ROUTE_LINK_COLOR = 0xf5a742;
const ROUTE_ACTIVE_COLOR = 0x00f5a0;
const DEFAULT_SIGHT_FOV_DEG = 90;

export function createAiNavigationView(input: AiNavigationViewInput): Group {
  const group = new Group();
  group.name = "ai-navigation-debug-view";
  const y = input.y ?? 0.04;
  const bounds = computeBounds(
    input.blockers ?? [],
    input.bounds ?? [],
    input.followers ?? [],
    input.perception ?? [],
    input.queries ?? [],
    input.routes ?? [],
    input.agentClearances ?? [],
  );
  if (!bounds) return group;

  const navBounds = blockerFootprintSegments(input.bounds ?? [], y + 0.01);
  if (navBounds.length > 0) group.add(lineSegments("ai-nav-bounds", navBounds, BOUNDS_COLOR, 0.95));

  const blockers = blockerFootprintSegments(input.blockers ?? [], y + 0.015);
  if (blockers.length > 0) group.add(lineSegments("ai-nav-blockers", blockers, BLOCKER_COLOR, 0.8));

  for (const clearance of input.agentClearances ?? []) {
    const radius = positiveFinite(clearance.radius);
    if (radius === null) continue;
    group.add(
      lineSegments(
        "ai-nav-agent-clearance",
        circleSegments(clearance.position, radius, y + 0.1, 40),
        AGENT_CLEARANCE_COLOR,
        0.85,
      ),
    );
    if (clearance.selected === true) {
      const agentRadius = positiveFinite(clearance.agentRadius);
      if (agentRadius !== null) {
        group.add(
          lineSegments(
            "ai-nav-selected-agent-radius",
            circleSegments(clearance.position, agentRadius, y + 0.125, 40),
            SELECTED_AGENT_RADIUS_COLOR,
            1,
          ),
        );
      }
      group.add(
        lineSegments(
          "ai-nav-selected-agent-clearance",
          circleSegments(clearance.position, radius, y + 0.14, 48),
          SELECTED_AGENT_CLEARANCE_COLOR,
          1,
        ),
      );
    }
  }

  for (const follower of input.followers ?? []) {
    const color =
      follower.status === "failure"
        ? PATH_FAILED_COLOR
        : (follower.secondsWithoutProgress ?? 0) >= 0.5
          ? PATH_STALLED_COLOR
          : PATH_COLOR;
    const path = pathSegments(follower.path, y + 0.08);
    if (path.length > 0) group.add(lineSegments("ai-nav-path", path, color, 0.95));
    const waypoint = follower.path[follower.waypointIndex] ?? follower.goal ?? null;
    if (waypoint) {
      group.add(
        lineSegments(
          follower.status === "failure" ? "ai-nav-failed-goal" : "ai-nav-current-waypoint",
          crossSegments(waypoint, y + 0.12, follower.status === "failure" ? 0.35 : 0.22),
          follower.status === "failure" ? PATH_FAILED_COLOR : WAYPOINT_COLOR,
          1,
        ),
      );
    }
  }

  for (const perception of input.perception ?? []) {
    const hearingRadius = positiveFinite(perception.hearingRadius);
    if (hearingRadius !== null) {
      group.add(
        lineSegments(
          "ai-perception-hearing-radius",
          circleSegments(perception.position, hearingRadius, y + 0.16),
          HEARING_COLOR,
          0.45,
        ),
      );
    }
    const sightRadius = positiveFinite(perception.sightRadius);
    if (sightRadius !== null) {
      group.add(
        lineSegments(
          "ai-perception-sight-cone",
          coneSegments(
            perception.position,
            perception.forward,
            sightRadius,
            perception.fieldOfViewDeg ?? DEFAULT_SIGHT_FOV_DEG,
            y + 0.18,
          ),
          SIGHT_COLOR,
          0.65,
        ),
      );
    }
  }

  for (const route of input.routes ?? []) {
    if (route.next) {
      group.add(
        lineSegments("ai-route-link", routeLinkSegments(route.position, route.next, y + 0.2), ROUTE_LINK_COLOR, 0.7),
      );
    }
    group.add(
      lineSegments("ai-route-point", crossSegments(route.position, y + 0.22, 0.3), ROUTE_POINT_COLOR, 0.9),
    );
    if (route.active) {
      group.add(
        lineSegments("ai-route-active", circleSegments(route.position, 0.45, y + 0.24, 24), ROUTE_ACTIVE_COLOR, 1),
      );
    }
  }

  for (const candidate of input.queries ?? []) {
    const failed = (candidate.failedTests?.length ?? 0) > 0;
    const winner = candidate.winner === true;
    const color = winner ? QUERY_WINNER_COLOR : failed ? QUERY_FAILED_COLOR : QUERY_CANDIDATE_COLOR;
    const size = winner ? 0.32 : 0.18;
    group.add(
      lineSegments(
        winner ? "ai-query-winner" : failed ? "ai-query-failed-candidate" : "ai-query-candidate",
        queryCandidateSegments(candidate.position, y + (winner ? 0.28 : 0.24), size, winner),
        color,
        winner ? 1 : 0.7,
      ),
    );
  }

  return group;
}

export function disposeAiNavigationView(group: Group | null): void {
  if (!group) return;
  group.traverse((object) => {
    if (!(object instanceof LineSegments) && !(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function lineSegments(name: string, points: readonly Vec3[], color: number, opacity: number): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points.flatMap((point) => point), 3));
  const material = new LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.name = name;
  lines.renderOrder = 20;
  return lines;
}

function computeBounds(
  blockers: readonly NavAabb[],
  bounds: readonly NavAabb[],
  followers: readonly AiNavigationFollowerView[],
  perceptions: readonly AiPerceptionView[],
  queries: readonly AiQueryCandidateView[],
  routes: readonly AiTargetPointRouteView[],
  agentClearances: readonly AiNavAgentClearanceView[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const include = (point: readonly [number, number, number]) => {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minZ = Math.min(minZ, point[2]);
    maxZ = Math.max(maxZ, point[2]);
  };
  for (const blocker of blockers) {
    include(blocker.min);
    include(blocker.max);
  }
  for (const bound of bounds) {
    include(bound.min);
    include(bound.max);
  }
  for (const follower of followers) {
    for (const point of follower.path) include(point);
    if (follower.goal) include(follower.goal);
  }
  for (const perception of perceptions) {
    include(perception.position);
    const radius = Math.max(
      positiveFinite(perception.sightRadius) ?? 0,
      positiveFinite(perception.hearingRadius) ?? 0,
    );
    if (radius > 0) {
      include([perception.position[0] - radius, perception.position[1], perception.position[2] - radius]);
      include([perception.position[0] + radius, perception.position[1], perception.position[2] + radius]);
    }
  }
  for (const candidate of queries) include(candidate.position);
  for (const route of routes) {
    include(route.position);
    if (route.next) include(route.next);
  }
  for (const clearance of agentClearances) {
    const radius = positiveFinite(clearance.radius);
    if (radius === null) {
      include(clearance.position);
      continue;
    }
    include([clearance.position[0] - radius, clearance.position[1], clearance.position[2] - radius]);
    include([clearance.position[0] + radius, clearance.position[1], clearance.position[2] + radius]);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return null;
  }
  const padding = 1.5;
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minZ: minZ - padding,
    maxZ: maxZ + padding,
  };
}

function blockerFootprintSegments(blockers: readonly NavBlocker[], y: number): Vec3[] {
  const out: Vec3[] = [];
  for (const blocker of blockers) {
    const footprint = blocker.footprint;
    if (footprint && footprint.length >= 2) {
      // Rotated obstacle: trace its true oriented ground silhouette so the red
      // outline matches the tight shape navigation actually erodes against,
      // instead of the axis-aligned box that encloses (and visually bloats) it.
      for (let i = 0; i < footprint.length; i += 1) {
        const a = footprint[i]!;
        const b = footprint[(i + 1) % footprint.length]!;
        out.push([a[0], y, a[1]], [b[0], y, b[1]]);
      }
      continue;
    }
    const minX = blocker.min[0];
    const maxX = blocker.max[0];
    const minZ = blocker.min[2];
    const maxZ = blocker.max[2];
    out.push(
      [minX, y, minZ],
      [maxX, y, minZ],
      [maxX, y, minZ],
      [maxX, y, maxZ],
      [maxX, y, maxZ],
      [minX, y, maxZ],
      [minX, y, maxZ],
      [minX, y, minZ],
    );
  }
  return out;
}

function pathSegments(path: readonly Vec3[], y: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    out.push([a[0], y, a[2]], [b[0], y, b[2]]);
  }
  return out;
}

function routeLinkSegments(from: Vec3, to: Vec3, y: number): Vec3[] {
  const a: Vec3 = [from[0], y, from[2]];
  const b: Vec3 = [to[0], y, to[2]];
  const out: Vec3[] = [a, b];
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  if (len > 1e-3) {
    const ux = dx / len;
    const uz = dz / len;
    // Arrowhead pointing at the `next` point so route direction is readable.
    const tipX = b[0] - ux * 0.4;
    const tipZ = b[2] - uz * 0.4;
    const back = 0.28;
    const side = 0.16;
    const px = -uz;
    const pz = ux;
    out.push(
      [b[0] - ux * 0.4, y, b[2] - uz * 0.4],
      [tipX - ux * back + px * side, y, tipZ - uz * back + pz * side],
      [b[0] - ux * 0.4, y, b[2] - uz * 0.4],
      [tipX - ux * back - px * side, y, tipZ - uz * back - pz * side],
    );
  }
  return out;
}

function crossSegments(point: Vec3, y: number, size: number): Vec3[] {
  const x = point[0];
  const z = point[2];
  return [
    [x - size, y, z],
    [x + size, y, z],
    [x, y, z - size],
    [x, y, z + size],
  ];
}

function queryCandidateSegments(point: Vec3, y: number, size: number, winner: boolean): Vec3[] {
  const out = crossSegments(point, y, size);
  if (winner) {
    out.push(...circleSegments(point, size * 1.35, y, 24));
  }
  return out;
}

function circleSegments(center: Vec3, radius: number, y: number, steps = 48): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const b = ((i + 1) / steps) * Math.PI * 2;
    out.push(
      [center[0] + Math.cos(a) * radius, y, center[2] + Math.sin(a) * radius],
      [center[0] + Math.cos(b) * radius, y, center[2] + Math.sin(b) * radius],
    );
  }
  return out;
}

function coneSegments(center: Vec3, forward: Vec3, radius: number, fovDeg: number, y: number): Vec3[] {
  const clampedFov = Math.max(1, Math.min(360, fovDeg));
  const steps = Math.max(6, Math.ceil(clampedFov / 8));
  const yaw = Math.atan2(forward[2], forward[0]);
  const half = (clampedFov * Math.PI) / 360;
  const start = yaw - half;
  const end = yaw + half;
  const out: Vec3[] = [];
  const left = [center[0] + Math.cos(start) * radius, y, center[2] + Math.sin(start) * radius] satisfies Vec3;
  const right = [center[0] + Math.cos(end) * radius, y, center[2] + Math.sin(end) * radius] satisfies Vec3;
  out.push([center[0], y, center[2]], left, [center[0], y, center[2]], right);
  for (let i = 0; i < steps; i += 1) {
    const a = start + ((end - start) * i) / steps;
    const b = start + ((end - start) * (i + 1)) / steps;
    out.push(
      [center[0] + Math.cos(a) * radius, y, center[2] + Math.sin(a) * radius],
      [center[0] + Math.cos(b) * radius, y, center[2] + Math.sin(b) * radius],
    );
  }
  return out;
}

function positiveFinite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

