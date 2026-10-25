import { AmbientLight, Color, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace, TextureLoader, RepeatWrapping, Vector3, WebGLRenderer } from "three";
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
const texture = await new TextureLoader().loadAsync("/assets/LandscapeTest/Textures/LT_Wet_Mud_BC.webp");
const materialDef = await (await fetch("/assets/LandscapeTest/Materials/lt-wet-mud.material.json")).json();
texture.colorSpace = SRGBColorSpace;
texture.wrapS = texture.wrapT = RepeatWrapping;
const field = new DeformationField();
for (const x of [-1.1, 1.1]) field.stampWheel({ from: [x, -14], to: [x, 14], width: 0.55, contactLength: 0.6, targetDepth: 0.18, compaction: 1, disturbance: 255 });
const deformation = new TerrainDeformationTexture();
deformation.attach(field);
const terrain = new TerrainRenderer(worldTerrainRenderSource({ tileQuads: q, spacing: 0.5, tilesX: 2, tilesZ: 2 }, tiles), {
  viewMode: "lit", activeLayer: 4, origin: new Vector3(-32, 0, -32), slotCapacity: 4, uploadsPerFrame: 4, deformation,
  layers: Array.from({ length: 5 }, (_, i) => ({ texture: i === 4 ? texture : null, color: "#493226", scale: 0.25, roughness: materialDef.roughness, physicalMaterial: i === 4 ? "mud" : null })),
});
scene.add(terrain.mesh);
let wet: number[] | undefined;
const compile = terrain.mesh.material.onBeforeCompile;
terrain.mesh.material.onBeforeCompile = (shader, renderer) => {
  compile(shader, renderer);
  wet = shader.uniforms.uDeformLayerWet!.value as number[];
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
let frame = 0;
function loop() { draw(); if (++frame < 20) requestAnimationFrame(loop); else {
  (window as any).__wetMudQa = { ready: true, water(on: boolean) { wet![4] = on ? 0.9 : 0; draw(); return probes(); }, sample,
    side() { camera.position.set(-2.5, 3.2, 6); camera.lookAt(0, -0.12, 0); camera.updateMatrixWorld(true); draw(); },
    triangles: renderer.info.render.triangles };
} }
loop();
