import type {
  CollisionEnabled,
  CollisionObjectChannel,
  CollisionPresetId,
  CollisionResponseMap,
  NavigationRole,
} from "./collision";
import type { WorldUiWidget } from "../ui/uiWorldWidget";

export type Vec3 = [number, number, number];
export type LayoutLightType = "directional" | "point" | "spot";
/**
 * Brush shape of a Blocking Volume (à la Unreal's brush builders). Faz 1 supports
 * the four primitive builders; stair/spiral builders are intentionally out of scope.
 */
export type BrushShape = "box" | "cylinder" | "cone" | "sphere";

/**
 * Generic, project-defined gameplay metadata value. The base editor stays
 * schema-agnostic: it stores whatever scalar/list a project's metadata schema
 * declares without knowing the gameplay semantics.
 */
export type MetadataValue = string | number | boolean | string[];
export type LayoutMetadata = Record<string, MetadataValue>;

/**
 * Authoring reference to a runtime behavior script: a registered `script` id and
 * optional JSON-ish `params`. The runtime behavior registry resolves the id to
 * an update function; the saved layout only stores the reference.
 */
export interface LayoutBehavior {
  script: string;
  params?: LayoutMetadata;
}

/**
 * Authors a kinematic moving platform: the object ping-pongs from its placed
 * position to `position + offset` and back at `speed` units/s. Its presence makes
 * the collider movable (kinematic) instead of static, so the runtime carries a
 * character standing on it and excludes it from the cached static blockers.
 */
export interface LayoutMovingPlatform {
  /** Far-end offset from the placed position (world units). */
  offset: Vec3;
  /** Travel speed along the segment (units/s). */
  speed: number;
  /** Initial position along the segment, 0..1 (0 = start). Absent means 0. */
  startPhase?: number;
}

export interface LayoutAudio {
  /**
   * Raw sound clip ID (manifest `sound` asset). Legacy field; use `sourceId` +
   * `sourceType` for new authoring. When `sourceType` is absent or `"sound"`,
   * `clipId` is the active reference.
   */
  clipId: string;
  /**
   * Explicit source asset ID when overriding the legacy `clipId` path.
   * Use together with `sourceType` to point at a Sound Cue or raw sound.
   */
  sourceId?: string;
  /** Distinguishes a raw `"sound"` asset from a `"soundCue"` graph asset. */
  sourceType?: "sound" | "soundCue";
  volume?: number;
  /** Pitch / playback-rate multiplier (1 = unchanged). Absent means the runtime default. */
  pitch?: number;
  loop?: boolean;
  spatial?: boolean;
  /**
   * Spatial attenuation (only meaningful when `spatial` is true). These map
   * directly to the runtime `PannerNode`: `refDistance` is the radius of full
   * volume, `maxDistance` clamps falloff, `rolloff` is the falloff factor.
   * Absent fields fall back to the runtime defaults.
   */
  refDistance?: number;
  maxDistance?: number;
  rolloff?: number;
  /** Play this cue automatically when the scene loads (ambient). Absent means false. */
  autoPlay?: boolean;
}

/**
 * Authoring reference to a particle/VFX emitter: a manifest `effectId` plus a
 * small set of per-instance overrides. Behaviour (spawn/lifetime/velocity/…)
 * lives in the effect asset (`.effect.json`) — the single source of truth — so a
 * reused effect looks the same in every scene. Overrides only re-skin/re-time
 * this one placement: `enabled` (default true) toggles the emitter, `autoPlay`
 * plays it on scene load, `scale` uniformly grows the effect, `tint` recolours
 * it, and `loop` forces looping on/off for this instance. The runtime VFX system
 * resolves `effectId` and simulates (see `engine/render-three/particleEffect`).
 */
export interface LayoutParticleEmitter {
  effectId: string;
  enabled?: boolean;
  autoPlay?: boolean;
  scale?: number;
  tint?: string;
  loop?: boolean;
}

/**
 * Authored interaction marker: an `action` id the runtime interprets, with an
 * optional player-facing `prompt`, default `enabled` flag, a `requires` gate
 * and a `cooldown` (seconds). Project game rules interpret these at runtime.
 */
export interface LayoutInteraction {
  action: string;
  prompt?: string;
  enabled?: boolean;
  requires?: string;
  cooldown?: number;
}

export type LayoutPhysicsAxisLocks = [boolean, boolean, boolean];

export interface LayoutPhysics {
  /** Override mass in kilograms. Absent lets the physics backend derive mass from the collider. */
  massKg?: number;
  /** Linear velocity damping. Absent means the runtime default. */
  linearDamping?: number;
  /** Angular velocity damping. Absent means the runtime default. */
  angularDamping?: number;
  /** Whether world gravity affects this body. Absent means true. */
  enableGravity?: boolean;
  /** Per-axis translation locks, X/Y/Z. Absent means all axes are free. */
  lockPosition?: LayoutPhysicsAxisLocks;
  /** Per-axis rotation locks, X/Y/Z. Absent means all axes are free. */
  lockRotation?: LayoutPhysicsAxisLocks;
}

