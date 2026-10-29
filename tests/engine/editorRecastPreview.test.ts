import assert from "node:assert/strict";
import { Scene, type Mesh } from "three";

import type { NavAgent } from "../../engine/navigation/navigationTypes";
import { loadRecastModules } from "../../engine/navigation/recastNavMesh";
import type { Entity } from "../../engine/scene/entity";
import type { Vec3 } from "../../engine/scene/layout";
import { EditorRecastPreview, previewSignature, type EditorRecastPreviewInput } from "../../src/scene/editorRecastPreview";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;

const AGENT: NavAgent = { radius: 0.35, height: 1.8, stepHeight: 0.45, maxStepDown: 0.5, maxSlopeAngleDeg: 50 };

function box(id: string, min: Vec3, max: Vec3): Entity {
  return {
    id,
    components: {
      Transform: { position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
      Collider: { shape: "box", size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], isStatic: true, isSensor: false },
    },
  } as unknown as Entity;
}

export async function registerEditorRecastPreviewTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("editor nav mesh preview: debounced builds from the live layout, unchanged input does not rebuild", async () => {
    const scene = new Scene();
    let changes = 0;
    const preview = new EditorRecastPreview({
      scene,
      delayMs: 0,
      loadModules: loadRecastModules,
      createWorker: () => null,
      onViewChanged: () => { changes += 1; },
    });
    let wallMinX = -8;
    let reads = 0;
    const input = (): EditorRecastPreviewInput => {
      reads += 1;
      return {
        entities: [box("ground", [-30, -1, -30], [30, 0, 30]), box("wall", [wallMinX, 0, -0.5], [12, 3, 0.5])],
        agent: AGENT,
        bounds: [],
        invokers: [[0, 0, 0]],
        buildRadius: 20,
      };
    };
    try {
      // A burst of requests (a drag) reads the layout once.
      for (let step = 0; step < 5; step += 1) preview.request(input);
      await preview.whenIdle();
      assert.equal(reads, 1, "debounced to one read");
      assert.equal(preview.builds, 1);
      const view = preview.object;
      assert.ok(view && view.parent === scene, "the preview is in the scene");
      const polygons = view.getObjectByName("ai-navmesh-polygons") as Mesh;
      assert.ok(polygons.geometry.index!.count > 0);
      assert.ok(changes > 0);

      preview.request(input);
      await preview.whenIdle();
      assert.equal(preview.builds, 1, "a selection change with the same level keeps the view");
      assert.equal(preview.object, view);

      wallMinX = -2;
      preview.request(input);
      await preview.whenIdle();
      assert.equal(preview.builds, 2, "an edited collider rebuilds");
      assert.notEqual(preview.object, view);
      assert.equal(view.parent, null, "the old view left the scene");

      preview.request(() => null);
      await preview.whenIdle();
      assert.equal(preview.object, null, "no input hides the preview");

      preview.request(input);
      await preview.whenIdle();
      assert.ok(preview.object);
      preview.clear();
      assert.equal(preview.object, null);
      assert.equal(scene.children.length, 0);
    } finally {
      preview.dispose();
    }
  });

  await checkAsync("editor nav mesh preview: terrain heights key the signature by digest, not sample by sample", async () => {
    const heights = new Float32Array(4097);
    const base: EditorRecastPreviewInput = {
      entities: [{ id: "t", components: { Collider: { heights } } } as unknown as Entity],
      agent: AGENT,
      bounds: [],
      invokers: [[0, 0, 0]],
      buildRadius: 48,
    };
    const before = previewSignature(base);
    assert.ok(before.length < 1000, `compact: ${before.length} chars`);
    heights[2048] = 0.5;
    assert.notEqual(previewSignature(base), before, "a sculpted sample changes it");
  });
}
