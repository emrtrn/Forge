import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, FloatType, Matrix4, Mesh, MeshPhysicalMaterial, NearestFilter, RedFormat, Vector4, Vector3, Vector2, type Texture } from "three";
import type { ResolvedWind } from "@engine/environment/wind";
import { PuddleWindMotion } from "@engine/environment/puddleWind";
import { PUDDLE_MUD_DEFAULTS, PUDDLE_WIND_DEFAULTS, type PuddleWindSettings } from "@engine/scene/puddleWater";
import { PUDDLE_WHEEL_RIPPLE_DEFAULTS, type PuddleWheelRippleSettings } from "@engine/scene/puddleWater";
import type { LakeRipple } from "@engine/terrain/lakeInteraction";
import type { TerrainPuddleGeometry } from "@engine/terrain/terrainPuddle";
import type { PlanarReflectionBinding, PlanarReflectionSource } from "../planarReflectionSource";

/** Separate horizontal water over a changing bed. Prototype: environment
 * reflections, shallow edge fade and bounded analytic contact ripples. Optional
 * planar bindings are supplied by a scene owner; no per-body target allocation. */
export class TerrainPuddleSurface extends Mesh<BufferGeometry, MeshPhysicalMaterial> {
  private readonly time = { value: 0 };
  private readonly ringCount = { value: 0 };
  private readonly rings = { value: Array.from({ length: 12 }, () => new Vector4()) };
  private readonly history: { x: number; z: number; born: number; strength: number }[] = [];
  private seconds = 0;
  private readonly windMotion = new PuddleWindMotion();
  private readonly mudDensity = { value: PUDDLE_MUD_DEFAULTS.mudDensity };
  private readonly mudColor = { value: new Color(PUDDLE_MUD_DEFAULTS.mudColor) };
  private readonly windNormal = { value: null as Texture | null };
  private readonly windOffset = { value: new Vector4() };
  private readonly windWave = { value: new Vector3(0, 1, 0) };
  private readonly windOrigin = { value: new Vector2() };
  private readonly windParameters = { value: new Vector4(0, PUDDLE_WIND_DEFAULTS.windWorldScale, 0, 0) };
  private readonly parameters = { value: new Vector4(.65, .135, .21, 2) };
  private readonly stopData = new Float32Array(32 * 12).fill(10000);
  private readonly stopTexture = new DataTexture(this.stopData, 32, 12, RedFormat, FloatType);
  private stopRows: readonly Float32Array[] = [];
  get wheelRippleCount(): number { return this.ringCount.value; }
  private readonly planar = { value: null as PlanarReflectionBinding["texture"] | null };
  private readonly planarMatrix = { value: new Matrix4() };
  private readonly planarReady = { value: 0 };
  private readonly planarStrength = { value: 1 };
  private readonly planarTexel = { value: 1 / 256 };
  reflectionSource: PlanarReflectionSource | null = null;

