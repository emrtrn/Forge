import { Box3, Frustum, Matrix4, type Camera, type Scene, type WebGLRenderer } from "three";
import { PUDDLE_APPEARANCE, type PuddleWaterBody } from "../scene/puddleWater";
import { isPlanarReflectionCamera, planarReflectionScreenCoverage, type PlanarReflectionQuality, type PlanarReflectionSource } from "./planarReflectionSource";
import { WaterReflectionRegistry } from "./waterReflectionRegistry";
import type { TerrainPuddleSurface } from "./terrain/terrainPuddleSurface";

type Appearance = NonNullable<PuddleWaterBody["appearance"]>;
type Ceiling = "off" | PlanarReflectionQuality;
interface Entry { level: number; appearance: Appearance }
interface Candidate { level: number; quality: PlanarReflectionQuality; surfaces: TerrainPuddleSurface[]; bounds: Box3 }

/** One scene owner for saved and draft Puddles. Stable visible groups borrow the
 * Lake/River registry, allocating at most two additional Puddle sources. */
export class PuddlePlanarReflections {
  private readonly entries = new Map<TerrainPuddleSurface, Entry>();
  private readonly sources = new Map<string, PlanarReflectionSource>();
  private ceiling: Ceiling = "high";
  private dirty = true;
  private lastSelection = -Infinity;
  private camera: Camera | null = null;
  private renderer: WebGLRenderer | null = null;
  private frame = -1;
  constructor(private readonly registry = new WaterReflectionRegistry()) {}

  set(surface: TerrainPuddleSurface, level: number, appearance: Appearance): void {
    this.entries.set(surface, { level, appearance: { ...appearance } });
    surface.setPlanarStrength(appearance.planarReflectionStrength ?? PUDDLE_APPEARANCE.planarReflectionStrength);
    surface.onBeforeRender = (renderer, scene, camera) => {
      if (scene.overrideMaterial || isPlanarReflectionCamera(camera)) return;
      this.update(renderer, scene, camera);
    };
    this.invalidate();
  }
  remove(surface: TerrainPuddleSurface): void {
    this.entries.delete(surface); surface.useReflectionSource(null); surface.onBeforeRender = () => {};
    this.invalidate();
  }
  setQuality(ceiling: Ceiling): void {
    if (this.ceiling === ceiling) return;
    this.ceiling = ceiling; this.invalidate();
  }
  private effective(entry: Entry): PlanarReflectionQuality | null {
    const a = { ...PUDDLE_APPEARANCE, ...entry.appearance };
    if (a.reflectionMode !== "sharedPlanar" || a.reflectionQuality === "low" || a.planarReflectionStrength <= 0 || this.ceiling === "off") return null;
    return a.reflectionQuality === "high" && this.ceiling === "high" ? "high" : "medium";
  }
  private key(entry: Entry, quality: PlanarReflectionQuality): string { return `${entry.level}:${quality}`; }
  /** Drop leases immediately on delete/hide/mode/quality edits, even without a render. */
  private invalidate(): void {
    this.dirty = true;
    const live = new Set([...this.entries.values()].flatMap(entry => {
      const quality = this.effective(entry); return quality ? [this.key(entry, quality)] : [];
    }));
    for (const [key, source] of this.sources) if (!live.has(key)) {
      for (const surface of this.entries.keys()) if (surface.reflectionSource === source) surface.useReflectionSource(null);
      this.registry.release(source); this.sources.delete(key);
    }
    for (const [surface, entry] of this.entries) {
      const quality = this.effective(entry);
      surface.useReflectionSource(quality ? this.sources.get(this.key(entry, quality)) ?? null : null);
    }
  }
  private select(camera: Camera): void {
    const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new Frustum().setFromProjectionMatrix(matrix, camera.coordinateSystem, camera.reversedDepth);
    const candidates = new Map<string, Candidate>();
    for (const [surface, entry] of this.entries) {
      const quality = this.effective(entry);
      if (!quality || !surface.visible || !surface.parent) continue;
      let visible = true;
      for (let parent = surface.parent; parent; parent = parent.parent!) if (!parent.visible) { visible = false; break; }
      if (!visible) continue;
      const bounds = new Box3().setFromObject(surface);
      if (bounds.isEmpty() || !frustum.intersectsBox(bounds)) continue;
      const key = this.key(entry, quality);
      let group = candidates.get(key);
      if (!group) { group = { level: entry.level, quality, surfaces: [], bounds: new Box3() }; candidates.set(key, group); }
      group.surfaces.push(surface); group.bounds.union(bounds);
    }
    const visible = [...candidates].filter(([key, group]) => {
      const coverage = planarReflectionScreenCoverage(group.bounds, matrix);
      // Hysteresis retains an existing group around the 1% capture gate.
      return coverage === null || coverage >= (this.sources.has(key) ? .0075 : .01);
    });
    visible.sort(([a], [b]) => Number(this.sources.has(b)) - Number(this.sources.has(a)) || a.localeCompare(b));
    const wanted = new Set(visible.map(([key]) => key));
    for (const [key, source] of this.sources) if (!wanted.has(key)) {
      for (const surface of this.entries.keys()) if (surface.reflectionSource === source) surface.useReflectionSource(null);
      this.registry.release(source); this.sources.delete(key);
    }
    for (const [key, group] of visible) if (!this.sources.has(key)) {
      const source = this.registry.acquireLimited("water", group.level, group.quality, "puddle", 2);
      if (source) this.sources.set(key, source);
    }
    for (const [surface, entry] of this.entries) {
      const quality = this.effective(entry), key = quality ? this.key(entry, quality) : "";
      surface.useReflectionSource(wanted.has(key) ? this.sources.get(key) ?? null : null);
    }
  }
  update(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    if (isPlanarReflectionCamera(camera) || scene.overrideMaterial) return;
    // Nested captures advance renderer.info.render.frame too. Remember its
    // post-capture value so later consumers in the same main render do no work.
    if (!this.dirty && this.renderer === renderer && this.camera === camera && renderer.info && this.frame === renderer.info.render.frame) return;
    const now = performance.now();
    if (this.dirty || this.camera !== camera || now - this.lastSelection >= 100) {
      this.select(camera); this.dirty = false; this.camera = camera; this.lastSelection = now;
    }
    for (const source of this.sources.values()) source.update(renderer, scene, camera);
    for (const surface of this.entries.keys()) surface.useReflectionSource(surface.reflectionSource);
    this.renderer = renderer; this.frame = renderer.info?.render.frame ?? -1;
  }
  dispose(): void {
    for (const surface of this.entries.keys()) { surface.useReflectionSource(null); surface.onBeforeRender = () => {}; }
    this.entries.clear();
    for (const source of this.sources.values()) this.registry.release(source);
    this.sources.clear(); this.dirty = true; this.camera = null; this.renderer = null; this.frame = -1;
  }
}
