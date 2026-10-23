/**
 * World-space UI widgets (UMG Lite "WidgetComponentLite", U7d — Option A).
 *
 * Forge's lightweight answer to Unreal's Widget Component: a `*.ui.json` widget
 * rendered as a *screen-projected DOM overlay* that tracks a world-space anchor
 * each frame (a billboard label / prompt). Deliberately the cheap option first —
 * crisp DOM text, no DOM-to-texture, no 3D widget mesh (Option B, deferred).
 *
 * This module is the pure core: the placement data model + its defensive
 * normalizer, the distance→visibility (opacity/scale) curve, and the NDC→screen
 * pixel mapping. No DOM, no Three — the runtime {@link WorldUiSubsystem} owns the
 * actual `Vector3.project(camera)` call and DOM transforms, and reuses these so
 * the math stays headless-testable.
 */

/** Local 3-tuple (mirrors `engine/scene/layout.ts`'s `Vec3`, kept local to avoid an import cycle). */
export type Vec3 = [number, number, number];

/**
 * Where a world widget is pinned. A fixed {@link WorldUiWidgetAnchor.worldPos}, or
 * an {@link WorldUiWidgetAnchor.entityId} the runtime resolves to a tracked entity's
 * live world position each frame (socket anchors are a later phase). `offset3d`
 * lifts the anchor in world space (e.g. above an actor's origin).
 */
export interface WorldUiWidgetAnchor {
  /** Fixed world-space point `[x, y, z]`; the fallback when no `entityId` is set. */
  worldPos: Vec3;
  /** Entity to track (e.g. `"actor:0"`, `"character:1"`): its live position wins over `worldPos`. */
  entityId?: string;
  /** World-space offset `[x, y, z]` added after the anchor resolves. */
  offset3d?: Vec3;
}

/**
 * A placed world-space UI widget: which `*.ui.json` asset to render and where to
 * pin it. Rendered screen-space (Option A) as a DOM billboard; `space` is fixed
 * to `"screen"` for now (Option B "world" is deferred).
 */
export interface WorldUiWidget {
  /** false keeps it in the persistent level when the level is World Partitioned (OPEN_WORLD_PLAN Faz 5) */
  spatiallyLoaded?: boolean;
  /** UI Widget asset id (a manifest `ui` asset) rendered as the billboard. */
  widget: string;
  anchor: WorldUiWidgetAnchor;
  /** Render space; only `"screen"` (projected DOM) is implemented in this phase. */
  space?: "screen";
  /** Screen-space pixel offset `[x, y]` applied after projection (e.g. lift the label above the anchor). */
  offset?: [number, number];
  /** Cull/fade past this world distance. Absent/≤0 means always visible. */
  maxDistance?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberTriple(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function normalizeAnchor(value: unknown): WorldUiWidgetAnchor {
  const anchor: WorldUiWidgetAnchor = { worldPos: [0, 0, 0] };
  if (isPlainObject(value)) {
    if (isNumberTriple(value.worldPos)) {
      anchor.worldPos = [value.worldPos[0], value.worldPos[1], value.worldPos[2]];
    }
    if (typeof value.entityId === "string" && value.entityId.length > 0) {
      anchor.entityId = value.entityId;
    }
    if (isNumberTriple(value.offset3d)) {
      anchor.offset3d = [value.offset3d[0], value.offset3d[1], value.offset3d[2]];
    }
  }
  return anchor;
}

function normalizeOffset(value: unknown): [number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]];
  }
  return undefined;
}

/** Defensively coerces arbitrary JSON into a {@link WorldUiWidget}, or null when unusable. */
export function normalizeWorldWidget(value: unknown): WorldUiWidget | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.widget !== "string" || value.widget.length === 0) return null;
  const out: WorldUiWidget = { widget: value.widget, anchor: normalizeAnchor(value.anchor) };
  if (value.spatiallyLoaded === false) out.spatiallyLoaded = false;
  const offset = normalizeOffset(value.offset);
  if (offset) out.offset = offset;
  if (typeof value.maxDistance === "number" && Number.isFinite(value.maxDistance) && value.maxDistance > 0) {
    out.maxDistance = value.maxDistance;
  }
  return out;
}

