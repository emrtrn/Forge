import { ContentLoadError } from "@engine/assets/contentValidation";
import type { Entity } from "@engine/scene/entity";
import { TerrainRuntimeStreaming, type TerrainStreamingDebugGrid, type TerrainStreamingHooks } from "@engine/terrain/terrainRuntimeStreaming";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { parseTileKey, terrainTilePath } from "@engine/terrain/terrainTypes";
import type { StreamingSource } from "@engine/world/streamingPolicy";
import { projectFileUrl } from "@/project/ProjectSystem";
import type { CapabilityModule } from "./CapabilityModule";
import { runtimeServiceKey } from "./RuntimeServices";
import { TerrainWorkerPool } from "./terrainWorkerPool";

export interface TerrainStreamingSnapshot {
  loaded: number;
  active: number;
  queued: number;
  physics: number;
  bytesResident: number;
  lastFrameMs: number;
  held: boolean;
  activeKeys: string[];
  colliderKeys: string[];
  /** One per streamed terrain, for the `?debug` map. */
  grids: TerrainStreamingDebugGrid[];
  /** World X/Z of the last update's streaming sources. */
  sources: (readonly [number, number])[];
}

interface WorldStreamingCommands {
  hasTerrain(): boolean;
  add(path: string, document: WorldTerrainDocument, actor: { id: string; name: string; collision: boolean }, hooks: Pick<TerrainStreamingHooks, "changed" | "addColliders" | "removeColliders">): void;
  prepareSpawn(position: readonly [number, number]): Promise<void>;
  /** True when a pawn at `position` would not be held (same footprint as the hold rule). */
  areaReady(position: readonly [number, number]): boolean;
  startSimulation(): void;
  entities(): Entity[];
  update(sources: readonly StreamingSource[], multiplier: number): boolean;
  canOccupy(position: readonly [number, number]): boolean;
  snapshot(): TerrainStreamingSnapshot | null;
}

export const worldStreamingService = runtimeServiceKey<WorldStreamingCommands>("world-streaming");

export function createWorldStreamingModule(): CapabilityModule {
  const entries: { stream: TerrainRuntimeStreaming; pool: TerrainWorkerPool; addColliders: TerrainStreamingHooks["addColliders"] }[] = [];
  let live = false;
  let held = false;
  let lastSources: readonly StreamingSource[] = [];
  const clear = () => {
    for (const { stream, pool } of entries) { stream.dispose(); pool.dispose(); }
    entries.length = 0;
    live = false;
    held = false;
    lastSources = [];
  };
  const areaReady = (position: readonly [number, number]) => entries.every(({ stream }) => stream.canOccupy(position, 2));
  const update = (sources: readonly StreamingSource[], multiplier: number) => {
    for (const { stream } of entries) stream.update(sources, multiplier);
    lastSources = sources;
    held = sources.some(({ position }) => !areaReady(position));
    return held;
  };
  return {
    id: "world-streaming",
    onRuntimeStart(services) {
      services.provide(worldStreamingService, {
        hasTerrain: () => entries.length > 0,
        add(path, document, actor, hooks) {
          const pool = new TerrainWorkerPool(document.def);
          const stream = new TerrainRuntimeStreaming(document, actor, {
            ...hooks, clock: () => performance.now(), warn: (message) => console.warn(message),
            addColliders: (entities) => { if (live) hooks.addColliders(entities); },
            removeColliders: (ids) => { if (live) hooks.removeColliders(ids); },
            fetch: async (key, signal) => {
              const tilePath = terrainTilePath(path, key);
              let response: Response;
              try { response = await fetch(projectFileUrl(tilePath), { signal }); }
              catch (cause) { throw new ContentLoadError(tilePath, "network", "tile fetch failed", { cause }); }
              if (!response.ok) throw new ContentLoadError(tilePath, "http", `HTTP ${response.status}`);
              const payload = await pool.decode(key, await response.arrayBuffer(), signal);
              const { x, z } = parseTileKey(key)!;
              // The worker's RGBA blocks share a single transferred buffer.
              return { x, z, size: document.def.tileQuads + 1, heights: payload.heights,
                layerCount: document.def.layers.length, weights: payload.weights.length ? new Uint8Array(payload.weights[0]!.buffer) : new Uint8Array() };
            },
          });
          entries.push({ stream, pool, addColliders: hooks.addColliders });
        },
        async prepareSpawn(position) {
          if (!entries.length) return;
          const waits = entries.map(({ stream }) => stream.world.waitForArea(position, Math.min(2, stream.physicsRange)));
          let ready = false;
          let failure: unknown;
          const waiting = Promise.all(waits).then(() => { ready = true; }, (error: unknown) => { failure = error; ready = true; });
          while (!ready || (!failure && !areaReady(position))) {
            update([{ position }], 1);
            await new Promise<void>((resolve) => setTimeout(resolve, 8));
          }
          await waiting;
          if (failure) throw failure;
        },
        areaReady,
        startSimulation() {
          if (live) return;
          live = true;
          for (const { stream, addColliders } of entries) addColliders([...stream.colliders.values()]);
        },
        entities: () => entries.flatMap(({ stream }) => [...stream.colliders.values()]),
        update: (sources, multiplier) => live ? update(sources, multiplier) : false,
        canOccupy: (position) => entries.every(({ stream }) => stream.canOccupy(position)),
        snapshot() {
          if (!entries.length) return null;
          const result: TerrainStreamingSnapshot = {
            loaded: 0, active: 0, queued: 0, physics: 0, bytesResident: 0, lastFrameMs: 0, held, activeKeys: [], colliderKeys: [],
            grids: [], sources: lastSources.map(({ position }) => position),
          };
          for (const { stream } of entries) {
            const stats = stream.world.stats();
            result.loaded += stream.residentTiles.size;
            result.active += stream.document.tiles.size;
            result.queued += stats.queued + stats.inFlight;
            result.physics += stream.colliders.size;
            result.bytesResident += stats.bytesResident;
            result.lastFrameMs += stream.lastFrameMs;
            result.activeKeys.push(...stream.document.tiles.keys());
            result.colliderKeys.push(...stream.colliders.keys());
            result.grids.push(stream.debugGrid());
          }
          return result;
        },
      });
    },
    onLevelUnloaded: clear,
    dispose: clear,
  };
}
