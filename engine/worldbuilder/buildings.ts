/**
 * Building placeholders and pads, L6 (World Builder plan v0.4 §13.4, §13.5;
 * T40 placeholder, T21 pad data).
 *
 * One box per role-holding lot (a host parcel and the parcels merged into it):
 *
 * - footprint: the lot's frontage less side clearance and its depth less the
 *   land use's setback and a rear clearance, fitted into the role's footprint
 *   range (seeded inside it); a lot too small squeezes it and says so;
 * - placed `setback` behind the lot's front edge, centred on the front, with
 *   its entrance (local +Z) facing the street;
 * - height: storeys (seeded in the role's range) × storey height; an open role
 *   (`storeys [0, 0]`, a square) is a thin slab;
 * - colour: the role's `placeholderColor`, else its land use's colour.
 *
 * Each building gets a pad: the footprint plus a margin (towards the street no
 * more than the setback, so a pad never reaches the road), levelled at the
 * mean ground height under the footprint (its quarter points; cut and fill
 * balance on a plane). The
 * pad is data; the editor's Apply Pads bakes it (decision 19). The box stands
 * `FOUNDATION` below the pad level, not on the ground: after the bake its
 * corners are at the pad level, and a box measured from the ground would move,
 * so the stage would no longer be up to date with its own pads. Before the
 * bake a box on a slope shows a gap of up to its grading on the low side.
 *
 * Pure and deterministic. Dependency-free.
 */
import { mergedPolygon } from "./landUse";
import type { WorldPoint } from "./normalize";
import type { BuildingRoleSpec, ParcelSpec } from "./regionProfile";
import type { LandUse } from "./vocabulary";

/** Placeholder colour per land use (§13.4 table); a fork's profile overrides per role. */
export const LAND_USE_COLORS: Record<LandUse, string> = {
  residential: "#f2b880",
  commercial: "#3f7fd6",
  civic: "#8e5cc8",
  industrial: "#8a8f96",
  agricultural: "#e6c83c",
  open: "#9fd67f",
  transport: "#4a4f57",
};

/** Clear ground beside the footprint on each side of the lot, metres. */
export const SIDE_CLEARANCE = 2;
/** Clear ground behind the footprint, metres. */
export const REAR_CLEARANCE = 2;
/** Pad extends this far beyond the footprint, metres. */
export const PAD_MARGIN = 1.5;
/** Pad blends into the terrain over this distance beyond its margin, metres. */
export const PAD_FALLOFF = 4;
/** The box reaches this far below its pad level, metres. */
export const FOUNDATION = 0.5;
/** Thickness of an open role's slab, metres. */
export const SLAB_HEIGHT = 0.2;
/** Footprint when the profile does not describe the role, metres. */
const DEFAULT_FOOTPRINT = { width: [8, 12] as [number, number], depth: [8, 11] as [number, number] };

export interface BuildingRequest {
  /** The lot: host first, then the parcels merged into it, in street order. */
  lot: ReadonlyArray<{ polygon: readonly WorldPoint[] }>;
  landUse: LandUse;
  spec: BuildingRoleSpec | undefined;
  parcel: ParcelSpec | undefined;
  random: () => number;
  sampleHeight: (x: number, z: number) => number | null;
}

export interface PlannedBuilding {
  center: WorldPoint;
  /** Yaw in degrees: local +Z (the entrance) faces the street. */
  yawDeg: number;
  width: number;
  depth: number;
  /** Height above the pad, metres (slab thickness for open roles). */
  height: number;
  storeys: number;
  /** Bottom of the box: `FOUNDATION` below the pad. */
  base: number;
  color: string;
  pad: { polygon: WorldPoint[]; height: number };
  /** Largest height the pad cuts or fills at a footprint corner, metres. */
  grading: number;
  /** The lot is smaller than the role's smallest footprint. */
  squeezed: boolean;
}

