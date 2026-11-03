import { expect, test } from "./test";
import { writeFile } from "node:fs/promises";

test("wet mud keeps its base normal and adds static detail in the GPU output", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/__static-detail-probe", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
  await page.goto("/__static-detail-probe");
  const result = await page.evaluate(async () => {
    const threePath = "/node_modules/three/build/three.module.js";
    const { AmbientLight, DirectionalLight, Scene, PerspectiveCamera, Vector3, WebGLRenderer } = await import(threePath);
    const loaderPath = "/src/scene/materialAssets.ts";
    const { loadForgeMaterialLayer } = await import(loaderPath);
    const rendererPath = "/engine/render-three/terrain/terrainRenderer.ts";
    const { TerrainRenderer } = await import(rendererPath);
    const sourcePath = "/engine/terrain/terrainRenderSource.ts";
    const { worldTerrainRenderSource } = await import(sourcePath);
    const typePath = "/engine/terrain/terrainTypes.ts";
    const { createFlatTerrainTile } = await import(typePath);
    const manifest = await (await fetch("/assets/manifest.json")).json();
    const layer = await loadForgeMaterialLayer(manifest,"lt-wet-mud");
    if (!layer?.normalTexture || !layer?.detailNormalTexture || !layer?.terrainDetail) throw new Error("Missing base/detail texture or settings");
    const def = { tileQuads: 32, spacing: 1, tilesX: 1, tilesZ: 1, layers: [{id:"mud"}] };
    const tile = createFlatTerrainTile(def,0,0);
    const terrain = new TerrainRenderer(worldTerrainRenderSource(def,new Map([["0_0",tile]])), {
      viewMode:"lit",activeLayer:0,origin:new Vector3(),
      layers:[{ texture:layer.texture,normalTexture:layer.normalTexture,detailNormalTexture:layer.detailNormalTexture,
        terrainDetail:layer.terrainDetail,uvTiling:layer.uvTiling,color:layer.baseColor,roughness:layer.roughness,roughnessInAlpha:layer.roughnessInAlpha,scale:.125 }],
    });
    const renderer = new WebGLRenderer({antialias:false,preserveDrawingBuffer:true}); renderer.setSize(512,512);
    document.body.append(renderer.domElement);
    const scene = new Scene(); scene.add(terrain.mesh,new AmbientLight(0xffffff,.3));
    const sun = new DirectionalLight(0xffffff,3); sun.position.set(1,1,.3); scene.add(sun);
    const camera = new PerspectiveCamera(45,1,.1,200); camera.position.set(16,6,20); camera.lookAt(16,0,16); camera.updateMatrixWorld();
    for(let i=0;i<4;i++) { terrain.updateLod(camera); renderer.render(scene,camera); }
    const uniforms = terrain.materials.uniforms;
    const gl = renderer.getContext();
    const read = () => { const p=new Uint8Array(512*512*4); gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,p); return p; };
    const enabled = read();
    const enabledPng = renderer.domElement.toDataURL();
    const params = uniforms.uLayerDetailParams.value[0];
    const strength = params.x; params.x=0; renderer.render(scene,camera); const disabled=read();
    const disabledPng = renderer.domElement.toDataURL();
    params.x=strength; renderer.render(scene,camera); const restored=read();
    // Roughness alone must not make this pass: isolate the normal contribution.
    const shape = uniforms.uLayerDetailShape.value[0];
    const roughness = shape.z; shape.z=1; params.x=1; params.y=1;
    terrain.materials.uniforms.uLayerRoughnessInAlpha.value[0]=0;
    terrain.materials.uniforms.uLayerRoughness.value[0]=1;
    renderer.render(scene,camera); const normalsEnabled=read();
    params.x=0; renderer.render(scene,camera); const normalsDisabled=read();
    const diff = (a:Uint8Array,b:Uint8Array) => { let changed=0,delta=0; for(let i=0;i<a.length;i+=4) {
      const d=Math.abs(a[i]!-b[i]!)+Math.abs(a[i+1]!-b[i+1]!)+Math.abs(a[i+2]!-b[i+2]!); if(d>3) changed++; delta+=d;
    } return {changed,delta}; };
    const report={normalIndex:uniforms.uLayerNormalIndex.value[0],detailIndex:uniforms.uLayerDetailIndex.value[0],
      slices:uniforms.uLayerNormalArray.value.image.depth,key:terrain.materials.material.customProgramCacheKey(),
      detail:diff(enabled,disabled),stable:diff(enabled,restored),normalOnly:diff(normalsEnabled,normalsDisabled),glError:gl.getError()};
    shape.z=roughness;
    const material = terrain.materials.material;
    const compile = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader:any,renderer:any) => { compile(shader,renderer); shader.fragmentShader=shader.fragmentShader.replace("#include <opaque_fragment>","gl_FragColor=vec4(forgeLayerNormal*.5+.5,1.);"); };
    material.customProgramCacheKey=()=>key+"-detail-debug"; material.needsUpdate=true;
    uniforms.uLayerNormalIndex.value[0]=-1; params.x=strength; params.y=layer.terrainDetail.coverage;
    renderer.render(scene,camera); const detailNormalPng=renderer.domElement.toDataURL();
    terrain.dispose(); renderer.dispose(); layer.texture?.dispose(); layer.normalTexture.dispose(); layer.detailNormalTexture.dispose();
    return { ...report,enabledPng,disabledPng,detailNormalPng };
  });
  const { enabledPng,disabledPng,detailNormalPng,...stats } = result;
  await writeFile(testInfo.outputPath("mud-with-static-tracks.png"),Buffer.from(enabledPng.split(",")[1]!,"base64"));
  await writeFile(testInfo.outputPath("mud-without-static-tracks.png"),Buffer.from(disabledPng.split(",")[1]!,"base64"));
  await writeFile(testInfo.outputPath("static-detail-normal-debug.png"),Buffer.from(detailNormalPng.split(",")[1]!,"base64"));
  console.log("[static detail]",JSON.stringify(stats));
  expect(errors).toEqual([]);
  expect(result.normalIndex).toBe(0); expect(result.detailIndex).toBe(1); expect(result.slices).toBe(5);
  expect(result.key).toContain("-n1-d1"); expect(result.glError).toBe(0);
  expect(result.detail.changed).toBeGreaterThan(1000);
  expect(result.normalOnly.changed).toBeGreaterThan(1000);
  expect(result.stable.delta).toBe(0);
});
