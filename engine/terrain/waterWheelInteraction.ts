import type { VehicleDefinition, VehicleState, VehicleWheelState } from "../physics/vehicle/vehicleTypes";
import { LakeRippleState, type LakeRipple, type LakeWheelContact } from "./lakeInteraction";
import { LAKE_WHEEL_RIPPLE_DEFAULTS } from "../scene/waterBody";

export interface WaterWheelVehicle { id: string; state: VehicleState | null | undefined; definition: VehicleDefinition | null | undefined }
export interface WaterWheelContact extends LakeWheelContact { flowX?: number; flowZ?: number }
export interface WheelWaterSample { level: number; normal: readonly [number, number, number]; flowX?: number; flowZ?: number }

/** A finite tyre cylinder cuts the local water plane. Refine against the actual
 * displaced triangles so downhill surfaces, rolled tyres and holes agree. */
export function waterWheelContact(id: string, wheel: VehicleWheelState, width: number,
  sampleAt: (x: number, z: number) => WheelWaterSample | null): WaterWheelContact | null {
  const c = wheel.worldCenter, axle = wheel.worldAxle;
  if (!c || !axle || ![...c, ...axle, width, wheel.radius, wheel.rotation, wheel.tractionSlip ?? 0].every(Number.isFinite)
    || width <= 0 || wheel.radius <= 0 || Math.abs(Math.hypot(...axle) - 1) > 1e-4) return null;
  let x = c[0], z = c[2], sample = sampleAt(x, z);
  for (let iteration = 0; iteration < 4; iteration++) {
    if (!sample) return null;
    const n = sample.normal, dot = n[0] * axle[0] + n[1] * axle[1] + n[2] * axle[2];
    const radialExtent = Math.sqrt(Math.max(0, 1 - dot * dot));
    const height = n[0] * (x - c[0]) + n[1] * (sample.level - c[1]) + n[2] * (z - c[2]);
    if (Math.abs(height) >= wheel.radius * radialExtent + width * .5 * Math.abs(dot) - 1e-5) return null;
    let along = Math.max(-width * .5, Math.min(width * .5, height * dot));
    let radial = radialExtent > 1e-6 ? (height - dot * along) / radialExtent : 0;
    if (Math.abs(radial) > wheel.radius) {
      radial = Math.max(-wheel.radius, Math.min(wheel.radius, radial)); along = (height - radialExtent * radial) / dot;
    }
    const radialScale = radialExtent > 1e-6 ? radial / radialExtent : 0;
    x = c[0] + axle[0] * along + (n[0] - axle[0] * dot) * radialScale;
    z = c[2] + axle[2] * along + (n[2] - axle[2] * dot) * radialScale;
    const next = sampleAt(x, z); if (!next) return null;
    const intersectionY = c[1] + axle[1] * along + (n[1] - axle[1] * dot) * radialScale;
    sample = next;
    if (Math.abs(next.level - intersectionY) < 1e-5) return { id, x, y: c[1], z, rotation: wheel.rotation, radius: wheel.radius,
      ...(wheel.tractionSlip === undefined ? {} : { tractionSlip: wheel.tractionSlip }),
      flowX: next.flowX ?? 0, flowZ: next.flowZ ?? 0 };
  }
  return null;
}

export const WATER_WHEEL_FOAM_LIFETIME = 2.8;
/** Same bounded, fixed-step motion/slip emitter as Lake ripples, independent of
 * authored shore foam and ripple toggles. No terrain, physics or save writes. */
export class WaterWheelFoamState {
  private readonly emitter = new LakeRippleState({ ...LAKE_WHEEL_RIPPLE_DEFAULTS, wheelRippleStrength: 1,
    wheelRippleLifetime: WATER_WHEEL_FOAM_LIFETIME, wheelRippleInterval: .08 });
  private velocities = new WeakMap<LakeRipple, { x: number; z: number }>();
  get puffs(): readonly LakeRipple[] { return this.emitter.ripples; }
  setLimit(limit: number): void { this.emitter.setLimit(limit); }
  advance(dt: number, contacts: readonly WaterWheelContact[]): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.emitter.advance(dt, contacts);
    for (const puff of this.emitter.ripples) {
      let velocity = this.velocities.get(puff);
      if (!velocity) {
        const contact = contacts.find(c => c.x === puff.x && c.z === puff.z);
        velocity = { x: Number.isFinite(contact?.flowX) ? contact!.flowX! : 0, z: Number.isFinite(contact?.flowZ) ? contact!.flowZ! : 0 };
        this.velocities.set(puff, velocity);
      } else { puff.x += velocity.x * dt; puff.z += velocity.z * dt; }
    }
  }
  clear(): void { this.emitter.clear(); this.velocities = new WeakMap(); }
}
