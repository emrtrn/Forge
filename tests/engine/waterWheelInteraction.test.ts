import assert from "node:assert/strict";
import { Matrix4, Scene, Vector3 } from "three";
import { WaterWheelFoamState, waterWheelContact } from "../../engine/terrain/waterWheelInteraction";
import type { VehicleState, VehicleWheelState } from "../../engine/physics/vehicle/vehicleTypes";
import { buildRiverWaterRibbon, createRiverWaterObject } from "../../engine/render-three/riverWater";
import { RiverWheelSurface, riverWheelWave } from "../../engine/render-three/riverWheelSurface";
import { resolveRiverWater } from "../../engine/scene/riverWater";
import { LakeWaterController } from "../../src/scene/lakeWaterController";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { FULL_LAKE_QUALITY } from "../../engine/perf/lakeQuality";

const wheel = (patch: Partial<VehicleWheelState> = {}): VehicleWheelState => ({ position: [0, 0, 0], radius: .5,
  suspensionLength: .3, suspensionForce: 0, steering: 0, rotation: 0, inContact: false,
  groundEntityId: null, contactPoint: null, hardPoint: [0, 0, 0], worldCenter: [0, .1, 0], worldAxle: [1, 0, 0], tractionSlip: 0, ...patch });
const spline = { id: "s", points: [{ id: "a", position: [-8, 2, 0] as [number, number, number], width: 3, falloff: 0 },
  { id: "b", position: [8, -2, 0] as [number, number, number], width: 3, falloff: 0 }], segments: [{ id: "s", startPointId: "a", endPointId: "b" }] };

