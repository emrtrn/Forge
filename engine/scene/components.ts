import type { Entity, EntityComponentData, SceneJsonValue } from "./entity";
import type { LayoutPhysicsAxisLocks, Vec3 } from "./layout";
import { isNavigationRole, type NavigationRole } from "./collision";
import { resolveCapsuleDimensions } from "./capsule";
import { isActorEventKind, type ActorEventKind } from "./actorScript";
import { normalizeBlackboardKeys, type BlackboardKeyDef } from "../ai/blackboard";

export const TRANSFORM_COMPONENT = "Transform";
export const MESH_RENDERER_COMPONENT = "MeshRenderer";
export const STATIC_MESH_COMPONENT = "StaticMeshComponent";
export const SKELETAL_MESH_COMPONENT = "SkeletalMeshComponent";
export const LIGHT_COMPONENT = "Light";
export const METADATA_COMPONENT = "Metadata";
export const BEHAVIOR_COMPONENT = "Behavior";
export const EVENT_BINDINGS_COMPONENT = "EventBindings";
export const COLLIDER_COMPONENT = "Collider";
export const AUDIO_COMPONENT = "Audio";
export const PARTICLE_EMITTER_COMPONENT = "ParticleEmitter";
export const INTERACTION_COMPONENT = "Interaction";
export const CHARACTER_MOVEMENT_COMPONENT = "CharacterMovement";
export const MOVING_PLATFORM_COMPONENT = "MovingPlatform";
export const SPLINE_PATH_FOLLOWER_COMPONENT = "SplinePathFollower";
export const CAMERA_COMPONENT = "Camera";
export const SPRING_ARM_COMPONENT = "SpringArm";
export const MESSAGE_BINDINGS_COMPONENT = "MessageBindings";
export const SCRIPT_INTERFACES_COMPONENT = "ScriptInterfaces";
export const SCRIPT_ACTOR_COMPONENT = "ScriptActor";
export const SCRIPT_REFERENCES_COMPONENT = "ScriptReferences";
export const SCRIPT_DISPATCHERS_COMPONENT = "ScriptDispatchers";
export const AI_CONTROLLER_COMPONENT = "AIController";
export const SMART_OBJECT_COMPONENT = "SmartObject";

export type SceneLightType = "directional" | "point" | "spot";
export type ColliderShape =
  | "box"
  | "sphere"
  | "capsule"
  | "cylinder"
  | "cone"
  | "convex"
  | "trimesh";

