/** Ridgebound P1: native-resolution source raster crop, not a road or settlement generator. */
import { decodeHeightmapPng, encodeHeightmapPng16 } from "../../engine/terrain/heightmapPng";
import { cropHeightmapSamples, heightmapWindowForBounds, type HeightmapWindow } from "../../engine/terrain/heightmapWindow";
import { heightmapSamplesToRaw } from "../../engine/terrain/terrainImport";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { createWorldTerrainFromHeightmap } from "../../engine/terrain/worldTerrainCreate";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";
import { terrainTilePath, terrainGlobalMapPath } from "../../engine/terrain/terrainTypes";
import { isRecord } from "../../engine/worldbuilder/normalize";
import { buildRidgeboundPreview, type RidgeboundImportReport } from "./ridgeboundSpatial";

export const RIDGEBOUND_HEIGHTMAP_ID = "1mVdVcTWfzyOvJNAZkd6bvF2OtdIZfNU5";
export const RIDGEBOUND_HEIGHTMAP_SHA256 = "bc0c67e06eded7f5533c582d540420b7963d33e46d7c131a1fa7cbf8ae623934";
export const RIDGEBOUND_TERRAIN_LEVEL = "layouts/RidgeboundP1.level.json";
export const RIDGEBOUND_TERRAIN_RECIPE = "layouts/RidgeboundP1.worldrecipe.json";
export const RIDGEBOUND_TERRAIN_REF = "layouts/RidgeboundP1.landscapes/pilot.terrain.json";

export interface RidgeboundTerrainReport extends Omit<RidgeboundImportReport, "status"> {
  status: "SOURCE_TERRAIN_PREVIEW_NOT_ROAD_OR_DRIVING_ACCEPTANCE";
  heightmap: { fileId: string; sha256: string; width: number; height: number; spacing: number; heightMin: number; heightMax: number };
  grid: { choice: "TECHNICAL_TEST_ONLY_NOT_APPROVED_SPATIAL"; window: HeightmapWindow; margin: number; tileQuads: number; spacing: number; extent: [number, number]; origin: [number, number, number]; sampling: "EXACT_U16_CROP_NO_RESAMPLING" };
  groundCheckpoints: Array<{ id: string; x: number; z: number; worldHeight: number }>;
}

