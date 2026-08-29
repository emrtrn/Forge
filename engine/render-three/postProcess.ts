import {
  ACESFilmicToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  Vector2,
  type Camera,
  type Material,
  type Mesh,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FilmPass } from "three/examples/jsm/postprocessing/FilmPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { RGBShiftShader } from "three/examples/jsm/shaders/RGBShiftShader.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";

import type { ResolvedPostProcess } from "@engine/scene/postProcess";

export {
  POST_PROCESS_DEFAULTS,
  resolvePostProcess,
  type PostProcessToneMapping,
  type PostProcessAntialias,
  type ResolvedPostProcess,
} from "@engine/scene/postProcess";

export const POST_PROCESS_RENDER_EXPOSURE_SCALE = 0.2;

export function postProcessToneMappingExposure(exposure: number): number {
  return Math.max(0, exposure * POST_PROCESS_RENDER_EXPOSURE_SCALE);
}

/** Applies the renderer-property part of the global Post Process singleton. */
export function applyPostProcessToneMapping(
  renderer: WebGLRenderer,
  resolved: ResolvedPostProcess | null,
): void {
  if (!resolved || resolved.hidden) return;
  if (resolved.toneMapping === "aces") {
    renderer.toneMapping = ACESFilmicToneMapping;
  } else if (resolved.toneMapping === "neutral") {
    renderer.toneMapping = NeutralToneMapping;
  } else {
    renderer.toneMapping = NoToneMapping;
  }
  renderer.toneMappingExposure = postProcessToneMappingExposure(resolved.exposure);
}