export interface TransformComponent {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface MeshRendererComponent {
  assetId: string;
  materialSlot?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Local mesh scale authored on the MeshRenderer node (Actor Script `props.scale`),
   * multiplied into the placement scale when the mesh is rendered. Lets a class
   * shrink/grow its visual without changing the placement transform. Absent = unit.
   */
  scale?: Vec3;
}

/**
 * Unreal-style `UStaticMeshComponent`: renders a rigid (non-skinned) mesh asset
 * (`manifest.assetType === "staticMesh"`). Same visual props as the legacy
 * {@link MeshRendererComponent} minus any animation concept.
 */
export interface StaticMeshComponent {
  assetId: string;
  materialSlot?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Local mesh scale (see {@link MeshRendererComponent.scale}). */
  scale?: Vec3;
}

/**
 * Unreal-style `USkeletalMeshComponent`: renders a skinned mesh asset
 * (`manifest.assetType === "skeletalMesh"`). Adds an authored `animation` clip
 * name that plays in Play mode; Forge has no Animation Blueprint, so this is a
 * plain clip reference resolved from the skeleton sidecar / GLTF clips.
 */
export interface SkeletalMeshComponent {
  assetId: string;
  /** Clip name that plays in Play mode. Absent = no default clip. */
  animation?: string;
  materialSlot?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Local mesh scale (see {@link MeshRendererComponent.scale}). */
  scale?: Vec3;
}

/**
 * The common shape read by the render path from whichever mesh component an
 * entity carries — legacy {@link MeshRendererComponent}, {@link StaticMeshComponent},
 * or {@link SkeletalMeshComponent}. The internal render helper stays unified while
 * the authoring surface splits into typed static/skeletal components.
 */
export interface RenderableMeshComponent {
  assetId: string;
  materialSlot?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  scale?: Vec3;
  /** Skeletal-only clip name; absent on static meshes. */
  animation?: string;
}

export interface LightComponent {
  type: SceneLightType;
  color?: string;
  intensity?: number;
  castShadow?: boolean;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
}

export interface MetadataComponent {
  values: Record<string, SceneJsonValue>;
}

/**
 * Attaches a runtime script to an entity: a registered behavior `scriptId` plus
 * opaque JSON `params`. The behavior registry (a runtime concern) resolves the
 * id to an update function; the engine layer only stores the reference.
 */
export interface BehaviorComponent {
  scriptId: string;
  params?: Record<string, SceneJsonValue>;
}

export interface EventBindingComponentEntry {
  event: ActorEventKind;
  scriptId: string;
  params?: Record<string, SceneJsonValue>;
}

export interface EventBindingsComponent {
  bindings: EventBindingComponentEntry[];
}

export type MessageBindingTarget = "self" | "any";

export interface MessageBindingComponentEntry {
  message: string;
  scriptId: string;
  params?: Record<string, SceneJsonValue>;
  target: MessageBindingTarget;
}

export interface MessageBindingsComponent {
  bindings: MessageBindingComponentEntry[];
}

export interface ScriptInterfacesComponent {
  interfaces: string[];
}

export interface ScriptActorComponent {
  classRef: string;
  nodeId?: string;
  /** Resolved class defaults plus this level instance's declared overrides. */
  variables?: Record<string, import("./layout").MetadataValue>;
}

export interface ScriptReferenceSelectorComponent {
  byNodeId?: string;
  byName?: string;
  byTag?: string;
  byClassRef?: string;
  byInterface?: string;
}

export interface ScriptReferenceComponentEntry {
  key: string;
  selector: ScriptReferenceSelectorComponent;
}

export interface ScriptReferencesComponent {
  references: ScriptReferenceComponentEntry[];
}

export interface ScriptDispatcherComponentEntry {
  name: string;
  payload: Record<string, string>;
}

export interface ScriptDispatchersComponent {
  dispatchers: ScriptDispatcherComponentEntry[];
}

/**
 * One simple-collision shape of a (possibly compound) collider. Sizes/centers
 * are world-scaled (placement scale baked in), like {@link ColliderComponent};
 * `rotation` is a local Euler rotation in degrees for oriented shapes.
 */
export interface ColliderPrimitive {
  shape: ColliderShape;
  size: Vec3;
  center?: Vec3;
  rotation?: Vec3;
  /** Baked convex hull points (world-scaled, relative to body origin) for `shape === "convex"`. */
  points?: Vec3[];
  /** Baked triangle vertices (world-scaled, relative to body origin) for `shape === "trimesh"`. */
  vertices?: Vec3[];
  /** Triangle index buffer into `vertices`, grouped by threes, for `shape === "trimesh"`. */
  indices?: number[];
}

export interface ColliderComponent {
  shape: ColliderShape;
  /** World-axis-aligned full size (placement scale already baked in). */
  size: Vec3;
  /** Capsule radius before conversion to the legacy size AABB. */
  capsuleRadius?: number;
  /** Capsule half-height from center to top/bottom of the hemispheres. */
  capsuleHalfHeight?: number;
  /**
   * Offset of the collider center from the entity's transform position, in world
   * space (placement scale baked in). Absent means centered on the position.
   */
  center?: Vec3;
  /**
   * Authored compound collision shapes (Static Mesh editor). When present, the
   * physics backend builds one collider per primitive; `shape`/`size`/`center`
   * above describe the encompassing AABB used by the broad-phase / movement.
   */
  primitives?: ColliderPrimitive[];
  isStatic: boolean;
  isSensor: boolean;
  /**
   * Hides the runtime collider debug wireframe in Game/Play mode. The collider
   * still collides — this only suppresses the diagnostic overlay the runtime
   * draws around the actual (scale-baked) physics collider. Absent/false means
   * the wireframe is visible so scaling can be observed.
   */
  hideInGame?: boolean;
  /** Surface friction (Rapier). Absent uses the backend default. */
  friction?: number;
  /** Surface restitution / bounciness (Rapier). Absent uses the backend default. */
  restitution?: number;
  /** AI navigation interpretation; affects nav generation only, not physics collision. */
  navigationRole?: NavigationRole;
  /** Emit begin/end overlap events for sensors. Absent means true. */
  generateOverlapEvents?: boolean;
  /** Emit hit events while simulating physics. Absent means true. */
  simulationGeneratesHitEvents?: boolean;
  /** Packed Rapier interaction groups (membership<<16 | filter). Absent = interact with all. */
  collisionGroups?: number;
  simulatePhysics?: boolean;
  massKg?: number;
  linearDamping?: number;
  angularDamping?: number;
  enableGravity?: boolean;
  lockPosition?: LayoutPhysicsAxisLocks;
  lockRotation?: LayoutPhysicsAxisLocks;
}

/**
 * A kinematic moving platform: the entity ping-pongs from its start position to
 * `start + offset` and back at `speed` units/s. The {@link MovingPlatformSubsystem}
 * drives the motion; the character movement system reads the platform as a
 * blocker, a ground surface, and a horizontal carry source. Presence of this
 * component makes the collider movable (kinematic), so it is excluded from the
 * cached static blockers.
 */
export interface MovingPlatformComponent {
  /** Far-end offset from the placed start position (world units). */
  offset: Vec3;
  /** Travel speed along the segment (units/s). */
  speed: number;
  /** Initial position along the segment, 0..1 (0 = start). */
  startPhase: number;
}

/** Runtime movement consumer for a level-owned Generic Spline Actor. */
export interface SplinePathFollowerComponent {
  splineId: string;
  /** Constant travel speed in world units per second. */
  speed: number;
  startDistance: number;
  wrapMode: "clamp" | "loop" | "pingPong";
  reverse: boolean;
  orientToSpline: boolean;
  /** Forge XYZ Euler offset, applied after spline orientation. */
  orientationOffset: Vec3;
  /** World-space offset applied after the spline sample. */
  positionOffset: Vec3;
  applyPitch: boolean;
  applyRoll: boolean;
  enabled: boolean;
}

export interface AudioComponent {
  clipId: string;
  /** Explicit source asset ID; overrides `clipId` when present. */
  sourceId?: string;
  /** `"soundCue"` when the source is a Sound Cue graph asset; `"sound"` or absent = raw clip. */
  sourceType?: "sound" | "soundCue";
  volume: number;
  /** Pitch / playback-rate multiplier (1 = unchanged). Absent means the runtime default. */
  pitch?: number;
  loop: boolean;
  spatial: boolean;
  /** Spatial attenuation overrides (only used when `spatial`); map to the runtime `PannerNode`. */
  refDistance?: number;
  maxDistance?: number;
  rolloff?: number;
  /** Play automatically on scene load (ambient). Absent means false. */
  autoPlay?: boolean;
}

/**
 * Drives a particle/VFX emitter from a manifest `effectId` plus a small set of
 * per-instance overrides. Emitter behaviour (spawn/lifetime/velocity/blend/…)
 * lives in the effect asset, so a reused effect looks the same everywhere; the
 * overrides only re-skin/re-time this instance: `enabled` (default true) toggles
 * it, `autoPlay` plays it on scene load, `scale` uniformly grows the effect,
 * `tint` recolours it, and `loop` forces looping on/off. The engine layer only
 * stores the reference; a VFX system (a runtime concern) resolves `effectId` and
 * simulates, like Behavior resolves `scriptId`.
 */
export interface ParticleEmitterComponent {
  effectId: string;
  enabled?: boolean;
  autoPlay?: boolean;
  scale?: number;
  tint?: string;
  loop?: boolean;
}

/**
 * Marks an entity as interactable: an `action` id the runtime interprets, an
 * optional player-facing `prompt`, a default `enabled` flag, an optional
 * `requires` gate (e.g. an inventory/key id) and an optional `cooldown` in
 * seconds. Project gameplay rules (runtime) interpret these; the engine only
 * stores the authored data, like Behavior/Metadata. Typically paired with a
 * (sensor) {@link ColliderComponent} so an InteractionSystem can detect overlap.
 */
export interface InteractionComponent {
  action: string;
  prompt?: string;
  enabled?: boolean;
  requires?: string;
  cooldown?: number;
}

export interface SmartObjectSlot {
  id: string;
  tags?: string[];
  position?: Vec3;
}

/**
 * Marks a level actor as an AI-usable smart object. This is authored data only:
 * reservations live in the AI runtime store and are not serialized back to the
 * scene/actor asset. `InteractionComponent` remains the player-triggered action
 * surface; SmartObject describes claimable AI slots around that object.
 */
export interface SmartObjectComponent {
  tags: string[];
  slots: SmartObjectSlot[];
  interactionPosition?: Vec3;
  cooldown?: number;
  enabled?: boolean;
}

export type CharacterMovementMode = "walking" | "falling" | "flying" | "swimming" | "custom";

export interface CharacterMovementComponent {
  maxWalkSpeed: number;
  sprintMultiplier: number;
  jumpSpeed: number;
  gravityScale: number;
  airControl: number;
  acceleration: number;
  brakingDeceleration: number;
  groundFriction: number;
  rotationRate: Vec3;
  orientRotationToMovement: boolean;
  orientRotationToControl: boolean;
  movementMode: CharacterMovementMode;
  capsuleRadius: number;
  capsuleHalfHeight: number;
  maxStepHeight: number;
  /**
   * Largest drop (units) the grounded feet follow down without going airborne, so
   * walking down stair-sized ledges stays grounded (no fall animation). A drop
   * beyond this enters falling.
   */
  maxStepDown: number;
  /** Steepest ramp (degrees) the character can walk up; steeper surfaces are not walkable ground. */
  maxSlopeAngleDeg: number;
  /**
   * Planar speed multiplier while climbing at/above a 45° incline (slope ratio 1);
   * shallower climbs blend toward 1, so stairs and ramps read as effort. 1 = no
   * uphill slowdown.
   */
  uphillSpeedScale: number;
  /**
   * Vertical speed (units/s) the grounded feet ease toward a new floor height, so
   * a step is climbed/descended over a few frames instead of snapping in one
   * (which pops the camera). 0 = instant snap. Ramps are unaffected (their
   * per-frame rise is below the per-frame ease budget).
   */
  stepSmoothSpeed: number;
}

/**
 * A camera viewpoint authored on an actor (Unreal's `UCameraComponent`). A
 * possessed pawn carrying this, typically as a {@link SpringArmComponent} child,
 * drives the play camera's projection and camera-specific gameplay effects.
 * `fieldOfView` is the vertical FOV in degrees; clip planes are in world units;
 * `orthoWidth` applies only when `isOrthographic`. Defaults mirror the current
 * runtime camera (FOV 44, near 0.1, far 100) so the next phase maps 1:1.
 */
export interface CameraComponent {
  fieldOfView: number;
  nearClip: number;
  farClip: number;
  isOrthographic: boolean;
  orthoWidth: number;
  enableSprintCameraShake: boolean;
}

/**
 * A camera boom authored on an actor (Unreal's `USpringArmComponent`). It holds a
 * {@link CameraComponent} at a fixed distance behind a pivot, optionally lagging
 * and collision-probing in the TPS Game Mode.
 *  - `targetArmLength`: distance from the pivot to the camera socket (world units).
 *  - `socketOffset`: offset applied at the camera socket (end of the arm).
 *  - `targetOffset`: offset applied to the pivot the arm orbits.
 *  - `enableCameraLag` / `cameraLagSpeed`: exponential position smoothing.
 *  - `doCollisionTest`: pull the camera in when the boom is blocked.
 */
export interface SpringArmComponent {
  targetArmLength: number;
  socketOffset: Vec3;
  targetOffset: Vec3;
  enableCameraLag: boolean;
  cameraLagSpeed: number;
  doCollisionTest: boolean;
}

/**
 * AI perception tuning authored on an AIController (Unreal `AIPerceptionComponent`
 * senses). Sight is a radius + horizontal FOV cone; hearing is a radius. Consumed
 * by the perception subsystem in Faz 4; stored here so it round-trips and shows in
 * debug from Faz 1.
 */
export interface AIPerceptionConfig {
  sightRadius?: number;
  nearSightRadius?: number;
  fieldOfViewDeg?: number;
  hearingRadius?: number;
  targetLostGraceSeconds?: number;
}

/**
 * Navigation agent tuning authored on an AIController (Unreal `Nav Agent Props`):
 * the agent's capsule radius/height for pathfinding and its max movement speed.
 * Consumed by the navigation/path-following work in Faz 3.
 */
export interface AINavAgentConfig {
  radius?: number;
  height?: number;
  maxSpeed?: number;
  /**
   * Extra pathfinding clearance beyond the capsule radius (Unreal `Nav Agent`
   * slack). Kept small so narrow corridors stay traversable. Defaults to 0.
   */
  clearancePadding?: number;
}

/** Explicit patrol-route source for an AI-controlled character. */
export type AiPatrolRouteSource = "targetPoints" | "spline";
export type AiSplinePatrolEntry = "nearest" | "start";
export type AiSplinePatrolWrapMode = "loop" | "pingPong" | "clamp";

/**
 * Patrol authoring stays on the AIController rather than the Spline Actor: one
 * level can contain Target Points and many splines, while every AI explicitly
 * chooses its own route source. Spline movement remains CharacterMovement-owned.
 */
export interface AiPatrolRoute {
  source: AiPatrolRouteSource;
  splineId?: string;
  targetPointTag?: string;
  entry: AiSplinePatrolEntry;
  speed?: number;
  acceptanceRadius?: number;
  lookAheadDistance: number;
  wrapMode: AiSplinePatrolWrapMode;
}

export const DEFAULT_AI_PATROL_ROUTE: Readonly<AiPatrolRoute> = {
  source: "targetPoints",
  entry: "nearest",
  lookAheadDistance: 1.2,
  wrapMode: "loop",
};

/**
 * Marks an entity as an AI-controlled pawn (Unreal: a Pawn with an `AIControllerClass`).
 * The AISubsystem derives one AIController per entity carrying this component. In
 * Faz 1 the runtime blackboard is built from the inline `blackboardKeys` schema;
 * the `behaviorTree` / `blackboard` asset paths are recorded for the Faz 2 loader.
 * Like Behavior/Metadata, the engine only stores the authored reference — the AI
 * runtime resolves and acts on it.
 */
export interface AIControllerComponent {
  /** Authored `*.behavior.json` asset path (resolved by the Faz 2 loader). */
  behaviorTree?: string;
  /**
   * Authored `*.stateTree.json` asset path. When set (and resolvable), the
   * AISubsystem runs a StateTree instead of a Behavior Tree for this pawn.
   */
  stateTree?: string;
  /** Authored `*.blackboard.json` asset path (resolved by the Faz 2 loader). */
  blackboard?: string;
  perception?: AIPerceptionConfig;
  navAgent?: AINavAgentConfig;
  /** Selected patrol source. Absent preserves legacy Target Point patrol behavior. */
  patrolRoute?: AiPatrolRoute;
  /** Inline blackboard key schema, used to build the runtime memory in Faz 1. */
  blackboardKeys?: BlackboardKeyDef[];
}

function readVec3(value: SceneJsonValue | undefined): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return undefined;
  return [x, y, z];
}

