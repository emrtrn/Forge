import type {
  BrushShape,
  LayoutAudio,
  LayoutBehavior,
  LayoutInteraction,
  LayoutLightActor,
  LayoutMetadata,
  LayoutMovingPlatform,
  LayoutParticleEmitter,
  LayoutPhysics,
  LayoutPostProcess,
  Vec3,
} from "@engine/scene/layout";
import type {
  CollisionEnabled,
  CollisionObjectChannel,
  CollisionPresetId,
  CollisionResponseMap,
  NavigationRole,
} from "@engine/scene/collision";
import type { Selection } from "./selection";

export interface EditableTransform {
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation: Vec3;
  /** Per-axis scale. */
  scale: Vec3;
}

/**
 * Resolved Sky Atmosphere fields for the Details panel (singleton actor). The
 * sun direction is owned by the directional Sun light and edited via its own
 * transform, not this panel. The global sky-light capture is authored here too,
 * replacing the old separate Reflection Environment actor.
 */
export interface EditableSky {
  name: string;
  hidden: boolean;
  rayleigh: number;
  turbidity: number;
  mie: number;
  mieDirectionalG: number;
  exposure: number;
  skyLightCapture: {
    intensity: number;
  };
}

/**
 * Resolved Exponential Height Fog fields for the Details panel (singleton actor).
 * Faz 1 is distance-based: `exp` mode uses `density`, `linear` mode uses
 * `start`/`end`.
 */
export interface EditableFog {
  name: string;
  hidden: boolean;
  mode: "exp" | "linear";
  color: string;
  density: number;
  start: number;
  end: number;
}

/**
 * Resolved static Cloud Layer fields for the Details panel (singleton actor). A
 * procedural cloud dome — coverage/density/softness/scale paint the noise,
 * `speed` drives the optional drift (0 = static).
 */
export interface EditableCloud {
  name: string;
  hidden: boolean;
  color: string;
  coverage: number;
  density: number;
  softness: number;
  scale: number;
  speed: number;
}

/**
 * Resolved Sphere Reflection Capture fields for the Details panel. Unlike the
 * environment singletons this is a placed actor with a transform; these
 * probe-specific settings ride alongside the transform in
 * {@link EditableSelection.reflectionCapture}.
 */
export interface EditableReflectionCapture {
  name: string;
  hidden: boolean;
  radius: number;
  intensity: number;
  resolution: number;
  near: number;
  far: number;
  parallax: boolean;
  priority: number;
}

/**
 * Resolved Reflective Surface fields for the Details panel. Like the Sphere
 * Reflection Capture this is a placed actor with a transform; the material
 * reference + reflection-blend settings ride alongside in
 * {@link EditableSelection.reflectiveSurface}.
 */
export interface EditableReflectiveSurface {
  name: string;
  hidden: boolean;
  material: string | null;
  reflectionStrength: number;
  fresnelPower: number;
  fresnelBias: number;
  distortion: number;
  tint: string;
  resolution: number;
}

/**
 * Resolved world-space UI widget fields for the Details panel. A placed billboard
 * (`engine/ui/uiWorldWidget.ts`): its anchor world point rides in the shared
 * `position` transform field, while the widget reference + anchor/offset options
 * ride here in {@link EditableSelection.worldWidget}.
 */
export interface EditableWorldWidget {
  /** Referenced UI Widget asset id (a manifest `ui` asset). */
  widget: string;
  /** Entity anchor id (`actor:<i>` / `character:<i>`); empty = a fixed world point. */
  entityId: string;
  /** World-space offset `[x, y, z]` added after the anchor resolves. */
  offset3d: Vec3;
  /** Screen-space pixel offset `[x, y]` applied after projection. */
  offset: [number, number];
  /** Cull/fade distance in world units; 0 = never cull. */
  maxDistance: number;
}

/**
 * Resolved Blocking Volume fields for the Details panel. Like the Reflective
 * Surface this is a placed actor with a transform; the brush settings ride
 * alongside in {@link EditableSelection.blockingVolume}.
 */
