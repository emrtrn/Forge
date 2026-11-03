import type { FractureVec3 } from "./voronoiFracture";

/** Shared cut area between two final chunk indices, ordered a < b. */
export interface FractureLink {
  readonly a: number;
  readonly b: number;
  readonly area: number;
}

/** Finds anchored reachability and ordered unsupported components among present chunks. */
export function supportIslands(
  count: number, links: readonly FractureLink[], anchored: readonly boolean[], present: readonly boolean[],
): { supported: boolean[]; islands: number[][] } {
  const neighbors = Array.from({ length: count }, () => [] as number[]);
  for (const { a, b } of links) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= count || b >= count) continue;
    if (!present[a] || !present[b]) continue;
    neighbors[a]!.push(b);
    neighbors[b]!.push(a);
  }
  const supported = Array<boolean>(count).fill(false);
  const queue: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (present[i] && anchored[i]) {
      supported[i] = true;
      queue.push(i);
    }
  }
  const visit = (component: number[], reached: boolean[]): void => {
    for (let head = 0; head < component.length; head += 1) {
      for (const next of neighbors[component[head]!]!) {
        if (reached[next]) continue;
        reached[next] = true;
        component.push(next);
      }
    }
  };
  visit(queue, supported);
  const visited = supported.slice();
  const islands: number[][] = [];
  for (let i = 0; i < count; i += 1) {
    if (!present[i] || visited[i]) continue;
    const island = [i];
    visited[i] = true;
    visit(island, visited);
    islands.push(island.sort((a, b) => a - b));
  }
  return { supported, islands };
}

/** Axis-aligned anchor region in model space. */
export interface FractureAnchorBox {
  readonly min: FractureVec3;
  readonly max: FractureVec3;
}

/** Marks chunks whose model-space hull bounds touch or overlap any anchor box. */
export function anchoredChunks(
  chunks: readonly { readonly pivot: FractureVec3; readonly hull: readonly FractureVec3[] }[],
  boxes: readonly FractureAnchorBox[],
): boolean[] {
  return chunks.map(({ pivot, hull }) => {
    if (!boxes.length || !hull.length) return false;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const point of hull) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = pivot[axis]! + point[axis]!;
        min[axis] = Math.min(min[axis]!, value);
        max[axis] = Math.max(max[axis]!, value);
      }
    }
    return boxes.some((box) => min.every((value, axis) =>
      value <= box.max[axis]! + 1e-9 && max[axis]! >= box.min[axis]! - 1e-9));
  });
}

/** Creates a bottom slab padded by one percent of the diagonal except at its top. */
export function bottomAnchorBox(
  bounds: { min: FractureVec3; max: FractureVec3 }, fraction: number, upAxis: 0 | 1 | 2 = 1,
): FractureAnchorBox {
  const padding = 0.01 * Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis]!));
  const min: [number, number, number] = [bounds.min[0] - padding, bounds.min[1] - padding, bounds.min[2] - padding];
  const max: [number, number, number] = [bounds.max[0] + padding, bounds.max[1] + padding, bounds.max[2] + padding];
  max[upAxis] = bounds.min[upAxis] + Math.max(0, Math.min(1, fraction)) * (bounds.max[upAxis] - bounds.min[upAxis]);
  return { min, max };
}

/** Selects present positions within radius, falling back to the nearest present index. */
export function chunksInRadius(
  positions: readonly FractureVec3[], present: readonly boolean[], center: FractureVec3, radius: number,
): number[] {
  const limit = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const indices: number[] = [];
  let nearest = -1;
  let nearestDistance = Infinity;
  for (let i = 0; i < positions.length; i += 1) {
    if (!present[i]) continue;
    const point = positions[i]!;
    const distance = Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2]);
    if (distance <= limit) indices.push(i);
    if (nearest < 0 || distance < nearestDistance) {
      nearest = i;
      nearestDistance = distance;
    }
  }
  return indices.length ? indices : nearest >= 0 ? [nearest] : [];
}

/** Computes nonnegative impulse growth with finite inputs and an optional finite cap. */
export function damageRadius(base: number, perImpulse: number, impulse: number, max: number): number {
  const finite = (value: number): number => Number.isFinite(value) ? value : 0;
  const radius = finite(base) + finite(perImpulse) * Math.max(0, finite(impulse));
  const cap = Number.isFinite(max) ? Math.max(0, max) : Infinity;
  return Math.max(0, Math.min(cap, radius));
}

/**
 * One hit on a damaged source (APEX support): the present chunks within
 * `radius` of `center` are released, then every island that release cut off
 * from the anchors. Marks them absent in `present` (mutated) and returns both
 * groups; the runtime and the editor's Simulate Hit share it.
 */
export function releaseSupportHit(
  positions: readonly FractureVec3[], links: readonly FractureLink[], anchored: readonly boolean[],
  present: boolean[], center: FractureVec3, radius: number,
): { inRadius: number[]; collapsed: number[] } {
  const inRadius = chunksInRadius(positions, present, center, radius);
  for (const index of inRadius) present[index] = false;
  const collapsed: number[] = [];
  for (const island of supportIslands(present.length, links, anchored, present).islands) {
    for (const index of island) {
      present[index] = false;
      collapsed.push(index);
    }
  }
  return { inRadius, collapsed };
}
