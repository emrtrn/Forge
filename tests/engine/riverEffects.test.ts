import assert from "node:assert/strict";
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Scene } from "three";
import { RiverWaterObject, buildRiverWaterRibbon, type RiverWaterRenderItem } from "../../engine/render-three/riverWater";
import { RiverSurfaceQuery } from "../../engine/terrain/riverSurface";
import { resolveRiverWater } from "../../engine/scene/riverWater";
import { defaultWaterCaustics } from "../../engine/scene/waterCaustics";
import { defaultLakeGeometryFoam, encodeLakeFoam, decodeLakeFoam } from "../../engine/scene/lakeFoamBake";
import { bakeRiverGeometryFoam, foamSource } from "../../engine/render-three/lakeFoamBake";
import { createTerrainCausticsUniforms, updateTerrainCaustics, registerLakeCaustics } from "../../engine/render-three/terrain/terrainCaustics";
import { createLakeFixture } from "./fixtures/lakeFixture";
import { buildLakeGeometry, prepareLakeSnapshot } from "../../engine/terrain/terrainLakeWater";
import { validateRiverWater } from "../../tools/saveValidator";
import { defaultWaterShoreWetness } from "../../engine/scene/waterShoreWetness";
import { createTerrainShoreWetnessUniforms, updateTerrainShoreWetness, terrainShoreWetnessAt } from "../../engine/render-three/terrain/terrainShoreWetness";