export interface LayoutPlacement {
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  /** Stable id assigned when this object becomes a parent (referenced by children). */
  nodeId?: string;
  /** This object's parent, referencing the parent's `nodeId`. */
  parentId?: string;
  position: Vec3;
  /** Legacy Y-only rotation in degrees. Read as a fallback when `rotation` is absent. */
  rotationYDeg?: number;
  /** Full Euler rotation (XYZ order) in degrees. Preferred over `rotationYDeg`. */
  rotation?: Vec3;
  /**
   * Authoring pivot: a point in the object's local (model) space that rotation
   * and scale gizmos act around. Absent/`[0,0,0]` means the model origin.
   * Editor-only; runtime should consume the baked world transform.
   */
  pivot?: Vec3;
  /** Uniform scalar (legacy) or per-axis scale. */
  scale?: number | Vec3;
  /** Editor hint: keep scale axes proportional when editing. */
  scaleLocked?: boolean;
  /** Legacy/runtime hint. Editor renderer controls instanced static shadows centrally. */
  castShadow?: boolean;
  /** Runtime hint: object participates in collision. Absent means true (default on). */
  collision?: boolean;
  /** Per-placement collision preset override; absent means inherit the asset default. */
  collisionPreset?: CollisionPresetId;
  /** Per-placement collision enabled override; absent means inherit the preset/asset default. */
  collisionEnabled?: CollisionEnabled;
  /** Per-placement object channel override; absent means inherit the preset/asset default. */
  objectType?: CollisionObjectChannel;
  /** Per-placement response overrides, mainly for Custom collision. */
  responses?: CollisionResponseMap;
  /** Per-placement physical material override. */
  physicalMaterialId?: string;
  /** Per-placement AI navigation role override; absent means inherit the asset default. */
  navigationRole?: NavigationRole;
  /** Emit begin/end overlap events for sensors. Absent means inherit/default true. */
  generateOverlapEvents?: boolean;
  /** Emit hit events while simulating physics. Absent means inherit/default true. */
  simulationGeneratesHitEvents?: boolean;
  /** Per-placement material override. References a manifest material asset id. */
  materialSlot?: string;
  /** Runtime hint: collider is a non-blocking sensor (trigger zone). Absent means false. */
  sensor?: boolean;
  /** Runtime hint: this object is a dynamic rigid body in Play mode. Absent means false. */
  simulatePhysics?: boolean;
  /** Runtime physics body settings used when this object simulates physics. */
  physics?: LayoutPhysics;
  /** Project-defined gameplay metadata (schema-driven; omitted when empty). */
  metadata?: LayoutMetadata;
  /** Runtime behavior script reference (resolved by the behavior registry). */
  behavior?: LayoutBehavior;
  /** Runtime audio cue attached to this object. */
  audio?: LayoutAudio;
  /** Runtime particle/VFX emitter attached to this object. */
  particle?: LayoutParticleEmitter;
  /** Authored interaction marker (interpreted by runtime game rules). */
  interaction?: LayoutInteraction;
  /** Kinematic moving-platform motion; presence makes the collider movable. */
  movingPlatform?: LayoutMovingPlatform;
}

export interface LayoutModelInstances {
  assetId: string;
  placements: LayoutPlacement[];
}

/**
 * A placed instance of an Actor Script class (`*.actor.json`). Unlike a
 * {@link LayoutPlacement} (which references a mesh asset directly), an actor
 * instance references a reusable *class* via `classRef` and carries only its
 * world transform + hierarchy/flags. The runtime resolves the class and spawns
 * its component template + event bindings (see `engine/scene/actorInstance.ts`).
 *
 * Sınıf ≠ Instance: the class is authored once and placed many times. A narrow
 * level-owned AI patrol override is supported because spline ids belong to the
 * level, not to a reusable Actor Script class.
 */
export interface LayoutActorInstance {
  /** Path to the `*.actor.json` class-asset, relative to the public root. */
  classRef: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  /** Stable id assigned when this object becomes a parent (referenced by children). */
  nodeId?: string;
  /** This object's parent, referencing the parent's `nodeId`. */
  parentId?: string;
  position: Vec3;
  /** Legacy Y-only rotation in degrees. Read as a fallback when `rotation` is absent. */
  rotationYDeg?: number;
  /** Full Euler rotation (XYZ order) in degrees. Preferred over `rotationYDeg`. */
  rotation?: Vec3;
  /** Uniform scalar (legacy) or per-axis scale. */
  scale?: number | Vec3;
  /** Editor hint: keep scale axes proportional when editing. */
  scaleLocked?: boolean;
  /**
   * Level-owned values overriding declared Actor Script variable defaults.
   * Keys are validated against the resolved class at runtime; the layout stays
   * project-agnostic and never names a game's marker vocabulary.
   */
  variableOverrides?: LayoutMetadata;
  /** Optional level-owned override merged into this actor's AIController at spawn. */
  patrolRoute?: AiPatrolRoute;
}

