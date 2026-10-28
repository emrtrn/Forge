import assert from "node:assert/strict";
import { Scene, Vector3, Quaternion, Euler } from "three";
import { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import { createReferenceCarDefinition } from "../../engine/physics/vehicle/vehicleTypes";
import { LakeSurfaceQuery, LakeRippleState, lakeWheelContact, LAKE_MAX_RIPPLES, LAKE_RIPPLE_LIFETIME, type LakeWheelContact } from "../../engine/terrain/lakeInteraction";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import type { VehicleWheelState } from "../../engine/physics/vehicle/vehicleTypes";
import { LakeWaterController } from "../../src/scene/lakeWaterController";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { LAKE_WHEEL_RIPPLE_DEFAULTS, resolveLakeAppearance, validateWaterBody } from "../../engine/scene/waterBody";
import { validateLayout } from "../../tools/saveValidator";
import type { RoomLayout } from "../../engine/scene/layout";
import { createLakeRippleUniforms } from "../../engine/render-three/lakeRipples";
import { LAKE_SURFACE_WAVE_DEFAULTS } from "../../engine/scene/waterBody";
import { lakeWaveParameters, lakeWaveOffset } from "../../engine/terrain/lakeWaves";
import { LakeWaterObject } from "../../engine/render-three/lakeWater";

const wheel = (patch: Partial<VehicleWheelState> = {}): VehicleWheelState => ({ position: [0, 0, 0], radius: .5,
  suspensionLength: .3, suspensionForce: 0, steering: 0, rotation: 0, inContact: false,
  groundEntityId: null, contactPoint: null, hardPoint: [-20, 12.4, -12],
  worldCenter: [-20, 12.1, -12], worldAxle: [1, 0, 0], tractionSlip: 0, ...patch });
const contact = (patch: Partial<LakeWheelContact> = {}): LakeWheelContact => ({ id: "wheel", x: -20, y: 12.1, z: -12,
  radius: .5, rotation: 0, tractionSlip: 0, ...patch });

export async function registerLakeInteractionTests(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check("lake waves: bounded vertical motion pins shoreline, stays above bed, is world anchored and loops seamlessly", async () => {
    const settings = { ...LAKE_SURFACE_WAVE_DEFAULTS }, p = lakeWaveParameters(settings, 0, 0);
    for (const depth of [0, .001, .05, .5, 2]) for (let i = 0; i < 100; i++) {
      const h = lakeWaveOffset(i * .17, i * .33, depth, i * .13, p);
      assert.ok(Math.abs(h) <= Math.min(.02, depth * .25));
      assert.ok(depth + h >= 0);
      if (depth === 0) assert.equal(h, 0);
    }
    const anchor = lakeWaveParameters(settings, 1_000_000, -2_000_000);
    assert.ok(Math.abs(lakeWaveOffset(1_000_001.3, -1_999_997.9, 2, 1.1, p) - lakeWaveOffset(1.3, 2.1, 2, 1.1, anchor)) < 1e-10);
    assert.ok(Math.abs(lakeWaveOffset(2, 3, 2, 1.7, p) - lakeWaveOffset(2, 3, 2, 51.7, p)) < 1e-12);
    const off = lakeWaveParameters({ ...settings, surfaceWavesEnabled: false }, 0, 0);
    assert.equal(lakeWaveOffset(1, 2, 3, 4, off), 0);
  });
  await check("lake waves: shared save validation preserves controls and rejects invalid ranges", async () => {
    const { lake } = createLakeFixture();
    const appearance = { surfaceWavesEnabled: false, surfaceWaveHeight: .04, surfaceWaveLength: 16,
      surfaceWavePeriod: 6, surfaceWaveDirection: 75, surfaceWaveShoreDepth: .8 };
    const saved = validateLayout({ schema: 1, name: "waves", instances: [], characters: [], loadGroups: [], waterBodies: [{ ...lake, appearance }] }) as RoomLayout;
    assert.deepEqual(saved.waterBodies![0]!.appearance, appearance);
    for (const [key, min, max] of [["surfaceWaveHeight", 0, .1], ["surfaceWaveLength", 6, 40], ["surfaceWavePeriod", 2, 12],
      ["surfaceWaveDirection", 0, 360], ["surfaceWaveShoreDepth", .1, 2]] as const) {
      for (const value of [min - .01, max + .01, NaN, Infinity, "1"]) assert.throws(() => validateWaterBody({ ...lake, appearance: { [key]: value } }));
    }
    assert.throws(() => validateWaterBody({ ...lake, appearance: { surfaceWavesEnabled: 1 } }));
    assert.equal(resolveLakeAppearance(lake).surfaceWaveHeight, .02);
  });
  await check("lake waves: wheel cuts the displaced mesh instead of the mean plane; bounds and time cover the motion", async () => {
    const f = createLakeFixture(), data = await buildLakeGeometry(await prepareLakeSnapshot(f, f.lake, async key => f.tiles.get(key)!));
    const query = new LakeSurfaceQuery(data), p = lakeWaveParameters(LAKE_SURFACE_WAVE_DEFAULTS, data.position[0], data.position[2]);
    let crest = 0, trough = 0;
    for (let t = 0; t < 50; t += .1) {
      const h = query.offsetAt(-20, -12, t, p)!;
      if (h > .01) crest = t;
      if (h < -.01) trough = t;
    }
    assert.ok(crest > 0 && trough > 0);
    const tyre = wheel({ worldCenter: [-20, 12.505, -12] });
    assert.equal(lakeWheelContact("a", tyre, .35, 12, query), null);
    assert.ok(lakeWheelContact("a", tyre, .35, 12, query, { time: crest, parameters: p }));
    assert.equal(lakeWheelContact("a", tyre, .35, 12, query, { time: trough, parameters: p }), null);
    for (let k = 0; k < data.indices.length; k += Math.max(3, Math.floor(data.indices.length / 40 / 3) * 3)) {
      const ids = [data.indices[k]!, data.indices[k + 1]!, data.indices[k + 2]!];
      const x = ids.reduce((s, i) => s + data.positions[i * 3]!, 0) / 3;
      const z = ids.reduce((s, i) => s + data.positions[i * 3 + 2]!, 0) / 3;
      const expected = ids.reduce((s, i) => s + lakeWaveOffset(data.positions[i * 3]!, data.positions[i * 3 + 2]!, data.depths[i]!, 1.3, p), 0) / 3;
      assert.ok(Math.abs(query.offsetAt(x + data.position[0], z + data.position[2], 1.3, p)! - expected) < 1e-7);
    }
    const object = new LakeWaterObject(f.lake, data, null);
    assert.ok(object.geometry.boundingBox!.min.y <= -.02 && object.geometry.boundingBox!.max.y >= .02);
    object.setSurfaceWaveTime(2); assert.equal(object.material.uniforms.surfaceWaveTime!.value, 2);
    object.dispose();
  });
  await check("lake interaction: authored wave controls round-trip through save allowlist, validate ranges and resolve old defaults", async () => {
    const { lake } = createLakeFixture();
    assert.equal(resolveLakeAppearance(lake).wheelRippleStrength, 2);
    assert.equal(resolveLakeAppearance(lake).wheelRipplesEnabled, true);
    const appearance = { wheelRipplesEnabled: false, wheelRippleStrength: 3.2, wheelRippleSpeed: 2.4,
      wheelRippleWidth: .7, wheelRippleWavelength: .5, wheelRippleLifetime: 2.5, wheelRippleInterval: .2 };
    const saved = validateLayout({ schema: 1, name: "waves", instances: [], characters: [], loadGroups: [],
      waterBodies: [{ ...lake, appearance }] }) as RoomLayout;
    assert.deepEqual(saved.waterBodies![0]!.appearance, appearance);
    assert.deepEqual(validateWaterBody(JSON.parse(JSON.stringify(saved.waterBodies![0]))).appearance, appearance);
    for (const [key, min, max] of [["wheelRippleStrength", 0, 6], ["wheelRippleSpeed", .2, 5],
      ["wheelRippleWidth", .1, 2], ["wheelRippleWavelength", .1, 2], ["wheelRippleLifetime", .2, 4],
      ["wheelRippleInterval", .04, 1]] as const) {
      for (const value of [min - .01, max + .01, NaN, Infinity, "1"]) {
        assert.throws(() => validateWaterBody({ ...lake, appearance: { [key]: value } }));
      }
      for (const value of [min, max]) assert.equal(validateWaterBody({ ...lake, appearance: { [key]: value } }).appearance![key], value);
    }
    assert.throws(() => validateWaterBody({ ...lake, appearance: { wheelRipplesEnabled: "true" } }));
    const u = createLakeRippleUniforms({ ...appearance, wheelRipplesEnabled: true });
    assert.deepEqual(u.wheelRippleParams.value.toArray(), [3.2, 2.4, .7, 2.5]);
    assert.equal(u.wheelRippleWavelength.value, .5);
    assert.equal(createLakeRippleUniforms(appearance).wheelRippleParams.value.x, 0);
  });
  await check("lake interaction: enable/zero strength clear emission; authored lifetime and interval govern bounded wave state", async () => {
    const count = (interval: number, lifetime: number) => {
      const s = new LakeRippleState({ ...LAKE_WHEEL_RIPPLE_DEFAULTS, wheelRippleInterval: interval, wheelRippleLifetime: lifetime });
      for (let i = 0; i < 61; i++) s.advance(1 / 60, [contact({ x: -20 + i / 60 })]);
      return s;
    };
    assert.ok(count(.08, 2).ripples.length > count(.4, 2).ripples.length);
    assert.ok(count(.08, .3).ripples.length < count(.08, 2).ripples.length);
    const s = count(.2, 2.5); s.advance(1.6, []); assert.ok(s.ripples.length > 0);
    s.advance(1, []); assert.equal(s.ripples.length, 0);
    for (const patch of [{ wheelRipplesEnabled: false }, { wheelRippleStrength: 0 }]) {
      const off = new LakeRippleState({ ...LAKE_WHEEL_RIPPLE_DEFAULTS, ...patch });
      off.advance(1 / 60, [contact()]); off.advance(1 / 60, [contact({ tractionSlip: 1 })]);
      assert.equal(off.ripples.length, 0);
    }
  });
  await check("lake interaction: live Rapier hanging wheels drive Lake waves through fixed-step subscription, including tilted world pose", async () => {
    const physics = new PhysicsSubsystem({ backend: "rapier" }); physics.setGravity([0, 0, 0]);
    physics.setEntities([{ id: "car", components: {
      Transform: { position: [-20, 12.7, -12], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [1.8, .6, 4.2], isStatic: false, isSensor: false, simulatePhysics: true },
    } }]);
    await physics.init(); assert.ok(physics.createVehicle("car", createReferenceCarDefinition()));
    const f = createLakeFixture();
    const controller = new LakeWaterController({ scene: new Scene(), editor: false, document: () => f,
      load: async (_, key) => f.tiles.get(key)!, normal: async () => null,
      vehicles: { vehicleIds: () => physics.vehicleEntityIds(), vehicleState: id => physics.vehicleState(id),
        vehicleDefinition: id => physics.vehicleDefinition(id), onPhysicsStep: fn => physics.onFixedStep(fn) } });
    const tick = (frames: number) => { for (let i = 0; i < frames; i++) physics.update({ deltaSeconds: 1 / 60, elapsedSeconds: i / 60, frame: i }); };
    try {
      await controller.rebuild([f.lake]); tick(3);
      assert.equal(controller.objects.get(f.lake.id)!.material.uniforms.wheelRippleCount!.value, 0);
      assert.ok(physics.vehicleState("car")!.wheels.every(w => !w.inContact));
      physics.restoreVehicle("car", { position: [-20, 12.7, -12], rotation: [0, 0, 0], scale: [1, 1, 1] },
        { linearVelocity: [0, 0, 2], angularVelocity: [0, 0, 0], handbrake: false, drivetrain: null });
      tick(30); assert.ok(controller.objects.get(f.lake.id)!.material.uniforms.wheelRippleCount!.value > 0);
      assert.ok(physics.vehicleState("car")!.wheels.every(w => !w.inContact));
      const rotation = [20, 30, 25] as [number, number, number];
      physics.resetVehicle("car", { position: [-20, 12.7, -12], rotation, scale: [1, 1, 1] });
      const q = new Quaternion().setFromEuler(new Euler(...rotation.map(d => d * Math.PI / 180) as [number, number, number]));
      for (const w of physics.vehicleState("car")!.wheels) {
        const expected = new Vector3(w.position[0], w.position[1] - w.suspensionLength - (w.sinkDepth ?? 0), w.position[2])
          .applyQuaternion(q).add(new Vector3(-20, 12.7, -12));
        assert.ok(expected.distanceTo(new Vector3(...w.worldCenter!)) < 1e-5);
        const axle = new Vector3(Math.cos(w.steering), 0, -Math.sin(w.steering)).applyQuaternion(q);
        assert.ok(axle.distanceTo(new Vector3(...w.worldAxle!)) < 1e-5);
      }
      physics.resetVehicle("car", { position: [-20, 10, -12], rotation: [0, 0, 0], scale: [1, 1, 1] });
      await controller.rebuild([f.lake]); tick(3);
      assert.equal(controller.objects.get(f.lake.id)!.material.uniforms.wheelRippleCount!.value, 0);
    } finally { controller.dispose(); physics.dispose(); }
  });
  await check("lake interaction: exact clipped wet mesh excludes islands, separate basin, dry partial faces and supports large origins", async () => {
    for (const origin of [[-64, 10, -64], [1_000_000, 10, -2_000_000]] as [number, number, number][]) {
      const f = createLakeFixture(origin), dx = origin[0] + 64, dz = origin[2] + 64;
      const data = await buildLakeGeometry(await prepareLakeSnapshot(f, f.lake, async key => f.tiles.get(key)!));
      const q = new LakeSurfaceQuery(data);
      assert.equal(q.depthAt(-20 + dx, -12 + dz), 2);
      assert.equal(q.depthAt(dx, dz), null);
      assert.equal(q.depthAt(30 + dx, dz), null);
      assert.equal(q.depthAt(-20 + dx, -40 + dz), null);
      assert.ok(q.depthAt(-31.9 + dx, -12 + dz)! > 0);
      assert.equal(q.depthAt(-32.1 + dx, -12 + dz), null);
      assert.ok(q.depthAt(dx, -12 + dz)! > 0, "tile seam remains wet");
      const partial = await buildLakeGeometry(await prepareLakeSnapshot(f, { ...f.lake, surfaceLevel: 12.13 }, async key => f.tiles.get(key)!));
      const partialQuery = new LakeSurfaceQuery(partial);
      assert.ok(partialQuery.depthAt(-32.2 + dx, -12 + dz)! > 0);
      assert.equal(partialQuery.depthAt(-32.4 + dx, -12 + dz), null, "dry part of the very same source cell is excluded");
    }
  });
  await check("lake interaction: surface cuts hanging tyres without terrain contact; rejects air, submerged, rock, dry and malformed wheels", async () => {
    const f = createLakeFixture(), data = await buildLakeGeometry(await prepareLakeSnapshot(f, f.lake, async key => f.tiles.get(key)!));
    const q = new LakeSurfaceQuery(data);
    assert.ok(lakeWheelContact("a", wheel(), .35, 12, q));
    for (const w of [wheel({ worldCenter: [-20, 13, -12] }), wheel({ worldCenter: [-20, 11, -12] }),
      wheel({ inContact: true, contactPoint: [-20, 12.2, -12], groundEntityId: "rock", worldCenter: [-20, 12.7, -12] }),
      wheel({ worldCenter: [0, 12.1, 0] }), wheel({ worldCenter: [30, 12.1, 0] }),
      wheel({ worldCenter: [NaN, 12.1, -12] }), wheel({ radius: -1 })]) assert.equal(lakeWheelContact("a", w, .35, 12, q), null);
    assert.equal(lakeWheelContact("a", wheel({ worldAxle: [0, 1, 0], worldCenter: [-20, 12.2, -12] }), .2, 12, q), null,
      "rolled tyre uses its width as the vertical extent");
  });
  await check("lake interaction: fixed-step movement, turning and slip emit; stationary/reset/teleport/reentry do not; waves decay and stay bounded", async () => {
    const run = (hz: number) => {
      const s = new LakeRippleState();
      for (let i = 0; i < hz; i++) s.advance(1 / hz, [contact({ x: -20 + i * 2 / hz })]);
      return s;
    };
    for (const hz of [30, 60, 144]) {
      const s = run(hz); assert.ok(s.ripples.length >= 7 && s.ripples.length <= 9);
      assert.ok(s.ripples.every(r => Math.abs(r.strength - 1 / 3) < 1e-8));
    }
    const s = new LakeRippleState(); s.advance(1 / 60, [contact()]);
    s.advance(1 / 60, [contact({ rotation: 900 })]); assert.equal(s.ripples.length, 0);
    s.advance(1 / 60, [contact({ tractionSlip: .8 })]); assert.ok(s.ripples[0]!.strength > .4);
    s.clear(); s.advance(1 / 60, [contact()]); s.advance(1 / 60, [contact({ z: -11.95 })]);
    assert.ok(s.ripples.length > 0, "turning path supplies motion independent of chassis forward speed");
    s.clear(); s.advance(1 / 60, [contact()]); s.advance(1 / 60, [contact({ x: 100 })]); assert.equal(s.ripples.length, 0);
    s.advance(1 / 60, []); s.advance(1 / 60, [contact()]); assert.equal(s.ripples.length, 0);
    for (let i = 0; i < 120; i++) s.advance(1 / 60, Array.from({ length: 200 }, (_, n) => contact({ id: String(n), x: -20 + i / 60 })));
    assert.equal(s.ripples.length, LAKE_MAX_RIPPLES);
    s.advance(LAKE_RIPPLE_LIFETIME, []); assert.equal(s.ripples.length, 0);
  });
  await check("lake interaction: controller physics subscription drives independent lakes, visibility/rebuild/travel clear history and release listeners", async () => {
    const f = createLakeFixture(), scene = new Scene(); let w = wheel(), listener: ((dt: number) => void) | null = null;
    let subscribed = 0, released = 0;
    const controller = new LakeWaterController({ scene, editor: false, document: () => f, load: async (_, key) => f.tiles.get(key)!, normal: async () => null,
      vehicles: { vehicleIds: () => ["car"], vehicleState: () => ({ forwardSpeed: 0, engineLoad: 0, wheels: [w], drivetrain: null }),
        vehicleDefinition: () => null, onPhysicsStep: fn => { listener = fn; subscribed++; return () => { listener = null; released++; }; } } });
    await controller.rebuild([f.lake, { ...f.lake, id: "lower-lake", surfaceLevel: 11 }]); assert.equal(subscribed, 1);
    const tick = () => { assert.ok(listener); (listener as (dt: number) => void)(1 / 60); };
    tick(); w = wheel({ tractionSlip: .8 }); tick();
    const object = controller.objects.get(f.lake.id)!;
    assert.equal(object.material.uniforms.wheelRippleCount!.value, 1);
    assert.equal(controller.objects.get("lower-lake")!.material.uniforms.wheelRippleCount!.value, 0, "different planes do not share ripple state");
    object.visible = false; tick(); assert.equal(object.material.uniforms.wheelRippleCount!.value, 0);
    object.visible = true; tick(); assert.equal(object.material.uniforms.wheelRippleCount!.value, 0);
    await controller.rebuild([f.lake]); assert.equal(subscribed, 1);
    assert.equal(controller.objects.get(f.lake.id)!.material.uniforms.wheelRippleCount!.value, 0);
    controller.dispose(); assert.equal(released, 1); assert.equal(scene.children.filter(n => n.userData.waterBodyId).length, 0);
    await controller.rebuild([f.lake]); assert.equal(subscribed, 2); tick(); controller.dispose(); assert.equal(released, 2);
  });
}
