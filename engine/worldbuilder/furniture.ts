/**
 * Street furniture, L7 (World Builder plan v0.4 §13.3, §13.5 "L7 Donatı").
 *
 * The region profile's `streetFurniture` rules name a role, the road classes
 * it belongs to and where it goes along them:
 *
 * - `gate`: at each settlement entrance — the plan's gate nodes, else where a
 *   road crosses the core's edge — on the traffic side of the incoming lane,
 *   facing the incoming driver (a name or speed sign);
 * - `junction`: in the widest gap between the arms of every junction in the
 *   core, facing the junction;
 * - `interval`: every `spacing` metres along the roads in the core, on the
 *   traffic side, facing the road (street lights).
 *
 * A prop stands half a metre beyond the road's edge (half width + margin) and
 * never on any road, building footprint, pad or the ground in front of an
 * entrance, nor in water or a protected area. A blocked spot tries a few
 * metres along the road, then the other side, before it counts as blocked.
 * Its level is the road's centre-line height there (the spline's own data),
 * so baking the pads never moves it.
 *
 * Only roads a spline realises are anchors; every road line is an obstacle.
 * Pure and deterministic. Dependency-free.
 */
import type { LayoutPlacement } from "../scene/layout";
import { SHAPE_PRIMITIVE_SIZE } from "../scene/shapes";
import { sourceDistance, type DistanceSource } from "./field";
import type { StreetLine } from "./masks";
import type { WorldPoint } from "./normalize";
import { polygonsOverlap } from "./parcels";
import type { FurniturePlacement, StreetFurnitureRule, TrafficSide } from "./regionProfile";
import type { RoadClass } from "./vocabulary";

/** Gap between a road's edge and a prop, metres. */
export const FURNITURE_MARGIN = 0.5;
/** A prop corner may come no nearer than this to any road's edge, metres. */
const ROAD_GAP = 0.25;
/** Clear ground kept between two props, metres. */
const PROP_GAP = 0.5;
/** An endpoint this far beyond another road's edge still joins it, metres. */
const JOIN_TOLERANCE = 1.5;
/** Junctions nearer than this are one, metres. */
const JUNCTION_MERGE = 6;
/** Width of the clear ground in front of a building's entrance, metres. */
export const ENTRANCE_WIDTH = 3;
/** Longest clear ground kept in front of an entrance, metres. */
const ENTRANCE_REACH = 20;
/** Shifts along the road tried when a spot is blocked, metres. */
const GATE_SHIFTS = [0, -2, -4, 2];
const INTERVAL_SHIFTS = [0, 2, -2, 4, -4];
/** Arm direction is measured this far along the road, metres. */
const ARM_PROBE = 5;

export type FurnitureBlock = "road" | "building" | "pad" | "entrance" | "furniture" | "water" | "protected" | "offTerrain";

/** A road line with its class resolved (`roadClass` absent: not an anchor for any rule). */
export type FurnitureLine = StreetLine;

/** XZ outlines furniture must keep off. */
export interface FurnitureObstacles {
  buildings: ReadonlyArray<readonly WorldPoint[]>;
  pads: ReadonlyArray<readonly WorldPoint[]>;
  entrances: ReadonlyArray<readonly WorldPoint[]>;
}

export interface FurnitureRequest {
  rules: readonly StreetFurnitureRule[];
  /** Every road near the settlement: obstacles; those with `heights` and a class are anchors. */
  lines: readonly FurnitureLine[];
  center: WorldPoint;
  coreRadius: number;
  /** The plan's gate nodes of this settlement; none means the core-edge crossings. */
  gateNodes: readonly WorldPoint[];
  trafficSide: TrafficSide;
  obstacles: FurnitureObstacles;
  /** Water or protected ground at a point, else null. */
  blockedAt: (point: WorldPoint) => "water" | "protected" | null;
  sampleHeight: (x: number, z: number) => number | null;
}

export interface PlannedProp {
  /** Index into `rules`. */
  rule: number;
  center: WorldPoint;
  /** Yaw in degrees of the prop's local +Z (its face). */
  yawDeg: number;
  /** Road centre-line height the prop stands at, metres. */
  base: number;
  /** XZ footprint, for later obstacle tests. */
  footprint: WorldPoint[];
}