export interface LayoutCharacter {
  assetId: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  /** Stable id assigned when this object becomes a parent (referenced by children). */
  nodeId?: string;
  /** This object's parent, referencing the parent's `nodeId`. */
  parentId?: string;
  position: Vec3;
  /** Legacy Y-only rotation in degrees. Read as a fallback when `rotation` is absent. */
  rotationYDeg?: number;
  /** Full Euler rotation (XYZ order) in degrees. Preferred over `rotationYDeg`. */
  rotation?: Vec3;
  /**
   * Authoring pivot: a point in the object's local (model) space that rotation
   * and scale gizmos act around. Absent/`[0,0,0]` means the model origin.
   * Editor-only; runtime should consume the baked world transform.
   */
  pivot?: Vec3;
  /** Uniform scalar (legacy) or per-axis scale. */
  scale?: number | Vec3;
  /** Editor hint: keep scale axes proportional when editing. */
  scaleLocked?: boolean;
  /** Runtime hint: character casts shadows. Absent means true (default on). */
  castShadow?: boolean;
  /** Runtime hint: object participates in collision. Absent means true (default on). */
  collision?: boolean;
  /** Per-placement collision preset override; absent means inherit the asset default. */
  collisionPreset?: CollisionPresetId;
  /** Per-placement collision enabled override; absent means inherit the preset/asset default. */
  collisionEnabled?: CollisionEnabled;
  /** Per-placement object channel override; absent means inherit the preset/asset default. */
  objectType?: CollisionObjectChannel;
  /** Per-placement response overrides, mainly for Custom collision. */
  responses?: CollisionResponseMap;
  /** Per-placement physical material override. */
  physicalMaterialId?: string;
  /** Emit begin/end overlap events for sensors. Absent means inherit/default true. */
  generateOverlapEvents?: boolean;
  /** Emit hit events while simulating physics. Absent means inherit/default true. */
  simulationGeneratesHitEvents?: boolean;
  /** Runtime hint: collider is a non-blocking sensor (trigger zone). Absent means false. */
  sensor?: boolean;
  /** Runtime hint: this object is a dynamic rigid body in Play mode. Absent means false. */
  simulatePhysics?: boolean;
  /** Runtime physics body settings used when this object simulates physics. */
  physics?: LayoutPhysics;
  /** Project-defined gameplay metadata (schema-driven; omitted when empty). */
  metadata?: LayoutMetadata;
  animation?: string;
  /** Runtime behavior script reference (resolved by the behavior registry). */
  behavior?: LayoutBehavior;
  /** Runtime audio cue attached to this object. */
  audio?: LayoutAudio;
  /** Runtime particle/VFX emitter attached to this object. */
  particle?: LayoutParticleEmitter;
  /** Authored interaction marker (interpreted by runtime game rules). */
  interaction?: LayoutInteraction;
}

/**
 * Authored gameplay-rules config (the runtime's minimal Game Framework). Pure
 * data the runtime hands to `normalizeGameRules` (src/game/gameRules.ts); engine
 * never imports the game-layer store, so this mirrors that config's shape.
 * Absent means the scene runs with no scoring/objective rules (the template
 * default). A concrete game authors this; the editor preserves it on save.
 */
export interface LayoutGameRules {
  /** Named scalars the rules track (score, lives, coins, …). */
  variables?: Array<{ id: string; initial?: number; label?: string }>;
  /** Collect/reach-N objectives. */
  objectives?: Array<{
    id: string;
    label?: string;
    target: number;
    initial?: number;
    optional?: boolean;
  }>;
  /** Optional round timer; `down` resolves `onExpire` at zero, `up` is a stopwatch. */
  timer?: {
    durationSeconds: number;
    direction?: "up" | "down";
    onExpire?: "win" | "lose";
  };
  /** Win when every required objective completes. Default: true iff objectives exist. */
  winWhenObjectivesComplete?: boolean;
  /** Lose when this variable's value reaches <= 0 (e.g. "lives"). */
  loseWhenVariableDepleted?: string;
}

