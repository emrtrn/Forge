import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from "three";
import { createRiverWaterObject, type RiverWaterObject } from "@engine/render-three/riverWater";
import { resolveRiverWater } from "@engine/scene/riverWater";
import { FULL_LAKE_QUALITY } from "@engine/perf/lakeQuality";
import { isPlanarReflectionCamera } from "@engine/render-three/planarReflectionSource";

const renderer = new WebGLRenderer({ canvas: document.querySelector("canvas")!, preserveDrawingBuffer: true });
renderer.setSize(800, 600); renderer.setPixelRatio(1); renderer.info.autoReset = false;
const scene = new Scene(); scene.background = new Color("#25384b");
const group = new Group(); scene.add(group);
const bed = new Mesh(new PlaneGeometry(50, 30), new MeshBasicMaterial({ color: "#45605c" }));
bed.rotation.x = -Math.PI / 2; bed.position.y = -5; group.add(bed);
const blockers = [-7, 0, 7].map(x => {
  const mesh = new Mesh(new BoxGeometry(2.5, 6, 2), new MeshBasicMaterial({ color: "#ff1010" }));
  mesh.position.set(x, 4, -6); group.add(mesh); return mesh;
});
const perspective = new PerspectiveCamera(50, 4 / 3, 0.1, 150), ortho = new OrthographicCamera(-16, 16, 12, -12, 0.1, 150);
let camera: PerspectiveCamera | OrthographicCamera = perspective;
let river: RiverWaterObject;
let captures = 0;
const render = renderer.render.bind(renderer);
renderer.render = (s, c) => { if (isPlanarReflectionCamera(c)) captures++; render(s, c); };
let options = { quality: "high" as "low" | "medium" | "high", sloped: true, orthographic: false, reversed: false, transformed: false, blockers: true, visible: true };
function build() {
  if (river) { group.remove(river); river.dispose(); }
  const heights = options.sloped ? [3, 1, 1, -1] : [1, 1, 1, 1];
  river = createRiverWaterObject({
    ...resolveRiverWater({ id: "qa", landscapeRef: "l", splineRef: "s", surfaceLevel: heights[0]!, reflectionQuality: "high", reflectionStrength: 1,
      surfaceStrength: 0, surfaceRoughness: .04, waveAmplitude: 0, foamOpacity: 0, refractionStrength: 0, bedVisibility: 0 }),
    spline: { id: "s", points: [-12, -4, 4, 12].map((x, i) => ({ id: String(i), position: [x, heights[i]!, 0], width: 5, falloff: 0 })),
      segments: [0, 1, 2].map(i => ({ id: `s${i}`, startPointId: String(i), endPointId: String(i + 1) })) },
    position: [0, 0, 0], rotation: [0, 0, 0], foamNoiseMap: null,
  }, null);
  group.add(river);
}
async function frame(patch: Partial<typeof options> = {}) {
  options = { ...options, ...patch }; build();
  await river.applyQuality({ ...FULL_LAKE_QUALITY, reflectionQuality: options.quality === "low" ? "off" : options.quality });
  if (options.transformed) group.position.set(100, 17, -80);
  else group.position.set(0, 0, 0);
  group.rotation.y = options.transformed ? 1.1 : 0; group.updateMatrixWorld(true);
  camera = options.orthographic ? ortho : perspective;
  (camera as unknown as { _reversedDepth: boolean })._reversedDepth = options.reversed;
  camera.updateProjectionMatrix();
  camera.position.copy(new Vector3(2, 9, 22).applyMatrix4(group.matrixWorld));
  camera.up.set(0, 1, 0).transformDirection(group.matrixWorld); camera.lookAt(new Vector3(0, 1, 0).applyMatrix4(group.matrixWorld));
  blockers.forEach(b => { b.visible = options.blockers; }); river.visible = options.visible;
  captures = 0; renderer.info.reset();
  const counts: number[] = [], times: number[] = [];
  for (let i = 0; i < 12; i++) {
    await new Promise(requestAnimationFrame);
    const before = captures, start = performance.now(); renderer.render(scene, camera);
    counts.push(captures - before); times.push(performance.now() - start);
  }
  const gl = renderer.getContext(), bytes = new Uint8Array(800 * 600 * 4); gl.readPixels(0, 0, 800, 600, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  let red = 0;
  for (let i = 0; i < bytes.length; i += 4) red += Math.max(0, bytes[i]! - bytes[i + 1]!);
  return { counts, cpuMedian: [...times].sort((a, b) => a - b)[6], red,
    active: river.userData.riverPlanarActive ?? 0, patches: river.userData.riverPlanarPatches ?? 0,
    sizes: river.material.uniforms.riverPlanarTextures!.value.filter(Boolean).map((t: { image: { width: number } }) => t.image.width),
    textures: renderer.info.memory.textures, draws: renderer.info.render.calls, glError: gl.getError() };
}
declare global { interface Window { __riverPlanar: { frame: typeof frame }; } }
window.__riverPlanar = { frame };
