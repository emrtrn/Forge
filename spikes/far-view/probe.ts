import {
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Quaternion,
  ShaderChunk,
  Vector3,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
// A relative path, not `three/examples/...`: a new bare import would make Vite
// re-optimize deps and reload the page mid-run. Its own `import "three"` still
// resolves to the app's optimized three, so it patches the same ShaderChunk.
// @ts-expect-error -- untyped relative path to the addon (types live under the bare specifier)
import { CSM } from "../../node_modules/three/examples/jsm/csm/CSM.js";

import { computeFollowShadowFrame } from "@engine/world/followShadow";

/**
 * OPEN_WORLD_PLAN Faz 7 / S7 (7c2) — throwaway, never merged. Attaches to a
 * running runtime (OpenWorldTest + grass ring + statics, far view mode) and
 * swaps the sun's shadow between: none, today's single follow cascade, three's
 * CSM addon (2/3/4) and a Forge prototype (2/3/4: chained per-material patch,
 * cascade picked from the shadow coordinates, edge fades). Measures GPU ms
 * (timer queries, shadow pass split out), draw calls and texel size.
 */

type ShaderPatch = Parameters<Material["onBeforeCompile"]>[0];

export interface VariantInfo {
  name: string;
  cascades: { split: number; halfExtent: number; texelCm: number }[];
  patchedMaterials: number;
  lostPatches: number;
}

export interface MeasureResult {
  frames: number;
  gpuTotal: Stats;
  gpuShadow: Stats;
  cpuRender: Stats;
  calls: number;
  shadowCalls: number;
  triangles: number;
  programs: number;
  sample: { renders: number; shadowRenders: number; scenes: string[] } | null;
}

interface Stats { avg: number; p50: number; p95: number; max: number }

function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1),
    p50: sorted[Math.floor(0.5 * sorted.length)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

const LIT = ["isMeshStandardMaterial", "isMeshPhysicalMaterial", "isMeshLambertMaterial", "isMeshPhongMaterial", "isMeshToonMaterial"];

function litMaterials(scene: Scene): Material[] {
  const set = new Set<Material>();
  scene.traverse((object: Object3D) => {
    const material = (object as { material?: Material | Material[] }).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (LIT.some((flag) => (entry as unknown as Record<string, unknown>)[flag])) set.add(entry);
    }
  });
  return [...set];
}

// --- Forge prototype shader patch ---------------------------------------------

const DIR_SHADOW_LINE = "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";
const FADE = 0.05;

function cascadeStep(k: number): string {
  return `
  #if NUM_DIR_LIGHT_SHADOWS > ${k}
  if ( forgeRemaining > 0.0 ) {
    forgeCoord = vDirectionalShadowCoord[ ${k} ].xyz / vDirectionalShadowCoord[ ${k} ].w;
    forgeWeight = clamp( min( min( forgeCoord.x, 1.0 - forgeCoord.x ), min( forgeCoord.y, 1.0 - forgeCoord.y ) ) / ${FADE.toFixed(4)}, 0.0, 1.0 );
    if ( forgeWeight > 0.0 ) {
      forgeAccum += forgeRemaining * forgeWeight * getShadow( directionalShadowMap[ ${k} ], directionalLightShadows[ ${k} ].shadowMapSize, directionalLightShadows[ ${k} ].shadowIntensity, directionalLightShadows[ ${k} ].shadowBias, directionalLightShadows[ ${k} ].shadowRadius, vDirectionalShadowCoord[ ${k} ] );
      forgeRemaining *= 1.0 - forgeWeight;
    }
  }
  #endif`;
}

