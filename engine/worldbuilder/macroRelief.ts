/** Seeded macro relief in world metres. No file writes, terrain mutation or game rules. */
import { sourceDistance, type DistanceSource } from "./field";
import type { WorldPoint } from "./normalize";

export interface ReliefProtection {
  id: string;
  source: Extract<DistanceSource, { kind: "point" | "polyline" }>;
  /** Zero displacement inside the source; smoothly reaches full strength beyond this distance. */
  falloff: number;
}

export interface MacroReliefOptions {
  seed: number;
  amplitude: number;
  wavelength: number;
  directionDegrees: number;
  bounds: { min: WorldPoint; max: WorldPoint };
  /** Fade inside the region boundary; outside it the displacement is exactly zero. */
  edgeFade: number;
  protections: readonly ReliefProtection[];
}

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

// Owned by this operation's version, independent of editor sculpt settings and imports.
function reliefNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const hash = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
  };
  const tx = smooth(x - ix), tz = smooth(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** Snapshot parameters once. Global coordinates guarantee identical shared-edge samples. */
export function createMacroRelief(options: MacroReliefOptions) {
  const config = structuredClone(options);
  const finite = (v: number) => Number.isFinite(v);
  const point = (p: WorldPoint) => p.length === 2 && p.every(finite);
  if (!Number.isInteger(config.seed) || config.seed < -2147483648 || config.seed > 2147483647
    || !finite(config.amplitude) || config.amplitude < 0 || config.amplitude > 10000
    || !finite(config.wavelength) || config.wavelength < 1 || !finite(config.directionDegrees)
    || !finite(config.edgeFade) || config.edgeFade <= 0
    || !point(config.bounds.min) || !point(config.bounds.max)
    || config.bounds.max.some((v, axis) => v <= config.bounds.min[axis]!)
    || config.protections.length > 256) throw new Error("Invalid macro relief parameters");
  for (const protection of config.protections) {
    const source = protection.source;
    const points = source.kind === "point" ? [source.position] : source.points;
    const radii = source.kind === "point" ? [source.radius ?? 0] : source.radii ?? points.map(() => 0);
    if (!protection.id || !finite(protection.falloff) || protection.falloff <= 0
      || points.length < 1 || points.length > 4096 || !points.every(point)
      || radii.length !== points.length || radii.some(r => !finite(r) || r < 0)) {
      throw new Error("Invalid macro relief protection");
    }
  }
  const angle = (config.directionDegrees % 360) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  function weightAt(x: number, z: number): number {
    if (!finite(x) || !finite(z)) throw new Error("Expected finite world coordinates");
    const edge = Math.min(x - config.bounds.min[0], z - config.bounds.min[1],
      config.bounds.max[0] - x, config.bounds.max[1] - z);
    let weight = smooth(edge / config.edgeFade);
    for (const protection of config.protections) {
      if (weight === 0) break;
      weight = Math.min(weight, smooth(sourceDistance([x, z], protection.source) / protection.falloff));
    }
    return weight;
  }
  function displacementAt(x: number, z: number): number {
    const weight = weightAt(x, z);
    if (weight === 0 || config.amplitude === 0) return 0;
    let u = (x * cos + z * sin) / config.wavelength;
    let v = (-x * sin + z * cos) / config.wavelength;
    // Domain warp breaks straight parallel crests; a broad envelope makes shoulders and side hollows.
    const warpU = reliefNoise(u * 0.6, v * 0.6, config.seed + 17) * 0.65;
    const warpV = reliefNoise(u * 0.6, v * 0.6, config.seed + 31) * 0.65;
    const envelope = 0.35 + 0.65 * (reliefNoise(u * 0.7, v * 0.7, config.seed + 43) + 1) / 2;
    u += warpU; v += warpV;
    let ridges = 0, strength = 0.55, total = 0;
    for (let octave = 0; octave < 4; octave++) {
      const ridge = 1 - Math.abs(reliefNoise(u, v * 0.65, config.seed + octave * 101));
      ridges += ridge ** 4 * strength;
      total += strength; strength *= 0.5; u *= 2.03; v *= 2.03;
    }
    // Nonnegative: valleys are retained source channels between raised ridges, not new carved waterways.
    return config.amplitude * weight * envelope * ridges / total;
  }
  return { weightAt, displacementAt };
}