export interface RuleOutcome {
  placed: number;
  /** Spots the rule asked for. */
  spots: number;
  /** Spots that found no free ground, by the first reason at the preferred position. */
  blocked: Partial<Record<FurnitureBlock, number>>;
}

export interface FurnitureResult {
  props: PlannedProp[];
  /** Per rule, in rule order. */
  outcomes: RuleOutcome[];
}

/** One candidate position and orientation, before the obstacle test. */
interface Spot {
  center: WorldPoint;
  /** Unit direction of the prop's local +Z. */
  face: WorldPoint;
  base: number;
}

/** Rules run gates first (signs win a contested spot), then junctions, then intervals. */
const KIND_ORDER: Record<FurniturePlacement, number> = { gate: 0, junction: 1, interval: 2 };

export function planFurniture(request: FurnitureRequest): FurnitureResult {
  const props: PlannedProp[] = [];
  const outcomes: RuleOutcome[] = request.rules.map(() => ({ placed: 0, spots: 0, blocked: {} }));
  const roads: DistanceSource[] = request.lines.map((line) => ({ kind: "polyline", points: line.points, radii: line.halfWidths }));
  const anchors = request.lines.filter((line) => line.heights !== undefined && line.roadClass !== undefined && line.points.length >= 2);
  const inCore = (point: WorldPoint) => distance(point, request.center) <= request.coreRadius;
  let junctions: Junction[] | null = null;

  const order = request.rules.map((_, index) => index)
    .sort((a, b) => KIND_ORDER[request.rules[a]!.placement] - KIND_ORDER[request.rules[b]!.placement] || a - b);
  for (const index of order) {
    const rule = request.rules[index]!;
    const outcome = outcomes[index]!;
    const classes = new Set<RoadClass>(rule.roadClasses);
    const lines = anchors.filter((line) => classes.has(line.roadClass!));
    const [width, , depth] = rule.size;
    // Each spot is a list of alternatives; the first free one wins.
    const spots: Spot[][] = [];
    if (rule.placement === "gate") {
      for (const gate of entrances(lines, request.center, request.coreRadius, request.gateNodes)) {
        const alternatives: Spot[] = [];
        for (const side of [sideSign(request.trafficSide), -sideSign(request.trafficSide)]) {
          for (const shift of GATE_SHIFTS) {
            const at = pointAt(gate.line, gate.s + shift * gate.direction);
            const inward = scale(at.tangent, gate.direction);
            const lateral = scale(rightOf(inward), side);
            const offset = at.halfWidth + FURNITURE_MARGIN + width / 2;
            alternatives.push({ center: add(at.point, scale(lateral, offset)), face: scale(inward, -1), base: at.height });
          }
        }
        spots.push(alternatives);
      }
    } else if (rule.placement === "junction") {
      junctions ??= findJunctions(request.lines);
      for (const junction of junctions) {
        if (!inCore(junction.center) || !junction.arms.some((arm) => arm.roadClass !== undefined && classes.has(arm.roadClass))) continue;
        const radius = Math.max(width, depth) / 2;
        spots.push(junctionGaps(junction).map((gap) => {
          const clearance = gap.halfWidth + FURNITURE_MARGIN + radius;
          const reach = clearance / Math.sin(Math.min(gap.angle / 2, Math.PI / 2));
          return { center: add(junction.center, scale(gap.bisector, reach)), face: scale(gap.bisector, -1), base: junction.height };
        }));
      }
    } else {
      const spacing = rule.spacing ?? 30;
      for (const line of lines) {
        const length = polylineLength(line.points);
        for (let s = spacing / 2; s < length; s += spacing) {
          if (!inCore(pointAt(line, s).point)) continue;
          const alternatives: Spot[] = [];
          for (const side of [sideSign(request.trafficSide), -sideSign(request.trafficSide)]) {
            for (const shift of side === sideSign(request.trafficSide) ? INTERVAL_SHIFTS : [0]) {
              if (Math.abs(shift) >= spacing / 3) continue;
              const at = pointAt(line, s + shift);
              if (!inCore(at.point)) continue;
              const lateral = scale(rightOf(at.tangent), side);
              const offset = at.halfWidth + FURNITURE_MARGIN + depth / 2;
              alternatives.push({ center: add(at.point, scale(lateral, offset)), face: scale(lateral, -1), base: at.height });
            }
          }
          if (alternatives.length > 0) spots.push(alternatives);
        }
      }
    }

    outcome.spots = spots.length;
    for (const alternatives of spots) {
      let first: FurnitureBlock | null = null;
      let chosen: { spot: Spot; footprint: WorldPoint[] } | null = null;
      for (const spot of alternatives) {
        const footprint = rectangle(spot.center, spot.face, width / 2, depth / 2);
        const reason = blockReason(request, roads, props, spot.center, footprint);
        if (reason === null) {
          chosen = { spot, footprint };
          break;
        }
        first ??= reason;
      }
      if (!chosen) {
        const reason = first ?? "road";
        outcome.blocked[reason] = (outcome.blocked[reason] ?? 0) + 1;
        continue;
      }
      props.push({
        rule: index,
        center: chosen.spot.center,
        yawDeg: (Math.atan2(chosen.spot.face[0], chosen.spot.face[1]) * 180) / Math.PI,
        base: chosen.spot.base,
        footprint: chosen.footprint,
      });
      outcome.placed += 1;
    }
  }
  return { props, outcomes };
}