export function planBuilding(request: BuildingRequest): PlannedBuilding | null {
  const outline = mergedPolygon(request.lot) ?? [...request.lot[0]!.polygon];
  if (outline.length < 4 || outline.length % 2 !== 0) return null;
  const half = outline.length / 2;
  const front = outline.slice(0, half);
  const back = outline.slice(half).reverse();
  const frontage = polylineLength(front);
  const mid = alongAt(front, frontage / 2);
  const backMid = alongAt(back, polylineLength(back) / 2);
  // Inward: across the street-side tangent, towards the back edge.
  let inward: WorldPoint = [-mid.tangent[1], mid.tangent[0]];
  if (dot(inward, [backMid.point[0] - mid.point[0], backMid.point[1] - mid.point[1]]) < 0) inward = [-inward[0], -inward[1]];
  const lotDepth = Math.min(distance(front[0]!, back[0]!), distance(front[half - 1]!, back[half - 1]!));

  const footprint = request.spec?.footprint ?? DEFAULT_FOOTPRINT;
  const setback = request.parcel?.setback ?? 0;
  const roomWidth = frontage - 2 * SIDE_CLEARANCE;
  const roomDepth = lotDepth - setback - REAR_CLEARANCE;
  const width = fit(footprint.width, roomWidth, request.random);
  const depth = fit(footprint.depth, roomDepth, request.random);
  if (width <= 0 || depth <= 0) return null;
  const squeezed = roomWidth < footprint.width[0] || roomDepth < footprint.depth[0];

  const [low, high] = request.spec?.storeys ?? [1, 1];
  const storeys = low + Math.floor(request.random() * (high - low + 1));
  const height = storeys === 0 ? SLAB_HEIGHT : storeys * (request.spec?.storeyHeight ?? 3);

  const center: WorldPoint = [
    mid.point[0] + inward[0] * (setback + depth / 2),
    mid.point[1] + inward[1] * (setback + depth / 2),
  ];
  // The level comes from the footprint's quarter points, well inside the pad: after the bake they sit
  // exactly at its level (the corners may be on its edge, where the terrain grid blends into the falloff).
  const probes = rectangle(center, mid.tangent, inward, width / 4, depth / 4, depth / 4).map(([x, z]) => request.sampleHeight(x, z));
  const corners = rectangle(center, mid.tangent, inward, width / 2, depth / 2, depth / 2).map(([x, z]) => request.sampleHeight(x, z));
  if (probes.some((ground) => ground === null) || corners.some((ground) => ground === null)) return null;
  const padHeight = round((probes as number[]).reduce((sum, value) => sum + value, 0) / probes.length, 2);
  const grading = Math.max(...(corners as number[]).map((value) => Math.abs(value - padHeight)));

  // Entrance (+Z) faces the street, i.e. against `inward`.
  const yawDeg = (Math.atan2(-inward[0], -inward[1]) * 180) / Math.PI;
  const frontMargin = Math.min(PAD_MARGIN, setback);
  return {
    center,
    yawDeg,
    width,
    depth,
    height,
    storeys,
    base: round(padHeight - FOUNDATION, 2),
    color: request.spec?.placeholderColor ?? LAND_USE_COLORS[request.landUse],
    pad: {
      polygon: rectangle(center, mid.tangent, inward, width / 2 + PAD_MARGIN, depth / 2 + frontMargin, depth / 2 + PAD_MARGIN)
        .map(([x, z]) => [round(x, 3), round(z, 3)]),
      height: padHeight,
    },
    grading: round(grading, 2),
    squeezed,
  };
}

/** A size in `range`, seeded, no larger than `room`; `room` itself when the range does not fit. */
function fit(range: [number, number], room: number, random: () => number): number {
  const draw = range[0] + (range[1] - range[0]) * random();
  return round(Math.min(draw, room), 2);
}

/** Corners from front-left around `center`: `front` towards the street, `back` away from it. */
function rectangle(center: WorldPoint, along: WorldPoint, inward: WorldPoint, halfAlong: number, front: number, back: number): WorldPoint[] {
  const at = (a: number, b: number): WorldPoint => [
    center[0] + along[0] * a + inward[0] * b,
    center[1] + along[1] * a + inward[1] * b,
  ];
  return [at(-halfAlong, -front), at(halfAlong, -front), at(halfAlong, back), at(-halfAlong, back)];
}

function alongAt(points: readonly WorldPoint[], s: number): { point: WorldPoint; tangent: WorldPoint } {
  let remaining = s;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const span = distance(a, b);
    if (remaining <= span || index === points.length - 1) {
      const t = span === 0 ? 0 : Math.min(1, remaining / span);
      const length = span || 1;
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], tangent: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] };
    }
    remaining -= span;
  }
  return { point: points[0]!, tangent: [1, 0] };
}

function polylineLength(points: readonly WorldPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1]!, points[index]!);
  return length;
}

function dot(a: WorldPoint, b: WorldPoint): number {
  return a[0] * b[0] + a[1] * b[1];
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