export async function buildRidgeboundTerrainPreview(value: unknown, masterSha: string, png: Uint8Array, pngSha: string) {
  if (!/^[a-f0-9]{64}$/.test(pngSha)) throw new Error("Expected heightfield SHA-256");
  const preview = buildRidgeboundPreview(value, masterSha);
  if (!isRecord(value) || !isRecord(value.terrain) || value.terrain.macro_samples !== 1001
    || value.terrain.u16_min_m !== 100 || value.terrain.u16_max_m !== 850
    || preview.report.sourceExtent.join(",") !== "0,6000,0,6000") throw new Error("Unsupported v0.2 macro heightmap extent/encoding; update the adapter explicitly");
  const image = await decodeHeightmapPng(png, { maxSize: 1001 });
  if (image.width !== 1001 || image.height !== 1001 || image.bitDepth !== 16 || image.colorType !== 0) throw new Error("Expected 1001×1001 16-bit grayscale macro PNG");
  // Alignment preserves the 6 m source lattice exactly. A 1 m grid would not add source detail.
  const source = { width: image.width, height: image.height, spacing: 6, origin: [0, 0] as const };
  const points = [...preview.report.checkpoints.map(c => c.world), ...preview.recipe.plan.roadGraph.edges.flatMap(e => e.guide ?? [])];
  const bounds = {
    min: [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))] as [number, number],
    max: [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))] as [number, number],
  };
  const tileQuads = 64, margin = 100;
  const window = heightmapWindowForBounds(source, bounds, tileQuads, margin);
  const samples = cropHeightmapSamples(source, image.samples, window);
  const world = createWorldTerrainFromHeightmap({
    name: "Ridgebound source terrain — test grid", tilesX: window.tilesX, tilesZ: window.tilesZ,
    tileQuads, spacing: 6, baseHeight: 0,
  }, { bytes: heightmapSamplesToRaw(samples), width: window.width, height: window.height,
    heightMin: 100, heightMax: 850, endianness: "little" });
  world.def.origin = [window.x * 6, 0, window.z * 6];
  const level = structuredClone(preview.level);
  level.name = "Ridgebound P1 — source terrain, no authored roads";
  level.worldSettings = { ...level.worldSettings, viewDistance: 8000 };
  level.skyAtmosphere = { rayleigh: 1.4, turbidity: 3, mie: 0.003 };
  level.landscapes = [{ id: "ridgebound-pilot", name: "Ridgebound P1 terrain", position: worldTerrainActorPosition(world.def), dataRef: RIDGEBOUND_TERRAIN_REF }];
  const recipe = structuredClone(preview.recipe);
  recipe.recipeId = "ridgebound_p1_terrain";
  const lookup = { tile: (x: number, z: number) => world.tiles.get(`${x}_${z}`) };
  const groundCheckpoints = preview.report.checkpoints.map(c => {
    const height = terrainHeightAt(world.def, lookup, ...c.world);
    if (height === null) throw new Error(`Checkpoint ${c.id} has no terrain height`);
    return { id: c.id, x: c.world[0], z: c.world[1], worldHeight: height };
  });
  const report: RidgeboundTerrainReport = {
    ...preview.report, status: "SOURCE_TERRAIN_PREVIEW_NOT_ROAD_OR_DRIVING_ACCEPTANCE",
    heightmap: { fileId: RIDGEBOUND_HEIGHTMAP_ID, sha256: pngSha, width: 1001, height: 1001, spacing: 6, heightMin: 100, heightMax: 850 },
    grid: { choice: "TECHNICAL_TEST_ONLY_NOT_APPROVED_SPATIAL", window, margin, tileQuads, spacing: 6,
      extent: [window.tilesX * tileQuads * 6, window.tilesZ * tileQuads * 6], origin: [...world.def.origin], sampling: "EXACT_U16_CROP_NO_RESAMPLING" },
    groundCheckpoints,
    warnings: [
      "SOURCE TERRAIN ONLY: 6 m native raster; no new 1 m detail, authored road grade, bridge deck/collider, building pad or gameplay.",
      "The tile crop/margin is a technical preview choice. Master coordinates, spatial approvals and north-west datum are unchanged.",
      "Terrain collision is enabled; its geometry is not road/bridge or truck-driving acceptance.",
      ...preview.report.warnings.filter(w => !w.startsWith("SCHEMATIC ONLY:")),
    ],
    deferredFields: preview.report.deferredFields.filter(f => !f.startsWith("terrain:")),
  };
  if (pngSha !== RIDGEBOUND_HEIGHTMAP_SHA256) report.warnings.push("Heightmap differs from the initial v0.2 source; review raster/master provenance.");
  const files = new Map<string, Uint8Array>();
  for (const [key, tile] of world.tiles) files.set(terrainTilePath(RIDGEBOUND_TERRAIN_REF, key), encodeTerrainTile(tile, world.def));
  files.set(terrainGlobalMapPath(RIDGEBOUND_TERRAIN_REF), encodeTerrainGlobalMap(world.def, buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles))));
  files.set("pilot-heightfield-u16.png", await encodeHeightmapPng16(window.width, window.height, samples));
  const svg = preview.svg.replace("Arazi / yol yüzeyi / köprü / sürüş kabulü üretilmedi.",
    "Kaynak arazi ayrı üretildi · bu çizim konum planıdır · yol/köprü kabulü açık.");
  return { ...preview, svg, level, recipe, report, world, files, croppedSamples: samples };
}
