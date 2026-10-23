import { computeStreamingTargets, type GridStreamingSettings, type StreamingSource } from "../world/streamingPolicy";
import { insertTerrainEditTile, type TerrainEditWorld } from "./terrainEdit";
import { terrainTileWorldSize, type TerrainTileData, type WorldTerrainDef } from "./terrainTypes";

/**
 * A World Terrain with more tiles than this streams in the editor (more than
 * 6×6); smaller ones keep every tile resident, as before.
 */
export const EDITOR_TERRAIN_STREAMING_MAX_EAGER_TILES = 36;

export function editorStreamsTerrain(def: Pick<WorldTerrainDef, "tiles">): boolean {
  return def.tiles.length > EDITOR_TERRAIN_STREAMING_MAX_EAGER_TILES;
}

export interface TerrainEditorStreamingHooks {
  /** Reads and validates one tile against the edit world's current definition. */
  fetch(key: string, signal: AbortSignal): Promise<TerrainTileData>;
  /** A tile entered or left the edit world: the renderer refreshes it. */
  changed(key: string): void;
  /**
   * Edited this session. A pinned tile never leaves the edit world: it holds
   * unsaved data, and the undo history may write to it again.
   */
  pinned(key: string): boolean;
  warn(message: string): void;
}

export interface TerrainEditorStreamingOptions {
  /** Load radius around each source, in tiles (default 3). */
  rangeTiles?: number;
  maxConcurrentFetches?: number;
}

/**
 * Editor residency for one multi-tile World Terrain (OPEN_WORLD_PLAN Faz 8):
 * tiles load around the editor camera into the same edit world the brush
 * writes, and leave it past the hysteresis ring unless pinned or held.
 *
 * Unlike runtime streaming there is no passive cache: the editor's source of
 * truth for a tile is either the edit world (edited, pinned) or the file on
 * disk, so a dropped tile is simply read again. A fetch never replaces a tile
 * the world already holds, which is what keeps an edited tile from being
 * overwritten by its older copy on disk.
 */
export class TerrainEditorStreaming {
  private readonly declared: Set<string>;
  private readonly settings: GridStreamingSettings;
  private readonly bounds;
  private readonly maxConcurrent: number;
  private readonly inFlight = new Map<string, { controller: AbortController; done: Promise<void> }>();
  /** Requested by a brush stroke or a whole-terrain operation; kept until released. */
  private readonly held = new Set<string>();
  private disposed = false;

  constructor(
    readonly world: TerrainEditWorld,
    private readonly hooks: TerrainEditorStreamingHooks,
    options: TerrainEditorStreamingOptions = {},
  ) {
    const { def } = world;
    const size = terrainTileWorldSize(def);
    this.declared = new Set(def.tiles.map(({ key }) => key));
    this.settings = { cellSize: size, origin: [def.origin[0], def.origin[2]], loadRange: size * (options.rangeTiles ?? 3) };
    this.bounds = { minX: def.origin[0], minZ: def.origin[2], maxX: def.origin[0] + def.tilesX * size, maxZ: def.origin[2] + def.tilesZ * size };
    this.maxConcurrent = options.maxConcurrentFetches ?? 6;
  }

  get loading(): number {
    return this.inFlight.size;
  }

  get allResident(): boolean {
    return [...this.declared].every((key) => this.world.tiles.has(key));
  }

  /** Loads around `sources`, drops what is out of range, cancels unwanted reads. */
  update(sources: readonly StreamingSource[]): void {
    if (this.disposed) return;
    const resident = new Set(this.world.tiles.keys());
    const targets = computeStreamingTargets(
      { loaded: new Set([...resident, ...this.inFlight.keys()]), active: resident }, sources, this.settings, this.bounds,
    );
    for (const key of targets.toUnload) {
      if (this.held.has(key)) continue;
      const flight = this.inFlight.get(key);
      if (flight) {
        flight.controller.abort();
        this.inFlight.delete(key);
        continue;
      }
      if (!resident.has(key) || this.hooks.pinned(key)) continue;
      this.world.tiles.delete(key);
      this.hooks.changed(key);
    }
    for (const key of targets.toLoad) {
      if (this.inFlight.size >= this.maxConcurrent) break;
      // Grid holes are never fetched; an update-started read reports its own failure.
      if (this.declared.has(key)) this.start(key).catch(() => {});
    }
  }

  /**
   * Makes `keys` resident and holds them until {@link release}. Resolves once
   * every declared key is in the edit world; rejects if a read fails.
   */
  demand(keys: Iterable<string>): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const key of keys) {
      if (!this.declared.has(key)) continue;
      this.held.add(key);
      if (this.world.tiles.has(key)) continue;
      waits.push(this.inFlight.get(key)?.done ?? this.start(key));
    }
    return Promise.all(waits).then(() => {});
  }

  /** Every declared tile, held: whole-terrain operations (RAW import/export). */
  demandAll(): Promise<void> {
    return this.demand(this.declared);
  }

  /** Lets held tiles go; the next update drops those out of range and unpinned. */
  release(keys: Iterable<string> = [...this.held]): void {
    for (const key of keys) this.held.delete(key);
  }

  dispose(): void {
    this.disposed = true;
    for (const { controller } of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
    this.held.clear();
  }

  private start(key: string): Promise<void> {
    const controller = new AbortController();
    const entry = { controller, done: Promise.resolve() };
    entry.done = this.hooks.fetch(key, controller.signal).then((tile) => {
      if (this.disposed || this.inFlight.get(key) !== entry) throw new Error(`terrain tile ${key} read was cancelled`);
      this.inFlight.delete(key);
      if (this.world.tiles.has(key)) return;
      insertTerrainEditTile(this.world, tile);
      this.hooks.changed(key);
    }, (error: unknown) => {
      if (this.inFlight.get(key) === entry) {
        this.inFlight.delete(key);
        this.hooks.warn(`[terrain] tile ${key} could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    });
    this.inFlight.set(key, entry);
    return entry.done;
  }
}
