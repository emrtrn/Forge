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
import { DeformationField } from "../../engine/scene/deformationField";
import { TerrainDeformationTexture } from "../../engine/render-three/terrain/terrainDeformation";
import { TerrainRenderer } from "../../engine/render-three/terrain/terrainRenderer";
import { worldTerrainRenderSource } from "../../engine/terrain/terrainRenderSource";
import { Vector3 } from "three";
import { puddleTerrainDetails, puddleTerrainRevision } from "../../engine/render-three/terrain/terrainPuddleCoverage";
import { PUDDLE_WHEEL_RIPPLE_DEFAULTS, PUDDLE_WHEEL_RIPPLE_RANGES } from "../../engine/scene/puddleWater";
import { puddleRippleStops, puddleWheelContact } from "../../engine/terrain/puddleInteraction";
import { LakeRippleState } from "../../engine/terrain/lakeInteraction";
import type { VehicleWheelState } from "../../engine/physics/vehicle/vehicleTypes";

const body = (): PuddleWaterBody => ({ schema: 1, kind: "puddle", coordinateSpace: "world", id: "puddle-1", name: "Courtyard",
  terrainRef: "terrain", seed: [30, 0], bounds: { min: [24, -6], max: [36, 6] }, surfaceLevel: 10.2,
  hidden: false, locked: false, appearance: { color: "#504a35", opacity: .8, roughness: .2, reflectionStrength: 1,
    reflectionMode: "sharedPlanar", reflectionQuality: "high", planarReflectionStrength: .7 } });

