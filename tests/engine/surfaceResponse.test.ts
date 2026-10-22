import assert from "node:assert/strict";
import type { PhysicsSubsystem } from "../../engine/physics/physicsSubsystem";
import {
  computeWheelSurfaceResponse, createPhysicalMaterialSurfaceProvider,
  NEUTRAL_SURFACE_SAMPLE, resolveSurfaceSample, type VehicleSurfaceProvider,
} from "../../engine/physics/surface/surfaceResponse";
import {
  createReferenceCarDefinition, type VehicleInput,
} from "../../engine/physics/vehicle/vehicleTypes";
import { PHYSICAL_MATERIALS } from "../../engine/scene/collision";
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
  drive: (patch: Partial<VehicleInput>) => void;
}

/** Reuses the existing flat-ground reference-car scenario in tools/engine-tests.ts. */
export async function registerSurfaceResponseRapierTests(
  checkAsync: CheckAsync,
  createWorld: () => Promise<VehicleSurfaceTestWorld>,
): Promise<void> {
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
}
