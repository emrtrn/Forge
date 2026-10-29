/**
 * What a World Builder dry run would do, as the viewport and the panel show it
 * (plan v0.4 T10). Built from a `StagePlan` and the level as it is now; it
 * reads both and changes neither, so a dry run still changes nothing.
 *
 * Each item is one placement or World Terrain spline with the state to draw:
 * the new one for added/updated objects (and the old one for updated), the one
 * in the level for removed, kept and blocked objects. A kept object deleted by
 * hand has nothing to draw and is listed only.
 */
import type { LayoutPlacement, RoomLayout, Vec3 } from "@engine/scene/layout";
import type { TerrainSpline } from "@engine/terrain/terrainTypes";
import type { BlockedReason, KeptReason, StagePlan, StageTerrain } from "@engine/worldbuilder/stage";

export const PREVIEW_CHANGES = ["added", "updated", "removed", "kept", "blocked"] as const;
export type PreviewChange = (typeof PREVIEW_CHANGES)[number];

/** A spline as line pieces between its connected points, world metres. */
export type PreviewPath = Array<[Vec3, Vec3]>;

export interface PreviewItem {
  id: string;
  change: PreviewChange;
  reason?: KeptReason | BlockedReason;
  kind: "placement" | "spline";
  /** Placement items: the asset and the placement to draw. */
  assetId?: string;
  placement?: LayoutPlacement;
  /** Updated placements: where it stands now. */
  before?: LayoutPlacement;
  /** Spline items: the spline to draw, and for updated ones the current spline. */
  path?: PreviewPath;
  beforePath?: PreviewPath;
}

export interface StagePreview {
  stageId: string;
  stageLabel: string;
  items: PreviewItem[];
}

interface Located<T> {
  owner: string;
  value: T;
}

export function buildStagePreview(plan: StagePlan, layout: RoomLayout, terrains: readonly StageTerrain[]): StagePreview {
  const after = new Map<string, Located<LayoutPlacement>>();
  const before = new Map<string, Located<LayoutPlacement>>();
  for (const change of plan.groupChanges) {
    for (const placement of change.after ?? []) if (placement.id) after.set(placement.id, { owner: change.assetId, value: placement });
    for (const placement of change.before ?? []) if (placement.id) before.set(placement.id, { owner: change.assetId, value: placement });
  }
  const current = new Map<string, Located<LayoutPlacement>>();
  for (const group of layout.instances) {
    for (const placement of group.placements) if (placement.id) current.set(placement.id, { owner: group.assetId, value: placement });
  }
  const splinesAfter = new Map<string, TerrainSpline>();
  const splinesBefore = new Map<string, TerrainSpline>();
  for (const change of plan.splineChanges) {
    for (const spline of change.after) splinesAfter.set(spline.id, spline);
    for (const spline of change.before) splinesBefore.set(spline.id, spline);
  }
  const splinesNow = new Map<string, TerrainSpline>();
  for (const terrain of terrains) for (const spline of terrain.splines) splinesNow.set(spline.id, spline);

  const items: PreviewItem[] = [];
  const push = (id: string, change: PreviewChange, reason?: KeptReason | BlockedReason) => {
    const shown = change === "added" || change === "updated"
      ? after.get(id)
      : change === "removed" ? before.get(id) ?? current.get(id) : current.get(id);
    const spline = change === "added" || change === "updated"
      ? splinesAfter.get(id)
      : change === "removed" ? splinesBefore.get(id) ?? splinesNow.get(id) : splinesNow.get(id);
    const item: PreviewItem = { id, change, kind: shown || !spline ? "placement" : "spline" };
    if (reason) item.reason = reason;
    if (shown) {
      item.assetId = shown.owner;
      item.placement = shown.value;
      const old = change === "updated" ? before.get(id) : undefined;
      if (old) item.before = old.value;
    } else if (spline) {
      const path = splinePath(spline);
      if (path) item.path = path;
      const old = change === "updated" ? splinesBefore.get(id) : undefined;
      const oldPath = old ? splinePath(old) : null;
      if (oldPath) item.beforePath = oldPath;
    }
    items.push(item);
  };
  for (const id of plan.added) push(id, "added");
  for (const id of plan.updated) push(id, "updated");
  for (const id of plan.removed) push(id, "removed");
  for (const entry of plan.kept) push(entry.id, "kept", entry.reason);
  for (const entry of plan.blocked) push(entry.id, "blocked", entry.reason);
  return { stageId: plan.stageId, stageLabel: plan.stageLabel, items };
}

/** True when the item has something to draw. */
export function previewItemDrawable(item: PreviewItem): boolean {
  return item.placement !== undefined || (item.path?.length ?? 0) > 0;
}

/** Segment pieces of a world-coordinate spline; null for a terrain-local one (no world position here). */
function splinePath(spline: TerrainSpline): PreviewPath | null {
  if (spline.coordinateSpace !== "world") return null;
  const points = new Map(spline.points.map((point) => [point.id, point.position] as const));
  const path: PreviewPath = [];
  for (const segment of spline.segments) {
    const start = points.get(segment.startPointId);
    const end = points.get(segment.endPointId);
    if (start && end) path.push([[...start], [...end]]);
  }
  return path;
}
