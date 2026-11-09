import { AmbientLight, HemisphereLight, Vector3, type Camera, type Scene, type WebGLRenderer } from "three";
import { createWaterEnvironmentUniforms, updateWaterEnvironment, WATER_ENVIRONMENT_GLSL, type WaterEnvironmentProbes } from "../waterEnvironment";
import { createWaterSceneUniforms, readWaterScene, WATER_SCENE_GLSL } from "../waterSceneSnapshot";
import { createRiverSunShadowUniforms, updateRiverSunShadow, RIVER_SUN_SHADOW_GLSL } from "../riverSunShadow";

export function createOceanOpticsUniforms() {
  return { ...createWaterEnvironmentUniforms(), ...createWaterSceneUniforms(), ...createRiverSunShadowUniforms(),
    oceanAmbient: { value: new Vector3() } };
}

/** Borrow the live WES/probe/snapshot resources. No capture or simulation step. */
export function updateOceanOptics(u: ReturnType<typeof createOceanOpticsUniforms>, renderer: WebGLRenderer,
  scene: Scene, camera: Camera, probes?: WaterEnvironmentProbes): boolean {
  updateWaterEnvironment(u, scene, camera, probes?.());
  updateRiverSunShadow(u, scene, camera);
  u.oceanAmbient.value.set(0, 0, 0);
  scene.traverseVisible(object => {
    if (!object.layers.test(camera.layers)) return;
    if (object instanceof AmbientLight || object instanceof HemisphereLight) {
      // Upward-facing water receives the sky half of a HemisphereLight.
      u.oceanAmbient.value.x += object.color.r * object.intensity;
      u.oceanAmbient.value.y += object.color.g * object.intensity;
      u.oceanAmbient.value.z += object.color.b * object.intensity;
    }
  });
  const snapshot = readWaterScene(renderer, scene, camera);
  u.waterSceneEnabled.value = snapshot ? 1 : 0;
  if (snapshot) {
    u.waterSceneColor.value = snapshot.texture;
    u.waterSceneDepth.value = snapshot.depthTexture;
    u.waterSceneSize.value.set(snapshot.width, snapshot.height);
    u.waterSceneInverseProjection.value.copy(camera.projectionMatrixInverse);
    u.waterSceneCameraWorld.value.copy(camera.matrixWorld);
    u.waterSceneReversed.value = camera.reversedDepth ? 1 : 0;
  } else {
    u.waterSceneColor.value = u.waterSceneDepth.value = null;
  }
  return !!snapshot;
}

// Requires the surface's coverage/wave helpers and WATER_OPTICS_GLSL.
export const OCEAN_NORMAL_GLSL = /* glsl */ `
vec3 oceanNormal(float depth) {
  vec2 p=vWorld.xz;
  vec2 slope=texture(slope0,p/lengths.x).xy+texture(slope1,p/lengths.y).xy
    +texture(slope2,p/lengths.z).xy+texture(slope3,p/lengths.w).xy;
  if(analyticMode>.5)slope=analyticWave(p).yz;
  vec3 geometric=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
  if(geometric.y<0.)geometric=-geometric;
  vec3 normal=normalize(mix(vec3(0.,1.,0.),vec3(-slope.x,1.,-slope.y),smoothstep(0.,4.,depth)));
  return normalize(normal+geometric*.15);
}`;

export const OCEAN_OPTICS_GLSL = /* glsl */ `
#define vWorldPosition vWorld
${RIVER_SUN_SHADOW_GLSL}
${WATER_ENVIRONMENT_GLSL}
${WATER_SCENE_GLSL}
uniform vec3 oceanAmbient;

// Validate the midpoint as well as the endpoint against actual opaque depth
// and the authored connected sea. Never refract dry islands/foreground/sky.
float oceanRefractionCandidate(vec2 uv,out float path) {
  path=0.;vec2 border=min(uv,vec2(1.)-uv)*waterSceneSize;
  if(min(border.x,border.y)<2.)return 0.;
  float depth=texture(waterSceneDepth,uv).r;
  if(abs(depth-mix(1.,0.,waterSceneReversed))<.000001)return 0.;
  vec3 bedView=waterScenePosition(uv,depth);
  vec3 bedWorld=(waterSceneCameraWorld*vec4(bedView,1.)).xyz;
  if(bedWorld.y>=min(vWorld.y,seaLevel)-.08)return 0.;
  vec3 origin=cameraPosition,ray=bedWorld-cameraPosition;
  if(isOrthographic){origin=bedWorld;ray=-waterSceneCameraWorld[2].xyz;}
  if(abs(ray.y)<.00001)return 0.;
  float t=(vWorld.y-origin.y)/ray.y;
  if(!isOrthographic&&t<=0.)return 0.;
  vec3 surface=origin+ray*t;
  vec2 cover=waterCoverage(surface.xz);
  if(cover.y<.5||cover.x<.15)return 0.;
  vec3 surfaceView=(viewMatrix*vec4(surface,1.)).xyz;
  path=min(length(surfaceView-bedView),100.);
  return smoothstep(.04,.2,surfaceView.z-bedView.z)*smoothstep(2.,10.,min(border.x,border.y));
}
void oceanRefract(vec2 uv,vec3 normal,vec3 surfaceView,float edgeDepth,inout vec3 bed,inout float path) {
  if(cameraPosition.y<=vWorld.y||edgeDepth<.02)return;
  vec3 tilt=mat3(viewMatrix)*vec3(normal.x,0.,normal.z);
  vec2 projected=tilt.xy;
  if(!isOrthographic)projected-=surfaceView.xy/min(surfaceView.z,-.001)*tilt.z;
  vec2 offset=projected*.035*vec2(waterSceneSize.y/waterSceneSize.x,1.)
    *smoothstep(.02,.4,edgeDepth)*clamp(path*.5,0.,1.)
    *smoothstep(.03,.2,abs(normalize(cameraPosition-vWorld).y));
  offset*=min(1.,10./max(length(offset*waterSceneSize),.00001));
  float candidatePath,midPath;
  float keep=oceanRefractionCandidate(uv+offset*.5,midPath)*oceanRefractionCandidate(uv+offset,candidatePath);
  if(keep>0.){bed=mix(bed,texture(waterSceneColor,uv+offset).rgb,keep);path=mix(path,candidatePath,keep);}
}
`;
