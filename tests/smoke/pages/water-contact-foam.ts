import { AmbientLight, Color, DirectionalLight, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, WebGLRenderer } from "three";
import { bakeLakeGeometryFoam, bakeRiverGeometryFoam, foamSource } from "@engine/render-three/lakeFoamBake";
import { defaultLakeGeometryFoam } from "@engine/scene/lakeFoamBake";
import { RiverWaterObject } from "@engine/render-three/riverWater";
import { resolveRiverWater } from "@engine/scene/riverWater";
import { defaultWaterContactFoam } from "@engine/scene/waterContactFoam";
import { LakeWaterObject } from "@engine/render-three/lakeWater";
import { createLakeFixture } from "../../engine/fixtures/lakeFixture";
import { buildLakeGeometry, prepareLakeSnapshot } from "@engine/terrain/terrainLakeWater";
import { FULL_LAKE_QUALITY } from "@engine/perf/lakeQuality";
import type { LakeFoamData } from "@engine/scene/lakeFoamBake";

const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(800,600); document.body.append(renderer.domElement);
const scene=new Scene(); scene.background=new Color("#263438");
scene.add(new AmbientLight(0xffffff,1.5));
const sun=new DirectionalLight(0xffffff,3); sun.position.set(8,20,8); scene.add(sun);
const camera=new PerspectiveCamera(45,800/600,.1,200);
const contactFoam={...defaultWaterContactFoam(),enabled:true,obstacles:[
  {id:"round",kind:"ellipse" as const,position:[0,-.25,5] as [number,number,number],radii:[1,1] as [number,number],rotation:0,halfHeight:1,width:.4,strength:1,wakeLength:6},
  {id:"long",kind:"capsule" as const,position:[0,-.65,13] as [number,number,number],radii:[1.8,.6] as [number,number],rotation:30,halfHeight:1,width:.4,strength:1,wakeLength:5},
]};
const riverItem={...resolveRiverWater({id:"river",landscapeRef:"terrain",splineRef:"spline",flowSpeed:1,foamOpacity:1,waveAmplitude:0,contactFoam}),
  spline:{id:"spline",points:[{id:"a",position:[0,0,0],width:5,falloff:2},{id:"b",position:[0,-1,20],width:5,falloff:2}],segments:[{id:"ab",startPointId:"a",endPointId:"b"}]},
  position:[0,0,0],rotation:[0,0,0],sampleSpacing:.5,heightAt:(x:number,z:number)=>-z/20+Math.abs(x)-3,foamNoiseMap:null} satisfies import("@engine/render-three/riverWater").RiverWaterRenderItem;
