/**
 * Asset-level skeletal metadata (`*.skeleton.json` sidecars).
 *
 * Runtime reads are plain static fetches from `public/`; editor-only writes live
 * in `src/editor/assetSkeletonStore.ts`.
 */
import type { Vec3 } from "@engine/scene/layout";
import { ROOT_MOTION_MODES, ROOT_MOTION_UP_AXES } from "@engine/render-three/rootMotion";
import type { RootMotionMode, RootMotionUpAxis } from "@engine/render-three/rootMotion";
import { ANIMATION_SET_ROLES, clampBlendSpaceAxis as clampAxis } from "@engine/animation/blendSpace";
import type {
  AnimationSetRole,
  AssetSkeletonBlendSpaceDef,
  BlendSpaceAxisDef,
  BlendSpaceSampleDef,
  BlendSpaceType,
} from "@engine/animation/blendSpace";
import { projectFileUrl } from "@/project/ProjectSystem";

export { ROOT_MOTION_MODES, ROOT_MOTION_UP_AXES };
export type { RootMotionMode, RootMotionUpAxis };

// Compatibility exports: sidecar I/O stays here; shared animation math lives
// in the engine so headless locomotion never depends on the HTTP loader.
export { ANIMATION_SET_ROLES, BLEND_SPACE_TYPES, defaultBlendSpaceAxis, resolveBlendSpaceWeights } from "@engine/animation/blendSpace";
export type {
  AnimationSetRole,
  AssetSkeletonBlendSpaceDef,
  BlendSampleWeight,
  BlendSpaceAxisDef,
  BlendSpaceSampleDef,
  BlendSpaceType,
} from "@engine/animation/blendSpace";

export interface AssetSkeletonSocketDef {
  name: string;
  bone: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  previewAssetId?: string;
}

export const PHYSICS_BODY_SHAPES = ["capsule", "sphere", "box"] as const;
export type PhysicsBodyShape = (typeof PHYSICS_BODY_SHAPES)[number];

/**
 * A collision body rigidly attached to a bone/node — the data form of an Unreal
 * Physics Asset body. A primitive shape (`shape` + `size`) at a bone-local
 * offset; sized like {@link AssetSkeletonSocketDef} via a full-extent `size`
 * Vec3 (box: extents; sphere: diameter from the max axis; capsule: radius from
 * X/Z, total height from Y — matching the runtime collider builder). Authored in
 * the editor's Physics mode and consumed by a future Rapier ragdoll. Generic: no
 * game rules.
 */
export interface AssetSkeletonPhysicsBodyDef {
  /** Unique name within the asset. */
  name: string;
  /** Bone/node name this body is rigidly attached to. */
  bone: string;
  shape: PhysicsBodyShape;
  /** Bone-local offset. */
  position: Vec3;
  /** Bone-local rotation (XYZ degrees). */
  rotation: Vec3;
  /** Full local size (box: extents; sphere/capsule: see the interface doc). */
  size: Vec3;
}

/**
 * A joint linking two physics bodies — the data form of an Unreal Physics
 * Constraint, simplified to a cone-twist for ragdolls. The runtime anchors the
 * joint at `bodyB`'s bone and limits angular motion to a `swingDeg` cone plus
 * `twistDeg` of roll. Authored in the editor's Physics mode.
 */
export interface AssetSkeletonPhysicsConstraintDef {
  /** Unique name within the asset. */
  name: string;
  /** Parent body name (the more-rooted limb). */
  bodyA: string;
  /** Child body name (swings/twists relative to A). */
  bodyB: string;
  /** Cone swing half-angle limit in degrees, clamped to [0, 180]. */
  swingDeg: number;
  /** Twist (roll) limit in degrees, clamped to [0, 180]. */
  twistDeg: number;
}

export const MONTAGE_SLOTS = ["upperBody", "fullBody"] as const;
export type MontageSlot = (typeof MONTAGE_SLOTS)[number];

