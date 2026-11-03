import type { Scene, Texture } from "three";
import type { ResolvedWind } from "@engine/environment/wind";
import { TerrainPuddleSurface } from "@engine/render-three/terrain/terrainPuddleSurface";
import { PUDDLE_APPEARANCE, PUDDLE_LIMITS, resolvePuddleWheelRipples, validatePuddleWaters, type PuddleWaterBody } from "@engine/scene/puddleWater";
import { LakeRippleState, type LakeRipple, type LakeWheelContact } from "@engine/terrain/lakeInteraction";
import { PUDDLE_MAX_RIPPLES, PUDDLE_TOTAL_RIPPLES, PUDDLE_MAX_RIPPLE_SHORE_SEGMENTS, puddleRippleStops, puddleWheelContact } from "@engine/terrain/puddleInteraction";
import { vehicleWheelWidth } from "@engine/physics/surface/sinkage";
import type { VehicleHost } from "./capabilities/runtimeServiceKeys";
import { preparePuddleBed } from "@engine/terrain/terrainPuddlePreparation";
import { terrainPuddleSteps, samplePuddleWater, type TerrainPuddleGeometry } from "@engine/terrain/terrainPuddle";
import { CooperativeWork, type WorkSlice } from "@engine/core/cooperativeWork";
import { sharedTerrainDeformation, type TerrainDeformationTexture, type TerrainRenderedBed } from "@engine/render-three/terrain/terrainDeformation";
import { setPuddleTerrainCoverage, clearPuddleTerrainCoverage } from "@engine/render-three/terrain/terrainPuddleCoverage";
import { terrainTrackDetailStats } from "@engine/render-three/terrain/terrainRenderer";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";
import { PuddlePlanarReflections } from "@engine/render-three/puddlePlanarReflections";

interface PuddleHost {
  scene: Scene;
  document(id: string): WorldTerrainDocument | undefined;
  load(id: string, key: string, signal: AbortSignal): Promise<TerrainTileData>;
  changed?(): void;
  reflections?: PuddlePlanarReflections;
  deformation?: TerrainDeformationTexture;
  detailLevels?: () => number;
  onWorkSlice?: (slice: WorkSlice) => void;
  vehicles?: Pick<VehicleHost, "vehicleIds" | "vehicleState" | "vehicleDefinition" | "onPhysicsStep" | "isSurfaceFxActive"> | undefined;
  terrainForGround?: (id: string) => string | null;
  rippleLimit?: () => number;
  normal?: () => Promise<Texture | null>;
}
export interface PuddleResult { status: "loading" | "ready" | "dry" | "open-boundary" | "missing-terrain" | "error"; area: number; message: string; bedRevision?: number; spacing?: number }
type PreparedBed = Awaited<ReturnType<typeof preparePuddleBed>>;
interface PuddleInteraction { state: LakeRippleState; stops: WeakMap<LakeRipple, Float32Array> }
interface LiveBed { body: PuddleWaterBody; prepared: PreparedBed; geometry: TerrainPuddleGeometry; revision: number; seenRevision: number; levels: number | null; attemptedLevels: number | null; builtAt: number }
const intersects = (a: { minX: number; minZ: number; maxX: number; maxZ: number }, b: PuddleWaterBody) =>
  a.minX < b.bounds.max[0] && a.maxX > b.bounds.min[0] && a.minZ < b.bounds.max[1] && a.maxZ > b.bounds.min[1];

/** Same authored fill in editor and Play. Changed live beds reuse bounded tiles
 * in serialized cooperative jobs, without per-frame terrain scans or collider rebuilds. */
