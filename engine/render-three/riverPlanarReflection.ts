import { BufferAttribute, BufferGeometry, Box3, Matrix4, Mesh, Vector2, Vector3, Vector4,
  Scene, type Camera, type ShaderMaterial, type WebGLRenderer } from "three";
import { isPlanarReflectionCamera, PlanarReflectionSource, planarReflectionScreenCoverage,
  PLANAR_REFLECTION_MIN_SCREEN_COVERAGE, type PlanarReflectionQuality } from "./planarReflectionSource";
import { riverReflectionPatches, type RiverReflectionMesh, type RiverReflectionPatch } from "./riverReflectionGeometry";
import { WaterReflectionRegistry } from "./waterReflectionRegistry";
import type { LakeQuality } from "../perf/lakeQuality";

export const RIVER_PLANAR_BUDGET = {
  medium: { active: 2, captures: 1, interval: 32, resolution: 256 },
  high: { active: 4, captures: 2, interval: 4, resolution: 512 },
} as const;

export function effectiveRiverReflectionQuality(authored: "low" | PlanarReflectionQuality, ceiling: LakeQuality["reflectionQuality"]): PlanarReflectionQuality | null {
  return authored === "low" || ceiling === "off" ? null : authored === "medium" || ceiling === "medium" ? "medium" : "high";
}

export function createRiverPlanarUniforms() {
  return {
    riverPlanarTextures: { value: [null, null, null, null] },
    riverPlanarMatrices: { value: Array.from({ length: 4 }, () => new Matrix4()) },
    riverPlanarTexels: { value: Array.from({ length: 4 }, () => new Vector2(1, 1)) },
    riverPlanarEnabled: { value: new Vector4() },
  };
}

/** Static sampler indices also work on implementations that disallow varying
 * sampler-array indices. Captures contain premultiplied linear HDR coverage. */
export const RIVER_PLANAR_GLSL = /* glsl */ `
uniform sampler2D riverPlanarTextures[4];
uniform mat4 riverPlanarMatrices[4];
uniform vec2 riverPlanarTexels[4];
uniform vec4 riverPlanarEnabled;
varying vec4 vRiverPlanarWeights;
vec4 riverPlanarSample(sampler2D image, mat4 matrix, vec2 texel, vec3 position, vec2 distortion, float roughness) {
  vec4 projected=matrix*vec4(position,1.);
  if(projected.w<=0.) return vec4(0.);
  vec2 uv=projected.xy/projected.w+distortion*.006;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))) return vec4(0.);
  vec2 border=min(uv,1.-uv);
  float edge=smoothstep(0.,.025,min(border.x,border.y));
  vec2 t=texel*mix(.75,4.,roughness),lo=texel*.5,hi=1.-lo;
  vec4 c=texture2D(image,clamp(uv,lo,hi))*4.;
  c+=texture2D(image,clamp(uv+vec2(t.x,0.),lo,hi))*2.;
  c+=texture2D(image,clamp(uv-vec2(t.x,0.),lo,hi))*2.;
  c+=texture2D(image,clamp(uv+vec2(0.,t.y),lo,hi))*2.;
  c+=texture2D(image,clamp(uv-vec2(0.,t.y),lo,hi))*2.;
  c+=texture2D(image,clamp(uv+t,lo,hi));c+=texture2D(image,clamp(uv-t,lo,hi));
  c+=texture2D(image,clamp(uv+vec2(t.x,-t.y),lo,hi));
  c+=texture2D(image,clamp(uv+vec2(-t.x,t.y),lo,hi));
  return c*(edge/16.);
}
vec4 riverPlanar(vec3 position, vec2 distortion, float roughness) {
  vec4 w=vRiverPlanarWeights*riverPlanarEnabled,c=vec4(0.);
  if(w.x>0.) c+=w.x*riverPlanarSample(riverPlanarTextures[0],riverPlanarMatrices[0],riverPlanarTexels[0],position,distortion,roughness);
  if(w.y>0.) c+=w.y*riverPlanarSample(riverPlanarTextures[1],riverPlanarMatrices[1],riverPlanarTexels[1],position,distortion,roughness);
  if(w.z>0.) c+=w.z*riverPlanarSample(riverPlanarTextures[2],riverPlanarMatrices[2],riverPlanarTexels[2],position,distortion,roughness);
  if(w.w>0.) c+=w.w*riverPlanarSample(riverPlanarTextures[3],riverPlanarMatrices[3],riverPlanarTexels[3],position,distortion,roughness);
  return c;
}`;

const managers = new WeakMap<Scene, RiverPlanarScheduler>();
type Owner = Mesh<BufferGeometry, ShaderMaterial>;
interface Candidate {
  key: string; quality: PlanarReflectionQuality; patch: RiverReflectionPatch;
  bounds: Box3; coverage: number; members: { surface: RiverPlanarSurface; patch: RiverReflectionPatch }[];
}
interface Slot { candidate: Candidate; source: PlanarReflectionSource; updated: number; born: number }

