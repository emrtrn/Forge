import type { TerrainEditorStreaming } from "@engine/terrain/terrainEditorStreaming";
import { computeStreamingTargets } from "@engine/world/streamingPolicy";

/** Read-only completion witness; a quiet single frame can be between load batches. */
export function pendingTerrainLoads(app: { camera: { position: { x: number; z: number } }; worldTerrainStreams?: { values(): IterableIterator<TerrainEditorStreaming> } }): number {
  return [...(app.worldTerrainStreams?.values() ?? [])].reduce((sum, stream) => {
    const def = stream.world.def, size = def.tileQuads * def.spacing, resident = new Set(stream.world.tiles.keys()), declared = new Set(def.tiles.map((t) => t.key));
    const targets = computeStreamingTargets({ loaded: resident, active: resident }, [{ position: [app.camera.position.x, app.camera.position.z] }],
      { cellSize: size, origin: [def.origin[0], def.origin[2]], loadRange: size * 3 },
      { minX: def.origin[0], minZ: def.origin[2], maxX: def.origin[0] + def.tilesX * size, maxZ: def.origin[2] + def.tilesZ * size });
    return sum + stream.loading + targets.toLoad.filter((key) => declared.has(key)).length;
  }, 0);
}
