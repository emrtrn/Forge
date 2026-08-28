import { AnimationClip, Matrix4, PropertyBinding, Quaternion, Vector3 } from "three";
import type { KeyframeTrack, Object3D } from "three";

/**
 * Per-clip root motion policy.
 *
 * - `preserve`: play the clip as authored (no record is stored for it).
 * - `lockXZ`: pin the root's two horizontal components, keep the vertical one,
 *   so jump arcs and walk bob survive while forward drift is removed.
 * - `lockXYZ`: pin all three, fully in place.
 * - `driveMotion`: the clip's travel is meant to be driven by gameplay (the
 *   collision capsule follows the animation). Playback is left untouched today;
 *   the mode records the intent and makes the measured displacement available
 *   through `rootMotionClipDisplacement` so gameplay code has the real number
 *   instead of a hard-coded guess.
 */
export const ROOT_MOTION_MODES = ["preserve", "lockXZ", "lockXYZ", "driveMotion"] as const;
export type RootMotionMode = (typeof ROOT_MOTION_MODES)[number];

/** Which component of the root's *local* position track points up. */
export const ROOT_MOTION_UP_AXES = ["x", "y", "z"] as const;
export type RootMotionUpAxis = (typeof ROOT_MOTION_UP_AXES)[number];

export interface RootMotionClipSetting {
  readonly clip: string;
  readonly mode: RootMotionMode;
  readonly rootNode?: string;
  /** Overrides the auto-detected vertical axis; see `resolveRootMotionUpAxis`. */
  readonly upAxis?: RootMotionUpAxis;
}

const ROOT_NODE_CANDIDATES = [
  "Root",
  "root",
  "Armature",
  "armature",
  "Hips",
  "hips",
  "mixamorigHips",
  "mixamorig:Hips",
];

const UP_AXIS_INDEX: Record<RootMotionUpAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

export function applyRootMotionToClips(
  clips: readonly AnimationClip[],
  settings: readonly RootMotionClipSetting[] | undefined,
  root?: Object3D,
): AnimationClip[] {
  return clips.map((clip) =>
    applyRootMotionToClip(clip, rootMotionSettingForClip(settings, clip.name), root),
  );
}

export function applyRootMotionToClip(
  clip: AnimationClip,
  setting: RootMotionClipSetting | undefined,
  root?: Object3D,
): AnimationClip {
  if (!setting || setting.clip !== clip.name) return clip;
  if (setting.mode === "preserve" || setting.mode === "driveMotion") return clip;
  const mode: Exclude<RootMotionMode, "preserve" | "driveMotion"> =
    setting.mode === "lockXYZ" ? "lockXYZ" : "lockXZ";
  const rootNode = resolveRootMotionNode(clip, setting.rootNode);
  if (!rootNode) return clip;
  const upIndex = UP_AXIS_INDEX[resolveRootMotionUpAxis(rootNode, setting.upAxis, root)];
  let changed = false;
  const tracks = clip.tracks.map((track) => {
    const parsed = PropertyBinding.parseTrackName(track.name);
    if (parsed.nodeName !== rootNode || parsed.propertyName !== "position") return track;
    const next = lockPositionTrack(track, mode, upIndex);
    changed ||= next !== track;
    return next;
  });
  return changed ? new AnimationClip(clip.name, clip.duration, tracks) : clip;
}

export function rootMotionSettingForClip(
  settings: readonly RootMotionClipSetting[] | undefined,
  clipName: string,
): RootMotionClipSetting | undefined {
  return settings?.find((setting) => setting.clip === clipName);
}

export function rootMotionPositionNodes(clip: AnimationClip): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const track of clip.tracks) {
    const parsed = PropertyBinding.parseTrackName(track.name);
    if (parsed.propertyName !== "position" || !parsed.nodeName || seen.has(parsed.nodeName)) continue;
    seen.add(parsed.nodeName);
    names.push(parsed.nodeName);
  }
  return names;
}

/**
 * The root's position track lives in its *parent's* local space, which is not
 * necessarily Y-up: a Z-up rig converted on export (Mixamo/Blender) carries the
 * conversion on an intermediate node, so the track's "up" ends up on Z and its
 * forward travel on Y. Assuming index 1 is vertical silently locks the wrong
 * pair - it strips the jump height and leaves the forward drift running.
 *
 * So walk the chain from the animated node's parent up to (excluding) the model
 * root and ask which local axis lands closest to the root's own up.
 */
