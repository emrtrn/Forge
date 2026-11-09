/** A1 reproducible measurements. Run with run-coast-measurement.mjs. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomWorldBrief, worldExtent } from "../../engine/worldbuilder/randomWorld";
import { normalizeWorldBrief } from "../../engine/worldbuilder/worldBrief";
import { createBriefTerrain } from "../../engine/worldbuilder/briefTerrain";
import { coverPaint, normalizeGroundCover } from "../../engine/worldbuilder/groundCover";
import { SEA_SIDES } from "../../engine/worldbuilder/island";
import { buildWorldFromBrief } from "./worldBriefBuild";
import { normalizeRegionProfile } from "../../engine/worldbuilder/regionProfile";
import { terrainLayerWeightsAt } from "../../engine/terrain/terrainHeightQuery";

const cover = normalizeGroundCover(JSON.parse(readFileSync("public/assets/world-builder/covers/forest.cover.json", "utf8"))).cover!;
const native = process.argv.includes("--native"), legacy = process.argv.includes("--legacy");
const manifest = JSON.parse(readFileSync("public/assets/manifest.json", "utf8")) as { assets: Array<{ path: string; id: string }> };
const ids = new Map(manifest.assets.map(asset => [asset.path, asset.id]));
const rows = [];
for (const size of ["small", "medium"] as const) for (const seaSide of SEA_SIDES) for (const seed of [4, 11, 29]) {
  const raw = randomWorldBrief({ id: "measurement", name: "Measurement", size, seaSide, seed, landform: "coast",
    mountainHeight: "medium", settlements: [], roads: "between", cover: "forest", rivers: 0, lakes: 0 }).brief;
  const normalized = normalizeWorldBrief(raw);
  if (!normalized.brief || normalized.issues.length) throw new Error(normalized.issues.join("; "));
  const brief = normalized.brief, terrain = createBriefTerrain(brief);
  // The no-water/no-settlement legacy recipe exactly reproduces the pre-A1 baseline.
  if (legacy) {
    brief.terrain.coast!.center = [0, 0]; delete brief.terrain.coast!.beachWidth;
  }
  const source = legacy ? createBriefTerrain(brief) : terrain;
  const shoreOcean = source.ocean!;
  const built = native ? buildWorldFromBrief({ brief, levelPath: "assets/measurement/Coast.level.json", cover,
    profile: normalizeRegionProfile(JSON.parse(readFileSync(`public/${brief.regionProfile}`, "utf8"))).profile,
    assetIdForFile: file => ids.get(file) ?? null }) : undefined;
  const tileLookup = { tile: (x: number, z: number) => built!.tiles.get(`${x}_${z}`) };
  const height = (x: number, z: number) => built ? built.sampleHeight(x, z)! : source.height(x, z);
  const paint = coverPaint(cover, brief, source, { forest: "medium", rocks: "medium", fields: "medium" }, { clearings: [], snowLine: null });
  const bed = cover.layers.findIndex(layer => layer.id === cover.roles.bed);
  const extent = worldExtent(size), half = extent / 2;
  const axis = seaSide === "west" ? [1, 0] : seaSide === "east" ? [-1, 0] : seaSide === "north" ? [0, 1] : [0, -1];
  const point = (inland: number, along: number): [number, number] => [axis[0]! * inland - axis[1]! * along, axis[1]! * inland + axis[0]! * along];
  const weight = (x: number, z: number): number => {
    const h = height(x, z), step = 4;
    const slope = built ? 0 : Math.atan(Math.hypot(height(x + step, z) - h, height(x, z + step) - h) / step) * 180 / Math.PI;
    const weights = built ? terrainLayerWeightsAt(built.def, tileLookup, x, z)! : paint(x, z, slope, h);
    return weights[bed]! / weights.reduce((a, b) => a + b, 0);
  };
  let sea = 0, beach = 0, interior = 0;
  // Cell centres, 8 m spacing; offshore outside this square is never counted.
  for (let z = -half + 4; z < half; z += 8) for (let x = -half + 4; x < half; x += 8) {
    if (built ? height(x, z) < shoreOcean.surfaceLevel : shoreOcean.distance(x, z) < 0) sea++;
    else if (weight(x, z) >= .5) beach++;
    else interior++;
  }
  const widths: number[] = [], axisWidths: number[] = [], shorePositions: number[] = [], depths: number[] = [];
  for (let i = 0; i < 256; i++) {
    const margin = built ? 80 : 0;
    const along = -half + margin + (i + .5) * (extent - 2 * margin) / 256;
    const origin = point(0, along), d = shoreOcean.distance(...origin);
    let waterline = -d;
    if (built) {
      let lo = -d - 4, hi = -d + 4;
      for (let k = 0; k < 28; k++) {
        const mid = (lo + hi) / 2;
        if (height(...point(mid, along)) < shoreOcean.surfaceLevel) lo = mid; else hi = mid;
      }
      waterline = (lo + hi) / 2;
    }
    const shore = point(waterline, along);
    shorePositions.push(waterline);
    const delta = .1;
    const gx = (shoreOcean.distance(shore[0] + delta, shore[1]) - shoreOcean.distance(shore[0] - delta, shore[1])) / (2 * delta);
    const gz = (shoreOcean.distance(shore[0], shore[1] + delta) - shoreOcean.distance(shore[0], shore[1] - delta)) / (2 * delta);
    const norm = Math.hypot(gx, gz);
    const crossing = (nx: number, nz: number) => {
      let lo = 0, hi = 200;
      for (let k = 0; k < 28; k++) {
        const mid = (lo + hi) / 2;
        if (weight(shore[0] + nx * mid, shore[1] + nz * mid) >= .5) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    };
    widths.push(crossing(gx / norm, gz / norm));
    axisWidths.push(crossing(axis[0]!, axis[1]!));
    const offshore = point(-d - 10, along);
    depths.push(shoreOcean.surfaceLevel - height(...offshore));
  }
  const summary = (values: number[]) => ({ min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) });
  const total = sea + beach + interior;
  rows.push({ size, seaSide, seed, center: brief.terrain.coast!.center, shoreWidth: brief.terrain.coast!.shoreWidth,
    areaPct: { interior: interior / total * 100, dryBeach: beach / total * 100, sea: sea / total * 100 },
    normalWidthM: summary(widths), axisWidthM: summary(axisWidths), coastlinePositionM: summary(shorePositions), depthAt10M: summary(depths) });
}
const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ method: { native, legacy, areaCellM: 8, paintThreshold: .5, transects: 256, transectEdgeMarginM: native ? 80 : 0,
  width: native ? "native triangle waterline to 50% bilinear normalized uint8 paint along source shore normal; no inland water/settlements"
    : "shore normal to 50% normalized bed paint; 4m slope samples; no inland water/settlements", seeds: [4, 11, 29] }, rows }, null, 2) + "\n");
console.log(`Wrote ${rows.length} Coast measurements to ${output}`);
