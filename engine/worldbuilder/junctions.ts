/**
 * Village-scale T/Y junctions (World Builder plan v0.4 T15, §13.5 L3), as
 * spline data only (decision 19): no terrain flattening or paint here.
 *
 * Where three or more routed roads meet at a plan node, the two of the highest
 * class (ties by edge id) are the through road and keep reaching the node. Every
 * other road there is a branch: its end is pulled back to the through road's
 * edge, so the road meshes meet instead of overlapping. A branch meeting the
 * through road at less than `MIN_JUNCTION_ANGLE_DEG` is reported as a sharp Y.
 *
 * Pure; works on route polylines before heights are sampled. Dependency-free.
 */
import type { WorldPoint } from "./normalize";
import { ROAD_CLASSES, type RoadClass } from "./vocabulary";

export const MIN_JUNCTION_ANGLE_DEG = 30;
/** How far along a road its direction at a node is measured, metres. */
const DIRECTION_REACH = 10;
/** A branch keeps at least this much road after trimming, metres. */
const MIN_BRANCH_LENGTH = 2;

export interface JunctionRoad {
  edge: string;
  from: string;
  to: string;
  roadClass: RoadClass;
  /** Full road width, metres. */
  width: number;
  /** Route from the `from` node to the `to` node. */
  points: WorldPoint[];
}

export interface Junction {
  node: string;
  /** Edge ids of the through road. */
  through: [string, string];
  /** Edge ids pulled back to the through road's edge. */
  branches: string[];
}

/** Trims branch ends in place; returns the junctions found and what could not be resolved. */
export function resolveJunctions(roads: JunctionRoad[]): { junctions: Junction[]; warnings: string[] } {
  const atNode = new Map<string, Array<{ road: JunctionRoad; end: "from" | "to" }>>();
  for (const road of roads) {
    for (const end of ["from", "to"] as const) {
      const node = road[end];
      if (!atNode.has(node)) atNode.set(node, []);
      atNode.get(node)!.push({ road, end });
    }
  }

  const junctions: Junction[] = [];
  const warnings: string[] = [];
  for (const [node, ends] of [...atNode].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (ends.length < 3) continue;
    const ranked = [...ends].sort((a, b) =>
      ROAD_CLASSES.indexOf(a.road.roadClass) - ROAD_CLASSES.indexOf(b.road.roadClass)
      || (a.road.edge < b.road.edge ? -1 : a.road.edge > b.road.edge ? 1 : 0)
      || (a.end < b.end ? -1 : 1));
    const [first, second, ...rest] = ranked;
    const halfWidth = Math.max(first!.road.width, second!.road.width) / 2;
    const throughDirections = [outward(first!.road.points, first!.end), outward(second!.road.points, second!.end)];
    for (const branch of rest) {
      const direction = outward(branch.road.points, branch.end);
      const angle = Math.min(...throughDirections.map((through) => angleBetween(direction, through)));
      if (angle < MIN_JUNCTION_ANGLE_DEG) {
        warnings.push(`junction ${node}: road ${branch.road.edge} meets the through road at ${Math.round(angle)}° (sharper than ${MIN_JUNCTION_ANGLE_DEG}°)`);
      }
      // The through road's edge is `halfWidth` across it; along a slanted branch it is further away.
      const trim = halfWidth / Math.max(Math.sin((angle * Math.PI) / 180), 0.5);
      const trimmed = trimEnd(branch.road.points, branch.end, trim);
      if (trimmed) branch.road.points = trimmed;
      else warnings.push(`junction ${node}: road ${branch.road.edge} is too short to end at the through road's edge; it reaches the node`);
    }
    junctions.push({
      node,
      through: [first!.road.edge, second!.road.edge],
      branches: rest.map((branch) => branch.road.edge),
    });
  }
  return { junctions, warnings };
}

/** Unit direction leaving the node along the road. */
function outward(points: readonly WorldPoint[], end: "from" | "to"): WorldPoint {
  const ordered = end === "from" ? points : [...points].reverse();
  const origin = ordered[0]!;
  let target = ordered[ordered.length - 1]!;
  let walked = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    walked += distance(ordered[index - 1]!, ordered[index]!);
    if (walked >= DIRECTION_REACH) {
      target = ordered[index]!;
      break;
    }
  }
  const length = distance(origin, target);
  return length === 0 ? [0, 0] : [(target[0] - origin[0]) / length, (target[1] - origin[1]) / length];
}

function angleBetween(a: WorldPoint, b: WorldPoint): number {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1]));
  return (Math.acos(dot) * 180) / Math.PI;
}

/** The route with `amount` metres cut off the given end; null when too little would remain. */
export function trimEnd(points: readonly WorldPoint[], end: "from" | "to", amount: number): WorldPoint[] | null {
  const ordered = end === "from" ? [...points] : [...points].reverse();
  let total = 0;
  for (let index = 1; index < ordered.length; index += 1) total += distance(ordered[index - 1]!, ordered[index]!);
  if (total - amount < MIN_BRANCH_LENGTH) return null;
  let walked = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const leg = distance(ordered[index - 1]!, ordered[index]!);
    if (walked + leg > amount) {
      const t = (amount - walked) / leg;
      const a = ordered[index - 1]!;
      const b = ordered[index]!;
      // A cut within half a metre of the next vertex starts there instead of leaving a sliver leg.
      const cut: WorldPoint[] = (1 - t) * leg < 0.5 && index < ordered.length - 1
        ? ordered.slice(index)
        : [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ...ordered.slice(index)];
      return end === "from" ? cut : cut.reverse();
    }
    walked += leg;
  }
  return null;
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