  constructor() {
    super(new BufferGeometry(), new MeshPhysicalMaterial({ color: "#504a35", roughness: .13,
      metalness: 0, ior: 1.333, transparent: true, opacity: .82, depthWrite: false, envMapIntensity: 1.4 }));
    this.name = "terrain-puddle-prototype";
    this.visible = false;
    this.stopTexture.minFilter = this.stopTexture.magFilter = NearestFilter;
    this.stopTexture.needsUpdate = true;
    this.material.onBeforeCompile = shader => {
      shader.uniforms.puddleTime = this.time;
      shader.uniforms.puddleMudDensity = this.mudDensity;
      shader.uniforms.puddleMudColor = this.mudColor;
      shader.uniforms.puddleWindNormal = this.windNormal;
      shader.uniforms.puddleWindOffset = this.windOffset;
      shader.uniforms.puddleWindWave = this.windWave;
      shader.uniforms.puddleWindOrigin = this.windOrigin;
      shader.uniforms.puddleWindParameters = this.windParameters;
      shader.uniforms.puddleRingCount = this.ringCount;
      shader.uniforms.puddleRings = this.rings;
      shader.uniforms.puddleRippleParameters = this.parameters;
      shader.uniforms.puddleRippleStops = { value: this.stopTexture };
      shader.uniforms.puddlePlanar = this.planar;
      shader.uniforms.puddlePlanarMatrix = this.planarMatrix;
      shader.uniforms.puddlePlanarReady = this.planarReady;
      shader.uniforms.puddlePlanarStrength = this.planarStrength;
      shader.uniforms.puddlePlanarTexel = this.planarTexel;
      shader.vertexShader = `attribute float puddleDepth; varying float vPuddleDepth; varying vec2 vPuddleWorld;
uniform mat4 puddlePlanarMatrix; varying vec4 vPuddleProjected;\n${shader.vertexShader}`
        .replace("#include <begin_vertex>", `#include <begin_vertex>
vPuddleDepth = puddleDepth; vPuddleWorld = (modelMatrix * vec4(position, 1.0)).xz;
vPuddleProjected = puddlePlanarMatrix * modelMatrix * vec4(position, 1.0);`);
      shader.fragmentShader = `varying float vPuddleDepth; varying vec2 vPuddleWorld;
uniform float puddleMudDensity; uniform vec3 puddleMudColor;
uniform sampler2D puddlePlanar; uniform mat4 puddlePlanarMatrix; uniform float puddlePlanarReady; uniform float puddlePlanarStrength; uniform float puddlePlanarTexel; varying vec4 vPuddleProjected;
uniform float puddleTime; uniform int puddleRingCount; uniform vec4 puddleRings[12];
uniform vec4 puddleRippleParameters; uniform sampler2D puddleRippleStops;
uniform sampler2D puddleWindNormal; uniform vec4 puddleWindOffset; uniform vec4 puddleWindParameters; uniform vec3 puddleWindWave; uniform vec2 puddleWindOrigin;
float puddleWindNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h = vec4(dot(cell, vec2(127.1, 311.7)), dot(cell + vec2(1., 0.), vec2(127.1, 311.7)),
    dot(cell + vec2(0., 1.), vec2(127.1, 311.7)), dot(cell + vec2(1.), vec2(127.1, 311.7)));
  h = fract(sin(h) * 43758.5453);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}\n${shader.fragmentShader}`
        .replace("#include <color_fragment>", `#include <color_fragment>
// Optical thickness comes from the actual live bed. Shallow water stays
// translucent; longer paths progressively hide the bed in suspended mud.
float puddleOpticalDepth = max(0.0, vPuddleDepth) * puddleMudDensity * (opacity / .82);
float puddleMudAmount = 1.0 - exp(-puddleOpticalDepth);
diffuseColor.rgb = mix(diffuseColor.rgb, puddleMudColor, puddleMudAmount * .85);`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
vec2 gradient = vec2(0.0);
if (puddleWindParameters.z > .5 && puddleWindParameters.x > 0.0) {
  vec2 uv = vPuddleWorld / puddleWindParameters.y;
  mat2 rotation = mat2(.8, .6, -.6, .8);
  vec3 n1 = texture2D(puddleWindNormal, uv - puddleWindOffset.xy).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(puddleWindNormal, rotation * uv * 1.73 - puddleWindOffset.zw + 17.3).xyz * 2.0 - 1.0;
  vec2 detailSlope = .65 * n1.xy / max(.35, n1.z) + .35 * transpose(rotation) * n2.xy / max(.35, n2.z);
  // Local wind streaks: coherent curved crests appear in soft, uneven patches,
  // with quiet gaps instead of one repeated wave train across the whole basin.
  vec2 downwind = puddleWindWave.xy;
  vec2 across = vec2(-downwind.y, downwind.x);
  vec2 local = vPuddleWorld - puddleWindOrigin;
  float lateral = dot(local, across);
  float radius = max(.6, puddleWindParameters.y * 1.7);
  float arc = sqrt(lateral * lateral + radius * radius);
  float bend = .65 * (arc - radius);
  float bendDerivative = .65 * lateral / arc;
  float along = dot(local, downwind);
  vec2 patchUV = vec2(along, lateral) / max(.7, puddleWindParameters.y * 2.0);
  vec2 drift = vec2(puddleWindParameters.w * .13, -puddleWindParameters.w * .035);
  float broad = puddleWindNoise(patchUV * vec2(.7, 1.1) - drift + 8.3);
  float breakup = puddleWindNoise(patchUV * vec2(2.1, 1.3) - drift * .7 + 31.7);
  float packet = smoothstep(.35, .7, broad * .7 + breakup * .3);
  // Travelling, irregular breeze windows: individual streaks grow, pass and
  // disappear while neighbouring patches can stay quiet or respond later.
  float breeze = .5 + .32 * sin(puddleWindParameters.w * 1.35 - patchUV.x * .9 + patchUV.y * .8)
    + .18 * sin(puddleWindParameters.w * .57 - patchUV.x * .6 + 2.1);
  packet *= smoothstep(.32, .72, breeze);
  float warp = puddleWindNoise(patchUV * 1.6 + 17.9) - .5;
  float cycles = (along + bend) / (puddleWindParameters.y * .24) + warp * 1.3 - puddleWindWave.z;
  float phase = cycles * 6.28318530718;
  float resolved = 1.0 - smoothstep(.16, .48, fwidth(cycles));
  float ridge = (cos(phase) + .22 * cos(phase * 2.0 + warp)) / 1.22;
  vec2 crestDirection = downwind + across * bendDerivative;
  vec2 slope = crestDirection * ridge * 1.6 * resolved * packet + detailSlope * (.08 + .24 * packet);
  gradient += slope * puddleWindParameters.x;
  // Unresolved small ripples broaden the light lobe inside a breeze patch;
  // coherent crests should not all turn into razor-white sun reflections.
  float breezeRoughness = smoothstep(.0, .08, puddleWindParameters.x) * packet;
  roughnessFactor = mix(roughnessFactor, max(roughnessFactor, .36), breezeRoughness);
  // Widen highlights when fine normal detail becomes subpixel.
  roughnessFactor = clamp(roughnessFactor + min(.18, length(fwidth(slope)) * puddleWindParameters.x * .3), .04, 1.0);
}
for (int i = 0; i < 12; i++) {
  if (i >= puddleRingCount) break;
  vec4 ring = puddleRings[i];
  float age = puddleTime - ring.z;
  vec2 delta = vPuddleWorld - ring.xy;
  float distanceToRing = length(delta);
  float radius = age * puddleRippleParameters.x;
  float width = puddleRippleParameters.y;
  float band = distanceToRing - radius;
  float sector = floor(mod(atan(delta.y, delta.x) + 6.28318530718, 6.28318530718) * (32.0 / 6.28318530718));
  float stopRadius = texture2D(puddleRippleStops, vec2((sector + .5) / 32.0, (float(i) + .5) / 12.0)).r;
  float blocked = step(.0001, stopRadius) * (1.0 - smoothstep(max(0.0, stopRadius - width), max(.0001, stopRadius), max(distanceToRing, radius)));
  float amplitude = exp(-band * band / (width * width)) * exp(-age * 4.0 / puddleRippleParameters.w) * ring.w * blocked;
  gradient += delta / max(.001, distanceToRing) * cos(band * 6.28318530718 / puddleRippleParameters.z) * amplitude * .12;
}
gradient *= smoothstep(0.0, .025, vPuddleDepth);
normal = normalize(normal + mat3(viewMatrix) * vec3(-gradient.x, 0.0, -gradient.y));`)
        .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
// Keep captured scene reflections intact while reducing the narrow direct-light glint.
reflectedLight.directSpecular *= .2;`)
        .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
if (puddlePlanarReady > .5 && vPuddleProjected.w > 0.0) {
  // Project the world-space surface slope through the reflection camera.
  // Camera rotation/perspective must also rotate/scale the distortion.
  vec4 bentProjection = vPuddleProjected + puddlePlanarMatrix * vec4(-gradient.x * .18, 0.0, -gradient.y * .18, 0.0);
  vec2 projected = bentProjection.xy / max(.0001, bentProjection.w);
  if (all(greaterThanEqual(projected, vec2(0.0))) && all(lessThanEqual(projected, vec2(1.0)))) {
    // Small roughness-aware footprint in linear HDR, retaining premultiplied geometry coverage.
    vec2 footprint = vec2(puddlePlanarTexel * roughnessFactor * 3.0, 0.0);
    vec4 reflected = texture2D(puddlePlanar, projected) * .4
      + (texture2D(puddlePlanar, projected + footprint) + texture2D(puddlePlanar, projected - footprint)
      + texture2D(puddlePlanar, projected + footprint.yx) + texture2D(puddlePlanar, projected - footprint.yx)) * .15;
    vec2 border = min(projected, vec2(1.0) - projected);
    float edge = smoothstep(0.0, .025, min(border.x, border.y));
    // Replace only incoming environment radiance. Three's physical BRDF applies
    // water Fresnel/roughness once, retaining diffuse colour and direct light.
    radiance = mix(radiance, reflected.rgb / max(reflected.a, .0001), clamp(reflected.a, 0.0, 1.0) * edge * puddlePlanarStrength);
  }
}
#endif`)
        .replace("#include <alphatest_fragment>", "diffuseColor.a = puddleMudAmount * smoothstep(0.0, .006, vPuddleDepth);\n#include <alphatest_fragment>");
    };
    this.material.customProgramCacheKey = () => "terrain-puddle-depth-mud-v12";
  }

