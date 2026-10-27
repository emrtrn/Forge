import { Box3, Mesh, ShaderMaterial, Vector3, type Group, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { SceneApp } from "@/scene/SceneApp";
import type { AuthoredEnvironment } from "@engine/render-three/authoredEnvironment";
import type { RiverWaterObject } from "@engine/render-three/riverWater";
import type { LakeWaterController } from "@/scene/lakeWaterController";
import { GpuFrameTimer, type GpuTimerContext } from "@engine/perf/gpuTimer";
import { terrainHeightAt } from "@engine/terrain/terrainHeightQuery";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { tileKey } from "@engine/terrain/terrainTypes";
import type { PlanarReflectionSource } from "@engine/render-three/planarReflectionSource";
import type { RoomLayout } from "@engine/scene/layout";
import { WATER_OPTICS_GLSL } from "@engine/render-three/waterOptics";
import { WATER_ENVIRONMENT_GLSL } from "@engine/render-three/waterEnvironment";
import { WATER_SCENE_GLSL } from "@engine/render-three/waterSceneSnapshot";
import baselineShaders from "./water-surface-v4-shaders.json";

type Variant = "off" | "before" | "after" | "low" | "high";
interface ReviewApp {
  projectReady: Promise<void>; scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer;
  frameHandle: number; riverWaterObjects: RiverWaterObject[]; lakes: LakeWaterController | null;
  landscapeObjects: Group[]; worldTerrains: Map<string, WorldTerrainDocument>;
  environment: AuthoredEnvironment; riverReflectionSources: PlanarReflectionSource[];
  layout: RoomLayout;
  postProcessPipeline: { render(dt: number): void } | null;
  foliageBinding: { updateCulling(camera: Vector3): void } | null;
  updateSunCascades(): void; updateWorldTerrainStreaming(): void;
}
const app = new SceneApp(document.querySelector("canvas")!, { enabled: true });
const internal = app as unknown as ReviewApp;
app.start();
await internal.projectReady;
const waterDeadline = performance.now() + 60_000;
while (internal.riverWaterObjects.length !== internal.layout.riverWaters?.filter((w) => !w.hidden).length
  || internal.lakes?.objects.size !== internal.layout.waterBodies?.filter((w) => !w.hidden).length) {
  if (performance.now() > waterDeadline) throw new Error("LandscapeTest river/lake did not finish publishing");
  await new Promise((resolve) => setTimeout(resolve, 50));
}
const { renderer, scene, camera } = internal;
const sources = [...new Set([...internal.riverReflectionSources,
  ...((internal.lakes as unknown as { reflection: Map<string, PlanarReflectionSource> } | null)?.reflection.values() ?? [])])];
let reflectionDraws = 0, reflectionCaptures = 0, motion = false;
const captureWitness = new Map<PlanarReflectionSource, { total: number; camera: number[] }>();
let variant: Variant = "after", view = "river-upper";
let fixedTime = 12;
const currentShaders = new Map([...internal.riverWaterObjects, ...(internal.lakes?.objects.values() ?? [])]
  .map((water) => [water, { vertex: water.material.vertexShader, fragment: water.material.fragmentShader }]));
const expand = (shader: string) => shader.replaceAll("${WATER_OPTICS_GLSL}", WATER_OPTICS_GLSL)
  .replaceAll("${WATER_ENVIRONMENT_GLSL}", WATER_ENVIRONMENT_GLSL)
  .replaceAll("${WATER_SCENE_GLSL}", WATER_SCENE_GLSL);
let currentDraw: { object: string; material: string; type: string } | null = null;
const samplerWarnings = new Map<string, { count: number; object: string; material: string; type: string; variant: Variant }>();
const originalDraw = renderer.renderBufferDirect.bind(renderer);
renderer.renderBufferDirect = (...args) => {
  currentDraw = { object: args[4].name, material: args[3].name, type: args[3].type };
  try { originalDraw(...args); } finally { currentDraw = null; }
};
const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const message = String(args[0]);
  if (message.includes("texture units") && currentDraw) {
    const key = `${variant}:${currentDraw.object}:${currentDraw.material}:${message}`;
    const previous = samplerWarnings.get(key);
    if (previous) previous.count++;
    else samplerWarnings.set(key, { count: 1, ...currentDraw, variant });
  }
  originalWarn(...args);
};

