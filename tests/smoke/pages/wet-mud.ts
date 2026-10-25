import { AmbientLight, Color, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { loadForgeMaterialLayer } from "@/scene/materialAssets";
import { TerrainRenderer } from "@engine/render-three/terrain/terrainRenderer";
import { TerrainDeformationTexture } from "@engine/render-three/terrain/terrainDeformation";
import { DeformationField } from "@engine/scene/deformationField";
import { worldTerrainRenderSource } from "@engine/terrain/terrainRenderSource";
import { type TerrainTileData } from "@engine/terrain/terrainTypes";

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
terrain.mesh.material.onBeforeCompile = (shader, renderer) => {
  compile(shader, renderer);
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
let frame = 0;
function loop() { draw(); if (++frame < 20) requestAnimationFrame(loop); else {
  (window as any).__wetMudQa = { ready: true, water(on: boolean) { wet![4] = on ? 0.9 : 0; draw(); return probes(); }, sample,
    roughness(on: boolean) { roughnessInAlpha![4] = on ? 1 : 0; draw(); return surfaceProbes(); },
    side() { camera.position.set(-2.5, 3.2, 6); camera.lookAt(0, -0.12, 0); camera.updateMatrixWorld(true); draw(); },
    triangles: renderer.info.render.triangles };
} }
loop();
