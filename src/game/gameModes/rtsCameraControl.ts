/**
 * Pure, headless-testable math for a top-down strategy camera. No Three.js and
 * no DOM: the RTS Game Mode feeds in the pointer position, the held movement
 * actions and the wheel notches, and gets back a focus delta, an orbit distance
 * and a camera placement.
 *
 * Sibling of {@link cameraControl}, which serves the first/third-person modes.
 * The split is deliberate: an RTS camera does not orbit from a look delta at
 * all — it holds a fixed compass heading and tilt, slides a *ground focus point*
 * around, and moves the camera as a rigid offset from it. Keeping that in its
 * own module means the shared camera math never grows RTS special cases.
 *
 * Axis convention matches the rest of the engine: yaw 0 looks toward -z, and
 * screen-right is 90° clockwise of the facing seen from above.
 */

const DEG_TO_RAD = Math.PI / 180;

/** Tuning for one RTS camera. A fork overrides any field it wants. */
export interface RtsCameraSettings {
  /** Fixed compass heading, in degrees. The camera never turns by itself. */
  readonly yawDeg: number;
  /** Downward tilt, in degrees (90 = straight down). */
  readonly pitchDeg: number;
  /** Closest the camera may zoom to its focus point. */
  readonly minDistance: number;
  /** Furthest the camera may zoom out. */
  readonly maxDistance: number;
  /** Fraction of the distance one wheel notch adds/removes. */
  readonly zoomPerNotch: number;
  /** Screen-edge band that pans, as a fraction of the viewport (0 disables). */
  readonly edgeMargin: number;
  /** Pan speed (units/s) fully zoomed in. */
  readonly panSpeedNear: number;
  /** Pan speed (units/s) fully zoomed out — the map is bigger up there. */
  readonly panSpeedFar: number;
}

export const DEFAULT_RTS_CAMERA_SETTINGS: RtsCameraSettings = {
  yawDeg: 0,
  pitchDeg: 55,
  minDistance: 10,
  maxDistance: 60,
  zoomPerNotch: 0.15,
  edgeMargin: 0.04,
  panSpeedNear: 14,
  panSpeedFar: 45,
};

/** Analog pan intent. `forward` runs away from the camera, `right` screen-right. */
export interface RtsPanIntent {
  readonly forward: number;
  readonly right: number;
}

