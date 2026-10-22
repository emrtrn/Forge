/** Pure legacy brush math, shared by Landscape and tiled World Terrain. */
export type LandscapeHeightBrushMode = "raise" | "lower" | "smooth" | "flatten";
export type LandscapeWeightBrushMode = "paint" | "erase" | "smoothWeights";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function landscapeBrushFalloff(distance: number, radius: number, exponent: number): number {
  if (distance > radius) return 0;
  return Math.pow(clamp(1 - distance / radius, 0, 1), exponent);
}

/** Missing neighbours are excluded, including at the outer world boundary. */
export function landscapeBrushAverage(sample: (dx: number, dz: number) => number | undefined, current: number): number {
  let total = 0;
  let count = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const value = sample(dx, dz);
      if (value === undefined) continue;
      total += value;
      count += 1;
    }
  }
  return count > 0 ? total / count : current;
}

export function nextLandscapeBrushHeight(
  mode: LandscapeHeightBrushMode,
  current: number,
  target: number,
  amount: number,
  average: () => number,
): number {
  if (mode === "raise") return current + amount;
  if (mode === "lower") return current - amount;
  if (mode === "flatten") return current + (target - current) * clamp(amount, 0, 1);
  return current + (average() - current) * clamp(amount, 0, 1);
}

export function normalizeLandscapeBrushWeights(weights: number[]): void {
  if (weights.length === 0) return;
  let total = 0;
  for (let i = 0; i < weights.length; i += 1) {
    weights[i] = clamp(weights[i]!, 0, 1);
    total += weights[i]!;
  }
  if (total <= 0.000001) {
    weights.fill(0);
    weights[0] = 1;
    return;
  }
  for (let i = 0; i < weights.length; i += 1) weights[i] = Math.round((weights[i]! / total) * 10_000) / 10_000;
}

/** Mutates one vertex's weights, preserving legacy thresholds and rounding. */
export function editLandscapeBrushWeights(
  weights: number[],
  mode: LandscapeWeightBrushMode,
  activeIndex: number,
  amount: number,
  average: (layer: number) => number,
): boolean {
  amount = clamp(amount, 0, 1);
  const before = [...weights];
  if (mode === "smoothWeights") {
    for (let i = 0; i < weights.length; i += 1) weights[i] = before[i]! + (average(i) - before[i]!) * amount;
  } else {
    const active = weights[activeIndex];
    if (active === undefined) return false;
    if (mode === "erase") {
      const removed = Math.min(active, amount);
      if (removed <= 0.0001) return false;
      weights[activeIndex] = active - removed;
      if (activeIndex !== 0) weights[0] = weights[0]! + removed;
      normalizeLandscapeBrushWeights(weights);
      return true;
    }
    const target = Math.min(1, active + amount);
    const remaining = 1 - target;
    const otherTotal = weights.reduce((total, weight, i) => total + (i === activeIndex ? 0 : weight), 0);
    weights[activeIndex] = target;
    for (let i = 0; i < weights.length; i += 1) {
      if (i !== activeIndex) weights[i] = otherTotal > 0 ? (weights[i]! / otherTotal) * remaining : 0;
    }
  }
  normalizeLandscapeBrushWeights(weights);
  return weights.some((weight, i) => Math.abs(weight - before[i]!) > 0.0001);
}