/**
 * A named marker placed at a time on an animation clip — the data form of an
 * Unreal Animation Notify. The runtime fires `name` as the clip's playhead
 * crosses `time` (footstep, hit window, effect trigger); game code decides what
 * the name does, keeping the asset generic.
 */
export interface AssetSkeletonNotifyDef {
  /** Marker name emitted to the runtime (e.g. "footstep", "hit-window"). */
  name: string;
  /** Clip this notify lives on. */
  clip: string;
  /** Time in seconds from the clip start. */
  time: number;
}

/**
 * A one-shot or held action clip layered over the base locomotion — the data
 * form of an Unreal Animation Montage played into a slot. `upperBody` montages
 * blend only over the bones at/under {@link AssetSkeletonDef.upperBodyBone}
 * (Unreal's "Layered Blend Per Bone" + Slot), so legs keep walking while the
 * upper body fires/reloads/aims.
 */
export interface AssetSkeletonMontageDef {
  /** Unique name within the asset; runtime/game data triggers by this name. */
  name: string;
  /** Clip the montage plays. */
  clip: string;
  /** Which body region the montage drives. */
  slot: MontageSlot;
  /** Loop while held (aim poses), or play once (fire/reload). */
  loop: boolean;
  /** Crossfade-in seconds when the montage starts. */
  blendInSeconds: number;
  /** Crossfade-out seconds when it ends/returns to base. */
  blendOutSeconds: number;
  /**
   * Named time ranges carved out of {@link clip} — the data form of Unreal's
   * montage sections. Empty means the montage is the whole clip, which is what
   * every montage authored before sections existed still is.
   *
   * The point of sections is a held action whose *middle* loops for as long as
   * the game says, rather than the whole clip repeating: an actor kneels down
   * once (`enter`), stays down working (`loop`) however long the task takes, and
   * stands up once (`exit`) when it is finished.
   */
  sections: AssetSkeletonMontageSectionDef[];
}

/**
 * One named slice of a montage's clip, in seconds from the clip start.
 *
 * `loop` marks the slice that is held — playback wraps back to `startSeconds`
 * instead of advancing to the next section — and is what makes the section list
 * a state machine rather than a playlist.
 */
export interface AssetSkeletonMontageSectionDef {
  /** Unique within the montage. Game code triggers/looks up by this name. */
  name: string;
  /** Section start, in seconds from the clip start. */
  startSeconds: number;
  /** Section end, in seconds from the clip start; must exceed `startSeconds`. */
  endSeconds: number;
  /** Repeat this section until the game asks for the next one. */
  loop: boolean;
}

/**
 * Per-clip root-motion playback policy; the modes themselves are defined by the
 * runtime that applies them, so the sidecar and the player cannot drift apart.
 * `lockXZ` keeps vertical root bob/jumps but removes horizontal travel;
 * `lockXYZ` fully pins the root translation to the clip's first frame;
 * `driveMotion` declares that gameplay moves the actor for this clip. The
 * source GLTF is never rewritten.
 */
export interface AssetSkeletonRootMotionDef {
  /** Clip name carried by the asset. */
  clip: string;
  mode: RootMotionMode;
  /** Optional animated node to pin; absent means auto-detect a root-like node. */
  rootNode?: string;
  /** Overrides the auto-detected vertical axis of the root's position track. */
  upAxis?: RootMotionUpAxis;
}

export interface AssetSkeletonPreviewPrefs {
  selectedClip: string | null;
}

