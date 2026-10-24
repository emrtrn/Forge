// OPEN_WORLD_PLAN Faz 7 / S7 (7c2): cascaded shadow cost on OpenWorldTest.
// Needs `npm run world:test` output in public/ and a Vite server started
// separately (e.g. `npx vite --port 5274 --strictPort --host 127.0.0.1`).
// Usage: node spikes/far-view/run.mjs [port] [qualities] [outDir] [variants]
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const port = process.argv[2] ?? "5274";
const qualities = (process.argv[3] ?? "high").split(",");
const outDir = resolve(process.argv[4] ?? "spikes/far-view/out");
const variants = (process.argv[5] ?? "none,follow,csm2,csm3,csm4,forge2,forge3,forge4,forge4-stagger").split(",");
const PROFILE = {
  ultra: { mapSize: 2048, distanceScale: 1.0 },
  high: { mapSize: 1024, distanceScale: 0.75 },
  medium: { mapSize: 512, distanceScale: 0.5 },
};
const SHADOW_DISTANCE = 200;
const LEVEL = "layouts/OpenWorldTest.level.json";
const FOLIAGE = "layouts/OpenWorldTest.foliage.json";
const GRASS_TYPE = "assets/__spike-grass.foliagetype.json";

await mkdir(outDir, { recursive: true });

// Terrain heights for the statics: regenerate the same deterministic world in memory.
const bundled = await build({
  tsconfig: "tsconfig.json", bundle: true, format: "esm", platform: "node", write: false,
  stdin: {
    contents: 'export * from "./tools/world/testWorld"; export { partitionLayout, normalizeWorldPartitionSettings, worldCellPath } from "./engine/world/worldPartition";',
    resolveDir: process.cwd(), loader: "ts",
  },
});
const { generateTestWorld, partitionLayout, normalizeWorldPartitionSettings, worldCellPath } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const world = generateTestWorld({});
const [sx, , sz] = world.spawn;

let seed = 7;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function scatter(count, radius, minRadius) {
  const points = [];
  while (points.length < count) {
    const x = sx + (random() * 2 - 1) * radius;
    const z = sz + (random() * 2 - 1) * radius;
    if (Math.hypot(x - sx, z - sz) < minRadius) continue;
    const y = world.heightAt(x, z);
    if (y === null || y === undefined) continue;
    points.push([x, y, z]);
  }
  return points;
}

const level = JSON.parse(await readFile(resolve("public", LEVEL), "utf8"));
level.worldSettings = { ...level.worldSettings, viewDistance: 3000, staticObjectsCastShadow: true };
level.instances.push(
  { assetId: "commontree", placements: scatter(500, 300, 8).map((position, index) => ({ position, name: `Tree ${index}`, collision: false, rotationYDeg: random() * 360, scale: 0.8 + random() * 0.6 })) },
  { assetId: "shape-cube", placements: scatter(120, 200, 6).map(([x, y, z], index) => {
    const scale = 2 + random() * 4;
    return { position: [x, y + scale / 2 - 0.5, z], name: `Block ${index}`, collision: false, rotationYDeg: random() * 360, scale };
  }) },
);
// Statics live in World Partition cells (128 m), as in a real open world: cell × asset
// batches, so each cascade only draws the cells its frustum touches.
level.worldSettings.partition = { enabled: true };
const partitioned = partitionLayout(level, normalizeWorldPartitionSettings(level.worldSettings.partition));
const persistent = { ...partitioned.persistent, worldCells: [...partitioned.cells.keys()] };
const cellFiles = new Map([...partitioned.cells].map(([key, cell]) => [worldCellPath(LEVEL, "main", key), cell]));
console.log(`partitioned statics into ${cellFiles.size} cells`);
const grassType = {
  schema: 1, type: "foliageType", name: "Spike Grass", meshAssetId: "kenney-grass", radius: 0.3, density: 1,
  scaleMin: [0.8, 0.8, 0.8], scaleMax: [1.3, 1.3, 1.3], randomYaw: true, alignToNormal: true, zOffsetMin: 0, zOffsetMax: 0,
  slopeMin: 0, slopeMax: 35, castShadow: false, receiveShadow: true, collision: false, cullStart: 80, cullEnd: 96,
};
const foliage = {
  schema: 1, type: "foliage", groups: [],
  landscapeRules: [{ id: "spike-grass", landscapeId: "world", layerId: "grass", foliageTypeId: "__spike-grass", density: 4, minWeight: 0.3, seed: 1 }],
};

