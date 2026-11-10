/** A3 same-seed area, reach and usable-core evidence; no writes to user content. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomWorldBrief, worldExtent } from "../../engine/worldbuilder/randomWorld";
import { normalizeWorldBrief } from "../../engine/worldbuilder/worldBrief";
import { createBriefTerrain } from "../../engine/worldbuilder/briefTerrain";
import { normalizeGroundCover } from "../../engine/worldbuilder/groundCover";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { buildWorldFromBrief } from "./worldBriefBuild";
import { prepareOceanTerrain } from "../../engine/terrain/oceanPreparation";
import { sampleOceanCoverage } from "../../engine/terrain/oceanCoverage";
import { islandShorePoint } from "../../engine/worldbuilder/island";

const seeds = [4, 11, 12, 29, 48213, 0xffffffff], rows = [];
const cover = normalizeGroundCover(JSON.parse(readFileSync("public/assets/world-builder/covers/forest.cover.json", "utf8"))).cover!;
const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ id: string; path: string }> };
const ids = new Map(manifest.assets.map(asset => [asset.path, asset.id]));
for (const size of ["small", "medium"] as const) for (const seed of seeds) {
  const { brief } = normalizeWorldBrief(randomWorldBrief({ id: "a3measure", name: "A3 Measurement", size, seed, landform: "island",
    mountainHeight: "medium", settlements: [], roads: "between", rivers: 0, lakes: 0, cover: "forest" }).brief);
  if (!brief) throw new Error("Invalid island brief");
  if (process.argv.includes("--legacy")) delete brief.terrain.island!.radii;
  const ground = createBriefTerrain(brief), ocean = ground.ocean!, half = worldExtent(size) / 2;
  const outline = Array.from({ length: 1024 }, (_, i) => islandShorePoint(brief, i * 2 * Math.PI / 1024));
  let polygonArea = 0, perimeter = 0;
  outline.forEach((a, i) => { const b = outline[(i + 1) % outline.length]!; polygonArea += a[0] * b[1] - a[1] * b[0]; perimeter += Math.hypot(a[0] - b[0], a[1] - b[1]); });
  const xs = outline.map(p => p[0]), zs = outline.map(p => p[1]);
  let dry = 0, coreCells = 0;
  const n = worldExtent(size) / 8, core = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = ocean.distance(-half + (i + .5) * 8, -half + (j + .5) * 8);
    if (d >= 0) dry++;
    if (d >= 40) { core[j * n + i] = 1; coreCells++; }
  }
  const counts: number[] = [], queue = new Int32Array(core.length);
  for (let i = 0; i < core.length; i++) if (core[i]) {
    let head = 0, tail = 1; queue[0] = i; core[i] = 0;
    while (head < tail) {
      const at = queue[head++]!, x = at % n, z = Math.floor(at / n);
      for (const next of [x > 0 ? at - 1 : -1, x + 1 < n ? at + 1 : -1, z > 0 ? at - n : -1, z + 1 < n ? at + n : -1])
        if (next >= 0 && core[next]) { core[next] = 0; queue[tail++] = next; }
    }
    counts.push(tail);
  }
  const native = [];
  if (seed === 11 || seed === 29) {
    const built = buildWorldFromBrief({ brief, levelPath: "assets/measure/A3.level.json", cover,
      profile: normalizeRegionProfile(JSON.parse(readFileSync(`public/${brief.regionProfile}`, "utf8"))).profile,
      assetIdForFile: file => ids.get(file) ?? null });
    const coverage = await prepareOceanTerrain({ def: built.def, tiles: new Map(built.tiles) }, built.layout.oceanWaters![0]!);
    let wet = 0;
    for (let z = -half + 4; z < half; z += 8) for (let x = -half + 4; x < half; x += 8) if (sampleOceanCoverage(coverage, x, z).status === "wet") wet++;
    native.push({ status: coverage.status, dryPct: 100 - wet / n ** 2 * 100, wetFaces: coverage.wetFaces });
  }
  rows.push({ size, seed, areaPct: Math.abs(polygonArea) / 2 / worldExtent(size) ** 2 * 100, rasterDryPct: dry / n ** 2 * 100,
    perimeterM: perimeter, bounds: { min: [Math.min(...xs), Math.min(...zs)], max: [Math.max(...xs), Math.max(...zs)] },
    edgeGapM: Math.min(half - Math.max(...xs), Math.min(...xs) + half, half - Math.max(...zs), Math.min(...zs) + half),
    core40: { cells: coreCells, components: counts.length, largestShare: Math.max(...counts) / coreCells }, outline, native });
}
const output = process.argv[2]; if (!output) throw new Error("Pass output JSON path");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ method: { seeds, areaCellM: 8, outlineSamples: 1024, coreClearanceM: 40, connectivity: "4-neighbour 8m grid", native: "seed 11 and 29; 2m native triangles, no inland waters/settlements" }, rows }, null, 2) + "\n");
console.log(`Wrote ${rows.length} island measurements: ${output}`);
