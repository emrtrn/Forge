import type { LayoutLandscape } from "@engine/scene/layout";
import type { ForgeLandscapeData } from "@engine/scene/landscape";
import { acknowledgeTerrainSnapshot, captureTerrainSnapshot } from "@engine/terrain/terrainLandscapeBridge";
import type { TerrainEditWorld } from "@engine/terrain/terrainEdit";
import type { TerrainHeightFormat } from "@engine/terrain/terrainTileCodec";
import { captureWorldTerrainSave } from "@engine/terrain/worldTerrainSave";
import type { EditorSaveStep } from "./editorSaveCoordinator";

async function checkSave(response: Response): Promise<void> {
  if (!response.ok) throw new Error(`Terrain save: HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json() as { dropped?: string[] };
  if (result.dropped?.length) throw new Error(`Terrain save dropped fields: ${result.dropped.join(", ")}`);
}

/**
 * Edit state of one multi-tile World Terrain in the editor. Owns the editable
 * tiles (`world`), remembers each tile's on-disk height format, and keeps a
 * revision per tile so a save acknowledges only tiles not edited again while
 * it was writing. Saves write in place to the actor's `dataRef`: forking a
 * whole tile grid into the level folder is not worth copying every tile.
 */
export class WorldTerrainEditSession {
  private readonly revisions = new Map<string, number>();
  private readonly saved = new Map<string, number>();

  constructor(
    readonly path: string,
    readonly world: TerrainEditWorld,
    private readonly formats: ReadonlyMap<string, TerrainHeightFormat>,
  ) {}

  markTiles(keys: Iterable<string>): void {
    for (const key of keys) this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
  }

  dirtyKeys(): string[] {
    return [...this.revisions].filter(([key, revision]) => this.saved.get(key) !== revision).map(([key]) => key);
  }

  get dirty(): boolean {
    return this.dirtyKeys().length > 0;
  }

  /** Snapshot now (before any await); tiles first, then the definition that cross-checks them. */
  capture(): EditorSaveStep | null {
    const keys = this.dirtyKeys();
    if (keys.length === 0) return null;
    const snapshot = captureWorldTerrainSave(this.world, keys, this.formats);
    const captured = new Map(keys.map((key) => [key, this.revisions.get(key)!] as const));
    const body = JSON.stringify({ path: this.path, terrain: snapshot.def });
    return {
      path: this.path,
      write: async () => {
        for (const tile of snapshot.tiles) {
          await checkSave(await fetch(`/__save-terrain-tile?path=${encodeURIComponent(this.path)}&key=${tile.key}`, {
            method: "POST", headers: { "Content-Type": "application/octet-stream" },
            body: tile.bytes.slice().buffer,
          }));
        }
        await checkSave(await fetch("/__save-terrain", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
        // Later tile headers must use the range now on disk.
        this.world.def.heightMin = snapshot.def.heightMin;
        this.world.def.heightMax = snapshot.def.heightMax;
        for (const [key, revision] of captured) {
          if (this.revisions.get(key) === revision) this.saved.set(key, revision);
        }
      },
    };
  }
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
