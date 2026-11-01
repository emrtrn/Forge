import { BackSide, BufferAttribute, BufferGeometry, Color, DepthTexture, FrontSide, HalfFloatType, Matrix4, Mesh, NearestFilter,
  NoBlending, NoToneMapping, Points, Scene, ShaderMaterial, UnsignedIntType, Vector2, Vector3, WebGLRenderTarget,
  type Camera, type Texture, type WebGLRenderer } from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { resolveLakeAppearance } from "../scene/waterBody";
import { resolveLakeUnderwater } from "../scene/lakeUnderwater";
import type { QualitySettings } from "../perf/qualityProfiles";
import { selectUnderwaterBody, type LakeUnderwaterBody } from "./lakeUnderwaterVolume";
import { LAKE_WAVES_GLSL } from "./lakeWaves";
import { isPlanarReflectionCamera } from "./planarReflectionSource";

export interface UnderwaterQuality { level: "low" | "medium" | "high"; blur: boolean; particles: number }
export function underwaterQuality(settings: Pick<QualitySettings, "renderScale" | "dofAllowed" | "particleDensity">, globalDof = false): UnderwaterQuality {
  const level = settings.renderScale < .8 ? "low" : !settings.dofAllowed ? "medium" : "high";
  return { level, blur: level === "high" && settings.dofAllowed && !globalDof,
    particles: Math.max(0, Math.min(1, settings.particleDensity)) * (level === "low" ? 0 : level === "medium" ? 16 : 48) };
}
const VERTEX = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const DEPTH_GLSL = `
uniform sampler2D sceneDepth;
uniform mat4 inverseProjection;
uniform float reversed;
vec3 scenePosition(vec2 uv){float d=texture2D(sceneDepth,uv).r;vec4 p=inverseProjection*vec4(uv*2.-1.,mix(d*2.-1.,d,reversed),1.);return p.xyz/p.w;}
`;
const MASK_GLSL = `
uniform sampler2D entryMap;uniform sampler2D exitMap;
float waterExit(vec2 uv){
  vec4 a=texture2D(entryMap,uv),b=texture2D(exitMap,uv);
  // The first boundary after the near plane must be an exit. Above-water
  // rays seeing the top surface already have Lake's volume composition.
  return b.a>.5 && (a.a<.5 || b.r<a.r) ? b.r : 0.;
}`;

/** A stable post-beauty depth copy; never a second full-scene depth render. */
export class UnderwaterDepthPass extends Pass {
  private target: WebGLRenderTarget | null = null;
  constructor(private readonly effect: LakeUnderwaterPass) { super(); this.needsSwap = false; }
  override render(renderer: WebGLRenderer, _write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    const depth = read.depthTexture;
    if (!depth) { this.effect.setDepth(null); return; }
    if (!this.target || this.target.width !== read.width || this.target.height !== read.height || this.target.depthTexture!.type !== depth.type) {
      this.target?.dispose(); this.target = new WebGLRenderTarget(read.width, read.height, { depthTexture: new DepthTexture(read.width, read.height, depth.type) });
      this.target.texture.name = "Underwater.stableDepthOwner";
    }
    const previous = renderer.getRenderTarget();
    try { renderer.initRenderTarget(this.target); renderer.copyTextureToTexture(depth, this.target.depthTexture!); }
    finally { renderer.setRenderTarget(null); renderer.setRenderTarget(previous); }
    this.effect.setDepth(this.target.depthTexture!);
  }
  override dispose(): void { this.target?.dispose(); this.target = null; this.effect.setDepth(null); }
}