export async function registerWaterWheelInteractionTests(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check("water wheels: cylinder intersections follow slope, tyre roll and exact wet surface without requiring ground contact", async () => {
    const normal = new Vector3(.25, 1, 0).normalize().toArray() as [number, number, number];
    const sample = (x: number, z: number) => Math.abs(x) < 8 && Math.abs(z) < 3 ? { level: -x * .25, normal } : null;
    assert.ok(waterWheelContact("w", wheel(), .3, sample));
    assert.ok(waterWheelContact("w", wheel({ worldAxle: new Vector3(1, 1, 0).normalize().toArray() }), .3, sample));
    for (const patch of [{ worldCenter: [0, 2, 0] }, { worldCenter: [0, -2, 0] }, { worldCenter: [30, .1, 0] },
      { worldAxle: [2, 0, 0] }, { worldCenter: [NaN, 0, 0] }]) assert.equal(waterWheelContact("w", wheel(patch as Partial<VehicleWheelState>), .3, sample), null);
    assert.equal(waterWheelContact("w", wheel(), .3, () => null), null);
    const data = buildRiverWaterRibbon(spline, { surfaceLevel: 2, widthScale: 1, heightAt: () => -5, sampleSpacing: 1 });
    const surface = new RiverWheelSurface(data, .5, .2, 3);
    const matrix = new Matrix4().makeRotationY(.8).premultiply(new Matrix4().makeTranslation(1000000, 12, -2000000));
    surface.update(matrix);
    const ids = data.indices.slice(30, 33), clock = 1.2;
    const p = ids.map(i => new Vector3().fromArray(data.positions, i * 3).add(new Vector3(0, riverWheelWave(data, i, clock, .5, .2, 3), 0)).applyMatrix4(matrix));
    const centre = p.reduce((a, b) => a.add(b), new Vector3()).multiplyScalar(1 / 3), hit = surface.sampleAt(centre.x, centre.z, clock);
    assert.ok(hit); assert.ok(Math.abs(hit.level - centre.y) < 1e-6);
    assert.ok(hit.normal[1] < 1); assert.ok(Math.abs(hit.flowX!) + Math.abs(hit.flowZ!) > 0);
    assert.equal(surface.sampleAt(1000040, -2000000, clock), null);
    const dry = new RiverWheelSurface({ ...data, bedDepths: data.bedDepths.map(() => 0) }, .5, .2, 3); dry.update(matrix);
    assert.equal(dry.sampleAt(centre.x, centre.z, clock), null);
  });
  await check("water wheels: foam emits only on continuous movement/slip, advects, stays bounded and expires", async () => {
    const state = new WaterWheelFoamState(), contact = { id: "w", x: 0, y: 0, z: 0, rotation: 0, radius: .5, tractionSlip: 0, flowX: 2, flowZ: 0 };
    for (let i = 0; i < 30; i++) state.advance(1 / 60, [contact]); assert.equal(state.puffs.length, 0);
    state.advance(1 / 60, [{ ...contact, tractionSlip: .8 }]); assert.equal(state.puffs.length, 1);
    const puff = state.puffs[0]!; state.advance(.05, []); assert.ok(puff.x > .09); assert.ok(puff.age > 0);
    state.advance(3, []); assert.equal(state.puffs.length, 0);
    state.clear(); state.setLimit(4);
    for (let i = 0; i < 120; i++) state.advance(1 / 60, [{ ...contact, x: i / 60, tractionSlip: .8 }]);
    assert.equal(state.puffs.length, 4); state.setLimit(0); assert.equal(state.puffs.length, 0);
    state.clear(); state.setLimit(24); state.advance(1 / 60, [contact]);
    state.advance(1 / 60, [{ ...contact, x: 50, tractionSlip: 1 }]); assert.equal(state.puffs.length, 0, "teleports cannot splash along the jump");
  });
  await check("water wheels: river-only fixed-step subscription and Lake foam share quality, hidden and disposal gates", async () => {
    const f = createLakeFixture(), scene = new Scene();
    const river = createRiverWaterObject({ ...resolveRiverWater({ id: "r", landscapeRef: "l", splineRef: "s", surfaceLevel: 14, waveAmplitude: 0, foamOpacity: 0 }),
      spline, position: [-20, 0, -12], rotation: [0, 0, 0], heightAt: () => 5, foamNoiseMap: null }, null);
    scene.add(river);
    let w = wheel({ worldCenter: [-20, 12.1, -12] }), listener: ((dt: number) => void) | null = null, unsubscribed = 0;
    const controller = new LakeWaterController({ scene, editor: false, rivers: () => [river], document: () => f,
      load: async (_, key) => f.tiles.get(key)!, normal: async () => null,
      vehicles: { vehicleIds: () => ["v"], vehicleState: () => ({ wheels: [w] } as unknown as VehicleState), vehicleDefinition: () => null,
        onPhysicsStep: fn => { listener = fn; return () => { listener = null; unsubscribed++; }; } } });
    const tick = (n = 1) => { for (let i = 0; i < n; i++) { assert.ok(listener); (listener as (dt: number) => void)(1 / 60); } };
    try {
      await controller.rebuild([]); tick(); w = wheel({ worldCenter: [-20, 12.1, -12], tractionSlip: .8 }); tick();
      assert.ok(river.material.uniforms.wheelRippleCount!.value > 0, "no Lake actor is needed");
      assert.ok(river.material.uniforms.wheelFoamCount!.value > 0, "static river foam may be off");
      await controller.rebuild([{ ...f.lake, appearance: { foamEnabled: false, wheelRipplesEnabled: false } }]);
      tick(); w = wheel({ worldCenter: [-19.99, 12.1, -12], tractionSlip: .8 }); tick();
      const lake = controller.objects.get(f.lake.id)!;
      assert.equal(lake.material.uniforms.wheelRippleCount!.value, 0);
      assert.ok(lake.material.uniforms.wheelFoamCount!.value > 0, "wheel foam is independent of shore foam and ripple toggles");
      await controller.setQuality({ ...FULL_LAKE_QUALITY, foamAllowed: false }); await river.applyQuality({ ...FULL_LAKE_QUALITY, foamAllowed: false });
      assert.equal(lake.material.uniforms.wheelFoamCount!.value, 0); assert.equal(river.material.uniforms.wheelFoamCount!.value, 0);
      assert.ok(river.material.uniforms.wheelRippleCount!.value > 0);
      river.visible = false; lake.visible = false; tick();
      assert.equal(river.material.uniforms.wheelRippleCount!.value, 0); assert.equal(lake.material.uniforms.wheelFoamCount!.value, 0);
    } finally { controller.dispose(); scene.remove(river); river.dispose(); assert.equal(unsubscribed, 1); }
  });
}
