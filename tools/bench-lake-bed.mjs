// Node staging/W1 pilot, not browser main-thread, heap or hardware GPU acceptance.
import { build } from "esbuild";
import { cpus } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const out = resolve(".dev-server/lake-bed-bench.mjs");
await mkdir(resolve(".dev-server"), { recursive: true });
await build({ stdin: { contents: `
export { prepareLakeBed } from "./engine/terrain/terrainLakeBed";
export { createLakeBedFixture } from "./tests/engine/fixtures/lakeBedFixture";
export { createFlatTerrainTile } from "./engine/terrain/terrainTypes";
`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: out });
const { prepareLakeBed, createLakeBedFixture, createFlatTerrainTile } = await import(pathToFileURL(out).href);
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const report = { cpu: cpus()[0]?.model, platform: process.platform, note: "Node CPU pilot; yield waits included. No HTTP/browser/GPU acceptance.", cases: [] };
for (const name of ["fixture-96m", "fixture-96m-paint", "maximum-65536-cells"]) {
  const doc = createLakeBedFixture();
  if (name.endsWith("paint")) doc.lake.bed.shorePaint = { layerId: "shore", strength: 0.7 };
  if (name.startsWith("maximum")) {
    doc.def.tileQuads = 128; doc.def.origin = [-128, 10, -128];
    doc.lake.bounds = { min: [-128, -128], max: [128, 128] };
    doc.lake.bed.points = [[-112, -112], [112, -112], [112, 112], [-112, 112]];
    for (const entry of doc.def.tiles) {
      const [x, z] = entry.key.split("_").map(Number), tile = createFlatTerrainTile(doc.def, x, z); tile.heights.fill(6); doc.tiles.set(entry.key, tile);
    }
  }
  for (let i = 0; i < 5; i++) await prepareLakeBed(doc, doc.lake);
  const times = [], slices = []; let last;
  for (let i = 0; i < 30; i++) { last = await prepareLakeBed(doc, doc.lake); times.push(last.buildMs); slices.push(last.maxSliceMs); }
  const record = { name, cells: last.snapshot.nx * last.snapshot.nz, p95Ms: p95(times), bedSliceP95Ms: p95(slices),
    estimatedCpuBytes: last.cpuBytes, undoBytes: last.patchBytes, triangles: last.geometry.indices.length / 3,
    retainedGeometryBytes: last.geometry.bytes, targetP95Ms: name.startsWith("maximum") ? 1000 : 200 };
  report.cases.push(record); console.log(JSON.stringify(record));
}
await writeFile(resolve(".dev-server/lake-w2-perf.json"), JSON.stringify(report, null, 2));
