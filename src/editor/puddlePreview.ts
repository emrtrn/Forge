import { Box3, Box3Helper, Group, Vector3, type Scene } from "three";
import { buildTerrainPuddle, type TerrainPuddleGeometry, type TerrainPuddleRegion } from "@engine/terrain/terrainPuddle";
import { terrainHeightAt } from "@engine/terrain/terrainHeightQuery";
import type { WorldTerrainDocument } from "@engine/terrain/terrainLoader";
import { tileKey, type TerrainTileData } from "@engine/terrain/terrainTypes";
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
}
interface PreviewHost {
  scene: Scene;
  document(id: string): WorldTerrainDocument | undefined;
  load(id: string, key: string, signal: AbortSignal): Promise<TerrainTileData>;
  changed(): void;
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
  private state: PuddlePreviewState = { terrainRef: null, seed: null, level: 0, size: 12, spacing: 1, area: 0, status: "idle", message: "" };

  constructor(private readonly host: PreviewHost) {
    this.group.name = "puddle-editor-preview";
    this.group.userData.waterSceneTransmission = true;
    this.group.add(this.surface, this.bounds);
    this.group.visible = false;
    host.scene.add(this.group);
  }

  snapshot(): PuddlePreviewState { return { ...this.state, seed: this.state.seed ? [...this.state.seed] : null }; }

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
    const { def } = document, s = def.spacing;
    const cells = Math.max(2, Math.ceil(this.state.size / s));
    if (cells > 128) { this.fail("Çalışma alanı 128×128 hücre bütçesini aşıyor; alanı küçültün."); return; }
    const region: TerrainPuddleRegion = { minX: def.origin[0] + Math.floor((seed[0] - cells * s / 2 - def.origin[0]) / s) * s,
      minZ: def.origin[2] + Math.floor((seed[1] - cells * s / 2 - def.origin[2]) / s) * s,
      size: cells * s, cellSize: s, level, seed };
    this.state = { ...this.state, spacing: s, size: region.size, status: "loading", message: "Kesin terrain verisi hazırlanıyor…" };
    this.host.changed();
    const tiles = new Map(document.tiles), known = new Set(def.tiles.map(tile => tile.key));
    const span = def.tileQuads * s, keys: string[] = [];
    const firstX = Math.max(0, Math.floor((region.minX - def.origin[0]) / span));
    const firstZ = Math.max(0, Math.floor((region.minZ - def.origin[2]) / span));
    const lastX = Math.min(def.tilesX - 1, Math.floor((region.minX + region.size - def.origin[0]) / span));
    const lastZ = Math.min(def.tilesZ - 1, Math.floor((region.minZ + region.size - def.origin[2]) / span));
    for (let z = firstZ; z <= lastZ; z++) for (let x = firstX; x <= lastX; x++) {
      const key = tileKey(x, z); if (known.has(key) && !tiles.has(key)) keys.push(key);
    }
    if (keys.length > 16) { this.fail("Önizleme en fazla 16 eksik tile yükler; çalışma alanını küçültün."); return; }
    try {
      // Sequential reads keep this small authoring tool from flooding streaming IO.
      for (const key of keys) {
        const tile = await this.host.load(terrainRef, key, signal);
        if (signal.aborted || revision !== this.revision) return;
        tiles.set(key, tile);
      }
      if (signal.aborted || revision !== this.revision) return;
      const data = buildTerrainPuddle(region, (x, z) => terrainHeightAt(def, { tile: (tx, tz) => tiles.get(tileKey(tx, tz)) }, x, z));
      if (this.surface.rebuild(data)) this.state.area = data.area;
      // Failed results keep the old valid surface; the outline shows the new request.
      this.bounds.box.set(new Vector3(region.minX, level, region.minZ), new Vector3(region.minX + region.size, level, region.minZ + region.size));
      this.group.visible = true;
      const messages: Record<TerrainPuddleGeometry["status"], string> = {
        ready: `${data.area.toFixed(2)} m² · Terrain aralığı ${s} m. Bu önizleme kaydedilmez.`,
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

  private fail(message: string): void { this.state = { ...this.state, status: "error", message }; this.host.changed(); }

  clear(): void {
    this.abort.abort(); this.revision++;
    this.surface.rebuild({ status: "dry", positions: new Float32Array(), depths: new Float32Array(), area: 0 });
    this.group.visible = false;
    this.state = { ...this.state, terrainRef: null, seed: null, area: 0, status: "idle", message: "" };
  }
  dispose(): void {
    this.clear(); this.group.removeFromParent(); this.surface.dispose(); this.bounds.geometry.dispose();
    const material = this.bounds.material;
    if (Array.isArray(material)) material.forEach(entry => entry.dispose()); else material.dispose();
  }
}
