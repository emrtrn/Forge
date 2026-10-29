import { loadRecastModules, type RecastModules } from "../recastNavMesh";
import {
  buildRecastTileBytes,
  createTileRcConfig,
  type RecastRcConfig,
  type RecastTileConfig,
  type RecastTileInput,
} from "../recastTileBuild";

/**
 * Off-main-thread Recast tile builds (OPEN_WORLD_PLAN Faz 9, R3b). Each request
 * carries the mesh's plain {@link RecastTileConfig} and one tile's input (its
 * triangle buffer transferred); the reply transfers the Detour tile bytes back.
 * The worker owns its own wasm instance and caches one Recast config per
 * distinct tile config.
 */
export type RecastTileWorkerRequest = { readonly id: number; readonly config: RecastTileConfig; readonly input: RecastTileInput };
export type RecastTileWorkerResponse =
  | { readonly type: "ready" }
  | { readonly type: "built"; readonly id: number; readonly bytes: Uint8Array | null }
  | { readonly type: "error"; readonly id: number | null; readonly message: string };

/** The request handler, separate from the worker scope so tests can drive it directly. */
export function createRecastTileHandler(modules: RecastModules): (request: RecastTileWorkerRequest) => Uint8Array | null {
  const configs = new Map<string, RecastRcConfig>();
  return ({ config, input }) => {
    const key = JSON.stringify(config);
    let rcConfig = configs.get(key);
    if (!rcConfig) {
      rcConfig = createTileRcConfig(modules.core, config);
      configs.set(key, rcConfig);
    }
    return buildRecastTileBytes(modules.core, rcConfig, config, input);
  };
}

// A local scope type avoids mixing DOM and WebWorker library declarations.
const scope = globalThis as unknown as {
  addEventListener?(type: "message", listener: (event: MessageEvent<RecastTileWorkerRequest>) => void): void;
  postMessage(message: RecastTileWorkerResponse, transfer?: ArrayBuffer[]): void;
};

// Only inside a worker: importing this module elsewhere (tests) registers nothing.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined" && scope.addEventListener) {
  const handler = loadRecastModules().then(
    (modules) => {
      scope.postMessage({ type: "ready" });
      return createRecastTileHandler(modules);
    },
    (error: unknown) => {
      scope.postMessage({ type: "error", id: null, message: error instanceof Error ? error.message : String(error) });
      return null;
    },
  );
  scope.addEventListener("message", ({ data }) => {
    void handler.then((handle) => {
      if (!handle) return;
      const id = data && typeof data.id === "number" ? data.id : null;
      try {
        if (id === null || !data.config || !data.input || !(data.input.positions instanceof Float32Array)) {
          throw new Error("Invalid Recast tile request");
        }
        const bytes = handle(data);
        scope.postMessage({ type: "built", id, bytes }, bytes ? [bytes.buffer as ArrayBuffer] : []);
      } catch (error) {
        scope.postMessage({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
      }
    });
  });
}