export interface LayoutWorldSettings {
  /** Central static/instanced shadow casting. Absent means false. */
  staticObjectsCastShadow?: boolean;
  /** Central static/instanced shadow receiving. Absent means true. */
  staticObjectsReceiveShadow?: boolean;
  /** Scene background color (hex). Absent means the default. */
  backgroundColor?: string;
  /** Ambient light color (hex). Absent means the default white. */
  ambientColor?: string;
  /** Ambient light intensity. Absent means 0 (no ambient). */
  ambientIntensity?: number;
  /** World gravity (units/s^2); negative Y pulls down. Absent means the default. */
  gravity?: Vec3;
  /** World Y threshold that kills/respawns the possessed pawn. Absent means the default. */
  killZ?: number;
  /**
   * Selected runtime Game Mode id (Unreal's GameMode analogue). Absent means the
   * built-in default camera mode; the runtime resolves unknown ids to that
   * default. Editor-authored; runtime-only behavior — never written back here by
   * a running session.
   */
  gameMode?: string;
  /**
   * UI Widget asset id (a manifest `ui` asset) shown as the persistent HUD on
   * boot. Absent means no HUD. The runtime mounts it click-through over the scene.
   */
  hudWidget?: string;
  /**
   * UI Widget asset id pushed as a modal pause screen when the player presses the
   * `menu` action (Escape). Absent means Escape only releases pointer lock.
   */
  pauseMenuWidget?: string;
  /**
   * UI Widget asset id pushed as a modal screen when the rules layer resolves a
   * win. Absent means no automatic screen (the HUD still reflects `game.phase`).
   */
  winScreenWidget?: string;
  /** UI Widget asset id pushed as a modal screen when the rules layer resolves a loss. */
  loseScreenWidget?: string;
  /**
   * Minimal gameplay rules (score/objectives/timer/win-lose). Absent means the
   * scene runs with no rules — the template default. See {@link LayoutGameRules}.
   */
  gameRules?: LayoutGameRules;
  /**
   * Active UI locale id (`en`, `tr`, ...) selecting which `.loc.json` table
   * resolves localized widget text. Absent means the first loaded table wins.
   */
  locale?: string;
}

/**
 * Sky Atmosphere-owned global sky-light capture. This is the editor-facing
 * replacement for the old singleton Reflection Environment actor: the PMREM /
 * `scene.environment` machinery still exists internally, but its authored
 * strength lives under Sky Atmosphere.
 */
export interface LayoutSkyLightCapture {
  /** Reflection + ambient bounce strength (maps to `scene.environmentIntensity`). */
  intensity?: number;
}

/**
 * Singleton environment actor: a physically-inspired sky dome (Rayleigh + Mie
 * scattering, à la Unreal's Sky Atmosphere). Rendered with three.js's analytic
 * `Sky` shader as the scene background.
 *
 * Like Unreal, the **directional Sun light is the source of truth** for the sun:
 * the sky reads that light's rotation each frame to place the sun disc + horizon
 * glow, so rotating the Sun (gizmo or its rotation fields) moves the sky live.
 * The Details panel exposes elevation/azimuth as a two-way convenience that just
 * rewrites the light's rotation; nothing about the sun is stored on the sky. Only
 * the scattering parameters live here; all fields are optional and absent reads
 * the defaults in `engine/scene/skyAtmosphere.ts`.
 */
export interface LayoutSkyAtmosphere {
  /** Display name in the Outliner. Absent means "Sky Atmosphere". */
  name?: string;
  /** Hidden in the viewport + runtime (no sky dome). Absent means false. */
  hidden?: boolean;
  /** Rayleigh scattering strength — controls the blueness of the sky (0..6). */
  rayleigh?: number;
  /** Atmospheric turbidity / haziness (1..20). */
  turbidity?: number;
  /** Mie scattering coefficient — the haze/glow around the sun (0..0.1). */
  mie?: number;
  /** Mie directional anisotropy — sun halo tightness (0..1). */
  mieDirectionalG?: number;
  /** Sky exposure / overall brightness, authored as a 1-based multiplier. */
  exposure?: number;
  /** Global sky capture fallback used by PBR reflections when no local probe applies. */
  skyLightCapture?: LayoutSkyLightCapture;
}

/**
 * Singleton environment actor: an Exponential Height Fog (à la Unreal). Faz 1 is
 * a distance-based scene fog — `exp` maps to three's `FogExp2`, `linear` to `Fog`
 * (near/far). All fields are optional; absent reads the defaults in
 * `engine/scene/heightFog.ts`. True world-height falloff is Faz 2 and not modeled
 * here.
 */
export interface LayoutHeightFog {
  /** Display name in the Outliner. Absent means "Exponential Height Fog". */
  name?: string;
  /** Hidden in the viewport + runtime (no fog). Absent means false. */
  hidden?: boolean;
  /** `exp` = FogExp2 (density), `linear` = Fog (start/end). Absent means `exp`. */
  mode?: "exp" | "linear";
  /** Fog inscattering color (hex `#rrggbb`). */
  color?: string;
  /** Exponential density (exp mode), tuned to the ~100u scene scale. */
  density?: number;
  /** Linear fog near distance (linear mode). */
  start?: number;
  /** Linear fog far distance (linear mode). */
  end?: number;
}

/**
 * Singleton environment actor: a **static** Cloud Layer (the non-volumetric
 * counterpart to Unreal's Volumetric Clouds). A camera-following dome backdrop
 * whose cloud cover is painted by a procedural fBm-noise shader — no raymarching,
 * no textures. All fields are optional; absent reads the defaults in
 * `engine/scene/cloudLayer.ts`. True volumetric clouds are intentionally out of
 * scope.
 */
