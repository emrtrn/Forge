/** Ridgebound-only candidate parameters and masks; the generic relief kernel knows no Ridgebound ids. */
import { createMacroRelief, type MacroReliefOptions, type ReliefProtection } from "../../engine/worldbuilder/macroRelief";
import { isRecord, type WorldPoint } from "../../engine/worldbuilder/normalize";
import { heightmapSamplesToRaw } from "../../engine/terrain/terrainImport";
import { encodeHeightmapPng16 } from "../../engine/terrain/heightmapPng";
import { createWorldTerrainFromHeightmap } from "../../engine/terrain/worldTerrainCreate";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { terrainGlobalMapPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { terrainHeightAt } from "../../engine/terrain/terrainHeightQuery";
import { buildRidgeboundTerrainPreview } from "./ridgeboundTerrain";

export const RIDGEBOUND_RELIEF_LEVEL = "layouts/RidgeboundReliefA.level.json";
export const RIDGEBOUND_RELIEF_RECIPE = "layouts/RidgeboundReliefA.worldrecipe.json";
export const RIDGEBOUND_RELIEF_REF = "layouts/RidgeboundReliefA.landscapes/pilot.terrain.json";
export const RIDGEBOUND_RELIEF_VERSION = 1;

export async function buildRidgeboundReliefCandidate(value: unknown, masterSha: string, png: Uint8Array, pngSha: string) {
  const base = await buildRidgeboundTerrainPreview(value, masterSha, png, pngSha);
  if (!isRecord(value) || !isRecord(value.hydrology) || !isRecord(value.hydrology["H-01"])
    || value.hydrology["H-01"].riverx !== "3430+125*sin(2*pi*Y/3100+0.8)+0.03*(Y-1000)") {
    throw new Error("Unsupported H-01: update the explicit hydrology adapter; expressions are never executed");
  }
  const { def } = base.world;
  const min: WorldPoint = [def.origin[0], def.origin[2]];
  const max: WorldPoint = [min[0] + base.report.grid.extent[0], min[1] + base.report.grid.extent[1]];
  const protections: ReliefProtection[] = base.report.checkpoints.map(c => ({
    id: c.id, source: { kind: "point", position: c.world, radius: c.id === "V0" || c.id === "V1" ? 110 : 55 }, falloff: 130,
  }));
  for (const edge of base.recipe.plan.roadGraph.edges) {
    if (!edge.guide || edge.guide.length < 2) throw new Error("Expected authored R01 guide");
    protections.push({ id: edge.id, source: { kind: "polyline", points: edge.guide, radii: edge.guide.map(() => 34) }, falloff: 110 });
  }
  // Sample only the pilot's neighbourhood, with both ends beyond its bounds. Formula is version-checked above.
  const river: WorldPoint[] = [];
  for (let z = Math.floor((min[1] - 384) / 6) * 6; z <= max[1] + 384; z += 6) {
    const north = 6000 - z;
    river.push([3430 + 125 * Math.sin(2 * Math.PI * north / 3100 + 0.8) + 0.03 * (north - 1000), z]);
  }
  protections.push({ id: "H-01", source: { kind: "polyline", points: river, radii: river.map(() => 70) }, falloff: 160 });
  const secondary = value.hydrology["H-02"];
  if (!isRecord(secondary) || !Array.isArray(secondary.pts) || secondary.pts.length < 2
    || secondary.pts.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 6000))) {
    throw new Error("Expected H-02 source polyline");
  }
  const tributary = (secondary.pts as number[][]).map(([x, north]) => [x!, 6000 - north!] as WorldPoint);
  protections.push({ id: "H-02", source: { kind: "polyline", points: tributary, radii: tributary.map(() => 55) }, falloff: 130 });
  const config: MacroReliefOptions = { seed: 20261102, amplitude: 190, wavelength: 490, directionDegrees: -25,
    bounds: { min, max }, edgeFade: 48, protections };
  const relief = createMacroRelief(config);
  const { width, height } = base.report.grid.window;
  const samples = base.croppedSamples.slice();
  let changedVertices = 0, protectedVertices = 0, maxAddedMetres = 0;
  for (let iz = 0; iz < height; iz++) for (let ix = 0; ix < width; ix++) {
    const index = iz * width + ix, x = min[0] + ix * 6, z = min[1] + iz * 6;
    const delta = relief.displacementAt(x, z);
    const code = samples[index]! + Math.round(delta / 750 * 65535);
    if (code > 65535) throw new Error("Relief exceeds the source encoding; refusing to clip");
    samples[index] = code;
    if (relief.weightAt(x, z) === 0) protectedVertices++;
    if (samples[index] !== base.croppedSamples[index]) changedVertices++;
    maxAddedMetres = Math.max(maxAddedMetres, (samples[index]! - base.croppedSamples[index]!) / 65535 * 750);
  }
  const world = createWorldTerrainFromHeightmap({ name: "Ridgebound relief A — unapproved candidate", tilesX: def.tilesX,
    tilesZ: def.tilesZ, tileQuads: 64, spacing: 6, baseHeight: 0 },
  { bytes: heightmapSamplesToRaw(samples), width, height, heightMin: 100, heightMax: 850, endianness: "little" });
  world.def.origin = [...def.origin];
  const level = structuredClone(base.level);
  level.name = "Ridgebound Relief A — terrain candidate, no authored roads";
  level.landscapes = [{ ...level.landscapes![0]!, id: "ridgebound-relief-a", name: "Ridgebound Relief A", dataRef: RIDGEBOUND_RELIEF_REF }];
  const recipe = structuredClone(base.recipe);
  recipe.recipeId = "ridgebound_relief_a";
  const lookup = { tile: (x: number, z: number) => world.tiles.get(`${x}_${z}`) };
  const checkpoints = base.report.groundCheckpoints.map(c => ({ ...c,
    candidateHeight: terrainHeightAt(world.def, lookup, c.x, c.z)!,
    delta: terrainHeightAt(world.def, lookup, c.x, c.z)! - c.worldHeight }));
  if (checkpoints.some(c => c.delta !== 0)) throw new Error("Protected checkpoint changed");
  const files = new Map<string, Uint8Array>();
  for (const [key, tile] of world.tiles) files.set(terrainTilePath(RIDGEBOUND_RELIEF_REF, key), encodeTerrainTile(tile, world.def));
  files.set(terrainGlobalMapPath(RIDGEBOUND_RELIEF_REF), encodeTerrainGlobalMap(world.def, buildTerrainGlobalAttributes(worldTerrainRenderSource(world.def, world.tiles))));
  files.set("candidate-heightfield-u16.png", await encodeHeightmapPng16(width, height, samples));
  const report = { status: "UNAPPROVED_MACRO_RELIEF_CANDIDATE_NOT_ROAD_OR_DRIVING_ACCEPTANCE", version: RIDGEBOUND_RELIEF_VERSION,
    source: base.report.source, heightmap: base.report.heightmap,
    grid: { ...base.report.grid, sampling: "SOURCE_U16_PLUS_QUANTIZED_RELIEF_NO_RESAMPLING" },
    operation: { kind: "maskedRidgedRelief", config, changedVertices, protectedVertices, maxAddedMetres,
      sampling: "SOURCE_U16_PLUS_QUANTIZED_RELIEF_NO_RESAMPLING", rebuild: "ALWAYS_FROM_SOURCE_NOT_ACCUMULATIVE" },
    groundCheckpoints: checkpoints, warnings: ["Candidate parameters and masks are proposals, not approved master geometry.",
      "Raised ridges retain source hollows; no new hydrology or erosion simulation.",
      "No road, bridge, building, pad or gameplay generation. Stage Runner/UI integration remains open.",
      "Native 6 m samples; no 1 m detail. Saved or unsaved edits to P1 are not imported or replaced."] };
  return { level, recipe, world, files, samples, baseSamples: base.croppedSamples, config, report, svg: base.svg };
}
