import { BufferGeometry, BufferAttribute, Color, DoubleSide, Matrix4, Mesh, ShaderMaterial, type Texture } from "three";
import type { LayoutLakeWaterBody } from "../scene/layout";
import { resolveLakeAppearance } from "../scene/waterBody";
import type { LakeGeometry } from "../terrain/terrainLakeWater";
import type { PlanarReflectionBinding, PlanarReflectionSource } from "./planarReflectionSource";

/** Flat exact surface; the normal animation never displaces the shoreline. */
export class LakeWaterObject extends Mesh<BufferGeometry, ShaderMaterial> {
  private readonly source: PlanarReflectionSource | null;
  private readonly strength: number;
  constructor(lake: LayoutLakeWaterBody, data: LakeGeometry, normal: Texture | null, source: PlanarReflectionSource | null = null) {
    const appearance = resolveLakeAppearance(lake), geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
    geometry.setAttribute("waterDepth", new BufferAttribute(data.depths, 1));
    geometry.setAttribute("uv", new BufferAttribute(data.uvs, 2));
    geometry.setIndex(new BufferAttribute(data.indices, 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    super(geometry, new ShaderMaterial({ transparent: true, depthWrite: false, side: DoubleSide,
      uniforms: { time: { value: 0 }, normalMap: { value: normal }, hasNormal: { value: normal ? 1 : 0 },
        rippleSpeed: { value: appearance.rippleSpeed }, normalScale: { value: appearance.normalScale },
        deepColor: { value: new Color(appearance.deepColor) }, shallowColor: { value: new Color(appearance.shallowColor) },
        opacity: { value: appearance.opacity }, bedVisibility: { value: appearance.bedVisibility },
        absorptionDistance: { value: appearance.absorptionDistance }, reflectionTexture: { value: null },
        reflectionMatrix: { value: new Matrix4() }, reflectionStrength: { value: 0 } },
      vertexShader: `attribute float waterDepth;
        varying float vDepth; varying vec2 vUv; varying vec4 vReflection;
        uniform mat4 reflectionMatrix;
        void main(){vDepth=waterDepth;vUv=uv;vec4 world=modelMatrix*vec4(position,1.);
        vReflection=reflectionMatrix*world;gl_Position=projectionMatrix*viewMatrix*world;}`,
      fragmentShader: `uniform sampler2D normalMap; uniform float hasNormal;
        uniform float time;uniform float rippleSpeed;uniform float normalScale;
        uniform vec3 deepColor;uniform vec3 shallowColor;uniform float opacity;
        uniform float bedVisibility;uniform float absorptionDistance;
        uniform sampler2D reflectionTexture;uniform float reflectionStrength;
        varying float vDepth;varying vec2 vUv;varying vec4 vReflection;
        void main(){float d=max(0.,vDepth);vec2 p=vUv*normalScale*.12;
        vec2 n=(texture2D(normalMap,p+vec2(time*rippleSpeed*.1,0.)).xy*2.-1.)*hasNormal;
        float ripple=sin(p.x*3.+time*rippleSpeed)*sin(p.y*4.-time*rippleSpeed)*.012;
        vec3 color=mix(shallowColor,deepColor,clamp(d/2.2,0.,1.))+ripple+n.x*.03;
        if(reflectionStrength>0.){vec2 r=vReflection.xy/max(vReflection.w,.0001)+n*.015;
        color=mix(color,texture2D(reflectionTexture,r).rgb,reflectionStrength*.3);}
        float transmission=bedVisibility*exp(-d/max(absorptionDistance,.01));
        gl_FragColor=vec4(color,max(opacity,1.-transmission));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }` }));
    this.position.set(...data.position); this.name = `Lake:${lake.id}`;
    this.userData.waterBodyId = lake.id; this.source = source; this.strength = appearance.reflectionStrength;
    this.layers.enable(31); // Water layer marker; the reflection source hides registered consumers.
    source?.addConsumer(this);
    const started = performance.now();
    this.onBeforeRender = (renderer, scene, camera) => {
      this.material.uniforms.time!.value = (performance.now() - started) / 1000;
      source?.update(renderer, scene, camera);
    };
  }
  setPlanarReflectionBinding(binding: PlanarReflectionBinding | null) {
    this.material.uniforms.reflectionTexture!.value = binding?.texture ?? null;
    this.material.uniforms.reflectionMatrix!.value = binding?.textureMatrix ?? new Matrix4();
    this.material.uniforms.reflectionStrength!.value = binding ? this.strength : 0;
  }
  dispose() { this.source?.removeConsumer(this); this.geometry.dispose(); this.material.dispose(); }
}
