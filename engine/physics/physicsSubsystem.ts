import {
  StaticSpatialIndex,
  compareStaticEntries,
  staticCellOf,
  staticEntryOverlapsSquare,
  type StaticSpatialEntry,
} from "./staticSpatialIndex";
import {
  HeightfieldStaticSource,
  forEachHeightfieldTriangle,
  heightfieldSupportsOnDemand,
  type HeightfieldCellEntries,
} from "./heightfieldStatic";
import { classifyStaticTriangle } from "./staticTriangles";
import { sampleTriangleHeight, type GroundSurfaceSample } from "../movement/slopeSurface";
import type { EngineUpdateContext, Subsystem } from "../core/Subsystem";
import {
  readColliderComponent,
  readTransformComponent,
  VEHICLE_COMPONENT,
  type ColliderComponent,
  type ColliderPrimitive,
  type TransformComponent,
} from "../scene/components";
import { interactionGroupsInteract, type NavigationRole } from "../scene/collision";
import { rotatePointAboutOrigin, rotatedBoxAabb, rotatedBoxFootprintXZ } from "./rotatedBox";
import { FixedStepClock, lerpPosition, nlerpQuaternion, type PoseQuat } from "./fixedStep";
import { computeVehicleDrive } from "./vehicle/vehicleDrive";
import { vehicleWheelWidth } from "./surface/sinkage";
import {
  computeWheelSurfaceResponse, type VehicleGroundSinkProvider, type VehicleSurfaceProvider,
} from "./surface/surfaceResponse";
import { bellyDragImpulse, slewSinkDepth, tractionSlip, wheelSinkLimit } from "./surface/wheelSink";
import { computeVehicleAerodynamics, initialVehicleDrivetrainState } from "./vehicle/vehicleDrivetrain";
import {
  NEUTRAL_VEHICLE_INPUT,
  vehicleDefinitionFromComponent,
  type VehicleDefinition,
  type VehicleDrivetrainState,
  type VehicleInput,
  type VehicleMotionState,
  type VehicleState,
  type VehicleVec3,
} from "./vehicle/vehicleTypes";
import type { Entity, EntityId } from "../scene/entity";
import type {
  PhysicsAabb,
  PhysicsContact,
  PhysicsQuery,
  PhysicsSurfaceTriangle,
} from "../behavior/behaviorSubsystem";
import type { Vec3 } from "../scene/layout";
import {
  ragdollJointAngularLimits,
  RAGDOLL_COLLISION_GROUPS,
  type QuatXYZW,
  type RagdollGroupDesc,
  type RagdollJointDesc,
  type RagdollPose,
} from "./ragdoll";

/**
 * Raw Rapier joint-set angular-limit setter. `RawImpulseJointSet.jointSetLimits`
 * is typed but its `RawJointAxis` enum isn't exported, so we reach it through this
 * minimal structural type with plain axis indices (AngX=3, AngY=4, AngZ=5).
 */
interface RawAngularLimitSetter {
  jointSetLimits(handle: number, axis: number, min: number, max: number): void;
}
const RAW_JOINT_AXIS_ANG_X = 3;
const RAW_JOINT_AXIS_ANG_Y = 4;
const RAW_JOINT_AXIS_ANG_Z = 5;

export const PHYSICS_SUBSYSTEM_ID = "physics";
/** Collider surface defaults when no physical material is assigned. */
const DEFAULT_FRICTION = 0.8;
const DEFAULT_RESTITUTION = 0;
export type PhysicsBackend = "placeholder" | "rapier";
export type PhysicsTransformSink = (entityId: EntityId, transform: TransformComponent) => void;

export interface PhysicsSubsystemOptions {
  backend?: PhysicsBackend;
  /** Rapier simulation slice in seconds (default 1/60); see {@link FixedStepClock}. */
  fixedTimestep?: number;
  /** Max Rapier slices per frame (default 4); a longer frame drops its backlog. */
  maxSubstepsPerFrame?: number;
}

/** Optional Phase 7 policy for dynamically simulated bodies in large worlds. */
export interface DynamicPhysicsActiveAreaSettings {
  /** Runtime-owned focus point, normally the possessed pawn. */
  focusPosition?: () => readonly [number, number, number] | null;
  /** Dynamic bodies farther than this distance are suspended until focus returns. */
  activeDistance?: number;
}

interface PhysicsBody {
  id: EntityId;
  transform: TransformComponent;
  collider: ColliderComponent;
  /** From the entity's `Vehicle` component: the body becomes a vehicle chassis. */
  vehicle?: VehicleDefinition;
}

interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
  navigationRole?: NavigationRole;
  /** Oriented XZ ground silhouette for a rotated box collider (see {@link PhysicsAabb}). */
  footprint?: readonly (readonly [number, number])[];
}

interface StaticBodyRecord {
  readonly order: number;
  readonly blockers: StaticSpatialEntry<Aabb>[];
  readonly surfaces: StaticSpatialEntry<PhysicsSurfaceTriangle>[];
  readonly navigationRole: NavigationRole | undefined;
  /** Heightfield primitives answered on demand instead of filed into the index; after the body's other items. */
  readonly fields: HeightfieldStaticSource[];
}

type RapierModule = typeof import("@dimforge/rapier3d-compat");
type RapierWorld = InstanceType<RapierModule["World"]>;
type RapierRigidBody = ReturnType<RapierWorld["createRigidBody"]>;
type RapierCollider = ReturnType<RapierWorld["createCollider"]>;
type RapierImpulseJoint = ReturnType<RapierWorld["createImpulseJoint"]>;
type RapierVehicleController = ReturnType<RapierWorld["createVehicleController"]>;

/**
 * A ray-cast vehicle bound to a dynamic chassis entity. The definition and the
 * driver state outlive a world rebuild; the controller is re-created on the
 * new world's chassis body.
 */
interface VehicleRecord {
  readonly entityId: EntityId;
  readonly definition: VehicleDefinition;
  /** `component`: built from the entity's `Vehicle` component; `api`: `createVehicle`. */
  readonly source: "component" | "api";
  controller: RapierVehicleController | null;
  input: VehicleInput;
  /** Smoothed steering input (-1..1). */
  steer: number;
  drivetrain: VehicleDrivetrainState | null;
  /** The driving pedal of the latest slice (0..1); see `VehicleDriveResult.engineLoad`. */
  engineLoad: number;
  /** Applied virtual sink per wheel (m), slew-limited toward the provider's depth. */
  sink: number[];
  /** Deepest sink per wheel before the chassis would touch the terrain collider. */
  sinkLimits: number[];
  /** Per-wheel `tractionSlip` read back after the latest slice. */
  tractionSlip: number[];
}

interface RapierBodyRecord {
  id: EntityId;
  body: RapierRigidBody;
  /** One or more colliders (compound when the entity has authored primitives). */
  colliders: RapierCollider[];
  isSensor: boolean;
}

/** A dynamic body's simulated pose one fixed step back, the render blend's start. */
interface PreviousBodyPose {
  position: Vec3;
  rotation: PoseQuat;
}

interface SuspendedDynamicBody {
  linearVelocity: Vec3;
  angularVelocity: Vec3;
}

/** A spawned ragdoll's live Rapier bodies, keyed by their desc name. */
interface RagdollGroupRecord {
  id: number;
  bodies: Map<string, RapierRigidBody>;
}

export class PhysicsSubsystem implements Subsystem, PhysicsQuery {
  readonly id = PHYSICS_SUBSYSTEM_ID;
  private readonly backend: PhysicsBackend;
  private bodies: PhysicsBody[] = [];
  private readonly bodiesById = new Map<EntityId, PhysicsBody>();
  private readonly staticRecords = new Map<EntityId, StaticBodyRecord>();
  private readonly staticBlockerIndex = new StaticSpatialIndex<Aabb>();
  private readonly staticSurfaceIndex = new StaticSpatialIndex<PhysicsSurfaceTriangle>();
  /** Static records that carry on-demand heightfields, by entity id (a subset of `staticRecords`). */
  private readonly heightfieldRecords = new Map<EntityId, StaticBodyRecord>();
  private nextStaticOrder = 0;
  private staticInvalidations = 0;
  private staticRecordBuilds = 0;
  private blockerCandidatesInspected = 0;
  private contacts: PhysicsContact[] = [];
  /**
   * Entities whose collision is runtime-disabled (A6 SetActorEnableCollision).
   * They are skipped by contact generation and the movement-blocker/surface
   * collectors; with Rapier their colliders are also `setEnabled(false)`.
   */
  private collisionDisabled = new Set<EntityId>();
  /** Entities whose collider ignores the camera trace channel; rebuilt lazily. */
  private cameraIgnoredCache: Set<EntityId> | null = null;
  /** Cached movement blockers (static colliders don't move); rebuilt lazily. */
  private staticBlockerCache: Aabb[] | null = null;
  /** Cached walkable surface triangles (static trimesh); rebuilt lazily. */
  private staticSurfaceCache: PhysicsSurfaceTriangle[] | null = null;
  /** Cached AI-navigation blockers, filtered by Collider.navigationRole. */
  private staticNavigationBlockerCache: Aabb[] | null = null;
  /** Cached AI-navigation surfaces, filtered by Collider.navigationRole. */
  private staticNavigationSurfaceCache: PhysicsSurfaceTriangle[] | null = null;
  /** Identity changes even on terrain-only edits, so baked nav revisions still advance. */
  private staticNavigationNonHeightfieldSurfaceCache: PhysicsSurfaceTriangle[] | null = null;
  private rapierModule: RapierModule | null = null;
  private rapierWorld: RapierWorld | null = null;
  private rapierBodies = new Map<EntityId, RapierBodyRecord>();
  /** Far dynamic bodies deliberately put to sleep by the optional active-area policy. */
  private suspendedDynamicBodies = new Map<EntityId, SuspendedDynamicBody>();
  private dynamicActiveArea: DynamicPhysicsActiveAreaSettings = {};
  private rapierColliderToEntity = new Map<number, EntityId>();
  private ragdollGroups = new Map<number, RagdollGroupRecord>();
  private nextRagdollId = 1;
  private gravity: Vec3 = [0, -9.81, 0];
  private transformSink: PhysicsTransformSink | null = null;
  private enabled = true;
  private readonly stepClock: FixedStepClock;
  /** Rapier slices taken by the latest `update()` (0 on a frame shorter than a step). */
  private frameStepCount = 0;
  /** Dynamic poses before the latest slice, for render interpolation. */
  private previousPoses = new Map<EntityId, PreviousBodyPose>();
  private vehicles = new Map<EntityId, VehicleRecord>();
  private vehicleSurfaceProvider: VehicleSurfaceProvider | null = null;
  private vehicleGroundSinkProvider: VehicleGroundSinkProvider | null = null;

  constructor(options: PhysicsSubsystemOptions = {}) {
    this.backend = options.backend ?? "placeholder";
    this.stepClock = new FixedStepClock({
      step: options.fixedTimestep,
      maxSubsteps: options.maxSubstepsPerFrame,
    });
  }

  /** The fixed Rapier slice length in seconds. */
  fixedTimestep(): number {
    return this.stepClock.step;
  }

  /** How many fixed slices the latest `update()` simulated. */
  lastFrameStepCount(): number {
    return this.frameStepCount;
  }

  /** Installs optional wheel surface response; null restores authored behaviour. */
  setVehicleSurfaceProvider(provider: VehicleSurfaceProvider | null): void {
    this.vehicleSurfaceProvider = provider;
  }

