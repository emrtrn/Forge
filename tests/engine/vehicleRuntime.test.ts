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
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3, type LineSegments, type Object3D } from "three";

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
  CENTERED_CHASE_ORBIT,
  chaseCameraOrbitPosition,
  chaseCameraPosition,
  clampChaseOrbit,
  recenterChaseOrbit,
  stepChaseArmFraction,
  DEFAULT_VEHICLE_CHASE_CAMERA,
  planarHeadingFromQuaternion,
  speedFieldOfView,
  vehicleInputFromActions,
  yawDegreesFromHeading,
} from "../../src/game/gameModes/vehicleCameraControl";
import { vehicleGameMode } from "../../src/game/gameModes/vehicleGameMode";
import { createCapabilityRegistry } from "../../src/scene/capabilities/capabilityRegistry";
import { createRuntimeServiceHost } from "../../src/scene/capabilities/RuntimeServices";
import {
  audioCommandsService,
  vehicleHostService,
  type AudioCommands,
  type VehicleHost,
} from "../../src/scene/capabilities/runtimeServiceKeys";
import { createVehicleModule } from "../../src/scene/capabilities/vehicleModule";
import { vehicleEngineSoundLevels } from "../../engine/physics/vehicle/vehicleEngineSound";
import { normalizeVehicleDefinition } from "../../engine/physics/vehicle/vehicleTypes";
import { computeVehicleDrive } from "../../engine/physics/vehicle/vehicleDrive";
import type { AudioPlaybackHandle, AudioPlayOptions } from "../../engine/audio/audioSubsystem";
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
    return { forwardSpeed: this.speed, engineLoad: 0, wheels: [], drivetrain: null };
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
  let pendingLook = { dx: 0, dy: 0 };
  let trace: ((from: readonly number[], to: readonly number[]) => number | null) | null = null;
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
    consumeLookDelta: () => {
      const look = pendingLook;
      pendingLook = { dx: 0, dy: 0 };
      return look;
    },
    traceCamera: (from: readonly number[], to: readonly number[]) => trace?.(from, to) ?? null,
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
    /** Pointer travel the next look read consumes. */
    look(dx: number, dy: number): void {
      pendingLook = { dx, dy };
    },
    /** What the camera trace reports from now on (null = always clear). */
    setTrace(next: ((from: readonly number[], to: readonly number[]) => number | null) | null): void {
      trace = next;
    },
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

  check("vehicle mode steers directly with a stick and treats the triggers as analog pedals", () => {
    const pad = (axes: Record<string, number>, ...names: string[]) => ({
      held: (action: string) => names.includes(action),
      axis: (name: string) => axes[name] ?? 0,
    });
    // The stick past its move threshold also holds move-right: its position wins.
    assert.deepEqual(vehicleInputFromActions(pad({ "move-x": 0.6 }, "move-right")), {
      throttle: 0, brake: 0, steer: 0.6, handbrake: false, steerAnalog: true,
    });
    // A centred stick leaves the keys digital, with no analog flag.
    assert.deepEqual(vehicleInputFromActions(pad({}, "move-left", "move-forward")), {
      throttle: 1, brake: 0, steer: -1, handbrake: false,
    });
    const triggers = vehicleInputFromActions(pad({ "trigger-right": 0.4, "trigger-left": 0.25 }));
    assert.equal(triggers.throttle, 0.4);
    assert.equal(triggers.brake, 0.25);
    // Stick Y is a partial pedal instead of the key's full one (up = forward).
    const stickUp = vehicleInputFromActions(pad({ "move-y": -0.55 }, "move-forward"));
    assert.equal(stickUp.throttle, 0.55);
    assert.equal(stickUp.brake, 0);
    assert.equal(vehicleInputFromActions(pad({ "move-y": -0.55, "trigger-right": 0.9 })).throttle, 0.9);
  });

  check("an analog steer input skips the rate filter but keeps the gamma response", () => {
    const def = normalizeVehicleDefinition({ steerSpeed: 1, steerGamma: 2, steeringSpeedCurve: [{ speedMps: 0, scale: 1 }] })!;
    const stick = computeVehicleDrive(def, { ...NEUTRAL_VEHICLE_INPUT, steer: 0.5, steerAnalog: true }, 15, -0.3, 1 / 60);
    assert.equal(stick.steer, 0.5);
    const lock = (def.maxSteerAngleDeg * Math.PI) / 180;
    assert.ok(Math.abs(stick.wheels[0]!.steering - (-0.25 * lock)) < 1e-12);
    const key = computeVehicleDrive(def, { ...NEUTRAL_VEHICLE_INPUT, steer: 0.5 }, 15, -0.3, 1 / 60);
    assert.ok(key.steer < -0.25, `the key path still eases: ${key.steer}`);
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

  check("vehicle chase orbit: centred is the authored framing, yaw looks round, elevation is bounded", () => {
    const settings = DEFAULT_VEHICLE_CHASE_CAMERA;
    const car = { x: 2, y: 1, z: 5 };
    const ahead = { x: 0, z: 1 };
    const centred = chaseCameraOrbitPosition(car, ahead, settings, CENTERED_CHASE_ORBIT);
    const authored = chaseCameraPosition(car, ahead, settings);
    assert.ok(Math.hypot(centred.x - authored.x, centred.y - authored.y, centred.z - authored.z) < 1e-9);

    // Looking left (+yaw) swings the camera out to the car's right (-X).
    const boom = Math.hypot(settings.distance, settings.height - settings.lookHeight);
    const left = chaseCameraOrbitPosition(car, ahead, settings, { yaw: Math.PI / 2, pitch: 0 });
    assert.ok(Math.abs(left.x - (car.x - settings.distance)) < 1e-9 && Math.abs(left.z - car.z) < 1e-9);
    // Looking down (-pitch) raises it; the boom length never changes.
    const down = chaseCameraOrbitPosition(car, ahead, settings, { yaw: 0, pitch: -0.4 });
    assert.ok(down.y > authored.y);
    const pivot = { x: car.x, y: car.y + settings.lookHeight, z: car.z };
    assert.ok(Math.abs(Math.hypot(down.x - pivot.x, down.y - pivot.y, down.z - pivot.z) - boom) < 1e-9);

    const toDeg = 180 / Math.PI;
    const elevation = (orbit: { yaw: number; pitch: number }) => {
      const at = chaseCameraOrbitPosition(car, ahead, settings, clampChaseOrbit(orbit, settings));
      return Math.asin((at.y - pivot.y) / boom) * toDeg;
    };
    assert.ok(Math.abs(elevation({ yaw: 0, pitch: -5 }) - settings.maxElevationDeg) < 1e-6, "no flipping over the top");
    assert.ok(Math.abs(elevation({ yaw: 0, pitch: 5 }) - settings.minElevationDeg) < 1e-6, "no diving under the road");
    // Three turns round still swing back the short way.
    assert.ok(Math.abs(clampChaseOrbit({ yaw: 6 * Math.PI + 0.25, pitch: 0 }, settings).yaw - 0.25) < 1e-9);
  });

  check("vehicle chase orbit swings back only once idle and moving; the arm pulls in at once and eases out", () => {
    const settings = DEFAULT_VEHICLE_CHASE_CAMERA;
    const orbit = { yaw: 1, pitch: -0.2 };
    assert.deepEqual(recenterChaseOrbit(orbit, settings.lookRecenterDelay / 2, 20, 0.1, settings), orbit, "still looking");
    assert.deepEqual(recenterChaseOrbit(orbit, 10, 0, 0.1, settings), orbit, "parked: the view stays put");
    const easing = recenterChaseOrbit(orbit, 10, -20, 0.1, settings);
    assert.ok(easing.yaw < orbit.yaw && easing.yaw > 0 && easing.pitch > orbit.pitch && easing.pitch < 0);

    const boom = 7;
    const padding = settings.collisionPadding / boom;
    assert.ok(Math.abs(stepChaseArmFraction(1, 0.5, boom, 1 / 60, settings) - (0.5 - padding)) < 1e-12, "in at once");
    assert.equal(stepChaseArmFraction(1, 0.01, boom, 1 / 60, settings), 0, "never behind the pivot");
    const out = stepChaseArmFraction(0.4, null, boom, 1 / 60, settings);
    assert.ok(out > 0.4 && out < 0.5, `eases out: ${out}`);
    assert.equal(stepChaseArmFraction(1, null, boom, 1 / 60, settings), 1);
  });

  check("vehicle engine sound pitch follows the revs and volume the load", () => {
    const geared = normalizeVehicleDefinition({
      wheels: [{ position: [0, 0, 1] }],
      drivetrain: {},
      engineSound: { sound: "engine" },
    })!;
    const sound = geared.engineSound!;
    const state = (rpm: number, engineLoad: number, forwardSpeed = 0) => ({
      forwardSpeed,
      engineLoad,
      wheels: [],
      drivetrain: { engineRpm: rpm, gear: 1, shiftTimeRemaining: 0 },
    });
    assert.deepEqual(vehicleEngineSoundLevels(sound, geared, state(900, 0)), { pitch: 1, volume: 0.35 });
    const flatOut = vehicleEngineSoundLevels(sound, geared, state(6500, 1));
    assert.ok(Math.abs(flatOut.pitch - 2.2) < 1e-9 && Math.abs(flatOut.volume - 0.9) < 1e-9);
    // Revving off the throttle (engine braking) still carries at half weight.
    const coasting = vehicleEngineSoundLevels(sound, geared, state(6500, 0));
    assert.ok(Math.abs(coasting.volume - (0.35 + 0.55 * 0.5)) < 1e-9, `coasting ${coasting.volume}`);
    // Over-revved readback clamps rather than shrieking past maxPitch.
    assert.ok(Math.abs(vehicleEngineSoundLevels(sound, geared, state(9000, 1)).pitch - 2.2) < 1e-9);

    // No drivetrain, no RPM: speed stands in, either direction.
    const flat = normalizeVehicleDefinition({ wheels: [{ position: [0, 0, 1] }], engineSound: { sound: "engine" } })!;
    const reversing = { forwardSpeed: -15, engineLoad: 1, wheels: [], drivetrain: null };
    assert.ok(Math.abs(vehicleEngineSoundLevels(flat.engineSound!, flat, reversing).pitch - 1.6) < 1e-9);
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

  check("vehicle chase camera orbits with the mouse, swings back once driving, and pulls in at walls", () => {
    const vehicles = new FakeVehicles();
    const fake = fakeContext(vehicles);
    const session = vehicleGameMode.createSession(fake.context);
    session.spawnDefaultPawn();
    session.possess();
    const settings = DEFAULT_VEHICLE_CHASE_CAMERA;
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 60) session.update(1 / 60);
    };
    session.update(1 / 60);
    assert.ok(fake.camera.position.distanceTo(new Vector3(0, settings.height, -settings.distance)) < 1e-6);

    // Drag left a quarter turn (default 0.003 rad/px): the view looks left, the
    // camera swings out to the car's right, and a parked car keeps that view.
    fake.look(-(Math.PI / 2) / 0.003, 0);
    run(3);
    assert.ok(fake.camera.position.x < -settings.distance + 0.3, `camera x=${fake.camera.position.x}`);
    assert.ok(Math.abs(fake.camera.position.z) < 0.3, `camera z=${fake.camera.position.z}`);
    assert.match(session.getCameraDebug?.().cameraSource ?? "", / arm:1\.00 look:90$/);

    // Driving off with the mouse left alone: back behind the car.
    vehicles.speed = 15;
    run(settings.lookRecenterDelay + 3);
    assert.ok(fake.camera.position.distanceTo(new Vector3(0, settings.height, -settings.distance)) < 0.3);

    // A wall halfway along the boom: the camera is in front of it on the same frame…
    const pivot = new Vector3(0, settings.lookHeight, 0);
    const boom = Math.hypot(settings.distance, settings.height - settings.lookHeight);
    fake.setTrace(() => 0.5);
    session.update(1 / 60);
    const pulled = fake.camera.position.distanceTo(pivot);
    assert.ok(Math.abs(pulled - (boom / 2 - settings.collisionPadding)) < 0.05, `pulled in to ${pulled}`);
    // …and grows back smoothly, not in one jump, once the view clears.
    fake.setTrace(null);
    session.update(1 / 60);
    const easing = fake.camera.position.distanceTo(pivot);
    assert.ok(easing > pulled && easing < boom - 1, `easing out at ${easing}`);
    run(3);
    assert.ok(Math.abs(fake.camera.position.distanceTo(pivot) - boom) < 0.05);
    session.dispose();
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

  check("vehicle module binds model wheel nodes without duplicate tyres and restores the hierarchy on unload", () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const registry = createCapabilityRegistry([createVehicleModule()]);
    registry.runtimeStart(host);
    const actor = new Group();
    actor.scale.setScalar(1.6);
    actor.position.set(5, 2, -3);
    actor.rotation.y = Math.PI / 2;
    const geometry = new BoxGeometry(0.35, 0.6, 0.6);
    geometry.translate(0.125, 0, 0); // an inner-hub pivot, as in the Kenney model
    const material = new MeshStandardMaterial();
    let geometryDisposed = false;
    geometry.addEventListener("dispose", () => { geometryDisposed = true; });
    const node = new Mesh(geometry, material);
    node.name = "authored-wheel";
    node.position.set(0.3, 0.3, 0.66);
    actor.add(node);
    const original = node.position.clone();
    let wheel = { ...wheelState([0.68, 0.83, 1.056], 0.35), radius: 0.48, visualNode: node.name };
    host.provide(vehicleHostService, {
      vehicleIds: () => ["car"], vehicleState: () => ({ forwardSpeed: 0, engineLoad: 0, drivetrain: null, wheels: [wheel] }),
      vehicleDefinition: () => null,
      actorObject: () => actor,
      isDriven: () => false,
    });
    registry.update(1 / 60);
    const container = actor.getObjectByName("VehicleWheels")!;
    const pivot = container.children[0]!;
    assert.equal(pivot.children.length, 1);
    assert.equal(pivot.children[0], node, "use the model's actual wheel");
    actor.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(node);
    const expected = new Vector3(0.68, 0.48, 1.056).applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).add(actor.position);
    assert.ok(bounds.getCenter(new Vector3()).distanceTo(expected) < 1e-6, "geometry centred on the physical axle");
    assert.ok(Math.abs(bounds.getSize(new Vector3()).y - 0.96) < 1e-6, "model radius matches physics");
    wheel = { ...wheel, suspensionLength: 0.2, steering: 0.3, rotation: 2 };
    registry.update(1 / 60);
    assert.equal(pivot.rotation.y, 0.3);
    assert.equal(pivot.rotation.x, 2);
    assert.ok(Math.abs(pivot.position.y - 0.63) < 1e-6);
    registry.levelUnloaded();
    assert.equal(node.parent, actor);
    assert.deepEqual(node.position.toArray(), original.toArray());
    assert.equal(node.matrixAutoUpdate, true);
    assert.equal(actor.getObjectByName("VehicleWheels"), undefined);
    registry.dispose();
    assert.equal(geometryDisposed, false, "the rig does not own GLTF geometry");
    geometry.dispose();
    material.dispose();
  });

  // (C) the wheel visuals + engine sound module.
  check("vehicle module runs a spatial engine voice only while the car is driven", () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const registry = createCapabilityRegistry([createVehicleModule()]);
    registry.runtimeStart(host);
    const actor = new Group();
    actor.position.set(3, 1, -4);
    actor.updateMatrixWorld(true);
    const definition = normalizeVehicleDefinition({
      wheels: [{ position: [0, 0, 1] }],
      drivetrain: {},
      engineSound: { sound: "engine", refDistance: 5, maxDistance: 70 },
    })!;
    let driven = false;
    let rpm = 900;
    let engineLoad = 0;
    host.provide(vehicleHostService, {
      vehicleIds: () => ["car"],
      vehicleState: () => ({
        forwardSpeed: 0,
        engineLoad,
        wheels: [wheelState([0, 0, 1], 0.3)],
        drivetrain: { engineRpm: rpm, gear: 1, shiftTimeRemaining: 0 },
      }),
      vehicleDefinition: () => definition,
      actorObject: () => actor,
      isDriven: () => driven,
    });
    type Call = { kind: string; value: unknown; fade?: number };
    const plays: { sourceId: string; options: AudioPlayOptions; calls: Call[]; refuse: boolean }[] = [];
    let refuseNext = false;
    host.provide(audioCommandsService, {
      playLoop: (sourceId: string, options: AudioPlayOptions = {}) => {
        const play = { sourceId, options, calls: [] as Call[], refuse: refuseNext };
        refuseNext = false;
        plays.push(play);
        const handle = {
          clipId: sourceId,
          get stopped() { return play.refuse || play.calls.some((call) => call.kind === "stop"); },
          volume: 1,
          pitch: 1,
          stop: (fade?: number) => play.calls.push({ kind: "stop", value: null, ...(fade !== undefined ? { fade } : {}) }),
          setVolume: (value: number, fade?: number) => play.calls.push({ kind: "volume", value, ...(fade !== undefined ? { fade } : {}) }),
          setPitch: (value: number) => play.calls.push({ kind: "pitch", value }),
          setPosition: (value: readonly number[]) => play.calls.push({ kind: "position", value: [...value] }),
          setPaused: () => {},
        } as AudioPlaybackHandle;
        return handle;
      },
    } as unknown as AudioCommands);

    registry.update(1 / 60);
    assert.equal(plays.length, 0, "a parked car's engine is off");

    driven = true;
    registry.update(1 / 60);
    assert.equal(plays.length, 1);
    const [engine] = plays;
    assert.equal(engine!.sourceId, "engine");
    assert.deepEqual(engine!.options, {
      volume: 0.35, pitch: 1, spatial: true, position: [3, 1, -4], refDistance: 5, maxDistance: 70, bus: "sfx",
    });

    rpm = 6500;
    engineLoad = 1;
    actor.position.set(3, 1, 10);
    actor.updateMatrixWorld(true);
    registry.update(1 / 60);
    assert.equal(plays.length, 1, "steered, not restarted");
    const pitch = engine!.calls.find((call) => call.kind === "pitch");
    const volume = engine!.calls.find((call) => call.kind === "volume");
    assert.ok(Math.abs((pitch?.value as number) - 2.2) < 1e-9);
    assert.ok(Math.abs((volume?.value as number) - 0.9) < 1e-9 && (volume?.fade ?? 0) > 0, "eased, not stepped");
    assert.deepEqual(engine!.calls.find((call) => call.kind === "position")?.value, [3, 1, 10]);

    driven = false;
    registry.update(1 / 60);
    const stop = engine!.calls.find((call) => call.kind === "stop");
    assert.ok(stop && (stop.fade ?? 0) > 0, "the engine dies away when the driver leaves");

    // A voice the audio layer refuses is not re-requested every frame.
    driven = true;
    refuseNext = true;
    registry.update(1 / 60);
    registry.update(1 / 60);
    assert.equal(plays.length, 2);

    driven = false;
    registry.update(1 / 60);
    driven = true;
    registry.update(1 / 60);
    assert.equal(plays.length, 3, "taking the wheel again starts it afresh");
    registry.levelUnloaded();
    assert.ok(plays[2]!.calls.some((call) => call.kind === "stop"), "a level teardown silences it");
    registry.dispose();
  });

  check("vehicle module draws a ?debug suspension wire in the chassis frame and drops it with the rig", () => {
    const host = createRuntimeServiceHost({ syncEntityTransform: () => {} });
    const registry = createCapabilityRegistry([createVehicleModule()]);
    registry.runtimeStart(host);
    const actor = new Group();
    actor.position.set(10, 2, -5);
    actor.rotation.y = Math.PI / 2;
    actor.scale.set(2, 2, 2); // the rig container cancels it: the wire is in metres
    const definition = normalizeVehicleDefinition({
      wheels: [
        { position: [0.8, 0, 1.2], suspensionRestLength: 0.4, suspensionMaxTravel: 0.1 },
        { position: [-0.8, 0, -1.2] },
      ],
    })!;
    // Front wheel on the ground: its hit, in world space, is 0.3 + 0.35 below the
    // hard point. Chassis-local (0.8, -0.65, 1.2) yawed +90° → world offset (1.2, -0.65, -0.8).
    const front = { ...wheelState([0.8, 0, 1.2], 0.3), contactPoint: [11.2, 1.35, -5.8] as [number, number, number] };
    const rear = { ...wheelState([-0.8, 0, -1.2], 0.4), inContact: false };
    let debug = true;
    host.provide(vehicleHostService, {
      get debug() { return debug; },
      vehicleIds: () => ["car"],
      vehicleState: () => ({ forwardSpeed: 0, engineLoad: 0, drivetrain: null, wheels: [front, rear] }),
      vehicleDefinition: () => definition,
      actorObject: () => actor,
      isDriven: () => false,
    } as unknown as VehicleHost);

    registry.update(1 / 60);
    const wire = actor.getObjectByName("VehicleSuspensionDebug") as LineSegments | undefined
      ?? assert.fail("no suspension wire under ?debug");
    const rig = actor.getObjectByName("VehicleWheels")!;
    assert.equal(wire.parent, actor, "a sibling of the wheel rig");
    assert.equal(rig.children.length, 2, "the rig holds only the wheel pivots");
    assert.deepEqual(wire.scale.toArray(), rig.scale.toArray(), "the same chassis frame");
    const positions = wire.geometry.getAttribute("position");
    const colors = wire.geometry.getAttribute("color");
    const at = (vertex: number) => [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)];
    const near = (actual: number[], expected: number[], label: string) =>
      assert.ok(actual.every((value, index) => Math.abs(value - expected[index]!) < 1e-5), `${label}: ${actual}`);
    near(at(0), [0.8, 0, 1.2], "spring starts at the hard point");
    near(at(1), [0.8, -0.3, 1.2], "spring ends at the wheel centre");
    near(at(3), [0.8, -0.65, 1.2], "contact brought from world into the chassis frame");
    // Range ticks after the 2 + 3 contact segments: rest − travel, then rest + travel.
    assert.ok(Math.abs(positions.getY(10) - -0.3) < 1e-6, "bump-stop tick at rest − travel");
    assert.ok(Math.abs(positions.getY(14) - -0.5) < 1e-6, "droop tick at rest + travel");
    // The rear wheel (vertex 18 on) is airborne: its radius below the centre, in red.
    near(at(20), [-0.8, -0.4, -1.2], "airborne link starts at the centre");
    near(at(21), [-0.8, -0.75, -1.2], "and spans the radius");
    assert.ok(colors.getX(21) > 0.9 && colors.getY(21) < 0.5, "airborne is red");
    assert.ok(colors.getY(3) > 0.6 && colors.getX(3) < 0.3, "contact is green");

    registry.levelUnloaded();
    assert.equal(actor.getObjectByName("VehicleSuspensionDebug"), undefined);

    debug = false;
    registry.update(1 / 60);
    assert.ok(actor.getObjectByName("VehicleWheels"), "the rig is rebuilt");
    assert.equal(actor.getObjectByName("VehicleSuspensionDebug"), undefined, "no wire without ?debug");
    registry.dispose();
  });

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
      vehicleState: () => ({ forwardSpeed: 0, engineLoad: 0, wheels, drivetrain: null }),
      vehicleDefinition: () => null,
      actorObject: () => actor,
      isDriven: () => false,
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