export class PuddleWaterController {
  readonly objects = new Map<string, TerrainPuddleSurface>();
  readonly results = new Map<string, PuddleResult>();
  private readonly fingerprints = new Map<string, string>();
  private abort = new AbortController();
  private revision = 0;
  private readonly reflections: PuddlePlanarReflections;
  private readonly deformation: TerrainDeformationTexture;
  private readonly beds = new Map<string, LiveBed>();
  private readonly pending = new Set<string>();
  private readonly authored = new Map<string, string>();
  private work: Promise<void> | null = null;
  private unsubscribePhysics: (() => void) | null = null;
  private readonly interactions = new Map<string, PuddleInteraction>();
  private normal: Promise<Texture | null> | null = null;
  constructor(private readonly host: PuddleHost) {
    this.reflections = host.reflections ?? new PuddlePlanarReflections();
    this.deformation = host.deformation ?? sharedTerrainDeformation();
  }
  private levels(body: PuddleWaterBody, window = this.deformation.trackWindow()): number | null {
    if (!window || !intersects({ ...window, maxX: window.minX + window.size, maxZ: window.minZ + window.size }, body)) return null;
    return Math.max(0, Math.min(2, Math.floor(this.host.detailLevels?.() ?? terrainTrackDetailStats().levels)));
  }
  private async build(body: PuddleWaterBody, prepared: PreparedBed, bed: TerrainRenderedBed, signal: AbortSignal) {
    const levels = this.levels(body, bed.window), region = { ...prepared.region, cellSize: prepared.region.cellSize / 2 ** (levels ?? 0) };
    const cells = (region.size / region.cellSize) ** 2;
    if (cells > PUDDLE_LIMITS.cells) throw new Error(`Puddle live detail exceeds 128×128 cells at ${region.cellSize} m; reduce Working Area (previous surface retained)`);
    const other = [...this.beds.values()].filter(entry => entry.body.id !== body.id).reduce((sum, entry) => sum + (entry.geometry.coverage?.cells ?? 0) ** 2, 0);
    if (other + cells > PUDDLE_LIMITS.totalCells) throw new Error("Puddle live total cell budget exceeded; previous surface retained");
    const work = new CooperativeWork({ signal, onSlice: this.host.onWorkSlice, budgetMs: 2 });
    const data = await work.run("puddle-bed", terrainPuddleSteps(region, (x, z) => {
      const base = prepared.heightAt(x, z); return base === null ? null : base + (levels === null ? 0 : bed.offsetAt(x, z));
    }));
    signal.throwIfAborted(); return { data, levels };
  }
  private publish(body: PuddleWaterBody, prepared: PreparedBed, data: TerrainPuddleGeometry, bed: TerrainRenderedBed, levels: number | null): void {
    if (data.status === "ready" || data.status === "dry") {
      let surface = this.objects.get(body.id);
      if (!surface) {
        surface = new TerrainPuddleSurface(); surface.name = `puddle:${body.id}`;
        surface.userData.puddleWaterId = body.id; surface.userData.waterSceneTransmission = true;
        this.objects.set(body.id, surface); this.host.scene.add(surface);
      }
      if (data.coverage) setPuddleTerrainCoverage(this.host.scene, surface, body.terrainRef, data.coverage, levels);
      else clearPuddleTerrainCoverage(this.host.scene, surface);
      surface.rebuild(data);
      surface.setWindOrigin(body.seed[0], body.seed[1]);
      const interaction = this.interactions.get(body.id);
      if (interaction) { interaction.stops = new WeakMap(); if (data.status !== "ready") interaction.state.clear(); }
      const appearance = { ...PUDDLE_APPEARANCE, ...body.appearance };
      surface.setMudAppearance(appearance);
      surface.material.color.set(appearance.color); surface.material.opacity = appearance.opacity;
      surface.material.roughness = appearance.roughness; surface.material.envMapIntensity = appearance.reflectionStrength;
      if (data.status === "ready") this.reflections.set(surface, body.surfaceLevel, appearance); else this.reflections.remove(surface);
      this.fingerprints.set(body.id, JSON.stringify(body));
      this.beds.set(body.id, { body, prepared, geometry: data, revision: bed.revision, seenRevision: bed.revision, levels, attemptedLevels: levels, builtAt: performance.now() });
    }
    this.results.set(body.id, { status: data.status, area: data.area, bedRevision: bed.revision,
      spacing: prepared.region.cellSize / 2 ** (levels ?? 0),
      message: data.status === "ready" ? `Ready · bed grid ${prepared.region.cellSize / 2 ** (levels ?? 0)} m${(data.shore?.length ?? 0) / 4 > PUDDLE_MAX_RIPPLE_SHORE_SEGMENTS ? " · Wheel Ripples paused: shoreline complexity limit" : ""}` : data.status === "dry" ? "Seed is dry" : "Previous valid surface retained; check bounds/terrain" });
  }

