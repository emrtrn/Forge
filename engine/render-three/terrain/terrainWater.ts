import {
  Camera, Color, DataTexture, FloatType, HalfFloatType, LinearFilter,
  Matrix4, Mesh, NearestFilter, NoBlending, NoToneMapping,
  OrthographicCamera, PlaneGeometry, RepeatWrapping, RGBAFormat, Scene, ShaderMaterial,
  Vector2, Vector4, WebGLArrayRenderTarget, WebGLRenderTarget,
  type Texture, type WebGLRenderer,
} from "three";
import type { DeformationField } from "@engine/scene/deformationField";
import { isPlanarReflectionCamera } from "../planarReflectionSource";
import { TerrainWaterState, TERRAIN_WATER_MASK_SIZE, TERRAIN_WATER_SIZE, TERRAIN_WATER_STEP, TERRAIN_WATER_MAX_IMPULSES, TERRAIN_WATER_MAX_RIPPLES } from "./terrainWaterState";
import type { TerrainWaterContact } from "./terrainWaterState";

export type TerrainWaterQuality = "low" | "medium" | "high";
const live = new Set<TerrainWater>();
let pageQuality: TerrainWaterQuality = "high";
export function setTerrainWaterQuality(quality: TerrainWaterQuality): void {
  pageQuality = quality;
  for (const water of live) water.setQuality(quality);
}