function readPhysicsAxisLocks(
  value: SceneJsonValue | undefined,
): LayoutPhysicsAxisLocks | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  if (typeof x !== "boolean" || typeof y !== "boolean" || typeof z !== "boolean") {
    return undefined;
  }
  return [x, y, z];
}

/** Reads a typed transform from an entity's serializable component data. */
export function readTransformComponent(entity: Entity): TransformComponent | undefined {
  const data = entity.components[TRANSFORM_COMPONENT];
  if (!data) return undefined;
  const position = readVec3(data.position);
  const rotation = readVec3(data.rotation);
  const scale = readVec3(data.scale);
  if (!position || !rotation || !scale) return undefined;
  return { position, rotation, scale };
}

/**
 * Parses the shared renderable-mesh fields (`assetId` + visual props) from any
 * mesh component's serializable data. `includeAnimation` keeps the skeletal-only
 * `animation` clip name; static meshes drop it.
 */
function parseRenderableMeshData(
  data: EntityComponentData | undefined,
  includeAnimation: boolean,
): RenderableMeshComponent | undefined {
  if (!data) return undefined;
  if (typeof data.assetId !== "string") return undefined;
  const component: RenderableMeshComponent = { assetId: data.assetId };
  if (typeof data.materialSlot === "string") component.materialSlot = data.materialSlot;
  if (typeof data.castShadow === "boolean") component.castShadow = data.castShadow;
  if (typeof data.receiveShadow === "boolean") component.receiveShadow = data.receiveShadow;
  const scale = readVec3(data.scale);
  if (scale) component.scale = scale;
  if (includeAnimation && typeof data.animation === "string" && data.animation.length > 0) {
    component.animation = data.animation;
  }
  return component;
}

