import type { EditableSceneObject } from "@editor/core/editableScene";
import {
  matchesOutlinerPartitionFilter,
  outlinerPartitionState,
  type OutlinerPartitionFilter,
  type OutlinerPartitionView,
} from "@editor/core/worldPartitionOutliner";
import { ACTOR_TYPE_ICONS, UI_ICONS, type ActorTypeIcon } from "../../editorIcons";

/** Broad actor families exposed by the Outliner's type-filter popover. */
export const OUTLINER_FILTER_TYPES = [
  { type: "mesh", label: "Meshes" },
  { type: "character", label: "Characters" },
  { type: "light", label: "Lights" },
  { type: "environment", label: "Environment" },
  { type: "volume", label: "Volumes" },
  { type: "terrain", label: "Terrain" },
  { type: "gameplay", label: "Gameplay" },
  { type: "widget", label: "Widgets" },
] as const;

export type OutlinerFilterType = (typeof OUTLINER_FILTER_TYPES)[number]["type"];

// The list element survives row rebuilds after selection, filtering, and edits.
const selectionAnchors = new WeakMap<HTMLElement, string>();

type OutlinerEntry = { object: EditableSceneObject; depth: number };

/** What the rendered rows read on interaction; swapped in place by a patch render. */
interface OutlinerRowsView {
  options: OutlinerPanelOptions;
  entries: OutlinerEntry[];
  byId: Map<string, EditableSceneObject>;
}

interface RenderedOutlinerRow {
  row: HTMLDivElement;
  detail: HTMLElement;
  selected: boolean;
  detailText: string;
}

/**
 * Rows built for a list, keyed by their structural signature. Selection and
 * position changes (every click, every gizmo drag step) keep the signature, so
 * they patch the live rows instead of rebuilding thousands of them.
 */
interface RenderedOutlinerRows {
  key: string;
  view: OutlinerRowsView;
  rows: Map<string, RenderedOutlinerRow>;
}

const renderedRows = new WeakMap<HTMLElement, RenderedOutlinerRows>();

export interface OutlinerPanelOptions {
  body: HTMLElement;
  summary: HTMLElement;
  objects: readonly EditableSceneObject[];
  filter: string;
  visibleTypes: ReadonlySet<OutlinerFilterType>;
  /** Null while the level's World Partition is off: no cell badges, no partition filter. */
  partition: OutlinerPartitionView | null;
  partitionFilter: OutlinerPartitionFilter;
  selectSceneObject: (id: string, options?: { additive?: boolean; rangeIds?: readonly string[] }) => void;
  renameSceneObject: (id: string, name: string) => void;
  setSceneObjectHidden: (id: string, hidden: boolean) => void;
  setSceneObjectLocked: (id: string, locked: boolean) => void;
  parentObjectsTo: (childIds: string[], parentId: string) => void;
  openOutlinerContextMenu: (event: MouseEvent, object: EditableSceneObject) => void;
}

export function renderOutlinerPanel(options: OutlinerPanelOptions): void {
  const { objects, filter, visibleTypes, partition, partitionFilter } = options;
  const typeMatches = objects.filter((object) =>
    visibleTypes.has(outlinerFilterType(object))
    && (!partition || matchesOutlinerPartitionFilter(partition, object.id, partitionFilter)));
  options.summary.textContent = `${objects.length} actors (${objects.filter((object) => object.selected).length} selected)`;

  if (filter) {
    const matches = typeMatches.filter((object) =>
      object.label.toLocaleLowerCase().startsWith(filter),
    );
    replaceOutlinerRows(options, matches.map((object) => ({ object, depth: 0 })), objects.length);
    return;
  }

  replaceOutlinerRows(options, orderOutlinerTree(typeMatches), objects.length);
}

/** Depth-first order so children render indented under their parent. */
function orderOutlinerTree(
  objects: readonly EditableSceneObject[],
): Array<{ object: EditableSceneObject; depth: number }> {
  const byNodeId = new Map<string, EditableSceneObject>();
  for (const object of objects) {
    if (object.nodeId) byNodeId.set(object.nodeId, object);
  }
  const childrenByParent = new Map<string, EditableSceneObject[]>();
  for (const object of objects) {
    if (!object.parentId || !byNodeId.has(object.parentId)) continue;
    const list = childrenByParent.get(object.parentId) ?? [];
    list.push(object);
    childrenByParent.set(object.parentId, list);
  }

  const ordered: Array<{ object: EditableSceneObject; depth: number }> = [];
  const visited = new Set<string>();
  const walk = (object: EditableSceneObject, depth: number): void => {
    if (visited.has(object.id)) return;
    visited.add(object.id);
    ordered.push({ object, depth });
    if (object.nodeId) {
      for (const child of childrenByParent.get(object.nodeId) ?? []) walk(child, depth + 1);
    }
  };
  for (const object of objects) {
    if (!object.parentId || !byNodeId.has(object.parentId)) walk(object, 0);
  }
  // Any leftover (cycle) objects get appended at root depth.
  for (const object of objects) if (!visited.has(object.id)) walk(object, 0);
  return ordered;
}