const VERTEX = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`;
const SIMULATION = /* glsl */ `
varying vec2 vUv;
uniform sampler2D previousState;
uniform sampler2D wetMask;
uniform sampler2D deformation;
uniform vec4 deformWindow;
uniform float depthRange;
uniform vec2 origin;
uniform vec2 previousOrigin;
uniform float cellSize;
uniform vec4 impulses[${TERRAIN_WATER_MAX_IMPULSES}];
uniform int impulseCount;
vec2 filmAt(vec2 world) {
  vec2 local=(world-origin)/32.0;
  vec2 terrain=(world-deformWindow.xy)/deformWindow.z;
  if(any(lessThan(local,vec2(0.0)))||any(greaterThan(local,vec2(1.0)))
    ||any(lessThan(terrain,vec2(0.06)))||any(greaterThan(terrain,vec2(0.94)))) return vec2(0.0);
  vec2 wet=texture2D(wetMask,world/32.0).rg;
  vec2 field=texture2D(deformation,world/deformWindow.z).rg;
  return vec2(smoothstep(0.4,0.7,wet.r)*smoothstep(0.015,0.045,field.r*depthRange)*smoothstep(0.35,0.7,field.g),wet.g-field.r*depthRange);
}
vec2 oldAt(vec2 world) {
  vec2 uv=(world-previousOrigin)/32.0;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return vec2(0.0);
  return texture2D(previousState,uv).rg;
}
void main(){
  vec2 world=origin+vUv*32.0;
  vec2 film=filmAt(world);
  float mask=film.x;
  vec2 old=oldAt(world);
  float lap=0.0;
  for(int i=0;i<4;i++) {
    vec2 delta=i==0?vec2(cellSize,0.0):i==1?vec2(-cellSize,0.0):i==2?vec2(0.0,cellSize):vec2(0.0,-cellSize);
    vec2 neighbour=filmAt(world+delta);
    float connected=neighbour.x*(1.0-smoothstep(0.025,0.06,abs(neighbour.y-film.y)));
    lap+=mix(old.x,oldAt(world+delta).x,connected)-old.x;
  }
  float velocity=(old.y+lap*1.44/(cellSize*cellSize)/60.0)*exp(-4.5/60.0);
  float height=old.x+velocity/60.0;
  for(int i=0;i<${TERRAIN_WATER_MAX_IMPULSES};i++) {
    if(i>=impulseCount) break;
    float d=length(world-impulses[i].xy)/impulses[i].z;
    // A depression with a positive ring, rather than adding permanent water.
    height+=impulses[i].w*(exp(-d*d*1.5)*0.45-exp(-d*d*6.0));
  }
  // Keep connectivity and calm film elevation for the visible wavefront pass.
  gl_FragColor=vec4(clamp(height,-0.015,0.015)*mask,clamp(velocity,-0.3,0.3)*mask,film.y,mask);
}`;
const COPY = /* glsl */ `
varying vec2 vUv; uniform sampler2D source; uniform float normalPass; uniform float cellSize;
uniform vec2 origin;
uniform vec4 ripples[${TERRAIN_WATER_MAX_RIPPLES}];
uniform int rippleCount;
uniform float rippleStrength;
void main(){
 if(normalPass>0.5){
  vec4 centre=texture2D(source,vUv);
  vec2 e=vec2(cellSize/32.0,0.0);
  vec2 gradient=vec2(texture2D(source,vUv+e).r-texture2D(source,vUv-e).r,
    texture2D(source,vUv+e.yx).r-texture2D(source,vUv-e.yx).r)/(2.0*cellSize);
  float crest=0.0;
  if(centre.a>0.1 && rippleStrength>0.0) for(int i=0;i<${TERRAIN_WATER_MAX_RIPPLES};i++) {
    if(i>=rippleCount) break;
    vec4 ripple=ripples[i];
    vec2 offset=origin+vUv*32.0-ripple.xy;
    float distanceToContact=length(offset);
    float front=0.06+ripple.z*0.7;
    float band=distanceToContact-front;
    if(abs(band)>0.3 || distanceToContact>1.3) continue;
    // Check the calm film between contact and pixel: a ring must not jump
    // the dry gap into another puddle, even if both have the same elevation.
    float connected=centre.a;
    for(int j=1;j<=8;j++) {
      vec4 path=texture2D(source,vUv-offset/32.0*(float(j)/8.0));
      connected*=step(0.1,path.a)*(1.0-smoothstep(0.025,0.06,abs(path.b-centre.b)));
    }
    if(connected<0.01) continue;
    float envelope=exp(-band*band/0.0256)*exp(-ripple.z*1.8)
      *smoothstep(0.0,0.07,ripple.z)*ripple.w*connected*rippleStrength;
    float phase=band*26.18;
    float slope=0.035*envelope*(26.18*cos(phase)-band/0.0128*sin(phase));
    gradient+=offset/max(distanceToContact,0.01)*slope;
    crest+=max(0.0,cos(phase))*envelope;
  }
  gl_FragColor=vec4(clamp(gradient,vec2(-0.6),vec2(0.6)),min(crest,1.0),centre.a);
 } else gl_FragColor=texture2D(source,vUv);
}`;

/** Ripple simulation only. Mud/puddles use the terrain's environment IBL;
 * planar capture is reserved for lakes. Lazily allocated after wet contact. */
export class TerrainWater {
  readonly state = new TerrainWaterState();
  readonly uniforms = {
    uTerrainWaterTex: { value: null as Texture | null },
    uTerrainWaterWindow: { value: new Vector4(-16, -16, 32, 0) },
    uTerrainWaterPlanes: { value: [new Vector4(), new Vector4()] },
    uTerrainWaterMatrices: { value: [new Matrix4(), new Matrix4()] },
    uTerrainWaterReflectionPass: { value: 0 },
  };
  private field: DeformationField | null = null;
  private quality = pageQuality;
  private targets: [WebGLRenderTarget, WebGLRenderTarget] | null = null;
  private atlas: WebGLArrayRenderTarget | null = null;
  private maskTexture: DataTexture | null = null;
  private readonly maskBytes = new Float32Array(TERRAIN_WATER_MASK_SIZE ** 2 * 4);
  private maskRevision = -1;
  private readonly passScene = new Scene();
  private readonly passCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly simulation = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: SIMULATION,
    depthTest: false, depthWrite: false, blending: NoBlending,
    uniforms: { previousState: { value: null }, wetMask: { value: null }, deformation: { value: null },
      deformWindow: { value: new Vector4() }, depthRange: { value: 0.3 }, origin: { value: new Vector2() },
      previousOrigin: { value: new Vector2() }, cellSize: { value: 0.125 },
      impulses: { value: Array.from({ length: TERRAIN_WATER_MAX_IMPULSES }, () => new Vector4()) }, impulseCount: { value: 0 } } });
  private readonly copy = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: COPY,
    depthTest: false, depthWrite: false, blending: NoBlending,
    uniforms: { source: { value: null }, normalPass: { value: 0 }, cellSize: { value: 0.125 },
      origin: { value: new Vector2() }, rippleCount: { value: 0 }, rippleStrength: { value: 1 },
      ripples: { value: Array.from({ length: TERRAIN_WATER_MAX_RIPPLES }, () => new Vector4()) } } });
  private readonly quad = new Mesh(new PlaneGeometry(2, 2), this.simulation);
  private readonly previousOrigin = new Vector2(-16, -16);
  private rendering = false;
  private simulationSteps = 0;
  private renderCalls = 0;
  private reversed = false;

  constructor() { this.passScene.add(this.quad); live.add(this); }

  advance(dt: number, contacts: readonly TerrainWaterContact[], centre: readonly [number, number], field: DeformationField): void {
    this.field = field;
    this.state.advance(dt, contacts, centre);
  }

  setQuality(quality: TerrainWaterQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.releaseTargets();
  }

  stats(): { quality: TerrainWaterQuality; resolution: number; steps: number; groups: number; captures: number; sites: number; contacts: number; renderCalls: number; reversed: boolean } {
    return { quality: this.quality, resolution: this.atlas?.width ?? 0, steps: this.simulationSteps,
      groups: 0, captures: 0,
      sites: this.state.sites.size, contacts: this.state.previous.size, renderCalls: this.renderCalls, reversed: this.reversed };
  }

  reset(): void {
    this.field = null; this.state.clear(); this.releaseTargets(); this.simulationSteps = 0;
  }

  dispose(): void {
    live.delete(this); this.reset(); this.simulation.dispose(); this.copy.dispose();
    this.quad.geometry.dispose();
  }

  render(renderer: WebGLRenderer, _scene: Scene, camera: Camera, deformation: Texture | null, window: Vector4, depthRange: number): void {
    this.renderCalls++;
    this.uniforms.uTerrainWaterReflectionPass.value = isPlanarReflectionCamera(camera) || this.rendering ? 1 : 0;
    if (this.rendering || isPlanarReflectionCamera(camera) || !this.field || this.state.sites.size === 0 || !deformation) return;
    if (!renderer.extensions.has("EXT_color_buffer_float")) return;
    this.reversed = renderer.state.buffers.depth.getReversed();
    live.add(this);
    this.rendering = true;
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const toneMapping = renderer.toneMapping, autoClear = renderer.autoClear;
    const clear = renderer.getClearColor(new Color()), alpha = renderer.getClearAlpha();
    const xr = renderer.xr.enabled;
    try {
      renderer.xr.enabled = false; renderer.toneMapping = NoToneMapping; renderer.autoClear = true;
      renderer.setClearColor(0, 0);
      this.ensureTargets(renderer);
      const atlas = this.atlas!, targets = this.targets!;
      const u = this.simulation.uniforms;
      if (this.maskRevision !== this.state.revision) {
        this.maskBytes.set(this.state.mask); this.maskTexture!.needsUpdate = true;
        this.maskRevision = this.state.revision;
      }
      u.wetMask!.value = this.maskTexture; u.deformation!.value = deformation;
      u.deformWindow!.value = window; u.depthRange!.value = depthRange;
      const origin = u.origin!.value as Vector2;
      origin.set(this.state.minX, this.state.minZ);
      const steps = Math.min(4, Math.floor((this.state.seconds + 1e-8) / TERRAIN_WATER_STEP));
      for (let step = 0; step < steps; step++) {
        u.previousState!.value = targets[0].texture; u.previousOrigin!.value = this.previousOrigin;
        u.impulseCount!.value = step === 0 ? this.state.impulses.length : 0;
        if (step === 0) this.state.impulses.forEach((impulse, i) => (u.impulses!.value as Vector4[])[i]!.set(impulse.x, impulse.z, impulse.radius, impulse.strength));
        this.quad.material = this.simulation;
        renderer.setRenderTarget(targets[1]); renderer.render(this.passScene, this.passCamera);
        [targets[0], targets[1]] = [targets[1], targets[0]];
        this.previousOrigin.copy(origin); this.state.seconds -= TERRAIN_WATER_STEP; this.simulationSteps++;
      }
      if (steps > 0) this.state.impulses.length = 0;
      this.copy.uniforms.cellSize!.value = 32 / atlas.width;
      (this.copy.uniforms.origin!.value as Vector2).copy(this.previousOrigin);
      this.copy.uniforms.rippleCount!.value = this.state.ripples.length;
      this.state.ripples.forEach((ripple, i) => (this.copy.uniforms.ripples!.value as Vector4[])[i]!
        .set(ripple.x, ripple.z, ripple.age, ripple.strength));
      this.copyLayer(renderer, targets[0].texture, 0, true);
      this.uniforms.uTerrainWaterWindow.value.set(this.previousOrigin.x, this.previousOrigin.y, 32, 1);
    } finally {
      renderer.setRenderTarget(target, face, mip); renderer.setClearColor(clear, alpha);
      renderer.state.buffers.depth.setReversed(this.reversed);
      renderer.toneMapping = toneMapping; renderer.autoClear = autoClear; renderer.xr.enabled = xr;
      this.rendering = false; this.uniforms.uTerrainWaterReflectionPass.value = 0;
    }
  }

  private ensureTargets(renderer: WebGLRenderer): void {
    if (this.targets) return;
    const size = this.quality === "high" ? 512 : 256;
    const options = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
    this.targets = [new WebGLRenderTarget(size, size, options), new WebGLRenderTarget(size, size, options)];
    this.atlas = new WebGLArrayRenderTarget(size, size, 1, options);
    this.maskTexture = new DataTexture(this.maskBytes, TERRAIN_WATER_MASK_SIZE, TERRAIN_WATER_MASK_SIZE, RGBAFormat, FloatType);
    this.maskTexture.wrapS = this.maskTexture.wrapT = RepeatWrapping;
    this.maskTexture.minFilter = this.maskTexture.magFilter = NearestFilter;
    this.maskTexture.needsUpdate = true; this.maskRevision = -1;
    this.simulation.uniforms.cellSize!.value = TERRAIN_WATER_SIZE / size;
    for (const target of this.targets) { renderer.setRenderTarget(target); renderer.clear(); }
    renderer.setRenderTarget(this.atlas, 0); renderer.clear();
    this.previousOrigin.set(this.state.minX, this.state.minZ);
    this.uniforms.uTerrainWaterTex.value = this.atlas.texture;
  }

  private copyLayer(renderer: WebGLRenderer, source: Texture, layer: number, normalPass: boolean): void {
    this.quad.material = this.copy;
    this.copy.uniforms.source!.value = source; this.copy.uniforms.normalPass!.value = normalPass ? 1 : 0;
    renderer.setRenderTarget(this.atlas, layer); renderer.render(this.passScene, this.passCamera);
  }

  private releaseTargets(): void {
    for (const target of this.targets ?? []) target.dispose();
    this.targets = null; this.atlas?.dispose(); this.atlas = null;
    this.maskTexture?.dispose(); this.maskTexture = null;
    this.uniforms.uTerrainWaterTex.value = null; this.uniforms.uTerrainWaterWindow.value.w = 0;
    for (const plane of this.uniforms.uTerrainWaterPlanes.value) plane.set(0, 0, 0, 0);
  }
}

export const TERRAIN_WATER_PARS = /* glsl */ `
#ifdef FORGE_TERRAIN_WATER
uniform highp sampler2DArray uTerrainWaterTex;
uniform vec4 uTerrainWaterWindow;
uniform vec4 uTerrainWaterPlanes[2];
uniform mat4 uTerrainWaterMatrices[2];
uniform float uTerrainWaterReflectionPass;
varying float vForgeDeformBaseY;
vec2 forgeWaterGradient=vec2(0.0);
float forgeWaterCrest=0.0;
vec2 forgeWaterUv(){ return (vForgeDeformWorld-uTerrainWaterWindow.xy)/uTerrainWaterWindow.z; }
void forgeSampleWater(){
 if(uTerrainWaterWindow.w<0.5) return;
 vec2 uv=forgeWaterUv();
 if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return;
 vec3 waves=texture(uTerrainWaterTex,vec3(uv,0.0)).rgb;
 forgeWaterGradient=waves.rg;
 forgeWaterCrest=waves.b;
}
#else
vec2 forgeWaterGradient=vec2(0.0);
float forgeWaterCrest=0.0;
void forgeSampleWater() {}
#endif
`;

export const TERRAIN_WATER_REFLECTION = /* glsl */ `
// Puddles retain MeshStandardMaterial environment IBL and wet-ground shading.
// Dynamic planar capture is reserved for lakes.
`;