export class LakeUnderwaterPass extends Pass {
  private body: LakeUnderwaterBody | null = null;
  private camera: Camera;
  private entry: WebGLRenderTarget | null = null;
  private exit: WebGLRenderTarget | null = null;
  private readonly emptyGeometry = new BufferGeometry();
  private readonly proxy = new Mesh(this.emptyGeometry, new ShaderMaterial({
    vertexShader: `attribute float waterDepth;attribute float waterTop;varying float eyeDepth;${LAKE_WAVES_GLSL}
    void main(){vec3 p=position;p.y+=waterTop*lakeWaveOffset(position.xz,waterDepth);vec4 v=modelViewMatrix*vec4(p,1.);eyeDepth=-v.z;gl_Position=projectionMatrix*v;}`,
    fragmentShader: `varying float eyeDepth;void main(){gl_FragColor=vec4(eyeDepth,0.,0.,1.);}`, blending: NoBlending,
  }));
  private readonly material = new ShaderMaterial({ depthTest: false, depthWrite: false, blending: NoBlending, uniforms: {
    tDiffuse: { value: null as Texture | null }, sceneDepth: { value: null as Texture | null }, entryMap: { value: null as Texture | null }, exitMap: { value: null as Texture | null },
    effectEnabled: { value: 1 }, inverseProjection: { value: new Matrix4() }, reversed: { value: 0 }, size: { value: new Vector2(1, 1) }, clock: { value: 0 },
    extinction: { value: new Vector3() }, scatterColor: { value: new Color() }, distortion: { value: 0 }, blur: { value: 0 }, nearDepth: { value: .1 }, orthographic: { value: 0 },
  }, vertexShader: VERTEX, fragmentShader: `
    varying vec2 vUv;uniform sampler2D tDiffuse;uniform vec2 size;uniform float clock;uniform vec3 extinction;uniform vec3 scatterColor;
    uniform float effectEnabled;uniform float distortion;uniform float blur;uniform float nearDepth;uniform float orthographic;
    ${DEPTH_GLSL}${MASK_GLSL}
    void main(){
      vec4 original=texture2D(tDiffuse,vUv);if(effectEnabled<.5){gl_FragColor=original;return;}float end=waterExit(vUv);vec3 p=scenePosition(vUv);
      float depth=-p.z;float path=max(0.,min(end,depth)-nearDepth)*mix(length(p)/max(depth,.0001),1.,orthographic);
      if(end<=0. || path<=0.){gl_FragColor=original;return;}
      float coverage=smoothstep(0.,.04,path);
      vec2 offset=vec2(sin(vUv.y*19.+clock*.7)+sin(vUv.x*11.-clock*.4),cos(vUv.x*17.+clock*.5)+sin(vUv.y*13.-clock*.3))*.5*distortion/size;
      vec2 uv=clamp(vUv+offset,1./size,1.-1./size);
      float other=-scenePosition(uv).z;
      if(waterExit(uv)<=0. || abs(other-depth)>max(.2,depth*.03)) uv=vUv;
      vec3 color=texture2D(tDiffuse,uv).rgb;
      float radius=blur*1.5*smoothstep(3.,12.,depth);vec3 sum=color;float weight=1.;
      for(int i=0;i<4;i++){
        vec2 direction=i==0?vec2(1.,0.):i==1?vec2(-1.,0.):i==2?vec2(0.,1.):vec2(0.,-1.);
        vec2 tap=clamp(uv+direction*radius/size,1./size,1.-1./size);float tapDepth=-scenePosition(tap).z;
        if(radius>0. && waterExit(tap)>0. && abs(tapDepth-depth)<max(.2,depth*.03)){sum+=texture2D(tDiffuse,tap).rgb;weight+=1.;}
      }
      color=sum/weight;vec3 transmission=exp(-extinction*min(path,200.));
      vec3 result=color*transmission+scatterColor*(1.-transmission);
      gl_FragColor=vec4(mix(original.rgb,result,coverage),original.a);
    }` });
  private readonly quad = new FullScreenQuad(this.material);
  private readonly particleGeometry = new BufferGeometry();
  private readonly particlePositions = new Float32Array(48 * 3);
  private readonly particles = new Points(this.particleGeometry, new ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
    uniforms: { sceneDepth: this.material.uniforms.sceneDepth!, inverseProjection: this.material.uniforms.inverseProjection!, reversed: this.material.uniforms.reversed!,
      entryMap: this.material.uniforms.entryMap!, exitMap: this.material.uniforms.exitMap!, size: this.material.uniforms.size!, color: { value: new Color() } },
    vertexShader: `varying float eyeDepth;varying float visibility;void main(){vec4 p=modelViewMatrix*vec4(position,1.);eyeDepth=-p.z;visibility=1.-smoothstep(3.5,5.,length(p.xyz));gl_Position=projectionMatrix*p;gl_PointSize=clamp(12./max(eyeDepth,.1),1.,5.);}`,
    fragmentShader: `varying float eyeDepth;varying float visibility;uniform vec2 size;uniform vec3 color;${DEPTH_GLSL}${MASK_GLSL}
    void main(){vec2 uv=gl_FragCoord.xy/size;float end=waterExit(uv);if(end<=0. || eyeDepth>end || eyeDepth>-scenePosition(uv).z)discard;
      float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(color,exp(-r*r*5.)*.12*visibility);}`,
  }));
  private width = 1;
  private height = 1;
  private clock = 0;
  quality: UnderwaterQuality = { level: "high", blur: true, particles: 48 };
  readonly stats = { activeBody: null as string | null, maskDraws: 0, particles: 0, maskResolution: [0, 0], depthAvailable: false };
  constructor(private readonly scene: Scene, camera: Camera) {
    super(); this.camera = camera; this.proxy.matrixAutoUpdate = false; this.proxy.frustumCulled = false;
    this.particleGeometry.setAttribute("position", new BufferAttribute(this.particlePositions, 3)); this.particles.frustumCulled = false;
  }
  prepare(camera: Camera, delta: number): void {
    this.camera = camera;
    if (Number.isFinite(delta) && delta > 0) this.clock += Math.min(delta, .1);
    this.body = isPlanarReflectionCamera(camera) ? null : selectUnderwaterBody(this.scene, camera);
    if (!this.body) this.releaseTargets();
    this.enabled = !!this.body; this.stats.activeBody = this.body?.lake.id ?? null; this.stats.maskDraws = 0; this.stats.particles = 0;
  }
  private releaseTargets(): void {
    this.entry?.dispose(); this.exit?.dispose(); this.entry = this.exit = null;
    this.material.uniforms.entryMap!.value = this.material.uniforms.exitMap!.value = null;
    this.proxy.geometry = this.emptyGeometry; this.stats.maskResolution = [0, 0];
  }
  setDepth(texture: Texture | null): void { this.material.uniforms.sceneDepth!.value = texture; this.stats.depthAvailable = !!texture; }
  override setSize(width: number, height: number): void {
    this.width = width; this.height = height; this.material.uniforms.size!.value.set(width, height);
  }
  private targets(): void {
    const scale = this.quality.level === "high" ? 1 : .5, w = Math.max(1, Math.ceil(this.width * scale)), h = Math.max(1, Math.ceil(this.height * scale));
    if (this.entry?.width === w && this.entry.height === h) return;
    this.entry?.dispose(); this.exit?.dispose();
    this.entry = new WebGLRenderTarget(w, h, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter });
    this.exit = this.entry.clone(); this.entry.texture.name = "Underwater.entry"; this.exit.texture.name = "Underwater.exit";
    this.material.uniforms.entryMap!.value = this.entry.texture; this.material.uniforms.exitMap!.value = this.exit.texture;
    this.stats.maskResolution = [w, h];
  }
  override render(renderer: WebGLRenderer, write: WebGLRenderTarget, read: WebGLRenderTarget): void {
    const body = this.body;
    if (!body || !this.material.uniforms.sceneDepth!.value) { this.material.uniforms.effectEnabled!.value = 0; this.material.uniforms.tDiffuse!.value = read.texture; this.copy(renderer, write); return; }
    this.material.uniforms.effectEnabled!.value = 1;
    this.targets(); this.proxy.geometry = body.volume(); this.proxy.matrix.copy(body.owner.matrixWorld); this.proxy.matrixWorldNeedsUpdate = true; this.proxy.layers.mask = this.camera.layers.mask; this.particles.layers.mask = this.camera.layers.mask;
    for (const key of ["surfaceWaveTime", "surfaceWaveHeight", "surfaceWaveShoreDepth", "surfaceWaveComponents"]) this.proxy.material.uniforms[key] = body.owner.material.uniforms[key]!;
    const target = renderer.getRenderTarget(), clear = renderer.getClearColor(new Color()), alpha = renderer.getClearAlpha(), tone = renderer.toneMapping, auto = renderer.autoClear;
    try {
      renderer.toneMapping = NoToneMapping; renderer.autoClear = true; renderer.setClearColor(0, 0);
      for (const [side, buffer] of [[FrontSide, this.entry], [BackSide, this.exit]] as const) {
        this.proxy.material.side = side; renderer.setRenderTarget(buffer); renderer.clear(); renderer.render(this.proxy, this.camera); this.stats.maskDraws++;
      }
    } finally { renderer.setClearColor(clear, alpha); renderer.toneMapping = tone; renderer.autoClear = auto; renderer.setRenderTarget(target); }
    const settings = resolveLakeUnderwater(body.lake), appearance = resolveLakeAppearance(body.lake), deep = new Color(appearance.deepColor), shallow = new Color(appearance.shallowColor);
    const u = this.material.uniforms, maximum = Math.max(deep.r, deep.g, deep.b, .00001), density = settings.fogDensity / Math.max(.01, appearance.absorptionDistance);
    u.extinction!.value.set(1 + (1 - deep.r / maximum) * 2, 1 + (1 - deep.g / maximum) * 2, 1 + (1 - deep.b / maximum) * 2).multiplyScalar(density);
    const position = this.camera.getWorldPosition(new Vector3());
    const depth = Math.max(0, body.owner.position.y - position.y);
    u.scatterColor!.value.copy(deep).lerp(shallow, Math.exp(-depth / 3) * .35);
    u.inverseProjection!.value.copy(this.camera.projectionMatrixInverse); u.reversed!.value = this.camera.reversedDepth ? 1 : 0;
    u.nearDepth!.value = (this.camera as Camera & { near: number }).near;
    u.orthographic!.value = (this.camera as Camera & { isOrthographicCamera?: boolean }).isOrthographicCamera ? 1 : 0;
    u.distortion!.value = this.quality.level === "low" ? 0 : settings.distortionStrength * (this.quality.level === "high" ? 2 : 1);
    u.blur!.value = this.quality.blur ? settings.blurStrength : 0; u.clock!.value = this.clock; u.tDiffuse!.value = read.texture;
    this.copy(renderer, write);
    const cap = Math.floor(this.quality.particles * settings.particleDensity); let count = 0;
    const hash = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const cell = [position.x, position.y, position.z].map(v => Math.floor(v / 2));
    const candidates: { p: number[]; distance: number }[] = [];
    for (let i = 0; i < 125 && cap > 0; i++) {
      const grid = [cell[0]! + i % 5 - 2, cell[1]! + Math.floor(i / 5) % 5 - 2, cell[2]! + Math.floor(i / 25) - 2];
      const seed = grid[0]! * 17 + grid[1]! * 73 + grid[2]! * 131;
      const p = grid.map((v, axis) => (v + hash(seed + axis * 31)) * 2);
      p[1]! += Math.sin(this.clock * .15 + seed) * .1;
      const distance = Math.hypot(p[0]! - position.x, p[1]! - position.y, p[2]! - position.z);
      if (distance >= 5) continue;
      const level = body.surfaceAt(p[0]!, p[2]!), bedDepth = body.depthAt(p[0]!, p[2]!);
      if (level === null || bedDepth === null || p[1]! >= level || p[1]! <= body.owner.position.y - bedDepth) continue;
      candidates.push({ p, distance });
    }
    const origin = body.owner.getWorldPosition(new Vector3()); this.particles.position.copy(origin);
    for (const { p } of candidates.sort((a, b) => a.distance - b.distance).slice(0, cap)) {
      this.particlePositions.set([p[0]! - origin.x, p[1]! - origin.y, p[2]! - origin.z], count++ * 3);
    }
    this.particleGeometry.setDrawRange(0, count); this.particleGeometry.getAttribute("position").needsUpdate = true;
    this.particles.material.uniforms.color!.value.copy(shallow).lerp(new Color(.5, .6, .5), .5);
    this.stats.particles = count;
    if (count) { const previous = renderer.autoClear; try { renderer.autoClear = false; renderer.render(this.particles, this.camera); } finally { renderer.autoClear = previous; } }
  }
  private copy(renderer: WebGLRenderer, write: WebGLRenderTarget): void { renderer.setRenderTarget(this.renderToScreen ? null : write); this.quad.render(renderer); }
  override dispose(): void {
    this.releaseTargets(); this.emptyGeometry.dispose();
    // The volume geometry belongs to its Lake; the proxy never owns it.
    this.proxy.material.dispose(); this.quad.dispose(); this.material.dispose(); this.particles.material.dispose(); this.particleGeometry.dispose(); this.setDepth(null);
  }
}

/** Attach before the beauty render, including non-MSAA direct-composer targets. */
export function ensureUnderwaterDepth(targets: readonly WebGLRenderTarget[]): void {
  for (const target of targets) if (!target.depthTexture) { target.dispose(); target.depthTexture = new DepthTexture(target.width, target.height, UnsignedIntType); }
}
