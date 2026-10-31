import { WaterWheelFoamState } from "@engine/terrain/waterWheelInteraction";
import type { RiverWaterObjectLike } from "@engine/render-three/riverWater";
import { LakeFoamStore } from "./lakeFoamStore";
import { registerLakeShoreWetness, terrainShoreWetnessAt, prepareLakeShoreMask, assertLakeShoreCapacity } from "@engine/render-three/terrain/terrainShoreWetness";
import { LakeSurfaceQuery, LakeRippleState, lakeWheelContact, type LakeWheelContact } from "@engine/terrain/lakeInteraction";
import { vehicleWheelWidth } from "@engine/physics/surface/sinkage";
import type { VehicleHost, WetTrailSource } from "./capabilities/runtimeServiceKeys";
import { Group, BufferGeometry, Float32BufferAttribute, LineSegments, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry, type Texture, type Scene, type DataTexture } from "three";
import type { LayoutLakeWaterBody } from "@engine/scene/layout";
import { LAKE_LIMITS, resolveLakeAppearance } from "@engine/scene/waterBody";
import { buildLakeGeometry, emptyLake, lakeGrid, prepareLakeSnapshot, type LakeGeometry } from "@engine/terrain/terrainLakeWater";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";
import { LakeWaterObject } from "@engine/render-three/lakeWater";
import { PlanarReflectionSource } from "@engine/render-three/planarReflectionSource";
import type { WaterReflectionRegistry } from "@engine/render-three/waterReflectionRegistry";
import { registerLakeCaustics, assertLakeCausticsCapacity } from "@engine/render-three/terrain/terrainCaustics";
import { FULL_LAKE_QUALITY, qualityLake, type LakeQuality } from "@engine/perf/lakeQuality";
import type { LakeFoamData } from "@engine/scene/lakeFoamBake";
import { CooperativeWork, type WorkSlice } from "@engine/core/cooperativeWork";
import { prepareLakePresentation } from "@engine/render-three/lakePreparation";
import { createLakeFoamMaskAsync } from "@engine/render-three/waterFoam";

/** Lake water (m) over a contact that soaks a tyre; thinner films at the very shore do not. */
const SOAKING_DEPTH = 0.02;
/** Wet-shore wetness that keeps a tyre soaked, so its print starts where the shore stops looking wet. */
const SOAKING_SHORE_WETNESS = 0.25;

export interface LakeWaterContext {
  scene: Scene;
  editor: boolean;
  reflections?: WaterReflectionRegistry;
  quality?: LakeQuality;
  document: (terrainRef: string) => WorldTerrainDocument | undefined;
  load: (terrainRef: string, key: string, signal?: AbortSignal) => Promise<TerrainTileData>;
  normal: (id: string) => Promise<Texture | null>;
  changed?: () => void;
  /** Optional load-time QA instrumentation; no per-frame collection. */
  onWorkSlice?: ((slice: WorkSlice) => void) | undefined;
  rivers?: () => readonly RiverWaterObjectLike[];
  vehicles?: Pick<VehicleHost, "vehicleIds" | "vehicleState" | "vehicleDefinition" | "onPhysicsStep" | "isSurfaceFxActive"> | undefined;
}

interface LakePresentation {
  source: LayoutLakeWaterBody;
  effective: LayoutLakeWaterBody;
  object: LakeWaterObject;
  geometry: LakeGeometry;
  shore: () => void;
  caustics: () => void;
}
function foamAllocation(data: LakeFoamData): number {
  const { nx, nz } = data.metadata, w = Math.min(1024, nx), h = Math.min(1024, nz);
  return w * h * Math.ceil(nx / w) * Math.ceil(nz / h);
}

