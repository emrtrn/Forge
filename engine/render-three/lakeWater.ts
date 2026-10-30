import { lakeFoamTexture, LAKE_GEOMETRY_FOAM_GLSL } from "./lakeFoamTexture";
import type { LakeFoamData } from "../scene/lakeFoamBake";
import { createWaterCrestFoamUniforms, WATER_CREST_FOAM_GLSL } from "./waterCrestFoam";
import { LAKE_SURFACE_GLSL } from "./lakeSurface";
import { createLakeRippleUniforms, LAKE_RIPPLES_GLSL, updateLakeRippleUniforms } from "./lakeRipples";
import type { LakeRipple } from "../terrain/lakeInteraction";
import { lakeWaveParameters, lakeWaveTime, type LakeWaveParameters } from "../terrain/lakeWaves";
import { createLakeWaveUniforms, LAKE_WAVES_GLSL } from "./lakeWaves";
import { BufferGeometry, Color, DoubleSide, Matrix4, Mesh, MeshNormalMaterial, MeshDepthMaterial, RGBADepthPacking, NoBlending, ShaderMaterial, UniformsLib, UniformsUtils, Vector2, type Camera, type Object3D, type WebGLRenderer, type DataTexture, type DataArrayTexture, type Texture } from "three";
import { lakeRenderGeometry } from "./lakeRenderGeometry";
import type { LayoutLakeWaterBody } from "../scene/layout";
import { resolveLakeAppearance } from "../scene/waterBody";
import type { LakeGeometry } from "../terrain/terrainLakeWater";
import type { PlanarReflectionBinding, PlanarReflectionSource } from "./planarReflectionSource";
import { createWaterEnvironmentUniforms, updateWaterEnvironment, WATER_ENVIRONMENT_GLSL } from "./waterEnvironment";
import { WATER_OPTICS_GLSL } from "./waterOptics";
import { createWaterSceneUniforms, readWaterScene, WATER_SCENE_GLSL } from "./waterSceneSnapshot";

import { createLakeFoamMask, WATER_FOAM_GLSL, createWaterContactUniforms, WATER_CONTACT_GLSL } from "./waterFoam";
import { createRiverSunShadowUniforms, updateRiverSunShadow, RIVER_SUN_SHADOW_GLSL } from "./riverSunShadow";
import { FULL_LAKE_QUALITY, type LakeQuality } from "../perf/lakeQuality";
import { WaterFoamMaterial } from "./waterFoamMaterial";
import { createLakeRefractionMask, LAKE_REFRACTION_GLSL } from "./lakeRefraction";