function forgeLightsChunk(): string {
  const base = ShaderChunk.lights_fragment_begin;
  if (!base.includes(DIR_SHADOW_LINE)) throw new Error("three lights_fragment_begin changed: directional shadow line not found");
  const select = `
float forgeSunShadow = 1.0;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
{
  float forgeRemaining = 1.0;
  float forgeAccum = 0.0;
  vec3 forgeCoord;
  float forgeWeight;
  ${[0, 1, 2, 3].map(cascadeStep).join("\n")}
  forgeSunShadow = forgeAccum + forgeRemaining;
}
#endif
`;
  // The helper cascade lights (shadowed dir lights 1..N-1) carry no light: skip their BRDF.
  const at = base.indexOf(DIR_SHADOW_LINE);
  const direct = base.indexOf("RE_Direct(", at);
  const directEnd = base.indexOf(";", direct) + 1;
  const replaced = base.slice(0, at) + `
		#if ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= ( directLight.visible && receiveShadow ) ? forgeSunShadow : 1.0;
		#endif` + base.slice(at + DIR_SHADOW_LINE.length, direct) + `#if ( UNROLLED_LOOP_INDEX == 0 ) || ( UNROLLED_LOOP_INDEX >= NUM_DIR_LIGHT_SHADOWS )
		${base.slice(direct, directEnd)}
		#endif` + base.slice(directEnd);
  return select + replaced;
}

interface SavedPatch {
  hadOwnPatch: boolean;
  patch: Material["onBeforeCompile"];
  hadOwnKey: boolean;
  key: Material["customProgramCacheKey"];
  defines: Record<string, unknown> | undefined;
}

function savePatch(material: Material): SavedPatch {
  const own = (key: string) => Object.prototype.hasOwnProperty.call(material, key);
  return {
    hadOwnPatch: own("onBeforeCompile"),
    patch: material.onBeforeCompile,
    hadOwnKey: own("customProgramCacheKey"),
    key: material.customProgramCacheKey,
    defines: (material as { defines?: Record<string, unknown> }).defines ? { ...(material as { defines?: Record<string, unknown> }).defines } : undefined,
  };
}

function restorePatch(material: Material, saved: SavedPatch): void {
  const target = material as unknown as Record<string, unknown>;
  if (saved.hadOwnPatch) material.onBeforeCompile = saved.patch;
  else delete target.onBeforeCompile;
  if (saved.hadOwnKey) material.customProgramCacheKey = saved.key;
  else delete target.customProgramCacheKey;
  target.defines = saved.defines;
  material.needsUpdate = true;
}

/** Chains `extra` after the material's own patch; the cache key keeps the prior one. */
function chainPatch(material: Material, saved: SavedPatch, tag: string, extra: (shader: ShaderPatch, renderer: WebGLRenderer) => void): void {
  const prior = saved.hadOwnPatch ? saved.patch : null;
  const priorKey = saved.hadOwnKey ? saved.key.call(material) : prior ? prior.toString() : "";
  material.onBeforeCompile = (shader, renderer) => {
    prior?.call(material, shader, renderer);
    extra(shader, renderer);
  };
  material.customProgramCacheKey = () => `${priorKey}|${tag}`;
  material.needsUpdate = true;
}

// --- Probe ----------------------------------------------------------------------

export interface ProbeOptions {
  shadowDistance: number;
  mapSize: number;
  splitLambda: number;
  /**
   * Untimed extra renders of the main scene after the timed one. At 3–4 ms of work
   * per 16.7 ms frame the GPU clocks down and timer queries inflate; this keeps it busy.
   */
  load: number;
}

