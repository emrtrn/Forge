import assert from "node:assert/strict";
import { BufferAttribute, BufferGeometry, DataTexture, Scene } from "three";
import { CooperativeWork, type WorkSlice } from "../../engine/core/cooperativeWork";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { createLakeFoamMask, createLakeFoamMaskAsync } from "../../engine/render-three/waterFoam";
import { lakeRenderGeometrySteps } from "../../engine/render-three/lakeRenderGeometry";
import { LakeSurfaceQuery } from "../../engine/terrain/lakeInteraction";
import { LakeWaterController } from "../../src/scene/lakeWaterController";
import { FULL_LAKE_QUALITY } from "../../engine/perf/lakeQuality";

type Check = (label: string, run: () => Promise<void>) => Promise<void>;
export async function registerLakeSchedulingTests(check: Check): Promise<void> {
  await check("Lake scheduling: bounded batches start separate tasks and cancellation closes unfinished work", async () => {
    let clock = 0, tasks = 0, closed = false;
    const slices: WorkSlice[] = [], abort = new AbortController();
    const work = new CooperativeWork({ now: () => clock, yieldTask: async () => { tasks++; }, budgetMs: 2,
      signal: abort.signal, onSlice: s => slices.push(s) });
    function* steps() { for (let i = 0; i < 9; i++) { clock += .75; yield; } return 42; }
    assert.equal(await work.run("test", steps()), 42);
    assert.ok(tasks >= 4); assert.ok(slices.every(s => s.milliseconds <= 2.25));
    const cancel = new CooperativeWork({ now: () => clock, yieldTask: async () => {}, signal: abort.signal,
      onSlice: () => abort.abort(), budgetMs: 1 });
    function* unfinished() { try { for (;;) { clock++; yield; } } finally { closed = true; } }
    await assert.rejects(cancel.run("cancel", unfinished()), { name: "AbortError" }); assert.ok(closed);
  });
  await check("Lake scheduling: sliced shore masks, normals, bounds and exact interaction queries match synchronous output", async () => {
    for (const origin of [0, 1e6]) {
      const doc = createLakeFixture([-64 + origin, 10, -64 + origin]);
      const data = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
      let tasks = 0;
      const work = new CooperativeWork({ budgetMs: 0, yieldTask: async () => { tasks++; } });
      const expected = createLakeFoamMask(doc.lake, data, 1), actual = await createLakeFoamMaskAsync(doc.lake, data, 1, work);
      assert.deepEqual(actual.image.data, expected.image.data); assert.equal(actual.image.width, expected.image.width);
      const reference = new BufferGeometry(); reference.setAttribute("position", new BufferAttribute(data.positions, 3));
      reference.setIndex(new BufferAttribute(data.indices, 1)); reference.computeVertexNormals(); reference.computeBoundingBox(); reference.computeBoundingSphere();
      const prepared = await work.run("render-geometry", lakeRenderGeometrySteps(data));
      assert.deepEqual(prepared.getAttribute("normal").array, reference.getAttribute("normal").array);
      assert.deepEqual(prepared.boundingBox, reference.boundingBox); assert.deepEqual(prepared.boundingSphere, reference.boundingSphere);
      const query = await LakeSurfaceQuery.create(data, work), sync = new LakeSurfaceQuery(data);
      for (let z = -40; z <= 40; z += 5) for (let x = -40; x <= 40; x += 5)
        assert.equal(query.depthAt(origin + x, origin + z), sync.depthAt(origin + x, origin + z));
      assert.ok(tasks > 10, "all CPU-heavy algorithms actually have bounded checkpoints");
      prepared.dispose(); reference.dispose(); expected.dispose(); actual.dispose();
    }
  });
  await check("Lake scheduling: cancel during staged masks keeps the old mesh and disposes unpublished resources exactly once", async () => {
    const doc = createLakeFixture(); doc.lake.appearance = { foamEnabled: true, shoreWetnessEnabled: true };
    const scene = new Scene(); let armed = false, latest: Promise<void> | undefined;
    const disposed: string[] = [], dispose = DataTexture.prototype.dispose;
    DataTexture.prototype.dispose = function () { if (this.name === "LakeFoam.shoreDistance") disposed.push(this.uuid); dispose.call(this); };
    const controller = new LakeWaterController({ scene, editor: false, document: () => doc,
      load: async (_, key) => doc.tiles.get(key)!, normal: async () => null,
      onWorkSlice: slice => {
        if (!armed || slice.phase !== "wet-shore") return;
        armed = false; assert.equal(controller.objects.get(doc.lake.id), old); assert.equal(old.parent, scene);
        latest = controller.rebuild([{ ...doc.lake, surfaceLevel: 13 }]);
      } });
    let old: NonNullable<ReturnType<typeof controller.objects.get>>;
    try {
      await controller.rebuild([doc.lake]); old = controller.objects.get(doc.lake.id)!; armed = true;
      await controller.rebuild([doc.lake]); await latest;
      assert.equal(controller.objects.size, 1); assert.equal(controller.objects.get(doc.lake.id)!.position.y, 13);
      assert.notEqual(controller.objects.get(doc.lake.id), old); assert.equal(controller.qualityErrors.size, 0);
      assert.ok(disposed.length >= 3, "staging plus replaced published masks are released");
      assert.equal(new Set(disposed).size, disposed.length, "no double disposal at ownership transfer");
    } finally { controller.dispose(); DataTexture.prototype.dispose = dispose; }
  });
  await check("Lake scheduling: a quality change during staging cannot publish obsolete masks or rebuild the published geometry again", async () => {
    const doc = createLakeFixture(); doc.lake.appearance = { foamEnabled: true, shoreWetnessEnabled: true, causticsEnabled: true };
    let armed = true, qualityChange: Promise<void> | undefined;
    const controller = new LakeWaterController({ scene: new Scene(), editor: false, document: () => doc,
      load: async (_, key) => doc.tiles.get(key)!, normal: async () => null,
      onWorkSlice: s => {
        if (!armed || s.phase !== "shore-foam") return; armed = false;
        qualityChange = controller.setQuality({ ...FULL_LAKE_QUALITY, foamAllowed: false, shoreWetnessAllowed: false, causticsAllowed: false });
      } });
    try {
      await controller.rebuild([doc.lake]); await qualityChange;
      const object = controller.objects.get(doc.lake.id)!;
      assert.ok(object); assert.equal(object.material.uniforms.foamMask!.value, null); assert.equal(controller.qualityErrors.size, 0);
      const geometry = object.geometry; await controller.setQuality(FULL_LAKE_QUALITY);
      assert.equal(controller.objects.get(doc.lake.id)!.geometry, geometry); assert.ok(object.material.uniforms.foamMask!.value);
    } finally { controller.dispose(); }
  });
  await check("Lake scheduling: rejected mask budgets preserve the previous surface and show an explicit diagnostic", async () => {
    const doc = createLakeFixture(); doc.lake.appearance = { foamEnabled: true, foamWidth: 1 };
    const controller = new LakeWaterController({ scene: new Scene(), editor: false, document: () => doc,
      load: async (_, key) => doc.tiles.get(key)!, normal: async () => null });
    try {
      await controller.rebuild([doc.lake]); const old = controller.objects.get(doc.lake.id)!;
      await controller.rebuild([{ ...doc.lake, appearance: { foamEnabled: true, foamWidth: .2 } }]);
      assert.equal(controller.objects.get(doc.lake.id), old); assert.ok(old.parent);
      assert.equal(controller.results.get(doc.lake.id)!.status, "over-budget"); assert.ok(controller.qualityErrors.get(doc.lake.id)?.includes("over-budget"));
      await controller.setQuality({ ...FULL_LAKE_QUALITY, foamAllowed: false });
      assert.equal(controller.objects.get(doc.lake.id), old); assert.equal(old.material.uniforms.foamMask!.value, null,
        "a preserved older surface still obeys the new quality ceiling");
    } finally { controller.dispose(); }
  });
}
