import { Group, Scene, Vector4 } from "three";
import { registerLakeShoreWetness, createTerrainShoreWetnessUniforms, terrainShoreWetnessAt, updateTerrainShoreWetness } from "../../engine/render-three/terrain/terrainShoreWetness";
import assert from "node:assert/strict";
import { createLakeFoamMask, createWaterContactUniforms, createWaterShoreMask, riverContactSegments, riverContactSettings } from "../../engine/render-three/waterFoam";
import { defaultWaterContactFoam, validateWaterContactFoam } from "../../engine/scene/waterContactFoam";
import { validateRiverWater } from "../../tools/saveValidator";
import { resolveRiverWater } from "../../engine/scene/riverWater";
import { moveWorldTerrain } from "../../engine/terrain/worldTerrainMove";
import { prepareTerrainRiverWaterSource } from "../../engine/terrain/terrainRiverWater";
import { RiverWaterObject } from "../../engine/render-three/riverWater";
import { LakeWaterObject } from "../../engine/render-three/lakeWater";
import { validateWaterBody, resolveLakeAppearance } from "../../engine/scene/waterBody";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { createLakeFixture } from "./fixtures/lakeFixture";

type Check = (label: string, run: () => Promise<void>) => Promise<void>;
export async function registerWaterFoamTests(check: Check): Promise<void> {
  await check("Water contact foam: shared strict save/runtime schema, old defaults and independent clones", async () => {
    const contactFoam = { ...defaultWaterContactFoam(), enabled: true, obstacles: [{ id: "rock", kind: "ellipse" as const,
      position: [-20,12,-12] as [number,number,number], radii: [2,1] as [number,number], rotation: 30, halfHeight: 1,
      width: .3, strength: .8, wakeLength: 4 }] };
    const doc = createLakeFixture();
    assert.deepEqual(validateWaterBody({ ...doc.lake, contactFoam }).contactFoam, contactFoam);
    const river = { id: "river", landscapeRef: "terrain", splineRef: "spline", contactFoam };
    assert.deepEqual(validateRiverWater(river).contactFoam, contactFoam);
    assert.deepEqual(resolveRiverWater(river).contactFoam, contactFoam);
    resolveRiverWater(river).contactFoam!.obstacles[0]!.position[0] = 999;
    assert.equal(contactFoam.obstacles[0]!.position[0], -20);
    assert.equal(resolveRiverWater({ ...river, contactFoam: undefined } as unknown as typeof river).contactFoam, undefined);
    for (const bad of [{ ...contactFoam, enabled: 1 }, { ...contactFoam, obstacles: Array(17).fill(contactFoam.obstacles[0]) },
      { ...contactFoam, obstacles: [...contactFoam.obstacles,...contactFoam.obstacles] },
      ...[{ position: [NaN,0,0] }, { radii: [0,1] }, { halfHeight: -1 }, { hidden: "yes" }, { wakeLength: 31 }].map(patch => ({ ...contactFoam, obstacles: [{ ...contactFoam.obstacles[0], ...patch }] }))]) {
      assert.throws(() => validateWaterContactFoam(bad), /Invalid contact foam/);
      assert.throws(() => validateRiverWater({ ...river, contactFoam: bad }), /Invalid contact foam/);
      assert.throws(() => validateWaterBody({ ...doc.lake, contactFoam: bad }), /Invalid contact foam/);
    }
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    const object = new LakeWaterObject({ ...doc.lake, contactFoam }, geometry, null);
    assert.equal(object.material.uniforms.contactCount!.value, 1);
    object.dispose();
    for(const position of [[0,14,0], [30,14,0], [-20,30,-12], [-20,0,-12]]) {
      const invalid = new LakeWaterObject({ ...doc.lake, contactFoam: { ...contactFoam, obstacles: [{ ...contactFoam.obstacles[0]!, position: position as [number,number,number] }] } },geometry,null);
      assert.equal(invalid.material.uniforms.contactCount!.value,0,"dry island, disconnected basin, air and submerged sources rejected"); invalid.dispose();
    }
    const uniforms = createWaterContactUniforms(contactFoam,[-1e6,0,-1e6]);
    assert.equal(uniforms.contactCentre.value[0]!.x,1e6-20);
    assert.equal(createWaterContactUniforms({ ...contactFoam, enabled: false }).contactCount.value,0);
    assert.equal(createWaterContactUniforms({ ...contactFoam, obstacles: [{ ...contactFoam.obstacles[0]!, hidden: true }] }).contactCount.value,0);
    const moved=moveWorldTerrain(doc.def,"terrain",[{...doc.lake,contactFoam}],[5,3,7],[{...river,coordinateSpace:"world"}]);
    assert.deepEqual(moved.lakes[0]!.contactFoam!.obstacles[0]!.position,[-15,15,-5]);
    assert.deepEqual(moved.rivers[0]!.contactFoam!.obstacles[0]!.position,[-15,15,-5]);
    assert.deepEqual(contactFoam.obstacles[0]!.position,[-20,12,-12],"moves never mutate source/undo state");
    doc.def.splines=[{id:"spline",coordinateSpace:"world",points:[{id:"a",position:[-20,12,-12],width:4,falloff:2},{id:"b",position:[20,12,-12],width:4,falloff:2}],segments:[{id:"ab",startPointId:"a",endPointId:"b"}]}];
    const source=await prepareTerrainRiverWaterSource(doc,resolveRiverWater({...river,coordinateSpace:"world",surfaceLevel:12}));
    assert.deepEqual(source.contactFoam!.obstacles[0]!.position,[-20,2,-12],"world proxies resolve in the exact same local frame as river geometry");
  });
  await check("River contact foam: real wet/dry contours, submerged ribbon/hole exclusion, distance field and source gate", async () => {
    const positions = [0,2,0, 4,3,0, 0,2,4, 4,3,4], indices=[0,1,2,1,3,2];
    const depths=[1,-1,1,-1];
    const shore=riverContactSegments(positions,depths,indices);
    assert.equal(shore.length,8);
    for(let i=0;i<shore.length;i+=2) assert.equal(shore[i],2);
    assert.deepEqual(riverContactSegments(positions,[1,1,1,1],indices),[],"ribbon edges are not shores");
    assert.deepEqual(riverContactSegments(positions,depths,[]),[],"holes are not shores");
    const mask=createWaterShoreMask([0,0],[4,4],shore,.4);
    assert.equal(mask.image.width,40); assert.ok(mask.image.data.some(v=>v<64)); mask.dispose();
    const settings = { ...defaultWaterContactFoam(), enabled:true, obstacles:[{ id:"pier",kind:"capsule" as const,position:[1,2.25,1] as [number,number,number],radii:[1,.5] as [number,number],halfHeight:1,rotation:0,width:.2,strength:1,wakeLength:5 }] };
    assert.equal(riverContactSettings(settings,positions,depths,indices)!.obstacles.length,1);
    for(const position of [[3,2.75,1],[10,2,10],[1,10,1]]) assert.equal(riverContactSettings({ ...settings,obstacles:[{ ...settings.obstacles[0]!,position:position as [number,number,number] }] },positions,depths,indices)!.obstacles.length,0);
    const object=new RiverWaterObject({...resolveRiverWater({id:"river",landscapeRef:"terrain",splineRef:"spline",contactFoam:settings}),
      spline:{id:"spline",points:[{id:"a",position:[0,0,0],width:4,falloff:1},{id:"b",position:[0,0,8],width:4,falloff:1}],segments:[{id:"ab",startPointId:"a",endPointId:"b"}]},
      position:[0,0,0],rotation:[0,0,0],foamNoiseMap:null,heightAt:x=>Math.abs(x)-2},null);
    const texture=object.material.uniforms.realShoreMask!.value;
    assert.ok(texture);let disposed=false;texture.addEventListener("dispose",()=>{disposed=true;});
    assert.equal(object.children.length,0,"obstacles add no overlay meshes/draws");object.dispose();assert.equal(disposed,true);
  });
  await check("Lake wet shore: reversible scene ownership, visibility, terrain binding and unchanged terrain data", async () => {
    const doc = createLakeFixture(); doc.lake.appearance = { shoreWetnessEnabled: true };
    const before = [...doc.tiles.values()].map(tile => tile.heights.slice());
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    const scene = new Scene(), object = new Group(); scene.add(object);
    const release = registerLakeShoreWetness(scene, doc.lake, geometry, object);
    const uniforms = createTerrainShoreWetnessUniforms();
    updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(uniforms.uShoreWetCount.value, 1);
    assert.equal(uniforms.uShoreWetWidths.value[0], resolveLakeAppearance(doc.lake).shoreWetnessWidth, "puddle fade distance uses metres, independent of authored wet-shore width");
    const texture = uniforms.uShoreWetMask.value as unknown as import("three").DataArrayTexture;
    assert.equal(texture.image.data!.length, 1024 * 1024 * 2);
    assert.ok(texture.image.data!.some((v, i) => i % 2 === 0 && v < 255));
    const grid = uniforms.uShoreWetGrid.value[0]!;
    const connected = (x: number, z: number) => {
      const gx = (x - grid.x) * grid.z, gz = (z - grid.y) * grid.z;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      if (ix < 0 || iz < 0 || ix >= grid.w || iz >= uniforms.uShoreWetRows.value[0]!) return false;
      const flags = texture.image.data![(iz * grid.w + ix) * 2 + 1]!;
      return (flags & (gx - ix + gz - iz <= 1 ? 1 : 2)) !== 0;
    };
    assert.equal(connected(-20, -12), true, "deep connected bed is wet");
    assert.equal(connected(0, 0), false, "dry island is outside the connected water");
    assert.equal(connected(30, 0), false, "separate basin below water level stays dry");
    assert.equal(connected(-60, 0), false, "outside grid must not wrap");
    assert.equal((uniforms.uShoreWetBounds.value as Vector4[])[0]!.x, -49, "mask extends onto dry side of bounds");
    assert.ok(uniforms.uShoreWetParams.value[0]!.w > 0);
    // CPU mirror (wet tyre prints): on a shore point just above the level it
    // reads the full strength; farther, higher or below the level it is dry.
    const level = doc.lake.surfaceLevel, strength = resolveLakeAppearance(doc.lake).shoreWetnessStrength;
    const shoreX = geometry.shore[0]! + geometry.position[0], shoreZ = geometry.shore[1]! + geometry.position[2];
    assert.ok(Math.abs(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ) - strength) < 0.05, "shore line reads full strength");
    const raised = terrainShoreWetnessAt(scene, shoreX, level + 0.2, shoreZ);
    assert.ok(raised > 0 && Math.abs(raised - strength * 0.584) < 0.03, "the shader's height falloff (1 - smoothstep(0.08, 0.35, 0.2))");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.4, shoreZ), 0, "dry past the height band");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level - 0.1, shoreZ), 0, "below the level is the Lake's own query");
    assert.equal(terrainShoreWetnessAt(scene, 500, level, 500), 0, "outside the padded bounds");
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ, "another-terrain"), 0, "bound to its terrain");
    object.visible = false; updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(uniforms.uShoreWetParams.value[0]!.w, 0);
    assert.equal(terrainShoreWetnessAt(scene, shoreX, level + 0.02, shoreZ), 0, "hidden Lake shows no wet shore");
    object.visible = true; updateTerrainShoreWetness(uniforms, scene, "another-terrain");
    assert.equal(uniforms.uShoreWetParams.value[0]!.w, 0);
    let disposed = false; texture.addEventListener("dispose", () => { disposed = true; });
    release(); release(); updateTerrainShoreWetness(uniforms, scene, "terrain");
    assert.equal(disposed, true); assert.equal(uniforms.uShoreWetCount.value, 0); assert.equal(uniforms.uShoreWetMask.value, null);
    [...doc.tiles.values()].forEach((tile, i) => assert.deepEqual(tile.heights, before[i]));
    assert.equal(resolveLakeAppearance(createLakeFixture().lake).shoreWetnessEnabled, false);
  });
  await check("Lake foam: distance uses real shore/islands and is invariant at large origins", async () => {
    let baseline: Uint8Array | undefined;
    for (const offset of [0, 1_000_000]) {
      const doc = createLakeFixture([-64 + offset, 10, -64 + offset]);
      const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
      assert.equal(geometry.status, "ready");
      const mask = createLakeFoamMask(doc.lake, geometry, 1);
      const image = mask.image;
      const sample = (x: number, z: number) => image.data[Math.floor((z + 48) / 96 * image.height) * image.width + Math.floor((x + 48) / 96 * image.width)]!;
      assert.ok(sample(-31.9, 0) < 100, "outer shoreline must have contact distance");
      assert.ok(sample(6.2, 0) < 100, "island shoreline must have contact distance");
      assert.equal(sample(-20, 0), 255, "deep water away from shore must not get a foam band");
      if (baseline) assert.deepEqual(image.data, baseline);
      baseline = image.data.slice(); mask.dispose();
    }
  });
  await check("Lake foam: old defaults, strict shared appearance allowlist and sampling budget", async () => {
    const doc = createLakeFixture();
    assert.equal(resolveLakeAppearance(doc.lake).foamEnabled, false);
    const appearance = { foamEnabled: true, foamOpacity: 0.6, foamWidth: 1.2, foamScale: 0.5, foamSpeed: 0.3, shoreBlendDepth: 0.4, shoreWetnessEnabled: true, shoreWetnessWidth: 1.2, shoreWetnessStrength: 0.7, surfaceStrength: 1.1, surfaceRoughness: 0.2,
      wheelWetTrailEnabled: false, wheelWetTrailLength: 2.5, wheelWetTrailStrength: 0.6, wheelWetTrailDrySeconds: 90 };
    assert.deepEqual(validateWaterBody({ ...doc.lake, appearance }).appearance, appearance);
    for (const appearance of [{ surfaceStrength: 3 }, { surfaceRoughness: 0 }, { surfaceRoughness: NaN }, { shoreWetnessEnabled: 1 }, { shoreWetnessWidth: 0 },
      { wheelWetTrailEnabled: "no" }, { wheelWetTrailLength: 0.2 }, { wheelWetTrailLength: 11 }, { wheelWetTrailStrength: 1.2 }, { wheelWetTrailDrySeconds: 2 }, { wheelWetTrailDrySeconds: NaN }, { shoreWetnessStrength: 2 }, { shoreBlendDepth: -1 }, { shoreBlendDepth: 3 }, { shoreBlendDepth: NaN }, { foamEnabled: "yes" }, { foamWidth: 0 }, { foamWidth: 5 }, { foamOpacity: 1.1 }, { foamScale: Infinity }, { foamSpeed: -1 }]) {
      assert.throws(() => validateWaterBody({ ...doc.lake, appearance }), /Invalid Lake|finite/);
    }
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    assert.throws(() => createLakeFoamMask(doc.lake, geometry, 0.2), /over-budget/);
    const object = new LakeWaterObject({ ...doc.lake, appearance }, geometry, null);
    const texture = object.material.uniforms.foamMask!.value;
    assert.ok(texture); assert.equal(object.receiveShadow, true);
    let disposed = false; texture.addEventListener("dispose", () => { disposed = true; });
    object.dispose(); assert.equal(disposed, true);
    const old = new LakeWaterObject(doc.lake, geometry, null);
    assert.equal(old.material.uniforms.surfaceStrength!.value, 1);
    assert.equal(old.material.uniforms.surfaceRoughness!.value, 0.22);
    assert.equal(old.receiveShadow, true);
    assert.equal(old.material.uniforms.foamMask!.value, null); old.dispose();
  });
}