/** Reads a typed (legacy) mesh renderer from an entity's serializable component data. */
export function readMeshRendererComponent(entity: Entity): MeshRendererComponent | undefined {
  return parseRenderableMeshData(entity.components[MESH_RENDERER_COMPONENT], false);
}

/** Reads a typed Static Mesh component from an entity's serializable component data. */
export function readStaticMeshComponent(entity: Entity): StaticMeshComponent | undefined {
  return parseRenderableMeshData(entity.components[STATIC_MESH_COMPONENT], false);
}

/** Reads a typed Skeletal Mesh component from an entity's serializable component data. */
export function readSkeletalMeshComponent(entity: Entity): SkeletalMeshComponent | undefined {
  return parseRenderableMeshData(entity.components[SKELETAL_MESH_COMPONENT], true);
}

/**
 * Reads the entity's renderable mesh from whichever mesh component it carries,
 * preferring the new typed components over the legacy {@link MeshRendererComponent}.
 * The single reader the render path uses so static/skeletal authoring stays
 * unified downstream (mesh clone, scale, shadows). Only the skeletal component
 * contributes `animation`.
 */
export function readRenderableMeshComponent(entity: Entity): RenderableMeshComponent | undefined {
  return (
    parseRenderableMeshData(entity.components[STATIC_MESH_COMPONENT], false) ??
    parseRenderableMeshData(entity.components[SKELETAL_MESH_COMPONENT], true) ??
    parseRenderableMeshData(entity.components[MESH_RENDERER_COMPONENT], true)
  );
}

/** Reads a typed metadata component from an entity's serializable component data. */
export function readMetadataComponent(entity: Entity): MetadataComponent | undefined {
  const data = entity.components[METADATA_COMPONENT];
  if (!data) return undefined;
  const values = data.values;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return undefined;
  return { values: { ...(values as Record<string, SceneJsonValue>) } };
}

/** Reads a typed behavior reference from an entity's serializable component data. */
export function readBehaviorComponent(entity: Entity): BehaviorComponent | undefined {
  const data = entity.components[BEHAVIOR_COMPONENT];
  if (!data) return undefined;
  if (typeof data.scriptId !== "string" || data.scriptId.length === 0) return undefined;
  const component: BehaviorComponent = { scriptId: data.scriptId };
  const params = data.params;
  if (typeof params === "object" && params !== null && !Array.isArray(params)) {
    component.params = { ...(params as Record<string, SceneJsonValue>) };
  }
  return component;
}

/** Reads runtime actor event bindings from an entity. */
export function readEventBindingsComponent(entity: Entity): EventBindingsComponent | undefined {
  const data = entity.components[EVENT_BINDINGS_COMPONENT];
  if (!data) return undefined;
  const rawBindings = Array.isArray(data.bindings) ? data.bindings : [];
  const bindings: EventBindingComponentEntry[] = [];
  for (const raw of rawBindings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, SceneJsonValue>;
    if (!isActorEventKind(record.event)) continue;
    if (typeof record.scriptId !== "string" || record.scriptId.length === 0) continue;
    const binding: EventBindingComponentEntry = {
      event: record.event,
      scriptId: record.scriptId,
    };
    if (typeof record.params === "object" && record.params !== null && !Array.isArray(record.params)) {
      binding.params = { ...(record.params as Record<string, SceneJsonValue>) };
    }
    bindings.push(binding);
  }
  return bindings.length > 0 ? { bindings } : undefined;
}

/** Reads runtime script message bindings from an entity. */
export function readMessageBindingsComponent(entity: Entity): MessageBindingsComponent | undefined {
  const data = entity.components[MESSAGE_BINDINGS_COMPONENT];
  if (!data) return undefined;
  const rawBindings = Array.isArray(data.bindings) ? data.bindings : [];
  const bindings: MessageBindingComponentEntry[] = [];
  for (const raw of rawBindings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, SceneJsonValue>;
    if (typeof record.message !== "string" || record.message.length === 0) continue;
    if (typeof record.scriptId !== "string" || record.scriptId.length === 0) continue;
    const binding: MessageBindingComponentEntry = {
      message: record.message,
      scriptId: record.scriptId,
      target: record.target === "any" ? "any" : "self",
    };
    if (typeof record.params === "object" && record.params !== null && !Array.isArray(record.params)) {
      binding.params = { ...(record.params as Record<string, SceneJsonValue>) };
    }
    bindings.push(binding);
  }
  return bindings.length > 0 ? { bindings } : undefined;
}

