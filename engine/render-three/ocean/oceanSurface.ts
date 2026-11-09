import { Color, DataTexture, FloatType, GLSL3, Mesh, NearestFilter, NoBlending, RGBAFormat,
  ShaderMaterial, UniformsLib, UniformsUtils, Vector2, Vector3, Vector4, type Camera, type WebGLRenderer } from "three";
import { OCEAN_APPEARANCE } from "../../scene/oceanWater";
import { OCEAN_OFFSHORE_TRANSITION, type OceanCoverage } from "../../terrain/oceanCoverage";
import { OceanFft } from "./oceanFft";
import { createOceanGrid } from "./oceanGrid";
import { WATER_OPTICS_GLSL } from "../waterOptics";
import type { WaterEnvironmentProbes } from "../waterEnvironment";
import { createOceanOpticsUniforms, updateOceanOptics, OCEAN_NORMAL_GLSL, OCEAN_OPTICS_GLSL } from "./oceanOptics";

const COVERAGE = /* glsl */ `
uniform sampler2D coverageMap;
uniform vec4 domain;
uniform vec2 cells;
uniform float seaLevel;
uniform float offshoreDepth;
// (depth, wet). Triangles and interpolated bed share the terrain b-c diagonal.
vec2 waterCoverage(vec2 world){
  vec2 g=(world-domain.xy)/domain.z;
  float outside=length(max(max(-g,g-cells),vec2(0.)))*domain.z;
  g=clamp(g,vec2(0.),cells);
  ivec2 cell=ivec2(min(floor(g),cells-1.));vec2 f=g-vec2(cell);
  vec4 a=texelFetch(coverageMap,cell,0);
  float b=texelFetch(coverageMap,cell+ivec2(1,0),0).r;
  float c=texelFetch(coverageMap,cell+ivec2(0,1),0).r;
  float d=texelFetch(coverageMap,cell+ivec2(1,1),0).r;
  bool first=f.x+f.y<=1.; int mask=int(a.g+.5);
  bool connected=first?(mask&1)!=0:(mask&2)!=0;
  float bed=first?a.r*(1.-f.x-f.y)+b*f.x+c*f.y:d*(f.x+f.y-1.)+c*(1.-f.x)+b*(1.-f.y);
  if(outside>0.)return vec2(mix(max(0.,seaLevel-bed),offshoreDepth,smoothstep(0.,${OCEAN_OFFSHORE_TRANSITION.toFixed(1)},outside)),1.);
  return vec2(max(0.,seaLevel-bed),connected&&bed<seaLevel?1.:0.);
}`;
const WAVES = /* glsl */ `
uniform sampler2D disp0; uniform sampler2D disp1; uniform sampler2D disp2;
uniform sampler2D slope0; uniform sampler2D slope1; uniform sampler2D slope2; uniform sampler2D slope3;
uniform vec4 lengths;
uniform float waveClock;
uniform float analyticMode;
vec3 analyticWave(vec2 world){
  float a=dot(world,vec2(.042,.055))-waveClock*.82;
  float b=dot(world,vec2(-.14,.09))-waveClock*1.23;
  float c=dot(world,vec2(.5,.27))-waveClock*2.1;
  return vec3(.6*sin(a)+.23*sin(b)+.08*sin(c),
    .6*cos(a)*.042+.23*cos(b)*(-.14)+.08*cos(c)*.5,
    .6*cos(a)*.055+.23*cos(b)*.09+.08*cos(c)*.27);
}
vec4 displacement(vec2 world,float stepSize){
  if(analyticMode>.5)return vec4(0.,analyticWave(world).x,0.,1.);
  float l0=max(0.,log2(stepSize*256./lengths.x));
  float l1=max(0.,log2(stepSize*256./lengths.y));
  float l2=max(0.,log2(stepSize*256./lengths.z));
  vec4 a=textureLod(disp0,world/lengths.x,l0),b=textureLod(disp1,world/lengths.y,l1),c=textureLod(disp2,world/lengths.z,l2);
  return vec4(a.xyz+b.xyz+c.xyz,min(a.w,min(b.w,c.w)));
}
vec3 shallowDisplacement(vec2 world,float stepSize){
  vec2 cover=waterCoverage(world);float fade=smoothstep(0.,5.,cover.x)*cover.y;
  vec3 d=displacement(world,stepSize).xyz*fade;
  // The final displaced point must still be wet. Never displace through an island.
  vec2 destination=waterCoverage(world+d.xz);
  d*=smoothstep(0.,1.,destination.x)*destination.y;
  d.y=clamp(d.y,-destination.x*.7,destination.x*.7);
  return d;
}`;
const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute float gridStep; attribute float edgeBlend;
uniform vec2 anchor;
varying vec3 vWorld; varying float vFoam;
${COVERAGE}${WAVES}
void main(){
  vec2 world=position.xz+anchor;
  vec3 direct=shallowDisplacement(world,gridStep);
  float step2=gridStep*2.;vec2 grid=floor((world-anchor)/step2)*step2+anchor,f=fract((world-anchor)/step2);
  // Same b-c diagonal as the coarse ring. Fine edge midpoint lies exactly on its edge.
  vec3 a=shallowDisplacement(grid,step2),b=shallowDisplacement(grid+vec2(step2,0.),step2);
  vec3 c=shallowDisplacement(grid+vec2(0.,step2),step2),d=shallowDisplacement(grid+vec2(step2),step2);
  vec3 coarse=f.x+f.y<=1.?a*(1.-f.x-f.y)+b*f.x+c*f.y:d*(f.x+f.y-1.)+c*(1.-f.x)+b*(1.-f.y);
  vec3 wave=mix(direct,coarse,edgeBlend);
  vWorld=vec3(world.x+wave.x,seaLevel+wave.y,world.y+wave.z);
  vFoam=displacement(world,gridStep).w;
  vec4 worldPosition=vec4(vWorld,1.);
  vec4 mvPosition=viewMatrix*worldPosition;
  vec3 transformedNormal=normalMatrix*vec3(0.,1.,0.);
  gl_Position=projectionMatrix*mvPosition;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}`;
const FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 shallowColor; uniform vec3 deepColor; uniform float absorptionDistance;
uniform float roughness; uniform float foamStrength;
out vec4 oceanColor;
#define gl_FragColor oceanColor
varying vec3 vWorld; varying float vFoam;
${COVERAGE}${WAVES}${WATER_OPTICS_GLSL}${OCEAN_NORMAL_GLSL}${OCEAN_OPTICS_GLSL}
void main(){
  vec2 cover=waterCoverage(vWorld.xz);if(cover.y<.5||cover.x<=.002)discard;
  vec2 p=vWorld.xz;
  vec3 normal=oceanNormal(cover.x);
  vec3 eye=isOrthographic?vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]):cameraPosition-vWorld;
  eye=normalize(eye);
  float filteredRoughness=waterFilteredRoughness(normal,roughness);
  float fresnel=waterRoughFresnel(max(dot(normal,eye),0.),filteredRoughness);
  float sunVisibility=riverSunVisibility();
  vec3 ambient=oceanAmbient+waterSky(vec3(0.,1.,0.),1.)*.5;
  vec3 illumination=ambient+waterSunColor*max(waterSunDirection.y,0.)*.318309886*sunVisibility;
  vec3 base=mix(shallowColor,deepColor,1.-exp(-cover.x/absorptionDistance))*illumination;
  vec3 direction=reflect(-eye,normal);direction.y=abs(direction.y);
  float reflectedCoverage=waterEnvironmentCoverage(vWorld);
  vec3 reflected=waterReflectedEnvironment(vWorld,direction,filteredRoughness)/max(reflectedCoverage,.00001);
  float reflectionAmount=fresnel*reflectedCoverage*step(0.,eye.y);
  vec3 glint=waterSunGlint(normal,eye,filteredRoughness,sunVisibility);
  float path=waterPath(cover.x,abs(eye.y)),edgeDepth=cover.x;
  vec2 screenUv=gl_FragCoord.xy/waterSceneSize;
  vec3 visibleBed=vec3(0.);
  if(waterSceneEnabled>.5){
    visibleBed=texture(waterSceneColor,screenUv).rgb;
    vec3 bedView=waterScenePosition(screenUv,texture(waterSceneDepth,screenUv).r);
    vec3 surfaceView=waterScenePosition(screenUv,gl_FragCoord.z);
    vec3 column=surfaceView-bedView;
    path=min(length(column),100.);
    edgeDepth=min(cover.x,max(0.,dot(column,mat3(viewMatrix)*vec3(0.,1.,0.))));
    vec3 bed=visibleBed;
    oceanRefract(screenUv,normal,surfaceView,edgeDepth,bed,path);
    vec3 tint=deepColor/max(max(deepColor.r,deepColor.g),max(deepColor.b,.00001));
    vec3 extinction=(vec3(1.)+(vec3(1.)-tint)*2.)/max(absorptionDistance,.01);
    vec3 transmission=exp(-extinction*path);
    vec3 tintExtinction=extinction+vec3(1./max(absorptionDistance,.01));
    vec3 shallowWeight=extinction/tintExtinction*(vec3(1.)-exp(-tintExtinction*path))
      /max(vec3(1.)-transmission,vec3(.00001));
    vec3 scatter=mix(deepColor,shallowColor,clamp(shallowWeight,0.,1.))*illumination;
    base=bed*transmission+scatter*(vec3(1.)-transmission);
  }
  // Initial FFT crest presentation only; three-layer Ocean foam is a later delivery.
  float broken=1.-smoothstep(.1,.7,vFoam);
  float pattern=waterNoise(p*1.5)*.65+waterNoise(p*4.3)*.35;
  float foam=smoothstep(.3,.75,broken*foamStrength-pattern*.45)*smoothstep(.05,1.,cover.x);
  vec3 foamColor=vec3(.78,.87,.86)*(ambient+waterSunColor*max(dot(normal,waterSunDirection),0.)*.318309886*sunVisibility);
  float shoreBlend=smoothstep(.002,.12,edgeDepth);
  gl_FragColor=waterComposite(base,1.-waterTransmission(cover.x,path,1.,absorptionDistance),reflected,reflectionAmount,foamColor,foam,glint);
  if(waterSceneEnabled>.5){
    vec3 color=mix(mix(base,reflected,reflectionAmount)+glint,foamColor,foam);
    gl_FragColor=vec4(mix(visibleBed,color,shoreBlend),1.);
  }else gl_FragColor.a*=shoreBlend;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const OVERRIDE_FRAGMENT = (kind: "normal" | "depth") => /* glsl */ `
