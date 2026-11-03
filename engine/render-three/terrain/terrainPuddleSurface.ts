import { BufferGeometry, DataTexture, Float32BufferAttribute, FloatType, Matrix4, Mesh, MeshPhysicalMaterial, NearestFilter, RedFormat, Vector4 } from "three";
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
      metalness: 0, transparent: true, opacity: .82, depthWrite: false, envMapIntensity: 1.4 }));
    this.name = "terrain-puddle-prototype";
    this.visible = false;
    this.stopTexture.minFilter = this.stopTexture.magFilter = NearestFilter;
    this.stopTexture.needsUpdate = true;
    this.material.onBeforeCompile = shader => {
      shader.uniforms.puddleTime = this.time;
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
uniform sampler2D puddlePlanar; uniform float puddlePlanarReady; uniform float puddlePlanarStrength; uniform float puddlePlanarTexel; varying vec4 vPuddleProjected;
uniform float puddleTime; uniform int puddleRingCount; uniform vec4 puddleRings[12];
uniform vec4 puddleRippleParameters; uniform sampler2D puddleRippleStops;\n${shader.fragmentShader}`
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
vec2 gradient = vec2(0.0);
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
        .replace("#include <opaque_fragment>", `
if (puddlePlanarReady > .5 && vPuddleProjected.w > 0.0) {
  vec2 projected = vPuddleProjected.xy / vPuddleProjected.w + gradient * .015;
  if (all(greaterThanEqual(projected, vec2(0.0))) && all(lessThanEqual(projected, vec2(1.0)))) {
    // Small roughness-aware footprint in linear HDR, retaining premultiplied geometry coverage.
    vec2 footprint = vec2(puddlePlanarTexel * roughnessFactor * 3.0, 0.0);
    vec4 reflected = texture2D(puddlePlanar, projected) * .4
      + (texture2D(puddlePlanar, projected + footprint) + texture2D(puddlePlanar, projected - footprint)
      + texture2D(puddlePlanar, projected + footprint.yx) + texture2D(puddlePlanar, projected - footprint.yx)) * .15;
    float fresnel = .02 + .98 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
    vec2 border = min(projected, vec2(1.0) - projected);
    float edge = smoothstep(0.0, .025, min(border.x, border.y));
    outgoingLight = mix(outgoingLight, reflected.rgb / max(reflected.a, .0001), clamp(reflected.a, 0.0, 1.0) * edge * (.18 + .78 * fresnel) * puddlePlanarStrength);
  }
}
#include <opaque_fragment>`)
        .replace("#include <alphatest_fragment>", "diffuseColor.a *= smoothstep(0.0, .012, vPuddleDepth);\n#include <alphatest_fragment>");
    };
    this.material.customProgramCacheKey = () => "terrain-puddle-wheel-ripples-v3";
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
  dispose(): void { this.useReflectionSource(null); this.setPlanarReflectionBinding(null); this.clearRipples(); this.stopTexture.dispose(); this.geometry.dispose(); this.material.dispose(); }
}
