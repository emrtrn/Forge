import assert from "node:assert/strict";
import { Scene } from "three";
import { validatePuddleWater, validatePuddleWaters, type PuddleWaterBody } from "../../engine/scene/puddleWater";
import { readRoomLayout } from "../../engine/scene/layoutValidation";
import type { RoomLayout } from "../../engine/scene/layout";
import { validateLayout } from "../../tools/saveValidator";
import { collectDroppedFields } from "../../tools/droppedFields";
import { PuddlePreview } from "../../src/editor/puddlePreview";
import { PuddleWaterController } from "../../src/scene/puddleWaterController";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { cloneSelection, parseSelectionId, selectionId, selectionsEqual } from "../../editor/core/selection";
import { moveWorldTerrain } from "../../engine/terrain/worldTerrainMove";
import { partitionLayout, DEFAULT_WORLD_PARTITION } from "../../engine/world/worldPartition";

const body = (): PuddleWaterBody => ({ schema: 1, kind: "puddle", coordinateSpace: "world", id: "puddle-1", name: "Courtyard",
  terrainRef: "terrain", seed: [30, 0], bounds: { min: [24, -6], max: [36, 6] }, surfaceLevel: 10.2,
  hidden: false, locked: false, appearance: { color: "#504a35", opacity: .8, roughness: .2, reflectionStrength: 1 } });

export async function registerPuddlePersistenceTests(check: (label: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check("puddle persistence: exact save/read/partition round trip, strict fields and bounded collection", async () => {
    const layout: RoomLayout = { schema: 1, name: "Puddle", loadGroups: [], instances: [], characters: [], puddleWaters: [body()] };
    const saved = validateLayout(layout) as RoomLayout;
    assert.deepEqual(saved.puddleWaters, layout.puddleWaters);
    assert.deepEqual(collectDroppedFields(layout, saved).paths, []);
    assert.deepEqual(readRoomLayout(JSON.parse(JSON.stringify(saved)), "fixture").puddleWaters, layout.puddleWaters);
    assert.deepEqual(partitionLayout(layout, DEFAULT_WORLD_PARTITION).persistent.puddleWaters, layout.puddleWaters);
    for (const patch of [{ schema: 2 }, { kind: "lake" }, { coordinateSpace: "local" }, { surfaceLevel: NaN },
      { seed: [24, 0] }, { bounds: { min: [24, -6], max: [36, 7] } }, { appearance: { opacity: 2 } },
      { hidden: "false" }, { appearance: { color: "red" } }, { terrainRef: "" }]) assert.throws(() => validatePuddleWater({ ...body(), ...patch }));
    assert.throws(() => validatePuddleWaters([body(), body()]));
    assert.throws(() => validatePuddleWaters(Array.from({ length: 17 }, (_, i) => ({ ...body(), id: String(i) }))));
    assert.equal("mesh" in validatePuddleWater({ ...body(), mesh: [1, 2] }), false);
  });
  await check("puddle persistence: preview converts to the same geometry in editor and runtime without terrain writes", async () => {
    const doc = createLakeFixture(), initial = [...doc.tiles.values()].map(tile => tile.heights.slice());
    const scene = new Scene(), host = { scene, document: () => doc, load: async () => { throw new Error("unexpected load"); }, changed: () => {} };
    const preview = new PuddlePreview(host), editor = new PuddleWaterController(host), runtime = new PuddleWaterController({ ...host, scene: new Scene() });
    try {
      await preview.begin("terrain", [30, 0], 10.2);
      const source = preview.toBody("saved", "Saved puddle")!;
      assert.ok(source); await editor.rebuild([source]); await runtime.rebuild([JSON.parse(JSON.stringify(source))]);
      assert.deepEqual(editor.objects.get("saved")!.geometry.getAttribute("position").array, preview.surface.geometry.getAttribute("position").array);
      assert.deepEqual(runtime.objects.get("saved")!.geometry.getAttribute("position").array, preview.surface.geometry.getAttribute("position").array);
      const geometry = editor.objects.get("saved")!.geometry;
      await editor.rebuild([{ ...source, surfaceLevel: 20 }]); assert.equal(editor.results.get("saved")!.status, "open-boundary");
      assert.equal(editor.objects.get("saved")!.geometry, geometry);
      await editor.rebuild([source]); assert.equal(editor.results.get("saved")!.status, "ready", "undo to the cached source must clear a failed result");
      await editor.rebuild([{ ...source, hidden: true }]); assert.equal(editor.objects.size, 0);
      await editor.rebuild([source]); assert.equal(editor.objects.size, 1);
      await editor.rebuild([]); assert.equal(editor.objects.size, 0);
      [...doc.tiles.values()].forEach((tile, i) => assert.deepEqual(tile.heights, initial[i]));
    } finally { preview.dispose(); editor.dispose(); runtime.dispose(); }
    assert.equal(scene.children.length, 0);
  });
  await check("puddle persistence: removal cancels late loads, native grid and aggregate budgets cannot silently degrade", async () => {
    const doc = createLakeFixture(), scene = new Scene(), tile = doc.tiles.get("1_0")!; doc.tiles.delete("1_0");
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let available = true;
    const controller = new PuddleWaterController({ scene, document: () => available ? doc : undefined, load: async () => { await gate; return tile; } });
    const pending = controller.rebuild([body()]);
    await controller.rebuild([]); release(); await pending;
    assert.equal(controller.objects.size, 0); assert.equal(scene.children.length, 0);
    doc.tiles.set("1_0", tile);
    await controller.rebuild([{ ...body(), bounds: { min: [24.1, -6], max: [36.1, 6] } }]);
    assert.equal(controller.results.get("puddle-1")!.status, "error");
    await controller.rebuild(Array.from({ length: 5 }, (_, i) => ({ ...body(), id: String(i), bounds: { min: [-64, -64], max: [64, 64] } })));
    assert.equal(controller.objects.size, 0); assert.ok([...controller.results.values()].every(result => result.status === "error"));
    await controller.rebuild([body()]); assert.equal(controller.objects.size, 1);
    available = false; await controller.rebuild([body()]);
    assert.equal(controller.objects.size, 0, "removing the terrain owner removes its visible water");
    controller.dispose();
  });
  await check("puddle persistence: selection identity and terrain moves preserve the authored source", async () => {
    const selection = { kind: "puddle" as const, index: 2 };
    assert.deepEqual(parseSelectionId(selectionId(selection)), selection);
    assert.ok(selectionsEqual(selection, cloneSelection(selection)));
    const doc = createLakeFixture(), source = body();
    const moved = moveWorldTerrain(doc.def, "terrain", [], [3, 2, -4], [], [source]);
    assert.deepEqual(moved.puddles![0]!.seed, [33, -4]); assert.equal(moved.puddles![0]!.surfaceLevel, 12.2);
    assert.deepEqual(source.seed, [30, 0]);
    const restored = moveWorldTerrain({ ...doc.def, origin: moved.origin }, "terrain", [], [-3, -2, 4], [], moved.puddles!);
    assert.deepEqual(restored.puddles, [source]);
  });
}