const browser = await chromium.launch({ args: ["--enable-gpu", "--use-angle=d3d11"] });
const report = [];
try {
  for (const quality of qualities) {
    const profile = PROFILE[quality];
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const messages = [];
    page.on("pageerror", (error) => console.error(`[pageerror] ${error.stack ?? error.message}`));
    page.on("console", (message) => {
      messages.push(message.text());
      if (message.type() === "error" || message.type() === "warning") console.error(`[${message.type()}] ${message.text().slice(0, 400)}`);
    });
    await page.route(`**/${LEVEL}*`, (route) => route.fulfill({ json: persistent }));
    for (const [path, cell] of cellFiles) await page.route(`**/${path}*`, (route) => route.fulfill({ json: cell }));
    await page.route(`**/${FOLIAGE}*`, (route) => route.fulfill({ json: foliage }));
    await page.route(`**/${GRASS_TYPE}*`, (route) => route.fulfill({ json: grassType }));
    await page.route("**/assets/manifest.json*", async (route) => {
      const response = await route.fetch();
      const manifest = await response.json();
      const mesh = manifest.assets.find((asset) => asset.id === "kenney-grass");
      manifest.assets.push({ ...mesh, id: "__spike-grass", name: "Spike Grass", assetType: "foliageType", path: GRASS_TYPE, placeable: false });
      await route.fulfill({ response, json: manifest });
    });
    await page.route("**/project.3dgame.json*", async (route) => {
      const response = await route.fetch();
      const project = await response.json();
      project.editor.defaultScene = LEVEL;
      await route.fulfill({ response, json: project });
    });
    await page.addInitScript((selected) => {
      localStorage.clear();
      localStorage.setItem("forge.userSettings", JSON.stringify({
        schema: 1,
        updatedAt: new Date().toISOString(),
        payload: { graphics: { selectedQualityLevel: selected, manuallySelected: true, adaptiveOptimizationEnabled: false } },
      }));
      window.__spikeScenes = [];
      window.__THREE_DEVTOOLS__ = new EventTarget();
      window.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
        const object = event.detail;
        if (object?.isScene) window.__spikeScenes.push(object);
        if (object?.isWebGLRenderer) window.__spikeRenderer = object;
      });
    }, quality);

    await page.goto(`http://127.0.0.1:${port}/?spike=${Date.now()}`, { waitUntil: "load", timeout: 180_000 });
    const deadline = Date.now() + 180_000;
    while (!messages.some((m) => m.includes("[runtime] scene loaded"))) {
      if (Date.now() > deadline) throw new Error("runtime did not load");
      await page.waitForTimeout(500);
    }
    await page.locator(".forge-loading").waitFor({ state: "hidden", timeout: 60_000 });
    await page.waitForTimeout(5000);

    const options = { shadowDistance: SHADOW_DISTANCE * profile.distanceScale, mapSize: profile.mapSize, splitLambda: 0.75, load: Number(process.env.LOAD ?? 2) };
    const header = await page.evaluate(async (opts) => {
      const module = await import("/spikes/far-view/probe.ts");
      window.__probe = module.createProbe(window.__spikeRenderer, window.__spikeScenes, opts);
      await window.__probe.ready();
      return { timer: window.__probe.timer, gpu: window.__probe.gpu, sunMapSize: window.__probe.sunMapSize, camera: window.__probe.camera() };
    }, options);
    console.log(`\n== ${quality}: ${JSON.stringify(header)} shadowDistance ${options.shadowDistance} m, map ${options.mapSize}`);
    const instanceCount = await page.evaluate(() => {
      let grass = 0; let meshes = 0;
      for (const scene of window.__spikeScenes) scene.traverse((node) => {
        if (node.isInstancedMesh && node.parent?.name?.startsWith("foliage-grass:")) grass += node.count;
        if (node.isMesh) meshes += 1;
      });
      return { grass, meshes };
    });
    console.log(`grass instances ${instanceCount.grass}, meshes ${instanceCount.meshes}`);

    if (process.env.VIEW) {
      // Screenshot pose: 30 m above the pawn, looking ~120 m ahead down the valley.
      const [px, py, pz] = await page.evaluate(() => window.__probe.cameraPosition());
      const [dx, dz] = process.env.VIEW.split(",").map(Number);
      await page.evaluate((pose) => window.__probe.setView(pose), { position: [px, py + 30, pz], lookAt: [px + dx * 120, py - 10, pz + dz * 120] });
    }
    // Interleaved rounds: the machine is shared, so each variant is measured once per
    // round and the median of the round medians is reported (drift hits all alike).
    const rounds = Number(process.env.ROUNDS ?? 4);
    const perVariant = new Map();
    for (let round = 0; round < rounds; round += 1) {
      const order = round % 2 === 0 ? variants : [...variants].reverse();
      for (const variant of order) {
        const info = await page.evaluate((name) => window.__probe.setVariant(name), variant);
        const result = await page.evaluate(() => window.__probe.measure(60, 150));
        if (round === 0) await page.screenshot({ path: resolve(outDir, `${quality}-${variant}.png`) });
        if (!perVariant.has(variant)) perVariant.set(variant, { info, results: [] });
        perVariant.get(variant).results.push(result);
      }
    }
    await page.evaluate(() => window.__probe.setVariant("follow"));
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    for (const [variant, { info, results }] of perVariant) {
      const row = {
        quality, ...info,
        gpu: median(results.map((r) => r.gpuTotal.p50)),
        gpuP95: median(results.map((r) => r.gpuTotal.p95)),
        shadow: median(results.map((r) => r.gpuShadow.p50)),
        shadowP95: median(results.map((r) => r.gpuShadow.p95)),
        cpu: median(results.map((r) => r.cpuRender.p50)),
        calls: median(results.map((r) => r.calls)),
        shadowCalls: median(results.map((r) => r.shadowCalls)),
        triangles: median(results.map((r) => r.triangles)),
        rounds: results.map((r) => +r.gpuTotal.p50.toFixed(2)),
      };
      report.push(row);
      console.log(`${variant.padEnd(15)} gpu p50 ${row.gpu.toFixed(2)} p95 ${row.gpuP95.toFixed(2)} | shadow p50 ${row.shadow.toFixed(2)} p95 ${row.shadowP95.toFixed(2)} | cpu ${row.cpu.toFixed(2)} `
        + `| calls ${row.calls.toFixed(0)} (shadow ${row.shadowCalls.toFixed(0)}) tris ${(row.triangles / 1e6).toFixed(2)}M | lost ${info.lostPatches}/${info.patchedMaterials} `
        + `| rounds ${row.rounds.join(" ")} | ${info.cascades.map((c) => `${c.split.toFixed(0)}m/${c.halfExtent.toFixed(0)}m/${c.texelCm.toFixed(1)}cm`).join(" ")}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
}
