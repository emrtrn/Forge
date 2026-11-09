import { OCEAN_LIMITS, validateOceanWater, type OceanWaterBody } from "../scene/oceanWater";
import { CooperativeWork, finishWork } from "../core/cooperativeWork";

export interface OceanCoverage {
  inlets?: readonly OceanInlet[];
  body: OceanWaterBody;
  spacing: number;
  nx: number;
  nz: number;
  /** World-space vertex heights. NaN remains unknown, never offshore. */
  heights: Float32Array;
  /** Bits 1/2: exact b–c triangle connected to an authored open boundary. */
  triangles: Uint8Array;
  status: "ready" | "missing-data";
  wetFaces: number;
}
export interface OceanInlet { start: [number, number]; end: [number, number]; width: number }
export function oceanInletContains(inlet: OceanInlet, x: number, z: number): boolean {
  const dx = inlet.end[0] - inlet.start[0], dz = inlet.end[1] - inlet.start[1], length = Math.hypot(dx, dz);
  const along = ((x - inlet.start[0]) * dx + (z - inlet.start[1]) * dz) / length;
  const across = Math.abs((x - inlet.start[0]) * dz - (z - inlet.start[1]) * dx) / length;
  return along >= 0 && along <= length && across <= inlet.width;
}
export type OceanSample = { status: "wet"; bed: number; depth: number; offshore: boolean }
  | { status: "dry" | "unknown" };
/** Explicit offshore depth ramp avoids a rectangular colour seam at the domain edge. */
export const OCEAN_OFFSHORE_TRANSITION = 64;

/** Source spacing must match rendered terrain; preparation is revision-driven, never per frame. */
export function* oceanCoverageSteps(value: OceanWaterBody, spacing: number,
  heightAt: (x: number, z: number) => number | null, inlets: readonly OceanInlet[] = []): Generator<void, OceanCoverage> {
  const body = validateOceanWater(value), { min, max } = body.bounds;
  if ((body.inlets?.length ?? 0) !== inlets.length) throw new Error("Ocean inlet sources must be resolved before coverage preparation");
  if (inlets.some(inlet => ![...inlet.start, ...inlet.end, inlet.width].every(Number.isFinite) || inlet.width <= 0
    || Math.hypot(inlet.end[0] - inlet.start[0], inlet.end[1] - inlet.start[1]) < 1)) throw new Error("Invalid resolved Ocean inlet reach");
  const nx = Math.round((max[0] - min[0]) / spacing), nz = Math.round((max[1] - min[1]) / spacing);
  if (!Number.isFinite(spacing) || spacing <= 0 || nx < 1 || nz < 1 || nx > OCEAN_LIMITS.axisCells || nz > OCEAN_LIMITS.axisCells
    || nx * nz > OCEAN_LIMITS.cells || Math.abs(nx * spacing - max[0] + min[0]) > 1e-6
    || Math.abs(nz * spacing - max[1] + min[1]) > 1e-6) throw new Error("Ocean requires an exact, bounded terrain grid");
  const width = nx + 1, heights = new Float32Array(width * (nz + 1));
  let missing = false;
  for (let z = 0; z <= nz; z++) {
    for (let x = 0; x <= nx; x++) {
      const h = heightAt(min[0] + x * spacing, min[1] + z * spacing);
      heights[z * width + x] = h !== null && Number.isFinite(h) ? h : NaN;
      if (!Number.isFinite(heights[z * width + x])) missing = true;
    }
    yield;
  }
  const triangles = new Uint8Array(nx * nz), count = nx * nz * 2;
  const out: OceanCoverage = { body, spacing, nx, nz, heights, triangles, status: missing ? "missing-data" : "ready", wetFaces: 0, ...(inlets.length ? { inlets } : {}) };
  // No new geometry may publish from an incomplete domain. Owners retain their previous coverage.
  if (missing) return out;
  const vertices = (t: number): [number, number, number] => {
    const cell = t >> 1, a = Math.floor(cell / nx) * width + cell % nx;
    return t & 1 ? [a + 1, a + width, a + width + 1] : [a, a + width, a + 1];
  };
  const queue = new Int32Array(count), visited = new Uint8Array(count); let tail = 0;
  const add = (t: number) => { if (!visited[t]) { visited[t] = 1; queue[tail++] = t; } };
  const wetEdge = (a: number, b: number) => Math.min(heights[a]!, heights[b]!) < body.surfaceLevel;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const a = z * width + x, t = (z * nx + x) * 2;
    if (x === 0 && body.openEdges.includes("west") && wetEdge(a, a + width)) add(t);
    if (z === 0 && body.openEdges.includes("north") && wetEdge(a, a + 1)) add(t);
    if (x === nx - 1 && body.openEdges.includes("east") && wetEdge(a + 1, a + width + 1)) add(t + 1);
    if (z === nz - 1 && body.openEdges.includes("south") && wetEdge(a + width, a + width + 1)) add(t + 1);
    if ((t & 255) === 0) yield;
  }
  for (let head = 0; head < tail; head++) {
    const t = queue[head]!, cell = t >> 1, x = cell % nx, z = Math.floor(cell / nx), v = vertices(t);
    triangles[cell]! |= t & 1 ? 2 : 1;
    const neighbours = t & 1 ? [t - 1, z + 1 < nz ? t + 2 * nx - 1 : -1, x + 1 < nx ? t + 1 : -1]
      : [x > 0 ? t - 1 : -1, t + 1, z > 0 ? t - 2 * nx + 1 : -1];
    for (let e = 0; e < 3; e++) if (neighbours[e]! >= 0 && wetEdge(v[e]!, v[(e + 1) % 3]!)) add(neighbours[e]!);
    if ((head & 255) === 0) yield;
  }
  out.wetFaces = tail; return out;
}
export const buildOceanCoverage = (body: OceanWaterBody, spacing: number, height: (x: number, z: number) => number | null, inlets: readonly OceanInlet[] = []) =>
  finishWork(oceanCoverageSteps(body, spacing, height, inlets));
