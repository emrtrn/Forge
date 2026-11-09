import assert from "node:assert/strict";
import { oceanPlanarSettings, validateOceanWater, validateOceanWaters, type OceanWaterBody } from "../../engine/scene/oceanWater";
import { buildOceanCoverage, prepareOceanCoverage, sampleOceanCoverage } from "../../engine/terrain/oceanCoverage";
import { CooperativeWork } from "../../engine/core/cooperativeWork";
import { createOceanGrid } from "../../engine/render-three/ocean/oceanGrid";
import { readRoomLayout } from "../../engine/scene/layoutValidation";
import { validateLayout } from "../../tools/saveValidator";
import { collectDroppedFields } from "../../tools/droppedFields";
import { partitionLayout, DEFAULT_WORLD_PARTITION } from "../../engine/world/worldPartition";
import type { RoomLayout } from "../../engine/scene/layout";
import { prepareOceanTerrain } from "../../engine/terrain/oceanPreparation";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { OceanWaterController } from "../../src/scene/oceanWaterController";
import { AmbientLight, DirectionalLight, HemisphereLight, Object3D, PerspectiveCamera, Scene, Texture, WebGLCubeRenderTarget, type WebGLRenderer } from "three";
import { OceanSurface } from "../../engine/render-three/ocean/oceanSurface";
import type { OceanFft } from "../../engine/render-three/ocean/oceanFft";
import { createOceanOpticsUniforms, updateOceanOptics } from "../../engine/render-three/ocean/oceanOptics";
import { renderSceneWithLakeOverride } from "../../engine/render-three/lakeWater";
import { SceneApp } from "../../src/scene/SceneApp";
import { cloneSelection, parseSelectionId, selectionId, selectionsEqual, type Selection } from "../../editor/core/selection";
import { moveWorldTerrain } from "../../engine/terrain/worldTerrainMove";
import { OceanReflectionLease } from "../../engine/render-three/ocean/oceanReflection";
import { WaterReflectionRegistry } from "../../engine/render-three/waterReflectionRegistry";
import type { PlanarReflectionSource } from "../../engine/render-three/planarReflectionSource";

const body = (): OceanWaterBody => ({ schema: 1, kind: "ocean", coordinateSpace: "world", id: "sea",
  name: "Reference", hidden: false, locked: false, terrainRef: "terrain", bounds: { min: [-8, -8], max: [8, 8] },
  openEdges: ["west", "east", "north", "south"], surfaceLevel: 7, offshoreDepth: 40,
  waves: { windSpeed: 9, windDirection: 20, fetchKm: 120, swellStrength: .7, swellDirection: 345, choppiness: .85, seed: 42 },
  appearance: { shallowColor: "#28b5ac", deepColor: "#073448", absorptionDistance: 9, roughness: .16, foamStrength: .75,
    reflectionMode: "sharedPlanar", reflectionGroup: "water", reflectionQuality: "medium", reflectionStrength: .8 } });

