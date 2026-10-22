import type { LayoutLandscape } from "@engine/scene/layout";
import type { ForgeLandscapeData } from "@engine/scene/landscape";
import { acknowledgeTerrainSnapshot, captureTerrainSnapshot } from "@engine/terrain/terrainLandscapeBridge";

async function checkSave(response: Response): Promise<void> {
  if (!response.ok) throw new Error(`Terrain save: HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json() as { dropped?: string[] };
  if (result.dropped?.length) throw new Error(`Terrain save dropped fields: ${result.dropped.join(", ")}`);
}

/** Definition is committed after its tile; a failed migration leaves the legacy reference usable. */
export function captureTerrainWrite(actor: LayoutLandscape, data: ForgeLandscapeData) {
  const snapshot = captureTerrainSnapshot(actor, data);
  const body = JSON.stringify({ path: snapshot.path, terrain: snapshot.def });
  return {
    path: snapshot.path,
    write: async (): Promise<void> => {
      // Binary size/header are validated here; definition commit cross-checks the tile on disk.
      await checkSave(await fetch(`/__save-terrain-tile?path=${encodeURIComponent(snapshot.path)}&key=0_0`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" },
        body: snapshot.bytes.slice().buffer,
      }));
      await checkSave(await fetch("/__save-terrain", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
      acknowledgeTerrainSnapshot(data, snapshot.def);
    },
  };
}
