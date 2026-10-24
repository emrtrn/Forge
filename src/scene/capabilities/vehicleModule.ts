/**
 * Layer 2 capability: wheel visuals and engine sound for ray-cast vehicles
 * (vehicle plan Faz 1, 4d).
 *
 * Physics owns the vehicle itself — the `Vehicle` component turns a dynamic
 * actor into a chassis with suspension rays, whether or not this module runs.
 * What this module adds is what a ray has no mesh for: a wheel per suspension
 * ray, hung at the live spring length, yawed by the steering and spun by the
 * rolling distance. Switching it off leaves an invisible-wheeled, silent but
 * fully drivable car (I3).
 *
 * A driven car with an `engineSound` also gets one looped, spatial engine
 * voice through the audio capability: pitch from the RPM, volume from the
 * engine load, position from the car. It starts when someone takes the wheel
 * and fades out when they leave it; without the audio capability the car is
 * simply silent.
 *
 * Physical materials may opt into per-wheel effects and tyre loops. Contact
 * points anchor them, slip/speed steer their levels, and the physics active
 * radius limits nearby cars while driven/possessed vehicles always qualify.
 * Materials without wheel presentation create no VFX or audio handles.
 *
 * Rigs are built lazily, the first frame a vehicle id shows up with a render
 * object, so the module does not depend on whether physics initialised before
 * or after the level hooks, and a runtime-spawned vehicle gets wheels too.
 *
 * Under `?debug` (the host's `debug` flag) each rig also carries a suspension
 * wire — springs, clamp range and ground contacts (Faz 5) — so a shipped game
 * never builds one.
 */
import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type LineSegments,
  type Object3D,
} from "three";

import type { AudioPlaybackHandle } from "@engine/audio/audioSubsystem";
import { vehicleWheelWidth } from "@engine/physics/surface/sinkage";
import { vehicleEngineSoundLevels } from "@engine/physics/vehicle/vehicleEngineSound";
import type { VehicleState, VehicleWheelState } from "@engine/physics/vehicle/vehicleTypes";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import {
  audioCommandsService,
  vehicleHostService,
  vfxCommandsService,
  type AudioCommands,
  type VehicleHost,
} from "./runtimeServiceKeys";
import {
  createVehicleSuspensionWire,
  disposeVehicleSuspensionWire,
  updateVehicleSuspensionWire,
} from "./vehicleSuspensionWire";
import { WheelSurfacePresentation } from "./wheelSurfacePresentation";

export const VEHICLE_MODULE_ID = "vehicle";

/** Seconds the engine takes to die away once the driver leaves the car. */
const ENGINE_STOP_FADE_SECONDS = 0.5;
/** Per-frame volume ramp; smooths a load step (throttle stab, gear change cut). */
const ENGINE_VOLUME_RAMP_SECONDS = 0.08;

interface EngineVoice {
  readonly sound: string;
  readonly handle: AudioPlaybackHandle;
}

interface WheelRig {
  readonly host: Object3D;
  /** Child of the actor root that cancels its (placement × mesh) scale. */
  readonly container: Group;
  readonly wheels: Group[];
  readonly restoreNodes: (() => void)[];
  /** `?debug` suspension wire, in the container's chassis frame. */
  debugWire: LineSegments | null;
}

/** Move an authored wheel into a physics pivot, preserving its geometry/materials.
 * Recenter its bounds (many models pivot at the inner hub), fit its radius, and
 * bake ancestor scale so the outer wheel rig can keep working in physics metres.
 */
function bindModelWheel(actor: Object3D, node: Object3D, wheel: VehicleWheelState, pivot: Group): (() => void) | null {
  if (!node.parent || node === actor) return null;
  actor.updateWorldMatrix(true, true);
  const worldToChassis = new Matrix4().makeScale(actor.scale.x, actor.scale.y, actor.scale.z)
    .multiply(new Matrix4().copy(actor.matrixWorld).invert());
  const bounds = new Box3();
  node.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.computeBoundingBox();
    if (child.geometry.boundingBox) bounds.union(child.geometry.boundingBox.clone()
      .applyMatrix4(new Matrix4().copy(worldToChassis).multiply(child.matrixWorld)));
  });
  if (bounds.isEmpty()) return null;
  const centre = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const radius = Math.max(size.y, size.z) / 2;
  if (!(radius > 0)) return null;
  const fit = wheel.radius / radius;
  const local = new Matrix4().makeScale(fit, fit, fit)
    .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z))
    .multiply(worldToChassis).multiply(node.matrixWorld);
  const parent = node.parent;
  const index = parent.children.indexOf(node);
  const original = { matrix: node.matrix.clone(), position: node.position.clone(),
    quaternion: node.quaternion.clone(), scale: node.scale.clone(), autoUpdate: node.matrixAutoUpdate };
  pivot.add(node);
  node.matrix.copy(local);
  node.matrixAutoUpdate = false;
  node.matrixWorldNeedsUpdate = true;
  return () => {
    parent.add(node);
    parent.children.splice(parent.children.indexOf(node), 1);
    parent.children.splice(index, 0, node);
    node.position.copy(original.position);
    node.quaternion.copy(original.quaternion);
    node.scale.copy(original.scale);
    node.matrix.copy(original.matrix);
    node.matrixAutoUpdate = original.autoUpdate;
    node.matrixWorldNeedsUpdate = true;
  };
}

