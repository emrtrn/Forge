/**
 * Vehicle plan Faz 1b: the runtime half of a drivable car.
 *
 * The physics half (suspension, drive, brake, rebuilds) is pinned against a
 * live Rapier world in `tools/engine-tests.ts`. These checks cover what sits on
 * top of it, headless:
 *
 *   (A) the `forge.vehicle` Game Mode's pure helpers — pedals from actions,
 *       planar heading, chase framing, speed FOV;
 *   (B) the session, through an ordinary {@link GameModeContext} whose
 *       `vehicles` bridge is a recording fake — possession, input forwarding,
 *       UI-mode neutral input, the chase camera, the upright reset;
 *   (C) the `vehicle` capability module hanging wheel visuals on the actor
 *       object from the host's live wheel readback.
 */
import assert from "node:assert/strict";
import { Group, PerspectiveCamera, Vector3, type Object3D } from "three";

import { ActionMap } from "../../engine/input/actionMap";
import { DEFAULT_INPUT_BINDINGS } from "../../engine/input/defaultInputBindings";
import type { TransformComponent } from "../../engine/scene/components";
import {
  NEUTRAL_VEHICLE_INPUT,
  type VehicleInput,
  type VehicleState,
} from "../../engine/physics/vehicle/vehicleTypes";
import { GAME_MODE_OPTIONS, VEHICLE_GAME_MODE_ID } from "../../src/game/gameModes/catalog";
import { resolveGameMode } from "../../src/game/gameModes/registry";
import {
  blendHeading,
  chaseCameraPosition,
  DEFAULT_VEHICLE_CHASE_CAMERA,
  planarHeadingFromQuaternion,
  speedFieldOfView,
  vehicleInputFromActions,
  yawDegreesFromHeading,
} from "../../src/game/gameModes/vehicleCameraControl";
import { vehicleGameMode } from "../../src/game/gameModes/vehicleGameMode";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createRuntimeServiceHost } from "../../src/scene/capabilities/RuntimeServices";
import { vehicleHostService } from "../../src/scene/capabilities/runtimeServiceKeys";
import { createVehicleModule } from "../../src/scene/capabilities/vehicleModule";
import type { GameModeContext, GameModeVehicles, InputMode } from "../../src/scene/gameModeTypes";

type Check = (label: string, fn: () => void) => void;

function wheelState(position: [number, number, number], suspensionLength: number) {
  return {
    position,
    radius: 0.35,
    suspensionLength,
    steering: 0,
    rotation: 0,
    inContact: true,
    contactPoint: null,
    hardPoint: null,
  };
}

/** A vehicles bridge with one car whose render object the test moves by hand. */
class FakeVehicles implements GameModeVehicles {
  readonly object = new Group();
  readonly inputs: VehicleInput[] = [];
  readonly resets: TransformComponent[] = [];
  speed = 0;
  available = true;

  ids(): readonly string[] {
    return this.available ? ["car"] : [];
  }
  setInput(_entityId: string, input: VehicleInput): void {
    this.inputs.push(input);
  }
  state(): VehicleState | null {
    return { forwardSpeed: this.speed, wheels: [] };
  }
  objectFor(): Object3D | null {
    return this.object;
  }
  reset(_entityId: string, transform: TransformComponent): void {
    this.resets.push(transform);
  }
}

/** A Game Mode context with only what a driving session may touch. */
function fakeContext(vehicles: FakeVehicles) {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const actions = new ActionMap(DEFAULT_INPUT_BINDINGS);
  let inputMode: InputMode = "game";
  let cameraControlled = false;
  const context = {
    camera,
    actions,
    characters: [],
    vehicles: {
      ids: () => vehicles.ids(),
      setInput: (id: string, input: VehicleInput) => vehicles.setInput(id, input),
      state: () => vehicles.state(),
      object: () => vehicles.objectFor(),
      reset: (id: string, transform: TransformComponent) => vehicles.reset(id, transform),
    },
    getLocomotion: () => undefined,
    staticBlockerAabbs: () => [],
    addMixer: () => {
      throw new Error("the vehicle mode animates nothing");
    },
    markCameraControlled: () => {
      cameraControlled = true;
    },
    consumeLookDelta: () => ({ dx: 0, dy: 0 }),
    getInputMode: () => inputMode,
    setInputMode: (mode: InputMode) => {
      inputMode = mode;
    },
    setMouseCursorVisible: () => {},
    setPointerLookMode: () => {},
  };
  return {
    context: context as unknown as GameModeContext,
    camera,
    actions,
    setInputMode: (mode: InputMode) => {
      inputMode = mode;
    },
    cameraControlled: () => cameraControlled,
    /** Holds a raw key across ticks (the press edge already consumed). */
    hold(code: string): void {
      actions.handleDown(code);
      actions.advance();
      actions.advance();
    },
    press(code: string): void {
      actions.handleDown(code);
      actions.advance();
    },
    releaseAll(): void {
      for (const code of ["KeyW", "KeyS", "KeyA", "KeyD", "Space", "KeyE"]) actions.handleUp(code);
      actions.advance();
      actions.advance();
    },
  };
}

