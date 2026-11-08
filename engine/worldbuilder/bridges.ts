/**
 * Bridges (RANDOM_WORLD_PLAN step 3): where a road crosses a river, a level
 * deck carries it over. The route solver already crosses short and square
 * (`route.ts` makes water expensive); this finds each crossing, gives the
 * route a point at each end of the span — where the river's carved bank ends
 * (`BRIDGE_BANK_REACH` past the water) — and the deck height the profile must
 * hold there: the higher bank, and at least `BRIDGE_CLEARANCE` over the
 * lowest ground under the span. The roads stage leaves the ground under the
 * span alone, so the river runs on underneath, and stands a greybox deck there.
 *
 * Lakes are not bridged: roads keep out of them (`LAKE_ROAD_CLEARANCE`).
 *
 * Pure and deterministic; dependency-free.
 */
import type { WorldPoint } from "./normalize";

/** A span ends this far past the river's water edge: beyond its carved bank (1 m bed margin + 7 m bank), metres. */
export const BRIDGE_BANK_REACH = 12;
/** The deck stands at least this far over the lowest ground under it, metres. */
export const BRIDGE_CLEARANCE = 4;
/** Longest span bridged; a longer wet stretch is left as it is and reported, metres. */
export const BRIDGE_MAX_SPAN = 90;
/** Sample spacing along the route when looking for crossings, metres. */
const SAMPLE = 1;

export interface BridgeRiver {
  points: readonly WorldPoint[];
  /** Half the water surface width, metres. */
  halfWidth: number;
}

export interface BridgeSpan {
  /** Index in the bridged route of the span's first point; the span ends at `start + 1`. */
  start: number;
  /** Deck height. */
  height: number;
  length: number;
}

export interface BridgedRoute {
  points: WorldPoint[];
  spans: BridgeSpan[];
  warnings: string[];
}

function segmentDistance(x: number, z: number, a: WorldPoint, b: WorldPoint): number {
  const [ex, ez] = [b[0] - a[0], b[1] - a[1]];
  const length = ex * ex + ez * ez;
  const t = length > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / length)) : 0;
  return Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t);
}

/** How far past the water edge of the nearest river: negative in the water. */
function pastWater(rivers: readonly BridgeRiver[], [x, z]: WorldPoint): number {
  let best = Infinity;
  for (const river of rivers) {
    for (let index = 0; index < river.points.length - 1; index += 1) {
      best = Math.min(best, segmentDistance(x, z, river.points[index]!, river.points[index + 1]!) - river.halfWidth);
    }
  }
  return best;
}

/**
 * The route with a point at each end of every river crossing and the points
 * between them dropped. `sampleHeight` is the ground the deck spans.
 */
export function bridgeRoute(
  route: readonly WorldPoint[],
  rivers: readonly BridgeRiver[],
  sampleHeight: (x: number, z: number) => number | null,
  label: string,
): BridgedRoute {
  const warnings: string[] = [];
  if (rivers.length === 0 || route.length < 2) return { points: [...route], spans: [], warnings };
  // Dense samples along the route: where it is, which leg it is on, and how far from water.
  const samples: Array<{ at: WorldPoint; leg: number; past: number }> = [];
  for (let leg = 0; leg < route.length - 1; leg += 1) {
    const [a, b] = [route[leg]!, route[leg + 1]!];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE));
    for (let step = 0; step < steps; step += 1) {
      const at: WorldPoint = [a[0] + (b[0] - a[0]) * step / steps, a[1] + (b[1] - a[1]) * step / steps];
      samples.push({ at, leg, past: pastWater(rivers, at) });
    }
  }
  const last = route[route.length - 1]!;
  samples.push({ at: last, leg: route.length - 1, past: pastWater(rivers, last) });

  // Stretches within the bank reach that touch the water.
  const stretches: Array<{ first: number; last: number }> = [];
  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index]!.past > BRIDGE_BANK_REACH) continue;
    let end = index;
    while (end + 1 < samples.length && samples[end + 1]!.past <= BRIDGE_BANK_REACH) end += 1;
    let wet = false;
    for (let k = index; k <= end; k += 1) if (samples[k]!.past <= 0) wet = true;
    if (wet) stretches.push({ first: index, last: end });
    index = end;
  }

  const points: WorldPoint[] = [];
  const spans: BridgeSpan[] = [];
  let leg = 0;
  /** Route points up to and including `throughLeg`, keeping clear of `stop`. */
  const keepThrough = (throughLeg: number, stop: WorldPoint): void => {
    for (; leg <= throughLeg; leg += 1) {
      const point = route[leg]!;
      if (Math.hypot(point[0] - stop[0], point[1] - stop[1]) < SAMPLE && leg > 0) continue;
      points.push(point);
    }
  };
  for (const { first, last: end } of stretches) {
    const [entry, exit] = [samples[first]!, samples[end]!];
    const length = Math.hypot(exit.at[0] - entry.at[0], exit.at[1] - entry.at[1]);
    if (first === 0 || end === samples.length - 1) {
      warnings.push(`${label}: the road ends in a river's bank; it crosses the water without a bridge`);
      continue;
    }
    if (length > BRIDGE_MAX_SPAN) {
      warnings.push(`${label}: a ${Math.round(length)} m wet stretch is longer than a bridge (${BRIDGE_MAX_SPAN} m); it crosses the water without one`);
      continue;
    }
    let lowest = Infinity;
    for (let k = first; k <= end; k += 1) {
      const height = sampleHeight(samples[k]!.at[0], samples[k]!.at[1]);
      if (height !== null) lowest = Math.min(lowest, height);
    }
    const banks = [entry, exit].map(({ at }) => sampleHeight(at[0], at[1]));
    if (!Number.isFinite(lowest) || banks.includes(null)) {
      warnings.push(`${label}: a river crossing off the terrain; it crosses the water without a bridge`);
      continue;
    }
    keepThrough(entry.leg, entry.at);
    spans.push({ start: points.length, height: Math.max(banks[0]!, banks[1]!, lowest + BRIDGE_CLEARANCE), length });
    points.push(entry.at, exit.at);
    // Skip the route points inside the span.
    leg = exit.leg + 1;
    const next = route[leg];
    if (next && Math.hypot(next[0] - exit.at[0], next[1] - exit.at[1]) < SAMPLE && leg < route.length - 1) leg += 1;
  }
  keepThrough(route.length - 1, [Infinity, Infinity]);
  return { points, spans, warnings };
}