  setMudAppearance(appearance: Partial<typeof PUDDLE_MUD_DEFAULTS>): void {
    this.mudDensity.value = appearance.mudDensity ?? PUDDLE_MUD_DEFAULTS.mudDensity;
    this.mudColor.value.set(appearance.mudColor ?? PUDDLE_MUD_DEFAULTS.mudColor);
  }

  /** Borrowed from the scene's water texture cache; the surface never disposes it. */
  setWindNormal(texture: Texture | null): void {
    this.windNormal.value = texture;
    this.windParameters.value.z = texture ? 1 : 0;
  }
  /** Stable authored seed, independent of the live deformed shore/bounds. */
  setWindOrigin(x: number, z: number): void { this.windOrigin.value.set(x, z); }
  updateWind(wind: ResolvedWind, seconds: number, appearance: Partial<PuddleWindSettings> = {}): void {
    this.windMotion.update(wind, seconds, appearance);
    this.windOffset.value.fromArray(this.windMotion.offset);
    this.windWave.value.set(wind.direction[0], wind.direction[1], this.windMotion.phase);
    this.windParameters.value.set(this.windMotion.strength, appearance.windWorldScale ?? PUDDLE_WIND_DEFAULTS.windWorldScale,
      this.windNormal.value ? 1 : 0, this.windMotion.seconds);
  }

