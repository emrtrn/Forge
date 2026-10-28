import assert from "node:assert/strict";
import { normalizeFoliageType, type LandscapeFoliageRule } from "../../engine/scene/foliage";
import {
  FoliageTerrainStore, generateFoliageCell,
  worldTerrainFoliageSurface, type GeneratedFoliageCell,
} from "../../engine/scene/proceduralFoliage";
import { TerrainTileMap } from "../../engine/terrain/terrainHeightQuery";
import type { TerrainTileData } from "../../engine/terrain/terrainTypes";
import type { FoliageWorkerRequest, FoliageWorkerResponse } from "../../engine/world/workers/foliageWorker";
import {
  createFoliageCellGenerator, LocalFoliageCellGenerator, WorkerFoliageCellGenerator,
  type FoliageCellGenerator, type FoliageCellJob, type FoliageGeneratorTerrainDef,
} from "../../src/scene/foliageCellGenerator";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
const DEF: FoliageGeneratorTerrainDef = {
  tileQuads: 4, spacing: 2, tilesX: 2, tilesZ: 1, origin: [0, 3, 0], layers: [{ id: "grass" }],
};
const RULE: LandscapeFoliageRule = {
  id: "grass-rule", landscapeId: "ground", layerId: "grass", foliageTypeId: "grass",
  density: 1, minWeight: 0.5, seed: 17,
};
const JOB: FoliageCellJob = {
  terrainId: "ground", rule: RULE,
  type: normalizeFoliageType({ name: "Grass", meshAssetId: "grass", slopeMax: 90,
    zOffsetMin: 0, zOffsetMax: 0 }),
  request: { cellX: 0, cellZ: 0, cellSize: 16, keepFraction: 1 },
};

function tiles(): TerrainTileData[] {
  return [0, 1].map((x) => {
    const size = DEF.tileQuads + 1;
    const heights = Float32Array.from({ length: size * size }, (_, index) =>
      (x * DEF.tileQuads + index % size) * 0.25 + Math.floor(index / size) * 0.125);
    const weights = new Uint8Array(size * size * 4);
    for (let i = 0; i < heights.length; i += 1) weights[i * 4] = 128 + (i % 5) * 30;
    return { x, z: 0, size, heights, layerCount: 1, weights };
  });
}

function populate(generator: FoliageCellGenerator, data = tiles()): void {
  generator.setTerrain(JOB.terrainId, DEF);
  for (const tile of data) generator.setTile(JOB.terrainId, tile);
}

function direct(data = tiles()): GeneratedFoliageCell {
  const map = new TerrainTileMap();
  for (const tile of data) map.set(tile);
  return generateFoliageCell(JOB.rule, JOB.type, worldTerrainFoliageSurface(DEF, map), JOB.request);
}

function equalCells(actual: GeneratedFoliageCell, expected: GeneratedFoliageCell): void {
  assert.equal(actual.count, expected.count);
  assert.equal(actual.matrices.length, actual.count * 16);
  assert.deepEqual(new Uint8Array(actual.matrices.buffer, actual.matrices.byteOffset, actual.matrices.byteLength),
    new Uint8Array(expected.matrices.buffer, expected.matrices.byteOffset, expected.matrices.byteLength));
}

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent<FoliageWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly messages: { message: FoliageWorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;

  constructor() { FakeWorker.latest = this; }

  postMessage(message: FoliageWorkerRequest, transfer: Transferable[] = []): void {
    this.messages.push({ message: structuredClone(message, { transfer }), transfer });
  }

  emit(data: FoliageWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<FoliageWorkerResponse>);
  }

  terminate(): void { this.terminated = true; }
}

async function withWorker(worker: unknown, fn: () => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  try {
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: worker });
    await fn();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "Worker", descriptor);
    else Reflect.deleteProperty(globalThis, "Worker");
  }
}

async function withWarnings(fn: (warnings: unknown[][]) => Promise<void>): Promise<void> {
  const warn = console.warn;
  const warnings: unknown[][] = [];
  try {
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    await fn(warnings);
  } finally { console.warn = warn; }
}

