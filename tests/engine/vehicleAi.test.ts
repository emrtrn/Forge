/**
 * Vehicle plan Faz 4, AI slice: a `VehicleAiDriver` car drives itself along a
 * Generic Spline.
 *
 *   (A) data — the component reader, and the level-owned `patrolRoute` that
 *       names this placement's spline on a reusable AI car class;
 *   (B) the `vehicle-ai` capability against a recording vehicle host — pedals
 *       and pure-pursuit steering reach physics, a missing spline waits, the
 *       player outranks the AI and keeps the car once they have driven it.
 *
 * The driving itself (laps a circle in its lane, stops at the end of an open
 * route) is proven against real Rapier in `tools/engine-tests.ts`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Group } from "three";
import type { EngineUpdateContext, Subsystem } from "../../engine/core/Subsystem";
import { createReferenceCarDefinition, type VehicleInput } from "../../engine/physics/vehicle/vehicleTypes";
import { actorInstanceToEntity } from "../../engine/scene/actorInstance";
import { normalizeActorScriptDef } from "../../engine/scene/actorScript";
import { readVehicleAiDriverComponent, VEHICLE_AI_DRIVER_COMPONENT } from "../../engine/scene/components";
import type { Entity } from "../../engine/scene/entity";
import type { LayoutActorInstance, LayoutSplineActor } from "../../engine/scene/layout";
import { createSplineRegistry } from "../../engine/scene/splineRegistry";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createRuntimeServiceHost } from "../../src/scene/capabilities/RuntimeServices";
import {
  splineRegistrySourceService,
  vehicleAiService,
  vehicleHostService,
} from "../../src/scene/capabilities/runtimeServiceKeys";
import { createVehicleAiModule } from "../../src/scene/capabilities/vehicleAiModule";

type Check = (label: string, fn: () => void) => void;

const AI_CAR = "public/assets/starter-content/Gameplay/Script_AiReferenceCar.actor.json";
const TRACK = "public/assets/starter-content/Levels/VehicleTrack.level.json";

/** A straight, open 40 m lane from the origin along +Z. */
const LANE: LayoutSplineActor = {
  id: "lane",
  position: [0, 0, 0],
  spline: {
    schema: 1,
    closed: false,
    points: [
      { id: "a", position: [0, 0, 0], pointType: "linear" },
      { id: "b", position: [0, 0, 40], pointType: "linear" },
    ],
  },
} as unknown as LayoutSplineActor;

function driverEntity(id: string, props: Record<string, unknown>): Entity {
  return { id, components: { [VEHICLE_AI_DRIVER_COMPONENT]: props } } as unknown as Entity;
}

/** The vehicle-ai module on a host with one car the test moves by hand. */
function startedModule(entities: readonly Entity[]) {
  const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
  const registry = createCapabilityRegistry([createVehicleAiModule()]);
  registry.runtimeStart(host);
  const subsystems: Subsystem[] = [];
  host.installSubsystems((subsystem) => subsystems.push(subsystem));
  const car = new Group();
  const inputs: { id: string; input: VehicleInput }[] = [];
  let possessed: string | null = null;
  let speed = 0;
  const splines = createSplineRegistry([LANE]);
  host.provide(splineRegistrySourceService, () => splines);
  host.provide(vehicleHostService, {
    vehicleIds: () => entities.map((entity) => entity.id),
    vehicleState: () => ({ forwardSpeed: speed, engineLoad: 0, wheels: [], drivetrain: null }),
    vehicleDefinition: () => createReferenceCarDefinition(),
    actorObject: () => car,
    isDriven: () => false,
    possessedEntityId: () => possessed,
    setVehicleInput: (id, input) => inputs.push({ id, input }),
  });
  for (const sink of host.entitySinks()) sink.setEntities(entities);
  const tick = () => {
    car.updateMatrixWorld(true);
    for (const subsystem of subsystems) subsystem.update?.({ deltaSeconds: 1 / 60 } as EngineUpdateContext);
  };
  return {
    registry,
    car,
    inputs,
    tick,
    ai: () => host.resolve(vehicleAiService)!,
    setPossessed: (id: string | null) => {
      possessed = id;
    },
    setSpeed: (value: number) => {
      speed = value;
    },
    subsystems,
  };
}