/** Reads interface/capability labels advertised by a script-authored entity. */
export function readScriptInterfacesComponent(entity: Entity): ScriptInterfacesComponent | undefined {
  const data = entity.components[SCRIPT_INTERFACES_COMPONENT];
  if (!data || !Array.isArray(data.interfaces)) return undefined;
  const interfaces = data.interfaces.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return interfaces.length > 0 ? { interfaces } : undefined;
}

/** Reads placed Actor Script instance metadata used by world queries. */
export function readScriptActorComponent(entity: Entity): ScriptActorComponent | undefined {
  const data = entity.components[SCRIPT_ACTOR_COMPONENT];
  if (!data || typeof data.classRef !== "string" || data.classRef.length === 0) return undefined;
  const component: ScriptActorComponent = { classRef: data.classRef };
  if (typeof data.nodeId === "string" && data.nodeId.length > 0) component.nodeId = data.nodeId;
  if (data.variables && typeof data.variables === "object" && !Array.isArray(data.variables)) {
    const variables: Record<string, import("./layout").MetadataValue> = {};
    for (const [key, value] of Object.entries(data.variables)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        variables[key] = value;
      } else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        variables[key] = value;
      }
    }
    if (Object.keys(variables).length > 0) component.variables = variables;
  }
  return component;
}

function readScriptReferenceSelector(
  value: SceneJsonValue | undefined,
): ScriptReferenceSelectorComponent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, SceneJsonValue>;
  const selector: ScriptReferenceSelectorComponent = {};
  if (typeof input.byNodeId === "string" && input.byNodeId.length > 0) {
    selector.byNodeId = input.byNodeId;
  }
  if (typeof input.byName === "string" && input.byName.length > 0) selector.byName = input.byName;
  if (typeof input.byTag === "string" && input.byTag.length > 0) selector.byTag = input.byTag;
  if (typeof input.byClassRef === "string" && input.byClassRef.length > 0) {
    selector.byClassRef = input.byClassRef;
  }
  if (typeof input.byInterface === "string" && input.byInterface.length > 0) {
    selector.byInterface = input.byInterface;
  }
  return Object.keys(selector).length > 0 ? selector : undefined;
}

/** Reads class-authored reference selectors from an entity. */
export function readScriptReferencesComponent(entity: Entity): ScriptReferencesComponent | undefined {
  const data = entity.components[SCRIPT_REFERENCES_COMPONENT];
  if (!data || !Array.isArray(data.references)) return undefined;
  const references: ScriptReferenceComponentEntry[] = [];
  for (const raw of data.references) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, SceneJsonValue>;
    if (typeof record.key !== "string" || record.key.length === 0) continue;
    const selector = readScriptReferenceSelector(record.selector);
    if (!selector) continue;
    references.push({ key: record.key, selector });
  }
  return references.length > 0 ? { references } : undefined;
}

/** Reads message dispatcher metadata advertised by a script-authored entity. */
export function readScriptDispatchersComponent(entity: Entity): ScriptDispatchersComponent | undefined {
  const data = entity.components[SCRIPT_DISPATCHERS_COMPONENT];
  if (!data || !Array.isArray(data.dispatchers)) return undefined;
  const dispatchers: ScriptDispatcherComponentEntry[] = [];
  for (const raw of data.dispatchers) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, SceneJsonValue>;
    if (typeof record.name !== "string" || record.name.length === 0) continue;
    const payload: Record<string, string> = {};
    if (record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)) {
      for (const [key, value] of Object.entries(record.payload)) {
        if (typeof value === "string" && value.length > 0) payload[key] = value;
      }
    }
    dispatchers.push({ name: record.name, payload });
  }
  return dispatchers.length > 0 ? { dispatchers } : undefined;
}

const COLLIDER_SHAPES: readonly ColliderShape[] = [
  "box",
  "sphere",
  "capsule",
  "cylinder",
  "cone",
  "convex",
  "trimesh",
];

/** Parses the optional compound-collider `primitives` array. */
function readColliderPrimitives(
  value: SceneJsonValue | undefined,
): ColliderPrimitive[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const primitives: ColliderPrimitive[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, SceneJsonValue>;
    if (
      typeof record.shape !== "string" ||
      !COLLIDER_SHAPES.includes(record.shape as ColliderShape)
    ) {
      continue;
    }
    const size = readVec3(record.size);
    if (!size) continue;
    const primitive: ColliderPrimitive = { shape: record.shape as ColliderShape, size };
    const center = readVec3(record.center);
    if (center) primitive.center = center;
    const rotation = readVec3(record.rotation);
    if (rotation) primitive.rotation = rotation;
    if (Array.isArray(record.points)) {
      const points = record.points
        .map((point) => readVec3(point))
        .filter((point): point is Vec3 => point !== undefined);
      if (points.length > 0) primitive.points = points;
    }
    if (Array.isArray(record.vertices)) {
      const vertices = record.vertices
        .map((point) => readVec3(point))
        .filter((point): point is Vec3 => point !== undefined);
      if (vertices.length > 0) primitive.vertices = vertices;
    }
    if (Array.isArray(record.indices)) {
      const indices = record.indices.filter(
        (index): index is number =>
          typeof index === "number" && Number.isInteger(index) && index >= 0,
      );
      if (indices.length > 0) primitive.indices = indices;
    }
    primitives.push(primitive);
  }
  return primitives.length > 0 ? primitives : undefined;
}

