import { PerspectiveCamera, Vector3 } from "three";

export interface CameraViewportOptions {
  width: number;
  height: number;
  target: Vector3;
  viewTouched: boolean;
}

export function createSceneCamera(): PerspectiveCamera {
  // Leave room to frame a multi-tile terrain from outside its bounds.
  return new PerspectiveCamera(44, 1, 0.1, 2000);
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
