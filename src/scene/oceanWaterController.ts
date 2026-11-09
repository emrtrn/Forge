import type { Camera, Object3D, Scene, WebGLRenderer } from "three";
import { validateOceanWaters, type OceanReflectionCeiling, type OceanWaterBody } from "@engine/scene/oceanWater";
import { CooperativeWork } from "@engine/core/cooperativeWork";
import { prepareOceanTerrain } from "@engine/terrain/oceanPreparation";
import type { OceanCoverage, OceanInlet } from "@engine/terrain/oceanCoverage";
import { oceanInletRiverInputs, resolveOceanInlets } from "@engine/terrain/oceanInlets";
import type { LayoutRiverWater } from "@engine/scene/layout";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";
import { OceanFft } from "@engine/render-three/ocean/oceanFft";
import { OceanSurface } from "@engine/render-three/ocean/oceanSurface";
import type { WaterEnvironmentProbes } from "@engine/render-three/waterEnvironment";
import { WaterReflectionRegistry } from "@engine/render-three/waterReflectionRegistry";
import { OceanCausticsBinding } from "@engine/render-three/ocean/oceanCaustics";
import { OceanReflectionLease } from "@engine/render-three/ocean/oceanReflection";
import { prepareOceanGrid, oceanGridLevels } from "@engine/render-three/ocean/oceanGrid";
import { uploadOceanCoverage } from "@engine/render-three/ocean/oceanCoverageTexture";
import { oceanCoverageLayout } from "@engine/terrain/oceanCoverageStorage";

export interface OceanPresentation {
  object: Object3D;
  update(delta: number, camera: Camera): void;
  dispose(): void;
  applyAppearance?(body: OceanWaterBody, ceiling: OceanReflectionCeiling, causticsAllowed: boolean): void;
  applyInlets?(inlets: readonly OceanInlet[]): void;
  /** Registry publication is synchronous, after all staging awaits. */
  activate?(replacing?: Object3D): void;
}
export interface OceanWaterHost {
  scene: Scene;
  renderer: WebGLRenderer;
  camera?: () => Camera;
  document(id: string): WorldTerrainDocument | undefined;
  rivers?: () => readonly LayoutRiverWater[];
  load(id: string, key: string, signal?: AbortSignal): Promise<TerrainTileData>;
  changed?: () => void;
  environmentProbes?: WaterEnvironmentProbes;
  reflections?: WaterReflectionRegistry;
  reflectionQuality?: OceanReflectionCeiling;
  causticsAllowed?: boolean;
  /** Host/diagnostic injection keeps lifecycle tests independent of a real GPU. */
  create?: (coverage: OceanCoverage) => OceanPresentation | Promise<OceanPresentation>;
}
export interface OceanResult { status: "preparing" | "ready" | "error"; message: string }

/** Shared editor/runtime owner. Invalidating a source aborts preparation and
 * prevents stale results from replacing the previous valid presentation. */
