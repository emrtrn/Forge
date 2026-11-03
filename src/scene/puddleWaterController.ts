import type { Scene } from "three";
import { TerrainPuddleSurface } from "@engine/render-three/terrain/terrainPuddleSurface";
import { PUDDLE_APPEARANCE, PUDDLE_LIMITS, validatePuddleWaters, type PuddleWaterBody } from "@engine/scene/puddleWater";
import { preparePuddleWater } from "@engine/terrain/terrainPuddlePreparation";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import type { TerrainTileData } from "@engine/terrain/terrainTypes";
import { PuddlePlanarReflections } from "@engine/render-three/puddlePlanarReflections";

interface PuddleHost {
  scene: Scene;
  document(id: string): WorldTerrainDocument | undefined;
  load(id: string, key: string, signal: AbortSignal): Promise<TerrainTileData>;
  changed?(): void;
  reflections?: PuddlePlanarReflections;
}
export interface PuddleResult { status: "loading" | "ready" | "dry" | "open-boundary" | "missing-terrain" | "error"; area: number; message: string }

/** Same saved-source path in editor and Play. One bounded native-grid rebuild
 * per revision, no per-frame terrain scan, physics owner or per-body capture. */
export class PuddleWaterController {
  readonly objects = new Map<string, TerrainPuddleSurface>();
  readonly results = new Map<string, PuddleResult>();
  private readonly fingerprints = new Map<string, string>();
  private abort = new AbortController();
  private revision = 0;
  private readonly reflections: PuddlePlanarReflections;
  constructor(private readonly host: PuddleHost) { this.reflections = host.reflections ?? new PuddlePlanarReflections(); }

  async rebuild(input: readonly PuddleWaterBody[], force = false): Promise<void> {
    const bodies = validatePuddleWaters(input);
    this.abort.abort(); this.abort = new AbortController();
    const signal = this.abort.signal, revision = ++this.revision;
    const live = new Set(bodies.filter(b => !b.hidden && this.host.document(b.terrainRef)).map(b => b.id));
    for (const [id, object] of this.objects) if (!live.has(id)) {
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
        const data = await preparePuddleWater(body, document, (key, pending) => this.host.load(body.terrainRef, key, pending), signal);
        if (signal.aborted || revision !== this.revision) return;
        if (data.status === "ready" || data.status === "dry") {
          let surface = this.objects.get(body.id);
          if (!surface) {
            surface = new TerrainPuddleSurface(); surface.name = `puddle:${body.id}`;
            surface.userData.puddleWaterId = body.id; surface.userData.waterSceneTransmission = true;
            this.objects.set(body.id, surface); this.host.scene.add(surface);
          }
          surface.rebuild(data);
          const appearance = { ...PUDDLE_APPEARANCE, ...body.appearance };
          surface.material.color.set(appearance.color); surface.material.opacity = appearance.opacity;
          surface.material.roughness = appearance.roughness; surface.material.envMapIntensity = appearance.reflectionStrength;
          if (data.status === "ready") this.reflections.set(surface, body.surfaceLevel, appearance);
          else this.reflections.remove(surface);
          this.fingerprints.set(body.id, fingerprint);
        }
        this.results.set(body.id, { status: data.status, area: data.area,
          message: data.status === "ready" ? "Ready" : data.status === "dry" ? "Seed is dry" : "Previous valid surface retained; check bounds/terrain" });
      } catch (error) {
        if (signal.aborted || revision !== this.revision) return;
        this.results.set(body.id, { status: "error", area: 0, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!signal.aborted && revision === this.revision) this.host.changed?.();
  }

  dispose(): void {
    this.abort.abort(); this.revision++;
    for (const object of this.objects.values()) { this.reflections.remove(object); object.removeFromParent(); object.dispose(); }
    if (!this.host.reflections) this.reflections.dispose();
    this.objects.clear(); this.results.clear(); this.fingerprints.clear();
  }
}
