/**
 * Phase I: the RTS validation case.
 *
 * The plan's origin story is an RTS that could not be built on the old runtime
 * without writing a second app shell. Phase I answers it with a Game Mode: a
 * characterless, top-down camera that possesses nothing and is steered entirely
 * from the cursor. These checks pin the two halves of that claim —
 *
 *   (A) the camera math is pure and behaves: edge bands ramp, diagonals do not
 *       run faster, zoom stays inside its range and scales the pan speed,
 *   (B) the session drives a real camera through the ordinary
 *       {@link GameModeContext} — no shell of its own, nothing possessed, and
 *       click selection resolved through the runtime's pick bridge.
 *
 * Everything here runs headless: the context is a plain object, the camera a
 * bare Three.js one. If the RTS mode ever needs something the standard Game Mode
 * contract cannot give it, this file is where that shows up first.
 */
import assert from "node:assert/strict";
import {
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  BoxGeometry,
  Vector3,
  type Object3D,
} from "three";

import { ActionMap } from "../../engine/input/actionMap";
import { DEFAULT_INPUT_BINDINGS } from "../../engine/input/defaultInputBindings";
import { wheelNotches } from "../../src/input/pointerCursorSource";
import {
  combinePanIntent,
  DEFAULT_RTS_CAMERA_SETTINGS,
  edgePanIntent,
  groundFocusFromCamera,
  keyPanIntent,
  panSpeedForDistance,
  rtsCameraPosition,
  rtsPanStep,
  zoomDistance,
} from "../../src/game/gameModes/rtsCameraControl";
import { RtsSelectionHighlight } from "../../src/game/gameModes/rtsSelection";
import { rtsCameraGameMode } from "../../src/game/gameModes/rtsCameraGameMode";
import { RTS_GAME_MODE_ID, GAME_MODE_OPTIONS } from "../../src/game/gameModes/catalog";
import { resolveGameMode } from "../../src/game/gameModes/registry";
import type {
  GameModeContext,
  InputMode,
  RuntimeEntityPick,
} from "../../src/scene/gameModeTypes";

type Check = (label: string, fn: () => void) => void;

/**
 * A Game Mode context with no runtime behind it: the mode gets a real camera and
 * a real action map, and the pointer/wheel/pick bridges are settable fields the
 * checks drive directly. Everything the RTS mode never calls throws, so a future
 * change that quietly makes it depend on characters or ragdolls fails loudly.
 */
class FakeGameModeContext {
  readonly camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  readonly actions = new ActionMap(DEFAULT_INPUT_BINDINGS);
  readonly characters = [];
  pointer: { x: number; y: number } | null = null;
  wheel = 0;
  pick: RuntimeEntityPick | null = null;
  pickedAt: { x: number; y: number } | null = null;
  inputMode: InputMode = "game";
  cameraControlled = false;

  getLocomotion(): undefined {
    return undefined;
  }
  staticBlockerAabbs(): [] {
    return [];
  }
  addMixer(): void {
    throw new Error("the RTS mode animates nothing");
  }
  markCameraControlled(): void {
    this.cameraControlled = true;
  }
  consumeLookDelta(): { dx: number; dy: number } {
    return { dx: 0, dy: 0 };
  }
  getPointerViewport(): { x: number; y: number } | null {
    return this.pointer;
  }
  consumeWheelDelta(): number {
    const notches = this.wheel;
    this.wheel = 0;
    return notches;
  }
  pickEntityAt(x: number, y: number): RuntimeEntityPick | null {
    this.pickedAt = { x, y };
    return this.pick;
  }
  getInputMode(): InputMode {
    return this.inputMode;
  }
  setInputMode(mode: InputMode): void {
    this.inputMode = mode;
  }
  setMouseCursorVisible(): void {}
  setPointerLookMode(): void {}

