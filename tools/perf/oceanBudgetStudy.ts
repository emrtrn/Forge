import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cpus, platform, release } from "node:os";
import { Texture } from "three";
import { CooperativeWork } from "../../engine/core/cooperativeWork";
import { WORLD_SIZES, WORLD_TILES, WORLD_SPACING, randomWorldBrief, worldExtent, type RandomWorldOptions } from "../../engine/worldbuilder/randomWorld";
import { normalizeWorldBrief } from "../../engine/worldbuilder/worldBrief";
import { createBriefTerrain } from "../../engine/worldbuilder/briefTerrain";
import { createFlatTerrainTile, type WorldTerrainDef, type TerrainTileData } from "../../engine/terrain/terrainTypes";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { validateTerrainTile } from "../../engine/terrain/terrainLoader";
import { prepareOceanTerrain } from "../../engine/terrain/oceanPreparation";
import { sampleOceanCoverage, type OceanCoverage } from "../../engine/terrain/oceanCoverage";
import { OCEAN_LIMITS, type OceanWaterBody } from "../../engine/scene/oceanWater";
import { OceanSurface } from "../../engine/render-three/ocean/oceanSurface";
import type { OceanFft } from "../../engine/render-three/ocean/oceanFft";
import { N, LOG_N, CASCADE_LENGTHS } from "../../engine/render-three/ocean/oceanSpectrum";
import { oceanCoverageLayout } from "../../engine/terrain/oceanCoverageStorage";
import { prepareOceanGrid, oceanGridLevels } from "../../engine/render-three/ocean/oceanGrid";

interface Baseline {
  limits: { cells: number; axisCells: number };
  randomWorldBrief: typeof randomWorldBrief;
  prepareOceanTerrain: typeof prepareOceanTerrain;
}
interface StudyOptions { directory: string; repository: string; samples: number; warmups: number }
const gc = () => {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (!collect) throw new Error("Run the study with node --expose-gc");
  collect();
};
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, min: sorted[0]!, p50: sorted[Math.floor((sorted.length - 1) * .5)]!,
    p95: sorted[Math.ceil((sorted.length - 1) * .95)]!, max: sorted.at(-1)! };
};

/** Byte accounting of the CURRENT full-domain implementation, not a new budget. */
function buffers(nx: number, tileQuads: number, layerCount: number, gridBytes: number) {
  const cells = nx * nx, vertices = (nx + 1) ** 2, tileVertices = (tileQuads + 1) ** 2;
  const decodedTile = tileVertices * (4 + 4 * Math.ceil(layerCount / 4));
  const layout = oceanCoverageLayout(nx, nx), atlasBytes = layout.width * layout.height * 4;
  const coverageCpu = atlasBytes + cells;
  const fft = N * N * 4 * 16 + 2 * N * N * 4 * 2 * 8
    + CASCADE_LENGTHS.length * 2 * 2 * 8 * Array.from({ length: LOG_N + 1 }, (_, i) => (N >> i) ** 2).reduce((a, b) => a + b, 0);
  return {
    cells, vertices, decodedTile, decodedAllTiles: WORLD_TILES ** 2 * decodedTile,
    snapshotF64: 8 * vertices, presentCells: cells, coverageHeightsF32: 4 * vertices, connectedTrianglesU8: cells,
    floodQueueI32: 8 * cells, floodVisitedU8: 2 * cells,
    preparationTypedBuffers: 8 * vertices + atlasBytes + 12 * cells,
    coverageCpu, atlasCpu: atlasBytes, gridCpuAndGpuEach: gridBytes,
    steadyOceanCpuTyped: coverageCpu + gridBytes,
    // A conservative allocation window if preparation garbage has not been collected before packing.
    preparationAndPackingAllocationWindow: 8 * vertices + atlasBytes + 12 * cells + gridBytes,
    fourReadGuardEstimate: 4 * tileVertices * (8 + 8 * Math.ceil(layerCount / 4)),
    fourReadDecodedAndEncodedPayload: 4 * (2 * decodedTile + 32),
    coverageGpuFormatBytes: atlasBytes, fftGpuFormatBytes: fft,
    baseOceanGpuFormatBytes: atlasBytes + fft + gridBytes,
    // Controller constructs the complete replacement (including its own FFT) before disposing the old one.
    replacementBaseGpuFormatBytes: 2 * (atlasBytes + fft + gridBytes),
    replacementSteadyCpuTyped: 2 * (coverageCpu + gridBytes),
  };
}