  /**
   * Installs the soft-track depth source (TERRAIN_DEFORMATION Faz 3). Null
   * lets every sunk wheel climb back to its authored rest length at the slew rate.
   */
  setVehicleGroundSinkProvider(provider: VehicleGroundSinkProvider | null): void {
    this.vehicleGroundSinkProvider = provider;
  }

  /** Live collider profile reference for generic surface-provider hosts. */
  colliderPhysicalMaterialId(entityId: EntityId): string | undefined {
    return this.bodiesById.get(entityId)?.collider.physicalMaterialId;
  }

  /** Render blend (0..1) between the previous and latest simulated dynamic poses. */
  interpolationAlpha(): number {
    return this.stepClock.alpha;
  }

  /**
   * Turns a dynamic (`simulatePhysics`) entity into a ray-cast vehicle chassis:
   * its mass and centre of mass come from the definition, and each wheel is a
   * suspension ray. Returns false — leaving the body untouched — when Rapier is
   * not live or the entity is not a dynamic body. Replaces an existing vehicle
   * on the same entity.
   */
  createVehicle(entityId: EntityId, definition: VehicleDefinition): boolean {
    this.removeVehicle(entityId);
    const record: VehicleRecord = {
      entityId,
      definition,
      source: "api",
      controller: null,
      input: NEUTRAL_VEHICLE_INPUT,
      steer: 0,
      drivetrain: initialVehicleDrivetrainState(definition),
      engineLoad: 0,
      sink: [],
      sinkLimits: [],
      tractionSlip: [],
    };
    if (!this.attachVehicleController(record)) return false;
    this.vehicles.set(entityId, record);
    return true;
  }

  /** Detaches the vehicle controller; the chassis stays a plain dynamic body. */
  removeVehicle(entityId: EntityId): void {
    const record = this.vehicles.get(entityId);
    if (!record) return;
    if (record.controller) this.rapierWorld?.removeVehicleController(record.controller);
    this.vehicles.delete(entityId);
  }

  hasVehicle(entityId: EntityId): boolean {
    return this.vehicles.has(entityId);
  }

  /**
   * Teleports a vehicle to `transform` at rest — the "flip back onto the
   * wheels" reset every driving game needs. Velocities and steering are zeroed.
   */
  resetVehicle(entityId: EntityId, transform: TransformComponent): void {
    const record = this.vehicles.get(entityId);
    const rapier = this.rapierBodies.get(entityId);
    if (!record || !rapier) return;
    this.setEntityTransform(entityId, transform);
    rapier.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rapier.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    record.steer = 0;
    record.drivetrain = initialVehicleDrivetrainState(record.definition);
    record.engineLoad = 0;
  }

  /** The resolved definition a vehicle was built from, or null when not a vehicle. */
  vehicleDefinition(entityId: EntityId): VehicleDefinition | null {
    return this.vehicles.get(entityId)?.definition ?? null;
  }

  /**
   * The vehicle's velocities, handbrake and gearbox position, or null when the
   * id is not a live vehicle — the half of a save its pose does not cover.
   */
  vehicleMotion(entityId: EntityId): VehicleMotionState | null {
    const record = this.vehicles.get(entityId);
    const rapier = this.rapierBodies.get(entityId);
    if (!record || !rapier) return null;
    const linear = rapier.body.linvel();
    const angular = rapier.body.angvel();
    return {
      linearVelocity: [linear.x, linear.y, linear.z],
      angularVelocity: [angular.x, angular.y, angular.z],
      handbrake: record.input.handbrake,
      drivetrain: record.drivetrain
        ? { gear: record.drivetrain.gear, engineRpm: record.drivetrain.engineRpm }
        : null,
    };
  }

  /**
   * Puts a vehicle back where and how a save found it: teleported to
   * `transform`, moving at the saved velocities, on (or off) its handbrake and
   * in the saved gear. A gear the definition does not have, or a drivetrain on
   * a car that has none, falls back to the reset state; RPM is clamped to the
   * engine's range. Returns false when the id is not a live vehicle.
   */
  restoreVehicle(entityId: EntityId, transform: TransformComponent, motion: VehicleMotionState): boolean {
    const record = this.vehicles.get(entityId);
    const rapier = this.rapierBodies.get(entityId);
    if (!record || !rapier) return false;
    this.resetVehicle(entityId, transform);
    const [vx, vy, vz] = motion.linearVelocity;
    const [wx, wy, wz] = motion.angularVelocity;
    rapier.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    rapier.body.setAngvel({ x: wx, y: wy, z: wz }, true);
    record.input = { ...NEUTRAL_VEHICLE_INPUT, handbrake: motion.handbrake };
    const drivetrain = record.definition.drivetrain;
    const gear = motion.drivetrain?.gear ?? 0;
    const gearExists = gear === -1 || (gear >= 1 && gear <= (drivetrain?.transmission.forwardRatios.length ?? 0));
    if (drivetrain && motion.drivetrain && gearExists) {
      const { idleRpm, maxRpm } = drivetrain.engine;
      record.drivetrain = {
        gear,
        engineRpm: Math.min(maxRpm, Math.max(idleRpm, motion.drivetrain.engineRpm)),
        shiftTimeRemaining: 0,
      };
    }
    return true;
  }

  /** Every entity currently driven as a vehicle, in creation order. */
  vehicleEntityIds(): EntityId[] {
    return [...this.vehicles.keys()];
  }

  /**
   * The latest *simulated* pose of a dynamic body (not the render blend), or
   * null for static/kinematic/unknown entities. Hosts read it where the
   * entity's own Transform component is stale because physics moves the body.
   */
  simulatedTransform(entityId: EntityId): TransformComponent | null {
    const body = this.bodiesById.get(entityId);
    if (!body?.collider.simulatePhysics || !this.rapierBodies.has(entityId)) return null;
    return cloneTransform(body.transform);
  }

  /** Sets the driver intent the vehicle follows until the next call. */
  setVehicleInput(entityId: EntityId, input: VehicleInput): void {
    const record = this.vehicles.get(entityId);
    if (!record) return;
    const previous = record.input;
    record.input = { ...input };
    const active = input.throttle !== 0 || input.brake !== 0 || input.steer !== 0 || input.handbrake;
    const changed =
      input.throttle !== previous.throttle ||
      input.brake !== previous.brake ||
      input.steer !== previous.steer ||
      input.handbrake !== previous.handbrake;
    // A parked car sleeps and the ray-cast controller does not wake it on its
    // own — including a handbrake release on a slope, which must let it roll.
    if (active || changed) this.rapierBodies.get(entityId)?.body.wakeUp();
  }

  /** Live speed and per-wheel suspension readback, or null when not a vehicle. */
  vehicleState(entityId: EntityId): VehicleState | null {
    const record = this.vehicles.get(entityId);
    const controller = record?.controller;
    const rapier = this.rapierBodies.get(entityId);
    if (!record || !controller || !rapier) return null;
    return {
      forwardSpeed: chassisForwardSpeed(rapier.body),
      engineLoad: record.engineLoad,
      drivetrain: record.drivetrain ? { ...record.drivetrain } : null,
      wheels: record.definition.wheels.map((wheel, index) => {
        const inContact = controller.wheelIsInContact(index);
        const contact = inContact ? controller.wheelContactPoint(index) : null;
        const hardPoint = controller.wheelHardPoint(index);
        return {
          position: wheel.position,
          radius: wheel.radius,
          ...(wheel.visualNode ? { visualNode: wheel.visualNode } : {}),
          suspensionLength: controller.wheelSuspensionLength(index) ?? wheel.suspensionRestLength,
          suspensionForce: inContact ? Math.max(0, controller.wheelSuspensionForce(index) ?? 0) : 0,
          sinkDepth: record.sink[index] ?? 0,
          tractionSlip: record.tractionSlip[index] ?? 0,
          steering: controller.wheelSteering(index) ?? 0,
          rotation: controller.wheelRotation(index) ?? 0,
          inContact,
          groundEntityId: inContact ? this.vehicleWheelGroundEntity(controller, index) : null,
          contactPoint: contact ? [contact.x, contact.y, contact.z] : null,
          hardPoint: hardPoint ? [hardPoint.x, hardPoint.y, hardPoint.z] : null,
        };
      }),
    };
  }

  /**
   * Loads the Rapier runtime only when the scene actually needs it. The heavy
   * Rapier WASM/compat module (the `vendor-physics` chunk, ~2 MB) is pulled in
   * here via dynamic import, so a physics-free game never fetches it.
   *
   * Backend `"rapier"` is a *preference*: the real load is derived from scene
   * content. If the entities passed to `setEntities()` yielded no collider
   * bodies we stay on the placeholder backend — `update()` falls back to AABB
   * overlap when there is no `rapierWorld` — so only scenes with colliders pay
   * the cost. Relies on `setEntities()` running before `init()`, which is the
   * SceneApp / RuntimeSceneApp load order.
   */
  async init(): Promise<void> {
    if (this.backend !== "rapier" || this.bodies.length === 0) return;
    this.rapierModule = await import("@dimforge/rapier3d-compat");
    await this.rapierModule.init();
    this.rebuildRapierWorld();
  }

