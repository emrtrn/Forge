/*
 * Shared inline-SVG icon set for the editor shell (EDITOR_UI_REDESIGN_PLAN
 * Faz 0). Lives in the DEV-gated editor chunk alongside EditorUi and the panel
 * modules, so it never reaches the game build. All icons use `currentColor` so
 * they inherit the surrounding text color and the design tokens automatically.
 *
 * The toolbar-specific glyphs (save/undo/play/…) stay in EditorUi's own
 * TOOLBAR_ICONS map; this module holds the broader set the redesign introduces
 * (actor-type icons, eye/lock, filter, gear, folder, search, hamburger,
 * chevrons, viewport controls) so the outliner / details / content panels can
 * share one source instead of duplicating markup or leaning on emoji.
 */

/** 16x16 stroked-icon prelude shared by most glyphs. */
const S = (path: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ` +
  `stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

/** Actor / asset type icons, keyed by a generic category slug. */
export const ACTOR_TYPE_ICONS = {
  /** Static / skeletal mesh — a cube. */
  mesh: S('<path d="M8 1.8l5.4 3v6.4L8 14.2l-5.4-3V4.8z"/><path d="M2.6 4.8L8 7.8l5.4-3M8 7.8v6.4"/>'),
  /** Primitive shapes — circle, triangle, and square. */
  shape: S('<circle cx="4.3" cy="5" r="2.3"/><path d="M9.8 2.7l2.8 4.8H7z"/><rect x="5.3" y="9" width="5.1" height="4.2" rx=".6"/>'),
  /** Cube primitive. */
  shapeCube: S('<path d="M8 1.8l5.4 3v6.4L8 14.2l-5.4-3V4.8z"/><path d="M2.6 4.8L8 7.8l5.4-3M8 7.8v6.4"/>'),
  /** Sphere primitive with latitude and longitude guides. */
  shapeSphere: S('<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c2 1.6 3 3.4 3 5.5s-1 3.9-3 5.5M8 2.5C6 4.1 5 5.9 5 8s1 3.9 3 5.5"/>'),
  /** Cylinder primitive. */
  shapeCylinder: S('<ellipse cx="8" cy="4" rx="4.6" ry="2"/><path d="M3.4 4v7.8M12.6 4v7.8"/><path d="M3.4 11.8c0 1.1 2.1 2 4.6 2s4.6-.9 4.6-2"/>'),
  /** Cone primitive. */
  shapeCone: S('<path d="M8 2.2L3.2 12"/><path d="M8 2.2L12.8 12"/><ellipse cx="8" cy="12" rx="4.8" ry="1.8"/>'),
  /** Plane primitive shown in perspective. */
  shapePlane: S('<path d="M1.8 9.8L6.3 4l7.9 2.2-4.5 5.8z"/><path d="M6.3 4l3.4 8M1.8 9.8l12.4-3.6"/>'),
  /** Light actor — a sun. */
  light: S('<circle cx="8" cy="8" r="2.6"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3"/>'),
  /** Sky / atmosphere — a stylized sun over horizon. */
  atmosphere: S('<circle cx="8" cy="7" r="3"/><path d="M1.8 12.5h12.4M3 7h1.4M11.6 7H13M8 1.8v1.4"/>'),
  /** Cloud layer. */
  cloud: S('<path d="M4.5 12h6.6a2.6 2.6 0 0 0 .2-5.18A3.4 3.4 0 0 0 5 6.2 2.9 2.9 0 0 0 4.5 12z"/>'),
  /** Post process volume — an aperture / lens. */
  postprocess: S('<circle cx="8" cy="8" r="5.6"/><path d="M8 2.4L5.4 7h5.2zM13.2 6.6l-2.6 4.5-2.6-4.5M4.7 12.4L7.3 8H2.1"/>'),
  /** World Environment (time of day / season / weather) — a crescent moon and a star. */
  worldEnvironment: S('<path d="M9.4 2.6a5.6 5.6 0 1 0 4 8.6A4.6 4.6 0 0 1 9.4 2.6z"/><path d="M12.4 2.2v2.2M11.3 3.3h2.2"/>'),
  /** Reflection capture — concentric ring. */
  reflection: S('<circle cx="8" cy="8" r="5.6"/><path d="M8 2.6a5.4 5.4 0 0 1 0 10.8"/>'),
  /** Sound cue / audio actor — a speaker. */
  sound: S('<path d="M3 6v4h2.2L9 12.6V3.4L5.2 6z"/><path d="M11 6.2a2.6 2.6 0 0 1 0 3.6"/>'),
  /** UI widget actor — a framed panel. */
  widget: S('<rect x="2.6" y="3.2" width="10.8" height="9.6" rx="1.2"/><path d="M2.6 6.2h10.8M5.4 6.2v6.6"/>'),
  /** Volume / blocking volume — a wireframe box. */
  volume: S('<path d="M3 4.6l5-2.4 5 2.4v6.8l-5 2.4-5-2.4z"/><path d="M3 4.6l5 2.4 5-2.4M8 7v6.8"/>'),
  /** Terrain / landscape. */
  terrain: S('<path d="M1.8 12.5l3.6-6 2.4 3.4 2-3 3.4 5.6z"/>'),
  /** Character / pawn — a person. */
  character: S('<circle cx="8" cy="5" r="2.4"/><path d="M3.4 13.2a4.6 4.6 0 0 1 9.2 0z"/>'),
  /** Gameplay / blueprint node — connected nodes. */
  gameplay: S('<rect x="2.4" y="6" width="4" height="4" rx="1"/><rect x="9.6" y="3" width="4" height="4" rx="1"/><rect x="9.6" y="9" width="4" height="4" rx="1"/><path d="M6.4 8h1.6M11.6 7v2"/>'),
  /** Vehicle — a car side view on two wheels. */
  vehicle: S('<path d="M1.8 10.6V8.4l1.6-.4 1.8-2.6h4.6L12 8l2.2.5v2.1z"/><circle cx="4.6" cy="11" r="1.4"/><circle cx="11.4" cy="11" r="1.4"/>'),
  /** Spline — a curved path with endpoint and control markers. */
  spline: S('<path d="M2.5 12c1.1-7.3 9.9-7.3 11 0"/><circle cx="2.5" cy="12" r="1.2"/><circle cx="13.5" cy="12" r="1.2"/><circle cx="8" cy="5.2" r="1"/>'),
  /** Group / folder actor. */
  group: S('<path d="M2.4 4.6h4l1.2 1.4h6v6.4a.6.6 0 0 1-.6.6H3a.6.6 0 0 1-.6-.6z"/>'),
  /** Fallback / unknown type — a generic marker. */
  generic: S('<circle cx="8" cy="8" r="5.6"/><path d="M8 5.2v3.4M8 10.6v.1"/>'),
} as const;

export type ActorTypeIcon = keyof typeof ACTOR_TYPE_ICONS;

/** General UI control icons. */
export const UI_ICONS = {
  eye: S('<path d="M1.5 8S3.8 4 8 4s6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>'),
  eyeOff: S('<path d="M2.5 3.5l11 9M6.2 5.2A6.7 6.7 0 0 1 8 4c4.2 0 6.5 4 6.5 4a11 11 0 0 1-1.9 2.3M9.9 10.4A6.7 6.7 0 0 1 8 12c-4.2 0-6.5-4-6.5-4a11 11 0 0 1 2.7-2.9"/><path d="M6.6 7a2 2 0 0 0 2.6 2.6"/>'),
  lock: S('<rect x="3.6" y="7" width="8.8" height="6.4" rx="1.2"/><path d="M5.4 7V5.4a2.6 2.6 0 0 1 5.2 0V7"/><path d="M8 9.4v1.8"/>'),
  unlock: S('<rect x="3.6" y="7" width="8.8" height="6.4" rx="1.2"/><path d="M5.4 7V5.4a2.6 2.6 0 0 1 5-1.5"/><path d="M8 9.4v1.8"/>'),
  filter: S('<path d="M2.4 3.4h11.2l-4.3 5v4.2l-2.6 1.2V8.4z"/>'),
  gear: S('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6"/>'),
  folder: S('<path d="M2.4 4.6h4l1.2 1.4h6v6.4a.6.6 0 0 1-.6.6H3a.6.6 0 0 1-.6-.6z"/>'),
  folderOpen: S('<path d="M2.4 4.6h4l1.2 1.4h6v1.4H2.4z"/><path d="M2.4 7.4h11.9l-1.4 5.2a.6.6 0 0 1-.6.4H3a.6.6 0 0 1-.6-.6z"/>'),
  grid: S('<rect x="2.6" y="2.6" width="4.2" height="4.2" rx=".6"/><rect x="9.2" y="2.6" width="4.2" height="4.2" rx=".6"/><rect x="2.6" y="9.2" width="4.2" height="4.2" rx=".6"/><rect x="9.2" y="9.2" width="4.2" height="4.2" rx=".6"/>'),
  search: S('<circle cx="7" cy="7" r="4"/><path d="M10 10l3.4 3.4"/>'),
  hamburger: S('<path d="M2.6 4.5h10.8M2.6 8h10.8M2.6 11.5h10.8"/>'),
  add: S('<path d="M8 3.2v9.6M3.2 8h9.6"/>'),
  import: S('<path d="M8 2.6v7.2M5.2 7.2L8 10l2.8-2.8"/><path d="M3 12.4h10"/>'),
  kebab: S('<circle cx="8" cy="3.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="12.6" r="1.1" fill="currentColor" stroke="none"/>'),
  refresh: S('<path d="M13 8a5 5 0 1 1-1.4-3.5"/><path d="M13.2 3v2.6h-2.6"/>'),
  chevronRight: S('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  chevronLeft: S('<path d="M10 3.5L5.5 8 10 12.5"/>'),
  chevronDown: S('<path d="M3.5 6L8 10.5 12.5 6"/>'),
  chevronUp: S('<path d="M3.5 10L8 5.5 12.5 10"/>'),
  arrowLeft: S('<path d="M13 8H3M6.5 4.5L3 8l3.5 3.5"/>'),
  arrowRight: S('<path d="M3 8h10M9.5 4.5L13 8l-3.5 3.5"/>'),
  star: S('<path d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6z"/>'),
  link: S('<path d="M6.6 9.4l2.8-2.8M6 5.4l.9-.9a2.4 2.4 0 0 1 3.4 3.4l-.9.9M10 10.6l-.9.9a2.4 2.4 0 0 1-3.4-3.4l.9-.9"/>'),
} as const;

/** Viewport overlay control icons (Faz 6 consumes these). */
export const VIEWPORT_ICONS = {
  pan: S('<path d="M8 2.4v11.2M2.4 8h11.2"/><path d="M8 2.4L6.4 4M8 2.4L9.6 4M8 13.6L6.4 12M8 13.6L9.6 12M2.4 8L4 6.4M2.4 8L4 9.6M13.6 8L12 6.4M13.6 8L12 9.6"/>'),
  orbit: S('<circle cx="8" cy="8" r="3"/><path d="M13.4 8c0 1.5-2.4 2.8-5.4 2.8S2.6 9.5 2.6 8"/><path d="M11.8 5v1.6h-1.6"/>'),
  frame: S('<path d="M2.6 5.2V3.2a.6.6 0 0 1 .6-.6h2M13.4 5.2V3.2a.6.6 0 0 0-.6-.6h-2M2.6 10.8v2a.6.6 0 0 0 .6.6h2M13.4 10.8v2a.6.6 0 0 1-.6.6h-2"/><rect x="6" y="6" width="4" height="4" rx=".6"/>'),
  fullscreen: S('<path d="M2.6 5.4V3.2a.6.6 0 0 1 .6-.6h2.2M13.4 5.4V3.2a.6.6 0 0 0-.6-.6h-2.2M2.6 10.6v2.2a.6.6 0 0 0 .6.6h2.2M13.4 10.6v2.2a.6.6 0 0 1-.6.6h-2.2"/>'),
} as const;