export function registerVehicleAiTests(check: Check): void {
  // (A) data.
  check("vehicle AI driver component reads tolerant props and needs a spline to drive", () => {
    assert.equal(readVehicleAiDriverComponent(driverEntity("car", {})), undefined);
    assert.equal(readVehicleAiDriverComponent(driverEntity("car", { splineId: "  " })), undefined);
    assert.deepEqual(readVehicleAiDriverComponent(driverEntity("car", { splineId: " lane " })), {
      splineId: "lane", entry: "nearest", targetSpeed: 12, lookAheadDistance: 5, enabled: true,
    });
    assert.deepEqual(
      readVehicleAiDriverComponent(driverEntity("car", {
        splineId: "lane", entry: "start", wrapMode: "clamp", targetSpeed: 999, lookAheadDistance: 0, enabled: false,
      })),
      { splineId: "lane", entry: "start", wrapMode: "clamp", targetSpeed: 100, lookAheadDistance: 1, enabled: false },
    );
  });

  check("a placement's spline patrol route steers the AI car class it places", () => {
    const def = normalizeActorScriptDef(JSON.parse(readFileSync(AI_CAR, "utf8")));
    const bare = actorInstanceToEntity(def, { classRef: AI_CAR, position: [0, 1, 0] }, 0);
    assert.equal(readVehicleAiDriverComponent(bare), undefined, "the reusable class names no level spline");
    const placed: LayoutActorInstance = {
      classRef: AI_CAR,
      position: [0, 1, 0],
      patrolRoute: { source: "spline", splineId: "loop", entry: "start", lookAheadDistance: 1.2, wrapMode: "pingPong", speed: 9 },
    };
    assert.deepEqual(readVehicleAiDriverComponent(actorInstanceToEntity(def, placed, 0)), {
      splineId: "loop", entry: "start", targetSpeed: 9, lookAheadDistance: 5, enabled: true,
    }, "ping-pong is a character patrol mode; a car keeps its default wrap");

    // The committed demo: the track's AI car follows a spline the level owns.
    const level = JSON.parse(readFileSync(TRACK, "utf8")) as {
      actors: LayoutActorInstance[];
      splines: { id: string; spline: { closed: boolean } }[];
    };
    const aiCar = level.actors.find((actor) => actor.classRef.endsWith("Script_AiReferenceCar.actor.json"))!;
    const driver = readVehicleAiDriverComponent(actorInstanceToEntity(def, aiCar, 1))!;
    const spline = level.splines.find((entry) => entry.id === driver.splineId);
    assert.equal(spline?.spline.closed, true, "a closed loop the car laps forever");
  });

  // (B) the capability.
  check("vehicle AI module drives along its spline with pure-pursuit steering and cruise pedals", () => {
    const world = startedModule([driverEntity("car", { splineId: "lane", targetSpeed: 10 })]);
    world.tick();
    const straight = world.inputs.at(-1) ?? assert.fail("no input");
    assert.equal(straight.id, "car");
    assert.ok(straight.input.throttle > 0.5, `throttle ${straight.input.throttle}`);
    assert.ok(Math.abs(straight.input.steer) < 1e-6);
    assert.equal(world.ai().isDriving("car"), true);
    assert.equal(world.ai().drivers()[0]?.driving, true);

    // 3 m to the lane's left (+X): steer right (+) back onto it.
    world.car.position.set(3, 0, 5);
    world.tick();
    assert.ok((world.inputs.at(-1)?.input.steer ?? 0) > 0.1, `steer ${world.inputs.at(-1)?.input.steer}`);

    // Over the speed limit: off the throttle, onto the brake.
    world.car.position.set(0, 0, 5);
    world.setSpeed(20);
    world.tick();
    const braking = world.inputs.at(-1)!.input;
    assert.equal(braking.throttle, 0);
    assert.ok(braking.brake > 0);
    world.registry.dispose();
  });

  check("vehicle AI module waits for a missing spline and lets the player keep a car they took over", () => {
    const world = startedModule([
      driverEntity("car", { splineId: "lane" }),
      driverEntity("lost", { splineId: "nowhere" }),
      driverEntity("off", { splineId: "lane", enabled: false }),
    ]);
    world.tick();
    assert.deepEqual([...new Set(world.inputs.map((entry) => entry.id))], ["car"], "only the car with a route drives");
    const lost = world.ai().drivers().find((driver) => driver.entityId === "lost")!;
    assert.equal(lost.missingRoute, true);
    assert.equal(lost.driving, false);

    world.setPossessed("car");
    const before = world.inputs.length;
    world.tick();
    assert.equal(world.inputs.length, before, "the player's pedals, not the AI's");
    assert.equal(world.ai().isDriving("car"), false);
    world.setPossessed(null);
    world.tick();
    assert.equal(world.inputs.length, before, "once driven by the player, the car is theirs");
    assert.equal(world.ai().drivers().find((driver) => driver.entityId === "car")?.released, true);

    world.registry.levelUnloaded();
    assert.deepEqual(world.ai().drivers(), []);
    world.registry.dispose();
  });
}