  /** True once the Rapier runtime has been loaded (i.e. the scene had colliders). */
  usesRapier(): boolean {
    return this.rapierModule !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setGravity(gravity: Vec3): void {
    this.gravity = [...gravity];
    if (this.rapierWorld) {
      this.rapierWorld.gravity = vectorFromVec3(this.gravity);
    }
  }

  setTransformSink(sink: PhysicsTransformSink | null): void {
    this.transformSink = sink;
  }

  /**
   * Configures the optional runtime-only active area for *dynamic* Rapier bodies.
   * Empty/invalid settings immediately restore every body the policy suspended;
   * static colliders and kinematic character bodies are never affected.
   */
  setDynamicActiveArea(settings: DynamicPhysicsActiveAreaSettings): void {
    this.dynamicActiveArea = { ...settings };
    if (!this.hasDynamicActiveArea()) this.resumeSuspendedDynamicBodies();
  }

  /** Presentation shares the last physics step's active-radius decision. */
  isDynamicBodyActive(entityId: EntityId): boolean {
    return !this.suspendedDynamicBodies.has(entityId);
  }

  setEntities(entities: readonly Entity[]): void {
    this.bodies = [];
    this.bodiesById.clear();
    for (const entity of entities) {
      if (this.bodiesById.has(entity.id)) continue;
      const body = bodyFromEntity(entity);
      if (!body) continue;
      this.bodies.push(body);
      this.bodiesById.set(body.id, body);
    }
    this.contacts = [];
    this.collisionDisabled.clear();
    this.suspendedDynamicBodies.clear();
    this.staticRecords.clear();
    this.heightfieldRecords.clear();
    this.staticBlockerIndex.clear();
    this.staticSurfaceIndex.clear();
    this.nextStaticOrder = 0;
    for (const body of this.bodies) this.recordStaticBody(body);
    this.invalidateStaticCaches();
    // Component vehicles are rebuilt from the new entity set; API ones persist.
    for (const [entityId, vehicle] of this.vehicles) {
      if (vehicle.source === "component") this.removeVehicle(entityId);
    }
    if (this.rapierModule) this.rebuildRapierWorld();
  }

  /** Incrementally adds one entity's collider body for runtime SpawnActor. */
  addEntity(entity: Entity): boolean {
    return this.addEntities([entity]) > 0;
  }

  /** Adds a batch in input order, invalidating legacy flat caches only once. */
  addEntities(entities: readonly Entity[]): number {
    let added = 0;
    let addedStatic = false;
    for (const entity of entities) {
      if (this.bodiesById.has(entity.id)) continue;
      const body = bodyFromEntity(entity);
      if (!body) continue;
      this.bodies.push(body);
      this.bodiesById.set(body.id, body);
      this.recordStaticBody(body);
      addedStatic ||= body.collider.isStatic;
      if (this.rapierWorld && this.rapierModule) this.addRapierBody(body);
      added += 1;
    }
    if (added > 0) this.contacts = [];
    if (addedStatic) this.invalidateStaticCaches();
    else if (added > 0) this.cameraIgnoredCache = null;
    return added;
  }

  setEntityTransform(entityId: EntityId, transform: TransformComponent): void {
    const body = this.bodiesById.get(entityId);
    if (!body) return;
    body.transform = cloneTransform(transform);
    if (body.collider.isStatic) {
      const record = this.staticRecords.get(entityId);
      if (record) this.indexStaticRecord(record, false);
      this.recordStaticBody(body, record?.order);
      this.invalidateStaticCaches();
    }
    const rapier = this.rapierBodies.get(entityId);
    if (!rapier) return;
    // A teleport must not render as a one-step slide from the old pose.
    this.previousPoses.delete(entityId);
    const translation = vectorFromTransform(transform);
    const rotation = quaternionFromEulerDegrees(transform.rotation);
    if (rapier.body.isKinematic()) {
      rapier.body.setNextKinematicTranslation(translation);
      rapier.body.setNextKinematicRotation(rotation);
    } else {
      rapier.body.setTranslation(translation, true);
      rapier.body.setRotation(rotation, true);
    }
  }

  /**
   * Removes a single entity's body from the world (runtime DestroyActor, A1),
   * incrementally so a destroy doesn't pay a full `setEntities` rebuild. Drops it
   * from the placeholder body list, clears any contact that referenced it (so the
   * very next query already reads empty), invalidates the static caches when a
   * static body left, and — when Rapier is live — frees the rigid body (its
   * colliders go with it) and forgets its collider→entity handles.
   */
  removeEntity(entityId: EntityId): void {
    this.removeEntities([entityId]);
  }

  /** Removes a batch with one body-list pass and one legacy-cache invalidation. */
  removeEntities(entityIds: readonly EntityId[]): void {
    const ids = new Set(entityIds);
    let removedStatic = false;
    for (const entityId of ids) {
      removedStatic ||= this.bodiesById.get(entityId)?.collider.isStatic === true;
      this.bodiesById.delete(entityId);
      this.dropStaticRecord(entityId);
      this.collisionDisabled.delete(entityId);
      this.suspendedDynamicBodies.delete(entityId);
      this.previousPoses.delete(entityId);
      this.removeVehicle(entityId);
      const record = this.rapierBodies.get(entityId);
      if (record) {
        for (const collider of record.colliders) this.rapierColliderToEntity.delete(collider.handle);
        this.rapierWorld?.removeRigidBody(record.body);
        this.rapierBodies.delete(entityId);
      }
    }
    this.bodies = this.bodies.filter((body) => !ids.has(body.id));
    this.contacts = this.contacts.filter((contact) => !ids.has(contact.a) && !ids.has(contact.b));
    if (removedStatic) this.invalidateStaticCaches();
    else this.cameraIgnoredCache = null;
  }

  /**
   * Runtime collision toggle (A6 `SetActorEnableCollision`). A disabled entity is
   * dropped from contact generation and from the movement blockers/surfaces (so a
   * possessed pawn walks through an opened door), and — when Rapier is live — its
   * colliders are `setEnabled(false)` so the dynamic simulation ignores them too.
   * The entity keeps its body record and transform, so re-enabling restores the
   * original collider without a rebuild. No-op when the state is unchanged.
   */
  setEntityCollisionEnabled(entityId: EntityId, enabled: boolean): void {
    const alreadyDisabled = this.collisionDisabled.has(entityId);
    if (enabled === !alreadyDisabled) return;
    if (enabled) this.collisionDisabled.delete(entityId);
    else this.collisionDisabled.add(entityId);
    const body = this.bodiesById.get(entityId);
    if (body?.collider.isStatic) {
      const record = this.staticRecords.get(entityId);
      if (record) this.indexStaticRecord(record, enabled);
      this.invalidateStaticCaches();
    }
    // Clear any live contact for this entity so the next query already reads the
    // new state (mirrors removeEntity); the placeholder loop won't regenerate it.
    this.contacts = this.contacts.filter(
      (contact) => contact.a !== entityId && contact.b !== entityId,
    );
    const record = this.rapierBodies.get(entityId);
    if (record) {
      for (const collider of record.colliders) collider.setEnabled(enabled);
    }
  }

  /** False while {@link setEntityCollisionEnabled} has the entity switched off. */
  isEntityCollisionEnabled(entityId: EntityId): boolean {
    return !this.collisionDisabled.has(entityId);
  }

  contactsForEntity(entityId: EntityId): readonly PhysicsContact[] {
    return this.contacts.filter((contact) => contact.a === entityId || contact.b === entityId);
  }

  /**
   * World-space AABBs of every static, non-sensor collider — the movement
   * blockers fed to `resolvePlanarMovement`. A compound collider contributes one
   * AABB per primitive, and a `trimesh` primitive (complexAsSimple) contributes
   * one AABB per triangle, so the player collides with the actual footprint (e.g.
   * walks into an L-shaped wall's concave corner) instead of an enclosing box.
   * Cached because static colliders don't move.
   */
  staticBlockerAabbs(): readonly PhysicsAabb[] {
    if (this.staticBlockerCache) return this.staticBlockerCache;
    const blockers: Aabb[] = [];
    for (const [id, record] of this.staticRecords) {
      if (this.collisionDisabled.has(id)) continue;
      for (const entry of record.blockers) blockers.push(entry.value);
      for (const field of record.fields) for (const blocker of field.allBlockers()) blockers.push(blocker as Aabb);
    }
    this.staticBlockerCache = blockers;
    return blockers;
  }

  /**
   * Camera trace along `from → to` against the static world — Unreal's Camera
   * channel: fixed, non-sensor colliders whose profile does not ignore the
   * camera. Returns the fraction (0..1) of the segment at which the first one is
   * hit, or null when the view is clear. Moving bodies (dynamic, kinematic) never
   * block, so a car's own chassis or a passing crate does not yank the view;
   * neither does a collider switched off with `setEntityCollisionEnabled`.
   * Null without a Rapier world: the exact shapes live there, and the AABB
   * blockers would pull the camera in at every rotated ramp.
   */
  traceCamera(from: Vec3, to: Vec3): number | null {
    const RAPIER = this.rapierModule;
    const world = this.rapierWorld;
    if (!RAPIER || !world) return null;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dy, dz);
    if (!(length > 1e-6)) return null;
    const ray = new RAPIER.Ray(
      { x: from[0], y: from[1], z: from[2] },
      { x: dx / length, y: dy / length, z: dz / length },
    );
    const ignored = this.cameraIgnoredEntities();
    const hit = world.castRay(
      ray,
      length,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
        RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      undefined,
      ignored.size === 0 && this.collisionDisabled.size === 0
        ? undefined
        : (collider) => {
            // A disabled collider still answers scene queries until the next step.
            const entityId = this.rapierColliderToEntity.get(collider.handle) ?? "";
            return !ignored.has(entityId) && !this.collisionDisabled.has(entityId);
          },
    );
    return hit ? Math.min(1, Math.max(0, hit.timeOfImpact / length)) : null;
  }

  private cameraIgnoredEntities(): Set<EntityId> {
    if (this.cameraIgnoredCache) return this.cameraIgnoredCache;
    const ignored = new Set<EntityId>();
    for (const body of this.bodies) if (body.collider.ignoreCameraTrace) ignored.add(body.id);
    this.cameraIgnoredCache = ignored;
    return ignored;
  }

  /**
   * World-space walkable surface triangles from every static, non-sensor trimesh
   * (`complexAsSimple`) collider, with the body's placement rotation baked into
   * each vertex and the upward normal precomputed. Feeds the ground probe so a
   * ramp is walked at its true incline height. Cached like the blocker AABBs.
   */
  staticSurfaceTriangles(): readonly PhysicsSurfaceTriangle[] {
    if (this.staticSurfaceCache) return this.staticSurfaceCache;
    const surfaces: PhysicsSurfaceTriangle[] = [];
    for (const [id, record] of this.staticRecords) {
      if (this.collisionDisabled.has(id)) continue;
      for (const entry of record.surfaces) surfaces.push(entry.value);
      for (const field of record.fields) for (const surface of field.all().surfaces) surfaces.push(surface);
    }
    this.staticSurfaceCache = surfaces;
    return surfaces;
  }

  /**
   * Static ground candidates at X/Z. Landscapes otherwise make every character
   * probe scan every triangle, which turns sprinting into long frame spikes and
   * can make the movement step skip its ground follow window.
   */
  staticSurfaceTrianglesNear(x: number, z: number): readonly PhysicsSurfaceTriangle[] {
    if (this.heightfieldRecords.size === 0) return this.staticSurfaceIndex.atCell(x, z);
    const at = staticCellOf(x, z);
    const touched: HeightfieldCellEntries[] = [];
    for (const [id, record] of this.heightfieldRecords) {
      if (this.collisionDisabled.has(id)) continue;
      for (const field of record.fields) {
        if (!field.touchesCell(at.x, at.z)) continue;
        const cell = field.cellEntries(at.x, at.z);
        if (cell.surfaces.length > 0) touched.push(cell);
      }
    }
    const { cell, overflow } = this.staticSurfaceIndex.atCellEntries(x, z);
    // Inside one tile with nothing else nearby (the common case): already in order.
    if (touched.length === 1 && cell.length === 0 && overflow.length === 0) return touched[0]!.surfaceValues;
    let merged = cell;
    for (const extra of touched) merged = merged.concat(extra.surfaces);
    if (touched.length > 0) merged.sort(compareStaticEntries);
    return merged.concat(overflow).map((entry) => entry.value);
  }

  /** All blockers intersecting the inclusive X/Z square, in body/primitive order. */
  staticBlockerAabbsNear(x: number, z: number, radius: number): readonly PhysicsAabb[] {
    if (this.heightfieldRecords.size === 0) {
      const blockers = this.staticBlockerIndex.near(x, z, radius);
      this.blockerCandidatesInspected += this.staticBlockerIndex.lastCandidateCount;
      return blockers;
    }
    const entries: StaticSpatialEntry<Aabb>[] = this.staticBlockerIndex.nearEntries(x, z, radius);
    this.blockerCandidatesInspected += this.staticBlockerIndex.lastCandidateCount;
    const r = Math.max(0, radius);
    const from = staticCellOf(x - r, z - r);
    const to = staticCellOf(x + r, z + r);
    const multiCell = from.x !== to.x || from.z !== to.z;
    let added = false;
    for (const [id, record] of this.heightfieldRecords) {
      if (this.collisionDisabled.has(id)) continue;
      for (const field of record.fields) {
        if (!field.overlapsSquare(x, z, r)) continue;
        // A triangle filed under several cells is one item: keep it once.
        let seen: Set<number> | null = null;
        for (let cz = from.z; cz <= to.z; cz += 1) {
          for (let cx = from.x; cx <= to.x; cx += 1) {
            if (!field.touchesCell(cx, cz)) continue;
            const blockers = field.cellEntries(cx, cz).blockers;
            for (const entry of blockers) {
              if (multiCell) {
                seen ??= new Set();
                if (seen.has(entry.itemOrder)) continue;
                seen.add(entry.itemOrder);
              }
              this.blockerCandidatesInspected += 1;
              if (!staticEntryOverlapsSquare(entry, x, z, radius)) continue;
              entries.push(entry as StaticSpatialEntry<Aabb>);
              added = true;
            }
          }
        }
      }
    }
    if (added) entries.sort(compareStaticEntries);
    return entries.map((entry) => entry.value);
  }