/** Reads a typed collider from an entity's serializable component data. */
export function readColliderComponent(entity: Entity): ColliderComponent | undefined {
  const data = entity.components[COLLIDER_COMPONENT];
  if (!data) return undefined;
  if (typeof data.shape !== "string" || !COLLIDER_SHAPES.includes(data.shape as ColliderShape)) {
    return undefined;
  }
  const shape = data.shape as ColliderShape;
  const authoredSize = readVec3(data.size);
  const capsuleRadius =
    shape === "capsule" ? readFiniteNumber(data.capsuleRadius, NaN, 0) : NaN;
  const capsuleHalfHeight =
    shape === "capsule" ? readFiniteNumber(data.capsuleHalfHeight, NaN, 0) : NaN;
  const capsule =
    shape === "capsule" && Number.isFinite(capsuleRadius) && Number.isFinite(capsuleHalfHeight)
      ? resolveCapsuleDimensions(capsuleRadius, capsuleHalfHeight)
      : null;
  const size = capsule?.size ?? authoredSize;
  if (!size) return undefined;
  if (typeof data.isStatic !== "boolean" || typeof data.isSensor !== "boolean") return undefined;
  const center = readVec3(data.center) ?? capsule?.center;
  const component: ColliderComponent = {
    shape,
    size,
    isStatic: data.isStatic,
    isSensor: data.isSensor,
  };
  if (capsule) {
    component.capsuleRadius = capsule.radius;
    component.capsuleHalfHeight = capsule.halfHeight;
  }
  if (center) component.center = center;
  if (typeof data.hideInGame === "boolean") component.hideInGame = data.hideInGame;
  const primitives = readColliderPrimitives(data.primitives);
  if (primitives) component.primitives = primitives;
  if (typeof data.friction === "number") component.friction = data.friction;
  if (typeof data.restitution === "number") component.restitution = data.restitution;
  if (isNavigationRole(data.navigationRole)) component.navigationRole = data.navigationRole;
  if (typeof data.generateOverlapEvents === "boolean") {
    component.generateOverlapEvents = data.generateOverlapEvents;
  }
  if (typeof data.simulationGeneratesHitEvents === "boolean") {
    component.simulationGeneratesHitEvents = data.simulationGeneratesHitEvents;
  }
  if (typeof data.collisionGroups === "number") component.collisionGroups = data.collisionGroups;
  if (typeof data.simulatePhysics === "boolean") component.simulatePhysics = data.simulatePhysics;
  if (typeof data.massKg === "number") component.massKg = data.massKg;
  if (typeof data.linearDamping === "number") component.linearDamping = data.linearDamping;
  if (typeof data.angularDamping === "number") component.angularDamping = data.angularDamping;
  if (typeof data.enableGravity === "boolean") component.enableGravity = data.enableGravity;
  const lockPosition = readPhysicsAxisLocks(data.lockPosition);
  if (lockPosition) component.lockPosition = lockPosition;
  const lockRotation = readPhysicsAxisLocks(data.lockRotation);
  if (lockRotation) component.lockRotation = lockRotation;
  return component;
}

/**
 * Reads a typed moving-platform component. Tolerant: a present-but-malformed
 * field degrades to a safe default (zero offset / speed = a stationary movable
 * platform) rather than rejecting the component, so a movable collider is never
 * left without a motion record (which would make it fall out of both the static
 * and moving blocker sets). Returns undefined only when the component is absent.
 */
export function readMovingPlatformComponent(entity: Entity): MovingPlatformComponent | undefined {
  const data = entity.components[MOVING_PLATFORM_COMPONENT];
  if (!data) return undefined;
  const offset = readVec3(data.offset) ?? [0, 0, 0];
  const speed = Math.max(0, readFiniteNumber(data.speed, 0, undefined));
  const startPhase = Math.min(Math.max(readFiniteNumber(data.startPhase, 0, undefined), 0), 1);
  return { offset, speed, startPhase };
}

/** Reads a tolerant path-follower component; malformed data simply does not move. */
export function readSplinePathFollowerComponent(entity: Entity): SplinePathFollowerComponent | undefined {
  const data = entity.components[SPLINE_PATH_FOLLOWER_COMPONENT];
  if (!data || typeof data.splineId !== "string" || data.splineId.length === 0) return undefined;
  const wrapMode = data.wrapMode === "loop" || data.wrapMode === "pingPong" ? data.wrapMode : "clamp";
  return {
    splineId: data.splineId,
    speed: Math.max(0, readFiniteNumber(data.speed, 0, undefined)),
    startDistance: readFiniteNumber(data.startDistance, 0, undefined),
    wrapMode,
    reverse: data.reverse === true,
    orientToSpline: data.orientToSpline !== false,
    orientationOffset: readVec3(data.orientationOffset) ?? [0, 0, 0],
    positionOffset: readVec3(data.positionOffset) ?? [0, 0, 0],
    applyPitch: data.applyPitch !== false,
    applyRoll: data.applyRoll !== false,
    enabled: data.enabled !== false,
  };
}

/**
 * Reads a typed audio cue from an entity's serializable component data.
 *
 * Tolerant of partial component data: an Actor Blueprint Audio component stores
 * only the props the author set (no adapter defaults are applied on the actor
 * path), so `volume`/`loop`/`spatial` may be absent and default here (1/false/
 * false). The only hard requirement is something to play — a raw `clipId` OR a
 * Sound Cue `sourceId` (a cue resolves its own clips, so `clipId` may be absent).
 */