function replaceOutlinerRows(
  options: OutlinerPanelOptions,
  entries: OutlinerEntry[],
  totalCount: number,
): void {
  const anchorId = selectionAnchors.get(options.body);
  if (!entries.some(({ object }) => object.id === anchorId && object.selected)) {
    selectionAnchors.delete(options.body);
  }
  if (entries.length === 0) {
    renderedRows.delete(options.body);
    options.body.innerHTML = `
        <div class="empty-details">
          <strong>${totalCount === 0 ? "No objects" : "No matches"}</strong>
          <span>Scene</span>
        </div>
      `;
    return;
  }

  const view: OutlinerRowsView = {
    options,
    entries,
    byId: new Map(entries.map(({ object }) => [object.id, object])),
  };
  const key = entries.map((entry) => outlinerRowKey(options, entry)).join("\n");
  const rendered = renderedRows.get(options.body);
  if (rendered?.key === key && rendered.rows.values().next().value?.row.parentElement === options.body) {
    rendered.view = view;
    for (const { object } of entries) patchOutlinerRow(rendered.rows.get(object.id)!, object);
    return;
  }

  const state: RenderedOutlinerRows = { key, view, rows: new Map() };
  let dragIds: string[] = [];
  const selectRow = (object: EditableSceneObject, event: MouseEvent): void => {
    const { options, entries } = state.view;
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      const anchorId = selectionAnchors.get(options.body)
        ?? entries.find(({ object }) => object.selected)?.object.id
        ?? object.id;
      const start = entries.findIndex(({ object }) => object.id === anchorId);
      const end = entries.findIndex((entry) => entry.object.id === object.id);
      selectionAnchors.set(options.body, anchorId);
      options.selectSceneObject(object.id, {
        additive,
        rangeIds: entries.slice(Math.min(start, end), Math.max(start, end) + 1)
          .map(({ object }) => object.id),
      });
      return;
    }
    selectionAnchors.set(options.body, object.id);
    options.selectSceneObject(object.id, { additive });
  };

  options.body.replaceChildren(
    ...entries.map((entry) => {
      const built = buildOutlinerRow(state, entry.object, entry.depth, selectRow, () => dragIds, (next) => {
        dragIds = next;
      });
      state.rows.set(entry.object.id, built);
      return built.row;
    }),
  );
  renderedRows.set(options.body, state);
}

/** Everything a row's markup depends on apart from its selection and position. */
function outlinerRowKey(options: OutlinerPanelOptions, { object, depth }: OutlinerEntry): string {
  const cell = options.partition
    ? `${options.partition.cells.get(object.id) ?? ""}:${outlinerPartitionState(options.partition, object.id)}`
    : "";
  return [
    object.id,
    depth,
    object.kind,
    object.label,
    object.assetId,
    object.hidden ? 1 : 0,
    object.locked ? 1 : 0,
    object.groupId ?? "",
    cell,
  ].join("|");
}

function outlinerDetailText(object: EditableSceneObject): string {
  return `${object.assetId} - ${formatPosition(object.position)}`;
}

function patchOutlinerRow(rendered: RenderedOutlinerRow, object: EditableSceneObject): void {
  const selected = Boolean(object.selected);
  if (rendered.selected !== selected) {
    rendered.selected = selected;
    rendered.row.classList.toggle("active", selected);
  }
  const detailText = outlinerDetailText(object);
  if (rendered.detailText !== detailText) {
    rendered.detailText = detailText;
    rendered.detail.textContent = detailText;
  }
}