  async rebuild(input: readonly PuddleWaterBody[], force = false): Promise<void> {
    const bodies = validatePuddleWaters(input);
    if (!this.unsubscribePhysics) this.unsubscribePhysics = this.host.vehicles?.onPhysicsStep?.(dt => this.advanceWheelInteractions(dt)) ?? null;
    for (const [id, interaction] of this.interactions) {
      if (!bodies.some(b => b.id === id && !b.hidden && JSON.stringify(b) === this.authored.get(id)) || force) {
        interaction.state.clear(); this.objects.get(id)?.clearRipples(); this.interactions.delete(id);
      }
    }
    this.abort.abort(); this.abort = new AbortController();
    this.pending.clear();
    this.authored.clear(); for (const body of bodies) this.authored.set(body.id, JSON.stringify(body));
    const signal = this.abort.signal, revision = ++this.revision;
    const live = new Set(bodies.filter(b => !b.hidden && this.host.document(b.terrainRef)).map(b => b.id));
    for (const [id, object] of this.objects) if (!live.has(id)) {
      clearPuddleTerrainCoverage(this.host.scene, object); this.beds.delete(id);
      this.reflections.remove(object);
      object.removeFromParent(); object.dispose(); this.objects.delete(id); this.fingerprints.delete(id);
    }
    for (const id of this.results.keys()) if (!live.has(id)) this.results.delete(id);
    const totalCells = bodies.filter(body => !body.hidden).reduce((sum, body) => {
      const document = this.host.document(body.terrainRef);
      return sum + (document ? ((body.bounds.max[0] - body.bounds.min[0]) / document.def.spacing) ** 2 : 0);
    }, 0);
    if (totalCells > PUDDLE_LIMITS.totalCells) {
      for (const body of bodies.filter(body => !body.hidden)) this.results.set(body.id, { status: "error", area: 0, message: "Puddle total cell budget exceeded; previous valid surfaces retained" });
      this.host.changed?.(); return;
    }
    for (const body of bodies) {
      if (body.hidden) continue;
      if (signal.aborted || revision !== this.revision) return;
      const document = this.host.document(body.terrainRef);
      const fingerprint = JSON.stringify(body);
      const count = document ? ((body.bounds.max[0] - body.bounds.min[0]) / document.def.spacing) ** 2 : 0;
      try {
        if (!document) {
          const previous = this.objects.get(body.id);
          if (previous) { this.reflections.remove(previous); previous.removeFromParent(); previous.dispose(); this.objects.delete(body.id); this.fingerprints.delete(body.id); }
          throw new Error("Missing Puddle terrain");
        }
        if (count > PUDDLE_LIMITS.cells) throw new Error("Puddle cell budget exceeded");
        if (!force && this.fingerprints.get(body.id) === fingerprint && ["ready", "dry"].includes(this.results.get(body.id)?.status ?? "")) continue;
        this.results.set(body.id, { status: "loading", area: this.results.get(body.id)?.area ?? 0, message: "Preparing water…" });
        const prepared = await preparePuddleBed(body, document, (key, pending) => this.host.load(body.terrainRef, key, pending), signal);
        const bed = this.deformation.captureBed(), { data, levels } = await this.build(body, prepared, bed, signal);
        const normal = await (this.normal ??= this.host.normal?.().catch(() => null) ?? Promise.resolve(null));
        if (signal.aborted || revision !== this.revision) return;
        this.publish(body, prepared, data, bed, levels);
        this.objects.get(body.id)?.setWindNormal(normal);
      } catch (error) {
        if (signal.aborted || revision !== this.revision) return;
        this.results.set(body.id, { status: "error", area: 0, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!signal.aborted && revision === this.revision) this.host.changed?.();
  }

  /** Poll revisions only; one changed active basin is rebuilt at a time, at most 10 Hz per body. */
  update(): void {
    for (const [id, entry] of this.beds) {
      if (this.authored.get(id) !== this.fingerprints.get(id)) continue;
      const change = this.deformation.bedChangesSince(entry.seenRevision), desired = this.levels(entry.body);
      if (change === undefined && desired === entry.attemptedLevels) continue;
      if (change && !intersects(change, entry.body) && desired === entry.attemptedLevels) { entry.seenRevision = this.deformation.bedRevision; continue; }
      if (performance.now() - entry.builtAt >= 100) this.pending.add(id);
    }
    if (!this.work && this.pending.size) this.work = this.pump().finally(() => { this.work = null; });
  }
  updateWind(wind: ResolvedWind, seconds: number): void {
    for (const [id, surface] of this.objects) surface.updateWind(wind, seconds, this.beds.get(id)?.body.appearance);
  }
  private async pump(): Promise<void> {
    const id = this.pending.values().next().value as string | undefined; if (!id) return;
    this.pending.delete(id); const entry = this.beds.get(id); if (!entry) return;
    const signal = this.abort.signal, revision = this.revision;
    try {
      const bed = this.deformation.captureBed(), { data, levels } = await this.build(entry.body, entry.prepared, bed, signal);
      if (signal.aborted || revision !== this.revision || this.beds.get(id) !== entry) return;
      this.publish(entry.body, entry.prepared, data, bed, levels);
      const current = this.beds.get(id); if (current) { current.builtAt = performance.now(); current.seenRevision = bed.revision; current.attemptedLevels = levels; }
      this.host.changed?.();
    } catch (error) {
      if (signal.aborted || revision !== this.revision) return;
      entry.builtAt = performance.now(); entry.seenRevision = this.deformation.bedRevision; entry.attemptedLevels = this.levels(entry.body);
      this.results.set(id, { status: "error", area: entry.geometry.area, message: String(error) }); this.host.changed?.();
    }
  }
  /** Exact query against the connected, published water bed. No disconnected basin is implicitly flooded. */
  sample(terrainRef: string, x: number, z: number) {
    for (const entry of this.beds.values()) if (entry.body.terrainRef === terrainRef) {
      const sample = samplePuddleWater(entry.geometry, x, z);
      if (sample) return { ...sample, id: entry.body.id, bedRevision: entry.revision,
        stale: entry.seenRevision !== this.deformation.bedRevision || this.results.get(entry.body.id)?.status !== "ready" };
    }
    return null;
  }
  async whenIdle(): Promise<void> { await this.work; }
  clearWheelInteractions(): void {
    this.interactions.clear(); for (const surface of this.objects.values()) surface.clearRipples();
  }

  /** One owner, fixed physics time. Revalidate live bed while its cooperative mesh job is pending. */
  advanceWheelInteractions(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || !this.host.vehicles || !this.host.terrainForGround) return;
    const host = this.host.vehicles;
    const vehicles = host.vehicleIds().filter(id => host.isSurfaceFxActive?.(id) !== false).slice(0, 32)
      .map(id => ({ id, state: host.vehicleState(id), definition: host.vehicleDefinition(id) }));
    const active: { id: string; surface: TerrainPuddleSurface; interaction: PuddleInteraction; contacts: LakeWheelContact[] }[] = [];
    for (const [id, entry] of this.beds) {
      const surface = this.objects.get(id); if (!surface) continue;
      const settings = resolvePuddleWheelRipples(entry.body);
      let interaction = this.interactions.get(id);
      if (!interaction) { interaction = { state: new LakeRippleState(settings), stops: new WeakMap() }; this.interactions.set(id, interaction); }
      let visible = surface.visible; for (let p = surface.parent; p; p = p.parent) visible &&= p.visible;
      if (!visible || this.results.get(id)?.status !== "ready" || !settings.wheelRipplesEnabled || settings.wheelRippleStrength <= 0
        || (entry.geometry.shore?.length ?? 0) / 4 > PUDDLE_MAX_RIPPLE_SHORE_SEGMENTS) {
        interaction.state.clear(); surface.clearRipples(); continue;
      }
      const depthAt = (x: number, z: number): number | null => {
        if (!samplePuddleWater(entry.geometry, x, z)) return null;
        const base = entry.prepared.heightAt(x, z); if (base === null) return null;
        const depth = entry.body.surfaceLevel - base - (entry.levels === null ? 0 : this.deformation.currentBedOffsetAt(x, z));
        if (depth <= 1e-5) return null;
        // A new raised barrier must not connect an old wet face to the seed.
        if (entry.revision !== this.deformation.bedRevision) {
          const seed = entry.body.seed;
          for (let i = 1; i <= 32; i++) {
            const sx = x + (seed[0] - x) * i / 32, sz = z + (seed[1] - z) * i / 32;
            const h = entry.prepared.heightAt(sx, sz);
            if (h === null || h + (entry.levels === null ? 0 : this.deformation.currentBedOffsetAt(sx, sz)) >= entry.body.surfaceLevel) return null;
          }
        }
        return depth;
      };
      const contacts: LakeWheelContact[] = [];
      for (const v of vehicles) for (let i = 0; i < (v.state?.wheels.length ?? 0) && contacts.length < 128; i++) {
        const wheel = v.state!.wheels[i]!;
        const contact = puddleWheelContact(`${v.id}:${i}`, wheel, vehicleWheelWidth(v.definition?.wheels[i] ?? wheel), entry.body.surfaceLevel,
          entry.body.terrainRef, this.host.terrainForGround, depthAt);
        if (contact) contacts.push(contact);
      }
      if (contacts.length || interaction.state.ripples.length) active.push({ id, surface, interaction, contacts });
      else interaction.state.advance(dt, []);
    }
    const limit = Math.max(0, Math.min(PUDDLE_MAX_RIPPLES, Math.floor(PUDDLE_TOTAL_RIPPLES / Math.max(1, active.length)), this.host.rippleLimit?.() ?? PUDDLE_MAX_RIPPLES));
    for (const { id, surface, interaction, contacts } of active) {
      const entry = this.beds.get(id)!, settings = resolvePuddleWheelRipples(entry.body);
      interaction.state.setLimit(limit); interaction.state.advance(dt, contacts);
      const stops = interaction.state.ripples.map(r => {
        let row = interaction.stops.get(r);
        if (!row) { row = puddleRippleStops(r.x, r.z, entry.geometry.shore ?? new Float32Array(), settings.wheelRippleSpeed * settings.wheelRippleLifetime + settings.wheelRippleWidth * 4); interaction.stops.set(r, row); }
        return row;
      });
      surface.setWheelRipples(interaction.state.ripples, settings, stops);
    }
  }

  dispose(): void {
    this.unsubscribePhysics?.(); this.unsubscribePhysics = null; this.interactions.clear();
    this.abort.abort(); this.revision++;
    for (const object of this.objects.values()) { clearPuddleTerrainCoverage(this.host.scene, object); this.reflections.remove(object); object.removeFromParent(); object.dispose(); }
    this.beds.clear(); this.pending.clear(); this.authored.clear();
    if (!this.host.reflections) this.reflections.dispose();
    this.objects.clear(); this.results.clear(); this.fingerprints.clear();
  }
}
