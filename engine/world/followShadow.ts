export type FollowShadowVec3 = readonly [number, number, number];

export interface FollowShadowInput {
  /** Direction the light travels (light → scene); need not be unit length. */
  readonly lightDirection: FollowShadowVec3;
  /** World point the shadow frustum is centred on (e.g. ahead of the camera). */
  readonly focus: FollowShadowVec3;
  /** Half width/height of the orthographic shadow frustum, metres (> 0). */
  readonly halfExtent: number;
  /** Shadow map resolution in texels (> 0). */
  readonly mapSize: number;
  /** Distance from the focus toward the light that must still cast (>= 0). */
  readonly depthAbove: number;
  /** Distance past the focus away from the light that must still receive (>= 0). */
  readonly depthBelow: number;
}

export interface FollowShadowFrame {
  readonly position: FollowShadowVec3;
  readonly target: FollowShadowVec3;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
  /** World size of one shadow texel (2·halfExtent / mapSize). */
  readonly texelSize: number;
  readonly axisX: FollowShadowVec3;
  readonly axisY: FollowShadowVec3;
  readonly axisZ: FollowShadowVec3;
}

function dot(a: FollowShadowVec3, b: FollowShadowVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** `null` for non-finite input, a zero direction, non-positive extent/map size or negative depth. */
export function computeFollowShadowFrame(input: FollowShadowInput): FollowShadowFrame | null {
  const { lightDirection, focus, halfExtent, mapSize, depthAbove, depthBelow } = input;
  if (![...lightDirection, ...focus, halfExtent, mapSize, depthAbove, depthBelow].every(Number.isFinite)) return null;
  if (halfExtent <= 0 || mapSize <= 0 || depthAbove < 0 || depthBelow < 0) return null;
  const length = Math.hypot(...lightDirection);
  if (length === 0) return null;

  let zx = -lightDirection[0] / length;
  let zy = -lightDirection[1] / length;
  let zz = -lightDirection[2] / length;
  // Match Matrix4.lookAt with up = (0, 1, 0), including its parallel-up nudge.
  if (zx === 0 && zz === 0) {
    zz += 0.0001;
    const nudgedLength = Math.hypot(zx, zy, zz);
    zx /= nudgedLength;
    zy /= nudgedLength;
    zz /= nudgedLength;
  }
  const xLength = Math.hypot(zz, zx);
  const axisX: FollowShadowVec3 = [zz / xLength, 0, -zx / xLength];
  const axisY: FollowShadowVec3 = [zy * axisX[2], zz * axisX[0] - zx * axisX[2], -zy * axisX[0]];
  const axisZ: FollowShadowVec3 = [zx, zy, zz];

  const texelSize = 2 * halfExtent / mapSize;
  const sx = Math.round(dot(focus, axisX) / texelSize) * texelSize;
  const sy = Math.round(dot(focus, axisY) / texelSize) * texelSize;
  const sz = dot(focus, axisZ);
  const target: FollowShadowVec3 = [
    axisX[0] * sx + axisY[0] * sy + axisZ[0] * sz,
    axisX[1] * sx + axisY[1] * sy + axisZ[1] * sz,
    axisX[2] * sx + axisY[2] * sy + axisZ[2] * sz,
  ];
  const position: FollowShadowVec3 = [
    target[0] + axisZ[0] * depthAbove,
    target[1] + axisZ[1] * depthAbove,
    target[2] + axisZ[2] * depthAbove,
  ];
  return {
    position,
    target,
    left: -halfExtent,
    right: halfExtent,
    top: halfExtent,
    bottom: -halfExtent,
    near: 0,
    far: depthAbove + depthBelow,
    texelSize,
    axisX,
    axisY,
    axisZ,
  };
}