/**
 * The ground kept clear in front of a building: `ENTRANCE_WIDTH` wide, from its
 * front face out to just past the nearest road's edge (at most
 * `ENTRANCE_REACH`). `face` is the unit direction of the entrance (+Z).
 */
export function entranceZone(
  front: WorldPoint, face: WorldPoint, lines: readonly FurnitureLine[],
): WorldPoint[] {
  const roads: DistanceSource[] = lines.map((line) => ({ kind: "polyline", points: line.points, radii: line.halfWidths }));
  const toRoad = roads.reduce((best, road) => Math.min(best, sourceDistance(front, road)), Infinity);
  const reach = Math.min(ENTRANCE_REACH, toRoad + FURNITURE_MARGIN);
  const center = add(front, scale(face, reach / 2));
  return rectangle(center, face, ENTRANCE_WIDTH / 2, reach / 2);
}

/** Corners of a box centred at `center` whose local +Z is `face`; `halfX` across it, `halfZ` along it. */
export function rectangle(center: WorldPoint, face: WorldPoint, halfX: number, halfZ: number): WorldPoint[] {
  const across: WorldPoint = [face[1], -face[0]];
  const at = (a: number, b: number): WorldPoint => [
    center[0] + across[0] * a + face[0] * b,
    center[1] + across[1] * a + face[1] * b,
  ];
  return [at(-halfX, -halfZ), at(halfX, -halfZ), at(halfX, halfZ), at(-halfX, halfZ)];
}

/**
 * XZ footprint and facing (+Z) of a box placement: its scaled `shape:cube`
 * extent, or `size` ([width, height, depth]) for a model without a scale.
 */
export function placementFootprint(
  placement: LayoutPlacement, size?: readonly [number, number, number],
): { center: WorldPoint; face: WorldPoint; footprint: WorldPoint[]; halfDepth: number } {
  const yaw = ((placement.rotation?.[1] ?? placement.rotationYDeg ?? 0) * Math.PI) / 180;
  const face: WorldPoint = [Math.sin(yaw), Math.cos(yaw)];
  const scale = placement.scale === undefined ? null : typeof placement.scale === "number" ? [placement.scale, placement.scale, placement.scale] : placement.scale;
  const halfWidth = scale ? (scale[0]! * SHAPE_PRIMITIVE_SIZE) / 2 : (size?.[0] ?? 1) / 2;
  const halfDepth = scale ? (scale[2]! * SHAPE_PRIMITIVE_SIZE) / 2 : (size?.[2] ?? 1) / 2;
  const center: WorldPoint = [placement.position[0], placement.position[2]];
  return { center, face, footprint: rectangle(center, face, halfWidth, halfDepth), halfDepth };
}

// ---------------------------------------------------------------- obstacles

