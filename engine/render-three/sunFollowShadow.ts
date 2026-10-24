import { Vector3, type DirectionalLight } from "three";

import { computeFollowShadowFrame } from "@engine/world/followShadow";
import { shadowDepthBias } from "./depthMode";

/**
 * Camera-following sun shadow for far view mode (OPEN_WORLD_PLAN Faz 7c1). The
 * bounds fit (`fitDirectionalShadowToBounds`) parks the frustum at the sun's
 * authored position, so an open world either spreads one map over kilometres or
 * loses shadows away from it. Here the frustum is re-centred ahead of the camera
 * every frame, snapped to whole texels in light space so it does not shimmer.
 */

/** Half width of the follow shadow frustum before the quality `shadowDistanceScale`. */
export const FOLLOW_SHADOW_HALF_EXTENT = 60;
/** Reach toward and away from the light around the focus (metres). */
export const FOLLOW_SHADOW_DEPTH = 150;
/**
 * World-space depth bias. three's bias is in shadow-depth units, i.e. scaled by
 * the frustum's depth range; the bounds fit's ~40 m range made 0.0005 about 2 cm,
 * which this keeps for the follow frustum's longer range.
 */
const FOLLOW_SHADOW_BIAS_METERS = 0.02;
/** How far ahead of the camera (× half extent) the frustum is centred. */
const FOLLOW_SHADOW_LEAD = 0.5;

const lightWorld = new Vector3();
const targetWorld = new Vector3();
const forward = new Vector3();

/**
 * Re-centres `sun`'s shadow frustum on a point ahead of `cameraPosition` along
 * the horizontal `cameraForward`. Moves the light and its target together along
 * the light direction, so the lighting direction is unchanged. Returns false
 * (and leaves the light alone) when the light has no usable direction.
 */
export function updateSunFollowShadow(
  sun: DirectionalLight,
  cameraPosition: Vector3,
  cameraForward: Vector3,
  options: { halfExtent: number },
): boolean {
  sun.updateWorldMatrix(true, false);
  sun.target.updateWorldMatrix(true, false);
  sun.getWorldPosition(lightWorld);
  sun.target.getWorldPosition(targetWorld);
  forward.set(cameraForward.x, 0, cameraForward.z);
  if (forward.lengthSq() > 1e-8) forward.normalize();
  const focus = forward.multiplyScalar(options.halfExtent * FOLLOW_SHADOW_LEAD).add(cameraPosition);
  const frame = computeFollowShadowFrame({
    lightDirection: [targetWorld.x - lightWorld.x, targetWorld.y - lightWorld.y, targetWorld.z - lightWorld.z],
    focus: [focus.x, focus.y, focus.z],
    halfExtent: options.halfExtent,
    mapSize: sun.shadow.mapSize.width,
    depthAbove: FOLLOW_SHADOW_DEPTH,
    depthBelow: FOLLOW_SHADOW_DEPTH,
  });
  if (!frame) return false;

  setWorldPosition(sun, frame.position);
  setWorldPosition(sun.target, frame.target);
  const camera = sun.shadow.camera;
  camera.left = frame.left;
  camera.right = frame.right;
  camera.top = frame.top;
  camera.bottom = frame.bottom;
  camera.near = frame.near;
  camera.far = frame.far;
  camera.updateProjectionMatrix();
  sun.shadow.bias = Math.sign(shadowDepthBias()) * (FOLLOW_SHADOW_BIAS_METERS / frame.far);
  return true;
}

function setWorldPosition(object: DirectionalLight | DirectionalLight["target"], world: readonly [number, number, number]): void {
  const position = lightWorld.set(world[0], world[1], world[2]);
  if (object.parent) object.parent.worldToLocal(position);
  object.position.copy(position);
  object.updateMatrixWorld(true);
}
