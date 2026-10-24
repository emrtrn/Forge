import { PerspectiveCamera, Vector3 } from "three";

export interface CameraViewportOptions {
  width: number;
  height: number;
  target: Vector3;
  viewTouched: boolean;
}

/** Default scene camera far plane; leaves room to frame a multi-tile terrain from outside its bounds. */
export const SCENE_CAMERA_FAR = 2000;

export function createSceneCamera(): PerspectiveCamera {
  return new PerspectiveCamera(44, 1, 0.1, SCENE_CAMERA_FAR);
}

export function applyResponsiveCameraViewport(
  camera: PerspectiveCamera,
  options: CameraViewportOptions,
): boolean {
  const { width, height, target, viewTouched } = options;
  const portrait = height >= width;

  camera.aspect = width / height;
  camera.fov = portrait ? 42 : 46;
  if (!viewTouched) {
    camera.position.set(
      portrait ? 4.5 : 5.4,
      portrait ? 6.3 : 5.2,
      portrait ? 7.2 : 5.7,
    );
    camera.lookAt(target);
  }
  camera.updateProjectionMatrix();
  return !viewTouched;
}

/** Level view distance per camera (OPEN_WORLD_PLAN Faz 7); see {@link setCameraFarOverride}. */
const farOverrides = new WeakMap<PerspectiveCamera, { far: number; base: number }>();

/**
 * Pins a camera's far plane to the level's view distance, whatever far clip the
 * active view target asks for (Camera component, vehicle chase camera). `null`
 * hands the far plane back: the camera returns to the far it had before the
 * first override until a view target sets its own. Applies immediately.
 */
export function setCameraFarOverride(camera: PerspectiveCamera, far: number | null): void {
  const existing = farOverrides.get(camera);
  if (far === null) {
    if (!existing) return;
    farOverrides.delete(camera);
    far = existing.base;
  } else {
    farOverrides.set(camera, { far, base: existing?.base ?? camera.far });
  }
  if (camera.far !== far) {
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

/** The far plane pinned by {@link setCameraFarOverride}, if any. */
export function cameraFarOverride(camera: PerspectiveCamera): number | undefined {
  return farOverrides.get(camera)?.far;
}