export interface AssetSkeletonDef {
  schema: 1;
  sockets: AssetSkeletonSocketDef[];
  animationSet: Partial<Record<AnimationSetRole, string>>;
  blendSpaces: AssetSkeletonBlendSpaceDef[];
  notifies: AssetSkeletonNotifyDef[];
  montages: AssetSkeletonMontageDef[];
  /** Clip-level root motion handling for in-place playback. */
  rootMotion: AssetSkeletonRootMotionDef[];
  /** Bone-attached collision bodies (PhAT-lite); consumed by a future ragdoll. */
  physicsBodies: AssetSkeletonPhysicsBodyDef[];
  /** Joints linking physics bodies (ragdoll articulation). */
  physicsConstraints: AssetSkeletonPhysicsConstraintDef[];
  /**
   * Bone/node name that roots the upper-body mask for `upperBody` montages.
   * Everything in its subtree blends to the montage; the rest keeps locomotion.
   * Absent disables upper-body layering (montages fall back to full-body).
   */
  upperBodyBone?: string;
  preview: AssetSkeletonPreviewPrefs;
}

/**
 * Best-effort, de-duplicated list of clip names a skeleton sidecar references
 * (animation-set roles, montages, blend-space samples, notifies, root-motion,
 * preview selection). The GLTF is the ultimate source of playable clips, but the
 * sidecar names are enough to offer an authoring dropdown without loading the
 * model. Sorted for stable UI ordering.
 */
export function skeletonClipNames(def: AssetSkeletonDef): string[] {
  const names = new Set<string>();
  for (const clip of Object.values(def.animationSet)) if (clip) names.add(clip);
  for (const montage of def.montages) names.add(montage.clip);
  for (const blendSpace of def.blendSpaces) {
    for (const sample of blendSpace.samples) names.add(sample.clip);
  }
  for (const notify of def.notifies) names.add(notify.clip);
  for (const entry of def.rootMotion) names.add(entry.clip);
  if (def.preview.selectedClip) names.add(def.preview.selectedClip);
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function skeletonSidecarPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const withoutExt = normalized.replace(/\.[^./]+$/, "");
  return `${withoutExt}.skeleton.json`;
}

export function defaultAssetSkeleton(): AssetSkeletonDef {
  return {
    schema: 1,
    sockets: [],
    animationSet: {},
    blendSpaces: [],
    notifies: [],
    montages: [],
    rootMotion: [],
    physicsBodies: [],
    physicsConstraints: [],
    preview: { selectedClip: null },
  };
}

export async function loadAssetSkeleton(modelPath: string): Promise<AssetSkeletonDef> {
  const url = projectFileUrl(skeletonSidecarPath(modelPath));
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return defaultAssetSkeleton();
    return normalizeAssetSkeleton(await response.json());
  } catch {
    return defaultAssetSkeleton();
  }
}

export function normalizeAssetSkeleton(value: unknown): AssetSkeletonDef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultAssetSkeleton();
  const input = value as Record<string, unknown>;
  const result: AssetSkeletonDef = {
    schema: 1,
    sockets: normalizeSockets(input.sockets),
    animationSet: normalizeAnimationSet(input.animationSet),
    blendSpaces: normalizeBlendSpaces(input.blendSpaces),
    notifies: normalizeNotifies(input.notifies),
    montages: normalizeMontages(input.montages),
    rootMotion: normalizeRootMotion(input.rootMotion),
    physicsBodies: normalizePhysicsBodies(input.physicsBodies),
    physicsConstraints: normalizePhysicsConstraints(input.physicsConstraints),
    preview: normalizePreview(input.preview),
  };
  if (typeof input.upperBodyBone === "string" && input.upperBodyBone.length > 0) {
    result.upperBodyBone = input.upperBodyBone;
  }
  return result;
}

function normalizeMontages(value: unknown): AssetSkeletonMontageDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonMontageDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.clip !== "string" || input.clip.length === 0) continue;
    if (names.has(input.name)) continue;
    names.add(input.name);
    const montage: AssetSkeletonMontageDef = {
      name: input.name,
      clip: input.clip,
      slot: input.slot === "fullBody" ? "fullBody" : "upperBody",
      loop: input.loop === true,
      blendInSeconds: normalizeBlendSeconds(input.blendInSeconds, 0.12),
      blendOutSeconds: normalizeBlendSeconds(input.blendOutSeconds, 0.2),
      sections: normalizeMontageSections(input.sections),
    };
    result.push(montage);
  }
  return result;
}