export interface LayoutCloudLayer {
  /** Display name in the Outliner. Absent means "Cloud Layer". */
  name?: string;
  /** Hidden in the viewport + runtime (no clouds). Absent means false. */
  hidden?: boolean;
  /** Cloud tint (hex `#rrggbb`). */
  color?: string;
  /** Fraction of the sky covered (0 = clear, 1 = overcast). */
  coverage?: number;
  /** Overall cloud opacity (0 = invisible, 1 = solid). */
  density?: number;
  /** Edge feathering of the cloud shapes (0 = hard, 1 = very soft). */
  softness?: number;
  /** Feature size of the noise — larger = bigger cloud masses. */
  scale?: number;
  /** Drift speed (wind). Absent/0 keeps the clouds static. */
  speed?: number;
}

/**
 * Deprecated legacy singleton actor: a Reflection Environment (à la Unreal's Sky Light
 * static capture). Snapshots the Sky Atmosphere into a prefiltered environment
 * map that drives image-based reflections + ambient bounce on every PBR surface.
 * All fields are optional; absent reads the defaults in
 * `engine/scene/reflection.ts`. Faz 1 captures only the sky (`source: "sky"`); a
 * positional Sphere Reflection Capture is intentionally out of scope.
 *
 * New layouts store this as `skyAtmosphere.skyLightCapture`; this type remains so
 * old saved files can be loaded and migrated without losing their intensity.
 */
export interface LayoutReflection {
  /** Display name in the Outliner. Absent means "Reflection Environment". */
  name?: string;
  /** Hidden/disabled in editor + runtime (no environment). Absent means false. */
  hidden?: boolean;
  /** Capture source. Faz 1 only supports `"sky"`. */
  source?: "sky";
  /** Reflection + ambient bounce strength (maps to `scene.environmentIntensity`). */
  intensity?: number;
}

/**
 * Singleton environment actor: global Post Process settings. Faz 1 is limited to
 * renderer-property exposure + tone mapping; pass-based effects arrive later.
 */
export interface LayoutPostProcess {
  /** Display name in the Outliner. Absent means "Post Process". */
  name?: string;
  /** Hidden/disabled in editor + runtime. Absent means false. */
  hidden?: boolean;
  /** Manual exposure multiplier mapped to calibrated `renderer.toneMappingExposure`. */
  exposure?: number;
  /** Renderer tone mapper. Absent means ACES filmic. */
  toneMapping?: "aces" | "neutral" | "none";
  /** Post-process anti-aliasing. Absent means no AA pass. */
  antialias?: "none" | "smaa";
  /** Bloom full-screen pass settings. */
  bloom?: {
    enabled?: boolean;
    threshold?: number;
    intensity?: number;
    radius?: number;
  };
  /** Vignette full-screen pass settings. */
  vignette?: {
    enabled?: boolean;
    intensity?: number;
    offset?: number;
  };
  /** Chromatic aberration (RGB channel shift) pass settings. */
  chromaticAberration?: {
    enabled?: boolean;
    amount?: number;
  };
  /** Film grain pass settings. */
  grain?: {
    enabled?: boolean;
    intensity?: number;
  };
  /** Depth of field (bokeh) pass settings; distances are world units. */
  dof?: {
    enabled?: boolean;
    focusDistance?: number;
    aperture?: number;
    maxBlur?: number;
  };
  /** Ambient occlusion (GTAO) pass settings; radius is authored ~1-based. */
  ao?: {
    enabled?: boolean;
    radius?: number;
    intensity?: number;
  };
  /** Global color saturation multiplier; 1 is neutral. */
  saturation?: number;
  /** Global contrast multiplier; 1 is neutral. */
  contrast?: number;
  /** White-balance temperature; 0 is neutral, positive warms, negative cools. */
  temperature?: number;
  /** White-balance tint; 0 is neutral, positive shifts magenta, negative green. */
  tint?: number;
}

export interface LayoutLightActor {
  id: string;
  type: LayoutLightType;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  /** Stable id assigned when this object becomes a parent (referenced by children). */
  nodeId?: string;
  /** This object's parent, referencing the parent's `nodeId`. */
  parentId?: string;
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation?: Vec3;
  color?: string;
  intensity?: number;
  castShadow?: boolean;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
}

/**
 * Placed Planar Reflection actor (à la Unreal's Planar Reflection): a flat mirror
 * surface (water / polished floor / mirror) rendered with three.js's `Reflector`.
 * The reflective face is the plane's local +Z; the transform orients and sizes it.
 * Optional fields read defaults from `engine/scene/reflectionPlane.ts`.
 */
export interface LayoutReflectionPlane {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation?: Vec3;
  /** Scale (uniform scalar when all axes match, else per-axis `[x, y, z]`). */
  scale?: number | Vec3;
  /** Mirror tint (hex `#rrggbb`). */
  color?: string;
  /** Reflection render-target resolution in px. */
  resolution?: number;
}

