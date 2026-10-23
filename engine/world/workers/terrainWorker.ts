import { ContentLoadError, type ContentFailure } from "../../assets/contentValidation";
import { normalizeWorldTerrain } from "../../terrain/terrainDefinition";
import { decodeTerrainTileForStreaming, type StreamingTerrainTile } from "../../terrain/terrainTileStreaming";
import { tileKey, type WorldTerrainDef } from "../../terrain/terrainTypes";

/** Initialize once per terrain, then transfer each request's bytes to this worker. */
export type TerrainWorkerRequest = { type: "init"; def: WorldTerrainDef } | { key: string; bytes: ArrayBuffer };
export type TerrainWorkerResponse =
  | { type: "ready" }
  | { type: "decoded"; key: string; payload: StreamingTerrainTile }
  | { type: "error"; key: string | null; error: { name: string; message: string; reason: ContentFailure } };

// A local scope type avoids mixing DOM and WebWorker library declarations.
const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<TerrainWorkerRequest>) => void): void;
  postMessage(message: TerrainWorkerResponse, transfer?: ArrayBuffer[]): void;
};
let definition: WorldTerrainDef | null = null;

scope.addEventListener("message", ({ data }) => {
  let key: string | null = null;
  try {
    if (!data || typeof data !== "object") throw new Error("Invalid terrain worker request");
    if ("type" in data && data.type === "init") {
      definition = null;
      definition = normalizeWorldTerrain(data.def);
      scope.postMessage({ type: "ready" });
      return;
    }
    if (!("key" in data) || typeof data.key !== "string") {
      throw new Error("Invalid terrain worker request");
    }
    key = data.key;
    if (!(data.bytes instanceof ArrayBuffer)) throw new Error("Invalid terrain worker bytes");
    if (!definition) throw new Error("Terrain worker requires init before decoding");
    const payload = decodeTerrainTileForStreaming(data.bytes, definition);
    const header = new DataView(data.bytes);
    if (tileKey(header.getInt32(20, true), header.getInt32(24, true)) !== key) {
      throw new Error(`terrain tile ${key} header does not match request`);
    }
    scope.postMessage({ type: "decoded", key, payload }, payload.transfer);
  } catch (error) {
    scope.postMessage({ type: "error", key, error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      reason: error instanceof ContentLoadError ? error.reason : "invalid-data",
    } });
  }
});