async function fixture(options: RandomWorldOptions, study: StudyOptions) {
  const begun = performance.now(), normalized = normalizeWorldBrief(randomWorldBrief(options).brief);
  assert.ok(normalized.brief, normalized.issues.join("; "));
  const brief = normalized.brief, terrain = createBriefTerrain(brief), extent = worldExtent(options.size);
  const cover = JSON.parse(await readFile(join(study.repository, "public/assets/world-builder/covers/forest.cover.json"), "utf8"));
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: options.name,
    tileQuads: WORLD_SIZES[options.size], spacing: WORLD_SPACING, tilesX: WORLD_TILES, tilesZ: WORLD_TILES,
    origin: [-extent / 2, 0, -extent / 2], heightMin: brief.terrain.heightRange[0], heightMax: brief.terrain.heightRange[1],
    collision: false, layers: cover.layers, tiles: [] };
  const folder = join(study.directory, `${options.landform}-${options.size}`); await mkdir(folder, { recursive: true });
  let encodedBytes = 0;
  for (let z = 0; z < WORLD_TILES; z++) for (let x = 0; x < WORLD_TILES; x++) {
    const tile = createFlatTerrainTile(def, x, z); let min = Infinity, max = -Infinity;
    for (let j = 0; j < tile.size; j++) for (let i = 0; i < tile.size; i++) {
      const h = Math.fround(terrain.height(def.origin[0] + (x * def.tileQuads + i) * def.spacing,
        def.origin[2] + (z * def.tileQuads + j) * def.spacing));
      assert.ok(h >= def.heightMin && h <= def.heightMax, "height fixture must not be clamped on disk");
      tile.heights[j * tile.size + i] = h; min = Math.min(min, h); max = Math.max(max, h);
    }
    const key = `${x}_${z}`; def.tiles.push({ key, minHeight: min, maxHeight: max });
    // Match worldBriefBuild's saved native height format; no authored level is generated.
    const encoded = encodeTerrainTile(tile, { ...def, heightFormat: "f32" });
    await writeFile(join(folder, `${key}.tile.bin`), encoded); encodedBytes += encoded.byteLength;
  }
  const body: OceanWaterBody = { schema: 1, kind: "ocean", coordinateSpace: "world", id: "sea", terrainRef: "terrain",
    bounds: { min: [-extent / 2, -extent / 2], max: [extent / 2, extent / 2] },
    openEdges: ["west", "east", "north", "south"], surfaceLevel: 0, offshoreDepth: 40,
    ...(options.landform === "coast" ? { offshorePolicy: "connectedBoundary" as const } : {}) };
  return { def, body, folder, encodedBytes, fixtureMs: performance.now() - begun };
}

function coverageFingerprint(coverage: OceanCoverage) {
  let depthChecksum = 0, maskChecksum = 0;
  for (let i = 0; i < coverage.heights.length; i++) depthChecksum += coverage.heights[i]!;
  for (let i = 0; i < coverage.triangles.length; i++) maskChecksum += coverage.triangles[i]!;
  return { status: coverage.status, wetFaces: coverage.wetFaces, depthChecksum, maskChecksum };
}

