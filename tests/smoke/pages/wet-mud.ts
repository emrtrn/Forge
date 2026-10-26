import { AmbientLight, BoxGeometry, Color, DirectionalLight, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShaderMaterial, Vector3, Vector4, WebGLRenderer } from "three";
import { loadForgeMaterialLayer } from "@/scene/materialAssets";
import { TerrainRenderer } from "@engine/render-three/terrain/terrainRenderer";
import { TerrainDeformationTexture } from "@engine/render-three/terrain/terrainDeformation";
import { DeformationField } from "@engine/scene/deformationField";
import { worldTerrainRenderSource } from "@engine/terrain/terrainRenderSource";
import { type TerrainTileData } from "@engine/terrain/terrainTypes";
import type { TerrainWaterQuality } from "@engine/render-three/terrain/terrainWater";
import { setSceneDepthMode } from "@engine/render-three/depthMode";

// Uses production terrain, the actual fifth-layer texture and deformation
// field. Only the compact QA scene and readback controls live in this page.
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
const scene = new Scene();
scene.background = new Color("#adc9de");
scene.add(new AmbientLight("#ffffff", 0.8));
const sun = new DirectionalLight("#ffffff", 2.5);
sun.position.set(-4, 6, 2);
scene.add(sun);
const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 200);
camera.position.set(2.5, 3.5, 7);
camera.lookAt(0, -0.12, 0);
camera.updateMatrixWorld(true);
const q = 64, size = q + 1;
const tiles = new Map<string, TerrainTileData>();
for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) {
  const weights = new Uint8Array(size * size * 8);
  for (let v = 0; v < size * size; v++) weights[size * size * 4 + v * 4] = 255;
  tiles.set(`${x}_${z}`, { x, z, size, layerCount: 5, heights: new Float32Array(size * size), weights });
}
const manifest = await (await fetch("/assets/manifest.json")).json();
const mudLayer = await loadForgeMaterialLayer(manifest, "lt-wet-mud");
if (!mudLayer?.texture || !mudLayer.roughnessInAlpha) throw new Error("Wet mud roughness did not load");
const field = new DeformationField();
for (const x of [-1.1, 1.1]) field.stampWheel({ from: [x, -14], to: [x, 14], width: 0.55, contactLength: 0.6, targetDepth: 0.18, compaction: 1, disturbance: 255 });
const deformation = new TerrainDeformationTexture();
deformation.attach(field);
const terrain = new TerrainRenderer(worldTerrainRenderSource({ tileQuads: q, spacing: 0.5, tilesX: 2, tilesZ: 2 }, tiles), {
  viewMode: "lit", activeLayer: 4, origin: new Vector3(-32, 0, -32), slotCapacity: 4, uploadsPerFrame: 4, deformation,
  layers: Array.from({ length: 5 }, (_, i) => ({ texture: i === 4 ? mudLayer.texture : null, color: "#493226", scale: 0.25, roughness: mudLayer.roughness ?? 1, roughnessInAlpha: i === 4, physicalMaterial: i === 4 ? "mud" : null })),
});
scene.add(terrain.mesh);
let wet: number[] | undefined;
let roughnessInAlpha: number[] | undefined;
const compile = terrain.mesh.material.onBeforeCompile;
const debug = { value: 0 };
terrain.mesh.material.onBeforeCompile = (shader, renderer) => {
  compile(shader, renderer);
  shader.uniforms.uWetMudDebug = debug;
  shader.fragmentShader = `uniform float uWetMudDebug;\n${shader.fragmentShader}`.replace("#include <opaque_fragment>", `
    if (uWetMudDebug > 2.5) {
      gl_FragColor = vec4(abs(forgeWaterGradient)*10.0, 1.0, 1.0); return;
    }
    if (uWetMudDebug > 0.5) {
      gl_FragColor = vec4(forgePuddle, roughnessFactor, forgeDeformedWorldNormal(vec3(0.0, 1.0, 0.0)).y, 1.0);
      return;
    }
    #include <opaque_fragment>`);
  wet = shader.uniforms.uDeformLayerWet!.value as number[];
  roughnessInAlpha = shader.uniforms.uLayerRoughnessInAlpha!.value as number[];
};
function draw() { terrain.updateLod(camera); renderer.render(scene, camera); }
function sample() {
  const p = new Vector3(-1.1, -0.18, 0).project(camera);
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  gl.readPixels(Math.round((p.x + 1) * 0.5 * canvas.width), Math.round((p.y + 1) * 0.5 * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return [...pixel];
}
function probes() {
  const gl = renderer.getContext();
  const result: number[] = [];
  for (const z of [-4, -2, 0, 2, 4]) for (const offset of [-0.15, -0.075, 0, 0.075, 0.15]) {
    const x = -1.1 + offset;
    const p = new Vector3(x, -field.sample(x, z).depth, z).project(camera);
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.round((p.x + 1) * 0.5 * canvas.width), Math.round((p.y + 1) * 0.5 * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    result.push(pixel[2]!);
  }
  return result;
}
function surfaceProbes() {
  const gl = renderer.getContext();
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const result: number[] = [];
  for (let y = 32; y < canvas.height; y += 32) for (let x = 32; x < canvas.width; x += 32) {
    const offset = (y * canvas.width + x) * 4;
    result.push(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
  }
  return result;
}
// Orthographic top view isolates shader masks from perspective/occlusion. Raw
// output bypasses tone mapping so R=puddle, G=roughness, B=surface normal Y.
function profile() {
  const top = new OrthographicCamera(-2, 2, 2, -2, 0.05, 40);
  top.position.set(0, 12, 0);
  top.up.set(0, 0, -1);
  top.lookAt(0, 0, 0);
  top.updateMatrixWorld(true);
  debug.value = 1;
  terrain.updateLod(top);
  renderer.render(scene, top);
  const gl = renderer.getContext();
  const result = [-0.5, -0.38, -0.22, -0.1, 0, 0.1, 0.22, 0.38, 0.5].map((offset) => {
    const p = new Vector3(-1.1 + offset, 0, 0).project(top);
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.round((p.x + 1) * 0.5 * canvas.width), Math.round((p.y + 1) * 0.5 * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { offset, puddle: pixel[0]! / 255, roughness: pixel[1]! / 255, normalY: pixel[2]! / 255 };
  });
  debug.value = 0;
  draw();
  return result;
}
function tracks(angle: number, width: number, detail: number) {
  field.decay(10, 1);
  const rotate = (x: number, z: number): [number, number] => [x * Math.cos(angle) + z * Math.sin(angle), -x * Math.sin(angle) + z * Math.cos(angle)];
  for (const x of [-1.1, 1.1]) field.stampWheel({ from: rotate(x, -14), to: rotate(x, 14), heading: angle,
    width, contactLength: 0.6, targetDepth: 0.18, compaction: 1, disturbance: 255 });
  deformation.update(field.takeDirty());
  terrain.setTrackDetailLevels(detail);
  camera.position.set(2.5, 3.5, 7);
  camera.lookAt(0, -0.12, 0);
  camera.updateMatrixWorld(true);
  draw();
}
const marker = new Mesh(new BoxGeometry(0.8, 1.2, 0.8), new MeshBasicMaterial({ color: "#ff1600" }));
marker.position.set(-1.1, 0.6, -2);
const emptyScene = new Scene();
let spin = 0;
function enableDynamics(quality: TerrainWaterQuality) {
  deformation.water.setQuality(quality);
  scene.add(marker);
  const contacts = [];
  for (const x of [-1.1, 1.1]) for (let z = -6; z <= 6; z += 0.25) contacts.push({ id: `seed:${x}:${z}`, x, y: 0, z,
    rotation: 0, width: 0.55, radius: 0.5, wetness: 0.9 });
  deformation.water.advance(1 / 60, contacts, [0, 0], field);
  camera.position.set(-1.1, 1.6, 5);
  camera.lookAt(-1.1, -0.15, 0); camera.updateMatrixWorld(true);
  draw();
  return deformation.water.stats();
}
function pumpWater(frames: number, spinning: boolean) {
  const before = performance.now();
  for (let i = 0; i < frames; i++) {
    if (spinning) spin += 0.3;
    deformation.water.advance(1 / 60, [{ id: "wheel", x: -1.1, y: 0, z: 0, rotation: spin,
      width: 0.55, radius: 0.5, wetness: 0.9 }], [0, 0], field);
    deformation.water.render(renderer, emptyScene, camera,
      deformation.uniforms.uDeformTex!.value as import("three").Texture,
      deformation.uniforms.uDeformWindow!.value as Vector4, deformation.uniforms.uDeformDepthRange!.value as number);
  }
  renderer.getContext().finish();
  const elapsed = performance.now() - before;
  draw();
  return { elapsed, frames, ...deformation.water.stats() };
}
function waveEnergy() {
  debug.value = 3; draw();
  const gl = renderer.getContext();
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let energy = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] === 255) energy += pixels[i]! + pixels[i + 1]!;
  debug.value = 0; draw();
  return energy;
}
function reflectionColor(red: boolean) {
  marker.material.color.set(red ? "#ff1600" : "#0033ff");
  draw();
  const gl = renderer.getContext();
  const result: number[] = [];
  for (let z = -0.5; z < 2; z += 0.1) {
    const p = new Vector3(-1.1, -0.18, z).project(camera);
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.round((p.x + 1) * 0.5 * canvas.width), Math.round((p.y + 1) * 0.5 * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    result.push(...pixel.slice(0, 3));
  }
  return result;
}
function groundColor() {
  draw();
  const gl = renderer.getContext();
  const p = new Vector3(0, 0, 1).project(camera);
  const pixel = new Uint8Array(4);
  gl.readPixels(Math.round((p.x + 1) * 0.5 * canvas.width), Math.round((p.y + 1) * 0.5 * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return [...pixel];
}
function skyLight() {
  const sky = new Scene(); sky.background = new Color("#adc9de");
  const generator = new PMREMGenerator(renderer);
  scene.environment = generator.fromScene(sky, 0, 0.1, 10).texture;
  generator.dispose();
  draw();
  return scene.environment.uuid;
}
function shiftDynamics() {
  deformation.water.advance(1 / 60, [{ id: "wheel", x: -1.1, y: 0, z: 0, rotation: spin, width: 0.55, radius: 0.5, wetness: 0.9 }], [0.5, 0], field);
  draw();
  return waveEnergy();
}
async function benchmarkFrames(frames: number) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const query = ext ? gl.createQuery() : null;
  gl.finish();
  const start = performance.now();
  if (query) gl.beginQuery(ext!.TIME_ELAPSED_EXT, query);
  for (let i = 0; i < frames; i++) {
    deformation.water.advance(1 / 60, [{ id: "wheel", x: -1.1, y: 0, z: 0, rotation: spin, width: 0.55, radius: 0.5, wetness: 0.9 }], [0, 0], field);
    draw();
  }
  if (query) gl.endQuery(ext!.TIME_ELAPSED_EXT);
  gl.finish();
  const wallMs = (performance.now() - start) / frames;
  let gpuMs: number | null = null;
  if (query) {
    for (let i = 0; i < 10 && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE); i++) await new Promise(requestAnimationFrame);
    if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext!.GPU_DISJOINT_EXT)) gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 / frames;
    gl.deleteQuery(query);
  }
  const debugRenderer = gl.getExtension("WEBGL_debug_renderer_info");
  return { wallMs, gpuMs, renderer: debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : "unavailable" };
}
function showCapture() {
  const material = new ShaderMaterial({ uniforms: { capture: deformation.water.uniforms.uTerrainWaterTex },
    vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader: `uniform highp sampler2DArray capture; varying vec2 vUv;
      void main(){ gl_FragColor=texture(capture,vec3(vUv,1.));
        #include <colorspace_fragment>
      }` });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  const captureScene = new Scene(); captureScene.add(quad);
  renderer.render(captureScene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const gl = renderer.getContext();
  const coverage: number[][] = [];
  for (let y = 0.1; y <= 1.1; y += 0.05) {
    const p = new Vector4(-1.1, y, -1.59, 1).applyMatrix4(deformation.water.uniforms.uTerrainWaterMatrices.value[0]!);
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.round(p.x / p.w * canvas.width), Math.round(p.y / p.w * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    coverage.push([...pixel]);
  }
  quad.geometry.dispose(); material.dispose();
  return coverage;
}
let frame = 0;
function loop() { draw(); if (++frame < 20) requestAnimationFrame(loop); else {
  (window as any).__wetMudQa = { ready: true, water(on: boolean) { wet![4] = on ? 0.9 : 0; draw(); return probes(); }, sample, profile, tracks,
    enableDynamics, pumpWater, waveEnergy, reflectionColor, benchmarkFrames, groundColor, skyLight, shiftDynamics, showCapture,
    restoreView: draw,
    reverseDepth: () => { const mode = setSceneDepthMode(renderer, "reversed", { scene, cameras: [camera] }); draw(); return mode; },
    environmentId: () => scene.environment?.uuid,
    releaseDynamics: () => { deformation.detach(); return deformation.water.stats(); },
    dynamicsStats: () => deformation.water.stats(),
    roughness(on: boolean) { roughnessInAlpha![4] = on ? 1 : 0; draw(); return surfaceProbes(); },
    side() { camera.position.set(-2.5, 3.2, 6); camera.lookAt(0, -0.12, 0); camera.updateMatrixWorld(true); draw(); },
    triangles: renderer.info.render.triangles };
} }
loop();
