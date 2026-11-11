// Post-process pipeline for the WebGPU spike (S3): one RenderPipeline over an MRT
// scene pass, effects behind flags. The thin wrapper the plan (§2.4) asks for:
// the three addons are used only here. Throwaway spike code.
//
// Order: scene pass (MRT) -> AO / SSGI / SSR composite -> TRAA (HDR) -> bloom ->
// the pipeline's output transform (renderer tone mapping + exposure, as S2).
// MRT attachments are added only for the effects that read them, so each
// configuration pays for its own bandwidth:
//   output RGBA16F; normal RGBA8 (packed view normal) for GTAO / SSR / SSGI;
//   velocity RGBA16F for TRAA; metalrough RGBA8 for SSR; diffuseColor RGBA8 for SSGI.
import * as THREE from "three/webgpu";
import * as TSLTyped from "three/tsl";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { ssr } from "three/examples/jsm/tsl/display/SSRNode.js";
import { ssgi } from "three/examples/jsm/tsl/display/SSGINode.js";
import { traa } from "three/examples/jsm/tsl/display/TRAANode.js";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";

// TSL's typings reject some valid uses; untyped like shared/terrain.ts.
const TSL = TSLTyped as any;

export interface PipelineFlags {
  /** "composite": GTAO from the scene pass's normal / depth, multiplied in the composite (one geometry pass, like Forge WebGL).
   *  "lighting": three's documented path, a normal / depth pre-pass and `builtinAOContext` (AO on indirect light only). */
  gtao?: "composite" | "lighting" | false;
  ssr?: boolean;
  /** SSGI medium preset with temporal filtering; its AO channel replaces GTAO. */
  ssgi?: boolean;
  traa?: boolean;
  bloom?: boolean;
  /** Attach every MRT target without any effect (bandwidth only). */
  mrtFull?: boolean;
  /** GTAO / SSR / SSGI at half resolution (`resolutionScale` 0.5). */
  half?: boolean;
  /** SSR alone at half resolution (Balanced: SSR allowed at half resolution, user decision 2026-11-11). */
  ssrHalf?: boolean;
}

export interface BloomSettings { strength: number; radius: number; threshold: number }

/** Forge's authored bloom on the reference levels (Derekavak: threshold 1, intensity 1, radius 1). */
export const DEFAULT_BLOOM: BloomSettings = { strength: 1, radius: 1, threshold: 1 };

/** SSR / SSGI settings used for every measurement (recorded in the report). */
export const EFFECT_SETTINGS = {
  ssr: { stochastic: false, reflectNonMetals: true, quality: 0.5, maxDistance: 50, thickness: 0.5, resolutionScale: 1, blurQuality: 2 },
  ssgi: { sliceCount: 2, stepCount: 8, temporalFiltering: true, resolutionScale: 1 },
  gtao: { resolutionScale: 1 },
  half: "the -half rows set resolutionScale 0.5 on GTAO / SSR / SSGI",
};

export interface SpikePipeline {
  flags: PipelineFlags;
  render(): void;
  dispose(): void;
  describe: Record<string, unknown>;
}

