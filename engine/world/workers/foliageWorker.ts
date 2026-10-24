import type { ForgeFoliageTypeDef, LandscapeFoliageRule } from "../../scene/foliage";
import { FoliageTerrainStore, type FoliageCellRequest } from "../../scene/proceduralFoliage";
import type { TerrainQueryDef } from "../../terrain/terrainHeightQuery";
import type { TerrainTileData } from "../../terrain/terrainTypes";

/** Terrain updates are ordered before jobs that read their resident tiles. */
export type FoliageWorkerRequest =
  | { type: "terrain"; terrainId: string; def: TerrainQueryDef & { layers: readonly { id: string }[] } }
  | { type: "tile"; terrainId: string; tile: TerrainTileData }
  | { type: "removeTile"; terrainId: string; x: number; z: number }
  | { type: "removeTerrain"; terrainId: string }
  | { type: "generate"; id: number; job: {
    terrainId: string; rule: LandscapeFoliageRule; type: ForgeFoliageTypeDef; request: FoliageCellRequest;
  } };

/** Generated matrices are transferred back; an unscoped error disables the worker. */
export type FoliageWorkerResponse =
  | { type: "generated"; id: number; count: number; matrices: Float32Array }
  | { type: "error"; id: number | null; message: string };

const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<FoliageWorkerRequest>) => void): void;
  postMessage(message: FoliageWorkerResponse, transfer?: ArrayBuffer[]): void;
};
const store = new FoliageTerrainStore();

scope.addEventListener("message", ({ data }) => {
  let id: number | null = null;
  try {
    if (!data || typeof data !== "object") throw new Error("Invalid foliage worker request");
    switch (data.type) {
      case "terrain": store.setTerrain(data.terrainId, data.def); break;
      case "tile": store.setTile(data.terrainId, data.tile); break;
      case "removeTile": store.removeTile(data.terrainId, data.x, data.z); break;
      case "removeTerrain": store.removeTerrain(data.terrainId); break;
      case "generate": {
        id = data.id;
        const { terrainId, rule, type, request } = data.job;
        const result = store.generate(terrainId, rule, type, request);
        scope.postMessage({ type: "generated", id, ...result }, [result.matrices.buffer as ArrayBuffer]);
        break;
      }
      default: throw new Error("Invalid foliage worker request");
    }
  } catch (error) {
    scope.postMessage({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  }
});
