/**
 * Land use, L5 (World Builder plan v0.4 §13.5, T39, WB-16).
 *
 * Gives a settlement's parcels their roles: the program lines first, in the
 * plan's order — civic and squares where centrality is highest, commerce along
 * the main street, industry/transport at the entrances or downstream by the
 * water, agriculture at the outer edge — then dwellings on what is left, from
 * the centre outwards, so density falls off towards the edge and the outermost
 * parcels stay vacant when there are more parcels than homes.
 *
 * Each pick is a seeded greedy choice: siting score, penalised by a negative
 * mean `landUseCompatibility` with already-assigned neighbours (parcels within
 * `NEIGHBOUR_GAP`) and nudged by a positive one. A neighbour at -1 forbids the
 * pick outright, so no two forbidden land uses ever touch.
 *
 * A role whose footprint does not fit one parcel takes a run of neighbouring
 * parcels along the same side of the same street (a school, a square): the
 * first parcel of the run is the host and holds the role, the others name it
 * in `partOf`. Polygons are never rewritten, so the parcel stage's output stays
 * intact and `mergedPolygon` rebuilds a lot's outline when it is needed.
 *
 * Lines it cannot place are reported with the reason. Pure and deterministic;
 * dependency-free.
 */
import { coreSpans, inCore, pointAlong, type CoreShape } from "./core";
import { sourceDistance, type DistanceSource } from "./field";
import type { StreetLine } from "./masks";
import type { WorldPoint } from "./normalize";
import { mulberry32, parcelBox, polygonCentroid } from "./parcels";
import type { GeneratedParcel, ProgramLine } from "./recipe";
import { landUseCompatibility, type RegionProfile } from "./regionProfile";
import { LAND_USES, type LandUse, type ProgramSiting, ROAD_CLASSES, type RoadClass } from "./vocabulary";

/** Parcels whose outlines come this close are neighbours, metres. */
export const NEIGHBOUR_GAP = 2;
/** Compatibility at or below this forbids two land uses from touching. */
export const FORBIDDEN_COMPATIBILITY = -1;
/** Most parcels one role may take. */
export const MAX_MERGE = 4;
/** Role for dwellings when the region profile names no residential role. */
export const DEFAULT_DWELLING_ROLE = "building.residential.dwelling";

/** Weight of a negative mean neighbour compatibility (a penalty) against the 0..1 siting score. */
const COMPATIBILITY_WEIGHT = 0.5;
/**
 * Share of that weight a positive mean gets: a preference nudges, it must not
 * outweigh siting, or every land use would grow along its first strip instead
 * of from where it is sited (dwellings from the centre out).
 */
const PREFERENCE_SHARE = 0.2;
/** Seeded tie-break; small enough to only reorder near-equal picks. */
const JITTER = 0.01;
/** Clearance beside a footprint on its parcel, metres. */
const SIDE_CLEARANCE = 2;
/** Parcels as short as this fraction of the land use's frontage still count (the strip's last cut). */
const FRONTAGE_TOLERANCE = 0.75;
/** Strip vertices closer than this are the same point, metres. */
const JOIN_TOLERANCE = 0.01;
/** Arc-length step for finding where streets cross the core edge, metres. */
const ENTRANCE_STEP = 2;

/** Assignment phases, in the plan's order (§13.5 L5). */
const PHASE: Record<LandUse, number> = {
  civic: 0, open: 0, commercial: 1, industrial: 2, transport: 2, agricultural: 3, residential: 4,
};

/** Land use of a role nobody describes and whose id names none, from where it wants to stand. */
const SITING_LAND_USE: Record<ProgramSiting, LandUse> = {
  center: "civic", mainRoad: "commercial", entrance: "industrial", downstream: "industrial", edge: "agricultural", any: "commercial",
};

export type UnmetReason = "noParcel" | "tooSmall" | "forbidden";

export interface LandUseRequest {
  center: WorldPoint;
  coreRadius: number;
  /** The settlement's parcels as the parcel stage wrote them (no roles); steep ones carry `landUse: "open"`. */
  parcels: readonly GeneratedParcel[];
  dwellings: number;
  program: readonly ProgramLine[];
  profile: RegionProfile | null;
  /** Road class of a plan edge. */
  edgeClass: (edge: string) => RoadClass | undefined;
  /** Where streets cross the core edge (`coreEntrances`). */
  entrances: readonly WorldPoint[];
  water: readonly DistanceSource[];
  /** Level of a parcel at its centre, for ranking low ground (the stage reads its street's level). */
  sampleHeight: (x: number, z: number) => number | null;
  seed: number;
}