function buildOutlinerRow(
  state: RenderedOutlinerRows,
  object: EditableSceneObject,
  depth: number,
  selectRow: (object: EditableSceneObject, event: MouseEvent) => void,
  getDragIds: () => readonly string[],
  setDragIds: (ids: string[]) => void,
): RenderedOutlinerRow {
  const { options } = state.view;
  const id = object.id;
  // Handlers outlive patch renders, so they read the latest object and options.
  const live = (): EditableSceneObject => state.view.byId.get(id) ?? object;
  const liveOptions = (): OutlinerPanelOptions => state.view.options;
  const row = document.createElement("div");
  row.className = "outliner-row";
  row.dataset.objectId = id;
  row.dataset.outlinerType = outlinerFilterType(object);
  row.dataset.testid = "outliner-row";
  row.draggable = true;
  if (object.selected) row.classList.add("active");
  if (object.hidden) row.classList.add("is-hidden");
  if (object.groupId) row.classList.add("is-grouped");
  const cellBadge = options.partition ? outlinerCellBadge(options.partition, id) : "";
  if (cellBadge) row.classList.add("has-cell");
  if (options.partition && outlinerPartitionState(options.partition, id) === "unloaded") {
    row.classList.add("is-unloaded-cell");
  }
  row.style.paddingLeft = `${8 + depth * 14}px`;
  const detailText = outlinerDetailText(object);
  row.innerHTML = `
      <span class="outliner-kind" aria-hidden="true">${ACTOR_TYPE_ICONS[outlinerIcon(object)]}</span>
      <span class="outliner-meta">
        <strong>${object.label}</strong>
        <small>${detailText}</small>
      </span>
      ${cellBadge}
      <span class="outliner-actions">
        <button type="button" class="outliner-toggle${object.hidden ? " on" : ""}"
          data-action="hidden" title="${object.hidden ? "Show object" : "Hide object"}" aria-label="${object.hidden ? "Show object" : "Hide object"}">${object.hidden ? UI_ICONS.eyeOff : UI_ICONS.eye}</button>
        <button type="button" class="outliner-toggle${object.locked ? " on" : ""}"
          data-action="locked" title="${object.locked ? "Unlock object" : "Lock object"}" aria-label="${object.locked ? "Unlock object" : "Lock object"}">${object.locked ? UI_ICONS.lock : UI_ICONS.unlock}</button>
      </span>
    `;
  row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".outliner-actions")) return;
    selectRow(live(), event);
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    liveOptions().openOutlinerContextMenu(event, live());
  });
  row.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest(".outliner-actions")) return;
    const nextName = window.prompt("Rename object", live().label);
    if (nextName === null) return;
    liveOptions().renameSceneObject(id, nextName);
  });
  row.querySelector<HTMLButtonElement>('[data-action="hidden"]')?.addEventListener("click", () => {
    liveOptions().setSceneObjectHidden(id, !live().hidden);
  });
  row.querySelector<HTMLButtonElement>('[data-action="locked"]')?.addEventListener("click", () => {
    liveOptions().setSceneObjectLocked(id, !live().locked);
  });

  // Drag-and-drop parenting: drag a row (or the whole multi-selection if the
  // dragged row is part of it) onto another row to parent it there.
  row.addEventListener("dragstart", (event) => {
    const selectedIds = liveOptions().objects
      .filter((entry) => entry.selected)
      .map((entry) => entry.id);
    const nextDragIds = live().selected && selectedIds.length > 1 ? selectedIds : [id];
    setDragIds(nextDragIds);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", nextDragIds.join(","));
    }
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragend", () => {
    setDragIds([]);
    row.classList.remove("is-dragging");
    for (const el of liveOptions().body.querySelectorAll(".drop-target")) {
      el.classList.remove("drop-target");
    }
  });
  row.addEventListener("dragover", (event) => {
    const dragIds = getDragIds();
    if (dragIds.length === 0) return;
    if (dragIds.includes(id)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    row.classList.add("drop-target");
  });
  row.addEventListener("dragleave", () => {
    row.classList.remove("drop-target");
  });
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("drop-target");
    const childIds = getDragIds().filter((childId) => childId !== id);
    setDragIds([]);
    if (childIds.length > 0) liveOptions().parentObjectsTo(childIds, id);
  });
  return { row, detail: row.querySelector<HTMLElement>(".outliner-meta small")!, selected: Boolean(object.selected), detailText };
}

/** World Partition cell (or "persistent") of a row; dimmed rows sit in cells unloaded at the camera. */
function outlinerCellBadge(partition: OutlinerPartitionView, id: string): string {
  const state = outlinerPartitionState(partition, id);
  const cell = partition.cells.get(id);
  const title = state === "persistent"
    ? "Persistent: always loaded"
    : `World Partition cell ${cell}: ${state === "loaded" ? "loaded" : "not loaded"} with the pawn at the camera`;
  return `<span class="outliner-cell is-${state}" data-outliner-cell="${cell ?? "persistent"}" title="${title}">${cell ?? "P"}</span>`;
}

function formatPosition(position: [number, number, number]): string {
  return position.map((value) => Number(value.toFixed(2))).join(", ");
}

function outlinerFilterType(object: EditableSceneObject): OutlinerFilterType {
  if (object.kind === "character") return "character";
  if (object.kind === "light") return "light";
  if (["sky", "fog", "cloud", "post", "worldEnvironment"].includes(object.kind)) return "environment";
  if (["blockingVolume", "aiNavigationVolume"].includes(object.kind)) return "volume";
  if (object.kind === "landscape") return "terrain";
  if (object.kind === "worldWidget") return "widget";
  if (["actor", "targetPoint", "spline"].includes(object.kind)) return "gameplay";
  return "mesh";
}

function outlinerIcon(object: EditableSceneObject): ActorTypeIcon {
  if (object.groupId) return "group";
  if (object.kind === "character") return "character";
  if (object.kind === "light") return "light";
  if (["sky", "fog"].includes(object.kind)) return "atmosphere";
  if (object.kind === "cloud") return "cloud";
  if (object.kind === "post") return "postprocess";
  if (object.kind === "worldEnvironment") return "worldEnvironment";
  if (["reflectionPlane", "reflectiveSurface", "reflectionCapture"].includes(object.kind)) return "reflection";
  if (["blockingVolume", "aiNavigationVolume"].includes(object.kind)) return "volume";
  if (object.kind === "landscape") return "terrain";
  if (object.kind === "worldWidget") return "widget";
  if (["actor", "targetPoint", "spline"].includes(object.kind)) return "gameplay";
  return "mesh";
}
