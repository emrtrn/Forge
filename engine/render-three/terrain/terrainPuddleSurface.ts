import { BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshPhysicalMaterial, Vector4 } from "three";
import type { TerrainPuddleGeometry } from "@engine/terrain/terrainPuddle";
import type { PlanarReflectionBinding } from "../planarReflectionSource";

/** Separate horizontal water over a changing bed. Prototype: environment
 * reflections, shallow edge fade and bounded analytic contact ripples. Optional
 * planar bindings are supplied by a scene owner; no per-body target allocation. */
export class TerrainPuddleSurface extends Mesh<BufferGeometry, MeshPhysicalMaterial> {
  private readonly time = { value: 0 };
  private readonly ringCount = { value: 0 };
  private readonly rings = { value: Array.from({ length: 12 }, () => new Vector4()) };
  private readonly history: { x: number; z: number; born: number; strength: number }[] = [];
  private seconds = 0;
  private readonly planar = { value: null as PlanarReflectionBinding["texture"] | null };
  private readonly planarMatrix = { value: new Matrix4() };
  private readonly planarReady = { value: 0 };

  constructor() {
    super(new BufferGeometry(), new MeshPhysicalMaterial({ color: "#504a35", roughness: .13,
      metalness: 0, transparent: true, opacity: .82, depthWrite: false, envMapIntensity: 1.4 }));
    this.name = "terrain-puddle-prototype";
    this.visible = false;
    this.material.onBeforeCompile = shader => {
      shader.uniforms.puddleTime = this.time;
      shader.uniforms.puddleRingCount = this.ringCount;
      shader.uniforms.puddleRings = this.rings;
      shader.uniforms.puddlePlanar = this.planar;
      shader.uniforms.puddlePlanarMatrix = this.planarMatrix;
      shader.uniforms.puddlePlanarReady = this.planarReady;
      shader.vertexShader = `attribute float puddleDepth; varying float vPuddleDepth; varying vec2 vPuddleWorld;
uniform mat4 puddlePlanarMatrix; varying vec4 vPuddleProjected;\n${shader.vertexShader}`
        .replace("#include <begin_vertex>", `#include <begin_vertex>
vPuddleDepth = puddleDepth; vPuddleWorld = (modelMatrix * vec4(position, 1.0)).xz;
vPuddleProjected = puddlePlanarMatrix * modelMatrix * vec4(position, 1.0);`);
      shader.fragmentShader = `varying float vPuddleDepth; varying vec2 vPuddleWorld;
uniform sampler2D puddlePlanar; uniform float puddlePlanarReady; varying vec4 vPuddleProjected;
uniform float puddleTime; uniform int puddleRingCount; uniform vec4 puddleRings[12];\n${shader.fragmentShader}`
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
vec2 gradient = vec2(0.0);
for (int i = 0; i < 12; i++) {
  if (i >= puddleRingCount) break;
  vec4 ring = puddleRings[i];
  float age = puddleTime - ring.z;
  vec2 delta = vPuddleWorld - ring.xy;
  float distanceToRing = length(delta);
  float band = distanceToRing - age * .65;
  float amplitude = exp(-band * band / .018) * exp(-age * 2.0) * ring.w;
  gradient += delta / max(.001, distanceToRing) * cos(band * 30.0) * amplitude * .12;
}
gradient *= smoothstep(0.0, .025, vPuddleDepth);
normal = normalize(normal + mat3(viewMatrix) * vec3(-gradient.x, 0.0, -gradient.y));`)
        .replace("#include <opaque_fragment>", `
if (puddlePlanarReady > .5 && vPuddleProjected.w > 0.0) {
  vec2 projected = vPuddleProjected.xy / vPuddleProjected.w + gradient * .015;
  if (all(greaterThanEqual(projected, vec2(0.0))) && all(lessThanEqual(projected, vec2(1.0)))) {
    vec4 reflected = texture2D(puddlePlanar, projected);
    float fresnel = .02 + .98 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
    outgoingLight = mix(outgoingLight, reflected.rgb / max(reflected.a, .0001), clamp(reflected.a, 0.0, 1.0) * (.18 + .78 * fresnel));
  }
}
#include <opaque_fragment>`)
        .replace("#include <alphatest_fragment>", "diffuseColor.a *= smoothstep(0.0, .012, vPuddleDepth);\n#include <alphatest_fragment>");
    };
    this.material.customProgramCacheKey = () => "terrain-puddle-prototype-v1";
  }

  setPlanarReflectionBinding(binding: PlanarReflectionBinding | null): void {
    this.planar.value = binding?.texture ?? null;
    this.planarReady.value = binding ? 1 : 0;
    if (binding) this.planarMatrix.value = binding.textureMatrix;
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
  clearRipples(): void { this.history.length = 0; this.ringCount.value = 0; }
  dispose(): void { this.setPlanarReflectionBinding(null); this.clearRipples(); this.geometry.dispose(); this.material.dispose(); }
}
