import { WorldPartitionStreaming, type WorldPartitionHooks, type WorldPartitionSnapshot } from "@engine/world/worldPartitionStreaming";
import type { WorldPartitionGridSettings } from "@engine/world/worldPartition";
import type { StreamingSource } from "@engine/world/streamingPolicy";
import type { CapabilityModule } from "./CapabilityModule";
import { runtimeServiceKey } from "./RuntimeServices";

interface WorldPartitionCommands {
  configure(settings: WorldPartitionGridSettings, cells: ReadonlyMap<string, readonly number[]>, hooks: WorldPartitionHooks, debug: boolean): void;
  prepare(position: readonly [number, number]): void;
  startSimulation(): void;
  update(sources: readonly StreamingSource[]): void;
  snapshot(): WorldPartitionSnapshot | null;
}

export const worldPartitionService = runtimeServiceKey<WorldPartitionCommands>("world-partition");

export function createWorldPartitionModule(): CapabilityModule {
  let stream: WorldPartitionStreaming | null = null;
  let live = false;
  const clear = () => {
    stream?.clear();
    stream = null;
    live = false;
  };
  return {
    id: "world-partition",
    onRuntimeStart(services) {
      services.provide(worldPartitionService, {
        configure(settings, cells, hooks, debug) {
          clear();
          stream = new WorldPartitionStreaming(settings, cells, {
            ...hooks,
            cellChanged: (key, active) => {
              hooks.cellChanged?.(key, active);
              if (debug) console.info(`[world-partition] ${active ? "activated" : "unloaded"} ${key}`);
            },
          });
        },
        prepare: (position) => stream?.prepare(position),
        startSimulation: () => { live = true; },
        update: (sources) => { if (live) stream?.update(sources); },
        snapshot: () => stream?.snapshot() ?? null,
      });
    },
    onLevelUnloaded: clear,
    dispose: clear,
  };
}