const COLOR_GRADING_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    temperature: { value: 0 },
    tint: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float temperature;
    uniform float tint;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // White balance: temperature warms (+) / cools (-); tint shifts magenta (+) / green (-).
      color.r += temperature * 0.1;
      color.b -= temperature * 0.1;
      color.g -= tint * 0.1;
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(vec3(luma), color.rgb, saturation);
      gl_FragColor = color;
    }
  `,
};

/**
 * Bloom strength is authored in intuitive ~1-based units (1 = the standard sun
 * bloom look, matching threshold/radius) but the analytic Sky sun disc has
 * enormous linear-HDR radiance, so a tiny actual UnrealBloomPass strength already
 * reads strongly. This factor maps authored intensity to that strength (1 → 0.001).
 */
const BLOOM_INTENSITY_SCALE = 0.001;

/**
 * Authored chromatic-aberration amount (~1-based) maps to the RGBShift shader's
 * UV shift distance, which is tiny (its default 0.005 is already visible). This
 * factor keeps the authored slider intuitive (0.5 → the 0.005 default look).
 */
const CHROMATIC_ABERRATION_AMOUNT_SCALE = 0.01;

/**
 * DoF is authored against the 100u far-plane scale. `focusDistance` is passed
 * straight through as world units; `aperture`/`maxBlur` are authored ~1-based and
 * scaled to the BokehShader's much smaller blur units (factor·aperture clamped to
 * maxblur, where the depth `factor` can reach ~90 in this scene).
 */
const DOF_APERTURE_SCALE = 0.0002;
const DOF_MAXBLUR_SCALE = 0.01;

/**
 * GTAO `radius` is in world units. Although the far plane is 100u, actual content
 * here is sub-unit (the demo character spawns at 0.3 scale, ~0.5u tall), so the
 * AO sample radius must be small or it spans whole objects and self-occludes them
 * to black. This factor maps the intuitive ~1-based slider to that small world
 * radius (1 → 0.1u, contact-shadow scale). `intensity` passes straight through to
 * `blendIntensity` (1 = full AO).
 */
const AO_RADIUS_SCALE = 0.1;

/**
 * Whether an object contributes to the beauty pass's depth buffer — the test that
 * decides whether it may contribute to the AO one.
 *
 * A `depthWrite: false` material is the engine-wide marker for "this is drawn over
 * the world, it is not part of it": overlays and decals, particle sprites, the
 * cloud dome, invisible pick volumes, and any Forge material authored
 * `alphaMode: blend` all set it. Non-meshes have no material to ask and are left
 * to the type checks. A multi-material mesh counts as writing depth when *any*
 * slot does, since that slot is real surface.
 */
export function writesSceneDepth(object: Object3D): boolean {
  const mesh = object as Mesh;
  if (!mesh.isMesh) return true;
  const material = mesh.material as Material | Material[] | undefined;
  if (!material) return true;
  const slots = Array.isArray(material) ? material : [material];
  return slots.length === 0 || slots.some((slot) => slot?.depthWrite !== false);
}

/**
 * GTAOPass computes AO from a normal+depth G-buffer it renders by **overriding the
 * whole scene's material**. That override is the trap: it replaces each material
 * with an opaque depth/normal one, so an object that writes no depth in the beauty
 * pass suddenly writes a solid depth wall in the AO pass — occluding everything
 * behind it and self-occluding to black — while never appearing to be lit at all.
 *
 * GTAOPass's built-in cull only skips Points / Lines. This subclass also skips:
 *
 *  - **Sprites** — camera-facing quads, which showed as black halos around the
 *    editor's billboard actor icons.
 *  - **Anything that writes no depth** ({@link writesSceneDepth}) — the general
 *    form of the same bug. It covers translucent ground overlays (selection
 *    decals, placement previews), deliberately invisible pick volumes, particle
 *    sprites and the cloud dome, without any of them having to know that AO
 *    exists. Without it a zero-opacity pick box draws a dark cube around whatever
 *    it wraps, and a blended overlay renders as flat black.
 *  - **`userData.noAmbientOcclusion === true`** — the explicit opt-out, for real
 *    depth-writing geometry that still should not receive AO.
 *
 * Solid geometry — including characters — stays in and gets proper AO (see
 * {@link AO_RADIUS_SCALE} for the tuning that keeps small objects from
 * self-occluding). Visibility is restored by the base pass within the same frame
 * (after the beauty RenderPass), so nothing else is affected.
 */
class ForgeGtaoPass extends GTAOPass {
  /** Overrides GTAOPass's internal (untyped) normal-pass visibility cull. */
  _overrideVisibility(): void {
    const cache = (this as unknown as { _visibilityCache: Object3D[] })._visibilityCache;
    this.scene.traverse((object) => {
      if (!object.visible) return;
      const probe = object as Object3D & {
        isPoints?: boolean;
        isLine?: boolean;
        isLine2?: boolean;
        isSprite?: boolean;
      };
      if (
        probe.isPoints ||
        probe.isLine ||
        probe.isLine2 ||
        probe.isSprite ||
        object.userData.noAmbientOcclusion === true ||
        !writesSceneDepth(object)
      ) {
        object.visible = false;
        cache.push(object);
      }
    });
  }
}

/** Returns true when the grading ShaderPass would change the image at all. */
function hasColorGrading(resolved: ResolvedPostProcess): boolean {
  return (
    resolved.saturation !== 1 ||
    resolved.contrast !== 1 ||
    resolved.temperature !== 0 ||
    resolved.tint !== 0
  );
}

/**
 * Bloom render-target size for a resolution scale (quality knob): `1` keeps the
 * composer size, `0.5` halves it (quarter the bloom pixels). Floors to 1 and
 * falls back to full size on bad input. Pure so it is unit-tested without a GL
 * context.
 */
export function scaledBloomResolution(
  width: number,
  height: number,
  scale: number,
): [number, number] {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
}

/**
 * UnrealBloomPass that renders at a fraction of the composer resolution. The
 * composer re-drives `setSize` with its (pixel-ratio-multiplied) size on every
 * resize, so the scale must be re-applied there — a smaller constructor
 * resolution alone would be overwritten on the first composer resize.
 */
class ScaledBloomPass extends UnrealBloomPass {
  private readonly resolutionScale: number;

  constructor(
    resolution: Vector2,
    strength: number,
    radius: number,
    threshold: number,
    resolutionScale: number,
  ) {
    super(resolution, strength, radius, threshold);
    this.resolutionScale = resolutionScale > 0 ? resolutionScale : 1;
  }

  override setSize(width: number, height: number): void {
    const [w, h] = scaledBloomResolution(width, height, this.resolutionScale);
    super.setSize(w, h);
  }
}

export function createPostProcessEffectPasses(
  resolved: ResolvedPostProcess | null,
  context: {
    scene: Scene;
    camera: Camera;
    width: number;
    height: number;
    /** Quality bloom render-scale (1 = full, 0.5 = half); defaults to full. */
    bloomResolutionScale?: number;
  },
): Pass[] {
  if (!resolved || resolved.hidden) return [];
  const { width, height } = context;
  const passes: Pass[] = [];
  // Order (Section E): AO right after beauty → DoF → Bloom → grading → chromatic
  // aberration → vignette → grain, with OutlinePass/OutputPass appended later by
  // the pipeline.
  if (resolved.ao.enabled) {
    const gtaoPass = new ForgeGtaoPass(context.scene, context.camera, width, height);
    gtaoPass.updateGtaoMaterial({ radius: resolved.ao.radius * AO_RADIUS_SCALE });
    gtaoPass.blendIntensity = resolved.ao.intensity;
    // GTAOPass sizes its render targets + camera projection uniforms in setSize.
    gtaoPass.setSize(width, height);
    passes.push(gtaoPass);
  }
  if (resolved.dof.enabled) {
    const bokehPass = new BokehPass(context.scene, context.camera, {
      focus: resolved.dof.focusDistance,
      aperture: resolved.dof.aperture * DOF_APERTURE_SCALE,
      maxblur: resolved.dof.maxBlur * DOF_MAXBLUR_SCALE,
    });
    // BokehPass starts with a 1x1 depth target; size it before it enters the chain.
    bokehPass.setSize(width, height);
    passes.push(bokehPass);
  }
  if (resolved.bloom.enabled) {
    const bloomScale = context.bloomResolutionScale ?? 1;
    const [bloomW, bloomH] = scaledBloomResolution(width, height, bloomScale);
    passes.push(
      new ScaledBloomPass(
        new Vector2(bloomW, bloomH),
        resolved.bloom.intensity * BLOOM_INTENSITY_SCALE,
        resolved.bloom.radius,
        resolved.bloom.threshold,
        bloomScale,
      ),
    );
  }
  if (hasColorGrading(resolved)) {
    const gradingPass = new ShaderPass(COLOR_GRADING_SHADER);
    gradingPass.uniforms.saturation!.value = resolved.saturation;
    gradingPass.uniforms.contrast!.value = resolved.contrast;
    gradingPass.uniforms.temperature!.value = resolved.temperature;
    gradingPass.uniforms.tint!.value = resolved.tint;
    passes.push(gradingPass);
  }
  if (resolved.chromaticAberration.enabled) {
    const caPass = new ShaderPass(RGBShiftShader);
    caPass.uniforms.amount!.value =
      resolved.chromaticAberration.amount * CHROMATIC_ABERRATION_AMOUNT_SCALE;
    passes.push(caPass);
  }
  if (resolved.vignette.enabled) {
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset!.value = resolved.vignette.offset;
    vignettePass.uniforms.darkness!.value = resolved.vignette.intensity;
    passes.push(vignettePass);
  }
  if (resolved.grain.enabled) {
    // FilmShader is pure grain (no scanlines) in three r150+, so no toggle needed.
    passes.push(new FilmPass(resolved.grain.intensity, false));
  }
  return passes;
}

export function hasPostProcessEffectPasses(resolved: ResolvedPostProcess | null): boolean {
  return Boolean(
    resolved &&
      !resolved.hidden &&
      (resolved.bloom.enabled ||
        resolved.vignette.enabled ||
        resolved.dof.enabled ||
        resolved.ao.enabled ||
        resolved.chromaticAberration.enabled ||
        resolved.grain.enabled ||
        resolved.antialias !== "none" ||
        hasColorGrading(resolved)),
  );
}

export function createPostProcessAntialiasPass(
  resolved: ResolvedPostProcess | null,
  size: { width: number; height: number },
): Pass | null {
  if (!resolved || resolved.hidden || resolved.antialias === "none") return null;
  if (resolved.antialias === "smaa") {
    const pass = new SMAAPass();
    pass.setSize(size.width, size.height);
    return pass;
  }
  return null;
}

/**
 * Shared composer backbone for editor/runtime post-process work. F2.0 only owns
 * RenderPass/OutputPass and lets callers inject editor-only passes before output.
 */
export class PostProcessPipeline {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly outputPass: OutputPass;
  private readonly injectedPasses: Pass[] = [];
  private effectPasses: Pass[] = [];
  private antialiasPass: Pass | null = null;

  constructor(options: {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: Camera;
    width: number;
    height: number;
  }) {
    this.composer = new EffectComposer(options.renderer);
    this.renderPass = new RenderPass(options.scene, options.camera);
    this.composer.addPass(this.renderPass);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.composer.setSize(options.width, options.height);
  }

  setCamera(camera: Camera): void {
    this.renderPass.camera = camera;
  }

  addPassBeforeOutput(pass: Pass): void {
    this.composer.insertPass(pass, this.finalStageStartIndex());
    this.injectedPasses.push(pass);
  }

  setEffectPasses(passes: Pass[]): void {
    for (const pass of this.effectPasses) {
      this.composer.removePass(pass);
      pass.dispose();
    }
    this.effectPasses = passes;
    const insertIndex = this.finalStageStartIndex();
    passes.forEach((pass, offset) => {
      this.composer.insertPass(pass, insertIndex + offset);
    });
  }

  setAntialiasPass(pass: Pass | null): void {
    if (this.antialiasPass) {
      this.composer.removePass(this.antialiasPass);
      this.antialiasPass.dispose();
    }
    this.antialiasPass = pass;
    if (pass) {
      const outputIndex = this.composer.passes.indexOf(this.outputPass);
      this.composer.insertPass(pass, outputIndex >= 0 ? outputIndex : this.composer.passes.length);
    }
  }

  render(deltaSeconds: number): void {
    this.composer.render(deltaSeconds);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  /**
   * Syncs the composer's internal render-target scale to the renderer's pixel
   * ratio. The composer caches its own `_pixelRatio` at construction, so a
   * runtime pixel-ratio change (e.g. a quality render-scale step) must be pushed
   * here or the post-process targets keep the stale resolution.
   */
  setPixelRatio(pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
  }

  dispose(): void {
    for (const pass of this.effectPasses) pass.dispose();
    for (const pass of this.injectedPasses) pass.dispose();
    this.antialiasPass?.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
  }

  private finalStageStartIndex(): number {
    const indices = [
      ...this.injectedPasses.map((pass) => this.composer.passes.indexOf(pass)),
      this.antialiasPass ? this.composer.passes.indexOf(this.antialiasPass) : -1,
      this.composer.passes.indexOf(this.outputPass),
    ].filter((index) => index >= 0);
    return indices.length > 0
      ? Math.min(...indices)
      : this.composer.passes.length;
  }
}
