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
const farOverrides = new WeakMap<PerspectiveCamera, { far: number; nearMin: number; base: { far: number; near: number } }>();

/**
 * Pins a camera's far plane to the level's view distance, whatever far clip a
 * gameplay camera manager's view target asks for (Camera component, vehicle
 * chase camera). `nearMin` raises the near plane to at least that value — the
 * far view mode's depth-precision fallback without reversed-Z. `null` hands the
 * clip planes back: the camera returns to the far/near it had before the first
 * override until a view target sets its own. Applies immediately.
 */
export function setCameraFarOverride(
  camera: PerspectiveCamera,
  far: number | null,
  options: { nearMin?: number } = {},
): void {
  const existing = farOverrides.get(camera);
  let near: number;
  if (far === null) {
    if (!existing) return;
    farOverrides.delete(camera);
    far = existing.base.far;
    near = existing.base.near;
  } else {
    const nearMin = options.nearMin ?? 0;
    const base = existing?.base ?? { far: camera.far, near: camera.near };
    farOverrides.set(camera, { far, nearMin, base });
    near = Math.max(existing ? base.near : camera.near, nearMin);
  }
  if (camera.far !== far || camera.near !== near) {
    camera.far = far;
    camera.near = near;
    camera.updateProjectionMatrix();
  }
}

/** The far plane pinned by {@link setCameraFarOverride}, if any. */
export function cameraFarOverride(camera: PerspectiveCamera): number | undefined {
  return farOverrides.get(camera)?.far;
}

/** The smallest near plane {@link setCameraFarOverride} allows (0 without an override). */
export function cameraNearMin(camera: PerspectiveCamera): number {
  return farOverrides.get(camera)?.nearMin ?? 0;
}
