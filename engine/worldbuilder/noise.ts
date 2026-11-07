/**
 * Seeded 2D gradient noise for World Builder terrain: fractal (`fbm`) and
 * ridged multifractal (`ridged`). Pure and deterministic in world coordinates,
 * so neighbouring tiles sample the same value on their shared edge. The
 * generated test worlds (`tools/world/testWorld.ts`) use the same functions.
 */

// Sixteen unit gradients: a table lookup instead of trig per lattice corner.
const GRADIENT_X = Float64Array.from({ length: 16 }, (_, index) => Math.cos(index * Math.PI / 8));
const GRADIENT_Z = Float64Array.from({ length: 16 }, (_, index) => Math.sin(index * Math.PI / 8));

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 2D gradient noise, roughly −0.7..0.7. */
export function gradientNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  // Hot path (tens of millions of calls per world): no closures, no tuples.
  const g00 = hash(ix, iz, seed) & 15;
  const g10 = hash(ix + 1, iz, seed) & 15;
  const g01 = hash(ix, iz + 1, seed) & 15;
  const g11 = hash(ix + 1, iz + 1, seed) & 15;
  const n00 = GRADIENT_X[g00]! * fx + GRADIENT_Z[g00]! * fz;
  const n10 = GRADIENT_X[g10]! * (fx - 1) + GRADIENT_Z[g10]! * fz;
  const n01 = GRADIENT_X[g01]! * fx + GRADIENT_Z[g01]! * (fz - 1);
  const n11 = GRADIENT_X[g11]! * (fx - 1) + GRADIENT_Z[g11]! * (fz - 1);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const top = n00 + (n10 - n00) * ux;
  const bottom = n01 + (n11 - n01) * ux;
  return top + (bottom - top) * uz;
}

/** Fractal noise, roughly −0.5..0.5. */
export function fbm(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += gradientNoise(x, z, seed + octave * 101) * amplitude;
    x *= 2.03;
    z *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

/** Ridged multifractal, 0..~1: sharp crests where the noise crosses zero. */
export function ridged(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let weight = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    const ridge = (1 - Math.abs(gradientNoise(x, z, seed + octave * 131)) * 1.4) ** 2 * weight;
    sum += ridge * amplitude;
    weight = Math.min(1, ridge * 2);
    x *= 2.11;
    z *= 2.11;
    amplitude *= 0.5;
  }
  return sum;
}
