import { AmbientLight, BoxGeometry, Color, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from "three";
import { LakeWaterController } from "@/scene/lakeWaterController";
import { PostProcessPipeline } from "@engine/render-three/postProcess";
import { setSceneDepthMode } from "@engine/render-three/depthMode";
import { QUALITY_PROFILES } from "@engine/perf/qualityProfiles";
import { createLakeFixture } from "../../engine/fixtures/lakeFixture";

const renderer = new WebGLRenderer({ canvas: document.querySelector("canvas")!, antialias: false, preserveDrawingBuffer: true });
renderer.setSize(640, 480); renderer.setPixelRatio(1); renderer.info.autoReset = false;
const scene = new Scene(); scene.background = new Color("#a8d9f0"); scene.add(new AmbientLight(0xffffff, 1));
const perspective = new PerspectiveCamera(60, 4 / 3, .1, 100), orthographic = new OrthographicCamera(-8, 8, 6, -6, .1, 100);
let camera: PerspectiveCamera | OrthographicCamera = perspective;
const bed = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial({ color: "#ba9870" })); bed.rotation.x = -Math.PI / 2; bed.position.y = 10; scene.add(bed);
for (const z of [-16, -24, -32]) {
  const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: "#dddddd" })); cube.position.set(-20, 10.7, z); scene.add(cube);
}
const f = createLakeFixture(), controller = new LakeWaterController({ scene, editor: true, document: () => f, load: async (_, key) => f.tiles.get(key)!, normal: async () => null });
let pipeline = new PostProcessPipeline({ renderer, scene, camera, width: 640, height: 480 });
export interface UnderwaterOptions { view?: "above" | "half" | "below" | "up" | "island" | "outside" | "bed"; enabled?: boolean; quality?: "low" | "medium" | "high"; msaa?: boolean; orthographic?: boolean; reversed?: boolean; waves?: boolean; time?: number; deepColor?: string; width?: number; height?: number }
let options: UnderwaterOptions = { view: "below", enabled: true, quality: "high", msaa: false };
async function frame(patch: UnderwaterOptions = {}) {
  const previousMsaa = options.msaa; options = { ...options, ...patch };
  if (options.msaa !== previousMsaa) { pipeline.dispose(); pipeline = new PostProcessPipeline({ renderer, scene, camera, width: 640, height: 480, floatDepth: options.msaa === true }); }
  camera = options.orthographic ? orthographic : perspective; pipeline.setCamera(camera);
  const depthMode = setSceneDepthMode(renderer, options.reversed ? "reversed" : "standard", { scene, cameras: [perspective, orthographic] });
  const width = options.width ?? 640, height = options.height ?? 480;
  renderer.setSize(width, height); pipeline.setSize(width, height); perspective.aspect = width/height; perspective.updateProjectionMatrix();
  await controller.rebuild([{ ...f.lake, underwater: { enabled: options.enabled ?? true, distortionStrength: .35, particleDensity: .25 },
    appearance: { surfaceWavesEnabled: options.waves ?? false, surfaceWaveHeight: .05, deepColor: options.deepColor ?? "#234f4b", foamEnabled: false, reflectionMode: "off", refractionStrength: 0, surfaceStrength: 0 } }]);
  pipeline.setUnderwaterQuality(QUALITY_PROFILES[options.quality ?? "high"]);
  const positions = { above: [-20, 13, -12], half: [-20, 12, -12], below: [-20, 11, -12], up: [-20, 11, -12], island: [0, 11, 0], outside: [80, 11, 80], bed: [-20, 9, -12] };
  const p = positions[options.view ?? "below"]!; camera.position.set(p[0]!, p[1]!, p[2]!);
  camera.lookAt(p[0]!, p[1]! + (options.view === "up" ? 10 : 0), p[2]! - (options.view === "up" ? .01 : 20)); camera.updateMatrixWorld(true);
  controller.objects.get(f.lake.id)!.setSurfaceWaveTime(options.time ?? 0);
  renderer.info.reset(); const start = performance.now(); pipeline.render(0); const cpuMs = performance.now() - start;
  const gl = renderer.getContext(), data = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  const sample = (y0: number, y1: number) => {
    const color = [0, 0, 0]; let count = 0;
    for (let y = y0; y < y1; y += 8) for (let x = 160; x < 480; x += 8) { const i = (y * width + x) * 4; color.forEach((_, c) => { color[c]! += data[i + c]!; }); count++; }
    return color.map(c => c / count);
  };
  return { ...pipeline.underwaterStats, maskResolution: [...pipeline.underwaterStats.maskResolution], top: sample(320, 450), bottom: sample(30, 150),
    centre: sample(200, 280), depthMode, gpuTimerAvailable: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"), glError: gl.getError(), calls: renderer.info.render.calls, textures: renderer.info.memory.textures, cpuMs, requiresPipeline: pipeline.requiresRendering() };
}
declare global { interface Window { __lakeUnderwater: { frame: typeof frame }; } }
window.__lakeUnderwater = { frame };
