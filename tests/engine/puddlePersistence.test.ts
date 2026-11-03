import assert from "node:assert/strict";
import { Color, PerspectiveCamera, Scene, type WebGLRenderer, type WebGLRenderTarget } from "three";
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
import { PuddlePlanarReflections } from "../../engine/render-three/puddlePlanarReflections";
import { TerrainPuddleSurface } from "../../engine/render-three/terrain/terrainPuddleSurface";
import { WaterReflectionRegistry } from "../../engine/render-three/waterReflectionRegistry";
import { NEW_PUDDLE_APPEARANCE, PUDDLE_APPEARANCE } from "../../engine/scene/puddleWater";

const body = (): PuddleWaterBody => ({ schema: 1, kind: "puddle", coordinateSpace: "world", id: "puddle-1", name: "Courtyard",
  terrainRef: "terrain", seed: [30, 0], bounds: { min: [24, -6], max: [36, 6] }, surfaceLevel: 10.2,
  hidden: false, locked: false, appearance: { color: "#504a35", opacity: .8, roughness: .2, reflectionStrength: 1,
    reflectionMode: "sharedPlanar", reflectionQuality: "high", planarReflectionStrength: .7 } });

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
      { hidden: "false" }, { appearance: { color: "red" } }, { terrainRef: "" },
      { appearance: { reflectionMode: "planar" } }, { appearance: { reflectionQuality: "ultra" } },
      { appearance: { planarReflectionStrength: NaN } }, { appearance: { planarReflectionStrength: 1.1 } }]) assert.throws(() => validatePuddleWater({ ...body(), ...patch }));
    assert.throws(() => validatePuddleWaters([body(), body()]));
    assert.throws(() => validatePuddleWaters(Array.from({ length: 17 }, (_, i) => ({ ...body(), id: String(i) }))));
    assert.equal("mesh" in validatePuddleWater({ ...body(), mesh: [1, 2] }), false);
    const legacy = validatePuddleWater({ ...body(), appearance: { reflectionStrength: 1.7 } });
    assert.equal({ ...PUDDLE_APPEARANCE, ...legacy.appearance }.reflectionMode, "environment");
    assert.equal(legacy.appearance!.reflectionStrength, 1.7);
  });
  await check("puddle persistence: preview converts to the same geometry in editor and runtime without terrain writes", async () => {
    const doc = createLakeFixture(), initial = [...doc.tiles.values()].map(tile => tile.heights.slice());
    const scene = new Scene(), host = { scene, document: () => doc, load: async () => { throw new Error("unexpected load"); }, changed: () => {} };
    const preview = new PuddlePreview(host), editor = new PuddleWaterController(host), runtime = new PuddleWaterController({ ...host, scene: new Scene() });
    try {
      await preview.begin("terrain", [30, 0], 10.2);
      const source = preview.toBody("saved", "Saved puddle")!;
      assert.ok(source); await editor.rebuild([source]); await runtime.rebuild([JSON.parse(JSON.stringify(source))]);
      assert.equal(source.appearance!.reflectionMode, "sharedPlanar");
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
  await check("puddle planar: visible coplanar consumers borrow Lake sources, two extra planes, quality and removal release leases", async () => {
    const registry = new WaterReflectionRegistry(), lake = registry.acquire("water", 0, "medium");
    const pool = new PuddlePlanarReflections(registry), scene = new Scene(), camera = new PerspectiveCamera(60, 1, .1, 200);
    camera.position.set(0, 15, 20); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const surfaces = [0, 0, 1, 2, 3].map(level => {
      const surface = new TerrainPuddleSurface(); surface.userData.waterSceneTransmission = true;
      surface.rebuild({ status: "ready", area: 100, depths: new Float32Array(6).fill(.5), positions: new Float32Array([
        -5, level, -5, -5, level, 5, 5, level, 5, -5, level, -5, 5, level, 5, 5, level, -5]) });
      scene.add(surface); pool.set(surface, level, NEW_PUDDLE_APPEARANCE); return surface;
    });
    scene.updateMatrixWorld(true);
    let target: WebGLRenderTarget | null = null, alpha = 1, captures = 0;
    const renderer = { xr: { enabled: false }, shadowMap: { autoUpdate: true }, toneMapping: 0, autoClear: true,
      getRenderTarget: () => target, setRenderTarget: (value: WebGLRenderTarget | null) => { target = value; },
      getClearColor: (out: Color) => out.set(0), getClearAlpha: () => alpha, setClearColor: (_value: unknown, a: number) => { alpha = a; },
      state: { buffers: { depth: { setMask() {} } } }, render: () => { captures++; assert.ok(surfaces.every(surface => !surface.visible)); },
    } as unknown as WebGLRenderer;
    try {
      pool.update(renderer, scene, camera);
      assert.equal(surfaces[0]!.reflectionSource, lake); assert.equal(surfaces[1]!.reflectionSource, lake);
      assert.equal(registry.size, 3); assert.equal(captures, 3);
      assert.equal(surfaces[4]!.reflectionSource, null, "the third independent Puddle plane falls back");
      assert.ok(surfaces[2]!.reflectionSource?.hasCapture);
      const geometry = surfaces[0]!.geometry;
      pool.setQuality("off"); assert.ok(surfaces.every(surface => !surface.reflectionSource));
      assert.equal(registry.size, 1, "the Lake lease survives Puddle quality changes");
      pool.setQuality("medium"); pool.update(renderer, scene, camera);
      pool.remove(surfaces[2]!); surfaces[2]!.visible = false; pool.update(renderer, scene, camera);
      assert.ok(surfaces[4]!.reflectionSource, "a released slot serves another visible plane");
      assert.equal(surfaces[0]!.geometry, geometry, "quality never rebuilds the bed");
      for (const surface of surfaces.slice(1)) { pool.remove(surface); surface.visible = false; }
      pool.set(surfaces[0]!, 0, { ...NEW_PUDDLE_APPEARANCE, reflectionQuality: "high" });
      pool.setQuality("high"); pool.update(renderer, scene, camera);
      assert.equal((surfaces[0]!.reflectionSource!.binding.texture.image as { width: number }).width, 512);
      pool.setQuality("medium"); pool.update(renderer, scene, camera);
      assert.equal(surfaces[0]!.reflectionSource, lake, "a graphics ceiling borrows the existing Medium plane without editing authored High");
      pool.dispose(); assert.equal(registry.size, 1);
      registry.release(lake); assert.equal(registry.size, 0);
    } finally { pool.dispose(); for (const surface of surfaces) surface.dispose(); }
  });
  await check("puddle planar: out-of-view and hidden parents allocate nothing; draft edits survive creation", async () => {
    const doc = createLakeFixture(), scene = new Scene(), registry = new WaterReflectionRegistry(), reflections = new PuddlePlanarReflections(registry);
    const preview = new PuddlePreview({ scene, reflections, document: () => doc, load: async () => { throw new Error("unexpected load"); }, changed: () => {} });
    try {
      await preview.begin("terrain", [30, 0], 10.2);
      preview.editAppearance({ reflectionQuality: "high", planarReflectionStrength: .35 });
      const source = preview.toBody("saved", "Saved")!;
      assert.equal(source.appearance!.reflectionQuality, "high"); assert.equal(source.appearance!.planarReflectionStrength, .35);
      const camera = new PerspectiveCamera(60, 1, .1, 100); camera.position.set(0, 30, 30); camera.lookAt(-100, 30, 30); camera.updateMatrixWorld(true);
      scene.updateMatrixWorld(true); reflections.update({} as WebGLRenderer, scene, camera);
      assert.equal(registry.size, 0);
      preview.group.visible = false; reflections.setQuality("medium");
      camera.lookAt(30, 10, 0); camera.updateMatrixWorld(true); reflections.update({} as WebGLRenderer, scene, camera);
      assert.equal(registry.size, 0);
    } finally { preview.dispose(); reflections.dispose(); }
    assert.equal(registry.size, 0);
  });
}
