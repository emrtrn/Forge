/** Smallest/largest authored `worldSettings.viewDistance` (metres). */
export const VIEW_DISTANCE_MIN = 50;
export const VIEW_DISTANCE_MAX = 20000;
/** Effective far planes beyond this run in "far view mode" (reversed-Z, follow shadow). */
export const FAR_VIEW_MODE_THRESHOLD = 1000;
/** Fog opacity the "Fit to View Distance" command targets at the far plane. */
export const VIEW_DISTANCE_FOG_OPACITY = 0.98;

/**
 * Effective camera far plane: authored view distance × quality multiplier.
 * `null` when the level has no valid view distance. Invalid multipliers count
 * as 1; the result is clamped to the authored distance limits.
 */
export function effectiveViewDistance(
  viewDistance: number | undefined,
  multiplier: number | undefined,
): number | null {
  if (viewDistance === undefined || !Number.isFinite(viewDistance) || viewDistance <= 0) return null;
  const scale = multiplier !== undefined && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.max(VIEW_DISTANCE_MIN, Math.min(VIEW_DISTANCE_MAX, viewDistance * scale));
}

/** True when an effective far plane is strictly beyond FAR_VIEW_MODE_THRESHOLD. */
export function isFarViewMode(far: number | null): boolean {
  return far !== null && far > FAR_VIEW_MODE_THRESHOLD;
}

/** FogExp2 density for a target opacity at a distance; 0 for invalid input. */
export function exponentialFogDensityFor(distance: number, opacity = VIEW_DISTANCE_FOG_OPACITY): number {
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(opacity) || opacity <= 0 || opacity >= 1) return 0;
  return Math.sqrt(-Math.log(1 - opacity)) / distance;
}

/** FogExp2 opacity: 1 − exp(−(density·distance)²); 0 for invalid input. */
export function exponentialFogOpacityAt(density: number, distance: number): number {
  if (!Number.isFinite(density) || density < 0 || !Number.isFinite(distance) || distance < 0) return 0;
  return 1 - Math.exp(-((density * distance) ** 2));
}

/** The Height Fog fields that decide its opacity (see `ResolvedHeightFog`). */
export interface FogOpacitySource {
  readonly hidden: boolean;
  readonly mode: "exp" | "linear";
  readonly density: number;
  readonly start: number;
  readonly end: number;
  readonly heightFalloff?: number;
  readonly baseHeight?: number;
  readonly startDistance?: number;
  readonly maxOpacity?: number;
}

/** Analytic height-density average along a ray, stable for horizontal views. */
export function heightFogDensityAverage(falloff: number, base: number, startY: number, endY: number): number {
  if (falloff <= 0) return 1;
  const delta = falloff * Math.abs(endY - startY);
  const integral = delta < 0.001 ? 1 - delta / 2 + delta * delta / 6 : -Math.expm1(-delta) / delta;
  return Math.exp(Math.max(-20, Math.min(20, -falloff * (Math.min(startY, endY) - base)))) * integral;
}

/** Horizontal opacity at camera height unless an endpoint height is supplied.
 * Callers without camera information receive a reference at the fog base height.
 */
export function heightFogOpacityAt(fog: FogOpacitySource | null, distance: number, cameraY?: number, endY?: number): number {
  if (!fog || fog.hidden || !Number.isFinite(distance) || distance < 0) return 0;
  const maxOpacity = fog.maxOpacity ?? 1;
  if (fog.mode === "linear") return Math.min(maxOpacity, linearFogOpacityAt(fog.start, fog.end, distance));
  const clear = fog.startDistance ?? 0;
  const length = Math.max(0, distance - clear);
  const origin = cameraY ?? fog.baseHeight ?? 0;
  const end = endY ?? origin;
  const start = origin + (end - origin) * Math.min(1, clear / Math.max(distance, 0.0001));
  const average = heightFogDensityAverage(fog.heightFalloff ?? 0, fog.baseHeight ?? 0, start, end);
  return Math.min(maxOpacity, exponentialFogOpacityAt(fog.density * average, length));
}

/** Fog opacity at the far plane below which a far view mode level shows a hard terrain edge. */
export const VIEW_DISTANCE_FOG_WARN_OPACITY = 0.9;

/** Linear fog opacity, clamped to [0, 1]; a collapsed range becomes a step at end. */
export function linearFogOpacityAt(start: number, end: number, distance: number): number {
  if (end <= start) return distance >= end ? 1 : 0;
  return Math.max(0, Math.min(1, (distance - start) / (end - start)));
}
