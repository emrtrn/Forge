/**
 * Closed vocabularies shared by the World Recipe and region profiles (World
 * Builder plan v0.4 §13.4). Open-ended kinds (region, water, settlement type,
 * economy) are dotted tokens instead, so forks can add their own without an
 * engine change.
 */

export const ROAD_CLASSES = ["highway", "arterial", "collector", "local", "track", "path"] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const LAND_USES = [
  "residential", "commercial", "civic", "industrial", "agricultural", "open", "transport",
] as const;
export type LandUse = (typeof LAND_USES)[number];

/** Where a program entry prefers to stand inside its settlement (§13.5 L5). */
export const PROGRAM_SITINGS = ["center", "mainRoad", "edge", "downstream", "entrance", "any"] as const;
export type ProgramSiting = (typeof PROGRAM_SITINGS)[number];
