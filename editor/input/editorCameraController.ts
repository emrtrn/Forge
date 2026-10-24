import { Vector3 } from "three";
import type { Camera, OrthographicCamera, PerspectiveCamera } from "three";

import { clamp } from "@editor/core/numeric";

const CAMERA_MOVE_SPEED = 5.5;
const CAMERA_MIN_MOVE_SPEED = 0.8;
const CAMERA_MAX_MOVE_SPEED = 100;
const CAMERA_LOOK_SENSITIVITY = 0.003;
const CAMERA_PITCH_LIMIT = Math.PI * 0.47;
const CAMERA_ORBIT_SENSITIVITY = 0.006;
const CAMERA_PAN_SENSITIVITY = 0.0025;
const CAMERA_DOLLY_SENSITIVITY = 0.018;

type CameraDrag =
  | {
      mode: "orbit";
      pointerId: number;
      target: Vector3;
      distance: number;
    }
  | {
      mode: "pan";
      pointerId: number;
    }
  | {
      mode: "dolly";
      pointerId: number;
    };

type StatusTone = "info" | "success" | "warning" | "error";

export interface EditorCameraControllerOptions {
  camera: () => PerspectiveCamera | OrthographicCamera;
  canvas: HTMLCanvasElement;
  /** Selection-aware orbit/pan focus point, with a viewport-distance fallback. */
  getOrbitTarget: () => Vector3;
  /** Called when a camera gesture begins so the editor can cancel a pending
   *  gizmo drag or asset placement. */
  onInteractionStart: () => void;
  onStatus?: (message: string, tone?: StatusTone) => void;
}

/**
 * Editor viewport camera: WASD/QE fly navigation plus orbit/pan/dolly drags and
 * wheel dolly/speed. Owns all camera-navigation state; operates on the shared
 * `SceneApp` camera passed in. Editor-only — never reached by the game runtime.
 */
export class EditorCameraController {
  private readonly getCamera: () => PerspectiveCamera | OrthographicCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly getOrbitTarget: () => Vector3;
  private readonly onInteractionStart: () => void;
  private readonly onStatus: ((message: string, tone?: StatusTone) => void) | undefined;

  private readonly pressedKeys = new Set<string>();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly move = new Vector3();
  private navigationActive = false;
  private viewTouched = false;
  private navigationPointer: number | null = null;
  private yaw = 0;
  private pitch = 0;
  private moveSpeed = CAMERA_MOVE_SPEED;
  private drag: CameraDrag | null = null;

  constructor(options: EditorCameraControllerOptions) {
    this.getCamera = options.camera;
    this.canvas = options.canvas;
    this.getOrbitTarget = options.getOrbitTarget;
    this.onInteractionStart = options.onInteractionStart;
    this.onStatus = options.onStatus;
  }

  /** True while WASD fly navigation is engaged. */
  get isNavigating(): boolean {
    return this.navigationActive;
  }

  /** True while an orbit/pan/dolly pointer drag is in progress. */
  get isDragging(): boolean {
    return this.drag !== null;
  }

  /** True during any camera gesture; used to suppress gizmo hover. */
  get isInteracting(): boolean {
    return this.navigationActive || this.drag !== null;
  }

  /** Whether the user has moved the camera (suppresses resize re-framing). */
  get hasTouched(): boolean {
    return this.viewTouched;
  }

  get navigationPointerId(): number | null {
    return this.navigationPointer;
  }

  get dragPointerId(): number | null {
    return this.drag?.pointerId ?? null;
  }

  addPressedKey(code: string): void {
    this.pressedKeys.add(code);
  }

  deletePressedKey(code: string): void {
    this.pressedKeys.delete(code);
  }

  /** Marks the camera as user-positioned (e.g. after focus/technical-view). */
  markViewChanged(): void {
    this.viewTouched = true;
  }

