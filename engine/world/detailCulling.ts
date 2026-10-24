/**
 * Small-object distance culling for static placements (OPEN_WORLD_PLAN Faz 7e).
 * Unreal-style screen-size rule: an asset fades out where its bounding sphere
 * would cover about the same small angle whatever its size, so the cull distance
 * is a multiple of its radius. Large assets (past {@link DETAIL_CULL_MAX_DISTANCE})
 * never cull — those are HLOD's job when their cell unloads.
 */

/** Cull distance per metre of bounding radius (scale 1, quality scale 1). */
export const DETAIL_CULL_SCREEN_FACTOR = 200;
/** Assets whose cull distance would exceed this never cull. */
export const DETAIL_CULL_MAX_DISTANCE = 1000;
/** The dither fade starts at this fraction of the cull distance. */
export const DETAIL_CULL_FADE_START = 0.8;

/** Scale-1 cull distance for an asset's bounding radius, or null when it never culls. */
export function detailCullDistance(radius: number): number | null {
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const distance = radius * DETAIL_CULL_SCREEN_FACTOR;
  return distance > DETAIL_CULL_MAX_DISTANCE ? null : distance;
}

/** The `(start, end)` fade window for a scale-1 cull distance and the quality scale. */
export function detailCullWindow(cullDistance: number, qualityScale: number): [number, number] {
  const scale = Number.isFinite(qualityScale) && qualityScale > 0 ? qualityScale : 1;
  const end = cullDistance * scale;
  return [end * DETAIL_CULL_FADE_START, end];
}

/**
 * True when every instance of a batch is past its cull distance: the nearest
 * point of the batch's bounding sphere is farther than the cull distance of its
 * largest instance (instances fade by distance ÷ their scale).
 */
export function detailBatchCulled(
  distanceToCenter: number,
  sphereRadius: number,
  cullDistance: number,
  maxInstanceScale: number,
  qualityScale: number,
): boolean {
  const [, end] = detailCullWindow(cullDistance, qualityScale);
  return distanceToCenter - sphereRadius > end * Math.max(maxInstanceScale, 0);
}
