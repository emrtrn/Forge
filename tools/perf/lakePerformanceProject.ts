import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createLakePerformanceFixture } from "../../tests/engine/fixtures/lakePerformanceFixture";
import { createLakeAppearance } from "../../engine/scene/waterBody";
import { terrainTilePath, terrainGlobalMapPath } from "../../engine/terrain/terrainTypes";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { buildTerrainGlobalAttributes, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { worldTerrainActorPosition } from "../../engine/terrain/worldTerrainActor";

export async function prepareLakePerformanceLevels(root: string) {
  const write = async (path: string, value: string | Uint8Array) => {
    const target = resolve(root, "public", path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value);
  };
  const base = JSON.parse(await readFile(resolve(root, "public/layouts/__playwright-smoke-spline.level.json"), "utf8"));
  const metadata = [];
  for (const kind of ["small", "maximum", "world"] as const) {
    const doc = createLakePerformanceFixture(kind), terrain = `landscapes/__lake-perf-${kind}.terrain.json`;
    doc.def.layers[0]!.material = "m-shallow-water-bed";
    for (const [key, tile] of doc.tiles) await write(terrainTilePath(terrain, key), encodeTerrainTile(tile,
      { heightMin: -64, heightMax: 64, heightFormat: "f32" }));
    await write(terrain, JSON.stringify(doc.def));
    await write(terrainGlobalMapPath(terrain), encodeTerrainGlobalMap(doc.def, buildTerrainGlobalAttributes(worldTerrainRenderSource(doc.def, doc.tiles))));
    for (const profile of ["none", "surface", "caustics", "all", "planar", "wide", "planarwide"] as const) {
      const level = structuredClone(base);
      level.name = `Lake performance ${kind} ${profile}`;
      level.instances = level.instances.filter((g: { assetId: string }) => g.assetId === "marker:playerStart");
      level.instances[0].placements[0].position = [0, 18, 0];
      level.actors = []; level.characters = []; level.riverWaters = [];
      level.landscapes = [{ id: "terrain", name: "Lake performance terrain", position: worldTerrainActorPosition(doc.def), dataRef: terrain }];
      level.worldSettings = { ...level.worldSettings, viewDistance: 7000, killZ: -100 };
      level.lights[0].castShadow = true; level.lights[0].cascadedShadows = true;
      level.waterBodies = profile === "none" ? [] : doc.lakes.map(lake => ({ ...lake, appearance:
        ["all", "planar", "wide", "planarwide"].includes(profile) ? { ...createLakeAppearance(),
          ...(["wide", "planarwide"].includes(profile) ? { foamWidth: 2, shoreWetnessWidth: 2 } : {}),
          reflectionMode: profile === "planar" || profile === "planarwide" ? "sharedPlanar" : "off" }
          : { causticsEnabled: profile === "caustics", causticsStrength: 1.5, causticsScale: 1.5, causticsDepthFade: 6,
            reflectionMode: "off", shoreWetnessEnabled: false, foamEnabled: false } }));
      await write(`layouts/__lake-perf-${kind}-${profile}.level.json`, JSON.stringify(level));
    }
    metadata.push({ kind, extent: doc.extent, spacing: doc.def.spacing, tileQuads: doc.def.tileQuads,
      tiles: doc.tiles.size, bodies: doc.lakes.length, cells: doc.lakes.reduce((n, l) => n +
        (l.bounds.max[0] - l.bounds.min[0]) * (l.bounds.max[1] - l.bounds.min[1]) / doc.def.spacing ** 2, 0) });
  }
  return metadata;
}