export function createPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, flags: PipelineFlags, bloomSettings: BloomSettings = DEFAULT_BLOOM): SpikePipeline {
  const { pass, mrt, output, normalView, packNormalToRGB, unpackRGBToNormal, velocity, metalness, roughness, diffuseColor, vec2, vec4, sample, screenUV, builtinAOContext } = TSL;
  const disposables: { dispose(): void }[] = [];
  const scale = flags.half ? 0.5 : 1;
  const gtaoMode = flags.ssgi ? false : (flags.gtao ?? false);
  const needNormal = flags.mrtFull || gtaoMode === "composite" || flags.ssr || flags.ssgi;
  const needVelocity = flags.mrtFull || flags.traa;
  const needMetalRough = flags.mrtFull || flags.ssr;
  const needDiffuse = flags.mrtFull || flags.ssgi;

  const scenePass = pass(scene, camera);
  disposables.push(scenePass);
  const outputs: Record<string, unknown> = { output };
  if (needNormal) outputs.normal = packNormalToRGB(normalView);
  if (needVelocity) outputs.velocity = velocity;
  if (needMetalRough) outputs.metalrough = vec2(metalness, roughness);
  if (needDiffuse) outputs.diffuseColor = diffuseColor;
  scenePass.setMRT(mrt(outputs));
  const byteTargets = ["normal", "metalrough", "diffuseColor"].filter((k) => k in outputs);
  for (const name of byteTargets) scenePass.getTexture(name).type = THREE.UnsignedByteType;

  const color = scenePass.getTextureNode("output");
  const depth = scenePass.getTextureNode("depth");
  const normal = needNormal ? sample((uv: unknown) => unpackRGBToNormal(scenePass.getTextureNode("normal").sample(uv))) : null;

  let rgb = color.rgb;
  const effects: string[] = [];

  if (gtaoMode === "composite") {
    const aoNode = ao(depth, normal, camera);
    disposables.push(aoNode);
    aoNode.resolutionScale = scale;
    rgb = rgb.mul(aoNode.getTextureNode().r);
    effects.push("gtao-composite");
  } else if (gtaoMode === "lighting") {
    const prePass = pass(scene, camera);
    disposables.push(prePass);
    prePass.setMRT(mrt({ output: packNormalToRGB(normalView) }));
    prePass.getTexture("output").type = THREE.UnsignedByteType;
    const preNormal = sample((uv: unknown) => unpackRGBToNormal(prePass.getTextureNode("output").sample(uv)));
    const aoNode = ao(prePass.getTextureNode("depth"), preNormal, camera);
    disposables.push(aoNode);
    aoNode.resolutionScale = scale;
    scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r);
    effects.push("gtao-lighting");
  }

  if (flags.ssgi) {
    const giNode = ssgi(color, depth, normal, camera);
    disposables.push(giNode);
    giNode.sliceCount.value = EFFECT_SETTINGS.ssgi.sliceCount;
    giNode.stepCount.value = EFFECT_SETTINGS.ssgi.stepCount;
    giNode.useTemporalFiltering = EFFECT_SETTINGS.ssgi.temporalFiltering;
    giNode.resolutionScale = scale;
    const diffuse = scenePass.getTextureNode("diffuseColor");
    rgb = rgb.mul(giNode.a).add(diffuse.rgb.mul(giNode.rgb));
    effects.push("ssgi");
  }

  if (flags.ssr) {
    const metalRough = scenePass.getTextureNode("metalrough");
    const s = EFFECT_SETTINGS.ssr;
    const ssrNode = ssr(color, depth, normal, { metalnessNode: metalRough.r, roughnessNode: metalRough.g, reflectNonMetals: s.reflectNonMetals, stochastic: s.stochastic, camera });
    disposables.push(ssrNode);
    ssrNode.quality.value = s.quality;
    ssrNode.maxDistance.value = s.maxDistance;
    ssrNode.thickness.value = s.thickness;
    ssrNode.resolutionScale = s.resolutionScale * (flags.ssrHalf ? 0.5 : scale);
    ssrNode.blurQuality = s.blurQuality;
    rgb = rgb.add(ssrNode.rgb);
    effects.push("ssr");
  }

  let node = effects.length ? vec4(rgb, color.a) : color;

  if (flags.traa) {
    const traaNode = traa(node, depth, scenePass.getTextureNode("velocity"), camera);
    disposables.push(traaNode);
    node = traaNode;
    effects.push("traa");
  }

  if (flags.bloom) {
    const bloomNode = bloom(node, bloomSettings.strength, bloomSettings.radius, bloomSettings.threshold);
    disposables.push(bloomNode);
    node = node.add(bloomNode);
    effects.push("bloom");
  }

  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = node;

  return {
    flags,
    render: () => pipeline.render(),
    dispose() {
      pipeline.dispose();
      for (const d of disposables) d.dispose();
    },
    describe: { effects, mrt: Object.keys(outputs), byteTargets, gtao: gtaoMode, resolutionScale: scale, ssrResolutionScale: flags.ssr ? EFFECT_SETTINGS.ssr.resolutionScale * (flags.ssrHalf ? 0.5 : scale) : null, bloom: flags.bloom ? bloomSettings : null },
  };
}

/** Named configurations: the sweep rows and the profile candidates. `null` = direct render without a pipeline. */
export const CONFIGS: Record<string, PipelineFlags | null> = {
  direct: null,
  pass: {},
  "mrt-full": { mrtFull: true },
  gtao: { gtao: "composite" },
  "gtao-half": { gtao: "composite", half: true },
  "gtao-lighting": { gtao: "lighting" },
  ssr: { ssr: true },
  "ssr-half": { ssr: true, half: true },
  ssgi: { ssgi: true },
  "ssgi-half": { ssgi: true, half: true },
  traa: { traa: true },
  bloom: { bloom: true },
  balanced: { traa: true, gtao: "composite", bloom: true },
  "balanced-ssr": { traa: true, gtao: "composite", ssr: true, bloom: true },
  "balanced-ssr-half": { traa: true, gtao: "composite", ssr: true, ssrHalf: true, bloom: true },
  "balanced-ssgi": { traa: true, ssgi: true, bloom: true },
  cinematic: { traa: true, ssgi: true, ssr: true, bloom: true },
};