/**
 * Placed Reflective Surface actor — the textured, PBR counterpart to the pure
 * mirror {@link LayoutReflectionPlane}. It renders a per-frame planar reflection
 * (like `Reflector`) but composites it into a real `MeshStandardMaterial` (albedo
 * texture + normal map + roughness), so the result reads as wet asphalt, polished
 * marble, water, etc. — not a flat mirror. Use for roads / floors / lakes / seas.
 * The reflective face is the plane's local +Z; the transform orients and sizes it.
 * Optional fields read defaults from `engine/scene/reflectiveSurface.ts`.
 */
export interface LayoutReflectiveSurface {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation?: Vec3;
  /** Scale (uniform scalar when all axes match, else per-axis `[x, y, z]`). */
  scale?: number | Vec3;
  /** Material asset id (`*.material.json`) shading the surface; null = built-in glossy default. */
  material?: string | null;
  /** Overall planar-reflection contribution, 0 (none) .. 1 (full mirror at grazing). */
  reflectionStrength?: number;
  /** Fresnel exponent: higher = reflection concentrated at grazing angles. */
  fresnelPower?: number;
  /** Minimum reflection seen head-on (0 = pure fresnel, 1 = uniform mirror). */
  fresnelBias?: number;
  /** Normal-map-driven screen-space distortion of the reflection (0 = sharp planar). */
  distortion?: number;
  /** Reflection tint multiplied over the reflected image (hex `#rrggbb`). */
  tint?: string;
  /** Reflection render-target resolution in px (higher = sharper, costlier). */
  resolution?: number;
}

/**
 * Placed Sphere Reflection Capture actor (à la Unreal's Sphere Reflection
 * Capture). A positional probe that bakes a static local cubemap from its own
 * position; nearby PBR surfaces sample this local capture instead of the global
 * Reflection Environment. Unlike the Planar Reflection it does not re-render the
 * scene every frame — the capture is baked once and cached. Faz 1 models only the
 * placed actor + influence sphere (no bake/render yet). The influence size is the
 * `radius`, not a transform scale, so there is no `scale` field. Optional fields
 * read defaults from `engine/scene/reflectionCapture.ts`.
 */
export interface LayoutSphereReflectionCapture {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. Cosmetic for a sphere; kept for the gizmo. */
  rotation?: Vec3;
  /** Influence radius in world units; surfaces within use this probe's capture. */
  radius?: number;
  /** Reflection strength multiplier applied to the captured cubemap. */
  intensity?: number;
  /** Baked cubemap face resolution in px (higher = sharper, costlier). */
  resolution?: number;
  /** CubeCamera near clip used when baking. */
  near?: number;
  /** CubeCamera far clip used when baking. */
  far?: number;
  /** Local parallax correction (V2+). Faz 1 keeps this off. */
  parallax?: boolean;
  /** Overlap tie-breaker: higher priority wins when two probes both cover a surface. */
  priority?: number;
}

/**
 * Placed Blocking Volume actor (à la Unreal's BlockingVolume / brush volumes): a
 * parametric primitive used for blockout / grey-boxing. Unlike a `shape:<type>`
 * instance it is **non-instanced** and carries its own brush dimensions (`size`),
 * so it can be reshaped (box / cylinder / cone / sphere) and resized numerically
 * from the Details "Brush Settings" panel. It always blocks collision; `renderInGame`
 * toggles whether it draws as a solid grey-box in Play (off = invisible-but-blocking,
 * the true Unreal BlockingVolume). In the editor it always shows as a translucent
 * orange brush + wireframe. Optional fields read defaults from
 * `engine/scene/blockingVolume.ts`.
 */
export interface LayoutBlockingVolume {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation?: Vec3;
  /**
   * Transform scale multiplied onto the brush `size` (uniform scalar when all
   * axes match, else per-axis `[x, y, z]`). The editor's shared `writeScale`
   * collapses a uniform scale to a scalar, so this must accept both.
   */
  scale?: number | Vec3;
  /** Brush primitive shape. Absent means `box`. */
  brushShape?: BrushShape;
  /**
   * Brush dimensions in world units, canonical per shape (see
   * `canonicalBrushSize`): box uses all three `[x, y, z]`; sphere uses `[d, d, d]`
   * (diameter); cylinder/cone use `[diameter, height, diameter]`. Absent reads the
   * default size.
   */
  size?: Vec3;
  /** Radial segment count for `cylinder` / `cone` brushes (ignored by box/sphere). Absent reads the default. */
  brushSides?: number;
  /** Draw as a solid grey-box in Play. Absent/false means invisible-but-blocking. */
  renderInGame?: boolean;
  /** Editor brush tint (hex `#rrggbb`). */
  color?: string;
  /**
   * AI navigation interpretation. `walkable` turns a horizontal box into a
   * walkable deck instead of an obstacle (for example, beneath a bridge).
   */
  navigationRole?: import("./collision").NavigationRole;
}

/**
 * Placed AI Navigation Volume (à la Unreal's NavMesh Bounds Volume): a box-shaped
 * authoring volume that limits where the first grid navigation implementation is
 * allowed to search. When no volume exists, runtime keeps the legacy automatic
 * start/goal bounds fallback for old levels.
 */