/** Runs after world matrices update and before geometry attribute upload.
 * Budgeting is independent of river draw order and nested frame counters. */
export class RiverPlanarScheduler {
  private readonly surfaces = new Set<RiverPlanarSurface>();
  private readonly previous: Scene["onBeforeRender"];
  private readonly before: Scene["onBeforeRender"];
  private slots: Slot[] = [];
  private camera: Camera | null = null;
  private capturing = false;
  captures = 0;
  constructor(private readonly scene: Scene, private readonly registry = new WaterReflectionRegistry()) {
    this.previous = scene.onBeforeRender;
    const scheduler = this;
    this.before = function(...args) {
      scheduler.previous.apply(this, args);
      const [renderer, renderedScene, camera] = args;
      if (!renderedScene.overrideMaterial) scheduler.update(renderer, camera);
    };
    scene.onBeforeRender = this.before;
  }
  add(surface: RiverPlanarSurface): void { this.surfaces.add(surface); }
  remove(surface: RiverPlanarSurface): void {
    this.surfaces.delete(surface); surface.clear(); this.reset();
    if (!this.surfaces.size) {
      if (this.scene.onBeforeRender === this.before) this.scene.onBeforeRender = this.previous;
      managers.delete(this.scene);
    }
  }
  reset(): void {
    for (const surface of this.surfaces) surface.clear();
    for (const slot of this.slots) this.registry.release(slot.source);
    this.slots = [];
  }
  get active(): number { return this.slots.length; }
  update(renderer: WebGLRenderer, camera: Camera): void {
    if (this.capturing || isPlanarReflectionCamera(camera)) return;
    if (camera !== this.camera) { this.reset(); this.camera = camera; }
    const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const groups = new Map<string, Candidate>();
    const cameraPosition = camera.getWorldPosition(new Vector3());
    for (const surface of this.surfaces) {
      surface.beginFrame();
      if (!surface.quality || !surface.owner.layers.test(camera.layers) || !surface.visible(this.scene)) continue;
      for (const patch of surface.patches()) {
        if (patch.plane.distanceToPoint(cameraPosition) <= 0) continue;
        const coverage = planarReflectionScreenCoverage(patch.bounds, vp) ?? 1;
        if (coverage < PLANAR_REFLECTION_MIN_SCREEN_COVERAGE) continue;
        const key = JSON.stringify([surface.group, ...patch.plane.normal.toArray(), patch.plane.constant, surface.quality]);
        let candidate = groups.get(key);
        if (!candidate) groups.set(key, candidate = { key, quality: surface.quality, patch, bounds: patch.bounds.clone(), coverage, members: [] });
        candidate.bounds.union(patch.bounds); candidate.coverage = Math.max(candidate.coverage, coverage);
        candidate.members.push({ surface, patch });
      }
    }
    const now = performance.now(), previous = new Map(this.slots.map(s => [s.candidate.key, s]));
    const candidates = [...groups.values()].sort((a, b) => {
      // Small hysteresis prevents similar neighbouring patches from thrashing.
      const ac = a.coverage * (previous.has(a.key) ? 1.1 : 1), bc = b.coverage * (previous.has(b.key) ? 1.1 : 1);
      return bc - ac || (previous.get(a.key)?.updated ?? -Infinity) - (previous.get(b.key)?.updated ?? -Infinity) || a.key.localeCompare(b.key);
    });
    const high = candidates.some(c => c.quality === "high"), budget = high ? RIVER_PLANAR_BUDGET.high : RIVER_PLANAR_BUDGET.medium;
    const selected: Candidate[] = []; let medium = 0;
    for (const candidate of candidates) {
      if (selected.length === budget.active) break;
      if (candidate.quality === "medium" && medium++ >= RIVER_PLANAR_BUDGET.medium.active) continue;
      selected.push(candidate);
    }
    for (const slot of this.slots) if (!selected.some(c => c.key === slot.candidate.key)) this.registry.release(slot.source);
    this.slots = selected.map(candidate => {
      const slot = previous.get(candidate.key);
      if (slot) { slot.candidate = candidate; return slot; }
      return { candidate, source: this.registry.acquire(candidate.members[0]!.surface.group, candidate.patch.plane, candidate.quality), updated: -Infinity, born: now };
    });
    let captures = 0, mediumCaptures = 0;
    this.capturing = true;
    try {
      for (const slot of [...this.slots].sort((a, b) => a.updated - b.updated || b.candidate.coverage - a.candidate.coverage)) {
        const q = RIVER_PLANAR_BUDGET[slot.candidate.quality];
        if (now - slot.updated < q.interval || captures >= budget.captures || (slot.candidate.quality === "medium" && mediumCaptures >= 1)) continue;
        slot.source.update(renderer, this.scene, camera, slot.candidate.bounds);
        slot.updated = now; captures++; if (slot.candidate.quality === "medium") mediumCaptures++;
      }
    } finally { this.capturing = false; }
    this.captures += captures;
    this.slots.forEach((slot, index) => {
      if (!slot.source.hasCapture) return;
      for (const { surface, patch } of slot.candidate.members) surface.bind(index, slot.source, patch, Math.min(1, (now - slot.born) / 150));
    });
    for (const surface of this.surfaces) {
      surface.finishFrame();
      surface.owner.userData.riverPlanarActive = this.active;
      surface.owner.userData.riverPlanarCaptures = captures;
    }
  }
}