function blockReason(
  request: FurnitureRequest,
  roads: readonly DistanceSource[],
  props: readonly PlannedProp[],
  center: WorldPoint,
  footprint: WorldPoint[],
): FurnitureBlock | null {
  const points = [center, ...footprint];
  if (roads.some((road) => points.some((point) => sourceDistance(point, road) < ROAD_GAP))) return "road";
  for (const point of points) {
    const reason = request.blockedAt(point);
    if (reason) return reason;
  }
  const { obstacles } = request;
  if (obstacles.buildings.some((outline) => polygonsOverlap(footprint, outline))) return "building";
  if (obstacles.pads.some((outline) => polygonsOverlap(footprint, outline))) return "pad";
  if (obstacles.entrances.some((outline) => polygonsOverlap(footprint, outline))) return "entrance";
  const padded = grow(footprint, center, PROP_GAP);
  if (props.some((prop) => polygonsOverlap(padded, prop.footprint))) return "furniture";
  if (request.sampleHeight(center[0], center[1]) === null) return "offTerrain";
  return null;
}

/** The polygon pushed `by` metres outwards from `center` along each corner's diagonal (enough for a gap test). */
function grow(polygon: readonly WorldPoint[], center: WorldPoint, by: number): WorldPoint[] {
  return polygon.map((point) => {
    const away = sub(point, center);
    const length = Math.hypot(away[0], away[1]) || 1;
    return add(point, scale(away, (by * Math.SQRT2) / length));
  });
}

// ---------------------------------------------------------------- entrances

interface Entrance {
  line: FurnitureLine;
  /** Arc length of the entrance on the line. */
  s: number;
  /** +1 when the line runs into the core from here, −1 when it runs out. */
  direction: 1 | -1;
}

/**
 * Where the anchor roads enter the settlement: at each gate node (its nearest
 * point on a road, the road's inward direction towards the centre), or
 * without gate nodes wherever a road crosses the core's edge.
 */
function entrances(
  lines: readonly FurnitureLine[], center: WorldPoint, coreRadius: number, gateNodes: readonly WorldPoint[],
): Entrance[] {
  const found: Entrance[] = [];
  if (gateNodes.length > 0) {
    for (const node of gateNodes) {
      let best: { line: FurnitureLine; s: number; distance: number } | null = null;
      for (const line of lines) {
        const hit = project(line, node);
        if (!best || hit.distance < best.distance) best = { line, s: hit.s, distance: hit.distance };
      }
      if (!best || best.distance > coreRadius) continue;
      const ahead = pointAt(best.line, best.s + ARM_PROBE).point;
      const behind = pointAt(best.line, best.s - ARM_PROBE).point;
      found.push({ line: best.line, s: best.s, direction: distance(ahead, center) <= distance(behind, center) ? 1 : -1 });
    }
    return found;
  }
  for (const line of lines) {
    let s = 0;
    for (let leg = 1; leg < line.points.length; leg += 1) {
      const a = line.points[leg - 1]!;
      const b = line.points[leg]!;
      const span = distance(a, b);
      for (const t of circleCrossings(a, b, center, coreRadius)) {
        // Entering where the distance to the centre falls along the line.
        const d = sub(b, a);
        const radial = sub(add(a, scale(d, t)), center);
        found.push({ line, s: s + span * t, direction: radial[0] * d[0] + radial[1] * d[1] < 0 ? 1 : -1 });
      }
      s += span;
    }
  }
  return found;
}

/** Parameters in [0, 1) where segment a→b crosses the circle. */
function circleCrossings(a: WorldPoint, b: WorldPoint, center: WorldPoint, radius: number): number[] {
  const d = sub(b, a);
  const f = sub(a, center);
  const qa = d[0] * d[0] + d[1] * d[1];
  if (qa === 0) return [];
  const qb = 2 * (f[0] * d[0] + f[1] * d[1]);
  const qc = f[0] * f[0] + f[1] * f[1] - radius * radius;
  const disc = qb * qb - 4 * qa * qc;
  if (disc <= 0) return [];
  const root = Math.sqrt(disc);
  return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].filter((t) => t >= 0 && t < 1);
}

// ---------------------------------------------------------------- junctions

interface Arm {
  /** Unit direction away from the junction. */
  direction: WorldPoint;
  halfWidth: number;
  roadClass?: RoadClass;
}

interface Junction {
  center: WorldPoint;
  height: number;
  arms: Arm[];
}

/**
 * Junctions of the road lines: a road ending on another road's side (a T, as
 * the roads and streets stages build them), and three or more road ends
 * meeting at a node. Two ends meeting are one road running on.
 */
