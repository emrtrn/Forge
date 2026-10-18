/**
 * Layer 2 capability: wheel visuals for ray-cast vehicles (vehicle plan Faz 1).
 *
 * Physics owns the vehicle itself — the `Vehicle` component turns a dynamic
 * actor into a chassis with suspension rays, whether or not this module runs.
 * What this module adds is what a ray has no mesh for: a wheel per suspension
 * ray, hung at the live spring length, yawed by the steering and spun by the
 * rolling distance. Switching it off leaves an invisible-wheeled but fully
 * drivable car (I3).
 *
 * Rigs are built lazily, the first frame a vehicle id shows up with a render
 * object, so the module does not depend on whether physics initialised before
 * or after the level hooks, and a runtime-spawned vehicle gets wheels too.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Object3D,
} from "three";

import type { VehicleWheelState } from "@engine/physics/vehicle/vehicleTypes";

import type { CapabilityModule } from "./CapabilityModule";
import type { RuntimeServices } from "./RuntimeServices";
import { vehicleHostService, type VehicleHost } from "./runtimeServiceKeys";

export const VEHICLE_MODULE_ID = "vehicle";

const TYRE_WIDTH = 0.26;

interface WheelRig {
  readonly host: Object3D;
  /** Child of the actor root that cancels its (placement × mesh) scale. */
  readonly container: Group;
  readonly wheels: Group[];
}

export function createVehicleModule(): CapabilityModule {
  let services: RuntimeServices | null = null;
  const rigs = new Map<string, WheelRig>();
  const geometries: BufferGeometry[] = [];
  const tyreMaterial = new MeshStandardMaterial({ color: "#1c1e21", roughness: 0.92 });
  const hubMaterial = new MeshStandardMaterial({ color: "#a7b0ba", roughness: 0.45, metalness: 0.6 });

  const clearRigs = (): void => {
    for (const rig of rigs.values()) rig.container.removeFromParent();
    rigs.clear();
    for (const geometry of geometries) geometry.dispose();
    geometries.length = 0;
  };

  const buildWheel = (radius: number): Group => {
    // Cylinders stand on +Y; lay the tyre on its side so it rolls about X.
    const tyre = new CylinderGeometry(radius, radius, TYRE_WIDTH, 24);
    tyre.rotateZ(Math.PI / 2);
    // A bar across the hub face makes the spin readable on a symmetric tyre.
    const hub = new BoxGeometry(TYRE_WIDTH * 1.04, radius * 1.3, radius * 0.22);
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
    existing?.container.removeFromParent();
    rigs.delete(entityId);
    const state = host.vehicleState(entityId);
    if (!object || !state) return null;
    const container = new Group();
    container.name = "VehicleWheels";
    const wheels = state.wheels.map((wheel) => {
      const group = buildWheel(wheel.radius);
      container.add(group);
      return group;
    });
    object.add(container);
    const rig: WheelRig = { host: object, container, wheels };
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
    },

    update() {
      const host = services?.resolve(vehicleHostService);
      if (!host) return;
      const live = host.vehicleIds();
      for (const entityId of rigs.keys()) {
        if (!live.includes(entityId)) {
          rigs.get(entityId)?.container.removeFromParent();
          rigs.delete(entityId);
        }
      }
      for (const entityId of live) {
        const rig = ensureRig(host, entityId);
        const state = host.vehicleState(entityId);
        if (!rig || !state) continue;
        const scale = rig.host.scale;
        rig.container.scale.set(inverse(scale.x), inverse(scale.y), inverse(scale.z));
        state.wheels.forEach((wheel, index) => {
          const group = rig.wheels[index];
          if (group) poseWheel(group, wheel);
        });
      }
    },

    dispose() {
      clearRigs();
      tyreMaterial.dispose();
      hubMaterial.dispose();
      services = null;
    },
  };
}

/** Hangs the wheel at its live spring length (suspension rays point down -Y). */
function poseWheel(group: Group, wheel: VehicleWheelState): void {
  group.position.set(wheel.position[0], wheel.position[1] - wheel.suspensionLength, wheel.position[2]);
  group.rotation.y = wheel.steering;
  // Rolling forward (+Z) is a positive spin about +X.
  group.rotation.x = wheel.rotation;
}

function inverse(value: number): number {
  return value === 0 ? 1 : 1 / value;
}