export interface LandUseAssignment {
  role: string;
  landUse: LandUse;
  /** Host first, then the parcels merged into it, in street order. */
  parcels: string[];
}

export interface UnmetLine {
  role: string;
  count: number;
  missing: number;
  reason: UnmetReason;
}

export interface LandUseResult {
  /** The input parcels in order, with `landUse` / `role` / `partOf`. */
  parcels: GeneratedParcel[];
  assignments: LandUseAssignment[];
  unmet: UnmetLine[];
  /** Buildable parcels nothing was given. */
  vacant: number;
  /** Neighbouring parcel pairs of different lots with negative compatibility. */
  conflicts: number;
  /** The dwelling role used. */
  dwellingRole: string;
}

interface Lot {
  parcel: GeneratedParcel;
  centroid: WorldPoint;
  frontage: number;
  depth: number;
  /** Next parcel along the same side of the same street, sharing this one's end edge. */
  next: number | null;
  neighbours: number[];
  landUse: LandUse | null;
  host: number | null;
  sites: Record<ProgramSiting, number>;
  jitter: number;
}

interface Want {
  role: string;
  landUse: LandUse;
  count: number;
  siting: ProgramSiting;
  frontage: number;
  depth: number;
  order: number;
}

export function assignLandUse(request: LandUseRequest): LandUseResult {
  const { profile } = request;
  const random = mulberry32(request.seed);
  const lots = describeLots(request, random);
  const dwellingRole = residentialRole(profile);

  const wants: Want[] = request.program.map((line, order) => {
    const landUse = roleLandUse(line.role, line.siting, profile);
    return { role: line.role, landUse, count: line.count, siting: line.siting, ...requirement(line.role, landUse, profile), order };
  });
  if (request.dwellings > 0) {
    wants.push({
      role: dwellingRole, landUse: "residential", count: request.dwellings, siting: "center",
      ...requirement(dwellingRole, "residential", profile), order: wants.length,
    });
  }
  wants.sort((a, b) => PHASE[a.landUse] - PHASE[b.landUse] || a.order - b.order);

  const assignments: LandUseAssignment[] = [];
  const unmet: UnmetLine[] = [];
  for (const want of wants) {
    for (let placed = 0; placed < want.count; placed += 1) {
      const pick = bestRun(lots, want, profile);
      if (Array.isArray(pick)) {
        pick.forEach((index) => {
          lots[index]!.landUse = want.landUse;
          lots[index]!.host = pick[0]!;
        });
        assignments.push({ role: want.role, landUse: want.landUse, parcels: pick.map((index) => lots[index]!.parcel.id) });
      } else {
        unmet.push({ role: want.role, count: want.count, missing: want.count - placed, reason: pick });
        break;
      }
    }
  }

  const roleOf = new Map(assignments.map((entry) => [entry.parcels[0]!, entry.role]));
  const parcels = lots.map(({ parcel, landUse, host }, index): GeneratedParcel => {
    // Field order matches the recipe normalizer's, so a reloaded recipe compares equal to a re-run's.
    const result: GeneratedParcel = { id: parcel.id, settlement: parcel.settlement, polygon: parcel.polygon };
    if (parcel.frontage !== undefined) result.frontage = parcel.frontage;
    if (landUse !== null) result.landUse = landUse;
    if (host === index) result.role = roleOf.get(parcel.id)!;
    if (host !== null && host !== index) result.partOf = lots[host]!.parcel.id;
    if (parcel.placement !== undefined) result.placement = parcel.placement;
    return result;
  });
  return {
    parcels,
    assignments,
    unmet,
    vacant: lots.filter((lot) => lot.landUse === null).length,
    conflicts: countConflicts(lots, profile),
    dwellingRole,
  };
}

/** Strips what the land-use stage wrote, leaving the parcel as the parcel stage made it. */
export function landUseBase(parcel: GeneratedParcel): GeneratedParcel {
  const steep = parcel.landUse === "open" && parcel.role === undefined && parcel.partOf === undefined;
  const result: GeneratedParcel = { id: parcel.id, settlement: parcel.settlement, polygon: parcel.polygon };
  if (parcel.frontage !== undefined) result.frontage = parcel.frontage;
  if (steep) result.landUse = "open";
  if (parcel.placement !== undefined) result.placement = parcel.placement;
  return result;
}

