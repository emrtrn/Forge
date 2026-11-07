/**
 * Seeded mountain relief in world metres, held to zero around protected ground
 * (World Builder plan v0.4 T11). No file writes, terrain mutation or game rules:
 * the caller adds `displacementAt(x, z)` to its own ground.
 *
 * The ridges are a ridged multifractal over gradient noise (`noise.ts`): sharp
 * crests, smooth hollows, a domain warp so crests do not run in straight rows.
 * `spurStretch` < 1 lengthens the crests along `directionDegrees` — e.g. spurs
 * running across a valley, down towards its river.
 *
 * Protections (a village, its roads, a river) are distance bands: the relief is
 * exactly zero within `inner` metres of a protection's sources and reaches full
 * strength `falloff` metres further out. `blur` smooths the outline of many
 * sources (a village of single houses) into one edge instead of a chain of
 * circles. The bands are built once on a coarse grid (`maskCellSize`) and
 * sampled bilinearly, so the zero holds exactly for points at least one mask
 * cell inside `inner`; the next cell out may carry a trace of relief.
 *
 * First used for the Derekavak greybox (Ridgebound), where this replaced an
 * earlier value-noise kernel that read as blobs at mountain scale.
 */
import { distanceField, fieldAt, gridSpecForBounds, type DistanceSource, type Field, type GridSpec } from "./field";
import { gradientNoise } from "./noise";
import type { WorldPoint } from "./normalize";

export interface ReliefProtection {
  id: string;
  sources: readonly DistanceSource[];
  /** Relief is zero within this distance of the sources, metres. */
  inner: number;
  /** Full relief this far beyond `inner`, metres. */
  falloff: number;
  /** Smooths the outline of many sources into one edge, metres (0 = none). */
  blur?: number;
}

export interface MacroReliefOptions {
  seed: number;
  /** Height of the ridges above `lift`, metres. */
  amplitude: number;
  /** Ground raised everywhere the relief is at full strength, metres (default 0). */
  lift?: number;
  /** Size of the largest ridges, metres. */
  wavelength: number;
  /** Detail layers, 1..8 (default 5). */
  octaves?: number;
  /** Strength of each detail layer relative to the one before, 0..1 (default 0.42). */
  gain?: number;
  /** 1 = round massifs; below 1 lengthens crests along `directionDegrees` (default 1). */
  spurStretch?: number;
  /** Crest direction: 0 along +X, 90 along +Z. */
  directionDegrees: number;
  /** Domain warp, metres (default a quarter of `wavelength`). */
  warp?: number;
  bounds: { min: WorldPoint; max: WorldPoint };
  /** Fade inside the region boundary; outside it the displacement is exactly zero. */
  edgeFade: number;
  protections: readonly ReliefProtection[];
  /** Protection grid cell, metres (default 8). */
  maskCellSize?: number;
}

const smooth = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isPoint = (p: WorldPoint) => p.length === 2 && p.every(finite);

function validSource(source: DistanceSource): boolean {
  if (source.kind === "point") return isPoint(source.position) && (source.radius === undefined || (finite(source.radius) && source.radius >= 0));
  if (source.kind === "polygon") return source.polygon.length >= 3 && source.polygon.length <= 4096 && source.polygon.every(isPoint);
  const radii = source.radii ?? source.points.map(() => 0);
  return source.points.length >= 1 && source.points.length <= 4096 && source.points.every(isPoint)
    && radii.length === source.points.length && radii.every((r) => finite(r) && r >= 0);
}

/** Separable box blur, three passes (close to a Gaussian). */
function blurField(field: Field, radius: number): Field {
  if (radius < 1) return field;
  const { width, depth } = field;
  let values = field.values;
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [length, stride, lines, lineStride] of [[width, 1, depth, width], [depth, width, width, 1]] as const) {
      const out = new Float32Array(values.length);
      for (let line = 0; line < lines; line += 1) {
        const base = line * lineStride;
        let sum = 0;
        let count = 0;
        for (let k = 0; k <= Math.min(radius, length - 1); k += 1) { sum += values[base + k * stride]!; count += 1; }
        for (let k = 0; k < length; k += 1) {
          out[base + k * stride] = sum / count;
          const add = k + radius + 1;
          const drop = k - radius;
          if (add < length) { sum += values[base + add * stride]!; count += 1; }
          if (drop >= 0) { sum -= values[base + drop * stride]!; count -= 1; }
        }
      }
      values = out;
    }
  }
  return { ...field, values };
}