export async function registerOceanWaterTests(check: (label: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check("ocean: planar leases share coplanar Lake/River sources, obey quality and release only their own references", async () => {
    const registry = new WaterReflectionRegistry(), sea = body(), other = registry.acquire("water", sea.surfaceLevel, "medium");
    let bound: PlanarReflectionSource | null = null, fail = false, disposed = 0;
    const dispose = other.dispose.bind(other); other.dispose = () => { disposed++; dispose(); };
    const lease = new OceanReflectionLease({ setReflectionSource: source => {
      bound = source; if (fail && source !== other) throw new Error("binding failed");
    } }, registry);
    try {
      lease.update(sea, "high"); assert.equal(lease.source, other); assert.equal(bound, other); assert.equal(registry.size, 1);
      lease.update({ ...sea, name: "renamed" }, "high"); assert.equal(registry.size, 1);
      const high: OceanWaterBody = { ...sea, appearance: { ...sea.appearance, reflectionQuality: "high" } };
      lease.update(high, "high"); assert.notEqual(lease.source, other); assert.equal(registry.size, 2); assert.equal(disposed, 0);
      lease.update(high, "medium"); assert.equal(lease.source, other); assert.equal(registry.size, 1);
      fail = true;
      assert.throws(() => lease.update({ ...sea, surfaceLevel: 8 }, "high"), /binding failed/);
      fail = false; assert.equal(lease.source, other); assert.equal(bound, other);
      assert.equal(registry.size, 1, "failed replacement releases its new lease");
      lease.update(sea, "off"); assert.equal(lease.source, null); assert.equal(bound, null); assert.equal(registry.size, 1);
      lease.update(sea, "high"); lease.update({ ...sea, hidden: true }, "high"); assert.equal(lease.source, null);
      lease.update(sea, "high");
      lease.dispose(); lease.dispose(); assert.equal(registry.size, 1); assert.equal(disposed, 0, "the other water owner still holds the target");
      registry.release(other); assert.equal(registry.size, 0); assert.equal(disposed, 1);
      assert.equal(oceanPlanarSettings({ ...sea, appearance: { reflectionMode: "environment" } }, "high"), null);
      assert.equal(oceanPlanarSettings({ ...sea, appearance: { reflectionMode: "off" } }, "high"), null);
      assert.equal(oceanPlanarSettings({ ...sea, appearance: { reflectionMode: "sharedPlanar", reflectionStrength: 0 } }, "high"), null);
    } finally { fail = false; lease.dispose(); }
  });
  await check("ocean: optical edits, visibility and quality reuse the live simulation; geometric edits rebuild it", async () => {
    const document = createLakeFixture(), scene = new Scene(), sea: OceanWaterBody = { ...body(), bounds: { min: [-64,-64], max: [64,64] }, surfaceLevel: 17 };
    let made = 0, freed = 0; const applied: { body: OceanWaterBody; quality: string }[] = [];
    const controller = new OceanWaterController({ scene, renderer: {} as WebGLRenderer, document: () => document,
      load: async () => { throw new Error("unexpected read"); }, create: () => {
        made++; return { object: new Object3D(), update() {}, dispose: () => { freed++; },
          applyAppearance: (body, quality) => applied.push({ body, quality }) };
      } });
    try {
      await controller.rebuild([sea]); const original = controller.object;
      const edited: OceanWaterBody = { ...sea, appearance: { ...sea.appearance, reflectionMode: "off", roughness: .5 } };
      await controller.rebuild([edited]); assert.equal(made, 1); assert.equal(controller.object, original);
      assert.equal(applied.at(-1)!.body.appearance!.reflectionMode, "off");
      controller.setReflectionQuality("off"); assert.equal(applied.at(-1)!.quality, "off"); assert.equal(made, 1);
      await controller.rebuild([{ ...edited, hidden: true, locked: true, name: "Renamed" }]);
      assert.equal(original!.visible, false); assert.equal(made, 1);
      await controller.rebuild([{ ...sea, surfaceLevel: 18 }]); assert.equal(made, 2); assert.equal(freed, 1);
      await controller.rebuild([sea], true); assert.equal(made, 3); assert.equal(freed, 2);
    } finally { controller.dispose(); }
    assert.equal(freed, made);
  });
  await check("ocean: optics borrows live environment/probes and follows daylight, darkness and hidden ambient", async () => {
    const scene = new Scene(), camera = new PerspectiveCamera(), u = createOceanOpticsUniforms();
    const renderer = { getRenderTarget: () => null } as unknown as WebGLRenderer;
    const target = new WebGLCubeRenderTarget(16);
    (target.texture as Texture & { isPMREMTexture: boolean }).isPMREMTexture = true;
    target.texture.mipmaps = [{}, {}]; scene.environment = target.texture;
    const ambient = new AmbientLight(0xffffff, .3), hemisphere = new HemisphereLight(0xffffff, 0x000000, .2);
    const hidden = new AmbientLight(0xffffff, 5); hidden.visible = false;
    const sun = new DirectionalLight(0xffffff, 2); sun.position.set(4, 6, 1);
    scene.add(ambient, hemisphere, hidden, sun); scene.updateMatrixWorld(true);
    let probesRead = 0;
    const probe = { target, position: [0, 0, 0] as [number, number, number], radius: 100, priority: 0, intensity: .5, resolution: 16, parallax: false, near: .1, far: 100 };
    assert.equal(updateOceanOptics(u, renderer, scene, camera, () => { probesRead++; return [probe]; }), false);
    assert.equal(probesRead, 1); assert.equal(u.waterEnvironment.value, target.texture); assert.equal(u.waterProbe.value, target.texture);
    assert.deepEqual(u.oceanAmbient.value.toArray(), [.5, .5, .5]);
    assert.ok(u.waterSunDirection.value.distanceTo(sun.position.clone().normalize()) < 1e-6);
    assert.deepEqual(u.waterSunColor.value.toArray(), [2, 2, 2]);
    sun.visible = ambient.visible = hemisphere.visible = false; scene.environment = null;
    updateOceanOptics(u, renderer, scene, camera);
    assert.equal(u.oceanAmbient.value.length(), 0); assert.equal(u.waterSunColor.value.length(), 0);
    assert.equal(u.waterEnvironmentIntensity.value, 0); assert.equal(u.waterProbe.value, null);
    assert.equal(u.waterSceneEnabled.value, 0); assert.equal(u.waterSceneColor.value, null); target.dispose();
  });
  await check("ocean: depth/normal overrides preserve owner clock, shared textures, visibility and render state on errors", async () => {
    const sea = { ...body(), surfaceLevel: 0 }, coverage = buildOceanCoverage(sea, 1, () => -3);
    const textures = Array.from({ length: 7 }, () => new Texture()); let borrowedFreed = 0;
    textures.forEach(texture => texture.addEventListener("dispose", () => { borrowedFreed++; }));
    const simulation = { lengths: [600, 85, 12, 2.1], displacement: textures.slice(0, 3), slopes: textures.slice(3), stats: { time: 12 } } as unknown as OceanFft;
    const surface = new OceanSurface(coverage, simulation), scene = new Scene(), camera = new PerspectiveCamera();
    camera.position.set(3, 10, 5); camera.updateMatrixWorld(true); surface.updateView(camera); scene.add(surface);
    assert.equal(surface.material.uniforms.waveClock!.value, 12);
    const anchor = surface.material.uniforms.anchor!.value.clone(), before = surface.material.uniforms;
    camera.position.set(10000, 10, -20000); camera.updateMatrixWorld(true); surface.updateView(camera);
    assert.ok(surface.reflectionBounds.containsPoint(camera.position), "coverage gate follows the camera's world-space grid, not origin geometry");
    camera.position.set(3, 10, 5); camera.updateMatrixWorld(true); surface.updateView(camera);
    const source = new WaterReflectionRegistry().acquire("test", 0, "medium");
    surface.setReflectionSource(source); assert.equal(before.reflectionTexture!.value, source.binding.texture);
    surface.setReflectionSource(null); assert.equal(before.reflectionTexture!.value, null);
    assert.equal(before.planarReflectionEnabled!.value, 0); source.dispose();
    let draws = 0, materialsFreed = 0, previousCalls = 0;
    const previous = scene.onAfterRender = () => { previousCalls++; };
    const renderer = { autoClear: true, render: (object: Object3D) => {
      const proxy = object as OceanSurface; assert.equal(proxy.material.uniforms.waveClock, before.waveClock);
      proxy.material.addEventListener("dispose", () => { materialsFreed++; }); draws++;
    } } as unknown as WebGLRenderer;
    for (const kind of ["normal", "depth"] as const) renderSceneWithLakeOverride(scene, kind, () => {
      assert.equal(surface.visible, false);
      scene.onAfterRender(renderer, scene, camera, surface.geometry, surface.material, null);
    });
    assert.equal(draws, 2); assert.equal(previousCalls, 2); assert.equal(renderer.autoClear, true);
    assert.equal(scene.onAfterRender, previous); assert.equal(surface.visible, true);
    assert.throws(() => renderSceneWithLakeOverride(scene, "normal", () => { throw new Error("pass failed"); }), /pass failed/);
    assert.equal(surface.visible, true); assert.equal(scene.onAfterRender, previous);
    renderer.render = () => { throw new Error("GPU failed"); };
    assert.throws(() => surface.renderWaveOverride(renderer, camera, "normal"), /GPU failed/); assert.equal(renderer.autoClear, true);
    assert.equal(simulation.stats.time, 12); assert.ok(surface.material.uniforms.anchor!.value.equals(anchor));
    surface.dispose(); surface.dispose(); assert.equal(materialsFreed, 2); assert.equal(borrowedFreed, 0);
    textures.forEach(texture => texture.dispose());
  });
  await check("ocean: real layout save/read and partition keep the complete sparse Ocean contract", async () => {
    const ocean = body(), layout: RoomLayout = { schema: 1, name: "Coast", loadGroups: [], instances: [], characters: [], oceanWaters: [ocean] };
    const saved = validateLayout(layout) as RoomLayout;
    assert.deepEqual(saved.oceanWaters, [ocean]); assert.deepEqual(collectDroppedFields(layout, saved).paths, []);
    assert.deepEqual(readRoomLayout(JSON.parse(JSON.stringify(saved)), "coast").oceanWaters, [ocean]);
    assert.deepEqual(partitionLayout(layout, { ...DEFAULT_WORLD_PARTITION, enabled: true }).persistent.oceanWaters, [ocean]);
    const sparse = body(); delete sparse.waves; delete sparse.appearance;
    assert.deepEqual(validateOceanWater(sparse), sparse, "validation must not write resolved defaults into authored data");
    assert.ok(!("oceanWaters" in validateLayout({ ...layout, oceanWaters: undefined })));
    assert.deepEqual(validateOceanWaters([]), []);
    const dirty = { ...layout, oceanWaters: [{ ...ocean, simulationTextures: "not authored data" }] };
    assert.ok(collectDroppedFields(dirty, validateLayout(dirty)).paths.some(p => p.includes("simulationTextures")));
  });
  await check("ocean: read and save reject unsafe dimensions, invalid wave parameters and excess bodies", async () => {
    for (const patch of [{ surfaceLevel: Infinity }, { offshoreDepth: 0 }, { id: "" }, { terrainRef: " " },
      { openEdges: ["west", "west"] }, { openEdges: ["elsewhere"] }, { openEdges: [] },
      { bounds: { min: [0, 0], max: [-1, 2] } }, { waves: { seed: 1.5 } }, { waves: { windSpeed: 0 } },
      { waves: { choppiness: 10 } }, { appearance: { roughness: NaN } }, { hidden: 1 }, { appearance: { deepColor: "blue" } },
      { appearance: { reflectionMode: "unknown" } }, { appearance: { reflectionQuality: "low" } },
      { appearance: { reflectionGroup: " " } }, { appearance: { reflectionGroup: "a".repeat(257) } },
      { appearance: { reflectionStrength: 1.1 } }, { appearance: { reflectionStrength: NaN } }]) {
      const bad = { schema: 1, name: "Coast", loadGroups: [], instances: [], characters: [], oceanWaters: [{ ...body(), ...patch }] };
      assert.throws(() => validateLayout(bad)); assert.throws(() => readRoomLayout(bad, "coast"));
    }
    assert.throws(() => validateOceanWaters([body(), { ...body(), id: "other" }]));
  });
  await check("ocean: open sea floods around an island but never into its disconnected below-sea basin", async () => {
    const sea = body();
    const coverage = buildOceanCoverage(sea, .25, (x, z) => {
      const r = Math.hypot(x, z); return sea.surfaceLevel + (r > 1 && r < 3 ? 2 : -2);
    });
    assert.equal(coverage.status, "ready"); assert.ok(coverage.wetFaces > 0);
    assert.equal(sampleOceanCoverage(coverage, 6, 0).status, "wet");
    assert.equal(sampleOceanCoverage(coverage, 2, 0).status, "dry");
    assert.equal(sampleOceanCoverage(coverage, 0, 0).status, "dry", "the lower crater isn't connected to the sea");
    assert.deepEqual(sampleOceanCoverage(coverage, 100, 0), { status: "wet", depth: 40, bed: -33, offshore: true });
    const near = sampleOceanCoverage(coverage, 8.001, 0);
    assert.equal(near.status, "wet"); if (near.status === "wet") assert.ok(Math.abs(near.depth - 2) < .001, "offshore joins without a depth/colour discontinuity");
    assert.equal(sampleOceanCoverage(coverage, NaN, 0).status, "unknown");
  });
  await check("ocean: world-space sea level, exact b-c triangles and selected open edges control coverage", async () => {
    const sea = { ...body(), bounds: { min: [20, 40] as [number, number], max: [24, 44] as [number, number] }, openEdges: ["west"] as const };
    const coverage = buildOceanCoverage({ ...sea, openEdges: [...sea.openEdges] }, 1, x => x - 16);
    const sample = sampleOceanCoverage(coverage, 21.4, 41.2);
    assert.equal(sample.status, "wet"); if (sample.status === "wet") assert.ok(Math.abs(sample.depth - 1.6) < 1e-6);
    assert.equal(sampleOceanCoverage(coverage, 23.1, 41.2).status, "dry");
    const blocked = buildOceanCoverage({ ...body(), openEdges: ["west"] }, .5, x => x < -6 ? 9 : 3);
    assert.equal(blocked.wetFaces, 0, "east wet edge is not an authored sea source");
    const diagonal = buildOceanCoverage({ ...body(), bounds: { min: [0, 0], max: [1, 1] } }, 1,
      (x, z) => x === 0 && z === 0 ? 3 : x === 1 && z === 1 ? 3 : 9);
    assert.equal(sampleOceanCoverage(diagonal, .1, .1).status, "wet");
    assert.equal(sampleOceanCoverage(diagonal, .5, .5).status, "dry", "the dry shared diagonal never leaks connectivity");
  });
  await check("ocean: missing terrain remains unknown and cooperative preparation cancels instead of publishing", async () => {
    const incomplete = buildOceanCoverage(body(), .5, x => x > 0 ? null : 3);
    assert.equal(incomplete.status, "missing-data"); assert.equal(incomplete.wetFaces, 0);
    assert.equal(sampleOceanCoverage(incomplete, -6, 0).status, "unknown");
    assert.throws(() => buildOceanCoverage(body(), 1e-6, () => 3));
    assert.throws(() => buildOceanCoverage(body(), .3, () => 3));
    const aborter = new AbortController(); let slices = 0;
    const work = new CooperativeWork({ signal: aborter.signal, budgetMs: 0,
      yieldTask: async () => { if (++slices === 3) aborter.abort(); } });
    await assert.rejects(prepareOceanCoverage(body(), .5, () => 3, work), error => (error as Error).name === "AbortError");
  });
  await check("ocean: nested grid rings face upward, avoid overlap and have an explicit memory bound", async () => {
    const grid = createOceanGrid(16, 3, 1);
    try {
      const p = grid.getAttribute("position"), index = grid.index!; let area = 0;
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        const up = (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) - (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
        assert.ok(up > 0); area += up / 2;
      }
      assert.equal(area, 64 ** 2, "rings tile the outer square exactly once");
      assert.throws(() => createOceanGrid(1024, 20));
    } finally { grid.dispose(); }
  });
  await check("ocean: native multi-tile snapshots respect world origin, missing cells and bounded nonresident reads", async () => {
    const doc = createLakeFixture([1000, 20, 2000]);
    const sea = { ...body(), bounds: { min: [1000, 2000] as [number, number], max: [1128, 2128] as [number, number] }, surfaceLevel: 30 };
    const quick = () => new CooperativeWork({ yieldTask: async () => {} });
    const full = await prepareOceanTerrain(doc, sea, undefined, quick());
    assert.equal(full.status, "ready"); assert.equal(full.wetFaces, 128 * 128 * 2);
    assert.equal(sampleOceanCoverage(full, 1064, 2064).status, "wet");
    const missing = doc.tiles.get("1_1")!; doc.tiles.delete("1_1"); let reads = 0;
    const loaded = await prepareOceanTerrain(doc, sea, async key => { reads++; assert.equal(key, "1_1"); return missing; }, quick());
    assert.equal(reads, 1); assert.equal(doc.tiles.has("1_1"), false, "temporary reads must not alter streaming residency");
    assert.deepEqual(loaded.triangles, full.triangles);
    await assert.rejects(prepareOceanTerrain(doc, sea, undefined, quick()), /requires tile/);
    doc.def.tiles = doc.def.tiles.filter(t => t.key !== "1_1");
    assert.equal((await prepareOceanTerrain(doc, sea, undefined, quick())).status, "missing-data");
    await assert.rejects(prepareOceanTerrain(doc, { ...sea, bounds: { min: [1000, 2000], max: [1064, 2064] } }, undefined, quick()), /full terrain bounds/);
  });
  await check("ocean: shared controller preserves valid water on failed rebuild and releases hidden/deleted bodies", async () => {
    const document = createLakeFixture(), scene = new Scene(), camera = new PerspectiveCamera();
    const sea: OceanWaterBody = { ...body(), bounds: { min: [-64, -64], max: [64, 64] }, surfaceLevel: 17 };
    let made = 0, freed = 0, updates = 0; const deltas: number[] = [];
    const controller = new OceanWaterController({ scene, renderer: {} as WebGLRenderer, document: () => document,
      load: async () => { throw new Error("missing tile"); },
      create: () => { made++; return { object: new Object3D(), update: delta => { updates++; deltas.push(delta); }, dispose: () => { freed++; } }; } });
    try {
      await controller.rebuild([sea]); assert.equal(controller.results.get(sea.id)?.status, "ready");
      const original = controller.object; assert.equal(scene.children.length, 1);
      controller.update(1 / 60, camera); assert.equal(updates, 1);
      controller.update(.1, camera); assert.equal(deltas.at(-1), .1, "slow frames must not silently halve simulation time");
      controller.update(NaN, camera); assert.equal(deltas.at(-1), 0, "invalid clock values cannot enter the simulation");
      await controller.rebuild([sea]); assert.equal(made, 1, "unchanged source must not reallocate FFT targets");
      document.tiles.delete("1_1"); await controller.rebuild([sea], true);
      assert.equal(controller.object, original); assert.equal(controller.results.get(sea.id)?.status, "error"); assert.equal(freed, 0);
      await controller.rebuild([sea]);
      assert.equal(controller.results.get(sea.id)?.status, "error", "a cached old surface cannot turn a failed terrain rebuild into Ready");
      await controller.rebuild([{ ...sea, hidden: true }]);
      assert.equal(original!.visible, false, "hidden takes effect even while replacement cannot prepare");
      controller.update(1 / 60, camera); assert.equal(updates, 3);
      await controller.rebuild([]); assert.equal(scene.children.length, 0); assert.equal(freed, 1);
    } finally { controller.dispose(); controller.dispose(); }
    assert.equal(freed, made);
  });
  await check("ocean: delete/travel during an uncooperative tile read never resurrects a stale surface", async () => {
    const document = createLakeFixture(), missing = document.tiles.get("1_1")!; document.tiles.delete("1_1");
    const scene = new Scene(); let created = 0, complete: (() => void) | undefined;
    const controller = new OceanWaterController({ scene, renderer: {} as WebGLRenderer, document: () => document,
      load: () => new Promise(resolve => { complete = () => resolve(missing); }),
      create: () => { created++; return { object: new Object3D(), update() {}, dispose() {} }; } });
    const pending = controller.rebuild([{ ...body(), bounds: { min: [-64, -64], max: [64, 64] }, surfaceLevel: 17 }]);
    for (let i = 0; !complete && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(complete, "fixture reaches the delayed tile read");
    await controller.rebuild([]); controller.dispose(); complete(); await pending;
    assert.equal(created, 0); assert.equal(scene.children.length, 0); assert.equal(controller.results.size, 0);
  });
  await check("ocean: editor create/edit/delete are undoable, locked bodies resist edits, selection ids and terrain moves agree", async () => {
    const doc = createLakeFixture(), layout: RoomLayout = { schema: 1, name: "Coast", instances: [], characters: [], loadGroups: [],
      landscapes: [{ id: "terrain", dataRef: "terrain.terrain.json", position: [0, 10, 0] }] };
    const commands: { label: string; redo(): void; undo(): void }[] = [];
    const app = Object.create(SceneApp.prototype) as SceneApp;
    const state = { layout, selection: { kind: "landscape", index: 0 } as Selection | null,
      landscapeSculptSettings: { activeRiverWaterId: null },
      lakeDocument: () => doc, rebuildOceans() {}, emitSelectionChanged() {},
      select(selection: Selection | null) { state.selection = selection; Object.assign(app, { selection }); },
      executeCommand(command: typeof commands[number]) { commands.push(command); command.redo(); } };
    Object.defineProperty(app, "selection", { value: state.selection, writable: true, configurable: true });
    Object.assign(app, state);
    app.createOcean(); assert.equal(layout.oceanWaters?.length, 1);
    const initial = structuredClone(layout.oceanWaters![0]!);
    assert.equal(selectionId(state.selection!), "ocean:0");
    assert.ok(selectionsEqual(cloneSelection(state.selection!), parseSelectionId("ocean:0")));
    assert.equal(parseSelectionId("ocean:-1"), null);
    app.editOcean({ surfaceLevel: 17 }); assert.equal(layout.oceanWaters![0]!.surfaceLevel, 17);
    commands.at(-1)!.undo(); assert.deepEqual(layout.oceanWaters, [initial]); commands.at(-1)!.redo();
    app.editOcean({ locked: true }); const count = commands.length;
    app.editOcean({ name: "not allowed" }); app.deleteOcean(); assert.equal(commands.length, count);
    app.editOcean({ locked: false }); app.deleteOcean(); assert.equal(layout.oceanWaters, undefined);
    commands.at(-1)!.undo(); assert.equal(layout.oceanWaters?.length, 1);
    const shifted = moveWorldTerrain(doc.def, "terrain", [], [3, 2, -4], [], [], [initial]);
    assert.deepEqual(shifted.oceans![0]!.bounds.min, [-61, -68]); assert.equal(shifted.oceans![0]!.surfaceLevel, 12);
    assert.deepEqual(initial.bounds.min, [-64, -64], "moving the terrain does not mutate history snapshots");
  });
}
