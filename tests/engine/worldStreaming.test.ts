/** Streaming execution with manual IO and time, plus worker-ready terrain decoding. */
import assert from "node:assert/strict";
import { ContentLoadError } from "../../engine/assets/contentValidation";
import { decodeTerrainTileForStreaming } from "../../engine/terrain/terrainTileStreaming";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { createFlatTerrainTile, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { computeStreamingTargets, type StreamingSource } from "../../engine/world/streamingPolicy";
import { WorldStreamingSubsystem, type WorldCellLoader, type WorldStreamingOptions } from "../../engine/world/worldStreamingSubsystem";
import type { TerrainWorkerRequest, TerrainWorkerResponse } from "../../engine/world/workers/terrainWorker";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
interface Payload { id: string; bytes: number }
interface Request {
  key: string;
  signal: AbortSignal;
  resolve: (data: Payload) => void;
  reject: (error: unknown) => void;
}

const at = (...xs: number[]): StreamingSource[] => xs.map((x) => ({ position: [x, 5] }));
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

function fixture(overrides: Partial<WorldStreamingOptions<Payload>> = {}) {
  const requests: Request[] = [];
  const events: string[] = [];
  const warnings: string[] = [];
  const time = { now: 0, activationCost: 0 };
  const loader: WorldCellLoader<Payload> = {
    fetch: (key, signal) => {
      events.push(`fetch:${key}`);
      return new Promise((resolve, reject) => requests.push({ key, signal, resolve, reject }));
    },
    byteSize: (data) => data.bytes,
    activate: (key, data) => { events.push(`activate:${key}:${data.id}`); time.now += time.activationCost; },
    deactivate: (key, data) => { events.push(`deactivate:${key}:${data.id}`); },
    dispose: (key, data) => { events.push(`dispose:${key}:${data.id}`); },
  };
  const options: WorldStreamingOptions<Payload> = {
    settings: { cellSize: 10, loadRange: 0 },
    bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 10 },
    clock: () => time.now, loader, warn: (message) => warnings.push(message), ...overrides,
  };
  const world = new WorldStreamingSubsystem(options);
  const resolve = async (index: number, bytes = 8, id = requests[index]!.key) => {
    requests[index]!.resolve({ bytes, id });
    await flush();
  };
  return { world, requests, events, warnings, time, loader, resolve };
}

function terrainDefinition(layerCount = 5): WorldTerrainDef {
  return {
    schema: 1, type: "worldTerrain", name: "streaming", tileQuads: 32, spacing: 2,
    tilesX: 1, tilesZ: 1, origin: [10, 100, 20], heightMin: -32, heightMax: 32,
    layers: Array.from({ length: layerCount }, (_, i) => ({ id: `l${i}`, name: `Layer ${i}`, color: "#ffffff" })),
    tiles: [{ key: "0_0", minHeight: -10, maxHeight: 20 }], collision: true,
  };
}

