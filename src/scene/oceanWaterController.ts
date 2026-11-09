import type { Camera, Object3D, Scene, WebGLRenderer } from "three";
import { validateOceanWaters, type OceanWaterBody } from "@engine/scene/oceanWater";
import { CooperativeWork } from "@engine/core/cooperativeWork";
import { prepareOceanTerrain } from "@engine/terrain/oceanPreparation";
import type { OceanCoverage } from "@engine/terrain/oceanCoverage";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";
import { OceanFft } from "@engine/render-three/ocean/oceanFft";
import { OceanSurface } from "@engine/render-three/ocean/oceanSurface";
import type { WaterEnvironmentProbes } from "@engine/render-three/waterEnvironment";

export interface OceanPresentation {
  object: Object3D;
  update(delta: number, camera: Camera): void;
  dispose(): void;
}
export interface OceanWaterHost {
  scene: Scene;
  renderer: WebGLRenderer;
  document(id: string): WorldTerrainDocument | undefined;
  load(id: string, key: string, signal?: AbortSignal): Promise<TerrainTileData>;
  changed?: () => void;
  environmentProbes?: WaterEnvironmentProbes;
  /** Host/diagnostic injection keeps lifecycle tests independent of a real GPU. */
  create?: (coverage: OceanCoverage) => OceanPresentation;
}
export interface OceanResult { status: "preparing" | "ready" | "error"; message: string }

/** Shared editor/runtime owner. Invalidating a source aborts preparation and
 * prevents stale results from replacing the previous valid presentation. */
export class OceanWaterController {
  readonly results = new Map<string, OceanResult>();
  private current: { id: string; signature: string; document: WorldTerrainDocument; visual: OceanPresentation } | null = null;
  private generation = 0;
  private aborter = new AbortController();
  private disposed = false;
  constructor(private readonly host: OceanWaterHost) {}
  get object(): Object3D | null { return this.current?.visual.object ?? null; }
  private releaseCurrent(): void {
    if (!this.current) return;
    this.current.visual.object.removeFromParent(); this.current.visual.dispose(); this.current = null;
  }
  async rebuild(values: readonly OceanWaterBody[], force = false): Promise<void> {
    if (this.disposed) return;
    const bodies = validateOceanWaters(values), source = bodies[0];
    const generation = ++this.generation; this.aborter.abort(); this.aborter = new AbortController();
    const signal = this.aborter.signal;
    if (!source) { this.releaseCurrent(); this.results.clear(); this.host.changed?.(); return; }
    const document = this.host.document(source.terrainRef), signature = JSON.stringify(source);
    if (this.current?.id === source.id) this.current.visual.object.visible = !source.hidden;
    if (!force && this.current?.signature === signature && this.current.document === document
      && this.results.get(source.id)?.status === "ready") {
      this.results.set(source.id, { status: "ready", message: source.hidden ? "Hidden" : "Ready" }); return;
    }
    if (this.current?.id !== source.id) { this.releaseCurrent(); this.results.clear(); }
    this.results.set(source.id, { status: "preparing", message: "Preparing Ocean…" }); this.host.changed?.();
    let next: OceanPresentation | undefined;
    try {
      if (!document) { this.releaseCurrent(); throw new Error("Ocean terrain is unavailable"); }
      const coverage = await prepareOceanTerrain(document, source, (key, readSignal) => this.host.load(source.terrainRef, key, readSignal),
        new CooperativeWork({ signal }), signal);
      if (signal.aborted || generation !== this.generation || this.host.document(source.terrainRef) !== document) return;
      if (coverage.status !== "ready") throw new Error("Ocean terrain is incomplete; previous surface preserved");
      next = this.host.create ? this.host.create(coverage) : this.create(coverage);
      if (signal.aborted || generation !== this.generation) { next.dispose(); next = undefined; return; }
      next.object.visible = !source.hidden;
      this.releaseCurrent(); this.host.scene.add(next.object);
      this.current = { id: source.id, signature, document, visual: next }; next = undefined;
      this.results.set(source.id, { status: "ready", message: source.hidden ? "Hidden" : "Ready" });
    } catch (error) {
      next?.dispose();
      if (!signal.aborted && generation === this.generation) this.results.set(source.id, { status: "error", message: String(error) });
    } finally { if (!signal.aborted && generation === this.generation) this.host.changed?.(); }
  }
  private create(coverage: OceanCoverage): OceanPresentation {
    const simulation = new OceanFft(this.host.renderer, coverage.body);
    try {
      simulation.update(0); const surface = new OceanSurface(coverage, simulation, this.host.environmentProbes);
      surface.userData.oceanWaterId = coverage.body.id;
      return { object: surface, update: (delta, camera) => { simulation.update(delta); surface.updateView(camera); },
        dispose: () => { surface.dispose(); simulation.dispose(); } };
    } catch (error) { simulation.dispose(); throw error; }
  }
  update(delta: number, camera: Camera): void {
    if (this.current?.visual.object.visible) this.current.visual.update(Number.isFinite(delta) ? Math.max(0, Math.min(.25, delta)) : 0, camera);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; ++this.generation; this.aborter.abort();
    this.releaseCurrent(); this.results.clear();
  }
}