  /** Global availability without materializing flat arrays (preserves void/fallback-floor semantics). */
  hasStaticGround(): boolean {
    if (this.staticBlockerIndex.size > 0 || this.staticSurfaceIndex.size > 0) return true;
    for (const id of this.heightfieldRecords.keys()) if (!this.collisionDisabled.has(id)) return true;
    return false;
  }

  /** Cumulative work counters for deterministic streaming and movement performance checks. */
  staticQueryDebug(): { invalidations: number; recordBuilds: number; blockerCandidatesInspected: number } {
    return {
      invalidations: this.staticInvalidations,
      recordBuilds: this.staticRecordBuilds,
      blockerCandidatesInspected: this.blockerCandidatesInspected,
    };
  }

  private invalidateStaticCaches(): void {
    this.staticInvalidations += 1;
    this.staticBlockerCache = null;
    this.staticSurfaceCache = null;
    this.staticNavigationBlockerCache = null;
    this.staticNavigationSurfaceCache = null;
    this.staticNavigationNonHeightfieldSurfaceCache = null;
    this.cameraIgnoredCache = null;
  }

  private recordStaticBody(body: PhysicsBody, previousOrder?: number): void {
    if (!body.collider.isStatic || body.collider.isSensor) return;
    const order = previousOrder ?? this.nextStaticOrder++;
    const blockers: Aabb[] = [];
    const surfaces: PhysicsSurfaceTriangle[] = [];
    appendBlockerAabbs(blockers, body);
    appendSurfaceTriangles(surfaces, body);
    // Heightfields come after the body's other items; most answer on demand.
    const fields: HeightfieldStaticSource[] = [];
    const origin = body.transform.position as Vec3;
    const rotation = body.transform.rotation as Vec3;
    for (const primitive of body.collider.primitives ?? []) {
      const field = primitive.shape === "heightfield" ? primitive.heightfield : undefined;
      if (!field) continue;
      if (heightfieldSupportsOnDemand(field, rotation)) {
        fields.push(new HeightfieldStaticSource(origin, field, body.collider.navigationRole, order,
          { blockers: blockers.length, surfaces: surfaces.length }));
        continue;
      }
      forEachHeightfieldTriangle(field, 0, field.quadsX - 1, 0, field.quadsZ - 1, (a, b, c) => {
        const classified = classifyStaticTriangle(
          rotatePointAboutOrigin(origin, a, rotation),
          rotatePointAboutOrigin(origin, b, rotation),
          rotatePointAboutOrigin(origin, c, rotation),
          body.collider.navigationRole,
        );
        if ("surface" in classified) surfaces.push(classified.surface);
        else blockers.push(classified.blocker as Aabb);
      });
    }
    const record: StaticBodyRecord = {
      order,
      fields,
      navigationRole: body.collider.navigationRole,
      blockers: blockers.map((value, itemOrder) => ({
        value, bodyOrder: order, itemOrder,
        minX: value.min[0], maxX: value.max[0], minZ: value.min[2], maxZ: value.max[2],
      })),
      surfaces: surfaces.map((value, itemOrder) => ({
        value, bodyOrder: order, itemOrder,
        minX: Math.min(value.a[0], value.b[0], value.c[0]),
        maxX: Math.max(value.a[0], value.b[0], value.c[0]),
        minZ: Math.min(value.a[2], value.b[2], value.c[2]),
        maxZ: Math.max(value.a[2], value.b[2], value.c[2]),
      })),
    };
    this.staticRecords.set(body.id, record);
    if (fields.length > 0) this.heightfieldRecords.set(body.id, record);
    else this.heightfieldRecords.delete(body.id);
    this.staticRecordBuilds += 1;
    if (!this.collisionDisabled.has(body.id)) this.indexStaticRecord(record, true);
  }

  private indexStaticRecord(record: StaticBodyRecord, enabled: boolean): void {
    for (const entry of record.blockers) {
      if (enabled) this.staticBlockerIndex.add(entry);
      else this.staticBlockerIndex.remove(entry);
    }
    for (const entry of record.surfaces) {
      if (enabled) this.staticSurfaceIndex.add(entry);
      else this.staticSurfaceIndex.remove(entry);
    }
  }

  private dropStaticRecord(entityId: EntityId): void {
    const record = this.staticRecords.get(entityId);
    if (!record) return;
    this.indexStaticRecord(record, false);
    this.staticRecords.delete(entityId);
    this.heightfieldRecords.delete(entityId);
  }

  /**
   * AI-navigation blockers: `ignored` bodies are omitted, but still collide in
   * physics. Every other body is emitted with its `navigationRole` carried on each
   * AABB, because this list feeds two consumers with opposite needs:
   * - Ground seeding (`findGroundLayersAt` via the host floor sampler) needs
   *   `walkable` bodies IN the list — a solid floor/platform box has no trimesh
   *   surface triangles, so its walkable top is only discoverable as a blocker top.
   * - Grid erosion (`buildNavGrid`) must NOT erode around `walkable` bodies, or a
   *   `walkable` staircase's vertical riser AABBs wipe out the tread strip between
   *   steps. That exclusion lives in `buildNavGrid` (role-aware), keyed off the
   *   `navigationRole` carried here — not by dropping the body from this list.
   */
  staticNavigationBlockerAabbs(): readonly PhysicsAabb[] {
    if (this.staticNavigationBlockerCache) return this.staticNavigationBlockerCache;
    const blockers: Aabb[] = [];
    for (const [id, record] of this.staticRecords) {
      if (record.navigationRole === "ignored" || this.collisionDisabled.has(id)) continue;
      for (const entry of record.blockers) blockers.push(entry.value);
      for (const field of record.fields) for (const blocker of field.allBlockers()) blockers.push(blocker as Aabb);
    }
    this.staticNavigationBlockerCache = blockers;
    return blockers;
  }

  /** AI-nav surfaces; omit on-demand heightfields when using point samples. */
  staticNavigationSurfaceTriangles(includeHeightfields = true): readonly PhysicsSurfaceTriangle[] {
    const cached = includeHeightfields ? this.staticNavigationSurfaceCache : this.staticNavigationNonHeightfieldSurfaceCache;
    if (cached) return cached;
    const surfaces: PhysicsSurfaceTriangle[] = [];
    for (const [id, record] of this.staticRecords) {
      if (record.navigationRole === "ignored" || record.navigationRole === "obstacleOnly" ||
        this.collisionDisabled.has(id)) continue;
      for (const entry of record.surfaces) surfaces.push(entry.value);
      if (includeHeightfields) {
        for (const field of record.fields) for (const surface of field.all().surfaces) surfaces.push(surface);
      }
    }
    if (includeHeightfields) this.staticNavigationSurfaceCache = surfaces;
    else this.staticNavigationNonHeightfieldSurfaceCache = surfaces;
    return surfaces;
  }

  /** Point samples in the full surface list's order, without expanding heightfields. */
  staticNavigationSurfaceSamplesAt(x: number, z: number): readonly GroundSurfaceSample[] {
    const samples: GroundSurfaceSample[] = [];
    for (const [id, record] of this.staticRecords) {
      if (record.navigationRole === "ignored" || record.navigationRole === "obstacleOnly" ||
        this.collisionDisabled.has(id)) continue;
      for (const { value } of record.surfaces) {
        const floorY = sampleTriangleHeight(value, x, z);
        if (floorY !== null) samples.push({ floorY, normalY: value.normalY });
      }
      for (const field of record.fields) samples.push(...field.surfaceSamplesAt(x, z));
    }
    return samples;
  }

  /**
   * Half-extents of an entity's collider, or null if it has none. The collider
   * `size` already has placement scale baked at scene-build, so this is just
   * `size / 2`.
   */
  /**
   * The entity collider's body-local center offset plus half-extents (the same
   * scale-baked `size`/`center` the physics body was built from), or null if it
   * has none. Backs the runtime's collider debug wireframe so the overlay traces
   * exactly what physics collides with, revealing whether placement scale was
   * baked into the collider.
   */
  colliderDebugBox(
    entityId: EntityId,
  ): { center: [number, number, number]; halfExtents: [number, number, number] } | null {
    const body = this.bodiesById.get(entityId);
    if (!body) return null;
    const center = body.collider.center ?? [0, 0, 0];
    return {
      center: [center[0] ?? 0, center[1] ?? 0, center[2] ?? 0],
      halfExtents: [
        (body.collider.size[0] ?? 0) / 2,
        (body.collider.size[1] ?? 0) / 2,
        (body.collider.size[2] ?? 0) / 2,
      ],
    };
  }

  colliderHalfExtents(entityId: EntityId): readonly [number, number, number] | null {
    const body = this.bodiesById.get(entityId);
    if (!body) return null;
    return [
      (body.collider.size[0] ?? 0) / 2,
      (body.collider.size[1] ?? 0) / 2,
      (body.collider.size[2] ?? 0) / 2,
    ];
  }

  /**
   * World-space linear velocity (units/s) of a simulated body, backing the
   * runtime `world.velocityOf` (A6). Only meaningful for a live Rapier dynamic
   * body; kinematic/placeholder bodies (whose motion is driven externally) return
   * null so the host can fall back to another velocity source (character movement).
   */
  velocityOf(entityId: EntityId): readonly [number, number, number] | null {
    const record = this.rapierBodies.get(entityId);
    if (!record) return null;
    const body = this.bodiesById.get(entityId);
    if (!body?.collider.simulatePhysics) return null;
    const v = record.body.linvel();
    return [v.x, v.y, v.z];
  }

  /**
   * Applies an instantaneous linear impulse to a simulated (dynamic) body
   * (A6 AddImpulse / knockback). No-op unless Rapier is live and the entity is a
   * `simulatePhysics` body — static/kinematic bodies (including the character
   * capsule) are position-driven, so they use `launch` instead. Wakes the body so
   * a resting object reacts.
   */
  applyImpulse(entityId: EntityId, impulse: readonly [number, number, number]): void {
    const record = this.rapierBodies.get(entityId);
    if (!record) return;
    const body = this.bodiesById.get(entityId);
    if (!body?.collider.simulatePhysics) return;
    record.body.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
  }