export interface LayoutAiNavigationVolume {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. Rotation is enclosed as an AABB for grid nav. */
  rotation?: Vec3;
  /** Transform scale multiplied onto the volume `size`; accepts scalar from editor writeScale. */
  scale?: number | Vec3;
  /** Box dimensions in world units. */
  size?: Vec3;
  /** Editor navmesh preview agent radius, used to erode walkable area from blockers. */
  agentRadius?: number;
  /** Extra editor navmesh preview clearance beyond `agentRadius`. */
  clearancePadding?: number;
}

/**
 * Placed Target Point actor (Unreal Target Point-style authoring marker). It is
 * visible/editable in the editor and hidden in Play by default; runtime AI can
 * later index these points for patrol routes.
 */
export interface LayoutTargetPoint {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  /** Optional facing direction for route visualization / future movement hints. */
  rotation?: Vec3;
  /** Marker display scale only; gameplay acceptance is `acceptanceRadius`. */
  scale?: number | Vec3;
  /** Next Target Point id in a simple single-link patrol route. */
  nextTargetPoint?: string;
  /**
   * Marks this point as the patrol route's start. When a route (or `patrolTag`
   * group) has one flagged start, patrol tasks begin there; when none is flagged
   * the runtime falls back to the first authored point.
   */
  startPoint?: boolean;
  waitTime?: number;
  acceptanceRadius?: number;
  speedOverride?: number;
  patrolTag?: string;
  /** Editor tint (hex `#rrggbb`). */
  color?: string;
}

/**
 * Placed, level-owned generic spline actor. Its points are actor-local; the
 * regular actor transform moves the complete spline in world space.
 */
export interface LayoutSplineActor {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
  spline: import("./spline").ForgeSplineComponentData;
  /** Optional procedural outputs authored on the spline, never individual actors. */
  generators?: import("./splineGenerator").ForgeSplineGeneratorDef[];
  /** Runtime query grouping. Kept separate from the editor-only debug presentation. */
  runtime?: {
    tags?: string[];
  };
  /** Editor-only sampled-line presentation; no gameplay effect. */
  debug?: {
    visible?: boolean;
    color?: string;
    resolution?: number;
    showPointIds?: boolean;
  };
}

/**
 * Placed Landscape actor (à la Unreal's Landscape): a level-owned heightfield
 * terrain. Faz 1 models only the placed actor + a reference to its height/layer
 * sidecar data (`dataRef`); sculpt/paint tools are later phases. Unlike the other
 * placed actors there is no `scale` field — terrain size is fixed by the sidecar's
 * `size` (vertex grid + spacing), not a transform scale. Optional fields read
 * defaults from `engine/scene/landscape.ts`.
 */
export interface LayoutLandscape {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  scaleLocked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  position: Vec3;
  /** Full Euler rotation (XYZ order) in degrees. */
  rotation?: Vec3;
  /** Public-root-relative path to this landscape's `*.landscape.json` height/layer sidecar. */
  dataRef: string;
  /** Landscape material asset id, unused until Faz 3 (layer paint + landscape material). */
  material?: string;
  /** Runtime collision. Absent means true (statically collidable, rebuilt on Save/Play). */
  collision?: boolean;
}

/** A static local foam mask authored independently of RTS units and actors. */
export interface LayoutRiverWaterFoamStamp {
  id: string;
  /** A radial foam point or a capsule-like strip on the river surface. */
  kind: "point" | "strip";
  /** Landscape-local centre/start position; only X/Z affect the water ribbon. */
  position: Vec3;
  /** Landscape-local strip endpoint. Required for `strip`. */
  endPosition?: Vec3;
  /** Influence radius in world units. */
  radius: number;
  /** Additive foam contribution, 0..1. */
  intensity: number;
  /** Legacy concentric-ring setting retained only for old saved layouts. */
  ringCount?: number;
  /** Legacy concentric-ring setting retained only for old saved layouts. */
  expansionSpeed?: number;
}

/** Per-spline-segment water presentation override for authored rapids. */
export interface LayoutRiverWaterSegmentProfile {
  splineSegmentRef: string;
  /** Multiplies the body-wide flow speed for this segment. */
  flowSpeedMultiplier?: number;
  /** Explicit rapid/foam contribution, 0..1. */
  rapidness?: number;
}

/**
 * A visible river-water body whose shape is resolved from one Landscape spline.
 * The Landscape remains the authority for spline shape and terrain deformation;
 * this actor owns only water presentation. It intentionally has no collision or
 * navigation fields: RTS traversal stays authored by blockers and bridge markers.
 */