  /** Presses a raw code for exactly one tick's worth of action edges. */
  press(code: string): void {
    this.actions.handleDown(code);
    this.actions.advance();
  }
  release(code: string): void {
    this.actions.handleUp(code);
    this.actions.advance();
  }
  hold(code: string): void {
    this.actions.handleDown(code);
    this.actions.advance();
    // A second advance turns the press edge into a plain hold.
    this.actions.advance();
  }

  asContext(): GameModeContext {
    return this as unknown as GameModeContext;
  }
}

function unitMesh(name: string): Object3D {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xffffff }));
  mesh.name = name;
  return mesh;
}

export function registerRtsCameraGameModeTests(check: Check): void {
  // (A) the pure camera math.
  check("rts camera: the screen-edge band ramps in, and an off-canvas pointer stops the pan", () => {
    const margin = 0.1;
    assert.deepEqual(edgePanIntent(null, margin), { forward: 0, right: 0 });
    // Dead centre: nothing.
    assert.deepEqual(edgePanIntent({ x: 0.5, y: 0.5 }, margin), { forward: 0, right: 0 });
    // Top edge pushes the focus away from the camera; bottom pulls it back.
    assert.equal(edgePanIntent({ x: 0.5, y: 0 }, margin).forward, 1);
    assert.equal(edgePanIntent({ x: 0.5, y: 1 }, margin).forward, -1);
    // Right edge pushes screen-right, left edge screen-left.
    assert.equal(edgePanIntent({ x: 1, y: 0.5 }, margin).right, 1);
    assert.equal(edgePanIntent({ x: 0, y: 0.5 }, margin).right, -1);
    // Half a band in is half the push, not a switch.
    assert.ok(Math.abs(edgePanIntent({ x: 0.5, y: 0.05 }, margin).forward - 0.5) < 1e-9);
    // Outside the canvas saturates rather than overshooting.
    assert.equal(edgePanIntent({ x: 0.5, y: -0.4 }, margin).forward, 1);
    // A zero margin disables edge panning entirely.
    assert.deepEqual(edgePanIntent({ x: 0, y: 0 }, 0), { forward: 0, right: 0 });
  });

  check("rts camera: keys and the edge band add up, but never past full speed", () => {
    const keys = keyPanIntent({ forward: true, back: false, left: false, right: true });
    assert.deepEqual(keys, { forward: 1, right: 1 });
    assert.deepEqual(keyPanIntent({ forward: true, back: true, left: true, right: true }), {
      forward: 0,
      right: 0,
    });
    // Holding W while the cursor also sits on the top edge is still one unit.
    const combined = combinePanIntent(keys, { forward: 1, right: 0 });
    assert.deepEqual(combined, { forward: 1, right: 1 });
    // Opposing sources cancel.
    assert.deepEqual(combinePanIntent(keys, { forward: -1, right: -1 }), {
      forward: 0,
      right: 0,
    });
  });

  check("rts camera: panning follows the heading and diagonals are not faster", () => {
    // Yaw 0 looks toward -z, so "forward" moves the focus along -z at exactly speed*dt.
    const straight = rtsPanStep({ forward: 1, right: 0 }, 0, 10, 0.5);
    assert.ok(Math.abs(straight.dx) < 1e-9);
    assert.ok(Math.abs(straight.dz - -5) < 1e-9);
    // Screen-right is world +x at yaw 0.
    const right = rtsPanStep({ forward: 0, right: 1 }, 0, 10, 0.5);
    assert.ok(Math.abs(right.dx - 5) < 1e-9);
    assert.ok(Math.abs(right.dz) < 1e-9);
    // A corner push covers the same ground per second as a straight one.
    const diagonal = rtsPanStep({ forward: 1, right: 1 }, 0, 10, 0.5);
    assert.ok(Math.abs(Math.hypot(diagonal.dx, diagonal.dz) - 5) < 1e-9);
    // A 90 degree heading turns "forward" into world -x.
    const turned = rtsPanStep({ forward: 1, right: 0 }, 90, 10, 0.5);
    assert.ok(Math.abs(turned.dx - -5) < 1e-9);
    assert.ok(Math.abs(turned.dz) < 1e-9);
    // Degenerate inputs never move the focus.
    assert.deepEqual(rtsPanStep({ forward: 0, right: 0 }, 0, 10, 0.5), { dx: 0, dz: 0 });
    assert.deepEqual(rtsPanStep({ forward: 1, right: 0 }, 0, 10, 0), { dx: 0, dz: 0 });
  });

  check("rts camera: zoom stays inside its range and drives the pan speed", () => {
    const settings = DEFAULT_RTS_CAMERA_SETTINGS;
    const start = 30;
    // Scrolling away zooms out, scrolling toward zooms in.
    assert.ok(zoomDistance(start, 1, settings) > start);
    assert.ok(zoomDistance(start, -1, settings) < start);
    // Neither direction can leave the authored range, however hard it is spun.
    assert.equal(zoomDistance(start, 100, settings), settings.maxDistance);
    assert.equal(zoomDistance(start, -100, settings), settings.minDistance);
    // One notch is the same proportion close up and far out.
    const nearRatio = zoomDistance(15, 1, settings) / 15;
    const farRatio = zoomDistance(30, 1, settings) / 30;
    assert.ok(Math.abs(nearRatio - farRatio) < 1e-9);
    // Zoomed out pans faster; the ends are exactly the authored speeds.
    assert.equal(panSpeedForDistance(settings, settings.minDistance), settings.panSpeedNear);
    assert.equal(panSpeedForDistance(settings, settings.maxDistance), settings.panSpeedFar);
    assert.ok(
      panSpeedForDistance(settings, 30) > panSpeedForDistance(settings, 15),
      "pan speed must grow with the zoom distance",
    );
    // Out-of-range distances clamp instead of extrapolating.
    assert.equal(panSpeedForDistance(settings, 1e6), settings.panSpeedFar);
  });

  check("rts camera: the camera sits behind and above its focus, and reads the ground back", () => {
    const settings = DEFAULT_RTS_CAMERA_SETTINGS;
    const focus = { x: 4, y: 0, z: -6 };
    const distance = 25;
    const position = rtsCameraPosition(focus, distance, settings);
    // Exactly `distance` away from the focus, and above it.
    const away = Math.hypot(position.x - focus.x, position.y - focus.y, position.z - focus.z);
    assert.ok(Math.abs(away - distance) < 1e-9);
    assert.ok(position.y > focus.y);
    // At yaw 0 the camera sits on +z of its focus (it looks toward -z).
    assert.ok(Math.abs(position.x - focus.x) < 1e-9);
    assert.ok(position.z > focus.z);

    // Looking from there back down recovers the same ground point.
    const forward = {
      x: focus.x - position.x,
      y: focus.y - position.y,
      z: focus.z - position.z,
    };
    const ground = groundFocusFromCamera(position, forward);
    assert.ok(ground);
    assert.ok(Math.abs(ground.x - focus.x) < 1e-9);
    assert.ok(Math.abs(ground.z - focus.z) < 1e-9);
    // A camera that looks up or along the plane has no ground focus at all.
    assert.equal(groundFocusFromCamera(position, { x: 0, y: 1, z: -1 }), null);
    assert.equal(groundFocusFromCamera(position, { x: 0, y: 0, z: -1 }), null);
  });

  check("rts camera: wheel deltas normalize to notches whatever the browser reports", () => {
    // Pixel mode (0), line mode (1), page mode (2) — one notch each.
    assert.equal(wheelNotches(100, 0), 1);
    assert.equal(wheelNotches(3, 1), 1);
    assert.equal(wheelNotches(1, 2), 1);
    assert.equal(wheelNotches(-100, 0), -1);
    assert.equal(wheelNotches(0, 0), 0);
    assert.equal(wheelNotches(Number.NaN, 0), 0);
    // A coarse trackpad flick cannot jump the whole zoom range in one event.
    assert.equal(wheelNotches(100000, 0), 3);
    assert.equal(wheelNotches(-100000, 0), -3);
  });

  // (B) the session, driven through the ordinary Game Mode contract.
  check("rts mode: it is registered, and possesses nothing", () => {
    assert.equal(resolveGameMode(RTS_GAME_MODE_ID).id, RTS_GAME_MODE_ID);
    assert.ok(
      GAME_MODE_OPTIONS.some((option) => option.id === RTS_GAME_MODE_ID),
      "the editor's World Settings dropdown must offer the RTS mode",
    );
    assert.equal(rtsCameraGameMode.defaultPawn.kind, "camera");
    assert.equal(rtsCameraGameMode.playerController.possess, "camera-pawn");

    const context = new FakeGameModeContext();
    context.camera.position.set(0, 20, 20);
    context.camera.lookAt(0, 0, 0);
    const session = rtsCameraGameMode.createSession(context.asContext());
    session.spawnDefaultPawn();
    session.possess();
    // Nothing is possessed: no pawn entity, and no character was ever consulted.
    assert.equal(session.playerState.pawnEntityId, null);
    assert.ok(context.cameraControlled, "the mode must own the camera against resizes");
    session.dispose();
  });

  check("rts mode: it frames the ground the level booted looking at", () => {
    const context = new FakeGameModeContext();
    context.camera.position.set(6, 24, 18);
    context.camera.lookAt(6, 0, 0);
    const session = rtsCameraGameMode.createSession(context.asContext());
    session.spawnDefaultPawn();
    session.possess();

    // The camera is re-placed on the mode's own rig, but still looking at the
    // ground point the authored pose framed — not snapped to the world origin.
    const forward = context.camera.getWorldDirection(new Vector3());
    const ground = groundFocusFromCamera(context.camera.position, forward);
    assert.ok(ground);
    assert.ok(Math.abs(ground.x - 6) < 1e-3, `focus x drifted: ${ground.x}`);
    assert.ok(Math.abs(ground.z - 0) < 1e-3, `focus z drifted: ${ground.z}`);
    assert.ok(context.camera.position.y > 0);
    session.dispose();
  });

  check("rts mode: the cursor at a screen edge pans the map, and leaving it stops", () => {
    const context = new FakeGameModeContext();
    context.camera.position.set(0, 24, 24);
    context.camera.lookAt(0, 0, 0);
    const session = rtsCameraGameMode.createSession(context.asContext());
    session.spawnDefaultPawn();
    session.possess();
    const startX = context.camera.position.x;
    const startZ = context.camera.position.z;

    // Cursor on the right edge for a second: the map slides screen-right (+x).
    context.pointer = { x: 1, y: 0.5 };
    session.update(1);
    assert.ok(context.camera.position.x > startX + 1, "edge pan did not move the camera");
    const pannedX = context.camera.position.x;
    assert.ok(Math.abs(context.camera.position.z - startZ) < 1e-6, "edge pan drifted in z");

    // Cursor back in the middle: the camera holds still.
    context.pointer = { x: 0.5, y: 0.5 };
    session.update(1);
    assert.ok(Math.abs(context.camera.position.x - pannedX) < 1e-9);

    // Cursor off the canvas entirely: still no movement.
    context.pointer = null;
    session.update(1);
    assert.ok(Math.abs(context.camera.position.x - pannedX) < 1e-9);
    session.dispose();
  });

  check("rts mode: WASD pans it too, and the UI input mode freezes everything", () => {
    const context = new FakeGameModeContext();
    context.camera.position.set(0, 24, 24);
    context.camera.lookAt(0, 0, 0);
    const session = rtsCameraGameMode.createSession(context.asContext());
    session.spawnDefaultPawn();
    session.possess();
    const startZ = context.camera.position.z;

    context.hold("KeyW");
    session.update(1);
    assert.ok(context.camera.position.z < startZ - 1, "W did not pan the map forward");
    const held = context.camera.position.z;

    // A menu opens: the same held key must no longer move the camera.
    context.inputMode = "ui";
    session.update(1);
    assert.equal(context.camera.position.z, held);
    session.dispose();
  });

  check("rts mode: the wheel zooms, and zooming out speeds the pan up", () => {
    const context = new FakeGameModeContext();
    context.camera.position.set(0, 20, 20);
    context.camera.lookAt(0, 0, 0);
    const session = rtsCameraGameMode.createSession(context.asContext());
    session.spawnDefaultPawn();
    session.possess();
    const startHeight = context.camera.position.y;

    // Scroll away = zoom out: the camera climbs.
    context.wheel = 3;
    session.update(0.016);
    assert.ok(context.camera.position.y > startHeight, "wheel out did not raise the camera");
    const zoomedOut = context.camera.position.y;

    // Scroll back in: it drops again.
    context.wheel = -3;
    session.update(0.016);
    assert.ok(context.camera.position.y < zoomedOut, "wheel in did not lower the camera");

    // Same edge push, one second, at two zoom levels: the far one covers more ground.
    const travelAt = (notches: number): number => {
      context.wheel = notches;
      session.update(0.016);
      const before = context.camera.position.x;
      context.pointer = { x: 1, y: 0.5 };
      session.update(1);
      const travelled = context.camera.position.x - before;
      context.pointer = null;
      return travelled;
    };
    const nearTravel = travelAt(-100);
    const farTravel = travelAt(100);
    assert.ok(farTravel > nearTravel, "zoomed out must pan faster than zoomed in");
    session.dispose();
  });

  check("rts mode: a click selects the unit under the cursor, empty ground clears it", () => {
    const context = new FakeGameModeContext();
    context.camera.position.set(0, 20, 20);
    context.camera.lookAt(0, 0, 0);
    const session = rtsCameraGameMode.createSession(context.asContext());
    session.spawnDefaultPawn();
    session.possess();
    const unit = unitMesh("Unit");
    const originalMaterial = (unit as Mesh).material;

    // Click on the unit: the pick bridge is asked at the cursor, and the unit is
    // highlighted in place (a cloned material, so sibling copies stay untouched).
    context.pointer = { x: 0.25, y: 0.75 };
    context.pick = { entityId: "actor-7", object: unit, point: [0, 0, 0] };
    context.press("Mouse0");
    session.update(0.016);
    assert.deepEqual(context.pickedAt, { x: 0.25, y: 0.75 });
    assert.notEqual((unit as Mesh).material, originalMaterial, "the selected unit is not tinted");
    assert.match(session.getCameraDebug?.().cameraSource ?? "", /selected:actor-7/);

    // Click on empty ground: selection clears and the unit's own material returns.
    context.release("Mouse0");
    context.pick = null;
    context.press("Mouse0");
    session.update(0.016);
    assert.equal((unit as Mesh).material, originalMaterial);
    assert.match(session.getCameraDebug?.().cameraSource ?? "", /selected:none/);
    session.dispose();
  });

  check("rts selection: the highlight restores exactly what it replaced", () => {
    const highlight = new RtsSelectionHighlight();
    const unit = unitMesh("Unit");
    const material = (unit as Mesh).material;
    highlight.select("actor-1", unit);
    assert.equal(highlight.selectedEntityId, "actor-1");
    assert.notEqual((unit as Mesh).material, material);
    // Re-selecting the same entity is a no-op, not a second clone.
    const tinted = (unit as Mesh).material;
    highlight.select("actor-1", unit);
    assert.equal((unit as Mesh).material, tinted);
    highlight.clear();
    assert.equal(highlight.selectedEntityId, null);
    assert.equal((unit as Mesh).material, material);
  });
}