/** Which planar movement actions are held this tick. */
export interface RtsKeyInput {
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

const NO_INTENT: RtsPanIntent = { forward: 0, right: 0 };

function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/** How far into an edge band a coordinate sits, as a 0..1 ramp. */
function edgeRamp(distanceIntoBand: number, margin: number): number {
  if (!(margin > 0)) return 0;
  const ratio = (margin - distanceIntoBand) / margin;
  return ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
}

/**
 * Edge-pan intent from a normalized pointer position ([0,1] from the canvas'
 * top-left), or no intent when the pointer is off the canvas — a pointer that
 * left the window must stop the camera, not pan forever on its last sample.
 * The push ramps up across the margin band instead of switching on, so the
 * camera eases into motion the way a player expects.
 */
export function edgePanIntent(
  pointer: { readonly x: number; readonly y: number } | null,
  margin: number,
): RtsPanIntent {
  if (!pointer) return NO_INTENT;
  const { x, y } = pointer;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NO_INTENT;
  // Screen top pushes the focus away from the camera; the left edge pushes it
  // screen-left. Coordinates outside [0,1] saturate through the same ramp.
  const forward = edgeRamp(y, margin) - edgeRamp(1 - y, margin);
  const right = edgeRamp(1 - x, margin) - edgeRamp(x, margin);
  return { forward, right };
}

/** Keyboard pan intent: the same four directions, at full push. */
export function keyPanIntent(keys: RtsKeyInput): RtsPanIntent {
  return {
    forward: (keys.forward ? 1 : 0) - (keys.back ? 1 : 0),
    right: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
  };
}

/** Sum of two intents, per axis, clamped so keys + edge cannot double the speed. */
export function combinePanIntent(a: RtsPanIntent, b: RtsPanIntent): RtsPanIntent {
  return {
    forward: clampUnit(a.forward + b.forward),
    right: clampUnit(a.right + b.right),
  };
}

/**
 * Pan speed at an orbit distance, interpolated between the near and far speeds.
 * Zoomed out the camera covers more ground per second, which is what keeps a
 * strategy map from feeling glued at one zoom level and sluggish at the other.
 */
export function panSpeedForDistance(settings: RtsCameraSettings, distance: number): number {
  const { minDistance, maxDistance, panSpeedNear, panSpeedFar } = settings;
  const span = maxDistance - minDistance;
  if (!(span > 0)) return panSpeedNear;
  const t = (distance - minDistance) / span;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return panSpeedNear + (panSpeedFar - panSpeedNear) * clamped;
}

/** World-space focus delta (`dy` is always 0 — the focus rides the ground). */
export interface RtsPanStep {
  readonly dx: number;
  readonly dz: number;
}

/**
 * Turns a pan intent into a world-space focus delta for one tick. Diagonals are
 * normalized, so panning corner-wards is not faster than panning straight; a
 * zero intent, speed or dt yields no movement.
 */
export function rtsPanStep(
  intent: RtsPanIntent,
  yawDeg: number,
  speed: number,
  dt: number,
): RtsPanStep {
  const magnitude = Math.hypot(intent.forward, intent.right);
  if (magnitude === 0) return { dx: 0, dz: 0 };
  const distance = speed * dt;
  if (!(distance > 0)) return { dx: 0, dz: 0 };

  const yaw = yawDeg * DEG_TO_RAD;
  // Ground facing for this heading (yaw 0 -> -z), and screen-right beside it.
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;

  const scale = distance / (magnitude > 1 ? magnitude : 1);
  return {
    dx: (fx * intent.forward + rx * intent.right) * scale,
    dz: (fz * intent.forward + rz * intent.right) * scale,
  };
}

/**
 * New orbit distance after `notches` of wheel travel (positive = scrolled away
 * = zoom out), always inside the settings' range. Multiplicative, so one notch
 * feels the same close up and far out.
 */
export function zoomDistance(
  distance: number,
  notches: number,
  settings: RtsCameraSettings,
): number {
  const { minDistance, maxDistance, zoomPerNotch } = settings;
  const base = Number.isFinite(distance) ? distance : minDistance;
  const scaled = Number.isFinite(notches)
    ? base * Math.pow(1 + zoomPerNotch, notches)
    : base;
  return scaled < minDistance ? minDistance : scaled > maxDistance ? maxDistance : scaled;
}

export interface RtsPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where the camera sits for a ground focus point at an orbit distance: behind
 * the focus along the fixed heading, raised by the fixed tilt. The camera then
 * simply looks at the focus.
 */
export function rtsCameraPosition(
  focus: RtsPoint,
  distance: number,
  settings: RtsCameraSettings,
): RtsPoint {
  const yaw = settings.yawDeg * DEG_TO_RAD;
  const pitch = settings.pitchDeg * DEG_TO_RAD;
  const horizontal = distance * Math.cos(pitch);
  // Backwards along the heading (the inverse of the ground facing above).
  return {
    x: focus.x + Math.sin(yaw) * horizontal,
    y: focus.y + distance * Math.sin(pitch),
    z: focus.z + Math.cos(yaw) * horizontal,
  };
}

/**
 * Ground point a camera currently looks at, by intersecting its view ray with
 * the `groundY` plane. Returns null when the camera looks up, along the plane,
 * or is already below it — the caller then falls back to the camera's own XZ,
 * which keeps a badly framed boot pose from throwing the focus to infinity.
 */
export function groundFocusFromCamera(
  position: RtsPoint,
  forward: RtsPoint,
  groundY = 0,
): RtsPoint | null {
  if (!(forward.y < -1e-4)) return null;
  const t = (groundY - position.y) / forward.y;
  if (!(t > 0) || !Number.isFinite(t)) return null;
  return {
    x: position.x + forward.x * t,
    y: groundY,
    z: position.z + forward.z * t,
  };
}
