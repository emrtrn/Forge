/** Production editor save session, without a renderer, timers or disk writes. */
import assert from "node:assert/strict";
import { createFlatLandscapeData, type ForgeLandscapeData } from "../../engine/scene/landscape";
import { EditorSaveCoordinator, EditorSaveError, EditorSaveSession, SaveRevision, type EditorSaveSource } from "../../src/editor/editorSaveCoordinator";
import type { LayoutSaver } from "../../src/scene/SceneApp";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
type Sidecar = "landscape" | "foliage" | "meshPaint";

const LEVEL = "layouts/save-test.level.json";
const PATHS = [LEVEL, "landscapes/save-test.landscape.json", "layouts/save-test.foliage.json", "layouts/save-test.meshpaint.json"];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

interface SaveHost extends EditorSaveSource {
  saveLayout(): Promise<void>;
  saveLandscapeData(id: string): Promise<void>;
  markLandscapeDirty(id: string): void;
  layoutSaver: LayoutSaver;
  landscapeData: Map<string, ForgeLandscapeData>;
  landscapeSaveRevisions: Map<string, SaveRevision>;
  foliageSaveRevision: SaveRevision;
  meshPaintSaveRevision: SaveRevision;
}

function fixture() {
  const writes: { path: string; value: unknown }[] = [];
  const statuses: { message: string; tone: string }[] = [];
  const documents: EditorSaveSource = {
    scenePath: LEVEL,
    editor: { gridSize: 1, gridEnabled: true, snapRotationDeg: 15, snapRotationEnabled: true, snapScale: 0.1, snapScaleEnabled: true },
    layout: {
      schema: 1, name: "before", loadGroups: [], instances: [], characters: [],
      landscapes: [{ id: "terrain", name: "Terrain", position: [0, 0, 0], dataRef: PATHS[1]! }],
    },
    landscapeData: new Map([["terrain", createFlatLandscapeData("small")]]),
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
      writes.push({ path: LEVEL, value: payload.layout.name });
      return { path: LEVEL };
    },
  };
  const session = new EditorSaveSession(() => documents, (message, tone) => { statuses.push({ message, tone }); });
  const host = Object.assign(documents, {
    saveLayout: () => session.saveLayout(),
    saveLandscapeData: (id: string) => session.saveLandscapeData(id),
    markLandscapeDirty: (id: string) => session.markLandscapeDirty(id),
    landscapeSaveRevisions: session.landscapeSaveRevisions,
    foliageSaveRevision: session.foliageSaveRevision,
    meshPaintSaveRevision: session.meshPaintSaveRevision,
  }) as SaveHost;

  const revision = (kind: Sidecar) => kind === "landscape"
    ? host.landscapeSaveRevisions.get("terrain")!
    : kind === "foliage" ? host.foliageSaveRevision : host.meshPaintSaveRevision;
  const edit = (kind: Sidecar, value: number) => {
    if (kind === "landscape") {
      host.landscapeData.get("terrain")!.heights[0] = value;
      host.markLandscapeDirty("terrain");
    } else if (kind === "foliage") {
      host.foliageData.groups[0]!.instances[0]!.position[0] = value;
      host.foliageSaveRevision.markDirty();
    } else {
      host.meshPaintData.placements[0]!.colors[0] = value;
      host.meshPaintSaveRevision.markDirty();
    }
  };
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const value = body.landscape?.heights[0] ?? body.foliage?.groups[0].instances[0].position[0] ?? body.meshPaint?.placements[0].colors[0];
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

export async function registerEditorSaveCoordinatorTests(checkAsync: CheckAsync): Promise<void> {
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
      assert.deepEqual(f.writes.map((write) => write.value), ["before", 1, 1, 1]);
      await f.host.saveLayout();
      assert.deepEqual(f.writes.slice(4).map((write) => write.value), ["after", 2, 2, 2]);
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
      assert.equal(f.writes.length, 0, "later requests must wait for the blocked layout write");
      release.resolve();
      await Promise.all([manual, direct, autosave]);
      assert.equal(peak, 1);
      assert.deepEqual(f.writes.map((write) => write.value), ["before", 1, 2, "before"]);
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
        if (fail && failedIndex === 0) throw new Error("disk unavailable");
        return saver(payload);
      };
      await withFetch(async (input, init) => {
        if (fail && JSON.parse(String(init?.body)).path === PATHS[failedIndex]) {
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
        for (const [index, kind] of (["landscape", "foliage", "meshPaint"] as const).entries()) {
          assert.equal(f.revision(kind).dirty, index + 1 >= failedIndex);
        }
        fail = false;
        await f.host.saveLayout();
        for (const kind of ["landscape", "foliage", "meshPaint"] as const) assert.equal(f.revision(kind).dirty, false);
        assert.deepEqual(f.writes.filter((write) => write.path !== LEVEL).map((write) => write.path), PATHS.slice(1));
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

  await checkAsync("editor save: recreating the same landscape id cannot be cleaned by an old response", async () => {
    const f = fixture();
    f.edit("landscape", 1);
    const started = deferred();
    const release = deferred();
    await withFetch(async (input, init) => {
      const response = await f.fetch(input, init);
      started.resolve();
      await release.promise;
      return response;
    }, async () => {
      const pending = f.host.saveLandscapeData("terrain");
      await started.promise;
      f.host.landscapeSaveRevisions.delete("terrain");
      const replacement = createFlatLandscapeData("small");
      replacement.heights[0] = 2;
      f.host.landscapeData.set("terrain", replacement);
      f.host.markLandscapeDirty("terrain");
      release.resolve();
      await pending;
      assert.equal(f.revision("landscape").dirty, true);
      await f.host.saveLayout();
      assert.deepEqual(f.writes.filter((write) => write.path !== LEVEL).map((write) => write.value), [1, 2]);
    });
  });

  await checkAsync("editor save: snapshot preparation failure leaves the queue available for retry", async () => {
    const queue = new EditorSaveCoordinator();
    await assert.rejects(queue.save(() => { throw new Error("snapshot failed"); }), /snapshot failed/);
    let wrote = false;
    await queue.save(() => [{ path: LEVEL, write: async () => { wrote = true; } }]);
    assert.equal(wrote, true);
  });
}
