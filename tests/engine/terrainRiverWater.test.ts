import assert from "node:assert/strict";
import { CubeUVReflectionMapping, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderTarget } from "three";
import { createWaterEnvironmentUniforms, updateWaterEnvironment } from "../../engine/render-three/waterEnvironment";
import { createRiverSunShadowUniforms, updateRiverSunShadow } from "../../engine/render-three/riverSunShadow";
import { SunCascadeShadow } from "../../engine/render-three/sunCascadeShadow";
import { buildRiverWaterRibbon, createRiverWaterObject } from "../../engine/render-three/riverWater";
import { resolveRiverWater } from "../../engine/scene/riverWater";
import { splineToPolyline } from "../../engine/scene/landscape";
import { applyTerrainUndoPatches, createTerrainEditWorld, revertTerrainUndoPatches } from "../../engine/terrain/terrainEdit";
import { terrainHeightAt, terrainHeightAtSmooth } from "../../engine/terrain/terrainHeightQuery";
import { prepareTerrainRiverWaterSource } from "../../engine/terrain/terrainRiverWater";
import { createTerrainSplinePatches } from "../../engine/terrain/terrainSplines";
import { createFlatTerrainTile, tileKey, type TerrainTileData, type WorldTerrainDef } from "../../engine/terrain/terrainTypes";
import { validateRiverWater } from "../../tools/saveValidator";
import { createRiverRefractionSurface, RIVER_REFRACTION_LIMITS } from "../../engine/render-three/riverRefraction";

type CheckAsync = (label: string, fn: () => Promise<void>) => Promise<void>;
function fixture() {
  const def: WorldTerrainDef = { schema: 1, type: "worldTerrain", name: "River", tileQuads: 32, spacing: 1,
    tilesX: 4, tilesZ: 2, origin: [1000000.25, 7.5, -1000000.75], heightMin: -64, heightMax: 64,
    collision: true, layers: [{ id: "mud", name: "Mud", color: "#554433" }], tiles: [] };
  const tiles = new Map<string, TerrainTileData>();
  for (let z = 0; z < 2; z++) for (let x = 0; x < 4; x++) {
    const tile = createFlatTerrainTile(def, x, z);
    tiles.set(tileKey(x, z), tile); def.tiles.push({ key: tileKey(x, z), minHeight: 0, maxHeight: 0 });
  }
  def.splines = [{ id: "river", coordinateSpace: "world", points: [8, 32, 56].map((x, i) => ({
    id: String(i), position: [def.origin[0] + x, 7.5, def.origin[2] + 16], width: 6, falloff: 3,
  })), segments: [0, 1].map((i) => ({ id: `s${i}`, startPointId: String(i), endPointId: String(i + 1),
    deform: { enabled: true, flatten: true, raiseTerrain: true, lowerTerrain: true, targetOffset: -2 } })) }];
  const water = resolveRiverWater({ id: "water", landscapeRef: "terrain", splineRef: "river", coordinateSpace: "world", surfaceLevel: 9,
    segmentProfiles: [{ splineSegmentRef: "s1", flowSpeedMultiplier: 2, rapidness: 0.8 }] });
  return { def, tiles, water };
}

