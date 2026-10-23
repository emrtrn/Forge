import type { Entity } from "../scene/entity";
import { computeStreamingTargets, type GridStreamingSettings, type StreamingSource } from "../world/streamingPolicy";
import { WorldStreamingSubsystem } from "../world/worldStreamingSubsystem";
import type { WorldTerrainDocument } from "./terrainLoader";
import { createFlatTerrainTile, parseTileKey, terrainTileWorldSize, type TerrainTileData } from "./terrainTypes";
import { worldTerrainColliderEntities, worldTerrainColliderEntityId } from "./worldTerrainActor";

export interface TerrainStreamingHooks {
  fetch(key: string, signal: AbortSignal): Promise<TerrainTileData>;
  changed(key: string): void;
  addColliders(entities: Entity[]): void;
  removeColliders(ids: string[]): void;
  clock(): number;
  warn(message: string): void;
}

/** Terrain-only ownership adapter. The streaming core owns passive LRU payloads;
 * the document exposes only activated render data, and physics has a smaller ring. */
export class TerrainRuntimeStreaming {
  readonly world: WorldStreamingSubsystem<TerrainTileData | null>;
  readonly colliders = new Map<string, Entity>();
  readonly residentTiles = new Set<TerrainTileData>();
  lastFrameMs = 0;
  private readonly declared: Set<string>;
  private readonly settings: GridStreamingSettings;
  private readonly bounds;
  private sources: readonly StreamingSource[] = [];
  private activations = 0;
  readonly physicsRange: number;

  constructor(
    readonly document: WorldTerrainDocument,
    private readonly actor: { id: string; name: string; collision: boolean },
    private readonly hooks: TerrainStreamingHooks,
    memoryBudgetBytes?: number,
  ) {
    const { def, tiles } = document;
    const size = terrainTileWorldSize(def);
    this.declared = new Set(def.tiles.map(({ key }) => key));
    this.physicsRange = Math.max(4, size * 0.75);
    const renderRange = Math.max(8, size * 2);
    this.settings = { cellSize: size, origin: [def.origin[0], def.origin[2]], loadRange: renderRange, activateRange: renderRange };
    this.bounds = { minX: def.origin[0], minZ: def.origin[2], maxX: def.origin[0] + def.tilesX * size, maxZ: def.origin[2] + def.tilesZ * size };
    const tileBytes = (def.tileQuads + 1) ** 2 * (4 + Math.ceil(def.layers.length / 4) * 4);
    this.world = new WorldStreamingSubsystem({
      settings: this.settings, bounds: this.bounds, clock: hooks.clock,
      memoryBudgetBytes: memoryBudgetBytes ?? tileBytes * 4,
      warn: hooks.warn,
      loader: {
        fetch: (key, signal) => this.declared.has(key) ? hooks.fetch(key, signal) : Promise.resolve(null),
        byteSize: (tile) => {
          if (tile) this.residentTiles.add(tile);
          return tile ? tile.heights.byteLength + tile.weights.byteLength : 0;
        },
        activate: (key, tile) => {
          if (!tile) return;
          this.activations += 1;
          tiles.set(key, tile);
          hooks.changed(key);
          // Collider creation shares the core's atomic activation time slice.
          if (this.physicsTargets().has(key)) this.addCollider(key, tile);
        },
        deactivate: (key, tile) => {
          if (!tile) return;
          this.removeCollider(key);
          tiles.delete(key);
          hooks.changed(key);
        },
        dispose: (_key, tile) => { if (tile) this.residentTiles.delete(tile); },
        fallback: (key) => {
          if (!this.declared.has(key)) return null;
          const { x, z } = parseTileKey(key)!;
          const tile = createFlatTerrainTile(def, x, z);
          const summary = def.tiles.find((entry) => entry.key === key)!;
          tile.heights.fill(summary.minHeight);
          return tile;
        },
      },
    });
  }

  update(sources: readonly StreamingSource[], viewDistanceMultiplier = 1): void {
    const started = this.hooks.clock();
    this.activations = 0;
    this.sources = sources;
    // Physics is never scaled below its safety ring by a graphics preference.
    this.settings.viewDistanceMultiplier = Math.max(0.5, viewDistanceMultiplier);
    this.world.update(sources);
    const wanted = this.physicsTargets();
    const removed = [...this.colliders.keys()].filter((key) => !wanted.has(key));
    if (removed.length) {
      this.hooks.removeColliders(removed.map((key) => this.colliders.get(key)!.id));
      for (const key of removed) this.colliders.delete(key);
    }
    for (const key of wanted) {
      if (this.activations > 0 && this.hooks.clock() - started >= 4) break;
      const tile = this.document.tiles.get(key);
      if (tile && !this.colliders.has(key) && this.actor.collision) {
        // Even when policy work consumed the frame, one atomic activation must
        // make progress or a busy frame could hold the pawn indefinitely.
        this.addCollider(key, tile);
        this.activations += 1;
      }
    }
    this.lastFrameMs = Math.max(0, this.hooks.clock() - started);
  }

  /** Only declared terrain blocks motion: holes and positions outside it remain traversable. */
  canOccupy(position: readonly [number, number], radius = 1): boolean {
    if (!this.actor.collision) return true;
    const needed = computeStreamingTargets({ loaded: new Set(), active: new Set() }, [{ position }], {
      ...this.settings, loadRange: radius, activateRange: radius, viewDistanceMultiplier: 1,
    }, this.bounds).toLoad;
    return needed.every((key) => !this.declared.has(key) || this.colliders.has(key));
  }

  dispose(): void { this.world.dispose(); }

  private physicsTargets(): Set<string> {
    const targets = computeStreamingTargets({ loaded: new Set(this.document.tiles.keys()), active: new Set(this.colliders.keys()) }, this.sources, {
      ...this.settings, loadRange: this.physicsRange, activateRange: this.physicsRange, viewDistanceMultiplier: 1,
    }, this.bounds);
    const wanted = new Set(this.colliders.keys());
    for (const key of targets.toDeactivate) wanted.delete(key);
    for (const key of targets.toActivate) if (this.declared.has(key)) wanted.add(key);
    return wanted;
  }

  private addCollider(key: string, tile: TerrainTileData): void {
    if (this.colliders.has(key) || !this.actor.collision) return;
    const entities = worldTerrainColliderEntities(this.actor, { def: { ...this.document.def, tiles: this.document.def.tiles.filter((entry) => entry.key === key) }, tiles: new Map([[key, tile]]) });
    const entity = entities[0];
    if (!entity) return;
    this.hooks.addColliders(entities);
    this.colliders.set(key, entity);
  }

  private removeCollider(key: string): void {
    if (!this.colliders.delete(key)) return;
    this.hooks.removeColliders([worldTerrainColliderEntityId(this.actor.id, key)]);
  }
}
