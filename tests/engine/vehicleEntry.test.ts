/**
 * Vehicle plan Faz 4: a TPS character gets in and out of a `Vehicle` actor.
 *
 *   (A) the pure rules — which car is in reach, exit spots in door order with
 *       blockers skipped, ground height from wheel contacts, stopping pedals;
 *   (B) the TPS session against a recording fake context — E climbs in (hide,
 *       collision off, possess the car, chase camera), keys drive, E again
 *       brakes to a crawl, then steps out at the driver's door facing the way
 *       the car faces, with the car parked on its handbrake; a save-game
 *       load seats the player straight back in the car it was driving.
 */
import assert from "node:assert/strict";
import { Group, Object3D, PerspectiveCamera, Vector3 } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ActionMap } from "../../engine/input/actionMap";
import { DEFAULT_INPUT_BINDINGS } from "../../engine/input/defaultInputBindings";
import type { Aabb3 } from "../../engine/movement/characterCollision";
import type { TransformComponent } from "../../engine/scene/components";
import type { VehicleInput, VehicleState } from "../../engine/physics/vehicle/vehicleTypes";
import {
  chooseExitSpot,
  DEFAULT_VEHICLE_ENTRY,
  findEnterableVehicle,
  PARKED_VEHICLE_INPUT,
  stoppingInput,
  vehicleExitCandidates,
  vehicleGroundHeight,
} from "../../src/game/gameModes/vehicleEntry";
import { TpsCharacterSession, tpsCharacterGameMode } from "../../src/game/gameModes/tpsCharacterGameMode";
import type { GameModeContext, InputMode, RuntimeCharacterRef } from "../../src/scene/gameModeTypes";

type Check = (label: string, fn: () => void) => void;

const near = (a: number, b: number, epsilon = 1e-6) => Math.abs(a - b) < epsilon;

const YAW_90 = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }; // +Z turned onto +X

function stateWithContacts(contactYs: readonly (number | null)[]): VehicleState {
  return {
    forwardSpeed: 0,
    engineLoad: 0,
    drivetrain: null,
    wheels: contactYs.map((y) => ({
      position: [0, 0, 0],
      radius: 0.4,
      suspensionLength: 0.3,
      steering: 0,
      rotation: 0,
      inContact: y !== null,
      groundEntityId: y === null ? null : "ground",
      contactPoint: y === null ? null : [0, y, 0],
      hardPoint: null,
    })),
  };
}

/** One car the test moves by hand, plus a recording of every bridge call. */
function fakeWorld() {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const actions = new ActionMap(DEFAULT_INPUT_BINDINGS);
  const car = new Group();
  const hero = new Object3D();
  const character: RuntimeCharacterRef = {
    index: 0,
    entityId: "hero",
    object: hero,
    gltf: { animations: [] } as unknown as GLTF,
    placement: { assetId: "hero", position: [0, 0, 0], behavior: { script: "input-move" } },
  };
  const inputs: VehicleInput[] = [];
  const hidden = new Map<string, boolean>();
  const collision = new Map<string, boolean>();
  const teleports: { id: string; position: [number, number, number]; yawDeg: number }[] = [];
  const blockers: Aabb3[] = [];
  let carAlive = true;
  let speed = 0;
  let inputMode: InputMode = "game";
  let pendingLook = { dx: 0, dy: 0 };
  const context: GameModeContext = {
    camera,
    actions,
    characters: [character],
    vehicles: {
      ids: () => (carAlive ? ["car"] : []),
      setInput: (_id, input) => inputs.push(input),
      state: () => ({ ...stateWithContacts([0, 0, 0, 0]), forwardSpeed: speed }),
      object: () => (carAlive ? car : null),
      reset: (_id: string, _transform: TransformComponent) => {},
    },
    setEntityHidden: (id, value) => hidden.set(id, value),
    setEntityCollisionEnabled: (id, value) => collision.set(id, value),
    teleportCharacter: (id, position, yawDeg) => {
      teleports.push({ id, position: [...position], yawDeg });
      hero.position.set(position[0], position[1], position[2]);
    },
    getLocomotion: () => undefined,
    staticBlockerAabbs: () => blockers,
    addMixer: () => {},
    markCameraControlled: () => {},
    consumeLookDelta: () => {
      const look = pendingLook;
      pendingLook = { dx: 0, dy: 0 };
      return look;
    },
    getInputMode: () => inputMode,
    setInputMode: (mode) => {
      inputMode = mode;
    },
    setMouseCursorVisible: () => {},
    setPointerLookMode: () => {},
  };
  return {
    context,
    camera,
    car,
    hero,
    inputs,
    hidden,
    collision,
    teleports,
    blockers,
    setSpeed: (value: number) => {
      speed = value;
    },
    removeCar: () => {
      carAlive = false;
    },
    setInputMode: (mode: InputMode) => {
      inputMode = mode;
    },
    /** Pointer travel the next look read consumes. */
    look(dx: number, dy: number): void {
      pendingLook = { dx, dy };
    },
    /** One frame with `code` freshly pressed (the edge `pressed()` sees). */
    press(code: string): void {
      actions.handleDown(code);
      actions.advance();
    },
    /** Holds `code` past its press edge. */
    hold(code: string): void {
      actions.handleDown(code);
      actions.advance();
      actions.advance();
    },
    release(code: string): void {
      actions.handleUp(code);
      actions.advance();
      actions.advance();
    },
  };
}

