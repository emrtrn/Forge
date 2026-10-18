import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
} from "three";

import type { BrushShape, Vec3 } from "@engine/scene/layout";
import {
  clampBrushSides,
  DEFAULT_BRUSH_SIDES,
  type ResolvedBlockingVolume,
} from "@engine/scene/blockingVolume";

export {
  BRUSH_SHAPES,
  isBrushShape,
  resolveBlockingVolume,
  blockingVolumeCollisionDef,
  canonicalBrushSize,
  clampBrushSides,
  BLOCKING_VOLUME_DEFAULTS,
  DEFAULT_BRUSH_SIZE,
  DEFAULT_BRUSH_SIDES,
  MIN_BRUSH_SIDES,
  MAX_BRUSH_SIDES,
  uniqueBlockingVolumeId,
  uniqueBlockingVolumeName,
  type ResolvedBlockingVolume,
} from "@engine/scene/blockingVolume";

/**
 * Blocking Volume render binding — the web/three counterpart to Unreal's
 * BlockingVolume / brush volumes. A parametric primitive (box / cylinder / cone /
 * sphere) built at the brush `size`; the actor's transform (position/rotation/scale)
 * orients and further sizes it. In the **editor** it draws as a translucent orange
 * brush + wireframe (Unreal's brush look); in **runtime** (Play) it draws as a solid
 * brush using its authored colour (neutral grey when absent), and the caller
 * toggles `visible` from `renderInGame`.
 *
 * Geometry is built from the shape + size, so a shape or size change requires
 * rebuilding the object (mirrors the Planar Reflection resolution rebuild).
 */

/** The three.js object backing a Blocking Volume actor (fill mesh + optional wireframe). */
export type BlockingVolumeObject = Group;

/** Resolved settings + world transform the binding needs to build/sync a volume. */
export interface BlockingVolumeRenderItem extends ResolvedBlockingVolume {
  position: Vec3;
  /** XYZ-order Euler rotation in degrees. */
  rotation: Vec3;
  /** Per-axis transform scale (multiplied onto the brush size). */
  scale: Vec3;
}

/** Neutral solid colour for the runtime grey-box. */
const RUNTIME_BLOCKING_VOLUME_COLOR = "#9aa0a6";

/**
 * Builds the parametric brush geometry. `size` is the canonical full extents for
 * the shape (see `canonicalBrushSize`): box `[x, y, z]`; sphere/cylinder/cone use
 * `x` as the diameter and (for cylinder/cone) `y` as the height. `sides` is the
 * radial-segment count for cylinder/cone (their "köşe sayısı"); box/sphere ignore it.
 */
export function createBlockingVolumeGeometry(
  shape: BrushShape,
  size: Vec3,
  sides: number = DEFAULT_BRUSH_SIDES,
): BufferGeometry {
  const [sx, sy] = size;
  const radialSegments = clampBrushSides(sides);
  switch (shape) {
    case "box":
      return new BoxGeometry(size[0], size[1], size[2]);
    case "cylinder":
      return new CylinderGeometry(sx / 2, sx / 2, sy, radialSegments);
    case "cone":
      return new ConeGeometry(sx / 2, sy, radialSegments);
    case "sphere":
      return new SphereGeometry(sx / 2, 24, 16);
  }
}

/**
 * Builds the editor brush object: a translucent orange fill + an orange wireframe.
 * The fill is single-sided + non-depth-writing so overlapping brushes read cleanly.
 */
export function createBlockingVolumeObject(item: BlockingVolumeRenderItem): BlockingVolumeObject {
  const group = new Group();
  group.name = item.name;
  const geometry = createBlockingVolumeGeometry(item.brushShape, item.size, item.brushSides);
  const fill = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: new Color(item.color),
      transparent: true,
      opacity: 0.22,
      roughness: 0.9,
      metalness: 0,
      depthWrite: false,
    }),
  );
  fill.name = "blocking-volume-fill";
  fill.castShadow = false;
  fill.receiveShadow = false;
  // Unreal-style volume picking: the translucent fill is a visual only and must
  // not be clickable — otherwise the brush face covers the scene and steals every
  // click, so objects inside/behind it can't be selected. Only the wireframe
  // edges are pickable (below), exactly like Unreal's brush volumes.
  fill.raycast = () => {};
  group.add(fill);

  const wireframe = new LineSegments(
    new EdgesGeometry(geometry),
    new LineBasicMaterial({ color: new Color(item.color) }),
  );
  wireframe.name = "blocking-volume-wire";
  group.add(wireframe);

  applyBlockingVolumeTransform(group, item);
  return group;
}

/**
 * Builds the runtime (Play) brush object, casting and receiving shadows.
 * Pass the layout's optional colour separately: `item.color` already includes
 * the editor's orange default, which must not become the runtime fallback.
 * Caller sets `visible` from `renderInGame` (collision is independent).
 */
export function createRuntimeBlockingVolumeObject(
  item: BlockingVolumeRenderItem,
  color: string = RUNTIME_BLOCKING_VOLUME_COLOR,
): BlockingVolumeObject {
  const group = new Group();
  group.name = item.name;
  const fill = new Mesh(
    createBlockingVolumeGeometry(item.brushShape, item.size, item.brushSides),
    new MeshStandardMaterial({
      color: new Color(color),
      roughness: 0.85,
      metalness: 0,
    }),
  );
  fill.name = "blocking-volume-fill";
  fill.castShadow = true;
  fill.receiveShadow = true;
  group.add(fill);
  applyBlockingVolumeTransform(group, item);
  return group;
}

/** Pushes the transform + visibility onto an existing brush object. */
export function applyBlockingVolumeTransform(
  object: BlockingVolumeObject,
  item: BlockingVolumeRenderItem,
): void {
  object.position.set(item.position[0], item.position[1], item.position[2]);
  object.rotation.set(
    (item.rotation[0] * Math.PI) / 180,
    (item.rotation[1] * Math.PI) / 180,
    (item.rotation[2] * Math.PI) / 180,
    "XYZ",
  );
  object.scale.set(item.scale[0] || 1, item.scale[1] || 1, item.scale[2] || 1);
  object.visible = !item.hidden;
}

/** Frees every geometry + material under a brush object. */
export function disposeBlockingVolumeObject(object: BlockingVolumeObject): void {
  object.traverse((child) => {
    if (child instanceof Mesh || child instanceof LineSegments) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
  });
}
