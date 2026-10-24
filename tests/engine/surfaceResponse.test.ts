import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import {
  computeWheelSurfaceResponse, createPhysicalMaterialSurfaceProvider,
  NEUTRAL_SURFACE_SAMPLE, resolveSurfaceSample, type VehicleSurfaceProvider,
} from "../../engine/physics/surface/surfaceResponse";
import {
  createReferenceCarDefinition, normalizeVehicleAsset, type VehicleInput,
} from "../../engine/physics/vehicle/vehicleTypes";
import { nominalWheelLoad, sinkage } from "../../engine/physics/surface/sinkage";
import { wheelFootprintDepth } from "../../engine/physics/surface/wheelSink";
import { WheelTrackStamper } from "../../engine/physics/surface/wheelTracks";
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
  check("surface response: missing blocks and unknown ids are neutral", () => {
    for (const id of [undefined, null, "missing", "__proto__", "default", "slippery", "rubber", "metal", "wood", "stone"]) {
      assert.deepEqual(resolveSurfaceSample(id), NEUTRAL_SURFACE_SAMPLE, String(id));
    }
    assert.deepEqual(resolveSurfaceSample("mud"), {
      frictionSlipScale: 0.55, sideFrictionScale: 0.7, rollingResistance: 0.35, deformability: 1,
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
    close(sample.rollingResistance, 0.35 * 0.25);
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
    close(response.rollingResistanceForce, 1050);
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
    close(force(0.5, 3000), 525);
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
  createWorld: () => Promise<VehicleSurfaceTestWorld>,
): Promise<void> {
  await checkAsync("surface response rapier: GAZ-52 holds steady throttle on mud without gear hunting at 30/60/144 Hz", async () => {
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
        let maxSpeed = 0;
        let shifts = 0;
        let lastGear = 1;
        for (let frame = 1; frame <= hz * 20; frame += 1) {
          physics.update({ deltaSeconds: 1 / hz, elapsedSeconds: 2 + frame / hz, frame });
          const state = physics.vehicleState("car")!;
          if (state.drivetrain!.gear !== lastGear) shifts += 1;
          lastGear = state.drivetrain!.gear;
          if (frame >= hz * 3) {
            minSpeed = Math.min(minSpeed, state.forwardSpeed);
            maxSpeed = Math.max(maxSpeed, state.forwardSpeed);
          }
        }
        assert.ok(minSpeed > 8 / 3.6, `${hz} Hz: mud slowed to ${minSpeed * 3.6} km/h`);
        assert.ok(maxSpeed - minSpeed < 2 / 3.6, `${hz} Hz: steady speed oscillated by ${(maxSpeed - minSpeed) * 3.6} km/h`);
        assert.ok(shifts <= 1, `${hz} Hz: ${shifts} gear changes on constant mud`);
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

  await checkAsync("wheel sink rapier: a car on mud settles into its own ruts and drives out of them without shaking", async () => {
    const world = await createWorld();
    const { physics } = world;
    const MUD = PHYSICAL_MATERIALS.mud!.deformation!;
    const mud: SurfaceDeformationSample = {
      deformability: 1, maxDepth: MUD.maxDepth, compaction: MUD.compaction, digRate: MUD.digRate,
      recoveryRate: MUD.recoveryRate, sinkResistance: MUD.sinkResistance,
    };
    // The terrain deformation module's loop without its services: physics reads the field, the stamper writes it.
    const field = new DeformationField();
    const stamper = new WheelTrackStamper(field);
    const definition = createReferenceCarDefinition();
    try {
      physics.setVehicleSurfaceProvider(() => resolveSurfaceSample("mud"));
      physics.setVehicleGroundSinkProvider((query) => {
        const depth = wheelFootprintDepth((x, z) => field.sample(x, z).depth,
          query.contactPoint[0], query.contactPoint[2], query.heading, query.width);
        return depth > 0 ? { depth, resistance: mud.sinkResistance } : null;
      });
      physics.createVehicle("car", definition);
      const frame = (): void => {
        world.tick(1 / 60);
        stamper.stampVehicle("car", physics.vehicleState("car")!, definition, () => mud, 1 / 60);
      };
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
        assert.ok(wheel.sinkDepth! <= expected[index]! + 0.005 && wheel.sinkDepth! > expected[index]! * 0.75,
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
      assert.ok(driving.forwardSpeed > 2, `climbed out of its ruts: ${driving.forwardSpeed} m/s`);
      assert.equal(contactLosses, 0, "leaving the ruts never lifts a wheel off the ground");
      // Climbing out at <= 0.3 m/s per wheel keeps the chassis' vertical motion near that rate.
      assert.ok(maxVerticalSpeed < 0.4, `vertical speed peaked at ${maxVerticalSpeed} m/s`);
      console.info(`[deform] parked sink ${parked.wheels.map((wheel) => wheel.sinkDepth!.toFixed(3)).join("/")} m, `
        + `driving sink ${driving.wheels.map((wheel) => wheel.sinkDepth!.toFixed(3)).join("/")} m at ${driving.forwardSpeed.toFixed(1)} m/s`);
    } finally {
      physics.dispose();
    }
  });
}
