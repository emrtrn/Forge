import assert from "node:assert/strict";
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { bakeLakeGeometryFoam, foamSource } from "../../engine/render-three/lakeFoamBake";
import { decodeLakeFoam, encodeLakeFoam, lakeFoamPath, validateLakeGeometryFoam } from "../../engine/scene/lakeFoamBake";
import { validateLakeFoamSave } from "../../tools/lakeFoamSaveValidator";
import { validateWaterBody } from "../../engine/scene/waterBody";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { LakeWaterObject } from "../../engine/render-three/lakeWater";

type Check=(label:string,run:()=>Promise<void>)=>Promise<void>;
export async function registerLakeGeometryFoamTests(check:Check):Promise<void> {
  await check("Lake geometry foam: true sections, air/deep rejection, union, transformed copies and cancellation",async()=>{
    const doc=createLakeFixture(),wet=await buildLakeGeometry(await prepareLakeSnapshot(doc,doc.lake));
    const root=new Mesh(new BoxGeometry(4,4,4),new MeshBasicMaterial());
    const source=(id:string,x:number,y:number,z:number)=>foamSource(id,root,new Matrix4().makeTranslation(x,y,z));
    const sources=[source("one",-20,12,-12),source("two",-18,12,-12),source("air",-10,20,-12),source("deep",-10,5,-12)];
    const data=await bakeLakeGeometryFoam(doc.lake,wet,sources,1,"a".repeat(64),new AbortController().signal);
    const sample=(x:number,z:number)=>data.pixels[Math.floor((z+48)/96*data.metadata.nz)*data.metadata.nx+Math.floor((x+48)/96*data.metadata.nx)]!;
    assert.equal(data.metadata.sources,2);assert.ok(data.metadata.segments>=8);
    assert.ok(sample(-15.7,-12)<180,"contact follows the actual outer edge");
    assert.equal(sample(-18,-12),255,"overlapping interior edges cannot generate foam");
    const cluster=new Group(),second=root.clone();second.position.x=2;cluster.add(root.clone(),second);
    const merged=await bakeLakeGeometryFoam(doc.lake,wet,[foamSource("GLTF cluster",cluster,new Matrix4().makeTranslation(-20,12,-12))],1,"a".repeat(64),new AbortController().signal);
    assert.deepEqual(merged.pixels,data.pixels,"overlapping submeshes in one asset form the same union as separate placements");
    assert.equal(sample(0,0),255,"dry island is excluded");assert.equal(sample(-10,-12),255,"air/submerged geometry is excluded");
    const again=await bakeLakeGeometryFoam(doc.lake,wet,sources,1,"a".repeat(64),new AbortController().signal);assert.deepEqual(again.pixels,data.pixels);
    const transform=new Matrix4().makeRotationY(.4).scale({x:-1.5,y:2,z:.5} as import("three").Vector3);transform.setPosition(-20,12,-12);
    const changed=await bakeLakeGeometryFoam(doc.lake,wet,[foamSource("transformed",root,transform)],1,"a".repeat(64),new AbortController().signal);
    assert.ok(changed.pixels.some(v=>v<255));
    const abort=new AbortController();abort.abort();
    await assert.rejects(()=>bakeLakeGeometryFoam(doc.lake,wet,sources,1,"a".repeat(64),abort.signal),/Cancel/);
    await assert.rejects(()=>bakeLakeGeometryFoam(doc.lake,wet,sources,.01,"a".repeat(64),new AbortController().signal),/over-budget/);
    const plane=new Mesh(new PlaneGeometry(4,4),new MeshBasicMaterial());plane.rotation.x=-Math.PI/2;
    const tangent=await bakeLakeGeometryFoam(doc.lake,wet,[foamSource("coplanar",plane,new Matrix4().makeTranslation(-20,12,-12))],1,"a".repeat(64),new AbortController().signal);
    assert.equal(tangent.metadata.segments,0,"coplanar faces do not invent boundaries");root.geometry.dispose();plane.geometry.dispose();
  });
  await check("Lake geometry foam: strict immutable binary, path fencing and runtime shader resource ownership",async()=>{
    const doc=createLakeFixture(),wet=await buildLakeGeometry(await prepareLakeSnapshot(doc,doc.lake));
    const data=await bakeLakeGeometryFoam(doc.lake,wet,[],1,"a".repeat(64),new AbortController().signal),bytes=encodeLakeFoam(data);
    assert.deepEqual(decodeLakeFoam(bytes).pixels,data.pixels);
    assert.throws(()=>decodeLakeFoam(bytes.subarray(0,bytes.length-1)),/length/);
    const broken=bytes.slice();broken[0]=0;assert.throws(()=>decodeLakeFoam(broken),/header/);
    const path=lakeFoamPath("layouts/test.level.json","b".repeat(64));
    assert.ok(lakeFoamPath("Levels/Kaya Gölü.level.json","b".repeat(64)).includes("Kaya Gölü.foam/"));
    assert.equal(validateLakeFoamSave("layouts/test.level.json","b".repeat(64),bytes).path,path);
    for(const bad of ["../test.level.json","/test.level.json","layouts/../test.level.json","C:/test.level.json","layouts/test.json"])
      assert.throws(()=>lakeFoamPath(bad,"b".repeat(64)),/destination/);
    const settings={enabled:true,width:1,strength:.8,scale:1,speed:.3,bake:{manifest:path,fingerprint:"a".repeat(64)}};
    assert.deepEqual(validateWaterBody({...doc.lake,geometryFoam:settings}).geometryFoam,settings);
    for(const patch of [{width:0},{strength:2},{speed:Infinity},{bake:{manifest:"../foo",fingerprint:"x"}}])assert.throws(()=>validateLakeGeometryFoam({...settings,...patch}),/Invalid/);
    const object=new LakeWaterObject({...doc.lake,geometryFoam:settings},wet,null,null,data);
    assert.equal(object.material.defines.FORGE_LAKE_GEOMETRY_FOAM,1);const texture=object.material.uniforms.geometryFoamMask!.value;
    let disposed=false;texture.addEventListener("dispose",()=>{disposed=true;});object.dispose();assert.equal(disposed,true);
    const missing=new LakeWaterObject({...doc.lake,geometryFoam:settings},wet,null);
    assert.equal(missing.material.uniforms.geometryFoamMask!.value,null,"missing bake must not delete the Lake or rebuild geometry");missing.dispose();
    const moved=new LakeWaterObject({...doc.lake,surfaceLevel:doc.lake.surfaceLevel+1,geometryFoam:settings},wet,null,null,data);
    assert.equal(moved.material.uniforms.geometryFoamMask!.value,null,"an old waterline must not move to a new elevation without Recalculate");moved.dispose();
  });
}
