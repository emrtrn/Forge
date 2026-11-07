/**
 * Scene checks across stages (World Builder plan v0.4 track step 2e): what no
 * single stage sees because roads, streets and building pads come from
 * different stages. Found on the Derekavak greybox, where parcels drawn across
 * roads put buildings on the carriageway and roads reached yards metres below
 * them.
 *
 * - a road crosses a pad: its surface overlaps the pad beyond its last few
 *   metres (a road may end at a pad's edge: that is its entrance);
 * - an entrance meets its pad off level: a road ending at a pad's edge more
 *   than `ENTRANCE_STEP` above or below the pad.
 *
 * Pure and deterministic; dependency-free.
 */
import type { WorldPoint } from "./normalize";

/** A road surface overlapping a pad by more than this counts as crossing it, metres. */
export const CROSSING_OVERLAP = 0.5;
/** A road end within this of a pad's edge (beyond its half width) is that pad's entrance, metres. */
export const ENTRANCE_REACH = 2;
/** An entrance more than this off its pad's level is reported, metres. */
export const ENTRANCE_STEP = 0.3;

export interface CheckRoad {
  id: string;
  /** World points [x, y, z], in order. */
  points: ReadonlyArray<readonly [number, number, number]>;
  width: number;
}

export interface CheckPad {
  id: string;
  polygon: readonly WorldPoint[];
  height: number;
}

export interface SceneIssue {
  kind: "roadCrossesPad" | "entranceStep";
  road: string;
  pad: string;
  message: string;
}

function inside([x, z]: WorldPoint, polygon: readonly WorldPoint[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i]!, [xj, zj] = polygon[j]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) result = !result;
  }
  return result;
}

function edgeDistance([x, z]: WorldPoint, polygon: readonly WorldPoint[]): number {
  let best = Infinity;
  polygon.forEach(([ax, az], index) => {
    const [bx, bz] = polygon[(index + 1) % polygon.length]!;
    const dx = bx - ax, dz = bz - az, len = dx * dx + dz * dz;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  });
  return best;
}

/** Signed distance from a pad: negative inside. */
function padDistance(p: WorldPoint, polygon: readonly WorldPoint[]): number {
  const d = edgeDistance(p, polygon);
  return inside(p, polygon) ? -d : d;
}

const round = (value: number): number => Math.round(value * 100) / 100;

export function checkScene(roads: readonly CheckRoad[], pads: readonly CheckPad[]): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const road of roads) {
    if (road.points.length === 0) continue;
    const half = road.width / 2;
    // The road centreline every metre, with its distance from each end.
    const samples: Array<{ p: WorldPoint; fromStart: number }> = [];
    let travelled = 0;
    for (let index = 0; index < road.points.length; index += 1) {
      const [x, , z] = road.points[index]!;
      if (index === 0) { samples.push({ p: [x, z], fromStart: 0 }); continue; }
      const [px, , pz] = road.points[index - 1]!;
      const span = Math.hypot(x - px, z - pz);
      const steps = Math.max(1, Math.ceil(span));
      for (let k = 1; k <= steps; k += 1) samples.push({ p: [px + ((x - px) * k) / steps, pz + ((z - pz) * k) / steps], fromStart: travelled + (span * k) / steps });
      travelled += span;
    }
    const ends = [road.points[0]!, road.points[road.points.length - 1]!];
    // Each end with the direction the road arrives in.
    const heading = (end: number): WorldPoint => {
      const a = road.points[end === 0 ? Math.min(1, road.points.length - 1) : Math.max(0, road.points.length - 2)]!;
      const b = road.points[end === 0 ? 0 : road.points.length - 1]!;
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
      return [(b[0] - a[0]) / len, (b[2] - a[2]) / len];
    };
    for (const pad of pads) {
      // An end at this pad's edge, heading towards it, is its entrance; the road's last metres there may touch the pad.
      const centre = pad.polygon.reduce<WorldPoint>((sum, p) => [sum[0] + p[0] / pad.polygon.length, sum[1] + p[1] / pad.polygon.length], [0, 0]);
      const entrances = ends.filter(([x, , z], index) => {
        if (padDistance([x, z], pad.polygon) > half + ENTRANCE_REACH) return false;
        const [hx, hz] = heading(index === 0 ? 0 : 1);
        const tx = centre[0] - x, tz = centre[1] - z, len = Math.hypot(tx, tz) || 1;
        return (hx * tx + hz * tz) / len > 0;
      });
      const exempt = (fromStart: number): boolean => entrances.some((end) => {
        const fromEnd = end === ends[0] ? fromStart : travelled - fromStart;
        return fromEnd <= half + ENTRANCE_REACH + CROSSING_OVERLAP;
      });
      const deepest = samples.reduce((best, sample) => (exempt(sample.fromStart) ? best : Math.min(best, padDistance(sample.p, pad.polygon) - half)), Infinity);
      if (deepest < -CROSSING_OVERLAP) {
        issues.push({ kind: "roadCrossesPad", road: road.id, pad: pad.id, message: `road ${road.id} runs ${round(-deepest)} m into pad ${pad.id}` });
      }
      for (const [, y] of entrances) {
        const step = y - pad.height;
        if (Math.abs(step) > ENTRANCE_STEP) {
          issues.push({ kind: "entranceStep", road: road.id, pad: pad.id, message: `road ${road.id} reaches pad ${pad.id} ${round(Math.abs(step))} m ${step > 0 ? "above" : "below"} its level` });
        }
      }
    }
  }
  return issues;
}