export function registerVehicleRuntimeTests(check: Check): void {
  // (A) pure helpers.
  check("vehicle mode maps WASD + Space onto pedals, steering and handbrake", () => {
    const held = (...names: string[]) => ({ held: (action: string) => names.includes(action) });
    assert.deepEqual(vehicleInputFromActions(held()), NEUTRAL_VEHICLE_INPUT);
    assert.deepEqual(vehicleInputFromActions(held("move-forward", "move-right")), {
      throttle: 1,
      brake: 0,
      steer: 1,
      handbrake: false,
    });
    assert.deepEqual(vehicleInputFromActions(held("move-back", "move-left", "jump")), {
      throttle: 0,
      brake: 1,
      steer: -1,
      handbrake: true,
    });
    // Both steer keys cancel instead of favouring one.
    assert.equal(vehicleInputFromActions(held("move-left", "move-right")).steer, 0);
  });

  check("vehicle chase camera frames the car from behind along its planar heading", () => {
    const identity = { x: 0, y: 0, z: 0, w: 1 };
    assert.deepEqual(planarHeadingFromQuaternion(identity), { x: 0, z: 1 });
    const yaw90 = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }; // +Z turned onto +X
    const turned = planarHeadingFromQuaternion(yaw90) ?? assert.fail("heading");
    assert.ok(Math.abs(turned.x - 1) < 1e-9 && Math.abs(turned.z) < 1e-9);
    assert.ok(Math.abs(yawDegreesFromHeading(turned) - 90) < 1e-9);
    // Nose straight up: no usable heading, the camera keeps its last one.
    const pitchedUp = { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    assert.equal(planarHeadingFromQuaternion(pitchedUp), null);

    const settings = DEFAULT_VEHICLE_CHASE_CAMERA;
    const position = chaseCameraPosition({ x: 2, y: 1, z: 5 }, { x: 0, z: 1 }, settings);
    assert.deepEqual(position, { x: 2, y: 1 + settings.height, z: 5 - settings.distance });

    // A U-turn's halfway blend would collapse to zero; it snaps to the target.
    assert.deepEqual(blendHeading({ x: 0, z: 1 }, { x: 0, z: -1 }, 0.5), { x: 0, z: -1 });
    assert.equal(speedFieldOfView(60, 0, settings), 60);
    assert.equal(speedFieldOfView(60, -1000, settings), 60 + settings.fovBoostDeg);
  });

  check("vehicle mode is registered and selectable", () => {
    assert.ok(GAME_MODE_OPTIONS.some((option) => option.id === VEHICLE_GAME_MODE_ID));
    assert.equal(resolveGameMode(VEHICLE_GAME_MODE_ID), vehicleGameMode);
    assert.equal(vehicleGameMode.defaultPawn.kind, "vehicle");
  });

  // (B) the session.
  check("vehicle session possesses the first vehicle and forwards held keys as input", () => {
    const vehicles = new FakeVehicles();
    const fake = fakeContext(vehicles);
    const session = vehicleGameMode.createSession(fake.context);
    session.spawnDefaultPawn();
    session.possess();
    assert.equal(session.playerState.pawnEntityId, "car");
    assert.equal(fake.cameraControlled(), true);

    fake.hold("KeyW");
    fake.hold("KeyD");
    session.beforeEngineUpdate?.(1 / 60);
    assert.deepEqual(vehicles.inputs.at(-1), { throttle: 1, brake: 0, steer: 1, handbrake: false });

    fake.setInputMode("ui"); // a pause menu must not leave the throttle pinned
    session.beforeEngineUpdate?.(1 / 60);
    assert.deepEqual(vehicles.inputs.at(-1), NEUTRAL_VEHICLE_INPUT);

    session.dispose();
    assert.deepEqual(vehicles.inputs.at(-1), NEUTRAL_VEHICLE_INPUT);
    assert.equal(session.playerState.pawnEntityId, null);
  });

  check("vehicle session possesses late when physics brings the car up after boot", () => {
    const vehicles = new FakeVehicles();
    vehicles.available = false;
    const fake = fakeContext(vehicles);
    const session = vehicleGameMode.createSession(fake.context);
    session.spawnDefaultPawn();
    session.possess();
    assert.equal(session.playerState.pawnEntityId, null);
    vehicles.available = true;
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.playerState.pawnEntityId, "car");
  });

  check("vehicle chase camera settles behind the car and widens with speed", () => {
    const vehicles = new FakeVehicles();
    const fake = fakeContext(vehicles);
    const session = vehicleGameMode.createSession(fake.context);
    session.spawnDefaultPawn();
    session.possess();
    vehicles.object.position.set(10, 0.7, 20);
    vehicles.object.updateMatrixWorld(true);
    session.update(1 / 60);
    const settings = DEFAULT_VEHICLE_CHASE_CAMERA;
    // First frame places the camera outright: directly behind (-Z), above.
    assert.ok(fake.camera.position.distanceTo(new Vector3(10, 0.7 + settings.height, 20 - settings.distance)) < 1e-6);

    const baseFov = fake.camera.fov;
    vehicles.speed = 40;
    session.update(1 / 60);
    assert.ok(fake.camera.fov > baseFov, "faster reads wider");
    session.dispose();
    assert.equal(fake.camera.fov, baseFov, "the mode gives the camera its FOV back");
  });

  check("vehicle session E resets the car upright, lifted, keeping its heading", () => {
    const vehicles = new FakeVehicles();
    const fake = fakeContext(vehicles);
    const session = vehicleGameMode.createSession(fake.context);
    session.spawnDefaultPawn();
    session.possess();
    vehicles.object.position.set(3, 0.4, -2);
    vehicles.object.rotation.set(0, Math.PI / 2, Math.PI * 0.9); // on its roof, facing +X
    vehicles.object.updateMatrixWorld(true);
    fake.press("KeyE");
    session.beforeEngineUpdate?.(1 / 60);
    const reset = vehicles.resets.at(-1) ?? assert.fail("no reset");
    assert.ok(Math.abs(reset.position[1] - 1.4) < 1e-6, `lifted to y=${reset.position[1]}`);
    assert.equal(reset.rotation[0], 0);
    assert.equal(reset.rotation[2], 0);
    assert.ok(Math.abs(Math.abs(reset.rotation[1]) - 90) < 1e-3, `yaw=${reset.rotation[1]}`);
  });

  // (C) the wheel visuals module.
  check("vehicle module hangs a wheel per suspension ray and follows the live readback", () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const registry = createCapabilityRegistry([createVehicleModule()]);
    registry.runtimeStart(host);
    const actor = new Group();
    actor.scale.set(2, 4, 0.5); // placement × mesh scale the wheels must cancel
    const wheels = [wheelState([0.8, -0.1, 1.35], 0.28), wheelState([-0.8, -0.1, -1.3], 0.3)];
    let live = true;
    host.provide(vehicleHostService, {
      vehicleIds: () => (live ? ["car"] : []),
      vehicleState: () => ({ forwardSpeed: 0, wheels }),
      actorObject: () => actor,
    });

    registry.update(1 / 60);
    const container = actor.getObjectByName("VehicleWheels") ?? assert.fail("no wheel rig");
    assert.equal(container.children.length, 2);
    assert.deepEqual(container.scale.toArray(), [0.5, 0.25, 2]);
    const front = container.children[0] ?? assert.fail("front wheel");
    assert.deepEqual(front.position.toArray(), [0.8, -0.1 - 0.28, 1.35]);

    wheels[0] = { ...wheelState([0.8, -0.1, 1.35], 0.2), steering: 0.3, rotation: 2 };
    registry.update(1 / 60);
    assert.ok(Math.abs(front.position.y - (-0.3)) < 1e-9, "the wheel rides the spring");
    assert.equal(front.rotation.y, 0.3);
    assert.equal(front.rotation.x, 2);

    live = false; // the vehicle left the level
    registry.update(1 / 60);
    assert.equal(actor.getObjectByName("VehicleWheels"), undefined);
    registry.dispose();
  });
}
