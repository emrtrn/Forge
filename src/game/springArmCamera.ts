import type { CameraComponent, SpringArmComponent } from "@engine/scene/components";
import type { Aabb3 } from "@engine/movement/characterCollision";
import { lerpVec3, type FollowCameraPose, type Vec3 } from "./followCamera";
import { forwardFromLookAngles, type LookAngles } from "./gameModes/cameraControl";

export interface SpringArmCameraPoseInput {
  readonly playerPosition: Vec3;
  readonly springArm: SpringArmComponent;
  readonly controlRotation: LookAngles;
  readonly blockers?: readonly Aabb3[];
}

export interface CameraProjectionConfig {
  readonly fov: number;
  readonly near: number;
  readonly far: number;
}

export const DEFAULT_CAMERA_PROJECTION: CameraProjectionConfig = {
  fov: 44,
  near: 0.1,
  far: 100,
};

/** Resolves the desired third-person camera pose from authored SpringArm data. */
export function desiredSpringArmCameraPose(input: SpringArmCameraPoseInput): FollowCameraPose {
  const { playerPosition, springArm, controlRotation } = input;
  const forward = forwardFromLookAngles(controlRotation);
  const right = rightFromForward(forward.x, forward.z);
  const pivot: Vec3 = [
    playerPosition[0] + springArm.targetOffset[0],
    playerPosition[1] + springArm.targetOffset[1],
    playerPosition[2] + springArm.targetOffset[2],
  ];
  const socket = springArm.socketOffset;
  const position: Vec3 = [
    pivot[0] - forward.x * springArm.targetArmLength + right[0] * socket[0] + socket[2] * forward.x,
    pivot[1] - forward.y * springArm.targetArmLength + socket[1] + socket[2] * forward.y,
    pivot[2] - forward.z * springArm.targetArmLength + right[1] * socket[0] + socket[2] * forward.z,
  ];
  return {
    position:
      springArm.doCollisionTest && input.blockers
        ? resolveSpringArmCollision(pivot, position, input.blockers)
        : position,
    target: pivot,
  };
}

/**
 * Pulls the spring-arm socket toward the pivot when the boom segment enters a
 * static blocker. This is a pure line-vs-AABB probe: collider shapes are already
 * represented by the physics subsystem's broad-phase AABBs.
 */
export function resolveSpringArmCollision(
  pivot: Vec3,
  desiredPosition: Vec3,
  blockers: readonly Aabb3[],
  padding = 0.05,
): Vec3 {
  const dir: Vec3 = [
    desiredPosition[0] - pivot[0],
    desiredPosition[1] - pivot[1],
    desiredPosition[2] - pivot[2],
  ];
  const length = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(length > 1e-6)) return desiredPosition;

  let nearest = 1;
  for (const blocker of blockers) {
    const hit = segmentAabbEntry(pivot, dir, blocker);
    if (hit === null || hit <= 1e-6) continue;
    nearest = Math.min(nearest, hit);
  }
  if (nearest >= 1) return desiredPosition;

  const t = Math.max(0, nearest - Math.max(0, padding) / length);
  return [pivot[0] + dir[0] * t, pivot[1] + dir[1] * t, pivot[2] + dir[2] * t];
}

/** Advances a spring-arm camera pose, honoring the component's camera lag flag. */
export function stepSpringArmCameraPose(
  prev: FollowCameraPose | null,
  desired: FollowCameraPose,
  t: number,
): FollowCameraPose {
  if (!prev) return desired;
  return {
    position: lerpVec3(prev.position, desired.position, t),
    target: lerpVec3(prev.target, desired.target, t),
  };
}

/** Maps an authored Camera component to the live PerspectiveCamera projection. */
export function cameraProjectionFromComponent(
  camera: CameraComponent | undefined,
): CameraProjectionConfig {
  if (!camera || camera.isOrthographic) return DEFAULT_CAMERA_PROJECTION;
  return {
    fov: camera.fieldOfView,
    near: camera.nearClip,
    far: camera.farClip,
  };
}

function rightFromForward(forwardX: number, forwardZ: number): [number, number] {
  const length = Math.hypot(forwardX, forwardZ);
  if (length <= 1e-6) return [1, 0];
  const fx = forwardX / length;
  const fz = forwardZ / length;
  return [-fz, fx];
}

function segmentAabbEntry(origin: Vec3, dir: Vec3, aabb: Aabb3): number | null {
  let tMin = 0;
  let tMax = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis] ?? 0;
    const d = dir[axis] ?? 0;
    const min = aabb.min[axis] ?? 0;
    const max = aabb.max[axis] ?? 0;
    if (Math.abs(d) <= 1e-9) {
      if (o < min || o > max) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (min - o) * inv;
    let t2 = (max - o) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}
