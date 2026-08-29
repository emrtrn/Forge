/**
 * Body-mask helpers for layered (upper/lower) character animation.
 *
 * Forge's data-only stand-in for Unreal's "Layered Blend Per Bone": a character
 * clip is split into two clips by the node subtree it drives. Playing the upper
 * clip on one mixer and the lower clip on another (the masks are disjoint and
 * cover every animated node) lets an upper-body montage run while the legs keep
 * their locomotion — no per-bone weight graph, just track filtering by node.
 *
 * Works for both skinned skeletons and rigid node-hierarchy rigs (the demo
 * Kenney characters), since glTF animation tracks target nodes by name either
 * way. Three-touching, so it lives in `engine/render-three`.
 */
import { AnimationClip, PropertyBinding, type Object3D } from "three";

/**
 * Collects the names of `rootBone` and every descendant under it — the set of
 * nodes that make up the upper body. Returns an empty set when the bone is
 * absent (caller then treats every clip as full-body / lower).
 */
export function collectSubtreeNodeNames(root: Object3D, rootBone: string): Set<string> {
  const names = new Set<string>();
  const start = findMaskRootBone(root, rootBone);
  if (!start) return names;
  start.traverse((node) => {
    if (node.name) names.add(node.name);
  });
  return names;
}

/**
 * Resolves the authored bone name against the loaded scene, tolerating the
 * rename glTF loading performs.
 *
 * `GLTFLoader` runs every node name through `PropertyBinding.sanitizeNodeName`,
 * which strips the characters a track path reserves — a Mixamo rig authored as
 * `mixamorig:Spine` is called `mixamorigSpine` by the time it is an `Object3D`.
 * Sidecars are written against the names an artist sees in the DCC tool and
 * against the ones the editor lists, so both spellings turn up in real data
 * (a rig's own sidecar can carry each spelling). Matching only
 * the literal name would leave the mask silently empty, which is the one failure
 * mode that looks exactly like "layering is not implemented".
 */
function findMaskRootBone(root: Object3D, rootBone: string): Object3D | null {
  const direct = root.name === rootBone ? root : root.getObjectByName(rootBone);
  if (direct) return direct;
  const sanitized = PropertyBinding.sanitizeNodeName(rootBone);
  let match: Object3D | null = null;
  root.traverse((node) => {
    if (match || !node.name) return;
    if (node.name === sanitized || PropertyBinding.sanitizeNodeName(node.name) === sanitized) match = node;
  });
  return match;
}

/** The two masked variants of a character's clip set, keyed by the same names. */
export interface SplitClips {
  /** Tracks that drive nodes NOT in the upper set (legs, root, pelvis). */
  readonly lower: AnimationClip[];
  /** Tracks that drive nodes in the upper set (torso, arms, head). */
  readonly upper: AnimationClip[];
}

/**
 * Splits every clip into lower- and upper-body variants by routing each track to
 * the half its target node belongs to. Track data is shared (tracks are
 * read-only during playback); only the per-half track lists differ. A variant
 * with no tracks is still emitted so both channels can resolve the clip by name.
 */
export function splitClipsByUpperBody(
  clips: readonly AnimationClip[],
  upperNodeNames: ReadonlySet<string>,
): SplitClips {
  const lower: AnimationClip[] = [];
  const upper: AnimationClip[] = [];
  for (const clip of clips) {
    const lowerTracks = [];
    const upperTracks = [];
    for (const track of clip.tracks) {
      const nodeName = PropertyBinding.parseTrackName(track.name).nodeName ?? "";
      if (upperNodeNames.has(nodeName)) upperTracks.push(track);
      else lowerTracks.push(track);
    }
    lower.push(new AnimationClip(clip.name, clip.duration, lowerTracks));
    upper.push(new AnimationClip(clip.name, clip.duration, upperTracks));
  }
  return { lower, upper };
}
