import { Box3, Box3Helper, Group, Vector3, type Scene } from "three";
import type { TerrainPuddleGeometry, TerrainPuddleRegion } from "@engine/terrain/terrainPuddle";
import { preparePuddleWater, puddleRegionAroundSeed } from "@engine/terrain/terrainPuddlePreparation";
import { NEW_PUDDLE_APPEARANCE, validatePuddleWater, type PuddleWaterBody } from "@engine/scene/puddleWater";
import { PuddlePlanarReflections } from "@engine/render-three/puddlePlanarReflections";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { type TerrainTileData } from "@engine/terrain/terrainTypes";
import { TerrainPuddleSurface } from "@engine/render-three/terrain/terrainPuddleSurface";

export interface PuddlePreviewState {
  terrainRef: string | null;
  seed: readonly [number, number] | null;
  level: number;
  size: number;
  spacing: number;
  area: number;
  status: "idle" | "loading" | "error" | TerrainPuddleGeometry["status"];
  message: string;
  appearance: NonNullable<PuddleWaterBody["appearance"]>;
}
interface PreviewHost {
  scene: Scene;
  document(id: string): WorldTerrainDocument | undefined;
  load(id: string, key: string, signal: AbortSignal): Promise<TerrainTileData>;
  changed(): void;
  reflections?: PuddlePlanarReflections;
}

/** Editor-only, transient tool. Never adds a layout actor, terrain mutation or
 * save payload. Exact native terrain samples only; no invented sub-grid detail.
 * Async loads are revision/abort guarded and owned only for one preview build. */
export class PuddlePreview {
  readonly group = new Group();
  readonly surface = new TerrainPuddleSurface();
  private readonly bounds = new Box3Helper(new Box3(), 0xe9bd69);
  private abort = new AbortController();
  private revision = 0;
  private region: TerrainPuddleRegion | null = null;
  private state: PuddlePreviewState = { terrainRef: null, seed: null, level: 0, size: 12, spacing: 1, area: 0, status: "idle", message: "", appearance: { ...NEW_PUDDLE_APPEARANCE } };
  private readonly reflections: PuddlePlanarReflections;

  constructor(private readonly host: PreviewHost) {
    this.reflections = host.reflections ?? new PuddlePlanarReflections();
    this.group.name = "puddle-editor-preview";
    this.group.userData.waterSceneTransmission = true;
    this.group.add(this.surface, this.bounds);
    this.group.visible = false;
    host.scene.add(this.group);
  }

  snapshot(): PuddlePreviewState { return { ...this.state, appearance: { ...this.state.appearance }, seed: this.state.seed ? [...this.state.seed] : null }; }

  editAppearance(patch: NonNullable<PuddleWaterBody["appearance"]>): void {
    const body = this.toBody("preview", "Preview");
    if (!body) return;
    const next = validatePuddleWater({ ...body, appearance: { ...this.state.appearance, ...patch } });
    this.state.appearance = next.appearance!;
    this.surface.material.envMapIntensity = this.state.appearance.reflectionStrength ?? NEW_PUDDLE_APPEARANCE.reflectionStrength;
    this.reflections.set(this.surface, body.surfaceLevel, this.state.appearance);
    this.host.changed();
  }

  async begin(terrainRef: string, seed: readonly [number, number], level: number): Promise<void> {
    this.state = { ...this.state, terrainRef, seed: [...seed], level };
    await this.rebuild();
  }

  async edit(patch: { level?: number; size?: number }): Promise<void> {
    if ((patch.level !== undefined && !Number.isFinite(patch.level))
      || (patch.size !== undefined && (!Number.isFinite(patch.size) || patch.size <= 0))) return;
    this.state = { ...this.state, ...patch }; await this.rebuild();
  }

  async rebuild(): Promise<void> {
    this.abort.abort(); this.abort = new AbortController();
    const signal = this.abort.signal, revision = ++this.revision;
    const { terrainRef, seed, level } = this.state;
    if (!terrainRef || !seed) return;
    const document = this.host.document(terrainRef);
    if (!document) { this.clear(); return; }
    const s = document.def.spacing;
    this.state.spacing = s;
    let region: TerrainPuddleRegion;
    try { region = puddleRegionAroundSeed(document.def, seed, this.state.size, level); }
    catch (error) { this.fail(String(error)); return; }
    this.state = { ...this.state, spacing: s, size: region.size, status: "loading", message: "Kesin terrain verisi hazırlanıyor…" };
    this.host.changed();
    try {
      const body: PuddleWaterBody = { schema: 1, kind: "puddle", coordinateSpace: "world", id: "preview", terrainRef,
        seed: [...seed], surfaceLevel: level, bounds: { min: [region.minX, region.minZ], max: [region.minX + region.size, region.minZ + region.size] } };
      const data = await preparePuddleWater(body, document, (key, pending) => this.host.load(terrainRef, key, pending), signal);
      if (signal.aborted || revision !== this.revision) return;
      if (data.status === "ready") this.region = region;
      if (this.surface.rebuild(data)) this.state.area = data.area;
      if (data.status === "ready") this.reflections.set(this.surface, level, this.state.appearance);
      else if (data.status === "dry") this.reflections.remove(this.surface);
      // Failed results keep the old valid surface; the outline shows the new request.
      this.bounds.box.set(new Vector3(region.minX, level, region.minZ), new Vector3(region.minX + region.size, level, region.minZ + region.size));
      this.group.visible = true;
      const messages: Record<TerrainPuddleGeometry["status"], string> = {
        ready: `${data.area.toFixed(2)} m² · Hazır; Create Puddle ile oluşturun.`,
        dry: "Başlangıç noktası kuru; su seviyesini yükseltin veya başka çukur seçin.",
        "open-boundary": "Su çalışma sınırına ulaştı. Alanı genişletin veya seviyeyi düşürün; önceki geçerli yüzey korundu.",
        "missing-terrain": "Bağlı su alanında terrain eksik. Önceki geçerli yüzey korundu; boşluklar suyla doldurulmadı.",
      };
      this.state = { ...this.state, status: data.status, message: messages[data.status] };
      this.host.changed();
    } catch (error) {
      if (!signal.aborted && revision === this.revision) this.fail(`Önizleme hazırlanamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  toBody(id: string, name: string): PuddleWaterBody | null {
    const region = this.region;
    if (this.state.status !== "ready" || !region || !this.state.terrainRef) return null;
    return validatePuddleWater({ schema: 1, kind: "puddle", coordinateSpace: "world", id, name,
      terrainRef: this.state.terrainRef, seed: [...region.seed], surfaceLevel: region.level,
      appearance: { ...this.state.appearance },
      bounds: { min: [region.minX, region.minZ], max: [region.minX + region.size, region.minZ + region.size] } });
  }

  private fail(message: string): void { this.state = { ...this.state, status: "error", message }; this.host.changed(); }

  clear(): void {
    this.reflections.remove(this.surface);
    this.abort.abort(); this.revision++; this.region = null;
    this.surface.rebuild({ status: "dry", positions: new Float32Array(), depths: new Float32Array(), area: 0 });
    this.group.visible = false;
    this.state = { ...this.state, terrainRef: null, seed: null, area: 0, status: "idle", message: "" };
  }
  dispose(): void {
    this.clear(); this.group.removeFromParent(); this.surface.dispose(); this.bounds.geometry.dispose();
    if (!this.host.reflections) this.reflections.dispose();
    const material = this.bounds.material;
    if (Array.isArray(material)) material.forEach(entry => entry.dispose()); else material.dispose();
  }
}