export async function runOceanBudgetStudy(baseline: Baseline, study: StudyOptions) {
  assert.equal(baseline.limits.cells, 1048576, "baseline must retain the Medium production limit");
  assert.equal(OCEAN_LIMITS.cells, 4194304, "only the diagnostic bundle raises the full-domain cap");
  const cases = [];
  for (const landform of ["island", "coast"] as const) for (const size of ["small", "medium", "large"] as const) {
    console.log(`[ocean-budget] ${landform}/${size}: fixture`);
    const options: RandomWorldOptions = { id: `budget-${landform}-${size}`, name: "Ocean budget fixture", seed: 11,
      size, landform, mountainHeight: "medium", roads: "between", settlements: [], rivers: 0, lakes: 0, cover: "forest", seaSide: "west" };
    const productionAllowed = (WORLD_TILES * WORLD_SIZES[size]) ** 2 <= baseline.limits.cells;
    if (!productionAllowed) assert.throws(() => baseline.randomWorldBrief(options), /Ocean terrain budget/);
    else assert.deepEqual(randomWorldBrief(options), baseline.randomWorldBrief(options), "Small generation must be unchanged");
    const source = await fixture(options, study), { def, body } = source;
    // Use Uint8Array semantics like fetch: Buffer.slice would retain the entire
    // encoded file behind decoded weights, distorting resident memory accounting.
    const read = async (key: string) => {
      const bytes = await readFile(join(source.folder, `${key}.tile.bin`));
      return validateTerrainTile(def, key, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    };
    let baselineReads = 0;
    if (!productionAllowed) await assert.rejects(() => baseline.prepareOceanTerrain({ def, tiles: new Map() }, body,
      async key => { baselineReads++; return read(key); }), /over-budget/);
    assert.equal(baselineReads, 0, "production must reject before native tile I/O");
    const paths = []; let fingerprint: ReturnType<typeof coverageFingerprint> | undefined, inventory: ReturnType<typeof buffers> | undefined;
    for (const residency of ["resident", "disk-four-at-a-time"] as const) {
      const tiles = new Map<string, TerrainTileData>();
      if (residency === "resident") for (const { key } of def.tiles) tiles.set(key, await read(key));
      const beforeKeys = [...tiles.keys()]; const runs = [];
      // A separate async frame releases the previous coverage/surface before
      // the next GC baseline; loop-local const bindings can otherwise retain it.
      const measure = async () => {
        const baseMemory = process.memoryUsage();
        let checkpointArrayBuffers = baseMemory.arrayBuffers, checkpointHeap = baseMemory.heapUsed, checkpointRss = baseMemory.rss;
        const checkpoint = () => { const m = process.memoryUsage(); checkpointArrayBuffers = Math.max(checkpointArrayBuffers, m.arrayBuffers);
          checkpointHeap = Math.max(checkpointHeap, m.heapUsed); checkpointRss = Math.max(checkpointRss, m.rss); };
        let reads = 0, inFlight = 0, maxInFlight = 0, bytesRead = 0, decodeMs = 0;
        const load = async (key: string) => {
          reads++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
          try { const bytes = await readFile(join(source.folder, `${key}.tile.bin`)); bytesRead += bytes.byteLength;
            const t = performance.now(), tile = validateTerrainTile(def, key, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
            decodeMs += performance.now() - t; return tile;
          } finally { inFlight--; }
        };
        const slices: Record<string, number[]> = {};
        // Keep real task boundaries without Windows/Node's setTimeout timer
        // granularity dominating every tile. This is not browser latency evidence.
        const work = new CooperativeWork({ yieldTask: () => new Promise<void>(resolve => setImmediate(resolve)),
          onSlice: slice => { (slices[slice.phase] ??= []).push(slice.milliseconds); checkpoint(); } });
        const begun = performance.now(), prepareCpuAt = process.cpuUsage();
        const coverage = await prepareOceanTerrain({ def, tiles }, body, load, work);
        const prepareMs = performance.now() - begun, prepareCpu = process.cpuUsage(prepareCpuAt); checkpoint();
        const current = coverageFingerprint(coverage); assert.equal(current.status, "ready");
        if (fingerprint) assert.deepEqual(current, fingerprint, "residency and repeat must not change exact coverage");
        else fingerprint = current;
        if (landform === "coast") {
          assert.equal(sampleOceanCoverage(coverage, -worldExtent(size), 0).status, "wet");
          assert.equal(sampleOceanCoverage(coverage, worldExtent(size), 0).status, "dry");
        }
        // Measure the actual CPU packing/grid/material constructor, without creating a GL context or claiming GPU allocation.
        const textures = Array.from({ length: 7 }, () => new Texture());
        const simulation = { lengths: CASCADE_LENGTHS, displacement: textures.slice(0, 3), slopes: textures.slice(3), stats: { time: 0 } } as unknown as OceanFft;
        const packedAt = performance.now(), packCpuAt = process.cpuUsage();
        const grid = await prepareOceanGrid(work, 64, oceanGridLevels(body)), surface = new OceanSurface(coverage, simulation, undefined, grid), packMs = performance.now() - packedAt;
        const packCpu = process.cpuUsage(packCpuAt);
        checkpoint();
        const gridBytes = Object.values(surface.geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0) + surface.geometry.index!.array.byteLength;
        inventory = buffers(def.tileQuads * def.tilesX, def.tileQuads, def.layers.length, gridBytes);
        assert.equal((surface.coverageTexture.image.data as Float32Array).byteLength, inventory.atlasCpu);
        assert.equal(coverage.heights.buffer, (surface.coverageTexture.image.data as Float32Array).buffer);
        surface.dispose(); textures.forEach(texture => texture.dispose());
        assert.deepEqual([...tiles.keys()], beforeKeys, "Ocean reads must not populate native residency");
        assert.equal(reads, residency === "resident" ? 0 : WORLD_TILES ** 2); assert.ok(maxInFlight <= 4);
        return { prepareMs, packMs, prepareCpuMs: (prepareCpu.user + prepareCpu.system) / 1000,
          packCpuMs: (packCpu.user + packCpu.system) / 1000, reads, maxInFlight, bytesRead, decodeMs,
          checkpointArrayBuffersDelta: checkpointArrayBuffers - baseMemory.arrayBuffers,
          checkpointHeapDelta: checkpointHeap - baseMemory.heapUsed, checkpointRssDelta: checkpointRss - baseMemory.rss,
          slices: Object.fromEntries(Object.entries(slices).map(([phase, values]) => [phase, { ...distribution(values), sum: values.reduce((a, b) => a + b, 0) }])) };
      };
      for (let iteration = -study.warmups; iteration < study.samples; iteration++) {
        await new Promise<void>(resolve => setImmediate(resolve)); gc();
        const run = await measure(); if (iteration >= 0) runs.push(run);
      }
      paths.push({ residency, runs,
        prepareMs: distribution(runs.map(run => run.prepareMs)), packMs: distribution(runs.map(run => run.packMs)),
        prepareCpuMs: distribution(runs.map(run => run.prepareCpuMs)), packCpuMs: distribution(runs.map(run => run.packCpuMs)),
        maxSliceMs: distribution(runs.map(run => Math.max(...Object.values(run.slices).map(phase => phase.max)))),
        checkpointArrayBuffersDelta: distribution(runs.map(run => run.checkpointArrayBuffersDelta)) });
      tiles.clear(); gc();
      console.log(`[ocean-budget] ${landform}/${size}/${residency}: p50 ${paths.at(-1)!.prepareMs.p50.toFixed(1)} ms`);
    }
    cases.push({ landform, size, extent: worldExtent(size), spacing: def.spacing, tileQuads: def.tileQuads, tiles: def.tiles.length,
      layers: def.layers.length, productionAllowed, baselineReadsBeforeRejection: baselineReads,
      fixtureMs: source.fixtureMs, encodedBytes: source.encodedBytes, fingerprint, inventory, paths });
  }
  return { schema: 2, representation: "R32F atlas, eight cells per flag word", measuredAtUtc: new Date().toISOString(), host: { platform: platform(), release: release(), node: process.version,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length }, samples: study.samples, warmups: study.warmups,
    protocol: { seed: 11, landforms: ["island", "coast-west"], settlements: 0, rivers: 0, lakes: 0, heightFormat: "f32",
      io: "local filesystem reads after fixture creation; OS cache not flushed; not cold I/O", scheduler: "CooperativeWork 2 ms target, explicit Node setImmediate task yields; not browser or default Node timer latency",
      timing: "preparation includes atlas packing; packMs is now cooperative grid preparation + short surface constructor, NOT historic RGBA packing; fixture synthesis, GC and fingerprints excluded; onSlice memory instrumentation included in wall time",
      memory: "exact typed-array/texture-format accounting plus process checkpoints; checkpoints are not continuous peaks; driver/JS overhead excluded from format accounting",
      graphics: "no WebGL context; texture bytes are format accounting, not measured GPU time/VRAM; no planar/snapshot/caustics/terrain-renderer budget included" }, cases };
}
