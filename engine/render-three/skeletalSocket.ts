/**
 * Mounting a sidecar-authored socket on a bone, in world units.
 *
 * Why this exists at all: character GLBs are routinely exported from a
 * centimetre pipeline and carry the conversion on their scene root — a `*_Root`
 * node sitting at scale 0.01, with every bone beneath it inheriting that.
 * A socket group parented straight onto a bone therefore lands
 * in centimetre space, where an authored `position: [0, 0.03, 0.24]` means
 * 0.3mm/2.4mm rather than the 3cm/24cm it reads as, and a prop authored at 4x
 * draws at 4% of its size — a few millimetres, which on screen is nothing at all.
 *
 * The fix is one node, not a convention: a compensator group that cancels the
 * bone's inherited scale, with the authored socket hanging off it. Everything
 * above stays exactly as exported, everything below is in world metres, and the
 * authored numbers finally mean what an artist typing them would expect.
 *
 * Both the runtime binder and the Skeletal Mesh Editor's overlay go through
 * here, because a socket that previews at one size and ships at another is worse
 * than one that is wrong in both places: authoring by eye would encode the error.
 */
import { Group, Vector3, type Object3D } from "three";

/** The authored socket transform, as it appears in a `*.skeleton.json` sidecar. */
export interface SkeletalSocketTransform {
  /** Offset from the bone, in world units (metres), not in the rig's export units. */
  readonly position: readonly [number, number, number];
  /** Euler XYZ in degrees, matching what the sidecar and the editor both store. */
  readonly rotation: readonly [number, number, number];
  /** World-unit scale for whatever hangs off the socket. */
  readonly scale: readonly [number, number, number];
}

/** A mounted socket: the node props attach to, and the node that owns the mount. */
export interface MountedSkeletalSocket {
  /**
   * Where props and preview meshes go, and what an editor gizmo drives.
   *
   * Its local transform is the authored one, unmodified — which is what lets a
   * gizmo drag be written straight back to the sidecar with no unit conversion
   * anywhere in the round trip.
   */
  readonly socket: Group;
  /** The scale-cancelling parent. Remove this to unmount, not {@link socket}. */
  readonly mount: Group;
}

/**
 * The scale a node is drawn at, from its own local scale up through every parent.
 *
 * Walked rather than read off `matrixWorld` on purpose: a freshly cloned
 * presentation has not had a world-matrix update yet, and mounting must not
 * depend on whether one happened to have run.
 */
export function accumulatedNodeScale(node: Object3D): Vector3 {
  const scale = new Vector3(1, 1, 1);
  let current: Object3D | null = node;
  while (current) {
    scale.multiply(current.scale);
    current = current.parent;
  }
  return scale;
}

/** A scale component too small to invert is treated as 1 rather than as infinity. */
const MIN_INVERTIBLE_SCALE = 1e-6;

/**
 * Mount an authored socket on `bone` so that everything under it is in world units.
 *
 * The returned {@link MountedSkeletalSocket.socket} carries the authored
 * transform verbatim; the compensator above it carries the reciprocal of the
 * bone's inherited scale. Rotation is left on the socket — these rigs scale
 * uniformly, so no shear can leak in from the order of the two.
 */
export function mountSkeletalSocket(
  bone: Object3D,
  transform: SkeletalSocketTransform,
  name: string,
): MountedSkeletalSocket {
  const inherited = accumulatedNodeScale(bone);
  const mount = new Group();
  mount.name = `${name}:mount`;
  mount.scale.set(
    Math.abs(inherited.x) < MIN_INVERTIBLE_SCALE ? 1 : 1 / inherited.x,
    Math.abs(inherited.y) < MIN_INVERTIBLE_SCALE ? 1 : 1 / inherited.y,
    Math.abs(inherited.z) < MIN_INVERTIBLE_SCALE ? 1 : 1 / inherited.z,
  );
  const socket = new Group();
  socket.name = name;
  socket.position.set(transform.position[0], transform.position[1], transform.position[2]);
  socket.rotation.set(
    transform.rotation[0] * Math.PI / 180,
    transform.rotation[1] * Math.PI / 180,
    transform.rotation[2] * Math.PI / 180,
    "XYZ",
  );
  socket.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
  mount.add(socket);
  bone.add(mount);
  return { socket, mount };
}
