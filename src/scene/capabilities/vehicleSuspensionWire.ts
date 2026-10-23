/**
 * `?debug` suspension wire for one ray-cast vehicle (vehicle plan Faz 5).
 *
 * One {@link LineSegments} per car under the actor root, scaled like the wheel
 * rig to cancel the placement × mesh scale, so it is drawn in the same chassis
 * frame and rides the car exactly like the wheels do. Per wheel it shows:
 *
 * - the live spring: hard point → wheel centre (yellow);
 * - the suspension clamp range: ticks at `rest ± maxTravel` (cyan), when the
 *   resolved definition is known;
 * - the ground contact: wheel centre → the physics hit, plus a cross on the hit
 *   (green); an airborne wheel draws its radius below the centre instead (red).
 *
 * The buffer has a fixed size per wheel; segments a frame does not need are
 * collapsed to zero length rather than reallocated.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Vector3,
  type Object3D,
} from "three";

import type { VehicleDefinition, VehicleWheelState } from "@engine/physics/vehicle/vehicleTypes";

export const VEHICLE_SUSPENSION_WIRE_NAME = "VehicleSuspensionDebug";

/** spring + contact link + 4 range ticks + 3 contact-cross arms. */
const SEGMENTS_PER_WHEEL = 9;
const TICK_HALF = 0.08;
const CROSS_HALF = 0.06;

const SPRING_COLOR = new Color(0xffd166);
const RANGE_COLOR = new Color(0x4cc9f0);
const CONTACT_COLOR = new Color(0x49e6a2);
const AIRBORNE_COLOR = new Color(0xff5d5d);

export function createVehicleSuspensionWire(wheelCount: number): LineSegments {
  const vertices = wheelCount * SEGMENTS_PER_WHEEL * 2;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(vertices * 3), 3));
  const wire = new LineSegments(
    geometry,
    new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
  );
  wire.name = VEHICLE_SUSPENSION_WIRE_NAME;
  wire.renderOrder = 999;
  wire.frustumCulled = false;
  return wire;
}

export function disposeVehicleSuspensionWire(wire: LineSegments): void {
  wire.removeFromParent();
  wire.geometry.dispose();
  (wire.material as LineBasicMaterial).dispose();
}

const scratch = new Vector3();

/**
 * Rewrites the wire from the live wheel readback. `frame` is the chassis-frame
 * object the points are expressed in (the wire itself): world-space contact
 * points are brought into it, so its world matrix must be current.
 */
export function updateVehicleSuspensionWire(
  wire: LineSegments,
  frame: Object3D,
  wheels: readonly VehicleWheelState[],
  definition: VehicleDefinition | null,
): void {
  const position = wire.geometry.getAttribute("position") as BufferAttribute;
  const color = wire.geometry.getAttribute("color") as BufferAttribute;
  let vertex = 0;
  const point = (x: number, y: number, z: number, tint: Color): void => {
    if (vertex >= position.count) return;
    position.setXYZ(vertex, x, y, z);
    color.setXYZ(vertex, tint.r, tint.g, tint.b);
    vertex += 1;
  };
  const segment = (a: readonly number[], b: readonly number[], tint: Color): void => {
    point(a[0]!, a[1]!, a[2]!, tint);
    point(b[0]!, b[1]!, b[2]!, tint);
  };
  const collapsed = (count: number): void => {
    for (let index = 0; index < count * 2; index += 1) point(0, 0, 0, SPRING_COLOR);
  };

  wheels.forEach((wheel, index) => {
    const [x, y, z] = wheel.position;
    const centre = [x, y - wheel.suspensionLength, z];
    segment(wheel.position, centre, SPRING_COLOR);

    if (wheel.inContact && wheel.contactPoint) {
      scratch.set(wheel.contactPoint[0], wheel.contactPoint[1], wheel.contactPoint[2]);
      frame.worldToLocal(scratch);
      const hit = [scratch.x, scratch.y, scratch.z];
      segment(centre, hit, CONTACT_COLOR);
      segment([hit[0]! - CROSS_HALF, hit[1]!, hit[2]!], [hit[0]! + CROSS_HALF, hit[1]!, hit[2]!], CONTACT_COLOR);
      segment([hit[0]!, hit[1]! - CROSS_HALF, hit[2]!], [hit[0]!, hit[1]! + CROSS_HALF, hit[2]!], CONTACT_COLOR);
      segment([hit[0]!, hit[1]!, hit[2]! - CROSS_HALF], [hit[0]!, hit[1]!, hit[2]! + CROSS_HALF], CONTACT_COLOR);
    } else {
      segment(centre, [centre[0]!, centre[1]! - wheel.radius, centre[2]!], AIRBORNE_COLOR);
      collapsed(3);
    }

    const authored = definition?.wheels[index];
    if (authored) {
      // Rapier clamps the spring to rest ± maxTravel (the Bullet model).
      for (const length of [
        authored.suspensionRestLength - authored.suspensionMaxTravel,
        authored.suspensionRestLength + authored.suspensionMaxTravel,
      ]) {
        const tickY = y - length;
        segment([x - TICK_HALF, tickY, z], [x + TICK_HALF, tickY, z], RANGE_COLOR);
        segment([x, tickY, z - TICK_HALF], [x, tickY, z + TICK_HALF], RANGE_COLOR);
      }
    } else {
      collapsed(4);
    }
  });

  position.needsUpdate = true;
  color.needsUpdate = true;
}
