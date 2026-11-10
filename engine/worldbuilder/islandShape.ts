/** A3 radial polygon: bounded, area-balanced main forms and exact metre distances.
 * Stored radii are metric angles east -> north; no renderer dependencies. */
export const ISLAND_RADIAL_SAMPLES = 128;
const TAU = 2 * Math.PI;

function random(seed: number): () => number {
  let state = (seed ^ 0x31c8e5a7) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radius to the polygon chord, not a linear interpolation of polar radii. */
export function radialIslandRadius(radii: readonly number[], angle: number): number {
  const step = TAU / radii.length, u = ((angle % TAU) + TAU) % TAU / step;
  const index = Math.min(radii.length - 1, Math.floor(u)), t = (u - index) * step;
  const a = radii[index]!, b = radii[(index + 1) % radii.length]!;
  return a * b * Math.sin(step) / (b * Math.sin(step - t) + a * Math.sin(t));
}

export function radialIslandArea(radii: readonly number[]): number {
  return .5 * Math.sin(TAU / radii.length) * radii.reduce((sum, r, i) => sum + r * radii[(i + 1) % radii.length]!, 0);
}

/** Only new random briefs call this. Explicit radii freeze the generated shape. */
export function generateIslandRadii(radius: number, extent: number, seed: number): number[] {
  const next = random(seed), kind = Math.floor(next() * 4), rotation = next() * TAU;
  const aspect = kind === 0 ? 1.4 + next() * .35 : 1.0 + next() * .25;
  const skew = .12 + next() * .17, phase = next() * TAU;
  const capeCount = kind === 1 ? 3 : kind === 2 ? 3 : 2;
  const capes = Array.from({ length: capeCount }, (_, i) => ({
    angle: rotation + (kind === 2 ? [-1.05, 1.05, Math.PI][i]! : i * TAU / capeCount) + (next() - .5) * .45,
    width: .35 + next() * .3, amount: (kind === 1 ? .55 : .35) + next() * .4,
  }));
  const bays = Array.from({ length: kind === 2 ? 1 : kind === 1 ? 3 : 2 }, (_, i) => ({
    angle: rotation + (kind === 2 ? 0 : (i + .45) * TAU / (kind === 1 ? 3 : 2)) + (next() - .5) * .4,
    width: kind === 2 ? .7 : .4 + next() * .28, amount: kind === 2 ? 1.15 : .65 + next() * .35,
  }));
  const bump = (angle: number, centre: number, width: number) => {
    const gap = Math.atan2(Math.sin(angle - centre), Math.cos(angle - centre));
    return Math.exp(-.5 * (gap / width) ** 2);
  };
  const margin = Math.max(32, extent * .03), half = extent / 2 - margin;
  const raw = Array.from({ length: ISLAND_RADIAL_SAMPLES }, (_, i) => {
    const a = i * TAU / ISLAND_RADIAL_SAMPLES, t = a - rotation;
    let value = 1 / Math.sqrt((Math.cos(t) / aspect) ** 2 + (Math.sin(t) * aspect) ** 2);
    value += skew * Math.cos(t - .6);
    for (const cape of capes) value += cape.amount * bump(a, cape.angle, cape.width);
    for (const bay of bays) value -= bay.amount * bump(a, bay.angle, bay.width);
    value += .025 * Math.sin(7 * a + phase) + .015 * Math.sin(11 * a - phase);
    return { radius: radius * Math.max(.48, value), limit: half / (Math.cos(a) ** 4 + Math.sin(a) ** 4) ** .25 };
  });
  const atScale = (scale: number) => raw.map(r => {
    const value = Math.max(radius * .48, r.radius * scale);
    // Smooth saturation towards the square's inset, avoiding clipped straight capes.
    return value / (1 + (value / r.limit) ** 12) ** (1 / 12);
  });
  // The legacy two-sine island has exactly this area for every seed phase.
  const target = Math.PI * radius ** 2 * (1 + (.07 ** 2 + .04 ** 2) / 2);
  let lo = 0, hi = 8;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (radialIslandArea(atScale(mid)) < target) lo = mid; else hi = mid;
  }
  return atScale((lo + hi) / 2).map(r => Math.round(r * 1000) / 1000);
}

interface Edge { ax: number; az: number; bx: number; bz: number; minX: number; minZ: number; maxX: number; maxZ: number }
function segmentSquared(edge: Edge, x: number, z: number): number {
  const dx = edge.bx - edge.ax, dz = edge.bz - edge.az;
  const t = Math.max(0, Math.min(1, ((x - edge.ax) * dx + (z - edge.az) * dz) / (dx * dx + dz * dz)));
  return (x - edge.ax - t * dx) ** 2 + (z - edge.az - t * dz) ** 2;
}

/** Exact signed distance to the saved polygon. Cell candidate bounds only prune
 * impossible nearest edges; they never approximate the shore or depth profile. */
export function radialIslandDistance(cx: number, cz: number, radii: readonly number[]): (x: number, z: number) => number {
  const points = radii.map((r, i) => [cx + r * Math.cos(i * TAU / radii.length), cz - r * Math.sin(i * TAU / radii.length)] as const);
  const edges: Edge[] = points.map(([ax, az], i) => {
    const [bx, bz] = points[(i + 1) % points.length]!;
    return { ax, az, bx, bz, minX: Math.min(ax, bx), minZ: Math.min(az, bz), maxX: Math.max(ax, bx), maxZ: Math.max(az, bz) };
  });
  const cell = Math.max(...radii) / 12, candidates = new Map<string, readonly Edge[]>();
  return (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return NaN;
    const gx = Math.floor((x - cx) / cell), gz = Math.floor((z - cz) / cell), key = `${gx}_${gz}`;
    let nearby = candidates.get(key);
    if (!nearby) {
      const minX = cx + gx * cell, minZ = cz + gz * cell, mx = minX + cell / 2, mz = minZ + cell / 2;
      const upper = Math.sqrt(Math.min(...edges.map(edge => segmentSquared(edge, mx, mz)))) + cell * Math.SQRT1_2;
      nearby = edges.filter(edge => {
        const dx = Math.max(0, minX - edge.maxX, edge.minX - minX - cell);
        const dz = Math.max(0, minZ - edge.maxZ, edge.minZ - minZ - cell);
        return dx * dx + dz * dz <= upper * upper;
      });
      if (candidates.size < 4096) candidates.set(key, nearby);
    }
    let squared = Infinity;
    for (const edge of nearby) squared = Math.min(squared, segmentSquared(edge, x, z));
    const dx = x - cx, dz = z - cz, inside = Math.hypot(dx, dz) <= radialIslandRadius(radii, Math.atan2(-dz, dx));
    return Math.sqrt(squared) * (inside ? 1 : -1);
  };
}