/**
 * Keeps only well-formed, non-empty, uniquely named ranges. A malformed section
 * is dropped rather than repaired: a zero-length or reversed range would leave
 * the runtime looping a single frame, which reads as a frozen actor and is far
 * harder to diagnose than a montage that simply plays its whole clip.
 */
function normalizeMontageSections(value: unknown): AssetSkeletonMontageSectionDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonMontageSectionDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (names.has(input.name)) continue;
    const start = typeof input.startSeconds === "number" ? input.startSeconds : Number.NaN;
    const end = typeof input.endSeconds === "number" ? input.endSeconds : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end <= start) continue;
    names.add(input.name);
    result.push({ name: input.name, startSeconds: start, endSeconds: end, loop: input.loop === true });
  }
  return result;
}

function normalizeRootMotion(value: unknown): AssetSkeletonRootMotionDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonRootMotionDef[] = [];
  const clips = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.clip !== "string" || input.clip.length === 0) continue;
    if (!ROOT_MOTION_MODES.includes(input.mode as RootMotionMode)) continue;
    if (clips.has(input.clip)) continue;
    clips.add(input.clip);
    const entry: AssetSkeletonRootMotionDef = {
      clip: input.clip,
      mode: input.mode as RootMotionMode,
    };
    if (typeof input.rootNode === "string" && input.rootNode.length > 0) {
      entry.rootNode = input.rootNode;
    }
    if (ROOT_MOTION_UP_AXES.includes(input.upAxis as RootMotionUpAxis)) {
      entry.upAxis = input.upAxis as RootMotionUpAxis;
    }
    result.push(entry);
  }
  return result;
}

function normalizePhysicsBodies(value: unknown): AssetSkeletonPhysicsBodyDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonPhysicsBodyDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.bone !== "string" || input.bone.length === 0) continue;
    if (names.has(input.name)) continue;
    names.add(input.name);
    result.push({
      name: input.name,
      bone: input.bone,
      shape: PHYSICS_BODY_SHAPES.includes(input.shape as PhysicsBodyShape)
        ? (input.shape as PhysicsBodyShape)
        : "capsule",
      position: normalizeVec3(input.position, [0, 0, 0]),
      rotation: normalizeVec3(input.rotation, [0, 0, 0]),
      size: normalizePhysicsSize(input.size),
    });
  }
  return result;
}

function normalizePhysicsConstraints(value: unknown): AssetSkeletonPhysicsConstraintDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonPhysicsConstraintDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.bodyA !== "string" || input.bodyA.length === 0) continue;
    if (typeof input.bodyB !== "string" || input.bodyB.length === 0) continue;
    if (input.bodyA === input.bodyB) continue;
    if (names.has(input.name)) continue;
    names.add(input.name);
    result.push({
      name: input.name,
      bodyA: input.bodyA,
      bodyB: input.bodyB,
      swingDeg: normalizeAngleDeg(input.swingDeg, 45),
      twistDeg: normalizeAngleDeg(input.twistDeg, 30),
    });
  }
  return result;
}

function normalizeAngleDeg(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Number(Math.min(Math.max(Number(value), 0), 180).toFixed(2));
}

function normalizePhysicsSize(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((axis) => Number.isFinite(axis))) {
    return [0.2, 0.5, 0.2];
  }
  return value.map((axis) => Number(Math.max(Number(axis), 0.01).toFixed(4))) as Vec3;
}

function normalizeNotifies(value: unknown): AssetSkeletonNotifyDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonNotifyDef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.clip !== "string" || input.clip.length === 0) continue;
    const time = Number.isFinite(input.time) ? Math.max(0, Number(input.time)) : 0;
    result.push({ name: input.name, clip: input.clip, time: Number(time.toFixed(4)) });
  }
  return result;
}

