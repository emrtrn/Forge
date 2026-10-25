import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import {
  computeWheelSurfaceResponse, createPhysicalMaterialSurfaceProvider,
  NEUTRAL_SURFACE_SAMPLE, resolveSurfaceSample, type SurfaceSample, type VehicleSurfaceProvider,
} from "../../engine/physics/surface/surfaceResponse";
import {
  createReferenceCarDefinition, normalizeVehicleAsset, type VehicleInput,
} from "../../engine/physics/vehicle/vehicleTypes";
import { nominalWheelLoad, sinkage } from "../../engine/physics/surface/sinkage";
import { resistanceImpulse, wheelGroundResistance } from "../../engine/physics/surface/softGroundResistance";
import { wheelFootprintDepth } from "../../engine/physics/surface/wheelSink";
import { advanceWheelSpin, limitWheelEngineForce, longitudinalSlip } from "../../engine/physics/surface/wheelTraction";
import { wheelSurfaceFxLevels } from "../../engine/physics/surface/wheelSurfaceFx";
import { rutSlopeAhead, WheelTrackStamper } from "../../engine/physics/surface/wheelTracks";
import { PHYSICAL_MATERIALS } from "../../engine/scene/collision";
import { DeformationField } from "../../engine/scene/deformationField";
import type { SurfaceDeformationSample } from "../../engine/terrain/terrainSurface";
import { normalizeActorScriptDef } from "../../engine/scene/actorScript";
import { readColliderComponent } from "../../engine/scene/components";
import type { Entity } from "../../engine/scene/entity";
import type { RoomLayout } from "../../engine/scene/layout";
import { roomLayoutToSceneDocument } from "../../engine/scene/legacyRoomLayoutAdapter";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const close = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

export function registerSurfaceResponseTests(check: Check): void {
  check("soft ground launch: mud preserves a finite depth threshold while rolling builds with speed", () => {
    const mud = resolveSurfaceSample("mud");
    const resistance = (depth: number, speed: number) => wheelGroundResistance(mud, 6000, depth, 0.537, speed);
    const shallowRest = resistance(0.11, 0);
    const deepRest = resistance(0.22, 0);
    assert.ok(shallowRest > 0, "launch does not erase soil breakaway");
    close(deepRest, shallowRest * 4);
    assert.ok(resistance(0.11, 0.5) > shallowRest && resistance(0.11, 0.5) < resistance(0.11, 1));
    close(resistance(0.11, 1), resistance(0.11, 10));
    close(resistance(0.11, -0.5), resistance(0.11, 0.5));
    assert.ok(resistance(0.22, 10) - resistance(0.11, 10) > 200, "burial adds a material load well before belly contact");
    for (const speed of [0, 0.5, 1, 10]) {
      close(wheelGroundResistance(resolveSurfaceSample("snow"), 3000, 0.1, 0.5, speed), 207);
      close(wheelGroundResistance(resolveSurfaceSample("sand"), 3000, 0.1, 0.5, speed), 870);
    }
  });
  check("soft ground resistance: depth and load increase ploughing below belly contact, with finite breakaway", () => {
    for (const id of ["mud", "snow"]) {
      const sample = resolveSurfaceSample(id);
      const force = (depth: number, load = 3000) => wheelGroundResistance(sample, load, depth, 0.5, 10);
      assert.ok(force(0.1) > force(0));
      assert.ok(force(0.22) > force(0.1));
      close(force(0.1, 6000), force(0.1) * 2);
      assert.ok(wheelGroundResistance(sample, 3000, 0.1, 0.5, 0) > 0);
      assert.ok(wheelGroundResistance(sample, 3000, 0.1, 0.5, 0) <= force(0.1));
      close(wheelGroundResistance(sample, 3000, 0.1, 0.5, -10), force(0.1));
      assert.equal(force(0.1, 0), 0);
      assert.equal(wheelGroundResistance(NEUTRAL_SURFACE_SAMPLE, 3000, 0.2, 0.5, 10), 0);
    }
    const mixed = resolveSurfaceSample([{ physicalMaterialId: "mud", weight: 1 }, { physicalMaterialId: "stone", weight: 1 }]);
    close(mixed.softGround!.maxDepth, 0.22);
    close(mixed.deformability, 0.5);
    close(mixed.softGround!.ploughResistance, resolveSurfaceSample("mud").softGround!.ploughResistance);
  });
  check("soft ground resistance: impulse dissipates energy and cannot reverse relative contact motion", () => {
    for (const speed of [0, 1e-6, 0.1, 10]) for (const force of [0, 100, 1e8]) for (const dt of [1 / 120, 1 / 60]) {
      const inverseMass = 0.002;
      const impulse = resistanceImpulse(speed, force, dt, inverseMass);
      assert.ok(impulse >= 0 && impulse <= speed / inverseMass);
      assert.ok(speed - impulse * inverseMass >= -1e-12);
      assert.ok(-impulse * speed + 0.5 * impulse ** 2 * inverseMass <= 1e-12);
    }
    assert.equal(resistanceImpulse(10, 100, 1 / 60, 0), 0);
    assert.equal(resistanceImpulse(NaN, 100, 1 / 60, 1), 0);
  });
  check("wheel traction: longitudinal grip caps drive symmetrically and wheelspin slews and brakes", () => {
    close(limitWheelEngineForce(10000, 1000, 0.5, 1 / 60), 1000);
    close(limitWheelEngineForce(-10000, 1000, 0.5, 1 / 60), -1000);
    close(limitWheelEngineForce(500, 1000, 0.5, 1 / 60), 500);
    close(limitWheelEngineForce(10000, 0, 0.5, 1 / 60), 0);
    close(limitWheelEngineForce(10000, 1000, 2.5, 1 / 60, 0.35), 350);
    close(longitudinalSlip(10000, 1000, 0.35), 0.965);
    close(longitudinalSlip(0, 1000, 0.35), 0);
    close(longitudinalSlip(10000, 1000, undefined), 0);
    const spin = advanceWheelSpin(0, 10000, 0.8, false, 0.1);
    assert.ok(spin > 0 && spin < 12 * 0.8);
    close(advanceWheelSpin(0, -10000, 0.8, false, 0.1), -spin);
    assert.ok(advanceWheelSpin(spin, 0, 0, false, 0.1) < spin);
    assert.ok(advanceWheelSpin(spin, 10000, 0.8, true, 0.1) < spin * 0.1);
    const rates = [30, 60, 144].map((hz) => {
      let speed = 0;
      for (let frame = 0; frame < hz; frame++) speed = advanceWheelSpin(speed, 10000, 0.8, false, 1 / hz);
      return speed;
    });
    assert.ok(Math.max(...rates) - Math.min(...rates) < 1e-10);
  });
  check("surface response: missing blocks and unknown ids are neutral", () => {
    for (const id of [undefined, null, "missing", "__proto__", "default", "slippery", "rubber", "metal", "wood", "stone"]) {
      assert.deepEqual(resolveSurfaceSample(id), NEUTRAL_SURFACE_SAMPLE, String(id));
    }
    assert.deepEqual(resolveSurfaceSample("mud"), {
      frictionSlipScale: 0.55, tractionCoefficient: 0.35, sideFrictionScale: 0.7, rollingResistance: 0.12, deformability: 1,
      softGround: { maxDepth: 0.22, compaction: 0.5, digRate: 0.08, sinkResistance: 0.6, ploughResistance: 0.3,
        ploughExponent: 2, rollingResistanceAtRest: 0 },
    });
    for (const id of ["snow", "mud", "sand"]) {
      assert.ok(PHYSICAL_MATERIALS[id]!.deformation!.maxDepth > 0);
      assert.equal(resolveSurfaceSample(id).deformability, 1);
    }
  });

  check("surface response: blends normalised weights including neutral layers", () => {
    const sample = resolveSurfaceSample([
      { physicalMaterialId: "mud", weight: 2 },
      { physicalMaterialId: "stone", weight: 6 },
    ]);
    close(sample.frictionSlipScale, 0.55 * 0.25 + 0.75);
    close(sample.sideFrictionScale, 0.7 * 0.25 + 0.75);
    close(sample.rollingResistance, 0.12 * 0.25);
    close(sample.tractionCoefficient!, 0.35 * 0.25 + 0.75);
    close(sample.deformability, 0.25);
    assert.deepEqual(sample, resolveSurfaceSample([
      { physicalMaterialId: "mud", weight: 20 },
      { physicalMaterialId: "stone", weight: 60 },
    ]));
    assert.deepEqual(resolveSurfaceSample([
      { physicalMaterialId: "mud", weight: Number.MAX_VALUE },
      { physicalMaterialId: "stone", weight: Number.MAX_VALUE },
    ]), resolveSurfaceSample([
      { physicalMaterialId: "mud", weight: 1 }, { physicalMaterialId: "stone", weight: 1 },
    ]));
  });

  check("surface response: empty and invalid weights are neutral", () => {
    assert.deepEqual(resolveSurfaceSample([]), NEUTRAL_SURFACE_SAMPLE);
    const invalid = [0, -1, NaN, Infinity, -Infinity].map((weight) => ({ physicalMaterialId: "mud", weight }));
    assert.deepEqual(resolveSurfaceSample(invalid), NEUTRAL_SURFACE_SAMPLE);
    assert.deepEqual(resolveSurfaceSample([...invalid, { physicalMaterialId: "snow", weight: 3 }]), resolveSurfaceSample("snow"));
  });

  check("surface response: two material boundary is continuous with exact endpoints", () => {
    const mud = resolveSurfaceSample("mud");
    const snow = resolveSurfaceSample("snow");
    for (const weight of [0, 0.25, 0.499, 0.5, 0.501, 0.75, 1]) {
      const sample = resolveSurfaceSample([
        { physicalMaterialId: "mud", weight }, { physicalMaterialId: "snow", weight: 1 - weight },
      ]);
      for (const key of ["frictionSlipScale", "sideFrictionScale", "rollingResistance", "deformability"] as const) {
        close(sample[key], mud[key] * weight + snow[key] * (1 - weight));
      }
    }
  });

  check("surface response: wheel scales compose with drive stiffness and never accumulate", () => {
    const wheel = { frictionSlip: 2.5, sideFrictionStiffness: 0.2 };
    const mud = resolveSurfaceSample("mud");
    const response = computeWheelSurfaceResponse(wheel, mud, 10, 3000);
    close(response.frictionSlip, 1.375);
    close(response.sideFrictionStiffness, 0.14);
    close(response.rollingResistanceForce, 360);
    close(response.tractionCoefficient!, 0.35);
    assert.deepEqual(computeWheelSurfaceResponse(wheel, mud, 10, 3000), response);
    for (const sample of [null, NEUTRAL_SURFACE_SAMPLE]) {
      assert.deepEqual(computeWheelSurfaceResponse(wheel, sample, 10, 3000), { ...wheel, rollingResistanceForce: 0 });
    }
    assert.deepEqual(wheel, { frictionSlip: 2.5, sideFrictionStiffness: 0.2 });
  });

  check("surface response: rolling brake ramps with speed and load in either direction", () => {
    const wheel = { frictionSlip: 2.5, sideFrictionStiffness: 1 };
    const sample = resolveSurfaceSample("mud");
    const force = (speed: number, load: number) => computeWheelSurfaceResponse(wheel, sample, speed, load).rollingResistanceForce;
    assert.equal(force(0, 3000), 0);
    assert.equal(force(10, 0), 0);
    assert.equal(force(10, -1), 0);
    close(force(0.5, 3000), 180);
    assert.equal(force(-0.5, 3000), force(0.5, 3000));
    assert.equal(force(100, 3000), force(1, 3000));
    assert.equal(force(1, 6000), 2 * force(1, 3000));
  });

  check("surface response: default provider reads collider ids inherited from assets or placements", () => {
    const layout: RoomLayout = {
      schema: 1, name: "surface-fixture", loadGroups: [], characters: [], lights: [],
      instances: [{ assetId: "ground", placements: [
        { position: [0, 0, 0] }, { position: [10, 0, 0], physicalMaterialId: "snow" },
      ] }],
    };
    const doc = roomLayoutToSceneDocument(layout, { collisionDefs: new Map([
      ["ground", { primitives: [{ shape: "box", size: [10, 1, 10] }], complexity: "projectDefault", preset: "blockAll", physicalMaterialId: "mud" }],
    ]) });
    const materials = new Map(doc.entities.map((entity) => [entity.id, readColliderComponent(entity)?.physicalMaterialId]));
    const provider = createPhysicalMaterialSurfaceProvider((id) => materials.get(id));
    assert.equal(provider("car", 0, null, [0, 0, 0]), null);
    assert.deepEqual(provider("car", 0, "missing", [0, 0, 0]), NEUTRAL_SURFACE_SAMPLE);
    for (const [index, id] of ["mud", "snow"].entries()) {
      const ground = doc.entities[index]!;
      assert.equal(materials.get(ground.id), id);
      assert.deepEqual(provider("car", index, ground.id, [0, 0, 0]), resolveSurfaceSample(id));
    }
  });
}