/** Snapshot parameters once. Global coordinates guarantee identical shared-edge samples. */
export function createMacroRelief(options: MacroReliefOptions) {
  const config = structuredClone(options);
  const lift = config.lift ?? 0;
  const octaves = config.octaves ?? 5;
  const gain = config.gain ?? 0.42;
  const stretch = config.spurStretch ?? 1;
  const warp = config.warp ?? config.wavelength / 4;
  const cellSize = config.maskCellSize ?? 8;
  if (!Number.isInteger(config.seed) || config.seed < -2147483648 || config.seed > 2147483647
    || !finite(config.amplitude) || config.amplitude < 0 || config.amplitude > 10000
    || !finite(lift) || lift < 0 || lift > 10000
    || !finite(config.wavelength) || config.wavelength < 1
    || !Number.isInteger(octaves) || octaves < 1 || octaves > 8
    || !finite(gain) || gain <= 0 || gain >= 1
    || !finite(stretch) || stretch <= 0 || stretch > 1
    || !finite(warp) || warp < 0
    || !finite(config.directionDegrees)
    || !finite(config.edgeFade) || config.edgeFade <= 0
    || !finite(cellSize) || cellSize <= 0
    || !isPoint(config.bounds.min) || !isPoint(config.bounds.max)
    || config.bounds.max.some((v, axis) => v <= config.bounds.min[axis]!)
    || config.protections.length > 256) throw new Error("Invalid macro relief parameters");
  for (const protection of config.protections) {
    const blur = protection.blur ?? 0;
    if (!protection.id || !finite(protection.inner) || protection.inner < 0
      || !finite(protection.falloff) || protection.falloff <= 0 || !finite(blur) || blur < 0
      || protection.sources.length < 1 || protection.sources.length > 4096 || !protection.sources.every(validSource)) {
      throw new Error("Invalid macro relief protection");
    }
  }

  // One weight grid for all protections: the minimum of each band. Each band also holds a
  // sharp guard on the unblurred distance, so blurring never lifts protected ground.
  const spec: GridSpec = gridSpecForBounds(config.bounds, cellSize);
  const mask = { ...spec, values: new Float32Array(spec.width * spec.depth).fill(1) } as Field;
  for (const protection of config.protections) {
    const blur = protection.blur ?? 0;
    const raw = distanceField(spec, protection.sources, protection.inner + protection.falloff + 2 * blur + cellSize);
    const blurred = blurField(raw, Math.round(blur / cellSize));
    const guard = Math.max(2 * cellSize, blur);
    for (let index = 0; index < mask.values.length; index += 1) {
      const band = Math.min(smooth((blurred.values[index]! - protection.inner) / protection.falloff),
        smooth((raw.values[index]! - protection.inner) / guard));
      if (band < mask.values[index]!) mask.values[index] = band;
    }
  }

  const angle = (config.directionDegrees % 360) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const warpScale = config.wavelength * 1.15;

  function weightAt(x: number, z: number): number {
    if (!finite(x) || !finite(z)) throw new Error("Expected finite world coordinates");
    const edge = Math.min(x - config.bounds.min[0], z - config.bounds.min[1],
      config.bounds.max[0] - x, config.bounds.max[1] - z);
    if (edge <= 0) return 0;
    const protectedWeight = fieldAt(mask, x, z);
    return smooth(edge / config.edgeFade) * (Number.isNaN(protectedWeight) ? 0 : protectedWeight);
  }

  /** Ridged multifractal, 0..1. */
  function ridgesAt(x: number, z: number): number {
    const wx = x + warp * 1.4 * gradientNoise(x / warpScale, z / warpScale, config.seed + 1);
    const wz = z + warp * 1.4 * gradientNoise(x / warpScale + 5.3, z / warpScale + 9.1, config.seed + 2);
    // u runs along the crests, v across them.
    const u = wx * cos + wz * sin, v = -wx * sin + wz * cos;
    let frequency = 1 / config.wavelength, amplitude = 1, weight = 1, sum = 0, total = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      let ridge = 1 - Math.min(1, Math.abs(gradientNoise(u * frequency * stretch + octave * 17.3, v * frequency - octave * 11.7, config.seed + octave * 131)) * 1.4);
      ridge *= ridge * weight;
      weight = Math.min(1, ridge * 1.6);
      sum += ridge * amplitude;
      total += amplitude;
      amplitude *= gain;
      frequency *= 2.1;
    }
    return sum / total;
  }

  function displacementAt(x: number, z: number): number {
    const weight = weightAt(x, z);
    if (weight === 0) return 0;
    return weight * (lift + config.amplitude * ridgesAt(x, z));
  }

  return { weightAt, displacementAt };
}
