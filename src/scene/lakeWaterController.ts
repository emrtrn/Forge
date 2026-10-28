import { registerLakeShoreWetness } from "@engine/render-three/terrain/terrainShoreWetness";
import { LakeSurfaceQuery, LakeRippleState, lakeWheelContact, type LakeWheelContact } from "@engine/terrain/lakeInteraction";
import { vehicleWheelWidth } from "@engine/physics/surface/sinkage";
import type { VehicleHost } from "./capabilities/runtimeServiceKeys";
import { Group, BufferGeometry, Float32BufferAttribute, LineSegments, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry, type Texture, type Scene } from "three";
import type { LayoutLakeWaterBody } from "@engine/scene/layout";
import { LAKE_LIMITS, resolveLakeAppearance } from "@engine/scene/waterBody";
import { buildLakeGeometry, emptyLake, lakeGrid, prepareLakeSnapshot, type LakeGeometry } from "@engine/terrain/terrainLakeWater";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";
import { LakeWaterObject } from "@engine/render-three/lakeWater";
import { PlanarReflectionSource } from "@engine/render-three/planarReflectionSource";
import type { WaterReflectionRegistry } from "@engine/render-three/waterReflectionRegistry";
import { registerLakeCaustics } from "@engine/render-three/terrain/terrainCaustics";

export interface LakeWaterContext {
  scene: Scene;
  editor: boolean;
  reflections?: WaterReflectionRegistry;
  document: (terrainRef: string) => WorldTerrainDocument | undefined;
  load: (terrainRef: string, key: string, signal?: AbortSignal) => Promise<TerrainTileData>;
  normal: (id: string) => Promise<Texture | null>;
  changed?: () => void;
  vehicles?: Pick<VehicleHost, "vehicleIds" | "vehicleState" | "vehicleDefinition" | "onPhysicsStep" | "isSurfaceFxActive"> | undefined;
}