#include <packing>
out vec4 oceanColor;
varying vec3 vWorld; varying float vFoam;
${COVERAGE}${WAVES}${OCEAN_NORMAL_GLSL}
void main(){
  vec2 cover=waterCoverage(vWorld.xz);if(cover.y<.5||cover.x<=.002)discard;
  oceanColor=${kind === "normal" ? "vec4(packNormalToRGB(normalize(mat3(viewMatrix)*oceanNormal(cover.x))),1.)" : "packDepthToRGBA(gl_FragCoord.z)"};
}`;

/** Owns grid/material/coverage; borrows FFT, environment and scene snapshots. */
export class OceanSurface extends Mesh<ReturnType<typeof createOceanGrid>, ShaderMaterial> {
  private readonly coverageTexture: DataTexture;
  private disposed = false;
  private readonly waveOverrides = new Map<"normal" | "depth", Mesh<ReturnType<typeof createOceanGrid>, ShaderMaterial>>();
  constructor(readonly coverage: OceanCoverage, readonly simulation: OceanFft, probes?: WaterEnvironmentProbes) {
    if (coverage.status !== "ready") throw new Error("Cannot publish Ocean from missing terrain");
    const { nx, nz, heights, triangles, body } = coverage;
    const packed = new Float32Array(heights.length * 4);
    heights.forEach((h, i) => { packed[i * 4] = h; const x = i % (nx + 1), z = Math.floor(i / (nx + 1));
      packed[i * 4 + 1] = x < nx && z < nz ? triangles[z * nx + x]! : 0; });
    const texture = new DataTexture(packed, nx + 1, nz + 1, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true;
    const a = { ...OCEAN_APPEARANCE, ...body.appearance };
    const material = new ShaderMaterial({ glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, fog: true, lights: true, uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog), ...UniformsUtils.clone(UniformsLib.lights), ...createOceanOpticsUniforms(),
        coverageMap: { value: texture }, domain: { value: new Vector4(...body.bounds.min, coverage.spacing, 0) },
        cells: { value: new Vector2(nx, nz) }, seaLevel: { value: body.surfaceLevel }, offshoreDepth: { value: body.offshoreDepth },
        anchor: { value: new Vector2() }, lengths: { value: new Vector4(...simulation.lengths) },
        waveClock: { value: 0 }, analyticMode: { value: 0 },
        ...Object.fromEntries([0, 1, 2].map(i => [`disp${i}`, { value: simulation.displacement[i] }])),
        ...Object.fromEntries([0, 1, 2, 3].map(i => [`slope${i}`, { value: simulation.slopes[i] }])),
        shallowColor: { value: new Color(a.shallowColor) }, deepColor: { value: new Color(a.deepColor) },
        absorptionDistance: { value: a.absorptionDistance }, roughness: { value: a.roughness }, foamStrength: { value: a.foamStrength },
      } });
    super(createOceanGrid(), material); this.coverageTexture = texture;
    this.name = `Ocean:${body.id}`; this.frustumCulled = false; this.renderOrder = 1; this.visible = !body.hidden;
    this.receiveShadow = true; this.layers.enable(31);
    this.userData.waterSceneTransmission = this.userData.aoWaterSurface = true;
    this.onBeforeRender = (renderer, scene, camera) => {
      if (scene.overrideMaterial) return;
      this.userData.compositedWaterSurface = updateOceanOptics(this.material.uniforms as ReturnType<typeof createOceanOpticsUniforms>, renderer, scene, camera, probes);
    };
  }
  /** Main-view anchoring is explicit; a mirrored camera cannot relocate the grid. */
  updateView(camera: Camera): void {
    const point = camera.getWorldPosition(new Vector3()), u = this.material.uniforms;
    u.waveClock!.value = this.simulation.stats.time;
    u.anchor!.value.set(Math.floor(point.x / .75) * .75, Math.floor(point.z / .75) * .75);
    for (let i = 0; i < 3; i++) u[`disp${i}`]!.value = this.simulation.displacement[i];
    for (let i = 0; i < 4; i++) u[`slope${i}`]!.value = this.simulation.slopes[i];
  }
  /** AO/DoF draw the same displaced, connected surface without stepping FFT. */
  renderWaveOverride(renderer: WebGLRenderer, camera: Camera, kind: "normal" | "depth"): void {
    let proxy = this.waveOverrides.get(kind);
    if (!proxy) {
      const material = new ShaderMaterial({ glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: OVERRIDE_FRAGMENT(kind),
        uniforms: this.material.uniforms, blending: NoBlending });
      proxy = new Mesh(this.geometry, material); proxy.frustumCulled = false;
      this.waveOverrides.set(kind, proxy);
    }
    proxy.layers.mask = this.layers.mask;
    const autoClear = renderer.autoClear;
    try { renderer.autoClear = false; renderer.render(proxy, camera); }
    finally { renderer.autoClear = autoClear; }
  }
  override dispose(): void {
    if (this.disposed) return; this.disposed = true; this.removeFromParent();
    for (const proxy of this.waveOverrides.values()) proxy.material.dispose(); this.waveOverrides.clear();
    this.geometry.dispose(); this.material.dispose(); this.coverageTexture.dispose();
  }
}