  /**
   * Spawns a transient ragdoll: a dynamic Rapier body per desc body, linked by
   * spherical impulse joints, dropped into the live world. The bodies collide
   * with the level's static colliders but never each other (see
   * `RAGDOLL_COLLISION_GROUPS`); angular damping keeps them from flailing since
   * the spherical joints carry no cone/twist limit (rapier3d-compat 0.19).
   *
   * Returns an id for {@link sampleRagdoll}/{@link despawnRagdoll}, or null when
   * the Rapier backend isn't active (a scene with no colliders never loads it).
   * Game code owns the trigger (e.g. a death event) and the per-tick bone driving.
   * Rebuilding the world (`setEntities`) frees these bodies — a ragdoll is meant
   * to live within a play session, not across scene reloads.
   *
   * `options.detachEntityId` moves that entity's colliders into the ragdoll's
   * collision group so the (kinematic) player capsule never shoves its own
   * ragdoll — the capsule still collides with the level. Not restored on despawn
   * (ragdoll activation is terminal for the possessed pawn).
   */
  spawnRagdoll(desc: RagdollGroupDesc, options: { detachEntityId?: EntityId } = {}): number | null {
    const RAPIER = this.rapierModule;
    if (!RAPIER || !this.rapierWorld) return null;
    const bodies = new Map<string, RapierRigidBody>();
    const bodyQuats = new Map<string, QuatXYZW>();
    for (const bodyDesc of desc.bodies) {
      const rigidBody = this.rapierWorld.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(bodyDesc.position[0], bodyDesc.position[1], bodyDesc.position[2])
          .setRotation({
            x: bodyDesc.quaternion[0],
            y: bodyDesc.quaternion[1],
            z: bodyDesc.quaternion[2],
            w: bodyDesc.quaternion[3],
          })
          .setCcdEnabled(true)
          .setLinearDamping(0.05)
          .setAngularDamping(0.6),
      );
      this.rapierWorld.createCollider(
        colliderShapeDesc(RAPIER, bodyDesc.shape, bodyDesc.size)
          .setMass(bodyDesc.mass)
          .setFriction(DEFAULT_FRICTION)
          .setRestitution(DEFAULT_RESTITUTION)
          .setCollisionGroups(RAGDOLL_COLLISION_GROUPS),
        rigidBody,
      );
      bodies.set(bodyDesc.name, rigidBody);
      bodyQuats.set(bodyDesc.name, bodyDesc.quaternion);
    }
    for (const joint of desc.joints) {
      const a = bodies.get(joint.bodyA);
      const b = bodies.get(joint.bodyB);
      if (!a || !b) continue;
      const params = RAPIER.JointData.spherical(
        { x: joint.anchorA[0], y: joint.anchorA[1], z: joint.anchorA[2] },
        { x: joint.anchorB[0], y: joint.anchorB[1], z: joint.anchorB[2] },
      );
      const impulseJoint = this.rapierWorld.createImpulseJoint(params, a, b, true);
      const quatA = bodyQuats.get(joint.bodyA);
      const quatB = bodyQuats.get(joint.bodyB);
      if (quatA && quatB) this.applyRagdollJointLimits(impulseJoint, joint, quatA, quatB);
    }
    if (options.detachEntityId !== undefined) {
      const record = this.rapierBodies.get(options.detachEntityId);
      if (record) {
        for (const collider of record.colliders) collider.setCollisionGroups(RAGDOLL_COLLISION_GROUPS);
      }
    }
    const id = this.nextRagdollId;
    this.nextRagdollId += 1;
    this.ragdollGroups.set(id, { id, bodies });
    return id;
  }

  /**
   * Clamps a spherical ragdoll joint's swing (AngX/AngZ) and twist (AngY) — limbs
   * run along Y, so AngY is the twist axis. Limits go through the raw joint set
   * (`jointSetLimits`) because the typed `SphericalImpulseJoint` exposes none; the
   * values are rest-widened (`ragdollJointAngularLimits`) so the joint never
   * starts in violation. Feature-detected: a no-op (floppy) if the raw setter is
   * absent, so a Rapier version bump can't crash here.
   */
  private applyRagdollJointLimits(
    joint: RapierImpulseJoint,
    jointDesc: RagdollJointDesc,
    quatA: QuatXYZW,
    quatB: QuatXYZW,
  ): void {
    const rawSet = this.rapierWorld?.impulseJoints.raw as unknown as
      | Partial<RawAngularLimitSetter>
      | undefined;
    if (!rawSet || typeof rawSet.jointSetLimits !== "function") return;
    const limits = ragdollJointAngularLimits(quatA, quatB, jointDesc.swingRad, jointDesc.twistRad);
    const handle = joint.handle;
    rawSet.jointSetLimits(handle, RAW_JOINT_AXIS_ANG_X, -limits.swing, limits.swing);
    rawSet.jointSetLimits(handle, RAW_JOINT_AXIS_ANG_Y, -limits.twist, limits.twist);
    rawSet.jointSetLimits(handle, RAW_JOINT_AXIS_ANG_Z, -limits.swing, limits.swing);
  }

  /** World transforms of a spawned ragdoll's bodies, after the latest step. */
  sampleRagdoll(id: number): RagdollPose[] {
    const group = this.ragdollGroups.get(id);
    if (!group) return [];
    const poses: RagdollPose[] = [];
    for (const [name, body] of group.bodies) {
      const translation = body.translation();
      const rotation = body.rotation();
      poses.push({
        name,
        position: [translation.x, translation.y, translation.z],
        quaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
      });
    }
    return poses;
  }

  /** Removes a spawned ragdoll (its bodies, colliders, and joints). */
  despawnRagdoll(id: number): void {
    const group = this.ragdollGroups.get(id);
    if (!group) return;
    if (this.rapierWorld) {
      for (const body of group.bodies.values()) this.rapierWorld.removeRigidBody(body);
    }
    this.ragdollGroups.delete(id);
  }

  update(_context: EngineUpdateContext): void {
    if (!this.enabled) {
      this.contacts = [];
      return;
    }
    if (this.rapierWorld) {
      // Fixed slices, not one frame-sized step: the result must not depend on
      // the frame rate. A frame shorter than a slice simulates nothing and only
      // advances the render blend below.
      const steps = this.stepClock.advance(_context.deltaSeconds);
      this.frameStepCount = steps;
      if (steps > 0) {
        this.updateDynamicActiveArea();
        for (let index = 0; index < steps; index += 1) {
          if (index === steps - 1) this.capturePreviousPoses();
          // Vehicles push velocity into their chassis right before each slice.
          this.updateVehicles(this.stepClock.step);
          this.rapierWorld.step();
        }
        this.updateRapierContacts();
      }
      this.syncRapierDynamicTransforms();
      return;
    }
    this.frameStepCount = 0;
    const contacts: PhysicsContact[] = [];
    for (let i = 0; i < this.bodies.length; i += 1) {
      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const a = this.bodies[i];
        const b = this.bodies[j];
        if (!a || !b) continue;
        if (a.collider.isStatic && b.collider.isStatic) continue;
        if (this.collisionDisabled.has(a.id) || this.collisionDisabled.has(b.id)) continue;
        if (!interactionGroupsInteract(a.collider.collisionGroups, b.collider.collisionGroups)) {
          continue;
        }
        if (!aabbOverlaps(bodyAabb(a), bodyAabb(b))) continue;
        contacts.push({
          a: a.id,
          b: b.id,
          isSensor: a.collider.isSensor || b.collider.isSensor,
        });
      }
    }
    this.contacts = this.reportableContacts(contacts);
  }

  /**
   * Drops contacts whose owners opted out of events: a sensor overlap needs a
   * sensor with `generateOverlapEvents !== false`, and a solid hit needs a body
   * with `simulationGeneratesHitEvents !== false`. Both flags default to on
   * (absent), so unannotated bodies keep reporting every contact.
   */
  private reportableContacts(contacts: PhysicsContact[]): PhysicsContact[] {
    return contacts.filter((contact) => {
      const a = this.bodies.find((body) => body.id === contact.a);
      const b = this.bodies.find((body) => body.id === contact.b);
      if (!a || !b) return true;
      if (contact.isSensor) {
        return (
          (a.collider.isSensor && a.collider.generateOverlapEvents !== false) ||
          (b.collider.isSensor && b.collider.generateOverlapEvents !== false)
        );
      }
      return (
        a.collider.simulationGeneratesHitEvents !== false ||
        b.collider.simulationGeneratesHitEvents !== false
      );
    });
  }

  clear(): void {
    this.bodiesById.clear();
    this.staticRecords.clear();
    this.heightfieldRecords.clear();
    this.staticBlockerIndex.clear();
    this.staticSurfaceIndex.clear();
    this.nextStaticOrder = 0;
    this.invalidateStaticCaches();
    this.bodies = [];
    this.contacts = [];
    this.collisionDisabled.clear();
    this.suspendedDynamicBodies.clear();
  }

  dispose(): void {
    this.clear();
    this.rapierWorld?.free();
    this.rapierWorld = null;
    this.rapierBodies.clear();
    this.suspendedDynamicBodies.clear();
    this.rapierColliderToEntity.clear();
    this.ragdollGroups.clear();
    this.vehicles.clear();
  }

  private rebuildRapierWorld(): void {
    const RAPIER = this.rapierModule;
    if (!RAPIER) return;
    // Controllers die with the old world; the records re-attach below.
    for (const vehicle of this.vehicles.values()) vehicle.controller = null;
    this.rapierWorld?.free();
    this.rapierWorld = new RAPIER.World(vectorFromVec3(this.gravity));
    this.rapierWorld.timestep = this.stepClock.step;
    this.stepClock.reset();
    this.previousPoses.clear();
    this.rapierBodies.clear();
    this.suspendedDynamicBodies.clear();
    this.rapierColliderToEntity.clear();
    // Ragdoll bodies belonged to the freed world; their handles are now invalid.
    this.ragdollGroups.clear();

    for (const body of this.bodies) this.addRapierBody(body);
    for (const [entityId, vehicle] of this.vehicles) {
      if (vehicle.controller) continue; // a component vehicle addRapierBody just built
      if (!this.attachVehicleController(vehicle)) this.vehicles.delete(entityId);
    }
  }

  /**
   * Builds the Rapier controller for a vehicle record on its chassis body. Mass
   * comes from the definition instead of the colliders (density 0), with a box
   * inertia from the chassis collider size and the authored centre of mass.
   */
  private attachVehicleController(record: VehicleRecord): boolean {
    const world = this.rapierWorld;
    const rapier = this.rapierBodies.get(record.entityId);
    const body = this.bodies.find((candidate) => candidate.id === record.entityId);
    if (!world || !rapier || !body?.collider.simulatePhysics || !rapier.body.isDynamic()) return false;

    const { definition } = record;
    for (const collider of rapier.colliders) collider.setDensity(0);
    const [width, height, length] = [
      body.collider.size[0] ?? 1,
      body.collider.size[1] ?? 1,
      body.collider.size[2] ?? 1,
    ];
    const mass = definition.massKg;
    rapier.body.setAdditionalMassProperties(
      mass,
      vectorFromVec3([...definition.centerOfMassOffset]),
      {
        x: (mass / 12) * (height * height + length * length),
        y: (mass / 12) * (width * width + length * length),
        z: (mass / 12) * (width * width + height * height),
      },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    rapier.body.recomputeMassPropertiesFromColliders();

    const controller = world.createVehicleController(rapier.body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;
    definition.wheels.forEach((wheel, index) => {
      controller.addWheel(
        vectorFromVec3([...wheel.position]),
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        wheel.suspensionRestLength,
        wheel.radius,
      );
      controller.setWheelMaxSuspensionTravel(index, wheel.suspensionMaxTravel);
      controller.setWheelSuspensionStiffness(index, wheel.suspensionStiffness);
      controller.setWheelSuspensionCompression(index, wheel.suspensionCompression);
      controller.setWheelSuspensionRelaxation(index, wheel.suspensionRelaxation);
      controller.setWheelMaxSuspensionForce(index, wheel.maxSuspensionForce);
      controller.setWheelFrictionSlip(index, wheel.frictionSlip);
      controller.setWheelSideFrictionStiffness(index, wheel.sideFrictionStiffness);
    });
    // A new controller starts at the authored rest lengths.
    const bottom = chassisBottomY(body.collider);
    record.sink = definition.wheels.map(() => 0);
    record.sinkLimits = definition.wheels.map((wheel) => wheelSinkLimit(wheel, bottom));
    record.tractionSlip = definition.wheels.map(() => 0);
    record.controller = controller;
    return true;
  }

  private vehicleWheelGroundEntity(controller: RapierVehicleController, index: number): EntityId | null {
    const ground = controller.wheelGroundObject(index);
    return ground ? this.rapierColliderToEntity.get(ground.handle) ?? null : null;
  }

  /** Feeds each vehicle's drive commands and runs its wheel rays for one slice. */
  private updateVehicles(deltaSeconds: number): void {
    const RAPIER = this.rapierModule;
    if (!RAPIER) return;
    for (const record of this.vehicles.values()) {
      const controller = record.controller;
      const rapier = this.rapierBodies.get(record.entityId);
      if (!controller || !rapier) continue;
      if (this.suspendedDynamicBodies.has(record.entityId)) continue;
      const forwardSpeed = chassisForwardSpeed(rapier.body);
      this.applyWheelSink(record, controller, rapier.body, deltaSeconds);
      // Rapier exposes the previous slice's wheel rays/load until updateVehicle.
      // Sample once, before gearing, so the gearbox sees the resistance that
      // will remain active during its power cut. Side stiffness is a scale here
      // and composes with the command's handbrake response below.
      const surfaces = record.definition.wheels.map((wheel, index) => {
        const contact = this.vehicleSurfaceProvider && controller.wheelIsInContact(index)
          ? controller.wheelContactPoint(index) : null;
        const sample = contact ? this.vehicleSurfaceProvider!(
          record.entityId, index, this.vehicleWheelGroundEntity(controller, index),
          [contact.x, contact.y, contact.z],
        ) : null;
        return computeWheelSurfaceResponse(
          { frictionSlip: wheel.frictionSlip, sideFrictionStiffness: 1 },
          sample, forwardSpeed, controller.wheelSuspensionForce(index) ?? 0,
        );
      });
      const drive = computeVehicleDrive(
        record.definition,
        record.input,
        forwardSpeed,
        record.steer,
        deltaSeconds,
        record.drivetrain,
        surfaces.reduce((sum, surface) => sum + surface.rollingResistanceForce, 0),
      );
      record.steer = drive.steer;
      record.drivetrain = drive.drivetrain;
      record.engineLoad = drive.engineLoad;
      drive.wheels.forEach((command, index) => {
        const surface = surfaces[index]!;
        controller.setWheelEngineForce(index, command.engineForce);
        // The controller takes the brake as a per-slice impulse cap.
        controller.setWheelBrake(index, (command.brakeForce + surface.rollingResistanceForce) * deltaSeconds);
        controller.setWheelSteering(index, command.steering);
        controller.setWheelFrictionSlip(index, surface.frictionSlip);
        controller.setWheelSideFrictionStiffness(index, command.sideFrictionStiffness * surface.sideFrictionStiffness);
      });
      const velocity = rapier.body.linvel();
      const force = computeVehicleAerodynamics(record.definition, [velocity.x, velocity.y, velocity.z]);
      if (force.some((component) => component !== 0)) {
        // Impulses apply this slice only; addForce would accumulate between slices.
        rapier.body.applyImpulse({ x: force[0] * deltaSeconds, y: force[1] * deltaSeconds, z: force[2] * deltaSeconds }, false);
      }
      const body = this.bodies.find((candidate) => candidate.id === record.entityId);
      controller.updateVehicle(
        deltaSeconds,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        body?.collider.collisionGroups,
      );
      // Rapier's ray-cast wheels never spin faster than the ground, so wheelspin
      // is read from the friction circle this slice's impulses were judged by.
      record.definition.wheels.forEach((_wheel, index) => {
        record.tractionSlip[index] = controller.wheelIsInContact(index)
          ? tractionSlip(
            controller.wheelEngineForce(index) ?? 0, controller.wheelSideImpulse(index) ?? 0,
            controller.wheelSuspensionForce(index) ?? 0, controller.wheelFrictionSlip(index) ?? 0, deltaSeconds,
          )
          : 0;
      });
    }
  }

  /**
   * Faz 3 sinkage as a virtual ground offset: each wheel's rest length shrinks
   * by the track depth under its last contact (Faz 0: `rest − depth`, at most
   * 0.3 m/s, and a sleeping chassis does not notice on its own). The terrain
   * collider never changes, so a wheel stops at the depth where the chassis
   * would reach it; mud wanted deeper than that drags on the belly instead.
   */
  private applyWheelSink(
    record: VehicleRecord,
    controller: RapierVehicleController,
    body: RapierRigidBody,
    deltaSeconds: number,
  ): void {
    const provider = this.vehicleGroundSinkProvider;
    if (!provider && !record.sink.some((depth) => depth > 0)) return;
    let heading = 0;
    if (provider) {
      const q = body.rotation();
      heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
    }
    let changed = false;
    let overlap = 0;
    let resistance = 0;
    let sinking = 0;
    record.definition.wheels.forEach((wheel, index) => {
      let target = 0;
      const contact = provider && controller.wheelIsInContact(index) ? controller.wheelContactPoint(index) : null;
      const sink = contact ? provider!({
        vehicleEntityId: record.entityId,
        wheelIndex: index,
        groundEntityId: this.vehicleWheelGroundEntity(controller, index),
        contactPoint: [contact.x, contact.y, contact.z],
        heading: heading + (controller.wheelSteering(index) ?? 0),
        width: vehicleWheelWidth(wheel),
      }) : null;
      if (sink && Number.isFinite(sink.depth) && sink.depth > 0) {
        const limit = record.sinkLimits[index] ?? 0;
        target = Math.min(sink.depth, limit);
        overlap += Math.max(0, sink.depth - limit);
        if (Number.isFinite(sink.resistance)) resistance += sink.resistance;
        sinking += 1;
      }
      const previous = record.sink[index] ?? 0;
      const next = slewSinkDepth(previous, target, deltaSeconds);
      if (next === previous) return;
      record.sink[index] = next;
      controller.setWheelSuspensionRestLength(index, wheel.suspensionRestLength - next);
      changed = true;
    });
    if (changed) body.wakeUp();
    if (overlap > 0 && sinking > 0) {
      // Spread over every wheel: one wheel in a deep hole drags a quarter as hard as four.
      const velocity = body.linvel();
      const impulse = bellyDragImpulse(
        [velocity.x, velocity.y, velocity.z],
        overlap / record.definition.wheels.length,
        resistance / sinking,
        record.definition.massKg,
        deltaSeconds,
      );
      if (impulse[0] !== 0 || impulse[2] !== 0) body.applyImpulse({ x: impulse[0], y: 0, z: impulse[2] }, true);
    }
  }

  private addRapierBody(body: PhysicsBody): void {
    const RAPIER = this.rapierModule;
    if (!RAPIER || !this.rapierWorld || this.rapierBodies.has(body.id)) return;
    const desc = rigidBodyDescForBody(RAPIER, body);
    desc.setTranslation(
      body.transform.position[0],
      body.transform.position[1],
      body.transform.position[2],
    );
    desc.setRotation(quaternionFromEulerDegrees(body.transform.rotation));
    const rigidBody = this.rapierWorld.createRigidBody(desc);
    const colliders = colliderDescsForBody(RAPIER, body).map((colliderDesc) =>
      this.rapierWorld!.createCollider(
        colliderDesc.setSensor(body.collider.isSensor),
        rigidBody,
      ),
    );
    this.rapierBodies.set(body.id, {
      id: body.id,
      body: rigidBody,
      colliders,
      isSensor: body.collider.isSensor,
    });
    for (const collider of colliders) this.rapierColliderToEntity.set(collider.handle, body.id);
    if (body.vehicle && !this.vehicles.has(body.id)) {
      const record: VehicleRecord = {
        entityId: body.id,
        definition: body.vehicle,
        source: "component",
        controller: null,
        input: NEUTRAL_VEHICLE_INPUT,
        steer: 0,
        drivetrain: initialVehicleDrivetrainState(body.vehicle),
        engineLoad: 0,
        sink: [],
        sinkLimits: [],
        tractionSlip: [],
      };
      if (this.attachVehicleController(record)) this.vehicles.set(body.id, record);
    }
  }

  private updateRapierContacts(): void {
    if (!this.rapierWorld) return;
    const contacts: PhysicsContact[] = [];
    const seen = new Set<string>();
    for (const record of this.rapierBodies.values()) {
      if (this.suspendedDynamicBodies.has(record.id)) continue;
      // Rapier never pairs two fixed bodies, so a static solid's contacts are
      // all found from its moving partner; asking from the static crowd too cost
      // two WASM calls per collider per frame.
      if (!record.isSensor && this.bodiesById.get(record.id)?.collider.isStatic === true) continue;
      for (const collider of record.colliders) {
        this.rapierWorld.contactPairsWith(collider, (other) => {
          this.addRapierContact(contacts, seen, record, other);
        });
        this.rapierWorld.intersectionPairsWith(collider, (other) => {
          this.addRapierContact(contacts, seen, record, other);
        });
      }
    }
    this.addAabbSensorContacts(contacts, seen);
    this.contacts = this.reportableContacts(contacts);
  }

  private hasDynamicActiveArea(): boolean {
    const { activeDistance, focusPosition } = this.dynamicActiveArea;
    return (
      typeof activeDistance === "number" &&
      Number.isFinite(activeDistance) &&
      activeDistance > 0 &&
      focusPosition !== undefined
    );
  }

  private updateDynamicActiveArea(): void {
    if (!this.hasDynamicActiveArea()) {
      this.resumeSuspendedDynamicBodies();
      return;
    }

    const focus = this.dynamicActiveArea.focusPosition?.() ?? null;
    if (!focus) {
      this.resumeSuspendedDynamicBodies();
      return;
    }

    const activeDistance = this.dynamicActiveArea.activeDistance;
    if (activeDistance === undefined) return;

    for (const [entityId, rapier] of this.rapierBodies) {
      const body = this.bodiesById.get(entityId);
      if (!body?.collider.simulatePhysics) continue;

      const translation = rapier.body.translation();
      const outsideActiveArea = isOutsideDynamicActiveArea(
        [translation.x, translation.y, translation.z],
        focus,
        activeDistance,
      );
      const suspended = this.suspendedDynamicBodies.get(entityId);

      if (outsideActiveArea && !suspended) {
        const linearVelocity = rapier.body.linvel();
        const angularVelocity = rapier.body.angvel();
        this.suspendedDynamicBodies.set(entityId, {
          linearVelocity: [linearVelocity.x, linearVelocity.y, linearVelocity.z],
          angularVelocity: [angularVelocity.x, angularVelocity.y, angularVelocity.z],
        });
        rapier.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        rapier.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        rapier.body.sleep();
        this.previousPoses.delete(entityId);
      } else if (!outsideActiveArea && suspended) {
        rapier.body.setLinvel(
          {
            x: suspended.linearVelocity[0],
            y: suspended.linearVelocity[1],
            z: suspended.linearVelocity[2],
          },
          true,
        );
        rapier.body.setAngvel(
          {
            x: suspended.angularVelocity[0],
            y: suspended.angularVelocity[1],
            z: suspended.angularVelocity[2],
          },
          true,
        );
        rapier.body.wakeUp();
        this.suspendedDynamicBodies.delete(entityId);
      }
    }
  }

  private resumeSuspendedDynamicBodies(): void {
    for (const [entityId, suspended] of this.suspendedDynamicBodies) {
      const rapier = this.rapierBodies.get(entityId);
      if (!rapier) continue;
      rapier.body.setLinvel(
        {
          x: suspended.linearVelocity[0],
          y: suspended.linearVelocity[1],
          z: suspended.linearVelocity[2],
        },
        true,
      );
      rapier.body.setAngvel(
        {
          x: suspended.angularVelocity[0],
          y: suspended.angularVelocity[1],
          z: suspended.angularVelocity[2],
        },
        true,
      );
      rapier.body.wakeUp();
    }
    this.suspendedDynamicBodies.clear();
  }

  private addAabbSensorContacts(contacts: PhysicsContact[], seen: Set<string>): void {
    const sensors: number[] = [];
    for (let index = 0; index < this.bodies.length; index += 1) {
      if (this.bodies[index]?.collider.isSensor) sensors.push(index);
    }
    if (sensors.length === 0) return;
    // Only pairs with a sensor report, so visit sensors × bodies rather than all
    // pairs (O(N²) per frame with a level's static crowd), then restore the
    // all-pairs (i, j) order so contact orientation and order are unchanged.
    const isSensor = new Set(sensors);
    const pairs: [number, number][] = [];
    for (const sensor of sensors) {
      for (let other = 0; other < this.bodies.length; other += 1) {
        // A sensor-sensor pair is visited once, from its lower sensor.
        if (other === sensor || (other < sensor && isSensor.has(other))) continue;
        const i = Math.min(sensor, other);
        const j = Math.max(sensor, other);
        const a = this.bodies[i];
        const b = this.bodies[j];
        if (!a || !b) continue;
        if (a.collider.isStatic && b.collider.isStatic) continue;
        if (this.collisionDisabled.has(a.id) || this.collisionDisabled.has(b.id)) continue;
        if (this.suspendedDynamicBodies.has(a.id) || this.suspendedDynamicBodies.has(b.id)) continue;
        if (!interactionGroupsInteract(a.collider.collisionGroups, b.collider.collisionGroups)) {
          continue;
        }
        if (!aabbOverlaps(bodyAabb(a), bodyAabb(b))) continue;
        pairs.push([i, j]);
      }
    }
    pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    for (const [i, j] of pairs) {
      const a = this.bodies[i]!;
      const b = this.bodies[j]!;
      const key = contactKey(a.id, b.id);
      if (seen.has(key)) continue;
      seen.add(key);
      contacts.push({
        a: a.id,
        b: b.id,
        isSensor: true,
      });
    }
  }

  /** Records every live dynamic body's pose right before the frame's last slice. */
  private capturePreviousPoses(): void {
    if (!this.transformSink) return;
    for (const [entityId, rapier] of this.rapierBodies.entries()) {
      if (this.suspendedDynamicBodies.has(entityId)) continue;
      const body = this.bodiesById.get(entityId);
      if (!body?.collider.simulatePhysics) continue;
      const translation = rapier.body.translation();
      const rotation = rapier.body.rotation();
      this.previousPoses.set(entityId, {
        position: [translation.x, translation.y, translation.z],
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      });
    }
  }

  /**
   * Sends each dynamic body's render pose to the sink, blended between the
   * previous and latest slice by the step clock's leftover. The sink only feeds
   * rendering, so the blend never leaks into the simulation; `body.transform`
   * (sensor AABBs) keeps the true simulated pose.
   */
  private syncRapierDynamicTransforms(): void {
    if (!this.transformSink) return;
    const alpha = this.stepClock.alpha;
    for (const [entityId, rapier] of this.rapierBodies.entries()) {
      const body = this.bodiesById.get(entityId);
      if (!body?.collider.simulatePhysics) continue;
      if (this.suspendedDynamicBodies.has(entityId)) continue;
      const translation = rapier.body.translation();
      const rotation = rapier.body.rotation();
      const position: Vec3 = [translation.x, translation.y, translation.z];
      body.transform = {
        position,
        rotation: eulerDegreesFromQuaternion(rotation),
        scale: [...body.transform.scale],
      };
      const previous = this.previousPoses.get(entityId);
      const transform: TransformComponent = previous
        ? {
            position: lerpPosition(previous.position, position, alpha),
            rotation: eulerDegreesFromQuaternion(nlerpQuaternion(previous.rotation, rotation, alpha)),
            scale: [...body.transform.scale],
          }
        : cloneTransform(body.transform);
      this.transformSink(entityId, transform);
    }
  }

  private addRapierContact(
    contacts: PhysicsContact[],
    seen: Set<string>,
    a: RapierBodyRecord,
    bCollider: RapierCollider,
  ): void {
    const bId = this.rapierColliderToEntity.get(bCollider.handle);
    if (!bId || bId === a.id) return;
    const b = this.rapierBodies.get(bId);
    if (!b) return;
    if (this.suspendedDynamicBodies.has(a.id) || this.suspendedDynamicBodies.has(b.id)) return;
    const [left, right] = a.id < b.id ? [a, b] : [b, a];
    const key = contactKey(left.id, right.id);
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({
      a: left.id,
      b: right.id,
      isSensor: left.isSensor || right.isSensor,
    });
  }
}

/** Signed linear speed along the body's local +Z (Forge's model forward). */
function chassisForwardSpeed(body: RapierRigidBody): number {
  const q = body.rotation();
  // Local +Z rotated into world space (third column of the rotation matrix).
  const forward: VehicleVec3 = [
    2 * (q.x * q.z + q.w * q.y),
    2 * (q.y * q.z - q.w * q.x),
    1 - 2 * (q.x * q.x + q.y * q.y),
  ];
  const v = body.linvel();
  return v.x * forward[0] + v.y * forward[1] + v.z * forward[2];
}

function contactKey(a: EntityId, b: EntityId): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** Pure distance check used by the optional dynamic-physics active-area policy. */
export function isOutsideDynamicActiveArea(
  position: readonly [number, number, number],
  focus: readonly [number, number, number],
  activeDistance: number,
): boolean {
  if (
    !Number.isFinite(activeDistance) ||
    activeDistance <= 0 ||
    !position.every(Number.isFinite) ||
    !focus.every(Number.isFinite)
  ) {
    return false;
  }
  const dx = position[0] - focus[0];
  const dy = position[1] - focus[1];
  const dz = position[2] - focus[2];
  return dx * dx + dy * dy + dz * dz > activeDistance * activeDistance;
}

/** Lowest body-local Y of a chassis collider (its primitives' AABBs when compound). */
function chassisBottomY(collider: PhysicsBody["collider"]): number {
  const boxes = collider.primitives && collider.primitives.length > 0 ? collider.primitives : [collider];
  return Math.min(...boxes.map((box) => (box.center?.[1] ?? 0) - (box.size[1] ?? 0) / 2));
}

function bodyAabb(body: PhysicsBody): Aabb {
  // `size`/`center` are body-local (placement scale baked at scene-build); the
  // body's Euler rotation is applied here so a rotated collider's world AABB
  // tracks the rendered mesh / Rapier collider instead of staying axis-aligned.
  const half: Vec3 = [
    (body.collider.size[0] ?? 0) / 2,
    (body.collider.size[1] ?? 0) / 2,
    (body.collider.size[2] ?? 0) / 2,
  ];
  const center = body.collider.center ?? [0, 0, 0];
  const origin = body.transform.position as Vec3;
  const rotation = body.transform.rotation as Vec3;
  const aabb = rotatedBoxAabb(origin, center as Vec3, half, rotation);
  const role = body.collider.navigationRole;
  const base: Aabb = role ? { ...aabb, navigationRole: role } : aabb;
  // The auto/box collider is a box, so its oriented ground silhouette is exact —
  // give navigation the tight footprint instead of the bloated enclosing AABB.
  const footprint = rotatedBoxFootprintXZ(origin, center as Vec3, half, rotation);
  return footprint ? { ...base, footprint } : base;
}

/**
 * Appends one or more movement-blocker AABBs for a static body. Plain colliders
 * yield their single body AABB; compound colliders yield one per primitive; a
 * `trimesh` primitive yields one per triangle. The body's placement rotation (and
 * a primitive's own local rotation) is baked into the world AABB via
 * `rotatedBoxAabb`, so a rotated corner-pivoted wall lands where it is drawn.
 */
function appendBlockerAabbs(out: Aabb[], body: PhysicsBody): void {
  const primitives = body.collider.primitives;
  const rotation = body.transform.rotation as Vec3;
  if (!primitives || primitives.length === 0) {
    out.push(bodyAabb(body));
    return;
  }
  const origin = body.transform.position as Vec3;
  for (const primitive of primitives) {
    if (
      primitive.shape === "trimesh" &&
      primitive.vertices &&
      primitive.vertices.length >= 3 &&
      primitive.indices &&
      primitive.indices.length >= 3
    ) {
      appendTriangleAabbs(
        out,
        origin,
        rotation,
        primitive.vertices,
        primitive.indices,
        body.collider.navigationRole,
      );
    } else if (primitive.shape === "heightfield" && primitive.heightfield) {
      // Its triangles are added by `recordStaticBody`, after the other primitives.
      continue;
    } else {
      out.push(primitiveAabb(origin, rotation, primitive, body.collider.navigationRole));
    }
  }
}

/** World AABB of a single non-trimesh primitive, honouring body + primitive rotation. */
function primitiveAabb(
  origin: Vec3,
  bodyRotation: Vec3,
  primitive: ColliderPrimitive,
  navigationRole: NavigationRole | undefined,
): Aabb {
  const center = (primitive.center ?? [0, 0, 0]) as Vec3;
  const half: Vec3 = [primitive.size[0] / 2, primitive.size[1] / 2, primitive.size[2] / 2];
  const aabb = rotatedBoxAabb(origin, center, half, bodyRotation, primitive.rotation);
  const base: Aabb = navigationRole ? { ...aabb, navigationRole } : aabb;
  // Only a box primitive's oriented footprint equals its projected corners; other
  // authored shapes (sphere/capsule/cylinder/cone) keep the AABB, matching how
  // this function already models them as boxes for the enclosing AABB.
  if (primitive.shape !== "box") return base;
  const footprint = rotatedBoxFootprintXZ(origin, center, half, bodyRotation, primitive.rotation);
  return footprint ? { ...base, footprint } : base;
}

/** Invokes `visit` with each trimesh triangle's world-space vertices (rotation baked). */
function forEachWorldTriangle(
  origin: Vec3,
  bodyRotation: Vec3,
  vertices: readonly Vec3[],
  indices: readonly number[],
  visit: (wa: Vec3, wb: Vec3, wc: Vec3) => void,
): void {
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = vertices[indices[t]!];
    const b = vertices[indices[t + 1]!];
    const c = vertices[indices[t + 2]!];
    if (!a || !b || !c) continue;
    visit(
      rotatePointAboutOrigin(origin, a, bodyRotation),
      rotatePointAboutOrigin(origin, b, bodyRotation),
      rotatePointAboutOrigin(origin, c, bodyRotation),
    );
  }
}

