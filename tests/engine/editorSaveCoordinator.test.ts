import { decodeTerrainGlobalMap, validateTerrainGlobalMap } from "../../engine/terrain/terrainGlobalMapFile";
import { decodeTerrainTile } from "../../engine/terrain/terrainTileCodec";
/** Production editor save session, without a renderer, timers or disk writes. */
import assert from "node:assert/strict";
import { EditorSaveCoordinator, EditorSaveError, EditorSaveSession, SaveRevision, type EditorSaveSource } from "../../src/editor/editorSaveCoordinator";
import type { LayoutSaver } from "../../src/scene/SceneApp";
import { levelTerrainPath, terrainTilePath } from "../../engine/terrain/terrainTypes";
import { validateTerrainPath } from "../../tools/terrainSaveValidator";
import { applyTerrainBrush, createTerrainEditWorld } from "../../engine/terrain/terrainEdit";
import { createFlatTerrainTile, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { WorldTerrainEditSession } from "../../src/editor/terrainStore";
import { WORLD_TERRAIN_CREATE_DEFAULTS, createFlatWorldTerrain } from "../../engine/terrain/worldTerrainCreate";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
type Sidecar = "landscape" | "foliage" | "meshPaint";

const LEVEL = "layouts/save-test.level.json";
/** Save order: a World Terrain is written before the level that names it, sidecars after. */
const PATHS = ["layouts/save-test.landscapes/terrain.terrain.json", LEVEL, "layouts/save-test.foliage.json", "layouts/save-test.meshpaint.json"];
const KIND_PATH = { landscape: 0, foliage: 2, meshPaint: 3 } as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

interface SaveHost extends EditorSaveSource {
  saveLayout(): Promise<void>;
  saveLandscapeData(id: string): Promise<void>;
  layoutSaver: LayoutSaver;
  foliageSaveRevision: SaveRevision;
  meshPaintSaveRevision: SaveRevision;
}

function fixture(scenePath = LEVEL) {
  const writes: { path: string; value: unknown }[] = [];
  const statuses: { message: string; tone: string }[] = [];
  // A level-owned one-tile World Terrain, saved with Float32 heights so written values read back exactly.
  const created = createFlatWorldTerrain({ ...WORLD_TERRAIN_CREATE_DEFAULTS, tilesX: 1, tilesZ: 1, tileQuads: 64 });
  const terrain = new WorldTerrainEditSession(levelTerrainPath(scenePath, "terrain"),
    createTerrainEditWorld(created.def, created.tiles.values()), new Map([["0_0", "f32"]]));
  const documents: EditorSaveSource = {
    scenePath,
    editor: { gridSize: 1, gridEnabled: true, snapRotationDeg: 15, snapRotationEnabled: true, snapScale: 0.1, snapScaleEnabled: true },
    layout: {
      schema: 1, name: "before", loadGroups: [], instances: [], characters: [],
      landscapes: [{ id: "terrain", name: "Terrain", position: [0, 0, 0], dataRef: levelTerrainPath(scenePath, "terrain") }],
    },
    worldTerrainIds: new Set(["terrain"]),
    worldTerrainSessions: new Map([["terrain", terrain]]),
    foliageData: {
      schema: 1, type: "foliage",
      groups: [{
        id: "trees", foliageTypeId: "tree", target: { kind: "landscape", id: "terrain" },
        instances: [{ position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
      }],
    },
    meshPaintData: {
      schema: 1, type: "meshPaint",
      placements: [{ target: { assetId: "mesh", placementIndex: 0, meshName: "mesh", primitiveIndex: 0 }, vertexCount: 1, colors: [1, 0, 0, 1] }],
    },
    layoutSaver: async (payload: Parameters<LayoutSaver>[0]) => {
      writes.push({ path: scenePath, value: payload.layout.name });
      return { path: scenePath };
    },
  };
  const session = new EditorSaveSession(() => documents, (message, tone) => { statuses.push({ message, tone }); });
  const host = Object.assign(documents, {
    saveLayout: () => session.saveLayout(),
    saveLandscapeData: (id: string) => session.saveLandscapeData(id),
    foliageSaveRevision: session.foliageSaveRevision,
    meshPaintSaveRevision: session.meshPaintSaveRevision,
  }) as SaveHost;

  const revision = (kind: Sidecar): { readonly dirty: boolean } => kind === "landscape"
    ? terrain
    : kind === "foliage" ? host.foliageSaveRevision : host.meshPaintSaveRevision;
  const edit = (kind: Sidecar, value: number) => {
    if (kind === "landscape") {
      terrain.world.tiles.get("0_0")!.heights[0] = value;
      terrain.markTiles(["0_0"]);
    } else if (kind === "foliage") {
      host.foliageData.groups[0]!.instances[0]!.position[0] = value;
      host.foliageSaveRevision.markDirty();
    } else {
      host.meshPaintData.placements[0]!.colors[0] = value;
      host.meshPaintSaveRevision.markDirty();
    }
  };
  let terrainValue = 0;
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    if (String(_input).startsWith("/__save-terrain-tile")) {
      terrainValue = decodeTerrainTile(new Uint8Array(init!.body as ArrayBuffer)).heights[0]!;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (String(_input).startsWith("/__save-terrain-global")) {
      decodeTerrainGlobalMap(new Uint8Array(init!.body as ArrayBuffer));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body));
    const value = (body.terrain ? terrainValue : undefined) ?? body.foliage?.groups[0].instances[0].position[0] ?? body.meshPaint?.placements[0].colors[0];
    writes.push({ path: body.path, value });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { host, writes, statuses, revision, edit, fetch };
}

async function withFetch(fetch: typeof globalThis.fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  try { await run(); } finally { globalThis.fetch = original; }
}

function worldTerrainFixture() {
  const f = fixture();
  const created = createFlatWorldTerrain({ ...WORLD_TERRAIN_CREATE_DEFAULTS, tileQuads: 64, tilesX: 2, tilesZ: 1 });
  const path = "worlds/material.terrain.json";
  const world = createTerrainEditWorld(created.def, created.tiles.values());
  const session = new WorldTerrainEditSession(path, world, new Map());
  f.host.layout.landscapes = [{ id: "world", name: "World", position: [0, 0, 0], dataRef: path }];
  Object.assign(f.host, { worldTerrainIds: new Set(["world"]), worldTerrainSessions: new Map([["world", session]]) });
  return { ...f, path, world, session };
}

export async function registerEditorSaveCoordinatorTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("editor save: edit bursts and manual Save share one pending snapshot behind an active write", async () => {
    const f = fixture();
    const started = deferred(), release = deferred();
    const saver = f.host.layoutSaver;
    let calls = 0;
    f.host.layoutSaver = async (payload) => {
      calls++;
      if (calls === 1) { started.resolve(); await release.promise; }
      const result = await saver(payload);
      return calls === 2 ? { ...result, warnings: ["shared warning"] } : result;
    };
    f.edit("landscape", 1);
    await withFetch(f.fetch, async () => {
      const active = f.host.saveLayout();
      await started.promise;
      const pending: Promise<void>[] = [];
      for (let edit = 2; edit <= 50; edit++) {
        f.host.layout.name = `edit-${edit}`;
        f.edit("landscape", edit);
        pending.push(f.host.saveLayout());
      }
      const manual = f.host.saveLayout();
      assert.equal(calls, 1, "no pending request may overlap the active snapshot");
      release.resolve();
      await Promise.all([active, manual, ...pending]);
    });
    assert.equal(calls, 2, "49 edits plus manual Save need only one additional layout write");
    assert.deepEqual(f.writes.filter((write) => write.path === LEVEL).map((write) => write.value), ["before", "edit-50"]);
    assert.deepEqual(f.writes.filter((write) => write.path !== LEVEL).map((write) => write.value), [1, 50]);
    assert.equal(f.revision("landscape").dirty, false);
    assert.equal(f.statuses.length, 2, "shared callers do not replace warnings with empty success results");
    assert.match(f.statuses.at(-1)!.message, /shared warning/);
  });

  await checkAsync("editor save: a coalesced failure rejects every waiter and leaves retries available", async () => {
    const f = fixture();
    const saver = f.host.layoutSaver;
    let calls = 0;
    f.host.layoutSaver = async (payload) => {
      calls++;
      if (calls === 1) throw new Error("disk unavailable");
      return saver(payload);
    };
    await withFetch(f.fetch, async () => {
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => f.host.saveLayout()));
      assert.equal(calls, 1);
      assert.ok(results.every((result) => result.status === "rejected" && /disk unavailable/.test(String(result.reason))));
      f.host.layout.name = "retry";
      await f.host.saveLayout();
    });
    assert.equal(calls, 2);
    assert.deepEqual(f.writes.map((write) => write.value), ["retry"]);
  });

  await checkAsync("editor save: replacing the level does not coalesce its request into an older queued turn", async () => {
    const f = fixture();
    const started = deferred(), release = deferred();
    const saver = f.host.layoutSaver;
    let calls = 0;
    f.host.layoutSaver = async (payload) => {
      calls++;
      if (calls === 1) { started.resolve(); await release.promise; }
      return saver(payload);
    };
    await withFetch(f.fetch, async () => {
      const active = f.host.saveLayout();
      await started.promise;
      const oldLevelTurn = f.host.saveLayout();
      Object.assign(f.host, { layout: { ...structuredClone(f.host.layout), name: "replacement" } });
      const newLevelTurn = f.host.saveLayout();
      release.resolve();
      await Promise.all([active, oldLevelTurn, newLevelTurn]);
    });
    assert.equal(calls, 3, "the replacement gets its own queued save and acknowledgement");
    assert.equal(f.writes.at(-1)!.value, "replacement");
  });

  await checkAsync("terrain ownership: full level paths and escaped actor IDs cannot alias definitions or tiles", async () => {
    const paths = [
      levelTerrainPath("levels/A/Terrain.level.json", "landscape-1"),
      levelTerrainPath("levels/B/Terrain.level.json", "landscape-1"),
      levelTerrainPath("levels/A/Terrain.level.json", "a/b"),
      levelTerrainPath("levels/A/Terrain.level.json", "a~2f~b"),
      levelTerrainPath("levels/A/Terrain.level.json", "../terrain:*"),
    ];
    assert.equal(new Set(paths).size, paths.length);
    assert.equal(new Set(paths.map((path) => terrainTilePath(path, "0_0"))).size, paths.length);
    for (const path of paths) assert.equal(validateTerrainPath(path), path);
    assert.equal(levelTerrainPath("/levels/A/Terrain.level.json", "landscape-1"), paths[0]);
  });

  for (const kind of ["landscape", "foliage", "meshPaint"] as const) {
    await checkAsync(`editor save: delayed ${kind} response preserves newer edits and next save writes them`, async () => {
      const f = fixture();
      f.edit(kind, 1);
      const started = deferred();
      const release = deferred();
      let delay = true;
      await withFetch(async (input, init) => {
        const response = await f.fetch(input, init);
        if (delay) {
          delay = false;
          started.resolve();
          await release.promise;
        }
        return response;
      }, async () => {
        const first = f.host.saveLayout();
        await started.promise;
        f.edit(kind, 2);
        release.resolve();
        await first;
        assert.equal(f.revision(kind).dirty, true);
        assert.match(f.statuses.at(-1)!.message, /newer sidecar edits/);
        assert.equal(f.statuses.at(-1)!.tone, "warning");
        await f.host.saveLayout();
        assert.equal(f.revision(kind).dirty, false);
        assert.deepEqual(f.writes.filter((write) => write.path !== LEVEL).map((write) => write.value), [1, 2]);
        assert.equal(f.statuses.at(-1)!.tone, "success");
      });
    });
  }

  await checkAsync("editor save: layout and all sidecars share the snapshot taken before the first await", async () => {
    const f = fixture();
    const started = deferred();
    const release = deferred();
    const saver = f.host.layoutSaver;
    for (const kind of ["landscape", "foliage", "meshPaint"] as const) f.edit(kind, 1);
    f.host.layoutSaver = async (payload) => {
      started.resolve();
      await release.promise;
      return saver(payload);
    };
    await withFetch(f.fetch, async () => {
      const first = f.host.saveLayout();
      await started.promise;
      f.host.layout.name = "after";
      for (const kind of ["landscape", "foliage", "meshPaint"] as const) f.edit(kind, 2);
      release.resolve();
      await first;
      assert.deepEqual(f.writes.map((write) => write.value), [1, "before", 1, 1]);
      await f.host.saveLayout();
      assert.deepEqual(f.writes.slice(4).map((write) => write.value), [2, "after", 2, 2]);
    });
  });

  await checkAsync("editor save: manual, autosave and direct landscape requests never overlap or overwrite with stale data", async () => {
    const f = fixture();
    f.edit("landscape", 1);
    const started = deferred();
    const release = deferred();
    let active = 0;
    let peak = 0;
    const saver = f.host.layoutSaver;
    f.host.layoutSaver = async (payload) => {
      active += 1;
      peak = Math.max(peak, active);
      started.resolve();
      await release.promise;
      const result = await saver(payload);
      active -= 1;
      return result;
    };
    await withFetch(async (input, init) => {
      active += 1;
      peak = Math.max(peak, active);
      const response = await f.fetch(input, init);
      active -= 1;
      return response;
    }, async () => {
      const manual = f.host.saveLayout();
      await started.promise;
      f.edit("landscape", 2);
      const direct = f.host.saveLandscapeData("terrain");
      const autosave = f.host.saveLayout();
      await Promise.resolve();
      assert.equal(f.writes.length, 1, "only the blocked snapshot's terrain is written; later requests wait");
      release.resolve();
      await Promise.all([manual, direct, autosave]);
      assert.equal(peak, 1);
      assert.deepEqual(f.writes.map((write) => write.value), [1, "before", 2, "before"]);
      assert.equal(f.revision("landscape").dirty, false);
    });
  });

  for (const failedIndex of [0, 1, 2, 3]) {
    await checkAsync(`editor save: failure at ${PATHS[failedIndex]} reports completed/pending files and retry recovers`, async () => {
      const f = fixture();
      for (const kind of ["landscape", "foliage", "meshPaint"] as const) f.edit(kind, 1);
      let fail = true;
      const saver = f.host.layoutSaver;
      f.host.layoutSaver = async (payload) => {
        if (fail && PATHS[failedIndex] === LEVEL) throw new Error("disk unavailable");
        return saver(payload);
      };
      await withFetch(async (input, init) => {
        if (fail && typeof init?.body === "string" && JSON.parse(init.body).path === PATHS[failedIndex]) {
          return new Response("failed", { status: 500 });
        }
        return f.fetch(input, init);
      }, async () => {
        await assert.rejects(f.host.saveLayout(), (error: unknown) => {
          assert.ok(error instanceof EditorSaveError);
          assert.deepEqual(error.savedPaths, PATHS.slice(0, failedIndex));
          assert.deepEqual(error.pendingPaths, PATHS.slice(failedIndex));
          assert.match(error.message, /Retry Save/);
          return true;
        });
        assert.equal(f.statuses.length, 0, "a partial batch must not report success");
        for (const kind of ["landscape", "foliage", "meshPaint"] as const) {
          assert.equal(f.revision(kind).dirty, KIND_PATH[kind] >= failedIndex);
        }
        fail = false;
        await f.host.saveLayout();
        for (const kind of ["landscape", "foliage", "meshPaint"] as const) assert.equal(f.revision(kind).dirty, false);
        assert.deepEqual(f.writes.filter((write) => write.path !== LEVEL).map((write) => write.path), PATHS.filter((path) => path !== LEVEL));
        assert.equal(f.statuses.at(-1)!.tone, "success");
      });
    });
  }

  await checkAsync("editor save: replacing a document invalidates its in-flight acknowledgement", async () => {
    const state = new SaveRevision();
    const release = deferred();
    state.markDirty();
    const pending = state.capture("paint.json", () => release.promise).write();
    state.reset();
    state.markDirty();
    release.resolve();
    await pending;
    assert.equal(state.dirty, true);
    await state.capture("paint.json", async () => {}).write();
    assert.equal(state.dirty, false);
  });

  await checkAsync("editor save: snapshot preparation failure leaves the queue available for retry", async () => {
    const queue = new EditorSaveCoordinator();
    await assert.rejects(queue.save(() => { throw new Error("snapshot failed"); }), /snapshot failed/);
    let wrote = false;
    await queue.save(() => [{ path: LEVEL, write: async () => { wrote = true; } }]);
    assert.equal(wrote, true);
  });

  await checkAsync("editor save: a multi-tile World Terrain reference is kept as authored, with no terrain write", async () => {
    const f = fixture();
    const shared = "worlds/big.terrain.json";
    f.host.layout.landscapes!.push({ id: "world", name: "World", position: [96, 0, 48], dataRef: shared });
    (f.host as { worldTerrainIds: ReadonlySet<string> }).worldTerrainIds = new Set(["world"]);
    let saved: Parameters<LayoutSaver>[0] | null = null;
    f.host.layoutSaver = async (payload) => { saved = structuredClone(payload); return { path: LEVEL }; };
    const requests: string[] = [];
    await withFetch(async (input, init) => { requests.push(String(input)); return f.fetch(input, init); }, async () => {
      // Without the guard this threw "Cannot migrate missing landscape data: world".
      await f.host.saveLayout();
      await f.host.saveLandscapeData("world");
    });
    assert.equal(saved!.layout.landscapes!.find((entry) => entry.id === "world")!.dataRef, shared);
    assert.equal(f.host.layout.landscapes!.find((entry) => entry.id === "world")!.dataRef, shared);
    assert.ok(!requests.some((url) => url.includes("terrain")), requests.join(", "));
    assert.equal(f.statuses.at(-1)?.tone, "success");
  });

  await checkAsync("editor save: an edited World Terrain writes its dirty tiles, global map and definition in place", async () => {
    const f = fixture();
    const shared = "worlds/big.terrain.json";
    const def: WorldTerrainDef = {
      schema: 1, type: "worldTerrain", name: "Big", tileQuads: 32, spacing: 1, tilesX: 2, tilesZ: 1, origin: [0, 0, 0],
      heightMin: -8, heightMax: 8, layers: [{ id: "grass", name: "Grass", color: "#4a7a3a" }],
      tiles: [{ key: "0_0", minHeight: 0, maxHeight: 0 }, { key: "1_0", minHeight: 0, maxHeight: 0 }], collision: true,
    };
    const world = createTerrainEditWorld(def, [createFlatTerrainTile(def, 0, 0), createFlatTerrainTile(def, 1, 0)]);
    const session = new WorldTerrainEditSession(shared, world, new Map([["1_0", "u16"]]));
    f.host.layout.landscapes!.push({ id: "world", name: "World", position: [32, 0, 16], dataRef: shared });
    Object.assign(f.host, { worldTerrainIds: new Set(["world"]), worldTerrainSessions: new Map([["world", session]]) });
    // Inside tile 1_0 only, clear of the x = 32 seam.
    const { dirty } = applyTerrainBrush(world, { x: 48, z: 16, radius: 3, strength: 2, falloff: 1, mode: "raise" });
    assert.deepEqual([...dirty.keys()], ["1_0"]);
    session.markTiles(dirty.keys());
    const requests: { url: string; body: unknown }[] = [];
    let editWhileWriting = true;
    await withFetch(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/__save-terrain")) {
        requests.push({ url, body: url.includes("-tile") ? decodeTerrainTile(new Uint8Array(init!.body as ArrayBuffer)) : url.includes("-global") ? validateTerrainGlobalMap(world.def, new Uint8Array(init!.body as ArrayBuffer)) : JSON.parse(String(init!.body)) });
        if (url.includes("-tile") && editWhileWriting) session.markTiles(["1_0"]);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return f.fetch(input, init);
    }, async () => {
      await f.host.saveLayout();
      // The tile was edited again while it was being written: still dirty.
      assert.equal(session.dirty, true);
      assert.equal(f.statuses.at(-1)?.tone, "warning");
      editWhileWriting = false;
      await f.host.saveLandscapeData("world");
    });
    assert.equal(session.dirty, false);
    assert.equal(requests.length, 6);
    const [tileRequest, globalRequest, defRequest] = requests as [{ url: string; body: ReturnType<typeof decodeTerrainTile> }, { url: string; body: ReturnType<typeof validateTerrainGlobalMap> }, { url: string; body: { path: string; terrain: WorldTerrainDef } }];
    assert.equal(tileRequest.url, `/__save-terrain-tile?path=${encodeURIComponent(shared)}&key=1_0`);
    assert.equal(tileRequest.body.heightFormat, "u16");
    assert.ok(Math.abs(Math.max(...tileRequest.body.heights) - 2) < 16 / 65535, "the raised peak survives u16 encoding");
    assert.equal(globalRequest.url, `/__save-terrain-global?path=${encodeURIComponent(shared)}`);
    assert.equal(Math.max(...globalRequest.body.map.heights), 2);
    assert.equal(defRequest.url, "/__save-terrain");
    assert.equal(defRequest.body.path, shared);
    assert.equal(defRequest.body.terrain.tiles.find((tile) => tile.key === "1_0")!.maxHeight, 2);
    assert.equal(defRequest.body.terrain.tiles.find((tile) => tile.key === "0_0")!.maxHeight, 0);
    assert.equal(f.host.layout.landscapes!.find((entry) => entry.id === "world")!.dataRef, shared);
  });

  await checkAsync("editor save: World Terrain material assignment and clearing refresh the global map before definition and level", async () => {
    const f = worldTerrainFixture();
    const requests: { url: string; body: { path: string; terrain: WorldTerrainDef } | null }[] = [];
    const order: string[] = [];
    f.host.layoutSaver = async () => { order.push("level"); return { path: LEVEL }; };
    await withFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("-global")) validateTerrainGlobalMap(f.world.def, new Uint8Array(init!.body as ArrayBuffer));
      requests.push({ url, body: url.includes("-global") ? null : JSON.parse(String(init!.body)) });
      order.push(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, async () => {
      assert.equal(f.session.capture(), null);
      for (const material of ["rock-material", null]) {
        requests.length = 0;
        order.length = 0;
        f.world.def.layers[0]!.material = material;
        f.session.markDefinitionDirty();
        assert.equal(f.session.dirty, true);
        assert.deepEqual(f.session.dirtyKeys(), []);
        await f.host.saveLayout();
        assert.deepEqual(requests.map((request) => request.url), [`/__save-terrain-global?path=${encodeURIComponent(f.path)}`, "/__save-terrain"]);
        assert.equal(requests[1]!.body!.path, f.path);
        assert.equal(requests[1]!.body!.terrain.layers[0]!.material, material);
        assert.deepEqual(order, [`/__save-terrain-global?path=${encodeURIComponent(f.path)}`, "/__save-terrain", "level"]);
        assert.equal(f.session.dirty, false);
        assert.equal(f.session.capture(), null);
        assert.equal(f.statuses.at(-1)?.tone, "success");
      }
    });
  });

  await checkAsync("editor save: a World Terrain definition edit during a write stays dirty until the next save", async () => {
    const f = worldTerrainFixture();
    f.world.def.layers[0]!.material = "rock-material";
    f.session.markDefinitionDirty();
    const started = deferred();
    const release = deferred();
    const requests: { url: string; body: { terrain: WorldTerrainDef } | null }[] = [];
    await withFetch(async (input, init) => {
      const url = String(input);
      if (url.includes("-global")) validateTerrainGlobalMap(f.world.def, new Uint8Array(init!.body as ArrayBuffer));
      requests.push({ url, body: url.includes("-global") ? null : JSON.parse(String(init!.body)) });
      if (requests.length === 1) {
        started.resolve();
        await release.promise;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, async () => {
      const pending = f.host.saveLayout();
      await started.promise;
      f.world.def.layers[0]!.material = "sand-material";
      f.session.markDefinitionDirty();
      release.resolve();
      await pending;
      assert.equal(f.session.dirty, true);
      assert.equal(f.world.def.layers[0]!.material, "sand-material");
      assert.equal(f.statuses.at(-1)?.tone, "warning");
      await f.host.saveLandscapeData("world");
    });
    assert.deepEqual(requests.map((request) => request.url), [`/__save-terrain-global?path=${encodeURIComponent(f.path)}`, "/__save-terrain", `/__save-terrain-global?path=${encodeURIComponent(f.path)}`, "/__save-terrain"]);
    assert.deepEqual(requests.filter((request) => request.url === "/__save-terrain").map((request) => request.body!.terrain.layers[0]!.material), ["rock-material", "sand-material"]);
    assert.equal(f.session.dirty, false);
    assert.equal(f.session.capture(), null);
  });

  await checkAsync("editor save: a failed World Terrain definition write stays dirty and can be retried", async () => {
    const f = worldTerrainFixture();
    f.world.def.layers[0]!.material = "rock-material";
    f.session.markDefinitionDirty();
    const requests: string[] = [];
    await withFetch(async (input) => {
      requests.push(String(input));
      return requests.length === 2
        ? new Response("disk full", { status: 500 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, async () => {
      await assert.rejects(f.host.saveLayout(), /disk full/);
      assert.equal(f.session.dirty, true);
      assert.equal(f.writes.length, 0, "a failed definition must not write the level");
      await f.host.saveLayout();
    });
    assert.deepEqual(requests, [`/__save-terrain-global?path=${encodeURIComponent(f.path)}`, "/__save-terrain", `/__save-terrain-global?path=${encodeURIComponent(f.path)}`, "/__save-terrain"]);
    assert.equal(f.session.dirty, false);
    assert.equal(f.writes[0]!.path, LEVEL);
  });

  await checkAsync("editor save: a new World Terrain's tiles and definition are written before the level that references it", async () => {
    const f = fixture();
    const created = createFlatWorldTerrain({ ...WORLD_TERRAIN_CREATE_DEFAULTS, tileQuads: 64, tilesX: 2, tilesZ: 1 });
    const path = levelTerrainPath(LEVEL, "world");
    const world = createTerrainEditWorld(created.def, created.tiles.values());
    const session = new WorldTerrainEditSession(path, world, new Map([...created.tiles.keys()].map((key) => [key, "u16" as const])));
    session.markTiles(world.tiles.keys());
    f.host.layout.landscapes = [{ id: "world", name: "World", position: [0, 0, 0], dataRef: path }];
    Object.assign(f.host, { worldTerrainIds: new Set(["world"]), worldTerrainSessions: new Map([["world", session]]) });
    const order: string[] = [];
    f.host.layoutSaver = async () => { order.push("level"); return { path: LEVEL }; };
    await withFetch(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/__save-terrain")) {
        order.push(url.includes("-tile") ? `tile ${new URL(url, "http://x").searchParams.get("key")}` : url.includes("-global") ? "global" : "definition");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return f.fetch(input, init);
    }, () => f.host.saveLayout());
    assert.deepEqual(order, ["tile 0_0", "tile 1_0", "global", "definition", "level"]);
    assert.equal(session.dirty, false);
  });
}
