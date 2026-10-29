/**
 * What the World Builder recipe layer shows in the viewport (plan v0.4 T36,
 * T23) and what it drew. Shared by the session, the panel and the scene's
 * overlay; dependency-free so the session stays testable without three.
 */

export interface RecipeLayerOptions {
  /** The reference image laid over the ground. */
  underlay: boolean;
  /** Plan elements: settlements, road graph, water, regions, landmarks. */
  plan: boolean;
  /** Generated data: settlement cores, parcels, pads. */
  generated: boolean;
  /** Underlay opacity, 0..1. */
  opacity: number;
}

export const DEFAULT_RECIPE_LAYER_OPTIONS: Readonly<RecipeLayerOptions> = { underlay: true, plan: true, generated: true, opacity: 0.6 };

/**
 * `none`: the recipe has no reference image; `perspective`: its image is a
 * perspective view, which does not lie on the ground.
 */
export type UnderlayState = "none" | "hidden" | "perspective" | "loading" | "shown" | "error";

export interface RecipeLayerCounts {
  underlay: UnderlayState;
  /** Plan elements drawn, and how many of them are below the low-confidence threshold. */
  plan: number;
  lowConfidence: number;
  cores: number;
  parcels: number;
  pads: number;
}

export const EMPTY_RECIPE_LAYER_COUNTS: Readonly<RecipeLayerCounts> = { underlay: "none", plan: 0, lowConfidence: 0, cores: 0, parcels: 0, pads: 0 };
