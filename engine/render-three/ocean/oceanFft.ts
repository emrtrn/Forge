import { Color, FloatType, GLSL3, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, MathUtils,
  NearestFilter, RawShaderMaterial, RepeatWrapping, Vector4, WebGLRenderTarget,
  type RenderTargetOptions, type Texture, type WebGLRenderer } from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { OCEAN_WAVES, validateOceanWater, type OceanWaterBody } from "../../scene/oceanWater";
import { ASSEMBLE_FRAG, CASCADE_LENGTHS, EVOLVE_FRAG, FFT_FRAG, INIT_FRAG, LOG_N, N } from "./oceanSpectrum";

const pass = (fragmentShader: string, uniforms: RawShaderMaterial["uniforms"]) => new RawShaderMaterial({
  glslVersion: GLSL3, depthTest: false, depthWrite: false, uniforms, fragmentShader,
  vertexShader: "in vec3 position; void main(){gl_Position=vec4(position.xy,0.,1.);}",
});
/** A single level-owned simulation. Capture passes only read its published textures. */
export class OceanFft {
  readonly lengths = CASCADE_LENGTHS;
  readonly displacement: Texture[] = [];
  readonly slopes: Texture[] = [];
  readonly stats = { time: 0, updates: 0, draws: 0, textureBytes: 0 };
  private readonly h0: WebGLRenderTarget;
  private readonly ping: WebGLRenderTarget;
  private readonly pong: WebGLRenderTarget;
  private readonly outputs: [WebGLRenderTarget, WebGLRenderTarget][];
  private readonly init: RawShaderMaterial;
  private readonly evolve: RawShaderMaterial;
  private readonly fft: RawShaderMaterial;
  private readonly assemble: RawShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly waves: typeof OCEAN_WAVES;
  private dirty = true;
  private parity = 0;
  private disposed = false;
  constructor(private readonly renderer: WebGLRenderer, value: OceanWaterBody) {
    this.waves = { ...OCEAN_WAVES, ...validateOceanWater(value).waves };
    if (!renderer.extensions.has("EXT_color_buffer_float")) throw new Error("Ocean FFT requires float render targets");
    const fft: RenderTargetOptions = { type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter,
      depthBuffer: false, generateMipmaps: false };
    this.h0 = new WebGLRenderTarget(N, N * 4, fft);
    this.ping = new WebGLRenderTarget(N, N * 4, { ...fft, type: HalfFloatType, count: 2 });
    this.pong = this.ping.clone();
    const out: RenderTargetOptions = { type: HalfFloatType, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
      wrapS: RepeatWrapping, wrapT: RepeatWrapping, depthBuffer: false, generateMipmaps: true, count: 2 };
    this.outputs = CASCADE_LENGTHS.map(() => [new WebGLRenderTarget(N, N, out), new WebGLRenderTarget(N, N, out)]);
    const lengths = new Vector4(...CASCADE_LENGTHS);
    this.init = pass(INIT_FRAG, { uSpecA: { value: [new Vector4(), new Vector4()] },
      uSpecB: { value: [new Vector4(), new Vector4()] }, uLength: { value: lengths },
      uCut: { value: new Vector4(...CASCADE_LENGTHS.slice(1).map(l => 2 * Math.PI / l * 6), 0) },
      uCapFade: { value: .08 }, uSeed: { value: this.waves.seed } });
    this.evolve = pass(EVOLVE_FRAG, { uH0: { value: this.h0.texture }, uLength: { value: lengths }, uTime: { value: 0 } });
    this.fft = pass(FFT_FRAG, { uIn0: { value: null }, uIn1: { value: null }, uSub: { value: 2 }, uVertical: { value: 0 } });
    this.assemble = pass(ASSEMBLE_FRAG, { uIn0: { value: null }, uIn1: { value: null }, uPrev: { value: null },
      uCascade: { value: 0 }, uLambda: { value: this.waves.choppiness }, uDt: { value: 0 }, uFoamRecovery: { value: .7 } });
    this.quad = new FullScreenQuad(this.init);
    // Format accounting includes every mip, not driver overhead or other water effects.
    this.stats.textureBytes = N * N * 4 * 16 + 2 * N * N * 4 * 2 * 8
      + 4 * 2 * 2 * 8 * Array.from({ length: LOG_N + 1 }, (_, i) => (N >> i) ** 2).reduce((a, b) => a + b, 0);
    try {
      this.preserveState(() => {
        renderer.setClearColor(0, 1);
        for (const target of [this.h0, this.ping, this.pong, ...this.outputs.flat()]) {
          renderer.setRenderTarget(target);
          if (renderer.getContext().checkFramebufferStatus(renderer.getContext().FRAMEBUFFER) !== renderer.getContext().FRAMEBUFFER_COMPLETE)
            throw new Error("Ocean FFT framebuffer formats are unsupported");
          renderer.clear(true, false, false);
        }
      });
      this.publish();
    } catch (error) { this.dispose(); throw error; }
  }
  private preserveState(work: () => void): void {
    const r = this.renderer, target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const clear = r.getClearColor(new Color()), alpha = r.getClearAlpha(), auto = r.autoClear;
    const viewport = r.getViewport(new Vector4()), scissor = r.getScissor(new Vector4()), scissorTest = r.getScissorTest();
    try { r.autoClear = true; r.setScissorTest(false); work(); }
    finally { r.setRenderTarget(target, face, mip); r.setViewport(viewport); r.setScissor(scissor);
      r.setScissorTest(scissorTest); r.setClearColor(clear, alpha); r.autoClear = auto; }
  }
  private draw(material: RawShaderMaterial, target: WebGLRenderTarget): void {
    this.quad.material = material; this.renderer.setRenderTarget(target); this.quad.render(this.renderer); this.stats.draws++;
  }
  private spectrum(): void {
    const p = this.waves, u = this.init.uniforms;
    const spec = (speed: number, km: number) => [ .076 * (9.81 * km * 1000 / speed ** 2) ** -.22,
      22 * (speed * km * 1000 / 9.81 ** 2) ** -.33 ];
    const wind = spec(p.windSpeed, p.fetchKm), swell = spec(7, 900);
    u.uSpecA!.value[0].set(1, MathUtils.degToRad(p.windDirection), .85, .25);
    u.uSpecB!.value[0].set(wind[0], wind[1], 3.3, .04);
    u.uSpecA!.value[1].set(p.swellStrength, MathUtils.degToRad(p.swellDirection), 1, 1);
    u.uSpecB!.value[1].set(swell[0], swell[1], 3.3, .04);
    this.draw(this.init, this.h0); this.dirty = false;
  }
  /** Called once by the frame owner, never from onBeforeRender. dt=0 freezes history. */
  update(delta: number): void {
    if (this.disposed) throw new Error("Ocean FFT is disposed");
    if (!Number.isFinite(delta) || delta < 0 || delta > .25) throw new Error("Ocean FFT delta must be in 0..0.25 seconds");
    if (delta === 0 && !this.dirty) return;
    this.stats.draws = 0;
    this.preserveState(() => {
      if (this.dirty) this.spectrum();
      this.stats.time = (this.stats.time + delta) % 300;
      this.evolve.uniforms.uTime!.value = this.stats.time; this.draw(this.evolve, this.ping);
      let src = this.ping, dst = this.pong;
      for (let dir = 0; dir < 2; dir++) for (let s = 1; s <= LOG_N; s++) {
        const u = this.fft.uniforms; u.uVertical!.value = dir; u.uSub!.value = 1 << s;
        u.uIn0!.value = src.textures[0]; u.uIn1!.value = src.textures[1]; this.draw(this.fft, dst); [src, dst] = [dst, src];
      }
      const u = this.assemble.uniforms, next = this.parity ^ 1;
      u.uIn0!.value = src.textures[0]; u.uIn1!.value = src.textures[1]; u.uDt!.value = delta;
      this.outputs.forEach((pair, c) => {
        u.uCascade!.value = c; u.uPrev!.value = pair[this.parity]!.textures[0]; this.draw(this.assemble, pair[next]!);
      });
      this.parity = next; this.publish(); this.stats.updates++;
    });
  }
  private publish(): void {
    this.outputs.forEach((pair, i) => { this.displacement[i] = pair[this.parity]!.textures[0]!; this.slopes[i] = pair[this.parity]!.textures[1]!; });
  }
  /** Explicit diagnostics only, never a physics query or per-frame readback. */
  async probe(): Promise<number[]> {
    if (this.disposed) throw new Error("Ocean FFT is disposed");
    const target = new WebGLRenderTarget(4, 4, { type: FloatType, depthBuffer: false });
    const material = pass("precision highp float; uniform sampler2D source; out vec4 result; void main(){result=textureLod(source,gl_FragCoord.xy/4.,0.);}",
      { source: { value: this.displacement[0] } });
    const quad = new FullScreenQuad(material), data = new Float32Array(64);
    try {
      this.preserveState(() => { this.renderer.setRenderTarget(target); quad.render(this.renderer); });
      await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, 4, 4, data);
      return Array.from(data);
    } finally { quad.dispose(); material.dispose(); target.dispose(); }
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const target of [this.h0, this.ping, this.pong, ...this.outputs.flat()]) target.dispose();
    for (const material of [this.init, this.evolve, this.fft, this.assemble]) material.dispose();
    this.quad.dispose(); this.displacement.length = this.slopes.length = 0;
  }
}