  setPlanarReflectionBinding(binding: PlanarReflectionBinding | null): void {
    this.planar.value = binding?.texture ?? null;
    this.planarReady.value = binding ? 1 : 0;
    if (binding) this.planarMatrix.value = binding.textureMatrix;
    if (binding) this.planarTexel.value = 1 / ((binding.texture.image as { width?: number } | undefined)?.width ?? 256);
  }

  setPlanarStrength(value: number): void { this.planarStrength.value = value; }
  /** Managed consumers wait for a real capture; prototype bindings retain their existing API. */
  useReflectionSource(source: PlanarReflectionSource | null): void {
    if (source !== this.reflectionSource) {
      this.reflectionSource?.removeConsumer(this);
      this.reflectionSource = source;
      this.setPlanarReflectionBinding(null);
      source?.addConsumer(this);
    }
    this.planarReady.value = source?.hasCapture ? 1 : 0;
  }

  /** Reject failed rebuilds, retaining the last valid surface. dry clears it. */
  rebuild(data: TerrainPuddleGeometry): boolean {
    if (data.status !== "ready" && data.status !== "dry") return false;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute("puddleDepth", new Float32BufferAttribute(data.depths, 1));
    if (data.positions.length) { geometry.computeVertexNormals(); geometry.computeBoundingSphere(); }
    this.geometry.dispose(); this.geometry = geometry;
    this.visible = data.positions.length > 0;
    if (!this.visible) this.clearRipples();
    return true;
  }

  /** Call only for an eligible moving/slipping wheel within this wet basin. */
  ripple(x: number, z: number, strength: number): void {
    if (!this.visible || ![x, z, strength].every(Number.isFinite) || strength <= 0) return;
    this.history.push({ x, z, born: this.seconds, strength: Math.min(1, strength) });
    if (this.history.length > 12) this.history.shift();
  }
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.seconds += dt; this.time.value = this.seconds;
    while (this.history.length && this.seconds - this.history[0]!.born > 2) this.history.shift();
    this.ringCount.value = this.history.length;
    this.history.forEach((r, i) => this.rings.value[i]!.set(r.x, r.z, r.born, r.strength));
  }
  /** Managed physics history. Only bounded normal/reflective distortion; never moves water or its shore. */
  setWheelRipples(ripples: readonly LakeRipple[], settings: PuddleWheelRippleSettings = PUDDLE_WHEEL_RIPPLE_DEFAULTS,
    stops: readonly Float32Array[] = []): void {
    this.time.value = 0;
    this.parameters.value.set(settings.wheelRippleSpeed, settings.wheelRippleWidth, settings.wheelRippleWavelength, settings.wheelRippleLifetime);
    this.ringCount.value = Math.min(12, ripples.length);
    ripples.slice(0, 12).forEach((r, i) => this.rings.value[i]!.set(r.x, r.z, -r.age, r.strength * settings.wheelRippleStrength));
    if (stops.length !== this.stopRows.length || stops.some((r, i) => r !== this.stopRows[i])) {
      this.stopData.fill(0);
      stops.slice(0, 12).forEach((row, i) => this.stopData.set(row, i * 32));
      this.stopRows = [...stops]; this.stopTexture.needsUpdate = true;
    }
  }
  clearRipples(): void { this.history.length = 0; this.ringCount.value = 0; }
  override dispose(): void { this.useReflectionSource(null); this.setPlanarReflectionBinding(null); this.clearRipples(); this.stopTexture.dispose(); this.geometry.dispose(); this.material.dispose(); super.dispose(); }
}