/** One AABB per *wall* triangle of a trimesh (flat/walkable triangles are surfaces, not blockers). */
function appendTriangleAabbs(
  out: Aabb[],
  origin: Vec3,
  bodyRotation: Vec3,
  vertices: readonly Vec3[],
  indices: readonly number[],
  navigationRole: NavigationRole | undefined,
): void {
  forEachWorldTriangle(origin, bodyRotation, vertices, indices, (wa, wb, wc) => {
    const classified = classifyStaticTriangle(wa, wb, wc, navigationRole);
    if ("blocker" in classified) out.push(classified.blocker as Aabb);
  });
}

/** Appends walkable surface triangles for a body's trimesh primitives (world-space + normalY). */
function appendSurfaceTriangles(out: PhysicsSurfaceTriangle[], body: PhysicsBody): void {
  const primitives = body.collider.primitives;
  if (!primitives || primitives.length === 0) return;
  const origin = body.transform.position as Vec3;
  const rotation = body.transform.rotation as Vec3;
  for (const primitive of primitives) {
    if (
      primitive.shape !== "trimesh" ||
      !primitive.vertices ||
      primitive.vertices.length < 3 ||
      !primitive.indices ||
      primitive.indices.length < 3
    ) {
      continue;
    }
    forEachWorldTriangle(origin, rotation, primitive.vertices, primitive.indices, (wa, wb, wc) => {
      const classified = classifyStaticTriangle(wa, wb, wc, undefined);
      if ("surface" in classified) out.push(classified.surface);
    });
  }
}