export function createProbe(renderer: WebGLRenderer, scenes: Scene[], options: ProbeOptions) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;

  let sun: DirectionalLight | null = null;
  let scene: Scene | null = null;
  for (const candidate of scenes) {
    candidate.traverse((object) => {
      if (!sun && (object as DirectionalLight).isDirectionalLight && (object as DirectionalLight).castShadow) {
        sun = object as DirectionalLight;
        scene = candidate;
      }
    });
  }
  if (!sun || !scene) throw new Error("no shadow-casting directional light found");
  const theSun: DirectionalLight = sun;
  const theScene: Scene = scene;
  const sunColor = theSun.color.clone();
  const sunIntensity = theSun.intensity;
  const sunBiasSign = Math.sign(theSun.shadow.bias) || 1;
  const sunWorld = new Vector3();
  const sunTarget = new Vector3();
  theSun.getWorldPosition(sunWorld);
  theSun.target.getWorldPosition(sunTarget);
  const lightDirection = sunTarget.clone().sub(sunWorld).normalize();
  const originalChunks = { begin: ShaderChunk.lights_fragment_begin, pars: ShaderChunk.lights_pars_begin };

  // Frame + GPU segment accounting.
  let frameIndex = 0;
  let measuring = false;
  let mainCamera: PerspectiveCamera | null = null;
  let updatedThisFrame = false;
  const frameTotals = new Map<number, { total: number; shadow: number; cpu: number; calls: number; shadowCalls: number; triangles: number; renders: number; shadowRenders: number; scenes: string[] }>();
  const pending: { query: WebGLQuery; frame: number; shadow: boolean }[] = [];
  let openQuery: { query: WebGLQuery; shadow: boolean } | null = null;
  let beforeFrame: (() => void) | null = null;

  const acc = (frame: number) => {
    let entry = frameTotals.get(frame);
    if (!entry) frameTotals.set(frame, entry = { total: 0, shadow: 0, cpu: 0, calls: 0, shadowCalls: 0, triangles: 0, renders: 0, shadowRenders: 0, scenes: [] });
    return entry;
  };
  let inLoad = false;
  const begin = (shadow: boolean) => {
    if (!timer || !measuring || inLoad) return;
    const query = gl.createQuery()!;
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    openQuery = { query, shadow };
  };
  const end = () => {
    if (!timer || !openQuery || inLoad) return;
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    pending.push({ query: openQuery.query, frame: frameIndex, shadow: openQuery.shadow });
    openQuery = null;
  };
  const poll = () => {
    while (pending.length) {
      const item = pending[0]!;
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      if (!gl.getParameter(timer!.GPU_DISJOINT_EXT)) {
        const ms = Number(gl.getQueryParameter(item.query, gl.QUERY_RESULT)) / 1e6;
        const entry = acc(item.frame);
        entry.total += ms;
        if (item.shadow) entry.shadow += ms;
      }
      gl.deleteQuery(item.query);
    }
  };

  const tick = () => {
    poll();
    frameIndex += 1;
    updatedThisFrame = false;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Optional screenshot pose: applied only while the main scene renders, then undone.
  let view: { position: Vector3; lookAt: Vector3 } | null = null;
  const savedPosition = new Vector3();
  const savedQuaternion = new Quaternion();
  const originalRender = renderer.render.bind(renderer);
  renderer.render = (target: Object3D, camera: Camera) => {
    const posed = view !== null && target === theScene && (camera as PerspectiveCamera).isPerspectiveCamera;
    if (posed) {
      savedPosition.copy(camera.position);
      savedQuaternion.copy(camera.quaternion);
      camera.position.copy(view!.position);
      camera.lookAt(view!.lookAt);
      camera.updateMatrixWorld(true);
    }
    try {
      renderPosed(target, camera);
    } finally {
      if (posed) {
        camera.position.copy(savedPosition);
        camera.quaternion.copy(savedQuaternion);
        camera.updateMatrixWorld(true);
      }
    }
  };
  const renderPosed = (target: Object3D, camera: Camera) => {
    if (target === theScene && (camera as PerspectiveCamera).isPerspectiveCamera) {
      mainCamera = camera as PerspectiveCamera;
      if (!updatedThisFrame) {
        updatedThisFrame = true;
        beforeFrame?.();
      }
    }
    const started = performance.now();
    begin(false);
    originalRender(target, camera);
    end();
    if (measuring) {
      const entry = acc(frameIndex);
      entry.cpu += performance.now() - started;
      entry.renders += 1;
      entry.scenes.push(`${target === theScene ? "main" : target.type}:${camera.type}:${renderer.info.render.calls}`);
      // Forge resets renderer.info once per frame (autoReset off), so the last render's numbers are the frame's.
      entry.calls = renderer.info.autoReset ? entry.calls + renderer.info.render.calls : renderer.info.render.calls;
      entry.triangles = renderer.info.autoReset ? entry.triangles + renderer.info.render.triangles : renderer.info.render.triangles;
    }
    if (target === theScene && options.load > 0) {
      const { calls, triangles } = renderer.info.render;
      inLoad = true;
      for (let i = 0; i < options.load; i += 1) originalRender(target, camera);
      inLoad = false;
      renderer.info.render.calls = calls;
      renderer.info.render.triangles = triangles;
    }
  };
  const shadowMap = renderer.shadowMap as unknown as { render: (...args: unknown[]) => void };
  const originalShadowRender = shadowMap.render.bind(shadowMap);
  shadowMap.render = (...args: unknown[]) => {
    const callsBefore = renderer.info.render.calls;
    end();
    begin(true);
    originalShadowRender(...args);
    end();
    begin(false);
    if (measuring && !inLoad) {
      const entry = acc(frameIndex);
      entry.shadowCalls += renderer.info.render.calls - callsBefore;
      entry.shadowRenders += 1;
    }
  };

  const waitFrames = (count: number) => new Promise<void>((resolve) => {
    const stop = frameIndex + count;
    const check = () => (frameIndex >= stop ? resolve() : requestAnimationFrame(check));
    requestAnimationFrame(check);
  });

  // --- Variants ---------------------------------------------------------------

  let teardown: (() => void) | null = null;

  const splitsFor = (count: number, near: number): number[] => {
    const far = options.shadowDistance;
    const splits: number[] = [];
    for (let i = 1; i <= count; i += 1) {
      const log = near * (far / near) ** (i / count);
      const uniform = near + (far - near) * i / count;
      splits.push(options.splitLambda * log + (1 - options.splitLambda) * uniform);
    }
    return splits;
  };

  /** Sphere around the camera frustum from the eye to `distance` (stable under rotation). */
  const sliceSphere = (camera: PerspectiveCamera, distance: number) => {
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;
    const k2 = tanV * tanV + tanH * tanH;
    const center = Math.min(distance, (distance * (1 + k2)) / 2);
    const radius = Math.hypot(distance - center, distance * Math.sqrt(k2));
    return { center, radius: Math.max(radius, center) };
  };

  function setNone(): VariantInfo {
    theSun.castShadow = false;
    teardown = () => { theSun.castShadow = true; };
    return { name: "none", cascades: [], patchedMaterials: 0, lostPatches: 0 };
  }

  function setFollow(): VariantInfo {
    const camera = theSun.shadow.camera;
    const half = (camera.right - camera.left) / 2;
    return {
      name: "follow",
      cascades: [{ split: half * 1.5, halfExtent: half, texelCm: (200 * half) / theSun.shadow.mapSize.width }],
      patchedMaterials: 0,
      lostPatches: 0,
    };
  }

  function setCsm(count: number): VariantInfo {
    const camera = mainCamera!;
    const proxy = new PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
    proxy.matrixAutoUpdate = false;
    theSun.castShadow = false;
    theSun.visible = false;
    const csm = new CSM({
      camera: proxy,
      parent: theScene,
      cascades: count,
      maxFar: options.shadowDistance,
      mode: "practical",
      shadowMapSize: options.mapSize,
      shadowBias: sunBiasSign * 0.02 / 2000,
      lightDirection: lightDirection.clone(),
      lightIntensity: sunIntensity,
      lightFar: 2000,
      lightMargin: 200,
    });
    csm.fade = true;
    for (const light of csm.lights) light.color.copy(sunColor);
    const materials = litMaterials(theScene);
    const saved = new Map<Material, SavedPatch>();
    let lostPatches = 0;
    for (const material of materials) {
      const before = savePatch(material);
      saved.set(material, before);
      csm.setupMaterial(material);
      // setupMaterial assigns onBeforeCompile outright: count the Forge patches it drops,
      // then chain them back so the measurement renders the same scene.
      if (before.hadOwnPatch && material.onBeforeCompile !== before.patch) lostPatches += 1;
      const csmPatch = material.onBeforeCompile;
      chainPatch(material, before, `csm${count}`, (shader, r) => csmPatch.call(material, shader, r));
    }
    csm.updateFrustums();
    beforeFrame = () => {
      proxy.matrixWorld.copy(camera.matrixWorld);
      proxy.matrixWorldInverse.copy(camera.matrixWorldInverse);
      csm.update();
    };
    teardown = () => {
      beforeFrame = null;
      csm.remove();
      for (const light of csm.lights) light.shadow.dispose();
      // Not csm.dispose(): it deletes the materials' own onBeforeCompile, Forge's included.
      for (const [material, before] of saved) restorePatch(material, before);
      ShaderChunk.lights_fragment_begin = originalChunks.begin;
      ShaderChunk.lights_pars_begin = originalChunks.pars;
      theSun.visible = true;
      theSun.castShadow = true;
    };
    const breaks = csm.breaks.map((b: number) => b * Math.min(camera.far, options.shadowDistance));
    return {
      name: `csm${count}`,
      cascades: csm.lights.map((light: DirectionalLight, index: number) => {
        const half = (light.shadow.camera.right - light.shadow.camera.left) / 2;
        return { split: breaks[index] ?? 0, halfExtent: half, texelCm: (200 * half) / options.mapSize };
      }),
      patchedMaterials: materials.length,
      lostPatches,
    };
  }

  function setForge(count: number, stagger: boolean): VariantInfo {
    const camera = mainCamera!;
    const chunk = forgeLightsChunk();
    theSun.castShadow = false;
    theSun.visible = false;
    const group = new Group();
    group.name = "spike-sun-cascades";
    const lights: DirectionalLight[] = [];
    for (let index = 0; index < count; index += 1) {
      const light = new DirectionalLight(index === 0 ? sunColor : new Color(0, 0, 0), index === 0 ? sunIntensity : 0);
      light.castShadow = true;
      light.shadow.mapSize.set(options.mapSize, options.mapSize);
      group.add(light, light.target);
      lights.push(light);
    }
    theScene.add(group);
    const splits = splitsFor(count, 1);
    const spheres = splits.map((split) => sliceSphere(camera, split));
    const materials = litMaterials(theScene);
    const saved = new Map<Material, SavedPatch>();
    for (const material of materials) {
      const before = savePatch(material);
      saved.set(material, before);
      chainPatch(material, before, "forge-cascades", (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_begin>", chunk);
      });
    }
    const forward = new Vector3();
    const focus = new Vector3();
    let frame = 0;
    beforeFrame = () => {
      frame += 1;
      camera.getWorldDirection(forward);
      lights.forEach((light, index) => {
        const lazy = stagger && index >= 2;
        if (lazy && frame > 1) {
          light.shadow.autoUpdate = false;
          // Alternate the far cascades between frames; a stale map keeps its stale matrix.
          if ((frame + index) % 2 !== 0) return;
          light.shadow.needsUpdate = true;
        }
        const sphere = spheres[index]!;
        focus.copy(forward).multiplyScalar(sphere.center).add(camera.position);
        const result = computeFollowShadowFrame({
          lightDirection: [lightDirection.x, lightDirection.y, lightDirection.z],
          focus: [focus.x, focus.y, focus.z],
          halfExtent: sphere.radius,
          mapSize: options.mapSize,
          depthAbove: sphere.radius + 100,
          depthBelow: sphere.radius,
        });
        if (!result) return;
        light.position.set(...result.position);
        light.target.position.set(...result.target);
        light.updateMatrixWorld(true);
        light.target.updateMatrixWorld(true);
        const shadowCamera = light.shadow.camera;
        shadowCamera.left = result.left;
        shadowCamera.right = result.right;
        shadowCamera.top = result.top;
        shadowCamera.bottom = result.bottom;
        shadowCamera.near = result.near;
        shadowCamera.far = result.far;
        shadowCamera.updateProjectionMatrix();
        light.shadow.bias = sunBiasSign * 0.02 / result.far;
        light.shadow.normalBias = result.texelSize * 0.75;
      });
    };
    teardown = () => {
      beforeFrame = null;
      theScene.remove(group);
      for (const light of lights) light.shadow.dispose();
      for (const [material, before] of saved) restorePatch(material, before);
      theSun.visible = true;
      theSun.castShadow = true;
    };
    return {
      name: `forge${count}${stagger ? "-stagger" : ""}`,
      cascades: spheres.map((sphere, index) => ({
        split: splits[index]!,
        halfExtent: sphere.radius,
        texelCm: (200 * sphere.radius) / options.mapSize,
      })),
      patchedMaterials: materials.length,
      lostPatches: 0,
    };
  }

  return {
    timer: timer !== null,
    gpu: (() => {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    })(),
    sunMapSize: theSun.shadow.mapSize.width,
    async ready(): Promise<void> {
      await waitFrames(5);
      if (!mainCamera) throw new Error("main camera not captured");
    },
    camera(): { fov: number; aspect: number; near: number; far: number } {
      const camera = mainCamera!;
      return { fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far };
    },
    setView(pose: { position: [number, number, number]; lookAt: [number, number, number] } | null): void {
      view = pose ? { position: new Vector3(...pose.position), lookAt: new Vector3(...pose.lookAt) } : null;
      // Re-run the cascade fit for the posed camera on the next frame.
      updatedThisFrame = false;
    },
    cameraPosition(): [number, number, number] {
      const camera = mainCamera!;
      return [camera.position.x, camera.position.y, camera.position.z];
    },
    setVariant(name: string): VariantInfo {
      teardown?.();
      teardown = null;
      if (name === "none") return setNone();
      if (name === "follow") return setFollow();
      const csm = /^csm(\d)$/.exec(name);
      if (csm) return setCsm(Number(csm[1]));
      const forge = /^forge(\d)(-stagger)?$/.exec(name);
      if (forge) return setForge(Number(forge[1]), Boolean(forge[2]));
      throw new Error(`unknown variant ${name}`);
    },
    async measure(warmup: number, frames: number): Promise<MeasureResult> {
      await waitFrames(warmup);
      frameTotals.clear();
      const first = frameIndex + 1;
      measuring = true;
      await waitFrames(frames + 1);
      measuring = false;
      const last = frameIndex - 1;
      for (let i = 0; i < 30 && pending.length; i += 1) await waitFrames(1);
      const rows = [...frameTotals.entries()].filter(([frame]) => frame >= first && frame <= last).map(([, entry]) => entry);
      const mean = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0) / Math.max(rows.length, 1);
      return {
        frames: rows.length,
        gpuTotal: stats(rows.map((row) => row.total)),
        gpuShadow: stats(rows.map((row) => row.shadow)),
        cpuRender: stats(rows.map((row) => row.cpu)),
        calls: mean((row) => row.calls),
        shadowCalls: mean((row) => row.shadowCalls),
        triangles: mean((row) => row.triangles),
        programs: (renderer.info.programs ?? []).length,
        sample: rows[Math.floor(rows.length / 2)] ? { renders: rows[Math.floor(rows.length / 2)]!.renders, shadowRenders: rows[Math.floor(rows.length / 2)]!.shadowRenders, scenes: rows[Math.floor(rows.length / 2)]!.scenes } : null,
      };
    },
  };
}