export async function registerPuddlePersistenceTests(check: (label: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check("puddle wheel ripples: persisted bounded settings survive save/read without runtime history", async () => {
    const source = { ...body(), appearance: { ...body().appearance, ...PUDDLE_WHEEL_RIPPLE_DEFAULTS, wheelRippleStrength: 2.1 } };
    const layout: RoomLayout = { schema: 1, name: "Ripples", loadGroups: [], instances: [], characters: [], puddleWaters: [source] };
    const saved = validateLayout(layout) as RoomLayout;
    assert.deepEqual(saved.puddleWaters, [source]);
    assert.deepEqual(readRoomLayout(JSON.parse(JSON.stringify(saved)), "ripples").puddleWaters, [source]);
    for (const [key, [min, max]] of Object.entries(PUDDLE_WHEEL_RIPPLE_RANGES)) for (const value of [min - .001, max + .001, NaN, Infinity, "1"])
      assert.throws(() => validatePuddleWater({ ...source, appearance: { [key]: value } }));
    assert.throws(() => validatePuddleWater({ ...source, appearance: { wheelRipplesEnabled: 1 } }));
  });
  await check("puddle wheel ripples: conservative sectors stop at narrow islands and complexity limit", async () => {
    const shore = new Float32Array([-4,-4,4,-4, 4,-4,4,4, 4,4,-4,4, -4,4,-4,-4]);
    const open = puddleRippleStops(0, 0, shore, 10); assert.ok(open.every(v => v >= 3.99 && v < 5.7));
    const island = new Float32Array([...shore, 1,.01,1,.02]);
    const blocked = puddleRippleStops(0, 0, island, 10);
    assert.ok(blocked[0]! < 1.01, "an island between centre rays blocks the whole sector");
    assert.equal(blocked[16], open[16]);
    assert.ok(puddleRippleStops(0,0,new Float32Array(4100),10).every(v => v === 0));
  });
  await check("puddle wheel ripples: fixed-step motion/slip, dry air ground rejection and one subscription", async () => {
    const wheel: VehicleWheelState = { position:[0,0,0], radius:.5, suspensionLength:.2, suspensionForce:100,
      steering:0,rotation:0,inContact:true,groundEntityId:"terrain:0_0",contactPoint:[30,10,0],hardPoint:[30,11,0],worldCenter:[30,10.5,0],worldAxle:[1,0,0],tractionSlip:0 };
    const contact = (w: VehicleWheelState, depth = .2) => puddleWheelContact("car:0", w, .3, 10.2, "terrain", id => id.startsWith("terrain:") ? "terrain" : null, () => depth > 0 ? depth : null);
    assert.ok(contact(wheel)); assert.equal(contact({ ...wheel,inContact:false }),null);
    assert.equal(contact({ ...wheel,groundEntityId:"bridge" }),null); assert.equal(contact(wheel,0),null);
    assert.equal(contact({ ...wheel,worldCenter:[30,12,0] }),null);
    const counts = [30,60,144].map(hz => {
      const state = new LakeRippleState({ ...PUDDLE_WHEEL_RIPPLE_DEFAULTS, wheelRippleLifetime:4 }); state.setLimit(12);
      for (let i=0;i<hz;i++) state.advance(1/hz,[{ ...contact(wheel)!,x:30+i/hz }]);
      return state.ripples.length;
    });
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    const slip = new LakeRippleState(PUDDLE_WHEEL_RIPPLE_DEFAULTS);
    for (let i=0;i<60;i++) slip.advance(1/60,[{ ...contact(wheel)!, tractionSlip:1 }]);
    assert.ok(slip.ripples.length > 3); for(let i=0;i<180;i++) slip.advance(1/60,[]); assert.equal(slip.ripples.length,0);
    let listener: ((dt:number)=>void) | null = null, subscriptions = 0, released = 0, x = 30, wet = true, limit = 12, slipping = false;
    const doc = createLakeFixture(), controller = new PuddleWaterController({ scene:new Scene(),document:()=>doc,load:async()=>{throw new Error("load");},terrainForGround:()=>"terrain",rippleLimit:()=>limit,
      vehicles:{ vehicleIds:()=>["car"], vehicleDefinition:()=>null,vehicleState:()=>({forwardSpeed:1,engineLoad:1,drivetrain:null,wheels:[{...wheel,worldCenter:[x,10.5,0],inContact:wet,tractionSlip:slipping?1:0}]}),
        onPhysicsStep:fn=>{listener=fn;subscriptions++;return()=>{released++;listener=null;};} } });
    try {
      await controller.rebuild([body()]); await controller.rebuild([body()]); assert.equal(subscriptions,1);
      const tick = () => { x+=.01; (listener as ((dt:number)=>void) | null)?.(1/60); };
      for(let i=0;i<60;i++) tick(); assert.ok(controller.objects.get("puddle-1")!.wheelRippleCount>0);
      limit=2; tick(); assert.ok(controller.objects.get("puddle-1")!.wheelRippleCount<=2);
      wet=false; for(let i=0;i<180;i++) tick(); assert.equal(controller.objects.get("puddle-1")!.wheelRippleCount,0);
      assert.equal(body().appearance?.wheelRippleStrength,undefined);
      wet=true; limit=12; x=30; slipping=true;
      await controller.rebuild(Array.from({length:8},(_,i)=>({...body(),id:`budget-${i}`})));
      for(let i=0;i<150;i++) { x=30; tick(); }
      const counts=[...controller.objects.values()].map(surface=>surface.wheelRippleCount);
      assert.ok(counts.every(count=>count<=12)); assert.equal(counts.reduce((sum,n)=>sum+n,0),48);
      controller.clearWheelInteractions(); assert.ok([...controller.objects.values()].every(surface=>surface.wheelRippleCount===0));
      assert.equal(subscriptions,1);
      await controller.rebuild([{...body(),hidden:true}]); assert.equal(controller.objects.size,0);
    } finally { controller.dispose(); }
    assert.equal(released,1); assert.equal(listener,null);
  });
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
  await check("puddle live bed: filtered immutable snapshots track only depth revisions without consuming wheel dirty rectangles", async () => {
    const field = new DeformationField({ windowSize: 16, cellSize: .125 }), texture = new TerrainDeformationTexture();
    texture.attach(field); field.takeDirty();
    const before = texture.captureBed();
    field.stampWheel({ from: [0, -1], to: [0, 1], width: .5, contactLength: .5, targetDepth: .2, compaction: 1, disturbance: 255 });
    texture.captureBed(); const dirty = field.takeDirty(); assert.ok(dirty.length, "readers leave the upload queue intact");
    texture.update(dirty); const after = texture.captureBed();
    for(let z=-1;z<=1;z+=.13) for(let x=-1;x<=1;x+=.13) assert.equal(texture.currentBedOffsetAt(x,z),after.offsetAt(x,z));
    assert.equal(before.offsetAt(0, 0), 0); assert.ok(after.offsetAt(0, 0) < -.1);
    const changes = texture.bedChangesSince(before.revision)!; assert.ok(changes && changes.minX < 0 && changes.maxX > 0);
    const revision = texture.bedRevision; texture.update([]); assert.equal(texture.bedRevision, revision);
    field.recenter(2, 0); texture.update(field.takeDirty()); assert.equal(texture.bedChangesSince(revision), null);
    texture.detach(); assert.equal(texture.captureBed().offsetAt(0, 0), 0); texture.dispose();
  });
  await check("puddle live bed: the existing fill follows new wheel hollows at fixed water level, pins matching terrain detail and resets", async () => {
    const doc = createLakeFixture(), field = new DeformationField({ windowSize: 16, cellSize: .125 }); field.recenter(30, 0);
    const texture = new TerrainDeformationTexture(); texture.attach(field); field.takeDirty();
    const scene = new Scene(), controller = new PuddleWaterController({ scene, deformation: texture, detailLevels: () => 2,
      document: () => doc, load: async () => { throw new Error("deformation must reuse resident terrain"); } });
    const terrain = new TerrainRenderer(worldTerrainRenderSource(doc.def, doc.tiles), { terrainRef: "terrain", origin: new Vector3(...doc.def.origin),
      viewMode: "lit", activeLayer: 0, layers: [], deformation: texture, uploadsPerFrame: 4, slotCapacity: 4 });
    scene.add(terrain.mesh);
    try {
      const source = body(); await controller.rebuild([source]);
      const initial = controller.results.get(source.id)!; assert.equal(initial.spacing, .25);
      const activeSamplers = terrain.litFragmentSamplers;
      assert.equal(controller.sample("terrain", 30.5, 0), null);
      const camera = new PerspectiveCamera(60, 1, .1, 500); camera.position.set(31, 14, 6); camera.lookAt(30, 10, 0); camera.updateMatrixWorld(true);
      terrain.updateLod(camera);
      const a = terrain.mesh.geometry.getAttribute("terrainNodeA"), b = terrain.mesh.geometry.getAttribute("terrainNodeB");
      let fixed = 0;
      for (let i = 0; i < terrain.mesh.geometry.instanceCount; i++) if (b.getZ(i) > 1e19) { fixed++; assert.equal(a.getZ(i) / 32, .25); }
      assert.ok(fixed > 0, "the actual CDLOD bed uses the water's fixed grid");
      const native = [...doc.tiles.values()].map(tile => tile.heights.slice());
      field.stampWheel({ from: [30.5, -.8], to: [30.5, .8], width: .5, contactLength: .5, targetDepth: .28, compaction: 1, disturbance: 255 });
      texture.update(field.takeDirty());
      await new Promise(resolve => setTimeout(resolve, 110)); controller.update(); await controller.whenIdle();
      const sample = controller.sample("terrain", 30.5, 0); assert.ok(sample); assert.equal(sample.level, source.surfaceLevel);
      assert.ok(sample.depth > .05); assert.ok(controller.results.get(source.id)!.area > initial.area);
      assert.equal(sample.stale, false); assert.equal(controller.sample("other-terrain", 30.5, 0), null);
      [...doc.tiles.values()].forEach((tile, i) => assert.deepEqual(tile.heights, native[i]));
      const object = controller.objects.get(source.id)!, geometry = object.geometry;
      controller.update(); await controller.whenIdle(); assert.equal(object.geometry, geometry, "idle frames do not rebuild");
      texture.detach(); await new Promise(resolve => setTimeout(resolve, 110)); controller.update(); await controller.whenIdle();
      assert.equal(controller.results.get(source.id)!.spacing, 1); assert.equal(controller.sample("terrain", 30.5, 0), null);
      assert.equal(terrain.litFragmentSamplers, activeSamplers - 1, "a static Puddle reserves no mask sampler while deformation is inactive");
      assert.equal(puddleTerrainDetails(terrain.mesh, "terrain").length, 0);
      await controller.rebuild([]); assert.equal(controller.objects.size, 0); assert.ok(puddleTerrainRevision(terrain.mesh) > 0);
    } finally { controller.dispose(); terrain.dispose(); texture.dispose(); }
  });
  await check("puddle live bed: raised muddy berms cut water instead of bending its surface, and cancelled jobs cannot return", async () => {
    const doc = createLakeFixture();
    for (const tile of doc.tiles.values()) for (let z = 0; z < tile.size; z++) for (let x = 0; x < tile.size; x++) {
      const wx = tile.x * 64 + x - 64, wz = tile.z * 64 + z - 64;
      if (Math.abs(wx - 30) <= 3 && Math.abs(wz) <= 3) tile.heights[z * tile.size + x] = .19;
    }
    const field = new DeformationField({ windowSize: 16, cellSize: .125 }); field.recenter(30, 0);
    const texture = new TerrainDeformationTexture(); texture.attach(field); field.takeDirty();
    const scene = new Scene(), controller = new PuddleWaterController({ scene, deformation: texture, detailLevels: () => 2,
      document: () => doc, load: async () => { throw new Error("unexpected load"); } });
    try {
      await controller.rebuild([body()]); const initial = controller.results.get("puddle-1")!.area;
      field.stampWheel({ from: [30.5, -2], to: [30.5, 2], width: .5, contactLength: .5, targetDepth: .28, compaction: 1, disturbance: 255 });
      texture.update(field.takeDirty());
      await new Promise(resolve => setTimeout(resolve, 110)); controller.update(); await controller.whenIdle();
      assert.ok(controller.results.get("puddle-1")!.area < initial, "rims above the horizontal water become dry islands");
      let dryRim = false;
      for (let x = 29.5; x < 31.5; x += .25) if (texture.captureBed().offsetAt(x, 0) > .011 && !controller.sample("terrain", x, 0)) dryRim = true;
      assert.ok(dryRim);
      field.stampDisc([30, 0], .4, .2); texture.update(field.takeDirty());
      await new Promise(resolve => setTimeout(resolve, 110)); controller.update();
      await controller.rebuild([]); await controller.whenIdle(); assert.equal(controller.objects.size, 0); assert.equal(scene.children.length, 0);
    } finally { controller.dispose(); texture.dispose(); }
  });
}