export function riverEffectFixture(origin:[number,number,number]=[0,0,0]):RiverWaterRenderItem {
  return {...resolveRiverWater({id:"river",landscapeRef:"terrain",splineRef:"s",surfaceLevel:2,flowSpeed:.5,waveAmplitude:0,
    caustics:{...defaultWaterCaustics(),enabled:true},geometryFoam:defaultLakeGeometryFoam()}),
    spline:{id:"s",points:[{id:"a",position:[0,0,0],width:4,falloff:1},{id:"b",position:[0,-2,16],width:4,falloff:1}],segments:[{id:"ab",startPointId:"a",endPointId:"b"}]},
    position:origin,rotation:[0,0,0],sampleSpacing:1,heightAt:(x,z)=>Math.abs(x)>3?4:1-z/8,foamNoiseMap:null};
}
export async function registerRiverEffectsTests(check:(label:string,run:()=>Promise<void>)=>Promise<void>):Promise<void> {
  await check("River wet shore: strict save/runtime settings and independent clones",async()=>{
    const shoreWetness={...defaultWaterShoreWetness(),enabled:true,width:1.2,strength:.7};
    const source={...riverEffectFixture(),shoreWetness};
    assert.deepEqual(validateRiverWater(source).shoreWetness,shoreWetness);
    const resolved=resolveRiverWater(source);assert.deepEqual(resolved.shoreWetness,shoreWetness);
    resolved.shoreWetness!.width=3;assert.equal(shoreWetness.width,1.2);
    assert.equal(resolveRiverWater({id:"old",landscapeRef:"t",splineRef:"s"}).shoreWetness,undefined);
    for(const bad of [{enabled:1},{width:0},{width:4.1},{strength:2},{strength:NaN}]) {
      assert.throws(()=>validateRiverWater({...source,shoreWetness:{...shoreWetness,...bad}}),/shore wetness/);
      assert.throws(()=>resolveRiverWater({...source,shoreWetness:{...shoreWetness,...bad}} as unknown as typeof source),/shore wetness/);
    }
  });
  await check("River wet shore: local bank heights, large origins, hidden/terrain gates, shared atlas and quality lifecycle",async()=>{
    for(const origin of [[0,0,0],[1e6,13,-1e6]] as [number,number,number][]) {
      const scene=new Scene(),u={...createTerrainCausticsUniforms(),...createTerrainShoreWetnessUniforms()};
      const base=riverEffectFixture(origin),item={...base,caustics:{...base.caustics!,enabled:false},
        shoreWetness:{...defaultWaterShoreWetness(),enabled:true},heightAt:(x:number,z:number)=>1-z/8+Math.abs(x)*.8};
      const object=new RiverWaterObject(item,null);scene.add(object);
      const update=()=>{updateTerrainCaustics(u,scene,"terrain");updateTerrainShoreWetness(u,scene,"terrain");};
      update();assert.deepEqual(object.effectErrors,[]);assert.equal(u.uShoreWetCount.value,1);
      assert.equal(u.uCausticArea.value[0]!.z,0,"wet shore alone must not turn on caustic light");
      assert.equal(u.uShoreWetRiver.value[0]!.x,0,"wet shore borrows the exact River atlas");
      const samples=[4,12].map(z=>terrainShoreWetnessAt(scene,origin[0]+1.4,origin[1]+1-z/8+1.4*.8,origin[2]+z,"terrain"));
      assert.ok(samples.every(v=>v>.1),`both slopes have a wet bank: ${samples}`);
      assert.ok(Math.abs(samples[0]!-samples[1]!)<.03,"height follows the slope, not a global waterline");
      assert.equal(terrainShoreWetnessAt(scene,origin[0]+1.4,origin[1]-10,origin[2]+4,"terrain"),0);
      assert.equal(terrainShoreWetnessAt(scene,origin[0]+1.4,origin[1]+1.62,origin[2]+4,"other"),0);
      object.visible=false;update();assert.equal(u.uShoreWetParams.value[0]!.w,0);object.visible=true;
      const bytes=(u.uShoreWetMask.value as unknown as {image:{data:Uint8Array}}).image.data.byteLength;
      assert.equal(bytes,1024*1024*2,"same per-body RG atlas budget as Lake");
      for(let cycle=0;cycle<20;cycle++) {
        object.setShoreWetnessAllowed(false);update();assert.equal(u.uShoreWetCount.value,0);assert.equal(u.uRiverCausticData.value,null);
        object.setShoreWetnessAllowed(true);update();assert.equal(u.uShoreWetCount.value,1);
      }
      const texture=u.uShoreWetMask.value as unknown as {addEventListener:(name:string,fn:()=>void)=>void};let disposed=0;
      texture.addEventListener("dispose",()=>disposed++);scene.remove(object);object.dispose();object.dispose();update();
      assert.equal(disposed,1);assert.equal(u.uShoreWetMask.value,null);assert.equal(u.uRiverCausticData.value,null);
    }
  });
  await check("River caustics: replacing a Lake retains the unchanged River atlas and aligned layer uniforms", async () => {
    const scene = new Scene(), u = createTerrainCausticsUniforms();
    const river = new RiverWaterObject(riverEffectFixture(), null); scene.add(river);
    const doc = createLakeFixture(); doc.lake.appearance = { causticsEnabled: true };
    const geometry = await buildLakeGeometry(await prepareLakeSnapshot(doc, doc.lake));
    let release = registerLakeCaustics(scene, doc.lake, geometry, new Group());
    updateTerrainCaustics(u, scene, "terrain");
    const atlas = u.uRiverCausticData.value!, mask = u.uCausticMask.value;
    let disposed = 0; atlas.addEventListener("dispose", () => disposed++);
    const offset = u.uCausticRiver.value[1]!.x;
    for (let i = 0; i < 3; i++) {
      release(); release = registerLakeCaustics(scene, doc.lake, geometry, new Group());
      updateTerrainCaustics(u, scene, "terrain");
      assert.equal(u.uRiverCausticData.value, atlas); assert.equal(u.uCausticMask.value, mask);
      assert.equal(u.uCausticRiver.value[0]!.x, -1, "the first stable layer is the Lake");
      assert.equal(u.uCausticRiver.value[1]!.x, offset, "River offset still addresses its retained atlas");
      assert.equal(disposed, 0);
    }
    release(); updateTerrainCaustics(u, scene, "terrain");
    assert.equal(u.uRiverCausticData.value, atlas); assert.equal(u.uCausticRiver.value[0]!.x, offset);
    river.removeFromParent(); river.dispose(); updateTerrainCaustics(u, scene);
    assert.equal(disposed, 1); assert.equal(u.uRiverCausticData.value, null);
  });
  await check("River effects: exact sloped surface, dry banks, real holes, large origins and flow",async()=>{
    for(const origin of [[0,0,0],[1e6,13,-1e6]] as [number,number,number][]) {
      const item=riverEffectFixture(origin),ribbon=buildRiverWaterRibbon(item.spline,item),q=new RiverSurfaceQuery(ribbon,origin);
      assert.equal(q.sampleAt(origin[0],origin[2]+4)!.level,origin[1]+1.5);
      assert.equal(q.sampleAt(origin[0],origin[2]+12)!.level,origin[1]+.5);
      assert.equal(q.sampleAt(origin[0],origin[2]+4)!.flowZ,1);
      assert.equal(q.sampleAt(origin[0]+4,origin[2]+4),null);
      const hole=buildRiverWaterRibbon(item.spline,{...item,heightAt:(x,z)=>z>7&&z<9?null:item.heightAt!(x,z)});
      assert.equal(new RiverSurfaceQuery(hole,origin).sampleAt(origin[0],origin[2]+8),null);
    }
  });
  await check("River geometry foam: mesh intersection follows slope at both elevations; dry, air and deep reject",async()=>{
    const item=riverEffectFixture(),object=new RiverWaterObject(item,null),surface=object.getSurface();
    const rock=new Mesh(new BoxGeometry(2,1,2),new MeshBasicMaterial());
    const at=(id:string,x:number,y:number,z:number)=>foamSource(id,rock,new Matrix4().makeTranslation(x,y,z));
    const data=await bakeRiverGeometryFoam(surface,[at("upper",0,1.5,4),at("lower",0,.5,12),at("air",0,10,8),at("deep",0,-10,8),at("dry",4,2,8)],.6,"a".repeat(64),new AbortController().signal);
    const sample=(x:number,z:number)=>data.pixels[Math.floor((z-data.metadata.min[1])/(data.metadata.max[1]-data.metadata.min[1])*data.metadata.nz)*data.metadata.nx+Math.floor((x-data.metadata.min[0])/(data.metadata.max[0]-data.metadata.min[0])*data.metadata.nx)]!;
    assert.ok(sample(1.2,4)<180,"upper actual waterline");assert.ok(sample(1.2,12)<180,"lower actual waterline; no flat-level assumption");
    assert.equal(sample(0,8),255,"air and deep rocks contribute no contact");assert.equal(sample(3.9,8),255,"dry bank excluded");
    const decoded=decodeLakeFoam(encodeLakeFoam(data));assert.equal(decoded.metadata.surface,"river");assert.deepEqual(decoded.pixels,data.pixels);
    const shown=new RiverWaterObject({...item,bakedFoam:decoded},null);assert.ok(shown.material.uniforms.geometryFoamMask!.value);
    assert.equal(shown.material.uniforms.contactCount!.value,0,"manual sources retired");
    assert.equal(shown.children.length,0);let disposed=false;shown.material.uniforms.geometryFoamMask!.value.addEventListener("dispose",()=>{disposed=true;});shown.dispose();assert.ok(disposed);
    const changed=new RiverWaterObject({...item,surfaceLevel:3,bakedFoam:decoded},null);assert.equal(changed.material.uniforms.geometryFoamMask!.value,null,"old waterline cannot move to a changed spline");changed.dispose();
    const abort=new AbortController();abort.abort();await assert.rejects(()=>bakeRiverGeometryFoam(surface,[],.6,"a".repeat(64),abort.signal),/Cancel/);
    object.dispose();rock.geometry.dispose();rock.material.dispose();
  });
  await check("River caustics: exact atlas ownership, terrain and visibility gate, scene removal, repeated disposal",async()=>{
    const scene=new Scene(),u=createTerrainCausticsUniforms();
    for(let cycle=0;cycle<20;cycle++) {
      const object=new RiverWaterObject(riverEffectFixture(),null);scene.add(object);updateTerrainCaustics(u,scene,"terrain");
      assert.equal(u.uCausticCount.value,1);assert.equal(u.uRiverCausticCount.value,1);assert.ok(u.uRiverCausticData.value);
      assert.ok(u.uCausticArea.value[0]!.z>0);assert.equal(u.uCausticRiver.value[0]!.w,.5);
      object.visible=false;updateTerrainCaustics(u,scene,"terrain");assert.equal(u.uCausticArea.value[0]!.z,0);
      object.visible=true;updateTerrainCaustics(u,scene,"other");assert.equal(u.uCausticArea.value[0]!.z,0);
      let disposed=false;u.uRiverCausticData.value!.addEventListener("dispose",()=>{disposed=true;});scene.remove(object);object.dispose();object.dispose();
      updateTerrainCaustics(u,scene,"terrain");assert.equal(u.uCausticCount.value,0);assert.equal(u.uRiverCausticData.value,null);assert.ok(disposed);
    }
    const saved=validateRiverWater(riverEffectFixture());assert.deepEqual(saved.caustics,riverEffectFixture().caustics);assert.deepEqual(saved.geometryFoam,defaultLakeGeometryFoam());
    for(const patch of [{enabled:"yes"},{scale:0},{speed:NaN},{depthFade:31}])assert.throws(()=>validateRiverWater({...riverEffectFixture(),caustics:{...defaultWaterCaustics(),...patch}}));
  });
}
