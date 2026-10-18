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
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Matrix4,
  Vector3,
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
  readonly restoreNodes: (() => void)[];
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
    rig.container.removeFromParent();
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
    if (existing) releaseRig(existing);
    rigs.delete(entityId);
    const state = host.vehicleState(entityId);
    if (!object || !state) return null;
    const container = new Group();
    container.name = "VehicleWheels";
    const restoreNodes: (() => void)[] = [];
    const boundNodes = new Set<Object3D>();
    const wheels = state.wheels.map((wheel) => {
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
      const group = buildWheel(wheel.radius);
      container.add(group);
      return group;
    });
    object.add(container);
    const rig: WheelRig = { host: object, container, wheels, restoreNodes };
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
          releaseRig(rigs.get(entityId)!);
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