let water=new RiverWaterObject(riverItem,null);
scene.add(water);
const riverRocks:Mesh[]=[];
for(const o of contactFoam.obstacles) {
  const stone=new Mesh(new SphereGeometry(1,24,16),new MeshStandardMaterial({color:0x665c4d,roughness:.9}));
  stone.position.set(...o.position);stone.scale.set(o.radii[0],o.halfHeight,o.radii[1]);stone.rotation.y=-o.rotation*Math.PI/180;scene.add(stone);riverRocks.push(stone);
}
const riverBake=await bakeRiverGeometryFoam(water.getSurface(),riverRocks.map((rock,i)=>foamSource(`river-${i}`,rock,new Matrix4())),.4,"b".repeat(64),new AbortController().signal);
water.removeFromParent();water.dispose();water=new RiverWaterObject({...riverItem,geometryFoam:defaultLakeGeometryFoam(),bakedFoam:riverBake},null);scene.add(water);
let time=0;
let lakeBake:LakeFoamData;
const before=water.onBeforeRender;
water.onBeforeRender=(...args)=>{before.apply(water,args);water.material.uniforms.time!.value=time;};
const doc=createLakeFixture();
doc.lake.contactFoam={...contactFoam,obstacles:contactFoam.obstacles.map((o,i)=>({...o,position:[-20+i*6,12,-12]}))};
doc.lake.appearance={surfaceWavesEnabled:false,foamOpacity:1};
const lakeGeometry=await buildLakeGeometry(await prepareLakeSnapshot(doc,doc.lake));
let lake=new LakeWaterObject(doc.lake,lakeGeometry,null);
const lakeScene=new Scene();lakeScene.background=new Color("#263438");lakeScene.add(lake,new AmbientLight(0xffffff,1.5),sun.clone());
const bed=new Mesh(new PlaneGeometry(128,128),new MeshStandardMaterial({color:0x807058,roughness:1}));bed.rotation.x=-Math.PI/2;bed.position.y=10;lakeScene.add(bed);
const lakeRocks:Mesh[]=[];
for(const o of doc.lake.contactFoam.obstacles) {
  const stone=new Mesh(new SphereGeometry(1,24,16),new MeshStandardMaterial({color:0x665c4d,roughness:.9}));
  stone.position.set(...o.position);stone.scale.set(o.radii[0],o.halfHeight,o.radii[1]);stone.rotation.y=-o.rotation*Math.PI/180;lakeScene.add(stone);lakeRocks.push(stone);
}
const beforeLake=lake.onBeforeRender;lake.onBeforeRender=(...args)=>{beforeLake.apply(lake,args);lake.material.uniforms.time!.value=time;};
(window as any).__contactQA={frame(enabled=true,t=0,reverse=false) {
  time=t; water.material.uniforms.geometryFoamStrength!.value=enabled?1:0;
  water.material.uniforms.hasRealShore!.value=enabled?1:0;
  // Both frames use the new path, with individual sources disabled for the baseline.
  camera.position.set(reverse?-15:15,20,reverse?-8:28);camera.lookAt(0,-.5,10);camera.updateMatrixWorld(true);
  renderer.render(scene,camera);
  const gl=renderer.getContext(),pixels=new Uint8Array(800*600*4);gl.readPixels(0,0,800,600,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const samples=[];for(let i=0;i<pixels.length;i+=16)samples.push(pixels[i],pixels[i+1],pixels[i+2]);
  return {samples,error:gl.getError(),calls:renderer.info.render.calls,contacts:water.material.uniforms.contactCount!.value,
    baked:!!water.material.uniforms.geometryFoamMask!.value,shore:!!water.material.uniforms.realShoreMask!.value,flow:Array.from(water.geometry.getAttribute("flowDirection").array.slice(0,2))};
},async geometryBake() {
  const data=await bakeLakeGeometryFoam(doc.lake,lakeGeometry,lakeRocks.map((rock,i)=>foamSource(`rock-${i}`,rock,new Matrix4())),.4,"a".repeat(64),new AbortController().signal);
  lakeBake=data;
  lake.removeFromParent();lake.dispose();
  lake=new LakeWaterObject({...doc.lake,geometryFoam:defaultLakeGeometryFoam()},lakeGeometry,null,null,data);lakeScene.add(lake);
  const before=lake.onBeforeRender;lake.onBeforeRender=(...args)=>{before.apply(lake,args);lake.material.uniforms.time!.value=time;};
  return {metadata:data.metadata,nonempty:data.pixels.some(v=>v<255)};
},lakeFrame(enabled=true,t=0,reverse=false) {
  time=t;
  lake.material.uniforms.geometryFoamStrength!.value=enabled?1:0;
  camera.position.set(reverse?-28:-8,23,reverse?-25:1);camera.lookAt(-17,12,-12);camera.updateMatrixWorld(true);
  renderer.render(lakeScene,camera);
  const gl=renderer.getContext(),pixels=new Uint8Array(800*600*4);gl.readPixels(0,0,800,600,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const samples=[];for(let i=0;i<pixels.length;i+=16)samples.push(pixels[i],pixels[i+1],pixels[i+2]);
  return {samples,error:gl.getError(),calls:renderer.info.render.calls};
},materialState() {
  const a=lake.material.uniforms,b=water.material.uniforms,texture=a.waterFoamMap!.value;
  return {lakeReady:a.waterFoamReady!.value,riverReady:b.waterFoamReady!.value,
    shared:!!texture&&texture===b.waterFoamMap!.value,width:texture?.image?.width,height:texture?.image?.height,
    textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries};
},materialView(kind:"lake"|"river",t=3,lighting:"day"|"shadow"|"night"="day",far=false,reverse=false,foamEnabled=true) {
  time=t;
  lake.material.uniforms.geometryFoamStrength!.value=foamEnabled?1:0;
  water.material.uniforms.foamOpacity!.value=foamEnabled?1:0;
  const active=kind==="lake"?lakeScene:scene;
  active.traverse(o=>{if(o instanceof AmbientLight)o.intensity=lighting==="night"?0:.65;
    if(o instanceof DirectionalLight)o.intensity=lighting==="day"?2.2:0;});
  const focus=kind==="lake"?[-20,12,-12]:[0,-.25,5];
  const distance=far?22:3.8;
  camera.position.set(focus[0]!+(reverse?-1:1)*distance,focus[1]!+distance*.75,focus[2]!+distance);
  camera.lookAt(focus[0]!,focus[1]!,focus[2]!);camera.updateMatrixWorld(true);renderer.render(active,camera);
  const gl=renderer.getContext(),pixels=new Uint8Array(800*600*4);gl.readPixels(0,0,800,600,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const samples=[];for(let i=0;i<pixels.length;i+=16)samples.push(pixels[i],pixels[i+1],pixels[i+2]);
  return {samples,error:gl.getError(),calls:renderer.info.render.calls};
},materialCycles(count=20) {
  const original=water.material.uniforms.waterFoamMap!.value;
  let isolated=true;
  for(let i=0;i<count;i++) {
    lake.applyQuality({...FULL_LAKE_QUALITY,foamAllowed:false},null,lakeBake);
    isolated&&=lake.material.uniforms.waterFoamMap!.value===null&&water.material.uniforms.waterFoamMap!.value===original;
    lake.applyQuality(FULL_LAKE_QUALITY,null,lakeBake);renderer.render(lakeScene,camera);
    isolated&&=lake.material.uniforms.waterFoamMap!.value===original;
  }
  return {isolated,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries};
},disposeMaterialScene() {
  const textures=new Set([lake.material.uniforms.waterFoamMap!.value,lake.material.uniforms.geometryFoamMask!.value,
    water.material.uniforms.geometryFoamMask!.value,water.material.uniforms.realShoreMask!.value].filter(Boolean));
  let disposed=0;for(const texture of textures)texture.addEventListener("dispose",()=>disposed++);
  lake.removeFromParent();water.removeFromParent();lake.dispose();water.dispose();renderer.render(lakeScene,camera);
  return {textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,owned:textures.size,disposed};
}};
await (window as any).__contactQA.geometryBake();
(window as any).__contactQA.frame();