// Keep the real environment update (camera-following sky/clouds) active. Only
// cloud time is held, avoiding the black-sky failure of the earlier audit.
const environmentUpdate = internal.environment.update.bind(internal.environment);
internal.environment.update = (dt) => environmentUpdate(motion ? dt : 0);
scene.traverse((object) => {
  if (!(object instanceof Mesh)) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  if (!materials.some((material) => material instanceof ShaderMaterial && material.uniforms.time)) return;
  const before = object.onBeforeRender;
  object.onBeforeRender = function (...args) {
    before.apply(this, args);
    if (!motion) for (const material of materials) {
      if (material instanceof ShaderMaterial && material.uniforms.time) material.uniforms.time.value = fixedTime;
    }
  };
});
for (const source of sources) {
  const update = source.update.bind(source);
  source.update = (...args) => {
    const before = renderer.info.render.calls;
    update(...args);
    const additional = renderer.info.render.calls - before;
    if (additional > 0) {
      reflectionDraws += additional; reflectionCaptures++;
      captureWitness.set(source, { total: (captureWitness.get(source)?.total ?? 0) + 1, camera: args[2].position.toArray() });
    }
  };
}
function setVariant(next: Variant) {
  variant = next;
  for (const source of sources) source.setQuality(next === "low" ? null : next === "high" ? "high" : "medium");
  for (const water of [...internal.riverWaterObjects, ...(internal.lakes?.objects.values() ?? [])]) water.visible = next !== "off";
  for (const water of internal.lakes?.objects.values() ?? []) water.userData.waterSceneTransmission = next !== "off";
  for (const [water, current] of currentShaders) {
    const shaders = next === "before" ? ("isRiverWaterObject" in water ? baselineShaders.river : baselineShaders.lake) : current;
    const vertex = expand(shaders.vertex), fragment = expand(shaders.fragment);
    if (water.material.fragmentShader !== fragment || water.material.vertexShader !== vertex) {
      water.material.vertexShader = vertex; water.material.fragmentShader = fragment; water.material.needsUpdate = true;
    }
  }
  for (const water of internal.riverWaterObjects) water.material.uniforms.waterDetail!.value = next === "low" ? 0 : 1;
  document.querySelector<HTMLSelectElement>("#review-variant")!.value = next;
  status();
}
const cameras: Record<string, { target: number[]; offset: number[]; fov: number }> = {
  "river-upper": { target: [279.23, -45.7, 57.8], offset: [-28, 24, -22], fov: 48 },
  "river-bank": { target: [279.23, -45.7, 57.8], offset: [-10, 5, 13], fov: 48 },
  "river-flat": { target: [148.4, -71.7, 281.85], offset: [-8, 22, -6], fov: 48 },
  "river-top": { target: [233.59, -59.7, 151.82], offset: [0, 55, 0.01], fov: 48 },
  "lake-overview": { target: [44, -5, -44], offset: [43, 32, 48], fov: 48 },
  "lake-shore": { target: [40, -5, -42], offset: [-1, 8, 20], fov: 48 },
  "lake-top": { target: [44, -5, -44], offset: [0, 85, 0.01], fov: 48 },
  "lake-low": { target: [40, -5, -42], offset: [-1, 2.5, 20], fov: 48 },
  "lake-1": { target: [-52, -7, -57], offset: [10, 12, 28], fov: 48 },
  "lake-1-low": { target: [-55, -7, -61], offset: [3, 1.5, 9], fov: 48 },
};
function setView(name: string) {
  const pose = cameras[name]; if (!pose) throw new Error(`Unknown view ${name}`);
  view = name;
  const target = new Vector3().fromArray(pose.target);
  camera.position.copy(target).add(new Vector3().fromArray(pose.offset));
  // A bank camera must stay out of the terrain; the final pose is recorded.
  for (const document of internal.worldTerrains.values()) {
    const height = terrainHeightAt(document.def, { tile: (x, z) => document.tiles.get(tileKey(x, z)) }, camera.position.x, camera.position.z);
    if (height !== null) camera.position.y = Math.max(camera.position.y, height + 1.8);
  }
  camera.up.set(0, 1, 0); camera.lookAt(target);
  camera.fov = pose.fov; camera.near = 0.1; camera.far = 2000;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  internal.environment.update(0);
  document.querySelector<HTMLSelectElement>("#review-view")!.value = name;
  status();
}
function status() {
  document.querySelector("#review-status")!.textContent = `${view} · ${variant} · ${motion ? "canlı" : `t=${fixedTime}s`}`;
}
function setTime(time: number) {
  if (!Number.isFinite(time) || time < 0 || time > 3600) throw new Error("Invalid review time");
  fixedTime = time; status();
}
function metadataSnapshotCopies() {
  return (internal.postProcessPipeline as unknown as { waterScene: { copies: number } } | null)?.waterScene.copies ?? 0;
}
function metadata() {
  const gl = renderer.getContext(), debug = gl.getExtension("WEBGL_debug_renderer_info");
  return { view, variant, motion, fixedTime,
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string : gl.getParameter(gl.RENDERER) as string,
    browser: navigator.userAgent, gpuTimer: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
    viewport: { width: renderer.domElement.width, height: renderer.domElement.height, dpr: renderer.getPixelRatio() },
    camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov, near: camera.near, far: camera.far },
    exposure: renderer.toneMappingExposure, toneMapping: renderer.toneMapping, postProcess: !!internal.postProcessPipeline,
    sceneSnapshot: metadataSnapshotCopies(),
    effects: (internal.postProcessPipeline as unknown as { effectPasses: { enabled: boolean; constructor: {name: string} }[] } | null)?.effectPasses.map(p=>({name:p.constructor.name,enabled:p.enabled})),
    environment: { sky: !!(internal.environment as unknown as { skyObject: unknown }).skyObject, map: !!scene.environment, fog: !!scene.fog },
    glError: gl.getError(), textureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
    reflectionSources: sources.map((source) => {
      const s = source as unknown as { planeY: number; captured: boolean; renderTarget: { width: number } | null };
      return { planeY: s.planeY, captured: s.captured, resolution: s.renderTarget?.width ?? 0, witness: captureWitness.get(source) ?? null };
    }),
    samplerWarnings: [...samplerWarnings.values()],
    waters: [...internal.riverWaterObjects, ...(internal.lakes?.objects.values() ?? [])].map((water) => {
      const box = new Box3().setFromObject(water), position = water.geometry.getAttribute("position"), depth = water.geometry.getAttribute("waterDepth");
      let minDepth = Infinity, maxDepth = 0, wet = 0, shallow = 0;
      for (let i = 0; i < depth.count; i++) { const d = depth.getX(i); minDepth = Math.min(minDepth, d); maxDepth = Math.max(maxDepth, d); if (d > 0.001) wet++; if (d > 0.001 && d < 0.35) shallow++; }
      return { name: water.name, visible: water.visible, vertices: position.count, triangles: (water.geometry.index?.count ?? 0) / 3,
        bounds: { min: box.min.toArray(), max: box.max.toArray() }, minDepth, maxDepth, wet, shallow,
        uniforms: Object.fromEntries(Object.entries(water.material.uniforms).filter(([,u]) => typeof u.value === "number").map(([k,u]) => [k,u.value])),
        sun: water.material.uniforms.waterSunColor?.value.toArray(), sunDirection: water.material.uniforms.waterSunDirection?.value.toArray() };
    }),
    lakes: [...(internal.lakes?.results ?? [])].map(([id, r]) => ({ id, status: r.status, message: r.message })),
    terrain: [...internal.worldTerrains].map(([id,d]) => ({id, tiles: d.tiles.size, expected: d.def.tiles.length})),
    resources: { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0, reflectionSources: sources.length },
  };
}
// Read-only review sandbox: diagnostic controls never reach an authored file.
function diagnoseLake(mode: "opaque" | "no-effects" | "no-reflection" | "ao-surface" | "depth" | "alpha" | "body" | "reflection" | "no-ao" | "flat-normal" | "lit-body" | "environment" | "combined" | "flat-color" | "flat-color-noao" | "baked-path" | "scalar-loss" | "no-scene") {
  if (mode === "no-scene") for (const water of internal.lakes?.objects.values() ?? []) water.userData.waterSceneTransmission = false;
  if (mode === "baked-path" || mode === "scalar-loss") for (const water of internal.lakes?.objects.values() ?? []) {
    water.material.fragmentShader = mode === "baked-path"
      ? water.material.fragmentShader.replace("path=min(length(waterColumn),100.);", "path=waterPath(d,abs(viewDirection.y));")
      : water.material.fragmentShader.replace("vec3 extinction=(vec3(1.)+(vec3(1.)-tint)*2.)/max(absorptionDistance,.01);", "vec3 extinction=vec3(1./max(absorptionDistance,.01));");
    water.material.needsUpdate = true;
  }
  if (mode.startsWith("flat-color")) for (const water of internal.lakes?.objects.values() ?? []) {
    water.material.fragmentShader = water.material.fragmentShader.replace("#include <tonemapping_fragment>", "gl_FragColor=vec4(.25,.5,.5,1.);\n#include <tonemapping_fragment>");
    water.material.needsUpdate = true;
  }
  if (["lit-body", "combined"].includes(mode)) for (const water of internal.lakes?.objects.values() ?? []) {
    water.material.fragmentShader = water.material.fragmentShader.replace("color*=waterSurfaceLight(normal,viewDirection,.18);", "color*=mix(vec3(1.),waterSky(vec3(0.,1.,0.),1.) + waterSunColor*max(waterSunDirection.y,0.)*.318309886,waterLightingEnabled);");
    water.material.needsUpdate = true;
  }
  if (["environment", "combined"].includes(mode)) for (const water of internal.lakes?.objects.values() ?? []) {
    water.material.fragmentShader = water.material.fragmentShader.replace("float reflectionAmount=0.;", "float reflectionAmount=fresnel*smoothstep(0.,.08,d)*step(0.,viewDirection.y)*step(.0001,waterEnvironmentIntensity);")
      .replace("vec3 reflected=vec3(0.);", "vec3 reflected=waterSky(reflect(-viewDirection,normal),.18);")
      .replace("reflectionAmount=clamp(reflectionStrength*fresnel,0.,1.)*smoothstep(0.,.08,d);", "reflectionAmount=fresnel*smoothstep(0.,.08,d);")
      .replace("reflected=texture2D(reflectionTexture,r).rgb;", "reflected=mix(reflected,texture2D(reflectionTexture,r).rgb,reflectionStrength);");
    water.material.needsUpdate = true;
  }
  if (["alpha", "body", "reflection"].includes(mode)) for (const water of internal.lakes?.objects.values() ?? []) {
    const output = mode === "alpha" ? "vec3(gl_FragColor.a)" : mode === "body" ? "color" : "reflected";
    water.material.fragmentShader = water.material.fragmentShader.replace("#include <tonemapping_fragment>", `gl_FragColor=vec4(${output},1.);\n#include <tonemapping_fragment>`);
    water.material.needsUpdate = true;
  }
  if (mode === "flat-normal") for (const water of internal.lakes?.objects.values() ?? []) {
    water.material.fragmentShader = water.material.fragmentShader.replace("vec3 normal=normalize(vec3(n.x*.10,1.,n.y*.10));", "vec3 normal=vec3(0.,1.,0.);");
    water.material.needsUpdate = true;
  }
  if (mode === "no-ao" || mode === "flat-color-noao") {
    const pipeline = internal.postProcessPipeline as unknown as { effectPasses: { enabled: boolean; constructor: { name: string } }[] } | null;
    for (const pass of pipeline?.effectPasses ?? []) if (pass.constructor.name.includes("Gtao")) pass.enabled = false;
  }
  if (mode === "depth") for (const water of internal.lakes?.objects.values() ?? []) {
    water.material.fragmentShader = water.material.fragmentShader.replace("#include <fog_fragment>",
      "gl_FragColor=vec4(vec3(clamp(vDepth/6.,0.,1.)),1.);");
    water.material.needsUpdate = true;
  }
  if (mode === "ao-surface") for (const water of internal.lakes?.objects.values() ?? []) {
    water.geometry.computeVertexNormals(); water.material.depthWrite = true;
  }
  if (mode === "opaque") for (const water of internal.lakes?.objects.values() ?? []) {
    water.material.uniforms.opacity!.value = 1;
    water.material.uniforms.bedVisibility!.value = 0;
    water.material.uniforms.reflectionStrength!.value = 0;
  }
  if (mode === "no-reflection") for (const water of internal.lakes?.objects.values() ?? []) water.material.uniforms.reflectionStrength!.value = 0;
  if (mode === "no-effects") {
    const pipeline = internal.postProcessPipeline as unknown as { effectPasses: { enabled: boolean }[] } | null;
    for (const pass of pipeline?.effectPasses ?? []) pass.enabled = false;
  }
  return metadata();
}
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
function percentiles(values: number[]) {
  const ordered = [...values].sort((a,b) => a-b);
  const p = (q: number) => ordered[Math.min(ordered.length - 1, Math.ceil(q * ordered.length) - 1)] ?? null;
  return { samples: values.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), mean: values.length ? values.reduce((a,b)=>a+b,0) / values.length : null };
}
async function benchmark(samples = 120) {
  const gl = renderer.getContext();
  const timer = GpuFrameTimer.create(typeof (gl as WebGL2RenderingContext).createQuery === "function" ? gl as GpuTimerContext : null);
  if (!timer || !internal.postProcessPipeline) throw new Error("Hardware GPU timer/composer unavailable");
  const pipeline = internal.postProcessPipeline, originalRender = pipeline.render;
  const results = [];
  try {
    // Reverse the order in the second round to expose drift/capture cadence.
    for (const [round, order] of [[0, ["off", "before", "low", "after", "high"]], [1, ["high", "after", "low", "before", "off"]]] as const) {
      for (const next of order) {
        setVariant(next);
        for (let i = 0; i < 30; i++) await nextFrame();
        const gpu: number[] = [], cpu: number[] = [], raf: number[] = [], draws: number[] = [], reflection: number[] = [], sceneCopies: number[] = [];
        let issued = 0, previous = performance.now(), captures = 0;
        // Observe the actual SceneApp render boundary. Reimplementing its frame
        // loop can miss material/subsystem updates and measure a different image.
        pipeline.render = (dt) => {
          const measuring = cpu.length < samples, now = performance.now();
          if (measuring) raf.push(now - previous);
          previous = now; reflectionDraws = 0; reflectionCaptures = 0;
          const copiesBefore = metadataSnapshotCopies();
          const began = measuring && timer.begin(1), start = performance.now();
          try { originalRender.call(pipeline, dt); } finally { if (began) { timer.end(); issued++; } }
          if (measuring) { cpu.push(performance.now()-start); draws.push(renderer.info.render.calls); reflection.push(reflectionDraws); captures += reflectionCaptures; sceneCopies.push(metadataSnapshotCopies()-copiesBefore); }
          for (const result of timer.poll()) gpu.push(result.ms);
        };
        for (let i = 0; i < samples + 60; i++) {
          await nextFrame();
          if (cpu.length === samples && gpu.length === issued) break;
        }
        pipeline.render = originalRender;
        if (timer.disjointCount > 0 || issued !== samples || gpu.length !== issued) throw new Error("GPU timing disjoint or incomplete");
        results.push({ round, variant: next, gpuMs: percentiles(gpu), cpuSubmitMs: percentiles(cpu), rafMs: percentiles(raf),
          draws: percentiles(draws), reflectionDraws: percentiles(reflection), reflectionCaptures: captures, sceneCopies: percentiles(sceneCopies), metadata: metadata() });
      }
    }
    return results;
  } finally { pipeline.render = originalRender; timer.dispose(); setVariant("after"); }
}
document.querySelector("#review-variant")!.addEventListener("change", (e) => setVariant((e.target as HTMLSelectElement).value as Variant));
document.querySelector("#review-view")!.addEventListener("change", (e) => setView((e.target as HTMLSelectElement).value));
document.querySelector("#review-motion")!.addEventListener("change", (e) => { motion = (e.target as HTMLInputElement).checked; status(); });
declare global { interface Window { __waterLandscape: {
  ready: boolean; metadata: typeof metadata; setView: typeof setView; setVariant: typeof setVariant; benchmark: typeof benchmark; setTime: typeof setTime; diagnoseLake: typeof diagnoseLake;
}; } }
window.__waterLandscape = { ready: true, metadata, setView, setVariant, benchmark, setTime, diagnoseLake };
setView("river-upper");