  beginNavigation(event: PointerEvent): void {
    event.preventDefault();
    const camera = this.getCamera();
    if (isOrthographicCamera(camera)) {
      this.onStatus?.("Orthographic view: use pan and zoom.", "info");
      return;
    }
    this.navigationActive = true;
    this.viewTouched = true;
    this.navigationPointer = event.pointerId;
    camera.up.set(0, 1, 0);
    this.drag = null;
    this.onInteractionStart();
    this.canvas.style.cursor = "none";
    this.onStatus?.("Camera navigation");
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic tests and a few browser edge cases can reject capture.
    }
  }

  endNavigation(event: PointerEvent): void {
    this.navigationActive = false;
    this.navigationPointer = null;
    this.pressedKeys.clear();
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Matching beginNavigation: capture may not exist for synthetic events.
    }
    this.canvas.style.cursor = "";
  }

  beginAltDrag(event: PointerEvent): boolean {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return false;
    event.preventDefault();
    this.viewTouched = true;
    this.drag = null;
    this.onInteractionStart();
    const camera = this.getCamera();

    if (event.button === 0) {
      if (isOrthographicCamera(camera)) {
        this.drag = { mode: "pan", pointerId: event.pointerId };
        this.canvas.style.cursor = "move";
        this.onStatus?.("Camera pan");
      } else {
        camera.up.set(0, 1, 0);
        const target = this.getOrbitTarget();
        this.drag = {
          mode: "orbit",
          pointerId: event.pointerId,
          target,
          distance: Math.max(0.3, camera.position.distanceTo(target)),
        };
        this.canvas.style.cursor = "grabbing";
        this.onStatus?.("Camera orbit");
      }
    } else if (event.button === 1) {
      this.drag = { mode: "pan", pointerId: event.pointerId };
      this.canvas.style.cursor = "move";
      this.onStatus?.("Camera pan");
    } else {
      if (!isOrthographicCamera(camera)) camera.up.set(0, 1, 0);
      this.drag = { mode: "dolly", pointerId: event.pointerId };
      this.canvas.style.cursor = "ns-resize";
      this.onStatus?.(isOrthographicCamera(camera) ? "Camera zoom" : "Camera dolly");
    }

    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be unavailable in synthetic events.
    }
    return true;
  }

  updateDrag(event: PointerEvent): void {
    if (!this.drag) return;
    event.preventDefault();
    this.viewTouched = true;
    const camera = this.getCamera();

    if (this.drag.mode === "orbit") {
      this.yaw -= event.movementX * CAMERA_ORBIT_SENSITIVITY;
      this.pitch = clamp(
        this.pitch - event.movementY * CAMERA_ORBIT_SENSITIVITY,
        -CAMERA_PITCH_LIMIT,
        CAMERA_PITCH_LIMIT,
      );
      const lookDirection = this.lookDirection();
      camera.position
        .copy(this.drag.target)
        .addScaledVector(lookDirection, -this.drag.distance);
      camera.lookAt(this.drag.target);
      this.syncAnglesFromCurrentView();
      return;
    }

    if (this.drag.mode === "pan") {
      const distanceScale = isOrthographicCamera(camera)
        ? orthographicViewHeight(camera)
        : Math.max(1, this.getOrbitTarget().distanceTo(camera.position));
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      camera.position
        .addScaledVector(right, -event.movementX * CAMERA_PAN_SENSITIVITY * distanceScale)
        .addScaledVector(up, event.movementY * CAMERA_PAN_SENSITIVITY * distanceScale);
      return;
    }

    this.dolly(event.movementY * CAMERA_DOLLY_SENSITIVITY);
  }

  endDrag(event: PointerEvent): void {
    this.drag = null;
    this.syncAnglesFromCurrentView();
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be gone.
    }
    this.canvas.style.cursor = "";
  }

  handleWheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.navigationActive) {
      this.adjustMoveSpeed(event.deltaY);
      return;
    }

    this.viewTouched = true;
    this.dolly(event.deltaY * CAMERA_DOLLY_SENSITIVITY);
  }

  updateLook(movementX: number, movementY: number): void {
    if (isOrthographicCamera(this.getCamera())) return;
    this.yaw -= movementX * CAMERA_LOOK_SENSITIVITY;
    this.pitch = clamp(
      this.pitch - movementY * CAMERA_LOOK_SENSITIVITY,
      -CAMERA_PITCH_LIMIT,
      CAMERA_PITCH_LIMIT,
    );
    this.applyOrientation();
  }

  /** Per-frame WASD/QE fly movement; call from the render loop. */
  update(deltaSeconds: number): void {
    if (!this.navigationActive || this.pressedKeys.size === 0) return;
    const camera = this.getCamera();

    this.computeBasis();
    this.move.set(0, 0, 0);

    if (this.pressedKeys.has("KeyW")) this.move.add(this.forward);
    if (this.pressedKeys.has("KeyS")) this.move.sub(this.forward);
    if (this.pressedKeys.has("KeyD")) this.move.add(this.right);
    if (this.pressedKeys.has("KeyA")) this.move.sub(this.right);
    if (this.pressedKeys.has("KeyE")) this.move.y += 1;
    if (this.pressedKeys.has("KeyQ")) this.move.y -= 1;

    if (this.move.lengthSq() === 0) return;
    this.move.normalize().multiplyScalar(this.moveSpeed * deltaSeconds);
    camera.position.add(this.move);
  }

  /** Re-derives yaw/pitch from the current camera orientation. */
  syncAnglesFromCurrentView(): void {
    const direction = new Vector3();
    this.getCamera().getWorldDirection(direction);
    this.yaw = Math.atan2(-direction.x, -direction.z);
    this.pitch = Math.asin(clamp(direction.y, -1, 1));
  }

  private lookDirection(): Vector3 {
    return new Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
  }

  private dolly(amount: number): void {
    const camera = this.getCamera();
    if (isOrthographicCamera(camera)) {
      const factor = amount < 0 ? 1.1 : 1 / 1.1;
      camera.zoom = clamp(camera.zoom * factor, 0.05, 20);
      camera.updateProjectionMatrix();
      return;
    }
    const direction = new Vector3();
    camera.getWorldDirection(direction);
    if (direction.lengthSq() === 0) return;
    camera.position.addScaledVector(direction.normalize(), -amount);
  }

  private adjustMoveSpeed(deltaY: number): void {
    const factor = deltaY < 0 ? 1.15 : 1 / 1.15;
    this.moveSpeed = clamp(this.moveSpeed * factor, CAMERA_MIN_MOVE_SPEED, CAMERA_MAX_MOVE_SPEED);
    this.onStatus?.(`Camera speed ${this.moveSpeed.toFixed(1)}`, "info");
  }

  private computeBasis(): void {
    const camera = this.getCamera();
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() === 0) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.crossVectors(this.forward, camera.up).normalize();
  }

  private applyOrientation(): void {
    const camera = this.getCamera();
    camera.up.set(0, 1, 0);
    const lookDirection = new Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    camera.lookAt(camera.position.clone().add(lookDirection));
  }
}

function isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
  return (camera as OrthographicCamera).isOrthographicCamera === true;
}

function orthographicViewHeight(camera: OrthographicCamera): number {
  return (camera.top - camera.bottom) / Math.max(camera.zoom, 0.01);
}