export function createVehicleModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  const rigs = new Map<string, WheelRig>();
  const engines = new Map<string, EngineVoice>();
  const surfaces = new Map<string, WheelSurfacePresentation>();
  const scratch = new Vector3();

  const stopEngine = (entityId: string, fadeSeconds = ENGINE_STOP_FADE_SECONDS): void => {
    engines.get(entityId)?.handle.stop(fadeSeconds);
    engines.delete(entityId);
  };

  const stopEngines = (fadeSeconds = 0): void => {
    for (const entityId of [...engines.keys()]) stopEngine(entityId, fadeSeconds);
  };

  const clearSurfaces = (): void => {
    for (const surface of surfaces.values()) surface.dispose();
    surfaces.clear();
  };

  /**
   * Runs, steers or stops one car's engine voice. A voice the audio layer
   * refused (voice budget, missing source) stays parked as stopped until the
   * car is left and taken again — never re-requested every frame.
   */
  const updateEngine = (
    host: VehicleHost,
    audio: AudioCommands | undefined,
    entityId: string,
    state: VehicleState,
    object: Object3D,
  ): void => {
    const definition = host.vehicleDefinition(entityId);
    const sound = definition?.engineSound ?? null;
    if (!audio || !definition || !sound || !host.isDriven(entityId)) {
      stopEngine(entityId);
      return;
    }
    const levels = vehicleEngineSoundLevels(sound, definition, state);
    object.getWorldPosition(scratch);
    const position = [scratch.x, scratch.y, scratch.z] as const;
    const voice = engines.get(entityId);
    if (!voice || voice.sound !== sound.sound) {
      if (voice) stopEngine(entityId);
      const handle = audio.playLoop(sound.sound, {
        volume: levels.volume,
        pitch: levels.pitch,
        spatial: true,
        position,
        refDistance: sound.refDistance,
        maxDistance: sound.maxDistance,
        bus: "sfx",
      });
      engines.set(entityId, { sound: sound.sound, handle });
      return;
    }
    if (voice.handle.stopped) return;
    voice.handle.setPitch(levels.pitch);
    voice.handle.setVolume(levels.volume, ENGINE_VOLUME_RAMP_SECONDS);
    voice.handle.setPosition(position);
  };
  const geometries: BufferGeometry[] = [];
  const tyreMaterial = new MeshStandardMaterial({ color: "#1c1e21", roughness: 0.92 });
  const hubMaterial = new MeshStandardMaterial({ color: "#a7b0ba", roughness: 0.45, metalness: 0.6 });

  const clearRigs = (): void => {
    for (const rig of rigs.values()) releaseRig(rig);
    rigs.clear();
    for (const geometry of geometries) geometry.dispose();
    geometries.length = 0;
  };

  const releaseRig = (rig: WheelRig): void => {
    for (const restore of [...rig.restoreNodes].reverse()) restore();
    if (rig.debugWire) disposeVehicleSuspensionWire(rig.debugWire);
    rig.debugWire = null;
    rig.container.removeFromParent();
  };

  const updateDebugWire = (host: VehicleHost, entityId: string, rig: WheelRig, state: VehicleState): void => {
    if (rig.debugWire?.userData.wheelCount !== state.wheels.length) {
      if (rig.debugWire) disposeVehicleSuspensionWire(rig.debugWire);
      rig.debugWire = createVehicleSuspensionWire(state.wheels.length);
      rig.debugWire.userData.wheelCount = state.wheels.length;
      // A sibling of the wheel container, not a child: the container holds
      // exactly one pivot per wheel. Same scale cancel, so the same frame.
      rig.host.add(rig.debugWire);
    }
    rig.debugWire.scale.copy(rig.container.scale);
    // Contacts come back in world space; bring them into the chassis frame.
    rig.debugWire.updateWorldMatrix(true, false);
    updateVehicleSuspensionWire(rig.debugWire, rig.debugWire, state.wheels, host.vehicleDefinition(entityId));
  };

  const buildWheel = (radius: number, width: number): Group => {
    // Cylinders stand on +Y; lay the tyre on its side so it rolls about X.
    const tyre = new CylinderGeometry(radius, radius, width, 24);
    tyre.rotateZ(Math.PI / 2);
    // A bar across the hub face makes the spin readable on a symmetric tyre.
    const hub = new BoxGeometry(width * 1.04, radius * 1.3, radius * 0.22);
    geometries.push(tyre, hub);
    const wheel = new Group();
    wheel.rotation.order = "YXZ"; // steer about the chassis up axis, then spin
    for (const mesh of [new Mesh(tyre, tyreMaterial), new Mesh(hub, hubMaterial)]) {
      mesh.castShadow = true;
      wheel.add(mesh);
    }
    return wheel;
  };

  const ensureRig = (host: VehicleHost, entityId: string): WheelRig | null => {
    const existing = rigs.get(entityId);
    const object = host.actorObject(entityId);
    if (existing && existing.host === object) return existing;
    if (existing) {
      releaseRig(existing);
      surfaces.get(entityId)?.dispose();
      surfaces.delete(entityId);
    }
    rigs.delete(entityId);
    const state = host.vehicleState(entityId);
    if (!object || !state) return null;
    const container = new Group();
    container.name = "VehicleWheels";
    const restoreNodes: (() => void)[] = [];
    const boundNodes = new Set<Object3D>();
    const definition = host.vehicleDefinition(entityId);
    const wheels = state.wheels.map((wheel, index) => {
      const node = wheel.visualNode ? object.getObjectByName(wheel.visualNode) : undefined;
      if (node && !boundNodes.has(node)) {
        const pivot = new Group();
        pivot.name = `VehicleWheel:${wheel.visualNode}`;
        pivot.rotation.order = "YXZ";
        const restore = bindModelWheel(object, node, wheel, pivot);
        if (restore) {
          boundNodes.add(node);
          restoreNodes.push(restore);
          container.add(pivot);
          return pivot;
        }
      }
      if (wheel.visualNode) console.warn(`[vehicle] Wheel node ${wheel.visualNode} is missing or unusable; using a generated wheel.`);
      const group = buildWheel(wheel.radius, vehicleWheelWidth(definition?.wheels[index] ?? wheel));
      container.add(group);
      return group;
    });
    object.add(container);
    const rig: WheelRig = { host: object, container, wheels, restoreNodes, debugWire: null };
    rigs.set(entityId, rig);
    return rig;
  };

  return {
    id: VEHICLE_MODULE_ID,

    onRuntimeStart(runtimeServices) {
      services = runtimeServices;
    },

    onLevelUnloaded() {
      clearRigs();
      stopEngines();
      clearSurfaces();
    },

    update(deltaSeconds) {
      const host = services?.resolve(vehicleHostService);
      if (!host) return;
      const audio = services?.resolve(audioCommandsService);
      const vfx = services?.resolve(vfxCommandsService);
      const live = host.vehicleIds();
      for (const entityId of surfaces.keys()) {
        if (!live.includes(entityId) ||
            (!host.isDriven(entityId) && host.possessedEntityId() !== entityId && host.isSurfaceFxActive?.(entityId) === false)) {
          surfaces.get(entityId)!.dispose();
          surfaces.delete(entityId);
        }
      }
      for (const entityId of rigs.keys()) {
        if (!live.includes(entityId)) {
          releaseRig(rigs.get(entityId)!);
          rigs.delete(entityId);
        }
      }
      for (const entityId of [...engines.keys()]) {
        if (!live.includes(entityId)) stopEngine(entityId);
      }
      for (const entityId of live) {
        const rig = ensureRig(host, entityId);
        const state = host.vehicleState(entityId);
        if (!rig || !state) {
          surfaces.get(entityId)?.dispose();
          surfaces.delete(entityId);
          continue;
        }
        const scale = rig.host.scale;
        rig.container.scale.set(inverse(scale.x), inverse(scale.y), inverse(scale.z));
        state.wheels.forEach((wheel, index) => {
          const group = rig.wheels[index];
          if (group) poseWheel(group, wheel);
        });
        if (host.debug) updateDebugWire(host, entityId, rig, state);
        updateEngine(host, audio, entityId, state, rig.host);
        if (host.surfaceMaterialForWheel && (host.isDriven(entityId) || host.possessedEntityId() === entityId ||
            host.isSurfaceFxActive?.(entityId) !== false)) {
          let surface = surfaces.get(entityId);
          if (!surface) {
            surface = new WheelSurfacePresentation();
            surfaces.set(entityId, surface);
          }
          surface.update(host, entityId, state, deltaSeconds, vfx, audio);
        }
      }
    },

    dispose() {
      clearRigs();
      stopEngines();
      clearSurfaces();
      tyreMaterial.dispose();
      hubMaterial.dispose();
      services = null;
    },
  };
}

/**
 * Hangs the wheel at its live spring length (suspension rays point down -Y),
 * plus its sink: the ray still meets the unchanged terrain collider.
 */
function poseWheel(group: Group, wheel: VehicleWheelState): void {
  group.position.set(wheel.position[0], wheel.position[1] - wheel.suspensionLength - (wheel.sinkDepth ?? 0), wheel.position[2]);
  group.rotation.y = wheel.steering;
  // Rolling forward (+Z) is a positive spin about +X.
  group.rotation.x = wheel.rotation;
}

function inverse(value: number): number {
  return value === 0 ? 1 : 1 / value;
}
