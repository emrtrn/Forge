import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3, type BufferAttribute } from "three";
import { ActionMap } from "../../engine/input/actionMap";
import { CharacterMovementSubsystem } from "../../engine/movement/characterMovementSubsystem";
import { TerrainRenderer } from "../../engine/render-three/terrain/terrainRenderer";
import { CHARACTER_MOVEMENT_COMPONENT, TRANSFORM_COMPONENT } from "../../engine/scene/components";
import type { Entity } from "../../engine/scene/entity";
import { encodeTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { loadWorldTerrain, type WorldTerrainDocument } from "../../engine/terrain/terrainLoader";
import { buildTerrainGlobalAttributes, TerrainWorldHeightBounds, worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { TerrainRuntimeStreaming } from "../../engine/terrain/terrainRuntimeStreaming";
import { encodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
import { decodeTerrainTileForStreaming } from "../../engine/terrain/terrainTileStreaming";
import { TerrainWorkerPool } from "../../src/scene/capabilities/terrainWorkerPool";
import { startSceneRuntime } from "../../src/scene/SceneRuntimeCore";
import { createFlatTerrainTile, terrainGlobalMapPath, terrainTilePath, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

function fixture() {
  const def: WorldTerrainDef = {
    schema: 1, type: "worldTerrain", name: "stream", tileQuads: 64, spacing: 1, tilesX: 6, tilesZ: 6,
    origin: [10, 3, -20], heightMin: 0, heightMax: 20, layers: [{ id: "grass", name: "Grass", color: "#448833" }], tiles: [], collision: true,
  };
  const tiles = new Map<string, TerrainTileData>();
  for (let z = 0; z < 6; z += 1) for (let x = 0; x < 6; x += 1) {
    if (x === 3 && z === 3) continue;
    const tile = createFlatTerrainTile(def, x, z);
    tile.heights.fill(7);
    const key = `${x}_${z}`;
    tiles.set(key, tile);
    def.tiles.push({ key, minHeight: 7, maxHeight: 7 });
  }
  const globalAttributes = buildTerrainGlobalAttributes(worldTerrainRenderSource(def, tiles));
  return { def, tiles, globalAttributes };
}

export async function registerTerrainRuntimeStreamingTests(check: Check, checkAsync: CheckAsync): Promise<void> {
  check("terrain streaming declared unloaded tiles draw the immutable global map; holes stay holes and stationary cameras refresh", () => {
    const full = fixture();
    const tiles = new Map<string, TerrainTileData>();
    const source = worldTerrainRenderSource(full.def, tiles, full.globalAttributes);
    assert.equal(source.tile(0, 0), undefined);
    assert.ok(source.keys().includes("0_0"));
    assert.ok(!source.keys().includes("3_3"));
    const bounds = new TerrainWorldHeightBounds(source);
    assert.deepEqual(bounds.range(), { min: 7, max: 7 });
    const terrain = new TerrainRenderer(source, { origin: new Vector3(), viewMode: "lit", activeLayer: 0, layers: [] });
    const camera = new PerspectiveCamera();
    camera.position.set(32, 10, 32);
    camera.updateMatrixWorld(true);
    terrain.updateLod(camera);
    assert.ok(terrain.mesh.geometry.instanceCount > 0);
    assert.equal(terrain.residentTileCount, 0);
    const slots = () => {
      const a = terrain.mesh.geometry.getAttribute("terrainNodeA") as BufferAttribute;
      return Array.from({ length: terrain.mesh.geometry.instanceCount }, (_, i) => a.getW(i));
    };
    assert.ok(slots().every((slot) => slot === -1));
    const before = structuredClone(full.globalAttributes);
    tiles.set("0_0", full.tiles.get("0_0")!);
    terrain.refreshTile("0_0");
    terrain.updateLod(camera);
    assert.equal(terrain.residentTileCount, 1);
    assert.ok(slots().some((slot) => slot >= 0));
    tiles.delete("0_0");
    terrain.refreshTile("0_0");
    terrain.updateLod(camera);
    assert.equal(terrain.residentTileCount, 0);
    assert.ok(slots().every((slot) => slot === -1));
    assert.deepEqual(full.globalAttributes, before);
    assert.deepEqual(bounds.range(), { min: 7, max: 7 });
    terrain.dispose();
  });

  await checkAsync("terrain streaming loads only definition/global at boot and preserves the 1x1 eager path", async () => {
    const full = fixture();
    const calls: string[] = [];
    const path = "world.terrain.json";
    const global = encodeTerrainGlobalMap(full.def, full.globalAttributes);
    const doc = await loadWorldTerrain(path, full.def, async (p) => { calls.push(p); return global; }, true);
    assert.deepEqual(calls, [terrainGlobalMapPath(path)]);
    assert.equal(doc.tiles.size, 0);
    await assert.rejects(loadWorldTerrain(path, full.def, async () => { throw new Error("missing"); }, true), /streaming requires a valid global map/);
    const def = { ...full.def, tilesX: 1, tilesZ: 1, tiles: full.def.tiles.slice(0, 1) };
    const bytes = encodeTerrainTile(full.tiles.get("0_0")!, { heightMin: 0, heightMax: 20, heightFormat: "f32" });
    calls.length = 0;
    const single = await loadWorldTerrain(path, def, async (p) => { calls.push(p); return bytes; }, true);
    assert.deepEqual(calls, [terrainTilePath(path, "0_0")]);
    assert.equal(single.tiles.size, 1);
  });

  await checkAsync("terrain streaming boot heightfields reach physics before engine init without pinning arrays in persistent scene/module/behavior documents", async () => {
    const pawn: Entity = { id: "pawn", components: {} };
    const terrain: Entity = { id: "landscape:world:0_0", components: {} };
    const document = { schema: 1 as const, name: "boot", entities: [pawn] };
    const order: string[] = [];
    await startSceneRuntime({
      sceneDocument: document, additionalPhysicsEntities: [terrain],
      physics: { setEntities: (entities) => { assert.deepEqual(entities, [pawn, terrain]); order.push("physics"); } },
      behavior: { setEntities: (entities) => { assert.equal(entities, document.entities); assert.deepEqual(entities, [pawn]); } },
      moduleSinks: [{ setEntities: (entities) => assert.deepEqual(entities, [pawn]) }],
      engineApp: { init: async () => { order.push("init"); }, start: async () => { order.push("start"); } },
    });
    assert.deepEqual(order, ["physics", "init", "start"]);
    assert.deepEqual(document.entities, [pawn]);
  });

  await checkAsync("terrain streaming activation owns render data and heightfields, physics ring is smaller, release evicts data and holes never block", async () => {
    const full = fixture();
    const doc: WorldTerrainDocument = { ...full, tiles: new Map() };
    const added = new Map<string, Entity>();
    const removed: string[] = [];
    const changed: string[] = [];
    const stream = new TerrainRuntimeStreaming(doc, { id: "actor", name: "World", collision: true }, {
      fetch: async (key) => full.tiles.get(key)!, clock: () => 0, warn: (message) => assert.fail(message),
      changed: (key) => changed.push(key),
      addColliders: (entities) => { for (const entity of entities) { assert.ok(!added.has(entity.id)); added.set(entity.id, entity); } },
      removeColliders: (ids) => { for (const id of ids) { assert.ok(added.delete(id)); removed.push(id); } },
    }, 0);
    const tick = async (position: readonly [number, number]) => {
      for (let i = 0; i < 20; i += 1) { stream.update([{ position }]); await Promise.resolve(); }
    };
    assert.equal(stream.canOccupy([30, 0]), false);
    assert.equal(stream.canOccupy([10 + 3.5 * 64, -20 + 3.5 * 64]), true);
    const ready = stream.world.waitForArea([30, 0], 2);
    await tick([30, 0]);
    await ready;
    assert.equal(stream.canOccupy([30, 0]), true);
    assert.ok(doc.tiles.size > stream.colliders.size);
    assert.ok(stream.colliders.has("0_0"));
    const initialSize = added.size;
    stream.update([{ position: [30, 0] }]);
    assert.equal(added.size, initialSize, "no duplicate collider activation");
    assert.ok(doc.tiles.size < full.tiles.size);
    assert.equal(stream.canOccupy([360, 330]), false, "teleport holds until physics activation");
    await tick([360, 330]);
    assert.equal(stream.canOccupy([360, 330]), true);
    assert.ok(removed.includes("landscape:actor:0_0"));
    assert.ok(!doc.tiles.has("0_0"));
    assert.ok(stream.world.stats().evictions > 0);
    assert.ok(!stream.colliders.has("3_3"));
    assert.ok(changed.filter((key) => key === "0_0").length >= 2);
    stream.dispose();
    assert.equal(added.size, 0);
    assert.equal(doc.tiles.size, 0);
    assert.equal(stream.residentTiles.size, 0);
  });

  await checkAsync("terrain streaming debug grid reports every tile's state row-major for the ?debug map", async () => {
    const full = fixture();
    const doc: WorldTerrainDocument = { ...full, tiles: new Map() };
    const warnings: string[] = [];
    const stream = new TerrainRuntimeStreaming(doc, { id: "actor", name: "World", collision: true }, {
      fetch: (key) => key === "1_2" ? new Promise(() => {})
        : key === "2_0" ? Promise.reject(new Error("broken tile")) : Promise.resolve(full.tiles.get(key)!),
      clock: () => 0, warn: (message) => warnings.push(message), changed: () => {}, addColliders: () => {}, removeColliders: () => {},
    }, 1 << 30);
    const tick = async (position: readonly [number, number]) => {
      for (let i = 0; i < 20; i += 1) { stream.update([{ position }]); await Promise.resolve(); await Promise.resolve(); }
    };
    const at = (x: number, z: number) => stream.debugGrid().cells[z * 6 + x];
    assert.ok(stream.debugGrid().cells.every((state, index) => state === (index === 3 * 6 + 3 ? "undeclared" : "unloaded")));
    await tick([30, 0]);
    const grid = stream.debugGrid();
    assert.deepEqual([grid.tilesX, grid.tilesZ, grid.tileSize, ...grid.origin], [6, 6, 64, 10, -20]);
    assert.equal(at(0, 0), "physics");
    assert.equal(at(1, 1), "active", "inside the render range, outside the physics ring");
    assert.equal(at(1, 2), "fetching");
    assert.equal(at(2, 0), "failed");
    assert.equal(at(3, 3), "undeclared");
    assert.equal(at(5, 5), "unloaded");
    assert.equal(warnings.length, 1);
    await tick([360, 330]);
    assert.equal(at(0, 0), "loaded", "released, still cached under the LRU budget");
    assert.equal(at(1, 2), "unloaded", "an out-of-range fetch is cancelled");
    stream.dispose();
  });

  check("terrain streaming pawn hold prevents gravity on missing terrain and rejects a high speed step before publishing it", () => {
    let ready = false;
    let speed = 1000;
    const movement = new CharacterMovementSubsystem(new ActionMap({}), () => {}, undefined, {
      isPlayerControlled: () => false,
      getMoveIntent: () => ({ direction: [1, 0], speed }),
      canOccupy: (p) => ready && p[0] < 10,
    });
    const pawn = { id: "pawn", components: {
      [TRANSFORM_COMPONENT]: { position: [0, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      [CHARACTER_MOVEMENT_COMPONENT]: { movementMode: "falling" },
    } } as unknown as Entity;
    movement.setEntities([pawn]);
    const tick = () => movement.update({ deltaSeconds: 0.1, elapsedSeconds: 0.1, frame: 1 });
    tick();
    assert.deepEqual(movement.transformOf("pawn")!.position, [0, 5, 0]);
    ready = true;
    tick();
    assert.deepEqual(movement.transformOf("pawn")!.position, [0, 5, 0]);
    assert.deepEqual(movement.velocityOf("pawn"), [0, 0, 0]);
    speed = 1;
    tick();
    assert.ok(movement.transformOf("pawn")!.position[0] > 0, "movement resumes on active terrain");
    movement.dispose();
  });

  await checkAsync("terrain streaming worker lanes cancel queued and in-flight decodes without publishing stale same-key results; dispose rejects all jobs", async () => {
    const full = fixture();
    const bytes = encodeTerrainTile(full.tiles.get("0_0")!, { heightMin: 0, heightMax: 20, heightFormat: "f32" });
    const lanes: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      stopped = false;
      constructor() { lanes.push(this); }
      postMessage() {}
      terminate() { this.stopped = true; }
      complete() { this.onmessage?.({ data: { type: "decoded", key: "0_0", payload: decodeTerrainTileForStreaming(bytes, full.def) } }); }
    }
    const previous = globalThis.Worker;
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    try {
      const pool = new TerrainWorkerPool(full.def);
      const first = new AbortController();
      const abandoned = pool.decode("0_0", bytes.slice().buffer as ArrayBuffer, first.signal);
      const stale = assert.rejects(abandoned, /Aborted/);
      const second = pool.decode("0_0", bytes.slice().buffer as ArrayBuffer, new AbortController().signal);
      const queuedController = new AbortController();
      const queued = pool.decode("0_0", bytes.slice().buffer as ArrayBuffer, queuedController.signal);
      const queuedAborted = assert.rejects(queued, /Aborted/);
      first.abort();
      queuedController.abort();
      lanes[0]!.complete();
      lanes[1]!.complete();
      await stale;
      await queuedAborted;
      assert.equal((await second).heights[0], 7);
      const pending = pool.decode("0_0", bytes.slice().buffer as ArrayBuffer, new AbortController().signal);
      const disposed = assert.rejects(pending, /disposed/);
      pool.dispose();
      await disposed;
      assert.ok(lanes.every((lane) => lane.stopped));
    } finally {
      globalThis.Worker = previous;
    }
  });
}
