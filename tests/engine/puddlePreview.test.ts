import assert from "node:assert/strict";
import { Scene } from "three";
import { PuddlePreview } from "../../src/editor/puddlePreview";
import { createLakeFixture } from "./fixtures/lakeFixture";

export async function registerPuddlePreviewTests(check: (label: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check("puddle preview: native terrain, finite controls, overflow fallback and no authored mutation", async () => {
    const doc = createLakeFixture(), scene = new Scene();
    const before = JSON.stringify(doc.def), heights = [...doc.tiles.values()].map(tile => tile.heights.slice());
    let changes = 0;
    const preview = new PuddlePreview({ scene, document: () => doc,
      load: async () => { throw new Error("Resident terrain must not load"); }, changed: () => changes++ });
    try {
      await preview.begin("terrain", [30, 0], 10.2);
      assert.equal(preview.snapshot().status, "ready"); assert.equal(preview.snapshot().spacing, 1);
      assert.ok(preview.snapshot().area > 0); assert.equal(preview.group.visible, true);
      const geometry = preview.surface.geometry;
      await preview.edit({ level: 20 });
      assert.equal(preview.snapshot().status, "open-boundary"); assert.equal(preview.surface.geometry, geometry);
      await preview.edit({ size: 1000 });
      assert.equal(preview.snapshot().status, "error"); assert.equal(preview.surface.geometry, geometry);
      const snapshot = preview.snapshot();
      await preview.edit({ level: NaN }); assert.deepEqual(preview.snapshot(), snapshot);
      await preview.edit({ size: 12, level: 9 });
      assert.equal(preview.snapshot().status, "dry"); assert.equal(preview.surface.visible, false);
      assert.equal(JSON.stringify(doc.def), before);
      [...doc.tiles.values()].forEach((tile, i) => assert.deepEqual(tile.heights, heights[i]));
      preview.clear(); assert.equal(preview.snapshot().status, "idle"); assert.ok(changes > 0);
    } finally { preview.dispose(); }
    assert.equal(scene.children.length, 0);
  });
  await check("puddle preview: cancellation rejects delayed tile completions and owns no document tiles", async () => {
    const doc = createLakeFixture(), scene = new Scene(), tile = doc.tiles.get("1_0")!;
    doc.tiles.delete("1_0");
    let release = () => {}, entered = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const preview = new PuddlePreview({ scene, document: () => doc,
      load: async (_id, key) => { assert.equal(key, "1_0"); entered = true; await gate; return tile; }, changed: () => {} });
    const pending = preview.begin("terrain", [30, 0], 10.2);
    assert.equal(entered, true); assert.equal(preview.snapshot().status, "loading");
    preview.dispose(); release(); await pending;
    assert.equal(scene.children.length, 0); assert.equal(preview.snapshot().status, "idle");
    assert.equal(preview.surface.visible, false); assert.equal(doc.tiles.has("1_0"), false);
  });
  await check("puddle preview: read failures preserve the last valid surface and holes are never flat ground", async () => {
    const doc = createLakeFixture(), scene = new Scene();
    const preview = new PuddlePreview({ scene, document: () => doc,
      load: async () => { throw new Error("tile unavailable"); }, changed: () => {} });
    try {
      await preview.begin("terrain", [30, 0], 10.2);
      const geometry = preview.surface.geometry;
      doc.tiles.delete("1_0");
      await preview.rebuild(); assert.equal(preview.snapshot().status, "error");
      assert.equal(preview.surface.geometry, geometry);
      doc.def.tiles = doc.def.tiles.filter(tile => tile.key !== "1_0");
      await preview.rebuild(); assert.equal(preview.snapshot().status, "missing-terrain");
      assert.equal(preview.surface.geometry, geometry);
    } finally { preview.dispose(); }
  });
}