/** The outline of a host and the parcels merged into it, given in street order; null when they are not one strip run. */
export function mergedPolygon(run: ReadonlyArray<{ polygon: readonly WorldPoint[] }>): WorldPoint[] | null {
  if (run.length === 1) return [...run[0]!.polygon];
  const strips = run.map((parcel) => stripEdges(parcel.polygon));
  if (strips.some((strip) => strip === null)) return null;
  const front: WorldPoint[] = [...strips[0]!.front];
  const back: WorldPoint[] = [...strips[0]!.back];
  for (let index = 1; index < strips.length; index += 1) {
    const strip = strips[index]!;
    if (!joins(strips[index - 1]!, strip)) return null;
    front.push(...strip.front.slice(1));
    back.push(...strip.back.slice(1));
  }
  return [...front, ...back.reverse()];
}

/** Points where the streets cross the core's edge: the settlement's entrances. */
export function coreEntrances(
  lines: readonly StreetLine[], center: WorldPoint, radius: number, outline?: readonly WorldPoint[],
): WorldPoint[] {
  const core: CoreShape = { center, radius, ...(outline ? { outline } : {}) };
  if (outline) return grownCoreEntrances(lines, core);
  const entrances: WorldPoint[] = [];
  for (const line of lines) {
    let previous: WorldPoint | null = null;
    for (let leg = 1; leg < line.points.length; leg += 1) {
      const a = line.points[leg - 1]!;
      const b = line.points[leg]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / ENTRANCE_STEP));
      for (let step = leg === 1 ? 0 : 1; step <= steps; step += 1) {
        const t = step / steps;
        const point: WorldPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (previous && inCore(core, previous) !== inCore(core, point)) {
          entrances.push([Number(((previous[0] + point[0]) / 2).toFixed(2)), Number(((previous[1] + point[1]) / 2).toFixed(2))]);
        }
        previous = point;
      }
    }
  }
  return entrances;
}

/** Where streets enter or leave a grown core for good, not each time its ragged edge crosses them. */
function grownCoreEntrances(lines: readonly StreetLine[], core: CoreShape): WorldPoint[] {
  const entrances: WorldPoint[] = [];
  for (const line of lines) {
    const total = line.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - line.points[index]![0], point[1] - line.points[index]![1]), 0);
    for (const [start, end] of coreSpans(core, line.points)) {
      for (const s of [start > 0 ? start : null, end < total ? end : null]) {
        if (s === null) continue;
        const [x, z] = pointAlong(line.points, s);
        entrances.push([Number(x.toFixed(2)), Number(z.toFixed(2))]);
      }
    }
  }
  return entrances;
}