function findJunctions(lines: readonly FurnitureLine[]): Junction[] {
  const junctions: Junction[] = [];
  const ends: Array<{ line: FurnitureLine; end: 0 | 1; point: WorldPoint }> = [];
  for (const line of lines) {
    if (line.points.length < 2) continue;
    ends.push({ line, end: 0, point: line.points[0]! }, { line, end: 1, point: line.points[line.points.length - 1]! });
  }
  const sideJoined = new Set<number>();
  ends.forEach((end, index) => {
    for (const other of lines) {
      if (other.id === end.line.id || other.points.length < 2) continue;
      const hit = project(other, end.point);
      const at = pointAt(other, hit.s);
      const length = polylineLength(other.points);
      const interior = Math.min(hit.s, length - hit.s) > at.halfWidth + JOIN_TOLERANCE;
      if (!interior || hit.distance > at.halfWidth + JOIN_TOLERANCE) continue;
      sideJoined.add(index);
      if (!other.heights) continue;
      junctions.push({
        center: at.point,
        height: at.height,
        arms: [
          { direction: at.tangent, halfWidth: at.halfWidth, ...classOf(other) },
          { direction: scale(at.tangent, -1), halfWidth: at.halfWidth, ...classOf(other) },
          armOf(end.line, end.end),
        ],
      });
      break;
    }
  });

  // Road ends meeting at a node.
  const group = ends.map((_, index) => index);
  const find = (index: number): number => (group[index] === index ? index : (group[index] = find(group[index]!)));
  for (let i = 0; i < ends.length; i += 1) {
    if (sideJoined.has(i)) continue;
    for (let j = i + 1; j < ends.length; j += 1) {
      if (sideJoined.has(j) || ends[i]!.line.id === ends[j]!.line.id) continue;
      const reach = Math.max(endHalfWidth(ends[i]!), endHalfWidth(ends[j]!)) + JOIN_TOLERANCE;
      if (distance(ends[i]!.point, ends[j]!.point) <= reach) group[find(j)] = find(i);
    }
  }
  const members = new Map<number, number[]>();
  ends.forEach((_, index) => {
    if (!sideJoined.has(index)) members.set(find(index), [...(members.get(find(index)) ?? []), index]);
  });
  for (const indices of members.values()) {
    if (indices.length < 3) continue;
    const meeting = indices.map((index) => ends[index]!);
    const withHeight = meeting.filter((end) => end.line.heights);
    if (withHeight.length === 0) continue;
    // Ends that coincide mark the node itself; a road stopped at another's edge sits a half width off.
    const pair = meeting.flatMap((a, i) => meeting.slice(i + 1).map((b) => [a, b] as const))
      .find(([a, b]) => distance(a.point, b.point) < 0.5);
    const center = pair ? mid(pair[0].point, pair[1].point) : mean(meeting.map((end) => end.point));
    const level = pair && pair[0].line.heights && pair[1].line.heights ? [pair[0], pair[1]] : withHeight;
    junctions.push({
      center,
      height: level.reduce((sum, end) => sum + endHeight(end), 0) / level.length,
      arms: meeting.map((end) => armOf(end.line, end.end)),
    });
  }

  const merged: Junction[] = [];
  for (const junction of junctions) {
    if (!merged.some((kept) => distance(kept.center, junction.center) < JUNCTION_MERGE)) merged.push(junction);
  }
  return merged;
}

/** Gaps between neighbouring arms, widest first, with the wider of their two half widths. */
function junctionGaps(junction: Junction): Array<{ bisector: WorldPoint; angle: number; halfWidth: number }> {
  const arms = junction.arms
    .map((arm) => ({ arm, angle: Math.atan2(arm.direction[1], arm.direction[0]) }))
    .sort((a, b) => a.angle - b.angle);
  const gaps = arms.map((entry, index) => {
    const next = arms[(index + 1) % arms.length]!;
    let angle = next.angle - entry.angle;
    if (index === arms.length - 1) angle += 2 * Math.PI;
    const middle = entry.angle + angle / 2;
    return {
      bisector: [Math.cos(middle), Math.sin(middle)] as WorldPoint,
      angle,
      halfWidth: Math.max(entry.arm.halfWidth, next.arm.halfWidth),
    };
  });
  return gaps.filter((gap) => gap.angle > 1e-6).sort((a, b) => b.angle - a.angle);
}