/** Bounded vertical waves over the exact wet mesh; the shoreline stays pinned. */
export class LakeWaterObject extends Mesh<BufferGeometry, ShaderMaterial> {
  private source: PlanarReflectionSource | null;
  private readonly strength: number;
  private foamTexture: DataTexture | null;
  private geometryFoamTexture: DataArrayTexture | null;
  private refractionMask: DataTexture | null;
  private readonly foamMaterial = new WaterFoamMaterial();
  private quality: LakeQuality;
  private readonly contactCount: number;
  readonly waveParameters: LakeWaveParameters;
  private externalWaveTime = false;
  private readonly waveOverrides = new Map<"normal" | "depth", Mesh<BufferGeometry, MeshNormalMaterial | MeshDepthMaterial>>();
  constructor(private readonly lake: LayoutLakeWaterBody, private readonly data: LakeGeometry, normal: Texture | null,
    source: PlanarReflectionSource | null = null, bakedFoam?: LakeFoamData, quality: LakeQuality = FULL_LAKE_QUALITY,
    prepared?: { geometry: BufferGeometry; foam: DataTexture | null }) {
    const appearance = resolveLakeAppearance(lake);
    const contactSettings = undefined; // Manual obstacle contacts are retired; immutable geometry bake is the only source.
    const foam = prepared ? prepared.foam : quality.foamAllowed && appearance.foamEnabled ? createLakeFoamMask(lake, data, appearance.foamWidth) : null;
    let bake: ReturnType<typeof lakeFoamTexture> | null;
    try { bake = quality.foamAllowed && lake.geometryFoam?.enabled && bakedFoam && bakedFoam.metadata.surface!=="river" && Math.abs(lake.surfaceLevel-bakedFoam.metadata.level)<1e-6 ? lakeFoamTexture(bakedFoam) : null; }
    catch (error) { if (!prepared) foam?.dispose(); throw error; }
    const waves = lakeWaveParameters(appearance, data.position[0], data.position[2]);
    const refractionMask = appearance.refractionStrength > 0 && quality.reflectionQuality !== "off"
      ? createLakeRefractionMask(data) : null;
    const geometry = prepared?.geometry ?? lakeRenderGeometry(data);
    super(geometry, new ShaderMaterial({ defines: bake ? { FORGE_LAKE_GEOMETRY_FOAM: 1 } : {}, transparent: true, depthWrite: false, side: DoubleSide, fog: true, lights: true,
      uniforms: { geometryFoamMask: { value: bake?.texture ?? null },
        geometryFoamMin: { value: new Vector2(...(bakedFoam?.metadata.min ?? [0,0]) as [number,number]) },
        geometryFoamSize: { value: new Vector2(bakedFoam ? bakedFoam.metadata.max[0]-bakedFoam.metadata.min[0] : 1,bakedFoam ? bakedFoam.metadata.max[1]-bakedFoam.metadata.min[1] : 1) },
        geometryFoamGrid: { value: bake?.grid ?? new Vector2(1,1) }, geometryFoamTile: { value: bake?.tile ?? new Vector2(1,1) },
        geometryFoamStrength: { value: lake.geometryFoam?.strength ?? 0 }, geometryFoamScale: { value: lake.geometryFoam?.scale ?? .8 }, geometryFoamSpeed: { value: lake.geometryFoam?.speed ?? .3 },
        ...UniformsUtils.clone(UniformsLib.fog), ...UniformsUtils.clone(UniformsLib.lights), ...createRiverSunShadowUniforms(),
        ...createLakeRippleUniforms(appearance), lakeRippleOrigin: { value: new Vector2(data.position[0], data.position[2]) },
        surfaceWaveClock: { value: 0 },
        ...createLakeWaveUniforms(waves), ...createWaterCrestFoamUniforms(appearance, quality.foamAllowed),
        ...createWaterContactUniforms(contactSettings, data.position), contactOpacity: { value: appearance.foamOpacity },
        shoreBlendDepth: { value: appearance.shoreBlendDepth },
        foamMask: { value: foam }, foamOpacity: { value: foam ? appearance.foamOpacity : 0 },
        foamScale: { value: appearance.foamScale }, foamSpeed: { value: appearance.foamSpeed },
        foamOrigin: { value: new Vector2(lake.bounds.min[0] - data.position[0], lake.bounds.min[1] - data.position[2]) },
        foamSize: { value: new Vector2(lake.bounds.max[0] - lake.bounds.min[0], lake.bounds.max[1] - lake.bounds.min[1]) }, ...createWaterEnvironmentUniforms(), ...createWaterSceneUniforms(), time: { value: 0 }, normalMap: { value: normal }, hasNormal: { value: normal ? 1 : 0 },
        surfaceStrength: { value: appearance.surfaceStrength }, surfaceRoughness: { value: appearance.surfaceRoughness },
        rippleSpeed: { value: appearance.rippleSpeed }, normalScale: { value: appearance.normalScale },
        lakeRefractionMask: { value: refractionMask },
        lakeRefractionMin: { value: new Vector2(...(data.coverage?.min ?? lake.bounds.min)) },
        lakeRefractionGrid: { value: new Vector2(data.coverage?.nx ?? 1, data.coverage?.nz ?? 1) },
        lakeRefractionSpacing: { value: data.coverage?.spacing ?? 1 },
        lakeRefractionWaveMargin: { value: .02 + waves.height * 2 },
        lakeRefractionStrength: { value: refractionMask ? appearance.refractionStrength : 0 },
        deepColor: { value: new Color(appearance.deepColor) }, shallowColor: { value: new Color(appearance.shallowColor) },
        opacity: { value: appearance.opacity }, bedVisibility: { value: appearance.bedVisibility },
        absorptionDistance: { value: appearance.absorptionDistance }, reflectionTexture: { value: null },
        reflectionTexelSize: { value: new Vector2(1, 1) },
        reflectionMatrix: { value: new Matrix4() }, planarReflectionEnabled: { value: 0 },
        reflectionStrength: { value: appearance.reflectionMode === "off" ? 0 : appearance.reflectionStrength },
        sunGlintDetail: { value: quality.reflectionQuality === "off" || appearance.reflectionQuality === "low" ? 0 : 1 } },
      vertexShader: `#include <fog_pars_vertex>
        #include <common>
        #include <shadowmap_pars_vertex>
        uniform vec2 foamOrigin; uniform vec2 foamSize; varying vec2 vFoamUv; varying vec3 vContactPosition;
        attribute float waterDepth;
        attribute vec2 waterDepthSlope;
        varying float vDepth; varying vec2 vUv; varying vec4 vReflection; varying vec3 vWorldPosition; varying vec2 vWaveSlope;
        uniform mat4 reflectionMatrix;
        varying vec2 vCrestWave;
        ${LAKE_WAVES_GLSL}
        void main(){vContactPosition=position;vFoamUv=(position.xz-foamOrigin)/foamSize;vUv=uv;
        vec3 displaced=position;vec3 wave=lakeWaveSample(position.xz,waterDepth,waterDepthSlope);float height=wave.x;displaced.y+=height;vWaveSlope=wave.yz;vCrestWave=vec2(height,surfaceWaveHeight);
        vDepth=max(0.,waterDepth+height);vec4 world=modelMatrix*vec4(displaced,1.);vWorldPosition=world.xyz;
        vReflection=reflectionMatrix*world;vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
        vec4 worldPosition=world;
        vec3 transformedNormal=normalMatrix*normalize(vec3(-wave.y,1.,-wave.z));
        #include <shadowmap_vertex>
        #include <fog_vertex>
        }`,
      fragmentShader: `#include <fog_pars_fragment>
        uniform float contactOpacity; uniform float shoreBlendDepth;
        uniform sampler2D foamMask; uniform float foamOpacity; uniform float foamScale; uniform float foamSpeed; varying vec2 vFoamUv; varying vec3 vContactPosition;
        uniform sampler2D normalMap; uniform float hasNormal;
        uniform float surfaceWaveClock; uniform float time;uniform float rippleSpeed;uniform float normalScale;
        uniform vec3 deepColor;uniform vec3 shallowColor;uniform float opacity;
        uniform float bedVisibility;uniform float absorptionDistance;
        uniform sampler2D reflectionTexture;uniform float reflectionStrength;uniform vec2 reflectionTexelSize;
        uniform float planarReflectionEnabled;uniform float sunGlintDetail;
        varying float vDepth;varying vec2 vUv;varying vec4 vReflection;varying vec3 vWorldPosition;varying vec2 vWaveSlope;
        ${WATER_OPTICS_GLSL}
        ${RIVER_SUN_SHADOW_GLSL}
        ${WATER_ENVIRONMENT_GLSL}
        ${WATER_FOAM_GLSL}
        ${LAKE_GEOMETRY_FOAM_GLSL}
        ${WATER_CONTACT_GLSL}
        ${WATER_SCENE_GLSL}
        ${LAKE_REFRACTION_GLSL}
        ${LAKE_SURFACE_GLSL}
        ${WATER_CREST_FOAM_GLSL}
        uniform vec2 lakeRippleOrigin;
        ${LAKE_RIPPLES_GLSL}
        // Small, resolution-aware Gaussian footprint. Reuse the existing planar
        // target; a calm lake keeps a reflection without a razor-sharp bank.
        vec4 lakeReflection(vec2 uv,float roughness){
          vec2 t=reflectionTexelSize*mix(.75,4.,roughness);
          vec2 lo=reflectionTexelSize*.5,hi=vec2(1.)-lo;
          vec4 c=texture2D(reflectionTexture,clamp(uv,lo,hi))*4.;
          c+=texture2D(reflectionTexture,clamp(uv+vec2(t.x,0.),lo,hi))*2.;
          c+=texture2D(reflectionTexture,clamp(uv-vec2(t.x,0.),lo,hi))*2.;
          c+=texture2D(reflectionTexture,clamp(uv+vec2(0.,t.y),lo,hi))*2.;
          c+=texture2D(reflectionTexture,clamp(uv-vec2(0.,t.y),lo,hi))*2.;
          c+=texture2D(reflectionTexture,clamp(uv+t,lo,hi));
          c+=texture2D(reflectionTexture,clamp(uv-t,lo,hi));
          c+=texture2D(reflectionTexture,clamp(uv+vec2(t.x,-t.y),lo,hi));
          c+=texture2D(reflectionTexture,clamp(uv+vec2(-t.x,t.y),lo,hi));
          return c/16.;
        }
        void main(){
        float d=max(0.,vDepth);
        vec2 p=vWorldPosition.xz*normalScale*.12;
        vec2 n=lakeSurfaceSlopes(p,time*rippleSpeed);
        n+=lakeWheelSlopes(vWorldPosition.xz-lakeRippleOrigin);
        vec3 normal=normalize(vec3(n.x*.10,1.,n.y*.10));
        vec3 viewDirection=isOrthographic?vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2]):cameraPosition-vWorldPosition;
        viewDirection/=max(length(viewDirection),.000001);
        float path=waterPath(d,abs(viewDirection.y));
        vec2 screenUv=gl_FragCoord.xy/waterSceneSize;
        vec3 surfaceViewPosition=vec3(0.);
        if(waterSceneEnabled>.5){
          vec3 bedPosition=waterScenePosition(screenUv,texture2D(waterSceneDepth,screenUv).r);
          surfaceViewPosition=waterScenePosition(screenUv,gl_FragCoord.z);
          vec3 waterColumn=surfaceViewPosition-bedPosition;
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
        vec3 geometric=normalize(vec3(-vWaveSlope.x,1.,-vWaveSlope.y));
        normal=normalize(geometric+vec3(n.x*.10*shoreBlend,0.,n.y*.10*shoreBlend));
        float roughness=lakeFilteredRoughness(normal);
        float sunVisibility=riverSunVisibility();
        vec3 glint=waterSunGlint(normal,viewDirection,roughness,sunVisibility)
          *waterSunSparkle(vWorldPosition,time,sunGlintDetail)*step(0.,viewDirection.y);
        float viewCosine=clamp(abs(dot(normal,viewDirection)),0.,1.);
        float fresnel=waterRoughFresnel(viewCosine,roughness);
        vec3 color=mix(deepColor,shallowColor,exp(-d/2.2));
        vec3 surfaceLight=waterSurfaceLight(normal,viewDirection,roughness,sunVisibility);
        color*=surfaceLight;
        float reflectionAmount=0.;
        vec3 reflected=vec3(0.);
        if(reflectionStrength>0. && viewDirection.y>=0.){
          vec3 direction=reflect(-viewDirection,normal);direction.y=abs(direction.y);
          vec3 radiance=waterReflectedEnvironment(vWorldPosition,direction,roughness);
          float coverage=waterEnvironmentCoverage(vWorldPosition);
          if(planarReflectionEnabled>.5 && vReflection.w>0.){
            vec2 r=vReflection.xy/vReflection.w+n*.006;
            if(all(greaterThanEqual(r,vec2(0.)))&&all(lessThanEqual(r,vec2(1.)))){
              vec2 border=min(r,vec2(1.)-r);
              float edge=smoothstep(0.,.025,min(border.x,border.y));
              // Premultiplied planar geometry replaces the environment only
              // where it has coverage. Blurred empty pixels retain the sky.
              vec4 planar=lakeReflection(r,roughness)*edge;
              float alpha=clamp(planar.a,0.,1.);
              radiance=radiance*(1.-alpha)+planar.rgb;
              coverage=coverage*(1.-alpha)+alpha;
            }
          }
          // Missing sky/probes must not make a partial planar sample darken
          // the bed a second time. Convert coverage back to straight radiance.
          reflected=radiance/max(coverage,.00001);
          reflectionAmount=clamp(reflectionStrength*fresnel*coverage,0.,1.)*smoothstep(0.,.08,d);
        }
        float transmission=waterTransmission(d,path,bedVisibility,absorptionDistance);
        float wetness=smoothstep(0.,.35,d);
        float authoredOpacity=opacity*wetness*mix(.3,1.,smoothstep(0.,3.,d));
        gl_FragColor=waterComposite(color,max(authoredOpacity,1.-transmission),reflected,reflectionAmount,
          vec3(0.),0.,glint*wetness);
        vec3 visibleBed=vec3(0.);
        if(waterSceneEnabled>.5){
          visibleBed=texture2D(waterSceneColor,screenUv).rgb;
          vec3 refractedBed=visibleBed;
          float refractedPath=path;
          lakeRefract(screenUv,normal,surfaceViewPosition,vWorldPosition.y,edgeDepth,refractedBed,refractedPath);
          // Tint controls spectral loss, rather than adding a dark colour over
          // an otherwise unfiltered brown bed. Keep the authored opacity floor.
          vec3 tint=deepColor/max(max(deepColor.r,deepColor.g),max(deepColor.b,.00001));
          vec3 extinction=(vec3(1.)+(vec3(1.)-tint)*2.)/max(absorptionDistance,.01);
          vec3 opticalTransmission=exp(-extinction*refractedPath);
          vec3 transmitted=min(opticalTransmission*mix(1.,bedVisibility,wetness),vec3(1.-authoredOpacity));
          // Integrate the shallow-to-deep tint along the visible water column,
          // weighted by extinction. Using only the colour at its far endpoint
          // paints the basin's depth contours as bright/dark bands on the lake.
          vec3 tintExtinction=extinction+vec3(1./max(absorptionDistance,.01));
          vec3 shallowWeight=(extinction/tintExtinction)*(vec3(1.)-exp(-tintExtinction*refractedPath))
            /max(vec3(1.)-opticalTransmission,vec3(.00001));
          vec3 scatterColor=mix(deepColor,shallowColor,clamp(shallowWeight,0.,1.));
          // The lit bed already contains sunlight. Give the water volume its
          // own diffuse sun contribution instead of dimming to an ambient-only
          // colour as the bed disappears. No exposure or authored light edits.
          vec3 scatterLight=surfaceLight
            +waterSunColor*max(waterSunDirection.y,0.)*.318309886*waterLightingEnabled;
          scatterColor*=scatterLight;
          vec3 body=refractedBed*transmitted+scatterColor*(vec3(1.)-transmitted);
          gl_FragColor=vec4(mix(body,reflected,reflectionAmount)+glint*wetness,1.);
        }
        float bakedCoverage=0.;
        #ifdef FORGE_LAKE_GEOMETRY_FOAM
          bakedCoverage=lakeGeometryFoam(vWorldPosition.xz,time);
        #endif
        float crestCoverage=waterCrestFoam(vContactPosition.xz,surfaceWaveClock,foamScale,edgeDepth);
        if(foamOpacity>0. || contactCount>0 || bakedCoverage>0. || crestCoverage>0.) {
          float shore=foamOpacity>0.?texture2D(foamMask,vFoamUv).r:1.;
          // Geometry already clips to the connected wet component, including
          // islands. Distance only controls the band inside that valid water.
          float coverage=max(waterFoamPatches(vWorldPosition.xz,shore,time,foamScale,foamSpeed)*foamOpacity,
            waterObstacleFoam(vContactPosition,vec2(0.),0.,time)*contactOpacity);
          coverage=max(max(coverage,bakedCoverage),crestCoverage);
          float sun=riverSunVisibility();
          float materialScale=foamScale,materialSpeed=foamSpeed;
          #ifdef FORGE_LAKE_GEOMETRY_FOAM
          if(bakedCoverage>0.) { materialScale=geometryFoamScale; materialSpeed=geometryFoamSpeed; }
          #endif
          vec4 foamDetail=waterFoamReady>.5 ? waterFoamDetail(vWorldPosition.xz,time,materialScale,materialSpeed) : vec4(.5);
          vec3 foamColor=waterFoamLighting(foamDetail,coverage,geometric,viewDirection,vec3(.82,.87,.84),sun);
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
    this.waveParameters = waves;
    // GPU displacement never updates CPU geometry bounds automatically.
    geometry.boundingBox!.min.y -= waves.height; geometry.boundingBox!.max.y += waves.height;
    geometry.boundingSphere!.radius += waves.height;
    this.geometryFoamTexture = bake?.texture ?? null;
    this.refractionMask = refractionMask;
    if (appearance.refractionStrength > 0 && quality.reflectionQuality !== "off" && !refractionMask) {
      this.userData.lakeRefractionFallback = "Connected-face grid missing or exceeds 2048 texels per mask axis.";
    }
    Object.assign(this.material.uniforms, this.foamMaterial.uniforms);
    this.quality = { ...quality };
    this.contactCount = this.material.uniforms.contactCount!.value;
    if (!quality.foamAllowed) { this.material.uniforms.contactCount!.value = 0; this.material.uniforms.contactOpacity!.value = 0; }
    this.foamTexture = foam; this.receiveShadow = true;
    this.position.set(...data.position); this.name = `Lake:${lake.id}`;
    this.userData.waterBodyId = lake.id; this.source = source;
    this.strength = appearance.reflectionMode === "off" ? 0 : appearance.reflectionStrength;
    this.userData.waterSceneTransmission = true;
    this.layers.enable(31); // Water layer marker; the reflection source hides registered consumers.
    source?.addConsumer(this);
    const started = performance.now();
    this.onBeforeRender = (renderer, scene, camera) => {
      if (scene.overrideMaterial) return;
      this.foamMaterial.update(this.quality.foamAllowed && (!!this.foamTexture || !!this.geometryFoamTexture || (waves.height > 0 && this.material.uniforms.crestFoamStrength!.value > 0)), scene, camera);
      this.material.uniforms.time!.value = (performance.now() - started) / 1000;
      if (!this.externalWaveTime) this.material.uniforms.surfaceWaveTime!.value = lakeWaveTime(performance.now() / 1000, waves);
      this.material.uniforms.surfaceWaveClock!.value = this.material.uniforms.surfaceWaveTime!.value;
      updateRiverSunShadow(this.material.uniforms as ReturnType<typeof createRiverSunShadowUniforms>, scene, camera);
      updateWaterEnvironment(this.material.uniforms as ReturnType<typeof createWaterEnvironmentUniforms>, scene, camera);
      this.source?.update(renderer, scene, camera);
      if (this.source) this.material.uniforms.planarReflectionEnabled!.value = this.source.hasCapture ? 1 : 0;
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
        this.material.uniforms.waterSceneCameraWorld!.value.copy(camera.matrixWorld);
        this.material.uniforms.waterSceneReversed!.value = camera.reversedDepth ? 1 : 0;
      }
    };
  }
  setWheelRipples(ripples: readonly LakeRipple[]): void {
    updateLakeRippleUniforms(this.material.uniforms as ReturnType<typeof createLakeRippleUniforms>, ripples, this.position.x, this.position.z, this.quality.maxRipples);
  }
  get reflectionSource(): PlanarReflectionSource | null { return this.source; }
  /** Switch only presentation resources. Geometry, bounds, normals and wave time stay intact. */
  applyQuality(quality: LakeQuality, source: PlanarReflectionSource | null, bakedFoam?: LakeFoamData, preparedFoam?: DataTexture | null): void {
    const a = resolveLakeAppearance(this.lake), uniforms = this.material.uniforms;
    uniforms.crestFoamStrength!.value = createWaterCrestFoamUniforms(a, quality.foamAllowed).crestFoamStrength.value;
    uniforms.sunGlintDetail!.value = quality.reflectionQuality === "off" || a.reflectionQuality === "low" ? 0 : 1;
    const foam = quality.foamAllowed && a.foamEnabled ? this.foamTexture ?? preparedFoam ?? createLakeFoamMask(this.lake, this.data, a.foamWidth) : null;
    let bake: ReturnType<typeof lakeFoamTexture> | null = null;
    try {
      if (quality.foamAllowed && this.lake.geometryFoam?.enabled && !this.geometryFoamTexture && bakedFoam && bakedFoam.metadata.surface!=="river" &&
        Math.abs(this.lake.surfaceLevel - bakedFoam.metadata.level) < 1e-6) bake = lakeFoamTexture(bakedFoam);
    } catch (error) { if (foam !== this.foamTexture && foam !== preparedFoam) foam?.dispose(); throw error; }
    const geometryFoam = quality.foamAllowed && this.lake.geometryFoam?.enabled ? this.geometryFoamTexture ?? bake?.texture ?? null : null;
    if (foam !== this.foamTexture) this.foamTexture?.dispose();
    if (geometryFoam !== this.geometryFoamTexture) this.geometryFoamTexture?.dispose();
    this.foamTexture = foam; this.geometryFoamTexture = geometryFoam;
    uniforms.foamMask!.value = foam; uniforms.foamOpacity!.value = foam ? a.foamOpacity : 0;
    uniforms.contactCount!.value = quality.foamAllowed ? this.contactCount : 0;
    uniforms.contactOpacity!.value = quality.foamAllowed ? a.foamOpacity : 0;
    uniforms.geometryFoamMask!.value = geometryFoam;
    if (bake && bakedFoam) {
      uniforms.geometryFoamMin!.value.set(...bakedFoam.metadata.min);
      uniforms.geometryFoamSize!.value.set(bakedFoam.metadata.max[0] - bakedFoam.metadata.min[0], bakedFoam.metadata.max[1] - bakedFoam.metadata.min[1]);
      uniforms.geometryFoamGrid!.value.copy(bake.grid); uniforms.geometryFoamTile!.value.copy(bake.tile);
    }
    if (!!this.material.defines.FORGE_LAKE_GEOMETRY_FOAM !== !!geometryFoam) {
      if (geometryFoam) this.material.defines.FORGE_LAKE_GEOMETRY_FOAM = 1;
      else delete this.material.defines.FORGE_LAKE_GEOMETRY_FOAM;
      this.material.needsUpdate = true;
    }
    if (this.source !== source) {
      this.source?.removeConsumer(this); this.setPlanarReflectionBinding(null);
      this.source = source; source?.addConsumer(this);
    }
    this.quality = { ...quality };
    const refractionAllowed = quality.reflectionQuality !== "off" && a.refractionStrength > 0;
    if (refractionAllowed && !this.refractionMask) this.refractionMask = createLakeRefractionMask(this.data);
    if (!refractionAllowed) { this.refractionMask?.dispose(); this.refractionMask = null; }
    uniforms.lakeRefractionMask!.value = this.refractionMask;
    uniforms.lakeRefractionStrength!.value = this.refractionMask ? a.refractionStrength : 0;
    if (refractionAllowed && !this.refractionMask) {
      this.userData.lakeRefractionFallback = "Connected-face grid missing or exceeds 2048 texels per mask axis.";
    } else delete this.userData.lakeRefractionFallback;
    if (!quality.foamAllowed) this.foamMaterial.dispose();
    uniforms.wheelRippleCount!.value = Math.min(uniforms.wheelRippleCount!.value, quality.maxRipples);
  }
  setSurfaceWaveTime(seconds: number): void {
    this.externalWaveTime = true;
    this.material.uniforms.surfaceWaveTime!.value = lakeWaveTime(seconds, this.waveParameters);
  }
  renderWaveOverride(renderer: WebGLRenderer, camera: Camera, kind: "normal" | "depth"): void {
    let proxy = this.waveOverrides.get(kind);
    if (!proxy) {
      const material = kind === "normal" ? new MeshNormalMaterial({ side: DoubleSide })
        : new MeshDepthMaterial({ depthPacking: RGBADepthPacking, blending: NoBlending, side: DoubleSide });
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, Object.fromEntries(["surfaceWaveTime", "surfaceWaveHeight", "surfaceWaveShoreDepth", "surfaceWaveComponents"]
          .map(key => [key, this.material.uniforms[key]!])));
        shader.vertexShader = `attribute float waterDepth;attribute vec2 waterDepthSlope;\n${LAKE_WAVES_GLSL}\n` + shader.vertexShader.replace("#include <begin_vertex>",
          "#include <begin_vertex>\ntransformed.y+=lakeWaveOffset(position.xz,waterDepth);")
          .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvec3 waveNormal=lakeWaveSample(position.xz,waterDepth,waterDepthSlope);objectNormal=normalize(vec3(-waveNormal.y,1.,-waveNormal.z));");
      };
      proxy = new Mesh(this.geometry, material); proxy.matrixAutoUpdate = false;
      this.waveOverrides.set(kind, proxy);
    }
    proxy.matrix.copy(this.matrixWorld); proxy.layers.mask = this.layers.mask;
    const autoClear = renderer.autoClear;
    try { renderer.autoClear = false; renderer.render(proxy, camera); }
    finally { renderer.autoClear = autoClear; }
  }
  setPlanarReflectionBinding(binding: PlanarReflectionBinding | null) {
    this.material.uniforms.reflectionTexture!.value = binding?.texture ?? null;
    const image = binding?.texture.image as { width: number; height: number } | undefined;
    this.material.uniforms.reflectionTexelSize!.value.set(1 / (image?.width || 1), 1 / (image?.height || 1));
    this.material.uniforms.reflectionMatrix!.value = binding?.textureMatrix ?? new Matrix4();
    this.material.uniforms.planarReflectionEnabled!.value = binding ? 1 : 0;
    this.material.uniforms.reflectionStrength!.value = this.strength;
  }
  dispose() { for (const proxy of this.waveOverrides.values()) proxy.material.dispose(); this.waveOverrides.clear();
    this.refractionMask?.dispose(); this.refractionMask = null; this.material.uniforms.lakeRefractionMask!.value = null;
    this.foamMaterial.dispose();
    this.foamTexture?.dispose(); this.foamTexture = null; this.material.uniforms.foamMask!.value = null;
    this.geometryFoamTexture?.dispose(); this.geometryFoamTexture = null; this.material.uniforms.geometryFoamMask!.value = null;
    this.source?.removeConsumer(this); this.source = null; this.setPlanarReflectionBinding(null); this.geometry.dispose(); this.material.dispose(); }
}

/** Replace the existing override-pass water draw with its displacing variant. */
export function renderSceneWithLakeOverride(scene: Object3D, kind: "normal" | "depth", render: () => void): void {
  const lakes: LakeWaterObject[] = [];
  scene.traverseVisible(object => { if (object instanceof LakeWaterObject && object.waveParameters.height > 0) lakes.push(object); });
  if (!lakes.length) { render(); return; }
  for (const lake of lakes) lake.visible = false;
  const previous = scene.onAfterRender;
  scene.onAfterRender = (renderer, renderedScene, camera, geometry, material, group) => {
    previous.call(scene, renderer, renderedScene, camera, geometry, material, group);
    for (const lake of lakes) lake.renderWaveOverride(renderer, camera, kind);
  };
  try { render(); }
  finally { scene.onAfterRender = previous; for (const lake of lakes) lake.visible = true; }
}