/** Neighbouring parcel pairs whose land uses have negative compatibility, ignoring pairs within one lot. */
export function landUseConflicts(
  parcels: readonly GeneratedParcel[],
  profile: RegionProfile | null,
): Array<{ a: string; b: string; compatibility: number }> {
  if (!profile) return [];
  const lots = parcels.map((parcel) => ({ parcel, box: boxOf(parcel.polygon) }));
  const hostOf = (parcel: GeneratedParcel) => parcel.partOf ?? parcel.id;
  const pairs: Array<{ a: string; b: string; compatibility: number }> = [];
  for (let i = 0; i < lots.length; i += 1) {
    for (let j = i + 1; j < lots.length; j += 1) {
      const a = lots[i]!.parcel;
      const b = lots[j]!.parcel;
      if (!a.landUse || !b.landUse || hostOf(a) === hostOf(b)) continue;
      if (!touching(lots[i]!.box, lots[j]!.box) || polygonGap(a.polygon, b.polygon) > NEIGHBOUR_GAP) continue;
      const compatibility = landUseCompatibility(profile, a.landUse, b.landUse);
      if (compatibility < 0) pairs.push({ a: a.id, b: b.id, compatibility });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------- choosing

/** The best free run for one unit of `want`, or why there is none. */
function bestRun(lots: readonly Lot[], want: Want, profile: RegionProfile | null): number[] | UnmetReason {
  let best: number[] | null = null;
  let bestScore = -Infinity;
  let anyFree = false;
  let anyFits = false;
  for (let start = 0; start < lots.length; start += 1) {
    if (lots[start]!.landUse !== null) continue;
    anyFree = true;
    const run = [start];
    let frontage = lots[start]!.frontage;
    let depth = lots[start]!.depth;
    while (frontage < want.frontage && run.length < MAX_MERGE) {
      const next = lots[run[run.length - 1]!]!.next;
      if (next === null || lots[next]!.landUse !== null) break;
      run.push(next);
      frontage += lots[next]!.frontage;
      depth = Math.min(depth, lots[next]!.depth);
    }
    if (frontage < want.frontage || depth < want.depth) continue;
    anyFits = true;

    let compatibility = 0;
    let neighbours = 0;
    let forbidden = false;
    for (const index of run) {
      for (const other of lots[index]!.neighbours) {
        const landUse = lots[other]!.landUse;
        if (landUse === null || run.includes(other)) continue;
        const value = profile ? landUseCompatibility(profile, want.landUse, landUse) : want.landUse === landUse ? 1 : 0;
        if (value <= FORBIDDEN_COMPATIBILITY) forbidden = true;
        compatibility += value;
        neighbours += 1;
      }
    }
    if (forbidden) continue;
    const siting = run.reduce((sum, index) => sum + lots[index]!.sites[want.siting], 0) / run.length;
    const mean = neighbours > 0 ? compatibility / neighbours : 0;
    const score = siting + COMPATIBILITY_WEIGHT * (mean < 0 ? mean : mean * PREFERENCE_SHARE) + lots[start]!.jitter;
    if (score > bestScore) {
      bestScore = score;
      best = run;
    }
  }
  if (best) return best;
  return !anyFree ? "noParcel" : !anyFits ? "tooSmall" : "forbidden";
}

function describeLots(request: LandUseRequest, random: () => number): Lot[] {
  const { center, coreRadius } = request;
  const strips = request.parcels.map((parcel) => stripEdges(parcel.polygon));
  const boxes = request.parcels.map((parcel) => boxOf(parcel.polygon));
  const rank = (edge: string | undefined): number => {
    const roadClass = edge === undefined ? undefined : request.edgeClass(edge);
    return roadClass === undefined ? ROAD_CLASSES.length : ROAD_CLASSES.indexOf(roadClass);
  };
  const mainRank = Math.min(ROAD_CLASSES.length - 1, ...request.parcels.map((parcel) => rank(parcel.frontage)));
  const heights = request.parcels.map((parcel) => {
    const [x, z] = polygonCentroid(parcel.polygon);
    return request.sampleHeight(x, z);
  });
  const known = heights.filter((height): height is number => height !== null);
  const low = known.length > 0 ? Math.min(...known) : 0;
  const high = known.length > 0 ? Math.max(...known) : 0;

  return request.parcels.map((parcel, index): Lot => {
    const centroid = polygonCentroid(parcel.polygon);
    const strip = strips[index];
    const box = strip ? null : parcelBox(parcel.polygon);
    const outward = Math.min(1, Math.hypot(centroid[0] - center[0], centroid[1] - center[1]) / coreRadius);
    const nearest = (points: readonly WorldPoint[]) =>
      points.reduce((min, point) => Math.min(min, Math.hypot(point[0] - centroid[0], point[1] - centroid[1])), Infinity);
    const entrance = request.entrances.length > 0 ? 1 - Math.min(1, nearest(request.entrances) / coreRadius) : outward;
    const height = heights[index] ?? null;
    const lowness = height === null || high === low ? 0.5 : (high - height) / (high - low);
    const water = request.water.reduce((min, source) => Math.min(min, sourceDistance(centroid, source)), Infinity);
    const downstream = Number.isFinite(water)
      ? 0.6 * (1 - Math.min(1, water / coreRadius)) + 0.4 * lowness
      : 0.5 * lowness + 0.5 * entrance;
    const neighbours: number[] = [];
    request.parcels.forEach((other, j) => {
      if (j !== index && touching(boxes[index]!, boxes[j]!) && polygonGap(parcel.polygon, other.polygon) <= NEIGHBOUR_GAP) neighbours.push(j);
    });
    const next = strip ? strips.findIndex((other, j) => j !== index && other !== null && joins(strip, other)) : -1;
    return {
      parcel,
      centroid,
      frontage: strip ? polylineLength(strip.front) : box!.length,
      depth: strip ? Math.min(distance(strip.front[0]!, strip.back[0]!), distance(strip.front.at(-1)!, strip.back.at(-1)!)) : box!.width,
      next: next >= 0 ? next : null,
      neighbours,
      // Steep parcels are open land already (L4); everything else is free.
      landUse: parcel.landUse ?? null,
      host: null,
      sites: {
        center: 1 - outward,
        mainRoad: (rank(parcel.frontage) === mainRank ? 0.6 : 0) + 0.4 * (1 - outward),
        entrance,
        downstream,
        edge: outward,
        any: 0.5,
      },
      jitter: random() * JITTER,
    };
  });
}

function residentialRole(profile: RegionProfile | null): string {
  if (!profile) return DEFAULT_DWELLING_ROLE;
  return Object.keys(profile.roles).find((role) => profile.roles[role]!.landUse === "residential") ?? DEFAULT_DWELLING_ROLE;
}

/** The role's land use: its profile spec, else a land-use word in its id, else its siting's. */
export function roleLandUse(role: string, siting: ProgramSiting, profile: RegionProfile | null): LandUse {
  const spec = profile?.roles[role];
  if (spec) return spec.landUse;
  const named = role.split(".").find((part): part is LandUse => (LAND_USES as readonly string[]).includes(part));
  return named ?? SITING_LAND_USE[siting];
}

/** Smallest frontage and depth a parcel (or merged run) needs for the role, metres. */
function requirement(role: string, landUse: LandUse, profile: RegionProfile | null): { frontage: number; depth: number } {
  const footprint = profile?.roles[role]?.footprint;
  const parcel = profile?.parcels[landUse];
  return {
    frontage: Math.max(footprint ? footprint.width[0] + 2 * SIDE_CLEARANCE : 0, parcel ? parcel.frontage[0] * FRONTAGE_TOLERANCE : 0),
    depth: (footprint?.depth[0] ?? 0) + (parcel?.setback ?? 0),
  };
}

function countConflicts(lots: readonly Lot[], profile: RegionProfile | null): number {
  if (!profile) return 0;
  let conflicts = 0;
  lots.forEach((lot, index) => {
    for (const other of lot.neighbours) {
      const neighbour = lots[other]!;
      if (other < index || lot.landUse === null || neighbour.landUse === null) continue;
      if (lot.host !== null && lot.host === neighbour.host) continue;
      if (landUseCompatibility(profile, lot.landUse, neighbour.landUse) < 0) conflicts += 1;
    }
  });
  return conflicts;
}

// ---------------------------------------------------------------- geometry

interface Strip {
  /** Street-side edge, in street order. */
  front: WorldPoint[];
  /** Back edge, in street order. */
  back: WorldPoint[];
}

/** A parcel-stage polygon is its front edge then its back edge reversed; null for any other shape. */
function stripEdges(polygon: readonly WorldPoint[]): Strip | null {
  if (polygon.length < 4 || polygon.length % 2 !== 0) return null;
  const half = polygon.length / 2;
  return { front: polygon.slice(0, half), back: polygon.slice(half).reverse() };
}

/** `b` continues `a` along the street: it starts on `a`'s end edge. */
function joins(a: Strip, b: Strip): boolean {
  return distance(a.front.at(-1)!, b.front[0]!) <= JOIN_TOLERANCE && distance(a.back.at(-1)!, b.back[0]!) <= JOIN_TOLERANCE;
}

type Box = [number, number, number, number];

function boxOf(polygon: readonly WorldPoint[]): Box {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return [minX, minZ, maxX, maxZ];
}

/** Boxes within `NEIGHBOUR_GAP` of each other. */
function touching(a: Box, b: Box): boolean {
  return a[0] - NEIGHBOUR_GAP <= b[2] && b[0] - NEIGHBOUR_GAP <= a[2] && a[1] - NEIGHBOUR_GAP <= b[3] && b[1] - NEIGHBOUR_GAP <= a[3];
}

/** Shortest distance between two outlines' edges (0 where they meet). */
function polygonGap(a: readonly WorldPoint[], b: readonly WorldPoint[]): number {
  let gap = Infinity;
  const edges = (from: readonly WorldPoint[], to: readonly WorldPoint[]) => {
    for (const point of from) {
      for (let index = 0; index < to.length; index += 1) {
        gap = Math.min(gap, segmentDistance(point, to[index]!, to[(index + 1) % to.length]!));
      }
    }
  };
  edges(a, b);
  edges(b, a);
  return gap;
}

function segmentDistance(point: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = dx * dx + dz * dz;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length));
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t));
}

function polylineLength(points: readonly WorldPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1]!, points[index]!);
  return length;
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

