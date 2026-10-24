/** Play-side painted foliage cell streaming (OPEN_WORLD_PLAN Faz 6 F2b). */
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { FoliageRenderBinding } from "../../engine/render-three/foliage";
import { normalizeFoliageType, type LayoutFoliageData } from "../../engine/scene/foliage";
import { partitionFoliageData, type FoliageCellDocument } from "../../engine/world/foliageCells";
import { FoliageCellStreaming } from "../../src/scene/foliageCellStreaming";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const GRID = { cellSize: 64, loadRange: 100 };

function level(): LayoutFoliageData {
  const at = (x: number) => ({ position: [x, 0, 32] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] });
  return {
    schema: 1, type: "foliage", landscapeRules: [],
    groups: [{ id: "g", foliageTypeId: "t", target: { kind: "staticMesh", id: "x" }, instances: [at(10), at(20), at(330), at(-150)] }],
  };
}

function fixture(options: { failing?: string[] } = {}) {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1)));
  const gltf = { scene } as unknown as GLTF;
  const type = normalizeFoliageType({ name: "t", meshAssetId: "m" });
  const resolver = { getType: () => type, getModel: () => gltf };
  const { index, cells } = partitionFoliageData(level(), GRID);
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  const fetched: string[] = [];
  const binding = new FoliageRenderBinding();
  binding.rebuild(index, resolver);
  const streaming = new FoliageCellStreaming({
    index, grid: GRID, binding, resolver,
    fetchCell: async (key): Promise<FoliageCellDocument> => {
      fetched.push(key);
      await Promise.resolve();
      if (options.failing?.includes(key)) throw new Error(`[foliage] cell ${key}: HTTP 404`);
      return byKey.get(key)!;
    },
  });
  const instanceCount = () => binding.allMeshes().reduce((sum, mesh) => sum + mesh.count, 0);
  return { index, binding, streaming, fetched, instanceCount };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function registerFoliageCellStreamingTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("foliage cell streaming: prepare reads and builds only the cells in range", async () => {
    const f = fixture();
    assert.deepEqual(f.index.foliageCells, ["-3_0", "0_0", "5_0"]);
    await f.streaming.prepare([32, 32]);
    assert.deepEqual(f.fetched, ["0_0"], "the prefetch ring (150 m) reaches only cell 0_0");
    assert.equal(f.instanceCount(), 2);
    assert.deepEqual(f.streaming.snapshot(), { activeCells: 1, totalCells: 3, fetchedCells: 1, instances: 2 });
    f.streaming.dispose();
    assert.equal(f.instanceCount(), 0, "dispose removes the streamed batches");
  });

  await checkAsync("foliage cell streaming: moving the camera loads ahead and unloads behind", async () => {
    const f = fixture();
    await f.streaming.prepare([32, 32]);
    f.streaming.update([352, 32]);
    assert.equal(f.instanceCount(), 0, "0_0 unloads past the hysteresis ring; 5_0 is still being read");
    await settle();
    f.streaming.update([352, 32]);
    assert.equal(f.instanceCount(), 1, "5_0 activates once read");
    assert.deepEqual(f.fetched, ["0_0", "5_0"]);
    // Back home: 0_0 left the prefetch ring and was dropped, so it is read again.
    f.streaming.update([32, 32]);
    await settle();
    f.streaming.update([32, 32]);
    assert.deepEqual(f.fetched, ["0_0", "5_0", "0_0"]);
    assert.equal(f.instanceCount(), 2);
    f.streaming.dispose();
  });

  await checkAsync("foliage cell streaming: a cell that fails to load is empty and never blocks the ring", async () => {
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => { warnings.push(String(message)); };
    try {
      const f = fixture({ failing: ["0_0"] });
      await f.streaming.prepare([32, 32]);
      assert.equal(f.instanceCount(), 0);
      assert.deepEqual(f.streaming.snapshot().activeCells, 1);
      assert.deepEqual(warnings, ["[foliage] cell 0_0: HTTP 404"]);
      f.streaming.dispose();
    } finally {
      console.warn = warn;
    }
  });

  await checkAsync("foliage cell streaming: a level rebuild keeps streamed cells, a cell rebuild replaces only its own", async () => {
    const f = fixture();
    await f.streaming.prepare([32, 32]);
    f.binding.rebuild(f.index, { getType: () => null, getModel: () => null });
    assert.equal(f.instanceCount(), 2, "rebuild() does not remove streamed cell batches");
    f.binding.removeCell("0_0");
    assert.equal(f.instanceCount(), 0);
    f.streaming.dispose();
  });
}
