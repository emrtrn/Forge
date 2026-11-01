import * as T from 'three';
import { ForgeGtaoPass } from '../../../engine/render-three/postProcess';
import { LakeWaterObject } from '../../../engine/render-three/lakeWater';
import { RiverWaterObject } from '../../../engine/render-three/riverWater';
import { resolveRiverWater } from '../../../engine/scene/riverWater';
import { createLakeFixture } from '../../engine/fixtures/lakeFixture';
import type { LakeGeometry } from '../../../engine/terrain/terrainLakeWater';
const renderer=new T.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(160,160);document.body.appendChild(renderer.domElement);
const data:LakeGeometry={status:'ready',message:'',position:[0,0,0],escapeLevel:null,
 positions:new Float32Array([-3,0,-3, -3,0,3, 3,0,3, 3,0,-3]),depths:new Float32Array([3,3,3,3]),
 uvs:new Float32Array([0,0,0,1,1,1,1,0]),indices:new Uint32Array([0,1,2,0,2,3]),shore:new Float32Array(),cuts:new Float32Array(),cells:1,bytes:0,buildMs:0};
Object.assign(window,{waterAo:(kind:string,below:boolean,snapshot:boolean)=>{
 const scene=new T.Scene();const camera=new T.PerspectiveCamera(45,1,.1,50);camera.position.set(0,below?-5:5,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);
 const water=kind==='river'?new RiverWaterObject({...resolveRiverWater({id:'river',landscapeRef:'terrain',splineRef:'s',surfaceLevel:0}),
 spline:{id:'s',points:[{id:'a',position:[0,0,-3],width:6,falloff:1},{id:'b',position:[0,0,3],width:6,falloff:1}],segments:[{id:'ab',startPointId:'a',endPointId:'b'}]},
 position:[0,0,0],rotation:[0,0,0],foamNoiseMap:null},null):new LakeWaterObject({...createLakeFixture().lake,surfaceLevel:0,appearance:{surfaceWavesEnabled:kind==='wave',surfaceWaveHeight:.05,foamEnabled:false}},data,null);
 water.position.set(0,0,0);if(water instanceof LakeWaterObject)water.setSurfaceWaveTime(2);
 water.userData.compositedWaterSurface=snapshot;scene.add(water);
 const rear=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial());rear.position.y=below?1.5:-1.5;scene.add(rear);scene.updateMatrixWorld(true);
 const pass=new ForgeGtaoPass(scene,camera,160,160);const input=new T.WebGLRenderTarget(160,160);const target=new T.WebGLRenderTarget(160,160);
 const read=(output:number,hideRear:boolean,enabled:boolean)=>{
  rear.visible=!hideRear;water.userData.aoWaterSurface=enabled;
  // Test the actual normal/depth/AO pass without invoking unrelated water beauty shaders.
  pass.output=output;pass.render(renderer,target,input,0,false);
  const pixels=new Uint8Array(160*160*4);renderer.readRenderTargetPixels(target,0,0,160,160,pixels);return pixels;
 };
 const difference=(a:Uint8Array,b:Uint8Array)=>{let total=0;for(let y=40;y<120;y++)for(let x=40;x<120;x++)for(let c=0;c<3;c++)total+=Math.abs(a[(y*160+x)*4+c]!-b[(y*160+x)*4+c]!);return total;};
 const missing=read(3,false,false);const normal=read(3,false,true);const normalOnly=read(3,true,true);
 const depth=read(2,false,true),depthOnly=read(2,true,true);const ao=read(4,false,true),aoOnly=read(4,true,true);
 rear.position.y=below?-.25:.25;scene.updateMatrixWorld(true);
 const protruding=read(2,false,true);
 const protrusionDifference=difference(protruding,depthOnly);
 rear.position.y=below?1.5:-1.5;scene.updateMatrixWorld(true);
 pass.output=3;pass.render(renderer,target,input,0,false);
 const display=new T.Scene();const displayGeometry=new T.PlaneGeometry(2,2);const displayMaterial=new T.MeshBasicMaterial({map:target.texture});
 display.add(new T.Mesh(displayGeometry,displayMaterial));renderer.setRenderTarget(null);renderer.render(display,new T.Camera());
 displayGeometry.dispose();displayMaterial.dispose();
 const result={protrusionDifference,normalDifference:difference(normal,normalOnly),depthDifference:difference(depth,depthOnly),aoDifference:difference(ao,aoOnly),fallbackChanged:difference(missing,normal),depthWrite:water.material.depthWrite,visible:water.visible};
 pass.dispose();input.dispose();target.dispose();water.dispose();rear.geometry.dispose();rear.material.dispose();return result;
}});
