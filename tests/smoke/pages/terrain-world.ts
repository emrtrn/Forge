import { AmbientLight, Color, DirectionalLight, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from "three";
import { TerrainRenderer } from "@engine/render-three/terrain/terrainRenderer";
import { worldTerrainRenderSource } from "@engine/terrain/terrainRenderSource";
import { tileKey, type TerrainTileData } from "@engine/terrain/terrainTypes";

/**
 * Smoke-only page (never in the game build): a 3×2-tile World Terrain with one
 * missing tile, drawn by the CDLOD renderer with two tile slots so tile-slot
 * and global-map nodes meet on screen. The background is magenta; after the
 * slots settle the page counts magenta pixels that look through the terrain's
 * interior — a crack at a seam — and publishes the result on `window`.
 *
 * `?view=top` looks straight down (the crack check); `?view=grazing` is a low
 * view for the screenshot.
 */

const QUADS = 128;
const SPACING = 1;
const TILES_X = 3;
const TILES_Z = 2;
const HOLE = tileKey(2, 1);
const TILE = QUADS * SPACING;
const WIDTH = TILES_X * TILE;
const DEPTH = TILES_Z * TILE;

function heightAt(gx: number, gz: number): number {
  return 7 * Math.sin(gx * 0.045) * Math.cos(gz * 0.031) + 3 * Math.sin((gx + gz) * 0.13);
}

const tiles = new Map<string, TerrainTileData>();
for (let tz = 0; tz < TILES_Z; tz += 1) {
  for (let tx = 0; tx < TILES_X; tx += 1) {
    if (tileKey(tx, tz) === HOLE) continue;
    const size = QUADS + 1;
    const heights = new Float32Array(size * size);
    const weights = new Uint8Array(size * size * 4);
    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        const h = heightAt(tx * QUADS + x, tz * QUADS + z);
        heights[z * size + x] = h;
        const rock = Math.min(255, Math.max(0, Math.round((h + 4) * 20)));
        weights.set([255 - rock, rock, 0, 0], (z * size + x) * 4);
      }
    }
    tiles.set(tileKey(tx, tz), { x: tx, z: tz, size, heights, layerCount: 4, weights });
  }
}

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "top";
const canvas = document.querySelector<HTMLCanvasElement>("#terrain")!;
const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
const scene = new Scene();
scene.background = new Color("#ff00ff");
scene.add(new AmbientLight("#ffffff", 0.8));
const sun = new DirectionalLight("#ffffff", 2);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);

const camera = new PerspectiveCamera(60, innerWidth / innerHeight, 1, 5000);
const eye = params.get("eye")?.split(",").map(Number);
const target = params.get("target")?.split(",").map(Number);
if (eye?.length === 3 && target?.length === 3) {
  camera.position.set(eye[0]!, eye[1]!, eye[2]!);
  camera.lookAt(target[0]!, target[1]!, target[2]!);
} else if (view === "grazing") {
  camera.position.set(-40, 26, -30);
  camera.lookAt(WIDTH * 0.55, 0, DEPTH * 0.6);
} else {
  camera.position.set(WIDTH / 2, 330, DEPTH / 2);
  camera.up.set(0, 0, -1);
  camera.lookAt(WIDTH / 2, 0, DEPTH / 2);
}
camera.updateMatrixWorld(true);

const terrain = new TerrainRenderer(
  worldTerrainRenderSource({ tileQuads: QUADS, spacing: SPACING, tilesX: TILES_X, tilesZ: TILES_Z }, tiles),
  {
    viewMode: view === "top" ? "height" : "lit",
    activeLayer: 0,
    layers: [
      { texture: null, color: "#5f9449", scale: 1 },
      { texture: null, color: "#7f8485", scale: 1 },
    ],
    origin: new Vector3(0, 0, 0),
    slotCapacity: Number(params.get("slots") ?? 2),
    uploadsPerFrame: 1,
  },
);
scene.add(terrain.mesh);

/** Magenta pixels whose ground point (y = 0) is inside the terrain, away from its edges and the hole. */
function countCracks(): { cracks: number; checked: number; at: number[][] } {
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const raycaster = new Raycaster();
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const point = new Vector3();
  const ndc = new Vector2();
  // Heights reach ±10 m; at this altitude that moves a projected point by a few metres.
  const margin = 12;
  let cracks = 0;
  let checked = 0;
  const at: number[][] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      ndc.set((x + 0.5) / width * 2 - 1, (y + 0.5) / height * 2 - 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(ground, point)) continue;
      if (point.x < margin || point.z < margin || point.x > WIDTH - margin || point.z > DEPTH - margin) continue;
      if (point.x > 2 * TILE - margin && point.z > TILE - margin) continue;
      checked += 1;
      const index = (y * width + x) * 4;
      if (pixels[index]! > 230 && pixels[index + 1]! < 30 && pixels[index + 2]! > 230) {
        cracks += 1;
        if (at.length < 12) at.push([Math.round(point.x * 10) / 10, Math.round(point.z * 10) / 10]);
      }
    }
  }
  return { cracks, checked, at };
}

let frame = 0;
function loop(): void {
  terrain.updateLod(camera);
  renderer.render(scene, camera);
  frame += 1;
  if (frame === 40) {
    const geometry = terrain.mesh.geometry;
    const slots = geometry.getAttribute("terrainNodeA");
    let slotNodes = 0;
    for (let index = 0; index < geometry.instanceCount; index += 1) if (slots.getW(index) >= 0) slotNodes += 1;
    (window as unknown as { terrainWorld: unknown }).terrainWorld = {
      ready: true,
      resident: terrain.residentTileCount,
      instances: geometry.instanceCount,
      slotNodes,
      ...(view === "top" ? countCracks() : {}),
    };
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