export interface LayoutRiverWater {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  groupId?: string;
  nodeId?: string;
  parentId?: string;
  /** Id of the placed Landscape actor that owns the referenced spline. */
  landscapeRef: string;
  /** Id of a spline in that Landscape's `*.landscape.json` sidecar. */
  splineRef: string;
  /** Landscape-local, horizontal water height. */
  surfaceLevel?: number;
  /** Multiplier over each Landscape spline point's authored width. */
  widthScale?: number;
  /** UV-space normal-flow speed in repeats per second. */
  flowSpeed?: number;
  /** Repetition multiplier for the flowing normal texture. */
  normalScale?: number;
  /** Manifest texture asset id; absent uses the built-in water normal default. */
  normalTexture?: string;
  /** Deep-channel colour (hex `#rrggbb`). */
  deepColor?: string;
  /** Shallow-bank colour (hex `#rrggbb`). */
  shallowColor?: string;
  /** Maximum material alpha, 0..1. */
  opacity?: number;
  /** How much of the terrain bed remains visible through the water: 0 = hidden, 1 = clear. */
  bedVisibility?: number;
  /** Local water-depth distance over which bed visibility is absorbed, in world units. */
  absorptionDistance?: number;
  /** Vertical-only wave amplitude in world units; shore vertices fade to zero. */
  waveAmplitude?: number;
  /** Main wave length in world units. */
  waveLength?: number;
  /** Tint used by shore, rapid and strip foam. */
  foamColor?: string;
  /** Visual blend strength of shore, rapid and strip foam, 0..1. */
  foamOpacity?: number;
  /** Number of visible inward-moving shore-wave bands per bank. */
  shoreWaveSpacing?: number;
  /** Shore-wave travel speed from bank toward the river centre. */
  shoreWaveSpeed?: number;
  /** Normalized inward distance from each bank before shore waves fade out. */
  shoreWaveReach?: number;
  /** Tiling factor for the shore-wave breakup texture. */
  shoreWaveBreakupScale?: number;
  /** Static foam masks for bridge piers, rocks, rapids, and other authored obstacles. */
  foamStamps?: LayoutRiverWaterFoamStamp[];
  /** Static flow/rapid overrides keyed by Landscape spline segment id. */
  segmentProfiles?: LayoutRiverWaterSegmentProfile[];
  /** `sharedPlanar` lets same-plane bodies share one reflection render; default is off. */
  reflectionMode?: "off" | "sharedPlanar";
  /** Optional shared planar-reflection group. Bodies on different planes must not share it. */
  reflectionGroup?: string;
  /** Low disables planar reflection; Medium/High select its target/update budget. */
  reflectionQuality?: "low" | "medium" | "high";
  /**
   * How much of the planar-reflection capture reaches the surface, 0..1. Quality
   * only buys resolution and update rate, so this is the one knob that changes
   * how visible a reflection is; the shader still attenuates it by depth and foam.
   */
  reflectionStrength?: number;
}

export interface RoomLayout {
  schema: 1;
  name: string;
  loadGroups: string[];
  worldSettings?: LayoutWorldSettings;
  /** Optional singleton sky/atmosphere environment actor. */
  skyAtmosphere?: LayoutSkyAtmosphere;
  /** Optional singleton Exponential Height Fog environment actor. */
  heightFog?: LayoutHeightFog;
  /** Optional singleton static Cloud Layer environment actor. */
  cloudLayer?: LayoutCloudLayer;
  /** Deprecated legacy Reflection Environment actor; migrated into Sky Atmosphere on save/load. */
  reflection?: LayoutReflection;
  /** Optional singleton global Post Process settings actor. */
  postProcess?: LayoutPostProcess;
  lights?: LayoutLightActor[];
  /** Placed Planar Reflection (mirror) actors. */
  reflectionPlanes?: LayoutReflectionPlane[];
  /** Placed Reflective Surface (textured glossy planar reflection) actors. */
  reflectiveSurfaces?: LayoutReflectiveSurface[];
  /** Placed Sphere Reflection Capture (local cubemap probe) actors. */
  reflectionCaptures?: LayoutSphereReflectionCapture[];
  /** Placed Blocking Volume (parametric blockout brush) actors. */
  blockingVolumes?: LayoutBlockingVolume[];
  /** Placed AI Navigation Volumes (NavMesh Bounds Volume-style pathfinding bounds). */
  aiNavigationVolumes?: LayoutAiNavigationVolume[];
  /** Placed Target Points for AI patrol route authoring. */
  targetPoints?: LayoutTargetPoint[];
  /** Placed generic spline actors (independent from Landscape Splines). */
  splines?: LayoutSplineActor[];
  /** Placed Landscape (heightfield terrain) actors. Faz 1 UX keeps this to one entry. */
  landscapes?: LayoutLandscape[];
  /** Spline-driven visual water bodies. They do not own collision or navigation. */
  riverWaters?: LayoutRiverWater[];
  instances: LayoutModelInstances[];
  characters: LayoutCharacter[];
  /** Placed Actor Script class instances (resolved + spawned at runtime). */
  actors?: LayoutActorInstance[];
  /** World-space UI widgets (screen-projected DOM billboards; see `engine/ui/uiWorldWidget.ts`). */
  worldWidgets?: WorldUiWidget[];
}
import type { AiPatrolRoute } from "./components";