function startSession(world: ReturnType<typeof fakeWorld>): TpsCharacterSession {
  const session = tpsCharacterGameMode.createSession(world.context) as TpsCharacterSession;
  session.spawnDefaultPawn();
  session.possess();
  return session;
}

export function registerVehicleEntryTests(check: Check): void {
  // (A) pure rules.
  check("vehicle entry picks the nearest car within reach, by horizontal distance", () => {
    const candidates = [
      { id: "far", position: { x: 10, y: 0, z: 0 } },
      { id: "close", position: { x: 2, y: 5, z: 0 } }, // height ignored
      { id: "closer", position: { x: 0, y: 0, z: 1.5 } },
    ];
    assert.equal(findEnterableVehicle({ x: 0, y: 0, z: 0 }, candidates, { enterRadius: 3 }), "closer");
    assert.equal(findEnterableVehicle({ x: 0, y: 0, z: 0 }, candidates.slice(0, 1), { enterRadius: 3 }), null);
  });

  check("vehicle exit spots follow the car's yaw: driver's door, passenger's, then behind", () => {
    const settings = DEFAULT_VEHICLE_ENTRY;
    const [driver, passenger, rear] = vehicleExitCandidates({ x: 5, y: 9, z: 5 }, YAW_90, 0, settings);
    // Facing +X, the car's left (+X local) is world −Z.
    assert.ok(near(driver!.x, 5) && near(driver!.z, 5 - settings.exitSideOffset), JSON.stringify(driver));
    assert.ok(near(passenger!.x, 5) && near(passenger!.z, 5 + settings.exitSideOffset));
    assert.ok(near(rear!.x, 5 - settings.exitRearOffset) && near(rear!.z, 5));
    // Dropped at road level + lift, not at the chassis origin's height.
    assert.ok(near(driver!.y, settings.exitLift));

    // A car lying on its side still exits beside it, on the ground.
    const onSide = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const [side] = vehicleExitCandidates({ x: 0, y: 1, z: 0 }, onSide, 0, settings);
    assert.ok(near(side!.x, settings.exitSideOffset) && near(side!.y, settings.exitLift));
  });

  check("vehicle exit skips a blocked door, ignores the floor, and falls back to the driver's", () => {
    const clearance = DEFAULT_VEHICLE_ENTRY.exitClearance;
    const spots = [
      { x: 1.7, y: 0.1, z: 0 },
      { x: -1.7, y: 0.1, z: 0 },
    ];
    const floor: Aabb3 = { min: [-50, -1, -50], max: [50, 0, 50] };
    const wall: Aabb3 = { min: [1.5, 0, -3], max: [2.5, 3, 3] };
    assert.deepEqual(chooseExitSpot(spots, [floor], clearance), spots[0]);
    assert.deepEqual(chooseExitSpot(spots, [floor, wall], clearance), spots[1]);
    const everywhere: Aabb3 = { min: [-9, 0, -9], max: [9, 3, 9] };
    assert.deepEqual(chooseExitSpot(spots, [everywhere], clearance), spots[0]);
  });

  check("vehicle ground height is the lowest wheel contact, else the chassis origin", () => {
    assert.equal(vehicleGroundHeight({ x: 0, y: 0.6, z: 0 }, stateWithContacts([0.2, 0.1, null])), 0.1);
    assert.equal(vehicleGroundHeight({ x: 0, y: 0.6, z: 0 }, stateWithContacts([null, null])), 0.6);
    assert.equal(vehicleGroundHeight({ x: 0, y: 0.6, z: 0 }, null), 0.6);
  });

  check("vehicle stopping pedals brake against the direction of travel", () => {
    assert.deepEqual(stoppingInput(10), { throttle: 0, brake: 1, steer: 0, handbrake: true });
    assert.deepEqual(stoppingInput(-10), { throttle: 1, brake: 0, steer: 0, handbrake: true });
    assert.ok(DEFAULT_VEHICLE_ENTRY.maxExitSpeed > 0.5, "stays above the reference car's reverse threshold");
  });

  // (B) the TPS session.
  check("tps character gets in a car with E, drives it, and gets out beside it", () => {
    const world = fakeWorld();
    const session = startSession(world);
    assert.equal(session.playerState.pawnEntityId, "hero");

    // Out of reach: E does nothing.
    world.hero.position.set(20, 0, 0);
    world.press("KeyE");
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.drivingVehicleId, null);
    world.release("KeyE");

    // In reach: E climbs in.
    world.hero.position.set(2, 0, 0.5);
    world.press("KeyE");
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.drivingVehicleId, "car");
    assert.equal(session.playerState.pawnEntityId, "car");
    assert.equal(world.hidden.get("hero"), true);
    assert.equal(world.collision.get("hero"), false);
    world.release("KeyE");

    // Driving: keys reach the car and the chase camera frames it.
    world.hold("KeyW");
    session.beforeEngineUpdate?.(1 / 60);
    assert.deepEqual(world.inputs.at(-1), { throttle: 1, brake: 0, steer: 0, handbrake: false });
    session.update(1 / 60);
    const settings = { distance: 7, height: 2.6 };
    assert.ok(world.camera.position.distanceTo(new Vector3(0, settings.height, -settings.distance)) < 1e-6);
    assert.match(session.getCameraDebug?.().cameraSource ?? "", /^vehicle-chase pawn:car /);
    world.release("KeyW");

    // E at speed: brake first, stay in.
    world.setSpeed(12);
    world.press("KeyE");
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.drivingVehicleId, "car");
    assert.deepEqual(world.inputs.at(-1), stoppingInput(12));
    world.release("KeyE");
    session.beforeEngineUpdate?.(1 / 60);
    assert.deepEqual(world.inputs.at(-1), stoppingInput(12), "keeps braking without a second press");

    // Slow enough: out at the driver's door (+X local = world +X here), facing +Z.
    world.setSpeed(0.5);
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.drivingVehicleId, null);
    assert.equal(session.playerState.pawnEntityId, "hero");
    assert.deepEqual(world.inputs.at(-1), PARKED_VEHICLE_INPUT);
    const exit = world.teleports.at(-1) ?? assert.fail("no teleport");
    assert.ok(near(exit.position[0], DEFAULT_VEHICLE_ENTRY.exitSideOffset));
    assert.ok(near(exit.position[1], DEFAULT_VEHICLE_ENTRY.exitLift));
    assert.ok(near(exit.position[2], 0));
    assert.ok(near(exit.yawDeg, 0));
    assert.equal(world.hidden.get("hero"), false);
    assert.equal(world.collision.get("hero"), true);
    session.update(1 / 60); // the follow camera takes over (blending from the chase view)
    assert.equal(session.getCameraDebug?.().cameraSource?.startsWith("vehicle-chase"), false);
  });

  check("tps driver steps out where they got in when the car vanishes, and dispose unhides", () => {
    const world = fakeWorld();
    const session = startSession(world);
    world.hero.position.set(1, 0, 0);
    world.press("KeyE");
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.drivingVehicleId, "car");
    world.removeCar();
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.drivingVehicleId, null);
    assert.equal(world.teleports.length, 0, "no car, no door to step out of");
    assert.equal(world.hidden.get("hero"), false);
    assert.equal(session.playerState.pawnEntityId, "hero");

    const second = fakeWorld();
    const riding = startSession(second);
    second.hero.position.set(1, 0, 0);
    second.press("KeyE");
    riding.beforeEngineUpdate?.(1 / 60);
    riding.dispose();
    assert.equal(second.hidden.get("hero"), false);
    assert.equal(second.collision.get("hero"), true);
    assert.deepEqual(second.inputs.at(-1), PARKED_VEHICLE_INPUT);
  });

  check("tps driver's mouse orbits the chase camera, not the on-foot control rotation", () => {
    const world = fakeWorld();
    const session = startSession(world);
    session.boardVehicle("car");
    session.beforeEngineUpdate?.(1 / 60);
    session.update(1 / 60);
    const before = session.getCameraDebug?.().cameraSource ?? "";
    assert.match(before, / look:0$/);
    world.look(-(Math.PI / 4) / 0.003, 0);
    session.beforeEngineUpdate?.(1 / 60); // must leave the look input to the chase camera
    session.update(1 / 60);
    assert.match(session.getCameraDebug?.().cameraSource ?? "", / look:45$/);
    // Out again: the view faces the way the car faces, as on any exit.
    world.press("KeyE");
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.drivingVehicleId, null);
    const yaw = session.getCameraDebug?.().controlYawDeg ?? Number.NaN;
    assert.ok(Math.abs(Math.abs(yaw) - 180) < 1e-6, `facing +Z after getting out: yaw=${yaw}`);
  });

  check("tps save-game load seats the player straight back in the car it was driving", () => {
    const world = fakeWorld();
    const session = startSession(world);
    // Out of reach and without E: a restore is not a boarding attempt.
    world.hero.position.set(40, 0, 0);
    assert.equal(session.boardVehicle("ghost"), false, "a car that is not in the level");
    assert.equal(session.drivingVehicleId, null);
    assert.equal(session.boardVehicle("car"), true);
    assert.equal(session.drivingVehicleId, "car");
    assert.equal(session.playerState.pawnEntityId, "car");
    assert.equal(world.hidden.get("hero"), true);
    assert.equal(world.collision.get("hero"), false);
    assert.equal(session.boardVehicle("car"), false, "already driving");
    world.hold("KeyW");
    session.beforeEngineUpdate?.(1 / 60);
    assert.deepEqual(world.inputs.at(-1), { throttle: 1, brake: 0, steer: 0, handbrake: false });

    const optedOut = fakeWorld();
    const plain = new TpsCharacterSession(optedOut.context, undefined, { vehicleEntry: null });
    plain.spawnDefaultPawn();
    plain.possess();
    assert.equal(plain.boardVehicle("car"), false, "a session that never boards vehicles");
    assert.equal(plain.playerState.pawnEntityId, "hero");
  });

  check("tps vehicle entry is off in UI mode and when the session opts out", () => {
    const world = fakeWorld();
    const session = startSession(world);
    world.hero.position.set(1, 0, 0);
    world.setInputMode("ui");
    world.press("KeyE");
    session.beforeEngineUpdate?.(1 / 60);
    assert.equal(session.drivingVehicleId, null);

    const optedOut = fakeWorld();
    const plain = new TpsCharacterSession(optedOut.context, undefined, { vehicleEntry: null });
    plain.spawnDefaultPawn();
    plain.possess();
    optedOut.hero.position.set(1, 0, 0);
    optedOut.press("KeyE");
    plain.beforeEngineUpdate(1 / 60);
    assert.equal(plain.drivingVehicleId, null);
  });
}