/** One serialized CPU job and at most four temporary reads, with per-body publication. */
export class LakeWaterController {
  readonly results = new Map<string, LakeGeometry>();
  readonly objects = new Map<string, LakeWaterObject>();
  readonly helpers = new Group();
  private aborter = new AbortController();
  private generation = 0;
  private chain: Promise<void> = Promise.resolve();
  private reflection = new Map<string, PlanarReflectionSource>();
  private selected: string | null = null;
  private interactions = new Map<string, { query: LakeSurfaceQuery; state: LakeRippleState }>();
  private unsubscribePhysics: (() => void) | null = null;
  private waveTime = 0;
  constructor(private readonly context: LakeWaterContext) { context.scene.add(this.helpers); this.helpers.layers.set(31); }
  select(id: string | null) { this.selected = id; for (const child of this.helpers.children) child.visible = child.userData.waterBodyId === id; }
  invalidate() { this.aborter.abort(); this.results.clear(); this.clearInteractions(); }
  private clearInteractions(): void {
    this.interactions.clear();
    for (const object of this.objects.values()) object.setWheelRipples([]);
  }
  /** Called once per fixed physics slice; also usable by isolated QA fixtures. */
  advanceWheelInteractions(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.waveTime += dt;
    for (const object of this.objects.values()) object.setSurfaceWaveTime(this.waveTime);
    const host = this.context.vehicles;
    if (!host || !this.interactions.size) return;
    const vehicles = host.vehicleIds().filter(id => host.isSurfaceFxActive?.(id) !== false)
      .map(id => ({ id, state: host.vehicleState(id), definition: host.vehicleDefinition(id) }));
    for (const [id, interaction] of this.interactions) {
      const object = this.objects.get(id);
      let visible = !!object;
      for (let p = object?.parent; p; p = p.parent) visible &&= p.visible;
      if (!object || !object.visible || !visible) { interaction.state.clear(); object?.setWheelRipples([]); continue; }
      const contacts: LakeWheelContact[] = [];
      for (const vehicle of vehicles) vehicle.state?.wheels.forEach((wheel, i) => {
        const contact = lakeWheelContact(`${vehicle.id}:${i}`, wheel,
          vehicleWheelWidth(vehicle.definition?.wheels[i] ?? wheel), object.position.y, interaction.query,
          { time: this.waveTime, parameters: object.waveParameters });
        if (contact) contacts.push(contact);
      });
      interaction.state.advance(dt, contacts);
      object.setWheelRipples(interaction.state.ripples);
    }
  }
  rebuild(bodies: readonly LayoutLakeWaterBody[]): Promise<void> {
    this.clearInteractions();
    if (!this.context.editor && !this.unsubscribePhysics) this.unsubscribePhysics = this.context.vehicles?.onPhysicsStep?.(dt => this.advanceWheelInteractions(dt)) ?? null;
    this.aborter.abort(); this.aborter = new AbortController(); const signal = this.aborter.signal, generation = ++this.generation;
    const sources = structuredClone([...bodies]);
    const work = async () => {
      if (signal.aborted) return;
      const ids = new Set(sources.map((w) => w.id));
      for (const id of this.objects.keys()) if (!ids.has(id)) this.remove(id);
      for (const id of this.results.keys()) if (!ids.has(id)) { this.remove(id); this.results.delete(id); }
      let total = 0, bytes = 0;
      for (const lake of sources.sort((a, b) => a.id.localeCompare(b.id))) {
        if (signal.aborted) return;
        let result: LakeGeometry;
        try {
          const document = this.context.document(lake.terrainRef);
          if (!document) throw new Error("Lake requires a World Terrain reference");
          const grid = lakeGrid(document.def, lake); total += grid.nx * grid.nz;
          if (sources.length > LAKE_LIMITS.bodies || total > LAKE_LIMITS.totalCells) throw new Error("over-budget: total Lake area exceeds limit");
          const snapshot = await prepareLakeSnapshot(document, lake, (key, s) => this.context.load(lake.terrainRef, key, s), signal);
          result = await buildLakeGeometry(snapshot, signal);
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
        this.remove(lake.id); this.results.set(lake.id, result);
        if (result.status === "ready") {
          const a = resolveLakeAppearance(lake);
          let reflection: PlanarReflectionSource | null = null;
          if (a.reflectionMode === "sharedPlanar" && a.reflectionQuality !== "low") {
            const key = `${a.reflectionGroup}:${lake.surfaceLevel}:${a.reflectionQuality}`;
            reflection = this.reflection.get(key) ?? this.context.reflections?.acquire(a.reflectionGroup, lake.surfaceLevel, a.reflectionQuality) ?? new PlanarReflectionSource(lake.surfaceLevel, a.reflectionQuality);
            this.reflection.set(key, reflection);
          }
          let object: LakeWaterObject | undefined;
          try {
            object = new LakeWaterObject(lake, result, normal, reflection);
            object.addEventListener("removed", registerLakeShoreWetness(this.context.scene, lake, result, object));
          }
          catch (error) {
            object?.dispose();
            const message = error instanceof Error ? error.message : String(error);
            result = emptyLake(lake, message.includes("over-budget") ? "over-budget" : "invalid", message);
            this.results.set(lake.id, result);
            if (this.context.editor) this.addHelper(lake, result);
            this.context.changed?.();
            continue;
          }
          object.visible = !lake.hidden;
          if (!this.context.editor && this.unsubscribePhysics) object.setSurfaceWaveTime(this.waveTime);
          if (!this.context.editor) object.raycast = () => {};
          this.objects.set(lake.id, object); this.context.scene.add(object);
          this.interactions.set(lake.id, { query: new LakeSurfaceQuery(result), state: new LakeRippleState(a) });
          object.addEventListener("removed", registerLakeCaustics(this.context.scene, lake, result, object));
        }
        if (this.context.editor) this.addHelper(lake, result);
        this.context.changed?.();
      }
      // Sources are cheap while off; dispose unused captures after every publication pass.
      for (const [key, source] of this.reflection) {
        const active = sources.some((w) => { const a = resolveLakeAppearance(w); return !w.hidden && this.objects.has(w.id) && a.reflectionMode === "sharedPlanar" && `${a.reflectionGroup}:${w.surfaceLevel}:${a.reflectionQuality}` === key; });
        if (!active) { this.release(source); this.reflection.delete(key); }
      }
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
    const object = this.objects.get(id); if (object) { object.removeFromParent(); object.dispose(); this.objects.delete(id); }
    for (const child of [...this.helpers.children]) if (child.userData.waterBodyId === id) {
      child.removeFromParent(); child.traverse((o) => { if (o instanceof Mesh || o instanceof LineSegments) { o.geometry.dispose(); o.material.dispose(); } });
    }
  }
  private release(source: PlanarReflectionSource) { if (this.context.reflections) this.context.reflections.release(source); else source.dispose(); }
  dispose() { this.unsubscribePhysics?.(); this.unsubscribePhysics = null; this.waveTime = 0; this.clearInteractions(); this.aborter.abort(); ++this.generation; for (const id of this.objects.keys()) this.remove(id);
    for (const child of [...this.helpers.children]) this.remove(child.userData.waterBodyId as string);
    this.results.clear(); for (const source of this.reflection.values()) this.release(source); this.reflection.clear(); }
}