/** Owns only CPU patch metadata and bindings; the scene scheduler owns targets. */
export class RiverPlanarSurface {
  private scheduler: RiverPlanarScheduler | null = null;
  private scene: Scene | null = null;
  private readonly matrix = new Matrix4().makeScale(0, 0, 0);
  private cached: RiverReflectionPatch[] = [];
  readonly weights: BufferAttribute;
  private previousPatches: RiverReflectionPatch[][] = [[], [], [], []];
  private nextPatches: RiverReflectionPatch[][] = [[], [], [], []];
  quality: PlanarReflectionQuality | null;
  constructor(readonly owner: Owner, private readonly mesh: RiverReflectionMesh, readonly group: string, quality: PlanarReflectionQuality | null, private readonly registry?: WaterReflectionRegistry) {
    this.quality = quality;
    this.weights = new BufferAttribute(new Float32Array(mesh.positions.length / 3 * 4), 4);
    owner.geometry.setAttribute("riverPlanarWeights", this.weights);
  }
  attachToScene(): void {
    let root: import("three").Object3D = this.owner;
    while (root.parent) root = root.parent;
    if (root instanceof Scene && root !== this.scene) this.attach(root);
  }
  attach(scene: Scene): void {
    this.detach(); this.scene = scene;
    let scheduler = managers.get(scene);
    if (!scheduler) managers.set(scene, scheduler = new RiverPlanarScheduler(scene, this.registry));
    this.scheduler = scheduler; scheduler.add(this);
  }
  detach(): void { this.scheduler?.remove(this); this.scheduler = null; this.scene = null; this.clear(); }
  setQuality(quality: PlanarReflectionQuality | null): void {
    if (quality === this.quality) return;
    this.quality = quality; this.scheduler?.reset(); this.clear();
    if (!quality) this.cached = [];
    this.matrix.makeScale(0, 0, 0);
  }
  visible(scene: Scene): boolean {
    let root: import("three").Object3D = this.owner;
    while (root.parent) root = root.parent;
    if (root !== scene) return false;
    for (let node: typeof this.owner | import("three").Object3D | null = this.owner; node; node = node.parent) if (!node.visible) return false;
    return true;
  }
  patches(): RiverReflectionPatch[] {
    if (!this.matrix.equals(this.owner.matrixWorld)) {
      this.matrix.copy(this.owner.matrixWorld);
      this.cached = riverReflectionPatches(this.mesh, this.matrix);
      this.owner.userData.riverPlanarPatches = this.cached.length;
    }
    return this.cached;
  }
  beginFrame(): void {
    this.nextPatches = [[], [], [], []];
    const u = this.owner.material.uniforms;
    u.riverPlanarEnabled!.value.set(0, 0, 0, 0);
    u.riverPlanarTextures!.value.fill(null);
  }
  finishFrame(): void {
    if (this.nextPatches.every((patches, slot) => patches.length === this.previousPatches[slot]!.length
      && patches.every((patch, i) => patch === this.previousPatches[slot]![i]))) return;
    this.weights.array.fill(0);
    this.nextPatches.forEach((patches, index) => {
      for (const patch of patches) for (const [vertex, weight] of patch.weights) this.weights.array[vertex * 4 + index]! += weight;
    });
    this.weights.needsUpdate = true;
    this.previousPatches = this.nextPatches;
  }
  clear(): void {
    this.beginFrame(); this.finishFrame();
    const u = this.owner.material.uniforms;
    u.riverPlanarEnabled!.value.set(0, 0, 0, 0);
    u.riverPlanarTextures!.value.fill(null);
    this.owner.userData.riverPlanarActive = 0; this.owner.userData.riverPlanarCaptures = 0;
  }
  bind(index: number, source: PlanarReflectionSource, patch: RiverReflectionPatch, fade: number): void {
    const u = this.owner.material.uniforms;
    u.riverPlanarTextures!.value[index] = source.binding.texture;
    u.riverPlanarMatrices!.value[index].copy(source.binding.textureMatrix);
    const size = source.binding.texture.image as { width: number; height: number };
    u.riverPlanarTexels!.value[index].set(1 / size.width, 1 / size.height);
    u.riverPlanarEnabled!.value.setComponent(index, fade);
    this.nextPatches[index]!.push(patch);
  }
}