export async function registerWorldStreamingTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  await checkAsync("world streaming: lifecycle, stats and deactivate before unload", async () => {
    const f = fixture({ memoryBudgetBytes: 0 });
    const states: number[] = [];
    const deactivate = f.loader.deactivate;
    f.loader.deactivate = (key, data) => { states.push(f.world.stats().counts.Deactivating); deactivate(key, data); };
    assert.equal(f.world.stats().counts.Unloaded, 10);
    f.world.update(at(5));
    assert.equal(f.world.stats().counts.Fetching, 1);
    await f.resolve(0);
    assert.equal(f.world.stats().counts.Loaded, 1);
    assert.equal(f.world.stats().bytesResident, 8);
    f.world.update(at(5));
    assert.equal(f.world.stats().counts.Activated, 1);
    f.world.update([]);
    assert.deepEqual(f.events, ["fetch:0_0", "activate:0_0:0_0", "deactivate:0_0:0_0", "dispose:0_0:0_0"]);
    assert.deepEqual(states, [1]);
    assert.equal(f.world.stats().bytesResident, 0);
    assert.equal(f.world.stats().counts.Unloaded, 10);
    assert.equal(f.world.stats().evictions, 1);
    f.world.dispose();
  });

  await checkAsync("world streaming: priority and default six concurrent fetches", async () => {
    const settings = { cellSize: 10, loadRange: 100 };
    const bounds = { minX: 0, minZ: 0, maxX: 100, maxZ: 10 };
    const sources: StreamingSource[] = [{ position: [5, 5], velocity: [10, 0] }];
    const f = fixture({ settings, bounds });
    const ordered = computeStreamingTargets({ loaded: new Set(), active: new Set() }, sources, settings, bounds).toLoad;
    f.world.update(sources);
    assert.equal(ordered[0], "1_0");
    assert.deepEqual(f.requests.map((request) => request.key), ordered.slice(0, 6));
    assert.equal(f.world.stats().inFlight, 6);
    assert.equal(f.world.stats().queued, 4);
    f.world.update(sources);
    assert.equal(f.requests.length, 6);
    await f.resolve(0);
    f.world.update(sources);
    assert.equal(f.requests.length, 7);
    assert.equal(f.world.stats().inFlight, 6);
    f.world.dispose();
  });

  await checkAsync("world streaming: configurable fetch cap and union of sources", async () => {
    const f = fixture({ maxConcurrentFetches: 2 });
    f.world.update(at(5, 35, 65));
    assert.deepEqual(f.requests.map((request) => request.key), ["0_0", "3_0"]);
    await f.resolve(1);
    f.world.update(at(5, 35, 65));
    assert.equal(f.requests[2]!.key, "6_0");
    assert.equal(f.world.stats().inFlight, 2);
    f.world.dispose();
  });

  await checkAsync("world streaming: pending fetch uses hysteresis before aborting", async () => {
    const f = fixture({ settings: { cellSize: 10, loadRange: 10 }, maxConcurrentFetches: 1 });
    f.world.update(at(5));
    assert.equal(f.requests[0]!.key, "0_0");
    f.world.update(at(22)); // Distance 12, within 10 * 1.25.
    assert.equal(f.requests[0]!.signal.aborted, false);
    f.world.update(at(23));
    assert.equal(f.requests[0]!.signal.aborted, true);
    assert.equal(f.requests.length, 2);
    assert.equal(f.world.stats().inFlight, 1);
    f.world.dispose();
  });

  await checkAsync("world streaming: aborted late result cannot replace a new request for the same key", async () => {
    const f = fixture();
    f.world.update(at(5));
    f.world.update([]);
    f.world.update(at(5));
    await f.resolve(0, 8, "stale");
    assert.equal(f.world.stats().inFlight, 1);
    assert.equal(f.world.stats().bytesResident, 0);
    await f.resolve(1, 8, "fresh");
    f.world.update(at(5));
    assert.deepEqual(f.events, ["fetch:0_0", "fetch:0_0", "dispose:0_0:stale", "activate:0_0:fresh"]);
    assert.equal(f.world.stats().failures, 0);
    f.world.dispose();
  });

  await checkAsync("world streaming: activation budget defers work and supports zero and override", async () => {
    const f = fixture();
    const sources = at(5, 15, 25);
    f.time.activationCost = 4;
    f.world.update(sources);
    for (let i = 0; i < 3; i += 1) await f.resolve(i);
    f.world.update(sources, 0);
    assert.equal(f.world.stats().counts.Activated, 0);
    assert.equal(f.world.stats().queued, 3);
    f.world.update(sources);
    assert.equal(f.world.stats().counts.Activated, 1);
    assert.equal(f.world.stats().lastFrameMs, 4);
    assert.equal(f.world.stats().queued, 2);
    f.world.update(sources, 8);
    assert.equal(f.world.stats().counts.Activated, 3);
    assert.equal(f.world.stats().lastFrameMs, 8);
    assert.equal(f.world.stats().queued, 0);
    f.world.dispose();
  });

  await checkAsync("world streaming: atomic activation overrun starts no further work", async () => {
    const f = fixture();
    f.time.activationCost = 7;
    f.world.update(at(5, 15));
    await f.resolve(0);
    await f.resolve(1);
    f.world.update(at(5, 15));
    assert.equal(f.world.stats().counts.Activated, 1);
    assert.equal(f.world.stats().lastFrameMs, 7);
    f.world.update(at(5, 15));
    assert.equal(f.world.stats().counts.Activated, 2);
    f.world.dispose();
  });

  await checkAsync("world streaming: prefetch stays inactive and cached reentry avoids fetch", async () => {
    const f = fixture({ settings: { cellSize: 10, loadRange: 10, activateRange: 0 } });
    f.world.update(at(5));
    await f.resolve(0);
    await f.resolve(1);
    f.world.update(at(5));
    assert.equal(f.world.stats().counts.Activated, 1);
    assert.equal(f.world.stats().counts.Loaded, 1);
    f.world.update([]);
    assert.equal(f.world.stats().counts.Loaded, 2);
    f.world.update(at(15));
    assert.equal(f.world.isAreaReady([15, 5], 0), true);
    assert.equal(f.requests.filter((request) => request.key === "1_0").length, 1);
    f.world.dispose();
  });

  await checkAsync("world streaming: LRU byte eviction refreshes needed cells and pins active data", async () => {
    const f = fixture({ memoryBudgetBytes: 16 });
    f.world.update(at(5, 15));
    await f.resolve(0);
    await f.resolve(1);
    f.world.update(at(5, 15));
    f.world.update(at(5)); // 0_0 is needed more recently than 1_0.
    f.world.update(at(25));
    await f.resolve(2);
    f.world.update(at(25), 0); // 24 inactive bytes: evict the older 1_0.
    assert.ok(f.events.includes("dispose:1_0:1_0"));
    assert.ok(!f.events.includes("dispose:0_0:0_0"));
    assert.equal(f.world.stats().bytesResident, 16);
    f.world.update(at(25));
    f.world.update(at(35));
    await f.resolve(3, 40);
    f.world.update(at(35));
    assert.equal(f.world.stats().counts.Activated, 1);
    assert.ok(f.world.stats().bytesResident >= 40); // Active data is outside the inactive budget.
    f.world.update([]);
    assert.equal(f.world.stats().bytesResident, 0);
    assert.ok(f.events.indexOf("deactivate:3_0:3_0") < f.events.indexOf("dispose:3_0:3_0"));
    f.world.dispose();
  });

  await checkAsync("world streaming: missing and corrupt fallback emits one classified warning per key", async () => {
    for (const reason of ["http", "network", "invalid-json", "invalid-data", "unsupported-version"] as const) {
      const f = fixture();
      f.loader.fallback = () => ({ id: "flat", bytes: 4 });
      f.world.update(at(5));
      f.requests[0]!.reject(new ContentLoadError("tiles/0_0", reason, "bad tile"));
      await flush();
      f.world.update(at(5));
      assert.equal(f.world.isAreaReady([5, 5], 0), true);
      assert.equal(f.warnings.length, 1);
      assert.ok(f.warnings[0]!.startsWith("[world] 0_0"));
      assert.ok(f.warnings[0]!.includes(`(${reason})`));
      assert.ok(f.warnings[0]!.includes("using fallback"));
      f.world.update(at(5));
      assert.equal(f.requests.length, 1);
      f.world.dispose();
    }
  });

  await checkAsync("world streaming: failed cells retry only after leaving retention and warning stays deduplicated", async () => {
    const f = fixture();
    f.world.update(at(5));
    f.requests[0]!.reject(new Error("corrupt"));
    await flush();
    for (let i = 0; i < 4; i += 1) f.world.update(at(5));
    assert.equal(f.requests.length, 1);
    assert.equal(f.world.stats().failures, 1);
    assert.equal(f.world.isAreaReady([5, 5], 0), false);
    assert.ok(f.warnings[0]!.includes("invalid-data"));
    assert.ok(f.warnings[0]!.includes("cell unavailable"));
    f.world.update([]);
    f.world.update(at(5));
    f.requests[1]!.reject(new Error("corrupt again"));
    await flush();
    assert.equal(f.requests.length, 2);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.world.stats().failures, 2);
    f.world.dispose();
  });

  await checkAsync("world streaming: evicted fallback and throwing fallback cannot cause retry storms", async () => {
    for (const throwing of [false, true]) {
      const f = fixture({ memoryBudgetBytes: 0 });
      f.loader.fallback = () => {
        if (throwing) throw new Error("broken fallback");
        return { id: "flat", bytes: 4 };
      };
      f.world.update(at(5));
      f.requests[0]!.reject(new Error("corrupt"));
      await flush();
      for (let i = 0; i < 4; i += 1) f.world.update(at(5), 0);
      assert.equal(f.requests.length, 1);
      assert.equal(f.world.stats().bytesResident, 0);
      assert.equal(f.warnings.length, 1);
      f.world.dispose();
    }
  });

  await checkAsync("world streaming: area readiness clips to world and wait resolves only on update", async () => {
    const f = fixture();
    let ready = false;
    const wait = f.world.waitForArea([0, 5], 11).then(() => { ready = true; });
    assert.equal(f.world.isAreaReady([0, 5], 11), false);
    f.world.update(at(5, 15));
    await f.resolve(0);
    f.world.update(at(5, 15));
    await flush();
    assert.equal(ready, false);
    await f.resolve(1);
    assert.equal(ready, false);
    f.world.update(at(5, 15));
    await wait;
    assert.equal(ready, true);
    assert.equal(f.world.isAreaReady([-100, 5], 0), true);
    let later = false;
    const alreadyReady = f.world.waitForArea([5, 5], 0).then(() => { later = true; });
    await flush();
    assert.equal(later, false);
    f.world.update(at(5, 15));
    await alreadyReady;
    assert.equal(later, true);
    f.world.dispose();
  });

  await checkAsync("world streaming: dispose aborts, deactivates, releases data and rejects waiters once", async () => {
    const f = fixture();
    f.world.update(at(5, 15, 25));
    await f.resolve(0);
    f.world.update(at(5, 15, 25));
    await f.resolve(1);
    const rejected = assert.rejects(f.world.waitForArea([25, 5], 0), /disposed/);
    f.world.dispose();
    f.world.dispose();
    await rejected;
    assert.equal(f.requests[2]!.signal.aborted, true);
    assert.equal(f.world.stats().bytesResident, 0);
    assert.equal(f.world.stats().inFlight, 0);
    assert.equal(f.world.stats().queued, 0);
    assert.equal(f.world.isAreaReady([5, 5], 0), false);
    assert.deepEqual(f.events.slice(3), ["activate:0_0:0_0", "deactivate:0_0:0_0", "dispose:0_0:0_0", "dispose:1_0:1_0"]);
    await f.resolve(2, 8, "late-after-dispose");
    assert.equal(f.events.at(-1), "dispose:2_0:late-after-dispose");
    assert.equal(f.world.stats().bytesResident, 0);
    assert.throws(() => f.world.update([]), /disposed/);
    await assert.rejects(f.world.waitForArea([5, 5], 0), /disposed/);
  });

  await checkAsync("world streaming: aborted rejection is not a content failure", async () => {
    const f = fixture();
    f.world.update(at(5));
    f.world.update([]);
    f.requests[0]!.reject(new Error("aborted"));
    await flush();
    assert.equal(f.world.stats().failures, 0);
    assert.deepEqual(f.warnings, []);
    f.world.dispose();
  });

  check("world streaming: invalid configuration and area inputs reject", () => {
    for (const maxConcurrentFetches of [0, -1, 1.5, Infinity, NaN]) {
      assert.throws(() => fixture({ maxConcurrentFetches }), /positive integer/);
    }
    assert.throws(() => fixture({ memoryBudgetBytes: -1 }), /nonnegative/);
    assert.throws(() => fixture({ activationBudgetMs: NaN }), /nonnegative/);
    const f = fixture();
    assert.throws(() => f.world.update(at(5), -1), /nonnegative/);
    assert.throws(() => f.world.isAreaReady([NaN, 0], 1), /source/);
    assert.throws(() => f.world.waitForArea([0, 0], -1), /nonnegative/);
    f.world.dispose();
  });

  check("terrain streaming: codec round-trip in metres, min/max, weight blocks and transferable ownership", () => {
    for (const heightFormat of ["u16", "f32"] as const) {
      for (const layerCount of [0, 1, 5, 8]) {
        const def = terrainDefinition(layerCount);
        const tile = createFlatTerrainTile(def, 0, 0, 3);
        tile.heights[0] = -10;
        tile.heights[1] = 20;
        for (let i = 0; i < tile.weights.length; i += 1) tile.weights[i] = i % 256;
        const bytes = encodeTerrainTile(tile, { heightMin: -32, heightMax: 32, heightFormat });
        const decoded = decodeTerrainTileForStreaming(bytes.buffer as ArrayBuffer, def);
        const tolerance = heightFormat === "u16" ? 64 / 65535 : 0;
        assert.ok(Math.abs(decoded.minHeight + 10) <= tolerance);
        assert.ok(Math.abs(decoded.maxHeight - 20) <= tolerance);
        assert.equal(decoded.heights.length, tile.heights.length);
        for (let i = 0; i < tile.heights.length; i += 1) {
          assert.ok(Math.abs(decoded.heights[i]! - tile.heights[i]!) <= tolerance);
        }
        assert.equal(decoded.weights.length, Math.ceil(layerCount / 4));
        const blockLength = 33 * 33 * 4;
        decoded.weights.forEach((block, i) => assert.deepEqual(block, tile.weights.subarray(i * blockLength, (i + 1) * blockLength)));
        assert.equal(new Set(decoded.transfer).size, decoded.transfer.length);
        assert.equal(decoded.transfer.length, layerCount === 0 ? 1 : 2);
        assert.ok(!decoded.transfer.includes(bytes.buffer as ArrayBuffer));
        const moved = structuredClone(decoded, { transfer: decoded.transfer });
        assert.equal(decoded.heights.byteLength, 0);
        assert.equal(moved.heights.length, tile.heights.length);
        moved.weights.forEach((block) => assert.equal(block.byteLength, blockLength));
        assert.ok(bytes.byteLength > 0);
      }
    }
  });

  check("terrain streaming: rejects mismatched headers, summaries and corrupt samples", () => {
    const def = terrainDefinition();
    const tile = createFlatTerrainTile(def, 0, 0, 3);
    const bytes = encodeTerrainTile(tile, { heightMin: -32, heightMax: 32, heightFormat: "f32" });
    for (const altered of [
      { ...def, tileQuads: 64 }, { ...def, layers: [] }, { ...def, heightMin: -64 },
      { ...def, tiles: [] }, { ...def, tiles: [{ key: "0_0", minHeight: 10, maxHeight: 20 }] },
    ]) assert.throws(() => decodeTerrainTileForStreaming(bytes, altered));
    const wrongKey = bytes.slice();
    new DataView(wrongKey.buffer).setInt32(20, 1, true);
    assert.throws(() => decodeTerrainTileForStreaming(wrongKey, def), /no tile/);
    const nonfinite = bytes.slice();
    new DataView(nonfinite.buffer).setFloat32(32, NaN, true);
    assert.throws(() => decodeTerrainTileForStreaming(nonfinite, def), /non-finite/);
    const outsideBounds = bytes.slice();
    new DataView(outsideBounds.buffer).setFloat32(32, 30, true);
    assert.throws(() => decodeTerrainTileForStreaming(outsideBounds, def), /declared bounds/);
    assert.throws(() => decodeTerrainTileForStreaming(bytes.subarray(1), def));
  });

  await checkAsync("terrain streaming: worker init, decode transfer and structured request errors", async () => {
    const workerGlobal = globalThis as unknown as {
      addEventListener?: (type: "message", listener: (event: MessageEvent<TerrainWorkerRequest>) => void) => void;
      postMessage?: (message: TerrainWorkerResponse, transfer?: ArrayBuffer[]) => void;
    };
    const previousAdd = workerGlobal.addEventListener;
    const previousPost = workerGlobal.postMessage;
    const messages: { message: TerrainWorkerResponse; transfer: ArrayBuffer[] }[] = [];
    let receive: ((event: MessageEvent<TerrainWorkerRequest>) => void) | undefined;
    workerGlobal.addEventListener = (_type, listener) => { receive = listener; };
    workerGlobal.postMessage = (message, transfer = []) => { messages.push({ message, transfer }); };
    try {
      await import("../../engine/world/workers/terrainWorker");
      assert.ok(receive);
      const send = (data: TerrainWorkerRequest) => receive!({ data } as MessageEvent<TerrainWorkerRequest>);
      const def = terrainDefinition();
      const bytes = encodeTerrainTile(createFlatTerrainTile(def, 0, 0, 3), { heightMin: -32, heightMax: 32 }).buffer as ArrayBuffer;
      send({ key: "0_0", bytes });
      assert.equal(messages.at(-1)!.message.type, "error");
      send({ type: "init", def });
      assert.deepEqual(messages.at(-1)!.message, { type: "ready" });
      send({ key: "0_0", bytes });
      const decoded = messages.at(-1)!;
      assert.equal(decoded.message.type, "decoded");
      if (decoded.message.type !== "decoded") assert.fail("expected decoded payload");
      assert.equal(decoded.message.key, "0_0");
      assert.deepEqual(decoded.transfer, decoded.message.payload.transfer);
      const moved = structuredClone(decoded.message, { transfer: decoded.transfer });
      assert.equal(moved.payload.heights.length, 33 * 33);
      assert.equal(decoded.message.payload.heights.byteLength, 0);
      send({ key: "1_0", bytes });
      const mismatch = messages.at(-1)!.message;
      assert.equal(mismatch.type, "error");
      if (mismatch.type !== "error") assert.fail("expected structured error");
      assert.equal(mismatch.key, "1_0");
      assert.equal(mismatch.error.reason, "invalid-data");
      assert.match(mismatch.error.message, /does not match request/);
      send(null as unknown as TerrainWorkerRequest);
      assert.equal(messages.at(-1)!.message.type, "error");
      send({ type: "init", def: { ...def, schema: 2 } as unknown as WorldTerrainDef });
      assert.equal(messages.at(-1)!.message.type, "error");
      send({ key: "0_0", bytes });
      assert.equal(messages.at(-1)!.message.type, "error");
    } finally {
      if (previousAdd) workerGlobal.addEventListener = previousAdd;
      else delete workerGlobal.addEventListener;
      if (previousPost) workerGlobal.postMessage = previousPost;
      else delete workerGlobal.postMessage;
    }
  });
}