export interface EditableBlockingVolume {
  name: string;
  hidden: boolean;
  brushShape: BrushShape;
  size: Vec3;
  /** Radial segment count for cylinder/cone brushes (ignored by box/sphere). */
  brushSides: number;
  renderInGame: boolean;
  color: string;
  /** AI navigation interpretation; `walkable` makes a horizontal box a deck. */
  navigationRole: NavigationRole;
}

/**
 * Resolved AI Navigation Volume fields for the Details panel. It is a placed box
 * volume whose transform + size define the pathfinding bounds.
 */
export interface EditableAiNavigationVolume {
  name: string;
  hidden: boolean;
  size: Vec3;
  agentRadius: number;
  clearancePadding: number;
}

/** Resolved Target Point fields for AI patrol authoring details. */
export interface EditableTargetPoint {
  id: string;
  name: string;
  hidden: boolean;
  startPoint: boolean;
  nextTargetPoint: string;
  waitTime: number;
  acceptanceRadius: number;
  speedOverride: number | null;
  patrolTag: string;
  color: string;
}

/** Resolved global Post Process fields for the Details panel. */
export interface EditablePostProcess {
  name: string;
  hidden: boolean;
  exposure: number;
  toneMapping: NonNullable<LayoutPostProcess["toneMapping"]>;
  antialias: NonNullable<LayoutPostProcess["antialias"]>;
  bloom: {
    enabled: boolean;
    threshold: number;
    intensity: number;
    radius: number;
  };
  vignette: {
    enabled: boolean;
    intensity: number;
    offset: number;
  };
  chromaticAberration: {
    enabled: boolean;
    amount: number;
  };
  grain: {
    enabled: boolean;
    intensity: number;
  };
  dof: {
    enabled: boolean;
    focusDistance: number;
    aperture: number;
    maxBlur: number;
  };
  ao: {
    enabled: boolean;
    radius: number;
    intensity: number;
  };
  saturation: number;
  contrast: number;
  temperature: number;
  tint: number;
}

export interface EditableSelection {
  id: string;
  kind: Selection["kind"];
  assetId: string;
  /** Asset catalog/manifest category, resolved for display. Empty when unknown. */
  category: string;
  label: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  /** Local-space authoring pivot offset; `[0,0,0]` means the model origin. */
  pivot: Vec3;
  scaleLocked: boolean;
  locked: boolean;
  /** Resolved cast-shadow flag (absent in data means true). */
  castShadow: boolean;
  /** Resolved collision flag (absent in data means true). */
  collision: boolean;
  /** Per-placement collision preset override; absent means inherit asset default. */
  collisionPreset?: CollisionPresetId;
  /** Per-placement collision enabled override; absent means inherit preset/asset default. */
  collisionEnabled?: CollisionEnabled;
  /** Per-placement object channel override; absent means inherit preset/asset default. */
  objectType?: CollisionObjectChannel;
  /** Per-placement custom response overrides. */
  responses?: CollisionResponseMap;
  /** Per-placement physical material override. */
  physicalMaterialId?: string;
  /** Per-placement AI navigation role override; absent means inherit asset default. */
  navigationRole?: NavigationRole;
  /** Per-placement overlap-event override. */
  generateOverlapEvents?: boolean;
  /** Per-placement hit-event override. */
  simulationGeneratesHitEvents?: boolean;
  /** Per-placement material override. References a manifest material asset id. */
  materialSlot?: string;
  /** Dynamic rigid-body simulation in Play mode. */
  simulatePhysics: boolean;
  /** Runtime physics settings for the selected object. */
  physics: LayoutPhysics;
  /** Project-defined gameplay metadata (schema-driven); empty when none set. */
  metadata: LayoutMetadata;
  /** Authored audio cue; absent when the object has no Audio component. */
  audio?: LayoutAudio;
  /** Authored runtime behavior reference; absent when the object has no Behavior component. */
  behavior?: LayoutBehavior;
  /** Authored particle emitter; absent when the object has no Particle component. */
  particle?: LayoutParticleEmitter;
  /** Authored interaction marker; absent when the object has no Interaction component. */
  interaction?: LayoutInteraction;
  /** Authored moving-platform motion; absent when the object has no Moving Platform component. */
  movingPlatform?: LayoutMovingPlatform;
  /**
   * Play-mode animation clip for a directly-placed skeletal mesh; present only
   * when `kind === "character"`. Mirrors {@link LayoutCharacter.animation}.
   */
  animation?: string;
  lightType?: LayoutLightActor["type"];
  color?: string;
  intensity?: number;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
  /** Planar Reflection render-target resolution; present only when `kind === "reflectionPlane"`. */
  reflectionResolution?: number;
  /** Resolved Sky Atmosphere settings; present only when `kind === "sky"`. */
  sky?: EditableSky;
  /** Resolved Height Fog settings; present only when `kind === "fog"`. */
  fog?: EditableFog;
  /** Resolved Cloud Layer settings; present only when `kind === "cloud"`. */
  cloud?: EditableCloud;
  /** Resolved Sphere Reflection Capture settings; present only when `kind === "reflectionCapture"`. */
  reflectionCapture?: EditableReflectionCapture;
  /** Resolved Reflective Surface settings; present only when `kind === "reflectiveSurface"`. */
  reflectiveSurface?: EditableReflectiveSurface;
  /** Resolved Blocking Volume settings; present only when `kind === "blockingVolume"`. */
  blockingVolume?: EditableBlockingVolume;
  /** Resolved AI Navigation Volume settings; present only when `kind === "aiNavigationVolume"`. */
  aiNavigationVolume?: EditableAiNavigationVolume;
  /** Resolved Target Point settings; present only when `kind === "targetPoint"`. */
  targetPoint?: EditableTargetPoint;
  /** Generic Spline actor presentation settings; points remain authored in local space. */
  spline?: {
    id: string;
    closed: boolean;
    pointCount: number;
    debugVisible: boolean;
    debugColor: string;
    debugResolution: number;
    showPointIds: boolean;
  };
  /** Resolved Post Process settings; present only when `kind === "post"`. */
  post?: EditablePostProcess;
  /** Resolved world-space UI widget settings; present only when `kind === "worldWidget"`. */
  worldWidget?: EditableWorldWidget;
}