/** Registers local state, legacy surface, worker protocol and fallback checks. */
export async function registerFoliageCellGeneratorTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("foliage cell generator: local and shared store match direct two-tile generation byte for byte", async () => {
    const generator = new LocalFoliageCellGenerator();
    const store = new FoliageTerrainStore();
    try {
      populate(generator);
      store.setTerrain(JOB.terrainId, DEF);
      for (const tile of tiles()) store.setTile(JOB.terrainId, tile);
      const expected = direct();
      assert.ok(expected.count > 0);
      equalCells(await generator.generate(JOB), expected);
      equalCells(store.generate(JOB.terrainId, JOB.rule, JOB.type, JOB.request), expected);
      store.removeTile(JOB.terrainId, 1, 0);
      equalCells(store.generate(JOB.terrainId, JOB.rule, JOB.type, JOB.request), direct([tiles()[0]!]));
      store.setTerrain(JOB.terrainId, DEF);
      assert.equal(store.generate(JOB.terrainId, JOB.rule, JOB.type, JOB.request).count, 0);
      store.removeTerrain(JOB.terrainId);
      assert.throws(() => store.generate(JOB.terrainId, JOB.rule, JOB.type, JOB.request), /Unknown foliage terrain/);
    } finally { generator.dispose(); }
  });

  await checkAsync("foliage cell generator: tile arrays are copied and same-coordinate replacements take effect", async () => {
    const generator = new LocalFoliageCellGenerator();
    const data = tiles();
    try {
      populate(generator, data);
      const expected = direct(data);
      for (const tile of data) { tile.heights.fill(999); tile.weights.fill(0); }
      equalCells(await generator.generate(JOB), expected);
      generator.setTile(JOB.terrainId, data[0]!);
      equalCells(await generator.generate(JOB), direct([data[0]!, tiles()[1]!]));
      assert.ok(data[0]!.heights.byteLength > 0 && data[0]!.weights.byteLength > 0);
    } finally { generator.dispose(); }
  });

  await checkAsync("foliage cell generator: missing and removed tiles leave only the other tile's instances", async () => {
    const generator = new LocalFoliageCellGenerator();
    const data = tiles();
    try {
      generator.setTerrain(JOB.terrainId, DEF);
      generator.setTile(JOB.terrainId, data[0]!);
      const missing = await generator.generate(JOB);
      assert.ok(missing.count > 0);
      for (let i = 0; i < missing.count; i += 1) {
        assert.ok(missing.matrices[i * 16 + 12]! >= 0 && missing.matrices[i * 16 + 12]! < 8);
      }
      generator.setTile(JOB.terrainId, data[1]!);
      assert.ok((await generator.generate(JOB)).count > missing.count);
      generator.removeTile(JOB.terrainId, 1, 0);
      equalCells(await generator.generate(JOB), missing);
      assert.equal((await generator.generate({ ...JOB, request: { ...JOB.request, cellX: 1, cellSize: 8 } })).count, 0);
      generator.removeTile(JOB.terrainId, 0, 0);
      assert.equal((await generator.generate(JOB)).count, 0);
    } finally { generator.dispose(); }
  });

  await checkAsync("foliage cell generator: replacing a terrain clears only its own tiles", async () => {
    const generator = new LocalFoliageCellGenerator();
    try {
      populate(generator);
      generator.setTerrain("other", DEF);
      for (const tile of tiles()) generator.setTile("other", tile);
      generator.setTerrain(JOB.terrainId, DEF);
      assert.equal((await generator.generate(JOB)).count, 0);
      equalCells(await generator.generate({ ...JOB, terrainId: "other" }), direct());
      generator.removeTerrain("other");
      await assert.rejects(generator.generate({ ...JOB, terrainId: "other" }), /Unknown foliage terrain/);
    } finally { generator.dispose(); }
  });

  await checkAsync("foliage cell generator: unknown and disposed generation reject without synchronous throws", async () => {
    const generator = new LocalFoliageCellGenerator();
    const unknown = generator.generate(JOB);
    assert.ok(unknown instanceof Promise);
    await assert.rejects(unknown, /Unknown foliage terrain/);
    populate(generator);
    generator.dispose();
    generator.dispose();
    await assert.rejects(generator.generate(JOB), { message: "Foliage cell generator disposed" });
  });

  await checkAsync("foliage cell generator: worker construction failure resolves jobs locally and warns once", async () => {
    class ThrowingWorker {
      constructor() { throw new Error("Cannot start worker"); }
    }
    await withWorker(ThrowingWorker, () => withWarnings(async (warnings) => {
      const generator = new WorkerFoliageCellGenerator();
      try {
        populate(generator);
        const results = await Promise.all([generator.generate(JOB), generator.generate(JOB)]);
        for (const result of results) equalCells(result, direct());
        generator.removeTile(JOB.terrainId, 1, 0);
        equalCells(await generator.generate(JOB), direct([tiles()[0]!]));
        assert.equal(warnings.length, 1);
      } finally { generator.dispose(); }
      await assert.rejects(generator.generate(JOB), { message: "Foliage cell generator disposed" });
    }));
  });

  await checkAsync("foliage cell generator: immediate worker crash reruns pending and later jobs locally", async () => {
    class CrashingWorker extends FakeWorker {
      constructor() {
        super();
        queueMicrotask(() => this.onerror?.({ message: "Worker crashed" } as ErrorEvent));
      }
    }
    await withWorker(CrashingWorker, () => withWarnings(async (warnings) => {
      const generator = new WorkerFoliageCellGenerator();
      try {
        populate(generator);
        const results = await Promise.all([generator.generate(JOB), generator.generate(JOB)]);
        for (const result of results) equalCells(result, direct());
        assert.ok(FakeWorker.latest.terminated);
        equalCells(await generator.generate(JOB), direct());
        generator.removeTile(JOB.terrainId, 1, 0);
        equalCells(await generator.generate(JOB), direct([tiles()[0]!]));
        assert.equal(warnings.length, 1);
      } finally { generator.dispose(); }
    }));
  });

  await checkAsync("foliage cell generator: tile transfers preserve caller buffers and job errors remain scoped", async () => {
    await withWorker(FakeWorker, async () => {
      const generator = new WorkerFoliageCellGenerator();
      const worker = FakeWorker.latest;
      const data = tiles();
      const before = data.map((tile) => ({ heights: tile.heights.slice(), weights: tile.weights.slice() }));
      try {
        populate(generator, data);
        assert.deepEqual(worker.messages.map(({ message }) => message.type), ["terrain", "tile", "tile"]);
        data.forEach((tile, index) => {
          assert.deepEqual(tile.heights, before[index]!.heights);
          assert.deepEqual(tile.weights, before[index]!.weights);
          const sent = worker.messages[index + 1]!;
          assert.equal(sent.transfer.length, 2);
          assert.equal(sent.message.type, "tile");
          if (sent.message.type === "tile") {
            assert.notEqual(sent.message.tile.heights.buffer, tile.heights.buffer);
            assert.deepEqual(sent.message.tile.heights, tile.heights);
            assert.deepEqual(sent.message.tile.weights, tile.weights);
          }
        });
        const first = generator.generate({ ...JOB, terrainId: "unknown" });
        const second = generator.generate(JOB);
        const failed = assert.rejects(first, { message: "Unknown foliage terrain: unknown" });
        worker.emit({ type: "error", id: 0, message: "Unknown foliage terrain: unknown" });
        worker.emit({ type: "generated", id: 1, ...direct() });
        await failed;
        equalCells(await second, direct());
        assert.equal(worker.terminated, false);
      } finally { generator.dispose(); }
      assert.ok(worker.terminated);
    });
  });

  await checkAsync("foliage cell generator: unscoped and message errors use all mirrored terrain updates", async () => {
    for (const failure of ["unscoped", "message"] as const) {
      await withWorker(FakeWorker, () => withWarnings(async (warnings) => {
        const generator = new WorkerFoliageCellGenerator();
        const worker = FakeWorker.latest;
        try {
          const data = tiles();
          populate(generator, data);
          for (const tile of data) { tile.heights.fill(999); tile.weights.fill(0); }
          generator.removeTile(JOB.terrainId, 1, 0);
          generator.setTerrain("cleared", DEF);
          generator.setTile("cleared", tiles()[0]!);
          generator.setTerrain("cleared", DEF);
          generator.setTerrain("removed", DEF);
          generator.removeTerrain("removed");
          const pending = generator.generate(JOB);
          if (failure === "unscoped") worker.emit({ type: "error", id: null, message: "Worker state failed" });
          else worker.onmessageerror?.();
          equalCells(await pending, direct([tiles()[0]!]));
          assert.equal((await generator.generate({ ...JOB, terrainId: "cleared" })).count, 0);
          await assert.rejects(generator.generate({ ...JOB, terrainId: "removed" }), /Unknown foliage terrain/);
          assert.ok(worker.terminated);
          assert.equal(warnings.length, 1);
        } finally { generator.dispose(); }
      }));
    }
  });

  await checkAsync("foliage cell generator: disposal rejects pending worker jobs and subsequent requests", async () => {
    await withWorker(FakeWorker, async () => {
      const generator = new WorkerFoliageCellGenerator();
      populate(generator);
      const pending = [generator.generate(JOB), generator.generate(JOB)];
      generator.dispose();
      for (const promise of pending) {
        await assert.rejects(promise, { message: "Foliage cell generator disposed" });
      }
      await assert.rejects(generator.generate(JOB), { message: "Foliage cell generator disposed" });
      assert.ok(FakeWorker.latest.terminated);
    });
  });

  await checkAsync("foliage cell generator: factory selects worker availability", async () => {
    await withWorker(undefined, async () => {
      const generator = createFoliageCellGenerator();
      try {
        assert.ok(generator instanceof LocalFoliageCellGenerator);
        populate(generator);
        equalCells(await generator.generate(JOB), direct());
      } finally { generator.dispose(); }
    });
    await withWorker(FakeWorker, async () => {
      const generator = createFoliageCellGenerator();
      try { assert.ok(generator instanceof WorkerFoliageCellGenerator); }
      finally { generator.dispose(); }
    });
  });
}
