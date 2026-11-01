import * as T from 'three';
import { ForgeGtaoPass } from '../../../engine/render-three/postProcess';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
const renderer = new T.WebGLRenderer({ preserveDrawingBuffer: true });
renderer.setSize(320, 240); document.body.appendChild(renderer.domElement);
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(45, 320 / 240, .1, 20);
camera.position.z = 5;
const texture = new T.DataTexture(new Uint8Array([255,255,255,255, 255,255,255,0]), 2,1);
texture.magFilter = T.NearestFilter; texture.needsUpdate = true;
const leaf = new T.Mesh(new T.PlaneGeometry(3,2), new T.MeshBasicMaterial({side:T.DoubleSide,map:texture,alphaTest:.5}));
leaf.rotation.y = Math.PI; scene.add(leaf);
const rear = new T.Mesh(new T.BoxGeometry(2,1,1),new T.MeshBasicMaterial()); rear.position.z=-1; rear.rotation.y=.5;scene.add(rear);
const target = new T.WebGLRenderTarget(320,240);
const beauty = new T.WebGLRenderTarget(320,240);
Object.assign(window, { runAo: (fixed: boolean, output: number, options: {front?: boolean; hideRear?: boolean; hideLeaf?: boolean; opaque?: boolean} = {}) => {
 leaf.rotation.y = options.front ? 0 : Math.PI; rear.visible = !options.hideRear; leaf.visible = !options.hideLeaf;
 leaf.material.map = options.opaque ? null : texture; leaf.material.needsUpdate = true;
 const pass = fixed ? new ForgeGtaoPass(scene,camera,320,240) : new GTAOPass(scene,camera,320,240);
 pass.output = output;
 renderer.setRenderTarget(beauty); renderer.render(scene,camera);
 pass.render(renderer,target,beauty,0,false);
 const pixels = new Uint8Array(320*240*4); renderer.readRenderTargetPixels(target,0,0,320,240,pixels);
 // Display exactly the output read above.
 const display = new T.Scene();const mat = new T.MeshBasicMaterial({map:target.texture});const geo = new T.PlaneGeometry(2,2);display.add(new T.Mesh(geo,mat));
 renderer.setRenderTarget(null); renderer.render(display,new T.Camera());
 const sample=(x:number,y:number)=>Array.from(pixels.slice((y*320+x)*4,(y*320+x)*4+4));
 const result={left:sample(125,120),right:sample(195,120),calls:renderer.info.render.calls,programs:renderer.info.programs?.length};
 pass.dispose();geo.dispose();mat.dispose();return result;
}});
Object.assign(window, { benchAo: () => {
 const results = [];
 for (let pair=0;pair<3;pair++) for(const fixed of [false,true]) {
  const pass=fixed?new ForgeGtaoPass(scene,camera,320,240):new GTAOPass(scene,camera,320,240);
  pass.output=4; const samples:number[]=[];
  for(let frame=0;frame<70;frame++) {
   const start=performance.now();pass.render(renderer,target,beauty,0,false);
   const elapsed=performance.now()-start;if(frame>=10)samples.push(elapsed);
  }
  samples.sort((a,b)=>a-b);
  results.push({pair,fixed,cpuSubmitMedianMs:samples[30],cpuSubmitP95Ms:samples[57],lastRenderCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,programs:renderer.info.programs?.length,memory:{...renderer.info.memory}});
  pass.dispose();
 }
 const gl=renderer.getContext();
 return {results,renderer:gl.getParameter(gl.RENDERER),gpuTimerAvailable:!!gl.getExtension('EXT_disjoint_timer_query_webgl2'),note:'CPU submission time only; no GPU timing or RTX acceptance. Tiny scene only.'};
}});