/** One serialized CPU job and at most four temporary reads, with per-body publication. */
export class LakeWaterController {
  readonly foam = new LakeFoamStore();
  readonly foamErrors = new Map<string,string>();
  readonly qualityErrors = new Map<string, string>();
  readonly results = new Map<string, LakeGeometry>();
  readonly objects = new Map<string, LakeWaterObject>();
  readonly helpers = new Group();
  private aborter = new AbortController();
  private generation = 0;
  private chain: Promise<void> = Promise.resolve();
  private reflection = new Map<string, PlanarReflectionSource>();
  private selected: string | null = null;
  private interactions = new Map<string, { lake: LayoutLakeWaterBody; query: LakeSurfaceQuery; state: LakeRippleState; foam: WaterWheelFoamState }>();
  private unsubscribePhysics: (() => void) | null = null;
  private waveTime = 0;
  private quality: LakeQuality;
  private qualityAborter = new AbortController();
  private readonly presentations = new Map<string, LakePresentation>();
  constructor(private readonly context: LakeWaterContext) {
    this.quality = { ...(context.quality ?? FULL_LAKE_QUALITY) };
    context.scene.add(this.helpers); this.helpers.layers.set(31);
  }
  /** Serialized with geometry publications; changing a profile never calls the geometry builder. */
  setQuality(quality: LakeQuality): Promise<void> {
    if ((Object.keys(FULL_LAKE_QUALITY) as (keyof LakeQuality)[]).every(key => quality[key] === this.quality[key])) return this.chain;
    this.quality = { ...quality };
    this.qualityAborter.abort(); this.qualityAborter = new AbortController();
    const signal = AbortSignal.any([this.aborter.signal, this.qualityAborter.signal]);
    if (!quality.foamAllowed) { this.foam.clearLoaded(); this.foamErrors.clear(); }
    const work = async () => {
      if (signal.aborted) return;
      const scheduler = new CooperativeWork({ signal, onSlice: this.context.onWorkSlice });
      for (const [id, p] of this.presentations) {
        if (signal.aborted) return;
        const geometry = p.geometry;
        if (!p.object.parent) continue;
        let bakedFoam;
        if (quality.foamAllowed && p.source.geometryFoam?.enabled && p.source.geometryFoam.bake && !p.object.material.uniforms.geometryFoamMask!.value) {
          const used = [...this.objects].reduce((sum, [other, object]) => sum + (other === id ? 0 : object.material.uniforms.geometryFoamMask!.value?.image?.data?.byteLength ?? 0), 0);
          bakedFoam = await this.readFoam(p.source, signal, 32 * 1024 ** 2 - used);
        }
        if (signal.aborted || this.presentations.get(id) !== p) return;
        const effective = qualityLake(p.source, quality), old = resolveLakeAppearance(p.effective), next = resolveLakeAppearance(effective);
        let shore: (() => void) | undefined, caustics: (() => void) | undefined;
        let foamMask: DataTexture | null = null, shoreMask: DataTexture | null = null;
        try {
          // Stage new masks first; a rejected visual budget leaves the current surface intact.
          if (next.foamEnabled && !p.object.material.uniforms.foamMask!.value) foamMask = await createLakeFoamMaskAsync(effective, geometry, next.foamWidth, scheduler);
          if (next.shoreWetnessEnabled && !old.shoreWetnessEnabled) shoreMask = await prepareLakeShoreMask(effective, geometry, scheduler);
          scheduler.check();
          if (next.shoreWetnessEnabled && !old.shoreWetnessEnabled) {
            shore = registerLakeShoreWetness(this.context.scene, effective, geometry, p.object, shoreMask); shoreMask = null;
          }
          if (next.causticsEnabled && !old.causticsEnabled) caustics = registerLakeCaustics(this.context.scene, effective, geometry, p.object);
          p.object.applyQuality(quality, this.reflectionFor(effective), bakedFoam, foamMask); foamMask = null;
          if (!next.shoreWetnessEnabled) { p.shore(); p.shore = () => {}; }
          else if (shore) p.shore = shore;
          if (!next.causticsEnabled) { p.caustics(); p.caustics = () => {}; }
          else if (caustics) p.caustics = caustics;
          p.effective = effective;
          const interaction = this.interactions.get(id);
          interaction?.state.setLimit(quality.maxRipples);
          interaction?.foam.setLimit(quality.maxRipples);
          if (!quality.foamAllowed) interaction?.foam.clear();
          p.object.setWheelFoam(interaction?.foam.puffs ?? []);
          p.object.setWheelRipples(interaction?.state.ripples ?? []);
          this.qualityErrors.delete(id);
        } catch (error) {
          shore?.(); caustics?.();
          if (!signal.aborted) { this.qualityErrors.set(id, String(error)); console.warn("[lake-quality]", id, error); }
        } finally { foamMask?.dispose(); shoreMask?.dispose(); }
        // Mask creation/upload is presentation work; do not batch eight bodies into one job.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      this.pruneReflections(); this.context.changed?.();
    };
    this.chain = this.chain.then(work, work); return this.chain;
  }
  private async readFoam(lake: LayoutLakeWaterBody, signal: AbortSignal, budget: number): Promise<LakeFoamData | undefined> {
    if (!lake.geometryFoam?.bake) return undefined;
    this.foamErrors.delete(lake.id);
    try {
      const data = await this.foam.read(lake.geometryFoam.bake.manifest, signal);
      if (signal.aborted) return undefined;
      if (data.metadata.fingerprint !== lake.geometryFoam.bake.fingerprint) throw new Error("Lake foam reference fingerprint mismatch");
      if (foamAllocation(data) > budget) throw new Error("over-budget: total Lake foam textures exceed 32 MiB");
      return data;
    } catch (error) {
      if (!signal.aborted) { this.foamErrors.set(lake.id, String(error)); console.warn("[lake-foam]", lake.id, error); }
      return undefined;
    }
  }
  private reflectionFor(lake: LayoutLakeWaterBody): PlanarReflectionSource | null {
    const a = resolveLakeAppearance(lake);
    if (lake.hidden || a.reflectionMode !== "sharedPlanar" || a.reflectionQuality === "low") return null;
    const key = `${a.reflectionGroup}:${lake.surfaceLevel}:${a.reflectionQuality}`;
    let source = this.reflection.get(key);
    if (!source) {
      source = this.context.reflections?.acquire(a.reflectionGroup, lake.surfaceLevel, a.reflectionQuality) ?? new PlanarReflectionSource(lake.surfaceLevel, a.reflectionQuality);
      this.reflection.set(key, source);
    }
    return source;
  }
  private pruneReflections(): void {
    for (const [key, source] of this.reflection) {
      if (![...this.objects.values()].some(object => object.reflectionSource === source)) { this.release(source); this.reflection.delete(key); }
    }
  }
  private releasePresentation(id: string, object: LakeWaterObject): void {
    const p = this.presentations.get(id);
    if (p?.object !== object) return;
    p.shore(); p.caustics(); this.presentations.delete(id);
  }
  select(id: string | null) { this.selected = id; for (const child of this.helpers.children) child.visible = child.userData.waterBodyId === id; }
  invalidate() { this.aborter.abort(); this.results.clear(); this.clearInteractions(); }
  private clearInteractions(): void {
    this.interactions.clear();
    for (const object of this.objects.values()) { object.setWheelRipples([]); object.setWheelFoam([]); }
    for (const river of this.context.rivers?.() ?? []) river.clearWheelInteractions();
  }
  /**
   * The visible Lake whose connected water or visibly wet shore soaks a tyre
   * at a world point, with its wet trail settings (the deepest one), or null.
   */
  wetTrailSourceAt(x: number, y: number, z: number): WetTrailSource | null {
    let best: WetTrailSource | null = null;
    for (const [id, interaction] of this.interactions) {
      const object = this.objects.get(id);
      let visible = !!object?.visible;
      for (let p = object?.parent; p; p = p.parent) visible &&= p.visible;
      if (!object || !visible) continue;
      const depth = interaction.query.depthAt(x, z) === null ? 0 : Math.max(0, object.position.y - y);
      if (depth <= SOAKING_DEPTH && terrainShoreWetnessAt(this.context.scene, x, y, z, undefined, id) < SOAKING_SHORE_WETNESS) continue;
      const a = resolveLakeAppearance(interaction.lake);
      if (best && best.depth >= depth) continue;
      best = { depth, length: a.wheelWetTrailLength, strength: a.wheelWetTrailEnabled ? a.wheelWetTrailStrength : 0,
        drySeconds: a.wheelWetTrailDrySeconds };
    }
    return best;
  }
  /** Called once per fixed physics slice; also usable by isolated QA fixtures. */
  advanceWheelInteractions(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.waveTime += dt;
    for (const object of this.objects.values()) object.setSurfaceWaveTime(this.waveTime);
    const host = this.context.vehicles;
    if (!host) return;
    const vehicles = host.vehicleIds().filter(id => host.isSurfaceFxActive?.(id) !== false)
      .map(id => ({ id, state: host.vehicleState(id), definition: host.vehicleDefinition(id) }));
    for (const river of this.context.rivers?.() ?? []) river.advanceWheelInteractions(dt, vehicles);
    for (const [id, interaction] of this.interactions) {
      const object = this.objects.get(id);
      let visible = !!object;
      for (let p = object?.parent; p; p = p.parent) visible &&= p.visible;
      if (!object || !object.visible || !visible) { interaction.state.clear(); interaction.foam.clear(); object?.setWheelRipples([]); object?.setWheelFoam([]); continue; }
      const contacts: LakeWheelContact[] = [];
      for (const vehicle of vehicles) vehicle.state?.wheels.forEach((wheel, i) => {
        const contact = lakeWheelContact(`${vehicle.id}:${i}`, wheel,
          vehicleWheelWidth(vehicle.definition?.wheels[i] ?? wheel), object.position.y, interaction.query,
          { time: this.waveTime, parameters: object.waveParameters });
        if (contact) contacts.push(contact);
      });
      interaction.state.advance(dt, contacts);
      object.setWheelRipples(interaction.state.ripples);
      if (this.quality.foamAllowed) interaction.foam.advance(dt, contacts); else interaction.foam.clear();
      object.setWheelFoam(interaction.foam.puffs);
    }
  }
  rebuild(bodies: readonly LayoutLakeWaterBody[]): Promise<void> {
    if (this.qualityAborter.signal.aborted) this.qualityAborter = new AbortController();
    this.clearInteractions();
    if (!this.context.editor && !this.unsubscribePhysics) this.unsubscribePhysics = this.context.vehicles?.onPhysicsStep?.(dt => this.advanceWheelInteractions(dt)) ?? null;
    this.aborter.abort(); this.aborter = new AbortController(); const signal = this.aborter.signal, generation = ++this.generation;
    const sources = structuredClone([...bodies]);
    const work = async () => {
      if (signal.aborted) return;
      const scheduler = new CooperativeWork({ signal, onSlice: this.context.onWorkSlice });
      const ids = new Set(sources.map((w) => w.id));
      for (const id of this.objects.keys()) if (!ids.has(id)) this.remove(id);
      for (const id of this.results.keys()) if (!ids.has(id)) { this.remove(id); this.results.delete(id); }
      let total = 0, bytes = 0, foamBytes = 0;
      for (const lake of sources.sort((a, b) => a.id.localeCompare(b.id))) {
        if (signal.aborted) return;
        let result: LakeGeometry;
        try {
          const document = this.context.document(lake.terrainRef);
          if (!document) throw new Error("Lake requires a World Terrain reference");
          const grid = lakeGrid(document.def, lake); total += grid.nx * grid.nz;
          if (sources.length > LAKE_LIMITS.bodies || total > LAKE_LIMITS.totalCells) throw new Error("over-budget: total Lake area exceeds limit");
          const snapshot = await prepareLakeSnapshot(document, lake, (key, s) => this.context.load(lake.terrainRef, key, s), signal);
          result = await buildLakeGeometry(snapshot, signal, undefined, scheduler);
          bytes += result.bytes;
          if (bytes * 2 > 32 * 1024 ** 2) throw new Error("over-budget: Lake replacement buffers exceed 32 MiB");
        } catch (error) {
          if (signal.aborted) return;
          const message = error instanceof Error ? error.message : String(error);
          result = emptyLake(lake, message.includes("over-budget") ? "over-budget" : /tile|HTTP|binary|data/i.test(message) ? "missing-data" : "invalid", message);
        }
        let normal: Texture | null = null;
        if (result.status === "ready") normal = await this.context.normal(resolveLakeAppearance(lake).normalTexture);
        if (signal.aborted || generation !== this.generation) return;
        let bakedFoam: LakeFoamData | undefined;
        this.foamErrors.delete(lake.id);
        if(signal.aborted || generation!==this.generation)return;
        if (result.status === "ready") {
          const a = resolveLakeAppearance(lake);
          let effective = qualityLake(lake, this.quality);
          let staged: Awaited<ReturnType<typeof prepareLakePresentation>> | undefined;
          let object: LakeWaterObject | undefined;
          let published = false;
          try {
            // Quality changes invalidate only presentation staging. Geometry is
            // immutable and can be reused; no obsolete mask can be published.
            for (;;) {
              const quality = this.quality;
              effective = qualityLake(lake, quality);
              const visualSignal = AbortSignal.any([signal, this.qualityAborter.signal]);
              try {
                if (quality.foamAllowed && !bakedFoam && lake.geometryFoam?.enabled && lake.geometryFoam.bake) {
                  bakedFoam = await this.readFoam(lake, visualSignal, 32 * 1024 ** 2 - foamBytes);
                  if (bakedFoam) foamBytes += foamAllocation(bakedFoam);
                }
                staged = await prepareLakePresentation(effective, result, new CooperativeWork({ signal: visualSignal, onSlice: this.context.onWorkSlice }));
                break;
              } catch (error) { if (signal.aborted || !visualSignal.aborted) throw error; }
            }
            scheduler.check();
            const previous = this.objects.get(lake.id), appearance = resolveLakeAppearance(effective);
            if (appearance.shoreWetnessEnabled) assertLakeShoreCapacity(this.context.scene, previous);
            if (appearance.causticsEnabled) assertLakeCausticsCapacity(this.context.scene, previous);
            object = new LakeWaterObject(lake, result, normal, this.reflectionFor(effective), bakedFoam, this.quality, staged);
            // All fallible CPU preparation/limits precede the synchronous swap.
            this.remove(lake.id); this.results.set(lake.id, result);
            const shore = registerLakeShoreWetness(this.context.scene, effective, result, object, staged.shore); staged.shore = null;
            const caustics = registerLakeCaustics(this.context.scene, effective, result, object);
            this.presentations.set(lake.id, { source: lake, effective, object, geometry: result, shore, caustics });
            const owner = object;
            object.addEventListener("removed", () => this.releasePresentation(lake.id, owner));
            object.visible = !lake.hidden;
            if (!this.context.editor && this.unsubscribePhysics) object.setSurfaceWaveTime(this.waveTime);
            if (!this.context.editor) object.raycast = () => {};
            this.objects.set(lake.id, object); this.context.scene.add(object);
            const state = new LakeRippleState(a); state.setLimit(this.quality.maxRipples);
            const foam = new WaterWheelFoamState(); foam.setLimit(this.quality.maxRipples);
            this.interactions.set(lake.id, { lake, query: staged.query, state, foam });
            this.qualityErrors.delete(lake.id); published = true;
          }
          catch (error) {
            if (signal.aborted) return;
            const message = error instanceof Error ? error.message : String(error);
            result = emptyLake(lake, message.includes("over-budget") ? "over-budget" : "invalid", message);
            this.results.set(lake.id, result);
            // A rejected replacement retains the previous published surface.
            this.qualityErrors.set(lake.id, message);
            this.removeHelpers(lake.id);
            if (this.context.editor) this.addHelper(lake, result);
            this.context.changed?.();
            continue;
          } finally {
            if (!published) {
              object?.dispose();
              if (!object) { staged?.geometry.dispose(); staged?.foam?.dispose(); }
              staged?.shore?.dispose();
              this.pruneReflections();
            }
          }
        } else {
          this.remove(lake.id); this.results.set(lake.id, result);
        }
        if (this.context.editor) this.addHelper(lake, result);
        this.context.changed?.();
      }
      this.pruneReflections();
    };
    this.chain = this.chain.then(work, work); return this.chain;
  }
  private addHelper(lake: LayoutLakeWaterBody, result: LakeGeometry) {
    const root = new Group(); root.userData.waterBodyId = lake.id; root.position.set(...result.position); root.layers.set(31);
    const b = lake.bounds, x = result.position[0], z = result.position[2];
    const points = [[b.min[0] - x, b.min[1] - z], [b.max[0] - x, b.min[1] - z], [b.max[0] - x, b.max[1] - z], [b.min[0] - x, b.max[1] - z]];
    const positions: number[] = [];
    for (let i = 0; i < 4; i++) for (const p of [points[i]!, points[(i + 1) % 4]!]) positions.push(p[0]!, 0.04, p[1]!);
    for (let i = 0; i < result.cuts.length; i += 2) positions.push(result.cuts[i]!, 0.05, result.cuts[i + 1]!);
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const line = new LineSegments(geometry, new LineBasicMaterial({ color: result.status === "ready" ? 0x4bd7ff : 0xff5555, depthTest: false }));
    line.layers.set(31); line.raycast = () => {}; root.add(line);
    const marker = new Mesh(new SphereGeometry(0.7, 10, 6), new MeshBasicMaterial({ color: 0xffd23f, depthTest: false }));
    marker.position.set(lake.seed[0] - x, 0.1, lake.seed[1] - z); marker.userData.waterBodyId = lake.id; marker.layers.set(31); root.add(marker);
    if (!lake.locked) for (let edge = 0; edge < 4; edge++) {
      const handle = new Mesh(new SphereGeometry(0.8, 10, 6), new MeshBasicMaterial({ color: 0x4bd7ff, depthTest: false }));
      const axis = edge % 2, value = (edge < 2 ? b.min : b.max)[axis]!;
      handle.position.set(axis === 0 ? value - x : 0, 0.1, axis === 1 ? value - z : 0);
      handle.userData.waterBodyId = lake.id; handle.userData.lakeEdge = edge; handle.layers.set(31); root.add(handle);
    }
    root.visible = lake.id === this.selected; this.helpers.add(root);
  }
  private remove(id: string) {
    this.interactions.delete(id);
    this.qualityErrors.delete(id);
    const object = this.objects.get(id); if (object) { object.removeFromParent(); object.dispose(); this.objects.delete(id); }
    this.removeHelpers(id);
  }
  private removeHelpers(id: string): void {
    for (const child of [...this.helpers.children]) if (child.userData.waterBodyId === id) {
      child.removeFromParent(); child.traverse((o) => { if (o instanceof Mesh || o instanceof LineSegments) { o.geometry.dispose(); o.material.dispose(); } });
    }
  }
  private release(source: PlanarReflectionSource) { if (this.context.reflections) this.context.reflections.release(source); else source.dispose(); }
  dispose() { this.qualityAborter.abort(); this.foam.clear(); this.foamErrors.clear(); this.qualityErrors.clear(); this.unsubscribePhysics?.(); this.unsubscribePhysics = null; this.waveTime = 0; this.clearInteractions(); this.aborter.abort(); ++this.generation; for (const id of this.objects.keys()) this.remove(id);
    for (const child of [...this.helpers.children]) this.remove(child.userData.waterBodyId as string);
    this.results.clear(); for (const source of this.reflection.values()) this.release(source); this.reflection.clear(); }
}
