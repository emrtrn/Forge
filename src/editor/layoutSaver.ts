import type { LayoutSavePayload, LayoutSaveResult } from "@/scene/SceneApp";
import {
  compareWorldCellKeys,
  countWorldCellElements,
  normalizeWorldPartitionSettings,
  partitionLayout,
  type WorldCellDocument,
} from "@engine/world/worldPartition";

const lastWrittenCells = new Map<string, Map<string, string>>();

export async function saveLayoutViaDevEndpoint(
  payload: LayoutSavePayload,
): Promise<LayoutSaveResult> {
  const level = payload.scenePath;
  if (!level) throw new Error("Cannot save world cells without the level path");
  const enabled = payload.layout.worldSettings?.partition?.enabled === true;
  let layout = payload.layout;
  let cells: WorldCellDocument[] = [];
  let warnings: string[] = [];
  if (enabled) {
    const split = partitionLayout(layout, normalizeWorldPartitionSettings(layout.worldSettings?.partition));
    layout = split.persistent;
    cells = [...split.cells.values()];
    warnings = split.warnings;
  } else {
    layout = { ...layout };
  }
  delete layout.worldCells;
  const keep = cells.map((cell) => cell.key).sort(compareWorldCellKeys);
  if (keep.length) layout.worldCells = keep;
  const previous = lastWrittenCells.get(level);
  const next = new Map(cells.map((cell) => [cell.key, JSON.stringify(cell)]));
  const changed = cells.filter((cell) => previous?.get(cell.key) !== next.get(cell.key));
  // Cells first, the level that indexes them second, stale cells last: a
  // failure at any step leaves the level on disk pointing at files that exist.
  let cellResult: SaveResponse = {};
  if (enabled && changed.length) cellResult = await postSave("/__save-world-cells", { level, cells: changed });
  const result = await postSave("/__save-layout", { layout, editor: payload.editor });
  await postSave("/__save-world-cells", { level, cells: [], keep });
  lastWrittenCells.set(level, next);
  const dropped = [...(cellResult.dropped ?? []), ...(result.dropped ?? [])];
  return {
    ...(result.path === undefined ? {} : { path: result.path }),
    ...(dropped.length ? { dropped } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(enabled ? { partition: {
      cells: cells.length,
      written: changed.length,
      streamed: cells.reduce((sum, cell) => sum + countWorldCellElements(cell), 0),
      persistent: countWorldCellElements(layout),
    } } : {}),
  };
}

interface SaveResponse {
  ok?: boolean;
  error?: string;
  path?: string;
  dropped?: string[];
}

async function postSave(endpoint: string, payload: unknown): Promise<SaveResponse> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(
      `Layout save endpoint is not reachable. Start the Forge editor dev server with \`npm.cmd run editor\` and open http://127.0.0.1:5173/?editor. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const body = (await response.json().catch(() => ({}))) as SaveResponse;
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Save failed: HTTP ${response.status}`);
  }
  return body;
}
