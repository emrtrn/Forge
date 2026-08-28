import type { BrushShape, LayoutBlockingVolume, Vec3 } from "./layout";
import type { AssetCollisionDef, NavigationRole } from "./collision";

/**
 * Render-agnostic Blocking Volume model: resolved settings + defaults, shared by
 * the editor view-models, the save validator, and the three.js render binding
 * (`engine/render-three/blockingVolume.ts`). Kept free of three.js so editor core
 * and the validator can read it without pulling in the renderer.
 *
 * A Blocking Volume is the web/three counterpart to Unreal's BlockingVolume / brush
 * volumes: a parametric primitive (box / cylinder / cone / sphere) used for blockout
 * and grey-boxing. It is a **placed actor with a transform** plus its own brush
 * `size`, so it can be reshaped and resized numerically — there can be many.
 */
export const BRUSH_SHAPES: readonly BrushShape[] = ["box", "cylinder", "cone", "sphere"];

export function isBrushShape(value: unknown): value is BrushShape {
  return typeof value === "string" && (BRUSH_SHAPES as readonly string[]).includes(value);
}

export interface ResolvedBlockingVolume {
  name: string;
  hidden: boolean;
  brushShape: BrushShape;
  /** Brush dimensions in world units, canonical per shape (see {@link canonicalBrushSize}). */
  size: Vec3;
  /** Radial segment count for cylinder/cone brushes (ignored by box/sphere). */
  brushSides: number;
  /** Draw as a solid grey-box in Play (off = invisible-but-blocking). */
  renderInGame: boolean;
  /** Editor brush tint (hex `#rrggbb`). */
  color: string;
  /** AI navigation interpretation; `walkable` makes a horizontal box a deck. */
  navigationRole: NavigationRole;
}

/** Default brush size: a ~4 m blockout cube at the ~1u≈2m scene scale. */
export const DEFAULT_BRUSH_SIZE: Vec3 = [2, 2, 2];

/** Default radial segment count for cylinder/cone brushes (smooth-ish barrel). */
export const DEFAULT_BRUSH_SIDES = 24;

/** A cylinder/cone brush can look this coarse (triangular prism) at the minimum. */
export const MIN_BRUSH_SIDES = 3;
export const MAX_BRUSH_SIDES = 128;

export const BLOCKING_VOLUME_DEFAULTS: ResolvedBlockingVolume = {
  name: "Blocking Volume",
  hidden: false,
  brushShape: "box",
  size: [...DEFAULT_BRUSH_SIZE],
  brushSides: DEFAULT_BRUSH_SIDES,
  renderInGame: false,
  // Unreal's brush wireframe orange.
  color: "#ff8c1a",
  navigationRole: "auto",
};

/** Clamps a radial-segment count to the `[MIN, MAX]` integer range. */
export function clampBrushSides(sides: number): number {
  if (!Number.isFinite(sides)) return DEFAULT_BRUSH_SIDES;
  return Math.min(MAX_BRUSH_SIDES, Math.max(MIN_BRUSH_SIDES, Math.round(sides)));
}

/**
 * Normalises a brush `size` to its shape's canonical form so the rendered brush
 * and the collider (which reads the same `size`) always agree:
 * - **box** keeps all three axes `[x, y, z]`;
 * - **sphere** is a single diameter `[d, d, d]` (X drives it);
 * - **cylinder / cone** are `[diameter, height, diameter]` (X drives the radius).
 */
export function canonicalBrushSize(shape: BrushShape, size: Vec3): Vec3 {
  switch (shape) {
    case "box":
      return [size[0], size[1], size[2]];
    case "sphere":
      return [size[0], size[0], size[0]];
    case "cylinder":
    case "cone":
      return [size[0], size[1], size[0]];
  }
}

/** Fills every Blocking Volume field with its default, decoupled from the layout. */
export function resolveBlockingVolume(
  actor: LayoutBlockingVolume | null | undefined,
): ResolvedBlockingVolume {
  const defaults = BLOCKING_VOLUME_DEFAULTS;
  if (!actor) return { ...defaults, size: [...defaults.size] };
  const brushShape = isBrushShape(actor.brushShape) ? actor.brushShape : defaults.brushShape;
  const rawSize: Vec3 = actor.size ? [...actor.size] : [...defaults.size];
  return {
    name: actor.name ?? defaults.name,
    hidden: actor.hidden ?? defaults.hidden,
    brushShape,
    // Resolve to canonical form so an older/hand-edited non-uniform size still
    // renders and collides consistently for its shape.
    size: canonicalBrushSize(brushShape, rawSize),
    brushSides: actor.brushSides !== undefined ? clampBrushSides(actor.brushSides) : defaults.brushSides,
    renderInGame: actor.renderInGame ?? defaults.renderInGame,
    color: actor.color ?? defaults.color,
    navigationRole: actor.navigationRole ?? defaults.navigationRole,
  };
}

/** A stable, collision-free id for a new blocking volume (`blocking-volume-<n>`). */
export function uniqueBlockingVolumeId(volumes: LayoutBlockingVolume[]): string {
  const existing = new Set(volumes.map((volume) => volume.id));
  let index = 1;
  while (existing.has(`blocking-volume-${index}`)) index += 1;
  return `blocking-volume-${index}`;
}

/** A unique display name for a new blocking volume, suffixing on collision. */
export function uniqueBlockingVolumeName(
  baseName: string,
  volumes: LayoutBlockingVolume[],
): string {
  const existing = new Set(volumes.map((volume) => volume.name ?? volume.id));
  if (!existing.has(baseName)) return baseName;
  let index = 2;
  while (existing.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

/**
 * Asset-level collision for a blocking volume: one solid primitive matching the
 * brush shape, sized to the brush `size` (full extents). Mirrors
 * {@link shapePrimitiveCollisionDef} in `engine/scene/shapes.ts`. The runtime bakes
 * the placement scale into this primitive, so the collider tracks the rendered
 * brush exactly.
 */
export function blockingVolumeCollisionDef(
  shape: BrushShape,
  size: Vec3,
  navigationRole: NavigationRole = "auto",
): AssetCollisionDef {
  const solid: Vec3 = [size[0], size[1], size[2]];
  return {
    primitives: [{ shape, size: solid }],
    complexity: "projectDefault",
    preset: "blockAll",
    ...(navigationRole === "auto" ? {} : { navigationRole }),
  };
}