function armOf(line: FurnitureLine, end: 0 | 1): Arm {
  const length = polylineLength(line.points);
  const from = pointAt(line, end === 0 ? 0 : length);
  const toward = pointAt(line, end === 0 ? Math.min(length, ARM_PROBE) : Math.max(0, length - ARM_PROBE)).point;
  return { direction: unit(sub(toward, from.point)), halfWidth: from.halfWidth, ...classOf(line) };
}

function classOf(line: FurnitureLine): { roadClass?: RoadClass } {
  return line.roadClass === undefined ? {} : { roadClass: line.roadClass };
}

function endHalfWidth(end: { line: FurnitureLine; end: 0 | 1 }): number {
  return end.end === 0 ? end.line.halfWidths[0]! : end.line.halfWidths[end.line.halfWidths.length - 1]!;
}

function endHeight(end: { line: FurnitureLine; end: 0 | 1 }): number {
  const heights = end.line.heights!;
  return end.end === 0 ? heights[0]! : heights[heights.length - 1]!;
}

// ---------------------------------------------------------------- polylines

/** The line at arc length `s` (clamped): point, unit tangent, half width and centre height. */
function pointAt(line: FurnitureLine, s: number): { point: WorldPoint; tangent: WorldPoint; halfWidth: number; height: number } {
  const { points } = line;
  let remaining = Math.max(0, s);
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const span = distance(a, b);
    if (remaining <= span || index === points.length - 1) {
      const t = span === 0 ? 0 : Math.min(1, remaining / span);
      const lerp = (values: readonly number[] | undefined) =>
        values ? values[index - 1]! + (values[index]! - values[index - 1]!) * t : 0;
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        tangent: unit(sub(b, a)),
        halfWidth: lerp(line.halfWidths),
        height: lerp(line.heights),
      };
    }
    remaining -= span;
  }
  return { point: points[0]!, tangent: [1, 0], halfWidth: line.halfWidths[0] ?? 0, height: line.heights?.[0] ?? 0 };
}

/** Nearest point of the centre line: its arc length and distance. */
function project(line: FurnitureLine, point: WorldPoint): { s: number; distance: number } {
  let best = { s: 0, distance: Infinity };
  let s = 0;
  for (let index = 1; index < line.points.length; index += 1) {
    const a = line.points[index - 1]!;
    const b = line.points[index]!;
    const d = sub(b, a);
    const lengthSq = d[0] * d[0] + d[1] * d[1];
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * d[0] + (point[1] - a[1]) * d[1]) / lengthSq));
    const gap = distance(point, [a[0] + d[0] * t, a[1] + d[1] * t]);
    if (gap < best.distance) best = { s: s + Math.sqrt(lengthSq) * t, distance: gap };
    s += Math.sqrt(lengthSq);
  }
  return best;
}

/** +1 puts a prop right of the direction of travel. */
function sideSign(side: TrafficSide): 1 | -1 {
  return side === "right" ? 1 : -1;
}

/** Right of a direction of travel on the XZ plane, seen from above with +Y up. */
function rightOf(direction: WorldPoint): WorldPoint {
  return [-direction[1], direction[0]];
}

function polylineLength(points: readonly WorldPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1]!, points[index]!);
  return length;
}

function add(a: WorldPoint, b: WorldPoint): WorldPoint {
  return [a[0] + b[0], a[1] + b[1]];
}

function sub(a: WorldPoint, b: WorldPoint): WorldPoint {
  return [a[0] - b[0], a[1] - b[1]];
}

function scale(a: WorldPoint, by: number): WorldPoint {
  return [a[0] * by, a[1] * by];
}

function unit(a: WorldPoint): WorldPoint {
  const length = Math.hypot(a[0], a[1]);
  return length === 0 ? [1, 0] : [a[0] / length, a[1] / length];
}

function mid(a: WorldPoint, b: WorldPoint): WorldPoint {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function mean(points: readonly WorldPoint[]): WorldPoint {
  const sum = points.reduce<WorldPoint>((acc, point) => add(acc, point), [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