interface VehicleSurfaceTestWorld {
  physics: PhysicsSubsystem;
  entities: Entity[];
  tick: (seconds: number) => void;
  /** The car chassis' synced world position. */
  position: () => [number, number, number];
  drive: (patch: Partial<VehicleInput>) => void;
}

/** Reuses the existing flat-ground reference-car scenario in tools/engine-tests.ts. */
export async function registerSurfaceResponseRapierTests(
  checkAsync: CheckAsync,
  createWorld: (options?: { slopeDeg?: number; groundSize?: number; fixedTimestep?: number }) => Promise<VehicleSurfaceTestWorld>,
): Promise<void> {
  await checkAsync("vehicle telemetry rapier: demand, delivered impulse and soil capacity remain separate", async () => {
    const world = await createWorld();
    const { physics } = world;
    try {
      physics.createVehicle("car", createReferenceCarDefinition());
      world.tick(2);
      physics.setVehicleSurfaceProvider(() => resolveSurfaceSample("mud"));
      world.drive({ throttle: 1 });
      world.tick(1);
      const state = physics.vehicleState("car")!;
      const t = state.telemetry!;
      assert.equal(t.input.throttle, 1);
      assert.equal(t.input.brake, 0);
      assert.ok(t.requestedDriveForce > t.appliedDriveForce + 100, "grip-limited engine demand cannot masquerade as delivered thrust");
      assert.ok(t.appliedDriveForce > 0);
      const capacity = state.wheels.reduce((sum, wheel) => sum + (wheel.groundResistanceForce ?? 0), 0);
      assert.ok(t.appliedGroundResistanceForce >= 0 && t.appliedGroundResistanceForce <= capacity + 1e-6);
      assert.notEqual(t.input, physics.vehicleState("car")!.telemetry!.input, "snapshot input does not alias the live record");
      world.drive({});
      world.tick(1 / 60);
      const coasting = physics.vehicleState("car")!.telemetry!;
      assert.equal(coasting.input.throttle, 0);
      assert.equal(coasting.requestedDriveForce, 0);
      assert.equal(coasting.appliedDriveForce, 0, "wheel brake impulses are not reported as engine thrust");
    } finally { physics.dispose(); }
  });
  const resistanceRun = async (options: {
    material?: string; depth?: number; speed?: number; slope?: number; pedal?: number;
    hz?: number; seconds?: number; axle?: "front" | "rear"; field?: boolean;
    sample?: SurfaceSample; lateral?: boolean; stock?: boolean; fixedTimestep?: number;
    parkSeconds?: number; ruts?: readonly number[]; coastBeforeParkSeconds?: number;
  } = {}) => {
    const world = await createWorld({ slopeDeg: options.slope ?? 0, groundSize: 2000, fixedTimestep: options.fixedTimestep });
    const { physics } = world;
    try {
      const definition = options.stock
        ? normalizeVehicleAsset(JSON.parse(readFileSync("public/assets/vehicles/gaz52/Gaz52.vehicle.json", "utf8")))!
        : createReferenceCarDefinition();
      if (options.stock) {
        const actor = normalizeActorScriptDef(JSON.parse(readFileSync("public/assets/vehicles/gaz52/Script_Gaz52.actor.json", "utf8")));
        const collider = actor.components.find((node) => node.component === "Collider")!.props;
        physics.setEntities([world.entities[0]!, { ...world.entities[1]!, components: { ...world.entities[1]!.components, Collider: collider } }]);
      }
      physics.createVehicle("car", definition);
      world.drive({ handbrake: true });
      world.tick(2);
      const pose = physics.simulatedTransform("car")!;
      const slope = (options.slope ?? 0) * Math.PI / 180;
      const speed = options.speed ?? 40 / 3.6;
      physics.restoreVehicle("car", pose, { linearVelocity: options.lateral ? [speed, 0, 0] : [0, speed * Math.sin(slope), speed * Math.cos(slope)],
        angularVelocity: [0, 0, 0], handbrake: false, drivetrain: null });
      const sample = options.sample ?? resolveSurfaceSample(options.material ?? "mud");
      physics.setVehicleSurfaceProvider((_id, index) => options.axle && definition.wheels[index]!.axle !== options.axle ? null : sample);
      if (options.depth !== undefined) physics.setVehicleGroundSinkProvider(() => ({ depth: options.depth!, resistance: 0 }));
      if (options.ruts) physics.setVehicleGroundSinkProvider(({ wheelIndex }) => ({ depth: options.ruts![wheelIndex] ?? 0, resistance: 0 }));
      const field = options.field ? new DeformationField() : null;
      if (field) {
        const stamper = new WheelTrackStamper(field);
        const profile = PHYSICAL_MATERIALS[options.material ?? "mud"]!.deformation!;
        physics.setVehicleGroundSinkProvider((query) => ({ depth: wheelFootprintDepth(
          (x, z) => field.sample(x, z).depth, query.contactPoint[0], query.contactPoint[2], query.heading, query.width), resistance: profile.sinkResistance }));
        physics.onFixedStep((dt) => {
          stamper.stampVehicle("car", physics.vehicleState("car")!, definition, () => ({ ...profile, deformability: 1 }), dt);
          field.recover(dt);
        });
      }
      if (options.coastBeforeParkSeconds) {
        world.drive({});
        world.tick(options.coastBeforeParkSeconds);
      }
      if (options.parkSeconds) {
        world.drive({ handbrake: true });
        world.tick(options.parkSeconds);
      }
      const start = physics.simulatedTransform("car")!.position;
      world.drive(options.pedal === -1 ? { brake: 1 } : { throttle: options.pedal ?? 0 });
      const hz = options.hz ?? 60;
      let stopDistance: number | null = null;
      for (let frame = 0; frame < hz * (options.seconds ?? 3); frame++) {
        physics.update({ deltaSeconds: 1 / hz, elapsedSeconds: frame / hz, frame });
        if (stopDistance === null && Math.abs(physics.vehicleState("car")!.forwardSpeed) < 0.05) {
          stopDistance = Math.hypot(world.position()[0] - pose.position[0], world.position()[2] - pose.position[2]);
        }
      }
      const state = physics.vehicleState("car")!;
      const motion = physics.vehicleMotion("car")!;
      return { speed: state.forwardSpeed, velocity: motion.linearVelocity, state, distance: Math.hypot(world.position()[0] - start[0], world.position()[2] - start[2]),
        progress: world.position()[2] - start[2],
        force: state.wheels.reduce((sum, wheel) => sum + (wheel.groundResistanceForce ?? 0), 0), fieldDepth: field?.stats().maxDepth ?? 0, stopDistance };
    } finally { physics.dispose(); }
  };

  await checkAsync("soft ground launch rapier: stock GAZ-52 restarts on a 5 degree mud incline including old rear ruts", async () => {
    for (const hz of [30, 60, 144]) for (const scenario of [
      { label: "fresh soil" },
      { label: "persistent tracks", field: true },
      { label: "old rear ruts", ruts: [0.12, 0.12, 0.22, 0.22] },
      { label: "entry, coast, stop, restart", field: true, speed: 20 / 3.6, coastBeforeParkSeconds: 4 },
    ]) {
      const run = await resistanceRun({ stock: true, material: "mud", slope: 5, speed: 0, pedal: 1,
        parkSeconds: 3, seconds: 8, hz, ...scenario });
      console.info(`[mud hill launch ${hz}Hz] ${scenario.label}: ${run.speed.toFixed(3)} m/s, progress ${run.progress.toFixed(3)} m, `
        + `drive ${run.state.telemetry!.appliedDriveForce.toFixed(0)} N, resistance ${run.force.toFixed(0)} N`);
      assert.ok(run.speed > 0.25 && run.progress > 1, "light uphill restart makes sustained forward progress");
      assert.ok(Math.max(...run.state.wheels.slice(2).map((wheel) => wheel.tractionSlip ?? 0)) > 0.15, "uphill launch retains wheelspin");
    }
  });

  await checkAsync("soft ground launch rapier: deeper mud still costs speed with throttle on and off", async () => {
    const preset = resolveSurfaceSample("mud");
    const sample = { ...preset, softGround: { ...preset.softGround!, maxDepth: 0, digRate: 0 } };
    // A flat-force reference car isolates burial from automatic-gear torque
    // cuts; stock-truck hill starts are exercised separately above.
    for (const pedal of [0, 1]) {
      const shallow = await resistanceRun({ depth: 0.08, sample, speed: 40 / 3.6, pedal });
      const deep = await resistanceRun({ depth: 0.22, sample, speed: 40 / 3.6, pedal });
      assert.ok(Math.abs(deep.speed) < Math.abs(shallow.speed) - 0.5, `pedal ${pedal}: deep ${deep.speed}, shallow ${shallow.speed}`);
      console.info(`[mud depth ${pedal ? "powered" : "coasting"}] shallow ${(shallow.speed * 3.6).toFixed(2)}, deep ${(deep.speed * 3.6).toFixed(2)} km/h`);
    }
  });

  await checkAsync("soft ground resistance rapier: deeper wheels slow both powered and coasting motion, including reverse", async () => {
    const preset = resolveSurfaceSample("snow");
    // Prescribed ruts isolate burial from fresh compaction/digging and belly drag.
    const sample = { ...preset, rollingResistance: 0, softGround: { ...preset.softGround!, maxDepth: 0, digRate: 0, ploughResistance: 0.4 } };
    for (const pedal of [0, 1, -1]) {
      const speed = (pedal === -1 ? -1 : 1) * 40 / 3.6;
      const shallow = await resistanceRun({ depth: 0.05, sample, speed, pedal });
      const deep = await resistanceRun({ depth: 0.22, sample, speed, pedal });
      assert.ok(Math.abs(deep.speed) < Math.abs(shallow.speed) - 0.4, `pedal ${pedal}: ${deep.speed} vs ${shallow.speed}`);
      assert.ok(deep.force > shallow.force);
      assert.ok(Math.sign(deep.speed) === Math.sign(speed), "resistance never reverses travel");
    }
  });
  await checkAsync("soft ground resistance rapier: finite slope hold releases above the soil threshold", async () => {
    const held = await resistanceRun({ slope: -1, speed: 0, seconds: 5 });
    const released = await resistanceRun({ slope: -15, speed: 0, seconds: 5 });
    console.info(`[soil slope] 1deg ${held.speed.toFixed(4)} m/s, ${held.distance.toFixed(3)} m; 15deg ${released.speed.toFixed(3)} m/s`);
    assert.ok(Math.abs(held.speed) < 0.02, "soil holds below its force threshold");
    assert.ok(held.distance < 0.15, "holding does not continuously creep");
    assert.ok(released.speed > 1, "gravity above the threshold breaks free");
  });
  await checkAsync("soft ground resistance rapier: fresh soil works without textures and fixed-step tracks agree at 30/60/144 Hz", async () => {
    for (const material of ["mud", "snow"]) {
      const runs = [];
      for (const hz of [30, 60, 144]) {
        const bare = await resistanceRun({ material, hz, pedal: 1, speed: 0 });
        const tracked = await resistanceRun({ material, hz, pedal: 1, speed: 0, field: true });
        assert.ok(bare.state.wheels.every((wheel) => wheel.sinkDepth! > 0.02), "fresh soil presses with no visual field");
        assert.ok(tracked.fieldDepth > 0.02 && tracked.force > 0);
        runs.push(tracked.speed);
        assert.ok(Math.abs(bare.speed - tracked.speed) < 0.5, "field is persistence, not the source of fresh-soil resistance");
      }
      assert.ok(Math.max(...runs) - Math.min(...runs) < 1e-7, `${material}: ${runs}`);
    }
  });
  await checkAsync("soft ground resistance rapier: one soft axle and lateral sliding use contact-local tangents", async () => {
    const neutral = await resistanceRun({ material: "stone" });
    const front = await resistanceRun({ axle: "front" });
    const all = await resistanceRun();
    assert.ok(all.speed < front.speed && front.speed < neutral.speed);
    assert.ok(front.state.wheels.slice(2).every((wheel) => wheel.groundResistanceForce === 0));
    // Suppress lateral tyre grip to isolate the new soil contact impulse.
    const mud = resolveSurfaceSample("mud");
    const lateral = await resistanceRun({ lateral: true, sample: { ...mud, sideFrictionScale: 0 } });
    const free = await resistanceRun({ lateral: true, sample: { ...NEUTRAL_SURFACE_SAMPLE, sideFrictionScale: 0 } });
    assert.ok(Math.abs(lateral.velocity[0]) < Math.abs(free.velocity[0]) - 1);
  });
  await checkAsync("soft ground resistance rapier: 60/120 Hz physics retains the same force balance", async () => {
    for (const material of ["mud", "snow"]) {
      const runs = [];
      for (const fixedTimestep of [1 / 60, 1 / 120]) runs.push(await resistanceRun({ material, fixedTimestep, field: true }));
      console.info(`[soil fixed step] ${material}: ${runs.map((run) => run.speed.toFixed(3)).join(" / ")} m/s`);
      assert.ok(Math.abs(runs[0]!.speed - runs[1]!.speed) < 0.3, "time-step drift stays below 0.3 m/s after 3 seconds");
    }
  });
  await checkAsync("soft ground resistance rapier: stock GAZ-52 entry matrix covers speed, slope, throttle and reverse", async () => {
    let scenarios = 0;
    for (const slope of [0, 5, 10, 15]) for (const kmh of [20, 40, 60]) {
      const coast: string[] = [];
      for (const direction of [1, -1]) for (const pedal of [0, direction]) {
        let neutralSpeed = 0;
        for (const material of ["stone", "mud", "snow"]) {
          const run = await resistanceRun({ stock: true, material, speed: direction * kmh / 3.6, slope: -direction * slope, pedal });
          scenarios++;
          assert.ok(Number.isFinite(run.speed) && Math.abs(run.speed) < kmh / 3.6 + 10);
          assert.ok(run.state.wheels.every((wheel) => wheel.sinkDepth! >= 0 && wheel.sinkDepth! <= 0.3));
          if (material === "stone") neutralSpeed = Math.abs(run.speed);
          else if (slope === 0 && pedal === 0) assert.ok(Math.abs(run.speed) < neutralSpeed, `${material} must slow flat-ground coasting`);
          if (direction === 1 && pedal === 0) {
            coast.push(`${material} ${(run.speed * 3.6).toFixed(2)}km/h ${run.distance.toFixed(1)}m sink${Math.max(...run.state.wheels.map((wheel) => wheel.sinkDepth!)).toFixed(3)}m R${run.force.toFixed(0)}N stop${run.stopDistance?.toFixed(1) ?? "-"}m`);
          }
        }
      }
      console.info(`[soil entry ${kmh}km/h ${slope}deg downhill 3s] ${coast.join("; ")}`);
    }
    assert.equal(scenarios, 144);
  });

  await checkAsync("wheel traction rapier: stock GAZ-52 spins its rear wheels on real mud and snow presets at 30/60/144 Hz", async () => {
    const asset = normalizeVehicleAsset(JSON.parse(readFileSync("public/assets/vehicles/gaz52/Gaz52.vehicle.json", "utf8")))!;
    const actor = normalizeActorScriptDef(JSON.parse(readFileSync("public/assets/vehicles/gaz52/Script_Gaz52.actor.json", "utf8")));
    const collider = actor.components.find((node) => node.component === "Collider")!.props;
    for (const material of ["mud", "snow"]) {
      const results: number[] = [];
      for (const hz of [30, 60, 144]) {
        const world = await createWorld();
        const { physics } = world;
        try {
          const car = world.entities[1]!;
          physics.setEntities([world.entities[0]!, { ...car, components: { ...car.components, Collider: collider } }]);
          physics.createVehicle("car", asset);
          physics.setVehicleSurfaceProvider(() => resolveSurfaceSample(material));
          world.tick(2);
          world.drive({ throttle: 1 });
          for (let frame = 0; frame < hz * 3; frame++) physics.update({ deltaSeconds: 1 / hz, elapsedSeconds: 2 + frame / hz, frame });
          const previous = physics.vehicleState("car")!;
          world.tick(1 / 60);
          const state = physics.vehicleState("car")!;
          const slip = Math.min(...state.wheels.slice(2).map((wheel) => wheel.tractionSlip!));
          const excess = Math.min(...state.wheels.slice(2).map((wheel, index) =>
            (wheel.rotation - previous.wheels[index + 2]!.rotation) * wheel.radius * 60 - state.forwardSpeed));
          console.info(`[stock GAZ-52] ${material} ${hz} Hz: ${(state.forwardSpeed * 3.6).toFixed(2)} km/h, slip ${slip.toFixed(2)}, excess ${excess.toFixed(2)} m/s`);
          assert.ok(state.forwardSpeed > 0.3, "the stock truck can still drive through the surface");
          assert.ok(slip > 0.15 && excess > 1, "real stock torque visibly spins both rear tyres");
          assert.ok(state.wheels.slice(0, 2).every((wheel) => wheel.tractionSlip === 0), "free front wheels do not spin");
          assert.ok(wheelSurfaceFxLevels({ inContact: true, wheelSpeed: state.forwardSpeed, groundSpeed: state.forwardSpeed,
            chassisSpeed: state.forwardSpeed, tractionSlip: slip }).emissionRate > 0.1);
          results.push(state.forwardSpeed);
        } finally { physics.dispose(); }
      }
      assert.ok(Math.max(...results) - Math.min(...results) < 0.1, `${material}: frame-rate drift ${results}`);
    }
  });
  await checkAsync("wheel traction rapier: mud and snow limit straight-line thrust and spin only driven wheels, forward and reverse", async () => {
    const run = async (material: string | null, reverse: boolean) => {
      const world = await createWorld();
      const { physics } = world;
      try {
        // Enough torque to exceed both soft profiles. No rolling drag, so a
        // speed difference proves the new grip cap, not the old brake path.
        const definition = { ...createReferenceCarDefinition(), maxEngineForce: 60000, maxReverseForce: 60000 };
        if (material) physics.setVehicleSurfaceProvider(() => ({ ...resolveSurfaceSample(material), rollingResistance: 0 }));
        physics.createVehicle("car", definition);
        world.tick(1);
        world.drive(reverse ? { brake: 1 } : { throttle: 1 });
        world.tick(0.5);
        const before = physics.vehicleState("car")!;
        world.tick(1 / 60);
        const state = physics.vehicleState("car")!;
        const excess = state.wheels.map((wheel, index) => {
          const speed = (wheel.rotation - before.wheels[index]!.rotation) * wheel.radius * 60;
          return Math.abs(speed) - Math.abs(state.forwardSpeed);
        });
        if (material) {
          for (const [index, wheel] of state.wheels.entries()) {
            if (definition.wheels[index]!.drive) {
              assert.ok(wheel.tractionSlip! > 0.05, `${material} reverse=${reverse}: slip ${wheel.tractionSlip}`);
              assert.ok(excess[index]! > 0.2, `${material}: driven tyre has excess rolling speed ${excess[index]}`);
              assert.equal(Math.sign(wheel.rotation - before.wheels[index]!.rotation), reverse ? -1 : 1);
            } else {
              assert.equal(wheel.tractionSlip, 0);
              assert.ok(Math.abs(excess[index]!) < 0.6, `free tyre rolls with chassis: ${excess[index]}`);
            }
          }
        }
        return Math.abs(state.forwardSpeed);
      } finally { physics.dispose(); }
    };
    for (const reverse of [false, true]) {
      const firm = await run(null, reverse);
      for (const material of ["mud", "snow"]) {
        const soft = await run(material, reverse);
        assert.ok(soft > 0 && soft < firm * 0.8, `${material} reverse=${reverse}: soft ${soft}, firm ${firm}`);
      }
    }
  });

  await checkAsync("wheel traction rapier: stuck wheels splash while digging; brake, grip recovery and respawn clear spin", async () => {
    const world = await createWorld();
    const { physics } = world;
    try {
      physics.setEntities([...world.entities, {
        id: "wall", components: {
          Transform: { position: [0, 1, 2.6], rotation: [0, 0, 0], scale: [1, 1, 1] },
          Collider: { shape: "box", size: [4, 2, 0.5], isStatic: true, isSensor: false },
        },
      }]);
      const definition = createReferenceCarDefinition();
      physics.createVehicle("car", definition);
      physics.setVehicleSurfaceProvider(() => ({ ...resolveSurfaceSample("mud"), frictionSlipScale: 0.1 }));
      world.tick(1);
      world.drive({ throttle: 1 });
      world.tick(3);
      const before = physics.vehicleState("car")!;
      world.tick(1 / 60);
      const spinning = physics.vehicleState("car")!;
      assert.ok(Math.abs(spinning.forwardSpeed) < 0.05);
      for (const [index, wheel] of spinning.wheels.entries()) {
        if (!definition.wheels[index]!.drive) continue;
        assert.ok((wheel.rotation - before.wheels[index]!.rotation) * wheel.radius * 60 > 1);
        assert.ok(wheelSurfaceFxLevels({ inContact: wheel.inContact, wheelSpeed: 0, groundSpeed: 0,
          chassisSpeed: spinning.forwardSpeed, tractionSlip: wheel.tractionSlip }).emissionRate > 0.05);
      }
      world.drive({ handbrake: true });
      world.tick(1);
      const braking = physics.vehicleState("car")!;
      world.tick(1 / 60);
      const braked = physics.vehicleState("car")!;
      for (const [index, wheel] of braked.wheels.entries()) {
        assert.equal(wheel.tractionSlip, 0);
        assert.ok(Math.abs(wheel.rotation - braking.wheels[index]!.rotation) < 0.02);
      }
      // Returning to firm ground releases extra RPM without snapping the angle.
      world.drive({ throttle: 1 });
      world.tick(0.5);
      physics.setVehicleSurfaceProvider(null);
      world.drive({});
      world.tick(1);
      const recovered = physics.vehicleState("car")!;
      world.tick(1 / 60);
      assert.ok(physics.vehicleState("car")!.wheels.every((wheel, index) =>
        Math.abs(wheel.rotation - recovered.wheels[index]!.rotation) < 0.02));
      physics.resetVehicle("car", { position: [0, 1, -20], rotation: [0, 0, 0], scale: [1, 1, 1] });
      assert.ok(physics.vehicleState("car")!.wheels.every((wheel) => wheel.tractionSlip === 0));
      world.tick(1);
      const reset = physics.vehicleState("car")!;
      world.tick(1 / 60);
      assert.ok(physics.vehicleState("car")!.wheels.every((wheel, index) =>
        Math.abs(wheel.rotation - reset.wheels[index]!.rotation) < 0.02));
    } finally { physics.dispose(); }
  });

  await checkAsync("surface response rapier: GAZ-52 accelerates on mud without gear hunting at 30/60/144 Hz", async () => {
    const asset = normalizeVehicleAsset(JSON.parse(readFileSync("public/assets/vehicles/gaz52/Gaz52.vehicle.json", "utf8")))!;
    const actor = normalizeActorScriptDef(JSON.parse(readFileSync("public/assets/vehicles/gaz52/Script_Gaz52.actor.json", "utf8")));
    const collider = actor.components.find((node) => node.component === "Collider")!.props;
    const finalSpeeds: number[] = [];
    for (const hz of [30, 60, 144]) {
      const world = await createWorld();
      const { physics } = world;
      try {
        const car = world.entities[1]!;
        physics.setEntities([world.entities[0]!, { ...car, components: { ...car.components, Collider: collider } }]);
        physics.createVehicle("car", asset);
        physics.setVehicleSurfaceProvider(() => resolveSurfaceSample("mud"));
        world.tick(2);
        world.drive({ throttle: 1 });
        let minSpeed = Infinity;
        let downshifts = 0;
        let lastGear = 1;
        for (let frame = 1; frame <= hz * 20; frame += 1) {
          physics.update({ deltaSeconds: 1 / hz, elapsedSeconds: 2 + frame / hz, frame });
          const state = physics.vehicleState("car")!;
          if (state.drivetrain!.gear < lastGear) downshifts += 1;
          lastGear = state.drivetrain!.gear;
          if (frame >= hz * 3) {
            minSpeed = Math.min(minSpeed, state.forwardSpeed);
          }
        }
        assert.ok(minSpeed > 0.3, `${hz} Hz: mud failed to make progress: ${minSpeed * 3.6} km/h`);
        // Lower drag permits normal acceleration and several upshifts; reject
        // up/down hunting directly rather than assuming a fixed speed plateau.
        assert.ok(downshifts <= 1, `${hz} Hz: repeated downshifts under steady flat-ground throttle: ${downshifts}`);
        finalSpeeds.push(physics.vehicleState("car")!.forwardSpeed);
        // Leaving the soft surface must release the hold and permit ordinary acceleration.
        physics.setVehicleSurfaceProvider(() => resolveSurfaceSample("wood"));
        world.tick(5);
        const neutral = physics.vehicleState("car")!;
        assert.ok(neutral.drivetrain!.gear >= 2, "neutral ground permits upshifts again");
        assert.ok(neutral.forwardSpeed > 25 / 3.6, `neutral reached only ${neutral.forwardSpeed * 3.6} km/h`);
      } finally {
        physics.dispose();
      }
    }
    assert.ok(Math.max(...finalSpeeds) - Math.min(...finalSpeeds) < 0.1, `frame-rate drift: ${finalSpeeds}`);
    console.info(`[vehicle] GAZ-52 steady mud speed at 30/60/144 Hz: ${finalSpeeds.map((speed) => (speed * 3.6).toFixed(2)).join(" / ")} km/h`);
  });

  const curve = async (provider: "mesh" | VehicleSurfaceProvider | null, materialId?: string): Promise<number[]> => {
    const world = await createWorld();
    const { physics } = world;
    try {
      if (materialId) {
        world.entities[0]!.components.Collider!.physicalMaterialId = materialId;
        physics.setEntities(world.entities);
      }
      if (provider !== null) physics.setVehicleSurfaceProvider(provider === "mesh"
        ? createPhysicalMaterialSurfaceProvider((id) => physics.colliderPhysicalMaterialId(id)) : provider);
      physics.createVehicle("car", createReferenceCarDefinition());
      world.tick(1);
      world.drive({ throttle: 1 });
      const speeds: number[] = [];
      for (let index = 0; index < 6; index += 1) {
        world.tick(0.5);
        speeds.push(physics.vehicleState("car")!.forwardSpeed);
      }
      return speeds;
    } finally {
      physics.dispose();
    }
  };

  await checkAsync("surface response rapier: no provider and neutral providers preserve the legacy speed curve exactly", async () => {
    // Captured before the surface-response change, using this same scenario.
    const legacy = [2.423356630827677, 4.706326462197407, 6.856473538317414, 8.88154189164081, 10.788810524948119, 12.585117386888854];
    assert.deepEqual(await curve(null), legacy);
    assert.deepEqual(await curve(() => null), legacy);
    for (const id of [undefined, "default", "slippery", "rubber", "metal", "wood", "stone"]) {
      assert.deepEqual(await curve("mesh", id), legacy, String(id));
    }
    assert.deepEqual(await curve(null, "mud"), legacy, "an authored soft surface also needs a provider");
  });

  await checkAsync("surface response rapier: mud mesh provider reduces acceleration under identical throttle", async () => {
    const neutral = await curve("mesh");
    const mud = await curve("mesh", "mud");
    assert.ok(mud[1]! > 0 && mud[1]! < neutral[1]! * 0.8, `1 s: mud=${mud[1]}, neutral=${neutral[1]}`);
    assert.ok(mud[5]! < neutral[5]! * 0.8, `3 s: mud=${mud[5]}, neutral=${neutral[5]}`);
  });

  await checkAsync("surface response rapier: clearing a mud provider or returning null restores neutral wheel response", async () => {
    const curves: number[][] = [];
    for (const provider of [null, () => null, () => NEUTRAL_SURFACE_SAMPLE]) {
      const world = await createWorld();
      const { physics } = world;
      try {
        physics.setVehicleSurfaceProvider(() => resolveSurfaceSample("mud"));
        physics.createVehicle("car", createReferenceCarDefinition());
        world.tick(1);
        world.drive({ throttle: 1 });
        world.tick(3);
        physics.setVehicleSurfaceProvider(provider);
        const speeds: number[] = [];
        for (const handbrake of [false, true, false]) {
          world.drive({ throttle: 1, steer: 0.4, handbrake });
          world.tick(0.5);
          speeds.push(physics.vehicleState("car")!.forwardSpeed);
        }
        curves.push(speeds);
      } finally {
        physics.dispose();
      }
    }
    assert.deepEqual(curves[0], curves[2]);
    assert.deepEqual(curves[1], curves[2]);
  });

  await checkAsync("surface response rapier: groundEntityId and provider contacts follow the collider owner", async () => {
    const world = await createWorld();
    const { physics } = world;
    try {
      let calls = 0;
      const seen = new Set<number>();
      physics.setVehicleSurfaceProvider((vehicle, wheel, ground, point) => {
        assert.equal(vehicle, "car");
        assert.equal(ground, "ground");
        assert.ok(Math.abs(point[1]) < 1e-5, `contact y=${point[1]}`);
        seen.add(wheel);
        calls += 1;
        return null;
      });
      physics.createVehicle("car", createReferenceCarDefinition());
      world.tick(1);
      assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
      assert.ok(physics.vehicleState("car")!.wheels.every((wheel) => wheel.inContact && wheel.groundEntityId === "ground"));
      const before = calls;
      physics.setVehicleSurfaceProvider(null);
      world.tick(0.5);
      assert.equal(calls, before, "clearing the provider stops callbacks");
      physics.setEntities(world.entities);
      world.tick(1);
      assert.ok(physics.vehicleState("car")!.wheels.every((wheel) => wheel.groundEntityId === "ground"), "mapping survives world rebuild");
      physics.resetVehicle("car", { position: [0, 100, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
      world.tick(0.5);
      assert.ok(physics.vehicleState("car")!.wheels.every((wheel) => !wheel.inContact && wheel.groundEntityId === null));
      physics.setVehicleSurfaceProvider(() => assert.fail("airborne wheel queried the surface provider"));
      world.tick(0.5);
    } finally {
      physics.dispose();
    }
  });

  await checkAsync("wheel sink rapier: a constant track lowers the chassis by its depth at the slew rate and climbs back out", async () => {
    const world = await createWorld();
    const { physics } = world;
    try {
      physics.createVehicle("car", createReferenceCarDefinition());
      world.tick(2);
      const base = world.position()[1];
      physics.setVehicleGroundSinkProvider(() => ({ depth: 0.12, resistance: 0.5 }));
      world.tick(0.1);
      assert.ok(base - world.position()[1] <= 0.3 * 0.1 + 0.005, `dropped ${base - world.position()[1]} m in 0.1 s`);
      world.tick(2.9);
      const sunk = physics.vehicleState("car")!;
      for (const wheel of sunk.wheels) {
        assert.ok(wheel.inContact, "every wheel keeps its contact while sinking");
        assert.ok(Math.abs(wheel.sinkDepth! - 0.12) < 1e-9, `sink ${wheel.sinkDepth}`);
      }
      assert.ok(Math.abs(base - world.position()[1] - 0.12) < 0.01, `chassis dropped ${base - world.position()[1]} m`);
      const heights: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        world.tick(0.05);
        heights.push(world.position()[1]);
      }
      assert.ok(Math.max(...heights) - Math.min(...heights) < 0.002, "a settled sunk chassis does not bounce");
      physics.setVehicleGroundSinkProvider(null);
      world.tick(2);
      assert.ok(physics.vehicleState("car")!.wheels.every((wheel) => wheel.sinkDepth === 0), "no provider restores the authored rest");
      assert.ok(Math.abs(world.position()[1] - base) < 0.01, `back at ${world.position()[1]}, started at ${base}`);
    } finally {
      physics.dispose();
    }
  });

  await checkAsync("wheel sink rapier: the chassis bottom caps the sink and deeper mud drags on the belly", async () => {
    const run = async (depth: number): Promise<{ speed: number; sink: number }> => {
      const world = await createWorld();
      const { physics } = world;
      try {
        physics.createVehicle("car", createReferenceCarDefinition());
        physics.setVehicleGroundSinkProvider(() => ({ depth, resistance: 0.5 }));
        world.tick(3);
        world.drive({ throttle: 1 });
        world.tick(3);
        const state = physics.vehicleState("car")!;
        return { speed: state.forwardSpeed, sink: Math.max(...state.wheels.map((wheel) => wheel.sinkDepth ?? 0)) };
      } finally {
        physics.dispose();
      }
    };
    // Reference car: rest 0.35 m, so the rest-length floor (0.05 m) caps the sink at 0.30 m.
    const atLimit = await run(0.3);
    const beyond = await run(0.5);
    assert.ok(Math.abs(atLimit.sink - 0.3) < 1e-9 && Math.abs(beyond.sink - 0.3) < 1e-9, `sinks ${atLimit.sink} / ${beyond.sink}`);
    assert.ok(atLimit.speed > 3, `a full-depth rut alone still drives: ${atLimit.speed} m/s`);
    assert.ok(beyond.speed < atLimit.speed * 0.5, `belly drag: ${beyond.speed} vs ${atLimit.speed} m/s`);
  });

  await checkAsync("wheel sink rapier: traction slip reports engine impulse the tyres could not transfer", async () => {
    const world = await createWorld();
    const { physics } = world;
    try {
      physics.createVehicle("car", createReferenceCarDefinition());
      world.tick(1);
      const driven = (): number => Math.max(...physics.vehicleState("car")!.wheels.map((wheel) => wheel.tractionSlip ?? 0));
      assert.equal(driven(), 0, "a parked car does not slip");
      physics.setVehicleSurfaceProvider(() => ({ ...NEUTRAL_SURFACE_SAMPLE, frictionSlipScale: 0.05 }));
      world.drive({ throttle: 1 });
      world.tick(0.5);
      assert.ok(driven() > 0.3, `ice-like grip spins the driven wheels: ${driven()}`);
      physics.setVehicleSurfaceProvider(null);
      world.drive({});
      world.tick(0.5);
      assert.equal(driven(), 0, "coasting transfers no engine impulse to lose");
    } finally {
      physics.dispose();
    }
  });

  const MUD = PHYSICAL_MATERIALS.mud!.deformation!;
  const mud: SurfaceDeformationSample = {
    deformability: 1, maxDepth: MUD.maxDepth, compaction: MUD.compaction, digRate: MUD.digRate,
    recoveryRate: MUD.recoveryRate, sinkResistance: MUD.sinkResistance,
  };
  /**
   * The terrain deformation module's loop without its services: physics reads
   * the field, the stamper writes it. Creates the car; `frame` steps 1/60 s.
   */
  const rutLoop = (
    world: VehicleSurfaceTestWorld,
    grip: SurfaceSample = resolveSurfaceSample("mud"),
    options: { rutSteering?: boolean; field?: DeformationField } = {},
  ) => {
    const { physics } = world;
    const field = options.field ?? new DeformationField();
    const stamper = new WheelTrackStamper(field);
    const definition = createReferenceCarDefinition();
    // Isolate soil behaviour from the spawn drop's transient landing load.
    physics.createVehicle("car", definition);
    world.tick(2);
    physics.setVehicleSurfaceProvider(() => grip);
    // Mirrors the terrain deformation module's provider.
    physics.setVehicleGroundSinkProvider((query) => {
      const depthAt = (x: number, z: number) => field.sample(x, z).depth;
      const [x, , z] = query.contactPoint;
      const depth = wheelFootprintDepth(depthAt, x, z, query.heading, query.width);
      if (depth <= 0) return null;
      if (options.rutSteering === false) return { depth, resistance: mud.sinkResistance };
      const slope = rutSlopeAhead(depthAt, x, z, query.heading, query.width, query.radius ?? 0, depth, query.travel ?? 0);
      return { depth, resistance: mud.sinkResistance, slope };
    });
    const frame = (): void => {
      world.tick(1 / 60);
      stamper.stampVehicle("car", physics.vehicleState("car")!, definition, () => mud, 1 / 60);
    };
    return { definition, frame, field };
  };

  await checkAsync("wheel sink rapier: a car on mud settles into its own ruts and drives out of them without shaking", async () => {
    const world = await createWorld();
    const { physics } = world;
    try {
      const { definition, frame } = rutLoop(world);
      // Settle on the collider first: the spawn drop's landing load would press a deeper rut.
      world.tick(2);
      const nominal = nominalWheelLoad(definition);
      const expected = physics.vehicleState("car")!.wheels.map((wheel) =>
        sinkage(mud, 1, { load: wheel.suspensionForce, nominalLoad: nominal, width: 0 }));
      for (let index = 0; index < 60 * 5; index += 1) frame();
      const parked = physics.vehicleState("car")!;
      parked.wheels.forEach((wheel, index) => {
        assert.ok(wheel.inContact, "parked wheels keep their contact");
        // The tyre rests on its footprint's mean: across a 0.245 m tyre on a 0.125 m grid the
        // side samples catch the rut's bilinear edge, so it sits a little above the rut's centre.
        assert.ok(wheel.sinkDepth! <= expected[index]! + 0.015 && wheel.sinkDepth! > expected[index]! * 0.9,
          `parked sink ${wheel.sinkDepth}, sinkage ${expected[index]}`);
      });
      const heights: number[] = [];
      for (let index = 0; index < 60; index += 1) {
        frame();
        heights.push(world.position()[1]);
      }
      assert.ok(Math.max(...heights) - Math.min(...heights) < 0.003, "the settled loop does not pump the suspension");
      world.drive({ throttle: 1 });
      let contactLosses = 0;
      let maxVerticalSpeed = 0;
      let previousY = world.position()[1];
      for (let index = 0; index < 60 * 4; index += 1) {
        frame();
        const state = physics.vehicleState("car")!;
        contactLosses += state.wheels.filter((wheel) => !wheel.inContact).length;
        const y = world.position()[1];
        maxVerticalSpeed = Math.max(maxVerticalSpeed, Math.abs(y - previousY) * 60);
        previousY = y;
      }
      const driving = physics.vehicleState("car")!;
      assert.ok(driving.forwardSpeed > 0.3, `makes progress against soil resistance: ${driving.forwardSpeed} m/s`);
      assert.equal(contactLosses, 0, "leaving the ruts never lifts a wheel off the ground");
      // Climbing out at <= 0.3 m/s per wheel keeps the chassis' vertical motion near that rate.
      assert.ok(maxVerticalSpeed < 0.4, `vertical speed peaked at ${maxVerticalSpeed} m/s`);
      console.info(`[deform] parked sink ${parked.wheels.map((wheel) => wheel.sinkDepth!.toFixed(3)).join("/")} m, `
        + `driving sink ${driving.wheels.map((wheel) => wheel.sinkDepth!.toFixed(3)).join("/")} m at ${driving.forwardSpeed.toFixed(1)} m/s`);
    } finally {
      physics.dispose();
    }
  });
  await checkAsync("wheel sink rapier: driven wheels spinning on low-grip mud dig themselves in", async () => {
    const world = await createWorld();
    const { physics } = world;
    try {
      // A stronger soil preset stalls the body through real wheel resistance,
      // while the driven tyres keep spinning and digging without a blocking wall.
      const preset = resolveSurfaceSample("mud");
      const { definition, frame } = rutLoop(world, { ...preset, frictionSlipScale: 0.1,
        softGround: { ...preset.softGround!, ploughResistance: 1, ploughExponent: 1, rollingResistanceAtRest: 1 } });
      world.tick(2);
      for (let index = 0; index < 60 * 2; index += 1) frame();
      const sink = (driven: boolean): number => {
        const wheels = physics.vehicleState("car")!.wheels.filter((_, index) => definition.wheels[index]!.drive === driven);
        return Math.min(...wheels.map((wheel) => wheel.sinkDepth ?? 0));
      };
      const parked = sink(true);
      world.drive({ throttle: 1 });
      const timeline: number[] = [];
      let minSlip = Infinity;
      for (let index = 1; index <= 60 * 3; index += 1) {
        frame();
        const wheels = physics.vehicleState("car")!.wheels;
        assert.ok(wheels.every((wheel) => wheel.inContact), "digging in never lifts a wheel");
        minSlip = Math.min(minSlip, ...wheels.filter((_, wheel) => definition.wheels[wheel]!.drive).map((wheel) => wheel.tractionSlip ?? 0));
        if (index % 30 === 0) timeline.push(sink(true));
      }
      const state = physics.vehicleState("car")!;
      assert.ok(Math.abs(state.forwardSpeed) < 0.05, `held by high soil resistance: ${state.forwardSpeed} m/s`);
      assert.ok(minSlip > 0.2, `the driven wheels spin the whole time: ${minSlip}`);
      // Sinking at up to digRate × slip, then held by the soft layer / chassis clearance.
      for (let index = 1; index < 4; index += 1) {
        assert.ok(timeline[index]! > timeline[index - 1]! + 0.005, `keeps digging: ${timeline.map((depth) => depth.toFixed(3))}`);
      }
      assert.ok(sink(true) > parked + 0.05, `dug in: ${parked} → ${sink(true)} m`);
      assert.ok(sink(true) > sink(false) + 0.03, `the driven axle sinks deeper: ${sink(true)} vs ${sink(false)} m`);
      assert.ok(sink(true) <= MUD.maxDepth, `never past the soft layer: ${sink(true)} m`);
      console.info(`[deform] dig-in: parked ${parked.toFixed(3)} m → driven ${sink(true).toFixed(3)} m, `
        + `free ${sink(false).toFixed(3)} m, slip ≥ ${minSlip.toFixed(2)}`);
    } finally {
      physics.dispose();
    }
  });
  await checkAsync("wheel sink rapier: on deep mud a steady-throttle car stays clearly below its firm-ground speed", async () => {
    const run = async (mudLoop: boolean): Promise<{ speed: number; sink: number }> => {
      const world = await createWorld();
      const { physics } = world;
      try {
        let frame = (): void => world.tick(1 / 60);
        if (mudLoop) frame = rutLoop(world).frame;
        else physics.createVehicle("car", createReferenceCarDefinition());
        world.tick(2);
        world.drive({ throttle: 1 });
        for (let index = 0; index < 60 * 4; index += 1) frame();
        const state = physics.vehicleState("car")!;
        return { speed: state.forwardSpeed, sink: Math.max(...state.wheels.map((wheel) => wheel.sinkDepth ?? 0)) };
      } finally {
        physics.dispose();
      }
    };
    const firm = await run(false);
    const mud = await run(true);
    assert.equal(firm.sink, 0);
    assert.ok(mud.sink > 0.03, `the car drives in its own ruts: ${mud.sink} m`);
    assert.ok(mud.speed > 0.3 && mud.speed < firm.speed * 0.8, `4 s of full throttle: mud ${mud.speed} vs firm ${firm.speed} m/s`);
    console.info(`[deform] steady throttle 4 s: firm ${firm.speed.toFixed(2)} m/s, mud ${mud.speed.toFixed(2)} m/s (sink ${mud.sink.toFixed(3)} m)`);
  });
  /** Two straight 0.3 m wide, 0.1 m deep ruts along +Z under the reference car's wheels, for 60 m. */
  const pressedRuts = (): DeformationField => {
    const field = new DeformationField();
    const halfTrack = Math.abs(createReferenceCarDefinition().wheels[0]!.position[0]);
    for (const x of [-halfTrack, halfTrack]) {
      field.stampWheel({ from: [x, -10], to: [x, 30], width: 0.3, contactLength: 0.3, targetDepth: 0.1, compaction: 1, disturbance: 255 });
    }
    return field;
  };

  await checkAsync("wheel sink rapier: rut walls pull an offset car back into its ruts; steering still climbs out", async () => {
    const run = async (rutSteering: boolean, steer: number) => {
      const world = await createWorld();
      const { physics } = world;
      try {
        const { frame } = rutLoop(world, resolveSurfaceSample("mud"), { rutSteering, field: pressedRuts() });
        // 10 cm off the ruts' centre lines: each tyre's outer side sits on the rut wall.
        physics.resetVehicle("car", { position: [0.1, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
        for (let index = 0; index < 60; index += 1) frame();
        world.drive({ throttle: 0.4, steer });
        let contactLosses = 0;
        let maxOffset = 0;
        for (let index = 0; index < 60 * (steer === 0 ? 4 : 8); index += 1) {
          frame();
          contactLosses += physics.vehicleState("car")!.wheels.filter((wheel) => !wheel.inContact).length;
          maxOffset = Math.max(maxOffset, Math.abs(world.position()[0]));
        }
        return { x: world.position()[0], z: world.position()[2], contactLosses, maxOffset };
      } finally {
        physics.dispose();
      }
    };
    const free = await run(false, 0);
    const pulled = await run(true, 0);
    // Load-limited drive can create a small left/right force imbalance at the
    // rut edges; the control must remain within 1.5 cm of its starting offset.
    assert.ok(Math.abs(free.x - 0.1) < 0.015, `without rut steering the offset stays: ${free.x}`);
    // Pulled in until the tyre rests on the rut's flat bottom (0.30 m rut, 0.245 m tyre), never across it.
    // The side samples sit 0.086 m off the tyre's centre and blur over one 0.125 m cell: from ~0.06–0.07 m in, both read the flat bottom.
    assert.ok(pulled.x < 0.08 && pulled.x < free.x - 0.02 && pulled.x > -0.02, `rut steering re-centres: ${pulled.x} vs ${free.x}`);
    assert.ok(pulled.maxOffset <= 0.11, `no swing past the start: ${pulled.maxOffset}`);
    assert.ok(pulled.z > 1, `still driving: ${pulled.z} m`);
    const exit = await run(true, 0.25);
    // Own fresh ruts never push: driving straight onto untouched mud, the car tracks the same line with and without.
    const fresh = async (rutSteering: boolean) => {
      const world = await createWorld();
      const { physics } = world;
      try {
        const { frame } = rutLoop(world, resolveSurfaceSample("mud"), { rutSteering });
        for (let index = 0; index < 60; index += 1) frame();
        world.drive({ throttle: 0.6 });
        for (let index = 0; index < 60 * 4; index += 1) frame();
        return world.position()[0];
      } finally {
        physics.dispose();
      }
    };
    const own = [await fresh(false), await fresh(true)];
    assert.ok(Math.abs(own[0]! - own[1]!) < 0.005, `own ruts stay neutral: x ${own[0]} vs ${own[1]}`);
    assert.ok(exit.x < -0.4, `steering climbs out of the ruts: x ${exit.x}`);
    assert.equal(pulled.contactLosses + exit.contactLosses, 0, "rut walls never lift a wheel");
    console.info(`[deform] rut steering: offset 0.10 → ${pulled.x.toFixed(3)} m (free ${free.x.toFixed(3)}), steered out to ${exit.x.toFixed(2)} m`);
  });
}
