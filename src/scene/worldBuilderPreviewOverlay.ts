import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { composePlacementMatrix } from "@engine/render-three/transforms";
import type { LayoutPlacement } from "@engine/scene/layout";
import {
  PREVIEW_CHANGES,
  previewItemDrawable,
  type PreviewChange,
  type PreviewItem,
  type PreviewPath,
  type StagePreview,
} from "@/editor/worldBuilderPreview";

/** Colour per change; the panel legend uses the same values. */
export const PREVIEW_COLORS: Record<PreviewChange, number> = {
  added: 0x3ddc84,
  updated: 0xf5b041,
  removed: 0xef5350,
  kept: 0x5dade2,
  blocked: 0xc06cff,
};

/** Old state of an updated object, and the line from it to the new one. */
const BEFORE_COLOR = 0x8a7a5c;
/** Splines are drawn this far above their points so they clear the road surface. */
const SPLINE_LIFT = 0.4;

/** Corner pairs of a unit box's twelve edges (-0.5..0.5). */
const BOX_EDGES: ReadonlyArray<readonly [number, number, number, number, number, number]> = (() => {
  const edges: Array<[number, number, number, number, number, number]> = [];
  for (const a of [-0.5, 0.5]) {
    for (const b of [-0.5, 0.5]) {
      edges.push([-0.5, a, b, 0.5, a, b], [a, -0.5, b, a, 0.5, b], [a, b, -0.5, a, b, 0.5]);
    }
  }
  return edges;
})();

/**
 * Viewport layer of a World Builder dry run (plan v0.4 T10): a coloured box
 * around every placement the plan touches, at the placement's asset bounds,
 * and coloured lines along its World Terrain splines. One merged line batch per
 * colour; drawn over the scene and never picked. Editor-only, render-side:
 * it reads the preview and changes nothing.
 */
export class WorldBuilderPreviewOverlay {
  readonly group = new Group();

  constructor(private readonly assetBounds: (assetId: string) => Box3 | null) {
    this.group.name = "world-builder-preview";
  }

  /** Replaces the drawn preview; returns how many items it drew. */
  show(preview: StagePreview | null): number {
    this.clear();
    if (!preview) return 0;
    const lines = new Map<number, number[]>();
    const add = (color: number, values: number[]) => {
      const list = lines.get(color) ?? [];
      for (const value of values) list.push(value);
      lines.set(color, list);
    };
    let drawn = 0;
    for (const item of preview.items) {
      if (!previewItemDrawable(item)) continue;
      drawn += 1;
      const color = PREVIEW_COLORS[item.change];
      if (item.placement && item.assetId) {
        add(color, this.boxLines(item.assetId, item.placement));
        if (item.before) {
          add(BEFORE_COLOR, this.boxLines(item.assetId, item.before));
          add(BEFORE_COLOR, [...item.before.position, ...item.placement.position]);
        }
      }
      if (item.path) add(color, pathLines(item.path));
      if (item.beforePath) add(BEFORE_COLOR, pathLines(item.beforePath));
    }
    for (const color of [...PREVIEW_CHANGES.map((change) => PREVIEW_COLORS[change]), BEFORE_COLOR]) {
      const values = lines.get(color);
      if (!values?.length) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(values, 3));
      const segments = new LineSegments(
        geometry,
        new LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: color === BEFORE_COLOR ? 0.6 : 0.95 }),
      );
      segments.renderOrder = 28;
      segments.raycast = () => {};
      this.group.add(segments);
    }
    return drawn;
  }

  /** World box of one item, or of every drawable item; null when there is none. */
  worldBox(preview: StagePreview, item: PreviewItem | null): Box3 | null {
    const box = new Box3();
    for (const entry of item ? [item] : preview.items) {
      if (entry.placement && entry.assetId) box.union(this.placementBox(entry.assetId, entry.placement));
      for (const [start, end] of entry.path ?? []) box.expandByPoint(new Vector3(...start)).expandByPoint(new Vector3(...end));
    }
    return box.isEmpty() ? null : box;
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      const segments = child as LineSegments<BufferGeometry, LineBasicMaterial>;
      segments.geometry.dispose();
      segments.material.dispose();
      this.group.remove(child);
    }
  }

  private boxMatrix(assetId: string, placement: LayoutPlacement): Matrix4 {
    const bounds = this.assetBounds(assetId);
    const local = new Matrix4();
    if (bounds && !bounds.isEmpty()) {
      const size = bounds.getSize(new Vector3()).max(new Vector3(0.05, 0.05, 0.05));
      local.compose(bounds.getCenter(new Vector3()), new Quaternion(), size);
    }
    return composePlacementMatrix(placement).multiply(local);
  }

  private boxLines(assetId: string, placement: LayoutPlacement): number[] {
    const matrix = this.boxMatrix(assetId, placement);
    const point = new Vector3();
    const values: number[] = [];
    for (const [ax, ay, az, bx, by, bz] of BOX_EDGES) {
      point.set(ax, ay, az).applyMatrix4(matrix);
      values.push(point.x, point.y, point.z);
      point.set(bx, by, bz).applyMatrix4(matrix);
      values.push(point.x, point.y, point.z);
    }
    return values;
  }

  private placementBox(assetId: string, placement: LayoutPlacement): Box3 {
    return new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)).applyMatrix4(this.boxMatrix(assetId, placement));
  }
}

function pathLines(path: PreviewPath): number[] {
  return path.flatMap(([start, end]) => [start[0], start[1] + SPLINE_LIFT, start[2], end[0], end[1] + SPLINE_LIFT, end[2]]);
}
