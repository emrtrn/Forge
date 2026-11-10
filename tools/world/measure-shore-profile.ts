/** A2 source matrix + native before/after comparison. Builds only in memory. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomWorldBrief, worldExtent } from "../../engine/worldbuilder/randomWorld";
import { briefToWorld, normalizeWorldBrief, type WorldBrief } from "../../engine/worldbuilder/worldBrief";
import { createBriefTerrain } from "../../engine/worldbuilder/briefTerrain";
import { islandShorePoint, SEA_SIDES } from "../../engine/worldbuilder/island";
import { buildWorldFromBrief } from "./worldBriefBuild";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { normalizeGroundCover } from "../../engine/worldbuilder/groundCover";
import { prepareOceanTerrain } from "../../engine/terrain/oceanPreparation";
import { sampleOceanCoverage } from "../../engine/terrain/oceanCoverage";

const cover = normalizeGroundCover(JSON.parse(readFileSync("public/assets/world-builder/covers/forest.cover.json", "utf8"))).cover!;
const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ path: string; id: string }> };
const ids = new Map(manifest.assets.map(asset => [asset.path, asset.id]));
const distances = [2, 5, 10, 20, 30, 35, 40, 50, 60, 90, 120, 150, 180];
const summary = (values: number[]) => ({ min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) });
function probes(brief: WorldBrief) {
  const ground = createBriefTerrain(brief), ocean = ground.ocean!, shape = (brief.terrain.island ?? brief.terrain.coast)!;
  const [cx, cz] = briefToWorld(brief, shape.center), half = (brief.area.east - brief.area.west) / 2;
  return Array.from({ length: 128 }, (_, i) => {
    let x: number, z: number;
    if (brief.terrain.coast) {
      const side = brief.terrain.coast.seaSide;
      const axis = side === "west" ? [1, 0] : side === "east" ? [-1, 0] : side === "north" ? [0, 1] : [0, -1];
      const along = -half + 200 + (i + .5) * (2 * half - 400) / 128;
      x = cx - axis[1]! * along; z = cz + axis[0]! * along;
      const d = ocean.distance(x, z); x -= axis[0]! * d; z -= axis[1]! * d;
    } else {
      [x, z] = islandShorePoint(brief, (i + .5) * 2 * Math.PI / 128);
    }
    const e = .1, gx = (ocean.distance(x + e, z) - ocean.distance(x - e, z)) / (2 * e);
    const gz = (ocean.distance(x, z + e) - ocean.distance(x, z - e)) / (2 * e), length = Math.hypot(gx, gz);
    return { shore: [x, z] as [number, number], normal: [-gx / length, -gz / length] as [number, number] };
  });
}
const rows = [];
for (const size of ["small", "medium"] as const) for (const landform of ["island", "coast"] as const)
  for (const seaSide of landform === "coast" ? SEA_SIDES : ["west"] as const) for (const seed of [4, 11, 29]) {
    const { brief } = normalizeWorldBrief(randomWorldBrief({ id: "a2measure", name: "A2 Measurement", size, landform, seaSide, seed,
      mountainHeight: "medium", settlements: [], roads: "between", cover: "forest", rivers: 0, lakes: 0 }).brief);
    if (!brief) throw new Error("Invalid generated brief");
    const prior = structuredClone(brief); delete prior.ocean!.shoreProfile;
    const before = createBriefTerrain(prior), after = createBriefTerrain(brief), half = worldExtent(size) / 2, rays = probes(brief);
    let dry = 0, interior = 0, dryHeightMaxDelta = 0, waterlineDelta = 0;
    for (let z = -half + 4; z < half; z += 8) for (let x = -half + 4; x < half; x += 8) {
      const d = after.ocean!.distance(x, z);
      waterlineDelta = Math.max(waterlineDelta, Math.abs(d - before.ocean!.distance(x, z)));
      if (d >= 0) { dry++; dryHeightMaxDelta = Math.max(dryHeightMaxDelta, Math.abs(before.height(x, z) - after.height(x, z))); }
      if (d >= (brief.terrain.coast?.beachWidth ?? 0)) interior++;
    }
    const sourceDepths = distances.map(distance => ({ distance, before: summary(rays.map(({ shore: [x, z], normal: [nx, nz] }) => -before.height(x + nx * distance, z + nz * distance))),
      after: summary(rays.map(({ shore: [x, z], normal: [nx, nz] }) => -after.height(x + nx * distance, z + nz * distance))) }));
    // Four representative full native pairs, plus the 30-case source matrix.
    const native = [];
    if (seed === 11 && seaSide === "west") for (const [label, world] of [["before", prior], ["after", brief]] as const) {
      const built = buildWorldFromBrief({ brief: world, levelPath: "assets/measure/A2.level.json", cover,
        profile: normalizeRegionProfile(JSON.parse(readFileSync(`public/${world.regionProfile}`, "utf8"))).profile,
        assetIdForFile: file => ids.get(file) ?? null });
      const coverage = await prepareOceanTerrain({ def: built.def, tiles: new Map(built.tiles) }, built.layout.oceanWaters![0]!);
      let wet = 0, beach = 0;
      for (let z = -half + 4; z < half; z += 8) for (let x = -half + 4; x < half; x += 8) {
        if (sampleOceanCoverage(coverage, x, z).status === "wet") wet++;
        else if (after.ocean!.distance(x, z) < (brief.terrain.coast?.beachWidth ?? 25)) beach++;
      }
      const depthRows = distances.map(distance => {
        let outside = 0; const values = [];
        for (const { shore: [x, z], normal: [nx, nz] } of rays) {
          const sample = sampleOceanCoverage(coverage, x + nx * distance, z + nz * distance);
          if (sample.status !== "wet") throw new Error(`${size}/${landform}/${label}: disconnected sample ${distance}`);
          if (sample.offshore) outside++;
          values.push(sample.depth);
        }
        return { distance, depth: summary(values), outsideNative: outside };
      });
      native.push({ label, status: coverage.status, wetFaces: coverage.wetFaces, seaPct: wet / (worldExtent(size) / 8) ** 2 * 100,
        beachPct: beach / (worldExtent(size) / 8) ** 2 * 100, depths: depthRows });
    }
    rows.push({ size, landform, ...(landform === "coast" ? { seaSide } : {}), seed,
      sourceDryPct: dry / (worldExtent(size) / 8) ** 2 * 100, sourceInteriorPct: interior / (worldExtent(size) / 8) ** 2 * 100,
      dryHeightMaxDelta, waterlineMaxDelta: waterlineDelta, sourceDepths, native });
  }
const output = process.argv[2]; if (!output) throw new Error("Pass output JSON path");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ method: { areaCellM: 8, transects: 128, coastAlongMarginM: 200, direction: "source shoreline normal, metres offshore",
  native: "2m native triangle coverage and existing 64m connected-boundary offshore continuation; before=shoreProfile absent, A1 retained" }, rows }, null, 2) + "\n");
console.log(`Wrote ${rows.length} source cases and 4 native before/after pairs: ${output}`);
