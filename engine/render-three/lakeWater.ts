import { BufferGeometry, BufferAttribute, Color, DoubleSide, Matrix4, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector2, type DataTexture, type Texture } from "three";
import type { LayoutLakeWaterBody } from "../scene/layout";
import { resolveLakeAppearance } from "../scene/waterBody";
import type { LakeGeometry } from "../terrain/terrainLakeWater";
import type { PlanarReflectionBinding, PlanarReflectionSource } from "./planarReflectionSource";
import { createWaterEnvironmentUniforms, updateWaterEnvironment, WATER_ENVIRONMENT_GLSL } from "./waterEnvironment";
import { WATER_OPTICS_GLSL } from "./waterOptics";
import { createWaterSceneUniforms, readWaterScene, WATER_SCENE_GLSL } from "./waterSceneSnapshot";

import { createLakeFoamMask, WATER_FOAM_GLSL } from "./waterFoam";
import { createRiverSunShadowUniforms, updateRiverSunShadow, RIVER_SUN_SHADOW_GLSL } from "./riverSunShadow";

/** Flat exact surface; the normal animation never displaces the shoreline. */
export class LakeWaterObject extends Mesh<BufferGeometry, ShaderMaterial> {
  private readonly source: PlanarReflectionSource | null;
  private readonly strength: number;
  private readonly foamTexture: DataTexture | null;
  constructor(lake: LayoutLakeWaterBody, data: LakeGeometry, normal: Texture | null, source: PlanarReflectionSource | null = null) {
    const appearance = resolveLakeAppearance(lake);
    const foam = appearance.foamEnabled ? createLakeFoamMask(lake, data, appearance.foamWidth) : null;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
    geometry.setAttribute("waterDepth", new BufferAttribute(data.depths, 1));
    geometry.setAttribute("uv", new BufferAttribute(data.uvs, 2));
    geometry.setIndex(new BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    super(geometry, new ShaderMaterial({ transparent: true, depthWrite: false, side: DoubleSide, fog: true, lights: true,
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...UniformsUtils.clone(UniformsLib.lights), ...createRiverSunShadowUniforms(),
        shoreBlendDepth: { value: appearance.shoreBlendDepth },
        foamMask: { value: foam }, foamOpacity: { value: foam ? appearance.foamOpacity : 0 },
        foamScale: { value: appearance.foamScale }, foamSpeed: { value: appearance.foamSpeed },
        foamOrigin: { value: new Vector2(lake.bounds.min[0] - data.position[0], lake.bounds.min[1] - data.position[2]) },
        foamSize: { value: new Vector2(lake.bounds.max[0] - lake.bounds.min[0], lake.bounds.max[1] - lake.bounds.min[1]) }, ...createWaterEnvironmentUniforms(), ...createWaterSceneUniforms(), time: { value: 0 }, normalMap: { value: normal }, hasNormal: { value: normal ? 1 : 0 },
        rippleSpeed: { value: appearance.rippleSpeed }, normalScale: { value: appearance.normalScale },
        deepColor: { value: new Color(appearance.deepColor) }, shallowColor: { value: new Color(appearance.shallowColor) },
        opacity: { value: appearance.opacity }, bedVisibility: { value: appearance.bedVisibility },
        absorptionDistance: { value: appearance.absorptionDistance }, reflectionTexture: { value: null },
        reflectionTexelSize: { value: new Vector2(1, 1) },
        reflectionMatrix: { value: new Matrix4() }, reflectionStrength: { value: 0 } },
      vertexShader: `#include <fog_pars_vertex>
        #include <common>
        #include <shadowmap_pars_vertex>
        uniform vec2 foamOrigin; uniform vec2 foamSize; varying vec2 vFoamUv;
        attribute float waterDepth;
        varying float vDepth; varying vec2 vUv; varying vec4 vReflection; varying vec3 vWorldPosition;
        uniform mat4 reflectionMatrix;
        void main(){vFoamUv=(position.xz-foamOrigin)/foamSize;vDepth=waterDepth;vUv=uv;vec4 world=modelMatrix*vec4(position,1.);vWorldPosition=world.xyz;
        vReflection=reflectionMatrix*world;vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
        vec4 worldPosition=world;
        vec3 transformedNormal=normalMatrix*normal;
        #include <shadowmap_vertex>
        #include <fog_vertex>
        }`,
      fragmentShader: `#include <fog_pars_fragment>
        uniform float shoreBlendDepth;
        uniform sampler2D foamMask; uniform float foamOpacity; uniform float foamScale; uniform float foamSpeed; varying vec2 vFoamUv;
        uniform sampler2D normalMap; uniform float hasNormal;
        uniform float time;uniform float rippleSpeed;uniform float normalScale;
        uniform vec3 deepColor;uniform vec3 shallowColor;uniform float opacity;
        uniform float bedVisibility;uniform float absorptionDistance;
        uniform sampler2D reflectionTexture;uniform float reflectionStrength;uniform vec2 reflectionTexelSize;
        varying float vDepth;varying vec2 vUv;varying vec4 vReflection;varying vec3 vWorldPosition;
        ${WATER_OPTICS_GLSL}
        ${WATER_FOAM_GLSL}
        ${RIVER_SUN_SHADOW_GLSL}
        ${WATER_ENVIRONMENT_GLSL}
        ${WATER_SCENE_GLSL}
        // Small, resolution-aware Gaussian footprint. Reuse the existing planar
        // target; a calm lake keeps a reflection without a razor-sharp bank.
        vec3 lakeReflection(vec2 uv){
          vec2 t=reflectionTexelSize*1.5;
          vec2 lo=reflectionTexelSize*.5,hi=vec2(1.)-lo;
          vec3 c=texture2D(reflectionTexture,clamp(uv,lo,hi)).rgb*4.;
          c+=texture2D(reflectionTexture,clamp(uv+vec2(t.x,0.),lo,hi)).rgb*2.;
          c+=texture2D(reflectionTexture,clamp(uv-vec2(t.x,0.),lo,hi)).rgb*2.;
          c+=texture2D(reflectionTexture,clamp(uv+vec2(0.,t.y),lo,hi)).rgb*2.;
          c+=texture2D(reflectionTexture,clamp(uv-vec2(0.,t.y),lo,hi)).rgb*2.;
          c+=texture2D(reflectionTexture,clamp(uv+t,lo,hi)).rgb;
          c+=texture2D(reflectionTexture,clamp(uv-t,lo,hi)).rgb;
          c+=texture2D(reflectionTexture,clamp(uv+vec2(t.x,-t.y),lo,hi)).rgb;
          c+=texture2D(reflectionTexture,clamp(uv+vec2(-t.x,t.y),lo,hi)).rgb;
          return c/16.;
        }
        void main(){
        float d=max(0.,vDepth);
        vec2 p=vWorldPosition.xz*normalScale*.12;
        vec2 a=texture2D(normalMap,p+time*rippleSpeed*vec2(.035,.022)).xy*2.-1.;
        vec2 b=texture2D(normalMap,p*1.61-time*rippleSpeed*vec2(.021,.029)).xy*2.-1.;
        vec2 n=mix(a,b,.5)*hasNormal;
        n+=vec2(sin(p.x*.7+time*rippleSpeed*.21),sin(p.y*.53-time*rippleSpeed*.17))*.12;
        vec3 normal=normalize(vec3(n.x*.10,1.,n.y*.10));
        vec3 viewDirection=isOrthographic?vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]):cameraPosition-vWorldPosition;
        viewDirection/=max(length(viewDirection),.000001);
        float path=waterPath(d,abs(viewDirection.y));
        vec2 screenUv=gl_FragCoord.xy/waterSceneSize;
        if(waterSceneEnabled>.5){
          vec3 bedPosition=waterScenePosition(screenUv,texture2D(waterSceneDepth,screenUv).r);
          vec3 surfacePosition=waterScenePosition(screenUv,gl_FragCoord.z);
          vec3 waterColumn=surfacePosition-bedPosition;
          path=min(length(waterColumn),100.);
          // The same visible bed must drive shoreline coverage and tint too.
          // Interpolated authored depth can disagree with the rendered terrain.
          d=max(0.,dot(waterColumn,mat3(viewMatrix)*vec3(0.,1.,0.)));
        }
        // Source depth pins the actual mesh boundary; visible depth additionally
        // handles opaque foreground geometry in the scene-snapshot path.
        float edgeDepth=min(max(vDepth,0.),d);
        float edgeNoise=waterNoise(vWorldPosition.xz*.9+time*vec2(.013,-.009));
        float edgeWidth=shoreBlendDepth*mix(.85,1.15,edgeNoise);
        float shoreBlend=shoreBlendDepth>0.?smoothstep(0.,max(edgeWidth,.0001),edgeDepth):1.;
        normal=normalize(vec3(n.x*.10*shoreBlend,1.,n.y*.10*shoreBlend));
        float viewCosine=clamp(abs(dot(normal,viewDirection)),0.,1.);
        float fresnel=waterFresnel(viewCosine);
        vec3 color=mix(deepColor,shallowColor,exp(-d/2.2));
        vec3 surfaceLight=waterSurfaceLight(normal,viewDirection,.18);
        color*=surfaceLight;
        float reflectionAmount=0.;
        vec3 reflected=vec3(0.);
        if(reflectionStrength>0. && viewDirection.y>=0. && vReflection.w>0.){
          vec2 r=vReflection.xy/vReflection.w+n*.006;
          if(all(greaterThanEqual(r,vec2(0.)))&&all(lessThanEqual(r,vec2(1.)))){
            reflectionAmount=clamp(reflectionStrength*fresnel,0.,1.)*smoothstep(0.,.08,d);
            reflected=lakeReflection(r);
          }
        }
        float transmission=waterTransmission(d,path,bedVisibility,absorptionDistance);
        float wetness=smoothstep(0.,.35,d);
        float authoredOpacity=opacity*wetness*mix(.3,1.,smoothstep(0.,3.,d));
        gl_FragColor=waterComposite(color,max(authoredOpacity,1.-transmission),reflected,reflectionAmount,
          vec3(0.),0.,waterSunGlint(normal,viewDirection,.12)*wetness);
        vec3 visibleBed=vec3(0.);
        if(waterSceneEnabled>.5){
          // Tint controls spectral loss, rather than adding a dark colour over
          // an otherwise unfiltered brown bed. Keep the authored opacity floor.
          vec3 tint=deepColor/max(max(deepColor.r,deepColor.g),max(deepColor.b,.00001));
          vec3 extinction=(vec3(1.)+(vec3(1.)-tint)*2.)/max(absorptionDistance,.01);
          vec3 opticalTransmission=exp(-extinction*path);
          vec3 transmitted=min(opticalTransmission*mix(1.,bedVisibility,wetness),vec3(1.-authoredOpacity));
          // Integrate the shallow-to-deep tint along the visible water column,
          // weighted by extinction. Using only the colour at its far endpoint
          // paints the basin's depth contours as bright/dark bands on the lake.
          vec3 tintExtinction=extinction+vec3(1./max(absorptionDistance,.01));
          vec3 shallowWeight=(extinction/tintExtinction)*(vec3(1.)-exp(-tintExtinction*path))
            /max(vec3(1.)-opticalTransmission,vec3(.00001));
          vec3 scatterColor=mix(deepColor,shallowColor,clamp(shallowWeight,0.,1.));
          // The lit bed already contains sunlight. Give the water volume its
          // own diffuse sun contribution instead of dimming to an ambient-only
          // colour as the bed disappears. No exposure or authored light edits.
          vec3 scatterLight=surfaceLight
            +waterSunColor*max(waterSunDirection.y,0.)*.318309886*waterLightingEnabled;
          scatterColor*=scatterLight;
          visibleBed=texture2D(waterSceneColor,screenUv).rgb;
          vec3 body=visibleBed*transmitted+scatterColor*(vec3(1.)-transmitted);
          gl_FragColor=vec4(mix(body,reflected,reflectionAmount)+waterSunGlint(normal,viewDirection,.12)*wetness,1.);
        }
        if(foamOpacity>0.) {
          float shore=texture2D(foamMask,vFoamUv).r;
          // Geometry already clips to the connected wet component, including
          // islands. Distance only controls the band inside that valid water.
          float coverage=waterFoamPatches(vWorldPosition.xz,shore,time,foamScale,foamSpeed)*foamOpacity;
          float sun=riverSunVisibility();
          vec3 foamLight=waterSurfaceLight(vec3(0.,1.,0.),viewDirection,.8,sun)*.4
            +waterSunColor*max(waterSunDirection.y,0.)*.2*sun*waterLightingEnabled;
          vec3 foamColor=vec3(.82,.87,.84)*foamLight;
          // Mix premultiplied radiance, then return straight alpha. This also
          // covers the bed/reflection in the scene-snapshot and fallback paths.
          float alpha=coverage+(1.-coverage)*gl_FragColor.a;
          gl_FragColor=vec4((foamColor*coverage+gl_FragColor.rgb*gl_FragColor.a*(1.-coverage))/max(alpha,.00001),alpha);
        }
        // Snapshot composition is opaque: fade its radiance to the real bed,
        // not alpha (which would blend an already composited bed a second time).
        // This includes foam, so it cannot replace the edge with a white line.
        if(waterSceneEnabled>.5) {
          gl_FragColor.rgb=mix(visibleBed,gl_FragColor.rgb,shoreBlend);
        } else gl_FragColor.a*=shoreBlend;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        }` }));
    this.foamTexture = foam; this.receiveShadow = appearance.foamEnabled;
    this.position.set(...data.position); this.name = `Lake:${lake.id}`;
    this.userData.waterBodyId = lake.id; this.source = source; this.strength = appearance.reflectionStrength;
    this.userData.waterSceneTransmission = true;
    this.layers.enable(31); // Water layer marker; the reflection source hides registered consumers.
    source?.addConsumer(this);
    const started = performance.now();
    this.onBeforeRender = (renderer, scene, camera) => {
      if (scene.overrideMaterial) return;
      this.material.uniforms.time!.value = (performance.now() - started) / 1000;
      if (appearance.foamEnabled) updateRiverSunShadow(this.material.uniforms as ReturnType<typeof createRiverSunShadowUniforms>, scene, camera);
      updateWaterEnvironment(this.material.uniforms as ReturnType<typeof createWaterEnvironmentUniforms>, scene, camera);
      source?.update(renderer, scene, camera);
      const snapshot = readWaterScene(renderer, scene, camera);
      this.material.uniforms.waterSceneEnabled!.value = snapshot ? 1 : 0;
      // This path already composites the bed into an opaque final pixel. AO
      // must see that interface, not apply the hidden basin's AO over it.
      this.userData.compositedWaterSurface = !!snapshot;
      if (snapshot) {
        this.material.uniforms.waterSceneColor!.value = snapshot.texture;
        this.material.uniforms.waterSceneDepth!.value = snapshot.depthTexture;
        this.material.uniforms.waterSceneSize!.value.set(snapshot.width, snapshot.height);
        this.material.uniforms.waterSceneInverseProjection!.value.copy(camera.projectionMatrixInverse);
        this.material.uniforms.waterSceneReversed!.value = camera.reversedDepth ? 1 : 0;
      }
    };
  }
  setPlanarReflectionBinding(binding: PlanarReflectionBinding | null) {
    this.material.uniforms.reflectionTexture!.value = binding?.texture ?? null;
    const image = binding?.texture.image as { width: number; height: number } | undefined;
    this.material.uniforms.reflectionTexelSize!.value.set(1 / (image?.width || 1), 1 / (image?.height || 1));
    this.material.uniforms.reflectionMatrix!.value = binding?.textureMatrix ?? new Matrix4();
    this.material.uniforms.reflectionStrength!.value = binding ? this.strength : 0;
  }
  dispose() { this.foamTexture?.dispose(); this.source?.removeConsumer(this); this.geometry.dispose(); this.material.dispose(); }
}