export class OceanWaterController {
  readonly results = new Map<string, OceanResult>();
  private current: { id: string; source: OceanWaterBody; signature: string; preparation: string; inletSignature: string;
    revision: number; document: WorldTerrainDocument; visual: OceanPresentation } | null = null;
  private generation = 0;
  private terrainRevision = 0;
  private values: OceanWaterBody[] = [];
  private contextLost = false;
  private readonly handleContextLost = () => {
    this.contextLost = true; ++this.generation; this.aborter.abort(); this.releaseCurrent();
    for (const source of this.values) this.results.set(source.id, { status: "preparing", message: "Preparing Ocean…" });
    this.host.changed?.();
  };
  private readonly handleContextRestored = () => {
    this.contextLost = false;
    if (!this.disposed) void this.rebuild(this.values, true);
  };
  private aborter = new AbortController();
  private disposed = false;
  private readonly reflections: WaterReflectionRegistry;
  private reflectionQuality: OceanReflectionCeiling;
  private causticsAllowed: boolean;
  constructor(private readonly host: OceanWaterHost) {
    this.causticsAllowed = host.causticsAllowed ?? true;
    this.reflections = host.reflections ?? new WaterReflectionRegistry();
    this.reflectionQuality = host.reflectionQuality ?? "high";
    host.renderer.domElement?.addEventListener("webglcontextlost", this.handleContextLost);
    host.renderer.domElement?.addEventListener("webglcontextrestored", this.handleContextRestored);
  }
  setReflectionQuality(quality: OceanReflectionCeiling): void {
    this.reflectionQuality = quality;
    if (this.current) this.current.visual.applyAppearance?.(this.current.source, quality, this.causticsAllowed);
  }
  setCausticsAllowed(allowed: boolean): void {
    this.causticsAllowed = allowed;
    if (this.current) this.current.visual.applyAppearance?.(this.current.source, this.reflectionQuality, allowed);
  }
  get object(): Object3D | null { return this.current?.visual.object ?? null; }
  private releaseCurrent(): void {
    if (!this.current) return;
    this.current.visual.object.removeFromParent(); this.current.visual.dispose(); this.current = null;
  }
  async rebuild(values: readonly OceanWaterBody[], force = false): Promise<void> {
    if (this.disposed) return;
    const bodies = validateOceanWaters(values), source = bodies[0];
    this.values = bodies;
    if (force) this.terrainRevision++;
    const revision = this.terrainRevision;
    const generation = ++this.generation; this.aborter.abort(); this.aborter = new AbortController();
    const signal = this.aborter.signal;
    if (!source) { this.releaseCurrent(); this.results.clear(); this.host.changed?.(); return; }
    if (this.contextLost) { this.results.set(source.id, { status: "preparing", message: "Preparing Ocean…" }); return; }
    const document = this.host.document(source.terrainRef);
    const rivers = oceanInletRiverInputs(source, this.host.rivers?.());
    const inletSignature = JSON.stringify(rivers ?? null);
    const signature = JSON.stringify([source, inletSignature]);
    const { appearance: _appearance, caustics: _caustics, name: _name, hidden: _hidden, locked: _locked, ...geometrySource } = source;
    const preparation = JSON.stringify(geometrySource);
    if (this.current?.id === source.id) {
      this.current.visual.object.visible = !source.hidden;
      // Hide/release captures immediately, even if the next terrain preparation fails.
      this.current.source = { ...this.current.source, hidden: source.hidden ?? false };
      this.current.visual.applyAppearance?.(this.current.source, this.reflectionQuality, this.causticsAllowed);
      // A width edit may update the visible old mask while a terrain revision
      // is rebuilding. It must never acknowledge that dirty revision as Ready.
      if (document && this.current.document === document && this.current.preparation === preparation
        && this.current.revision !== revision && this.current.visual.applyInlets) {
        try { this.current.visual.applyInlets(resolveOceanInlets(document.def, source, rivers)); }
        catch (error) { this.results.set(source.id, { status: "error", message: String(error) }); this.host.changed?.(); return; }
      }
    }
    if (!force && this.current?.revision === revision && this.current.signature === signature && this.current.document === document
      && this.results.get(source.id)?.status === "ready") {
      this.results.set(source.id, { status: "ready", message: source.hidden ? "Hidden" : "Ready" }); return;
    }
    if (!force && document && this.current?.revision === revision && this.current.preparation === preparation && this.current.document === document
      && this.current.visual.applyAppearance && this.results.get(source.id)?.status === "ready"
      && (this.current.inletSignature === inletSignature || this.current.visual.applyInlets)) {
      try {
        if (this.current.inletSignature !== inletSignature) this.current.visual.applyInlets!(resolveOceanInlets(document.def, source, rivers));
        this.current.visual.applyAppearance(source, this.reflectionQuality, this.causticsAllowed);
        this.current.source = source; this.current.signature = signature; this.current.inletSignature = inletSignature;
        this.results.set(source.id, { status: "ready", message: source.hidden ? "Hidden" : "Ready" });
      } catch (error) { this.results.set(source.id, { status: "error", message: String(error) }); }
      this.host.changed?.(); return;
    }
    if (this.current?.id !== source.id) { this.releaseCurrent(); this.results.clear(); }
    this.results.set(source.id, { status: "preparing", message: "Preparing Ocean…" }); this.host.changed?.();
    let next: OceanPresentation | undefined;
    try {
      if (!document) { this.releaseCurrent(); throw new Error("Ocean terrain is unavailable"); }
      if (!this.host.create) {
        const layout = oceanCoverageLayout(document.def.tilesX * document.def.tileQuads, document.def.tilesZ * document.def.tileQuads);
        if (Math.max(layout.width, layout.height) > this.host.renderer.capabilities.maxTextureSize)
          throw new Error("over-budget: Ocean atlas exceeds GPU texture dimensions");
      }
      const work = new CooperativeWork({ signal });
      const coverage = await prepareOceanTerrain(document, source, (key, readSignal) => this.host.load(source.terrainRef, key, readSignal),
        work, signal, rivers);
      if (signal.aborted || generation !== this.generation || this.host.document(source.terrainRef) !== document) return;
      if (coverage.status !== "ready") throw new Error("Ocean terrain is incomplete; previous surface preserved");
      next = await (this.host.create ? this.host.create(coverage) : this.create(coverage, work));
      if (signal.aborted || generation !== this.generation || this.host.document(source.terrainRef) !== document) { next.dispose(); next = undefined; return; }
      next.activate?.(this.current?.visual.object);
      next.object.visible = !source.hidden;
      this.releaseCurrent(); this.host.scene.add(next.object);
      this.current = { id: source.id, source, signature, preparation, inletSignature, revision, document, visual: next }; next = undefined;
      this.results.set(source.id, { status: "ready", message: source.hidden ? "Hidden" : "Ready" });
    } catch (error) {
      next?.dispose();
      if (!signal.aborted && generation === this.generation) this.results.set(source.id, { status: "error", message: String(error) });
    } finally { if (!signal.aborted && generation === this.generation) this.host.changed?.(); }
  }
  private async create(coverage: OceanCoverage, work: CooperativeWork): Promise<OceanPresentation> {
    const grid = await prepareOceanGrid(work, 64, oceanGridLevels(coverage.body));
    let simulation: OceanFft | undefined;
    let surface: OceanSurface | undefined, lease: OceanReflectionLease | undefined, caustics: OceanCausticsBinding | undefined;
    try {
      work.check(); simulation = new OceanFft(this.host.renderer, coverage.body);
      const waves = simulation;
      waves.update(0); surface = new OceanSurface(coverage, waves, this.host.environmentProbes, grid);
      const object = surface;
      await uploadOceanCoverage(this.host.renderer, surface.coverageTexture, work);
      if (this.host.camera) await surface.warmup(this.host.renderer, this.host.camera(), this.host.scene);
      work.check();
      lease = new OceanReflectionLease(object, this.reflections);
      const reflections = lease;
      caustics = new OceanCausticsBinding(this.host.scene, coverage, surface.coverageTexture, surface, () => waves.stats.time);
      const seabed = caustics;
      surface.userData.oceanWaterId = coverage.body.id;
      return { object, activate: replacing => { reflections.update(coverage.body, this.reflectionQuality); seabed.update(coverage.body, this.causticsAllowed, replacing); },
        update: (delta, camera) => { waves.update(delta); object.updateView(camera); },
        applyInlets: inlets => { object.applyInlets(inlets); },
        applyAppearance: (body, quality, allowed) => { seabed.update(body, allowed); reflections.update(body, quality); object.applyAppearance(body); },
        dispose: () => { seabed.dispose(); reflections.dispose(); object.dispose(); waves.dispose(); } };
    } catch (error) { caustics?.dispose(); lease?.dispose(); if (surface) surface.dispose(); else grid.dispose(); simulation?.dispose(); throw error; }
  }
  update(delta: number, camera: Camera): void {
    if (this.current?.visual.object.visible) this.current.visual.update(Number.isFinite(delta) ? Math.max(0, Math.min(.25, delta)) : 0, camera);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; ++this.generation; this.aborter.abort();
    this.releaseCurrent(); this.results.clear();
    this.values = [];
    this.host.renderer.domElement?.removeEventListener("webglcontextlost", this.handleContextLost);
    this.host.renderer.domElement?.removeEventListener("webglcontextrestored", this.handleContextRestored);
  }
}