export function readAudioComponent(entity: Entity): AudioComponent | undefined {
  const data = entity.components[AUDIO_COMPONENT];
  if (!data) return undefined;
  const clipId = typeof data.clipId === "string" ? data.clipId : "";
  const isCueSource =
    data.sourceType === "soundCue" && typeof data.sourceId === "string" && data.sourceId.length > 0;
  if (clipId.length === 0 && !isCueSource) return undefined;
  const component: AudioComponent = {
    clipId,
    volume: typeof data.volume === "number" && Number.isFinite(data.volume) ? data.volume : 1,
    loop: data.loop === true,
    spatial: data.spatial === true,
  };
  if (typeof data.sourceId === "string" && data.sourceId.length > 0) component.sourceId = data.sourceId;
  if (data.sourceType === "sound" || data.sourceType === "soundCue") {
    component.sourceType = data.sourceType;
  }
  if (typeof data.pitch === "number" && Number.isFinite(data.pitch)) component.pitch = data.pitch;
  if (typeof data.refDistance === "number" && Number.isFinite(data.refDistance)) {
    component.refDistance = data.refDistance;
  }
  if (typeof data.maxDistance === "number" && Number.isFinite(data.maxDistance)) {
    component.maxDistance = data.maxDistance;
  }
  if (typeof data.rolloff === "number" && Number.isFinite(data.rolloff)) component.rolloff = data.rolloff;
  if (typeof data.autoPlay === "boolean") component.autoPlay = data.autoPlay;
  return component;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Reads a typed particle emitter from an entity's serializable component data.
 * Only the small §8 override set is honoured; legacy inline emitter fields
 * (`rate`, `lifetime`, `velocity`, …) are no longer part of the contract and are
 * silently dropped, since the effect asset owns that behaviour.
 */
export function readParticleEmitterComponent(
  entity: Entity,
): ParticleEmitterComponent | undefined {
  const data = entity.components[PARTICLE_EMITTER_COMPONENT];
  if (!data) return undefined;
  if (typeof data.effectId !== "string" || data.effectId.length === 0) return undefined;
  const component: ParticleEmitterComponent = { effectId: data.effectId };
  if (typeof data.enabled === "boolean") component.enabled = data.enabled;
  if (typeof data.autoPlay === "boolean") component.autoPlay = data.autoPlay;
  if (typeof data.scale === "number" && Number.isFinite(data.scale) && data.scale > 0) {
    component.scale = data.scale;
  }
  if (typeof data.tint === "string" && HEX_COLOR.test(data.tint)) component.tint = data.tint;
  if (typeof data.loop === "boolean") component.loop = data.loop;
  return component;
}

/** Reads a typed interaction marker from an entity's serializable component data. */
export function readInteractionComponent(entity: Entity): InteractionComponent | undefined {
  const data = entity.components[INTERACTION_COMPONENT];
  if (!data) return undefined;
  if (typeof data.action !== "string" || data.action.length === 0) return undefined;
  const component: InteractionComponent = { action: data.action };
  if (typeof data.prompt === "string") component.prompt = data.prompt;
  if (typeof data.enabled === "boolean") component.enabled = data.enabled;
  if (typeof data.requires === "string") component.requires = data.requires;
  if (typeof data.cooldown === "number") component.cooldown = data.cooldown;
  return component;
}

function readStringArray(value: SceneJsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function readSmartObjectSlots(value: SceneJsonValue | undefined): SmartObjectSlot[] {
  if (!Array.isArray(value)) return [];
  const slots: SmartObjectSlot[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const data = entry as Record<string, SceneJsonValue>;
    if (typeof data.id !== "string" || data.id.length === 0 || seen.has(data.id)) continue;
    seen.add(data.id);
    const slot: SmartObjectSlot = { id: data.id };
    const tags = readStringArray(data.tags);
    if (tags.length > 0) slot.tags = tags;
    const position = readVec3(data.position);
    if (position) slot.position = position;
    slots.push(slot);
  }
  return slots;
}

/** Reads authored AI smart-object data from an entity. */
export function readSmartObjectComponent(entity: Entity): SmartObjectComponent | undefined {
  const data = entity.components[SMART_OBJECT_COMPONENT];
  if (!data) return undefined;
  const tags = readStringArray(data.tags);
  const slots = readSmartObjectSlots(data.slots);
  const interactionPosition = readVec3(data.interactionPosition);
  if (tags.length === 0 && slots.length === 0 && !interactionPosition) return undefined;
  const component: SmartObjectComponent = { tags, slots };
  if (interactionPosition) component.interactionPosition = interactionPosition;
  if (typeof data.cooldown === "number" && Number.isFinite(data.cooldown) && data.cooldown >= 0) {
    component.cooldown = data.cooldown;
  }
  if (typeof data.enabled === "boolean") component.enabled = data.enabled;
  return component;
}

const CHARACTER_MOVEMENT_MODES: readonly CharacterMovementMode[] = [
  "walking",
  "falling",
  "flying",
  "swimming",
  "custom",
];

function readFiniteNumber(
  value: SceneJsonValue | undefined,
  fallback: number,
  minExclusive?: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (minExclusive !== undefined && value <= minExclusive) return fallback;
  return value;
}

/** Reads a typed character movement component from an entity. */
export function readCharacterMovementComponent(
  entity: Entity,
): CharacterMovementComponent | undefined {
  const data = entity.components[CHARACTER_MOVEMENT_COMPONENT];
  if (!data) return undefined;
  const mode =
    typeof data.movementMode === "string" &&
    CHARACTER_MOVEMENT_MODES.includes(data.movementMode as CharacterMovementMode)
      ? (data.movementMode as CharacterMovementMode)
      : "walking";
  return {
    maxWalkSpeed: readFiniteNumber(data.maxWalkSpeed, 3, 0),
    sprintMultiplier: readFiniteNumber(data.sprintMultiplier, 2, 0),
    jumpSpeed: readFiniteNumber(data.jumpSpeed, 4, 0),
    gravityScale: readFiniteNumber(data.gravityScale, 1),
    airControl: readFiniteNumber(data.airControl, 0.25),
    acceleration: readFiniteNumber(data.acceleration, 30, 0),
    brakingDeceleration: readFiniteNumber(data.brakingDeceleration, 24, 0),
    groundFriction: readFiniteNumber(data.groundFriction, 8, 0),
    rotationRate: readVec3(data.rotationRate) ?? [0, 0, 500],
    orientRotationToMovement: data.orientRotationToMovement !== false,
    orientRotationToControl: data.orientRotationToControl === true,
    movementMode: mode,
    capsuleRadius: readFiniteNumber(data.capsuleRadius, 0.3, 0),
    capsuleHalfHeight: readFiniteNumber(data.capsuleHalfHeight, 0.9, 0),
    maxStepHeight: readFiniteNumber(data.maxStepHeight, 0.45, 0),
    maxStepDown: readFiniteNumber(data.maxStepDown, 0.5, 0),
    maxSlopeAngleDeg: readFiniteNumber(data.maxSlopeAngleDeg, 45, 0),
    uphillSpeedScale: readFiniteNumber(data.uphillSpeedScale, 0.65, 0),
    stepSmoothSpeed: readFiniteNumber(data.stepSmoothSpeed, 6, 0),
  };
}

/** Reads a typed camera viewpoint from an entity's serializable component data. */
export function readCameraComponent(entity: Entity): CameraComponent | undefined {
  const data = entity.components[CAMERA_COMPONENT];
  if (!data) return undefined;
  return {
    fieldOfView: readFiniteNumber(data.fieldOfView, 44, 0),
    nearClip: readFiniteNumber(data.nearClip, 0.1, 0),
    farClip: readFiniteNumber(data.farClip, 100, 0),
    isOrthographic: data.isOrthographic === true,
    orthoWidth: readFiniteNumber(data.orthoWidth, 10, 0),
    enableSprintCameraShake: data.enableSprintCameraShake !== false,
  };
}

/** Reads a typed camera-boom (spring arm) from an entity's serializable data. */
export function readSpringArmComponent(entity: Entity): SpringArmComponent | undefined {
  const data = entity.components[SPRING_ARM_COMPONENT];
  if (!data) return undefined;
  return {
    targetArmLength: readFiniteNumber(data.targetArmLength, 3, 0),
    socketOffset: readVec3(data.socketOffset) ?? [0, 0, 0],
    targetOffset: readVec3(data.targetOffset) ?? [0, 0, 0],
    enableCameraLag: data.enableCameraLag === true,
    cameraLagSpeed: readFiniteNumber(data.cameraLagSpeed, 10, 0),
    doCollisionTest: data.doCollisionTest !== false,
  };
}

function readPerceptionConfig(value: SceneJsonValue | undefined): AIPerceptionConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, SceneJsonValue>;
  const config: AIPerceptionConfig = {};
  if (typeof data.sightRadius === "number" && Number.isFinite(data.sightRadius)) {
    config.sightRadius = data.sightRadius;
  }
  if (typeof data.nearSightRadius === "number" && Number.isFinite(data.nearSightRadius)) {
    config.nearSightRadius = data.nearSightRadius;
  }
  if (typeof data.fieldOfViewDeg === "number" && Number.isFinite(data.fieldOfViewDeg)) {
    config.fieldOfViewDeg = data.fieldOfViewDeg;
  }
  if (typeof data.hearingRadius === "number" && Number.isFinite(data.hearingRadius)) {
    config.hearingRadius = data.hearingRadius;
  }
  if (
    typeof data.targetLostGraceSeconds === "number" &&
    Number.isFinite(data.targetLostGraceSeconds) &&
    data.targetLostGraceSeconds >= 0
  ) {
    config.targetLostGraceSeconds = data.targetLostGraceSeconds;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function readNavAgentConfig(value: SceneJsonValue | undefined): AINavAgentConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, SceneJsonValue>;
  const config: AINavAgentConfig = {};
  if (typeof data.radius === "number" && Number.isFinite(data.radius)) config.radius = data.radius;
  if (typeof data.height === "number" && Number.isFinite(data.height)) config.height = data.height;
  if (typeof data.maxSpeed === "number" && Number.isFinite(data.maxSpeed)) config.maxSpeed = data.maxSpeed;
  if (typeof data.clearancePadding === "number" && Number.isFinite(data.clearancePadding)) {
    config.clearancePadding = data.clearancePadding;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Reads an AIController marker from an entity. Presence of the component (even
 * with no props) makes the entity an AI-controlled pawn; the AISubsystem uses
 * that to derive a controller. Returns undefined only when the component is absent.
 */
export function readAIControllerComponent(entity: Entity): AIControllerComponent | undefined {
  const data = entity.components[AI_CONTROLLER_COMPONENT];
  if (!data) return undefined;
  const component: AIControllerComponent = {};
  if (typeof data.behaviorTree === "string" && data.behaviorTree.length > 0) {
    component.behaviorTree = data.behaviorTree;
  }
  if (typeof data.stateTree === "string" && data.stateTree.length > 0) {
    component.stateTree = data.stateTree;
  }
  if (typeof data.blackboard === "string" && data.blackboard.length > 0) {
    component.blackboard = data.blackboard;
  }
  const perception = readPerceptionConfig(data.perception);
  if (perception) component.perception = perception;
  const navAgent = readNavAgentConfig(data.navAgent);
  if (navAgent) component.navAgent = navAgent;
  const patrolRoute = readAiPatrolRoute(data.patrolRoute);
  if (patrolRoute) component.patrolRoute = patrolRoute;
  const blackboardKeys = normalizeBlackboardKeys(data.blackboardKeys);
  if (blackboardKeys.length > 0) component.blackboardKeys = blackboardKeys;
  return component;
}

function readAiPatrolRoute(value: SceneJsonValue | undefined): AiPatrolRoute | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, SceneJsonValue>;
  const source: AiPatrolRouteSource = data.source === "spline" ? "spline" : "targetPoints";
  const route: AiPatrolRoute = {
    source,
    entry: data.entry === "start" ? "start" : "nearest",
    lookAheadDistance: readFiniteNumber(data.lookAheadDistance, DEFAULT_AI_PATROL_ROUTE.lookAheadDistance, 0),
    wrapMode:
      data.wrapMode === "pingPong" || data.wrapMode === "clamp" ? data.wrapMode : "loop",
  };
  if (typeof data.splineId === "string" && data.splineId.length > 0) route.splineId = data.splineId;
  if (typeof data.targetPointTag === "string" && data.targetPointTag.length > 0) {
    route.targetPointTag = data.targetPointTag;
  }
  const speed = readOptionalNonNegativeFiniteNumber(data.speed);
  if (speed !== undefined) route.speed = speed;
  const acceptanceRadius = readOptionalNonNegativeFiniteNumber(data.acceptanceRadius);
  if (acceptanceRadius !== undefined) route.acceptanceRadius = acceptanceRadius;
  return route;
}

function readOptionalNonNegativeFiniteNumber(value: SceneJsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

const LIGHT_TYPES: readonly SceneLightType[] = ["directional", "point", "spot"];

/** Reads a typed light from an entity's serializable component data. */
export function readLightComponent(entity: Entity): LightComponent | undefined {
  const data = entity.components[LIGHT_COMPONENT];
  if (!data) return undefined;
  if (typeof data.type !== "string" || !LIGHT_TYPES.includes(data.type as SceneLightType)) {
    return undefined;
  }
  const component: LightComponent = { type: data.type as SceneLightType };
  if (typeof data.color === "string") component.color = data.color;
  if (typeof data.intensity === "number") component.intensity = data.intensity;
  if (typeof data.castShadow === "boolean") component.castShadow = data.castShadow;
  if (typeof data.distance === "number") component.distance = data.distance;
  if (typeof data.angle === "number") component.angle = data.angle;
  if (typeof data.penumbra === "number") component.penumbra = data.penumbra;
  if (typeof data.decay === "number") component.decay = data.decay;
  return component;
}