/** Normalizes a `worldWidgets` array, dropping any unusable entry. */
export function normalizeWorldWidgets(value: unknown): WorldUiWidget[] {
  if (!Array.isArray(value)) return [];
  const out: WorldUiWidget[] = [];
  for (const item of value) {
    const widget = normalizeWorldWidget(item);
    if (widget) out.push(widget);
  }
  return out;
}

/** The default world distance a widget renders at scale 1 (perspective shrink pivots here). */
export const DEFAULT_WORLD_WIDGET_REFERENCE_DISTANCE = 8;
/** Fraction of `maxDistance` over which the widget fades out (the last 20%). */
export const WORLD_WIDGET_FADE_FRACTION = 0.2;
const DEFAULT_MIN_SCALE = 0.4;
const DEFAULT_MAX_SCALE = 1.6;

/** Resolved per-frame presentation of a world widget. */
export interface WorldUiWidgetVisibility {
  /** False when fully culled past `maxDistance` (the runtime hides the element). */
  visible: boolean;
  /** Fade applied as CSS opacity, 0..1. */
  opacity: number;
  /** Size multiplier from perspective: 1 at the reference distance, clamped at both ends. */
  scale: number;
}

export interface WorldUiWidgetVisibilityOptions {
  /** Cull/fade distance; ≤0 (or absent) means never cull. */
  maxDistance?: number;
  /** World distance mapped to scale 1 (default {@link DEFAULT_WORLD_WIDGET_REFERENCE_DISTANCE}). */
  referenceDistance?: number;
  /** Lower scale clamp (default 0.4). */
  minScale?: number;
  /** Upper scale clamp (default 1.6). */
  maxScale?: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Maps a camera→anchor `distance` to a billboard's {@link WorldUiWidgetVisibility}:
 * a perspective `scale` (reference/distance, clamped) and an `opacity` that holds
 * full until the last {@link WORLD_WIDGET_FADE_FRACTION} of `maxDistance`, then
 * fades to 0 (and `visible:false` at/over `maxDistance`). With no `maxDistance`
 * the widget never culls.
 */
export function resolveWorldWidgetVisibility(
  distance: number,
  options: WorldUiWidgetVisibilityOptions = {},
): WorldUiWidgetVisibility {
  const d = Number.isFinite(distance) && distance > 0 ? distance : 0;
  const maxDistance = options.maxDistance ?? 0;

  let visible = true;
  let opacity = 1;
  if (maxDistance > 0) {
    if (d >= maxDistance) {
      visible = false;
      opacity = 0;
    } else {
      const fadeStart = maxDistance * (1 - WORLD_WIDGET_FADE_FRACTION);
      opacity = d <= fadeStart ? 1 : clamp((maxDistance - d) / (maxDistance - fadeStart), 0, 1);
    }
  }

  const reference = options.referenceDistance ?? DEFAULT_WORLD_WIDGET_REFERENCE_DISTANCE;
  const minScale = options.minScale ?? DEFAULT_MIN_SCALE;
  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;
  const rawScale = d > 0 ? reference / d : maxScale;
  const scale = clamp(rawScale, minScale, maxScale);

  return { visible, opacity, scale };
}

/** A projected screen position (pixels) plus whether the point is in front of the camera. */
export interface ScreenProjection {
  /** Pixel x within the viewport. */
  x: number;
  /** Pixel y within the viewport (top-left origin). */
  y: number;
  /** True when the anchor is in front of the camera (NDC z ≤ 1); behind → hide. */
  inFront: boolean;
}

/**
 * Maps a clip/NDC coordinate (each axis in [-1, 1], `ndcZ` from `Vector3.project`)
 * to viewport pixels. Pure so the projection mapping is unit-tested without Three;
 * the runtime computes the NDC via `Vector3.project(camera)` and passes it here.
 */
export function ndcToScreen(
  ndcX: number,
  ndcY: number,
  ndcZ: number,
  width: number,
  height: number,
): ScreenProjection {
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (-ndcY * 0.5 + 0.5) * height,
    inFront: ndcZ <= 1,
  };
}
