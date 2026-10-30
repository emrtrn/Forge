import { AmbientLight, HemisphereLight, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, TextureLoader, Vector3, type Camera, type Scene, type Texture } from "three";

interface SharedFoam { texture: Texture; ready: boolean; users: number }
let shared: SharedFoam | null = null;

/** One offline-baked linear texture, shared by Lake/River. Acquire only on an
 * actual foam draw; engine-only construction never requires a DOM or image. */
export class WaterFoamMaterial {
  readonly uniforms = { waterFoamMap: { value: null as Texture | null }, waterFoamReady: { value: 0 }, waterFoamAmbient: { value: new Vector3() } };
  private resource: SharedFoam | null = null;
  update(enabled: boolean, scene: Scene, camera: Camera): void {
    if (!enabled) { this.dispose(); return; }
    if (!this.resource) {
      if (!shared) {
        const texture = new TextureLoader().load(new URL("./textures/water-foam.png", import.meta.url).href,
          () => { if (shared === resource) resource.ready = true; else texture.dispose(); }, undefined,
          () => { if (shared === resource) console.warn("[water-foam] Material texture unavailable; using procedural fallback."); });
        texture.name = "WaterFoam.material"; texture.colorSpace = NoColorSpace;
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter;
        texture.generateMipmaps = true; texture.premultiplyAlpha = false;
        const resource: SharedFoam = { texture, ready: false, users: 0 };
        shared = resource;
      }
      this.resource = shared; this.resource.users++;
    }
    this.uniforms.waterFoamMap.value = this.resource.texture;
    this.uniforms.waterFoamReady.value = this.resource.ready ? 1 : 0;
    const ambient = this.uniforms.waterFoamAmbient.value; ambient.set(0, 0, 0);
    scene.traverseVisible(light => {
      if ((light instanceof AmbientLight || light instanceof HemisphereLight) && light.layers.test(camera.layers)) {
        ambient.x += light.color.r * light.intensity * .35;
        ambient.y += light.color.g * light.intensity * .35;
        ambient.z += light.color.b * light.intensity * .35;
      }
    });
  }
  dispose(): void {
    if (this.resource && --this.resource.users === 0) {
      this.resource.texture.dispose();
      if (shared === this.resource) shared = null;
    }
    this.resource = null; this.uniforms.waterFoamMap.value = null; this.uniforms.waterFoamReady.value = 0;
  }
}

/** Material presentation adapted from Ultra-Water OceanSurface.js, MIT.
 * Copyright (c) 2026 Humpalumps; public/licenses/ultra-water.txt.
 * Coverage remains bounded by the caller's real shore / baked mesh mask. */
export const WATER_FOAM_MATERIAL_GLSL = /* glsl */ `
uniform sampler2D waterFoamMap;
uniform float waterFoamReady;
uniform vec3 waterFoamAmbient;
vec4 waterFoamDetail(vec2 world, float time, float scale, float speed) {
  // A tile spans multiple authored patches; the second scale hides repetition.
  vec2 uv=world/max(scale,.01)*.16+time*speed*vec2(.011,-.007);
  vec4 fine=texture2D(waterFoamMap,uv);
  vec4 broad=texture2D(waterFoamMap,uv*.37+vec2(.37,.19));
  return vec4(fine.r*.7+broad.r*.3, fine.g, fine.ba);
}
// River variant: x runs downstream, y across, both in metres. The tile is
// stretched along the flow so foam reads as drifting streaks, not round blots.
vec4 waterFoamDetailFlow(vec2 flowMetres, float scale, float stretch) {
  vec2 uv=vec2(flowMetres.x/max(stretch,1.),flowMetres.y)/max(scale,.01)*.16;
  vec4 fine=texture2D(waterFoamMap,uv);
  vec4 broad=texture2D(waterFoamMap,uv*.37+vec2(.37,.19));
  return vec4(fine.r*.7+broad.r*.3, fine.g, fine.ba);
}
// The baked R channel is rank-equalised: a density covers about that fraction
// of the tile. Dense foam is solid, thinning foam breaks into lace and then
// scattered bubbles; thin foam stays translucent over the water colour.
float waterFoamErosion(float density, float pattern) {
  density=clamp(density,0.,1.);
  float edge=1.-density;
  float aa=max(fwidth(pattern),.03);
  return smoothstep(edge-aa,edge+.08+aa,pattern)*mix(.55,1.,smoothstep(.15,.7,density))
    *smoothstep(0.,.04,density);
}
vec3 waterFoamLighting(vec4 detail, float density, vec3 normal, vec3 viewDirection,
    vec3 tint, float sunVisibility) {
  float ready=waterFoamReady;
  float height=mix(.5,detail.g,ready);
  float solid=smoothstep(.2,.9,density*(.55+.7*height));
  vec2 gradient=(detail.ba-.5)*64.*.16*ready;
  vec3 foamNormal=normalize(normal-vec3(gradient.x,0.,gradient.y)*(.03+.12*density));
  float ao=mix(.5,1.,smoothstep(.15,.75,height));
  vec3 albedo=mix(tint,vec3(.95),max(solid,smoothstep(.3,.9,detail.r)*.6)*ready);
  vec3 ambient=waterFoamAmbient+(waterEnvironmentIntensity>0. ? waterSky(vec3(0.,1.,0.),1.)*.45 : vec3(0.));
  float diffuse=max(0.,dot(foamNormal,waterSunDirection));
  vec3 light=ambient*1.1*ao+waterSunColor*diffuse*sunVisibility*mix(ao,1.,.4)*.65;
  light=mix(vec3(.6)*ao,light,waterLightingEnabled);
  vec3 halfDirection=normalize(viewDirection+waterSunDirection+vec3(.00001));
  vec3 sheen=waterSunColor*pow(max(dot(foamNormal,halfDirection),0.),90.)
    *.12*smoothstep(.55,.85,height)*solid*sunVisibility*waterLightingEnabled;
  return albedo*light+sheen;
}
`;
