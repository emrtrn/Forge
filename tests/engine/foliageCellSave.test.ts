/** Partitioned foliage saves (OPEN_WORLD_PLAN Faz 6 F2) through the production editor save session. */
import assert from "node:assert/strict";
import type { LayoutFoliageData, LayoutFoliageInstance } from "../../engine/scene/foliage";
import {
  foliageCellFootprints,
  foliageFootprintsFit,
  partitionFoliageData,
  type FoliageCellDocument,
} from "../../engine/world/foliageCells";
import { normalizeWorldPartitionSettings } from "../../engine/world/worldPartition";
import { EditorSaveSession, type EditorSaveSource } from "../../src/editor/editorSaveCoordinator";
import type { LayoutSaver } from "../../src/scene/SceneApp";

type Check = (label: string, fn: () => void) => void;
type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const LEVEL = "layouts/foliage-cells.level.json";
const SIDECAR = "layouts/foliage-cells.foliage.json";

function instance(x: number, z: number): LayoutFoliageInstance {
  return { position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

function foliage(): LayoutFoliageData {
  return {
    schema: 1, type: "foliage",
    groups: [{ id: "grass", foliageTypeId: "grass-type", target: { kind: "landscape", id: "ground" }, instances: [instance(10, 10), instance(70, 10), instance(-5, 130)] }],
    landscapeRules: [],
  };
}

interface Request { url: string; body: Record<string, unknown> }

function fixture(partition?: { enabled: boolean; grids?: Record<string, unknown> }) {
  const requests: Request[] = [];
  let failUrl: string | null = null;
  const source: EditorSaveSource = {
    scenePath: LEVEL,
    editor: { gridSize: 1, gridEnabled: true, snapRotationDeg: 15, snapRotationEnabled: true, snapScale: 0.1, snapScaleEnabled: true },
    layout: {
      schema: 1, name: "foliage cells", loadGroups: [], instances: [], characters: [],
      ...(partition ? { worldSettings: { partition: normalizeWorldPartitionSettings(partition) } } : {}),
    },
    layoutSaver: (async () => ({ path: LEVEL })) as LayoutSaver,
    worldTerrainIds: new Set(),
    foliageData: foliage(),
    meshPaintData: { schema: 1, type: "meshPaint", placements: [] },
  };
  const session = new EditorSaveSession(() => source, () => {});
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    if (url === failUrl) return new Response(JSON.stringify({ ok: false, error: "disk full" }), { status: 400 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const save = async (): Promise<Request[]> => {
    requests.length = 0;
    const original = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      await session.saveLayout();
    } finally {
      globalThis.fetch = original;
    }
    return [...requests];
  };
  return { source, session, save, failAt: (url: string | null) => { failUrl = url; } };
}

function setPartition(source: EditorSaveSource, value: { enabled: boolean; grids?: Record<string, unknown> }): void {
  (source.layout as { worldSettings?: unknown }).worldSettings = { partition: normalizeWorldPartitionSettings(value) };
}

const shape = (requests: Request[]) => requests.map(({ url, body }) => {
  if (url === "/__save-foliage") {
    const data = body.foliage as LayoutFoliageData;
    return data.foliageCells ? `index[${data.foliageCells.join(",")}]` : `sidecar(${data.groups[0]?.instances.length ?? 0})`;
  }
  if (body.keep) return `keep[${(body.keep as string[]).join(",")}]`;
  return `cells[${(body.cells as FoliageCellDocument[]).map((cell) => cell.key).join(",")}]`;
});

export function registerFoliageCellFootprintTests(check: Check): void {
  check("foliage cells: footprints say whether stored cells were written with a grid", () => {
    const { cells } = partitionFoliageData(foliage(), { cellSize: 64, loadRange: 256 });
    const footprints = foliageCellFootprints(cells);
    assert.deepEqual(footprints.map((footprint) => footprint.key), ["0_0", "1_0", "-1_2"]);
    assert.deepEqual(footprints[0], { key: "0_0", minX: 10, minZ: 10, maxX: 10, maxZ: 10 });
    assert.equal(foliageFootprintsFit(footprints, { cellSize: 64, loadRange: 256 }), true);
    assert.equal(foliageFootprintsFit(footprints, { cellSize: 128, loadRange: 256 }), false, "70 m lands in cell 0 of a 128 m grid");
    assert.equal(foliageFootprintsFit(footprints, { cellSize: 64, loadRange: 512 }), true, "the load range is not part of the file layout");
    const empty = foliageCellFootprints([{ schema: 1, type: "foliageCell", key: "5_5", groups: [{ id: "grass", instances: [] }] }]);
    assert.equal(foliageFootprintsFit(empty, { cellSize: 1, loadRange: 1 }), true, "an empty cell fits any grid");
  });
}

export async function registerFoliageCellSaveTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("foliage cell save: a partitioned level writes cells, then the index, then prunes; an unchanged save writes nothing", async () => {
    const f = fixture({ enabled: true });
    f.session.foliageLoaded(null);
    f.session.foliageSaveRevision.markDirty();
    const first = await f.save();
    assert.deepEqual(shape(first), ["cells[0_0,1_0,-1_2]", "index[0_0,1_0,-1_2]", "keep[0_0,1_0,-1_2]"]);
    const index = first[1]!.body.foliage as LayoutFoliageData;
    assert.equal(first[1]!.body.path, SIDECAR);
    assert.deepEqual(index.groups.map((group) => group.instances.length), [0], "the index holds no instances");
    assert.equal(first[0]!.body.level, LEVEL);
    assert.equal(first[0]!.body.keep, undefined, "the first cell write deletes nothing");
    assert.equal(f.session.foliageSaveRevision.dirty, false);
    assert.deepEqual(shape(await f.save()), [], "files on disk already match");
  });

  await checkAsync("foliage cell save: turning partition on or changing the foliage cell size re-partitions without a foliage edit", async () => {
    const f = fixture();
    f.session.foliageLoaded(null);
    assert.deepEqual(shape(await f.save()), [], "nothing dirty, single sidecar");
    setPartition(f.source, { enabled: true });
    assert.deepEqual(shape(await f.save()), ["cells[0_0,1_0,-1_2]", "index[0_0,1_0,-1_2]", "keep[0_0,1_0,-1_2]"]);
    setPartition(f.source, { enabled: true, grids: { foliage: { cellSize: 128 } } });
    assert.deepEqual(shape(await f.save()), ["cells[0_0,-1_1]", "index[0_0,-1_1]", "keep[0_0,-1_1]"]);
    setPartition(f.source, { enabled: true, grids: { foliage: { cellSize: 128, loadRange: 900 } } });
    assert.deepEqual(shape(await f.save()), [], "a load range change keeps the files");
  });

  await checkAsync("foliage cell save: loaded cells that match the grid are left alone; mismatched ones are rewritten", async () => {
    const grid = { cellSize: 64, loadRange: 256 };
    const stored = foliageCellFootprints(partitionFoliageData(foliage(), grid).cells);
    const matching = fixture({ enabled: true });
    matching.session.foliageLoaded(stored);
    assert.deepEqual(shape(await matching.save()), []);
    const mismatched = fixture({ enabled: true, grids: { foliage: { cellSize: 32 } } });
    mismatched.session.foliageLoaded(stored);
    assert.deepEqual(shape(await mismatched.save()), ["cells[0_0,2_0,-1_4]", "index[0_0,2_0,-1_4]", "keep[0_0,2_0,-1_4]"]);
  });

  await checkAsync("foliage cell save: turning partition off writes the merged sidecar before deleting every cell", async () => {
    const f = fixture({ enabled: true });
    f.session.foliageLoaded(null);
    await f.save();
    setPartition(f.source, { enabled: false });
    assert.deepEqual(shape(await f.save()), ["sidecar(3)", "keep[]"]);
    assert.deepEqual(shape(await f.save()), [], "the cells are gone");
  });

  await checkAsync("foliage cell save: a partitioned level without foliage writes no sidecar", async () => {
    const f = fixture({ enabled: true });
    f.source.foliageData.groups = [];
    f.session.foliageLoaded(null);
    assert.deepEqual(shape(await f.save()), []);
  });

  await checkAsync("foliage cell save: a failed index write keeps foliage dirty and the old files; retry finishes", async () => {
    const f = fixture({ enabled: true });
    f.session.foliageLoaded(null);
    f.session.foliageSaveRevision.markDirty();
    f.failAt("/__save-foliage");
    await assert.rejects(f.save(), /Foliage save failed \(\/__save-foliage\): HTTP 400 disk full/);
    assert.equal(f.session.foliageSaveRevision.dirty, true);
    f.failAt(null);
    assert.deepEqual(shape(await f.save()), ["cells[0_0,1_0,-1_2]", "index[0_0,1_0,-1_2]", "keep[0_0,1_0,-1_2]"]);
    assert.equal(f.session.foliageSaveRevision.dirty, false);
  });

  await checkAsync("foliage cell save: a failed prune after turning partition off is retried by the next save", async () => {
    const f = fixture({ enabled: true });
    f.session.foliageLoaded(null);
    await f.save();
    setPartition(f.source, { enabled: false });
    f.failAt("/__save-foliage-cells");
    await assert.rejects(f.save(), /HTTP 400/);
    f.failAt(null);
    assert.deepEqual(shape(await f.save()), ["sidecar(3)", "keep[]"]);
  });
}