function normalizeBlendSeconds(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Number(Math.min(Math.max(Number(value), 0), 4).toFixed(3));
}

function normalizeAnimationSet(value: unknown): Partial<Record<AnimationSetRole, string>> {
  const result: Partial<Record<AnimationSetRole, string>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  for (const role of ANIMATION_SET_ROLES) {
    const clip = input[role];
    if (typeof clip === "string" && clip.length > 0) result[role] = clip;
  }
  return result;
}

function normalizeSockets(value: unknown): AssetSkeletonSocketDef[] {
  if (!Array.isArray(value)) return [];
  const sockets: AssetSkeletonSocketDef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (typeof input.bone !== "string" || input.bone.length === 0) continue;
    const socket: AssetSkeletonSocketDef = {
      name: input.name,
      bone: input.bone,
      position: normalizeVec3(input.position, [0, 0, 0]),
      rotation: normalizeVec3(input.rotation, [0, 0, 0]),
      scale: normalizeVec3(input.scale, [1, 1, 1]),
    };
    if (typeof input.previewAssetId === "string" && input.previewAssetId.length > 0) {
      socket.previewAssetId = input.previewAssetId;
    }
    sockets.push(socket);
  }
  return sockets;
}

function normalizeBlendSpaces(value: unknown): AssetSkeletonBlendSpaceDef[] {
  if (!Array.isArray(value)) return [];
  const result: AssetSkeletonBlendSpaceDef[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.length === 0) continue;
    if (names.has(input.name)) continue;
    const type: BlendSpaceType = input.type === "2d" ? "2d" : "1d";
    const axisX = normalizeBlendAxis(input.axisX, "Speed");
    const axisY = type === "2d" ? normalizeBlendAxis(input.axisY, "Direction") : undefined;
    const blendSpace: AssetSkeletonBlendSpaceDef = {
      name: input.name,
      type,
      axisX,
      samples: normalizeBlendSamples(input.samples, type, axisX, axisY),
    };
    if (axisY) blendSpace.axisY = axisY;
    names.add(input.name);
    result.push(blendSpace);
  }
  return result;
}

function normalizeBlendAxis(value: unknown, fallbackName: string): BlendSpaceAxisDef {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const name = typeof input.name === "string" && input.name.length > 0 ? input.name : fallbackName;
  const min = Number.isFinite(input.min) ? roundAxis(Number(input.min)) : 0;
  let max = Number.isFinite(input.max) ? roundAxis(Number(input.max)) : 1;
  if (max <= min) max = min + 1;
  return { name, min, max };
}

function normalizeBlendSamples(
  value: unknown,
  type: BlendSpaceType,
  axisX: BlendSpaceAxisDef,
  axisY: BlendSpaceAxisDef | undefined,
): BlendSpaceSampleDef[] {
  if (!Array.isArray(value)) return [];
  const samples: BlendSpaceSampleDef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const input = item as Record<string, unknown>;
    if (typeof input.clip !== "string" || input.clip.length === 0) continue;
    const x = clampAxis(input.x, axisX);
    const sample: BlendSpaceSampleDef = { clip: input.clip, x };
    if (type === "2d" && axisY) sample.y = clampAxis(input.y, axisY);
    samples.push(sample);
  }
  return samples;
}

function roundAxis(value: number): number {
  return Number(value.toFixed(4));
}

function normalizePreview(value: unknown): AssetSkeletonPreviewPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { selectedClip: null };
  }
  const selectedClip = (value as Record<string, unknown>).selectedClip;
  return { selectedClip: typeof selectedClip === "string" && selectedClip.length > 0 ? selectedClip : null };
}

function normalizeVec3(value: unknown, fallback: Vec3): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((axis) => Number.isFinite(axis))
  ) {
    return [...fallback] as Vec3;
  }
  return value.map((axis) => Number(Number(axis).toFixed(4))) as Vec3;
}