export interface EditableSceneObject extends EditableSelection {
  selected: boolean;
  hidden: boolean;
  locked: boolean;
  /** Flat group id shared by grouped objects (move together). */
  groupId?: string | undefined;
  /** Stable id used to reference this object as a parent. */
  nodeId?: string | undefined;
  /** Parent reference (the parent's nodeId). */
  parentId?: string | undefined;
}

export interface EditorWorldSettings {
  lightingMode: "Dynamic";
  shadowFilter: "PCF Soft";
  staticObjectsCastShadow: boolean;
  staticObjectsReceiveShadow: boolean;
  backgroundColor: string;
  ambientColor: string;
  ambientIntensity: number;
  /** World Y threshold that respawns the possessed pawn when crossed. */
  killZ: number;
  /** Selected runtime Game Mode id (resolved to a default when unknown/absent). */
  gameMode: string;
}

export interface EditorProjectInfo {
  manifest: {
    publicDir: string;
    editor: {
      /** Active scene the editor loads + saves (`/__open-level` repoints this). */
      defaultScene: string;
      assetManifest: string;
      previewUrl?: string;
    };
  };
  rootName: string;
  assetRoot: string;
}

export interface EditorSnapSettings {
  move: number;
  rotate: number;
  scale: number;
  moveEnabled: boolean;
  rotateEnabled: boolean;
  scaleEnabled: boolean;
}

export function selectionToTransform(selection: EditableSelection): EditableTransform {
  return {
    position: [...selection.position],
    rotation: [...selection.rotation],
    scale: [...selection.scale],
  };
}

export function worldSettingsEqual(
  left: EditorWorldSettings,
  right: EditorWorldSettings,
): boolean {
  return (
    left.staticObjectsCastShadow === right.staticObjectsCastShadow &&
    left.staticObjectsReceiveShadow === right.staticObjectsReceiveShadow &&
    left.backgroundColor.toLowerCase() === right.backgroundColor.toLowerCase() &&
    left.ambientColor.toLowerCase() === right.ambientColor.toLowerCase() &&
    left.ambientIntensity === right.ambientIntensity &&
    left.killZ === right.killZ &&
    left.gameMode === right.gameMode
  );
}
