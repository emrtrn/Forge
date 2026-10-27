import type { LayoutLandscape } from "@engine/scene/layout";
import type { ForgeLandscapeData } from "@engine/scene/landscape";
import { acknowledgeTerrainSnapshot, captureTerrainSnapshot } from "@engine/terrain/terrainLandscapeBridge";
import type { TerrainEditWorld } from "@engine/terrain/terrainEdit";
import type { TerrainGlobalAttributes } from "@engine/terrain/terrainRenderSource";
import type { TerrainHeightFormat } from "@engine/terrain/terrainTileCodec";
import { terrainTilePath } from "@engine/terrain/terrainTypes";
import { captureWorldTerrainSave, reencodeTerrainTileRange } from "@engine/terrain/worldTerrainSave";
import { projectFileUrl } from "@/project/ProjectSystem";
import type { EditorSaveStep } from "./editorSaveCoordinator";

async function checkSave(response: Response): Promise<void> {
  if (!response.ok) throw new Error(`Terrain save: HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json() as { dropped?: string[] };
  if (result.dropped?.length) throw new Error(`Terrain save dropped fields: ${result.dropped.join(", ")}`);
}

/**
 * Edit state of one multi-tile World Terrain in the editor. Owns the editable
 * tiles (`world`), remembers each tile's on-disk height format, and keeps a
 * revision per tile and for the definition so a save acknowledges only data
 * not edited again while it was writing. Saves write in place to the actor's
 * `dataRef`: forking a whole tile grid into the level folder is not worth
 * copying every tile.
 *
 * A streaming editor (OPEN_WORLD_PLAN Faz 8) holds only part of the world:
 * `liveGlobal` then supplies the global map the renderer keeps current, and a
 * widened range re-encodes the unloaded tiles from disk.
 */
export class WorldTerrainEditSession {
  private readonly revisions = new Map<string, number>();
  private readonly saved = new Map<string, number>();
  private definitionRevision = 0;
  private savedDefinitionRevision = 0;

  constructor(
    readonly path: string,
    readonly world: TerrainEditWorld,
    private readonly formats: Map<string, TerrainHeightFormat>,
    private readonly liveGlobal: () => TerrainGlobalAttributes | undefined = () => undefined,
  ) {}

  /** A streamed tile keeps the height format it has on disk. */
  recordFormat(key: string, format: TerrainHeightFormat): void {
    this.formats.set(key, format);
  }

  /** Edited this session (saved or not): its data lives only here or in the undo history. */
  touched(key: string): boolean {
    return this.revisions.has(key);
  }

  markTiles(keys: Iterable<string>): void {
    for (const key of keys) this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
  }

  markDefinitionDirty(): void {
    this.definitionRevision += 1;
  }

  dirtyKeys(): string[] {
    return [...this.revisions].filter(([key, revision]) => this.saved.get(key) !== revision).map(([key]) => key);
  }

  /** Grows with every edit (tiles or definition): a cheap "terrain changed" signal for views. */
  get editRevision(): number {
    let total = this.definitionRevision;
    for (const revision of this.revisions.values()) total += revision;
    return total;
  }

  get dirty(): boolean {
    return this.definitionRevision !== this.savedDefinitionRevision || this.dirtyKeys().length > 0;
  }

  /** Snapshot now (before any await); tiles, global map, then the definition. */
  capture(): EditorSaveStep | null {
    const keys = this.dirtyKeys();
    if (keys.length === 0 && this.definitionRevision === this.savedDefinitionRevision) return null;
    const snapshot = captureWorldTerrainSave(this.world, keys, this.formats, this.liveGlobal());
    const definitionRevision = this.definitionRevision;
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
        // Unloaded, never-edited tiles: the disk copy is current; only its header range changes.
        for (const key of snapshot.reencode) {
          const tilePath = terrainTilePath(this.path, key);
          const response = await fetch(projectFileUrl(tilePath), { cache: "no-cache" });
          if (!response.ok) throw new Error(`Terrain save: cannot read ${tilePath} to widen its range (HTTP ${response.status})`);
          const bytes = reencodeTerrainTileRange(key, new Uint8Array(await response.arrayBuffer()), snapshot.def.heightMin, snapshot.def.heightMax);
          await checkSave(await fetch(`/__save-terrain-tile?path=${encodeURIComponent(this.path)}&key=${key}`, {
            method: "POST", headers: { "Content-Type": "application/octet-stream" },
            body: bytes.slice().buffer,
          }));
        }
        await checkSave(await fetch(`/__save-terrain-global?path=${encodeURIComponent(this.path)}`, {
          method: "POST", headers: { "Content-Type": "application/octet-stream" },
          body: snapshot.global.slice().buffer,
        }));
        await checkSave(await fetch("/__save-terrain", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
        // Later tile headers must use the range now on disk.
        this.world.def.heightMin = snapshot.def.heightMin;
        this.world.def.heightMax = snapshot.def.heightMax;
        if (this.definitionRevision === definitionRevision) this.savedDefinitionRevision = definitionRevision;
        for (const [key, revision] of captured) {
          if (this.revisions.get(key) === revision) this.saved.set(key, revision);
        }
      },
    };
  }
}

/** Definition follows tile and global map; a failed migration leaves the legacy reference usable. */
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
      await checkSave(await fetch(`/__save-terrain-global?path=${encodeURIComponent(snapshot.path)}`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" },
        body: snapshot.global.slice().buffer,
      }));
      await checkSave(await fetch("/__save-terrain", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
      acknowledgeTerrainSnapshot(data, snapshot.def);
    },
  };
}