function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return (
    a.min[0] <= b.max[0] &&
    a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] &&
    a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] &&
    a.max[2] >= b.min[2]
  );
}

function cloneTransform(transform: TransformComponent): TransformComponent {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function bodyFromEntity(entity: Entity): PhysicsBody | null {
  const transform = readTransformComponent(entity);
  const collider = readColliderComponent(entity);
  if (!transform || !collider) return null;
  const body: PhysicsBody = {
    id: entity.id,
    transform: cloneTransform(transform),
    collider: cloneCollider(collider),
  };
  const vehicle = vehicleDefinitionFromComponent(entity.components[VEHICLE_COMPONENT]);
  if (vehicle) body.vehicle = vehicle;
  return body;
}

function cloneCollider(collider: ColliderComponent): ColliderComponent {
  const clone: ColliderComponent = {
    shape: collider.shape,
    size: [...collider.size],
    isStatic: collider.isStatic,
    isSensor: collider.isSensor,
  };
  if (collider.center) clone.center = [...collider.center];
  if (collider.primitives) clone.primitives = collider.primitives.map(clonePrimitive);
  if (collider.friction !== undefined) clone.friction = collider.friction;
  if (collider.physicalMaterialId !== undefined) clone.physicalMaterialId = collider.physicalMaterialId;
  if (collider.restitution !== undefined) clone.restitution = collider.restitution;
  if (collider.navigationRole !== undefined) clone.navigationRole = collider.navigationRole;
  if (collider.generateOverlapEvents !== undefined) {
    clone.generateOverlapEvents = collider.generateOverlapEvents;
  }
  if (collider.simulationGeneratesHitEvents !== undefined) {
    clone.simulationGeneratesHitEvents = collider.simulationGeneratesHitEvents;
  }
  if (collider.collisionGroups !== undefined) clone.collisionGroups = collider.collisionGroups;
  if (collider.ignoreCameraTrace !== undefined) clone.ignoreCameraTrace = collider.ignoreCameraTrace;
  if (collider.simulatePhysics !== undefined) clone.simulatePhysics = collider.simulatePhysics;
  if (collider.massKg !== undefined) clone.massKg = collider.massKg;
  if (collider.linearDamping !== undefined) clone.linearDamping = collider.linearDamping;
  if (collider.angularDamping !== undefined) clone.angularDamping = collider.angularDamping;
  if (collider.enableGravity !== undefined) clone.enableGravity = collider.enableGravity;
  if (collider.lockPosition !== undefined) clone.lockPosition = [...collider.lockPosition];
  if (collider.lockRotation !== undefined) clone.lockRotation = [...collider.lockRotation];
  return clone;
}

function clonePrimitive(primitive: ColliderPrimitive): ColliderPrimitive {
  const copy: ColliderPrimitive = { shape: primitive.shape, size: [...primitive.size] };
  if (primitive.center) copy.center = [...primitive.center];
  if (primitive.rotation) copy.rotation = [...primitive.rotation];
  if (primitive.points) copy.points = primitive.points.map((point) => [...point] as typeof point);
  // Trimesh (complexAsSimple) data — must be carried through, or the Rapier
  // collider and the movement blockers both fall back to a box.
  if (primitive.vertices) copy.vertices = primitive.vertices.map((point) => [...point] as typeof point);
  if (primitive.indices) copy.indices = [...primitive.indices];
  // Shared, never copied: a terrain tile's grid is large and immutable while the body lives.
  if (primitive.heightfield) copy.heightfield = primitive.heightfield;
  return copy;
}

/**
 * Collider descriptors for a body: one per authored primitive (a compound
 * collider) when present, otherwise the single box derived from the collider's
 * size/center. Each primitive carries its own local translation + rotation.
 */
function colliderDescsForBody(RAPIER: RapierModule, body: PhysicsBody) {
  const primitives = body.collider.primitives;
  if (!primitives || primitives.length === 0) return [colliderDescForBody(RAPIER, body)];
  const friction = body.collider.friction ?? DEFAULT_FRICTION;
  const restitution = body.collider.restitution ?? DEFAULT_RESTITUTION;
  const groups = body.collider.collisionGroups;
  return primitives.map((primitive) => {
    const desc = primitiveColliderDesc(RAPIER, primitive).setFriction(friction).setRestitution(restitution);
    if (groups !== undefined) desc.setCollisionGroups(groups);
    return desc;
  });
}

/**
 * A collider descriptor for one primitive. A convex primitive builds a Rapier
 * convex hull from its (already body-local) points; everything else is a
 * translated/rotated box/sphere/capsule. A degenerate hull falls back to the
 * primitive's bounding box.
 */
function primitiveColliderDesc(RAPIER: RapierModule, primitive: ColliderPrimitive) {
  if (primitive.shape === "heightfield" && primitive.heightfield) {
    const { quadsX, quadsZ, spacing, heights } = primitive.heightfield;
    // Rapier's matrix is column-major (Z fastest within a column of constant X),
    // with rows along Z and columns along X; it splits each cell along the same
    // diagonal as the grid's triangles (OPEN_WORLD_PLAN K3a).
    const columnMajor = new Float32Array(heights.length);
    for (let x = 0; x <= quadsX; x += 1) {
      for (let z = 0; z <= quadsZ; z += 1) columnMajor[x * (quadsZ + 1) + z] = heights[z * (quadsX + 1) + x]!;
    }
    // Same reason as the trimesh flag: no catching on internal edges (S4).
    return RAPIER.ColliderDesc.heightfield(quadsZ, quadsX, columnMajor, { x: quadsX * spacing, y: 1, z: quadsZ * spacing },
      RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
  }
  if (
    primitive.shape === "trimesh" &&
    primitive.vertices &&
    primitive.vertices.length >= 3 &&
    primitive.indices &&
    primitive.indices.length >= 3
  ) {
    const vertices = new Float32Array(primitive.vertices.length * 3);
    primitive.vertices.forEach((point, index) => {
      vertices[index * 3] = point[0];
      vertices[index * 3 + 1] = point[1];
      vertices[index * 3 + 2] = point[2];
    });
    const indices = new Uint32Array(primitive.indices);
    // Without it, bodies rolling or sliding across the mesh catch on the shared
    // edges of neighbouring triangles and get kicked upward. It also merges
    // duplicate vertices (UV-seam splits) so those edges are recognised.
    return RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
  }
  if (primitive.shape === "convex" && primitive.points && primitive.points.length >= 4) {
    const flat = new Float32Array(primitive.points.length * 3);
    primitive.points.forEach((point, index) => {
      flat[index * 3] = point[0];
      flat[index * 3 + 1] = point[1];
      flat[index * 3 + 2] = point[2];
    });
    const hull = RAPIER.ColliderDesc.convexHull(flat);
    if (hull) return hull; // points are absolute (body-local) — no extra translation
  }
  const center = primitive.center ?? [0, 0, 0];
  const shape = primitive.shape === "convex" || primitive.shape === "trimesh" ? "box" : primitive.shape;
  const desc = colliderShapeDesc(RAPIER, shape, primitive.size).setTranslation(
    center[0] ?? 0,
    center[1] ?? 0,
    center[2] ?? 0,
  );
  if (primitive.rotation) desc.setRotation(quaternionFromEulerDegrees(primitive.rotation));
  return desc;
}

function colliderDescForBody(RAPIER: RapierModule, body: PhysicsBody) {
  // `size` is world-space (placement scale already baked); the `center` offset
  // is applied as the collider's translation relative to the body position.
  const size = body.collider.size;
  const center = body.collider.center ?? [0, 0, 0];
  const desc = colliderShapeDesc(RAPIER, body.collider.shape, size);
  const colliderDesc = desc
    .setTranslation(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0)
    .setFriction(body.collider.friction ?? DEFAULT_FRICTION)
    .setRestitution(body.collider.restitution ?? DEFAULT_RESTITUTION);
  if (body.collider.collisionGroups !== undefined) {
    colliderDesc.setCollisionGroups(body.collider.collisionGroups);
  }
  if (body.collider.simulatePhysics && body.collider.massKg !== undefined) {
    return colliderDesc.setMass(body.collider.massKg);
  }
  return colliderDesc;
}

function rigidBodyDescForBody(RAPIER: RapierModule, body: PhysicsBody) {
  if (body.collider.isStatic) return RAPIER.RigidBodyDesc.fixed();
  if (body.collider.simulatePhysics) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setCcdEnabled(true)
      .setLinearDamping(body.collider.linearDamping ?? 0.12)
      .setAngularDamping(body.collider.angularDamping ?? 0.45)
      .setGravityScale(body.collider.enableGravity === false ? 0 : 1);
    const lockPosition = body.collider.lockPosition;
    if (lockPosition) {
      desc.restrictTranslations(!lockPosition[0], !lockPosition[1], !lockPosition[2]);
    }
    const lockRotation = body.collider.lockRotation;
    if (lockRotation) {
      desc.restrictRotations(!lockRotation[0], !lockRotation[1], !lockRotation[2]);
    }
    return desc;
  }
  return RAPIER.RigidBodyDesc.kinematicPositionBased();
}

function colliderShapeDesc(
  RAPIER: RapierModule,
  shape: ColliderComponent["shape"],
  size: readonly number[],
) {
  if (shape === "sphere") {
    return RAPIER.ColliderDesc.ball(Math.max(size[0] ?? 1, size[1] ?? 1, size[2] ?? 1) / 2);
  }
  if (shape === "capsule") {
    const radius = Math.max(size[0] ?? 1, size[2] ?? 1) / 2;
    const halfHeight = Math.max(0, ((size[1] ?? 1) / 2) - radius);
    return RAPIER.ColliderDesc.capsule(halfHeight, radius);
  }
  if (shape === "cylinder") {
    const radius = Math.max(size[0] ?? 1, size[2] ?? 1) / 2;
    return RAPIER.ColliderDesc.cylinder((size[1] ?? 1) / 2, radius);
  }
  if (shape === "cone") {
    const radius = Math.max(size[0] ?? 1, size[2] ?? 1) / 2;
    return RAPIER.ColliderDesc.cone((size[1] ?? 1) / 2, radius);
  }
  return RAPIER.ColliderDesc.cuboid(
    (size[0] ?? 1) / 2,
    (size[1] ?? 1) / 2,
    (size[2] ?? 1) / 2,
  );
}

function vectorFromTransform(transform: TransformComponent): { x: number; y: number; z: number } {
  return {
    x: transform.position[0],
    y: transform.position[1],
    z: transform.position[2],
  };
}

function vectorFromVec3(vec: Vec3): { x: number; y: number; z: number } {
  return {
    x: vec[0],
    y: vec[1],
    z: vec[2],
  };
}

function quaternionFromEulerDegrees(rotation: Vec3): { x: number; y: number; z: number; w: number } {
  const x = degreesToRadians(rotation[0]) / 2;
  const y = degreesToRadians(rotation[1]) / 2;
  const z = degreesToRadians(rotation[2]) / 2;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function eulerDegreesFromQuaternion(rotation: {
  x: number;
  y: number;
  z: number;
  w: number;
}): Vec3 {
  const x = rotation.x;
  const y = rotation.y;
  const z = rotation.z;
  const w = rotation.w;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);

  const ry = Math.asin(clamp(m13, -1, 1));
  let rx: number;
  let rz: number;
  if (Math.abs(m13) < 0.9999999) {
    rx = Math.atan2(-m23, m33);
    rz = Math.atan2(-m12, m11);
  } else {
    rx = Math.atan2(m32, m22);
    rz = 0;
  }
  return [radiansToDegrees(rx), radiansToDegrees(ry), radiansToDegrees(rz)];
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