export async function registerTerrainRiverWaterTests(checkAsync: CheckAsync): Promise<void> {
  await checkAsync("terrain river: surface controls survive save/read and rejects malformed settings", async () => {
    const base = { id: "river", landscapeRef: "land", splineRef: "spline" };
    assert.equal(resolveRiverWater(base).surfaceStrength, 2);
    assert.equal(validateRiverWater(base).surfaceStrength, undefined, "omitted controls remain omitted on save");
    const source = { ...base, surfaceStrength: 1.75, surfaceRoughness: 0.24, refractionStrength: 1.1 };
    const saved = validateRiverWater(source);
    assert.deepEqual(saved, source);
    const resolved = resolveRiverWater(saved);
    assert.equal(resolved.surfaceStrength, 1.75);
    assert.equal(resolved.surfaceRoughness, 0.24);
    assert.equal(resolved.refractionStrength, 1.1);
    assert.equal(resolveRiverWater(base).refractionStrength, 0.65);
    for (const patch of [{surfaceStrength:NaN}, {surfaceStrength:-1},
      {surfaceStrength:2.1}, {surfaceRoughness:0}, {surfaceRoughness:Infinity}, {surfaceRoughness:"0.2"},
      {refractionStrength:-1}, {refractionStrength:2.1}, {refractionStrength:NaN}, {refractionStrength:"1"}]) {
      assert.throws(() => validateRiverWater({...source,...patch}), /river water (surface|refraction)/);
      assert.throws(() => resolveRiverWater({...source,...patch} as typeof source), /river water (surface|refraction)/);
    }
    const spline = { id: "spline", points: [
      {id:"a",position:[0,2,0] as [number,number,number],width:3,falloff:0},
      {id:"b",position:[12,-1,0] as [number,number,number],width:3,falloff:0}],
      segments:[{id:"ab",startPointId:"a",endPointId:"b"}] };
    const item = {...resolved,spline,position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],foamNoiseMap:null};
    const enhanced = createRiverWaterObject(item,null);
    assert.equal(enhanced.userData.waterSceneTransmission, true);
    assert.equal(enhanced.material.uniforms.surfaceStrength!.value,1.75);
    assert.equal(enhanced.material.uniforms.surfaceRoughness!.value,0.24);
    enhanced.dispose();
  });
  await checkAsync("River refraction: exact atlas keeps sloped triangles, signed depth, holes and bounded bytes", async () => {
    const spline = {id:"r",points:[{id:"a",position:[0,3,0] as [number,number,number],width:2,falloff:0},
      {id:"b",position:[8,1,0] as [number,number,number],width:2,falloff:0}],segments:[{id:"ab",startPointId:"a",endPointId:"b"}]};
    const ribbon = buildRiverWaterRibbon(spline,{surfaceLevel:3,widthScale:1,sampleSpacing:.5,
      heightAt:(x,z)=>x>3&&x<5?null:z>1?5:0});
    const before = structuredClone(ribbon);
    const atlas = createRiverRefractionSurface(ribbon);
    assert.ok(atlas.bytes <= RIVER_REFRACTION_LIMITS.bytes);
    assert.equal(atlas.texture.image.data.byteLength,atlas.bytes);
    const pixels = atlas.texture.image.data as Float32Array;
    for(let v=0;v<ribbon.positions.length/3;v++) {
      const i=(atlas.bases.z+v*3)*4;
      assert.deepEqual(Array.from(pixels.slice(i,i+4)),[...ribbon.positions.slice(v*3,v*3+3),ribbon.bedDepths[v]!].map(Math.fround));
      assert.deepEqual(Array.from(pixels.slice(i+4,i+8)),[...ribbon.uvs.slice(v*2,v*2+2),ribbon.shoreDistances[v]!,ribbon.rapidness[v]!].map(Math.fround));
      assert.equal(pixels[i+8],Math.fround(ribbon.flowSpeedMultipliers[v]!));
    }
    for(let t=0;t<ribbon.indices.length/3;t++) assert.deepEqual(Array.from(pixels.slice((atlas.bases.y+t)*4,(atlas.bases.y+t)*4+3)),ribbon.indices.slice(t*3,t*3+3));
    for(let c=0;c<atlas.grid.x*atlas.grid.y;c++) assert.ok(pixels[c*4+1]!<=16);
    assert.ok(ribbon.bedDepths.some(d=>d<0));
    assert.deepEqual(ribbon,before,"atlas preparation never changes the source wet/dry geometry");
    atlas.texture.dispose();
    assert.throws(()=>createRiverRefractionSurface({...ribbon,indices:[-1,0,1]}),/triangle index/);
    assert.throws(()=>createRiverRefractionSurface({...ribbon,uvs:[NaN,...ribbon.uvs.slice(1)]}),/attributes/);
    assert.throws(()=>createRiverRefractionSurface({...ribbon,indices:Array.from({length:17},()=>ribbon.indices.slice(0,3)).flat()}),/16 candidate/);
    assert.throws(()=>createRiverRefractionSurface({...ribbon,positions:new Array((RIVER_REFRACTION_LIMITS.vertices+1)*3).fill(0)}),/budget/);
  });
  await checkAsync("River refraction: strength zero and Low skip allocation; mesh disposal owns the atlas", async () => {
    const spline={id:"r",points:[{id:"a",position:[0,0,0] as [number,number,number],width:2,falloff:0},
      {id:"b",position:[8,-1,0] as [number,number,number],width:2,falloff:0}],segments:[{id:"ab",startPointId:"a",endPointId:"b"}]};
    const base={...resolveRiverWater({id:"r",landscapeRef:"l",splineRef:"r"}),spline,position:[1e6,12,-1e6] as [number,number,number],rotation:[0,30,0] as [number,number,number],foamNoiseMap:null};
    for(const patch of [{refractionStrength:0},{reflectionQuality:"low" as const}]) {
      const object=createRiverWaterObject({...base,...patch},null);
      assert.equal(object.material.defines.FORGE_RIVER_REFRACTION,undefined);
      assert.equal(object.userData.riverRefractionBytes,undefined);
      object.dispose();
    }
    const object=createRiverWaterObject(base,null);
    assert.equal(object.material.defines.FORGE_RIVER_REFRACTION,1);
    const atlas=()=>(object as unknown as {refractionSurface:ReturnType<typeof createRiverRefractionSurface>}).refractionSurface;
    let disposed=0;atlas().texture.addEventListener("dispose",()=>disposed++);
    const positions=object.geometry.getAttribute("position").array;
    for(let cycle=0;cycle<20;cycle++) {
      object.setRefractionAllowed(false);
      assert.equal(disposed,cycle+1);
      assert.equal(object.userData.riverRefractionBytes,undefined);
      assert.equal(object.material.uniforms.riverRefractionStrength!.value,0);
      object.setRefractionAllowed(true);
      assert.equal(object.geometry.getAttribute("position").array,positions);
      assert.equal(object.material.defines.FORGE_RIVER_REFRACTION,1);
      atlas().texture.addEventListener("dispose",()=>disposed++);
    }
    object.dispose();object.setRefractionAllowed(false);object.setRefractionAllowed(true);object.dispose();
    assert.equal(disposed,21,"a disposed mesh cannot revive its atlas through a late quality update");
    const branches={id:"dense",points:Array.from({length:17},(_,i)=>[
      {id:`a${i}`,position:[0,0,0] as [number,number,number],width:2,falloff:0},
      {id:`b${i}`,position:[8,-1,0] as [number,number,number],width:2,falloff:0}]).flat(),
      segments:Array.from({length:17},(_,i)=>({id:`s${i}`,startPointId:`a${i}`,endPointId:`b${i}`}))};
    const fallback=createRiverWaterObject({...base,spline:branches},null);
    assert.equal(fallback.material.defines.FORGE_RIVER_REFRACTION,undefined);
    assert.match(fallback.userData.riverRefractionFallback,/budget|exceeded|exceeds/);
    assert.ok(fallback.geometry.index!.count>0,"budget overflow preserves the R2 surface");
    fallback.dispose();
  });
  await checkAsync("terrain river: sun receiver matches camera light layers and releases cascade state", async () => {
    const scene = new Scene(), camera = new PerspectiveCamera(), uniforms = createRiverSunShadowUniforms();
    const hidden = new DirectionalLight(0xffffff, 20), fill = new DirectionalLight(0xffffff, 1), sun = new DirectionalLight(0xffffff, 5);
    hidden.castShadow = fill.castShadow = sun.castShadow = true;
    hidden.layers.set(2); sun.position.set(10, 30, 10);
    scene.add(hidden, fill, sun, sun.target);
    updateRiverSunShadow(uniforms, scene, camera);
    assert.equal(uniforms.riverSunShadowIndex.value, 1);
    sun.castShadow = false; updateRiverSunShadow(uniforms, scene, camera);
    assert.equal(uniforms.riverSunShadowIndex.value, -1, "Unshadowed sun does not borrow a fill light shadow");
    sun.castShadow = true;
    const cascades = new SunCascadeShadow(scene);
    cascades.update({sun, camera, count:3, mapSize:512, distance:100, stagger:false});
    updateRiverSunShadow(uniforms, scene, camera);
    assert.equal(uniforms.riverSunCascadeCount.value, 3);
    assert.deepEqual(uniforms.riverSunShadowFade.value.toArray(), cascades.fadeUniform.value.toArray());
    cascades.dispose(); updateRiverSunShadow(uniforms, scene, camera);
    assert.equal(uniforms.riverSunCascadeCount.value, 0);
    assert.deepEqual(uniforms.riverSunShadowFade.value.toArray(), [1e9,1e9]);
  });
  await checkAsync("terrain river: legacy environment migrates to planar and explicit Off round-trips", async () => {
    const base = { id: "river", landscapeRef: "land", splineRef: "spline" };
    assert.equal(resolveRiverWater({ ...base, reflectionMode: "sharedPlanar" }).reflectionMode, "sharedPlanar");
    assert.equal(resolveRiverWater({ ...base, reflectionMode: "off" }).reflectionMode, "off");
    assert.equal(validateRiverWater({ ...base, reflectionMode: "environment" }).reflectionMode, "sharedPlanar");
    assert.equal(validateRiverWater({ ...base, reflectionMode: "sharedPlanar" }).reflectionMode, "sharedPlanar");
    assert.equal(resolveRiverWater(validateRiverWater({ ...base, reflectionMode: "off" }) as any).reflectionMode, "off");
    assert.equal(resolveRiverWater({ ...base, reflectionMode: "environment" }).reflectionMode, "sharedPlanar");
  });
  await checkAsync("terrain river: environment rebind, probe removal and borrowed texture lifetime", async () => {
    const global = new WebGLRenderTarget(768, 1024), local = new WebGLRenderTarget(336, 256);
    global.texture.mapping = local.texture.mapping = CubeUVReflectionMapping;
    let disposed = 0;
    global.texture.addEventListener("dispose", () => { disposed++; });
    local.texture.addEventListener("dispose", () => { disposed++; });
    const scene = new Scene(), camera = new PerspectiveCamera(), uniforms = createWaterEnvironmentUniforms();
    camera.position.set(1, 2, 3); camera.updateMatrixWorld(true);
    const probe = { target: local, position: [0, 0, 0] as [number, number, number], radius: 10, priority: 1,
      intensity: 0.6, resolution: 64, parallax: false, near: 0.1, far: 100 };
    scene.environment = global.texture; scene.environmentIntensity = 0.8;
    updateWaterEnvironment(uniforms, scene, camera, [probe]);
    assert.equal(uniforms.waterEnvironment.value, global.texture);
    assert.equal(uniforms.waterEnvironmentIntensity.value, 0.8);
    assert.equal(uniforms.waterEnvironmentSize.value.z, 8);
    assert.equal(uniforms.waterProbeSize.value.z, 6);
    assert.equal(uniforms.waterProbe.value, local.texture);
    updateWaterEnvironment(uniforms, scene, camera);
    assert.equal(uniforms.waterProbe.value, null); assert.equal(uniforms.waterProbeRadius.value, 0);
    scene.environment = null; updateWaterEnvironment(uniforms, scene, camera);
    assert.equal(uniforms.waterEnvironment.value, null); assert.equal(uniforms.waterEnvironmentIntensity.value, 0);
    assert.equal(disposed, 0, "Water does not dispose scene-owned textures");
    global.dispose(); local.dispose();
  });
  await checkAsync("terrain river: optical rendering preserves transformed slope and resource disposal", async () => {
    const spline = { id: "sloped", points: [
      { id: "a", position: [-2, 3, 0] as [number, number, number], width: 1, falloff: 0 },
      { id: "b", position: [2, 5, 0] as [number, number, number], width: 1, falloff: 0 },
    ], segments: [{ id: "ab", startPointId: "a", endPointId: "b" }] };
    const water = resolveRiverWater({ id: "optics", landscapeRef: "terrain", splineRef: "sloped", surfaceLevel: 3 });
    const before = structuredClone({ spline, water });
    const object = createRiverWaterObject({ ...water, spline, heightAt: () => 1,
      position: [20, 7, -30], rotation: [0, 90, 0], foamNoiseMap: null }, null);
    object.updateMatrixWorld(true);
    const positions = object.geometry.getAttribute("position");
    const first = new Vector3().fromBufferAttribute(positions, 0).applyMatrix4(object.matrixWorld);
    const last = new Vector3().fromBufferAttribute(positions, positions.count - 1).applyMatrix4(object.matrixWorld);
    assert.ok(first.distanceTo(new Vector3(19, 10, -28)) < 1e-6);
    assert.ok(last.distanceTo(new Vector3(21, 12, -32)) < 1e-6);
    assert.equal(object.geometry.getAttribute("waterDepth").getX(0), 2);
    assert.equal(object.geometry.getAttribute("waterDepth").getX(positions.count - 1), 4);
    assert.equal(object.geometry.getAttribute("flowDirection").getX(0), 1);
    assert.equal(object.geometry.getAttribute("flowDirection").getY(0), 0);
    assert.equal(object.material.depthWrite, false);
    assert.equal(object.material.uniforms.reflectionStrength!.value, water.reflectionStrength);
    assert.equal(object.material.uniforms.waterEnvironmentIntensity!.value, 0, "No map is fabricated before a scene supplies one");
    let geometryDisposals = 0, materialDisposals = 0;
    object.geometry.addEventListener("dispose", () => { geometryDisposals++; });
    object.material.addEventListener("dispose", () => { materialDisposals++; });
    object.dispose();
    assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
    assert.deepEqual({ spline, water }, before);
  });

  await checkAsync("terrain river: descending and rising spline Y drive surface and dry-bed depth in world and local frames", async () => {
    const doc = fixture();
    doc.def.splines![0]!.points.forEach((point, i) => { point.position[1] = [11.5, 3.5, 7.5][i]!; });
    doc.water.surfaceLevel = 13;
    const source = await prepareTerrainRiverWaterSource(doc, doc.water);
    const ribbon = buildRiverWaterRibbon(source.spline, { ...source, widthScale: 1 });
    for (let i = 0; i < ribbon.waterDepths.length; i++) {
      const x = ribbon.positions[i * 3]!;
      const expectedY = x <= -32 ? 5.5 - (x + 56) / 3 : -2.5 + (x + 32) / 6;
      assert.ok(Math.abs(ribbon.positions[i * 3 + 1]! - expectedY) < 1e-9);
      assert.ok(Math.abs(ribbon.waterDepths[i]! - Math.max(0, expectedY)) < 1e-9);
    }
    assert.ok(ribbon.waterDepths.includes(0), "elevated bed stays dry where the spline dips below it");
    const object = createRiverWaterObject({ ...doc.water, ...source, foamNoiseMap: null }, null);
    const positions = object.geometry.getAttribute("position");
    assert.equal(object.position.y + positions.getY(0), 13);
    assert.equal(object.position.y + positions.getY(positions.count - 1), 9);
    object.dispose();
    // The same saved height in legacy local coordinates must produce the same ribbon.
    const { coordinateSpace: _space, ...localWater } = doc.water;
    const localSource = await prepareTerrainRiverWaterSource(doc, { ...localWater, surfaceLevel: source.surfaceLevel });
    assert.deepEqual(buildRiverWaterRibbon(localSource.spline, { ...localSource, widthScale: 1 }), ribbon);
  });

  await checkAsync("terrain river: curved samples and disconnected chains retain a common height offset", async () => {
    const doc = fixture();
    const source = await prepareTerrainRiverWaterSource(doc, doc.water);
    const spline = source.spline;
    spline.smooth = true;
    spline.points.forEach((point, i) => { point.position[1] = [10, 4, 7][i]!; });
    spline.points[1]!.position[2] += 8;
    spline.points.push({ id: "branch-a", position: [0, 15, 0], width: 2, falloff: 1 },
      { id: "branch-b", position: [8, 12, 0], width: 2, falloff: 1 });
    spline.segments.push({ id: "branch", startPointId: "branch-a", endPointId: "branch-b" });
    const ribbon = buildRiverWaterRibbon(spline, { surfaceLevel: 10.5, widthScale: 1 });
    const centres = Array.from({ length: ribbon.waterDepths.length / 5 }, (_, row) => ribbon.positions.slice((row * 5 + 2) * 3, (row * 5 + 3) * 3));
    for (const sub of splineToPolyline(spline, 24)) for (const sample of [sub.start, sub.end]) {
      assert.ok(centres.some((point) => Math.hypot(point[0]! - sample.position[0],
        point[1]! - sample.position[1] - 0.5, point[2]! - sample.position[2]) < 1e-9));
    }
    assert.ok(ribbon.waterDepths.every((depth) => Math.abs(depth - 1) < 1e-9), "fallback depth follows the surface too");
  });

  await checkAsync("terrain river: world height, exact triangle depth, flow and foam share a stable local frame", async () => {
    const doc = fixture(), before = structuredClone(doc.def);
    // Saddle cell separates the exact triangle height from bilinear interpolation.
    doc.tiles.get("0_0")!.heights[17 * 33 + 17] = 4;
    const source = await prepareTerrainRiverWaterSource(doc, doc.water);
    assert.equal(source.surfaceLevel, 1.5);
    assert.equal(source.heightAt(-47.75, -15.75), 0);
    const lookup = { tile: (x: number, z: number) => doc.tiles.get(tileKey(x, z)) };
    assert.notEqual(terrainHeightAt(doc.def, lookup, doc.def.origin[0] + 16.25, doc.def.origin[2] + 16.25),
      terrainHeightAtSmooth(doc.def, lookup, doc.def.origin[0] + 16.25, doc.def.origin[2] + 16.25));
    const ribbon = buildRiverWaterRibbon(source.spline, { ...source, widthScale: doc.water.widthScale, segmentProfiles: doc.water.segmentProfiles });
    assert.ok(ribbon.positions.every((p) => Math.abs(p) < 100), "million-metre origin stays out of Float32 geometry");
    assert.ok(ribbon.flowSpeedMultipliers.includes(2)); assert.ok(ribbon.rapidness.includes(0.8));
    for (let i = 0; i < ribbon.waterDepths.length; i++) {
      const height = source.heightAt(ribbon.positions[i * 3]!, ribbon.positions[i * 3 + 2]!);
      assert.equal(ribbon.waterDepths[i], Math.max(0, source.surfaceLevel - height!));
      assert.equal(ribbon.flowDirections[i * 2], 1); assert.equal(ribbon.flowDirections[i * 2 + 1], 0);
    }
    const object = createRiverWaterObject({ ...doc.water, ...source, foamNoiseMap: null }, null);
    assert.equal(object.position.y + object.geometry.getAttribute("position").getY(0), 9);
    assert.equal(object.children.length, 0); object.dispose();
    assert.deepEqual(doc.def, before);
  });

  await checkAsync("terrain river: corridor reads are bounded, failures are atomic and retry leaves residency unchanged", async () => {
    const doc = fixture(), disk = new Map(doc.tiles); doc.tiles.clear();
    const requested: string[] = []; let active = 0, peak = 0;
    const source = await prepareTerrainRiverWaterSource(doc, doc.water, async (key) => {
      requested.push(key); active++; peak = Math.max(peak, active);
      await Promise.resolve(); active--; return disk.get(key)!;
    });
    assert.deepEqual(requested.sort(), ["0_0", "1_0"]); assert.ok(peak <= 4);
    assert.equal(doc.tiles.size, 0); assert.equal(source.heightAt(-32, -16), 0);
    await assert.rejects(prepareTerrainRiverWaterSource(doc, doc.water), /requires terrain tile/);
    await assert.rejects(prepareTerrainRiverWaterSource(doc, doc.water, async () => { throw new Error("HTTP 503"); }), /HTTP 503/);
    const retry = await prepareTerrainRiverWaterSource(doc, doc.water, async (key) => disk.get(key)!);
    assert.equal(retry.heightAt(-32, -16), 0); assert.equal(doc.tiles.size, 0);
  });

  await checkAsync("terrain river: real holes clip the ribbon without inventing a bed or bridging gaps", async () => {
    const doc = fixture(); doc.def.tiles = doc.def.tiles.filter(({ key }) => key !== "1_0"); doc.tiles.delete("1_0");
    const source = await prepareTerrainRiverWaterSource(doc, doc.water);
    assert.equal(source.heightAt(-16, -16), null);
    const ribbon = buildRiverWaterRibbon(source.spline, { ...source, widthScale: 1 });
    assert.ok(ribbon.indices.length > 0);
    for (const index of ribbon.indices) assert.notEqual(source.heightAt(ribbon.positions[index * 3]!, ribbon.positions[index * 3 + 2]!), null);
    assert.ok(ribbon.indices.every((i) => ribbon.positions[i * 3]! <= -32), "no triangles cross into the missing half");
  });

  await checkAsync("terrain river: bed bake and exact undo/redo refresh depth on both sides of a seam", async () => {
    const doc = fixture(); const world = createTerrainEditWorld(doc.def, doc.tiles.values());
    const document = { def: world.def, tiles: world.tiles };
    const depths = async () => { const source = await prepareTerrainRiverWaterSource(document, doc.water);
      return [-32.25, -31.75].map((x) => source.surfaceLevel - source.heightAt(x, -16)!); };
    const before = await depths(); assert.deepEqual(before, [1.5, 1.5]);
    const spline = world.def.splines![0]!;
    const patches = createTerrainSplinePatches(world, { ...spline, coordinateSpace: "world" }, "deform");
    applyTerrainUndoPatches(world, patches); const baked = await depths(); assert.deepEqual(baked, [3.5, 3.5]);
    revertTerrainUndoPatches(world, patches); assert.deepEqual(await depths(), before);
    applyTerrainUndoPatches(world, patches); assert.deepEqual(await depths(), baked);
  });

  await checkAsync("terrain river: coordinate marker survives save validation and legacy local height stays unchanged", async () => {
    const doc = fixture();
    const saved = validateRiverWater(doc.water);
    assert.equal(saved.coordinateSpace, "world"); assert.equal(saved.surfaceLevel, 9);
    assert.throws(() => validateRiverWater({ ...doc.water, coordinateSpace: "guess" }), /coordinateSpace/);
    const { coordinateSpace: _space, ...legacy } = doc.water;
    const source = await prepareTerrainRiverWaterSource(doc, legacy);
    assert.equal(source.surfaceLevel, 9);
    assert.equal(validateRiverWater(legacy).coordinateSpace, undefined);
  });
}
