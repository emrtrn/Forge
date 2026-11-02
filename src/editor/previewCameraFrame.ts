import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

/** Frame an authoring preview at any world scale, preserving its current viewing axis and north. */
export function framePreviewCamera(camera: PerspectiveCamera | OrthographicCamera, bounds: Box3, aspect: number): number | null {
  if (bounds.isEmpty()) return null;
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("Preview viewport aspect must be positive");
  const target = bounds.getCenter(new Vector3());
  const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 1);
  const direction = camera.getWorldDirection(new Vector3());
  let height: number | null = null;
  let distance: number;
  if (camera instanceof OrthographicCamera) {
    // A sphere fits both portrait and landscape viewports; no small-room 80 m ceiling.
    height = Math.max(3, radius * 2.4, radius * 2.4 / aspect);
    camera.zoom = 1;
    camera.top = height / 2; camera.bottom = -height / 2;
    camera.left = -height * aspect / 2; camera.right = height * aspect / 2;
    distance = radius * 1.8;
  } else {
    camera.aspect = aspect;
    const halfFov = camera.getEffectiveFOV() * Math.PI / 360;
    const narrowHalfFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect));
    distance = radius / Math.sin(narrowHalfFov) * 1.2;
  }
  distance = Math.max(distance, camera.near + radius * 1.2);
  camera.far = Math.max(camera.far, distance + radius * 1.5);
  camera.position.copy(target).addScaledVector(direction, -distance);
  // In Top view up is -Z; replacing it with +Y makes lookAt degenerate.
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return height;
}