export const prepareOceanCoverage = (body: OceanWaterBody, spacing: number, height: (x: number, z: number) => number | null,
  work = new CooperativeWork(), inlets: readonly OceanInlet[] = []) => work.run("ocean-coverage", oceanCoverageSteps(body, spacing, height, inlets));

/** Exact source triangle interpolation. Sampling outside the domain is authored offshore, not missing data. */
export function sampleOceanCoverage(c: OceanCoverage, x: number, z: number): OceanSample {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { status: "unknown" };
  const { body: b, spacing, nx, nz, heights: h } = c, { min, max } = b.bounds;
  if (c.status !== "ready") return { status: "unknown" };
  if (c.inlets?.some(inlet => oceanInletContains(inlet, x, z))) return { status: "dry" };
  const clampedX = Math.min(max[0], Math.max(min[0], x)), clampedZ = Math.min(max[1], Math.max(min[1], z));
  const outside = Math.hypot(x - clampedX, z - clampedZ);
  const gx = (clampedX - min[0]) / spacing, gz = (clampedZ - min[1]) / spacing;
  const ix = Math.min(nx - 1, Math.floor(gx)), iz = Math.min(nz - 1, Math.floor(gz));
  const fx = gx - ix, fz = gz - iz, first = fx + fz <= 1, a = iz * (nx + 1) + ix;
  const bed = first ? h[a]! * (1 - fx - fz) + h[a + 1]! * fx + h[a + nx + 1]! * fz
    : h[a + nx + 2]! * (fx + fz - 1) + h[a + nx + 1]! * (1 - fx) + h[a + 1]! * (1 - fz);
  if (outside > 0) {
    if (b.offshorePolicy === "connectedBoundary" && (!(c.triangles[iz * nx + ix]! & (first ? 1 : 2)) || bed >= b.surfaceLevel)) return { status: "dry" };
    const t = Math.min(1, outside / OCEAN_OFFSHORE_TRANSITION), fade = t * t * (3 - 2 * t);
    const depth = Math.max(0, b.surfaceLevel - bed) * (1 - fade) + b.offshoreDepth * fade;
    return { status: "wet", depth, bed: b.surfaceLevel - depth, offshore: true };
  }
  if (!(c.triangles[iz * nx + ix]! & (first ? 1 : 2))) return { status: "dry" };
  return bed < b.surfaceLevel ? { status: "wet", bed, depth: b.surfaceLevel - bed, offshore: false } : { status: "dry" };
}