export function resolveRootMotionUpAxis(
  nodeName: string,
  authored: RootMotionUpAxis | undefined,
  root: Object3D | undefined,
): RootMotionUpAxis {
  if (authored) return authored;
  if (!root) return "y";
  const node = findAnimatedNode(root, nodeName);
  const parent = node?.parent;
  if (!parent) return "y";
  const rotation = new Quaternion();
  for (let current: Object3D | null = parent; current && current !== root; current = current.parent) {
    rotation.premultiply(current.quaternion);
  }
  const mapped = new Vector3();
  let bestAxis: RootMotionUpAxis = "y";
  let bestDot = -1;
  for (let axis = 0; axis < 3; axis += 1) {
    mapped.set(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0).applyQuaternion(rotation);
    const dot = Math.abs(mapped.y);
    if (dot > bestDot) {
      bestDot = dot;
      bestAxis = ROOT_MOTION_UP_AXES[axis] ?? "y";
    }
  }
  return bestAxis;
}

/**
 * Net travel of the clip's root node, in world units, from its first key to its
 * last. This is the number a `driveMotion` clip owes gameplay: how far the
 * capsule must move while the clip plays.
 */
export function rootMotionClipDisplacement(
  clip: AnimationClip,
  setting: RootMotionClipSetting | undefined,
  root?: Object3D,
): Vector3 | null {
  const rootNode = resolveRootMotionNode(clip, setting?.rootNode);
  if (!rootNode) return null;
  const track = clip.tracks.find((item) => {
    const parsed = PropertyBinding.parseTrackName(item.name);
    return parsed.nodeName === rootNode && parsed.propertyName === "position";
  });
  if (!track) return null;
  const stride = positionStride(track);
  if (!stride) return null;
  const valueOffset = stride === 9 ? 3 : 0;
  const values = track.values;
  const last = values.length - stride + valueOffset;
  const delta = new Vector3(
    Number(values[last] ?? 0) - Number(values[valueOffset] ?? 0),
    Number(values[last + 1] ?? 0) - Number(values[valueOffset + 1] ?? 0),
    Number(values[last + 2] ?? 0) - Number(values[valueOffset + 2] ?? 0),
  );
  const parent = root ? findAnimatedNode(root, rootNode)?.parent : null;
  if (!parent) return delta;
  // The track is in parent-local units; the parent's rotation + scale (but not
  // its translation) take it to world, the space a controller moves a capsule in.
  parent.updateWorldMatrix(true, false);
  const linear = new Matrix4().copy(parent.matrixWorld).setPosition(0, 0, 0);
  return delta.applyMatrix4(linear);
}

function findAnimatedNode(root: Object3D, nodeName: string): Object3D | null {
  const direct = root.getObjectByName(nodeName);
  if (direct) return direct;
  // GLTFLoader sanitizes node names (`mixamorig:Hips` -> `mixamorigHips`), so a
  // scene built by another path may still carry the raw name.
  let match: Object3D | null = null;
  root.traverse((object) => {
    if (match || !object.name) return;
    if (PropertyBinding.sanitizeNodeName(object.name) === nodeName) match = object;
  });
  return match;
}

/**
 * The node a setting actually pins: the authored one when it is animated, else
 * the first root-like candidate. Exported so the editor can report the up axis
 * for the same node the lock will use.
 */
export function resolveRootMotionNode(
  clip: AnimationClip,
  authoredNode: string | undefined,
): string | null {
  const nodes = rootMotionPositionNodes(clip);
  if (nodes.length === 0) return null;
  if (authoredNode && nodes.includes(authoredNode)) return authoredNode;
  return ROOT_NODE_CANDIDATES.find((candidate) => nodes.includes(candidate)) ?? nodes[0] ?? null;
}

/** Floats per key: 3 for LINEAR/STEP, 9 for glTF CUBICSPLINE (tangents included). */
function positionStride(track: KeyframeTrack): 3 | 9 | null {
  const keys = track.times.length;
  if (keys === 0) return null;
  const stride = track.values.length / keys;
  if (stride === 3) return 3;
  if (stride === 9) return 9;
  return null;
}

function lockPositionTrack(
  track: KeyframeTrack,
  mode: Exclude<RootMotionMode, "preserve" | "driveMotion">,
  upIndex: 0 | 1 | 2,
): KeyframeTrack {
  const stride = positionStride(track);
  if (!stride || track.values.length < stride) return track;
  const next = track.clone();
  const values = next.values;
  // CUBICSPLINE keys are [inTangent, value, outTangent]; the pose lives in the
  // middle triplet and a locked axis must lose its tangents too.
  const valueOffset = stride === 9 ? 3 : 0;
  const base = [
    Number(values[valueOffset] ?? 0),
    Number(values[valueOffset + 1] ?? 0),
    Number(values[valueOffset + 2] ?? 0),
  ];
  for (let key = 0; key + stride <= values.length; key += stride) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (mode === "lockXZ" && axis === upIndex) continue;
      values[key + valueOffset + axis] = base[axis] ?? 0;
      if (stride === 9) {
        values[key + axis] = 0;
        values[key + 6 + axis] = 0;
      }
    }
  }
  return next;
}
